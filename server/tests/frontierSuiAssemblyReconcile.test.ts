import assert = require("node:assert/strict");
import { test } from "node:test";
import { reconcileSuiAssemblies } from "../src/services/frontier/suiAssemblySync";
import type { AssemblySnapshot } from "../src/services/frontier/suiAssemblySnapshot";

function node(overrides: Partial<AssemblySnapshot> = {}): AssemblySnapshot {
  return {
    itemId: "10001", typeId: 88092, ownerId: 9001, name: "Network",
    kind: "network_node", status: 1, solarSystemId: 30000123,
    position: { x: 1, y: 2, z: 3 }, networkNodeId: null, destinationGateId: null,
    gateDistanceMeters: null, gateMaxDistanceMeters: null,
    fuel: { typeId: 88335, quantity: 50, unitVolume: "280000" },
    fuelCapacity: "5000000000", burnRateMs: "1000", maxEnergy: "1000", storageCapacity: "0", inventory: [],
    ...overrides,
  };
}
function storage(overrides: Partial<AssemblySnapshot> = {}): AssemblySnapshot {
  return node({ itemId: "10002", typeId: 84955, kind: "storage_unit", name: "Storage",
    networkNodeId: "10001", storageCapacity: "1000000000", ...overrides });
}
function snapshot(assemblies: AssemblySnapshot[], errors: any[] = []) {
  return { assemblies, characters: [], errors };
}
function fixture(options: {
  tracked?: AssemblySnapshot[];
  inventoryChanges?: boolean;
  chainFuelQuantity?: number;
  hook?: (event: string, state: { pending: boolean }) => void;
} = {}) {
  const events: string[] = [];
  const control = { pending: false };
  const statuses = new Map<string, number>();
  const calls = new Map<string, any[]>();
  const record = (event: string, argument?: any) => {
    events.push(event);
    calls.set(event, [...(calls.get(event) ?? []), argument]);
    options.hook?.(event, control);
  };
  const context: any = {
    state: { assemblies: Object.fromEntries((options.tracked ?? []).map(a => [a.itemId, a])) },
    fuelEfficiencies: new Map([[88335, 10]]),
    assertCurrent: async () => record("assertCurrent"),
    getCharacter: async (id: number) => record(`character:${id}`),
    save: () => record("save"),
    executor: {
      recover: async () => record("recover"), hasPending: () => control.pending,
    },
    chain: {
      readAssembly: async (a: AssemblySnapshot) => {
        record(`read:${a.itemId}`, a);
        return { fields: { fuel: { fields: {
          quantity: String(options.chainFuelQuantity ?? a.fuel.quantity),
          type_id: { vec: [String(a.fuel.typeId)] }, unit_volume: { vec: [a.fuel.unitVolume] },
        } } } };
      },
      ensureAssembly: async (a: AssemblySnapshot) => record(`ensure:${a.itemId}`, a),
      configureFuelEfficiency: async (type: number, efficiency: number) => record(`efficiency:${type}:${efficiency}`),
      syncFuel: async (a: AssemblySnapshot) => record(`fuel:${a.itemId}:${a.fuel.quantity}`, a),
      syncStatus: async (a: AssemblySnapshot) => {
        record(`status:${a.itemId}:${a.status}`, a);
        statuses.set(a.itemId, a.status);
      },
      removeAssembly: async (a: AssemblySnapshot) => record(`remove:${a.itemId}`, a),
    },
    contents: {
      syncGateLinks: async (assemblies: AssemblySnapshot[]) => record("links", assemblies),
      hasInventoryChanges: async (a: AssemblySnapshot) => {
        record(`inventoryCheck:${a.itemId}`, a);
        return options.inventoryChanges ?? false;
      },
      syncInventory: async (a: AssemblySnapshot) => record(`inventory:${a.itemId}`, a),
    },
  };
  return { context, events, control, statuses, calls };
}

test("reconciliation recovers first, anchors dependencies and funds nodes before online status", async () => {
  const n = node({ status: 2 });
  const gate = storage({ kind: "gate", status: 2, storageCapacity: "0" });
  const f = fixture();
  await reconcileSuiAssemblies(snapshot([n, gate]), f.context, new Set([n.itemId, gate.itemId]));
  const order = (a: string, b: string) => assert.ok(f.events.indexOf(a) < f.events.indexOf(b), `${a} must precede ${b}`);
  order("assertCurrent", "recover");
  order("recover", `ensure:${n.itemId}`);
  order(`ensure:${n.itemId}`, `ensure:${gate.itemId}`);
  order("efficiency:88335:10", `fuel:${n.itemId}:50`);
  order(`fuel:${n.itemId}:50`, `status:${n.itemId}:2`);
  order(`status:${n.itemId}:2`, `status:${gate.itemId}:2`);
  assert.deepEqual(f.context.state.errors, []);
});

test("offline storage and its node return offline after a confirmed inventory failure", async () => {
  const n = node();
  const s = storage();
  const f = fixture({ inventoryChanges: true, hook(event) {
    if (event === `inventory:${s.itemId}`) throw new Error("confirmed inventory failure");
  } });
  await assert.rejects(reconcileSuiAssemblies(snapshot([n, s]), f.context, new Set([n.itemId, s.itemId])), /confirmed inventory failure/);
  assert.equal(f.statuses.get(s.itemId), 1);
  assert.equal(f.statuses.get(n.itemId), 1);
  const inventoryIndex = f.events.indexOf(`inventory:${s.itemId}`);
  assert.ok(f.events.indexOf(`status:${s.itemId}:1`) > inventoryIndex);
  assert.ok(f.events.indexOf(`status:${n.itemId}:1`) > inventoryIndex);
  assert.equal(f.events.filter(e => e === `fuel:${n.itemId}:50`).length, 2);
});

test("an uncertain inventory transaction stops the pass without submitting cleanup transactions", async () => {
  const n = node();
  const s = storage();
  const f = fixture({ inventoryChanges: true, hook(event, state) {
    if (event === `inventory:${s.itemId}`) { state.pending = true; throw new Error("unknown commit outcome"); }
  } });
  await assert.rejects(reconcileSuiAssemblies(snapshot([n, s]), f.context, new Set([n.itemId, s.itemId])), /unknown commit outcome/);
  assert.equal(f.events.at(-1), `inventory:${s.itemId}`);
  assert.equal(f.events.includes(`status:${s.itemId}:1`), false);
  assert.equal(f.events.includes(`status:${n.itemId}:1`), false);
});

test("an uncertain anchor prevents all later assemblies and phases from starting", async () => {
  const n = node();
  const s = storage();
  const f = fixture({ hook(event, state) {
    if (event === `ensure:${n.itemId}`) { state.pending = true; throw new Error("uncertain anchor"); }
  } });
  await assert.rejects(reconcileSuiAssemblies(snapshot([n, s]), f.context, new Set([n.itemId, s.itemId])), /uncertain anchor/);
  assert.equal(f.events.at(-1), `ensure:${n.itemId}`);
  assert.equal(f.events.includes(`ensure:${s.itemId}`), false);
  assert.equal(f.events.includes("links"), false);
});

test("removal only considers previously tracked identities absent from local items", async () => {
  const old = storage({ kind: "assembly", storageCapacity: "0" });
  const f = fixture({ tracked: [old] });
  await reconcileSuiAssemblies(snapshot([]), f.context, new Set(["unrelated-local-item"]));
  assert.deepEqual(f.events.filter(e => e.startsWith("remove:")), [`remove:${old.itemId}`]);
  assert.deepEqual(f.context.state.assemblies, {});
  const linking = f.calls.get("links")![0];
  assert.equal(linking.length, 1);
  assert.equal(linking[0].destinationGateId, null);
});

test("an invalid assembly still present locally is reported and never removed", async () => {
  const old = storage();
  const f = fixture({ tracked: [old] });
  await assert.rejects(reconcileSuiAssemblies(snapshot([], [{ itemId: old.itemId, message: "invalid local assembly" }]),
    f.context, new Set([old.itemId])), /invalid local assembly/);
  assert.equal(f.events.some(e => e.startsWith("remove:")), false);
  assert.equal(f.context.state.assemblies[old.itemId], old);
});

test("tracked child assemblies are removed before their node and node fuel is emptied", async () => {
  const n = node();
  const s = storage();
  const f = fixture({ tracked: [n, s] });
  await reconcileSuiAssemblies(snapshot([]), f.context, new Set());
  assert.deepEqual(f.events.filter(e => e.startsWith("remove:")), [`remove:${s.itemId}`, `remove:${n.itemId}`]);
  assert.ok(f.events.indexOf(`fuel:${n.itemId}:0`) < f.events.indexOf(`remove:${n.itemId}`));
  assert.deepEqual(f.context.state.assemblies, {});
});

test("a fuel configuration failure prevents its node from being brought online", async () => {
  const n = node({ status: 2 });
  const f = fixture({ hook(event) { if (event === "efficiency:88335:10") throw new Error("configuration failure"); } });
  await assert.rejects(reconcileSuiAssemblies(snapshot([n]), f.context, new Set([n.itemId])), /configuration failure/);
  assert.equal(f.events.some(e => e.startsWith("status:")), false);
  assert.equal(f.events.some(e => e.startsWith("fuel:")), false);
});

test("failed removal of storage restores its temporary online state to offline", async () => {
  const n = node({ status: 2 });
  const s = storage();
  const f = fixture({ tracked: [s], inventoryChanges: true, hook(event) {
    if (event === `inventory:${s.itemId}`) throw new Error("removal inventory failure");
  } });
  await assert.rejects(reconcileSuiAssemblies(snapshot([n]), f.context, new Set([n.itemId])), /removal inventory failure/);
  assert.equal(f.statuses.get(s.itemId), 1);
  assert.equal(f.context.state.assemblies[s.itemId], s);
  assert.equal(f.events.includes(`remove:${s.itemId}`), false);
});

test("a rejected parent prevents anchoring a dependent against stale chain state", async () => {
  const n = node();
  const s = storage();
  const f = fixture({ hook(event) {
    if (event === `ensure:${n.itemId}`) throw new Error("node owner mismatch");
  } });
  await assert.rejects(reconcileSuiAssemblies(snapshot([n, s]), f.context, new Set([n.itemId, s.itemId])), /node owner mismatch/);
  assert.equal(f.events.includes(`ensure:${s.itemId}`), false);
});

test("a tracked tombstone is forgotten without attempting to recreate or remove it again", async () => {
  const s = storage();
  const f = fixture({ tracked: [s], hook(event) {
    if (event === `read:${s.itemId}`) throw Object.assign(new Error("already unanchored"), { code: "CHAIN_ASSEMBLY_TOMBSTONE" });
  } });
  await reconcileSuiAssemblies(snapshot([]), f.context, new Set());
  assert.deepEqual(f.context.state.assemblies, {});
  assert.equal(f.events.some(e => e.startsWith("ensure:") || e.startsWith("remove:")), false);
});

test("retiring storage uses the node's current fuel quantity instead of replenishing an old snapshot", async () => {
  const n = node();
  const s = storage();
  const f = fixture({ tracked: [n, s], inventoryChanges: true, chainFuelQuantity: 7 });
  await reconcileSuiAssemblies(snapshot([]), f.context, new Set());
  assert.ok(f.events.includes(`fuel:${n.itemId}:7`));
  assert.equal(f.events.includes(`fuel:${n.itemId}:50`), false);
  assert.deepEqual(f.calls.get(`inventory:${s.itemId}`)![0].inventory, []);
  assert.deepEqual(f.events.filter(e => e.startsWith("remove:")), [`remove:${s.itemId}`, `remove:${n.itemId}`]);
});

test("a failed child retirement preserves node fuel for the next retry", async () => {
  const n = node();
  const s = storage();
  const f = fixture({ tracked: [n, s], inventoryChanges: true, chainFuelQuantity: 7, hook(event) {
    if (event === `inventory:${s.itemId}`) throw new Error("storage drain failed");
  } });
  await assert.rejects(reconcileSuiAssemblies(snapshot([]), f.context, new Set()), /storage drain failed/);
  assert.equal(f.events.includes(`fuel:${n.itemId}:0`), false);
  assert.equal(f.events.includes(`remove:${n.itemId}`), false);
  assert.ok(f.context.state.assemblies[s.itemId]);
  assert.ok(f.context.state.assemblies[n.itemId]);
});
