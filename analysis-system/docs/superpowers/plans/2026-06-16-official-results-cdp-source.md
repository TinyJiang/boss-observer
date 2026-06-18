# Official Results CDP Source Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use $superpower-executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking via update_plan.

**Goal:** Add a formal CDP-backed BOSS official results source and use it to run the existing Feishu upsert flow after dry-run validation.

**Architecture:** Keep Feishu sync and field mapping unchanged. Add a source adapter that connects to an already logged-in Chrome CDP endpoint, executes same-origin `fetch` calls for `getDailyBoss.json` and `getDailyJob.json`, then maps raw rows through the existing source-neutral mapping functions.

**Tech Stack:** Python 3.11 stdlib, Chrome DevTools Protocol over local WebSocket, existing `unittest` suite, existing Feishu Bitable OpenAPI client.

---

### Task 1: Add CDP Source Tests

**Files:**
- Modify: `tests/test_official_results_sync.py`

- [ ] Add tests for `BossOfficialResultsCdpSource` with a fake page client:
  - paginates `getDailyBoss.json` and `getDailyJob.json`
  - maps returned rows into `OfficialResultsBatch`
  - records `isReady != 1` as source warnings
  - does not require or expose cookies

- [ ] Run:

```bash
env PYTHONPATH=src python3 -m unittest tests.test_official_results_sync -v
```

Expected: fail with `ImportError` or missing `BossOfficialResultsCdpSource`.

### Task 2: Implement CDP Source

**Files:**
- Create: `src/boss_analysis/official_results/cdp_source.py`
- Modify: `src/boss_analysis/official_results/source.py`

- [ ] Implement `BossOfficialResultsCdpSource` with:
  - `from_env()` reading `BOSS_OFFICIAL_RESULTS_CDP_URL`, `BOSS_OFFICIAL_RESULTS_PAGE_SIZE`, `BOSS_OFFICIAL_RESULTS_MAX_PAGES`
  - injectable fake page client for tests
  - stdlib CDP page client for real Chrome
  - same pagination and warning behavior as HTTP source

- [ ] Re-export or import it from existing source boundaries so CLI can select it.

- [ ] Run:

```bash
env PYTHONPATH=src python3 -m unittest tests.test_official_results_sync -v
```

Expected: pass.

### Task 3: Wire CLI Source Selection

**Files:**
- Modify: `src/boss_analysis/ops/sync_official_results.py`
- Modify: `tests/test_official_results_sync.py`

- [ ] Add CLI options:
  - `--source api|cdp|file`, default `api` unless `--source-file` is provided
  - `--cdp-url`, default from `BOSS_OFFICIAL_RESULTS_CDP_URL`

- [ ] Preserve backward compatibility for `--source-file`.

- [ ] Add tests that `_build_source` chooses CDP source and that `--source-file` still works.

- [ ] Run:

```bash
env PYTHONPATH=src python3 -m unittest tests.test_official_results_sync -v
env PYTHONPATH=src python3 -m boss_analysis.ops.sync_official_results --help
```

Expected: pass; help mentions CDP source.

### Task 4: Update Docs and Worklog

**Files:**
- Modify: `README.md`
- Modify: `docs/modules/08-official-results-sync.md`
- Modify: `.env.example`
- Modify: `docs/ai-worklog.md`

- [ ] Document CDP source usage:

```bash
python3 -m boss_analysis.ops.sync_official_results \
  --source cdp \
  --cdp-url http://127.0.0.1:9222 \
  --date 2026-06-15 \
  --dry-run
```

- [ ] State that CDP source does not read cookies/localStorage/profile databases and does not use export endpoints.

- [ ] Run `git diff --check`.

### Task 5: Verify Real Dry-Run and Feishu Upload

**Files:**
- Modify: `docs/ai-worklog.md`

- [ ] With the user-logged-in Chrome still listening on `http://127.0.0.1:9222`, run dry-run for `2026-06-15`.

```bash
env PYTHONPATH=src python3 -m boss_analysis.ops.sync_official_results \
  --source cdp \
  --cdp-url http://127.0.0.1:9222 \
  --date 2026-06-15 \
  --dry-run
```

- [ ] If dry-run succeeds and Feishu credentials are configured, run the same command without `--dry-run`.

- [ ] Record only counts and status in `docs/ai-worklog.md`; do not record tokens, cookies, names, phones, or raw rows.

### Self-Review

- Covers approved source design, CLI wiring, tests, docs, and real dry-run/write verification.
- No production code task appears before a failing test task.
- No scheduler, Feishu UI, export endpoint, or browser storage dependency is introduced.
