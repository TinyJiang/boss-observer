import test from "node:test";
import assert from "node:assert/strict";

import {
  buildCandidateCardPayload,
  buildCandidateSnapshotPayload,
  extractCandidateProfile,
  isCandidateDetailUrl,
  readCandidateIdentityDatasetFromElement,
  readCandidateIdentityLinksFromElement,
  readCandidateIdFromUrl,
  shouldTreatAsCandidateCardText
} from "../extension/src/content/candidate-card.js";

test("candidate card payload prefers stable ids from detail links", () => {
  const payload = buildCandidateCardPayload({
    text: "张先生 30岁 6年 大专 期望 杭州 销售 打招呼",
    links: ["https://www.zhipin.com/web/chat/index?geekId=abc123"],
    sourceUrl: "https://www.zhipin.com/web/chat/recommend",
    cardIndex: 2,
    visibleRatio: 0.75
  });

  assert.equal(payload.candidate.stableId, "abc123");
  assert.equal(payload.candidate.stableIdSource, "url.geekId");
  assert.match(payload.candidate.candidateId, /^bo_candidate_url_geekid_abc123_[a-z0-9]+$/);
  assert.equal(payload.exposure.cardIndex, 2);
  assert.equal(Object.hasOwn(payload.exposure, "visibleRatio"), false);
  assert.equal(Object.hasOwn(payload.exposure, "matchedSignals"), false);
  assert.equal(Object.hasOwn(payload.exposure, "textLength"), false);
  assert.equal(Object.hasOwn(payload, "text"), false);
});

test("candidate snapshot reads stable ids from dataset aliases", () => {
  const candidate = buildCandidateSnapshotPayload({
    text: "张先生 30岁 6年 大专 期望 杭州 销售 打招呼",
    dataset: {
      security_id: "sec-1"
    },
    sourceUrl: "https://www.zhipin.com/web/chat/recommend"
  });

  assert.equal(candidate.stableId, "sec-1");
  assert.equal(candidate.stableIdSource, "dataset.security_id");
  assert.match(candidate.candidateId, /^bo_candidate_dataset_security_id_sec_1_[a-z0-9]+$/);
});

test("candidate identity helpers collect descendant ids and URL attributes", () => {
  const button = createElement({
    dataset: {
      encryptGeekId: "encrypt-1"
    }
  });
  const link = createElement({
    href: "https://www.zhipin.com/web/chat/index?geekId=geek-1"
  });
  const card = createElement({
    children: [button, link],
    attributes: {
      "data-url": "/web/frame/c-resume?securityId=sec-2"
    }
  });

  assert.deepEqual(readCandidateIdentityDatasetFromElement(card).encryptGeekId, "encrypt-1");
  assert.deepEqual(readCandidateIdentityLinksFromElement(card), [
    "/web/frame/c-resume?securityId=sec-2",
    "https://www.zhipin.com/web/chat/index?geekId=geek-1"
  ]);
});

test("candidate card payload falls back to a fingerprint without storing raw text", () => {
  const payload = buildCandidateCardPayload({
    text: "李女士 8-12K 25岁 3年 本科 期望 杭州 直播运营 打招呼",
    sourceUrl: "https://www.zhipin.com/web/chat/recommend"
  });

  assert.match(payload.candidate.stableId, /^card_[a-z0-9]+$/);
  assert.equal(payload.candidate.stableIdSource, "text_fingerprint");
  assert.match(payload.candidate.candidateId, /^bo_candidate_text_fingerprint_card_[a-z0-9]+_[a-z0-9]+$/);
  assert.equal(Object.hasOwn(payload, "exposure"), false);
  assert.equal(JSON.stringify(payload).includes("李女士 8-12K 25岁"), false);
});

test("candidate card payload includes structured visible profile without long resume text", () => {
  const text = [
    "吴先生 刚刚活跃",
    "7-8K",
    "28岁 7年 高中 离职-随时到岗",
    "期望",
    "杭州 直播运营",
    "优势 努力 虚心 上进 戒骄戒躁，能够长期稳定完成复杂工作",
    "经纪人+模特",
    "达人库月增",
    "4年经纪经验",
    "打招呼"
  ].join("\n");

  const payload = buildCandidateCardPayload({
    text,
    sourceUrl: "https://www.zhipin.com/web/chat/recommend"
  });

  assert.deepEqual(payload.candidate.profile, {
    displayName: "吴先生",
    salary: "7-8K",
    age: 28,
    experience: "7年",
    education: "高中",
    jobSeekingStatus: "离职-随时到岗",
    activeStatus: "刚刚活跃",
    expectedLocation: "杭州",
    expectedPosition: "直播运营",
    tags: ["经纪人+模特", "4年经纪经验"]
  });
  assert.equal(JSON.stringify(payload).includes("努力 虚心 上进"), false);
});

test("candidate snapshot can use detail page url as candidate identity", () => {
  const candidate = buildCandidateSnapshotPayload({
    text: "陈女士 26岁 4年 本科 期望 杭州 用户运营",
    sourceUrl: "https://www.zhipin.com/web/chat/index?geekId=geek-9"
  });

  assert.equal(candidate.stableId, "geek-9");
  assert.equal(candidate.stableIdSource, "url.geekId");
  assert.match(candidate.candidateId, /^bo_candidate_url_geekid_geek_9_[a-z0-9]+$/);
  assert.equal(candidate.detailUrl, "https://www.zhipin.com/web/chat/index?geekId=geek-9");
  assert.equal(candidate.profile.age, 26);
  assert.equal(candidate.profile.expectedPosition, "用户运营");
  assert.equal(JSON.stringify(candidate).includes("陈女士 26岁"), false);
});

test("candidate profile parser supports inline expectation text", () => {
  assert.deepEqual(
    extractCandidateProfile("赵女士 在线 8-13K 25岁 7年 高中 离职-随时到岗 期望 杭州 大客户代表 优势 省略 打招呼"),
    {
      displayName: "赵女士",
      salary: "8-13K",
      age: 25,
      experience: "7年",
      education: "高中",
      jobSeekingStatus: "离职-随时到岗",
      activeStatus: "在线",
      expectedLocation: "杭州",
      expectedPosition: "大客户代表",
      tags: []
    }
  );
});

test("candidate profile parser keeps graduation and short-experience labels intact", () => {
  assert.equal(
    extractCandidateProfile("李佳鼎 7-12K 25岁 23年毕业 本科 期望 杭州 销售行政/商务 打招呼").experience,
    "23年毕业"
  );
  assert.equal(
    extractCandidateProfile("王志国 10-15K 27岁 1年以内 本科 离职-随时到岗 期望 杭州 客户经理 打招呼").experience,
    "1年以内"
  );
});

test("candidate profile parser extracts display name from detail header line", () => {
  const profile = extractCandidateProfile(
    "其他 相似经历 的牛人 热搜\n" +
    "林先生 刚刚活跃 8k 27岁 5年 本科 离职-随时到岗\n" +
    "求职期望 杭州 网络销售"
  );

  assert.equal(profile.displayName, "林先生");
  assert.equal(profile.activeStatus, "刚刚活跃");
  assert.equal(profile.age, 27);
  assert.equal(profile.expectedPosition, "网络销售");
});

test("candidate card text requires greet action and candidate signals", () => {
  assert.equal(
    shouldTreatAsCandidateCardText("王先生 31岁 9年 大专 期望 杭州 销售 打招呼"),
    true
  );
  assert.equal(shouldTreatAsCandidateCardText("仅有打招呼按钮"), false);
  assert.equal(shouldTreatAsCandidateCardText("王先生 31岁 9年 大专 期望 杭州 销售"), false);
});

test("candidate id can be parsed from detail path", () => {
  assert.deepEqual(
    readCandidateIdFromUrl("https://www.zhipin.com/geek/detail/encrypted-id.html"),
    {
      value: "encrypted-id.html",
      source: "url.path"
    }
  );
});

test("candidate id can be parsed from raw query text", () => {
  assert.deepEqual(
    readCandidateIdFromUrl("securityId=sec-raw&lid=lid-raw"),
    {
      value: "lid-raw",
      source: "url.lid"
    }
  );
});

test("candidate detail url detector supports path and query detail urls", () => {
  assert.equal(isCandidateDetailUrl("https://www.zhipin.com/geek/detail/encrypted-id.html"), true);
  assert.equal(isCandidateDetailUrl("https://www.zhipin.com/web/chat/index?geekId=abc123"), true);
  assert.equal(isCandidateDetailUrl("https://www.zhipin.com/web/frame/c-resume/?source=recommend"), true);
  assert.equal(isCandidateDetailUrl("https://www.zhipin.com/web/chat/recommend"), false);
});

function createElement({
  children = [],
  dataset = {},
  attributes = {},
  href = "",
  src = ""
} = {}) {
  const element = {
    children,
    dataset,
    href,
    src,
    parentElement: null,
    attributes: Object.entries(attributes).map(([name, value]) => ({ name, value })),
    getAttribute(name) {
      return attributes[name] || "";
    },
    querySelectorAll(selector) {
      if (selector !== "*") {
        return [];
      }
      return collectDescendants(this);
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
