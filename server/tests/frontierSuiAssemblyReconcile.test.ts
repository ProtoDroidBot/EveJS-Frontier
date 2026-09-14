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
  statusAuthority?: boolean;
  chainStatuses?: Record<string, number>;
  intents?: Record<string, { id: string; targetStatus: number }>;
  hook?: (event: string, state: { pending: boolean }) => void;
} = {}) {
  const events: string[] = [];
  const control = { pending: false };
  const statuses = new Map<string, number>(Object.entries(options.chainStatuses || {}));
  const intents = { ...options.intents };
  const calls = new Map<string, any[]>();
  const record = (event: string, argument?: any) => {
    events.push(event);
    calls.set(event, [...(calls.get(event) ?? []), argument]);
    options.hook?.(event, control);
  };
  const context: any = {
    statusAuthority: options.statusAuthority,
    getStatusIntent: (a: AssemblySnapshot) => intents[a.itemId] ?? null,
    projectStatus: (a: AssemblySnapshot, status: number, intentID: string | null) => {
      record(`project:${a.itemId}:${status}`, a);
      if ((intents[a.itemId]?.id ?? null) !== intentID) return false;
      delete intents[a.itemId];
      return true;
    },
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
        if (options.statusAuthority && !statuses.has(a.itemId)) return null;
        return { online: statuses.get(a.itemId) === 2, fields: { fuel: { fields: {
          quantity: String(options.chainFuelQuantity ?? a.fuel.quantity),
          type_id: { vec: [String(a.fuel.typeId)] }, unit_volume: { vec: [a.fuel.unitVolume] },
        } } } };
      },
      ensureAssembly: async (a: AssemblySnapshot) => {
        record(`ensure:${a.itemId}`, a);
        if (options.statusAuthority && !statuses.has(a.itemId)) statuses.set(a.itemId, 1);
      },
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
  return { context, events, control, statuses, calls, intents };
}

test("chain authority preserves existing online status without a local status request", async () => {
  const n = node();
  const s = storage();
  const f = fixture({ statusAuthority: true, chainStatuses: { [n.itemId]: 2, [s.itemId]: 2 } });
  await reconcileSuiAssemblies(snapshot([n, s]), f.context, new Set([n.itemId, s.itemId]));
  assert.equal(f.events.some(event => event.startsWith("status:")), false);
  assert.equal(f.statuses.get(s.itemId), 2);
});

test("chain authority initializes newly anchored state and confirms explicit status requests", async () => {
  const n = node({ status: 2 });
  const s = storage({ status: 2 });
  const f = fixture({ statusAuthority: true, chainStatuses: { [n.itemId]: 1 },
    intents: { [n.itemId]: { id: "requested-online", targetStatus: 2 } } });
  await reconcileSuiAssemblies(snapshot([n, s]), f.context, new Set([n.itemId, s.itemId]));
  assert.equal(f.statuses.get(n.itemId), 2);
  assert.equal(f.statuses.get(s.itemId), 2);
  assert.deepEqual(f.intents, {});
  assert.ok(f.events.indexOf(`status:${n.itemId}:2`) < f.events.indexOf(`project:${n.itemId}:2`));
});

test("fuel authority initializes a new node's fuel intent before anchoring and applies it once", async () => {
  const n = node();
  const f = fixture({ statusAuthority: true });
  const transfers: number[] = [];
  f.context.fuelAuthority = true;
  f.context.initializeFuel = (assembly: any) => {
    f.events.push(`initializeFuel:${assembly.itemId}`);
    assembly.fuelIntent = { id: "initial-fuel", typeID: assembly.fuel.typeId, quantityDelta: assembly.fuel.quantity };
  };
  f.context.syncFuel = async (assembly: any) => {
    f.events.push(`authorityFuel:${assembly.itemId}`);
    if (assembly.fuelIntent) {
      transfers.push(assembly.fuelIntent.quantityDelta);
      delete assembly.fuelIntent;
    }
  };
  f.context.chain.syncFuel = async () => assert.fail("fuel authority must use the context synchronization hook");
  await reconcileSuiAssemblies(snapshot([n]), f.context, new Set([n.itemId]));
  assert.deepEqual(transfers, [50]);
  assert.equal(f.events.filter(event => event === `initializeFuel:${n.itemId}`).length, 1);
  assert.ok(f.events.indexOf(`initializeFuel:${n.itemId}`) < f.events.indexOf(`ensure:${n.itemId}`));
  assert.ok(f.events.indexOf(`ensure:${n.itemId}`) < f.events.indexOf(`authorityFuel:${n.itemId}`));
  assert.equal(f.events.filter(event => event === `authorityFuel:${n.itemId}`).length, 2);
});

test("fuel authority projects an existing node's blockchain fuel without mirroring its stale local quantity", async () => {
  const n = node();
  const f = fixture({ statusAuthority: true, chainStatuses: { [n.itemId]: 1 }, chainFuelQuantity: 7 });
  const observedLocalQuantities: number[] = [];
  f.context.fuelAuthority = true;
  f.context.initializeFuel = () => assert.fail("an existing chain node must not initialize another fuel deposit");
  f.context.chain.syncFuel = async () => assert.fail("the local absolute quantity must not be mirrored to the chain");
  f.context.syncFuel = async (assembly: any) => {
    observedLocalQuantities.push(assembly.fuel.quantity);
    assembly.fuel = { ...assembly.fuel, quantity: 7 };
  };
  await reconcileSuiAssemblies(snapshot([n]), f.context, new Set([n.itemId]));
  assert.deepEqual(observedLocalQuantities, [50, 7]);
  assert.equal(n.fuel.quantity, 7);
  assert.equal(f.context.state.assemblies[n.itemId].fuel.quantity, 7);
  assert.equal(f.events.some(event => event.startsWith("status:")), false);
});

for (const quantityDelta of [8, -8]) {
  test(`fuel authority applies a ${quantityDelta > 0 ? "deposit" : "withdrawal"} before explicit offline and refreshes the resulting native burn`, async () => {
    const n = node({ fuel: { typeId: 88335, quantity: 50 + quantityDelta, unitVolume: "280000" } });
    let chainQuantity = 50;
    let pendingDelta: number | null = quantityDelta;
    const transfers: number[] = [];
    const projected: number[] = [];
    const f = fixture({ statusAuthority: true, chainStatuses: { [n.itemId]: 2 },
      intents: { [n.itemId]: { id: "requested-offline", targetStatus: 1 } }, hook(event) {
        if (event === `status:${n.itemId}:1`) {
          assert.deepEqual(transfers, [quantityDelta], "the transfer must commit before offline settles native burn");
          assert.equal(pendingDelta, null);
          chainQuantity -= 3;
        }
      } });
    f.context.fuelAuthority = true;
    f.context.chain.syncFuel = async () => assert.fail("fuel authority must not mirror the old absolute quantity");
    f.context.syncFuel = async (assembly: any) => {
      f.events.push(`authorityFuel:${assembly.itemId}`);
      if (pendingDelta !== null) {
        transfers.push(pendingDelta);
        chainQuantity += pendingDelta;
        pendingDelta = null;
      }
      assembly.fuel = { ...assembly.fuel, quantity: chainQuantity };
      projected.push(chainQuantity);
    };
    await reconcileSuiAssemblies(snapshot([n]), f.context, new Set([n.itemId]));
    assert.deepEqual(transfers, [quantityDelta]);
    assert.deepEqual(projected, [50 + quantityDelta, 47 + quantityDelta]);
    assert.ok(f.events.indexOf(`authorityFuel:${n.itemId}`) < f.events.indexOf(`status:${n.itemId}:1`));
    assert.ok(f.events.lastIndexOf(`authorityFuel:${n.itemId}`) > f.events.indexOf(`status:${n.itemId}:1`));
    assert.equal(n.fuel.quantity, 47 + quantityDelta);
    assert.equal(f.statuses.get(n.itemId), 1);
    assert.deepEqual(f.intents, {});
  });
}

test("fuel authority refreshes fuel after going online without reapplying its acknowledged intent", async () => {
  const n = node({ status: 2, fuel: { typeId: 88335, quantity: 30, unitVolume: "280000" } });
  let chainQuantity = 20;
  let pendingDelta: number | null = 10;
  const transfers: number[] = [];
  const projected: number[] = [];
  const f = fixture({ statusAuthority: true, chainStatuses: { [n.itemId]: 1 },
    intents: { [n.itemId]: { id: "requested-online", targetStatus: 2 } }, hook(event) {
      if (event === `status:${n.itemId}:2`) {
        assert.equal(chainQuantity, 30, "the deposit must fund the node before it goes online");
        chainQuantity -= 2;
      }
    } });
  f.context.fuelAuthority = true;
  f.context.chain.syncFuel = async () => assert.fail("fuel authority must not replenish a stale snapshot");
  f.context.syncFuel = async (assembly: any) => {
    f.events.push(`authorityFuel:${assembly.itemId}`);
    if (pendingDelta !== null) {
      transfers.push(pendingDelta);
      chainQuantity += pendingDelta;
      pendingDelta = null;
    }
    assembly.fuel = { ...assembly.fuel, quantity: chainQuantity };
    projected.push(chainQuantity);
  };
  await reconcileSuiAssemblies(snapshot([n]), f.context, new Set([n.itemId]));
  assert.deepEqual(transfers, [10]);
  assert.deepEqual(projected, [30, 28]);
  assert.ok(f.events.indexOf(`authorityFuel:${n.itemId}`) < f.events.indexOf(`status:${n.itemId}:2`));
  assert.ok(f.events.lastIndexOf(`authorityFuel:${n.itemId}`) > f.events.indexOf(`status:${n.itemId}:2`));
  assert.equal(n.fuel.quantity, 28);
  assert.equal(f.statuses.get(n.itemId), 2);
  assert.deepEqual(f.intents, {});
});

test("chain authority journals temporary online states before inventory transactions and clears after restoration", async () => {
  const n = node();
  const s = storage();
  const f = fixture({ statusAuthority: true, inventoryChanges: true, chainStatuses: { [n.itemId]: 1, [s.itemId]: 1 }, hook(event) {
    if (event === `status:${n.itemId}:2` || event === `inventory:${s.itemId}`) {
      assert.deepEqual(f.context.state.temporaryStatuses, { [n.itemId]: 1, [s.itemId]: 1 });
    }
  } });
  await reconcileSuiAssemblies(snapshot([n, s]), f.context, new Set([n.itemId, s.itemId]));
  assert.equal(f.statuses.get(n.itemId), 1);
  assert.equal(f.statuses.get(s.itemId), 1);
  assert.deepEqual(f.context.state.temporaryStatuses, {});
});

test("inventory mirroring preserves fresh online chain status despite an older offline snapshot", async () => {
  const n = node();
  const s = storage();
  const f = fixture({ statusAuthority: true, inventoryChanges: true, chainStatuses: { [n.itemId]: 2, [s.itemId]: 2 } });
  await reconcileSuiAssemblies(snapshot([n, s]), f.context, new Set([n.itemId, s.itemId]));
  assert.equal(f.statuses.get(n.itemId), 2);
  assert.equal(f.statuses.get(s.itemId), 2);
  assert.equal(f.events.some(event => event.startsWith("status:") && event.endsWith(":1")), false);
  assert.deepEqual(f.context.state.temporaryStatuses, {});
});

test("inventory mirroring restores fresh offline chain status despite an older online snapshot", async () => {
  const n = node({ status: 2 });
  const s = storage({ status: 2 });
  const f = fixture({ statusAuthority: true, inventoryChanges: true, chainStatuses: { [n.itemId]: 1, [s.itemId]: 1 } });
  await reconcileSuiAssemblies(snapshot([n, s]), f.context, new Set([n.itemId, s.itemId]));
  assert.equal(f.statuses.get(n.itemId), 1);
  assert.equal(f.statuses.get(s.itemId), 1);
  assert.ok(f.events.includes(`project:${s.itemId}:1`));
  assert.deepEqual(f.context.state.temporaryStatuses, {});
});

test("chain authority retains temporary restoration after an uncertain inventory transaction", async () => {
  const n = node();
  const s = storage();
  const f = fixture({ statusAuthority: true, inventoryChanges: true, chainStatuses: { [n.itemId]: 1, [s.itemId]: 1 }, hook(event, state) {
    if (event === `inventory:${s.itemId}`) { state.pending = true; throw new Error("unknown inventory outcome"); }
  } });
  await assert.rejects(reconcileSuiAssemblies(snapshot([n, s]), f.context, new Set([n.itemId, s.itemId])), /unknown inventory outcome/);
  assert.deepEqual(f.context.state.temporaryStatuses, { [n.itemId]: 1, [s.itemId]: 1 });
});

test("chain authority leaves a newer status request intact when confirmation projection races", async () => {
  const n = node({ status: 2 });
  const f = fixture({ statusAuthority: true, chainStatuses: { [n.itemId]: 1 },
    intents: { [n.itemId]: { id: "online", targetStatus: 2 } }, hook(event) {
      if (event === `project:${n.itemId}:2`) f.intents[n.itemId] = { id: "newer-offline", targetStatus: 1 };
    } });
  await assert.rejects(reconcileSuiAssemblies(snapshot([n]), f.context, new Set([n.itemId])), /status request changed/);
  assert.equal(f.intents[n.itemId].id, "newer-offline");
});

test("chain authority retires removed nodes without projecting into missing local inventory", async () => {
  const n = node();
  const f = fixture({ statusAuthority: true, tracked: [n], chainStatuses: { [n.itemId]: 2 } });
  f.context.projectStatus = () => assert.fail("Removed assemblies have no local item to project");
  await reconcileSuiAssemblies(snapshot([]), f.context, new Set());
  assert.ok(f.events.includes(`remove:${n.itemId}`));
});

test("retiring storage retains offline recovery even when its tracked snapshot was online", async () => {
  const n = node({ status: 2 });
  const s = storage({ status: 2 });
  const f = fixture({ statusAuthority: true, tracked: [n, s], inventoryChanges: true,
    chainStatuses: { [n.itemId]: 2, [s.itemId]: 1 }, hook(event, state) {
      if (event === `inventory:${s.itemId}`) { state.pending = true; throw new Error("unknown retirement outcome"); }
    } });
  await assert.rejects(reconcileSuiAssemblies(snapshot([n]), f.context, new Set([n.itemId])), /unknown retirement outcome/);
  assert.equal(f.context.state.temporaryStatuses[s.itemId], 1);
  assert.ok(f.context.state.assemblies[s.itemId]);
});

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
  assert.ok(f.events.lastIndexOf(`status:${n.itemId}:1`) > inventoryIndex);
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
  assert.ok(f.events.lastIndexOf(`status:${n.itemId}:1`) < f.events.indexOf(`inventory:${s.itemId}`),
    "The node must not receive a cleanup transaction after an uncertain write");
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

test("exhaustion offlines the node before draining its fuel and keeps children offline", async () => {
  const n = node({ fuel: { typeId: 0, quantity: 0, unitVolume: "0" } });
  const s = storage();
  const f = fixture();
  await reconcileSuiAssemblies(snapshot([n, s]), f.context, new Set([n.itemId, s.itemId]));
  assert.ok(f.events.indexOf(`status:${n.itemId}:1`) < f.events.indexOf(`fuel:${n.itemId}:0`));
  assert.equal(f.statuses.get(n.itemId), 1);
  assert.equal(f.statuses.get(s.itemId), 1);
  assert.equal(f.events.some(event => event.startsWith("status:") && event.endsWith(":2")), false);
});
