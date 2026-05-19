from __future__ import annotations

import json
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path

from boss_analysis.consumer import normalize_cls_event
from boss_analysis.domain import ReplayFilter
from boss_analysis.storage import SQLiteRawEventRepository


def fixed_clock():
  return datetime(2026, 5, 17, 14, 0, tzinfo=timezone.utc)


def make_record(**overrides):
  record = {
    "event_id": "evt_sqlite_001",
    "event_type": "candidate_chat.snapshot_captured",
    "occurred_at": "2026-05-17T09:12:30+08:00",
    "plugin_version": "0.1.0",
    "operator_id": "op_001",
    "operator_account_name": "operator-a",
    "boss_account_name": "operator-a",
    "boss_account_matched": "true",
    "session_id": "sess_001",
    "page_type": "chat",
    "page_url": "https://www.zhipin.com/web/chat/index",
    "page_title": "chat",
    "job_id": "job_001",
    "job_status": "0",
    "source_tab_id": 1,
    "source_window_id": 2,
    "source_tab_url": "https://www.zhipin.com/web/chat/index",
    "payload_json": json.dumps({
      "chat": {
        "messageCount": 2,
      },
    }),
    "context_json": json.dumps({
      "sessionId": "sess_001",
    }),
  }
  record.update(overrides)
  return record


class SQLiteRawEventRepositoryTests(unittest.TestCase):
  def test_saves_and_reads_raw_event(self):
    repository = SQLiteRawEventRepository(clock=fixed_clock)
    event = normalize_cls_event(make_record())

    result = repository.save_normalized_event(event)
    stored = repository.get_raw_event("evt_sqlite_001")

    self.assertTrue(result.inserted)
    self.assertEqual(stored.event_id, "evt_sqlite_001")
    self.assertEqual(stored.event_type, "candidate_chat.snapshot_captured")
    self.assertEqual(stored.payload_json, event.raw["payload_json"])
    self.assertEqual(stored.raw_cls_json["operator_id"], "op_001")
    self.assertEqual(stored.boss_account_matched, True)
    repository.close()

  def test_duplicate_event_id_is_idempotent_and_does_not_overwrite(self):
    repository = SQLiteRawEventRepository(clock=fixed_clock)
    first = normalize_cls_event(make_record(event_type="candidate_chat.snapshot_captured"))
    duplicate = normalize_cls_event(make_record(event_type="candidate_chat.wechat_captured"))

    first_result = repository.save_normalized_event(first)
    duplicate_result = repository.save_normalized_event(duplicate)
    stored = repository.get_raw_event("evt_sqlite_001")

    self.assertTrue(first_result.inserted)
    self.assertFalse(duplicate_result.inserted)
    self.assertEqual(stored.event_type, "candidate_chat.snapshot_captured")
    self.assertEqual(len(repository.replay_raw_events()), 1)
    repository.close()

  def test_parse_errors_are_persisted_and_contact_info_is_masked_in_preview(self):
    repository = SQLiteRawEventRepository(clock=fixed_clock)
    event = normalize_cls_event(make_record(
      payload_json="{bad 13812345678 test@example.com",
    ))

    result = repository.save_normalized_event(event)
    errors = repository.list_errors(event_id="evt_sqlite_001")

    self.assertEqual(result.record.parse_status, "partial")
    self.assertEqual(len(errors), 1)
    self.assertEqual(errors[0].source_error_code, "invalid_json")
    self.assertIn("138****5678", errors[0].payload_preview)
    self.assertIn("t***@example.com", errors[0].payload_preview)
    self.assertNotIn("13812345678", errors[0].payload_preview)
    repository.close()

  def test_missing_event_id_records_error_without_raw_event(self):
    repository = SQLiteRawEventRepository(clock=fixed_clock)
    event = normalize_cls_event(make_record(event_id=""))

    result = repository.save_normalized_event(event)

    self.assertFalse(result.inserted)
    self.assertIsNone(result.record)
    self.assertEqual(repository.replay_raw_events(), ())
    self.assertEqual(repository.list_errors()[0].source_error_code, "missing_required")
    repository.close()

  def test_replay_filters_by_type_plugin_and_parse_status(self):
    repository = SQLiteRawEventRepository(clock=fixed_clock)
    repository.save_normalized_event(normalize_cls_event(make_record(
      event_id="evt_old",
      event_type="candidate_list.card_exposed",
      occurred_at="2026-05-16T10:00:00+08:00",
    )))
    repository.save_normalized_event(normalize_cls_event(make_record(
      event_id="evt_match",
      event_type="candidate_chat.snapshot_captured",
      occurred_at="2026-05-17T10:00:00+08:00",
      plugin_version="0.1.0",
    )))
    repository.save_normalized_event(normalize_cls_event(make_record(
      event_id="evt_partial",
      event_type="candidate_chat.snapshot_captured",
      occurred_at="2026-05-17T12:00:00+08:00",
      payload_json="{bad",
    )))

    replay = repository.replay_raw_events(ReplayFilter(
      occurred_from=datetime(2026, 5, 17, 0, 0, tzinfo=timezone.utc),
      occurred_to=datetime(2026, 5, 17, 23, 59, tzinfo=timezone.utc),
      event_types=frozenset({"candidate_chat.snapshot_captured"}),
      plugin_versions=frozenset({"0.1.0"}),
      parse_statuses=frozenset({"parsed"}),
    ))

    self.assertEqual([record.event_id for record in replay], ["evt_match"])
    repository.close()

  def test_database_file_can_be_reopened(self):
    with tempfile.TemporaryDirectory() as tmpdir:
      db_path = Path(tmpdir) / "events.sqlite3"
      repository = SQLiteRawEventRepository(db_path, clock=fixed_clock)
      repository.save_normalized_event(normalize_cls_event(make_record()))
      repository.record_error(
        event_id="evt_sqlite_001",
        event_type="candidate_chat.snapshot_captured",
        error_stage="fact_project",
        error_message="projection failed",
      )
      repository.close()

      reopened = SQLiteRawEventRepository(db_path, clock=fixed_clock)
      self.assertEqual(reopened.get_raw_event("evt_sqlite_001").event_id, "evt_sqlite_001")
      self.assertEqual(reopened.list_errors(event_id="evt_sqlite_001")[-1].error_stage, "fact_project")
      reopened.close()


if __name__ == "__main__":
  unittest.main()
