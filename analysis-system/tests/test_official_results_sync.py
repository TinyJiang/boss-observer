from __future__ import annotations

import unittest
import json
import tempfile
from datetime import date, datetime
from io import StringIO
from pathlib import Path
from unittest.mock import patch

from boss_analysis.domain.operators import OperatorProfile
from boss_analysis.official_results.cdp_source import BossOfficialResultsCdpSource
from boss_analysis.official_results.source import (
  BOSS_DAILY_JOB_PATH,
  BOSS_DAILY_OPERATOR_PATH,
  BOSS_RECRUIT_DATA_REFERER,
  JsonOfficialResultsSource,
)
from boss_analysis.official_results.models import OfficialResultsBatch
from boss_analysis.ops import sync_official_results as sync_cli
from boss_analysis.official_results.sync import (
  BOSS_DAILY_JOB_TABLE_ID,
  BOSS_DAILY_OPERATOR_TABLE_ID,
  build_sync_plan,
  map_job_row,
  map_operator_row,
  resolve_sync_date,
  run_official_results_sync,
)


class FakeOfficialResultsSource:
  def __init__(self, batch: OfficialResultsBatch) -> None:
    self.batch = batch
    self.calls: list[date] = []

  def fetch(self, target_date: date) -> OfficialResultsBatch:
    self.calls.append(target_date)
    return self.batch


class FakeCdpPageClient:
  def __init__(self, payloads: dict[tuple[str, int], dict[str, object]]) -> None:
    self.payloads = payloads
    self.navigated_to: list[str] = []
    self.calls: list[tuple[str, dict[str, object]]] = []
    self.closed = False

  def navigate(self, url: str) -> None:
    self.navigated_to.append(url)

  def fetch_json(self, path: str, params: dict[str, object]) -> dict[str, object]:
    self.calls.append((path, dict(params)))
    return self.payloads[(path, int(params["page"]))]

  def close(self) -> None:
    self.closed = True


class FakeFeishuTable:
  def __init__(self, existing_records=None) -> None:
    self.existing_records = list(existing_records or [])
    self.list_calls: list[dict[str, object]] = []
    self.created: list[dict[str, object]] = []
    self.updated: list[tuple[str, dict[str, object]]] = []

  def list_records(self) -> list[dict[str, object]]:
    self.list_calls.append({})
    return list(self.existing_records)

  def create_record(self, fields: dict[str, object]) -> str:
    self.created.append(dict(fields))
    return f"created-{len(self.created)}"

  def update_record(self, record_id: str, fields: dict[str, object]) -> None:
    self.updated.append((record_id, dict(fields)))


class FakeFeishuClient:
  def __init__(self, operator_table: FakeFeishuTable, job_table: FakeFeishuTable) -> None:
    self.operator_table = operator_table
    self.job_table = job_table

  def table(self, table_id: str) -> FakeFeishuTable:
    if table_id == BOSS_DAILY_OPERATOR_TABLE_ID:
      return self.operator_table
    if table_id == BOSS_DAILY_JOB_TABLE_ID:
      return self.job_table
    raise AssertionError(f"unexpected table id: {table_id}")


class OfficialResultsSyncTests(unittest.TestCase):
  def test_resolve_sync_date_defaults_to_yesterday_with_injected_clock(self):
    result = resolve_sync_date(
      None,
      clock=lambda: datetime(2026, 6, 16, 10, 0, 0),
      timezone_name="Asia/Shanghai",
    )

    self.assertEqual(result, date(2026, 6, 15))

  def test_operator_row_maps_boss_fields_to_feishu_fields(self):
    mapped = map_operator_row({
      "bossName": "Boss A",
      "phoneDesc": "13800000000",
      "companyDesc": "Company A",
      "groupDesc": "Group A",
      "certJobDesc": "Recruiter",
      "companyEmail": "boss@example.com",
      "detailGeek": 11,
      "activeAdd": 2,
      "communication": 5,
      "detailBoss": 7,
      "passiveAdd": 3,
      "resumeAccept": 4,
      "contactAccept": 1,
      "interviewAccept": 6,
    }, date(2026, 6, 15))

    self.assertEqual(mapped.fields["统计日期"], "2026-06-15")
    self.assertEqual(mapped.fields["BOSS姓名"], "Boss A")
    self.assertEqual(mapped.fields["BOSS查看牛人"], 11)
    self.assertEqual(mapped.fields["BOSS发起聊天"], 2)
    self.assertEqual(mapped.fields["牛人发起聊天"], 3)
    self.assertEqual(mapped.fields["交换电话微信"], 1)
    self.assertEqual(mapped.business_key, "2026-06-15|Boss A|13800000000")

  def test_job_row_preserves_extra_source_fields_without_writing_unknown_feishu_fields(self):
    mapped = map_job_row({
      "jobDesc": "Backend Engineer",
      "bossName": "Boss A",
      "phoneDesc": "13800000000",
      "companyDesc": "Company A",
      "groupDesc": "Group A",
      "certJobDesc": "Recruiter",
      "companyEmail": "boss@example.com",
      "detailGeek": "9",
      "activeAdd": "2",
      "communication": "5",
      "detailBoss": "7",
      "passiveAdd": "3",
      "resumeAccept": "4",
      "contactAccept": "1",
      "interviewAccept": "6",
      "jobStatus": "online",
    }, date(2026, 6, 15))

    self.assertEqual(mapped.fields["职位名称"], "Backend Engineer")
    self.assertEqual(mapped.fields["职位发布人"], "Boss A")
    self.assertEqual(mapped.fields["发布人手机号"], "13800000000")
    self.assertEqual(mapped.fields["BOSS沟通"], 5)
    self.assertNotIn("jobStatus", mapped.fields)
    self.assertEqual(mapped.extra_source_fields["jobStatus"], "online")
    self.assertEqual(mapped.business_key, "2026-06-15|Backend Engineer|Boss A|13800000000")

  def test_build_sync_plan_updates_existing_business_key_and_creates_missing(self):
    batch = OfficialResultsBatch(
      target_date=date(2026, 6, 15),
      operator_rows=(
        map_operator_row({"bossName": "Boss A", "phoneDesc": "13800000000"}, date(2026, 6, 15)),
        map_operator_row({"bossName": "Boss B", "phoneDesc": "13900000000"}, date(2026, 6, 15)),
      ),
      job_rows=(
        map_job_row({"jobDesc": "Backend Engineer", "bossName": "Boss A", "phoneDesc": "13800000000"}, date(2026, 6, 15)),
      ),
    )
    operator_existing = [{
      "record_id": "rec-operator-a",
      "fields": {"统计日期": "2026-06-15", "BOSS姓名": "Boss A", "手机号码": "13800000000"},
    }]
    job_existing = []

    plan = build_sync_plan(
      batch,
      operator_existing_records=operator_existing,
      job_existing_records=job_existing,
      operator_profiles=(OperatorProfile("op_a", "Boss A", "Boss A"),),
    )

    self.assertEqual([item.action for item in plan.operator_items], ["update", "create"])
    self.assertEqual(plan.operator_items[0].record_id, "rec-operator-a")
    self.assertEqual(plan.operator_items[1].record_id, None)
    self.assertEqual([item.action for item in plan.job_items], ["create"])
    self.assertEqual(plan.summary.create_count, 2)
    self.assertEqual(plan.summary.update_count, 1)
    self.assertEqual(plan.summary.unmatched_operator_names, ("Boss B",))

  def test_run_official_results_sync_dry_run_does_not_write_records(self):
    target_date = date(2026, 6, 15)
    batch = OfficialResultsBatch(
      target_date=target_date,
      operator_rows=(map_operator_row({"bossName": "Boss A", "phoneDesc": "13800000000"}, target_date),),
      job_rows=(map_job_row({"jobDesc": "Backend Engineer", "bossName": "Boss A", "phoneDesc": "13800000000"}, target_date),),
    )
    source = FakeOfficialResultsSource(batch)
    operator_table = FakeFeishuTable()
    job_table = FakeFeishuTable()
    client = FakeFeishuClient(operator_table, job_table)

    result = run_official_results_sync(
      target_date=target_date,
      source=source,
      feishu_client=client,
      operator_profiles=(OperatorProfile("op_a", "Boss A", "Boss A"),),
      dry_run=True,
    )

    self.assertEqual(source.calls, [target_date])
    self.assertEqual(result.plan.summary.create_count, 2)
    self.assertEqual(operator_table.created, [])
    self.assertEqual(operator_table.updated, [])
    self.assertEqual(job_table.created, [])
    self.assertEqual(job_table.updated, [])

  def test_map_row_reports_missing_required_fields(self):
    mapped = map_operator_row({"phoneDesc": "13800000000"}, date(2026, 6, 15))

    self.assertIn("bossName", mapped.missing_source_fields)
    self.assertEqual(mapped.fields["BOSS姓名"], "")
    self.assertEqual(mapped.business_key, "2026-06-15||13800000000")

  def test_json_source_reads_raw_rows_and_maps_target_date(self):
    with tempfile.TemporaryDirectory() as tmpdir:
      path = Path(tmpdir) / "official-results.json"
      path.write_text(json.dumps({
        "operator_rows": [{"bossName": "Boss A", "phoneDesc": "13800000000"}],
        "job_rows": [{"jobDesc": "Backend Engineer", "bossName": "Boss A", "phoneDesc": "13800000000"}],
      }), encoding="utf-8")

      batch = JsonOfficialResultsSource.from_path(path).fetch(date(2026, 6, 15))

    self.assertEqual(batch.operator_rows[0].fields["统计日期"], "2026-06-15")
    self.assertEqual(batch.operator_rows[0].fields["BOSS姓名"], "Boss A")
    self.assertEqual(batch.job_rows[0].fields["职位名称"], "Backend Engineer")

  def test_cdp_source_fetches_pages_and_maps_rows(self):
    fake_client = FakeCdpPageClient({
      (BOSS_DAILY_OPERATOR_PATH, 1): {
        "code": 0,
        "zpData": {
          "isReady": 1,
          "deadline": "2026-06-16 03:00:00",
          "totalSize": 2,
          "dataList": [{"bossName": "Boss A", "phoneDesc": "13800000000"}],
        },
      },
      (BOSS_DAILY_OPERATOR_PATH, 2): {
        "code": 0,
        "zpData": {
          "isReady": 1,
          "deadline": "2026-06-16 03:00:00",
          "totalSize": 2,
          "dataList": [{"bossName": "Boss B", "phoneDesc": "13900000000"}],
        },
      },
      (BOSS_DAILY_JOB_PATH, 1): {
        "code": 0,
        "zpData": {
          "isReady": 1,
          "totalSize": 1,
          "dataList": [{"jobDesc": "Backend Engineer", "bossName": "Boss A", "phoneDesc": "13800000000"}],
        },
      },
    })

    source = BossOfficialResultsCdpSource(page_size=1, page_client=fake_client)
    batch = source.fetch(date(2026, 6, 15))

    self.assertEqual(fake_client.navigated_to, [BOSS_RECRUIT_DATA_REFERER])
    self.assertEqual([row.fields["BOSS姓名"] for row in batch.operator_rows], ["Boss A", "Boss B"])
    self.assertEqual(batch.job_rows[0].fields["职位名称"], "Backend Engineer")
    self.assertEqual(batch.source_deadline, "2026-06-16 03:00:00")
    self.assertEqual(batch.source_warnings, ())
    self.assertEqual(fake_client.calls[0][1], {"dateStr": "2026-06-15", "page": 1, "pageSize": 1})
    self.assertFalse(fake_client.closed)

  def test_cdp_source_reports_not_ready_warning(self):
    fake_client = FakeCdpPageClient({
      (BOSS_DAILY_OPERATOR_PATH, 1): {
        "code": 0,
        "zpData": {"isReady": 0, "totalSize": 0, "dataList": []},
      },
      (BOSS_DAILY_JOB_PATH, 1): {
        "code": 0,
        "zpData": {"isReady": 1, "totalSize": 0, "dataList": []},
      },
    })

    batch = BossOfficialResultsCdpSource(page_client=fake_client).fetch(date(2026, 6, 15))

    self.assertIn(f"{BOSS_DAILY_OPERATOR_PATH} reports data is not ready", batch.source_warnings)

  def test_cli_builds_cdp_source_from_source_argument(self):
    args = sync_cli.build_parser().parse_args(["--source", "cdp", "--cdp-url", "http://127.0.0.1:9222"])

    source = sync_cli._build_source(args)

    self.assertIsInstance(source, BossOfficialResultsCdpSource)
    self.assertEqual(source.cdp_url, "http://127.0.0.1:9222")

  def test_cli_source_file_keeps_backward_compatible_file_source(self):
    args = sync_cli.build_parser().parse_args(["--source-file", "/tmp/official-results.json"])

    source = sync_cli._build_source(args)

    self.assertIsInstance(source, JsonOfficialResultsSource)

  def test_cli_dry_run_prints_counts_without_record_values(self):
    target_date = date(2026, 6, 15)
    batch = OfficialResultsBatch(
      target_date=target_date,
      operator_rows=(map_operator_row({"bossName": "Boss A", "phoneDesc": "13800000000"}, target_date),),
      job_rows=(map_job_row({"jobDesc": "Backend Engineer", "bossName": "Boss A", "phoneDesc": "13800000000"}, target_date),),
    )
    operator_table = FakeFeishuTable()
    job_table = FakeFeishuTable()
    fake_client = FakeFeishuClient(operator_table, job_table)

    with patch.object(sync_cli, "_build_source", return_value=FakeOfficialResultsSource(batch)), \
      patch.object(sync_cli.FeishuBitableClient, "from_env", return_value=fake_client), \
      patch.object(sync_cli.OperatorConfigProvider, "load", return_value=(OperatorProfile("op_a", "Boss A", "Boss A"),)), \
      patch("sys.stdout", new_callable=StringIO) as stdout:
      exit_code = sync_cli.main(["--date", "2026-06-15", "--dry-run"])

    output = stdout.getvalue()
    self.assertEqual(exit_code, 0)
    self.assertIn('"would_create": 2', output)
    self.assertNotIn("Boss A", output)
    self.assertNotIn("13800000000", output)
    self.assertEqual(operator_table.created, [])
    self.assertEqual(job_table.created, [])


if __name__ == "__main__":
  unittest.main()
