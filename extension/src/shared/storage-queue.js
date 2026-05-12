import { createId } from "./id.js";
import { nowLocalIsoString } from "./time.js";

export const QUEUE_KEY = "bossObserver.eventQueue";

export class StorageQueue {
  constructor({
    maxSize,
    storage = chrome.storage.local,
    createQueueId = () => createId("queue"),
    now = nowLocalIsoString
  }) {
    this.maxSize = maxSize;
    this.storage = storage;
    this.createQueueId = createQueueId;
    this.now = now;
  }

  async enqueue(event) {
    const queued = await this.readAll();
    const record = {
      id: this.createQueueId(),
      event,
      retryCount: 0,
      queuedAt: this.now()
    };

    queued.push(record);
    const droppedCount = Math.max(0, queued.length - this.maxSize);
    const nextQueue = droppedCount > 0 ? queued.slice(droppedCount) : queued;

    await this.storage.set({ [QUEUE_KEY]: nextQueue });
    return { record, droppedCount };
  }

  async readBatch(limit) {
    const queued = await this.readAll();
    return queued.slice(0, Math.max(0, limit));
  }

  async remove(ids) {
    if (!ids.length) {
      return;
    }

    const idSet = new Set(ids);
    const queued = await this.readAll();
    await this.storage.set({
      [QUEUE_KEY]: queued.filter((item) => !idSet.has(item.id))
    });
  }

  async incrementRetries(ids) {
    if (!ids.length) {
      return;
    }

    const idSet = new Set(ids);
    const queued = await this.readAll();
    await this.storage.set({
      [QUEUE_KEY]: queued.map((item) =>
        idSet.has(item.id)
          ? {
              ...item,
              retryCount: readRetryCount(item) + 1,
              lastRetryAt: this.now()
            }
          : item
      )
    });
  }

  async readAll() {
    const stored = await this.storage.get(QUEUE_KEY);
    const queue = stored[QUEUE_KEY];
    return Array.isArray(queue) ? queue : [];
  }
}

function readRetryCount(item) {
  return Number.isSafeInteger(item.retryCount) && item.retryCount >= 0
    ? item.retryCount
    : 0;
}
