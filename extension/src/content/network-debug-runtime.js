import(chrome.runtime.getURL("src/content/network-debug-probe.js"))
  .then(({ NetworkDebugProbe }) => {
    const probe = new NetworkDebugProbe();
    probe.start();
  })
  .catch((error) => {
    console.warn("[BOSS Observer] network debug bootstrap failed", error);
  });
