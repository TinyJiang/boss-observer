# Operator Daily Analysis Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use $superpower-subagents (recommended) or $superpower-executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking via update_plan.

**Goal:** Build the first usable daily operator analysis page and API, with local volatility/evidence preparation and mock model analysis output.

**Architecture:** Keep local code responsible only for deterministic volatility metrics and evidence packets. Put attribution ranking, confidence, reasoning, and recommendations under `model_analysis` as mock model output so the UI contract is ready for a real Codex call. Use a new pure domain module, expose it through the existing dependency-free dev server, and add a React tab following the current dashboard/history UI patterns.

**Tech Stack:** Python 3.11 dataclasses and `unittest`; existing `http.server` dev API; React 19, TypeScript, Vite, existing CSS.

---

## File Structure

- Create `src/boss_analysis/domain/daily_analysis.py`: domain dataclasses and pure builders for official-result demo rows, volatility metrics, evidence bundle, data quality, and mock model output.
- Modify `src/boss_analysis/domain/__init__.py`: export only the public daily-analysis domain types used by tests or future integrations.
- Modify `src/boss_analysis/dev_server.py`: add `DevApp.daily_analysis_payload()` and route `GET /api/daily-analysis`.
- Create `tests/test_daily_analysis.py`: unit tests for local boundary, volatility metrics, evidence ids, and mock model output.
- Modify `tests/test_dev_server.py`: API payload and React source static checks.
- Modify `frontend/src/types.ts`: add `DailyAnalysisPayload` and related frontend types.
- Modify `frontend/src/api.ts`: add `fetchDailyAnalysis()`.
- Modify `frontend/src/App.tsx`: add `日常分析` tab, state, data loading, filters, volatility/evidence/model rendering.
- Modify `frontend/src/styles.css`: add responsive styles for the new tab using existing panel/table/control conventions.
- Modify `docs/ai-worklog.md`: add task start, plan, implementation, verification, and completion records.

## Task 1: Backend Domain and Unit Tests

**Files:**
- Create: `tests/test_daily_analysis.py`
- Create: `src/boss_analysis/domain/daily_analysis.py`
- Modify: `src/boss_analysis/domain/__init__.py`

- [ ] **Step 1: Write failing tests for local boundary and packet shape**

Create `tests/test_daily_analysis.py` with tests named:

```python
from __future__ import annotations

import unittest
from datetime import date, datetime, timezone

from boss_analysis.domain.daily_analysis import build_daily_analysis_payload
from boss_analysis.domain.operators import OperatorProfile


class DailyAnalysisTests(unittest.TestCase):
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
    self.assertTrue(all(item.operator_id == "op_002" for item in payload.evidence_bundle.operator_results))
```

- [ ] **Step 2: Run the tests and verify RED**

Run:

```bash
PYTHONPYCACHEPREFIX=/private/tmp/boss-analysis-pycache PYTHONPATH=src python3 -m unittest tests.test_daily_analysis -v
```

Expected: fail with `ModuleNotFoundError: No module named 'boss_analysis.domain.daily_analysis'`.

- [ ] **Step 3: Implement domain builders**

Create `src/boss_analysis/domain/daily_analysis.py` with frozen dataclasses:

- `VolatilityMetric`
- `EvidenceItem`
- `EvidenceBundle`
- `DataQuality`
- `ModelAttribution`
- `ModelAnalysis`
- `DailyAnalysisPayload`

Implement:

- `build_daily_analysis_payload(analysis_date, operator_profiles, operator_id=None, generated_at=None) -> DailyAnalysisPayload`
- deterministic demo official operator/job rows derived from enabled operator profiles
- volatility metrics for `vs_yesterday`, `vs_same_weekday`, `vs_7d_avg`, `vs_14d_avg`, `short_term_slope`, and funnel breakpoints
- evidence ids with `official:*`, `behavior:*`, and `metric:*` prefixes
- `model_analysis` mock output with attribution `rank`, `confidence`, `reasoning`, `evidence_refs`, `data_gaps`, and `recommended_actions`

Rules:

- `VolatilityMetric.as_dict()` must not include `confidence`, `contribution`, `cause`, `reasoning`, or `rank`.
- `DataQuality.missing_fields` must include `job_detail_fields` and `job_refresh_events` in the first version.
- `DailyAnalysisPayload.as_dict()` must return JSON-safe dictionaries and lists.

- [ ] **Step 4: Export public types**

Update `src/boss_analysis/domain/__init__.py` to export:

```python
from boss_analysis.domain.daily_analysis import DailyAnalysisPayload
from boss_analysis.domain.daily_analysis import DataQuality
from boss_analysis.domain.daily_analysis import EvidenceBundle
from boss_analysis.domain.daily_analysis import EvidenceItem
from boss_analysis.domain.daily_analysis import ModelAnalysis
from boss_analysis.domain.daily_analysis import ModelAttribution
from boss_analysis.domain.daily_analysis import VolatilityMetric
```

Add the matching names to `__all__`.

- [ ] **Step 5: Run the domain tests and verify GREEN**

Run:

```bash
PYTHONPYCACHEPREFIX=/private/tmp/boss-analysis-pycache PYTHONPATH=src python3 -m unittest tests.test_daily_analysis -v
```

Expected: all tests pass.

## Task 2: Dev API Route and Tests

**Files:**
- Modify: `src/boss_analysis/dev_server.py`
- Modify: `tests/test_dev_server.py`

- [ ] **Step 1: Add failing API tests**

Add two tests to `tests/test_dev_server.py`:

```python
  def test_dev_app_daily_analysis_payload_is_json_safe(self):
    app = DevApp(data_source="empty", use_demo_fallback=False)

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
    self.assertNotIn('"contribution"', encoded)
    self.assertIn('"confidence"', encoded)

  def test_react_ui_has_daily_analysis_tab(self):
    app_source = Path(__file__).resolve().parents[1] / "frontend" / "src" / "App.tsx"
    source = app_source.read_text(encoding="utf-8")

    self.assertIn('"dailyAnalysis"', source)
    self.assertIn("日常分析", source)
    self.assertIn("波动概览", source)
    self.assertIn("模型归因分析", source)
```

- [ ] **Step 2: Run the new tests and verify RED**

Run:

```bash
PYTHONPYCACHEPREFIX=/private/tmp/boss-analysis-pycache PYTHONPATH=src python3 -m unittest tests.test_dev_server.DevServerTests.test_dev_app_daily_analysis_payload_is_json_safe tests.test_dev_server.DevServerTests.test_react_ui_has_daily_analysis_tab -v
```

Expected: first test fails because `DevApp.daily_analysis_payload` does not exist; second test fails because the React tab does not exist.

- [ ] **Step 3: Add backend API support**

Modify `src/boss_analysis/dev_server.py`:

- import `timedelta` and `build_daily_analysis_payload`
- add `DevApp.daily_analysis_payload(active_date=None, operator_id=None)`
- parse `active_date` and `date`; default to yesterday using local system date
- raise `ValueError("active_date must be YYYY-MM-DD")` for invalid dates
- call `build_daily_analysis_payload()` with `self._operator_config_provider.load()`
- return `payload.as_dict()`
- add `GET /api/daily-analysis` route using `_send_api_json`
- accept query keys `date`, `active_date`, and `operator_id`

- [ ] **Step 4: Run API-focused tests**

Run:

```bash
PYTHONPYCACHEPREFIX=/private/tmp/boss-analysis-pycache PYTHONPATH=src python3 -m unittest tests.test_daily_analysis tests.test_dev_server.DevServerTests.test_dev_app_daily_analysis_payload_is_json_safe -v
```

Expected: all selected backend tests pass.

## Task 3: Frontend Types, API, and Daily Analysis Tab

**Files:**
- Modify: `frontend/src/types.ts`
- Modify: `frontend/src/api.ts`
- Modify: `frontend/src/App.tsx`

- [ ] **Step 1: Add TypeScript types**

Add to `frontend/src/types.ts`:

- `DailyAnalysisStatus`
- `DailyAnalysisPayload`
- `DailyAnalysisVolatilityMetric`
- `DailyAnalysisEvidenceBundle`
- `DailyAnalysisEvidenceItem`
- `DailyAnalysisDataQuality`
- `DailyAnalysisModelAnalysis`
- `DailyAnalysisModelAttribution`

Types must match the backend keys:

```ts
export type DailyAnalysisStatus = "ready" | "partial" | "analyzing" | "failed";

export type DailyAnalysisVolatilityMetric = {
  evidence_id: string;
  metric_key: string;
  metric_label: string;
  baseline_key: string;
  baseline_label: string;
  current_value: number;
  baseline_value: number;
  delta: number;
  percent_change: number | null;
  direction: "up" | "down" | "flat";
  sample_size: number;
  note: string | null;
};
```

- [ ] **Step 2: Add API helper**

Modify `frontend/src/api.ts`:

- import `DailyAnalysisPayload`
- add `fetchDailyAnalysis({ activeDate, operatorId })`
- map `activeDate` to `date`, `operatorId` to `operator_id`

- [ ] **Step 3: Add React state and loader**

Modify `frontend/src/App.tsx`:

- extend `AppTab` with `"dailyAnalysis"`
- import `fetchDailyAnalysis` and `DailyAnalysisPayload`
- add states for `dailyAnalysis`, `dailyAnalysisActiveDate`, `dailyAnalysisOperatorId`, submitted filters, load state, error, and query version
- load data when `activeTab === "dailyAnalysis"`
- add nav button text `日常分析`
- add `formatTabTitle("dailyAnalysis")` returning `日常分析`

- [ ] **Step 4: Render the tab**

Add `DailyAnalysisTab` component with:

- filter panel: date input, operator id input with datalist, query button, explicit query state
- status summary: analysis date, status, sync state, model generated time, evidence count
- `波动概览`: group metrics by `baseline_key`; show `metric_label`, current value, baseline value, delta, percent change, and note
- `模型归因分析`: render model summary and attribution rows, including confidence, reasoning, evidence refs, data gaps, and actions
- `证据包`: render official operator rows, job rows, job actions, behavior summaries, missing fields, unmatched jobs, low sample warnings

Use existing helpers `LoadingText`, `formatPercent`, `toFiniteNumber`, and operator datalist patterns.

- [ ] **Step 5: Run frontend build**

Run:

```bash
cd frontend && npm run build
```

Expected: `tsc --noEmit && vite build` exits 0.

## Task 4: Styling and Static UI Tests

**Files:**
- Modify: `frontend/src/styles.css`
- Modify: `tests/test_dev_server.py`

- [ ] **Step 1: Add focused styles**

Append styles for:

- `.dailyAnalysisFilters`
- `.dailyStatusGrid`
- `.dailyAnalysisGrid`
- `.dailyMetricRows`
- `.dailyMetricRow`
- `.attributionRows`
- `.attributionRow`
- `.evidenceGrid`
- `.evidenceList`
- `.dataGapList`

Use responsive grid constraints matching `.historyFilters`, `.historySummary`, `.qualityGrid`, and `.qualityRow`.

- [ ] **Step 2: Run static UI test**

Run:

```bash
PYTHONPYCACHEPREFIX=/private/tmp/boss-analysis-pycache PYTHONPATH=src python3 -m unittest tests.test_dev_server.DevServerTests.test_react_ui_has_daily_analysis_tab -v
```

Expected: pass.

- [ ] **Step 3: Run frontend build again**

Run:

```bash
cd frontend && npm run build
```

Expected: exits 0.

## Task 5: Final Verification and Worklog

**Files:**
- Modify: `docs/ai-worklog.md`

- [ ] **Step 1: Run backend verification**

Run:

```bash
PYTHONPYCACHEPREFIX=/private/tmp/boss-analysis-pycache PYTHONPATH=src python3 -m unittest tests.test_daily_analysis tests.test_dev_server.DevServerTests.test_dev_app_daily_analysis_payload_is_json_safe tests.test_dev_server.DevServerTests.test_react_ui_has_daily_analysis_tab -v
```

Expected: all selected tests pass.

- [ ] **Step 2: Run frontend verification**

Run:

```bash
cd frontend && npm run build
```

Expected: exits 0.

- [ ] **Step 3: Run diff whitespace check for touched files**

Run:

```bash
git diff --check -- docs/ai-worklog.md docs/superpowers/specs/2026-06-16-operator-daily-analysis-design.md docs/superpowers/plans/2026-06-16-operator-daily-analysis.md src/boss_analysis/domain/__init__.py src/boss_analysis/domain/daily_analysis.py src/boss_analysis/dev_server.py tests/test_daily_analysis.py tests/test_dev_server.py frontend/src/types.ts frontend/src/api.ts frontend/src/App.tsx frontend/src/styles.css
```

Expected: exits 0.

- [ ] **Step 4: Start or refresh local dev server if feasible**

If no server is running, run:

```bash
BOSS_ANALYSIS_DATA_SOURCE=demo BOSS_ANALYSIS_REQUIRE_REAL_DATA=0 ./dev.sh
```

Then verify:

```bash
curl -fsS "http://127.0.0.1:8765/api/daily-analysis?date=2026-06-15" >/tmp/boss-daily-analysis.json
```

Expected: command exits 0 and JSON contains `analysis_date`.

- [ ] **Step 5: Append worklog completion record**

Add a stage under the current implementation task with:

- changed files
- verification commands and results
- note that Feishu initialization remains paused
- note that mock model analysis is replaceable by real Codex/model integration

## Verification Summary

- Backend selected tests: `python3 -m unittest tests.test_daily_analysis ...`
- Frontend build: `cd frontend && npm run build`
- Diff check: `git diff --check -- <touched files>`
- Local API smoke: `curl -fsS http://127.0.0.1:8765/api/daily-analysis?date=2026-06-15`

## Next Skill

Use `$superpower-executing-plans` for inline execution because the user explicitly asked to proceed directly until development is complete.
