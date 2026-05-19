import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  createBuildPlan,
  formatTimestamp,
  resolveOutputPath
} from "../scripts/build-extension.js";

test("build plan names the zip from the Chrome extension manifest version", async () => {
  const rootDir = await mkdtemp(path.join(tmpdir(), "boss-observer-build-"));
  await mkdir(path.join(rootDir, "extension"), { recursive: true });
  await writeFile(
    path.join(rootDir, "package.json"),
    JSON.stringify({ name: "boss-observer", version: "9.9.9" })
  );
  await writeFile(
    path.join(rootDir, "extension", "manifest.json"),
    JSON.stringify({ manifest_version: 3, name: "BOSS Observer", version: "0.2.3" })
  );

  const plan = await createBuildPlan({ rootDir });

  assert.equal(plan.version, "0.2.3");
  assert.equal(path.basename(plan.outputPath), "boss-observer-0.2.3.zip");
});

test("output path keeps existing version archives instead of overwriting them", async () => {
  const distDir = await mkdtemp(path.join(tmpdir(), "boss-observer-dist-"));
  await writeFile(path.join(distDir, "boss-observer-0.2.3.zip"), "old package");

  const outputPath = await resolveOutputPath({
    distDir,
    packageName: "boss-observer",
    version: "0.2.3",
    now: () => new Date("2026-05-18T07:38:03.004Z")
  });

  assert.equal(
    path.basename(outputPath),
    "boss-observer-0.2.3-2026-05-18T07-38-03-004Z.zip"
  );
  assert.equal(
    await readFile(path.join(distDir, "boss-observer-0.2.3.zip"), "utf8"),
    "old package"
  );
});

test("timestamp formatting is safe for filenames", () => {
  assert.equal(
    formatTimestamp(new Date("2026-05-18T07:38:03.004Z")),
    "2026-05-18T07-38-03-004Z"
  );
});
