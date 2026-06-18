import json
import re
import unittest
from datetime import date, datetime, timezone
from pathlib import Path

from boss_analysis.ops.daily_history_tasks import (
  DAILY_HISTORY_TASK_SPECS,
  build_backfill_payloads,
  build_create_payload,
  build_permission_package,
  compare_daily_history_metric_values,
  merge_task_output_rows,
  metric_topic_process_window_warnings,
  plan_items_to_jsonable,
  plan_task_changes,
  preflight_daily_history,
  task_mismatch_reasons,
  verification_to_jsonable,
  verify_daily_history_output,
)


class FakeClsClient:
  def __init__(self, responses):
    self.responses = list(responses)
    self.calls = []

  def call(self, action, payload, *, version, region):
    self.calls.append({
      "action": action,
      "payload": payload,
      "version": version,
      "region": region,
    })
    if not self.responses:
      raise AssertionError(f"unexpected call: {action}")
    return self.responses.pop(0)


class DailyHistoryTaskTests(unittest.TestCase):
  def test_task_sql_matches_documented_sql(self):
    doc_path = Path(__file__).resolve().parents[1] / "docs/modules/07-cls-scheduled-sql-tasks.md"
    text = doc_path.read_text(encoding="utf-8")

    for spec in DAILY_HISTORY_TASK_SPECS:
      marker = f"## 任务 {6 if 'chat_reply' in spec.name else 7}：`{spec.name}`"
      section = text.split(marker, 1)[1]
      documented_sql = re.search(r"```sql\n(.*?)\n```", section, re.S).group(1)
      self.assertEqual(spec.sql, documented_sql)

  def test_build_create_payload_targets_metric_topic_with_expected_labels(self):
    spec = DAILY_HISTORY_TASK_SPECS[0]

    payload = build_create_payload(
      spec,
      src_topic_id="topic-raw",
      dst_topic_id="topic-daily-basic",
      region="ap-shanghai",
      process_start_time_ms=1780395600000,
    )

    self.assertEqual(payload["Name"], "boss_daily_operator_chat_reply_stats")
    self.assertEqual(payload["SrcTopicId"], "topic-raw")
    self.assertEqual(payload["SrcTopicRegion"], "ap-shanghai")
    self.assertEqual(payload["ProcessStartTime"], 1780395600000)
    self.assertEqual(payload["ProcessType"], 1)
    self.assertEqual(payload["ProcessPeriod"], 5)
    self.assertEqual(payload["ProcessTimeWindow"], "@d,@m-1m")
    self.assertEqual(payload["ProcessDelay"], 60)
    self.assertEqual(payload["SyntaxRule"], 0)
    self.assertEqual(payload["DstResource"], {
      "TopicId": "topic-daily-basic",
      "Region": "ap-shanghai",
      "BizType": 1,
      "MetricNames": list(spec.metric_names),
      "MetricLabels": ["metric_name", "active_date", "operator_id"],
    })

  def test_plan_task_changes_creates_missing_tasks(self):
    items = plan_task_changes(
      DAILY_HISTORY_TASK_SPECS,
      (),
      src_topic_id="topic-raw",
      dst_topic_id="topic-daily-basic",
      region="ap-shanghai",
      process_start_time_ms=1780395600000,
    )

    self.assertEqual([item.action for item in items], ["create", "create"])
    self.assertEqual(items[0].reason, "task not found")
    self.assertIn("ScheduledSqlContent", items[0].payload)
    self.assertEqual(len(items[0].warnings), 1)
    self.assertIn("metric topic", items[0].warnings[0])
    self.assertEqual(plan_items_to_jsonable(items)[0]["warnings"], list(items[0].warnings))

  def test_plan_task_changes_keeps_matching_tasks_unchanged(self):
    existing = []
    for index, spec in enumerate(DAILY_HISTORY_TASK_SPECS):
      payload = build_create_payload(
        spec,
        src_topic_id="topic-raw",
        dst_topic_id="topic-daily-basic",
        region="ap-shanghai",
        process_start_time_ms=1780395600000,
      )
      payload["TaskId"] = f"task-{index}"
      existing.append({
        "TaskId": payload["TaskId"],
        "Name": payload["Name"],
        "SrcTopicId": payload["SrcTopicId"],
        "SrcTopicRegion": payload["SrcTopicRegion"],
        "EnableFlag": payload["EnableFlag"],
        "DstResource": payload["DstResource"],
        "ScheduledSqlContent": payload["ScheduledSqlContent"],
        "ProcessPeriod": payload["ProcessPeriod"],
        "ProcessTimeWindow": payload["ProcessTimeWindow"],
        "ProcessDelay": payload["ProcessDelay"],
        "SyntaxRule": payload["SyntaxRule"],
      })

    items = plan_task_changes(
      DAILY_HISTORY_TASK_SPECS,
      existing,
      src_topic_id="topic-raw",
      dst_topic_id="topic-daily-basic",
      region="ap-shanghai",
      process_start_time_ms=1780395600000,
    )

    self.assertEqual([item.action for item in items], ["unchanged", "unchanged"])

  def test_plan_task_changes_modifies_mismatched_task(self):
    spec = DAILY_HISTORY_TASK_SPECS[1]
    existing = [{
      "TaskId": "task-wechat",
      "Name": spec.name,
      "SrcTopicId": "topic-raw",
      "SrcTopicRegion": "ap-shanghai",
      "EnableFlag": 1,
      "DstResource": {
        "TopicId": "topic-daily-basic",
        "Region": "ap-shanghai",
        "BizType": 1,
        "MetricNames": ["wechat_captured"],
        "MetricLabels": ["metric_name", "active_date", "operator_id"],
      },
      "ScheduledSqlContent": spec.sql,
      "ProcessPeriod": 5,
      "ProcessTimeWindow": "@d,@m-1m",
      "ProcessDelay": 60,
      "SyntaxRule": 0,
    }]

    reasons = task_mismatch_reasons(
      existing[0],
      spec,
      src_topic_id="topic-raw",
      dst_topic_id="topic-daily-basic",
      region="ap-shanghai",
    )
    items = plan_task_changes(
      (spec,),
      existing,
      src_topic_id="topic-raw",
      dst_topic_id="topic-daily-basic",
      region="ap-shanghai",
      process_start_time_ms=1780395600000,
    )

    self.assertEqual(reasons, ("DstResource.MetricNames",))
    self.assertEqual(items[0].action, "modify")
    self.assertEqual(items[0].payload["TaskId"], "task-wechat")
    self.assertEqual(items[0].payload["DstResource"]["MetricNames"], [
      "wechat_captured",
      "wechat_unique_candidates",
    ])

  def test_build_backfill_payloads_use_specified_time_range(self):
    items = build_backfill_payloads(
      DAILY_HISTORY_TASK_SPECS,
      active_date=date(2026, 6, 1),
      src_topic_id="topic-raw",
      dst_topic_id="topic-daily-basic",
      region="ap-shanghai",
      timezone_name="Asia/Shanghai",
    )

    self.assertEqual([item.action for item in items], ["create", "create"])
    self.assertEqual(items[0].name, "boss_daily_operator_chat_reply_stats_backfill_20260601")
    self.assertEqual(items[0].payload["ProcessType"], 2)
    self.assertEqual(items[0].payload["ProcessTimeWindow"], "@d-1d,@d")
    self.assertEqual(items[0].payload["ProcessStartTime"], 1780329900000)
    self.assertEqual(items[0].payload["ProcessEndTime"], 1780330500000)
    self.assertEqual(items[0].payload["Name"], items[0].name)
    self.assertEqual(len(items[0].warnings), 1)
    self.assertEqual(items[1].payload["Name"], "boss_daily_operator_wechat_marker_stats_backfill_20260601")

  def test_metric_topic_process_window_warnings_only_flag_day_scale_windows(self):
    self.assertTrue(metric_topic_process_window_warnings("@d,@m-1m"))
    self.assertTrue(metric_topic_process_window_warnings("@d-1d,@d"))
    self.assertEqual(metric_topic_process_window_warnings("@m-30m,@m"), ())

  def test_create_payload_json_has_no_secret_fields(self):
    payload = build_create_payload(
      DAILY_HISTORY_TASK_SPECS[1],
      src_topic_id="topic-raw",
      dst_topic_id="topic-daily-basic",
      region="ap-shanghai",
      process_start_time_ms=1780395600000,
    )

    rendered = json.dumps(payload, ensure_ascii=False)
    self.assertNotIn("SECRET", rendered.upper())
    self.assertNotIn("TOKEN", rendered.upper())

  def test_build_permission_package_lists_resources_actions_and_commands(self):
    payload = build_permission_package(
      region="ap-shanghai",
      src_topic_id="topic-raw",
      dst_topic_id="topic-daily-basic",
      process_time_window="@d-1d,@d",
      process_period_minutes=1440,
      backfill_active_date=date(2026, 6, 1),
    )

    self.assertEqual(payload["resources"]["source_raw_topic_id"], "topic-raw")
    self.assertEqual(payload["resources"]["destination_daily_basic_metric_topic_id"], "topic-daily-basic")
    self.assertIn("cls:CreateScheduledSql", payload["required_actions"]["deploy"])
    self.assertIn("cls:SearchLog", payload["required_actions"]["local_verification"])
    self.assertEqual(payload["cam_policy_template_wide_resource"]["statement"][0]["resource"], "*")
    self.assertIn("--process-period-minutes 1440", payload["commands"]["deploy_dry_run"])
    self.assertIn("--backfill-active-date 2026-06-01 --apply", payload["commands"]["backfill_apply_after_confirmation"])
    self.assertTrue(payload["warnings"])
    rendered = json.dumps(payload, ensure_ascii=False)
    self.assertNotIn("SECRET", rendered.upper())
    self.assertNotIn("TOKEN", rendered.upper())

  def test_preflight_reports_describe_permission_error_with_assumed_create_plan(self):
    client = FakeClsClient([
      {
        "Response": {
          "Error": {
            "Code": "AuthFailure.UnauthorizedOperation",
            "Message": "unauthorized",
          }
        }
      }
    ])

    report = preflight_daily_history(
      region="ap-shanghai",
      src_topic_id="topic-raw",
      dst_topic_id="topic-daily-basic",
      credentials=type("Creds", (), {
        "secret_id": "secret-id",
        "secret_key": "secret-key",
        "token": None,
      })(),
      process_start_time_ms=1780395600000,
      process_time_window="@d-1d,@d",
      process_period_minutes=1440,
      process_delay_seconds=60,
      client=client,
    )

    self.assertEqual(report["status"], "permission_missing")
    self.assertEqual(report["scheduled_sql_describe"]["status"], "error")
    self.assertEqual(report["scheduled_sql_describe"]["required_action"], "cls:DescribeScheduledSqlInfo")
    self.assertEqual(report["deployment_plan_assumption"], "existing task state unknown; create plan is shown for review")
    self.assertEqual([item["action"] for item in report["deployment_plan"]], ["create", "create"])
    self.assertIn("deploy_apply_after_confirmation", report["commands"])
    self.assertEqual(client.calls[0]["action"], "DescribeScheduledSqlInfo")

  def test_merge_task_output_rows_keeps_only_expected_metric_fields(self):
    rows = [
      {
        "operator_id": "zhouxinyu",
        "boss_reply_count": "17",
        "wechat_unique_candidates": "2",
        "ignored": "999",
      },
      {
        "operator_id": "zhouxinyu",
        "wechat_captured": 3,
      },
    ]

    merged = merge_task_output_rows(
      rows,
      fields=("boss_reply_count", "wechat_captured", "wechat_unique_candidates"),
    )

    self.assertEqual(merged, {
      "zhouxinyu": {
        "boss_reply_count": 17,
        "wechat_captured": 3,
        "wechat_unique_candidates": 2,
      }
    })

  def test_compare_daily_history_metric_values_reports_missing_and_mismatch(self):
    result = compare_daily_history_metric_values(
      {
        "zhouxinyu": {
          "boss_reply_count": 17,
          "wechat_unique_candidates": 2,
        }
      },
      {
        "zhouxinyu": {
          "boss_reply_count": 0,
        }
      },
    )

    self.assertEqual(result.status, "mismatch")
    self.assertEqual(list(result.comparisons), [
      {
        "operator_id": "zhouxinyu",
        "field": "boss_reply_count",
        "expected": 17,
        "observed": 0,
        "status": "mismatch",
      },
      {
        "operator_id": "zhouxinyu",
        "field": "wechat_unique_candidates",
        "expected": 2,
        "observed": None,
        "status": "missing",
      },
    ])

  def test_verify_daily_history_output_compares_raw_sql_and_metric_samples(self):
    raw_chat = {
      "operator_id": "zhouxinyu",
      "boss_reply_count": 17,
      "chat_conversation_count": 21,
    }
    raw_wechat = {
      "operator_id": "zhouxinyu",
      "wechat_captured": 3,
      "wechat_unique_candidates": 2,
    }
    metric_names = [
      name
      for spec in DAILY_HISTORY_TASK_SPECS
      for name in spec.metric_names
    ]
    metric_responses = []
    for name in metric_names:
      value = {
        "boss_reply_count": 17,
        "chat_conversation_count": 21,
        "wechat_captured": 3,
        "wechat_unique_candidates": 2,
      }.get(name)
      result = []
      if value is not None:
        result = [{
          "metric": {
            "__name__": name,
            "metric_name": "boss_daily_operator_basic_stats",
            "active_date": "2026-06-01",
            "operator_id": "zhouxinyu",
          },
          "values": [[1780243500, str(value)]],
        }]
      metric_responses.append({
        "Response": {
          "Result": json.dumps(result),
        }
      })
    client = FakeClsClient([
      {
        "Response": {
          "ListOver": True,
          "AnalysisRecords": [json.dumps(raw_chat)],
          "Results": [],
        }
      },
      {
        "Response": {
          "ListOver": True,
          "AnalysisRecords": [json.dumps(raw_wechat)],
          "Results": [],
        }
      },
      *metric_responses,
    ])

    result = verify_daily_history_output(
      active_date=date(2026, 6, 1),
      src_topic_id="topic-raw",
      dst_topic_id="topic-daily-basic",
      region="ap-shanghai",
      credentials=type("Creds", (), {
        "secret_id": "secret-id",
        "secret_key": "secret-key",
        "token": None,
      })(),
      client=client,
      now=datetime(2026, 6, 2, 12, 0, tzinfo=timezone.utc),
    )
    payload = verification_to_jsonable(result)

    self.assertEqual(payload["status"], "ok")
    self.assertEqual(payload["active_date"], "2026-06-01")
    self.assertEqual(payload["expected"]["zhouxinyu"]["boss_reply_count"], 17)
    self.assertEqual(payload["observed"]["zhouxinyu"]["wechat_unique_candidates"], 2)
    self.assertEqual(client.calls[0]["action"], "SearchLog")
    self.assertEqual(client.calls[2]["action"], "QueryRangeMetric")
    self.assertEqual(client.calls[2]["payload"]["Start"], 1780243200)
    self.assertEqual(client.calls[2]["payload"]["End"], 1780401600)


if __name__ == "__main__":
  unittest.main()
