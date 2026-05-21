import {
  buildCandidateSnapshotPayload,
  compactCandidateSnapshotPayload,
  compactPayloadObject,
  detectCandidateSignals,
  isCandidateDetailUrl,
  normalizeText
} from "./candidate-card.js";
import { findCandidateCardAncestor } from "./candidate-list-probe.js";
import {
  getCandidateCardAssociationById,
  getCandidateCardAssociationFromElement,
  getRecentCandidateDetailAssociation,
  mergeCandidateSnapshotWithAssociation,
  recordCandidateCardInteraction
} from "./candidate-card-registry.js";
import { EVENT_TYPES } from "../shared/event-types.js";

const SCAN_INTERVAL_MS = 1000;
const RESULT_TIMEOUT_MS = 12000;
const MAX_ACTION_ANCESTOR_STEPS = 6;
const MAX_CONTEXT_ANCESTOR_STEPS = 10;
const MAX_CONTEXT_TEXT_LENGTH = 60000;
const MAX_NEARBY_CONTEXT_ELEMENTS = 120;
const LIST_PAGE_TYPES = new Set([
  "candidate_recommend",
  "candidate_search",
  "candidate_intention",
  "candidate_interaction"
]);

const RESULT_MESSAGE_SELECTOR = [
  "[role='alert']",
  "[class*='toast']",
  "[class*='Toast']",
  "[class*='message']",
  "[class*='Message']",
  "[class*='notice']",
  "[class*='Notice']",
  "[class*='tip']",
  "[class*='Tip']",
  "[class*='dialog']",
  "[class*='Dialog']",
  "[class*='popover']",
  "[class*='Popover']"
].join(",");

const FAILURE_SIGNAL_RULES = [
  ["send_failed", ["打招呼失败", "发送失败", "发送未成功", "失败"]],
  ["quota_limit", ["打招呼人数已达上限", "已达上限", "达到上限", "次数不足", "余额不足"]],
  ["rate_limited", ["操作频繁", "太频繁", "稍后再试", "系统繁忙"]],
  ["risk_control", ["账号异常", "风险", "验证", "权限不足", "限制"]],
  ["network_error", ["网络异常", "网络错误", "请求失败"]]
];

const SUCCESS_SIGNAL_RULES = [
  ["greeting_succeeded", ["打招呼成功", "已打招呼"]],
  ["message_sent", ["发送成功", "已发送"]],
  ["communication_started", ["沟通已发起", "已发起沟通", "等待对方回复", "继续沟通", "开聊"]]
];

const NON_ACTION_GREETING_TEXT_RULES = [
  "已打招呼",
  "打招呼成功",
  "打招呼失败",
  "今日打招呼",
  "打招呼人数",
  "已达上限"
];

// Responsibilities:
// - observe greet button clicks in top page and same-origin frames
// - emit factual click/success/failure events only when the page exposes them
// - avoid storing greeting copy, chat text, phone numbers, or WeChat IDs
export class GreetingProbe {
  constructor({
    collector,
    sessionContext,
    scanIntervalMs = SCAN_INTERVAL_MS,
    resultTimeoutMs = RESULT_TIMEOUT_MS,
    detectOutcome = detectGreetingOutcome,
    now = () => Date.now()
  }) {
    this.collector = collector;
    this.sessionContext = sessionContext;
    this.scanIntervalMs = scanIntervalMs;
    this.resultTimeoutMs = resultTimeoutMs;
    this.detectOutcome = detectOutcome;
    this.now = now;
    this.started = false;
    this.pollHandle = null;
    this.observedDocuments = new Map();
    this.pendingAttempts = new Map();
  }

  start() {
    if (this.started) {
      return;
    }

    this.started = true;
    this.safeScan("start");
    this.pollHandle = globalThis.setInterval(() => this.safeScan("poll"), this.scanIntervalMs);
  }

  stop() {
    if (!this.started) {
      return;
    }

    this.started = false;
    if (this.pollHandle !== null) {
      globalThis.clearInterval(this.pollHandle);
      this.pollHandle = null;
    }

    this.observedDocuments.forEach((listener, currentDocument) => {
      currentDocument.removeEventListener?.("click", listener, true);
    });
    this.observedDocuments.clear();
    this.pendingAttempts.clear();
  }

  scan(source) {
    this.attachAvailableDocuments();
    this.resolvePendingAttempts(source);
  }

  safeScan(source) {
    try {
      this.scan(source);
    } catch (error) {
      this.collector.collect(EVENT_TYPES.PLUGIN_EXCEPTION, {
        source: `candidate_greeting:${source}`,
        message: error instanceof Error ? error.message : String(error)
      });
    }
  }

  recordGreetingClickTarget({
    source = "click",
    sourceUrl = "",
    entry = "unknown",
    text = "",
    dataset = {},
    links = [],
    candidateAssociation = null,
    actionElement = null,
    currentDocument = null
  } = {}) {
    const { payload, targetKey } = buildGreetingClickAttemptPayload({
      source,
      sourceUrl,
      entry,
      text,
      dataset,
      links,
      candidateAssociation
    });
    const clickedEvent = this.collector.collect(EVENT_TYPES.CANDIDATE_GREETING_CLICKED, payload);
    if (payload.candidate?.candidateId) {
      recordCandidateCardInteraction(payload.candidate.candidateId, {
        interactionType: "candidate_greeting_clicked",
        sourceUrl,
        now: this.now
      });
    }
    this.pendingAttempts.set(targetKey, {
      payload,
      targetKey,
      actionElement,
      currentDocument,
      clickedAtMs: this.now(),
      clickedEventId: clickedEvent?.id || ""
    });
    return clickedEvent;
  }

  attachAvailableDocuments() {
    if (!globalThis.document) {
      return;
    }

    collectAccessibleDocuments(globalThis.document).forEach((currentDocument) => {
      if (this.observedDocuments.has(currentDocument)) {
        return;
      }

      const listener = (event) => this.handleDocumentClick(event, currentDocument);
      currentDocument.addEventListener?.("click", listener, true);
      this.observedDocuments.set(currentDocument, listener);
    });
  }

  handleDocumentClick(event, currentDocument) {
    const actionElement = findGreetingActionElement(event.target);
    if (!actionElement) {
      return;
    }

    const target = buildGreetingClickTargetFromElement({
      actionElement,
      currentDocument,
      page: this.sessionContext.page,
      now: this.now
    });
    this.recordGreetingClickTarget(target);
  }

  resolvePendingAttempts(source) {
    const documents = Array.from(this.observedDocuments.keys());
    this.pendingAttempts.forEach((attempt, targetKey) => {
      const elapsedMs = this.now() - attempt.clickedAtMs;
      if (elapsedMs > this.resultTimeoutMs) {
        this.pendingAttempts.delete(targetKey);
        return;
      }

      const outcome = this.detectOutcome(attempt, documents);
      if (!outcome?.status) {
        return;
      }

      const type = outcome.status === "succeeded"
        ? EVENT_TYPES.CANDIDATE_GREETING_SUCCEEDED
        : EVENT_TYPES.CANDIDATE_GREETING_FAILED;
      this.collector.collect(type, buildGreetingResultPayload({
        source,
        attempt,
        outcome,
        elapsedMs
      }));
      this.pendingAttempts.delete(targetKey);
    });
  }
}

export function buildGreetingClickPayload({
  source = "click",
  sourceUrl = "",
  entry = "unknown",
  text = "",
  dataset = {},
  links = [],
  candidateAssociation = null
} = {}) {
  return buildGreetingClickAttemptPayload({
    source,
    sourceUrl,
    entry,
    text,
    dataset,
    links,
    candidateAssociation
  }).payload;
}

function buildGreetingClickAttemptPayload({
  source = "click",
  sourceUrl = "",
  entry = "unknown",
  text = "",
  dataset = {},
  links = [],
  candidateAssociation = null
} = {}) {
  const candidate = mergeCandidateSnapshotWithAssociation(buildCandidateSnapshotPayload({
    text,
    dataset,
    links,
    sourceUrl
  }), candidateAssociation);
  const hydratedCandidate = mergeCandidateSnapshotWithAssociation(
    candidate,
    getCandidateCardAssociationById(candidate.candidateId)
  );
  const targetKey = buildGreetingTargetKey({ candidate: hydratedCandidate, sourceUrl, entry });

  return {
    targetKey,
    payload: compactPayloadObject({
      source,
      entry,
      candidate: compactCandidateSnapshotPayload(hydratedCandidate)
    })
  };
}

export function buildGreetingResultPayload({
  source = "poll",
  attempt,
  outcome,
  elapsedMs = 0
} = {}) {
  return compactPayloadObject({
    source,
    entry: attempt.payload.entry,
    clickedEventId: attempt.clickedEventId,
    elapsedMs: Math.max(0, elapsedMs),
    candidate: compactCandidateSnapshotPayload(attempt.payload.candidate),
    greeting: {
      status: outcome.status,
      detectedBy: outcome.detectedBy || "unknown"
    }
  });
}

export function classifyGreetingResultText(text = "") {
  const normalizedText = normalizeText(text);
  const failureSignals = collectMatchedSignals(normalizedText, FAILURE_SIGNAL_RULES);
  if (failureSignals.length > 0) {
    return {
      status: "failed",
      matchedSignals: failureSignals
    };
  }

  const successSignals = collectMatchedSignals(normalizedText, SUCCESS_SIGNAL_RULES);
  if (successSignals.length > 0) {
    return {
      status: "succeeded",
      matchedSignals: successSignals
    };
  }

  return {
    status: "",
    matchedSignals: []
  };
}

export function isGreetingActionText(text = "") {
  const normalizedText = normalizeText(text);
  return normalizedText.length > 0 &&
    normalizedText.length <= 40 &&
    normalizedText.includes("打招呼") &&
    !NON_ACTION_GREETING_TEXT_RULES.some((keyword) => normalizedText.includes(keyword)) &&
    !hasCandidateProfileSignals(normalizedText) &&
    !normalizedText.includes("招呼语") &&
    !normalizedText.includes("打招呼设置");
}

export function findGreetingActionElement(target) {
  let current = target;
  let fallback = null;
  for (let steps = 0; current && steps < MAX_ACTION_ANCESTOR_STEPS; steps += 1) {
    if (isGreetingActionText(readActionText(current))) {
      fallback ||= current;
      if (isInteractiveActionElement(current)) {
        return current;
      }
    }
    current = current.parentElement;
  }
  return fallback;
}

export function detectGreetingOutcome(attempt, documents = []) {
  const actionOutcome = classifyGreetingResultText(readActionText(attempt.actionElement));
  if (actionOutcome.status) {
    return {
      ...actionOutcome,
      detectedBy: "action_state"
    };
  }

  const messageOutcome = detectGreetingMessageOutcome([
    attempt.currentDocument,
    ...documents
  ]);
  if (messageOutcome.status) {
    return messageOutcome;
  }

  return {
    status: "",
    matchedSignals: []
  };
}

export function buildGreetingClickTargetFromElement({ actionElement, currentDocument, page, now = () => Date.now() }) {
  const context = resolveGreetingContextElement({ actionElement, currentDocument, page, now });
  return {
    source: "click",
    sourceUrl: context.sourceUrl,
    entry: context.entry,
    actionText: readActionText(actionElement),
    text: readElementText(context.element),
    dataset: readMergedDataset(context.element),
    links: readLinks(context.element),
    candidateAssociation: context.candidateAssociation,
    actionElement,
    currentDocument
  };
}

function resolveGreetingContextElement({ actionElement, currentDocument, page, now }) {
  const sourceUrl = currentDocument?.location?.href || globalThis.location?.href || "";
  const card = findCandidateCardAncestor(actionElement);
  const nearbyContext = findNearbyCandidateContextElement(actionElement, currentDocument);
  const contextElement = card ||
    findCandidateSnapshotAncestor(actionElement) ||
    nearbyContext ||
    actionElement;
  const directAssociation = getCandidateCardAssociationFromElement(actionElement) ||
    getCandidateCardAssociationFromElement(contextElement);
  const recentDetailAssociation = getRecentGreetingCandidateAssociation({
    contextElement,
    directAssociation,
    now
  });
  const entry = inferGreetingEntry({
    page,
    sourceUrl,
    card,
    recentDetailAssociation,
    contextElement
  });
  return {
    element: contextElement,
    sourceUrl,
    entry,
    candidateAssociation: directAssociation || recentDetailAssociation
  };
}

function inferGreetingEntry({ page, sourceUrl, card, recentDetailAssociation = null, contextElement = null }) {
  if (isCandidateDetailUrl(sourceUrl) || page?.pageType === "candidate_detail") {
    return "candidate_detail";
  }
  if (recentDetailAssociation && !card && !hasCandidateProfileSignals(normalizeText(readElementText(contextElement)))) {
    return "candidate_detail";
  }
  if (card || LIST_PAGE_TYPES.has(page?.pageType)) {
    return "candidate_list";
  }
  if (page?.pageType === "chat") {
    return "chat";
  }
  return "unknown";
}

function findCandidateSnapshotAncestor(element) {
  let current = element;
  for (let steps = 0; current && steps < MAX_CONTEXT_ANCESTOR_STEPS; steps += 1) {
    const text = readElementText(current);
    const normalizedText = normalizeText(text);
    if (
      normalizedText.length > 10 &&
      normalizedText.length <= MAX_CONTEXT_TEXT_LENGTH &&
      hasCandidateProfileSignals(normalizedText)
    ) {
      return current;
    }
    current = current.parentElement;
  }
  return null;
}

function findNearbyCandidateContextElement(actionElement, currentDocument) {
  const actionRect = readElementRect(actionElement);
  const candidates = [];
  const seen = new Set();
  let current = actionElement;

  for (let steps = 0; current && steps < MAX_CONTEXT_ANCESTOR_STEPS; steps += 1) {
    addCandidateContextCandidates({
      root: current,
      candidates,
      seen,
      actionElement,
      actionRect
    });
    addSiblingCandidateContextCandidates({
      element: current,
      candidates,
      seen,
      actionElement,
      actionRect
    });

    if (current === currentDocument?.body || current === currentDocument?.documentElement) {
      break;
    }
    current = current.parentElement;
  }

  candidates.sort((left, right) => right.score - left.score);
  return candidates[0]?.element || null;
}

function addSiblingCandidateContextCandidates({ element, candidates, seen, actionElement, actionRect }) {
  const siblings = Array.from(element?.parentElement?.children || []);
  siblings.forEach((sibling) => {
    addCandidateContextCandidates({
      root: sibling,
      candidates,
      seen,
      actionElement,
      actionRect
    });
  });
}

function addCandidateContextCandidates({ root, candidates, seen, actionElement, actionRect }) {
  collectElementTree(root).forEach((element) => {
    if (!element || seen.has(element)) {
      return;
    }
    seen.add(element);

    const candidate = buildNearbyCandidateContextCandidate(element, actionElement, actionRect);
    if (candidate) {
      candidates.push(candidate);
    }
  });
}

function collectElementTree(root) {
  const elements = [];
  const stack = [root].filter(Boolean);
  while (stack.length > 0 && elements.length < MAX_NEARBY_CONTEXT_ELEMENTS) {
    const element = stack.shift();
    elements.push(element);
    Array.from(element?.children || []).forEach((child) => stack.push(child));
  }
  return elements;
}

function buildNearbyCandidateContextCandidate(element, actionElement, actionRect) {
  const normalizedText = normalizeText(readElementText(element));
  if (!isCandidateContextText(normalizedText)) {
    return null;
  }

  const signals = detectCandidateSignals(normalizedText);
  const rect = readElementRect(element);
  let score = signals.filter((signal) => signal !== "greet_button").length * 20;
  if (signals.includes("greet_button")) {
    score += 3;
  }
  if (containsElement(element, actionElement)) {
    score += 16;
  }
  if (rect && actionRect) {
    score += scoreCandidateContextDistance(rect, actionRect);
  }
  score -= Math.min(12, normalizedText.length / 500);

  return {
    element,
    score
  };
}

function isCandidateContextText(normalizedText) {
  return normalizedText.length > 10 &&
    normalizedText.length <= MAX_CONTEXT_TEXT_LENGTH &&
    hasCandidateProfileSignals(normalizedText);
}

function scoreCandidateContextDistance(rect, actionRect) {
  const verticalOverlap = Math.min(rect.bottom, actionRect.bottom) - Math.max(rect.top, actionRect.top);
  if (verticalOverlap > 0) {
    return 12;
  }

  const verticalDistance = Math.min(
    Math.abs(rect.bottom - actionRect.top),
    Math.abs(actionRect.bottom - rect.top)
  );
  return Math.max(0, 10 - verticalDistance / 20);
}

function isInteractiveActionElement(element) {
  const tagName = String(element?.tagName || "").toLowerCase();
  return tagName === "button" ||
    tagName === "a" ||
    tagName === "input" ||
    element?.getAttribute?.("role") === "button" ||
    element?.getAttribute?.("role") === "link";
}

function hasCandidateProfileSignals(normalizedText) {
  return detectCandidateSignals(normalizedText)
    .some((signal) => signal !== "greet_button");
}

function containsElement(container, target) {
  if (container === target) {
    return true;
  }
  if (typeof container?.contains === "function") {
    return container.contains(target);
  }

  let current = target?.parentElement || null;
  while (current) {
    if (current === container) {
      return true;
    }
    current = current.parentElement;
  }
  return false;
}

function buildGreetingTargetKey({ candidate, sourceUrl = "", entry = "unknown" }) {
  if (candidate.exposureKey) {
    return [
      entry,
      "exposure",
      candidate.exposureKey
    ].join(":");
  }

  return [
    entry,
    candidate.stableIdSource || "unknown",
    candidate.stableId || sourceUrl || "unknown"
  ].join(":");
}

function getRecentGreetingCandidateAssociation({ contextElement = null, directAssociation = null, now = () => Date.now() } = {}) {
  if (directAssociation) {
    return null;
  }

  const recentDetailAssociation = getRecentCandidateDetailAssociation({ now });
  if (!recentDetailAssociation) {
    return null;
  }

  const contextText = normalizeText(readElementText(contextElement));
  if (hasCandidateProfileSignals(contextText)) {
    return null;
  }

  return recentDetailAssociation;
}

function detectGreetingMessageOutcome(documents) {
  for (const currentDocument of uniqueDocuments(documents)) {
    const texts = collectResultMessageTexts(currentDocument);
    for (const text of texts) {
      const result = classifyGreetingResultText(text);
      if (result.status) {
        return {
          ...result,
          detectedBy: "page_message"
        };
      }
    }
  }

  return {
    status: "",
    matchedSignals: []
  };
}

function collectResultMessageTexts(currentDocument) {
  if (!currentDocument?.querySelectorAll) {
    return [];
  }

  return Array.from(currentDocument.querySelectorAll(RESULT_MESSAGE_SELECTOR))
    .map((element) => readElementText(element))
    .filter((text) => text && text.length <= 500);
}

function collectMatchedSignals(normalizedText, rules) {
  if (!normalizedText) {
    return [];
  }

  return rules
    .filter(([, labels]) => labels.some((label) => normalizedText.includes(label)))
    .map(([signal]) => signal);
}

function collectAccessibleDocuments(rootDocument) {
  const documents = [rootDocument];
  rootDocument.querySelectorAll?.("iframe").forEach((frame) => {
    try {
      if (frame.contentDocument) {
        documents.push(frame.contentDocument);
      }
    } catch {
      // Cross-origin frames are ignored; observed BOSS candidate frames are same-origin.
    }
  });
  return documents;
}

function uniqueDocuments(documents) {
  return Array.from(new Set(documents.filter(Boolean)));
}

function readMergedDataset(element) {
  const merged = {};
  let current = element;
  for (let steps = 0; current && steps < MAX_CONTEXT_ANCESTOR_STEPS; steps += 1) {
    Object.assign(merged, current.dataset || {});
    current = current.parentElement;
  }
  return merged;
}

function readLinks(element) {
  return Array.from(element?.querySelectorAll?.("a[href]") || [])
    .map((link) => link.href)
    .filter(Boolean);
}

function readActionText(element) {
  const candidates = [
    element?.innerText,
    element?.textContent,
    element?.value,
    element?.getAttribute?.("aria-label"),
    element?.getAttribute?.("title")
  ];
  return normalizeText(candidates.find((value) => normalizeText(value)) || "");
}

function readElementText(element) {
  return String(element?.innerText || element?.textContent || "")
    .replace(/[ \t\f\v\r]+/g, " ")
    .replace(/\n\s+/g, "\n")
    .trim();
}

function readElementRect(element) {
  try {
    const rect = element?.getBoundingClientRect?.();
    if (!rect) {
      return null;
    }
    return {
      top: Number(rect.top) || 0,
      right: Number(rect.right) || 0,
      bottom: Number(rect.bottom) || 0,
      left: Number(rect.left) || 0
    };
  } catch {
    return null;
  }
}
