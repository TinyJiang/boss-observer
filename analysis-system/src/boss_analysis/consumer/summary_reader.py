"""Read and normalize CLS scheduled SQL minute summary rows."""

from __future__ import annotations

import json
from collections.abc import Iterable, Mapping
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from boss_analysis.consumer.cls_search import (
  load_cls_daily_summary_search_config,
  load_cls_log_quality_search_config,
  load_cls_summary_search_config,
  search_cls_log_values,
)
from boss_analysis.domain import DailyActiveDurationRecord, LogQualitySummaryRecord, MinuteSummaryRecord

MISSING_DIMENSION_VALUES = {"", "<missing>", "missing", "__missing__", "null", "none"}
FUNNEL_METRIC_NAME = "boss_minute_operator_funnel"
CHAT_METRIC_NAME = "boss_minute_chat"
DAILY_ACTIVE_DURATION_METRIC_NAME = "boss_daily_operator_active_duration"
LOG_QUALITY_METRIC_NAME = "boss_10min_log_quality"


def iter_minute_summaries_from_file(path: str | Path) -> Iterable[MinuteSummaryRecord]:
  """Yield minute summary rows from JSON/JSONL exports."""

  data_path = Path(path)
  text = data_path.read_text(encoding="utf-8").strip()
  if not text:
    return
  if data_path.suffix.lower() in {".jsonl", ".ndjson"}:
    for line in text.splitlines():
      stripped = line.strip()
      if stripped:
        yield from iter_minute_summaries_from_json_value(json.loads(stripped))
    return
  yield from iter_minute_summaries_from_json_value(json.loads(text))


def iter_daily_active_durations_from_file(path: str | Path) -> Iterable[DailyActiveDurationRecord]:
  """Yield daily active-duration metric rows from JSON/JSONL exports."""

  data_path = Path(path)
  text = data_path.read_text(encoding="utf-8").strip()
  if not text:
    return
  if data_path.suffix.lower() in {".jsonl", ".ndjson"}:
    for line in text.splitlines():
      stripped = line.strip()
      if stripped:
        yield from iter_daily_active_durations_from_json_value(json.loads(stripped))
    return
  yield from iter_daily_active_durations_from_json_value(json.loads(text))


def iter_log_quality_summaries_from_file(path: str | Path) -> Iterable[LogQualitySummaryRecord]:
  """Yield 10-minute log-quality metric rows from JSON/JSONL exports."""

  data_path = Path(path)
  text = data_path.read_text(encoding="utf-8").strip()
  if not text:
    return
  if data_path.suffix.lower() in {".jsonl", ".ndjson"}:
    for line in text.splitlines():
      stripped = line.strip()
      if stripped:
        yield from iter_log_quality_summaries_from_json_value(json.loads(stripped))
    return
  yield from iter_log_quality_summaries_from_json_value(json.loads(text))


def iter_minute_summaries_from_search(
  *,
  now: datetime | None = None,
  client: Any | None = None,
) -> Iterable[MinuteSummaryRecord]:
  """Yield minute summary rows from the configured CLS summary topic."""

  config = load_cls_summary_search_config()
  for value in search_cls_log_values(config, now=now, client=client):
    yield from iter_minute_summaries_from_json_value(value)


def iter_daily_active_durations_from_search(
  *,
  now: datetime | None = None,
  client: Any | None = None,
) -> Iterable[DailyActiveDurationRecord]:
  """Yield daily active-duration metrics from the configured CLS daily summary topic."""

  config = load_cls_daily_summary_search_config()
  for value in search_cls_log_values(config, now=now, client=client):
    yield from iter_daily_active_durations_from_json_value(value)


def iter_log_quality_summaries_from_search(
  *,
  now: datetime | None = None,
  client: Any | None = None,
) -> Iterable[LogQualitySummaryRecord]:
  """Yield 10-minute log-quality metrics from the configured health summary topic."""

  config = load_cls_log_quality_search_config()
  for value in search_cls_log_values(config, now=now, client=client):
    yield from iter_log_quality_summaries_from_json_value(value)


def iter_minute_summaries_from_json_value(value: Any) -> Iterable[MinuteSummaryRecord]:
  """Yield normalized summary rows from decoded JSON-like values."""

  if isinstance(value, list):
    for item in value:
      yield from iter_minute_summaries_from_json_value(item)
    return
  if not isinstance(value, dict):
    return
  if isinstance(value.get("records"), list):
    for item in value["records"]:
      yield from iter_minute_summaries_from_json_value(item)
    return
  if isinstance(value.get("contents"), dict):
    value = value["contents"]
  record = parse_minute_summary_record(value)
  if record is not None:
    yield record


def iter_daily_active_durations_from_json_value(value: Any) -> Iterable[DailyActiveDurationRecord]:
  """Yield normalized daily active-duration rows from decoded JSON-like values."""

  if isinstance(value, list):
    for item in value:
      yield from iter_daily_active_durations_from_json_value(item)
    return
  if not isinstance(value, dict):
    return
  if isinstance(value.get("records"), list):
    for item in value["records"]:
      yield from iter_daily_active_durations_from_json_value(item)
    return
  if isinstance(value.get("contents"), dict):
    value = value["contents"]
  record = parse_daily_active_duration_record(value)
  if record is not None:
    yield record


def iter_log_quality_summaries_from_json_value(value: Any) -> Iterable[LogQualitySummaryRecord]:
  """Yield normalized 10-minute log-quality rows from decoded JSON-like values."""

  if isinstance(value, list):
    for item in value:
      yield from iter_log_quality_summaries_from_json_value(item)
    return
  if not isinstance(value, dict):
    return
  if isinstance(value.get("records"), list):
    for item in value["records"]:
      yield from iter_log_quality_summaries_from_json_value(item)
    return
  if isinstance(value.get("contents"), dict):
    value = value["contents"]
  record = parse_log_quality_summary_record(value)
  if record is not None:
    yield record


def parse_minute_summary_record(raw_record: Mapping[str, Any]) -> MinuteSummaryRecord | None:
  """Convert one CLS scheduled SQL row into a stable internal model."""

  raw = dict(raw_record)
  minute = _parse_minute(raw.get("minute") or raw.get("time") or raw.get("__TIMESTAMP__"))
  if minute is None:
    return None
  raw_operator_id = _clean_string(raw.get("operator_id") or raw.get("operatorId"))
  metric_name = _detect_metric_name(raw)
  return MinuteSummaryRecord(
    metric_name=metric_name,
    minute=minute,
    operator_id=_clean_dimension(raw_operator_id),
    raw_operator_id=raw_operator_id,
    job_id=_clean_dimension(raw.get("job_id") or raw.get("jobId")),
    card_exposed=_int_value(raw.get("card_exposed")),
    detail_opened=_int_value(raw.get("detail_opened")),
    greeting_clicked=_int_value(raw.get("greeting_clicked")),
    greeting_succeeded=_int_value(raw.get("greeting_succeeded")),
    greeting_failed=_int_value(raw.get("greeting_failed")),
    chat_opened=_int_value(raw.get("chat_opened")),
    chat_snapshots=_int_value(raw.get("chat_snapshot_captured") or raw.get("snapshot_captured")),
    wechat_captured=_int_value(raw.get("wechat_captured")),
    report_required=_int_value(raw.get("report_required")),
    capture_failed=_int_value(raw.get("capture_failed")),
    visible_message_count=_int_value(raw.get("visible_message_count")),
    may_be_incomplete_count=_int_value(raw.get("may_be_incomplete_count")),
    total_events=_int_value(raw.get("total_events") or raw.get("event_count")),
    chat_events=_int_value(raw.get("chat_events")),
    recorded_at=_parse_minute(raw.get("calculated_at") or raw.get("recorded_at") or raw.get("__TIMESTAMP__")),
  )


def parse_daily_active_duration_record(raw_record: Mapping[str, Any]) -> DailyActiveDurationRecord | None:
  """Convert one CLS daily active-duration row into a stable internal model."""

  raw = dict(raw_record)
  metric_name = _detect_metric_name(raw)
  if metric_name != DAILY_ACTIVE_DURATION_METRIC_NAME:
    return None
  active_date = _parse_date(raw.get("active_date") or raw.get("date"))
  operator_id = _clean_dimension(raw.get("operator_id") or raw.get("operatorId"))
  if active_date is None or operator_id is None:
    return None
  active_minutes = _int_value(raw.get("active_minutes"))
  active_seconds = _int_value(raw.get("active_seconds")) or active_minutes * 60
  first_active_minute = _parse_minute(raw.get("first_active_minute"))
  last_active_minute = _parse_minute(raw.get("last_active_minute"))
  return DailyActiveDurationRecord(
    metric_name=metric_name,
    active_date=active_date,
    operator_id=operator_id,
    active_minutes=active_minutes,
    active_seconds=active_seconds,
    first_active_minute=first_active_minute,
    last_active_minute=last_active_minute,
    source_minute_count=_int_value(raw.get("source_minute_count")),
    source_row_count=_int_value(raw.get("source_row_count")),
    recorded_at=_parse_minute(raw.get("calculated_at") or raw.get("recorded_at") or raw.get("__TIMESTAMP__")),
  )


def parse_log_quality_summary_record(raw_record: Mapping[str, Any]) -> LogQualitySummaryRecord | None:
  """Convert one CLS 10-minute log-quality row into a stable internal model."""

  raw = dict(raw_record)
  metric_name = _detect_metric_name(raw)
  if metric_name != LOG_QUALITY_METRIC_NAME:
    return None
  window_start = _parse_minute(
    raw.get("window_start")
    or raw.get("bucket_start")
    or raw.get("quality_window_start")
    or raw.get("minute")
    or raw.get("time")
    or raw.get("__TIMESTAMP__")
  )
  if window_start is None:
    return None
  raw_operator_id = _clean_string(raw.get("operator_id") or raw.get("operatorId"))
  checked_event_count = _int_value(raw.get("checked_event_count"))
  raw_event_count = _int_value(raw.get("raw_event_count") or raw.get("event_count"))
  if checked_event_count == 0:
    checked_event_count = raw_event_count
  return LogQualitySummaryRecord(
    metric_name=metric_name,
    window_start=window_start,
    window_minutes=_int_value(raw.get("window_minutes")) or 10,
    plugin_version=_clean_dimension(raw.get("plugin_version") or raw.get("pluginVersion")),
    event_type=_clean_dimension(raw.get("event_type") or raw.get("eventType")),
    operator_id=_clean_dimension(raw_operator_id),
    raw_operator_id=raw_operator_id,
    page_type=_clean_dimension(raw.get("page_type") or raw.get("pageType")),
    job_id=_clean_dimension(raw.get("job_id") or raw.get("jobId")),
    raw_event_count=raw_event_count,
    checked_event_count=checked_event_count,
    missing_event_id_count=_int_value(raw.get("missing_event_id_count")),
    missing_operator_count=_int_value(raw.get("missing_operator_count")),
    missing_plugin_version_count=_int_value(raw.get("missing_plugin_version_count")),
    missing_session_count=_int_value(raw.get("missing_session_count")),
    missing_context_count=_int_value(raw.get("missing_context_count")),
    payload_missing_count=_int_value(raw.get("payload_missing_count")),
    card_required_field_missing_count=_int_value(raw.get("card_required_field_missing_count")),
    card_profile_core_missing_count=_int_value(raw.get("card_profile_core_missing_count")),
    card_identity_low_confidence_count=_int_value(raw.get("card_identity_low_confidence_count")),
    detail_required_field_missing_count=_int_value(raw.get("detail_required_field_missing_count")),
    detail_card_link_hint_missing_count=_int_value(raw.get("detail_card_link_hint_missing_count")),
    detail_close_opened_link_missing_count=_int_value(raw.get("detail_close_opened_link_missing_count")),
    greeting_required_field_missing_count=_int_value(raw.get("greeting_required_field_missing_count")),
    greeting_source_link_hint_missing_count=_int_value(raw.get("greeting_source_link_hint_missing_count")),
    greeting_result_click_link_missing_count=_int_value(raw.get("greeting_result_click_link_missing_count")),
    chat_candidate_missing_count=_int_value(raw.get("chat_candidate_missing_count")),
    chat_candidate_low_confidence_count=_int_value(raw.get("chat_candidate_low_confidence_count")),
    chat_conversation_key_missing_count=_int_value(raw.get("chat_conversation_key_missing_count")),
    chat_message_quality_issue_count=_int_value(raw.get("chat_message_quality_issue_count")),
    chat_message_count_missing_count=_int_value(raw.get("chat_message_count_missing_count")),
    chat_message_fingerprint_missing_count=_int_value(raw.get("chat_message_fingerprint_missing_count")),
    chat_snapshot_completeness_missing_count=_int_value(raw.get("chat_snapshot_completeness_missing_count")),
    sensitive_leak_signal_count=_int_value(raw.get("sensitive_leak_signal_count")),
    source_row_count=_int_value(raw.get("source_row_count")),
    recorded_at=_parse_minute(raw.get("calculated_at") or raw.get("recorded_at") or raw.get("__TIMESTAMP__")),
  )


def _detect_metric_name(raw: Mapping[str, Any]) -> str:
  explicit = _clean_string(
    raw.get("metric_name")
    or raw.get("summary_type")
    or raw.get("task_name")
    or raw.get("source_task")
  )
  if explicit is not None:
    return explicit
  keys = set(raw.keys())
  if keys & {"active_minutes", "active_seconds", "first_active_minute", "last_active_minute"}:
    return DAILY_ACTIVE_DURATION_METRIC_NAME
  if keys & {
    "window_start",
    "checked_event_count",
    "card_required_field_missing_count",
    "detail_card_link_hint_missing_count",
    "chat_message_quality_issue_count",
  }:
    return LOG_QUALITY_METRIC_NAME
  if keys & {"chat_events", "snapshot_captured", "report_required", "capture_failed"}:
    return CHAT_METRIC_NAME
  if keys & {
    "card_exposed",
    "detail_opened",
    "greeting_clicked",
    "greeting_succeeded",
    "greeting_failed",
    "chat_snapshot_captured",
    "total_events",
  }:
    return FUNNEL_METRIC_NAME
  return "unknown"


def _parse_date(value: Any) -> date | None:
  if isinstance(value, datetime):
    return _with_default_timezone(value).date()
  if isinstance(value, date):
    return value
  text = _clean_string(value)
  if text is None:
    return None
  try:
    return date.fromisoformat(text[:10])
  except ValueError:
    return None


def _parse_minute(value: Any) -> datetime | None:
  if value is None:
    return None
  if isinstance(value, datetime):
    return _with_default_timezone(value)
  if isinstance(value, (int, float)):
    timestamp = float(value)
    if timestamp > 10_000_000_000:
      timestamp = timestamp / 1000
    return datetime.fromtimestamp(timestamp, tz=timezone.utc)
  text = _clean_string(value)
  if text is None:
    return None
  normalized = text.replace("Z", "+00:00")
  if " " in normalized and "T" not in normalized:
    normalized = normalized.replace(" ", "T", 1)
  try:
    parsed = datetime.fromisoformat(normalized)
  except ValueError:
    return None
  return _with_default_timezone(parsed)


def _with_default_timezone(value: datetime) -> datetime:
  if value.tzinfo is not None:
    return value
  try:
    default_tz = ZoneInfo("Asia/Shanghai")
  except ZoneInfoNotFoundError:
    default_tz = timezone.utc
  return value.replace(tzinfo=default_tz)


def _clean_dimension(value: Any) -> str | None:
  cleaned = _clean_string(value)
  if cleaned is None or cleaned.lower() in MISSING_DIMENSION_VALUES:
    return None
  return cleaned


def _clean_string(value: Any) -> str | None:
  if value is None:
    return None
  if isinstance(value, str):
    stripped = value.strip()
    return stripped or None
  return str(value)


def _int_value(value: Any) -> int:
  if value is None:
    return 0
  if isinstance(value, bool):
    return int(value)
  if isinstance(value, (int, float)):
    return int(value)
  if isinstance(value, str):
    stripped = value.strip()
    if not stripped:
      return 0
    try:
      return int(float(stripped))
    except ValueError:
      return 0
  return 0
