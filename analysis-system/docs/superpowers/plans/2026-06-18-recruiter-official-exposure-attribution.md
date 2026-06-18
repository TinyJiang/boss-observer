# Recruiter Official Exposure Attribution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use $superpower-subagents (recommended) or $superpower-executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking via update_plan.

**Goal:** Add fact-only recruiter-level official exposure materials and training sample rows so later attribution work uses BOSS official candidate-side job exposure, not plugin card exposure.

**Architecture:** Keep official exposure handling in a pure domain module that reads already-mapped `OfficialResultsBatch` rows. Wire its outputs into the existing offline daily-analysis `model_input_packet` as facts only; local code computes baselines and feature rows but does not produce causes, confidence, recommendations, or performance judgments.

**Tech Stack:** Python 3.11, dataclasses, `node:test` is not involved, existing `unittest` test suite, existing `OfficialResultsBatch`, existing daily-analysis JSON writer.

---

## File Structure

- Create `src/boss_analysis/domain/official_exposure.py`
  - Extract official exposure counts from `OfficialResultRow.fields` and `OfficialResultRow.extra_source_fields`.
  - Build current-day recruiter totals and job breakdowns.
  - Build 14-day official exposure history from file rows.
  - Build fact-only recruiter daily exposure feature rows.
- Create `tests/test_official_exposure.py`
  - Unit tests for extraction, recruiter rollup, job breakdown, history, and feature rows.
- Modify `src/boss_analysis/ops/generate_daily_analysis.py`
  - Call the new builders.
  - Add `--official-exposure-history-file`.
  - Add new facts to `model_input_packet`.
  - Mark missing official exposure materials in `data_quality.missing_fields`.
- Modify `tests/test_generate_daily_analysis_command.py`
  - Integration coverage for generated daily-analysis JSON and CLI file input.
- Modify `docs/modules/09-daily-analysis-llm-strategy.md`
  - Document the new fact-only inputs and model constraints.
- Modify `docs/superpowers/specs/2026-06-18-recruiter-official-exposure-attribution-design.md`
  - Add implementation status once code is complete.
- Modify `docs/ai-worklog.md`
  - Append task start, stage, validation, and completion records.

## Implementation Tasks

### Task 1: Pure Official Exposure Builders

**Files:**
- Create: `src/boss_analysis/domain/official_exposure.py`
- Create: `tests/test_official_exposure.py`
- Modify: `docs/ai-worklog.md`

- [ ] **Step 1: Append task start record**

Add a new section to `docs/ai-worklog.md`:

```markdown
### 任务：官方曝光事实材料构建

- 时间：先运行 `date '+%Y-%m-%d %H:%M %Z'`，粘贴命令输出
- 执行者：Codex
- 状态：实现中
- 目标：新增纯函数模块，把 BOSS 官方结果中的候选人侧曝光转成招聘人级总量、岗位拆解、14 天历史和训练特征事实。
- 当前理解：官方曝光字段可能来自 `fields` 或 `extra_source_fields`；缺字段不能按 0 处理，必须标记数据缺口。
- 计划修改文件：
  - `src/boss_analysis/domain/official_exposure.py`
  - `tests/test_official_exposure.py`
  - `docs/ai-worklog.md`
- 不修改范围：
  - 不修改飞书表结构、官方同步映射、生产 SQL、CLS 任务或 Chrome 插件。
  - 不输出归因结论、置信度、绩效判断或候选人质量评分。
- 验证计划：`env PYTHONPATH=src python3 -m unittest tests.test_official_exposure -v`
- 当前状态：准备先写失败测试。
```

- [ ] **Step 2: Write failing tests for current-day official exposure**

Create `tests/test_official_exposure.py` with:

```python
from __future__ import annotations

import unittest
from datetime import date

from boss_analysis.domain.official_exposure import (
  build_official_exposure_summary,
)
from boss_analysis.domain.operators import OperatorProfile
from boss_analysis.official_results.models import OfficialResultsBatch
from boss_analysis.official_results.sync import map_job_row, map_operator_row


class OfficialExposureTests(unittest.TestCase):
  def test_summary_prefers_operator_total_and_keeps_job_breakdown(self):
    target_date = date(2026, 6, 16)
    batch = OfficialResultsBatch(
      target_date=target_date,
      operator_rows=(
        map_operator_row({
          "bossName": "林泽",
          "phoneDesc": "13800000000",
          "jobExposure": "130",
        }, target_date),
      ),
      job_rows=(
        map_job_row({
          "jobDesc": "销售顾问",
          "bossName": "林泽",
          "phoneDesc": "13800000000",
          "jobExposure": "80",
        }, target_date),
        map_job_row({
          "jobDesc": "电话销售",
          "bossName": "林泽",
          "phoneDesc": "13800000000",
          "jobExposure": "40",
        }, target_date),
      ),
    )

    payload = build_official_exposure_summary(
      batch=batch,
      operator_profiles=(OperatorProfile("op_linzhe", "林泽", "林泽"),),
    )

    self.assertEqual(payload["source_state"], "loaded")
    self.assertEqual(payload["metric_name"], "official_recruiter_job_exposure_count")
    self.assertEqual(payload["grain"], "date+operator_id")
    recruiter_row = payload["recruiter_daily_rows"][0]
    self.assertEqual(recruiter_row["operator_id"], "op_linzhe")
    self.assertEqual(recruiter_row["official_recruiter_job_exposure_count"], 130)
    self.assertEqual(recruiter_row["job_rollup_exposure_count"], 120)
    self.assertEqual(recruiter_row["source"], "operator_row")
    self.assertIn(
      "official_exposure.operator_job_total_mismatch",
      payload["data_gaps"],
    )
    self.assertEqual(len(payload["job_breakdown_rows"]), 2)
    job_rows = {row["job_name"]: row for row in payload["job_breakdown_rows"]}
    self.assertEqual(job_rows["销售顾问"]["official_job_exposure_count"], 80)
    self.assertEqual(job_rows["销售顾问"]["job_share_of_recruiter_exposure"], 80 / 130)

  def test_summary_uses_job_rollup_when_operator_total_missing(self):
    target_date = date(2026, 6, 16)
    batch = OfficialResultsBatch(
      target_date=target_date,
      operator_rows=(map_operator_row({"bossName": "林泽"}, target_date),),
      job_rows=(
        map_job_row({
          "jobDesc": "销售顾问",
          "bossName": "林泽",
          "jobExposure": 80,
        }, target_date),
        map_job_row({
          "jobDesc": "电话销售",
          "bossName": "林泽",
          "jobExposure": 40,
        }, target_date),
      ),
    )

    payload = build_official_exposure_summary(
      batch=batch,
      operator_profiles=(OperatorProfile("op_linzhe", "林泽", "林泽"),),
    )

    recruiter_row = payload["recruiter_daily_rows"][0]
    self.assertEqual(recruiter_row["official_recruiter_job_exposure_count"], 120)
    self.assertEqual(recruiter_row["source"], "job_rollup")
    self.assertEqual(payload["data_gaps"], [])

  def test_summary_marks_missing_exposure_without_zero_fallback(self):
    target_date = date(2026, 6, 16)
    batch = OfficialResultsBatch(
      target_date=target_date,
      operator_rows=(map_operator_row({"bossName": "林泽"}, target_date),),
      job_rows=(map_job_row({"jobDesc": "销售顾问", "bossName": "林泽"}, target_date),),
    )

    payload = build_official_exposure_summary(
      batch=batch,
      operator_profiles=(OperatorProfile("op_linzhe", "林泽", "林泽"),),
    )

    self.assertEqual(payload["source_state"], "not_loaded")
    self.assertEqual(payload["recruiter_daily_rows"], [])
    self.assertEqual(payload["job_breakdown_rows"], [])
    self.assertIn("official_exposure", payload["data_gaps"])
```

- [ ] **Step 3: Run the new tests to verify they fail**

Run:

```bash
env PYTHONPATH=src python3 -m unittest tests.test_official_exposure -v
```

Expected: fails with `ModuleNotFoundError: No module named 'boss_analysis.domain.official_exposure'`.

- [ ] **Step 4: Implement current-day official exposure summary**

Create `src/boss_analysis/domain/official_exposure.py`:

```python
"""Fact-only official exposure materials for daily analysis."""

from __future__ import annotations

from collections.abc import Iterable, Mapping
from datetime import date
from typing import Any

from boss_analysis.domain.operators import OperatorProfile
from boss_analysis.official_results.models import OfficialResultRow, OfficialResultsBatch

OFFICIAL_RECRUITER_EXPOSURE_METRIC = "official_recruiter_job_exposure_count"
OFFICIAL_JOB_EXPOSURE_METRIC = "official_job_exposure_count"
OFFICIAL_EXPOSURE_FIELD_CANDIDATES: tuple[str, ...] = (
  "官方曝光",
  "岗位曝光",
  "曝光量",
  "候选人侧曝光",
  "牛人侧曝光",
  "jobExposure",
  "candidateExposure",
  "exposureCount",
  "showCount",
  "impressionCount",
)


def build_official_exposure_summary(
  *,
  batch: OfficialResultsBatch,
  operator_profiles: Iterable[OperatorProfile],
) -> dict[str, Any]:
  profile_index = _operator_profile_index(operator_profiles)
  operator_totals = _operator_exposure_rows(batch, profile_index)
  job_rows = _job_exposure_rows(batch, profile_index)
  job_rollups: dict[str, int] = {}
  for row in job_rows:
    job_rollups[row["operator_id"]] = job_rollups.get(row["operator_id"], 0) + row[
      "official_job_exposure_count"
    ]

  recruiter_rows: list[dict[str, Any]] = []
  data_gaps: list[str] = []
  operator_ids = sorted(set(operator_totals.keys()) | set(job_rollups.keys()))
  for operator_id in operator_ids:
    operator_row = operator_totals.get(operator_id)
    job_rollup = job_rollups.get(operator_id, 0)
    if operator_row is not None:
      exposure_count = operator_row["official_recruiter_job_exposure_count"]
      source = "operator_row"
      source_field = operator_row["source_field"]
      display_name = operator_row["display_name"]
    else:
      exposure_count = job_rollup
      source = "job_rollup"
      source_field = None
      display_name = _display_name_for_operator(profile_index, operator_id)
    if exposure_count <= 0:
      continue
    if operator_row is not None and job_rollup > 0 and exposure_count != job_rollup:
      _append_gap(data_gaps, "official_exposure.operator_job_total_mismatch")
    recruiter_rows.append({
      "active_date": batch.target_date.isoformat(),
      "operator_id": operator_id,
      "display_name": display_name,
      "official_recruiter_job_exposure_count": exposure_count,
      "job_rollup_exposure_count": job_rollup,
      "source": source,
      "source_field": source_field,
      "job_count_with_exposure": sum(1 for row in job_rows if row["operator_id"] == operator_id),
    })

  for row in job_rows:
    total = next(
      (
        item["official_recruiter_job_exposure_count"]
        for item in recruiter_rows
        if item["operator_id"] == row["operator_id"]
      ),
      0,
    )
    row["job_share_of_recruiter_exposure"] = row["official_job_exposure_count"] / total if total else None

  if not recruiter_rows and not job_rows:
    _append_gap(data_gaps, "official_exposure")

  return {
    "source_state": "loaded" if recruiter_rows else "not_loaded",
    "metric_name": OFFICIAL_RECRUITER_EXPOSURE_METRIC,
    "grain": "date+operator_id",
    "active_date": batch.target_date.isoformat(),
    "recruiter_daily_rows": recruiter_rows,
    "job_breakdown_rows": job_rows,
    "data_gaps": data_gaps,
  }
```

Add helpers in the same file:

```python
def _operator_exposure_rows(
  batch: OfficialResultsBatch,
  profile_index: Mapping[str, OperatorProfile],
) -> dict[str, dict[str, Any]]:
  rows: dict[str, dict[str, Any]] = {}
  for row in batch.operator_rows:
    boss_name = _text(row.fields.get("BOSS姓名"))
    profile = _profile_for_name(profile_index, boss_name)
    if profile is None:
      continue
    extracted = _extract_exposure_count(row)
    if extracted is None:
      continue
    count, source_field = extracted
    rows[profile.operator_id] = {
      "operator_id": profile.operator_id,
      "display_name": profile.display_name,
      "official_recruiter_job_exposure_count": count,
      "source_field": source_field,
    }
  return rows


def _job_exposure_rows(
  batch: OfficialResultsBatch,
  profile_index: Mapping[str, OperatorProfile],
) -> list[dict[str, Any]]:
  rows: list[dict[str, Any]] = []
  for index, row in enumerate(batch.job_rows):
    boss_name = _text(row.fields.get("职位发布人"))
    profile = _profile_for_name(profile_index, boss_name)
    if profile is None:
      continue
    extracted = _extract_exposure_count(row)
    if extracted is None:
      continue
    count, source_field = extracted
    job_name = _text(row.fields.get("职位名称")) or f"岗位 {index + 1}"
    rows.append({
      "active_date": batch.target_date.isoformat(),
      "operator_id": profile.operator_id,
      "display_name": profile.display_name,
      "job_key": _job_key(job_name, index),
      "job_name": job_name,
      "official_job_exposure_count": count,
      "job_share_of_recruiter_exposure": None,
      "source_field": source_field,
    })
  rows.sort(key=lambda item: (item["operator_id"], item["job_key"]))
  return rows


def _extract_exposure_count(row: OfficialResultRow) -> tuple[int, str] | None:
  for key in OFFICIAL_EXPOSURE_FIELD_CANDIDATES:
    for source in (row.fields, row.extra_source_fields or {}):
      if key not in source:
        continue
      value = _int_value(source.get(key))
      if value is None:
        continue
      return value, key
  return None


def _operator_profile_index(operator_profiles: Iterable[OperatorProfile]) -> dict[str, OperatorProfile]:
  index: dict[str, OperatorProfile] = {}
  for profile in operator_profiles:
    if not profile.enabled:
      continue
    for key in (profile.operator_id, profile.display_name, profile.account_name, *profile.aliases):
      text = _text(key)
      if text:
        index.setdefault(text, profile)
  return index


def _profile_for_name(
  profile_index: Mapping[str, OperatorProfile],
  name: Any,
) -> OperatorProfile | None:
  return profile_index.get(_text(name))


def _display_name_for_operator(
  profile_index: Mapping[str, OperatorProfile],
  operator_id: str,
) -> str:
  profile = profile_index.get(operator_id)
  return profile.display_name if profile is not None else operator_id


def _job_key(job_name: str, index: int) -> str:
  safe = "".join(char if char.isalnum() else "-" for char in job_name.strip()).strip("-")
  return safe or f"job-{index + 1}"


def _append_gap(data_gaps: list[str], gap: str) -> None:
  if gap not in data_gaps:
    data_gaps.append(gap)


def _int_value(value: Any) -> int | None:
  if value is None or value == "":
    return None
  if isinstance(value, bool):
    return int(value)
  if isinstance(value, int):
    return value
  if isinstance(value, float):
    return int(value)
  text = str(value).strip().replace(",", "")
  if text in {"--", "-"}:
    return None
  try:
    return int(float(text))
  except ValueError:
    return None


def _text(value: Any) -> str:
  if value is None:
    return ""
  return str(value).strip()
```

- [ ] **Step 5: Run tests and fix only this module**

Run:

```bash
env PYTHONPATH=src python3 -m unittest tests.test_official_exposure -v
```

Expected: all tests in `tests.test_official_exposure` pass.

- [ ] **Step 6: Commit Task 1**

```bash
git add src/boss_analysis/domain/official_exposure.py tests/test_official_exposure.py docs/ai-worklog.md
git commit -m "feat: build official exposure facts"
```

If the worktree contains unrelated changes that should not be committed, skip the commit and record that in `docs/ai-worklog.md`.

### Task 2: Wire Current-Day Exposure Into Daily Analysis Packet

**Files:**
- Modify: `src/boss_analysis/ops/generate_daily_analysis.py`
- Modify: `tests/test_generate_daily_analysis_command.py`
- Modify: `docs/ai-worklog.md`

- [ ] **Step 1: Write failing integration assertion**

In `tests/test_generate_daily_analysis_command.py`, update `test_run_generation_writes_api_readable_daily_result` source rows to include `jobExposure`, then assert the new facts:

```python
self.assertEqual(
  payload["model_input_packet"]["facts"]["official_exposure"]["recruiter_daily_rows"][0][
    "official_recruiter_job_exposure_count"
  ],
  130,
)
self.assertEqual(
  payload["model_input_packet"]["facts"]["official_exposure"]["job_breakdown_rows"][0][
    "official_job_exposure_count"
  ],
  80,
)
self.assertNotIn("official_exposure", payload["data_quality"]["missing_fields"])
```

Use this input shape in the test:

```python
map_operator_row({
  "bossName": "林泽",
  "phoneDesc": "13800000000",
  "jobExposure": 130,
  "detailGeek": 120,
  "activeAdd": 31,
  "communication": 18,
  "resumeAccept": 4,
  "contactAccept": 2,
  "interviewAccept": 1,
}, target_date)

map_job_row({
  "jobDesc": "销售顾问",
  "bossName": "林泽",
  "phoneDesc": "13800000000",
  "jobExposure": 80,
  "detailGeek": 70,
  "activeAdd": 20,
  "communication": 11,
  "resumeAccept": 3,
}, target_date)
```

- [ ] **Step 2: Run the integration test to verify it fails**

Run:

```bash
env PYTHONPATH=src python3 -m unittest tests.test_generate_daily_analysis_command.GenerateDailyAnalysisTests.test_run_generation_writes_api_readable_daily_result -v
```

Expected: fails with `KeyError: 'official_exposure'`.

- [ ] **Step 3: Import and call the official exposure builder**

In `src/boss_analysis/ops/generate_daily_analysis.py`, add:

```python
from boss_analysis.domain.official_exposure import build_official_exposure_summary
```

Inside `build_offline_daily_analysis_payload()`, immediately after this existing line:

```python
  job_results = _job_evidence_items(batch, operator_ids_by_name, profile_index)
```

add:

```python
  official_exposure = build_official_exposure_summary(
    batch=batch,
    operator_profiles=profiles,
  )
```

Pass `official_exposure` into `_data_quality()` and `_model_input_packet()`.

- [ ] **Step 4: Extend data quality and model input**

Update `_data_quality()` signature:

```python
def _data_quality(
  operator_results: list[dict[str, Any]],
  job_results: list[dict[str, Any]],
  historical_effects: Mapping[str, Any],
  operation_overview: Mapping[str, Any],
  operation_details: Mapping[str, Any],
  official_exposure: Mapping[str, Any],
) -> dict[str, list[str]]:
```

Inside `_data_quality()` add:

```python
  if official_exposure.get("source_state") != "loaded":
    _append_missing("official_exposure")
  for gap in official_exposure.get("data_gaps", ()):
    if isinstance(gap, str):
      _append_missing(gap)
```

Update `_model_input_packet()` signature and facts:

```python
def _model_input_packet(
  *,
  batch: OfficialResultsBatch,
  operator_results: list[dict[str, Any]],
  job_results: list[dict[str, Any]],
  data_quality: dict[str, list[str]],
  historical_effects: Mapping[str, Any],
  operation_overview: Mapping[str, Any],
  operation_details: Mapping[str, Any],
  official_exposure: Mapping[str, Any],
) -> dict[str, Any]:
```

Add to `"facts"`:

```python
      "official_exposure": official_exposure,
```

- [ ] **Step 5: Run focused integration test**

Run:

```bash
env PYTHONPATH=src python3 -m unittest tests.test_generate_daily_analysis_command.GenerateDailyAnalysisTests.test_run_generation_writes_api_readable_daily_result -v
```

Expected: pass.

- [ ] **Step 6: Run affected tests**

Run:

```bash
env PYTHONPATH=src python3 -m unittest tests.test_official_exposure tests.test_generate_daily_analysis_command -v
```

Expected: all tests pass.

- [ ] **Step 7: Commit Task 2**

```bash
git add src/boss_analysis/ops/generate_daily_analysis.py tests/test_generate_daily_analysis_command.py docs/ai-worklog.md
git commit -m "feat: include official exposure in daily analysis"
```

If the worktree contains unrelated changes that should not be committed, skip the commit and record that in `docs/ai-worklog.md`.

### Task 3: Add 14-Day Official Exposure History and Feature Rows

**Files:**
- Modify: `src/boss_analysis/domain/official_exposure.py`
- Modify: `tests/test_official_exposure.py`
- Modify: `src/boss_analysis/ops/generate_daily_analysis.py`
- Modify: `tests/test_generate_daily_analysis_command.py`
- Modify: `docs/ai-worklog.md`

- [ ] **Step 1: Write failing unit tests for history and feature rows**

Append to `tests/test_official_exposure.py`:

```python
from boss_analysis.domain.official_exposure import (
  build_official_exposure_history_14d,
  build_recruiter_daily_exposure_features,
)


class OfficialExposureHistoryTests(unittest.TestCase):
  def test_history_filters_to_14_days_and_rolls_up(self):
    target_date = date(2026, 6, 16)
    rows = [
      {
        "active_date": "2026-06-15",
        "operator_id": "op_linzhe",
        "official_recruiter_job_exposure_count": 100,
      },
      {
        "active_date": "2026-06-14",
        "operator_id": "op_linzhe",
        "official_recruiter_job_exposure_count": 80,
      },
      {
        "active_date": "2026-06-16",
        "operator_id": "op_linzhe",
        "official_recruiter_job_exposure_count": 999,
      },
    ]

    payload = build_official_exposure_history_14d(
      target_date=target_date,
      rows=rows,
      operator_profiles=(OperatorProfile("op_linzhe", "林泽", "林泽"),),
    )

    self.assertEqual(payload["source_state"], "partial")
    self.assertEqual(payload["window"]["start_date"], "2026-06-02")
    self.assertEqual(payload["window"]["end_date"], "2026-06-15")
    self.assertEqual(len(payload["operator_daily_rows"]), 2)
    self.assertEqual(payload["operator_rollups"][0]["totals"]["official_recruiter_job_exposure_count"], 180)

  def test_feature_rows_join_current_exposure_history_and_operation_facts(self):
    current = {
      "source_state": "loaded",
      "active_date": "2026-06-16",
      "recruiter_daily_rows": [{
        "active_date": "2026-06-16",
        "operator_id": "op_linzhe",
        "display_name": "林泽",
        "official_recruiter_job_exposure_count": 140,
        "job_rollup_exposure_count": 120,
        "job_count_with_exposure": 2,
      }],
      "job_breakdown_rows": [],
      "data_gaps": [],
    }
    history = {
      "source_state": "partial",
      "operator_daily_rows": [
        {
          "active_date": "2026-06-15",
          "operator_id": "op_linzhe",
          "official_recruiter_job_exposure_count": 100,
        },
        {
          "active_date": "2026-06-14",
          "operator_id": "op_linzhe",
          "official_recruiter_job_exposure_count": 80,
        },
      ],
      "operator_rollups": [],
    }
    historical_effects = {
      "operator_rollups": [{
        "operator_id": "op_linzhe",
        "totals": {"card_exposed": 50, "detail_opened": 20},
        "daily_averages": {"card_exposed": 25.0, "detail_opened": 10.0},
      }],
    }
    operation_overview = {
      "operator_rollups": [{
        "operator_id": "op_linzhe",
        "totals": {"source_event_count": 8, "active_minutes": 40},
        "daily_averages": {"source_event_count": 4.0, "active_minutes": 20.0},
      }],
    }

    payload = build_recruiter_daily_exposure_features(
      official_exposure=current,
      official_exposure_history=history,
      historical_effects=historical_effects,
      operation_overview=operation_overview,
    )

    row = payload["rows"][0]
    self.assertEqual(payload["source_state"], "loaded")
    self.assertEqual(row["official_recruiter_job_exposure_count"], 140)
    self.assertEqual(row["exposure_baseline_7d_avg"], 90.0)
    self.assertEqual(row["exposure_delta_vs_7d_avg"], 50.0)
    self.assertEqual(row["exposure_delta_pct_vs_7d_avg"], 50.0 / 90.0)
    self.assertEqual(row["active_job_count"], 2)
    self.assertEqual(row["lagged_behavior_features_14d"]["totals"]["card_exposed"], 50)
    self.assertEqual(row["operation_overview_14d"]["totals"]["active_minutes"], 40)
```

- [ ] **Step 2: Run tests to verify failure**

Run:

```bash
env PYTHONPATH=src python3 -m unittest tests.test_official_exposure -v
```

Expected: import errors for `build_official_exposure_history_14d` and `build_recruiter_daily_exposure_features`.

- [ ] **Step 3: Implement history builder**

Add to `src/boss_analysis/domain/official_exposure.py`:

```python
HISTORICAL_DAYS = 14


def build_official_exposure_history_14d(
  *,
  target_date: date,
  rows: Iterable[Mapping[str, Any]],
  operator_profiles: Iterable[OperatorProfile],
) -> dict[str, Any]:
  start_date, end_date = _historical_date_bounds(target_date)
  profile_index = _operator_profile_index(operator_profiles)
  source_count = 0
  daily_rows: list[dict[str, Any]] = []
  for row in rows:
    source_count += 1
    active_date = _parse_date(row.get("active_date"))
    if active_date is None or active_date < start_date or active_date > end_date:
      continue
    profile = _profile_for_history_row(profile_index, row)
    if profile is None:
      continue
    exposure_count = _int_value(row.get("official_recruiter_job_exposure_count"))
    if exposure_count is None:
      continue
    daily_rows.append({
      "active_date": active_date.isoformat(),
      "operator_id": profile.operator_id,
      "display_name": profile.display_name,
      "official_recruiter_job_exposure_count": exposure_count,
    })
  daily_rows = _dedupe_history_rows(daily_rows)
  daily_rows.sort(key=lambda item: (item["operator_id"], item["active_date"]))
  return {
    "source_state": _source_state(source_count, daily_rows, profile_index),
    "window": {
      "start_date": start_date.isoformat(),
      "end_date": end_date.isoformat(),
      "days": HISTORICAL_DAYS,
      "includes_target_date": False,
    },
    "operator_daily_rows": daily_rows,
    "operator_rollups": _rollup_exposure_rows(daily_rows),
  }
```

Add helper functions in the same module:

```python
def _historical_date_bounds(target_date: date) -> tuple[date, date]:
  from datetime import timedelta

  return target_date - timedelta(days=HISTORICAL_DAYS), target_date - timedelta(days=1)


def _parse_date(value: Any) -> date | None:
  if isinstance(value, date):
    return value
  text = _text(value)
  if len(text) >= 10:
    try:
      return date.fromisoformat(text[:10].replace(".", "-"))
    except ValueError:
      return None
  return None


def _profile_for_history_row(
  profile_index: Mapping[str, OperatorProfile],
  row: Mapping[str, Any],
) -> OperatorProfile | None:
  for key in ("operator_id", "display_name", "operator_name", "boss_name", "boss_account_name"):
    profile = _profile_for_name(profile_index, row.get(key))
    if profile is not None:
      return profile
  return None


def _dedupe_history_rows(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
  by_key: dict[tuple[str, str], dict[str, Any]] = {}
  for row in rows:
    key = (row["operator_id"], row["active_date"])
    existing = by_key.get(key)
    if existing is None or row["official_recruiter_job_exposure_count"] > existing[
      "official_recruiter_job_exposure_count"
    ]:
      by_key[key] = row
  return list(by_key.values())


def _rollup_exposure_rows(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
  by_operator: dict[str, list[dict[str, Any]]] = {}
  for row in rows:
    by_operator.setdefault(row["operator_id"], []).append(row)
  output: list[dict[str, Any]] = []
  for operator_id, operator_rows in sorted(by_operator.items()):
    total = sum(row["official_recruiter_job_exposure_count"] for row in operator_rows)
    covered_days = len({row["active_date"] for row in operator_rows})
    output.append({
      "operator_id": operator_id,
      "display_name": operator_rows[0].get("display_name", operator_id),
      "covered_days": covered_days,
      "totals": {"official_recruiter_job_exposure_count": total},
      "daily_averages": {
        "official_recruiter_job_exposure_count": total / covered_days if covered_days else 0.0,
      },
    })
  return output


def _source_state(
  source_count: int,
  rows: list[dict[str, Any]],
  profile_index: Mapping[str, OperatorProfile],
) -> str:
  if source_count == 0 or not rows:
    return "not_loaded"
  enabled_ids = {profile.operator_id for profile in profile_index.values()}
  covered = {
    (row["operator_id"], row["active_date"])
    for row in rows
  }
  expected = len(enabled_ids) * HISTORICAL_DAYS
  return "loaded" if expected > 0 and len(covered) >= expected else "partial"
```

- [ ] **Step 4: Implement feature-row builder**

Add to `src/boss_analysis/domain/official_exposure.py`:

```python
def build_recruiter_daily_exposure_features(
  *,
  official_exposure: Mapping[str, Any],
  official_exposure_history: Mapping[str, Any],
  historical_effects: Mapping[str, Any],
  operation_overview: Mapping[str, Any],
) -> dict[str, Any]:
  rows: list[dict[str, Any]] = []
  history_by_operator = _history_rows_by_operator(official_exposure_history)
  effects_by_operator = _rollups_by_operator(historical_effects)
  operations_by_operator = _rollups_by_operator(operation_overview)
  for current in official_exposure.get("recruiter_daily_rows", ()):
    if not isinstance(current, Mapping):
      continue
    operator_id = _text(current.get("operator_id"))
    if not operator_id:
      continue
    current_count = _int_value(current.get("official_recruiter_job_exposure_count"))
    if current_count is None:
      continue
    recent_history = history_by_operator.get(operator_id, [])
    baseline_7d = _average_recent(recent_history, 7)
    baseline_14d = _average_recent(recent_history, 14)
    rows.append({
      "active_date": _text(current.get("active_date")),
      "operator_id": operator_id,
      "display_name": _text(current.get("display_name")),
      "official_recruiter_job_exposure_count": current_count,
      "exposure_baseline_7d_avg": baseline_7d,
      "exposure_baseline_14d_avg": baseline_14d,
      "exposure_delta_vs_7d_avg": current_count - baseline_7d if baseline_7d is not None else None,
      "exposure_delta_pct_vs_7d_avg": (
        (current_count - baseline_7d) / baseline_7d
        if baseline_7d not in (None, 0)
        else None
      ),
      "active_job_count": _int_value(current.get("job_count_with_exposure")) or 0,
      "lagged_behavior_features_14d": effects_by_operator.get(operator_id, {}),
      "operation_overview_14d": operations_by_operator.get(operator_id, {}),
      "data_quality_flags": _feature_quality_flags(
        operator_id,
        baseline_7d=baseline_7d,
        historical_effects=effects_by_operator,
        operation_overview=operations_by_operator,
      ),
    })
  return {
    "source_state": "loaded" if rows else "not_loaded",
    "metric_name": OFFICIAL_RECRUITER_EXPOSURE_METRIC,
    "grain": "date+operator_id",
    "rows": rows,
  }
```

Add helper functions:

```python
def _history_rows_by_operator(history: Mapping[str, Any]) -> dict[str, list[dict[str, Any]]]:
  output: dict[str, list[dict[str, Any]]] = {}
  for row in history.get("operator_daily_rows", ()):
    if not isinstance(row, Mapping):
      continue
    operator_id = _text(row.get("operator_id"))
    if not operator_id:
      continue
    output.setdefault(operator_id, []).append(dict(row))
  for rows in output.values():
    rows.sort(key=lambda item: _text(item.get("active_date")), reverse=True)
  return output


def _rollups_by_operator(payload: Mapping[str, Any]) -> dict[str, Mapping[str, Any]]:
  output: dict[str, Mapping[str, Any]] = {}
  for row in payload.get("operator_rollups", ()):
    if isinstance(row, Mapping):
      operator_id = _text(row.get("operator_id"))
      if operator_id:
        output[operator_id] = row
  return output


def _average_recent(rows: list[dict[str, Any]], limit: int) -> float | None:
  values = [
    _int_value(row.get("official_recruiter_job_exposure_count"))
    for row in rows[:limit]
  ]
  clean_values = [value for value in values if value is not None]
  if not clean_values:
    return None
  return sum(clean_values) / len(clean_values)


def _feature_quality_flags(
  operator_id: str,
  *,
  baseline_7d: float | None,
  historical_effects: Mapping[str, Mapping[str, Any]],
  operation_overview: Mapping[str, Mapping[str, Any]],
) -> list[str]:
  flags: list[str] = []
  if baseline_7d is None:
    flags.append("official_exposure_history_7d_missing")
  if operator_id not in historical_effects:
    flags.append("historical_effects_14d_missing")
  if operator_id not in operation_overview:
    flags.append("operation_overview_14d_missing")
  return flags
```

- [ ] **Step 5: Wire history file and feature facts into daily generation**

In `src/boss_analysis/ops/generate_daily_analysis.py`, import:

```python
from boss_analysis.domain.official_exposure import (
  build_official_exposure_history_14d,
  build_official_exposure_summary,
  build_recruiter_daily_exposure_features,
)
```

Add parameter to `run_daily_analysis_generation()` and `build_offline_daily_analysis_payload()`:

```python
  official_exposure_history_rows: Iterable[Mapping[str, Any]] = (),
```

Inside `build_offline_daily_analysis_payload()`:

```python
  official_exposure_history = build_official_exposure_history_14d(
    target_date=batch.target_date,
    rows=official_exposure_history_rows,
    operator_profiles=profiles,
  )
  recruiter_daily_exposure_features = build_recruiter_daily_exposure_features(
    official_exposure=official_exposure,
    official_exposure_history=official_exposure_history,
    historical_effects=historical_effects,
    operation_overview=operation_overview,
  )
```

Add to `_model_input_packet()` facts:

```python
      "official_exposure_history_14d": official_exposure_history,
      "recruiter_daily_exposure_features": recruiter_daily_exposure_features,
```

Update `_data_quality()` to append:

```python
  if official_exposure_history.get("source_state") != "loaded":
    _append_missing("official_exposure_history_14d")
  if recruiter_daily_exposure_features.get("source_state") != "loaded":
    _append_missing("recruiter_daily_exposure_features")
```

- [ ] **Step 6: Add CLI file input**

In `build_parser()` add:

```python
  parser.add_argument(
    "--official-exposure-history-file",
    help="JSON file with 14-day official recruiter exposure rows.",
  )
```

Add helper:

```python
def _official_exposure_history_rows_from_file(path: str | None) -> tuple[Mapping[str, Any], ...]:
  if not path:
    return ()
  value = _read_json_value(path)
  if isinstance(value, list):
    rows = value
  elif isinstance(value, Mapping) and isinstance(value.get("rows"), list):
    rows = value["rows"]
  else:
    raise ValueError("Official exposure history source file must be a JSON list or an object with rows")
  return tuple(row for row in rows if isinstance(row, Mapping))
```

In `main()`, pass:

```python
      official_exposure_history_rows=_official_exposure_history_rows_from_file(
        args.official_exposure_history_file
      ),
```

- [ ] **Step 7: Add CLI integration test**

In `tests/test_generate_daily_analysis_command.py`, extend the existing source-file integration test or add:

```python
def test_main_reads_official_exposure_history_source_file(self):
  target_date = date(2026, 6, 16)
  with tempfile.TemporaryDirectory() as tmpdir:
    source_file = Path(tmpdir) / "official-results.json"
    history_file = Path(tmpdir) / "official-exposure-history.json"
    output_dir = Path(tmpdir) / "results"
    source_file.write_text(json.dumps({
      "operator_rows": [{
        "bossName": "林泽",
        "phoneDesc": "13800000000",
        "jobExposure": 140,
      }],
      "job_rows": [{
        "jobDesc": "销售顾问",
        "bossName": "林泽",
        "phoneDesc": "13800000000",
        "jobExposure": 80,
      }],
    }), encoding="utf-8")
    history_file.write_text(json.dumps({
      "rows": [
        {
          "active_date": "2026-06-15",
          "operator_id": "op_linzhe",
          "official_recruiter_job_exposure_count": 100,
        }
      ]
    }), encoding="utf-8")

    with patch.dict(os.environ, {
      "BOSS_ANALYSIS_OPERATOR_CONFIG_JSON": json.dumps({
        "operators": [{
          "operatorId": "op_linzhe",
          "displayName": "林泽",
          "accountName": "林泽",
          "enabled": True,
        }]
      }, ensure_ascii=False)
    }):
      exit_code = generate_daily_analysis.main([
        "--date", target_date.isoformat(),
        "--source", "file",
        "--source-file", str(source_file),
        "--official-exposure-history-file", str(history_file),
        "--output-dir", str(output_dir),
      ])

    payload = load_daily_analysis_result(
      analysis_date=target_date,
      results_dir=output_dir,
    )

  self.assertEqual(exit_code, 0)
  facts = payload["model_input_packet"]["facts"]
  self.assertEqual(facts["official_exposure_history_14d"]["source_state"], "partial")
  self.assertEqual(
    facts["recruiter_daily_exposure_features"]["rows"][0]["exposure_baseline_7d_avg"],
    100.0,
  )
```

- [ ] **Step 8: Run affected tests**

Run:

```bash
env PYTHONPATH=src python3 -m unittest tests.test_official_exposure tests.test_generate_daily_analysis_command -v
```

Expected: all tests pass.

- [ ] **Step 9: Commit Task 3**

```bash
git add src/boss_analysis/domain/official_exposure.py src/boss_analysis/ops/generate_daily_analysis.py tests/test_official_exposure.py tests/test_generate_daily_analysis_command.py docs/ai-worklog.md
git commit -m "feat: build official exposure training rows"
```

If the worktree contains unrelated changes that should not be committed, skip the commit and record that in `docs/ai-worklog.md`.

### Task 4: Documentation and Final Verification

**Files:**
- Modify: `docs/modules/09-daily-analysis-llm-strategy.md`
- Modify: `docs/superpowers/specs/2026-06-18-recruiter-official-exposure-attribution-design.md`
- Modify: `docs/ai-worklog.md`

- [ ] **Step 1: Update LLM strategy input constraints**

In `docs/modules/09-daily-analysis-llm-strategy.md`, add the official exposure facts to the allowed input list:

```markdown
- `official_exposure`：分析当天招聘人级官方候选人侧曝光、岗位级拆解和数据缺口。
- `official_exposure_history_14d`：分析日前 14 天招聘人级官方曝光历史，不包含分析当天。
- `recruiter_daily_exposure_features`：由官方曝光、官方曝光历史、行为历史和操作概览组成的事实特征行，只用于模型理解波动，不包含本地归因结论。
```

Add this constraint:

```markdown
官方曝光材料只能表达 BOSS 官方候选人侧曝光事实、历史基线、岗位拆解和训练特征。模型可以基于这些事实输出待确认行动，但本地系统不得把 `recruiter_daily_exposure_features` 转写成确定原因、贡献度、置信度或员工评价。
```

- [ ] **Step 2: Update design implementation status**

In `docs/superpowers/specs/2026-06-18-recruiter-official-exposure-attribution-design.md`, add:

```markdown
## 第一阶段实现状态

第一阶段实现目标是让日常分析输入包包含：

- `official_exposure`
- `official_exposure_history_14d`
- `recruiter_daily_exposure_features`

这些字段都是 fact-only 材料。官方曝光源字段名仍通过候选字段识别，缺失时记录 `data_quality.missing_fields`，不按 0 处理。
```

- [ ] **Step 3: Run full affected verification**

Run:

```bash
env PYTHONPATH=src python3 -m unittest tests.test_official_exposure tests.test_generate_daily_analysis_command tests.test_daily_analysis_materials tests.test_daily_analysis -v
```

Expected: all tests pass.

Run:

```bash
python3 -m py_compile src/boss_analysis/domain/official_exposure.py src/boss_analysis/ops/generate_daily_analysis.py
```

Expected: no output and exit code 0.

Run:

```bash
git diff --check -- src/boss_analysis/domain/official_exposure.py src/boss_analysis/ops/generate_daily_analysis.py tests/test_official_exposure.py tests/test_generate_daily_analysis_command.py docs/modules/09-daily-analysis-llm-strategy.md docs/superpowers/specs/2026-06-18-recruiter-official-exposure-attribution-design.md docs/ai-worklog.md
```

Expected: no whitespace errors.

- [ ] **Step 4: Append completion record**

Append to `docs/ai-worklog.md`:

```markdown
#### 完成记录：官方曝光事实材料和训练特征已接入

- 时间：先运行 `date '+%Y-%m-%d %H:%M %Z'`，粘贴命令输出
- 状态：已完成
- 已完成：
  - 新增官方曝光事实构建模块，支持招聘人级总量、岗位拆解、14 天历史和训练特征行。
  - 日常分析输入包新增 `official_exposure`、`official_exposure_history_14d`、`recruiter_daily_exposure_features`。
  - 缺官方曝光字段时记录数据缺口，不把缺失当 0。
  - 本地仍不输出归因结论、置信度、建议动作或绩效判断。
- 改动文件：
  - `src/boss_analysis/domain/official_exposure.py`
  - `src/boss_analysis/ops/generate_daily_analysis.py`
  - `tests/test_official_exposure.py`
  - `tests/test_generate_daily_analysis_command.py`
  - `docs/modules/09-daily-analysis-llm-strategy.md`
  - `docs/superpowers/specs/2026-06-18-recruiter-official-exposure-attribution-design.md`
  - `docs/ai-worklog.md`
- 验证结果：
  - `env PYTHONPATH=src python3 -m unittest tests.test_official_exposure tests.test_generate_daily_analysis_command tests.test_daily_analysis_materials tests.test_daily_analysis -v` 通过。
  - `python3 -m py_compile src/boss_analysis/domain/official_exposure.py src/boss_analysis/ops/generate_daily_analysis.py` 通过。
  - `git diff --check -- src/boss_analysis/domain/official_exposure.py src/boss_analysis/ops/generate_daily_analysis.py tests/test_official_exposure.py tests/test_generate_daily_analysis_command.py docs/modules/09-daily-analysis-llm-strategy.md docs/superpowers/specs/2026-06-18-recruiter-official-exposure-attribution-design.md docs/ai-worklog.md` 通过。
- 风险/阻塞：
  - 真实 BOSS 官方曝光源字段名仍需用实际接口响应确认。
  - 本阶段没有修改飞书表结构或官方同步字段映射；若需要生产同步官方曝光字段，应另开任务设计表字段和映射。
- 中断续写入口：下一步确认真实字段名后，决定是否扩展 `OPERATOR_SOURCE_TO_FEISHU` / `JOB_SOURCE_TO_FEISHU` 和飞书表字段。
```

- [ ] **Step 5: Commit Task 4**

```bash
git add docs/modules/09-daily-analysis-llm-strategy.md docs/superpowers/specs/2026-06-18-recruiter-official-exposure-attribution-design.md docs/ai-worklog.md
git commit -m "docs: document official exposure inputs"
```

If the worktree contains unrelated changes that should not be committed, skip the commit and record that in `docs/ai-worklog.md`.

## Verification Summary

Minimum commands before reporting implementation complete:

```bash
env PYTHONPATH=src python3 -m unittest tests.test_official_exposure tests.test_generate_daily_analysis_command tests.test_daily_analysis_materials tests.test_daily_analysis -v
python3 -m py_compile src/boss_analysis/domain/official_exposure.py src/boss_analysis/ops/generate_daily_analysis.py
git diff --check -- src/boss_analysis/domain/official_exposure.py src/boss_analysis/ops/generate_daily_analysis.py tests/test_official_exposure.py tests/test_generate_daily_analysis_command.py docs/modules/09-daily-analysis-llm-strategy.md docs/superpowers/specs/2026-06-18-recruiter-official-exposure-attribution-design.md docs/ai-worklog.md
```

## Notes for Implementation

- Do not modify `analysis-system` outside the files listed above unless a test exposes a necessary local dependency.
- Do not modify parent project files, Chrome extension files, strategy files, CLS tasks, or production configuration.
- Do not add a production SearchLog path for official exposure history.
- Do not write model attribution, confidence, ranking, recommendations, employee performance labels, or candidate quality labels in local code.
- Do not treat missing official exposure as zero. Missing means `source_state != loaded` and a `data_quality.missing_fields` entry.
- If real BOSS source fields are later confirmed, add a separate task to update official sync mapping and Feishu fields. This plan only makes the analysis path ready to consume the field when present.
