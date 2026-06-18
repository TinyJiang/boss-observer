"""Generate offline daily-analysis result files.

This command is the only manual entry for producing files consumed by
``/api/daily-analysis``. The API remains read-only and never calls this module.
"""

from __future__ import annotations

import argparse
import json
import os
from collections.abc import Iterable, Mapping
from dataclasses import dataclass
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Any

from boss_analysis.dev_server import load_env_files
from boss_analysis.domain.operators import OperatorProfile
from boss_analysis.domain.summary import DailyBasicStatsRecord
from boss_analysis.domain.daily_analysis_materials import (
  build_historical_effects_14d,
  build_operation_details,
  build_operation_overview_14d,
)
from boss_analysis.feishu.bitable import FeishuBitableClient, default_table_ids
from boss_analysis.official_results.models import OfficialResultRow, OfficialResultsBatch, OfficialResultsSource
from boss_analysis.official_results.source import JsonOfficialResultsSource
from boss_analysis.official_results.sync import DEFAULT_TIMEZONE_NAME, resolve_sync_date
from boss_analysis.operator_config import OperatorConfigProvider
from boss_analysis.consumer.summary_reader import iter_daily_basic_summaries_from_file

DEFAULT_OUTPUT_DIR = "data/daily-analysis-results"
ANALYSIS_SOURCE = "offline_daily_analysis_generation"
LLM_STRATEGY_NAME = "daily_analysis_coaching_v1"
LLM_STRATEGY_VERSION = "2026-06-17"
LLM_STRATEGY_DOCUMENT = "docs/modules/09-daily-analysis-llm-strategy.md"
PENDING_LLM_ANALYZER = "pending_llm_analysis"

METRIC_FIELDS: tuple[tuple[str, str], ...] = (
  ("boss_view_candidates", "BOSS查看牛人"),
  ("boss_started_chats", "BOSS发起聊天"),
  ("boss_communication_count", "BOSS沟通"),
  ("candidate_view_boss", "牛人查看BOSS"),
  ("candidate_started_chats", "牛人发起聊天"),
  ("resume_received", "收获简历"),
  ("phone_wechat_exchanged", "交换电话微信"),
  ("interview_accepted", "接受面试"),
)


@dataclass(frozen=True)
class DailyAnalysisGenerationResult:
  target_date: date
  output_path: Path
  status: str
  operator_row_count: int
  job_row_count: int
  dry_run: bool
  payload: dict[str, Any]


class FeishuOfficialResultsSource:
  """Read mapped official results from the synced Feishu Bitable tables."""

  def __init__(
    self,
    *,
    feishu_client,
    operator_table_id: str,
    job_table_id: str,
  ) -> None:
    self._feishu_client = feishu_client
    self._operator_table_id = operator_table_id
    self._job_table_id = job_table_id

  def fetch(self, target_date: date) -> OfficialResultsBatch:
    operator_records = self._records_for_date(
      self._feishu_client.table(self._operator_table_id).list_records(),
      target_date,
    )
    job_records = self._records_for_date(
      self._feishu_client.table(self._job_table_id).list_records(),
      target_date,
    )
    return OfficialResultsBatch(
      target_date=target_date,
      operator_rows=tuple(_row_from_feishu_fields(fields, target_date) for fields in operator_records),
      job_rows=tuple(_row_from_feishu_fields(fields, target_date) for fields in job_records),
    )

  def _records_for_date(
    self,
    records: list[dict[str, Any]],
    target_date: date,
  ) -> tuple[Mapping[str, Any], ...]:
    expected = target_date.isoformat()
    fields: list[Mapping[str, Any]] = []
    for record in records:
      record_fields = _record_fields(record)
      if _normalize_date_value(record_fields.get("统计日期")) == expected:
        fields.append(record_fields)
    return tuple(fields)


def run_daily_analysis_generation(
  *,
  target_date: date,
  source: OfficialResultsSource,
  output_dir: str | Path,
  generated_at: datetime | None = None,
  dry_run: bool = False,
  official_result_source: str = "official_results_source",
  operator_profiles: Iterable[OperatorProfile] = (),
  historical_effect_records: Iterable[DailyBasicStatsRecord] = (),
  operation_overview_rows: Iterable[Mapping[str, Any]] = (),
  operation_details_value: Mapping[str, Any] | None = None,
) -> DailyAnalysisGenerationResult:
  generated = generated_at or datetime.now(timezone.utc)
  profiles = tuple(operator_profiles)
  historical_effect_records_value = tuple(historical_effect_records)
  operation_overview_rows_value = tuple(operation_overview_rows)
  batch = source.fetch(target_date)
  filtered_batch = _filter_batch_to_configured_operators(
    batch,
    operator_profiles=profiles,
  )
  payload = build_offline_daily_analysis_payload(
    batch=filtered_batch,
    generated_at=generated,
    official_result_source=official_result_source,
    operator_profiles=profiles,
    historical_effect_records=historical_effect_records_value,
    operation_overview_rows=operation_overview_rows_value,
    operation_details_value=operation_details_value,
  )
  output_path = Path(output_dir) / f"{target_date.isoformat()}.json"
  if not dry_run:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(
      json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
      encoding="utf-8",
    )
  return DailyAnalysisGenerationResult(
    target_date=target_date,
    output_path=output_path,
    status=str(payload["status"]),
    operator_row_count=len(filtered_batch.operator_rows),
    job_row_count=len(filtered_batch.job_rows),
    dry_run=dry_run,
    payload=payload,
  )


def build_offline_daily_analysis_payload(
  *,
  batch: OfficialResultsBatch,
  generated_at: datetime,
  official_result_source: str,
  operator_profiles: Iterable[OperatorProfile] = (),
  historical_effect_records: Iterable[DailyBasicStatsRecord] = (),
  operation_overview_rows: Iterable[Mapping[str, Any]] = (),
  operation_details_value: Mapping[str, Any] | None = None,
) -> dict[str, Any]:
  profiles = tuple(operator_profiles)
  profile_index = _operator_profile_index(profiles)
  operator_results = _operator_evidence_items(batch, profile_index)
  operator_ids_by_name = {
    str(item["values"]["boss_name"]): str(item["operator_id"])
    for item in operator_results
  }
  job_results = _job_evidence_items(batch, operator_ids_by_name, profile_index)
  historical_effects = build_historical_effects_14d(
    target_date=batch.target_date,
    records=historical_effect_records,
    operator_profiles=profiles,
  )
  operation_overview = build_operation_overview_14d(
    target_date=batch.target_date,
    rows=operation_overview_rows,
    operator_profiles=profiles,
  )
  operation_details = build_operation_details(
    target_date=batch.target_date,
    value=operation_details_value,
    operator_profiles=profiles,
  )
  data_quality = _data_quality(
    operator_results,
    job_results,
    historical_effects=historical_effects,
    operation_overview=operation_overview,
    operation_details=operation_details,
  )
  model_input_packet = _model_input_packet(
    batch=batch,
    operator_results=operator_results,
    job_results=job_results,
    data_quality=data_quality,
    historical_effects=historical_effects,
    operation_overview=operation_overview,
    operation_details=operation_details,
  )
  return {
    "status": "analyzing" if operator_results else "failed",
    "analysis_date": batch.target_date.isoformat(),
    "generated_at": generated_at.isoformat(),
    "scope": {
      "operator_id": None,
      "display_name": "全部操作员",
      "boss_name": "全部操作员",
    },
    "sync_state": {
      "analysis_source": ANALYSIS_SOURCE,
      "official_result_source": official_result_source,
      "official_result_operator_count": len(operator_results),
      "official_result_job_count": len(job_results),
      "configured_operator_count": len({profile.operator_id for profile in profiles if profile.enabled}),
      "official_result_deadline": batch.source_deadline,
      "behavior_source": "not_loaded",
      "model_state": "model_output_required" if operator_results else "missing_official_result",
      "llm_strategy": LLM_STRATEGY_NAME,
      "llm_strategy_version": LLM_STRATEGY_VERSION,
      "llm_strategy_document": LLM_STRATEGY_DOCUMENT,
    },
    "volatility_metrics": [],
    "evidence_bundle": {
      "operator_results": operator_results,
      "job_results": job_results,
      "behavior_summaries": [],
      "job_actions": [],
    },
    "model_analysis": {
      "summary": _pending_model_summary(operator_results),
      "generated_at": generated_at.isoformat(),
      "analyzer": PENDING_LLM_ANALYZER,
      "attributions": [],
      "action_items": [],
      "questions_for_next_collection": [],
    },
    "model_input_packet": model_input_packet,
    "data_quality": data_quality,
    "errors": list(batch.source_warnings),
  }


def main(argv: list[str] | None = None) -> int:
  parser = build_parser()
  args = parser.parse_args(argv)
  load_env_files(args.env_file)
  try:
    target_date = _resolve_target_date(args)
    source, source_label = _build_source(args)
    operator_profiles = OperatorConfigProvider(args.operator_config_file).load()
    output_dir = _output_dir(args.output_dir)
    result = run_daily_analysis_generation(
      target_date=target_date,
      source=source,
      output_dir=output_dir,
      dry_run=args.dry_run,
      official_result_source=source_label,
      operator_profiles=operator_profiles,
      historical_effect_records=tuple(iter_daily_basic_summaries_from_file(args.daily_basic_source_file))
      if args.daily_basic_source_file
      else (),
      operation_overview_rows=_operation_overview_rows_from_file(args.operation_overview_source_file),
      operation_details_value=_operation_details_value_from_file(args.operation_details_source_file),
    )
  except ValueError as error:
    parser.exit(status=2, message=f"error: {error}\n")
  except Exception as error:
    parser.exit(status=1, message=f"error: {error}\n")
  print(json.dumps(_result_summary(result), ensure_ascii=False, indent=2))
  return 0


def build_parser() -> argparse.ArgumentParser:
  parser = argparse.ArgumentParser(
    description="Generate one day's offline daily-analysis result JSON.",
  )
  parser.add_argument(
    "date_arg",
    nargs="?",
    help="Target statistics date in YYYY-MM-DD. Same as --date.",
  )
  parser.add_argument(
    "--date",
    help="Target statistics date in YYYY-MM-DD. Defaults to yesterday in --timezone.",
  )
  parser.add_argument(
    "--timezone",
    default=os.environ.get("APP_TIMEZONE", DEFAULT_TIMEZONE_NAME),
    help=f"Timezone for default date resolution. Default: {DEFAULT_TIMEZONE_NAME}.",
  )
  parser.add_argument(
    "--output-dir",
    help=(
      "Directory for YYYY-MM-DD.json. Defaults to "
      "BOSS_ANALYSIS_DAILY_ANALYSIS_RESULTS_DIR or data/daily-analysis-results."
    ),
  )
  parser.add_argument(
    "--dry-run",
    action="store_true",
    help="Read sources and print the result summary without writing JSON.",
  )
  parser.add_argument(
    "--source",
    choices=("feishu", "file"),
    default=None,
    help="Official result source. Default: feishu, or file when --source-file is set.",
  )
  parser.add_argument(
    "--source-file",
    help="Read official result rows from a local JSON file for replay/testing. Implies --source file.",
  )
  parser.add_argument(
    "--env-file",
    action="append",
    help="Optional .env file to load before reading runtime config. Can be repeated.",
  )
  parser.add_argument(
    "--operator-config-file",
    help="Local operator mapping JSON path. Defaults to BOSS_ANALYSIS_OPERATOR_CONFIG_FILE or config/operators.local.json.",
  )
  parser.add_argument(
    "--daily-basic-source-file",
    help="JSON/JSONL daily basic summary source for 14-day historical effects.",
  )
  parser.add_argument(
    "--operation-overview-source-file",
    help="JSON operation overview source file; supports {'rows': [...]} or [...]",
  )
  parser.add_argument(
    "--operation-details-source-file",
    help="JSON operation detail source file for target day.",
  )
  return parser


def _resolve_target_date(args: argparse.Namespace) -> date:
  if args.date_arg and args.date and args.date_arg != args.date:
    raise ValueError("Use either positional date or --date, not both with different values")
  return resolve_sync_date(
    args.date or args.date_arg,
    clock=datetime.now,
    timezone_name=args.timezone,
  )


def _build_source(args: argparse.Namespace) -> tuple[OfficialResultsSource, str]:
  if args.source_file:
    return JsonOfficialResultsSource.from_path(args.source_file), "official_results_file"
  source_name = args.source or "feishu"
  if source_name == "file":
    raise ValueError("--source file requires --source-file")
  operator_table_id, job_table_id = default_table_ids()
  return (
    FeishuOfficialResultsSource(
      feishu_client=FeishuBitableClient.from_env(),
      operator_table_id=operator_table_id,
      job_table_id=job_table_id,
    ),
    "feishu_bitable_daily_results",
  )


def _output_dir(value: str | None) -> str:
  if value and value.strip():
    return value.strip()
  env_value = os.environ.get("BOSS_ANALYSIS_DAILY_ANALYSIS_RESULTS_DIR")
  if env_value and env_value.strip():
    return env_value.strip()
  return DEFAULT_OUTPUT_DIR


def _read_json_value(path: str) -> Any:
  return json.loads(Path(path).read_text(encoding="utf-8"))


def _operation_overview_rows_from_file(path: str | None) -> tuple[Mapping[str, Any], ...]:
  if not path:
    return ()
  raw = _read_json_value(path)
  if isinstance(raw, Mapping):
    raw = raw.get("rows")
  if not isinstance(raw, list):
    raise ValueError(
      "--operation-overview-source-file must contain a top-level list or an object with a 'rows' list"
    )
  return tuple(item for item in raw if isinstance(item, Mapping))


def _operation_details_value_from_file(path: str | None) -> Mapping[str, Any] | None:
  if not path:
    return None
  raw = _read_json_value(path)
  if not isinstance(raw, Mapping):
    raise ValueError("--operation-details-source-file must contain a top-level JSON object")
  return raw


def _operator_evidence_items(
  batch: OfficialResultsBatch,
  profile_index: Mapping[str, OperatorProfile],
) -> list[dict[str, Any]]:
  seen_ids: dict[str, int] = {}
  items: list[dict[str, Any]] = []
  for index, row in enumerate(batch.operator_rows):
    fields = row.fields
    boss_name = _text(fields.get("BOSS姓名")) or f"操作员 {index + 1}"
    profile = _profile_for_name(profile_index, boss_name)
    operator_id = profile.operator_id if profile else _unique_operator_id(boss_name, seen_ids)
    display_name = profile.display_name if profile else boss_name
    current = _metrics_from_fields(fields)
    items.append({
      "evidence_id": f"official:operator:{batch.target_date.isoformat()}:{operator_id}",
      "category": "official_operator_result",
      "title": f"{boss_name} 官方单人汇总",
      "source": "boss_official_result",
      "values": {
        "active_date": batch.target_date.isoformat(),
        "boss_name": boss_name,
        "display_name": display_name,
        "current": current,
        "baselines": {},
      },
      "operator_id": operator_id,
      "job_key": None,
      "recorded_at": datetime.combine(batch.target_date, datetime.min.time(), tzinfo=timezone.utc).isoformat(),
    })
  return items


def _job_evidence_items(
  batch: OfficialResultsBatch,
  operator_ids_by_name: Mapping[str, str],
  profile_index: Mapping[str, OperatorProfile],
) -> list[dict[str, Any]]:
  items: list[dict[str, Any]] = []
  for index, row in enumerate(batch.job_rows):
    fields = row.fields
    job_name = _text(fields.get("职位名称")) or f"岗位 {index + 1}"
    boss_name = _text(fields.get("职位发布人"))
    profile = _profile_for_name(profile_index, boss_name)
    operator_id = profile.operator_id if profile else operator_ids_by_name.get(boss_name)
    job_key = _job_key(job_name, index)
    items.append({
      "evidence_id": f"official:job:{batch.target_date.isoformat()}:{operator_id or 'unmatched'}:{job_key}",
      "category": "official_job_result",
      "title": f"{boss_name or '未匹配操作员'} / {job_name}",
      "source": "boss_official_job_result",
      "values": {
        "active_date": batch.target_date.isoformat(),
        "job_name": job_name,
        "publisher_boss_name": boss_name,
        "current": _metrics_from_fields(fields),
      },
      "operator_id": operator_id,
      "job_key": job_key,
      "recorded_at": datetime.combine(batch.target_date, datetime.min.time(), tzinfo=timezone.utc).isoformat(),
    })
  return items


def _data_quality(
  operator_results: list[dict[str, Any]],
  job_results: list[dict[str, Any]],
  historical_effects: Mapping[str, Any],
  operation_overview: Mapping[str, Any],
  operation_details: Mapping[str, Any],
) -> dict[str, list[str]]:
  missing_fields = ["model_analysis"]

  def _append_missing(field: str) -> None:
    if field not in missing_fields:
      missing_fields.append(field)

  if historical_effects.get("source_state") != "loaded":
    _append_missing("historical_effects_14d")
  if operation_overview.get("source_state") != "loaded":
    _append_missing("operation_overview_14d")
  if operation_details.get("source_state") != "loaded":
    _append_missing("operation_details")
  for gap in operation_details.get("data_gaps", ()):
    if isinstance(gap, str):
      _append_missing(gap)
  unmatched_jobs = [
    f"{item['values']['publisher_boss_name']}:{item['values']['job_name']}"
    for item in job_results
    if not item.get("operator_id")
  ]
  low_sample_warnings: list[str] = []
  for item in operator_results:
    current = item["values"]["current"]
    if _number(current.get("boss_started_chats")) < 10:
      low_sample_warnings.append(f"{item['operator_id']}:boss_started_chats")
  return {
    "missing_fields": missing_fields,
    "unmatched_jobs": unmatched_jobs,
    "low_sample_warnings": low_sample_warnings,
  }


def _model_input_packet(
  *,
  batch: OfficialResultsBatch,
  operator_results: list[dict[str, Any]],
  job_results: list[dict[str, Any]],
  data_quality: dict[str, list[str]],
  historical_effects: Mapping[str, Any],
  operation_overview: Mapping[str, Any],
  operation_details: Mapping[str, Any],
) -> dict[str, Any]:
  return {
    "strategy": {
      "name": LLM_STRATEGY_NAME,
      "version": LLM_STRATEGY_VERSION,
      "document": LLM_STRATEGY_DOCUMENT,
    },
    "task": "daily_operator_coaching_analysis",
    "analysis_date": batch.target_date.isoformat(),
    "facts": {
      "official_operator_results": operator_results,
      "official_job_results": job_results,
      "historical_effects_14d": historical_effects,
      "operation_overview_14d": operation_overview,
      "operation_details": operation_details,
      "behavior_summaries": [],
      "job_actions": [],
    },
    "data_quality": data_quality,
    "output_schema": {
      "summary": "string",
      "action_items": [{
        "rank": "integer",
        "owner_role": "manager|operator|system",
        "target_operator_id": "string|null",
        "target_job_key": "string|null",
        "action": "string",
        "execution_steps": ["string"],
        "due_window": "string",
        "success_check": "string",
        "confidence": "high|medium|low",
        "evidence_refs": ["evidence_id"],
        "data_gaps": ["string"],
        "blocked_by": ["string"],
      }],
      "questions_for_next_collection": ["string"],
    },
  }


def _filter_batch_to_configured_operators(
  batch: OfficialResultsBatch,
  *,
  operator_profiles: Iterable[OperatorProfile],
) -> OfficialResultsBatch:
  profile_index = _operator_profile_index(operator_profiles)
  if not profile_index:
    return OfficialResultsBatch(
      target_date=batch.target_date,
      operator_rows=(),
      job_rows=(),
      source_deadline=batch.source_deadline,
      source_warnings=batch.source_warnings,
    )
  operator_rows = tuple(
    row
    for row in batch.operator_rows
    if _profile_for_name(profile_index, row.fields.get("BOSS姓名")) is not None
  )
  job_rows = tuple(
    row
    for row in batch.job_rows
    if _profile_for_name(profile_index, row.fields.get("职位发布人")) is not None
  )
  return OfficialResultsBatch(
    target_date=batch.target_date,
    operator_rows=operator_rows,
    job_rows=job_rows,
    source_deadline=batch.source_deadline,
    source_warnings=batch.source_warnings,
  )


def _operator_profile_index(
  operator_profiles: Iterable[OperatorProfile],
) -> dict[str, OperatorProfile]:
  index: dict[str, OperatorProfile] = {}
  for profile in operator_profiles:
    if not profile.enabled:
      continue
    for key in (profile.operator_id, profile.display_name, profile.account_name, *profile.aliases):
      text = _text(key)
      if text:
        index.setdefault(text, profile)
  return index


def _profile_for_name(
  profile_index: Mapping[str, OperatorProfile],
  name: Any,
) -> OperatorProfile | None:
  return profile_index.get(_text(name))


def _pending_model_summary(operator_results: list[dict[str, Any]]) -> str:
  if not operator_results:
    return "未读取到操作员官方结果，无法提交大模型分析。"
  return "等待大模型分析输出；本地仅生成事实证据包和模型输入包。"


def _metrics_from_fields(fields: Mapping[str, Any]) -> dict[str, int]:
  return {
    metric_key: _int_value(fields.get(field_name))
    for metric_key, field_name in METRIC_FIELDS
  }


def _row_from_feishu_fields(fields: Mapping[str, Any], target_date: date) -> OfficialResultRow:
  return OfficialResultRow(
    fields={**fields, "统计日期": target_date.isoformat()},
    business_key="",
  )


def _record_fields(record: Mapping[str, Any]) -> Mapping[str, Any]:
  fields = record.get("fields", record)
  return fields if isinstance(fields, Mapping) else {}


def _normalize_date_value(value: Any) -> str:
  if isinstance(value, date):
    return value.isoformat()
  if isinstance(value, (int, float)) and not isinstance(value, bool):
    try:
      return datetime.fromtimestamp(value / 1000, tz=timezone.utc).date().isoformat()
    except (OSError, OverflowError, ValueError):
      return str(value)
  text = _text(value)
  if len(text) >= 10:
    normalized = text[:10].replace(".", "-")
    try:
      return date.fromisoformat(normalized).isoformat()
    except ValueError:
      return text
  return text


def _result_summary(result: DailyAnalysisGenerationResult) -> dict[str, Any]:
  return {
    "dry_run": result.dry_run,
    "target_date": result.target_date.isoformat(),
    "status": result.status,
    "operator_rows": result.operator_row_count,
    "job_rows": result.job_row_count,
    "output_path": str(result.output_path),
  }


def _unique_operator_id(boss_name: str, seen_ids: dict[str, int]) -> str:
  base = boss_name or "unknown_operator"
  count = seen_ids.get(base, 0) + 1
  seen_ids[base] = count
  if count == 1:
    return base
  return f"{base}#{count}"


def _job_key(job_name: str, index: int) -> str:
  safe = "".join(char if char.isalnum() else "-" for char in job_name.strip()).strip("-")
  return safe or f"job-{index + 1}"


def _int_value(value: Any) -> int:
  if value is None or value == "":
    return 0
  if isinstance(value, bool):
    return int(value)
  if isinstance(value, int):
    return value
  if isinstance(value, float):
    return int(value)
  text = str(value).strip().replace(",", "")
  if text in {"--", "-"}:
    return 0
  try:
    return int(float(text))
  except ValueError:
    return 0


def _number(value: Any) -> float:
  if isinstance(value, (int, float)) and not isinstance(value, bool):
    return float(value)
  if isinstance(value, str):
    try:
      return float(value.strip())
    except ValueError:
      return 0.0
  return 0.0


def _text(value: Any) -> str:
  if value is None:
    return ""
  return str(value).strip()


if __name__ == "__main__":
  raise SystemExit(main())
