import test from "node:test";
import assert from "node:assert/strict";

import { classifyPage, isBossUrl } from "../extension/src/shared/page-classifier.js";

test("recognizes BOSS chat page from observed Chrome tab", () => {
  const page = classifyPage("https://www.zhipin.com/web/chat/index");

  assert.equal(page.isBossPage, true);
  assert.equal(page.pageType, "chat");
});

test("recognizes BOSS chat recommendation page as candidate recommendation", () => {
  const page = classifyPage("https://www.zhipin.com/web/chat/recommend");

  assert.equal(page.isBossPage, true);
  assert.equal(page.pageType, "candidate_recommend");
});

test("recognizes BOSS chat search page as candidate search", () => {
  const page = classifyPage("https://www.zhipin.com/web/chat/search");

  assert.equal(page.isBossPage, true);
  assert.equal(page.pageType, "candidate_search");
});

test("recognizes BOSS chat intention page as candidate intention", () => {
  const page = classifyPage("https://www.zhipin.com/web/chat/intention");

  assert.equal(page.isBossPage, true);
  assert.equal(page.pageType, "candidate_intention");
});

test("recognizes BOSS chat interaction page as candidate interaction", () => {
  const page = classifyPage("https://www.zhipin.com/web/chat/interaction");

  assert.equal(page.isBossPage, true);
  assert.equal(page.pageType, "candidate_interaction");
});

test("recognizes BOSS candidate manage page", () => {
  const page = classifyPage("https://www.zhipin.com/web/chat/geek/manage_v2");

  assert.equal(page.isBossPage, true);
  assert.equal(page.pageType, "candidate_manage");
});

test("recognizes BOSS recruiting data page", () => {
  const page = classifyPage("https://www.zhipin.com/web/chat/data-recruit");

  assert.equal(page.isBossPage, true);
  assert.equal(page.pageType, "recruiting_data");
});

test("recognizes BOSS business mall page", () => {
  const page = classifyPage("https://www.zhipin.com/web/chat/business/mall");

  assert.equal(page.isBossPage, true);
  assert.equal(page.pageType, "business_mall");
});

test("recognizes BOSS project outsource page", () => {
  const page = classifyPage("https://www.zhipin.com/web/chat/hezuo/employer-list");

  assert.equal(page.isBossPage, true);
  assert.equal(page.pageType, "project_outsource");
});

test("recognizes BOSS site entry pages", () => {
  assert.equal(classifyPage("https://www.zhipin.com/").pageType, "site_home");
  assert.equal(classifyPage("https://www.zhipin.com/hangzhou/?seoRefer=index").pageType, "site_home");
});

test("recognizes BOSS user account page", () => {
  const page = classifyPage("https://www.zhipin.com/web/user/?ka=header-login");

  assert.equal(page.isBossPage, true);
  assert.equal(page.pageType, "user_account");
});

test("recognizes candidate detail query before generic chat pages", () => {
  const page = classifyPage("https://www.zhipin.com/web/chat/index?geekId=123");

  assert.equal(page.isBossPage, true);
  assert.equal(page.pageType, "candidate_detail");
});

test("recognizes BOSS c-resume iframe as candidate detail", () => {
  const page = classifyPage("https://www.zhipin.com/web/frame/c-resume/?source=recommend");

  assert.equal(page.isBossPage, true);
  assert.equal(page.pageType, "candidate_detail");
});

test("recognizes non-BOSS pages", () => {
  const page = classifyPage("https://example.com/");

  assert.equal(page.isBossPage, false);
  assert.equal(page.pageType, "non_boss");
});

test("exposes BOSS URL predicate", () => {
  assert.equal(isBossUrl("https://www.zhipin.com/web/chat/index"), true);
  assert.equal(isBossUrl("https://example.com/"), false);
});
