"use strict";

const { randomUUID } = require("node:crypto");
const path = require("path");

const BaseService = require("../baseService");
const itemStore = require(path.join(__dirname, "../inventory/itemStore"));
const characterState = require(path.join(__dirname, "../character/characterState"));
const runtime = require("./celestialStargateRuntime");
const { buildDict, unwrapMarshalValue } = require("../_shared/serviceHelpers");
const { throwWrappedUserError } = require("../../common/machoErrors");
const { canEntitiesInteractLocally } = require("../../space/destiny/identity/interactionScope");
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
  return positiveInt(
    request.stargateID ?? request.stargateId ?? request.gateID ?? request.gateId ?? request.itemID,
    0,
  );
}

function characterID(session) {
  return positiveInt(session && (session.charid ?? session.characterID), 0);
}

function shipID(session) {
  return positiveInt(session && (session.shipid ?? session.shipID), 0);
}

function systemID(session) {
  return positiveInt(session && (
    session.solarsystemid2 ?? session.solarsystemid ?? session.solarSystemID
  ), 0);
}

function assertLocalGate(session, gateState) {
  if (!gateState || gateState.solarSystemID !== systemID(session)) {
    return { success: false as const, errorMsg: "STARGATE_NOT_IN_SYSTEM" };
  }
  if (!characterID(session) || !shipID(session)) {
    return { success: false as const, errorMsg: "CHARACTER_NOT_IN_SHIP" };
  }
  if (!session._space) {
    return { success: false as const, errorMsg: "CHARACTER_NOT_IN_SPACE" };
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
    return { success: false as const, errorMsg: "STARGATE_OUT_OF_RANGE" };
  }
  return { success: true as const };
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
  if (!state) return null;
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
    return { success: false as const, errorMsg: "STARGATE_RESOURCES_REQUIRED" };
  }
  const requiredKindByType = new Map<number, string>();
  for (const requirement of [
    ...(state.requirements?.materials || []),
    ...(state.requirements?.fuel || []),
  ]) {
    if (requiredKindByType.has(requirement.typeID) &&
        requiredKindByType.get(requirement.typeID) !== requirement.kind) {
      return { success: false as const, errorMsg: "STARGATE_REQUIREMENT_KIND_CONFLICT" };
    }
    requiredKindByType.set(requirement.typeID, requirement.kind);
  }
  const plan: any[] = [];
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
      return { success: false as const, errorMsg: "STARGATE_SOURCE_ITEM_INVALID" };
    }
    const kind = String(raw.kind || requiredKindByType.get(positiveInt(item.typeID, 0)) || "")
      .trim().toLowerCase();
    if (requiredKindByType.get(positiveInt(item.typeID, 0)) !== kind) {
      return { success: false as const, errorMsg: "STARGATE_RESOURCE_NOT_REQUIRED" };
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
  return { success: true as const, data: plan };
}

class StargateService extends BaseService {
  declare options: any;
  constructor(options: Record<string, any> = {}) {
    super("stargate"); this.options = options;
  }

  _targetGate(args, session) {
    const values = unwrapMarshalValue(args);
    const solarSystemID = Number(values?.[0]), gateID = Number(values?.[1]);
    if (!Number.isSafeInteger(gateID) || gateID <= 0 || solarSystemID !== systemID(session) || !characterID(session)) throwWrappedUserError("CustomNotify", { notify: "Stargate is not in the current system." });
    const authority = this.options.runtime || runtime;
    const result = authority.ensureTargetGate(gateID);
    if (!result.success || Number(result.data.solarSystemID) !== solarSystemID) throwWrappedUserError("CustomNotify", { notify: result.errorMsg || "Stargate not found." });
    return { values, state: result.data, authority, gateID };
  }

  Handle_get_rebuild_progress(args, session) {
    const { state } = this._targetGate(args, session);
    return buildDict((state.requirements?.materials || []).map(entry => [entry.typeID, entry.depositedQuantity]));
  }

  _depositTarget(args, session, fuelDeposit) {
    const { values, state, authority, gateID } = this._targetGate(args, session);
    const inventory = this.options.itemStore || itemStore;
    const space = this.options.spaceRuntime || require("../../space/runtime");
    const scene = space.getSceneForSession(session);
    const ship = space.getEntity(session, shipID(session));
    const gate = space.getEntity(session, gateID);
    const gateRange = scene && ship && gate ? scene.getCommandTimeEntitySurfaceDistance(ship, gate) : Infinity;
    if (!session?._space || !ship || !gate || !canEntitiesInteractLocally(ship, gate) ||
        !Number.isFinite(gateRange) || gateRange > STARGATE_INTERACTION_RANGE_METERS) throwWrappedUserError("CustomNotify", { notify: "Move within range of this stargate." });
    const source = values[2];
    const sourceID = Number(Array.isArray(source) ? source[1] : source);
    if (Array.isArray(source) && !["ShipCargo", "SpaceComponentInventory"].includes(String(source[0]))) throwWrappedUserError("CustomNotify", { notify: "This inventory cannot supply stargate resources." });
    if (!Number.isSafeInteger(sourceID) || sourceID <= 0) throwWrappedUserError("CustomNotify", { notify: "Invalid source inventory." });
    if (sourceID !== shipID(session)) {
      const item = inventory.findItemById(sourceID);
      const entity = space.getEntity(session, sourceID);
      const sourceRange = scene && entity ? scene.getCommandTimeEntitySurfaceDistance(ship, entity) : Infinity;
      if (!item || Number(item.ownerID) !== characterID(session) || Number(item.locationID) !== systemID(session) ||
          !entity || !canEntitiesInteractLocally(ship, entity) || !Number.isFinite(sourceRange) || sourceRange > STARGATE_INTERACTION_RANGE_METERS ||
          require("./deploymentRuntime").isAssemblyActivationPending(item) || entity.active === false) throwWrappedUserError("CustomNotify", { notify: "Source inventory is not accessible." });
    }
    const raw = values[3];
    const quantities = raw instanceof Map ? [...raw.entries()] : raw && typeof raw === "object" && !Array.isArray(raw) ? Object.entries(raw) : [];
    if (!quantities.length || quantities.length > 64) throwWrappedUserError("CustomNotify", { notify: "Specify stargate resources to deposit." });
    const consumptions = [], entries = [];
    const stacks = inventory.listContainerItems(characterID(session), sourceID, 5);
    const seen = new Set();
    for (const [rawType, rawQuantity] of quantities) {
      const typeID = Number(rawType), quantity = Number(rawQuantity);
      if (!Number.isSafeInteger(typeID) || typeID <= 0 || !Number.isSafeInteger(quantity) || quantity <= 0 || seen.has(typeID)) throwWrappedUserError("CustomNotify", { notify: "Invalid resource quantity." });
      seen.add(typeID); entries.push({ kind: fuelDeposit ? "fuel-energy" : "material", typeID, quantity });
      let remaining = quantity;
      for (const stack of stacks.filter(item => Number(item.typeID) === typeID && Number(item.singleton) === 0)) {
        const amount = Math.min(remaining, Number(stack.stacksize ?? stack.quantity));
        if (amount > 0) consumptions.push({ itemID: stack.itemID, typeID, quantity: amount });
        remaining -= amount; if (!remaining) break;
      }
      if (remaining) throwWrappedUserError("CustomNotify", { notify: "Insufficient resources in the selected inventory." });
    }
    const result = authority.depositResourcesWithInventory(gateID, entries, {
      characterID: characterID(session), consumptions, sourceLocationIDs: [sourceID], sourceFlagIDs: [5],
    }, { operationKey: `target-gate:${characterID(session)}:${randomUUID()}`, targetFuel: fuelDeposit, targetRebuild: !fuelDeposit,
      actor: { characterID: characterID(session), shipID: shipID(session) } });
    if (!result?.success) throwWrappedUserError("CustomNotify", { notify: result?.errorMsg || "Stargate deposit failed." });
    (this.options.emitInventoryChanges || characterState.emitItemsChangedBatchForSession)(session, result.changes || []);
    return null;
  }

  Handle_deposit_rebuild_items(args, session) { return this._depositTarget(args, session, false); }
  Handle_deposit_fuel_items(args, session) { return this._depositTarget(args, session, true); }

  Handle_get_fuel_energy(args, session) {
    if (Array.isArray(args) && args.length >= 2) return this._targetGate(args, session).state.fuelEnergy;
    const gateID = gateIDFromArgs(args);
    if (!gateID) return 0;
    const state = runtime.getStargateState(gateID);
    if (!state.success) return 0;
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
    if (!stateResult.success) return stateResult;
    const local = assertLocalGate(session, stateResult.data);
    if (!local.success) return local;
    const planned = normalizeDepositPlan(request, session, stateResult.data);
    if (!planned.success) return planned;
    const operationKey = String(
      request.operationKey || `player-stargate-deposit:${characterID(session)}:${randomUUID()}`,
    ).trim();
    const committed = runtime.depositResourcesWithInventory(stargateID,
      planned.data.map(entry => ({ kind: entry.kind, typeID: entry.typeID, quantity: entry.quantity })),
      { characterID: characterID(session), sourceLocationIDs: [shipID(session)],
        sourceFlagIDs: [...new Set(planned.data.map(entry => entry.flagID))],
        consumptions: planned.data.map(entry => ({ itemID: entry.itemID, typeID: entry.typeID, quantity: entry.quantity,
          expected: { ownerID: entry.ownerID, locationID: entry.locationID, flagID: entry.flagID, typeID: entry.typeID } })),
      }, { operationKey, actor: { characterID: characterID(session), shipID: shipID(session) } });
    if (!committed.success) return committed;
    if (typeof characterState.emitItemsChangedBatchForSession === "function") {
      characterState.emitItemsChangedBatchForSession(session, committed.changes);
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
    if (!stateResult.success) return stateResult;
    const local = assertLocalGate(session, stateResult.data);
    if (!local.success) return local;
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
