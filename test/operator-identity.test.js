import test from "node:test";
import assert from "node:assert/strict";

import {
  attachOperatorToEvent,
  buildEventOperator,
  COLLECTION_GATE_STATUS,
  evaluateCollectionGate,
  normalizeAccountNameForCompare
} from "../extension/src/shared/operator-identity.js";

test("collection gate blocks when operator config is missing", () => {
  const gate = evaluateCollectionGate({}, {
    accountName: "张三"
  });

  assert.equal(gate.status, COLLECTION_GATE_STATUS.OPERATOR_UNCONFIGURED);
  assert.equal(gate.canCollect, false);
  assert.equal(gate.severity, "critical");
});

test("collection gate blocks until boss account name is observed", () => {
  const gate = evaluateCollectionGate({
    operatorId: "op-1",
    accountName: "张三"
  });

  assert.equal(gate.status, COLLECTION_GATE_STATUS.BOSS_ACCOUNT_UNKNOWN);
  assert.equal(gate.canCollect, false);
});

test("collection gate blocks mismatched boss account names", () => {
  const gate = evaluateCollectionGate({
    operatorId: "op-1",
    accountName: "张三"
  }, {
    accountName: "李四"
  });

  assert.equal(gate.status, COLLECTION_GATE_STATUS.BOSS_ACCOUNT_MISMATCH);
  assert.equal(gate.canCollect, false);
});

test("collection gate allows matching operator and boss account names", () => {
  const gate = evaluateCollectionGate({
    operatorId: " op-1 ",
    accountName: "张 三"
  }, {
    accountName: "张三",
    source: "top_header_user_class"
  });

  assert.equal(gate.status, COLLECTION_GATE_STATUS.OK);
  assert.equal(gate.canCollect, true);
  assert.equal(gate.operator.operatorId, "op-1");
  assert.equal(normalizeAccountNameForCompare(gate.operator.accountName), "张三");
  assert.deepEqual(buildEventOperator(gate), {
    operatorId: "op-1",
    accountName: "张 三",
    bossAccountName: "张三",
    bossAccountMatched: true
  });
});

test("operator identity is attached to collected events", () => {
  const gate = evaluateCollectionGate({
    operatorId: "op-2",
    accountName: "王五"
  }, {
    accountName: "王五"
  });
  const event = attachOperatorToEvent({
    id: "evt_1",
    type: "candidate_detail.opened"
  }, gate);

  assert.deepEqual(event.operator, {
    operatorId: "op-2",
    accountName: "王五",
    bossAccountName: "王五",
    bossAccountMatched: true
  });
});
