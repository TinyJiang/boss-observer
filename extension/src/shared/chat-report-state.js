import { nowLocalIsoString } from "./time.js";

export const CHAT_REPORT_STATE_KEY = "bossObserver.chatReportState";

export function createEmptyChatReportState() {
  return {
    updatedAt: null,
    candidates: {}
  };
}

export async function readChatReportState({
  storage = chrome.storage.local
} = {}) {
  const stored = await storage.get(CHAT_REPORT_STATE_KEY);
  return normalizeChatReportState(stored[CHAT_REPORT_STATE_KEY]);
}

export async function updateChatReportStateFromEvents(events = [], {
  storage = chrome.storage.local,
  now = nowLocalIsoString
} = {}) {
  const current = await readChatReportState({ storage });
  const next = applyChatReportEvents(current, events, { now });
  await storage.set({ [CHAT_REPORT_STATE_KEY]: next });
  return next;
}

export function applyChatReportEvents(state = createEmptyChatReportState(), events = [], {
  now = nowLocalIsoString
} = {}) {
  const current = normalizeChatReportState(state);
  const candidates = { ...current.candidates };
  let changed = false;

  for (const event of events || []) {
    if (event?.type === "candidate_chat.snapshot_captured") {
      const nextRecord = buildSnapshotReportRecord(event, { now });
      if (nextRecord && shouldUpdateSnapshotRecord(candidates[nextRecord.candidateId], nextRecord)) {
        candidates[nextRecord.candidateId] = mergeCandidateReportRecord(
          candidates[nextRecord.candidateId],
          nextRecord
        );
        changed = true;
      }
    }

    if (event?.type === "candidate_chat.wechat_captured") {
      const nextRecord = buildWechatReportRecord(event, { now });
      if (nextRecord) {
        candidates[nextRecord.candidateId] = mergeCandidateReportRecord(
          candidates[nextRecord.candidateId],
          nextRecord
        );
        changed = true;
      }
    }
  }

  return {
    updatedAt: changed ? now() : current.updatedAt,
    candidates
  };
}

export function normalizeChatReportState(state = {}) {
  const empty = createEmptyChatReportState();
  const candidates = {};
  Object.entries(state?.candidates || {}).forEach(([candidateId, record]) => {
    if (!candidateId || !record || typeof record !== "object") {
      return;
    }
    candidates[candidateId] = compactRecord({
      candidateId,
      stableId: record.stableId,
      stableIdSource: record.stableIdSource,
      lastReportedMessageAt: record.lastReportedMessageAt,
      lastReportedMessageFingerprint: record.lastReportedMessageFingerprint,
      lastReportedAt: record.lastReportedAt,
      lastSnapshotEventId: record.lastSnapshotEventId,
      messageCount: Number.isFinite(Number(record.messageCount)) ? Number(record.messageCount) : undefined,
      wechatAccounts: normalizeWechatAccounts(record.wechatAccounts)
    });
  });

  return {
    ...empty,
    updatedAt: typeof state?.updatedAt === "string" ? state.updatedAt : null,
    candidates
  };
}

function buildSnapshotReportRecord(event, { now }) {
  const candidate = event.payload?.candidate || {};
  const chat = event.payload?.chat || {};
  if (!candidate.candidateId || !chat.lastMessageAt) {
    return null;
  }

  return compactRecord({
    candidateId: candidate.candidateId,
    stableId: candidate.stableId,
    stableIdSource: candidate.stableIdSource,
    lastReportedMessageAt: chat.lastMessageAt,
    lastReportedMessageFingerprint: chat.lastMessageFingerprint,
    lastReportedAt: now(),
    lastSnapshotEventId: event.id,
    messageCount: chat.messageCount,
    wechatAccounts: extractWechatAccountsFromPayload(event.payload)
  });
}

function buildWechatReportRecord(event, { now }) {
  const candidate = event.payload?.candidate || {};
  if (!candidate.candidateId) {
    return null;
  }

  return compactRecord({
    candidateId: candidate.candidateId,
    stableId: candidate.stableId,
    stableIdSource: candidate.stableIdSource,
    lastReportedAt: now(),
    wechatAccounts: extractWechatAccountsFromPayload(event.payload)
  });
}

function shouldUpdateSnapshotRecord(previous = null, nextRecord = {}) {
  if (!previous?.lastReportedMessageAt) {
    return true;
  }

  const previousTime = Date.parse(previous.lastReportedMessageAt);
  const nextTime = Date.parse(nextRecord.lastReportedMessageAt);
  if (!Number.isFinite(previousTime) || !Number.isFinite(nextTime)) {
    return true;
  }
  if (nextTime > previousTime) {
    return true;
  }
  if (nextTime < previousTime) {
    return false;
  }
  return Boolean(
    nextRecord.lastReportedMessageFingerprint &&
    nextRecord.lastReportedMessageFingerprint !== previous.lastReportedMessageFingerprint
  );
}

function mergeCandidateReportRecord(previous = {}, nextRecord = {}) {
  const mergedWechatAccounts = normalizeWechatAccounts([
    ...(previous.wechatAccounts || []),
    ...(nextRecord.wechatAccounts || [])
  ]);

  return compactRecord({
    ...previous,
    ...nextRecord,
    wechatAccounts: mergedWechatAccounts
  });
}

function extractWechatAccountsFromPayload(payload = {}) {
  return normalizeWechatAccounts(payload.wechat?.accounts || payload.chat?.wechat?.accounts || []);
}

function normalizeWechatAccounts(accounts = []) {
  return Array.from(new Set(
    (Array.isArray(accounts) ? accounts : [])
      .map((account) => String(account || "").trim())
      .filter(Boolean)
  ));
}

function compactRecord(record = {}) {
  return Object.fromEntries(
    Object.entries(record).filter(([, value]) => {
      if (Array.isArray(value)) {
        return value.length > 0;
      }
      return value !== undefined && value !== null && value !== "";
    })
  );
}
