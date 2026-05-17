import test from "node:test";
import assert from "node:assert/strict";

import { DEFAULT_CONFIG, hasUploadTarget } from "../extension/src/shared/config.js";
import { hasClsAnonymousConfig } from "../extension/src/shared/cls-log-format.js";

test("default config keeps cls target and enables upload", () => {
  assert.equal(DEFAULT_CONFIG.uploadEnabled, true);
  assert.equal(DEFAULT_CONFIG.operatorId, "");
  assert.equal(DEFAULT_CONFIG.accountName, "");
  assert.equal(DEFAULT_CONFIG.clsRegion, "ap-shanghai");
  assert.equal(DEFAULT_CONFIG.clsTopicId, "5407c0a7-3e37-4c45-a204-bf5d40f157a1");
  assert.equal(DEFAULT_CONFIG.clsSource, "boss-observer-extension");
  assert.equal(hasClsAnonymousConfig(DEFAULT_CONFIG), true);
  assert.equal(hasUploadTarget(DEFAULT_CONFIG), true);
});

test("upload target is active only when the upload switch is enabled", () => {
  assert.equal(hasUploadTarget({ ...DEFAULT_CONFIG, uploadEnabled: true }), true);
  assert.equal(
    hasUploadTarget({
      ...DEFAULT_CONFIG,
      uploadEnabled: true,
      clsRegion: "",
      clsTopicId: "",
      uploadEndpoint: ""
    }),
    false
  );
  assert.equal(
    hasUploadTarget({
      ...DEFAULT_CONFIG,
      uploadEnabled: true,
      clsRegion: "",
      clsTopicId: "",
      uploadEndpoint: "https://example.test/upload"
    }),
    true
  );
});
