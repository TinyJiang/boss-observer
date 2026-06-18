"""Read and normalize CLS scheduled SQL minute summary rows."""

from __future__ import annotations

import json
from collections.abc import Iterable, Mapping
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from boss_analysis.consumer.cls_search import (
  load_cls_daily_basic_summary_search_config,
  load_cls_daily_summary_search_config,
  load_cls_log_quality_search_config,
  load_cls_summary_search_config,
  query_cls_metric_range,
  search_cls_log_values,
)
from boss_analysis.domain import (
  DailyActiveDurationRecord,
  DailyBasicStatsRecord,
  LogQualitySummaryRecord,
  MinuteSummaryRecord,
)

MISSING_DIMENSION_VALUES = {"", "<missing>", "missing", "__missing__", "null", "none"}
FUNNEL_METRIC_NAME = "boss_minute_operator_funnel"
CHAT_METRIC_NAME = "boss_minute_chat"
DAILY_ACTIVE_DURATION_METRIC_NAME = "boss_daily_operator_active_duration"
DAILY_BASIC_STATS_METRIC_NAME = "boss_daily_operator_basic_stats"
LOG_QUALITY_METRIC_NAME = "boss_10min_log_quality"

DAILY_BASIC_METRIC_FIELDS: tuple[str, ...] = (
  "active_minutes",
  "active_seconds",
  "observed_minutes",
  "session_count",
  "touched_job_count",
  "plugin_started",
  "boss_page_entered",
  "boss_page_left",
  "page_changed",
  "plugin_exception",
  "job_context_detected",
  "job_context_changed",
  "filter_panel_opened",
  "filter_applied",
  "card_exposed",
  "detail_opened",
  "detail_closed",
  "greeting_clicked",
  "greeting_succeeded",
  "greeting_failed",
  "chat_opened",
  "snapshot_captured",
  "wechat_captured",
  "capture_failed",
  "card_unique_candidates",
  "detail_unique_candidates",
  "greeting_unique_candidates",
  "chat_unique_candidates",
  "wechat_unique_candidates",
  "visible_message_count",
  "may_be_incomplete_count",
  "first_round_candidate_initiated_count",
  "first_round_boss_replied_count",
  "first_round_boss_reply_elapsed_median_ms",
  "first_round_boss_reply_elapsed_avg_ms",
  "chat_conversation_count",
  "boss_ended_conversation_count",
  "boss_reply_count",
  "boss_reply_elapsed_median_ms",
  "boss_reply_elapsed_avg_ms",
  "detail_duration_ms",
  "greeting_result_elapsed_ms",
  "total_events",
  "source_row_count",
)


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


def iter_daily_basic_summaries_from_file(path: str | Path) -> Iterable[DailyBasicStatsRecord]:
  """Yield daily basic-stat rows from JSON/JSONL exports."""

  data_path = Path(path)
  text = data_path.read_text(encoding="utf-8").strip()
  if not text:
    return
  if data_path.suffix.lower() in {".jsonl", ".ndjson"}:
    for line in text.splitlines():
      stripped = line.strip()
      if stripped:
        yield from iter_daily_basic_summaries_from_json_value(json.loads(stripped))
    return
  yield from iter_daily_basic_summaries_from_json_value(json.loads(text))


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


def iter_daily_basic_summaries_from_search(
  *,
  active_date: date | str | None = None,
  operator_id: str | None = None,
  lookback_days: int | None = None,
  now: datetime | None = None,
  client: Any | None = None,
) -> Iterable[DailyBasicStatsRecord]:
  """Yield daily basic statistics from the configured CLS daily-basic log topic."""

  config = load_cls_daily_basic_summary_search_config()
  start_at, end_at = _daily_basic_query_window(
    config,
    active_date=active_date,
    lookback_days=lookback_days,
    now=now,
  )
  active_date_filter = _parse_date(active_date)
  operator_filter = _clean_dimension(operator_id)
  for value in search_cls_log_values(
    config,
    now=now,
    start_at=start_at,
    end_at=end_at,
    client=client,
  ):
    for record in iter_daily_basic_summaries_from_json_value(value):
      if active_date_filter is not None and record.active_date != active_date_filter:
        continue
      if operator_filter is not None and record.operator_id != operator_filter:
        continue
      yield record


def iter_daily_basic_summaries_from_metric_topic(
  *,
  active_date: date | str | None = None,
  operator_id: str | None = None,
  lookback_days: int | None = None,
  now: datetime | None = None,
  client: Any | None = None,
) -> Iterable[DailyBasicStatsRecord]:
  """Yield daily basic statistics from the configured CLS metric topic."""

  config = load_cls_daily_basic_summary_search_config()
  start_at, end_at = _daily_basic_query_window(
    config,
    active_date=active_date,
    lookback_days=lookback_days,
    now=now,
  )
  query = _daily_basic_metric_query(active_date=active_date, operator_id=operator_id)
  series_values = query_cls_metric_range(
    config,
    query=query,
    start_at=start_at,
    end_at=end_at,
    step_seconds=_metric_range_step_seconds(start_at, end_at),
    client=client,
  )
  yield from iter_daily_basic_summaries_from_metric_series(series_values)


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


def iter_daily_basic_summaries_from_json_value(value: Any) -> Iterable[DailyBasicStatsRecord]:
  """Yield normalized daily basic-stat rows from decoded JSON-like values."""

  if isinstance(value, list):
    for item in value:
      yield from iter_daily_basic_summaries_from_json_value(item)
    return
  if not isinstance(value, dict):
    return
  if isinstance(value.get("records"), list):
    for item in value["records"]:
      yield from iter_daily_basic_summaries_from_json_value(item)
    return
  if isinstance(value.get("contents"), dict):
    value = value["contents"]
  record = parse_daily_basic_summary_record(value)
  if record is not None:
    yield record


def iter_daily_basic_summaries_from_metric_series(
  series_values: Iterable[Mapping[str, Any]],
) -> Iterable[DailyBasicStatsRecord]:
  """Rebuild daily basic records from CLS metric series samples."""

  rows: dict[tuple[date, str], dict[str, Any]] = {}
  field_timestamps: dict[tuple[date, str], dict[str, int]] = {}
  for series in series_values:
    labels = series.get("metric")
    if not isinstance(labels, Mapping):
      continue
    metric_field = _clean_string(labels.get("__name__"))
    if metric_field not in DAILY_BASIC_METRIC_FIELDS:
      continue
    active_date = _parse_date(labels.get("active_date"))
    operator_id = _clean_dimension(labels.get("operator_id") or labels.get("operatorId"))
    if active_date is None or operator_id is None:
      continue
    sample = _latest_metric_sample(series)
    if sample is None:
      continue
    sample_timestamp, sample_value = sample
    key = (active_date, operator_id)
    row = rows.setdefault(key, _daily_basic_row_from_metric_labels(labels))
    timestamps = field_timestamps.setdefault(key, {})
    existing_timestamp = timestamps.get(metric_field)
    if existing_timestamp is None or sample_timestamp >= existing_timestamp:
      row[metric_field] = sample_value
      timestamps[metric_field] = sample_timestamp
    existing_recorded_at = row.get("recorded_at")
    recorded_at = datetime.fromtimestamp(sample_timestamp, tz=timezone.utc)
    if not isinstance(existing_recorded_at, datetime) or recorded_at > existing_recorded_at:
      row["recorded_at"] = recorded_at

  records = [
    record
    for row in rows.values()
    for record in [parse_daily_basic_summary_record(row)]
    if record is not None
  ]
  yield from sorted(records, key=lambda record: (record.active_date, record.operator_id))


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
    plugin_version=_clean_dimension(raw.get("plugin_version") or raw.get("pluginVersion")),
    job_name=_clean_string(
      raw.get("job_name")
      or raw.get("jobName")
      or raw.get("job_title")
      or raw.get("jobTitle")
      or raw.get("position_name")
      or raw.get("positionName")
    ),
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


def parse_daily_basic_summary_record(raw_record: Mapping[str, Any]) -> DailyBasicStatsRecord | None:
  """Convert one daily basic-stat row into a stable internal model."""

  raw = dict(raw_record)
  metric_name = _detect_metric_name(raw)
  active_date = _parse_date(raw.get("active_date") or raw.get("date"))
  operator_id = _clean_dimension(raw.get("operator_id") or raw.get("operatorId"))
  if active_date is None or operator_id is None:
    return None
  has_values = _bool_value(raw.get("has_values"), default=True)
  return DailyBasicStatsRecord(
    metric_name=DAILY_BASIC_STATS_METRIC_NAME
      if metric_name in {"unknown", DAILY_ACTIVE_DURATION_METRIC_NAME}
      else metric_name,
    active_date=active_date,
    operator_id=operator_id,
    operator_account_name=_clean_string(raw.get("operator_account_name") or raw.get("operatorAccountName")),
    boss_account_name=_clean_string(raw.get("boss_account_name") or raw.get("bossAccountName")),
    boss_account_matched=_clean_string(raw.get("boss_account_matched") or raw.get("bossAccountMatched")),
    first_active_minute=_parse_minute(raw.get("first_active_minute") or raw.get("firstActiveMinute")),
    last_active_minute=_parse_minute(raw.get("last_active_minute") or raw.get("lastActiveMinute")),
    active_minutes=_int_value(raw.get("active_minutes")),
    active_seconds=_int_value(raw.get("active_seconds")),
    observed_minutes=_int_value(raw.get("observed_minutes")),
    session_count=_int_value(raw.get("session_count")),
    touched_job_count=_int_value(raw.get("touched_job_count")),
    plugin_started=_int_value(raw.get("plugin_started")),
    boss_page_entered=_int_value(raw.get("boss_page_entered")),
    boss_page_left=_int_value(raw.get("boss_page_left")),
    page_changed=_int_value(raw.get("page_changed")),
    plugin_exception=_int_value(raw.get("plugin_exception")),
    job_context_detected=_int_value(raw.get("job_context_detected")),
    job_context_changed=_int_value(raw.get("job_context_changed")),
    filter_panel_opened=_int_value(raw.get("filter_panel_opened")),
    filter_applied=_int_value(raw.get("filter_applied")),
    card_exposed=_int_value(raw.get("card_exposed")),
    detail_opened=_int_value(raw.get("detail_opened")),
    detail_closed=_int_value(raw.get("detail_closed")),
    greeting_clicked=_int_value(raw.get("greeting_clicked")),
    greeting_succeeded=_int_value(raw.get("greeting_succeeded")),
    greeting_failed=_int_value(raw.get("greeting_failed")),
    chat_opened=_int_value(raw.get("chat_opened")),
    snapshot_captured=_int_value(raw.get("snapshot_captured") or raw.get("chat_snapshot_captured")),
    wechat_captured=_int_value(raw.get("wechat_captured")),
    capture_failed=_int_value(raw.get("capture_failed")),
    card_unique_candidates=_int_value(raw.get("card_unique_candidates")),
    detail_unique_candidates=_int_value(raw.get("detail_unique_candidates")),
    greeting_unique_candidates=_int_value(raw.get("greeting_unique_candidates")),
    chat_unique_candidates=_int_value(raw.get("chat_unique_candidates")),
    wechat_unique_candidates=_int_value(raw.get("wechat_unique_candidates")),
    visible_message_count=_int_value(raw.get("visible_message_count")),
    may_be_incomplete_count=_int_value(raw.get("may_be_incomplete_count")),
    first_round_candidate_initiated_count=_int_value(raw.get("first_round_candidate_initiated_count")),
    first_round_boss_replied_count=_int_value(raw.get("first_round_boss_replied_count")),
    first_round_boss_reply_elapsed_median_ms=_int_value(
      raw.get("first_round_boss_reply_elapsed_median_ms")
      or raw.get("first_round_boss_reply_median_ms")
    ),
    first_round_boss_reply_elapsed_avg_ms=_int_value(
      raw.get("first_round_boss_reply_elapsed_avg_ms")
      or raw.get("first_round_boss_reply_avg_ms")
    ),
    chat_conversation_count=_int_value(raw.get("chat_conversation_count")),
    boss_ended_conversation_count=_int_value(raw.get("boss_ended_conversation_count")),
    boss_reply_count=_int_value(raw.get("boss_reply_count")),
    boss_reply_elapsed_median_ms=_int_value(
      raw.get("boss_reply_elapsed_median_ms")
      or raw.get("boss_reply_median_ms")
    ),
    boss_reply_elapsed_avg_ms=_int_value(
      raw.get("boss_reply_elapsed_avg_ms")
      or raw.get("boss_reply_avg_ms")
    ),
    detail_duration_ms=_int_value(raw.get("detail_duration_ms")),
    greeting_result_elapsed_ms=_int_value(raw.get("greeting_result_elapsed_ms")),
    total_events=_int_value(raw.get("total_events") or raw.get("event_count")),
    source_row_count=_int_value(raw.get("source_row_count")),
    recorded_at=_parse_minute(raw.get("calculated_at") or raw.get("recorded_at") or raw.get("__TIMESTAMP__")),
    has_values=has_values,
    value_status=_clean_string(raw.get("value_status")) or ("ok" if has_values else "missing_values"),
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


def _daily_basic_query_window(
  config,
  *,
  active_date: date | str | None,
  lookback_days: int | None,
  now: datetime | None,
) -> tuple[datetime, datetime]:
  end_at = now or datetime.now(timezone.utc)
  if end_at.tzinfo is None:
    end_at = end_at.replace(tzinfo=timezone.utc)
  local_tz = _timezone(config.timezone_name)
  target_date = _parse_date(active_date)
  if target_date is not None:
    local_start = datetime(target_date.year, target_date.month, target_date.day, tzinfo=local_tz)
    start_at = local_start.astimezone(timezone.utc)
    max_end_at = (local_start + timedelta(days=3)).astimezone(timezone.utc)
    if end_at <= start_at:
      return start_at, max_end_at
    return start_at, min(end_at, max_end_at)
  if lookback_days is not None:
    safe_days = max(1, min(int(lookback_days), 366))
    local_end = end_at.astimezone(local_tz)
    start_date = local_end.date() - timedelta(days=safe_days - 1)
    local_start = datetime(start_date.year, start_date.month, start_date.day, tzinfo=local_tz)
    return local_start.astimezone(timezone.utc), end_at
  if config.window_mode == "today":
    local_end = end_at.astimezone(local_tz)
    start_at = local_end.replace(hour=0, minute=0, second=0, microsecond=0).astimezone(timezone.utc)
    return start_at, end_at
  return datetime.fromtimestamp(end_at.timestamp() - config.window_minutes * 60, tz=timezone.utc), end_at


def _daily_basic_metric_query(
  *,
  active_date: date | str | None,
  operator_id: str | None,
) -> str:
  matchers = [("metric_name", DAILY_BASIC_STATS_METRIC_NAME)]
  target_date = _parse_date(active_date)
  if target_date is not None:
    matchers.append(("active_date", target_date.isoformat()))
  operator_filter = _clean_dimension(operator_id)
  if operator_filter is not None:
    matchers.append(("operator_id", operator_filter))
  return "{" + ",".join(
    f'{key}="{_escape_promql_label_value(value)}"'
    for key, value in matchers
  ) + "}"


def _daily_basic_row_from_metric_labels(labels: Mapping[str, Any]) -> dict[str, Any]:
  return {
    "metric_name": _clean_string(labels.get("metric_name")) or DAILY_BASIC_STATS_METRIC_NAME,
    "active_date": _clean_string(labels.get("active_date")),
    "operator_id": _clean_string(labels.get("operator_id") or labels.get("operatorId")),
    "operator_account_name": _clean_string(
      labels.get("operator_account_name") or labels.get("operatorAccountName")
    ),
    "boss_account_name": _clean_string(labels.get("boss_account_name") or labels.get("bossAccountName")),
    "boss_account_matched": _clean_string(
      labels.get("boss_account_matched") or labels.get("bossAccountMatched")
    ),
    "first_active_minute": _clean_string(
      labels.get("first_active_minute") or labels.get("firstActiveMinute")
    ),
    "last_active_minute": _clean_string(
      labels.get("last_active_minute") or labels.get("lastActiveMinute")
    ),
  }


def _latest_metric_sample(series: Mapping[str, Any]) -> tuple[int, str] | None:
  values = series.get("values")
  if isinstance(values, list):
    for item in reversed(values):
      sample = _metric_sample(item)
      if sample is not None:
        return sample
  return _metric_sample(series.get("value"))


def _metric_sample(value: Any) -> tuple[int, str] | None:
  if not isinstance(value, (list, tuple)) or len(value) < 2:
    return None
  try:
    timestamp = int(float(value[0]))
  except (TypeError, ValueError):
    return None
  sample_value = _clean_string(value[1])
  if sample_value is None or sample_value.lower() in {"nan", "+nan", "-nan", "inf", "+inf", "-inf"}:
    return None
  return timestamp, sample_value


def _escape_promql_label_value(value: str) -> str:
  return value.replace("\\", "\\\\").replace("\n", "\\n").replace('"', '\\"')


def _metric_range_step_seconds(
  start_at: datetime,
  end_at: datetime,
  *,
  max_points: int = 10_000,
) -> int:
  duration_seconds = max(0, int(end_at.timestamp() - start_at.timestamp()))
  safe_max_points = max(1, int(max_points))
  return max(60, (duration_seconds + safe_max_points - 1) // safe_max_points)


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
  if "active_date" in keys and keys & set(DAILY_BASIC_METRIC_FIELDS) and keys & {
    "total_events",
    "observed_minutes",
    "session_count",
    "card_unique_candidates",
    "detail_closed",
    "source_row_count",
  }:
    return DAILY_BASIC_STATS_METRIC_NAME
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
  return value.replace(tzinfo=_timezone("Asia/Shanghai"))


def _timezone(timezone_name: str) -> ZoneInfo | timezone:
  try:
    return ZoneInfo(timezone_name)
  except ZoneInfoNotFoundError:
    return timezone.utc


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


def _bool_value(value: Any, *, default: bool = False) -> bool:
  if value is None:
    return default
  if isinstance(value, bool):
    return value
  if isinstance(value, (int, float)):
    return bool(value)
  if isinstance(value, str):
    normalized = value.strip().lower()
    if normalized in {"1", "true", "yes", "y", "on"}:
      return True
    if normalized in {"0", "false", "no", "n", "off"}:
      return False
  return default
