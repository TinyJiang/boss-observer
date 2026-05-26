import test from "node:test";
import assert from "node:assert/strict";

import {
  buildChatCandidatePayload,
  buildPendingChatCandidatesFromListItems,
  buildChatSnapshotPayload,
  ChatRecordProbe,
  collectChatMessagesFromText,
  extractWechatAccountsFromText,
  findChatListItems,
  parseChatListItemText,
  parseClearlyTodayChatListTime
} from "../extension/src/content/chat-record-probe.js";
import { EVENT_TYPES } from "../extension/src/shared/event-types.js";
import {
  loadChatMessageCleanupRules,
  shouldIgnoreChatMessageText
} from "../extension/src/shared/chat-message-cleanup.js";

const FIXED_NOW = () => new Date(2026, 4, 15, 14, 20, 0, 0);
const LEGACY_CHAT_REPORT_PROMPT_TEXT = "今日聊天未上报，请点开补采";

test("chat list parser treats plain clock time as today", () => {
  const parsed = parseChatListItemText(
    "1 09:54 桂儿 【8000+】居家黑板主播（时薪40+可兼职） 哦",
    { now: FIXED_NOW }
  );

  assert.equal(parsed.lastMessageAt, "2026-05-15T09:54:00.000+08:00");
  assert.equal(parsed.lastMessageTimeText, "09:54");
  assert.equal(parsed.displayName, "桂儿");
  assert.equal(parsed.jobTitle, "【8000+】居家黑板主播（时薪40+可兼职）");
  assert.equal(parsed.lastMessagePreview, "哦");
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

test("chat list parser keeps one candidate identity when single-line preview changes", () => {
  const firstRoot = createListRoot([
    createListElement("09:54 陈月雨 【8000+】居家黑板主播（时薪40+可兼职）")
  ]);
  const secondRoot = createListRoot([
    createListElement("09:55 陈月雨 【8000+】居家黑板主播（时薪40+可兼职） 陈月雨的微信号：19072460958")
  ]);
  const thirdRoot = createListRoot([
    createListElement("09:56 陈月雨 【8000+】居家黑板主播（时薪40+可兼职） [抠鼻][发呆]")
  ]);

  const [first] = findChatListItems(firstRoot, { now: FIXED_NOW });
  const [second] = findChatListItems(secondRoot, { now: FIXED_NOW });
  const [third] = findChatListItems(thirdRoot, { now: FIXED_NOW });

  assert.equal(first.jobTitle, "【8000+】居家黑板主播（时薪40+可兼职）");
  assert.equal(second.jobTitle, "【8000+】居家黑板主播（时薪40+可兼职）");
  assert.equal(third.jobTitle, "【8000+】居家黑板主播（时薪40+可兼职）");
  assert.equal(second.lastMessagePreview, "陈月雨的微信号：19072460958");
  assert.equal(third.lastMessagePreview, "[抠鼻][发呆]");
  assert.equal(first.candidate.candidateId, second.candidate.candidateId);
  assert.equal(second.candidate.candidateId, third.candidate.candidateId);
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

test("chat list scan does not emit report required events", async () => {
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
  } finally {
    globalThis.document = originalDocument;
  }

  assert.deepEqual(events, []);
});

test("chat list scan publishes local-only pending candidate names", async () => {
  const events = [];
  const messages = [];
  const pendingCard = createListElement("09:54 桂儿 【8000+】居家黑板主播（时薪40+可兼职） 哦");
  const reportedCard = createListElement("10:00 陈女士 【8000+】居家黑板主播（时薪40+可兼职） 好的");
  const root = createListRoot([pendingCard, reportedCard]);
  const reportedItem = findChatListItems(root, { now: FIXED_NOW })
    .find((item) => item.displayName === "陈女士");
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
    readReportState: () => ({
      candidates: {
        [reportedItem.candidate.candidateId]: {
          lastReportedMessageAt: "2026-05-15T10:00:00.000+08:00"
        }
      }
    })
  });
  const originalDocument = globalThis.document;
  const originalChrome = globalThis.chrome;
  try {
    globalThis.document = root;
    globalThis.chrome = {
      runtime: {
        sendMessage(message, callback) {
          messages.push(message);
          callback?.({ ok: true });
        }
      }
    };
    await probe.scan("test");
  } finally {
    globalThis.document = originalDocument;
    globalThis.chrome = originalChrome;
  }

  assert.deepEqual(events, []);
  assert.equal(messages.length, 1);
  assert.equal(messages[0].kind, "bossObserver.chatPendingCandidatesObserved");
  assert.deepEqual(messages[0].candidates.map((candidate) => candidate.displayName), ["桂儿"]);
  assert.equal(messages[0].candidates[0].lastMessageTimeText, "09:54");
});

test("pending chat candidate builder uses successful report watermarks", () => {
  const root = createListRoot([
    createListElement("09:54 桂儿 【8000+】居家黑板主播（时薪40+可兼职） 哦"),
    createListElement("10:00 陈女士 【8000+】居家黑板主播（时薪40+可兼职） 好的")
  ]);
  const items = findChatListItems(root, { now: FIXED_NOW });
  const reportedItem = items.find((item) => item.displayName === "陈女士");

  const pending = buildPendingChatCandidatesFromListItems(items, {
    candidates: {
      [reportedItem.candidate.candidateId]: {
        lastReportedMessageAt: "2026-05-15T10:00:00.000+08:00"
      }
    }
  });

  assert.deepEqual(pending.map((candidate) => candidate.displayName), ["桂儿"]);
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

test("manual chat open matches snapshot when single-line list preview follows job title", async () => {
  const events = [];
  const card = createListElement(
    "12:45 李女士 【8000+】居家黑板主播（时薪40+可兼职） 李女士的微信号：19072460958"
  );
  const panel = createListElement([
    "李女士",
    "今日活跃",
    "在线简历",
    "附件简历",
    "沟通职位： 兼职·【8000+】居家黑板主播（时薪40+可兼职）",
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
  assert.equal(snapshot.payload.candidate.candidateId, panelPayload.candidate.candidateId);
  assert.equal(snapshot.payload.chat.coverageLastMessageAt, "2026-05-15T12:45:00.000+08:00");
  assert.equal(snapshot.payload.chat.listObservedJobTitle, "【8000+】居家黑板主播（时薪40+可兼职）");
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

test("chat snapshot parser marks candidate and recruiter directions from message bubble classes", () => {
  const panel = createChatPanelWithMessageNodes({
    lines: [
      "桂儿",
      "刚刚活跃",
      "在线简历",
      "附件简历",
      "沟通职位： 兼职·【8000+】居家黑板主播（时薪40+可兼职）",
      "09:10",
      "候选人发来的消息",
      "09:12",
      "招聘者发出的消息",
      "发送"
    ],
    messages: [
      {
        text: "候选人发来的消息",
        className: "chat-message item-friend"
      },
      {
        text: "招聘者发出的消息",
        className: "chat-message item-myself"
      }
    ]
  });

  const payload = buildChatSnapshotPayload(panel, {
    source: "test",
    chatPageUrl: "https://www.zhipin.com/web/chat/index",
    now: FIXED_NOW
  });

  assert.deepEqual(payload.chat.messages.map((message) => message.direction), [
    "candidate",
    "recruiter"
  ]);
});

test("chat snapshot parser marks directions from left and right bubble positions", () => {
  const panel = createChatPanelWithMessageNodes({
    lines: [
      "桂儿",
      "刚刚活跃",
      "在线简历",
      "附件简历",
      "沟通职位： 兼职·【8000+】居家黑板主播（时薪40+可兼职）",
      "09:10",
      "左侧候选人消息",
      "09:12",
      "右侧招聘者消息",
      "发送"
    ],
    messages: [
      {
        text: "左侧候选人消息",
        rect: {
          left: 24,
          top: 120,
          width: 180,
          height: 40
        }
      },
      {
        text: "右侧招聘者消息",
        rect: {
          left: 520,
          top: 180,
          width: 180,
          height: 40
        }
      }
    ]
  });

  const payload = buildChatSnapshotPayload(panel, {
    source: "test",
    chatPageUrl: "https://www.zhipin.com/web/chat/index",
    now: FIXED_NOW
  });

  assert.deepEqual(payload.chat.messages.map((message) => message.direction), [
    "candidate",
    "recruiter"
  ]);
});

test("chat snapshot parser keeps unknown direction when DOM has no structural signal", () => {
  const panel = createChatPanelWithMessageNodes({
    lines: [
      "桂儿",
      "刚刚活跃",
      "在线简历",
      "附件简历",
      "沟通职位： 兼职·【8000+】居家黑板主播（时薪40+可兼职）",
      "09:10",
      "无法判断方向的消息",
      "发送"
    ],
    messages: [
      {
        text: "无法判断方向的消息",
        rect: {
          left: 320,
          top: 120,
          width: 120,
          height: 40
        }
      }
    ]
  });

  const payload = buildChatSnapshotPayload(panel, {
    source: "test",
    chatPageUrl: "https://www.zhipin.com/web/chat/index",
    now: FIXED_NOW
  });

  assert.equal(payload.chat.messages[0].direction, "unknown");
});

test("chat snapshot direction hints preserve message order, timestamps, and fingerprints", () => {
  const panel = createChatPanelWithMessageNodes({
    lines: [
      "桂儿",
      "刚刚活跃",
      "在线简历",
      "附件简历",
      "沟通职位： 兼职·【8000+】居家黑板主播（时薪40+可兼职）",
      "09:10",
      "第一条消息",
      "09:12",
      "第二条消息",
      "09:14",
      "第三条消息",
      "发送"
    ],
    messages: [
      {
        text: "第一条消息",
        className: "message-left"
      },
      {
        text: "第二条消息",
        className: "message-right"
      },
      {
        text: "第三条消息",
        className: "message-left"
      }
    ]
  });

  const firstPayload = buildChatSnapshotPayload(panel, {
    source: "test",
    chatPageUrl: "https://www.zhipin.com/web/chat/index",
    now: FIXED_NOW
  });
  const secondPayload = buildChatSnapshotPayload(panel, {
    source: "test",
    chatPageUrl: "https://www.zhipin.com/web/chat/index",
    now: FIXED_NOW
  });

  assert.deepEqual(firstPayload.chat.messages.map((message) => message.messageIndex), [0, 1, 2]);
  assert.deepEqual(firstPayload.chat.messages.map((message) => message.messageAt), [
    "2026-05-15T09:10:00.000+08:00",
    "2026-05-15T09:12:00.000+08:00",
    "2026-05-15T09:14:00.000+08:00"
  ]);
  assert.deepEqual(firstPayload.chat.messages.map((message) => message.text), [
    "第一条消息",
    "第二条消息",
    "第三条消息"
  ]);
  assert.equal(firstPayload.chat.lastMessageFingerprint, firstPayload.chat.messages[2].fingerprint);
  assert.deepEqual(
    firstPayload.chat.messages.map((message) => message.fingerprint),
    secondPayload.chat.messages.map((message) => message.fingerprint)
  );
});

test("chat snapshot parser drops configured BOSS system card messages", () => {
  const messages = collectChatMessagesFromText([
    "05-18 19:48",
    "老板您好，我申请报名【8000+】居家黑板主播（时薪40+可兼职）这个岗位，如果您觉得合适，可以直接联系我～",
    "快速沟通小技巧！",
    "我看到快速沟通小技巧！这个提示了",
    "觉得合适，直接联系牛人吧~",
    "暂不考虑",
    "暂不考虑这个按钮是什么意思",
    "获取联系方式",
    "你好，可以聊一聊啊，我们招搞笑类型的主播",
    "今天 15:36",
    "可以的，有无责底薪吗"
  ].join("\n"), { now: FIXED_NOW });

  assert.deepEqual(messages.map((message) => message.text), [
    "老板您好，我申请报名【8000+】居家黑板主播（时薪40+可兼职）这个岗位，如果您觉得合适，可以直接联系我～",
    "我看到快速沟通小技巧！这个提示了",
    "暂不考虑这个按钮是什么意思",
    "你好，可以聊一聊啊，我们招搞笑类型的主播",
    "可以的，有无责底薪吗"
  ]);
});

test("chat message cleanup rules load from extension json when available", async () => {
  const rules = await loadChatMessageCleanupRules({
    runtime: {
      getURL(path) {
        assert.equal(path, "src/shared/chat-message-cleanup-rules.json");
        return `chrome-extension://test/${path}`;
      }
    },
    fetchFn: async () => ({
      ok: true,
      async json() {
        return {
          schemaVersion: "1.0.0",
          ignoreExactTexts: ["系统卡片"],
          ignoreRegexes: ["^media://"]
        };
      }
    })
  });

  assert.equal(shouldIgnoreChatMessageText("系统卡片", rules), true);
  assert.equal(shouldIgnoreChatMessageText("我看到系统卡片了", rules), false);
  assert.equal(shouldIgnoreChatMessageText("media://image-placeholder", rules), true);
  assert.equal(shouldIgnoreChatMessageText("正常聊天内容", rules), false);
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
    LEGACY_CHAT_REPORT_PROMPT_TEXT,
    `哦 ${LEGACY_CHAT_REPORT_PROMPT_TEXT}`,
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

function createChatPanelWithMessageNodes({
  lines = [],
  messages = [],
  rect = {
    left: 0,
    top: 0,
    width: 720,
    height: 520
  }
} = {}) {
  const panel = createListElement(lines.join("\n"), { rect });
  messages.forEach((message) => {
    appendListChild(panel, createListElement(message.text, {
      className: message.className || "",
      dataset: message.dataset || {},
      attributes: message.attributes || {},
      rect: message.rect || {
        left: 24,
        top: 120,
        width: 180,
        height: 40
      }
    }));
  });
  return panel;
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

function createListElement(text = "", {
  attributes = {},
  className = "",
  dataset = {},
  rect = {
    left: 10,
    top: 20,
    width: 220,
    height: 60
  },
  tagName = "div"
} = {}) {
  return {
    attributes: { ...attributes },
    className,
    innerText: text,
    textContent: text,
    dataset: { ...dataset },
    parentElement: null,
    ownerDocument: null,
    children: [],
    style: {},
    tagName: tagName.toUpperCase(),
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
      if (name === "class") {
        return this.className || this.attributes[name] || null;
      }
      return this.attributes[name] ?? null;
    },
    getBoundingClientRect() {
      return {
        ...rect,
        right: rect.left + rect.width,
        bottom: rect.top + rect.height
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
      if (name === "class") {
        this.className = "";
      }
    },
    setAttribute(name, value) {
      this.attributes[name] = String(value);
      if (name === "class") {
        this.className = String(value);
      }
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
  const selectors = selector.split(",").map((current) => current.trim()).filter(Boolean);
  if (selectors.includes("*")) {
    return true;
  }
  return selectors.some((current) => {
    if (current === "a[href]") {
      return element.tagName === "A" && Boolean(element.href);
    }
    return current.toUpperCase() === element.tagName;
  });
}
