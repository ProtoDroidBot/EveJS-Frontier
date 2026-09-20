"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const crypto = require("crypto");
const path = require("path");
const log = require(path.join(__dirname, "../../utils/logger"));
const { TABLE, readStaticRows, } = require(path.join(__dirname, "../_shared/referenceData"));
const itemStore = require(path.join(__dirname, "../inventory/itemStore"));
const { ROLEMASK_VIEW, normalizeRoleValue, } = require(path.join(__dirname, "../account/accountRoleProfiles"));
const ASSEMBLY_STATUS_OFFLINE = 1;
const ASSEMBLY_STATUS_ONLINE = 2;
const ASSEMBLY_STATUS_UNDER_CONSTRUCTION = 5;
const CONSTRUCTION_INFO_KEY = "evejsFrontierConstruction";
const CONSTRUCTION_SITE_LIMIT = 25;
const PORTABLE_BUILD_RADIUS_METERS = 2_500;
const NETWORK_NODE_BUILD_RADIUS_METERS = 80_000;
const NETWORK_NODE_ASSEMBLY_TYPE_ID = 88_092;
const LAGRANGE_POINT_GROUP_ID = 4_870;
const NPC_NODE_MIN_ANCHOR_OFFSET_METERS = 10_000;
const NPC_NODE_MAX_ANCHOR_OFFSET_METERS = 40_000;
const NPC_SITE_MIN_NODE_OFFSET_METERS = 10_000;
const NPC_SITE_MAX_NODE_OFFSET_METERS = 60_000;
const FRONTIER_ASSEMBLY_RADIUS_FALLBACK_METERS = 250;
const NPC_PLACEMENT_ATTEMPTS = 32;
// Client type list 939 (Portable Assemblies) in build 3502403.
const PORTABLE_ASSEMBLY_TYPE_IDS = new Set([87_160, 87_161, 87_162, 87_566]);
const SLINGSHOT_GATE_TYPE_IDS = new Set([95_627, 95_677]);
const ITEM_FLAG_CARGO_HOLD = 5;
const CARGO_CONTAINER_TYPE_ID = 23;
const CARGO_CONTAINER_CAPACITY_FALLBACK = 27_500;
const DISMANTLE_CARGO_DISTANCE_METERS = 275;
const DISMANTLE_CARGO_SPACING_METERS = 175;
const ASSEMBLY_TRANSITION_TTL_MS = 2 * 60 * 1000;
const SUI_ZERO_DIGEST = "11111111111111111111111111111111";
const METERS_PER_LIGHT_YEAR = 9_460_730_472_580_800;
const SMART_GATE_ACTIVATION_RUINED = 0;
const SMART_GATE_ACTIVATION_UNFUELED = 1;
const SMART_GATE_ACTIVATION_TRAVERSABLE = 2;
const SMART_GATE_ARRIVAL_CLEARANCE_METERS = 10_000;
const completionTimers = new Map();
const activationTimers = new Map();
const pendingAssemblyTransitions = new Map();
let buildDefinitionsByTypeID = null;
let solarSystemsByID = null;
function isPortableAssemblyType(typeID) {
    return PORTABLE_ASSEMBLY_TYPE_IDS.has(toInt(typeID, 0));
}
function toInt(value, fallback = 0) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? Math.trunc(numeric) : fallback;
}
function toFiniteNumber(value, fallback = 0) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : fallback;
}
function normalizeText(value) {
    if (Buffer.isBuffer(value)) {
        return value.toString("utf8");
    }
    if (value && typeof value === "object" && typeof value.value === "string") {
        return value.value;
    }
    return value === null || value === undefined ? "" : String(value);
}
function getCharacterID(session) {
    return toInt(session && (session.characterID || session.charid), 0);
}
function getSolarSystemID(session) {
    return toInt(session && (session.solarsystemid2 || session.solarsystemid || session.locationid), 0);
}
function hasAssemblyAdminPrivileges(session) {
    const accountRole = normalizeRoleValue(session && session.accountRole, 0n);
    return (accountRole & ROLEMASK_VIEW) !== 0n;
}
function validateAssemblyAdminSession(session) {
    return hasAssemblyAdminPrivileges(session)
        ? { success: true }
        : { success: false, errorMsg: "ASSEMBLY_ADMIN_ACCESS_DENIED" };
}
function sequenceItems(value) {
    if (Array.isArray(value)) {
        return value;
    }
    if (value && typeof value === "object") {
        if (Array.isArray(value.items)) {
            return value.items;
        }
        if (Array.isArray(value.value)) {
            return value.value;
        }
        if (Array.isArray(value.data)) {
            return value.data;
        }
    }
    return null;
}
function normalizeWorldVector(value) {
    const sequence = sequenceItems(value);
    const source = sequence || value;
    const x = toFiniteNumber(source && (source.x ?? source[0]), Number.NaN);
    const y = toFiniteNumber(source && (source.y ?? source[1]), Number.NaN);
    const z = toFiniteNumber(source && (source.z ?? source[2]), Number.NaN);
    if (![x, y, z].every(Number.isFinite)) {
        return null;
    }
    return { x, y, z };
}
function normalizeRotationDegrees(value) {
    const sequence = sequenceItems(value);
    const source = sequence || value;
    const yaw = toFiniteNumber(source && (source.yaw ?? source[0]), Number.NaN);
    const pitch = toFiniteNumber(source && (source.pitch ?? source[1]), Number.NaN);
    const roll = toFiniteNumber(source && (source.roll ?? source[2]), Number.NaN);
    if (![yaw, pitch, roll].every(Number.isFinite)) {
        return null;
    }
    const radiansToDegrees = 180 / Math.PI;
    return [yaw, pitch, roll].map((angle) => angle * radiansToDegrees);
}
function vectorDistance(left, right) {
    const a = normalizeWorldVector(left);
    const b = normalizeWorldVector(right);
    if (!a || !b) {
        return Number.POSITIVE_INFINITY;
    }
    return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}
function normalizeDirection(value) {
    const direction = normalizeWorldVector(value) || { x: 1, y: 0, z: 0 };
    const length = Math.hypot(direction.x, direction.y, direction.z);
    return length > 0
        ? { x: direction.x / length, y: direction.y / length, z: direction.z / length }
        : { x: 1, y: 0, z: 0 };
}
function getDismantleContainerSpawnState(item, containerIndex) {
    const source = normalizeWorldVector(item && item.spaceState && item.spaceState.position) ||
        { x: 0, y: 0, z: 0 };
    const direction = normalizeDirection(item && item.spaceState && item.spaceState.direction);
    const perpendicular = normalizeDirection({
        x: -direction.y,
        y: direction.x,
        z: 0,
    });
    const row = Math.floor(containerIndex / 2);
    const side = containerIndex % 2 === 0 ? 1 : -1;
    const forwardDistance = DISMANTLE_CARGO_DISTANCE_METERS +
        row * DISMANTLE_CARGO_SPACING_METERS;
    const lateralDistance = containerIndex === 0
        ? 0
        : side * DISMANTLE_CARGO_SPACING_METERS * 0.5;
    const position = {
        x: source.x + direction.x * forwardDistance + perpendicular.x * lateralDistance,
        y: source.y + direction.y * forwardDistance + perpendicular.y * lateralDistance,
        z: source.z + direction.z * forwardDistance + perpendicular.z * lateralDistance,
    };
    return {
        direction,
        mode: "STOP",
        position,
        speedFraction: 0,
        targetPoint: position,
        velocity: { x: 0, y: 0, z: 0 },
    };
}
function addWorldVectors(left, right) {
    const a = normalizeWorldVector(left);
    const b = normalizeWorldVector(right);
    if (!a || !b) {
        return null;
    }
    return {
        x: a.x + b.x,
        y: a.y + b.y,
        z: a.z + b.z,
    };
}
function normalizeBuildAnchors(value) {
    const anchors = [];
    for (const entry of Array.isArray(value) ? value : []) {
        const position = normalizeWorldVector(entry && (entry.position || entry));
        if (!position) {
            continue;
        }
        anchors.push({
            itemID: toInt(entry && entry.itemID, 0) || null,
            position,
        });
    }
    return anchors;
}
function assessDeploymentCandidate(frame, position, ship, networkNodeAnchors) {
    const shipDistance = vectorDistance(position, ship);
    const buildAnchors = [{
            buildAnchor: "ship",
            buildAnchorItemID: null,
            deploymentDistance: shipDistance,
            maxDeploymentDistance: PORTABLE_BUILD_RADIUS_METERS,
        }];
    for (const anchor of networkNodeAnchors) {
        buildAnchors.push({
            buildAnchor: "network-node",
            buildAnchorItemID: anchor.itemID,
            deploymentDistance: vectorDistance(position, anchor.position),
            maxDeploymentDistance: NETWORK_NODE_BUILD_RADIUS_METERS,
        });
    }
    const inRangeAnchors = buildAnchors.filter((anchor) => (anchor.deploymentDistance <= anchor.maxDeploymentDistance));
    const rankedAnchors = inRangeAnchors.length > 0 ? inRangeAnchors : buildAnchors;
    rankedAnchors.sort((left, right) => {
        if (inRangeAnchors.length > 0 && left.buildAnchor !== right.buildAnchor) {
            return left.buildAnchor === "ship" ? -1 : 1;
        }
        const leftRatio = left.deploymentDistance / left.maxDeploymentDistance;
        const rightRatio = right.deploymentDistance / right.maxDeploymentDistance;
        return leftRatio - rightRatio;
    });
    return {
        ...rankedAnchors[0],
        frame,
        position,
        shipDistance,
        withinRange: inRangeAnchors.length > 0,
    };
}
function resolveDeploymentPosition(clientPosition, shipPosition, options = {}) {
    const submitted = normalizeWorldVector(clientPosition);
    const ship = normalizeWorldVector(shipPosition);
    if (!submitted || !ship) {
        return null;
    }
    const networkNodeAnchors = normalizeBuildAnchors(options.networkNodeAnchors);
    const candidates = [
        assessDeploymentCandidate("world", submitted, ship, networkNodeAnchors),
        assessDeploymentCandidate("ship-relative", addWorldVectors(ship, submitted), ship, networkNodeAnchors),
    ];
    const validCandidates = candidates.filter((candidate) => candidate.withinRange);
    if (validCandidates.length > 0) {
        validCandidates.sort((left, right) => {
            if (left.buildAnchor !== right.buildAnchor) {
                return left.buildAnchor === "ship" ? -1 : 1;
            }
            return left.frame === "world" ? -1 : 1;
        });
        return validCandidates[0];
    }
    candidates.sort((left, right) => (left.deploymentDistance / left.maxDeploymentDistance -
        right.deploymentDistance / right.maxDeploymentDistance));
    return candidates[0];
}
function normalizeQuantityMap(value) {
    const entries = value && value.type === "dict" && Array.isArray(value.entries)
        ? value.entries
        : value && typeof value === "object" && !Array.isArray(value)
            ? Object.entries(value)
            : [];
    const result = {};
    for (const [rawTypeID, rawQuantity] of entries) {
        const typeID = toInt(rawTypeID, 0);
        const quantity = toInt(rawQuantity, 0);
        if (typeID > 0 && quantity > 0) {
            result[String(typeID)] = quantity;
        }
    }
    return result;
}
function parseCustomInfo(customInfo) {
    const text = String(customInfo || "").trim();
    if (!text) {
        return {};
    }
    try {
        const parsed = JSON.parse(text);
        return parsed && typeof parsed === "object" && !Array.isArray(parsed)
            ? parsed
            : {};
    }
    catch (_) {
        return { legacyCustomInfo: text };
    }
}
function readConstructionState(item) {
    const state = parseCustomInfo(item && item.customInfo)[CONSTRUCTION_INFO_KEY];
    if (!state || typeof state !== "object" || Array.isArray(state)) {
        return null;
    }
    return {
        activationCompleteAtMs: Math.max(0, toInt(state.activationCompleteAtMs, 0)),
        assemblyStatus: toInt(state.assemblyStatus, ASSEMBLY_STATUS_UNDER_CONSTRUCTION),
        assemblyTypeID: toInt(state.assemblyTypeID, 0),
        completeAtMs: toInt(state.completeAtMs, 0),
        completedAtMs: toInt(state.completedAtMs, 0),
        constructionCost: normalizeQuantityMap(state.constructionCost),
        constructionSiteTypeID: toInt(state.constructionSiteTypeID, 0),
        createdAtMs: toInt(state.createdAtMs, 0),
        destinationGateID: toInt(state.destinationGateID, 0),
        durationSeconds: Math.max(0, toInt(state.durationSeconds, 0)),
        ownerID: toInt(state.ownerID, toInt(item && item.ownerID, 0)),
        solarSystemID: toInt(state.solarSystemID, toInt(item && item.locationID, 0)),
        targetSolarSystemID: toInt(state.targetSolarSystemID, 0),
    };
}
function getFrontierAssemblyFootprintRadius(definition) {
    const assembly = itemStore.getItemMetadata(definition && definition.assemblyTypeID);
    const site = itemStore.getItemMetadata(definition && definition.constructionSiteTypeID);
    return Math.max(FRONTIER_ASSEMBLY_RADIUS_FALLBACK_METERS, toFiniteNumber(assembly && assembly.radius, 0), toFiniteNumber(site && site.radius, 0));
}
function listFrontierAssemblyObstacles(solarSystemID) {
    return itemStore.listSystemSpaceItems(solarSystemID).flatMap((item) => {
        const state = readConstructionState(item);
        const position = normalizeWorldVector(item && item.spaceState && item.spaceState.position);
        if (!state || !position)
            return [];
        const assembly = itemStore.getItemMetadata(state.assemblyTypeID);
        const site = itemStore.getItemMetadata(item.typeID);
        return [{
                itemID: toInt(item.itemID, 0),
                position,
                radius: Math.max(FRONTIER_ASSEMBLY_RADIUS_FALLBACK_METERS, toFiniteNumber(item.spaceRadius, 0), toFiniteNumber(item.radius, 0), toFiniteNumber(assembly && assembly.radius, 0), toFiniteNumber(site && site.radius, 0)),
                assemblyTypeID: state.assemblyTypeID,
            }];
    });
}
function findFrontierAssemblyOverlap(position, radius, obstacles, ignoredItemID = 0) {
    const target = normalizeWorldVector(position);
    if (!target)
        return null;
    const targetRadius = Math.max(FRONTIER_ASSEMBLY_RADIUS_FALLBACK_METERS, toFiniteNumber(radius, 0));
    for (const obstacle of Array.isArray(obstacles) ? obstacles : []) {
        if (toInt(obstacle && obstacle.itemID, 0) === toInt(ignoredItemID, -1))
            continue;
        const obstaclePosition = normalizeWorldVector(obstacle && obstacle.position);
        if (!obstaclePosition)
            continue;
        const obstacleRadius = Math.max(FRONTIER_ASSEMBLY_RADIUS_FALLBACK_METERS, toFiniteNumber(obstacle && obstacle.radius, 0));
        const distance = vectorDistance(target, obstaclePosition);
        const requiredClearance = targetRadius + obstacleRadius;
        if (distance < requiredClearance) {
            return {
                blockerItemID: toInt(obstacle && obstacle.itemID, 0) || null,
                blockerAssemblyTypeID: toInt(obstacle && obstacle.assemblyTypeID, 0) || null,
                blockerRadius: obstacleRadius,
                conflictKind: "assembly-footprint-overlap",
                distance,
                minimumDistance: requiredClearance,
                targetRadius,
            };
        }
    }
    return null;
}
function validateFrontierAssemblyClearance(solarSystemID, definition, position, options = {}) {
    const radius = getFrontierAssemblyFootprintRadius(definition);
    const obstacles = options.obstacles || listFrontierAssemblyObstacles(solarSystemID);
    const conflict = findFrontierAssemblyOverlap(position, radius, obstacles, options.ignoredItemID);
    return conflict
        ? { success: false, errorMsg: "ASSEMBLY_PLACEMENT_OCCUPIED", data: conflict }
        : { success: true, data: { radius, checkedAssemblies: obstacles.length } };
}
function isAssemblyActivationPending(item) {
    // Keep operations blocked until the persisted transition has completed, even
    // if the callback is delayed or the item has just been loaded after restart.
    return (readConstructionState(item)?.activationCompleteAtMs || 0) > 0;
}
function writeConstructionState(item, state, recordIntent = true) {
    const info = parseCustomInfo(item && item.customInfo);
    if (toInt(item?.typeID) === NETWORK_NODE_ASSEMBLY_TYPE_ID && info.evejsFrontierNetworkNodeFuel) {
        const { state: fuel } = require("./networkNodeFuelRuntime").calculateNetworkNodeFuelBurn(item);
        if (fuel.quantity > 0 || fuel.burnRemainderMs > 0)
            info.evejsFrontierNetworkNodeFuel = fuel;
        else {
            delete info.evejsFrontierNetworkNodeFuel;
        }
        if (fuel.quantity === 0 && state.assemblyStatus === ASSEMBLY_STATUS_ONLINE &&
            !require("./networkNodeFuelRuntime").readSuiNetworkNodeFuel(item))
            state = { ...state, assemblyStatus: ASSEMBLY_STATUS_OFFLINE };
    }
    if (recordIntent && Number(info[CONSTRUCTION_INFO_KEY]?.assemblyStatus) !== Number(state.assemblyStatus)) {
        require("./suiAssemblyState").recordSuiAssemblyStatusIntent(info, state.assemblyStatus);
    }
    info[CONSTRUCTION_INFO_KEY] = {
        ...state,
        constructionCost: normalizeQuantityMap(state && state.constructionCost),
    };
    return JSON.stringify(info);
}
function buildAssemblyTransitionTransactionData({ action, characterID, itemID, transactionUUID, }) {
    const context = [
        "evejs-frontier-assembly-transition-v1",
        normalizeText(action).trim().toLowerCase(),
        toInt(characterID, 0),
        toInt(itemID, 0),
        normalizeText(transactionUUID).trim().toLowerCase(),
    ].join(":");
    const objectID = `0x${crypto.createHash("sha256").update(context).digest("hex")}`;
    // Frontier's bundled Sui signer accepts a serialized Transaction snapshot.
    // A fully resolved no-op transaction keeps this compatibility path local
    // while ensuring the user's signature covers the transition's unique context.
    return JSON.stringify({
        version: 2,
        sender: null,
        expiration: null,
        gasData: {
            budget: "1",
            price: "1",
            owner: null,
            payment: [{
                    objectId: objectID,
                    version: "1",
                    digest: SUI_ZERO_DIGEST,
                }],
        },
        inputs: [],
        commands: [],
    });
}
function isValidAssemblyTransitionSignature(value) {
    const signature = normalizeText(value).trim();
    if (signature.length < 88 ||
        signature.length % 4 !== 0 ||
        !/^[A-Za-z0-9+/]+={0,2}$/.test(signature)) {
        return false;
    }
    const decoded = Buffer.from(signature, "base64");
    if (decoded.length < 65) {
        return false;
    }
    const normalizedInput = signature.replace(/=+$/u, "");
    const normalizedDecoded = decoded.toString("base64").replace(/=+$/u, "");
    return normalizedInput === normalizedDecoded;
}
function prunePendingAssemblyTransitions(nowMs = Date.now()) {
    for (const [transactionUUID, transition] of pendingAssemblyTransitions) {
        if (!transition || transition.expiresAtMs <= nowMs) {
            pendingAssemblyTransitions.delete(transactionUUID);
        }
    }
}
function buildDefinitionsFromRows(rows) {
    const definitions = new Map();
    for (const row of Array.isArray(rows) ? rows : []) {
        const assemblyTypeID = toInt(row && (row.typeID ?? row._key), 0);
        const smartDeployable = row && row.smartDeployable;
        const constructionCost = normalizeQuantityMap(smartDeployable && smartDeployable.constructionCost);
        const constructionSiteTypeID = toInt(smartDeployable && smartDeployable.constructionSite, 0);
        if (assemblyTypeID <= 0 || Object.keys(constructionCost).length === 0) {
            continue;
        }
        const definition = {
            assemblyTypeID,
            constructionSiteTypeID,
            constructionCost,
            createOnChain: toInt(smartDeployable.createOnChain, 0) === 1,
            durationSeconds: Math.max(0, toInt(row.activate && row.activate.durationSeconds, 0)),
        };
        const smartGate = row && row.smartGate;
        if (smartGate && typeof smartGate === "object") {
            definition.smartGate = {
                maxPerSolarSystem: Math.max(0, toInt(smartGate.maxPerSolarSystem, 0)),
                minDistanceFromSameComponent: Math.max(0, toFiniteNumber(smartGate.minDistanceFromSameComponent, 0)),
                rangeLightYears: Math.max(0, toFiniteNumber(smartGate.range, 0)),
            };
        }
        definitions.set(assemblyTypeID, definition);
    }
    return definitions;
}
function getBuildDefinition(assemblyTypeID) {
    if (!buildDefinitionsByTypeID) {
        buildDefinitionsByTypeID = buildDefinitionsFromRows(readStaticRows(TABLE.SPACE_COMPONENTS_BY_TYPE));
    }
    return buildDefinitionsByTypeID.get(toInt(assemblyTypeID, 0)) || null;
}
function listAssemblyDefinitions() {
    if (!buildDefinitionsByTypeID) {
        getBuildDefinition(0);
    }
    return [...buildDefinitionsByTypeID.values()]
        .map((definition) => {
        const metadata = itemStore.getItemMetadata(definition.assemblyTypeID);
        return {
            ...definition,
            constructionCost: { ...definition.constructionCost },
            name: String(metadata && metadata.name || `Type ${definition.assemblyTypeID}`),
            published: metadata ? metadata.published !== false : false,
        };
    })
        .sort((left, right) => (left.name.localeCompare(right.name) ||
        left.assemblyTypeID - right.assemblyTypeID));
}
function buildAssemblyRecord(item, state = readConstructionState(item)) {
    if (!item || !state) {
        return null;
    }
    const definition = getBuildDefinition(state.assemblyTypeID);
    const metadata = itemStore.getItemMetadata(state.assemblyTypeID);
    const position = normalizeWorldVector(item.spaceState && item.spaceState.position);
    return {
        activationCompleteAtMs: state.activationCompleteAtMs,
        assemblyStatus: state.assemblyStatus,
        assemblyTypeID: state.assemblyTypeID,
        completeAtMs: state.completeAtMs,
        constructionSiteTypeID: state.constructionSiteTypeID,
        createOnChain: Boolean(definition && definition.createOnChain),
        destinationGateID: state.destinationGateID,
        durationSeconds: state.durationSeconds,
        itemID: toInt(item.itemID, 0),
        name: String(item.itemName || metadata && metadata.name || `Type ${state.assemblyTypeID}`),
        ownerID: toInt(item.ownerID, 0),
        position,
        published: metadata ? metadata.published !== false : false,
        solarSystemID: state.solarSystemID,
        targetSolarSystemID: state.targetSolarSystemID,
    };
}
function getAssemblyRecord(itemID) {
    const numericItemID = Number(itemID);
    if (!Number.isSafeInteger(numericItemID) || numericItemID <= 0) {
        return null;
    }
    return buildAssemblyRecord(itemStore.findItemById(numericItemID));
}
function listAssemblies(filters = {}) {
    const ownerID = toInt(filters.ownerID, 0);
    const solarSystemID = toInt(filters.solarSystemID, 0);
    return Object.values(itemStore.getAllItems())
        .map((item) => buildAssemblyRecord(item))
        .filter(Boolean)
        .filter((record) => ownerID <= 0 || record.ownerID === ownerID)
        .filter((record) => (solarSystemID <= 0 || record.solarSystemID === solarSystemID))
        .sort((left, right) => left.itemID - right.itemID);
}
function getSolarSystemRecord(solarSystemID) {
    if (!solarSystemsByID) {
        solarSystemsByID = new Map(readStaticRows(TABLE.SOLAR_SYSTEMS).map((record) => ([
            toInt(record && record.solarSystemID, 0),
            record,
        ])));
    }
    return solarSystemsByID.get(toInt(solarSystemID, 0)) || null;
}
function getSolarSystemDistanceMeters(leftSystemID, rightSystemID) {
    const left = getSolarSystemRecord(leftSystemID);
    const right = getSolarSystemRecord(rightSystemID);
    // Missing records must not be interpreted as coordinates at the origin.
    if (!left?.position || !right?.position)
        return Number.POSITIVE_INFINITY;
    return vectorDistance(left.position, right.position);
}
function getSolarSystemDistanceLightYears(leftSystemID, rightSystemID) {
    const distanceMeters = getSolarSystemDistanceMeters(leftSystemID, rightSystemID);
    return Number.isFinite(distanceMeters)
        ? distanceMeters / METERS_PER_LIGHT_YEAR
        : Number.POSITIVE_INFINITY;
}
function isSmartGateDefinition(definition) {
    return Boolean(definition &&
        definition.smartGate &&
        definition.smartGate.rangeLightYears > 0);
}
function isSlingshotGateType(typeID) {
    return SLINGSHOT_GATE_TYPE_IDS.has(toInt(typeID, 0));
}
function getSmartGateActivationState(state) {
    if (!state) {
        return SMART_GATE_ACTIVATION_RUINED;
    }
    return state.assemblyStatus === ASSEMBLY_STATUS_ONLINE && !(state.activationCompleteAtMs > 0)
        ? SMART_GATE_ACTIVATION_TRAVERSABLE
        : SMART_GATE_ACTIVATION_UNFUELED;
}
function getSpaceRuntime() {
    return require(path.join(__dirname, "../../space/runtime"));
}
function getSpaceTransitions() {
    return require(path.join(__dirname, "../../space/transitions"));
}
function getCharacterState() {
    return require(path.join(__dirname, "../character/characterState"));
}
function getSessionShipEntity(session, shipItem) {
    if (!session || !shipItem) {
        return null;
    }
    return getSpaceRuntime().getEntity(session, shipItem.itemID);
}
function isCompletedNetworkNodeBuildAnchorState(state) {
    return Boolean(state && state.assemblyStatus !== ASSEMBLY_STATUS_UNDER_CONSTRUCTION &&
        !(state.activationCompleteAtMs > 0));
}
function listCompletedNetworkNodeBuildAnchors(session, characterID, solarSystemID) {
    const anchors = [];
    for (const item of itemStore.listSystemSpaceItems(solarSystemID)) {
        if (toInt(item && item.typeID, 0) !== NETWORK_NODE_ASSEMBLY_TYPE_ID ||
            toInt(item && item.ownerID, 0) !== characterID) {
            continue;
        }
        const constructionState = readConstructionState(item);
        if (!isCompletedNetworkNodeBuildAnchorState(constructionState)) {
            continue;
        }
        const entity = getSpaceRuntime().getEntity(session, item.itemID);
        const position = normalizeWorldVector((entity && entity.position) || (item.spaceState && item.spaceState.position));
        if (!position) {
            continue;
        }
        anchors.push({
            itemID: toInt(item.itemID, 0),
            position,
        });
    }
    return anchors;
}
function isWithinNetworkNodeBuildZone(position, networkNodeAnchors) {
    const worldPosition = normalizeWorldVector(position);
    if (!worldPosition)
        return false;
    return normalizeBuildAnchors(networkNodeAnchors).some((anchor) => (vectorDistance(worldPosition, anchor.position) <= NETWORK_NODE_BUILD_RADIUS_METERS));
}
function getItemQuantity(item) {
    return toInt(item && item.singleton, 0) === 1
        ? 1
        : Math.max(0, toInt(item && (item.stacksize ?? item.quantity), 0));
}
function aggregateContainerItems(ownerID, locationID, flagID = null) {
    const quantities = {};
    for (const item of itemStore.listContainerItems(ownerID, locationID, flagID)) {
        const typeID = toInt(item && item.typeID, 0);
        if (typeID <= 0) {
            continue;
        }
        quantities[String(typeID)] = (quantities[String(typeID)] || 0) + getItemQuantity(item);
    }
    return quantities;
}
function hasRequiredMaterials(cost, deposited) {
    return Object.entries(cost).every(([typeID, required]) => (toInt(deposited[typeID], 0) >= toInt(required, 0)));
}
function buildConstructionMaterialConsumption(itemID, constructionCost, ownerID = null) {
    const children = itemStore.listContainerItems(ownerID, itemID, null)
        .sort((left, right) => toInt(left.itemID, 0) - toInt(right.itemID, 0));
    const plan = [];
    for (const [rawTypeID, rawQuantity] of Object.entries(constructionCost)) {
        const typeID = toInt(rawTypeID, 0);
        let remaining = toInt(rawQuantity, 0);
        for (const child of children) {
            if (remaining <= 0 || toInt(child.typeID, 0) !== typeID)
                continue;
            const quantity = Math.min(remaining, getItemQuantity(child));
            if (quantity > 0) {
                plan.push({
                    itemID: toInt(child.itemID, 0),
                    quantity,
                    expected: {
                        ownerID: toInt(child.ownerID, 0),
                        locationID: toInt(itemID, 0),
                        flagID: toInt(child.flagID, 0),
                        typeID,
                    },
                });
                remaining -= quantity;
            }
        }
        if (remaining > 0)
            return null;
    }
    return plan;
}
function restorePlacementMaterials(characterID, consumed) {
    const changes = [];
    let errorMsg = null;
    for (const { locationID, flagID, typeID, quantity } of consumed) {
        const result = itemStore.grantItemsToCharacterLocation(characterID, locationID, flagID, [{ itemType: itemStore.getItemMetadata(typeID), quantity }]);
        changes.push(...((result.data && result.data.changes) || []));
        if (!result.success) {
            errorMsg = result.errorMsg || "PLACEMENT_MATERIAL_REFUND_FAILED";
            log.error(`[FrontierDeployment] Placement material refund failed char=${characterID} ` +
                `location=${locationID} flag=${flagID} type=${typeID} quantity=${quantity} reason=${errorMsg}`);
        }
    }
    return { success: errorMsg === null, errorMsg, data: { changes } };
}
function consumePlacementMaterials(characterID, shipItemID, constructionCost) {
    // The build RPC has no source inventory argument. Use the deploying ship's
    // cargo, then the player's own inventory; fitted and remote items cannot pay.
    const sources = [
        { locationID: shipItemID, flagID: ITEM_FLAG_CARGO_HOLD },
        { locationID: characterID, flagID: itemStore.ITEM_FLAGS.HANGAR },
    ].map((source) => ({
        ...source,
        available: aggregateContainerItems(characterID, source.locationID, source.flagID),
    }));
    const plan = [];
    for (const [typeID, quantity] of Object.entries(constructionCost)) {
        let outstanding = quantity;
        for (const source of sources) {
            const take = Math.min(outstanding, source.available[typeID] || 0);
            if (take > 0) {
                plan.push({
                    locationID: source.locationID,
                    flagID: source.flagID,
                    typeID: toInt(typeID, 0),
                    quantity: take,
                });
                outstanding -= take;
            }
        }
        if (outstanding > 0) {
            return {
                success: false,
                errorMsg: "INSUFFICIENT_PLACEMENT_MATERIALS",
                changes: [],
            };
        }
    }
    const changes = [];
    const consumed = [];
    for (const source of plan) {
        const takeResult = itemStore.takeItemTypeFromCharacterLocation(characterID, source.locationID, source.flagID, source.typeID, source.quantity);
        if (!takeResult.success) {
            const restoreResult = restorePlacementMaterials(characterID, consumed);
            return {
                ...takeResult,
                changes: [
                    ...changes,
                    ...((restoreResult.data && restoreResult.data.changes) || []),
                ],
                rollbackError: restoreResult.success ? null : restoreResult.errorMsg,
            };
        }
        consumed.push(source);
        changes.push(...((takeResult.data && takeResult.data.changes) || []));
    }
    return { success: true, changes, consumed };
}
function syncChanges(session, changes) {
    require("./networkNodeEnergyRuntime").reconcileNetworkNodeEnergy();
    for (const change of Array.isArray(changes) ? changes : []) {
        if (toInt(change.item?.typeID) !== NETWORK_NODE_ASSEMBLY_TYPE_ID || !change.previousData)
            continue;
        const fuelRuntime = require("./networkNodeFuelRuntime");
        const consumed = fuelRuntime.readNetworkNodeFuelState(change.previousData).quantity -
            fuelRuntime.readNetworkNodeFuelState(change.item).quantity;
        fuelRuntime.publishFuelBurn(change.item, consumed);
    }
    if (!session || !Array.isArray(changes) || changes.length === 0) {
        return;
    }
    // Each inventory row needs its own previous-value dictionary. In particular,
    // exhausted stacks have item=null and must be sent as removals from the old
    // container, otherwise the client keeps displaying materials already spent.
    for (const change of changes) {
        if (!change)
            continue;
        const previous = change.previousData || change.previousState || {};
        const item = change.removed
            ? itemStore.buildRemovedItemNotificationState(change.previousData || change.item)
            : change.item;
        if (item) {
            getCharacterState().emitItemsChangedForSession(session, item, previous);
        }
    }
}
function notifyAssemblyAdded(session, itemID, solarSystemID) {
    if (!session || typeof session.sendNotification !== "function") {
        return;
    }
    session.sendNotification("OnAssemblyAdded", "charid", [
        toInt(itemID, 0),
        toInt(solarSystemID, 0),
    ]);
}
function clearCompletionTimer(itemID) {
    const numericItemID = toInt(itemID, 0);
    const timer = completionTimers.get(numericItemID);
    if (timer) {
        clearTimeout(timer);
        completionTimers.delete(numericItemID);
    }
}
function scheduleConstruction(itemID, session = null) {
    const numericItemID = toInt(itemID, 0);
    const item = itemStore.findItemById(numericItemID);
    const state = readConstructionState(item);
    if (!item ||
        !state ||
        state.assemblyStatus !== ASSEMBLY_STATUS_UNDER_CONSTRUCTION ||
        state.completeAtMs <= 0 ||
        completionTimers.has(numericItemID)) {
        return false;
    }
    // Older saves kept the activation countdown on the depot. Convert it now;
    // completeConstruction carries its existing deadline onto the assembly.
    const timer = setTimeout(() => {
        completionTimers.delete(numericItemID);
        completeConstruction(numericItemID, { session });
    }, 0);
    if (typeof timer.unref === "function") {
        timer.unref();
    }
    completionTimers.set(numericItemID, timer);
    return true;
}
function clearActivationTimer(itemID) {
    const numericItemID = toInt(itemID, 0);
    const timer = activationTimers.get(numericItemID);
    if (timer)
        clearTimeout(timer);
    activationTimers.delete(numericItemID);
}
function scheduleAssemblyActivation(itemID, session = null, retryDelayMs = 0) {
    const numericItemID = toInt(itemID, 0);
    const item = itemStore.findItemById(numericItemID);
    if (!isAssemblyActivationPending(item) || activationTimers.has(numericItemID)) {
        return false;
    }
    const state = readConstructionState(item);
    const delayMs = Math.max(retryDelayMs, state.activationCompleteAtMs - Date.now());
    const timer = setTimeout(() => {
        activationTimers.delete(numericItemID);
        completeAssemblyActivation(numericItemID, { session });
    }, Math.min(delayMs, 0x7fffffff));
    if (typeof timer.unref === "function")
        timer.unref();
    activationTimers.set(numericItemID, timer);
    return true;
}
function completeAssemblyActivation(itemID, options = {}) {
    clearActivationTimer(itemID);
    const item = itemStore.findItemById(itemID);
    const state = readConstructionState(item);
    if (!item || !state) {
        return { success: false, errorMsg: "ASSEMBLY_NOT_FOUND" };
    }
    if (!isAssemblyActivationPending(item)) {
        return { success: true, data: { item, alreadyComplete: true } };
    }
    if (state.activationCompleteAtMs > Date.now()) {
        scheduleAssemblyActivation(itemID, options.session || null);
        return { success: true, data: { item, pending: true } };
    }
    const definition = getBuildDefinition(state.assemblyTypeID);
    if (!definition)
        return { success: false, errorMsg: "ASSEMBLY_TYPE_NOT_SUPPORTED" };
    const updateResult = itemStore.updateInventoryItem(itemID, currentItem => ({
        ...currentItem,
        customInfo: writeConstructionState(currentItem, {
            ...state,
            activationCompleteAtMs: 0,
            // Chain assemblies still require their ordinary online transaction,
            // including fuel and energy checks, after anchoring has finished.
            assemblyStatus: definition.createOnChain ? ASSEMBLY_STATUS_OFFLINE : ASSEMBLY_STATUS_ONLINE,
        }),
    }));
    if (!updateResult.success || !updateResult.data) {
        log.warn(`[FrontierDeployment] Activation completion will retry item=${itemID} reason=${updateResult.errorMsg || "ASSEMBLY_STATE_UPDATE_FAILED"}`);
        scheduleAssemblyActivation(itemID, options.session || null, 1000);
        return updateResult;
    }
    const session = findAssemblyOwnerSession(options.session, item.ownerID);
    const presentation = refreshAssemblyStatePresentation(session, updateResult.data, readConstructionState(updateResult.data));
    syncChanges(session, [{ item: updateResult.data, previousData: updateResult.previousData }]);
    return { success: true, data: { item: updateResult.data, presentation } };
}
function validateOwnedConstructionItem(session, itemID) {
    const characterID = getCharacterID(session);
    const item = itemStore.findItemById(itemID);
    const state = readConstructionState(item);
    if (!item || !state) {
        return { success: false, errorMsg: "CONSTRUCTION_SITE_NOT_FOUND" };
    }
    if (characterID <= 0 || toInt(item.ownerID, 0) !== characterID) {
        return { success: false, errorMsg: "CONSTRUCTION_SITE_ACCESS_DENIED" };
    }
    return { success: true, item, state };
}
function validateOwnedChainAssembly(session, itemID) {
    const characterID = getCharacterID(session);
    const item = itemStore.findItemById(itemID);
    const state = readConstructionState(item);
    if (!item || !state) {
        return { success: false, errorMsg: "ASSEMBLY_NOT_FOUND" };
    }
    if (characterID <= 0 || toInt(item.ownerID, 0) !== characterID) {
        return { success: false, errorMsg: "ASSEMBLY_ACCESS_DENIED" };
    }
    if (state.assemblyStatus === ASSEMBLY_STATUS_UNDER_CONSTRUCTION) {
        return { success: false, errorMsg: "ASSEMBLY_UNDER_CONSTRUCTION" };
    }
    if (isAssemblyActivationPending(item)) {
        return { success: false, errorMsg: "ASSEMBLY_ACTIVATING" };
    }
    if (getSolarSystemID(session) !== state.solarSystemID) {
        return { success: false, errorMsg: "ASSEMBLY_NOT_IN_CURRENT_SYSTEM" };
    }
    const definition = getBuildDefinition(state.assemblyTypeID);
    if (!definition || definition.createOnChain !== true) {
        return { success: false, errorMsg: "ASSEMBLY_NOT_CHAIN_ANCHORED" };
    }
    return { success: true, characterID, definition, item, state };
}
function validateOwnedSmartGateForCharacter(characterID, itemID, allowActivating = false) {
    if (!Number.isSafeInteger(Number(itemID)) || Number(itemID) <= 0) {
        return { success: false, errorMsg: "ASSEMBLY_NOT_FOUND" };
    }
    const item = itemStore.findItemById(itemID);
    const state = readConstructionState(item);
    if (!item || !state) {
        return { success: false, errorMsg: "ASSEMBLY_NOT_FOUND" };
    }
    if (characterID <= 0 || toInt(item.ownerID, 0) !== characterID) {
        return { success: false, errorMsg: "ASSEMBLY_ACCESS_DENIED" };
    }
    if (state.assemblyStatus === ASSEMBLY_STATUS_UNDER_CONSTRUCTION) {
        return { success: false, errorMsg: "ASSEMBLY_UNDER_CONSTRUCTION" };
    }
    if (!allowActivating && isAssemblyActivationPending(item)) {
        return { success: false, errorMsg: "ASSEMBLY_ACTIVATING" };
    }
    const definition = getBuildDefinition(state.assemblyTypeID);
    if (!isSmartGateDefinition(definition)) {
        return { success: false, errorMsg: "ASSEMBLY_NOT_SMART_GATE" };
    }
    return { success: true, characterID, definition, item, state };
}
function validateSmartGate(itemID) {
    const item = itemStore.findItemById(itemID);
    const state = readConstructionState(item);
    if (!item || !state) {
        return { success: false, errorMsg: "ASSEMBLY_NOT_FOUND" };
    }
    if (state.assemblyStatus === ASSEMBLY_STATUS_UNDER_CONSTRUCTION) {
        return { success: false, errorMsg: "ASSEMBLY_UNDER_CONSTRUCTION" };
    }
    if (isAssemblyActivationPending(item)) {
        return { success: false, errorMsg: "ASSEMBLY_ACTIVATING" };
    }
    const definition = getBuildDefinition(state.assemblyTypeID);
    if (!isSmartGateDefinition(definition)) {
        return { success: false, errorMsg: "ASSEMBLY_NOT_SMART_GATE" };
    }
    return { success: true, definition, item, state };
}
// Build 3463382 exposes ownership only on gate-management controls. An online,
// reciprocal Heavy Gate pair is intentionally traversable by other pilots.
function validateSmartGateForTraversal(session, itemID) {
    const characterID = getCharacterID(session);
    if (characterID <= 0) {
        return { success: false, errorMsg: "ASSEMBLY_ACCESS_DENIED" };
    }
    const validation = validateSmartGate(itemID);
    if (validation.success === false) {
        return validation;
    }
    if (getSolarSystemID(session) !== validation.state.solarSystemID) {
        return { success: false, errorMsg: "ASSEMBLY_NOT_IN_CURRENT_SYSTEM" };
    }
    return { ...validation, characterID };
}
function validateOwnedSmartGate(session, itemID) {
    const characterID = getCharacterID(session);
    const validation = validateOwnedSmartGateForCharacter(characterID, itemID);
    if (validation.success === false) {
        return validation;
    }
    if (getSolarSystemID(session) !== validation.state.solarSystemID) {
        return { success: false, errorMsg: "ASSEMBLY_NOT_IN_CURRENT_SYSTEM" };
    }
    return validation;
}
function validateOwnedSmartCatapult(session, itemID) {
    const source = validateOwnedSmartGate(session, itemID);
    if (source.success === false)
        return source;
    if (!isSlingshotGateType(source.state.assemblyTypeID)) {
        return { success: false, errorMsg: "ASSEMBLY_NOT_SMART_CATAPULT" };
    }
    return source;
}
function validateCatapultDestination(source, destinationSolarSystemID) {
    const destinationSystemID = toInt(destinationSolarSystemID, 0);
    if (destinationSystemID <= 0 || !getSolarSystemRecord(destinationSystemID)) {
        return { success: false, errorMsg: "SMART_CATAPULT_DESTINATION_UNAVAILABLE" };
    }
    if (destinationSystemID === source.state.solarSystemID) {
        return { success: false, errorMsg: "SMART_CATAPULT_SAME_SYSTEM" };
    }
    const distanceLightYears = getSolarSystemDistanceLightYears(source.state.solarSystemID, destinationSystemID);
    if (!Number.isFinite(distanceLightYears)) {
        return { success: false, errorMsg: "SMART_CATAPULT_DESTINATION_UNAVAILABLE" };
    }
    if (distanceLightYears > source.definition.smartGate.rangeLightYears) {
        return {
            success: false,
            errorMsg: "SMART_CATAPULT_OUT_OF_RANGE",
            data: { distanceLightYears, rangeLightYears: source.definition.smartGate.rangeLightYears },
        };
    }
    return { success: true, destinationSystemID, distanceLightYears };
}
function getAvailableCatapultSystems(session, gateID) {
    const source = validateOwnedSmartCatapult(session, gateID);
    if (source.success === false)
        return source;
    // Initialize the lazily loaded static-system index before iterating it.
    getSolarSystemRecord(source.state.solarSystemID);
    const systems = [...(solarSystemsByID?.keys() || [])]
        .map(systemID => validateCatapultDestination(source, systemID))
        .filter(result => result.success)
        .sort((left, right) => left.distanceLightYears - right.distanceLightYears ||
        left.destinationSystemID - right.destinationSystemID)
        .map(result => result.destinationSystemID);
    return { success: true, data: { systems, source } };
}
function updateCatapultDestination(session, source, destinationSolarSystemID) {
    if (source.state.assemblyStatus !== ASSEMBLY_STATUS_OFFLINE) {
        return { success: false, errorMsg: "SMART_CATAPULT_MUST_BE_OFFLINE" };
    }
    const destination = destinationSolarSystemID > 0
        ? validateCatapultDestination(source, destinationSolarSystemID)
        : { success: true, destinationSystemID: 0, distanceLightYears: 0 };
    if (destination.success === false)
        return destination;
    const updateResult = itemStore.updateInventoryItem(source.item.itemID, currentItem => ({
        ...currentItem,
        customInfo: writeConstructionState(currentItem, {
            ...source.state,
            destinationGateID: 0,
            targetSolarSystemID: destination.destinationSystemID,
        }),
    }));
    if (!updateResult.success || !updateResult.data) {
        return updateResult.success
            ? { success: false, errorMsg: "SMART_CATAPULT_DESTINATION_UPDATE_FAILED" }
            : updateResult;
    }
    const state = readConstructionState(updateResult.data);
    const presentation = refreshAssemblyStatePresentation(session, updateResult.data, state);
    syncChanges(session, [{ item: updateResult.data, previousData: updateResult.previousData }]);
    clearPendingAssemblyTransitionsForItem(source.item.itemID);
    return {
        success: true,
        data: {
            item: updateResult.data,
            destinationSolarSystemID: destination.destinationSystemID,
            distanceLightYears: destination.distanceLightYears,
            presentation,
        },
    };
}
function setCatapultDestination(session, gateID, destinationSolarSystemID) {
    const source = validateOwnedSmartCatapult(session, gateID);
    if (source.success === false)
        return source;
    return updateCatapultDestination(session, source, toInt(destinationSolarSystemID, 0));
}
function clearCatapultDestination(session, gateID) {
    const source = validateOwnedSmartCatapult(session, gateID);
    if (source.success === false)
        return source;
    return updateCatapultDestination(session, source, 0);
}
function beginAssemblyStateTransition(session, itemID, targetStatus) {
    const numericTargetStatus = toInt(targetStatus, 0);
    if (numericTargetStatus !== ASSEMBLY_STATUS_OFFLINE &&
        numericTargetStatus !== ASSEMBLY_STATUS_ONLINE) {
        return { success: false, errorMsg: "INVALID_ASSEMBLY_STATE" };
    }
    const validation = validateOwnedChainAssembly(session, itemID);
    if (validation.success === false) {
        return validation;
    }
    if (numericTargetStatus === ASSEMBLY_STATUS_ONLINE && !hasNetworkNodeFuelForOnline(validation.item)) {
        return { success: false, errorMsg: "NETWORK_NODE_FUEL_REQUIRED" };
    }
    if (numericTargetStatus === ASSEMBLY_STATUS_ONLINE) {
        const energy = require("./networkNodeEnergyRuntime").validateAssemblyOnline(validation.item);
        if (!energy.success)
            return energy;
    }
    if (numericTargetStatus === ASSEMBLY_STATUS_ONLINE && isSmartGateDefinition(validation.definition)) {
        if (isSlingshotGateType(validation.state.assemblyTypeID)) {
            const destination = validateCatapultDestination(validation, validation.state.targetSolarSystemID);
            if (validation.state.destinationGateID > 0 || destination.success === false) {
                return { success: false, errorMsg: "SMART_CATAPULT_DESTINATION_REQUIRED" };
            }
        }
        else if (validation.state.targetSolarSystemID <= 0) {
            return { success: false, errorMsg: "SMART_GATE_DESTINATION_REQUIRED" };
        }
    }
    const nowMs = Date.now();
    prunePendingAssemblyTransitions(nowMs);
    for (const [existingUUID, transition] of pendingAssemblyTransitions) {
        if (transition.characterID === validation.characterID &&
            transition.itemID === validation.item.itemID) {
            pendingAssemblyTransitions.delete(existingUUID);
        }
    }
    const action = numericTargetStatus === ASSEMBLY_STATUS_ONLINE
        ? "online"
        : "offline";
    const transactionUUID = crypto.randomUUID().toLowerCase();
    const transactionData = buildAssemblyTransitionTransactionData({
        action,
        characterID: validation.characterID,
        itemID: validation.item.itemID,
        transactionUUID,
    });
    pendingAssemblyTransitions.set(transactionUUID, {
        action,
        characterID: validation.characterID,
        createdAtMs: nowMs,
        expiresAtMs: nowMs + ASSEMBLY_TRANSITION_TTL_MS,
        itemID: validation.item.itemID,
        sourceStatus: validation.state.assemblyStatus,
        targetStatus: numericTargetStatus,
        transactionData,
    });
    log.info(`[FrontierDeployment] Assembly ${action} prepared char=${validation.characterID} ` +
        `item=${validation.item.itemID} tx=${transactionUUID}`);
    return {
        success: true,
        data: {
            transactionData,
            transactionUUID,
        },
    };
}
function refreshAssemblyStatePresentation(session, item, state) {
    const spaceRuntime = getSpaceRuntime();
    const scene = spaceRuntime.scenes instanceof Map
        ? spaceRuntime.scenes.get(toInt(state && state.solarSystemID, 0)) || null
        : typeof spaceRuntime.getSceneForSession === "function"
            ? spaceRuntime.getSceneForSession(session)
            : null;
    const entity = scene && typeof scene.getEntityByID === "function"
        ? scene.getEntityByID(item.itemID)
        : null;
    if (!scene) {
        return { success: true, data: { broadcast: false, entity: null } };
    }
    if (entity) {
        hydrateConstructionEntityFromInventoryItem(entity, item);
        if (typeof scene.broadcastSlimItemChanges === "function") {
            scene.broadcastSlimItemChanges([entity]);
            return { success: true, data: { broadcast: true, entity } };
        }
        return { success: true, data: { broadcast: false, entity } };
    }
    if (getSolarSystemID(session) === state.solarSystemID) {
        return spaceRuntime.spawnDynamicInventoryEntity(state.solarSystemID, item.itemID, { broadcast: true });
    }
    return { success: true, data: { broadcast: false, entity: null } };
}
/** System transition used when a node or its energy source runs out of fuel. */
function notifyAssemblyFuelDepleted(item, previousData) {
    const session = findAssemblyOwnerSession(null, item.ownerID);
    refreshAssemblyStatePresentation(session, item, readConstructionState(item));
    syncChanges(session, [{ item, previousData }]);
    clearPendingAssemblyTransitionsForItem(item.itemID);
}
function hasNetworkNodeFuelForOnline(item) {
    return toInt(item.typeID) !== NETWORK_NODE_ASSEMBLY_TYPE_ID ||
        require("./networkNodeFuelRuntime").calculateNetworkNodeFuelBurn(item).state.quantity > 0;
}
function offlineAssemblyForFuelDepletion(itemID) {
    const item = itemStore.findItemById(itemID);
    const state = readConstructionState(item);
    if (!state || state.assemblyStatus !== ASSEMBLY_STATUS_ONLINE)
        return { success: true, data: item };
    const result = itemStore.updateInventoryItem(itemID, currentItem => ({
        ...currentItem,
        customInfo: writeConstructionState(currentItem, { ...state, assemblyStatus: ASSEMBLY_STATUS_OFFLINE }),
    }));
    if (result.success) {
        notifyAssemblyFuelDepleted(result.data, result.previousData);
    }
    return result;
}
/** Internal chain-confirmation hook. The executor retains its journal until every affected item is saved. */
function reconcileSponsoredAssemblyState(metadata) {
    if (!metadata || !Array.isArray(metadata.affected) || !metadata.transactionUUID) {
        throw new Error("Sponsored assembly confirmation metadata is invalid");
    }
    for (const affected of metadata.affected) {
        const item = itemStore.findItemById(affected.assemblyID);
        const state = readConstructionState(item);
        if (!item || !state || Number(item.ownerID) !== affected.ownerID || Number(item.typeID) !== affected.typeID ||
            ![ASSEMBLY_STATUS_OFFLINE, ASSEMBLY_STATUS_ONLINE].includes(affected.targetStatus)) {
            throw new Error(`Confirmed assembly ${affected.assemblyID} no longer matches its local identity`);
        }
        const info = parseCustomInfo(item.customInfo);
        // A recovery can resume after any saved item without reapplying an older status.
        if (info.evejsSponsoredAssemblyTransaction === metadata.transactionUUID)
            continue;
        if (affected.targetStatus === ASSEMBLY_STATUS_ONLINE && isAssemblyActivationPending(item)) {
            throw Object.assign(new Error("Assembly activation is still in progress"), { code: "ASSEMBLY_ACTIVATING" });
        }
        const result = itemStore.updateInventoryItem(affected.assemblyID, currentItem => {
            const updated = parseCustomInfo(writeConstructionState(currentItem, { ...readConstructionState(currentItem), assemblyStatus: affected.targetStatus }, false));
            delete updated.evejsSuiAssemblyStatusIntent;
            updated.evejsSponsoredAssemblyTransaction = metadata.transactionUUID;
            return { ...currentItem, customInfo: JSON.stringify(updated) };
        });
        if (!result.success || !result.data)
            throw new Error(`Cannot save confirmed assembly ${affected.assemblyID}`);
        // Presentation errors must not undo an authoritative, confirmed state change.
        try {
            const session = findAssemblyOwnerSession(null, affected.ownerID);
            refreshAssemblyStatePresentation(session, result.data, readConstructionState(result.data));
            syncChanges(session, [{ item: result.data, previousData: result.previousData }]);
            clearPendingAssemblyTransitionsForItem(affected.assemblyID);
        }
        catch (error) {
            log.warn(`[FrontierDeployment] Confirmed sponsored assembly presentation: ${error.message}`);
        }
    }
}
/** Retain initialization across a crash after anchoring but before the requested status. */
function recordInitialSuiAssemblyState(assembly) {
    const item = itemStore.findItemById(Number(assembly.itemId));
    const state = readConstructionState(item);
    if (!item || Number(item.ownerID) !== assembly.ownerId || Number(item.typeID) !== assembly.typeId ||
        state?.assemblyStatus !== assembly.status)
        throw new Error("Assembly changed before its initial chain state was recorded");
    const runtime = require("./suiAssemblyState");
    const existing = runtime.readSuiAssemblyStatusIntent(item);
    if (existing)
        return existing;
    const result = itemStore.updateInventoryItem(item.itemID, currentItem => {
        const info = parseCustomInfo(currentItem.customInfo);
        runtime.recordSuiAssemblyStatusIntent(info, assembly.status);
        return { ...currentItem, customInfo: JSON.stringify(info) };
    });
    if (!result.success)
        throw new Error("Could not persist the initial assembly state request");
    return runtime.readSuiAssemblyStatusIntent(result.data);
}
/** Project a verified chain read without turning that observation into a new request. */
function reconcileSuiAssemblyState(assembly, targetStatus, expectedIntentID = null) {
    const item = itemStore.findItemById(Number(assembly.itemId));
    const state = readConstructionState(item);
    if (!item || !state || Number(item.ownerID) !== assembly.ownerId || Number(item.typeID) !== assembly.typeId ||
        ![ASSEMBLY_STATUS_OFFLINE, ASSEMBLY_STATUS_ONLINE].includes(state.assemblyStatus) ||
        ![ASSEMBLY_STATUS_OFFLINE, ASSEMBLY_STATUS_ONLINE].includes(targetStatus)) {
        throw new Error(`Assembly ${assembly.itemId} changed identity during its chain state read`);
    }
    const intent = require("./suiAssemblyState").readSuiAssemblyStatusIntent(item);
    if (targetStatus === ASSEMBLY_STATUS_ONLINE && isAssemblyActivationPending(item))
        return false;
    if ((intent?.id ?? null) !== expectedIntentID || (intent && intent.targetStatus !== targetStatus))
        return false;
    if (state.assemblyStatus === targetStatus && !intent)
        return true;
    const result = itemStore.updateInventoryItem(item.itemID, currentItem => {
        const info = parseCustomInfo(currentItem.customInfo);
        if (Number(item.typeID) === NETWORK_NODE_ASSEMBLY_TYPE_ID && state.assemblyStatus !== targetStatus) {
            const fuel = require("./networkNodeFuelRuntime").calculateNetworkNodeFuelBurn(currentItem).state;
            if (fuel.quantity > 0 || fuel.burnRemainderMs > 0)
                info.evejsFrontierNetworkNodeFuel = { ...fuel, burnUpdatedAtMs: Date.now() };
            else
                delete info.evejsFrontierNetworkNodeFuel;
        }
        // Status is already confirmed. Local fuel settlement must not rewrite it.
        info[CONSTRUCTION_INFO_KEY] = { ...info[CONSTRUCTION_INFO_KEY], assemblyStatus: targetStatus };
        delete info.evejsSuiAssemblyStatusIntent;
        return { ...currentItem, customInfo: JSON.stringify(info) };
    });
    if (!result.success || !result.data)
        throw new Error(`Cannot save chain assembly ${assembly.itemId}`);
    try {
        const session = findAssemblyOwnerSession(null, item.ownerID);
        refreshAssemblyStatePresentation(session, result.data, readConstructionState(result.data));
        syncChanges(session, [{ item: result.data, previousData: result.previousData }]);
        clearPendingAssemblyTransitionsForItem(item.itemID);
    }
    catch (error) {
        log.warn(`[FrontierDeployment] Chain assembly presentation: ${error.message}`);
    }
    return true;
}
function commitAssemblyStateTransition(session, itemID, transactionUUID, signature, targetStatus) {
    const numericItemID = toInt(itemID, 0);
    const numericTargetStatus = toInt(targetStatus, 0);
    const normalizedUUID = normalizeText(transactionUUID).trim().toLowerCase();
    const nowMs = Date.now();
    prunePendingAssemblyTransitions(nowMs);
    const pending = pendingAssemblyTransitions.get(normalizedUUID);
    if (!pending) {
        return { success: false, errorMsg: "ASSEMBLY_TRANSACTION_NOT_FOUND" };
    }
    if (pending.itemID !== numericItemID ||
        pending.targetStatus !== numericTargetStatus ||
        pending.characterID !== getCharacterID(session)) {
        return { success: false, errorMsg: "ASSEMBLY_TRANSACTION_MISMATCH" };
    }
    if (!isValidAssemblyTransitionSignature(signature)) {
        return { success: false, errorMsg: "INVALID_ASSEMBLY_SIGNATURE" };
    }
    pendingAssemblyTransitions.delete(normalizedUUID);
    const validation = validateOwnedChainAssembly(session, numericItemID);
    if (validation.success === false) {
        return validation;
    }
    if (numericTargetStatus === ASSEMBLY_STATUS_ONLINE && !hasNetworkNodeFuelForOnline(validation.item)) {
        return { success: false, errorMsg: "NETWORK_NODE_FUEL_REQUIRED" };
    }
    if (numericTargetStatus === ASSEMBLY_STATUS_ONLINE) {
        const energy = require("./networkNodeEnergyRuntime").validateAssemblyOnline(validation.item);
        if (!energy.success)
            return energy;
    }
    if (validation.state.assemblyStatus === numericTargetStatus) {
        return {
            success: true,
            data: { item: validation.item, alreadyApplied: true },
        };
    }
    if (validation.state.assemblyStatus !== pending.sourceStatus) {
        return { success: false, errorMsg: "ASSEMBLY_STATE_CHANGED" };
    }
    const updateResult = itemStore.updateInventoryItem(validation.item.itemID, (currentItem) => ({
        ...currentItem,
        customInfo: writeConstructionState(currentItem, {
            ...validation.state,
            assemblyStatus: numericTargetStatus,
        }),
    }));
    if (!updateResult.success || !updateResult.data) {
        return updateResult.success
            ? { success: false, errorMsg: "ASSEMBLY_STATE_UPDATE_FAILED" }
            : updateResult;
    }
    const updatedState = readConstructionState(updateResult.data);
    const presentation = refreshAssemblyStatePresentation(session, updateResult.data, updatedState);
    syncChanges(session, [{
            item: updateResult.data,
            previousData: updateResult.previousData,
        }]);
    log.info(`[FrontierDeployment] Assembly ${pending.action} completed ` +
        `char=${validation.characterID} item=${numericItemID} tx=${normalizedUUID} ` +
        `presentation=${presentation && presentation.success === true ? "sent" : "pending"}`);
    return {
        success: true,
        data: {
            item: updateResult.data,
            presentation,
        },
    };
}
function validateGateLinkForCharacter(characterID, gateID, destinationGateID) {
    const source = validateOwnedSmartGateForCharacter(characterID, gateID);
    if (source.success === false) {
        return source;
    }
    if (isSlingshotGateType(source.state.assemblyTypeID)) {
        return { success: false, errorMsg: "SMART_GATE_LINK_NOT_SUPPORTED" };
    }
    const destination = validateOwnedSmartGateForCharacter(source.characterID, destinationGateID);
    if (destination.success === false) {
        return destination;
    }
    if (source.item.itemID === destination.item.itemID) {
        return { success: false, errorMsg: "SMART_GATE_SELF_LINK" };
    }
    if (source.state.solarSystemID === destination.state.solarSystemID) {
        return { success: false, errorMsg: "SMART_GATE_SAME_SYSTEM" };
    }
    if (source.state.assemblyTypeID !== destination.state.assemblyTypeID) {
        return { success: false, errorMsg: "SMART_GATE_TYPE_MISMATCH" };
    }
    if (source.state.destinationGateID > 0 ||
        destination.state.destinationGateID > 0) {
        return { success: false, errorMsg: "SMART_GATE_ALREADY_LINKED" };
    }
    if (source.state.assemblyStatus !== ASSEMBLY_STATUS_OFFLINE ||
        destination.state.assemblyStatus !== ASSEMBLY_STATUS_OFFLINE) {
        return { success: false, errorMsg: "SMART_GATE_MUST_BE_OFFLINE" };
    }
    const distanceLightYears = getSolarSystemDistanceLightYears(source.state.solarSystemID, destination.state.solarSystemID);
    if (!Number.isFinite(distanceLightYears)) {
        return { success: false, errorMsg: "SMART_GATE_SYSTEM_DATA_UNAVAILABLE" };
    }
    if (distanceLightYears > source.definition.smartGate.rangeLightYears) {
        return {
            success: false,
            errorMsg: "SMART_GATE_OUT_OF_RANGE",
            data: {
                distanceLightYears,
                rangeLightYears: source.definition.smartGate.rangeLightYears,
            },
        };
    }
    return { success: true, destination, distanceLightYears, source };
}
function validateGateLink(session, gateID, destinationGateID) {
    const source = validateOwnedSmartGate(session, gateID);
    if (source.success === false)
        return source;
    return validateGateLinkForCharacter(source.characterID, gateID, destinationGateID);
}
function prepareGateTransition(validation, action, destinationGateID = 0) {
    const nowMs = Date.now();
    prunePendingAssemblyTransitions(nowMs);
    for (const [existingUUID, transition] of pendingAssemblyTransitions) {
        if (transition.characterID === validation.source.characterID &&
            transition.itemID === validation.source.item.itemID) {
            pendingAssemblyTransitions.delete(existingUUID);
        }
    }
    const transactionUUID = crypto.randomUUID().toLowerCase();
    const transactionData = buildAssemblyTransitionTransactionData({
        action: destinationGateID > 0 ? `${action}:${destinationGateID}` : action,
        characterID: validation.source.characterID,
        itemID: validation.source.item.itemID,
        transactionUUID,
    });
    pendingAssemblyTransitions.set(transactionUUID, {
        action,
        characterID: validation.source.characterID,
        createdAtMs: nowMs,
        destinationGateID: toInt(destinationGateID, 0),
        expiresAtMs: nowMs + ASSEMBLY_TRANSITION_TTL_MS,
        itemID: validation.source.item.itemID,
        transactionData,
    });
    return {
        success: true,
        data: { transactionData, transactionUUID },
    };
}
function validatePendingGateTransition(session, gateID, transactionUUID, signature, action) {
    const normalizedUUID = normalizeText(transactionUUID).trim().toLowerCase();
    prunePendingAssemblyTransitions(Date.now());
    const pending = pendingAssemblyTransitions.get(normalizedUUID);
    if (!pending) {
        return { success: false, errorMsg: "ASSEMBLY_TRANSACTION_NOT_FOUND" };
    }
    if (pending.action !== action ||
        pending.itemID !== toInt(gateID, 0) ||
        pending.characterID !== getCharacterID(session)) {
        return { success: false, errorMsg: "ASSEMBLY_TRANSACTION_MISMATCH" };
    }
    if (!isValidAssemblyTransitionSignature(signature)) {
        return { success: false, errorMsg: "INVALID_ASSEMBLY_SIGNATURE" };
    }
    pendingAssemblyTransitions.delete(normalizedUUID);
    return { success: true, normalizedUUID, pending };
}
function updateLinkedGatePair(session, validation) {
    const sourceUpdate = itemStore.updateInventoryItem(validation.source.item.itemID, (currentItem) => ({
        ...currentItem,
        customInfo: writeConstructionState(currentItem, {
            ...validation.source.state,
            destinationGateID: validation.destination.item.itemID,
            targetSolarSystemID: validation.destination.state.solarSystemID,
        }),
    }));
    if (!sourceUpdate.success || !sourceUpdate.data) {
        return sourceUpdate.success
            ? { success: false, errorMsg: "SMART_GATE_LINK_UPDATE_FAILED" }
            : sourceUpdate;
    }
    const destinationUpdate = itemStore.updateInventoryItem(validation.destination.item.itemID, (currentItem) => ({
        ...currentItem,
        customInfo: writeConstructionState(currentItem, {
            ...validation.destination.state,
            destinationGateID: validation.source.item.itemID,
            targetSolarSystemID: validation.source.state.solarSystemID,
        }),
    }));
    if (!destinationUpdate.success || !destinationUpdate.data) {
        const rollback = itemStore.updateInventoryItem(sourceUpdate.data.itemID, sourceUpdate.previousData);
        if (!rollback.success) {
            log.error(`[FrontierDeployment] Gate link rollback failed item=${sourceUpdate.data.itemID} ` +
                `reason=${rollback.errorMsg || "UNKNOWN"}`);
        }
        return destinationUpdate.success
            ? { success: false, errorMsg: "SMART_GATE_LINK_UPDATE_FAILED" }
            : destinationUpdate;
    }
    const sourceState = readConstructionState(sourceUpdate.data);
    const destinationState = readConstructionState(destinationUpdate.data);
    const sourcePresentation = refreshAssemblyStatePresentation(session, sourceUpdate.data, sourceState);
    const destinationPresentation = refreshAssemblyStatePresentation(session, destinationUpdate.data, destinationState);
    syncChanges(session, [
        { item: sourceUpdate.data, previousData: sourceUpdate.previousData },
        { item: destinationUpdate.data, previousData: destinationUpdate.previousData },
    ]);
    clearPendingAssemblyTransitionsForItem(validation.source.item.itemID);
    clearPendingAssemblyTransitionsForItem(validation.destination.item.itemID);
    return {
        success: true,
        data: {
            destination: destinationUpdate.data,
            destinationPresentation,
            source: sourceUpdate.data,
            sourcePresentation,
        },
    };
}
function beginGateLinkTransition(session, gateID, destinationGateID) {
    const validation = validateGateLink(session, gateID, destinationGateID);
    if (validation.success === false) {
        return validation;
    }
    const prepared = prepareGateTransition(validation, "link", validation.destination.item.itemID);
    log.info(`[FrontierDeployment] Gate link prepared char=${validation.source.characterID} ` +
        `source=${validation.source.item.itemID} destination=${validation.destination.item.itemID} ` +
        `distanceLy=${validation.distanceLightYears.toFixed(3)} ` +
        `tx=${prepared.data.transactionUUID}`);
    return prepared;
}
/** Owner-authorized mutation used by the API before blockchain reconciliation. */
function linkSmartGates(session, sourceGateID, destinationGateID) {
    const validation = validateGateLink(session, sourceGateID, destinationGateID);
    if (validation.success === false)
        return validation;
    return updateLinkedGatePair(session, validation);
}
function commitGateLinkTransition(session, gateID, transactionUUID, signature) {
    const pendingResult = validatePendingGateTransition(session, gateID, transactionUUID, signature, "link");
    if (pendingResult.success === false) {
        return pendingResult;
    }
    const validation = validateGateLink(session, gateID, pendingResult.pending.destinationGateID);
    if (validation.success === false) {
        return validation;
    }
    const updateResult = updateLinkedGatePair(session, validation);
    if (!updateResult.success) {
        return updateResult;
    }
    log.info(`[FrontierDeployment] Gates linked char=${validation.source.characterID} ` +
        `source=${validation.source.item.itemID} destination=${validation.destination.item.itemID} ` +
        `tx=${pendingResult.normalizedUUID}`);
    return updateResult;
}
function validateCatapultJump(session, gateID) {
    const source = validateSmartGateForTraversal(session, gateID);
    if (source.success === false)
        return source;
    if (!isSlingshotGateType(source.state.assemblyTypeID)) {
        return { success: false, errorMsg: "ASSEMBLY_NOT_SMART_CATAPULT" };
    }
    if (source.state.assemblyStatus !== ASSEMBLY_STATUS_ONLINE) {
        return { success: false, errorMsg: "SMART_CATAPULT_OFFLINE" };
    }
    if (source.state.destinationGateID > 0 || source.state.targetSolarSystemID <= 0) {
        return { success: false, errorMsg: "SMART_CATAPULT_DESTINATION_REQUIRED" };
    }
    const destination = validateCatapultDestination(source, source.state.targetSolarSystemID);
    if (destination.success === false)
        return destination;
    const shipItem = itemStore.getActiveShipItem(source.characterID);
    if (!shipItem ||
        toInt(shipItem.locationID, 0) !== source.state.solarSystemID ||
        toInt(shipItem.flagID, -1) !== 0) {
        return { success: false, errorMsg: "SHIP_NOT_IN_SPACE" };
    }
    return { success: true, destination, shipItem, source };
}
function jumpWithCatapult(session, gateID) {
    const validation = validateCatapultJump(session, gateID);
    if (validation.success === false)
        return validation;
    const transitionResult = getSpaceTransitions().jumpSessionToSolarSystem(session, validation.destination.destinationSystemID, { stargateJumpCloak: true });
    if (!transitionResult || transitionResult.success !== true) {
        return transitionResult || {
            success: false,
            errorMsg: "SMART_CATAPULT_JUMP_FAILED",
        };
    }
    log.info(`[FrontierDeployment] Catapult jump completed char=${validation.source.characterID} ` +
        `source=${validation.source.item.itemID} system=${validation.destination.destinationSystemID} ` +
        `distanceLy=${validation.destination.distanceLightYears.toFixed(3)}`);
    return {
        success: true,
        data: {
            source: validation.source.item,
            destinationSolarSystemID: validation.destination.destinationSystemID,
            transition: transitionResult.data,
        },
    };
}
function validateGateJump(session, gateID) {
    const source = validateSmartGateForTraversal(session, gateID);
    if (source.success === false) {
        return source;
    }
    if (isSlingshotGateType(source.state.assemblyTypeID)) {
        return { success: false, errorMsg: "ASSEMBLY_NOT_SMART_GATE" };
    }
    if (source.state.assemblyStatus !== ASSEMBLY_STATUS_ONLINE) {
        return { success: false, errorMsg: "SMART_GATE_OFFLINE" };
    }
    if (source.state.destinationGateID <= 0 ||
        source.state.targetSolarSystemID <= 0) {
        return { success: false, errorMsg: "SMART_GATE_NOT_LINKED" };
    }
    const destination = validateSmartGate(source.state.destinationGateID);
    if (destination.success === false) {
        return destination;
    }
    if (toInt(source.item.ownerID, 0) <= 0 ||
        toInt(destination.item.ownerID, 0) !== toInt(source.item.ownerID, 0) ||
        source.state.targetSolarSystemID !== destination.state.solarSystemID ||
        destination.state.destinationGateID !== source.item.itemID ||
        destination.state.targetSolarSystemID !== source.state.solarSystemID) {
        return { success: false, errorMsg: "SMART_GATE_LINK_MISMATCH" };
    }
    if (destination.state.assemblyStatus !== ASSEMBLY_STATUS_ONLINE) {
        return { success: false, errorMsg: "SMART_GATE_DESTINATION_OFFLINE" };
    }
    const shipItem = itemStore.getActiveShipItem(source.characterID);
    if (!shipItem ||
        toInt(shipItem.locationID, 0) !== source.state.solarSystemID ||
        toInt(shipItem.flagID, -1) !== 0) {
        return { success: false, errorMsg: "SHIP_NOT_IN_SPACE" };
    }
    return { success: true, destination, shipItem, source };
}
function buildSmartGateArrivalSpawnState(destination, shipItem) {
    const anchorPosition = normalizeWorldVector(destination && destination.item && destination.item.spaceState &&
        destination.item.spaceState.position);
    if (!anchorPosition) {
        return null;
    }
    const anchorMagnitude = Math.hypot(anchorPosition.x, anchorPosition.y, anchorPosition.z);
    const direction = anchorMagnitude > 0
        ? {
            x: anchorPosition.x / anchorMagnitude,
            y: anchorPosition.y / anchorMagnitude,
            z: anchorPosition.z / anchorMagnitude,
        }
        : { x: 1, y: 0, z: 0 };
    const offset = Math.max(0, toFiniteNumber(destination.item.radius, 0)) +
        Math.max(0, toFiniteNumber(shipItem && shipItem.radius, 0)) +
        SMART_GATE_ARRIVAL_CLEARANCE_METERS;
    return {
        anchorType: "frontierSmartGate",
        anchorID: destination.item.itemID,
        anchorName: destination.item.itemName || "Heavy Gate",
        direction,
        position: {
            x: anchorPosition.x + direction.x * offset,
            y: anchorPosition.y + direction.y * offset,
            z: anchorPosition.z + direction.z * offset,
        },
    };
}
function beginGateJumpTransition(session, gateID) {
    const validation = validateGateJump(session, gateID);
    if (validation.success === false) {
        return validation;
    }
    const prepared = prepareGateTransition(validation, "jump", validation.destination.item.itemID);
    log.info(`[FrontierDeployment] Gate jump prepared char=${validation.source.characterID} ` +
        `source=${validation.source.item.itemID} destination=${validation.destination.item.itemID} ` +
        `tx=${prepared.data.transactionUUID}`);
    return prepared;
}
function commitGateJumpTransition(session, gateID, transactionUUID, signature) {
    const pendingResult = validatePendingGateTransition(session, gateID, transactionUUID, signature, "jump");
    if (pendingResult.success === false) {
        return pendingResult;
    }
    const validation = validateGateJump(session, gateID);
    if (validation.success === false) {
        return validation;
    }
    if (validation.destination.item.itemID !== pendingResult.pending.destinationGateID) {
        return { success: false, errorMsg: "SMART_GATE_LINK_MISMATCH" };
    }
    const spawnState = buildSmartGateArrivalSpawnState(validation.destination, validation.shipItem);
    if (!spawnState) {
        return { success: false, errorMsg: "SMART_GATE_DESTINATION_UNAVAILABLE" };
    }
    const transitionResult = getSpaceTransitions().jumpSessionToSolarSystem(session, validation.destination.state.solarSystemID, {
        spawnStateOverride: spawnState,
        stargateJumpCloak: true,
    });
    if (!transitionResult || transitionResult.success !== true) {
        return transitionResult || {
            success: false,
            errorMsg: "SMART_GATE_JUMP_FAILED",
        };
    }
    log.info(`[FrontierDeployment] Gate jump completed char=${validation.source.characterID} ` +
        `source=${validation.source.item.itemID} destination=${validation.destination.item.itemID} ` +
        `system=${validation.destination.state.solarSystemID} ` +
        `tx=${pendingResult.normalizedUUID}`);
    return {
        success: true,
        data: {
            destination: validation.destination.item,
            source: validation.source.item,
            transition: transitionResult.data,
        },
    };
}
function validateGateUnlink(session, gateID) {
    const source = validateOwnedSmartGate(session, gateID);
    if (source.success === false) {
        return source;
    }
    if (source.state.destinationGateID <= 0) {
        return { success: false, errorMsg: "SMART_GATE_NOT_LINKED" };
    }
    if (source.state.assemblyStatus !== ASSEMBLY_STATUS_OFFLINE) {
        return { success: false, errorMsg: "SMART_GATE_MUST_BE_OFFLINE" };
    }
    const destination = validateOwnedSmartGateForCharacter(source.characterID, source.state.destinationGateID);
    // An activating or inaccessible partner must not be left pointing at an
    // unlinked source. Only a missing partner can be cleaned up independently.
    if (destination.success === false && destination.errorMsg !== "ASSEMBLY_NOT_FOUND") {
        return destination;
    }
    if (destination.success &&
        destination.state.assemblyStatus !== ASSEMBLY_STATUS_OFFLINE) {
        return { success: false, errorMsg: "SMART_GATE_MUST_BE_OFFLINE" };
    }
    return { success: true, destination, source };
}
function beginGateUnlinkTransition(session, gateID) {
    const validation = validateGateUnlink(session, gateID);
    if (validation.success === false) {
        return validation;
    }
    const prepared = prepareGateTransition(validation, "unlink", validation.source.state.destinationGateID);
    log.info(`[FrontierDeployment] Gate unlink prepared char=${validation.source.characterID} ` +
        `source=${validation.source.item.itemID} destination=${validation.source.state.destinationGateID} ` +
        `tx=${prepared.data.transactionUUID}`);
    return prepared;
}
function commitGateUnlinkTransition(session, gateID, transactionUUID, signature) {
    const pendingResult = validatePendingGateTransition(session, gateID, transactionUUID, signature, "unlink");
    if (pendingResult.success === false) {
        return pendingResult;
    }
    const validation = validateGateUnlink(session, gateID);
    if (validation.success === false) {
        return validation;
    }
    if (validation.source.state.destinationGateID !==
        pendingResult.pending.destinationGateID) {
        return { success: false, errorMsg: "ASSEMBLY_STATE_CHANGED" };
    }
    const result = updateUnlinkedGatePair(session, validation);
    if (result.success) {
        log.info(`[FrontierDeployment] Gates unlinked char=${validation.source.characterID} ` +
            `source=${validation.source.item.itemID} destination=${pendingResult.pending.destinationGateID} ` +
            `tx=${pendingResult.normalizedUUID}`);
    }
    return result;
}
function updateUnlinkedGatePair(session, validation) {
    const sourceUpdate = itemStore.updateInventoryItem(validation.source.item.itemID, (currentItem) => ({
        ...currentItem,
        customInfo: writeConstructionState(currentItem, {
            ...validation.source.state,
            destinationGateID: 0,
            targetSolarSystemID: 0,
        }),
    }));
    if (!sourceUpdate.success || !sourceUpdate.data) {
        return sourceUpdate.success
            ? { success: false, errorMsg: "SMART_GATE_UNLINK_UPDATE_FAILED" }
            : sourceUpdate;
    }
    let destinationUpdate = null;
    if (validation.destination.success &&
        validation.destination.state.destinationGateID === validation.source.item.itemID) {
        destinationUpdate = itemStore.updateInventoryItem(validation.destination.item.itemID, (currentItem) => ({
            ...currentItem,
            customInfo: writeConstructionState(currentItem, {
                ...validation.destination.state,
                destinationGateID: 0,
                targetSolarSystemID: 0,
            }),
        }));
        if (!destinationUpdate.success || !destinationUpdate.data) {
            const rollback = itemStore.updateInventoryItem(sourceUpdate.data.itemID, sourceUpdate.previousData);
            if (!rollback.success) {
                log.error(`[FrontierDeployment] Gate unlink rollback failed item=${sourceUpdate.data.itemID} reason=${rollback.errorMsg || "UNKNOWN"}`);
            }
            return {
                success: false,
                errorMsg: destinationUpdate.errorMsg || "SMART_GATE_UNLINK_UPDATE_FAILED",
                rollbackError: rollback.success ? null : rollback.errorMsg,
            };
        }
    }
    const changes = [{
            item: sourceUpdate.data,
            previousData: sourceUpdate.previousData,
        }];
    refreshAssemblyStatePresentation(session, sourceUpdate.data, readConstructionState(sourceUpdate.data));
    if (destinationUpdate && destinationUpdate.data) {
        changes.push({
            item: destinationUpdate.data,
            previousData: destinationUpdate.previousData,
        });
        refreshAssemblyStatePresentation(session, destinationUpdate.data, readConstructionState(destinationUpdate.data));
    }
    syncChanges(session, changes);
    clearPendingAssemblyTransitionsForItem(validation.source.item.itemID);
    clearPendingAssemblyTransitionsForItem(validation.source.state.destinationGateID);
    return {
        success: true,
        data: { source: sourceUpdate.data, destination: destinationUpdate?.data || null },
    };
}
/** Owner-authorized mutation used by the API before blockchain reconciliation. */
function unlinkSmartGate(session, sourceGateID) {
    const validation = validateGateUnlink(session, sourceGateID);
    if (validation.success === false)
        return validation;
    return updateUnlinkedGatePair(session, validation);
}
function placeDirectAssembly({ characterID, definition, deploymentDistance, dunRotation, position, positionFrame, session, shipItem, solarSystemID, }) {
    const materialResult = consumePlacementMaterials(characterID, shipItem.itemID, definition.constructionCost);
    if (!materialResult.success) {
        syncChanges(session, materialResult.changes);
        if (materialResult.rollbackError) {
            log.error(`[FrontierDeployment] Placement material rollback failed char=${characterID} ` +
                `type=${definition.assemblyTypeID} reason=${materialResult.rollbackError}`);
        }
        return materialResult;
    }
    const assemblyMetadata = itemStore.getItemMetadata(definition.assemblyTypeID);
    if (!assemblyMetadata || toInt(assemblyMetadata.typeID, 0) <= 0) {
        const restoreResult = restorePlacementMaterials(characterID, materialResult.consumed);
        syncChanges(session, [
            ...materialResult.changes,
            ...((restoreResult.data && restoreResult.data.changes) || []),
        ]);
        return { success: false, errorMsg: "ASSEMBLY_TYPE_NOT_FOUND" };
    }
    const nowMs = Date.now();
    const state = {
        activationCompleteAtMs: definition.durationSeconds > 0 ? nowMs + definition.durationSeconds * 1000 : 0,
        assemblyStatus: definition.durationSeconds > 0 || definition.createOnChain
            ? ASSEMBLY_STATUS_OFFLINE : ASSEMBLY_STATUS_ONLINE,
        assemblyTypeID: definition.assemblyTypeID,
        completeAtMs: 0,
        completedAtMs: nowMs,
        constructionCost: definition.constructionCost,
        constructionSiteTypeID: 0,
        createdAtMs: nowMs,
        durationSeconds: definition.durationSeconds,
        ownerID: characterID,
        solarSystemID,
    };
    const createResult = itemStore.createSpaceItemForCharacter(characterID, solarSystemID, assemblyMetadata, {
        customInfo: writeConstructionState(null, state),
        dunRotation,
        mode: "STOP",
        position,
    });
    if (!createResult.success || !createResult.data) {
        const restoreResult = restorePlacementMaterials(characterID, materialResult.consumed);
        syncChanges(session, [
            ...materialResult.changes,
            ...((restoreResult.data && restoreResult.data.changes) || []),
        ]);
        return createResult.success
            ? { success: false, errorMsg: "ASSEMBLY_CREATE_FAILED" }
            : createResult;
    }
    const assemblyItem = createResult.data;
    const spawnResult = getSpaceRuntime().spawnDynamicInventoryEntity(solarSystemID, assemblyItem.itemID, { broadcast: true });
    if (!spawnResult.success) {
        clearActivationTimer(assemblyItem.itemID);
        getSpaceRuntime().removeDynamicEntity(solarSystemID, assemblyItem.itemID, {
            broadcast: true,
        });
        const removeResult = itemStore.removeInventoryItem(assemblyItem.itemID, {
            removeContents: true,
        });
        const restoreResult = restorePlacementMaterials(characterID, materialResult.consumed);
        syncChanges(session, [
            ...materialResult.changes,
            ...((removeResult.data && removeResult.data.changes) || []),
            ...((restoreResult.data && restoreResult.data.changes) || []),
        ]);
        return spawnResult;
    }
    syncChanges(session, [
        ...materialResult.changes,
        ...(createResult.changes || []),
    ]);
    notifyAssemblyAdded(session, assemblyItem.itemID, solarSystemID);
    scheduleAssemblyActivation(assemblyItem.itemID, session);
    log.info(`[FrontierDeployment] Assembly placed char=${characterID} ` +
        `item=${assemblyItem.itemID} type=${definition.assemblyTypeID} ` +
        `system=${solarSystemID} distance=${deploymentDistance.toFixed(1)} ` +
        `frame=${positionFrame} activationSeconds=${definition.durationSeconds}`);
    return {
        success: true,
        data: {
            item: assemblyItem,
            definition,
            deploymentDistance,
            directPlacement: true,
            positionFrame,
        },
    };
}
function buildDeployable(session, assemblyTypeID, rawPosition, rawRotation) {
    const characterID = getCharacterID(session);
    const solarSystemID = getSolarSystemID(session);
    if (characterID <= 0 || solarSystemID <= 0) {
        return { success: false, errorMsg: "NOT_IN_SPACE" };
    }
    const definition = getBuildDefinition(assemblyTypeID);
    if (!definition) {
        return { success: false, errorMsg: "ASSEMBLY_TYPE_NOT_SUPPORTED" };
    }
    const clientPosition = normalizeWorldVector(rawPosition);
    const dunRotation = normalizeRotationDegrees(rawRotation);
    if (!clientPosition || !dunRotation) {
        return { success: false, errorMsg: "INVALID_DEPLOYMENT_PLACEMENT" };
    }
    const shipItem = itemStore.getActiveShipItem(characterID);
    const shipEntity = getSessionShipEntity(session, shipItem);
    if (!shipItem ||
        !shipEntity ||
        toInt(shipItem.locationID, 0) !== solarSystemID ||
        toInt(shipItem.flagID, -1) !== 0) {
        return { success: false, errorMsg: "SHIP_NOT_IN_SPACE" };
    }
    const networkNodeAnchors = definition.assemblyTypeID === NETWORK_NODE_ASSEMBLY_TYPE_ID
        ? []
        : listCompletedNetworkNodeBuildAnchors(session, characterID, solarSystemID);
    const placement = resolveDeploymentPosition(clientPosition, shipEntity.position, {
        networkNodeAnchors,
    });
    if (!placement || !placement.position) {
        return { success: false, errorMsg: "INVALID_DEPLOYMENT_PLACEMENT" };
    }
    const { buildAnchor, buildAnchorItemID, deploymentDistance, frame: positionFrame, maxDeploymentDistance, position, shipDistance, withinRange, } = placement;
    if (!withinRange) {
        return {
            success: false,
            errorMsg: "DEPLOYMENT_TOO_FAR",
            data: {
                buildAnchor,
                buildAnchorItemID,
                deploymentDistance,
                maxDeploymentDistance,
                positionFrame,
                shipDistance,
            },
        };
    }
    const clearance = validateFrontierAssemblyClearance(solarSystemID, definition, position);
    if (!clearance.success)
        return clearance;
    const directPlacement = isPortableAssemblyType(definition.assemblyTypeID) &&
        !isWithinNetworkNodeBuildZone(position, networkNodeAnchors);
    if (directPlacement) {
        return placeDirectAssembly({
            characterID,
            definition,
            deploymentDistance,
            dunRotation,
            position,
            positionFrame,
            session,
            shipItem,
            solarSystemID,
        });
    }
    if (definition.constructionSiteTypeID <= 0) {
        return { success: false, errorMsg: "CONSTRUCTION_SITE_TYPE_NOT_FOUND" };
    }
    const activeSites = itemStore.listOwnedItems(characterID).filter((item) => {
        const state = readConstructionState(item);
        return state && state.assemblyStatus === ASSEMBLY_STATUS_UNDER_CONSTRUCTION;
    });
    if (activeSites.length >= CONSTRUCTION_SITE_LIMIT) {
        return { success: false, errorMsg: "TOO_MANY_CONSTRUCTION_SITES" };
    }
    const siteMetadata = itemStore.getItemMetadata(definition.constructionSiteTypeID);
    if (!siteMetadata || toInt(siteMetadata.typeID, 0) <= 0) {
        return { success: false, errorMsg: "CONSTRUCTION_SITE_TYPE_NOT_FOUND" };
    }
    const nowMs = Date.now();
    const state = {
        assemblyStatus: ASSEMBLY_STATUS_UNDER_CONSTRUCTION,
        assemblyTypeID: definition.assemblyTypeID,
        completeAtMs: 0,
        completedAtMs: 0,
        constructionCost: definition.constructionCost,
        constructionSiteTypeID: definition.constructionSiteTypeID,
        createdAtMs: nowMs,
        durationSeconds: definition.durationSeconds,
        ownerID: characterID,
        solarSystemID,
    };
    const createResult = itemStore.createSpaceItemForCharacter(characterID, solarSystemID, siteMetadata, {
        customInfo: writeConstructionState(null, state),
        dunRotation,
        mode: "STOP",
        position,
    });
    if (!createResult.success || !createResult.data) {
        return createResult;
    }
    const siteItem = createResult.data;
    const spawnResult = getSpaceRuntime().spawnDynamicInventoryEntity(solarSystemID, siteItem.itemID, { broadcast: true });
    if (!spawnResult.success) {
        itemStore.removeInventoryItem(siteItem.itemID, { removeContents: true });
        return spawnResult;
    }
    syncChanges(session, createResult.changes);
    notifyAssemblyAdded(session, siteItem.itemID, solarSystemID);
    log.info(`[FrontierDeployment] Construction site placed char=${characterID} ` +
        `item=${siteItem.itemID} assemblyType=${definition.assemblyTypeID} ` +
        `siteType=${definition.constructionSiteTypeID} system=${solarSystemID} ` +
        `distance=${deploymentDistance.toFixed(1)} frame=${positionFrame} ` +
        `anchor=${buildAnchor}${buildAnchorItemID ? `:${buildAnchorItemID}` : ""}`);
    return {
        success: true,
        data: {
            buildAnchor,
            buildAnchorItemID,
            item: siteItem,
            definition,
            deploymentDistance,
            positionFrame,
            shipDistance,
        },
    };
}
/**
 * Validate a player deployment without creating an inventory item or consuming
 * materials. Construction templates use this as their compiler authority so a
 * preview and the eventual BuildDeployable call follow the same Frontier
 * placement, clearance, and direct-vs-site rules.
 */
function previewDeployablePlacement(session, assemblyTypeID, rawPosition, rawRotation, options = {}) {
    const characterID = getCharacterID(session);
    const solarSystemID = getSolarSystemID(session);
    if (characterID <= 0 || solarSystemID <= 0) {
        return { success: false, errorMsg: "NOT_IN_SPACE" };
    }
    const definition = getBuildDefinition(assemblyTypeID);
    if (!definition) {
        return { success: false, errorMsg: "ASSEMBLY_TYPE_NOT_SUPPORTED" };
    }
    const clientPosition = normalizeWorldVector(rawPosition);
    const dunRotation = normalizeRotationDegrees(rawRotation);
    if (!clientPosition || !dunRotation) {
        return { success: false, errorMsg: "INVALID_DEPLOYMENT_PLACEMENT" };
    }
    const shipItem = itemStore.getActiveShipItem(characterID);
    const shipEntity = getSessionShipEntity(session, shipItem);
    if (!shipItem ||
        !shipEntity ||
        toInt(shipItem.locationID, 0) !== solarSystemID ||
        toInt(shipItem.flagID, -1) !== 0) {
        return { success: false, errorMsg: "SHIP_NOT_IN_SPACE" };
    }
    const networkNodeAnchors = definition.assemblyTypeID === NETWORK_NODE_ASSEMBLY_TYPE_ID
        ? []
        : [
            ...listCompletedNetworkNodeBuildAnchors(session, characterID, solarSystemID),
            ...normalizeBuildAnchors(options.additionalNetworkNodeAnchors),
        ];
    const placement = resolveDeploymentPosition(clientPosition, shipEntity.position, {
        networkNodeAnchors,
    });
    if (!placement || !placement.position) {
        return { success: false, errorMsg: "INVALID_DEPLOYMENT_PLACEMENT" };
    }
    if (!placement.withinRange) {
        return {
            success: false,
            errorMsg: "DEPLOYMENT_TOO_FAR",
            data: {
                buildAnchor: placement.buildAnchor,
                buildAnchorItemID: placement.buildAnchorItemID,
                deploymentDistance: placement.deploymentDistance,
                maxDeploymentDistance: placement.maxDeploymentDistance,
                positionFrame: placement.frame,
                shipDistance: placement.shipDistance,
            },
        };
    }
    const clearance = validateFrontierAssemblyClearance(solarSystemID, definition, placement.position);
    if (!clearance.success)
        return clearance;
    const directPlacement = isPortableAssemblyType(definition.assemblyTypeID) &&
        !isWithinNetworkNodeBuildZone(placement.position, networkNodeAnchors);
    if (!directPlacement) {
        const siteMetadata = itemStore.getItemMetadata(definition.constructionSiteTypeID);
        if (!siteMetadata || toInt(siteMetadata.typeID, 0) <= 0) {
            return { success: false, errorMsg: "CONSTRUCTION_SITE_TYPE_NOT_FOUND" };
        }
    }
    const capacity = getConstructionSiteCapacity(characterID);
    return {
        success: true,
        data: {
            buildAnchor: placement.buildAnchor,
            buildAnchorItemID: placement.buildAnchorItemID,
            definition,
            deploymentDistance: placement.deploymentDistance,
            directPlacement,
            dunRotation,
            position: placement.position,
            positionFrame: placement.frame,
            shipDistance: placement.shipDistance,
            constructionSiteCapacity: capacity,
            queuedForSiteCapacity: !directPlacement && capacity.available <= 0,
        },
    };
}
function getConstructionSiteCapacity(ownerID) {
    const numericOwnerID = toInt(ownerID, 0);
    const active = numericOwnerID > 0
        ? itemStore.listOwnedItems(numericOwnerID).filter((item) => {
            const state = readConstructionState(item);
            return state && state.assemblyStatus === ASSEMBLY_STATUS_UNDER_CONSTRUCTION;
        }).length
        : 0;
    return {
        active,
        available: Math.max(0, CONSTRUCTION_SITE_LIMIT - active),
        limit: CONSTRUCTION_SITE_LIMIT,
    };
}
function readNpcConstructionMetadata(item) {
    const value = parseCustomInfo(item && item.customInfo).evejsNpcConstruction;
    return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}
function writeNpcConstructionMetadata(item, metadata) {
    const info = parseCustomInfo(item && item.customInfo);
    info.evejsNpcConstruction = metadata;
    return JSON.stringify(info);
}
function findNpcAssemblyByJobID(jobID) {
    const normalized = String(jobID || "").trim();
    if (!normalized)
        return null;
    return Object.values(itemStore.getAllItems()).find((item) => readNpcConstructionMetadata(item)?.jobID === normalized) || null;
}
function validateNpcAssemblyActor(actor, options = {}) {
    try {
        return {
            success: true,
            data: require("../../space/npc/npcAssemblyActorContext")
                .normalizeNpcAssemblyActorContext(actor, options),
        };
    }
    catch (error) {
        return {
            success: false,
            errorMsg: error.code || "NPC_ASSEMBLY_ACTOR_INVALID",
        };
    }
}
function listNpcNetworkNodeBuildAnchors(ownerPrincipalID, solarSystemID) {
    return itemStore.listSystemSpaceItems(solarSystemID).flatMap((item) => {
        if (toInt(item.typeID, 0) !== NETWORK_NODE_ASSEMBLY_TYPE_ID ||
            toInt(item.ownerID, 0) !== ownerPrincipalID ||
            !isCompletedNetworkNodeBuildAnchorState(readConstructionState(item)))
            return [];
        const position = normalizeWorldVector(item.spaceState && item.spaceState.position);
        return position ? [{
                itemID: toInt(item.itemID, 0),
                kind: "network-node",
                position,
            }] : [];
    });
}
function normalizeNpcPlacementAnchors(value) {
    return (Array.isArray(value) ? value : []).flatMap((entry) => {
        const position = normalizeWorldVector(entry && (entry.position || entry));
        if (!position)
            return [];
        return [{
                itemID: toInt(entry && (entry.itemID || entry.anchorItemID), 0) || null,
                kind: normalizeText(entry && (entry.kind || entry.anchorKind)).trim().toLowerCase(),
                groupID: toInt(entry && entry.groupID, 0),
                position,
            }];
    }).sort((left, right) => (toInt(left.itemID, Number.MAX_SAFE_INTEGER) -
        toInt(right.itemID, Number.MAX_SAFE_INTEGER) ||
        left.kind.localeCompare(right.kind) ||
        left.position.x - right.position.x ||
        left.position.y - right.position.y ||
        left.position.z - right.position.z));
}
function deterministicNpcPlacement(seed) {
    const digest = crypto.createHash("sha256").update(String(seed || "npc-construction")).digest();
    const fraction = (offset) => digest.readUInt32BE(offset) / 0xffff_ffff;
    const azimuth = fraction(0) * Math.PI * 2;
    const vertical = (fraction(4) * 2) - 1;
    const planar = Math.sqrt(Math.max(0, 1 - (vertical * vertical)));
    return {
        direction: {
            x: Math.cos(azimuth) * planar,
            y: Math.sin(azimuth) * planar,
            z: vertical,
        },
        fraction: fraction(8),
        anchorFraction: fraction(12),
    };
}
function offsetNpcPlacement(anchor, deterministic, minimum, maximum) {
    const distance = minimum + ((maximum - minimum) * deterministic.fraction);
    return {
        distance,
        position: {
            x: anchor.x + deterministic.direction.x * distance,
            y: anchor.y + deterministic.direction.y * distance,
            z: anchor.z + deterministic.direction.z * distance,
        },
    };
}
function selectDeterministicNpcAnchor(anchors, deterministic) {
    if (!anchors.length)
        return null;
    const index = Math.min(anchors.length - 1, Math.floor(deterministic.anchorFraction * anchors.length));
    return anchors[index];
}
/**
 * Resolve authoritative NPC construction coordinates. Network Nodes may use
 * any finite world coordinate in the system; when no coordinate was authored,
 * Lagrange points are preferred over other celestial anchors. All dependent
 * construction sites must be inside a completed, actor-owned node's build
 * radius, independently of the builder ship's current position.
 */
function resolveNpcConstructionPlacement(input = {}) {
    const assemblyTypeID = toInt(input.assemblyTypeID, 0);
    const requestedPosition = normalizeWorldVector(input.position);
    const shipPosition = normalizeWorldVector(input.shipPosition);
    const deterministic = deterministicNpcPlacement(`${input.jobID || "npc-construction"}:${assemblyTypeID}:${input.solarSystemID || 0}:` +
        `${Math.max(0, toInt(input.placementAttempt, 0))}`);
    if (assemblyTypeID === NETWORK_NODE_ASSEMBLY_TYPE_ID) {
        if (requestedPosition) {
            return {
                success: true,
                data: {
                    anchorKind: "explicit",
                    anchorItemID: null,
                    buildAnchor: "system",
                    buildAnchorItemID: null,
                    deploymentDistance: 0,
                    placementPreference: "explicit",
                    position: requestedPosition,
                    unrestrictedInSystem: true,
                },
            };
        }
        const systemAnchors = normalizeNpcPlacementAnchors(input.systemAnchors);
        const lagrangeAnchors = systemAnchors.filter((anchor) => (anchor.groupID === LAGRANGE_POINT_GROUP_ID ||
            anchor.kind === "lagrangepoint" ||
            anchor.kind === "lagrange"));
        const preferred = lagrangeAnchors.length ? lagrangeAnchors : systemAnchors;
        const anchor = selectDeterministicNpcAnchor(preferred, deterministic);
        const fallback = shipPosition || { x: 0, y: 0, z: 0 };
        const offset = offsetNpcPlacement(anchor?.position || fallback, deterministic, NPC_NODE_MIN_ANCHOR_OFFSET_METERS, NPC_NODE_MAX_ANCHOR_OFFSET_METERS);
        return {
            success: true,
            data: {
                anchorKind: anchor?.kind || "system-fallback",
                anchorItemID: anchor?.itemID || null,
                buildAnchor: lagrangeAnchors.length ? "lagrange-point" : "system",
                buildAnchorItemID: anchor?.itemID || null,
                deploymentDistance: offset.distance,
                placementPreference: lagrangeAnchors.length
                    ? "lagrange"
                    : anchor ? "celestial-fallback" : "ship-fallback",
                position: offset.position,
                unrestrictedInSystem: true,
            },
        };
    }
    const networkNodeAnchors = normalizeNpcPlacementAnchors(input.networkNodeAnchors);
    if (!networkNodeAnchors.length) {
        return { success: false, errorMsg: "NPC_NETWORK_NODE_REQUIRED" };
    }
    const requestedNetworkNodeID = toInt(input.networkNodeID, 0);
    let anchor = requestedNetworkNodeID > 0
        ? networkNodeAnchors.find((entry) => entry.itemID === requestedNetworkNodeID) || null
        : null;
    if (requestedNetworkNodeID > 0 && !anchor) {
        return { success: false, errorMsg: "NPC_NETWORK_NODE_NOT_FOUND" };
    }
    if (!anchor && requestedPosition) {
        anchor = [...networkNodeAnchors].sort((left, right) => (vectorDistance(requestedPosition, left.position) -
            vectorDistance(requestedPosition, right.position)))[0] || null;
    }
    anchor ||= selectDeterministicNpcAnchor(networkNodeAnchors, deterministic);
    const requestedDistance = requestedPosition
        ? vectorDistance(requestedPosition, anchor.position)
        : Number.POSITIVE_INFINITY;
    if (requestedPosition && requestedDistance > NETWORK_NODE_BUILD_RADIUS_METERS) {
        return {
            success: false,
            errorMsg: "NPC_CONSTRUCTION_OUTSIDE_NETWORK_NODE",
            data: {
                buildAnchorItemID: anchor.itemID,
                deploymentDistance: requestedDistance,
                maxDeploymentDistance: NETWORK_NODE_BUILD_RADIUS_METERS,
            },
        };
    }
    const offset = requestedPosition
        ? { distance: requestedDistance, position: requestedPosition }
        : offsetNpcPlacement(anchor.position, deterministic, NPC_SITE_MIN_NODE_OFFSET_METERS, NPC_SITE_MAX_NODE_OFFSET_METERS);
    return {
        success: true,
        data: {
            anchorKind: "network-node",
            anchorItemID: anchor.itemID,
            buildAnchor: "network-node",
            buildAnchorItemID: anchor.itemID,
            deploymentDistance: offset.distance,
            maxDeploymentDistance: NETWORK_NODE_BUILD_RADIUS_METERS,
            networkNodeID: anchor.itemID,
            placementPreference: requestedPosition ? "explicit-near-node" : "around-network-node",
            position: offset.position,
            unrestrictedInSystem: false,
        },
    };
}
function listNpcSystemPlacementAnchors(solarSystemID) {
    return require(path.join(__dirname, "../../space/worldData"))
        .getCelestialsForSystem(solarSystemID)
        .map((entry) => ({
        itemID: toInt(entry && entry.itemID, 0),
        kind: normalizeText(entry && (entry.kind || entry.anchorKind)).trim().toLowerCase(),
        groupID: toInt(entry && entry.groupID, 0),
        position: entry && entry.position,
    }));
}
/** Plan a collision-free site; the builder must still enter player placement range. */
function planNpcConstructionSitePlacement(actorInput, input) {
    const actorResult = validateNpcAssemblyActor(actorInput, {
        requireSui: input && input.requireSui === true,
    });
    if (!actorResult.success)
        return actorResult;
    const actor = actorResult.data;
    const definition = getBuildDefinition(input && input.assemblyTypeID);
    if (!definition)
        return { success: false, errorMsg: "ASSEMBLY_TYPE_NOT_SUPPORTED" };
    if (input?.allowDirect === true && !isPortableAssemblyType(definition.assemblyTypeID)) {
        return { success: false, errorMsg: "DIRECT_ASSEMBLY_PORTABLE_ONLY" };
    }
    const networkNodeAnchors = definition.assemblyTypeID === NETWORK_NODE_ASSEMBLY_TYPE_ID
        ? []
        : listNpcNetworkNodeBuildAnchors(actor.ownerPrincipalID, actor.solarSystemID);
    const systemAnchors = definition.assemblyTypeID === NETWORK_NODE_ASSEMBLY_TYPE_ID
        ? listNpcSystemPlacementAnchors(actor.solarSystemID)
        : [];
    const attempts = normalizeWorldVector(input && input.position) ? 1 : NPC_PLACEMENT_ATTEMPTS;
    if (input?.allowDirect === true &&
        definition.assemblyTypeID !== NETWORK_NODE_ASSEMBLY_TYPE_ID) {
        const shipPosition = normalizeWorldVector(input && input.shipPosition);
        const requestedPosition = normalizeWorldVector(input && input.position) || shipPosition;
        const withinNetworkNodeBuildZone = isWithinNetworkNodeBuildZone(requestedPosition, networkNodeAnchors);
        if (!withinNetworkNodeBuildZone) {
            const directPlacement = resolveDeploymentPosition(requestedPosition, shipPosition, {
                networkNodeAnchors: [],
            });
            if (!directPlacement || !directPlacement.withinRange) {
                return { success: false, errorMsg: "DEPLOYMENT_TOO_FAR", data: directPlacement };
            }
            const clearance = validateFrontierAssemblyClearance(actor.solarSystemID, definition, directPlacement.position);
            if (!clearance.success)
                return clearance;
            return {
                success: true,
                data: {
                    anchorKind: "ship",
                    anchorItemID: actor.shipID,
                    buildAnchor: "ship",
                    buildAnchorItemID: actor.shipID,
                    deploymentDistance: directPlacement.deploymentDistance,
                    maxDeploymentDistance: directPlacement.maxDeploymentDistance,
                    placementPreference: "direct-near-ship",
                    position: directPlacement.position,
                    unrestrictedInSystem: false,
                    placementAttempt: 0,
                    directPlacement: true,
                    clearance: clearance.data,
                },
            };
        }
    }
    if (definition.constructionSiteTypeID <= 0) {
        return { success: false, errorMsg: "NPC_CONSTRUCTION_SITE_REQUIRED" };
    }
    let lastConflict = null;
    for (let placementAttempt = 0; placementAttempt < attempts; placementAttempt += 1) {
        const placementResult = resolveNpcConstructionPlacement({
            assemblyTypeID: definition.assemblyTypeID,
            jobID: input && input.jobID,
            networkNodeID: input && input.networkNodeID,
            networkNodeAnchors,
            placementAttempt,
            position: input && input.position,
            shipPosition: input && input.shipPosition,
            solarSystemID: actor.solarSystemID,
            systemAnchors,
        });
        if (!placementResult.success)
            return placementResult;
        const clearance = validateFrontierAssemblyClearance(actor.solarSystemID, definition, placementResult.data.position);
        if (clearance.success) {
            return {
                success: true,
                data: {
                    ...placementResult.data,
                    directPlacement: false,
                    clearance: clearance.data,
                    placementAttempt,
                },
            };
        }
        lastConflict = clearance;
    }
    return lastConflict || { success: false, errorMsg: "ASSEMBLY_PLACEMENT_OCCUPIED" };
}
function restoreNpcDirectMaterials(consumed) {
    const changes = [];
    for (const entry of Array.isArray(consumed) ? consumed : []) {
        const restored = itemStore.grantItemToOwnerLocation(toInt(entry.ownerID, 0), toInt(entry.locationID, 0), toInt(entry.flagID, 0), toInt(entry.typeID, 0), toInt(entry.quantity, 0), { singleton: 0 });
        if (!restored.success)
            return { ...restored, data: { changes } };
        changes.push(...(restored.data && restored.data.changes || []));
    }
    return { success: true, data: { changes } };
}
/** Direct completed-assembly placement for a durable NPC construction job. */
function placeNpcDirectAssembly(actorInput, input) {
    const actorResult = validateNpcAssemblyActor(actorInput, {
        requireSui: input && input.requireSui === true,
    });
    if (!actorResult.success)
        return actorResult;
    const actor = actorResult.data;
    const jobID = String(input && input.jobID || "").trim();
    if (!jobID)
        return { success: false, errorMsg: "NPC_CONSTRUCTION_JOB_REQUIRED" };
    const existing = findNpcAssemblyByJobID(jobID);
    if (existing) {
        const metadata = readNpcConstructionMetadata(existing);
        if (metadata?.operator?.actorID !== actor.actorID || metadata?.factionKey !== actor.factionKey) {
            return { success: false, errorMsg: "NPC_CONSTRUCTION_JOB_CONFLICT" };
        }
        return { success: true, data: { item: existing, directPlacement: true, idempotent: true } };
    }
    const definition = getBuildDefinition(input && input.assemblyTypeID);
    if (!definition)
        return { success: false, errorMsg: "ASSEMBLY_TYPE_NOT_SUPPORTED" };
    if (!isPortableAssemblyType(definition.assemblyTypeID)) {
        return { success: false, errorMsg: "DIRECT_ASSEMBLY_PORTABLE_ONLY" };
    }
    if (Boolean(definition.createOnChain) && (!actor.suiProfileObjectID || !actor.suiWalletAddress)) {
        return { success: false, errorMsg: "NPC_SUI_PROFILE_REQUIRED" };
    }
    const shipPosition = normalizeWorldVector(input && input.shipPosition);
    const rotation = normalizeRotationDegrees(input && input.rotation || { yaw: 0, pitch: 0, roll: 0 });
    if (!shipPosition || !rotation)
        return { success: false, errorMsg: "INVALID_DEPLOYMENT_PLACEMENT" };
    const suppliedPlacement = input && input.plannedPlacement;
    const placementResult = suppliedPlacement && normalizeWorldVector(suppliedPlacement.position)
        ? { success: true, data: suppliedPlacement }
        : planNpcConstructionSitePlacement(actor, { ...input, allowDirect: true });
    if (!placementResult.success)
        return placementResult;
    const plannedPlacement = placementResult.data;
    const anchors = definition.assemblyTypeID === NETWORK_NODE_ASSEMBLY_TYPE_ID
        ? []
        : listNpcNetworkNodeBuildAnchors(actor.ownerPrincipalID, actor.solarSystemID);
    if (isWithinNetworkNodeBuildZone(plannedPlacement.position, anchors)) {
        return { success: false, errorMsg: "DIRECT_ASSEMBLY_NETWORK_NODE_REQUIRES_SITE" };
    }
    const placement = resolveDeploymentPosition(plannedPlacement.position, shipPosition, {
        networkNodeAnchors: anchors,
    });
    if (!placement || !placement.position)
        return { success: false, errorMsg: "INVALID_DEPLOYMENT_PLACEMENT" };
    if (!placement.withinRange)
        return { success: false, errorMsg: "DEPLOYMENT_TOO_FAR", data: placement };
    const clearance = validateFrontierAssemblyClearance(actor.solarSystemID, definition, placement.position);
    if (!clearance.success)
        return clearance;
    const materialPlan = Array.isArray(input.materialPlan) ? input.materialPlan : [];
    const consumption = [];
    for (const [rawTypeID, rawQuantity] of Object.entries(definition.constructionCost)) {
        const typeID = toInt(rawTypeID, 0);
        let remaining = toInt(rawQuantity, 0);
        for (const entry of materialPlan) {
            if (remaining <= 0 || toInt(entry && entry.typeID, 0) !== typeID)
                continue;
            const item = itemStore.findItemById(toInt(entry.itemID, 0));
            if (!item || toInt(item.ownerID, 0) !== toInt(entry.ownerID, 0) ||
                toInt(item.locationID, 0) !== toInt(entry.locationID, 0) ||
                toInt(item.flagID, -1) !== toInt(entry.flagID, -1)) {
                return { success: false, errorMsg: "NPC_CONSTRUCTION_MATERIAL_MOVED" };
            }
            const quantity = Math.min(remaining, toInt(entry.quantity, 0), getItemQuantity(item));
            if (quantity > 0) {
                consumption.push({
                    itemID: item.itemID,
                    quantity,
                    expected: {
                        ownerID: item.ownerID,
                        locationID: item.locationID,
                        flagID: item.flagID,
                        typeID: item.typeID,
                    },
                });
                remaining -= quantity;
            }
        }
        if (remaining > 0)
            return { success: false, errorMsg: "INSUFFICIENT_CONSTRUCTION_MATERIAL" };
    }
    const consumed = itemStore.consumeInventoryItems(consumption, { flush: true });
    if (!consumed.success)
        return consumed;
    const assemblyMetadata = itemStore.getItemMetadata(definition.assemblyTypeID);
    if (!assemblyMetadata) {
        restoreNpcDirectMaterials(consumed.data.consumed);
        return { success: false, errorMsg: "ASSEMBLY_TYPE_NOT_FOUND" };
    }
    const nowMs = Date.now();
    const state = {
        activationCompleteAtMs: definition.durationSeconds > 0 ? nowMs + definition.durationSeconds * 1000 : 0,
        assemblyStatus: definition.durationSeconds > 0 || definition.createOnChain
            ? ASSEMBLY_STATUS_OFFLINE : ASSEMBLY_STATUS_ONLINE,
        assemblyTypeID: definition.assemblyTypeID,
        completeAtMs: 0,
        completedAtMs: nowMs,
        constructionCost: definition.constructionCost,
        constructionSiteTypeID: 0,
        createdAtMs: nowMs,
        durationSeconds: definition.durationSeconds,
        ownerID: actor.ownerPrincipalID,
        solarSystemID: actor.solarSystemID,
    };
    const operator = require("../../space/npc/npcAssemblyActorContext").publicNpcAssemblyOperator(actor);
    const info = parseCustomInfo(writeConstructionState(null, state, false));
    info.evejsNpcConstruction = {
        version: 2,
        jobID,
        phase: "constructed",
        operator,
        builderNpcProfileObjectID: actor.suiProfileObjectID,
        factionKey: actor.factionKey,
        placement: JSON.parse(JSON.stringify({ ...plannedPlacement, position: placement.position })),
        registeredForFaction: false,
        createdAtMs: nowMs,
        completedAtMs: nowMs,
    };
    const created = itemStore.createSpaceItemForOwner(actor.ownerPrincipalID, actor.solarSystemID, assemblyMetadata, {
        customInfo: JSON.stringify(info),
        dunRotation: rotation,
        mode: "STOP",
        position: placement.position,
    });
    if (!created.success || !created.data) {
        restoreNpcDirectMaterials(consumed.data.consumed);
        return created;
    }
    const spawned = getSpaceRuntime().spawnDynamicInventoryEntity(actor.solarSystemID, created.data.itemID, { broadcast: true });
    if (!spawned.success) {
        itemStore.removeInventoryItem(created.data.itemID, { removeContents: true });
        restoreNpcDirectMaterials(consumed.data.consumed);
        return spawned;
    }
    if (definition.createOnChain) {
        try {
            recordInitialSuiAssemblyState({
                itemId: String(created.data.itemID),
                ownerId: Number(created.data.ownerID),
                typeId: Number(created.data.typeID),
                status: state.assemblyStatus,
            });
        }
        catch (error) {
            getSpaceRuntime().removeDynamicEntity(actor.solarSystemID, created.data.itemID, { broadcast: true });
            itemStore.removeInventoryItem(created.data.itemID, { removeContents: true });
            restoreNpcDirectMaterials(consumed.data.consumed);
            return { success: false, errorMsg: error.code || "ASSEMBLY_STATE_UNAVAILABLE" };
        }
    }
    syncChanges(null, [...(consumed.data.changes || []), ...(created.changes || [])]);
    scheduleAssemblyActivation(created.data.itemID, null);
    return {
        success: true,
        data: {
            item: created.data,
            definition,
            directPlacement: true,
            deploymentDistance: placement.deploymentDistance,
            positionFrame: "world",
            placement: info.evejsNpcConstruction.placement,
        },
    };
}
/** Session-free construction-site placement for a durable NPC actor. */
function placeNpcConstructionSite(actorInput, input) {
    const actorResult = validateNpcAssemblyActor(actorInput, {
        requireSui: input && input.requireSui === true,
    });
    if (!actorResult.success)
        return actorResult;
    const actor = actorResult.data;
    const jobID = String(input && input.jobID || "").trim();
    if (!jobID)
        return { success: false, errorMsg: "NPC_CONSTRUCTION_JOB_REQUIRED" };
    const existing = findNpcAssemblyByJobID(jobID);
    if (existing) {
        const metadata = readNpcConstructionMetadata(existing);
        if (metadata?.operator?.actorID !== actor.actorID ||
            metadata?.operator?.factionKey !== actor.factionKey) {
            return { success: false, errorMsg: "NPC_CONSTRUCTION_JOB_CONFLICT" };
        }
        return {
            success: true,
            data: { item: existing, idempotent: true, placement: metadata?.placement || null },
        };
    }
    const definition = getBuildDefinition(input && input.assemblyTypeID);
    if (!definition)
        return { success: false, errorMsg: "ASSEMBLY_TYPE_NOT_SUPPORTED" };
    if (Boolean(definition.createOnChain) && (!actor.suiProfileObjectID || !actor.suiWalletAddress)) {
        return { success: false, errorMsg: "NPC_SUI_PROFILE_REQUIRED" };
    }
    const shipPosition = normalizeWorldVector(input && input.shipPosition);
    const rotation = normalizeRotationDegrees(input && input.rotation || { yaw: 0, pitch: 0, roll: 0 });
    if (!shipPosition || !rotation) {
        return { success: false, errorMsg: "INVALID_DEPLOYMENT_PLACEMENT" };
    }
    if (definition.constructionSiteTypeID <= 0) {
        return { success: false, errorMsg: "NPC_CONSTRUCTION_SITE_REQUIRED" };
    }
    const suppliedPlacement = input && input.plannedPlacement;
    const placementResult = suppliedPlacement &&
        normalizeWorldVector(suppliedPlacement.position) &&
        vectorDistance(suppliedPlacement.position, input.position) <= 1e-6
        ? { success: true, data: suppliedPlacement }
        : planNpcConstructionSitePlacement(actor, input);
    if (!placementResult.success)
        return placementResult;
    const plannedPlacement = placementResult.data;
    const anchors = definition.assemblyTypeID === NETWORK_NODE_ASSEMBLY_TYPE_ID
        ? []
        : listNpcNetworkNodeBuildAnchors(actor.ownerPrincipalID, actor.solarSystemID);
    if (definition.assemblyTypeID !== NETWORK_NODE_ASSEMBLY_TYPE_ID) {
        const selectedNodeID = toInt(plannedPlacement.networkNodeID, 0);
        const selectedNode = anchors.find((entry) => entry.itemID === selectedNodeID);
        if (!selectedNode) {
            return { success: false, errorMsg: "NPC_NETWORK_NODE_NOT_FOUND" };
        }
        if (vectorDistance(plannedPlacement.position, selectedNode.position) > NETWORK_NODE_BUILD_RADIUS_METERS) {
            return { success: false, errorMsg: "NPC_CONSTRUCTION_OUTSIDE_NETWORK_NODE" };
        }
    }
    const placement = resolveDeploymentPosition(plannedPlacement.position, shipPosition, {
        networkNodeAnchors: anchors,
    });
    if (!placement || !placement.position) {
        return { success: false, errorMsg: "INVALID_DEPLOYMENT_PLACEMENT" };
    }
    if (!placement.withinRange) {
        return { success: false, errorMsg: "DEPLOYMENT_TOO_FAR", data: placement };
    }
    const clearance = validateFrontierAssemblyClearance(actor.solarSystemID, definition, placement.position);
    if (!clearance.success)
        return clearance;
    const activeSites = itemStore.listOwnedItems(actor.ownerPrincipalID).filter((item) => readConstructionState(item)?.assemblyStatus === ASSEMBLY_STATUS_UNDER_CONSTRUCTION);
    if (activeSites.length >= CONSTRUCTION_SITE_LIMIT) {
        return { success: false, errorMsg: "TOO_MANY_CONSTRUCTION_SITES" };
    }
    const directPlacement = false;
    const placedTypeID = definition.constructionSiteTypeID;
    const metadata = itemStore.getItemMetadata(placedTypeID);
    if (!metadata || toInt(metadata.typeID, 0) !== placedTypeID) {
        return {
            success: false,
            errorMsg: "CONSTRUCTION_SITE_TYPE_NOT_FOUND",
        };
    }
    const nowMs = Date.now();
    const state = {
        assemblyStatus: ASSEMBLY_STATUS_UNDER_CONSTRUCTION,
        assemblyTypeID: definition.assemblyTypeID,
        completeAtMs: 0,
        completedAtMs: 0,
        constructionCost: definition.constructionCost,
        constructionSiteTypeID: definition.constructionSiteTypeID,
        createdAtMs: nowMs,
        destinationGateID: 0,
        durationSeconds: definition.durationSeconds,
        ownerID: actor.ownerPrincipalID,
        solarSystemID: actor.solarSystemID,
        targetSolarSystemID: 0,
    };
    const operator = require("../../space/npc/npcAssemblyActorContext")
        .publicNpcAssemblyOperator(actor);
    const constructionInfo = parseCustomInfo(writeConstructionState(null, state, false));
    constructionInfo.evejsNpcConstruction = {
        version: 2,
        jobID,
        phase: "site",
        operator,
        builderNpcProfileObjectID: actor.suiProfileObjectID,
        factionKey: actor.factionKey,
        placement: {
            anchorKind: plannedPlacement.anchorKind,
            anchorItemID: plannedPlacement.anchorItemID,
            buildAnchor: plannedPlacement.buildAnchor,
            networkNodeID: plannedPlacement.networkNodeID || null,
            placementAttempt: plannedPlacement.placementAttempt,
            placementPreference: plannedPlacement.placementPreference,
            position: placement.position,
            unrestrictedInSystem: plannedPlacement.unrestrictedInSystem === true,
        },
        registeredForFaction: false,
        createdAtMs: nowMs,
    };
    const createResult = itemStore.createSpaceItemForOwner(actor.ownerPrincipalID, actor.solarSystemID, metadata, {
        customInfo: JSON.stringify(constructionInfo),
        dunRotation: rotation,
        mode: "STOP",
        position: placement.position,
    });
    if (!createResult.success || !createResult.data)
        return createResult;
    const spawnResult = getSpaceRuntime().spawnDynamicInventoryEntity(actor.solarSystemID, createResult.data.itemID, { broadcast: true });
    if (!spawnResult.success) {
        const rollback = itemStore.removeInventoryItem(createResult.data.itemID, { removeContents: true });
        return { ...spawnResult, rollbackError: rollback.success ? null : rollback.errorMsg };
    }
    syncChanges(null, createResult.changes || []);
    log.info(`[FrontierDeployment] NPC construction placed actor=${actor.actorID} ` +
        `item=${createResult.data.itemID} type=${definition.assemblyTypeID} ` +
        `system=${actor.solarSystemID} faction=${actor.factionKey}`);
    return {
        success: true,
        data: {
            item: createResult.data,
            definition,
            directPlacement,
            deploymentDistance: placement.deploymentDistance,
            positionFrame: "world",
            buildAnchor: plannedPlacement.buildAnchor,
            buildAnchorItemID: plannedPlacement.buildAnchorItemID,
            placement: constructionInfo.evejsNpcConstruction.placement,
        },
    };
}
function validateNpcConstructionItem(actor, itemID, jobID = null) {
    const actorResult = validateNpcAssemblyActor(actor);
    if (!actorResult.success)
        return actorResult;
    const item = itemStore.findItemById(toInt(itemID, 0));
    const state = readConstructionState(item);
    const metadata = readNpcConstructionMetadata(item);
    if (!item || !state || !metadata) {
        return { success: false, errorMsg: "CONSTRUCTION_SITE_NOT_FOUND" };
    }
    if (toInt(item.ownerID, 0) !== actorResult.data.ownerPrincipalID ||
        metadata.operator?.actorID !== actorResult.data.actorID ||
        metadata.factionKey !== actorResult.data.factionKey ||
        (jobID && metadata.jobID !== jobID)) {
        return { success: false, errorMsg: "CONSTRUCTION_SITE_ACCESS_DENIED" };
    }
    return { success: true, actor: actorResult.data, item, state, metadata };
}
/** Move exact reserved stacks to the construction root in one item-table write. */
function depositNpcConstructionMaterials(actor, itemID, materialPlan, jobID = null) {
    const validation = validateNpcConstructionItem(actor, itemID, jobID);
    if (!validation.success)
        return validation;
    if (validation.state.assemblyStatus !== ASSEMBLY_STATUS_UNDER_CONSTRUCTION) {
        return { success: true, data: { alreadyComplete: true } };
    }
    const deposited = aggregateContainerItems(null, validation.item.itemID);
    if (hasRequiredMaterials(validation.state.constructionCost, deposited)) {
        return { success: true, data: { deposited, idempotent: true } };
    }
    const entries = Array.isArray(materialPlan) ? materialPlan : [];
    const requested = [];
    for (const [rawTypeID, rawQuantity] of Object.entries(validation.state.constructionCost)) {
        const typeID = toInt(rawTypeID, 0);
        let outstanding = Math.max(0, toInt(rawQuantity, 0) - toInt(deposited[String(typeID)], 0));
        for (const entry of entries) {
            if (outstanding <= 0 || toInt(entry.typeID, 0) !== typeID)
                continue;
            const item = itemStore.findItemById(toInt(entry.itemID, 0));
            if (!item || toInt(item.locationID, 0) === validation.item.itemID)
                continue;
            if (toInt(item.locationID, 0) !== toInt(entry.locationID, 0) ||
                toInt(item.flagID, -1) !== toInt(entry.flagID, -1) ||
                toInt(item.ownerID, 0) !== toInt(entry.ownerID, 0)) {
                return { success: false, errorMsg: "NPC_CONSTRUCTION_MATERIAL_MOVED" };
            }
            const quantity = Math.min(outstanding, toInt(entry.quantity, 0), getItemQuantity(item));
            if (quantity > 0) {
                requested.push({
                    itemID: item.itemID,
                    quantity,
                    destinationLocationID: validation.item.itemID,
                    destinationFlagID: 0,
                });
                outstanding -= quantity;
            }
        }
        if (outstanding > 0) {
            return { success: false, errorMsg: "INSUFFICIENT_CONSTRUCTION_MATERIAL" };
        }
    }
    if (requested.length > 0) {
        const result = itemStore.moveItemsToLocations(requested);
        if (!result.success)
            return result;
        syncChanges(null, result.data && result.data.changes || []);
    }
    const depositedAfter = aggregateContainerItems(null, validation.item.itemID);
    if (!hasRequiredMaterials(validation.state.constructionCost, depositedAfter)) {
        return { success: false, errorMsg: "CONSTRUCTION_MATERIALS_INCOMPLETE" };
    }
    return { success: true, data: { deposited: depositedAfter, moves: requested } };
}
function completeNpcConstruction(actor, itemID, jobID = null) {
    const validation = validateNpcConstructionItem(actor, itemID, jobID);
    if (!validation.success)
        return validation;
    const completed = completeConstruction(itemID, { force: true, session: null, flush: true });
    if (!completed.success)
        return completed;
    const update = itemStore.updateInventoryItem(itemID, (currentItem) => {
        const metadata = readNpcConstructionMetadata(currentItem);
        return {
            ...currentItem,
            customInfo: writeNpcConstructionMetadata(currentItem, {
                ...metadata,
                phase: "constructed",
                completedAtMs: metadata.completedAtMs || Date.now(),
            }),
        };
    });
    if (!update.success)
        return update;
    const state = readConstructionState(update.data);
    const definition = state && getBuildDefinition(state.assemblyTypeID);
    let suiStatusIntent = null;
    if (definition?.createOnChain) {
        try {
            suiStatusIntent = recordInitialSuiAssemblyState({
                itemId: String(update.data.itemID),
                ownerId: Number(update.data.ownerID),
                typeId: Number(update.data.typeID),
                status: state.assemblyStatus,
            });
        }
        catch (error) {
            return { success: false, errorMsg: error.code || "ASSEMBLY_STATE_UNAVAILABLE" };
        }
        if (!suiStatusIntent) {
            return { success: false, errorMsg: "ASSEMBLY_STATE_UNAVAILABLE" };
        }
    }
    return {
        success: true,
        data: { item: itemStore.findItemById(itemID), presentation: completed.data?.presentation, suiStatusIntent },
    };
}
function getNpcAssemblyLifecycle(actor, itemID, jobID = null) {
    const validation = validateNpcConstructionItem(actor, itemID, jobID);
    if (!validation.success)
        return validation;
    const definition = getBuildDefinition(validation.state.assemblyTypeID);
    return {
        success: true,
        data: {
            item: validation.item,
            state: validation.state,
            metadata: validation.metadata,
            createOnChain: Boolean(definition && definition.createOnChain),
            activationPending: isAssemblyActivationPending(validation.item),
            suiStatusIntent: require("./suiAssemblyState").readSuiAssemblyStatusIntent(validation.item),
        },
    };
}
/** Records a scoped NPC lifecycle intent; the supervised Sui worker signs it. */
function requestNpcAssemblyState(actor, itemID, targetStatus, jobID = null) {
    const validation = validateNpcConstructionItem(actor, itemID, jobID);
    if (!validation.success)
        return validation;
    const requested = toInt(targetStatus, 0);
    if (![ASSEMBLY_STATUS_OFFLINE, ASSEMBLY_STATUS_ONLINE].includes(requested)) {
        return { success: false, errorMsg: "INVALID_ASSEMBLY_STATE" };
    }
    if (validation.state.assemblyStatus === ASSEMBLY_STATUS_UNDER_CONSTRUCTION) {
        return { success: false, errorMsg: "ASSEMBLY_UNDER_CONSTRUCTION" };
    }
    if (isAssemblyActivationPending(validation.item)) {
        return { success: false, errorMsg: "ASSEMBLY_ACTIVATING" };
    }
    const definition = getBuildDefinition(validation.state.assemblyTypeID);
    if (!definition)
        return { success: false, errorMsg: "ASSEMBLY_TYPE_NOT_SUPPORTED" };
    if (definition.createOnChain &&
        !require("./suiAssemblyState").isSuiAssemblyStateAuthoritative()) {
        return { success: false, errorMsg: "ASSEMBLY_STATE_UNAVAILABLE" };
    }
    if (requested === ASSEMBLY_STATUS_ONLINE && !hasNetworkNodeFuelForOnline(validation.item)) {
        return { success: false, errorMsg: "NETWORK_NODE_FUEL_REQUIRED" };
    }
    if (requested === ASSEMBLY_STATUS_ONLINE) {
        const energy = require("./networkNodeEnergyRuntime").validateAssemblyOnline(validation.item);
        if (!energy.success)
            return energy;
        if (isSmartGateDefinition(definition)) {
            if (isSlingshotGateType(validation.state.assemblyTypeID)) {
                const destination = validateCatapultDestination(validation, validation.state.targetSolarSystemID);
                if (validation.state.destinationGateID > 0 || destination.success === false) {
                    return { success: false, errorMsg: "SMART_CATAPULT_DESTINATION_REQUIRED" };
                }
            }
            else if (validation.state.targetSolarSystemID <= 0) {
                return { success: false, errorMsg: "SMART_GATE_DESTINATION_REQUIRED" };
            }
        }
    }
    const pending = require("./suiAssemblyState").readSuiAssemblyStatusIntent(validation.item);
    if (validation.state.assemblyStatus === requested &&
        (!definition.createOnChain || pending?.targetStatus === requested || !pending)) {
        return { success: true, data: { item: validation.item, idempotent: true, pending } };
    }
    const update = itemStore.updateInventoryItem(itemID, (currentItem) => ({
        ...currentItem,
        customInfo: writeConstructionState(currentItem, {
            ...readConstructionState(currentItem),
            assemblyStatus: requested,
        }, definition.createOnChain),
    }));
    if (!update.success)
        return update;
    refreshAssemblyStatePresentation(null, update.data, readConstructionState(update.data));
    syncChanges(null, [{ item: update.data, previousData: update.previousData }]);
    return {
        success: true,
        data: {
            item: update.data,
            pending: definition.createOnChain
                ? require("./suiAssemblyState").readSuiAssemblyStatusIntent(update.data)
                : null,
        },
    };
}
function registerNpcAssemblyForFaction(actor, itemID, input = {}) {
    const validation = validateNpcConstructionItem(actor, itemID, input.jobID || null);
    if (!validation.success)
        return validation;
    const commandNodeID = toInt(input.commandNodeID, 0);
    if (commandNodeID > 0) {
        const commandNode = itemStore.findItemById(commandNodeID);
        const commandMetadata = readNpcConstructionMetadata(commandNode);
        if (!commandNode || !commandMetadata ||
            commandMetadata.factionKey !== validation.actor.factionKey) {
            return { success: false, errorMsg: "NPC_COMMAND_NODE_ACCESS_DENIED" };
        }
    }
    const update = itemStore.updateInventoryItem(itemID, (currentItem) => {
        const metadata = readNpcConstructionMetadata(currentItem);
        return {
            ...currentItem,
            customInfo: writeNpcConstructionMetadata(currentItem, {
                ...metadata,
                phase: "registered",
                registeredForFaction: true,
                registeredAtMs: metadata.registeredAtMs || Date.now(),
                commandNodeID: commandNodeID || null,
            }),
        };
    });
    return update.success
        ? { success: true, data: { item: update.data, metadata: readNpcConstructionMetadata(update.data) } }
        : update;
}
function getDepositedItemsByType(session, itemID) {
    const validation = validateOwnedConstructionItem(session, itemID);
    if (validation.success === false) {
        return validation;
    }
    return {
        success: true,
        data: aggregateContainerItems(validation.item.ownerID, validation.item.itemID),
    };
}
function depositItems(session, itemID, inventoryID, rawQuantities) {
    const validation = validateOwnedConstructionItem(session, itemID);
    if (validation.success === false) {
        return validation;
    }
    const { item, state } = validation;
    if (state.assemblyStatus !== ASSEMBLY_STATUS_UNDER_CONSTRUCTION) {
        return { success: false, errorMsg: "CONSTRUCTION_ALREADY_COMPLETE" };
    }
    const characterID = getCharacterID(session);
    const sourceLocationID = toInt(inventoryID, 0);
    const requested = normalizeQuantityMap(rawQuantities);
    if (sourceLocationID <= 0 || Object.keys(requested).length === 0) {
        return { success: false, errorMsg: "INVALID_CONSTRUCTION_DEPOSIT" };
    }
    const depositedBefore = aggregateContainerItems(characterID, item.itemID);
    const sourceQuantities = aggregateContainerItems(characterID, sourceLocationID);
    for (const [typeID, quantity] of Object.entries(requested)) {
        const required = toInt(state.constructionCost[typeID], 0);
        const outstanding = Math.max(0, required - toInt(depositedBefore[typeID], 0));
        if (required <= 0 || quantity > outstanding) {
            return { success: false, errorMsg: "INVALID_CONSTRUCTION_MATERIAL" };
        }
        if (toInt(sourceQuantities[typeID], 0) < quantity) {
            return { success: false, errorMsg: "INSUFFICIENT_CONSTRUCTION_MATERIAL" };
        }
    }
    const changes = [];
    for (const [typeID, quantity] of Object.entries(requested)) {
        const moveResult = itemStore.moveItemTypeFromCharacterLocation(characterID, sourceLocationID, null, item.itemID, 0, toInt(typeID, 0), quantity);
        if (!moveResult.success) {
            return moveResult;
        }
        changes.push(...((moveResult.data && moveResult.data.changes) || []));
    }
    syncChanges(session, changes);
    const depositedAfter = aggregateContainerItems(characterID, item.itemID);
    if (hasRequiredMaterials(state.constructionCost, depositedAfter)) {
        // The activate duration belongs to the finished assembly. The depot is
        // replaced as soon as it has its materials so the actual model shows it.
        const result = completeConstruction(item.itemID, { force: true, session });
        if (!result.success)
            return result;
    }
    return { success: true, data: depositedAfter };
}
function completeConstruction(itemID, options = {}) {
    clearCompletionTimer(itemID);
    const item = itemStore.findItemById(itemID);
    const state = readConstructionState(item);
    if (!item || !state) {
        return { success: false, errorMsg: "CONSTRUCTION_SITE_NOT_FOUND" };
    }
    if (state.assemblyStatus !== ASSEMBLY_STATUS_UNDER_CONSTRUCTION) {
        return { success: true, data: { item, alreadyComplete: true } };
    }
    // NPC builders can spend faction-owned cargo while the assembly itself is
    // owned by the durable NPC Character. Player construction retains its
    // original same-owner accounting rule.
    const materialOwnerID = readNpcConstructionMetadata(item) ? null : item.ownerID;
    const deposited = aggregateContainerItems(materialOwnerID, item.itemID);
    if (!hasRequiredMaterials(state.constructionCost, deposited)) {
        return { success: false, errorMsg: "CONSTRUCTION_MATERIALS_INCOMPLETE" };
    }
    const assemblyMetadata = itemStore.getItemMetadata(state.assemblyTypeID);
    const definition = getBuildDefinition(state.assemblyTypeID);
    if (!assemblyMetadata || !definition) {
        return { success: false, errorMsg: "ASSEMBLY_TYPE_NOT_FOUND" };
    }
    const durationSeconds = definition.durationSeconds;
    const completedAtMs = Date.now();
    const activationCompleteAtMs = state.completeAtMs > 0
        ? (state.completeAtMs > completedAtMs ? state.completeAtMs : 0)
        : (durationSeconds > 0 ? completedAtMs + durationSeconds * 1000 : 0);
    const completedAssemblyStatus = activationCompleteAtMs > 0 || definition.createOnChain
        ? ASSEMBLY_STATUS_OFFLINE
        : ASSEMBLY_STATUS_ONLINE;
    const materialPlan = buildConstructionMaterialConsumption(item.itemID, state.constructionCost, materialOwnerID);
    if (!materialPlan) {
        return { success: false, errorMsg: "CONSTRUCTION_MATERIALS_INCOMPLETE" };
    }
    const updateResult = itemStore.consumeInventoryItemsAndUpdateItem(materialPlan, item.itemID, (currentItem) => ({
        ...currentItem,
        customInfo: writeConstructionState(currentItem, {
            ...state,
            activationCompleteAtMs,
            assemblyStatus: completedAssemblyStatus,
            completeAtMs: 0,
            completedAtMs,
            durationSeconds,
        }),
        itemName: assemblyMetadata.name || currentItem.itemName,
        typeID: state.assemblyTypeID,
    }), { flush: options.flush === true });
    if (!updateResult.success) {
        return updateResult;
    }
    const spaceRuntime = getSpaceRuntime();
    // Rebuild the server entity without persisting its obsolete site fields.
    // The replacement broadcast removes the client's old native ball before
    // reacquiring this ID on a later simulation tick. Reusing the live ball
    // races the site's asynchronous Release against the assembly model load.
    spaceRuntime.removeDynamicEntity(state.solarSystemID, item.itemID, {
        broadcast: false,
        persistSpaceState: false,
    });
    scheduleAssemblyActivation(item.itemID, options.session || null);
    const spawnResult = spaceRuntime.spawnDynamicInventoryEntity(state.solarSystemID, item.itemID, { broadcast: true, broadcastOptions: { replaceExisting: true } });
    if (!spawnResult.success) {
        log.warn(`[FrontierDeployment] Completed item ${item.itemID} persisted but could not be presented: ${spawnResult.errorMsg}`);
    }
    syncChanges(findAssemblyOwnerSession(options.session, item.ownerID), [
        ...((updateResult.data && updateResult.data.changes) || []),
    ]);
    log.info(`[FrontierDeployment] Construction completed item=${item.itemID} ` +
        `assemblyType=${state.assemblyTypeID} system=${state.solarSystemID}`);
    return {
        success: true,
        data: { item: updateResult.data.item, presentation: spawnResult },
    };
}
function getDismantleGrantUnitVolume(itemType) {
    const metadata = itemStore.getItemMetadata(itemType && itemType.typeID || itemType);
    const categoryID = toInt(metadata && metadata.categoryID, 0);
    return categoryID === 6 || categoryID === 9
        ? Math.max(0, toFiniteNumber(metadata && metadata.volume, 0))
        : Math.max(0, itemStore.getPackagedVolumeForType(metadata.typeID, metadata));
}
function buildDismantleCargoPlan(item, state) {
    const containerType = itemStore.getItemMetadata(CARGO_CONTAINER_TYPE_ID);
    if (!containerType || toInt(containerType.typeID, 0) !== CARGO_CONTAINER_TYPE_ID) {
        return { success: false, errorMsg: "CARGO_CONTAINER_TYPE_NOT_FOUND" };
    }
    const capacity = Math.max(0, toFiniteNumber(containerType.capacity, CARGO_CONTAINER_CAPACITY_FALLBACK)) || CARGO_CONTAINER_CAPACITY_FALLBACK;
    const entriesByOwner = new Map();
    const addEntry = (ownerID, entry) => {
        const numericOwnerID = toInt(ownerID, 0);
        if (numericOwnerID <= 0)
            return false;
        if (!entriesByOwner.has(numericOwnerID))
            entriesByOwner.set(numericOwnerID, []);
        entriesByOwner.get(numericOwnerID).push(entry);
        return true;
    };
    const existingItems = itemStore.listContainerItems(null, item.itemID, null)
        .filter((child) => toInt(child && child.locationID, 0) === toInt(item.itemID, 0))
        .sort((left, right) => (toInt(left && left.ownerID, 0) - toInt(right && right.ownerID, 0) ||
        toInt(left && left.itemID, 0) - toInt(right && right.itemID, 0)));
    for (const child of existingItems) {
        const quantity = getItemQuantity(child);
        if (quantity <= 0 ||
            !addEntry(child.ownerID, {
                itemID: toInt(child.itemID, 0),
                kind: "move",
                quantity,
                singleton: toInt(child.singleton, 0) !== 0,
                typeID: toInt(child.typeID, 0),
                unitVolume: Math.max(0, itemStore.getInventoryItemUnitVolume(child)),
            })) {
            return { success: false, errorMsg: "INVALID_DISMANTLE_CONTENTS" };
        }
    }
    // A completed assembly consumed its authored construction cost. Recreate
    // exactly that cost; an unfinished site's deposited rows are already above
    // and only those actually deposited are returned.
    if (state.assemblyStatus !== ASSEMBLY_STATUS_UNDER_CONSTRUCTION) {
        for (const [rawTypeID, rawQuantity] of Object.entries(state.constructionCost)) {
            const typeID = toInt(rawTypeID, 0);
            const quantity = toInt(rawQuantity, 0);
            const itemType = itemStore.getItemMetadata(typeID);
            if (typeID <= 0 ||
                quantity <= 0 ||
                !itemType ||
                toInt(itemType.typeID, 0) !== typeID ||
                !addEntry(item.ownerID, {
                    itemType,
                    kind: "grant",
                    quantity,
                    singleton: [6, 9].includes(toInt(itemType.categoryID, 0)),
                    typeID,
                    unitVolume: getDismantleGrantUnitVolume(itemType),
                })) {
                return { success: false, errorMsg: "INVALID_CONSTRUCTION_MATERIAL" };
            }
        }
    }
    const bins = [];
    const binsByOwner = new Map();
    const createBin = (ownerID) => {
        const bin = { ownerID, usedVolume: 0, moves: [], grants: [] };
        bins.push(bin);
        if (!binsByOwner.has(ownerID))
            binsByOwner.set(ownerID, []);
        binsByOwner.get(ownerID).push(bin);
        return bin;
    };
    const epsilon = 1e-6;
    for (const [ownerID, entries] of [...entriesByOwner.entries()]
        .sort((left, right) => left[0] - right[0])) {
        for (const entry of entries) {
            if (entry.unitVolume > capacity + epsilon) {
                return {
                    success: false,
                    errorMsg: "DISMANTLE_ITEM_EXCEEDS_CONTAINER_CAPACITY",
                    data: { capacity, typeID: entry.typeID, unitVolume: entry.unitVolume },
                };
            }
            let remaining = entry.quantity;
            while (remaining > 0) {
                let bin = (binsByOwner.get(ownerID) || []).find((candidate) => (entry.unitVolume <= 0 ||
                    candidate.usedVolume + entry.unitVolume <= capacity + epsilon));
                if (!bin)
                    bin = createBin(ownerID);
                const availableUnits = entry.unitVolume > 0
                    ? Math.floor((capacity - bin.usedVolume + epsilon) / entry.unitVolume)
                    : remaining;
                const quantity = entry.singleton
                    ? 1
                    : Math.min(remaining, Math.max(0, availableUnits));
                if (quantity <= 0) {
                    bin = createBin(ownerID);
                    continue;
                }
                if (entry.kind === "move") {
                    bin.moves.push({ itemID: entry.itemID, quantity });
                }
                else {
                    bin.grants.push({ itemType: entry.itemType, quantity });
                }
                bin.usedVolume += entry.unitVolume * quantity;
                remaining -= quantity;
            }
        }
    }
    const sourceName = String(item.itemName || `Assembly ${item.itemID}`);
    const totalByOwner = new Map();
    for (const bin of bins) {
        totalByOwner.set(bin.ownerID, (totalByOwner.get(bin.ownerID) || 0) + 1);
    }
    const nextPartByOwner = new Map();
    return {
        success: true,
        data: {
            capacity,
            containers: bins.map((bin, index) => {
                const part = (nextPartByOwner.get(bin.ownerID) || 0) + 1;
                nextPartByOwner.set(bin.ownerID, part);
                const parts = totalByOwner.get(bin.ownerID);
                return {
                    grants: bin.grants,
                    itemType: containerType,
                    moves: bin.moves,
                    ownerID: bin.ownerID,
                    solarSystemID: state.solarSystemID,
                    options: {
                        ...getDismantleContainerSpawnState(item, index),
                        createdAtMs: Date.now(),
                        customInfo: JSON.stringify({
                            evejsFrontierDismantleCargo: {
                                ownerID: bin.ownerID,
                                part,
                                parts,
                                sourceItemID: item.itemID,
                            },
                        }),
                        itemName: `${sourceName} Dismantled Cargo${parts > 1 ? ` ${part}/${parts}` : ""}`,
                        launcherID: item.itemID,
                    },
                };
            }),
        },
    };
}
function syncDismantleChanges(session, changes) {
    const changesByOwner = new Map();
    for (const change of Array.isArray(changes) ? changes : []) {
        const ownerID = toInt(change && change.item && change.item.ownerID ||
            change && change.previousData && change.previousData.ownerID, 0);
        if (ownerID <= 0)
            continue;
        if (!changesByOwner.has(ownerID))
            changesByOwner.set(ownerID, []);
        changesByOwner.get(ownerID).push(change);
    }
    for (const [ownerID, ownerChanges] of changesByOwner) {
        syncChanges(findAssemblyOwnerSession(session, ownerID), ownerChanges);
    }
}
function validateDismantleAssembly(session, itemID) {
    const characterID = getCharacterID(session);
    const item = itemStore.findItemById(toInt(itemID, 0));
    const state = readConstructionState(item);
    if (!item || !state) {
        return { success: false, errorMsg: "ASSEMBLY_NOT_FOUND" };
    }
    if (characterID <= 0 || toInt(item.ownerID, 0) !== characterID) {
        return { success: false, errorMsg: "ASSEMBLY_ACCESS_DENIED" };
    }
    if (getSolarSystemID(session) !== state.solarSystemID) {
        return { success: false, errorMsg: "ASSEMBLY_NOT_IN_CURRENT_SYSTEM" };
    }
    if (state.destinationGateID > 0 || listAssemblies().some((candidate) => (candidate.itemID !== item.itemID && candidate.destinationGateID === item.itemID))) {
        return { success: false, errorMsg: "SMART_GATE_MUST_BE_UNLINKED" };
    }
    const industryProduction = require("./industryProduction");
    if (industryProduction.invalidStoredProduction(item) ||
        industryProduction.hasActiveProduction(item)) {
        return { success: false, errorMsg: "ASSEMBLY_OCCUPIED" };
    }
    const berthingRuntime = require(path.join(__dirname, "./berthingRuntime"));
    if (hasPersistedBerthReference(item.itemID) ||
        (typeof berthingRuntime.hasActiveContractForHostAssembly === "function" &&
            berthingRuntime.hasActiveContractForHostAssembly(item.itemID))) {
        return { success: false, errorMsg: "ASSEMBLY_OCCUPIED" };
    }
    return { success: true, characterID, item, state };
}
function dismantleAssembly(session, itemID, options = {}) {
    const validation = validateDismantleAssembly(session, itemID);
    if (validation.success === false)
        return validation;
    const { item, state } = validation;
    if (options.requireUnderConstruction === true &&
        state.assemblyStatus !== ASSEMBLY_STATUS_UNDER_CONSTRUCTION) {
        return { success: false, errorMsg: "CONSTRUCTION_ALREADY_COMPLETE" };
    }
    const cargoPlan = buildDismantleCargoPlan(item, state);
    if (cargoPlan.success === false)
        return cargoPlan;
    const commitResult = itemStore.commitContainerizedInventoryRemoval({
        containers: cargoPlan.data.containers,
        expectedCustomInfo: item.customInfo,
        rootItemID: item.itemID,
    });
    if (!commitResult.success)
        return commitResult;
    clearCompletionTimer(item.itemID);
    clearActivationTimer(item.itemID);
    clearPendingAssemblyTransitionsForItem(item.itemID);
    const requestCleanup = require("./smartAssemblyRequestRuntime")
        .cancelRequestsForAssembly(item.itemID, "ASSEMBLY_DISMANTLED");
    if (!requestCleanup || requestCleanup.success !== true) {
        log.warn(`[FrontierDeployment] Request cleanup failed for dismantled assembly ` +
            `item=${item.itemID} reason=${requestCleanup && requestCleanup.errorMsg || "UNKNOWN"}`);
    }
    const accessCleanup = require("./assemblyAccessRuntime")
        .cancelRequestsForAssembly(item.itemID, "ASSEMBLY_DISMANTLED");
    if (!accessCleanup || accessCleanup.success !== true) {
        log.warn(`[FrontierDeployment] Access cleanup failed for dismantled assembly ` +
            `item=${item.itemID} reason=${accessCleanup && accessCleanup.errorMsg || "UNKNOWN"}`);
    }
    const spaceRuntime = getSpaceRuntime();
    spaceRuntime.removeDynamicEntity(state.solarSystemID, item.itemID, {
        broadcast: true,
        persistSpaceState: false,
    });
    const containerItems = commitResult.data && commitResult.data.containers || [];
    for (const container of containerItems) {
        const spawnResult = spaceRuntime.spawnDynamicInventoryEntity(state.solarSystemID, container.itemID, { broadcast: true });
        if (!spawnResult || spawnResult.success !== true) {
            log.warn(`[FrontierDeployment] Dismantle cargo presentation failed ` +
                `container=${container.itemID} reason=${spawnResult && spawnResult.errorMsg || "UNKNOWN"}`);
        }
    }
    syncDismantleChanges(session, commitResult.data && commitResult.data.changes);
    log.info(`[FrontierDeployment] Dismantled item=${item.itemID} type=${state.assemblyTypeID} ` +
        `containers=${containerItems.length} system=${state.solarSystemID}`);
    return {
        success: true,
        data: {
            containers: containerItems,
            record: buildAssemblyRecord(item, state),
        },
    };
}
function cancelConstruction(session, itemID) {
    return dismantleAssembly(session, itemID, { requireUnderConstruction: true });
}
function clearPendingAssemblyTransitionsForItem(itemID) {
    const numericItemID = toInt(itemID, 0);
    for (const [transactionUUID, transition] of pendingAssemblyTransitions) {
        if (transition && transition.itemID === numericItemID) {
            pendingAssemblyTransitions.delete(transactionUUID);
        }
    }
}
function findAssemblyOwnerSession(session, ownerID) {
    const numericOwnerID = toInt(ownerID, 0);
    if (numericOwnerID <= 0) {
        return null;
    }
    if (getCharacterID(session) === numericOwnerID) {
        return session;
    }
    const sessionRegistry = require(path.join(__dirname, "../chat/sessionRegistry"));
    return sessionRegistry.findSessionByCharacterID(numericOwnerID) || null;
}
function syncAdminChanges(session, ownerID, changes) {
    const ownerSession = findAssemblyOwnerSession(session, ownerID);
    syncChanges(ownerSession, changes);
    return ownerSession;
}
function adminSpawnAssembly(session, assemblyTypeID, rawPosition, options = {}) {
    const access = validateAssemblyAdminSession(session);
    if (access.success === false) {
        return access;
    }
    const characterID = getCharacterID(session);
    const solarSystemID = getSolarSystemID(session);
    const numericTypeID = Number(assemblyTypeID);
    const position = normalizeWorldVector(rawPosition);
    if (characterID <= 0 || solarSystemID <= 0) {
        return { success: false, errorMsg: "NOT_IN_SPACE" };
    }
    if (!Number.isSafeInteger(numericTypeID) || numericTypeID <= 0) {
        return { success: false, errorMsg: "ASSEMBLY_TYPE_NOT_SUPPORTED" };
    }
    const definition = getBuildDefinition(numericTypeID);
    if (!definition) {
        return { success: false, errorMsg: "ASSEMBLY_TYPE_NOT_SUPPORTED" };
    }
    if (!position) {
        return { success: false, errorMsg: "INVALID_DEPLOYMENT_PLACEMENT" };
    }
    const shipItem = itemStore.getActiveShipItem(characterID);
    const shipEntity = getSessionShipEntity(session, shipItem);
    if (!shipItem ||
        !shipEntity ||
        toInt(shipItem.locationID, 0) !== solarSystemID ||
        toInt(shipItem.flagID, -1) !== 0) {
        return { success: false, errorMsg: "SHIP_NOT_IN_SPACE" };
    }
    const requestedStatus = options.assemblyStatus === undefined ||
        options.assemblyStatus === null
        ? (definition.createOnChain
            ? ASSEMBLY_STATUS_OFFLINE
            : ASSEMBLY_STATUS_ONLINE)
        : toInt(options.assemblyStatus, 0);
    if (requestedStatus !== ASSEMBLY_STATUS_OFFLINE &&
        requestedStatus !== ASSEMBLY_STATUS_ONLINE) {
        return { success: false, errorMsg: "INVALID_ASSEMBLY_STATE" };
    }
    if (requestedStatus === ASSEMBLY_STATUS_ONLINE && isSmartGateDefinition(definition)) {
        return {
            success: false,
            errorMsg: isSlingshotGateType(numericTypeID)
                ? "SMART_CATAPULT_DESTINATION_REQUIRED"
                : "SMART_GATE_DESTINATION_REQUIRED",
        };
    }
    const rotationInput = Array.isArray(options.dunRotation)
        ? options.dunRotation.slice(0, 3).map((value) => Number(value))
        : [0, 0, 0];
    if (rotationInput.length !== 3 || !rotationInput.every(Number.isFinite)) {
        return { success: false, errorMsg: "INVALID_DEPLOYMENT_ROTATION" };
    }
    const metadata = itemStore.getItemMetadata(numericTypeID);
    if (!metadata || toInt(metadata.typeID, 0) <= 0) {
        return { success: false, errorMsg: "ASSEMBLY_TYPE_NOT_FOUND" };
    }
    const nowMs = Date.now();
    const state = {
        assemblyStatus: requestedStatus,
        activationCompleteAtMs: 0,
        assemblyTypeID: numericTypeID,
        completeAtMs: 0,
        completedAtMs: nowMs,
        constructionCost: definition.constructionCost,
        constructionSiteTypeID: definition.constructionSiteTypeID,
        createdAtMs: nowMs,
        destinationGateID: 0,
        durationSeconds: definition.durationSeconds,
        ownerID: characterID,
        solarSystemID,
        targetSolarSystemID: 0,
    };
    const createResult = itemStore.createSpaceItemForCharacter(characterID, solarSystemID, metadata, {
        customInfo: writeConstructionState(null, state),
        dunRotation: rotationInput,
        mode: "STOP",
        position,
    });
    if (!createResult.success || !createResult.data) {
        return createResult.success
            ? { success: false, errorMsg: "ASSEMBLY_CREATE_FAILED" }
            : createResult;
    }
    const spawnResult = getSpaceRuntime().spawnDynamicInventoryEntity(solarSystemID, createResult.data.itemID, { broadcast: true });
    if (!spawnResult.success) {
        const rollback = itemStore.removeInventoryItem(createResult.data.itemID, {
            removeContents: false,
        });
        if (!rollback.success) {
            log.error(`[FrontierDeployment] Admin spawn rollback failed item=${createResult.data.itemID} ` +
                `reason=${rollback.errorMsg || "UNKNOWN"}`);
        }
        return spawnResult;
    }
    syncChanges(session, createResult.changes || []);
    notifyAssemblyAdded(session, createResult.data.itemID, solarSystemID);
    log.info(`[FrontierDeployment] Admin spawned assembly char=${characterID} ` +
        `item=${createResult.data.itemID} type=${numericTypeID} ` +
        `system=${solarSystemID} state=${requestedStatus}`);
    return {
        success: true,
        data: {
            item: createResult.data,
            record: buildAssemblyRecord(createResult.data, state),
        },
    };
}
function adminSetAssemblyState(session, itemID, targetStatus) {
    const access = validateAssemblyAdminSession(session);
    if (access.success === false) {
        return access;
    }
    const numericItemID = Number(itemID);
    const numericTargetStatus = toInt(targetStatus, 0);
    if (!Number.isSafeInteger(numericItemID) || numericItemID <= 0) {
        return { success: false, errorMsg: "ASSEMBLY_NOT_FOUND" };
    }
    if (numericTargetStatus !== ASSEMBLY_STATUS_OFFLINE &&
        numericTargetStatus !== ASSEMBLY_STATUS_ONLINE) {
        return { success: false, errorMsg: "INVALID_ASSEMBLY_STATE" };
    }
    const item = itemStore.findItemById(numericItemID);
    const state = readConstructionState(item);
    const definition = state && getBuildDefinition(state.assemblyTypeID);
    if (!item || !state || !definition) {
        return { success: false, errorMsg: "ASSEMBLY_NOT_FOUND" };
    }
    if (state.assemblyStatus === ASSEMBLY_STATUS_UNDER_CONSTRUCTION) {
        return { success: false, errorMsg: "ASSEMBLY_UNDER_CONSTRUCTION" };
    }
    if (isAssemblyActivationPending(item)) {
        return { success: false, errorMsg: "ASSEMBLY_ACTIVATING" };
    }
    if (numericTargetStatus === ASSEMBLY_STATUS_ONLINE && !hasNetworkNodeFuelForOnline(item)) {
        return { success: false, errorMsg: "NETWORK_NODE_FUEL_REQUIRED" };
    }
    if (numericTargetStatus === ASSEMBLY_STATUS_ONLINE) {
        const energy = require("./networkNodeEnergyRuntime").validateAssemblyOnline(item);
        if (!energy.success)
            return energy;
    }
    if (state.assemblyStatus === numericTargetStatus) {
        return {
            success: true,
            data: { alreadyApplied: true, item, record: buildAssemblyRecord(item, state) },
        };
    }
    if (numericTargetStatus === ASSEMBLY_STATUS_ONLINE && isSmartGateDefinition(definition)) {
        if (isSlingshotGateType(state.assemblyTypeID)) {
            const catapultDestination = validateCatapultDestination({ definition, item, state }, state.targetSolarSystemID);
            if (state.destinationGateID > 0 || catapultDestination.success === false) {
                return { success: false, errorMsg: "SMART_CATAPULT_DESTINATION_REQUIRED" };
            }
        }
        else {
            const destination = validateSmartGate(state.destinationGateID);
            if (destination.success === false ||
                destination.state.destinationGateID !== numericItemID ||
                destination.state.solarSystemID !== state.targetSolarSystemID ||
                destination.state.targetSolarSystemID !== state.solarSystemID ||
                destination.state.assemblyTypeID !== state.assemblyTypeID ||
                toInt(destination.item.ownerID, 0) !== toInt(item.ownerID, 0)) {
                return { success: false, errorMsg: "SMART_GATE_DESTINATION_REQUIRED" };
            }
        }
    }
    const updateResult = itemStore.updateInventoryItem(numericItemID, (currentItem) => ({
        ...currentItem,
        customInfo: writeConstructionState(currentItem, {
            ...state,
            assemblyStatus: numericTargetStatus,
        }),
    }));
    if (!updateResult.success || !updateResult.data) {
        return updateResult;
    }
    const updatedState = readConstructionState(updateResult.data);
    const ownerSession = findAssemblyOwnerSession(session, item.ownerID);
    const presentation = refreshAssemblyStatePresentation(ownerSession || session, updateResult.data, updatedState);
    if (!presentation.success) {
        const rollback = itemStore.updateInventoryItem(numericItemID, updateResult.previousData);
        if (!rollback.success) {
            log.error(`[FrontierDeployment] Admin state rollback failed item=${numericItemID} ` +
                `reason=${rollback.errorMsg || "UNKNOWN"}`);
        }
        refreshAssemblyStatePresentation(ownerSession || session, updateResult.previousData, state);
        return {
            ...presentation,
            rollbackError: rollback.success ? null : rollback.errorMsg,
        };
    }
    clearPendingAssemblyTransitionsForItem(numericItemID);
    syncAdminChanges(session, item.ownerID, [{
            item: updateResult.data,
            previousData: updateResult.previousData,
        }]);
    log.info(`[FrontierDeployment] Admin set assembly state char=${getCharacterID(session)} ` +
        `item=${numericItemID} state=${numericTargetStatus}`);
    return {
        success: true,
        data: {
            item: updateResult.data,
            record: buildAssemblyRecord(updateResult.data, updatedState),
        },
    };
}
function validateAdminGateLink(sourceGateID, destinationGateID) {
    const source = validateSmartGate(sourceGateID);
    if (source.success === false) {
        return source;
    }
    const destination = validateSmartGate(destinationGateID);
    if (destination.success === false) {
        return destination;
    }
    if (isSlingshotGateType(source.state.assemblyTypeID)) {
        return { success: false, errorMsg: "SMART_GATE_LINK_NOT_SUPPORTED" };
    }
    if (source.item.itemID === destination.item.itemID) {
        return { success: false, errorMsg: "SMART_GATE_SELF_LINK" };
    }
    if (toInt(source.item.ownerID, 0) <= 0 ||
        toInt(source.item.ownerID, 0) !== toInt(destination.item.ownerID, 0)) {
        return { success: false, errorMsg: "ASSEMBLY_OWNER_MISMATCH" };
    }
    if (source.state.solarSystemID === destination.state.solarSystemID) {
        return { success: false, errorMsg: "SMART_GATE_SAME_SYSTEM" };
    }
    if (source.state.assemblyTypeID !== destination.state.assemblyTypeID) {
        return { success: false, errorMsg: "SMART_GATE_TYPE_MISMATCH" };
    }
    if (source.state.destinationGateID > 0 || destination.state.destinationGateID > 0) {
        return { success: false, errorMsg: "SMART_GATE_ALREADY_LINKED" };
    }
    if (source.state.assemblyStatus !== ASSEMBLY_STATUS_OFFLINE ||
        destination.state.assemblyStatus !== ASSEMBLY_STATUS_OFFLINE) {
        return { success: false, errorMsg: "SMART_GATE_MUST_BE_OFFLINE" };
    }
    const distanceLightYears = getSolarSystemDistanceLightYears(source.state.solarSystemID, destination.state.solarSystemID);
    if (!Number.isFinite(distanceLightYears)) {
        return { success: false, errorMsg: "SMART_GATE_SYSTEM_DATA_UNAVAILABLE" };
    }
    if (distanceLightYears > source.definition.smartGate.rangeLightYears) {
        return {
            success: false,
            errorMsg: "SMART_GATE_OUT_OF_RANGE",
            data: {
                distanceLightYears,
                rangeLightYears: source.definition.smartGate.rangeLightYears,
            },
        };
    }
    return {
        success: true,
        destination,
        distanceLightYears,
        source: {
            ...source,
            characterID: toInt(source.item.ownerID, 0),
        },
    };
}
function adminLinkSmartGates(session, sourceGateID, destinationGateID) {
    const access = validateAssemblyAdminSession(session);
    if (access.success === false) {
        return access;
    }
    const sourceID = Number(sourceGateID);
    const destinationID = Number(destinationGateID);
    if (!Number.isSafeInteger(sourceID) || sourceID <= 0 ||
        !Number.isSafeInteger(destinationID) || destinationID <= 0) {
        return { success: false, errorMsg: "ASSEMBLY_NOT_FOUND" };
    }
    const validation = validateAdminGateLink(sourceID, destinationID);
    if (validation.success === false) {
        return validation;
    }
    const ownerSession = findAssemblyOwnerSession(session, validation.source.characterID);
    const updateResult = updateLinkedGatePair(ownerSession, validation);
    if (!updateResult.success) {
        return updateResult;
    }
    clearPendingAssemblyTransitionsForItem(sourceID);
    clearPendingAssemblyTransitionsForItem(destinationID);
    log.info(`[FrontierDeployment] Admin linked gates char=${getCharacterID(session)} ` +
        `source=${sourceID} destination=${destinationID}`);
    return updateResult;
}
function adminUnlinkSmartGate(session, sourceGateID) {
    const access = validateAssemblyAdminSession(session);
    if (access.success === false) {
        return access;
    }
    const sourceID = Number(sourceGateID);
    if (!Number.isSafeInteger(sourceID) || sourceID <= 0) {
        return { success: false, errorMsg: "ASSEMBLY_NOT_FOUND" };
    }
    const source = validateSmartGate(sourceID);
    if (source.success === false) {
        return source;
    }
    if (source.state.destinationGateID <= 0) {
        return { success: false, errorMsg: "SMART_GATE_NOT_LINKED" };
    }
    if (source.state.assemblyStatus !== ASSEMBLY_STATUS_OFFLINE) {
        return { success: false, errorMsg: "SMART_GATE_MUST_BE_OFFLINE" };
    }
    const destination = validateSmartGate(source.state.destinationGateID);
    const reciprocal = Boolean(destination.success &&
        destination.state.destinationGateID === sourceID &&
        toInt(destination.item.ownerID, 0) === toInt(source.item.ownerID, 0));
    if (reciprocal &&
        destination.state.assemblyStatus !== ASSEMBLY_STATUS_OFFLINE) {
        return { success: false, errorMsg: "SMART_GATE_MUST_BE_OFFLINE" };
    }
    const sourceUpdate = itemStore.updateInventoryItem(sourceID, (currentItem) => ({
        ...currentItem,
        customInfo: writeConstructionState(currentItem, {
            ...source.state,
            destinationGateID: 0,
            targetSolarSystemID: 0,
        }),
    }));
    if (!sourceUpdate.success || !sourceUpdate.data) {
        return sourceUpdate;
    }
    let destinationUpdate = null;
    if (reciprocal) {
        destinationUpdate = itemStore.updateInventoryItem(destination.item.itemID, (currentItem) => ({
            ...currentItem,
            customInfo: writeConstructionState(currentItem, {
                ...destination.state,
                destinationGateID: 0,
                targetSolarSystemID: 0,
            }),
        }));
        if (!destinationUpdate.success || !destinationUpdate.data) {
            const rollback = itemStore.updateInventoryItem(sourceID, sourceUpdate.previousData);
            if (!rollback.success) {
                log.error(`[FrontierDeployment] Admin gate unlink rollback failed item=${sourceID} ` +
                    `reason=${rollback.errorMsg || "UNKNOWN"}`);
            }
            return {
                ...destinationUpdate,
                rollbackError: rollback.success ? null : rollback.errorMsg,
            };
        }
    }
    const ownerSession = findAssemblyOwnerSession(session, source.item.ownerID);
    refreshAssemblyStatePresentation(ownerSession, sourceUpdate.data, readConstructionState(sourceUpdate.data));
    if (destinationUpdate && destinationUpdate.data) {
        refreshAssemblyStatePresentation(ownerSession, destinationUpdate.data, readConstructionState(destinationUpdate.data));
    }
    const changes = [{
            item: sourceUpdate.data,
            previousData: sourceUpdate.previousData,
        }];
    if (destinationUpdate && destinationUpdate.data) {
        changes.push({
            item: destinationUpdate.data,
            previousData: destinationUpdate.previousData,
        });
    }
    syncAdminChanges(session, source.item.ownerID, changes);
    clearPendingAssemblyTransitionsForItem(sourceID);
    if (destination.success) {
        clearPendingAssemblyTransitionsForItem(destination.item.itemID);
    }
    log.info(`[FrontierDeployment] Admin unlinked gates char=${getCharacterID(session)} ` +
        `source=${sourceID} destination=${source.state.destinationGateID} ` +
        `reciprocal=${reciprocal}`);
    return {
        success: true,
        data: {
            destination: destinationUpdate && destinationUpdate.data,
            repairedSourceOnly: !reciprocal,
            source: sourceUpdate.data,
        },
    };
}
function hasPersistedBerthReference(hostAssemblyID) {
    const numericHostID = toInt(hostAssemblyID, 0);
    const berthingRuntime = require(path.join(__dirname, "./berthingRuntime"));
    return Object.values(itemStore.getAllItems()).some((candidate) => (berthingRuntime.readBerthHostIDFromCustomInfo(candidate && candidate.customInfo) === numericHostID));
}
function adminCompleteConstruction(session, itemID) {
    const access = validateAssemblyAdminSession(session);
    if (access.success === false) {
        return access;
    }
    const numericItemID = Number(itemID);
    if (!Number.isSafeInteger(numericItemID) || numericItemID <= 0) {
        return { success: false, errorMsg: "CONSTRUCTION_SITE_NOT_FOUND" };
    }
    const item = itemStore.findItemById(numericItemID);
    const state = readConstructionState(item);
    if (!item || !state) {
        return { success: false, errorMsg: "CONSTRUCTION_SITE_NOT_FOUND" };
    }
    if (state.assemblyStatus !== ASSEMBLY_STATUS_UNDER_CONSTRUCTION) {
        return { success: false, errorMsg: "CONSTRUCTION_ALREADY_COMPLETE" };
    }
    const ownerSession = findAssemblyOwnerSession(session, item.ownerID);
    const result = completeConstruction(numericItemID, {
        force: true,
        session: ownerSession,
    });
    if (result.success) {
        log.info(`[FrontierDeployment] Admin completed construction char=${getCharacterID(session)} ` +
            `item=${numericItemID}`);
    }
    return result;
}
function adminRemoveAssembly(session, itemID) {
    const access = validateAssemblyAdminSession(session);
    if (access.success === false) {
        return access;
    }
    const numericItemID = Number(itemID);
    if (!Number.isSafeInteger(numericItemID) || numericItemID <= 0) {
        return { success: false, errorMsg: "ASSEMBLY_NOT_FOUND" };
    }
    const item = itemStore.findItemById(numericItemID);
    const state = readConstructionState(item);
    if (!item || !state) {
        return { success: false, errorMsg: "ASSEMBLY_NOT_FOUND" };
    }
    if (state.assemblyStatus !== ASSEMBLY_STATUS_UNDER_CONSTRUCTION &&
        state.assemblyStatus !== ASSEMBLY_STATUS_OFFLINE) {
        return { success: false, errorMsg: "ASSEMBLY_MUST_BE_OFFLINE" };
    }
    if (state.destinationGateID > 0) {
        return { success: false, errorMsg: "SMART_GATE_MUST_BE_UNLINKED" };
    }
    // A paid industry run can temporarily have no escrow rows. Its owed products
    // still occupy the facility until the run completes and they are withdrawn.
    const industryProduction = require("./industryProduction");
    if (industryProduction.invalidStoredProduction(item) ||
        industryProduction.hasActiveProduction(item)) {
        return { success: false, errorMsg: "ASSEMBLY_OCCUPIED" };
    }
    const inboundGate = listAssemblies().find((candidate) => (candidate.itemID !== numericItemID &&
        candidate.destinationGateID === numericItemID));
    if (inboundGate) {
        return {
            success: false,
            errorMsg: "SMART_GATE_MUST_BE_UNLINKED",
            data: { linkedFromItemID: inboundGate.itemID },
        };
    }
    const contents = itemStore.listContainerItems(null, numericItemID, null);
    if (contents.length > 0) {
        return {
            success: false,
            errorMsg: "ASSEMBLY_NOT_EMPTY",
            data: { itemCount: contents.length },
        };
    }
    const networkNodeFuelRuntime = require(path.join(__dirname, "./networkNodeFuelRuntime"));
    const fuelState = networkNodeFuelRuntime.readNetworkNodeFuelState(item);
    if (fuelState.quantity > 0) {
        return {
            success: false,
            errorMsg: "ASSEMBLY_NOT_EMPTY",
            data: {
                fuelQuantity: fuelState.quantity,
                fuelTypeID: fuelState.typeID,
            },
        };
    }
    const berthingRuntime = require(path.join(__dirname, "./berthingRuntime"));
    if (hasPersistedBerthReference(numericItemID) ||
        (typeof berthingRuntime.hasActiveContractForHostAssembly === "function" &&
            berthingRuntime.hasActiveContractForHostAssembly(numericItemID))) {
        return { success: false, errorMsg: "ASSEMBLY_OCCUPIED" };
    }
    const spaceRuntime = getSpaceRuntime();
    const scene = spaceRuntime.scenes instanceof Map
        ? spaceRuntime.scenes.get(state.solarSystemID) || null
        : null;
    const entity = scene && typeof scene.getEntityByID === "function"
        ? scene.getEntityByID(numericItemID)
        : null;
    if (entity) {
        const sceneRemoval = scene.removeDynamicEntity(numericItemID, {
            broadcast: true,
            persistSpaceState: false,
        });
        if (!sceneRemoval || sceneRemoval.success !== true) {
            return sceneRemoval || { success: false, errorMsg: "ASSEMBLY_SCENE_REMOVE_FAILED" };
        }
    }
    const removeResult = itemStore.removeInventoryItem(numericItemID, {
        removeContents: false,
    });
    if (!removeResult.success) {
        let rollbackError = null;
        if (entity) {
            const rollback = spaceRuntime.spawnDynamicInventoryEntity(state.solarSystemID, numericItemID, { broadcast: true });
            if (!rollback || rollback.success !== true) {
                rollbackError = rollback && rollback.errorMsg
                    ? rollback.errorMsg
                    : "ASSEMBLY_PRESENTATION_ROLLBACK_FAILED";
                log.error(`[FrontierDeployment] Admin remove presentation rollback failed ` +
                    `item=${numericItemID} reason=${rollbackError}`);
            }
        }
        return { ...removeResult, rollbackError };
    }
    clearCompletionTimer(numericItemID);
    clearActivationTimer(numericItemID);
    clearPendingAssemblyTransitionsForItem(numericItemID);
    const requestCleanup = require("./smartAssemblyRequestRuntime")
        .cancelRequestsForAssembly(numericItemID, "ASSEMBLY_REMOVED");
    if (!requestCleanup || requestCleanup.success !== true) {
        log.warn(`[FrontierDeployment] Request cleanup failed for removed assembly ` +
            `item=${numericItemID} reason=${requestCleanup && requestCleanup.errorMsg || "UNKNOWN"}`);
    }
    const accessCleanup = require("./assemblyAccessRuntime")
        .cancelRequestsForAssembly(numericItemID, "ASSEMBLY_REMOVED");
    if (!accessCleanup || accessCleanup.success !== true) {
        log.warn(`[FrontierDeployment] Access cleanup failed for removed assembly ` +
            `item=${numericItemID} reason=${accessCleanup && accessCleanup.errorMsg || "UNKNOWN"}`);
    }
    syncAdminChanges(session, item.ownerID, removeResult.data && removeResult.data.changes);
    log.info(`[FrontierDeployment] Admin removed assembly char=${getCharacterID(session)} ` +
        `item=${numericItemID} type=${state.assemblyTypeID} system=${state.solarSystemID}`);
    return {
        success: true,
        data: { record: buildAssemblyRecord(item, state) },
    };
}
function hydrateConstructionEntityFromInventoryItem(entity, item) {
    const state = readConstructionState(item);
    if (!entity || !state) {
        return entity;
    }
    entity.assembly_status = state.assemblyStatus;
    if (state.assemblyStatus === ASSEMBLY_STATUS_UNDER_CONSTRUCTION) {
        delete entity.component_activate;
        delete entity.activate_comp_durationSeconds;
        delete entity.activationState;
        delete entity.targetSolarsystemID;
        if (state.completeAtMs > 0) {
            scheduleConstruction(item.itemID);
        }
        return entity;
    }
    const isActive = !isAssemblyActivationPending(item);
    entity.component_activate = [
        isActive,
        isActive ? null : state.activationCompleteAtMs,
    ];
    entity.activate_comp_durationSeconds = state.durationSeconds;
    if (!isActive)
        scheduleAssemblyActivation(item.itemID);
    const definition = getBuildDefinition(state.assemblyTypeID);
    if (isSmartGateDefinition(definition)) {
        entity.activationState = getSmartGateActivationState(state);
        entity.targetSolarsystemID = state.targetSolarSystemID > 0
            ? state.targetSolarSystemID
            : null;
    }
    else {
        delete entity.activationState;
        delete entity.targetSolarsystemID;
    }
    return entity;
}
function listMyAssemblies(session) {
    const characterID = getCharacterID(session);
    if (characterID <= 0) {
        return [];
    }
    const records = [];
    for (const item of itemStore.listOwnedItems(characterID)) {
        const state = readConstructionState(item);
        if (!state) {
            continue;
        }
        scheduleAssemblyActivation(item.itemID, session);
        if (state.assemblyStatus === ASSEMBLY_STATUS_UNDER_CONSTRUCTION &&
            state.completeAtMs > 0) {
            scheduleConstruction(item.itemID, session);
        }
        const position = normalizeWorldVector(item.spaceState && item.spaceState.position);
        records.push({
            item_id: item.itemID,
            type_id: state.assemblyStatus === ASSEMBLY_STATUS_ONLINE
                ? item.typeID
                : state.assemblyTypeID,
            name: item.itemName || itemStore.getItemMetadata(state.assemblyTypeID).name,
            state: state.assemblyStatus,
            solar_system_id: state.solarSystemID,
            position: position ? [position.x, position.y, position.z] : null,
        });
    }
    return records.sort((left, right) => left.item_id - right.item_id);
}
function listOwnedSmartGates(characterID) {
    const numericCharacterID = toInt(characterID, 0);
    if (numericCharacterID <= 0) {
        return [];
    }
    const gates = [];
    for (const item of itemStore.listOwnedItems(numericCharacterID)) {
        const state = readConstructionState(item);
        const definition = state && getBuildDefinition(state.assemblyTypeID);
        if (!state ||
            state.assemblyStatus === ASSEMBLY_STATUS_UNDER_CONSTRUCTION ||
            !isSmartGateDefinition(definition)) {
            continue;
        }
        gates.push({
            activationState: getSmartGateActivationState(state),
            assemblyStatus: state.assemblyStatus,
            destinationGateID: state.destinationGateID,
            itemID: toInt(item.itemID, 0),
            name: String(item.itemName ||
                itemStore.getItemMetadata(state.assemblyTypeID).name ||
                "Smart Gate"),
            ownerID: numericCharacterID,
            position: normalizeWorldVector(item.spaceState && item.spaceState.position),
            rangeLightYears: definition.smartGate.rangeLightYears,
            solarSystemID: state.solarSystemID,
            targetSolarSystemID: state.targetSolarSystemID,
            typeID: state.assemblyTypeID,
        });
    }
    return gates.sort((left, right) => left.itemID - right.itemID);
}
function getSmartGateLinkStatus(characterID, gateID) {
    const numericCharacterID = toInt(characterID, 0);
    const source = validateOwnedSmartGateForCharacter(numericCharacterID, gateID, true);
    if (source.success === false)
        return source;
    const gates = listOwnedSmartGates(numericCharacterID);
    const gate = gates.find(entry => entry.itemID === source.item.itemID);
    const candidates = gates
        .filter(entry => entry.itemID !== gate.itemID && entry.typeID === gate.typeID)
        .map(entry => {
        const validation = validateGateLinkForCharacter(numericCharacterID, gate.itemID, entry.itemID);
        const distanceMeters = getSolarSystemDistanceMeters(gate.solarSystemID, entry.solarSystemID);
        const distance = distanceMeters / METERS_PER_LIGHT_YEAR;
        return {
            ...entry,
            distanceMeters: Number.isFinite(distanceMeters) ? BigInt(Math.ceil(distanceMeters)).toString() : null,
            distanceLightYears: Number.isFinite(distance) ? distance : null,
            eligible: validation.success,
            reason: validation.success === false ? validation.errorMsg : null,
        };
    });
    return {
        success: true,
        data: {
            gate,
            destination: gates.find(entry => entry.itemID === gate.destinationGateID) || null,
            candidates,
            rangeLightYears: gate.rangeLightYears,
        },
    };
}
function recordAssemblyInteraction(session, itemID) {
    const numericItemID = toInt(itemID, 0);
    const item = itemStore.findItemById(numericItemID);
    const state = readConstructionState(item);
    if (!item || !state) {
        return { success: false, errorMsg: "ASSEMBLY_NOT_FOUND" };
    }
    if (getSolarSystemID(session) !== state.solarSystemID) {
        return { success: false, errorMsg: "ASSEMBLY_NOT_IN_CURRENT_SYSTEM" };
    }
    log.info(`[FrontierDeployment] Assembly interaction char=${getCharacterID(session)} ` +
        `item=${numericItemID} type=${state.assemblyTypeID} ` +
        `state=${state.assemblyStatus} destination=${state.targetSolarSystemID || 0}`);
    return { success: true, data: { item, state } };
}
module.exports = {
    ASSEMBLY_STATUS_OFFLINE,
    ASSEMBLY_STATUS_ONLINE,
    ASSEMBLY_STATUS_UNDER_CONSTRUCTION,
    CONSTRUCTION_INFO_KEY,
    adminCompleteConstruction,
    adminLinkSmartGates,
    adminRemoveAssembly,
    adminSetAssemblyState,
    adminSpawnAssembly,
    adminUnlinkSmartGate,
    beginGateJumpTransition,
    beginGateLinkTransition,
    beginGateUnlinkTransition,
    beginAssemblyStateTransition,
    buildDeployable,
    previewDeployablePlacement,
    getConstructionSiteCapacity,
    CONSTRUCTION_SITE_LIMIT,
    planNpcConstructionSitePlacement,
    placeNpcConstructionSite,
    placeNpcDirectAssembly,
    depositNpcConstructionMaterials,
    completeNpcConstruction,
    getNpcAssemblyLifecycle,
    requestNpcAssemblyState,
    registerNpcAssemblyForFaction,
    findNpcAssemblyByJobID,
    readNpcConstructionMetadata,
    cancelConstruction,
    clearCatapultDestination,
    dismantleAssembly,
    commitGateJumpTransition,
    commitGateLinkTransition,
    commitGateUnlinkTransition,
    commitAssemblyStateTransition,
    completeConstruction,
    completeAssemblyActivation,
    scheduleAssemblyActivation,
    isAssemblyActivationPending,
    isPortableAssemblyType,
    depositItems,
    getDepositedItemsByType,
    getAssemblyRecord,
    getAvailableCatapultSystems,
    getSmartGateLinkStatus,
    hasAssemblyAdminPrivileges,
    hydrateConstructionEntityFromInventoryItem,
    listAssemblies,
    listAssemblyDefinitions,
    listOwnedSmartGates,
    jumpWithCatapult,
    linkSmartGates,
    listMyAssemblies,
    recordAssemblyInteraction,
    refreshAssemblyStatePresentation,
    offlineAssemblyForFuelDepletion,
    notifyAssemblyFuelDepleted,
    reconcileSponsoredAssemblyState,
    reconcileSuiAssemblyState,
    recordInitialSuiAssemblyState,
    setCatapultDestination,
    unlinkSmartGate,
    // Shared with the Network Node fuel runtime, which reuses the assembly
    // transition transaction/signature conventions and construction state.
    buildAssemblyTransitionTransactionData,
    isValidAssemblyTransitionSignature,
    readConstructionState,
    _testing: {
        buildDismantleCargoPlan,
        buildDefinitionsFromRows,
        buildAssemblyTransitionTransactionData,
        buildConstructionMaterialConsumption,
        isValidAssemblyTransitionSignature,
        isCompletedNetworkNodeBuildAnchorState,
        getSmartGateActivationState,
        hasPersistedBerthReference,
        getSolarSystemDistanceLightYears,
        isSlingshotGateType,
        isSmartGateDefinition,
        normalizeQuantityMap,
        normalizeRotationDegrees,
        normalizeWorldVector,
        findFrontierAssemblyOverlap,
        resolveNpcConstructionPlacement,
        validateFrontierAssemblyClearance,
        resolveDeploymentPosition,
        readConstructionState,
        writeConstructionState,
        clearBuildDefinitionCache() {
            buildDefinitionsByTypeID = null;
            solarSystemsByID = null;
        },
        clearCompletionTimers() {
            for (const timer of completionTimers.values()) {
                clearTimeout(timer);
            }
            completionTimers.clear();
            for (const timer of activationTimers.values())
                clearTimeout(timer);
            activationTimers.clear();
        },
        clearPendingAssemblyTransitions() {
            pendingAssemblyTransitions.clear();
        },
    },
};
//# sourceMappingURL=deploymentRuntime.js.map