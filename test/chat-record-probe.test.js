import test from "node:test";
import assert from "node:assert/strict";

import {
  buildChatCandidatePayload,
  buildChatReportPrompt,
  buildChatSnapshotPayload,
  ChatRecordProbe,
  CHAT_REPORT_PROMPT_TEXT,
  collectChatMessagesFromText,
  extractWechatAccountsFromText,
  findChatListItems,
  parseChatListItemText,
  parseClearlyTodayChatListTime
} from "../extension/src/content/chat-record-probe.js";
import { EVENT_TYPES } from "../extension/src/shared/event-types.js";

const FIXED_NOW = () => new Date(2026, 4, 15, 14, 20, 0, 0);

test("chat list parser treats plain clock time as today", () => {
  const parsed = parseChatListItemText(
    "1 09:54 桂儿 【8000+】居家黑板主播（时薪40+可兼职） 哦",
    { now: FIXED_NOW }
  );

  assert.equal(parsed.lastMessageAt, "2026-05-15T09:54:00.000+08:00");
  assert.equal(parsed.lastMessageTimeText, "09:54");
  assert.equal(parsed.displayName, "桂儿");
});

test("chat list parser keeps multiline job title separate from preview", () => {
  const parsed = parseChatListItemText(
    [
      "09:54 桂儿 【8000+】居家黑板主播（时薪40+可兼职）",
      "哦"
    ].join("\n"),
    { now: FIXED_NOW }
  );

  assert.equal(parsed.jobTitle, "【8000+】居家黑板主播（时薪40+可兼职）");
  assert.equal(parsed.lastMessagePreview, "哦");
});

test("chat list parser ignores non-today time labels", () => {
  assert.equal(
    parseClearlyTodayChatListTime("昨天 李艳妮 【8000+】居家黑板主播 对的", { now: FIXED_NOW }),
    null
  );
  assert.equal(
    parseClearlyTodayChatListTime("05-14 李艳妮 【8000+】居家黑板主播 对的", { now: FIXED_NOW }),
    null
  );
});

test("chat list parser ignores active chat position timeline rows", () => {
  assert.equal(
    parseChatListItemText("09:54 5月16日 沟通的职位-【8000+】居家黑板主播（时薪40+可兼职）", { now: FIXED_NOW }),
    null
  );
});

test("chat report prompt compares list time with last successful report watermark", () => {
  const item = {
    lastMessageAt: "2026-05-15T09:54:00.000+08:00",
    candidate: {
      candidateId: "candidate_1"
    }
  };

  assert.equal(buildChatReportPrompt(item, { candidates: {} }).required, true);
  assert.equal(buildChatReportPrompt(item, {
    candidates: {
      candidate_1: {
        lastReportedMessageAt: "2026-05-15T09:20:00.000+08:00"
      }
    }
  }).required, true);
  assert.equal(buildChatReportPrompt(item, {
    candidates: {
      candidate_1: {
        lastReportedMessageAt: "2026-05-15T10:00:00.000+08:00"
      }
    }
  }).required, false);
});

test("chat list finder keeps one prompt target per visible conversation", () => {
  const parent = createListElement([
    "09:54 桂儿 【8000+】居家黑板主播（时薪40+可兼职） 哦",
    "10:00 陈女士 【8000+】居家黑板主播（时薪40+可兼职） 露脸"
  ].join(" "));
  const card = createListElement("09:54 桂儿 【8000+】居家黑板主播（时薪40+可兼职） 哦");
  const nested = createListElement("09:54 桂儿 【8000+】居家黑板主播（时薪40+可兼职）");
  const otherCard = createListElement("10:00 陈女士 【8000+】居家黑板主播（时薪40+可兼职） 露脸");
  appendListChild(parent, card);
  appendListChild(card, nested);
  appendListChild(parent, otherCard);
  const root = createListRoot([parent, card, nested, otherCard]);

  const items = findChatListItems(root, { now: FIXED_NOW });

  assert.equal(items.length, 2);
  const names = items.map((item) => item.displayName).sort();
  assert.deepEqual(names, ["桂儿", "陈女士"]);
  assert.equal(items.find((item) => item.displayName === "桂儿").element, card);
});

test("chat list prompt event dedupes when low confidence id changes during render", async () => {
  const events = [];
  const probe = new ChatRecordProbe({
    collector: {
      collect(type, payload) {
        events.push({ type, payload });
      }
    },
    sessionContext: {
      page: {
        isBossPage: true,
        pageType: "chat",
        url: "https://www.zhipin.com/web/chat/index"
      }
    },
    now: FIXED_NOW,
    readReportState: () => ({ candidates: {} })
  });
  const originalDocument = globalThis.document;
  try {
    globalThis.document = createListRoot([
      createListElement("09:54 桂儿 【8000+】居家黑板主播（时薪40+可兼职） 哦")
    ]);
    await probe.scan("test");
    globalThis.document = createListRoot([
      createListElement([
        "09:54 桂儿 【8000+】居家黑板主播（时薪40+可兼职）",
        "哦"
      ].join("\n"))
    ]);
    await probe.scan("test");
  } finally {
    globalThis.document = originalDocument;
  }

  assert.equal(
    events.filter((event) => event.type === EVENT_TYPES.CANDIDATE_CHAT_REPORT_REQUIRED).length,
    1
  );
});

test("chat report required event does not render into the BOSS page DOM", async () => {
  const events = [];
  const card = createListElement("09:54 桂儿 【8000+】居家黑板主播（时薪40+可兼职） 哦");
  const root = createListRoot([card]);
  const probe = new ChatRecordProbe({
    collector: {
      collect(type, payload) {
        events.push({ type, payload });
      }
    },
    sessionContext: {
      page: {
        isBossPage: true,
        pageType: "chat",
        url: "https://www.zhipin.com/web/chat/index"
      }
    },
    now: FIXED_NOW,
    readReportState: () => ({ candidates: {} })
  });
  const originalDocument = globalThis.document;
  try {
    globalThis.document = root;
    await probe.scan("test");
  } finally {
    globalThis.document = originalDocument;
  }

  assert.equal(card.children.length, 0);
  assert.equal(card.textContent.includes(CHAT_REPORT_PROMPT_TEXT), false);
  assert.equal(card.getAttribute("data-boss-observer-chat-report-required"), null);
  assert.equal(root.body.children.length, 0);
  assert.equal(
    events.filter((event) => event.type === EVENT_TYPES.CANDIDATE_CHAT_REPORT_REQUIRED).length,
    1
  );
  assert.equal(
    events.find((event) => event.type === EVENT_TYPES.CANDIDATE_CHAT_REPORT_REQUIRED).payload.listItem.displayName,
    "桂儿"
  );
});

test("chat snapshot emits again on repeated manual open until upload watermark advances", async () => {
  const events = [];
  const card = createListElement([
    "09:54 桂儿 【8000+】居家黑板主播（时薪40+可兼职）",
    "哦"
  ].join("\n"));
  const panel = createChatPanelElement();
  const root = createListRoot([card, panel]);
  const probe = new ChatRecordProbe({
    collector: {
      collect(type, payload) {
        events.push({ type, payload });
      }
    },
    sessionContext: {
      page: {
        isBossPage: true,
        pageType: "chat",
        url: "https://www.zhipin.com/web/chat/index"
      }
    },
    now: FIXED_NOW,
    readReportState: () => ({ candidates: {} })
  });
  const originalDocument = globalThis.document;
  try {
    globalThis.document = root;
    await probe.scan("test");
    await probe.scan("poll");
    assert.equal(
      events.filter((event) => event.type === EVENT_TYPES.CANDIDATE_CHAT_SNAPSHOT_CAPTURED).length,
      1
    );

    assert.equal(probe.recordChatListOpenAttempt(card), true);
    await probe.scan("chat_list_click");
  } finally {
    globalThis.document = originalDocument;
  }

  assert.equal(
    events.filter((event) => event.type === EVENT_TYPES.CANDIDATE_CHAT_OPENED).length,
    2
  );
  assert.equal(
    events.filter((event) => event.type === EVENT_TYPES.CANDIDATE_CHAT_SNAPSHOT_CAPTURED).length,
    2
  );
});

test("chat snapshot skips submit when successful upload watermark already covers latest message", async () => {
  const events = [];
  const card = createListElement([
    "09:54 桂儿 【8000+】居家黑板主播（时薪40+可兼职）",
    "哦"
  ].join("\n"));
  const panel = createChatPanelElement();
  const payload = buildChatSnapshotPayload(panel, {
    source: "test",
    chatPageUrl: "https://www.zhipin.com/web/chat/index",
    now: FIXED_NOW
  });
  const root = createListRoot([card, panel]);
  const probe = new ChatRecordProbe({
    collector: {
      collect(type, currentPayload) {
        events.push({ type, payload: currentPayload });
      }
    },
    sessionContext: {
      page: {
        isBossPage: true,
        pageType: "chat",
        url: "https://www.zhipin.com/web/chat/index"
      }
    },
    now: FIXED_NOW,
    readReportState: () => ({
      candidates: {
        [payload.candidate.candidateId]: {
          lastReportedMessageAt: payload.chat.lastMessageAt
        }
      }
    })
  });
  const originalDocument = globalThis.document;
  try {
    globalThis.document = root;
    assert.equal(probe.recordChatListOpenAttempt(card), true);
    await probe.scan("chat_list_click");
  } finally {
    globalThis.document = originalDocument;
  }

  assert.equal(
    events.filter((event) => event.type === EVENT_TYPES.CANDIDATE_CHAT_OPENED).length,
    1
  );
  assert.equal(
    events.filter((event) => event.type === EVENT_TYPES.CANDIDATE_CHAT_SNAPSHOT_CAPTURED).length,
    0
  );
});

test("manual chat open submits snapshot when list latest message is newer than visible DOM text", async () => {
  const events = [];
  const card = createListElement([
    "12:45 李女士 【8000+】居家黑板主播（时薪40+可兼职）",
    "👌"
  ].join("\n"));
  const panel = createListElement([
    "李女士",
    "今日活跃",
    "在线简历",
    "附件简历",
    "沟通职位： 【8000+】居家黑板主播（时薪40+可兼职）",
    "12:44",
    "已读 好的",
    "发送"
  ].join("\n"));
  const panelPayload = buildChatSnapshotPayload(panel, {
    source: "test",
    chatPageUrl: "https://www.zhipin.com/web/chat/index",
    now: FIXED_NOW
  });
  const root = createListRoot([card, panel]);
  const probe = new ChatRecordProbe({
    collector: {
      collect(type, currentPayload) {
        events.push({ type, payload: currentPayload });
      }
    },
    sessionContext: {
      page: {
        isBossPage: true,
        pageType: "chat",
        url: "https://www.zhipin.com/web/chat/index"
      }
    },
    now: FIXED_NOW,
    readReportState: () => ({
      candidates: {
        [panelPayload.candidate.candidateId]: {
          lastReportedMessageAt: "2026-05-15T12:44:00.000+08:00"
        }
      }
    })
  });
  const originalDocument = globalThis.document;
  try {
    globalThis.document = root;
    assert.equal(probe.recordChatListOpenAttempt(card), true);
    await probe.scan("chat_list_click");
  } finally {
    globalThis.document = originalDocument;
  }

  const snapshot = events.find((event) =>
    event.type === EVENT_TYPES.CANDIDATE_CHAT_SNAPSHOT_CAPTURED
  );
  assert.ok(snapshot);
  assert.equal(snapshot.payload.chat.lastMessageAt, "2026-05-15T12:44:00.000+08:00");
  assert.equal(snapshot.payload.chat.coverageLastMessageAt, "2026-05-15T12:45:00.000+08:00");
  assert.equal(snapshot.payload.chat.listObservedLastMessageAt, "2026-05-15T12:45:00.000+08:00");
  assert.equal(snapshot.payload.chat.listObservedLastMessageTimeText, "12:45");
  assert.equal(snapshot.payload.chat.hasUncapturedListMessage, true);
  assert.equal(snapshot.payload.chat.messageCount, 1);
});

test("chat snapshot parser captures rendered text messages and skips media urls", () => {
  const panel = createElement({
    text: [
      "桂儿",
      "刚刚活跃",
      "32岁",
      "在线简历",
      "附件简历",
      "沟通职位： 兼职·【8000+】居家黑板主播（时薪40+可兼职）",
      "期望： 南阳 · 兼职·网络客服",
      "05-12 12:54",
      "5月12日 沟通的职位-【8000+】居家黑板主播（时薪40+可兼职）",
      "BOSS好，我对这份工作很感兴趣",
      "05-12 13:39",
      "已读 你好，可以聊一聊啊",
      "09:54",
      "哦",
      "/607f1f3d68754fd020fbcb75ab0befd7bd6006b650337d5a1d9260dfe6d260c48a0854e1e087ae30_s.jpeg.webp",
      "求简历",
      "换微信",
      "发送"
    ].join("\n"),
    media: {
      img: 2
    }
  });

  const payload = buildChatSnapshotPayload(panel, {
    source: "test",
    chatPageUrl: "https://www.zhipin.com/web/chat/index",
    now: FIXED_NOW
  });

  assert.equal(payload.candidate.profile.displayName, "桂儿");
  assert.equal(payload.candidate.identityConfidence, "low");
  assert.equal(payload.chat.messageCount, 3);
  assert.equal(payload.chat.firstMessageAt, "2026-05-12T12:54:00.000+08:00");
  assert.equal(payload.chat.lastMessageAt, "2026-05-15T09:54:00.000+08:00");
  assert.deepEqual(payload.chat.messages.map((message) => message.text), [
    "BOSS好，我对这份工作很感兴趣",
    "你好，可以聊一聊啊",
    "哦"
  ]);
  assert.equal(payload.chat.messages[1].direction, "recruiter");
  assert.equal(payload.chat.messages[1].status, "已读");
  assert.equal(JSON.stringify(payload).includes(".jpeg.webp"), false);
  assert.equal(payload.chat.mediaSummary.imageNodeCount, 2);
});

test("chat snapshot parser keeps live innerText line breaks", () => {
  const liveText = [
    "桂儿",
    "在线简历",
    "附件简历",
    "沟通职位： 兼职·【8000+】居家黑板主播（时薪40+可兼职）",
    "09:54",
    "BOSS好，我对这份工作很感兴趣",
    "10:02",
    "已读 可以聊一下",
    "发送"
  ].join("\n");
  const panel = {
    innerText: liveText,
    textContent: liveText.replaceAll("\n", " "),
    dataset: {},
    parentElement: null,
    cloneNode() {
      return {
        innerText: "",
        textContent: liveText.replaceAll("\n", " "),
        querySelectorAll() {
          return [];
        }
      };
    },
    querySelectorAll() {
      return [];
    }
  };

  const payload = buildChatSnapshotPayload(panel, {
    source: "test",
    chatPageUrl: "https://www.zhipin.com/web/chat/index",
    now: FIXED_NOW
  });

  assert.equal(payload.chat.messageCount, 2);
  assert.deepEqual(payload.chat.messages.map((message) => message.text), [
    "BOSS好，我对这份工作很感兴趣",
    "可以聊一下"
  ]);
});

test("chat message parser ignores boss observer prompt text", () => {
  const messages = collectChatMessagesFromText([
    "09:54",
    CHAT_REPORT_PROMPT_TEXT,
    `哦 ${CHAT_REPORT_PROMPT_TEXT}`,
    "发送"
  ].join("\n"), { now: FIXED_NOW });

  assert.deepEqual(messages.map((message) => message.text), ["哦"]);
});

test("chat fallback candidate id includes job title to reduce same-name collisions", () => {
  const firstPanel = createElement({
    text: [
      "王女士",
      "在线简历",
      "附件简历",
      "沟通职位： 【8000+】居家黑板主播（时薪40+可兼职）",
      "09:54",
      "你好"
    ].join("\n")
  });
  const secondPanel = createElement({
    text: [
      "王女士",
      "在线简历",
      "附件简历",
      "沟通职位： 【8000+】搞笑兼职主播（时薪40+）",
      "09:55",
      "你好"
    ].join("\n")
  });

  const firstPayload = buildChatSnapshotPayload(firstPanel, {
    chatPageUrl: "https://www.zhipin.com/web/chat/index",
    now: FIXED_NOW
  });
  const secondPayload = buildChatSnapshotPayload(secondPanel, {
    chatPageUrl: "https://www.zhipin.com/web/chat/index",
    now: FIXED_NOW
  });

  assert.equal(firstPayload.candidate.stableIdSource, "chat_name_job_fingerprint");
  assert.equal(secondPayload.candidate.stableIdSource, "chat_name_job_fingerprint");
  assert.notEqual(firstPayload.candidate.candidateId, secondPayload.candidate.candidateId);
});

test("chat fallback candidate id matches list and active panel identity variants", () => {
  const listCandidate = buildChatCandidatePayload({
    displayName: "蒋姜",
    jobTitle: "【8000+】居家黑板主播（时薪40+可兼职）",
    sourceUrl: "https://www.zhipin.com/web/chat/index"
  });
  const panelCandidate = buildChatCandidatePayload({
    displayName: "蒋姜",
    jobTitle: "兼职·【8000+】 居家黑板主播（时薪40+可兼职）",
    sourceUrl: "https://www.zhipin.com/web/chat/index?_security_check=1_1778940420467"
  });

  assert.equal(listCandidate.stableIdSource, "chat_name_job_fingerprint");
  assert.equal(panelCandidate.stableIdSource, "chat_name_job_fingerprint");
  assert.equal(listCandidate.candidateId, panelCandidate.candidateId);
});

test("chat message parser extracts wechat account only with explicit context", () => {
  assert.deepEqual(extractWechatAccountsFromText("我的微信是 wxid_test_123"), ["wxid_test_123"]);
  assert.deepEqual(extractWechatAccountsFromText("换微信"), []);
  assert.deepEqual(extractWechatAccountsFromText("普通英文 abcdef12345"), []);
});

test("chat snapshot includes wechat payload from chat text", () => {
  const panel = createElement({
    text: [
      "李女士",
      "今日活跃",
      "在线简历",
      "附件简历",
      "沟通职位： 全职·客服专员",
      "09:10",
      "我的微信是 wxid_test_123",
      "发送"
    ].join("\n")
  });

  const payload = buildChatSnapshotPayload(panel, {
    source: "test",
    chatPageUrl: "https://www.zhipin.com/web/chat/index",
    now: FIXED_NOW
  });

  assert.deepEqual(payload.chat.wechat.accounts, ["wxid_test_123"]);
  assert.equal(payload.chat.wechat.source, "chat_text");
  assert.equal(payload.chat.wechat.detectedAtMessageAt, "2026-05-15T09:10:00.000+08:00");
});

test("chat message parser supports yesterday timestamps", () => {
  const messages = collectChatMessagesFromText([
    "昨天 21:32",
    "已读 我们是做娱乐直播MCN机构的",
    "发送"
  ].join("\n"), { now: FIXED_NOW });

  assert.equal(messages[0].messageAt, "2026-05-14T21:32:00.000+08:00");
  assert.equal(messages[0].text, "我们是做娱乐直播MCN机构的");
});

function createElement({ text = "", media = {} } = {}) {
  return {
    innerText: text,
    textContent: text,
    dataset: {},
    parentElement: null,
    querySelectorAll(selector) {
      if (selector === "img") {
        return new Array(media.img || 0).fill(null);
      }
      if (selector === "audio") {
        return new Array(media.audio || 0).fill(null);
      }
      if (selector === "video") {
        return new Array(media.video || 0).fill(null);
      }
      return [];
    }
  };
}

function createChatPanelElement() {
  return createListElement([
    "桂儿",
    "刚刚活跃",
    "在线简历",
    "附件简历",
    "沟通职位： 【8000+】居家黑板主播（时薪40+可兼职）",
    "09:54",
    "哦",
    "发送"
  ].join("\n"));
}

function createListRoot(elements = []) {
  const body = createListElement("");
  const root = {
    body,
    location: {
      href: "https://www.zhipin.com/web/chat/index"
    },
    createElement() {
      const element = createListElement("");
      element.ownerDocument = root;
      return element;
    },
    querySelector(selector) {
      return this.querySelectorAll(selector)[0] || null;
    },
    querySelectorAll(selector = "") {
      if (selector.includes("data-boss-observer-chat-report-overlay")) {
        return body.querySelectorAll(selector);
      }
      return elements;
    }
  };
  body.ownerDocument = root;
  elements.forEach((element) => {
    assignOwnerDocument(element, root);
  });
  return root;
}

function createListElement(text = "") {
  return {
    attributes: {},
    innerText: text,
    textContent: text,
    dataset: {},
    parentElement: null,
    ownerDocument: null,
    children: [],
    style: {},
    appendChild(child) {
      child.parentElement = this;
      child.ownerDocument = this.ownerDocument;
      this.children.push(child);
      return child;
    },
    cloneNode() {
      return null;
    },
    getAttribute(name) {
      return this.attributes[name] ?? null;
    },
    getBoundingClientRect() {
      return {
        left: 10,
        top: 20,
        width: 220,
        height: 60
      };
    },
    querySelector(selector) {
      return this.querySelectorAll(selector)[0] || null;
    },
    querySelectorAll(selector = "") {
      const matches = [];
      this.children.forEach((child) => {
        if (matchesSelector(child, selector)) {
          matches.push(child);
        }
        matches.push(...child.querySelectorAll(selector));
      });
      return matches;
    },
    remove() {
      if (!this.parentElement) {
        return;
      }
      this.parentElement.children = this.parentElement.children.filter((child) => child !== this);
      this.parentElement = null;
    },
    removeAttribute(name) {
      delete this.attributes[name];
    },
    setAttribute(name, value) {
      this.attributes[name] = String(value);
    },
    contains(target) {
      return this.children.some((child) => child === target || child.contains(target));
    }
  };
}

function appendListChild(parent, child) {
  child.parentElement = parent;
  child.ownerDocument = parent.ownerDocument;
  parent.children.push(child);
}

function assignOwnerDocument(element, ownerDocument) {
  element.ownerDocument = ownerDocument;
  element.children.forEach((child) => {
    assignOwnerDocument(child, ownerDocument);
  });
}

function matchesSelector(element, selector = "") {
  if (selector.includes("data-boss-observer-chat-report-overlay")) {
    return element.getAttribute("data-boss-observer-chat-report-overlay") === "true";
  }
  if (selector.includes("data-boss-observer-chat-report-prompt")) {
    return element.getAttribute("data-boss-observer-chat-report-prompt") === "true";
  }
  return false;
}
