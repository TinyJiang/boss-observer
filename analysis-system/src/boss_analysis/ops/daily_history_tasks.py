"""Prepare CLS scheduled SQL tasks for daily history metrics.

This module builds Tencent Cloud CLS Scheduled SQL payloads only. The CLI is
dry-run by default; pass ``--apply`` when the credential is allowed to create or
modify scheduled SQL tasks.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from collections.abc import Iterable, Mapping
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from typing import Any
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from boss_analysis.consumer.cls_search import (
  ClsSearchConfig,
  TencentCloudApiClient,
  TencentCloudCredentials,
  load_cls_daily_basic_summary_search_config,
  query_cls_metric_range,
  search_cls_log_values,
)
from boss_analysis.dev_server import load_env_files

SCHEDULED_SQL_VERSION = "2020-10-16"
DEFAULT_REGION = "ap-shanghai"
DEFAULT_SRC_TOPIC_NAME = "boss"
DEFAULT_PROCESS_WINDOW = "@d,@m-1m"
DEFAULT_BACKFILL_PROCESS_WINDOW = "@d-1d,@d"
DEFAULT_PROCESS_PERIOD_MINUTES = 5
DEFAULT_PROCESS_DELAY_SECONDS = 60
DEFAULT_METRIC_LABELS = ("metric_name", "active_date", "operator_id")
DEFAULT_TIMEZONE_NAME = "Asia/Shanghai"
METRIC_TOPIC_WINDOW_WARNING = (
  "Destination is a CLS metric topic (BizType=1). This plan uses a day-scale "
  "ProcessTimeWindow; if CLS does not emit metric samples, run the SQL into a "
  "log topic target or narrow the scheduled window before treating the task as deployed."
)
DEPLOYMENT_IAM_ACTIONS = (
  "cls:DescribeTopics",
  "cls:DescribeScheduledSqlInfo",
  "cls:CreateScheduledSql",
  "cls:ModifyScheduledSql",
)
VERIFICATION_IAM_ACTIONS = (
  "cls:SearchLog",
  "cls:QueryRangeMetric",
)

CHAT_REPLY_SQL = """* |
select
  'boss_daily_operator_basic_stats' metric_name,
  substr(cast(d as varchar), 1, 10) active_date,
  op operator_id,
  count(distinct case when fd = 'c' then ck end) first_round_candidate_initiated_count,
  sum(case when first_reply_ms is not null then 1 else 0 end) first_round_boss_replied_count,
  coalesce(cast(approx_percentile(first_reply_ms, 0.5) as bigint), 0) first_round_boss_reply_elapsed_median_ms,
  coalesce(cast(avg(first_reply_ms) as bigint), 0) first_round_boss_reply_elapsed_avg_ms,
  count(distinct ck) chat_conversation_count,
  count(distinct case when ld = 'b' then ck end) boss_ended_conversation_count,
  sum(case when reply_ms is not null then 1 else 0 end) boss_reply_count,
  coalesce(cast(approx_percentile(reply_ms, 0.5) as bigint), 0) boss_reply_elapsed_median_ms,
  coalesce(cast(avg(reply_ms) as bigint), 0) boss_reply_elapsed_avg_ms
from (
  select
    *,
    case
      when dir = 'c' and nd = 'b' and nfm >= lm
      then date_diff('millisecond', lm, nfm)
    end reply_ms,
    case
      when ti = 1 and dir = 'c' and nd = 'b' and nfm >= lm
      then date_diff('millisecond', lm, nfm)
    end first_reply_ms
  from (
    select
      *,
      first_value(dir) over (
        partition by d, op, ck
        order by ti
        rows between unbounded preceding and unbounded following
      ) fd,
      last_value(dir) over (
        partition by d, op, ck
        order by ti
        rows between unbounded preceding and unbounded following
      ) ld,
      lead(dir) over (partition by d, op, ck order by ti) nd,
      lead(fm) over (partition by d, op, ck order by ti) nfm
    from (
      select
        d, op, ck, ti, dir,
        min(mt) fm,
        max(mt) lm
    from (
      select
        *,
        sum(case when pd is null or pd <> dir then 1 else 0 end) over (
          partition by d, op, ck
          order by mt, mi, k
          rows between unbounded preceding and current row
        ) ti
      from (
        select
          *,
          lag(dir) over (
            partition by d, op, ck
            order by mt, mi, k
          ) pd
        from (
          select d, op, ck, coalesce(mi, 0) mi, mt, dir, k
          from (
            select
              *,
              row_number() over (
                partition by d, op, ck, k
                order by et desc, mi desc
              ) rn
            from (
              select
                d, op, ck, et,
                try_cast(nullif(try(json_extract_scalar(m, '$.messageIndex')), '') as bigint) mi,
                try(from_iso8601_timestamp(try(json_extract_scalar(m, '$.messageAt')))) mt,
                case
                  when lower(coalesce(try(json_extract_scalar(m, '$.direction')), '')) in ('candidate', 'geek') then 'c'
                  when lower(coalesce(try(json_extract_scalar(m, '$.direction')), '')) in ('recruiter', 'boss') then 'b'
                  else ''
                end dir,
                coalesce(
                  nullif(try(json_extract_scalar(m, '$.fingerprint')), ''),
                  concat(coalesce(try(json_extract_scalar(m, '$.messageIndex')), ''), ':', coalesce(try(json_extract_scalar(m, '$.messageAt')), ''), ':', coalesce(try(json_extract_scalar(m, '$.direction')), ''))
                ) k
              from (
                select
                  histogram(__TIMESTAMP__, interval 1 day) d,
                  case when operator_id is null or operator_id = '' then '<missing>' else cast(operator_id as varchar) end op,
                  __TIMESTAMP__ et,
                  coalesce(
                    nullif(try(json_extract_scalar(payload_json, '$.chat.conversationKey')), ''),
                    nullif(try(json_extract_scalar(payload_json, '$.candidate.candidateId')), ''),
                    nullif(try(json_extract_scalar(payload_json, '$.candidate.stableId')), ''),
                    nullif(try(json_extract_scalar(payload_json, '$.candidate.exposureKey')), '')
                  ) ck,
                  json_extract(cast(coalesce(payload_json, '') as varchar), '$.chat.messages') ms
                where event_type = 'candidate_chat.snapshot_captured'
              ) s
              cross join unnest(cast(ms as array(json))) as u(m)
              where d is not null
                and ck is not null
                and ms is not null
                and lower(op) not in ('', '<missing>', 'missing', '__missing__', 'null', 'none')
            )
            where mt is not null
              and dir in ('c', 'b')
              and k is not null
          )
          where rn = 1
        )
      )
    )
    group by d, op, ck, ti, dir
  )
)
)
group by d, op
limit 10000"""

WECHAT_MARKER_SQL = """* |
select
  'boss_daily_operator_basic_stats' metric_name,
  substr(cast(d as varchar), 1, 10) active_date,
  op operator_id,
  count(*) wechat_captured,
  count(distinct ck) wechat_unique_candidates
from (
  select
    histogram(__TIMESTAMP__, interval 1 day) d,
    case when operator_id is null or operator_id = '' then '<missing>' else cast(operator_id as varchar) end op,
    coalesce(
      nullif(try(json_extract_scalar(payload_json, '$.candidate.candidateId')), ''),
      nullif(try(json_extract_scalar(payload_json, '$.candidate.stableId')), ''),
      nullif(try(json_extract_scalar(payload_json, '$.candidate.exposureKey')), '')
    ) ck
  where event_type in ('candidate_chat.wechat_captured', 'candidate_chat.snapshot_captured')
    and (
      event_type = 'candidate_chat.wechat_captured'
      or regexp_like(
        cast(coalesce(payload_json, '') as varchar),
        '([^[:space:]，。,:：]{1,30}的)?微信号[[:space:]]*[:：]'
      )
    )
)
where d is not null
  and lower(op) not in ('', '<missing>', 'missing', '__missing__', 'null', 'none')
group by d, op
limit 10000"""


@dataclass(frozen=True)
class ScheduledSqlTaskSpec:
  name: str
  sql: str
  metric_names: tuple[str, ...]
  metric_labels: tuple[str, ...] = DEFAULT_METRIC_LABELS

  def with_name(self, name: str) -> "ScheduledSqlTaskSpec":
    return ScheduledSqlTaskSpec(
      name=name,
      sql=self.sql,
      metric_names=self.metric_names,
      metric_labels=self.metric_labels,
    )


@dataclass(frozen=True)
class ScheduledSqlPlanItem:
  action: str
  name: str
  payload: dict[str, Any]
  task_id: str | None = None
  reason: str = ""
  warnings: tuple[str, ...] = ()


@dataclass(frozen=True)
class DailyHistoryVerification:
  status: str
  active_date: str
  expected: dict[str, dict[str, int]]
  observed: dict[str, dict[str, int]]
  comparisons: tuple[dict[str, Any], ...]

  @property
  def ok(self) -> bool:
    return self.status == "ok"


DAILY_HISTORY_TASK_SPECS = (
  ScheduledSqlTaskSpec(
    name="boss_daily_operator_chat_reply_stats",
    sql=CHAT_REPLY_SQL,
    metric_names=(
      "first_round_candidate_initiated_count",
      "first_round_boss_replied_count",
      "first_round_boss_reply_elapsed_median_ms",
      "first_round_boss_reply_elapsed_avg_ms",
      "chat_conversation_count",
      "boss_ended_conversation_count",
      "boss_reply_count",
      "boss_reply_elapsed_median_ms",
      "boss_reply_elapsed_avg_ms",
    ),
  ),
  ScheduledSqlTaskSpec(
    name="boss_daily_operator_wechat_marker_stats",
    sql=WECHAT_MARKER_SQL,
    metric_names=("wechat_captured", "wechat_unique_candidates"),
  ),
)


def build_create_payload(
  spec: ScheduledSqlTaskSpec,
  *,
  src_topic_id: str,
  dst_topic_id: str,
  region: str,
  process_start_time_ms: int,
  process_time_window: str = DEFAULT_PROCESS_WINDOW,
  process_period_minutes: int = DEFAULT_PROCESS_PERIOD_MINUTES,
  process_delay_seconds: int = DEFAULT_PROCESS_DELAY_SECONDS,
  enable_flag: int = 1,
  process_type: int = 1,
  process_end_time_ms: int | None = None,
  syntax_rule: int = 0,
) -> dict[str, Any]:
  payload: dict[str, Any] = {
    "SrcTopicId": src_topic_id,
    "Name": spec.name,
    "EnableFlag": enable_flag,
    "DstResource": _dst_resource(spec, dst_topic_id=dst_topic_id, region=region),
    "ScheduledSqlContent": spec.sql,
    "ProcessStartTime": int(process_start_time_ms),
    "ProcessType": int(process_type),
    "ProcessPeriod": int(process_period_minutes),
    "ProcessTimeWindow": process_time_window,
    "ProcessDelay": int(process_delay_seconds),
    "SrcTopicRegion": region,
    "SyntaxRule": int(syntax_rule),
  }
  if process_end_time_ms is not None:
    payload["ProcessEndTime"] = int(process_end_time_ms)
  return payload


def build_modify_payload(
  spec: ScheduledSqlTaskSpec,
  *,
  task_id: str,
  src_topic_id: str,
  dst_topic_id: str,
  region: str,
  process_time_window: str = DEFAULT_PROCESS_WINDOW,
  process_period_minutes: int = DEFAULT_PROCESS_PERIOD_MINUTES,
  process_delay_seconds: int = DEFAULT_PROCESS_DELAY_SECONDS,
  enable_flag: int = 1,
  syntax_rule: int = 0,
) -> dict[str, Any]:
  return {
    "TaskId": task_id,
    "SrcTopicId": src_topic_id,
    "Name": spec.name,
    "EnableFlag": enable_flag,
    "DstResource": _dst_resource(spec, dst_topic_id=dst_topic_id, region=region),
    "ScheduledSqlContent": spec.sql,
    "ProcessPeriod": int(process_period_minutes),
    "ProcessTimeWindow": process_time_window,
    "ProcessDelay": int(process_delay_seconds),
    "SrcTopicRegion": region,
    "SyntaxRule": int(syntax_rule),
  }


def build_backfill_payloads(
  specs: Iterable[ScheduledSqlTaskSpec],
  *,
  active_date: date,
  src_topic_id: str,
  dst_topic_id: str,
  region: str,
  timezone_name: str = DEFAULT_TIMEZONE_NAME,
  process_window: str = DEFAULT_BACKFILL_PROCESS_WINDOW,
  process_period_minutes: int = DEFAULT_PROCESS_PERIOD_MINUTES,
  process_delay_seconds: int = DEFAULT_PROCESS_DELAY_SECONDS,
  process_duration_minutes: int = 10,
) -> tuple[ScheduledSqlPlanItem, ...]:
  start_at, end_at = _backfill_process_window(
    active_date,
    timezone_name=timezone_name,
    duration_minutes=process_duration_minutes,
  )
  suffix = active_date.strftime("%Y%m%d")
  items: list[ScheduledSqlPlanItem] = []
  for spec in specs:
    backfill_spec = spec.with_name(f"{spec.name}_backfill_{suffix}")
    items.append(ScheduledSqlPlanItem(
      action="create",
      name=backfill_spec.name,
      payload=build_create_payload(
        backfill_spec,
        src_topic_id=src_topic_id,
        dst_topic_id=dst_topic_id,
        region=region,
        process_start_time_ms=int(start_at.timestamp() * 1000),
        process_end_time_ms=int(end_at.timestamp() * 1000),
        process_time_window=process_window,
        process_period_minutes=process_period_minutes,
        process_delay_seconds=process_delay_seconds,
        process_type=2,
      ),
      reason=f"backfill active_date={active_date.isoformat()}",
      warnings=metric_topic_process_window_warnings(process_window),
    ))
  return tuple(items)


def plan_task_changes(
  specs: Iterable[ScheduledSqlTaskSpec],
  existing_tasks: Iterable[Mapping[str, Any]],
  *,
  src_topic_id: str,
  dst_topic_id: str,
  region: str,
  process_start_time_ms: int,
  process_time_window: str = DEFAULT_PROCESS_WINDOW,
  process_period_minutes: int = DEFAULT_PROCESS_PERIOD_MINUTES,
  process_delay_seconds: int = DEFAULT_PROCESS_DELAY_SECONDS,
) -> tuple[ScheduledSqlPlanItem, ...]:
  existing_by_name = {
    str(task.get("Name")): task
    for task in existing_tasks
    if task.get("Name")
  }
  items: list[ScheduledSqlPlanItem] = []
  for spec in specs:
    existing = existing_by_name.get(spec.name)
    if existing is None:
      items.append(ScheduledSqlPlanItem(
        action="create",
        name=spec.name,
        payload=build_create_payload(
          spec,
          src_topic_id=src_topic_id,
          dst_topic_id=dst_topic_id,
          region=region,
          process_start_time_ms=process_start_time_ms,
          process_time_window=process_time_window,
          process_period_minutes=process_period_minutes,
          process_delay_seconds=process_delay_seconds,
        ),
        reason="task not found",
        warnings=metric_topic_process_window_warnings(process_time_window),
      ))
      continue
    task_id = _string(existing.get("TaskId"))
    if not task_id:
      items.append(ScheduledSqlPlanItem(
        action="create",
        name=spec.name,
        payload=build_create_payload(
          spec,
          src_topic_id=src_topic_id,
          dst_topic_id=dst_topic_id,
          region=region,
          process_start_time_ms=process_start_time_ms,
          process_time_window=process_time_window,
          process_period_minutes=process_period_minutes,
          process_delay_seconds=process_delay_seconds,
        ),
        reason="existing task missing TaskId",
        warnings=metric_topic_process_window_warnings(process_time_window),
      ))
      continue
    mismatch = task_mismatch_reasons(
      existing,
      spec,
      src_topic_id=src_topic_id,
      dst_topic_id=dst_topic_id,
      region=region,
      process_time_window=process_time_window,
      process_period_minutes=process_period_minutes,
      process_delay_seconds=process_delay_seconds,
    )
    if mismatch:
      items.append(ScheduledSqlPlanItem(
        action="modify",
        name=spec.name,
        task_id=task_id,
        payload=build_modify_payload(
          spec,
          task_id=task_id,
          src_topic_id=src_topic_id,
          dst_topic_id=dst_topic_id,
          region=region,
          process_time_window=process_time_window,
          process_period_minutes=process_period_minutes,
          process_delay_seconds=process_delay_seconds,
        ),
        reason=", ".join(mismatch),
        warnings=metric_topic_process_window_warnings(process_time_window),
      ))
      continue
    items.append(ScheduledSqlPlanItem(
      action="unchanged",
      name=spec.name,
      task_id=task_id,
      payload={},
      reason="task already matches",
      warnings=metric_topic_process_window_warnings(process_time_window),
    ))
  return tuple(items)


def task_mismatch_reasons(
  task: Mapping[str, Any],
  spec: ScheduledSqlTaskSpec,
  *,
  src_topic_id: str,
  dst_topic_id: str,
  region: str,
  process_time_window: str = DEFAULT_PROCESS_WINDOW,
  process_period_minutes: int = DEFAULT_PROCESS_PERIOD_MINUTES,
  process_delay_seconds: int = DEFAULT_PROCESS_DELAY_SECONDS,
) -> tuple[str, ...]:
  reasons: list[str] = []
  dst = task.get("DstResource") if isinstance(task.get("DstResource"), Mapping) else {}
  comparisons = (
    ("SrcTopicId", task.get("SrcTopicId"), src_topic_id),
    ("SrcTopicRegion", task.get("SrcTopicRegion"), region),
    ("ProcessTimeWindow", task.get("ProcessTimeWindow"), process_time_window),
    ("ProcessPeriod", _int_or_none(task.get("ProcessPeriod")), int(process_period_minutes)),
    ("ProcessDelay", _int_or_none(task.get("ProcessDelay")), int(process_delay_seconds)),
    ("EnableFlag", _int_or_none(task.get("EnableFlag")), 1),
    ("SyntaxRule", _int_or_none(task.get("SyntaxRule")), 0),
    ("DstResource.TopicId", dst.get("TopicId"), dst_topic_id),
    ("DstResource.Region", dst.get("Region"), region),
    ("DstResource.BizType", _int_or_none(dst.get("BizType")), 1),
  )
  for label, actual, expected in comparisons:
    if actual != expected:
      reasons.append(label)
  if _normalize_sql(_string(task.get("ScheduledSqlContent"))) != _normalize_sql(spec.sql):
    reasons.append("ScheduledSqlContent")
  if tuple(_list_strings(dst.get("MetricNames"))) != spec.metric_names:
    reasons.append("DstResource.MetricNames")
  if tuple(_list_strings(dst.get("MetricLabels"))) != spec.metric_labels:
    reasons.append("DstResource.MetricLabels")
  return tuple(reasons)


def describe_scheduled_sql_tasks(
  client: TencentCloudApiClient,
  *,
  region: str,
) -> tuple[dict[str, Any], ...]:
  response = client.call(
    "DescribeScheduledSqlInfo",
    {"Offset": 0, "Limit": 100},
    version=SCHEDULED_SQL_VERSION,
    region=region,
  )
  body = _response_body(response)
  _raise_tencent_error(body, "DescribeScheduledSqlInfo")
  tasks = body.get("ScheduledSqlTaskInfos") or []
  return tuple(dict(task) for task in tasks if isinstance(task, Mapping))


def resolve_topic_id_by_name(
  client: TencentCloudApiClient,
  *,
  region: str,
  topic_name: str,
) -> str | None:
  response = client.call(
    "DescribeTopics",
    {"Offset": 0, "Limit": 50},
    version=SCHEDULED_SQL_VERSION,
    region=region,
  )
  body = _response_body(response)
  _raise_tencent_error(body, "DescribeTopics")
  topics = body.get("Topics") or body.get("TopicSet") or []
  for topic in topics:
    if not isinstance(topic, Mapping):
      continue
    if topic.get("TopicName") == topic_name:
      return _string(topic.get("TopicId"))
  return None


def apply_plan_item(
  client: TencentCloudApiClient,
  item: ScheduledSqlPlanItem,
  *,
  region: str,
) -> dict[str, Any] | None:
  if item.action == "unchanged":
    return None
  action = "CreateScheduledSql" if item.action == "create" else "ModifyScheduledSql"
  response = client.call(
    action,
    item.payload,
    version=SCHEDULED_SQL_VERSION,
    region=region,
  )
  body = _response_body(response)
  _raise_tencent_error(body, action)
  return dict(body)


def plan_items_to_jsonable(items: Iterable[ScheduledSqlPlanItem]) -> list[dict[str, Any]]:
  return [
    {
      "action": item.action,
      "name": item.name,
      "task_id": item.task_id,
      "reason": item.reason,
      "warnings": list(item.warnings),
      "payload": item.payload,
    }
    for item in items
  ]


def metric_topic_process_window_warnings(process_time_window: str) -> tuple[str, ...]:
  normalized = process_time_window.replace(" ", "").lower()
  if "@d" in normalized or "interval1day" in normalized or "24h" in normalized:
    return (METRIC_TOPIC_WINDOW_WARNING,)
  return ()


def merge_task_output_rows(
  rows: Iterable[Mapping[str, Any]],
  *,
  fields: Iterable[str],
) -> dict[str, dict[str, int]]:
  allowed_fields = tuple(fields)
  by_operator: dict[str, dict[str, int]] = {}
  for row in rows:
    operator_id = _string(row.get("operator_id"))
    if not operator_id:
      continue
    values = by_operator.setdefault(operator_id, {})
    for field in allowed_fields:
      if field in row:
        values[field] = _int_value(row.get(field))
  return by_operator


def compare_daily_history_metric_values(
  expected: Mapping[str, Mapping[str, int]],
  observed: Mapping[str, Mapping[str, int]],
) -> DailyHistoryVerification:
  comparisons: list[dict[str, Any]] = []
  for operator_id in sorted(expected):
    expected_values = expected[operator_id]
    observed_values = observed.get(operator_id, {})
    for field in sorted(expected_values):
      expected_value = int(expected_values[field])
      actual_value = observed_values.get(field)
      status = "ok"
      if actual_value is None:
        status = "missing"
      elif int(actual_value) != expected_value:
        status = "mismatch"
      comparisons.append({
        "operator_id": operator_id,
        "field": field,
        "expected": expected_value,
        "observed": actual_value,
        "status": status,
      })
  status = "ok" if all(item["status"] == "ok" for item in comparisons) else "mismatch"
  return DailyHistoryVerification(
    status=status,
    active_date="",
    expected={operator: dict(values) for operator, values in expected.items()},
    observed={operator: dict(values) for operator, values in observed.items()},
    comparisons=tuple(comparisons),
  )


def verify_daily_history_output(
  *,
  active_date: date,
  src_topic_id: str,
  dst_topic_id: str,
  region: str,
  credentials: TencentCloudCredentials,
  timezone_name: str = DEFAULT_TIMEZONE_NAME,
  client: TencentCloudApiClient | None = None,
  now: datetime | None = None,
) -> DailyHistoryVerification:
  api_client = client or TencentCloudApiClient(credentials)
  start_at, end_at = _active_date_window(active_date, timezone_name=timezone_name)
  metric_start_at, metric_end_at = _active_date_metric_query_window(
    active_date,
    timezone_name=timezone_name,
    now=now,
  )
  raw_rows: list[dict[str, Any]] = []
  for spec in DAILY_HISTORY_TASK_SPECS:
    config = ClsSearchConfig(
      topic_id=src_topic_id,
      credentials=credentials,
      region=region,
      query=spec.sql,
      limit=1000,
      max_pages=1,
      sort="asc",
      timezone_name=timezone_name,
    )
    raw_rows.extend(search_cls_log_values(
      config,
      start_at=start_at,
      end_at=end_at,
      client=api_client,
    ))
  expected = merge_task_output_rows(raw_rows, fields=_all_metric_names())
  observed = _query_observed_metric_values(
    dst_topic_id=dst_topic_id,
    region=region,
    credentials=credentials,
    active_date=active_date,
    fields=_all_metric_names(),
    start_at=metric_start_at,
    end_at=metric_end_at,
    client=api_client,
  )
  result = compare_daily_history_metric_values(expected, observed)
  return DailyHistoryVerification(
    status=result.status,
    active_date=active_date.isoformat(),
    expected=result.expected,
    observed=result.observed,
    comparisons=result.comparisons,
  )


def verification_to_jsonable(result: DailyHistoryVerification) -> dict[str, Any]:
  return {
    "status": result.status,
    "active_date": result.active_date,
    "expected": result.expected,
    "observed": result.observed,
    "comparisons": list(result.comparisons),
  }


def build_permission_package(
  *,
  region: str,
  src_topic_id: str,
  dst_topic_id: str,
  process_time_window: str,
  process_period_minutes: int,
  backfill_active_date: date | None = None,
) -> dict[str, Any]:
  backfill_date_arg = (
    backfill_active_date.isoformat()
    if backfill_active_date is not None
    else "2026-06-01"
  )
  deploy_base = (
    "PYTHONPATH=src python3 -m boss_analysis.ops.daily_history_tasks "
    f"--process-period-minutes {int(process_period_minutes)} "
    f"--process-window {process_time_window}"
  )
  backfill_base = (
    "PYTHONPATH=src python3 -m boss_analysis.ops.daily_history_tasks "
    f"--backfill-active-date {backfill_date_arg}"
  )
  verify_command = (
    "PYTHONPATH=src python3 -m boss_analysis.ops.daily_history_tasks "
    f"--verify-active-date {backfill_date_arg}"
  )
  actions = tuple(dict.fromkeys((
    *DEPLOYMENT_IAM_ACTIONS,
    *VERIFICATION_IAM_ACTIONS,
  )))
  return {
    "purpose": "Deploy and verify daily history scheduled SQL tasks 6/7.",
    "resources": {
      "region": region,
      "source_raw_topic_id": src_topic_id,
      "destination_daily_basic_metric_topic_id": dst_topic_id,
      "source_topic_resource_hint": f"qcs::cls:{region}:uin/${{uin}}:topic/{src_topic_id}",
      "destination_topic_resource_hint": f"qcs::cls:{region}:uin/${{uin}}:topic/{dst_topic_id}",
    },
    "required_actions": {
      "deploy": list(DEPLOYMENT_IAM_ACTIONS),
      "local_verification": list(VERIFICATION_IAM_ACTIONS),
    },
    "cam_policy_template_wide_resource": {
      "version": "3.0",
      "statement": [
        {
          "effect": "allow",
          "action": list(actions),
          "resource": "*",
        },
      ],
    },
    "resource_scope_note": (
      "CLS scheduled SQL APIs support topic-level resource hints, but list/read "
      "APIs may still require resource='*'. If your CAM policy must be scoped, "
      "start with source_topic_resource_hint for scheduled SQL management and "
      "destination_topic_resource_hint for metric verification, then keep "
      "DescribeTopics on '*'."
    ),
    "commands": {
      "deploy_dry_run": f"{deploy_base} --skip-existing-check",
      "deploy_apply_after_confirmation": f"{deploy_base} --skip-existing-check --apply",
      "backfill_dry_run": backfill_base,
      "backfill_apply_after_confirmation": f"{backfill_base} --apply",
      "verify_after_write": verify_command,
    },
    "warnings": list(dict.fromkeys((
      *metric_topic_process_window_warnings(process_time_window),
      *metric_topic_process_window_warnings(DEFAULT_BACKFILL_PROCESS_WINDOW),
      "Do not run apply commands until cloud resource changes are explicitly confirmed.",
    ))),
  }


def preflight_daily_history(
  *,
  region: str,
  src_topic_id: str,
  dst_topic_id: str,
  credentials: TencentCloudCredentials,
  process_start_time_ms: int,
  process_time_window: str,
  process_period_minutes: int,
  process_delay_seconds: int,
  active_date: date | None = None,
  timezone_name: str = DEFAULT_TIMEZONE_NAME,
  client: TencentCloudApiClient | None = None,
) -> dict[str, Any]:
  api_client = client or TencentCloudApiClient(credentials)
  describe_status: dict[str, Any]
  existing: tuple[dict[str, Any], ...] = ()
  describe_ok = False
  try:
    existing = describe_scheduled_sql_tasks(api_client, region=region)
    describe_ok = True
    describe_status = {
      "status": "ok",
      "task_count": len(existing),
    }
  except RuntimeError as error:
    describe_status = {
      "status": "error",
      "error": str(error),
      "required_action": "cls:DescribeScheduledSqlInfo",
    }

  items = plan_task_changes(
    DAILY_HISTORY_TASK_SPECS,
    existing,
    src_topic_id=src_topic_id,
    dst_topic_id=dst_topic_id,
    region=region,
    process_start_time_ms=process_start_time_ms,
    process_time_window=process_time_window,
    process_period_minutes=process_period_minutes,
    process_delay_seconds=process_delay_seconds,
  )
  verification: dict[str, Any] | None = None
  verification_ok: bool | None = None
  if active_date is not None:
    try:
      result = verify_daily_history_output(
        active_date=active_date,
        src_topic_id=src_topic_id,
        dst_topic_id=dst_topic_id,
        region=region,
        credentials=credentials,
        timezone_name=timezone_name,
        client=api_client,
        now=datetime.now(timezone.utc),
      )
      verification = verification_to_jsonable(result)
      verification_ok = result.ok
    except RuntimeError as error:
      verification = {
        "status": "error",
        "active_date": active_date.isoformat(),
        "error": str(error),
      }
      verification_ok = False

  item_actions = {item.action for item in items}
  needs_apply = bool(item_actions.intersection({"create", "modify"}))
  if verification_ok is True and describe_ok and not needs_apply:
    status = "ok"
  elif not describe_ok:
    status = "permission_missing"
  elif needs_apply:
    status = "needs_apply"
  elif verification_ok is False:
    status = "needs_backfill_or_investigation"
  else:
    status = "ready_to_verify"

  permission_package = build_permission_package(
    region=region,
    src_topic_id=src_topic_id,
    dst_topic_id=dst_topic_id,
    process_time_window=process_time_window,
    process_period_minutes=process_period_minutes,
    backfill_active_date=active_date,
  )
  return {
    "status": status,
    "resources": permission_package["resources"],
    "scheduled_sql_describe": describe_status,
    "deployment_plan_assumption": None if describe_ok else "existing task state unknown; create plan is shown for review",
    "deployment_plan": plan_items_to_jsonable(items),
    "verification": verification,
    "commands": permission_package["commands"],
    "required_actions": permission_package["required_actions"],
    "warnings": permission_package["warnings"],
  }


def main(argv: list[str] | None = None) -> int:
  parser = argparse.ArgumentParser(description="Create or update daily history CLS scheduled SQL tasks.")
  parser.add_argument("--env-file", action="append", default=None)
  parser.add_argument("--region", default=None)
  parser.add_argument("--src-topic-id", default=None)
  parser.add_argument("--src-topic-name", default=DEFAULT_SRC_TOPIC_NAME)
  parser.add_argument("--dst-topic-id", default=None)
  parser.add_argument("--process-window", default=DEFAULT_PROCESS_WINDOW)
  parser.add_argument("--process-period-minutes", type=int, default=DEFAULT_PROCESS_PERIOD_MINUTES)
  parser.add_argument("--process-delay-seconds", type=int, default=DEFAULT_PROCESS_DELAY_SECONDS)
  parser.add_argument("--skip-existing-check", action="store_true", help="Print create payloads without calling DescribeScheduledSqlInfo.")
  parser.add_argument("--apply", action="store_true", help="Call CreateScheduledSql/ModifyScheduledSql. Without this flag, only prints the plan.")
  parser.add_argument("--verify-active-date", default=None, help="Read-only compare raw task SQL output with metric topic samples for YYYY-MM-DD.")
  parser.add_argument("--backfill-active-date", default=None, help="Create or print one-shot ProcessType=2 backfill payloads for YYYY-MM-DD.")
  parser.add_argument("--backfill-window", default=DEFAULT_BACKFILL_PROCESS_WINDOW)
  parser.add_argument("--backfill-duration-minutes", type=int, default=10)
  parser.add_argument("--print-iam-policy", action="store_true", help="Print the no-side-effect permission and execution package.")
  parser.add_argument("--preflight-active-date", default=None, help="Read-only deployment and verification preflight for YYYY-MM-DD.")
  args = parser.parse_args(argv)

  load_env_files(args.env_file)
  region = _resolve_region(args.region)
  credentials = _load_credentials()
  client = TencentCloudApiClient(credentials)
  src_topic_id = args.src_topic_id or os.environ.get("CLS_RAW_TOPIC_ID")
  if not src_topic_id:
    src_topic_id = resolve_topic_id_by_name(client, region=region, topic_name=args.src_topic_name)
  if not src_topic_id:
    raise SystemExit(f"Missing source topic id. Set CLS_RAW_TOPIC_ID or pass --src-topic-id.")
  dst_topic_id = args.dst_topic_id or os.environ.get("CLS_DAILY_BASIC_SUMMARY_TOPIC_ID")
  if not dst_topic_id:
    raise SystemExit("Missing destination topic id. Set CLS_DAILY_BASIC_SUMMARY_TOPIC_ID or pass --dst-topic-id.")

  if args.print_iam_policy:
    backfill_active_date = _parse_active_date(args.backfill_active_date) if args.backfill_active_date else None
    print(json.dumps(build_permission_package(
      region=region,
      src_topic_id=src_topic_id,
      dst_topic_id=dst_topic_id,
      process_time_window=args.process_window,
      process_period_minutes=args.process_period_minutes,
      backfill_active_date=backfill_active_date,
    ), ensure_ascii=False, indent=2))
    return 0

  if args.preflight_active_date:
    active_date = _parse_active_date(args.preflight_active_date)
    report = preflight_daily_history(
      region=region,
      src_topic_id=src_topic_id,
      dst_topic_id=dst_topic_id,
      credentials=credentials,
      process_start_time_ms=int(datetime.now(timezone.utc).timestamp() * 1000),
      process_time_window=args.process_window,
      process_period_minutes=args.process_period_minutes,
      process_delay_seconds=args.process_delay_seconds,
      active_date=active_date,
      timezone_name=os.environ.get("APP_TIMEZONE") or DEFAULT_TIMEZONE_NAME,
      client=client,
    )
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0 if report["status"] == "ok" else 1

  if args.verify_active_date:
    active_date = _parse_active_date(args.verify_active_date)
    result = verify_daily_history_output(
      active_date=active_date,
      src_topic_id=src_topic_id,
      dst_topic_id=dst_topic_id,
      region=region,
      credentials=credentials,
      timezone_name=os.environ.get("APP_TIMEZONE") or DEFAULT_TIMEZONE_NAME,
      client=client,
    )
    print(json.dumps(verification_to_jsonable(result), ensure_ascii=False, indent=2))
    return 0 if result.ok else 1

  if args.backfill_active_date:
    active_date = _parse_active_date(args.backfill_active_date)
    items = build_backfill_payloads(
      DAILY_HISTORY_TASK_SPECS,
      active_date=active_date,
      src_topic_id=src_topic_id,
      dst_topic_id=dst_topic_id,
      region=region,
      timezone_name=os.environ.get("APP_TIMEZONE") or DEFAULT_TIMEZONE_NAME,
      process_window=args.backfill_window,
      process_period_minutes=args.process_period_minutes,
      process_delay_seconds=args.process_delay_seconds,
      process_duration_minutes=args.backfill_duration_minutes,
    )
    print(json.dumps(plan_items_to_jsonable(items), ensure_ascii=False, indent=2))
    if not args.apply:
      return 0
    results = []
    for item in items:
      result = apply_plan_item(client, item, region=region)
      if result is not None:
        results.append({"name": item.name, "action": item.action, "result": result})
    print(json.dumps(results, ensure_ascii=False, indent=2))
    return 0

  process_start_time_ms = int(datetime.now(timezone.utc).timestamp() * 1000)
  existing: tuple[dict[str, Any], ...] = ()
  if not args.skip_existing_check:
    try:
      existing = describe_scheduled_sql_tasks(client, region=region)
    except RuntimeError as error:
      if args.apply:
        raise
      print(f"Cannot describe scheduled SQL tasks: {error}", file=sys.stderr)
      print("Falling back to create-payload dry run. Pass --skip-existing-check to silence this.", file=sys.stderr)
      return _print_create_payloads(
        src_topic_id=src_topic_id,
        dst_topic_id=dst_topic_id,
        region=region,
        process_start_time_ms=process_start_time_ms,
        process_time_window=args.process_window,
        process_period_minutes=args.process_period_minutes,
        process_delay_seconds=args.process_delay_seconds,
      )

  items = plan_task_changes(
    DAILY_HISTORY_TASK_SPECS,
    existing,
    src_topic_id=src_topic_id,
    dst_topic_id=dst_topic_id,
    region=region,
    process_start_time_ms=process_start_time_ms,
    process_time_window=args.process_window,
    process_period_minutes=args.process_period_minutes,
    process_delay_seconds=args.process_delay_seconds,
  )
  print(json.dumps(plan_items_to_jsonable(items), ensure_ascii=False, indent=2))
  if not args.apply:
    return 0
  results = []
  for item in items:
    result = apply_plan_item(client, item, region=region)
    if result is not None:
      results.append({"name": item.name, "action": item.action, "result": result})
  print(json.dumps(results, ensure_ascii=False, indent=2))
  return 0


def _print_create_payloads(
  *,
  src_topic_id: str,
  dst_topic_id: str,
  region: str,
  process_start_time_ms: int,
  process_time_window: str,
  process_period_minutes: int,
  process_delay_seconds: int,
) -> int:
  items = [
    ScheduledSqlPlanItem(
      action="create",
      name=spec.name,
      payload=build_create_payload(
        spec,
        src_topic_id=src_topic_id,
        dst_topic_id=dst_topic_id,
        region=region,
        process_start_time_ms=process_start_time_ms,
        process_time_window=process_time_window,
        process_period_minutes=process_period_minutes,
        process_delay_seconds=process_delay_seconds,
      ),
      reason="existing task check skipped or unavailable",
      warnings=metric_topic_process_window_warnings(process_time_window),
    )
    for spec in DAILY_HISTORY_TASK_SPECS
  ]
  print(json.dumps(plan_items_to_jsonable(items), ensure_ascii=False, indent=2))
  return 0


def _dst_resource(
  spec: ScheduledSqlTaskSpec,
  *,
  dst_topic_id: str,
  region: str,
) -> dict[str, Any]:
  return {
    "TopicId": dst_topic_id,
    "Region": region,
    "BizType": 1,
    "MetricNames": list(spec.metric_names),
    "MetricLabels": list(spec.metric_labels),
  }


def _resolve_region(explicit: str | None) -> str:
  return (
    explicit
    or os.environ.get("CLS_DAILY_BASIC_SUMMARY_REGION")
    or os.environ.get("CLS_SUMMARY_REGION")
    or DEFAULT_REGION
  )


def _query_observed_metric_values(
  *,
  dst_topic_id: str,
  region: str,
  credentials: TencentCloudCredentials,
  active_date: date,
  fields: Iterable[str],
  start_at: datetime,
  end_at: datetime,
  client: TencentCloudApiClient,
) -> dict[str, dict[str, int]]:
  config = load_cls_daily_basic_summary_search_config({
    "CLS_DAILY_BASIC_SUMMARY_TOPIC_ID": dst_topic_id,
    "CLS_DAILY_BASIC_SUMMARY_REGION": region,
    "TENCENTCLOUD_SECRET_ID": credentials.secret_id,
    "TENCENTCLOUD_SECRET_KEY": credentials.secret_key,
    **({"TENCENTCLOUD_TOKEN": credentials.token} if credentials.token else {}),
  })
  observed: dict[str, dict[str, int]] = {}
  for field in fields:
    query = (
      f'{{__name__="{field}",'
      f'metric_name="boss_daily_operator_basic_stats",'
      f'active_date="{active_date.isoformat()}"}}'
    )
    for series in query_cls_metric_range(
      config,
      query=query,
      start_at=start_at,
      end_at=end_at,
      step_seconds=60,
      client=client,
    ):
      labels = series.get("metric")
      if not isinstance(labels, Mapping):
        continue
      operator_id = _string(labels.get("operator_id"))
      if not operator_id:
        continue
      sample = _latest_sample_value(series.get("values"))
      if sample is None:
        continue
      observed.setdefault(operator_id, {})[field] = sample
  return observed


def _latest_sample_value(values: Any) -> int | None:
  if not isinstance(values, list) or not values:
    return None
  latest = values[-1]
  if not isinstance(latest, list) or len(latest) < 2:
    return None
  return _int_value(latest[1])


def _all_metric_names() -> tuple[str, ...]:
  names: list[str] = []
  for spec in DAILY_HISTORY_TASK_SPECS:
    names.extend(spec.metric_names)
  return tuple(dict.fromkeys(names))


def _active_date_window(value: date, *, timezone_name: str) -> tuple[datetime, datetime]:
  try:
    local_tz = ZoneInfo(timezone_name)
  except ZoneInfoNotFoundError:
    local_tz = timezone.utc
  start_at = datetime(value.year, value.month, value.day, tzinfo=local_tz)
  return start_at, start_at + timedelta(days=1)


def _active_date_metric_query_window(
  value: date,
  *,
  timezone_name: str,
  now: datetime | None = None,
) -> tuple[datetime, datetime]:
  start_at, _ = _active_date_window(value, timezone_name=timezone_name)
  max_end_at = start_at + timedelta(days=3)
  end_at = now or datetime.now(timezone.utc)
  if end_at.tzinfo is None:
    end_at = end_at.replace(tzinfo=timezone.utc)
  if end_at <= start_at:
    return start_at, max_end_at
  return start_at, min(end_at.astimezone(start_at.tzinfo), max_end_at)


def _backfill_process_window(
  value: date,
  *,
  timezone_name: str,
  duration_minutes: int,
) -> tuple[datetime, datetime]:
  try:
    local_tz = ZoneInfo(timezone_name)
  except ZoneInfoNotFoundError:
    local_tz = timezone.utc
  start_at = datetime(value.year, value.month, value.day, 0, 5, tzinfo=local_tz) + timedelta(days=1)
  safe_duration = max(1, int(duration_minutes))
  return start_at, start_at + timedelta(minutes=safe_duration)


def _parse_active_date(value: str) -> date:
  try:
    return date.fromisoformat(value)
  except ValueError as error:
    raise SystemExit(f"Invalid --verify-active-date value: {value}") from error


def _load_credentials() -> TencentCloudCredentials:
  secret_id = os.environ.get("TENCENTCLOUD_SECRET_ID")
  secret_key = os.environ.get("TENCENTCLOUD_SECRET_KEY")
  if not secret_id or not secret_key:
    raise SystemExit("Missing TENCENTCLOUD_SECRET_ID or TENCENTCLOUD_SECRET_KEY.")
  return TencentCloudCredentials(
    secret_id=secret_id,
    secret_key=secret_key,
    token=os.environ.get("TENCENTCLOUD_TOKEN"),
  )


def _response_body(response: Mapping[str, Any]) -> Mapping[str, Any]:
  body = response.get("Response", response)
  return body if isinstance(body, Mapping) else {}


def _raise_tencent_error(body: Mapping[str, Any], action: str) -> None:
  error = body.get("Error")
  if isinstance(error, Mapping):
    code = error.get("Code") or "Unknown"
    message = error.get("Message") or f"{action} failed"
    raise RuntimeError(f"{action} failed: {code}: {message}")


def _normalize_sql(value: str) -> str:
  return "\n".join(line.rstrip() for line in value.strip().replace("\r\n", "\n").splitlines())


def _list_strings(value: Any) -> tuple[str, ...]:
  if not isinstance(value, list):
    return ()
  return tuple(str(item) for item in value)


def _string(value: Any) -> str:
  return value.strip() if isinstance(value, str) else ""


def _int_or_none(value: Any) -> int | None:
  if isinstance(value, bool):
    return int(value)
  if isinstance(value, int):
    return value
  if isinstance(value, str) and value.strip():
    try:
      return int(value)
    except ValueError:
      return None
  return None


def _int_value(value: Any) -> int:
  if isinstance(value, bool):
    return int(value)
  if isinstance(value, int):
    return value
  if isinstance(value, float):
    return int(value)
  if isinstance(value, str) and value.strip():
    try:
      return int(float(value))
    except ValueError:
      return 0
  return 0


if __name__ == "__main__":
  raise SystemExit(main())
