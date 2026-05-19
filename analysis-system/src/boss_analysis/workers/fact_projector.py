"""Project raw event records into queryable fact records."""

from __future__ import annotations

import json
import re
from dataclasses import dataclass
from typing import Any

from boss_analysis.domain import (
  CandidateChatFact,
  CandidateDetailSessionFact,
  CandidateExposureFact,
  CandidateGreetingFact,
  CandidateIdentityFact,
  FactProjectionResult,
  RawEventRecord,
  RawEventRepository,
)
from boss_analysis.storage import InMemoryFactStore

SUPPORTED_EVENT_TYPES = {
  "candidate_list.card_exposed",
  "candidate_detail.opened",
  "candidate_detail.closed",
  "candidate_greeting.clicked",
  "candidate_greeting.succeeded",
  "candidate_greeting.failed",
  "candidate_chat.opened",
  "candidate_chat.snapshot_captured",
  "candidate_chat.wechat_captured",
  "candidate_chat.capture_failed",
  "candidate_chat.report_required",
}

WECHAT_EXCHANGED_RE = re.compile(r"([^\s，。,:：]{1,30}的)?微信号\s*[:：]")


@dataclass(frozen=True)
class _CandidateProjection:
  identity_key: str | None
  candidate_id: str | None
  stable_id: str | None
  stable_id_source: str | None
  profile: dict[str, Any]


class FactProjector:
  """Project raw events into facts without encoding analysis conclusions."""

  def __init__(
    self,
    fact_store: InMemoryFactStore,
    *,
    error_repository: RawEventRepository | None = None,
  ) -> None:
    self._fact_store = fact_store
    self._error_repository = error_repository

  def project_record(self, record: RawEventRecord) -> FactProjectionResult:
    if record.event_type not in SUPPORTED_EVENT_TYPES:
      return FactProjectionResult(skipped_event_ids=(record.event_id,))

    payload = _decode_payload(record)
    if payload is None:
      self._record_error(
        record,
        "Payload is not a JSON object and cannot be projected",
        "invalid_payload_json",
      )
      return FactProjectionResult(error_event_ids=(record.event_id,))

    if record.event_type == "candidate_list.card_exposed":
      return self._project_card_exposure(record, payload)
    if record.event_type == "candidate_detail.opened":
      return self._project_detail_opened(record, payload)
    if record.event_type == "candidate_detail.closed":
      return self._project_detail_closed(record, payload)
    if record.event_type in {
      "candidate_greeting.clicked",
      "candidate_greeting.succeeded",
      "candidate_greeting.failed",
    }:
      return self._project_greeting(record, payload)
    if record.event_type.startswith("candidate_chat."):
      return self._project_chat(record, payload)
    return FactProjectionResult(skipped_event_ids=(record.event_id,))

  def project_records(self, records: tuple[RawEventRecord, ...] | list[RawEventRecord]) -> FactProjectionResult:
    inserted: list[str] = []
    updated: list[str] = []
    skipped: list[str] = []
    errors: list[str] = []
    for record in records:
      result = self.project_record(record)
      inserted.extend(result.inserted_fact_ids)
      updated.extend(result.updated_fact_ids)
      skipped.extend(result.skipped_event_ids)
      errors.extend(result.error_event_ids)
    return FactProjectionResult(
      inserted_fact_ids=tuple(inserted),
      updated_fact_ids=tuple(updated),
      skipped_event_ids=tuple(skipped),
      error_event_ids=tuple(errors),
    )

  def _project_card_exposure(
    self,
    record: RawEventRecord,
    payload: dict[str, Any],
  ) -> FactProjectionResult:
    candidate = self._resolve_candidate(record, payload)
    exposure = payload.get("exposure") if isinstance(payload.get("exposure"), dict) else {}
    fact = CandidateExposureFact(
      source_event_id=record.event_id,
      occurred_at=record.occurred_at,
      operator_id=record.operator_id,
      job_id=record.job_id,
      list_url=_as_string(payload.get("listUrl")),
      list_page_type=_as_string(payload.get("listPageType")),
      candidate_identity_key=candidate.identity_key,
      candidate_id=candidate.candidate_id,
      stable_id=candidate.stable_id,
      stable_id_source=candidate.stable_id_source,
      exposure_key=_as_string(_candidate_payload(payload).get("exposureKey")),
      card_index=_as_int(exposure.get("cardIndex")),
      profile=candidate.profile,
    )
    inserted = self._fact_store.insert_exposure(fact)
    return _result_for_write("exposure", record.event_id, inserted)

  def _project_detail_opened(
    self,
    record: RawEventRecord,
    payload: dict[str, Any],
  ) -> FactProjectionResult:
    candidate = self._resolve_candidate(record, payload)
    fact = CandidateDetailSessionFact(
      opened_event_id=record.event_id,
      opened_at=record.occurred_at,
      closed_event_id=None,
      closed_at=None,
      operator_id=record.operator_id,
      job_id=record.job_id,
      candidate_identity_key=candidate.identity_key,
      candidate_id=candidate.candidate_id,
      detail_url=_as_string(payload.get("detailUrl")) or _as_string(_candidate_payload(payload).get("detailUrl")),
      duration_ms=None,
      close_reason=None,
      orphaned_close=False,
    )
    _, inserted = self._fact_store.upsert_detail_opened(fact)
    return _result_for_upsert("detail", fact.opened_event_id, inserted)

  def _project_detail_closed(
    self,
    record: RawEventRecord,
    payload: dict[str, Any],
  ) -> FactProjectionResult:
    candidate = self._resolve_candidate(record, payload)
    opened_event_id = _as_string(payload.get("openedEventId")) or f"closed:{record.event_id}"
    fact = CandidateDetailSessionFact(
      opened_event_id=opened_event_id,
      opened_at=None,
      closed_event_id=record.event_id,
      closed_at=record.occurred_at,
      operator_id=record.operator_id,
      job_id=record.job_id,
      candidate_identity_key=candidate.identity_key,
      candidate_id=candidate.candidate_id,
      detail_url=_as_string(payload.get("detailUrl")) or _as_string(_candidate_payload(payload).get("detailUrl")),
      duration_ms=_as_int(payload.get("durationMs")),
      close_reason=_as_string(payload.get("reason")),
      orphaned_close=True,
    )
    _, inserted = self._fact_store.upsert_detail_closed(fact)
    return _result_for_upsert("detail", opened_event_id, inserted)

  def _project_greeting(
    self,
    record: RawEventRecord,
    payload: dict[str, Any],
  ) -> FactProjectionResult:
    candidate = self._resolve_candidate(record, payload)
    status = record.event_type.rsplit(".", 1)[-1]
    if status == "clicked":
      clicked_event_id = record.event_id
    else:
      clicked_event_id = _as_string(payload.get("clickedEventId"))
    greeting = payload.get("greeting") if isinstance(payload.get("greeting"), dict) else {}
    fact = CandidateGreetingFact(
      source_event_id=record.event_id,
      clicked_event_id=clicked_event_id,
      occurred_at=record.occurred_at,
      operator_id=record.operator_id,
      job_id=record.job_id,
      candidate_identity_key=candidate.identity_key,
      candidate_id=candidate.candidate_id,
      entry=_as_string(payload.get("entry")),
      status=status,
      elapsed_ms=_as_int(payload.get("elapsedMs")),
      detected_by=_as_string(greeting.get("detectedBy")),
    )
    inserted = self._fact_store.insert_greeting(fact)
    return _result_for_write("greeting", record.event_id, inserted)

  def _project_chat(
    self,
    record: RawEventRecord,
    payload: dict[str, Any],
  ) -> FactProjectionResult:
    candidate = self._resolve_candidate(record, payload)
    chat = payload.get("chat") if isinstance(payload.get("chat"), dict) else {}
    wechat = payload.get("wechat") if isinstance(payload.get("wechat"), dict) else {}
    accounts = wechat.get("accounts") if isinstance(wechat.get("accounts"), list) else None
    kind = record.event_type.rsplit(".", 1)[-1]
    wechat_account_count = len(accounts) if accounts is not None else None
    if kind == "snapshot_captured" and _payload_has_wechat_exchange_marker(payload):
      kind = "wechat_captured"
      wechat_account_count = 1
    fact = CandidateChatFact(
      source_event_id=record.event_id,
      occurred_at=record.occurred_at,
      operator_id=record.operator_id,
      job_id=record.job_id,
      candidate_identity_key=candidate.identity_key,
      candidate_id=candidate.candidate_id,
      kind=kind,
      conversation_key=_as_string(chat.get("conversationKey")),
      message_count=_as_int(chat.get("messageCount")),
      first_message_at=_as_string(chat.get("firstMessageAt")),
      last_message_at=_as_string(chat.get("lastMessageAt")),
      snapshot_completeness=_as_string(chat.get("snapshotCompleteness")),
      may_be_incomplete=_as_bool(chat.get("mayBeIncomplete")),
      wechat_account_count=wechat_account_count,
      failure_reason=_as_string(payload.get("reason")),
    )
    inserted = self._fact_store.insert_chat(fact)
    return _result_for_write("chat", record.event_id, inserted)

  def _resolve_candidate(
    self,
    record: RawEventRecord,
    payload: dict[str, Any],
  ) -> _CandidateProjection:
    candidate = _candidate_payload(payload)
    profile = candidate.get("profile") if isinstance(candidate.get("profile"), dict) else {}
    candidate_id = _as_string(candidate.get("candidateId"))
    stable_id = _as_string(candidate.get("stableId"))
    stable_id_source = _as_string(candidate.get("stableIdSource"))
    identity_confidence = _as_string(candidate.get("identityConfidence")) or "unknown"
    display_name = _as_string(profile.get("displayName"))
    identity_key = _identity_key(
      source_event_id=record.event_id,
      candidate_id=candidate_id,
      stable_id=stable_id,
      stable_id_source=stable_id_source,
      identity_confidence=identity_confidence,
    )

    if identity_key is not None:
      identity = CandidateIdentityFact(
        identity_key=identity_key,
        candidate_id=candidate_id,
        stable_id=stable_id,
        stable_id_source=stable_id_source,
        identity_confidence=_normalized_confidence(identity_confidence),
        display_name=display_name,
        first_event_id=record.event_id,
        last_event_id=record.event_id,
      )
      self._fact_store.upsert_candidate_identity(identity)

    return _CandidateProjection(
      identity_key=identity_key,
      candidate_id=candidate_id,
      stable_id=stable_id,
      stable_id_source=stable_id_source,
      profile=dict(profile),
    )

  def _record_error(
    self,
    record: RawEventRecord,
    message: str,
    source_error_code: str,
  ) -> None:
    if self._error_repository is None:
      return
    self._error_repository.record_error(
      event_id=record.event_id,
      event_type=record.event_type,
      error_stage="fact_project",
      error_message=message,
      payload_preview=_preview(record.payload_json),
      context_preview=_preview(record.context_json),
      occurred_at=record.occurred_at,
      source_error_code=source_error_code,
    )


def _decode_payload(record: RawEventRecord) -> dict[str, Any] | None:
  value = record.payload_json
  if value is None or value == "":
    return {}
  if isinstance(value, dict):
    return value
  if not isinstance(value, str):
    return None
  try:
    decoded = json.loads(value)
  except json.JSONDecodeError:
    return None
  if isinstance(decoded, dict):
    return decoded
  return None


def _candidate_payload(payload: dict[str, Any]) -> dict[str, Any]:
  candidate = payload.get("candidate")
  if isinstance(candidate, dict):
    return candidate
  return {}


def _payload_has_wechat_exchange_marker(payload: dict[str, Any]) -> bool:
  text = json.dumps(payload, ensure_ascii=False)
  return bool(WECHAT_EXCHANGED_RE.search(text))


def _identity_key(
  *,
  source_event_id: str,
  candidate_id: str | None,
  stable_id: str | None,
  stable_id_source: str | None,
  identity_confidence: str,
) -> str | None:
  low_confidence = identity_confidence == "low" or stable_id_source == "text_fingerprint"
  if stable_id is not None and stable_id_source is not None:
    if low_confidence:
      return f"local:{source_event_id}:{stable_id_source}:{stable_id}"
    return f"stable:{stable_id_source}:{stable_id}"
  if candidate_id is not None:
    if low_confidence:
      return f"local:{source_event_id}:candidate:{candidate_id}"
    return f"candidate:{candidate_id}"
  return None


def _normalized_confidence(value: str) -> str:
  if value in {"high", "medium", "low"}:
    return value
  return "unknown"


def _result_for_write(kind: str, fact_id: str, inserted: bool) -> FactProjectionResult:
  key = f"{kind}:{fact_id}"
  if inserted:
    return FactProjectionResult(inserted_fact_ids=(key,))
  return FactProjectionResult(skipped_event_ids=(fact_id,))


def _result_for_upsert(kind: str, fact_id: str, inserted: bool) -> FactProjectionResult:
  key = f"{kind}:{fact_id}"
  if inserted:
    return FactProjectionResult(inserted_fact_ids=(key,))
  return FactProjectionResult(updated_fact_ids=(key,))


def _as_string(value: Any) -> str | None:
  if value is None:
    return None
  if isinstance(value, str):
    stripped = value.strip()
    return stripped or None
  return str(value)


def _as_int(value: Any) -> int | None:
  if value is None or value == "":
    return None
  if isinstance(value, bool):
    return None
  if isinstance(value, int):
    return value
  if isinstance(value, float):
    return int(value)
  if isinstance(value, str):
    try:
      return int(value.strip())
    except ValueError:
      return None
  return None


def _as_bool(value: Any) -> bool | None:
  if isinstance(value, bool):
    return value
  return None


def _preview(value: Any) -> str | None:
  if value is None:
    return None
  text = str(value)
  return text[:512]
