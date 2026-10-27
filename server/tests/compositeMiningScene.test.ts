"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const sceneApi = require("../src/space/compositeMiningScene");
const destiny = require("../src/space/destiny");
const payloads = require("../src/space/destiny/stream/statePayloads");
const compatibility = require("../src/space/destiny/stream/statePayloadCompatibility");

function fragment(overrides = {}) {
  return { itemID: 8_800_000_000, systemID: 30000001, asteroidID: 4_000_000_001,
    worldRevision: "test-world", typeID: 77800, quantity: 24, oreUnits: 24,
    position: { x: 1000, y: 20, z: -50 }, sourceCellIndices: [3, 7],
    status: "available", scopeMetadata: { riftInstanceID: 42, riftSiteID: 43 }, ...overrides };
}

function fakeScene() {
  const calls = [];
  const scene = {
    systemID: 30000001, dynamicEntities: new Map(), calls,
    spawnDynamicEntity(entity, options) {
      this.dynamicEntities.set(entity.itemID, entity);
      calls.push(["spawn", entity.itemID, options]);
      return { success: true, data: { entity } };
    },
    unregisterDynamicEntity(entity, options) {
      this.dynamicEntities.delete(entity.itemID);
      calls.push(["remove", entity.itemID, options]);
    },
    reconcileEntityPublicGrid(entity) { calls.push(["grid", entity.itemID]); },
    reconcileEntityBubble(entity) { calls.push(["bubble", entity.itemID]); },
    getMovementStamp() { return 55; },
    broadcastMovementUpdates(updates) { calls.push(["movement", updates]); },
  };
  return scene;
}

test("target catalog preserves real composite and regolith component identities", () => {
  assert.deepEqual([sceneApi.resolveTargetType(95899).groupID, sceneApi.resolveTargetType(95899).categoryID], [5012, 25]);
  assert.equal(sceneApi.resolveTargetType(95899).compositeAsteroid, true);
  assert.equal(sceneApi.resolveTargetType(77800).groupID, 5148);
  assert.equal(sceneApi.resolveTargetType(77800).regolithBlock, true);
  assert.equal(sceneApi.resolveTargetType(77800).scoopAccessPolicy, "public");
  assert.equal(sceneApi.resolveTargetType(34), null);
  assert.equal(sceneApi.SCOOP_RANGE_METERS, 2500);
});

test("legacy yield identity selects an actual composite type without remapping unknown ores", () => {
  const entity = { itemID: 123, kind: "asteroid", slimTypeID: 91374, miningYieldTypeID: 77800 };
  const presentation = sceneApi.resolveCompositePresentation(entity);
  assert.equal(presentation.typeID, 95899);
  assert.equal(presentation.fragmentTypeID, 77800);
  assert.equal(presentation.material, "feldspar");
  assert.equal(sceneApi.applyCompositePresentation(entity, { radius: 240 }, presentation), true);
  assert.equal(entity["slimTypeID"], 95899);
  assert.equal(entity["radius"], 240);
  assert.equal(sceneApi.resolveCompositePresentation({ miningYieldTypeID: 34 }), null);
  assert.equal(sceneApi.resolveCompositePresentation({ miningYieldTypeID: 77810 }).material, "ptpd");
  assert.equal(sceneApi.resolveCompositePresentation({ miningYieldTypeID: 78426 }).material, "iridosmine");
  assert.equal(sceneApi.resolveCompositePresentation({ miningYieldTypeID: 78448 }).material, "aromatic");
  assert.equal(sceneApi.resolveCompositePresentation({ miningYieldTypeID: 78449 }).material, "tholin");
  assert.equal(sceneApi.resolveCompositePresentation({ miningYieldTypeID: 77800, miningYieldKind: "gas" }), null);
  const rotated: any = { miningYieldTypeID: 77800, dunRotation: [90, 0, 0] };
  sceneApi.applyCompositePresentation(rotated, { radius: 100 }, presentation);
  assert.deepEqual(rotated.dunRotation, [0, 0, 0]);
  assert.deepEqual(rotated.orientation, { w: 1, x: 0, y: 0, z: 0 });
  assert.deepEqual(rotated.orientation, rotated.collisionQuaternion);
});

test("regolith scene restore preserves ore amount, exact type, scope and idempotence", () => {
  const scene = fakeScene();
  const result = sceneApi.restoreRegolith(scene, [fragment()], { broadcast: false });
  assert.equal(result.success, true);
  const entity = scene.dynamicEntities.get(8_800_000_000);
  assert.equal(entity.kind, "regolith");
  assert.equal(entity.typeID, 77800);
  assert.equal(entity.oreUnits, 24);
  assert.equal(entity.riftInstanceID, 42);
  assert.equal(entity.riftSiteID, 43);
  assert.deepEqual(entity.position, fragment().position);
  assert.equal(scene.calls[0][2].broadcast, false);
  assert.equal(sceneApi.spawnRegolith(scene, fragment()).alreadyPresent, true);
  assert.equal(scene.calls.length, 1);
  assert.equal(sceneApi.buildRegolithEntity(fragment({ typeID: 34 })), null);
  assert.equal(sceneApi.buildRegolithEntity(fragment({ oreUnits: 2.5 })), null);
  assert.equal(sceneApi.buildRegolithEntity(fragment({ quantity: 1 })), null);
  assert.equal(sceneApi.buildRegolithEntity(fragment({ status: "consumed" })), null);
  assert.equal(sceneApi.spawnRegolith(scene, fragment({ systemID: 30000002 })).success, false);
});

test("scoop movement updates existing ball position and velocity before removal", () => {
  const scene = fakeScene();
  const entity = sceneApi.spawnRegolith(scene, fragment()).data.entity;
  const position = { x: 1200, y: 0, z: 0 };
  const velocity = { x: -1000, y: 0, z: 0 };
  assert.equal(sceneApi.moveRegolith(scene, entity, position, velocity, { nowMs: 1000 }), true);
  assert.deepEqual(entity.position, position);
  assert.deepEqual(entity.velocity, velocity);
  const updates = scene.calls.find((entry) => entry[0] === "movement")[1];
  assert.equal(updates[0].stamp, 55);
  assert.equal(updates[0].payload[0], "SetBallPosition");
  assert.equal(updates[1].payload[0], "SetBallVelocity");
  assert.equal(sceneApi.removeRegolith(scene, entity.itemID), true);
  assert.equal(scene.dynamicEntities.size, 0);
  assert.equal(scene.calls.at(-1)[2].persistSpaceState, false);
  assert.equal(sceneApi.moveRegolith(scene, entity, position, velocity), false);
});

test("authoritative collision cubes leave carved holes and clear the legacy shell", () => {
  const { findWeaponLineOccluder } = require("../src/space/destiny/simulation/collisions");
  const { appendMiniGeometrySections } = require("../src/space/destiny/stream/staticBallTail");
  const asteroid: any = { itemID: 2001, kind: "asteroid", position: { x: 0, y: 0, z: 0 },
    radius: 40, collisionID: 123, collisionScale: 9, destinyCollisionTail: Buffer.from([1]),
    miniBalls: [{ center: { x: 0, y: 0, z: 0 }, radius: 40 }] };
  const model = { spacing: 10, radius: 40, recipeHash: "two-cubes", grid: [
    { index: 0, x: 0, y: 0, z: 0 }, { index: 1, x: 0, y: 2, z: 0 },
  ] };
  const source = { itemID: 1, kind: "ship", position: { x: -100, y: 0, z: 0 }, radius: 1 };
  const target = { itemID: 2, kind: "ship", position: { x: 100, y: 0, z: 0 }, radius: 1 };
  const scene = { staticEntities: [asteroid], dynamicEntities: new Map() };
  assert.equal(sceneApi.applyCompositeMinedState(asteroid, model, []), true);
  assert.equal(asteroid.collisionID, -1);
  assert.equal(asteroid.collisionScale, 1);
  assert.equal(asteroid.destinyCollisionTail, undefined);
  assert.equal(asteroid.miniBalls, undefined);
  assert.equal(asteroid.miniBoxes.length, 2);
  const chunks = [];
  appendMiniGeometrySections(chunks, asteroid);
  const encoded = Buffer.concat(chunks);
  assert.equal(encoded.readUInt16LE(0), 2);
  assert.equal(encoded.length, 2 + 2 * 12 * 8);
  assert.equal(encoded.readDoubleLE(2), -5);
  assert.equal(encoded.readDoubleLE(2 + 3 * 8), 10);
  assert.equal(findWeaponLineOccluder(scene, source, target).entity.itemID, 2001);
  assert.equal(sceneApi.applyCompositeMinedState(asteroid, model, [0]), true);
  assert.equal(asteroid.miniBoxes.length, 1);
  assert.equal(findWeaponLineOccluder(scene, source, target), null);
  const revision = asteroid.compositeCollisionRevision;
  sceneApi.applyCompositeMinedState(asteroid, model, [0]);
  assert.equal(asteroid.compositeCollisionRevision, revision);
  assert.equal(sceneApi.applyCompositeMinedState(asteroid, model, [0, 1]), true);
  assert.equal(asteroid.collisionEnabled, false);
  assert.equal(findWeaponLineOccluder(scene, source, target), null);
});

test("coalesced collision runs split at mined holes without blocking the gap", () => {
  const { findWeaponLineOccluder } = require("../src/space/destiny/simulation/collisions");
  const asteroid: any = { itemID: 2001, kind: "asteroid", position: { x: 0, y: 0, z: 0 }, radius: 40 };
  // Deliberately unordered: client cell indices need not follow collision runs.
  const model = { spacing: 10, radius: 40, recipeHash: "three-cubes", grid: [
    { index: 0, x: 1, y: 0, z: 0 }, { index: 1, x: -1, y: 0, z: 0 },
    { index: 2, x: 0, y: 0, z: 0 },
  ] };
  const source = { itemID: 1, kind: "ship", position: { x: 0, y: -100, z: 0 }, radius: 1 };
  const target = { itemID: 2, kind: "ship", position: { x: 0, y: 100, z: 0 }, radius: 1 };
  const scene = { staticEntities: [asteroid], dynamicEntities: new Map() };
  sceneApi.applyCompositeMinedState(asteroid, model, []);
  assert.equal(asteroid.miniBoxes.length, 1);
  assert.equal(asteroid.miniBoxes[0].corner.x, -15);
  assert.equal(asteroid.miniBoxes[0].localX.x, 30);
  assert.equal(findWeaponLineOccluder(scene, source, target).entity.itemID, 2001);
  sceneApi.applyCompositeMinedState(asteroid, model, [2]);
  assert.equal(asteroid.miniBoxes.length, 2);
  assert.equal(findWeaponLineOccluder(scene, source, target), null);
  // The exact edge of the surviving right cube still blocks the ray.
  source.position.x = 5;
  target.position.x = 5;
  assert.equal(findWeaponLineOccluder(scene, source, target).entity.itemID, 2001);
  assert.deepEqual(model.grid.map((cell) => cell.index), [0, 1, 2]);
});

test("all actual client templates retain exact voxel occupancy and bounds after coalescing", () => {
  const { createCompositeModel } = require("../src/services/mining/compositeAsteroidModel");
  const templates = require("../src/services/mining/compositeTemplates3640684.json").templates;
  for (let templateIndex = 0; templateIndex < templates.length; templateIndex += 1) {
    const model = createCompositeModel({ itemID: 2001, typeID: 95899, yieldTypeID: 77800,
      material: "feldspar", radius: 210, templateIndex });
    for (const mined of [new Set(), new Set(model.grid.filter((cell) => cell.index % 7 === 0).map((cell) => cell.index))]) {
      const asteroid: any = {};
      assert.equal(sceneApi.applyCompositeMinedState(asteroid, model, mined), true);
      if (!mined.size) assert.ok(asteroid.miniBoxes.length <= 150, `template ${templateIndex} should coalesce`);
      const coverage = new Set();
      for (const [index, box] of asteroid.collisionProfile.boxes.entries()) {
        const wire = asteroid.miniBoxes[index];
        assert.deepEqual(wire, { corner: box.corner, localX: box.edgeX, localY: box.edgeY, localZ: box.edgeZ });
        const limits = {};
        for (const axis of ["x", "y", "z"]) {
          const edge = box[`edge${axis.toUpperCase()}`][axis];
          const lo = box.corner[axis] / model.spacing + 0.5;
          const hi = (box.corner[axis] + edge) / model.spacing - 0.5;
          assert.ok(Math.abs(lo - Math.round(lo)) < 1e-10);
          assert.ok(Math.abs(hi - Math.round(hi)) < 1e-10);
          limits[axis] = [Math.round(lo), Math.round(hi)];
        }
        // Enumerate each exact lattice cube represented by the merged box.
        // Duplicate coverage would reveal overlaps; unexpected cells reveal
        // an approximation across a gap or beyond the original boundary.
        for (let x = limits["x"][0]; x <= limits["x"][1]; x += 1) {
          for (let y = limits["y"][0]; y <= limits["y"][1]; y += 1) {
            for (let z = limits["z"][0]; z <= limits["z"][1]; z += 1) {
              const key = `${x},${y},${z}`;
              assert.equal(coverage.has(key), false);
              coverage.add(key);
              assert.ok(Math.hypot((Math.abs(x) + 0.5) * model.spacing,
                (Math.abs(y) + 0.5) * model.spacing, (Math.abs(z) + 0.5) * model.spacing) <= model.radius + 1e-10);
            }
          }
        }
      }
      const expected = new Set(model.grid.filter((cell) => !mined.has(cell.index))
        .map((cell) => `${cell.x},${cell.y},${cell.z}`));
      assert.deepEqual(coverage, expected);
    }
  }
});

test("initial, late-join and incremental CRData carry integer oreUnits without container fields", () => {
  const entity = sceneApi.buildRegolithEntity(fragment());
  const dict = destiny.buildSlimItemDict(entity);
  const wire = compatibility.normalizeCrDataDictionaryForProfile(dict, entity, "frontier");
  assert.equal(new Map(wire.entries).get("oreUnits"), 24);
  assert.equal(new Map(wire.entries).get("typeID"), 77800);
  for (const key of ["lootRights", "isEmpty", "corpID", "groupID", "categoryID"]) {
    assert.equal(new Map(wire.entries).has(key), false);
  }
  const deps = { compatibilityProfile: "frontier", buildSlimItemDict: destiny.buildSlimItemDict,
    encodeEntityBall: () => Buffer.alloc(0), buildDroneState: () => null, buildSolItem: () => null };
  const extra = payloads.buildAddBallsExtraBallData([entity], 0n, deps);
  assert.equal(extra[0][0], entity.itemID);
  assert.equal(new Map(extra[0][1].entries).get("oreUnits"), 24);
  const setState = payloads.buildSetStatePayload(55, { systemID: 30000001 }, 99, [entity], 0n, [], [], deps);
  const state = setState[1][0];
  const stateFields = new Map(state.args.entries);
  const crdata = stateFields.get("crdata") as any;
  assert.equal(new Map(crdata.entries[0][1].entries).get("oreUnits"), 24);
  const update = destiny.buildCrDataUpdate(entity, "frontier");
  assert.equal(new Map(update.entries).get("oreUnits"), 24);
  assert.equal(new Map(update.entries).has("itemID"), false);
  assert.throws(() => destiny.buildSlimItemDict({ ...entity, oreUnits: 1.5 }), /positive safe integer/);
});


test("configured grade mappings require verified target regolith and valid substrate values", () => {
  const policy = { materialsByTypeID: { 95912: { material: "ptpd", density: 8, porosity: 0.25, toughness: 2, gateTier: 3 } } };
  const mapped = sceneApi.resolveCompositePresentation({ typeID: 95899 }, { yieldKind: "ore", yieldTypeID: 95912 }, policy);
  assert.equal(mapped.fragmentTypeID, 95912); assert.equal(mapped.substrate.effectiveDensity, 6);
  assert.equal(sceneApi.resolveCompositePresentation({ typeID: 95899 }, { yieldKind: "ore", yieldTypeID: 95912 }), null);
  assert.throws(() => sceneApi.resolveCompositePresentation({}, { yieldTypeID: 95912 }, { materialsByTypeID: { 95912: { ...policy.materialsByTypeID[95912], porosity: 1 } } }), /INVALID_VOXEL_SUBSTRATE_POLICY/);
});

test("mined collision refresh uses native replacement authority and requests reconciliation", () => {
  const calls = [], entity = { itemID: 9, compositeAsteroid: true };
  const scene = { broadcastAddBalls: (...args) => calls.push(args), requestFinalSceneVisibilityReconciliation: () => calls.push("reconcile") };
  assert.equal(sceneApi.refreshCompositeCollision(scene, entity, 10), true);
  assert.deepEqual(calls, [[[entity], null, { replaceExisting: true }], "reconcile"]);
});
