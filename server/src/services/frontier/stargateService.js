"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const { randomUUID } = require("node:crypto");
const path = require("path");
const BaseService = require("../baseService");
const itemStore = require(path.join(__dirname, "../inventory/itemStore"));
const characterState = require(path.join(__dirname, "../character/characterState"));
const runtime = require("./celestialStargateRuntime");
const STARGATE_INTERACTION_RANGE_METERS = 10_000;
function positiveInt(value, fallback = 0) {
    const numeric = Math.trunc(Number(value) || 0);
    return numeric > 0 ? numeric : fallback;
}
function firstArg(args) {
    return Array.isArray(args) ? args[0] : args;
}
function requestFromArgs(args) {
    const first = firstArg(args);
    return first && typeof first === "object" && !Array.isArray(first)
        ? first
        : { stargateID: first };
}
function gateIDFromArgs(args) {
    const request = requestFromArgs(args);
    return positiveInt(request.stargateID ?? request.stargateId ?? request.gateID ?? request.gateId ?? request.itemID, 0);
}
function characterID(session) {
    return positiveInt(session && (session.charid ?? session.characterID), 0);
}
function shipID(session) {
    return positiveInt(session && (session.shipid ?? session.shipID), 0);
}
function systemID(session) {
    return positiveInt(session && (session.solarsystemid2 ?? session.solarsystemid ?? session.solarSystemID), 0);
}
function assertLocalGate(session, gateState) {
    if (!gateState || gateState.solarSystemID !== systemID(session)) {
        return { success: false, errorMsg: "STARGATE_NOT_IN_SYSTEM" };
    }
    if (!characterID(session) || !shipID(session)) {
        return { success: false, errorMsg: "CHARACTER_NOT_IN_SHIP" };
    }
    if (!session._space) {
        return { success: false, errorMsg: "CHARACTER_NOT_IN_SPACE" };
    }
    const spaceRuntime = require(path.join(__dirname, "../../space/runtime"));
    const scene = spaceRuntime.getSceneForSession(session);
    const shipEntity = spaceRuntime.getEntity(session, shipID(session));
    const gateEntity = spaceRuntime.getEntity(session, gateState.stargateID);
    const distance = scene && shipEntity && gateEntity &&
        typeof scene.getCommandTimeEntitySurfaceDistance === "function"
        ? scene.getCommandTimeEntitySurfaceDistance(shipEntity, gateEntity)
        : Infinity;
    if (!Number.isFinite(distance) || distance > STARGATE_INTERACTION_RANGE_METERS) {
        return { success: false, errorMsg: "STARGATE_OUT_OF_RANGE" };
    }
    return { success: true };
}
function enrichRequirement(entry) {
    const metadata = itemStore.getItemMetadata(entry.typeID);
    return {
        ...entry,
        typeName: metadata && metadata.name || `Type ${entry.typeID}`,
        unitVolume: Number(metadata && metadata.volume) || 0,
    };
}
function buildUiState(state) {
    if (!state)
        return null;
    return {
        ...state,
        isCelestialStargate: true,
        isSmartAssembly: false,
        requirements: {
            materials: (state.requirements?.materials || []).map(enrichRequirement),
            fuel: (state.requirements?.fuel || []).map(enrichRequirement),
        },
    };
}
function normalizeDepositPlan(request, session, state) {
    const rawEntries = Array.isArray(request.items)
        ? request.items
        : Array.isArray(request.resources)
            ? request.resources
            : [];
    if (rawEntries.length === 0) {
        return { success: false, errorMsg: "STARGATE_RESOURCES_REQUIRED" };
    }
    const requiredKindByType = new Map();
    for (const requirement of [
        ...(state.requirements?.materials || []),
        ...(state.requirements?.fuel || []),
    ]) {
        if (requiredKindByType.has(requirement.typeID) &&
            requiredKindByType.get(requirement.typeID) !== requirement.kind) {
            return { success: false, errorMsg: "STARGATE_REQUIREMENT_KIND_CONFLICT" };
        }
        requiredKindByType.set(requirement.typeID, requirement.kind);
    }
    const plan = [];
    for (const raw of rawEntries) {
        const itemID = positiveInt(raw && (raw.itemID ?? raw.id), 0);
        const quantity = positiveInt(raw && raw.quantity, 0);
        const item = itemStore.findItemById(itemID);
        const available = item && Number(item.singleton) === 1
            ? 1
            : positiveInt(item && (item.stacksize ?? item.quantity), 0);
        if (!item || !quantity || quantity > available ||
            positiveInt(item.ownerID, 0) !== characterID(session) ||
            positiveInt(item.locationID, 0) !== shipID(session)) {
            return { success: false, errorMsg: "STARGATE_SOURCE_ITEM_INVALID" };
        }
        const kind = String(raw.kind || requiredKindByType.get(positiveInt(item.typeID, 0)) || "")
            .trim().toLowerCase();
        if (requiredKindByType.get(positiveInt(item.typeID, 0)) !== kind) {
            return { success: false, errorMsg: "STARGATE_RESOURCE_NOT_REQUIRED" };
        }
        plan.push({
            kind,
            itemID,
            typeID: positiveInt(item.typeID, 0),
            quantity,
            beforeQuantity: available,
            ownerID: positiveInt(item.ownerID, 0),
            locationID: positiveInt(item.locationID, 0),
            flagID: Number(item.flagID) || 0,
        });
    }
    return { success: true, data: plan };
}
class StargateService extends BaseService {
    constructor() {
        super("stargate");
    }
    Handle_get_fuel_energy(args) {
        const gateID = gateIDFromArgs(args);
        if (!gateID)
            return 0;
        const state = runtime.getStargateState(gateID);
        if (!state.success)
            return 0;
        return (state.data.requirements?.fuel || [])
            .reduce((total, entry) => total + positiveInt(entry.depositedQuantity, 0), 0);
    }
    Handle_get_reactivation_state(args) {
        const result = runtime.getStargateState(gateIDFromArgs(args));
        return result.success
            ? { success: true, data: buildUiState(result.data) }
            : result;
    }
    Handle_GetReactivationState(args) {
        return this.Handle_get_reactivation_state(args);
    }
    Handle_get_reactivation_requirements(args) {
        const result = this.Handle_get_reactivation_state(args);
        return result.success
            ? { success: true, data: result.data.requirements }
            : result;
    }
    Handle_GetReactivationRequirements(args) {
        return this.Handle_get_reactivation_requirements(args);
    }
    Handle_deposit_reactivation_resources(args, session) {
        const request = requestFromArgs(args);
        const stargateID = gateIDFromArgs(args);
        const stateResult = runtime.getStargateState(stargateID);
        if (!stateResult.success)
            return stateResult;
        const local = assertLocalGate(session, stateResult.data);
        if (!local.success)
            return local;
        const planned = normalizeDepositPlan(request, session, stateResult.data);
        if (!planned.success)
            return planned;
        const operationKey = String(request.operationKey || `player-stargate-deposit:${characterID(session)}:${randomUUID()}`).trim();
        const prepared = runtime.prepareStargateResourceDeposit(stargateID, planned.data.map((entry) => ({
            kind: entry.kind,
            typeID: entry.typeID,
            quantity: entry.quantity,
        })), {
            operationKey,
            actor: { characterID: characterID(session), shipID: shipID(session) },
        });
        if (!prepared.success)
            return prepared;
        const consumed = itemStore.consumeInventoryItems(planned.data.map((entry) => ({
            itemID: entry.itemID,
            quantity: entry.quantity,
            expected: {
                ownerID: entry.ownerID,
                locationID: entry.locationID,
                flagID: entry.flagID,
                typeID: entry.typeID,
            },
        })), { flush: true });
        if (!consumed.success) {
            runtime.cancelStargateResourceDeposit(stargateID, operationKey);
            return consumed;
        }
        const committed = runtime.commitStargateResourceDeposit(stargateID, operationKey);
        if (!committed.success)
            return committed;
        if (typeof characterState.emitItemsChangedBatchForSession === "function") {
            characterState.emitItemsChangedBatchForSession(session, consumed.data.changes);
        }
        return {
            success: true,
            data: {
                operationKey,
                state: buildUiState(committed.state || runtime.getStargateState(stargateID).data),
            },
        };
    }
    Handle_DepositReactivationResources(args, session) {
        return this.Handle_deposit_reactivation_resources(args, session);
    }
    Handle_reactivate(args, session) {
        const stargateID = gateIDFromArgs(args);
        const stateResult = runtime.getStargateState(stargateID);
        if (!stateResult.success)
            return stateResult;
        const local = assertLocalGate(session, stateResult.data);
        if (!local.success)
            return local;
        const result = runtime.requestStargateReactivation(stargateID, {
            actor: { characterID: characterID(session), shipID: shipID(session) },
        });
        return result.success
            ? { success: true, data: buildUiState(result.data) }
            : result;
    }
    Handle_Reactivate(args, session) {
        return this.Handle_reactivate(args, session);
    }
    Handle_get_reactivation_signals(args) {
        const request = requestFromArgs(args);
        return runtime.listSignals(gateIDFromArgs(args), {
            afterSequence: request.afterSequence,
            limit: request.limit,
        });
    }
    Handle_GetReactivationSignals(args) {
        return this.Handle_get_reactivation_signals(args);
    }
}
module.exports = StargateService;
//# sourceMappingURL=stargateService.js.map