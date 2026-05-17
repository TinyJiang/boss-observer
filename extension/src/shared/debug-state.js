import { nowLocalIsoString } from "./time.js";
import {
  createEmptyNetworkDebugState,
  normalizeNetworkDebugState
} from "./network-debug.js";
import {
  createEmptyProductionStats,
  normalizeProductionStats
} from "./production-stats.js";
import { evaluateCollectionGate } from "./operator-identity.js";

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
    collectionGate: evaluateCollectionGate({}),
    lastCollectionBlock: null,
    networkDebug: createEmptyNetworkDebugState(),
    productionStats: createEmptyProductionStats()
  };
}

export function createInitializedDebugState(config, { now = nowLocalIsoString } = {}) {
  return {
    ...createEmptyDebugState(),
    updatedAt: now(),
    config,
    collectionGate: evaluateCollectionGate(config)
  };
}

export async function readDebugState() {
  const stored = await chrome.storage.local.get(DEBUG_STATE_KEY);
  const storedState = stored[DEBUG_STATE_KEY] || {};
  return {
    ...createEmptyDebugState(),
    ...storedState,
    collectionGate: storedState.collectionGate || evaluateCollectionGate(storedState.config || {}),
    lastCollectionBlock: storedState.lastCollectionBlock || null,
    networkDebug: normalizeNetworkDebugState(storedState.networkDebug),
    productionStats: normalizeProductionStats(storedState.productionStats)
  };
}
