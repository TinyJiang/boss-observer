"""Fact models produced from raw event projection."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Any, Literal

CandidateIdentityConfidence = Literal["high", "medium", "low", "unknown"]
GreetingStatus = Literal["clicked", "succeeded", "failed"]
ChatFactKind = Literal["opened", "snapshot_captured", "wechat_captured", "capture_failed", "report_required"]


@dataclass(frozen=True)
class CandidateIdentityFact:
  """Candidate identity clue with conservative merge semantics."""

  identity_key: str
  candidate_id: str | None
  stable_id: str | None
  stable_id_source: str | None
  identity_confidence: CandidateIdentityConfidence
  display_name: str | None
  first_event_id: str
  last_event_id: str


@dataclass(frozen=True)
class CandidateExposureFact:
  """Candidate card exposure fact."""

  source_event_id: str
  occurred_at: datetime | None
  operator_id: str | None
  job_id: str | None
  list_url: str | None
  list_page_type: str | None
  candidate_identity_key: str | None
  candidate_id: str | None
  stable_id: str | None
  stable_id_source: str | None
  exposure_key: str | None
  card_index: int | None
  profile: dict[str, Any]


@dataclass(frozen=True)
class CandidateDetailSessionFact:
  """Candidate detail open/close session fact."""

  opened_event_id: str
  opened_at: datetime | None
  closed_event_id: str | None
  closed_at: datetime | None
  operator_id: str | None
  job_id: str | None
  candidate_identity_key: str | None
  candidate_id: str | None
  detail_url: str | None
  duration_ms: int | None
  close_reason: str | None
  orphaned_close: bool


@dataclass(frozen=True)
class CandidateGreetingFact:
  """One greeting click/result event, linked by clicked_event_id."""

  source_event_id: str
  clicked_event_id: str | None
  occurred_at: datetime | None
  operator_id: str | None
  job_id: str | None
  candidate_identity_key: str | None
  candidate_id: str | None
  entry: str | None
  status: GreetingStatus
  elapsed_ms: int | None
  detected_by: str | None


@dataclass(frozen=True)
class CandidateChatFact:
  """Chat fact with sensitive message/account content removed."""

  source_event_id: str
  occurred_at: datetime | None
  operator_id: str | None
  job_id: str | None
  candidate_identity_key: str | None
  candidate_id: str | None
  kind: ChatFactKind
  conversation_key: str | None
  message_count: int | None
  first_message_at: str | None
  last_message_at: str | None
  snapshot_completeness: str | None
  may_be_incomplete: bool | None
  wechat_account_count: int | None
  failure_reason: str | None


@dataclass(frozen=True)
class FactProjectionResult:
  """Summary of projecting one or more raw events."""

  inserted_fact_ids: tuple[str, ...] = ()
  updated_fact_ids: tuple[str, ...] = ()
  skipped_event_ids: tuple[str, ...] = ()
  error_event_ids: tuple[str, ...] = ()
