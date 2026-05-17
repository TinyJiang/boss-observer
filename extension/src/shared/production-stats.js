import { EVENT_TYPES } from "./event-types.js";
import {
  getChatSnapshotCoverageLastMessageAt,
  isIsoTimeAtOrAfter
} from "./chat-snapshot-coverage.js";
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

const MAX_UNREPORTED_CHAT_COUNT = 50;

export function createEmptyProductionStats() {
  return {
    modules: Object.fromEntries(MODULE_REPORT_DEFINITIONS.map((definition) => [
      definition.id,
      createEmptyModuleStats()
    ])),
    unreportedChats: []
  };
}

export function normalizeProductionStats(stats = {}) {
  const empty = createEmptyProductionStats();
  const modules = {};
  for (const definition of MODULE_REPORT_DEFINITIONS) {
    modules[definition.id] = normalizeModuleStats(stats.modules?.[definition.id] || empty.modules[definition.id]);
  }

  return {
    modules,
    unreportedChats: normalizeUnreportedChats(stats.unreportedChats)
  };
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

  if (event?.type === EVENT_TYPES.CANDIDATE_CHAT_REPORT_REQUIRED) {
    next.unreportedChats = upsertUnreportedChat(next.unreportedChats, event, occurredAt);
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

    if (event?.type === EVENT_TYPES.CANDIDATE_CHAT_SNAPSHOT_CAPTURED) {
      next.unreportedChats = removeReportedChat(next.unreportedChats, event);
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

export function getModuleHealthStatus(moduleStats = {}, { hasUnreportedChats = false } = {}) {
  const stats = normalizeModuleStats(moduleStats);
  if (hasUnreportedChats || stats.pendingCount > 0 || stats.uploadFailedCount > 0) {
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

function upsertUnreportedChat(chats, event, updatedAt) {
  const candidate = event.payload?.candidate || {};
  const listItem = event.payload?.listItem || {};
  const candidateId = candidate.candidateId || "";
  const displayName = candidate.profile?.displayName || listItem.displayName || candidate.stableId || "";
  if ((!candidateId && !displayName) || isInvalidUnreportedChatDisplayName(displayName)) {
    return chats;
  }

  const nextChat = {
    candidateId,
    displayName: displayName || "未识别候选人",
    jobTitle: listItem.jobTitle || "",
    lastMessageAt: listItem.lastMessageAt || "",
    lastMessageTimeText: listItem.lastMessageTimeText || "",
    lastReportedMessageAt: listItem.lastReportedMessageAt || "",
    reportRequiredEventId: event.eventId || "",
    updatedAt
  };
  const identityKey = buildChatIdentityKey(nextChat);
  return [
    nextChat,
    ...chats.filter((chat) => buildChatIdentityKey(chat) !== identityKey)
  ].slice(0, MAX_UNREPORTED_CHAT_COUNT);
}

function removeReportedChat(chats, event) {
  const snapshotLastMessageAt = getChatSnapshotCoverageLastMessageAt(event.payload?.chat);

  return chats.filter((chat) => {
    if (!doesSnapshotMatchUnreportedChat(chat, event)) {
      return true;
    }
    return !isSnapshotCoveringRequiredMessage(snapshotLastMessageAt, chat.lastMessageAt);
  });
}

function doesSnapshotMatchUnreportedChat(chat = {}, event = {}) {
  const snapshotCandidate = event.payload?.candidate || {};
  const candidateId = snapshotCandidate.candidateId || "";
  if (candidateId && chat.candidateId === candidateId) {
    return true;
  }

  const requiredName = normalizeCandidateName(chat.displayName);
  const snapshotName = normalizeCandidateName(snapshotCandidate.profile?.displayName);
  if (!requiredName || requiredName !== snapshotName) {
    return false;
  }

  return areChatJobTitlesCompatible(chat.jobTitle, event.payload?.chat?.jobTitle);
}

function areChatJobTitlesCompatible(requiredJobTitle = "", snapshotJobTitle = "") {
  const required = normalizeChatJobTitleForMatch(requiredJobTitle);
  const snapshot = normalizeChatJobTitleForMatch(snapshotJobTitle);
  if (!required || !snapshot) {
    return false;
  }
  return required === snapshot || required.includes(snapshot) || snapshot.includes(required);
}

function isSnapshotCoveringRequiredMessage(snapshotLastMessageAt, requiredLastMessageAt) {
  return isIsoTimeAtOrAfter(snapshotLastMessageAt, requiredLastMessageAt);
}

function normalizeUnreportedChat(chat = {}) {
  const candidateId = String(chat.candidateId || "");
  const displayName = String(chat.displayName || "");
  if ((!candidateId && !displayName) || isInvalidUnreportedChatDisplayName(displayName)) {
    return null;
  }

  return {
    candidateId,
    displayName: displayName || "未识别候选人",
    jobTitle: String(chat.jobTitle || ""),
    lastMessageAt: String(chat.lastMessageAt || ""),
    lastMessageTimeText: String(chat.lastMessageTimeText || ""),
    lastReportedMessageAt: String(chat.lastReportedMessageAt || ""),
    reportRequiredEventId: String(chat.reportRequiredEventId || ""),
    updatedAt: String(chat.updatedAt || "")
  };
}

function normalizeUnreportedChats(chats = []) {
  if (!Array.isArray(chats)) {
    return [];
  }

  const normalizedChats = [];
  const seenKeys = new Set();
  chats.map(normalizeUnreportedChat).filter(Boolean).forEach((chat) => {
    const key = buildChatIdentityKey(chat);
    if (seenKeys.has(key)) {
      return;
    }
    seenKeys.add(key);
    normalizedChats.push(chat);
  });
  return normalizedChats.slice(0, MAX_UNREPORTED_CHAT_COUNT);
}

function buildChatIdentityKey(chat = {}) {
  const name = normalizeCandidateName(chat.displayName);
  const jobTitle = normalizeChatJobTitleForMatch(chat.jobTitle);
  if (name) {
    return `${name}:${jobTitle}`;
  }
  return chat.candidateId || `${chat.displayName || ""}:${chat.lastMessageAt || ""}`;
}

function normalizeText(value = "") {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function normalizeCandidateName(value = "") {
  return normalizeText(value).replace(/\s+/g, "");
}

function normalizeChatJobTitleForMatch(value = "") {
  return normalizeText(value)
    .replace(/^.*?沟通职位：/, "")
    .replace(/^\d{1,2}月\d{1,2}日\s*沟通的职位-/, "")
    .replace(/^[^【]{1,20}·(?=【)/, "")
    .replace(/\s+/g, "");
}

function isInvalidUnreportedChatDisplayName(value = "") {
  const normalized = normalizeCandidateName(value);
  if (!normalized || normalized.length > 24 || /[【】]/.test(normalized)) {
    return true;
  }
  if (normalized.includes("沟通") ||
    normalized.includes("职位") ||
    normalized.includes("发送") ||
    normalized.includes("在线简历") ||
    normalized.includes("附件简历")) {
    return true;
  }
  return /^(\d{4}-\d{1,2}-\d{1,2}|\d{1,2}-\d{1,2}|\d{1,2}月\d{1,2}日|今天|昨天|刚刚|\d+分钟前)/.test(normalized);
}
