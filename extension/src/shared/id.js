export function createId(prefix = "evt") {
  const randomPart =
    globalThis.crypto && "randomUUID" in globalThis.crypto
      ? globalThis.crypto.randomUUID()
      : Math.random().toString(36).slice(2);
  return `${prefix}_${Date.now()}_${randomPart}`;
}

export function getOrCreateSessionId(storageKey = "bossObserver.sessionId") {
  const existing = sessionStorage.getItem(storageKey);
  if (existing) {
    return existing;
  }

  const next = createId("session");
  sessionStorage.setItem(storageKey, next);
  return next;
}
