import test from "node:test";
import assert from "node:assert/strict";

import {
  CANDIDATE_ID_ATTRIBUTE,
  buildCandidateExposureKey,
  clearCandidateCardRegistry,
  getCandidateCardAssociationFromElement,
  getRecentCandidateCardAssociation,
  mergeCandidateSnapshotWithAssociation,
  recordCandidateCardInteraction,
  recordCandidateCardInteractionFromElement,
  registerCandidateCardAssociation,
  updateCandidateCardAssociation
} from "../extension/src/content/candidate-card-registry.js";

test.beforeEach(() => clearCandidateCardRegistry());

test("registering a candidate card writes data-boss-observer-candidate-id and dataset", () => {
  const element = createElement();
  const candidate = { stableId: "geek-1", stableIdSource: "url.geekId" };

  const association = registerCandidateCardAssociation({
    element,
    candidate,
    exposure: { cardIndex: 0, visibleRatio: 0.9 },
    listUrl: "https://www.zhipin.com/web/chat/recommend",
    listPageType: "candidate_recommend",
    sourceUrl: "https://www.zhipin.com/web/frame/recommend/"
  });

  assert.match(association.cardId, /^bo_candidate_url_geekid_geek_1_[a-z0-9]+$/);
  assert.equal(element.getAttribute(CANDIDATE_ID_ATTRIBUTE), association.cardId);
  assert.equal(element.dataset.bossObserverCandidateId, association.cardId);
  assert.equal(association.candidate.candidateId, association.cardId);
  assert.equal(
    association.candidate.exposureKey,
    buildCandidateExposureKey({
      candidate,
      listUrl: "https://www.zhipin.com/web/chat/recommend",
      listPageType: "candidate_recommend"
    })
  );
  assert.equal(association.exposure.cardIndex, 0);
  assert.equal(association.listUrl, "https://www.zhipin.com/web/chat/recommend");
  assert.equal(association.listPageType, "candidate_recommend");
  assert.equal(association.sourceUrl, "https://www.zhipin.com/web/frame/recommend/");
});

test("repeated registration of the same exposureKey reuses the existing card id", () => {
  const elementA = createElement();
  const elementB = createElement();
  const candidate = { stableId: "geek-1", stableIdSource: "url.geekId" };

  const first = registerCandidateCardAssociation({
    element: elementA,
    candidate,
    listUrl: "https://www.zhipin.com/web/chat/recommend",
    listPageType: "candidate_recommend"
  });
  const second = registerCandidateCardAssociation({
    element: elementB,
    candidate,
    listUrl: "https://www.zhipin.com/web/chat/recommend",
    listPageType: "candidate_recommend"
  });

  assert.equal(second.cardId, first.cardId);
  assert.equal(elementB.getAttribute(CANDIDATE_ID_ATTRIBUTE), first.cardId);
  assert.equal(elementB.dataset.bossObserverCandidateId, first.cardId);
});

test("candidate card id is deterministic per candidate across registry resets", () => {
  const candidate = { stableId: "geek-unique-1", stableIdSource: "url.geekId" };
  const first = registerCandidateCardAssociation({
    element: createElement(),
    candidate,
    listUrl: "https://www.zhipin.com/web/chat/recommend",
    listPageType: "candidate_recommend"
  });
  const firstCardId = first.cardId;

  clearCandidateCardRegistry();
  const second = registerCandidateCardAssociation({
    element: createElement(),
    candidate,
    listUrl: "https://www.zhipin.com/web/chat/search",
    listPageType: "candidate_search"
  });
  const third = registerCandidateCardAssociation({
    element: createElement(),
    candidate: { stableId: "geek-unique-2", stableIdSource: "url.geekId" },
    listUrl: "https://www.zhipin.com/web/chat/search",
    listPageType: "candidate_search"
  });

  assert.equal(second.cardId, firstCardId);
  assert.notEqual(third.cardId, firstCardId);
});

test("recordCandidateCardInteractionFromElement returns the most recent association and expires after the ttl", () => {
  const cardElement = createElement();
  const association = registerCandidateCardAssociation({
    element: cardElement,
    candidate: { stableId: "geek-2", stableIdSource: "url.geekId" },
    listUrl: "https://www.zhipin.com/web/chat/search",
    listPageType: "candidate_search"
  });

  const child = createElement({ parentElement: cardElement });
  const interactionAtMs = 1_700_000_000_000;
  const recorded = recordCandidateCardInteractionFromElement(child, {
    interactionType: "click",
    sourceUrl: "https://www.zhipin.com/web/chat/search",
    now: () => interactionAtMs
  });

  assert.equal(recorded?.cardId, association.cardId);

  const recent = getRecentCandidateCardAssociation({
    maxAgeMs: 30000,
    now: () => interactionAtMs + 1000
  });
  assert.equal(recent?.cardId, association.cardId);

  const expired = getRecentCandidateCardAssociation({
    maxAgeMs: 30000,
    now: () => interactionAtMs + 30001
  });
  assert.equal(expired, null);
});

test("updateCandidateCardAssociation writes exposedEventId back into the candidate snapshot", () => {
  const element = createElement();
  const association = registerCandidateCardAssociation({
    element,
    candidate: { stableId: "geek-3", stableIdSource: "text_fingerprint" },
    listUrl: "https://www.zhipin.com/web/chat/recommend",
    listPageType: "candidate_recommend"
  });

  const updated = updateCandidateCardAssociation(association.cardId, {
    exposedEventId: "evt_42"
  });

  assert.equal(updated?.exposedEventId, "evt_42");
  assert.equal(updated?.candidate.exposedEventId, "evt_42");
  assert.equal(updated?.candidate.candidateId, association.cardId);

  const fromElement = getCandidateCardAssociationFromElement(element);
  assert.equal(fromElement?.exposedEventId, "evt_42");
  assert.equal(fromElement?.candidate.exposedEventId, "evt_42");
});

test("re-registering the same exposureKey preserves the exposed event id", () => {
  const elementA = createElement();
  const elementB = createElement();
  const candidate = { stableId: "geek-4", stableIdSource: "url.geekId" };
  const first = registerCandidateCardAssociation({
    element: elementA,
    candidate,
    listUrl: "https://www.zhipin.com/web/chat/recommend",
    listPageType: "candidate_recommend"
  });

  updateCandidateCardAssociation(first.cardId, {
    exposedEventId: "evt_100"
  });
  const second = registerCandidateCardAssociation({
    element: elementB,
    candidate,
    listUrl: "https://www.zhipin.com/web/chat/recommend",
    listPageType: "candidate_recommend"
  });

  assert.equal(second.cardId, first.cardId);
  assert.equal(second.exposedEventId, "evt_100");
  assert.equal(second.candidate.exposedEventId, "evt_100");
});

test("recordCandidateCardInteraction can refresh recent association from card id", () => {
  const element = createElement();
  const association = registerCandidateCardAssociation({
    element,
    candidate: { stableId: "geek-5", stableIdSource: "url.geekId" },
    listUrl: "https://www.zhipin.com/web/chat/recommend",
    listPageType: "candidate_recommend"
  });

  recordCandidateCardInteraction(association.cardId, {
    interactionType: "candidate_detail_opened",
    sourceUrl: "https://www.zhipin.com/web/frame/c-resume/",
    now: () => 2000
  });

  const recent = getRecentCandidateCardAssociation({
    now: () => 2500
  });
  assert.equal(recent?.cardId, association.cardId);
});

test("reused card element with conflicting profile receives a new candidate id", () => {
  const element = createElement();
  const first = registerCandidateCardAssociation({
    element,
    candidate: {
      stableId: "card_1krv7g2",
      stableIdSource: "text_fingerprint",
      profile: {
        displayName: "钟意",
        age: 24
      }
    },
    listUrl: "https://www.zhipin.com/web/chat/recommend",
    listPageType: "candidate_recommend"
  });
  const second = registerCandidateCardAssociation({
    element,
    candidate: {
      stableId: "card_other",
      stableIdSource: "text_fingerprint",
      profile: {
        displayName: "何**",
        age: 27
      }
    },
    listUrl: "https://www.zhipin.com/web/chat/recommend",
    listPageType: "candidate_recommend"
  });

  assert.notEqual(second.cardId, first.cardId);
  assert.equal(element.getAttribute(CANDIDATE_ID_ATTRIBUTE), second.cardId);
  assert.equal(second.candidate.profile.displayName, "何**");
});

test("mergeCandidateSnapshotWithAssociation prefers exposed card identity for weak detail fingerprints", () => {
  const association = registerCandidateCardAssociation({
    element: createElement(),
    candidate: {
      stableId: "geek-6",
      stableIdSource: "url.geekId",
      detailUrl: "https://www.zhipin.com/web/chat/index?geekId=geek-6",
      profile: {
        displayName: "吴先生",
        age: 28,
        expectedPosition: "直播运营",
        tags: ["短视频"]
      }
    },
    listUrl: "https://www.zhipin.com/web/chat/recommend",
    listPageType: "candidate_recommend",
    exposedEventId: "evt_200"
  });

  const merged = mergeCandidateSnapshotWithAssociation({
    stableId: "card_weak",
    stableIdSource: "text_fingerprint",
    detailUrl: "https://www.zhipin.com/web/frame/c-resume/",
    profile: {
      displayName: "",
      age: null,
      expectedPosition: "主播",
      tags: []
    },
    detailProfile: {
      sectionKeys: ["workExperience"]
    }
  }, association);

  assert.equal(merged.stableId, "geek-6");
  assert.equal(merged.stableIdSource, "url.geekId");
  assert.equal(merged.candidateId, association.cardId);
  assert.equal(merged.exposureKey, association.exposureKey);
  assert.equal(merged.exposedEventId, "evt_200");
  assert.equal(merged.profile.displayName, "吴先生");
  assert.equal(merged.profile.age, 28);
  assert.equal(merged.profile.expectedPosition, "主播");
  assert.deepEqual(merged.profile.tags, ["短视频"]);
  assert.deepEqual(merged.detailProfile.sectionKeys, ["workExperience"]);
});

test("mergeCandidateSnapshotWithAssociation rejects conflicting exposed profile identity", () => {
  const association = registerCandidateCardAssociation({
    element: createElement(),
    candidate: {
      stableId: "card_1krv7g2",
      stableIdSource: "text_fingerprint",
      profile: {
        displayName: "钟意",
        age: 24
      }
    },
    listUrl: "https://www.zhipin.com/web/chat/recommend",
    listPageType: "candidate_recommend",
    exposedEventId: "evt_zhongyi"
  });
  const merged = mergeCandidateSnapshotWithAssociation({
    stableId: "card_other",
    stableIdSource: "text_fingerprint",
    profile: {
      displayName: "何**",
      age: 27
    }
  }, association);

  assert.equal(merged.candidateId, undefined);
  assert.equal(merged.exposureKey, undefined);
  assert.equal(merged.exposedEventId, undefined);
  assert.equal(merged.stableId, "card_other");
  assert.equal(merged.profile.displayName, "何**");
});

function createElement({ parentElement = null } = {}) {
  const attributes = {};
  return {
    parentElement,
    dataset: {},
    setAttribute(name, value) {
      attributes[name] = String(value);
    },
    getAttribute(name) {
      return attributes[name] || "";
    }
  };
}
