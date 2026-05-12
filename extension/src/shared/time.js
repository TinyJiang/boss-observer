export function nowLocalIsoString() {
  return toLocalIsoString(new Date());
}

export function toLocalIsoString(date, { offsetMinutes = date.getTimezoneOffset() } = {}) {
  const localDate = new Date(date.getTime() - offsetMinutes * 60 * 1000);
  const offsetSign = offsetMinutes <= 0 ? "+" : "-";
  const absoluteOffset = Math.abs(offsetMinutes);
  const offsetHours = Math.floor(absoluteOffset / 60);
  const offsetRemainingMinutes = absoluteOffset % 60;

  return `${localDate.getUTCFullYear()}-${pad2(localDate.getUTCMonth() + 1)}-${pad2(localDate.getUTCDate())}`
    + `T${pad2(localDate.getUTCHours())}:${pad2(localDate.getUTCMinutes())}:${pad2(localDate.getUTCSeconds())}`
    + `.${pad3(localDate.getUTCMilliseconds())}${offsetSign}${pad2(offsetHours)}:${pad2(offsetRemainingMinutes)}`;
}

function pad2(value) {
  return String(value).padStart(2, "0");
}

function pad3(value) {
  return String(value).padStart(3, "0");
}
