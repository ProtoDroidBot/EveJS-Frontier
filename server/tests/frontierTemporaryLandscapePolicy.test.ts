"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { compileNativeLandscapeTriggers, buildTemporaryLandscapePolicy } = require("../src/services/frontier/temporaryLandscapePolicy");
const { buildLandscapeScenePlan } = require("../src/space/frontierLandscapeScenePlan");
const { TEMPORARY_LANDSCAPE_POLICY_REVISION } = require("../src/services/frontier/temporaryLandscapePolicyVersion");

const position = { x: 30000, y: 1200, z: -3000 };
const site = { itemID: 90000001, solarSystemID: 30000001, temporaryLandscapeRevision: "a".repeat(64), featureTags: ["rocky", "belt"] };
const ecosystem = { temporaryLandscapeProfile: true, spawnEnabled: 1, entryPattern: { blocksModules: 0 },
  naturalWorldPatterns: [], brokenWorldPatterns: [] };
const carriers = new Map([[91374, 77800], [91375, 77810], [91376, 78426]]);
function resolveType(typeID) {
  if (carriers.has(typeID)) return { typeID, categoryID: 25, groupID: 4771,
    dogma: { dogmaAttributes: [{ attributeID: 6070, value: carriers.get(typeID) }] } };
  if ([77800, 77810, 78426].includes(typeID)) return { typeID, volume: 1, mass: 1 };
  if ([83566, 94167].includes(typeID)) return { typeID, groupID: typeID === 83566 ? 5081 : 5130, categoryID: 11 };
  return { typeID, groupID: 306, categoryID: 11 }; // A category-11 container is not an NPC.
}
function object(objectID, typeID, role = "scenery") {
  return { objectID, typeID, role, roomID: 5, dungeonID: 100, occurrenceIndex: 0, patternKind: "natural",
    position: { ...position }, positionOffset: { ...position } };
}

test("temporary policies allocate bounded finite resources and link mining encounters to their exact allocations", () => {
  const objects = [object(1, 91211, "resourceLocator"), object(2, 91212, "eventLocator"),
    object(3, 91213, "threatLocator"), object(4, 91214, "npcLocator")];
  const inputs = { site, ecosystem, sources: [], objects, locators: objects, resolveType };
  const policy = buildTemporaryLandscapePolicy(inputs);
  assert.deepEqual(policy, buildTemporaryLandscapePolicy(inputs));
  assert.equal(policy.revision, TEMPORARY_LANDSCAPE_POLICY_REVISION);
  assert.equal(policy.resources.length, 1);
  assert.equal(policy.resources[0].resourceQuantity, 24000);
  assert.deepEqual(policy.resources[0].positionOffset, position);
  assert.equal(policy.npcs.length, 3);
  assert.deepEqual(policy.triggers.find(row => row.event === "mined").sourceKeys, [policy.resources[0].key]);
  assert.equal(policy.triggers.find(row => row.event === "proximity").rangeMeters, 75000);
  assert.equal(policy.moduleBlocking, false);
});

test("wild patterns materialize and verified NPC actors are excluded from scenery without hiding containers", () => {
  const dungeon = { dungeonID: 100, temporaryLandscapeProfile: true,
    rooms: [{ roomID: 5, position: { x: 0, y: 0, z: 0 }, objects: [object(1, 83566), object(2, 1000)] }] };
  const eco = { ...ecosystem, minWildWorldPatterns: 1, maxWildWorldPatterns: 1,
    wildWorldPatterns: [{ dungeonID: 100, minOccurrences: 1, maxOccurrences: 1, weight: 1 }] };
  const plan = buildLandscapeScenePlan(site, eco, id => id === 100 ? dungeon : null, { resolveType });
  assert.equal(plan.selectedPatterns[0].patternKind, "wild");
  assert.equal(plan.temporaryPolicy.npcs.length, 1);
  assert.ok(!plan.environmentProps.some(prop => prop.typeID === 83566));
  assert.ok(plan.environmentProps.some(prop => prop.typeID === 1000));
});

test("native spawn bindings defer only explicit trigger targets and never interpret unsupported actions as spawns", () => {
  const sources = [{ patternKind: "natural", dungeonID: 100, occurrenceIndex: 0,
    dungeon: { triggers: [
      { triggerID: 1, triggerTypeID: 8, usageChance: 50, eventDelay: 2,
        triggerEvents: [{ eventID: 7, eventTypeID: 2, entityID: 88, eventDelay: 3, usageChance: 50 }] },
      { triggerID: 2, triggerTypeID: 999, triggerEvents: [{ eventID: 8, eventTypeID: 2, entityID: 88 }] },
      { triggerID: 3, triggerTypeID: 8, triggerEvents: [{ eventID: 9, eventTypeID: 24 }] },
    ] } }];
  const target: any = { key: "npc1", sourceKey: "natural:100:0", sourceObjectID: 1, sourceEntityID: 88, triggerSpawn: true };
  const compiled = compileNativeLandscapeTriggers(sources, [object(1, 83566)], [target]);
  assert.equal(compiled.triggers.length, 1);
  assert.deepEqual(compiled.triggers[0].targets, ["npc1"]);
  assert.equal(compiled.triggers[0].chance, 0.25);
  assert.equal(compiled.triggers[0].delayMs, 5000);
  assert.equal(target.activation, "trigger");
  assert.deepEqual(compiled.diagnostics.map(row => row.code), ["UNSUPPORTED_NATIVE_TRIGGER", "UNSUPPORTED_NATIVE_ACTION"]);
});

test("room mined-out requires all resources from that occurrence, not unrelated NPC deaths", () => {
  const sources = [{ patternKind: "natural", dungeonID: 100, occurrenceIndex: 0,
    dungeon: { triggers: [{ triggerID: 1, triggerTypeID: 9, triggerEvents: [{ eventID: 1, eventTypeID: 2, entityID: 88 }] }] } }];
  const allocations = [
    { key: "ore1", sourceKey: "natural:100:0", miningYieldTypeID: 77800 },
    { key: "ore2", sourceKey: "natural:100:0", miningYieldTypeID: 77800 },
    { key: "unrelated", sourceKey: "natural:100:1", miningYieldTypeID: 77800 },
    { key: "npc", sourceKey: "natural:100:0", sourceEntityID: 88 },
  ];
  const compiled = compileNativeLandscapeTriggers(sources, [], allocations);
  assert.equal(compiled.triggers[0].event, "group-cleared");
  assert.deepEqual(compiled.triggers[0].sourceKeys, ["ore1", "ore2"]);
});

test("disabled ecosystems allocate nothing and authored salvage retains its yield and finite stock", () => {
  const locator = object(1, 91211, "resourceLocator");
  const disabled = buildTemporaryLandscapePolicy({ site, ecosystem: { ...ecosystem, spawnEnabled: 0 }, sources: [],
    objects: [locator], locators: [locator], resolveType });
  assert.equal(disabled.resources.length, 0); assert.equal(disabled.npcs.length, 0);
  const resourceProps = [{ key: "authored-salvage", dunObjectID: 17, typeID: 1000,
    miningYieldTypeID: 77800, resourceQuantity: 42, positionOffset: position }];
  const policy = buildTemporaryLandscapePolicy({ site, ecosystem, sources: [], objects: [], locators: [], resolveType, resourceProps });
  assert.equal(policy.resources[0].miningYieldKind, "salvage");
  assert.equal(policy.resources[0].resourceQuantity, 42);
  assert.equal(policy.resources[0].preserveMiningVisualPresentation, true);
});
