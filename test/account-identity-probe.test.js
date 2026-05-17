import test from "node:test";
import assert from "node:assert/strict";

import {
  extractLikelyAccountNames,
  findBossAccountObservation,
  pickBossAccountCandidate
} from "../extension/src/content/account-identity-probe.js";

test("account identity parser keeps likely names and ignores navigation labels", () => {
  assert.deepEqual(
    extractLikelyAccountNames("职位\n沟通\n张三\n设置"),
    ["张三"]
  );
});

test("account identity picker prefers top-right user candidate", () => {
  const picked = pickBossAccountCandidate([
    {
      accountName: "候选人",
      source: "card_name_class",
      rect: { top: 260, right: 480, width: 80, height: 24 }
    },
    {
      accountName: "张三",
      source: "top_header_user_class",
      rect: { top: 18, right: 1360, width: 72, height: 28 }
    }
  ], {
    viewportWidth: 1440
  });

  assert.equal(picked.accountName, "张三");
  assert.equal(picked.confidence, "high");
});

test("account identity observation reports unknown when no header name is visible", () => {
  const observation = findBossAccountObservation({
    querySelectorAll() {
      return [];
    }
  }, {
    observedAt: "2026-05-17T18:30:00.000+08:00",
    pageUrl: "https://www.zhipin.com/web/chat/recommend"
  });

  assert.deepEqual(observation, {
    accountName: "",
    source: "not_found",
    confidence: "none",
    observedAt: "2026-05-17T18:30:00.000+08:00",
    pageUrl: "https://www.zhipin.com/web/chat/recommend"
  });
});

test("account identity observation reads visible top header account name", () => {
  const element = {
    className: "user-name",
    innerText: "张三",
    textContent: "",
    getAttribute() {
      return "";
    },
    getBoundingClientRect() {
      return {
        top: 16,
        bottom: 44,
        left: 1280,
        right: 1360,
        width: 80,
        height: 28
      };
    }
  };
  const observation = findBossAccountObservation({
    querySelectorAll() {
      return [element];
    }
  }, {
    observedAt: "2026-05-17T18:30:00.000+08:00",
    pageUrl: "https://www.zhipin.com/web/chat/recommend",
    viewportWidth: 1440
  });

  assert.equal(observation.accountName, "张三");
  assert.equal(observation.source, "top_header_user_class");
  assert.equal(observation.confidence, "high");
});
