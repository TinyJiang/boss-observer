import test from "node:test";
import assert from "node:assert/strict";

import { createSequentialTaskRunner } from "../extension/src/shared/sequential-task-runner.js";

test("sequential task runner preserves task order for overlapping async work", async () => {
  const runner = createSequentialTaskRunner();
  const order = [];
  let releaseFirst;

  const first = runner.run(async () => {
    order.push("first:start");
    await new Promise((resolve) => {
      releaseFirst = resolve;
    });
    order.push("first:end");
    return "first";
  });

  const second = runner.run(() => {
    order.push("second");
    return "second";
  });

  await Promise.resolve();
  assert.deepEqual(order, ["first:start"]);

  releaseFirst();

  assert.equal(await first, "first");
  assert.equal(await second, "second");
  assert.deepEqual(order, ["first:start", "first:end", "second"]);
});

test("sequential task runner continues after a failed task", async () => {
  const runner = createSequentialTaskRunner();

  await assert.rejects(
    runner.run(() => {
      throw new Error("expected failure");
    }),
    /expected failure/
  );

  assert.equal(await runner.run(() => "next task"), "next task");
});
