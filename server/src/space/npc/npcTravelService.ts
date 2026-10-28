"use strict";

const path = require("path");
const route = require("./npcTravelRoute");
const transition = require("./npcTravelTransition");
const nativeNpcStore = require("./nativeNpcStore");
const behaviorRuntime = require("./npcBehaviorTreeRuntime");

const GATE_RANGE_METERS = 10_000;

function positiveInt(value) {
  const numeric = Number(value);
  return Number.isSafeInteger(numeric) && numeric > 0 ? numeric : 0;
}

function finite(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function cloneValue(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function suspended(checkpoint, nowMs, step, errorMsg, delayMs = 5_000) {
  return {
    status: behaviorRuntime.STATUS.SUSPENDED,
    step,
    checkpoint,
    error: errorMsg,
    nextWakeAtMs: nowMs + delayMs,
  };
}

function running(checkpoint, nowMs, step, delayMs = 500) {
  return {
    status: behaviorRuntime.STATUS.RUNNING,
    step,
    checkpoint,
    nextWakeAtMs: nowMs + delayMs,
  };
}

function noteFuelRequest(context, checkpoint, reason, fuelTypeID = 0, quantity = 0) {
  if (checkpoint.fuelRequest?.reason === reason &&
      checkpoint.fuelRequest?.fuelTypeID === positiveInt(fuelTypeID)) return;
  checkpoint.fuelRequest = {
    jobID: context.job.jobID,
    entityID: positiveInt(context.entity?.itemID),
    npcCharacterID: positiveInt(context.job.npcCharacterID),
    systemID: positiveInt(context.entity?.systemID),
    reason,
    fuelTypeID: positiveInt(fuelTypeID),
    quantity: Math.max(0, Math.ceil(finite(quantity))),
    requestedAtMs: Date.now(),
  };
  behaviorRuntime.eventInbox.publish(
    context.job.npcCharacterID, "npc-fuel-request", checkpoint.fuelRequest,
    { eventID: `npc-fuel-request:${context.job.jobID}:${reason}:${positiveInt(fuelTypeID)}` },
  );
}

function getDistanceLy(sourceID, destinationID, worldData) {
  const source = worldData.getSolarSystemByID(sourceID);
  const destination = worldData.getSolarSystemByID(destinationID);
  const left = source?.position;
  const right = destination?.position;
  if (!left || !right) return null;
  return Math.hypot(
    finite(left.x) - finite(right.x),
    finite(left.y) - finite(right.y),
    finite(left.z) - finite(right.z),
  ) / route.LIGHT_YEAR_METERS;
}

function listNpcUnloadedFuelCargo(entityID, fuelTypeID, itemStore) {
  return nativeNpcStore.listNativeCargoForEntity(entityID)
    .filter((record) => !positiveInt(record.moduleID) &&
      positiveInt(record.typeID) === fuelTypeID)
    .map((record) => itemStore.findItemById(record.cargoID))
    .filter((item) => item && positiveInt(item.locationID) === entityID &&
      positiveInt(item.typeID) === fuelTypeID)
    .sort((a, b) => a.itemID - b.itemID);
}

function planLegacyFuelDebit(entityID, plan, itemStore) {
  let remaining = Math.ceil(finite(plan.fuelQuantity));
  const entries: any[] = [];
  for (const item of listNpcUnloadedFuelCargo(entityID, plan.fuelTypeID, itemStore)) {
    if (remaining <= 0) break;
    const beforeQuantity = Number(item.singleton) === 1
      ? 1 : positiveInt(item.stacksize ?? item.quantity);
    const quantity = Math.min(remaining, beforeQuantity);
    if (!quantity) continue;
    entries.push({
      itemID: item.itemID, typeID: item.typeID,
      ownerID: item.ownerID, locationID: item.locationID, flagID: item.flagID,
      beforeQuantity, quantity,
    });
    remaining -= quantity;
  }
  return remaining > 0
    ? { success: false, errorMsg: "INSUFFICIENT_FUEL" }
    : { success: true, data: entries };
}

function buildNpcJumpDrivePlan(entity, destinationSystemID, adapters: Record<string, any> = {}) {
  const worldData = adapters.worldData || require(path.join(__dirname, "../worldData"));
  const itemStore = adapters.itemStore || require(path.join(__dirname, "../../services/inventory/itemStore"));
  const fitting = adapters.fitting || require(path.join(__dirname, "../../services/fitting/liveFittingState"));
  const jumpDrive = adapters.jumpDrive || require(path.join(__dirname, "../../services/frontier/jumpDriveRuntime"));
  const jumpTimers = adapters.jumpTimers || require(path.join(__dirname, "../../services/_shared/jumpTimerRuntime"));
  const npcStore = adapters.nativeNpcStore || nativeNpcStore;
  const sourceID = positiveInt(entity?.systemID);
  const destinationID = positiveInt(destinationSystemID);
  const distanceLy = getDistanceLy(sourceID, destinationID, worldData);
  if (!entity || !sourceID || !destinationID || !distanceLy || distanceLy <= 0) {
    return { success: false, errorMsg: "NPC_JUMP_DESTINATION_INVALID" };
  }
  if (finite(entity.conditionState?.npcJumpCooldownUntilMs) > Date.now()) {
    return { success: false, errorMsg: "NPC_JUMP_COOLDOWN_ACTIVE" };
  }
  const shipItem = {
    itemID: entity.itemID ?? entity.entityID,
    ownerID: positiveInt(entity.ownerID),
    locationID: sourceID,
    flagID: 0,
    typeID: positiveInt(entity.playerFittingHullTypeID) || positiveInt(entity.typeID),
    categoryID: 6,
    conditionState: cloneValue(entity.conditionState || {}),
  };
  const fittedItems = npcStore.listNativeModulesForEntity(shipItem.itemID)
    .filter((record) => record.moduleState?.online === true)
    .map((record) => itemStore.findItemById(record.moduleID))
    .filter(Boolean)
    .map((item) => ({ ...item, npcTravelOnline: true }));
  let resourceState;
  try {
    resourceState = fitting.buildShipResourceState(
      positiveInt(entity.npcCharacterID), shipItem,
      { fittedItems, includeActiveImplantModifiers: false },
    );
  } catch (error) {
    return { success: false, errorMsg: "NPC_JUMP_FITTING_UNAVAILABLE" };
  }
  const planResult = jumpDrive.buildJumpDrivePlan({
    shipItem,
    resourceState,
    shipEntity: entity,
    distanceLy,
    deps: { isEffectivelyOnlineModule: (item) => item?.npcTravelOnline === true },
  });
  if (!planResult.success) return planResult;
  const plan = planResult.data;
  const nowMs = Date.now();
  const timers = jumpTimers.calculateJumpTimers({
    distanceLy,
    jumpFatigueMultiplier: jumpTimers.resolveJumpFatigueMultiplier(resourceState),
    previousJumpFatigue: entity.conditionState?.npcJumpFatigueFiletime,
    nowMs,
  });
  const timerDebit = {
    cooldownUntilMs: nowMs + Math.ceil(timers.activationSeconds * 1000),
    fatigueUntilMs: nowMs + Math.ceil(timers.fatigueSeconds * 1000),
    fatigueFiletime: timers.jumpFatigue,
  };
  if (plan.fuelMode === "frontier-tank") {
    const debit = jumpDrive.consumeFrontierFuelQueue(
      plan.fuelQueue, plan.fuelTypeID, plan.fuelQuantity,
    );
    if (!debit.success) return debit;
    return {
      success: true,
      data: {
        plan,
        fuelDebit: {
          mode: "frontier-tank",
          previousFuelQueue: debit.data.previousFuelQueue,
          fuelQueue: debit.data.fuelQueue,
          fuelCharge: debit.data.fuelCharge,
          fuelTypeID: debit.data.fuelTypeID,
          nextTemperature: plan.nextTemperature,
          ...timerDebit,
        },
      },
    };
  }
  const legacy = planLegacyFuelDebit(shipItem.itemID, plan, itemStore);
  if (!legacy.success) return legacy;
  return {
    success: true,
    data: {
      plan,
      fuelDebit: {
        mode: "inventory",
        entries: legacy.data,
        nextTemperature: plan.nextTemperature,
        ...timerDebit,
      },
    },
  };
}

function advanceNpcTravel(context, destinationSystemID, adapters: Record<string, any> = {}) {
  const { entity, job, nowMs } = context;
  const checkpoint = { ...(cloneValue(job.checkpoint || {})) };
  const sourceID = positiveInt(entity?.systemID);
  const targetID = positiveInt(destinationSystemID);
  if (!sourceID || !targetID) {
    return suspended(checkpoint, nowMs, "awaiting-system", "NPC_TRAVEL_SYSTEM_INVALID");
  }
  if (sourceID === targetID) {
    return running(checkpoint, nowMs, "travel-arrived", 50);
  }
  if (entity.transient === true || !positiveInt(entity.npcCharacterID) ||
      positiveInt(entity.npcCharacterID) !== positiveInt(job.npcCharacterID) ||
      positiveInt(entity.npcIncarnation) !== positiveInt(job.incarnation)) {
    return suspended(checkpoint, nowMs, "awaiting-identity", "NPC_TRAVEL_DURABLE_IDENTITY_REQUIRED");
  }
  const planner = adapters.routePlanner || route;
  const transfer = adapters.transition || transition;
  const npcRuntime = adapters.npcRuntime || require("./npcRuntime");
  const fuelLogistics = adapters.fuelLogistics || require("./npcFuelLogistics");
  const jump = buildNpcJumpDrivePlan(entity, targetID, adapters);
  const planned = planner.planNpcTravelRoute(sourceID, targetID, {
    jumpDrivePlan: jump.success ? jump.data.plan : null,
  });
  if (!planned.success || !planned.data?.edges?.length) {
    if (["REQUIRED_FUEL_NOT_ACTIVE", "INSUFFICIENT_FUEL"].includes(jump.errorMsg)) {
      const loaded = fuelLogistics.loadNpcFuelFromCargo(entity.itemID, jump.fuelTypeID);
      if (loaded.success) return running(checkpoint, nowMs, "refueled-for-jump", 50);
      noteFuelRequest(context, checkpoint, "jump", jump.fuelTypeID, jump.fuelQuantity);
    }
    checkpoint.destinationSystemID = targetID;
    return suspended(checkpoint, nowMs, "route-unavailable",
      planned.errorMsg || "NPC_TRAVEL_ROUTE_UNAVAILABLE", 10_000);
  }
  const edge = planned.data.edges[0];
  checkpoint.destinationSystemID = targetID;
  checkpoint.nextSystemID = edge.destinationSystemID;
  checkpoint.routeKind = edge.kind;
  checkpoint.sourceID = edge.sourceID;
  if (edge.requiresMaintenance) {
    const maintenance = adapters.maintenance || require("./npcStargateMaintenanceService");
    const child = maintenance.tickNpcStargateMaintenanceJob({
      ...context,
      job: {
        ...job,
        target: { stargateID: edge.sourceID, solarSystemID: sourceID },
        payload: { stargateID: edge.sourceID, npcTravelChild: true },
        checkpoint: checkpoint.gateMaintenance || {},
      },
    });
    checkpoint.gateMaintenance = child.checkpoint || checkpoint.gateMaintenance || {};
    return child.status === behaviorRuntime.STATUS.SUCCESS
      ? running(checkpoint, nowMs, "gate-reactivated", 50)
      : { ...child, checkpoint };
  }
  if (edge.kind !== "jump-drive") {
    const source = context.scene?.getEntityByID(edge.sourceID);
    const targetPosition = source?.position;
    if (!targetPosition) {
      return suspended(checkpoint, nowMs, "gate-unavailable", "NPC_TRAVEL_GATE_NOT_VISIBLE");
    }
    if (entity.mode === "WARP" || entity.pendingWarp || entity.warpState) {
      return running(checkpoint, nowMs, "travel-gate", 500);
    }
    const distance = Math.hypot(
      finite(entity.position?.x) - finite(targetPosition.x),
      finite(entity.position?.y) - finite(targetPosition.y),
      finite(entity.position?.z) - finite(targetPosition.z),
    ) - finite(entity.radius) - finite(source?.radius);
    if (distance > GATE_RANGE_METERS) {
      const warp = npcRuntime.warpToPoint(entity.itemID, targetPosition, {
        minimumRange: 0,
      });
      if (!warp?.success) {
        if (["NO_FUEL", "INSUFFICIENT_FUEL", "REQUIRED_FUEL_NOT_ACTIVE"].includes(warp?.errorMsg)) {
          const loaded = fuelLogistics.loadNpcFuelFromCargo(entity.itemID);
          if (loaded.success) return running(checkpoint, nowMs, "refueled-for-warp", 50);
          noteFuelRequest(context, checkpoint, "warp");
        }
        return suspended(checkpoint, nowMs,
          warp?.errorMsg === "NO_FUEL" ? "awaiting-fuel" : "travel-gate",
          warp?.errorMsg || "NPC_TRAVEL_WARP_FAILED");
      }
      return running(checkpoint, nowMs, "travel-gate", 500);
    }
    if (edge.kind === "stargate" &&
        (!source || source.kind !== "stargate" || Number(source.activationState) !== 2)) {
      return suspended(checkpoint, nowMs, "awaiting-gate-activation",
        "STARGATE_NOT_ACTIVE", 2_000);
    }
  }
  const current = planner.validateNpcTravelEdge(edge);
  if (!current.success) {
    return running(checkpoint, nowMs, "route-invalidated", 250);
  }
  if (current.data?.requiresMaintenance) {
    return running(checkpoint, nowMs, "gate-became-dormant", 250);
  }
  let jumpFuelDebit = null;
  if (edge.kind === "jump-drive") {
    const refreshed = buildNpcJumpDrivePlan(entity, edge.destinationSystemID, adapters);
    if (!refreshed.success) {
      if (["REQUIRED_FUEL_NOT_ACTIVE", "INSUFFICIENT_FUEL"].includes(refreshed.errorMsg)) {
        const loaded = fuelLogistics.loadNpcFuelFromCargo(entity.itemID, refreshed.fuelTypeID);
        if (loaded.success) return running(checkpoint, nowMs, "refueled-for-jump", 50);
        noteFuelRequest(context, checkpoint, "jump", refreshed.fuelTypeID,
          refreshed.fuelQuantity);
      }
      return suspended(checkpoint, nowMs, "awaiting-jump-fuel",
        refreshed.errorMsg || "NPC_JUMP_PREFLIGHT_FAILED");
    }
    jumpFuelDebit = refreshed.data.fuelDebit;
  }
  const key = `npc-travel:${job.jobID}:${job.incarnation}:${positiveInt(checkpoint.travelHopSequence) || 0}:${sourceID}:${edge.destinationSystemID}:${edge.sourceID}`;
  const result = transfer.transitionNpcThroughEdge(entity.itemID, edge, {
    idempotencyKey: key, jobID: job.jobID, jumpFuelDebit,
  });
  if (!result?.success) {
    return suspended(checkpoint, nowMs, "travel-retry",
      result?.errorMsg || "NPC_TRAVEL_TRANSITION_FAILED");
  }
  checkpoint.lastCompletedEdge = {
    kind: edge.kind,
    sourceSystemID: sourceID,
    destinationSystemID: edge.destinationSystemID,
    completedAtMs: Date.now(),
  };
  checkpoint.travelHopSequence = (positiveInt(checkpoint.travelHopSequence) || 0) + 1;
  return running(checkpoint, nowMs, "travel-system-complete", 250);
}

module.exports = {
  advanceNpcTravel,
  buildNpcJumpDrivePlan,
  getDistanceLy,
  planLegacyFuelDebit,
};
