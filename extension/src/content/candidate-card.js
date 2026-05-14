import { buildCandidateId } from "./candidate-card-registry.js";

const CANDIDATE_ID_KEYS = [
  "geekId",
  "geekid",
  "encryptGeekId",
  "encryptGeekid",
  "resumeId",
  "resumeid",
  "lid",
  "securityId",
  "securityid"
];

const DETAIL_URL_PATTERNS = ["/geek/detail", "/resume/detail", "geekId="];
const DETAIL_FRAME_URL_PATTERNS = ["/web/frame/c-resume"];
const ACTIVE_STATUS_PATTERNS = [
  "刚刚活跃",
  "在线",
  "今日活跃",
  "本周活跃",
  "本月活跃",
  "昨天活跃"
];
const EDUCATION_PATTERN = /(博士|硕士|本科|大专|中专\/中技|中专|中技|高中|初中|学历不限)/;
const EXPERIENCE_PATTERN = /(10年以上|\d+年以内|\d{2}年毕业|\d+年应届生|\d+年|应届生)/;
const JOB_STATUS_PATTERN = /(离职-(?:随时到岗|考虑机会|暂不考虑|月内到岗)|在职-(?:随时到岗|考虑机会|暂不考虑|月内到岗)|在校-(?:随时到岗|考虑机会|暂不考虑|月内到岗)|应届生)/;
const SALARY_PATTERN = /(?:\d+\s*-\s*\d+K|\d+K|面议)/i;

export function buildCandidateCardPayload({
  text = "",
  dataset = {},
  links = [],
  sourceUrl = "",
  cardIndex = null
} = {}) {
  const candidate = buildCandidateSnapshotPayload({ text, dataset, links, sourceUrl });

  return compactPayloadObject({
    candidate,
    exposure: buildCandidateExposurePayload({
      cardIndex
    })
  });
}

export function buildCandidateSnapshotPayload({
  text = "",
  fingerprintText = "",
  dataset = {},
  links = [],
  sourceUrl = "",
  detailUrl = ""
} = {}) {
  const normalizedText = normalizeText(text);
  const normalizedFingerprintText = normalizeText(fingerprintText || text);
  const initialLinks = [detailUrl, ...links].filter(Boolean);
  const resolvedDetailUrl = detailUrl || resolveDetailUrl(initialLinks) || (
    isCandidateDetailUrl(sourceUrl) ? sourceUrl : ""
  );
  const candidateLinks = [...initialLinks, resolvedDetailUrl].filter(Boolean);
  const idInfo = resolveCandidateId({ dataset, links: candidateLinks });

  const candidate = {
    stableId: idInfo.value || buildCandidateFingerprint({
      normalizedText: normalizedFingerprintText || normalizedText,
      sourceUrl,
      detailUrl: resolvedDetailUrl
    }),
    stableIdSource: idInfo.source || "text_fingerprint",
    detailUrl: resolvedDetailUrl,
    profile: extractCandidateProfile(text)
  };

  return compactCandidateSnapshotPayload({
    candidateId: buildCandidateId(candidate),
    ...candidate
  });
}

export function compactCandidateSnapshotPayload(candidate = {}) {
  const {
    profile,
    ...rest
  } = candidate || {};

  return compactPayloadObject({
    ...rest,
    profile: compactCandidateProfilePayload(profile)
  });
}

export function compactCandidateProfilePayload(profile = {}) {
  return compactPayloadObject(profile || {});
}

export function compactPayloadObject(value = {}) {
  const result = {};
  Object.entries(value || {}).forEach(([key, current]) => {
    if (Array.isArray(current)) {
      const items = current.filter((item) => hasPayloadValue(item));
      if (items.length > 0) {
        result[key] = items;
      }
      return;
    }

    if (isPlainObject(current)) {
      const nested = compactPayloadObject(current);
      if (Object.keys(nested).length > 0) {
        result[key] = nested;
      }
      return;
    }

    if (hasPayloadValue(current)) {
      result[key] = current;
    }
  });
  return result;
}

function buildCandidateExposurePayload({ cardIndex = null } = {}) {
  return compactPayloadObject({
    cardIndex
  });
}

function hasPayloadValue(value) {
  if (Array.isArray(value)) {
    return value.length > 0;
  }
  if (isPlainObject(value)) {
    return Object.keys(value).length > 0;
  }
  return value !== null && value !== undefined && value !== "";
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function shouldTreatAsCandidateCardText(text = "") {
  const normalizedText = normalizeText(text);
  if (!normalizedText.includes("打招呼")) {
    return false;
  }

  const signals = detectCandidateSignals(normalizedText);
  return signals.includes("age") || signals.includes("salary") || signals.includes("expectation");
}

export function normalizeText(text = "") {
  return String(text).replace(/\s+/g, " ").trim();
}

export function extractCandidateProfile(text = "") {
  const lines = normalizeLines(text);
  const normalizedText = normalizeText(text);
  const expectation = extractExpectation(lines, normalizedText);
  return {
    displayName: extractDisplayName(lines, normalizedText),
    salary: extractSalary(normalizedText),
    age: extractAge(normalizedText),
    experience: extractExperience(normalizedText),
    education: extractEducation(normalizedText),
    jobSeekingStatus: extractJobSeekingStatus(normalizedText),
    activeStatus: extractActiveStatus(normalizedText),
    expectedLocation: expectation.location,
    expectedPosition: expectation.position,
    tags: extractShortTags(lines)
  };
}

export function normalizeLines(text = "") {
  return String(text)
    .split(/\n+/)
    .map((line) => normalizeText(line))
    .filter(Boolean);
}

export function resolveCandidateId({ dataset = {}, links = [] } = {}) {
  for (const key of CANDIDATE_ID_KEYS) {
    const value = dataset[key];
    if (value) {
      return {
        value: String(value),
        source: `dataset.${key}`
      };
    }
  }

  for (const href of links) {
    const fromUrl = readCandidateIdFromUrl(href);
    if (fromUrl.value) {
      return fromUrl;
    }
  }

  return { value: "", source: "" };
}

export function readCandidateIdFromUrl(href = "") {
  try {
    const parsed = new URL(href, "https://www.zhipin.com");
    for (const key of CANDIDATE_ID_KEYS) {
      const value = parsed.searchParams.get(key);
      if (value) {
        return {
          value,
          source: `url.${key}`
        };
      }
    }

    const detailMatch = parsed.pathname.match(/\/(?:geek|resume)\/detail\/([^/?#]+)/);
    if (detailMatch) {
      return {
        value: detailMatch[1],
        source: "url.path"
      };
    }
  } catch {
    return { value: "", source: "" };
  }

  return { value: "", source: "" };
}

export function resolveDetailUrl(links = []) {
  return links.find((href) => DETAIL_URL_PATTERNS.some((pattern) => href.includes(pattern))) || "";
}

export function isCandidateDetailUrl(href = "") {
  try {
    const parsed = new URL(href, "https://www.zhipin.com");
    return DETAIL_URL_PATTERNS.some((pattern) => parsed.href.includes(pattern)) ||
      DETAIL_FRAME_URL_PATTERNS.some((pattern) => parsed.pathname.includes(pattern)) ||
      /\/(?:geek|resume)\/detail\//.test(parsed.pathname);
  } catch {
    return false;
  }
}

export function detectCandidateSignals(normalizedText = "") {
  const signals = [];
  if (/\d{2}岁/.test(normalizedText)) {
    signals.push("age");
  }
  if (/(?:\d+\s*-\s*\d+K|\d+K|面议)/i.test(normalizedText)) {
    signals.push("salary");
  }
  if (normalizedText.includes("期望")) {
    signals.push("expectation");
  }
  if (normalizedText.includes("打招呼")) {
    signals.push("greet_button");
  }
  return signals;
}

export function buildCandidateFingerprint({ normalizedText = "", sourceUrl = "", detailUrl = "" } = {}) {
  const input = `${sourceUrl}\n${detailUrl}\n${normalizedText}`;
  return `card_${hashString(input)}`;
}

function hashString(input) {
  let hash = 5381;
  for (let index = 0; index < input.length; index += 1) {
    hash = (hash * 33) ^ input.charCodeAt(index);
  }
  return (hash >>> 0).toString(36);
}

function extractDisplayName(lines, normalizedText = "") {
  const byActiveStatus = extractDisplayNameBeforeActiveStatus(normalizedText);
  if (byActiveStatus) {
    return byActiveStatus;
  }

  const byProfileSignal = extractDisplayNameBeforeProfileSignals(normalizedText);
  if (byProfileSignal) {
    return byProfileSignal;
  }

  for (const line of lines) {
    const cleaned = cleanDisplayNameCandidate(removeActiveStatus(line)).trim();
    if (isLikelyDisplayName(cleaned)) {
      return cleaned;
    }
  }

  return "";
}

function extractDisplayNameBeforeActiveStatus(normalizedText) {
  for (const status of ACTIVE_STATUS_PATTERNS) {
    const match = normalizedText.match(new RegExp(`([^\\s]{2,12})\\s+${escapeRegExp(status)}`));
    const name = cleanDisplayNameCandidate(match?.[1] || "");
    if (isLikelyDisplayName(name)) {
      return name;
    }
  }

  const activeMatch = normalizedText.match(/([^\s]{2,12})\s+(?:\d+分钟前活跃|\d+小时内活跃|\d+日内活跃)/);
  const name = cleanDisplayNameCandidate(activeMatch?.[1] || "");
  return isLikelyDisplayName(name) ? name : "";
}

function extractDisplayNameBeforeProfileSignals(normalizedText) {
  const match = normalizedText.match(/([^\s]{2,12})\s+(?:(?:\d+\s*-\s*\d+K|\d+K|面议)|\d{2}岁)/i);
  const name = cleanDisplayNameCandidate(match?.[1] || "");
  return isLikelyDisplayName(name) ? name : "";
}

function cleanDisplayNameCandidate(value) {
  return value
    .replace(/^(?:牛人|候选人|相似经历|热搜|其他|推荐|在线)+/, "")
    .replace(/[：:，,。]/g, "")
    .trim();
}

function isLikelyDisplayName(value) {
  if (!value || value.length > 12) {
    return false;
  }
  const blockedWords = [
    "求职期望",
    "期望",
    "优势",
    "个人优势",
    "牛人优势",
    "工作经历",
    "教育经历",
    "打招呼",
    "不限",
    "推荐",
    "热搜",
    "牛人",
    "的牛人",
    "相似经历",
    "经历：",
    "院校："
  ];
  if (
    SALARY_PATTERN.test(value) ||
    EDUCATION_PATTERN.test(value) ||
    EXPERIENCE_PATTERN.test(value) ||
    JOB_STATUS_PATTERN.test(value) ||
    /\d/.test(value) ||
    value.includes("+") ||
    /\d{2}岁/.test(value) ||
    blockedWords.some((word) => value.includes(word))
  ) {
    return false;
  }
  return /[\u4e00-\u9fa5A-Za-z]/.test(value);
}

function extractSalary(normalizedText) {
  return normalizedText.match(SALARY_PATTERN)?.[0]?.replace(/\s+/g, "") || "";
}

function extractAge(normalizedText) {
  const age = Number(normalizedText.match(/(\d{2})岁/)?.[1]);
  return Number.isFinite(age) ? age : null;
}

function extractExperience(normalizedText) {
  return normalizedText.match(EXPERIENCE_PATTERN)?.[1] || "";
}

function extractEducation(normalizedText) {
  return normalizedText.match(EDUCATION_PATTERN)?.[1] || "";
}

function extractJobSeekingStatus(normalizedText) {
  return normalizedText.match(JOB_STATUS_PATTERN)?.[1] || "";
}

function extractActiveStatus(normalizedText) {
  const direct = ACTIVE_STATUS_PATTERNS.find((status) => normalizedText.includes(status));
  if (direct) {
    return direct;
  }

  return normalizedText.match(/\d+分钟前活跃|\d+小时内活跃|\d+日内活跃/)?.[0] || "";
}

function extractExpectation(lines, normalizedText) {
  const expectationIndex = lines.findIndex((line) => line === "期望" || line === "求职期望");
  if (expectationIndex >= 0) {
    const nextLine = lines[expectationIndex + 1] || "";
    const fromLine = splitExpectationLine(nextLine);
    if (fromLine.location || fromLine.position) {
      return fromLine;
    }
  }

  const inlineMatch = normalizedText.match(
    /(?:求职期望|期望职位|期望)\s+([^\s]+)\s+(.+?)(?:\s+(?:个人优势|牛人优势|优势|工作经历|教育经历|项目经历|打招呼)|$)/
  );
  if (!inlineMatch) {
    return { location: "", position: "" };
  }

  return {
    location: inlineMatch[1] || "",
    position: trimExpectationPosition(inlineMatch[2] || "")
  };
}

function splitExpectationLine(line) {
  const parts = line.split(/\s+/).filter(Boolean);
  if (!parts.length) {
    return { location: "", position: "" };
  }
  return {
    location: parts[0],
    position: trimExpectationPosition(parts.slice(1).join(" "))
  };
}

function trimExpectationPosition(position) {
  return position
    .replace(/\s+(?:个人优势|牛人优势|优势|工作经历|教育经历|项目经历).*$/, "")
    .replace(/\s+打招呼.*$/, "")
    .trim();
}

function extractShortTags(lines) {
  const tags = [];
  const blocked = new Set(["期望", "优势", "打招呼", "不限", "退伍军人"]);
  for (const line of lines) {
    if (tags.length >= 8) {
      break;
    }
    if (blocked.has(line) || line.startsWith("优势") || line.length > 24) {
      continue;
    }
    if (
      isLikelyDisplayName(removeActiveStatus(line)) ||
      SALARY_PATTERN.test(line) ||
      /\d{2}岁/.test(line) ||
      /^\d{4}/.test(line)
    ) {
      continue;
    }
    if (line.includes("+") || line.includes("经验") || line.includes("最近关注") || line.includes("来自")) {
      tags.push(line);
    }
  }
  return tags;
}

function removeActiveStatus(line) {
  let result = line;
  for (const status of ACTIVE_STATUS_PATTERNS) {
    result = result.replace(status, "");
  }
  return result.replace(/\d+分钟前活跃|\d+小时内活跃/g, "").trim();
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
