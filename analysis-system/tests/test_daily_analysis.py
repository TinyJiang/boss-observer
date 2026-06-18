from __future__ import annotations

import json
import tempfile
import unittest
from datetime import date, datetime, timezone
from pathlib import Path

from boss_analysis.domain.daily_analysis import build_daily_analysis_payload
from boss_analysis.domain.daily_analysis import load_daily_analysis_result
from boss_analysis.domain.operators import OperatorProfile


class DailyAnalysisTests(unittest.TestCase):
  def test_load_daily_analysis_result_reads_offline_date_file(self):
    payload = {
      "status": "ready",
      "analysis_date": "2026-06-16",
      "scope": {"operator_id": None, "display_name": "全部操作员"},
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
        "generated_at": "2026-06-17T01:00:00+00:00",
        "analyzer": "offline_codex_analysis",
        "attributions": [],
        "questions_for_next_collection": [],
      },
      "data_quality": {
        "missing_fields": [],
        "unmatched_jobs": [],
        "low_sample_warnings": [],
      },
      "errors": [],
    }
    with self.subTest("offline result file"):
      with tempfile.TemporaryDirectory() as tmpdir:
        path = Path(tmpdir) / "2026-06-16.json"
        path.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")

        result = load_daily_analysis_result(
          analysis_date=date(2026, 6, 16),
          results_dir=tmpdir,
        )

    self.assertEqual(result["analysis_date"], "2026-06-16")
    self.assertEqual(result["sync_state"]["analysis_source"], "offline_daily_analysis_result")

  def test_payload_separates_local_volatility_from_model_attribution(self):
    payload = build_daily_analysis_payload(
      analysis_date=date(2026, 6, 15),
      operator_profiles=(OperatorProfile("op_001", "林泽", "林泽"),),
      operator_id="op_001",
      generated_at=datetime(2026, 6, 16, 2, 0, tzinfo=timezone.utc),
    )

    self.assertEqual(payload.status, "ready")
    metric = payload.volatility_metrics[0]
    self.assertEqual(metric.baseline_key, "vs_yesterday")
    self.assertIn("delta", metric.as_dict())
    self.assertNotIn("confidence", metric.as_dict())
    self.assertNotIn("contribution", metric.as_dict())
    self.assertIn("confidence", payload.model_analysis.attributions[0].as_dict())

  def test_evidence_bundle_has_stable_ids_and_data_quality_gaps(self):
    payload = build_daily_analysis_payload(
      analysis_date=date(2026, 6, 15),
      operator_profiles=(OperatorProfile("op_001", "林泽", "林泽"),),
      operator_id="op_001",
      generated_at=datetime(2026, 6, 16, 2, 0, tzinfo=timezone.utc),
    )

    evidence_ids = {item.evidence_id for item in payload.evidence_bundle.operator_results}
    evidence_ids.update(item.evidence_id for item in payload.evidence_bundle.job_results)
    self.assertIn("official:operator:2026-06-15:op_001", evidence_ids)
    self.assertIn("official:job:2026-06-15:op_001:frontend-engineer", evidence_ids)
    self.assertIn("job_refresh_events", payload.data_quality.missing_fields)
    self.assertGreaterEqual(len(payload.evidence_bundle.job_actions), 1)

  def test_operator_filter_returns_single_operator_scope(self):
    payload = build_daily_analysis_payload(
      analysis_date=date(2026, 6, 15),
      operator_profiles=(
        OperatorProfile("op_001", "林泽", "林泽"),
        OperatorProfile("op_002", "周新雨", "谢女士"),
      ),
      operator_id="op_002",
      generated_at=datetime(2026, 6, 16, 2, 0, tzinfo=timezone.utc),
    )

    self.assertEqual(payload.scope["operator_id"], "op_002")
    self.assertEqual(payload.scope["boss_name"], "谢女士")
    self.assertTrue(all(
      item.operator_id == "op_002"
      for item in payload.evidence_bundle.operator_results
    ))


if __name__ == "__main__":
  unittest.main()
