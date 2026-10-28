"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const BaseService = require("../baseService");
const log = require("../../utils/logger");
const { throwWrappedUserError } = require("../../common/machoErrors");
const { buildDict, buildKeyVal, buildList, unwrapMarshalValue, } = require("../_shared/serviceHelpers");
const { syncInventoryItemForSession, } = require("../character/characterState");
const shellEquipment = require("./shellEquipmentRuntime");
const progression = require("./progressionRuntime");
function progressionResult(result) {
    if (!result || result.success !== true)
        throwWrappedUserError("CustomNotify", { notify: `Progression action refused: ${result?.errorMsg || "FAILED"}.` });
    return true;
}
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
        if (!characterID)
            return buildEmptyCharacterExperience();
        const state = progression.getRuntime().getState(characterID);
        return buildDict([["total_xp", state.totalXP], ["cap", 0], ["category_xp", progression.marshalMap(state.categoryXP)]]);
    }
    Handle_get_character_progression(_args, session) {
        const characterID = getSessionCharacterID(session);
        log.debug(`[experience] get_character_progression char=${characterID || "none"} state=bootstrap`);
        if (!characterID)
            return buildEmptyCharacterProgression();
        const totals = this._memoryTotals(session);
        return buildList(PATHWAY_CATEGORY_IDS.map(categoryID => buildKeyVal([["categoryID", categoryID], ["points", totals[categoryID] || 0]])));
    }
    Handle_get_memories_from_character(_args, session) {
        const id = getSessionCharacterID(session);
        return id ? progression.memoriesResponse(progression.getRuntime().getState(id), "vault", id) : buildEmptyMemories();
    }
    Handle_get_memories_from_shell(_args, session) {
        const id = getSessionCharacterID(session), shell = shellEquipment.getActiveShell(id);
        return id && shell ? progression.memoriesResponse(progression.getRuntime().getState(id), "shell", shell.itemID) : buildEmptyMemories();
    }
    Handle_get_memories_from_crown(args, session) {
        const id = getSessionCharacterID(session), crownID = Number(unwrapMarshalValue(args)?.[0]);
        if (!id)
            return buildEmptyMemories();
        const state = progression.getRuntime().getState(id);
        return state.crowns[crownID] ? progression.memoriesResponse(state, "crown", crownID) : buildEmptyMemories();
    }
    _memoryTotals(session) {
        const totals = Object.fromEntries(PATHWAY_CATEGORY_IDS.map(id => [id, 0]));
        const id = getSessionCharacterID(session), shellID = shellEquipment.getActiveShell(id)?.itemID;
        if (!id)
            return totals;
        const state = progression.getRuntime().getState(id);
        for (const memory of Object.values(state.memories)) {
            if (!(memory.ownerKind === "shell" && memory.ownerID === shellID || memory.ownerKind === "crown" && state.crowns[memory.ownerID]?.shellID === shellID))
                continue;
            for (const values of [memory.primaryPathways, memory.secondaryPathways])
                for (const [key, value] of Object.entries(values || {}))
                    if (Object.hasOwn(totals, key))
                        totals[key] += value;
        }
        return totals;
    }
    Handle_get_memory_point_totals(_args, session) {
        return progression.marshalMap(this._memoryTotals(session), true);
    }
    Handle_get_ascension_choices(_args, session) {
        // The legacy point-selection view expects pathway maps. Build3640684's
        // weave view selects memory IDs from get_memories_from_shell instead.
        const id = getSessionCharacterID(session), shellID = shellEquipment.getActiveShell(id)?.itemID;
        if (!id || !shellID)
            return buildList([]);
        const choices = Object.values(progression.getRuntime().getState(id).memories)
            .filter(row => row.ownerKind === "shell" && row.ownerID === shellID)
            .map(row => { const total = { ...row.primaryPathways }; for (const [key, value] of Object.entries(row.secondaryPathways || {}))
            total[key] = (total[key] || 0) + value; return total; })
            .filter(value => Object.keys(value).length);
        return buildList(choices.map(value => progression.marshalMap(value, true)));
    }
    Handle_delete_memory(args, session) {
        const values = unwrapMarshalValue(args);
        return progressionResult(progression.getRuntime().deleteMemory(session, values?.[0], values?.[1]));
    }
    Handle_ascend(args, session) {
        return progressionResult(progression.getRuntime().ascend(session, unwrapMarshalValue(args)?.[0]));
    }
    Handle_implant_crown(args, session) {
        return progressionResult(progression.getRuntime().crownMutation(session, unwrapMarshalValue(args)?.[0]));
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
    Handle_delete_active_crown(_args, session) {
        return progressionResult(progression.getRuntime().crownMutation(session, null, true));
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