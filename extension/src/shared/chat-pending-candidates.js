export const CHAT_PENDING_CANDIDATES_MAX_ITEMS = 30;

export function createEmptyChatPendingCandidatesState() {
  return {
    updatedAt: "",
    source: "",
    items: []
  };
}

export function buildChatPendingCandidatesState({
  items = [],
  source = "",
  observedAt = ""
} = {}) {
  return normalizeChatPendingCandidatesState({
    updatedAt: observedAt,
    source,
    items
  });
}

export function normalizeChatPendingCandidatesState(state = {}) {
  return {
    updatedAt: String(state.updatedAt || state.observedAt || ""),
    source: String(state.source || ""),
    items: normalizeChatPendingCandidateItems(state.items)
  };
}

function normalizeChatPendingCandidateItems(items = []) {
  if (!Array.isArray(items)) {
    return [];
  }

  const byKey = new Map();
  items.forEach((item) => {
    const normalized = normalizeChatPendingCandidateItem(item);
    if (!normalized) {
      return;
    }
    const key = normalized.candidateId || `${normalized.displayName}:${normalized.jobTitle}`;
    byKey.set(key, normalized);
  });

  return Array.from(byKey.values()).slice(0, CHAT_PENDING_CANDIDATES_MAX_ITEMS);
}

function normalizeChatPendingCandidateItem(item = {}) {
  if (!item || typeof item !== "object") {
    return null;
  }

  const displayName = String(item.displayName || "").trim();
  const candidateId = String(item.candidateId || "").trim();
  if (!displayName && !candidateId) {
    return null;
  }

  return compactObject({
    candidateId,
    displayName,
    jobTitle: String(item.jobTitle || "").trim(),
    lastMessageAt: String(item.lastMessageAt || "").trim(),
    lastMessageTimeText: String(item.lastMessageTimeText || "").trim(),
    lastReportedMessageAt: String(item.lastReportedMessageAt || "").trim(),
    identityConfidence: String(item.identityConfidence || "").trim()
  });
}

function compactObject(value = {}) {
  return Object.fromEntries(Object.entries(value).filter(([_key, current]) =>
    current !== undefined &&
    current !== null &&
    current !== "" &&
    !(Array.isArray(current) && current.length === 0)
  ));
}
