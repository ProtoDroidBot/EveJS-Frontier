"use strict";

const path = require("path");

const database = require(path.join(__dirname, "../../gameStore"));
const itemStore = require(path.join(__dirname, "../../services/inventory/itemStore"));
const stargates = require(path.join(
  __dirname,
  "../../services/frontier/celestialStargateRuntime",
));
const nativeNpcStore = require("./nativeNpcStore");
const persistence = require("./npcRuntimePersistence");
const behaviorRuntime = require("./npcBehaviorTreeRuntime");
const {
  createNpcAssemblyActorContext,
  publicNpcAssemblyOperator,
} = require("./npcAssemblyActorContext");

const JOB_TYPE = "maintenance.stargate";
const TERMINAL_OPERATION_STATUSES = new Set(["committed", "compensated", "failed"]);
const DEFAULT_RESERVATION_TTL_MS = 120_000;
const DEFAULT_INTERACTION_RANGE_METERS = 10_000;
let handlersRegistered = false;

function cloneValue(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function positiveInt(value, fallback = 0) {
  const numeric = Math.trunc(Number(value) || 0);
  return numeric > 0 ? numeric : fallback;
}

function itemQuantity(item) {
  return Number(item && item.singleton) === 1
    ? 1
    : Math.max(0, positiveInt(item && (item.stacksize ?? item.quantity), 0));
}

function surfaceDistance(left, right) {
  const leftPosition = left && left.position || {};
  const rightPosition = right && right.position || {};
  const centerDistance = Math.hypot(
    Number(leftPosition.x || 0) - Number(rightPosition.x || 0),
    Number(leftPosition.y || 0) - Number(rightPosition.y || 0),
    Number(leftPosition.z || 0) - Number(rightPosition.z || 0),
  );
  return Math.max(0, centerDistance - Math.max(0, Number(left && left.radius) || 0) -
    Math.max(0, Number(right && right.radius) || 0));
}

function running(step, checkpoint, nowMs, delayMs = 250) {
  return {
    status: behaviorRuntime.STATUS.RUNNING,
    step,
    checkpoint,
    nextWakeAtMs: Math.max(0, Number(nowMs) || 0) + Math.max(50, delayMs),
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
  return { status: behaviorRuntime.STATUS.SUCCESS, step: "completed", checkpoint };
}

function defaultAdapters() {
  return {
    getState: stargates.getStargateState,
    prepareDeposit: stargates.prepareStargateResourceDeposit,
    commitDeposit: stargates.commitStargateResourceDeposit,
    cancelDeposit: stargates.cancelStargateResourceDeposit,
    getReceipt: stargates.getDepositReceipt,
    requestReactivation: stargates.requestStargateReactivation,
    settleReactivation: stargates.settleStargateReactivation,
    noteMaintenanceRequested: stargates.noteMaintenanceRequested,
    consumeItems: itemStore.consumeInventoryItems,
  };
}

let adapters: Record<string, any> = defaultAdapters();

function configureNpcStargateMaintenanceAdapters(overrides: Record<string, any> = {}) {
  adapters = { ...defaultAdapters(), ...overrides };
  return () => { adapters = defaultAdapters(); };
}

function listNpcCargoItems(entityID) {
  return nativeNpcStore.listNativeCargoForEntity(entityID)
    .filter((record) => positiveInt(record.moduleID, 0) === 0)
    .map((record) => ({ record, item: itemStore.findItemById(record.cargoID) }))
    .filter((entry) => entry.item && positiveInt(entry.item.locationID, 0) === entityID)
    .sort((left, right) => positiveInt(left.item.itemID, 0) - positiveInt(right.item.itemID, 0));
}

function planRequiredCargo(entityID, gateState) {
  const candidates = listNpcCargoItems(entityID);
  const plan: any[] = [];
  const missing: any[] = [];
  const requirements = [
    ...(gateState.requirements?.materials || []),
    ...(gateState.requirements?.fuel || []),
  ];
  for (const requirement of requirements) {
    let remaining = positiveInt(requirement.remainingQuantity, 0);
    for (const candidate of candidates) {
      if (remaining <= 0 || positiveInt(candidate.item.typeID, 0) !== requirement.typeID) continue;
      const existing = plan.find((entry) => entry.itemID === candidate.item.itemID);
      const available = itemQuantity(candidate.item) - (existing ? existing.quantity : 0);
      const quantity = Math.min(remaining, Math.max(0, available));
      if (quantity <= 0) continue;
      if (existing) {
        // One item type cannot satisfy both material and fuel requirements in
        // a single authored gate profile; reject such ambiguous profiles.
        if (existing.kind !== requirement.kind) {
          return { success: false, errorMsg: "STARGATE_REQUIREMENT_KIND_CONFLICT", data: [], missing: [] };
        }
        existing.quantity += quantity;
      } else {
        plan.push({
          kind: requirement.kind,
          itemID: candidate.item.itemID,
          typeID: requirement.typeID,
          quantity,
          beforeQuantity: itemQuantity(candidate.item),
          ownerID: candidate.item.ownerID,
          locationID: candidate.item.locationID,
          flagID: candidate.item.flagID,
        });
      }
      remaining -= quantity;
    }
    if (remaining > 0) {
      missing.push({ kind: requirement.kind, typeID: requirement.typeID, quantity: remaining });
    }
  }
  return { success: missing.length === 0, data: plan, missing };
}

function reconcileNpcCargo(entityID) {
  for (const record of nativeNpcStore.listNativeCargoForEntity(entityID)) {
    const item = itemStore.findItemById(record.cargoID);
    if (!item || positiveInt(item.locationID, 0) !== entityID) {
      nativeNpcStore.removeNativeCargo(record.cargoID);
      continue;
    }
    nativeNpcStore.upsertNativeCargo({
      ...record,
      ownerID: item.ownerID,
      typeID: item.typeID,
      quantity: itemQuantity(item),
      singleton: Number(item.singleton) === 1,
    }, { durable: true });
  }
  database.flushTablesSync([itemStore.ITEMS_TABLE, nativeNpcStore.TABLE.CARGO]);
}

function inventoryConsumptionState(entries) {
  let allBefore = true;
  let allAfter = true;
  for (const entry of entries) {
    const item = itemStore.findItemById(entry.itemID);
    const currentQuantity = item ? itemQuantity(item) : 0;
    const expectedAfter = entry.beforeQuantity - entry.quantity;
    allBefore = allBefore && currentQuantity === entry.beforeQuantity;
    allAfter = allAfter && currentQuantity === expectedAfter;
  }
  if (allBefore) return "before";
  if (allAfter) return "after";
  return "conflict";
}

function finishStargateMaintenanceOperation(operation, options: Record<string, any> = {}) {
  const payload = operation && operation.payload || {};
  const operationKey = operation.idempotencyKey;
  const gateID = positiveInt(payload.stargateID, 0);
  const entityID = positiveInt(payload.entityID, 0);
  const entries = Array.isArray(payload.entries) ? payload.entries : [];
  if (!gateID || !entityID || entries.length === 0) {
    return { success: false, errorMsg: "NPC_STARGATE_OPERATION_INVALID" };
  }
  const receipt = adapters.getReceipt(gateID, operationKey);
  if (receipt) {
    if (operation.status !== "committed") {
      reconcileNpcCargo(entityID);
      persistence.commitNpcOperation(operation.operationID, {
        flushTables: [itemStore.ITEMS_TABLE, nativeNpcStore.TABLE.CARGO, stargates.TABLE],
        result: { ...cloneValue(receipt), recovered: options.recovered === true },
      });
    }
    return { success: true, data: cloneValue(receipt), idempotent: true };
  }

  const prepared = adapters.prepareDeposit(
    gateID,
    entries.map((entry) => ({ kind: entry.kind, typeID: entry.typeID, quantity: entry.quantity })),
    { operationKey, actor: cloneValue(payload.actor || null) },
  );
  if (!prepared?.success) return prepared || { success: false, errorMsg: "STARGATE_DEPOSIT_PREPARE_FAILED" };

  const consumptionState = inventoryConsumptionState(entries);
  if (consumptionState === "conflict") {
    adapters.cancelDeposit(gateID, operationKey);
    return { success: false, errorMsg: "NPC_STARGATE_CARGO_CHANGED" };
  }
  if (consumptionState === "before") {
    const consumed = adapters.consumeItems(entries.map((entry) => ({
      itemID: entry.itemID,
      quantity: entry.quantity,
      expected: {
        ownerID: entry.ownerID,
        locationID: entry.locationID,
        flagID: entry.flagID,
        typeID: entry.typeID,
      },
    })), { flush: true });
    if (!consumed?.success) {
      adapters.cancelDeposit(gateID, operationKey);
      return consumed || { success: false, errorMsg: "NPC_STARGATE_CARGO_CONSUME_FAILED" };
    }
    reconcileNpcCargo(entityID);
  }
  persistence.checkpointNpcOperation(operation.operationID, "inventory-consumed", {
    inventoryConsumedAtMs: payload.inventoryConsumedAtMs || Date.now(),
  }, { flushTables: [itemStore.ITEMS_TABLE, nativeNpcStore.TABLE.CARGO] });

  const committed = adapters.commitDeposit(gateID, operationKey);
  if (!committed?.success) return committed || { success: false, errorMsg: "STARGATE_DEPOSIT_COMMIT_FAILED" };
  const result = {
    ...(cloneValue(committed.data || {})),
    stargateID: gateID,
    recovered: options.recovered === true,
  };
  persistence.commitNpcOperation(operation.operationID, {
    flushTables: [itemStore.ITEMS_TABLE, nativeNpcStore.TABLE.CARGO, stargates.TABLE],
    result,
  });
  return { success: true, data: result };
}

function runStargateMaintenanceOperation(job, actor, plan) {
  const operationKey = `npc-stargate-deposit:${job.jobID}`;
  const operation = persistence.beginNpcOperation(
    "npc-stargate-maintenance-deposit",
    operationKey,
    {
      jobID: job.jobID,
      stargateID: positiveInt(job.target?.stargateID ?? job.payload?.stargateID, 0),
      entityID: actor.shipID,
      actor: publicNpcAssemblyOperator(actor),
      entries: cloneValue(plan),
    },
  ).data;
  if (operation.status === "committed") {
    return { success: true, data: { ...cloneValue(operation.result || {}), idempotent: true } };
  }
  if (TERMINAL_OPERATION_STATUSES.has(operation.status)) {
    return { success: false, errorMsg: operation.lastError || "NPC_STARGATE_OPERATION_TERMINAL" };
  }
  return finishStargateMaintenanceOperation(operation);
}

function recoverNpcStargateMaintenanceOperation(operation) {
  if (!operation || operation.operationType !== "npc-stargate-maintenance-deposit") {
    return { success: false, errorMsg: "NPC_STARGATE_OPERATION_UNSUPPORTED" };
  }
  if (TERMINAL_OPERATION_STATUSES.has(operation.status)) {
    return { success: true, recovered: false };
  }
  return finishStargateMaintenanceOperation(operation, { recovered: true });
}

function tickNpcStargateMaintenanceJob(context) {
  const { job, entity, nowMs } = context;
  const checkpoint = { ...(cloneValue(job.checkpoint || {})) };
  if (entity.transient === true || positiveInt(entity.npcCharacterID, 0) !== job.npcCharacterID ||
      positiveInt(entity.npcIncarnation, 0) !== job.incarnation) {
    return {
      status: behaviorRuntime.STATUS.FAILURE,
      step: "invalid-assignment",
      checkpoint,
      error: "NPC_STARGATE_ASSIGNMENT_INVALID",
    };
  }
  let actor;
  try {
    actor = createNpcAssemblyActorContext(
      nativeNpcStore.getNativeEntity(positiveInt(entity.entityID ?? entity.itemID, 0)),
      { requireSui: false },
    );
  } catch (error) {
    return suspended("awaiting-identity", checkpoint, nowMs, error.code || error.message, 5_000);
  }
  const gateID = positiveInt(job.target?.stargateID ?? job.payload?.stargateID, 0);
  const gateResult = adapters.getState(gateID);
  if (!gateResult?.success) {
    return suspended("awaiting-gate", checkpoint, nowMs, gateResult?.errorMsg || "STARGATE_NOT_MANAGED", 10_000);
  }
  const gate = gateResult.data;
  if (gate.solarSystemID !== actor.solarSystemID) {
    return suspended("awaiting-system", checkpoint, nowMs, "NPC_STARGATE_WRONG_SYSTEM", 5_000);
  }
  const gateEntity = context.scene && typeof context.scene.getEntityByID === "function"
    ? context.scene.getEntityByID(gateID)
    : null;
  if (!gateEntity) {
    return suspended("awaiting-gate-entity", checkpoint, nowMs, "STARGATE_ENTITY_UNAVAILABLE", 2_000);
  }
  const interactionRangeMeters = Math.max(
    1,
    Number(job.payload?.interactionRangeMeters) || DEFAULT_INTERACTION_RANGE_METERS,
  );
  const distanceMeters = context.scene &&
      typeof context.scene.getCommandTimeEntitySurfaceDistance === "function"
    ? context.scene.getCommandTimeEntitySurfaceDistance(entity, gateEntity)
    : surfaceDistance(entity, gateEntity);
  if (!Number.isFinite(distanceMeters) || distanceMeters > interactionRangeMeters) {
    if (context.scene && typeof context.scene.followShipEntity === "function") {
      context.scene.followShipEntity(entity, gateID, interactionRangeMeters, {
        queueHistorySafeContract: true,
        suppressFreshAcquireReplay: true,
      });
      return running("travel-gate", checkpoint, nowMs, 500);
    }
    return suspended("travel-retry", checkpoint, nowMs, "NPC_STARGATE_TRAVEL_FAILED", 1_000);
  }
  const reserved = persistence.acquireNpcJobReservation(job.jobID, {
    resourceKey: `stargate:${gateID}`,
    kind: "stargate-maintenance",
    target: { stargateID: gateID, solarSystemID: gate.solarSystemID },
    nowMs,
    ttlMs: positiveInt(job.payload?.reservationTtlMs, DEFAULT_RESERVATION_TTL_MS),
  });
  if (!reserved.success) {
    return suspended("reserve-gate", checkpoint, nowMs, reserved.errorMsg, 2_000);
  }

  if (gate.status === stargates.STARGATE_MAINTENANCE_STATUS.ACTIVE) {
    persistence.releaseNpcJobReservation(job.jobID, `stargate:${gateID}`);
    checkpoint.reactivatedAtMs ||= Date.now();
    return success(checkpoint);
  }
  if (gate.status === stargates.STARGATE_MAINTENANCE_STATUS.REACTIVATING) {
    const settled = adapters.settleReactivation(gateID, {
      actor: publicNpcAssemblyOperator(actor),
    });
    if (!settled?.success) {
      return suspended("reactivation-retry", checkpoint, nowMs, settled?.errorMsg, 2_000);
    }
    if (settled.data?.status === stargates.STARGATE_MAINTENANCE_STATUS.ACTIVE) {
      return running("verify-reactivated", checkpoint, nowMs, 50);
    }
    return running(
      "reactivating",
      checkpoint,
      nowMs,
      Math.max(100, Math.min(5_000, positiveInt(gate.activationCompleteAtMs, nowMs + 1_000) - nowMs)),
    );
  }
  if (gate.resourcesReady || gate.status === stargates.STARGATE_MAINTENANCE_STATUS.READY) {
    const activation = adapters.requestReactivation(gateID, {
      actor: publicNpcAssemblyOperator(actor),
    });
    if (!activation?.success) {
      return suspended("reactivation-retry", checkpoint, nowMs, activation?.errorMsg, 2_000);
    }
    checkpoint.reactivationRequestedAtMs ||= Date.now();
    return running("reactivating", checkpoint, nowMs, 100);
  }

  if (!checkpoint.resourcesDeposited) {
    const planned = planRequiredCargo(actor.shipID, gate);
    if (!planned.success) {
      if (planned.errorMsg) {
        return {
          status: behaviorRuntime.STATUS.FAILURE,
          step: "invalid-requirements",
          checkpoint,
          error: planned.errorMsg,
        };
      }
      adapters.noteMaintenanceRequested(gateID, planned.missing, {
        requestKey: `npc-stargate-maintenance:${job.jobID}`,
        requester: publicNpcAssemblyOperator(actor),
      });
      checkpoint.missing = cloneValue(planned.missing);
      return suspended("awaiting-resources", checkpoint, nowMs, "STARGATE_RESOURCES_REQUIRED", 5_000);
    }
    for (const entry of planned.data) {
      const itemReservation = persistence.acquireNpcJobReservation(job.jobID, {
        resourceKey: `stargate-cargo:${entry.itemID}`,
        kind: "stargate-resource",
        target: { itemID: entry.itemID, stargateID: gateID },
        nowMs,
        ttlMs: positiveInt(job.payload?.reservationTtlMs, DEFAULT_RESERVATION_TTL_MS),
      });
      if (!itemReservation.success) {
        return suspended("reserve-resources", checkpoint, nowMs, itemReservation.errorMsg, 2_000);
      }
    }
    const deposited = runStargateMaintenanceOperation(job, actor, planned.data);
    if (!deposited.success) {
      return suspended("deposit-retry", checkpoint, nowMs, deposited.errorMsg, 5_000);
    }
    checkpoint.resourcesDeposited = true;
    checkpoint.resourcesDepositedAtMs = Date.now();
    checkpoint.missing = [];
    for (const entry of planned.data) {
      persistence.releaseNpcJobReservation(job.jobID, `stargate-cargo:${entry.itemID}`);
    }
    return running("request-reactivation", checkpoint, nowMs, 50);
  }
  checkpoint.resourcesDeposited = false;
  return running("refresh-gate-resources", checkpoint, nowMs, 250);
}

function createNpcStargateMaintenanceJob(input: Record<string, any>) {
  try {
    const entityID = positiveInt(input && input.entityID, 0);
    const entity = nativeNpcStore.getNativeEntity(entityID);
    if (!entity || entity.transient === true) {
      return { success: false, errorMsg: "NPC_DURABLE_ENTITY_NOT_FOUND" };
    }
    const actor = createNpcAssemblyActorContext(entity, { requireSui: false });
    const stargateID = positiveInt(input && (input.stargateID ?? input.target?.stargateID), 0);
    const state = adapters.getState(stargateID);
    if (!state?.success) return state || { success: false, errorMsg: "STARGATE_NOT_MANAGED" };
    if (state.data.solarSystemID !== actor.solarSystemID) {
      return { success: false, errorMsg: "NPC_STARGATE_WRONG_SYSTEM" };
    }
    return persistence.createNpcJob({
      npcCharacterID: actor.actorID,
      incarnation: positiveInt(entity.npcIncarnation, 0),
      jobType: JOB_TYPE,
      idempotencyKey: input.idempotencyKey,
      target: { stargateID, solarSystemID: state.data.solarSystemID },
      payload: {
        ...(cloneValue(input.payload || {})),
        stargateID,
        systemID: state.data.solarSystemID,
        interactionRangeMeters: Math.max(
          1,
          Number(input.interactionRangeMeters ?? input.payload?.interactionRangeMeters) ||
            DEFAULT_INTERACTION_RANGE_METERS,
        ),
      },
    });
  } catch (error) {
    return { success: false, errorMsg: error.code || error.message || "NPC_STARGATE_JOB_CREATE_FAILED" };
  }
}

function registerNpcStargateMaintenanceJobHandlers() {
  if (handlersRegistered) return;
  behaviorRuntime.registerNpcJobHandler(JOB_TYPE, tickNpcStargateMaintenanceJob);
  handlersRegistered = true;
}

module.exports = {
  JOB_TYPE,
  createNpcStargateMaintenanceJob,
  tickNpcStargateMaintenanceJob,
  recoverNpcStargateMaintenanceOperation,
  registerNpcStargateMaintenanceJobHandlers,
  configureNpcStargateMaintenanceAdapters,
  _testing: {
    planRequiredCargo,
    inventoryConsumptionState,
    finishStargateMaintenanceOperation,
    reconcileNpcCargo,
  },
};
