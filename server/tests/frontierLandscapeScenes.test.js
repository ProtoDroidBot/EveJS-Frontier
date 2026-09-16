"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const assert = require("node:assert/strict");
const test = require("node:test");
const { DEFAULT_WARP_CLEARANCE_METERS, buildLandscapeScenePlan, selectPatternOccurrences, } = require("../src/space/frontierLandscapeScenePlan");
const { FRONTIER_SALVAGE_MATERIAL_GROUP_ID, FRONTIER_SALVAGE_MAX_RESOURCE_QUANTITY, FRONTIER_SALVAGE_MIN_RESOURCE_QUANTITY, FRONTIER_SALVAGEABLE_WRECKAGE_GROUP_ID, resolveFrontierSalvageResourceProfile, } = require("../src/services/mining/frontierSalvageResources");
const { classifyMiningMaterialType, } = require("../src/services/mining/miningInventory");
const { dematerializeLandscapeSite, findLandscapeSitesWithinRange, materializeLandscapeSite, materializeNearbyLandscapeSite, } = require("../src/space/frontierLandscapeSceneService");
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
    assert.equal(result.data.propsSpawned, 3);
    assert.equal(result.data.resourcesSpawned, 2);
    assert.equal(resources.length, 2);
    assert.deepEqual(resources.map((entity) => entity.miningYieldTypeID).sort(), [88764, 99003]);
    assert.deepEqual(resources.map((entity) => entity.resourceQuantity).sort((a, b) => a - b), [7, 18]);
    assert.ok(resources.every((entity) => entity.skipMiningTemplateResolution === true));
    assert.equal(registered.length, 2);
    const removed = dematerializeLandscapeSite(scene, site.itemID, {
        broadcast: false,
        miningRuntimeState,
    });
    assert.equal(removed.data.removedCount, 3);
    assert.equal(cleared.length, 2);
});
//# sourceMappingURL=frontierLandscapeScenes.test.js.map