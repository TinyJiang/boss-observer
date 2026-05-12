import { hasClsAnonymousConfig } from "./cls-log-format.js";

export const DEFAULT_CONFIG = Object.freeze({
  enabled: true,
  debug: true,
  uploadEnabled: false,
  uploadEndpoint: "",
  clsRegion: "ap-shanghai",
  clsTopicId: "5407c0a7-3e37-4c45-a204-bf5d40f157a1",
  clsSource: "boss-observer-extension",
  uploadBatchSize: 50,
  maxQueueSize: 1000,
  flushIntervalMs: 30000,
  minDwellMs: 1000
});

export async function readConfig() {
  const stored = await chrome.storage.local.get("bossObserver.config");
  return {
    ...DEFAULT_CONFIG,
    ...(stored["bossObserver.config"] || {})
  };
}

export function hasUploadTarget(config) {
  if (config.uploadEnabled !== true) {
    return false;
  }

  return hasClsAnonymousConfig(config) || Boolean(config.uploadEndpoint);
}
