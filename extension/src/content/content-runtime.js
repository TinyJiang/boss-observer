import(chrome.runtime.getURL("src/content/main.js")).catch((error) => {
  console.warn("[BOSS Observer] bootstrap failed", error);
});
