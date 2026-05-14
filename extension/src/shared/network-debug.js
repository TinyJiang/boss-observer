import { nowLocalIsoString } from "./time.js";

export const NETWORK_DEBUG_MAX_RECENT_REQUESTS = 80;
export const NETWORK_DEBUG_MAX_PREVIEW_CHARS = 12000;
export const NETWORK_DEBUG_REQUEST_CATEGORY_ALL = "all";
export const NETWORK_DEBUG_REQUEST_CATEGORY_OPTIONS = [
  {
    value: NETWORK_DEBUG_REQUEST_CATEGORY_ALL,
    label: "全部请求"
  },
  {
    value: "candidate_detail",
    label: "候选人详情"
  },
  {
    value: "candidate_list",
    label: "候选人列表"
  },
  {
    value: "job_list",
    label: "职位列表"
  },
  {
    value: "remark",
    label: "备注/屏蔽"
  },
  {
    value: "page_support",
    label: "页面辅助"
  },
  {
    value: "analytics",
    label: "埋点/APM"
  },
  {
    value: "static_asset",
    label: "静态资源"
  },
  {
    value: "other",
    label: "其他"
  }
];

const CONTACT_TEXT_PATTERN = /(?:微信|手机号|手机|电话|联系方式|wechat|weixin|wx)/i;
const CONTACT_FIELD_KEY_PATTERN = /(?:微信|手机号|手机|电话|联系方式|wechat|weixin|wx|mobile|phone|tel|contact|email|mail)/i;
const DETAIL_INFO_PATH = "/wapi/zpjob/view/geek/info/v2";
const CANDIDATE_LIST_PATHS = new Set([
  "/wapi/zpitem/web/boss/search/getRelatedInfo",
  "/wapi/zpitem/web/rec/showCard"
]);
const JOB_LIST_PATHS = new Set([
  "/wapi/zpjob/job/search/job/list"
]);
const REMARK_PATHS = new Set([
  "/wapi/zpboss/h5/mate/remarkList.json",
  "/wapi/zpboss/h5/inner/remark/isInnerAccount"
]);
const PAGE_SUPPORT_PATHS = new Set([
  "/wapi/zpitem/web/push/get",
  "/wapi/zpblock/vip/privilege/guide"
]);
const ACTION_LOG_PATHS = new Set([
  "/wapi/zpCommon/actionLog/common.json"
]);

export function createEmptyNetworkDebugState() {
  return {
    enabled: false,
    updatedAt: null,
    startedAt: null,
    stoppedAt: null,
    requestCount: 0,
    recentRequests: [],
    maxRecentRequests: NETWORK_DEBUG_MAX_RECENT_REQUESTS,
    maxPreviewChars: NETWORK_DEBUG_MAX_PREVIEW_CHARS
  };
}

export function setNetworkDebugEnabled(state, enabled, { now = nowLocalIsoString } = {}) {
  const current = normalizeNetworkDebugState(state);
  const timestamp = now();
  return {
    ...current,
    enabled: Boolean(enabled),
    updatedAt: timestamp,
    startedAt: enabled ? timestamp : current.startedAt,
    stoppedAt: enabled ? current.stoppedAt : timestamp
  };
}

export function clearNetworkDebugRequests(state, { now = nowLocalIsoString } = {}) {
  const current = normalizeNetworkDebugState(state);
  return {
    ...current,
    updatedAt: now(),
    requestCount: 0,
    recentRequests: []
  };
}

export function appendNetworkDebugRequest(state, request, { now = nowLocalIsoString } = {}) {
  const current = normalizeNetworkDebugState(state);
  const sanitized = sanitizeNetworkDebugRequest(request, {
    maxPreviewChars: current.maxPreviewChars
  });
  return {
    ...current,
    updatedAt: now(),
    requestCount: current.requestCount + 1,
    recentRequests: [sanitized, ...current.recentRequests].slice(0, current.maxRecentRequests)
  };
}

export function sanitizeNetworkDebugRequest(request = {}, {
  maxPreviewChars = NETWORK_DEBUG_MAX_PREVIEW_CHARS
} = {}) {
  const url = String(request.url || "");
  const responsePreview = sanitizePreviewText(request.responseBodyPreview || "", maxPreviewChars, {
    preserveContactKeywordStructure: isGeekDetailInfoUrl(url)
  });
  const requestPreview = sanitizePreviewText(request.requestBodyPreview || "", Math.min(maxPreviewChars, 2000));

  return {
    id: String(request.id || ""),
    observedAt: String(request.observedAt || ""),
    sourcePageUrl: String(request.sourcePageUrl || ""),
    category: classifyNetworkDebugRequest({ url }),
    type: normalizeRequestType(request.type),
    method: String(request.method || "GET").toUpperCase(),
    url,
    status: Number.isFinite(Number(request.status)) ? Number(request.status) : null,
    statusText: String(request.statusText || ""),
    ok: request.ok === true,
    durationMs: Number.isFinite(Number(request.durationMs)) ? Number(request.durationMs) : null,
    requestBodyPreview: requestPreview.value,
    requestBodyLength: Number.isFinite(Number(request.requestBodyLength)) ? Number(request.requestBodyLength) : requestPreview.originalLength,
    requestBodyTruncated: Boolean(request.requestBodyTruncated || requestPreview.truncated),
    responseContentType: String(request.responseContentType || ""),
    responseBodyPreview: responsePreview.value,
    responseBodyLength: Number.isFinite(Number(request.responseBodyLength)) ? Number(request.responseBodyLength) : responsePreview.originalLength,
    responseBodyTruncated: Boolean(request.responseBodyTruncated || responsePreview.truncated),
    error: String(request.error || "")
  };
}

export function isGeekDetailInfoUrl(url = "") {
  try {
    return new URL(url, "https://www.zhipin.com").pathname === DETAIL_INFO_PATH;
  } catch {
    return String(url || "").includes(DETAIL_INFO_PATH);
  }
}

export function classifyNetworkDebugRequest(request = {}) {
  const parsed = parseRequestUrl(request.url || "");
  if (!parsed) {
    return "other";
  }

  const { host, pathname } = parsed;
  if (pathname === DETAIL_INFO_PATH) {
    return "candidate_detail";
  }
  if (CANDIDATE_LIST_PATHS.has(pathname)) {
    return "candidate_list";
  }
  if (JOB_LIST_PATHS.has(pathname)) {
    return "job_list";
  }
  if (REMARK_PATHS.has(pathname)) {
    return "remark";
  }
  if (PAGE_SUPPORT_PATHS.has(pathname)) {
    return "page_support";
  }
  if (
    ACTION_LOG_PATHS.has(pathname) ||
    host === "apm-fe.zhipin.com" ||
    host === "logapi.zhipin.com" ||
    host === "shink.zhipin.com" ||
    pathname.includes("/zpApm/")
  ) {
    return "analytics";
  }
  if (
    host === "static.zhipin.com" ||
    pathname.endsWith(".wasm") ||
    pathname.includes("/assets/")
  ) {
    return "static_asset";
  }

  return "other";
}

export function filterNetworkDebugRequests(requests = [], category = NETWORK_DEBUG_REQUEST_CATEGORY_ALL) {
  if (!Array.isArray(requests)) {
    return [];
  }
  if (!isKnownNetworkDebugRequestCategory(category) || category === NETWORK_DEBUG_REQUEST_CATEGORY_ALL) {
    return requests;
  }

  return requests.filter((request) => (request.category || classifyNetworkDebugRequest(request)) === category);
}

export function normalizeNetworkDebugState(state = {}) {
  const empty = createEmptyNetworkDebugState();
  return {
    ...empty,
    ...state,
    enabled: state.enabled === true,
    requestCount: Number.isFinite(Number(state.requestCount)) ? Number(state.requestCount) : 0,
    recentRequests: Array.isArray(state.recentRequests) ? state.recentRequests : [],
    maxRecentRequests: Number.isFinite(Number(state.maxRecentRequests)) ?
      Number(state.maxRecentRequests) :
      empty.maxRecentRequests,
    maxPreviewChars: Number.isFinite(Number(state.maxPreviewChars)) ?
      Number(state.maxPreviewChars) :
      empty.maxPreviewChars
  };
}

function sanitizePreviewText(value, maxPreviewChars, {
  preserveContactKeywordStructure = false
} = {}) {
  const raw = stringifyPreviewValue(value);
  const redacted = CONTACT_TEXT_PATTERN.test(raw) && !preserveContactKeywordStructure ?
    "" :
    redactSensitivePreview(raw, { preserveContactKeywordStructure });
  return {
    value: truncatePreview(redacted, maxPreviewChars),
    originalLength: raw.length,
    truncated: redacted.length > maxPreviewChars
  };
}

function redactSensitivePreview(value, { preserveContactKeywordStructure }) {
  if (!preserveContactKeywordStructure) {
    return redactDirectContacts(value);
  }

  const parsed = tryParseJson(value);
  if (parsed.ok) {
    return JSON.stringify(redactSensitiveJson(parsed.value));
  }

  return redactContactFieldText(redactDirectContacts(value));
}

function tryParseJson(value) {
  try {
    return {
      ok: true,
      value: JSON.parse(value)
    };
  } catch {
    return {
      ok: false,
      value: null
    };
  }
}

function redactSensitiveJson(value, key = "") {
  if (CONTACT_FIELD_KEY_PATTERN.test(key)) {
    return "[redacted_contact]";
  }

  if (Array.isArray(value)) {
    return value.map((item) => redactSensitiveJson(item));
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([entryKey, entryValue]) => [
        entryKey,
        redactSensitiveJson(entryValue, entryKey)
      ])
    );
  }

  if (typeof value === "string") {
    const directRedacted = redactDirectContacts(value);
    return CONTACT_TEXT_PATTERN.test(directRedacted) ? "[redacted_contact_text]" : directRedacted;
  }

  return value;
}

function stringifyPreviewValue(value) {
  if (typeof value === "string") {
    return value;
  }
  if (value === null || value === undefined) {
    return "";
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function redactDirectContacts(value) {
  return value
    .replace(/1[3-9]\d{9}/g, "[redacted_phone]")
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "[redacted_email]");
}

function redactContactFieldText(value) {
  return value.replace(
    new RegExp(`("(?:[^"]*${CONTACT_FIELD_KEY_PATTERN.source}[^"]*)"\\s*:\\s*)"[^"]*"`, "gi"),
    "$1\"[redacted_contact]\""
  );
}

function truncatePreview(value, maxPreviewChars) {
  if (value.length <= maxPreviewChars) {
    return value;
  }
  return `${value.slice(0, maxPreviewChars)}...`;
}

function normalizeRequestType(type) {
  return type === "xhr" ? "xhr" : "fetch";
}

function parseRequestUrl(url) {
  try {
    const parsed = new URL(String(url || ""), "https://www.zhipin.com");
    return parsed;
  } catch {
    return null;
  }
}

function isKnownNetworkDebugRequestCategory(category) {
  return NETWORK_DEBUG_REQUEST_CATEGORY_OPTIONS.some((option) => option.value === category);
}
