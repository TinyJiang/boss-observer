from __future__ import annotations

import json
import os
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import patch

from boss_analysis.api import AnalysisQueryService
from boss_analysis.dev_data import create_dev_state
from boss_analysis.domain import LogQualitySummaryRecord
from boss_analysis.dev_server import DevApp, INDEX_HTML, load_env_files, make_handler


def plugin_event(event_id):
  return {
    "id": event_id,
    "type": "candidate_list.card_exposed",
    "occurredAt": "2026-05-17T09:14:00+08:00",
    "operator": {
      "operatorId": "op_real",
      "bossAccountMatched": True,
    },
    "context": {
      "sessionId": "sess_real",
      "pageType": "candidate_recommend",
      "pageUrl": "https://www.zhipin.com/web/chat/recommend",
      "jobContext": {
        "jobId": "job_real",
      },
    },
    "payload": {
      "candidate": {
        "candidateId": "candidate_real",
      },
    },
  }


class DevServerTests(unittest.TestCase):
  def test_dev_data_populates_dashboard_facts(self):
    raw_repository, fact_store, generated_at = create_dev_state(
      now=datetime(2026, 5, 17, 1, 15, tzinfo=timezone.utc),
    )
    query_service = AnalysisQueryService(
      fact_store,
      raw_repository=raw_repository,
      clock=lambda: generated_at,
    )
    dashboard = query_service.dashboard()

    self.assertEqual(len(raw_repository.replay_raw_events()), 64)
    self.assertEqual(len(fact_store.candidate_exposures()), 10)
    self.assertEqual(dashboard.active_count, 10)
    self.assertIn("zhouxinyu", {operator.operator_id for operator in dashboard.active_operators})
    for active_operator in dashboard.active_operators:
      analytics = query_service.operator_analytics(active_operator.operator_id)
      self.assertEqual(analytics.funnel.card_exposed, 1)
      self.assertEqual(analytics.funnel.detail_opened, 1)
      self.assertEqual(analytics.funnel.greeting_clicked, 1)
      self.assertEqual(analytics.funnel.greeting_succeeded, 1)
      self.assertEqual(analytics.chat.chat_opened, 1)
      self.assertEqual(analytics.chat.snapshot_captured, 1)
    self.assertEqual(generated_at.isoformat(), "2026-05-17T01:15:00+00:00")

  def test_dev_app_payloads_are_json_safe(self):
    app = DevApp()

    dashboard = app.dashboard_payload()
    operator = app.operator_payload("zhouxinyu")
    encoded = json.dumps({"dashboard": dashboard, "operator": operator})

    self.assertIn("active_count", encoded)
    self.assertIn("card_exposed", encoded)
    self.assertIn("source", encoded)
    self.assertIn("log_quality_source", encoded)
    self.assertNotIn("redacted-in-facts", encoded)

  def test_http_handler_and_payloads_are_available_without_binding_socket(self):
    app = DevApp()
    handler_class = make_handler(app)
    payload = app.dashboard_payload()

    self.assertTrue(hasattr(handler_class, "do_GET"))
    self.assertIn("Realtime recruiting activity", INDEX_HTML)
    self.assertIn("dashboard", payload)
    self.assertIn("source", payload)
    self.assertIn("log_quality_source", payload)
    self.assertGreaterEqual(payload["dashboard"]["active_count"], 1)

  def test_index_is_dashboard_not_landing_page(self):
    self.assertIn("Active operators", INDEX_HTML)
    self.assertIn("Operator detail", INDEX_HTML)

  def test_require_real_data_rejects_demo_fallback(self):
    with self.assertRaisesRegex(ValueError, "Real data is required"):
      DevApp(data_source="demo", require_real_data=True)

  def test_load_env_files_reads_key_values_without_overriding_existing_env(self):
    with tempfile.TemporaryDirectory() as tmpdir:
      path = Path(tmpdir) / ".env"
      path.write_text(
        "\n".join([
          "CLS_SUMMARY_TOPIC_ID=topic-from-file",
          "CLS_SUMMARY_QUERY='metric_name:boss_minute_chat'",
          "EXISTING_VALUE=from-file",
        ]),
        encoding="utf-8",
      )

      with patch.dict(os.environ, {"EXISTING_VALUE": "from-env"}, clear=False):
        loaded = load_env_files([str(path)])

        self.assertEqual(loaded, [path])
        self.assertEqual(os.environ["CLS_SUMMARY_TOPIC_ID"], "topic-from-file")
        self.assertEqual(os.environ["CLS_SUMMARY_QUERY"], "metric_name:boss_minute_chat")
        self.assertEqual(os.environ["EXISTING_VALUE"], "from-env")

  def test_dev_app_refreshes_real_file_source(self):
    with tempfile.TemporaryDirectory() as tmpdir:
      path = Path(tmpdir) / "events.json"
      path.write_text(json.dumps([plugin_event("evt_file_001")]), encoding="utf-8")
      app = DevApp(
        data_source="file",
        data_file=str(path),
        require_real_data=True,
        refresh_seconds=0,
      )

      first = app.dashboard_payload()
      path.write_text(
        json.dumps([plugin_event("evt_file_001"), plugin_event("evt_file_002")]),
        encoding="utf-8",
      )
      second = app.dashboard_payload()

    self.assertEqual(first["source"]["kind"], "real_file")
    self.assertEqual(first["health"]["raw_event_count"], 1)
    self.assertEqual(second["health"]["raw_event_count"], 2)

  def test_dev_app_hot_loads_operator_config_file(self):
    with tempfile.TemporaryDirectory() as tmpdir:
      path = Path(tmpdir) / "operators.json"
      path.write_text(json.dumps({
        "operators": [
          {"operatorId": "op_001", "displayName": "Operator One"},
        ]
      }), encoding="utf-8")
      app = DevApp(operator_config_file=str(path))

      first = app.dashboard_payload()
      path.write_text(json.dumps({
        "operators": [
          {"operatorId": "op_001", "displayName": "Operator One+"},
          {"operatorId": "op_extra", "displayName": "Operator Extra"},
        ]
      }), encoding="utf-8")
      second = app.dashboard_payload()

    self.assertEqual(first["dashboard"]["configured_operators"][0]["display_name"], "Operator One")
    self.assertEqual(second["dashboard"]["configured_operators"][0]["display_name"], "Operator One+")
    self.assertEqual(second["dashboard"]["configured_operators"][1]["operator_id"], "op_extra")

  def test_dev_app_serves_operator_config_without_dashboard_refresh(self):
    with tempfile.TemporaryDirectory() as tmpdir:
      path = Path(tmpdir) / "operators.json"
      path.write_text(json.dumps({
        "operators": [
          {"operatorId": "op_001", "displayName": "Operator One"},
        ]
      }), encoding="utf-8")
      app = DevApp(
        data_source="empty",
        use_demo_fallback=False,
        operator_config_file=str(path),
      )

      first = app.operators_payload()
      path.write_text(json.dumps({
        "operators": [
          {"operatorId": "op_001", "displayName": "Operator One+"},
          {"operatorId": "op_002", "displayName": "Operator Two"},
        ]
      }), encoding="utf-8")
      second = app.operators_payload()

    self.assertEqual(first["operators"][0]["display_name"], "Operator One")
    self.assertEqual(second["operators"][0]["display_name"], "Operator One+")
    self.assertEqual(second["operators"][1]["operator_id"], "op_002")

  def test_dev_app_log_quality_payload_filters_query_conditions(self):
    app = DevApp(data_source="empty", use_demo_fallback=False)
    app._log_quality_summaries = (
      LogQualitySummaryRecord(
        metric_name="boss_10min_log_quality",
        window_start=datetime(2026, 5, 17, 1, 0, tzinfo=timezone.utc),
        plugin_version="0.1.1",
        event_type="candidate_detail.opened",
        operator_id="op_real",
        raw_event_count=10,
        checked_event_count=10,
        detail_card_link_hint_missing_count=2,
      ),
      LogQualitySummaryRecord(
        metric_name="boss_10min_log_quality",
        window_start=datetime(2026, 5, 17, 1, 0, tzinfo=timezone.utc),
        plugin_version="0.1.2",
        event_type="candidate_detail.opened",
        operator_id="op_real",
        raw_event_count=9,
        checked_event_count=9,
      ),
    )
    app.query_service = app._build_query_service()

    payload = app.log_quality_payload(
      operator_id="op_real",
      plugin_version="0.1.1",
    )

    self.assertEqual(payload["quality"]["operator_id"], "op_real")
    self.assertEqual(payload["quality"]["plugin_version"], "0.1.1")
    self.assertEqual(payload["quality"]["source_record_count"], 2)
    self.assertEqual(payload["quality"]["record_count"], 1)
    self.assertEqual(payload["quality"]["finding_count"], 2)


if __name__ == "__main__":
  unittest.main()
