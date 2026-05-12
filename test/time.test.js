import test from "node:test";
import assert from "node:assert/strict";

import { toLocalIsoString } from "../extension/src/shared/time.js";

test("formats local ISO timestamp with eastward timezone offset", () => {
  const date = new Date(Date.UTC(2026, 4, 12, 7, 18, 52, 566));

  assert.equal(
    toLocalIsoString(date, { offsetMinutes: -480 }),
    "2026-05-12T15:18:52.566+08:00"
  );
});

test("formats local ISO timestamp with westward timezone offset", () => {
  const date = new Date(Date.UTC(2026, 4, 12, 7, 18, 52, 566));

  assert.equal(
    toLocalIsoString(date, { offsetMinutes: 300 }),
    "2026-05-12T02:18:52.566-05:00"
  );
});
