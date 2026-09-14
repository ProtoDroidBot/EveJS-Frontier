import assert = require("node:assert/strict");
import { test } from "node:test";
import {
  readSuiAssemblyStatusIntent,
  recordSuiAssemblyStatusIntent,
  registerSuiAssemblyStateRunner,
  runWithSuiAssemblyState,
} from "../src/services/frontier/suiAssemblyState";
import { buildSuiAssemblyIdentitySnapshot } from "../src/services/frontier/suiAssemblySync";
import { buildSuiAssemblySnapshot, type SuiAssemblySnapshotInput } from "../src/services/frontier/suiAssemblySnapshot";

test("assembly state access remains synchronous when chain synchronization is disabled", () => {
  const result = { inventory: [] };
  let calls = 0;
  assert.strictEqual(runWithSuiAssemblyState(10002, () => { calls++; return result; }), result);
  assert.equal(calls, 1);
  const failure = new Error("local validation failed");
  assert.throws(() => runWithSuiAssemblyState(10002, () => { throw failure; }), (error) => error === failure);
});

test("assembly operations wait for registered chain state access before validating local state", async (t) => {
  let release!: () => void;
  const refreshed = new Promise<void>((resolve) => { release = resolve; });
  let requestedID: number | null = null;
  let calls = 0;
  const unregister = registerSuiAssemblyStateRunner(async (assemblyID, operation) => {
    requestedID = assemblyID;
    await refreshed;
    return operation();
  });
  t.after(unregister);
  const result = { online: true };
  const pending = runWithSuiAssemblyState(10002, () => { calls++; return result; });
  assert.ok(pending instanceof Promise);
  assert.equal(requestedID, 10002);
  assert.equal(calls, 0, "Inventory validation must wait for the authoritative state refresh");
  release();
  assert.strictEqual(await pending, result);
  assert.equal(calls, 1);
});

test("failed chain state access propagates the error without running the operation", async (t) => {
  const failure = new Error("chain RPC unavailable");
  const unregister = registerSuiAssemblyStateRunner(async () => { throw failure; });
  t.after(unregister);
  let calls = 0;
  await assert.rejects(async () => runWithSuiAssemblyState(10002, () => { calls++; }), (error) => error === failure);
  assert.equal(calls, 0, "A failed refresh must not fall back to stale local state");
});

test("registered assembly state access preserves operation failures", async (t) => {
  const unregister = registerSuiAssemblyStateRunner(async (_assemblyID, operation) => operation());
  t.after(unregister);
  const failure = new Error("storage access denied");
  await assert.rejects(async () => runWithSuiAssemblyState(10002, () => { throw failure; }), (error) => error === failure);
});

for (const transition of ["unregistered", "replaced"]) {
  test(`an assembly operation fails closed when its pending state worker is ${transition}`, async (t) => {
    let release!: () => void;
    const refreshed = new Promise<void>((resolve) => { release = resolve; });
    const unregister = registerSuiAssemblyStateRunner(async (_assemblyID, operation) => {
      await refreshed;
      return operation();
    });
    t.after(unregister);
    let operations = 0;
    const pending = runWithSuiAssemblyState(10002, () => { operations++; });
    const rejected = assert.rejects(async () => pending, { code: "ASSEMBLY_STATE_UNAVAILABLE" });
    if (transition === "unregistered") unregister();
    else t.after(registerSuiAssemblyStateRunner(async (_assemblyID, operation) => operation()));
    release();
    await rejected;
    assert.equal(operations, 0, "A refresh from an obsolete worker must not authorize inventory mutation");
  });
}

test("invalid assembly identities cannot invoke a registered runner or an inventory operation", async (t) => {
  let refreshes = 0;
  let operations = 0;
  const unregister = registerSuiAssemblyStateRunner(async (_assemblyID, operation) => {
    refreshes++;
    return operation();
  });
  t.after(unregister);
  for (const assemblyID of [0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, "10002", null, undefined]) {
    await assert.rejects(async () => runWithSuiAssemblyState(assemblyID as number, () => { operations++; }),
      { code: "ASSEMBLY_STATE_UNAVAILABLE" });
  }
  assert.equal(refreshes, 0);
  assert.equal(operations, 0);
});

test("unregistering an old worker preserves its replacement and stopping the current worker restores sync access", async (t) => {
  const unregisterFirst = registerSuiAssemblyStateRunner(async () => assert.fail("The old worker must not run"));
  t.after(unregisterFirst);
  let refreshes = 0;
  const unregisterCurrent = registerSuiAssemblyStateRunner(async (_assemblyID, operation) => {
    refreshes++;
    return operation();
  });
  t.after(unregisterCurrent);
  unregisterFirst();
  assert.equal(await runWithSuiAssemblyState(10002, () => "current"), "current");
  assert.equal(refreshes, 1);
  unregisterCurrent();
  assert.equal(runWithSuiAssemblyState(10002, () => "local"), "local");
  assert.equal(refreshes, 1);
});

test("explicit status requests retain a unique intent through persisted custom info", (t) => {
  const unregister = registerSuiAssemblyStateRunner(async (_assemblyID, operation) => operation());
  t.after(unregister);
  const info: any = { construction: { assemblyStatus: 1 }, unrelated: "preserved" };
  recordSuiAssemblyStatusIntent(info, 2);
  const first = readSuiAssemblyStatusIntent({ customInfo: JSON.stringify(info) });
  assert.ok(first);
  assert.equal(first.targetStatus, 2);
  assert.match(first.id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  assert.deepEqual(readSuiAssemblyStatusIntent({ customInfo: info }), first);

  recordSuiAssemblyStatusIntent(info, 2);
  const repeated = readSuiAssemblyStatusIntent({ customInfo: JSON.stringify(info) });
  assert.ok(repeated);
  assert.notEqual(repeated.id, first.id, "Repeated requests for the same status need separate operation identities");
  assert.equal(repeated.targetStatus, 2);

  recordSuiAssemblyStatusIntent(info, 1);
  const offline = readSuiAssemblyStatusIntent({ customInfo: JSON.stringify(info) });
  assert.ok(offline);
  assert.notEqual(offline.id, repeated.id);
  assert.equal(offline.targetStatus, 1);
  assert.deepEqual(info.construction, { assemblyStatus: 1 });
  assert.equal(info.unrelated, "preserved");
  assert.deepEqual(readSuiAssemblyStatusIntent({ customInfo: info }), offline, "Reading an intent must not consume it");
});

test("status intent recording leaves custom info untouched while chain synchronization is disabled", () => {
  const info: Record<string, any> = { unrelated: "preserved" };
  recordSuiAssemblyStatusIntent(info, 2);
  assert.deepEqual({ ...info }, { unrelated: "preserved" });
  const previous = { id: "previous-request", targetStatus: 1 };
  (info as any).evejsSuiAssemblyStatusIntent = previous;
  recordSuiAssemblyStatusIntent(info, 2);
  assert.strictEqual((info as any).evejsSuiAssemblyStatusIntent, previous);
});

test("status intent recording ignores states other than explicit online and offline requests", (t) => {
  const unregister = registerSuiAssemblyStateRunner(async (_assemblyID, operation) => operation());
  t.after(unregister);
  for (const status of [0, 3, -1, NaN]) {
    const info = { unrelated: "preserved" };
    recordSuiAssemblyStatusIntent(info, status);
    assert.deepEqual(info, { unrelated: "preserved" });
  }
});

test("status intent reads reject missing, malformed, and unsupported persisted requests", () => {
  for (const customInfo of [undefined, null, "", "broken JSON", "null", "[]", "{}", {},
    { evejsSuiAssemblyStatusIntent: null },
    { evejsSuiAssemblyStatusIntent: { targetStatus: 2 } },
    { evejsSuiAssemblyStatusIntent: { id: 10002, targetStatus: 2 } },
    { evejsSuiAssemblyStatusIntent: { id: "request", targetStatus: "2" } },
    { evejsSuiAssemblyStatusIntent: { id: "request", targetStatus: 0 } },
    { evejsSuiAssemblyStatusIntent: { id: "request", targetStatus: 3 } },
  ]) {
    assert.equal(readSuiAssemblyStatusIntent({ customInfo }), null);
  }
  assert.equal(readSuiAssemblyStatusIntent(null), null);
});

function mismatchedStatusInput(): SuiAssemblySnapshotInput {
  const item = (itemID: number, typeID: number, x: number, status: number, quantity = 0) => ({
    itemID, typeID, ownerID: 9001, locationID: 30000123, itemName: `Assembly ${itemID}`,
    spaceState: { position: { x, y: 0, z: 0 } },
    customInfo: JSON.stringify({
      evejsFrontierConstruction: { assemblyTypeID: typeID, assemblyStatus: status, ownerID: 9001, solarSystemID: 30000123 },
      ...(quantity ? { evejsFrontierNetworkNodeFuel: { typeID: 88335, quantity } } : {}),
    }),
  });
  return {
    items: [item(1, 88092, 0, 1), item(2, 88092, 100, 2, 100), item(3, 90184, 1, 2), item(4, 90184, 99, 2)],
    characters: [{ characterID: 9001, accountId: 1, characterName: "Pilot" }],
    components: [
      { typeID: 88092, smartDeployable: { createOnChain: 1 }, smartAnchor: { fuelMaxCapacity: 1000, fuelBurnRateInSeconds: 3000 } },
      { typeID: 90184, smartDeployable: { createOnChain: 1 } },
    ],
    itemTypes: [{ typeID: 88335, volume: 0.28 }],
  };
}

test("identity snapshots retain completed assemblies whose cached online status disagrees with their node", () => {
  const input = mismatchedStatusInput();
  const original = structuredClone(input);
  const localSnapshot = buildSuiAssemblySnapshot(input);
  assert.ok(localSnapshot.errors.some(error => error.itemId === "3" && error.code === "OFFLINE_NETWORK_NODE"));
  assert.equal(localSnapshot.assemblies.some(assembly => assembly.itemId === "3"), false);

  const identities = buildSuiAssemblyIdentitySnapshot(input);
  assert.deepEqual(identities.errors, []);
  assert.deepEqual(identities.assemblies.map(({ itemId, status, networkNodeId }) => ({ itemId, status, networkNodeId })), [
    { itemId: "1", status: 1, networkNodeId: null },
    { itemId: "2", status: 1, networkNodeId: null },
    { itemId: "3", status: 1, networkNodeId: "1" },
    { itemId: "4", status: 1, networkNodeId: "2" },
  ]);
  assert.deepEqual(input, original, "Provisional offline identities must not overwrite observed or requested local state");
});

test("identity snapshots preserve persisted bindings when custom info is already parsed", () => {
  const input = mismatchedStatusInput();
  input.items = Object.fromEntries(Object.values(input.items).map(item => [String(item.itemID), {
    ...item, customInfo: JSON.parse(item.customInfo),
  }]));
  input.networkNodeBindings = { "3": "2", "4": "1" };
  const original = structuredClone(input);
  const identities = buildSuiAssemblyIdentitySnapshot(input);
  assert.deepEqual(identities.errors, []);
  assert.equal(identities.assemblies.find(assembly => assembly.itemId === "3")?.networkNodeId, "2");
  assert.equal(identities.assemblies.find(assembly => assembly.itemId === "4")?.networkNodeId, "1");
  assert.ok(identities.assemblies.every(assembly => assembly.status === 1));
  assert.deepEqual(input, original);
});
