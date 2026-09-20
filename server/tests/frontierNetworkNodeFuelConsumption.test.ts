"use strict";

/** Run with scripts/Tests/run-isolated-tests.js against a disposable game store. */
const assert = require("node:assert/strict");
const test = require("node:test");

const itemStore = require("../src/services/inventory/itemStore");
const deployment = require("../src/services/frontier/deploymentRuntime");
const fuelRuntime = require("../src/services/frontier/networkNodeFuelRuntime");

const OWNER_ID = 140000003;
const SOLAR_SYSTEM_ID = 30000004;
const NODE_TYPE_ID = 88092;
const FUEL_UNSTABLE = 77818;
const FUEL_D2 = 88319;
const FUEL_D1 = 88335;
const CARGO_FLAG = 5;
const START_MS = 1700000000000;
const HOUR_MS = 3600000;
const D1_UNIT_MS = 300000;
const VALID_SIGNATURE = Buffer.alloc(66, 7).toString("base64");
const OWNER_SESSION = { characterID: OWNER_ID, solarsystemid2: SOLAR_SYSTEM_ID };

function grantOne(locationID, flagID, itemType, quantity, options?: any) {
  const result = itemStore.grantItemsToCharacterLocation(
    OWNER_ID, locationID, flagID, [{ itemType, quantity, options }],
  );
  assert.equal(result.success, true, result.errorMsg);
  return result.data.items[0];
}

function createNode({
  typeID = FUEL_D1,
  quantity = 100,
  assemblyStatus = deployment.ASSEMBLY_STATUS_ONLINE,
  burnUpdatedAtMs = START_MS,
  burnRemainderMs = 0,
} = {}) {
  const node = grantOne(SOLAR_SYSTEM_ID, 0, NODE_TYPE_ID, 1, {
    individualItems: true, singleton: 1,
  });
  const updated = itemStore.updateInventoryItem(node.itemID, (item) => ({
    ...item,
    customInfo: JSON.stringify({
      evejsFrontierConstruction: {
        assemblyStatus,
        assemblyTypeID: NODE_TYPE_ID,
        completedAtMs: 1,
        createdAtMs: 1,
        ownerID: OWNER_ID,
        solarSystemID: SOLAR_SYSTEM_ID,
      },
      [fuelRuntime.FUEL_INFO_KEY]: {
        typeID, quantity, updatedAtMs: START_MS, burnUpdatedAtMs, burnRemainderMs,
      },
    }),
  }));
  assert.equal(updated.success, true, updated.errorMsg);
  return updated.data;
}

function readFuel(node) {
  return fuelRuntime.readNetworkNodeFuelState(itemStore.findItemById(node.itemID));
}

function settle(node, nowMs) {
  const result = fuelRuntime.settleNetworkNodeFuel(node.itemID, nowMs);
  assert.equal(result.success, true, result.errorMsg);
  return result;
}

function clock(t, initialMs = START_MS) {
  let nowMs = initialMs;
  t.mock.method(Date, "now", () => nowMs);
  return (nextMs) => { nowMs = nextMs; };
}

function setStatus(node, assemblyStatus) {
  const updated = itemStore.updateInventoryItem(node.itemID, (item) => ({
    ...item,
    customInfo: deployment._testing.writeConstructionState(item, {
      ...deployment.readConstructionState(item), assemblyStatus,
    }),
  }));
  assert.equal(updated.success, true, updated.errorMsg);
}

function createContainer() {
  return grantOne(SOLAR_SYSTEM_ID, 0, 95276, 1, {
    individualItems: true, singleton: 1,
  });
}

function prepareWithdraw(node, container, quantity) {
  return fuelRuntime.prepareNetworkNodeFuelWithdraw({
    characterID: OWNER_ID,
    networkNodeID: node.itemID,
    fuelTypeID: FUEL_D1,
    quantity,
    destinationItemID: container.itemID,
    destinationFlagID: CARGO_FLAG,
  });
}

function prepareDeposit(node, container, stack, quantity) {
  return fuelRuntime.prepareNetworkNodeFuelDeposit({
    characterID: OWNER_ID,
    networkNodeID: node.itemID,
    sourceItemID: container.itemID,
    sourceFlagID: CARGO_FLAG,
    items: [{ itemID: stack.itemID, quantity }],
  });
}

function execute(prepared, action) {
  assert.equal(prepared.success, true, prepared.errorMsg);
  return fuelRuntime.executeNetworkNodeFuelTransaction({
    action,
    characterID: OWNER_ID,
    transactionUUID: prepared.data.transactionUUID,
    signature: VALID_SIGNATURE,
  });
}

function containerFuel(container) {
  return itemStore.listContainerItems(OWNER_ID, container.itemID, CARGO_FLAG)
    .filter((item) => Number(item.typeID) === FUEL_D1)
    .reduce((total, item) => total + Number(item.stacksize ?? item.quantity), 0);
}

test.beforeEach(() => {
  fuelRuntime._testing.clearPendingFuelTransactions();
  deployment._testing.clearPendingAssemblyTransitions();
});

for (const [typeID, unitsPerHour] of [
  [FUEL_UNSTABLE, 15], [FUEL_D2, 8], [FUEL_D1, 12],
]) {
  test(`online network node consumes ${unitsPerHour} units/hour for fuel ${typeID}`, () => {
    const node = createNode({ typeID });
    const result = settle(node, START_MS + HOUR_MS);
    assert.equal(result.consumedQuantity, unitsPerHour);
    assert.equal(readFuel(node).quantity, 100 - unitsPerHour);
    assert.equal(readFuel(node).burnRemainderMs, 0);
    assert.equal(readFuel(node).burnUpdatedAtMs, START_MS + HOUR_MS);
    assert.equal(deployment.readConstructionState(result.data).assemblyStatus,
      deployment.ASSEMBLY_STATUS_ONLINE);
  });
}

test("frequent settlement preserves partial intervals and never charges a tick twice", () => {
  const node = createNode();
  assert.equal(settle(node, START_MS + 100000).consumedQuantity, 0);
  assert.equal(settle(node, START_MS + D1_UNIT_MS - 1).consumedQuantity, 0);
  assert.equal(readFuel(node).quantity, 100);
  assert.equal(settle(node, START_MS + D1_UNIT_MS).consumedQuantity, 1);
  assert.equal(readFuel(node).quantity, 99);
  assert.equal(readFuel(node).burnRemainderMs, 0);
  assert.equal(settle(node, START_MS + D1_UNIT_MS).consumedQuantity, 0);
  assert.equal(readFuel(node).quantity, 99);
});

test("a reloaded runtime catches up from persisted online time and remainder", () => {
  const node = createNode({
    burnUpdatedAtMs: START_MS + 150000,
    burnRemainderMs: 150000,
  });
  const modulePath = require.resolve("../src/services/frontier/networkNodeFuelRuntime");
  const cachedModule = require.cache[modulePath];
  try {
    delete require.cache[modulePath];
    const reloadedRuntime = require(modulePath);
    const result = reloadedRuntime.settleNetworkNodeFuel(node.itemID, START_MS + HOUR_MS);
    assert.equal(result.success, true, result.errorMsg);
    assert.equal(result.consumedQuantity, 12);
    assert.equal(readFuel(node).quantity, 88);
    assert.equal(readFuel(node).burnRemainderMs, 0);
  } finally {
    require.cache[modulePath] = cachedModule;
  }
});

test("legacy fuel receives an accounting anchor without historical charges", () => {
  const node = createNode();
  const legacy = itemStore.updateInventoryItem(node.itemID, (item) => {
    const info = JSON.parse(item.customInfo);
    delete info[fuelRuntime.FUEL_INFO_KEY].burnUpdatedAtMs;
    delete info[fuelRuntime.FUEL_INFO_KEY].burnRemainderMs;
    return { ...item, customInfo: JSON.stringify(info) };
  });
  assert.equal(legacy.success, true, legacy.errorMsg);
  const nowMs = START_MS + 100 * HOUR_MS;
  assert.equal(settle(node, nowMs).consumedQuantity, 0);
  assert.equal(readFuel(node).quantity, 100);
  assert.equal(readFuel(node).burnUpdatedAtMs, nowMs);
  assert.equal(settle(node, nowMs + HOUR_MS).consumedQuantity, 12);
  assert.equal(readFuel(node).quantity, 88);
});

test("offline time is excluded while online/offline cycles retain accrued fractions", (t) => {
  const setTime = clock(t);
  const node = createNode();
  setTime(START_MS + 150000);
  setStatus(node, deployment.ASSEMBLY_STATUS_OFFLINE);
  assert.equal(readFuel(node).quantity, 100);
  assert.equal(readFuel(node).burnRemainderMs, 150000);

  const resumeMs = START_MS + 10 * HOUR_MS;
  assert.equal(settle(node, resumeMs).consumedQuantity, 0);
  assert.equal(readFuel(node).quantity, 100);
  setTime(resumeMs);
  setStatus(node, deployment.ASSEMBLY_STATUS_ONLINE);
  assert.equal(settle(node, resumeMs + 149999).consumedQuantity, 0);
  assert.equal(settle(node, resumeMs + 150000).consumedQuantity, 1);
  assert.equal(readFuel(node).quantity, 99);
});

test("going offline settles complete online intervals even without an intervening tick", (t) => {
  const setTime = clock(t);
  const node = createNode();
  setTime(START_MS + HOUR_MS + 150000);
  setStatus(node, deployment.ASSEMBLY_STATUS_OFFLINE);
  assert.equal(readFuel(node).quantity, 88);
  assert.equal(readFuel(node).burnRemainderMs, 150000);
  assert.equal(settle(node, START_MS + 24 * HOUR_MS).consumedQuantity, 0);
  assert.equal(readFuel(node).quantity, 88);
});

test("backward clock movement cannot double-count time when the clock catches up", () => {
  const node = createNode();
  assert.equal(settle(node, START_MS + D1_UNIT_MS + 150000).consumedQuantity, 1);
  assert.equal(settle(node, START_MS + D1_UNIT_MS + 50000).consumedQuantity, 0);
  assert.equal(settle(node, START_MS + 2 * D1_UNIT_MS - 1).consumedQuantity, 0);
  assert.equal(settle(node, START_MS + 2 * D1_UNIT_MS).consumedQuantity, 1);
  assert.equal(readFuel(node).quantity, 98);
});

test("exhaustion consumes only available fuel and takes the network node offline", () => {
  const node = createNode({ quantity: 2 });
  const result = settle(node, START_MS + 24 * HOUR_MS);
  assert.equal(result.consumedQuantity, 2);
  assert.equal(readFuel(node).quantity, 0);
  assert.equal(deployment.readConstructionState(itemStore.findItemById(node.itemID))
    .assemblyStatus, deployment.ASSEMBLY_STATUS_OFFLINE);
  assert.equal(settle(node, START_MS + 48 * HOUR_MS).consumedQuantity, 0);
  assert.equal(readFuel(node).quantity, 0);
});

test("an online node without fuel is taken offline by settlement", () => {
  const node = createNode({ quantity: 0 });
  assert.equal(settle(node, START_MS).consumedQuantity, 0);
  assert.equal(deployment.readConstructionState(itemStore.findItemById(node.itemID))
    .assemblyStatus, deployment.ASSEMBLY_STATUS_OFFLINE);
});

test("preparing an online transition rejects an empty network node", (t) => {
  clock(t);
  const node = createNode({ quantity: 0, assemblyStatus: deployment.ASSEMBLY_STATUS_OFFLINE });
  const prepared = deployment.beginAssemblyStateTransition(
    OWNER_SESSION, node.itemID, deployment.ASSEMBLY_STATUS_ONLINE,
  );
  assert.equal(prepared.success, false);
  assert.equal(prepared.errorMsg, "NETWORK_NODE_FUEL_REQUIRED");
  assert.equal(deployment.readConstructionState(itemStore.findItemById(node.itemID))
    .assemblyStatus, deployment.ASSEMBLY_STATUS_OFFLINE);
});

test("committing an online transition rejects fuel withdrawn after preparation", (t) => {
  clock(t);
  const node = createNode({ quantity: 1, assemblyStatus: deployment.ASSEMBLY_STATUS_OFFLINE });
  const container = createContainer();
  const prepared = deployment.beginAssemblyStateTransition(
    OWNER_SESSION, node.itemID, deployment.ASSEMBLY_STATUS_ONLINE,
  );
  assert.equal(prepared.success, true, prepared.errorMsg);
  const withdrawn = execute(prepareWithdraw(node, container, 1), "networknode-fuel-withdraw");
  assert.equal(withdrawn.success, true, withdrawn.errorMsg);
  const committed = deployment.commitAssemblyStateTransition(
    OWNER_SESSION, node.itemID, prepared.data.transactionUUID,
    VALID_SIGNATURE, deployment.ASSEMBLY_STATUS_ONLINE,
  );
  assert.equal(committed.success, false);
  assert.equal(committed.errorMsg, "NETWORK_NODE_FUEL_REQUIRED");
  assert.equal(deployment.readConstructionState(itemStore.findItemById(node.itemID))
    .assemblyStatus, deployment.ASSEMBLY_STATUS_OFFLINE);
});

test("committing an online transition revalidates consumption due since preparation", (t) => {
  const setTime = clock(t, START_MS + D1_UNIT_MS - 1000);
  const node = createNode({ quantity: 1 });
  const prepared = deployment.beginAssemblyStateTransition(
    OWNER_SESSION, node.itemID, deployment.ASSEMBLY_STATUS_ONLINE,
  );
  assert.equal(prepared.success, true, prepared.errorMsg);
  setTime(START_MS + D1_UNIT_MS);
  const committed = deployment.commitAssemblyStateTransition(
    OWNER_SESSION, node.itemID, prepared.data.transactionUUID,
    VALID_SIGNATURE, deployment.ASSEMBLY_STATUS_ONLINE,
  );
  assert.equal(committed.success, false);
  assert.equal(committed.errorMsg, "NETWORK_NODE_FUEL_REQUIRED");
  assert.equal(settle(node, START_MS + D1_UNIT_MS).consumedQuantity, 1);
  assert.equal(readFuel(node).quantity, 0);
});

test("the periodic settlement scan burns online nodes and leaves offline fuel intact", () => {
  const onlineNode = createNode();
  const offlineNode = createNode({ assemblyStatus: deployment.ASSEMBLY_STATUS_OFFLINE });
  fuelRuntime.settleAllNetworkNodeFuel(START_MS + HOUR_MS);
  assert.equal(readFuel(onlineNode).quantity, 88);
  assert.equal(readFuel(offlineNode).quantity, 100);
});

test("a deposit settles pending burn and preserves the partial unit already accrued", (t) => {
  const setTime = clock(t);
  const node = createNode();
  const container = createContainer();
  const stack = grantOne(container.itemID, CARGO_FLAG, FUEL_D1, 20);
  setTime(START_MS + D1_UNIT_MS + 150000);
  const prepared = fuelRuntime.prepareNetworkNodeFuelDeposit({
    characterID: OWNER_ID,
    networkNodeID: node.itemID,
    sourceItemID: container.itemID,
    sourceFlagID: CARGO_FLAG,
    items: [{ itemID: stack.itemID, quantity: 10 }],
  });
  const result = execute(prepared, "networknode-fuel-deposit");
  assert.equal(result.success, true, result.errorMsg);
  assert.equal(result.data.quantity, 109);
  assert.equal(readFuel(node).burnRemainderMs, 150000);
  assert.equal(containerFuel(container), 10);
  assert.equal(settle(node, START_MS + 2 * D1_UNIT_MS).consumedQuantity, 1);
  assert.equal(readFuel(node).quantity, 108);
});

test("a withdrawal settles pending burn and preserves the partial unit already accrued", (t) => {
  const setTime = clock(t);
  const node = createNode();
  const container = createContainer();
  setTime(START_MS + D1_UNIT_MS + 150000);
  const result = execute(prepareWithdraw(node, container, 10), "networknode-fuel-withdraw");
  assert.equal(result.success, true, result.errorMsg);
  assert.equal(result.data.quantity, 89);
  assert.equal(readFuel(node).burnRemainderMs, 150000);
  assert.equal(containerFuel(container), 10);
  assert.equal(settle(node, START_MS + 2 * D1_UNIT_MS).consumedQuantity, 1);
  assert.equal(readFuel(node).quantity, 88);
});

test("withdraw execute revalidates fuel burned since prepare", (t) => {
  const setTime = clock(t, START_MS + D1_UNIT_MS - 1000);
  const node = createNode({ quantity: 2 });
  const container = createContainer();
  const prepared = prepareWithdraw(node, container, 2);
  assert.equal(prepared.success, true, prepared.errorMsg);
  setTime(START_MS + D1_UNIT_MS);
  const result = execute(prepared, "networknode-fuel-withdraw");
  assert.equal(result.success, false);
  assert.equal(result.errorMsg, "INSUFFICIENT_STORED_FUEL");
  assert.equal(readFuel(node).quantity, 1);
  assert.equal(containerFuel(container), 0);
});

test("failed withdrawal restores accounted fuel and remainder without undoing consumption", (t) => {
  const setTime = clock(t, START_MS + D1_UNIT_MS - 1000);
  const node = createNode();
  const container = createContainer();
  const prepared = prepareWithdraw(node, container, 10);
  assert.equal(prepared.success, true, prepared.errorMsg);
  setTime(START_MS + D1_UNIT_MS + 1000);
  const grantMock = t.mock.method(itemStore, "grantStackableItemsToCharacterLocationAndUpdateItem", () => ({
    success: false, errorMsg: "WRITE_ERROR",
  }));
  const result = execute(prepared, "networknode-fuel-withdraw");
  grantMock.mock.restore();
  assert.equal(result.success, false);
  assert.equal(readFuel(node).quantity, 99);
  assert.equal(readFuel(node).burnRemainderMs, 1000);
  assert.equal(containerFuel(container), 0);
  assert.equal(settle(node, START_MS + 2 * D1_UNIT_MS).consumedQuantity, 1);
  assert.equal(readFuel(node).quantity, 98);
});

test("fully withdrawing and redepositing fuel preserves accrued consumption and excludes empty time", (t) => {
  const setTime = clock(t);
  const node = createNode({ quantity: 10 });
  const container = createContainer();
  setTime(START_MS + 150000);
  const withdrawn = execute(prepareWithdraw(node, container, 10), "networknode-fuel-withdraw");
  assert.equal(withdrawn.success, true, withdrawn.errorMsg);
  assert.equal(readFuel(node).quantity, 0);
  assert.equal(readFuel(node).typeID, 0, "an empty reserve has no visible fuel type");

  const resumeMs = START_MS + 10 * HOUR_MS;
  setTime(resumeMs);
  const stack = itemStore.listContainerItems(OWNER_ID, container.itemID, CARGO_FLAG)
    .find((item) => Number(item.typeID) === FUEL_D1);
  assert.ok(stack);
  const deposited = execute(prepareDeposit(node, container, stack, 10), "networknode-fuel-deposit");
  assert.equal(deposited.success, true, deposited.errorMsg);
  assert.equal(readFuel(node).quantity, 10, "time without stored fuel is not charged");
  setStatus(node, deployment.ASSEMBLY_STATUS_ONLINE);
  assert.equal(settle(node, resumeMs + 149999).consumedQuantity, 0);
  assert.equal(settle(node, resumeMs + 150000).consumedQuantity, 1);
  assert.equal(readFuel(node).quantity, 9);
});

test("switching fuel after a full withdrawal carries the accrued fraction into the new interval", (t) => {
  const setTime = clock(t);
  const node = createNode({ quantity: 10 });
  const container = createContainer();
  const d2Stack = grantOne(container.itemID, CARGO_FLAG, FUEL_D2, 10);
  const switchMs = START_MS + 150000;
  setTime(switchMs);
  const withdrawn = execute(prepareWithdraw(node, container, 10), "networknode-fuel-withdraw");
  assert.equal(withdrawn.success, true, withdrawn.errorMsg);
  const deposited = execute(prepareDeposit(node, container, d2Stack, 10), "networknode-fuel-deposit");
  assert.equal(deposited.success, true, deposited.errorMsg);
  setStatus(node, deployment.ASSEMBLY_STATUS_ONLINE);
  assert.equal(readFuel(node).typeID, FUEL_D2);
  // Half of a 300s D1 interval remains half of a 450s D2 interval.
  assert.equal(settle(node, switchMs + 225000 - 1).consumedQuantity, 0);
  assert.equal(settle(node, switchMs + 225000).consumedQuantity, 1);
  assert.equal(readFuel(node).quantity, 9);
});

test("fuel settlement publishes the remaining quantity once per consuming tick", (t) => {
  const notices: any[] = [];
  fuelRuntime.registerFuelNoticePublisher((notice) => notices.push(notice));
  t.after(() => fuelRuntime.registerFuelNoticePublisher(null));
  const node = createNode();
  assert.equal(settle(node, START_MS + D1_UNIT_MS - 1).consumedQuantity, 0);
  assert.equal(notices.length, 0);
  settle(node, START_MS + HOUR_MS);
  assert.equal(notices.length, 1);
  assert.equal(notices[0].characterID, OWNER_ID);
  assert.equal(notices[0].networkNodeID, node.itemID);
  assert.equal(notices[0].solarSystemID, SOLAR_SYSTEM_ID);
  assert.equal(notices[0].fuelTypeID, FUEL_D1);
  assert.equal(notices[0].quantity, 88);
  settle(node, START_MS + HOUR_MS);
  assert.equal(notices.length, 1, "a repeated tick must not republish the deduction");
  settle(node, START_MS + HOUR_MS + D1_UNIT_MS);
  assert.equal(notices.length, 2);
  assert.equal(notices[1].quantity, 87);
});

test("a system offline transition publishes fuel consumed before the transition once", (t) => {
  const setTime = clock(t);
  const notices: any[] = [];
  fuelRuntime.registerFuelNoticePublisher((notice) => notices.push(notice));
  t.after(() => fuelRuntime.registerFuelNoticePublisher(null));
  const node = createNode();
  setTime(START_MS + D1_UNIT_MS);
  const result = deployment.offlineAssemblyForFuelDepletion(node.itemID);
  assert.equal(result.success, true, result.errorMsg);
  assert.equal(readFuel(node).quantity, 99);
  assert.equal(deployment.readConstructionState(itemStore.findItemById(node.itemID))
    .assemblyStatus, deployment.ASSEMBLY_STATUS_OFFLINE);
  assert.equal(notices.length, 1);
  assert.equal(notices[0].networkNodeID, node.itemID);
  assert.equal(notices[0].quantity, 99);
  deployment.offlineAssemblyForFuelDepletion(node.itemID);
  settle(node, START_MS + HOUR_MS);
  assert.equal(notices.length, 1, "the same transition and later offline tick do not repeat the notice");
});

function createSponsoredStorage(node) {
  const positionedNode = itemStore.updateInventoryItem(node.itemID, item => ({
    ...item, spaceState: { ...item.spaceState, position: { x: 0, y: 0, z: 0 } },
  }));
  assert.equal(positionedNode.success, true, positionedNode.errorMsg);
  const storage = grantOne(SOLAR_SYSTEM_ID, 0, 77917, 1, { individualItems: true, singleton: 1 });
  const updated = itemStore.updateInventoryItem(storage.itemID, (item) => ({
    ...item,
    spaceState: { ...item.spaceState, position: { x: 100, y: 0, z: 0 } },
    customInfo: JSON.stringify({
      evejsFrontierConstruction: {
        assemblyStatus: deployment.ASSEMBLY_STATUS_ONLINE,
        assemblyTypeID: item.typeID, completedAtMs: 1, createdAtMs: 1,
        ownerID: OWNER_ID, solarSystemID: SOLAR_SYSTEM_ID,
      },
      evejsFrontierEnergy: { networkNodeID: node.itemID, autoConnect: false },
    }),
  }));
  assert.equal(updated.success, true, updated.errorMsg);
  return updated.data;
}

function sponsoredConfirmation(items, targetStatus = deployment.ASSEMBLY_STATUS_OFFLINE) {
  return {
    transactionUUID: require("node:crypto").randomUUID(),
    affected: items.map(item => ({
      assemblyID: Number(item.itemID), ownerID: Number(item.ownerID), typeID: Number(item.typeID), targetStatus,
    })),
  };
}

test("confirmed sponsored node offline accounts accrued fuel and cascades to the confirmed connected storage", (t) => {
  const setTime = clock(t);
  const node = createNode();
  const storage = createSponsoredStorage(node);
  const confirmation = sponsoredConfirmation([node, storage]);
  const offlineAt = START_MS + HOUR_MS + 150000;
  setTime(offlineAt);
  deployment.reconcileSponsoredAssemblyState(confirmation);

  assert.equal(readFuel(node).quantity, 88);
  assert.equal(readFuel(node).burnRemainderMs, 150000);
  assert.equal(readFuel(node).burnUpdatedAtMs, offlineAt);
  for (const item of [node, storage]) {
    const saved = itemStore.findItemById(item.itemID);
    assert.equal(deployment.readConstructionState(saved).assemblyStatus, deployment.ASSEMBLY_STATUS_OFFLINE);
    assert.equal(JSON.parse(saved.customInfo).evejsSponsoredAssemblyTransaction, confirmation.transactionUUID);
  }
  assert.deepEqual(JSON.parse(itemStore.findItemById(storage.itemID).customInfo).evejsFrontierEnergy,
    { networkNodeID: node.itemID, autoConnect: false }, "the confirmed state change retains the connection");
  assert.equal(settle(node, START_MS + 10 * HOUR_MS).consumedQuantity, 0);
  assert.equal(readFuel(node).quantity, 88, "offline time does not consume additional fuel");
  const resumeAt = START_MS + 10 * HOUR_MS;
  setTime(resumeAt);
  setStatus(node, deployment.ASSEMBLY_STATUS_ONLINE);
  assert.equal(settle(node, resumeAt + 149999).consumedQuantity, 0);
  assert.equal(settle(node, resumeAt + 150000).consumedQuantity, 1, "the saved partial interval survives the sponsored transition");
});

test("sponsored confirmation UUID persisted in the game store makes runtime reload and retry idempotent", (t) => {
  const setTime = clock(t);
  const node = createNode();
  const confirmation = sponsoredConfirmation([node]);
  setTime(START_MS + D1_UNIT_MS + 150000);
  deployment.reconcileSponsoredAssemblyState(confirmation);
  const afterCommit = itemStore.findItemById(node.itemID).customInfo;
  assert.equal(JSON.parse(afterCommit).evejsSponsoredAssemblyTransaction, confirmation.transactionUUID);
  const modulePath = require.resolve("../src/services/frontier/deploymentRuntime");
  const cachedModule = require.cache[modulePath];
  const update = itemStore.updateInventoryItem;
  const updates: number[] = [];
  const updateMock = t.mock.method(itemStore, "updateInventoryItem", (...args) => {
    updates.push(Number(args[0]));
    return update(...args);
  });
  try {
    delete require.cache[modulePath];
    const reloaded = require(modulePath);
    setTime(START_MS + 2 * HOUR_MS);
    reloaded.reconcileSponsoredAssemblyState(confirmation);
    reloaded.reconcileSponsoredAssemblyState(confirmation);
    assert.equal(itemStore.findItemById(node.itemID).customInfo, afterCommit);
    assert.deepEqual(updates, [], "retry recognizes the saved UUID without another item update");
    assert.equal(readFuel(node).quantity, 99);
    assert.equal(readFuel(node).burnRemainderMs, 150000);
  } finally {
    updateMock.mock.restore();
    require.cache[modulePath] = cachedModule;
  }
});

test("partially saved sponsored cascade resumes without overriding a later local transition on a saved item", (t) => {
  const setTime = clock(t);
  const node = createNode();
  const storage = createSponsoredStorage(node);
  const confirmation = sponsoredConfirmation([node, storage]);
  setTime(START_MS + D1_UNIT_MS + 150000);
  const update = itemStore.updateInventoryItem;
  const failure = t.mock.method(itemStore, "updateInventoryItem", (...args) => {
    if (Number(args[0]) === storage.itemID) return { success: false, errorMsg: "WRITE_ERROR" };
    return update(...args);
  });
  assert.throws(() => deployment.reconcileSponsoredAssemblyState(confirmation), /Cannot save confirmed assembly/);
  failure.mock.restore();
  assert.equal(deployment.readConstructionState(itemStore.findItemById(node.itemID)).assemblyStatus, deployment.ASSEMBLY_STATUS_OFFLINE);
  assert.equal(JSON.parse(itemStore.findItemById(node.itemID).customInfo).evejsSponsoredAssemblyTransaction, confirmation.transactionUUID);
  assert.equal(deployment.readConstructionState(itemStore.findItemById(storage.itemID)).assemblyStatus, deployment.ASSEMBLY_STATUS_ONLINE);
  assert.equal(JSON.parse(itemStore.findItemById(storage.itemID).customInfo).evejsSponsoredAssemblyTransaction, undefined);

  setTime(START_MS + 2 * HOUR_MS);
  setStatus(node, deployment.ASSEMBLY_STATUS_ONLINE);
  const laterNodeState = itemStore.findItemById(node.itemID).customInfo;
  deployment.reconcileSponsoredAssemblyState(confirmation);
  assert.equal(itemStore.findItemById(node.itemID).customInfo, laterNodeState,
    "recovery preserves an unrelated later local transition on the already-saved node");
  assert.equal(deployment.readConstructionState(itemStore.findItemById(node.itemID)).assemblyStatus, deployment.ASSEMBLY_STATUS_ONLINE);
  assert.equal(deployment.readConstructionState(itemStore.findItemById(storage.itemID)).assemblyStatus, deployment.ASSEMBLY_STATUS_OFFLINE);
  assert.equal(JSON.parse(itemStore.findItemById(storage.itemID).customInfo).evejsSponsoredAssemblyTransaction, confirmation.transactionUUID);
  assert.equal(readFuel(node).quantity, 99, "recovery does not settle or charge the saved node again");
});

test("sponsored reconciliation rejects changed local assembly identity before saving state", (t) => {
  clock(t);
  for (const patch of [{ ownerID: OWNER_ID + 1 }, { typeID: 77917 }, { customInfo: "{}" }]) {
    const node = createNode();
    const confirmation = sponsoredConfirmation([node]);
    const changed = itemStore.updateInventoryItem(node.itemID, item => ({ ...item, ...patch }));
    assert.equal(changed.success, true, changed.errorMsg);
    const before = itemStore.findItemById(node.itemID);
    assert.throws(() => deployment.reconcileSponsoredAssemblyState(confirmation), /no longer matches its local identity/);
    assert.deepEqual(itemStore.findItemById(node.itemID), before);
    assert.equal(JSON.parse(before.customInfo).evejsSponsoredAssemblyTransaction, undefined);
  }
});

test("sponsored reconciliation rejects missing assemblies and a changed identity even on a previously saved UUID", (t) => {
  clock(t);
  const node = createNode();
  const confirmation = sponsoredConfirmation([node]);
  deployment.reconcileSponsoredAssemblyState(confirmation);
  const changed = itemStore.updateInventoryItem(node.itemID, item => ({ ...item, ownerID: OWNER_ID + 1 }));
  assert.equal(changed.success, true, changed.errorMsg);
  assert.throws(() => deployment.reconcileSponsoredAssemblyState(confirmation), /no longer matches its local identity/);
  const missing = sponsoredConfirmation([node]);
  missing.affected[0].assemblyID = Number.MAX_SAFE_INTEGER;
  assert.equal(itemStore.findItemById(missing.affected[0].assemblyID), null);
  assert.throws(() => deployment.reconcileSponsoredAssemblyState(missing), /no longer matches its local identity/);
});
