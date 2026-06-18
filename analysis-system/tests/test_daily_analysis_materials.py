from __future__ import annotations

import unittest
import json
from datetime import date, datetime, timedelta, timezone
from typing import Any

from boss_analysis.domain.daily_analysis_materials import (
  build_historical_effects_14d,
  build_operation_details,
  build_operation_overview_14d,
  historical_window_14d,
)
from boss_analysis.domain.operators import OperatorProfile
from boss_analysis.domain.summary import DailyBasicStatsRecord


def _daily_basic_record(
  *,
  metric_name: str = "boss_daily_operator_basic_stats",
  active_date: date,
  operator_id: str,
  card_exposed: int = 1,
  operator_account_name: str | None = None,
  boss_account_name: str | None = None,
  boss_account_matched: str | None = None,
  total_events: int = 0,
  source_row_count: int = 0,
  recorded_at: datetime | None = None,
) -> DailyBasicStatsRecord:
  return DailyBasicStatsRecord(
    metric_name=metric_name,
    active_date=active_date,
    operator_id=operator_id,
    operator_account_name=operator_account_name,
    boss_account_name=boss_account_name,
    boss_account_matched=boss_account_matched,
    card_exposed=card_exposed,
    total_events=total_events,
    source_row_count=source_row_count,
    recorded_at=recorded_at,
  )


def _full_historical_window_records(
  *,
  target_date: date,
  operator_id: str,
) -> tuple[DailyBasicStatsRecord, ...]:
  return tuple(
    _daily_basic_record(
      active_date=target_date - timedelta(days=days_ago),
      operator_id=operator_id,
      card_exposed=days_ago,
    )
    for days_ago in range(1, 15)
  )


def _operation_overview_row(
  *,
  active_date: str,
  operator_id: str,
  detail_open_count: Any = 0,
  greeting_count: Any = 0,
  chat_open_count: Any = 0,
  chat_reply_count: Any = 0,
  job_operation_count: Any = 0,
  active_minutes: Any = 0,
  source_event_count: Any = 0,
  source_state: str | None = None,
  display_name: str | None = None,
  operator_name: str | None = None,
  operator_account_name: str | None = None,
  boss_name: str | None = None,
  boss_account_name: str | None = None,
  boss_account_matched: str | None = None,
) -> dict[str, Any]:
  return {
    "active_date": active_date,
    "operator_id": operator_id,
    "source_state": source_state,
    "detail_open_count": detail_open_count,
    "greeting_count": greeting_count,
    "chat_open_count": chat_open_count,
    "chat_reply_count": chat_reply_count,
    "job_operation_count": job_operation_count,
    "active_minutes": active_minutes,
    "source_event_count": source_event_count,
    **({
      "display_name": display_name,
    } if display_name is not None else {}),
    **({
      "operator_name": operator_name,
    } if operator_name is not None else {}),
    **({
      "operator_account_name": operator_account_name,
    } if operator_account_name is not None else {}),
    **({"boss_name": boss_name} if boss_name is not None else {}),
    **({
      "boss_account_name": boss_account_name,
    } if boss_account_name is not None else {}),
    **({
      "boss_account_matched": boss_account_matched,
    } if boss_account_matched is not None else {}),
  }


def _full_operation_window_records(
  *,
  target_date: date,
  operator_id: str,
  detail_open_count: int = 1,
) -> tuple[dict[str, Any], ...]:
  return tuple(
    _operation_overview_row(
      active_date=(target_date - timedelta(days=days_ago)).isoformat(),
      operator_id=operator_id,
      detail_open_count=detail_open_count,
    )
    for days_ago in range(1, 15)
  )


class DailyAnalysisMaterialsTests(unittest.TestCase):
  def test_operation_overview_filters_to_configured_operators_and_rolls_up(self):
    payload = build_operation_overview_14d(
      target_date=date(2026, 6, 16),
      rows=(
        _operation_overview_row(
          active_date="2026-06-02",
          operator_id=" op_linzhe ",
          detail_open_count="5",
          greeting_count=2,
          chat_open_count=1.4,
          source_event_count="3",
          source_state="",
        ),
        _operation_overview_row(
          active_date="2026-06-15",
          operator_id="op_linzhe",
          detail_open_count=2,
          greeting_count=True,
        ),
        _operation_overview_row(
          active_date="2026-06-03",
          operator_id="op_unknown",
          detail_open_count=10,
        ),
        _operation_overview_row(
          active_date="2026-06-16",
          operator_id="op_linzhe",
          detail_open_count=20,
        ),
      ),
      operator_profiles=(OperatorProfile("op_linzhe", "林泽", "林泽"),),
    )

    self.assertEqual(payload["source_state"], "partial")
    self.assertEqual(payload["window"]["start_date"], "2026-06-02")
    self.assertEqual(payload["window"]["end_date"], "2026-06-15")
    self.assertEqual(len(payload["operator_daily_rows"]), 2)
    self.assertEqual(payload["operator_daily_rows"][0]["operator_id"], "op_linzhe")
    self.assertEqual(payload["operator_daily_rows"][0]["active_date"], "2026-06-02")
    self.assertEqual(payload["operator_daily_rows"][0]["source_state"], "")
    self.assertEqual(payload["operator_daily_rows"][1]["active_date"], "2026-06-15")
    self.assertNotIn("op_unknown", [row["operator_id"] for row in payload["operator_daily_rows"]])
    self.assertEqual(payload["operator_rollups"], [{"operator_id": "op_linzhe", "display_name": "林泽", "covered_days": 2, "totals": {"detail_open_count": 7, "greeting_count": 3, "chat_open_count": 1, "chat_reply_count": 0, "job_operation_count": 0, "active_minutes": 0, "source_event_count": 3}, "daily_averages": {"detail_open_count": 3.5, "greeting_count": 1.5, "chat_open_count": 0.5, "chat_reply_count": 0.0, "job_operation_count": 0.0, "active_minutes": 0.0, "source_event_count": 1.5}}])

  def test_operation_overview_dedupes_same_day_rows_and_keeps_deterministic_tiebreak(self):
    rows = (
      _operation_overview_row(
        active_date="2026-06-03",
        operator_id="op_linzhe",
        detail_open_count=2,
        greeting_count=9,
        active_minutes=5.0,
        source_event_count=5,
        source_state="partial",
      ),
      _operation_overview_row(
        active_date="2026-06-03",
        operator_id=" op_linzhe ",
        detail_open_count=1,
        greeting_count=1,
        active_minutes=3.0,
        source_event_count=5,
      ),
      _operation_overview_row(
        active_date="2026-06-03",
        operator_id="op_linzhe",
        detail_open_count=9,
        greeting_count=1,
        active_minutes=1.0,
        source_event_count=7,
        source_state="partial",
      ),
    )
    payload = build_operation_overview_14d(
      target_date=date(2026, 6, 16),
      rows=rows,
      operator_profiles=(OperatorProfile("op_linzhe", "林泽", "林泽"),),
    )

    self.assertEqual(len(payload["operator_daily_rows"]), 1)
    row = payload["operator_daily_rows"][0]
    self.assertEqual(row["source_state"], "partial")
    self.assertEqual(row["detail_open_count"], 9)
    self.assertEqual(row["greeting_count"], 1)
    self.assertEqual(row["active_minutes"], 1)
    self.assertEqual(row["source_event_count"], 7)
    self.assertEqual(payload["operator_rollups"][0]["covered_days"], 1)
    self.assertEqual(payload["operator_rollups"][0]["totals"]["detail_open_count"], 9)
    self.assertEqual(payload["operator_rollups"][0]["totals"]["greeting_count"], 1)
    self.assertEqual(payload["operator_rollups"][0]["totals"]["active_minutes"], 1)
    self.assertEqual(payload["operator_rollups"][0]["totals"]["source_event_count"], 7)
    self.assertEqual(payload["operator_rollups"][0]["daily_averages"]["detail_open_count"], 9.0)

    payload_reversed = build_operation_overview_14d(
      target_date=date(2026, 6, 16),
      rows=tuple(reversed(rows)),
      operator_profiles=(OperatorProfile("op_linzhe", "林泽", "林泽"),),
    )
    self.assertEqual(payload_reversed["operator_daily_rows"][0], row)

  def test_operation_overview_dedupes_tiebreak_by_field_sum_when_source_event_count_equal(self):
    payload = build_operation_overview_14d(
      target_date=date(2026, 6, 16),
      rows=(
        _operation_overview_row(
          active_date="2026-06-04",
          operator_id="op_linzhe",
          detail_open_count=1,
          greeting_count=1,
          chat_open_count=1,
          source_event_count=4,
        ),
        _operation_overview_row(
          active_date="2026-06-04",
          operator_id="op_linzhe",
          detail_open_count=3,
          greeting_count=0,
          chat_open_count=0,
          source_event_count=4,
        ),
      ),
      operator_profiles=(OperatorProfile("op_linzhe", "林泽", "林泽"),),
    )
    row = payload["operator_daily_rows"][0]
    self.assertEqual(row["detail_open_count"], 3)
    self.assertEqual(payload["operator_rollups"][0]["totals"]["detail_open_count"], 3)

  def test_operation_overview_dedupes_same_day_by_source_state_rank(self):
    payload = build_operation_overview_14d(
      target_date=date(2026, 6, 16),
      rows=(
        _operation_overview_row(
          active_date="2026-06-04",
          operator_id="op_linzhe",
          detail_open_count=2,
          greeting_count=2,
          source_event_count=4,
          source_state="partial",
        ),
        _operation_overview_row(
          active_date="2026-06-04",
          operator_id="op_linzhe",
          detail_open_count=2,
          greeting_count=2,
          source_event_count=4,
          source_state="loaded",
        ),
      ),
      operator_profiles=(OperatorProfile("op_linzhe", "林泽", "林泽"),),
    )
    row = payload["operator_daily_rows"][0]
    self.assertEqual(row["source_state"], "loaded")
    self.assertEqual(row["detail_open_count"], 2)
    self.assertEqual(row["greeting_count"], 2)
    self.assertEqual(row["source_event_count"], 4)

  def test_operation_overview_dedupes_same_day_blank_source_state_does_not_dominate(self):
    payload = build_operation_overview_14d(
      target_date=date(2026, 6, 16),
      rows=(
        _operation_overview_row(
          active_date="2026-06-04",
          operator_id="op_linzhe",
          detail_open_count=2,
          greeting_count=2,
          source_event_count=4,
          source_state="",
        ),
        _operation_overview_row(
          active_date="2026-06-04",
          operator_id="op_linzhe",
          detail_open_count=2,
          greeting_count=2,
          source_event_count=4,
          source_state="not_loaded",
        ),
        _operation_overview_row(
          active_date="2026-06-04",
          operator_id="op_linzhe",
          detail_open_count=2,
          greeting_count=2,
          source_event_count=4,
          source_state="partial",
        ),
        _operation_overview_row(
          active_date="2026-06-04",
          operator_id="op_linzhe",
          detail_open_count=2,
          greeting_count=2,
          source_event_count=4,
          source_state="loaded",
        ),
      ),
      operator_profiles=(OperatorProfile("op_linzhe", "林泽", "林泽"),),
    )

    row = payload["operator_daily_rows"][0]
    self.assertEqual(row["source_state"], "loaded")
    self.assertEqual(row["source_event_count"], 4)

  def test_operation_overview_works_with_non_reiterable_input(self):
    class _OneShotRows:
      def __init__(self):
        self._iterated = False
        self._rows = (
          _operation_overview_row(
            active_date="2026-06-04",
            operator_id="op_linzhe",
            detail_open_count=1,
          ),
          _operation_overview_row(
            active_date="2026-06-05",
            operator_id="op_linzhe",
            detail_open_count=2,
          ),
        )

      def __iter__(self):
        if self._iterated:
          raise RuntimeError("rows should only be iterated once")
        self._iterated = True
        return iter(self._rows)

    rows = _OneShotRows()
    payload = build_operation_overview_14d(
      target_date=date(2026, 6, 16),
      rows=rows,
      operator_profiles=(OperatorProfile("op_linzhe", "林泽", "林泽"),),
    )

    self.assertEqual(payload["source_state"], "partial")
    self.assertEqual(len(payload["operator_daily_rows"]), 2)
    self.assertEqual(payload["operator_rollups"][0]["totals"]["detail_open_count"], 3)
    with self.assertRaises(RuntimeError):
      list(rows)

  def test_operation_overview_trim_only_operator_id_matching(self):
    payload = build_operation_overview_14d(
      target_date=date(2026, 6, 16),
      rows=(
        _operation_overview_row(
          active_date="2026-06-03",
          operator_id="op_linzhe",
          detail_open_count=1,
        ),
      ),
      operator_profiles=(OperatorProfile("OP_LINZHE", "林泽", "林泽"),),
    )

    self.assertEqual(payload["source_state"], "partial")
    self.assertEqual(payload["operator_daily_rows"], [])
    self.assertEqual(payload["operator_rollups"], [])

  def test_operation_overview_duplicate_enabled_operator_id_raises_value_error(self):
    with self.assertRaises(ValueError):
      build_operation_overview_14d(
        target_date=date(2026, 6, 16),
        rows=(),
        operator_profiles=(
          OperatorProfile("op_linzhe", "林泽", "linzhe"),
          OperatorProfile(" op_linzhe ", "林泽", "linzhe"),
        ),
      )

  def test_operation_overview_blank_enabled_operator_id_raises_value_error(self):
    with self.assertRaises(ValueError):
      build_operation_overview_14d(
        target_date=date(2026, 6, 16),
        rows=(),
        operator_profiles=(OperatorProfile("   ", "blank", "blank"),),
      )

  def test_operation_overview_disabled_blank_operator_id_is_ignored(self):
    payload = build_operation_overview_14d(
      target_date=date(2026, 6, 16),
      rows=(
        _operation_overview_row(
          active_date="2026-06-03",
          operator_id="   ",
          detail_open_count=1,
        ),
      ),
      operator_profiles=(OperatorProfile("   ", "blank", "blank", enabled=False),),
    )

    self.assertEqual(payload["source_state"], "not_loaded")
    self.assertEqual(payload["operator_daily_rows"], [])
    self.assertEqual(payload["operator_rollups"], [])

  def test_operation_overview_marks_not_loaded_when_no_rows(self):
    payload = build_operation_overview_14d(
      target_date=date(2026, 6, 16),
      rows=(),
      operator_profiles=(OperatorProfile("op_linzhe", "林泽", "林泽"),),
    )

    self.assertEqual(payload["source_state"], "not_loaded")
    self.assertEqual(payload["operator_daily_rows"], [])
    self.assertEqual(payload["operator_rollups"], [])

  def test_operation_overview_tolerates_none_active_date(self):
    payload = build_operation_overview_14d(
      target_date=date(2026, 6, 16),
      rows=(
        _operation_overview_row(
          active_date=None,
          operator_id="op_linzhe",
          detail_open_count=1,
        ),
      ),
      operator_profiles=(OperatorProfile("op_linzhe", "林泽", "林泽"),),
    )

    self.assertEqual(payload["source_state"], "partial")
    self.assertEqual(payload["operator_daily_rows"], [])
    self.assertEqual(payload["operator_rollups"], [])

  def test_operation_overview_tolerates_blank_active_date(self):
    payload = build_operation_overview_14d(
      target_date=date(2026, 6, 16),
      rows=(
        _operation_overview_row(
          active_date="",
          operator_id="op_linzhe",
          detail_open_count=1,
        ),
      ),
      operator_profiles=(OperatorProfile("op_linzhe", "林泽", "林泽"),),
    )

    self.assertEqual(payload["source_state"], "partial")
    self.assertEqual(payload["operator_daily_rows"], [])
    self.assertEqual(payload["operator_rollups"], [])

  def test_operation_overview_tolerates_invalid_active_date(self):
    payload = build_operation_overview_14d(
      target_date=date(2026, 6, 16),
      rows=(
        _operation_overview_row(
          active_date="not-a-date",
          operator_id="op_linzhe",
          detail_open_count=1,
        ),
      ),
      operator_profiles=(OperatorProfile("op_linzhe", "林泽", "林泽"),),
    )

    self.assertEqual(payload["source_state"], "partial")
    self.assertEqual(payload["operator_daily_rows"], [])
    self.assertEqual(payload["operator_rollups"], [])

  def test_operation_overview_tolerates_rfc3339_utc_timestamp(self):
    payload = build_operation_overview_14d(
      target_date=date(2026, 6, 16),
      rows=(
        _operation_overview_row(
          active_date="2026-06-02T08:00:00Z",
          operator_id="op_linzhe",
          detail_open_count=1,
        ),
      ),
      operator_profiles=(OperatorProfile("op_linzhe", "林泽", "林泽"),),
    )

    self.assertEqual(payload["operator_daily_rows"][0]["active_date"], "2026-06-02")

  def test_operation_overview_tolerates_iso_offset_timestamp(self):
    payload = build_operation_overview_14d(
      target_date=date(2026, 6, 16),
      rows=(
        _operation_overview_row(
          active_date="2026-06-02T23:30:00+08:00",
          operator_id="op_linzhe",
          detail_open_count=1,
        ),
      ),
      operator_profiles=(OperatorProfile("op_linzhe", "林泽", "林泽"),),
    )

    self.assertEqual(payload["operator_daily_rows"][0]["active_date"], "2026-06-02")

  def test_operation_overview_identical_duplicate_rows_are_order_independent(self):
    rows = (
      _operation_overview_row(
        active_date="2026-06-03",
        operator_id="op_linzhe",
        detail_open_count=1,
        greeting_count=2,
      ),
      _operation_overview_row(
        active_date="2026-06-03",
        operator_id="op_linzhe",
        detail_open_count=1,
        greeting_count=2,
      ),
    )
    payload = build_operation_overview_14d(
      target_date=date(2026, 6, 16),
      rows=rows,
      operator_profiles=(OperatorProfile("op_linzhe", "林泽", "林泽"),),
    )
    payload_reversed = build_operation_overview_14d(
      target_date=date(2026, 6, 16),
      rows=tuple(reversed(rows)),
      operator_profiles=(OperatorProfile("op_linzhe", "林泽", "林泽"),),
    )

    self.assertEqual(payload["operator_daily_rows"], payload_reversed["operator_daily_rows"])
    self.assertEqual(payload["operator_rollups"], payload_reversed["operator_rollups"])

  def test_operation_details_filters_to_target_date_and_removes_sensitive_fields(self):
    payload = build_operation_details(
      target_date=date(2026, 6, 16),
      value={
        "detail_open_events": [
          {
            "occurred_at": "2026-06-16T10:00:00+08:00",
            "operator_id": "op_linzhe",
            "job_key": "sales",
            "candidate_local_id": "cand_1",
            "source_event_id": "evt_1",
            "phone": "13800000000",
            "chat_text": "不要进入模型",
          },
          {
            "occurred_at": "2026-06-16T10:00:00+08:00",
            "operator_id": "op_linzhe",
            "source_event_id": "https://boss.example/path",
            "job_key": "sales",
          },
          {
            "occurred_at": "2026-06-16T11:00:00+08:00",
            "operator_id": "op_linzhe",
            "source_event_id": "13800000000",
            "job_key": "sales",
          },
          {
            "occurred_at": "2026-06-16T12:00:00+08:00",
            "operator_id": "op_linzhe",
            "source_event_id": "聊天正文",
            "job_key": "sales",
          },
        ],
        "greeting_events": [],
        "chat_progress_events": [],
        "job_operation_events": [],
        "timeline_windows": [],
      },
      operator_profiles=(OperatorProfile("op_linzhe", "林泽", "林泽"),),
    )

    self.assertEqual(payload["source_state"], "loaded")
    self.assertEqual(payload["target_date"], "2026-06-16")
    self.assertEqual(len(payload["detail_open_events"]), 4)
    self.assertEqual(payload["detail_open_events"][0]["candidate_local_id"], "cand_1")
    self.assertNotIn("phone", payload["detail_open_events"][0])
    self.assertNotIn("chat_text", payload["detail_open_events"][0])
    source_event_ids = sorted(
      item["source_event_id"]
      for item in payload["detail_open_events"]
      if "source_event_id" in item
    )
    self.assertEqual(source_event_ids, ["evt_1"])
    encoded = json.dumps(payload, ensure_ascii=False)
    self.assertIn("cand_1", encoded)
    self.assertNotIn("13800000000", encoded)
    self.assertNotIn("不要进入模型", encoded)
    self.assertNotIn("https://boss.example/path", encoded)
    self.assertNotIn("聊天正文", encoded)

  def test_operation_details_marks_not_loaded_for_empty_input(self):
    payload = build_operation_details(
      target_date=date(2026, 6, 16),
      value=None,
      operator_profiles=(OperatorProfile("op_linzhe", "林泽", "林泽"),),
    )

    self.assertEqual(payload["source_state"], "not_loaded")
    self.assertEqual(payload["detail_open_events"], [])
    self.assertIn("operation_details", payload["data_gaps"])

  def test_operation_details_marks_partial_for_non_mapping_value(self):
    payload = build_operation_details(
      target_date=date(2026, 6, 16),
      value=["bad", "list", "value"],
      operator_profiles=(OperatorProfile("op_linzhe", "林泽", "林泽"),),
    )

    self.assertEqual(payload["source_state"], "partial")
    self.assertEqual(payload["data_gaps"], ["operation_details"])
    self.assertEqual(payload["detail_open_events"], [])
    self.assertEqual(payload["greeting_events"], [])
    self.assertEqual(payload["chat_progress_events"], [])
    self.assertEqual(payload["job_operation_events"], [])
    self.assertEqual(payload["timeline_windows"], [])

  def test_operation_details_marks_partial_when_non_list_collections(self):
    payload = build_operation_details(
      target_date=date(2026, 6, 16),
      value={
        "detail_open_events": {
          "unexpected": "shape",
        },
        "greeting_events": [
          {
            "occurred_at": "2026-06-16T10:00:00+08:00",
            "operator_id": "op_linzhe",
            "source_event_id": "evt_1",
            "result_state": "success",
            "job_key": "sales",
          },
        ],
        "chat_progress_events": [],
        "job_operation_events": (),
        "timeline_windows": [],
      },
      operator_profiles=(OperatorProfile("op_linzhe", "林泽", "林泽"),),
    )

    self.assertEqual(payload["source_state"], "partial")
    self.assertEqual(payload["greeting_events"], [
      {
        "occurred_at": "2026-06-16T10:00:00+08:00",
        "operator_id": "op_linzhe",
        "job_key": "sales",
        "result_state": "success",
        "source_event_id": "evt_1",
      },
    ])
    self.assertIn("operation_details.detail_open_events", payload["data_gaps"])
    self.assertIn("operation_details.job_operation_events", payload["data_gaps"])

  def test_operation_details_marks_partial_for_non_mapping_collection_items(self):
    payload = build_operation_details(
      target_date=date(2026, 6, 16),
      value={
        "detail_open_events": [
          "bad-item-1",
          2,
          {"not_a_dict": "x"},
        ],
      },
      operator_profiles=(OperatorProfile("op_linzhe", "林泽", "林泽"),),
    )

    self.assertEqual(payload["source_state"], "partial")
    self.assertEqual(payload["data_gaps"], ["operation_details.detail_open_events"])
    self.assertEqual(payload["detail_open_events"], [])

  def test_operation_details_source_event_ids_only_keep_safe_ids(self):
    payload = build_operation_details(
      target_date=date(2026, 6, 16),
      value={
        "detail_open_events": [],
        "greeting_events": [],
        "chat_progress_events": [],
        "job_operation_events": [],
        "timeline_windows": [
          {
            "window_start": "2026-06-16T00:00:00+08:00",
            "window_end": "2026-06-16T00:10:00+08:00",
            "operator_id": "op_linzhe",
            "job_key": "sales",
            "source_event_ids": [
              "evt_valid",
              "https://boss.example/a?x=1",
              "13800000000",
              "聊天正文",
            ],
          },
        ],
      },
      operator_profiles=(OperatorProfile("op_linzhe", "林泽", "林泽"),),
    )

    self.assertEqual(payload["source_state"], "loaded")
    self.assertEqual(payload["timeline_windows"][0]["source_event_ids"], ["evt_valid"])

  def test_operation_details_does_not_expose_nested_operation_counts_and_event_ids(
    self,
  ):
    payload = build_operation_details(
      target_date=date(2026, 6, 16),
      value={
        "detail_open_events": [],
        "greeting_events": [],
        "chat_progress_events": [],
        "job_operation_events": [],
        "timeline_windows": [
          {
            "window_start": "2026-06-16T00:00:00+08:00",
            "window_end": "2026-06-16T00:10:00+08:00",
            "operator_id": "op_linzhe",
            "job_key": "sales",
            "operation_counts": {
              "detail_open": "1",
              "chat_text": {
                "text": "不要进入模型",
              },
              "url": {
                "value": "https://boss.example/path?token=secret",
              },
              "nested": ["a", "b"],
            },
            "source_event_ids": ["evt_valid", {"url": "https://boss.example/path"}],
          },
        ],
      },
      operator_profiles=(OperatorProfile("op_linzhe", "林泽", "林泽"),),
    )

    self.assertEqual(payload["source_state"], "loaded")
    timeline = payload["timeline_windows"][0]
    self.assertEqual(timeline["operation_counts"], {"detail_open": 1})
    self.assertEqual(timeline["source_event_ids"], ["evt_valid"])
    encoded = json.dumps(payload, ensure_ascii=False)
    self.assertNotIn("不要进入模型", encoded)
    self.assertNotIn("https://boss.example/path?token=secret", encoded)
    self.assertNotIn("https://boss.example/path", encoded)

  def test_operation_details_does_not_gap_when_collection_is_missing(self):
    payload = build_operation_details(
      target_date=date(2026, 6, 16),
      value={
        "detail_open_events": [
          {
            "occurred_at": "2026-06-16T10:00:00+08:00",
            "operator_id": "op_linzhe",
            "source_event_id": "evt_present",
            "job_key": "sales",
          },
        ]
      },
      operator_profiles=(OperatorProfile("op_linzhe", "林泽", "林泽"),),
    )

    self.assertEqual(payload["source_state"], "loaded")
    self.assertEqual(payload["data_gaps"], [])
    self.assertEqual(len(payload["detail_open_events"]), 1)
    self.assertEqual(payload["greeting_events"], [])
    self.assertEqual(payload["chat_progress_events"], [])
    self.assertEqual(payload["job_operation_events"], [])
    self.assertEqual(payload["timeline_windows"], [])

  def test_operation_details_marks_gap_only_for_present_non_list_collection(self):
    payload = build_operation_details(
      target_date=date(2026, 6, 16),
      value={
        "detail_open_events": "bad",
      },
      operator_profiles=(OperatorProfile("op_linzhe", "林泽", "林泽"),),
    )

    self.assertEqual(payload["data_gaps"], ["operation_details.detail_open_events"])
    self.assertEqual(payload["source_state"], "partial")

  def test_operation_details_filters_by_enabled_operator_profiles_and_normalizes_id(self):
    payload = build_operation_details(
      target_date=date(2026, 6, 16),
      value={
        "detail_open_events": [
          {
            "occurred_at": "2026-06-16T10:00:00+08:00",
            "operator_id": " raw_disabled ",
            "source_event_id": "evt_disabled",
          },
          {
            "occurred_at": "2026-06-16T11:00:00+08:00",
            "operator_id": " op_linzhe ",
            "source_event_id": "evt_match",
          },
          {
            "occurred_at": "2026-06-16T12:00:00+08:00",
            "operator_id": "alias_linzhe",
            "source_event_id": "evt_alias",
          },
          {
            "occurred_at": "2026-06-16T13:00:00+08:00",
            "operator_id": "op_unknown",
            "source_event_id": "evt_unknown",
          },
        ],
        "greeting_events": [],
        "chat_progress_events": [],
        "job_operation_events": [],
        "timeline_windows": [],
      },
      operator_profiles=(
        OperatorProfile("op_disabled", "禁用", "linz", enabled=False),
        OperatorProfile("op_linzhe", "林泽", aliases=("alias_linzhe",)),
      ),
    )

    self.assertEqual(payload["source_state"], "loaded")
    self.assertEqual(len(payload["detail_open_events"]), 2)
    self.assertEqual(payload["detail_open_events"][0]["operator_id"], "op_linzhe")
    source_event_ids = sorted(item["source_event_id"] for item in payload["detail_open_events"])
    self.assertEqual(source_event_ids, ["evt_alias", "evt_match"])

  def test_operation_details_handles_ambiguous_fallback_identity(self):
    payload = build_operation_details(
      target_date=date(2026, 6, 16),
      value={
        "detail_open_events": [
          {
            "occurred_at": "2026-06-16T10:00:00+08:00",
            "operator_id": "raw_shared",
            "source_event_id": "evt_shared",
          },
          {
            "occurred_at": "2026-06-16T10:30:00+08:00",
            "operator_id": "op_linzhe",
            "source_event_id": "evt_exact",
          },
        ],
        "greeting_events": [],
        "chat_progress_events": [],
        "job_operation_events": [],
        "timeline_windows": [],
      },
      operator_profiles=(
        OperatorProfile(
          "op_linzhe",
          "林泽",
          aliases=("shared-account",),
        ),
        OperatorProfile(
          "op_wangming",
          "王明",
          aliases=("shared-account",),
        ),
      ),
    )

    self.assertEqual(len(payload["detail_open_events"]), 1)
    self.assertEqual(payload["detail_open_events"][0]["source_event_id"], "evt_exact")

  def test_operation_details_falls_back_to_identity_when_exact_match_missing(self):
    payload = build_operation_details(
      target_date=date(2026, 6, 16),
      value={
        "detail_open_events": [
          {
            "occurred_at": "2026-06-16T10:00:00+08:00",
            "operator_id": "alias.account",
            "source_event_id": "evt_alias",
          },
        ],
        "greeting_events": [],
        "chat_progress_events": [],
        "job_operation_events": [],
        "timeline_windows": [],
      },
      operator_profiles=(
        OperatorProfile("op_linzhe", "林泽", aliases=("alias.account",)),
      ),
    )

    self.assertEqual(payload["source_state"], "loaded")
    self.assertEqual(payload["detail_open_events"][0]["operator_id"], "op_linzhe")

  def test_timeline_windows_are_filtered_by_window_start_and_allowlisted(self):
    payload = build_operation_details(
      target_date=date(2026, 6, 16),
      value={
        "detail_open_events": [],
        "greeting_events": [],
        "chat_progress_events": [],
        "job_operation_events": [],
        "timeline_windows": [
          {
            "window_start": "2026-06-16T00:00:00+08:00",
            "window_end": "2026-06-16T00:10:00+08:00",
            "operator_id": "op_linzhe",
            "job_key": "sales",
            "operation_counts": {"detail_open": 1},
            "source_event_ids": ["evt_timeline"],
            "phone": "18800000000",
            "candidate_local_id": "cand_ignored",
          },
          {
            "window_start": "2026-06-15T23:00:00+08:00",
            "window_end": "2026-06-16T00:10:00+08:00",
            "operator_id": "op_linzhe",
            "job_key": "sales",
            "operation_counts": {"detail_open": 2},
            "source_event_ids": ["evt_old"],
          },
        ],
      },
      operator_profiles=(OperatorProfile("op_linzhe", "林泽", "林泽"),),
    )

    self.assertEqual(len(payload["timeline_windows"]), 1)
    self.assertEqual(payload["timeline_windows"][0]["window_start"], "2026-06-16T00:00:00+08:00")
    self.assertEqual(payload["timeline_windows"][0]["operator_id"], "op_linzhe")
    self.assertNotIn("candidate_local_id", payload["timeline_windows"][0])
    self.assertNotIn("phone", payload["timeline_windows"][0])

  def test_timeline_windows_date_filter_uses_window_start(self):
    payload = build_operation_details(
      target_date=date(2026, 6, 16),
      value={
        "detail_open_events": [],
        "greeting_events": [],
        "chat_progress_events": [],
        "job_operation_events": [],
        "timeline_windows": [
          {
            "occurred_at": "2026-06-16T09:00:00+08:00",
            "window_start": "2026-06-15T09:00:00+08:00",
            "operator_id": "op_linzhe",
            "job_key": "sales",
            "source_event_ids": ["evt_old"],
          },
          {
            "occurred_at": "2026-06-15T09:00:00+08:00",
            "window_start": "2026-06-16T09:00:00+08:00",
            "operator_id": "op_linzhe",
            "job_key": "sales",
            "source_event_ids": ["evt_keep"],
          },
        ],
      },
      operator_profiles=(OperatorProfile("op_linzhe", "林泽", "林泽"),),
    )

    self.assertEqual(len(payload["timeline_windows"]), 1)
    self.assertEqual(payload["timeline_windows"][0]["source_event_ids"], ["evt_keep"])

  def test_operation_details_empty_mapping_or_empty_collections_are_not_loaded(self):
    empty_payload = build_operation_details(
      target_date=date(2026, 6, 16),
      value={},
      operator_profiles=(OperatorProfile("op_linzhe", "林泽", "林泽"),),
    )

    self.assertEqual(empty_payload["source_state"], "not_loaded")
    self.assertIn("operation_details", empty_payload["data_gaps"])

    empty_list_payload = build_operation_details(
      target_date=date(2026, 6, 16),
      value={
        "detail_open_events": [],
        "greeting_events": [],
        "chat_progress_events": [],
        "job_operation_events": [],
        "timeline_windows": [],
      },
      operator_profiles=(OperatorProfile("op_linzhe", "林泽", "林泽"),),
    )

    self.assertEqual(empty_list_payload["source_state"], "not_loaded")
    self.assertIn("operation_details", empty_list_payload["data_gaps"])

    old_item_payload = build_operation_details(
      target_date=date(2026, 6, 16),
      value={
        "detail_open_events": [
          {
            "occurred_at": "2026-06-15T10:00:00+08:00",
            "operator_id": "op_linzhe",
            "source_event_id": "evt_old",
            "job_key": "sales",
          }
        ]
      },
      operator_profiles=(OperatorProfile("op_linzhe", "林泽", "林泽"),),
    )
    self.assertEqual(old_item_payload["source_state"], "partial")

  def test_operation_overview_marks_partial_when_rows_are_outside_window(self):
    payload = build_operation_overview_14d(
      target_date=date(2026, 6, 16),
      rows=(
        _operation_overview_row(
          active_date="2026-06-16",
          operator_id="op_linzhe",
          detail_open_count=1,
        ),
        _operation_overview_row(
          active_date="2026-06-01",
          operator_id="op_linzhe",
          detail_open_count=2,
        ),
      ),
      operator_profiles=(OperatorProfile("op_linzhe", "林泽", "林泽"),),
    )

    self.assertEqual(payload["source_state"], "partial")
    self.assertEqual(payload["operator_daily_rows"], [])
    self.assertEqual(payload["operator_rollups"], [])

  def test_operation_overview_full_coverage_becomes_loaded(self):
    payload = build_operation_overview_14d(
      target_date=date(2026, 6, 16),
      rows=_full_operation_window_records(
        target_date=date(2026, 6, 16),
        operator_id="op_linzhe",
      )
      + _full_operation_window_records(
        target_date=date(2026, 6, 16),
        operator_id="op_wangming",
      ),
      operator_profiles=(
        OperatorProfile("op_linzhe", "林泽", "林泽"),
        OperatorProfile("op_wangming", "王明", "王明"),
      ),
    )

    self.assertEqual(payload["source_state"], "loaded")
    self.assertEqual(
      {rollup["operator_id"]: rollup["covered_days"] for rollup in payload["operator_rollups"]},
      {"op_linzhe": 14, "op_wangming": 14},
    )

  def test_operation_overview_fallback_identity_matches_trimmed_casefold_values(self):
    payload = build_operation_overview_14d(
      target_date=date(2026, 6, 16),
      rows=(
        _operation_overview_row(
          active_date="2026-06-02",
          operator_id="raw_display",
          display_name="  林泽 ",
          detail_open_count=1,
        ),
        _operation_overview_row(
          active_date="2026-06-03",
          operator_id="raw_name",
          operator_account_name="WANG.MING",
          detail_open_count=2,
        ),
        _operation_overview_row(
          active_date="2026-06-04",
          operator_id="raw_alias",
          operator_name="  alias.operator ",
          detail_open_count=3,
        ),
      ),
      operator_profiles=(
        OperatorProfile("op_linzhe", "林泽", "linzhe"),
        OperatorProfile(
          "op_wangming",
          "王明",
          "WANG.MING",
          aliases=("alias.operator",),
        ),
      ),
    )

    self.assertEqual(payload["source_state"], "partial")
    self.assertEqual(
      {rollup["operator_id"]: rollup["covered_days"] for rollup in payload["operator_rollups"]},
      {"op_linzhe": 1, "op_wangming": 2},
    )
    rows_by_operator = {}
    for row in payload["operator_daily_rows"]:
      rows_by_operator.setdefault(row["operator_id"], []).append(row)
    self.assertEqual(len(rows_by_operator["op_linzhe"]), 1)
    self.assertEqual(rows_by_operator["op_linzhe"][0]["detail_open_count"], 1)
    self.assertEqual(len(rows_by_operator["op_wangming"]), 2)
    self.assertEqual(sum(row["detail_open_count"] for row in rows_by_operator["op_wangming"]), 5)

  def test_operation_overview_fallback_identity_matching_respects_display_name_precedence(self):
    payload = build_operation_overview_14d(
      target_date=date(2026, 6, 16),
      rows=(
        _operation_overview_row(
          active_date="2026-06-02",
          operator_id="raw_operator",
          display_name="  ALIAS  ",
          operator_name="OP_NAME",
          detail_open_count=1,
        ),
      ),
      operator_profiles=(
        OperatorProfile("op_alias", "ALIAS", "primary"),
        OperatorProfile("op_name", "operator_name_target", "op_name"),
      ),
    )

    self.assertEqual(len(payload["operator_daily_rows"]), 1)
    self.assertEqual(payload["operator_daily_rows"][0]["operator_id"], "op_alias")
    self.assertEqual(payload["source_state"], "partial")

  def test_operation_overview_ambiguous_fallback_identity_is_excluded_but_exact_id_still_matches(self):
    payload = build_operation_overview_14d(
      target_date=date(2026, 6, 16),
      rows=(
        _operation_overview_row(
          active_date="2026-06-02",
          operator_id="raw_shared",
          operator_account_name="shared-account",
          detail_open_count=999,
        ),
        _operation_overview_row(
          active_date="2026-06-02",
          operator_id="op_linzhe",
          operator_account_name="shared-account",
          detail_open_count=20,
        ),
      ),
      operator_profiles=(
        OperatorProfile(
          "op_linzhe",
          "林泽",
          aliases=("shared-account",),
        ),
        OperatorProfile(
          "op_wangming",
          "王明",
          aliases=("shared-account",),
        ),
      ),
    )

    self.assertEqual(len(payload["operator_daily_rows"]), 1)
    self.assertEqual(payload["operator_daily_rows"][0]["operator_id"], "op_linzhe")
    self.assertEqual(payload["operator_daily_rows"][0]["detail_open_count"], 20)

  def test_operation_overview_excludes_disabled_profiles(self):
    payload = build_operation_overview_14d(
      target_date=date(2026, 6, 16),
      rows=(
        _operation_overview_row(
          active_date="2026-06-02",
          operator_id="op_disabled",
          detail_open_count=10,
        ),
        _operation_overview_row(
          active_date="2026-06-03",
          operator_id="op_linzhe",
          detail_open_count=5,
        ),
      ),
      operator_profiles=(
        OperatorProfile("op_disabled", "禁用人员", "disabled", enabled=False),
        OperatorProfile("op_linzhe", "林泽", "linzhe"),
      ),
    )

    self.assertEqual(len(payload["operator_daily_rows"]), 1)
    self.assertEqual(payload["operator_daily_rows"][0]["operator_id"], "op_linzhe")

  def test_operation_overview_converts_field_values_to_integers(self):
    payload = build_operation_overview_14d(
      target_date=date(2026, 6, 16),
      rows=(
        _operation_overview_row(
          active_date="2026-06-02",
          operator_id="op_linzhe",
          detail_open_count="6",
          greeting_count=7.8,
          chat_open_count=True,
          chat_reply_count=False,
          job_operation_count="bad",
          active_minutes=12.3,
          source_event_count="0",
        ),
      ),
      operator_profiles=(OperatorProfile("op_linzhe", "林泽", "linzhe"),),
    )

    row = payload["operator_daily_rows"][0]
    self.assertEqual(row["detail_open_count"], 6)
    self.assertEqual(row["greeting_count"], 7)
    self.assertEqual(row["chat_open_count"], 1)
    self.assertEqual(row["chat_reply_count"], 0)
    self.assertEqual(row["job_operation_count"], 0)
    self.assertEqual(row["active_minutes"], 12)
    self.assertEqual(row["source_event_count"], 0)

  def test_historical_window_excludes_target_date(self):
    window = historical_window_14d(date(2026, 6, 16))

    self.assertEqual(window["start_date"], "2026-06-02")
    self.assertEqual(window["end_date"], "2026-06-15")
    self.assertEqual(window["days"], 14)
    self.assertFalse(window["includes_target_date"])

  def test_historical_effects_filters_to_configured_operators_and_rolls_up_facts(self):
    records = (
      DailyBasicStatsRecord(
        metric_name="boss_daily_operator_basic_stats",
        active_date=date(2026, 6, 2),
        operator_id="op_linzhe",
        operator_account_name="林泽",
        active_minutes=45,
        card_exposed=100,
        detail_opened=30,
        greeting_clicked=20,
        greeting_succeeded=18,
        chat_opened=12,
        boss_reply_count=6,
        wechat_captured=2,
        total_events=188,
        source_row_count=4,
        recorded_at=datetime(2026, 6, 3, 1, 0, tzinfo=timezone.utc),
      ),
      DailyBasicStatsRecord(
        metric_name="boss_daily_operator_basic_stats",
        active_date=date(2026, 6, 16),
        operator_id="op_linzhe",
        card_exposed=999,
      ),
      DailyBasicStatsRecord(
        metric_name="boss_daily_operator_basic_stats",
        active_date=date(2026, 6, 2),
        operator_id="op_other",
        card_exposed=999,
      ),
      DailyBasicStatsRecord(
        metric_name="boss_daily_operator_basic_stats",
        active_date=date(2026, 6, 2),
        operator_id="disabled_alias",
        card_exposed=777,
      ),
    )

    payload = build_historical_effects_14d(
      target_date=date(2026, 6, 16),
      records=records,
      operator_profiles=(
        OperatorProfile("op_linzhe", "林泽", "林泽"),
        OperatorProfile(
          "op_disabled",
          "禁用人员",
          aliases=("disabled_alias",),
          enabled=False,
        ),
      ),
    )

    self.assertEqual(payload["source_state"], "partial")
    self.assertEqual(payload["window"]["start_date"], "2026-06-02")
    self.assertEqual(payload["window"]["end_date"], "2026-06-15")
    self.assertEqual(len(payload["operator_daily_rows"]), 1)
    self.assertNotIn(
      "op_disabled",
      [row["operator_id"] for row in payload["operator_daily_rows"]],
    )
    self.assertNotIn(
      "op_disabled",
      [rollup["operator_id"] for rollup in payload["operator_rollups"]],
    )
    self.assertEqual(payload["operator_daily_rows"][0]["operator_id"], "op_linzhe")
    self.assertEqual(payload["operator_daily_rows"][0]["active_date"], "2026-06-02")
    self.assertEqual(payload["operator_daily_rows"][0]["card_exposed"], 100)
    self.assertEqual(payload["operator_daily_rows"][0]["detail_opened"], 30)
    self.assertEqual(payload["operator_daily_rows"][0]["greeting_succeeded"], 18)
    self.assertEqual(payload["operator_rollups"][0]["operator_id"], "op_linzhe")
    self.assertEqual(payload["operator_rollups"][0]["covered_days"], 1)
    self.assertEqual(payload["operator_rollups"][0]["totals"]["card_exposed"], 100)
    self.assertEqual(payload["operator_rollups"][0]["daily_averages"]["card_exposed"], 100.0)

  def test_historical_effects_accepts_positional_call_shape(self):
    payload = build_historical_effects_14d(
      date(2026, 6, 16),
      (
        _daily_basic_record(
          active_date=date(2026, 6, 2),
          operator_id="op_linzhe",
          card_exposed=8,
        ),
      ),
      (OperatorProfile("op_linzhe", "林泽", "林泽"),),
    )

    self.assertEqual(payload["window"]["start_date"], "2026-06-02")
    self.assertEqual(len(payload["operator_daily_rows"]), 1)
    self.assertEqual(payload["operator_daily_rows"][0]["operator_id"], "op_linzhe")
    self.assertEqual(payload["operator_daily_rows"][0]["card_exposed"], 8)
    self.assertEqual(payload["operator_rollups"][0]["totals"]["card_exposed"], 8)

  def test_historical_effects_ignores_wrong_metric_records_when_mixed(self):
    records = (
      _daily_basic_record(
        metric_name="wrong_metric",
        active_date=date(2026, 6, 2),
        operator_id="op_linzhe",
        card_exposed=999,
        source_row_count=99,
        total_events=999,
      ),
      _daily_basic_record(
        active_date=date(2026, 6, 2),
        operator_id="op_linzhe",
        card_exposed=8,
        source_row_count=1,
        total_events=1,
      ),
    )

    payload = build_historical_effects_14d(
      target_date=date(2026, 6, 16),
      records=records,
      operator_profiles=(OperatorProfile("op_linzhe", "林泽", "林泽"),),
    )

    self.assertEqual(len(payload["operator_daily_rows"]), 1)
    self.assertEqual(payload["operator_daily_rows"][0]["card_exposed"], 8)
    self.assertEqual(payload["operator_rollups"][0]["totals"]["card_exposed"], 8)

  def test_historical_effects_marks_not_loaded_when_only_wrong_metric_records_exist(self):
    payload = build_historical_effects_14d(
      target_date=date(2026, 6, 16),
      records=(
        _daily_basic_record(
          metric_name="wrong_metric",
          active_date=date(2026, 6, 2),
          operator_id="op_linzhe",
          operator_account_name="林泽",
          card_exposed=999,
        ),
      ),
      operator_profiles=(OperatorProfile("op_linzhe", "林泽", "林泽"),),
    )

    self.assertEqual(payload["source_state"], "not_loaded")
    self.assertEqual(payload["operator_daily_rows"], [])
    self.assertEqual(payload["operator_rollups"], [])

  def test_historical_effects_marks_partial_when_enabled_operator_lacks_full_coverage(self):
    target_date = date(2026, 6, 16)
    records = _full_historical_window_records(
      target_date=target_date,
      operator_id="op_linzhe",
    ) + (
      _daily_basic_record(
        active_date=date(2026, 6, 15),
        operator_id="op_wangming",
        card_exposed=10,
      ),
    )

    payload = build_historical_effects_14d(
      target_date=target_date,
      records=records,
      operator_profiles=(
        OperatorProfile("op_linzhe", "林泽", "林泽"),
        OperatorProfile("op_wangming", "王明", "王明"),
      ),
    )

    self.assertEqual(payload["source_state"], "partial")
    rollups_by_operator = {
      rollup["operator_id"]: rollup
      for rollup in payload["operator_rollups"]
    }
    self.assertEqual(rollups_by_operator["op_linzhe"]["covered_days"], 14)
    self.assertEqual(rollups_by_operator["op_wangming"]["covered_days"], 1)

  def test_historical_effects_marks_loaded_when_each_enabled_operator_has_full_coverage(self):
    target_date = date(2026, 6, 16)
    records = (
      _full_historical_window_records(
        target_date=target_date,
        operator_id="op_linzhe",
      )
      + _full_historical_window_records(
        target_date=target_date,
        operator_id="op_wangming",
      )
    )

    payload = build_historical_effects_14d(
      target_date=target_date,
      records=records,
      operator_profiles=(
        OperatorProfile("op_linzhe", "林泽", "林泽"),
        OperatorProfile("op_wangming", "王明", "王明"),
      ),
    )

    self.assertEqual(payload["source_state"], "loaded")
    self.assertEqual(
      {
        rollup["operator_id"]: rollup["covered_days"]
        for rollup in payload["operator_rollups"]
      },
      {"op_linzhe": 14, "op_wangming": 14},
    )

  def test_historical_effects_uses_trimmed_operator_id_canonical_form(self):
    target_date = date(2026, 6, 16)
    raw_operator_id = " op_linzhe "
    canonical_operator_id = "op_linzhe"
    payload = build_historical_effects_14d(
      target_date=target_date,
      records=_full_historical_window_records(
        target_date=target_date,
        operator_id=canonical_operator_id,
      ),
      operator_profiles=(OperatorProfile(raw_operator_id, "林泽", "林泽"),),
    )

    self.assertEqual(payload["source_state"], "loaded")
    self.assertEqual(len(payload["operator_daily_rows"]), 14)
    self.assertEqual(
      {row["operator_id"] for row in payload["operator_daily_rows"]},
      {canonical_operator_id},
    )
    self.assertEqual(payload["operator_rollups"][0]["operator_id"], canonical_operator_id)
    self.assertNotIn(
      raw_operator_id,
      [row["operator_id"] for row in payload["operator_daily_rows"]],
    )
    self.assertNotIn(
      raw_operator_id,
      [rollup["operator_id"] for rollup in payload["operator_rollups"]],
    )

  def test_historical_effects_matches_records_by_account_display_and_alias(self):
    records = (
      _daily_basic_record(
        active_date=date(2026, 6, 2),
        operator_id="raw_account",
        operator_account_name="林泽账号",
        card_exposed=10,
      ),
      _daily_basic_record(
        active_date=date(2026, 6, 2),
        operator_id="raw_display",
        boss_account_name="王明",
        card_exposed=20,
      ),
      _daily_basic_record(
        active_date=date(2026, 6, 2),
        operator_id="raw_alias",
        boss_account_matched="张三别名",
        card_exposed=30,
      ),
    )

    payload = build_historical_effects_14d(
      target_date=date(2026, 6, 16),
      records=records,
      operator_profiles=(
        OperatorProfile("op_linzhe", "林泽", "林泽账号"),
        OperatorProfile("op_wangming", "王明", "王明账号"),
        OperatorProfile("op_zhangsan", "张三", aliases=("张三别名",)),
      ),
    )

    rows_by_operator = {
      row["operator_id"]: row
      for row in payload["operator_daily_rows"]
    }
    self.assertEqual(
      set(rows_by_operator),
      {"op_linzhe", "op_wangming", "op_zhangsan"},
    )
    self.assertEqual(rows_by_operator["op_linzhe"]["card_exposed"], 10)
    self.assertEqual(rows_by_operator["op_wangming"]["card_exposed"], 20)
    self.assertEqual(rows_by_operator["op_zhangsan"]["card_exposed"], 30)

  def test_historical_effects_exact_operator_id_match_is_trim_only_not_casefold(self):
    payload = build_historical_effects_14d(
      target_date=date(2026, 6, 16),
      records=(
        _daily_basic_record(
          active_date=date(2026, 6, 2),
          operator_id="op_linzhe",
          card_exposed=10,
        ),
      ),
      operator_profiles=(OperatorProfile("OP_LINZHE", "林泽", "林泽"),),
    )

    self.assertEqual(payload["source_state"], "partial")
    self.assertEqual(payload["operator_daily_rows"], [])
    self.assertEqual(payload["operator_rollups"], [])

  def test_historical_effects_rejects_enabled_blank_operator_id(self):
    with self.assertRaisesRegex(ValueError, "operator_id"):
      build_historical_effects_14d(
        target_date=date(2026, 6, 16),
        records=(
          _daily_basic_record(
            active_date=date(2026, 6, 2),
            operator_id="raw_linzhe",
            operator_account_name="林泽",
            card_exposed=10,
          ),
        ),
        operator_profiles=(OperatorProfile("   ", "林泽", "林泽"),),
      )

  def test_historical_effects_rejects_duplicate_enabled_operator_ids_after_trim(self):
    with self.assertRaisesRegex(ValueError, "operator_id"):
      build_historical_effects_14d(
        target_date=date(2026, 6, 16),
        records=(),
        operator_profiles=(
          OperatorProfile("op_linzhe", "林泽", "林泽"),
          OperatorProfile(" op_linzhe ", "林泽2", "林泽2"),
        ),
      )

  def test_historical_effects_marks_partial_when_source_records_are_outside_window(self):
    payload = build_historical_effects_14d(
      target_date=date(2026, 6, 16),
      records=(
        _daily_basic_record(
          active_date=date(2026, 6, 16),
          operator_id="op_linzhe",
          card_exposed=10,
        ),
        _daily_basic_record(
          active_date=date(2026, 6, 1),
          operator_id="op_linzhe",
          card_exposed=20,
        ),
      ),
      operator_profiles=(OperatorProfile("op_linzhe", "林泽", "林泽"),),
    )

    self.assertEqual(payload["source_state"], "partial")
    self.assertEqual(payload["operator_daily_rows"], [])
    self.assertEqual(payload["operator_rollups"], [])

  def test_historical_effects_dedupes_duplicate_daily_snapshots_before_rollup(self):
    records = (
      _daily_basic_record(
        active_date=date(2026, 6, 2),
        operator_id="op_linzhe",
        card_exposed=999,
        source_row_count=99,
        total_events=999,
        recorded_at=datetime(2026, 6, 3, 0, 0, tzinfo=timezone.utc),
      ),
      _daily_basic_record(
        active_date=date(2026, 6, 2),
        operator_id="op_linzhe",
        card_exposed=20,
        source_row_count=1,
        total_events=1,
        recorded_at=datetime(2026, 6, 3, 1, 0, tzinfo=timezone.utc),
      ),
      _daily_basic_record(
        active_date=date(2026, 6, 3),
        operator_id="op_linzhe",
        card_exposed=111,
        source_row_count=1,
        total_events=999,
      ),
      _daily_basic_record(
        active_date=date(2026, 6, 3),
        operator_id="op_linzhe",
        card_exposed=30,
        source_row_count=2,
        total_events=1,
      ),
      _daily_basic_record(
        active_date=date(2026, 6, 4),
        operator_id="op_linzhe",
        card_exposed=222,
        source_row_count=3,
        total_events=1,
      ),
      _daily_basic_record(
        active_date=date(2026, 6, 4),
        operator_id="op_linzhe",
        card_exposed=40,
        source_row_count=3,
        total_events=4,
      ),
    )

    payload = build_historical_effects_14d(
      target_date=date(2026, 6, 16),
      records=records,
      operator_profiles=(OperatorProfile("op_linzhe", "林泽", "林泽"),),
    )

    self.assertEqual(len(payload["operator_daily_rows"]), 3)
    rows_by_date = {
      row["active_date"]: row
      for row in payload["operator_daily_rows"]
    }
    self.assertEqual(rows_by_date["2026-06-02"]["card_exposed"], 20)
    self.assertEqual(rows_by_date["2026-06-03"]["card_exposed"], 30)
    self.assertEqual(rows_by_date["2026-06-04"]["card_exposed"], 40)
    self.assertEqual(payload["operator_rollups"][0]["totals"]["card_exposed"], 90)

  def test_historical_effects_dedupes_tied_snapshots_deterministically(self):
    lower_fact_row = _daily_basic_record(
      active_date=date(2026, 6, 2),
      operator_id="op_linzhe",
      card_exposed=10,
      source_row_count=2,
      total_events=5,
      recorded_at=datetime(2026, 6, 3, 1, 0, tzinfo=timezone.utc),
    )
    higher_fact_row = _daily_basic_record(
      active_date=date(2026, 6, 2),
      operator_id="op_linzhe",
      card_exposed=20,
      source_row_count=2,
      total_events=5,
      recorded_at=datetime(2026, 6, 3, 1, 0, tzinfo=timezone.utc),
    )

    def chosen_card_exposed(records: tuple[DailyBasicStatsRecord, ...]) -> int:
      payload = build_historical_effects_14d(
        target_date=date(2026, 6, 16),
        records=records,
        operator_profiles=(OperatorProfile("op_linzhe", "林泽", "林泽"),),
      )
      return int(payload["operator_daily_rows"][0]["card_exposed"])

    self.assertEqual(chosen_card_exposed((lower_fact_row, higher_fact_row)), 20)
    self.assertEqual(chosen_card_exposed((higher_fact_row, lower_fact_row)), 20)

  def test_historical_effects_dedupes_rank_tied_snapshots_by_stable_visible_fields(self):
    first_row = _daily_basic_record(
      active_date=date(2026, 6, 2),
      operator_id="op_linzhe",
      boss_account_name="boss-a",
      card_exposed=10,
      source_row_count=2,
      total_events=5,
      recorded_at=datetime(2026, 6, 3, 1, 0, tzinfo=timezone.utc),
    )
    second_row = _daily_basic_record(
      active_date=date(2026, 6, 2),
      operator_id="op_linzhe",
      boss_account_name="boss-b",
      card_exposed=10,
      source_row_count=2,
      total_events=5,
      recorded_at=datetime(2026, 6, 3, 1, 0, tzinfo=timezone.utc),
    )

    def chosen_boss_account_name(records: tuple[DailyBasicStatsRecord, ...]) -> str | None:
      payload = build_historical_effects_14d(
        target_date=date(2026, 6, 16),
        records=records,
        operator_profiles=(OperatorProfile("op_linzhe", "林泽", "林泽"),),
      )
      return payload["operator_daily_rows"][0]["boss_account_name"]

    self.assertEqual(
      chosen_boss_account_name((first_row, second_row)),
      chosen_boss_account_name((second_row, first_row)),
    )

  def test_historical_effects_excludes_ambiguous_fallback_identity_but_keeps_exact_operator_id(self):
    records = (
      _daily_basic_record(
        active_date=date(2026, 6, 2),
        operator_id="raw_shared",
        operator_account_name="shared-account",
        card_exposed=999,
      ),
      _daily_basic_record(
        active_date=date(2026, 6, 2),
        operator_id="op_linzhe",
        operator_account_name="shared-account",
        card_exposed=20,
      ),
    )

    payload = build_historical_effects_14d(
      target_date=date(2026, 6, 16),
      records=records,
      operator_profiles=(
        OperatorProfile(
          "op_linzhe",
          "林泽",
          "shared-account",
          aliases=("shared-alias",),
        ),
        OperatorProfile(
          "op_wangming",
          "王明",
          "shared-account",
          aliases=("shared-alias",),
        ),
      ),
    )

    self.assertEqual(len(payload["operator_daily_rows"]), 1)
    self.assertEqual(payload["operator_daily_rows"][0]["operator_id"], "op_linzhe")
    self.assertEqual(payload["operator_daily_rows"][0]["card_exposed"], 20)

  def test_historical_effects_matches_identity_keys_with_trimmed_casefold(self):
    payload = build_historical_effects_14d(
      target_date=date(2026, 6, 16),
      records=(
        _daily_basic_record(
          active_date=date(2026, 6, 2),
          operator_id="raw_linzhe",
          operator_account_name=" linze.account ",
          card_exposed=12,
        ),
      ),
      operator_profiles=(OperatorProfile("op_linzhe", "林泽", "LINZE.ACCOUNT"),),
    )

    self.assertEqual(len(payload["operator_daily_rows"]), 1)
    self.assertEqual(payload["operator_daily_rows"][0]["operator_id"], "op_linzhe")
    self.assertEqual(payload["operator_daily_rows"][0]["card_exposed"], 12)

  def test_historical_effects_marks_not_loaded_without_enabled_operator_profiles(self):
    records = (
      _daily_basic_record(
        active_date=date(2026, 6, 2),
        operator_id="op_linzhe",
        card_exposed=10,
      ),
    )

    for operator_profiles in (
      (),
      (OperatorProfile("op_linzhe", "林泽", "林泽", enabled=False),),
    ):
      with self.subTest(operator_profiles=operator_profiles):
        payload = build_historical_effects_14d(
          target_date=date(2026, 6, 16),
          records=records,
          operator_profiles=operator_profiles,
        )

        self.assertEqual(payload["source_state"], "not_loaded")
        self.assertEqual(payload["operator_daily_rows"], [])
        self.assertEqual(payload["operator_rollups"], [])

  def test_historical_effects_ignores_disabled_blank_operator_id(self):
    payload = build_historical_effects_14d(
      target_date=date(2026, 6, 16),
      records=(
        _daily_basic_record(
          active_date=date(2026, 6, 2),
          operator_id="raw_linzhe",
          operator_account_name="林泽",
          card_exposed=10,
        ),
      ),
      operator_profiles=(OperatorProfile("   ", "林泽", "林泽", enabled=False),),
    )

    self.assertEqual(payload["source_state"], "not_loaded")
    self.assertEqual(payload["operator_daily_rows"], [])
    self.assertEqual(payload["operator_rollups"], [])

  def test_historical_effects_marks_not_loaded_when_no_source_records(self):
    payload = build_historical_effects_14d(
      target_date=date(2026, 6, 16),
      records=(),
      operator_profiles=(OperatorProfile("op_linzhe", "林泽", "林泽"),),
    )

    self.assertEqual(payload["source_state"], "not_loaded")
    self.assertEqual(payload["operator_daily_rows"], [])
    self.assertEqual(payload["operator_rollups"], [])


if __name__ == "__main__":
  unittest.main()
