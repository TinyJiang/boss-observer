import { hasUploadTarget, readConfig, writeConfig } from "../shared/config.js";
import {
  CHAT_REPORT_STATE_KEY,
  createEmptyChatReportState,
  updateChatReportStateFromEvents
} from "../shared/chat-report-state.js";
import {
  buildClsAnonymousTracklogBody,
  buildClsAnonymousTracklogUrl,
  hasClsAnonymousConfig
} from "../shared/cls-log-format.js";
import {
  createInitializedDebugState,
  DEBUG_STATE_KEY,
  readDebugState
} from "../shared/debug-state.js";
import { EVENT_TYPES } from "../shared/event-types.js";
import {
  appendNetworkDebugRequest,
  clearNetworkDebugRequests,
  setNetworkDebugEnabled
} from "../shared/network-debug.js";
import {
  attachOperatorToEvent,
  evaluateCollectionGate,
  normalizeBossAccountObservation
} from "../shared/operator-identity.js";
import {
  recordProducedEvent,
  recordUploadedEvents,
  recordUploadFailedEvents,
  syncPendingEvents
} from "../shared/production-stats.js";
import { createSequentialTaskRunner } from "../shared/sequential-task-runner.js";
import { QUEUE_KEY, StorageQueue } from "../shared/storage-queue.js";
import { nowLocalIsoString } from "../shared/time.js";
import { shouldFlushImmediately } from "../shared/upload-policy.js";

let flushing = false;
const eventHandlingRunner = createSequentialTaskRunner();
const BOSS_TAB_URL_PATTERNS = ["https://www.zhipin.com/*", "https://zhipin.com/*"];

chrome.runtime.onInstalled.addListener(async () => {
  const config = await readConfig();
  const storedChatReportState = await chrome.storage.local.get(CHAT_REPORT_STATE_KEY);
  chrome.alarms.create("bossObserver.flush", {
    periodInMinutes: Math.max(1, Math.ceil(config.flushIntervalMs / 60000))
  });
  await chrome.storage.local.set({
    [QUEUE_KEY]: [],
    [CHAT_REPORT_STATE_KEY]: storedChatReportState[CHAT_REPORT_STATE_KEY] || createEmptyChatReportState(),
    [DEBUG_STATE_KEY]: createInitializedDebugState(config)
  });
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message?.kind) {
    return false;
  }

  if (message.kind === "bossObserver.event") {
    eventHandlingRunner.run(() => handleEvent(message.event, _sender))
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: String(error) }));

    return true;
  }

  if (message.kind === "bossObserver.networkDebug.request") {
    eventHandlingRunner.run(() => handleNetworkDebugRequest(message.request))
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: String(error) }));

    return true;
  }

  if (message.kind === "bossObserver.bossAccountObserved") {
    eventHandlingRunner.run(() => handleBossAccountObserved(message.account, _sender))
      .then((state) => sendResponse({ ok: true, collectionGate: state.collectionGate }))
      .catch((error) => sendResponse({ ok: false, error: String(error) }));

    return true;
  }

  if (message.kind === "bossObserver.config.update") {
    eventHandlingRunner.run(() => handleConfigUpdate(message.patch || {}))
      .then((state) => sendResponse({ ok: true, config: state.config, collectionGate: state.collectionGate }))
      .catch((error) => sendResponse({ ok: false, error: String(error) }));

    return true;
  }

  if (message.kind === "bossObserver.networkDebug.ready") {
    readDebugState()
      .then((state) => sendResponse({
        ok: true,
        enabled: state.networkDebug.enabled,
        maxPreviewChars: state.networkDebug.maxPreviewChars
      }))
      .catch((error) => sendResponse({ ok: false, error: String(error) }));

    return true;
  }

  if (message.kind === "bossObserver.networkDebug.command") {
    handleNetworkDebugCommand(message.command)
      .then((state) => sendResponse({ ok: true, networkDebug: state.networkDebug }))
      .catch((error) => sendResponse({ ok: false, error: String(error) }));

    return true;
  }

  return false;
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "bossObserver.flush") {
    flushQueue().catch(() => {});
  }
});

async function handleEvent(event, sender) {
  const config = await readConfig();
  const currentState = await readDebugState();
  const collectionGate = evaluateCollectionGate(config, currentState.collectionGate?.bossAccount);
  if (!collectionGate.canCollect) {
    await recordBlockedCollectionEvent({ event, sender, config, collectionGate });
    return;
  }

  const queue = new StorageQueue({ maxSize: config.maxQueueSize });
  const enrichedEvent = attachOperatorToEvent({
    ...event,
    sourceTabId: sender?.tab?.id ?? null,
    sourceWindowId: sender?.tab?.windowId ?? null,
    sourceTabUrl: sender?.tab?.url ?? null
  }, collectionGate);
  const { droppedCount } = await queue.enqueue(enrichedEvent);
  await updateDebugState(async (current) => {
    const queued = await queue.readAll();
    const productionStats = syncPendingEvents(
      recordProducedEvent(current.productionStats, enrichedEvent),
      queued.map((item) => item.event)
    );
    return {
      ...current,
      updatedAt: nowLocalIsoString(),
      config,
      collectionGate,
      queueSize: queued.length,
      lastEvent: enrichedEvent,
      recentEvents: [enrichedEvent, ...current.recentEvents].slice(0, 50),
      productionStats
    };
  });

  if (droppedCount > 0) {
    console.warn("[BOSS Observer] dropped old events", droppedCount);
  }

  if (hasUploadTarget(config)) {
    if (shouldFlushImmediately(enrichedEvent)) {
      await flushQueue();
    } else {
      const pending = await queue.readBatch(config.uploadBatchSize);
      if (pending.length >= config.uploadBatchSize) {
        await flushQueue();
      }
    }
  }
}

async function handleBossAccountObserved(account, sender) {
  const config = await readConfig();
  const bossAccount = normalizeBossAccountObservation({
    ...account,
    sourceTabId: sender?.tab?.id ?? null,
    sourceWindowId: sender?.tab?.windowId ?? null,
    pageUrl: account?.pageUrl || sender?.tab?.url || ""
  });
  const collectionGate = evaluateCollectionGate(config, bossAccount);
  let nextState = null;
  await updateDebugState(async (current) => {
    nextState = {
      ...current,
      updatedAt: nowLocalIsoString(),
      config,
      collectionGate
    };
    return nextState;
  });
  return nextState;
}

async function handleConfigUpdate(patch) {
  const config = await writeConfig({
    operatorId: patch.operatorId,
    accountName: patch.accountName
  });
  let nextState = null;
  await updateDebugState(async (current) => {
    const collectionGate = evaluateCollectionGate(config, current.collectionGate?.bossAccount);
    nextState = {
      ...current,
      updatedAt: nowLocalIsoString(),
      config,
      collectionGate
    };
    return nextState;
  });
  return nextState;
}

async function recordBlockedCollectionEvent({ event, sender, config, collectionGate }) {
  await updateDebugState(async (current) => ({
    ...current,
    updatedAt: nowLocalIsoString(),
    config,
    collectionGate,
    lastCollectionBlock: {
      blockedAt: nowLocalIsoString(),
      reason: collectionGate.status,
      severity: collectionGate.severity,
      message: collectionGate.message,
      eventId: event?.id || "",
      eventType: event?.type || "",
      sourceTabId: sender?.tab?.id ?? null,
      sourceWindowId: sender?.tab?.windowId ?? null,
      sourceTabUrl: sender?.tab?.url ?? null
    }
  }));
}

async function handleNetworkDebugRequest(request) {
  await updateDebugState(async (current) => ({
    ...current,
    updatedAt: nowLocalIsoString(),
    networkDebug: appendNetworkDebugRequest(current.networkDebug, request)
  }));
}

async function handleNetworkDebugCommand(command) {
  let nextState = null;
  await updateDebugState(async (current) => {
    let networkDebug = current.networkDebug;
    if (command === "start") {
      networkDebug = setNetworkDebugEnabled(networkDebug, true);
    } else if (command === "stop") {
      networkDebug = setNetworkDebugEnabled(networkDebug, false);
    } else if (command === "clear") {
      networkDebug = clearNetworkDebugRequests(networkDebug);
    } else {
      throw new Error(`Unknown network debug command: ${command}`);
    }

    nextState = {
      ...current,
      updatedAt: nowLocalIsoString(),
      networkDebug
    };
    return nextState;
  });

  if (command === "start" || command === "stop") {
    await broadcastNetworkDebugControl(nextState.networkDebug);
  }

  return nextState;
}

async function broadcastNetworkDebugControl(networkDebug) {
  const matchedTabs = await Promise.all(
    BOSS_TAB_URL_PATTERNS.map((url) => chrome.tabs.query({ url }))
  );
  const tabs = Array.from(
    new Map(matchedTabs.flat().map((tab) => [tab.id, tab])).values()
  );
  await Promise.all(tabs.map((tab) => new Promise((resolve) => {
    chrome.tabs.sendMessage(tab.id, {
      kind: "bossObserver.networkDebug.control",
      enabled: networkDebug.enabled,
      maxPreviewChars: networkDebug.maxPreviewChars
    }, () => {
      void chrome.runtime.lastError;
      resolve();
    });
  })));
}

async function flushQueue() {
  if (flushing) {
    return;
  }

  flushing = true;
  let queue = null;
  let batch = [];
  try {
    const config = await readConfig();
    if (!hasUploadTarget(config)) {
      return;
    }

    queue = new StorageQueue({ maxSize: config.maxQueueSize });
    batch = await queue.readBatch(config.uploadBatchSize);
    if (!batch.length) {
      return;
    }

    const uploadResult = await postBatch(config, batch.map((item) => item.event));
    await updateChatReportStateFromEvents(batch.map((item) => item.event));
    await queue.remove(batch.map((item) => item.id));
    await updateDebugState(async (current) => {
      const queued = await queue.readAll();
      const productionStats = syncPendingEvents(
        recordUploadedEvents(current.productionStats, batch.map((item) => item.event), {
          uploadedAt: uploadResult.uploadedAt
        }),
        queued.map((item) => item.event)
      );
      return {
        ...current,
        updatedAt: nowLocalIsoString(),
        config,
        lastFlushAt: nowLocalIsoString(),
        lastUploadResult: uploadResult,
        lastUploadError: null,
        queueSize: queued.length,
        productionStats
      };
    });
  } catch (error) {
    const retryError = await recordFailedBatchRetry(queue, batch);
    await updateDebugState(async (current) => {
      const queued = queue ? await queue.readAll() : [];
      const failedAt = nowLocalIsoString();
      const productionStats = syncPendingEvents(
        recordUploadFailedEvents(current.productionStats, batch.map((item) => item.event), { failedAt }),
        queued.map((item) => item.event)
      );
      return {
        ...current,
        updatedAt: nowLocalIsoString(),
        lastUploadError: {
          message: error instanceof Error ? error.message : String(error),
          occurredAt: failedAt,
          batchSize: batch.length,
          retryError: retryError ? formatError(retryError) : null
        },
        lastUploadResult: null,
        queueSize: queue ? queued.length : current.queueSize,
        productionStats
      };
    });
    console.warn("[BOSS Observer] upload failed", error);
  } finally {
    flushing = false;
  }
}

async function recordFailedBatchRetry(queue, batch) {
  if (!queue || !batch.length) {
    return null;
  }

  try {
    await queue.incrementRetries(batch.map((item) => item.id));
    return null;
  } catch (error) {
    console.warn("[BOSS Observer] retry count update failed", error);
    return error;
  }
}

function formatError(error) {
  return {
    message: error instanceof Error ? error.message : String(error)
  };
}

async function postBatch(config, events) {
  const request = buildUploadRequest(config, events);
  const response = await fetch(request.url, {
    method: "POST",
    headers: request.headers,
    body: request.body
  });

  if (!response.ok) {
    throw new Error(`Upload failed with HTTP ${response.status}`);
  }

  console.debug("[BOSS Observer]", EVENT_TYPES.UPLOAD_SUCCEEDED, events.length);
  return {
    targetType: request.targetType,
    status: response.status,
    requestId: response.headers.get("x-cls-requestid") || "",
    batchSize: events.length,
    uploadedAt: nowLocalIsoString()
  };
}

function buildUploadRequest(config, events) {
  if (hasClsAnonymousConfig(config)) {
    return {
      targetType: "cls_anonymous",
      url: buildClsAnonymousTracklogUrl({
        region: config.clsRegion,
        topicId: config.clsTopicId
      }),
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(
        buildClsAnonymousTracklogBody(events, {
          source: config.clsSource || "boss-observer-extension"
        })
      )
    };
  }

  return {
    targetType: "http_endpoint",
    url: config.uploadEndpoint,
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      batchType: "bossObserver.events",
      sentAt: nowLocalIsoString(),
      eventCount: events.length,
      events
    })
  };
}

async function updateDebugState(updater) {
  const current = await readDebugState();
  const next = await updater(current);
  await chrome.storage.local.set({ [DEBUG_STATE_KEY]: next });
}
