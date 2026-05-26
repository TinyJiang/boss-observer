import { nowLocalIsoString } from "./time.js";
import {
  createEmptyNetworkDebugState,
  normalizeNetworkDebugState
} from "./network-debug.js";
import {
  createEmptyProductionStats,
  normalizeProductionStats
} from "./production-stats.js";
import {
  createEmptyChatPendingCandidatesState,
  normalizeChatPendingCandidatesState
} from "./chat-pending-candidates.js";
import { evaluateCollectionGate } from "./operator-identity.js";

export const DEBUG_STATE_KEY = "bossObserver.debugState";

export function createEmptyDebugState() {
  return {
    updatedAt: null,
    lastEvent: null,
    recentEvents: [],
    recentEventSummaries: [],
    queueSize: 0,
    lastFlushAt: null,
    lastUploadResult: null,
    lastUploadError: null,
    config: null,
    collectionGate: evaluateCollectionGate({}),
    lastCollectionBlock: null,
    chatPendingCandidates: createEmptyChatPendingCandidatesState(),
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
    recentEventSummaries: Array.isArray(storedState.recentEventSummaries) ? storedState.recentEventSummaries : [],
    collectionGate: storedState.collectionGate || evaluateCollectionGate(storedState.config || {}),
    lastCollectionBlock: storedState.lastCollectionBlock || null,
    chatPendingCandidates: normalizeChatPendingCandidatesState(storedState.chatPendingCandidates),
    networkDebug: normalizeNetworkDebugState(storedState.networkDebug),
    productionStats: normalizeProductionStats(storedState.productionStats)
  };
}
