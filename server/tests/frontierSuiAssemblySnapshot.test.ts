import assert = require("node:assert/strict");
import { test } from "node:test";
import { buildSuiAssemblySnapshot, SuiAssemblySnapshotInput } from "../src/services/frontier/suiAssemblySnapshot";
import { clearAssemblyEnergyConfig, setAssemblyEnergyConfig } from "../src/services/frontier/networkNodeEnergyConfig";

const OWNER = 140000005;
function assembly(itemID: string | number, typeID = 88092, options: Record<string, any> = {}) {
  const { status = 1, ownerID = OWNER, system = 30000004, position = { x: 0, y: 0, z: 0 },
    destinationGateID = 0, targetSolarSystemID = 0, fuel, energy, ...rest } = options;
  return {
    itemID, typeID, ownerID, locationID: system, itemName: `Assembly ${itemID}`,
    spaceState: { position },
    customInfo: JSON.stringify({
      evejsFrontierConstruction: { assemblyTypeID: typeID, assemblyStatus: status, ownerID, solarSystemID: system,
        destinationGateID, targetSolarSystemID },
      ...(fuel === undefined ? {} : { evejsFrontierNetworkNodeFuel: fuel }),
      ...(energy === undefined ? {} : { evejsFrontierEnergy: energy }),
    }),
    ...rest,
  };
}
function fixture(items: any[] = []): SuiAssemblySnapshotInput {
  return {
    items,
    characters: {
      [OWNER]: { accountId: 5, characterName: "Pilot" },
      [OWNER + 1]: { accountId: 6, characterName: "Visitor" },
    },
    components: { types: [
      { typeID: 88092, smartDeployable: { createOnChain: 1 }, smartAnchor: { fuelMaxCapacity: 1000, fuelBurnRateInSeconds: 3000, maxEnergyCapacity: 777 } },
      { typeID: 77917, smartDeployable: { createOnChain: 1 }, smartStorageUnit: { storageCapacity: 1000, personalCapacity: 1 } },
      { typeID: 88086, smartDeployable: { createOnChain: 1 }, smartGate: { range: 65 } },
      { typeID: 95627, smartDeployable: { createOnChain: 1 }, smartGate: { range: 65 } },
      { typeID: 92279, smartDeployable: { createOnChain: 1 }, smartTurret: {} },
      { typeID: 90184, smartDeployable: { createOnChain: 1 } },
      { typeID: 99999, smartDeployable: { createOnChain: 0 } },
    ] },
    itemTypes: { types: [
      { typeID: 77818, volume: 0.28 },
      { typeID: 34, volume: 0.0002 },
      { typeID: 35, volume: 1.5 },
    ] },
    solarSystems: { solarSystems: [
      { solarSystemID: 30000004, position: { x: 0, y: 0, z: 0 } },
      { solarSystemID: 30000005, position: { x: 9_460_730_472_580_800, y: 0, z: 0 } },
    ] },
  };
}

test("empty or unfinished local worlds create no chain work or owner provisioning", () => {
  assert.deepEqual(buildSuiAssemblySnapshot(fixture()), { assemblies: [], characters: [], errors: [] });
  const source = fixture([assembly(1, 88092, { status: 5 }), assembly(2, 99999), { itemID: 3, customInfo: "legacy text" }]);
  assert.deepEqual(buildSuiAssemblySnapshot(source), { assemblies: [], characters: [], errors: [] });
});

test("normalizes decimal u64 IDs and exact fractional volumes without changing input", () => {
  const nodeId = "9007199254740993";
  const source = fixture([
    assembly("9007199254740995", 77917, { status: 2, position: { x: 10, y: 0, z: 0 } }),
    assembly(nodeId, 88092, { status: 2, fuel: { typeID: 77818, quantity: 3571 } }),
    { itemID: "9007199254740998", typeID: 34, locationID: "9007199254740995", ownerID: OWNER + 1, flagID: 66, stacksize: 5000 },
    { itemID: "9007199254740997", typeID: 35, locationID: "9007199254740995", ownerID: OWNER, flagID: 66, stacksize: 50, singleton: 1 },
  ]);
  const original = structuredClone(source);
  const result = buildSuiAssemblySnapshot(source);
  assert.deepEqual(result.errors, []);
  assert.deepEqual(source, original);
  assert.deepEqual(result.characters.map((row) => row.gameCharacterId), [OWNER, OWNER + 1]);
  const [node, storage] = result.assemblies;
  assert.equal(node.itemId, nodeId);
  assert.equal(node.kind, "network_node");
  assert.equal(node.status, 2);
  assert.deepEqual(node.fuel, { typeId: 77818, quantity: 3571, unitVolume: "280000" });
  assert.equal(node.fuelCapacity, "1000000000");
  assert.equal(node.burnRateMs, "3000000");
  assert.equal(node.maxEnergy, "777");
  assert.equal(storage.networkNodeId, nodeId);
  assert.equal(storage.storageCapacity, "1000000000");
  assert.deepEqual(storage.inventory.map((row) => [row.quantity, row.unitVolume]), [[1, "1500000"], [5000, "200"]]);
});

test("binds the nearest completed node with matching owner and system independent of input ordering", () => {
  const source = fixture([
    assembly(10, 90184, { position: { x: 1, y: 0, z: 0 } }),
    assembly(4, 88092, { ownerID: OWNER + 1, position: { x: 1, y: 0, z: 0 } }),
    assembly(3, 88092, { system: 30000005, position: { x: 1, y: 0, z: 0 } }),
    assembly(2, 88092, { position: { x: 50, y: 0, z: 0 } }),
    assembly(1),
  ]);
  const first = buildSuiAssemblySnapshot(source);
  const reversed = buildSuiAssemblySnapshot({ ...source, items: [...source.items as any[]].reverse() });
  assert.deepEqual(first, reversed);
  assert.equal(first.assemblies.find((row) => row.itemId === "10")?.networkNodeId, "1");
});

test("preserves verified bindings when a nearer node appears and never silently rebinds", () => {
  const source = fixture([
    assembly(1), assembly(2, 88092, { position: { x: 9, y: 0, z: 0 } }),
    assembly(3, 90184, { position: { x: 10, y: 0, z: 0 } }),
  ]);
  source.networkNodeBindings = { "3": "1" };
  const stable = buildSuiAssemblySnapshot(source);
  assert.deepEqual(stable.errors, []);
  assert.equal(stable.assemblies.find((row) => row.itemId === "3")?.networkNodeId, "1");
  const removed = buildSuiAssemblySnapshot({ ...source, items: (source.items as any[]).slice(1) });
  assert.equal(removed.errors[0].code, "MISSING_NETWORK_NODE");
  assert.equal(removed.assemblies.some((row) => row.itemId === "3"), false);
  const wrongOwner = buildSuiAssemblySnapshot({ ...source, items: [assembly(1, 88092, { ownerID: OWNER + 1 }), ...(source.items as any[]).slice(1)] });
  assert.equal(wrongOwner.errors[0].code, "INVALID_NETWORK_NODE_BINDING");
});

test("breaks equal-distance ties by item ID and rejects missing nodes and invalid owners", () => {
  const tied = buildSuiAssemblySnapshot(fixture([
    assembly(1, 88092, { position: { x: -1, y: 0, z: 0 } }),
    assembly(2, 88092, { position: { x: 1, y: 0, z: 0 } }),
    assembly(3, 92279),
  ]));
  assert.deepEqual(tied.errors, []);
  assert.equal(tied.assemblies.find(row => row.itemId === "3")?.networkNodeId, "1");
  const missing = buildSuiAssemblySnapshot(fixture([assembly(3, 90184)]));
  assert.equal(missing.errors[0].code, "MISSING_NETWORK_NODE");
  assert.deepEqual(missing.characters, []);
  const owner = buildSuiAssemblySnapshot(fixture([assembly(1, 88092, { ownerID: 99 })]));
  assert.equal(owner.errors[0].code, "MISSING_OWNER");
  assert.equal(owner.assemblies.length, 0);
});

test("energy bindings honor the node radius, explicit choice and persistent chain constraints", () => {
  const source = fixture([
    assembly(1), assembly(2, 88092, { position: { x: 79_000, y: 0, z: 0 } }),
    assembly(3, 90184, { energy: { networkNodeID: 2, autoConnect: false } }),
    assembly(4, 90184, { energy: { networkNodeID: 0, autoConnect: false } }),
    assembly(5, 90184, { position: { x: -80_000, y: 0, z: 0 } }),
    assembly(6, 90184, { position: { x: -80_001, y: 0, z: 0 } }),
  ]);
  const result = buildSuiAssemblySnapshot(source);
  assert.equal(result.assemblies.find(row => row.itemId === "3")?.networkNodeId, "2");
  assert.equal(result.assemblies.some(row => row.itemId === "4"), false);
  assert.equal(result.assemblies.find(row => row.itemId === "5")?.networkNodeId, "1");
  assert.deepEqual(result.errors.map(row => [row.itemId, row.code]), [["6", "MISSING_NETWORK_NODE"]]);
  const locked = buildSuiAssemblySnapshot({ ...source, networkNodeBindings: { "3": "1", "4": "1", "6": "1" } });
  assert.deepEqual(locked.errors.map(row => row.code), ["NETWORK_NODE_BINDING_LOCKED", "NETWORK_NODE_BINDING_LOCKED", "NETWORK_NODE_OUT_OF_RANGE"]);
});

test("snapshots use the current chain energy table including zero for unconfigured types", () => {
  try {
    setAssemblyEnergyConfig([{ typeID: 90184, energyRequired: 1 }]);
    const result = buildSuiAssemblySnapshot(fixture([assembly(1), assembly(2, 90184), assembly(3, 92279)]));
    assert.equal(result.assemblies.find(row => row.itemId === "2")?.energyRequired, 1);
    assert.equal(result.assemblies.find(row => row.itemId === "3")?.energyRequired, 0);
  } finally { clearAssemblyEnergyConfig(); }
});

test("does not manufacture fuel or online dependency state", () => {
  const offline = buildSuiAssemblySnapshot(fixture([assembly(1)]));
  assert.deepEqual(offline.assemblies[0].fuel, { typeId: 0, quantity: 0, unitVolume: "0" });
  const online = buildSuiAssemblySnapshot(fixture([assembly(1, 88092, { status: 2 })]));
  assert.equal(online.errors[0].code, "MISSING_FUEL");
  assert.equal(online.assemblies.length, 0);
  const child = buildSuiAssemblySnapshot(fixture([assembly(1), assembly(2, 90184, { status: 2 })]));
  assert.equal(child.errors[0].code, "OFFLINE_NETWORK_NODE");
});

test("checks authored fuel and per-character inventory capacities with exact arithmetic", () => {
  const overfuel = buildSuiAssemblySnapshot(fixture([assembly(1, 88092, { fuel: { typeID: 77818, quantity: 3572 } })]));
  assert.equal(overfuel.errors[0].code, "FUEL_CAPACITY_EXCEEDED");
  const overPersonal = buildSuiAssemblySnapshot(fixture([
    assembly(1), assembly(2, 77917),
    { itemID: 3, typeID: 34, locationID: 2, ownerID: OWNER + 1, flagID: 66, quantity: 5001 },
  ]));
  assert.equal(overPersonal.errors[0].code, "STORAGE_CAPACITY_EXCEEDED");
  assert.deepEqual(overPersonal.characters.map((row) => row.gameCharacterId), [OWNER]);
});

test("validates reciprocal gates and calculates range and system distance in meters", () => {
  const source = fixture([
    assembly(1), assembly(2, 88092, { system: 30000005 }),
    assembly(3, 88086, { destinationGateID: 4 }),
    assembly(4, 88086, { system: 30000005, destinationGateID: 3 }),
  ]);
  const result = buildSuiAssemblySnapshot(source);
  assert.deepEqual(result.errors, []);
  for (const gate of result.assemblies.filter((row) => row.kind === "gate")) {
    assert.equal(gate.gateDistanceMeters, "9460730472580800");
    assert.equal(gate.gateMaxDistanceMeters, "614947480717752000");
  }
  const invalid = buildSuiAssemblySnapshot({ ...source, solarSystems: undefined });
  assert.equal(invalid.assemblies.filter((row) => row.kind === "gate").length, 0);
  assert.ok(invalid.errors.some((row) => row.code === "INVALID_POSITION"));
});

test("normalizes a one-way Smart Catapult route without requiring a destination gate", () => {
  const result = buildSuiAssemblySnapshot(fixture([
    assembly(1),
    assembly(2, 95627, { targetSolarSystemID: 30000005 }),
  ]));
  assert.deepEqual(result.errors, []);
  const catapult = result.assemblies.find((row) => row.itemId === "2")!;
  assert.equal(catapult.kind, "gate");
  assert.equal(catapult.isCatapult, true);
  assert.equal(catapult.destinationGateId, null);
  assert.equal(catapult.destinationSolarSystemId, 30000005);
  assert.equal(catapult.gateDistanceMeters, "9460730472580800");
  assert.equal(catapult.gateMaxDistanceMeters, "614947480717752000");
  assert.equal(result.assemblies.filter((row) => row.kind === "gate").length, 1);
});

test("rejects unsafe IDs, duplicate records, invalid coordinates, and lossy volumes", () => {
  const unsafe = buildSuiAssemblySnapshot(fixture([assembly(Number.MAX_SAFE_INTEGER + 1)]));
  assert.equal(unsafe.errors[0].code, "INVALID_ID");
  const duplicate = buildSuiAssemblySnapshot(fixture([assembly(1), assembly(1)]));
  assert.equal(duplicate.errors[0].code, "DUPLICATE_ITEM");
  assert.equal(duplicate.assemblies.length, 0);
  const position = buildSuiAssemblySnapshot(fixture([assembly(1, 88092, { position: { x: NaN, y: 0, z: 0 } })]));
  assert.equal(position.errors[0].code, "INVALID_POSITION");
  const source = fixture([assembly(1, 88092, { fuel: { typeID: 77818, quantity: 1 } })]);
  source.itemTypes = [{ typeID: 77818, volume: "0.0000001" }];
  const precision = buildSuiAssemblySnapshot(source);
  assert.equal(precision.errors[0].code, "INVALID_PRECISION");
});

test("accepts keyed item/static maps and uses only the explicit missing-energy fallback", () => {
  const source = fixture();
  const node = assembly(1);
  delete node.itemID;
  source.items = { "1": node };
  source.components = { "88092": { smartDeployable: { createOnChain: 1 }, smartAnchor: { fuelMaxCapacity: "1000", fuelBurnRateInSeconds: "0.5" } } };
  const result = buildSuiAssemblySnapshot(source);
  assert.deepEqual(result.errors, []);
  assert.equal(result.assemblies[0].itemId, "1");
  assert.equal(result.assemblies[0].maxEnergy, "1000");
  assert.equal(result.assemblies[0].burnRateMs, "500");
  source.components["88092"].smartAnchor.maxEnergyCapacity = -1;
  assert.equal(buildSuiAssemblySnapshot(source).assemblies.length, 0);
});

test("refuses ambiguous inventory IDs and aggregate quantities that overflow chain inventory", () => {
  const item = { itemID: 3, typeID: 34, locationID: 2, ownerID: OWNER, flagID: 66, quantity: 1 };
  const duplicated = buildSuiAssemblySnapshot(fixture([assembly(1), assembly(2, 77917), item, item]));
  assert.equal(duplicated.errors[0].code, "DUPLICATE_ITEM");
  assert.equal(duplicated.assemblies.some((row) => row.itemId === "2"), false);
  const source = fixture([
    assembly(1), assembly(2, 77917), { ...item, quantity: 0xffffffff }, { ...item, itemID: 4 },
  ]);
  source.itemTypes = [{ typeID: 34, volume: 0 }];
  const overflow = buildSuiAssemblySnapshot(source);
  assert.equal(overflow.errors[0].code, "INVENTORY_QUANTITY_EXCEEDED");
});
