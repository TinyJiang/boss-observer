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
const MAX_PANEL_TEXT_ELEMENTS = 400;

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

const SELECTED_FILTER_OPTION_SELECTOR = [
  "[aria-selected='true']",
  "[aria-checked='true']",
  "[aria-pressed='true']",
  "input:checked",
  "option:checked",
  ".active",
  ".checked",
  ".cur",
  ".current",
  ".selected",
  ".is-active",
  ".is-checked",
  ".is-current",
  ".is-selected",
  "[class*='Active']",
  "[class*='Checked']",
  "[class*='Current']",
  "[class*='Selected']",
  "[class*='active']",
  "[class*='checked']",
  "[class*='current']",
  "[class*='selected']"
].join(",");

const FILTER_FIELD_LABELS = [
  "活跃状态",
  "活跃度",
  "活跃",
  "近期没有看过",
  "近期没有",
  "看过",
  "是否与同事交换简历",
  "换简历",
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
  "薪资待遇",
  "学历要求",
  "经验要求",
  "跳槽频率",
  "牛人关键词",
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

const FILTER_ROW_LABELS = [
  "年龄",
  "年龄范围",
  "活跃度[单选]",
  "活跃度",
  "活跃状态",
  "近期没有看过",
  "近期没有",
  "性别",
  "是否与同事交换简历",
  "换简历",
  "牛人关键词",
  "院校",
  "专业",
  "跳槽频率[单选]",
  "跳槽频率",
  "求职意向",
  "薪资待遇[单选]",
  "薪资待遇",
  "薪资范围",
  "学历要求",
  "学历",
  "经验要求",
  "工作经验",
  "经验",
  "期望职位",
  "期望城市",
  "职位",
  "城市",
  "地区",
  "到岗时间",
  "更新时间",
  "公司规模",
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
  /^.+:.+$/,
  /\d{2}\s*-\s*\d{2}岁/,
  /\d{2}岁(?:以下|以上)?/,
  /(?:博士|硕士|本科|大专|中专\/中技|中专|中技|高中|初中)/,
  /(?:\d+年以内|\d+\s*-\s*\d+年|\d+年以上|\d+年|应届生|经验不限)/,
  /(?:\d+\s*-\s*\d+K|\d+K|面议)/i,
  /(?:刚刚|今日|本周|本月|近\d+天|近三天|近七天|近一周|近两周).{0,4}活跃/,
  /(?:近\d+天|近一个月|近一月|近两周|近三十天).{0,4}没有/,
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
  listPageType = ""
} = {}) {
  return compactPayloadObject({
    source,
    listUrl: listUrl || page?.url,
    listPageType: listPageType || page?.pageType,
    filter: buildFilterSnapshotFromConditions([])
  });
}

export function buildFilterAppliedPayload({
  source = "click",
  page = null,
  listUrl = "",
  listPageType = "",
  filterText = "",
  filterConditions = null,
  openedEventId = ""
} = {}) {
  return compactPayloadObject({
    source,
    listUrl: listUrl || page?.url,
    listPageType: listPageType || page?.pageType,
    openedEventId,
    filter: buildFilterSnapshot({
      filterConditions,
      filterText
    })
  });
}

export function buildFilterSnapshotFromText(text = "") {
  return buildFilterSnapshot({ filterText: text });
}

function buildFilterSnapshot({
  filterConditions = null,
  filterText = ""
} = {}) {
  const conditions = Array.isArray(filterConditions)
    ? normalizeFilterConditions(filterConditions)
    : extractFilterConditionsFromText(filterText);
  return compactPayloadObject({
    conditionCount: conditions.length,
    conditions
  });
}

function buildFilterSnapshotFromConditions(filterConditions = []) {
  const conditions = normalizeFilterConditions(filterConditions);
  return compactPayloadObject({
    conditionCount: conditions.length,
    conditions
  });
}

function normalizeFilterConditions(filterConditions = []) {
  const conditions = [];
  const seen = new Set();

  filterConditions.forEach((conditionText) => {
    const condition = sanitizeFilterCondition(conditionText);
    if (!condition || seen.has(condition)) {
      return;
    }

    seen.add(condition);
    conditions.push(condition);
  });

  return conditions.slice(0, MAX_CONDITIONS);
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

export function extractSelectedFilterConditionsFromElement(panelElement) {
  const conditions = [];
  const seen = new Set();
  const textElements = collectFilterTextElements(panelElement);

  Array.from(panelElement?.querySelectorAll?.(SELECTED_FILTER_OPTION_SELECTOR) || [])
    .slice(0, MAX_PANEL_CANDIDATES)
    .forEach((element) => {
      appendFilterCondition(conditions, seen, buildSelectedFilterConditionText({
        element,
        panelElement,
        textElements
      }));
    });

  extractRangeFilterConditionTexts(panelElement, textElements)
    .forEach((conditionText) => {
      appendFilterCondition(conditions, seen, conditionText);
    });

  extractVisualSelectedFilterConditionTexts(panelElement, textElements)
    .forEach((conditionText) => {
      appendFilterCondition(conditions, seen, conditionText);
    });

  return conditions.slice(0, MAX_CONDITIONS);
}

function appendFilterCondition(conditions, seen, conditionText) {
  const condition = sanitizeFilterCondition(conditionText);
  if (!condition || seen.has(condition)) {
    return;
  }

  seen.add(condition);
  conditions.push(condition);
}

function buildSelectedFilterConditionText({
  element,
  panelElement,
  textElements
}) {
  const valueText = readSelectedFilterElementText(element);
  return buildLabeledFilterConditionText({
    valueText,
    labelText: findNearestFilterFieldLabelText(element, panelElement, textElements)
  });
}

function readSelectedFilterElementText(element) {
  if (isFormControlElement(element)) {
    return readSelectedFormControlConditionText(element);
  }

  return readActionText(element);
}

function isFormControlElement(element) {
  const tagName = String(element?.tagName || "").toLowerCase();
  return tagName === "input" || tagName === "textarea" || tagName === "select" || tagName === "option";
}

function readSelectedFormControlConditionText(element) {
  const labelText = readInputLabelText(element);
  const value = normalizeText(element?.value);
  const text = normalizeText(labelText || readActionText(element));

  if (value && isSensitiveFilterText(text || value)) {
    const label = SENSITIVE_FILTER_LABELS.find((current) => (text || value).includes(current)) || "关键词";
    return `${label}: 已填写`;
  }

  return text || value;
}

function readInputLabelText(element) {
  const ariaLabel = normalizeText(element?.getAttribute?.("aria-label"));
  if (ariaLabel) {
    return ariaLabel;
  }

  const title = normalizeText(element?.getAttribute?.("title"));
  if (title) {
    return title;
  }

  return normalizeText(element?.parentElement?.innerText || "");
}

function isSensitiveFilterText(text = "") {
  return SENSITIVE_FILTER_LABELS.some((label) => text.includes(label));
}

function collectFilterTextElements(panelElement) {
  return collectPanelCandidateElements(panelElement)
    .filter((element) => isVisibleShortTextElement(element))
    .map((element, index) => ({
      element,
      index,
      text: readSingleElementText(element)
    }));
}

function collectPanelCandidateElements(panelElement) {
  return Array.from(panelElement?.querySelectorAll?.("*") || [])
    .slice(0, MAX_PANEL_TEXT_ELEMENTS);
}

function isVisibleShortTextElement(element) {
  const text = readSingleElementText(element);
  if (
    !text ||
    text.length > MAX_CONDITION_TEXT_LENGTH ||
    hasTextChildElement(element) ||
    !isElementVisible(element)
  ) {
    return false;
  }

  return true;
}

function readSingleElementText(element) {
  return normalizeText(
    element?.innerText ||
      element?.textContent ||
      element?.value ||
      element?.getAttribute?.("aria-label") ||
      element?.getAttribute?.("title") ||
      ""
  );
}

function hasTextChildElement(element) {
  return Array.from(element?.children || [])
    .some((child) => normalizeText(child?.innerText || child?.textContent || ""));
}

function extractVisualSelectedFilterConditionTexts(panelElement, textElements) {
  return textElements
    .filter(({ element, text }) => !shouldIgnoreFilterConditionText(text) &&
      isVisuallySelectedFilterOptionElement(element, panelElement))
    .map(({ element, text }) => buildLabeledFilterConditionText({
      valueText: text,
      labelText: findNearestFilterFieldLabelText(element, panelElement, textElements)
    }));
}

function buildLabeledFilterConditionText({ valueText, labelText }) {
  const value = normalizeText(valueText);
  if (!value || shouldIgnoreFilterConditionText(value)) {
    return "";
  }

  const label = normalizeFilterFieldLabel(labelText);
  if (!label || value.includes(":") || isFilterLabelLikeText(value)) {
    return value;
  }

  return `${label}: ${value}`;
}

function findNearestFilterFieldLabelText(element, panelElement, textElements) {
  const elementIndex = textElements.find((entry) => entry.element === element)?.index ?? -1;
  if (elementIndex < 0) {
    return "";
  }

  for (let index = elementIndex - 1; index >= 0; index -= 1) {
    const candidate = textElements[index];
    if (!isLikelySameFilterPanelRegion(element, candidate.element, panelElement)) {
      continue;
    }
    if (isFilterLabelLikeText(candidate.text)) {
      return candidate.text;
    }
  }

  return "";
}

function isLikelySameFilterPanelRegion(element, candidateElement, panelElement) {
  if (!panelElement || candidateElement === panelElement) {
    return false;
  }

  const elementRect = element?.getBoundingClientRect?.();
  const candidateRect = candidateElement?.getBoundingClientRect?.();
  const panelRect = panelElement?.getBoundingClientRect?.();
  if (!elementRect || !candidateRect || !panelRect) {
    return true;
  }

  return candidateRect.top >= panelRect.top - 2 &&
    candidateRect.top <= elementRect.bottom + 6;
}

function isFilterLabelLikeText(text = "") {
  const normalizedText = normalizeFilterFieldLabel(text);
  return FILTER_ROW_LABELS.some((label) => normalizedText === normalizeFilterFieldLabel(label));
}

function normalizeFilterFieldLabel(text = "") {
  return normalizeText(text)
    .replace(/：/g, ":")
    .replace(/\s*\[[^\]]+\]\s*/g, "")
    .replace(/:$/, "");
}

function isVisuallySelectedFilterOptionElement(element, panelElement) {
  const carrier = findVisualSelectionCarrier(element, panelElement);
  if (!carrier) {
    return false;
  }

  return isSelectedVisualStyle(readComputedStyle(carrier));
}

function findVisualSelectionCarrier(element, panelElement) {
  const text = readSingleElementText(element);
  let current = element;

  for (let steps = 0; current && current !== panelElement && steps < 4; steps += 1) {
    if (
      normalizeText(current.innerText || current.textContent || "") === text &&
      isSelectedVisualStyle(readComputedStyle(current))
    ) {
      return current;
    }

    current = current.parentElement;
  }

  return null;
}

function readComputedStyle(element, pseudoElement = null) {
  const view = element?.ownerDocument?.defaultView || globalThis;
  try {
    return view?.getComputedStyle?.(element, pseudoElement) || element?.style || {};
  } catch {
    return element?.style || {};
  }
}

function isSelectedVisualStyle(style = {}) {
  const backgroundColor = parseCssColor(style.backgroundColor || style.background || "");
  if (!backgroundColor || backgroundColor.alpha < 0.4 || isNeutralFilterBackground(backgroundColor)) {
    return false;
  }

  const textColor = parseCssColor(style.color || "");
  if (textColor && isLightColor(textColor) && !isLightColor(backgroundColor)) {
    return true;
  }

  return colorSaturation(backgroundColor) >= 70;
}

function parseCssColor(value = "") {
  const match = String(value).match(/rgba?\(([^)]+)\)/i);
  if (!match) {
    return null;
  }

  const parts = match[1].split(",").map((part) => part.trim());
  const red = Number.parseFloat(parts[0]);
  const green = Number.parseFloat(parts[1]);
  const blue = Number.parseFloat(parts[2]);
  const alpha = parts.length >= 4 ? Number.parseFloat(parts[3]) : 1;

  if ([red, green, blue, alpha].some((part) => Number.isNaN(part))) {
    return null;
  }

  return {
    red,
    green,
    blue,
    alpha
  };
}

function isNeutralFilterBackground(color) {
  return color.alpha < 0.4 ||
    (color.red >= 235 && color.green >= 235 && color.blue >= 235) ||
    colorSaturation(color) < 30;
}

function isLightColor(color) {
  return color.red * 0.299 + color.green * 0.587 + color.blue * 0.114 >= 210;
}

function colorSaturation(color) {
  return Math.max(color.red, color.green, color.blue) - Math.min(color.red, color.green, color.blue);
}

function extractRangeFilterConditionTexts(panelElement, textElements) {
  const ageRangeCondition = extractAgeRangeFilterConditionText(panelElement, textElements);
  return ageRangeCondition ? [ageRangeCondition] : [];
}

function extractAgeRangeFilterConditionText(panelElement, textElements) {
  const ageLabelIndex = textElements.findIndex(({ text }) => isAgeFilterLabelText(text));
  if (ageLabelIndex < 0) {
    return "";
  }

  const allElements = collectPanelCandidateElements(panelElement);
  const ageElementIndex = allElements.indexOf(textElements[ageLabelIndex].element);
  const nextLabelEntry = textElements
    .slice(ageLabelIndex + 1)
    .find(({ text }) => isFilterLabelLikeText(text));
  const nextLabelElementIndex = nextLabelEntry
    ? allElements.indexOf(nextLabelEntry.element)
    : -1;
  const sliderValues = collectAgeSliderValues({
    allElements,
    ageElementIndex,
    nextLabelElementIndex
  });
  if (sliderValues.length >= 2) {
    return formatAgeRangeCondition(sliderValues[0], sliderValues[1]);
  }

  const values = [];
  for (let index = ageLabelIndex + 1; index < textElements.length; index += 1) {
    const text = textElements[index].text;
    if (isFilterLabelLikeText(text)) {
      break;
    }
    if (/^\d{1,2}$/.test(text)) {
      values.push(Number.parseInt(text, 10));
    }
  }

  if (values.length < 2) {
    return "";
  }

  return formatAgeRangeCondition(values[0], values[1]);
}

function isAgeFilterLabelText(text = "") {
  const normalizedText = normalizeFilterFieldLabel(text);
  return normalizedText === "年龄" || normalizedText === "年龄范围";
}

function collectAgeSliderValues({
  allElements = [],
  ageElementIndex = -1,
  nextLabelElementIndex = -1
} = {}) {
  const values = [];
  const seen = new Set();

  allElements.forEach((element, index) => {
    if (!isElementInAgeFilterRegion(index, ageElementIndex, nextLabelElementIndex)) {
      return;
    }

    readAgeSliderElementValues(element).forEach((value) => {
      if (!Number.isInteger(value) || value < 16 || value > 80 || seen.has(value)) {
        return;
      }

      seen.add(value);
      values.push(value);
    });
  });

  return values.slice(0, 2);
}

function isElementInAgeFilterRegion(elementIndex, ageElementIndex, nextLabelElementIndex) {
  if (ageElementIndex < 0 || elementIndex <= ageElementIndex) {
    return false;
  }

  return nextLabelElementIndex < 0 || elementIndex < nextLabelElementIndex;
}

function readAgeSliderElementValues(element) {
  return collectAgeValueSources(element)
    .flatMap((source) => parseAgeNumbersFromText(source));
}

function collectAgeValueSources(element) {
  return [
    element?.getAttribute?.("aria-valuenow"),
    element?.getAttribute?.("aria-valuetext"),
    element?.getAttribute?.("aria-label"),
    element?.getAttribute?.("title"),
    element?.getAttribute?.("data-value"),
    element?.getAttribute?.("data-min"),
    element?.getAttribute?.("data-max"),
    element?.getAttribute?.("data-age"),
    element?.getAttribute?.("data-from"),
    element?.getAttribute?.("data-to"),
    element?.value,
    ...Object.values(element?.dataset || {}),
    readCssPseudoContent(element, "::before"),
    readCssPseudoContent(element, "::after")
  ];
}

function readCssPseudoContent(element, pseudoElement) {
  const content = readComputedStyle(element, pseudoElement)?.content;
  if (!content || content === "none" || content === "normal") {
    return "";
  }

  return String(content).replace(/^["']|["']$/g, "");
}

function parseAgeNumbersFromText(text = "") {
  return Array.from(String(text).matchAll(/(?:^|[^\d])(\d{1,2})(?:\s*岁)?(?:$|[^\d])/g))
    .map((match) => Number.parseInt(match[1], 10))
    .filter((value) => Number.isInteger(value));
}

function formatAgeRangeCondition(leftValue, rightValue) {
  const minValue = Math.min(leftValue, rightValue);
  const maxValue = Math.max(leftValue, rightValue);
  if (minValue <= 16 && maxValue >= 60) {
    return "";
  }

  return `年龄: ${minValue}-${maxValue}岁`;
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
  const hasFilterPanelContext = Boolean(contextElement && isLikelyFilterPanelText(filterText));

  return {
    source: "click",
    listUrl: page?.url || "",
    listPageType: page?.pageType || "",
    sourceUrl: currentDocument?.location?.href || globalThis.location?.href || "",
    actionText: readActionText(actionElement),
    filterText,
    filterConditions: hasFilterPanelContext
      ? extractSelectedFilterConditionsFromElement(contextElement)
      : null,
    hasFilterPanelContext
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
