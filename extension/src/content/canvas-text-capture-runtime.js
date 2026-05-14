import(chrome.runtime.getURL("src/content/canvas-text-capture.js"))
  .then(({ startCanvasTextCaptureRuntime }) => {
    startCanvasTextCaptureRuntime();
  })
  .catch((error) => {
    console.warn("[BOSS Observer] canvas text capture bootstrap failed", error);
  });
