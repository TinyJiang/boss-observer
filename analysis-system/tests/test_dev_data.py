from __future__ import annotations

import json
import os
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import patch

from boss_analysis.dev_data import create_dev_dataset, create_dev_state, iter_cls_records_from_file, iter_cls_records_from_search


class FakeSummaryClsClient:
  def call(self, action, payload, *, version, region):
    return {
      "Response": {
        "Results": [
          {
            "LogJson": json.dumps({
              "minute": "2026-05-17T09:14:00+08:00",
              "operator_id": "op_real",
              "job_id": "job_real",
              "card_exposed": 5,
              "total_events": 5,
            }),
          }
        ]
      }
    }


class FakeDailySummaryClsClient:
  def call(self, action, payload, *, version, region):
    return {
      "Response": {
        "Results": [
          {
            "LogJson": json.dumps({
              "metric_name": "boss_daily_operator_active_duration",
              "active_date": "2026-05-17",
              "operator_id": "op_real",
              "active_minutes": 18,
              "active_seconds": 1080,
              "last_active_minute": "2026-05-17T09:14:00+08:00",
            }),
          }
        ]
      }
    }


class FakeLogQualityClsClient:
  def call(self, action, payload, *, version, region):
    return {
      "Response": {
        "Results": [
          {
            "LogJson": json.dumps({
              "metric_name": "boss_10min_log_quality",
              "window_start": "2026-05-17T09:10:00+08:00",
              "plugin_version": "0.1.1",
              "event_type": "candidate_detail.opened",
              "operator_id": "op_real",
              "raw_event_count": 8,
              "checked_event_count": 8,
              "detail_card_link_hint_missing_count": 2,
            }),
          }
        ]
      }
    }


class FailingClsClient:
  def call(self, action, payload, *, version, region):
    raise AssertionError("raw CLS SearchLog should not be queried")


def plugin_event(event_id="evt_plugin_001"):
  return {
    "id": event_id,
    "type": "candidate_list.card_exposed",
    "occurredAt": "2026-05-17T09:00:00+08:00",
    "pluginVersion": "0.1.0",
    "operator": {
      "operatorId": "op_real",
      "accountName": "op_real",
      "bossAccountName": "op_real",
      "bossAccountMatched": True,
    },
    "context": {
      "sessionId": "sess_real",
      "pageType": "candidate_recommend",
      "pageUrl": "https://www.zhipin.com/web/chat/recommend",
      "pageTitle": "candidate recommendations",
      "jobContext": {
        "jobId": "job_real",
        "jobStatus": "0",
      },
    },
    "payload": {
      "candidate": {
        "candidateId": "candidate_real",
        "stableId": "geek_real",
        "stableIdSource": "url.geekId",
        "identityConfidence": "high",
      },
      "exposure": {
        "cardIndex": 0,
      },
    },
    "sourceTabId": 1,
    "sourceWindowId": 2,
    "sourceTabUrl": "https://www.zhipin.com/web/chat/recommend",
  }


class DevDataTests(unittest.TestCase):
  def test_iter_cls_records_supports_plugin_batch_json(self):
    with tempfile.TemporaryDirectory() as tmpdir:
      path = Path(tmpdir) / "events.json"
      path.write_text(json.dumps({"events": [plugin_event()]}), encoding="utf-8")

      records = list(iter_cls_records_from_file(path))

    self.assertEqual(records[0]["event_id"], "evt_plugin_001")
    self.assertEqual(records[0]["operator_id"], "op_real")
    self.assertEqual(records[0]["job_id"], "job_real")
    self.assertIn("candidate_real", records[0]["payload_json"])

  def test_iter_cls_records_supports_jsonl_cls_contents(self):
    with tempfile.TemporaryDirectory() as tmpdir:
      path = Path(tmpdir) / "events.jsonl"
      line = {
        "contents": {
          "event_id": "evt_contents_001",
          "event_type": "candidate_greeting.clicked",
          "occurred_at": "2026-05-17T09:00:00+08:00",
          "operator_id": "op_real",
          "payload_json": {"candidate": {"candidateId": "candidate_real"}},
          "context_json": {"sessionId": "sess_real"},
        }
      }
      path.write_text(json.dumps(line) + "\n", encoding="utf-8")

      records = list(iter_cls_records_from_file(path))

    self.assertEqual(records[0]["event_id"], "evt_contents_001")
    self.assertIsInstance(records[0]["payload_json"], str)
    self.assertIsInstance(records[0]["context_json"], str)

  def test_create_dev_state_uses_real_data_file_without_demo(self):
    with tempfile.TemporaryDirectory() as tmpdir:
      path = Path(tmpdir) / "events.json"
      path.write_text(json.dumps([plugin_event()]), encoding="utf-8")

      raw_repository, fact_store, generated_at = create_dev_state(
        now=datetime(2026, 5, 17, 1, 0, tzinfo=timezone.utc),
        data_file=path,
        use_demo_fallback=False,
      )

    self.assertEqual(len(raw_repository.replay_raw_events()), 1)
    self.assertEqual(len(fact_store.candidate_exposures()), 1)
    self.assertEqual(generated_at.isoformat(), "2026-05-17T01:00:00+00:00")

  def test_create_dev_dataset_reports_real_file_source(self):
    with tempfile.TemporaryDirectory() as tmpdir:
      path = Path(tmpdir) / "events.json"
      path.write_text(json.dumps([plugin_event()]), encoding="utf-8")

      dataset = create_dev_dataset(
        now=datetime(2026, 5, 17, 1, 0, tzinfo=timezone.utc),
        data_source="file",
        data_file=path,
        use_demo_fallback=False,
      )

    self.assertEqual(dataset.source.kind, "real_file")
    self.assertEqual(dataset.source.label, "真实数据文件")
    self.assertEqual(dataset.source.record_count, 1)

  def test_create_dev_dataset_real_source_prefers_data_file(self):
    with tempfile.TemporaryDirectory() as tmpdir:
      path = Path(tmpdir) / "events.json"
      path.write_text(json.dumps([plugin_event()]), encoding="utf-8")

      dataset = create_dev_dataset(
        now=datetime(2026, 5, 17, 1, 0, tzinfo=timezone.utc),
        data_source="real",
        data_file=path,
        use_demo_fallback=False,
      )

    self.assertEqual(dataset.source.kind, "real_file")
    self.assertEqual(dataset.source.record_count, 1)

  def test_create_dev_state_can_start_empty_without_demo(self):
    raw_repository, fact_store, _ = create_dev_state(
      now=datetime(2026, 5, 17, 1, 0, tzinfo=timezone.utc),
      use_demo_fallback=False,
    )

    self.assertEqual(raw_repository.replay_raw_events(), ())
    self.assertEqual(fact_store.candidate_exposures(), ())

  def test_iter_cls_records_from_search_fails_closed(self):
    with self.assertRaisesRegex(RuntimeError, "raw CLS SearchLog data source is disabled"):
      list(iter_cls_records_from_search(
        now=datetime(2026, 5, 17, 1, 0, tzinfo=timezone.utc),
        client=FailingClsClient(),
      ))

  def test_create_dev_dataset_real_source_uses_summary_without_data_file(self):
    env = {
      "CLS_SUMMARY_TOPIC_ID": "topic-summary",
      "TENCENTCLOUD_SECRET_ID": "secret-id",
      "TENCENTCLOUD_SECRET_KEY": "secret-key",
    }
    with patch.dict(os.environ, env, clear=True):
      dataset = create_dev_dataset(
        now=datetime(2026, 5, 17, 1, 0, tzinfo=timezone.utc),
        data_source="real",
        use_demo_fallback=False,
        cls_client=FailingClsClient(),
        summary_cls_client=FakeSummaryClsClient(),
      )

    self.assertEqual(dataset.source.kind, "summary")
    self.assertEqual(dataset.source.label, "CLS 分钟汇总")
    self.assertEqual(dataset.source.record_count, 0)
    self.assertEqual(len(dataset.raw_repository.replay_raw_events()), 0)
    self.assertEqual(dataset.summary_source.kind, "summary_topic")
    self.assertEqual(dataset.summary_source.record_count, 1)

  def test_create_dev_dataset_loads_summary_source_when_configured(self):
    env = {
      "CLS_SUMMARY_TOPIC_ID": "topic-summary",
      "TENCENTCLOUD_SECRET_ID": "secret-id",
      "TENCENTCLOUD_SECRET_KEY": "secret-key",
    }
    with patch.dict(os.environ, env, clear=False):
      dataset = create_dev_dataset(
        now=datetime(2026, 5, 17, 1, 15, tzinfo=timezone.utc),
        data_source="summary",
        use_demo_fallback=False,
        cls_client=FailingClsClient(),
        summary_cls_client=FakeSummaryClsClient(),
      )

    self.assertIsNotNone(dataset.summary_source)
    self.assertEqual(dataset.source.kind, "summary")
    self.assertEqual(dataset.summary_source.kind, "summary_topic")
    self.assertEqual(dataset.summary_source.record_count, 1)
    self.assertEqual(dataset.minute_summaries[0].operator_id, "op_real")

  def test_create_dev_dataset_loads_daily_summary_source_when_configured(self):
    env = {
      "CLS_DAILY_SUMMARY_TOPIC_ID": "topic-daily",
      "TENCENTCLOUD_SECRET_ID": "secret-id",
      "TENCENTCLOUD_SECRET_KEY": "secret-key",
    }
    with patch.dict(os.environ, env, clear=True):
      dataset = create_dev_dataset(
        now=datetime(2026, 5, 17, 1, 15, tzinfo=timezone.utc),
        data_source="summary",
        use_demo_fallback=False,
        cls_client=FailingClsClient(),
        daily_summary_cls_client=FakeDailySummaryClsClient(),
      )

    self.assertEqual(dataset.source.kind, "summary")
    self.assertIsNone(dataset.summary_source)
    self.assertEqual(dataset.daily_summary_source.kind, "daily_summary_topic")
    self.assertEqual(dataset.daily_summary_source.record_count, 1)
    self.assertEqual(dataset.daily_active_durations[0].operator_id, "op_real")
    self.assertEqual(dataset.daily_active_durations[0].active_minutes, 18)

  def test_create_dev_dataset_loads_log_quality_source_when_configured(self):
    env = {
      "CLS_LOG_QUALITY_TOPIC_ID": "topic-health",
      "TENCENTCLOUD_SECRET_ID": "secret-id",
      "TENCENTCLOUD_SECRET_KEY": "secret-key",
    }
    with patch.dict(os.environ, env, clear=True):
      dataset = create_dev_dataset(
        now=datetime(2026, 5, 17, 1, 15, tzinfo=timezone.utc),
        data_source="summary",
        use_demo_fallback=False,
        cls_client=FailingClsClient(),
        log_quality_cls_client=FakeLogQualityClsClient(),
      )

    self.assertEqual(dataset.source.kind, "summary")
    self.assertIsNone(dataset.summary_source)
    self.assertEqual(dataset.log_quality_source.kind, "log_quality_topic")
    self.assertEqual(dataset.log_quality_source.record_count, 1)
    self.assertEqual(dataset.log_quality_summaries[0].plugin_version, "0.1.1")
    self.assertEqual(dataset.log_quality_summaries[0].detail_card_link_hint_missing_count, 2)

  def test_create_dev_dataset_summary_does_not_query_raw_logs(self):
    env = {
      "CLS_SUMMARY_TOPIC_ID": "topic-summary",
      "TENCENTCLOUD_SECRET_ID": "secret-id",
      "TENCENTCLOUD_SECRET_KEY": "secret-key",
    }
    with patch.dict(os.environ, env, clear=True):
      dataset = create_dev_dataset(
        now=datetime(2026, 5, 17, 1, 15, tzinfo=timezone.utc),
        data_source="summary",
        use_demo_fallback=False,
        cls_client=FailingClsClient(),
        summary_cls_client=FakeSummaryClsClient(),
      )

    self.assertEqual(dataset.source.kind, "summary")
    self.assertEqual(dataset.source.label, "CLS 分钟汇总")
    self.assertEqual(dataset.source.record_count, 0)
    self.assertEqual(len(dataset.raw_repository.replay_raw_events()), 0)
    self.assertEqual(dataset.summary_source.kind, "summary_topic")
    self.assertEqual(dataset.summary_source.record_count, 1)
    self.assertEqual(dataset.minute_summaries[0].operator_id, "op_real")

  def test_create_dev_dataset_summary_requires_summary_topic(self):
    env = {
      "TENCENTCLOUD_SECRET_ID": "secret-id",
      "TENCENTCLOUD_SECRET_KEY": "secret-key",
    }
    with patch.dict(os.environ, env, clear=True):
      with self.assertRaisesRegex(ValueError, "CLS_SUMMARY_TOPIC_ID.*CLS_DAILY_SUMMARY_TOPIC_ID"):
        create_dev_dataset(
          now=datetime(2026, 5, 17, 1, 15, tzinfo=timezone.utc),
          data_source="summary",
          use_demo_fallback=False,
        )


if __name__ == "__main__":
  unittest.main()
