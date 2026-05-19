"""Storage-facing domain objects for raw events and replay."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Any, Literal, Protocol

from boss_analysis.domain.events import NormalizedEvent, ParseIssue, ParseStatus

ErrorStage = Literal["normalize", "raw_store", "fact_project", "aggregate", "replay"]


@dataclass(frozen=True)
class RawEventRecord:
  """Persisted representation of one raw CLS event."""

  event_id: str
  event_type: str | None
  occurred_at: datetime | None
  occurred_at_raw: str | None
  received_at: datetime
  plugin_version: str | None
  operator_id: str | None
  operator_account_name: str | None
  boss_account_name: str | None
  boss_account_matched: bool | None
  session_id: str | None
  page_type: str | None
  page_url: str | None
  page_title: str | None
  job_id: str | None
  job_status: str | None
  source_tab_id: str | None
  source_window_id: str | None
  source_tab_url: str | None
  payload_json: Any
  context_json: Any
  raw_cls_json: dict[str, Any]
  parse_status: ParseStatus
  parse_errors: tuple[ParseIssue, ...]
  created_at: datetime


@dataclass(frozen=True)
class EventErrorRecord:
  """Recorded parse, projection, aggregate, or replay error."""

  id: str
  event_id: str | None
  event_type: str | None
  error_stage: ErrorStage
  error_message: str
  payload_preview: str | None
  context_preview: str | None
  occurred_at: datetime | None
  created_at: datetime
  resolved_at: datetime | None = None
  source_error_code: str | None = None
  field: str | None = None


@dataclass(frozen=True)
class RawEventSaveResult:
  """Result of an idempotent raw-event write."""

  record: RawEventRecord | None
  inserted: bool
  errors_recorded: tuple[EventErrorRecord, ...]


@dataclass(frozen=True)
class ReplayFilter:
  """Filter for selecting raw events to replay."""

  occurred_from: datetime | None = None
  occurred_to: datetime | None = None
  event_types: frozenset[str] | None = None
  plugin_versions: frozenset[str] | None = None
  parse_statuses: frozenset[ParseStatus] | None = None


class RawEventRepository(Protocol):
  """Repository contract used by consumers, replayers, and projectors."""

  def save_normalized_event(self, event: NormalizedEvent) -> RawEventSaveResult:
    """Idempotently save one normalized event and its parse errors."""

  def get_raw_event(self, event_id: str) -> RawEventRecord | None:
    """Return one raw event by ID."""

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
    """Record a parse, projection, aggregate, or replay error."""

  def list_errors(self, *, event_id: str | None = None) -> tuple[EventErrorRecord, ...]:
    """List recorded errors, optionally scoped to one event."""

  def replay_raw_events(self, replay_filter: ReplayFilter | None = None) -> tuple[RawEventRecord, ...]:
    """Return raw events selected for replay."""
