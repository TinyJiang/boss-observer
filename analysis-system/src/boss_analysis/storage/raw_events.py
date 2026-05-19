"""Raw event repository implementations."""

from __future__ import annotations

from collections.abc import Callable
from datetime import datetime, timezone
from typing import Any

from boss_analysis.domain import (
  ErrorStage,
  EventErrorRecord,
  NormalizedEvent,
  RawEventRecord,
  RawEventSaveResult,
  ReplayFilter,
)

PREVIEW_LIMIT = 512


class InMemoryRawEventRepository:
  """In-memory repository for tests and early local development.

  The production repository can keep the same public behavior while swapping
  this storage with PostgreSQL.
  """

  def __init__(self, *, clock: Callable[[], datetime] | None = None) -> None:
    self._clock = clock or _utc_now
    self._raw_events: dict[str, RawEventRecord] = {}
    self._errors: list[EventErrorRecord] = []
    self._error_sequence = 0

  def save_normalized_event(self, event: NormalizedEvent) -> RawEventSaveResult:
    """Idempotently save one normalized event and record parse errors."""

    if event.event_id is None:
      errors = tuple(self._record_parse_errors(event))
      return RawEventSaveResult(record=None, inserted=False, errors_recorded=errors)

    existing = self._raw_events.get(event.event_id)
    if existing is not None:
      return RawEventSaveResult(record=existing, inserted=False, errors_recorded=())

    record = RawEventRecord(
      event_id=event.event_id,
      event_type=event.event_type,
      occurred_at=event.occurred_at,
      occurred_at_raw=event.occurred_at_raw,
      received_at=event.received_at,
      plugin_version=event.plugin_version,
      operator_id=event.operator_id,
      operator_account_name=event.operator_account_name,
      boss_account_name=event.boss_account_name,
      boss_account_matched=event.boss_account_matched,
      session_id=event.session_id,
      page_type=event.page_type,
      page_url=event.page_url,
      page_title=event.page_title,
      job_id=event.job_id,
      job_status=event.job_status,
      source_tab_id=event.source_tab_id,
      source_window_id=event.source_window_id,
      source_tab_url=event.source_tab_url,
      payload_json=event.raw.get("payload_json"),
      context_json=event.raw.get("context_json"),
      raw_cls_json=dict(event.raw),
      parse_status=event.parse_status,
      parse_errors=event.parse_errors,
      created_at=self._clock(),
    )
    self._raw_events[event.event_id] = record
    errors = tuple(self._record_parse_errors(event))
    return RawEventSaveResult(record=record, inserted=True, errors_recorded=errors)

  def get_raw_event(self, event_id: str) -> RawEventRecord | None:
    return self._raw_events.get(event_id)

  def record_error(
    self,
    *,
    event_id: str | None,
    event_type: str | None,
    error_stage: ErrorStage,
    error_message: str,
    payload_preview: str | None = None,
    context_preview: str | None = None,
    occurred_at: datetime | None = None,
    source_error_code: str | None = None,
    field: str | None = None,
  ) -> EventErrorRecord:
    self._error_sequence += 1
    error = EventErrorRecord(
      id=f"err_{self._error_sequence:06d}",
      event_id=event_id,
      event_type=event_type,
      error_stage=error_stage,
      error_message=error_message,
      payload_preview=_truncate_preview(payload_preview),
      context_preview=_truncate_preview(context_preview),
      occurred_at=occurred_at,
      created_at=self._clock(),
      source_error_code=source_error_code,
      field=field,
    )
    self._errors.append(error)
    return error

  def list_errors(self, *, event_id: str | None = None) -> tuple[EventErrorRecord, ...]:
    if event_id is None:
      return tuple(self._errors)
    return tuple(error for error in self._errors if error.event_id == event_id)

  def replay_raw_events(self, replay_filter: ReplayFilter | None = None) -> tuple[RawEventRecord, ...]:
    selected = [
      record
      for record in self._raw_events.values()
      if _matches_replay_filter(record, replay_filter)
    ]
    return tuple(sorted(selected, key=_replay_sort_key))

  def _record_parse_errors(self, event: NormalizedEvent) -> list[EventErrorRecord]:
    recorded: list[EventErrorRecord] = []
    for issue in event.parse_errors:
      recorded.append(
        self.record_error(
          event_id=event.event_id,
          event_type=event.event_type,
          error_stage="normalize",
          error_message=issue.message,
          payload_preview=_preview_from_raw(event.raw.get("payload_json")),
          context_preview=_preview_from_raw(event.raw.get("context_json")),
          occurred_at=event.occurred_at,
          source_error_code=issue.code,
          field=issue.field,
        )
      )
    return recorded


def _matches_replay_filter(
  record: RawEventRecord,
  replay_filter: ReplayFilter | None,
) -> bool:
  if replay_filter is None:
    return True
  if replay_filter.event_types is not None and record.event_type not in replay_filter.event_types:
    return False
  if replay_filter.plugin_versions is not None and record.plugin_version not in replay_filter.plugin_versions:
    return False
  if replay_filter.parse_statuses is not None and record.parse_status not in replay_filter.parse_statuses:
    return False
  if replay_filter.occurred_from is not None:
    if record.occurred_at is None or record.occurred_at < replay_filter.occurred_from:
      return False
  if replay_filter.occurred_to is not None:
    if record.occurred_at is None or record.occurred_at > replay_filter.occurred_to:
      return False
  return True


def _replay_sort_key(record: RawEventRecord) -> tuple[datetime, str]:
  occurred_at = record.occurred_at or datetime.max.replace(tzinfo=timezone.utc)
  return (occurred_at, record.event_id)


def _preview_from_raw(value: Any) -> str | None:
  if value is None:
    return None
  return _truncate_preview(str(value))


def _truncate_preview(value: str | None) -> str | None:
  if value is None:
    return None
  if len(value) <= PREVIEW_LIMIT:
    return value
  return value[:PREVIEW_LIMIT]


def _utc_now() -> datetime:
  return datetime.now(timezone.utc)
