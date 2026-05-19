from __future__ import annotations

import json
import unittest
from datetime import datetime, timezone

from boss_analysis.consumer import normalize_cls_event


def make_record(**overrides):
  record = {
    "event_id": "evt_001",
    "event_type": "candidate_list.card_exposed",
    "occurred_at": "2026-05-17T09:12:30.456+08:00",
    "plugin_version": "0.1.0",
    "operator_id": "op_001",
    "operator_account_name": "operator-a",
    "boss_account_name": "operator-a",
    "boss_account_matched": True,
    "session_id": "sess_001",
    "page_type": "candidate_recommend",
    "page_url": "https://www.zhipin.com/web/chat/recommend",
    "page_title": "candidate recommendations",
    "job_id": "job_001",
    "job_status": "0",
    "source_tab_id": 669699710,
    "source_window_id": 669699709,
    "source_tab_url": "https://www.zhipin.com/web/chat/recommend",
    "payload_json": json.dumps({
      "candidate": {
        "stableId": "geek_001",
        "stableIdSource": "url.geekId",
      },
      "exposure": {
        "cardIndex": 0,
      },
    }),
    "context_json": json.dumps({
      "sessionId": "sess_001",
      "pageType": "candidate_recommend",
      "jobContext": {
        "jobId": "job_001",
      },
    }),
  }
  record.update(overrides)
  return record


class NormalizeClsEventTests(unittest.TestCase):
  def test_normalizes_complete_cls_record(self):
    received_at = datetime(2026, 5, 17, 1, 13, tzinfo=timezone.utc)

    event = normalize_cls_event(make_record(), received_at=received_at)

    self.assertEqual(event.parse_status, "parsed")
    self.assertEqual(event.parse_errors, ())
    self.assertEqual(event.event_id, "evt_001")
    self.assertEqual(event.event_type, "candidate_list.card_exposed")
    self.assertEqual(event.occurred_at.isoformat(), "2026-05-17T09:12:30.456000+08:00")
    self.assertEqual(event.received_at, received_at)
    self.assertEqual(event.payload["candidate"]["stableId"], "geek_001")
    self.assertEqual(event.context["jobContext"]["jobId"], "job_001")
    self.assertTrue(event.boss_account_matched)
    self.assertEqual(event.source_tab_id, "669699710")

  def test_unknown_event_type_is_still_parsed(self):
    event = normalize_cls_event(
      make_record(event_type="future_module.new_fact"),
      received_at=datetime(2026, 5, 17, 1, 13, tzinfo=timezone.utc),
    )

    self.assertEqual(event.parse_status, "parsed")
    self.assertEqual(event.event_type, "future_module.new_fact")

  def test_missing_event_id_fails_but_preserves_raw_record(self):
    record = make_record(event_id="  ")

    event = normalize_cls_event(record)

    self.assertEqual(event.parse_status, "failed")
    self.assertIsNone(event.event_id)
    self.assertEqual(event.raw["payload_json"], record["payload_json"])
    self.assertIn("missing_required", {issue.code for issue in event.parse_errors})

  def test_invalid_payload_and_context_json_make_event_partial(self):
    event = normalize_cls_event(
      make_record(payload_json="{bad", context_json="["),
      received_at=datetime(2026, 5, 17, 1, 13, tzinfo=timezone.utc),
    )

    self.assertEqual(event.parse_status, "partial")
    self.assertIsNone(event.payload)
    self.assertIsNone(event.context)
    self.assertEqual(
      [issue.field for issue in event.parse_errors],
      ["payload_json", "context_json"],
    )
    self.assertEqual(
      {issue.code for issue in event.parse_errors},
      {"invalid_json"},
    )

  def test_late_or_out_of_order_event_time_is_accepted(self):
    event = normalize_cls_event(
      make_record(occurred_at="2026-05-10T08:00:00+08:00"),
      received_at=datetime(2026, 5, 17, 12, 0, tzinfo=timezone.utc),
    )

    self.assertEqual(event.parse_status, "parsed")
    self.assertEqual(event.occurred_at.isoformat(), "2026-05-10T08:00:00+08:00")

  def test_string_boolean_values_are_compatible(self):
    true_event = normalize_cls_event(make_record(boss_account_matched="true"))
    false_event = normalize_cls_event(make_record(boss_account_matched="0"))

    self.assertEqual(true_event.parse_status, "parsed")
    self.assertTrue(true_event.boss_account_matched)
    self.assertEqual(false_event.parse_status, "parsed")
    self.assertFalse(false_event.boss_account_matched)

  def test_unrecognized_boolean_value_is_partial(self):
    event = normalize_cls_event(make_record(boss_account_matched="unknown"))

    self.assertEqual(event.parse_status, "partial")
    self.assertIsNone(event.boss_account_matched)
    self.assertEqual(event.parse_errors[0].field, "boss_account_matched")
    self.assertEqual(event.parse_errors[0].code, "invalid_boolean")


if __name__ == "__main__":
  unittest.main()
