"use strict";

const path = require("path");

const database = require(path.join(__dirname, "../../gameStore"));
const itemStore = require(path.join(__dirname, "../../services/inventory/itemStore"));
const fitting = require(path.join(__dirname, "../../services/fitting/liveFittingState"));
const miningRuntime = require(path.join(__dirname, "../../services/mining/miningRuntime"));
const { getMineableState } = require(path.join(
  __dirname,
  "../../services/mining/miningRuntimeState",
));
const {
  getNpcFittedModuleItems,
  getNpcLoadedChargeForModule,
} = require("./npcEquipment");
const nativeNpcStore = require("./nativeNpcStore");
const npcFittingService = require("./npcFittingService");
const behaviorRuntime = require("./npcBehaviorTreeRuntime");
const persistence = require("./npcRuntimePersistence");

const RESOURCE_JOB_TYPES = Object.freeze([
  "resource.work",
  "resource.mine",
  "resource.mining",
  "resource.crude",
  "resource.gas",
  "resource.ice",
]);
const TERMINAL_OPERATION_STATUSES = new Set(["committed", "compensated", "failed"]);
const resourceDefinitions = new Map<string, any>();
let handlersRegistered = false;

function getMiningNpcOperations() {
  // Mining fleet commands depend on the public NPC index. Resolve them only
  // after npcService/npcBehaviorLoop have completed their module-load cycle.
  return require(path.join(__dirname, "../../services/mining/miningNpcOperations"));
}

function cloneValue(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function toPositiveInt(value, fallback = 0) {
  const numeric = Math.trunc(Number(value) || 0);
  return numeric > 0 ? numeric : fallback;
}

function toFiniteNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function normalizeResourceKind(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "mine") return "mining";
  return normalized;
}

function getResourceKindForJob(job) {
  const explicit = normalizeResourceKind(job && job.payload && job.payload.resourceKind);
  if (explicit) return explicit;
  const suffix = normalizeResourceKind(String(job && job.jobType || "").split(".").pop());
  return suffix === "work" ? "mining" : suffix;
}

function registerNpcResourceDefinition(kind: string, definition: Record<string, any>) {
  const normalizedKind = normalizeResourceKind(kind);
  if (!normalizedKind || !definition || typeof definition.resolveTool !== "function" ||
      typeof definition.listTargets !== "function") {
    throw new Error("NPC resource definition requires a kind, tool resolver, and target resolver");
  }
  if (resourceDefinitions.has(normalizedKind)) {
    throw new Error(`NPC resource definition ${normalizedKind} is already registered`);
  }
  resourceDefinitions.set(normalizedKind, definition);
  return () => resourceDefinitions.delete(normalizedKind);
}

function getNpcResourceDefinition(kind: string) {
  return resourceDefinitions.get(normalizeResourceKind(kind)) || null;
}

function buildCheckpoint(job) {
  return {
    deliveredQuantity: 0,
    deliveryCount: 0,
    targetID: 0,
    targetResourceKey: null,
    toolModuleID: 0,
    toolRequestedAtMs: 0,
    ...(cloneValue(job && job.checkpoint || {})),
  };
}

function running(step, checkpoint, nowMs, delayMs = 250, extra: Record<string, any> = {}) {
  return {
    status: behaviorRuntime.STATUS.RUNNING,
    step,
    checkpoint,
    nextWakeAtMs: Math.max(0, Number(nowMs) || 0) + Math.max(50, delayMs),
    ...extra,
  };
}

function suspended(step, checkpoint, nowMs, error, delayMs = 5_000) {
  return {
    status: behaviorRuntime.STATUS.SUSPENDED,
    step,
    checkpoint,
    error,
    nextWakeAtMs: Math.max(0, Number(nowMs) || 0) + Math.max(250, delayMs),
  };
}

function success(checkpoint) {
  return {
    status: behaviorRuntime.STATUS.SUCCESS,
    step: "completed",
    checkpoint,
  };
}

function releaseTargetReservation(job, checkpoint) {
  if (checkpoint.targetResourceKey) {
    persistence.releaseNpcJobReservation(job.jobID, checkpoint.targetResourceKey);
  }
  checkpoint.targetID = 0;
  checkpoint.targetResourceKey = null;
}

function isRecentThreat(context, payload) {
  const lastAggressedAtMs = Math.max(
    0,
    toFiniteNumber(context.controller && context.controller.lastAggressedAtMs, 0),
  );
  if (!lastAggressedAtMs) return false;
  const cooldownMs = Math.max(0, toFiniteNumber(payload.threatCooldownMs, 15_000));
  return cooldownMs > 0 && context.nowMs - lastAggressedAtMs < cooldownMs;
}

function maybeProvisionTool(context, payload, checkpoint) {
  const provisioning = payload && payload.toolProvisioning;
  if (!provisioning || checkpoint.toolProvisioningAttempted === true) return null;
  checkpoint.toolProvisioningAttempted = true;
  const result = npcFittingService.fitItemToNpc({
    entityID: context.entity.itemID,
    itemID: provisioning.itemID,
    targetFlagID: provisioning.targetFlagID,
    actor: provisioning.actor,
    idempotencyKey:
      provisioning.idempotencyKey ||
      `npc-resource-tool:${context.job.jobID}:${toPositiveInt(provisioning.itemID, 0)}`,
  });
  checkpoint.toolProvisioningResult = result && result.success === true
    ? { success: true, moduleID: result.data && result.data.moduleID }
    : { success: false, errorMsg: result && result.errorMsg || "NPC_RESOURCE_TOOL_FIT_FAILED" };
  return result;
}

function buildToolRequest(context, resourceKind, checkpoint) {
  if (!checkpoint.toolRequestedAtMs) {
    checkpoint.toolRequestedAtMs = Date.now();
    checkpoint.toolRequest = {
      jobID: context.job.jobID,
      entityID: toPositiveInt(context.entity && context.entity.itemID, 0),
      npcCharacterID: context.job.npcCharacterID,
      resourceKind,
      semanticRole: resourceKind === "salvage" ? "salvage" : "mining",
      requestedAtMs: checkpoint.toolRequestedAtMs,
    };
    behaviorRuntime.eventInbox.publish(
      context.job.npcCharacterID,
      "resource-tool-request",
      checkpoint.toolRequest,
      { eventID: `resource-tool-request:${context.job.jobID}` },
    );
  }
}

function destinationFromPayload(payload) {
  const destination = payload && payload.destination;
  const locationID = toPositiveInt(destination && destination.locationID, 0);
  const flagID = Math.max(0, Math.trunc(Number(destination && destination.flagID) || 0));
  if (!locationID) return null;
  return {
    locationID,
    flagID,
    entityID: toPositiveInt(destination && destination.entityID, 0),
    interactionRangeMeters: Math.max(
      0,
      toFiniteNumber(destination && destination.interactionRangeMeters, 2_500),
    ),
  };
}

function listDeliverableCargo(entityID, itemIDs: any[] | null = null) {
  const filterIDs = Array.isArray(itemIDs) && itemIDs.length > 0
    ? new Set(itemIDs.map((value) => toPositiveInt(value, 0)).filter(Boolean))
    : null;
  return nativeNpcStore.listNativeCargoForEntity(entityID)
    .filter((record) => toPositiveInt(record && record.moduleID, 0) <= 0)
    .filter((record) => record.semanticRole === "resource")
    .filter((record) => !filterIDs || filterIDs.has(toPositiveInt(record.cargoID, 0)))
    .map((record) => ({
      record,
      item: itemStore.findItemById(record.cargoID),
    }));
}

function finishResourceDeliveryOperation(operation, options: Record<string, any> = {}) {
  const payload = operation.payload || {};
  const entityID = toPositiveInt(payload.entityID, 0);
  const destinationLocationID = toPositiveInt(payload.destinationLocationID, 0);
  const destinationFlagID = Math.max(0, Math.trunc(Number(payload.destinationFlagID) || 0));
  const cargoItemIDs = (Array.isArray(payload.cargoItemIDs) ? payload.cargoItemIDs : [])
    .map((value) => toPositiveInt(value, 0))
    .filter(Boolean);
  if (!entityID || !destinationLocationID || cargoItemIDs.length === 0) {
    return { success: false, errorMsg: "NPC_RESOURCE_DELIVERY_INVALID" };
  }
  const atSource: number[] = [];
  const atDestination: number[] = [];
  const missing: number[] = [];
  for (const itemID of cargoItemIDs) {
    const item = itemStore.findItemById(itemID);
    if (!item) {
      missing.push(itemID);
    } else if (
      toPositiveInt(item.locationID, 0) === destinationLocationID &&
      Math.max(0, Math.trunc(Number(item.flagID) || 0)) === destinationFlagID
    ) {
      atDestination.push(itemID);
    } else if (toPositiveInt(item.locationID, 0) === entityID) {
      atSource.push(itemID);
    } else {
      return { success: false, errorMsg: "NPC_RESOURCE_DELIVERY_ITEM_MOVED" };
    }
  }
  if (missing.length > 0) {
    return { success: false, errorMsg: "NPC_RESOURCE_DELIVERY_ITEM_MISSING", data: { missing } };
  }
  if (atSource.length > 0) {
    const move = itemStore.moveItemsToLocations(atSource.map((itemID) => ({
      itemID,
      destinationLocationID,
      destinationFlagID,
    })));
    if (!move.success) return move;
    persistence.checkpointNpcOperation(operation.operationID, "inventory-moved", {
      movedItemIDs: [...atDestination, ...atSource],
    }, { flushTables: [itemStore.ITEMS_TABLE] });
  }
  for (const itemID of cargoItemIDs) nativeNpcStore.removeNativeCargo(itemID);
  const result = {
    entityID,
    destinationLocationID,
    destinationFlagID,
    cargoItemIDs,
    deliveredQuantity: (Array.isArray(payload.cargoSnapshots) ? payload.cargoSnapshots : [])
      .reduce((sum, snapshot) => sum + Math.max(0, toPositiveInt(snapshot && snapshot.quantity, 0)), 0),
    recovered: options.recovered === true,
  };
  persistence.commitNpcOperation(operation.operationID, {
    flushTables: [itemStore.ITEMS_TABLE, nativeNpcStore.TABLE.CARGO],
    result,
  });
  npcFittingService.syncRuntimeEquipment(entityID);
  return { success: true, data: result, recovered: options.recovered === true };
}

function deliverNpcResourceCargo(input: Record<string, any>) {
  persistence.initializeNpcRuntimePersistence();
  const entityID = toPositiveInt(input && input.entityID, 0);
  const destinationLocationID = toPositiveInt(input && input.destinationLocationID, 0);
  const destinationFlagID = Math.max(
    0,
    Math.trunc(Number(input && input.destinationFlagID) || 0),
  );
  if (!entityID || !destinationLocationID) {
    return { success: false, errorMsg: "NPC_RESOURCE_DELIVERY_DESTINATION_REQUIRED" };
  }
  const cargo = listDeliverableCargo(entityID, input && input.cargoItemIDs);
  if (cargo.length === 0) {
    return { success: true, data: { deliveredQuantity: 0, cargoItemIDs: [] } };
  }
  if (cargo.some((entry) => !entry.item)) {
    return { success: false, errorMsg: "NPC_RESOURCE_CARGO_NOT_CANONICAL" };
  }
  const idempotencyKey = String(
    input.idempotencyKey || `npc-resource-delivery:${entityID}:${destinationLocationID}`,
  ).trim();
  const operation = persistence.beginNpcOperation(
    "npc-resource-delivery",
    idempotencyKey,
    {
      jobID: input.jobID || null,
      entityID,
      destinationLocationID,
      destinationFlagID,
      cargoItemIDs: cargo.map((entry) => entry.item.itemID),
      cargoSnapshots: cargo.map((entry) => ({
        itemID: entry.item.itemID,
        typeID: entry.item.typeID,
        ownerID: entry.item.ownerID,
        quantity: entry.item.singleton === 1
          ? 1
          : Math.max(0, toPositiveInt(entry.item.stacksize ?? entry.item.quantity, 0)),
      })),
    },
  ).data;
  if (operation.status === "committed") {
    return { success: true, data: { ...cloneValue(operation.result || {}), idempotent: true } };
  }
  try {
    return finishResourceDeliveryOperation(operation);
  } catch (error) {
    return { success: false, errorMsg: error.message || "NPC_RESOURCE_DELIVERY_FAILED" };
  }
}

function recoverNpcResourceOperation(operation) {
  if (!operation || operation.operationType !== "npc-resource-delivery") {
    return { success: false, errorMsg: "NPC_RESOURCE_OPERATION_UNSUPPORTED" };
  }
  if (TERMINAL_OPERATION_STATUSES.has(operation.status)) {
    return { success: true, recovered: false };
  }
  return finishResourceDeliveryOperation(operation, { recovered: true });
}

function shouldDeliver(payload, checkpoint, cargoState, targetDepleted) {
  if (!cargoState || cargoState.quantity <= 0) return false;
  if (checkpoint.deliveryRequired === true) return true;
  if (checkpoint.noTargetWithCargo === true) return true;
  const goal = Math.max(0, toFiniteNumber(payload.quantityGoal, 0));
  if (goal > 0 && checkpoint.deliveredQuantity + cargoState.quantity >= goal) return true;
  const threshold = Math.min(1, Math.max(0.01, toFiniteNumber(payload.cargoThresholdRatio, 0.85)));
  if (cargoState.capacityM3 > 0 && cargoState.usedVolumeM3 / cargoState.capacityM3 >= threshold) {
    return true;
  }
  return targetDepleted && payload.deliverOnTargetDepleted !== false;
}

function tickNpcResourceJob(context) {
  const { job, entity, controller, nowMs } = context;
  const payload = job.payload || {};
  const checkpoint = buildCheckpoint(job);
  const resourceKind = getResourceKindForJob(job);
  const definition = getNpcResourceDefinition(resourceKind);
  if (!definition) {
    return suspended("unsupported-resource", checkpoint, nowMs, "NPC_RESOURCE_KIND_UNSUPPORTED", 30_000);
  }
  if (
    toPositiveInt(entity && entity.npcCharacterID, 0) !== job.npcCharacterID ||
    toPositiveInt(entity && entity.npcIncarnation, 0) !== job.incarnation ||
    entity.transient === true
  ) {
    return {
      status: behaviorRuntime.STATUS.FAILURE,
      step: "invalid-assignment",
      checkpoint,
      error: "NPC_RESOURCE_ASSIGNMENT_INVALID",
    };
  }
  if (payload.systemID && toPositiveInt(payload.systemID, 0) !== toPositiveInt(entity.systemID, 0)) {
    return suspended("awaiting-system", checkpoint, nowMs, "NPC_RESOURCE_WRONG_SYSTEM", 5_000);
  }
  if (isRecentThreat(context, payload)) {
    if (typeof definition.deactivate === "function") definition.deactivate(context, checkpoint);
    return suspended(
      "threat-interrupted",
      checkpoint,
      nowMs,
      "NPC_RESOURCE_THREAT_INTERRUPTED",
      Math.max(500, toFiniteNumber(payload.threatCooldownMs, 15_000)),
    );
  }

  let tool = definition.resolveTool(context, resourceKind, checkpoint);
  if (!tool) {
    const provisioned = maybeProvisionTool(context, payload, checkpoint);
    if (provisioned && provisioned.success === true) {
      tool = definition.resolveTool(context, resourceKind, checkpoint);
    }
  }
  if (!tool) {
    buildToolRequest(context, resourceKind, checkpoint);
    return suspended("awaiting-tool", checkpoint, nowMs, "NPC_RESOURCE_TOOL_REQUIRED", 5_000);
  }
  checkpoint.toolModuleID = toPositiveInt(tool.moduleItem && tool.moduleItem.itemID, 0);
  checkpoint.toolActivationMode = tool.activationMode || "generic";
  checkpoint.toolRequestedAtMs = 0;
  checkpoint.toolRequest = null;

  const cargoState = typeof definition.getCargoState === "function"
    ? definition.getCargoState(context, resourceKind, checkpoint)
    : { usedVolumeM3: 0, capacityM3: 0, quantity: 0 };
  let target = checkpoint.targetID > 0 && typeof definition.getTarget === "function"
    ? definition.getTarget(context, checkpoint.targetID)
    : null;
  const targetDepleted = Boolean(
    checkpoint.targetID > 0 &&
    (!target || typeof definition.isTargetDepleted === "function" &&
      definition.isTargetDepleted(context, target)),
  );

  if (shouldDeliver(payload, checkpoint, cargoState, targetDepleted)) {
    checkpoint.deliveryRequired = true;
    if (typeof definition.deactivate === "function") definition.deactivate(context, checkpoint);
    releaseTargetReservation(job, checkpoint);
    const destination = destinationFromPayload(payload);
    if (!destination) {
      checkpoint.destinationRequest = {
        jobID: job.jobID,
        entityID: entity.itemID,
        resourceKind,
        requestedAtMs: checkpoint.destinationRequest && checkpoint.destinationRequest.requestedAtMs || Date.now(),
      };
      return suspended(
        "awaiting-destination",
        checkpoint,
        nowMs,
        "NPC_RESOURCE_DESTINATION_REQUIRED",
        5_000,
      );
    }
    if (destination.entityID > 0 && destination.entityID !== toPositiveInt(entity.itemID, 0)) {
      const destinationEntity = context.scene && context.scene.getEntityByID(destination.entityID);
      if (!destinationEntity) {
        return suspended("awaiting-destination", checkpoint, nowMs, "NPC_RESOURCE_DESTINATION_UNAVAILABLE", 5_000);
      }
      const distance = miningRuntime.getSurfaceDistance(entity, destinationEntity);
      if (distance > destination.interactionRangeMeters) {
        if (context.scene && typeof context.scene.followShipEntity === "function") {
          context.scene.followShipEntity(
            entity,
            destination.entityID,
            destination.interactionRangeMeters,
            { queueHistorySafeContract: true, suppressFreshAcquireReplay: true },
          );
        }
        return running("travel-delivery", checkpoint, nowMs, 500);
      }
    }
    const delivery = deliverNpcResourceCargo({
      jobID: job.jobID,
      entityID: entity.itemID,
      destinationLocationID: destination.locationID,
      destinationFlagID: destination.flagID,
      idempotencyKey: `npc-resource-delivery:${job.jobID}:${checkpoint.deliveryCount}`,
    });
    if (!delivery.success) {
      return suspended("delivery-retry", checkpoint, nowMs, delivery.errorMsg, 5_000);
    }
    checkpoint.deliveredQuantity += Math.max(
      0,
      toPositiveInt(delivery.data && delivery.data.deliveredQuantity, 0),
    );
    checkpoint.deliveryCount += 1;
    checkpoint.lastDelivery = cloneValue(delivery.data || null);
    checkpoint.noTargetWithCargo = false;
    checkpoint.deliveryRequired = false;
    const goal = Math.max(0, toFiniteNumber(payload.quantityGoal, 0));
    if (goal > 0 && checkpoint.deliveredQuantity >= goal) return success(checkpoint);
    if (payload.continuous !== true) return success(checkpoint);
    return running("acquire-target", checkpoint, nowMs, 250);
  }

  if (targetDepleted) {
    if (typeof definition.deactivate === "function") definition.deactivate(context, checkpoint);
    releaseTargetReservation(job, checkpoint);
    if (cargoState.quantity <= 0 && payload.continuous !== true) return success(checkpoint);
    target = null;
  }

  if (!target) {
    const candidates = definition.listTargets(context, tool, resourceKind, checkpoint) || [];
    for (const candidate of candidates) {
      const targetID = toPositiveInt(
        (candidate && candidate.entity && candidate.entity.itemID) ??
        (candidate && candidate.itemID),
        0,
      );
      if (!targetID) continue;
      const resourceKey = typeof definition.getReservationKey === "function"
        ? definition.getReservationKey(context, candidate)
        : `resource-target:${toPositiveInt(entity.systemID, 0)}:${targetID}`;
      const reservation = persistence.acquireNpcJobReservation(job.jobID, {
        resourceKey,
        kind: `resource-target:${resourceKind}`,
        target: { systemID: toPositiveInt(entity.systemID, 0), entityID: targetID },
        ttlMs: Math.max(5_000, toFiniteNumber(payload.reservationTtlMs, 60_000)),
        nowMs: Date.now(),
      });
      if (!reservation.success) continue;
      target = candidate.entity || candidate;
      checkpoint.targetID = targetID;
      checkpoint.targetResourceKey = resourceKey;
      checkpoint.targetAcquiredAtMs = Date.now();
      checkpoint.noTargetWithCargo = false;
      break;
    }
    if (!target) {
      if (cargoState.quantity > 0) {
        checkpoint.noTargetWithCargo = true;
        return running("select-destination", checkpoint, nowMs, 250);
      }
      return suspended("awaiting-target", checkpoint, nowMs, "NPC_RESOURCE_TARGET_UNAVAILABLE", 5_000);
    }
  } else if (checkpoint.targetResourceKey) {
    const renewed = persistence.acquireNpcJobReservation(job.jobID, {
      resourceKey: checkpoint.targetResourceKey,
      kind: `resource-target:${resourceKind}`,
      target: { systemID: toPositiveInt(entity.systemID, 0), entityID: checkpoint.targetID },
      ttlMs: Math.max(5_000, toFiniteNumber(payload.reservationTtlMs, 60_000)),
      nowMs: Date.now(),
    });
    if (!renewed.success) {
      checkpoint.targetID = 0;
      checkpoint.targetResourceKey = null;
      return running("acquire-target", checkpoint, nowMs, 250);
    }
  }

  const targetState = typeof definition.getTargetState === "function"
    ? definition.getTargetState(context, target)
    : null;
  if (targetState && typeof definition.isToolCompatible === "function" &&
      !definition.isToolCompatible(context, tool, targetState, target)) {
    releaseTargetReservation(job, checkpoint);
    return suspended("awaiting-compatible-target", checkpoint, nowMs, "NPC_RESOURCE_TOOL_TARGET_MISMATCH", 2_000);
  }
  const rangeMeters = Math.max(
    1,
    toFiniteNumber(tool.rangeMeters, toFiniteNumber(payload.interactionRangeMeters, 10_000)),
  );
  const distanceMeters = typeof definition.getDistance === "function"
    ? definition.getDistance(context, target)
    : miningRuntime.getSurfaceDistance(entity, target);
  if (distanceMeters > rangeMeters) {
    const approached = typeof definition.approach === "function"
      ? definition.approach(context, target, tool, rangeMeters)
      : false;
    if (approached === false) {
      return suspended("travel-retry", checkpoint, nowMs, "NPC_RESOURCE_TRAVEL_FAILED", 1_000);
    }
    return running("travel-target", checkpoint, nowMs, 500);
  }
  if (typeof definition.lockTarget === "function") {
    const lock = definition.lockTarget(context, target, tool);
    if (!lock || lock.success !== true) {
      if (lock && lock.errorMsg === "TARGET_NOT_FOUND") releaseTargetReservation(job, checkpoint);
      return running("lock-target", checkpoint, nowMs, 500, {
        error: lock && lock.errorMsg || null,
      });
    }
  }
  if (typeof definition.approach === "function") {
    definition.approach(context, target, tool, rangeMeters);
  }
  const activation = typeof definition.activate === "function"
    ? definition.activate(context, target, tool, resourceKind, checkpoint)
    : { success: true };
  if (!activation || activation.success !== true) {
    return suspended(
      "activation-retry",
      checkpoint,
      nowMs,
      activation && activation.errorMsg || "NPC_RESOURCE_ACTIVATION_FAILED",
      1_000,
    );
  }
  checkpoint.lastActivatedAtMs = Date.now();
  checkpoint.lastTargetState = cloneValue(targetState);
  return running("harvesting", checkpoint, nowMs, 500);
}

function createNpcResourceJob(input: Record<string, any>) {
  const entityID = toPositiveInt(input && input.entityID, 0);
  const entityRecord = nativeNpcStore.getNativeEntity(entityID);
  if (!entityRecord || entityRecord.transient === true) {
    return { success: false, errorMsg: "NPC_DURABLE_ENTITY_NOT_FOUND" };
  }
  const resourceKind = normalizeResourceKind(input && input.resourceKind || "mining");
  if (!getNpcResourceDefinition(resourceKind)) {
    return { success: false, errorMsg: "NPC_RESOURCE_KIND_UNSUPPORTED" };
  }
  try {
    return persistence.createNpcJob({
      npcCharacterID: toPositiveInt(entityRecord.npcCharacterID, 0),
      incarnation: toPositiveInt(entityRecord.npcIncarnation, 0),
      jobType: String(input.jobType || "resource.work"),
      idempotencyKey: input.idempotencyKey,
      target: cloneValue(input.target || null),
      payload: {
        ...(cloneValue(input.payload || {})),
        resourceKind,
        systemID: toPositiveInt(input.systemID, toPositiveInt(entityRecord.systemID, 0)),
        destination: cloneValue(input.destination || input.payload && input.payload.destination || null),
      },
    });
  } catch (error) {
    return { success: false, errorMsg: error.message || "NPC_RESOURCE_JOB_CREATE_FAILED" };
  }
}

const miningDefinition = {
  resolveTool(context, resourceKind) {
    const entityID = toPositiveInt(context.entity && context.entity.itemID, 0);
    const equipmentByID = new Map(
      npcFittingService.listNpcEquipment(entityID)
        .filter((entry) => (
          (
            Array.isArray(entry.semanticRoles)
              ? entry.semanticRoles
              : [entry.semanticRole]
          ).includes("mining") && entry.usable === true
        ))
        .map((entry) => [toPositiveInt(entry.moduleID, 0), entry]),
    );
    const requestedModuleID = toPositiveInt(context.job.payload && context.job.payload.toolModuleID, 0);
    for (const moduleItem of getNpcFittedModuleItems(context.entity)) {
      const moduleID = toPositiveInt(moduleItem && moduleItem.itemID, 0);
      if (requestedModuleID && moduleID !== requestedModuleID) continue;
      if (!equipmentByID.has(moduleID) || !fitting.isModuleOnline(moduleItem)) continue;
      const heldBeam = miningRuntime.isFrontierHeldBeamMiningModuleType(moduleItem.typeID);
      const crudeExtractor = miningRuntime.isCrudeExtractorModuleType(moduleItem.typeID);
      if (resourceKind === "crude" && !crudeExtractor) continue;
      if (resourceKind !== "crude" && crudeExtractor) continue;
      const effectRecord = heldBeam
        ? null
        : miningRuntime.findMiningEffectRecordForModule(moduleItem);
      if (!heldBeam && !effectRecord) continue;
      const chargeItem = getNpcLoadedChargeForModule(context.entity, moduleItem);
      const snapshot = miningRuntime.buildEntityMiningSnapshot(
        context.entity,
        moduleItem,
        effectRecord,
        { nowMs: context.nowMs, chargeItem },
      );
      if (!snapshot) continue;
      if (
        !chargeItem &&
        (heldBeam || miningRuntime.miningModuleUsesCrystals(moduleItem.typeID))
      ) continue;
      if (["mining", "crude"].includes(resourceKind)) {
        if (snapshot.family !== "ore") continue;
      } else if (snapshot.family !== resourceKind) {
        continue;
      }
      return {
        moduleItem,
        effectRecord,
        chargeItem,
        snapshot,
        activationMode: heldBeam ? "held_beam" : "generic",
        rangeMeters: Math.max(1, toFiniteNumber(snapshot.maxRangeMeters, 10_000)),
      };
    }
    return null;
  },
  listTargets(context, tool, resourceKind) {
    const explicitTargetID = toPositiveInt(
      context.job.target && (context.job.target.entityID || context.job.target.targetID) ||
      context.job.payload && context.job.payload.targetID,
      0,
    );
    return miningRuntime.resolveMineableCandidates(context.scene, context.entity)
      .filter((entry) => !explicitTargetID || toPositiveInt(entry.entity && entry.entity.itemID, 0) === explicitTargetID)
      .filter((entry) => {
        const yieldKind = String(entry.state && entry.state.yieldKind || "").toLowerCase();
        const crudeRift = miningRuntime.isCrudeRiftMineableState(entry.state, entry.entity);
        if (resourceKind === "crude") return crudeRift;
        if (resourceKind === "mining") {
          return (
            (yieldKind === "ore" && !crudeRift) ||
            (
              yieldKind === "salvage" &&
              toPositiveInt(entry.entity && entry.entity.groupID, 0) ===
                miningRuntime.FRONTIER_SALVAGEABLE_WRECKAGE_GROUP_ID
            )
          );
        }
        return yieldKind === resourceKind;
      })
      .filter((entry) => miningRuntime.isMiningSnapshotCompatibleWithState(
        tool.snapshot,
        entry.state,
        entry.entity,
        { chargeItem: tool.chargeItem },
      ))
      .sort((left, right) =>
        miningRuntime.getSurfaceDistance(context.entity, left.entity) -
          miningRuntime.getSurfaceDistance(context.entity, right.entity) ||
        toPositiveInt(left.entity && left.entity.itemID, 0) -
          toPositiveInt(right.entity && right.entity.itemID, 0));
  },
  getTarget(context, targetID) {
    return context.scene && context.scene.getEntityByID(toPositiveInt(targetID, 0));
  },
  getTargetState(context, target) {
    return getMineableState(context.scene, toPositiveInt(target && target.itemID, 0));
  },
  isTargetDepleted(context, target) {
    const state = this.getTargetState(context, target);
    return !state || toFiniteNumber(state.remainingQuantity, 0) <= 0;
  },
  isToolCompatible(context, tool, targetState, target) {
    return miningRuntime.isMiningSnapshotCompatibleWithState(
      tool.snapshot,
      targetState,
      target,
      { chargeItem: tool.chargeItem },
    );
  },
  getDistance(context, target) {
    return miningRuntime.getSurfaceDistance(context.entity, target);
  },
  approach(context, target, tool) {
    const orbitDistance = Math.max(
      500,
      Math.min(
        Math.max(500, toFiniteNumber(tool.rangeMeters, 10_000) * 0.5),
        Math.max(500, toFiniteNumber(context.job.payload && context.job.payload.orbitDistanceMeters, 1_000)),
      ),
    );
    return getMiningNpcOperations().syncMiningApproachOrder(
      context.scene,
      context.entity,
      target,
      orbitDistance,
    );
  },
  lockTarget(context, target, tool) {
    if (tool.activationMode === "held_beam") {
      return { success: true, lockFree: true };
    }
    return getMiningNpcOperations().syncMiningTargetLock(
      context.scene,
      context.entity,
      target,
      context.nowMs,
      { getTargetsForEntity: miningRuntime.getTargetsForEntity },
    );
  },
  activate(context, target, tool, resourceKind, checkpoint) {
    if (tool.activationMode === "held_beam") {
      const targetID = toPositiveInt(target && target.itemID, 0);
      const durationMs = Math.max(250, toFiniteNumber(tool.snapshot && tool.snapshot.durationMs, 1_000));
      if (toPositiveInt(checkpoint.heldBeamTargetID, 0) !== targetID) {
        checkpoint.heldBeamTargetID = targetID;
        checkpoint.heldBeamNextCycleAtMs = context.nowMs + durationMs;
        return { success: true, active: true, spooling: true };
      }
      if (toFiniteNumber(checkpoint.heldBeamNextCycleAtMs, 0) > context.nowMs) {
        return { success: true, active: true };
      }
      const result = miningRuntime.executeSkillShotMiningCycle(
        context.scene,
        context.entity,
        target,
        tool.moduleItem,
        tool.chargeItem,
        context.nowMs,
        {
          rampMultiplier: 1,
          applyCrystalVolatility: true,
        },
      );
      if (!result || result.matched !== true || result.success !== true) {
        const stopReason = result && result.stopReason || "module";
        const errorByReason = {
          charge: "NPC_RESOURCE_LENS_INVALID",
          cargo: "NPC_RESOURCE_CARGO_FULL",
          target: "NPC_RESOURCE_TARGET_UNAVAILABLE",
          module: "NPC_RESOURCE_TOOL_TARGET_MISMATCH",
          range: "NPC_RESOURCE_TARGET_OUT_OF_RANGE",
        };
        return {
          success: false,
          errorMsg: errorByReason[stopReason] || "NPC_RESOURCE_ACTIVATION_FAILED",
        };
      }
      checkpoint.heldBeamLastCycleAtMs = context.nowMs;
      checkpoint.heldBeamNextCycleAtMs = context.nowMs + durationMs;
      checkpoint.lastHeldBeamResult = cloneValue(result.data || null);
      return { success: true, active: true, data: result.data || null };
    }
    const activeEffect = context.entity.activeModuleEffects instanceof Map
      ? context.entity.activeModuleEffects.get(toPositiveInt(tool.moduleItem.itemID, 0))
      : null;
    if (activeEffect && toPositiveInt(activeEffect.targetID, 0) === toPositiveInt(target.itemID, 0)) {
      return { success: true, active: true };
    }
    if (activeEffect && context.scene && typeof context.scene.deactivateGenericModule === "function") {
      context.scene.deactivateGenericModule(
        miningRuntime.buildNpcPseudoSession(context.entity),
        tool.moduleItem.itemID,
        { reason: "target" },
      );
    }
    if (!context.scene || typeof context.scene.activateGenericModule !== "function") {
      return { success: false, errorMsg: "NPC_RESOURCE_ACTIVATION_UNSUPPORTED" };
    }
    const result = context.scene.activateGenericModule(
      miningRuntime.buildNpcPseudoSession(context.entity),
      tool.moduleItem,
      tool.effectRecord.name,
      { targetID: target.itemID },
    );
    return result && result.success === false ? result : { success: true, data: result && result.data };
  },
  deactivate(context, checkpoint) {
    if (checkpoint && checkpoint.toolActivationMode === "held_beam") {
      checkpoint.heldBeamTargetID = 0;
      checkpoint.heldBeamNextCycleAtMs = 0;
      return;
    }
    const moduleID = toPositiveInt(checkpoint && checkpoint.toolModuleID, 0);
    if (!moduleID || !context.scene || typeof context.scene.deactivateGenericModule !== "function") return;
    context.scene.deactivateGenericModule(
      miningRuntime.buildNpcPseudoSession(context.entity),
      moduleID,
      { reason: "resource-job" },
    );
  },
  getCargoState(context) {
    const miningNpcOperations = getMiningNpcOperations();
    const summary = miningNpcOperations.getNpcOreCargoSummary(context.entity);
    return {
      ...summary,
      capacityM3: miningNpcOperations.getNpcCargoCapacityM3(
        context.entity,
        toFiniteNumber(context.job.payload && context.job.payload.cargoCapacityM3, 0),
      ),
    };
  },
};

for (const kind of ["mining", "crude", "gas", "ice"]) {
  resourceDefinitions.set(kind, miningDefinition);
}

function registerNpcResourceJobHandlers() {
  if (handlersRegistered) return;
  for (const jobType of RESOURCE_JOB_TYPES) {
    behaviorRuntime.registerNpcJobHandler(jobType, tickNpcResourceJob);
  }
  handlersRegistered = true;
}

module.exports = {
  RESOURCE_JOB_TYPES,
  registerNpcResourceDefinition,
  getNpcResourceDefinition,
  registerNpcResourceJobHandlers,
  createNpcResourceJob,
  tickNpcResourceJob,
  deliverNpcResourceCargo,
  recoverNpcResourceOperation,
  _testing: {
    resourceDefinitions,
    buildCheckpoint,
    shouldDeliver,
    finishResourceDeliveryOperation,
  },
};
