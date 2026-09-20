"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const assert = require("node:assert/strict");
const test = require("node:test");
const { DEFAULT_WARP_CLEARANCE_METERS, buildLandscapeScenePlan, selectPatternOccurrences, } = require("../src/space/frontierLandscapeScenePlan");
const { FRONTIER_SALVAGE_MATERIAL_GROUP_ID, FRONTIER_SALVAGE_MAX_RESOURCE_QUANTITY, FRONTIER_SALVAGE_MIN_RESOURCE_QUANTITY, FRONTIER_SALVAGEABLE_WRECKAGE_GROUP_ID, resolveFrontierSalvageResourceProfile, } = require("../src/services/mining/frontierSalvageResources");
const { classifyMiningMaterialType, } = require("../src/services/mining/miningInventory");
const { dematerializeLandscapeSite, findLandscapeSitesWithinRange, materializeLandscapeSite, materializeNearbyLandscapeSite, _testing: landscapeSceneTesting, } = require("../src/space/frontierLandscapeSceneService");
const frontierLandscapeSpawns = require("../src/config/frontierLandscapeSpawns");
test("landscape spawn config composes disjoint NPC families into site-specific encounters", () => {
    const config = frontierLandscapeSpawns.getConfig();
    const summary = frontierLandscapeSpawns.getConfigSummary();
    assert.equal(summary.ecosystemCount, 20);
    assert.equal(summary.dungeonOverrideCount, 17);
    assert.equal(config.dungeonOverrides["13582"], undefined);
    assert.equal(summary.npcFamilyCount, 7);
    assert.equal(summary.npcProfileCount, 46);
    assert.deepEqual(config.npcFamilies.mooneater_entities.groupIDs, [4770]);
    assert.deepEqual(config.npcFamilies.feral_support.groupIDs, [759, 1764]);
    assert.deepEqual(config.npcFamilies.generative_entities.groupIDs, [4860]);
    assert.deepEqual(config.npcFamilies.constructing_battleship.groupIDs, [1814]);
    assert.deepEqual(config.npcFamilies.xeroti_tidofiza.groupIDs, [4963]);
    assert.deepEqual(config.npcFamilies.conservator.groupIDs, [5033]);
    assert.deepEqual(config.npcFamilies.allotrope.groupIDs, [5130]);
    const profiles = frontierLandscapeSpawns.getGeneratedNpcRows("npcProfiles");
    assert.equal(profiles.length, 46);
    assert.equal(profiles.find((entry) => entry.shipTypeID === 92_096)
        .frontierLandscapeExpectedGroupID, 5033);
    assert.equal(profiles.find((entry) => entry.shipTypeID === 94_167)
        .frontierLandscapeExpectedGroupID, 5130);
    const plan = frontierLandscapeSpawns.buildSpawnPlan({ itemID: 900_439_900 }, { ecosystemID: 21 }, [{ dungeonID: 13_659 }]);
    assert.equal(plan.activated, true);
    assert.ok(plan.npcs.some((entry) => entry.familyKey === "generative_entities"));
    assert.ok(plan.npcs.some((entry) => entry.familyKey === "conservator"));
    assert.ok(plan.npcs.some((entry) => entry.familyKey === "allotrope"));
    assert.equal(plan.wrecks.length, 4);
    assert.deepEqual(frontierLandscapeSpawns.buildSpawnPlan({ itemID: 900_439_900 }, { ecosystemID: 21 }, [{ dungeonID: 13_659 }]), plan);
    const pulverizedAsteroidCluster = frontierLandscapeSpawns.buildDungeonSpawnPlan(10_659);
    assert.equal(pulverizedAsteroidCluster.spawnTableID, "mooneater_site");
    assert.deepEqual(pulverizedAsteroidCluster.encounterTags, [
        "site:mining-field",
        "site:mooneater",
    ]);
    assert.ok(pulverizedAsteroidCluster.npcs.some((entry) => entry.familyKey === "mooneater_entities"));
    assert.ok(pulverizedAsteroidCluster.npcs.some((entry) => entry.familyKey === "feral_support"));
    const mooneater = frontierLandscapeSpawns.buildDungeonSpawnPlan(13_870);
    assert.equal(mooneater.spawnTableID, "mooneater_site");
    assert.ok(mooneater.npcs.some((entry) => entry.familyKey === "mooneater_entities"));
    assert.ok(mooneater.npcs.some((entry) => entry.familyKey === "feral_support"));
    assert.ok(mooneater.npcs
        .filter((entry) => entry.familyKey === "feral_support")
        .every((entry) => [83_914, 88_091, 87_536].includes(entry.typeID)));
    for (const dungeonID of [
        12_700,
        12_701,
        12_704,
        12_705,
        12_706,
        12_707,
        12_708,
        12_709,
    ]) {
        const generative = frontierLandscapeSpawns.buildDungeonSpawnPlan(dungeonID);
        assert.equal(generative.spawnTableID, "generative_site");
        assert.ok(generative.npcs.some((entry) => entry.familyKey === "generative_entities"));
        assert.ok(generative.npcs.some((entry) => entry.familyKey === "feral_support"));
    }
    const shipyard = frontierLandscapeSpawns.buildDungeonSpawnPlan(12_560);
    assert.equal(shipyard.spawnTableID, "derelict_autonomous_shipyard");
    assert.equal(shipyard.parentSpawnTableID, "generative_site");
    assert.ok(shipyard.npcs.some((entry) => entry.familyKey === "generative_entities"));
    assert.ok(shipyard.npcs.some((entry) => entry.typeID === 88_566 && entry.boss === true));
    const stackedStorage = frontierLandscapeSpawns.buildDungeonSpawnPlan(13_583);
    assert.equal(stackedStorage.spawnTableID, "xeroti_stacked_storage");
    assert.ok(stackedStorage.npcs.length >= 2);
    assert.ok(stackedStorage.npcs.every((entry) => entry.familyKey === "xeroti_tidofiza" && entry.groupID === 4963));
    const selectedOverride = frontierLandscapeSpawns.buildSpawnPlan({ itemID: 700_013_583 }, { ecosystemID: 21 }, [{ dungeonID: 13_583 }]);
    assert.equal(selectedOverride.spawnTableID, "xeroti_stacked_storage");
    assert.ok(selectedOverride.npcs.every((entry) => entry.familyKey === "xeroti_tidofiza"));
});
test("configured landscape NPCs spawn at deterministic offsets", () => {
    const plan = frontierLandscapeSpawns.buildSpawnPlan({ itemID: 900_439_900 }, { ecosystemID: 21 }, [{ dungeonID: 13_659 }]);
    const calls = [];
    const result = landscapeSceneTesting.spawnConfiguredLandscapeNpcs({ systemID: 30_000_001 }, {
        itemID: 900_439_900,
        position: { x: 1_000_000, y: 2_000_000, z: 3_000_000 },
    }, plan, {
        npcService: {
            spawnNpcBatchInSystem(systemID, options) {
                calls.push({ systemID, options });
                return {
                    success: true,
                    data: { spawned: [{ entity: { itemID: 980_000_000_000 + calls.length } }] },
                };
            },
        },
    });
    assert.equal(calls.length, plan.npcs.length);
    assert.equal(result.entityIDs.length, plan.npcs.length);
    assert.deepEqual(result.failures, []);
    assert.equal(calls[0].options.profileQuery, plan.npcs[0].profileID);
    assert.equal(calls[0].options.runtimeKind, "frontierLandscape");
    assert.equal(calls[0].options.npcIdentitySlot, "landscape:30000001:900439900:entry:0");
    assert.equal(new Set(calls.map((call) => call.options.npcIdentitySlot)).size, calls.length);
    assert.deepEqual(calls[0].options.spawnStateOverride.position, {
        x: 1_000_000 + plan.npcs[0].positionOffset.x,
        y: 2_000_000 + plan.npcs[0].positionOffset.y,
        z: 3_000_000 + plan.npcs[0].positionOffset.z,
    });
});
test("landscape NPC pilot slots survive re-materialization and separate sites and systems", () => {
    const slots = [];
    const options = {
        npcService: {
            spawnNpcBatchInSystem(_systemID, spawnOptions) {
                slots.push(spawnOptions.npcIdentitySlot);
                return { success: true, data: { spawned: [{ entity: { itemID: slots.length } }] } };
            },
        },
    };
    const spawn = (systemID, itemID) => landscapeSceneTesting.spawnConfiguredLandscapeNpcs({ systemID }, { itemID, position: { x: 0, y: 0, z: 0 } }, { npcs: [{ profileID: "frontier_osa_surveyor", positionOffset: {} }] }, options);
    spawn(30_000_001, 900_439_900);
    spawn(30_000_001, 900_439_900);
    spawn(30_000_001, 900_439_901);
    spawn(30_000_002, 900_439_900);
    assert.equal(slots[0], slots[1]);
    assert.equal(new Set(slots).size, 3);
});
test("Frontier landscape proximity lookup returns several nearby sites in distance order", () => {
    const anchor = { position: { x: 0, y: 0, z: 0 } };
    const scene = {
        staticEntities: [
            { itemID: 3, kind: "landscapeSite", position: { x: 300, y: 0, z: 0 } },
            { itemID: 1, kind: "landscapeSite", position: { x: 100, y: 0, z: 0 } },
            { itemID: 2, kind: "landscapeSite", position: { x: 200, y: 0, z: 0 } },
            { itemID: 4, kind: "landscapeSite", position: { x: 2_000, y: 0, z: 0 } },
        ],
    };
    assert.deepEqual(findLandscapeSitesWithinRange(scene, anchor, 1_000, 2).map((site) => site.itemID), [1, 2]);
});
function buildDungeon(dungeonID, entryTypeID = 91302) {
    return {
        dungeonID,
        entryObjectID: dungeonID * 1000,
        entryTypeID,
        rooms: [{
                roomID: dungeonID * 10,
                position: { x: 0, y: 0, z: 0 },
                objects: [
                    {
                        objectID: dungeonID * 1000,
                        role: dungeonID === 100 ? "scenery" : "entryLocator",
                        typeID: entryTypeID,
                        position: { x: 0, y: 0, z: 0 },
                    },
                    {
                        objectID: (dungeonID * 1000) + 1,
                        role: "scenery",
                        typeID: 83560,
                        position: { x: dungeonID, y: 1, z: 2 },
                    },
                    {
                        objectID: (dungeonID * 1000) + 2,
                        role: "scenery",
                        typeID: 83561,
                        position: { x: dungeonID, y: 3, z: 4 },
                    },
                    {
                        objectID: (dungeonID * 1000) + 3,
                        role: "resourceLocator",
                        typeID: 91211,
                        position: { x: dungeonID, y: 5, z: 6 },
                    },
                ],
            }],
    };
}
function buildFixture() {
    const site = {
        itemID: 900439961,
        typeID: 91309,
        ecosystemID: 4,
        kind: "landscapeSite",
        position: { x: 10_000, y: 20_000, z: 30_000 },
    };
    const ecosystem = {
        ecosystemID: 4,
        entryDungeonID: 100,
        minNaturalWorldPatterns: 5,
        maxNaturalWorldPatterns: 7,
        minBrokenWorldPatterns: 0,
        maxBrokenWorldPatterns: 0,
        naturalWorldPatterns: [101, 102, 103, 104, 105, 106].map((dungeonID) => ({
            dungeonID,
            minOccurrences: 0,
            maxOccurrences: 1,
            weight: 1 / 6,
        })),
        brokenWorldPatterns: [],
    };
    const dungeons = new Map([[100, buildDungeon(100, 91309)]]);
    for (let dungeonID = 101; dungeonID <= 106; dungeonID += 1) {
        dungeons.set(dungeonID, buildDungeon(dungeonID));
    }
    return { dungeons, ecosystem, site };
}
test("Frontier landscape pattern selection is deterministic and respects occurrence caps", () => {
    const patterns = [101, 102, 103, 104, 105, 106].map((dungeonID) => ({
        dungeonID,
        minOccurrences: 0,
        maxOccurrences: 1,
        weight: 1 / 6,
    }));
    const first = selectPatternOccurrences(patterns, 5, 7, "900439961:natural");
    const second = selectPatternOccurrences(patterns, 5, 7, "900439961:natural");
    assert.deepEqual(first, second);
    assert.ok(first.length >= 5 && first.length <= 6);
    assert.equal(new Set(first.map((entry) => entry.dungeonID)).size, first.length);
});
test("Frontier landscape plans retain scenery and locator authority without overloading the scene", () => {
    const { dungeons, ecosystem, site } = buildFixture();
    const plan = buildLandscapeScenePlan(site, ecosystem, (dungeonID) => dungeons.get(dungeonID), { maxSceneryProps: 10 });
    assert.ok(plan.selectedPatterns.length >= 6);
    assert.equal(plan.environmentProps.length, 10);
    assert.ok(plan.environmentProps.every((entry) => ![91211, 91212, 91232, 91302].includes(entry.typeID)));
    assert.ok(plan.locators.some((entry) => entry.typeID === 91211));
    assert.ok(plan.environmentProps.every((entry) => entry.exact === true));
});
test("Frontier salvageable wreckage resolves its authored salvage output", () => {
    const wreckageOutputs = new Map([
        [95349, 88764],
        [95350, 99003],
        [95359, 99013],
        [95360, 99014],
        [95361, 99012],
    ]);
    const typeRecords = new Map([
        [95349, {
                typeID: 95349,
                groupID: FRONTIER_SALVAGEABLE_WRECKAGE_GROUP_ID,
                name: "Salvageable Wreckage",
            }],
        [95350, {
                typeID: 95350,
                groupID: FRONTIER_SALVAGEABLE_WRECKAGE_GROUP_ID,
                name: "Salvageable Cargo Debris",
            }],
        [95359, {
                typeID: 95359,
                groupID: FRONTIER_SALVAGEABLE_WRECKAGE_GROUP_ID,
                name: "Crystalline Refuse",
            }],
        [95360, {
                typeID: 95360,
                groupID: FRONTIER_SALVAGEABLE_WRECKAGE_GROUP_ID,
                name: "Debris",
            }],
        [95361, {
                typeID: 95361,
                groupID: FRONTIER_SALVAGEABLE_WRECKAGE_GROUP_ID,
                name: "Industrial Waste",
            }],
        [88764, {
                typeID: 88764,
                groupID: FRONTIER_SALVAGE_MATERIAL_GROUP_ID,
                name: "Salvaged Materials",
            }],
        [99003, {
                typeID: 99003,
                groupID: FRONTIER_SALVAGE_MATERIAL_GROUP_ID,
                name: "Cargo Debris",
            }],
        [99012, {
                typeID: 99012,
                groupID: FRONTIER_SALVAGE_MATERIAL_GROUP_ID,
                name: "Industrial Waste",
            }],
        [99013, {
                typeID: 99013,
                groupID: FRONTIER_SALVAGE_MATERIAL_GROUP_ID,
                name: "Crystalline Refuse",
            }],
        [99014, {
                typeID: 99014,
                groupID: FRONTIER_SALVAGE_MATERIAL_GROUP_ID,
                name: "Debris",
            }],
        [95345, {
                typeID: 95345,
                groupID: FRONTIER_SALVAGE_MATERIAL_GROUP_ID,
                name: "Cinderwrack",
            }],
    ]);
    const options = {
        getTypeAttributeValue: (typeID, name) => (name === "asteroidOutputTypeID" ? wreckageOutputs.get(typeID) || null : null),
        resolveItemByTypeID: (typeID) => typeRecords.get(typeID) || null,
    };
    const resolvedQuantities = new Set();
    let objectIndex = 0;
    for (const [wreckageTypeID, outputTypeID] of wreckageOutputs.entries()) {
        const wreckageObject = {
            objectID: 1558998 + objectIndex,
            typeID: wreckageTypeID,
        };
        objectIndex += 1;
        const profile = resolveFrontierSalvageResourceProfile(wreckageObject, options);
        assert.equal(profile.yieldTypeID, outputTypeID);
        assert.equal(profile.yieldKind, "salvage");
        assert.ok(profile.resourceQuantity >= FRONTIER_SALVAGE_MIN_RESOURCE_QUANTITY);
        assert.ok(profile.resourceQuantity <= FRONTIER_SALVAGE_MAX_RESOURCE_QUANTITY);
        assert.equal(resolveFrontierSalvageResourceProfile(wreckageObject, options).resourceQuantity, profile.resourceQuantity);
        resolvedQuantities.add(profile.resourceQuantity);
    }
    assert.ok(resolvedQuantities.size > 1);
    assert.equal(resolveFrontierSalvageResourceProfile(95345, options), null);
    assert.equal(classifyMiningMaterialType({
        typeID: 9_530_049,
        groupID: FRONTIER_SALVAGEABLE_WRECKAGE_GROUP_ID,
        categoryID: 25,
        groupName: "Salvageable Wreckage",
    }).kind, "salvage");
    assert.equal(classifyMiningMaterialType({
        typeID: 8_870_064,
        groupID: FRONTIER_SALVAGE_MATERIAL_GROUP_ID,
        categoryID: 17,
        groupName: "Salvage",
    }).kind, "salvage");
});
test("Frontier landscape plans reserve authored wreckage outside the scenery cap", () => {
    const objects = [
        {
            objectID: 100_000,
            role: "scenery",
            typeID: 95345,
            position: { x: 500, y: 0, z: 0 },
        },
        {
            objectID: 100_001,
            role: "scenery",
            typeID: 83560,
            position: { x: 1_000, y: 0, z: 0 },
        },
    ];
    for (let index = 0; index < 8; index += 1) {
        objects.push({
            objectID: 100_010 + index,
            role: "scenery",
            typeID: index === 7 ? 95350 : 95349,
            position: { x: 5_000 + (index * 1_000), y: index * 100, z: index * -200 },
        });
    }
    const dungeon = {
        dungeonID: 100,
        entryObjectID: 100_999,
        rooms: [{ roomID: 1, position: { x: 0, y: 0, z: 0 }, objects }],
    };
    const classifyResourceObject = (object) => ([95349, 95350].includes(Number(object && object.typeID))
        ? {
            typeID: object.typeID,
            yieldTypeID: object.typeID === 95349 ? 88764 : 99003,
            resourceQuantity: 5 + (Number(object.objectID) % 16),
        }
        : null);
    const plan = buildLandscapeScenePlan({ itemID: 900_000_001, dungeonID: 100 }, {
        entryDungeonID: 100,
        naturalWorldPatterns: [],
        brokenWorldPatterns: [],
    }, () => dungeon, {
        classifyResourceObject,
        maxResourceProps: 3,
        maxSceneryProps: 2,
    });
    assert.equal(plan.environmentProps.length, 2);
    assert.equal(plan.resourceProps.length, 3);
    assert.deepEqual(new Set(plan.resourceProps.map((entry) => entry.typeID)), new Set([95349, 95350]));
    assert.ok(plan.resourceProps.every((entry) => entry.landscapeResource === true));
    assert.ok(plan.environmentProps.some((entry) => entry.typeID === 95345));
    assert.ok(plan.environmentProps.every((entry) => ![95349, 95350].includes(entry.typeID)));
});
test("Outer Vestiges and Trojan Drifting Annex separate repeated patterns from warp-in", () => {
    for (const fixture of [
        {
            ecosystemID: 7,
            ecosystemName: "Broken World - Outer Belt - Vestiges",
            featureKind: "asteroidBelt",
            itemName: "Outer Vestiges",
            siteID: 900439970,
        },
        {
            ecosystemID: 13,
            ecosystemName: "Broken World - Trojans - Drifting Annex",
            featureKind: "trojan",
            itemName: "Trojan Drifting Annex",
            siteID: 900439971,
        },
    ]) {
        const dungeons = new Map([
            [100, buildDungeon(100, 91309)],
            [101, buildDungeon(101)],
        ]);
        const site = {
            ecosystemID: fixture.ecosystemID,
            featureKind: fixture.featureKind,
            itemID: fixture.siteID,
            itemName: fixture.itemName,
            position: { x: 0, y: 0, z: 0 },
        };
        const ecosystem = {
            ecosystemID: fixture.ecosystemID,
            entryDungeonID: 100,
            name: fixture.ecosystemName,
            minNaturalWorldPatterns: 2,
            maxNaturalWorldPatterns: 2,
            minBrokenWorldPatterns: 0,
            maxBrokenWorldPatterns: 0,
            naturalWorldPatterns: [{
                    dungeonID: 101,
                    minOccurrences: 2,
                    maxOccurrences: 2,
                    weight: 1,
                }],
            brokenWorldPatterns: [],
        };
        const plan = buildLandscapeScenePlan(site, ecosystem, (dungeonID) => dungeons.get(dungeonID), { maxSceneryProps: 10 });
        const patterns = plan.selectedPatterns.filter((entry) => entry.patternKind !== "entry");
        const patternOffsets = patterns.map((entry) => entry.positionOffset);
        const patternLocators = plan.locators.filter((entry) => entry.patternKind !== "entry");
        const patternProps = plan.environmentProps.filter((entry) => !entry.key.startsWith("landscape:entry:"));
        assert.equal(patterns.length, 2, fixture.itemName);
        assert.notDeepEqual(patternOffsets[0], patternOffsets[1], fixture.itemName);
        assert.equal(new Set(patterns.map((entry) => entry.patternIndex)).size, 2, fixture.itemName);
        assert.equal(new Set(patternLocators.map((entry) => entry.patternIndex)).size, 2, fixture.itemName);
        assert.ok(patternProps.length > 0, fixture.itemName);
        assert.ok(patternProps.every((entry) => (Math.hypot(entry.positionOffset.x, entry.positionOffset.y, entry.positionOffset.z) >=
            DEFAULT_WARP_CLEARANCE_METERS)), fixture.itemName);
        assert.ok(patternProps.every((entry) => Array.isArray(entry.dunRotation)), fixture.itemName);
    }
});
test("Frontier landscape materialization uses public bubble visibility rather than dungeon authorization", () => {
    const { dungeons, ecosystem, site } = buildFixture();
    const scene = {
        staticEntities: [site],
        staticEntitiesByID: new Map([[site.itemID, site]]),
        addStaticEntity(entity) {
            if (this.staticEntitiesByID.has(entity.itemID)) {
                return false;
            }
            this.staticEntities.push(entity);
            this.staticEntitiesByID.set(entity.itemID, entity);
            return true;
        },
    };
    const worldData = {
        getLandscapeDungeonTemplateByID: (dungeonID) => dungeons.get(dungeonID) || null,
        getLandscapeEcosystemByID: () => ecosystem,
    };
    const dungeonService = {
        buildEnvironmentEntities(_instance, siteEntity, _template, populationHints) {
            return populationHints.environmentProps.map((entry, index) => ({
                dungeonEnvironmentSource: "populationHint:exact",
                dungeonMaterializedEnvironment: true,
                dungeonMaterializedSiteContent: true,
                dungeonSiteID: siteEntity.itemID,
                dungeonSiteInstanceID: siteEntity.itemID,
                dunObjectID: entry.dunObjectID,
                itemID: 6_490_000_000_000 + index,
                position: {
                    x: siteEntity.position.x + entry.positionOffset.x,
                    y: siteEntity.position.y + entry.positionOffset.y,
                    z: siteEntity.position.z + entry.positionOffset.z,
                },
                typeID: entry.typeID,
            }));
        },
    };
    const result = materializeNearbyLandscapeSite(scene, {
        position: { ...site.position },
    }, {
        dungeonService,
        maxSceneryProps: 10,
        worldData,
    });
    assert.equal(result.success, true);
    assert.equal(result.data.propsSpawned, 10);
    const prop = scene.staticEntities.find((entity) => entity.kind === "landscapeEnvironmentProp");
    assert.ok(prop);
    assert.equal(prop.staticVisibilityScope, "bubble");
    assert.equal(prop.landscapeSiteID, site.itemID);
    assert.equal(prop.dungeonSiteInstanceID, undefined);
    assert.equal(prop.dungeonMaterializedSiteContent, undefined);
    assert.equal(materializeNearbyLandscapeSite(scene, { position: site.position }, { dungeonService, worldData }).data.alreadyMaterialized, true);
    scene.removeStaticEntity = function removeStaticEntity(itemID) {
        if (!this.staticEntitiesByID.has(itemID)) {
            return { success: false };
        }
        this.staticEntitiesByID.delete(itemID);
        this.staticEntities = this.staticEntities.filter((entity) => entity.itemID !== itemID);
        return { success: true };
    };
    const removed = dematerializeLandscapeSite(scene, site.itemID, {
        broadcast: false,
    });
    assert.equal(removed.success, true);
    assert.equal(removed.data.removedCount, 10);
    assert.equal(materializeLandscapeSite(scene, site, { dungeonService, maxSceneryProps: 10, worldData }).data.propsSpawned, 10);
});
test("Frontier landscape materialization promotes salvageable wreckage into mineable resources", () => {
    const site = {
        itemID: 900_439_980,
        ecosystemID: 23,
        kind: "landscapeSite",
        position: { x: 10_000, y: 20_000, z: 30_000 },
    };
    const dungeon = {
        dungeonID: 14125,
        entryObjectID: 1,
        rooms: [{
                roomID: 10,
                position: { x: 0, y: 0, z: 0 },
                objects: [
                    { objectID: 1, role: "entryLocator", typeID: 91302, position: { x: 0, y: 0, z: 0 } },
                    { objectID: 2, role: "scenery", typeID: 83560, position: { x: 1_000, y: 0, z: 0 } },
                    { objectID: 3, role: "scenery", typeID: 95349, position: { x: 5_000, y: 500, z: -500 } },
                    { objectID: 4, role: "scenery", typeID: 95350, position: { x: -7_000, y: 800, z: 1_000 } },
                ],
            }],
    };
    const ecosystem = {
        ecosystemID: 23,
        entryDungeonID: 14125,
        naturalWorldPatterns: [],
        brokenWorldPatterns: [],
    };
    const classifyResourceObject = (object) => {
        const typeID = Number(object && object.typeID);
        if (![95349, 95350].includes(typeID)) {
            return null;
        }
        return {
            typeID,
            typeRecord: {
                typeID,
                groupID: FRONTIER_SALVAGEABLE_WRECKAGE_GROUP_ID,
                name: typeID === 95349 ? "Salvageable Wreckage" : "Salvageable Cargo Debris",
            },
            yieldTypeID: typeID === 95349 ? 88764 : 99003,
            resourceQuantity: typeID === 95349 ? 7 : 18,
        };
    };
    const scene = {
        systemID: 30_000_001,
        staticEntities: [site],
        staticEntitiesByID: new Map([[site.itemID, site]]),
        _miningRuntimeState: {},
        addStaticEntity(entity) {
            this.staticEntities.push(entity);
            this.staticEntitiesByID.set(entity.itemID, entity);
            return true;
        },
        getEntityByID(itemID) {
            return this.staticEntitiesByID.get(itemID) || null;
        },
        removeStaticEntity(itemID) {
            this.staticEntitiesByID.delete(itemID);
            this.staticEntities = this.staticEntities.filter((entity) => entity.itemID !== itemID);
            return { success: true };
        },
    };
    const registered = [];
    const cleared = [];
    const miningRuntimeState = {
        registerMineableEntity(_scene, entity) {
            registered.push(entity.itemID);
            return { entityID: entity.itemID };
        },
        clearMineableState(_scene, entityID) {
            cleared.push(entityID);
            return true;
        },
    };
    const dungeonService = {
        buildEnvironmentEntities(_instance, siteEntity, _template, populationHints) {
            return populationHints.environmentProps.map((entry, index) => ({
                dunObjectID: entry.dunObjectID,
                graphicID: 28_952,
                itemID: 6_490_000_100_000 + index,
                position: {
                    x: siteEntity.position.x + entry.positionOffset.x,
                    y: siteEntity.position.y + entry.positionOffset.y,
                    z: siteEntity.position.z + entry.positionOffset.z,
                },
                typeID: entry.typeID,
            }));
        },
    };
    const worldData = {
        getLandscapeDungeonTemplateByID: () => dungeon,
        getLandscapeEcosystemByID: () => ecosystem,
    };
    const result = materializeLandscapeSite(scene, site, {
        classifyResourceObject,
        dungeonService,
        maxSceneryProps: 1,
        miningRuntimeState,
        worldData,
    });
    const resources = scene.staticEntities.filter((entity) => entity.kind === "landscapeSalvageResource");
    assert.equal(result.success, true);
    assert.equal(result.data.propsSpawned, 6);
    assert.equal(result.data.resourcesSpawned, 3);
    assert.equal(result.data.wrecksSpawned, 3);
    assert.equal(result.data.spawnPlan.npcs.length, 2);
    assert.equal(resources.length, 3);
    assert.deepEqual(resources.map((entity) => entity.miningYieldTypeID).sort(), [88764, 99003, 99003]);
    assert.deepEqual(resources.map((entity) => entity.resourceQuantity).sort((a, b) => a - b), [7, 18, 18]);
    assert.ok(resources.every((entity) => entity.skipMiningTemplateResolution === true));
    assert.equal(registered.length, 3);
    const removed = dematerializeLandscapeSite(scene, site.itemID, {
        broadcast: false,
        miningRuntimeState,
    });
    assert.equal(removed.data.removedCount, 6);
    assert.equal(cleared.length, 3);
});
//# sourceMappingURL=frontierLandscapeScenes.test.js.map