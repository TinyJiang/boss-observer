export const COLLECTION_GATE_STATUS = Object.freeze({
  OK: "ok",
  OPERATOR_UNCONFIGURED: "operator_unconfigured",
  BOSS_ACCOUNT_UNKNOWN: "boss_account_unknown",
  BOSS_ACCOUNT_MISMATCH: "boss_account_mismatch"
});

export function normalizeOperatorConfig(config = {}) {
  return {
    operatorId: cleanSingleLine(config.operatorId),
    accountName: cleanDisplayName(config.accountName)
  };
}

export function normalizeBossAccountObservation(observation = {}) {
  const accountName = cleanDisplayName(
    observation.accountName || observation.displayName || observation.name
  );
  return compactObject({
    accountName,
    source: cleanSingleLine(observation.source),
    confidence: cleanSingleLine(observation.confidence),
    observedAt: cleanSingleLine(observation.observedAt),
    pageUrl: cleanSingleLine(observation.pageUrl),
    sourceTabId: normalizeInteger(observation.sourceTabId),
    sourceWindowId: normalizeInteger(observation.sourceWindowId)
  });
}

export function evaluateCollectionGate(config = {}, bossAccountObservation = null) {
  const operator = normalizeOperatorConfig(config);
  const bossAccount = normalizeBossAccountObservation(bossAccountObservation || {});
  if (!operator.operatorId || !operator.accountName) {
    return buildGate({
      status: COLLECTION_GATE_STATUS.OPERATOR_UNCONFIGURED,
      operator,
      bossAccount,
      message: "请先配置操作员 id 和账号姓名，采集已停止。"
    });
  }

  if (!bossAccount.accountName) {
    return buildGate({
      status: COLLECTION_GATE_STATUS.BOSS_ACCOUNT_UNKNOWN,
      operator,
      bossAccount,
      message: "未检测到 BOSS 页面展示的账号姓名，采集已停止。"
    });
  }

  if (normalizeAccountNameForCompare(operator.accountName) !== normalizeAccountNameForCompare(bossAccount.accountName)) {
    return buildGate({
      status: COLLECTION_GATE_STATUS.BOSS_ACCOUNT_MISMATCH,
      operator,
      bossAccount,
      message: "配置的账号姓名与 BOSS 页面展示姓名不一致，采集已停止。"
    });
  }

  return buildGate({
    status: COLLECTION_GATE_STATUS.OK,
    operator,
    bossAccount,
    message: "操作员信息已配置，BOSS 账号姓名匹配。"
  });
}

export function buildEventOperator(gate = {}) {
  const operator = normalizeOperatorConfig(gate.operator || {});
  const bossAccount = normalizeBossAccountObservation(gate.bossAccount || {});
  return compactObject({
    operatorId: operator.operatorId,
    accountName: operator.accountName,
    bossAccountName: bossAccount.accountName,
    bossAccountMatched: gate.status === COLLECTION_GATE_STATUS.OK
  });
}

export function attachOperatorToEvent(event = {}, gate = {}) {
  return {
    ...event,
    operator: buildEventOperator(gate)
  };
}

export function normalizeAccountNameForCompare(value = "") {
  return String(value || "")
    .replace(/\s+/g, "")
    .toLocaleLowerCase();
}

function buildGate({ status, operator, bossAccount, message }) {
  const canCollect = status === COLLECTION_GATE_STATUS.OK;
  return {
    status,
    canCollect,
    severity: canCollect ? "ok" : "critical",
    message,
    operator,
    bossAccount
  };
}

function cleanSingleLine(value = "") {
  return String(value || "")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
}

function cleanDisplayName(value = "") {
  return cleanSingleLine(value);
}

function normalizeInteger(value) {
  const number = Number(value);
  return Number.isInteger(number) ? number : null;
}

function compactObject(object = {}) {
  return Object.fromEntries(
    Object.entries(object).filter(([, value]) => value !== "" && value !== null && value !== undefined)
  );
}
