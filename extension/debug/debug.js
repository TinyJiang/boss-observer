import { readDebugState } from "../src/shared/debug-state.js";

const updatedAtEl = document.getElementById("updatedAt");
const summaryEl = document.getElementById("summary");
const lastEventEl = document.getElementById("lastEvent");
const recentEventsEl = document.getElementById("recentEvents");
const lastUploadErrorEl = document.getElementById("lastUploadError");
const lastUploadResultEl = document.getElementById("lastUploadResult");
const rawStateEl = document.getElementById("rawState");
const refreshButton = document.getElementById("refreshButton");

refreshButton.addEventListener("click", () => render());

render();
setInterval(() => render(), 2000);

async function render() {
  const state = await readDebugState();
  updatedAtEl.textContent = state.updatedAt
    ? `Last updated ${new Date(state.updatedAt).toLocaleString()}`
    : "No data yet.";

  summaryEl.innerHTML = "";
  appendRow(summaryEl, "Queue size", String(state.queueSize ?? 0));
  appendRow(summaryEl, "Last flush", state.lastFlushAt ? new Date(state.lastFlushAt).toLocaleString() : "Never");
  appendRow(summaryEl, "Config enabled", state.config?.enabled ? "yes" : "no");
  appendRow(summaryEl, "Upload endpoint", state.config?.uploadEndpoint || "(not set)");
  appendRow(summaryEl, "Debug mode", state.config?.debug ? "on" : "off");
  appendRow(summaryEl, "Batch size", String(state.config?.uploadBatchSize ?? 0));
  appendRow(summaryEl, "Queue cap", String(state.config?.maxQueueSize ?? 0));
  appendRow(summaryEl, "Source tab", formatSourceTab(state.lastEvent));

  lastEventEl.textContent = state.lastEvent ? JSON.stringify(state.lastEvent, null, 2) : "No event yet.";

  recentEventsEl.innerHTML = "";
  for (const event of state.recentEvents || []) {
    const li = document.createElement("li");
    li.innerHTML = `
      <div><strong>${escapeHtml(event.type)}</strong> <span>${escapeHtml(event.occurredAt || "")}</span></div>
      <div style="color:#6b7280">${escapeHtml(event.context?.pageType || "unknown")} | ${escapeHtml(event.context?.pageUrl || "")}</div>
    `;
    recentEventsEl.appendChild(li);
  }

  lastUploadErrorEl.textContent = state.lastUploadError
    ? JSON.stringify(state.lastUploadError, null, 2)
    : "None.";

  lastUploadResultEl.textContent = state.lastUploadResult
    ? JSON.stringify(state.lastUploadResult, null, 2)
    : "None.";

  rawStateEl.textContent = JSON.stringify(state, null, 2);
}

function appendRow(container, key, value) {
  const row = document.createElement("div");
  row.className = "row";
  row.innerHTML = `<div class="key">${escapeHtml(key)}</div><div class="value">${escapeHtml(value)}</div>`;
  container.appendChild(row);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function formatSourceTab(event) {
  if (!event) {
    return "(none)";
  }

  const tabId = event.sourceTabId ?? "n/a";
  const windowId = event.sourceWindowId ?? "n/a";
  const title = event.context?.pageTitle || "untitled";
  return `tab ${tabId}, window ${windowId}, ${title}`;
}
