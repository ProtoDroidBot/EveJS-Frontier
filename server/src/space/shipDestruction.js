"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const path = require("path");
const log = require(path.join(__dirname, "../utils/logger"));
const serverConfig = require(path.join(__dirname, "../config"));
const spaceRuntime = require(path.join(__dirname, "./runtime"));
const spatialTrace = require(path.join(__dirname, "../network/spatialTrace"));
const { ejectSessionForShipDestruction, rebuildDockedSessionAtStation, repairSameSceneSessionViewState, } = require(path.join(__dirname, "./transitions"));
const { getEntityMapKey, } = require(path.join(__dirname, "./destiny/identity/entityID"));
const { buildChildEntityScopeMetadata, } = require(path.join(__dirname, "./destiny/identity/interactionScope.js"));
const { CAPSULE_TYPE_ID, ITEM_FLAGS, createSpaceItemForOwner, findShipItemById, removeInventoryItem, } = require(path.join(__dirname, "../services/inventory/itemStore"));
const { emitFittingTransactionForSession, emitItemsChangedBatchForSession, getCharacterRecord, getActiveShipRecord, } = require(path.join(__dirname, "../services/character/characterState"));
const { getSpaceDebrisLifetimeMs, } = require(path.join(__dirname, "../services/inventory/spaceDebrisState"));
const { resolveLocationDeathOutcome, } = require(path.join(__dirname, "../services/killmail/deathOutcomeResolver"));
const { DEFAULT_SHELL_TYPE_ID, destroyActiveShellEquipment, getActiveShell, } = require(path.join(__dirname, "../services/frontier/shellEquipmentRuntime"));
const { buildDunRotationFromDirection, resolveEntityWreckType, resolveShipWreckType, } = require(path.join(__dirname, "./wreckUtils"));
const DEFAULT_DEATH_TEST_COUNT = 6;
const DEFAULT_DEATH_TEST_RADIUS_METERS = 20_000;
const DEFAULT_DEATH_TEST_DELAY_MS = 2_000;
const DESTRUCTION_EFFECT_EXPLOSION = 3;
const { resolveShipByTypeID } = require("../services/chat/shipTypeRegistry");
const pendingDeathTests = new Map();
let nextPendingDeathTestID = 1;
let pendingDeathTestTimer = null;
const pendingCloneSelectionTimers = new Map();
function handleInsuranceShipDestroyedSafe(systemID, shipEntity, options = {}, shipRecord = null) {
    if (!shipEntity || shipEntity.kind !== "ship") {
        return null;
    }
    try {
        const insuranceRuntime = require(path.join(__dirname, "../services/insurance/insuranceRuntime"));
        if (typeof insuranceRuntime.handleShipDestroyed !== "function") {
            return null;
        }
        return insuranceRuntime.handleShipDestroyed({
            shipID: shipEntity.itemID,
            itemID: shipEntity.itemID,
            typeID: shipEntity.typeID,
            ownerID: (shipRecord && shipRecord.ownerID) ||
                shipEntity.ownerID ||
                options.ownerID ||
                options.ownerCharacterID,
            ownerCharacterID: options.ownerCharacterID ||
                shipEntity.pilotCharacterID ||
                shipEntity.characterID ||
                shipEntity.ownerID,
            pilotCharacterID: shipEntity.pilotCharacterID ||
                shipEntity.characterID ||
                options.ownerCharacterID,
            corporationID: options.corporationID ||
                shipEntity.corporationID ||
                (shipRecord && shipRecord.corporationID) ||
                0,
            systemID,
            lossID: options.lossID,
            destroyedAtFiletime: options.destroyedAtFiletime,
            attackerEntity: options.attackerEntity || null,
            insuranceSuppressedReason: options.insuranceSuppressedReason || null,
            isConcordLoss: options.isConcordLoss === true,
            skipInsurance: options.skipInsurance === true,
        });
    }
    catch (error) {
        log.warn(`[ShipDestruction] Insurance payout hook failed ship=${shipEntity.itemID}: ${error.message}`);
        return null;
    }
}
function toFiniteNumber(value, fallback = 0) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : fallback;
}
function toPositiveInt(value, fallback = 0) {
    const numeric = Math.trunc(Number(value) || 0);
    return numeric > 0 ? numeric : fallback;
}
function cloneVector(vector, fallback = { x: 0, y: 0, z: 0 }) {
    return {
        x: toFiniteNumber(vector && vector.x, fallback.x),
        y: toFiniteNumber(vector && vector.y, fallback.y),
        z: toFiniteNumber(vector && vector.z, fallback.z),
    };
}
function addVectors(left, right) {
    return {
        x: toFiniteNumber(left && left.x, 0) + toFiniteNumber(right && right.x, 0),
        y: toFiniteNumber(left && left.y, 0) + toFiniteNumber(right && right.y, 0),
        z: toFiniteNumber(left && left.z, 0) + toFiniteNumber(right && right.z, 0),
    };
}
function scaleVector(vector, scalar) {
    return {
        x: toFiniteNumber(vector && vector.x, 0) * scalar,
        y: toFiniteNumber(vector && vector.y, 0) * scalar,
        z: toFiniteNumber(vector && vector.z, 0) * scalar,
    };
}
function normalizeVector(vector, fallback = { x: 1, y: 0, z: 0 }) {
    const resolved = cloneVector(vector, fallback);
    const length = Math.sqrt((resolved.x ** 2) + (resolved.y ** 2) + (resolved.z ** 2));
    if (!Number.isFinite(length) || length <= 0) {
        return { ...fallback };
    }
    return {
        x: resolved.x / length,
        y: resolved.y / length,
        z: resolved.z / length,
    };
}
function distance(left, right) {
    const dx = toFiniteNumber(left && left.x, 0) - toFiniteNumber(right && right.x, 0);
    const dy = toFiniteNumber(left && left.y, 0) - toFiniteNumber(right && right.y, 0);
    const dz = toFiniteNumber(left && left.z, 0) - toFiniteNumber(right && right.z, 0);
    return Math.sqrt((dx ** 2) + (dy ** 2) + (dz ** 2));
}
function buildRandomDirection(baseDirection) {
    const forward = normalizeVector(baseDirection, { x: 1, y: 0, z: 0 });
    const angle = Math.random() * Math.PI * 2;
    const vertical = (Math.random() - 0.5) * 0.3;
    return normalizeVector({
        x: forward.x + Math.cos(angle),
        y: forward.y + vertical,
        z: forward.z + Math.sin(angle),
    }, forward);
}
function buildShipDeathPositions(anchorEntity, count, radiusMeters) {
    const anchorPosition = cloneVector(anchorEntity && anchorEntity.position);
    const anchorDirection = normalizeVector(anchorEntity && anchorEntity.direction, { x: 1, y: 0, z: 0 });
    const positions = [];
    const maxRadius = Math.max(3_000, toFiniteNumber(radiusMeters, DEFAULT_DEATH_TEST_RADIUS_METERS));
    for (let index = 0; index < count; index += 1) {
        let accepted = null;
        for (let attempt = 0; attempt < 48; attempt += 1) {
            const direction = buildRandomDirection(anchorDirection);
            const offset = 3_000 + (Math.random() * Math.max(0, maxRadius - 3_000));
            const candidate = addVectors(anchorPosition, scaleVector(direction, offset));
            const collides = positions.some((existing) => distance(existing, candidate) < 1_500);
            if (!collides) {
                accepted = candidate;
                break;
            }
        }
        if (!accepted) {
            break;
        }
        positions.push(accepted);
    }
    return positions;
}
function releaseControlledCraftForDestroyedShip(systemID, shipEntity) {
    const numericSystemID = toPositiveInt(systemID, 0);
    if (!numericSystemID || !shipEntity || shipEntity.kind !== "ship") {
        return;
    }
    const scene = spaceRuntime.ensureScene(numericSystemID);
    if (!scene) {
        return;
    }
    try {
        const droneRuntime = require(path.join(__dirname, "../services/drone/droneRuntime"));
        if (droneRuntime && typeof droneRuntime.handleControllerLost === "function") {
            droneRuntime.handleControllerLost(scene, shipEntity, {
                lifecycleReason: "ship-destroyed",
                attemptBayRecovery: false,
            });
        }
    }
    catch (error) {
        log.warn(`[ShipDestruction] Drone cleanup failed for ship=${shipEntity.itemID}: ${error.message}`);
    }
    try {
        const fighterRuntime = require(path.join(__dirname, "../services/fighter/fighterRuntime"));
        if (fighterRuntime && typeof fighterRuntime.handleControllerLost === "function") {
            fighterRuntime.handleControllerLost(scene, shipEntity, {
                lifecycleReason: "ship-destroyed",
                attemptTubeRecovery: false,
            });
        }
    }
    catch (error) {
        log.warn(`[ShipDestruction] Fighter cleanup failed for ship=${shipEntity.itemID}: ${error.message}`);
    }
}
function clearPendingDeathTestTimer() {
    if (!pendingDeathTestTimer) {
        return;
    }
    clearInterval(pendingDeathTestTimer);
    pendingDeathTestTimer = null;
}
function ensurePendingDeathTestTimer() {
    if (pendingDeathTestTimer) {
        return;
    }
    pendingDeathTestTimer = setInterval(() => {
        try {
            processPendingDeathTests();
        }
        catch (error) {
            log.warn(`[ShipDestruction] Pending death-test processing failed: ${error.message}`);
        }
    }, 100);
    if (pendingDeathTestTimer && typeof pendingDeathTestTimer.unref === "function") {
        pendingDeathTestTimer.unref();
    }
}
function processPendingDeathTests() {
    if (pendingDeathTests.size <= 0) {
        clearPendingDeathTestTimer();
        return 0;
    }
    let processedCount = 0;
    for (const [pendingID, pending] of [...pendingDeathTests.entries()]) {
        if (!pending) {
            pendingDeathTests.delete(pendingID);
            continue;
        }
        const currentSimTimeMs = spaceRuntime.getSimulationTimeMsForSystem(pending.systemID, 0);
        if (currentSimTimeMs < pending.completeAtSimMs) {
            continue;
        }
        pendingDeathTests.delete(pendingID);
        processedCount += 1;
        const scene = spaceRuntime.ensureScene(pending.systemID);
        const destroyed = [];
        for (const spawnedEntityID of pending.spawnedEntityIDs) {
            const liveEntity = scene ? scene.getEntityByID(spawnedEntityID) : null;
            if (!liveEntity) {
                continue;
            }
            const destroyResult = destroyShipEntityWithWreck(pending.systemID, liveEntity, {
                ownerCharacterID: pending.ownerCharacterID,
            });
            if (destroyResult.success) {
                destroyed.push({
                    shipID: liveEntity.itemID,
                    wreckID: destroyResult.data.wreck.itemID,
                });
            }
        }
        pending.resolve({
            shipType: pending.shipType,
            spawnedCount: pending.spawnedCount,
            destroyed,
        });
    }
    if (pendingDeathTests.size <= 0) {
        clearPendingDeathTestTimer();
    }
    return processedCount;
}
function queuePendingDeathTest({ systemID, ownerCharacterID, shipType, spawnedEntityIDs, spawnedCount, delayMs, }) {
    const scene = spaceRuntime.ensureScene(systemID);
    const currentSimTimeMs = scene
        ? scene.getCurrentSimTimeMs()
        : spaceRuntime.getSimulationTimeMsForSystem(systemID);
    const pendingID = nextPendingDeathTestID++;
    let resolvePromise = null;
    const completionPromise = new Promise((resolve) => {
        resolvePromise = resolve;
    });
    pendingDeathTests.set(pendingID, {
        systemID,
        ownerCharacterID,
        shipType,
        spawnedEntityIDs: [...spawnedEntityIDs],
        spawnedCount,
        completeAtSimMs: currentSimTimeMs + Math.max(0, toFiniteNumber(delayMs, 0)),
        resolve: resolvePromise,
    });
    ensurePendingDeathTestTimer();
    processPendingDeathTests();
    return {
        completionPromise,
        completeAtSimMs: currentSimTimeMs + Math.max(0, toFiniteNumber(delayMs, 0)),
    };
}
function destroyShipEntityWithWreck(systemID, shipEntity, options = {}) {
    const numericSystemID = toPositiveInt(systemID, 0);
    if (shipEntity && shipEntity.nativeNpc === true) {
        const { destroyNativeNpcEntityWithWreck, } = require(path.join(__dirname, "./npc/nativeNpcWreckService"));
        return destroyNativeNpcEntityWithWreck(numericSystemID, shipEntity, options);
    }
    const ownerCharacterID = toPositiveInt(options.ownerCharacterID ||
        options.characterID ||
        (shipEntity && shipEntity.pilotCharacterID) ||
        (shipEntity && shipEntity.characterID) ||
        (shipEntity && shipEntity.ownerID), 0);
    if (!numericSystemID || !shipEntity || shipEntity.kind !== "ship") {
        return {
            success: false,
            errorMsg: "SHIP_NOT_FOUND",
        };
    }
    if (!ownerCharacterID) {
        return {
            success: false,
            errorMsg: "OWNER_CHARACTER_REQUIRED",
        };
    }
    releaseControlledCraftForDestroyedShip(numericSystemID, shipEntity);
    const shipRecord = options.shipRecord ||
        (shipEntity.persistSpaceState === true
            ? getActiveShipRecord(ownerCharacterID)
            : findShipItemById(shipEntity.itemID)) ||
        null;
    const wreckType = resolveShipWreckType(shipEntity.typeID);
    if (!wreckType) {
        return {
            success: false,
            errorMsg: "WRECK_TYPE_NOT_FOUND",
        };
    }
    const now = spaceRuntime.getSimulationTimeMsForSystem(numericSystemID);
    const wreckCreateResult = createSpaceItemForOwner(ownerCharacterID, numericSystemID, wreckType, {
        ...buildChildEntityScopeMetadata(shipEntity),
        itemName: wreckType.name,
        position: cloneVector(shipEntity.position),
        direction: normalizeVector(shipEntity.direction, { x: 1, y: 0, z: 0 }),
        velocity: { x: 0, y: 0, z: 0 },
        targetPoint: cloneVector(shipEntity.position),
        mode: "STOP",
        speedFraction: 0,
        transient: shipEntity.transient === true,
        createdAtMs: now,
        expiresAtMs: now + getSpaceDebrisLifetimeMs(),
        launcherID: shipEntity.itemID,
        spaceRadius: toFiniteNumber(shipEntity.radius, 0),
        dunRotation: buildDunRotationFromDirection(shipEntity.direction),
        conditionState: {
            damage: 0,
            charge: 1,
            armorDamage: 0,
            shieldCharge: 0,
            incapacitated: false,
        },
    });
    if (!wreckCreateResult.success || !wreckCreateResult.data) {
        return {
            success: false,
            errorMsg: "WRECK_CREATE_FAILED",
        };
    }
    const wreckItem = wreckCreateResult.data;
    if (spatialTrace.isEnabled()) {
        spatialTrace.recordWreckRecordCreated(spaceRuntime.ensureScene(numericSystemID), {
            ...wreckItem,
            wreckID: wreckItem.itemID,
            sourceEntityID: shipEntity.itemID,
            systemID: numericSystemID,
            launcherID: wreckItem.spaceState && wreckItem.spaceState.launcherID !== undefined
                ? wreckItem.spaceState.launcherID
                : shipEntity.itemID,
        }, {
            persistenceKind: shipEntity.transient === true
                ? "inventory-transient-record"
                : "inventory-persisted-record",
        });
    }
    const deathOutcomeResult = shipRecord
        ? resolveLocationDeathOutcome(shipRecord.itemID, {
            rootLootLocationID: wreckItem.itemID,
            seed: `ship:${shipEntity.itemID}:${now}`,
        })
        : {
            success: true,
            data: {
                items: [],
                movedChanges: [],
                destroyChanges: [],
            },
        };
    const killmailItems = deathOutcomeResult &&
        deathOutcomeResult.success &&
        deathOutcomeResult.data &&
        Array.isArray(deathOutcomeResult.data.items)
        ? deathOutcomeResult.data.items
        : [];
    const movedChanges = deathOutcomeResult &&
        deathOutcomeResult.success &&
        deathOutcomeResult.data &&
        Array.isArray(deathOutcomeResult.data.movedChanges)
        ? deathOutcomeResult.data.movedChanges
        : [];
    const contentDestroyChanges = deathOutcomeResult &&
        deathOutcomeResult.success &&
        deathOutcomeResult.data &&
        Array.isArray(deathOutcomeResult.data.destroyChanges)
        ? deathOutcomeResult.data.destroyChanges
        : [];
    let destroyResult = null;
    let destroyChanges = [];
    if (shipEntity.persistSpaceState === true && !shipEntity.session) {
        destroyResult = spaceRuntime.removeDynamicEntity(numericSystemID, shipEntity.itemID, {
            allowSessionOwned: false,
            terminalDestructionEffectID: DESTRUCTION_EFFECT_EXPLOSION,
            forceVisibleSessions: options.forceVisibleSessions,
        });
        if (!destroyResult.success) {
            return destroyResult;
        }
        const removeShipItemResult = removeInventoryItem(shipEntity.itemID, {
            removeContents: false,
        });
        if (!removeShipItemResult.success) {
            return removeShipItemResult;
        }
        destroyChanges = [
            ...contentDestroyChanges,
            ...(destroyResult.data && Array.isArray(destroyResult.data.changes)
                ? destroyResult.data.changes
                : []),
            ...(removeShipItemResult.data && Array.isArray(removeShipItemResult.data.changes)
                ? removeShipItemResult.data.changes
                : []),
        ];
    }
    else if (shipEntity.persistSpaceState === true) {
        destroyResult = spaceRuntime.destroyDynamicInventoryEntity(numericSystemID, shipEntity.itemID, {
            removeContents: false,
            terminalDestructionEffectID: DESTRUCTION_EFFECT_EXPLOSION,
        });
        if (!destroyResult.success) {
            return destroyResult;
        }
        destroyChanges =
            [
                ...contentDestroyChanges,
                ...(destroyResult.data && Array.isArray(destroyResult.data.changes)
                    ? destroyResult.data.changes
                    : []),
            ];
    }
    else {
        destroyResult = spaceRuntime.removeDynamicEntity(numericSystemID, shipEntity.itemID, {
            allowSessionOwned: false,
            terminalDestructionEffectID: DESTRUCTION_EFFECT_EXPLOSION,
            forceVisibleSessions: options.forceVisibleSessions,
        });
        if (!destroyResult.success) {
            return destroyResult;
        }
        destroyChanges =
            [
                ...contentDestroyChanges,
                ...(destroyResult.data && Array.isArray(destroyResult.data.changes)
                    ? destroyResult.data.changes
                    : []),
            ];
    }
    const wreckSpawnResult = spaceRuntime.spawnDynamicInventoryEntity(numericSystemID, wreckItem.itemID, {
        // Replacement wrecks are a follow-on to an already visible destruction
        // event, not a fresh scene bootstrap. Sending them on the lighter
        // immediate lane avoids bootstrap-acquire backsteps when several hulls
        // die in the same tick, which is exactly what /deathtest does.
        broadcastOptions: {
            deferUntilVisibilitySync: options.deferWreckBroadcastUntilVisibilitySync === true,
            freshAcquire: false,
        },
    });
    if (!wreckSpawnResult.success) {
        return wreckSpawnResult;
    }
    log.info(`[ShipDestruction] Destroyed ship=${shipEntity.itemID} type=${shipEntity.typeID} wreck=${wreckItem.itemID} system=${numericSystemID}`);
    if (options.deferInsurancePayout !== true) {
        handleInsuranceShipDestroyedSafe(numericSystemID, shipEntity, options, shipRecord);
    }
    return {
        success: true,
        data: {
            wreck: wreckItem,
            shipID: shipEntity.itemID,
            movedChanges,
            destroyChanges,
            lootOutcome: {
                items: killmailItems,
            },
            wreckChanges: wreckCreateResult.changes ||
                (wreckCreateResult.data && wreckCreateResult.data.changes) ||
                [],
        },
    };
}
function destroyShipEntityWithoutWreck(systemID, shipEntity, options = {}) {
    const numericSystemID = toPositiveInt(systemID, 0);
    if (!numericSystemID || !shipEntity || shipEntity.kind !== "ship") {
        return {
            success: false,
            errorMsg: "SHIP_NOT_FOUND",
        };
    }
    releaseControlledCraftForDestroyedShip(numericSystemID, shipEntity);
    const deathOutcomeResult = options.removeContents === true
        ? resolveLocationDeathOutcome(shipEntity.itemID, {
            forceAllDestroyed: true,
            seed: `ship-destroyed:${shipEntity.itemID}:${numericSystemID}`,
        })
        : {
            success: true,
            data: {
                items: [],
                destroyChanges: [],
            },
        };
    const killmailItems = deathOutcomeResult &&
        deathOutcomeResult.success &&
        deathOutcomeResult.data &&
        Array.isArray(deathOutcomeResult.data.items)
        ? deathOutcomeResult.data.items
        : [];
    const contentDestroyChanges = deathOutcomeResult &&
        deathOutcomeResult.success &&
        deathOutcomeResult.data &&
        Array.isArray(deathOutcomeResult.data.destroyChanges)
        ? deathOutcomeResult.data.destroyChanges
        : [];
    const removeEntityResult = spaceRuntime.removeDynamicEntity(numericSystemID, shipEntity.itemID, {
        allowSessionOwned: options.allowSessionOwned === true,
        terminalDestructionEffectID: toPositiveInt(options.terminalDestructionEffectID, DESTRUCTION_EFFECT_EXPLOSION),
    });
    if (!removeEntityResult.success) {
        return removeEntityResult;
    }
    const removeShipItemResult = removeInventoryItem(shipEntity.itemID, {
        removeContents: options.removeContents === true,
    });
    if (!removeShipItemResult.success) {
        return removeShipItemResult;
    }
    handleInsuranceShipDestroyedSafe(numericSystemID, shipEntity, options, null);
    return {
        success: true,
        data: {
            shipID: shipEntity.itemID,
            lootOutcome: {
                items: killmailItems,
            },
            changes: [
                ...contentDestroyChanges,
                ...(removeShipItemResult.data &&
                    Array.isArray(removeShipItemResult.data.changes)
                    ? removeShipItemResult.data.changes
                    : []),
            ],
        },
    };
}
function reseedDestroyedPilotSession(scene, session, capsuleEntity) {
    if (!scene || !session || !session._space || !capsuleEntity) {
        return false;
    }
    // The same-scene transition has already committed the capsule ego AddBalls
    // and carried the accepted non-ego membership into this generation. Death
    // orchestration may repair stale bootstrap flags, but must not select a
    // second stamp, replay the capsule, or rewrite visibility truth. The normal
    // combined visibility owner below reconciles any real topology delta.
    repairSameSceneSessionViewState(session);
    return true;
}
function purgeDestroyedShipEntityFromScene(scene, shipID) {
    if (!scene ||
        typeof scene.purgeDestroyedShipEntityTopology !== "function") {
        return false;
    }
    return scene.purgeDestroyedShipEntityTopology(shipID);
}
function getAttachedSessionShipDestructionContext(session) {
    if (!session || !session._space) {
        return {
            scene: null,
            entity: null,
            systemID: 0,
        };
    }
    const systemID = toPositiveInt(session._space.systemID, 0);
    const scene = systemID > 0 ? spaceRuntime.ensureScene(systemID) : null;
    const entity = scene && session._space
        ? scene.getEntityByID(toPositiveInt(session._space.shipID, 0))
        : null;
    return {
        scene,
        entity: entity && entity.kind === "ship" ? entity : null,
        systemID,
    };
}
function resolvePodRespawnStationID(session) {
    const characterRecord = getCharacterRecord(session && session.characterID) || {};
    return Number(characterRecord.homeStationID ||
        characterRecord.cloneStationID ||
        (session && session.homeStationID) ||
        (session && session.homestationid) ||
        (session && session.cloneStationID) ||
        (session && session.clonestationid) ||
        60003760) || 60003760;
}
function destroySessionShellEquipmentForDeath(session) {
    const result = destroyActiveShellEquipment(session && session.characterID, {
        reason: "death",
    });
    if (!result || result.success !== true) {
        log.warn(`[ShipDestruction] Shell equipment cleanup failed char=${session && session.characterID} error=${result && result.errorMsg || "UNKNOWN"}`);
        return result;
    }
    const changes = result.data && Array.isArray(result.data.changes)
        ? result.data.changes
        : [];
    emitShipDeathInventoryChangesForSession(session, changes);
    if (changes.length > 0) {
        log.info(`[ShipDestruction] Destroyed ${changes.length} shell equipment item(s) for char=${session.characterID}`);
    }
    return result;
}
function resetEnvironmentalCloneStateSafe(characterID) {
    try {
        const environmentalEffects = require(path.join(__dirname, "../services/frontier/environmentalEffectsService"));
        if (typeof environmentalEffects.resetCharacterState === "function") {
            environmentalEffects.resetCharacterState(characterID);
        }
    }
    catch (error) {
        log.warn(`[ShipDestruction] Environmental state reset failed char=${characterID}: ${error.message}`);
    }
}
function sendCloneDeathNotification(session, eventName, shipID) {
    if (!session || typeof session.sendNotification !== "function") {
        return false;
    }
    try {
        session.sendNotification(eventName, "charid", [toPositiveInt(shipID, 0)]);
        return true;
    }
    catch (error) {
        log.warn(`[ShipDestruction] ${eventName} delivery failed char=${session.characterID}: ${error.message}`);
        return false;
    }
}
function getLocationSelectionMgr() {
    return require(path.join(__dirname, "../services/frontier/locationSelectionMgrService"));
}
function resolveCloneDeathTransitionDelayMs(options = {}) {
    const configuredSeconds = Math.max(0, toFiniteNumber(options.transitionDelaySeconds, serverConfig.frontierCloneDeathTransitionDelaySeconds ?? 5));
    return Math.max(0, toFiniteNumber(options.transitionDelayMs, configuredSeconds * 1_000));
}
function recordCloneDeathStateSafe(session, shipEntity, systemID, statusEffectKey, nowMs, options = {}) {
    try {
        const locationSelectionMgr = getLocationSelectionMgr();
        if (typeof locationSelectionMgr.recordCloneDeathReport !== "function") {
            return null;
        }
        const activeShell = getActiveShell(session && session.characterID);
        const deathReport = locationSelectionMgr.recordCloneDeathReport(session && session.characterID, {
            deathTimeMs: nowMs,
            shellTypeID: toPositiveInt(activeShell && activeShell.typeID, DEFAULT_SHELL_TYPE_ID),
            shipID: shipEntity && shipEntity.itemID,
            shipTypeID: shipEntity && shipEntity.typeID,
            solarSystemID: systemID,
            statusEffectKey,
        });
        const transitionDelayMs = resolveCloneDeathTransitionDelayMs(options);
        const pending = typeof locationSelectionMgr.recordPendingCloneDeath === "function"
            ? locationSelectionMgr.recordPendingCloneDeath(session && session.characterID, {
                deathSystemID: systemID,
                fallbackStationID: resolvePodRespawnStationID(session),
                readyAtMs: Date.now() + transitionDelayMs,
                reason: options.reason,
            })
            : null;
        return { deathReport, pending, transitionDelayMs };
    }
    catch (error) {
        log.warn(`[ShipDestruction] Clone death state failed char=${session && session.characterID}: ${error.message}`);
        return null;
    }
}
function clearSessionShipForCloneSelection(session, oldShipID, systemID) {
    if (!session || !session.characterID) {
        return false;
    }
    try {
        const locationSelectionMgr = getLocationSelectionMgr();
        if (typeof locationSelectionMgr.clearCharacterActiveShip === "function") {
            const result = locationSelectionMgr.clearCharacterActiveShip(session.characterID);
            if (result && result.success === false) {
                log.warn(`[ShipDestruction] Failed to clear active ship for clone selection char=${session.characterID}: ${result.errorMsg}`);
            }
        }
    }
    catch (error) {
        log.warn(`[ShipDestruction] Failed to persist clone-selection ship state char=${session.characterID}: ${error.message}`);
    }
    const previousShipID = toPositiveInt(oldShipID || session.shipid || session.shipID || session.activeShipID, 0);
    const numericSystemID = toPositiveInt(systemID || session.solarsystemid2 || session.solarsystemid || session.locationid, 0);
    session.shipid = null;
    session.shipID = null;
    session.activeShipID = 0;
    session.shipTypeID = 0;
    session.shipName = "";
    session.stationid = null;
    session.stationID = null;
    session.stationid2 = null;
    session.structureid = null;
    session.structureID = null;
    if (numericSystemID > 0) {
        session.solarsystemid = numericSystemID;
        session.solarsystemid2 = numericSystemID;
        session.locationid = numericSystemID;
    }
    if (typeof session.sendSessionChange === "function") {
        session.sendSessionChange({
            shipid: [previousShipID || null, null],
        });
    }
    return true;
}
function queueCloneSelectionTransition(session, callback, options = {}) {
    const characterID = toPositiveInt(session && session.characterID, 0);
    const delayMs = resolveCloneDeathTransitionDelayMs(options);
    const previousTimer = pendingCloneSelectionTimers.get(characterID);
    if (previousTimer) {
        clearTimeout(previousTimer);
        pendingCloneSelectionTimers.delete(characterID);
    }
    const complete = () => {
        pendingCloneSelectionTimers.delete(characterID);
        try {
            return callback();
        }
        catch (error) {
            log.warn(`[ShipDestruction] Clone-selection transition failed char=${characterID}: ${error.message}`);
            return null;
        }
    };
    if (delayMs <= 0) {
        return {
            delayMs,
            pending: false,
            result: complete(),
        };
    }
    const timer = setTimeout(complete, delayMs);
    if (timer && typeof timer.unref === "function") {
        timer.unref();
    }
    pendingCloneSelectionTimers.set(characterID, timer);
    return {
        delayMs,
        pending: true,
        result: null,
    };
}
function destroySessionClonePreservingShip(session, options = {}) {
    if (!session || !session.characterID || !session._space) {
        return {
            success: false,
            errorMsg: "NOT_IN_SPACE",
        };
    }
    const { entity: attachedShipEntity, systemID, } = getAttachedSessionShipDestructionContext(session);
    if (!attachedShipEntity) {
        return {
            success: false,
            errorMsg: "SHIP_ENTITY_NOT_FOUND",
        };
    }
    const characterID = toPositiveInt(session.characterID, 0);
    const shipID = toPositiveInt(attachedShipEntity.itemID, 0);
    session.sessionChangeReason = options.sessionChangeReason || "environmental";
    const deathState = recordCloneDeathStateSafe(session, attachedShipEntity, systemID, options.statusEffectKey, toFiniteNumber(options.nowMs, Date.now()), { ...options, reason: "vitality" });
    sendCloneDeathNotification(session, "OnShellDeath", shipID);
    const shellEquipmentResult = destroySessionShellEquipmentForDeath(session);
    const transition = queueCloneSelectionTransition(session, () => {
        const liveContext = getAttachedSessionShipDestructionContext(session);
        if (!liveContext.entity ||
            toPositiveInt(liveContext.entity.itemID, 0) !== shipID) {
            throw new Error("PRESERVED_SHIP_NO_LONGER_ATTACHED");
        }
        const abandonedShipEntity = spaceRuntime.disembarkSession(session, {
            broadcast: true,
            lifecycleReason: "environmental-clone-death",
        });
        if (!abandonedShipEntity) {
            throw new Error("SHIP_ENTITY_NOT_FOUND");
        }
        clearSessionShipForCloneSelection(session, shipID, systemID);
        resetEnvironmentalCloneStateSafe(characterID);
        log.info(`[ShipDestruction] Opened shell-expiration clone selection ` +
            `char=${characterID} effect=${options.statusEffectKey || "unknown"} ` +
            `preservedShip=${shipID} system=${systemID}`);
        return abandonedShipEntity;
    });
    log.info(`[ShipDestruction] Shell-expiration transition queued char=${characterID} ` +
        `effect=${options.statusEffectKey || "unknown"} preservedShip=${shipID} ` +
        `delayMs=${transition.delayMs}`);
    return {
        success: true,
        data: {
            cloneDeath: true,
            cloneSelectionPending: transition.pending,
            cloneSelectionTransition: transition,
            preservedShip: attachedShipEntity,
            preservedShipID: shipID,
            deathReport: deathState && deathState.deathReport,
            shellEquipmentChanges: shellEquipmentResult &&
                shellEquipmentResult.success === true &&
                shellEquipmentResult.data &&
                Array.isArray(shellEquipmentResult.data.changes)
                ? shellEquipmentResult.data.changes
                : [],
        },
    };
}
function destroyAttachedSessionCapsuleFallback(session, options = {}) {
    if (!session || !session.characterID || !session._space) {
        return {
            success: false,
            errorMsg: "NOT_IN_SPACE",
        };
    }
    const { scene, entity: attachedCapsuleEntity, systemID, } = getAttachedSessionShipDestructionContext(session);
    if (!scene || !attachedCapsuleEntity || Number(attachedCapsuleEntity.typeID) !== CAPSULE_TYPE_ID) {
        return {
            success: false,
            errorMsg: "CAPSULE_ENTITY_NOT_FOUND",
        };
    }
    session.sessionChangeReason = options.sessionChangeReason || "selfdestruct";
    const abandonedCapsuleEntity = spaceRuntime.disembarkSession(session, {
        broadcast: false,
    });
    if (!abandonedCapsuleEntity) {
        return {
            success: false,
            errorMsg: "CAPSULE_ENTITY_NOT_FOUND",
        };
    }
    const destroyResult = destroyShipEntityWithWreck(systemID, abandonedCapsuleEntity, {
        ownerCharacterID: session.characterID,
        shipRecord: {
            itemID: abandonedCapsuleEntity.itemID,
            typeID: abandonedCapsuleEntity.typeID,
            locationID: systemID,
            ownerID: session.characterID,
        },
    });
    if (!destroyResult.success) {
        log.warn(`[ShipDestruction] Fallback capsule destroy cleanup failed for char=${session.characterID} pod=${abandonedCapsuleEntity.itemID} error=${destroyResult.errorMsg}`);
        return destroyResult;
    }
    const shellEquipmentResult = destroySessionShellEquipmentForDeath(session);
    let respawnResult = null;
    if (getCharacterRecord(session.characterID)) {
        const targetStationID = resolvePodRespawnStationID(session);
        respawnResult = rebuildDockedSessionAtStation(session, targetStationID, {
            emitNotifications: true,
            logSelection: true,
            boardNewbieShip: true,
            newbieShipLogLabel: "PodRespawnFallback",
        });
        if (!respawnResult.success || !respawnResult.data) {
            return respawnResult;
        }
        log.info(`[ShipDestruction] Fallback-podded ${session.characterName || session.characterID} pod=${abandonedCapsuleEntity.itemID} station=${targetStationID} ship=${respawnResult.data.ship && respawnResult.data.ship.itemID}`);
    }
    return {
        success: true,
        data: {
            station: respawnResult && respawnResult.data ? respawnResult.data.station : null,
            capsule: respawnResult && respawnResult.data ? respawnResult.data.capsule : null,
            ship: respawnResult && respawnResult.data ? respawnResult.data.ship : null,
            destroyedShipID: abandonedCapsuleEntity.itemID,
            wreck: destroyResult.data ? destroyResult.data.wreck || null : null,
            movedChanges: destroyResult.data && Array.isArray(destroyResult.data.movedChanges)
                ? destroyResult.data.movedChanges
                : [],
            destroyChanges: destroyResult.data && Array.isArray(destroyResult.data.destroyChanges)
                ? destroyResult.data.destroyChanges
                : [],
            wreckChanges: destroyResult.data && Array.isArray(destroyResult.data.wreckChanges)
                ? destroyResult.data.wreckChanges
                : [],
            shellEquipmentChanges: shellEquipmentResult &&
                shellEquipmentResult.success === true &&
                shellEquipmentResult.data &&
                Array.isArray(shellEquipmentResult.data.changes)
                ? shellEquipmentResult.data.changes
                : [],
            boundResult: respawnResult && respawnResult.data ? respawnResult.data.boundResult : null,
            transientSessionFallback: true,
        },
    };
}
function emitShipDeathInventoryChangeForSession(session, change) {
    if (!change || !change.item) {
        return false;
    }
    return emitItemsChangedBatchForSession(session, [change], {
        idType: "charid",
    });
}
function emitShipDeathInventoryChangesForSession(session, changes = []) {
    let emittedCount = 0;
    for (const change of Array.isArray(changes) ? changes : []) {
        if (emitShipDeathInventoryChangeForSession(session, change)) {
            emittedCount += 1;
        }
    }
    return emittedCount;
}
function emitDestroyedShipContentChangesForSession(session, destroyedShipID, destroyData = {}, options = {}) {
    if (!session || !destroyData) {
        return 0;
    }
    const changes = [
        ...(Array.isArray(destroyData.movedChanges) ? destroyData.movedChanges : []),
        ...(Array.isArray(destroyData.destroyChanges) ? destroyData.destroyChanges : []),
    ];
    if (changes.length === 0) {
        return 0;
    }
    if (emitFittingTransactionForSession(session, destroyedShipID, changes, {
        shipItem: options.shipRecord || null,
    })) {
        return changes.length;
    }
    return emitShipDeathInventoryChangesForSession(session, changes);
}
function destroySessionShip(session, options = {}) {
    if (!session || !session.characterID || !session._space) {
        return {
            success: false,
            errorMsg: "NOT_IN_SPACE",
        };
    }
    const activeShip = getActiveShipRecord(session.characterID);
    if (!activeShip) {
        const { entity: attachedEntity } = getAttachedSessionShipDestructionContext(session);
        if (attachedEntity && Number(attachedEntity.typeID) === CAPSULE_TYPE_ID) {
            return destroyAttachedSessionCapsuleFallback(session, options);
        }
        return {
            success: false,
            errorMsg: "SHIP_NOT_FOUND",
        };
    }
    if (Number(activeShip.typeID) === CAPSULE_TYPE_ID) {
        return destroySessionCapsuleToHomeStation(session, activeShip, options);
    }
    session.sessionChangeReason = options.sessionChangeReason || "selfdestruct";
    const systemID = toPositiveInt(session._space && session._space.systemID, toPositiveInt(activeShip.locationID, 0));
    let destroyResult = null;
    let destructionScene = null;
    let syncedDestroyedShipContentChangeCount = 0;
    const ejectResult = ejectSessionForShipDestruction(session, {
        // Combat destruction is not manual eject parity. Replaying the abandoned
        // hull back to the victim before we destroy it re-seeds the stale ship
        // view, leaves the wreck/explosion handoff inconsistent, and lets NPCs
        // keep shooting at what the victim still sees as a live burning hull.
        sendAbandonedShipSlimToVictim: false,
        refreshAbandonedShipViewForVictim: false,
        syncAllSessionsVisibilityAfterSwap: false,
        sendEjectSpecialFx: false,
        disconnectBoundObjectsBeforeSwap: true,
        sameSceneShipSwapSessionId: 0n,
        beforeSameSceneShipSwapNotificationPlanFlush({ scene, abandonedShipEntity, }) {
            destructionScene = scene || null;
            if (!scene || !abandonedShipEntity) {
                destroyResult = {
                    success: false,
                    errorMsg: "ABANDONED_SHIP_NOT_FOUND",
                };
                return { success: true };
            }
            destroyResult = destroyShipEntityWithWreck(systemID, abandonedShipEntity, {
                ownerCharacterID: session.characterID,
                shipRecord: activeShip,
                forceVisibleSessions: [session],
                deferWreckBroadcastUntilVisibilitySync: true,
            });
            if (destroyResult.success) {
                syncedDestroyedShipContentChangeCount =
                    emitDestroyedShipContentChangesForSession(session, activeShip.itemID, destroyResult.data || {}, { shipRecord: activeShip });
            }
            return { success: true };
        },
    });
    if (!ejectResult.success || !ejectResult.data) {
        return ejectResult;
    }
    if (!destroyResult) {
        return {
            success: false,
            errorMsg: "SHIP_DESTRUCTION_NOT_RUN",
        };
    }
    if (!destroyResult.success) {
        return destroyResult;
    }
    const scene = destructionScene || spaceRuntime.ensureScene(systemID);
    purgeDestroyedShipEntityFromScene(scene, activeShip.itemID);
    const capsuleEntity = scene && session && session._space
        ? scene.getEntityByID(getEntityMapKey(session._space.shipID))
        : null;
    if (capsuleEntity && session && session._space) {
        reseedDestroyedPilotSession(scene, session, capsuleEntity);
    }
    return {
        success: true,
        data: {
            capsule: ejectResult.data.capsule,
            wreck: destroyResult.data.wreck,
            destroyedShipID: activeShip.itemID,
            movedChanges: destroyResult.data.movedChanges,
            destroyChanges: destroyResult.data.destroyChanges,
            wreckChanges: destroyResult.data.wreckChanges,
            destroyedShipContentChangesSyncedToSession: true,
            syncedDestroyedShipContentChangeCount,
            boundResult: ejectResult.data.boundResult,
        },
    };
}
function destroySessionCapsuleForCloneSelection(session, options = {}) {
    const { scene, entity: capsuleEntity, systemID, } = getAttachedSessionShipDestructionContext(session);
    if (!scene ||
        !capsuleEntity ||
        Number(capsuleEntity.typeID) !== CAPSULE_TYPE_ID) {
        return {
            success: false,
            errorMsg: "CAPSULE_ENTITY_NOT_FOUND",
        };
    }
    const capsuleID = toPositiveInt(capsuleEntity.itemID, 0);
    const capsuleRecord = findShipItemById(capsuleID) || {
        itemID: capsuleID,
        typeID: capsuleEntity.typeID,
        locationID: systemID,
        ownerID: session.characterID,
    };
    const abandonedCapsuleEntity = spaceRuntime.disembarkSession(session, {
        broadcast: false,
        lifecycleReason: "clone-death-selection",
    });
    if (!abandonedCapsuleEntity) {
        return {
            success: false,
            errorMsg: "CAPSULE_ENTITY_NOT_FOUND",
        };
    }
    const destroyResult = destroyShipEntityWithWreck(systemID, abandonedCapsuleEntity, {
        ...options,
        ownerCharacterID: session.characterID,
        shipRecord: capsuleRecord,
    });
    if (!destroyResult.success) {
        log.warn(`[ShipDestruction] Capsule cleanup failed before clone selection ` +
            `char=${session.characterID} pod=${capsuleID} error=${destroyResult.errorMsg}`);
    }
    clearSessionShipForCloneSelection(session, capsuleID, systemID);
    resetEnvironmentalCloneStateSafe(session.characterID);
    return {
        success: true,
        data: {
            destroyedShipID: capsuleID,
            systemID,
            wreck: destroyResult.success && destroyResult.data
                ? destroyResult.data.wreck || null
                : null,
        },
    };
}
function destroySessionShipAndClone(session, options = {}) {
    if (!session || !session.characterID || !session._space) {
        return {
            success: false,
            errorMsg: "NOT_IN_SPACE",
        };
    }
    const characterID = toPositiveInt(session.characterID, 0);
    const originalContext = getAttachedSessionShipDestructionContext(session);
    const originalShipEntity = originalContext.entity;
    if (!originalShipEntity) {
        return {
            success: false,
            errorMsg: "SHIP_ENTITY_NOT_FOUND",
        };
    }
    const originalShipID = toPositiveInt(originalShipEntity.itemID, 0);
    const deathState = recordCloneDeathStateSafe(session, originalShipEntity, originalContext.systemID, options.environmentalStatusEffectKey || options.statusEffectKey, toFiniteNumber(options.nowMs || options.destructionNowMs, Date.now()), { ...options, reason: "hull" });
    sendCloneDeathNotification(session, "OnPlayerDeath", originalShipID);
    let shipDestructionResult = null;
    if (Number(originalShipEntity.typeID) === CAPSULE_TYPE_ID) {
        shipDestructionResult = {
            success: true,
            data: {
                capsule: originalShipEntity,
                destroyedShipID: originalShipID,
            },
        };
    }
    else {
        shipDestructionResult = destroySessionShip(session, options);
        if (!shipDestructionResult.success || !shipDestructionResult.data) {
            return shipDestructionResult;
        }
    }
    const shellEquipmentResult = destroySessionShellEquipmentForDeath(session);
    const transition = queueCloneSelectionTransition(session, () => {
        const cloneDeathResult = destroySessionCapsuleForCloneSelection(session, {
            ...options,
            sessionChangeReason: options.sessionChangeReason || "combat",
        });
        if (!cloneDeathResult.success || !cloneDeathResult.data) {
            throw new Error(cloneDeathResult.errorMsg || "CLONE_DEATH_FAILED");
        }
        log.info(`[ShipDestruction] Opened hull-death clone selection ` +
            `char=${characterID} ship=${originalShipID} system=${originalContext.systemID}`);
        return cloneDeathResult;
    }, options);
    return {
        success: true,
        data: {
            ...shipDestructionResult.data,
            cloneDeath: true,
            cloneDeathResult: transition.result,
            cloneSelectionPending: transition.pending,
            cloneSelectionTransition: transition,
            deathReport: deathState && deathState.deathReport,
            originalShipID,
            shellEquipmentChanges: shellEquipmentResult &&
                shellEquipmentResult.success === true &&
                shellEquipmentResult.data &&
                Array.isArray(shellEquipmentResult.data.changes)
                ? shellEquipmentResult.data.changes
                : [],
        },
    };
}
function destroySessionCapsuleToHomeStation(session, activeShip, options = {}) {
    if (!session || !session.characterID || !session._space) {
        return {
            success: false,
            errorMsg: "NOT_IN_SPACE",
        };
    }
    const systemID = toPositiveInt(session._space && session._space.systemID, toPositiveInt(activeShip && activeShip.locationID, 0));
    const scene = spaceRuntime.ensureScene(systemID);
    if (!scene) {
        return {
            success: false,
            errorMsg: "SCENE_NOT_FOUND",
        };
    }
    const characterRecord = getCharacterRecord(session.characterID) || {};
    const targetStationID = resolvePodRespawnStationID(session);
    session.sessionChangeReason = options.sessionChangeReason || "selfdestruct";
    const abandonedCapsuleEntity = spaceRuntime.disembarkSession(session, {
        broadcast: false,
    });
    if (!abandonedCapsuleEntity) {
        return {
            success: false,
            errorMsg: "CAPSULE_ENTITY_NOT_FOUND",
        };
    }
    const destroyResult = destroyShipEntityWithWreck(systemID, abandonedCapsuleEntity, {
        ownerCharacterID: session.characterID,
        shipRecord: activeShip,
    });
    if (!destroyResult.success) {
        log.warn(`[ShipDestruction] Capsule destroy cleanup failed for char=${session.characterID} pod=${abandonedCapsuleEntity.itemID} error=${destroyResult.errorMsg}`);
    }
    const shellEquipmentResult = destroySessionShellEquipmentForDeath(session);
    const respawnResult = rebuildDockedSessionAtStation(session, targetStationID, {
        emitNotifications: true,
        logSelection: true,
        boardNewbieShip: true,
        newbieShipLogLabel: "PodRespawn",
    });
    if (!respawnResult.success || !respawnResult.data) {
        return respawnResult;
    }
    log.info(`[ShipDestruction] Podded ${session.characterName || session.characterID} pod=${abandonedCapsuleEntity.itemID} station=${targetStationID} ship=${respawnResult.data.ship && respawnResult.data.ship.itemID}`);
    return {
        success: true,
        data: {
            station: respawnResult.data.station,
            capsule: respawnResult.data.capsule,
            ship: respawnResult.data.ship,
            destroyedShipID: activeShip.itemID,
            wreck: destroyResult.success && destroyResult.data
                ? destroyResult.data.wreck || null
                : null,
            movedChanges: destroyResult.success &&
                destroyResult.data &&
                Array.isArray(destroyResult.data.movedChanges)
                ? destroyResult.data.movedChanges
                : [],
            destroyChanges: destroyResult.success &&
                destroyResult.data &&
                Array.isArray(destroyResult.data.destroyChanges)
                ? destroyResult.data.destroyChanges
                : [],
            wreckChanges: destroyResult.success &&
                destroyResult.data &&
                Array.isArray(destroyResult.data.wreckChanges)
                ? destroyResult.data.wreckChanges
                : [],
            shellEquipmentChanges: shellEquipmentResult &&
                shellEquipmentResult.success === true &&
                shellEquipmentResult.data &&
                Array.isArray(shellEquipmentResult.data.changes)
                ? shellEquipmentResult.data.changes
                : [],
            boundResult: respawnResult.data.boundResult,
        },
    };
}
function spawnShipDeathTestField(session, options = {}) {
    if (!session || !session.characterID || !session._space) {
        return {
            success: false,
            errorMsg: "NOT_IN_SPACE",
        };
    }
    const systemID = toPositiveInt(session._space.systemID, 0);
    const scene = spaceRuntime.ensureScene(systemID);
    const anchorEntity = spaceRuntime.getEntity(session, session._space.shipID);
    if (!scene || !anchorEntity) {
        return {
            success: false,
            errorMsg: "SHIP_NOT_FOUND",
        };
    }
    const count = toPositiveInt(options.count, DEFAULT_DEATH_TEST_COUNT);
    const radiusMeters = Math.max(3_000, toFiniteNumber(options.radiusMeters, DEFAULT_DEATH_TEST_RADIUS_METERS));
    const delayMs = Math.max(0, toFiniteNumber(options.delayMs, DEFAULT_DEATH_TEST_DELAY_MS));
    const shipType = options.shipType ||
        resolveShipByTypeID(options.typeID) ||
        resolveShipByTypeID(anchorEntity.typeID) ||
        null;
    if (!shipType) {
        return {
            success: false,
            errorMsg: "SHIP_TYPE_NOT_FOUND",
        };
    }
    const positions = buildShipDeathPositions(anchorEntity, count, radiusMeters);
    const spawned = [];
    for (const position of positions) {
        const spawnResult = spaceRuntime.spawnDynamicShip(systemID, {
            typeID: shipType.typeID,
            groupID: shipType.groupID,
            categoryID: shipType.categoryID || 6,
            itemName: shipType.name,
            ownerID: 0,
            characterID: 0,
            corporationID: 0,
            allianceID: 0,
            warFactionID: 0,
            position,
            direction: buildRandomDirection(anchorEntity.direction),
            velocity: { x: 0, y: 0, z: 0 },
            targetPoint: position,
            mode: "STOP",
            speedFraction: 0,
            conditionState: {
                damage: 0,
                charge: 1,
                armorDamage: 0,
                shieldCharge: 1,
                incapacitated: false,
            },
        });
        if (spawnResult.success && spawnResult.data && spawnResult.data.entity) {
            spawned.push(spawnResult.data.entity);
        }
    }
    const scheduledDetonation = queuePendingDeathTest({
        systemID,
        ownerCharacterID: session.characterID,
        shipType,
        spawnedEntityIDs: spawned.map((entity) => entity.itemID),
        spawnedCount: spawned.length,
        delayMs,
    });
    return {
        success: true,
        data: {
            shipType,
            radiusMeters,
            delayMs,
            spawned,
            completionPromise: scheduledDetonation.completionPromise,
            detonateAtSimMs: scheduledDetonation.completeAtSimMs,
        },
    };
}
module.exports = {
    destroyShipEntityWithWreck,
    destroySessionClonePreservingShip,
    destroySessionShip,
    destroySessionShipAndClone,
    spawnShipDeathTestField,
};
module.exports._testing = {
    destroyShipEntityWithWreck,
    destroyShipEntityWithoutWreck,
    resolveEntityWreckType,
    resolveShipWreckType,
    buildShipDeathPositions,
    processPendingDeathTests,
    purgeDestroyedShipEntityFromScene,
    destroySessionClonePreservingShip,
    destroySessionShipAndClone,
    destroySessionShellEquipmentForDeath,
    queueCloneSelectionTransition,
    resolveCloneDeathTransitionDelayMs,
    clearPendingDeathTests() {
        pendingDeathTests.clear();
        clearPendingDeathTestTimer();
    },
    clearPendingCloneSelectionTimers() {
        for (const timer of pendingCloneSelectionTimers.values()) {
            clearTimeout(timer);
        }
        pendingCloneSelectionTimers.clear();
    },
};
//# sourceMappingURL=shipDestruction.js.map