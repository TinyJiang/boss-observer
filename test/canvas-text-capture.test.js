import test from "node:test";
import assert from "node:assert/strict";

import {
  buildCanvasTextLines,
  buildCanvasTextSnapshot,
  createCanvasTextCaptureStore,
  startCanvasTextCaptureRuntime
} from "../extension/src/content/canvas-text-capture.js";

test("canvas text capture rebuilds lines from character draws and removes redraw duplicates", () => {
  const items = [
    canvasItem("李", 10, 20, 1000),
    canvasItem("大", 25, 20, 1000),
    canvasItem("钱", 40, 20, 1000),
    canvasItem("刚刚活跃", 95, 20, 1000, 52),
    canvasItem("24岁 | 4年 | 大专 | 在职-暂不考虑", 10, 48, 1000, 260),
    canvasItem("期望职位", 10, 86, 1000, 68),
    canvasItem("赣州 兼职·主播 行业不限", 10, 114, 1000, 160),
    canvasItem("李", 10, 20, 1200),
    canvasItem("大", 25, 20, 1200),
    canvasItem("钱", 40, 20, 1200)
  ];

  assert.deepEqual(buildCanvasTextLines(items), [
    "李大钱 刚刚活跃",
    "24岁 | 4年 | 大专 | 在职-暂不考虑",
    "期望职位",
    "赣州 兼职·主播 行业不限"
  ]);
});

test("canvas text capture snapshot uses the latest render burst", () => {
  const snapshot = buildCanvasTextSnapshot([
    canvasItem("上一位候选人", 10, 20, 1000, 96),
    canvasItem("工作经历", 10, 50, 1000, 68),
    canvasItem("廖淑雯", 10, 20, 5000, 54),
    canvasItem("3日内活跃", 80, 20, 5000, 72),
    canvasItem("27岁 | 10年 | 高中 | 离职-随时到岗", 10, 48, 5000, 260)
  ], {
    latestAtMs: 5000,
    activityWindowMs: 1500
  });

  assert.equal(snapshot.present, true);
  assert.deepEqual(snapshot.lines, [
    "廖淑雯 3日内活跃",
    "27岁 | 10年 | 高中 | 离职-随时到岗"
  ]);
  assert.equal(snapshot.text.includes("上一位候选人"), false);
});

test("canvas text capture store keeps only bounded recent frame snapshots", () => {
  let now = 1000;
  const store = createCanvasTextCaptureStore({
    frameTtlMs: 3000,
    now: () => now
  });

  store.append({
    frameUrl: "https://www.zhipin.com/web/frame/c-resume/?source=recommend",
    capturedAtMs: 1000,
    items: [
      canvasItem("黄仁丽", 10, 20, 1000, 54),
      canvasItem("刚刚活跃", 80, 20, 1000, 72)
    ]
  });

  assert.equal(
    store.readText("https://www.zhipin.com/web/frame/c-resume/?source=recommend"),
    "黄仁丽 刚刚活跃"
  );

  now = 5000;
  assert.equal(
    store.readText("https://www.zhipin.com/web/frame/c-resume/?source=recommend"),
    ""
  );
});

test("canvas text capture runtime requests replay after listener installation", () => {
  const sentMessages = [];
  const win = createFakeWindow({
    postMessage(message, targetOrigin) {
      sentMessages.push({ message, targetOrigin });
    }
  });

  startCanvasTextCaptureRuntime({
    win,
    store: createCanvasTextCaptureStore(),
    requestFlushDelaysMs: [0]
  });

  assert.deepEqual(sentMessages, [
    {
      message: {
        source: "bossObserver.canvasTextCapture.requestFlush"
      },
      targetOrigin: "https://www.zhipin.com"
    }
  ]);
});

test("canvas text capture runtime stores replayed detail frame text", () => {
  const store = createCanvasTextCaptureStore({
    now: () => 1000
  });
  const win = createFakeWindow();
  startCanvasTextCaptureRuntime({
    win,
    store,
    requestFlushDelaysMs: []
  });

  win.dispatchMessage({
    origin: "https://www.zhipin.com",
    source: win,
    data: {
      source: "bossObserver.canvasTextCapture.text",
      frameUrl: "https://www.zhipin.com/web/frame/c-resume/?source=recommend",
      capturedAtMs: 1000,
      items: [
        canvasItem("不吃大葱", 10, 20, 1000, 72),
        canvasItem("3日内活跃", 95, 20, 1000, 72)
      ]
    }
  });

  assert.equal(
    store.readText("https://www.zhipin.com/web/frame/c-resume/?source=recommend"),
    "不吃大葱 3日内活跃"
  );
});

test("canvas text capture runtime stores forwarded child-frame replay in top frame", () => {
  const store = createCanvasTextCaptureStore({
    now: () => 1000
  });
  const win = createFakeWindow();
  startCanvasTextCaptureRuntime({
    win,
    store,
    requestFlushDelaysMs: []
  });

  win.dispatchMessage({
    origin: "https://www.zhipin.com",
    source: {},
    data: {
      source: "bossObserver.canvasTextCapture.forward",
      frameUrl: "https://www.zhipin.com/web/frame/c-resume/?source=recommend",
      capturedAtMs: 1000,
      items: [
        canvasItem("工作经历", 10, 20, 1000, 68),
        canvasItem("赣州某传媒公司 主播", 10, 48, 1000, 160)
      ]
    }
  });

  assert.equal(
    store.readText("https://www.zhipin.com/web/frame/c-resume/?source=recommend"),
    "工作经历\n赣州某传媒公司 主播"
  );
});

function canvasItem(text, x, y, observedAtMs, width = 14) {
  return {
    text,
    x,
    y,
    width,
    observedAtMs
  };
}

function createFakeWindow({
  postMessage = () => {}
} = {}) {
  const listeners = [];
  const win = {
    top: null,
    location: {
      origin: "https://www.zhipin.com"
    },
    addEventListener(type, listener) {
      if (type === "message") {
        listeners.push(listener);
      }
    },
    postMessage,
    dispatchMessage(event) {
      listeners.forEach((listener) => listener(event));
    },
    setTimeout(callback) {
      callback();
    }
  };
  win.top = win;
  return win;
}
