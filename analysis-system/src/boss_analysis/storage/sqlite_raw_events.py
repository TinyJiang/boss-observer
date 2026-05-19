"""SQLite-backed raw event repository.

This implementation uses only Python's standard library. It is intended for
local development, tests, and as a behavioral bridge before the PostgreSQL
repository is introduced.
"""

from __future__ import annotations

import json
import sqlite3
from collections.abc import Callable
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from boss_analysis.domain import (
  ErrorStage,
  EventErrorRecord,
  NormalizedEvent,
  ParseIssue,
  ParseStatus,
  RawEventRecord,
  RawEventSaveResult,
  ReplayFilter,
)
from boss_analysis.security import safe_preview


class SQLiteRawEventRepository:
  """SQLite implementation of the raw event repository protocol."""

  def __init__(
    self,
    database_path: str | Path = ":memory:",
    *,
    clock: Callable[[], datetime] | None = None,
  ) -> None:
    self._clock = clock or _utc_now
    self._connection = sqlite3.connect(str(database_path))
    self._connection.row_factory = sqlite3.Row
    self._initialize_schema()

  def close(self) -> None:
    self._connection.close()

  def save_normalized_event(self, event: NormalizedEvent) -> RawEventSaveResult:
    if event.event_id is None:
      errors = tuple(self._record_parse_errors(event))
      self._connection.commit()
      return RawEventSaveResult(record=None, inserted=False, errors_recorded=errors)

    existing = self.get_raw_event(event.event_id)
    if existing is not None:
      return RawEventSaveResult(record=existing, inserted=False, errors_recorded=())

    created_at = self._clock()
    self._connection.execute(
      """
      INSERT INTO raw_events (
        event_id, event_type, occurred_at, occurred_at_raw, received_at,
        plugin_version, operator_id, operator_account_name, boss_account_name,
        boss_account_matched, session_id, page_type, page_url, page_title,
        job_id, job_status, source_tab_id, source_window_id, source_tab_url,
        payload_json, context_json, raw_cls_json, parse_status, parse_errors,
        created_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      """,
      (
        event.event_id,
        event.event_type,
        _datetime_to_text(event.occurred_at),
        event.occurred_at_raw,
        _datetime_to_text(event.received_at),
        event.plugin_version,
        event.operator_id,
        event.operator_account_name,
        event.boss_account_name,
        _bool_to_int(event.boss_account_matched),
        event.session_id,
        event.page_type,
        event.page_url,
        event.page_title,
        event.job_id,
        event.job_status,
        event.source_tab_id,
        event.source_window_id,
        event.source_tab_url,
        _raw_json_value(event.raw.get("payload_json")),
        _raw_json_value(event.raw.get("context_json")),
        _json_dumps(event.raw),
        event.parse_status,
        _json_dumps([_issue_to_dict(issue) for issue in event.parse_errors]),
        _datetime_to_text(created_at),
      ),
    )
    errors = tuple(self._record_parse_errors(event))
    self._connection.commit()
    record = self.get_raw_event(event.event_id)
    return RawEventSaveResult(record=record, inserted=True, errors_recorded=errors)

  def get_raw_event(self, event_id: str) -> RawEventRecord | None:
    row = self._connection.execute(
      "SELECT * FROM raw_events WHERE event_id = ?",
      (event_id,),
    ).fetchone()
    if row is None:
      return None
    return _raw_event_from_row(row)

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
    error_id = self._next_error_id()
    created_at = self._clock()
    self._connection.execute(
      """
      INSERT INTO event_parse_errors (
        id, event_id, event_type, error_stage, error_message, payload_preview,
        context_preview, occurred_at, created_at, resolved_at,
        source_error_code, field
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      """,
      (
        error_id,
        event_id,
        event_type,
        error_stage,
        error_message,
        safe_preview(payload_preview, limit=512),
        safe_preview(context_preview, limit=512),
        _datetime_to_text(occurred_at),
        _datetime_to_text(created_at),
        None,
        source_error_code,
        field,
      ),
    )
    self._connection.commit()
    return EventErrorRecord(
      id=error_id,
      event_id=event_id,
      event_type=event_type,
      error_stage=error_stage,
      error_message=error_message,
      payload_preview=safe_preview(payload_preview, limit=512),
      context_preview=safe_preview(context_preview, limit=512),
      occurred_at=occurred_at,
      created_at=created_at,
      source_error_code=source_error_code,
      field=field,
    )

  def list_errors(self, *, event_id: str | None = None) -> tuple[EventErrorRecord, ...]:
    if event_id is None:
      rows = self._connection.execute(
        "SELECT * FROM event_parse_errors ORDER BY id",
      ).fetchall()
    else:
      rows = self._connection.execute(
        "SELECT * FROM event_parse_errors WHERE event_id = ? ORDER BY id",
        (event_id,),
      ).fetchall()
    return tuple(_error_from_row(row) for row in rows)

  def replay_raw_events(self, replay_filter: ReplayFilter | None = None) -> tuple[RawEventRecord, ...]:
    rows = self._connection.execute("SELECT * FROM raw_events").fetchall()
    records = [_raw_event_from_row(row) for row in rows]
    selected = [
      record
      for record in records
      if _matches_replay_filter(record, replay_filter)
    ]
    return tuple(sorted(selected, key=_replay_sort_key))

  def _initialize_schema(self) -> None:
    self._connection.executescript(
      """
      CREATE TABLE IF NOT EXISTS raw_events (
        event_id TEXT PRIMARY KEY,
        event_type TEXT,
        occurred_at TEXT,
        occurred_at_raw TEXT,
        received_at TEXT NOT NULL,
        plugin_version TEXT,
        operator_id TEXT,
        operator_account_name TEXT,
        boss_account_name TEXT,
        boss_account_matched INTEGER,
        session_id TEXT,
        page_type TEXT,
        page_url TEXT,
        page_title TEXT,
        job_id TEXT,
        job_status TEXT,
        source_tab_id TEXT,
        source_window_id TEXT,
        source_tab_url TEXT,
        payload_json TEXT,
        context_json TEXT,
        raw_cls_json TEXT NOT NULL,
        parse_status TEXT NOT NULL,
        parse_errors TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_raw_events_event_type ON raw_events(event_type);
      CREATE INDEX IF NOT EXISTS idx_raw_events_operator_id ON raw_events(operator_id);
      CREATE INDEX IF NOT EXISTS idx_raw_events_occurred_at ON raw_events(occurred_at);
      CREATE INDEX IF NOT EXISTS idx_raw_events_parse_status ON raw_events(parse_status);

      CREATE TABLE IF NOT EXISTS event_parse_errors (
        id TEXT PRIMARY KEY,
        event_id TEXT,
        event_type TEXT,
        error_stage TEXT NOT NULL,
        error_message TEXT NOT NULL,
        payload_preview TEXT,
        context_preview TEXT,
        occurred_at TEXT,
        created_at TEXT NOT NULL,
        resolved_at TEXT,
        source_error_code TEXT,
        field TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_event_parse_errors_event_id ON event_parse_errors(event_id);
      CREATE INDEX IF NOT EXISTS idx_event_parse_errors_stage ON event_parse_errors(error_stage);
      """
    )
    self._connection.commit()

  def _record_parse_errors(self, event: NormalizedEvent) -> list[EventErrorRecord]:
    recorded: list[EventErrorRecord] = []
    for issue in event.parse_errors:
      recorded.append(
        self.record_error(
          event_id=event.event_id,
          event_type=event.event_type,
          error_stage="normalize",
          error_message=issue.message,
          payload_preview=_raw_json_value(event.raw.get("payload_json")),
          context_preview=_raw_json_value(event.raw.get("context_json")),
          occurred_at=event.occurred_at,
          source_error_code=issue.code,
          field=issue.field,
        )
      )
    return recorded

  def _next_error_id(self) -> str:
    row = self._connection.execute("SELECT COUNT(*) AS count FROM event_parse_errors").fetchone()
    return f"err_{row['count'] + 1:06d}"


def _raw_event_from_row(row: sqlite3.Row) -> RawEventRecord:
  return RawEventRecord(
    event_id=row["event_id"],
    event_type=row["event_type"],
    occurred_at=_datetime_from_text(row["occurred_at"]),
    occurred_at_raw=row["occurred_at_raw"],
    received_at=_datetime_from_text(row["received_at"]),
    plugin_version=row["plugin_version"],
    operator_id=row["operator_id"],
    operator_account_name=row["operator_account_name"],
    boss_account_name=row["boss_account_name"],
    boss_account_matched=_int_to_bool(row["boss_account_matched"]),
    session_id=row["session_id"],
    page_type=row["page_type"],
    page_url=row["page_url"],
    page_title=row["page_title"],
    job_id=row["job_id"],
    job_status=row["job_status"],
    source_tab_id=row["source_tab_id"],
    source_window_id=row["source_window_id"],
    source_tab_url=row["source_tab_url"],
    payload_json=row["payload_json"],
    context_json=row["context_json"],
    raw_cls_json=json.loads(row["raw_cls_json"]),
    parse_status=row["parse_status"],
    parse_errors=tuple(_issue_from_dict(item) for item in json.loads(row["parse_errors"])),
    created_at=_datetime_from_text(row["created_at"]),
  )


def _error_from_row(row: sqlite3.Row) -> EventErrorRecord:
  return EventErrorRecord(
    id=row["id"],
    event_id=row["event_id"],
    event_type=row["event_type"],
    error_stage=row["error_stage"],
    error_message=row["error_message"],
    payload_preview=row["payload_preview"],
    context_preview=row["context_preview"],
    occurred_at=_datetime_from_text(row["occurred_at"]),
    created_at=_datetime_from_text(row["created_at"]),
    resolved_at=_datetime_from_text(row["resolved_at"]),
    source_error_code=row["source_error_code"],
    field=row["field"],
  )


def _issue_to_dict(issue: ParseIssue) -> dict[str, Any]:
  return {
    "field": issue.field,
    "code": issue.code,
    "message": issue.message,
    "raw_value": issue.raw_value,
  }


def _issue_from_dict(value: dict[str, Any]) -> ParseIssue:
  return ParseIssue(
    field=value["field"],
    code=value["code"],
    message=value["message"],
    raw_value=value.get("raw_value"),
  )


def _matches_replay_filter(record: RawEventRecord, replay_filter: ReplayFilter | None) -> bool:
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


def _json_dumps(value: Any) -> str:
  return json.dumps(value, ensure_ascii=False, default=str, separators=(",", ":"))


def _raw_json_value(value: Any) -> str | None:
  if value is None:
    return None
  if isinstance(value, str):
    return value
  return _json_dumps(value)


def _datetime_to_text(value: datetime | None) -> str | None:
  if value is None:
    return None
  return value.isoformat()


def _datetime_from_text(value: str | None) -> datetime | None:
  if value is None:
    return None
  return datetime.fromisoformat(value)


def _bool_to_int(value: bool | None) -> int | None:
  if value is None:
    return None
  return 1 if value else 0


def _int_to_bool(value: int | None) -> bool | None:
  if value is None:
    return None
  return bool(value)


def _utc_now() -> datetime:
  return datetime.now(timezone.utc)
