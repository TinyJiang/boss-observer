export const CHAT_MESSAGE_CLEANUP_RULES_PATH = "src/shared/chat-message-cleanup-rules.json";

export const DEFAULT_CHAT_MESSAGE_CLEANUP_RULES = Object.freeze({
  schemaVersion: "1.0.0",
  ignoreExactTexts: Object.freeze([
    "快速沟通小技巧！",
    "觉得合适，直接联系牛人吧~",
    "暂不考虑",
    "获取联系方式",
    "求简历",
    "换电话",
    "换微信",
    "约面试",
    "不合适",
    "发送",
    "在线简历",
    "附件简历",
    "牛人分析器",
    "已读",
    "送达",
    "未读"
  ]),
  ignoreRegexes: Object.freeze([
    "^\\d{1,2}月\\d{1,2}日\\s+沟通的职位-.+$",
    "^/?\\S+\\.(?:png|jpe?g|webp|gif|mp3|wav|m4a|mp4)(?:\\?\\S*)?$"
  ])
});

export async function loadChatMessageCleanupRules({
  fetchFn = globalThis.fetch?.bind(globalThis),
  runtime = globalThis.chrome?.runtime
} = {}) {
  if (!fetchFn || !runtime?.getURL) {
    return DEFAULT_CHAT_MESSAGE_CLEANUP_RULES;
  }

  try {
    const response = await fetchFn(runtime.getURL(CHAT_MESSAGE_CLEANUP_RULES_PATH));
    if (!response?.ok) {
      return DEFAULT_CHAT_MESSAGE_CLEANUP_RULES;
    }
    return normalizeChatMessageCleanupRules(await response.json());
  } catch {
    return DEFAULT_CHAT_MESSAGE_CLEANUP_RULES;
  }
}

export function normalizeChatMessageCleanupRules(rules = {}) {
  return {
    schemaVersion: String(rules.schemaVersion || DEFAULT_CHAT_MESSAGE_CLEANUP_RULES.schemaVersion),
    ignoreExactTexts: normalizeStringList(rules.ignoreExactTexts),
    ignoreRegexes: normalizeStringList(rules.ignoreRegexes)
  };
}

export function shouldIgnoreChatMessageText(text = "", rules = DEFAULT_CHAT_MESSAGE_CLEANUP_RULES) {
  const normalized = normalizeComparableText(text);
  if (!normalized) {
    return true;
  }

  const currentRules = normalizeChatMessageCleanupRules(rules);
  if (currentRules.ignoreExactTexts.includes(normalized)) {
    return true;
  }
  return currentRules.ignoreRegexes.some((pattern) => matchesRulePattern(normalized, pattern));
}

function normalizeStringList(value) {
  return Array.isArray(value)
    ? Array.from(new Set(value.map(normalizeComparableText).filter(Boolean)))
    : [];
}

function normalizeComparableText(value = "") {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function matchesRulePattern(text, pattern) {
  try {
    return new RegExp(pattern, "i").test(text);
  } catch {
    return false;
  }
}
