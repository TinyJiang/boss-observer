import {
  buildCandidateCardPayload,
  compactCandidateSnapshotPayload,
  compactPayloadObject,
  shouldTreatAsCandidateCardText
} from "./candidate-card.js";
import {
  buildCandidateExposureKey,
  getCandidateCardAssociationFromElement,
  recordCandidateCardInteractionFromElement,
  registerCandidateCardAssociation,
  updateCandidateCardAssociation
} from "./candidate-card-registry.js";
import { EVENT_TYPES } from "../shared/event-types.js";

const LIST_PAGE_TYPES = new Set([
  "candidate_recommend",
  "candidate_search",
  "candidate_intention",
  "candidate_interaction"
]);

const SCAN_INTERVAL_MS = 2000;
const MAX_ANCESTOR_STEPS = 7;
const MAX_CARD_TEXT_LENGTH = 2200;

// Responsibilities:
// - observe candidate list pages
// - emit fact events for list/card exposure
// - avoid storing full candidate resume or chat text
export class CandidateListProbe {
  constructor({
    collector,
    sessionContext,
    scanIntervalMs = SCAN_INTERVAL_MS,
    now = () => Date.now()
  }) {
    this.collector = collector;
    this.sessionContext = sessionContext;
    this.scanIntervalMs = scanIntervalMs;
    this.now = now;
    this.started = false;
    this.pollHandle = null;
    this.cardExposureKeys = new Set();
    this.observedDocuments = new Map();
  }

  start() {
    if (this.started) {
      return;
    }

    this.started = true;
    this.safeScan("start");
    this.pollHandle = globalThis.setInterval(() => this.safeScan("poll"), this.scanIntervalMs);
  }

  stop() {
    if (!this.started) {
      return;
    }

    this.started = false;
    if (this.pollHandle !== null) {
      globalThis.clearInterval(this.pollHandle);
      this.pollHandle = null;
    }
    this.observedDocuments.forEach((listener, currentDocument) => {
      currentDocument.removeEventListener?.("click", listener, true);
    });
    this.observedDocuments.clear();
  }

  scan(source) {
    if (!isCandidateListPage(this.sessionContext.page)) {
      return;
    }

    this.attachAvailableDocuments();

    const cards = findCandidateCards(document);
    cards.forEach((card, index) => {
      this.ensureCandidateCardAssociation({ card, index, source });
    });
  }

  attachAvailableDocuments() {
    if (!globalThis.document) {
      return;
    }

    collectAccessibleDocuments(globalThis.document).forEach((currentDocument) => {
      if (this.observedDocuments.has(currentDocument)) {
        return;
      }

      const listener = (event) => this.handleDocumentClick(event, currentDocument);
      currentDocument.addEventListener?.("click", listener, true);
      this.observedDocuments.set(currentDocument, listener);
    });
  }

  handleDocumentClick(event, currentDocument) {
    const targetElement = event?.target;
    const cardElement = findCandidateCardAncestor(targetElement || event?.target);
    if (!cardElement) {
      return;
    }

    const sourceUrl = currentDocument?.location?.href || globalThis.location?.href || "";
    const existingAssociation = getCandidateCardAssociationFromElement(cardElement);
    const association = existingAssociation || this.ensureCandidateCardAssociation({
      card: {
        element: cardElement,
        sourceUrl,
        visibleRatio: estimateVisibleRatio(cardElement)
      },
      index: null,
      source: "click"
    });

    if (association) {
      recordCandidateCardInteractionFromElement(cardElement, {
        interactionType: "candidate_card_click",
        sourceUrl,
        now: this.now
      });
    }
  }

  ensureCandidateCardAssociation({ card, index = null, source = "poll" } = {}) {
    const payload = buildCandidateCardPayload({
      text: card.element.innerText || card.element.textContent || "",
      dataset: readMergedDataset(card.element),
      links: readLinks(card.element),
      sourceUrl: card.sourceUrl,
      cardIndex: index,
      visibleRatio: card.visibleRatio
    });
    const listUrl = this.sessionContext.page.url;
    const listPageType = this.sessionContext.page.pageType;
    const exposureKey = buildCandidateExposureKey({
      candidate: payload.candidate,
      listUrl,
      listPageType
    });
    const association = registerCandidateCardAssociation({
      element: card.element,
      candidate: payload.candidate,
      exposure: payload.exposure,
      listUrl,
      listPageType,
      sourceUrl: card.sourceUrl,
      now: this.now
    });
    if (this.cardExposureKeys.has(exposureKey)) {
      return association;
    }

    this.cardExposureKeys.add(exposureKey);
    const event = this.collector.collect(EVENT_TYPES.CANDIDATE_CARD_EXPOSED, compactPayloadObject({
      source,
      listUrl,
      listPageType,
      candidate: compactCandidateSnapshotPayload(association.candidate),
      exposure: payload.exposure
    }));

    if (event?.id) {
      return updateCandidateCardAssociation(association.cardId, { exposedEventId: event.id }) || association;
    }

    return association;
  }

  safeScan(source) {
    try {
      this.scan(source);
    } catch (error) {
      this.collector.collect(EVENT_TYPES.PLUGIN_EXCEPTION, {
        source: `candidate_list:${source}`,
        message: error instanceof Error ? error.message : String(error)
      });
    }
  }
}

export function isCandidateListPage(page) {
  return Boolean(page?.isBossPage && LIST_PAGE_TYPES.has(page.pageType));
}

export function findCandidateCards(rootDocument) {
  const documents = collectAccessibleDocuments(rootDocument);
  const cards = [];
  const seen = new Set();

  documents.forEach((currentDocument) => {
    // TODO(real BOSS validation): replace this text-anchor heuristic with stable BOSS card selectors
    // after confirming the production DOM structure across recommend/search/intention pages.
    currentDocument.querySelectorAll("button, a").forEach((action) => {
      if (!normalizeElementText(action).includes("打招呼")) {
        return;
      }

      const candidate = findCandidateCardAncestor(action);
      if (!candidate || seen.has(candidate)) {
        return;
      }

      seen.add(candidate);
      if (!isElementVisible(candidate)) {
        return;
      }

      cards.push({
        element: candidate,
        sourceUrl: currentDocument.location?.href || globalThis.location?.href || "",
        visibleRatio: estimateVisibleRatio(candidate)
      });
    });
  });

  return cards;
}

export function findCandidateCardAncestor(element) {
  let current = element;
  for (let steps = 0; current && steps < MAX_ANCESTOR_STEPS; steps += 1) {
    const text = normalizeElementText(current);
    if (text.length > 0 && text.length <= MAX_CARD_TEXT_LENGTH && shouldTreatAsCandidateCardText(text)) {
      return current;
    }
    current = current.parentElement;
  }

  return null;
}

function collectAccessibleDocuments(rootDocument) {
  const documents = [rootDocument];
  rootDocument.querySelectorAll("iframe").forEach((frame) => {
    try {
      if (frame.contentDocument) {
        documents.push(frame.contentDocument);
      }
    } catch {
      // Cross-origin frames are ignored; BOSS candidate frames observed so far are same-origin.
    }
  });
  return documents;
}

function readMergedDataset(element) {
  const merged = {};
  let current = element;
  for (let steps = 0; current && steps < MAX_ANCESTOR_STEPS; steps += 1) {
    Object.assign(merged, current.dataset || {});
    current = current.parentElement;
  }
  return merged;
}

function readLinks(element) {
  return Array.from(element.querySelectorAll("a[href]"))
    .map((link) => link.href)
    .filter(Boolean);
}

function normalizeElementText(element) {
  return String(element?.innerText || element?.textContent || "").replace(/\s+/g, " ").trim();
}

function isElementVisible(element) {
  const rect = element.getBoundingClientRect();
  const view = element.ownerDocument.defaultView || globalThis;
  return rect.width > 0 &&
    rect.height > 0 &&
    rect.bottom > 0 &&
    rect.right > 0 &&
    rect.top < view.innerHeight &&
    rect.left < view.innerWidth;
}

function estimateVisibleRatio(element) {
  const rect = element.getBoundingClientRect();
  const view = element.ownerDocument.defaultView || globalThis;
  const visibleWidth = Math.max(0, Math.min(rect.right, view.innerWidth) - Math.max(rect.left, 0));
  const visibleHeight = Math.max(0, Math.min(rect.bottom, view.innerHeight) - Math.max(rect.top, 0));
  const area = rect.width * rect.height;
  if (area <= 0) {
    return 0;
  }
  return Number(((visibleWidth * visibleHeight) / area).toFixed(3));
}
