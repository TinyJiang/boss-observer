export function getChatSnapshotCoverageLastMessageAt(chat = {}) {
  return pickLatestIsoTime([
    chat.coverageLastMessageAt,
    chat.listObservedLastMessageAt,
    chat.lastMessageAt
  ]);
}

export function isIsoTimeAfter(left, right) {
  const leftTime = Date.parse(left || "");
  if (!Number.isFinite(leftTime)) {
    return false;
  }

  const rightTime = Date.parse(right || "");
  if (!Number.isFinite(rightTime)) {
    return true;
  }

  return leftTime > rightTime;
}

export function isIsoTimeAtOrAfter(left, right) {
  if (!left || !right) {
    return false;
  }

  const leftTime = Date.parse(left);
  const rightTime = Date.parse(right);
  if (!Number.isFinite(leftTime) || !Number.isFinite(rightTime)) {
    return true;
  }

  return leftTime >= rightTime;
}

function pickLatestIsoTime(values = []) {
  let latestValue = "";
  let latestTime = Number.NEGATIVE_INFINITY;
  const fallback = values.find((value) => Boolean(value)) || "";

  values.forEach((value) => {
    const time = Date.parse(value || "");
    if (!Number.isFinite(time) || time <= latestTime) {
      return;
    }
    latestTime = time;
    latestValue = value;
  });

  return latestValue || fallback;
}
