import test from "node:test";
import assert from "node:assert/strict";

import {
  createEmptyDebugState,
  createInitializedDebugState
} from "../extension/src/shared/debug-state.js";

test("debug state starts empty", () => {
  const state = createEmptyDebugState();

  assert.equal(state.queueSize, 0);
  assert.equal(state.recentEvents.length, 0);
  assert.equal(state.lastEvent, null);
  assert.equal(state.lastUploadResult, null);
});

test("debug state initialization clears previous runtime state", () => {
  const nextState = createInitializedDebugState(
    {
      clsRegion: "ap-shanghai",
      clsTopicId: "5407c0a7-3e37-4c45-a204-bf5d40f157a1"
    },
    {
      now: () => "2026-05-12T14:54:40.000+08:00"
    }
  );

  assert.equal(nextState.updatedAt, "2026-05-12T14:54:40.000+08:00");
  assert.equal(nextState.queueSize, 0);
  assert.equal(nextState.lastFlushAt, null);
  assert.equal(nextState.lastUploadResult, null);
  assert.equal(nextState.lastUploadError, null);
  assert.equal(nextState.lastEvent, null);
  assert.deepEqual(nextState.recentEvents, []);
  assert.deepEqual(nextState.config, {
    clsRegion: "ap-shanghai",
    clsTopicId: "5407c0a7-3e37-4c45-a204-bf5d40f157a1"
  });
});
