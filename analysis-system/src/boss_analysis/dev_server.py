"""Local development server for the first dashboard page."""

from __future__ import annotations

import argparse
import json
import os
from dataclasses import asdict, is_dataclass
from datetime import date, datetime, timezone
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, urlparse

from boss_analysis.api import AnalysisQueryService
from boss_analysis.dev_data import create_dev_dataset
from boss_analysis.operator_config import OperatorConfigProvider

DEFAULT_HOST = "127.0.0.1"
DEFAULT_PORT = 8765


class DevApp:
  """Small dependency-free app object used by the local HTTP handler."""

  def __init__(
    self,
    *,
    data_file: str | None = None,
    data_source: str | None = None,
    use_demo_fallback: bool = True,
    require_real_data: bool = False,
    refresh_seconds: int = 15,
    operator_config_file: str | None = None,
  ) -> None:
    self._data_file = data_file
    self._data_source = data_source
    self._use_demo_fallback = use_demo_fallback
    self._require_real_data = require_real_data
    self._refresh_seconds = max(0, refresh_seconds)
    self._operator_config_provider = OperatorConfigProvider(operator_config_file)
    self._raw_repository = None
    self._fact_store = None
    self._minute_summaries = ()
    self._daily_active_durations = ()
    self._log_quality_summaries = ()
    self._generated_at: datetime | None = None
    self.source = None
    self.summary_source = None
    self.daily_summary_source = None
    self.log_quality_source = None
    self.query_service = None
    self._last_refresh_at: datetime | None = None
    self._refresh()

  def _refresh(self) -> None:
    dataset = create_dev_dataset(
      data_file=self._data_file,
      data_source=self._data_source,
      use_demo_fallback=self._use_demo_fallback,
    )
    if self._require_real_data and dataset.source.kind not in {"real_file", "summary"}:
      raise ValueError(
        "Real data is required, but no real source was loaded. "
        "Set --data-source summary/file and provide a summary topic, summary file, or data file."
      )
    self.source = dataset.source
    self.summary_source = dataset.summary_source
    self.daily_summary_source = dataset.daily_summary_source
    self.log_quality_source = dataset.log_quality_source
    self._raw_repository = dataset.raw_repository
    self._fact_store = dataset.fact_store
    self._minute_summaries = dataset.minute_summaries
    self._daily_active_durations = dataset.daily_active_durations
    self._log_quality_summaries = dataset.log_quality_summaries
    self._generated_at = dataset.generated_at
    self.query_service = self._build_query_service(dataset.generated_at)
    self._last_refresh_at = datetime.now(timezone.utc)

  def _build_query_service(self, generated_at: datetime | None = None) -> AnalysisQueryService:
    source_kind = self.source.kind if self.source is not None else "empty"
    clock_value = generated_at or self._generated_at or datetime.now(timezone.utc)
    if self._fact_store is None:
      raise RuntimeError("Dev data is not loaded")
    return AnalysisQueryService(
      self._fact_store,
      raw_repository=self._raw_repository,
      minute_summaries=self._minute_summaries,
      daily_active_durations=self._daily_active_durations,
      log_quality_summaries=self._log_quality_summaries,
      operator_profiles=self._operator_config_provider.load(),
      clock=lambda: clock_value if source_kind in {"demo", "empty"} else datetime.now(timezone.utc),
    )

  def _reload_operator_config(self) -> None:
    self.query_service = self._build_query_service()

  def _refresh_if_needed(self) -> None:
    if self.source is None or self._last_refresh_at is None:
      self._refresh()
      return
    if self.source.kind not in {"summary", "real_file"}:
      return
    age_seconds = (datetime.now(timezone.utc) - self._last_refresh_at).total_seconds()
    if age_seconds >= self._refresh_seconds:
      self._refresh()

  def dashboard_payload(self) -> dict[str, Any]:
    self._refresh_if_needed()
    self._reload_operator_config()
    dashboard = self.query_service.dashboard(active_within_minutes=15)
    health = self.query_service.health()
    return {
      "dashboard": _to_jsonable(dashboard),
      "health": _to_jsonable(health),
      "source": _to_jsonable(self.source),
      "summary_source": _to_jsonable(self.summary_source),
      "daily_summary_source": _to_jsonable(self.daily_summary_source),
      "log_quality_source": _to_jsonable(self.log_quality_source),
    }

  def operators_payload(self) -> dict[str, Any]:
    return {
      "operators": _to_jsonable(self._operator_config_provider.load()),
    }

  def operator_payload(self, operator_id: str) -> dict[str, Any]:
    self._refresh_if_needed()
    self._reload_operator_config()
    return {
      "operator": _to_jsonable(self.query_service.operator_analytics(operator_id)),
    }

  def log_quality_payload(
    self,
    *,
    operator_id: str | None = None,
    plugin_version: str | None = None,
  ) -> dict[str, Any]:
    self._refresh_if_needed()
    self._reload_operator_config()
    return {
      "quality": _to_jsonable(self.query_service.log_quality(
        operator_id=operator_id,
        plugin_version=plugin_version,
      )),
      "log_quality_source": _to_jsonable(self.log_quality_source),
    }


def make_handler(app: DevApp):
  class DevRequestHandler(BaseHTTPRequestHandler):
    def do_GET(self) -> None:
      parsed = urlparse(self.path)
      path = parsed.path
      if path == "/" or path == "/index.html":
        self._send_text(INDEX_HTML, "text/html; charset=utf-8")
        return
      if path == "/assets/app.css":
        self._send_text(APP_CSS, "text/css; charset=utf-8")
        return
      if path == "/assets/app.js":
        self._send_text(APP_JS, "application/javascript; charset=utf-8")
        return
      if path == "/api/dashboard":
        self._send_json(app.dashboard_payload())
        return
      if path == "/api/operators":
        self._send_json(app.operators_payload())
        return
      if path == "/api/log-quality":
        query = parse_qs(parsed.query)
        self._send_json(app.log_quality_payload(
          operator_id=_first_query_value(query, "operator_id"),
          plugin_version=_first_query_value(query, "plugin_version"),
        ))
        return
      if path.startswith("/api/operator/"):
        operator_id = path.rsplit("/", 1)[-1]
        self._send_json(app.operator_payload(operator_id))
        return
      self.send_error(HTTPStatus.NOT_FOUND, "Not found")

    def log_message(self, format, *args) -> None:
      return

    def _send_json(self, payload: dict[str, Any]) -> None:
      encoded = json.dumps(payload, ensure_ascii=False).encode("utf-8")
      self.send_response(HTTPStatus.OK)
      self.send_header("Content-Type", "application/json; charset=utf-8")
      self.send_header("Content-Length", str(len(encoded)))
      self.end_headers()
      self.wfile.write(encoded)

    def _send_text(self, text: str, content_type: str) -> None:
      encoded = text.encode("utf-8")
      self.send_response(HTTPStatus.OK)
      self.send_header("Content-Type", content_type)
      self.send_header("Content-Length", str(len(encoded)))
      self.end_headers()
      self.wfile.write(encoded)

  return DevRequestHandler


def run_server(
  host: str = DEFAULT_HOST,
  port: int = DEFAULT_PORT,
  *,
  data_file: str | None = None,
  data_source: str | None = None,
  use_demo_fallback: bool = True,
  require_real_data: bool = False,
  refresh_seconds: int = 15,
  operator_config_file: str | None = None,
) -> None:
  app = DevApp(
    data_file=data_file,
    data_source=data_source,
    use_demo_fallback=use_demo_fallback,
    require_real_data=require_real_data,
    refresh_seconds=refresh_seconds,
    operator_config_file=operator_config_file,
  )
  server = ThreadingHTTPServer((host, port), make_handler(app))
  print(f"Boss analysis dev server listening on http://{host}:{port}", flush=True)
  server.serve_forever()


def main(argv: list[str] | None = None) -> None:
  parser = argparse.ArgumentParser(description="Run the local analysis dashboard dev server.")
  parser.add_argument("--host", default=DEFAULT_HOST)
  parser.add_argument("--port", type=int, default=DEFAULT_PORT)
  parser.add_argument(
    "--data-source",
    choices=("auto", "real", "demo", "file", "summary", "empty"),
    default=None,
    help="Data source for local dev. Use summary to read only minute summaries.",
  )
  parser.add_argument("--data-file", default=None, help="JSON/JSONL file exported from CLS or plugin event batches.")
  parser.add_argument("--env-file", action="append", default=None, help="Load environment variables from a local .env file.")
  parser.add_argument("--require-real-data", action="store_true", help="Fail instead of falling back to demo or empty data.")
  parser.add_argument("--refresh-seconds", type=int, default=15, help="Refresh real dev data from its source after this many seconds.")
  parser.add_argument("--operator-config-file", default=None, help="JSON operator config file. Defaults to BOSS_ANALYSIS_OPERATOR_CONFIG_FILE or config/operators.local.json.")
  parser.add_argument("--no-demo", action="store_true", help="Start with no demo data when --data-file is omitted.")
  args = parser.parse_args(argv)
  load_env_files(args.env_file)
  try:
    run_server(
      args.host,
      args.port,
      data_file=args.data_file,
      data_source=args.data_source,
      use_demo_fallback=not args.no_demo,
      require_real_data=args.require_real_data,
      refresh_seconds=args.refresh_seconds,
      operator_config_file=args.operator_config_file,
    )
  except ValueError as error:
    parser.exit(status=2, message=f"error: {error}\n")


def load_env_files(paths: list[str] | None = None) -> list[Path]:
  """Load simple KEY=VALUE entries without overriding existing environment variables."""

  project_root = Path(__file__).resolve().parents[2]
  candidates = [Path(item) for item in paths] if paths else list(dict.fromkeys([
    Path(".env"),
    Path(".env.local"),
    project_root / ".env",
    project_root / ".env.local",
  ]))
  loaded: list[Path] = []
  for path in candidates:
    if not path.exists():
      continue
    for key, value in _iter_env_file_values(path):
      os.environ.setdefault(key, value)
    loaded.append(path)
  return loaded


def _iter_env_file_values(path: Path):
  for raw_line in path.read_text(encoding="utf-8").splitlines():
    line = raw_line.strip()
    if not line or line.startswith("#") or "=" not in line:
      continue
    key, value = line.split("=", 1)
    key = key.strip()
    if not key:
      continue
    yield key, _clean_env_value(value)


def _clean_env_value(value: str) -> str:
  cleaned = value.strip()
  if len(cleaned) >= 2 and cleaned[0] == cleaned[-1] and cleaned[0] in {"'", '"'}:
    return cleaned[1:-1]
  return cleaned


def _to_jsonable(value: Any) -> Any:
  if is_dataclass(value):
    return _to_jsonable(asdict(value))
  if isinstance(value, dict):
    return {key: _to_jsonable(item) for key, item in value.items()}
  if isinstance(value, (list, tuple)):
    return [_to_jsonable(item) for item in value]
  if isinstance(value, (datetime, date)):
    return value.isoformat()
  return value


def _first_query_value(query: dict[str, list[str]], key: str) -> str | None:
  values = query.get(key) or []
  if not values:
    return None
  value = values[0].strip()
  return value or None


INDEX_HTML = """<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>BOSS Analysis Dev</title>
  <link rel="stylesheet" href="/assets/app.css">
</head>
<body>
  <div class="shell">
    <aside class="sidebar">
      <div class="brand">
        <span class="brand-mark"></span>
        <span>BOSS Analysis</span>
      </div>
      <nav class="nav">
        <button class="nav-item active" type="button">Dashboard</button>
        <button class="nav-item" type="button">Operators</button>
        <button class="nav-item" type="button">Health</button>
      </nav>
    </aside>
    <main class="main">
      <header class="topbar">
        <div>
          <p class="eyebrow">Local dev</p>
          <h1>Realtime recruiting activity</h1>
        </div>
        <div class="freshness" id="freshness">Loading</div>
      </header>
      <section class="metrics-grid">
        <article class="metric">
          <span class="metric-label">Active now</span>
          <strong id="active-count">0</strong>
        </article>
        <article class="metric">
          <span class="metric-label">Observed operators</span>
          <strong id="observed-count">0</strong>
        </article>
        <article class="metric">
          <span class="metric-label">Raw events</span>
          <strong id="raw-count">0</strong>
        </article>
        <article class="metric">
          <span class="metric-label">Pipeline issues</span>
          <strong id="issue-count">0</strong>
        </article>
      </section>
      <section class="content-grid">
        <section class="panel">
          <div class="panel-head">
            <h2>Active operators</h2>
            <span class="panel-note">15 minute window</span>
          </div>
          <div class="operator-list" id="operator-list"></div>
        </section>
        <section class="panel">
          <div class="panel-head">
            <h2>Operator detail</h2>
            <span class="panel-note" id="selected-operator">op_001</span>
          </div>
          <div class="funnel">
            <div><span>Cards</span><strong id="f-card">0</strong></div>
            <div><span>Details</span><strong id="f-detail">0</strong></div>
            <div><span>BOSS-like</span><strong id="f-detail-boss">0</strong></div>
            <div><span>Greeting success</span><strong id="f-greeting">0</strong></div>
            <div><span>Chats</span><strong id="f-chat">0</strong></div>
            <div><span>Wechat</span><strong id="f-wechat">0</strong></div>
          </div>
          <div class="bars" id="bars"></div>
        </section>
      </section>
    </main>
  </div>
  <script src="/assets/app.js"></script>
</body>
</html>
"""


APP_CSS = """
:root {
  color-scheme: light;
  --bg: #f5f7fa;
  --panel: #ffffff;
  --line: #d8dee8;
  --ink: #172033;
  --muted: #637083;
  --accent: #0f766e;
  --accent-2: #2563eb;
  --warn: #b45309;
}
* { box-sizing: border-box; }
body {
  margin: 0;
  font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  background: var(--bg);
  color: var(--ink);
}
.shell { min-height: 100vh; display: grid; grid-template-columns: 230px 1fr; }
.sidebar {
  border-right: 1px solid var(--line);
  background: #fbfcfe;
  padding: 18px 14px;
}
.brand {
  display: flex;
  align-items: center;
  gap: 10px;
  font-weight: 700;
  margin-bottom: 28px;
}
.brand-mark {
  width: 22px;
  height: 22px;
  border-radius: 6px;
  background: linear-gradient(135deg, var(--accent), var(--accent-2));
  display: inline-block;
}
.nav { display: grid; gap: 6px; }
.nav-item {
  border: 0;
  background: transparent;
  color: var(--muted);
  text-align: left;
  padding: 10px 12px;
  border-radius: 6px;
  font: inherit;
}
.nav-item.active {
  background: #e7f5f2;
  color: var(--accent);
  font-weight: 700;
}
.main { padding: 24px; min-width: 0; }
.topbar {
  display: flex;
  align-items: end;
  justify-content: space-between;
  gap: 20px;
  margin-bottom: 22px;
}
.eyebrow {
  margin: 0 0 4px;
  color: var(--muted);
  font-size: 13px;
}
h1, h2 { margin: 0; letter-spacing: 0; }
h1 { font-size: 28px; line-height: 1.2; }
h2 { font-size: 16px; }
.freshness {
  border: 1px solid var(--line);
  background: var(--panel);
  padding: 8px 10px;
  border-radius: 6px;
  color: var(--muted);
  font-size: 13px;
}
.metrics-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12px;
  margin-bottom: 14px;
}
.metric, .panel {
  background: var(--panel);
  border: 1px solid var(--line);
  border-radius: 8px;
}
.metric { padding: 16px; }
.metric-label {
  display: block;
  color: var(--muted);
  font-size: 13px;
  margin-bottom: 8px;
}
.metric strong { font-size: 28px; line-height: 1; }
.content-grid {
  display: grid;
  grid-template-columns: minmax(320px, 1.1fr) minmax(320px, 0.9fr);
  gap: 14px;
}
.panel { padding: 16px; min-height: 360px; }
.panel-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 14px;
}
.panel-note { color: var(--muted); font-size: 13px; }
.operator-list { display: grid; gap: 8px; }
.operator-row {
  width: 100%;
  border: 1px solid var(--line);
  background: #fff;
  border-radius: 8px;
  padding: 12px;
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 8px;
  text-align: left;
  font: inherit;
}
.operator-row:hover { border-color: var(--accent); }
.operator-main { display: flex; align-items: center; gap: 8px; font-weight: 700; }
.status-dot {
  width: 9px;
  height: 9px;
  border-radius: 999px;
  background: var(--accent);
  display: inline-block;
}
.operator-meta { color: var(--muted); font-size: 13px; margin-top: 3px; }
.operator-time { color: var(--accent); font-weight: 700; font-size: 13px; }
.funnel {
  display: grid;
  grid-template-columns: repeat(6, minmax(0, 1fr));
  gap: 8px;
  margin-bottom: 18px;
}
.funnel div {
  border: 1px solid var(--line);
  border-radius: 8px;
  padding: 10px;
}
.funnel span { display: block; color: var(--muted); font-size: 12px; margin-bottom: 6px; }
.funnel strong { font-size: 22px; }
.bars { display: grid; gap: 12px; }
.bar-label { display: flex; justify-content: space-between; color: var(--muted); font-size: 13px; margin-bottom: 5px; }
.bar-track { height: 10px; background: #edf1f7; border-radius: 999px; overflow: hidden; }
.bar-fill { height: 100%; background: var(--accent-2); border-radius: 999px; min-width: 4px; }
@media (max-width: 900px) {
  .shell { grid-template-columns: 1fr; }
  .sidebar { border-right: 0; border-bottom: 1px solid var(--line); }
  .metrics-grid, .content-grid { grid-template-columns: 1fr; }
  .topbar { align-items: start; flex-direction: column; }
}
"""


APP_JS = """
async function getJson(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Request failed: ${url}`);
  return response.json();
}

function setText(id, value) {
  document.getElementById(id).textContent = value;
}

function renderOperators(operators) {
  const list = document.getElementById("operator-list");
  list.innerHTML = "";
  operators.forEach((operator) => {
    const row = document.createElement("button");
    row.className = "operator-row";
    row.type = "button";
    row.addEventListener("click", () => loadOperator(operator.operator_id));
    row.innerHTML = `
      <div>
        <div class="operator-main"><span class="status-dot"></span>${operator.operator_id}</div>
        <div class="operator-meta">${operator.last_action} · ${operator.job_id || "no job"}</div>
      </div>
      <div class="operator-time">${operator.minutes_since_active}m ago</div>
    `;
    list.appendChild(row);
  });
}

function renderBars(funnel) {
  const bars = document.getElementById("bars");
  const bossLikeDetailOpened = funnel.detail_opened + funnel.chat_opened;
  const values = [
    ["Card exposure", funnel.card_exposed],
    ["Detail opens", funnel.detail_opened],
    ["BOSS-like views", bossLikeDetailOpened],
    ["Greeting clicks", funnel.greeting_clicked],
    ["Greeting success", funnel.greeting_succeeded],
    ["Chat snapshots", funnel.chat_snapshots],
    ["Wechat captured", funnel.wechat_captured],
  ];
  const max = Math.max(1, ...values.map((item) => item[1]));
  bars.innerHTML = values.map(([label, value]) => `
    <div>
      <div class="bar-label"><span>${label}</span><strong>${value}</strong></div>
      <div class="bar-track"><div class="bar-fill" style="width:${Math.max(4, value / max * 100)}%"></div></div>
    </div>
  `).join("");
}

async function loadOperator(operatorId) {
  const data = await getJson(`/api/operator/${operatorId}`);
  const funnel = data.operator.funnel;
  const bossLikeDetailOpened = funnel.detail_opened + funnel.chat_opened;
  setText("selected-operator", operatorId);
  setText("f-card", funnel.card_exposed);
  setText("f-detail", funnel.detail_opened);
  setText("f-detail-boss", bossLikeDetailOpened);
  setText("f-greeting", funnel.greeting_succeeded);
  setText("f-chat", funnel.chat_snapshots + funnel.chat_opened);
  setText("f-wechat", funnel.wechat_captured);
  renderBars(funnel);
}

async function boot() {
  const data = await getJson("/api/dashboard");
  const dashboard = data.dashboard;
  const health = data.health;
  setText("active-count", dashboard.active_count);
  setText("observed-count", dashboard.observed_operator_count);
  setText("raw-count", health.raw_event_count);
  setText("issue-count", health.parse_error_count + health.projection_error_count + (health.log_quality_finding_count || 0));
  setText("freshness", `Generated ${new Date(dashboard.generated_at).toLocaleTimeString()}`);
  renderOperators(dashboard.active_operators);
  const first = dashboard.active_operators[0]?.operator_id || "op_001";
  await loadOperator(first);
}

boot().catch((error) => {
  setText("freshness", error.message);
});
"""


if __name__ == "__main__":
  main()
