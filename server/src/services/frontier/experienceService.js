"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const BaseService = require("../baseService");
const log = require("../../utils/logger");
const { throwWrappedUserError } = require("../../common/machoErrors");
const { buildDict, buildKeyVal, buildList, unwrapMarshalValue, } = require("../_shared/serviceHelpers");
const { syncInventoryItemForSession, } = require("../character/characterState");
const shellEquipment = require("./shellEquipmentRuntime");
const PATHWAY_CATEGORY_IDS = Object.freeze([1, 2, 3, 4]);
const UNSUPPORTED_PROGRESSION_MUTATION_NOTIFY = "Memory cards and ascension mutations are not available yet.";
function getSessionCharacterID(session) {
    const characterID = Number(session && (session.characterID || session.charid || session.charID));
    return Number.isInteger(characterID) && characterID > 0 ? characterID : 0;
}
function buildEmptyCharacterExperience() {
    return buildDict([
        ["total_xp", 0],
        ["cap", 0],
        [
            "category_xp",
            buildDict(PATHWAY_CATEGORY_IDS.map((categoryID) => [String(categoryID), 0])),
        ],
    ]);
}
function buildEmptyCharacterProgression() {
    return buildList(PATHWAY_CATEGORY_IDS.map((categoryID) => buildKeyVal([
        ["categoryID", categoryID],
        ["points", 0],
    ])));
}
function buildEmptyMemories() {
    return buildDict([
        ["shell_memories", buildDict([])],
        ["crown_memories", buildDict([])],
    ]);
}
function buildEmptyMemoryPointTotals() {
    // ExperienceService.calculate_memory_point_totals() in client 3467658
    // creates this same int-keyed map from PathwayCategory enum values.
    return buildDict(PATHWAY_CATEGORY_IDS.map((categoryID) => [categoryID, 0]));
}
function throwUnsupportedProgressionMutation(methodName) {
    log.debug(`[experience] ${methodName} rejected: progression mutation unavailable`);
    throwWrappedUserError("CustomNotify", {
        notify: UNSUPPORTED_PROGRESSION_MUTATION_NOTIFY,
    });
}
function throwRaimentMutationError(errorMsg) {
    const notifyByError = {
        SHELL_NOT_FOUND: "No active shell is available.",
        ITEM_NOT_FOUND: "That raiment no longer exists.",
        ITEM_NOT_OWNED: "You do not own that raiment.",
        CROWN_UNSUPPORTED: "Crowns are not supported as shell equipment yet.",
        INVALID_EQUIPMENT_TYPE: "That item is not a shell raiment.",
        ALREADY_EQUIPPED: "That raiment is already equipped.",
        EQUIPPED_ON_ANOTHER_SHELL: "That raiment is equipped on another shell.",
        SLOT_OCCUPIED: "This shell already has a raiment equipped.",
        EQUIPMENT_NOT_FOUND: "This shell has no raiment equipped.",
    };
    throwWrappedUserError("CustomNotify", {
        notify: notifyByError[String(errorMsg)] || "The raiment could not be changed.",
    });
}
function syncRaimentChanges(session, changes) {
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
                reason: String(reason || "shell-raiment-change"),
            });
        }
    }
    catch (error) {
        log.warn(`[experience] Failed to refresh shell dogma char=${getSessionCharacterID(session)} error=${error.message}`);
    }
}
function implantRaiment(session, rawItemID) {
    const result = shellEquipment.equipActiveShellItem(getSessionCharacterID(session), Number(unwrapMarshalValue(rawItemID)), shellEquipment.SHELL_EQUIPMENT_KIND.RAIMENT);
    if (!result || result.success !== true) {
        return throwRaimentMutationError(result && result.errorMsg);
    }
    syncRaimentChanges(session, result.data.changes);
    refreshSessionShellDogma(session, "shell-raiment-equipped");
    log.info(`[experience] Equipped raiment=${Number(result.data.item && result.data.item.itemID)} shell=${Number(result.data.shell.itemID)} char=${getSessionCharacterID(session)}`);
    return true;
}
function deleteActiveRaiment(session) {
    const result = shellEquipment.destroyActiveShellEquipmentByKind(getSessionCharacterID(session), shellEquipment.SHELL_EQUIPMENT_KIND.RAIMENT);
    if (!result || result.success !== true) {
        return throwRaimentMutationError(result && result.errorMsg);
    }
    syncRaimentChanges(session, result.data.changes);
    refreshSessionShellDogma(session, "shell-raiment-destroyed");
    log.info(`[experience] Destroyed raiment=${Number(result.data.item && result.data.item.itemID)} shell=${Number(result.data.shell.itemID)} char=${getSessionCharacterID(session)}`);
    return true;
}
class ExperienceService extends BaseService {
    constructor() {
        super("experience");
    }
    Handle_get_character(_args, session) {
        const characterID = getSessionCharacterID(session);
        log.debug(`[experience] get_character char=${characterID || "none"} state=bootstrap`);
        return buildEmptyCharacterExperience();
    }
    Handle_get_character_progression(_args, session) {
        const characterID = getSessionCharacterID(session);
        log.debug(`[experience] get_character_progression char=${characterID || "none"} state=bootstrap`);
        return buildEmptyCharacterProgression();
    }
    Handle_get_memories_from_character() {
        return buildEmptyMemories();
    }
    Handle_get_memories_from_shell() {
        return buildEmptyMemories();
    }
    Handle_get_memories_from_crown() {
        return buildEmptyMemories();
    }
    Handle_get_memory_point_totals() {
        return buildEmptyMemoryPointTotals();
    }
    Handle_get_ascension_choices() {
        // PointSelectionIntegration treats a falsey/empty result as no choices.
        return buildList([]);
    }
    Handle_delete_memory() {
        return throwUnsupportedProgressionMutation("delete_memory");
    }
    Handle_ascend() {
        return throwUnsupportedProgressionMutation("ascend");
    }
    Handle_implant_crown() {
        return throwUnsupportedProgressionMutation("implant_crown");
    }
    Handle_implant_raiment(args, session) {
        const values = unwrapMarshalValue(args);
        return implantRaiment(session, values && values[0]);
    }
    Handle_delete_active_raiment(_args, session) {
        return deleteActiveRaiment(session);
    }
    // Preserve the misspelling used by older Frontier clients.
    Handle_implant_reignment(args, session) {
        return this.Handle_implant_raiment(args, session);
    }
    Handle_delete_active_reignment(args, session) {
        return this.Handle_delete_active_raiment(args, session);
    }
    Handle_delete_active_crown() {
        return throwUnsupportedProgressionMutation("delete_active_crown");
    }
}
module.exports = ExperienceService;
module.exports.buildEmptyMemories = buildEmptyMemories;
module.exports._testing = {
    PATHWAY_CATEGORY_IDS,
    UNSUPPORTED_PROGRESSION_MUTATION_NOTIFY,
    buildEmptyCharacterExperience,
    buildEmptyCharacterProgression,
    buildEmptyMemories,
    buildEmptyMemoryPointTotals,
    deleteActiveRaiment,
    implantRaiment,
};
//# sourceMappingURL=experienceService.js.map