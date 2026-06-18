# Daily Analysis Input Materials Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use $superpower-subagents (recommended) or $superpower-executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking via update_plan.

**Goal:** Add 14-day historical effects, 14-day operation overview, and target-day operation details to the offline daily-analysis model input packet.

**Architecture:** Keep `generate_daily_analysis.py` as the single manual entry and move input-material construction into a focused helper module. The helper module accepts already-parsed records and sanitized dictionaries, applies the operator whitelist, computes fact-only rollups, and reports source state plus data gaps without producing analysis conclusions.

**Tech Stack:** Python standard library, dataclasses, existing `DailyBasicStatsRecord`, existing `OperatorProfile`, existing `node:test`-free Python `unittest` suite, existing shell entry `./generate-daily-analysis.sh`.

---

## File Structure

- Create `src/boss_analysis/domain/daily_analysis_materials.py`
  - Owns history window calculation, operator profile indexing, historical effects rows/rollups, operation overview rows/rollups, operation details sanitization, and `source_state` calculation.
- Create `tests/test_daily_analysis_materials.py`
  - Unit tests for pure material builders and sanitizers.
- Modify `src/boss_analysis/ops/generate_daily_analysis.py`
  - Adds CLI arguments, reads source files, passes material facts into `_model_input_packet()`, and expands data-quality missing fields.
- Modify `tests/test_generate_daily_analysis_command.py`
  - Integration tests for CLI/source-file behavior and final `model_input_packet` structure.
- Modify `docs/modules/09-daily-analysis-llm-strategy.md`
  - Syncs the strategy doc with the new fact sections.
- Modify `README.md`
  - Documents the new source-file flags and the production SearchLog boundary.
- Update `docs/ai-worklog.md`
  - Record each implementation phase and verification result.

---

## Task 1: Pure Material Builders For 14-Day Historical Effects

**Files:**
- Create: `src/boss_analysis/domain/daily_analysis_materials.py`
- Create: `tests/test_daily_analysis_materials.py`
- Modify: `docs/ai-worklog.md`

- [ ] **Step 1: Add the failing historical window and filtering tests**

Add this test file:

```python
from __future__ import annotations

import unittest
from datetime import date, datetime, timezone

from boss_analysis.domain.daily_analysis_materials import (
  build_historical_effects_14d,
  historical_window_14d,
)
from boss_analysis.domain.operators import OperatorProfile
from boss_analysis.domain.summary import DailyBasicStatsRecord


class DailyAnalysisMaterialsTests(unittest.TestCase):
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
    )

    payload = build_historical_effects_14d(
      target_date=date(2026, 6, 16),
      records=records,
      operator_profiles=(OperatorProfile("op_linzhe", "林泽", "林泽"),),
    )

    self.assertEqual(payload["source_state"], "partial")
    self.assertEqual(payload["window"]["start_date"], "2026-06-02")
    self.assertEqual(payload["window"]["end_date"], "2026-06-15")
    self.assertEqual(len(payload["operator_daily_rows"]), 1)
    self.assertEqual(payload["operator_daily_rows"][0]["operator_id"], "op_linzhe")
    self.assertEqual(payload["operator_daily_rows"][0]["active_date"], "2026-06-02")
    self.assertEqual(payload["operator_daily_rows"][0]["card_exposed"], 100)
    self.assertEqual(payload["operator_daily_rows"][0]["detail_opened"], 30)
    self.assertEqual(payload["operator_daily_rows"][0]["greeting_succeeded"], 18)
    self.assertEqual(payload["operator_rollups"][0]["operator_id"], "op_linzhe")
    self.assertEqual(payload["operator_rollups"][0]["covered_days"], 1)
    self.assertEqual(payload["operator_rollups"][0]["totals"]["card_exposed"], 100)
    self.assertEqual(payload["operator_rollups"][0]["daily_averages"]["card_exposed"], 100.0)

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
```

- [ ] **Step 2: Run the new tests and verify the expected failure**

Run:

```bash
env PYTHONPATH=src python3 -m unittest tests.test_daily_analysis_materials -v
```

Expected: fail with `ModuleNotFoundError: No module named 'boss_analysis.domain.daily_analysis_materials'`.

- [ ] **Step 3: Implement the minimal material builder**

Create `src/boss_analysis/domain/daily_analysis_materials.py` with:

```python
"""Fact-only input materials for offline daily analysis."""

from __future__ import annotations

from collections.abc import Iterable, Mapping
from datetime import date, timedelta
from typing import Any

from boss_analysis.domain.operators import OperatorProfile
from boss_analysis.domain.summary import DailyBasicStatsRecord

HISTORICAL_DAYS = 14

DAILY_BASIC_FACT_FIELDS: tuple[str, ...] = (
  "active_minutes",
  "active_seconds",
  "observed_minutes",
  "session_count",
  "touched_job_count",
  "card_exposed",
  "detail_opened",
  "detail_closed",
  "greeting_clicked",
  "greeting_succeeded",
  "greeting_failed",
  "chat_opened",
  "boss_reply_count",
  "wechat_captured",
  "capture_failed",
  "card_unique_candidates",
  "detail_unique_candidates",
  "greeting_unique_candidates",
  "chat_unique_candidates",
  "wechat_unique_candidates",
  "visible_message_count",
  "may_be_incomplete_count",
  "first_round_candidate_initiated_count",
  "first_round_boss_replied_count",
  "chat_conversation_count",
  "boss_ended_conversation_count",
  "total_events",
  "source_row_count",
)


def historical_window_14d(target_date: date) -> dict[str, Any]:
  start_date = target_date - timedelta(days=HISTORICAL_DAYS)
  end_date = target_date - timedelta(days=1)
  return {
    "start_date": start_date.isoformat(),
    "end_date": end_date.isoformat(),
    "days": HISTORICAL_DAYS,
    "includes_target_date": False,
  }


def build_historical_effects_14d(
  *,
  target_date: date,
  records: Iterable[DailyBasicStatsRecord],
  operator_profiles: Iterable[OperatorProfile],
) -> dict[str, Any]:
  window = historical_window_14d(target_date)
  profile_index = operator_profile_index(operator_profiles)
  source_records = tuple(records)
  daily_rows = [
    _daily_basic_row(record, profile)
    for record in source_records
    if _date_in_window(record.active_date, window)
    for profile in [_profile_for_operator(profile_index, record.operator_id)]
    if profile is not None
  ]
  daily_rows.sort(key=lambda item: (item["operator_id"], item["active_date"]))
  return {
    "source_state": _source_state(
      source_count=len(source_records),
      row_count=len(daily_rows),
      expected_days=HISTORICAL_DAYS,
      covered_days={str(item["active_date"]) for item in daily_rows},
    ),
    "window": window,
    "operator_daily_rows": daily_rows,
    "operator_rollups": _rollup_daily_rows(daily_rows),
  }


def operator_profile_index(
  operator_profiles: Iterable[OperatorProfile],
) -> dict[str, OperatorProfile]:
  index: dict[str, OperatorProfile] = {}
  for profile in operator_profiles:
    if not profile.enabled:
      continue
    for value in (profile.operator_id, profile.display_name, profile.account_name, *profile.aliases):
      text = _clean_string(value)
      if text:
        index.setdefault(text, profile)
  return index


def _profile_for_operator(
  profile_index: Mapping[str, OperatorProfile],
  value: Any,
) -> OperatorProfile | None:
  return profile_index.get(_clean_string(value))


def _date_in_window(value: date, window: Mapping[str, Any]) -> bool:
  return str(window["start_date"]) <= value.isoformat() <= str(window["end_date"])


def _daily_basic_row(
  record: DailyBasicStatsRecord,
  profile: OperatorProfile,
) -> dict[str, Any]:
  row: dict[str, Any] = {
    "active_date": record.active_date.isoformat(),
    "operator_id": profile.operator_id,
    "display_name": profile.display_name,
    "operator_account_name": record.operator_account_name,
    "boss_account_name": record.boss_account_name,
    "boss_account_matched": record.boss_account_matched,
    "first_active_minute": record.first_active_minute.isoformat() if record.first_active_minute else None,
    "last_active_minute": record.last_active_minute.isoformat() if record.last_active_minute else None,
    "recorded_at": record.recorded_at.isoformat() if record.recorded_at else None,
  }
  for field_name in DAILY_BASIC_FACT_FIELDS:
    row[field_name] = int(getattr(record, field_name, 0) or 0)
  return row


def _rollup_daily_rows(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
  by_operator: dict[str, list[dict[str, Any]]] = {}
  for row in rows:
    by_operator.setdefault(str(row["operator_id"]), []).append(row)
  rollups: list[dict[str, Any]] = []
  for operator_id, operator_rows in sorted(by_operator.items()):
    totals = {
      field_name: sum(int(row.get(field_name, 0) or 0) for row in operator_rows)
      for field_name in DAILY_BASIC_FACT_FIELDS
    }
    covered_days = len({str(row["active_date"]) for row in operator_rows})
    daily_averages = {
      field_name: round(total / covered_days, 2) if covered_days else 0.0
      for field_name, total in totals.items()
    }
    rollups.append({
      "operator_id": operator_id,
      "display_name": str(operator_rows[0]["display_name"]),
      "covered_days": covered_days,
      "totals": totals,
      "daily_averages": daily_averages,
    })
  return rollups


def _source_state(
  *,
  source_count: int,
  row_count: int,
  expected_days: int,
  covered_days: set[str],
) -> str:
  if source_count == 0:
    return "not_loaded"
  if row_count == 0:
    return "partial"
  if len(covered_days) < expected_days:
    return "partial"
  return "loaded"


def _clean_string(value: Any) -> str:
  if value is None:
    return ""
  return str(value).strip()
```

- [ ] **Step 4: Run material tests and verify green**

Run:

```bash
env PYTHONPATH=src python3 -m unittest tests.test_daily_analysis_materials -v
```

Expected: 3 tests pass.

- [ ] **Step 5: Record the checkpoint**

Append to `docs/ai-worklog.md`:

```markdown
#### 阶段记录：已实现 14 天历史效果素材构建

- 时间：执行时运行 `date '+%Y-%m-%d %H:%M %Z'` 并填入输出值。
- 状态：已完成。
- 已完成：新增 `daily_analysis_materials.py`，支持不含当天的 14 天窗口、配置白名单过滤、日级事实行和 rollup。
- 改动文件：`src/boss_analysis/domain/daily_analysis_materials.py`、`tests/test_daily_analysis_materials.py`、`docs/ai-worklog.md`
- 当前验证结果：`env PYTHONPATH=src python3 -m unittest tests.test_daily_analysis_materials -v` 通过。
- 中断续写入口：继续 Task 2，接操作概览素材。
```

---

## Task 2: Operation Overview 14-Day Builder

**Files:**
- Modify: `src/boss_analysis/domain/daily_analysis_materials.py`
- Modify: `tests/test_daily_analysis_materials.py`
- Modify: `docs/ai-worklog.md`

- [ ] **Step 1: Add failing operation overview tests**

Append to `DailyAnalysisMaterialsTests`:

```python
  def test_operation_overview_filters_and_rolls_up_rows(self):
    rows = (
      {
        "active_date": "2026-06-02",
        "operator_id": "op_linzhe",
        "detail_open_count": 10,
        "greeting_count": 7,
        "chat_open_count": 3,
        "chat_reply_count": 2,
        "job_operation_count": 1,
        "active_minutes": 30,
        "source_event_count": 53,
      },
      {
        "active_date": "2026-06-16",
        "operator_id": "op_linzhe",
        "detail_open_count": 999,
      },
      {
        "active_date": "2026-06-02",
        "operator_id": "op_other",
        "detail_open_count": 999,
      },
    )

    payload = build_operation_overview_14d(
      target_date=date(2026, 6, 16),
      rows=rows,
      operator_profiles=(OperatorProfile("op_linzhe", "林泽", "林泽"),),
    )

    self.assertEqual(payload["source_state"], "partial")
    self.assertEqual(len(payload["operator_daily_rows"]), 1)
    self.assertEqual(payload["operator_daily_rows"][0]["operator_id"], "op_linzhe")
    self.assertEqual(payload["operator_daily_rows"][0]["detail_open_count"], 10)
    self.assertEqual(payload["operator_rollups"][0]["totals"]["source_event_count"], 53)
```

Add this import:

```python
  build_operation_overview_14d,
```

- [ ] **Step 2: Run and verify failure**

Run:

```bash
env PYTHONPATH=src python3 -m unittest tests.test_daily_analysis_materials.DailyAnalysisMaterialsTests.test_operation_overview_filters_and_rolls_up_rows -v
```

Expected: fail with `ImportError` or `NameError` for `build_operation_overview_14d`.

- [ ] **Step 3: Implement operation overview builder**

Add to `daily_analysis_materials.py`:

```python
OPERATION_OVERVIEW_FIELDS: tuple[str, ...] = (
  "detail_open_count",
  "greeting_count",
  "chat_open_count",
  "chat_reply_count",
  "job_operation_count",
  "active_minutes",
  "source_event_count",
)


def build_operation_overview_14d(
  *,
  target_date: date,
  rows: Iterable[Mapping[str, Any]],
  operator_profiles: Iterable[OperatorProfile],
) -> dict[str, Any]:
  window = historical_window_14d(target_date)
  profile_index = operator_profile_index(operator_profiles)
  source_rows = tuple(rows)
  daily_rows = [
    _operation_overview_row(row, profile)
    for row in source_rows
    if _date_text_in_window(_clean_string(row.get("active_date")), window)
    for profile in [_profile_for_operator(
      profile_index,
      row.get("operator_id") or row.get("display_name") or row.get("boss_name"),
    )]
    if profile is not None
  ]
  daily_rows.sort(key=lambda item: (item["operator_id"], item["active_date"]))
  return {
    "source_state": _source_state(
      source_count=len(source_rows),
      row_count=len(daily_rows),
      expected_days=HISTORICAL_DAYS,
      covered_days={str(item["active_date"]) for item in daily_rows},
    ),
    "window": window,
    "operator_daily_rows": daily_rows,
    "operator_rollups": _rollup_rows(daily_rows, OPERATION_OVERVIEW_FIELDS),
  }


def _operation_overview_row(
  row: Mapping[str, Any],
  profile: OperatorProfile,
) -> dict[str, Any]:
  output: dict[str, Any] = {
    "active_date": _clean_string(row.get("active_date")),
    "operator_id": profile.operator_id,
    "display_name": profile.display_name,
    "source_state": _clean_string(row.get("source_state")) or "loaded",
  }
  for field_name in OPERATION_OVERVIEW_FIELDS:
    output[field_name] = _int_value(row.get(field_name))
  return output


def _rollup_rows(
  rows: list[dict[str, Any]],
  fields: tuple[str, ...],
) -> list[dict[str, Any]]:
  by_operator: dict[str, list[dict[str, Any]]] = {}
  for row in rows:
    by_operator.setdefault(str(row["operator_id"]), []).append(row)
  rollups: list[dict[str, Any]] = []
  for operator_id, operator_rows in sorted(by_operator.items()):
    totals = {
      field_name: sum(_int_value(row.get(field_name)) for row in operator_rows)
      for field_name in fields
    }
    covered_days = len({str(row["active_date"]) for row in operator_rows})
    rollups.append({
      "operator_id": operator_id,
      "display_name": str(operator_rows[0]["display_name"]),
      "covered_days": covered_days,
      "totals": totals,
      "daily_averages": {
        field_name: round(total / covered_days, 2) if covered_days else 0.0
        for field_name, total in totals.items()
      },
    })
  return rollups


def _date_text_in_window(value: str, window: Mapping[str, Any]) -> bool:
  return bool(value) and str(window["start_date"]) <= value <= str(window["end_date"])


def _int_value(value: Any) -> int:
  if isinstance(value, bool):
    return int(value)
  if isinstance(value, (int, float)):
    return int(value)
  if isinstance(value, str) and value.strip():
    try:
      return int(float(value.strip()))
    except ValueError:
      return 0
  return 0
```

Refactor `_rollup_daily_rows()` to call `_rollup_rows(rows, DAILY_BASIC_FACT_FIELDS)` and keep the existing test green.

- [ ] **Step 4: Run material tests**

Run:

```bash
env PYTHONPATH=src python3 -m unittest tests.test_daily_analysis_materials -v
```

Expected: all material tests pass.

- [ ] **Step 5: Record the checkpoint**

Append a phase record to `docs/ai-worklog.md` noting Task 2 completion and the exact test command.

---

## Task 3: Operation Details Sanitizer

**Files:**
- Modify: `src/boss_analysis/domain/daily_analysis_materials.py`
- Modify: `tests/test_daily_analysis_materials.py`
- Modify: `docs/ai-worklog.md`

- [ ] **Step 1: Add failing sanitizer tests**

Append to `DailyAnalysisMaterialsTests`:

```python
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
            "occurred_at": "2026-06-15T10:00:00+08:00",
            "operator_id": "op_linzhe",
            "source_event_id": "evt_old",
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
    self.assertEqual(len(payload["detail_open_events"]), 1)
    encoded = json.dumps(payload, ensure_ascii=False)
    self.assertIn("cand_1", encoded)
    self.assertNotIn("13800000000", encoded)
    self.assertNotIn("不要进入模型", encoded)

  def test_operation_details_marks_not_loaded_for_empty_input(self):
    payload = build_operation_details(
      target_date=date(2026, 6, 16),
      value=None,
      operator_profiles=(OperatorProfile("op_linzhe", "林泽", "林泽"),),
    )

    self.assertEqual(payload["source_state"], "not_loaded")
    self.assertEqual(payload["detail_open_events"], [])
    self.assertIn("operation_details", payload["data_gaps"])
```

Add imports:

```python
import json
```

```python
  build_operation_details,
```

- [ ] **Step 2: Run and verify failure**

Run:

```bash
env PYTHONPATH=src python3 -m unittest tests.test_daily_analysis_materials.DailyAnalysisMaterialsTests.test_operation_details_filters_to_target_date_and_removes_sensitive_fields -v
```

Expected: fail because `build_operation_details` is missing.

- [ ] **Step 3: Implement operation details sanitizer**

Add to `daily_analysis_materials.py`:

```python
DETAIL_COLLECTIONS: tuple[str, ...] = (
  "detail_open_events",
  "greeting_events",
  "chat_progress_events",
  "job_operation_events",
  "timeline_windows",
)

ALLOWED_DETAIL_FIELDS: dict[str, tuple[str, ...]] = {
  "detail_open_events": ("occurred_at", "operator_id", "job_key", "candidate_local_id", "source_event_id"),
  "greeting_events": ("occurred_at", "operator_id", "job_key", "result_state", "source_event_id"),
  "chat_progress_events": ("occurred_at", "operator_id", "job_key", "progress_state", "source_event_id"),
  "job_operation_events": ("occurred_at", "operator_id", "job_key", "operation", "source_event_id"),
  "timeline_windows": ("window_start", "window_end", "operator_id", "job_key", "operation_counts", "source_event_ids"),
}


def build_operation_details(
  *,
  target_date: date,
  value: Mapping[str, Any] | None,
  operator_profiles: Iterable[OperatorProfile],
) -> dict[str, Any]:
  if value is None:
    return _empty_operation_details(target_date, source_state="not_loaded", data_gaps=["operation_details"])
  profile_index = operator_profile_index(operator_profiles)
  output = _empty_operation_details(target_date, source_state="loaded", data_gaps=[])
  kept_count = 0
  source_count = 0
  for collection in DETAIL_COLLECTIONS:
    raw_items = value.get(collection, [])
    if not isinstance(raw_items, list):
      output["data_gaps"].append(f"operation_details.{collection}")
      continue
    for raw_item in raw_items:
      if not isinstance(raw_item, Mapping):
        continue
      source_count += 1
      sanitized = _sanitize_detail_item(collection, raw_item)
      if not _detail_item_matches_date(sanitized, target_date):
        continue
      profile = _profile_for_operator(profile_index, sanitized.get("operator_id"))
      if profile is None:
        continue
      sanitized["operator_id"] = profile.operator_id
      output[collection].append(sanitized)
      kept_count += 1
  if source_count > 0 and kept_count == 0:
    output["source_state"] = "partial"
  return output


def _empty_operation_details(
  target_date: date,
  *,
  source_state: str,
  data_gaps: list[str],
) -> dict[str, Any]:
  return {
    "source_state": source_state,
    "target_date": target_date.isoformat(),
    "detail_open_events": [],
    "greeting_events": [],
    "chat_progress_events": [],
    "job_operation_events": [],
    "timeline_windows": [],
    "data_gaps": list(data_gaps),
  }


def _sanitize_detail_item(
  collection: str,
  raw_item: Mapping[str, Any],
) -> dict[str, Any]:
  allowed = ALLOWED_DETAIL_FIELDS[collection]
  return {
    field_name: raw_item.get(field_name)
    for field_name in allowed
    if raw_item.get(field_name) is not None
  }


def _detail_item_matches_date(item: Mapping[str, Any], target_date: date) -> bool:
  value = _clean_string(item.get("occurred_at") or item.get("window_start"))
  return value[:10] == target_date.isoformat()
```

- [ ] **Step 4: Run material tests**

Run:

```bash
env PYTHONPATH=src python3 -m unittest tests.test_daily_analysis_materials -v
```

Expected: all material tests pass.

- [ ] **Step 5: Record the checkpoint**

Append a phase record to `docs/ai-worklog.md` noting sanitizer behavior and test result.

---

## Task 4: Integrate Materials Into Offline Generator And CLI

**Files:**
- Modify: `src/boss_analysis/ops/generate_daily_analysis.py`
- Modify: `tests/test_generate_daily_analysis_command.py`
- Modify: `docs/ai-worklog.md`

- [ ] **Step 1: Add failing generator integration test**

In `tests/test_generate_daily_analysis_command.py`, add imports:

```python
from boss_analysis.domain.summary import DailyBasicStatsRecord
```

Add this test:

```python
  def test_generation_includes_historical_effects_operation_overview_and_details(self):
    target_date = date(2026, 6, 16)
    source = FakeOfficialResultsSource(OfficialResultsBatch(
      target_date=target_date,
      operator_rows=(
        map_operator_row({"bossName": "林泽", "detailGeek": 120, "activeAdd": 31}, target_date),
      ),
      job_rows=(),
    ))
    historical_records = (
      DailyBasicStatsRecord(
        metric_name="boss_daily_operator_basic_stats",
        active_date=date(2026, 6, 2),
        operator_id="op_linzhe",
        card_exposed=100,
        detail_opened=20,
        greeting_succeeded=10,
      ),
    )
    operation_overview_rows = (
      {
        "active_date": "2026-06-02",
        "operator_id": "op_linzhe",
        "detail_open_count": 20,
        "greeting_count": 10,
        "source_event_count": 30,
      },
    )
    operation_details = {
      "detail_open_events": [{
        "occurred_at": "2026-06-16T10:00:00+08:00",
        "operator_id": "op_linzhe",
        "candidate_local_id": "cand_1",
        "source_event_id": "evt_1",
      }],
    }
    with tempfile.TemporaryDirectory() as tmpdir:
      generate_daily_analysis.run_daily_analysis_generation(
        target_date=target_date,
        source=source,
        output_dir=tmpdir,
        operator_profiles=(OperatorProfile("op_linzhe", "林泽", "林泽"),),
        historical_effect_records=historical_records,
        operation_overview_rows=operation_overview_rows,
        operation_details_value=operation_details,
      )

      payload = load_daily_analysis_result(
        analysis_date=target_date,
        results_dir=tmpdir,
      )

    facts = payload["model_input_packet"]["facts"]
    self.assertEqual(facts["historical_effects_14d"]["window"]["start_date"], "2026-06-02")
    self.assertEqual(facts["historical_effects_14d"]["window"]["end_date"], "2026-06-15")
    self.assertEqual(facts["historical_effects_14d"]["operator_rollups"][0]["operator_id"], "op_linzhe")
    self.assertEqual(facts["operation_overview_14d"]["operator_rollups"][0]["totals"]["source_event_count"], 30)
    self.assertEqual(facts["operation_details"]["source_state"], "loaded")
    self.assertEqual(facts["operation_details"]["detail_open_events"][0]["source_event_id"], "evt_1")
    self.assertNotIn("historical_effects_14d", payload["data_quality"]["missing_fields"])
    self.assertNotIn("operation_overview_14d", payload["data_quality"]["missing_fields"])
```

- [ ] **Step 2: Run and verify failure**

Run:

```bash
env PYTHONPATH=src python3 -m unittest tests.test_generate_daily_analysis_command.GenerateDailyAnalysisTests.test_generation_includes_historical_effects_operation_overview_and_details -v
```

Expected: fail because `run_daily_analysis_generation()` does not accept the new keyword arguments.

- [ ] **Step 3: Integrate material builders**

In `generate_daily_analysis.py`, add imports:

```python
from boss_analysis.consumer.summary_reader import iter_daily_basic_summaries_from_file
from boss_analysis.domain.daily_analysis_materials import (
  build_historical_effects_14d,
  build_operation_details,
  build_operation_overview_14d,
)
from boss_analysis.domain.summary import DailyBasicStatsRecord
```

Change `run_daily_analysis_generation()` signature:

```python
def run_daily_analysis_generation(
  *,
  target_date: date,
  source: OfficialResultsSource,
  output_dir: str | Path,
  generated_at: datetime | None = None,
  dry_run: bool = False,
  official_result_source: str = "official_results_source",
  operator_profiles: Iterable[OperatorProfile] = (),
  historical_effect_records: Iterable[DailyBasicStatsRecord] = (),
  operation_overview_rows: Iterable[Mapping[str, Any]] = (),
  operation_details_value: Mapping[str, Any] | None = None,
) -> DailyAnalysisGenerationResult:
```

When calling `build_offline_daily_analysis_payload()`, pass the new values:

```python
    historical_effect_records=tuple(historical_effect_records),
    operation_overview_rows=tuple(operation_overview_rows),
    operation_details_value=operation_details_value,
```

Change `build_offline_daily_analysis_payload()` signature to accept the same new values, then construct:

```python
  historical_effects = build_historical_effects_14d(
    target_date=batch.target_date,
    records=historical_effect_records,
    operator_profiles=profiles,
  )
  operation_overview = build_operation_overview_14d(
    target_date=batch.target_date,
    rows=operation_overview_rows,
    operator_profiles=profiles,
  )
  operation_details = build_operation_details(
    target_date=batch.target_date,
    value=operation_details_value,
    operator_profiles=profiles,
  )
```

Pass these into `_data_quality()` and `_model_input_packet()`.

Update `_model_input_packet()` facts:

```python
      "historical_effects_14d": historical_effects,
      "operation_overview_14d": operation_overview,
      "operation_details": operation_details,
```

Update `_data_quality()` signature:

```python
def _data_quality(
  operator_results: list[dict[str, Any]],
  job_results: list[dict[str, Any]],
  *,
  historical_effects: Mapping[str, Any],
  operation_overview: Mapping[str, Any],
  operation_details: Mapping[str, Any],
) -> dict[str, list[str]]:
```

Set missing fields with:

```python
  missing_fields = ["model_analysis"]
  if historical_effects.get("source_state") != "loaded":
    missing_fields.append("historical_effects_14d")
  if operation_overview.get("source_state") != "loaded":
    missing_fields.append("operation_overview_14d")
  if operation_details.get("source_state") != "loaded":
    missing_fields.append("operation_details")
  for gap in operation_details.get("data_gaps", []):
    if isinstance(gap, str) and gap not in missing_fields:
      missing_fields.append(gap)
```

- [ ] **Step 4: Add CLI file readers**

Add parser arguments:

```python
  parser.add_argument("--daily-basic-source-file", help="JSON/JSONL daily basic stats source for the 14-day history window.")
  parser.add_argument("--operation-overview-source-file", help="JSON/JSONL operation overview source for the 14-day history window.")
  parser.add_argument("--operation-details-source-file", help="JSON operation details source for the target date.")
```

Add helper functions:

```python
def _operation_rows_from_file(path: str | None) -> tuple[Mapping[str, Any], ...]:
  if not path:
    return ()
  value = json.loads(Path(path).read_text(encoding="utf-8"))
  if isinstance(value, dict) and isinstance(value.get("rows"), list):
    return tuple(item for item in value["rows"] if isinstance(item, Mapping))
  if isinstance(value, list):
    return tuple(item for item in value if isinstance(item, Mapping))
  return ()


def _operation_details_from_file(path: str | None) -> Mapping[str, Any] | None:
  if not path:
    return None
  value = json.loads(Path(path).read_text(encoding="utf-8"))
  return value if isinstance(value, Mapping) else None
```

In `main()`, before `run_daily_analysis_generation()`:

```python
    historical_effect_records = tuple(iter_daily_basic_summaries_from_file(args.daily_basic_source_file)) if args.daily_basic_source_file else ()
    operation_overview_rows = _operation_rows_from_file(args.operation_overview_source_file)
    operation_details_value = _operation_details_from_file(args.operation_details_source_file)
```

Pass these values into `run_daily_analysis_generation()`.

- [ ] **Step 5: Run integration tests**

Run:

```bash
env PYTHONPATH=src python3 -m unittest tests.test_daily_analysis_materials tests.test_generate_daily_analysis_command -v
```

Expected: material and generator tests pass.

- [ ] **Step 6: Record the checkpoint**

Append a phase record to `docs/ai-worklog.md` with the command output summary.

---

## Task 5: CLI Source-File Tests And Documentation

**Files:**
- Modify: `tests/test_generate_daily_analysis_command.py`
- Modify: `README.md`
- Modify: `docs/modules/09-daily-analysis-llm-strategy.md`
- Modify: `docs/ai-worklog.md`

- [ ] **Step 1: Add failing CLI source-file test**

In `test_main_reads_source_file_and_writes_result_summary`, extend the temp setup:

```python
      daily_basic_file = Path(tmpdir) / "daily-basic.json"
      operation_overview_file = Path(tmpdir) / "operation-overview.json"
      operation_details_file = Path(tmpdir) / "operation-details.json"
      daily_basic_file.write_text(json.dumps([{
        "metric_name": "boss_daily_operator_basic_stats",
        "active_date": "2026-06-02",
        "operator_id": "op_linzhe",
        "card_exposed": 100,
        "detail_opened": 20,
        "greeting_succeeded": 10,
      }], ensure_ascii=False), encoding="utf-8")
      operation_overview_file.write_text(json.dumps({
        "rows": [{
          "active_date": "2026-06-02",
          "operator_id": "op_linzhe",
          "detail_open_count": 20,
          "greeting_count": 10,
          "source_event_count": 30,
        }]
      }, ensure_ascii=False), encoding="utf-8")
      operation_details_file.write_text(json.dumps({
        "detail_open_events": [{
          "occurred_at": "2026-06-16T10:00:00+08:00",
          "operator_id": "op_linzhe",
          "candidate_local_id": "cand_1",
          "source_event_id": "evt_1",
        }]
      }, ensure_ascii=False), encoding="utf-8")
```

Add CLI args:

```python
          "--daily-basic-source-file",
          str(daily_basic_file),
          "--operation-overview-source-file",
          str(operation_overview_file),
          "--operation-details-source-file",
          str(operation_details_file),
```

After summary assertions, load the output JSON and assert:

```python
      payload = load_daily_analysis_result(
        analysis_date=date(2026, 6, 16),
        results_dir=output_dir,
      )
      self.assertEqual(payload["model_input_packet"]["facts"]["historical_effects_14d"]["source_state"], "partial")
      self.assertEqual(payload["model_input_packet"]["facts"]["operation_overview_14d"]["source_state"], "partial")
      self.assertEqual(payload["model_input_packet"]["facts"]["operation_details"]["source_state"], "loaded")
```

- [ ] **Step 2: Run and verify failure, then use Task 4 implementation to pass**

Run:

```bash
env PYTHONPATH=src python3 -m unittest tests.test_generate_daily_analysis_command.GenerateDailyAnalysisTests.test_main_reads_source_file_and_writes_result_summary -v
```

Expected before implementation: fail because CLI args are unknown. Expected after Task 4: pass.

- [ ] **Step 3: Update README**

In the "日常分析离线结果" section, add:

```markdown
如果要把大模型输入素材补全，可以显式提供前 14 天效果数据、操作概览和操作明细文件：

```bash
./generate-daily-analysis.sh 2026-06-16 \
  --daily-basic-source-file /path/to/daily-basic-stats.json \
  --operation-overview-source-file /path/to/operation-overview.json \
  --operation-details-source-file /path/to/operation-details.json
```

前 14 天窗口不包含分析当天，例如 `2026-06-16` 的历史窗口为 `2026-06-02` 到 `2026-06-15`。生产生成链路不得为了补齐这些素材调用 CLS Search/SearchLog；应使用已批准的同步结果、文件、数据库或指标 topic 读取路径。
```

- [ ] **Step 4: Update LLM strategy doc**

In `docs/modules/09-daily-analysis-llm-strategy.md`, add `historical_effects_14d` and `operation_overview_14d` to the input evidence list and state that they are fact-only and cannot contain local conclusions.

Use this exact text:

```markdown
- `historical_effects_14d`：分析日前 14 天效果事实，不包含分析当天，只能包含日级事实行和事实 rollup。
- `operation_overview_14d`：分析日前 14 天操作概览事实，不包含分析当天，只能包含动作计数、覆盖天数和来源状态。
```

- [ ] **Step 5: Run docs and test verification**

Run:

```bash
env PYTHONPATH=src python3 -m unittest tests.test_daily_analysis_materials tests.test_generate_daily_analysis_command tests.test_daily_analysis -v
python3 -m py_compile src/boss_analysis/domain/daily_analysis_materials.py src/boss_analysis/ops/generate_daily_analysis.py
git diff --check -- src/boss_analysis/domain/daily_analysis_materials.py src/boss_analysis/ops/generate_daily_analysis.py tests/test_daily_analysis_materials.py tests/test_generate_daily_analysis_command.py README.md docs/modules/09-daily-analysis-llm-strategy.md docs/ai-worklog.md
```

Expected: all commands exit 0.

- [ ] **Step 6: Record task completion**

Append to `docs/ai-worklog.md`:

```markdown
#### 任务完成：日常分析输入素材升级已实现

- 时间：执行时运行 `date '+%Y-%m-%d %H:%M %Z'` 并填入输出值。
- 状态：已完成。
- 已完成：离线生成器支持前 14 天效果数据、14 天操作概览和当天操作明细进入 `model_input_packet`；缺失素材以 `source_state` 和 `data_quality.missing_fields` 表达。
- 改动文件：列出本任务实际改动文件。
- 当前验证结果：列出测试、编译和 diff check 结果。
- 中断续写入口：下一步可接真实大模型调用和模型输出校验。
```

---

## Verification

Final verification before reporting completion:

```bash
env PYTHONPATH=src python3 -m unittest tests.test_daily_analysis_materials tests.test_generate_daily_analysis_command tests.test_daily_analysis tests.test_dev_server tests.test_sync_official_results_command tests.test_official_results_sync -v
python3 -m py_compile src/boss_analysis/domain/daily_analysis_materials.py src/boss_analysis/ops/generate_daily_analysis.py
cd frontend && npm run build
git diff --check -- src/boss_analysis/domain/daily_analysis_materials.py src/boss_analysis/ops/generate_daily_analysis.py tests/test_daily_analysis_materials.py tests/test_generate_daily_analysis_command.py README.md docs/modules/09-daily-analysis-llm-strategy.md docs/ai-worklog.md
```

Expected:

- Python tests exit 0.
- `py_compile` exits 0.
- Frontend build exits 0.
- `git diff --check` exits 0.

Because the current workspace is shared and already dirty, do not create commits unless the user explicitly requests it. If working in an isolated branch with a clean scope, commit after each task using focused paths only.
