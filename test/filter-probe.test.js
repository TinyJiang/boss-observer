import test from "node:test";
import assert from "node:assert/strict";

import {
  buildFilterAppliedPayload,
  buildFilterClickTargetFromElement,
  buildFilterPanelOpenedPayload,
  buildFilterSnapshotFromText,
  FilterProbe,
  findFilterActionElement,
  isFilterApplyActionText,
  isFilterPanelOpenActionText
} from "../extension/src/content/filter-probe.js";
import { EVENT_TYPES } from "../extension/src/shared/event-types.js";
import { classifyPage } from "../extension/src/shared/page-classifier.js";

test("filter action text distinguishes panel open and apply actions", () => {
  assert.equal(isFilterPanelOpenActionText("筛选"), true);
  assert.equal(isFilterPanelOpenActionText("更多筛选"), true);
  assert.equal(isFilterPanelOpenActionText("筛选结果"), false);

  assert.equal(isFilterApplyActionText("确定"), true);
  assert.equal(isFilterApplyActionText("搜索"), true);
  assert.equal(isFilterApplyActionText("查看23位牛人"), true);
  assert.equal(isFilterApplyActionText("筛选"), false);
});

test("filter action lookup prefers the interactive ancestor", () => {
  const button = createElement({ tagName: "BUTTON", text: "筛选" });
  const span = createElement({ tagName: "SPAN", text: "筛选", parentElement: button });

  const action = findFilterActionElement(span);

  assert.equal(action.element, button);
  assert.equal(action.kind, "panel_opened");
});

test("filter summary keeps short conditions and redacts sensitive free input", () => {
  const snapshot = buildFilterSnapshotFromText([
    "筛选",
    "活跃状态",
    "近三天活跃",
    "学历",
    "本科",
    "年龄 20-35岁",
    "关键词 Java运营",
    "手机 13812345678",
    "不限",
    "确定"
  ].join("\n"));

  assert.deepEqual(snapshot, {
    conditionCount: 5,
    conditions: [
      "近三天活跃",
      "本科",
      "年龄 20-35岁",
      "关键词: 已填写",
      "手机: 已填写"
    ]
  });
  assert.equal(JSON.stringify(snapshot).includes("Java运营"), false);
  assert.equal(JSON.stringify(snapshot).includes("13812345678"), false);
});

test("filter payloads include list context and omit raw source details", () => {
  const page = classifyPage("https://www.zhipin.com/web/chat/recommend");
  const opened = buildFilterPanelOpenedPayload({
    page,
    filterText: "筛选\n学历\n本科"
  });
  const applied = buildFilterAppliedPayload({
    page,
    openedEventId: "evt_opened",
    sourceUrl: "https://www.zhipin.com/web/frame/recommend/?jobid=job1",
    actionText: "确定",
    filterText: "筛选\n学历\n本科\n确定",
    filterConditions: ["本科"]
  });

  assert.equal(opened.source, "click");
  assert.equal(opened.listPageType, "candidate_recommend");
  assert.equal(opened.filter.conditionCount, 0);
  assert.equal(Object.hasOwn(opened.filter, "conditions"), false);
  assert.equal(applied.openedEventId, "evt_opened");
  assert.deepEqual(applied.filter.conditions, ["本科"]);
  assert.equal(Object.hasOwn(applied, "page"), false);
  assert.equal(Object.hasOwn(applied, "sourceUrl"), false);
  assert.equal(Object.hasOwn(applied, "actionText"), false);
});

test("filter click target reads summary from surrounding filter panel", () => {
  const applyButton = createElement({ tagName: "BUTTON", text: "确定" });
  const activeOption = createElement({
    text: "今日活跃",
    attributes: {
      class: "selected"
    }
  });
  const selectedOption = createElement({
    text: "本科",
    attributes: {
      "aria-selected": "true"
    }
  });
  const defaultOption = createElement({
    text: "不限",
    attributes: {
      class: "selected"
    }
  });
  const panel = createElement({
    text: [
      "筛选",
      "活跃状态",
      "不限",
      "今日活跃",
      "学历",
      "本科"
    ].join("\n"),
    children: [activeOption, selectedOption, defaultOption, applyButton],
    attributes: {
      role: "dialog"
    }
  });
  const document = createDocument({
    body: panel,
    href: "https://www.zhipin.com/web/frame/recommend/?jobid=job1"
  });

  const target = buildFilterClickTargetFromElement({
    actionElement: applyButton,
    currentDocument: document,
    page: classifyPage("https://www.zhipin.com/web/chat/recommend")
  });

  assert.equal(target.hasFilterPanelContext, true);
  assert.deepEqual(target.filterConditions, ["今日活跃", "本科"]);
});

test("filter click target reads visual selected chips and age range", () => {
  const applyButton = createElement({
    tagName: "BUTTON",
    text: "确定",
    style: selectedStyle()
  });
  const panel = createElement({
    children: [
      createElement({ text: "筛选条件" }),
      createElement({ text: "年龄" }),
      createElement({ text: "18" }),
      createElement({ text: "35" }),
      createElement({ text: "活跃度[单选]" }),
      createElement({ text: "不限" }),
      createElement({ text: "刚刚活跃", style: selectedStyle("orange") }),
      createElement({ text: "今日活跃" }),
      createElement({ text: "性别" }),
      createElement({ text: "不限" }),
      createElement({ text: "男" }),
      createElement({ text: "女", style: selectedStyle("orange") }),
      createElement({ text: "近期没有看过" }),
      createElement({ text: "不限" }),
      createElement({ text: "近14天没有", style: selectedStyle("orange") }),
      createElement({ text: "是否与同事交换简历" }),
      createElement({ text: "不限" }),
      createElement({ text: "近一个月没有", style: selectedStyle("orange") }),
      createElement({ text: "求职意向" }),
      createElement({ text: "不限" }),
      createElement({ text: "离职-随时到岗", style: selectedStyle("cyan") }),
      createElement({ text: "在职-考虑机会", style: selectedStyle("cyan") }),
      createElement({ text: "薪资待遇[单选]" }),
      createElement({ text: "不限", style: selectedStyle("cyan") }),
      createElement({ text: "3-5K" }),
      applyButton
    ],
    attributes: {
      role: "dialog"
    }
  });
  const document = createDocument({
    body: panel,
    href: "https://www.zhipin.com/web/frame/recommend/?jobid=job1"
  });

  const target = buildFilterClickTargetFromElement({
    actionElement: applyButton,
    currentDocument: document,
    page: classifyPage("https://www.zhipin.com/web/chat/recommend")
  });

  assert.equal(target.hasFilterPanelContext, true);
  assert.deepEqual(target.filterConditions, [
    "年龄: 18-35岁",
    "活跃度: 刚刚活跃",
    "性别: 女",
    "近期没有看过: 近14天没有",
    "是否与同事交换简历: 近一个月没有",
    "求职意向: 离职-随时到岗",
    "求职意向: 在职-考虑机会"
  ]);
});

test("filter click target reads age range from slider pseudo content", () => {
  const applyButton = createElement({ tagName: "BUTTON", text: "确定" });
  const panel = createElement({
    children: [
      createElement({ text: "筛选条件" }),
      createElement({ text: "年龄" }),
      createElement({
        children: [
          createElement({
            pseudoStyles: {
              "::after": {
                content: "\"18\""
              }
            }
          }),
          createElement({
            pseudoStyles: {
              "::after": {
                content: "\"35\""
              }
            }
          })
        ]
      }),
      createElement({ text: "活跃度[单选]" }),
      createElement({ text: "刚刚活跃", style: selectedStyle("orange") }),
      applyButton
    ],
    attributes: {
      role: "dialog"
    }
  });
  const document = createDocument({
    body: panel,
    href: "https://www.zhipin.com/web/frame/recommend/?jobid=job1"
  });

  const target = buildFilterClickTargetFromElement({
    actionElement: applyButton,
    currentDocument: document,
    page: classifyPage("https://www.zhipin.com/web/chat/recommend")
  });

  assert.equal(target.hasFilterPanelContext, true);
  assert.deepEqual(target.filterConditions, [
    "年龄: 18-35岁",
    "活跃度: 刚刚活跃"
  ]);
});

test("filter probe emits panel opened and applied with opened event correlation", () => {
  let now = 1000;
  const collector = createCollector();
  const openButton = createElement({ tagName: "BUTTON", text: "筛选" });
  const applyButton = createElement({ tagName: "BUTTON", text: "确定" });
  const ageOption = createElement({
    text: "20-35岁",
    attributes: {
      class: "active"
    }
  });
  const educationOption = createElement({
    text: "本科",
    attributes: {
      class: "selected"
    }
  });
  const panel = createElement({
    text: [
      "筛选",
      "年龄",
      "不限",
      "20-35岁",
      "学历",
      "不限",
      "本科"
    ].join("\n"),
    children: [ageOption, educationOption, applyButton],
    attributes: {
      role: "dialog"
    }
  });
  const root = createElement({ children: [openButton, panel] });
  const document = createDocument({
    body: root,
    href: "https://www.zhipin.com/web/frame/recommend/?jobid=job1",
    panels: [panel]
  });
  const probe = new FilterProbe({
    collector,
    sessionContext: createSessionContext("https://www.zhipin.com/web/chat/recommend"),
    now: () => now
  });

  probe.handleDocumentClick({ target: openButton }, document);
  now = 1800;
  probe.handleDocumentClick({ target: applyButton }, document);

  assert.deepEqual(
    collector.events.map((event) => event.type),
    [
      EVENT_TYPES.CANDIDATE_FILTER_PANEL_OPENED,
      EVENT_TYPES.CANDIDATE_FILTER_APPLIED
    ]
  );
  assert.equal(collector.events[1].payload.openedEventId, "evt_1");
  assert.equal(collector.events[0].payload.filter.conditionCount, 0);
  assert.deepEqual(collector.events[1].payload.filter.conditions, ["20-35岁", "本科"]);
  assert.equal(probe.currentFilterContext.conditionCount, 2);
});

test("filter probe infers panel opened from visible apply panel and dedupes same apply click", () => {
  let now = 1000;
  const collector = createCollector();
  const applyButton = createElement({ tagName: "BUTTON", text: "确定" });
  const educationOption = createElement({
    text: "本科",
    attributes: {
      class: "selected"
    }
  });
  const panel = createElement({
    text: [
      "筛选",
      "年龄",
      "20-35岁",
      "学历",
      "不限",
      "本科"
    ].join("\n"),
    children: [educationOption, applyButton],
    attributes: {
      role: "dialog"
    }
  });
  const document = createDocument({
    body: panel,
    href: "https://www.zhipin.com/web/frame/recommend/?jobid=job1",
    panels: [panel]
  });
  const probe = new FilterProbe({
    collector,
    sessionContext: createSessionContext("https://www.zhipin.com/web/chat/recommend"),
    now: () => now
  });

  probe.handleDocumentClick({ target: applyButton }, document);
  now = 1500;
  probe.handleDocumentClick({ target: applyButton }, document);

  assert.deepEqual(
    collector.events.map((event) => event.type),
    [
      EVENT_TYPES.CANDIDATE_FILTER_PANEL_OPENED,
      EVENT_TYPES.CANDIDATE_FILTER_APPLIED
    ]
  );
  assert.equal(collector.events[0].payload.source, "inferred_from_apply");
  assert.equal(collector.events[1].payload.openedEventId, "evt_1");
  assert.deepEqual(collector.events[1].payload.filter.conditions, ["本科"]);
});

test("filter probe records real repeated apply after dedupe window", () => {
  let now = 1000;
  const collector = createCollector();
  const applyButton = createElement({ tagName: "BUTTON", text: "确定" });
  const panel = createElement({
    text: [
      "筛选",
      "年龄",
      "20-35岁",
      "学历",
      "不限",
      "本科"
    ].join("\n"),
    children: [
      createElement({
        text: "本科",
        attributes: {
          class: "selected"
        }
      }),
      applyButton
    ],
    attributes: {
      role: "dialog"
    }
  });
  const document = createDocument({
    body: panel,
    href: "https://www.zhipin.com/web/frame/recommend/?jobid=job1",
    panels: [panel]
  });
  const probe = new FilterProbe({
    collector,
    sessionContext: createSessionContext("https://www.zhipin.com/web/chat/recommend"),
    now: () => now
  });

  probe.handleDocumentClick({ target: applyButton }, document);
  now = 2600;
  probe.handleDocumentClick({ target: applyButton }, document);

  assert.deepEqual(
    collector.events.map((event) => event.type),
    [
      EVENT_TYPES.CANDIDATE_FILTER_PANEL_OPENED,
      EVENT_TYPES.CANDIDATE_FILTER_APPLIED,
      EVENT_TYPES.CANDIDATE_FILTER_APPLIED
    ]
  );
  assert.equal(collector.events[1].payload.openedEventId, "evt_1");
  assert.equal(collector.events[2].payload.openedEventId, "evt_1");
});

test("filter probe ignores generic apply actions outside a filter panel", () => {
  const collector = createCollector();
  const searchButton = createElement({ tagName: "BUTTON", text: "搜索" });
  const document = createDocument({
    body: searchButton,
    href: "https://www.zhipin.com/web/frame/recommend/?jobid=job1"
  });
  const probe = new FilterProbe({
    collector,
    sessionContext: createSessionContext("https://www.zhipin.com/web/chat/recommend")
  });

  probe.handleDocumentClick({ target: searchButton }, document);

  assert.deepEqual(collector.events, []);
});

function createCollector() {
  return {
    events: [],
    collect(type, payload) {
      const event = {
        id: `evt_${this.events.length + 1}`,
        type,
        payload
      };
      this.events.push(event);
      return event;
    }
  };
}

function createSessionContext(url) {
  return {
    page: classifyPage(url)
  };
}

function createDocument({ body, href, panels = [] }) {
  const document = {
    body,
    documentElement: body,
    location: {
      href
    },
    defaultView: {
      innerHeight: 900,
      innerWidth: 1440,
      getComputedStyle(element, pseudoElement = null) {
        if (pseudoElement) {
          return element.pseudoStyles?.[pseudoElement] || {};
        }
        return element.style || {};
      }
    },
    addEventListener() {},
    removeEventListener() {},
    querySelectorAll(selector) {
      if (selector === "iframe") {
        return [];
      }
      if (selector.includes("[role='dialog']")) {
        return panels;
      }
      return [];
    }
  };
  assignOwnerDocument(body, document);
  return document;
}

function createElement({
  tagName = "DIV",
  text = "",
  parentElement = null,
  children = [],
  attributes = {},
  style = {},
  pseudoStyles = {},
  dataset = {},
  value = ""
} = {}) {
  const element = {
    tagName,
    parentElement,
    children,
    style,
    pseudoStyles,
    dataset,
    value,
    get innerText() {
      return text || this.children.map((child) => child.innerText).filter(Boolean).join("\n");
    },
    get textContent() {
      return this.innerText;
    },
    getAttribute(name) {
      return attributes[name] || "";
    },
    getBoundingClientRect() {
      return {
        top: 10,
        left: 10,
        right: 310,
        bottom: 210,
        width: 300,
        height: 200
      };
    },
    querySelectorAll(selector) {
      return findMatchingDescendants(this, selector);
    }
  };

  children.forEach((child) => {
    child.parentElement = element;
  });
  return element;
}

function assignOwnerDocument(element, document) {
  if (!element) {
    return;
  }

  element.ownerDocument = document;
  element.children.forEach((child) => assignOwnerDocument(child, document));
}

function findMatchingDescendants(element, selector) {
  const results = [];

  (element.children || []).forEach((current) => {
    if (matchesSelectorForTest(current, selector)) {
      results.push(current);
    }
    results.push(...findMatchingDescendants(current, selector));
  });

  return results;
}

function matchesSelectorForTest(element, selector = "") {
  if (selector === "*") {
    return true;
  }

  const className = element?.getAttribute?.("class") || "";
  const ariaSelected = element?.getAttribute?.("aria-selected") || "";
  const ariaChecked = element?.getAttribute?.("aria-checked") || "";
  const ariaPressed = element?.getAttribute?.("aria-pressed") || "";

  return (
    selector.includes("selected") && className.includes("selected")
  ) || (
    selector.includes("active") && className.includes("active")
  ) || (
    selector.includes("checked") && className.includes("checked")
  ) || (
    selector.includes("cur") && className.includes("cur")
  ) || (
    selector.includes("aria-selected") && ariaSelected === "true"
  ) || (
    selector.includes("aria-checked") && ariaChecked === "true"
  ) || (
    selector.includes("aria-pressed") && ariaPressed === "true"
  );
}

function selectedStyle(kind = "cyan") {
  if (kind === "orange") {
    return {
      backgroundColor: "rgb(224, 150, 100)",
      color: "rgb(255, 255, 255)"
    };
  }

  return {
    backgroundColor: "rgb(20, 190, 190)",
    color: "rgb(255, 255, 255)"
  };
}
