"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * Frontier Creation ability framework, IFF transponder/beacon, and
 * directional scanner coverage (client build 3502403).
 * Run through: npm run test:frontier-server (isolated runner).
 */
const assert = require("node:assert/strict");
const test = require("node:test");
const { marshalEncode, } = require("../src/network/tcp/utils/marshal");
const { currentFileTime, unwrapMarshalValue, } = require("../src/services/_shared/serviceHelpers");
const creationRuntime = require("../src/services/frontier/creationRuntime");
const { rotateCreationCellOffset, validateCreationLayout, } = require("../src/services/frontier/creationLayoutValidation");
const creationAbilityRuntime = require("../src/services/frontier/creationAbilityRuntime");
const fuelTankRuntime = require("../src/services/frontier/fuelTankRuntime");
const { getCreationModule, getCreationPart, getCreationTemplate, } = require("../src/services/frontier/creationStaticData");
const iffRuntime = require("../src/services/frontier/iffRuntime");
const serverConfig = require("../src/config");
const scanningRuntime = require("../src/services/frontier/scanningRuntime");
const ScanningService = require("../src/services/frontier/scanningService");
const MachoNetService = require("../src/services/machoNet/machoNetService");
const itemStore = require("../src/services/inventory/itemStore");
const liveFittingState = require("../src/services/fitting/liveFittingState");
const frontierSpaceRuntime = require("../src/space/runtime");
const launchBayPayloadRuntime = require("../src/services/frontier/launchBayPayloadRuntime");
const DogmaService = require("../src/services/dogma/dogmaService");
const CreationService = require("../src/services/frontier/creationService");
const { buildPythonTimedeltaPayload, buildScanResponse, millisecondsToFiletimeDelta, } = require("../src/services/frontier/scanningAbilityHandlers");
const { buildNpcTransponderShipsForSystem, buildVerdictsForViewer, handleCreationIffStateChange, handleIffBeaconEffectStopped, handleIffBroadcastEffectStopped, } = require("../src/services/frontier/iffAbilityHandlers");
const TYPE_SCANNER = 95322;
const TYPE_TRANSPONDER = 95988;
const TYPE_BEACON = 96039;
const TYPE_FUEL_BAY = 95324;
const TYPE_CAPACITOR = 95325;
const TYPE_CUTTING_LASER = 95317;
const TYPE_RECYCLED_MINING_LENS = 83463;
const TYPE_SYNTHETIC_MINING_LENS = 95639;
const TYPE_STUTTERGUN = 95753;
const TYPE_PYRO_ROUND = 82126;
const TYPE_LAUNCH_BAY = 95811;
const TYPE_FIELD_CAIRN = 93141;
const TYPE_HEAT_TRAP = 95812;
const TYPE_FIELD_SENTRY = 96099;
const TYPE_FUEL_BLISTER = 96013;
const TYPE_BLACKSTART_CELL = 96055;
const TYPE_WRONG_GROUP_CHARGE = 82126;
const TYPE_REFUGE_CREATION = 95735;
const TYPE_REIVER = 87848;
const CREATION_MODULE_CHARGE_FLAG_ID = 184;
// A real signature-bearing type from spaceComponentsByType (baseSignature 2.0).
const TYPE_SIGNATURE_TARGET = 23;
const OWNER_ID = 140000004;
const OTHER_OWNER_ID = 140000002;
const SHIP_ID = 9100000001;
const SOLAR_SYSTEM_ID = 30000004;
function frontierMarshals(value) {
    assert.doesNotThrow(() => marshalEncode(value, { compatibilityProfile: "frontier" }));
}
function assertCreationError(callback, reason) {
    assert.throws(callback, (error) => {
        const header = error?.machoErrorResponse?.payload?.header;
        assert.equal(header?.[0]?.value, "frontier.creation.common.errors.CreationError");
        assert.deepEqual(header?.[1], [reason]);
        return true;
    });
}
// ── Phase 1: ability discovery and dispatch ──────────────────────────────
test("behavior-aware ability lists are exact", () => {
    assert.deepEqual(creationRuntime.getCreationModuleAbilities(TYPE_SCANNER), ["online", "offline", "directional_scan"]);
    assert.deepEqual(creationRuntime.getCreationModuleAbilities(TYPE_TRANSPONDER), ["online", "offline", "activate_effect", "deactivate_effect", "iff_reconfigure"]);
    assert.deepEqual(creationRuntime.getCreationModuleAbilities(TYPE_BEACON), ["online", "offline", "activate_effect", "deactivate_effect"]);
});
test("existing online/offline advertisement is unchanged for generic modules", () => {
    // Generic modules without the Dogma online effect advertise nothing; ones
    // with it keep exactly the pre-framework pair.
    assert.deepEqual(creationRuntime.getCreationModuleAbilities(TYPE_FUEL_BAY), []);
    const capacitorAbilities = creationRuntime.getCreationModuleAbilities(TYPE_CAPACITOR);
    assert.ok(capacitorAbilities.length === 0 ||
        capacitorAbilities.every((ability) => ["online", "offline"].includes(ability)), `unexpected generic abilities: ${JSON.stringify(capacitorAbilities)}`);
});
test("Creation charge abilities are advertised only for charge-capable modules", () => {
    assert.deepEqual(creationRuntime.getCreationModuleAbilities(TYPE_CUTTING_LASER), ["online", "offline", "reload", "unload"]);
    assert.equal(creationRuntime.getCreationModuleAbilities(TYPE_FUEL_BAY).includes("reload"), false);
    assert.equal(creationRuntime.getCreationModuleAbilities(TYPE_FUEL_BAY).includes("unload"), false);
});
test("offline Creation modules stop contributing derived ship benefits", () => {
    for (const typeID of [95318, 95320, TYPE_CAPACITOR, 95326, 96013]) {
        const onlineEntries = creationRuntime.buildCreationShipAttributeModifierEntries([{
                itemID: typeID,
                typeID,
                flagID: creationRuntime.CREATION_FITTING_FLAG_ID,
                moduleState: { online: true },
            }]);
        const offlineEntries = creationRuntime.buildCreationShipAttributeModifierEntries([{
                itemID: typeID,
                typeID,
                flagID: creationRuntime.CREATION_FITTING_FLAG_ID,
                moduleState: { online: false },
            }]);
        assert.ok(onlineEntries.length > 0, `expected online modifiers for type ${typeID}`);
        assert.deepEqual(offlineEntries, [], `offline type ${typeID} retained modifiers`);
    }
    // A Fuel Bay has no online effect or online/offline action. It is an
    // intentionally passive hull part and must retain its capacity modifier.
    assert.ok(creationRuntime.buildCreationShipAttributeModifierEntries([{
            itemID: TYPE_FUEL_BAY,
            typeID: TYPE_FUEL_BAY,
            flagID: creationRuntime.CREATION_FITTING_FLAG_ID,
            moduleState: { online: false },
        }]).length > 0);
    const resourceState = {
        capacitorCapacity: 999,
        capacitorRechargeRate: 999,
        powerOutput: 999,
        powerLoad: 999,
        attributes: { 11: 999, 15: 999, 55: 999, 482: 999 },
    };
    const powerState = frontierSpaceRuntime._testing
        .applyCreationPowerStateToResourceStateForTesting(resourceState, {
        moduleItems: [{
                itemID: TYPE_CAPACITOR,
                typeID: TYPE_CAPACITOR,
                moduleState: { online: false },
            }],
    });
    assert.equal(powerState.capacitorCapacity, 0);
    assert.equal(resourceState.capacitorCapacity, 0);
    assert.equal(resourceState.attributes[482], 0);
});
test("no ability is advertised without a registered handler", () => {
    for (const typeID of [
        TYPE_SCANNER,
        TYPE_TRANSPONDER,
        TYPE_BEACON,
        TYPE_CUTTING_LASER,
    ]) {
        const behaviorName = creationAbilityRuntime.getModuleBehaviorName(typeID);
        for (const ability of creationRuntime.getCreationModuleAbilities(typeID)) {
            assert.ok(creationAbilityRuntime.resolveCreationAbilityHandler(behaviorName, ability, typeID), `missing handler for ${behaviorName}:${ability}`);
        }
    }
});
test("non-Creation ships return the exact client-handled UnknownCreation exception", () => {
    const shipGrant = itemStore.grantItemToCharacterLocation(OWNER_ID, SOLAR_SYSTEM_ID, 0, TYPE_REIVER, 1, { individualItems: true, singleton: 1 });
    assert.equal(shipGrant.success, true, shipGrant.errorMsg);
    const ship = shipGrant.data.items[0];
    assert.throws(() => new CreationService().Handle_get_creation([ship.itemID], { characterID: OWNER_ID, shipID: ship.itemID }), (error) => {
        const response = error && error.machoErrorResponse;
        const header = response && response.payload && response.payload.header;
        assert.equal(header && header[0] && header[0].value, "frontier.creation.common.errors.CreationError");
        assert.deepEqual(header[1], ["CreationError_UnknownCreation"]);
        assert.deepEqual(header[2], {
            type: "dict",
            entries: [["msg", "CreationError_UnknownCreation"]],
        });
        return true;
    });
});
function buildDispatchContext(moduleTypeID, moduleItemID = 500001) {
    return {
        item: { itemID: SHIP_ID, ownerID: OWNER_ID, typeID: 95276 },
        characterID: OWNER_ID,
        state: {
            modules: [{
                    itemID: moduleItemID,
                    typeID: moduleTypeID,
                    abilities: creationRuntime.getCreationModuleAbilities(moduleTypeID),
                }],
        },
    };
}
function buildCreationChargeFixture() {
    const shipGrant = itemStore.grantItemToCharacterLocation(OWNER_ID, SOLAR_SYSTEM_ID, 0, TYPE_REFUGE_CREATION, 1, { individualItems: true, singleton: 1 });
    assert.equal(shipGrant.success, true, shipGrant.errorMsg);
    const grantedShip = shipGrant.data.items[0];
    const shipUpdate = itemStore.updateInventoryItem(grantedShip.itemID, (currentItem) => ({
        ...currentItem,
        locationID: SOLAR_SYSTEM_ID,
        flagID: 0,
        spaceState: {
            systemID: SOLAR_SYSTEM_ID,
            position: { x: 0, y: 0, z: 0 },
        },
    }));
    assert.equal(shipUpdate.success, true, shipUpdate.errorMsg);
    const ensured = creationRuntime.ensureCreationState(shipUpdate.data, OWNER_ID);
    assert.equal(ensured.success, true, ensured.errorMsg);
    const moduleState = ensured.data.state.modules.find((module) => Number(module && module.typeID) === TYPE_CUTTING_LASER);
    assert.ok(moduleState, "Refuge Creation should contain one Cutting Laser");
    const moduleItem = itemStore.findItemById(moduleState.itemID);
    assert.ok(moduleItem, "seeded Cutting Laser inventory item should exist");
    const notifications = [];
    const session = {
        charid: OWNER_ID,
        characterID: OWNER_ID,
        shipid: grantedShip.itemID,
        shipID: grantedShip.itemID,
        solarsystemid: SOLAR_SYSTEM_ID,
        solarsystemid2: SOLAR_SYSTEM_ID,
        compatibilityProfile: "frontier",
        _space: {
            systemID: SOLAR_SYSTEM_ID,
            simFileTime: currentFileTime(),
        },
        sendNotification(name, idType, payload) {
            notifications.push({ name, idType, payload });
        },
    };
    return {
        moduleItem,
        notifications,
        service: new CreationService(),
        session,
        ship: itemStore.findShipItemById(grantedShip.itemID),
    };
}
function grantCreationCargoCharge(ownerID, shipID, typeID) {
    const grant = itemStore.grantItemToCharacterLocation(ownerID, shipID, itemStore.ITEM_FLAGS.CARGO_HOLD, typeID, 1, { singleton: 0 });
    assert.equal(grant.success, true, grant.errorMsg);
    return grant.data.items[0];
}
function addCreationModuleToFixture(fixture, typeID) {
    const grant = itemStore.grantItemToCharacterLocation(OWNER_ID, fixture.ship.itemID, creationRuntime.CREATION_FITTING_FLAG_ID, typeID, 1, { individualItems: true, singleton: 1 });
    assert.equal(grant.success, true, grant.errorMsg);
    const moduleItem = grant.data.items[0];
    const shipUpdate = itemStore.updateShipItem(fixture.ship.itemID, (currentItem) => {
        const customInfo = JSON.parse(currentItem.customInfo || "{}");
        const state = customInfo[creationRuntime.CREATION_STATE_KEY];
        assert.ok(state, "Creation state should already be seeded");
        state.modules.push({ itemID: moduleItem.itemID, typeID });
        return { ...currentItem, customInfo: JSON.stringify(customInfo) };
    });
    assert.equal(shipUpdate.success, true, shipUpdate.errorMsg);
    return moduleItem;
}
function cloneCreationState(state) {
    return JSON.parse(JSON.stringify(state));
}
function stateWithInteriorModule(state, itemID, typeID, placement) {
    const candidate = cloneCreationState(state);
    candidate.modules.push({ itemID, typeID });
    candidate.interiorPlacements.push({ itemID, ...placement });
    return candidate;
}
function findValidInteriorPlacement(state, template, itemID, typeID) {
    const definition = getCreationModule(typeID);
    const occupancy = definition?.placement?.occupancy?.cells;
    assert.ok(Array.isArray(occupancy), `type ${typeID} must be an interior module`);
    for (const [rawPartID, partReference] of Object.entries(template.parts || {})) {
        const partID = Number(rawPartID);
        const part = getCreationPart(partReference.graphic_id);
        for (const rotationZ of [0, 90, 180, 270]) {
            const offsets = occupancy.map((cell) => rotateCreationCellOffset(Number(cell.x), Number(cell.y), 0, rotationZ));
            const anchors = new Set();
            for (const partCell of Array.isArray(part?.cells) ? part.cells : []) {
                for (const [dx, dy] of offsets) {
                    anchors.add(`${Number(partCell.x) - dx}:${Number(partCell.y) - dy}`);
                }
            }
            for (const anchor of anchors) {
                const [x, y] = anchor.split(":").map(Number);
                const placement = {
                    partID,
                    x,
                    y,
                    z: 0,
                    rotation: { x: 0, y: 0, z: rotationZ },
                };
                const candidate = stateWithInteriorModule(state, itemID, typeID, placement);
                if (validateCreationLayout(candidate, template).length === 0) {
                    return placement;
                }
            }
        }
    }
    assert.fail(`no valid SDE placement found for Creation module type ${typeID}`);
}
function expireLaunchBayCooldown(moduleItemID) {
    const result = itemStore.updateInventoryItem(moduleItemID, (item) => ({
        ...item,
        moduleState: {
            ...(item.moduleState || {}),
            creationLaunchBayReadyAtMs: 0,
        },
    }));
    assert.equal(result.success, true, result.errorMsg);
}
function assertCreationChangedNotification(notification, creationID, freshSnapshot, moduleItemID, expectedLoadedTypeID, expectedLoadedCount) {
    assert.equal(notification.name, "OnCreationChanged");
    assert.equal(notification.idType, "clientID");
    assert.ok(Array.isArray(notification.payload));
    assert.equal(notification.payload.length, 2);
    assert.equal(notification.payload[0], creationID);
    const notifiedSnapshot = unwrapMarshalValue(notification.payload[1]);
    assert.deepEqual(Object.keys(notifiedSnapshot).sort(), [
        "access_control",
        "hardpoints",
        "interior_placements",
        "item_id",
        "layout",
        "modules",
        "owner_id",
        "type_id",
    ]);
    assert.equal(notifiedSnapshot.item_id, freshSnapshot.item_id);
    assert.equal(notifiedSnapshot.type_id, freshSnapshot.type_id);
    assert.equal(notifiedSnapshot.owner_id, freshSnapshot.owner_id);
    assert.equal(notifiedSnapshot.access_control.default, freshSnapshot.access_control.default);
    assert.deepEqual(Object.keys(notifiedSnapshot.layout.parts).sort(), Object.keys(freshSnapshot.layout.parts).sort());
    assert.deepEqual(Object.keys(notifiedSnapshot.modules).sort(), Object.keys(freshSnapshot.modules).sort());
    assert.deepEqual(Object.keys(notifiedSnapshot.interior_placements).sort(), Object.keys(freshSnapshot.interior_placements).sort());
    assert.equal(notifiedSnapshot.hardpoints.length, freshSnapshot.hardpoints.length);
    const notifiedModule = notifiedSnapshot.modules[String(moduleItemID)];
    assert.equal(notifiedModule.loaded_type_id, expectedLoadedTypeID);
    assert.equal(notifiedModule.loaded_count, expectedLoadedCount);
    assert.equal(notifiedModule.loaded_type_id, freshSnapshot.modules[String(moduleItemID)].loaded_type_id);
    assert.equal(notifiedModule.loaded_count, freshSnapshot.modules[String(moduleItemID)].loaded_count);
}
test("Creation reload and unload move one mining lens through module charge flag 184", () => {
    const fixture = buildCreationChargeFixture();
    const sourceCharge = grantCreationCargoCharge(OWNER_ID, fixture.ship.itemID, TYPE_RECYCLED_MINING_LENS);
    const beforeReload = currentFileTime();
    const reloadResult = fixture.service.Handle_activate_ability([fixture.ship.itemID, fixture.moduleItem.itemID, "reload"], fixture.session, {
        type_id: TYPE_RECYCLED_MINING_LENS,
        ammo_item_ids: [sourceCharge.itemID],
        ammo_location_id: fixture.ship.itemID,
    });
    const reloadPayload = unwrapMarshalValue(reloadResult);
    assert.equal(typeof reloadPayload.server_time, "bigint");
    assert.ok(reloadPayload.server_time > beforeReload);
    assert.equal(reloadPayload.server_time - fixture.session._space.simFileTime, 10000000n, "ordinary reload responses retain the authored 1000 ms FILETIME delay");
    assert.equal(reloadPayload.type_id, TYPE_RECYCLED_MINING_LENS);
    assert.equal(reloadPayload.qty, 1);
    const loadedCharges = itemStore.listContainerItems(OWNER_ID, fixture.moduleItem.itemID, CREATION_MODULE_CHARGE_FLAG_ID);
    assert.equal(loadedCharges.length, 1);
    assert.equal(loadedCharges[0].itemID, sourceCharge.itemID);
    assert.equal(loadedCharges[0].locationID, fixture.moduleItem.itemID);
    assert.equal(loadedCharges[0].flagID, CREATION_MODULE_CHARGE_FLAG_ID);
    assert.equal(loadedCharges[0].typeID, TYPE_RECYCLED_MINING_LENS);
    assert.equal(loadedCharges[0].stacksize, 1);
    const creationSnapshot = unwrapMarshalValue(fixture.service.Handle_get_creation([fixture.ship.itemID], fixture.session));
    assert.equal(creationSnapshot.modules[String(fixture.moduleItem.itemID)].loaded_type_id, TYPE_RECYCLED_MINING_LENS);
    assert.equal(creationSnapshot.modules[String(fixture.moduleItem.itemID)].loaded_count, 1);
    const reloadCreationNotifications = fixture.notifications.filter((notification) => notification.name === "OnCreationChanged");
    assert.equal(reloadCreationNotifications.length, 1);
    assertCreationChangedNotification(reloadCreationNotifications[0], fixture.ship.itemID, creationSnapshot, fixture.moduleItem.itemID, TYPE_RECYCLED_MINING_LENS, 1);
    assert.ok(fixture.notifications.some((notification) => notification.name === "OnItemChange"), "reload should synchronize its real nested inventory row");
    assert.ok(fixture.notifications.some((notification) => notification.name === "OnGodmaPrimeItem"), "in-space reload should prime the nested charge for Dogma");
    const unloadResult = fixture.service.Handle_activate_ability([fixture.ship.itemID, fixture.moduleItem.itemID, "unload"], fixture.session, {});
    const unloadPayload = unwrapMarshalValue(unloadResult);
    assert.equal(typeof unloadPayload.server_time, "bigint");
    const returnedCharge = itemStore.findItemById(sourceCharge.itemID);
    assert.equal(returnedCharge.locationID, fixture.ship.itemID);
    assert.equal(returnedCharge.flagID, itemStore.ITEM_FLAGS.CARGO_HOLD);
    assert.equal(itemStore.listContainerItems(OWNER_ID, fixture.moduleItem.itemID, CREATION_MODULE_CHARGE_FLAG_ID).length, 0);
    const unloadedCreationSnapshot = unwrapMarshalValue(fixture.service.Handle_get_creation([fixture.ship.itemID], fixture.session));
    assert.equal(unloadedCreationSnapshot.modules[String(fixture.moduleItem.itemID)].loaded_type_id, null);
    assert.equal(unloadedCreationSnapshot.modules[String(fixture.moduleItem.itemID)].loaded_count, 0);
    const unloadCreationNotifications = fixture.notifications.filter((notification) => notification.name === "OnCreationChanged");
    assert.equal(unloadCreationNotifications.length, 2);
    assertCreationChangedNotification(unloadCreationNotifications[1], fixture.ship.itemID, unloadedCreationSnapshot, fixture.moduleItem.itemID, null, 0);
});
test("Creation Launch Bay reloads and unloads a deployable payload through flag 184", () => {
    const fixture = buildCreationChargeFixture();
    const launchBay = addCreationModuleToFixture(fixture, TYPE_LAUNCH_BAY);
    assert.deepEqual(creationRuntime.getCreationModuleAbilities(TYPE_LAUNCH_BAY), ["online", "offline", "deploy", "reload", "unload"]);
    const fieldCairn = grantCreationCargoCharge(OWNER_ID, fixture.ship.itemID, TYPE_FIELD_CAIRN);
    assert.equal(itemStore.findItemById(fieldCairn.itemID).categoryID, 22);
    const reloadResult = fixture.service.Handle_activate_ability([fixture.ship.itemID, launchBay.itemID, "reload"], fixture.session, {
        type_id: TYPE_FIELD_CAIRN,
        ammo_item_ids: [fieldCairn.itemID],
        ammo_location_id: fixture.ship.itemID,
    });
    const reloadPayload = unwrapMarshalValue(reloadResult);
    assert.equal(reloadPayload.type_id, TYPE_FIELD_CAIRN);
    assert.equal(reloadPayload.qty, 1);
    const loadedPayloads = itemStore.listContainerItems(OWNER_ID, launchBay.itemID, CREATION_MODULE_CHARGE_FLAG_ID);
    assert.equal(loadedPayloads.length, 1);
    assert.equal(loadedPayloads[0].itemID, fieldCairn.itemID);
    assert.equal(loadedPayloads[0].typeID, TYPE_FIELD_CAIRN);
    assert.equal(loadedPayloads[0].categoryID, 22);
    assert.equal(loadedPayloads[0].locationID, launchBay.itemID);
    assert.equal(loadedPayloads[0].flagID, CREATION_MODULE_CHARGE_FLAG_ID);
    const loadedSnapshot = unwrapMarshalValue(fixture.service.Handle_get_creation([fixture.ship.itemID], fixture.session));
    assert.equal(loadedSnapshot.modules[String(launchBay.itemID)].loaded_type_id, TYPE_FIELD_CAIRN);
    assert.equal(loadedSnapshot.modules[String(launchBay.itemID)].loaded_count, 1);
    const unloadResult = fixture.service.Handle_activate_ability([fixture.ship.itemID, launchBay.itemID, "unload"], fixture.session, {});
    assert.equal(typeof unwrapMarshalValue(unloadResult).server_time, "bigint");
    const returnedPayload = itemStore.findItemById(fieldCairn.itemID);
    assert.equal(returnedPayload.locationID, fixture.ship.itemID);
    assert.equal(returnedPayload.flagID, itemStore.ITEM_FLAGS.CARGO_HOLD);
    assert.equal(itemStore.listContainerItems(OWNER_ID, launchBay.itemID, CREATION_MODULE_CHARGE_FLAG_ID).length, 0);
    const unloadedSnapshot = unwrapMarshalValue(fixture.service.Handle_get_creation([fixture.ship.itemID], fixture.session));
    assert.equal(unloadedSnapshot.modules[String(launchBay.itemID)].loaded_type_id, null);
    assert.equal(unloadedSnapshot.modules[String(launchBay.itemID)].loaded_count, 0);
});
test("Creation Launch Bay deploys Field Sentries and transfers Heat Trap heat", (t) => {
    const fixture = buildCreationChargeFixture();
    const launchBay = addCreationModuleToFixture(fixture, TYPE_LAUNCH_BAY);
    assert.equal(creationRuntime.isCreationModuleOnline(itemStore.findItemById(launchBay.itemID)), true);
    const heatTrapGrant = itemStore.grantItemToCharacterLocation(OWNER_ID, fixture.ship.itemID, itemStore.ITEM_FLAGS.CARGO_HOLD, TYPE_HEAT_TRAP, 3, { singleton: 0 });
    assert.equal(heatTrapGrant.success, true, heatTrapGrant.errorMsg);
    const heatTrap = heatTrapGrant.data.items[0];
    const reloadResult = fixture.service.Handle_activate_ability([fixture.ship.itemID, launchBay.itemID, "reload"], fixture.session, {
        type_id: TYPE_HEAT_TRAP,
        ammo_item_ids: [heatTrap.itemID],
        ammo_location_id: fixture.ship.itemID,
    });
    assert.equal(unwrapMarshalValue(reloadResult).qty, 3);
    assert.ok(itemStore.findItemById(launchBay.itemID).moduleState.creationLaunchBayReadyAtMs >
        Date.now(), "reload persists the authored 20-second Launch Bay cooldown");
    const shipEntity = {
        conditionState: { temperature: 500 },
        direction: { x: 1, y: 0, z: 0 },
        dungeonSiteID: 123,
        dungeonSiteInstanceID: 456,
        itemID: fixture.ship.itemID,
        kind: "ship",
        mode: "STOP",
        position: { x: 10, y: 20, z: 30 },
        radius: 25,
        temperatureState: {
            externalTemperature: 300,
            shadowed: false,
            temperature: 500,
        },
        velocity: { x: 2, y: 0, z: 0 },
    };
    t.mock.method(frontierSpaceRuntime, "getEntity", () => shipEntity);
    let spawnedItemID = 0;
    t.mock.method(frontierSpaceRuntime, "spawnDynamicInventoryEntity", (_systemID, itemID) => {
        spawnedItemID = Number(itemID);
        return { success: true, data: { entity: { itemID } } };
    });
    assertCreationError(() => fixture.service.Handle_activate_ability([fixture.ship.itemID, launchBay.itemID, "deploy"], fixture.session, {}), "CreationError_ModuleBusy");
    expireLaunchBayCooldown(launchBay.itemID);
    assert.equal(creationRuntime.isCreationModuleOnline(itemStore.findItemById(launchBay.itemID)), true, `Launch Bay must remain online after reload: ${JSON.stringify(itemStore.findItemById(launchBay.itemID).moduleState)}`);
    const deployResult = fixture.service.Handle_activate_ability([fixture.ship.itemID, launchBay.itemID, "deploy"], fixture.session, {});
    const payload = unwrapMarshalValue(deployResult);
    assert.equal(payload.type_id, TYPE_HEAT_TRAP);
    assert.equal(payload.transferred_heat, 150);
    assert.equal(payload.item_id, spawnedItemID);
    const deployed = itemStore.findItemById(spawnedItemID);
    assert.equal(deployed.locationID, SOLAR_SYSTEM_ID);
    assert.equal(deployed.flagID, 0);
    assert.equal(deployed.singleton, 1);
    assert.equal(deployed.launcherID, fixture.ship.itemID);
    assert.equal(deployed.conditionState.temperature, 445);
    assert.equal(deployed.spaceState.systemID, SOLAR_SYSTEM_ID);
    assert.equal(deployed.spaceState.dungeonSiteID, 123);
    const deployedHeatState = launchBayPayloadRuntime.getHeatTrapState(deployed);
    assert.equal(deployedHeatState.startTemperature, 445);
    assert.equal(deployedHeatState.ambientTemperature, 300);
    assert.ok(itemStore.findItemById(launchBay.itemID).moduleState.creationLaunchBayReadyAtMs >
        Date.now(), "deploy advances and durably persists the next ready time");
    assert.equal(shipEntity.conditionState.temperature, 350);
    assert.equal(itemStore.listContainerItems(OWNER_ID, launchBay.itemID, CREATION_MODULE_CHARGE_FLAG_ID)[0].stacksize, 2);
    const unloadResult = fixture.service.Handle_activate_ability([fixture.ship.itemID, launchBay.itemID, "unload"], fixture.session, {});
    assert.equal(typeof unwrapMarshalValue(unloadResult).server_time, "bigint");
    expireLaunchBayCooldown(launchBay.itemID);
    const sentryGrant = itemStore.grantItemToCharacterLocation(OWNER_ID, fixture.ship.itemID, itemStore.ITEM_FLAGS.CARGO_HOLD, TYPE_FIELD_SENTRY, 1, { singleton: 0 });
    assert.equal(sentryGrant.success, true, sentryGrant.errorMsg);
    const sentry = sentryGrant.data.items[0];
    const sentryReload = fixture.service.Handle_activate_ability([fixture.ship.itemID, launchBay.itemID, "reload"], fixture.session, {
        type_id: TYPE_FIELD_SENTRY,
        ammo_item_ids: [sentry.itemID],
        ammo_location_id: fixture.ship.itemID,
    });
    assert.equal(unwrapMarshalValue(sentryReload).qty, 1);
    expireLaunchBayCooldown(launchBay.itemID);
    spawnedItemID = 0;
    const sentryDeploy = unwrapMarshalValue(fixture.service.Handle_activate_ability([fixture.ship.itemID, launchBay.itemID, "deploy"], fixture.session, {}));
    assert.equal(sentryDeploy.type_id, TYPE_FIELD_SENTRY);
    assert.equal(sentryDeploy.transferred_heat, 0);
    assert.equal(sentryDeploy.item_id, spawnedItemID);
    const deployedSentry = itemStore.findItemById(spawnedItemID);
    assert.equal(deployedSentry.spaceState.systemID, SOLAR_SYSTEM_ID);
    assert.equal(deployedSentry.expiresAtMs -
        launchBayPayloadRuntime.getLaunchState(deployedSentry).deployedAtMs, 86_400_000, "Field Sentry persists authored 24-hour decay before ballpark spawn");
});
test("Creation Launch Bay persists Field Cairn authored 24-hour expiry", (t) => {
    const fixture = buildCreationChargeFixture();
    const launchBay = addCreationModuleToFixture(fixture, TYPE_LAUNCH_BAY);
    const fieldCairn = grantCreationCargoCharge(OWNER_ID, fixture.ship.itemID, TYPE_FIELD_CAIRN);
    fixture.service.Handle_activate_ability([fixture.ship.itemID, launchBay.itemID, "reload"], fixture.session, {
        type_id: TYPE_FIELD_CAIRN,
        ammo_item_ids: [fieldCairn.itemID],
        ammo_location_id: fixture.ship.itemID,
    });
    expireLaunchBayCooldown(launchBay.itemID);
    assert.equal(creationRuntime.isCreationModuleOnline(itemStore.findItemById(launchBay.itemID)), true, `Launch Bay must remain online after reload: ${JSON.stringify(itemStore.findItemById(launchBay.itemID).moduleState)}`);
    t.mock.method(frontierSpaceRuntime, "getEntity", () => ({
        conditionState: { temperature: 295 },
        direction: { x: 1, y: 0, z: 0 },
        itemID: fixture.ship.itemID,
        kind: "ship",
        mode: "STOP",
        position: { x: 0, y: 0, z: 0 },
        radius: 25,
        velocity: { x: 0, y: 0, z: 0 },
    }));
    t.mock.method(frontierSpaceRuntime, "spawnDynamicInventoryEntity", (_systemID, itemID) => ({ success: true, data: { entity: { itemID } } }));
    const deployment = unwrapMarshalValue(fixture.service.Handle_activate_ability([fixture.ship.itemID, launchBay.itemID, "deploy"], fixture.session, {}));
    const persisted = itemStore.findItemById(deployment.item_id);
    const launchState = launchBayPayloadRuntime.getLaunchState(persisted);
    assert.equal(persisted.expiresAtMs - launchState.deployedAtMs, 86_400_000);
});
test("Creation reload and unload remain successful when post-commit notifications throw", () => {
    const fixture = buildCreationChargeFixture();
    let notificationAttempts = 0;
    fixture.session.sendNotification = () => {
        notificationAttempts += 1;
        throw new Error("synthetic notification transport failure");
    };
    const sourceCharge = grantCreationCargoCharge(OWNER_ID, fixture.ship.itemID, TYPE_RECYCLED_MINING_LENS);
    const reloadResult = fixture.service.Handle_activate_ability([fixture.ship.itemID, fixture.moduleItem.itemID, "reload"], fixture.session, {
        type_id: TYPE_RECYCLED_MINING_LENS,
        ammo_item_ids: [sourceCharge.itemID],
        ammo_location_id: fixture.ship.itemID,
    });
    const reloadPayload = unwrapMarshalValue(reloadResult);
    assert.equal(reloadPayload.type_id, TYPE_RECYCLED_MINING_LENS);
    assert.equal(reloadPayload.qty, 1);
    const persistedLoadedCharge = itemStore.findItemById(sourceCharge.itemID);
    assert.equal(persistedLoadedCharge.locationID, fixture.moduleItem.itemID);
    assert.equal(persistedLoadedCharge.flagID, CREATION_MODULE_CHARGE_FLAG_ID);
    const unloadResult = fixture.service.Handle_activate_ability([fixture.ship.itemID, fixture.moduleItem.itemID, "unload"], fixture.session, {});
    const unloadPayload = unwrapMarshalValue(unloadResult);
    assert.equal(typeof unloadPayload.server_time, "bigint");
    const persistedReturnedCharge = itemStore.findItemById(sourceCharge.itemID);
    assert.equal(persistedReturnedCharge.locationID, fixture.ship.itemID);
    assert.equal(persistedReturnedCharge.flagID, itemStore.ITEM_FLAGS.CARGO_HOLD);
    assert.ok(notificationAttempts >= 2);
});
test("Creation reload atomically replaces a loaded mining lens with another compatible type", () => {
    const fixture = buildCreationChargeFixture();
    const recycledLens = grantCreationCargoCharge(OWNER_ID, fixture.ship.itemID, TYPE_RECYCLED_MINING_LENS);
    const firstReloadResult = fixture.service.Handle_activate_ability([fixture.ship.itemID, fixture.moduleItem.itemID, "reload"], fixture.session, {
        type_id: TYPE_RECYCLED_MINING_LENS,
        ammo_item_ids: [recycledLens.itemID],
        ammo_location_id: fixture.ship.itemID,
    });
    assert.equal(unwrapMarshalValue(firstReloadResult).qty, 1);
    const syntheticLens = grantCreationCargoCharge(OWNER_ID, fixture.ship.itemID, TYPE_SYNTHETIC_MINING_LENS);
    const replacementResult = fixture.service.Handle_activate_ability([fixture.ship.itemID, fixture.moduleItem.itemID, "reload"], fixture.session, {
        type_id: TYPE_SYNTHETIC_MINING_LENS,
        ammo_item_ids: [syntheticLens.itemID],
        ammo_location_id: fixture.ship.itemID,
    });
    const replacementPayload = unwrapMarshalValue(replacementResult);
    assert.equal(replacementPayload.type_id, TYPE_SYNTHETIC_MINING_LENS);
    assert.equal(replacementPayload.qty, 1);
    const loadedCharges = itemStore.listContainerItems(OWNER_ID, fixture.moduleItem.itemID, CREATION_MODULE_CHARGE_FLAG_ID);
    assert.equal(loadedCharges.length, 1);
    assert.equal(loadedCharges[0].itemID, syntheticLens.itemID);
    assert.equal(loadedCharges[0].typeID, TYPE_SYNTHETIC_MINING_LENS);
    const returnedRecycledLens = itemStore.findItemById(recycledLens.itemID);
    assert.equal(returnedRecycledLens.locationID, fixture.ship.itemID);
    assert.equal(returnedRecycledLens.flagID, itemStore.ITEM_FLAGS.CARGO_HOLD);
});
test("Creation reload atomically consolidates fragmented charge stacks", () => {
    const fixture = buildCreationChargeFixture();
    const stuttergun = addCreationModuleToFixture(fixture, TYPE_STUTTERGUN);
    const ammoGrant = itemStore.grantItemToCharacterLocation(OWNER_ID, fixture.ship.itemID, itemStore.ITEM_FLAGS.CARGO_HOLD, TYPE_PYRO_ROUND, 80, { singleton: 0 });
    assert.equal(ammoGrant.success, true, ammoGrant.errorMsg);
    const sourceStack = ammoGrant.data.items[0];
    const split = itemStore.moveItemToLocation(sourceStack.itemID, fixture.ship.itemID, itemStore.ITEM_FLAGS.CARGO_HOLD, 40);
    assert.equal(split.success, true, split.errorMsg);
    assert.equal(liveFittingState.getModuleChargeCapacity(TYPE_STUTTERGUN, TYPE_PYRO_ROUND), 80);
    assert.deepEqual([sourceStack.itemID, split.data.movedItemID]
        .map((itemID) => itemStore.findItemById(itemID).stacksize), [40, 40]);
    const reloadResult = fixture.service.Handle_activate_ability([fixture.ship.itemID, stuttergun.itemID, "reload"], fixture.session, {
        type_id: TYPE_PYRO_ROUND,
        ammo_item_ids: [sourceStack.itemID, split.data.movedItemID],
        ammo_location_id: fixture.ship.itemID,
    });
    const reloadPayload = unwrapMarshalValue(reloadResult);
    assert.equal(reloadPayload.type_id, TYPE_PYRO_ROUND);
    assert.equal(reloadPayload.qty, 80);
    const loadedCharges = itemStore.listContainerItems(OWNER_ID, stuttergun.itemID, CREATION_MODULE_CHARGE_FLAG_ID);
    assert.equal(loadedCharges.length, 1);
    assert.equal(loadedCharges[0].typeID, TYPE_PYRO_ROUND);
    assert.equal(loadedCharges[0].stacksize, 80);
});
test("Creation reload rejects spoofed and wrong-group charge sources without mutation", () => {
    const fixture = buildCreationChargeFixture();
    const foreignCharge = grantCreationCargoCharge(OTHER_OWNER_ID, fixture.ship.itemID, TYPE_RECYCLED_MINING_LENS);
    const foreignBefore = itemStore.findItemById(foreignCharge.itemID);
    assertCreationError(() => fixture.service.Handle_activate_ability([fixture.ship.itemID, fixture.moduleItem.itemID, "reload"], fixture.session, {
        type_id: TYPE_RECYCLED_MINING_LENS,
        ammo_item_ids: [foreignCharge.itemID],
        ammo_location_id: fixture.ship.itemID,
    }), "CreationError_CannotActivate");
    assert.deepEqual(itemStore.findItemById(foreignCharge.itemID), foreignBefore);
    const wrongGroupCharge = grantCreationCargoCharge(OWNER_ID, fixture.ship.itemID, TYPE_WRONG_GROUP_CHARGE);
    const wrongGroupBefore = itemStore.findItemById(wrongGroupCharge.itemID);
    assertCreationError(() => fixture.service.Handle_activate_ability([fixture.ship.itemID, fixture.moduleItem.itemID, "reload"], fixture.session, {
        type_id: TYPE_WRONG_GROUP_CHARGE,
        ammo_item_ids: [wrongGroupCharge.itemID],
        ammo_location_id: fixture.ship.itemID,
    }), "CreationError_CannotActivate");
    assert.deepEqual(itemStore.findItemById(wrongGroupCharge.itemID), wrongGroupBefore);
    assert.equal(itemStore.listContainerItems(OWNER_ID, fixture.moduleItem.itemID, CREATION_MODULE_CHARGE_FLAG_ID).length, 0);
});
function buildIffEffectRuntime(shipID) {
    const entity = {
        kind: "ship",
        itemID: shipID,
        position: { x: 1, y: 2, z: 3 },
        activeModuleEffects: new Map(),
    };
    const calls = [];
    return {
        calls,
        entity,
        finishCycle(moduleItemID) {
            const effectState = entity.activeModuleEffects.get(moduleItemID);
            assert.ok(effectState);
            entity.activeModuleEffects.delete(moduleItemID);
            effectState.stopReason = "manual";
            if (effectState.effectName === "iffBeacon") {
                handleIffBeaconEffectStopped(effectState);
            }
            else {
                handleIffBroadcastEffectStopped(effectState, SOLAR_SYSTEM_ID);
            }
        },
        runtime: {
            getEntity(_session, requestedShipID) {
                return Number(requestedShipID) === Number(shipID) ? entity : null;
            },
            activateGenericModule(_session, moduleItem, effectName, options = {}) {
                const effectID = effectName === "iffBeacon" ? 12974 : 12972;
                const durationMs = effectName === "iffBeacon" ? 30000 : 5000;
                const effectState = {
                    moduleID: moduleItem.itemID,
                    effectID,
                    effectName,
                    durationMs,
                    startedAtMs: Date.now(),
                    repeat: Object.prototype.hasOwnProperty.call(options, "repeat")
                        ? options.repeat
                        : null,
                };
                entity.activeModuleEffects.set(moduleItem.itemID, effectState);
                calls.push({ action: "activate", effectName, options, effectState });
                return { success: true, data: { entity, effectState } };
            },
            deactivateGenericModule(_session, moduleItemID, options = {}) {
                const effectState = entity.activeModuleEffects.get(moduleItemID) || null;
                if (!effectState) {
                    return { success: false, errorMsg: "MODULE_NOT_ACTIVE" };
                }
                if (options.reason === "manual" && options.deferUntilCycle === true) {
                    calls.push({ action: "deactivate-requested", options, effectState });
                    return {
                        success: true,
                        data: { entity, effectState, pending: true, deactivateAtMs: Date.now() + 5000 },
                    };
                }
                entity.activeModuleEffects.delete(moduleItemID);
                effectState.stopReason = options.reason || null;
                if (effectState.effectName === "iffBeacon") {
                    handleIffBeaconEffectStopped(effectState);
                }
                else {
                    handleIffBroadcastEffectStopped(effectState, SOLAR_SYSTEM_ID);
                }
                calls.push({ action: "deactivate", options, effectState });
                return { success: true, data: { entity, effectState } };
            },
            stopShipEntity(_entity, options = {}) {
                calls.push({ action: "stopShip", options });
            },
        },
    };
}
function persistCreationAuthorityStateForTest(shipID, moduleItem, poweredOff, includeModule = true) {
    const update = itemStore.updateInventoryItem(shipID, (currentItem) => {
        let info = {};
        try {
            info = JSON.parse(String(currentItem.customInfo || "{}"));
        }
        catch (_) {
            info = {};
        }
        info[creationRuntime.CREATION_STATE_KEY] = {
            version: creationRuntime.CREATION_STATE_VERSION,
            templateTypeID: currentItem.typeID,
            poweredOff: poweredOff === true,
            modules: includeModule
                ? [{ itemID: moduleItem.itemID, typeID: moduleItem.typeID }]
                : [],
            interiorPlacements: [],
            hardpoints: [],
        };
        return { ...currentItem, customInfo: JSON.stringify(info) };
    });
    assert.equal(update.success, true, update.errorMsg);
    return update.data;
}
test("dispatch rejects spoofed, unadvertised, and foreign-module abilities", () => {
    const creationContext = buildDispatchContext(TYPE_SCANNER);
    const spoofed = creationAbilityRuntime.dispatchCreationAbility({
        ability: "self_destruct_everything",
        kwargs: {},
        session: null,
        creationContext,
        moduleItemID: 500001,
    });
    assert.equal(spoofed.success, false);
    assert.equal(spoofed.errorMsg, "ABILITY_NOT_ADVERTISED");
    // A real ability that belongs to a DIFFERENT behavior must not execute.
    const wrongBehavior = creationAbilityRuntime.dispatchCreationAbility({
        ability: "iff_reconfigure",
        kwargs: { iff_channel: "tribe" },
        session: null,
        creationContext,
        moduleItemID: 500001,
    });
    assert.equal(wrongBehavior.success, false);
    assert.equal(wrongBehavior.errorMsg, "ABILITY_NOT_ADVERTISED");
    // A module that is not part of this Creation is rejected before anything else.
    const foreignModule = creationAbilityRuntime.dispatchCreationAbility({
        ability: "directional_scan",
        kwargs: { scan_angle: 15, scan_direction: [0, 0, 1] },
        session: null,
        creationContext,
        moduleItemID: 999999,
    });
    assert.equal(foreignModule.success, false);
    assert.equal(foreignModule.errorMsg, "MODULE_NOT_IN_CREATION");
    const emptyAbility = creationAbilityRuntime.dispatchCreationAbility({
        ability: "",
        kwargs: {},
        session: null,
        creationContext,
        moduleItemID: 500001,
    });
    assert.equal(emptyAbility.success, false);
    assert.equal(emptyAbility.errorMsg, "ABILITY_EMPTY");
});
test("directional scan requires an in-space session", () => {
    const result = creationAbilityRuntime.dispatchCreationAbility({
        ability: "directional_scan",
        kwargs: { scan_angle: 15, scan_direction: [0, 0, 1] },
        session: { charid: OWNER_ID },
        creationContext: buildDispatchContext(TYPE_SCANNER),
        moduleItemID: 500001,
    });
    assert.equal(result.success, false);
    assert.equal(result.errorMsg, "SHIP_NOT_IN_SPACE");
});
test("powered-off Creation hull rejects scanner and IFF activation", () => {
    for (const [moduleTypeID, ability, kwargs] of [
        [TYPE_SCANNER, "directional_scan", {
                scan_angle: 15,
                scan_direction: [0, 0, 1],
            }],
        [TYPE_TRANSPONDER, "activate_effect", {
                iff_channel: "code",
                iff_code: "RALLY-7",
            }],
        [TYPE_BEACON, "activate_effect", {
                iff_channel: "tribe",
            }],
    ]) {
        const creationContext = buildDispatchContext(moduleTypeID);
        creationContext.state.poweredOff = true;
        const result = creationAbilityRuntime.dispatchCreationAbility({
            ability,
            kwargs,
            session: null,
            creationContext,
            moduleItemID: 500001,
        });
        assert.equal(result.success, false, `${moduleTypeID}:${ability}`);
        assert.equal(result.errorMsg, "CREATION_POWERED_OFF", `${moduleTypeID}:${ability}`);
    }
});
test("directional scan rejects an offline Creation scanner", (t) => {
    const scannerGrant = itemStore.grantItemToCharacterLocation(OWNER_ID, SHIP_ID, creationRuntime.CREATION_FITTING_FLAG_ID, TYPE_SCANNER, 1, {
        individualItems: true,
        singleton: 1,
        moduleState: { online: false },
    });
    assert.equal(scannerGrant.success, true, scannerGrant.errorMsg);
    const scanner = scannerGrant.data.items[0];
    const originalGetEntity = frontierSpaceRuntime.getEntity;
    frontierSpaceRuntime.getEntity = () => ({
        kind: "ship",
        itemID: SHIP_ID,
        position: { x: 0, y: 0, z: 0 },
    });
    t.after(() => {
        frontierSpaceRuntime.getEntity = originalGetEntity;
    });
    const result = creationAbilityRuntime.dispatchCreationAbility({
        ability: "directional_scan",
        kwargs: { scan_angle: 15, scan_direction: [0, 0, 1] },
        session: {
            charid: OWNER_ID,
            characterID: OWNER_ID,
            _space: { systemID: SOLAR_SYSTEM_ID, shipID: SHIP_ID },
        },
        creationContext: buildDispatchContext(TYPE_SCANNER, scanner.itemID),
        moduleItemID: scanner.itemID,
    });
    assert.equal(result.success, false);
    assert.equal(result.errorMsg, "MODULE_OFFLINE");
});
test("ship-wide Creation power state refreshes the live entity", (t) => {
    const shipGrant = itemStore.grantItemToCharacterLocation(OWNER_ID, 64000001, itemStore.ITEM_FLAGS.HANGAR, 95276, 1, { individualItems: true, singleton: 1 });
    assert.equal(shipGrant.success, true, shipGrant.errorMsg);
    const ship = shipGrant.data.items[0];
    assert.equal(creationRuntime.ensureCreationState(ship, OWNER_ID).success, true);
    const refreshCalls = [];
    const originalRefresh = frontierSpaceRuntime.refreshShipDerivedState;
    frontierSpaceRuntime.refreshShipDerivedState = (session, options) => {
        refreshCalls.push({ session, options });
        return { success: true };
    };
    t.after(() => {
        frontierSpaceRuntime.refreshShipDerivedState = originalRefresh;
    });
    const session = {
        characterID: OWNER_ID,
        shipID: ship.itemID,
        compatibilityProfile: "frontier",
        _space: { systemID: SOLAR_SYSTEM_ID, shipID: ship.itemID },
    };
    const service = new CreationService();
    assert.notEqual(service.Handle_set_power_state([ship.itemID, true], session), false);
    assert.equal(refreshCalls.length, 1);
    assert.equal(creationRuntime.getCreationDogmaContext(itemStore.findItemById(ship.itemID), OWNER_ID).data.moduleItems.every((item) => item.moduleState.online === false), true);
    assert.notEqual(service.Handle_set_power_state([ship.itemID, false], session), false);
    assert.equal(refreshCalls.length, 2);
});
test("Creation industry modules cannot be removed while their job is active", () => {
    const shipGrant = itemStore.grantItemToCharacterLocation(OWNER_ID, 64000001, itemStore.ITEM_FLAGS.HANGAR, 95276, 1, { individualItems: true, singleton: 1 });
    assert.equal(shipGrant.success, true, shipGrant.errorMsg);
    const ship = shipGrant.data.items[0];
    const ensured = creationRuntime.ensureCreationState(ship, OWNER_ID);
    assert.equal(ensured.success, true, ensured.errorMsg);
    const printer = ensured.data.state.modules.find((module) => module.typeID === 95302);
    const processor = ensured.data.state.modules.find((module) => module.typeID === 95486);
    assert.ok(printer);
    assert.ok(processor);
    const setProductionState = (state) => {
        const result = itemStore.updateInventoryItem(printer.itemID, (currentItem) => ({
            ...currentItem,
            customInfo: JSON.stringify({
                evejsFrontierIndustry: {
                    version: 1,
                    blueprintID: 1510,
                    production: {
                        version: 1,
                        jobID: 7,
                        state,
                        requestedRuns: 3,
                        completedRuns: 0,
                        runStartedAtMs: 1_700_000_000_000,
                        runEndAtMs: 1_700_000_010_000,
                        stopReason: state === "STOPPED" ? "DISCONTINUED" : null,
                    },
                },
            }),
        }));
        assert.equal(result.success, true, result.errorMsg);
    };
    const removePrinter = () => creationRuntime.commitCreationDraft(itemStore.findItemById(ship.itemID), OWNER_ID, [{
            op: "remove",
            itemID: printer.itemID,
            destLocationID: ship.itemID,
            destFlagID: itemStore.ITEM_FLAGS.CARGO_HOLD,
        }], null);
    for (const state of ["RUNNING", "DISCONTINUING"]) {
        setProductionState(state);
        const versionBefore = itemStore.getItemMutationVersion();
        const blocked = removePrinter();
        assert.equal(blocked.success, false);
        assert.equal(blocked.diagnostics[0].code, "invalid_post_commit_state");
        assert.equal(blocked.diagnostics[0].params.reason, "INDUSTRY_JOB_ACTIVE");
        assert.equal(blocked.diagnostics[0].params.jobID, 7);
        assert.equal(blocked.diagnostics[0].params.state, state);
        assert.equal(itemStore.getItemMutationVersion(), versionBefore);
        assert.equal(itemStore.findItemById(printer.itemID).flagID, creationRuntime.CREATION_FITTING_FLAG_ID);
        assert.ok(creationRuntime.readCreationState(itemStore.findItemById(ship.itemID)).modules
            .some((module) => module.itemID === printer.itemID));
    }
    setProductionState("STOPPED");
    const escrowGrant = itemStore.grantItemsToCharacterLocation(OWNER_ID, printer.itemID, 20000, [{ itemType: 34, quantity: 2 }]);
    assert.equal(escrowGrant.success, true, escrowGrant.errorMsg);
    const escrowVersion = itemStore.getItemMutationVersion();
    const escrowBlocked = removePrinter();
    assert.equal(escrowBlocked.success, false);
    assert.equal(escrowBlocked.diagnostics[0].code, "invalid_post_commit_state");
    assert.equal(escrowBlocked.diagnostics[0].params.reason, "INDUSTRY_ESCROW_NOT_EMPTY");
    assert.equal(escrowBlocked.diagnostics[0].params.inputItems, 1);
    assert.equal(escrowBlocked.diagnostics[0].params.outputItems, 0);
    assert.equal(itemStore.getItemMutationVersion(), escrowVersion);
    assert.equal(itemStore.removeInventoryItem(escrowGrant.data.items[0].itemID).success, true);
    const removed = removePrinter();
    assert.equal(removed.success, true, JSON.stringify(removed.diagnostics));
    assert.equal(itemStore.findItemById(printer.itemID).flagID, itemStore.ITEM_FLAGS.CARGO_HOLD);
    const finalState = creationRuntime.readCreationState(itemStore.findItemById(ship.itemID));
    assert.equal(finalState.modules.some((module) => module.itemID === printer.itemID), false);
    assert.equal(finalState.modules.some((module) => module.itemID === processor.itemID), true, "the other industry module retains its separate Creation industry tab");
});
test("Creation module removal immediately refreshes live cargo and fuel capacity", (t) => {
    const shipGrant = itemStore.grantItemToCharacterLocation(OWNER_ID, 64000001, itemStore.ITEM_FLAGS.HANGAR, 95276, 1, { individualItems: true, singleton: 1 });
    assert.equal(shipGrant.success, true, shipGrant.errorMsg);
    const ship = shipGrant.data.items[0];
    const ensured = creationRuntime.ensureCreationState(ship, OWNER_ID);
    assert.equal(ensured.success, true, ensured.errorMsg);
    const cargoModule = ensured.data.state.modules.find((module) => module.typeID === 95315);
    const fuelModule = ensured.data.state.modules.find((module) => module.typeID === TYPE_FUEL_BAY);
    assert.ok(cargoModule);
    assert.ok(fuelModule);
    const cargoRuntime = require("../src/services/frontier/smartStorageUnitRuntime");
    const getFuelCapacity = () => {
        const currentShip = itemStore.findItemById(ship.itemID);
        const context = creationRuntime.getCreationDogmaContext(currentShip, OWNER_ID);
        assert.equal(context.success, true, context.errorMsg);
        const attributes = liveFittingState.buildEffectiveItemAttributeMap(context.data.item);
        liveFittingState.applyModifierGroups(attributes, context.data.shipAttributeModifierEntries);
        return Number(attributes[5633] || 0);
    };
    const initialCargoCapacity = cargoRuntime.getShipCargoCapacity(OWNER_ID, itemStore.findItemById(ship.itemID));
    const initialFuelCapacity = getFuelCapacity();
    const initialFuelCharge = fuelTankRuntime.getShipFuelCharge(itemStore.findItemById(ship.itemID));
    assert.ok(initialCargoCapacity >= 36);
    assert.ok(initialFuelCapacity >= 500);
    assert.equal(initialFuelCharge, initialFuelCapacity);
    const refresh = t.mock.method(frontierSpaceRuntime, "refreshShipDerivedState", () => ({ success: true }));
    const session = {
        charid: OWNER_ID,
        characterID: OWNER_ID,
        shipid: ship.itemID,
        shipID: ship.itemID,
        _space: { systemID: SOLAR_SYSTEM_ID, shipID: ship.itemID },
        sendNotification() { },
    };
    const service = new CreationService();
    const remove = (itemID) => unwrapMarshalValue(service.Handle_commit_management_draft([ship.itemID, [{
                op: "remove",
                itemID,
                destLocationID: ship.itemID,
                destFlagID: itemStore.ITEM_FLAGS.CARGO_HOLD,
            }]], session));
    assert.deepEqual(remove(cargoModule.itemID), []);
    assert.equal(cargoRuntime.getShipCargoCapacity(OWNER_ID, itemStore.findItemById(ship.itemID)), initialCargoCapacity - 36);
    assert.deepEqual(remove(fuelModule.itemID), []);
    assert.equal(getFuelCapacity(), initialFuelCapacity - 500);
    const shipAfterFuelRemoval = itemStore.findItemById(ship.itemID);
    assert.equal(fuelTankRuntime.getShipFuelCharge(shipAfterFuelRemoval), initialFuelCapacity - 500, "fuel that cannot fit after removing a Fuel Bay is voided");
    assert.equal(fuelTankRuntime.getShipFuelQueue(shipAfterFuelRemoval)
        .reduce((total, entry) => total + entry.quantity, 0), initialFuelCapacity - 500, "the persisted FIFO fuel queue is trimmed with fuelCharge");
    assert.equal(refresh.mock.callCount(), 2);
});
test("Creation draft validation rejects invalid SDE geometry before inventory mutation", () => {
    const shipGrant = itemStore.grantItemToCharacterLocation(OWNER_ID, 64000001, itemStore.ITEM_FLAGS.HANGAR, 95276, 1, { individualItems: true, singleton: 1 });
    assert.equal(shipGrant.success, true, shipGrant.errorMsg);
    const ship = shipGrant.data.items[0];
    const ensured = creationRuntime.ensureCreationState(ship, OWNER_ID);
    assert.equal(ensured.success, true, ensured.errorMsg);
    const moduleGrant = itemStore.grantItemToCharacterLocation(OWNER_ID, ship.itemID, itemStore.ITEM_FLAGS.CARGO_HOLD, TYPE_BEACON, 1, { individualItems: true, singleton: 1 });
    assert.equal(moduleGrant.success, true, moduleGrant.errorMsg);
    const moduleItem = moduleGrant.data.items[0];
    const template = getCreationTemplate(ship.typeID);
    const partID = Number(Object.keys(template.parts)[0]);
    const stateBefore = creationRuntime.readCreationState(itemStore.findItemById(ship.itemID));
    const mutationVersionBefore = itemStore.getItemMutationVersion();
    const diagnostics = unwrapMarshalValue(new CreationService().Handle_commit_management_draft([ship.itemID, [{
                op: "add",
                itemID: moduleItem.itemID,
                typeID: TYPE_BEACON,
                partID,
                sourceLocationID: ship.itemID,
                sourceFlagID: itemStore.ITEM_FLAGS.CARGO_HOLD,
                x: 1000,
                y: 1000,
                z: 0,
                rotationX: 0,
                rotationY: 0,
                rotationZ: 0,
            }]], {
        charid: OWNER_ID,
        characterID: OWNER_ID,
        shipid: ship.itemID,
        shipID: ship.itemID,
        sendNotification() { },
    }));
    assert.ok(diagnostics.some((entry) => entry.code === "invalid_placement" &&
        entry.params.reason === "CELL_OUTSIDE_PART"));
    assert.equal(itemStore.getItemMutationVersion(), mutationVersionBefore);
    assert.equal(itemStore.findItemById(moduleItem.itemID).flagID, itemStore.ITEM_FLAGS.CARGO_HOLD);
    assert.deepEqual(creationRuntime.readCreationState(itemStore.findItemById(ship.itemID)), stateBefore);
});
test("Creation fitting splits one singleton and Dogma bridges online state", () => {
    const stationID = 64000001;
    const shipGrant = itemStore.grantItemToCharacterLocation(OWNER_ID, stationID, itemStore.ITEM_FLAGS.HANGAR, 95276, 1, { individualItems: true, singleton: 1 });
    assert.equal(shipGrant.success, true, shipGrant.errorMsg);
    const ship = shipGrant.data.items[0];
    assert.ok(ship && ship.itemID > 0);
    const initiallyEnsured = creationRuntime.ensureCreationState(ship, OWNER_ID);
    assert.equal(initiallyEnsured.success, true, initiallyEnsured.errorMsg);
    const stackGrant = itemStore.grantItemToCharacterLocation(OWNER_ID, ship.itemID, itemStore.ITEM_FLAGS.CARGO_HOLD, TYPE_BEACON, 2, { singleton: 0 });
    assert.equal(stackGrant.success, true, stackGrant.errorMsg);
    const sourceStack = stackGrant.data.items[0];
    assert.equal(sourceStack.stacksize, 2);
    const template = getCreationTemplate(ship.typeID);
    const beaconPlacement = findValidInteriorPlacement(initiallyEnsured.data.state, template, sourceStack.itemID, TYPE_BEACON);
    const notifications = [];
    const session = {
        charid: OWNER_ID,
        characterID: OWNER_ID,
        shipid: ship.itemID,
        shipID: ship.itemID,
        shipTypeID: ship.typeID,
        compatibilityProfile: "frontier",
        sendNotification(name, idType, payload) {
            notifications.push({ name, idType, payload });
        },
    };
    const service = new CreationService();
    const mutationVersionBeforeInstall = itemStore.getItemMutationVersion();
    const commitDiagnostics = unwrapMarshalValue(service.Handle_commit_management_draft([ship.itemID, [{
                op: "add",
                itemID: sourceStack.itemID,
                typeID: TYPE_BEACON,
                partID: beaconPlacement.partID,
                sourceLocationID: ship.itemID,
                sourceFlagID: itemStore.ITEM_FLAGS.CARGO_HOLD,
                x: beaconPlacement.x,
                y: beaconPlacement.y,
                z: beaconPlacement.z,
                rotationX: beaconPlacement.rotation.x,
                rotationY: beaconPlacement.rotation.y,
                rotationZ: beaconPlacement.rotation.z,
            }]], session));
    assert.deepEqual(commitDiagnostics, []);
    assert.equal(itemStore.getItemMutationVersion() - mutationVersionBeforeInstall, 1, "the module move and hull layout must use one item-table commit");
    assert.equal(notifications.filter((entry) => entry.name === "OnCreationChanged").length, 1);
    let fitted = itemStore.findItemById(sourceStack.itemID);
    assert.equal(fitted.locationID, ship.itemID);
    assert.equal(fitted.flagID, creationRuntime.CREATION_FITTING_FLAG_ID);
    assert.equal(fitted.singleton, 1);
    assert.equal(fitted.stacksize, 1);
    assert.equal(fitted.quantity, -1);
    let cargoRemainders = itemStore
        .listContainerItems(OWNER_ID, ship.itemID, itemStore.ITEM_FLAGS.CARGO_HOLD)
        .filter((entry) => entry.typeID === TYPE_BEACON);
    assert.equal(cargoRemainders.length, 1);
    assert.notEqual(cargoRemainders[0].itemID, sourceStack.itemID);
    assert.equal(cargoRemainders[0].singleton, 0);
    assert.equal(cargoRemainders[0].stacksize, 1);
    const persistedShip = itemStore.findItemById(ship.itemID);
    assert.ok(creationRuntime.readCreationState(persistedShip).modules
        .some((module) => module.itemID === sourceStack.itemID));
    // Reproduce the pre-fix persisted shape and prove hydration repairs it: the
    // selected itemID remains fitted while the extra unit returns to cargo.
    assert.equal(itemStore.removeInventoryItem(cargoRemainders[0].itemID, { removeContents: true }).success, true);
    assert.equal(itemStore.updateInventoryItem(fitted.itemID, (currentItem) => ({
        ...currentItem,
        quantity: 2,
        stacksize: 2,
        singleton: 0,
    })).success, true);
    const repaired = creationRuntime.ensureCreationState(itemStore.findItemById(ship.itemID), OWNER_ID);
    assert.equal(repaired.success, true, repaired.errorMsg);
    fitted = itemStore.findItemById(sourceStack.itemID);
    assert.equal(fitted.singleton, 1);
    assert.equal(fitted.stacksize, 1);
    cargoRemainders = itemStore
        .listContainerItems(OWNER_ID, ship.itemID, itemStore.ITEM_FLAGS.CARGO_HOLD)
        .filter((entry) => entry.typeID === TYPE_BEACON);
    assert.equal(cargoRemainders.length, 1);
    assert.equal(cargoRemainders[0].stacksize, 1);
    assert.equal(creationRuntime.isCreationModuleOnline(fitted), false, "a newly fitted component waits for manual onlining");
    const dogma = new DogmaService();
    const online = dogma._setModuleOnlineState(ship.itemID, sourceStack.itemID, true, session);
    assert.equal(online.success, true, online.errorMsg);
    assert.equal(creationRuntime.isCreationModuleOnline(itemStore.findItemById(sourceStack.itemID)), true);
    const offline = dogma._setModuleOnlineState(ship.itemID, sourceStack.itemID, false, session);
    assert.equal(offline.success, true, offline.errorMsg);
    assert.equal(creationRuntime.isCreationModuleOnline(itemStore.findItemById(sourceStack.itemID)), false);
    assert.equal(notifications.filter((entry) => entry.name === "OnMultiEvent").length, 2);
    const stateBeforeUndock = creationRuntime.readCreationState(itemStore.findItemById(ship.itemID));
    assert.ok(stateBeforeUndock);
    const undock = itemStore.moveShipToSpace(ship.itemID, SOLAR_SYSTEM_ID, {
        position: { x: 10, y: 20, z: 30 },
        direction: { x: 0, y: 0, z: 1 },
        velocity: { x: 0, y: 0, z: 0 },
        mode: "STOP",
        customInfo: `Undocking:${stationID}`,
    });
    assert.equal(undock.success, true, undock.errorMsg);
    assert.equal(undock.data.clientCustomInfo, `Undocking:${stationID}`);
    const persistedAfterUndock = itemStore.findItemById(ship.itemID);
    assert.deepEqual(creationRuntime.readCreationState(persistedAfterUndock), stateBeforeUndock);
    assert.equal(creationRuntime.isCreationModuleOnline(itemStore.findItemById(sourceStack.itemID)), false);
    const rehydrated = creationRuntime.ensureCreationState(persistedAfterUndock, OWNER_ID);
    assert.equal(rehydrated.success, true, rehydrated.errorMsg);
    assert.equal(rehydrated.data.seeded, false);
    assert.deepEqual(rehydrated.data.state, stateBeforeUndock);
    assert.equal(creationRuntime.isCreationModuleOnline(itemStore.findItemById(sourceStack.itemID)), false);
    const mutationVersionBeforeRemove = itemStore.getItemMutationVersion();
    const removeDiagnostics = unwrapMarshalValue(service.Handle_commit_management_draft([ship.itemID, [{
                op: "remove",
                itemID: sourceStack.itemID,
                // The 3.12 client may serialize an implicit cargo destination as None.
                // The server must normalize that to this Creation's cargo hold.
                destLocationID: null,
                destFlagID: null,
            }]], session));
    assert.deepEqual(removeDiagnostics, []);
    assert.equal(itemStore.getItemMutationVersion() - mutationVersionBeforeRemove, 1, "the uninstall and hull layout must use one item-table commit");
    const removedModule = itemStore.findItemById(sourceStack.itemID);
    assert.equal(removedModule.locationID, ship.itemID);
    assert.equal(removedModule.flagID, itemStore.ITEM_FLAGS.CARGO_HOLD);
    assert.equal(creationRuntime.readCreationState(itemStore.findItemById(ship.itemID)).modules
        .some((module) => module.itemID === sourceStack.itemID), false);
    assert.equal(notifications.filter((entry) => entry.name === "OnCreationChanged").length, 2);
    // Drop the item-store cache to model a fresh server process. Both sides of
    // the uninstall must already be present in the durable item table.
    itemStore.resetInventoryStoreForTests();
    const restartedShip = itemStore.findItemById(ship.itemID);
    const restartedModule = itemStore.findItemById(sourceStack.itemID);
    assert.equal(restartedModule.locationID, ship.itemID);
    assert.equal(restartedModule.flagID, itemStore.ITEM_FLAGS.CARGO_HOLD);
    assert.equal(creationRuntime.readCreationState(restartedShip).modules
        .some((module) => module.itemID === sourceStack.itemID), false);
});
// ── Phase 2: transponder configuration and beacon visibility ─────────────
test("transponder configuration validation matches the client contract", () => {
    const channels = iffRuntime.IFF_BEACON_CHANNELS;
    assert.deepEqual(iffRuntime.normalizeIffConfiguration("tribe", null, channels), { channel: "tribe", code: null });
    assert.deepEqual(iffRuntime.normalizeIffConfiguration("code", "RALLY-7", channels), { channel: "code", code: "RALLY-7" });
    // Channel off.
    assert.deepEqual(iffRuntime.normalizeIffConfiguration(null, "ignored", channels), { channel: null, code: null });
    // Casing is normalized to the client's lowercase StrEnum values.
    assert.equal(iffRuntime.normalizeIffConfiguration("TRIBE", null, channels).channel, "tribe");
    assert.equal(iffRuntime.normalizeIffConfiguration("bogus", null, channels).errorMsg, "IFF_CHANNEL_INVALID");
    assert.equal(iffRuntime.normalizeIffConfiguration("code", "", channels).errorMsg, "IFF_CODE_REQUIRED");
    assert.equal(iffRuntime.normalizeIffConfiguration("code", "x".repeat(33), channels).errorMsg, "IFF_CODE_TOO_LONG");
    assert.equal(iffRuntime.normalizeIffConfiguration("code", "x".repeat(32), channels).code.length, 32);
    // The cairn surface only offers the mutual channels.
    assert.equal(iffRuntime.normalizeIffConfiguration("public", null, iffRuntime.IFF_TRANSPONDER_CHANNELS).errorMsg, "IFF_CHANNEL_INVALID");
});
test("Frontier Dogma effects retain their authored activation contract", () => {
    const broadcast = liveFittingState.getEffectTypeRecord(12972);
    const beacon = liveFittingState.getEffectTypeRecord(12974);
    assert.equal(broadcast.name, "iffBroadcast");
    assert.equal(broadcast.effectCategoryID, 1);
    assert.equal(broadcast.durationAttributeID, 73);
    assert.equal(beacon.name, "iffBeacon");
    assert.equal(beacon.effectCategoryID, 1);
    assert.equal(beacon.disallowAutoRepeat, true);
});
test("Creation live entities enforce their derived capacitor and retain active modules", (t) => {
    const stationID = 64000001;
    const previousActiveShip = itemStore.getActiveShipItem(OWNER_ID);
    t.after(() => {
        if (previousActiveShip) {
            itemStore.setActiveShipForCharacter(OWNER_ID, previousActiveShip.itemID);
        }
    });
    const shipGrant = itemStore.grantItemToCharacterLocation(OWNER_ID, stationID, itemStore.ITEM_FLAGS.HANGAR, 95276, 1, { individualItems: true, singleton: 1 });
    assert.equal(shipGrant.success, true, shipGrant.errorMsg);
    const ship = shipGrant.data.items[0];
    const ensured = creationRuntime.ensureCreationState(ship, OWNER_ID);
    assert.equal(ensured.success, true, ensured.errorMsg);
    // Bring the template modules online for this derived-state fixture.
    for (const module of ensured.data.state.modules) {
        if (liveFittingState.getTypeDogmaEffects(module.typeID).has(16)) {
            assert.equal(itemStore.updateInventoryItem(module.itemID, (item) => ({
                ...item,
                moduleState: { ...(item.moduleState || {}), online: true },
            })).success, true);
        }
    }
    const moduleGrant = itemStore.grantItemToCharacterLocation(OWNER_ID, ship.itemID, itemStore.ITEM_FLAGS.CARGO_HOLD, TYPE_TRANSPONDER, 1, { individualItems: true, singleton: 1 });
    assert.equal(moduleGrant.success, true, moduleGrant.errorMsg);
    const sourceModule = moduleGrant.data.items[0];
    const blackstartGrant = itemStore.grantItemToCharacterLocation(OWNER_ID, ship.itemID, itemStore.ITEM_FLAGS.CARGO_HOLD, TYPE_BLACKSTART_CELL, 1, { individualItems: true, singleton: 1 });
    assert.equal(blackstartGrant.success, true, blackstartGrant.errorMsg);
    const sourceBlackstart = blackstartGrant.data.items[0];
    const template = getCreationTemplate(ship.typeID);
    const transponderPlacement = findValidInteriorPlacement(ensured.data.state, template, sourceModule.itemID, TYPE_TRANSPONDER);
    const stateWithTransponder = stateWithInteriorModule(ensured.data.state, sourceModule.itemID, TYPE_TRANSPONDER, transponderPlacement);
    const blackstartPlacement = findValidInteriorPlacement(stateWithTransponder, template, sourceBlackstart.itemID, TYPE_BLACKSTART_CELL);
    const commit = creationRuntime.commitCreationDraft(ship, OWNER_ID, [
        {
            op: "add",
            itemID: sourceModule.itemID,
            typeID: TYPE_TRANSPONDER,
            partID: transponderPlacement.partID,
            sourceLocationID: ship.itemID,
            sourceFlagID: itemStore.ITEM_FLAGS.CARGO_HOLD,
            x: transponderPlacement.x,
            y: transponderPlacement.y,
            z: transponderPlacement.z,
            rotationX: transponderPlacement.rotation.x,
            rotationY: transponderPlacement.rotation.y,
            rotationZ: transponderPlacement.rotation.z,
        },
        {
            op: "add",
            itemID: sourceBlackstart.itemID,
            typeID: TYPE_BLACKSTART_CELL,
            partID: blackstartPlacement.partID,
            sourceLocationID: ship.itemID,
            sourceFlagID: itemStore.ITEM_FLAGS.CARGO_HOLD,
            x: blackstartPlacement.x,
            y: blackstartPlacement.y,
            z: blackstartPlacement.z,
            rotationX: blackstartPlacement.rotation.x,
            rotationY: blackstartPlacement.rotation.y,
            rotationZ: blackstartPlacement.rotation.z,
        },
    ], null);
    assert.equal(commit.success, true, JSON.stringify(commit.diagnostics));
    assert.equal(itemStore.setActiveShipForCharacter(OWNER_ID, ship.itemID).success, true);
    for (const moduleID of [sourceModule.itemID, sourceBlackstart.itemID]) {
        const online = creationRuntime.setCreationModuleOnlineState(itemStore.findItemById(ship.itemID), OWNER_ID, moduleID, true);
        assert.equal(online.success, true, online.errorMsg);
    }
    const fueledShip = itemStore.findShipItemById(ship.itemID);
    const fuelCapacity = creationRuntime.getCreationStateCapacities(fueledShip, OWNER_ID, creationRuntime.readCreationState(fueledShip)).fuelCapacity;
    const reserveCapacity = fuelTankRuntime.resolveCreationReserveFuelCapacity(fueledShip, fuelTankRuntime.resolveShipFuelTank(fueledShip, fuelCapacity));
    const fuelQueue = fuelTankRuntime.partitionFuelQueueByReserveCapacity([{ fuelTypeID: fuelTankRuntime.UNSTABLE_FUEL_TYPE_ID, quantity: fuelCapacity }], fuelCapacity, reserveCapacity);
    assert.equal(itemStore.updateShipItem(ship.itemID, (item) => ({
        ...item,
        conditionState: {
            ...(item.conditionState || {}),
            fuelCharge: fuelCapacity,
            fuelTypeID: fuelTankRuntime.UNSTABLE_FUEL_TYPE_ID,
            fuelQueue,
        },
    })).success, true);
    const session = {
        charid: OWNER_ID,
        characterID: OWNER_ID,
        shipid: ship.itemID,
        shipID: ship.itemID,
        solarsystemid: SOLAR_SYSTEM_ID,
        solarsystemid2: SOLAR_SYSTEM_ID,
        compatibilityProfile: "frontier",
        sendNotification() { },
    };
    const entity = frontierSpaceRuntime._testing.buildShipEntityForTesting(session, itemStore.findItemById(ship.itemID), SOLAR_SYSTEM_ID);
    assert.equal(entity.capacitorCapacity, 300);
    assert.equal(entity.capacitorChargeRatio, 2 / 3);
    assert.equal(entity.passiveDerivedState.attributes[6250], 1_800_000_000);
    assert.equal(entity.maxVelocity, 360);
    const startPosition = { ...entity.position };
    entity.mode = "GOTO";
    entity.speedFraction = 1;
    entity.targetPoint = {
        x: startPosition.x + 10_000,
        y: startPosition.y,
        z: startPosition.z,
    };
    const movement = frontierSpaceRuntime._testing.advanceMovementForTesting(entity, null, 1, Date.now());
    assert.equal(movement.changed, true);
    assert.ok(entity.position.x > startPosition.x);
    assert.ok(Math.hypot(entity.velocity.x, entity.velocity.y, entity.velocity.z) > 0);
    const moduleItem = itemStore.findItemById(sourceModule.itemID);
    const moduleOwnerIDs = frontierSpaceRuntime._testing
        .getEntityRuntimeModuleOwnerItemsForTesting(entity)
        .map((item) => Number(item.itemID));
    assert.equal(moduleOwnerIDs.includes(moduleItem.itemID), true);
    const scene = new frontierSpaceRuntime._testing.SolarSystemScene(SOLAR_SYSTEM_ID);
    entity.session = session;
    scene.dynamicEntities.set(entity.itemID, entity);
    session._space = {
        systemID: SOLAR_SYSTEM_ID,
        shipID: entity.itemID,
    };
    scene.sessions.set(OWNER_ID, session);
    const activation = scene.activateGenericModule(session, moduleItem, "iffBroadcast", { repeat: 0 });
    assert.equal(activation.success, true, activation.errorMsg);
    assert.equal(entity.activeModuleEffects.has(moduleItem.itemID), true);
    assert.equal(Number((entity.capacitorCapacity * entity.capacitorChargeRatio).toFixed(6)), 195);
    const refresh = scene.refreshShipEntityDerivedState(entity, {
        session,
        broadcast: false,
        notifyDerivedAttributes: false,
    });
    assert.equal(refresh.success, true, refresh.errorMsg);
    assert.equal(entity.capacitorCapacity, 300);
    assert.equal(entity.activeModuleEffects.has(moduleItem.itemID), true);
    const capacitorBeforeOffline = scene.getShipCapacitorState(session).amount;
    assert.equal(creationRuntime.setCreationModuleOnlineState(itemStore.findItemById(ship.itemID), OWNER_ID, moduleItem.itemID, false, session).success, true);
    const offlineRefresh = scene.refreshShipEntityDerivedState(entity, {
        session,
        broadcast: false,
        notifyDerivedAttributes: false,
    });
    assert.equal(offlineRefresh.success, true, offlineRefresh.errorMsg);
    assert.equal(entity.activeModuleEffects.has(moduleItem.itemID), false);
    assert.equal(scene.getShipCapacitorState(session).amount, capacitorBeforeOffline);
    const creationContext = creationRuntime.getCreationDogmaContext(itemStore.findItemById(ship.itemID), OWNER_ID);
    assert.equal(creationContext.success, true, creationContext.errorMsg);
    const capacitorModules = creationContext.data.moduleItems.filter((item) => item.typeID === TYPE_CAPACITOR);
    const movementModule = creationContext.data.moduleItems.find((item) => item.typeID === 95320 || item.typeID === 95326);
    const reserveFuelModule = creationContext.data.moduleItems.find((item) => item.typeID === 96013);
    const blackstartModule = creationContext.data.moduleItems.find((item) => item.typeID === TYPE_BLACKSTART_CELL);
    assert.ok(capacitorModules.length > 0);
    assert.ok(movementModule);
    assert.ok(reserveFuelModule);
    assert.ok(blackstartModule);
    assert.equal(creationRuntime.isCreationModuleOnline(itemStore.findItemById(reserveFuelModule.itemID)), true, "the template Fuel Blister starts online before it is sealed");
    for (const capacitorModule of capacitorModules) {
        assert.equal(creationRuntime.setCreationModuleOnlineState(itemStore.findItemById(ship.itemID), OWNER_ID, capacitorModule.itemID, false, session).success, true);
    }
    assert.equal(scene.refreshShipEntityDerivedState(entity, {
        session,
        broadcast: false,
        notifyDerivedAttributes: false,
    }).success, true);
    assert.equal(entity.capacitorCapacity, 100);
    const onlineMaxVelocity = entity.maxVelocity;
    assert.equal(creationRuntime.setCreationModuleOnlineState(itemStore.findItemById(ship.itemID), OWNER_ID, movementModule.itemID, false, session).success, true);
    assert.equal(scene.refreshShipEntityDerivedState(entity, {
        session,
        broadcast: false,
        notifyDerivedAttributes: false,
    }).success, true);
    assert.ok(entity.maxVelocity < onlineMaxVelocity);
    const fuelCapacityBeforeOffline = Number(entity.passiveDerivedState.attributes[5633]);
    const fuelChargeBeforeOffline = fuelTankRuntime.getShipFuelCharge(itemStore.findShipItemById(ship.itemID));
    assert.equal(creationRuntime.setCreationModuleOnlineState(itemStore.findItemById(ship.itemID), OWNER_ID, reserveFuelModule.itemID, false, session).success, true);
    assert.equal(scene.refreshShipEntityDerivedState(entity, {
        session,
        broadcast: false,
        notifyDerivedAttributes: false,
    }).success, true);
    assert.equal(Number(entity.passiveDerivedState.attributes[5633]), fuelCapacityBeforeOffline - 250);
    const sealedBlister = itemStore.findItemById(reserveFuelModule.itemID);
    assert.equal(sealedBlister.moduleState.reserveFuelCharge, 250);
    assert.equal(fuelTankRuntime.getShipFuelCharge(itemStore.findShipItemById(ship.itemID)), fuelChargeBeforeOffline - 250);
    assert.equal(creationRuntime.setCreationModuleOnlineState(itemStore.findItemById(ship.itemID), OWNER_ID, reserveFuelModule.itemID, true, session).success, true);
    assert.equal(fuelTankRuntime.getShipFuelCharge(itemStore.findShipItemById(ship.itemID)), fuelChargeBeforeOffline);
    assert.equal(itemStore.findItemById(reserveFuelModule.itemID).moduleState.reserveFuelCharge, 0);
    assert.equal(creationRuntime.setCreationModuleOnlineState(itemStore.findItemById(ship.itemID), OWNER_ID, reserveFuelModule.itemID, false, session).success, true);
    assert.equal(itemStore.findItemById(reserveFuelModule.itemID).moduleState.reserveFuelCharge, 250);
    const removedBlister = creationRuntime.commitCreationDraft(itemStore.findItemById(ship.itemID), OWNER_ID, [{
            op: "remove",
            itemID: reserveFuelModule.itemID,
            destLocationID: ship.itemID,
            destFlagID: itemStore.ITEM_FLAGS.CARGO_HOLD,
        }], session);
    assert.equal(removedBlister.success, true, JSON.stringify(removedBlister.diagnostics));
    assert.equal(itemStore.findItemById(reserveFuelModule.itemID).moduleState.reserveFuelCharge, 0, "sealed Fuel Blister contents are voided atomically when it is removed");
    assert.deepEqual(itemStore.findItemById(reserveFuelModule.itemID).moduleState.reserveFuelQueue, []);
    assert.equal(itemStore.updateShipItem(ship.itemID, (shipItem) => ({
        ...shipItem,
        conditionState: { ...(shipItem.conditionState || {}), charge: 1 },
    })).success, true);
    assert.equal(scene.refreshShipEntityDerivedState(entity, {
        session,
        broadcast: false,
        notifyDerivedAttributes: false,
    }).success, true);
    assert.equal(scene.getShipCapacitorState(session).amount, 100);
    const blackstartOffline = creationRuntime.setCreationModuleOnlineState(itemStore.findItemById(ship.itemID), OWNER_ID, blackstartModule.itemID, false, session);
    assert.equal(blackstartOffline.success, true, blackstartOffline.errorMsg);
    assert.equal(blackstartOffline.data.voidedBlackstartEnergy, 100);
    assert.equal(scene.refreshShipEntityDerivedState(entity, {
        session,
        broadcast: false,
        notifyDerivedAttributes: false,
    }).success, true);
    assert.equal(entity.capacitorCapacity, 0);
    assert.equal(scene.getShipCapacitorState(session).amount, 0);
    const blackstartOnline = creationRuntime.setCreationModuleOnlineState(itemStore.findItemById(ship.itemID), OWNER_ID, blackstartModule.itemID, true, session);
    assert.equal(blackstartOnline.success, true, blackstartOnline.errorMsg);
    assert.equal(scene.refreshShipEntityDerivedState(entity, {
        session,
        broadcast: false,
        notifyDerivedAttributes: false,
    }).success, true);
    assert.equal(entity.capacitorCapacity, 100);
    assert.equal(scene.getShipCapacitorState(session).amount, 0, "onlining an empty Blackstart Cell must not mint its 100 GJ reserve");
    assert.equal(itemStore.updateShipItem(ship.itemID, (shipItem) => ({
        ...shipItem,
        conditionState: { ...(shipItem.conditionState || {}), charge: 1 },
    })).success, true);
    const removedBlackstart = creationRuntime.commitCreationDraft(itemStore.findItemById(ship.itemID), OWNER_ID, [{
            op: "remove",
            itemID: blackstartModule.itemID,
            destLocationID: ship.itemID,
            destFlagID: itemStore.ITEM_FLAGS.CARGO_HOLD,
        }], session);
    assert.equal(removedBlackstart.success, true, JSON.stringify(removedBlackstart.diagnostics));
    assert.equal(removedBlackstart.data.voidedBlackstartEnergy, 100);
    assert.equal(itemStore.findShipItemById(ship.itemID).conditionState.charge, 0, "removing a Blackstart Cell discards charge stored in its reserve");
});
test("GUI installation leaves a Transponder offline until manually onlined", (t) => {
    const shipGrant = itemStore.grantItemToCharacterLocation(OWNER_ID, 64000004, itemStore.ITEM_FLAGS.HANGAR, 95276, 1, { individualItems: true, singleton: 1 });
    assert.equal(shipGrant.success, true, shipGrant.errorMsg);
    const ship = shipGrant.data.items[0];
    const ensured = creationRuntime.ensureCreationState(ship, OWNER_ID);
    assert.equal(ensured.success, true, ensured.errorMsg);
    for (const seededModule of ensured.data.state.modules) {
        if (liveFittingState.getTypeDogmaEffects(seededModule.typeID).has(16)) {
            assert.equal(creationRuntime.isCreationModuleOnline(itemStore.findItemById(seededModule.itemID)), false, "template installed modules start offline");
        }
    }
    const moduleGrant = itemStore.grantItemToCharacterLocation(OWNER_ID, ship.itemID, itemStore.ITEM_FLAGS.CARGO_HOLD, TYPE_TRANSPONDER, 1, { individualItems: true, singleton: 1, moduleState: { online: false } });
    assert.equal(moduleGrant.success, true, moduleGrant.errorMsg);
    const moduleItem = moduleGrant.data.items[0];
    assert.equal(creationRuntime.isCreationModuleOnline(moduleItem), false);
    const placement = findValidInteriorPlacement(ensured.data.state, getCreationTemplate(ship.typeID), moduleItem.itemID, TYPE_TRANSPONDER);
    const notifications = [];
    const session = {
        charid: OWNER_ID,
        characterID: OWNER_ID,
        shipid: ship.itemID,
        shipID: ship.itemID,
        solarsystemid: SOLAR_SYSTEM_ID,
        solarsystemid2: SOLAR_SYSTEM_ID,
        compatibilityProfile: "frontier",
        _space: {
            systemID: SOLAR_SYSTEM_ID,
            shipID: ship.itemID,
            simFileTime: currentFileTime(),
        },
        sendNotification(name, idType, payload) {
            notifications.push({ name, idType, payload });
        },
    };
    const refresh = t.mock.method(frontierSpaceRuntime, "refreshShipDerivedState", () => ({ success: true }));
    const diagnostics = unwrapMarshalValue(new CreationService().Handle_commit_management_draft([ship.itemID, [{
                op: "add",
                itemID: moduleItem.itemID,
                typeID: TYPE_TRANSPONDER,
                partID: placement.partID,
                sourceLocationID: ship.itemID,
                sourceFlagID: itemStore.ITEM_FLAGS.CARGO_HOLD,
                x: placement.x,
                y: placement.y,
                z: placement.z,
                rotationX: placement.rotation.x,
                rotationY: placement.rotation.y,
                rotationZ: placement.rotation.z,
            }]], session));
    assert.deepEqual(diagnostics, []);
    const primeIndex = notifications.findIndex((entry) => entry.name === "OnGodmaPrimeItem");
    const itemChangeIndex = notifications.findIndex((entry) => entry.name === "OnItemChange" && entry.payload[0].fields.itemID === moduleItem.itemID);
    const onlineEffectIndex = notifications.findIndex((entry) => entry.name === "OnMultiEvent" &&
        entry.payload[0].items.some((pair) => pair.items[0].items[0] === "OnGodmaShipEffect" &&
            pair.items[0].items[1] === moduleItem.itemID &&
            pair.items[0].items[2] === 16));
    const creationChangedIndex = notifications.findIndex((entry) => entry.name === "OnCreationChanged");
    assert.ok(primeIndex >= 0, "the client must receive a live Dogma module prime");
    assert.ok(itemChangeIndex > primeIndex, "the module is primed before its inventory move");
    assert.equal(onlineEffectIndex, -1, "installation must not start the online effect");
    assert.ok(creationChangedIndex > itemChangeIndex, "the action-bar snapshot is published after the offline module is fitted");
    const prime = notifications[primeIndex];
    assert.equal(prime.payload[0], ship.itemID);
    const primeFields = Object.fromEntries(prime.payload[1].args.entries);
    assert.equal(primeFields.itemID, moduleItem.itemID);
    assert.ok(primeFields.attributes.entries.length > 0);
    const primeAttributes = new Map(primeFields.attributes.entries);
    const isOnlineAttributeID = liveFittingState.getAttributeIDByNames("isOnline") || 2;
    assert.deepEqual(primeAttributes.get(isOnlineAttributeID), [0, session._space.simFileTime], "the fitted module must be primed offline before the power view reads it");
    for (const [attributeID, valueAndTime] of primeFields.attributes.entries) {
        assert.equal(typeof attributeID, "number");
        assert.ok(Array.isArray(valueAndTime));
        assert.equal(valueAndTime.length, 2);
        assert.deepEqual(valueAndTime, [valueAndTime[0], session._space.simFileTime], "Frontier Godma must receive a value/time pair for every primed attribute");
        assert.equal(typeof valueAndTime[0], "number");
    }
    assert.equal(refresh.mock.callCount(), 1);
    const persistedShip = itemStore.findItemById(ship.itemID);
    const installedModule = itemStore.findItemById(moduleItem.itemID);
    assert.equal(creationRuntime.isCreationModuleOnline(installedModule), false, JSON.stringify({
        installedModule,
        effects: [...liveFittingState.getTypeDogmaEffects(TYPE_TRANSPONDER)],
    }));
    const online = new DogmaService()._setModuleOnlineState(ship.itemID, moduleItem.itemID, true, session);
    assert.equal(online.success, true, online.errorMsg);
    const onlineEvents = notifications.filter((entry) => entry.name === "OnMultiEvent");
    assert.equal(onlineEvents.length, 1);
    const onlineSubEvents = onlineEvents[0].payload[0].items
        .map((pair) => pair.items[0].items);
    assert.ok(onlineSubEvents.some((subEvent) => subEvent[0] === "OnGodmaShipEffect" &&
        subEvent[1] === moduleItem.itemID &&
        subEvent[2] === 16 &&
        subEvent[4] === 1 &&
        subEvent[5] === 1));
    const effectRuntime = buildIffEffectRuntime(ship.itemID);
    const activated = creationAbilityRuntime.dispatchCreationAbility({
        ability: "activate_effect",
        kwargs: { iff_channel: "code", iff_code: "LIVE-FIT" },
        session,
        creationContext: {
            item: persistedShip,
            characterID: OWNER_ID,
            state: creationRuntime.readCreationState(persistedShip),
        },
        moduleItemID: moduleItem.itemID,
        abilityDependencies: { spaceRuntime: effectRuntime.runtime },
    });
    assert.equal(activated.success, true, activated.errorMsg);
});
test("transponder activation broadcasts explicitly and deactivation preserves its mode", () => {
    const shipGrant = itemStore.grantItemToCharacterLocation(OWNER_ID, 64000004, itemStore.ITEM_FLAGS.HANGAR, 95276, 1, { individualItems: true, singleton: 1 });
    assert.equal(shipGrant.success, true, shipGrant.errorMsg);
    const ship = shipGrant.data.items[0];
    const moduleGrant = itemStore.grantItemToCharacterLocation(OWNER_ID, ship.itemID, creationRuntime.CREATION_FITTING_FLAG_ID, TYPE_TRANSPONDER, 1, {
        individualItems: true,
        singleton: 1,
        moduleState: { online: true },
    });
    assert.equal(moduleGrant.success, true, moduleGrant.errorMsg);
    const moduleItem = moduleGrant.data.items[0];
    const persistedShip = persistCreationAuthorityStateForTest(ship.itemID, moduleItem, false);
    const persistedState = creationRuntime.readCreationState(persistedShip);
    const creationContext = {
        item: persistedShip,
        characterID: OWNER_ID,
        state: persistedState,
    };
    const effectRuntime = buildIffEffectRuntime(ship.itemID);
    const session = {
        charid: OWNER_ID,
        characterID: OWNER_ID,
        shipid: ship.itemID,
        solarsystemid: SOLAR_SYSTEM_ID,
        solarsystemid2: SOLAR_SYSTEM_ID,
        _space: { systemID: SOLAR_SYSTEM_ID },
        sendNotification() { },
    };
    const invoke = (ability, kwargs = {}) => creationAbilityRuntime.dispatchCreationAbility({
        ability,
        kwargs,
        session,
        creationContext,
        moduleItemID: moduleItem.itemID,
        abilityDependencies: { spaceRuntime: effectRuntime.runtime },
    });
    const peer = {
        shipID: ship.itemID + 1,
        corporationID: 98000001,
        transponder: { channel: "code", code: "RALLY-7" },
    };
    const broadcastVerdicts = () => buildVerdictsForViewer(peer, [
        peer,
        {
            shipID: ship.itemID,
            corporationID: 98000002,
            transponder: iffRuntime.resolveActiveTransponder(OWNER_ID, ship.itemID),
        },
    ]);
    assert.deepEqual(iffRuntime.readTransponderState(itemStore.findItemById(moduleItem.itemID)), { channel: null, code: null, active: false });
    const invalidPublic = invoke("activate_effect", { iff_channel: "public" });
    assert.equal(invalidPublic.success, false);
    assert.equal(invalidPublic.errorMsg, "IFF_CHANNEL_INVALID");
    const activated = invoke("activate_effect", {
        iff_channel: "code",
        iff_code: "RALLY-7",
    });
    assert.equal(activated.success, true, activated.errorMsg);
    assert.equal(effectRuntime.calls[0].action, "activate");
    assert.equal(effectRuntime.calls[0].effectName, "iffBroadcast");
    assert.equal(effectRuntime.calls[0].effectState.effectID, 12972);
    assert.deepEqual(iffRuntime.readTransponderState(itemStore.findItemById(moduleItem.itemID)), { channel: "code", code: "RALLY-7", active: true });
    assert.deepEqual(iffRuntime.resolveActiveTransponder(OWNER_ID, ship.itemID, {
        readCreationState: () => ({
            modules: [{ itemID: moduleItem.itemID, typeID: TYPE_TRANSPONDER }],
        }),
        isCreationModuleOnline: () => true,
    }), {
        moduleItemID: moduleItem.itemID,
        channel: "code",
        code: "RALLY-7",
    });
    assert.deepEqual(broadcastVerdicts(), [[ship.itemID, true]]);
    const poweredOffShip = persistCreationAuthorityStateForTest(ship.itemID, moduleItem, true);
    const poweredOffState = creationRuntime.readCreationState(poweredOffShip);
    const suspended = handleCreationIffStateChange({
        reason: "power_state",
        session,
        characterID: OWNER_ID,
        creationID: ship.itemID,
        item: poweredOffShip,
        previousState: persistedState,
        state: poweredOffState,
        spaceRuntime: effectRuntime.runtime,
    });
    assert.equal(suspended.stopped, 1);
    assert.equal(effectRuntime.entity.activeModuleEffects.has(moduleItem.itemID), false);
    assert.equal(iffRuntime.resolveActiveTransponder(OWNER_ID, ship.itemID), null);
    assert.deepEqual(broadcastVerdicts(), [], "powered-off ships must not broadcast their code");
    assert.equal(iffRuntime.readTransponderState(itemStore.findItemById(moduleItem.itemID)).active, true, "power loss preserves the configured broadcast intent");
    const poweredOnShip = persistCreationAuthorityStateForTest(ship.itemID, moduleItem, false);
    const poweredOnState = creationRuntime.readCreationState(poweredOnShip);
    const resumed = handleCreationIffStateChange({
        reason: "power_state",
        session,
        characterID: OWNER_ID,
        creationID: ship.itemID,
        item: poweredOnShip,
        previousState: poweredOffState,
        state: poweredOnState,
        spaceRuntime: effectRuntime.runtime,
    });
    assert.equal(resumed.started, 1);
    assert.equal(effectRuntime.entity.activeModuleEffects.has(moduleItem.itemID), true);
    assert.equal(iffRuntime.resolveActiveTransponder(OWNER_ID, ship.itemID).code, "RALLY-7");
    assert.equal(itemStore.updateInventoryItem(moduleItem.itemID, (currentItem) => ({
        ...currentItem,
        moduleState: { ...(currentItem.moduleState || {}), online: false },
    })).success, true);
    const moduleOffline = handleCreationIffStateChange({
        reason: "module_online_state",
        session,
        characterID: OWNER_ID,
        creationID: ship.itemID,
        item: poweredOnShip,
        state: poweredOnState,
        moduleItemID: moduleItem.itemID,
        previousOnline: true,
        nextOnline: false,
        spaceRuntime: effectRuntime.runtime,
    });
    assert.equal(moduleOffline.stopped, 1);
    assert.equal(effectRuntime.entity.activeModuleEffects.has(moduleItem.itemID), false);
    assert.equal(iffRuntime.resolveActiveTransponder(OWNER_ID, ship.itemID), null);
    assert.deepEqual(broadcastVerdicts(), [], "offline modules must not broadcast their code");
    assert.equal(itemStore.updateInventoryItem(moduleItem.itemID, (currentItem) => ({
        ...currentItem,
        moduleState: { ...(currentItem.moduleState || {}), online: true },
    })).success, true);
    const moduleOnline = handleCreationIffStateChange({
        reason: "module_online_state",
        session,
        characterID: OWNER_ID,
        creationID: ship.itemID,
        item: poweredOnShip,
        state: poweredOnState,
        moduleItemID: moduleItem.itemID,
        previousOnline: false,
        nextOnline: true,
        spaceRuntime: effectRuntime.runtime,
    });
    assert.equal(moduleOnline.started, 1);
    assert.equal(iffRuntime.resolveActiveTransponder(OWNER_ID, ship.itemID).code, "RALLY-7");
    assert.deepEqual(broadcastVerdicts(), [[ship.itemID, true]]);
    const deactivated = invoke("deactivate_effect");
    assert.equal(deactivated.success, true, deactivated.errorMsg);
    assert.equal(deactivated.data.pending, true);
    const stopCall = effectRuntime.calls.find((entry) => entry.action === "deactivate-requested" && entry.effectState.effectName === "iffBroadcast");
    assert.equal(stopCall.options.deferUntilCycle, true);
    assert.equal(effectRuntime.entity.activeModuleEffects.has(moduleItem.itemID), true);
    assert.deepEqual(broadcastVerdicts(), [[ship.itemID, true]], "the code remains live through the final cycle");
    effectRuntime.finishCycle(moduleItem.itemID);
    assert.equal(effectRuntime.entity.activeModuleEffects.has(moduleItem.itemID), false);
    assert.deepEqual(iffRuntime.readTransponderState(itemStore.findItemById(moduleItem.itemID)), { channel: "code", code: "RALLY-7", active: false });
    assert.equal(iffRuntime.resolveActiveTransponder(OWNER_ID, ship.itemID), null);
    assert.deepEqual(broadcastVerdicts(), [], "deactivated modules must not broadcast their saved code");
    const reconfigured = invoke("iff_reconfigure", { iff_channel: "tribe" });
    assert.equal(reconfigured.success, true, reconfigured.errorMsg);
    assert.deepEqual(iffRuntime.readTransponderState(itemStore.findItemById(moduleItem.itemID)), { channel: "tribe", code: null, active: false });
    assert.equal(invoke("activate_effect", {
        iff_channel: "code",
        iff_code: "RALLY-7",
    }).success, true);
    assert.equal(invoke("deactivate_effect").data.pending, true);
    assert.equal(itemStore.updateInventoryItem(moduleItem.itemID, (currentItem) => ({
        ...currentItem,
        moduleState: { ...(currentItem.moduleState || {}), online: false },
    })).success, true);
    const interrupted = handleCreationIffStateChange({
        reason: "module_online_state",
        session,
        characterID: OWNER_ID,
        creationID: ship.itemID,
        item: poweredOnShip,
        state: poweredOnState,
        moduleItemID: moduleItem.itemID,
        previousOnline: true,
        nextOnline: false,
        spaceRuntime: effectRuntime.runtime,
    });
    assert.equal(interrupted.stopped, 1);
    assert.equal(iffRuntime.readTransponderState(itemStore.findItemById(moduleItem.itemID)).active, false, "offlining during a pending manual stop must not resume the broadcast later");
    assert.deepEqual(broadcastVerdicts(), []);
    assert.equal(itemStore.updateInventoryItem(moduleItem.itemID, (currentItem) => ({
        ...currentItem,
        moduleState: { ...(currentItem.moduleState || {}), online: true },
    })).success, true);
    const restored = handleCreationIffStateChange({
        reason: "module_online_state",
        session,
        characterID: OWNER_ID,
        creationID: ship.itemID,
        item: poweredOnShip,
        state: poweredOnState,
        moduleItemID: moduleItem.itemID,
        previousOnline: false,
        nextOnline: true,
        spaceRuntime: effectRuntime.runtime,
    });
    assert.equal(restored.started, 0);
    assert.deepEqual(broadcastVerdicts(), []);
    assert.equal(iffRuntime.resolveActiveTransponder(OWNER_ID, ship.itemID, {
        readCreationState: () => ({
            modules: [{ itemID: moduleItem.itemID, typeID: TYPE_TRANSPONDER }],
        }),
        isCreationModuleOnline: () => true,
    }), null);
});
test("beacon activation publishes a one-cycle immobilizing Dogma effect", () => {
    const shipGrant = itemStore.grantItemToCharacterLocation(OWNER_ID, SOLAR_SYSTEM_ID, itemStore.ITEM_FLAGS.HANGAR, 95276, 1, { individualItems: true, singleton: 1 });
    assert.equal(shipGrant.success, true, shipGrant.errorMsg);
    const ship = shipGrant.data.items[0];
    assert.equal(itemStore.updateInventoryItem(ship.itemID, (currentItem) => ({
        ...currentItem,
        locationID: SOLAR_SYSTEM_ID,
        flagID: 0,
        spaceState: {
            systemID: SOLAR_SYSTEM_ID,
            position: { x: 1, y: 2, z: 3 },
        },
    })).success, true);
    const moduleGrant = itemStore.grantItemToCharacterLocation(OWNER_ID, ship.itemID, creationRuntime.CREATION_FITTING_FLAG_ID, TYPE_BEACON, 1, {
        individualItems: true,
        singleton: 1,
        moduleState: { online: true },
    });
    assert.equal(moduleGrant.success, true, moduleGrant.errorMsg);
    const moduleItem = moduleGrant.data.items[0];
    const persistedShip = persistCreationAuthorityStateForTest(ship.itemID, moduleItem, false);
    const persistedState = creationRuntime.readCreationState(persistedShip);
    const effectRuntime = buildIffEffectRuntime(ship.itemID);
    const session = {
        charid: OWNER_ID,
        characterID: OWNER_ID,
        shipid: ship.itemID,
        solarsystemid: SOLAR_SYSTEM_ID,
        solarsystemid2: SOLAR_SYSTEM_ID,
        corpid: 98000001,
        _space: { systemID: SOLAR_SYSTEM_ID },
        sendNotification() { },
    };
    const creationContext = {
        item: persistedShip,
        characterID: OWNER_ID,
        state: persistedState,
    };
    const invoke = (ability) => creationAbilityRuntime.dispatchCreationAbility({
        ability,
        kwargs: { iff_channel: "tribe" },
        session,
        creationContext,
        moduleItemID: moduleItem.itemID,
        abilityDependencies: { spaceRuntime: effectRuntime.runtime },
    });
    const activated = invoke("activate_effect");
    assert.equal(activated.success, true, activated.errorMsg);
    const activation = effectRuntime.calls.find((entry) => entry.action === "activate");
    assert.equal(activation.effectName, "iffBeacon");
    assert.equal(activation.options.repeat, 0);
    assert.equal(activation.effectState.effectID, 12974);
    assert.equal(activation.effectState.immobilizesShip, true);
    assert.equal(effectRuntime.calls.some((entry) => entry.action === "stopShip"), true);
    assert.ok(iffRuntime.getActiveBeacon(moduleItem.itemID));
    const poweredOffShip = persistCreationAuthorityStateForTest(ship.itemID, moduleItem, true);
    const poweredOffState = creationRuntime.readCreationState(poweredOffShip);
    const suspended = handleCreationIffStateChange({
        reason: "power_state",
        session,
        characterID: OWNER_ID,
        creationID: ship.itemID,
        item: poweredOffShip,
        previousState: persistedState,
        state: poweredOffState,
        spaceRuntime: effectRuntime.runtime,
    });
    assert.equal(suspended.suspended, 1);
    assert.equal(iffRuntime.getActiveBeacon(moduleItem.itemID).suspended, true);
    assert.equal(effectRuntime.entity.activeModuleEffects.has(moduleItem.itemID), false);
    assert.deepEqual(iffRuntime.listVisibleBeacons({
        characterID: OWNER_ID,
        solarSystemID: SOLAR_SYSTEM_ID,
        corporationID: 98000001,
        transponder: null,
    }), []);
    const poweredOnShip = persistCreationAuthorityStateForTest(ship.itemID, moduleItem, false);
    const poweredOnState = creationRuntime.readCreationState(poweredOnShip);
    const resumed = handleCreationIffStateChange({
        reason: "power_state",
        session,
        characterID: OWNER_ID,
        creationID: ship.itemID,
        item: poweredOnShip,
        previousState: poweredOffState,
        state: poweredOnState,
        spaceRuntime: effectRuntime.runtime,
    });
    assert.equal(resumed.resumed, 1);
    assert.equal(iffRuntime.getActiveBeacon(moduleItem.itemID).suspended, false);
    assert.equal(effectRuntime.entity.activeModuleEffects.has(moduleItem.itemID), true);
    assert.equal(iffRuntime.listVisibleBeacons({
        characterID: OWNER_ID,
        solarSystemID: SOLAR_SYSTEM_ID,
        corporationID: 98000001,
        transponder: null,
    }).length, 1);
    assert.equal(itemStore.updateInventoryItem(moduleItem.itemID, (currentItem) => ({
        ...currentItem,
        moduleState: { ...(currentItem.moduleState || {}), online: false },
    })).success, true);
    const moduleOffline = handleCreationIffStateChange({
        reason: "module_online_state",
        session,
        characterID: OWNER_ID,
        creationID: ship.itemID,
        item: poweredOnShip,
        state: poweredOnState,
        moduleItemID: moduleItem.itemID,
        previousOnline: true,
        nextOnline: false,
        spaceRuntime: effectRuntime.runtime,
    });
    assert.equal(moduleOffline.suspended, 1);
    assert.equal(iffRuntime.getActiveBeacon(moduleItem.itemID).suspended, true);
    assert.equal(effectRuntime.entity.activeModuleEffects.has(moduleItem.itemID), false);
    assert.equal(itemStore.updateInventoryItem(moduleItem.itemID, (currentItem) => ({
        ...currentItem,
        moduleState: { ...(currentItem.moduleState || {}), online: true },
    })).success, true);
    const moduleOnline = handleCreationIffStateChange({
        reason: "module_online_state",
        session,
        characterID: OWNER_ID,
        creationID: ship.itemID,
        item: poweredOnShip,
        state: poweredOnState,
        moduleItemID: moduleItem.itemID,
        previousOnline: false,
        nextOnline: true,
        spaceRuntime: effectRuntime.runtime,
    });
    assert.equal(moduleOnline.resumed, 1);
    assert.equal(iffRuntime.getActiveBeacon(moduleItem.itemID).suspended, false);
    assert.equal(effectRuntime.entity.activeModuleEffects.has(moduleItem.itemID), true);
    const deactivated = invoke("deactivate_effect");
    assert.equal(deactivated.success, true, deactivated.errorMsg);
    assert.equal(deactivated.data.pending, true);
    assert.ok(iffRuntime.getActiveBeacon(moduleItem.itemID));
    assert.equal(effectRuntime.entity.activeModuleEffects.has(moduleItem.itemID), true);
    effectRuntime.finishCycle(moduleItem.itemID);
    assert.equal(iffRuntime.getActiveBeacon(moduleItem.itemID), null);
    assert.equal(effectRuntime.entity.activeModuleEffects.has(moduleItem.itemID), false);
    iffRuntime.resetIffRuntimeForTests();
});
test("removing an active beacon module terminates rather than suspends it", (t) => {
    t.after(() => iffRuntime.resetIffRuntimeForTests());
    const shipGrant = itemStore.grantItemToCharacterLocation(OWNER_ID, SOLAR_SYSTEM_ID, 0, 95276, 1, { individualItems: true, singleton: 1 });
    assert.equal(shipGrant.success, true, shipGrant.errorMsg);
    const ship = shipGrant.data.items[0];
    assert.equal(itemStore.updateInventoryItem(ship.itemID, (currentItem) => ({
        ...currentItem,
        spaceState: {
            systemID: SOLAR_SYSTEM_ID,
            position: { x: 0, y: 0, z: 0 },
        },
    })).success, true);
    const moduleGrant = itemStore.grantItemToCharacterLocation(OWNER_ID, ship.itemID, creationRuntime.CREATION_FITTING_FLAG_ID, TYPE_BEACON, 1, {
        individualItems: true,
        singleton: 1,
        moduleState: { online: true },
    });
    assert.equal(moduleGrant.success, true, moduleGrant.errorMsg);
    const moduleItem = moduleGrant.data.items[0];
    const fittedShip = persistCreationAuthorityStateForTest(ship.itemID, moduleItem, false);
    let releases = 0;
    const started = iffRuntime.startBeacon({
        beaconID: moduleItem.itemID,
        moduleTypeID: moduleItem.typeID,
        shipID: ship.itemID,
        characterID: OWNER_ID,
        corporationID: 98000001,
        solarSystemID: SOLAR_SYSTEM_ID,
        position: [0, 0, 0],
        channel: "public",
        code: null,
        durationMs: 30000,
        releaseImmobilizer() {
            releases += 1;
            return { success: true };
        },
    });
    assert.equal(started.success, true, started.errorMsg);
    assert.equal(itemStore.updateInventoryItem(moduleItem.itemID, (currentItem) => ({
        ...currentItem,
        flagID: itemStore.ITEM_FLAGS.CARGO_HOLD,
    })).success, true);
    const unfittedShip = persistCreationAuthorityStateForTest(ship.itemID, moduleItem, false, false);
    const reconciled = handleCreationIffStateChange({
        reason: "draft_commit",
        session: null,
        characterID: OWNER_ID,
        creationID: ship.itemID,
        item: unfittedShip,
        previousState: creationRuntime.readCreationState(fittedShip),
        state: creationRuntime.readCreationState(unfittedShip),
    });
    assert.equal(reconciled.released, 1);
    assert.equal(releases, 1);
    assert.equal(iffRuntime.getActiveBeacon(moduleItem.itemID), null);
});
function buildBeacon(overrides = {}) {
    return {
        beaconID: 700001,
        typeID: TYPE_BEACON,
        shipID: SHIP_ID,
        characterID: OWNER_ID,
        corporationID: 98000001,
        solarSystemID: SOLAR_SYSTEM_ID,
        position: [1, 2, 3],
        channel: "code",
        code: "RALLY-7",
        startedAtMs: 1000,
        expiresAtMs: 31000,
        ...overrides,
    };
}
function buildViewer(overrides = {}) {
    return {
        characterID: OTHER_OWNER_ID,
        solarSystemID: SOLAR_SYSTEM_ID,
        corporationID: 98000001,
        transponder: { channel: "code", code: "RALLY-7" },
        ...overrides,
    };
}
test("beacon visibility requires a matching active transponder", () => {
    const beacon = buildBeacon();
    assert.equal(iffRuntime.beaconVisibleToViewer(beacon, buildViewer()), true);
    // Mismatched code.
    assert.equal(iffRuntime.beaconVisibleToViewer(beacon, buildViewer({ transponder: { channel: "code", code: "OTHER" } })), false);
    // No transponder at all.
    assert.equal(iffRuntime.beaconVisibleToViewer(beacon, buildViewer({ transponder: null })), false);
    // Right code, wrong channel.
    assert.equal(iffRuntime.beaconVisibleToViewer(beacon, buildViewer({ transponder: { channel: "tribe", code: "RALLY-7" } })), false);
    // Cross-system.
    assert.equal(iffRuntime.beaconVisibleToViewer(beacon, buildViewer({ solarSystemID: 30000005 })), false);
    // Owner always sees their own beacon, even without a transponder.
    assert.equal(iffRuntime.beaconVisibleToViewer(beacon, buildViewer({ characterID: OWNER_ID, transponder: null })), true);
    // Tribe channel: same corporation with a tribe transponder.
    const tribeBeacon = buildBeacon({ channel: "tribe", code: null });
    assert.equal(iffRuntime.beaconVisibleToViewer(tribeBeacon, buildViewer({ transponder: { channel: "tribe", code: null } })), true);
    assert.equal(iffRuntime.beaconVisibleToViewer(tribeBeacon, buildViewer({
        corporationID: 98000999,
        transponder: { channel: "tribe", code: null },
    })), false);
    // Public beacons are visible to everyone in the system.
    const publicBeacon = buildBeacon({ channel: "public", code: null });
    assert.equal(iffRuntime.beaconVisibleToViewer(publicBeacon, buildViewer({ transponder: null })), true);
    assert.equal(iffRuntime.beaconVisibleToViewer(publicBeacon, buildViewer({ solarSystemID: 30000005, transponder: null })), false);
});
test("expired beacons are never visible and are swept", () => {
    const nowMs = 100000;
    assert.equal(iffRuntime.isBeaconLive(buildBeacon({ expiresAtMs: 1 }), nowMs), false);
    assert.equal(iffRuntime.isBeaconLive(null, nowMs), false);
});
test("IFF verdicts distinguish friendly, unfriendly, and unknown broadcasts", () => {
    const viewer = {
        shipID: 1,
        corporationID: 98000001,
        transponder: { channel: "code", code: "RALLY-7" },
    };
    const ships = [
        viewer,
        { shipID: 2, corporationID: 98000001, transponder: { channel: "code", code: "RALLY-7" } },
        { shipID: 3, corporationID: 98000001, transponder: { channel: "code", code: "NOPE" } },
        { shipID: 4, corporationID: 98000001, transponder: null },
    ];
    assert.deepEqual(buildVerdictsForViewer(viewer, ships), [
        [2, true],
        [3, false],
    ]);
});
test("IFF verdict population unifies native NPC faction broadcasts", () => {
    const matchingNpc = {
        itemID: 5,
        kind: "ship",
        nativeNpc: true,
        npcEntityType: "npc",
        npcFactionID: 500010,
        corporationID: 1_500_010,
        spawnGroupID: "guristas_gate_patrol",
    };
    const otherNpc = {
        ...matchingNpc,
        itemID: 6,
        spawnGroupID: "guristas_belt_patrol",
    };
    const npcShips = buildNpcTransponderShipsForSystem(SOLAR_SYSTEM_ID, {
        scene: {
            getDynamicEntities: () => [matchingNpc, otherNpc, {
                    itemID: 7,
                    kind: "ship",
                    nativeNpc: false,
                }],
        },
    });
    assert.equal(npcShips.length, 2);
    const viewer = {
        shipID: 1,
        corporationID: 98_000_001,
        transponder: {
            channel: "code",
            code: npcShips[0].transponder.code,
        },
    };
    assert.deepEqual(buildVerdictsForViewer(viewer, [viewer, ...npcShips]), [
        [matchingNpc.itemID, true],
        [otherNpc.itemID, true],
    ]);
});
// ── Phase 3: directional scanner ─────────────────────────────────────────
test("scan request validation follows client-authored angle bounds", () => {
    assert.equal(scanningRuntime.normalizeScanRequest({ scan_angle: 1, scan_direction: [0, 0, 1] }).errorMsg, "SCAN_ANGLE_OUT_OF_RANGE");
    assert.equal(scanningRuntime.normalizeScanRequest({ scan_angle: 46, scan_direction: [0, 0, 1] }).errorMsg, "SCAN_ANGLE_OUT_OF_RANGE");
    assert.equal(scanningRuntime.normalizeScanRequest({ scan_angle: 2.5, scan_direction: [0, 0, 1] }).angleDegrees, 2.5);
    assert.equal(scanningRuntime.normalizeScanRequest({ scan_angle: 45, scan_direction: [0, 0, 1] }).angleDegrees, 45);
    // Missing angle falls back to the client default.
    assert.equal(scanningRuntime.normalizeScanRequest({ scan_direction: [0, 0, 1] }).angleDegrees, 15);
    assert.equal(scanningRuntime.normalizeScanRequest({ scan_angle: 15, scan_direction: [0, 0, 0] }).errorMsg, "SCAN_DIRECTION_INVALID");
    assert.equal(scanningRuntime.normalizeScanRequest({ scan_angle: 15 }).errorMsg, "SCAN_DIRECTION_INVALID");
    // Direction is normalized to a unit vector.
    const request = scanningRuntime.normalizeScanRequest({
        scan_angle: 15,
        scan_direction: [0, 0, 5],
    });
    assert.deepEqual(request.direction, { x: 0, y: 0, z: 1 });
});
test("client-authored SNR helper is reproduced exactly", () => {
    assert.equal(scanningRuntime.calculateSnr(10, 2), 5);
    assert.equal(scanningRuntime.calculateSnr(10, 0), 100);
});
test("occluded scan contacts expose gravimetric and EM signatures only", () => {
    const signatures = [
        [scanningRuntime.SIGNATURE_TYPE_GRAVIMETRIC, 2, 0.5],
        [scanningRuntime.SIGNATURE_TYPE_ELECTROMAGNETIC, 1, 0.5],
        [scanningRuntime.SIGNATURE_TYPE_THERMAL, 4, 0.5],
    ];
    assert.deepEqual(scanningRuntime.getPresentedSignatureResults(signatures, false), signatures.slice(0, 2));
    assert.deepEqual(scanningRuntime.getPresentedSignatureResults(signatures, true), signatures);
});
test("scan contact resolution is delayed, stable across rescans, and session scoped", () => {
    const session = { _space: {} };
    const first = scanningRuntime.replaceResolvedScanningContacts(session, [4101], { nowMs: 1000, delayMs: 6000 });
    assert.equal(first.delayMsByEntityID.get(4101), 6000);
    assert.equal(scanningRuntime.isScanningContactResolved(session, 4101, 6999), false);
    assert.equal(scanningRuntime.isScanningContactResolved(session, 4101, 7000), true);
    const repeated = scanningRuntime.replaceResolvedScanningContacts(session, [4101], { nowMs: 3000, delayMs: 6000 });
    assert.equal(repeated.delayMsByEntityID.get(4101), 4000);
    assert.equal(scanningRuntime.isScanningContactResolved(session, 4101, 7000), true);
    const removed = scanningRuntime.replaceResolvedScanningContacts(session, [], { nowMs: 8000, delayMs: 6000 });
    assert.deepEqual(removed.removedIDs, [4101]);
    assert.equal(scanningRuntime.isScanningContactResolved(session, 4101, 8000), false);
    const previousGeneration = session._space;
    scanningRuntime.replaceResolvedScanningContacts(session, [4102], { nowMs: 9000, delayMs: 0 });
    session._space = {};
    assert.equal(scanningRuntime.isScanningContactResolved(session, 4102, 9000), false);
    assert.ok(previousGeneration.frontierResolvedScanningContactsByID instanceof Map);
});
test("combat-resolved contacts are immediate and survive unrelated scans", () => {
    const session = { _space: {} };
    const contact = scanningRuntime.forceResolveScanningContact(session, 4110, { nowMs: 1_000 });
    assert.equal(contact.resolveAtMs, 1_000);
    assert.equal(scanningRuntime.isCombatResolvedScanningContact(session, 4110, 1_000), true);
    const unrelatedScan = scanningRuntime.replaceResolvedScanningContacts(session, [4111], { nowMs: 2_000, delayMs: 6_000 });
    assert.deepEqual([...unrelatedScan.activeIDs].sort(), [4110, 4111]);
    assert.deepEqual(unrelatedScan.removedIDs, []);
    assert.equal(scanningRuntime.isScanningContactResolved(session, 4110, 2_000), true);
    scanningRuntime.replaceResolvedScanningContacts(session, [4110], {
        nowMs: 3_000,
        delayMs: 0,
        source: "passive",
    });
    assert.equal(scanningRuntime.isCombatResolvedScanningContact(session, 4110, 3_000), true);
    const passiveOmission = scanningRuntime.replaceResolvedScanningContacts(session, [], { nowMs: 4_000, delayMs: 0, source: "passive" });
    assert.equal(passiveOmission.activeIDs.has(4110), true);
    assert.equal(scanningRuntime.isCombatResolvedScanningContact(session, 4110, 4_000), true);
    assert.equal(scanningRuntime.forgetResolvedScanningContact(session, 4110), true);
    assert.equal(scanningRuntime.isScanningContactResolved(session, 4110, 2_000), false);
});
test("resolved contacts use the Frontier distance reveal curve per ball", () => {
    assert.equal(scanningRuntime.calculateScanRevealDelayMs(0, 6000), 0);
    assert.equal(Math.round(scanningRuntime.calculateScanRevealDelayMs(50_000_000, 6000)), 4731);
    assert.equal(scanningRuntime.calculateScanRevealDelayMs(scanningRuntime.MAXIMUM_SCAN_DISTANCE_METERS, 6000), 6000);
    assert.equal(scanningRuntime.calculateScanRevealDelayMs(scanningRuntime.MAXIMUM_SCAN_DISTANCE_METERS + 1, 6000), 6000);
    const session = { _space: {} };
    const delays = new Map([[4201, 1250], [4202, 4750]]);
    const resolution = scanningRuntime.replaceResolvedScanningContacts(session, [4201, 4202], { nowMs: 10_000, delayMs: 6000, delayMsByEntityID: delays });
    assert.deepEqual([...resolution.delayMsByEntityID], [...delays]);
    assert.equal(scanningRuntime.isScanningContactResolved(session, 4201, 11_249), false);
    assert.equal(scanningRuntime.isScanningContactResolved(session, 4201, 11_250), true);
    assert.equal(scanningRuntime.isScanningContactResolved(session, 4202, 14_749), false);
    assert.equal(scanningRuntime.isScanningContactResolved(session, 4202, 14_750), true);
});
function runScan(candidates, overrides = {}) {
    return scanningRuntime.performDirectionalScan({
        originPosition: { x: 0, y: 0, z: 0 },
        angleDegrees: 15,
        direction: { x: 0, y: 0, z: 1 },
        moduleTypeID: TYPE_SCANNER,
        candidates,
        ...overrides,
    });
}
test("scanner cone includes in-cone and excludes out-of-cone targets", () => {
    const inCone = {
        itemID: 4001,
        typeID: TYPE_SIGNATURE_TARGET,
        position: { x: 0, y: 0, z: 1000000 },
    };
    // 90 degrees off the boresight.
    const outOfCone = {
        itemID: 4002,
        typeID: TYPE_SIGNATURE_TARGET,
        position: { x: 1000000, y: 0, z: 0 },
    };
    // Just outside a 15 degree half-angle (~20 degrees off axis).
    const justOutside = {
        itemID: 4003,
        typeID: TYPE_SIGNATURE_TARGET,
        position: {
            x: Math.sin((20 * Math.PI) / 180) * 1000000,
            y: 0,
            z: Math.cos((20 * Math.PI) / 180) * 1000000,
        },
    };
    // Just inside (~10 degrees off axis).
    const justInside = {
        itemID: 4004,
        typeID: TYPE_SIGNATURE_TARGET,
        position: {
            x: Math.sin((10 * Math.PI) / 180) * 1000000,
            y: 0,
            z: Math.cos((10 * Math.PI) / 180) * 1000000,
        },
    };
    const scan = runScan([inCone, outOfCone, justOutside, justInside], {
        resolutionConfig: { renderResolvedObjects: false },
    });
    const scannedIds = scan.updatedScans.map((result) => result.scan_id).sort();
    assert.deepEqual(scannedIds, [4001, 4004]);
});
test("scanner enforces the client-authored maximum range", () => {
    const withinRange = {
        itemID: 5001,
        typeID: TYPE_SIGNATURE_TARGET,
        position: { x: 0, y: 0, z: scanningRuntime.MAXIMUM_SCAN_DISTANCE_METERS - 1000 },
    };
    const beyondRange = {
        itemID: 5002,
        typeID: TYPE_SIGNATURE_TARGET,
        position: { x: 0, y: 0, z: scanningRuntime.MAXIMUM_SCAN_DISTANCE_METERS + 1000 },
    };
    const zeroDistance = { itemID: 5003, typeID: TYPE_SIGNATURE_TARGET, position: { x: 0, y: 0, z: 0 } };
    const scan = runScan([withinRange, beyondRange, zeroDistance], {
        resolutionConfig: { renderResolvedObjects: false },
    });
    assert.deepEqual(scan.updatedScans.map((result) => result.scan_id), [5001]);
});
test("Frontier scan detection and object-resolution ranges are validated config", () => {
    const definitions = new Map(serverConfig.getConfigDefinitions().map((definition) => [
        definition.key,
        definition,
    ]));
    assert.equal(definitions.get("frontierScanningDetectionRangeMeters").defaultValue, scanningRuntime.MAXIMUM_SCAN_DISTANCE_METERS);
    assert.equal(definitions.get("frontierScanningResolutionRangeMeters").defaultValue, scanningRuntime.MAXIMUM_SCAN_DISTANCE_METERS);
    assert.equal(definitions.get("frontierScanningResolutionSnrThreshold").defaultValue, 1);
    assert.equal(definitions.get("frontierScanningRenderResolvedObjects").defaultValue, true);
    assert.equal(definitions.get("frontierScanningRenderOutOfRangeSignatures").defaultValue, true);
    const validBaseValues = Object.fromEntries([...definitions.entries()].map(([key, definition]) => [
        key,
        definition.defaultValue === "" ? "test" : definition.defaultValue,
    ]));
    assert.throws(() => serverConfig.buildValidatedConfigValues({
        frontierScanningDetectionRangeMeters: 1_000,
        frontierScanningResolutionRangeMeters: 1_001,
    }, { baseValues: validBaseValues }), /ResolutionRangeMeters must be less than or equal to.*DetectionRangeMeters/);
});
test("contacts outside resolution range stay unresolved signatures", () => {
    const scan = runScan([
        {
            itemID: 5101,
            typeID: TYPE_SIGNATURE_TARGET,
            position: { x: 0, y: 0, z: 400 },
        },
        {
            itemID: 5102,
            typeID: TYPE_SIGNATURE_TARGET,
            position: { x: 0, y: 0, z: 750 },
        },
        {
            itemID: 5103,
            typeID: TYPE_SIGNATURE_TARGET,
            position: { x: 0, y: 0, z: 1_250 },
        },
    ], {
        scannerProfile: {
            durationMs: 6_000,
            multipliers: [[scanningRuntime.SIGNATURE_TYPE_GRAVIMETRIC, 1_000]],
        },
        resolutionConfig: {
            detectionRangeMeters: 1_000,
            resolutionRangeMeters: 500,
            resolutionSnrThreshold: 1,
            renderResolvedObjects: true,
            renderOutOfRangeSignatures: true,
        },
    });
    assert.deepEqual(scan.updatedScans.map((result) => result.scan_id), [5102]);
    assert.deepEqual(scan.resolvedIds, [5101]);
    assert.equal(scan.updatedScans[0].resolution_state, "unresolved-out-of-range");
    assert.ok(scan.updatedScans[0].signature_results.every(([, signature, noise]) => scanningRuntime.calculateSnr(signature, noise) < 1));
    frontierMarshals(buildScanResponse(scan));
});
test("combat reveals only the attacker while other distant contacts stay signatures", () => {
    const scan = runScan([
        {
            itemID: 5110,
            typeID: TYPE_SIGNATURE_TARGET,
            position: { x: 0, y: 0, z: 750 },
            forceCombatResolved: true,
        },
        {
            itemID: 5111,
            typeID: TYPE_SIGNATURE_TARGET,
            position: { x: 0, y: 0, z: 750 },
        },
    ], {
        scannerProfile: {
            durationMs: 6_000,
            multipliers: [[scanningRuntime.SIGNATURE_TYPE_GRAVIMETRIC, 1_000]],
        },
        resolutionConfig: {
            detectionRangeMeters: 1_000,
            resolutionRangeMeters: 500,
            resolutionSnrThreshold: 1,
            renderResolvedObjects: true,
            renderOutOfRangeSignatures: true,
        },
    });
    assert.deepEqual(scan.resolvedIds, [5110]);
    assert.equal(scan.resolvedDelayMsById.get(5110), 0);
    assert.deepEqual(scan.updatedScans.map((result) => result.scan_id), [5111]);
    assert.equal(scan.updatedScans[0].resolution_state, "unresolved-out-of-range");
});
test("out-of-resolution contacts can be omitted or all contacts kept signature-only", () => {
    const candidate = {
        itemID: 5201,
        typeID: TYPE_SIGNATURE_TARGET,
        position: { x: 0, y: 0, z: 750 },
    };
    const scannerProfile = {
        durationMs: 6_000,
        multipliers: [[scanningRuntime.SIGNATURE_TYPE_GRAVIMETRIC, 1_000]],
    };
    const omitted = runScan([candidate], {
        scannerProfile,
        resolutionConfig: {
            detectionRangeMeters: 1_000,
            resolutionRangeMeters: 500,
            renderOutOfRangeSignatures: false,
        },
    });
    assert.deepEqual(omitted.updatedScans, []);
    const signatureOnly = runScan([
        { ...candidate, position: { x: 0, y: 0, z: 400 } },
    ], {
        scannerProfile,
        resolutionConfig: {
            detectionRangeMeters: 1_000,
            resolutionRangeMeters: 500,
            renderResolvedObjects: false,
        },
    });
    assert.deepEqual(signatureOnly.resolvedIds, []);
    assert.equal(signatureOnly.updatedScans[0].resolution_state, "unresolved-signature-only");
});
test("scan ids are stable and deltas report added/removed", () => {
    const target = { itemID: 6001, typeID: TYPE_SIGNATURE_TARGET, position: { x: 0, y: 0, z: 500000 } };
    const other = { itemID: 6002, typeID: TYPE_SIGNATURE_TARGET, position: { x: 0, y: 0, z: 600000 } };
    const signatureOnly = { renderResolvedObjects: false };
    const first = runScan([target], { resolutionConfig: signatureOnly });
    assert.deepEqual(first.added, [6001]);
    assert.deepEqual(first.removed, []);
    assert.deepEqual(first.scanIds, [6001]);
    // Same target rescanned: stable id, no delta churn.
    const second = runScan([target], {
        previousScanIds: first.scanIds,
        resolutionConfig: signatureOnly,
    });
    assert.deepEqual(second.added, []);
    assert.deepEqual(second.removed, []);
    assert.deepEqual(second.updatedScans[0].scan_id, 6001);
    // Target swapped out.
    const third = runScan([other], {
        previousScanIds: second.scanIds,
        resolutionConfig: signatureOnly,
    });
    assert.deepEqual(third.added, [6002]);
    assert.deepEqual(third.removed, [6001]);
});
test("a resolved ball replaces its prior unresolved signature with client fate", () => {
    const target = {
        itemID: 6101,
        typeID: TYPE_SIGNATURE_TARGET,
        position: { x: 0, y: 0, z: 50_000_000 },
    };
    const first = runScan([target], {
        resolutionConfig: { renderResolvedObjects: false },
    });
    const resolved = runScan([target], { previousScanIds: first.scanIds });
    assert.deepEqual(resolved.updatedScans, []);
    assert.deepEqual(resolved.scanIds, []);
    assert.deepEqual(resolved.resolvedIds, [6101]);
    assert.deepEqual(resolved.removed, [6101]);
    assert.deepEqual(resolved.removedReasonsByScanId.get(6101), [scanningRuntime.UPDATE_RESOLVED_TO_ITEM, 6101]);
    assert.equal(Math.round(resolved.resolvedDelayMsById.get(6101)), 4731);
    const responseEntries = new Map(buildScanResponse(resolved).args.entries);
    assert.deepEqual(responseEntries.get("removed"), {
        type: "dict",
        entries: [[6101, {
                    type: "tuple",
                    items: [scanningRuntime.UPDATE_RESOLVED_TO_ITEM, 6101],
                }]],
    });
    frontierMarshals(buildScanResponse(resolved));
});
test("empty scans and empty beacon lists marshal under the frontier profile", () => {
    const emptyScan = runScan([]);
    assert.deepEqual(emptyScan.updatedScans, []);
    assert.deepEqual(emptyScan.resolvedIds, []);
    assert.deepEqual(emptyScan.added, []);
    frontierMarshals(buildScanResponse(emptyScan));
    const populatedScan = runScan([
        { itemID: 7001, typeID: TYPE_SIGNATURE_TARGET, position: { x: 0, y: 0, z: 200000 } },
    ], { resolutionConfig: { renderResolvedObjects: false } });
    assert.equal(populatedScan.updatedScans.length, 1);
    frontierMarshals(buildScanResponse(populatedScan));
});
test("scan response uses KeyVal, timedelta duration, and resolved filetime deltas", () => {
    const scan = runScan([
        { itemID: 8001, typeID: TYPE_SIGNATURE_TARGET, position: { x: 0, y: 0, z: 100000 } },
    ]);
    const response = buildScanResponse(scan);
    // The client accesses response.added / .origin / .duration by attribute,
    // so the payload must be util.KeyVal rather than a plain dict.
    assert.equal(response.type, "object");
    assert.equal(response.name, "util.KeyVal");
    const entries = new Map(response.args.entries);
    assert.ok(entries.has("origin"));
    assert.ok(entries.has("duration"));
    assert.ok(entries.has("added"));
    assert.ok(entries.has("removed"));
    assert.ok(entries.has("updated_scans"));
    assert.ok(entries.has("resolved"));
    // Python 3.12 passes response.duration directly into ScanPulsePhase, where
    // it is added to a datetime. This golden protocol-2 pickle must therefore
    // reconstruct datetime.timedelta(0, 6, 0), not a tick integer.
    const duration = entries.get("duration");
    assert.equal(duration.type, "cpicked");
    assert.equal(duration.data.toString("hex"), "8002636461746574696d650a74696d6564656c74610a71004b004b064b008771015271022e");
    assert.deepEqual(duration, buildPythonTimedeltaPayload(scan.durationMs));
    assert.equal(millisecondsToFiletimeDelta(6000), 60000000n);
    // resolved values are filetime deltas keyed by ball id.
    const resolved = entries.get("resolved");
    assert.equal(resolved.type, "dict");
    for (const [ballID, delta] of resolved.entries) {
        assert.equal(typeof ballID, "number");
        assert.equal(typeof delta, "bigint");
    }
    frontierMarshals(response);
});
test("scan duration and signature multipliers come from authored dogma", () => {
    assert.equal(scanningRuntime.resolveScanDurationMs(TYPE_SCANNER), 6000);
    const multipliers = scanningRuntime.resolveSignatureMultipliers(TYPE_SCANNER);
    assert.deepEqual(multipliers.map(([type]) => type).sort(), [2, 3, 4]);
    for (const [, multiplier] of multipliers) {
        assert.equal(multiplier, 500);
    }
});
test("non-modular scanners average every positive built-in sensor type", () => {
    const profile = scanningRuntime.resolveBuiltInScannerProfile({
        typeID: 0,
        passiveDerivedState: {
            attributes: {
                208: 10,
                209: 20,
                210: 0,
                211: 30,
            },
        },
    });
    assert.equal(profile.source, "built-in");
    assert.deepEqual(profile.sensorStrengths, [10, 20, 30]);
    assert.equal(profile.sensorStrength, 20);
    assert.deepEqual(profile.multipliers, [
        [scanningRuntime.SIGNATURE_TYPE_GRAVIMETRIC, 500],
        [scanningRuntime.SIGNATURE_TYPE_ELECTROMAGNETIC, 500],
        [scanningRuntime.SIGNATURE_TYPE_THERMAL, 500],
    ]);
});
test("module and weapon activity raise EM signature and decay to baseline", () => {
    const entity = {
        activeModuleEffects: new Map([[1, {}], [2, {}]]),
    };
    scanningRuntime.recordEntityScannerEmissionActivity(entity, { nowMs: 1000 });
    assert.equal(scanningRuntime.resolveEntityEmSignatureMultiplier(entity, 1000), 2);
    assert.equal(scanningRuntime.resolveEntityEmSignatureMultiplier(entity, 6000), 1.75);
    scanningRuntime.recordEntityScannerEmissionActivity(entity, {
        nowMs: 6000,
        isWeapon: true,
    });
    entity.activeModuleEffects.clear();
    assert.equal(scanningRuntime.resolveEntityEmSignatureMultiplier(entity, 6000), 2);
    assert.equal(scanningRuntime.resolveEntityEmSignatureMultiplier(entity, 21000), 1);
    const signatures = scanningRuntime.buildSignatureResultsForTarget({
        baseSignature: 10,
        distanceMeters: 1000000,
        multipliers: [
            [scanningRuntime.SIGNATURE_TYPE_GRAVIMETRIC, 500],
            [scanningRuntime.SIGNATURE_TYPE_ELECTROMAGNETIC, 500],
            [scanningRuntime.SIGNATURE_TYPE_THERMAL, 500],
        ],
        emSignatureMultiplier: 2,
    });
    assert.deepEqual(signatures.map((entry) => entry[1]), [5, 10, 5]);
});
test("target mass increases only gravimetric signature and scan resolution", () => {
    const referenceMass = scanningRuntime.GRAVIMETRIC_REFERENCE_MASS_KG;
    const lightSignatures = scanningRuntime.buildSignatureResultsForTarget({
        baseSignature: 10,
        distanceMeters: scanningRuntime.MAXIMUM_SCAN_DISTANCE_METERS,
        multipliers: [
            [scanningRuntime.SIGNATURE_TYPE_GRAVIMETRIC, 500],
            [scanningRuntime.SIGNATURE_TYPE_ELECTROMAGNETIC, 500],
            [scanningRuntime.SIGNATURE_TYPE_THERMAL, 500],
        ],
        massKg: referenceMass / 2,
    });
    const heavySignatures = scanningRuntime.buildSignatureResultsForTarget({
        baseSignature: 10,
        distanceMeters: scanningRuntime.MAXIMUM_SCAN_DISTANCE_METERS,
        multipliers: [
            [scanningRuntime.SIGNATURE_TYPE_GRAVIMETRIC, 500],
            [scanningRuntime.SIGNATURE_TYPE_ELECTROMAGNETIC, 500],
            [scanningRuntime.SIGNATURE_TYPE_THERMAL, 500],
        ],
        massKg: referenceMass * 4,
    });
    assert.deepEqual(lightSignatures.map((entry) => entry[1]), [2.5, 5, 5]);
    assert.deepEqual(heavySignatures.map((entry) => entry[1]), [20, 5, 5]);
    assert.equal(scanningRuntime.resolveGravimetricSignatureMultiplier(undefined), 1);
    const resolutionScan = runScan([
        {
            itemID: 8051,
            typeID: TYPE_SIGNATURE_TARGET,
            mass: referenceMass / 4,
            position: { x: 0, y: 0, z: scanningRuntime.MAXIMUM_SCAN_DISTANCE_METERS },
        },
        {
            itemID: 8052,
            typeID: TYPE_SIGNATURE_TARGET,
            mass: referenceMass * 2,
            position: { x: 0, y: 0, z: scanningRuntime.MAXIMUM_SCAN_DISTANCE_METERS },
        },
    ], {
        scannerProfile: {
            durationMs: 6000,
            multipliers: [[scanningRuntime.SIGNATURE_TYPE_GRAVIMETRIC, 500]],
        },
    });
    assert.deepEqual(resolutionScan.resolvedIds, [8052]);
});
test("build 3502403 non-modular scanningService uses built-in hull sensors and exact response", () => {
    const ship = {
        kind: "ship",
        itemID: SHIP_ID,
        typeID: 95276,
        position: { x: 10, y: 20, z: 30 },
        passiveDerivedState: {
            attributes: {
                208: 10,
                209: 20,
                210: 30,
                211: 40,
            },
        },
    };
    const target = {
        kind: "deployable",
        itemID: 8101,
        typeID: TYPE_SIGNATURE_TARGET,
        mass: 8_000_000,
        position: { x: 10, y: 20, z: 100030 },
    };
    let captured = null;
    let resolutionUpdate = null;
    const service = new ScanningService({
        spaceRuntime: {
            getEntity(_session, itemID) {
                return Number(itemID) === SHIP_ID ? ship : null;
            },
            getSceneForSession() {
                return {
                    getDynamicEntities() {
                        return [ship, target, null];
                    },
                };
            },
            updateResolvedScanningContactsForSession(session, resolvedIds, options) {
                resolutionUpdate = { session, resolvedIds, options };
                return {
                    delayMsByEntityID: new Map([[8101, 3210]]),
                };
            },
        },
        performDirectionalScan(options) {
            captured = options;
            return {
                origin: [10, 20, 30],
                durationMs: 6000,
                added: [],
                removed: [7999],
                updatedScans: [],
                resolvedIds: [8101],
                resolvedDelayMsById: new Map([[8101, 3210]]),
                scanIds: [],
            };
        },
    });
    const session = {
        shipid: SHIP_ID,
        _space: {
            shipID: SHIP_ID,
            frontierDirectionalScanIds: [7999],
        },
    };
    const response = service.Handle_directional_scan([], session, {
        type: "dict",
        entries: [
            ["scan_angle", 15],
            ["scan_direction", { type: "list", items: [0, 0, 1] }],
        ],
    });
    assert.equal(service.name, "scanningService");
    assert.equal(captured.moduleTypeID, ship.typeID);
    assert.equal(captured.scannerProfile.source, "built-in");
    assert.equal(captured.scannerProfile.sensorStrength, 25);
    assert.deepEqual(captured.scannerProfile.multipliers, [
        [scanningRuntime.SIGNATURE_TYPE_GRAVIMETRIC, 625],
        [scanningRuntime.SIGNATURE_TYPE_ELECTROMAGNETIC, 625],
        [scanningRuntime.SIGNATURE_TYPE_THERMAL, 625],
    ]);
    assert.deepEqual(captured.originPosition, ship.position);
    assert.deepEqual(captured.direction, { x: 0, y: 0, z: 1 });
    assert.deepEqual(captured.previousScanIds, [7999]);
    assert.deepEqual(captured.candidates, [{
            itemID: 8101,
            typeID: TYPE_SIGNATURE_TARGET,
            position: target.position,
            mass: target.mass,
            hasLineOfSight: true,
            // Type 23 authors signatureEm=75; the scanning service must forward the
            // effective target Dogma value instead of flattening every target to the
            // neutral 100-point EM signature.
            emSignatureMultiplier: 0.75,
            thermalSignatureMultiplier: 1,
        }]);
    assert.deepEqual(session._space.frontierDirectionalScanIds, []);
    assert.deepEqual(resolutionUpdate, {
        session,
        resolvedIds: [8101],
        options: {
            delayMs: 6000,
            delayMsByEntityID: new Map([[8101, 3210]]),
        },
    });
    assert.equal(response.type, "object");
    assert.equal(response.name, "util.KeyVal");
    const entries = new Map(response.args.entries);
    assert.deepEqual(entries.get("duration"), buildPythonTimedeltaPayload(6000));
    assert.deepEqual(entries.get("resolved"), {
        type: "dict",
        entries: [[8101, 32100000n]],
    });
    frontierMarshals(response);
});
test("MachoNet advertises the build 3502403 module-less scanning service", () => {
    const serviceInfo = new Map(new MachoNetService().getServiceInfoDict().entries);
    assert.equal(serviceInfo.has("scanningService"), true);
    assert.equal(serviceInfo.get("scanningService"), null);
});
test("module-less scanningService rejects malformed or docked requests as UserError", () => {
    const service = new ScanningService({
        spaceRuntime: {
            getEntity() {
                return null;
            },
            getSceneForSession() {
                return null;
            },
        },
    });
    const isWrappedUserError = (error) => Boolean(error &&
        error.machoErrorResponse &&
        error.machoErrorResponse.payload &&
        error.machoErrorResponse.payload.header &&
        error.machoErrorResponse.payload.header[0] &&
        error.machoErrorResponse.payload.header[0].value === "eveexceptions.UserError");
    assert.throws(() => service.Handle_directional_scan([], { _space: { shipID: SHIP_ID } }, {
        scan_angle: 90,
        scan_direction: [0, 0, 1],
    }), isWrappedUserError);
    assert.throws(() => service.Handle_directional_scan([], { shipid: SHIP_ID }, {
        scan_angle: 15,
        scan_direction: [0, 0, 1],
    }), isWrappedUserError);
});
//# sourceMappingURL=frontierCreationAbilities.test.js.map