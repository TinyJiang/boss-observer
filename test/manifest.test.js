import { readFile } from "node:fs/promises";
import { test } from "node:test";
import assert from "node:assert/strict";

const BOSS_MATCH_PATTERNS = ["https://www.zhipin.com/*", "https://zhipin.com/*"];

test("manifest grants and injects on both BOSS host variants", async () => {
  const manifest = JSON.parse(await readFile(new URL("../extension/manifest.json", import.meta.url), "utf8"));

  for (const pattern of BOSS_MATCH_PATTERNS) {
    assert.ok(manifest.host_permissions.includes(pattern));
  }

  for (const script of manifest.content_scripts) {
    for (const pattern of BOSS_MATCH_PATTERNS) {
      assert.ok(script.matches.includes(pattern));
    }
  }

  for (const resource of manifest.web_accessible_resources) {
    for (const pattern of BOSS_MATCH_PATTERNS) {
      assert.ok(resource.matches.includes(pattern));
    }
  }
});
