import { NETWORK_DEBUG_MAX_PREVIEW_CHARS } from "../shared/network-debug.js";

const HOOK_SCRIPT_ID = "boss-observer-network-debug-hook";
const PAGE_REQUEST_SOURCE = "bossObserver.networkDebug.request";
const PAGE_CONTROL_SOURCE = "bossObserver.networkDebug.control";

// Responsibilities:
// - inject a temporary main-world fetch/XHR hook for local diagnostics
// - forward captured request samples to background debug state only
// - never write network response bodies into the formal event queue
export class NetworkDebugProbe {
  constructor({
    maxPreviewChars = NETWORK_DEBUG_MAX_PREVIEW_CHARS
  } = {}) {
    this.maxPreviewChars = maxPreviewChars;
    this.enabled = false;
    this.started = false;
    this.injectHandle = null;
    this.onWindowMessage = this.onWindowMessage.bind(this);
    this.onRuntimeMessage = this.onRuntimeMessage.bind(this);
  }

  start() {
    if (this.started) {
      return;
    }

    this.started = true;
    this.injectHookScript();
    this.injectHandle = window.setInterval(() => {
      this.injectHookScript();
      this.syncEnabledState();
    }, 1000);
    window.addEventListener("message", this.onWindowMessage);
    chrome.runtime.onMessage.addListener(this.onRuntimeMessage);
    this.syncEnabledState();
  }

  stop() {
    if (!this.started) {
      return;
    }

    this.started = false;
    if (this.injectHandle !== null) {
      window.clearInterval(this.injectHandle);
      this.injectHandle = null;
    }
    window.removeEventListener("message", this.onWindowMessage);
    chrome.runtime.onMessage.removeListener(this.onRuntimeMessage);
    this.postControl({ enabled: false });
  }

  onWindowMessage(event) {
    if (!isTrustedBossOrigin(event.origin) || event.data?.source !== PAGE_REQUEST_SOURCE) {
      return;
    }

    chrome.runtime.sendMessage({
      kind: "bossObserver.networkDebug.request",
      request: event.data.request
    }, () => {
      // Best-effort diagnostic channel. A restarted service worker should not affect BOSS.
      void chrome.runtime.lastError;
    });
  }

  onRuntimeMessage(message, _sender, sendResponse) {
    if (!message || message.kind !== "bossObserver.networkDebug.control") {
      return false;
    }

    this.postControl({
      enabled: message.enabled === true,
      maxPreviewChars: message.maxPreviewChars
    });
    sendResponse?.({ ok: true });
    return false;
  }

  syncEnabledState() {
    chrome.runtime.sendMessage({
      kind: "bossObserver.networkDebug.ready"
    }, (response) => {
      if (chrome.runtime.lastError) {
        return;
      }
      this.postControl({
        enabled: response?.enabled === true,
        maxPreviewChars: response?.maxPreviewChars
      });
    });
  }

  injectHookScript() {
    injectHookIntoDocument(document);
    for (const frameDocument of collectAccessibleFrameDocuments(document)) {
      injectHookIntoDocument(frameDocument);
    }
  }

  postControl({ enabled, maxPreviewChars = this.maxPreviewChars }) {
    this.enabled = enabled === true;
    this.maxPreviewChars = Number.isFinite(Number(maxPreviewChars)) ?
      Number(maxPreviewChars) :
      this.maxPreviewChars;
    const message = {
      source: PAGE_CONTROL_SOURCE,
      enabled: this.enabled,
      maxPreviewChars: this.maxPreviewChars
    };
    postControlToWindow(window, message);
    for (const frame of document.querySelectorAll("iframe")) {
      try {
        if (frame.contentWindow) {
          postControlToWindow(frame.contentWindow, message);
        }
      } catch {
        // Cross-origin frames are ignored. BOSS recommend/resume frames observed so far are same-origin.
      }
    }
  }
}

function injectHookIntoDocument(targetDocument) {
  const root = targetDocument?.documentElement;
  if (!targetDocument || !root || root.dataset?.bossObserverNetworkDebugHookInjected === "true" ||
      targetDocument.getElementById?.(HOOK_SCRIPT_ID)) {
    return;
  }

  root.dataset.bossObserverNetworkDebugHookInjected = "true";
  const script = targetDocument.createElement("script");
  script.id = HOOK_SCRIPT_ID;
  script.src = chrome.runtime.getURL("src/content/network-debug-hook.js");
  script.async = false;
  script.onload = () => script.remove();
  const target = targetDocument.documentElement || targetDocument.head || targetDocument.body;
  target?.appendChild(script);
}

function collectAccessibleFrameDocuments(rootDocument) {
  const frameDocuments = [];
  for (const frame of rootDocument.querySelectorAll?.("iframe") || []) {
    try {
      if (frame.contentDocument) {
        frameDocuments.push(frame.contentDocument);
      }
    } catch {
      // Cross-origin frames are ignored.
    }
  }
  return frameDocuments;
}

function postControlToWindow(targetWindow, message) {
  try {
    targetWindow.postMessage(message, window.location.origin);
  } catch {
    // Best-effort diagnostic control.
  }
}

function isTrustedBossOrigin(origin) {
  try {
    const parsed = new URL(origin);
    return parsed.hostname === "zhipin.com" ||
      parsed.hostname === "www.zhipin.com" ||
      parsed.hostname.endsWith(".zhipin.com");
  } catch {
    return false;
  }
}
