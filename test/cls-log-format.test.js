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
        operator: {
          operatorId: "op-1",
          accountName: "张三",
          bossAccountName: "张三",
          bossAccountMatched: true
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
    operator_id: "op-1",
    operator_account_name: "张三",
    boss_account_name: "张三",
    boss_account_matched: "true",
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

test("serializes chat snapshot messages into cls payload_json", () => {
  const body = buildClsAnonymousTracklogBody([
    {
      id: "evt_chat_snapshot",
      type: "candidate_chat.snapshot_captured",
      occurredAt: "2026-05-16T22:21:08.125+08:00",
      pluginVersion: "0.1.0",
      context: {
        sessionId: "session_1",
        pageType: "chat",
        pageUrl: "https://www.zhipin.com/web/chat/index",
        pageTitle: "BOSS直聘",
        isBossPage: true
      },
      payload: {
        candidate: {
          profile: {
            displayName: "蒋姜"
          }
        },
        chat: {
          conversationKey: "conversation-1",
          messageCount: 2,
          messages: [
            {
              messageIndex: 0,
              text: "刚刚看了您发布的这个职位",
              direction: "unknown"
            },
            {
              messageIndex: 1,
              text: "你好，可以聊一聊啊",
              direction: "recruiter"
            }
          ]
        }
      }
    }
  ]);

  const contents = body.logs[0].contents;
  assert.equal(contents.event_type, "candidate_chat.snapshot_captured");
  assert.equal(contents.operator_id, "");
  assert.equal(contents.payload, undefined);
  assert.equal(typeof contents.payload_json, "string");

  const payload = JSON.parse(contents.payload_json);
  assert.equal(payload.chat.messageCount, 2);
  assert.deepEqual(payload.chat.messages.map((message) => message.text), [
    "刚刚看了您发布的这个职位",
    "你好，可以聊一聊啊"
  ]);
});
