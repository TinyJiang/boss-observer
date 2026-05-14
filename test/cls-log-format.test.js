import test from "node:test";
import assert from "node:assert/strict";

import {
  buildClsAnonymousTracklogBody,
  buildClsAnonymousTracklogUrl,
  hasClsAnonymousConfig
} from "../extension/src/shared/cls-log-format.js";

test("detects cls anonymous config when region and topic id are present", () => {
  assert.equal(hasClsAnonymousConfig({ clsRegion: "ap-guangzhou", clsTopicId: "topic-1" }), true);
  assert.equal(hasClsAnonymousConfig({ clsRegion: "", clsTopicId: "topic-1" }), false);
});

test("builds cls anonymous tracklog url from region and topic", () => {
  assert.equal(
    buildClsAnonymousTracklogUrl({ region: "ap-guangzhou", topicId: "topic-1" }),
    "https://ap-guangzhou.cls.tencentcs.com/tracklog?topic_id=topic-1"
  );
});

test("maps a plugin event into cls log contents", () => {
  const body = buildClsAnonymousTracklogBody(
    [
      {
        id: "evt_1",
        type: "page_session.page_changed",
        occurredAt: "2026-05-11T16:04:03.999+08:00",
        pluginVersion: "0.1.0",
        context: {
          sessionId: "session_1",
          pageType: "chat",
          pageUrl: "https://www.zhipin.com/web/chat/recommend",
          pageTitle: "BOSS直聘",
          isBossPage: true,
          jobContext: {
            jobId: "job-1",
            jobStatus: "0"
          },
          startedAt: "2026-05-11T16:03:35.997+08:00"
        },
        payload: {
          source: "poll"
        },
        sourceTabId: 100,
        sourceWindowId: 200,
        sourceTabUrl: "https://www.zhipin.com/web/chat/recommend"
      }
    ],
    { source: "boss-observer-extension" }
  );

  assert.equal(body.source, "boss-observer-extension");
  assert.equal(body.logs.length, 1);
  assert.equal(body.logs[0].time, 1778486643999);
  assert.deepEqual(body.logs[0].contents, {
    event_id: "evt_1",
    event_type: "page_session.page_changed",
    occurred_at: "2026-05-11T16:04:03.999+08:00",
    plugin_version: "0.1.0",
    session_id: "session_1",
    page_type: "chat",
    page_url: "https://www.zhipin.com/web/chat/recommend",
    page_title: "BOSS直聘",
    is_boss_page: "true",
    job_id: "job-1",
    job_status: "0",
    source_tab_id: "100",
    source_window_id: "200",
    source_tab_url: "https://www.zhipin.com/web/chat/recommend",
    payload_json: JSON.stringify({ source: "poll" }),
    context_json: JSON.stringify({
      sessionId: "session_1",
      pageType: "chat",
      pageUrl: "https://www.zhipin.com/web/chat/recommend",
      pageTitle: "BOSS直聘",
      isBossPage: true,
      jobContext: {
        jobId: "job-1",
        jobStatus: "0"
      },
      startedAt: "2026-05-11T16:03:35.997+08:00"
    })
  });
});
