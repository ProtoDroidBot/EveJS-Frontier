import assert = require("node:assert/strict");
import { test } from "node:test";
import {
  readSuiAssemblyStatusIntent,
  recordSuiAssemblyStatusIntent,
  registerSuiAssemblyStateRunner,
  runWithSuiAssemblyState,
} from "../src/services/frontier/suiAssemblyState";
import { buildSuiAssemblyIdentitySnapshot, refreshSuiAssemblyChainStates } from "../src/services/frontier/suiAssemblySync";
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

function chainRefreshFixture() {
  const input = mismatchedStatusInput();
  const objects = new Map<string, any>(["1", "2", "3", "4"].map(itemId => [itemId, { itemId, online: true }]));
  const intents = new Map<string, { id: string; targetStatus: 1 | 2 }>();
  const fuel = { typeID: 88335, quantity: 73, unitVolume: "280000", observedAtMs: 1234 };
  const energy = { maxEnergy: 1000, currentEnergyProduction: 1000, energyUsed: 725, observedAtMs: 1234 };
  const reads: string[] = [];
  const cleared: string[] = [];
  const fuelReads: any[] = [];
  const energyReads: any[] = [];
  const projectedFuel: any[] = [];
  const projectedEnergy: any[] = [];
  const projectedStatus: any[] = [];
  const context = {
    async assertCurrent() {},
    getStatusIntent: assembly => intents.get(assembly.itemId) ?? null,
    clearEnergy: assembly => { cleared.push(assembly.itemId); },
    chain: {
      async readAssembly(assembly) { reads.push(assembly.itemId); return objects.get(assembly.itemId) ?? null; },
      async readFuelState(assembly, state) { fuelReads.push({ assembly, state }); return fuel; },
      async readEnergyState(assembly, state) { energyReads.push({ assembly, state }); return energy; },
    },
    projectFuel: (assembly, state) => { projectedFuel.push({ itemId: assembly.itemId, state }); },
    projectEnergy: (assembly, state) => { projectedEnergy.push({ itemId: assembly.itemId, state }); },
    projectStatus: (assembly, status, intentID) => { projectedStatus.push({ itemId: assembly.itemId, status, intentID }); return true; },
  };
  return { input, objects, intents, fuel, energy, reads, cleared, fuelReads, energyReads,
    projectedFuel, projectedEnergy, projectedStatus, context };
}

test("chain refresh imports energy and fuel from the same verified node object", async () => {
  const f = chainRefreshFixture();
  await refreshSuiAssemblyChainStates(f.context, () => f.input, 1);
  assert.deepEqual(f.reads, ["1"], "Refreshing one node must not depend on child transitions or other grids");
  assert.deepEqual(f.cleared, ["1"]);
  assert.equal(f.fuelReads.length, 1);
  assert.equal(f.energyReads.length, 1);
  assert.strictEqual(f.fuelReads[0].state, f.objects.get("1"));
  assert.strictEqual(f.energyReads[0].state, f.fuelReads[0].state);
  assert.strictEqual(f.energyReads[0].assembly, f.fuelReads[0].assembly);
  assert.deepEqual(f.projectedFuel, [{ itemId: "1", state: f.fuel }]);
  assert.deepEqual(f.projectedEnergy, [{ itemId: "1", state: f.energy }]);
  assert.deepEqual(f.projectedStatus, [
    { itemId: "1", status: 2, intentID: null },
  ]);
});

test("background fuel settlement imports the new confirmed reserve before native status publication", async () => {
  const f = chainRefreshFixture();
  f.fuel.quantity = 499;
  let settlements = 0;
  const confirmed = { itemId: "1", online: true };
  const context = { ...f.context, fuelAuthority: true, chain: { ...f.context.chain,
    async updateFuel(assembly, assertCurrent) {
      assert.equal(assembly.itemId, "1");
      assertCurrent();
      settlements++;
      f.fuel.quantity = 498;
      f.objects.set("1", confirmed);
      return true;
    },
  } };
  await refreshSuiAssemblyChainStates(context, () => f.input, 1, { settleFuel: true });
  assert.equal(settlements, 1);
  assert.deepEqual(f.reads, ["1", "1"]);
  assert.strictEqual(f.fuelReads[0].state, confirmed, "Do not reuse the node read before update_fuel committed");
  assert.strictEqual(f.energyReads[0].state, confirmed);
  assert.equal(f.projectedFuel[0].state.quantity, 498);
  assert.equal(f.projectedStatus[0].status, 2);
});

test("ordinary chain reads and legacy local fuel mode never submit fuel settlement", async () => {
  for (const fuelAuthority of [false, true]) {
    const f = chainRefreshFixture();
    const context = { ...f.context, fuelAuthority, chain: { ...f.context.chain,
      async updateFuel() { assert.fail("This read must not mutate fuel"); },
    } };
    await refreshSuiAssemblyChainStates(context, () => f.input, 1);
    if (!fuelAuthority) await refreshSuiAssemblyChainStates(context, () => f.input, 1, { settleFuel: true });
  }
});

test("a committed native fuel transfer reaches the chain before another burn can consume its reserve", async () => {
  const f = chainRefreshFixture();
  const node = Object.values(f.input.items).find(item => item.itemID === 1);
  const info = JSON.parse(node.customInfo);
  info.evejsSuiNetworkNodeFuel = {
    typeID: 88335, quantity: 499, unitVolume: "280000", observedAtMs: 1234,
    pending: { id: "withdraw-all", typeID: 88335, quantityDelta: -499 },
  };
  node.customInfo = JSON.stringify(info);
  const context = { ...f.context, fuelAuthority: true, chain: { ...f.context.chain,
    async updateFuel() { assert.fail("Do not consume fuel already reserved by a native withdrawal"); },
  } };
  const identity = buildSuiAssemblyIdentitySnapshot(f.input).assemblies.find(assembly => assembly.itemId === "1");
  assert.equal(identity.fuelIntent?.id, "withdraw-all");
  await refreshSuiAssemblyChainStates(context, () => f.input, 1, { settleFuel: true });
  assert.equal(f.projectedFuel.length, 1, "Fresh observations still reach the pending transfer reconciliation");
});

test("fuel exhaustion publishes confirmed offline state for the node and its connected assembly", async () => {
  const f = chainRefreshFixture();
  const updates: string[] = [];
  const context = { ...f.context, fuelAuthority: true, chain: { ...f.context.chain,
    async updateFuel(assembly, assertCurrent) {
      assertCurrent();
      updates.push(assembly.itemId);
      if (assembly.itemId !== "1") return false;
      f.fuel.quantity = 0;
      f.objects.set("1", { itemId: "1", online: false });
      f.objects.set("3", { itemId: "3", online: false });
      return true;
    },
  } };
  await refreshSuiAssemblyChainStates(context, () => f.input, undefined, { settleFuel: true });
  assert.deepEqual(updates, ["1", "2"], "Only network nodes settle fuel");
  assert.equal(f.projectedFuel[0].state.quantity, 0);
  assert.deepEqual(f.projectedStatus.map(({ itemId, status }) => ({ itemId, status })), [
    { itemId: "1", status: 1 }, { itemId: "2", status: 2 },
    { itemId: "3", status: 1 }, { itemId: "4", status: 2 },
  ]);
});

test("uncertain fuel settlement never publishes a guessed reserve", async () => {
  const f = chainRefreshFixture();
  const failure = new Error("Burn transaction response was lost; pending recovery");
  const context = { ...f.context, fuelAuthority: true, chain: { ...f.context.chain,
    async updateFuel() { throw failure; },
  } };
  await assert.rejects(refreshSuiAssemblyChainStates(context, () => f.input, 1, { settleFuel: true }), error => error === failure);
  assert.deepEqual(f.projectedFuel, []);
  assert.deepEqual(f.projectedEnergy, []);
  assert.deepEqual(f.projectedStatus, []);
});

test("fuel settlement rejects a changed local identity or lifecycle request before submission", async () => {
  for (const change of ["identity", "intent"]) {
    const f = chainRefreshFixture();
    const context = { ...f.context, fuelAuthority: true, chain: { ...f.context.chain,
      async updateFuel(_assembly, assertCurrent) {
        if (change === "identity") Object.values(f.input.items).find(item => item.itemID === 1).spaceState.position.x = 10;
        else f.intents.set("1", { id: "new-offline-request", targetStatus: 1 });
        assertCurrent();
        assert.fail("A changed snapshot must not submit a burn transaction");
      },
    } };
    await assert.rejects(refreshSuiAssemblyChainStates(context, () => f.input, 1, { settleFuel: true }), /changed during/);
    assert.deepEqual(f.projectedFuel, []);
  }
});

test("requested node refresh tolerates unanchored children while a requested child must exist", async () => {
  const f = chainRefreshFixture();
  f.objects.delete("3");
  await refreshSuiAssemblyChainStates(f.context, () => f.input, 1);
  assert.deepEqual(f.reads, ["1"]);
  assert.deepEqual(f.projectedStatus.map(entry => entry.itemId), ["1"]);
  assert.equal(f.projectedEnergy.length, 1);
  await assert.rejects(refreshSuiAssemblyChainStates(f.context, () => f.input, 3), /not anchored on the current chain/);

  const missingNode = chainRefreshFixture();
  missingNode.objects.delete("1");
  await assert.rejects(refreshSuiAssemblyChainStates(missingNode.context, () => missingNode.input, 1), /not anchored on the current chain/);
  assert.deepEqual(missingNode.cleared, ["1"]);
  assert.deepEqual(missingNode.projectedEnergy, []);
});

test("pending child transitions do not block fresh node counters or fuel access", async () => {
  const f = chainRefreshFixture();
  f.intents.set("3", { id: "pending-child-offline", targetStatus: 1 });
  await refreshSuiAssemblyChainStates(f.context, () => f.input, 1);
  assert.deepEqual(f.reads, ["1"]);
  assert.deepEqual(f.projectedEnergy, [{ itemId: "1", state: f.energy }]);
  assert.equal(f.projectedFuel.length, 1);
  await assert.rejects(refreshSuiAssemblyChainStates(f.context, () => f.input, 3), { code: "ASSEMBLY_STATE_PENDING" });
});

test("unavailable or malformed chain energy leaves the old observation cleared and projects no partial node state", async () => {
  for (const message of ["Chain energy source is missing", "Chain reserved energy is not a valid u64"]) {
    const f = chainRefreshFixture();
    const failure = new Error(message);
    f.context.chain.readEnergyState = async () => { throw failure; };
    await assert.rejects(refreshSuiAssemblyChainStates(f.context, () => f.input, 1), error => error === failure);
    assert.deepEqual(f.cleared, ["1"]);
    assert.deepEqual(f.projectedFuel, [], "Fuel must not be projected before the complete node read succeeds");
    assert.deepEqual(f.projectedEnergy, []);
    assert.deepEqual(f.projectedStatus, []);
  }
});

test("chain energy is not projected when the local node identity changes during its read", async () => {
  const f = chainRefreshFixture();
  f.context.chain.readEnergyState = async () => {
    const node = Object.values(f.input.items).find(item => item.itemID === 1);
    node.spaceState.position.x = 10;
    return f.energy;
  };
  await assert.rejects(refreshSuiAssemblyChainStates(f.context, () => f.input, 1), /changed during chain state verification/);
  assert.deepEqual(f.cleared, ["1"]);
  assert.deepEqual(f.projectedFuel, []);
  assert.deepEqual(f.projectedEnergy, []);
  assert.deepEqual(f.projectedStatus, []);
});

test("pending local status keeps confirmed chain counters while requested refresh reports pending", async () => {
  const f = chainRefreshFixture();
  const intent = { id: "pending-offline", targetStatus: 1 as const };
  f.intents.set("1", intent);
  await assert.rejects(refreshSuiAssemblyChainStates(f.context, () => f.input, 1), { code: "ASSEMBLY_STATE_PENDING" });
  assert.deepEqual(f.projectedEnergy, [{ itemId: "1", state: f.energy }]);
  assert.equal(f.projectedEnergy[0].state.energyUsed, 725);
  assert.equal(f.projectedEnergy[0].state.currentEnergyProduction, 1000);
  assert.deepEqual(f.projectedStatus, [], "The pending offline request must not be acknowledged as an online observation");
  assert.strictEqual(f.intents.get("1"), intent);

  const scan = chainRefreshFixture();
  scan.intents.set("1", intent);
  await refreshSuiAssemblyChainStates(scan.context, () => scan.input);
  assert.deepEqual(scan.projectedEnergy.map(entry => entry.itemId), ["1", "2"]);
  assert.deepEqual(scan.projectedStatus.map(entry => entry.itemId), ["2", "3", "4"]);
  assert.strictEqual(scan.intents.get("1"), intent, "A background scan must preserve an unconfirmed lifecycle request");
});
