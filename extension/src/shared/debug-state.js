import { nowLocalIsoString } from "./time.js";
import {
  createEmptyNetworkDebugState,
  normalizeNetworkDebugState
} from "./network-debug.js";

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
    config: null,
    networkDebug: createEmptyNetworkDebugState()
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
  const storedState = stored[DEBUG_STATE_KEY] || {};
  return {
    ...createEmptyDebugState(),
    ...storedState,
    networkDebug: normalizeNetworkDebugState(storedState.networkDebug)
  };
}
