"""In-memory fact store used by projectors and tests."""

from __future__ import annotations

from dataclasses import replace

from boss_analysis.domain import (
  CandidateChatFact,
  CandidateDetailSessionFact,
  CandidateExposureFact,
  CandidateGreetingFact,
  CandidateIdentityFact,
)


class InMemoryFactStore:
  """Stores projected facts idempotently by their source event IDs."""

  def __init__(self) -> None:
    self._candidate_identities: dict[str, CandidateIdentityFact] = {}
    self._candidate_exposures: dict[str, CandidateExposureFact] = {}
    self._detail_sessions: dict[str, CandidateDetailSessionFact] = {}
    self._greetings: dict[str, CandidateGreetingFact] = {}
    self._chats: dict[str, CandidateChatFact] = {}

  def upsert_candidate_identity(self, identity: CandidateIdentityFact) -> tuple[CandidateIdentityFact, bool]:
    existing = self._candidate_identities.get(identity.identity_key)
    if existing is None:
      self._candidate_identities[identity.identity_key] = identity
      return identity, True
    updated = replace(
      existing,
      candidate_id=existing.candidate_id or identity.candidate_id,
      stable_id=existing.stable_id or identity.stable_id,
      stable_id_source=existing.stable_id_source or identity.stable_id_source,
      display_name=existing.display_name or identity.display_name,
      last_event_id=identity.last_event_id,
    )
    self._candidate_identities[identity.identity_key] = updated
    return updated, False

  def insert_exposure(self, fact: CandidateExposureFact) -> bool:
    if fact.source_event_id in self._candidate_exposures:
      return False
    self._candidate_exposures[fact.source_event_id] = fact
    return True

  def upsert_detail_opened(self, fact: CandidateDetailSessionFact) -> tuple[CandidateDetailSessionFact, bool]:
    existing = self._detail_sessions.get(fact.opened_event_id)
    if existing is None:
      self._detail_sessions[fact.opened_event_id] = fact
      return fact, True
    updated = replace(
      existing,
      opened_at=fact.opened_at or existing.opened_at,
      operator_id=fact.operator_id or existing.operator_id,
      job_id=fact.job_id or existing.job_id,
      candidate_identity_key=fact.candidate_identity_key or existing.candidate_identity_key,
      candidate_id=fact.candidate_id or existing.candidate_id,
      detail_url=fact.detail_url or existing.detail_url,
      orphaned_close=False if fact.opened_at is not None else existing.orphaned_close,
    )
    self._detail_sessions[fact.opened_event_id] = updated
    return updated, False

  def upsert_detail_closed(self, fact: CandidateDetailSessionFact) -> tuple[CandidateDetailSessionFact, bool]:
    existing = self._detail_sessions.get(fact.opened_event_id)
    if existing is None:
      self._detail_sessions[fact.opened_event_id] = fact
      return fact, True
    updated = replace(
      existing,
      closed_event_id=existing.closed_event_id or fact.closed_event_id,
      closed_at=existing.closed_at or fact.closed_at,
      duration_ms=existing.duration_ms if existing.duration_ms is not None else fact.duration_ms,
      close_reason=existing.close_reason or fact.close_reason,
      detail_url=existing.detail_url or fact.detail_url,
      candidate_identity_key=existing.candidate_identity_key or fact.candidate_identity_key,
      candidate_id=existing.candidate_id or fact.candidate_id,
      orphaned_close=existing.opened_at is None,
    )
    self._detail_sessions[fact.opened_event_id] = updated
    return updated, False

  def insert_greeting(self, fact: CandidateGreetingFact) -> bool:
    if fact.source_event_id in self._greetings:
      return False
    self._greetings[fact.source_event_id] = fact
    return True

  def insert_chat(self, fact: CandidateChatFact) -> bool:
    if fact.source_event_id in self._chats:
      return False
    self._chats[fact.source_event_id] = fact
    return True

  def candidate_identities(self) -> tuple[CandidateIdentityFact, ...]:
    return tuple(self._candidate_identities.values())

  def candidate_exposures(self) -> tuple[CandidateExposureFact, ...]:
    return tuple(self._candidate_exposures.values())

  def detail_sessions(self) -> tuple[CandidateDetailSessionFact, ...]:
    return tuple(self._detail_sessions.values())

  def greetings(self) -> tuple[CandidateGreetingFact, ...]:
    return tuple(self._greetings.values())

  def chats(self) -> tuple[CandidateChatFact, ...]:
    return tuple(self._chats.values())
