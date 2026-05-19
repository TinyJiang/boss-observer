"""Normalize flattened CLS log records into internal event objects."""

from __future__ import annotations

import json
from collections.abc import Mapping
from datetime import datetime, timezone
from typing import Any

from boss_analysis.domain import NormalizedEvent, ParseIssue, ParseStatus

REQUIRED_FIELDS = ("event_id", "event_type", "occurred_at")

EXPECTED_OPTIONAL_FIELDS = (
  "plugin_version",
  "operator_id",
  "operator_account_name",
  "boss_account_name",
  "boss_account_matched",
  "session_id",
  "page_type",
  "page_url",
  "payload_json",
  "context_json",
)

TRUE_STRINGS = {"true", "1", "yes", "y", "on"}
FALSE_STRINGS = {"false", "0", "no", "n", "off"}


def normalize_cls_event(
  raw_record: Mapping[str, Any],
  *,
  received_at: datetime | None = None,
) -> NormalizedEvent:
  """Normalize one CLS flattened log record.

  The normalizer is deliberately conservative: unknown event types are valid,
  malformed optional fields make the event partial, and missing/invalid
  required fields make it failed while preserving the raw record.
  """

  raw = dict(raw_record)
  parse_errors: list[ParseIssue] = []
  received_at_value = _normalize_received_at(received_at)

  for field in REQUIRED_FIELDS:
    if _is_blank(raw.get(field)):
      parse_errors.append(
        ParseIssue(
          field=field,
          code="missing_required",
          message=f"Missing required field: {field}",
          raw_value=raw.get(field),
        )
      )

  for field in EXPECTED_OPTIONAL_FIELDS:
    if field not in raw:
      parse_errors.append(
        ParseIssue(
          field=field,
          code="missing_optional",
          message=f"Missing optional CLS field: {field}",
        )
      )

  event_id = _clean_string(raw.get("event_id"))
  event_type = _clean_string(raw.get("event_type"))
  occurred_at_raw = _clean_string(raw.get("occurred_at"))
  occurred_at = _parse_datetime(raw.get("occurred_at"), "occurred_at", parse_errors)

  payload = _parse_json_field(raw.get("payload_json"), "payload_json", parse_errors)
  context = _parse_json_field(raw.get("context_json"), "context_json", parse_errors)
  boss_account_matched = _coerce_optional_bool(
    raw.get("boss_account_matched"),
    "boss_account_matched",
    parse_errors,
  )

  parse_status = _determine_parse_status(parse_errors)

  return NormalizedEvent(
    raw=raw,
    event_id=event_id,
    event_type=event_type,
    occurred_at=occurred_at,
    occurred_at_raw=occurred_at_raw,
    received_at=received_at_value,
    plugin_version=_clean_string(raw.get("plugin_version")),
    operator_id=_clean_string(raw.get("operator_id")),
    operator_account_name=_clean_string(raw.get("operator_account_name")),
    boss_account_name=_clean_string(raw.get("boss_account_name")),
    boss_account_matched=boss_account_matched,
    session_id=_clean_string(raw.get("session_id")),
    page_type=_clean_string(raw.get("page_type")),
    page_url=_clean_string(raw.get("page_url")),
    page_title=_clean_string(raw.get("page_title")),
    job_id=_clean_string(raw.get("job_id")),
    job_status=_clean_string(raw.get("job_status")),
    source_tab_id=_clean_string(raw.get("source_tab_id")),
    source_window_id=_clean_string(raw.get("source_window_id")),
    source_tab_url=_clean_string(raw.get("source_tab_url")),
    payload=payload,
    context=context,
    parse_status=parse_status,
    parse_errors=tuple(parse_errors),
  )


def _normalize_received_at(received_at: datetime | None) -> datetime:
  if received_at is None:
    return datetime.now(timezone.utc)
  if received_at.tzinfo is None:
    return received_at.replace(tzinfo=timezone.utc)
  return received_at


def _clean_string(value: Any) -> str | None:
  if value is None:
    return None
  if isinstance(value, str):
    stripped = value.strip()
    return stripped or None
  return str(value)


def _is_blank(value: Any) -> bool:
  if value is None:
    return True
  if isinstance(value, str):
    return value.strip() == ""
  return False


def _parse_datetime(
  value: Any,
  field: str,
  parse_errors: list[ParseIssue],
) -> datetime | None:
  if _is_blank(value):
    return None
  if isinstance(value, datetime):
    if value.tzinfo is None:
      return value.replace(tzinfo=timezone.utc)
    return value
  if not isinstance(value, str):
    parse_errors.append(
      ParseIssue(
        field=field,
        code="invalid_datetime_type",
        message=f"{field} must be an ISO 8601 string or datetime",
        raw_value=value,
      )
    )
    return None

  text = value.strip()
  if text.endswith("Z"):
    text = f"{text[:-1]}+00:00"
  try:
    parsed = datetime.fromisoformat(text)
  except ValueError:
    parse_errors.append(
      ParseIssue(
        field=field,
        code="invalid_datetime",
        message=f"{field} is not a valid ISO 8601 datetime",
        raw_value=value,
      )
    )
    return None
  if parsed.tzinfo is None:
    parse_errors.append(
      ParseIssue(
        field=field,
        code="missing_timezone",
        message=f"{field} has no timezone; assuming UTC",
        raw_value=value,
      )
    )
    return parsed.replace(tzinfo=timezone.utc)
  return parsed


def _parse_json_field(
  value: Any,
  field: str,
  parse_errors: list[ParseIssue],
) -> Any:
  if _is_blank(value):
    return None
  if isinstance(value, (dict, list)):
    return value
  if not isinstance(value, str):
    parse_errors.append(
      ParseIssue(
        field=field,
        code="invalid_json_type",
        message=f"{field} must be a JSON string, object, or array",
        raw_value=value,
      )
    )
    return None

  try:
    return json.loads(value)
  except json.JSONDecodeError as exc:
    parse_errors.append(
      ParseIssue(
        field=field,
        code="invalid_json",
        message=f"{field} is not valid JSON: {exc.msg}",
        raw_value=value,
      )
    )
    return None


def _coerce_optional_bool(
  value: Any,
  field: str,
  parse_errors: list[ParseIssue],
) -> bool | None:
  if _is_blank(value):
    return None
  if isinstance(value, bool):
    return value
  if isinstance(value, int) and value in (0, 1):
    return bool(value)
  if isinstance(value, str):
    normalized = value.strip().lower()
    if normalized in TRUE_STRINGS:
      return True
    if normalized in FALSE_STRINGS:
      return False
  parse_errors.append(
    ParseIssue(
      field=field,
      code="invalid_boolean",
      message=f"{field} is not a recognized boolean value",
      raw_value=value,
    )
  )
  return None


def _determine_parse_status(parse_errors: list[ParseIssue]) -> ParseStatus:
  if not parse_errors:
    return "parsed"
  failed_codes = {
    "missing_required",
    "invalid_datetime",
    "invalid_datetime_type",
  }
  if any(issue.code in failed_codes for issue in parse_errors):
    return "failed"
  return "partial"
