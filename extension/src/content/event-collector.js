import { createId } from "../shared/id.js";
import { nowLocalIsoString } from "../shared/time.js";

export class EventCollector {
  constructor({ config, sessionContext }) {
    this.config = config;
    this.sessionContext = sessionContext;
  }

  collect(type, payload = {}) {
    const event = {
      id: createId("evt"),
      type,
      occurredAt: nowLocalIsoString(),
      pluginVersion: chrome.runtime.getManifest().version,
      context: this.sessionContext.snapshot(),
      payload
    };

    if (this.config.debug) {
      console.debug("[BOSS Observer]", event.type, event);
    }

    chrome.runtime.sendMessage({ kind: "bossObserver.event", event }, () => {
      const error = chrome.runtime.lastError;
      if (error && this.config.debug) {
        console.warn("[BOSS Observer] event send failed", error.message);
      }
    });

    return event;
  }
}
