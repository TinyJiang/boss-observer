(() => {
  const HOOK_FLAG = "__bossObserverCanvasTextCaptureHookInstalled";
  const TEXT_SOURCE = "bossObserver.canvasTextCapture.text";
  const REQUEST_SOURCE = "bossObserver.canvasTextCapture.requestFlush";
  const FLUSH_DELAY_MS = 50;
  const MAX_PENDING_ITEMS = 500;
  const MAX_RECENT_ITEMS = 4000;
  const MAX_TEXT_CHARS = 120;
  const RECENT_ITEM_TTL_MS = 120000;

  if (window[HOOK_FLAG]) {
    return;
  }
  window[HOOK_FLAG] = true;

  const context2d = window.CanvasRenderingContext2D?.prototype;
  if (!context2d) {
    return;
  }

  const originalFillText = context2d.fillText;
  const originalStrokeText = context2d.strokeText;
  const pendingItems = [];
  const recentItems = [];
  let flushHandle = null;

  window.addEventListener("message", (event) => {
    if (event.source !== window || event.data?.source !== REQUEST_SOURCE) {
      return;
    }

    flushRecentItems();
  });

  if (typeof originalFillText === "function") {
    context2d.fillText = function bossObserverFillText(text, x, y) {
      captureCanvasText(this, "fillText", text, x, y);
      return originalFillText.apply(this, arguments);
    };
  }

  if (typeof originalStrokeText === "function") {
    context2d.strokeText = function bossObserverStrokeText(text, x, y) {
      captureCanvasText(this, "strokeText", text, x, y);
      return originalStrokeText.apply(this, arguments);
    };
  }

  function captureCanvasText(context, operation, value, x, y) {
    const frameUrl = resolveCaptureFrameUrl();
    if (!frameUrl) {
      return;
    }

    const text = normalizeText(value);
    if (!text || text.length > MAX_TEXT_CHARS) {
      return;
    }

    const point = applyCanvasTransform(context, Number(x), Number(y));
    const rect = readCanvasRect(context?.canvas);
    const item = {
      text,
      operation,
      frameUrl,
      x: rect.left + point.x,
      y: rect.top + point.y,
      width: measureTextWidth(context, text),
      font: String(context?.font || ""),
      canvasWidth: Number(context?.canvas?.width || 0),
      canvasHeight: Number(context?.canvas?.height || 0),
      observedAtMs: Date.now()
    };
    pendingItems.push(item);
    recentItems.push(item);

    if (pendingItems.length > MAX_PENDING_ITEMS) {
      pendingItems.splice(0, pendingItems.length - MAX_PENDING_ITEMS);
    }
    pruneRecentItems(Date.now());
    scheduleFlush();
  }

  function resolveCaptureFrameUrl() {
    const currentFrameUrl = readWindowHref(window);
    if (isCandidateDetailFrameUrl(currentFrameUrl)) {
      return currentFrameUrl;
    }

    let current = window.parent;
    for (let depth = 0; current && current !== window && depth < 4; depth += 1) {
      const href = readWindowHref(current);
      if (isCandidateDetailFrameUrl(href)) {
        return href;
      }
      if (current === current.parent) {
        break;
      }
      current = current.parent;
    }

    return "";
  }

  function scheduleFlush() {
    if (flushHandle !== null) {
      return;
    }

    flushHandle = window.setTimeout(flushPendingItems, FLUSH_DELAY_MS);
  }

  function flushPendingItems() {
    flushHandle = null;
    if (!pendingItems.length) {
      return;
    }

    const items = pendingItems.splice(0, pendingItems.length);
    postGroupedItems(items);
  }

  function flushRecentItems() {
    pruneRecentItems(Date.now());
    if (!recentItems.length) {
      return;
    }

    postGroupedItems(recentItems);
  }

  function postGroupedItems(items) {
    const groupedItems = new Map();
    for (const item of items) {
      const frameUrl = item.frameUrl || resolveCaptureFrameUrl();
      if (!frameUrl) {
        continue;
      }
      if (!groupedItems.has(frameUrl)) {
        groupedItems.set(frameUrl, []);
      }
      groupedItems.get(frameUrl).push(stripInternalFields(item));
    }

    for (const [frameUrl, frameItems] of groupedItems.entries()) {
      postItems(frameUrl, frameItems);
    }
  }

  function postItems(frameUrl, items) {
    if (!items.length) {
      return;
    }

    window.postMessage({
      source: TEXT_SOURCE,
      frameUrl,
      capturedAtMs: Date.now(),
      items
    }, window.location.origin);
  }

  function stripInternalFields(item) {
    const {
      frameUrl: _frameUrl,
      ...publicItem
    } = item;
    return publicItem;
  }

  function pruneRecentItems(referenceMs) {
    const firstFreshIndex = recentItems.findIndex((item) => referenceMs - item.observedAtMs <= RECENT_ITEM_TTL_MS);
    if (firstFreshIndex > 0) {
      recentItems.splice(0, firstFreshIndex);
    } else if (firstFreshIndex < 0 && recentItems.length > 0) {
      recentItems.splice(0, recentItems.length);
    }

    if (recentItems.length > MAX_RECENT_ITEMS) {
      recentItems.splice(0, recentItems.length - MAX_RECENT_ITEMS);
    }
  }

  function readWindowHref(targetWindow) {
    try {
      return targetWindow?.location?.href || "";
    } catch {
      return "";
    }
  }

  function isCandidateDetailFrameUrl(url) {
    try {
      const parsed = new URL(url);
      return parsed.hostname === "www.zhipin.com" &&
        (
          parsed.pathname.includes("/web/frame/c-resume") ||
          parsed.pathname.includes("/geek/detail") ||
          parsed.pathname.includes("/resume/detail") ||
          parsed.searchParams.has("geekId")
        );
    } catch {
      return false;
    }
  }

  function applyCanvasTransform(context, x, y) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      return { x: 0, y: 0 };
    }

    try {
      const transform = context?.getTransform?.();
      if (!transform) {
        return { x, y };
      }

      return {
        x: transform.a * x + transform.c * y + transform.e,
        y: transform.b * x + transform.d * y + transform.f
      };
    } catch {
      return { x, y };
    }
  }

  function readCanvasRect(canvas) {
    try {
      const rect = canvas?.getBoundingClientRect?.();
      return {
        left: Number(rect?.left || 0),
        top: Number(rect?.top || 0)
      };
    } catch {
      return {
        left: 0,
        top: 0
      };
    }
  }

  function measureTextWidth(context, text) {
    try {
      const width = Number(context?.measureText?.(text)?.width || 0);
      return Number.isFinite(width) ? width : 0;
    } catch {
      return 0;
    }
  }

  function normalizeText(value) {
    return String(value ?? "")
      .replace(/\s+/g, " ")
      .trim();
  }
})();
