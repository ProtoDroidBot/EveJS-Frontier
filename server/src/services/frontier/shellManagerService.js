"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const BaseService = require("../baseService");
const log = require("../../utils/logger");
const { throwWrappedUserError } = require("../../common/machoErrors");
const { buildDict, buildList, unwrapMarshalValue, } = require("../_shared/serviceHelpers");
const { syncInventoryItemForSession, } = require("../character/characterState");
const { ITEM_FLAGS, findItemById, grantItemToCharacterLocation, updateInventoryItem, } = require("../inventory/itemStore");
const environmentalEffects = require("./environmentalEffectsService");
const shellEquipment = require("./shellEquipmentRuntime");
const { DEFAULT_SHELL_TYPE_ID, SHELL_CATEGORY_ID } = shellEquipment;
// frontier/character/client/shell/integration.pyc, _change_shell_name().
const MAX_SHELL_NAME_LENGTH = 100;
const UNSUPPORTED_SHELL_MUTATION_NOTIFY = "Shell implants and ascension mutations are not available yet.";
function getSessionCharacterID(session) {
    return Number(session && (session.characterID || session.charid)) || 0;
}
const { listOwnedShells } = shellEquipment;
function buildShellDbData(item) {
    if (!item) {
        return null;
    }
    const implantTypeIDs = shellEquipment
        .listShellEquipment(Number(item.ownerID), Number(item.itemID))
        .filter((equipmentItem) => shellEquipment.getShellEquipmentKind(equipmentItem) ===
        shellEquipment.SHELL_EQUIPMENT_KIND.IMPLANT)
        .map((equipmentItem) => Number(equipmentItem.typeID));
    return buildDict([
        ["shellID", Number(item.itemID)],
        ["shellUniqueID", String(item.itemID)],
        ["shellName", String(item.itemName || "Blank Shell")],
        ["shellCrownID", null],
        ["implants", buildList(implantTypeIDs)],
    ]);
}
function throwShellNotify(notify) {
    throwWrappedUserError("CustomNotify", {
        notify: String(notify || UNSUPPORTED_SHELL_MUTATION_NOTIFY),
    });
}
function throwShellEquipmentError(errorMsg, kind = "equipment") {
    const label = kind === shellEquipment.SHELL_EQUIPMENT_KIND.RAIMENT
        ? "raiment"
        : "implant";
    const notifyByError = {
        SHELL_NOT_FOUND: "No active shell is available.",
        ITEM_NOT_FOUND: `That ${label} no longer exists.`,
        ITEM_NOT_OWNED: `You do not own that ${label}.`,
        CROWN_UNSUPPORTED: "Crowns are not supported as shell equipment yet.",
        INVALID_EQUIPMENT_TYPE: `That item is not a shell ${label}.`,
        ALREADY_EQUIPPED: `That ${label} is already equipped.`,
        EQUIPPED_ON_ANOTHER_SHELL: `That ${label} is equipped on another shell.`,
        SLOT_OCCUPIED: `This shell already has a ${label} equipped.`,
        EQUIPMENT_NOT_FOUND: `This shell has no ${label} equipped.`,
    };
    throwShellNotify(notifyByError[String(errorMsg)] || `The ${label} could not be changed.`);
}
function syncShellEquipmentChanges(session, changes) {
    for (const change of Array.isArray(changes) ? changes : []) {
        if (!change || !change.item) {
            continue;
        }
        syncInventoryItemForSession(session, change.item, change.previousData || change.previousState || {}, { emitCfgLocation: false });
    }
}
function refreshSessionShellDogma(session, reason) {
    const systemID = Number(session && session._space && session._space.systemID) || 0;
    if (systemID <= 0) {
        return;
    }
    try {
        const spaceRuntime = require("../../space/runtime");
        const scene = spaceRuntime.ensureScene(systemID);
        if (scene && typeof scene.refreshSessionShipDerivedState === "function") {
            scene.refreshSessionShipDerivedState(session, {
                notify: true,
                reason: String(reason || "shell-equipment-change"),
            });
        }
    }
    catch (error) {
        log.warn(`[shellManager] Failed to refresh shell dogma char=${getSessionCharacterID(session)} error=${error.message}`);
    }
}
function equipShellItem(session, rawItemID, kind) {
    const result = shellEquipment.equipActiveShellItem(getSessionCharacterID(session), Number(unwrapMarshalValue(rawItemID)), kind);
    if (!result || result.success !== true) {
        return throwShellEquipmentError(result && result.errorMsg, kind);
    }
    syncShellEquipmentChanges(session, result.data.changes);
    refreshSessionShellDogma(session, `shell-${kind}-equipped`);
    log.info(`[shellManager] Equipped ${kind}=${Number(result.data.item && result.data.item.itemID)} shell=${Number(result.data.shell.itemID)} char=${getSessionCharacterID(session)}`);
    return true;
}
function destroyActiveShellItem(session, kind) {
    const result = shellEquipment.destroyActiveShellEquipmentByKind(getSessionCharacterID(session), kind);
    if (!result || result.success !== true) {
        return throwShellEquipmentError(result && result.errorMsg, kind);
    }
    syncShellEquipmentChanges(session, result.data.changes);
    refreshSessionShellDogma(session, `shell-${kind}-destroyed`);
    log.info(`[shellManager] Destroyed ${kind}=${Number(result.data.item && result.data.item.itemID)} shell=${Number(result.data.shell.itemID)} char=${getSessionCharacterID(session)}`);
    return true;
}
function normalizeShellName(value) {
    const unwrapped = unwrapMarshalValue(value);
    if (typeof unwrapped !== "string" || unwrapped.trim().length === 0) {
        throwShellNotify("Enter a name for this shell.");
    }
    if ([...unwrapped].length > MAX_SHELL_NAME_LENGTH) {
        throwShellNotify(`Shell names may contain at most ${MAX_SHELL_NAME_LENGTH} characters.`);
    }
    return unwrapped;
}
function renameOwnedShell(session, shellID, rawName) {
    const characterID = getSessionCharacterID(session);
    const item = findItemById(Number(shellID));
    if (characterID <= 0 ||
        !item ||
        Number(item.ownerID) !== characterID ||
        !shellEquipment.isShellItem(item)) {
        throwShellNotify("You do not own this shell.");
    }
    const shellName = normalizeShellName(rawName);
    const update = updateInventoryItem(item.itemID, (current) => ({
        ...current,
        itemName: shellName,
    }));
    if (!update || update.success !== true) {
        throwShellNotify("The shell name could not be saved.");
    }
    syncInventoryItemForSession(session, update.data, update.previousData || {}, { emitCfgLocation: false });
    if (session && typeof session.sendNotification === "function") {
        session.sendNotification("OnShellChangedName", "charid", [
            Number(update.data.itemID),
            shellName,
        ]);
    }
    log.info(`[shellManager] Renamed shell=${Number(update.data.itemID)} char=${characterID}`);
    return true;
}
function ensureActiveShell(session) {
    const characterID = getSessionCharacterID(session);
    const existing = listOwnedShells(characterID)[0] || null;
    if (existing) {
        return existing;
    }
    if (characterID <= 0) {
        return null;
    }
    const grant = grantItemToCharacterLocation(characterID, characterID, ITEM_FLAGS.HANGAR, DEFAULT_SHELL_TYPE_ID, 1, {
        individualItems: true,
        itemName: "Blank Shell",
        singleton: 1,
    });
    if (!grant || grant.success !== true) {
        log.warn(`[shellManager] Failed to provision active shell for char=${characterID} ` +
            `reason=${grant && grant.errorMsg || "UNKNOWN"}`);
        return null;
    }
    const item = grant.data && Array.isArray(grant.data.items)
        ? grant.data.items[0] || null
        : null;
    const change = grant.data && Array.isArray(grant.data.changes)
        ? grant.data.changes[0] || null
        : null;
    if (item) {
        syncInventoryItemForSession(session, item, change && change.previousState ? change.previousState : {}, { emitCfgLocation: false });
        log.info(`[shellManager] Provisioned Blank Shell item=${item.itemID} for char=${characterID}`);
    }
    return item;
}
class ShellManagerService extends BaseService {
    constructor() {
        super("shellManager");
    }
    Handle_get_active_shell_db_data(_args, session) {
        return buildShellDbData(ensureActiveShell(session));
    }
    Handle_get_medical_trait_shell_points(_args, session) {
        const characterID = getSessionCharacterID(session);
        if (characterID <= 0) {
            return [0, 0];
        }
        const state = environmentalEffects.snapshotCharacterState(characterID);
        return [
            Math.round(state.vitalityDamage),
            Math.round(state.vitalityCapacity),
        ];
    }
    Handle_get_medical_trait_breakdown() {
        return buildList([]);
    }
    Handle_get_last_crown_created_time() {
        return null;
    }
    Handle_get_shells_db_data_basic(args, session) {
        const requested = args && Array.isArray(args[0])
            ? new Set(args[0].map((value) => Number(value)))
            : null;
        const entries = listOwnedShells(getSessionCharacterID(session))
            .filter((item) => !requested || requested.has(Number(item.itemID)))
            .map((item) => [Number(item.itemID), buildShellDbData(item)]);
        return buildDict(entries);
    }
    Handle_get_active_implant(_args, session) {
        const implant = shellEquipment.getActiveShellEquipmentByKind(getSessionCharacterID(session), shellEquipment.SHELL_EQUIPMENT_KIND.IMPLANT);
        return implant
            ? buildDict([
                ["itemID", Number(implant.itemID)],
                ["typeID", Number(implant.typeID)],
            ])
            : null;
    }
    // Build 3474408 corrected the RPC spelling to `has_raiment`.  The client
    // assigns this result directly to a Boolean controller property, while its
    // OnRaimentImplanted path computes the same property with `id is not None`.
    // The Boolean response shape is observed by the client controller.
    Handle_has_raiment(_args, session) {
        return Boolean(shellEquipment.getActiveShellEquipmentByKind(getSessionCharacterID(session), shellEquipment.SHELL_EQUIPMENT_KIND.RAIMENT));
    }
    // Preserve the older Frontier spelling for clients that still call it.
    Handle_has_reignment(args, session) {
        return this.Handle_has_raiment(args, session);
    }
    Handle_set_active_shell_name(args, session) {
        const shell = ensureActiveShell(session);
        if (!shell) {
            throwShellNotify("No active shell is available.");
        }
        const values = unwrapMarshalValue(args);
        return renameOwnedShell(session, shell.itemID, values && values[0]);
    }
    Handle_set_shell_name(args, session) {
        const values = unwrapMarshalValue(args);
        return renameOwnedShell(session, values && values[0], values && values[1]);
    }
    _rejectUnsupportedMutation(methodName) {
        log.debug(`[shellManager] ${methodName} rejected: progression mutation unavailable`);
        throwShellNotify(UNSUPPORTED_SHELL_MUTATION_NOTIFY);
    }
    Handle_create_crown() {
        return this._rejectUnsupportedMutation("create_crown");
    }
    Handle_implant_crown() {
        return this._rejectUnsupportedMutation("implant_crown");
    }
    Handle_delete_active_crown() {
        return this._rejectUnsupportedMutation("delete_active_crown");
    }
    Handle_implant_implant(args, session) {
        const values = unwrapMarshalValue(args);
        return equipShellItem(session, values && values[0], shellEquipment.SHELL_EQUIPMENT_KIND.IMPLANT);
    }
    Handle_delete_active_implant(_args, session) {
        return destroyActiveShellItem(session, shellEquipment.SHELL_EQUIPMENT_KIND.IMPLANT);
    }
    Handle_admin_create_and_implant_implant() {
        return this._rejectUnsupportedMutation("admin_create_and_implant_implant");
    }
    Handle_admin_create_crown_without_cooldown() {
        return this._rejectUnsupportedMutation("admin_create_crown_without_cooldown");
    }
    Handle_clear_medical_trait_implants() {
        return this._rejectUnsupportedMutation("clear_medical_trait_implants");
    }
    Handle_admin_grant_medical_trait_implant() {
        return this._rejectUnsupportedMutation("admin_grant_medical_trait_implant");
    }
    Handle_use_medical_kit() {
        return this._rejectUnsupportedMutation("use_medical_kit");
    }
    Handle_use_status_effect_remedy() {
        return this._rejectUnsupportedMutation("use_status_effect_remedy");
    }
    Handle_admin_add_reignment_to_inventory() {
        return this._rejectUnsupportedMutation("admin_add_reignment_to_inventory");
    }
    Handle_admin_add_medical_kit_to_inventory() {
        return this._rejectUnsupportedMutation("admin_add_medical_kit_to_inventory");
    }
    Handle_create_and_activate_shell() {
        return this._rejectUnsupportedMutation("create_and_activate_shell");
    }
    Handle_activate_shell() {
        return this._rejectUnsupportedMutation("activate_shell");
    }
}
module.exports = ShellManagerService;
module.exports._testing = {
    DEFAULT_SHELL_TYPE_ID,
    MAX_SHELL_NAME_LENGTH,
    SHELL_CATEGORY_ID,
    UNSUPPORTED_SHELL_MUTATION_NOTIFY,
    buildShellDbData,
    ensureActiveShell,
    listOwnedShells,
    normalizeShellName,
    renameOwnedShell,
    destroyActiveShellItem,
    equipShellItem,
    refreshSessionShellDogma,
    syncShellEquipmentChanges,
};
//# sourceMappingURL=shellManagerService.js.map