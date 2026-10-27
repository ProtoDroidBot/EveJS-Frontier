"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  createExplorationWorld, calculateExplorationWorldRevision, createTemporaryExplorationWorld,
  CANONICAL_SOURCE_PROFILE, CANONICAL_SOURCE_LABEL, CANONICAL_CONVERSION_POLICY, CANONICAL_SOURCE_DIGESTS,
} = require("../src/services/frontier/explorationWorld");
const { buildExplorationReferenceTable } = require("../src/services/frontier/explorationReferenceData");

const position = { x: 10, y: -20, z: 30 };
function seal(raw) {
  raw.contentRevision = calculateExplorationWorldRevision(raw);
  return raw;
}
function fixture() {
  return seal({
    format: "evejs-frontier-exploration-world-v1", targetBuild: 3640684,
    conversionPolicyRevision: CANONICAL_CONVERSION_POLICY,
    contentRevisionAlgorithm: "sha256-typed-f64-v1",
    source: { build: 3572727, kind: "canonical-client-geography", label: CANONICAL_SOURCE_LABEL,
      profile: CANONICAL_SOURCE_PROFILE, branch: "//frontier/demo-tool-v2", digests: structuredClone(CANONICAL_SOURCE_DIGESTS) },
    regions: [{ id: 10000001, name: "Canonical Region", center: position }],
    constellations: [{ id: 20000001, regionId: 10000001, center: position }],
    systems: [1, 2].map(index => ({ id: 30000000 + index, name: `Canonical ${index}`, regionId: 10000001,
      constellationId: 20000001, center: { x: 1e18 + index * 4096, y: -2e18, z: 3e18 }, neighbours: [30000000 + (3 - index)],
      radiusM: 1e12, security: 0, sunTypeId: 45031,
      sun: { id: 40000000 + index, typeId: 45031, position: { x: index * 1000, y: 0, z: 0 }, radiusM: 1e8 },
      companionSuns: index === 1 ? [{ id: 40000003, typeId: 45031, position: { x: 9000, y: 0, z: 0 }, radiusM: 2e8 }] : [],
      planets: [{ id: 42000000 + index, typeId: 2016, name: `Canonical planet ${index}`, celestialIndex: 1,
        position, radiusM: 6e6, hostCelestialId: index === 1 ? 40000003 : 40000002,
        moons: [{ id: 48000000 + index, typeId: 14, position, orbitIndex: 1, name: `Canonical moon ${index}` }],
        lagrangePoints: [1, 2, 3, 4, 5].map(pointIndex => ({ id: 400000000 + pointIndex * 10000000 + 2000000 + index,
          pointIndex, typeId: 88162 + pointIndex, position, name: `L${pointIndex}` })),
      }],
      stargates: [{ id: 60000000 + index, typeId: 79881, position,
        destinationGateId: 60000000 + (3 - index), destinationSystemId: 30000000 + (3 - index),
        planetId: 42000000 + index, lagrangePointId: 412000000 + index }],
    })),
    stations: [{ id: 64000001, stationID: 64000001, name: "Canonical Keep", stationName: "Canonical Keep",
      solarSystemID: 30000001, orbitID: 42000001, lagrangePointID: 412000001, typeID: 85226, groupID: 15,
      position, radius: 33811, ownerID: 1000442, operationID: 51 }],
    starterSystemIds: [30000001],
  });
}

test("canonical source is pinned independently while target wire build stays 3640684", () => {
  const raw = fixture(), world = createExplorationWorld(raw);
  assert.equal(world.sourceProfile, CANONICAL_SOURCE_PROFILE);
  assert.equal(world.canonicalSource, true);
  assert.equal(world.source.build, 3572727);
  assert.equal(world.baseRevision, raw.contentRevision);
  assert.equal(world.contentProfile, null);
  assert.match(world.versionString, /canonical-3572727-for-3640684/);
  assert.doesNotMatch(world.versionString, /legacy-3502403/);
  const delta = world.makeDelta([30000001], true, 0);
  assert.equal(delta.schemaVersion, 14);
  assert.equal(delta.systems[0].planets[0].hostCelestialId, 40000003);
  assert.equal(delta.systems[0].companionSuns[0].position.x, 9000);
  assert.equal(world.stations.get(64000001).orbitID, 42000001);
  assert.ok(Object.isFrozen(world.source.digests));
  assert.ok(Object.isFrozen(CANONICAL_SOURCE_DIGESTS["code.ccp"]));
});

test("rejects renamed, repinned, missing or wrong conversion inputs", () => {
  const cases: Array<[(raw: any) => void, RegExp]> = [
    [raw => { raw.source.profile = "3572727-canonical-fsd-v2"; }, /source profile/],
    [raw => { raw.source.label = "3502403-MOD4-STUFF1"; }, /source profile/],
    [raw => { raw.source.branch = "//frontier/cycle-7"; }, /source profile/],
    [raw => { raw.targetBuild = 3572727; }, /target build/],
    [raw => { raw.conversionPolicyRevision = "sqlite-join"; }, /source profile/],
    [raw => { raw.source.digests["code.ccp"].sha256 = "0".repeat(64); }, /fingerprint/],
    [raw => { raw.source.digests["res:/staticdata/systems.static"].size++; }, /fingerprint/],
    [raw => { delete raw.source.digests["res:/staticdata/solarsystemcontent.static"]; }, /digest/],
  ];
  for (const [mutate, expected] of cases) {
    const raw = fixture(); mutate(raw); seal(raw);
    assert.throws(() => createExplorationWorld(raw), expected);
  }
});

test("canonical celestial validation rejects invalid host/type, moon display metadata and Lagrange identity", () => {
  const cases: Array<[(raw: any) => void, RegExp]> = [
    [raw => { raw.systems[0].planets[0].hostCelestialId = 42000001; }, /authored stellar host/],
    [raw => { raw.systems[0].planets[0].typeId = 97234; }, /incompatible/],
    [raw => { raw.systems[0].planets[0].moons[0].orbitIndex = 0; }, /display orbit index/],
    [raw => { raw.systems[0].planets[0].lagrangePoints[0].pointIndex = 2; }, /Lagrange.*identity/],
    [raw => { raw.systems[0].planets[0].lagrangePoints[0].typeId = 88167; }, /Lagrange.*identity/],
    [raw => { raw.systems[0].stargates[0].lagrangePointId = 412000002; }, /local parent/],
    [raw => { raw.systems[0].companionSuns[0].id = 40000001; }, /Duplicate local/],
  ];
  for (const [mutate, expected] of cases) {
    const raw = fixture(); mutate(raw); seal(raw);
    assert.throws(() => createExplorationWorld(raw), expected);
  }
});

test("canonical station placement is part of the same local graph", () => {
  for (const [field, value, expected] of [
    ["solarSystemID", 39999999, /identity\/system/],
    ["orbitID", 42000002, /misowned planet/],
    ["lagrangePointID", 412000002, /misowned Lagrange/],
    ["typeID", 1, /incompatible/],
    ["id", 42000001, /Duplicate station/],
  ] as Array<[string, number, RegExp]>) {
    const raw = fixture(); raw.stations[0][field] = value; seal(raw);
    assert.throws(() => createExplorationWorld(raw), expected);
  }
});

test("canonical reference projection never inherits old metadata through reused numeric IDs", () => {
  const world = createExplorationWorld(fixture());
  const prior = { itemID: 42000001, itemName: "Old planet", solarSystemID: 30000002, orbitID: 49999999,
    radius: 999, orbitIndex: 99, celestialIndex: 99, secretLegacyField: "stale", nameID: 12345 };
  const output = buildExplorationReferenceTable(world, "celestials", { celestials: [prior], oldTotal: 999 });
  const planet = output.celestials.find(row => row.itemID === 42000001);
  assert.equal(planet.itemName, "Canonical planet 1");
  assert.equal(planet.solarSystemID, 30000001);
  assert.equal(planet.orbitID, 40000003);
  assert.equal(planet.radius, 6e6);
  assert.equal(planet.celestialIndex, 1);
  assert.equal(planet.orbitIndex, undefined);
  assert.equal(planet.secretLegacyField, undefined);
  assert.equal(planet.nameID, undefined);
  assert.equal(output.oldTotal, undefined);
  const point = output.celestials.find(row => row.itemID === 412000001);
  assert.equal(point.groupID, 4870);
  assert.equal(point.orbitID, 42000001);
  const stations = buildExplorationReferenceTable(world, "stations", { stations: [{ stationID: 64000001, stationName: "Old Keep" }, { stationID: 64000229, solarSystemID: 30000001 }] }).stations;
  assert.equal(stations.length, 1);
  assert.equal(stations[0].stationName, "Canonical Keep");
  assert.equal(stations[0].stationTypeID, 85226);
  assert.equal(stations[0].corporationID, 1000442);
  assert.equal(stations[0].itemID, 64000001);
  assert.deepEqual(stations[0].position, position);
  assert.deepEqual(buildExplorationReferenceTable(world, "landscapeSites", { sites: [{ itemID: 1, solarSystemID: 30000001 }] }).sites, []);
  assert.deepEqual(buildExplorationReferenceTable(world, "asteroidBelts", { belts: [{ itemID: 1, solarSystemID: 30000001 }] }).belts, []);
  const systems = buildExplorationReferenceTable(world, "solarSystems", { solarSystems: [{ solarSystemID: 30000001, name: "Old system", oldField: 1 }] }).solarSystems;
  assert.equal(systems[0].name, "Canonical 1");
  assert.equal(systems[0].oldField, undefined);
});

test("legacy profile identity is not silently repurposed as canonical content", () => {
  const world = fixture();
  const old = seal({ format: "evejs-frontier-temporary-landscape-v1", temporary: true,
    world: { revision: world.contentRevision, label: "3502403-MOD4-STUFF1" },
    contentRevisionAlgorithm: "sha256-typed-f64-v1", systems: [] });
  assert.throws(() => createTemporaryExplorationWorld(world, old), /explicitly composed/);
});
