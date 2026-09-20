"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * Frontier IFF transponder + Transponder Beacon runtime.
 *
 * Client contract (build 3502403 Python 3.12 bytecode):
 * - Transponder module 95988 (behavior "iff") starts/stops broadcasting via
 *   "activate_effect"/"deactivate_effect" and reconfigures a live broadcast
 *   through "iff_reconfigure". Both activation and reconfiguration carry the
 *   kwargs iff_channel/iff_code. Transponder channels are the lowercase
 *   strings "tribe" | "code" (IffChannel StrEnum), code max length 32.
 * - Beacon module 96039 (behavior "iff_beacon") activates through
 *   "activate_effect" (the action bar attaches the saved iff_channel/iff_code
 *   settings as activation params) and stops via "deactivate_effect". The
 *   authored Dogma data drives lifetime: duration attr 73 = 30,000 ms hold,
 *   moduleReactivationDelay 669 = 30,000 ms.
 * - iffMapService.get_visible_beacons() rows: {beacon_id, type_id, position,
 *   is_mine, transponder_channel, transponder_code}.
 * - iffMapService.set_transponder(item_id, channel, code) configures a
 *   cairn/module transponder; the client then refetches, and the server also
 *   pushes OnIffMapChanged / OnIffVerdicts.
 *
 * Server model:
 * - Transponder configuration and broadcast state persist on the transponder
 *   module item's customInfo under "evejsFrontierIff"
 *   ({channel, code, active}). Keeping these separate lets the client's live
 *   reconfigure call update an inactive module without implicitly activating
 *   it, while deactivation preserves the locally selected mode.
 * - Active beacons are in-memory runtime state only (30 s lifetime): entries
 *   validate live ship/scene and authoritative Creation power state on every
 *   read. Structural invalidation (unfit/destroyed/jumped) releases a beacon;
 *   reversible hull/module power loss suspends visibility and immobilization
 *   so the remaining authored cycle can resume if authority returns.
 * - Beacon immobilization registers an activeModuleEffects entry carrying
 *   immobilizesShip (the same authority bastion-style modules use) and is
 *   released on expiry, deactivation, or entity teardown; release is also
 *   attempted defensively on every sweep.
 *
 * Emulator interpretation (documented, not client-recoverable): the "tribe"
 * channel matches pilots of the same corporation. Mutual-channel visibility
 * follows IFF_MUTUAL_CHANNELS = {tribe, code}; "public" beacons are visible
 * to every pilot in the system.
 */
const crypto = require("crypto");
const path = require("path");
const log = require(path.join(__dirname, "../../utils/logger"));
const { findItemById, updateInventoryItem, } = require(path.join(__dirname, "../inventory/itemStore"));
const { getCreationModule } = require(path.join(__dirname, "./creationStaticData"));
const { getTypeAttributeValue, } = require(path.join(__dirname, "../fitting/liveFittingState"));
const npcFactionConfig = require(path.join(__dirname, "../../config/npcFactionConfig"));
const IFF_INFO_KEY = "evejsFrontierIff";
const IFF_CODE_MAX_LENGTH = 32;
const IFF_CHANNEL_TRIBE = "tribe";
const IFF_CHANNEL_CODE = "code";
const IFF_CHANNEL_PUBLIC = "public";
const IFF_TRANSPONDER_CHANNELS = Object.freeze([
    IFF_CHANNEL_TRIBE,
    IFF_CHANNEL_CODE,
]);
const IFF_BEACON_CHANNELS = Object.freeze([
    IFF_CHANNEL_TRIBE,
    IFF_CHANNEL_CODE,
    IFF_CHANNEL_PUBLIC,
]);
const IFF_BEHAVIOR_NAME = "iff";
const IFF_BEACON_BEHAVIOR_NAME = "iff_beacon";
const DEFAULT_BEACON_DURATION_MS = 30000;
// beaconID (module itemID) -> beacon runtime state
const activeBeacons = new Map();
const npcTransponderCache = new WeakMap();
function toInt(value, fallback = 0) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? Math.trunc(numeric) : fallback;
}
function toFiniteNumber(value, fallback = 0) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : fallback;
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
function isIffModuleType(typeID) {
    const module = getCreationModule(typeID);
    return Boolean(module && module.behavior === IFF_BEHAVIOR_NAME);
}
function isIffBeaconModuleType(typeID) {
    const module = getCreationModule(typeID);
    return Boolean(module && module.behavior === IFF_BEACON_BEHAVIOR_NAME);
}
function normalizeIffChannel(value, allowedChannels) {
    if (value === null || value === undefined || value === "") {
        return null;
    }
    const channel = String(value).trim().toLowerCase();
    return allowedChannels.includes(channel) ? channel : undefined;
}
function normalizeIffCode(value) {
    const code = String(value ?? "").trim();
    if (code.length === 0) {
        return null;
    }
    return code.length <= IFF_CODE_MAX_LENGTH ? code : undefined;
}
function normalizeNpcCodePart(value) {
    return String(value == null ? "" : value)
        .trim()
        .toUpperCase()
        .replace(/[^A-Z0-9_-]+/g, "-")
        .replace(/^-+|-+$/g, "");
}
/**
 * Build the client-sized code broadcast by an NPC group. Short authored
 * group identities stay human-readable; long catalog IDs receive a stable
 * digest suffix so codes remain deterministic and never exceed the client's
 * 32-character limit.
 */
function buildNpcTransponderCode(signal, groupIdentity) {
    const normalizedSignal = normalizeNpcCodePart(signal) || "NPC";
    const normalizedGroup = normalizeNpcCodePart(groupIdentity) || "UNKNOWN";
    const readable = `${normalizedSignal}:${normalizedGroup}`;
    if (readable.length <= IFF_CODE_MAX_LENGTH) {
        return readable;
    }
    const digest = crypto
        .createHash("sha256")
        .update(String(groupIdentity || "unknown"))
        .digest("hex")
        .slice(0, 8)
        .toUpperCase();
    const groupBudget = Math.max(1, IFF_CODE_MAX_LENGTH - normalizedSignal.length - digest.length - 2);
    const signalBudget = IFF_CODE_MAX_LENGTH - groupBudget - digest.length - 2;
    return `${normalizedSignal.slice(0, signalBudget)}:` +
        `${normalizedGroup.slice(0, groupBudget)}-${digest}`;
}
/**
 * Native NPC ships always broadcast a code-channel transponder. The faction
 * config supplies the signal namespace while the ordered group policy picks
 * the stable spawn-group/profile/faction identity used for the code.
 */
function resolveNpcTransponder(entity) {
    const configuration = npcFactionConfig.resolveNpcTransponderConfiguration(entity);
    if (!configuration) {
        return null;
    }
    const fingerprint = [
        configuration.channel,
        configuration.signal,
        configuration.groupIdentity,
        String(entity && entity.npcTransponderCode || ""),
    ].join("\u0000");
    if (entity && typeof entity === "object") {
        const cached = npcTransponderCache.get(entity);
        if (cached && cached.fingerprint === fingerprint) {
            return cached.transponder;
        }
    }
    const explicitCode = normalizeIffCode(entity && entity.npcTransponderCode);
    const code = explicitCode || buildNpcTransponderCode(configuration.signal, configuration.groupIdentity);
    const transponder = {
        channel: configuration.channel,
        code,
        signal: configuration.signal,
        groupIdentity: configuration.groupIdentity,
        source: "npc-group",
    };
    if (entity && typeof entity === "object") {
        npcTransponderCache.set(entity, { fingerprint, transponder });
    }
    return transponder;
}
function resolveEntityTransponder(entity, options = {}) {
    if (!entity || typeof entity !== "object") {
        return null;
    }
    const explicit = entity.iffTransponder || entity.transponder;
    if (explicit && typeof explicit === "object") {
        const channel = normalizeIffChannel(explicit.channel, IFF_TRANSPONDER_CHANNELS);
        if (channel === IFF_CHANNEL_CODE) {
            const code = normalizeIffCode(explicit.code);
            if (code) {
                return { channel, code, source: "entity" };
            }
        }
        else if (channel === IFF_CHANNEL_TRIBE) {
            return { channel, code: null, source: "entity" };
        }
    }
    if (entity.nativeNpc === true || entity.nativeNpcOccupied === true) {
        return resolveNpcTransponder(entity);
    }
    const characterID = toInt(entity.characterID ||
        entity.pilotCharacterID ||
        entity.session && (entity.session.charid || entity.session.characterID) ||
        entity.ownerID, 0);
    const shipID = toInt(entity.itemID || entity.shipID, 0);
    const resolver = typeof options.resolveActiveTransponder === "function"
        ? options.resolveActiveTransponder
        : resolveActiveTransponder;
    return characterID > 0 && shipID > 0
        ? resolver(characterID, shipID)
        : null;
}
function transpondersMatch(left, right, leftEntity = null, rightEntity = null) {
    if (!left || !right || left.channel !== right.channel) {
        return false;
    }
    if (left.channel === IFF_CHANNEL_CODE) {
        return Boolean(left.code) && left.code === right.code;
    }
    if (left.channel === IFF_CHANNEL_TRIBE) {
        const leftCorporationID = toInt(leftEntity && (leftEntity.corporationID || leftEntity.ownerID), 0);
        const rightCorporationID = toInt(rightEntity && (rightEntity.corporationID || rightEntity.ownerID), 0);
        return leftCorporationID > 0 && leftCorporationID === rightCorporationID;
    }
    return false;
}
/**
 * Validate a channel/code pair the way the client authors it: code is only
 * meaningful (and required) on the "code" channel.
 * Returns { channel, code } | { errorMsg }.
 */
function normalizeIffConfiguration(rawChannel, rawCode, allowedChannels) {
    const channel = normalizeIffChannel(rawChannel, allowedChannels);
    if (channel === undefined) {
        return { errorMsg: "IFF_CHANNEL_INVALID" };
    }
    if (channel === null) {
        return { channel: null, code: null };
    }
    if (channel === IFF_CHANNEL_CODE) {
        const code = normalizeIffCode(rawCode);
        if (code === undefined) {
            return { errorMsg: "IFF_CODE_TOO_LONG" };
        }
        if (code === null) {
            return { errorMsg: "IFF_CODE_REQUIRED" };
        }
        return { channel, code };
    }
    return { channel, code: null };
}
function readTransponderState(moduleItem) {
    const info = parseCustomInfo(moduleItem && moduleItem.customInfo);
    const raw = info[IFF_INFO_KEY];
    const state = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
    const channel = normalizeIffChannel(state.channel, IFF_TRANSPONDER_CHANNELS);
    return {
        channel: channel === undefined ? null : channel,
        code: typeof state.code === "string" && state.code.length <= IFF_CODE_MAX_LENGTH
            ? state.code
            : null,
        active: state.active === true,
    };
}
function writeTransponderState(moduleItemID, state) {
    return updateInventoryItem(moduleItemID, (currentItem) => {
        const info = parseCustomInfo(currentItem.customInfo);
        const previous = info[IFF_INFO_KEY];
        const previousState = previous && typeof previous === "object" && !Array.isArray(previous)
            ? previous
            : {};
        if (state && state.channel) {
            info[IFF_INFO_KEY] = {
                channel: state.channel,
                ...(state.code ? { code: state.code } : {}),
                active: Object.prototype.hasOwnProperty.call(state, "active")
                    ? state.active === true
                    : previousState.active === true,
            };
        }
        else {
            delete info[IFF_INFO_KEY];
        }
        return {
            ...currentItem,
            customInfo: JSON.stringify(info),
        };
    });
}
function setTransponderBroadcastState(moduleItemID, active, configuration = null) {
    const moduleItem = findItemById(toInt(moduleItemID, 0));
    if (!moduleItem || !isIffModuleType(moduleItem.typeID)) {
        return { success: false, errorMsg: "IFF_TRANSPONDER_NOT_FOUND" };
    }
    const current = readTransponderState(moduleItem);
    const next = configuration && typeof configuration === "object"
        ? configuration
        : current;
    if (active === true && !next.channel) {
        return { success: false, errorMsg: "IFF_CHANNEL_REQUIRED" };
    }
    if (!next.channel) {
        return { success: true, data: { state: current } };
    }
    const result = writeTransponderState(moduleItemID, {
        channel: next.channel,
        code: next.code || null,
        active: active === true,
    });
    if (!result || result.success !== true) {
        return result || { success: false, errorMsg: "IFF_WRITE_FAILED" };
    }
    return {
        success: true,
        data: {
            state: readTransponderState(findItemById(toInt(moduleItemID, 0))),
        },
    };
}
function resolveBeaconDurationMs(typeID) {
    const duration = toFiniteNumber(getTypeAttributeValue(typeID, "duration"), 0);
    return duration > 0 ? duration : DEFAULT_BEACON_DURATION_MS;
}
/**
 * The viewer's active transponder: an online behavior-"iff" module fitted to
 * their active Creation with a configured, broadcasting channel. Reading live
 * item state keeps this correct across relog and refits without extra
 * bookkeeping.
 */
function resolveActiveTransponder(characterID, shipID, options = {}) {
    const readState = typeof options.readCreationState === "function"
        ? options.readCreationState
        : require(path.join(__dirname, "./creationRuntime")).readCreationState;
    const isModuleOnline = typeof options.isCreationModuleOnline === "function"
        ? options.isCreationModuleOnline
        : require(path.join(__dirname, "./creationRuntime")).isCreationModuleOnline;
    const shipItem = findItemById(toInt(shipID, 0));
    if (!shipItem || toInt(shipItem.ownerID, 0) !== toInt(characterID, 0)) {
        return null;
    }
    const state = readState(shipItem);
    if (!state ||
        state.poweredOff === true ||
        !Array.isArray(state.modules)) {
        return null;
    }
    for (const moduleEntry of state.modules) {
        if (!isIffModuleType(moduleEntry.typeID)) {
            continue;
        }
        const moduleItem = findItemById(toInt(moduleEntry.itemID, 0));
        if (!moduleItem ||
            toInt(moduleItem.locationID, 0) !== toInt(shipItem.itemID, 0) ||
            !isModuleOnline(moduleItem)) {
            continue;
        }
        const transponder = readTransponderState(moduleItem);
        if (transponder.active && transponder.channel) {
            return {
                moduleItemID: toInt(moduleItem.itemID, 0),
                channel: transponder.channel,
                code: transponder.code,
            };
        }
    }
    return null;
}
/**
 * Resolve the two independent parts of beacon liveness. A terminal failure
 * means the beacon can never resume (the module was removed, the hull left
 * the scene, or the authored duration elapsed). A reversible authority
 * failure means the fitted module or its Creation hull is powered down.
 */
function resolveBeaconAvailability(beacon, nowMs = Date.now(), options = {}) {
    if (!beacon || toFiniteNumber(beacon.expiresAtMs, 0) <= nowMs) {
        return { live: false, terminal: true, reason: "expired" };
    }
    const shipItem = findItemById(toInt(beacon.shipID, 0));
    if (!shipItem ||
        toInt(shipItem.locationID, 0) !== toInt(beacon.solarSystemID, 0) ||
        !shipItem.spaceState) {
        return { live: false, terminal: true, reason: "ship-transition" };
    }
    const moduleItem = findItemById(toInt(beacon.beaconID, 0));
    if (!moduleItem ||
        toInt(moduleItem.locationID, 0) !== toInt(beacon.shipID, 0) ||
        !isIffBeaconModuleType(moduleItem.typeID)) {
        return { live: false, terminal: true, reason: "module-removed" };
    }
    const creationRuntime = options.creationRuntime || require(path.join(__dirname, "./creationRuntime"));
    const readState = typeof options.readCreationState === "function"
        ? options.readCreationState
        : creationRuntime.readCreationState;
    const isModuleOnline = typeof options.isCreationModuleOnline === "function"
        ? options.isCreationModuleOnline
        : creationRuntime.isCreationModuleOnline;
    const state = readState(shipItem);
    const fitted = state && Array.isArray(state.modules)
        ? state.modules.some((entry) => toInt(entry && entry.itemID, 0) === toInt(beacon.beaconID, 0) &&
            toInt(entry && entry.typeID, 0) === toInt(moduleItem.typeID, 0))
        : false;
    if (!fitted) {
        return { live: false, terminal: true, reason: "module-removed" };
    }
    if (state.poweredOff === true) {
        return { live: false, terminal: false, reason: "creation-powered-off" };
    }
    if (!isModuleOnline(moduleItem)) {
        return { live: false, terminal: false, reason: "module-offline" };
    }
    return {
        live: true,
        terminal: false,
        reason: beacon.suspended === true ? "authority-restored" : "authorized",
    };
}
function pruneExpiredBeacons(nowMs = Date.now()) {
    for (const [beaconID, beacon] of activeBeacons) {
        if (!beacon || beacon.expiresAtMs <= nowMs) {
            releaseBeacon(beaconID, "expired");
        }
    }
}
function releaseBeacon(beaconID, reason) {
    const beacon = activeBeacons.get(toInt(beaconID, 0));
    if (!beacon) {
        return false;
    }
    activeBeacons.delete(toInt(beaconID, 0));
    try {
        if (typeof beacon.releaseImmobilizer === "function") {
            beacon.releaseImmobilizer(reason);
        }
    }
    catch (error) {
        log.warn(`[iff] beacon immobilizer release failed beacon=${beaconID} ` +
            `reason=${reason}: ${error && error.message ? error.message : error}`);
    }
    try {
        if (typeof beacon.notifyMapChanged === "function") {
            beacon.notifyMapChanged(reason);
        }
    }
    catch (_) {
        // Notification failures must never block cleanup.
    }
    log.info(`[iff] beacon released beacon=${beaconID} ship=${beacon.shipID} reason=${reason}`);
    return true;
}
function suspendBeacon(beaconID, reason = "authority-unavailable") {
    const beacon = activeBeacons.get(toInt(beaconID, 0));
    if (!beacon) {
        return false;
    }
    if (beacon.suspended === true) {
        return true;
    }
    beacon.suspended = true;
    beacon.suspendedAtMs = Date.now();
    beacon.suspendReason = String(reason || "authority-unavailable");
    try {
        if (typeof beacon.releaseImmobilizer === "function") {
            beacon.releaseImmobilizer(beacon.suspendReason);
        }
    }
    catch (error) {
        log.warn(`[iff] beacon suspend failed beacon=${beaconID} ` +
            `reason=${beacon.suspendReason}: ${error && error.message ? error.message : error}`);
    }
    try {
        if (typeof beacon.notifyMapChanged === "function") {
            beacon.notifyMapChanged(beacon.suspendReason);
        }
    }
    catch (_) {
        // Presentation failure cannot restore authority that has been removed.
    }
    return true;
}
function resumeBeacon(beaconID, reason = "authority-restored") {
    const beacon = activeBeacons.get(toInt(beaconID, 0));
    if (!beacon) {
        return false;
    }
    if (beacon.suspended !== true) {
        return true;
    }
    try {
        if (typeof beacon.resumeImmobilizer === "function") {
            const result = beacon.resumeImmobilizer(reason);
            if (result && result.success === false) {
                return false;
            }
        }
    }
    catch (error) {
        log.warn(`[iff] beacon resume failed beacon=${beaconID} ` +
            `reason=${reason}: ${error && error.message ? error.message : error}`);
        return false;
    }
    beacon.suspended = false;
    beacon.suspendedAtMs = 0;
    beacon.suspendReason = null;
    try {
        if (typeof beacon.notifyMapChanged === "function") {
            beacon.notifyMapChanged(reason);
        }
    }
    catch (_) {
        // Runtime authority is already restored; UI cache refresh is best effort.
    }
    return true;
}
/**
 * A beacon entry is only visible while its live state still holds: the ship
 * exists, is still in the beacon's solar system, is not docked, and the
 * beacon module is still fitted to it. This makes docking, jumps, ship
 * changes, destruction, and reconnects self-cleaning.
 */
function isBeaconLive(beacon, nowMs = Date.now()) {
    return resolveBeaconAvailability(beacon, nowMs).live === true;
}
function startBeacon({ beaconID, moduleTypeID, shipID, characterID, corporationID, solarSystemID, position, channel, code, durationMs, releaseImmobilizer, resumeImmobilizer, notifyMapChanged, nowMs = Date.now(), }) {
    pruneExpiredBeacons(nowMs);
    const numericBeaconID = toInt(beaconID, 0);
    const existing = activeBeacons.get(numericBeaconID);
    if (existing && isBeaconLive(existing, nowMs)) {
        return { success: false, errorMsg: "BEACON_ALREADY_ACTIVE" };
    }
    const reactivationDelayMs = toFiniteNumber(getTypeAttributeValue(toInt(moduleTypeID, 0), "moduleReactivationDelay"), 0);
    if (existing &&
        reactivationDelayMs > 0 &&
        nowMs - toFiniteNumber(existing.startedAtMs, 0) < reactivationDelayMs) {
        return { success: false, errorMsg: "BEACON_REACTIVATION_DELAY" };
    }
    const beacon = {
        beaconID: numericBeaconID,
        typeID: toInt(moduleTypeID, 0),
        shipID: toInt(shipID, 0),
        characterID: toInt(characterID, 0),
        corporationID: toInt(corporationID, 0),
        solarSystemID: toInt(solarSystemID, 0),
        position: Array.isArray(position) ? position : null,
        channel,
        code: code || null,
        startedAtMs: nowMs,
        expiresAtMs: nowMs + Math.max(1000, toFiniteNumber(durationMs, DEFAULT_BEACON_DURATION_MS)),
        releaseImmobilizer: typeof releaseImmobilizer === "function"
            ? releaseImmobilizer
            : null,
        resumeImmobilizer: typeof resumeImmobilizer === "function"
            ? resumeImmobilizer
            : null,
        notifyMapChanged: typeof notifyMapChanged === "function"
            ? notifyMapChanged
            : null,
        suspended: false,
        suspendedAtMs: 0,
        suspendReason: null,
    };
    activeBeacons.set(numericBeaconID, beacon);
    const holdMs = beacon.expiresAtMs - nowMs;
    const expiryTimer = setTimeout(() => {
        releaseBeacon(numericBeaconID, "expired");
    }, holdMs + 25);
    if (typeof expiryTimer.unref === "function") {
        expiryTimer.unref();
    }
    log.info(`[iff] beacon started beacon=${numericBeaconID} ship=${beacon.shipID} ` +
        `system=${beacon.solarSystemID} channel=${channel} durationMs=${holdMs}`);
    return { success: true, data: { beacon } };
}
function stopBeacon(beaconID, reason = "deactivated") {
    pruneExpiredBeacons();
    if (!activeBeacons.has(toInt(beaconID, 0))) {
        return { success: false, errorMsg: "BEACON_NOT_ACTIVE" };
    }
    releaseBeacon(toInt(beaconID, 0), reason);
    return { success: true, data: {} };
}
function clearBeaconsForShip(shipID, reason = "ship-transition") {
    for (const [beaconID, beacon] of [...activeBeacons]) {
        if (beacon && beacon.shipID === toInt(shipID, 0)) {
            releaseBeacon(beaconID, reason);
        }
    }
}
function clearBeaconsForCharacter(characterID, reason = "session-transition") {
    for (const [beaconID, beacon] of [...activeBeacons]) {
        if (beacon && beacon.characterID === toInt(characterID, 0)) {
            releaseBeacon(beaconID, reason);
        }
    }
}
function reconcileBeaconsForCreation(shipID, reason = "creation-state-change", nowMs = Date.now()) {
    const numericShipID = toInt(shipID, 0);
    const result = {
        released: 0,
        resumed: 0,
        suspended: 0,
        solarSystemIDs: new Set(),
    };
    if (numericShipID <= 0) {
        return result;
    }
    for (const [beaconID, beacon] of [...activeBeacons]) {
        if (!beacon || toInt(beacon.shipID, 0) !== numericShipID) {
            continue;
        }
        const solarSystemID = toInt(beacon.solarSystemID, 0);
        if (solarSystemID > 0) {
            result.solarSystemIDs.add(solarSystemID);
        }
        const availability = resolveBeaconAvailability(beacon, nowMs);
        if (availability.terminal) {
            if (releaseBeacon(beaconID, availability.reason || reason)) {
                result.released += 1;
            }
            continue;
        }
        if (!availability.live) {
            if (beacon.suspended !== true && suspendBeacon(beaconID, availability.reason || reason)) {
                result.suspended += 1;
            }
            continue;
        }
        if (beacon.suspended === true && resumeBeacon(beaconID, reason)) {
            result.resumed += 1;
        }
    }
    return result;
}
/**
 * Matching rule: own beacons are always listed (is_mine). Others require the
 * same solar system plus channel agreement — "public" is visible to every
 * pilot in the system; "tribe" requires the viewer's active transponder on
 * tribe and the same corporation; "code" requires the viewer's transponder
 * on code with the exact same code string.
 */
function beaconVisibleToViewer(beacon, viewer) {
    if (!beacon || beacon.suspended === true) {
        return false;
    }
    if (beacon.characterID === toInt(viewer.characterID, 0)) {
        return true;
    }
    if (beacon.solarSystemID !== toInt(viewer.solarSystemID, 0)) {
        return false;
    }
    if (beacon.channel === IFF_CHANNEL_PUBLIC) {
        return true;
    }
    const transponder = viewer.transponder;
    if (!transponder || !transponder.channel) {
        return false;
    }
    if (beacon.channel === IFF_CHANNEL_TRIBE) {
        return (transponder.channel === IFF_CHANNEL_TRIBE &&
            toInt(viewer.corporationID, 0) > 0 &&
            toInt(viewer.corporationID, 0) === beacon.corporationID);
    }
    if (beacon.channel === IFF_CHANNEL_CODE) {
        return (transponder.channel === IFF_CHANNEL_CODE &&
            typeof transponder.code === "string" &&
            transponder.code.length > 0 &&
            transponder.code === beacon.code);
    }
    return false;
}
function listVisibleBeacons(viewer, nowMs = Date.now()) {
    pruneExpiredBeacons(nowMs);
    const rows = [];
    for (const beacon of [...activeBeacons.values()]) {
        const availability = resolveBeaconAvailability(beacon, nowMs);
        if (availability.terminal) {
            releaseBeacon(beacon.beaconID, availability.reason || "stale");
            continue;
        }
        if (!availability.live) {
            suspendBeacon(beacon.beaconID, availability.reason);
            continue;
        }
        if (beacon.suspended === true && !resumeBeacon(beacon.beaconID, "authority-restored")) {
            continue;
        }
        if (!beaconVisibleToViewer(beacon, viewer)) {
            continue;
        }
        rows.push({
            beacon_id: beacon.beaconID,
            type_id: beacon.typeID,
            position: beacon.position,
            is_mine: beacon.characterID === toInt(viewer.characterID, 0),
            transponder_channel: beacon.channel,
            transponder_code: beacon.code,
        });
    }
    return rows;
}
function getActiveBeacon(beaconID) {
    return activeBeacons.get(toInt(beaconID, 0)) || null;
}
function resetIffRuntimeForTests() {
    for (const beaconID of [...activeBeacons.keys()]) {
        releaseBeacon(beaconID, "test-reset");
    }
    activeBeacons.clear();
}
module.exports = {
    IFF_BEACON_BEHAVIOR_NAME,
    IFF_BEACON_CHANNELS,
    IFF_BEHAVIOR_NAME,
    IFF_CHANNEL_CODE,
    IFF_CHANNEL_PUBLIC,
    IFF_CHANNEL_TRIBE,
    IFF_CODE_MAX_LENGTH,
    IFF_INFO_KEY,
    IFF_TRANSPONDER_CHANNELS,
    beaconVisibleToViewer,
    buildNpcTransponderCode,
    clearBeaconsForCharacter,
    clearBeaconsForShip,
    getActiveBeacon,
    isBeaconLive,
    isIffBeaconModuleType,
    isIffModuleType,
    listVisibleBeacons,
    normalizeIffConfiguration,
    pruneExpiredBeacons,
    readTransponderState,
    reconcileBeaconsForCreation,
    resolveBeaconAvailability,
    resolveActiveTransponder,
    resolveBeaconDurationMs,
    resolveEntityTransponder,
    resolveNpcTransponder,
    resetIffRuntimeForTests,
    setTransponderBroadcastState,
    startBeacon,
    stopBeacon,
    suspendBeacon,
    resumeBeacon,
    transpondersMatch,
    writeTransponderState,
};
//# sourceMappingURL=iffRuntime.js.map