import test from "node:test";
import assert from "node:assert/strict";

import {
  createEmptyProductionStats,
  getModuleHealthStatus,
  getModuleReportStatus,
  MODULE_REPORT_DEFINITIONS,
  normalizeProductionStats,
  recordProducedEvent,
  recordUploadedEvents,
  recordUploadFailedEvents,
  syncPendingEvents
} from "../extension/src/shared/production-stats.js";
import { EVENT_TYPES } from "../extension/src/shared/event-types.js";

test("production stats labels greeting as event counts", () => {
  const greetingDefinition = MODULE_REPORT_DEFINITIONS.find((definition) => definition.id === "candidate_greeting");

  assert.equal(greetingDefinition.label, "打招呼事件");
});

test("production stats records module pending counts for produced events", () => {
  const event = {
    eventId: "evt_1",
    type: EVENT_TYPES.CANDIDATE_LIST_VIEWED,
    occurredAt: "2026-05-16T10:00:00.000+08:00"
  };

  const stats = recordProducedEvent(createEmptyProductionStats(), event);

  assert.equal(stats.modules.candidate_list.producedCount, 1);
  assert.equal(stats.modules.candidate_list.pendingCount, 1);
  assert.equal(stats.modules.candidate_list.lastEventType, EVENT_TYPES.CANDIDATE_LIST_VIEWED);
  assert.equal(getModuleReportStatus(stats.modules.candidate_list), "pending");
});

test("production stats ignores removed legacy unreported chat state", () => {
  const stats = normalizeProductionStats({
    modules: {
      candidate_chat: {
        producedCount: 1,
        pendingCount: 0,
        uploadedCount: 1,
        uploadFailedCount: 0
      }
    },
    unreportedChats: [
      {
        candidateId: "legacy_candidate",
        displayName: "陈月雨"
      }
    ]
  });

  assert.equal(stats.unreportedChats, undefined);
  assert.equal(stats.modules.candidate_chat.producedCount, 1);
  assert.equal(getModuleHealthStatus(stats.modules.candidate_chat), "ok");
});

test("production stats records uploaded events", () => {
  const stats = recordUploadedEvents(createEmptyProductionStats(), [
    { type: EVENT_TYPES.CANDIDATE_CHAT_SNAPSHOT_CAPTURED }
  ], {
    uploadedAt: "2026-05-16T10:05:00.000+08:00"
  });

  assert.equal(stats.modules.candidate_chat.uploadedCount, 1);
  assert.equal(stats.modules.candidate_chat.lastUploadedAt, "2026-05-16T10:05:00.000+08:00");
});

test("production stats syncs pending counts from the actual queue", () => {
  const initialStats = recordProducedEvent(createEmptyProductionStats(), {
    type: EVENT_TYPES.CANDIDATE_DETAIL_OPENED,
    occurredAt: "2026-05-16T10:00:00.000+08:00"
  });

  const synced = syncPendingEvents(initialStats, [
    { type: EVENT_TYPES.CANDIDATE_CHAT_OPENED },
    { type: EVENT_TYPES.CANDIDATE_CHAT_SNAPSHOT_CAPTURED }
  ]);

  assert.equal(synced.modules.candidate_detail.pendingCount, 0);
  assert.equal(synced.modules.candidate_chat.pendingCount, 2);
});

test("production stats marks modules retrying after upload failure with pending events", () => {
  const failed = recordUploadFailedEvents(createEmptyProductionStats(), [
    { type: EVENT_TYPES.CANDIDATE_GREETING_CLICKED }
  ], {
    failedAt: "2026-05-16T10:10:00.000+08:00"
  });
  const pending = syncPendingEvents(failed, [
    { type: EVENT_TYPES.CANDIDATE_GREETING_CLICKED }
  ]);

  assert.equal(pending.modules.candidate_greeting.uploadFailedCount, 1);
  assert.equal(getModuleReportStatus(pending.modules.candidate_greeting), "retrying");
  assert.equal(getModuleHealthStatus(pending.modules.candidate_greeting), "problem");
});

test("production stats health status stays green for idle or fully uploaded modules", () => {
  assert.equal(getModuleHealthStatus({}), "ok");
  assert.equal(getModuleHealthStatus({
    producedCount: 1,
    pendingCount: 0,
    uploadedCount: 1,
    uploadFailedCount: 0
  }), "ok");
});

test("production stats health status is red for pending or failed events", () => {
  assert.equal(getModuleHealthStatus({ pendingCount: 1 }), "problem");
  assert.equal(getModuleHealthStatus({ uploadFailedCount: 1 }), "problem");
});
