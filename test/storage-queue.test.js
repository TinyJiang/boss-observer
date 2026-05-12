import test from "node:test";
import assert from "node:assert/strict";

import { QUEUE_KEY, StorageQueue } from "../extension/src/shared/storage-queue.js";

test("storage queue drops oldest records when capacity is exceeded", async () => {
  const storage = createMemoryStorage();
  const queue = createTestQueue({ storage, maxSize: 2 });

  assert.equal((await queue.enqueue({ type: "first" })).droppedCount, 0);
  assert.equal((await queue.enqueue({ type: "second" })).droppedCount, 0);
  assert.equal((await queue.enqueue({ type: "third" })).droppedCount, 1);

  const records = await queue.readAll();
  assert.deepEqual(records.map((record) => record.event.type), ["second", "third"]);
  assert.deepEqual(records.map((record) => record.id), ["queue_2", "queue_3"]);
});

test("storage queue reads batches and removes acknowledged records", async () => {
  const storage = createMemoryStorage();
  const queue = createTestQueue({ storage, maxSize: 5 });

  await queue.enqueue({ type: "first" });
  await queue.enqueue({ type: "second" });
  await queue.enqueue({ type: "third" });

  const batch = await queue.readBatch(2);
  assert.deepEqual(batch.map((record) => record.event.type), ["first", "second"]);

  await queue.remove(batch.map((record) => record.id));

  const remaining = await queue.readAll();
  assert.deepEqual(remaining.map((record) => record.event.type), ["third"]);
});

test("storage queue increments retry count without removing failed records", async () => {
  const storage = createMemoryStorage();
  const queue = createTestQueue({ storage, maxSize: 5 });

  const first = await queue.enqueue({ type: "first" });
  const second = await queue.enqueue({ type: "second" });
  await storage.set({
    [QUEUE_KEY]: [
      { ...first.record, retryCount: undefined },
      second.record
    ]
  });

  await queue.incrementRetries([first.record.id]);

  const records = await queue.readAll();
  assert.equal(records.length, 2);
  assert.equal(records[0].retryCount, 1);
  assert.equal(records[0].lastRetryAt, "2026-05-11T06:20:02.000Z");
  assert.equal(records[1].retryCount, 0);
  assert.equal(records[1].lastRetryAt, undefined);
});

test("storage queue treats malformed stored data as empty", async () => {
  const storage = createMemoryStorage({ [QUEUE_KEY]: { unexpected: true } });
  const queue = createTestQueue({ storage, maxSize: 5 });

  assert.deepEqual(await queue.readAll(), []);
});

function createTestQueue({ storage, maxSize }) {
  let id = 0;
  let tick = 0;

  return new StorageQueue({
    maxSize,
    storage,
    createQueueId: () => {
      id += 1;
      return `queue_${id}`;
    },
    now: () => {
      const current = new Date(Date.UTC(2026, 4, 11, 6, 20, tick)).toISOString();
      tick += 1;
      return current;
    }
  });
}

function createMemoryStorage(initial = {}) {
  const data = { ...initial };

  return {
    async get(key) {
      return { [key]: data[key] };
    },
    async set(values) {
      Object.assign(data, values);
    }
  };
}
