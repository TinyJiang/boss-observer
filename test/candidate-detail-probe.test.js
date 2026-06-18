import test from "node:test";
import assert from "node:assert/strict";

import {
  buildCandidateDetailKey,
  buildCandidateDetailPayload,
  CandidateDetailProbe,
  detectCandidateDetailSignals,
  extractCandidateDetailProfile,
  findActiveCandidateDetail,
  shouldTreatAsCandidateDetailText
} from "../extension/src/content/candidate-detail-probe.js";
import {
  buildCandidateSnapshotPayload
} from "../extension/src/content/candidate-card.js";
import {
  clearCandidateCardRegistry,
  getRecentCandidateDetailAssociation,
  recordCandidateCardInteraction,
  registerCandidateCardAssociation
} from "../extension/src/content/candidate-card-registry.js";
import { EVENT_TYPES } from "../extension/src/shared/event-types.js";
import { classifyPage } from "../extension/src/shared/page-classifier.js";

test.beforeEach(() => clearCandidateCardRegistry());

test("candidate detail payload uses detail url identity without storing raw resume text", () => {
  const payload = buildCandidateDetailPayload({
    source: "poll",
    page: classifyPage("https://www.zhipin.com/web/chat/recommend"),
    sourceUrl: "https://www.zhipin.com/web/chat/index?geekId=abc123",
    text: [
      "吴先生 刚刚活跃",
      "7-8K",
      "28岁 7年 高中 离职-随时到岗",
      "求职期望 杭州 直播运营",
      "个人优势 很长的自我描述内容不应该原文进入 payload",
      "工作经历 某公司",
      "教育经历 某学校"
    ].join("\n"),
    detectedBy: "detail_url"
  });

  assert.equal(payload.detailUrl, "https://www.zhipin.com/web/chat/index?geekId=abc123");
  assert.equal(Object.hasOwn(payload, "detailPageType"), false);
  assert.equal(Object.hasOwn(payload, "page"), false);
  assert.equal(payload.candidate.stableId, "abc123");
  assert.equal(payload.candidate.stableIdSource, "url.geekId");
  assert.equal(payload.candidate.profile.displayName, "吴先生");
  assert.equal(payload.candidate.profile.expectedLocation, "杭州");
  assert.equal(payload.candidate.profile.expectedPosition, "直播运营");
  assert.equal(Object.hasOwn(payload, "detail"), false);
  assert.equal(JSON.stringify(payload).includes("很长的自我描述内容"), false);
});

test("candidate detail payload reads stable id from dataset aliases", () => {
  const payload = buildCandidateDetailPayload({
    source: "poll",
    page: classifyPage("https://www.zhipin.com/web/chat/recommend"),
    sourceUrl: "https://www.zhipin.com/web/frame/c-resume/?source=recommend",
    dataset: {
      encrypt_geek_id: "encrypt-7"
    },
    text: [
      "吴先生 刚刚活跃",
      "7-8K",
      "28岁 7年 高中 离职-随时到岗",
      "求职期望 杭州 直播运营",
      "个人优势 摘要",
      "工作经历 某公司",
      "教育经历 某学校"
    ].join("\n"),
    detectedBy: "c_resume_frame"
  });

  assert.equal(payload.candidate.stableId, "encrypt-7");
  assert.equal(payload.candidate.stableIdSource, "dataset.encrypt_geek_id");
});

test("candidate detail payload includes bounded structured detail profile", () => {
  const payload = buildCandidateDetailPayload({
    sourceUrl: "https://www.zhipin.com/web/frame/c-resume/?source=recommend",
    text: [
      "林先生 刚刚活跃",
      "8k",
      "27岁 5年 本科 离职-随时到岗",
      "求职期望",
      "杭州 网络销售",
      "个人优势",
      "熟悉客户开发和私域运营，微信号 wx-test 不应该进入摘要",
      "有稳定电话 13800000000 不应该进入摘要",
      "工作经历",
      "杭州某科技有限公司 网络销售 2021-2024",
      "负责客户跟进和成交转化",
      "教育经历",
      "浙江某大学 市场营销 本科",
      "资格证书",
      "普通话二级"
    ].join("\n")
  });

  assert.equal(payload.candidate.profile.displayName, "林先生");
  assert.deepEqual(payload.candidate.detailProfile.sections.jobExpectation.items, ["杭州 网络销售"]);
  assert.equal(payload.candidate.detailProfile.sections.advantage, undefined);
  assert.deepEqual(payload.candidate.detailProfile.sections.workExperience.items, [
    "杭州某科技有限公司 网络销售 2021-2024",
    "负责客户跟进和成交转化"
  ]);
  assert.deepEqual(payload.candidate.detailProfile.sections.educationExperience.items, [
    "浙江某大学 市场营销 本科"
  ]);
  assert.deepEqual(payload.candidate.detailProfile.sections.certificates.items, ["普通话二级"]);
  assert.equal(JSON.stringify(payload).includes("wx-test"), false);
  assert.equal(JSON.stringify(payload).includes("13800000000"), false);
});

test("candidate detail payload omits empty profile and diagnostic fields", () => {
  const payload = buildCandidateDetailPayload({
    sourceUrl: "https://www.zhipin.com/web/frame/c-resume/?source=recommend",
    detectedBy: "c_resume_selected_card",
    text: [
      "何** 刚刚活跃",
      "27岁 6年 大专 离职-随时到岗 4-9K",
      "打招呼"
    ].join("\n")
  });

  assert.equal(payload.candidate.profile.displayName, "何**");
  assert.match(payload.candidate.candidateId, /^bo_candidate_text_fingerprint_card_[a-z0-9]+_[a-z0-9]+$/);
  assert.equal(payload.candidate.profile.expectedLocation, undefined);
  assert.equal(payload.candidate.profile.expectedPosition, undefined);
  assert.equal(payload.candidate.profile.tags, undefined);
  assert.equal(payload.candidate.detailProfile, undefined);
  assert.equal(Object.hasOwn(payload, "page"), false);
  assert.equal(Object.hasOwn(payload, "detailPageType"), false);
  assert.equal(Object.hasOwn(payload, "detail"), false);
});

test("candidate detail payload does not inherit exposure association when selected card profile conflicts", () => {
  const association = registerCandidateCardAssociation({
    element: createRegistryElement(),
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
  const payload = buildCandidateDetailPayload({
    sourceUrl: "https://www.zhipin.com/web/frame/c-resume/?source=recommend",
    detectedBy: "c_resume_selected_card",
    text: [
      "何** 刚刚活跃",
      "27岁 6年 大专 离职-随时到岗 4-9K",
      "打招呼"
    ].join("\n"),
    candidateAssociation: association
  });

  assert.equal(payload.candidate.profile.displayName, "何**");
  assert.notEqual(payload.candidate.stableId, "card_1krv7g2");
  assert.match(payload.candidate.candidateId, /^bo_candidate_text_fingerprint_card_[a-z0-9]+_[a-z0-9]+$/);
  assert.notEqual(payload.candidate.candidateId, association.cardId);
  assert.equal(payload.candidate.exposureKey, undefined);
  assert.equal(payload.candidate.exposedEventId, undefined);
});

test("candidate detail profile parses actual BOSS text without mixing overview into expectation", () => {
  const payload = buildCandidateDetailPayload({
    sourceUrl: "https://www.zhipin.com/web/frame/c-resume/?source=recommend",
    text: [
      "推荐",
      "相似经历 的牛人",
      "经历：顶点财经网络传媒有限公司八分公司·课程顾问",
      "院校：辽宁理工职业大学·机械设计制造及自动化",
      "陈**",
      "刚刚活跃",
      "22岁 7年 大专 离职-随时到岗 8k",
      "求职期望",
      "杭州 销售经理/主管",
      "个人优势",
      "熟悉客户开发和销售转化",
      "工作经历",
      "杭州谭洛电子商务有限公司",
      "2023.06 - 2026.01",
      "销售经理/主管",
      "教育经历",
      "辽宁理工职业大学",
      "机械设计制造及自动化 大专",
      "收藏 不合适 举报 转发牛人"
    ].join("\n")
  });

  assert.equal(payload.candidate.profile.displayName, "陈**");
  assert.deepEqual(payload.candidate.detailProfile.overview.items, [
    "经历：顶点财经网络传媒有限公司八分公司·课程顾问",
    "院校：辽宁理工职业大学·机械设计制造及自动化"
  ]);
  assert.deepEqual(payload.candidate.detailProfile.sections.jobExpectation.items, ["杭州 销售经理/主管"]);
  assert.deepEqual(payload.candidate.detailProfile.sections.workExperience.items, [
    "杭州谭洛电子商务有限公司",
    "2023.06 - 2026.01",
    "销售经理/主管"
  ]);
});

test("candidate detail profile prioritizes top summary and boss analysis blocks", () => {
  const payload = buildCandidateDetailPayload({
    sourceUrl: "https://www.zhipin.com/web/frame/c-resume/?source=recommend",
    text: [
      "黄仁丽",
      "刚刚活跃",
      "23岁 | 4年 | 大专 | 在职-考虑机会",
      "• 具备工作能力：普通话标准，善于与人沟通，工作经验丰富",
      "• 性格优点：吃苦耐劳，有坚持不懈的精神，肯吃苦，有一定的抗压能力",
      "期望职位",
      "赣州 兼职·主播 行业不限",
      "工作经历",
      "名卿坊家具 | 客服专员·K中控",
      "牛人分析器",
      "牛人 10小时前 更新过简历，其通常活跃时间为 2-6pm。求职意愿 较强，沟通Boss超过 64% 的同类牛人",
      "受欢迎程度 较高，被沟通次数超过 55% 的同类牛人。更喜欢 0-20人 规模的公司，偏好工作地点 南康区",
      "查看全部8项分析",
      "为妥善保护牛人在BOSS直聘平台提交、发布、展示的简历中的个人信息"
    ].join("\n")
  });

  assert.equal(payload.candidate.profile.displayName, "黄仁丽");
  assert.equal(payload.candidate.profile.activeStatus, "刚刚活跃");
  assert.equal(payload.candidate.profile.age, 23);
  assert.equal(payload.candidate.profile.experience, "4年");
  assert.equal(payload.candidate.profile.education, "大专");
  assert.equal(payload.candidate.profile.jobSeekingStatus, "在职-考虑机会");
  assert.deepEqual(payload.candidate.detailProfile.topSummary.items, [
    "具备工作能力：普通话标准，善于与人沟通，工作经验丰富",
    "性格优点：吃苦耐劳，有坚持不懈的精神，肯吃苦，有一定的抗压能力"
  ]);
  assert.equal(payload.candidate.detailProfile.bossAnalysis.actionText, "查看全部8项分析");
  assert.equal(payload.candidate.detailProfile.bossAnalysis.items.length, 2);
  assert.equal(payload.candidate.detailProfile.bossAnalysis.items[0].includes("通常活跃时间"), true);
  assert.equal(payload.candidate.detailProfile.bossAnalysis.items[1].includes("偏好工作地点"), true);
  assert.equal(JSON.stringify(payload).includes("个人信息"), false);
});

test("candidate detail profile parses numbered top summary and inline boss analysis title", () => {
  const payload = buildCandidateDetailPayload({
    sourceUrl: "https://www.zhipin.com/web/frame/c-resume/?source=recommend",
    text: [
      "平安喜乐",
      "刚刚活跃",
      "25岁 | 2年 | 高中 | 在职-考虑机会",
      "1.形象亲和，适合家具类目主播人设，抖音当季强主播，有亲和力强，实木床、软体床等经验",
      "2.服装化妆底子好，拍摄短视频过少模特，能带一批化妆打扮，有给别人化过妆拍照",
      "3.近期上下手价较高，学习英语，可以聊天话术不浓",
      "4.带过十多人的团队，做过销售公司的管理，在公司演讲过多次",
      "期望职位",
      "赣州 兼职·主播 行业不限",
      "工作经历",
      "带货主播 主播",
      "牛人分析器 牛人 11小时前 沟通过boss，其通常活跃时间为 3-5am。求职意愿 较强，沟通Boss超过 75% 的同类牛人"
    ].join("\n")
  });

  assert.deepEqual(payload.candidate.detailProfile.topSummary.items, [
    "形象亲和，适合家具类目主播人设，抖音当季强主播，有亲和力强，实木床、软体床等经验",
    "服装化妆底子好，拍摄短视频过少模特，能带一批化妆打扮，有给别人化过妆拍照",
    "近期上下手价较高，学习英语，可以聊天话术不浓"
  ]);
  assert.equal(payload.candidate.detailProfile.bossAnalysis.items[0].includes("沟通过boss"), true);
});

test("candidate detail profile parses boss analysis heading variants", () => {
  const payload = buildCandidateDetailPayload({
    sourceUrl: "https://www.zhipin.com/web/frame/c-resume/?source=recommend",
    text: [
      "李大钱",
      "刚刚活跃",
      "24岁 | 4年 | 大专 | 在职-暂不考虑",
      "期望职位",
      "赣州 兼职·主播 行业不限",
      "VIP专享 牛人分析：牛人 10小时前更新过简历，其通常活跃时间为 2-6pm",
      "求职意愿 较强，沟通Boss超过 64% 的同类牛人",
      "查看全部 8 项分析",
      "为妥善保护牛人在BOSS直聘平台提交、发布、展示的简历中的个人信息"
    ].join("\n")
  });

  assert.equal(payload.candidate.detailProfile.bossAnalysis.title, "牛人分析");
  assert.equal(payload.candidate.detailProfile.bossAnalysis.actionText, "查看全部 8 项分析");
  assert.equal(payload.candidate.detailProfile.bossAnalysis.items[0].includes("通常活跃时间"), true);
  assert.equal(payload.candidate.detailProfile.bossAnalysis.items[1].includes("沟通Boss超过"), true);
});

test("candidate detail profile parses inline section labels from actual text", () => {
  const detailProfile = extractCandidateDetailProfile([
    "刘女士 在线 25岁 3年 本科 10k",
    "期望职位： 网络销售",
    "工作城市： 杭州",
    "工作经历",
    "杭州某科技有限公司",
    "教育经历： 浙江某大学 市场营销 本科"
  ].join("\n"));

  assert.deepEqual(detailProfile.sections.jobExpectation.items, [
    "网络销售",
    "工作城市： 杭州"
  ]);
  assert.deepEqual(detailProfile.sections.educationExperience.items, ["浙江某大学 市场营销 本科"]);
});

test("candidate detail profile ignores script text before top summary", () => {
  const detailProfile = extractCandidateDetailProfile([
    "!function(){var e=document,t=e.createElement(\"script\");document.createElement(\"script\")}",
    "廖淑雯",
    "3日内活跃",
    "27岁 | 10年 | 高中 | 离职-随时到岗",
    "熟悉各个所需软件，熟悉专业知识，能够合理应用",
    "期望职位",
    "赣州 兼职·主播 行业不限"
  ].join("\n"));

  assert.deepEqual(detailProfile.topSummary.items, [
    "熟悉各个所需软件，熟悉专业知识，能够合理应用"
  ]);
});

test("candidate detail profile truncates long section lines", () => {
  const detailProfile = extractCandidateDetailProfile([
    "个人优势",
    "长文本".repeat(80)
  ].join("\n"));

  const item = detailProfile.sections.advantage.items[0];
  assert.equal(item.length <= 163, true);
  assert.equal(item.endsWith("..."), true);
});

test("candidate detail key is stable for the same candidate", () => {
  const payload = buildCandidateDetailPayload({
    sourceUrl: "https://www.zhipin.com/web/chat/index?geekId=abc123",
    text: "吴先生 28岁 求职期望 杭州 直播运营 工作经历 A 教育经历 B"
  });

  assert.equal(buildCandidateDetailKey(payload), "url.geekId:abc123");
});

test("candidate detail text detection requires profile and detail section signals", () => {
  assert.equal(
    shouldTreatAsCandidateDetailText("吴先生 28岁 本科 求职期望 杭州 运营 自我评价 A 经历概览 B 教育经历 C 收藏 不合适 举报 转发牛人"),
    true
  );
  assert.equal(
    shouldTreatAsCandidateDetailText("吴先生 28岁 本科 期望 杭州 运营 打招呼"),
    false
  );
  assert.equal(
    shouldTreatAsCandidateDetailText("吴先生 28岁 本科 求职期望 杭州 运营 自我评价 A 经历概览 B 教育经历 C"),
    false
  );
});

test("candidate detail text detection rejects plain candidate list text", () => {
  assert.equal(
    shouldTreatAsCandidateDetailText(
      "韩露平 23岁 24年毕业 大专 赣州 主持人/主播/DJ 打招呼 陈玲 23岁 3年 大专 离职-随时到岗 打招呼"
    ),
    false
  );
});

test("candidate detail text detection rejects bottom recommendation card noise", () => {
  assert.equal(
    shouldTreatAsCandidateDetailText([
      "其他 名校 毕业的牛人",
      "何** 热搜",
      "27岁 6年 大专 离职-随时到岗 4-9K",
      "期望职位： 主播",
      "经历： 佳腾电业（赣州）·行政专员/助理",
      "院校： 江西环境工程职业学院·酒店管理学",
      "收藏 不合适 举报 转发牛人 打招呼"
    ].join("\n")),
    false
  );
});

test("candidate detail payload handles c-resume iframe url and long detail text", () => {
  const longDetailText = [
    "其他 相似经历 的牛人 张** 热搜",
    "韩露平 在线 23岁 24年毕业 大专 5-6K",
    "自我评价",
    "积极乐观，沟通能力强",
    "期望职位： 直播运营",
    "收藏 不合适 举报 转发牛人 打招呼",
    "经历概览",
    "赣州中泽汽车销售服务有限公司 主播",
    "教育经历",
    "九江职业大学 电子商务 大专",
    "补充文本".repeat(3000)
  ].join(" ");

  const payload = buildCandidateDetailPayload({
    page: classifyPage("https://www.zhipin.com/web/chat/recommend"),
    sourceUrl: "https://www.zhipin.com/web/frame/c-resume/?source=recommend",
    text: longDetailText,
    detectedBy: "c_resume_frame"
  });

  assert.equal(payload.detailUrl, "https://www.zhipin.com/web/frame/c-resume/?source=recommend");
  assert.equal(payload.detectedBy, "c_resume_frame");
  assert.equal(Object.hasOwn(payload, "detailPageType"), false);
  assert.equal(Object.hasOwn(payload, "detail"), false);
  assert.match(payload.candidate.stableId, /^card_[a-z0-9]+$/);
  assert.equal(
    payload.candidate.detailProfile.sections.advantage.items.some((item) => item.includes("积极乐观，沟通能力强")),
    true
  );
  assert.equal(JSON.stringify(payload).includes("补充文本".repeat(100)), false);
});

test("candidate detail detection prefers focused detail container over recommendation page body", () => {
  const detailText = [
    "林先生 刚刚活跃",
    "8k",
    "27岁 5年 本科 离职-随时到岗",
    "求职期望",
    "杭州 网络销售",
    "个人优势",
    "擅长客户开发和销售转化",
    "工作经历",
    "杭州某科技有限公司 网络销售 2021-2024",
    "教育经历",
    "浙江某大学 市场营销 本科",
    "收藏 不合适 举报 转发牛人"
  ].join("\n");
  const bodyText = [
    "推荐",
    "相似经历 的牛人",
    "陈** 22岁 大专 8k 期望 杭州 销售经理/主管 打招呼",
    "王** 25岁 本科 10k 期望 杭州 网络销售 打招呼",
    detailText
  ].join("\n");
  const detailElement = createFakeElement({
    className: "candidate-detail resume-panel",
    text: detailText
  });
  const document = createFakeDocument({
    url: "https://www.zhipin.com/web/chat/recommend",
    bodyText,
    detailElements: [detailElement]
  });

  const detected = findActiveCandidateDetail(document, classifyPage("https://www.zhipin.com/web/chat/recommend"));
  const payload = buildCandidateDetailPayload({
    page: classifyPage("https://www.zhipin.com/web/chat/recommend"),
    ...detected
  });

  assert.equal(detected.text, detailText);
  assert.equal(payload.detectedBy, "detail_dom");
  assert.equal(payload.candidate.profile.displayName, "林先生");
  assert.equal(payload.candidate.detailProfile.sections.workExperience.items[0], "杭州某科技有限公司 网络销售 2021-2024");
  assert.equal(JSON.stringify(payload).includes("陈**"), false);
});

test("candidate detail detection ignores chat page profile-like panels", () => {
  const chatPanelText = [
    "Alone 刚刚活跃",
    "24岁 3年 大专 离职-随时到岗",
    "求职期望",
    "杭州 主播",
    "牛人分析",
    "沟通意愿较强",
    "个人优势",
    "有直播经验",
    "工作经历",
    "杭州某传媒 主播 2023-2024",
    "收藏 不合适 举报 转发牛人"
  ].join("\n");
  const profilePanel = createFakeElement({
    className: "chat-profile geek-panel",
    text: chatPanelText
  });
  const document = createFakeDocument({
    url: "https://www.zhipin.com/web/chat/index",
    bodyText: [
      "沟通",
      "Alone",
      "兼职·【8000+】搞笑兼职主播（时薪40+）",
      chatPanelText
    ].join("\n"),
    detailElements: [profilePanel]
  });

  const detected = findActiveCandidateDetail(document, classifyPage("https://www.zhipin.com/web/chat/index"));

  assert.equal(detected, null);
});

test("candidate detail detection scans nested c-resume iframes", () => {
  const detailText = [
    "赵女士 刚刚活跃",
    "9k",
    "26岁 4年 本科 离职-随时到岗",
    "求职期望",
    "杭州 销售顾问",
    "个人优势",
    "熟悉直播线索转化",
    "工作经历",
    "杭州某传媒有限公司 销售顾问",
    "教育经历",
    "浙江某学院 本科",
    "收藏 不合适 举报 转发牛人"
  ].join("\n");
  const resumeDocument = createFakeDocument({
    url: "https://www.zhipin.com/web/frame/c-resume/?source=recommend",
    bodyText: detailText,
    detailElements: []
  });
  const recommendDocument = createFakeDocument({
    url: "https://www.zhipin.com/web/frame/recommend/?jobid=job1",
    bodyText: "推荐 张** 25岁 本科 8k 期望 杭州 主播 打招呼",
    detailElements: [],
    iframes: [createFakeFrame(resumeDocument)]
  });
  const topDocument = createFakeDocument({
    url: "https://www.zhipin.com/web/chat/recommend",
    bodyText: "BOSS直聘 推荐",
    detailElements: [],
    iframes: [createFakeFrame(recommendDocument)]
  });

  const detected = findActiveCandidateDetail(topDocument, classifyPage("https://www.zhipin.com/web/chat/recommend"));
  const payload = buildCandidateDetailPayload({
    page: classifyPage("https://www.zhipin.com/web/chat/recommend"),
    ...detected
  });

  assert.equal(detected.sourceUrl, "https://www.zhipin.com/web/frame/c-resume/?source=recommend");
  assert.equal(detected.detectedBy, "c_resume_frame");
  assert.equal(payload.candidate.profile.displayName, "赵女士");
  assert.equal(payload.candidate.detailProfile.sections.workExperience.items[0], "杭州某传媒有限公司 销售顾问");
  assert.equal(payload.candidate.stableIdSource, "text_fingerprint");
});

test("candidate detail detection ignores empty c-resume iframe without DOM candidate fallback", () => {
  const resumeDocument = createFakeDocument({
    url: "https://www.zhipin.com/web/frame/c-resume/?source=recommend",
    bodyText: "BOSS直聘 页面脚本 wasm 详情加载中 暂无可读候选人文本".repeat(8),
    detailElements: []
  });
  const recommendDocument = createFakeDocument({
    url: "https://www.zhipin.com/web/frame/recommend/?jobid=job1",
    bodyText: "推荐",
    detailElements: [],
    iframes: [createFakeFrame(resumeDocument)]
  });
  const topDocument = createFakeDocument({
    url: "https://www.zhipin.com/web/chat/recommend",
    bodyText: "BOSS直聘 推荐",
    detailElements: [],
    iframes: [createFakeFrame(recommendDocument)]
  });

  const detected = findActiveCandidateDetail(topDocument, classifyPage("https://www.zhipin.com/web/chat/recommend"));

  assert.equal(detected, null);
});

test("candidate detail detection uses captured canvas text for c-resume details", () => {
  const canvasText = [
    "廖淑雯 3日内活跃",
    "27岁 | 10年 | 高中 | 离职-随时到岗",
    "熟悉各个所需软件，熟悉专业知识，能够合理应用",
    "期望职位",
    "赣州 兼职·主播 行业不限",
    "个人优势",
    "熟悉直播和服装设计协作",
    "工作经历",
    "顶皇 服装设计师",
    "教育经历",
    "赣州某职业学校 高中",
    "牛人分析器 牛人 11小时前更新过简历，其通常活跃时间为 2-6pm"
  ].join("\n");
  const resumeDocument = createFakeDocument({
    url: "https://www.zhipin.com/web/frame/c-resume/?source=recommend",
    bodyText: "BOSS直聘 页面脚本 wasm 详情加载中 暂无可读候选人文本".repeat(8),
    detailElements: []
  });
  const recommendDocument = createFakeDocument({
    url: "https://www.zhipin.com/web/frame/recommend/?jobid=job1",
    bodyText: "推荐",
    detailElements: [],
    iframes: [createFakeFrame(resumeDocument)]
  });
  const topDocument = createFakeDocument({
    url: "https://www.zhipin.com/web/chat/recommend",
    bodyText: "BOSS直聘 推荐",
    detailElements: [],
    iframes: [createFakeFrame(recommendDocument)]
  });

  const detected = findActiveCandidateDetail(topDocument, classifyPage("https://www.zhipin.com/web/chat/recommend"), {
    readCanvasText: (document) => document === resumeDocument ? canvasText : ""
  });
  const payload = buildCandidateDetailPayload({
    page: classifyPage("https://www.zhipin.com/web/chat/recommend"),
    ...detected
  });

  assert.equal(detected.detectedBy, "c_resume_canvas");
  assert.equal(payload.candidate.profile.displayName, "廖淑雯");
  assert.equal(payload.candidate.profile.activeStatus, "3日内活跃");
  assert.equal(payload.candidate.profile.age, 27);
  assert.equal(payload.candidate.detailProfile.topSummary.items[0], "熟悉各个所需软件，熟悉专业知识，能够合理应用");
  assert.equal(payload.candidate.detailProfile.sections.workExperience.items[0], "顶皇 服装设计师");
  assert.equal(payload.candidate.detailProfile.bossAnalysis.items[0].includes("通常活跃时间"), true);
  assert.equal(Object.hasOwn(payload, "detail"), false);
});

test("candidate detail detection recognizes spaced canvas boss analysis labels", () => {
  const canvasText = [
    "南葵籽 刚刚活跃",
    "24岁 | 中专/中技 | 8年 | 离职-随时到岗",
    "求职期望",
    "杭州 美工",
    "个人优势",
    "可以独立完成店铺装修和海报设计",
    "工作经历",
    "杭州某公司 美工",
    "教育经历",
    "某职业学校 中专/中技",
    "牛 人 分 析 器",
    "求职意愿 较强，近期更新过简历",
    "查 看 全 部 8 项 分 析"
  ].join("\n");
  const resumeDocument = createFakeDocument({
    url: "https://www.zhipin.com/web/frame/c-resume/?source=recommend",
    bodyText: "BOSS直聘 页面脚本 wasm 详情加载中 暂无可读候选人文本".repeat(8),
    detailElements: []
  });
  const recommendDocument = createFakeDocument({
    url: "https://www.zhipin.com/web/frame/recommend/?jobid=job1",
    bodyText: "推荐",
    detailElements: [],
    iframes: [createFakeFrame(resumeDocument)]
  });
  const topDocument = createFakeDocument({
    url: "https://www.zhipin.com/web/chat/recommend",
    bodyText: "BOSS直聘 推荐",
    detailElements: [],
    iframes: [createFakeFrame(recommendDocument)]
  });

  const detected = findActiveCandidateDetail(topDocument, classifyPage("https://www.zhipin.com/web/chat/recommend"), {
    readCanvasText: (document) => document === resumeDocument ? canvasText : ""
  });
  const payload = buildCandidateDetailPayload({
    page: classifyPage("https://www.zhipin.com/web/chat/recommend"),
    ...detected
  });

  assert.equal(detected.analysisVisible, true);
  assert.equal(payload.analysis.module, "boss_analysis");
  assert.equal(payload.candidate.detailProfile.bossAnalysis.title, "牛人分析器");
  assert.equal(payload.candidate.detailProfile.bossAnalysis.items[0].includes("求职意愿"), true);
  assert.equal(payload.candidate.detailProfile.bossAnalysis.actionText, "查看全部8项分析");
});

test("candidate detail detection falls back to selected recommendation card for empty c-resume iframe", () => {
  const selectedCard = createFakeElement({
    className: "geek-card active",
    text: [
      "陈女士 刚刚活跃",
      "8-10K",
      "24岁 3年 本科 离职-随时到岗",
      "期望 杭州 网络销售",
      "打招呼"
    ].join("\n"),
    dataset: {
      securityId: "sec_1"
    }
  });
  const resumeDocument = createFakeDocument({
    url: "https://www.zhipin.com/web/frame/c-resume/?source=recommend",
    bodyText: "BOSS直聘 页面脚本 wasm 详情加载中 暂无可读候选人文本".repeat(8),
    detailElements: []
  });
  const recommendDocument = createFakeDocument({
    url: "https://www.zhipin.com/web/frame/recommend/?jobid=job1",
    bodyText: "推荐",
    detailElements: [],
    selectedElements: [selectedCard],
    iframes: [createFakeFrame(resumeDocument)]
  });
  const topDocument = createFakeDocument({
    url: "https://www.zhipin.com/web/chat/recommend",
    bodyText: "BOSS直聘 推荐",
    detailElements: [],
    iframes: [createFakeFrame(recommendDocument)]
  });

  const detected = findActiveCandidateDetail(topDocument, classifyPage("https://www.zhipin.com/web/chat/recommend"));
  const payload = buildCandidateDetailPayload({
    page: classifyPage("https://www.zhipin.com/web/chat/recommend"),
    ...detected
  });

  assert.equal(detected.detectedBy, "c_resume_selected_card");
  assert.equal(payload.detailUrl, "https://www.zhipin.com/web/frame/c-resume/?source=recommend");
  assert.equal(payload.candidate.stableId, "sec_1");
  assert.equal(payload.candidate.stableIdSource, "dataset.securityId");
  assert.equal(payload.candidate.profile.displayName, "陈女士");
  assert.equal(payload.candidate.profile.expectedLocation, "杭州");
  assert.equal(payload.candidate.profile.expectedPosition, "网络销售");
  assert.equal(payload.candidate.detailProfile, undefined);
  assert.equal(Object.hasOwn(payload, "detail"), false);
});

test("candidate detail selected-card fallback keeps visible boss analysis marker", () => {
  const selectedCard = createFakeElement({
    className: "geek-card active",
    text: [
      "刘心雨 刚刚活跃",
      "23岁 本科 25年应届生",
      "期望 杭州 主播",
      "打招呼"
    ].join("\n"),
    dataset: {
      securityId: "liuxinyu_sec_1"
    }
  });
  const resumeDocument = createFakeDocument({
    url: "https://www.zhipin.com/web/frame/c-resume/?source=recommend",
    bodyText: [
      "BOSS直聘 页面脚本 wasm",
      "牛人分析器",
      "查看全部8项分析"
    ].join("\n"),
    detailElements: []
  });
  const recommendDocument = createFakeDocument({
    url: "https://www.zhipin.com/web/frame/recommend/?jobid=job1",
    bodyText: "推荐",
    detailElements: [],
    selectedElements: [selectedCard],
    iframes: [createFakeFrame(resumeDocument)]
  });
  const topDocument = createFakeDocument({
    url: "https://www.zhipin.com/web/chat/recommend",
    bodyText: "BOSS直聘 推荐",
    detailElements: [],
    iframes: [createFakeFrame(recommendDocument)]
  });

  const detected = findActiveCandidateDetail(topDocument, classifyPage("https://www.zhipin.com/web/chat/recommend"));
  const payload = buildCandidateDetailPayload({
    page: classifyPage("https://www.zhipin.com/web/chat/recommend"),
    ...detected
  });

  assert.equal(detected.detectedBy, "c_resume_selected_card");
  assert.equal(payload.candidate.profile.displayName, "刘心雨");
  assert.equal(payload.candidate.detailProfile, undefined);
  assert.equal(payload.analysis.module, "boss_analysis");
});

test("candidate detail selected-card fallback does not mix c-resume bottom recommendation noise", () => {
  const selectedCard = createFakeElement({
    className: "geek-card active",
    text: [
      "廖淑雯 3日内活跃 27岁",
      "10年",
      "高中",
      "离职-随时到岗",
      "顶皇 服装设计师",
      "赣州 兼职·主播",
      "设计师 图案设计 快时尚设计 CDR",
      "打招呼"
    ].join("\n"),
    dataset: {
      securityId: "liao_sec_1"
    }
  });
  const resumeDocument = createFakeDocument({
    url: "https://www.zhipin.com/web/frame/c-resume/?source=recommend",
    bodyText: [
      "!function(){var e=document,t=e.createElement(\"script\");document.createElement(\"script\")}",
      "其他 名校 毕业的牛人",
      "何** 热搜",
      "27岁 6年 大专 离职-随时到岗 4-9K",
      "期望职位： 主播",
      "经历： 佳腾电业（赣州）·行政专员/助理",
      "院校： 江西环境工程职业学院·酒店管理学",
      "收藏 不合适 举报 转发牛人 打招呼"
    ].join("\n"),
    detailElements: []
  });
  const recommendDocument = createFakeDocument({
    url: "https://www.zhipin.com/web/frame/recommend/?jobid=job1",
    bodyText: "推荐",
    detailElements: [],
    selectedElements: [selectedCard],
    iframes: [createFakeFrame(resumeDocument)]
  });
  const topDocument = createFakeDocument({
    url: "https://www.zhipin.com/web/chat/recommend",
    bodyText: "BOSS直聘 推荐",
    detailElements: [],
    iframes: [createFakeFrame(recommendDocument)]
  });

  const detected = findActiveCandidateDetail(topDocument, classifyPage("https://www.zhipin.com/web/chat/recommend"));
  const payload = buildCandidateDetailPayload({
    page: classifyPage("https://www.zhipin.com/web/chat/recommend"),
    ...detected
  });

  assert.equal(detected.detectedBy, "c_resume_selected_card");
  assert.equal(payload.candidate.stableId, "liao_sec_1");
  assert.equal(payload.candidate.profile.displayName, "廖淑雯");
  assert.equal(payload.candidate.profile.activeStatus, "3日内活跃");
  assert.equal(payload.candidate.profile.experience, "10年");
  assert.equal(payload.candidate.profile.education, "高中");
  assert.equal(payload.candidate.detailProfile, undefined);
  assert.equal(JSON.stringify(payload).includes("何**"), false);
});

test("candidate detail selected-card fallback ignores grouped recommendation section noise", () => {
  const selectedCard = createFakeElement({
    className: "geek-card active",
    text: [
      "z** 21岁 1年 中专/中技 离职-随时到岗6-11K",
      "期望职位： 主播",
      "经历：一点格调·主播",
      "院校：中专/中技·对口高考",
      "瑶** 热搜 35岁 7年 高中 离职-随时到岗 面议",
      "期望职位： 主播",
      "经历：越时空服饰·主播",
      "刘** 热搜 26岁 6年 大专 离职-随时到岗 13-25K",
      "期望职位： 主播",
      "经历：简屿服装·主播",
      "收藏 不合适 举报 转发牛人 打招呼"
    ].join("\n")
  });
  const resumeDocument = createFakeDocument({
    url: "https://www.zhipin.com/web/frame/c-resume/?source=recommend",
    bodyText: "BOSS直聘 页面脚本 wasm 详情加载中 暂无可读候选人文本".repeat(8),
    detailElements: []
  });
  const recommendDocument = createFakeDocument({
    url: "https://www.zhipin.com/web/frame/recommend/?jobid=job1",
    bodyText: "推荐",
    detailElements: [],
    selectedElements: [selectedCard],
    iframes: [createFakeFrame(resumeDocument)]
  });
  const topDocument = createFakeDocument({
    url: "https://www.zhipin.com/web/chat/recommend",
    bodyText: "BOSS直聘 推荐",
    detailElements: [],
    iframes: [createFakeFrame(recommendDocument)]
  });

  const detected = findActiveCandidateDetail(topDocument, classifyPage("https://www.zhipin.com/web/chat/recommend"));
  const payload = buildCandidateDetailPayload({
    page: classifyPage("https://www.zhipin.com/web/chat/recommend"),
    ...detected
  });

  assert.equal(detected.detectedBy, "c_resume_selected_card");
  assert.equal(payload.candidate.profile.displayName, "z**");
  assert.equal(payload.candidate.profile.age, 21);
  assert.equal(payload.candidate.profile.education, "中专/中技");
  assert.equal(payload.candidate.profile.jobSeekingStatus, "离职-随时到岗");
  assert.equal(payload.candidate.profile.salary, "6-11K");
  assert.equal(payload.candidate.detailProfile, undefined);
  assert.equal(Object.hasOwn(payload, "detail"), false);
  assert.equal(JSON.stringify(payload).includes("瑶**"), false);
  assert.equal(JSON.stringify(payload).includes("刘**"), false);
});

test("candidate detail detection matches Li Daqian card from c-resume work details", () => {
  const liDaqianCard = createFakeElement({
    text: [
      "李大钱 刚刚活跃 24岁",
      "4年",
      "大专",
      "在职-暂不考虑",
      "雅戈尔 带货主播",
      "赣州 兼职·主播",
      "办公环境管理 接待礼仪 名片工牌制作",
      "打招呼"
    ].join("\n"),
    dataset: {
      securityId: "li_sec_1"
    }
  });
  const liDaqianAction = createFakeElement({ text: "打招呼" });
  liDaqianAction.parentElement = liDaqianCard;
  const otherCard = createFakeElement({
    text: [
      "古小丽 26岁",
      "4年",
      "本科",
      "离职-随时到岗",
      "赣州安太妇产医院 主播",
      "赣州 兼职·主播",
      "打招呼"
    ].join("\n")
  });
  const otherAction = createFakeElement({ text: "打招呼" });
  otherAction.parentElement = otherCard;
  const resumeDocument = createFakeDocument({
    url: "https://www.zhipin.com/web/frame/c-resume/?source=recommend",
    bodyText: [
      "其他 名校 毕业的牛人",
      "收藏 不合适 举报 转发牛人 打招呼",
      "经历概览",
      "雅戈尔时尚股份有限公司 2024.04 - 至今",
      "带货主播",
      "美克国际家居用品股份有限公司 2022.08 - 2024.03",
      "行政公关",
      "北京京西宾馆管理局 2021.05 - 2021.09",
      "礼仪接待",
      "江西现代职业技术学院 2019 - 2022",
      "空中乘务 • 大专"
    ].join("\n"),
    detailElements: []
  });
  const recommendDocument = createFakeDocument({
    url: "https://www.zhipin.com/web/frame/recommend/?jobid=job1",
    bodyText: "推荐",
    detailElements: [],
    actionElements: [liDaqianAction, otherAction],
    iframes: [createFakeFrame(resumeDocument)]
  });
  const topDocument = createFakeDocument({
    url: "https://www.zhipin.com/web/chat/recommend",
    bodyText: "BOSS直聘 推荐",
    detailElements: [],
    iframes: [createFakeFrame(recommendDocument)]
  });

  const detected = findActiveCandidateDetail(topDocument, classifyPage("https://www.zhipin.com/web/chat/recommend"));
  const payload = buildCandidateDetailPayload({
    page: classifyPage("https://www.zhipin.com/web/chat/recommend"),
    ...detected
  });

  assert.equal(detected.detectedBy, "c_resume_matched_card");
  assert.equal(payload.candidate.stableId, "li_sec_1");
  assert.equal(payload.candidate.stableIdSource, "dataset.securityId");
  assert.equal(payload.candidate.profile.displayName, "李大钱");
  assert.equal(payload.candidate.profile.age, 24);
  assert.equal(payload.candidate.profile.experience, "4年");
  assert.equal(payload.candidate.profile.education, "大专");
  assert.equal(payload.candidate.detailProfile.sections.workExperience.items[0], "雅戈尔时尚股份有限公司 2024.04 - 至今");
});

test("candidate detail detection splits grouped recommendation card text before matching Li Daqian", () => {
  const groupedCardText = [
    "古小丽 26岁",
    "4年",
    "本科",
    "离职-随时到岗",
    "赣州安太妇产医院 主播",
    "赣州 兼职·主播",
    "打招呼",
    "李大钱 刚刚活跃 24岁",
    "4年",
    "大专",
    "在职-暂不考虑",
    "雅戈尔 带货主播",
    "赣州 兼职·主播",
    "办公环境管理 接待礼仪 名片工牌制作",
    "打招呼"
  ].join("\n");
  const groupedCandidateContainer = createFakeElement({
    text: groupedCardText
  });
  const liDaqianAction = createFakeElement({ text: "打招呼" });
  liDaqianAction.parentElement = groupedCandidateContainer;
  const resumeDocument = createFakeDocument({
    url: "https://www.zhipin.com/web/frame/c-resume/?source=recommend",
    bodyText: [
      "收藏 不合适 举报 转发牛人 打招呼",
      "经历概览",
      "雅戈尔时尚股份有限公司 2024.04 - 至今",
      "带货主播",
      "江西现代职业技术学院 2019 - 2022",
      "空中乘务 • 大专"
    ].join("\n"),
    detailElements: []
  });
  const recommendDocument = createFakeDocument({
    url: "https://www.zhipin.com/web/frame/recommend/?jobid=job1",
    bodyText: "推荐",
    detailElements: [],
    actionElements: [liDaqianAction],
    iframes: [createFakeFrame(resumeDocument)]
  });
  const topDocument = createFakeDocument({
    url: "https://www.zhipin.com/web/chat/recommend",
    bodyText: "BOSS直聘 推荐",
    detailElements: [],
    iframes: [createFakeFrame(recommendDocument)]
  });

  const detected = findActiveCandidateDetail(topDocument, classifyPage("https://www.zhipin.com/web/chat/recommend"));
  const payload = buildCandidateDetailPayload({
    page: classifyPage("https://www.zhipin.com/web/chat/recommend"),
    ...detected
  });

  assert.equal(detected.detectedBy, "c_resume_matched_card");
  assert.equal(payload.candidate.stableIdSource, "text_fingerprint");
  assert.equal(payload.candidate.profile.displayName, "李大钱");
  assert.equal(payload.candidate.profile.age, 24);
  assert.equal(payload.candidate.profile.education, "大专");
  assert.equal(payload.candidate.detailProfile.sections.workExperience.items[0], "雅戈尔时尚股份有限公司 2024.04 - 至今");
});

test("candidate detail detection reads actual text from accessibility attributes", () => {
  const accessibleText = [
    "孙女士 刚刚活跃",
    "8k",
    "24岁 2年 大专 离职-随时到岗",
    "求职期望",
    "杭州 主播顾问",
    "工作经历",
    "杭州某文化传媒有限公司 主播顾问",
    "教育经历",
    "浙江某职业学院 大专",
    "收藏 不合适 举报 转发牛人"
  ].join("\n");
  const detailElement = createFakeElement({
    className: "candidate-detail resume-panel",
    text: "",
    attributes: {
      "aria-label": accessibleText
    }
  });
  const document = createFakeDocument({
    url: "https://www.zhipin.com/web/chat/recommend",
    bodyText: "",
    detailElements: [detailElement]
  });

  const detected = findActiveCandidateDetail(document, classifyPage("https://www.zhipin.com/web/chat/recommend"));
  const payload = buildCandidateDetailPayload({
    page: classifyPage("https://www.zhipin.com/web/chat/recommend"),
    ...detected
  });

  assert.equal(detected.text, accessibleText);
  assert.equal(payload.candidate.profile.displayName, "孙女士");
  assert.deepEqual(payload.candidate.detailProfile.sections.jobExpectation.items, ["杭州 主播顾问"]);
});

test("candidate detail probe emits open once and closes when detail disappears", () => {
  let now = 1000;
  let activeDetail = {
    sourceUrl: "https://www.zhipin.com/web/chat/index?geekId=abc123",
    text: "吴先生 28岁 求职期望 杭州 直播运营 工作经历 A 教育经历 B",
    detectedBy: "detail_url"
  };
  const collector = createCollector();
  const probe = new CandidateDetailProbe({
    collector,
    sessionContext: createSessionContext("https://www.zhipin.com/web/chat/recommend"),
    openDeferMs: 0,
    detectActiveDetail: () => activeDetail,
    now: () => now
  });

  probe.scan("poll");
  probe.scan("poll");
  activeDetail = null;
  now = 3500;
  probe.scan("poll");

  assert.deepEqual(
    collector.events.map((event) => event.type),
    [
      EVENT_TYPES.CANDIDATE_DETAIL_OPENED,
      EVENT_TYPES.CANDIDATE_DETAIL_CLOSED
    ]
  );
  assert.equal(collector.events[1].payload.reason, "detail_disappeared");
  assert.equal(collector.events[1].payload.durationMs, 2500);
  assert.equal(collector.events[1].payload.openedEventId, "evt_1");
});

test("candidate detail probe keeps active detail association fresh until close", () => {
  let now = 1000;
  let activeDetail = {
    sourceUrl: "https://www.zhipin.com/web/frame/c-resume/?source=recommend",
    text: [
      "刘心雨 刚刚活跃",
      "23岁 本科 25年应届生",
      "求职期望 杭州 主播",
      "工作经历 A",
      "教育经历 B"
    ].join("\n"),
    detectedBy: "c_resume_frame"
  };
  const collector = createCollector();
  const probe = new CandidateDetailProbe({
    collector,
    sessionContext: createSessionContext("https://www.zhipin.com/web/chat/recommend"),
    openDeferMs: 0,
    detectActiveDetail: () => activeDetail,
    now: () => now
  });

  probe.scan("poll");
  now += 45_000;
  probe.scan("poll");

  const refreshedAssociation = getRecentCandidateDetailAssociation({
    maxAgeMs: 30_000,
    now: () => now + 1000
  });
  assert.equal(refreshedAssociation?.candidate.profile.displayName, "刘心雨");

  activeDetail = null;
  now += 1000;
  probe.scan("poll");

  assert.equal(getRecentCandidateDetailAssociation({
    maxAgeMs: 30_000,
    now: () => now
  }), null);
});

test("candidate detail opened carries boss analysis marker without standalone analysis event", () => {
  const activeDetail = {
    sourceUrl: "https://www.zhipin.com/web/chat/index?geekId=abc123",
    text: [
      "吴先生 28岁 求职期望 杭州 主播",
      "工作经历 A",
      "教育经历 B",
      "牛人分析器",
      "牛人 10小时前 更新过简历，其通常活跃时间为 2-6pm",
      "查看全部8项分析"
    ].join("\n"),
    detectedBy: "detail_url"
  };
  const collector = createCollector();
  const probe = new CandidateDetailProbe({
    collector,
    sessionContext: createSessionContext("https://www.zhipin.com/web/chat/recommend"),
    openDeferMs: 0,
    detectActiveDetail: () => activeDetail,
    now: () => 1000
  });

  probe.scan("poll");
  probe.scan("poll");

  assert.deepEqual(
    collector.events.map((event) => event.type),
    [EVENT_TYPES.CANDIDATE_DETAIL_OPENED]
  );
  assert.equal(collector.events[0].payload.analysis.module, "boss_analysis");
  assert.equal(collector.events[0].payload.candidate.detailProfile.bossAnalysis.actionText, "查看全部8项分析");
});

test("candidate detail probe waits briefly for async boss analysis before opening", () => {
  let now = 1000;
  let activeDetail = {
    sourceUrl: "https://www.zhipin.com/web/chat/index?geekId=abc123",
    text: "吴先生 28岁 求职期望 杭州 主播 工作经历 A 教育经历 B",
    detectedBy: "detail_url"
  };
  const collector = createCollector();
  const probe = new CandidateDetailProbe({
    collector,
    sessionContext: createSessionContext("https://www.zhipin.com/web/chat/recommend"),
    detectActiveDetail: () => activeDetail,
    now: () => now
  });

  probe.scan("poll");
  assert.deepEqual(collector.events, []);

  now = 1800;
  activeDetail = {
    ...activeDetail,
    text: [
      activeDetail.text,
      "牛人分析器",
      "查看全部8项分析"
    ].join("\n")
  };
  probe.scan("poll");

  assert.deepEqual(
    collector.events.map((event) => event.type),
    [EVENT_TYPES.CANDIDATE_DETAIL_OPENED]
  );
  assert.equal(collector.events[0].payload.analysis.module, "boss_analysis");
});

test("candidate detail probe emits pending opened after defer window without analysis", () => {
  let now = 1000;
  const activeDetail = {
    sourceUrl: "https://www.zhipin.com/web/chat/index?geekId=abc123",
    text: "吴先生 28岁 求职期望 杭州 主播 工作经历 A 教育经历 B",
    detectedBy: "detail_url"
  };
  const collector = createCollector();
  const probe = new CandidateDetailProbe({
    collector,
    sessionContext: createSessionContext("https://www.zhipin.com/web/chat/recommend"),
    detectActiveDetail: () => activeDetail,
    now: () => now
  });

  probe.scan("poll");
  now = 2600;
  probe.scan("poll");

  assert.deepEqual(
    collector.events.map((event) => event.type),
    [EVENT_TYPES.CANDIDATE_DETAIL_OPENED]
  );
  assert.equal(collector.events[0].payload.analysis, undefined);
});

test("candidate detail probe flushes pending opened before quick close", () => {
  let now = 1000;
  let activeDetail = {
    sourceUrl: "https://www.zhipin.com/web/chat/index?geekId=abc123",
    text: "吴先生 28岁 求职期望 杭州 主播 工作经历 A 教育经历 B",
    detectedBy: "detail_url"
  };
  const collector = createCollector();
  const probe = new CandidateDetailProbe({
    collector,
    sessionContext: createSessionContext("https://www.zhipin.com/web/chat/recommend"),
    detectActiveDetail: () => activeDetail,
    now: () => now
  });

  probe.scan("poll");
  activeDetail = null;
  now = 1100;
  probe.scan("poll");

  assert.deepEqual(
    collector.events.map((event) => event.type),
    [
      EVENT_TYPES.CANDIDATE_DETAIL_OPENED,
      EVENT_TYPES.CANDIDATE_DETAIL_CLOSED
    ]
  );
  assert.equal(collector.events[1].payload.reason, "detail_disappeared");
  assert.equal(collector.events[1].payload.openedEventId, "evt_1");
  assert.equal(collector.events[1].payload.durationMs, 100);
});

test("candidate detail probe flushes pending opened before candidate switch", () => {
  let now = 1000;
  let activeDetail = {
    sourceUrl: "https://www.zhipin.com/web/chat/index?geekId=abc123",
    text: "吴先生 28岁 求职期望 杭州 主播 工作经历 A 教育经历 B",
    detectedBy: "detail_url"
  };
  const collector = createCollector();
  const probe = new CandidateDetailProbe({
    collector,
    sessionContext: createSessionContext("https://www.zhipin.com/web/chat/recommend"),
    detectActiveDetail: () => activeDetail,
    now: () => now
  });

  probe.scan("poll");
  activeDetail = {
    sourceUrl: "https://www.zhipin.com/web/chat/index?geekId=def456",
    text: "李女士 26岁 求职期望 杭州 运营 工作经历 A 教育经历 B",
    detectedBy: "detail_url"
  };
  now = 1200;
  probe.scan("poll");

  assert.deepEqual(
    collector.events.map((event) => event.type),
    [
      EVENT_TYPES.CANDIDATE_DETAIL_OPENED,
      EVENT_TYPES.CANDIDATE_DETAIL_CLOSED
    ]
  );
  assert.equal(collector.events[0].payload.candidate.stableId, "abc123");
  assert.equal(collector.events[1].payload.reason, "candidate_switched");
  assert.equal(collector.events[1].payload.openedEventId, "evt_1");

  now = 2800;
  probe.scan("poll");
  assert.equal(collector.events[2].type, EVENT_TYPES.CANDIDATE_DETAIL_OPENED);
  assert.equal(collector.events[2].payload.candidate.stableId, "def456");
});

test("candidate detail probe re-emits opened when boss analysis appears later", () => {
  let activeDetail = {
    sourceUrl: "https://www.zhipin.com/web/chat/index?geekId=abc123",
    text: "吴先生 28岁 求职期望 杭州 主播 工作经历 A 教育经历 B",
    detectedBy: "detail_url"
  };
  const collector = createCollector();
  const probe = new CandidateDetailProbe({
    collector,
    sessionContext: createSessionContext("https://www.zhipin.com/web/chat/recommend"),
    openDeferMs: 0,
    detectActiveDetail: () => activeDetail,
    now: () => 1000
  });

  probe.scan("poll");
  activeDetail = {
    ...activeDetail,
    text: [
      activeDetail.text,
      "牛人分析器",
      "受欢迎程度 较高，被沟通次数超过 55% 的同类牛人",
      "查看全部8项分析"
    ].join("\n")
  };
  probe.scan("poll");

  assert.deepEqual(
    collector.events.map((event) => event.type),
    [
      EVENT_TYPES.CANDIDATE_DETAIL_OPENED,
      EVENT_TYPES.CANDIDATE_DETAIL_OPENED
    ]
  );
  assert.equal(collector.events[0].payload.analysis, undefined);
  assert.equal(collector.events[1].payload.analysis.module, "boss_analysis");
});

test("candidate detail probe closes previous detail before opening switched candidate", () => {
  let activeDetail = {
    sourceUrl: "https://www.zhipin.com/web/chat/index?geekId=abc123",
    text: "吴先生 28岁 求职期望 杭州 直播运营 工作经历 A 教育经历 B",
    detectedBy: "detail_url"
  };
  const collector = createCollector();
  const probe = new CandidateDetailProbe({
    collector,
    sessionContext: createSessionContext("https://www.zhipin.com/web/chat/recommend"),
    openDeferMs: 0,
    detectActiveDetail: () => activeDetail,
    now: () => 1000
  });

  probe.scan("poll");
  activeDetail = {
    sourceUrl: "https://www.zhipin.com/web/chat/index?geekId=def456",
    text: "李女士 26岁 求职期望 杭州 用户运营 工作经历 A 教育经历 B",
    detectedBy: "detail_url"
  };
  probe.scan("poll");

  assert.deepEqual(
    collector.events.map((event) => event.type),
    [
      EVENT_TYPES.CANDIDATE_DETAIL_OPENED,
      EVENT_TYPES.CANDIDATE_DETAIL_CLOSED,
      EVENT_TYPES.CANDIDATE_DETAIL_OPENED
    ]
  );
  assert.equal(collector.events[1].payload.reason, "candidate_switched");
  assert.equal(collector.events[2].payload.candidate.stableId, "def456");
});

test("candidate detail probe does not close and reopen while text-only detail is still loading", () => {
  let now = 1000;
  let activeDetail = {
    sourceUrl: "https://www.zhipin.com/web/frame/c-resume/?source=recommend",
    text: "魏杰 25岁 求职期望 杭州 客户经理 收藏 不合适 经历概览 深圳市信银企业服务有限公司 教育经历 浙江农林大学",
    detectedBy: "detail_dom"
  };
  const collector = createCollector();
  const probe = new CandidateDetailProbe({
    collector,
    sessionContext: createSessionContext("https://www.zhipin.com/web/chat/recommend"),
    openDeferMs: 0,
    detectActiveDetail: () => activeDetail,
    now: () => now
  });

  probe.scan("poll");
  now = 3000;
  activeDetail = {
    ...activeDetail,
    text: `${activeDetail.text} 新增加载出的详情文本 资格证书`
  };
  probe.scan("poll");

  assert.deepEqual(
    collector.events.map((event) => event.type),
    [EVENT_TYPES.CANDIDATE_DETAIL_OPENED]
  );
});

test("candidate detail probe emits opened again when placeholder detail becomes rich", () => {
  let now = 1000;
  let activeDetail = {
    sourceUrl: "https://www.zhipin.com/web/frame/c-resume/?source=recommend",
    text: "魏杰 25岁 求职期望 杭州 客户经理 收藏 不合适 经历概览 教育经历",
    detectedBy: "detail_dom"
  };
  const collector = createCollector();
  const probe = new CandidateDetailProbe({
    collector,
    sessionContext: createSessionContext("https://www.zhipin.com/web/chat/recommend"),
    openDeferMs: 0,
    detectActiveDetail: () => activeDetail,
    now: () => now
  });

  probe.scan("poll");
  now = 3000;
  activeDetail = {
    ...activeDetail,
    text: [
      "魏杰 25岁 求职期望",
      "杭州 客户经理",
      "个人优势",
      "熟悉客户维护和销售转化",
      "经历概览",
      "深圳市信银企业服务有限公司 客户经理",
      "教育经历",
      "浙江农林大学 本科"
    ].join("\n")
  };
  probe.scan("poll");

  assert.deepEqual(
    collector.events.map((event) => event.type),
    [
      EVENT_TYPES.CANDIDATE_DETAIL_OPENED,
      EVENT_TYPES.CANDIDATE_DETAIL_OPENED
    ]
  );
  assert.equal(collector.events[1].payload.candidate.detailProfile.sections.advantage.items[0], "熟悉客户维护和销售转化");
});

test("candidate detail probe inherits exposure association for c-resume detail after card click", () => {
  const cardElement = createRegistryElement();
  const association = registerCandidateCardAssociation({
    element: cardElement,
    candidate: {
      stableId: "geek-7",
      stableIdSource: "url.geekId",
      detailUrl: "https://www.zhipin.com/web/chat/index?geekId=geek-7",
      profile: {
        displayName: "周先生",
        age: 29,
        expectedPosition: "主播"
      }
    },
    listUrl: "https://www.zhipin.com/web/chat/recommend",
    listPageType: "candidate_recommend",
    exposedEventId: "evt_exposed"
  });
  recordCandidateCardInteraction(association.cardId, {
    interactionType: "candidate_card_click",
    sourceUrl: "https://www.zhipin.com/web/frame/recommend/",
    now: () => 1000
  });

  const collector = createCollector();
  const probe = new CandidateDetailProbe({
    collector,
    sessionContext: createSessionContext("https://www.zhipin.com/web/chat/recommend"),
    openDeferMs: 0,
    detectActiveDetail: () => ({
      sourceUrl: "https://www.zhipin.com/web/frame/c-resume/?source=recommend",
      text: "BOSS直聘 页面脚本 wasm 详情加载中 暂无可读候选人文本",
      detectedBy: "c_resume_frame"
    }),
    now: () => 1500
  });

  probe.scan("poll");

  assert.equal(collector.events[0].type, EVENT_TYPES.CANDIDATE_DETAIL_OPENED);
  assert.equal(collector.events[0].payload.candidate.stableId, "geek-7");
  assert.equal(collector.events[0].payload.candidate.stableIdSource, "url.geekId");
  assert.equal(collector.events[0].payload.candidate.candidateId, association.cardId);
  assert.equal(collector.events[0].payload.candidate.exposureKey, association.exposureKey);
  assert.equal(collector.events[0].payload.candidate.exposedEventId, "evt_exposed");
  assert.equal(collector.events[0].payload.candidate.profile.displayName, "周先生");
  assert.equal(collector.events[0].payload.candidate.profile.expectedPosition, "主播");
});

test("candidate detail probe reconnects conflicting recent association to exact exposed candidate", () => {
  const text = [
    "钟林林 刚刚活跃",
    "3-8K",
    "22岁 25年应届生 大专 应届生",
    "打招呼"
  ].join("\n");
  const currentCandidate = buildCandidateSnapshotPayload({
    text,
    sourceUrl: "https://www.zhipin.com/web/frame/recommend/?jobid=job-1"
  });
  const currentAssociation = registerCandidateCardAssociation({
    element: createRegistryElement(),
    candidate: currentCandidate,
    listUrl: "https://www.zhipin.com/web/chat/recommend",
    listPageType: "candidate_recommend",
    exposedEventId: "evt_current"
  });
  const staleAssociation = registerCandidateCardAssociation({
    element: createRegistryElement(),
    candidate: {
      stableId: "card_stale",
      stableIdSource: "text_fingerprint",
      profile: {
        displayName: "何**",
        age: 27
      }
    },
    listUrl: "https://www.zhipin.com/web/chat/recommend",
    listPageType: "candidate_recommend",
    exposedEventId: "evt_stale"
  });
  const collector = createCollector();
  const probe = new CandidateDetailProbe({
    collector,
    sessionContext: createSessionContext("https://www.zhipin.com/web/chat/recommend"),
    openDeferMs: 0,
    getRecentCandidateCardAssociation: () => staleAssociation,
    detectActiveDetail: () => ({
      sourceUrl: "https://www.zhipin.com/web/frame/c-resume/?source=recommend",
      candidateSourceUrl: "https://www.zhipin.com/web/frame/recommend/?jobid=job-1",
      text,
      detectedBy: "c_resume_selected_card"
    }),
    now: () => 1000
  });

  probe.scan("poll");

  assert.equal(collector.events[0].type, EVENT_TYPES.CANDIDATE_DETAIL_OPENED);
  assert.equal(collector.events[0].payload.candidate.candidateId, currentAssociation.cardId);
  assert.equal(collector.events[0].payload.candidate.exposureKey, currentAssociation.exposureKey);
  assert.equal(collector.events[0].payload.candidate.exposedEventId, "evt_current");
  assert.equal(collector.events[0].payload.candidate.profile.displayName, "钟林林");
  assert.notEqual(collector.events[0].payload.candidate.candidateId, staleAssociation.cardId);
});

test("candidate detail probe prefers recent clicked card over stale selected fallback", () => {
  const miyaText = [
    "Miya 刚刚活跃",
    "27岁 9年 本科 离职-随时到岗",
    "钒熹商贸 新媒体运营",
    "赣州 兼职·主播",
    "211院校 影视新媒体",
    "打招呼"
  ].join("\n");
  const yuingText = [
    "面议 yuing 刚刚活跃 24岁",
    "21年毕业 大专",
    "顶至影视 带货主播",
    "赣州 主持人/主播/DJ",
    "打招呼"
  ].join("\n");
  const miyaAssociation = registerCandidateCardAssociation({
    element: createRegistryElement(),
    candidate: buildCandidateSnapshotPayload({
      text: miyaText,
      sourceUrl: "https://www.zhipin.com/web/frame/recommend/?jobid=job-1"
    }),
    listUrl: "https://www.zhipin.com/web/chat/recommend",
    listPageType: "candidate_recommend",
    sourceUrl: "https://www.zhipin.com/web/frame/recommend/?jobid=job-1",
    exposedEventId: "evt_miya"
  });
  const staleSelectedAssociation = registerCandidateCardAssociation({
    element: createRegistryElement(),
    candidate: buildCandidateSnapshotPayload({
      text: yuingText,
      sourceUrl: "https://www.zhipin.com/web/frame/recommend/?jobid=job-1"
    }),
    listUrl: "https://www.zhipin.com/web/chat/recommend",
    listPageType: "candidate_recommend",
    sourceUrl: "https://www.zhipin.com/web/frame/recommend/?jobid=job-1",
    exposedEventId: "evt_yuing"
  });
  const collector = createCollector();
  const probe = new CandidateDetailProbe({
    collector,
    sessionContext: createSessionContext("https://www.zhipin.com/web/chat/recommend"),
    openDeferMs: 0,
    getRecentCandidateCardAssociation: () => miyaAssociation,
    detectActiveDetail: () => ({
      sourceUrl: "https://www.zhipin.com/web/frame/c-resume/?source=recommend",
      candidateSourceUrl: "https://www.zhipin.com/web/frame/recommend/?jobid=job-1",
      text: yuingText,
      candidateAssociation: staleSelectedAssociation,
      detectedBy: "c_resume_selected_card",
      textSources: {
        usedOwnDetailText: false,
        candidateCardMatchedBy: "selected_state"
      }
    }),
    now: () => 1000
  });

  probe.scan("poll");

  assert.equal(collector.events[0].type, EVENT_TYPES.CANDIDATE_DETAIL_OPENED);
  assert.equal(collector.events[0].payload.detectedBy, "c_resume_recent_card");
  assert.equal(collector.events[0].payload.candidate.candidateId, miyaAssociation.cardId);
  assert.equal(collector.events[0].payload.candidate.exposureKey, miyaAssociation.exposureKey);
  assert.equal(collector.events[0].payload.candidate.exposedEventId, "evt_miya");
  assert.equal(collector.events[0].payload.candidate.profile.displayName, "Miya");
  assert.notEqual(collector.events[0].payload.candidate.candidateId, staleSelectedAssociation.cardId);
  assert.equal(JSON.stringify(collector.events[0].payload).includes("yuing"), false);
});

test("candidate detail probe keeps active exposure association after recent click ttl", () => {
  let now = 1000;
  const association = registerCandidateCardAssociation({
    element: createRegistryElement(),
    candidate: {
      stableId: "geek-8",
      stableIdSource: "url.geekId",
      profile: {
        displayName: "许女士",
        expectedPosition: "运营"
      }
    },
    listUrl: "https://www.zhipin.com/web/chat/recommend",
    listPageType: "candidate_recommend",
    exposedEventId: "evt_exposed"
  });
  recordCandidateCardInteraction(association.cardId, {
    interactionType: "candidate_card_click",
    sourceUrl: "https://www.zhipin.com/web/frame/recommend/",
    now: () => now
  });
  const collector = createCollector();
  const probe = new CandidateDetailProbe({
    collector,
    sessionContext: createSessionContext("https://www.zhipin.com/web/chat/recommend"),
    openDeferMs: 0,
    detectActiveDetail: () => ({
      sourceUrl: "https://www.zhipin.com/web/frame/c-resume/?source=recommend",
      text: "BOSS直聘 页面脚本 wasm 详情加载中 暂无可读候选人文本",
      detectedBy: "c_resume_frame"
    }),
    now: () => now
  });

  probe.scan("poll");
  now = 40000;
  probe.scan("poll");

  assert.deepEqual(
    collector.events.map((event) => event.type),
    [EVENT_TYPES.CANDIDATE_DETAIL_OPENED]
  );
  assert.equal(collector.events[0].payload.candidate.candidateId, association.cardId);
});

test("candidate detail signals deduplicate url and section signals", () => {
  assert.deepEqual(
    detectCandidateDetailSignals(
      "28岁 8-10K 求职期望 杭州 运营 工作经历 A 工作经历 B 收藏 不合适",
      "https://www.zhipin.com/web/chat/index?geekId=abc123"
    ),
    [
      "age",
      "salary",
      "expectation",
      "detail_url",
      "job_expectation_section",
      "work_experience_section",
      "detail_actions"
    ]
  );
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

function createFakeDocument({ url, bodyText, detailElements, iframes = [], selectedElements = [], actionElements = [] }) {
  const document = {
    location: {
      href: url
    },
    readyState: "complete",
    defaultView: {
      innerHeight: 900,
      innerWidth: 1440
    },
    querySelector(selector) {
      return selector === "main" ? null : null;
    },
    querySelectorAll(selector) {
      if (selector === "iframe") {
        return iframes;
      }
      if (String(selector).includes("aria-selected")) {
        return selectedElements;
      }
      if (selector === "button, a") {
        return actionElements;
      }
      return detailElements;
    }
  };
  document.body = createFakeElement({
    className: "candidate-recommend",
    text: bodyText,
    ownerDocument: document
  });
  document.documentElement = document.body;
  for (const element of detailElements) {
    element.ownerDocument = document;
    element.parentElement = document.body;
  }
  for (const element of selectedElements) {
    element.ownerDocument = document;
    element.parentElement = document.body;
  }
  for (const element of actionElements) {
    element.ownerDocument = document;
  }
  return document;
}

function createFakeFrame(contentDocument) {
  return {
    contentDocument,
    ownerDocument: null,
    innerText: "",
    textContent: "",
    getBoundingClientRect() {
      return {
        top: 0,
        left: 0,
        right: 800,
        bottom: 600,
        width: 800,
        height: 600
      };
    }
  };
}

function createFakeElement({
  className = "",
  text = "",
  ownerDocument = null,
  attributes = {},
  dataset = {}
} = {}) {
  return {
    className,
    innerText: text,
    textContent: text,
    dataset,
    ownerDocument,
    parentElement: null,
    getAttribute(name) {
      return attributes[name] || "";
    },
    getBoundingClientRect() {
      return {
        top: 0,
        left: 0,
        right: 800,
        bottom: 600,
        width: 800,
        height: 600
      };
    },
    querySelectorAll() {
      return [];
    }
  };
}

function createRegistryElement() {
  return {
    dataset: {},
    parentElement: null,
    setAttribute() {},
    getAttribute() {
      return "";
    }
  };
}
