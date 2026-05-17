import {
  buildCandidateSnapshotPayload,
  detectCandidateSignals,
  extractCandidateProfile,
  isCandidateDetailUrl,
  normalizeText,
  resolveDetailUrl,
  shouldTreatAsCandidateCardText
} from "./candidate-card.js";
import { readCanvasTextForDocument } from "./canvas-text-capture.js";
import {
  clearRecentCandidateDetailAssociation as clearRecentDetailAssociation,
  getCandidateCardAssociationByExposure,
  getCandidateCardAssociationFromElement,
  getRecentCandidateCardAssociation as readRecentCandidateCardAssociation,
  mergeCandidateSnapshotWithAssociation,
  rememberCandidateSnapshotAssociation as rememberSnapshotAssociation,
  recordCandidateCardInteraction
} from "./candidate-card-registry.js";
import { classifyPage } from "../shared/page-classifier.js";
import { EVENT_TYPES } from "../shared/event-types.js";

const SCAN_INTERVAL_MS = 2000;
const DETAIL_LOAD_STABILIZE_MS = 5000;
const MIN_DETAIL_TEXT_LENGTH = 30;
const MAX_DETAIL_TEXT_LENGTH = 60000;
const MAX_DATASET_ANCESTOR_STEPS = 8;
const MAX_ACCESSIBLE_FRAME_DEPTH = 4;
const DETAIL_FINGERPRINT_TEXT_LENGTH = 1800;
const DETAIL_SUMMARY_MAX_CHARS = 160;
const DETAIL_SECTION_ITEM_LIMIT = 3;
const BOSS_ANALYSIS_ITEM_LIMIT = 8;
const DETAIL_RICHNESS_REOPEN_THRESHOLD = 4;
const DETAIL_OPEN_DEFER_MS = 1500;
const BOSS_ANALYSIS_SIGNAL = "boss_analysis_section";
const AUXILIARY_TEXT_ELEMENT_LIMIT = 300;
const MAX_SELECTED_CARD_ANCESTOR_STEPS = 8;
const DETAIL_CARD_MATCH_MIN_SCORE = 8;
const SKIPPED_TEXT_NODE_PARENT_TAGS = new Set([
  "SCRIPT",
  "STYLE",
  "NOSCRIPT",
  "TEMPLATE",
  "SVG"
]);
const DETAIL_CONTAINER_SELECTOR = [
  "[class*='detail']",
  "[class*='resume']",
  "[class*='c-resume']",
  "[class*='geek']",
  "[class*='profile']",
  "[class*='resume-card']"
].join(",");
const SELECTED_CANDIDATE_CARD_SELECTOR = [
  "[aria-selected='true']",
  "[class*='active']",
  "[class*='selected']",
  "[class*='current']",
  "[class*='cur']",
  "[class*='checked']",
  "[class*='focus']"
].join(",");
const COMMON_DETAIL_MATCH_TOKENS = new Set([
  "打招呼",
  "刚刚活跃",
  "今日活跃",
  "本周活跃",
  "本月活跃",
  "离职",
  "在职",
  "随时到岗",
  "考虑机会",
  "暂不考虑",
  "大专",
  "本科",
  "高中",
  "中专",
  "中技",
  "赣州",
  "兼职",
  "主播",
  "直播",
  "有图片作品",
  "性格开朗"
]);
const INLINE_DETAIL_CONTAINER_PAGE_TYPES = new Set([
  "candidate_recommend",
  "candidate_search",
  "candidate_intention",
  "candidate_interaction",
  "candidate_manage"
]);

const DETAIL_SECTION_SIGNAL_RULES = [
  ["job_expectation_section", ["求职期望", "期望职位"]],
  ["advantage_section", ["个人优势", "牛人优势", "自我评价"]],
  ["work_experience_section", ["经历概览", "工作经历", "工作经验"]],
  ["education_section", ["教育经历", "教育背景", "院校："]],
  ["project_section", ["项目经历"]],
  ["certificate_section", ["资格证书", "证书"]],
  ["boss_analysis_section", ["牛人分析"]],
  ["detail_actions", ["收藏", "不合适", "举报", "转发牛人"]]
];

const DETAIL_SUMMARY_SECTIONS = [
  {
    key: "advantage",
    labels: ["个人优势", "牛人优势", "自我评价"],
    stopLabels: ["求职期望", "期望职位", "经历概览", "工作经历", "工作经验", "教育经历", "项目经历", "资格证书", "牛人分析"]
  },
  {
    key: "jobExpectation",
    labels: ["求职期望", "期望职位"],
    stopLabels: ["个人优势", "牛人优势", "自我评价", "经历概览", "工作经历", "工作经验", "教育经历", "项目经历", "资格证书", "牛人分析"]
  },
  {
    key: "workExperience",
    labels: ["经历概览", "工作经历", "工作经验"],
    stopLabels: ["教育经历", "教育背景", "项目经历", "资格证书", "证书", "牛人分析", "个人优势", "求职期望", "期望职位"]
  },
  {
    key: "educationExperience",
    labels: ["教育经历", "教育背景"],
    stopLabels: ["项目经历", "资格证书", "证书", "牛人分析", "个人优势", "求职期望", "期望职位", "工作经历", "工作经验"]
  },
  {
    key: "projectExperience",
    labels: ["项目经历"],
    stopLabels: ["资格证书", "证书", "牛人分析", "教育经历", "工作经历", "个人优势", "求职期望"]
  },
  {
    key: "certificates",
    labels: ["资格证书", "证书"],
    stopLabels: ["牛人分析", "项目经历", "教育经历", "工作经历", "个人优势", "求职期望"]
  }
];
const DETAIL_MAJOR_SECTION_LABELS = [
  "期望职位",
  "求职期望",
  "工作经历",
  "工作经验",
  "教育经历",
  "教育背景",
  "项目经历",
  "资格证书",
  "牛人分析",
  "牛人分析器"
];

const CORE_DETAIL_SECTION_KEYS = new Set([
  "advantage",
  "workExperience",
  "educationExperience",
  "projectExperience"
]);

const CONTACT_TEXT_PATTERN = /(?:微信号|加微信|手机号|手机[:：\s]|电话|联系方式|wechat|weixin|(?:^|\s)wx[:：\s_-]?)/i;
const AUXILIARY_TEXT_ATTRIBUTES = [
  "aria-label",
  "title",
  "alt",
  "data-text",
  "data-title",
  "data-content",
  "data-value"
];
const AUXILIARY_TEXT_SELECTOR = AUXILIARY_TEXT_ATTRIBUTES
  .map((attribute) => `[${attribute}]`)
  .join(",");

// Responsibilities:
// - observe candidate detail open/close state
// - emit factual detail events without resume or chat text
// - keep DOM heuristics isolated for later BOSS validation
export class CandidateDetailProbe {
  constructor({
    collector,
    sessionContext,
    scanIntervalMs = SCAN_INTERVAL_MS,
    openDeferMs = DETAIL_OPEN_DEFER_MS,
    detectActiveDetail = findActiveCandidateDetail,
    readCanvasText = readCanvasTextForDocument,
    getRecentCandidateCardAssociation = readRecentCandidateCardAssociation,
    rememberCandidateCardInteraction = recordCandidateCardInteraction,
    rememberCandidateSnapshotAssociation = rememberSnapshotAssociation,
    clearRecentCandidateDetailAssociation = clearRecentDetailAssociation,
    now = () => Date.now()
  }) {
    this.collector = collector;
    this.sessionContext = sessionContext;
    this.scanIntervalMs = scanIntervalMs;
    this.openDeferMs = Math.max(0, Number(openDeferMs) || 0);
    this.detectActiveDetail = detectActiveDetail;
    this.readCanvasText = readCanvasText;
    this.getRecentCandidateCardAssociation = getRecentCandidateCardAssociation;
    this.rememberCandidateCardInteraction = rememberCandidateCardInteraction;
    this.rememberCandidateSnapshotAssociation = rememberCandidateSnapshotAssociation;
    this.clearRecentCandidateDetailAssociation = clearRecentCandidateDetailAssociation;
    this.now = now;
    this.started = false;
    this.pollHandle = null;
    this.activeDetail = null;
  }

  start() {
    if (this.started) {
      return;
    }

    this.started = true;
    this.safeScan("start");
    this.pollHandle = globalThis.setInterval(() => this.safeScan("poll"), this.scanIntervalMs);
  }

  stop(reason = "stopped") {
    if (!this.started) {
      return;
    }

    this.closeActiveDetail(reason, "probe_stopped");
    this.started = false;
    if (this.pollHandle !== null) {
      globalThis.clearInterval(this.pollHandle);
      this.pollHandle = null;
    }
  }

  scan(source) {
    const detectedDetail = this.detectActiveDetail(globalThis.document, this.sessionContext.page, {
      readCanvasText: this.readCanvasText
    });
    if (!detectedDetail) {
      this.closeActiveDetail(source, "detail_disappeared");
      return;
    }

    const recentAssociation = this.getRecentCandidateCardAssociation?.({ now: this.now }) ||
      buildAssociationFromActiveDetailPayload(this.activeDetail?.payload);
    const effectiveDetectedDetail = applyRecentClickedCardForSelectedFallback(
      detectedDetail,
      recentAssociation
    );
    const candidateAssociation = selectCandidateAssociationForDetail(
      effectiveDetectedDetail,
      recentAssociation
    );
    const payloadInput = {
      source,
      page: this.sessionContext.page,
      ...effectiveDetectedDetail
    };
    let payload = buildCandidateDetailPayload({
      ...payloadInput,
      candidateAssociation
    });
    const exactExposureAssociation = findExactExposureAssociationForDetailPayload(payload, this.sessionContext.page);
    if (!payload.candidate?.exposureKey && exactExposureAssociation) {
      payload = buildCandidateDetailPayload({
        ...payloadInput,
        candidateAssociation: exactExposureAssociation
      });
    }
    const key = buildCandidateDetailKey(payload);

    if (this.activeDetail?.key === key) {
      if (this.activeDetail.pendingOpen) {
        this.updatePendingOpenedDetail(payload, key);
        return;
      }
      if (this.shouldEmitRicherDetailOpened(payload)) {
        this.emitOpenedDetail(payload, key);
        return;
      }
      this.activeDetail = {
        ...this.activeDetail,
        payload
      };
      this.rememberDetailAssociation(payload);
      return;
    }

    if (this.shouldTreatAsSameLoadingDetail(payload)) {
      if (this.activeDetail.pendingOpen) {
        this.updatePendingOpenedDetail(payload, key);
        return;
      }
      if (this.shouldEmitRicherDetailOpened(payload)) {
        this.emitOpenedDetail(payload, key);
        return;
      }
      this.activeDetail = {
        ...this.activeDetail,
        key,
        payload
      };
      this.rememberDetailAssociation(payload);
      return;
    }

    if (this.activeDetail) {
      this.closeActiveDetail(source, "candidate_switched");
    }

    this.startPendingOpenedDetail(payload, key);
  }

  emitOpenedDetail(payload, key) {
    const openedEvent = this.collector.collect(EVENT_TYPES.CANDIDATE_DETAIL_OPENED, payload);
    this.activeDetail = {
      key,
      payload,
      openedAtMs: this.now(),
      openedEventId: openedEvent?.id || "",
      lastOpenedRichnessScore: scoreDetailRichness(payload),
      pendingOpen: false
    };
    this.rememberDetailAssociation(payload);
  }

  startPendingOpenedDetail(payload, key) {
    this.activeDetail = {
      key,
      payload,
      openedAtMs: this.now(),
      openedEventId: "",
      lastOpenedRichnessScore: scoreDetailRichness(payload),
      pendingOpen: true
    };
    this.rememberDetailAssociation(payload);
    this.flushPendingOpenedDetailIfReady();
  }

  updatePendingOpenedDetail(payload, key) {
    this.activeDetail = {
      ...this.activeDetail,
      key,
      payload,
      lastOpenedRichnessScore: scoreDetailRichness(payload)
    };
    this.rememberDetailAssociation(payload);
    this.flushPendingOpenedDetailIfReady();
  }

  flushPendingOpenedDetailIfReady({ force = false } = {}) {
    if (!this.activeDetail?.pendingOpen) {
      return;
    }
    if (!force && !this.shouldFlushPendingOpenedDetail()) {
      return;
    }

    const openedEvent = this.collector.collect(
      EVENT_TYPES.CANDIDATE_DETAIL_OPENED,
      this.activeDetail.payload
    );
    this.activeDetail = {
      ...this.activeDetail,
      openedEventId: openedEvent?.id || "",
      pendingOpen: false
    };
  }

  shouldFlushPendingOpenedDetail() {
    if (!this.activeDetail?.pendingOpen) {
      return false;
    }
    return this.openDeferMs <= 0 ||
      hasBossAnalysisSignal(this.activeDetail.payload) ||
      this.now() - this.activeDetail.openedAtMs >= this.openDeferMs;
  }

  rememberDetailAssociation(payload) {
    const cardId = payload?.candidate?.candidateId || "";
    if (!cardId) {
      return;
    }

    const remembered = this.rememberCandidateSnapshotAssociation?.({
      candidate: payload.candidate,
      interactionType: "candidate_detail_opened",
      sourceUrl: payload.detailUrl,
      now: this.now
    });
    if (remembered) {
      return;
    }

    this.rememberCandidateCardInteraction?.(cardId, {
      interactionType: "candidate_detail_opened",
      sourceUrl: payload.detailUrl,
      now: this.now
    });
  }

  shouldTreatAsSameLoadingDetail(payload) {
    if (!this.activeDetail) {
      return false;
    }

    const activePayload = this.activeDetail.payload;
    const activeCandidate = activePayload.candidate || {};
    const currentCandidate = payload.candidate || {};
    return this.now() - this.activeDetail.openedAtMs <= DETAIL_LOAD_STABILIZE_MS &&
      activeCandidate.stableIdSource === "text_fingerprint" &&
      currentCandidate.stableIdSource === "text_fingerprint" &&
      (activePayload.detailUrl || "") === (payload.detailUrl || "") &&
      (activePayload.detectedBy || "") === (payload.detectedBy || "");
  }

  shouldEmitRicherDetailOpened(payload) {
    if (!this.activeDetail) {
      return false;
    }

    if (!hasBossAnalysisSignal(this.activeDetail.payload) && hasBossAnalysisSignal(payload)) {
      return true;
    }

    const previousScore = this.activeDetail.lastOpenedRichnessScore ??
      scoreDetailRichness(this.activeDetail.payload);
    const currentScore = scoreDetailRichness(payload);
    const previousCoreItems = countCoreDetailProfileItems(this.activeDetail.payload?.candidate?.detailProfile);
    const currentCoreItems = countCoreDetailProfileItems(payload?.candidate?.detailProfile);
    return previousCoreItems === 0 &&
      currentCoreItems > 0 &&
      currentScore >= previousScore + DETAIL_RICHNESS_REOPEN_THRESHOLD;
  }

  safeScan(source) {
    try {
      this.scan(source);
    } catch (error) {
      this.collector.collect(EVENT_TYPES.PLUGIN_EXCEPTION, {
        source: `candidate_detail:${source}`,
        message: error instanceof Error ? error.message : String(error)
      });
    }
  }

  closeActiveDetail(source, reason) {
    if (!this.activeDetail) {
      return;
    }

    const active = this.activeDetail;
    this.flushPendingOpenedDetailIfReady({ force: true });
    const flushedActive = this.activeDetail || active;
    this.activeDetail = null;
    this.clearRecentCandidateDetailAssociation?.({
      candidateId: flushedActive.payload?.candidate?.candidateId || ""
    });
    this.collector.collect(EVENT_TYPES.CANDIDATE_DETAIL_CLOSED, {
      source,
      reason,
      detailUrl: flushedActive.payload.detailUrl,
      candidate: flushedActive.payload.candidate,
      durationMs: Math.max(0, this.now() - flushedActive.openedAtMs),
      openedEventId: flushedActive.openedEventId
    });
  }
}

export function buildCandidateDetailPayload({
  source = "poll",
  page = null,
  sourceUrl = "",
  candidateSourceUrl = "",
  detailUrl = "",
  text = "",
  dataset = {},
  links = [],
  detectedBy = "unknown",
  analysisVisible = false,
  candidateAssociation = null
} = {}) {
  const normalizedText = normalizeText(text);
  const resolvedDetailUrl = detailUrl || resolveDetailUrl(links) || (
    isCandidateDetailUrl(sourceUrl) ? sourceUrl : ""
  );
  const candidateIdentitySourceUrl = candidateSourceUrl || sourceUrl;
  const candidateIdentityDetailUrl = candidateSourceUrl ? "" : resolvedDetailUrl;
  const candidate = buildCandidateSnapshotPayload({
    text,
    fingerprintText: buildDetailFingerprintText(normalizedText),
    dataset,
    links,
    sourceUrl: candidateIdentitySourceUrl,
    detailUrl: candidateIdentityDetailUrl
  });
  const detailProfile = shouldExtractDetailProfileForDetectedSource(detectedBy) ?
    extractCandidateDetailProfile(text) :
    emptyDetailProfile();
  const associatedCandidate = mergeCandidateSnapshotWithAssociation({
    ...candidate,
    detailProfile
  }, candidateAssociation);
  const publicDetailUrl = associatedCandidate.detailUrl || candidate.detailUrl || resolvedDetailUrl;

  return {
    source,
    detailUrl: publicDetailUrl,
    detectedBy,
    candidate: compactDetailCandidatePayload(associatedCandidate, {
      payloadDetailUrl: publicDetailUrl
    }),
    ...buildDetailAnalysisPayload(associatedCandidate, {
      analysisVisible
    })
  };
}

export function buildCandidateDetailKey(payload) {
  const candidate = payload?.candidate || {};
  return `${candidate.stableIdSource || "unknown"}:${candidate.stableId || payload?.detailUrl || ""}`;
}

function compactDetailCandidatePayload(candidate = {}, {
  payloadDetailUrl = ""
} = {}) {
  const result = {};
  [
    "candidateId",
    "stableId",
    "stableIdSource",
    "exposureKey",
    "exposedEventId"
  ].forEach((key) => {
    if (hasPayloadValue(candidate[key])) {
      result[key] = candidate[key];
    }
  });

  if (
    hasPayloadValue(candidate.detailUrl) &&
    !(candidate.detailUrl === payloadDetailUrl && isCResumeDetailUrl(candidate.detailUrl))
  ) {
    result.detailUrl = candidate.detailUrl;
  }

  const profile = compactPlainObject(candidate.profile);
  if (Object.keys(profile).length > 0) {
    result.profile = profile;
  }

  const detailProfile = compactDetailProfile(candidate.detailProfile);
  if (detailProfile) {
    result.detailProfile = detailProfile;
  }

  return result;
}

function compactDetailProfile(detailProfile = {}) {
  const result = {};
  const topSummary = compactItemsSummary(detailProfile.topSummary);
  if (topSummary) {
    result.topSummary = topSummary;
  }

  const overview = compactItemsSummary(detailProfile.overview);
  if (overview) {
    result.overview = overview;
  }

  const bossAnalysis = compactBossAnalysis(detailProfile.bossAnalysis);
  if (bossAnalysis) {
    result.bossAnalysis = bossAnalysis;
  }

  const sections = compactDetailSections(detailProfile.sections);
  if (Object.keys(sections).length > 0) {
    result.sections = sections;
    result.sectionKeys = Object.keys(sections);
  }

  return Object.keys(result).length > 0 ? result : null;
}

function buildDetailAnalysisPayload(candidate = {}, {
  analysisVisible = false
} = {}) {
  return (analysisVisible || compactBossAnalysis(candidate?.detailProfile?.bossAnalysis))
    ? {
        analysis: {
          module: "boss_analysis"
        }
      }
    : {};
}

function compactItemsSummary(summary = {}) {
  const items = compactStringArray(summary.items);
  return items.length > 0 ? { items } : null;
}

function compactBossAnalysis(summary = {}) {
  const result = {};
  const title = normalizeText(summary.title || "");
  const items = compactStringArray(summary.items);
  const actionText = normalizeText(summary.actionText || "");
  if (title) {
    result.title = title;
  }
  if (items.length > 0) {
    result.items = items;
  }
  if (actionText) {
    result.actionText = actionText;
  }
  return Object.keys(result).length > 0 ? result : null;
}

function compactDetailSections(sections = {}) {
  return Object.fromEntries(
    Object.entries(sections || {})
      .map(([key, section]) => [key, compactItemsSummary(section)])
      .filter(([, section]) => section)
  );
}

function compactPlainObject(value = {}) {
  const result = {};
  Object.entries(value || {}).forEach(([key, current]) => {
    if (Array.isArray(current)) {
      const items = compactStringArray(current);
      if (items.length > 0) {
        result[key] = items;
      }
      return;
    }
    if (hasPayloadValue(current)) {
      result[key] = current;
    }
  });
  return result;
}

function compactStringArray(items = []) {
  return Array.from(items || [])
    .map((item) => normalizeText(item))
    .filter(Boolean);
}

function hasPayloadValue(value) {
  if (Array.isArray(value)) {
    return value.length > 0;
  }
  return value !== null && value !== undefined && value !== "";
}

function isCResumeDetailUrl(url = "") {
  return String(url).includes("/web/frame/c-resume");
}

export function findActiveCandidateDetail(rootDocument, currentPage = null, {
  readCanvasText = readCanvasTextForDocument
} = {}) {
  if (!rootDocument) {
    return null;
  }

  const candidates = [];
  const accessibleDocuments = collectAccessibleDocuments(rootDocument);
  const candidateListCards = findCandidateListCards(accessibleDocuments);
  accessibleDocuments.forEach(({ document: currentDocument, frameElement }) => {
    const sourceUrl = currentDocument.location?.href || globalThis.location?.href || "";
    const sourcePage = classifyPage(sourceUrl);
    const body = currentDocument.body || currentDocument.documentElement;
    const isDetailUrlPage = sourcePage.pageType === "candidate_detail" ||
      currentPage?.pageType === "candidate_detail";
    const isCResumeFrame = sourceUrl.includes("/web/frame/c-resume");
    const detailRoot = isCResumeFrame ? (findCandidateDetailContainer(currentDocument) || body) : body;
    const domText = readElementText(detailRoot);
    const canvasText = readCandidateDetailCanvasText(currentDocument, sourceUrl, readCanvasText);
    const bodyText = mergeDetailText(domText, canvasText);
    const hasCanvasText = normalizeText(canvasText).length > 0;
    const analysisVisible = hasBossAnalysisModuleSignal(bodyText);
    const bodyLinks = readLinks(detailRoot);
    const hasLoadedDetailContent = bodyText.length >= MIN_DETAIL_TEXT_LENGTH ||
      currentDocument.readyState !== "loading";

    if (isDetailUrlPage && hasLoadedDetailContent && isDocumentFrameVisible(frameElement)) {
      const shouldUseOwnDetailText = !isCResumeFrame ||
        shouldTreatAsCandidateDetailText(bodyText) ||
        (hasCanvasText && shouldTreatAsCanvasCandidateDetailText(bodyText));
      const fallbackCard = isCResumeFrame ? findBestCandidateListCardForDetail(candidateListCards, bodyText) : null;
      const selectedFallbackCard = isCResumeFrame && !fallbackCard && !shouldUseOwnDetailText ?
        findSelectedCandidateListCard(candidateListCards) :
        null;
      const candidateCard = fallbackCard || selectedFallbackCard;
      const candidateText = buildDetailCandidateText({
        detailText: bodyText,
        candidateCard,
        shouldUseOwnDetailText
      });
      const candidateDataset = candidateCard?.dataset || readMergedDataset(body);
      const candidateLinks = candidateCard?.links || bodyLinks;
      if (!shouldUseOwnDetailText && !candidateCard) {
        return;
      }

      candidates.push({
        score: scoreDetailCandidate(candidateText, sourceUrl) + (candidateCard ? 80 : 100),
        sourceUrl,
        candidateSourceUrl: candidateCard?.sourceUrl || sourceUrl,
        detailUrl: isCandidateDetailUrl(sourceUrl) ? sourceUrl : resolveDetailUrl(bodyLinks),
        text: candidateText,
        dataset: candidateDataset,
        links: candidateLinks,
        analysisVisible,
        textSources: buildDetailTextSources({
          domText,
          canvasText,
          bodyText,
          shouldUseOwnDetailText,
          candidateCard
        }),
        candidateAssociation: candidateCard?.association || null,
        detectedBy: resolveDetailDetectionSource({
          isCResumeFrame,
          hasCanvasText,
          candidateCard
        })
      });
    }

    const container = !isDetailUrlPage && shouldScanInlineDetailContainer(sourcePage, currentPage) ?
      findCandidateDetailContainer(currentDocument) :
      null;
    if (container && isDocumentFrameVisible(frameElement)) {
      const text = readElementText(container);
      const links = readLinks(container);
      candidates.push({
        score: scoreDetailCandidate(text, sourceUrl),
        sourceUrl,
        candidateSourceUrl: sourceUrl,
        detailUrl: resolveDetailUrl(links) || (isCandidateDetailUrl(sourceUrl) ? sourceUrl : ""),
        text,
        dataset: readMergedDataset(container),
        links,
        analysisVisible: hasBossAnalysisModuleSignal(text),
        textSources: buildDetailTextSources({
          domText: text,
          canvasText: "",
          bodyText: text,
          shouldUseOwnDetailText: true,
          candidateCard: null
        }),
        detectedBy: "detail_dom"
      });
    }
  });

  candidates.sort((left, right) => right.score - left.score);
  return candidates[0] || null;
}

function shouldScanInlineDetailContainer(sourcePage = {}, currentPage = {}) {
  return INLINE_DETAIL_CONTAINER_PAGE_TYPES.has(sourcePage?.pageType) ||
    INLINE_DETAIL_CONTAINER_PAGE_TYPES.has(currentPage?.pageType);
}

function findCandidateListCards(accessibleDocuments) {
  const cards = [];
  const seen = new Set();
  accessibleDocuments.forEach(({ document: currentDocument }) => {
    if (classifyPage(currentDocument.location?.href || "").pageType === "candidate_detail") {
      return;
    }

    Array.from(currentDocument.querySelectorAll?.(SELECTED_CANDIDATE_CARD_SELECTOR) || [])
      .forEach((element) => {
        appendCandidateListCard(cards, seen, currentDocument, element);
      });

    Array.from(currentDocument.querySelectorAll?.("button, a") || [])
      .filter((element) => readElementText(element).includes("打招呼"))
      .forEach((element) => {
        appendCandidateListCard(cards, seen, currentDocument, element);
      });
  });

  return cards;
}

function appendCandidateListCard(cards, seen, currentDocument, element) {
  const card = findCandidateCardLikeAncestor(element);
  if (!card || seen.has(card) || !isElementVisible(card)) {
    return;
  }

  seen.add(card);
  const text = readElementText(card);
  const dataset = readMergedDataset(card);
  const links = readLinks(card);
  const sourceUrl = currentDocument.location?.href || globalThis.location?.href || "";
  const association = getCandidateCardAssociationFromElement(card);
  const cardTexts = splitCandidateListCardText(text);
  const hasSingleCardText = cardTexts.length === 1;
  cardTexts.forEach((cardText) => {
    cards.push({
      text: cardText,
      dataset: hasSingleCardText ? dataset : {},
      links: hasSingleCardText ? links : [],
      sourceUrl,
      association: hasSingleCardText ? association : null,
      selectedScore: scoreSelectedCandidateCard(card, cardText)
    });
  });
}

function findSelectedCandidateListCard(cards) {
  const selectedCards = cards
    .filter((card) => card.selectedScore > 0)
    .map((card) => ({
      ...card,
      matchedBy: "selected_state",
      score: card.selectedScore
    }));

  selectedCards.sort((left, right) => right.score - left.score);
  return selectedCards[0] || null;
}

function findBestCandidateListCardForDetail(cards, detailText) {
  const scoredCards = cards
    .map((card) => ({
      ...card,
      matchedBy: "detail_overlap",
      score: scoreCandidateCardAgainstDetail(card.text, detailText)
    }))
    .filter((card) => card.score >= DETAIL_CARD_MATCH_MIN_SCORE);

  scoredCards.sort((left, right) => right.score - left.score);
  return scoredCards[0] || null;
}

function buildDetailCandidateText({
  detailText = "",
  candidateCard = null,
  shouldUseOwnDetailText = false
} = {}) {
  if (!candidateCard) {
    return detailText;
  }

  if (!shouldUseOwnDetailText && candidateCard.matchedBy === "selected_state") {
    return candidateCard.text;
  }

  return `${candidateCard.text}\n${detailText}`;
}

function resolveDetailDetectionSource({
  isCResumeFrame = false,
  hasCanvasText = false,
  candidateCard = null
} = {}) {
  if (candidateCard?.matchedBy === "detail_overlap") {
    return hasCanvasText ? "c_resume_canvas_matched_card" : "c_resume_matched_card";
  }

  if (candidateCard) {
    return "c_resume_selected_card";
  }

  if (isCResumeFrame) {
    return hasCanvasText ? "c_resume_canvas" : "c_resume_frame";
  }

  return "detail_url";
}

function selectCandidateAssociationForDetail(detectedDetail = {}, recentAssociation = null) {
  if (detectedDetail.candidateAssociation) {
    return detectedDetail.candidateAssociation;
  }
  if (!recentAssociation) {
    return null;
  }
  if (String(detectedDetail.detectedBy || "").startsWith("c_resume")) {
    return recentAssociation;
  }
  if (String(detectedDetail.sourceUrl || "").includes("/web/frame/c-resume")) {
    return recentAssociation;
  }
  return null;
}

function applyRecentClickedCardForSelectedFallback(detectedDetail = {}, recentAssociation = null) {
  if (!shouldPreferRecentClickedCardForSelectedFallback(detectedDetail, recentAssociation)) {
    return detectedDetail;
  }

  return {
    ...detectedDetail,
    text: "",
    candidateSourceUrl: recentAssociation.sourceUrl || detectedDetail.candidateSourceUrl,
    candidateAssociation: recentAssociation,
    detectedBy: "c_resume_recent_card"
  };
}

function shouldPreferRecentClickedCardForSelectedFallback(detectedDetail = {}, recentAssociation = null) {
  if (!recentAssociation || detectedDetail.detectedBy !== "c_resume_selected_card") {
    return false;
  }

  const textSources = detectedDetail.textSources || {};
  if (textSources.usedOwnDetailText !== false) {
    return false;
  }
  if (textSources.candidateCardMatchedBy !== "selected_state") {
    return false;
  }

  const selectedAssociation = detectedDetail.candidateAssociation;
  return !selectedAssociation || selectedAssociation.cardId !== recentAssociation.cardId;
}

function findExactExposureAssociationForDetailPayload(payload = {}, page = {}) {
  const candidate = payload?.candidate || null;
  if (!candidate?.stableId || !page?.url || !page?.pageType) {
    return null;
  }

  return getCandidateCardAssociationByExposure({
    candidate,
    listUrl: page.url,
    listPageType: page.pageType
  });
}

function buildAssociationFromActiveDetailPayload(payload) {
  const candidate = payload?.candidate || null;
  if (!candidate?.candidateId) {
    return null;
  }
  return {
    cardId: candidate.candidateId,
    exposureKey: candidate.exposureKey || "",
    exposedEventId: candidate.exposedEventId || "",
    candidate
  };
}

function readCandidateDetailCanvasText(currentDocument, sourceUrl, readCanvasText) {
  if (!shouldReadCanvasDetailText(sourceUrl) || typeof readCanvasText !== "function") {
    return "";
  }

  try {
    return normalizeCanvasDetailText(readCanvasText(currentDocument));
  } catch {
    return "";
  }
}

function shouldReadCanvasDetailText(sourceUrl = "") {
  return isCandidateDetailUrl(sourceUrl);
}

function mergeDetailText(domText = "", canvasText = "") {
  const normalizedDomText = normalizeReadableDomText(domText);
  const normalizedCanvasText = normalizeCanvasDetailText(canvasText);
  if (!normalizedDomText) {
    return normalizedCanvasText;
  }
  if (
    normalizedCanvasText &&
    shouldTreatAsCanvasCandidateDetailText(normalizedCanvasText) &&
    !shouldTreatAsCandidateDetailText(normalizedDomText) &&
    !shouldTreatAsCanvasCandidateDetailText(normalizedDomText)
  ) {
    return normalizedCanvasText;
  }
  if (!normalizedCanvasText || normalizedDomText.includes(normalizedCanvasText)) {
    return normalizedDomText;
  }
  if (normalizedCanvasText.includes(normalizedDomText)) {
    return normalizedCanvasText;
  }

  return `${normalizedDomText}\n${normalizedCanvasText}`;
}

function normalizeCanvasDetailText(text = "") {
  return String(text || "")
    .split(/\n+/)
    .map((line) => normalizeText(line))
    .filter((line) => line && !isLikelyScriptText(line))
    .join("\n")
    .trim();
}

function buildDetailTextSources({
  domText = "",
  canvasText = "",
  bodyText = "",
  shouldUseOwnDetailText = false,
  candidateCard = null
} = {}) {
  return {
    domTextLength: normalizeText(domText).length,
    canvasTextLength: normalizeText(canvasText).length,
    combinedTextLength: normalizeText(bodyText).length,
    usedOwnDetailText: shouldUseOwnDetailText,
    candidateCardMatchedBy: candidateCard?.matchedBy || "",
    candidateCardTextLength: normalizeText(candidateCard?.text || "").length
  };
}

function findCandidateCardLikeAncestor(element) {
  let current = element;
  for (let steps = 0; current && steps < MAX_SELECTED_CARD_ANCESTOR_STEPS; steps += 1) {
    const text = readElementText(current);
    if (text.length > 0 && text.length <= 2200 && shouldTreatAsCandidateCardText(text)) {
      return current;
    }
    current = current.parentElement;
  }

  return null;
}

function splitCandidateListCardText(text) {
  const normalizedText = normalizeText(text);
  if (!normalizedText) {
    return [];
  }

  const lines = String(text)
    .split(/\n+/)
    .map((line) => normalizeText(line))
    .filter(Boolean);
  if (lines.length <= 1 && countTextOccurrences(normalizedText, "打招呼") > 1) {
    return splitInlineCandidateCardText(normalizedText);
  }

  const chunks = [];
  let buffer = [];

  for (const line of lines) {
    buffer.push(line);
    if (line.includes("打招呼")) {
      appendCandidateTextChunk(chunks, buffer.join("\n"));
      buffer = [];
    }
  }
  appendCandidateTextChunk(chunks, buffer.join("\n"));

  if (chunks.length > 0) {
    return chunks;
  }

  return splitInlineCandidateCardText(normalizedText);
}

function splitInlineCandidateCardText(normalizedText) {
  if (!normalizedText.includes("打招呼")) {
    return shouldTreatAsCandidateCardText(normalizedText) ? [normalizedText] : [];
  }

  const chunks = [];
  let offset = 0;
  let markerIndex = normalizedText.indexOf("打招呼", offset);
  while (markerIndex >= 0) {
    appendCandidateTextChunk(chunks, normalizedText.slice(offset, markerIndex + "打招呼".length));
    offset = markerIndex + "打招呼".length;
    markerIndex = normalizedText.indexOf("打招呼", offset);
  }
  appendCandidateTextChunk(chunks, normalizedText.slice(offset));
  return chunks.length > 0 ? chunks : (shouldTreatAsCandidateCardText(normalizedText) ? [normalizedText] : []);
}

function appendCandidateTextChunk(chunks, text) {
  const normalizedText = normalizeText(text);
  const cleanText = normalizeSelectedCandidateCardText(normalizedText);
  if (
    !cleanText ||
    !shouldTreatAsCandidateCardText(normalizedText) ||
    chunks.includes(cleanText)
  ) {
    return;
  }

  chunks.push(cleanText);
}

function normalizeSelectedCandidateCardText(text = "") {
  let result = normalizeText(text);
  const nextRecommendationIndex = findNextRecommendationCandidateIndex(result);
  if (nextRecommendationIndex > 0) {
    result = result.slice(0, nextRecommendationIndex).trim();
  }

  const detailActionIndex = result.search(/\s收藏\s+不合适\s+举报\s+转发牛人(?:\s|$)/);
  if (detailActionIndex > 0) {
    result = result.slice(0, detailActionIndex).trim();
  }

  return result;
}

function findNextRecommendationCandidateIndex(text = "") {
  const patterns = [
    /\s[\u4e00-\u9fa5A-Za-z][^\s]{0,10}\*\*\s+热搜\s+\d{2}岁/,
    /\s[\u4e00-\u9fa5A-Za-z][^\s]{1,12}\s+热搜\s+\d{2}岁/
  ];
  return patterns.reduce((bestIndex, pattern) => {
    const match = text.match(pattern);
    if (!match || match.index === undefined) {
      return bestIndex;
    }
    const index = match.index + 1;
    return bestIndex < 0 ? index : Math.min(bestIndex, index);
  }, -1);
}

function scoreSelectedCandidateCard(element, text) {
  const classText = String(element?.className || "");
  const selectedClassBonus = /(?:active|selected|current|cur|checked|focus)/i.test(classText) ? 20 : 0;
  const ariaBonus = element?.getAttribute?.("aria-selected") === "true" ? 20 : 0;
  const signalCount = detectCandidateSignals(normalizeText(text)).length;
  return selectedClassBonus + ariaBonus + signalCount * 10;
}

function scoreCandidateCardAgainstDetail(cardText, detailText) {
  const normalizedDetailText = normalizeText(detailText);
  return extractDetailMatchTokens(cardText)
    .reduce((score, token) => {
      if (!normalizedDetailText.includes(token)) {
        return score;
      }
      return score + Math.min(12, token.length * 2);
    }, 0);
}

function extractDetailMatchTokens(text) {
  return Array.from(new Set(
    normalizeText(text)
      .split(/[^\u4e00-\u9fa5A-Za-z0-9]+/)
      .map((token) => token.trim())
      .filter((token) => token.length >= 2)
      .filter((token) => !/^\d+$/.test(token))
      .filter((token) => !/\d+岁|\d+年|^\d+-\d+K$/i.test(token))
      .filter((token) => !COMMON_DETAIL_MATCH_TOKENS.has(token))
  ));
}

export function shouldTreatAsCandidateDetailText(text = "") {
  const normalizedText = normalizeText(text);
  if (normalizedText.length < MIN_DETAIL_TEXT_LENGTH || normalizedText.length > MAX_DETAIL_TEXT_LENGTH) {
    return false;
  }

  const signals = detectCandidateDetailSignals(normalizedText);
  const hasCandidateProfileSignal = signals.includes("age") ||
    signals.includes("salary") ||
    signals.includes("expectation");
  const sectionCount = signals.filter((signal) => signal.endsWith("_section")).length;
  const hasDetailActionSignal = signals.includes("detail_actions");
  const hasCoreDetailSection = signals.includes("advantage_section") ||
    signals.includes("work_experience_section") ||
    signals.includes("project_section") ||
    signals.includes("certificate_section") ||
    signals.includes(BOSS_ANALYSIS_SIGNAL);
  return hasCandidateProfileSignal && sectionCount >= 2 && hasDetailActionSignal && hasCoreDetailSection;
}

function shouldTreatAsCanvasCandidateDetailText(text = "") {
  const normalizedText = normalizeText(text);
  if (normalizedText.length < MIN_DETAIL_TEXT_LENGTH || normalizedText.length > MAX_DETAIL_TEXT_LENGTH) {
    return false;
  }

  const signals = detectCandidateDetailSignals(normalizedText);
  const hasCandidateProfileSignal = signals.includes("age") ||
    signals.includes("salary") ||
    signals.includes("expectation");
  const sectionCount = signals.filter((signal) => signal.endsWith("_section")).length;
  const hasCoreDetailSection = signals.includes("advantage_section") ||
    signals.includes("work_experience_section") ||
    signals.includes("education_section") ||
    signals.includes("project_section") ||
    signals.includes("certificate_section") ||
    signals.includes(BOSS_ANALYSIS_SIGNAL);
  return hasCandidateProfileSignal && sectionCount >= 2 && hasCoreDetailSection;
}

export function detectCandidateDetailSignals(normalizedText = "", detailUrl = "") {
  const signals = [...detectCandidateSignals(normalizedText)];
  if (detailUrl && isCandidateDetailUrl(detailUrl)) {
    signals.push("detail_url");
  }

  DETAIL_SECTION_SIGNAL_RULES.forEach(([signal, labels]) => {
    if (labels.some((label) => normalizedTextIncludesLabel(normalizedText, label))) {
      signals.push(signal);
    }
  });

  return Array.from(new Set(signals));
}

function normalizedTextIncludesLabel(normalizedText = "", label = "") {
  const normalizedLabel = normalizeText(label);
  if (!normalizedLabel) {
    return false;
  }
  return normalizedText.includes(normalizedLabel) ||
    compactSignalText(normalizedText).includes(compactSignalText(normalizedLabel));
}

function compactSignalText(text = "") {
  return normalizeText(text).replace(/\s+/g, "");
}

function shouldExtractDetailProfileForDetectedSource(detectedBy = "") {
  return detectedBy !== "c_resume_selected_card";
}

export function extractCandidateDetailProfile(text = "") {
  const lines = normalizeDetailLines(text);
  const profile = extractCandidateProfile(text);
  const sections = {};

  DETAIL_SUMMARY_SECTIONS.forEach((section) => {
    sections[section.key] = extractDetailSectionSummary(lines, section, {
      displayName: profile.displayName
    });
  });

  return {
    topSummary: extractDetailTopSummary(lines, profile),
    overview: extractDetailOverview(lines),
    bossAnalysis: extractBossAnalysisSummary(lines),
    sections,
    sectionKeys: Object.entries(sections)
      .filter(([, value]) => value.present)
      .map(([key]) => key)
  };
}

function emptyDetailProfile() {
  const sections = {};
  DETAIL_SUMMARY_SECTIONS.forEach((section) => {
    sections[section.key] = emptySectionSummary();
  });

  return {
    topSummary: {
      present: false,
      items: []
    },
    overview: {
      present: false,
      items: []
    },
    bossAnalysis: {
      present: false,
      title: "",
      items: [],
      actionText: ""
    },
    sections,
    sectionKeys: []
  };
}

function extractDetailTopSummary(lines, profile) {
  const items = [];
  for (const line of lines) {
    if (matchesAnyLabel(line, DETAIL_MAJOR_SECTION_LABELS)) {
      break;
    }

    const normalized = normalizeTopSummaryLine(line);
    if (!normalized || shouldSkipTopSummaryLine(normalized, profile)) {
      continue;
    }

    items.push(truncateDetailSummaryLine(normalized));
    if (items.length >= DETAIL_SECTION_ITEM_LIMIT) {
      break;
    }
  }

  return {
    present: items.length > 0,
    items
  };
}

function extractBossAnalysisSummary(lines) {
  const startLine = findBossAnalysisStartLine(lines);
  if (!startLine) {
    return {
      present: false,
      title: "",
      items: [],
      actionText: ""
    };
  }

  const items = [];
  let actionText = "";
  const inlineContent = normalizeBossAnalysisLine(startLine.content);
  if (inlineContent) {
    items.push(truncateDetailSummaryLine(inlineContent));
  }
  for (let index = startLine.index + 1; index < lines.length; index += 1) {
    const line = normalizeBossAnalysisLine(lines[index]);
    if (!line) {
      continue;
    }
    const nextActionText = normalizeBossAnalysisActionText(line);
    if (nextActionText) {
      actionText = nextActionText;
      continue;
    }
    if (isBossAnalysisStopLine(line)) {
      break;
    }

    items.push(truncateDetailSummaryLine(line));
    if (items.length >= BOSS_ANALYSIS_ITEM_LIMIT) {
      break;
    }
  }

  return {
    present: true,
    title: startLine.title,
    items,
    actionText
  };
}

function findBossAnalysisStartLine(lines) {
  for (let index = 0; index < lines.length; index += 1) {
    const line = normalizeText(lines[index]);
    const match = line.match(/牛人分析器?/);
    if (match) {
      return {
        index,
        title: match[0] === "牛人分析器" ? "牛人分析器" : "牛人分析",
        content: line.slice(match.index + match[0].length).replace(/^[：:\s]+/, "")
      };
    }

    const compactLine = compactSignalText(line);
    if (compactLine.includes("牛人分析器")) {
      return {
        index,
        title: "牛人分析器",
        content: ""
      };
    }
    if (compactLine.includes("牛人分析")) {
      return {
        index,
        title: "牛人分析",
        content: ""
      };
    }
  }

  return null;
}

function findCandidateDetailContainer(currentDocument) {
  const elements = uniqueElements([
    currentDocument.body,
    currentDocument.querySelector?.("main"),
    ...Array.from(currentDocument.querySelectorAll?.(DETAIL_CONTAINER_SELECTOR) || [])
  ]).filter(Boolean);

  const candidates = elements
    .filter((element) => isElementVisible(element))
    .map((element) => ({
      element,
      text: readElementText(element),
      isBroadPageContainer: element === currentDocument.body ||
        element === currentDocument.documentElement ||
        element === currentDocument.querySelector?.("main")
    }))
    .filter((candidate) => shouldTreatAsCandidateDetailText(candidate.text))
    .sort((left, right) => scoreDetailContainerCandidate(right) - scoreDetailContainerCandidate(left));

  return candidates[0]?.element || null;
}

function scoreDetailCandidate(text, sourceUrl = "") {
  const signals = detectCandidateDetailSignals(normalizeText(text), sourceUrl);
  return signals.length;
}

function scoreDetailContainerCandidate(candidate) {
  const normalizedText = normalizeText(candidate.text);
  const signals = detectCandidateDetailSignals(normalizedText);
  const sectionCount = signals.filter((signal) => signal.endsWith("_section")).length;
  const greetCount = countTextOccurrences(normalizedText, "打招呼");
  const broadContainerPenalty = candidate.isBroadPageContainer ? 30 : 0;
  const listNoisePenalty = Math.max(0, greetCount - 1) * 20 +
    countCandidateListNoiseSignals(normalizedText) * 8;
  const lengthPenalty = Math.min(80, Math.floor(normalizedText.length / 500));
  const focusedContainerBonus = isLikelyFocusedDetailContainer(candidate.element) ? 24 : 0;

  return signals.length * 20 +
    sectionCount * 10 +
    focusedContainerBonus -
    broadContainerPenalty -
    listNoisePenalty -
    lengthPenalty;
}

function scoreDetailRichness(payload) {
  const candidate = payload?.candidate || {};
  const detailProfile = candidate.detailProfile || {};
  const sectionItemCount = countDetailProfileItems(detailProfile);
  const sectionKeyCount = Array.isArray(detailProfile.sectionKeys) ? detailProfile.sectionKeys.length : 0;
  return sectionKeyCount * 2 + sectionItemCount * 2;
}

function hasBossAnalysisSignal(payload) {
  return payload?.analysis?.module === "boss_analysis" ||
    Boolean(compactBossAnalysis(payload?.candidate?.detailProfile?.bossAnalysis));
}

function hasBossAnalysisModuleSignal(text = "") {
  return detectCandidateDetailSignals(normalizeText(text)).includes(BOSS_ANALYSIS_SIGNAL);
}

function countDetailProfileItems(detailProfile) {
  return Object.values(detailProfile?.sections || {})
    .reduce((total, section) => total + (Array.isArray(section?.items) ? section.items.length : 0), 0);
}

function countCoreDetailProfileItems(detailProfile) {
  return Object.entries(detailProfile?.sections || {})
    .filter(([key]) => CORE_DETAIL_SECTION_KEYS.has(key))
    .reduce((total, [, section]) => total + (Array.isArray(section?.items) ? section.items.length : 0), 0);
}

function collectAccessibleDocuments(rootDocument) {
  const documents = [];
  const visited = new Set();
  collectAccessibleDocument(rootDocument, null, 0, documents, visited);
  return documents;
}

function collectAccessibleDocument(currentDocument, frameElement, depth, documents, visited) {
  if (!currentDocument || visited.has(currentDocument)) {
    return;
  }

  visited.add(currentDocument);
  documents.push({
    document: currentDocument,
    frameElement
  });

  if (depth >= MAX_ACCESSIBLE_FRAME_DEPTH) {
    return;
  }

  currentDocument.querySelectorAll?.("iframe").forEach((frame) => {
    try {
      if (frame.contentDocument && isElementVisible(frame)) {
        collectAccessibleDocument(frame.contentDocument, frame, depth + 1, documents, visited);
      }
    } catch {
      // Cross-origin frames are ignored; BOSS candidate frames observed so far are same-origin.
    }
  });
}

function buildDetailFingerprintText(normalizedText) {
  const anchorIndex = findFirstDetailAnchorIndex(normalizedText);
  if (anchorIndex < 0) {
    return normalizedText.slice(0, DETAIL_FINGERPRINT_TEXT_LENGTH);
  }

  return normalizedText
    .slice(Math.max(0, anchorIndex - 160), anchorIndex + DETAIL_FINGERPRINT_TEXT_LENGTH)
    .trim();
}

function findFirstDetailAnchorIndex(normalizedText) {
  const anchors = [
    "收藏",
    "经历概览",
    "工作经历",
    "教育经历",
    "求职期望",
    "期望职位"
  ];
  return anchors.reduce((bestIndex, anchor) => {
    const index = normalizedText.indexOf(anchor);
    if (index < 0) {
      return bestIndex;
    }
    return bestIndex < 0 ? index : Math.min(bestIndex, index);
  }, -1);
}

function readMergedDataset(element) {
  const merged = {};
  let current = element;
  for (let steps = 0; current && steps < MAX_DATASET_ANCESTOR_STEPS; steps += 1) {
    Object.assign(merged, current.dataset || {});
    current = current.parentElement;
  }
  return merged;
}

function readLinks(element) {
  return Array.from(element?.querySelectorAll?.("a[href]") || [])
    .map((link) => link.href)
    .filter(Boolean);
}

function readElementText(element) {
  const chunks = [];
  const innerText = normalizeReadableDomText(element?.innerText || "");
  if (innerText) {
    pushUniqueTextChunk(chunks, innerText);
  } else {
    pushUniqueTextChunk(chunks, readVisibleTextNodes(element));
    if (!chunks.length) {
      pushUniqueTextChunk(chunks, normalizeReadableDomText(element?.textContent || ""));
    }
  }

  for (const current of collectAuxiliaryTextElements(element)) {
    for (const attribute of AUXILIARY_TEXT_ATTRIBUTES) {
      pushUniqueTextChunk(chunks, current.getAttribute?.(attribute) || "");
    }
  }

  return chunks.join("\n")
    .replace(/[ \t\f\v\r]+/g, " ")
    .replace(/\n\s+/g, "\n")
    .trim();
}

function isElementVisible(element) {
  if (!element?.getBoundingClientRect) {
    return true;
  }

  const rect = element.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0 && !hasRawElementText(element)) {
    return false;
  }

  const view = element.ownerDocument?.defaultView || globalThis;
  return rect.bottom >= 0 &&
    rect.right >= 0 &&
    rect.top <= (view.innerHeight || Number.MAX_SAFE_INTEGER) &&
    rect.left <= (view.innerWidth || Number.MAX_SAFE_INTEGER);
}

function normalizeReadableDomText(value) {
  return String(value || "")
    .split(/\n+/)
    .map((line) => normalizeText(line))
    .filter((line) => !isLikelyScriptText(line))
    .join("\n")
    .trim();
}

function readVisibleTextNodes(element) {
  const document = element?.ownerDocument;
  if (!document?.createTreeWalker) {
    return "";
  }

  const view = document.defaultView || globalThis;
  const nodeFilter = view.NodeFilter || globalThis.NodeFilter || {};
  const walker = document.createTreeWalker(
    element,
    nodeFilter.SHOW_TEXT || 4,
    {
      acceptNode(node) {
        const text = normalizeText(node?.nodeValue || "");
        if (!text || isLikelyScriptText(text) || !isReadableTextNode(node)) {
          return nodeFilter.FILTER_REJECT || 2;
        }
        return nodeFilter.FILTER_ACCEPT || 1;
      }
    }
  );
  const chunks = [];
  let current = walker.nextNode();
  while (current) {
    pushUniqueTextChunk(chunks, current.nodeValue || "");
    current = walker.nextNode();
  }
  return chunks.join("\n");
}

function isReadableTextNode(node) {
  const element = node?.parentElement;
  if (!element || shouldSkipTextNodeParent(element) || isElementHiddenForTextRead(element)) {
    return false;
  }

  const document = element.ownerDocument;
  if (document?.createRange) {
    try {
      const range = document.createRange();
      range.selectNodeContents(node);
      const rects = Array.from(range.getClientRects?.() || []);
      range.detach?.();
      if (rects.length > 0) {
        return rects.some((rect) => isRectInViewport(rect, document.defaultView || globalThis));
      }
    } catch {
      // Fall through to the element box check below.
    }
  }

  return isElementBoxInViewport(element);
}

function shouldSkipTextNodeParent(element) {
  let current = element;
  while (current) {
    if (SKIPPED_TEXT_NODE_PARENT_TAGS.has(String(current.tagName || "").toUpperCase())) {
      return true;
    }
    current = current.parentElement;
  }
  return false;
}

function isElementHiddenForTextRead(element) {
  if (element.getAttribute?.("aria-hidden") === "true" || element.hidden === true) {
    return true;
  }

  const view = element.ownerDocument?.defaultView || globalThis;
  const style = view.getComputedStyle?.(element);
  return style?.display === "none" ||
    style?.visibility === "hidden" ||
    style?.visibility === "collapse" ||
    style?.opacity === "0";
}

function isElementBoxInViewport(element) {
  if (!element?.getBoundingClientRect) {
    return true;
  }

  return isRectInViewport(
    element.getBoundingClientRect(),
    element.ownerDocument?.defaultView || globalThis
  );
}

function isRectInViewport(rect, view) {
  if (!rect || (rect.width === 0 && rect.height === 0)) {
    return false;
  }

  return rect.bottom >= 0 &&
    rect.right >= 0 &&
    rect.top <= (view.innerHeight || Number.MAX_SAFE_INTEGER) &&
    rect.left <= (view.innerWidth || Number.MAX_SAFE_INTEGER);
}

function hasRawElementText(element) {
  return Boolean(String(element?.innerText || element?.textContent || "").trim());
}

function isDocumentFrameVisible(frameElement) {
  return !frameElement || isElementVisible(frameElement);
}

function isLikelyFocusedDetailContainer(element) {
  const classText = String(element?.className || "");
  return /(?:detail|resume|c-resume|profile|geek)/i.test(classText);
}

function countTextOccurrences(text, needle) {
  if (!text || !needle) {
    return 0;
  }
  return text.split(needle).length - 1;
}


function countCandidateListNoiseSignals(normalizedText) {
  return [
    "相似经历",
    "热搜",
    "推荐",
    "在线牛人",
    "看过"
  ].reduce((count, signal) => count + countTextOccurrences(normalizedText, signal), 0);
}

function uniqueElements(elements) {
  return Array.from(new Set(elements.filter(Boolean)));
}

function extractDetailOverview(lines) {
  const items = [];
  for (const line of lines) {
    const match = line.match(/^(经历|院校)[:：]\s*(.+)$/);
    if (!match) {
      continue;
    }

    const sanitized = sanitizeDetailSummaryLine(`${match[1]}：${match[2]}`);
    if (sanitized) {
      items.push(truncateDetailSummaryLine(sanitized));
    }
  }

  return {
    present: items.length > 0,
    items: items.slice(0, DETAIL_SECTION_ITEM_LIMIT)
  };
}

function extractDetailSectionSummary(lines, section, {
  displayName = ""
} = {}) {
  const startIndex = findSectionLabelIndex(lines, section.labels);
  if (startIndex < 0) {
    return emptySectionSummary();
  }

  const items = [];
  const inlineContent = extractInlineSectionContent(lines[startIndex], section.labels);
  if (section.key !== "advantage") {
    appendDetailSectionItem(items, inlineContent, section, { displayName });
  }

  for (let index = startIndex + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (matchesAnyLabel(line, section.stopLabels)) {
      break;
    }

    appendDetailSectionItem(items, line, section, { displayName });
    if (items.length >= DETAIL_SECTION_ITEM_LIMIT) {
      break;
    }
  }

  return {
    present: true,
    items
  };
}

function normalizeDetailLines(text = "") {
  const rawLines = String(text).split(/\n+/).map((line) => line.trim()).filter(Boolean);
  if (rawLines.length > 1) {
    return rawLines.map((line) => normalizeText(line)).filter(Boolean);
  }

  return splitInlineDetailSections(normalizeText(text));
}

function splitInlineDetailSections(normalizedText) {
  if (!normalizedText) {
    return [];
  }

  const allLabels = Array.from(new Set(DETAIL_SUMMARY_SECTIONS.flatMap((section) => [
    ...section.labels,
    ...section.stopLabels
  ])));
  const pattern = new RegExp(`\\s+(${allLabels.map(escapeRegExp).join("|")})(?:\\s*[：:]\\s*|\\s+)`, "g");
  return normalizedText
    .replace(pattern, "\n$1\n")
    .split(/\n+/)
    .map((line) => normalizeText(line))
    .filter(Boolean);
}

function findSectionLabelIndex(lines, labels) {
  return lines.findIndex((line) => matchesAnyLabel(line, labels));
}

function matchesAnyLabel(line, labels) {
  return labels.some((label) => line === label || line.startsWith(`${label} `) || line.startsWith(`${label}：`));
}

function extractInlineSectionContent(line, labels) {
  for (const label of labels) {
    if (line === label) {
      return "";
    }
    if (line.startsWith(`${label} `)) {
      return line.slice(label.length).trim();
    }
    if (line.startsWith(`${label}：`) || line.startsWith(`${label}:`)) {
      return line.slice(label.length + 1).trim();
    }
  }

  return "";
}

function appendDetailSectionItem(items, line, section, { displayName }) {
  const sanitized = sanitizeDetailSummaryLine(line);
  if (
    !sanitized ||
    matchesAnyLabel(sanitized, section.labels) ||
    shouldSkipDetailSectionLine(sanitized, { displayName })
  ) {
    return;
  }

  items.push(truncateDetailSummaryLine(sanitized));
}

function shouldSkipDetailSectionLine(line, { displayName = "" } = {}) {
  if (displayName && line === displayName) {
    return true;
  }

  if (/^(?:经历|院校)[:：]/.test(line)) {
    return true;
  }

  if (/^(?:推荐|热搜|其他|相似经历|在线牛人)$/.test(line)) {
    return true;
  }

  if (/^(?:收藏|不合适|举报|转发牛人|打招呼)(?:\s|$)/.test(line)) {
    return true;
  }

  return false;
}

function normalizeTopSummaryLine(line) {
  return sanitizeDetailSummaryLine(
    String(line || "")
      .replace(/^(?:[•·\-]|\d+[.、])\s*/, "")
      .replace(/^具备工作能力[：:]\s*/, "具备工作能力：")
      .replace(/^性格优点[：:]\s*/, "性格优点：")
  );
}

function shouldSkipTopSummaryLine(line, profile = {}) {
  if (!line) {
    return true;
  }

  if (line === profile.displayName || line === profile.activeStatus) {
    return true;
  }

  if (profile.displayName && line.startsWith(profile.displayName)) {
    return true;
  }

  if (profile.activeStatus && line.includes(profile.activeStatus)) {
    return true;
  }

  if (line.includes("岁") && line.includes(profile.education || "__missing__")) {
    return true;
  }

  if (/^(?:推荐|热搜|其他|相似经历|在线牛人)$/.test(line)) {
    return true;
  }

  if (/^(?:收藏|不合适|举报|转发牛人|打招呼)(?:\s|$)/.test(line)) {
    return true;
  }

  return line.length < 8;
}

function normalizeBossAnalysisLine(line) {
  return sanitizeDetailSummaryLine(
    String(line || "")
      .replace(/^[•·\-]\s*/, "")
      .replace(/\s+/g, " ")
      .trim()
  );
}

function normalizeBossAnalysisActionText(line) {
  const normalized = normalizeText(line);
  if (/^查看全部\s*\d+\s*项分析$/.test(normalized)) {
    return normalized;
  }
  const compact = compactSignalText(normalized);
  const match = compact.match(/^查看全部(\d+)项分析$/);
  return match ? `查看全部${match[1]}项分析` : "";
}

function isBossAnalysisStopLine(line) {
  return line.startsWith("为受善保护牛人在BOSS直聘平台提交") ||
    line.startsWith("为妥善保护牛人在BOSS直聘平台提交") ||
    line.startsWith("任何用户不得将牛人") ||
    line.includes("个人信息") ||
    matchesAnyLabel(line, ["工作经历", "教育经历", "项目经历", "资格证书", "期望职位", "求职期望"]);
}

function sanitizeDetailSummaryLine(line) {
  const normalized = normalizeText(line);
  if (!normalized || CONTACT_TEXT_PATTERN.test(normalized) || isLikelyScriptText(normalized)) {
    return "";
  }

  return normalized
    .replace(/1[3-9]\d{9}/g, "[redacted_phone]")
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "[redacted_email]")
    .trim();
}

function isLikelyScriptText(line) {
  return /^!function\s*\(/.test(line) ||
    /^function\s*\(/.test(line) ||
    line.includes("document.createElement(\"script\")") ||
    line.includes("document.createElement('script')") ||
    line.includes("webpackJsonp") ||
    line.includes("__webpack");
}

function truncateDetailSummaryLine(line) {
  if (line.length <= DETAIL_SUMMARY_MAX_CHARS) {
    return line;
  }

  return `${line.slice(0, DETAIL_SUMMARY_MAX_CHARS)}...`;
}

function emptySectionSummary() {
  return {
    present: false,
    items: []
  };
}

function collectAuxiliaryTextElements(element) {
  if (!element) {
    return [];
  }

  const elements = [element];
  try {
    elements.push(...Array.from(element.querySelectorAll?.(AUXILIARY_TEXT_SELECTOR) || [])
      .slice(0, AUXILIARY_TEXT_ELEMENT_LIMIT));
  } catch {
    // Some test doubles or transient DOM nodes may not support complex selectors.
  }
  return elements;
}

function pushUniqueTextChunk(chunks, value) {
  const text = String(value || "")
    .replace(/[ \t\f\v\r]+/g, " ")
    .replace(/\n\s+/g, "\n")
    .trim();
  if (!text || chunks.some((chunk) => chunk === text || chunk.includes(text))) {
    return;
  }

  chunks.push(text);
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
