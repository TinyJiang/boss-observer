import { nowLocalIsoString } from "./time.js";

export const DEBUG_STATE_KEY = "bossObserver.debugState";

export function createEmptyDebugState() {
  return {
    updatedAt: null,
    lastEvent: null,
    recentEvents: [],
    queueSize: 0,
    lastFlushAt: null,
    lastUploadResult: null,
    lastUploadError: null,
    config: null
  };
}

export function createInitializedDebugState(config, { now = nowLocalIsoString } = {}) {
  return {
    ...createEmptyDebugState(),
    updatedAt: now(),
    config
  };
}

export async function readDebugState() {
  const stored = await chrome.storage.local.get(DEBUG_STATE_KEY);
  return {
    ...createEmptyDebugState(),
    ...(stored[DEBUG_STATE_KEY] || {})
  };
}
