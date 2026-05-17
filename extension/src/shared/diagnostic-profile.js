import { normalizeNetworkDebugState } from "./network-debug.js";
import {
  getModuleHealthStatus,
  MODULE_REPORT_DEFINITIONS,
  normalizeProductionStats
} from "./production-stats.js";
import { nowLocalIsoString } from "./time.js";

export const DIAGNOSTIC_PROFILE_SCHEMA_VERSION = "1.0.0";

export function buildDiagnosticProfile(state = {}, {
  manifest = {},
  now = nowLocalIsoString
} = {}) {
  const productionStats = normalizeProductionStats(state.productionStats);
  const networkDebug = normalizeNetworkDebugState(state.networkDebug);

  return {
    schemaVersion: DIAGNOSTIC_PROFILE_SCHEMA_VERSION,
    generatedAt: now(),
    source: "boss_observer_popup",
    extension: {
      name: String(manifest.name || "BOSS Observer"),
      version: String(manifest.version || state.lastEvent?.pluginVersion || "")
    },
    runtime: {
      updatedAt: state.updatedAt || null,
      queueSize: toCount(state.queueSize),
      lastFlushAt: state.lastFlushAt || null,
      config: summarizeConfig(state.config),
      collectionGate: summarizeCollectionGate(state.collectionGate),
      lastCollectionBlock: summarizeCollectionBlock(state.lastCollectionBlock),
      upload: {
        lastUploadResult: summarizeUploadResult(state.lastUploadResult),
        lastUploadError: summarizeUploadError(state.lastUploadError)
      },
      moduleHealth: buildModuleHealth(productionStats, {
        uploadEnabled: state.config?.uploadEnabled === true,
        hasUploadError: Boolean(state.lastUploadError)
      }),
      productionStats: summarizeProductionStats(productionStats),
      networkDebug: summarizeNetworkDebug(networkDebug),
      recentEvents: summarizeRecentEvents(state.recentEvents)
    }
  };
}

export function buildDiagnosticProfileFilename(profile = {}) {
  const timestamp = String(profile.generatedAt || nowLocalIsoString())
    .replace(/[:.]/g, "-")
    .replace(/[^\dA-Za-z+-]/g, "_");
  const version = String(profile.extension?.version || "unknown").replace(/[^\w.-]/g, "_");
  return `boss-observer-profile-${version}-${timestamp}.json`;
}

function buildModuleHealth(productionStats, { uploadEnabled, hasUploadError }) {
  return Object.fromEntries(MODULE_REPORT_DEFINITIONS.map((definition) => {
    const moduleStats = productionStats.modules[definition.id] || {};
    const hasUnreportedChats = definition.id === "candidate_chat" &&
      productionStats.unreportedChats.length > 0;
    const status = definition.id === "queue_upload" && (!uploadEnabled || hasUploadError)
      ? "problem"
      : getModuleHealthStatus(moduleStats, { hasUnreportedChats });
    return [definition.id, {
      label: definition.label,
      status
    }];
  }));
}

function summarizeProductionStats(productionStats) {
  return {
    modules: productionStats.modules,
    unreportedChats: productionStats.unreportedChats.map((chat) => ({
      candidateId: chat.candidateId || "",
      displayName: chat.displayName || "",
      jobTitle: chat.jobTitle || "",
      lastMessageAt: chat.lastMessageAt || "",
      lastMessageTimeText: chat.lastMessageTimeText || "",
      lastReportedMessageAt: chat.lastReportedMessageAt || "",
      reportRequiredEventId: chat.reportRequiredEventId || "",
      updatedAt: chat.updatedAt || ""
    }))
  };
}

function summarizeRecentEvents(events = []) {
  if (!Array.isArray(events)) {
    return [];
  }
  return events.slice(0, 50).map(summarizeEvent);
}

function summarizeEvent(event = {}) {
  return compactObject({
    id: event.id || event.eventId || "",
    type: event.type || "",
    occurredAt: event.occurredAt || "",
    pluginVersion: event.pluginVersion || "",
    sourceTabId: event.sourceTabId ?? null,
    sourceWindowId: event.sourceWindowId ?? null,
    sourceTabUrl: sanitizeUrl(event.sourceTabUrl),
    operator: summarizeOperator(event.operator),
    context: summarizeContext(event.context),
    payload: summarizePayload(event.payload)
  });
}

function summarizePayload(payload = {}) {
  if (!payload || typeof payload !== "object") {
    return {};
  }

  return compactObject({
    source: payload.source || "",
    entry: payload.entry || "",
    reason: payload.reason || "",
    message: payload.message || "",
    action: payload.action || "",
    outcome: payload.outcome || "",
    clickedEventId: payload.clickedEventId || "",
    openedEventId: payload.openedEventId || "",
    elapsedMs: Number.isFinite(Number(payload.elapsedMs)) ? Number(payload.elapsedMs) : null,
    chatPageUrl: sanitizeUrl(payload.chatPageUrl),
    candidate: summarizeCandidate(payload.candidate),
    analysis: summarizeAnalysis(payload.analysis),
    listItem: summarizeChatListItem(payload.listItem),
    chat: summarizeChat(payload.chat),
    greeting: summarizeGreeting(payload.greeting),
    wechat: summarizeWechat(payload.wechat),
    job: summarizeJob(payload.job || payload.jobContext),
    filter: summarizeFilter(payload.filter),
    current: summarizeContext(payload.current),
    previous: summarizeContext(payload.previous),
    upload: summarizeUploadPayload(payload),
    payloadKeys: Object.keys(payload).sort()
  });
}

function summarizeContext(context = {}) {
  if (!context || typeof context !== "object") {
    return null;
  }

  return compactObject({
    isBossPage: context.isBossPage,
    pageType: context.pageType || "",
    pageTitle: context.pageTitle || "",
    pageUrl: sanitizeUrl(context.pageUrl || context.url),
    sessionId: context.sessionId || "",
    startedAt: context.startedAt || "",
    jobContext: summarizeJob(context.jobContext)
  });
}

function summarizeCandidate(candidate = {}) {
  if (!candidate || typeof candidate !== "object") {
    return null;
  }

  return compactObject({
    candidateId: candidate.candidateId || "",
    stableIdSource: candidate.stableIdSource || "",
    identityConfidence: candidate.identityConfidence || "",
    exposureKey: candidate.exposureKey || "",
    exposedEventId: candidate.exposedEventId || "",
    detailUrl: sanitizeUrl(candidate.detailUrl),
    profile: compactObject({
      displayName: candidate.profile?.displayName || "",
      age: candidate.profile?.age || "",
      education: candidate.profile?.education || "",
      experience: candidate.profile?.experience || "",
      jobSeekingStatus: candidate.profile?.jobSeekingStatus || "",
      activeStatus: candidate.profile?.activeStatus || ""
    })
  });
}

function summarizeChatListItem(listItem = {}) {
  if (!listItem || typeof listItem !== "object") {
    return null;
  }

  return compactObject({
    displayName: listItem.displayName || "",
    jobTitle: listItem.jobTitle || "",
    lastMessageAt: listItem.lastMessageAt || "",
    lastMessageTimeText: listItem.lastMessageTimeText || "",
    lastReportedMessageAt: listItem.lastReportedMessageAt || ""
  });
}

function summarizeChat(chat = null) {
  if (!chat || typeof chat !== "object") {
    return null;
  }
  if (Object.keys(chat).length === 0) {
    return null;
  }

  return compactObject({
    conversationKey: chat.conversationKey || "",
    jobTitle: chat.jobTitle || "",
    messageCount: toCount(chat.messageCount),
    firstMessageAt: chat.firstMessageAt || "",
    lastMessageAt: chat.lastMessageAt || "",
    coverageLastMessageAt: chat.coverageLastMessageAt || "",
    coverageSource: chat.coverageSource || "",
    listObservedLastMessageAt: chat.listObservedLastMessageAt || "",
    listObservedLastMessageTimeText: chat.listObservedLastMessageTimeText || "",
    hasUncapturedListMessage: chat.hasUncapturedListMessage,
    lastMessageFingerprint: chat.lastMessageFingerprint || "",
    snapshotCompleteness: chat.snapshotCompleteness || "",
    mayBeIncomplete: chat.mayBeIncomplete,
    mediaSummary: chat.mediaSummary || null,
    wechat: summarizeWechat(chat.wechat)
  });
}

function summarizeAnalysis(analysis = null) {
  if (!analysis || typeof analysis !== "object") {
    return null;
  }
  if (Object.keys(analysis).length === 0) {
    return null;
  }

  return compactObject({
    module: analysis.module || ""
  });
}

function summarizeGreeting(greeting = null) {
  if (!greeting || typeof greeting !== "object") {
    return null;
  }
  if (Object.keys(greeting).length === 0) {
    return null;
  }

  return compactObject({
    status: greeting.status || "",
    detectedBy: greeting.detectedBy || ""
  });
}

function summarizeWechat(wechat = null) {
  if (!wechat || typeof wechat !== "object") {
    return null;
  }
  if (Object.keys(wechat).length === 0) {
    return null;
  }

  return compactObject({
    accountCount: Array.isArray(wechat.accounts) ? wechat.accounts.length : 0,
    source: wechat.source || "",
    detectedAtMessageAt: wechat.detectedAtMessageAt || "",
    detectedAtMessageFingerprint: wechat.detectedAtMessageFingerprint || ""
  });
}

function summarizeJob(job = {}) {
  if (!job || typeof job !== "object") {
    return null;
  }

  return compactObject({
    jobId: job.jobId || "",
    jobTitle: job.jobTitle || job.title || "",
    source: job.source || "",
    confidence: job.confidence || ""
  });
}

function summarizeFilter(filter = {}) {
  if (!filter || typeof filter !== "object") {
    return null;
  }

  return compactObject({
    action: filter.action || "",
    selectedCount: Array.isArray(filter.selectedOptions) ? filter.selectedOptions.length : null,
    summary: filter.summary || ""
  });
}

function summarizeUploadPayload(payload = {}) {
  if (!payload || typeof payload !== "object") {
    return null;
  }
  if (
    payload.targetType === undefined &&
    payload.batchSize === undefined &&
    payload.status === undefined &&
    payload.errorMessage === undefined
  ) {
    return null;
  }

  return compactObject({
    targetType: payload.targetType || "",
    batchSize: toCount(payload.batchSize),
    status: Number.isFinite(Number(payload.status)) ? Number(payload.status) : null,
    errorMessage: payload.errorMessage || payload.message || ""
  });
}

function summarizeConfig(config = {}) {
  if (!config || typeof config !== "object") {
    return null;
  }

  return compactObject({
    enabled: config.enabled === true,
    debug: config.debug === true,
    operatorConfigured: Boolean(config.operatorId && config.accountName),
    operatorId: config.operatorId || "",
    accountName: config.accountName || "",
    uploadEnabled: config.uploadEnabled === true,
    uploadTargetType: getUploadTargetType(config),
    uploadEndpointConfigured: Boolean(config.uploadEndpoint),
    clsRegion: config.clsRegion || "",
    clsTopicConfigured: Boolean(config.clsTopicId),
    clsSource: config.clsSource || "",
    uploadBatchSize: toCount(config.uploadBatchSize),
    maxQueueSize: toCount(config.maxQueueSize),
    flushIntervalMs: toCount(config.flushIntervalMs),
    minDwellMs: toCount(config.minDwellMs)
  });
}

function getUploadTargetType(config = {}) {
  if (config.uploadEnabled !== true) {
    return "disabled";
  }
  if (config.clsRegion && config.clsTopicId) {
    return "cls_anonymous";
  }
  if (config.uploadEndpoint) {
    return "custom_endpoint";
  }
  return "none";
}

function summarizeCollectionGate(gate = null) {
  if (!gate || typeof gate !== "object") {
    return null;
  }

  return compactObject({
    status: gate.status || "",
    canCollect: gate.canCollect === true,
    severity: gate.severity || "",
    message: gate.message || "",
    operator: summarizeOperator(gate.operator),
    bossAccount: summarizeBossAccount(gate.bossAccount)
  });
}

function summarizeCollectionBlock(block = null) {
  if (!block || typeof block !== "object") {
    return null;
  }

  return compactObject({
    blockedAt: block.blockedAt || "",
    reason: block.reason || "",
    severity: block.severity || "",
    message: block.message || "",
    eventType: block.eventType || "",
    sourceTabId: block.sourceTabId ?? null,
    sourceWindowId: block.sourceWindowId ?? null,
    sourceTabUrl: sanitizeUrl(block.sourceTabUrl)
  });
}

function summarizeOperator(operator = null) {
  if (!operator || typeof operator !== "object") {
    return null;
  }

  return compactObject({
    operatorId: operator.operatorId || "",
    accountName: operator.accountName || "",
    bossAccountName: operator.bossAccountName || "",
    bossAccountMatched: operator.bossAccountMatched
  });
}

function summarizeBossAccount(account = null) {
  if (!account || typeof account !== "object") {
    return null;
  }

  return compactObject({
    accountName: account.accountName || "",
    source: account.source || "",
    confidence: account.confidence || "",
    observedAt: account.observedAt || "",
    pageUrl: sanitizeUrl(account.pageUrl)
  });
}

function summarizeUploadResult(result = null) {
  if (!result || typeof result !== "object") {
    return null;
  }

  return compactObject({
    targetType: result.targetType || "",
    status: Number.isFinite(Number(result.status)) ? Number(result.status) : null,
    batchSize: toCount(result.batchSize),
    uploadedAt: result.uploadedAt || "",
    hasRequestId: Boolean(result.requestId)
  });
}

function summarizeUploadError(error = null) {
  if (!error || typeof error !== "object") {
    return null;
  }

  return compactObject({
    message: error.message || "",
    occurredAt: error.occurredAt || "",
    batchSize: toCount(error.batchSize),
    retryErrorMessage: error.retryError?.message || ""
  });
}

function summarizeNetworkDebug(networkDebug = {}) {
  return {
    enabled: networkDebug.enabled === true,
    updatedAt: networkDebug.updatedAt || null,
    startedAt: networkDebug.startedAt || null,
    stoppedAt: networkDebug.stoppedAt || null,
    requestCount: toCount(networkDebug.requestCount),
    recentRequestCount: Array.isArray(networkDebug.recentRequests) ? networkDebug.recentRequests.length : 0,
    recentRequests: (networkDebug.recentRequests || []).slice(0, 30).map((request) => compactObject({
      id: request.id || "",
      observedAt: request.observedAt || "",
      sourcePageUrl: sanitizeUrl(request.sourcePageUrl),
      category: request.category || "",
      type: request.type || "",
      method: request.method || "",
      url: sanitizeUrl(request.url),
      status: Number.isFinite(Number(request.status)) ? Number(request.status) : null,
      ok: request.ok === true,
      durationMs: Number.isFinite(Number(request.durationMs)) ? Number(request.durationMs) : null,
      requestBodyLength: Number.isFinite(Number(request.requestBodyLength)) ? Number(request.requestBodyLength) : null,
      requestBodyTruncated: request.requestBodyTruncated === true,
      responseContentType: request.responseContentType || "",
      responseBodyLength: Number.isFinite(Number(request.responseBodyLength)) ? Number(request.responseBodyLength) : null,
      responseBodyTruncated: request.responseBodyTruncated === true,
      error: request.error || ""
    }))
  };
}

function sanitizeUrl(value = "") {
  const raw = String(value || "");
  if (!raw) {
    return "";
  }

  try {
    const parsed = new URL(raw, "https://www.zhipin.com");
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return raw.split("?")[0].split("#")[0];
  }
}

function toCount(value) {
  return Number.isFinite(Number(value)) && Number(value) > 0 ? Math.floor(Number(value)) : 0;
}

function compactObject(object = {}) {
  return Object.fromEntries(
    Object.entries(object).filter(([, value]) => {
      if (Array.isArray(value)) {
        return value.length > 0;
      }
      if (value && typeof value === "object") {
        return Object.keys(value).length > 0;
      }
      return value !== "" && value !== null && value !== undefined;
    })
  );
}
