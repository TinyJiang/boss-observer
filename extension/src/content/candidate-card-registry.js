export const CANDIDATE_ID_ATTRIBUTE = "data-boss-observer-candidate-id";

const DEFAULT_RECENT_INTERACTION_TTL_MS = 30000;
const CANDIDATE_ID_PREFIX = "bo_candidate";
const LEGACY_CANDIDATE_CARD_ID_ATTRIBUTE = "data-boss-observer-card-id";

const associationsByCardId = new Map();
const cardIdsByExposureKey = new Map();
let recentInteraction = null;
let recentDetailInteraction = null;

export function registerCandidateCardAssociation({
  element,
  candidate,
  exposure = {},
  listUrl = "",
  listPageType = "",
  sourceUrl = "",
  exposedEventId = "",
  now = () => Date.now()
} = {}) {
  const exposureKey = buildCandidateExposureKey({
    candidate,
    listUrl,
    listPageType
  });
  const elementCardId = readCardIdFromElement(element);
  const mappedExposureCardId = cardIdsByExposureKey.get(exposureKey);
  const mappedAssociation = findKnownAssociation(mappedExposureCardId);
  const elementAssociation = findKnownAssociation(elementCardId);
  const existingCardId = mappedAssociation?.cardId ||
    findReusableElementCardId({ elementAssociation, candidate, exposureKey });
  const existingAssociation = existingCardId ? associationsByCardId.get(existingCardId) : null;
  const cardId = existingCardId || createCardId(candidate, exposureKey);
  const nextExposedEventId = exposedEventId || existingAssociation?.exposedEventId || "";
  const association = {
    cardId,
    exposureKey,
    exposedEventId: nextExposedEventId,
    candidate: attachCandidateCardAssociation(candidate, {
      cardId,
      exposureKey,
      exposedEventId: nextExposedEventId
    }),
    exposure: Object.keys(exposure || {}).length > 0 ? exposure : existingAssociation?.exposure || {},
    listUrl: listUrl || existingAssociation?.listUrl || "",
    listPageType: listPageType || existingAssociation?.listPageType || "",
    sourceUrl: sourceUrl || existingAssociation?.sourceUrl || "",
    lastSeenAtMs: now()
  };

  associationsByCardId.set(cardId, association);
  cardIdsByExposureKey.set(exposureKey, cardId);
  writeCardIdToElement(element, cardId);
  return association;
}

export function updateCandidateCardAssociation(cardId, updates = {}) {
  const association = associationsByCardId.get(cardId);
  if (!association) {
    return null;
  }

  const nextAssociation = {
    ...association,
    ...updates
  };
  nextAssociation.candidate = attachCandidateCardAssociation(
    updates.candidate || association.candidate,
    nextAssociation
  );
  associationsByCardId.set(cardId, nextAssociation);
  return nextAssociation;
}

export function getCandidateCardAssociationFromElement(element) {
  const cardId = findCardIdFromElementTree(element);
  return cardId ? associationsByCardId.get(cardId) || null : null;
}

export function getCandidateCardAssociationById(candidateId = "") {
  return candidateId ? associationsByCardId.get(candidateId) || null : null;
}

export function getCandidateCardAssociationByExposure({
  candidate = {},
  listUrl = "",
  listPageType = ""
} = {}) {
  const exposureKey = buildCandidateExposureKey({
    candidate,
    listUrl,
    listPageType
  });
  const cardId = cardIdsByExposureKey.get(exposureKey);
  return cardId ? associationsByCardId.get(cardId) || null : null;
}

export function recordCandidateCardInteractionFromElement(element, {
  interactionType = "click",
  sourceUrl = "",
  now = () => Date.now()
} = {}) {
  const association = getCandidateCardAssociationFromElement(element);
  if (!association) {
    return null;
  }

  return recordCandidateCardInteraction(association.cardId, {
    interactionType,
    sourceUrl,
    now
  });
}

export function recordCandidateCardInteraction(cardId, {
  interactionType = "click",
  sourceUrl = "",
  now = () => Date.now()
} = {}) {
  const association = associationsByCardId.get(cardId);
  if (!association) {
    return null;
  }

  recentInteraction = {
    cardId: association.cardId,
    interactionType,
    sourceUrl,
    occurredAtMs: now()
  };
  rememberRecentDetailInteractionIfNeeded(recentInteraction);
  return association;
}

export function rememberCandidateSnapshotAssociation({
  candidate = {},
  interactionType = "candidate_snapshot",
  sourceUrl = "",
  now = () => Date.now()
} = {}) {
  const cardId = candidate?.candidateId || "";
  if (!cardId) {
    return null;
  }

  const existingAssociation = associationsByCardId.get(cardId);
  const exposureKey = candidate.exposureKey || existingAssociation?.exposureKey || "";
  const exposedEventId = candidate.exposedEventId || existingAssociation?.exposedEventId || "";
  const seenAtMs = now();
  const association = {
    cardId,
    exposureKey,
    exposedEventId,
    candidate: attachCandidateCardAssociation(
      mergeCandidateSnapshots(existingAssociation?.candidate, candidate),
      { cardId, exposureKey, exposedEventId }
    ),
    exposure: existingAssociation?.exposure || {},
    listUrl: existingAssociation?.listUrl || "",
    listPageType: existingAssociation?.listPageType || "",
    sourceUrl: sourceUrl || existingAssociation?.sourceUrl || "",
    lastSeenAtMs: seenAtMs
  };

  associationsByCardId.set(cardId, association);
  if (exposureKey) {
    cardIdsByExposureKey.set(exposureKey, cardId);
  }

  recentInteraction = {
    cardId,
    interactionType,
    sourceUrl,
    occurredAtMs: seenAtMs
  };
  rememberRecentDetailInteractionIfNeeded(recentInteraction);
  return association;
}

export function getRecentCandidateCardAssociation({
  maxAgeMs = DEFAULT_RECENT_INTERACTION_TTL_MS,
  now = () => Date.now()
} = {}) {
  if (!recentInteraction || now() - recentInteraction.occurredAtMs > maxAgeMs) {
    return null;
  }

  return associationsByCardId.get(recentInteraction.cardId) || null;
}

export function getRecentCandidateCardInteraction({
  maxAgeMs = DEFAULT_RECENT_INTERACTION_TTL_MS,
  now = () => Date.now()
} = {}) {
  if (!recentInteraction || now() - recentInteraction.occurredAtMs > maxAgeMs) {
    return null;
  }

  const association = associationsByCardId.get(recentInteraction.cardId);
  if (!association) {
    return null;
  }

  return {
    ...recentInteraction,
    association
  };
}

export function getRecentCandidateDetailAssociation({
  maxAgeMs = DEFAULT_RECENT_INTERACTION_TTL_MS,
  now = () => Date.now()
} = {}) {
  if (!recentDetailInteraction || now() - recentDetailInteraction.occurredAtMs > maxAgeMs) {
    return null;
  }

  return associationsByCardId.get(recentDetailInteraction.cardId) || null;
}

export function clearRecentCandidateDetailAssociation({
  candidateId = ""
} = {}) {
  if (!recentDetailInteraction) {
    return;
  }
  if (candidateId && recentDetailInteraction.cardId !== candidateId) {
    return;
  }
  recentDetailInteraction = null;
}

export function attachCandidateCardAssociation(candidate = {}, association = {}) {
  return {
    ...(candidate || {}),
    candidateId: association.cardId || "",
    exposureKey: association.exposureKey || "",
    exposedEventId: association.exposedEventId || candidate?.exposedEventId || ""
  };
}

export function mergeCandidateSnapshotWithAssociation(candidate = {}, association = null) {
  if (!association) {
    return candidate || {};
  }

  const associatedCandidate = association.candidate || {};
  if (!isCandidateSnapshotCompatibleWithAssociation(candidate, association)) {
    return candidate || {};
  }

  const preferAssociationIdentity = shouldPreferAssociationIdentity(candidate, associatedCandidate);
  const identitySource = preferAssociationIdentity ? associatedCandidate : candidate;
  const mergedCandidate = {
    ...associatedCandidate,
    ...candidate,
    stableId: identitySource.stableId || candidate?.stableId || associatedCandidate.stableId || "",
    stableIdSource: identitySource.stableIdSource ||
      candidate?.stableIdSource ||
      associatedCandidate.stableIdSource ||
      "",
    detailUrl: candidate?.detailUrl || associatedCandidate.detailUrl || "",
    profile: mergeCandidateProfiles(associatedCandidate.profile, candidate?.profile)
  };

  return attachCandidateCardAssociation(mergedCandidate, association);
}

export function isCandidateSnapshotCompatibleWithAssociation(candidate = {}, association = null) {
  if (!association) {
    return true;
  }

  const associatedCandidate = association.candidate || {};
  if (!associatedCandidate.stableId) {
    return true;
  }

  if (hasSameStableIdentity(candidate, associatedCandidate)) {
    return true;
  }

  return !hasConflictingCandidateProfile(candidate.profile, associatedCandidate.profile);
}

export function clearCandidateCardRegistry() {
  associationsByCardId.clear();
  cardIdsByExposureKey.clear();
  recentInteraction = null;
  recentDetailInteraction = null;
}

export function buildCandidateExposureKey({
  candidate = {},
  listUrl = "",
  listPageType = ""
} = {}) {
  return [
    listPageType || "unknown_list",
    listUrl || "unknown_url",
    candidate.stableIdSource || "unknown_id_source",
    candidate.stableId || "unknown_id"
  ].join(":");
}

export function buildCandidateId(candidate = {}, fallbackKey = "") {
  const source = candidate?.stableIdSource || "unknown_id_source";
  const value = candidate?.stableId || fallbackKey || "unknown_id";
  const identity = `${source}:${value}`;
  return [
    CANDIDATE_ID_PREFIX,
    sanitizeIdentifierPart(source),
    sanitizeIdentifierPart(value),
    hashString(identity)
  ].filter(Boolean).join("_");
}

function createCardId(candidate = {}, exposureKey = "") {
  return buildCandidateId(candidate, exposureKey);
}

function findKnownCardId(cardId = "") {
  return cardId && associationsByCardId.has(cardId) ? cardId : "";
}

function findKnownAssociation(cardId = "") {
  const knownCardId = findKnownCardId(cardId);
  return knownCardId ? associationsByCardId.get(knownCardId) : null;
}

function findReusableElementCardId({ elementAssociation = null, candidate = {}, exposureKey = "" } = {}) {
  if (!elementAssociation) {
    return "";
  }

  if (elementAssociation.exposureKey === exposureKey) {
    return elementAssociation.cardId;
  }

  return isCandidateSnapshotCompatibleWithAssociation(candidate, elementAssociation) ?
    elementAssociation.cardId :
    "";
}

function sanitizeIdentifierPart(value = "") {
  return String(value)
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase()
    .slice(0, 48);
}

function hashString(input = "") {
  let hash = 5381;
  for (let index = 0; index < input.length; index += 1) {
    hash = (hash * 33) ^ input.charCodeAt(index);
  }
  return (hash >>> 0).toString(36);
}

function shouldPreferAssociationIdentity(candidate = {}, associatedCandidate = {}) {
  if (!associatedCandidate.stableId) {
    return false;
  }
  if (!candidate?.stableId) {
    return true;
  }
  return candidate.stableIdSource === "text_fingerprint" ||
    candidate.stableIdSource === "unknown_id_source" ||
    candidate?.detailUrl?.includes("/web/frame/c-resume");
}

function hasSameStableIdentity(candidate = {}, associatedCandidate = {}) {
  return Boolean(
    candidate?.stableId &&
    associatedCandidate?.stableId &&
    candidate.stableId === associatedCandidate.stableId &&
    candidate.stableIdSource === associatedCandidate.stableIdSource
  );
}

function hasConflictingCandidateProfile(candidateProfile = {}, associationProfile = {}) {
  return hasConflictingField(candidateProfile, associationProfile, "displayName") ||
    hasConflictingField(candidateProfile, associationProfile, "age") ||
    hasConflictingField(candidateProfile, associationProfile, "education") ||
    hasConflictingField(candidateProfile, associationProfile, "experience") ||
    hasConflictingField(candidateProfile, associationProfile, "jobSeekingStatus");
}

function hasConflictingField(left = {}, right = {}, key = "") {
  const leftValue = normalizeProfileComparableValue(left?.[key]);
  const rightValue = normalizeProfileComparableValue(right?.[key]);
  return Boolean(leftValue && rightValue && leftValue !== rightValue);
}

function normalizeProfileComparableValue(value) {
  return String(value ?? "").replace(/\s+/g, "").trim();
}

function mergeCandidateProfiles(associationProfile = {}, candidateProfile = {}) {
  const keys = new Set([
    ...Object.keys(associationProfile || {}),
    ...Object.keys(candidateProfile || {})
  ]);
  const merged = {};
  keys.forEach((key) => {
    merged[key] = hasMeaningfulProfileValue(candidateProfile?.[key]) ?
      candidateProfile[key] :
      associationProfile?.[key];
  });
  return merged;
}

function mergeCandidateSnapshots(previous = {}, next = {}) {
  return {
    ...(previous || {}),
    ...(next || {}),
    detailUrl: next?.detailUrl || previous?.detailUrl || "",
    profile: mergeCandidateProfiles(previous?.profile, next?.profile),
    detailProfile: next?.detailProfile || previous?.detailProfile
  };
}

function rememberRecentDetailInteractionIfNeeded(interaction = null) {
  if (interaction?.interactionType !== "candidate_detail_opened") {
    return;
  }
  recentDetailInteraction = { ...interaction };
}

function hasMeaningfulProfileValue(value) {
  if (Array.isArray(value)) {
    return value.length > 0;
  }
  return value !== null && value !== undefined && value !== "";
}

function readCardIdFromElement(element) {
  return element?.getAttribute?.(CANDIDATE_ID_ATTRIBUTE) ||
    element?.dataset?.bossObserverCandidateId ||
    element?.getAttribute?.(LEGACY_CANDIDATE_CARD_ID_ATTRIBUTE) ||
    element?.dataset?.bossObserverCardId ||
    "";
}

function writeCardIdToElement(element, cardId) {
  if (!element || !cardId) {
    return;
  }

  try {
    element.setAttribute?.(CANDIDATE_ID_ATTRIBUTE, cardId);
  } catch {
    // DOM mutation is best-effort; the in-memory registry still works for direct references.
  }
  if (element.dataset) {
    element.dataset.bossObserverCandidateId = cardId;
  }
}

function findCardIdFromElementTree(element) {
  let current = element;
  while (current) {
    const cardId = readCardIdFromElement(current);
    if (cardId) {
      return cardId;
    }
    current = current.parentElement;
  }
  return "";
}
