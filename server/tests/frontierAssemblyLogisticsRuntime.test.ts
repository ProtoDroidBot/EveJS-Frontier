"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { createAssemblyLogisticsRuntime, _testing } = require("../src/services/frontier/assemblyLogisticsRuntime");
const { createSmartAssemblyRequestRuntime } = require("../src/services/frontier/smartAssemblyRequestRuntime");
const { createAssemblyLogisticsWorker } = require("../src/services/frontier/assemblyLogisticsWorker");

const REQUEST_ID = "11111111-1111-4111-8111-111111111111";
const OWNER = 140000003, SYSTEM = 30000142, SUPPLIER = 5100000100, REQUESTER = 5100000200;
const TYPE = 77818;
function request(overrides = {}) {
  return { requestID: REQUEST_ID, requestType: "logistics.transfer", ownerID: OWNER,
    sourceAssemblyID: REQUESTER, targetAssemblyID: SUPPLIER,
    logistics: { version: 1, actor: { kind: "player", actorID: OWNER } },
    payload: { typeID: TYPE, quantity: 5 }, ...overrides };
}

function fixture() {
  const records = new Map<any, any>([SUPPLIER, REQUESTER].map((id, i) => [id, {
    itemID: id, ownerID: OWNER, assemblyTypeID: 900, assemblyStatus: 2,
    activationCompleteAtMs: 0, solarSystemID: SYSTEM, createOnChain: false,
    position: { x: i * 100, y: 0, z: 0 },
  }]));
  const items = new Map<any, any>([SUPPLIER, REQUESTER].map(id => [id, {
    itemID: id, ownerID: OWNER, typeID: 900, locationID: SYSTEM, capacity: 100,
  }]));
  const receipts = new Map();
  const accessCalls = [];
  let commits = 0, allowed = true, notified = 0;
  const deps: any = {
    itemStore: {
      findItemById: id => items.get(id), getItemMetadata: () => ({ capacity: 100 }),
      findAssemblyLogisticsReceipt: id => receipts.get(id) || null,
      transferAssemblyItemType: operation => {
        commits++;
        const result = { ...operation, context: operation.receiptContext, changes: [] };
        receipts.set(operation.operationID, { operationFingerprint: operation.operationFingerprint, result });
        return { success: true, data: result };
      },
    },
    deployment: { getAssemblyRecord: id => records.get(id) },
    access: { resolveAccess: (actor, id, capabilities) => {
      accessCalls.push({ actor, id, capabilities });
      return { success: allowed, errorMsg: allowed ? undefined : "ASSEMBLY_ACCESS_DENIED" };
    } },
    storage: { getStorageComponent: type => type === 900 ? { storageCapacity: 100 } : null },
    field: { getFieldStorageComponent: type => type === 901 ? { accessRange: 2000, allowUserAdd: true, allowUserTake: true } : null },
    turret: { getTurretComponent: type => type === 902 ? {} : null },
    blueprints: {
      isIndustryFacilityType: type => type === 903,
      getSelectedBlueprint: () => ({ inputs: { [TYPE]: { max_storable_quantity: 25 } }, outputs: { [TYPE]: { max_storable_quantity: 50 } } }),
    },
    industry: { industryInputFlagForLane: lane => 20000 + (lane - 1) * 2,
      industryOutputFlagForLane: lane => 20001 + (lane - 1) * 2 },
    chain: { runWithAssemblyLogisticsAuthority: (_plan, commit) => commit(),
      syncAssemblyLogisticsTransfer: async () => ({ status: "disabled" }) },
    now: () => 1_000_000, notify: () => { notified++; },
  };
  return { deps, records, items, receipts, accessCalls,
    runtime: createAssemblyLogisticsRuntime({ dependencies: deps }),
    commits: () => commits, notified: () => notified, deny: () => { allowed = false; } };
}
const claim = { assertClaim: () => ({ success: true }) };

test("trusted enqueue strips session hints and persists the authenticated actor through the queue", async t => {
  const f = fixture();
  const modules = {
    itemStore: "../src/services/inventory/itemStore", deployment: "../src/services/frontier/deploymentRuntime",
    access: "../src/services/frontier/assemblyAccessRuntime", storage: "../src/services/frontier/smartStorageUnitRuntime",
    turret: "../src/services/frontier/smartTurretInventoryRuntime", field: "../src/services/frontier/fieldStorageInventoryRuntime",
    blueprints: "../src/services/frontier/industryBlueprints", industry: "../src/services/frontier/industryRuntime",
  };
  for (const [key, path] of Object.entries(modules)) {
    const module = require(path);
    for (const [name, fn] of Object.entries(f.deps[key])) t.mock.method(module, name, fn);
  }
  let state = {};
  const queue = createSmartAssemblyRequestRuntime({
    repository: { ensureTable() {}, read: () => ({ success: true, data: structuredClone(state) }),
      write: (_table, _path, next) => { state = structuredClone(next); return { success: true }; } },
    findAssembly: id => ({ item: f.items.get(id), state: f.records.get(id) }),
  });
  t.mock.method(require("../src/services/frontier/smartAssemblyRequestRuntime"), "createRequest", queue.createRequest);
  const result = await require("../src/services/frontier/assemblyLogisticsRuntime").requestAssemblyItems(
    REQUESTER, SUPPLIER, TYPE, 5, { requestID: REQUEST_ID,
      actor: { kind: "player", actorID: OWNER, tribeID: 123 }, ownerID: OWNER + 1, allowCrossOwner: true },
  );
  assert.equal(result.success, true, result.errorMsg);
  assert.deepEqual(result.data.logistics.actor, { kind: "player", actorID: OWNER });
  assert.equal(result.data.ownerID, OWNER);
  assert.deepEqual(f.accessCalls.map(call => call.actor), [
    { kind: "player", actorID: OWNER }, { kind: "player", actorID: OWNER },
  ]);
});

test("notifications keep split-stack change dictionaries separate and publish SSU deltas", t => {
  t.mock.method(require("../src/services/inventory/itemStore"), "getInventoryItemUnitVolume", () => 2);
  const ownerSession = { characterID: OWNER }, unrelated = { characterID: OWNER + 1 };
  t.mock.method(require("../src/services/chat/sessionRegistry"), "getSessions", () => [ownerSession, unrelated]);
  const emitted = [], notices = [];
  t.mock.method(require("../src/services/character/characterState"), "emitItemsChangedForSession",
    (...args) => emitted.push(args));
  t.mock.method(require("../src/_secondary/express/publicGatewayLocal"), "publishGatewayNotice",
    (...args) => notices.push(args));
  const { getStorageUnitProtoTypes } = require("../src/_secondary/express/gatewayServices/assemblyStorageUnitProto");
  const before = { itemID: 100, typeID: TYPE, stacksize: 10, volume: 2 };
  const remainder = { ...before, stacksize: 5 };
  const moved = { ...before, itemID: 101, stacksize: 5 };
  const createdPrevious = { locationID: 0 };
  _testing.publishChanges({ destinationOwnerID: OWNER, sourceOwnerID: OWNER,
    sourceLocationID: SUPPLIER, destinationLocationID: REQUESTER, typeID: TYPE,
    context: { sourceKind: "storage_unit", destinationKind: "storage_unit" },
    moves: [{ sourceItemID: 100, movedItemID: 101, quantity: 5 }],
    changes: [{ item: remainder, previousData: before }, { item: moved, previousData: createdPrevious }],
  });
  assert.deepEqual(emitted, [[ownerSession, remainder, before], [ownerSession, moved, createdPrevious]]);
  assert.equal(notices.length, 2);
  for (const [index, name] of ["InventoryItemWithdrawnNotice", "InventoryItemDepositedNotice"].entries()) {
    assert.equal(notices[index][0], `eve_public.assembly.storageunit.api.${name}`);
    const payload = getStorageUnitProtoTypes()[name].decode(notices[index][1]);
    assert.equal(Number(payload.item.identifier.sequential), index === 0 ? 100 : 101);
    assert.equal(Number(payload.item.attributes.quantity), 5);
    assert.equal(Number(payload.item.attributes.volume), 10);
  }
});

test("autonomous transfer uses supplier-to-requester owner inventory and checks both capabilities", async () => {
  const f = fixture();
  const result = await f.runtime.execute(request(), claim);
  assert.equal(result.success, true, result.errorMsg);
  assert.equal(result.data.supplierAssemblyID, SUPPLIER);
  assert.equal(result.data.requesterAssemblyID, REQUESTER);
  assert.equal(f.commits(), 1);
  assert.equal(f.notified(), 1);
  assert.deepEqual(f.accessCalls.slice(0, 2).map(c => [c.id, c.capabilities]), [
    [SUPPLIER, ["inventory.withdraw"]], [REQUESTER, ["operate", "inventory.deposit"]],
  ]);
  const moved = f.receipts.get(REQUEST_ID).result;
  assert.equal(moved.sourceFlagID, 66);
  assert.equal(moved.destinationFlagID, 66);
  assert.equal(moved.sourceOwnerID, OWNER);
  f.records.get(SUPPLIER).assemblyStatus = 1;
  f.deny();
  assert.deepEqual(await f.runtime.execute(request(), claim), result, "receipt replay needs no new authority or movement");
  assert.equal(f.commits(), 1);
});

test("legacy requests, identity overrides, invalid quantities and forged receipt retries fail closed", async () => {
  for (const changed of [
    { logistics: undefined }, { payload: { typeID: TYPE, quantity: 5, sourceOwnerID: OWNER } },
    { payload: { typeID: TYPE, quantity: "5" } }, { payload: { typeID: TYPE, quantity: 0 } },
    { payload: { typeID: TYPE, quantity: 1.5 } }, { payload: { typeID: TYPE, quantity: 2 ** 32 } },
    { logistics: { version: 1, actor: { kind: "assembly", actorID: OWNER } } },
  ]) {
    const f = fixture();
    assert.equal((await f.runtime.execute(request(changed), claim)).success, false);
    assert.equal(f.commits(), 0);
  }
  const f = fixture();
  await f.runtime.execute(request(), claim);
  assert.equal((await f.runtime.execute(request({ payload: { typeID: TYPE, quantity: 6 } }), claim)).errorMsg,
    "LOGISTICS_IDEMPOTENCY_CONFLICT");
});

test("owner, same-system, position, assembly distance and online checks are authoritative", async () => {
  for (const [change, code] of [
    [f => { f.records.get(SUPPLIER).ownerID++; }, "LOGISTICS_OWNER_MISMATCH"],
    [f => { f.records.get(SUPPLIER).solarSystemID++; }, "ASSEMBLY_NOT_IN_CURRENT_SYSTEM"],
    [f => { f.items.get(SUPPLIER).locationID++; }, "ASSEMBLY_NOT_IN_CURRENT_SYSTEM"],
    [f => { f.records.get(SUPPLIER).position = null; }, "LOGISTICS_POSITION_UNAVAILABLE"],
    [f => { f.records.get(SUPPLIER).position.x = 6000; }, "ASSEMBLY_OUT_OF_RANGE"],
    [f => { f.records.get(SUPPLIER).assemblyStatus = 1; }, "ASSEMBLY_OFFLINE"],
    [f => { f.records.get(REQUESTER).activationCompleteAtMs = 2_000_000; }, "ASSEMBLY_ACTIVATING"],
    [f => { f.deny(); }, "ASSEMBLY_ACCESS_DENIED"],
  ] as any) {
    const f = fixture(); change(f);
    assert.equal((await f.runtime.execute(request(), claim)).errorMsg, code);
    assert.equal(f.commits(), 0);
  }
});

test("permissions, lease and online state are rechecked after the asynchronous chain refresh", async () => {
  for (const revoke of ["permission", "lease", "online"]) {
    const f = fixture();
    let valid = true;
    f.deps.chain.runWithAssemblyLogisticsAuthority = async (_plan, commit) => {
      await Promise.resolve();
      if (revoke === "permission") f.deny();
      if (revoke === "lease") valid = false;
      if (revoke === "online") f.records.get(REQUESTER).assemblyStatus = 1;
      return commit();
    };
    const result = await f.runtime.execute(request(), { assertClaim: () => ({ success: valid }) });
    assert.equal(result.success, false);
    assert.equal(f.commits(), 0);
  }
  const f = fixture();
  assert.equal((await f.runtime.execute(request())).errorMsg, "LOGISTICS_CLAIM_REQUIRED");
});

test("chain synchronization failure retries receipt reconciliation without moving again", async () => {
  const f = fixture();
  f.deps.chain.syncAssemblyLogisticsTransfer = async () => ({ status: "pending" });
  const pending = await f.runtime.execute(request(), claim);
  assert.equal(pending.success, false);
  assert.equal(pending.gameCommitted, true);
  assert.equal(pending.retryable, true);
  assert.equal(f.commits(), 1);
  f.deps.chain.syncAssemblyLogisticsTransfer = async () => ({ status: "synced" });
  assert.equal((await f.runtime.execute(request(), claim)).success, true);
  assert.equal(f.commits(), 1);
});

test("Industry supplies output lanes and accepts only blueprint input slots; generic grants do not bypass lane access", async () => {
  const f = fixture();
  for (const id of [SUPPLIER, REQUESTER]) {
    f.items.get(id).typeID = 903; f.records.get(id).assemblyTypeID = 903;
  }
  const command = request({ payload: { typeID: TYPE, quantity: 5, supplierLaneID: 2, requesterLaneID: 3 } });
  assert.equal((await f.runtime.execute(command, claim)).success, true);
  const operation = f.receipts.get(REQUEST_ID).result;
  assert.equal(operation.sourceFlagID, 20003);
  assert.equal(operation.destinationFlagID, 20004);
  assert.equal(operation.maxTypeQuantity, 25);
  assert.equal(operation.destinationCapacity, undefined);
  const other = request({ requestID: "22222222-2222-4222-8222-222222222222",
    logistics: { version: 1, actor: { kind: "player", actorID: OWNER + 1 } } });
  assert.equal((await f.runtime.execute(other, claim)).errorMsg, "JOB_LANE_ACCESS_DENIED");
  f.deps.blueprints.getSelectedBlueprint = () => ({ inputs: {}, outputs: {} });
  assert.equal(f.runtime.authorizeRequest(command).errorMsg, "INVALID_INPUT_TYPE");
});

test("Field Storage honors component range/add/take permissions; unsupported bays cannot be addressed", async () => {
  const f = fixture();
  f.items.get(SUPPLIER).typeID = 901; f.records.get(SUPPLIER).assemblyTypeID = 901;
  f.records.get(SUPPLIER).position.x = 2500;
  assert.equal((await f.runtime.execute(request(), claim)).errorMsg, "ASSEMBLY_OUT_OF_RANGE");
  f.records.get(SUPPLIER).position.x = 0;
  f.deps.field.getFieldStorageComponent = () => ({ accessRange: 2000, allowUserAdd: true, allowUserTake: false });
  assert.equal((await f.runtime.execute(request(), claim)).errorMsg, "ASSEMBLY_ACCESS_DENIED");
  f.deps.field.getFieldStorageComponent = () => null;
  assert.equal((await f.runtime.execute(request(), claim)).errorMsg, "LOGISTICS_INVENTORY_UNSUPPORTED");
});

test("real item-store commit survives queue completion failure and restart with offline assemblies", async t => {
  const itemStore = require("../src/services/inventory/itemStore");
  const previous = itemStore.getAllItems();
  t.after(() => itemStore._writeItemsForTest(previous, { force: true }));
  const f = fixture();
  const rows = Object.fromEntries([...f.items].map(([id, item]) => [id, {
    ...item, flagID: 0, singleton: 1, stacksize: 1, quantity: 1, customInfo: "", categoryID: 65,
  }]));
  rows[5100000300] = { itemID: 5100000300, typeID: TYPE, ownerID: OWNER,
    locationID: SUPPLIER, flagID: 66, singleton: 0, stacksize: 12, quantity: 12, volume: 1 };
  assert.equal(itemStore._writeItemsForTest(rows, { force: true }), true);
  f.deps.itemStore = itemStore;
  let state = {}, rejectCompletion = true;
  const repository = {
    ensureTable: () => true,
    read: () => ({ success: true, data: structuredClone(state) }),
    write: (_table, _path, next) => {
      if (rejectCompletion && Object.values<any>(next.requests || {}).some(r => r.status === "fulfilled")) return { success: false };
      state = structuredClone(next); return { success: true };
    },
  };
  const createRequests = () => createSmartAssemblyRequestRuntime({ repository, now: f.deps.now,
    findAssembly: id => ({ item: itemStore.findItemById(id), state: f.records.get(id) }) });
  const requests = createRequests();
  assert.equal(requests.createRequest(REQUESTER, SUPPLIER, "logistics.transfer", {
    ownerID: OWNER, requestID: REQUEST_ID, payload: { typeID: TYPE, quantity: 5 },
    _logisticsActor: { kind: "player", actorID: OWNER },
  }).success, true);
  const worker = createAssemblyLogisticsWorker({ requests,
    executor: createAssemblyLogisticsRuntime({ dependencies: f.deps }), now: f.deps.now, onError: () => {} });
  await worker.runOnce();
  assert.equal(itemStore.findItemById(5100000300).stacksize, 7);
  assert.equal(requests.getRequest(REQUEST_ID).data.status, "claimed");
  assert.ok(itemStore.findAssemblyLogisticsReceipt(REQUEST_ID));
  rejectCompletion = false;
  f.records.get(SUPPLIER).assemblyStatus = 1;
  f.records.get(REQUESTER).assemblyStatus = 1;
  f.deny();
  const recoveredRequests = createRequests();
  const recovered = createAssemblyLogisticsWorker({ requests: recoveredRequests,
    executor: createAssemblyLogisticsRuntime({ dependencies: f.deps }), now: f.deps.now });
  await recovered.runOnce();
  assert.equal(recoveredRequests.getRequest(REQUEST_ID).data.status, "fulfilled");
  assert.equal(itemStore.findItemById(5100000300).stacksize, 7, "restart never repeats the committed move");
  assert.equal(itemStore.listContainerItems(OWNER, REQUESTER, 66).reduce((sum, item) => sum + item.stacksize, 0), 5);
});
