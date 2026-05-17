import { hasClsAnonymousConfig } from "./cls-log-format.js";

export const DEFAULT_CONFIG = Object.freeze({
  enabled: true,
  debug: true,
  operatorId: "",
  accountName: "",
  uploadEnabled: true,
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
  return normalizeConfig({
    ...DEFAULT_CONFIG,
    ...(stored["bossObserver.config"] || {})
  });
}

export async function writeConfig(patch = {}) {
  const current = await readConfig();
  const next = normalizeConfig({
    ...current,
    ...patch
  });
  await chrome.storage.local.set({ "bossObserver.config": next });
  return next;
}

export function normalizeConfig(config = {}) {
  return {
    ...DEFAULT_CONFIG,
    ...config,
    operatorId: cleanSingleLine(config.operatorId),
    accountName: cleanSingleLine(config.accountName)
  };
}

export function hasUploadTarget(config) {
  if (config.uploadEnabled !== true) {
    return false;
  }

  return hasClsAnonymousConfig(config) || Boolean(config.uploadEndpoint);
}

function cleanSingleLine(value = "") {
  return String(value || "")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
}
