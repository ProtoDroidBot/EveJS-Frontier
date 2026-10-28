"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const resources = require("../src/services/frontier/temporaryLandscapeResources");
const carriers = { 91374: 77800, 91375: 77810, 91376: 78426, 91377: 77811,
  91378: 78446, 91379: 78447, 91380: 78448, 91381: 78449 };
function resolveType(typeID) {
  return carriers[typeID] ? { typeID, name: `Native ${typeID}`, dogma: { dogmaAttributes: [{ attributeID: 6070, value: carriers[typeID] }] } } : null;
}
function options(count = 100) {
  return { site: { itemID: 1234, temporaryLandscapeProfile: true, temporaryLandscapeRevision: "a".repeat(64), featureTags: ["belt", "rocky"] },
    ecosystem: { spawnEnabled: 1 }, resolveType,
    locators: Array.from({ length: count }, (_, index) => ({ typeID: 91211, dungeonID: 44, roomID: 55, objectID: index + 1,
      patternKind: "natural", occurrenceIndex: 0, positionOffset: { x: index * 1000.25, y: -123, z: 500 } })) };
}

test("native locator scaling has exact plateau, interpolation and high cap", () => {
  for (const [total, expected] of [[0, 0], [1, 1], [3, 3], [4, 4], [10, 4], [82, 4], [83, 5], [155, 6], [299, 7], [300, 8], [1000, 8]]) {
    assert.equal(resources.getTemporaryLocatorLimits(["rocky"], total).resource, expected);
  }
  assert.deepEqual(resources.getTemporaryLocatorLimits(["trojan"], 300), { resource: 6, event: 1, threat: 1, npc: 1 });
  assert.deepEqual(resources.getTemporaryLocatorLimits(["icy", "trojan"], 300), { resource: 8, event: 2, threat: 2, npc: 1 });
});

test("native eligible carriers use tag rule precedence and exact target yield dogma", () => {
  assert.deepEqual(resources.getTemporaryResourceCarrierTypes(["belt", "rocky"]), [91374, 91375, 91376]);
  assert.deepEqual(resources.getTemporaryResourceCarrierTypes(["belt", "icy", "rocky"]), [91377, 91378, 91379, 91380, 91381]);
  assert.deepEqual(resources.getTemporaryResourceCarrierTypes(["trojan"]), [91374, 91375, 91376, 91379, 91380, 91381]);
  assert.deepEqual(resources.getTemporaryResourceCarrierTypes([]), [91374, 91375, 91376]);
  const result = resources.buildTemporaryLandscapeResourceAllocation(options());
  for (const entry of result.resources) assert.equal(entry.miningYieldTypeID, carriers[entry.typeID]);
});

test("composite mass parameters match native constants and contextual modifiers", () => {
  const neutral = resources.nativeCompositeMassParameters([], 50000);
  assert.equal(neutral.muLog, Math.log(29947)); assert.equal(neutral.sigmaLog, 0.63);
  const modified = resources.nativeCompositeMassParameters(["rocky"], 50000,
    { migrationCategory: "hot_jupiter", al26DoseBucket: "high", cosmicRayExposure: 1 });
  assert.ok(Math.abs(modified.muLog - (Math.log(29947) - 0.4)) < 1e-12);
  assert.equal(modified.sigmaLog, 0.85);
  assert.throws(() => resources.nativeCompositeMassParameters([], NaN), /Invalid/);
});

test("allocation conserves bounded stock and transformed positions with input-order independence", () => {
  const input = options(), result = resources.buildTemporaryLandscapeResourceAllocation(input);
  assert.equal(result.resources.length, 5);
  assert.equal(result.diagnostics.totalOreUnits, 24000);
  assert.equal(result.revision, resources.RESOURCE_POLICY_REVISION);
  for (const entry of result.resources) {
    const locator = input.locators.find(row => row.objectID === entry.sourceObjectID);
    assert.deepEqual(entry.positionOffset, locator.positionOffset);
    assert.ok(entry.radius >= 25 && entry.radius <= 150);
    assert.equal(entry.activation, "entry"); assert.equal(entry.miningYieldKind, "ore");
    assert.ok(Number.isSafeInteger(entry.resourceQuantity) && entry.resourceQuantity > 0);
  }
  assert.deepEqual(resources.buildTemporaryLandscapeResourceAllocation({ ...input, locators: [...input.locators].reverse() }), result);
  assert.equal(Object.hasOwn(input.locators[0], "resourceQuantity"), false);
});

test("identity and stock change with profile or policy while partial catalogs fail closed", () => {
  const input = options(), a = resources.buildTemporaryLandscapeResourceAllocation(input);
  const b = resources.buildTemporaryLandscapeResourceAllocation({ ...input, profileRevision: "b".repeat(64) });
  assert.notDeepEqual(a.resources, b.resources);
  const changed = resources.buildTemporaryLandscapeResourceAllocation({ ...input, policy: { totalOreUnitsPerSite: 3 } });
  assert.notEqual(changed.revision, a.revision); assert.equal(changed.resources.length, 3);
  assert.equal(changed.diagnostics.totalOreUnits, 3);
  const missing = resources.buildTemporaryLandscapeResourceAllocation({ ...input, resolveType: id => id === 91375 ? null : resolveType(id) });
  assert.equal(missing.resources.length, 0); assert.equal(missing.diagnostics.skipped[0].typeID, 91375);
});

test("legacy, disabled, zero-stock and locator-less sites allocate nothing; malformed inputs fail", () => {
  const input = options();
  for (const change of [{ site: { itemID: 1234 } }, { ecosystem: { spawnEnabled: 0 } }, { policy: { totalOreUnitsPerSite: 0 } }, { locators: [] }]) {
    assert.equal(resources.buildTemporaryLandscapeResourceAllocation({ ...input, ...change }).resources.length, 0);
  }
  assert.throws(() => resources.buildTemporaryLandscapeResourceAllocation({ ...input, profileRevision: "unversioned" }), /profile revision/);
  assert.throws(() => resources.buildTemporaryLandscapeResourceAllocation({ ...input, policy: { totalOreUnitsPerSite: 1000001 } }), /bounded/);
  assert.throws(() => resources.buildTemporaryLandscapeResourceAllocation({ ...input, locators: [input.locators[0], input.locators[0]] }), /Duplicate/);
  assert.throws(() => resources.buildTemporaryLandscapeResourceAllocation({ ...input, locators: [{ ...input.locators[0], positionOffset: { x: NaN, y: 0, z: 0 } }] }), /finite/);
});
