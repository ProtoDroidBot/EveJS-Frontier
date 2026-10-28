"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { createExplorationRuntime } = require("../src/services/frontier/explorationRuntime");
const { buildExplorationReferenceTable } = require("../src/services/frontier/explorationReferenceData");
const { directionalObservation, remoteObservation } = require("../src/services/frontier/explorationDiscovery");

function fixture() {
  const saved = new Map(), notices = [];
  const world = { revision: "test-world", version: { major: 1 }, starterSystemIds: [1], systems: new Map([[1, {}], [2, {}]]),
    makeDelta(ids, detail, sequence) { return { sequence, systems: ids.map(id => ({ id, revealLevel: detail ? 1 : 0 })) }; } };
  const runtime = createExplorationRuntime({ world, stateStore: { read: key => structuredClone(saved.get(key)), write: (key, value) => saved.set(key, structuredClone(value)) }, encode: data => Buffer.from(JSON.stringify(data)), cursorSecret: "fixture" });
  runtime.subscribe(event => notices.push(event));
  return { runtime, saved, notices, actor: { userID: 10, characterID: 20 } };
}
test("thermal/EM discoveries persist and notify without granting remote visits or detail access", () => {
  const f = fixture();
  const page = f.runtime.getKnownUniverse(f.actor, { size: 1 });
  f.runtime.recordScanDiscovery(f.actor, 2, { thermal: "detected", em: "resolved" });
  const knowledge = f.runtime.getKnownUniverse(f.actor).knowledge;
  assert.deepEqual(knowledge.thermal, { detected_system_ids: ["2"], resolved_system_ids: [] });
  assert.deepEqual(knowledge.em, { detected_system_ids: ["2"], resolved_system_ids: ["2"] });
  assert.deepEqual(knowledge.visited_system_ids, []);
  assert.throws(() => f.runtime.getSystemDetail(f.actor, "2"), error => error.statusCode === 403);
  assert.throws(() => f.runtime.getKnownUniverse(f.actor, { token: page.next_page.token }), error => error.statusCode === 400);
  f.runtime.recordScanDiscovery(f.actor, 2, { thermal: "detected", em: "detected" });
  assert.equal(f.notices.length, 1); assert.equal(f.saved.get("10-20").revision, 1);
  assert.equal(JSON.parse(f.notices[0].payload.payload).systems[0].revealLevel, 0);
  f.runtime.recordScanDiscovery(f.actor, 2, { thermal: "resolved" }); assert.equal(f.saved.get("10-20").revision, 2);
});
test("scan knowledge validates world/identity/levels and older visit-only rows migrate safely", () => {
  const f = fixture(); f.saved.set("10-20", { revision: 2, visited: [1] });
  assert.deepEqual(f.runtime.getKnownUniverse(f.actor).knowledge.thermal.detected_system_ids, []);
  for (const call of [() => f.runtime.recordScanDiscovery({ userID: 10, characterID: null }, 2, { em: "resolved" }), () => f.runtime.recordScanDiscovery(f.actor, 3, { em: "resolved" }), () => f.runtime.recordScanDiscovery(f.actor, 2, { em: "arbitrary" })]) assert.throws(call);
  assert.equal(f.saved.get("10-20").revision, 2);
  f.saved.set("10-20", { revision: 2, visited: [1], thermal: { detected: [], resolved: [2] } });
  assert.throws(() => f.runtime.getKnownUniverse(f.actor), error => error.statusCode === 503);
});
test("canonical legacy adapters preserve exact IDs and positions while removing unrelated geography", () => {
  const position = { x: 1.25e13, y: -77.125, z: 3.5 };
  const system = { id: 1, regionId: 10, constellationId: 20, center: { x: 7e18, y: -2e19, z: 0 }, sun: { id: 100, typeId: 45031, position },
    planets: [{ id: 101, typeId: 2016, position, moons: [], lagrangePoints: [{ id: 102, typeId: 88163, position }] }],
    stargates: [{ id: 110, typeId: 79787, position, destinationGateId: 111, destinationSystemId: 2, planetId: 101, lagrangePointId: 102 }] };
  const world = { revision: "selected", systems: new Map([[1, system]]) };
  const systems = buildExplorationReferenceTable(world, "solarSystems", { solarSystems: [{ solarSystemID: 1, name: "Legacy", center: { x: 0, y: 0, z: 0 } }, { solarSystemID: 999 }] });
  assert.equal(systems.solarSystems.length, 1); assert.deepEqual(systems.solarSystems[0].center, system.center);
  const celestial = buildExplorationReferenceTable(world, "celestials", { celestials: [{ itemID: 101, itemName: "Planet", position: { x: 0, y: 0, z: 0 } }] });
  assert.equal(celestial.celestials.length, 3); assert.deepEqual(celestial.celestials.find(row => row.itemID === 102).position, position);
  const gate = buildExplorationReferenceTable(world, "stargates").stargates[0]; assert.equal(gate.destinationSolarSystemID, 2); assert.equal(gate.lagrangePointID, 102);
  const local = buildExplorationReferenceTable(world, "stations", { stations: [{ stationID: 1, solarSystemID: 1 }, { stationID: 2, solarSystemID: 999 }] }); assert.deepEqual(local.stations.map(row => row.stationID), [1]);
});
test("scanner bridge uses returned signature evidence and distinguishes unresolved channels", () => {
  assert.deepEqual(directionalObservation({ updatedScans: [{ signature_results: [[4, 2, 5], [3, 8, 2], [2, 100, 0], [4, NaN, 0]] }] }), { thermal: "detected", em: "resolved" });
  assert.deepEqual(directionalObservation({ updatedScans: [] }), {});
  assert.deepEqual(remoteObservation({ heatMapCells: [{ resolutionTier: "coarse", channels: { thermal: 0.3, electromagnetic: 0 } }, { resolutionTier: "deep", channels: { electromagnetic: 0.8 } }] }), { thermal: "detected", em: "resolved" });
});

test("remote resource index reads voxel ledger depletion and retains private-instance filtering", () => {
  const { createSystemScanIndex } = require("../src/services/frontier/systemScanIndex");
  let remaining = 50000;
  const privateInstance = { instanceID: 50, instanceScope: "private" };
  const index = createSystemScanIndex({ now: () => 1000, config: { clientBuild: 3640684, voxelMiningEnabled: true, voxelMiningWorldRevision: "world" },
    worldData: { getSolarSystemByID: () => ({}), getCelestialsForSystem: () => [], getStationsForSystem: () => [] },
    dungeonRuntime: { listActiveInstancesBySystem: () => [], getInstance: () => privateInstance }, dungeonAuthority: { getTemplateByID: () => null },
    dungeonVisibility: { isPrivateDungeonInstance: instance => instance.instanceScope === "private", canSessionAccessDungeonInstance: session => session?.characterID === 20 },
    miningSites: { buildGeneratedResourceSiteDefinitionsForSystem: () => [] }, itemStore: { listSystemSpaceItems: () => [], getItemMetadata: () => ({}) },
    structureState: { listStructuresForSystem: () => [] }, npcStore: { listNativeEntitiesForSystem: () => [] },
    scanningRuntime: { resolveBaseSignature: () => 1, resolveGravimetricSignatureMultiplier: () => 1 }, signatureEvents: { listActiveSystemSignatureBlooms: () => [] },
    deploymentRuntime: { readConstructionState: () => null }, scanInhibitorRuntime: { isPositionScanInhibited: () => false },
    voxelStore: { getAsteroid: () => ({ originalQuantity: 100000, remainingQuantity: remaining }) }, getMineableState: () => ({ yieldTypeID: 77800, remainingQuantity: 100000 }) });
  const scene = { staticEntities: [{ itemID: 300, typeID: 98115, compositeAsteroid: true, position: { x: 10, y: 0, z: 0 } }, { itemID: 301, typeID: 98115, compositeAsteroid: true, dungeonSiteInstanceID: 50, position: { x: 20, y: 0, z: 0 } }] };
  const result = index.getSystemScanSnapshot(1, { liveScene: scene, actorSession: { characterID: 21 } });
  assert.equal(result.success, true); assert.equal(result.data.contributions.length, 1);
  const beforeRevision = result.data.revision;
  remaining = 0;
  const depleted = index.getSystemScanSnapshot(1, { liveScene: scene, actorSession: { characterID: 20 } });
  assert.equal(depleted.data.contributions.length, 2); assert.notEqual(depleted.data.revision, beforeRevision);
  assert.ok(depleted.data.contributions.every(row => row.resourceSummary.depleted));
  assert.ok(depleted.data.contributions.every(row => row.resourceSummary.remainingTypeIDs.length === 0));
});
