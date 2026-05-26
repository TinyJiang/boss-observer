import test from "node:test";
import assert from "node:assert/strict";

import {
  buildDiagnosticProfile,
  buildDiagnosticProfileFilename,
  DIAGNOSTIC_PROFILE_NETWORK_REQUEST_LIMIT,
  DIAGNOSTIC_PROFILE_RECENT_EVENT_LIMIT,
  summarizeDiagnosticEvent
} from "../extension/src/shared/diagnostic-profile.js";
import { EVENT_TYPES } from "../extension/src/shared/event-types.js";

test("diagnostic profile summarizes runtime state without chat messages or request previews", () => {
  const profile = buildDiagnosticProfile(createDebugState(), {
    manifest: {
      name: "BOSS Observer",
      version: "0.1.0"
    },
    now: () => "2026-05-17T15:20:00.000+08:00"
  });
  const serialized = JSON.stringify(profile);

  assert.equal(profile.schemaVersion, "1.0.0");
  assert.equal(profile.extension.version, "0.1.0");
  assert.equal(profile.runtime.queueSize, 1);
  assert.equal(profile.runtime.config.uploadTargetType, "cls_anonymous");
  assert.equal(profile.runtime.config.clsTopicConfigured, true);
  assert.equal(profile.runtime.config.clsTopicId, undefined);
  assert.equal(profile.runtime.moduleHealth.candidate_chat.status, "ok");
  assert.equal(profile.runtime.productionStats.unreportedChats, undefined);
  assert.equal(profile.runtime.recentEvents[0].payload.candidate.profile.displayName, "蒋姜");
  assert.equal(profile.runtime.recentEvents[0].payload.chat.messageCount, 2);
  assert.equal(profile.runtime.recentEvents[0].payload.chat.coverageLastMessageAt, "2026-05-17T14:40:00.000+08:00");
  assert.equal(profile.runtime.recentEvents[0].payload.chat.listObservedLastMessageAt, "2026-05-17T14:40:00.000+08:00");
  assert.equal(profile.runtime.recentEvents[0].payload.chat.hasUncapturedListMessage, true);
  assert.equal(profile.runtime.recentEvents[0].payload.chat.wechat.accountCount, 1);
  assert.equal(profile.runtime.recentEvents[0].payload.chat.messages, undefined);
  assert.equal(profile.runtime.networkDebug.recentRequests[0].responseBodyPreview, undefined);
  assert.equal(profile.runtime.networkDebug.recentRequests[0].url, "https://www.zhipin.com/wapi/zpjob/view/geek/info/v2");
  assert.equal(serialized.includes("完整聊天正文"), false);
  assert.equal(serialized.includes("wxid_secret"), false);
  assert.equal(serialized.includes("13800138000"), false);
});

test("diagnostic profile filename is stable and download-safe", () => {
  assert.equal(
    buildDiagnosticProfileFilename({
      generatedAt: "2026-05-17T15:20:00.000+08:00",
      extension: {
        version: "0.1.0"
      }
    }),
    "boss-observer-profile-0.1.0-2026-05-17T15-20-00-000+08-00.json"
  );
});

test("diagnostic profile keeps greeting correlation fields without chat noise", () => {
  const profile = buildDiagnosticProfile({
    recentEvents: [
      {
        id: "evt_greeting_succeeded",
        type: EVENT_TYPES.CANDIDATE_GREETING_SUCCEEDED,
        occurredAt: "2026-05-17T15:57:11.191+08:00",
        payload: {
          source: "poll",
          entry: "candidate_detail",
          clickedEventId: "evt_greeting_clicked",
          elapsedMs: 378,
          candidate: {
            candidateId: "bo_candidate_1",
            stableIdSource: "text_fingerprint",
            exposureKey: "candidate_recommend:url:text_fingerprint:card_1",
            exposedEventId: "evt_card_exposed",
            profile: {
              displayName: "谢蓉",
              age: 27,
              education: "大专"
            }
          },
          greeting: {
            status: "succeeded",
            detectedBy: "page_message"
          }
        }
      }
    ]
  }, {
    manifest: {
      version: "0.1.0"
    },
    now: () => "2026-05-17T15:58:00.000+08:00"
  });
  const event = profile.runtime.recentEvents[0];

  assert.equal(event.payload.entry, "candidate_detail");
  assert.equal(event.payload.clickedEventId, "evt_greeting_clicked");
  assert.equal(event.payload.elapsedMs, 378);
  assert.equal(event.payload.candidate.profile.displayName, "谢蓉");
  assert.equal(event.payload.candidate.exposedEventId, "evt_card_exposed");
  assert.equal(event.payload.greeting.status, "succeeded");
  assert.equal(event.payload.chat, undefined);
  assert.equal(event.payload.upload, undefined);
});

test("diagnostic profile summarizes merged detail analysis marker", () => {
  const profile = buildDiagnosticProfile({
    recentEvents: [
      {
        id: "evt_detail_opened",
        type: EVENT_TYPES.CANDIDATE_DETAIL_OPENED,
        occurredAt: "2026-05-17T16:20:00.000+08:00",
        payload: {
          source: "poll",
          detectedBy: "detail_dom",
          analysis: {
            module: "boss_analysis"
          },
          candidate: {
            candidateId: "bo_candidate_1",
            stableIdSource: "text_fingerprint",
            profile: {
              displayName: "Alone"
            }
          }
        }
      }
    ]
  }, {
    manifest: {
      version: "0.1.0"
    },
    now: () => "2026-05-17T16:21:00.000+08:00"
  });
  const event = profile.runtime.recentEvents[0];

  assert.equal(event.payload.analysis.module, "boss_analysis");
  assert.equal(event.payload.candidate.profile.displayName, "Alone");
});

test("diagnostic profile includes local-only pending chat candidates", () => {
  const profile = buildDiagnosticProfile({
    chatPendingCandidates: {
      updatedAt: "2026-05-22T10:00:00.000+08:00",
      source: "poll",
      items: [
        {
          candidateId: "candidate_1",
          displayName: "桂儿",
          jobTitle: "【8000+】居家黑板主播（时薪40+可兼职）",
          lastMessageAt: "2026-05-22T09:54:00.000+08:00",
          lastMessageTimeText: "09:54"
        }
      ]
    }
  }, {
    manifest: {
      version: "0.1.2"
    },
    now: () => "2026-05-22T10:01:00.000+08:00"
  });

  assert.equal(profile.runtime.moduleHealth.candidate_chat.status, "problem");
  assert.equal(profile.runtime.chatPendingCandidates.items.length, 1);
  assert.equal(profile.runtime.chatPendingCandidates.items[0].displayName, "桂儿");
  assert.equal(profile.runtime.productionStats.unreportedChats, undefined);
});

test("diagnostic profile prefers bounded stored event summaries", () => {
  const recentEventSummaries = Array.from({
    length: DIAGNOSTIC_PROFILE_RECENT_EVENT_LIMIT + 5
  }, (_item, index) => summarizeDiagnosticEvent({
    id: `summary_${index}`,
    type: EVENT_TYPES.CANDIDATE_DETAIL_OPENED,
    occurredAt: `2026-05-17T16:${String(index % 60).padStart(2, "0")}:00.000+08:00`,
    payload: {
      candidate: {
        candidateId: `candidate_${index}`,
        profile: {
          displayName: `候选人${index}`
        }
      },
      chat: {
        messages: [
          {
            text: "不应进入 profile 的聊天正文"
          }
        ]
      }
    }
  }));
  const profile = buildDiagnosticProfile({
    recentEventSummaries,
    recentEvents: [
      {
        id: "raw_should_not_be_used",
        type: EVENT_TYPES.CANDIDATE_CHAT_SNAPSHOT_CAPTURED
      }
    ]
  });

  assert.equal(profile.runtime.recentEvents.length, DIAGNOSTIC_PROFILE_RECENT_EVENT_LIMIT);
  assert.equal(profile.runtime.recentEvents[0].id, "summary_0");
  assert.equal(
    profile.runtime.recentEvents[DIAGNOSTIC_PROFILE_RECENT_EVENT_LIMIT - 1].id,
    `summary_${DIAGNOSTIC_PROFILE_RECENT_EVENT_LIMIT - 1}`
  );
  assert.equal(JSON.stringify(profile).includes("不应进入 profile 的聊天正文"), false);
});

test("diagnostic profile exports the full bounded network request summary list", () => {
  const profile = buildDiagnosticProfile({
    networkDebug: {
      recentRequests: Array.from({
        length: DIAGNOSTIC_PROFILE_NETWORK_REQUEST_LIMIT + 5
      }, (_item, index) => ({
        id: `req_${index}`,
        observedAt: "2026-05-17T16:20:00.000+08:00",
        url: `https://www.zhipin.com/wapi/example/${index}`,
        responseBodyPreview: "body should stay out of diagnostic profile"
      }))
    }
  });

  assert.equal(profile.runtime.networkDebug.recentRequests.length, DIAGNOSTIC_PROFILE_NETWORK_REQUEST_LIMIT);
  assert.equal(profile.runtime.networkDebug.recentRequests[0].id, "req_0");
  assert.equal(
    profile.runtime.networkDebug.recentRequests[DIAGNOSTIC_PROFILE_NETWORK_REQUEST_LIMIT - 1].id,
    `req_${DIAGNOSTIC_PROFILE_NETWORK_REQUEST_LIMIT - 1}`
  );
  assert.equal(JSON.stringify(profile).includes("body should stay out of diagnostic profile"), false);
});

function createDebugState() {
  return {
    updatedAt: "2026-05-17T15:19:00.000+08:00",
    queueSize: 1,
    lastFlushAt: "2026-05-17T15:18:00.000+08:00",
    lastUploadResult: {
      targetType: "cls_anonymous",
      status: 200,
      requestId: "request-secret",
      batchSize: 1,
      uploadedAt: "2026-05-17T15:18:00.000+08:00"
    },
    config: {
      enabled: true,
      debug: true,
      uploadEnabled: true,
      clsRegion: "ap-shanghai",
      clsTopicId: "topic-secret",
      clsSource: "boss-observer-extension",
      uploadBatchSize: 50,
      maxQueueSize: 1000,
      flushIntervalMs: 30000,
      minDwellMs: 1000
    },
    productionStats: {
      modules: {
        candidate_chat: {
          producedCount: 2,
          pendingCount: 0,
          uploadedCount: 1,
          uploadFailedCount: 0
        }
      }
    },
    networkDebug: {
      enabled: true,
      requestCount: 1,
      recentRequests: [
        {
          id: "req_1",
          observedAt: "2026-05-17T15:17:00.000+08:00",
          category: "candidate_detail",
          type: "fetch",
          method: "POST",
          url: "https://www.zhipin.com/wapi/zpjob/view/geek/info/v2?securityId=secret",
          sourcePageUrl: "https://www.zhipin.com/web/chat/index?_security_check=1",
          status: 200,
          ok: true,
          durationMs: 123,
          requestBodyPreview: "mobile=13800138000",
          responseBodyPreview: "{\"wechat\":\"wxid_secret\"}",
          responseBodyLength: 24
        }
      ]
    },
    recentEvents: [
      {
        id: "evt_snapshot",
        type: EVENT_TYPES.CANDIDATE_CHAT_SNAPSHOT_CAPTURED,
        occurredAt: "2026-05-17T15:16:00.000+08:00",
        sourceTabUrl: "https://www.zhipin.com/web/chat/index?_security_check=1",
        context: {
          isBossPage: true,
          pageType: "chat",
          pageUrl: "https://www.zhipin.com/web/chat/index?_security_check=1",
          sessionId: "session_1"
        },
        payload: {
          chatPageUrl: "https://www.zhipin.com/web/chat/index?_security_check=1",
          candidate: {
            candidateId: "bo_candidate_1",
            stableId: "raw-secret",
            stableIdSource: "chat_name_job_fingerprint",
            identityConfidence: "low",
            profile: {
              displayName: "蒋姜"
            }
          },
          chat: {
            conversationKey: "bo_candidate_1",
            jobTitle: "兼职·【8000+】居家黑板主播",
            messageCount: 2,
            firstMessageAt: "2026-05-17T14:30:00.000+08:00",
            lastMessageAt: "2026-05-17T14:39:00.000+08:00",
            coverageLastMessageAt: "2026-05-17T14:40:00.000+08:00",
            coverageSource: "manual_chat_list_open",
            listObservedLastMessageAt: "2026-05-17T14:40:00.000+08:00",
            listObservedLastMessageTimeText: "14:40",
            hasUncapturedListMessage: true,
            lastMessageFingerprint: "msg_1",
            messages: [
              {
                text: "完整聊天正文"
              }
            ],
            wechat: {
              accounts: ["wxid_secret"],
              source: "chat_text"
            }
          }
        }
      }
    ]
  };
}
