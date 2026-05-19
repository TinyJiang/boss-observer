import { nowLocalIsoString } from "./time.js";

export const MODULE_REPORT_DEFINITIONS = Object.freeze([
  {
    id: "page_session",
    label: "页面会话",
    eventPrefixes: ["page_session."]
  },
  {
    id: "job_context",
    label: "职位上下文",
    eventPrefixes: ["job_context."]
  },
  {
    id: "candidate_filter",
    label: "筛选",
    eventPrefixes: ["candidate_filter."]
  },
  {
    id: "candidate_list",
    label: "候选人列表",
    eventPrefixes: ["candidate_list."]
  },
  {
    id: "candidate_detail",
    label: "候选人详情",
    eventPrefixes: ["candidate_detail."]
  },
  {
    id: "candidate_greeting",
    label: "打招呼",
    eventPrefixes: ["candidate_greeting."]
  },
  {
    id: "candidate_chat",
    label: "聊天记录",
    eventPrefixes: ["candidate_chat."]
  },
  {
    id: "queue_upload",
    label: "队列与上传",
    eventPrefixes: ["queue.", "upload."]
  }
]);

export function createEmptyProductionStats() {
  return {
    modules: Object.fromEntries(MODULE_REPORT_DEFINITIONS.map((definition) => [
      definition.id,
      createEmptyModuleStats()
    ]))
  };
}

export function normalizeProductionStats(stats = {}) {
  const empty = createEmptyProductionStats();
  const modules = {};
  for (const definition of MODULE_REPORT_DEFINITIONS) {
    modules[definition.id] = normalizeModuleStats(stats.modules?.[definition.id] || empty.modules[definition.id]);
  }

  return { modules };
}

export function recordProducedEvent(stats, event, { now = nowLocalIsoString } = {}) {
  const next = normalizeProductionStats(stats);
  const moduleId = getModuleIdForEventType(event?.type);
  const occurredAt = event?.occurredAt || now();
  if (moduleId) {
    const moduleStats = next.modules[moduleId];
    moduleStats.producedCount += 1;
    moduleStats.pendingCount += 1;
    moduleStats.lastProducedAt = occurredAt;
    moduleStats.lastEventType = event.type;
  }

  return next;
}

export function recordUploadedEvents(stats, events = [], { uploadedAt = nowLocalIsoString() } = {}) {
  const next = normalizeProductionStats(stats);
  events.forEach((event) => {
    const moduleId = getModuleIdForEventType(event?.type);
    if (moduleId) {
      const moduleStats = next.modules[moduleId];
      moduleStats.uploadedCount += 1;
      moduleStats.lastUploadedAt = uploadedAt;
    }
  });

  return next;
}

export function recordUploadFailedEvents(stats, events = [], { failedAt = nowLocalIsoString() } = {}) {
  const next = normalizeProductionStats(stats);
  events.forEach((event) => {
    const moduleId = getModuleIdForEventType(event?.type);
    if (!moduleId) {
      return;
    }

    const moduleStats = next.modules[moduleId];
    moduleStats.uploadFailedCount += 1;
    moduleStats.lastUploadFailedAt = failedAt;
  });

  return next;
}

export function syncPendingEvents(stats, events = []) {
  const next = normalizeProductionStats(stats);
  for (const moduleStats of Object.values(next.modules)) {
    moduleStats.pendingCount = 0;
  }

  events.forEach((event) => {
    const moduleId = getModuleIdForEventType(event?.type);
    if (moduleId) {
      next.modules[moduleId].pendingCount += 1;
    }
  });

  return next;
}

export function getModuleIdForEventType(eventType = "") {
  return MODULE_REPORT_DEFINITIONS.find((definition) =>
    definition.eventPrefixes.some((prefix) => String(eventType).startsWith(prefix))
  )?.id || "";
}

export function getModuleReportStatus(moduleStats = {}) {
  const stats = normalizeModuleStats(moduleStats);
  if (stats.pendingCount > 0 && stats.uploadFailedCount > 0) {
    return "retrying";
  }
  if (stats.pendingCount > 0) {
    return "pending";
  }
  if (stats.uploadFailedCount > 0 && stats.uploadedCount === 0) {
    return "failed";
  }
  if (stats.uploadedCount > 0) {
    return "uploaded";
  }
  if (stats.producedCount > 0) {
    return "recorded";
  }
  return "idle";
}

export function getModuleHealthStatus(moduleStats = {}) {
  const stats = normalizeModuleStats(moduleStats);
  if (stats.pendingCount > 0 || stats.uploadFailedCount > 0) {
    return "problem";
  }
  return "ok";
}

function createEmptyModuleStats() {
  return {
    producedCount: 0,
    pendingCount: 0,
    uploadedCount: 0,
    uploadFailedCount: 0,
    lastEventType: "",
    lastProducedAt: "",
    lastUploadedAt: "",
    lastUploadFailedAt: ""
  };
}

function normalizeModuleStats(stats = {}) {
  return {
    producedCount: toCount(stats.producedCount),
    pendingCount: toCount(stats.pendingCount),
    uploadedCount: toCount(stats.uploadedCount),
    uploadFailedCount: toCount(stats.uploadFailedCount),
    lastEventType: String(stats.lastEventType || ""),
    lastProducedAt: String(stats.lastProducedAt || ""),
    lastUploadedAt: String(stats.lastUploadedAt || ""),
    lastUploadFailedAt: String(stats.lastUploadFailedAt || "")
  };
}

function toCount(value) {
  return Number.isFinite(Number(value)) && Number(value) > 0 ? Math.floor(Number(value)) : 0;
}
