import {
  compactPayloadObject,
  normalizeText
} from "./candidate-card.js";
import { EVENT_TYPES } from "../shared/event-types.js";

const LIST_PAGE_TYPES = new Set([
  "candidate_recommend",
  "candidate_search",
  "candidate_intention",
  "candidate_interaction"
]);

const SCAN_INTERVAL_MS = 1000;
const PANEL_OPEN_CORRELATION_MS = 10 * 60 * 1000;
const MAX_ACTION_ANCESTOR_STEPS = 6;
const MAX_PANEL_ANCESTOR_STEPS = 10;
const MAX_PANEL_TEXT_LENGTH = 5000;
const MAX_CONDITIONS = 12;
const MAX_CONDITION_TEXT_LENGTH = 48;
const MAX_PANEL_CANDIDATES = 80;

const PANEL_SELECTOR = [
  "[role='dialog']",
  "[class*='filter']",
  "[class*='Filter']",
  "[class*='condition']",
  "[class*='Condition']",
  "[class*='popover']",
  "[class*='Popover']",
  "[class*='dropdown']",
  "[class*='Dropdown']",
  "[class*='dialog']",
  "[class*='Dialog']"
].join(",");

const FILTER_FIELD_LABELS = [
  "活跃状态",
  "活跃",
  "求职状态",
  "求职意向",
  "求职",
  "意向",
  "年龄范围",
  "年龄",
  "学历要求",
  "学历",
  "工作经验",
  "经验",
  "薪资范围",
  "薪资",
  "期望薪资",
  "期望职位",
  "期望城市",
  "职位",
  "城市",
  "地区",
  "性别",
  "院校",
  "专业",
  "关键词",
  "关键字",
  "搜索关键词",
  "搜索词",
  "到岗时间",
  "到岗",
  "更新时间",
  "公司规模",
  "公司",
  "行业"
];

const SENSITIVE_FILTER_LABELS = [
  "关键词",
  "关键字",
  "搜索关键词",
  "搜索词",
  "姓名",
  "手机号",
  "手机",
  "电话",
  "微信",
  "联系方式"
];

const IGNORED_FILTER_TEXTS = new Set([
  "筛选",
  "过滤",
  "更多筛选",
  "高级筛选",
  "筛选条件",
  "确定",
  "确认",
  "应用",
  "完成",
  "搜索",
  "取消",
  "关闭",
  "重置",
  "清空",
  "全部",
  "不限",
  "请选择",
  "查看结果"
]);

const DEFAULT_FILTER_PATTERNS = [
  /^不限.+/,
  /^.+不限$/,
  /^全部.+/,
  /^.+全部$/,
  /^请选择.+/
];

const FILTER_VALUE_PATTERNS = [
  /\d{2}\s*-\s*\d{2}岁/,
  /\d{2}岁(?:以下|以上)?/,
  /(?:博士|硕士|本科|大专|中专\/中技|中专|中技|高中|初中)/,
  /(?:\d+年以内|\d+\s*-\s*\d+年|\d+年以上|\d+年|应届生|经验不限)/,
  /(?:\d+\s*-\s*\d+K|\d+K|面议)/i,
  /(?:刚刚|今日|本周|本月|近\d+天|近三天|近七天|近一周|近两周).{0,4}活跃/,
  /(?:离职|在职|在校|应届生)-(?:随时到岗|考虑机会|暂不考虑|月内到岗)/,
  /^(?:男|女)$/
];

// Responsibilities:
// - observe candidate filter panel open/apply actions on candidate list pages
// - emit factual filter events with short visible summaries
// - avoid storing long free-form input, contact details, or strategy judgments
export class FilterProbe {
  constructor({
    collector,
    sessionContext,
    scanIntervalMs = SCAN_INTERVAL_MS,
    now = () => Date.now()
  }) {
    this.collector = collector;
    this.sessionContext = sessionContext;
    this.scanIntervalMs = scanIntervalMs;
    this.now = now;
    this.started = false;
    this.pollHandle = null;
    this.observedDocuments = new Map();
    this.lastPanelOpen = null;
    this.currentFilterContext = null;
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
    this.lastPanelOpen = null;
  }

  scan() {
    if (!isCandidateFilterPage(this.sessionContext.page)) {
      return;
    }

    this.attachAvailableDocuments();
  }

  safeScan(source) {
    try {
      this.scan(source);
    } catch (error) {
      this.collector.collect(EVENT_TYPES.PLUGIN_EXCEPTION, {
        source: `candidate_filter:${source}`,
        message: error instanceof Error ? error.message : String(error)
      });
    }
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
    if (!isCandidateFilterPage(this.sessionContext.page)) {
      return;
    }

    const action = findFilterActionElement(event?.target);
    if (!action) {
      return;
    }

    const target = buildFilterClickTargetFromElement({
      actionElement: action.element,
      currentDocument,
      page: this.sessionContext.page
    });

    if (action.kind === "panel_opened") {
      this.recordFilterPanelOpenedTarget(target);
      return;
    }

    if (action.kind === "applied" && target.hasFilterPanelContext) {
      this.recordFilterAppliedTarget(target);
    }
  }

  recordFilterPanelOpenedTarget(target = {}) {
    const event = this.collector.collect(
      EVENT_TYPES.CANDIDATE_FILTER_PANEL_OPENED,
      buildFilterPanelOpenedPayload(target)
    );
    this.lastPanelOpen = {
      openedEventId: event?.id || "",
      openedAtMs: this.now(),
      listUrl: target.listUrl || "",
      listPageType: target.listPageType || ""
    };
    return event;
  }

  recordFilterAppliedTarget(target = {}) {
    const payload = buildFilterAppliedPayload({
      ...target,
      openedEventId: this.resolveRecentPanelOpenedEventId(target)
    });
    this.currentFilterContext = payload.filter || null;
    return this.collector.collect(EVENT_TYPES.CANDIDATE_FILTER_APPLIED, payload);
  }

  resolveRecentPanelOpenedEventId(target = {}) {
    if (!this.lastPanelOpen?.openedEventId) {
      return "";
    }

    const elapsedMs = this.now() - this.lastPanelOpen.openedAtMs;
    if (elapsedMs > PANEL_OPEN_CORRELATION_MS) {
      return "";
    }

    if (
      this.lastPanelOpen.listUrl !== (target.listUrl || "") ||
      this.lastPanelOpen.listPageType !== (target.listPageType || "")
    ) {
      return "";
    }

    return this.lastPanelOpen.openedEventId;
  }
}

export function isCandidateFilterPage(page) {
  return Boolean(page?.isBossPage && LIST_PAGE_TYPES.has(page.pageType));
}

export function buildFilterPanelOpenedPayload({
  source = "click",
  page = null,
  listUrl = "",
  listPageType = "",
  filterText = ""
} = {}) {
  return compactPayloadObject({
    source,
    listUrl: listUrl || page?.url,
    listPageType: listPageType || page?.pageType,
    filter: buildFilterSnapshotFromText(filterText)
  });
}

export function buildFilterAppliedPayload({
  source = "click",
  page = null,
  listUrl = "",
  listPageType = "",
  filterText = "",
  openedEventId = ""
} = {}) {
  return compactPayloadObject({
    source,
    listUrl: listUrl || page?.url,
    listPageType: listPageType || page?.pageType,
    openedEventId,
    filter: buildFilterSnapshotFromText(filterText)
  });
}

export function buildFilterSnapshotFromText(text = "") {
  const conditions = extractFilterConditionsFromText(text);
  return compactPayloadObject({
    conditionCount: conditions.length,
    conditions
  });
}

export function extractFilterConditionsFromText(text = "") {
  const conditions = [];
  const seen = new Set();

  normalizeFilterLines(text).forEach((line) => {
    splitFilterConditionLine(line).forEach((candidate) => {
      const condition = sanitizeFilterCondition(candidate);
      if (!condition || seen.has(condition)) {
        return;
      }

      seen.add(condition);
      conditions.push(condition);
    });
  });

  return conditions.slice(0, MAX_CONDITIONS);
}

export function isFilterPanelOpenActionText(text = "") {
  const normalizedText = normalizeText(text);
  if (
    normalizedText.length === 0 ||
    normalizedText.length > 30 ||
    isFilterApplyActionText(normalizedText)
  ) {
    return false;
  }

  return normalizedText === "筛选" ||
    normalizedText === "过滤" ||
    normalizedText === "更多筛选" ||
    normalizedText === "高级筛选" ||
    normalizedText === "筛选条件" ||
    /^筛选\s*\d*$/.test(normalizedText);
}

export function isFilterApplyActionText(text = "") {
  const normalizedText = normalizeText(text);
  if (normalizedText.length === 0 || normalizedText.length > 40) {
    return false;
  }

  if (["确定", "确认", "应用", "完成", "搜索"].includes(normalizedText)) {
    return true;
  }

  return normalizedText.includes("开始筛选") ||
    normalizedText.includes("立即筛选") ||
    (normalizedText.startsWith("查看") &&
      (
        normalizedText.includes("结果") ||
        normalizedText.includes("牛人") ||
        normalizedText.includes("候选人")
      ));
}

export function findFilterActionElement(target) {
  let current = target;
  let fallback = null;

  for (let steps = 0; current && steps < MAX_ACTION_ANCESTOR_STEPS; steps += 1) {
    const kind = classifyFilterActionText(readActionText(current));
    if (kind) {
      fallback ||= {
        element: current,
        kind
      };

      if (isInteractiveActionElement(current)) {
        return {
          element: current,
          kind
        };
      }
    }

    current = current.parentElement;
  }

  return fallback;
}

export function buildFilterClickTargetFromElement({ actionElement, currentDocument, page }) {
  const contextElement = resolveFilterContextElement(actionElement, currentDocument);
  const filterText = readElementText(contextElement);

  return {
    source: "click",
    listUrl: page?.url || "",
    listPageType: page?.pageType || "",
    sourceUrl: currentDocument?.location?.href || globalThis.location?.href || "",
    actionText: readActionText(actionElement),
    filterText,
    hasFilterPanelContext: Boolean(contextElement && isLikelyFilterPanelText(filterText))
  };
}

function classifyFilterActionText(text = "") {
  if (isFilterApplyActionText(text)) {
    return "applied";
  }
  if (isFilterPanelOpenActionText(text)) {
    return "panel_opened";
  }
  return "";
}

function resolveFilterContextElement(actionElement, currentDocument) {
  return findFilterPanelAncestor(actionElement) ||
    findVisibleFilterPanel(currentDocument) ||
    actionElement;
}

function findFilterPanelAncestor(element) {
  let current = element;
  for (let steps = 0; current && steps < MAX_PANEL_ANCESTOR_STEPS; steps += 1) {
    const text = readElementText(current);
    if (isLikelyFilterPanelText(text)) {
      return current;
    }
    current = current.parentElement;
  }
  return null;
}

function findVisibleFilterPanel(currentDocument) {
  const candidates = Array.from(currentDocument?.querySelectorAll?.(PANEL_SELECTOR) || [])
    .slice(0, MAX_PANEL_CANDIDATES)
    .filter((element) => isElementVisible(element))
    .map((element) => ({
      element,
      score: scoreFilterPanelText(readElementText(element))
    }))
    .filter((candidate) => candidate.score > 0)
    .sort((left, right) => right.score - left.score);

  return candidates[0]?.element || null;
}

function isLikelyFilterPanelText(text = "") {
  return scoreFilterPanelText(text) > 0;
}

function scoreFilterPanelText(text = "") {
  const normalizedText = normalizeText(text);
  if (normalizedText.length < 4 || normalizedText.length > MAX_PANEL_TEXT_LENGTH) {
    return 0;
  }

  const fieldCount = countFilterFieldSignals(normalizedText);
  const actionCount = countFilterPanelActionSignals(normalizedText);
  const hasPanelHint = normalizedText.includes("筛选") ||
    normalizedText.includes("条件") ||
    normalizedText.includes("不限") ||
    normalizedText.includes("重置") ||
    normalizedText.includes("清空");

  if (fieldCount >= 2 && (hasPanelHint || actionCount >= 1)) {
    return fieldCount * 10 + actionCount * 3 + (hasPanelHint ? 2 : 0);
  }

  return 0;
}

function countFilterFieldSignals(normalizedText) {
  return FILTER_FIELD_LABELS
    .filter((label) => normalizedText.includes(label))
    .length;
}

function countFilterPanelActionSignals(normalizedText) {
  return ["确定", "确认", "应用", "完成", "搜索", "重置", "清空", "查看结果"]
    .filter((label) => normalizedText.includes(label))
    .length;
}

function normalizeFilterLines(text = "") {
  return String(text)
    .split(/\n+/)
    .map((line) => normalizeText(line))
    .filter(Boolean);
}

function splitFilterConditionLine(line = "") {
  return normalizeText(line)
    .split(/[，,;；|]/)
    .map((part) => normalizeText(part))
    .filter(Boolean);
}

function sanitizeFilterCondition(line = "") {
  const normalizedText = normalizeText(line).replace(/：/g, ":");
  if (!normalizedText || shouldIgnoreFilterConditionText(normalizedText)) {
    return "";
  }

  const sensitiveSummary = summarizeSensitiveFilterCondition(normalizedText);
  if (sensitiveSummary) {
    return sensitiveSummary;
  }

  const redactedText = redactSensitiveText(normalizedText);
  if (
    redactedText.length > MAX_CONDITION_TEXT_LENGTH ||
    shouldIgnoreFilterConditionText(redactedText) ||
    !isLikelySelectedFilterCondition(redactedText)
  ) {
    return "";
  }

  return redactedText;
}

function summarizeSensitiveFilterCondition(text = "") {
  const label = SENSITIVE_FILTER_LABELS.find((current) => text.includes(current));
  if (!label) {
    return "";
  }

  if (isFilterLabelOnlyText(text)) {
    return "";
  }

  return `${label}: 已填写`;
}

function redactSensitiveText(text = "") {
  return text
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[已脱敏]")
    .replace(/1[3-9]\d{9}/g, "[已脱敏]");
}

function shouldIgnoreFilterConditionText(text = "") {
  return IGNORED_FILTER_TEXTS.has(text) ||
    DEFAULT_FILTER_PATTERNS.some((pattern) => pattern.test(text)) ||
    isFilterApplyActionText(text) ||
    isFilterPanelOpenActionText(text) ||
    isFilterLabelOnlyText(text);
}

function isFilterLabelOnlyText(text = "") {
  return FILTER_FIELD_LABELS.includes(text) || SENSITIVE_FILTER_LABELS.includes(text);
}

function isLikelySelectedFilterCondition(text = "") {
  return FILTER_FIELD_LABELS.some((label) => text.includes(label)) ||
    FILTER_VALUE_PATTERNS.some((pattern) => pattern.test(text));
}

function isInteractiveActionElement(element) {
  const tagName = String(element?.tagName || "").toLowerCase();
  return tagName === "button" ||
    tagName === "a" ||
    tagName === "input" ||
    element?.getAttribute?.("role") === "button" ||
    element?.getAttribute?.("role") === "link";
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

function isElementVisible(element) {
  const rect = element?.getBoundingClientRect?.();
  if (!rect) {
    return false;
  }

  const view = element.ownerDocument?.defaultView || globalThis;
  return rect.width > 0 &&
    rect.height > 0 &&
    rect.bottom > 0 &&
    rect.right > 0 &&
    rect.top < view.innerHeight &&
    rect.left < view.innerWidth;
}
