"""Domain objects for normalized CLS events."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Any, Literal

ParseStatus = Literal["parsed", "partial", "failed"]


@dataclass(frozen=True)
class ParseIssue:
  """Field-level issue found while normalizing an incoming event."""

  field: str
  code: str
  message: str
  raw_value: Any = None


@dataclass(frozen=True)
class NormalizedEvent:
  """Structured event produced from one flattened CLS log record."""

  raw: dict[str, Any]
  event_id: str | None
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
  payload: Any
  context: Any
  parse_status: ParseStatus
  parse_errors: tuple[ParseIssue, ...]

  @property
  def parsed_successfully(self) -> bool:
    return self.parse_status == "parsed"
