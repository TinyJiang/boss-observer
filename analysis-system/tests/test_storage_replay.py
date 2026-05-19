from __future__ import annotations

import json
import unittest
from datetime import datetime, timezone

from boss_analysis.consumer import normalize_cls_event
from boss_analysis.domain import ReplayFilter
from boss_analysis.storage import InMemoryRawEventRepository


def fixed_clock():
  return datetime(2026, 5, 17, 13, 0, tzinfo=timezone.utc)


def make_record(**overrides):
  record = {
    "event_id": "evt_001",
    "event_type": "candidate_greeting.clicked",
    "occurred_at": "2026-05-17T09:12:30+08:00",
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
    "payload_json": json.dumps({
      "clickedEventId": "evt_click_001",
      "candidate": {
        "candidateId": "candidate_001",
      },
    }),
    "context_json": json.dumps({
      "sessionId": "sess_001",
      "pageType": "candidate_recommend",
    }),
  }
  record.update(overrides)
  return record


class InMemoryRawEventRepositoryTests(unittest.TestCase):
  def test_duplicate_event_id_is_idempotent_and_does_not_overwrite(self):
    repository = InMemoryRawEventRepository(clock=fixed_clock)
    first_event = normalize_cls_event(make_record(event_type="candidate_greeting.clicked"))
    duplicate_event = normalize_cls_event(
      make_record(
        event_type="candidate_greeting.succeeded",
        occurred_at="2026-05-18T09:12:30+08:00",
      )
    )

    first_result = repository.save_normalized_event(first_event)
    duplicate_result = repository.save_normalized_event(duplicate_event)
    stored = repository.get_raw_event("evt_001")

    self.assertTrue(first_result.inserted)
    self.assertFalse(duplicate_result.inserted)
    self.assertEqual(stored.event_type, "candidate_greeting.clicked")
    self.assertEqual(stored.occurred_at.isoformat(), "2026-05-17T09:12:30+08:00")
    self.assertEqual(len(repository.replay_raw_events()), 1)

  def test_json_parse_failure_still_saves_raw_event_and_errors(self):
    repository = InMemoryRawEventRepository(clock=fixed_clock)
    event = normalize_cls_event(make_record(payload_json="{bad"))

    result = repository.save_normalized_event(event)
    stored = repository.get_raw_event("evt_001")
    errors = repository.list_errors(event_id="evt_001")

    self.assertTrue(result.inserted)
    self.assertEqual(stored.parse_status, "partial")
    self.assertEqual(stored.payload_json, "{bad")
    self.assertEqual(stored.raw_cls_json["payload_json"], "{bad")
    self.assertEqual(len(errors), 1)
    self.assertEqual(errors[0].error_stage, "normalize")
    self.assertEqual(errors[0].source_error_code, "invalid_json")
    self.assertEqual(errors[0].field, "payload_json")

  def test_missing_event_id_records_error_without_raw_event(self):
    repository = InMemoryRawEventRepository(clock=fixed_clock)
    event = normalize_cls_event(make_record(event_id=""))

    result = repository.save_normalized_event(event)

    self.assertFalse(result.inserted)
    self.assertIsNone(result.record)
    self.assertEqual(len(repository.replay_raw_events()), 0)
    self.assertEqual(repository.list_errors()[0].source_error_code, "missing_required")

  def test_fact_projection_error_does_not_delete_raw_event(self):
    repository = InMemoryRawEventRepository(clock=fixed_clock)
    event = normalize_cls_event(make_record())
    repository.save_normalized_event(event)

    error = repository.record_error(
      event_id="evt_001",
      event_type="candidate_greeting.clicked",
      error_stage="fact_project",
      error_message="Projector could not link candidate",
      payload_preview="candidate payload",
      occurred_at=event.occurred_at,
    )

    self.assertIsNotNone(repository.get_raw_event("evt_001"))
    self.assertEqual(error.error_stage, "fact_project")
    self.assertEqual(repository.list_errors(event_id="evt_001")[-1].error_message, error.error_message)

  def test_replay_filters_by_time_event_type_plugin_and_parse_status(self):
    repository = InMemoryRawEventRepository(clock=fixed_clock)
    repository.save_normalized_event(normalize_cls_event(make_record(
      event_id="evt_old",
      event_type="candidate_list.card_exposed",
      occurred_at="2026-05-16T10:00:00+08:00",
    )))
    repository.save_normalized_event(normalize_cls_event(make_record(
      event_id="evt_match",
      event_type="candidate_greeting.clicked",
      occurred_at="2026-05-17T10:00:00+08:00",
      plugin_version="0.1.0",
    )))
    repository.save_normalized_event(normalize_cls_event(make_record(
      event_id="evt_wrong_plugin",
      event_type="candidate_greeting.clicked",
      occurred_at="2026-05-17T11:00:00+08:00",
      plugin_version="0.2.0",
    )))
    repository.save_normalized_event(normalize_cls_event(make_record(
      event_id="evt_partial",
      event_type="candidate_greeting.clicked",
      occurred_at="2026-05-17T12:00:00+08:00",
      payload_json="{bad",
    )))

    replay = repository.replay_raw_events(ReplayFilter(
      occurred_from=datetime(2026, 5, 17, 0, 0, tzinfo=timezone.utc),
      occurred_to=datetime(2026, 5, 17, 23, 59, tzinfo=timezone.utc),
      event_types=frozenset({"candidate_greeting.clicked"}),
      plugin_versions=frozenset({"0.1.0"}),
      parse_statuses=frozenset({"parsed"}),
    ))

    self.assertEqual([record.event_id for record in replay], ["evt_match"])

  def test_replay_returns_events_in_occurred_order_after_idempotent_writes(self):
    repository = InMemoryRawEventRepository(clock=fixed_clock)
    repository.save_normalized_event(normalize_cls_event(make_record(
      event_id="evt_late",
      occurred_at="2026-05-17T12:00:00+08:00",
    )))
    repository.save_normalized_event(normalize_cls_event(make_record(
      event_id="evt_early",
      occurred_at="2026-05-17T09:00:00+08:00",
    )))
    repository.save_normalized_event(normalize_cls_event(make_record(
      event_id="evt_early",
      occurred_at="2026-05-17T09:30:00+08:00",
    )))

    replay = repository.replay_raw_events()

    self.assertEqual([record.event_id for record in replay], ["evt_early", "evt_late"])


if __name__ == "__main__":
  unittest.main()
