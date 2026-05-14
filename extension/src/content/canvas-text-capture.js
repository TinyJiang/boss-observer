const TEXT_SOURCE = "bossObserver.canvasTextCapture.text";
const FORWARD_SOURCE = "bossObserver.canvasTextCapture.forward";
const REQUEST_SOURCE = "bossObserver.canvasTextCapture.requestFlush";
const RUNTIME_FLAG = "__bossObserverCanvasTextCaptureRuntimeInstalled";
const DEFAULT_MAX_FRAME_ITEMS = 4000;
const DEFAULT_FRAME_TTL_MS = 120000;
const DEFAULT_ACTIVITY_WINDOW_MS = 2500;
const LINE_Y_TOLERANCE = 6;
const COORDINATE_PRECISION = 2;
const MAX_SNAPSHOT_CHARS = 20000;

const defaultStore = createCanvasTextCaptureStore();

export function startCanvasTextCaptureRuntime({
  store = defaultStore,
  win = globalThis.window,
  requestFlushDelaysMs = [0, 500, 2000]
} = {}) {
  if (!win || win[RUNTIME_FLAG]) {
    return;
  }
  win[RUNTIME_FLAG] = true;

  win.addEventListener("message", (event) => {
    if (event.origin !== win.location?.origin) {
      return;
    }

    const data = event.data || {};
    if (data.source === TEXT_SOURCE && event.source === win) {
      handleCanvasTextMessage({
        store,
        win,
        frameUrl: data.frameUrl,
        capturedAtMs: data.capturedAtMs,
        items: data.items
      });
      return;
    }

    if (data.source === FORWARD_SOURCE && win.top === win) {
      store.append({
        frameUrl: data.frameUrl,
        capturedAtMs: data.capturedAtMs,
        items: data.items
      });
    }
  });
  requestCanvasTextFlush(win, requestFlushDelaysMs);
}

export function readCanvasTextForDocument(document) {
  const sourceUrl = document?.location?.href || "";
  return defaultStore.readText(sourceUrl);
}

export function createCanvasTextCaptureStore({
  maxFrameItems = DEFAULT_MAX_FRAME_ITEMS,
  frameTtlMs = DEFAULT_FRAME_TTL_MS,
  activityWindowMs = DEFAULT_ACTIVITY_WINDOW_MS,
  now = () => Date.now()
} = {}) {
  const frames = new Map();

  return {
    append({ frameUrl = "", capturedAtMs = now(), items = [] } = {}) {
      const normalizedFrameUrl = String(frameUrl || "");
      if (!normalizedFrameUrl || !Array.isArray(items) || items.length === 0) {
        return;
      }

      const frame = frames.get(normalizedFrameUrl) || {
        items: [],
        snapshot: emptySnapshot(),
        lastCapturedAtMs: 0
      };
      const normalizedItems = items
        .map((item) => normalizeCanvasTextItem(item, capturedAtMs))
        .filter(Boolean);
      if (!normalizedItems.length) {
        return;
      }

      frame.items.push(...normalizedItems);
      if (frame.items.length > maxFrameItems) {
        frame.items.splice(0, frame.items.length - maxFrameItems);
      }
      frame.lastCapturedAtMs = Math.max(
        frame.lastCapturedAtMs,
        ...normalizedItems.map((item) => item.observedAtMs)
      );
      frame.snapshot = buildCanvasTextSnapshot(frame.items, {
        latestAtMs: frame.lastCapturedAtMs,
        activityWindowMs
      });
      frames.set(normalizedFrameUrl, frame);
      prune(now());
    },

    readSnapshot(frameUrl = "") {
      prune(now());
      return frames.get(String(frameUrl || ""))?.snapshot || emptySnapshot();
    },

    readText(frameUrl = "") {
      return this.readSnapshot(frameUrl).text;
    },

    clear() {
      frames.clear();
    },

    _frames: frames
  };

  function prune(referenceMs) {
    for (const [frameUrl, frame] of frames.entries()) {
      if (referenceMs - frame.lastCapturedAtMs > frameTtlMs) {
        frames.delete(frameUrl);
      }
    }
  }
}

export function buildCanvasTextSnapshot(items = [], {
  latestAtMs = null,
  activityWindowMs = DEFAULT_ACTIVITY_WINDOW_MS
} = {}) {
  const normalizedItems = items
    .map((item) => normalizeCanvasTextItem(item, latestAtMs || Date.now()))
    .filter(Boolean);
  if (!normalizedItems.length) {
    return emptySnapshot();
  }

  const maxObservedAtMs = Number.isFinite(Number(latestAtMs)) ?
    Number(latestAtMs) :
    Math.max(...normalizedItems.map((item) => item.observedAtMs));
  const minObservedAtMs = maxObservedAtMs - activityWindowMs;
  const recentItems = normalizedItems
    .filter((item) => item.observedAtMs >= minObservedAtMs)
    .sort((left, right) => (left.y - right.y) || (left.x - right.x) || (left.observedAtMs - right.observedAtMs));
  const lines = buildCanvasTextLines(recentItems);
  const text = lines.join("\n").slice(0, MAX_SNAPSHOT_CHARS);

  return {
    present: text.length > 0,
    text,
    lines,
    itemCount: recentItems.length,
    latestAtMs: maxObservedAtMs
  };
}

export function buildCanvasTextLines(items = []) {
  const lines = [];
  const seenItems = new Set();

  for (const item of items) {
    const normalizedItem = normalizeCanvasTextItem(item);
    if (!normalizedItem) {
      continue;
    }

    const itemKey = buildCanvasTextItemKey(normalizedItem);
    if (seenItems.has(itemKey)) {
      continue;
    }
    seenItems.add(itemKey);

    const line = findCanvasLine(lines, normalizedItem.y);
    line.items.push(normalizedItem);
    line.yValues.push(normalizedItem.y);
    line.y = average(line.yValues);
  }

  return lines
    .sort((left, right) => left.y - right.y)
    .map((line) => joinCanvasLineItems(line.items))
    .filter(Boolean);
}

export function normalizeCanvasTextItem(item = {}, fallbackObservedAtMs = Date.now()) {
  const text = normalizeText(item.text);
  if (!text || text.length > 120 || isLikelyNonReadableCanvasText(text)) {
    return null;
  }

  const x = Number(item.x);
  const y = Number(item.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    return null;
  }

  const width = Number(item.width);
  const observedAtMs = Number(item.observedAtMs ?? fallbackObservedAtMs);

  return {
    text,
    x,
    y,
    width: Number.isFinite(width) && width > 0 ? width : estimateTextWidth(text),
    observedAtMs: Number.isFinite(observedAtMs) ? observedAtMs : fallbackObservedAtMs
  };
}

function handleCanvasTextMessage({ store, win, frameUrl, capturedAtMs, items }) {
  if (win.top === win) {
    store.append({ frameUrl, capturedAtMs, items });
    return;
  }

  try {
    win.top?.postMessage({
      source: FORWARD_SOURCE,
      frameUrl,
      capturedAtMs,
      items
    }, win.location.origin);
  } catch {
    // Cross-frame forwarding is best-effort; same-origin BOSS frames are expected.
  }
}

function requestCanvasTextFlush(win, delaysMs) {
  const safeDelays = Array.isArray(delaysMs) ? delaysMs : [];
  for (const delayMs of safeDelays) {
    const normalizedDelayMs = Number(delayMs);
    if (!Number.isFinite(normalizedDelayMs) || normalizedDelayMs < 0) {
      continue;
    }

    if (normalizedDelayMs === 0 || typeof win.setTimeout !== "function") {
      postCanvasTextFlushRequest(win);
      continue;
    }

    win.setTimeout(() => postCanvasTextFlushRequest(win), normalizedDelayMs);
  }
}

function postCanvasTextFlushRequest(win) {
  try {
    win.postMessage({
      source: REQUEST_SOURCE
    }, win.location?.origin || "*");
  } catch {
    // Replay requests are best-effort; normal live capture may still arrive.
  }
}

function findCanvasLine(lines, y) {
  const existing = lines.find((line) => Math.abs(line.y - y) <= LINE_Y_TOLERANCE);
  if (existing) {
    return existing;
  }

  const line = {
    y,
    yValues: [y],
    items: []
  };
  lines.push(line);
  return line;
}

function joinCanvasLineItems(items) {
  const sortedItems = [...items].sort((left, right) => left.x - right.x || left.observedAtMs - right.observedAtMs);
  let output = "";
  let previous = null;
  for (const item of sortedItems) {
    if (previous && shouldInsertCanvasTextSpace(previous, item)) {
      output += " ";
    }
    output += item.text;
    previous = item;
  }

  return normalizeText(output);
}

function shouldInsertCanvasTextSpace(previous, current) {
  const previousRight = previous.x + previous.width;
  const gap = current.x - previousRight;
  if (gap <= 3) {
    return false;
  }

  if (previous.text.length === 1 || current.text.length === 1) {
    return gap > Math.max(8, Math.min(previous.width, current.width) * 0.8);
  }

  return gap > 4;
}

function buildCanvasTextItemKey(item) {
  return [
    item.text,
    item.x.toFixed(COORDINATE_PRECISION),
    item.y.toFixed(COORDINATE_PRECISION)
  ].join("|");
}

function estimateTextWidth(text) {
  return Array.from(text).reduce((width, char) => {
    if (/[\u4e00-\u9fa5]/.test(char)) {
      return width + 14;
    }
    if (/[A-Z0-9]/i.test(char)) {
      return width + 8;
    }
    return width + 6;
  }, 0);
}

function isLikelyNonReadableCanvasText(text) {
  return /^[\u0000-\u001f]+$/.test(text) ||
    /^data:image\//i.test(text) ||
    /^blob:/i.test(text);
}

function normalizeText(value = "") {
  return String(value)
    .replace(/\s+/g, " ")
    .trim();
}

function average(values) {
  return values.reduce((total, value) => total + value, 0) / values.length;
}

function emptySnapshot() {
  return {
    present: false,
    text: "",
    lines: [],
    itemCount: 0,
    latestAtMs: 0
  };
}
