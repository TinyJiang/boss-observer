import test from "node:test";
import assert from "node:assert/strict";

import {
  CandidateListProbe
} from "../extension/src/content/candidate-list-probe.js";
import {
  clearCandidateCardRegistry,
  getCandidateCardAssociationFromElement,
  getRecentCandidateCardAssociation
} from "../extension/src/content/candidate-card-registry.js";
import { EVENT_TYPES } from "../extension/src/shared/event-types.js";
import { classifyPage } from "../extension/src/shared/page-classifier.js";

test.beforeEach(() => clearCandidateCardRegistry());

test.afterEach(() => {
  delete globalThis.document;
});

test("candidate list probe registers exposed cards and writes exposure event id back", () => {
  const { document, card } = createCandidateListDocument();
  globalThis.document = document;
  const collector = createCollector();
  const probe = new CandidateListProbe({
    collector,
    sessionContext: createSessionContext("https://www.zhipin.com/web/chat/recommend"),
    now: () => 1000
  });

  probe.scan("poll");

  assert.deepEqual(
    collector.events.map((event) => event.type),
    [
      EVENT_TYPES.CANDIDATE_LIST_VIEWED,
      EVENT_TYPES.CANDIDATE_CARD_EXPOSED
    ]
  );
  const cardEvent = collector.events[1];
  assert.match(cardEvent.payload.candidate.candidateId, /^bo_candidate_dataset_geekid_geek_1_[a-z0-9]+$/);
  assert.equal(cardEvent.payload.candidate.exposureKey.includes("candidate_recommend"), true);
  assert.equal(Object.hasOwn(cardEvent.payload, "page"), false);
  assert.equal(Object.hasOwn(cardEvent.payload.candidate, "exposedEventId"), false);
  assert.deepEqual(cardEvent.payload.exposure, { cardIndex: 0 });
  assert.equal(card.dataset.bossObserverCandidateId, cardEvent.payload.candidate.candidateId);

  const association = getCandidateCardAssociationFromElement(card);
  assert.equal(association?.exposedEventId, "evt_2");
  assert.equal(association?.candidate.exposedEventId, "evt_2");
});

test("candidate list probe records card clicks as recent card interactions", () => {
  const { document, card, button } = createCandidateListDocument();
  globalThis.document = document;
  const collector = createCollector();
  const probe = new CandidateListProbe({
    collector,
    sessionContext: createSessionContext("https://www.zhipin.com/web/chat/recommend"),
    now: () => 2000
  });

  probe.scan("poll");
  probe.handleDocumentClick({ target: button }, document);

  const association = getCandidateCardAssociationFromElement(card);
  const recent = getRecentCandidateCardAssociation({
    now: () => 2500
  });
  assert.equal(recent?.cardId, association?.cardId);
});

function createCollector() {
  return {
    events: [],
    collect(type, payload) {
      const event = {
        id: `evt_${this.events.length + 1}`,
        type,
        payload
      };
      this.events.push(event);
      return event;
    }
  };
}

function createSessionContext(url) {
  return {
    page: classifyPage(url)
  };
}

function createCandidateListDocument() {
  const button = createElement({
    tagName: "BUTTON",
    text: "打招呼"
  });
  const card = createElement({
    text: [
      "吴先生 刚刚活跃",
      "7-8K",
      "28岁 7年 高中 离职-随时到岗",
      "期望 杭州 直播运营",
      "打招呼"
    ].join("\n"),
    dataset: {
      geekId: "geek-1"
    },
    children: [button]
  });
  const document = {
    location: {
      href: "https://www.zhipin.com/web/frame/recommend/?jobid=job1"
    },
    defaultView: {
      innerHeight: 900,
      innerWidth: 1440
    },
    addEventListener() {},
    removeEventListener() {},
    querySelectorAll(selector) {
      if (selector === "iframe") {
        return [];
      }
      if (selector === "button, a") {
        return [button];
      }
      return [];
    }
  };
  card.ownerDocument = document;
  button.ownerDocument = document;
  document.body = card;
  document.documentElement = card;
  return { document, card, button };
}

function createElement({
  tagName = "DIV",
  text = "",
  parentElement = null,
  children = [],
  dataset = {}
} = {}) {
  const attributes = {};
  const element = {
    tagName,
    parentElement,
    children,
    dataset,
    setAttribute(name, value) {
      attributes[name] = String(value);
    },
    getAttribute(name) {
      return attributes[name] || "";
    },
    get innerText() {
      return text || this.children.map((child) => child.innerText).filter(Boolean).join("\n");
    },
    get textContent() {
      return this.innerText;
    },
    getBoundingClientRect() {
      return {
        top: 10,
        left: 10,
        right: 310,
        bottom: 210,
        width: 300,
        height: 200
      };
    },
    querySelectorAll(selector) {
      if (selector !== "a[href]") {
        return [];
      }
      return collectDescendants(this).filter((candidate) => candidate.href);
    }
  };

  children.forEach((child) => {
    child.parentElement = element;
  });
  return element;
}

function collectDescendants(element) {
  return element.children.flatMap((child) => [child, ...collectDescendants(child)]);
}
