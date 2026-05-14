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
    filterText: "筛选\n学历\n本科\n确定"
  });

  assert.equal(opened.source, "click");
  assert.equal(opened.listPageType, "candidate_recommend");
  assert.equal(opened.filter.conditionCount, 1);
  assert.equal(applied.openedEventId, "evt_opened");
  assert.deepEqual(applied.filter.conditions, ["本科"]);
  assert.equal(Object.hasOwn(applied, "page"), false);
  assert.equal(Object.hasOwn(applied, "sourceUrl"), false);
  assert.equal(Object.hasOwn(applied, "actionText"), false);
});

test("filter click target reads summary from surrounding filter panel", () => {
  const applyButton = createElement({ tagName: "BUTTON", text: "确定" });
  const panel = createElement({
    text: [
      "筛选",
      "活跃状态",
      "今日活跃",
      "学历",
      "本科"
    ].join("\n"),
    children: [applyButton],
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
  assert.deepEqual(buildFilterSnapshotFromText(target.filterText).conditions, ["今日活跃", "本科"]);
});

test("filter probe emits panel opened and applied with opened event correlation", () => {
  let now = 1000;
  const collector = createCollector();
  const openButton = createElement({ tagName: "BUTTON", text: "筛选" });
  const applyButton = createElement({ tagName: "BUTTON", text: "确定" });
  const panel = createElement({
    text: [
      "筛选",
      "年龄",
      "20-35岁",
      "学历",
      "本科"
    ].join("\n"),
    children: [applyButton],
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
  assert.deepEqual(collector.events[1].payload.filter.conditions, ["20-35岁", "本科"]);
  assert.equal(probe.currentFilterContext.conditionCount, 2);
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
      innerWidth: 1440
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
  attributes = {}
} = {}) {
  const element = {
    tagName,
    parentElement,
    children,
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
    querySelectorAll() {
      return [];
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
