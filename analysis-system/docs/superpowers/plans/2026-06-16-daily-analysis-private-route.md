# Daily Analysis Private Route Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use $superpower-subagents (recommended) or $superpower-executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking via update_plan.

**Goal:** Hide the unfinished daily analysis feature from the main menu while keeping it available at `/daily-analysis`.

**Architecture:** Keep the current tab-based app for launched pages. Add a lightweight path gate for `/daily-analysis` that renders the existing `DailyAnalysisTab` without showing a menu item, and keep `/api/daily-analysis` unchanged.

**Tech Stack:** React 19, TypeScript, Vite, Python `unittest` static checks.

---

### Task 1: Static Test

**Files:**
- Modify: `tests/test_dev_server.py`

- [ ] Replace the current daily-analysis UI assertion with a test that checks the private route exists and the menu click is absent.
- [ ] Run:

```bash
PYTHONPYCACHEPREFIX=/private/tmp/boss-analysis-pycache PYTHONPATH=src python3 -m unittest tests.test_dev_server.DevServerTests.test_react_ui_hides_daily_analysis_from_main_nav_but_keeps_private_route -v
```

Expected red: the private route constant is missing or the nav still contains `setActiveTab("dailyAnalysis")`.

### Task 2: Frontend Entry

**Files:**
- Modify: `frontend/src/App.tsx`

- [ ] Add `const DAILY_ANALYSIS_PATH = "/daily-analysis";`.
- [ ] Remove `"dailyAnalysis"` from `AppTab`.
- [ ] Add `const isDailyAnalysisRoute = window.location.pathname === DAILY_ANALYSIS_PATH;`.
- [ ] Load daily analysis when `isDailyAnalysisRoute` is true.
- [ ] Remove the left nav `日常分析` button.
- [ ] Render `DailyAnalysisTab` before the tab switch when `isDailyAnalysisRoute` is true.
- [ ] Keep `formatTabTitle()` returning `日常分析` when the private route is active via a direct header expression.

### Task 3: Verification

- [ ] Run the targeted Python static test.
- [ ] Run:

```bash
cd frontend && npm run build
```

- [ ] Run `git diff --check` on touched files.
