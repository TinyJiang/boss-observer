import {
  compactPayloadObject,
  normalizeLines,
  normalizeText,
  resolveCandidateId
} from "./candidate-card.js";
import { buildCandidateId } from "./candidate-card-registry.js";
import { EVENT_TYPES } from "../shared/event-types.js";
import {
  normalizeChatIdentityJobTitle,
  sanitizeChatListJobTitle,
  splitChatJobTitleAndPreview
} from "../shared/chat-job-title.js";
import { readChatReportState } from "../shared/chat-report-state.js";
import {
  getChatSnapshotCoverageLastMessageAt,
  isIsoTimeAfter
} from "../shared/chat-snapshot-coverage.js";
import {
  DEFAULT_CHAT_MESSAGE_CLEANUP_RULES,
  shouldIgnoreChatMessageText
} from "../shared/chat-message-cleanup.js";
import { toLocalIsoString } from "../shared/time.js";

const LEGACY_CHAT_REPORT_PROMPT_ATTRIBUTE = "data-boss-observer-chat-report-required";
const LEGACY_CHAT_REPORT_PROMPT_TEXT = "今日聊天未上报，请点开补采";

const SCAN_INTERVAL_MS = 2500;
const CHAT_PAGE_TYPES = new Set(["chat"]);
const MAX_LIST_ITEM_TEXT_LENGTH = 700;
const MAX_ACTIVE_PANEL_TEXT_LENGTH = 20000;
const CHAT_NAME_JOB_ID_SOURCE = "chat_name_job_fingerprint";
const CHAT_REPORT_PROMPT_ID_ATTRIBUTE = "data-boss-observer-chat-report-prompt-id";
const CHAT_REPORT_PROMPT_NODE_SELECTOR = "[data-boss-observer-chat-report-prompt='true']";
const CHAT_REPORT_PROMPT_OVERLAY_SELECTOR = "[data-boss-observer-chat-report-overlay='true']";
const MANUAL_OPEN_ATTEMPT_TTL_MS = 8000;
const ACTIVE_STATUS_PATTERN = /(刚刚活跃|今日活跃|在线|本周活跃|本月活跃|昨天活跃)/;
const MESSAGE_STATUS_PATTERN = /^(已读|送达|未读)\s+/;
const WECHAT_CONTEXT_PATTERN = /(?:微信号?|wx|wechat|vx|v信|加我微信|加微信)/i;
const WECHAT_ACCOUNT_PATTERN_SOURCE = "(?:微信号?|wx|wechat|vx|v信|加我微信|加微信)\\s*(?:是|为|:|：)?\\s*([A-Za-z][A-Za-z0-9_-]{4,30}|1[3-9]\\d{9})";
const CHAT_PENDING_CANDIDATES_MESSAGE_KIND = "bossObserver.chatPendingCandidatesObserved";
const CHAT_MESSAGE_DIRECTION_ELEMENT_SELECTOR = "div, li, p, span, section, article";
const STRUCTURAL_DIRECTION_MAX_ANCESTOR_DEPTH = 6;
const DIRECTION_UNKNOWN = "unknown";
const DIRECTION_CANDIDATE = "candidate";
const DIRECTION_RECRUITER = "recruiter";
const RECRUITER_CLASS_PATTERN = /(?:^|[\s_-])(?:item-myself|myself|mine|self|me|right|outgoing|sent|recruiter|employer|owner|current-user|from-me)(?:$|[\s_-])/i;
const CANDIDATE_CLASS_PATTERN = /(?:^|[\s_-])(?:item-friend|friend|other|left|incoming|received|geek|candidate|visitor|applicant|from-other|from-user)(?:$|[\s_-])/i;
const RECRUITER_SIGNAL_PATTERN = /(?:^|[\s_:-])(?:myself|mine|self|right|outgoing|sent|boss|recruiter|employer|hr|owner|current-user|from-me|我|自己|本人|当前账号|招聘者|老板)(?:$|[\s_:-])/i;
const CANDIDATE_SIGNAL_PATTERN = /(?:^|[\s_:-])(?:friend|other|left|incoming|received|geek|candidate|visitor|applicant|from-other|from-user|牛人|候选人|对方|应聘者|求职者)(?:$|[\s_:-])/i;
const SELF_SIGNAL_KEY_PATTERN = /(?:^|[\s_:-])(?:is-self|self|mine|myself|from-me)(?:$|[\s_:-])/i;
const TRUTHY_ATTRIBUTE_PATTERN = /^(?:true|1|yes|y)$/i;
const FALSY_ATTRIBUTE_PATTERN = /^(?:false|0|no|n)$/i;
// Responsibilities:
// - capture already-rendered chat text when a recruiter opens a conversation
// - use recruiter list clicks to carry list freshness into the next snapshot
// - never click, send, scroll, or upload media URLs/binaries
export class ChatRecordProbe {
  constructor({
    collector,
    sessionContext,
    scanIntervalMs = SCAN_INTERVAL_MS,
    now = () => new Date(),
    readReportState = () => readChatReportState(),
    messageCleanupRules = DEFAULT_CHAT_MESSAGE_CLEANUP_RULES
  }) {
    this.collector = collector;
    this.sessionContext = sessionContext;
    this.scanIntervalMs = scanIntervalMs;
    this.now = now;
    this.readReportState = readReportState;
    this.messageCleanupRules = messageCleanupRules;
    this.started = false;
    this.pollHandle = null;
    this.activeConversationKey = "";
    this.lastObservedSnapshotKeyByConversation = new Map();
    this.pendingManualOpenKeys = new Map();
    this.lastPendingChatCandidatesKey = "";
    this.wechatReportKeys = new Set();
    this.handleDocumentClick = (event) => {
      if (this.recordChatListOpenAttempt(event?.target)) {
        globalThis.setTimeout?.(() => {
          void this.safeScan("chat_list_click");
        }, 150);
      }
    };
  }

  start() {
    if (this.started) {
      return;
    }

    this.started = true;
    globalThis.document?.addEventListener?.("click", this.handleDocumentClick, true);
    void this.safeScan("start");
    this.pollHandle = globalThis.setInterval(() => {
      void this.safeScan("poll");
    }, this.scanIntervalMs);
  }

  stop() {
    if (!this.started) {
      return;
    }

    this.started = false;
    globalThis.document?.removeEventListener?.("click", this.handleDocumentClick, true);
    if (this.pollHandle !== null) {
      globalThis.clearInterval(this.pollHandle);
      this.pollHandle = null;
    }
  }

  async scan(source = "poll") {
    if (!isChatPage(this.sessionContext.page) || !globalThis.document) {
      this.publishPendingChatCandidates([], source);
      return;
    }

    const reportState = await this.readReportState();
    removeLegacyChatReportPrompts(globalThis.document);
    this.scanPendingChatCandidates({ source, reportState });
    this.scanActiveChatSnapshot({ source, reportState });
  }

  scanPendingChatCandidates({ source, reportState }) {
    const pendingCandidates = buildPendingChatCandidatesFromListItems(
      findChatListItems(globalThis.document, { now: this.now }),
      reportState
    );
    this.publishPendingChatCandidates(pendingCandidates, source);
  }

  publishPendingChatCandidates(candidates, source) {
    const pendingKey = JSON.stringify(candidates.map((candidate) => [
      candidate.candidateId || "",
      candidate.displayName || "",
      candidate.jobTitle || "",
      candidate.lastMessageAt || "",
      candidate.lastReportedMessageAt || ""
    ]));
    if (pendingKey === this.lastPendingChatCandidatesKey) {
      return;
    }

    this.lastPendingChatCandidatesKey = pendingKey;
    const runtime = globalThis.chrome?.runtime;
    if (!runtime?.sendMessage) {
      return;
    }

    runtime.sendMessage({
      kind: CHAT_PENDING_CANDIDATES_MESSAGE_KIND,
      source,
      observedAt: toLocalIsoString(asDate(this.now)),
      candidates
    }, () => {
      void globalThis.chrome?.runtime?.lastError;
    });
  }

  scanActiveChatSnapshot({ source, reportState }) {
    const panel = findActiveChatPanel(globalThis.document);
    if (!panel) {
      return;
    }

    const rawPayload = buildChatSnapshotPayload(panel, {
      source,
      chatPageUrl: this.sessionContext.page.url,
      now: this.now,
      messageCleanupRules: this.messageCleanupRules
    });
    if (!rawPayload || !rawPayload.chat?.messageCount) {
      return;
    }

    const manualOpenAttempt = this.consumeManualOpenAttempt(rawPayload);
    const payload = applyManualOpenCoverageToSnapshot(rawPayload, manualOpenAttempt);
    const conversationKey = payload.chat.conversationKey;
    const snapshotKey = buildSnapshotDedupKey(payload);
    const conversationChanged = Boolean(conversationKey && conversationKey !== this.activeConversationKey);
    const manuallyOpened = Boolean(manualOpenAttempt);
    const contentChanged = this.lastObservedSnapshotKeyByConversation.get(conversationKey) !== snapshotKey;
    this.lastObservedSnapshotKeyByConversation.set(conversationKey, snapshotKey);

    if (conversationChanged || manuallyOpened) {
      this.activeConversationKey = conversationKey;
      this.collector.collect(EVENT_TYPES.CANDIDATE_CHAT_OPENED, compactPayloadObject({
        source,
        chatPageUrl: payload.chatPageUrl,
        candidate: payload.candidate,
        chat: {
          conversationKey,
          jobTitle: payload.chat.jobTitle
        }
      }));
    }

    if ((conversationChanged || manuallyOpened || contentChanged) && shouldSubmitChatSnapshot(payload, reportState)) {
      this.collector.collect(EVENT_TYPES.CANDIDATE_CHAT_SNAPSHOT_CAPTURED, payload);
    }

    const wechat = payload.chat.wechat;
    if (wechat?.accounts?.length) {
      const wechatKey = [
        conversationKey,
        wechat.accounts.join(","),
        wechat.detectedAtMessageFingerprint || ""
      ].join(":");
      if (!this.wechatReportKeys.has(wechatKey)) {
        this.wechatReportKeys.add(wechatKey);
        this.collector.collect(EVENT_TYPES.CANDIDATE_CHAT_WECHAT_CAPTURED, compactPayloadObject({
          source: "snapshot",
          chatPageUrl: payload.chatPageUrl,
          candidate: payload.candidate,
          wechat
        }));
      }
    }
  }

  recordChatListOpenAttempt(target) {
    if (!isChatPage(this.sessionContext.page) || !target) {
      return false;
    }

    const item = findChatListItemFromTarget(target, { now: this.now });
    const candidateId = item?.candidate?.candidateId;
    if (!candidateId) {
      return false;
    }

    this.pendingManualOpenKeys.set(candidateId, {
      expiresAt: Date.now() + MANUAL_OPEN_ATTEMPT_TTL_MS,
      candidateId,
      displayName: item.displayName || "",
      jobTitle: item.jobTitle || "",
      listLastMessageAt: item.lastMessageAt || "",
      listLastMessageTimeText: item.lastMessageTimeText || ""
    });
    return true;
  }

  consumeManualOpenAttempt(payload) {
    const conversationKey = payload?.chat?.conversationKey || "";
    if (!conversationKey) {
      return null;
    }

    const now = Date.now();
    for (const [candidateId, attempt] of this.pendingManualOpenKeys.entries()) {
      if ((attempt?.expiresAt || 0) <= now) {
        this.pendingManualOpenKeys.delete(candidateId);
      }
    }

    const exactAttempt = this.pendingManualOpenKeys.get(conversationKey);
    if (exactAttempt) {
      this.pendingManualOpenKeys.delete(conversationKey);
      return exactAttempt;
    }

    for (const [candidateId, attempt] of this.pendingManualOpenKeys.entries()) {
      if (!doesManualOpenAttemptMatchSnapshot(attempt, payload)) {
        continue;
      }
      this.pendingManualOpenKeys.delete(candidateId);
      return attempt;
    }

    return null;
  }

  async safeScan(source) {
    try {
      await this.scan(source);
    } catch (error) {
      this.collector.collect(EVENT_TYPES.CANDIDATE_CHAT_CAPTURE_FAILED, {
        source,
        chatPageUrl: this.sessionContext.page?.url || "",
        reason: "scan_failed",
        message: error instanceof Error ? error.message : String(error)
      });
    }
  }
}

export function isChatPage(page) {
  return Boolean(page?.isBossPage && CHAT_PAGE_TYPES.has(page.pageType));
}

export function findChatListItems(rootDocument, { now = () => new Date() } = {}) {
  if (!rootDocument?.querySelectorAll) {
    return [];
  }

  const parsedItems = Array.from(rootDocument.querySelectorAll("div, li, section, article"))
    .map((element) => parseChatListItemElement(element, { now }))
    .filter(Boolean);

  return dedupeChatListItems(parsedItems);
}

export function findChatListItemFromTarget(target, { now = () => new Date(), maxDepth = 8 } = {}) {
  let current = target?.nodeType === 3 ? target.parentElement : target;
  for (let depth = 0; current && depth < maxDepth; depth += 1) {
    const parsed = parseChatListItemElement(current, { now });
    if (parsed) {
      return parsed;
    }
    current = current.parentElement;
  }
  return null;
}

export function parseChatListItemElement(element, { now = () => new Date() } = {}) {
  const rawText = readElementTextExcludingPluginNodes(element);
  const text = normalizeText(rawText);
  if (!text ||
    text.length > MAX_LIST_ITEM_TEXT_LENGTH ||
    text.includes("沟通职位：") ||
    text.includes("沟通的职位-") ||
    text.includes("发送")) {
    return null;
  }

  const parsed = parseChatListItemText(rawText, { now });
  if (!parsed) {
    return null;
  }

  return {
    ...parsed,
    element,
    candidate: buildChatCandidatePayload({
      element,
      text,
      displayName: parsed.displayName,
      jobTitle: parsed.jobTitle,
      sourceUrl: element?.ownerDocument?.location?.href || globalThis.location?.href || ""
    })
  };
}

export function parseChatListItemText(text = "", { now = () => new Date() } = {}) {
  const cleanText = stripPluginPromptText(text);
  const parsedFromLines = parseChatListItemLines(normalizeLines(cleanText), { now });
  if (parsedFromLines) {
    return parsedFromLines;
  }

  const normalized = stripLeadingUnreadCount(normalizeText(cleanText));
  const timeInfo = parseClearlyTodayChatListTime(normalized, { now });
  if (!timeInfo) {
    return null;
  }

  const rest = normalized.slice(timeInfo.matchLength).trim();
  if (!rest.includes("【")) {
    return null;
  }
  const { displayName, jobTitle, lastMessagePreview } = parseChatListIdentityText(rest);
  if (!isValidChatListDisplayName(displayName)) {
    return null;
  }

  return compactPayloadObject({
    lastMessageAt: timeInfo.iso,
    lastMessageTimeText: timeInfo.raw,
    displayName,
    jobTitle,
    lastMessagePreview
  });
}

function parseChatListItemLines(lines = [], { now = () => new Date() } = {}) {
  const normalizedLines = lines
    .map((line) => normalizeText(line))
    .filter(Boolean)
    .filter((line) => line !== LEGACY_CHAT_REPORT_PROMPT_TEXT);
  if (normalizedLines.length <= 1) {
    return null;
  }

  const headerIndex = normalizedLines.findIndex((line) =>
    parseClearlyTodayChatListTime(line, { now }) && line.includes("【")
  );
  if (headerIndex < 0) {
    return null;
  }

  const header = stripLeadingUnreadCount(normalizedLines[headerIndex]);
  const timeInfo = parseClearlyTodayChatListTime(header, { now });
  if (!timeInfo) {
    return null;
  }

  const rest = header.slice(timeInfo.matchLength).trim();
  const { displayName, jobTitle, lastMessagePreview } = parseChatListIdentityText(rest);
  if (!isValidChatListDisplayName(displayName)) {
    return null;
  }

  return compactPayloadObject({
    lastMessageAt: timeInfo.iso,
    lastMessageTimeText: timeInfo.raw,
    displayName,
    jobTitle,
    lastMessagePreview: lastMessagePreview || extractListPreviewFromLines(normalizedLines.slice(headerIndex + 1))
  });
}

export function parseClearlyTodayChatListTime(text = "", { now = () => new Date() } = {}) {
  const normalized = stripLeadingUnreadCount(normalizeText(text));
  const currentDate = asDate(now);
  const patterns = [
    /^(今天\s*)?(\d{1,2}):(\d{2})/,
    /^(刚刚)/,
    /^(\d+)\s*分钟前/
  ];

  const timeMatch = normalized.match(patterns[0]);
  if (timeMatch) {
    return {
      raw: timeMatch[0],
      matchLength: timeMatch[0].length,
      iso: buildLocalIsoForDateTime({
        year: currentDate.getFullYear(),
        month: currentDate.getMonth() + 1,
        day: currentDate.getDate(),
        hour: Number(timeMatch[2]),
        minute: Number(timeMatch[3])
      })
    };
  }

  const justNowMatch = normalized.match(patterns[1]);
  if (justNowMatch) {
    return {
      raw: justNowMatch[0],
      matchLength: justNowMatch[0].length,
      iso: toLocalIsoString(currentDate)
    };
  }

  const minutesMatch = normalized.match(patterns[2]);
  if (minutesMatch) {
    const minutes = Number(minutesMatch[1]);
    return {
      raw: minutesMatch[0],
      matchLength: minutesMatch[0].length,
      iso: toLocalIsoString(new Date(currentDate.getTime() - minutes * 60 * 1000))
    };
  }

  return null;
}

export function shouldSubmitChatSnapshot(payload, reportState = {}) {
  const candidateId = payload?.candidate?.candidateId;
  const lastMessageAt = getChatSnapshotCoverageLastMessageAt(payload?.chat);
  if (!candidateId || !lastMessageAt) {
    return false;
  }

  const record = reportState?.candidates?.[candidateId] || null;
  if (!record?.lastReportedMessageAt) {
    return true;
  }

  return isIsoTimeAfter(lastMessageAt, record.lastReportedMessageAt);
}

export function buildPendingChatCandidatesFromListItems(items = [], reportState = {}) {
  return items
    .filter((item) => shouldIncludePendingChatCandidate(item, reportState))
    .map((item) => buildPendingChatCandidatePayload(item, reportState));
}

export function findActiveChatPanel(rootDocument) {
  if (!rootDocument?.querySelectorAll) {
    return null;
  }

  const candidates = Array.from(rootDocument.querySelectorAll("div, section, article, main"))
    .map((element) => ({
      element,
      text: normalizeText(readElementTextExcludingPluginNodes(element))
    }))
    .filter((candidate) =>
      candidate.text.length > 0 &&
      candidate.text.length <= MAX_ACTIVE_PANEL_TEXT_LENGTH &&
      candidate.text.includes("沟通职位：") &&
      candidate.text.includes("发送") &&
      (candidate.text.includes("在线简历") || candidate.text.includes("附件简历"))
    )
    .sort((left, right) => left.text.length - right.text.length);

  return candidates[0]?.element || null;
}

export function buildChatSnapshotPayload(panel, {
  source = "poll",
  chatPageUrl = "",
  now = () => new Date(),
  messageCleanupRules = DEFAULT_CHAT_MESSAGE_CLEANUP_RULES
} = {}) {
  const text = readElementTextExcludingPluginNodes(panel);
  const lines = normalizeLines(text);
  const displayName = extractActiveChatDisplayName(lines);
  const jobTitle = extractChatJobTitle(lines);
  const candidate = buildChatCandidatePayload({
    element: panel,
    text,
    displayName,
    jobTitle,
    sourceUrl: chatPageUrl
  });
  const messages = collectChatMessagesFromPanel(panel, {
    text,
    now,
    messageCleanupRules
  });
  if (!candidate.candidateId || messages.length === 0) {
    return null;
  }

  const firstMessage = messages[0];
  const lastMessage = messages[messages.length - 1];
  const wechat = buildWechatPayload(messages);

  return compactPayloadObject({
    source,
    chatPageUrl,
    candidate,
    chat: {
      conversationKey: candidate.candidateId,
      jobTitle,
      messageCount: messages.length,
      firstMessageAt: firstMessage.messageAt,
      lastMessageAt: lastMessage.messageAt,
      lastMessageFingerprint: lastMessage.fingerprint,
      snapshotCompleteness: "visible_dom",
      mayBeIncomplete: true,
      mediaSummary: countMediaNodes(panel),
      messages,
      wechat
    }
  });
}

export function collectChatMessagesFromText(text = "", {
  now = () => new Date(),
  messageCleanupRules = DEFAULT_CHAT_MESSAGE_CLEANUP_RULES
} = {}) {
  const lines = normalizeLines(stripPluginPromptText(text));
  const messages = [];
  let currentMessageAt = "";

  for (const line of lines) {
    const timeInfo = parseChatMessageTimeLine(line, { now });
    if (timeInfo) {
      currentMessageAt = timeInfo.iso;
      continue;
    }

    if (!currentMessageAt || shouldIgnoreChatMessageLine(line, { messageCleanupRules })) {
      continue;
    }

    const parsed = parseMessageLine(line);
    if (!parsed.text) {
      continue;
    }

    const messageIndex = messages.length;
    messages.push(compactPayloadObject({
      messageIndex,
      messageAt: currentMessageAt,
      direction: parsed.direction,
      status: parsed.status,
      text: parsed.text,
      fingerprint: buildMessageFingerprint({
        messageAt: currentMessageAt,
        direction: parsed.direction,
        text: parsed.text
      })
    }));
  }

  return messages;
}

function collectChatMessagesFromPanel(panel, {
  text = "",
  now = () => new Date(),
  messageCleanupRules = DEFAULT_CHAT_MESSAGE_CLEANUP_RULES
} = {}) {
  const messages = collectChatMessagesFromText(text, { now, messageCleanupRules });
  if (messages.length === 0) {
    return messages;
  }

  return applyDomDirectionHintsToMessages(messages, panel, { messageCleanupRules });
}

function applyDomDirectionHintsToMessages(messages = [], panel, {
  messageCleanupRules = DEFAULT_CHAT_MESSAGE_CLEANUP_RULES
} = {}) {
  const hints = collectDomMessageDirectionHints(panel, messages, { messageCleanupRules });
  if (hints.length === 0) {
    return messages;
  }

  let nextHintIndex = 0;
  return messages.map((message) => {
    const matchedIndex = findNextDirectionHintIndex(hints, message, nextHintIndex);
    if (matchedIndex < 0) {
      return message;
    }

    nextHintIndex = matchedIndex + 1;
    const hint = hints[matchedIndex];
    const direction = hint.direction !== DIRECTION_UNKNOWN ? hint.direction : message.direction;
    const status = message.status || hint.status || "";
    if (direction === message.direction && status === (message.status || "")) {
      return message;
    }

    return compactPayloadObject({
      ...message,
      direction,
      status,
      fingerprint: buildMessageFingerprint({
        messageAt: message.messageAt,
        direction,
        text: message.text
      })
    });
  });
}

function collectDomMessageDirectionHints(panel, messages = [], {
  messageCleanupRules = DEFAULT_CHAT_MESSAGE_CLEANUP_RULES
} = {}) {
  if (!panel?.querySelectorAll) {
    return [];
  }

  const targetTextKeys = new Set(messages.map((message) => buildMessageTextMatchKey(message.text)));
  const elements = Array.from(panel.querySelectorAll(CHAT_MESSAGE_DIRECTION_ELEMENT_SELECTOR));
  const hints = elements
    .map((element) => buildDomMessageDirectionHint(element, panel, targetTextKeys, { messageCleanupRules }))
    .filter(Boolean);

  return dedupeDomMessageDirectionHints(hints);
}

function buildDomMessageDirectionHint(element, panel, targetTextKeys, {
  messageCleanupRules = DEFAULT_CHAT_MESSAGE_CLEANUP_RULES
} = {}) {
  const parsed = parseSingleMessageElementText(element, { messageCleanupRules });
  if (!parsed?.text) {
    return null;
  }

  const textKey = buildMessageTextMatchKey(parsed.text);
  if (!targetTextKeys.has(textKey)) {
    return null;
  }

  const structuralDirection = inferMessageDirectionFromDom(element, panel);
  const direction = structuralDirection !== DIRECTION_UNKNOWN
    ? structuralDirection
    : parsed.status
      ? DIRECTION_RECRUITER
      : DIRECTION_UNKNOWN;
  if (direction === DIRECTION_UNKNOWN && !parsed.status) {
    return null;
  }

  return {
    element,
    text: parsed.text,
    textKey,
    direction,
    status: parsed.status
  };
}

function parseSingleMessageElementText(element, {
  messageCleanupRules = DEFAULT_CHAT_MESSAGE_CLEANUP_RULES
} = {}) {
  const lines = normalizeLines(readElementTextExcludingPluginNodes(element));
  const messageLines = [];
  let pendingStatus = "";

  for (const line of lines) {
    const normalized = normalizeText(line);
    if (!normalized || parseChatMessageTimeLine(normalized)) {
      continue;
    }

    const statusOnlyMatch = normalized.match(/^(已读|送达|未读)$/);
    if (statusOnlyMatch) {
      pendingStatus = statusOnlyMatch[1];
      continue;
    }

    if (shouldIgnoreChatMessageLine(normalized, { messageCleanupRules })) {
      continue;
    }

    const parsed = parseMessageLine(normalized);
    if (!parsed.text) {
      continue;
    }

    messageLines.push({
      direction: parsed.direction,
      status: parsed.status || pendingStatus,
      text: parsed.text
    });
    pendingStatus = "";
  }

  if (messageLines.length !== 1) {
    return null;
  }

  return messageLines[0];
}

function findNextDirectionHintIndex(hints = [], message = {}, startIndex = 0) {
  const textKey = buildMessageTextMatchKey(message.text);
  for (let index = startIndex; index < hints.length; index += 1) {
    if (hints[index].textKey === textKey) {
      return index;
    }
  }
  return -1;
}

function dedupeDomMessageDirectionHints(hints = []) {
  return hints.filter((hint, index) => !hints.some((other, otherIndex) =>
    otherIndex !== index &&
    hint.textKey === other.textKey &&
    hint.direction === other.direction &&
    containsElement(hint.element, other.element)
  ));
}

function buildMessageTextMatchKey(text = "") {
  return normalizeText(text);
}

function inferMessageDirectionFromDom(element, panel) {
  let current = element;
  for (let depth = 0; current && current !== panel && depth < STRUCTURAL_DIRECTION_MAX_ANCESTOR_DEPTH; depth += 1) {
    const direction = readStructuralDirectionSignal(current);
    if (direction !== DIRECTION_UNKNOWN) {
      return direction;
    }
    current = current.parentElement;
  }

  // TODO(real-boss-dom): verify whether BOSS keeps recruiter bubbles on the
  // right and candidate bubbles on the left across current chat layouts.
  return inferDirectionFromElementPosition(element, panel);
}

function readStructuralDirectionSignal(element) {
  const classDirection = normalizeClassDirectionSignal(readElementClassText(element));
  if (classDirection !== DIRECTION_UNKNOWN) {
    return classDirection;
  }

  const attributeDirection = readAttributeDirectionSignal(element);
  if (attributeDirection !== DIRECTION_UNKNOWN) {
    return attributeDirection;
  }

  return DIRECTION_UNKNOWN;
}

function normalizeClassDirectionSignal(value = "") {
  const normalized = normalizeDirectionSignalText(value);
  if (!normalized) {
    return DIRECTION_UNKNOWN;
  }
  if (RECRUITER_CLASS_PATTERN.test(normalized)) {
    return DIRECTION_RECRUITER;
  }
  if (CANDIDATE_CLASS_PATTERN.test(normalized)) {
    return DIRECTION_CANDIDATE;
  }
  return DIRECTION_UNKNOWN;
}

function readAttributeDirectionSignal(element) {
  const dataset = element?.dataset || {};
  for (const [key, value] of Object.entries(dataset)) {
    const direction = normalizeAttributeDirectionSignal(key, value);
    if (direction !== DIRECTION_UNKNOWN) {
      return direction;
    }
  }

  const attributeNames = [
    "data-direction",
    "data-message-direction",
    "data-side",
    "data-from",
    "data-sender",
    "data-sender-type",
    "data-role",
    "data-is-self",
    "data-self",
    "data-mine",
    "aria-label",
    "title"
  ];
  for (const name of attributeNames) {
    const value = element?.getAttribute?.(name);
    if (value === null || value === undefined) {
      continue;
    }
    const direction = normalizeAttributeDirectionSignal(name, value);
    if (direction !== DIRECTION_UNKNOWN) {
      return direction;
    }
  }

  return DIRECTION_UNKNOWN;
}

function normalizeAttributeDirectionSignal(key = "", value = "") {
  const normalizedKey = normalizeDirectionSignalText(key);
  const normalizedValue = normalizeDirectionSignalText(value);
  if (!normalizedKey && !normalizedValue) {
    return DIRECTION_UNKNOWN;
  }

  if (SELF_SIGNAL_KEY_PATTERN.test(normalizedKey)) {
    if (TRUTHY_ATTRIBUTE_PATTERN.test(normalizedValue)) {
      return DIRECTION_RECRUITER;
    }
    if (FALSY_ATTRIBUTE_PATTERN.test(normalizedValue)) {
      return DIRECTION_CANDIDATE;
    }
  }

  const combined = `${normalizedKey}:${normalizedValue}`;
  if (RECRUITER_SIGNAL_PATTERN.test(combined)) {
    return DIRECTION_RECRUITER;
  }
  if (CANDIDATE_SIGNAL_PATTERN.test(combined)) {
    return DIRECTION_CANDIDATE;
  }

  return DIRECTION_UNKNOWN;
}

function normalizeDirectionSignalText(value = "") {
  return String(value ?? "")
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/[./]+/g, "-")
    .trim()
    .toLowerCase();
}

function readElementClassText(element) {
  const className = element?.className;
  if (typeof className === "string") {
    return className;
  }
  if (typeof className?.baseVal === "string") {
    return className.baseVal;
  }
  return element?.getAttribute?.("class") || "";
}

function inferDirectionFromElementPosition(element, panel) {
  const rect = readValidClientRect(element);
  const panelRect = readValidClientRect(panel);
  if (!rect || !panelRect || panelRect.width <= 0) {
    return DIRECTION_UNKNOWN;
  }

  const panelCenterX = panelRect.left + panelRect.width / 2;
  const elementCenterX = rect.left + rect.width / 2;
  const deadZone = Math.max(24, panelRect.width * 0.08);
  if (elementCenterX >= panelCenterX + deadZone) {
    return DIRECTION_RECRUITER;
  }
  if (elementCenterX <= panelCenterX - deadZone) {
    return DIRECTION_CANDIDATE;
  }

  const leftInset = rect.left - panelRect.left;
  const rightInset = panelRect.right - rect.right;
  if (leftInset > panelRect.width * 0.45 && rightInset < panelRect.width * 0.2) {
    return DIRECTION_RECRUITER;
  }
  if (rightInset > panelRect.width * 0.45 && leftInset < panelRect.width * 0.2) {
    return DIRECTION_CANDIDATE;
  }

  return DIRECTION_UNKNOWN;
}

function readValidClientRect(element) {
  const rect = element?.getBoundingClientRect?.();
  if (!rect ||
    !Number.isFinite(rect.left) ||
    !Number.isFinite(rect.right) ||
    !Number.isFinite(rect.width) ||
    rect.width <= 0) {
    return null;
  }
  return rect;
}

export function parseChatMessageTimeLine(line = "", { now = () => new Date() } = {}) {
  const normalized = normalizeText(line);
  const currentDate = asDate(now);

  let match = normalized.match(/^(\d{4})-(\d{1,2})-(\d{1,2})\s+(\d{1,2}):(\d{2})$/);
  if (match) {
    return { iso: buildLocalIsoForDateTime(readDateTimeMatch(match, 1)) };
  }

  match = normalized.match(/^(\d{1,2})-(\d{1,2})\s+(\d{1,2}):(\d{2})$/);
  if (match) {
    return {
      iso: buildLocalIsoForDateTime({
        year: currentDate.getFullYear(),
        month: Number(match[1]),
        day: Number(match[2]),
        hour: Number(match[3]),
        minute: Number(match[4])
      })
    };
  }

  match = normalized.match(/^(\d{1,2})月(\d{1,2})日\s+(\d{1,2}):(\d{2})$/);
  if (match) {
    return {
      iso: buildLocalIsoForDateTime({
        year: currentDate.getFullYear(),
        month: Number(match[1]),
        day: Number(match[2]),
        hour: Number(match[3]),
        minute: Number(match[4])
      })
    };
  }

  match = normalized.match(/^昨天\s+(\d{1,2}):(\d{2})$/);
  if (match) {
    const yesterday = new Date(currentDate.getFullYear(), currentDate.getMonth(), currentDate.getDate() - 1);
    return {
      iso: buildLocalIsoForDateTime({
        year: yesterday.getFullYear(),
        month: yesterday.getMonth() + 1,
        day: yesterday.getDate(),
        hour: Number(match[1]),
        minute: Number(match[2])
      })
    };
  }

  match = normalized.match(/^今天\s+(\d{1,2}):(\d{2})$/);
  if (match) {
    return {
      iso: buildLocalIsoForDateTime({
        year: currentDate.getFullYear(),
        month: currentDate.getMonth() + 1,
        day: currentDate.getDate(),
        hour: Number(match[1]),
        minute: Number(match[2])
      })
    };
  }

  match = normalized.match(/^(\d{1,2}):(\d{2})$/);
  if (match) {
    return {
      iso: buildLocalIsoForDateTime({
        year: currentDate.getFullYear(),
        month: currentDate.getMonth() + 1,
        day: currentDate.getDate(),
        hour: Number(match[1]),
        minute: Number(match[2])
      })
    };
  }

  return null;
}

export function buildChatCandidatePayload({
  element = null,
  text = "",
  displayName = "",
  jobTitle = "",
  sourceUrl = ""
} = {}) {
  const dataset = readMergedDataset(element);
  const links = readLinks(element);
  const idInfo = resolveCandidateId({ dataset, links });
  const normalizedName = normalizeCandidateName(displayName || extractNameFromText(text));
  const normalizedJobTitle = normalizeChatIdentityJobTitle(jobTitle);
  const fallbackIdentityParts = [normalizedName, normalizedJobTitle].filter(Boolean);
  const fallbackIdentity = fallbackIdentityParts.length > 0
    ? fallbackIdentityParts.join("|")
    : normalizeText(text).slice(0, 80);
  const fallbackSource = normalizedName && normalizedJobTitle
    ? CHAT_NAME_JOB_ID_SOURCE
    : normalizedName
      ? "chat_name_fingerprint"
      : normalizedJobTitle
        ? "chat_job_fingerprint"
        : "chat_text_fingerprint";
  const stableIdSource = idInfo.source || fallbackSource;
  const stableId = idInfo.value || `chat_${hashString(fallbackIdentity)}`;
  const candidate = {
    candidateId: buildCandidateId({
      stableId,
      stableIdSource
    }),
    stableId,
    stableIdSource,
    identityConfidence: idInfo.value ? "high" : "low",
    profile: {
      displayName: displayName || normalizedName
    }
  };

  return compactPayloadObject(candidate);
}

export function extractWechatAccountsFromText(text = "") {
  if (!WECHAT_CONTEXT_PATTERN.test(text)) {
    return [];
  }

  const accounts = [];
  const normalized = normalizeText(text);
  for (const match of normalized.matchAll(new RegExp(WECHAT_ACCOUNT_PATTERN_SOURCE, "gi"))) {
    if (match[1]) {
      accounts.push(match[1]);
    }
  }
  return Array.from(new Set(accounts));
}

function parseChatListIdentityText(text = "") {
  const withoutStatus = text.replace(/\[(?:已读|送达|未读)\]/g, " ").trim();
  const bracketIndex = withoutStatus.indexOf("【");
  if (bracketIndex >= 0) {
    const displayName = withoutStatus.slice(0, bracketIndex).trim();
    const afterName = withoutStatus.slice(bracketIndex).trim();
    const { jobTitle, lastMessagePreview } = splitChatJobTitleAndPreview(afterName);
    return compactPayloadObject({
      displayName,
      jobTitle,
      lastMessagePreview
    });
  }

  const [displayName = "", ...rest] = withoutStatus.split(/\s+/);
  return compactPayloadObject({
    displayName,
    lastMessagePreview: rest.join(" ")
  });
}

function shouldIncludePendingChatCandidate(item = {}, reportState = {}) {
  const candidateId = item.candidate?.candidateId || "";
  const lastMessageAt = item.lastMessageAt || "";
  if (!candidateId || !lastMessageAt) {
    return false;
  }

  const record = reportState?.candidates?.[candidateId] || null;
  return !record?.lastReportedMessageAt || isIsoTimeAfter(lastMessageAt, record.lastReportedMessageAt);
}

function buildPendingChatCandidatePayload(item = {}, reportState = {}) {
  const candidateId = item.candidate?.candidateId || "";
  const record = reportState?.candidates?.[candidateId] || null;
  return compactPayloadObject({
    candidateId,
    displayName: item.displayName || item.candidate?.profile?.displayName || "",
    jobTitle: item.jobTitle || "",
    lastMessageAt: item.lastMessageAt || "",
    lastMessageTimeText: item.lastMessageTimeText || "",
    lastReportedMessageAt: record?.lastReportedMessageAt || "",
    identityConfidence: item.candidate?.identityConfidence || ""
  });
}

function extractListPreviewFromLines(lines = []) {
  for (const line of lines) {
    const normalized = normalizeText(line);
    if (!normalized ||
      normalized === LEGACY_CHAT_REPORT_PROMPT_TEXT ||
      normalized === "[已读]" ||
      normalized === "[送达]" ||
      normalized === "[未读]") {
      continue;
    }

    return normalized.replace(/^\[(?:已读|送达|未读)\]\s*/, "").trim();
  }
  return "";
}

function extractActiveChatDisplayName(lines = []) {
  for (const line of lines) {
    if (shouldIgnoreHeaderCandidateLine(line)) {
      continue;
    }
    const statusIndex = line.search(ACTIVE_STATUS_PATTERN);
    const candidate = statusIndex >= 0 ? line.slice(0, statusIndex).trim() : line.trim();
    if (candidate) {
      return normalizeCandidateName(candidate);
    }
  }
  return "";
}

function extractChatJobTitle(lines = []) {
  const line = lines.find((current) => current.includes("沟通职位："));
  return sanitizeChatListJobTitle(line || "");
}

function parseMessageLine(line = "") {
  const normalized = normalizeText(line);
  const statusMatch = normalized.match(MESSAGE_STATUS_PATTERN);
  if (statusMatch) {
    return {
      direction: "recruiter",
      status: statusMatch[1],
      text: normalized.slice(statusMatch[0].length).trim()
    };
  }

  return {
    direction: "unknown",
    status: "",
    text: normalized
  };
}

function shouldIgnoreChatMessageLine(line = "", {
  messageCleanupRules = DEFAULT_CHAT_MESSAGE_CLEANUP_RULES
} = {}) {
  const normalized = normalizeText(line);
  if (shouldIgnoreChatMessageText(normalized, messageCleanupRules)) {
    return true;
  }
  return normalized === LEGACY_CHAT_REPORT_PROMPT_TEXT;
}

function shouldIgnoreHeaderCandidateLine(line = "") {
  const normalized = normalizeText(line);
  return !normalized ||
    normalized.includes("沟通") ||
    normalized.includes("全部") ||
    normalized.includes("发送") ||
    normalized.includes("在线简历") ||
    normalized.includes("附件简历") ||
    /^\d{1,2}岁$/.test(normalized) ||
    /^\d+年/.test(normalized) ||
    normalized === "大专" ||
    normalized === "本科" ||
    normalized === "高中";
}

function buildWechatPayload(messages = []) {
  for (const message of messages) {
    const accounts = extractWechatAccountsFromText(message.text);
    if (accounts.length > 0) {
      return {
        accounts,
        source: "chat_text",
        detectedAtMessageAt: message.messageAt,
        detectedAtMessageFingerprint: message.fingerprint
      };
    }
  }
  return null;
}

function countMediaNodes(panel) {
  if (!panel?.querySelectorAll) {
    return {};
  }

  return compactPayloadObject({
    imageNodeCount: panel.querySelectorAll("img").length,
    audioNodeCount: panel.querySelectorAll("audio").length,
    videoNodeCount: panel.querySelectorAll("video").length
  });
}

function removeLegacyChatReportPrompts(rootDocument) {
  const overlays = rootDocument?.querySelectorAll?.(CHAT_REPORT_PROMPT_OVERLAY_SELECTOR) || [];
  Array.from(overlays).forEach((overlay) => {
    overlay.remove?.();
  });

  const prompts = rootDocument?.querySelectorAll?.(CHAT_REPORT_PROMPT_NODE_SELECTOR) || [];
  Array.from(prompts).forEach((prompt) => {
    prompt.remove?.();
  });

  const marked = rootDocument?.querySelectorAll?.(`[${LEGACY_CHAT_REPORT_PROMPT_ATTRIBUTE}], [${CHAT_REPORT_PROMPT_ID_ATTRIBUTE}]`) || [];
  Array.from(marked).forEach((element) => {
    element.removeAttribute?.(LEGACY_CHAT_REPORT_PROMPT_ATTRIBUTE);
    element.removeAttribute?.(CHAT_REPORT_PROMPT_ID_ATTRIBUTE);
  });
}

function readElementTextExcludingPluginNodes(element) {
  if (!element) {
    return "";
  }

  // Use the live element's innerText so browser-rendered chat line breaks are preserved.
  // Detached clones can collapse BOSS chat bubbles into one text line, which breaks
  // timestamp-based message parsing.
  const text = element.innerText || element.textContent || "";
  return stripPluginPromptText(text);
}

function stripPluginPromptText(text = "") {
  return String(text).split(LEGACY_CHAT_REPORT_PROMPT_TEXT).join(" ");
}

function buildSnapshotDedupKey(payload = {}) {
  return [
    payload.candidate?.candidateId || "",
    payload.chat?.messageCount || 0,
    payload.chat?.lastMessageAt || "",
    payload.chat?.coverageLastMessageAt || "",
    payload.chat?.listObservedLastMessageAt || "",
    payload.chat?.lastMessageFingerprint || ""
  ].join(":");
}

function applyManualOpenCoverageToSnapshot(payload = {}, manualOpenAttempt = null) {
  const listLastMessageAt = manualOpenAttempt?.listLastMessageAt || "";
  if (!isIsoTimeAfter(listLastMessageAt, payload.chat?.lastMessageAt)) {
    return payload;
  }

  return compactPayloadObject({
    ...payload,
    chat: {
      ...payload.chat,
      coverageLastMessageAt: listLastMessageAt,
      coverageSource: "manual_chat_list_open",
      listObservedLastMessageAt: listLastMessageAt,
      listObservedLastMessageTimeText: manualOpenAttempt.listLastMessageTimeText || "",
      listObservedJobTitle: manualOpenAttempt.jobTitle || "",
      hasUncapturedListMessage: true
    }
  });
}

function doesManualOpenAttemptMatchSnapshot(attempt = {}, payload = {}) {
  const attemptName = normalizeCandidateName(attempt.displayName);
  const snapshotName = normalizeCandidateName(payload.candidate?.profile?.displayName);
  if (!attemptName || attemptName !== snapshotName) {
    return false;
  }

  const attemptJobTitle = normalizeChatIdentityJobTitle(attempt.jobTitle);
  const snapshotJobTitle = normalizeChatIdentityJobTitle(payload.chat?.jobTitle);
  return Boolean(attemptJobTitle && snapshotJobTitle && attemptJobTitle === snapshotJobTitle);
}

function buildMessageFingerprint({ messageAt = "", direction = "", text = "" } = {}) {
  return `msg_${hashString(`${messageAt}\n${direction}\n${text}`)}`;
}

function readDateTimeMatch(match, startIndex) {
  return {
    year: Number(match[startIndex]),
    month: Number(match[startIndex + 1]),
    day: Number(match[startIndex + 2]),
    hour: Number(match[startIndex + 3]),
    minute: Number(match[startIndex + 4])
  };
}

function buildLocalIsoForDateTime({ year, month, day, hour, minute }) {
  return toLocalIsoString(new Date(year, month - 1, day, hour, minute, 0, 0));
}

function asDate(now) {
  const value = typeof now === "function" ? now() : now;
  return value instanceof Date ? value : new Date(value);
}

function stripLeadingUnreadCount(text = "") {
  return normalizeText(text).replace(/^\d+\s+/, "");
}

function normalizeCandidateName(value = "") {
  return normalizeText(value).replace(/\s+/g, "");
}

function isValidChatListDisplayName(value = "") {
  const normalized = normalizeCandidateName(value);
  if (!normalized || normalized.length > 24 || /[【】]/.test(normalized)) {
    return false;
  }
  if (normalized.includes("沟通") ||
    normalized.includes("职位") ||
    normalized.includes("发送") ||
    normalized.includes("在线简历") ||
    normalized.includes("附件简历")) {
    return false;
  }
  return !/^(\d{4}-\d{1,2}-\d{1,2}|\d{1,2}-\d{1,2}|\d{1,2}月\d{1,2}日|今天|昨天|刚刚|\d+分钟前)/.test(normalized);
}

function extractNameFromText(text = "") {
  const firstLine = normalizeLines(text)[0] || "";
  const statusIndex = firstLine.search(ACTIVE_STATUS_PATTERN);
  return statusIndex >= 0 ? firstLine.slice(0, statusIndex).trim() : firstLine.split(/\s+/)[0] || "";
}

function readMergedDataset(element) {
  const merged = {};
  let current = element;
  for (let steps = 0; current && steps < 6; steps += 1) {
    Object.assign(merged, current.dataset || {});
    current = current.parentElement;
  }
  return merged;
}

function readLinks(element) {
  if (!element?.querySelectorAll) {
    return [];
  }
  return Array.from(element.querySelectorAll("a[href]"))
    .map((link) => link.href)
    .filter(Boolean);
}

function dedupeChatListItems(items = []) {
  const withoutBroadParents = items.filter((item, index) => !items.some((other, otherIndex) =>
    otherIndex !== index &&
    containsElement(item.element, other.element) &&
    isDifferentChatListItem(item, other)
  ));

  const bestByReportKey = new Map();
  withoutBroadParents.forEach((item) => {
    const reportKey = buildChatListReportKey(item);
    const existing = bestByReportKey.get(reportKey);
    if (!existing || getElementTextLength(item.element) > getElementTextLength(existing.element)) {
      bestByReportKey.set(reportKey, item);
    }
  });

  return Array.from(bestByReportKey.values());
}

function buildChatListReportKey(item = {}) {
  return [
    item.displayName || item.candidate?.candidateId || "",
    item.lastMessageAt || ""
  ].join(":");
}

function isDifferentChatListItem(left = {}, right = {}) {
  const leftIdentity = left.displayName || left.candidate?.candidateId || "";
  const rightIdentity = right.displayName || right.candidate?.candidateId || "";
  return left.lastMessageAt !== right.lastMessageAt ||
    leftIdentity !== rightIdentity;
}

function getElementTextLength(element) {
  return normalizeText(readElementTextExcludingPluginNodes(element)).length;
}

function containsElement(parent, child) {
  if (!parent || !child || parent === child) {
    return false;
  }
  if (typeof parent.contains === "function") {
    return parent.contains(child);
  }
  let current = child.parentElement;
  while (current) {
    if (current === parent) {
      return true;
    }
    current = current.parentElement;
  }
  return false;
}

function hashString(input = "") {
  let hash = 5381;
  for (let index = 0; index < input.length; index += 1) {
    hash = (hash * 33) ^ input.charCodeAt(index);
  }
  return (hash >>> 0).toString(36);
}
