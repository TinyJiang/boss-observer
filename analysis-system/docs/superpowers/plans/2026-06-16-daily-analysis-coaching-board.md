# Daily Analysis Coaching Board Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use $superpower-subagents (recommended) or $superpower-executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking via update_plan.

**Goal:** Rework `/daily-analysis` from data-board layout into the first version of a neutral team coaching board.

**Architecture:** Keep the existing hidden route, payload type, API helper, and React single-file structure. Reorganize `DailyAnalysisTab` into a compact overview strip, first-screen collection alert, coaching summary, focus/actions lists, and proof sections that reuse existing volatility/evidence rendering lower on the page.

**Tech Stack:** React 19, TypeScript, Vite, CSS modules by global stylesheet, Python `unittest` static source checks.

---

### Task 1: Add Static UI Contract Test

**Files:**
- Modify: `tests/test_dev_server.py`

- [ ] **Step 1: Write the failing test**

Add a static test that requires the new first-screen component names and coaching copy, while preventing the old model/volatility sections from remaining the primary labels.

```python
  def test_react_daily_analysis_uses_coaching_board_structure(self):
    app_source = Path(__file__).resolve().parents[1] / "frontend" / "src" / "App.tsx"
    source = app_source.read_text(encoding="utf-8")

    self.assertIn("DailyOverviewStrip", source)
    self.assertIn("DailyCollectionAlert", source)
    self.assertIn("DailyCoachingSummary", source)
    self.assertIn("DailyCoachingFocusList", source)
    self.assertIn("DailyCoachingOperatorList", source)
    self.assertIn("DailyTacticalActions", source)
    self.assertIn("DailyProofSections", source)
    self.assertIn("整体概览", source)
    self.assertIn("采集状态", source)
    self.assertIn("今日团队判断", source)
    self.assertIn("今日辅导重点", source)
    self.assertIn("建议复盘对象", source)
    self.assertIn("今日战术建议", source)
    self.assertIn("数据证明", source)
    self.assertNotIn("<h2>模型归因分析</h2>", source)
    self.assertNotIn("<h2>波动概览</h2>", source)
```

- [ ] **Step 2: Run the test and verify RED**

Run:

```bash
env PYTHONPATH=src python3 -m unittest tests.test_dev_server.DevServerTests.test_react_daily_analysis_uses_coaching_board_structure -v
```

Expected: fail because the new component names and labels do not exist yet.

### Task 2: Reorganize DailyAnalysisTab Components

**Files:**
- Modify: `frontend/src/App.tsx`

- [ ] **Step 1: Replace the flat render order**

Change `DailyAnalysisTab` so payload rendering follows:

```tsx
<DailyOverviewStrip payload={payload} activeDate={activeDate} evidenceCount={evidenceCount} />
<DailyCollectionAlert payload={payload} loadState={loadState} errorMessage={errorMessage} />
<DailyCoachingSummary payload={payload} />
<DailyCoachingFocusList payload={payload} />
<DailyCoachingOperatorList payload={payload} />
<DailyTacticalActions payload={payload} />
<DailyProofSections payload={payload} />
```

Keep the existing filter row and empty/loading behavior.

- [ ] **Step 2: Add derived UI helpers**

Add pure helpers in `frontend/src/App.tsx`:

```ts
function buildDailyOverviewItems(payload: DailyAnalysisPayload | null, activeDate: string, evidenceCount: number): Array<{ label: string; value: string; note?: string }>;
function buildCollectionIssues(payload: DailyAnalysisPayload | null, loadState: LoadState, errorMessage: string | null): string[];
function topDailyMetrics(metrics: DailyAnalysisVolatilityMetric[], count: number): DailyAnalysisVolatilityMetric[];
function dailyOperatorSummaries(payload: DailyAnalysisPayload): Array<{ operatorId: string; name: string; focus: string; gap: string; action: string; evidenceCount: number; quality: string }>;
function dailyTacticalActions(payload: DailyAnalysisPayload): Array<{ action: string; target: string; reason: string; evidenceCount: number; needsReview: boolean }>;
```

Use current payload fields only. Missing values render as `暂无` or `未覆盖`, never as fake zero coverage.

- [ ] **Step 3: Add components**

Add the new components near the existing daily-analysis components. Component text must use neutral coaching language:

- `今日团队判断`
- `今日辅导重点`
- `建议复盘对象`
- `今日战术建议`
- `数据证明`
- `可辅导点`
- `机会缺口`
- `待确认原因`

Do not use punitive labels such as `落后`, `低效`, `不合格`, `倒数`, `责任人`, `处罚`, `偷懒`, or `扣分` in user-facing daily-analysis copy.

- [ ] **Step 4: Keep proof sections available**

Rename section headings:

- `DailyVolatilityPanel` heading becomes `漏斗证明`.
- `DailyModelPanel` heading becomes `辅导分析`.
- `DailyEvidencePanel` remains under `数据证明`.

First-screen content should no longer start with the old status/volatility/model/evidence board.

### Task 3: Add Styling for Coaching Layout

**Files:**
- Modify: `frontend/src/styles.css`

- [ ] **Step 1: Add compact first-screen styles**

Add classes:

```css
.dailyOverviewStrip
.dailyCollectionAlert
.dailyCoachingHero
.dailyCoachingLayout
.dailyFocusList
.dailyOperatorCoachList
.dailyActionList
.dailyProofSections
```

The layout should stay within the existing light dashboard style: white panels, thin borders, 8px radius, compact type, teal/blue accents.

- [ ] **Step 2: Update responsive rules**

Add the new grid classes to the existing mobile media query so no text overlaps on narrow screens.

### Task 4: Verify and Record

**Files:**
- Modify: `docs/ai-worklog.md`

- [ ] **Step 1: Run focused tests**

Run:

```bash
env PYTHONPATH=src python3 -m unittest tests.test_dev_server.DevServerTests.test_react_daily_analysis_uses_coaching_board_structure tests.test_dev_server.DevServerTests.test_react_ui_hides_daily_analysis_from_main_nav_but_keeps_private_route -v
```

Expected: pass.

- [ ] **Step 2: Build frontend**

Run:

```bash
cd frontend && npm run build
```

Expected: TypeScript and Vite build pass.

- [ ] **Step 3: Run diff check**

Run:

```bash
git diff --check -- docs/ai-worklog.md docs/superpowers/specs/2026-06-16-daily-analysis-coaching-board-design.md docs/superpowers/plans/2026-06-16-daily-analysis-coaching-board.md frontend/src/App.tsx frontend/src/styles.css tests/test_dev_server.py
```

Expected: no output.

- [ ] **Step 4: Append completion log**

Add a worklog phase record with changed files, verification commands, and remaining risk.
