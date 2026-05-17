import test from "node:test";
import assert from "node:assert/strict";

import {
  applyChatReportEvents,
  CHAT_REPORT_STATE_KEY,
  readChatReportState,
  updateChatReportStateFromEvents
} from "../extension/src/shared/chat-report-state.js";

test("chat report state advances only from uploaded snapshot events", () => {
  const state = applyChatReportEvents({}, [
    createSnapshotEvent({
      id: "evt_snapshot_1",
      candidateId: "candidate_1",
      lastMessageAt: "2026-05-15T09:54:00.000+08:00",
      lastMessageFingerprint: "msg_last",
      messageCount: 3
    })
  ], {
    now: () => "2026-05-15T14:10:00.000+08:00"
  });

  assert.deepEqual(state.candidates.candidate_1, {
    candidateId: "candidate_1",
    stableId: "stable_1",
    stableIdSource: "url.geekId",
    lastReportedMessageAt: "2026-05-15T09:54:00.000+08:00",
    lastReportedMessageFingerprint: "msg_last",
    lastReportedAt: "2026-05-15T14:10:00.000+08:00",
    lastSnapshotEventId: "evt_snapshot_1",
    messageCount: 3
  });
});

test("chat report state ignores older snapshots for the same candidate", () => {
  const state = applyChatReportEvents({
    updatedAt: "old",
    candidates: {
      candidate_1: {
        candidateId: "candidate_1",
        stableId: "stable_1",
        stableIdSource: "url.geekId",
        lastReportedMessageAt: "2026-05-15T10:00:00.000+08:00",
        lastReportedMessageFingerprint: "msg_new",
        lastReportedAt: "2026-05-15T14:10:00.000+08:00",
        lastSnapshotEventId: "evt_new",
        messageCount: 4
      }
    }
  }, [
    createSnapshotEvent({
      id: "evt_old",
      candidateId: "candidate_1",
      lastMessageAt: "2026-05-15T09:54:00.000+08:00",
      lastMessageFingerprint: "msg_old",
      messageCount: 3
    })
  ], {
    now: () => "2026-05-15T14:11:00.000+08:00"
  });

  assert.equal(state.updatedAt, "old");
  assert.equal(state.candidates.candidate_1.lastSnapshotEventId, "evt_new");
  assert.equal(state.candidates.candidate_1.lastReportedMessageAt, "2026-05-15T10:00:00.000+08:00");
});

test("chat report state advances from snapshot coverage time when list observed a newer message", () => {
  const state = applyChatReportEvents({}, [
    createSnapshotEvent({
      id: "evt_snapshot_coverage",
      candidateId: "candidate_1",
      lastMessageAt: "2026-05-15T12:44:00.000+08:00",
      coverageLastMessageAt: "2026-05-15T12:45:00.000+08:00",
      lastMessageFingerprint: "msg_1244",
      messageCount: 1
    })
  ], {
    now: () => "2026-05-15T14:10:00.000+08:00"
  });

  assert.equal(state.candidates.candidate_1.lastReportedMessageAt, "2026-05-15T12:45:00.000+08:00");
  assert.equal(state.candidates.candidate_1.lastReportedMessageFingerprint, "msg_1244");
});

test("chat report state merges wechat accounts from snapshot and wechat events", () => {
  const state = applyChatReportEvents({}, [
    createSnapshotEvent({
      candidateId: "candidate_1",
      lastMessageAt: "2026-05-15T09:54:00.000+08:00",
      wechatAccounts: ["wxid_one"]
    }),
    {
      id: "evt_wechat",
      type: "candidate_chat.wechat_captured",
      payload: {
        candidate: {
          candidateId: "candidate_1",
          stableId: "stable_1",
          stableIdSource: "url.geekId"
        },
        wechat: {
          accounts: ["wxid_one", "wxid_two"]
        }
      }
    }
  ], {
    now: () => "2026-05-15T14:12:00.000+08:00"
  });

  assert.deepEqual(state.candidates.candidate_1.wechatAccounts, ["wxid_one", "wxid_two"]);
});

test("chat report state reads and writes through storage", async () => {
  const storage = createMemoryStorage();

  await updateChatReportStateFromEvents([
    createSnapshotEvent({
      candidateId: "candidate_1",
      lastMessageAt: "2026-05-15T09:54:00.000+08:00"
    })
  ], {
    storage,
    now: () => "2026-05-15T14:13:00.000+08:00"
  });

  const state = await readChatReportState({ storage });
  assert.equal(state.candidates.candidate_1.lastReportedMessageAt, "2026-05-15T09:54:00.000+08:00");
});

function createSnapshotEvent({
  id = "evt_snapshot",
  candidateId,
  lastMessageAt,
  coverageLastMessageAt = "",
  lastMessageFingerprint = "msg_last",
  messageCount = 1,
  wechatAccounts = []
}) {
  return {
    id,
    type: "candidate_chat.snapshot_captured",
    payload: {
      candidate: {
        candidateId,
        stableId: "stable_1",
        stableIdSource: "url.geekId"
      },
      chat: {
        lastMessageAt,
        coverageLastMessageAt,
        lastMessageFingerprint,
        messageCount,
        wechat: wechatAccounts.length ? { accounts: wechatAccounts } : undefined
      }
    }
  };
}

function createMemoryStorage(initial = {}) {
  const data = { ...initial };
  return {
    async get(key) {
      return { [key]: data[key] };
    },
    async set(values) {
      Object.assign(data, values);
    },
    readRaw() {
      return data[CHAT_REPORT_STATE_KEY];
    }
  };
}
