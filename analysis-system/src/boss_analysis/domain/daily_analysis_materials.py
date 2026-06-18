"""Fact-only input materials for offline daily analysis."""

from __future__ import annotations

import re
from collections.abc import Iterable, Mapping
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from typing import Any

from boss_analysis.domain.operators import OperatorProfile
from boss_analysis.domain.summary import DailyBasicStatsRecord

HISTORICAL_DAYS = 14
DAILY_BASIC_STATS_METRIC_NAME = "boss_daily_operator_basic_stats"

DAILY_BASIC_FACT_FIELDS: tuple[str, ...] = (
  "active_minutes",
  "active_seconds",
  "observed_minutes",
  "session_count",
  "touched_job_count",
  "card_exposed",
  "detail_opened",
  "detail_closed",
  "greeting_clicked",
  "greeting_succeeded",
  "greeting_failed",
  "chat_opened",
  "boss_reply_count",
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
  "chat_conversation_count",
  "boss_ended_conversation_count",
  "total_events",
  "source_row_count",
)

OPERATION_OVERVIEW_FIELDS: tuple[str, ...] = (
  "detail_open_count",
  "greeting_count",
  "chat_open_count",
  "chat_reply_count",
  "job_operation_count",
  "active_minutes",
  "source_event_count",
)

DETAIL_COLLECTIONS: tuple[str, ...] = (
  "detail_open_events",
  "greeting_events",
  "chat_progress_events",
  "job_operation_events",
  "timeline_windows",
)

ALLOWED_DETAIL_FIELDS: dict[str, tuple[str, ...]] = {
  "detail_open_events": (
    "occurred_at",
    "operator_id",
    "job_key",
    "candidate_local_id",
    "source_event_id",
  ),
  "greeting_events": (
    "occurred_at",
    "operator_id",
    "job_key",
    "result_state",
    "source_event_id",
  ),
  "chat_progress_events": (
    "occurred_at",
    "operator_id",
    "job_key",
    "progress_state",
    "source_event_id",
  ),
  "job_operation_events": (
    "occurred_at",
    "operator_id",
    "job_key",
    "operation",
    "source_event_id",
  ),
  "timeline_windows": (
    "window_start",
    "window_end",
    "operator_id",
    "job_key",
    "operation_counts",
    "source_event_ids",
  ),
}


@dataclass(frozen=True)
class OperatorProfileIndex:
  operator_ids: Mapping[str, "IndexedOperatorProfile"]
  unique_identities: Mapping[str, "IndexedOperatorProfile"]
  ambiguous_identities: frozenset[str]


@dataclass(frozen=True)
class IndexedOperatorProfile:
  operator_id: str
  profile: OperatorProfile


def historical_window_14d(target_date: date) -> dict[str, Any]:
  start_date, end_date = _historical_date_bounds(target_date)
  return {
    "start_date": start_date.isoformat(),
    "end_date": end_date.isoformat(),
    "days": HISTORICAL_DAYS,
    "includes_target_date": False,
  }


def build_historical_effects_14d(
  target_date: date,
  records: Iterable[DailyBasicStatsRecord],
  operator_profiles: Iterable[OperatorProfile],
) -> dict[str, Any]:
  window = historical_window_14d(target_date)
  enabled_profiles = tuple(profile for profile in operator_profiles if profile.enabled)
  profile_index = operator_profile_index(enabled_profiles)
  start_date, end_date = _historical_date_bounds(target_date)
  source_records = tuple(
    record
    for record in records
    if record.metric_name == DAILY_BASIC_STATS_METRIC_NAME
  )
  matched_records = [
    (record, profile)
    for record in source_records
    if _date_in_window(record.active_date, start_date, end_date)
    for profile in [_profile_for_record(profile_index, record)]
    if profile is not None
  ]
  daily_rows = [
    _daily_basic_row(record, profile)
    for record, profile in _dedupe_daily_records(matched_records)
  ]
  daily_rows.sort(key=lambda item: (item["operator_id"], item["active_date"]))
  return {
    "source_state": _source_state(
      source_count=len(source_records),
      row_count=len(daily_rows),
      expected_days=HISTORICAL_DAYS,
      enabled_operator_ids=set(profile_index.operator_ids.keys()),
      covered_days_by_operator=_covered_days_by_operator(daily_rows),
    ),
    "window": window,
    "operator_daily_rows": daily_rows,
    "operator_rollups": _rollup_daily_rows(daily_rows),
  }


def build_operation_overview_14d(
  target_date: date,
  rows: Iterable[Mapping[str, Any]],
  operator_profiles: Iterable[OperatorProfile],
) -> dict[str, Any]:
  window = historical_window_14d(target_date)
  enabled_profiles = tuple(profile for profile in operator_profiles if profile.enabled)
  profile_index = operator_profile_index(enabled_profiles)
  start_date, end_date = _historical_date_bounds(target_date)
  source_count = 0
  matched_rows: list[dict[str, Any]] = []
  for row in rows:
    source_count += 1
    active_date = _parse_active_date(row.get("active_date"))
    if active_date is None or not _date_in_window(active_date, start_date, end_date):
      continue
    profile = _profile_for_operation_row(profile_index, row)
    if profile is None:
      continue
    matched_rows.append(_operation_overview_row(row, profile))
  deduped_rows = _dedupe_operation_overview_rows(matched_rows)
  deduped_rows.sort(key=lambda item: (item["operator_id"], item["active_date"]))
  return {
    "source_state": _source_state(
      source_count=source_count,
      row_count=len(deduped_rows),
      expected_days=HISTORICAL_DAYS,
      enabled_operator_ids=set(profile_index.operator_ids.keys()),
      covered_days_by_operator=_covered_days_by_operator(deduped_rows),
    ),
    "window": window,
    "operator_daily_rows": deduped_rows,
    "operator_rollups": _rollup_rows(deduped_rows, OPERATION_OVERVIEW_FIELDS),
  }


def build_operation_details(
  *,
  target_date: date,
  value: Mapping[str, Any] | None,
  operator_profiles: Iterable[OperatorProfile],
) -> dict[str, Any]:
  if value is None:
    return _empty_operation_details(
      target_date,
      source_state="not_loaded",
      data_gaps=["operation_details"],
    )
  if not isinstance(value, Mapping):
    return _empty_operation_details(
      target_date,
      source_state="partial",
      data_gaps=["operation_details"],
    )

  enabled_profiles = tuple(profile for profile in operator_profiles if profile.enabled)
  profile_index = operator_profile_index(enabled_profiles)
  output = _empty_operation_details(target_date, source_state="loaded", data_gaps=[])
  source_count = 0
  kept_count = 0
  has_quality_gap = False

  def _add_gap(gap: str) -> None:
    if gap not in output["data_gaps"]:
      output["data_gaps"].append(gap)

  for collection in DETAIL_COLLECTIONS:
    if collection not in value:
      raw_items = []
    else:
      raw_items = value.get(collection)
      if not isinstance(raw_items, list):
        has_quality_gap = True
        _add_gap(f"operation_details.{collection}")
        continue

    for raw_item in raw_items:
      source_count += 1
      if not isinstance(raw_item, Mapping):
        has_quality_gap = True
        _add_gap(f"operation_details.{collection}")
        continue
      sanitized = _sanitize_detail_item(collection, raw_item)
      if not _detail_item_matches_date(
        collection,
        sanitized,
        target_date,
      ):
        continue
      indexed_profile = _profile_for_operator(profile_index, sanitized.get("operator_id"))
      if indexed_profile is None:
        continue
      sanitized["operator_id"] = indexed_profile.operator_id
      output[collection].append(sanitized)
      kept_count += 1

  if has_quality_gap or (source_count > 0 and kept_count == 0):
    output["source_state"] = "partial"
  elif source_count == 0:
    output["source_state"] = "not_loaded"
    if "operation_details" not in output["data_gaps"]:
      output["data_gaps"].append("operation_details")

  return output


def _sanitize_operation_counts(raw_value: Any) -> dict[str, int]:
  if not isinstance(raw_value, Mapping):
    return {}
  output: dict[str, int] = {}
  for key, value in raw_value.items():
    if not isinstance(key, str):
      continue
    parsed_value = _to_int_if_convertible(value)
    if parsed_value is None:
      continue
    output[key] = parsed_value
  return output


def _sanitize_source_event_ids(raw_value: Any) -> list[str]:
  if not isinstance(raw_value, (list, tuple)):
    return []
  output: list[str] = []
  for item in raw_value:
    if not isinstance(item, (str, int, float, bool)):
      continue
    text = str(item).strip()
    if _is_valid_source_event_id(text):
      output.append(text)
  return output


_SAFE_SOURCE_EVENT_ID = re.compile(r"^[A-Za-z0-9_.:-]{1,128}$")


def _is_valid_source_event_id(value: str) -> bool:
  if not isinstance(value, str):
    return False
  if not _SAFE_SOURCE_EVENT_ID.fullmatch(value):
    return False
  if "://" in value:
    return False
  if value.isdigit() and len(value) >= 11:
    return False
  return True


def _empty_operation_details(
  target_date: date,
  *,
  source_state: str,
  data_gaps: list[str],
) -> dict[str, Any]:
  return {
    "source_state": source_state,
    "target_date": target_date.isoformat(),
    "detail_open_events": [],
    "greeting_events": [],
    "chat_progress_events": [],
    "job_operation_events": [],
    "timeline_windows": [],
    "data_gaps": list(data_gaps),
  }


def _sanitize_detail_item(
  collection: str,
  raw_item: Mapping[str, Any],
) -> dict[str, Any]:
  allowed = ALLOWED_DETAIL_FIELDS[collection]
  sanitized = {
    field_name: raw_item.get(field_name)
    for field_name in allowed
    if raw_item.get(field_name) is not None
  }
  if "operation_counts" in sanitized:
    sanitized["operation_counts"] = _sanitize_operation_counts(
      sanitized.get("operation_counts")
    )
  if "source_event_id" in sanitized:
    text = str(sanitized.get("source_event_id")).strip()
    if _is_valid_source_event_id(text):
      sanitized["source_event_id"] = text
    else:
      sanitized.pop("source_event_id", None)
  if "source_event_ids" in sanitized:
    sanitized_source_event_ids = _sanitize_source_event_ids(
      raw_item.get("source_event_ids")
    )
    if isinstance(raw_item.get("source_event_ids"), (list, tuple)):
      sanitized["source_event_ids"] = sanitized_source_event_ids
    else:
      sanitized.pop("source_event_ids", None)
  return sanitized


def _detail_item_matches_date(
  collection: str,
  item: Mapping[str, Any],
  target_date: date,
) -> bool:
  raw_time = item.get("window_start") if collection == "timeline_windows" else item.get(
    "occurred_at"
  )
  parsed = _parse_active_date(raw_time)
  return parsed == target_date


def operator_profile_index(
  operator_profiles: Iterable[OperatorProfile],
) -> OperatorProfileIndex:
  operator_ids: dict[str, IndexedOperatorProfile] = {}
  identity_profiles: dict[str, list[IndexedOperatorProfile]] = {}
  for profile in operator_profiles:
    if not profile.enabled:
      continue
    operator_id_key = _operator_id_key(profile.operator_id)
    if not operator_id_key:
      raise ValueError(
        f"enabled operator_id must not be blank: {profile.operator_id!r}"
      )
    if operator_id_key in operator_ids:
      raise ValueError(f"duplicate enabled operator_id: {profile.operator_id}")
    indexed_profile = IndexedOperatorProfile(
      operator_id=operator_id_key,
      profile=profile,
    )
    operator_ids[operator_id_key] = indexed_profile
    for value in (profile.display_name, profile.account_name, *profile.aliases):
      key = _identity_key(value)
      if key:
        _append_identity_profile(identity_profiles, key, indexed_profile)
  ambiguous_identities = frozenset(
    key
    for key, profiles in identity_profiles.items()
    if len(profiles) > 1
  )
  unique_identities = {
    key: profiles[0]
    for key, profiles in identity_profiles.items()
    if len(profiles) == 1
  }
  return OperatorProfileIndex(
    operator_ids=operator_ids,
    unique_identities=unique_identities,
    ambiguous_identities=ambiguous_identities,
  )


def _append_identity_profile(
  identity_profiles: dict[str, list[IndexedOperatorProfile]],
  key: str,
  profile: IndexedOperatorProfile,
) -> None:
  profiles = identity_profiles.setdefault(key, [])
  if all(existing.operator_id != profile.operator_id for existing in profiles):
    profiles.append(profile)


def _profile_for_operator_id(
  profile_index: OperatorProfileIndex,
  value: Any,
) -> IndexedOperatorProfile | None:
  return profile_index.operator_ids.get(_operator_id_key(value))


def _profile_for_operator(
  profile_index: OperatorProfileIndex,
  value: Any,
) -> IndexedOperatorProfile | None:
  profile = _profile_for_operator_id(profile_index, value)
  if profile is not None:
    return profile
  return _profile_for_identity(profile_index, value)


def _profile_for_identity(
  profile_index: OperatorProfileIndex,
  value: Any,
) -> IndexedOperatorProfile | None:
  key = _identity_key(value)
  if key in profile_index.ambiguous_identities:
    return None
  return profile_index.unique_identities.get(key)


def _profile_for_record(
  profile_index: OperatorProfileIndex,
  record: DailyBasicStatsRecord,
) -> IndexedOperatorProfile | None:
  profile = _profile_for_operator_id(profile_index, record.operator_id)
  if profile is not None:
    return profile
  for value in (
    record.operator_account_name,
    record.boss_account_name,
    record.boss_account_matched,
  ):
    profile = _profile_for_identity(profile_index, value)
    if profile is not None:
      return profile
  return None


def _profile_for_operation_row(
  profile_index: OperatorProfileIndex,
  row: Mapping[str, Any],
) -> IndexedOperatorProfile | None:
  profile = _profile_for_operator_id(profile_index, row.get("operator_id"))
  if profile is not None:
    return profile
  for value in (
    row.get("display_name"),
    row.get("operator_name"),
    row.get("operator_account_name"),
    row.get("boss_name"),
    row.get("boss_account_name"),
    row.get("boss_account_matched"),
  ):
    profile = _profile_for_identity(profile_index, value)
    if profile is not None:
      return profile
  return None


def _operation_overview_row(
  row: Mapping[str, Any],
  profile: IndexedOperatorProfile,
) -> dict[str, Any]:
  return {
    "active_date": _normalize_date(row.get("active_date")),
    "operator_id": profile.operator_id,
    "display_name": profile.profile.display_name,
    "source_state": _clean_string(row.get("source_state")),
    **{
      field_name: _to_int(row.get(field_name))
      for field_name in OPERATION_OVERVIEW_FIELDS
    },
  }


def _historical_date_bounds(target_date: date) -> tuple[date, date]:
  return (
    target_date - timedelta(days=HISTORICAL_DAYS),
    target_date - timedelta(days=1),
  )


def _date_in_window(value: date, start_date: date, end_date: date) -> bool:
  return start_date <= value <= end_date


def _daily_basic_row(
  record: DailyBasicStatsRecord,
  profile: IndexedOperatorProfile,
) -> dict[str, Any]:
  row: dict[str, Any] = {
    "active_date": record.active_date.isoformat(),
    "operator_id": profile.operator_id,
    "display_name": profile.profile.display_name,
    "operator_account_name": record.operator_account_name,
    "boss_account_name": record.boss_account_name,
    "boss_account_matched": record.boss_account_matched,
    "first_active_minute": record.first_active_minute.isoformat() if record.first_active_minute else None,
    "last_active_minute": record.last_active_minute.isoformat() if record.last_active_minute else None,
    "recorded_at": record.recorded_at.isoformat() if record.recorded_at else None,
  }
  for field_name in DAILY_BASIC_FACT_FIELDS:
    row[field_name] = int(getattr(record, field_name, 0) or 0)
  return row


def _dedupe_daily_records(
  matched_records: list[tuple[DailyBasicStatsRecord, IndexedOperatorProfile]],
) -> list[tuple[DailyBasicStatsRecord, IndexedOperatorProfile]]:
  selected: dict[tuple[str, date], tuple[DailyBasicStatsRecord, IndexedOperatorProfile]] = {}
  for record, profile in matched_records:
    key = (profile.operator_id, record.active_date)
    existing = selected.get(key)
    if existing is None or _record_rank(record) > _record_rank(existing[0]):
      selected[key] = (record, profile)
  return list(selected.values())


def _dedupe_operation_overview_rows(
  rows: list[dict[str, Any]],
) -> list[dict[str, Any]]:
  selected: dict[tuple[str, str], dict[str, Any]] = {}
  for row in rows:
    key = (str(row["operator_id"]), str(row["active_date"]))
    existing = selected.get(key)
    if existing is None or _operation_overview_row_rank(row) > _operation_overview_row_rank(
      existing
    ):
      selected[key] = row
  return list(selected.values())


def _operation_overview_row_rank(
  row: Mapping[str, Any],
) -> tuple[int, int, int, tuple[Any, ...]]:
  field_sum = sum(_to_int(row.get(field_name, 0)) for field_name in OPERATION_OVERVIEW_FIELDS)
  stable_tuple = (
    str(row.get("operator_id", "")),
    str(row.get("active_date", "")),
    str(row.get("display_name", "")),
    tuple(_to_int(row.get(field_name, 0)) for field_name in OPERATION_OVERVIEW_FIELDS),
    _clean_string(row.get("source_state")),
  )
  return (
    _to_int(row.get("source_event_count")),
    field_sum,
    _operation_overview_source_state_rank(row.get("source_state")),
    stable_tuple,
  )


def _operation_overview_source_state_rank(value: Any) -> int:
  normalized = _clean_string(value).lower()
  if normalized == "loaded":
    return 2
  if normalized == "partial":
    return 1
  if normalized == "not_loaded":
    return 0
  return -1


def _record_rank(
  record: DailyBasicStatsRecord,
) -> tuple[tuple[int, float], int, int, tuple[int, ...], tuple[str, ...]]:
  return (
    _recorded_at_rank(record.recorded_at),
    int(record.source_row_count or 0),
    int(record.total_events or 0),
    tuple(int(getattr(record, field_name, 0) or 0) for field_name in DAILY_BASIC_FACT_FIELDS),
    _stable_row_field_rank(record),
  )


def _stable_row_field_rank(record: DailyBasicStatsRecord) -> tuple[str, ...]:
  return (
    _clean_string(record.operator_id),
    _clean_string(record.operator_account_name),
    _clean_string(record.boss_account_name),
    _clean_string(record.boss_account_matched),
    record.first_active_minute.isoformat() if record.first_active_minute else "",
    record.last_active_minute.isoformat() if record.last_active_minute else "",
    record.recorded_at.isoformat() if record.recorded_at else "",
  )


def _recorded_at_rank(value: datetime | None) -> tuple[int, float]:
  if value is None:
    return (0, 0.0)
  if value.tzinfo is None:
    value = value.replace(tzinfo=timezone.utc)
  return (1, value.timestamp())


def _rollup_rows(
  rows: list[dict[str, Any]],
  fields: tuple[str, ...],
) -> list[dict[str, Any]]:
  by_operator: dict[str, list[dict[str, Any]]] = {}
  for row in rows:
    by_operator.setdefault(str(row["operator_id"]), []).append(row)
  rollups: list[dict[str, Any]] = []
  for operator_id, operator_rows in sorted(by_operator.items()):
    totals = {
      field_name: sum(_to_int(row.get(field_name, 0)) for row in operator_rows)
      for field_name in fields
    }
    covered_days = len({str(row["active_date"]) for row in operator_rows})
    daily_averages = {
      field_name: round(total / covered_days, 2) if covered_days else 0.0
      for field_name, total in totals.items()
    }
    rollups.append({
      "operator_id": operator_id,
      "display_name": str(operator_rows[0].get("display_name", "")),
      "covered_days": covered_days,
      "totals": totals,
      "daily_averages": daily_averages,
    })
  return rollups


def _rollup_daily_rows(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
  return _rollup_rows(rows, DAILY_BASIC_FACT_FIELDS)


def _covered_days_by_operator(rows: list[dict[str, Any]]) -> dict[str, set[str]]:
  covered_days: dict[str, set[str]] = {}
  for row in rows:
    covered_days.setdefault(str(row["operator_id"]), set()).add(str(row["active_date"]))
  return covered_days


def _source_state(
  *,
  source_count: int,
  row_count: int,
  expected_days: int,
  enabled_operator_ids: set[str],
  covered_days_by_operator: Mapping[str, set[str]],
) -> str:
  if source_count == 0:
    return "not_loaded"
  if not enabled_operator_ids:
    return "not_loaded"
  if row_count == 0:
    return "partial"
  for operator_id in enabled_operator_ids:
    if len(covered_days_by_operator.get(operator_id, set())) < expected_days:
      return "partial"
  return "loaded"


def _clean_string(value: Any) -> str:
  if value is None:
    return ""
  return str(value).strip()


def _normalize_date(value: Any) -> str:
  active_date = _parse_active_date(value)
  return active_date.isoformat() if active_date is not None else ""


def _parse_active_date(value: Any) -> date | None:
  if value is None:
    return None
  if isinstance(value, datetime):
    return value.date()
  if isinstance(value, date):
    return value
  raw = _clean_string(value)
  if not raw:
    return None
  try:
    return date.fromisoformat(raw)
  except ValueError:
    pass
  try:
    normalized = raw[:-1] + "+00:00" if raw.endswith("Z") else raw
    return datetime.fromisoformat(normalized).date()
  except ValueError:
    return None


def _to_int(value: Any) -> int:
  if isinstance(value, bool):
    return int(value)
  if isinstance(value, int):
    return value
  if isinstance(value, float):
    return int(value)
  if value is None:
    return 0
  try:
    return int(_clean_string(value))
  except ValueError:
    try:
      return int(float(_clean_string(value)))
    except (TypeError, ValueError):
      return 0


def _to_int_if_convertible(value: Any) -> int | None:
  if isinstance(value, bool):
    return int(value)
  if isinstance(value, int):
    return value
  if isinstance(value, float):
    return int(value)
  if value is None:
    return None
  try:
    raw = _clean_string(value)
    if not raw:
      return None
    return int(raw)
  except ValueError:
    try:
      return int(float(raw))
    except (TypeError, ValueError):
      return None
  except TypeError:
    return None


def _identity_key(value: Any) -> str:
  return _clean_string(value).casefold()


def _operator_id_key(value: Any) -> str:
  return _clean_string(value)
