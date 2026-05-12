import { hasUploadTarget, readConfig } from "../shared/config.js";
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
import { createSequentialTaskRunner } from "../shared/sequential-task-runner.js";
import { QUEUE_KEY, StorageQueue } from "../shared/storage-queue.js";
import { nowLocalIsoString } from "../shared/time.js";

let flushing = false;
const eventHandlingRunner = createSequentialTaskRunner();

chrome.runtime.onInstalled.addListener(async () => {
  const config = await readConfig();
  chrome.alarms.create("bossObserver.flush", {
    periodInMinutes: Math.max(1, Math.ceil(config.flushIntervalMs / 60000))
  });
  await chrome.storage.local.set({
    [QUEUE_KEY]: [],
    [DEBUG_STATE_KEY]: createInitializedDebugState(config)
  });
});

chrome.action.onClicked.addListener(async () => {
  const targetUrl = chrome.runtime.getURL("debug/index.html");
  await chrome.tabs.create({ url: targetUrl });
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || message.kind !== "bossObserver.event") {
    return false;
  }

  eventHandlingRunner.run(() => handleEvent(message.event, _sender))
    .then(() => sendResponse({ ok: true }))
    .catch((error) => sendResponse({ ok: false, error: String(error) }));

  return true;
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "bossObserver.flush") {
    flushQueue().catch(() => {});
  }
});

async function handleEvent(event, sender) {
  const config = await readConfig();
  const queue = new StorageQueue({ maxSize: config.maxQueueSize });
  const enrichedEvent = {
    ...event,
    sourceTabId: sender?.tab?.id ?? null,
    sourceWindowId: sender?.tab?.windowId ?? null,
    sourceTabUrl: sender?.tab?.url ?? null
  };
  const { droppedCount } = await queue.enqueue(enrichedEvent);
  await updateDebugState(async (current) => {
    const queued = await queue.readAll();
    return {
      ...current,
      updatedAt: nowLocalIsoString(),
      config,
      queueSize: queued.length,
      lastEvent: enrichedEvent,
      recentEvents: [enrichedEvent, ...current.recentEvents].slice(0, 50)
    };
  });

  if (droppedCount > 0) {
    console.warn("[BOSS Observer] dropped old events", droppedCount);
  }

  if (hasUploadTarget(config)) {
    const pending = await queue.readBatch(config.uploadBatchSize);
    if (pending.length >= config.uploadBatchSize) {
      await flushQueue();
    }
  }
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
    await queue.remove(batch.map((item) => item.id));
    await updateDebugState(async (current) => ({
      ...current,
      updatedAt: nowLocalIsoString(),
      config,
      lastFlushAt: nowLocalIsoString(),
      lastUploadResult: uploadResult,
      lastUploadError: null,
      queueSize: (await queue.readAll()).length
    }));
  } catch (error) {
    const retryError = await recordFailedBatchRetry(queue, batch);
    await updateDebugState(async (current) => ({
      ...current,
      updatedAt: nowLocalIsoString(),
      lastUploadError: {
        message: error instanceof Error ? error.message : String(error),
        occurredAt: nowLocalIsoString(),
        batchSize: batch.length,
        retryError: retryError ? formatError(retryError) : null
      },
      lastUploadResult: null,
      queueSize: queue ? (await queue.readAll()).length : current.queueSize
    }));
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
