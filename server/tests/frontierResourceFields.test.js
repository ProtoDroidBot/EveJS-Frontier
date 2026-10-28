"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const assert = require("node:assert/strict");
const test = require("node:test");
const { FRONTIER_RESOURCE_FIELD_POLICY_VERSION, FRONTIER_SYNTHETIC_RESOURCE_FIELDS_ENABLED, buildFrontierResourceFieldDefinition, resolveFrontierResourceZone, } = require("../src/space/asteroids/frontierResourceFields");
test("Frontier Inner and Outer landscape fields use their authored asteroid rules", () => {
    const inner = buildFrontierResourceFieldDefinition({
        itemID: 900439959,
        solarSystemID: 30021998,
        featureKind: "asteroidBelt",
        featureTags: ["belt", "inner", "belt_hot"],
        ecosystemID: 4,
        ecosystemName: "Natural World - Inner Belt - Stone Cluster",
        position: { x: 10, y: 20, z: 30 },
    });
    const site = {
        itemID: 900439961,
        itemName: "Outer Vestiges",
        solarSystemID: 30021998,
        featureID: 500439960,
        featureKind: "asteroidBelt",
        featureTags: ["belt", "outer", "belt_cold"],
        ecosystemID: 7,
        ecosystemName: "Broken World - Outer Belt - Vestiges",
        position: {
            x: 85203619766.684,
            y: -2716284710.642,
            z: 12181661045.76,
        },
    };
    const first = buildFrontierResourceFieldDefinition(site);
    const second = buildFrontierResourceFieldDefinition(site);
    assert.equal(FRONTIER_SYNTHETIC_RESOURCE_FIELDS_ENABLED, true);
    assert.equal(FRONTIER_RESOURCE_FIELD_POLICY_VERSION, 2);
    assert.equal(inner.resourceZone, "inner");
    assert.equal(inner.asteroidCount, 30);
    assert.equal(inner.maxAsteroidCount, 42);
    assert.equal(inner.dungeonObjectScatterMinMeters, 18_000);
    assert.equal(inner.dungeonObjectScatterMaxMeters, 48_000);
    assert.deepEqual(inner.resourceTypeIDs, [91374, 91375, 91376]);
    assert.equal(resolveFrontierResourceZone(site), "outer");
    assert.deepEqual(first, second);
    assert.equal(first.itemID, 900439961);
    assert.equal(first.fieldStyleID, "frontier_outer_resource_field");
    assert.equal(first.asteroidCount, 34);
    assert.equal(first.maxAsteroidCount, 48);
    assert.equal(first.dungeonObjectScatterMinMeters, 22_000);
    assert.equal(first.dungeonObjectScatterMaxMeters, 58_000);
    assert.deepEqual(first.resourceTypeIDs, [91377, 91378, 91379, 91380, 91381]);
    assert.equal(first.sourceLandscapeSiteID, site.itemID);
});
test("Frontier Fringe and Trojan fields retain their distinct asteroid rules", () => {
    const fringe = buildFrontierResourceFieldDefinition({
        itemID: 900439960,
        solarSystemID: 30021998,
        featureKind: "asteroidBelt",
        featureTags: ["belt", "transitional", "belt_warm"],
        ecosystemID: 20,
        ecosystemName: "Transitional Belt - Trade Hub",
        dungeonID: 14026,
        position: { x: -1, y: -2, z: -3 },
    });
    const trojan = buildFrontierResourceFieldDefinition({
        itemID: 900439962,
        itemName: "Trojan Drifting Annex",
        solarSystemID: 30021998,
        featureID: 500439961,
        featureKind: "trojan",
        featureTags: ["trojan", "inner", "super_host"],
        ecosystemID: 13,
        position: { x: 1, y: 2, z: 3 },
    });
    assert.equal(FRONTIER_SYNTHETIC_RESOURCE_FIELDS_ENABLED, true);
    assert.equal(fringe.resourceZone, "fringe");
    assert.equal(fringe.asteroidSpawnRule, "fringe");
    assert.equal(fringe.fieldStyleID, "frontier_fringe_resource_field");
    assert.equal(fringe.asteroidCount, 32);
    assert.equal(fringe.maxAsteroidCount, 46);
    assert.deepEqual(fringe.resourceTypeIDs, [
        91374, 91375, 91376, 91377, 91378, 91379, 91380, 91381,
    ]);
    assert.equal(fringe.sourceDungeonID, 14026);
    assert.equal(trojan.resourceZone, "trojan");
    assert.equal(trojan.asteroidSpawnRule, "trojan");
    assert.equal(trojan.asteroidCount, 24);
    assert.equal(trojan.maxAsteroidCount, 36);
    assert.equal(trojan.dungeonObjectScatterMinMeters, 16_000);
    assert.equal(trojan.dungeonObjectScatterMaxMeters, 42_000);
    assert.deepEqual(trojan.resourceTypeIDs, [91374, 91375, 91376, 91379, 91380, 91381]);
    assert.equal(buildFrontierResourceFieldDefinition({
        itemID: 42,
        solarSystemID: 30021998,
        featureKind: "landmark",
        featureTags: ["inner"],
        position: { x: 1, y: 2, z: 3 },
    }), null);
});
//# sourceMappingURL=frontierResourceFields.test.js.map