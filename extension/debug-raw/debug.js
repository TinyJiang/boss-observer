import { readDebugState } from "../src/shared/debug-state.js";
import {
  filterNetworkDebugRequests,
  NETWORK_DEBUG_REQUEST_CATEGORY_ALL,
  NETWORK_DEBUG_REQUEST_CATEGORY_OPTIONS
} from "../src/shared/network-debug.js";

const updatedAtEl = document.getElementById("updatedAt");
const summaryEl = document.getElementById("summary");
const lastEventEl = document.getElementById("lastEvent");
const recentEventsEl = document.getElementById("recentEvents");
const lastUploadErrorEl = document.getElementById("lastUploadError");
const lastUploadResultEl = document.getElementById("lastUploadResult");
const networkRequestsEl = document.getElementById("networkRequests");
const rawStateEl = document.getElementById("rawState");
const refreshButton = document.getElementById("refreshButton");
const startNetworkButton = document.getElementById("startNetworkButton");
const stopNetworkButton = document.getElementById("stopNetworkButton");
const clearNetworkButton = document.getElementById("clearNetworkButton");
const networkCaptureStatusEl = document.getElementById("networkCaptureStatus");
const networkRequestFilterEl = document.getElementById("networkRequestFilter");
const networkRequestFilterSummaryEl = document.getElementById("networkRequestFilterSummary");

let lastRenderedState = null;

populateNetworkRequestFilter();
refreshButton.addEventListener("click", () => render());
startNetworkButton.addEventListener("click", () => runNetworkCommand("start"));
stopNetworkButton.addEventListener("click", () => runNetworkCommand("stop"));
clearNetworkButton.addEventListener("click", () => runNetworkCommand("clear"));
networkRequestFilterEl.addEventListener("change", () => render());
document.addEventListener("click", (event) => {
  const button = event.target.closest?.("[data-copy-panel]");
  if (button) {
    copyPanel(button).catch(() => {});
  }
});

render();
setInterval(() => render(), 2000);

async function render() {
  const state = await readDebugState();
  lastRenderedState = state;
  updatedAtEl.textContent = state.updatedAt
    ? `Last updated ${new Date(state.updatedAt).toLocaleString()}`
    : "No data yet.";

  summaryEl.innerHTML = "";
  appendRow(summaryEl, "Queue size", String(state.queueSize ?? 0));
  appendRow(summaryEl, "Last flush", state.lastFlushAt ? new Date(state.lastFlushAt).toLocaleString() : "Never");
  appendRow(summaryEl, "Config enabled", state.config?.enabled ? "yes" : "no");
  appendRow(summaryEl, "Collection gate", state.collectionGate?.status || "unknown");
  appendRow(summaryEl, "Operator", state.collectionGate?.operator?.operatorId || "(not set)");
  appendRow(summaryEl, "BOSS account", state.collectionGate?.bossAccount?.accountName || "(not detected)");
  appendRow(summaryEl, "Upload endpoint", state.config?.uploadEndpoint || "(not set)");
  appendRow(summaryEl, "Debug mode", state.config?.debug ? "on" : "off");
  appendRow(summaryEl, "Batch size", String(state.config?.uploadBatchSize ?? 0));
  appendRow(summaryEl, "Queue cap", String(state.config?.maxQueueSize ?? 0));
  appendRow(summaryEl, "Pending chat candidates", String(state.chatPendingCandidates?.items?.length ?? 0));
  appendRow(summaryEl, "Source tab", formatSourceTab(state.lastEvent));
  appendRow(summaryEl, "Network capture", state.networkDebug?.enabled ? "on" : "off");
  appendRow(summaryEl, "Network requests", String(state.networkDebug?.requestCount ?? 0));
  renderNetworkCaptureControls(state.networkDebug);

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

  const networkRequests = state.networkDebug?.recentRequests || [];
  const filteredNetworkRequests = getFilteredNetworkRequests(state);
  networkRequestFilterSummaryEl.textContent = `Showing ${filteredNetworkRequests.length} of ${networkRequests.length}`;
  networkRequestsEl.textContent = filteredNetworkRequests.length
    ? JSON.stringify(filteredNetworkRequests, null, 2)
    : "No captured requests.";

  rawStateEl.textContent = JSON.stringify(state, null, 2);
}

async function runNetworkCommand(command) {
  await chrome.runtime.sendMessage({
    kind: "bossObserver.networkDebug.command",
    command
  });
  await render();
}

async function copyPanel(button) {
  const panel = button.dataset.copyPanel;
  const text = buildCopyText(panel, lastRenderedState || await readDebugState());
  try {
    await writeClipboardText(text);
    showCopyStatus(button, "已复制", "copied");
  } catch {
    showCopyStatus(button, "复制失败", "failed");
  }
}

function buildCopyText(panel, state) {
  if (panel === "summary") {
    return buildSummaryCopyText(state);
  }
  if (panel === "lastEvent") {
    return formatJsonOrFallback(state.lastEvent, "No event yet.");
  }
  if (panel === "recentEvents") {
    return formatJsonOrFallback(state.recentEvents || [], "[]");
  }
  if (panel === "networkRequests") {
    return formatJsonOrFallback(getFilteredNetworkRequests(state), "[]");
  }
  if (panel === "lastUploadError") {
    return formatJsonOrFallback(state.lastUploadError, "None.");
  }
  if (panel === "lastUploadResult") {
    return formatJsonOrFallback(state.lastUploadResult, "None.");
  }
  if (panel === "rawState") {
    return JSON.stringify(state, null, 2);
  }
  return "";
}

function buildSummaryCopyText(state) {
  return [
    ["Queue size", String(state.queueSize ?? 0)],
    ["Last flush", state.lastFlushAt ? new Date(state.lastFlushAt).toLocaleString() : "Never"],
    ["Config enabled", state.config?.enabled ? "yes" : "no"],
    ["Collection gate", state.collectionGate?.status || "unknown"],
    ["Operator", state.collectionGate?.operator?.operatorId || "(not set)"],
    ["BOSS account", state.collectionGate?.bossAccount?.accountName || "(not detected)"],
    ["Upload endpoint", state.config?.uploadEndpoint || "(not set)"],
    ["Debug mode", state.config?.debug ? "on" : "off"],
    ["Batch size", String(state.config?.uploadBatchSize ?? 0)],
    ["Queue cap", String(state.config?.maxQueueSize ?? 0)],
    ["Pending chat candidates", String(state.chatPendingCandidates?.items?.length ?? 0)],
    ["Source tab", formatSourceTab(state.lastEvent)],
    ["Network capture", state.networkDebug?.enabled ? "on" : "off"],
    ["Network requests", String(state.networkDebug?.requestCount ?? 0)]
  ].map(([key, value]) => `${key}: ${value}`).join("\n");
}

function formatJsonOrFallback(value, fallback) {
  return value ? JSON.stringify(value, null, 2) : fallback;
}

async function writeClipboardText(text) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  fallbackCopyText(text);
}

function fallbackCopyText(text) {
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  document.body.appendChild(textarea);
  textarea.select();
  const copied = document.execCommand("copy");
  textarea.remove();
  if (!copied) {
    throw new Error("Clipboard write failed");
  }
}

function showCopyStatus(button, label, className) {
  const originalLabel = button.dataset.originalLabel || button.textContent;
  button.dataset.originalLabel = originalLabel;
  button.textContent = label;
  button.classList.remove("copied", "failed");
  button.classList.add(className);
  window.setTimeout(() => {
    button.textContent = originalLabel;
    button.classList.remove("copied", "failed");
  }, 1200);
}

function renderNetworkCaptureControls(networkDebug = {}) {
  const enabled = networkDebug.enabled === true;
  startNetworkButton.disabled = enabled;
  stopNetworkButton.disabled = !enabled;
  networkCaptureStatusEl.textContent = enabled ? "Network Capture: ON" : "Network Capture: OFF";
  networkCaptureStatusEl.className = `capture-status ${enabled ? "on" : "off"}`;
}

function populateNetworkRequestFilter() {
  networkRequestFilterEl.innerHTML = "";
  for (const option of NETWORK_DEBUG_REQUEST_CATEGORY_OPTIONS) {
    const optionEl = document.createElement("option");
    optionEl.value = option.value;
    optionEl.textContent = option.label;
    networkRequestFilterEl.appendChild(optionEl);
  }
  networkRequestFilterEl.value = NETWORK_DEBUG_REQUEST_CATEGORY_ALL;
}

function getFilteredNetworkRequests(state) {
  return filterNetworkDebugRequests(
    state.networkDebug?.recentRequests || [],
    networkRequestFilterEl.value || NETWORK_DEBUG_REQUEST_CATEGORY_ALL
  );
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
