"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const {
  createExplorationWorld, loadExplorationWorld, calculateExplorationWorldRevision, createTemporaryExplorationWorld,
} = require("../src/services/frontier/explorationWorld");

function seal(world) {
  world.contentRevision = calculateExplorationWorldRevision(world);
  return world;
}

function fixture() {
  const position = { x: 1e10, y: -2e10, z: 0.25 };
  return seal({
    format: "evejs-frontier-exploration-world-v1", targetBuild: 3640684,
    source: { build: 3502403, label: "3502403-MOD4-STUFF1", kind: "legacy-client-geography" },
    contentRevisionAlgorithm: "sha256-typed-f64-v1",
    regions: [{ id: 10000001, center: { x: 9.123456789012346e18, y: 3e18, z: -2e18 }, name: "Legacy région" }],
    constellations: [{ id: 20000001, regionId: 10000001, center: { x: 8e18, y: 3e18, z: -1e18 } }],
    systems: [30000002, 30000001].map((id, index) => ({
      id, name: `Legacy ${id}`, regionId: 10000001, constellationId: 20000001,
      center: { x: id * 1e12, y: -4e18, z: 0.125 }, neighbours: [id === 30000001 ? 30000002 : 30000001],
      sun: { id: 40000001 + index, typeId: 45031, position, radiusM: 1e8 },
      planets: [{ id: 40000011 + index, typeId: 2016, position, radiusM: 6e6,
        hostCelestialId: 40000001 + index,
        moons: [{ id: 40000021 + index, typeId: 14, position }],
        lagrangePoints: [{ id: 40000031 + index, typeId: 88163, position }],
      }],
      stargates: [{ id: 50000001 + index, typeId: 79787, position,
        destinationSystemId: id === 30000001 ? 30000002 : 30000001,
        destinationGateId: index === 0 ? 50000002 : 50000001,
        planetId: 40000011 + index, lagrangePointId: 40000031 + index,
      }],
    })),
    starterSystemIds: [30000001],
  });
}

test("revision matches Python typed-f64 golden vector and binds exact numeric values", () => {
  const vector = { contentRevisionAlgorithm: "sha256-typed-f64-v1", numbers: [1, 1.0, -0.0, 1e-9, 1.23e22],
    unicode: "é🚀", flags: [null, false, true] };
  assert.equal(calculateExplorationWorldRevision(vector), "b573d6d05c9841f34916f484501ceb28d904255aa9dac08121a0e14e44c1b40e");
  assert.equal(calculateExplorationWorldRevision({ ...vector, contentRevision: "ignored-at-root" }), calculateExplorationWorldRevision(vector));
  assert.notEqual(calculateExplorationWorldRevision({ ...vector, numbers: [1, 1, 0, 1e-9, 1.23e22] }), calculateExplorationWorldRevision(vector));
  assert.notEqual(calculateExplorationWorldRevision({ x: { contentRevision: "one" } }), calculateExplorationWorldRevision({ x: { contentRevision: "two" } }));
  assert.throws(() => calculateExplorationWorldRevision({ x: Infinity }), /nonfinite/);
  assert.throws(() => calculateExplorationWorldRevision({ x: "\ud800" }), /surrogate/);
});

test("explicit legacy artifact returns matching bundle identity, parent records and conservative detail", () => {
  const raw = fixture();
  const world = createExplorationWorld(raw);
  assert.equal(world.revision, raw.contentRevision);
  assert.equal(world.versionString, `1.0.0+${world.version.build_tags.join(".")}`);
  assert.deepEqual(world.starterSystemIds, [30000001]);
  const summary = world.makeDelta([30000002, 30000001], false, 9);
  assert.equal(summary.complete, false);
  assert.equal(summary.schemaVersion, 14);
  assert.equal(summary.sequence, 9);
  assert.equal(summary.bundleVersion, world.versionString);
  assert.deepEqual(summary.systems.map(row => row.id), [30000001, 30000002]);
  assert.deepEqual(summary.regions.map(row => row.id), [10000001]);
  assert.deepEqual(summary.constellations.map(row => row.id), [20000001]);
  assert.equal(summary.systems[0].revealLevel, 0);
  assert.equal(summary.systems[0].sun, undefined);
  assert.equal(summary.systems[0].planets, undefined);
  assert.equal(summary.systems[0].stargates, undefined);
  assert.deepEqual(summary.systems[0].center, raw.systems[1].center);
  const detail = world.makeDelta([30000001], true, 10).systems[0];
  assert.equal(detail.revealLevel, 1);
  assert.equal(detail.sun.id, 40000002);
  assert.deepEqual(detail.sun.position, { x: 1e10, y: -2e10, z: 0.25 });
  assert.equal(detail.planets[0].lagrangePoints[0].pointIndex, undefined);
  assert.deepEqual([detail.celestialScopeFull, detail.lagrangeScopeFull, detail.oreScopeFull], [false, false, false]);
  assert.deepEqual(detail.exploredCelestialIds, [40000002, 40000012, 40000022, 50000002]);
  assert.deepEqual(detail.exploredLagrangeIds, [40000032]);
  assert.deepEqual(detail.exploredOreSiteIds, []);
  assert.equal(detail.asteroidBelts, undefined);
  assert.equal(detail.gabrielNeighbours, undefined);
  assert.deepEqual(world.makeDelta([], false, 0).regions, []);
  assert.throws(() => { raw.systems[0].center.x = 0; }, /read only/);
  assert.throws(() => world.makeDelta([999], false, 0), /Unknown exploration system/);
  assert.throws(() => world.makeDelta([30000001, 30000001], true, 0), /Duplicate delta/);
  assert.throws(() => world.makeDelta([30000001], true, -1), /sequence/);
});

test("rejects tampering, mismatched provenance and invalid catalog/geometry/local topology", () => {
  const changed = fixture();
  changed.systems[0].center.x++;
  // At galaxy scales a one-unit change may round away; choose a represented change.
  changed.systems[0].center.y += 4096;
  assert.throws(() => createExplorationWorld(changed), /revision mismatch/);
  const invalidCases: Array<[(raw: any) => void, RegExp]> = [
    [raw => { raw.source.label = "retail"; }, /legacy source/],
    [raw => { raw.targetBuild = 3502403; }, /target build/],
    [raw => { raw.contentRevisionAlgorithm = "sha256-json"; }, /revision algorithm/],
    [raw => { delete raw.systems[0].center; }, /center/],
    [raw => { raw.systems[0].id = Number.MAX_SAFE_INTEGER + 1; }, /safe integer/],
    [raw => { raw.systems[0].constellationId = 999; }, /hierarchy/],
    [raw => { raw.systems.push(structuredClone(raw.systems[0])); }, /duplicate ID/],
    [raw => { raw.systems[0].neighbours = [999]; }, /neighbour/],
    [raw => { delete raw.systems[0].sun.position; }, /position/],
    [raw => { raw.systems[0].sun.typeId = 0; }, /typeId/],
    [raw => { raw.systems[0].planets[0].hostCelestialId = 999; }, /host celestial/],
    [raw => { raw.systems[0].planets[0].moons[0].id = raw.systems[0].sun.id; }, /Duplicate local/],
    [raw => { raw.systems[0].stargates[0].lagrangePointId = 999; }, /local parent/],
    [raw => { raw.systems[0].stargates[0].destinationGateId = 999; }, /destination/],
    [raw => { raw.systems[0].nameID = 1; }, /schema-14 field/],
    [raw => { raw.starterSystemIds = [999]; }, /Starter system/],
  ];
  for (const [change, expected] of invalidCases) {
    const raw = fixture();
    change(raw);
    seal(raw);
    assert.throws(() => createExplorationWorld(raw), expected);
  }
});

test("loads a declared artifact from disk and verifies content before exposing it", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "evejs-exploration-world-test-"));
  try {
    const file = path.join(directory, "world.json");
    const raw = fixture();
    fs.writeFileSync(file, JSON.stringify(raw));
    const world = loadExplorationWorld(file);
    assert.equal(world.systems.size, 2);
    assert.equal(world.revision, raw.contentRevision);
    raw.systems[0].name = "tampered";
    fs.writeFileSync(file, JSON.stringify(raw));
    assert.throws(() => loadExplorationWorld(file), /revision mismatch/);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

function landscapeFixture(world) {
  const point = { x: 101, y: -202, z: 303 };
  return seal({ format: "evejs-frontier-temporary-landscape-v1", temporary: true,
    profile: "temporary-3640684-on-3502403-MOD4-STUFF1", contentRevisionAlgorithm: "sha256-typed-f64-v1",
    world: { revision: world.contentRevision, label: "3502403-MOD4-STUFF1" },
    systems: [{ id: 30000001, asteroidBelts: [{ id: 80000001, position: point,
      centerCelestialId: 40000002, innerRadiusM: 1e6, outerRadiusM: 2e6,
      clusters: [{ id: 80000002, position: point, arcMin: 0, arcMax: 1,
        sites: [{ id: 80000003, typeId: 88092, position: point, ecosystemId: 11 }] }],
    }], planets: [{ id: 40000012, trojans: [{ id: 80000004, position: point, planetId: 40000012,
      lagrangePointId: 40000032, sites: [{ id: 80000005, typeId: 88092, position: point, ecosystemId: 11 }] }] }] }],
  });
}

test("temporary landscape changes bundle identity and content without replacing selected galaxy geography", () => {
  const raw = fixture(), profile = landscapeFixture(raw), original = structuredClone(raw);
  const world = createTemporaryExplorationWorld(raw, profile);
  assert.notEqual(world.revision, original.contentRevision);
  assert.equal(world.baseRevision, original.contentRevision);
  assert.ok(world.version.build_tags.includes("temporary-3640684-landscape"));
  assert.equal(world.temporaryLandscape.revision, profile.contentRevision);
  assert.deepEqual(world.systems.get(30000001).center, original.systems[1].center);
  assert.deepEqual(world.systems.get(30000001).stargates, original.systems[1].stargates);
  assert.equal(raw.systems[1].asteroidBelts, undefined, "input artifact must stay reusable for rollback");
  const detail = world.makeDelta([30000001], true, 0).systems[0];
  assert.deepEqual(detail.exploredOreSiteIds, [80000003, 80000005]);
  assert.equal(detail.oreScopeFull, false);
  assert.equal(detail.asteroidBelts[0].typeId, undefined, "abstract geometry must not invent an item type");
  assert.equal(world.makeDelta([30000001], false, 0).systems[0].asteroidBelts, undefined);
  assert.equal(createExplorationWorld(original).revision, original.contentRevision);
});

test("temporary landscape rejects tampering, changed galaxy fields and dangling content references", () => {
  const cases: Array<[(profile: any) => void, RegExp, boolean?]> = [
    [profile => { profile.systems[0].asteroidBelts[0].clusters[0].sites[0].position.x++; }, /content revision/, false],
    [profile => { profile.world.revision = "0".repeat(64); }, /base world/],
    [profile => { profile.systems[0].center = { x: 0, y: 0, z: 0 }; }, /galaxy fields/],
    [profile => { profile.systems[0].id = 39999999; }, /unknown\/duplicate system/],
    [profile => { profile.systems[0].planets[0].id = 49999999; }, /invalid planet/],
    [profile => { profile.systems[0].asteroidBelts[0].centerCelestialId = 49999999; }, /dangling celestial/],
    [profile => { profile.systems[0].planets[0].trojans[0].lagrangePointId = 49999999; }, /dangling Lagrange/],
    [profile => { profile.systems[0].asteroidBelts[0].clusters[0].sites[0].id = 40000002; }, /Duplicate local/],
    [profile => { delete profile.systems[0].asteroidBelts[0].clusters[0].sites[0].typeId; }, /typeId/],
  ];
  for (const [mutate, expected, reseal = true] of cases) {
    const world = fixture(), profile = landscapeFixture(world); mutate(profile); if (reseal) seal(profile);
    assert.throws(() => createTemporaryExplorationWorld(world, profile), expected);
  }
});
