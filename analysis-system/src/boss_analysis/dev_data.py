"""Seed data for the local development dashboard."""

from __future__ import annotations

import json
import os
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable

from boss_analysis.consumer import (
  IngestionPipeline,
  iter_daily_active_durations_from_file,
  iter_daily_active_durations_from_search,
  iter_daily_basic_summaries_from_file,
  iter_daily_basic_summaries_from_metric_topic,
  iter_daily_basic_summaries_from_search,
  iter_log_quality_summaries_from_file,
  iter_log_quality_summaries_from_search,
  iter_minute_summaries_from_file,
  iter_minute_summaries_from_search,
  load_cls_daily_basic_summary_search_config,
  load_cls_daily_summary_search_config,
  load_cls_log_quality_search_config,
  load_cls_summary_search_config,
)
from boss_analysis.domain import (
  DailyActiveDurationRecord,
  DailyBasicStatsRecord,
  LogQualitySummaryRecord,
  MinuteSummaryRecord,
)
from boss_analysis.storage import InMemoryFactStore, InMemoryRawEventRepository


@dataclass(frozen=True)
class DevDataSourceInfo:
  """Describes the data loaded into the local dev app."""

  kind: str
  label: str
  detail: str | None
  record_count: int
  loaded_at: datetime


@dataclass(frozen=True)
class DevDataset:
  """In-memory dev repositories with source metadata."""

  raw_repository: InMemoryRawEventRepository
  fact_store: InMemoryFactStore
  minute_summaries: tuple[MinuteSummaryRecord, ...]
  daily_active_durations: tuple[DailyActiveDurationRecord, ...]
  daily_basic_summaries: tuple[DailyBasicStatsRecord, ...]
  log_quality_summaries: tuple[LogQualitySummaryRecord, ...]
  generated_at: datetime
  source: DevDataSourceInfo
  summary_source: DevDataSourceInfo | None = None
  daily_summary_source: DevDataSourceInfo | None = None
  daily_basic_summary_source: DevDataSourceInfo | None = None
  log_quality_source: DevDataSourceInfo | None = None


def create_dev_state(
  *,
  now: datetime | None = None,
  data_file: str | Path | None = None,
  data_source: str | None = None,
  use_demo_fallback: bool = True,
):
  """Create in-memory repositories from a real data file or demo events."""

  dataset = create_dev_dataset(
    now=now,
    data_file=data_file,
    data_source=data_source,
    use_demo_fallback=use_demo_fallback,
  )
  return dataset.raw_repository, dataset.fact_store, dataset.generated_at


def create_dev_dataset(
  *,
  now: datetime | None = None,
  data_file: str | Path | None = None,
  data_source: str | None = None,
  use_demo_fallback: bool = True,
  cls_client: Any | None = None,
  summary_cls_client: Any | None = None,
  daily_summary_cls_client: Any | None = None,
  daily_basic_summary_cls_client: Any | None = None,
  log_quality_cls_client: Any | None = None,
  include_daily_basic_summaries: bool = True,
) -> DevDataset:
  """Create local dev repositories and record where data came from."""

  generated_at = now or datetime.now(timezone.utc)
  raw_repository = InMemoryRawEventRepository()
  fact_store = InMemoryFactStore()
  pipeline = IngestionPipeline(raw_repository, fact_store)
  records, source = _load_records(
    generated_at,
    data_file=data_file,
    data_source=data_source,
    use_demo_fallback=use_demo_fallback,
    cls_client=cls_client,
  )
  minute_summaries, summary_source = _load_minute_summaries(
    generated_at,
    data_file=data_file,
    data_source=data_source,
    summary_cls_client=summary_cls_client,
  )
  daily_active_durations, daily_summary_source = _load_daily_active_durations(
    generated_at,
    data_file=data_file,
    data_source=data_source,
    daily_summary_cls_client=daily_summary_cls_client,
  )
  daily_basic_summaries, daily_basic_summary_source = _load_daily_basic_summaries(
    generated_at,
    data_file=data_file,
    data_source=data_source,
    daily_basic_summary_cls_client=daily_basic_summary_cls_client,
    load_records=include_daily_basic_summaries,
  )
  log_quality_summaries, log_quality_source = _load_log_quality_summaries(
    generated_at,
    data_file=data_file,
    data_source=data_source,
    log_quality_cls_client=log_quality_cls_client,
  )
  if (
    _summary_source_required(data_source=data_source, data_file=data_file)
    and summary_source is None
    and daily_summary_source is None
    and daily_basic_summary_source is None
    and log_quality_source is None
  ):
    raise ValueError(
      "data source 'summary' requires BOSS_ANALYSIS_SUMMARY_DATA_FILE, "
      "CLS_SUMMARY_TOPIC_ID, BOSS_ANALYSIS_DAILY_SUMMARY_DATA_FILE, "
      "CLS_DAILY_SUMMARY_TOPIC_ID, BOSS_ANALYSIS_DAILY_BASIC_SUMMARY_DATA_FILE, "
      "CLS_DAILY_BASIC_SUMMARY_TOPIC_ID, BOSS_ANALYSIS_LOG_QUALITY_DATA_FILE, "
      "or CLS_LOG_QUALITY_TOPIC_ID"
    )

  for record in records:
    pipeline.ingest_cls_record(record, received_at=generated_at)

  return DevDataset(
    raw_repository=raw_repository,
    fact_store=fact_store,
    minute_summaries=tuple(minute_summaries),
    daily_active_durations=tuple(daily_active_durations),
    daily_basic_summaries=tuple(daily_basic_summaries),
    log_quality_summaries=tuple(log_quality_summaries),
    generated_at=generated_at,
    source=source,
    summary_source=summary_source,
    daily_summary_source=daily_summary_source,
    daily_basic_summary_source=daily_basic_summary_source,
    log_quality_source=log_quality_source,
  )


def iter_cls_records_from_file(path: str | Path) -> Iterable[dict[str, Any]]:
  """Yield flattened CLS records from JSON, JSONL, or plugin event exports."""

  data_path = Path(path)
  text = data_path.read_text(encoding="utf-8").strip()
  if not text:
    return
  if data_path.suffix.lower() in {".jsonl", ".ndjson"}:
    for line in text.splitlines():
      stripped = line.strip()
      if stripped:
        yield from _records_from_json_value(json.loads(stripped))
    return
  yield from _records_from_json_value(json.loads(text))


def iter_cls_records_from_search(*, now: datetime | None = None, client: Any | None = None) -> Iterable[dict[str, Any]]:
  """Fail closed for the removed raw CLS SearchLog data source."""

  _ = now, client
  raise RuntimeError("raw CLS SearchLog data source is disabled; use summary data instead")


def iter_summary_records_from_search(
  *,
  now: datetime | None = None,
  client: Any | None = None,
) -> Iterable[MinuteSummaryRecord]:
  """Yield normalized minute summaries from the configured summary topic."""

  yield from iter_minute_summaries_from_search(now=now, client=client)


def iter_daily_summary_records_from_search(
  *,
  now: datetime | None = None,
  client: Any | None = None,
) -> Iterable[DailyActiveDurationRecord]:
  """Yield normalized daily active-duration metrics from the configured daily summary topic."""

  yield from iter_daily_active_durations_from_search(now=now, client=client)


def iter_daily_basic_summary_records_from_search(
  *,
  now: datetime | None = None,
  client: Any | None = None,
) -> Iterable[DailyBasicStatsRecord]:
  """Yield daily basic statistics from the configured CLS daily-basic topic."""

  yield from _iter_daily_basic_summaries_from_configured_topic(
    now=now,
    client=client,
    reader_mode=_daily_basic_summary_reader_mode(),
  )


def iter_log_quality_records_from_search(
  *,
  now: datetime | None = None,
  client: Any | None = None,
) -> Iterable[LogQualitySummaryRecord]:
  """Yield normalized 10-minute log-quality metrics from the configured health summary topic."""

  yield from iter_log_quality_summaries_from_search(now=now, client=client)


def _load_records(
  generated_at: datetime,
  *,
  data_file: str | Path | None,
  data_source: str | None,
  use_demo_fallback: bool,
  cls_client: Any | None,
) -> tuple[list[dict[str, Any]], DevDataSourceInfo]:
  requested_source = _normalize_data_source(data_source or os.environ.get("BOSS_ANALYSIS_DATA_SOURCE"))
  resolved_data_file = data_file or os.environ.get("BOSS_ANALYSIS_DEV_DATA_FILE")

  if requested_source == "real":
    requested_source = "file" if resolved_data_file else "summary"
  if requested_source == "auto":
    if resolved_data_file:
      requested_source = "file"
    elif _has_any_summary_source_configured():
      requested_source = "summary"

  if requested_source == "empty":
    return [], _source_info("empty", "空数据", None, 0, generated_at)

  if requested_source == "summary":
    return [], _source_info(
      "summary",
      "CLS 分钟汇总",
      None,
      0,
      generated_at,
    )

  if requested_source == "demo":
    records = _demo_records(generated_at)
    return records, _source_info("demo", "演示数据", None, len(records), generated_at)

  if requested_source == "file":
    if not resolved_data_file:
      raise ValueError("data source 'file' requires --data-file or BOSS_ANALYSIS_DEV_DATA_FILE")
    records = list(iter_cls_records_from_file(resolved_data_file))
    return records, _source_info(
      "real_file",
      "真实数据文件",
      str(Path(resolved_data_file)),
      len(records),
      generated_at,
    )

  if use_demo_fallback:
    records = _demo_records(generated_at)
    return records, _source_info("demo", "演示数据", None, len(records), generated_at)

  return [], _source_info("empty", "空数据", None, 0, generated_at)


def _load_minute_summaries(
  generated_at: datetime,
  *,
  data_file: str | Path | None,
  data_source: str | None,
  summary_cls_client: Any | None,
) -> tuple[list[MinuteSummaryRecord], DevDataSourceInfo | None]:
  resolved_data_file = data_file or os.environ.get("BOSS_ANALYSIS_DEV_DATA_FILE")
  requested_source = _normalize_data_source(data_source or os.environ.get("BOSS_ANALYSIS_DATA_SOURCE"))
  if requested_source == "real":
    requested_source = "file" if resolved_data_file else "summary"
  if requested_source == "auto":
    if resolved_data_file:
      requested_source = "file"
    else:
      requested_source = "summary" if _has_any_summary_source_configured() else "demo"
  if requested_source != "summary":
    return [], None

  summary_file = os.environ.get("BOSS_ANALYSIS_SUMMARY_DATA_FILE")
  if summary_file:
    records = list(iter_minute_summaries_from_file(summary_file))
    return records, _source_info(
      "summary_file",
      "分钟汇总文件",
      str(Path(summary_file)),
      len(records),
      generated_at,
    )

  if not os.environ.get("CLS_SUMMARY_TOPIC_ID"):
    return [], None
  config = load_cls_summary_search_config()
  records = list(iter_minute_summaries_from_search(now=generated_at, client=summary_cls_client))
  detail = (
    f"{config.endpoint} topic={config.topic_id} "
    f"query={config.query} window={config.window_label}"
  )
  return records, _source_info("summary_topic", "CLS 分钟汇总", detail, len(records), generated_at)


def _load_daily_active_durations(
  generated_at: datetime,
  *,
  data_file: str | Path | None,
  data_source: str | None,
  daily_summary_cls_client: Any | None,
) -> tuple[list[DailyActiveDurationRecord], DevDataSourceInfo | None]:
  resolved_data_file = data_file or os.environ.get("BOSS_ANALYSIS_DEV_DATA_FILE")
  requested_source = _normalize_data_source(data_source or os.environ.get("BOSS_ANALYSIS_DATA_SOURCE"))
  if requested_source == "real":
    requested_source = "file" if resolved_data_file else "summary"
  if requested_source == "auto":
    if resolved_data_file:
      requested_source = "file"
    else:
      requested_source = "summary" if _has_daily_summary_source_configured() else "demo"
  if requested_source != "summary":
    return [], None

  daily_file = os.environ.get("BOSS_ANALYSIS_DAILY_SUMMARY_DATA_FILE")
  if daily_file:
    records = list(iter_daily_active_durations_from_file(daily_file))
    return records, _source_info(
      "daily_summary_file",
      "日级指标文件",
      str(Path(daily_file)),
      len(records),
      generated_at,
    )

  if not os.environ.get("CLS_DAILY_SUMMARY_TOPIC_ID"):
    return [], None
  config = load_cls_daily_summary_search_config()
  records = list(iter_daily_active_durations_from_search(now=generated_at, client=daily_summary_cls_client))
  detail = (
    f"{config.endpoint} topic={config.topic_id} "
    f"query={config.query} window={config.window_label}"
  )
  return records, _source_info("daily_summary_topic", "CLS 日级指标", detail, len(records), generated_at)


def _load_daily_basic_summaries(
  generated_at: datetime,
  *,
  data_file: str | Path | None,
  data_source: str | None,
  daily_basic_summary_cls_client: Any | None,
  load_records: bool = True,
) -> tuple[list[DailyBasicStatsRecord], DevDataSourceInfo | None]:
  resolved_data_file = data_file or os.environ.get("BOSS_ANALYSIS_DEV_DATA_FILE")
  requested_source = _normalize_data_source(data_source or os.environ.get("BOSS_ANALYSIS_DATA_SOURCE"))
  if requested_source == "real":
    requested_source = "file" if resolved_data_file else "summary"
  if requested_source == "auto":
    if resolved_data_file:
      requested_source = "file"
    else:
      requested_source = "summary" if _has_daily_basic_summary_source_configured() else "demo"
  if requested_source != "summary":
    return [], None

  daily_basic_file = os.environ.get("BOSS_ANALYSIS_DAILY_BASIC_SUMMARY_DATA_FILE")
  if daily_basic_file:
    records = list(iter_daily_basic_summaries_from_file(daily_basic_file)) if load_records else []
    return records, _source_info(
      "daily_basic_summary_file",
      "日级基础指标文件",
      str(Path(daily_basic_file)),
      len(records),
      generated_at,
    )

  if not os.environ.get("CLS_DAILY_BASIC_SUMMARY_TOPIC_ID"):
    return [], None
  config = load_cls_daily_basic_summary_search_config()
  reader_mode = _daily_basic_summary_reader_mode()
  records = (
    list(_iter_daily_basic_summaries_from_configured_topic(
      now=generated_at,
      client=daily_basic_summary_cls_client,
      reader_mode=reader_mode,
    ))
    if load_records
    else []
  )
  detail = (
    f"{config.endpoint} topic={config.topic_id} "
    f"mode={reader_mode} query={config.query} window={config.window_label}"
  )
  label = "CLS 日级基础指标" if reader_mode == "metric" else "CLS 日级基础日志"
  return records, _source_info("daily_basic_summary_topic", label, detail, len(records), generated_at)


def _load_log_quality_summaries(
  generated_at: datetime,
  *,
  data_file: str | Path | None,
  data_source: str | None,
  log_quality_cls_client: Any | None,
) -> tuple[list[LogQualitySummaryRecord], DevDataSourceInfo | None]:
  resolved_data_file = data_file or os.environ.get("BOSS_ANALYSIS_DEV_DATA_FILE")
  requested_source = _normalize_data_source(data_source or os.environ.get("BOSS_ANALYSIS_DATA_SOURCE"))
  if requested_source == "real":
    requested_source = "file" if resolved_data_file else "summary"
  if requested_source == "auto":
    if resolved_data_file:
      requested_source = "file"
    else:
      requested_source = "summary" if _has_log_quality_source_configured() else "demo"
  if requested_source != "summary":
    return [], None

  log_quality_file = os.environ.get("BOSS_ANALYSIS_LOG_QUALITY_DATA_FILE")
  if log_quality_file:
    records = list(iter_log_quality_summaries_from_file(log_quality_file))
    return records, _source_info(
      "log_quality_file",
      "10 分钟质量文件",
      str(Path(log_quality_file)),
      len(records),
      generated_at,
    )

  if not os.environ.get("CLS_LOG_QUALITY_TOPIC_ID"):
    return [], None
  config = load_cls_log_quality_search_config()
  records = list(iter_log_quality_summaries_from_search(now=generated_at, client=log_quality_cls_client))
  detail = (
    f"{config.endpoint} topic={config.topic_id} "
    f"query={config.query} window={config.window_label}"
  )
  return records, _source_info("log_quality_topic", "CLS 10 分钟质量", detail, len(records), generated_at)


def _source_info(
  kind: str,
  label: str,
  detail: str | None,
  record_count: int,
  loaded_at: datetime,
) -> DevDataSourceInfo:
  return DevDataSourceInfo(
    kind=kind,
    label=label,
    detail=detail,
    record_count=record_count,
    loaded_at=loaded_at,
  )


def _normalize_data_source(value: str | None) -> str:
  normalized = (value or "auto").strip().lower().replace("_", "-")
  if normalized == "summary-only":
    return "summary"
  if normalized not in {"auto", "real", "demo", "file", "summary", "empty"}:
    raise ValueError(f"Unsupported data source: {value}")
  return normalized


def _summary_source_required(*, data_source: str | None, data_file: str | Path | None) -> bool:
  requested_source = _normalize_data_source(data_source or os.environ.get("BOSS_ANALYSIS_DATA_SOURCE"))
  resolved_data_file = data_file or os.environ.get("BOSS_ANALYSIS_DEV_DATA_FILE")
  if requested_source == "summary":
    return True
  if requested_source == "real" and not resolved_data_file:
    return True
  return False


def _has_any_summary_source_configured() -> bool:
  return (
    _has_minute_summary_source_configured()
    or _has_daily_summary_source_configured()
    or _has_daily_basic_summary_source_configured()
    or _has_log_quality_source_configured()
  )


def _has_minute_summary_source_configured() -> bool:
  return bool(os.environ.get("BOSS_ANALYSIS_SUMMARY_DATA_FILE") or os.environ.get("CLS_SUMMARY_TOPIC_ID"))


def _has_daily_summary_source_configured() -> bool:
  return bool(os.environ.get("BOSS_ANALYSIS_DAILY_SUMMARY_DATA_FILE") or os.environ.get("CLS_DAILY_SUMMARY_TOPIC_ID"))


def _has_daily_basic_summary_source_configured() -> bool:
  return bool(
    os.environ.get("BOSS_ANALYSIS_DAILY_BASIC_SUMMARY_DATA_FILE")
    or os.environ.get("CLS_DAILY_BASIC_SUMMARY_TOPIC_ID")
  )


def _has_log_quality_source_configured() -> bool:
  return bool(os.environ.get("BOSS_ANALYSIS_LOG_QUALITY_DATA_FILE") or os.environ.get("CLS_LOG_QUALITY_TOPIC_ID"))


def _iter_daily_basic_summaries_from_configured_topic(
  *,
  now: datetime | None,
  client: Any | None,
  reader_mode: str,
) -> Iterable[DailyBasicStatsRecord]:
  if reader_mode == "log":
    yield from iter_daily_basic_summaries_from_search(now=now, client=client)
    return
  yield from iter_daily_basic_summaries_from_metric_topic(now=now, client=client)


def _daily_basic_summary_reader_mode() -> str:
  raw = os.environ.get("CLS_DAILY_BASIC_SUMMARY_SOURCE") or os.environ.get("CLS_DAILY_BASIC_SUMMARY_MODE")
  value = (raw or "metric").strip().lower().replace("_", "-")
  if value in {"log", "logs", "search", "searchlog", "search-log"}:
    return "log"
  return "metric"


def _records_from_json_value(value: Any) -> Iterable[dict[str, Any]]:
  if isinstance(value, list):
    for item in value:
      yield from _records_from_json_value(item)
    return
  if not isinstance(value, dict):
    return
  if isinstance(value.get("events"), list):
    for event in value["events"]:
      yield from _records_from_json_value(event)
    return
  if isinstance(value.get("contents"), dict):
    yield _flatten_input_record(value["contents"])
    return
  if _looks_like_plugin_event(value):
    yield _flatten_plugin_event(value)
    return
  yield _flatten_input_record(value)


def _flatten_input_record(record: dict[str, Any]) -> dict[str, Any]:
  flattened = dict(record)
  payload = flattened.get("payload_json")
  context = flattened.get("context_json")
  if payload is not None and not isinstance(payload, str):
    flattened["payload_json"] = json.dumps(payload, ensure_ascii=False)
  if context is not None and not isinstance(context, str):
    flattened["context_json"] = json.dumps(context, ensure_ascii=False)
  return flattened


def _looks_like_plugin_event(record: dict[str, Any]) -> bool:
  return "id" in record and "type" in record and "occurredAt" in record


def _flatten_plugin_event(event: dict[str, Any]) -> dict[str, Any]:
  operator = event.get("operator") if isinstance(event.get("operator"), dict) else {}
  context = event.get("context") if isinstance(event.get("context"), dict) else {}
  job_context = context.get("jobContext") if isinstance(context.get("jobContext"), dict) else {}
  return {
    "event_id": event.get("id"),
    "event_type": event.get("type"),
    "occurred_at": event.get("occurredAt"),
    "plugin_version": event.get("pluginVersion"),
    "operator_id": operator.get("operatorId"),
    "operator_account_name": operator.get("accountName"),
    "boss_account_name": operator.get("bossAccountName"),
    "boss_account_matched": operator.get("bossAccountMatched"),
    "session_id": context.get("sessionId"),
    "page_type": context.get("pageType"),
    "page_url": context.get("pageUrl"),
    "page_title": context.get("pageTitle"),
    "job_id": job_context.get("jobId"),
    "job_status": job_context.get("jobStatus"),
    "source_tab_id": event.get("sourceTabId"),
    "source_window_id": event.get("sourceWindowId"),
    "source_tab_url": event.get("sourceTabUrl"),
    "payload_json": json.dumps(event.get("payload") or {}, ensure_ascii=False),
    "context_json": json.dumps(context, ensure_ascii=False),
  }


def _demo_records(generated_at: datetime) -> list[dict[str, Any]]:
  records: list[dict[str, Any]] = []
  for index, operator in enumerate(_DEMO_OPERATORS):
    operator_id = operator["operator_id"]
    job_id = operator["job_id"]
    candidate_key = f"geek_mock_{index + 1:02d}"
    base_minutes = index + 1
    greeting_click_event_id = f"evt_{operator_id}_greeting_click"
    message_count = 3 + index

    records.extend([
      _record(
        f"evt_{operator_id}_exposure",
        "candidate_list.card_exposed",
        _candidate_payload(candidate_key, card_index=index),
        operator_id=operator_id,
        occurred_at=_minutes_ago(generated_at, base_minutes + 5),
        job_id=job_id,
      ),
      _record(
        f"evt_{operator_id}_detail",
        "candidate_detail.opened",
        {
          "detailUrl": f"https://www.zhipin.com/web/chat/index?geekId={candidate_key}",
          "candidate": _candidate(candidate_key),
        },
        operator_id=operator_id,
        occurred_at=_minutes_ago(generated_at, base_minutes + 4),
        job_id=job_id,
      ),
      _record(
        greeting_click_event_id,
        "candidate_greeting.clicked",
        {"entry": "candidate_detail", "candidate": _candidate(candidate_key)},
        operator_id=operator_id,
        occurred_at=_minutes_ago(generated_at, base_minutes + 3),
        job_id=job_id,
      ),
      _record(
        f"evt_{operator_id}_greeting_success",
        "candidate_greeting.succeeded",
        {
          "clickedEventId": greeting_click_event_id,
          "elapsedMs": 700 + index * 80,
          "greeting": {"detectedBy": "page_message"},
          "candidate": _candidate(candidate_key),
        },
        operator_id=operator_id,
        occurred_at=_minutes_ago(generated_at, base_minutes + 2),
        job_id=job_id,
      ),
      _record(
        f"evt_{operator_id}_chat_opened",
        "candidate_chat.opened",
        {
          "candidate": _candidate(candidate_key),
          "chat": {
            "conversationKey": f"candidate_{candidate_key}",
            "messageCount": message_count,
          },
        },
        operator_id=operator_id,
        occurred_at=_minutes_ago(generated_at, base_minutes + 1),
        job_id=job_id,
      ),
      _record(
        f"evt_{operator_id}_chat_snapshot",
        "candidate_chat.snapshot_captured",
        {
          "candidate": _candidate(candidate_key),
          "chat": {
            "conversationKey": f"candidate_{candidate_key}",
            "messageCount": message_count + 1,
            "snapshotCompleteness": "visible_dom",
            "mayBeIncomplete": index % 3 == 0,
          },
        },
        operator_id=operator_id,
        occurred_at=_minutes_ago(generated_at, base_minutes),
        job_id=job_id,
      ),
    ])

    if operator["wechat_captured"]:
      records.append(_record(
        f"evt_{operator_id}_wechat",
        "candidate_chat.wechat_captured",
        {
          "candidate": _candidate(candidate_key),
          "wechat": {"accounts": ["redacted-in-facts"]},
        },
        operator_id=operator_id,
        occurred_at=_minutes_ago(generated_at, max(0, base_minutes - 1)),
        job_id=job_id,
      ))

  return records


_DEMO_OPERATORS = (
  {"operator_id": "zhouxinyu", "job_id": "job_live_ops", "wechat_captured": True},
  {"operator_id": "mock_liangchen", "job_id": "job_anchor", "wechat_captured": False},
  {"operator_id": "mock_suxiao", "job_id": "job_customer_success", "wechat_captured": False},
  {"operator_id": "mock_linran", "job_id": "job_growth", "wechat_captured": True},
  {"operator_id": "mock_qiaomu", "job_id": "job_sales", "wechat_captured": False},
  {"operator_id": "mock_yeyun", "job_id": "job_product_ops", "wechat_captured": False},
  {"operator_id": "mock_chenxi", "job_id": "job_data_analyst", "wechat_captured": True},
  {"operator_id": "mock_tangning", "job_id": "job_java_backend", "wechat_captured": False},
  {"operator_id": "mock_xiahe", "job_id": "job_frontend", "wechat_captured": False},
  {"operator_id": "mock_luyu", "job_id": "job_hrbp", "wechat_captured": True},
)


def _record(event_id, event_type, payload, *, operator_id, occurred_at, job_id):
  return {
    "event_id": event_id,
    "event_type": event_type,
    "occurred_at": occurred_at.isoformat(),
    "plugin_version": "0.1.0",
    "operator_id": operator_id,
    "operator_account_name": operator_id,
    "boss_account_name": operator_id,
    "boss_account_matched": "true",
    "session_id": f"sess_{operator_id}",
    "page_type": "candidate_recommend",
    "page_url": "https://www.zhipin.com/web/chat/recommend",
    "page_title": "candidate recommendations",
    "job_id": job_id,
    "job_status": "0",
    "source_tab_id": 1,
    "source_window_id": 1,
    "source_tab_url": "https://www.zhipin.com/web/chat/recommend",
    "payload_json": json.dumps(payload),
    "context_json": json.dumps({"sessionId": f"sess_{operator_id}"}),
  }


def _candidate_payload(stable_id, *, card_index):
  return {
    "listUrl": "https://www.zhipin.com/web/chat/recommend",
    "listPageType": "candidate_recommend",
    "candidate": _candidate(stable_id),
    "exposure": {"cardIndex": card_index},
  }


def _candidate(stable_id):
  return {
    "candidateId": f"candidate_{stable_id}",
    "stableId": stable_id,
    "stableIdSource": "url.geekId",
    "identityConfidence": "high",
    "profile": {
      "displayName": f"candidate-{stable_id}",
    },
  }


def _minutes_ago(now: datetime, minutes: int) -> datetime:
  return datetime.fromtimestamp(now.timestamp() - minutes * 60, tz=timezone.utc)
