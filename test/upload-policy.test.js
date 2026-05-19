import test from "node:test";
import assert from "node:assert/strict";

import { EVENT_TYPES } from "../extension/src/shared/event-types.js";
import { shouldFlushImmediately } from "../extension/src/shared/upload-policy.js";

test("upload policy flushes high-value user action events immediately", () => {
  [
    EVENT_TYPES.CANDIDATE_DETAIL_OPENED,
    EVENT_TYPES.CANDIDATE_DETAIL_CLOSED,
    EVENT_TYPES.CANDIDATE_GREETING_CLICKED,
    EVENT_TYPES.CANDIDATE_GREETING_SUCCEEDED,
    EVENT_TYPES.CANDIDATE_GREETING_FAILED,
    EVENT_TYPES.CANDIDATE_CHAT_SNAPSHOT_CAPTURED,
    EVENT_TYPES.CANDIDATE_CHAT_WECHAT_CAPTURED
  ].forEach((type) => {
    assert.equal(shouldFlushImmediately({ type }), true, type);
  });
});

test("upload policy keeps noisy passive events batched", () => {
  [
    EVENT_TYPES.PAGE_CHANGED,
    EVENT_TYPES.CANDIDATE_CARD_EXPOSED,
    EVENT_TYPES.JOB_CONTEXT_CHANGED
  ].forEach((type) => {
    assert.equal(shouldFlushImmediately({ type }), false, type);
  });
});
