import test from "node:test";
import assert from "node:assert/strict";

import {
  createEmptyProductionStats,
  getModuleHealthStatus,
  getModuleReportStatus,
  normalizeProductionStats,
  recordProducedEvent,
  recordUploadedEvents,
  recordUploadFailedEvents,
  syncPendingEvents
} from "../extension/src/shared/production-stats.js";
import { EVENT_TYPES } from "../extension/src/shared/event-types.js";

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

test("production stats tracks unreported chat names from report required events", () => {
  const stats = recordProducedEvent(createEmptyProductionStats(), {
    eventId: "evt_chat_required",
    type: EVENT_TYPES.CANDIDATE_CHAT_REPORT_REQUIRED,
    occurredAt: "2026-05-16T10:02:00.000+08:00",
    payload: {
      candidate: {
        candidateId: "candidate_1",
        profile: {
          displayName: "桂儿"
        }
      },
      listItem: {
        jobTitle: "【8000+】居家黑板主播",
        lastMessageAt: "2026-05-16T09:54:00.000+08:00",
        lastMessageTimeText: "09:54",
        lastReportedMessageAt: ""
      }
    }
  });

  assert.equal(stats.unreportedChats.length, 1);
  assert.equal(stats.unreportedChats[0].displayName, "桂儿");
  assert.equal(stats.unreportedChats[0].jobTitle, "【8000+】居家黑板主播");
});

test("production stats filters non-candidate timeline rows from unreported chats", () => {
  const stats = recordProducedEvent(createEmptyProductionStats(), {
    eventId: "evt_bad_chat_required",
    type: EVENT_TYPES.CANDIDATE_CHAT_REPORT_REQUIRED,
    occurredAt: "2026-05-16T10:02:00.000+08:00",
    payload: {
      candidate: {
        candidateId: "candidate_bad",
        profile: {
          displayName: "5月16日 沟通的职位-"
        }
      },
      listItem: {
        displayName: "5月16日 沟通的职位-",
        jobTitle: "【8000+】居家黑板主播",
        lastMessageAt: "2026-05-16T09:54:00.000+08:00",
        lastMessageTimeText: "09:54"
      }
    }
  });
  const normalized = normalizeProductionStats({
    unreportedChats: [
      {
        candidateId: "candidate_bad",
        displayName: "5月16日 沟通的职位-",
        jobTitle: "【8000+】居家黑板主播",
        lastMessageAt: "2026-05-16T09:54:00.000+08:00"
      },
      {
        candidateId: "candidate_good",
        displayName: "蒋姜",
        jobTitle: "【8000+】居家黑板主播",
        lastMessageAt: "2026-05-16T09:54:00.000+08:00"
      },
      {
        candidateId: "candidate_good_variant",
        displayName: "蒋姜",
        jobTitle: "【8000+】 居家黑板主播",
        lastMessageAt: "2026-05-16T09:54:00.000+08:00"
      }
    ]
  });

  assert.equal(stats.unreportedChats.length, 0);
  assert.deepEqual(normalized.unreportedChats.map((chat) => chat.displayName), ["蒋姜"]);
});

test("production stats replaces older unreported chat entry for the same name and job", () => {
  const first = {
    eventId: "evt_chat_required_1",
    type: EVENT_TYPES.CANDIDATE_CHAT_REPORT_REQUIRED,
    occurredAt: "2026-05-16T12:28:00.000+08:00",
    payload: {
      candidate: {
        candidateId: "candidate_old",
        profile: {
          displayName: "抹茶"
        }
      },
      listItem: {
        jobTitle: "【8000+】居家黑板主播（时薪40+可兼职）",
        lastMessageAt: "2026-05-16T12:28:00.000+08:00",
        lastMessageTimeText: "12:28"
      }
    }
  };
  const second = {
    eventId: "evt_chat_required_2",
    type: EVENT_TYPES.CANDIDATE_CHAT_REPORT_REQUIRED,
    occurredAt: "2026-05-16T15:05:00.000+08:00",
    payload: {
      candidate: {
        candidateId: "candidate_new",
        profile: {
          displayName: "抹茶"
        }
      },
      listItem: {
        jobTitle: "【8000+】 居家黑板主播（时薪40+可兼职）",
        lastMessageAt: "2026-05-16T15:05:00.000+08:00",
        lastMessageTimeText: "15:05"
      }
    }
  };

  const stats = recordProducedEvent(
    recordProducedEvent(createEmptyProductionStats(), first),
    second
  );

  assert.equal(stats.unreportedChats.length, 1);
  assert.equal(stats.unreportedChats[0].displayName, "抹茶");
  assert.equal(stats.unreportedChats[0].lastMessageAt, "2026-05-16T15:05:00.000+08:00");
});

test("production stats removes unreported chat after uploaded snapshot covers it", () => {
  const requiredEvent = {
    eventId: "evt_chat_required",
    type: EVENT_TYPES.CANDIDATE_CHAT_REPORT_REQUIRED,
    occurredAt: "2026-05-16T10:02:00.000+08:00",
    payload: {
      candidate: {
        candidateId: "candidate_1",
        profile: {
          displayName: "桂儿"
        }
      },
      listItem: {
        lastMessageAt: "2026-05-16T09:54:00.000+08:00",
        lastMessageTimeText: "09:54"
      }
    }
  };
  const snapshotEvent = {
    eventId: "evt_snapshot",
    type: EVENT_TYPES.CANDIDATE_CHAT_SNAPSHOT_CAPTURED,
    payload: {
      candidate: {
        candidateId: "candidate_1"
      },
      chat: {
        lastMessageAt: "2026-05-16T10:00:00.000+08:00"
      }
    }
  };

  const stats = recordUploadedEvents(
    recordProducedEvent(createEmptyProductionStats(), requiredEvent),
    [snapshotEvent],
    { uploadedAt: "2026-05-16T10:05:00.000+08:00" }
  );

  assert.equal(stats.unreportedChats.length, 0);
  assert.equal(stats.modules.candidate_chat.uploadedCount, 1);
});

test("production stats removes unreported chat when snapshot coverage comes from list observation", () => {
  const requiredEvent = {
    eventId: "evt_chat_required",
    type: EVENT_TYPES.CANDIDATE_CHAT_REPORT_REQUIRED,
    occurredAt: "2026-05-16T12:45:00.000+08:00",
    payload: {
      candidate: {
        candidateId: "candidate_1",
        profile: {
          displayName: "李女士"
        }
      },
      listItem: {
        jobTitle: "【8000+】居家黑板主播（时薪40+可兼职）",
        lastMessageAt: "2026-05-16T12:45:00.000+08:00",
        lastMessageTimeText: "12:45",
        lastReportedMessageAt: "2026-05-16T12:44:00.000+08:00"
      }
    }
  };
  const snapshotEvent = {
    eventId: "evt_snapshot",
    type: EVENT_TYPES.CANDIDATE_CHAT_SNAPSHOT_CAPTURED,
    payload: {
      candidate: {
        candidateId: "candidate_1",
        profile: {
          displayName: "李女士"
        }
      },
      chat: {
        jobTitle: "【8000+】居家黑板主播（时薪40+可兼职）",
        lastMessageAt: "2026-05-16T12:44:00.000+08:00",
        coverageLastMessageAt: "2026-05-16T12:45:00.000+08:00",
        listObservedLastMessageAt: "2026-05-16T12:45:00.000+08:00",
        hasUncapturedListMessage: true
      }
    }
  };

  const stats = recordUploadedEvents(
    recordProducedEvent(createEmptyProductionStats(), requiredEvent),
    [snapshotEvent],
    { uploadedAt: "2026-05-16T12:46:00.000+08:00" }
  );

  assert.equal(stats.unreportedChats.length, 0);
});

test("production stats removes unreported chat when snapshot id differs but name and job match", () => {
  const requiredEvent = {
    eventId: "evt_chat_required",
    type: EVENT_TYPES.CANDIDATE_CHAT_REPORT_REQUIRED,
    occurredAt: "2026-05-16T10:02:00.000+08:00",
    payload: {
      candidate: {
        candidateId: "candidate_list_variant",
        profile: {
          displayName: "蒋姜"
        }
      },
      listItem: {
        jobTitle: "【8000+】居家黑板主播（时薪40+可兼职）",
        lastMessageAt: "2026-05-16T13:50:00.000+08:00",
        lastMessageTimeText: "13:50"
      }
    }
  };
  const snapshotEvent = {
    eventId: "evt_snapshot",
    type: EVENT_TYPES.CANDIDATE_CHAT_SNAPSHOT_CAPTURED,
    payload: {
      candidate: {
        candidateId: "candidate_panel_variant",
        profile: {
          displayName: "蒋姜"
        }
      },
      chat: {
        jobTitle: "兼职·【8000+】 居家黑板主播（时薪40+可兼职）",
        lastMessageAt: "2026-05-16T13:50:00.000+08:00"
      }
    }
  };

  const stats = recordUploadedEvents(
    recordProducedEvent(createEmptyProductionStats(), requiredEvent),
    [snapshotEvent],
    { uploadedAt: "2026-05-16T14:05:00.000+08:00" }
  );

  assert.equal(stats.unreportedChats.length, 0);
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

test("production stats health status is red for pending events or chat补采", () => {
  assert.equal(getModuleHealthStatus({ pendingCount: 1 }), "problem");
  assert.equal(getModuleHealthStatus({}, { hasUnreportedChats: true }), "problem");
});
