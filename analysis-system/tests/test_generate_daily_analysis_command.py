from __future__ import annotations

import json
import os
import tempfile
import unittest
from datetime import date, datetime, timedelta, timezone
from io import StringIO
from pathlib import Path
from unittest.mock import patch

from boss_analysis.domain.daily_analysis import load_daily_analysis_result
from boss_analysis.domain.operators import OperatorProfile
from boss_analysis.domain.summary import DailyBasicStatsRecord
from boss_analysis.official_results.models import OfficialResultsBatch
from boss_analysis.official_results.sync import map_job_row, map_operator_row
from boss_analysis.ops import generate_daily_analysis


class FakeOfficialResultsSource:
  def __init__(self, batch: OfficialResultsBatch) -> None:
    self.batch = batch
    self.calls: list[date] = []

  def fetch(self, target_date: date) -> OfficialResultsBatch:
    self.calls.append(target_date)
    return self.batch


def _daily_basic_record(
  *,
  active_date: date,
  operator_id: str,
  total_events: int,
) -> DailyBasicStatsRecord:
  return DailyBasicStatsRecord(
    metric_name="boss_daily_operator_basic_stats",
    active_date=active_date,
    operator_id=operator_id,
    operator_account_name="林泽",
    boss_account_name="林泽",
    card_exposed=12,
    total_events=total_events,
    source_row_count=1,
  )


class GenerateDailyAnalysisTests(unittest.TestCase):
  def test_run_generation_writes_api_readable_daily_result(self):
    target_date = date(2026, 6, 16)
    source = FakeOfficialResultsSource(OfficialResultsBatch(
      target_date=target_date,
      operator_rows=(
        map_operator_row({
          "bossName": "林泽",
          "phoneDesc": "13800000000",
          "detailGeek": 120,
          "activeAdd": 31,
          "communication": 18,
          "resumeAccept": 4,
          "contactAccept": 2,
          "interviewAccept": 1,
        }, target_date),
      ),
      job_rows=(
        map_job_row({
          "jobDesc": "销售顾问",
          "bossName": "林泽",
          "phoneDesc": "13800000000",
          "detailGeek": 70,
          "activeAdd": 20,
          "communication": 11,
          "resumeAccept": 3,
        }, target_date),
      ),
    ))
    generated_at = datetime(2026, 6, 17, 2, 30, tzinfo=timezone.utc)
    with tempfile.TemporaryDirectory() as tmpdir:
      result = generate_daily_analysis.run_daily_analysis_generation(
        target_date=target_date,
        source=source,
        output_dir=tmpdir,
        generated_at=generated_at,
        operator_profiles=(OperatorProfile("op_linzhe", "林泽", "林泽"),),
      )

      payload = load_daily_analysis_result(
        analysis_date=target_date,
        results_dir=tmpdir,
      )

    self.assertEqual(source.calls, [target_date])
    self.assertEqual(result.output_path.name, "2026-06-16.json")
    self.assertEqual(result.operator_row_count, 1)
    self.assertEqual(result.job_row_count, 1)
    self.assertEqual(payload["status"], "analyzing")
    self.assertEqual(payload["analysis_date"], "2026-06-16")
    self.assertEqual(payload["scope"]["display_name"], "全部操作员")
    self.assertEqual(payload["sync_state"]["analysis_source"], "offline_daily_analysis_generation")
    self.assertEqual(payload["sync_state"]["official_result_source"], "official_results_source")
    self.assertEqual(payload["sync_state"]["model_state"], "model_output_required")
    self.assertEqual(payload["sync_state"]["llm_strategy"], "daily_analysis_coaching_v1")
    self.assertEqual(payload["model_analysis"]["analyzer"], "pending_llm_analysis")
    self.assertEqual(payload["model_analysis"]["attributions"], [])
    self.assertEqual(payload["model_analysis"]["action_items"], [])
    self.assertEqual(
      payload["model_input_packet"]["strategy"]["document"],
      "docs/modules/09-daily-analysis-llm-strategy.md",
    )
    self.assertEqual(
      payload["model_input_packet"]["facts"]["official_operator_results"][0]["values"]["boss_name"],
      "林泽",
    )
    operation_details = payload["model_input_packet"]["facts"]["operation_details"]
    self.assertEqual(operation_details["source_state"], "not_loaded")
    self.assertEqual(operation_details["detail_open_events"], [])
    self.assertEqual(operation_details["greeting_events"], [])
    self.assertEqual(operation_details["chat_progress_events"], [])
    self.assertEqual(operation_details["job_operation_events"], [])
    self.assertEqual(operation_details["timeline_windows"], [])
    self.assertIn("model_analysis", payload["data_quality"]["missing_fields"])
    self.assertIn("historical_effects_14d", payload["data_quality"]["missing_fields"])
    self.assertIn("operation_overview_14d", payload["data_quality"]["missing_fields"])
    self.assertIn("operation_details", payload["data_quality"]["missing_fields"])
    output_schema = payload["model_input_packet"]["output_schema"]
    self.assertIn("action_items", output_schema)
    self.assertNotIn("attributions", output_schema)
    action_schema = output_schema["action_items"][0]
    self.assertEqual(action_schema["action"], "string")
    self.assertEqual(action_schema["execution_steps"], ["string"])
    self.assertEqual(action_schema["due_window"], "string")
    self.assertEqual(action_schema["success_check"], "string")
    self.assertEqual(action_schema["evidence_refs"], ["evidence_id"])
    self.assertNotIn("cause", action_schema)
    self.assertNotIn("recommended_actions", action_schema)
    self.assertEqual(payload["evidence_bundle"]["operator_results"][0]["values"]["boss_name"], "林泽")
    payload_text = json.dumps(payload, ensure_ascii=False)
    self.assertNotIn("13800000000", payload_text)
    self.assertNotIn("offline_daily_analysis_rules_v1", payload_text)
    self.assertNotIn("查看到发起聊天存在机会缺口", payload_text)

  def test_generation_includes_historical_effects_operation_overview_and_details(self):
    target_date = date(2026, 6, 16)
    source = FakeOfficialResultsSource(OfficialResultsBatch(
      target_date=target_date,
      operator_rows=(
        map_operator_row({
          "bossName": "林泽",
          "detailGeek": 120,
          "activeAdd": 31,
          "communication": 18,
        }, target_date),
      ),
      job_rows=(
        map_job_row({
          "jobDesc": "销售顾问",
          "bossName": "林泽",
          "detailGeek": 70,
          "activeAdd": 20,
          "communication": 11,
        }, target_date),
      ),
    ))
    historical_effect_records = tuple(
      _daily_basic_record(
        active_date=target_date - timedelta(days=days_ago),
        operator_id="op_linzhe",
        total_events=days_ago,
      )
      for days_ago in range(1, 15)
    )
    operation_overview_rows = (
      {
        "active_date": (target_date - timedelta(days=1)).isoformat(),
        "operator_id": "op_linzhe",
        "source_event_count": 4,
      },
      {
        "active_date": (target_date - timedelta(days=2)).isoformat(),
        "operator_id": "op_linzhe",
        "source_event_count": 2,
      },
      {
        "active_date": (target_date - timedelta(days=3)).isoformat(),
        "operator_id": "op_linzhe",
        "source_event_count": 2,
      },
      {
        "active_date": (target_date - timedelta(days=4)).isoformat(),
        "operator_id": "op_linzhe",
        "source_event_count": 2,
      },
      {
        "active_date": (target_date - timedelta(days=5)).isoformat(),
        "operator_id": "op_linzhe",
        "source_event_count": 2,
      },
      {
        "active_date": (target_date - timedelta(days=6)).isoformat(),
        "operator_id": "op_linzhe",
        "source_event_count": 2,
      },
      {
        "active_date": (target_date - timedelta(days=7)).isoformat(),
        "operator_id": "op_linzhe",
        "source_event_count": 2,
      },
      {
        "active_date": (target_date - timedelta(days=8)).isoformat(),
        "operator_id": "op_linzhe",
        "source_event_count": 2,
      },
      {
        "active_date": (target_date - timedelta(days=9)).isoformat(),
        "operator_id": "op_linzhe",
        "source_event_count": 2,
      },
      {
        "active_date": (target_date - timedelta(days=10)).isoformat(),
        "operator_id": "op_linzhe",
        "source_event_count": 2,
      },
      {
        "active_date": (target_date - timedelta(days=11)).isoformat(),
        "operator_id": "op_linzhe",
        "source_event_count": 2,
      },
      {
        "active_date": (target_date - timedelta(days=12)).isoformat(),
        "operator_id": "op_linzhe",
        "source_event_count": 2,
      },
      {
        "active_date": (target_date - timedelta(days=13)).isoformat(),
        "operator_id": "op_linzhe",
        "source_event_count": 2,
      },
      {
        "active_date": (target_date - timedelta(days=14)).isoformat(),
        "operator_id": "op_linzhe",
        "source_event_count": 2,
      },
    )
    operation_details_value = {
      "detail_open_events": [
        {
          "occurred_at": "2026-06-16T10:00:00+08:00",
          "operator_id": "林泽",
          "source_event_id": "evt_1",
          "job_key": "sales",
          "candidate_local_id": "cand_1",
        },
      ],
      "greeting_events": [],
      "chat_progress_events": [],
      "job_operation_events": [],
      "timeline_windows": [],
    }
    with tempfile.TemporaryDirectory() as tmpdir:
      result = generate_daily_analysis.run_daily_analysis_generation(
        target_date=target_date,
        source=source,
        output_dir=tmpdir,
        operator_profiles=(OperatorProfile("op_linzhe", "林泽", "林泽"),),
        historical_effect_records=historical_effect_records,
        operation_overview_rows=operation_overview_rows,
        operation_details_value=operation_details_value,
      )

      payload = load_daily_analysis_result(
        analysis_date=target_date,
        results_dir=tmpdir,
      )

    historical_effects = payload["model_input_packet"]["facts"]["historical_effects_14d"]
    operation_overview = payload["model_input_packet"]["facts"]["operation_overview_14d"]
    operation_details = payload["model_input_packet"]["facts"]["operation_details"]
    missing_fields = payload["data_quality"]["missing_fields"]
    self.assertEqual(result.status, "analyzing")
    self.assertEqual(historical_effects["window"]["start_date"], "2026-06-02")
    self.assertEqual(historical_effects["window"]["end_date"], "2026-06-15")
    self.assertEqual(
      historical_effects["operator_rollups"][0]["operator_id"],
      "op_linzhe",
    )
    self.assertEqual(
      operation_overview["operator_rollups"][0]["totals"]["source_event_count"],
      30,
    )
    self.assertEqual(operation_details["source_state"], "loaded")
    self.assertEqual(operation_details["detail_open_events"][0]["source_event_id"], "evt_1")
    self.assertIn("model_analysis", missing_fields)
    self.assertNotIn("historical_effects_14d", missing_fields)
    self.assertNotIn("operation_overview_14d", missing_fields)
    self.assertNotIn("operation_details", missing_fields)

  def test_generation_filters_out_people_missing_from_operator_config(self):
    target_date = date(2026, 6, 16)
    source = FakeOfficialResultsSource(OfficialResultsBatch(
      target_date=target_date,
      operator_rows=(
        map_operator_row({
          "bossName": "林泽",
          "phoneDesc": "13800000000",
          "detailGeek": 120,
          "activeAdd": 31,
        }, target_date),
        map_operator_row({
          "bossName": "未配置人员",
          "phoneDesc": "13900000000",
          "detailGeek": 999,
          "activeAdd": 99,
        }, target_date),
      ),
      job_rows=(
        map_job_row({
          "jobDesc": "销售顾问",
          "bossName": "林泽",
          "phoneDesc": "13800000000",
          "detailGeek": 70,
          "activeAdd": 20,
        }, target_date),
        map_job_row({
          "jobDesc": "不应分析岗位",
          "bossName": "未配置人员",
          "phoneDesc": "13900000000",
          "detailGeek": 999,
          "activeAdd": 99,
        }, target_date),
      ),
    ))
    with tempfile.TemporaryDirectory() as tmpdir:
      result = generate_daily_analysis.run_daily_analysis_generation(
        target_date=target_date,
        source=source,
        output_dir=tmpdir,
        operator_profiles=(OperatorProfile("op_linzhe", "林泽", "林泽"),),
      )

      payload = load_daily_analysis_result(
        analysis_date=target_date,
        results_dir=tmpdir,
      )

    operators = payload["evidence_bundle"]["operator_results"]
    jobs = payload["evidence_bundle"]["job_results"]
    payload_text = json.dumps(payload, ensure_ascii=False)
    self.assertEqual(result.operator_row_count, 1)
    self.assertEqual(result.job_row_count, 1)
    self.assertEqual([item["operator_id"] for item in operators], ["op_linzhe"])
    self.assertEqual(operators[0]["values"]["display_name"], "林泽")
    self.assertEqual(jobs[0]["operator_id"], "op_linzhe")
    self.assertNotIn("未配置人员", payload_text)
    self.assertNotIn("不应分析岗位", payload_text)

  def test_generation_matches_official_name_from_operator_aliases(self):
    target_date = date(2026, 6, 16)
    source = FakeOfficialResultsSource(OfficialResultsBatch(
      target_date=target_date,
      operator_rows=(
        map_operator_row({
          "bossName": "吴佳豪",
          "detailGeek": 88,
          "activeAdd": 18,
        }, target_date),
      ),
      job_rows=(
        map_job_row({
          "jobDesc": "主播运营",
          "bossName": "吴佳豪",
          "detailGeek": 40,
          "activeAdd": 9,
        }, target_date),
      ),
    ))
    with tempfile.TemporaryDirectory() as tmpdir:
      result = generate_daily_analysis.run_daily_analysis_generation(
        target_date=target_date,
        source=source,
        output_dir=tmpdir,
        operator_profiles=(OperatorProfile(
          "wujiahao",
          "吴先生",
          aliases=("吴佳豪",),
        ),),
      )

      payload = load_daily_analysis_result(
        analysis_date=target_date,
        results_dir=tmpdir,
      )

    operators = payload["evidence_bundle"]["operator_results"]
    jobs = payload["evidence_bundle"]["job_results"]
    self.assertEqual(result.operator_row_count, 1)
    self.assertEqual(result.job_row_count, 1)
    self.assertEqual(operators[0]["operator_id"], "wujiahao")
    self.assertEqual(operators[0]["values"]["boss_name"], "吴佳豪")
    self.assertEqual(operators[0]["values"]["display_name"], "吴先生")
    self.assertEqual(jobs[0]["operator_id"], "wujiahao")

  def test_main_reads_source_file_and_writes_result_summary(self):
    with tempfile.TemporaryDirectory() as tmpdir:
      source_file = Path(tmpdir) / "official-results.json"
      operator_config = Path(tmpdir) / "operators.json"
      output_dir = Path(tmpdir) / "daily-analysis-results"
      daily_basic_source_file = Path(tmpdir) / "daily-basic.json"
      operation_overview_source_file = Path(tmpdir) / "operation-overview.json"
      operation_details_source_file = Path(tmpdir) / "operation-details.json"
      source_file.write_text(json.dumps({
        "operator_rows": [{
          "bossName": "林泽",
          "phoneDesc": "13800000000",
          "detailGeek": 120,
          "activeAdd": 31,
        }],
        "job_rows": [{
          "jobDesc": "销售顾问",
          "bossName": "林泽",
          "phoneDesc": "13800000000",
          "detailGeek": 70,
          "activeAdd": 20,
        }],
      }, ensure_ascii=False), encoding="utf-8")
      operator_config.write_text(json.dumps({
        "operators": [{
          "operatorId": "op_linzhe",
          "displayName": "林泽",
          "accountName": "林泽",
          "enabled": True,
        }],
      }, ensure_ascii=False), encoding="utf-8")
      daily_basic_source_file.write_text(json.dumps([
        {
          "metric_name": "boss_daily_operator_basic_stats",
          "active_date": "2026-06-02",
          "operator_id": "op_linzhe",
          "operator_account_name": "林泽",
          "card_exposed": 40,
          "detail_opened": 20,
          "greeting_succeeded": 10,
          "total_events": 70,
          "source_row_count": 1,
        },
      ], ensure_ascii=False), encoding="utf-8")
      operation_overview_source_file.write_text(json.dumps({
        "rows": [{
          "active_date": "2026-06-02",
          "operator_id": "op_linzhe",
          "detail_open_count": 20,
          "greeting_count": 10,
          "source_event_count": 30,
        }],
      }, ensure_ascii=False), encoding="utf-8")
      operation_details_source_file.write_text(json.dumps({
        "detail_open_events": [{
          "occurred_at": "2026-06-16T10:00:00+08:00",
          "operator_id": "op_linzhe",
          "candidate_local_id": "cand_1",
          "source_event_id": "evt_1",
        }],
      }, ensure_ascii=False), encoding="utf-8")

      stdout = StringIO()
      with patch.dict(os.environ, {}, clear=False), patch("sys.stdout", stdout):
        exit_code = generate_daily_analysis.main([
          "2026-06-16",
          "--source-file",
          str(source_file),
          "--output-dir",
          str(output_dir),
          "--operator-config-file",
          str(operator_config),
          "--daily-basic-source-file",
          str(daily_basic_source_file),
          "--operation-overview-source-file",
          str(operation_overview_source_file),
          "--operation-details-source-file",
          str(operation_details_source_file),
        ])

      summary = json.loads(stdout.getvalue())
      output_payload = load_daily_analysis_result(
        analysis_date=date(2026, 6, 16),
        results_dir=output_dir,
      )

    self.assertEqual(exit_code, 0)
    self.assertEqual(summary["target_date"], "2026-06-16")
    self.assertEqual(summary["status"], "analyzing")
    self.assertEqual(summary["operator_rows"], 1)
    self.assertEqual(summary["job_rows"], 1)
    self.assertEqual(Path(summary["output_path"]).name, "2026-06-16.json")
    facts = output_payload["model_input_packet"]["facts"]
    self.assertEqual(facts["historical_effects_14d"]["source_state"], "partial")
    self.assertEqual(facts["operation_overview_14d"]["source_state"], "partial")
    self.assertEqual(facts["operation_details"]["source_state"], "loaded")
    self.assertIn("model_analysis", output_payload["data_quality"]["missing_fields"])

  def test_main_accepts_empty_operation_overview_source_file_shapes(self):
    cases = (
      ("top_level_list", []),
      ("rows_object", {"rows": []}),
    )
    for label, overview_payload in cases:
      with self.subTest(shape=label):
        with tempfile.TemporaryDirectory() as tmpdir:
          source_file = Path(tmpdir) / "official-results.json"
          operator_config = Path(tmpdir) / "operators.json"
          output_dir = Path(tmpdir) / "daily-analysis-results"
          operation_overview_source_file = Path(tmpdir) / "operation-overview.json"
          source_file.write_text(json.dumps({
            "operator_rows": [{
              "bossName": "林泽",
              "detailGeek": 120,
              "activeAdd": 31,
            }],
            "job_rows": [],
          }, ensure_ascii=False), encoding="utf-8")
          operator_config.write_text(json.dumps({
            "operators": [{
              "operatorId": "op_linzhe",
              "displayName": "林泽",
              "accountName": "林泽",
              "enabled": True,
            }],
          }, ensure_ascii=False), encoding="utf-8")
          operation_overview_source_file.write_text(
            json.dumps(overview_payload, ensure_ascii=False),
            encoding="utf-8",
          )

          stdout = StringIO()
          with patch.dict(os.environ, {}, clear=False), patch("sys.stdout", stdout):
            exit_code = generate_daily_analysis.main([
              "2026-06-16",
              "--source-file",
              str(source_file),
              "--output-dir",
              str(output_dir),
              "--operator-config-file",
              str(operator_config),
              "--operation-overview-source-file",
              str(operation_overview_source_file),
            ])

          summary = json.loads(stdout.getvalue())
          output_payload = load_daily_analysis_result(
            analysis_date=date(2026, 6, 16),
            results_dir=output_dir,
          )

        self.assertEqual(exit_code, 0)
        self.assertEqual(summary["status"], "analyzing")
        self.assertEqual(
          output_payload["model_input_packet"]["facts"]["operation_overview_14d"]["source_state"],
          "not_loaded",
        )
        self.assertIn("operation_overview_14d", output_payload["data_quality"]["missing_fields"])

  def test_main_rejects_invalid_operation_overview_source_file_shape(self):
    with tempfile.TemporaryDirectory() as tmpdir:
      source_file = Path(tmpdir) / "official-results.json"
      operator_config = Path(tmpdir) / "operators.json"
      operation_overview_source_file = Path(tmpdir) / "operation-overview.json"
      source_file.write_text(json.dumps({
        "operator_rows": [{"bossName": "林泽"}],
        "job_rows": [],
      }, ensure_ascii=False), encoding="utf-8")
      operator_config.write_text(json.dumps({
        "operators": [{
          "operatorId": "op_linzhe",
          "displayName": "林泽",
          "accountName": "林泽",
          "enabled": True,
        }],
      }, ensure_ascii=False), encoding="utf-8")
      operation_overview_source_file.write_text(json.dumps({
        "unexpected": {"nested": True},
      }, ensure_ascii=False), encoding="utf-8")

      stdout = StringIO()
      stderr = StringIO()
      with patch.dict(os.environ, {}, clear=False), patch("sys.stdout", stdout), patch("sys.stderr", stderr):
        with self.assertRaises(SystemExit) as raised:
          generate_daily_analysis.main([
            "2026-06-16",
            "--source-file",
            str(source_file),
            "--operator-config-file",
            str(operator_config),
            "--operation-overview-source-file",
            str(operation_overview_source_file),
          ])

    self.assertEqual(raised.exception.code, 2)
    self.assertIn("--operation-overview-source-file", stderr.getvalue())

  def test_main_rejects_invalid_operation_details_source_file_shape(self):
    with tempfile.TemporaryDirectory() as tmpdir:
      source_file = Path(tmpdir) / "official-results.json"
      operator_config = Path(tmpdir) / "operators.json"
      operation_details_source_file = Path(tmpdir) / "operation-details.json"
      source_file.write_text(json.dumps({
        "operator_rows": [{"bossName": "林泽"}],
        "job_rows": [],
      }, ensure_ascii=False), encoding="utf-8")
      operator_config.write_text(json.dumps({
        "operators": [{
          "operatorId": "op_linzhe",
          "displayName": "林泽",
          "accountName": "林泽",
          "enabled": True,
        }],
      }, ensure_ascii=False), encoding="utf-8")
      operation_details_source_file.write_text(json.dumps([
        {"occurred_at": "2026-06-16T10:00:00+08:00"},
      ], ensure_ascii=False), encoding="utf-8")

      stdout = StringIO()
      stderr = StringIO()
      with patch.dict(os.environ, {}, clear=False), patch("sys.stdout", stdout), patch("sys.stderr", stderr):
        with self.assertRaises(SystemExit) as raised:
          generate_daily_analysis.main([
            "2026-06-16",
            "--source-file",
            str(source_file),
            "--operator-config-file",
            str(operator_config),
            "--operation-details-source-file",
            str(operation_details_source_file),
          ])

    self.assertEqual(raised.exception.code, 2)
    self.assertIn("--operation-details-source-file", stderr.getvalue())

  def test_shell_script_is_the_single_manual_entry(self):
    script = Path("generate-daily-analysis.sh")

    content = script.read_text(encoding="utf-8")

    self.assertIn("python3 -m boss_analysis.ops.generate_daily_analysis", content)
    self.assertNotIn("boss_analysis.dev_server", content)

  def test_llm_strategy_document_defines_model_owned_outputs(self):
    content = Path("docs/modules/09-daily-analysis-llm-strategy.md").read_text(encoding="utf-8")

    self.assertIn("daily_analysis_coaching_v1", content)
    self.assertIn("本地系统不得生成", content)
    self.assertIn("operation_details", content)
    self.assertIn("action_items", content)
    self.assertIn("execution_steps", content)
    self.assertIn("success_check", content)
    self.assertIn("rank", content)
    self.assertIn("confidence", content)
    self.assertIn("禁止为了凑齐 `historical_effects_14d`、`operation_overview_14d`、`operation_details` 而直接调用 CLS Search/SearchLog", content)


if __name__ == "__main__":
  unittest.main()
