import { readDebugState } from "../src/shared/debug-state.js";
import { readConfig } from "../src/shared/config.js";
import {
  buildDiagnosticProfile,
  buildDiagnosticProfileFilename
} from "../src/shared/diagnostic-profile.js";
import { evaluateCollectionGate } from "../src/shared/operator-identity.js";
import {
  getModuleHealthStatus,
  MODULE_REPORT_DEFINITIONS
} from "../src/shared/production-stats.js";

const overallStatusEl = document.getElementById("overallStatus");
const moduleStatusEl = document.getElementById("moduleStatus");
const downloadProfileButton = document.getElementById("downloadProfileButton");
const openDebugButton = document.getElementById("openDebugButton");
const refreshButton = document.getElementById("refreshButton");
const operatorIdInput = document.getElementById("operatorIdInput");
const accountNameInput = document.getElementById("accountNameInput");
const saveOperatorButton = document.getElementById("saveOperatorButton");
const operatorSaveStatusEl = document.getElementById("operatorSaveStatus");
const collectionGateStatusEl = document.getElementById("collectionGateStatus");

const MODULE_LABELS = {
  page_session: "页面记录",
  job_context: "职位记录",
  candidate_filter: "筛选记录",
  candidate_list: "候选人列表",
  candidate_detail: "候选人详情",
  candidate_greeting: "打招呼事件记录",
  candidate_chat: "聊天记录",
  queue_upload: "数据同步"
};

let operatorFormDirty = false;

downloadProfileButton.addEventListener("click", () => downloadProfile());
openDebugButton.addEventListener("click", () => openDebugPage());
refreshButton.addEventListener("click", () => render());
saveOperatorButton.addEventListener("click", () => saveOperatorConfig());
operatorIdInput.addEventListener("input", () => {
  operatorFormDirty = true;
});
accountNameInput.addEventListener("input", () => {
  operatorFormDirty = true;
});

render();
setInterval(() => render(), 3000);

async function render() {
  const [state, config] = await Promise.all([
    readDebugState(),
    readConfig()
  ]);
  const collectionGate = evaluateCollectionGate(config, state.collectionGate?.bossAccount);
  const productionStats = state.productionStats || {};
  const modules = productionStats.modules || {};
  const rows = buildStatusRows({
    modules,
    uploadEnabled: config.uploadEnabled === true,
    hasUploadError: Boolean(state.lastUploadError)
  });
  const overallStatus = !collectionGate.canCollect || rows.some((row) => row.status === "problem")
    ? "problem"
    : "ok";

  renderOperatorConfig(config, collectionGate);
  renderOverallStatus(overallStatus);
  renderStatusRows(rows);
}

async function saveOperatorConfig() {
  const originalText = saveOperatorButton.textContent;
  saveOperatorButton.disabled = true;
  saveOperatorButton.textContent = "保存中";
  operatorSaveStatusEl.textContent = "";
  try {
    const response = await sendRuntimeMessage({
      kind: "bossObserver.config.update",
      patch: {
        operatorId: operatorIdInput.value,
        accountName: accountNameInput.value
      }
    });
    if (!response?.ok) {
      throw new Error(response?.error || "保存失败");
    }
    operatorFormDirty = false;
    operatorSaveStatusEl.textContent = "已保存";
    await render();
  } catch (error) {
    operatorSaveStatusEl.textContent = "保存失败";
    console.warn("[BOSS Observer] operator config save failed", error);
  } finally {
    saveOperatorButton.disabled = false;
    saveOperatorButton.textContent = originalText;
    window.setTimeout(() => {
      operatorSaveStatusEl.textContent = "";
    }, 1800);
  }
}

async function downloadProfile() {
  const originalText = downloadProfileButton.textContent;
  try {
    const state = await readDebugState();
    const profile = buildDiagnosticProfile(state, {
      manifest: chrome.runtime.getManifest()
    });
    const blobUrl = URL.createObjectURL(new Blob([
      `${JSON.stringify(profile, null, 2)}\n`
    ], {
      type: "application/json"
    }));
    const link = document.createElement("a");
    link.href = blobUrl;
    link.download = buildDiagnosticProfileFilename(profile);
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
    downloadProfileButton.textContent = "已下载";
  } catch (error) {
    downloadProfileButton.textContent = "下载失败";
    console.warn("[BOSS Observer] diagnostic profile download failed", error);
  } finally {
    window.setTimeout(() => {
      downloadProfileButton.textContent = originalText;
    }, 1800);
  }
}

function openDebugPage() {
  chrome.tabs.create({
    url: chrome.runtime.getURL("debug-raw/index.html")
  });
}

function renderOperatorConfig(config, collectionGate) {
  if (!operatorFormDirty) {
    operatorIdInput.value = config.operatorId || "";
    accountNameInput.value = config.accountName || "";
  }

  collectionGateStatusEl.className = `gate-status ${collectionGate.canCollect ? "ok" : "problem"}`;
  collectionGateStatusEl.textContent = buildCollectionGateText(collectionGate);
}

function buildCollectionGateText(collectionGate) {
  const operatorName = collectionGate.operator?.accountName || "未配置";
  const bossName = collectionGate.bossAccount?.accountName || "未检测到";
  if (collectionGate.status === "ok") {
    return `账号已匹配：${operatorName}`;
  }
  if (collectionGate.status === "boss_account_mismatch") {
    return `严重：账号姓名不一致，配置为 ${operatorName}，BOSS 页面为 ${bossName}，采集已停止`;
  }
  if (collectionGate.status === "boss_account_unknown") {
    return "严重：未检测到 BOSS 页面展示的账号姓名，采集已停止";
  }
  return "严重：请先配置操作员ID和账号姓名，采集已停止";
}

function buildStatusRows({ modules = {}, uploadEnabled = false, hasUploadError = false } = {}) {
  return MODULE_REPORT_DEFINITIONS.map((definition) => {
    const status = getRowStatus({
      definition,
      moduleStats: modules[definition.id] || {},
      uploadEnabled,
      hasUploadError
    });
    return {
      id: definition.id,
      label: MODULE_LABELS[definition.id] || definition.label,
      status
    };
  });
}

function getRowStatus({ definition, moduleStats, uploadEnabled, hasUploadError }) {
  if (definition.id === "queue_upload" && (!uploadEnabled || hasUploadError)) {
    return "problem";
  }
  return getModuleHealthStatus(moduleStats);
}

function renderOverallStatus(status) {
  overallStatusEl.className = `overall ${status}`;
  overallStatusEl.textContent = status === "ok" ? "正常" : "需要处理";
}

function renderStatusRows(rows) {
  moduleStatusEl.innerHTML = "";
  rows.forEach((row) => {
    const rowEl = document.createElement("div");
    rowEl.className = `status-row ${row.status}`;
    rowEl.innerHTML = `
      <div class="row-main">
        <span class="dot" aria-hidden="true"></span>
        <span class="label">${escapeHtml(row.label)}</span>
      </div>
      <span class="state-text">${row.status === "ok" ? "正常" : "需处理"}</span>
    `;
    moduleStatusEl.appendChild(rowEl);
  });
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function sendRuntimeMessage(message) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response) => {
      const error = chrome.runtime.lastError;
      if (error) {
        reject(error);
        return;
      }
      resolve(response);
    });
  });
}
