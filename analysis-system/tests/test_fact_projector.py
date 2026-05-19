from __future__ import annotations

import json
import unittest
from datetime import datetime, timezone

from boss_analysis.consumer import normalize_cls_event
from boss_analysis.storage import InMemoryFactStore, InMemoryRawEventRepository
from boss_analysis.workers import FactProjector


def make_record(event_id, event_type, payload, *, occurred_at="2026-05-17T09:00:00+08:00"):
  if isinstance(payload, str):
    payload_json = payload
  else:
    payload_json = json.dumps(payload)
  return {
    "event_id": event_id,
    "event_type": event_type,
    "occurred_at": occurred_at,
    "plugin_version": "0.1.0",
    "operator_id": "op_001",
    "operator_account_name": "operator-a",
    "boss_account_name": "operator-a",
    "boss_account_matched": "true",
    "session_id": "sess_001",
    "page_type": "candidate_recommend",
    "page_url": "https://www.zhipin.com/web/chat/recommend",
    "page_title": "candidate recommendations",
    "job_id": "job_001",
    "job_status": "0",
    "source_tab_id": 1,
    "source_window_id": 2,
    "source_tab_url": "https://www.zhipin.com/web/chat/recommend",
    "payload_json": payload_json,
    "context_json": json.dumps({"sessionId": "sess_001"}),
  }


def raw_event(record):
  repository = InMemoryRawEventRepository()
  event = normalize_cls_event(record, received_at=datetime(2026, 5, 17, 1, 0, tzinfo=timezone.utc))
  return repository.save_normalized_event(event).record


def candidate_payload(stable_id="geek_001", *, stable_id_source="url.geekId", confidence="high"):
  return {
    "candidateId": f"candidate_{stable_id}",
    "stableId": stable_id,
    "stableIdSource": stable_id_source,
    "identityConfidence": confidence,
    "profile": {
      "displayName": "candidate-a",
      "age": 28,
    },
  }


class FactProjectorTests(unittest.TestCase):
  def test_exposure_projection_is_idempotent_by_source_event(self):
    store = InMemoryFactStore()
    projector = FactProjector(store)
    record = raw_event(make_record(
      "evt_exposure",
      "candidate_list.card_exposed",
      {
        "listUrl": "https://www.zhipin.com/web/chat/recommend",
        "listPageType": "candidate_recommend",
        "candidate": candidate_payload(),
        "exposure": {"cardIndex": 2},
      },
    ))

    first = projector.project_record(record)
    second = projector.project_record(record)

    self.assertEqual(first.inserted_fact_ids, ("exposure:evt_exposure",))
    self.assertEqual(second.skipped_event_ids, ("evt_exposure",))
    self.assertEqual(len(store.candidate_exposures()), 1)
    self.assertEqual(len(store.candidate_identities()), 1)
    self.assertEqual(store.candidate_exposures()[0].card_index, 2)

  def test_detail_opened_then_closed_updates_same_session(self):
    store = InMemoryFactStore()
    projector = FactProjector(store)
    opened = raw_event(make_record(
      "evt_detail_open",
      "candidate_detail.opened",
      {
        "detailUrl": "https://www.zhipin.com/web/chat/index?geekId=geek_001",
        "candidate": candidate_payload(),
      },
      occurred_at="2026-05-17T09:00:00+08:00",
    ))
    closed = raw_event(make_record(
      "evt_detail_close",
      "candidate_detail.closed",
      {
        "openedEventId": "evt_detail_open",
        "durationMs": 2500,
        "reason": "detail_disappeared",
        "candidate": candidate_payload(),
      },
      occurred_at="2026-05-17T09:00:03+08:00",
    ))

    projector.project_record(opened)
    close_result = projector.project_record(closed)
    session = store.detail_sessions()[0]

    self.assertEqual(close_result.skipped_event_ids, ())
    self.assertEqual(session.opened_event_id, "evt_detail_open")
    self.assertEqual(session.closed_event_id, "evt_detail_close")
    self.assertEqual(session.duration_ms, 2500)
    self.assertFalse(session.orphaned_close)

  def test_detail_closed_before_opened_is_backfilled(self):
    store = InMemoryFactStore()
    projector = FactProjector(store)
    closed = raw_event(make_record(
      "evt_detail_close",
      "candidate_detail.closed",
      {
        "openedEventId": "evt_detail_open",
        "durationMs": 300,
        "reason": "candidate_switched",
        "candidate": candidate_payload(),
      },
      occurred_at="2026-05-17T09:00:01+08:00",
    ))
    opened = raw_event(make_record(
      "evt_detail_open",
      "candidate_detail.opened",
      {
        "detailUrl": "https://www.zhipin.com/web/chat/index?geekId=geek_001",
        "candidate": candidate_payload(),
      },
      occurred_at="2026-05-17T09:00:00+08:00",
    ))

    projector.project_record(closed)
    self.assertTrue(store.detail_sessions()[0].orphaned_close)
    projector.project_record(opened)
    session = store.detail_sessions()[0]

    self.assertEqual(session.opened_at.isoformat(), "2026-05-17T09:00:00+08:00")
    self.assertEqual(session.closed_event_id, "evt_detail_close")
    self.assertFalse(session.orphaned_close)

  def test_greeting_success_and_failure_facts_do_not_overwrite_each_other(self):
    store = InMemoryFactStore()
    projector = FactProjector(store)
    events = [
      raw_event(make_record("evt_click", "candidate_greeting.clicked", {
        "entry": "candidate_list",
        "candidate": candidate_payload(),
      })),
      raw_event(make_record("evt_success", "candidate_greeting.succeeded", {
        "clickedEventId": "evt_click",
        "elapsedMs": 800,
        "greeting": {"detectedBy": "page_message"},
        "candidate": candidate_payload(),
      })),
      raw_event(make_record("evt_failure", "candidate_greeting.failed", {
        "clickedEventId": "evt_click",
        "elapsedMs": 900,
        "greeting": {"detectedBy": "page_message"},
        "candidate": candidate_payload(),
      })),
    ]

    projector.project_records(events)
    greetings = sorted(store.greetings(), key=lambda fact: fact.source_event_id)

    self.assertEqual([fact.status for fact in greetings], ["clicked", "failed", "succeeded"])
    self.assertEqual({fact.clicked_event_id for fact in greetings}, {"evt_click"})

  def test_unknown_event_type_is_skipped(self):
    store = InMemoryFactStore()
    projector = FactProjector(store)
    record = raw_event(make_record("evt_unknown", "future_module.new_fact", {}))

    result = projector.project_record(record)

    self.assertEqual(result.skipped_event_ids, ("evt_unknown",))
    self.assertEqual(store.candidate_exposures(), ())

  def test_low_confidence_identity_does_not_merge_across_events(self):
    store = InMemoryFactStore()
    projector = FactProjector(store)
    first = raw_event(make_record("evt_low_1", "candidate_list.card_exposed", {
      "candidate": candidate_payload(
        "same_text",
        stable_id_source="text_fingerprint",
        confidence="low",
      ),
    }))
    second = raw_event(make_record("evt_low_2", "candidate_detail.opened", {
      "candidate": candidate_payload(
        "same_text",
        stable_id_source="text_fingerprint",
        confidence="low",
      ),
    }))

    projector.project_record(first)
    projector.project_record(second)
    identities = store.candidate_identities()

    self.assertEqual(len(identities), 2)
    self.assertTrue(all(identity.identity_key.startswith("local:") for identity in identities))

  def test_chat_projection_stores_counts_not_sensitive_text_or_accounts(self):
    store = InMemoryFactStore()
    projector = FactProjector(store)
    snapshot = raw_event(make_record("evt_snapshot", "candidate_chat.snapshot_captured", {
      "candidate": candidate_payload(),
      "chat": {
        "conversationKey": "candidate_geek_001",
        "messageCount": 2,
        "firstMessageAt": "2026-05-17T09:00:00+08:00",
        "lastMessageAt": "2026-05-17T09:01:00+08:00",
        "snapshotCompleteness": "visible_dom",
        "mayBeIncomplete": True,
        "messages": [
          {"direction": "candidate", "text": "hello"},
          {"direction": "recruiter", "text": "reply"},
        ],
      },
    }))
    wechat = raw_event(make_record("evt_wechat", "candidate_chat.wechat_captured", {
      "candidate": candidate_payload(),
      "wechat": {
        "accounts": ["wxid_a", "wxid_b"],
        "source": "chat_text",
      },
    }))

    projector.project_record(snapshot)
    projector.project_record(wechat)
    chats = sorted(store.chats(), key=lambda fact: fact.source_event_id)

    self.assertEqual(chats[0].message_count, 2)
    self.assertEqual(chats[0].snapshot_completeness, "visible_dom")
    self.assertFalse(hasattr(chats[0], "messages"))
    self.assertEqual(chats[1].wechat_account_count, 2)
    self.assertFalse(hasattr(chats[1], "accounts"))

  def test_chat_snapshot_with_wechat_exchange_marker_counts_as_wechat_captured_without_text(self):
    store = InMemoryFactStore()
    projector = FactProjector(store)
    snapshot = raw_event(make_record("evt_snapshot_wechat", "candidate_chat.snapshot_captured", {
      "candidate": candidate_payload(),
      "chat": {
        "conversationKey": "candidate_geek_001",
        "messageCount": 2,
        "messages": [
          {"direction": "candidate", "text": "候选人的微信号：wxid_secret"},
          {"direction": "recruiter", "text": "好的"},
        ],
      },
    }))

    projector.project_record(snapshot)
    chat = store.chats()[0]
    public_payload = str(chat)

    self.assertEqual(chat.kind, "wechat_captured")
    self.assertEqual(chat.wechat_account_count, 1)
    self.assertFalse(hasattr(chat, "messages"))
    self.assertNotIn("wxid_secret", public_payload)

  def test_chat_snapshot_with_generic_wechat_text_is_not_exchange_success(self):
    store = InMemoryFactStore()
    projector = FactProjector(store)
    snapshot = raw_event(make_record("evt_snapshot_generic_wechat", "candidate_chat.snapshot_captured", {
      "candidate": candidate_payload(),
      "chat": {
        "messageCount": 1,
        "messages": [
          {"text": "方便加微信吗"},
        ],
      },
    }))

    projector.project_record(snapshot)
    chat = store.chats()[0]

    self.assertEqual(chat.kind, "snapshot_captured")
    self.assertIsNone(chat.wechat_account_count)

  def test_report_required_is_supported_chat_fact(self):
    store = InMemoryFactStore()
    projector = FactProjector(store)
    report = raw_event(make_record("evt_report", "candidate_chat.report_required", {
      "candidate": candidate_payload(),
      "listItem": {
        "lastMessageTimeText": "刚刚",
      },
    }))

    result = projector.project_record(report)
    chat = store.chats()[0]

    self.assertEqual(result.inserted_fact_ids, ("chat:evt_report",))
    self.assertEqual(chat.kind, "report_required")

  def test_invalid_payload_records_projection_error(self):
    store = InMemoryFactStore()
    raw_repository = InMemoryRawEventRepository()
    projector = FactProjector(store, error_repository=raw_repository)
    event = normalize_cls_event(make_record(
      "evt_bad_payload",
      "candidate_list.card_exposed",
      "{bad",
    ))
    record = raw_repository.save_normalized_event(event).record

    result = projector.project_record(record)

    self.assertEqual(result.error_event_ids, ("evt_bad_payload",))
    self.assertEqual(raw_repository.list_errors(event_id="evt_bad_payload")[-1].error_stage, "fact_project")


if __name__ == "__main__":
  unittest.main()
