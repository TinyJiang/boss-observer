from __future__ import annotations

import json
import os
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import patch

from boss_analysis.consumer import (
  iter_daily_active_durations_from_file,
  iter_log_quality_summaries_from_file,
  iter_minute_summaries_from_file,
  load_cls_daily_summary_search_config,
  load_cls_log_quality_search_config,
  load_cls_summary_search_config,
  parse_daily_active_duration_record,
  parse_log_quality_summary_record,
  parse_minute_summary_record,
)


class SummaryReaderTests(unittest.TestCase):
  def test_parse_operator_funnel_summary_normalizes_aliases(self):
    record = parse_minute_summary_record({
      "minute": "2026-05-18 12:30:00.000",
      "operator_id": "zhouxinyu",
      "job_id": "job_001",
      "card_exposed": "9",
      "detail_opened": 2,
      "greeting_clicked": "1",
      "chat_snapshot_captured": "3",
      "wechat_captured": "1",
      "total_events": "16",
    })

    self.assertIsNotNone(record)
    self.assertEqual(record.metric_name, "boss_minute_operator_funnel")
    self.assertEqual(record.operator_id, "zhouxinyu")
    self.assertEqual(record.minute.isoformat(), "2026-05-18T12:30:00+08:00")
    self.assertEqual(record.card_exposed, 9)
    self.assertEqual(record.chat_snapshots, 3)
    self.assertEqual(record.event_count, 16)

  def test_parse_chat_summary_marks_missing_operator(self):
    record = parse_minute_summary_record({
      "minute": "2026-05-18T12:30:00+08:00",
      "operator_id": "<missing>",
      "job_id": "<missing>",
      "snapshot_captured": "4",
      "report_required": "2",
      "capture_failed": "1",
      "chat_events": "7",
    })

    self.assertIsNotNone(record)
    self.assertEqual(record.metric_name, "boss_minute_chat")
    self.assertIsNone(record.operator_id)
    self.assertEqual(record.raw_operator_id, "<missing>")
    self.assertIsNone(record.job_id)
    self.assertEqual(record.chat_snapshots, 4)
    self.assertEqual(record.report_required, 2)

  def test_iter_minute_summaries_from_file_supports_cls_contents(self):
    with tempfile.TemporaryDirectory() as tmpdir:
      path = Path(tmpdir) / "summary.jsonl"
      path.write_text(json.dumps({
        "contents": {
          "minute": "2026-05-18T12:30:00+08:00",
          "operator_id": "op_001",
          "chat_events": 3,
        }
      }) + "\n", encoding="utf-8")

      records = list(iter_minute_summaries_from_file(path))

    self.assertEqual(len(records), 1)
    self.assertEqual(records[0].operator_id, "op_001")
    self.assertEqual(records[0].chat_events, 3)

  def test_parse_daily_active_duration_summary(self):
    record = parse_daily_active_duration_record({
      "metric_name": "boss_daily_operator_active_duration",
      "active_date": "2026-05-18",
      "operator_id": "zhouxinyu",
      "active_minutes": "37",
      "active_seconds": "2220",
      "first_active_minute": "2026-05-18T09:10:00+08:00",
      "last_active_minute": "2026-05-18T12:30:00+08:00",
      "source_minute_count": "37",
      "source_row_count": "41",
    })

    self.assertIsNotNone(record)
    self.assertEqual(record.metric_name, "boss_daily_operator_active_duration")
    self.assertEqual(record.active_date.isoformat(), "2026-05-18")
    self.assertEqual(record.operator_id, "zhouxinyu")
    self.assertEqual(record.active_minutes, 37)
    self.assertEqual(record.active_seconds, 2220)
    self.assertEqual(record.last_active_minute.isoformat(), "2026-05-18T12:30:00+08:00")

  def test_iter_daily_active_durations_from_file_supports_cls_contents(self):
    with tempfile.TemporaryDirectory() as tmpdir:
      path = Path(tmpdir) / "daily.jsonl"
      path.write_text(json.dumps({
        "contents": {
          "metric_name": "boss_daily_operator_active_duration",
          "active_date": "2026-05-18",
          "operator_id": "op_001",
          "active_minutes": 12,
        }
      }) + "\n", encoding="utf-8")

      records = list(iter_daily_active_durations_from_file(path))

    self.assertEqual(len(records), 1)
    self.assertEqual(records[0].operator_id, "op_001")
    self.assertEqual(records[0].active_seconds, 720)

  def test_parse_log_quality_summary_record(self):
    record = parse_log_quality_summary_record({
      "metric_name": "boss_10min_log_quality",
      "window_start": "2026-05-18T12:30:00+08:00",
      "window_minutes": "10",
      "plugin_version": "0.1.1",
      "event_type": "candidate_chat.snapshot_captured",
      "operator_id": "zhouxinyu",
      "page_type": "chat",
      "raw_event_count": "15",
      "checked_event_count": "15",
      "chat_candidate_missing_count": "2",
      "chat_candidate_low_confidence_count": "3",
      "chat_message_quality_issue_count": "4",
      "chat_message_fingerprint_missing_count": "1",
      "source_row_count": "15",
    })

    self.assertIsNotNone(record)
    self.assertEqual(record.metric_name, "boss_10min_log_quality")
    self.assertEqual(record.window_start.isoformat(), "2026-05-18T12:30:00+08:00")
    self.assertEqual(record.window_minutes, 10)
    self.assertEqual(record.plugin_version, "0.1.1")
    self.assertEqual(record.event_type, "candidate_chat.snapshot_captured")
    self.assertEqual(record.operator_id, "zhouxinyu")
    self.assertEqual(record.raw_event_count, 15)
    self.assertEqual(record.chat_candidate_missing_count, 2)
    self.assertEqual(record.chat_message_quality_issue_count, 4)
    self.assertEqual(record.chat_message_fingerprint_missing_count, 1)

  def test_iter_log_quality_summaries_from_file_supports_cls_contents(self):
    with tempfile.TemporaryDirectory() as tmpdir:
      path = Path(tmpdir) / "quality.jsonl"
      path.write_text(json.dumps({
        "contents": {
          "metric_name": "boss_10min_log_quality",
          "window_start": "2026-05-18T12:30:00+08:00",
          "plugin_version": "0.1.1",
          "event_type": "candidate_detail.opened",
          "operator_id": "<missing>",
          "raw_event_count": 8,
          "detail_card_link_hint_missing_count": 2,
        }
      }) + "\n", encoding="utf-8")

      records = list(iter_log_quality_summaries_from_file(path))

    self.assertEqual(len(records), 1)
    self.assertIsNone(records[0].operator_id)
    self.assertEqual(records[0].raw_operator_id, "<missing>")
    self.assertEqual(records[0].detail_card_link_hint_missing_count, 2)

  def test_load_cls_summary_config_uses_summary_topic_and_shared_credentials(self):
    env = {
      "CLS_SUMMARY_TOPIC_ID": "topic-summary",
      "CLS_SUMMARY_REGION": "ap-shanghai",
      "TENCENTCLOUD_SECRET_ID": "secret-id",
      "TENCENTCLOUD_SECRET_KEY": "secret-key",
      "CLS_SUMMARY_WINDOW_MINUTES": "240",
    }
    with patch.dict(os.environ, env, clear=False):
      config = load_cls_summary_search_config()

    self.assertEqual(config.topic_id, "topic-summary")
    self.assertEqual(config.region, "ap-shanghai")
    self.assertEqual(config.window_minutes, 240)
    self.assertEqual(config.window_mode, "relative")
    self.assertEqual(config.credentials.secret_id, "secret-id")

  def test_load_cls_summary_config_defaults_to_day_window(self):
    env = {
      "CLS_SUMMARY_TOPIC_ID": "topic-summary",
      "TENCENTCLOUD_SECRET_ID": "secret-id",
      "TENCENTCLOUD_SECRET_KEY": "secret-key",
    }
    with patch.dict(os.environ, env, clear=True):
      config = load_cls_summary_search_config()

    self.assertEqual(config.window_mode, "today")
    self.assertEqual(config.window_label, "today:Asia/Shanghai")

  def test_load_cls_daily_summary_config_uses_daily_topic(self):
    env = {
      "CLS_DAILY_SUMMARY_TOPIC_ID": "topic-daily",
      "CLS_DAILY_SUMMARY_REGION": "ap-shanghai",
      "TENCENTCLOUD_SECRET_ID": "secret-id",
      "TENCENTCLOUD_SECRET_KEY": "secret-key",
    }
    with patch.dict(os.environ, env, clear=False):
      config = load_cls_daily_summary_search_config()

    self.assertEqual(config.topic_id, "topic-daily")
    self.assertEqual(config.region, "ap-shanghai")
    self.assertEqual(config.query, "*")
    self.assertEqual(config.window_mode, "today")

  def test_load_cls_log_quality_config_uses_health_topic(self):
    env = {
      "CLS_LOG_QUALITY_TOPIC_ID": "topic-health",
      "CLS_LOG_QUALITY_REGION": "ap-guangzhou",
      "TENCENTCLOUD_SECRET_ID": "secret-id",
      "TENCENTCLOUD_SECRET_KEY": "secret-key",
    }
    with patch.dict(os.environ, env, clear=False):
      config = load_cls_log_quality_search_config()

    self.assertEqual(config.topic_id, "topic-health")
    self.assertEqual(config.region, "ap-guangzhou")
    self.assertEqual(config.query, "*")
    self.assertEqual(config.window_mode, "today")


if __name__ == "__main__":
  unittest.main()
