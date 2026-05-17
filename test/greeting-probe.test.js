import test from "node:test";
import assert from "node:assert/strict";

import {
  buildGreetingClickTargetFromElement,
  buildGreetingClickPayload,
  classifyGreetingResultText,
  findGreetingActionElement,
  GreetingProbe,
  isGreetingActionText
} from "../extension/src/content/greeting-probe.js";
import {
  clearCandidateCardRegistry,
  rememberCandidateSnapshotAssociation,
  recordCandidateCardInteraction,
  registerCandidateCardAssociation
} from "../extension/src/content/candidate-card-registry.js";
import { EVENT_TYPES } from "../extension/src/shared/event-types.js";
import { classifyPage } from "../extension/src/shared/page-classifier.js";

test.beforeEach(() => clearCandidateCardRegistry());

test("greeting action text accepts only compact greet actions", () => {
  assert.equal(isGreetingActionText("打招呼"), true);
  assert.equal(isGreetingActionText("立即打招呼"), true);
  assert.equal(isGreetingActionText("打招呼语设置"), false);
  assert.equal(isGreetingActionText("打招呼设置"), false);
  assert.equal(isGreetingActionText("候选人详情 28岁 本科 期望 杭州 运营 打招呼"), false);
});

test("greeting action lookup prefers the interactive ancestor", () => {
  const button = createElement({ tagName: "BUTTON", text: "打招呼" });
  const span = createElement({ tagName: "SPAN", text: "打招呼", parentElement: button });

  assert.equal(findGreetingActionElement(span), button);
});

test("greeting click target can read candidate info from a sibling block", () => {
  const info = createElement({
    text: [
      "吴先生 刚刚活跃",
      "7-8K",
      "28岁 7年 高中 离职-随时到岗",
      "期望",
      "杭州 直播运营"
    ].join("\n"),
    rect: { top: 10, right: 260, bottom: 110, left: 0 }
  });
  const button = createElement({
    tagName: "BUTTON",
    text: "打招呼",
    rect: { top: 40, right: 360, bottom: 70, left: 280 }
  });
  const actionArea = createElement({
    text: "打招呼",
    children: [button],
    rect: { top: 10, right: 380, bottom: 110, left: 260 }
  });
  const row = createElement({
    children: [info, actionArea],
    rect: { top: 10, right: 380, bottom: 110, left: 0 }
  });
  const currentDocument = createDocument({
    body: row,
    href: "https://www.zhipin.com/web/frame/recommend/?source=0"
  });

  const target = buildGreetingClickTargetFromElement({
    actionElement: button,
    currentDocument,
    page: classifyPage("https://www.zhipin.com/web/chat/recommend")
  });
  const payload = buildGreetingClickPayload({
    page: classifyPage("https://www.zhipin.com/web/chat/recommend"),
    ...target
  });

  assert.equal(payload.candidate.profile.displayName, "吴先生");
  assert.equal(payload.candidate.profile.age, 28);
  assert.equal(payload.candidate.profile.expectedLocation, "杭州");
  assert.equal(payload.candidate.profile.expectedPosition, "直播运营");
  assert.equal(Object.hasOwn(payload, "page"), false);
  assert.equal(Object.hasOwn(payload, "sourceUrl"), false);
  assert.equal(Object.hasOwn(payload, "greeting"), false);
});

test("greeting click payload includes candidate snapshot without raw card text", () => {
  const payload = buildGreetingClickPayload({
    page: classifyPage("https://www.zhipin.com/web/chat/recommend"),
    sourceUrl: "https://www.zhipin.com/web/chat/index?geekId=abc123",
    entry: "candidate_list",
    actionText: "打招呼",
    text: [
      "吴先生 刚刚活跃",
      "7-8K",
      "28岁 7年 高中 离职-随时到岗",
      "期望",
      "杭州 直播运营",
      "优势 很长的候选人介绍不应该进入 payload",
      "打招呼"
    ].join("\n")
  });

  assert.equal(payload.entry, "candidate_list");
  assert.equal(payload.candidate.stableId, "abc123");
  assert.equal(payload.candidate.stableIdSource, "url.geekId");
  assert.equal(payload.candidate.profile.displayName, "吴先生");
  assert.equal(payload.candidate.profile.expectedPosition, "直播运营");
  assert.equal(Object.hasOwn(payload, "page"), false);
  assert.equal(Object.hasOwn(payload, "sourceUrl"), false);
  assert.equal(Object.hasOwn(payload, "greeting"), false);
  assert.equal(JSON.stringify(payload).includes("很长的候选人介绍"), false);
});

test("greeting click target inherits exposure association from the clicked candidate card", () => {
  const button = createElement({
    tagName: "BUTTON",
    text: "打招呼"
  });
  const card = createElement({
    text: [
      "周先生 刚刚活跃",
      "9-12K",
      "29岁 6年 本科 离职-随时到岗",
      "期望 杭州 主播",
      "打招呼"
    ].join("\n"),
    children: [button]
  });
  const association = registerCandidateCardAssociation({
    element: card,
    candidate: {
      stableId: "geek-9",
      stableIdSource: "url.geekId",
      detailUrl: "https://www.zhipin.com/web/chat/index?geekId=geek-9",
      profile: {
        displayName: "周先生",
        age: 29,
        expectedPosition: "主播"
      }
    },
    listUrl: "https://www.zhipin.com/web/chat/recommend",
    listPageType: "candidate_recommend",
    exposedEventId: "evt_exposed"
  });
  const currentDocument = createDocument({
    body: card,
    href: "https://www.zhipin.com/web/frame/recommend/?source=0"
  });

  const target = buildGreetingClickTargetFromElement({
    actionElement: button,
    currentDocument,
    page: classifyPage("https://www.zhipin.com/web/chat/recommend")
  });
  const payload = buildGreetingClickPayload({
    page: classifyPage("https://www.zhipin.com/web/chat/recommend"),
    ...target
  });

  assert.equal(target.candidateAssociation?.cardId, association.cardId);
  assert.equal(payload.candidate.stableId, "geek-9");
  assert.equal(payload.candidate.candidateId, association.cardId);
  assert.equal(payload.candidate.exposureKey, association.exposureKey);
  assert.equal(payload.candidate.exposedEventId, "evt_exposed");
  assert.equal(Object.hasOwn(payload, "greeting"), false);
});

test("greeting click target inherits recent detail candidate when action text has no profile context", () => {
  let now = 1000;
  const button = createElement({
    tagName: "BUTTON",
    text: "打招呼"
  });
  const currentDocument = createDocument({
    body: button,
    href: "https://www.zhipin.com/web/frame/recommend/?source=0"
  });
  const detailAssociation = rememberCandidateSnapshotAssociation({
    candidate: {
      candidateId: "bo_candidate_detail_1",
      stableId: "card_detail_1",
      stableIdSource: "text_fingerprint",
      profile: {
        displayName: "谢蓉",
        age: 27,
        education: "大专",
        experience: "19年毕业"
      },
      detailProfile: {
        sectionKeys: ["advantage"]
      }
    },
    interactionType: "candidate_detail_opened",
    sourceUrl: "https://www.zhipin.com/web/frame/c-resume/",
    now: () => now
  });
  const otherAssociation = registerCandidateCardAssociation({
    element: createElement({}),
    candidate: {
      stableId: "other_card",
      stableIdSource: "text_fingerprint",
      profile: {
        displayName: "其他候选人",
        age: 25
      }
    },
    listUrl: "https://www.zhipin.com/web/chat/recommend",
    listPageType: "candidate_recommend"
  });
  now = 1200;
  recordCandidateCardInteraction(otherAssociation.cardId, {
    interactionType: "candidate_card_click",
    sourceUrl: "https://www.zhipin.com/web/frame/recommend/",
    now: () => now
  });
  now = 1400;

  const target = buildGreetingClickTargetFromElement({
    actionElement: button,
    currentDocument,
    page: classifyPage("https://www.zhipin.com/web/chat/recommend"),
    now: () => now
  });
  const payload = buildGreetingClickPayload({
    page: classifyPage("https://www.zhipin.com/web/chat/recommend"),
    ...target
  });

  assert.equal(target.entry, "candidate_detail");
  assert.equal(target.candidateAssociation?.cardId, detailAssociation.cardId);
  assert.equal(payload.candidate.candidateId, "bo_candidate_detail_1");
  assert.equal(payload.candidate.profile.displayName, "谢蓉");
  assert.equal(payload.candidate.profile.education, "大专");
  assert.deepEqual(payload.candidate.detailProfile.sectionKeys, ["advantage"]);
});

test("greeting click payload hydrates candidate profile from registry when candidate id matches", () => {
  const association = registerCandidateCardAssociation({
    element: createElement({}),
    candidate: {
      stableId: "geek-9",
      stableIdSource: "url.geekId",
      detailUrl: "https://www.zhipin.com/web/chat/index?geekId=geek-9",
      profile: {
        displayName: "周先生",
        age: 29,
        expectedPosition: "主播"
      }
    },
    listUrl: "https://www.zhipin.com/web/chat/recommend",
    listPageType: "candidate_recommend",
    exposedEventId: "evt_exposed"
  });

  const payload = buildGreetingClickPayload({
    sourceUrl: "https://www.zhipin.com/web/chat/index?geekId=geek-9",
    entry: "candidate_list",
    text: "打招呼"
  });

  assert.equal(payload.candidate.candidateId, association.cardId);
  assert.equal(payload.candidate.exposedEventId, "evt_exposed");
  assert.equal(payload.candidate.profile.displayName, "周先生");
  assert.equal(payload.candidate.profile.expectedPosition, "主播");
});

test("greeting result text classifies success and failure signals", () => {
  assert.deepEqual(classifyGreetingResultText("打招呼成功，等待对方回复"), {
    status: "succeeded",
    matchedSignals: ["greeting_succeeded", "communication_started"]
  });
  assert.deepEqual(classifyGreetingResultText("今日打招呼人数已达上限，请稍后再试"), {
    status: "failed",
    matchedSignals: ["quota_limit", "rate_limited"]
  });
  assert.deepEqual(classifyGreetingResultText("打招呼"), {
    status: "",
    matchedSignals: []
  });
});

test("greeting probe emits click and success result for a pending attempt", () => {
  let now = 1000;
  const collector = createCollector();
  const probe = new GreetingProbe({
    collector,
    sessionContext: createSessionContext("https://www.zhipin.com/web/chat/recommend"),
    detectOutcome: () => ({
      status: "succeeded",
      detectedBy: "page_message",
      matchedSignals: ["greeting_succeeded"]
    }),
    now: () => now
  });

  probe.recordGreetingClickTarget({
    sourceUrl: "https://www.zhipin.com/web/chat/index?geekId=abc123",
    entry: "candidate_list",
    actionText: "打招呼",
    text: "吴先生 28岁 本科 期望 杭州 直播运营 打招呼"
  });
  now = 1800;
  probe.scan("poll");

  assert.deepEqual(
    collector.events.map((event) => event.type),
    [
      EVENT_TYPES.CANDIDATE_GREETING_CLICKED,
      EVENT_TYPES.CANDIDATE_GREETING_SUCCEEDED
    ]
  );
  assert.equal(collector.events[1].payload.clickedEventId, "evt_1");
  assert.equal(collector.events[1].payload.elapsedMs, 800);
  assert.equal(collector.events[1].payload.greeting.status, "succeeded");
  assert.equal(Object.hasOwn(collector.events[1].payload.greeting, "matchedSignals"), false);
  assert.equal(collector.events[1].payload.candidate.stableId, "abc123");
});

test("greeting probe emits failed result only when a failure signal is observed", () => {
  const collector = createCollector();
  const probe = new GreetingProbe({
    collector,
    sessionContext: createSessionContext("https://www.zhipin.com/web/chat/recommend"),
    detectOutcome: () => ({
      status: "failed",
      detectedBy: "page_message",
      matchedSignals: ["quota_limit"]
    }),
    now: () => 1000
  });

  probe.recordGreetingClickTarget({
    sourceUrl: "https://www.zhipin.com/web/chat/index?geekId=abc123",
    entry: "candidate_list",
    actionText: "打招呼",
    text: "吴先生 28岁 本科 期望 杭州 直播运营 打招呼"
  });
  probe.scan("poll");

  assert.deepEqual(
    collector.events.map((event) => event.type),
    [
      EVENT_TYPES.CANDIDATE_GREETING_CLICKED,
      EVENT_TYPES.CANDIDATE_GREETING_FAILED
    ]
  );
  assert.equal(collector.events[1].payload.greeting.status, "failed");
  assert.equal(Object.hasOwn(collector.events[1].payload.greeting, "matchedSignals"), false);
});

test("greeting probe expires unconfirmed attempts without emitting false failure", () => {
  let now = 1000;
  const collector = createCollector();
  const probe = new GreetingProbe({
    collector,
    sessionContext: createSessionContext("https://www.zhipin.com/web/chat/recommend"),
    resultTimeoutMs: 1000,
    detectOutcome: () => ({
      status: "",
      matchedSignals: []
    }),
    now: () => now
  });

  probe.recordGreetingClickTarget({
    sourceUrl: "https://www.zhipin.com/web/chat/index?geekId=abc123",
    entry: "candidate_list",
    actionText: "打招呼",
    text: "吴先生 28岁 本科 期望 杭州 直播运营 打招呼"
  });
  now = 2500;
  probe.scan("poll");

  assert.deepEqual(
    collector.events.map((event) => event.type),
    [EVENT_TYPES.CANDIDATE_GREETING_CLICKED]
  );
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

function createDocument({ body, href }) {
  return {
    body,
    documentElement: body,
    location: {
      href
    }
  };
}

function createElement({
  tagName = "DIV",
  text = "",
  parentElement = null,
  children = [],
  dataset = {},
  rect = { top: 0, right: 0, bottom: 0, left: 0 }
}) {
  const element = {
    tagName,
    parentElement,
    children,
    dataset,
    get innerText() {
      return text || this.children.map((child) => child.innerText).filter(Boolean).join("\n");
    },
    get textContent() {
      return this.innerText;
    },
    getAttribute() {
      return "";
    },
    getBoundingClientRect() {
      return rect;
    },
    contains(target) {
      if (this === target) {
        return true;
      }
      return this.children.some((child) => child.contains(target));
    },
    querySelectorAll(selector) {
      if (selector !== "a[href]") {
        return [];
      }
      return collectDescendants(this).filter((candidate) => candidate.href);
    }
  };

  children.forEach((child) => {
    child.parentElement = element;
  });
  return element;
}

function collectDescendants(element) {
  return element.children.flatMap((child) => [child, ...collectDescendants(child)]);
}
