from __future__ import annotations

import json
import os
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import patch

from boss_analysis.api import AnalysisQueryService
from boss_analysis.dev_data import DevDataSourceInfo, create_dev_state
from boss_analysis.domain import DailyBasicStatsRecord, LogQualitySummaryRecord
from boss_analysis.dev_server import APP_JS, DevApp, INDEX_HTML, _decode_path_segment, load_env_files, make_handler


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
    self.assertIn("daily_basic_summary_source", encoded)
    self.assertNotIn("redacted-in-facts", encoded)

  def test_dev_app_daily_analysis_payload_is_json_safe(self):
    with tempfile.TemporaryDirectory() as tmpdir:
      path = Path(tmpdir) / "daily-analysis-result.json"
      path.write_text(json.dumps({
        "status": "ready",
        "analysis_date": "2026-06-15",
        "generated_at": "2026-06-16T02:00:00+00:00",
        "scope": {"operator_id": "op_demo", "display_name": "演示操作员"},
        "sync_state": {"analysis_source": "offline_daily_analysis_result"},
        "volatility_metrics": [],
        "evidence_bundle": {
          "operator_results": [],
          "job_results": [],
          "behavior_summaries": [],
          "job_actions": [],
        },
        "model_analysis": {
          "summary": "离线分析完成",
          "generated_at": "2026-06-16T02:00:00+00:00",
          "analyzer": "offline_codex_analysis",
          "attributions": [{"confidence": "medium"}],
          "questions_for_next_collection": [],
        },
        "data_quality": {
          "missing_fields": [],
          "unmatched_jobs": [],
          "low_sample_warnings": [],
        },
        "errors": [],
      }), encoding="utf-8")
      app = DevApp(
        data_source="empty",
        use_demo_fallback=False,
        daily_analysis_result_file=str(path),
      )

      payload = app.daily_analysis_payload(
        active_date="2026-06-15",
        operator_id="op_demo",
      )
    encoded = json.dumps(payload, ensure_ascii=False)

    self.assertEqual(payload["analysis_date"], "2026-06-15")
    self.assertEqual(payload["scope"]["operator_id"], "op_demo")
    self.assertIn("volatility_metrics", payload)
    self.assertIn("evidence_bundle", payload)
    self.assertIn("model_analysis", payload)
    self.assertIn("offline_daily_analysis_result", encoded)
    self.assertNotIn("demo_official_result_rows", encoded)
    self.assertNotIn('"contribution"', encoded)
    self.assertIn('"confidence"', encoded)

  def test_http_handler_and_payloads_are_available_without_binding_socket(self):
    app = DevApp()
    handler_class = make_handler(app)
    payload = app.dashboard_payload()

    self.assertTrue(hasattr(handler_class, "do_GET"))
    self.assertIn("Realtime recruiting activity", INDEX_HTML)
    self.assertIn("dashboard", payload)
    self.assertIn("source", payload)
    self.assertIn("log_quality_source", payload)
    self.assertIn("daily_basic_summary_source", payload)
    self.assertGreaterEqual(payload["dashboard"]["active_count"], 1)

  def test_operator_path_segment_decodes_unicode_operator_id(self):
    self.assertEqual(_decode_path_segment("%E5%B0%8F%E5%9B%BE%E5%9B%BE"), "小图图")

  def test_index_is_dashboard_not_landing_page(self):
    self.assertIn("Active operators", INDEX_HTML)
    self.assertIn("Operator detail", INDEX_HTML)

  def test_legacy_ui_does_not_display_wechat_count(self):
    self.assertNotIn("Wechat", INDEX_HTML)
    self.assertNotIn("f-wechat", INDEX_HTML)
    self.assertNotIn("Wechat captured", APP_JS)
    self.assertNotIn("f-wechat", APP_JS)

  def test_react_ui_does_not_display_wechat_count(self):
    app_source = Path(__file__).resolve().parents[1] / "frontend" / "src" / "App.tsx"
    source = app_source.read_text(encoding="utf-8")

    self.assertNotIn('"微信获取"', source)
    self.assertNotIn('label: "微信"', source)
    self.assertNotIn('FunnelCell label="微信"', source)
    self.assertNotIn("<th>微信</th>", source)

  def test_react_ui_hides_daily_analysis_from_main_nav_but_keeps_private_route(self):
    app_source = Path(__file__).resolve().parents[1] / "frontend" / "src" / "App.tsx"
    source = app_source.read_text(encoding="utf-8")

    self.assertIn('DAILY_ANALYSIS_PATH = "/daily-analysis"', source)
    self.assertIn("isDailyAnalysisRoute", source)
    self.assertIn(".endsWith(DAILY_ANALYSIS_PATH)", source)
    self.assertIn("DailyAnalysisTab", source)
    self.assertIn("日常分析", source)
    self.assertNotIn('onClick={() => setActiveTab("dailyAnalysis")}', source)
    self.assertNotIn('activeTab === "dailyAnalysis" ? "active" : ""', source)

  def test_react_daily_analysis_uses_coaching_board_structure(self):
    app_source = Path(__file__).resolve().parents[1] / "frontend" / "src" / "App.tsx"
    source = app_source.read_text(encoding="utf-8")

    self.assertIn("DailyOverviewStrip", source)
    self.assertIn("DailyCollectionAlert", source)
    self.assertIn("DailyCoachingSummary", source)
    self.assertIn("DailyReviewOperatorList", source)
    self.assertIn("DailyPersonalDetailDrawer", source)
    self.assertIn("DailyPersonalDetailPanel", source)
    self.assertIn("dailyAnalysisReviewShell", source)
    self.assertIn("dailyPersonalDrawer", source)
    self.assertIn("整体概览", source)
    self.assertIn("采集状态", source)
    self.assertIn("今日团队判断", source)
    self.assertIn("今日复盘对象", source)
    self.assertIn("详情抽屉", source)
    self.assertIn("关闭详情", source)
    self.assertIn("个人详情分析", source)
    self.assertIn("核心数据", source)
    self.assertIn("波动归因", source)
    self.assertIn("问题排查", source)
    self.assertIn("辅导建议", source)
    self.assertIn("数据波动", source)
    self.assertIn("优化建议", source)
    self.assertIn("严重程度", source)
    self.assertNotIn("DailyProofSections", source)
    self.assertNotIn("DailyVolatilityPanel", source)
    self.assertNotIn("DailyModelPanel", source)
    self.assertNotIn("DailyEvidencePanel", source)
    self.assertNotIn("<h2>数据证明</h2>", source)
    self.assertNotIn("<h2>漏斗证明</h2>", source)
    self.assertNotIn("<h2>辅导分析</h2>", source)
    self.assertNotIn("<h2>证据包</h2>", source)
    self.assertNotIn("DailyCoachingFocusList", source)
    self.assertNotIn("DailyTacticalActions", source)
    self.assertNotIn("<h2>今日辅导重点</h2>", source)
    self.assertNotIn("<h2>今日战术建议</h2>", source)
    self.assertNotIn("<h2>建议复盘对象</h2>", source)
    self.assertNotIn("<h2>模型归因分析</h2>", source)
    self.assertNotIn("<h2>波动概览</h2>", source)

  def test_daily_personal_drawer_advice_rows_are_horizontal(self):
    styles_path = Path(__file__).resolve().parents[1] / "frontend" / "src" / "styles.css"
    styles = styles_path.read_text(encoding="utf-8")

    self.assertRegex(
      styles,
      r"\.dailyPersonalDrawer\s+\.dailyPersonalAdviceRows\s*\{[^}]*grid-template-columns:\s*1fr;"
    )
    self.assertRegex(
      styles,
      r"\.dailyPersonalAdviceRows\s+article\s*\{[^}]*grid-template-columns:\s*28px\s+minmax\(0,\s*1fr\);"
    )

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

  def test_operator_admin_login_requires_env_password(self):
    with tempfile.TemporaryDirectory() as tmpdir:
      path = Path(tmpdir) / "operators.json"
      with patch.dict(os.environ, {
        "BOSS_ANALYSIS_OPERATOR_ADMIN_PASSWORD": "local-pass",
      }, clear=False):
        app = DevApp(
          data_source="empty",
          use_demo_fallback=False,
          operator_config_file=str(path),
        )

        failed = app.operator_admin_login("wrong")
        succeeded = app.operator_admin_login("local-pass")

    self.assertFalse(failed["authenticated"])
    self.assertNotIn("token", failed)
    self.assertTrue(succeeded["authenticated"])
    self.assertTrue(succeeded["token"])

  def test_operator_admin_crud_requires_valid_token_and_writes_config(self):
    with tempfile.TemporaryDirectory() as tmpdir:
      path = Path(tmpdir) / "operators.json"
      with patch.dict(os.environ, {
        "BOSS_ANALYSIS_OPERATOR_ADMIN_PASSWORD": "local-pass",
      }, clear=False):
        app = DevApp(
          data_source="empty",
          use_demo_fallback=False,
          operator_config_file=str(path),
        )
        token = app.operator_admin_login("local-pass")["token"]

        with self.assertRaisesRegex(PermissionError, "valid admin token"):
          app.operator_admin_upsert({"operatorId": "op_denied"}, token="bad-token")

        created = app.operator_admin_upsert({
          "operatorId": "op_001",
          "displayName": "Operator One",
          "accountName": "谢女士",
          "enabled": True,
        }, token=token)
        updated = app.operator_admin_upsert({
          "operatorId": "op_001",
          "displayName": "Operator One+",
          "accountName": "谢女士",
          "enabled": False,
          "role": "招聘操作员",
        }, token=token)
        listed = app.operator_admin_payload(token=token)
        deleted = app.operator_admin_delete("op_001", token=token)
        raw_after_delete = json.loads(path.read_text(encoding="utf-8"))

    self.assertEqual(created["operator"]["display_name"], "Operator One")
    self.assertEqual(updated["operator"]["display_name"], "Operator One+")
    self.assertFalse(updated["operator"]["enabled"])
    self.assertEqual(listed["operators"][0]["operator_id"], "op_001")
    self.assertTrue(deleted["deleted"])
    self.assertEqual(raw_after_delete["operators"], [])

  def test_operator_admin_encrypts_sensitive_fields_when_enabled(self):
    with tempfile.TemporaryDirectory() as tmpdir:
      path = Path(tmpdir) / "operators.json"
      with patch.dict(os.environ, {
        "BOSS_ANALYSIS_OPERATOR_ADMIN_PASSWORD": "local-pass",
        "BOSS_ANALYSIS_OPERATOR_CONFIG_SECRET": "local-encryption-secret",
      }, clear=False):
        app = DevApp(
          data_source="empty",
          use_demo_fallback=False,
          operator_config_file=str(path),
        )
        token = app.operator_admin_login("local-pass")["token"]

        saved = app.operator_admin_upsert({
          "operatorId": "op_001",
          "displayName": "Operator One",
          "accountName": "谢女士",
          "note": "本地备注",
        }, token=token, encrypt_sensitive=True)
        raw = json.loads(path.read_text(encoding="utf-8"))
        listed = app.operator_admin_payload(token=token)

    self.assertTrue(saved["encryption_enabled"])
    self.assertEqual(listed["operators"][0]["account_name"], "谢女士")
    self.assertEqual(listed["operators"][0]["note"], "本地备注")
    self.assertTrue(raw["operators"][0]["accountName"].startswith("enc:v1:"))
    self.assertTrue(raw["operators"][0]["note"].startswith("enc:v1:"))

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

  def test_dev_app_realtime_refresh_skips_daily_basic_topic_records(self):
    env = {
      "CLS_DAILY_BASIC_SUMMARY_TOPIC_ID": "topic-daily-basic",
      "TENCENTCLOUD_SECRET_ID": "secret-id",
      "TENCENTCLOUD_SECRET_KEY": "secret-key",
    }
    with patch.dict(os.environ, env, clear=True):
      with patch("boss_analysis.dev_data.iter_daily_basic_summaries_from_metric_topic") as reader:
        app = DevApp(
          data_source="summary",
          use_demo_fallback=False,
          require_real_data=True,
        )

    reader.assert_not_called()
    self.assertEqual(app.source.kind, "summary")
    self.assertEqual(app.daily_basic_summary_source.kind, "daily_basic_summary_topic")
    self.assertEqual(app._daily_basic_summaries, ())

  def test_dev_app_history_payload_reads_unloaded_daily_basic_topic_on_demand(self):
    env = {
      "CLS_DAILY_BASIC_SUMMARY_TOPIC_ID": "topic-daily-basic",
      "TENCENTCLOUD_SECRET_ID": "secret-id",
      "TENCENTCLOUD_SECRET_KEY": "secret-key",
    }
    refreshed_records = (
      DailyBasicStatsRecord(
        metric_name="boss_daily_operator_basic_stats",
        active_date=datetime(2026, 5, 23, tzinfo=timezone.utc).date(),
        operator_id="op_real",
        active_minutes=60,
      ),
    )
    with patch.dict(os.environ, env, clear=True):
      app = DevApp(
        data_source="summary",
        use_demo_fallback=False,
        require_real_data=True,
      )
      with patch(
        "boss_analysis.dev_server.iter_daily_basic_summaries_from_metric_topic",
        return_value=refreshed_records,
      ) as reader:
        payload = app.history_payload(
          operator_id="op_real",
          active_date="2026-05-23",
        )

    reader.assert_called_once_with(
      active_date="2026-05-23",
      operator_id="op_real",
      lookback_days=None,
    )
    self.assertEqual(payload["daily_basic_summary_source"]["record_count"], 1)
    self.assertEqual(payload["history"]["records"][0]["active_minutes"], 60)

  def test_dev_app_history_payload_filters_daily_basic_records(self):
    app = DevApp(data_source="empty", use_demo_fallback=False)
    app._daily_basic_summaries = (
      DailyBasicStatsRecord(
        metric_name="boss_daily_operator_basic_stats",
        active_date=datetime(2026, 5, 23, tzinfo=timezone.utc).date(),
        operator_id="op_real",
        active_minutes=50,
        card_exposed=120,
        total_events=180,
      ),
      DailyBasicStatsRecord(
        metric_name="boss_daily_operator_basic_stats",
        active_date=datetime(2026, 5, 22, tzinfo=timezone.utc).date(),
        operator_id="op_real",
        active_minutes=10,
      ),
    )
    app.query_service = app._build_query_service()

    payload = app.history_payload(
      operator_id="op_real",
      active_date="2026-05-23",
    )

    self.assertEqual(payload["history"]["status"], "ok")
    self.assertEqual(payload["history"]["record_count"], 1)
    self.assertEqual(payload["history"]["records"][0]["active_minutes"], 50)

  def test_dev_app_history_payload_includes_chat_reply_defaults(self):
    app = DevApp(data_source="empty", use_demo_fallback=False)
    app._daily_basic_summaries = (
      DailyBasicStatsRecord(
        metric_name="boss_daily_operator_basic_stats",
        active_date=datetime(2026, 5, 23, tzinfo=timezone.utc).date(),
        operator_id="op_real",
        active_minutes=50,
      ),
    )
    app.query_service = app._build_query_service()

    payload = app.history_payload(
      operator_id="op_real",
      active_date="2026-05-23",
    )

    record = payload["history"]["records"][0]
    self.assertEqual(record["first_round_candidate_initiated_count"], 0)
    self.assertEqual(record["first_round_boss_replied_count"], 0)
    self.assertEqual(record["chat_conversation_count"], 0)
    self.assertEqual(record["boss_ended_conversation_count"], 0)
    self.assertEqual(record["boss_reply_count"], 0)

  def test_dev_app_history_payload_refreshes_daily_basic_log_topic_for_filters(self):
    app = DevApp(data_source="empty", use_demo_fallback=False)
    app.daily_basic_summary_source = DevDataSourceInfo(
      kind="daily_basic_summary_topic",
      label="CLS 日级基础日志",
      detail="topic=topic-daily-basic",
      record_count=0,
      loaded_at=datetime(2026, 5, 25, tzinfo=timezone.utc),
    )
    app.query_service = app._build_query_service()
    refreshed_records = (
      DailyBasicStatsRecord(
        metric_name="boss_daily_operator_basic_stats",
        active_date=datetime(2026, 5, 23, tzinfo=timezone.utc).date(),
        operator_id="op_real",
        active_minutes=60,
      ),
    )

    with patch(
      "boss_analysis.dev_server.iter_daily_basic_summaries_from_metric_topic",
      return_value=refreshed_records,
    ) as reader:
      payload = app.history_payload(
        operator_id="op_real",
        active_date="2026-05-23",
      )

    reader.assert_called_once_with(
      active_date="2026-05-23",
      operator_id="op_real",
      lookback_days=None,
    )
    self.assertEqual(payload["daily_basic_summary_source"]["record_count"], 1)
    self.assertEqual(payload["history"]["records"][0]["active_minutes"], 60)


if __name__ == "__main__":
  unittest.main()
