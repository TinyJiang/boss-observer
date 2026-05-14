const DEFAULT_CLS_SOURCE = "boss-observer-extension";

export function hasClsAnonymousConfig(config) {
  return Boolean(config.clsRegion && config.clsTopicId);
}

export function buildClsAnonymousTracklogUrl({ region, topicId }) {
  return `https://${region}.cls.tencentcs.com/tracklog?topic_id=${encodeURIComponent(topicId)}`;
}

export function buildClsAnonymousTracklogBody(events, { source = DEFAULT_CLS_SOURCE, now = () => Date.now() } = {}) {
  return {
    logs: events.map((event) => buildClsLog(event, { now })),
    source
  };
}

export function buildClsLog(event, { now = () => Date.now() } = {}) {
  return {
    contents: buildClsContents(event),
    time: readOccurredAtMs(event.occurredAt, now)
  };
}

export function buildClsContents(event) {
  const context = event.context || {};
  const jobContext = context.jobContext || {};

  return {
    event_id: stringifyClsValue(event.id),
    event_type: stringifyClsValue(event.type),
    occurred_at: stringifyClsValue(event.occurredAt),
    plugin_version: stringifyClsValue(event.pluginVersion),
    session_id: stringifyClsValue(context.sessionId),
    page_type: stringifyClsValue(context.pageType),
    page_url: stringifyClsValue(context.pageUrl),
    page_title: stringifyClsValue(context.pageTitle),
    is_boss_page: stringifyClsValue(context.isBossPage),
    job_id: stringifyClsValue(jobContext.jobId),
    job_status: stringifyClsValue(jobContext.jobStatus),
    source_tab_id: stringifyClsValue(event.sourceTabId),
    source_window_id: stringifyClsValue(event.sourceWindowId),
    source_tab_url: stringifyClsValue(event.sourceTabUrl),
    payload_json: stringifyJson(event.payload || {}),
    context_json: stringifyJson(context)
  };
}

function readOccurredAtMs(occurredAt, now) {
  const parsed = Date.parse(occurredAt);
  return Number.isFinite(parsed) ? parsed : now();
}

function stringifyJson(value) {
  try {
    return JSON.stringify(value);
  } catch {
    return "{}";
  }
}

function stringifyClsValue(value) {
  if (value === null || value === undefined) {
    return "";
  }

  if (typeof value === "object") {
    return stringifyJson(value);
  }

  return String(value);
}
