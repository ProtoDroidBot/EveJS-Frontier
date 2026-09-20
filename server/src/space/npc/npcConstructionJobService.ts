"use strict";

const path = require("path");

const database = require(path.join(__dirname, "../../gameStore"));
const itemStore = require(path.join(__dirname, "../../services/inventory/itemStore"));
const deploymentRuntime = require(path.join(__dirname, "../../services/frontier/deploymentRuntime"));
const fuelRuntime = require(path.join(__dirname, "../../services/frontier/networkNodeFuelRuntime"));
const requestRuntime = require(path.join(__dirname, "../../services/frontier/smartAssemblyRequestRuntime"));
const nativeNpcStore = require("./nativeNpcStore");
const transponderMembership = require("./npcTransponderMembership");
const persistence = require("./npcRuntimePersistence");
const behaviorRuntime = require("./npcBehaviorTreeRuntime");
const {
  assertNoSensitiveNpcAssemblyData,
  createNpcAssemblyActorContext,
  normalizeNpcAssemblyActorContext,
  publicNpcAssemblyOperator,
} = require("./npcAssemblyActorContext");

const CONSTRUCTION_JOB_TYPES = Object.freeze([
  "construction.assembly",
  "construction.field",
  "construction.smart",
]);
const TERMINAL_OPERATION_STATUSES = new Set(["committed", "compensated", "failed"]);
const NETWORK_NODE_TYPE_ID = 88_092;
const DEFAULT_RESERVATION_TTL_MS = 120_000;
const NPC_PLACEMENT_ARRIVAL_METERS = 2_250;
const NPC_PLACEMENT_WARP_THRESHOLD_METERS = 150_000;
let handlersRegistered = false;

function cloneValue(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function positiveInt(value, fallback = 0) {
  const numeric = Math.trunc(Number(value) || 0);
  return numeric > 0 ? numeric : fallback;
}

function finiteNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function vectorDistance(left, right) {
  return Math.hypot(
    finiteNumber(left && left.x, 0) - finiteNumber(right && right.x, 0),
    finiteNumber(left && left.y, 0) - finiteNumber(right && right.y, 0),
    finiteNumber(left && left.z, 0) - finiteNumber(right && right.z, 0),
  );
}

function travelNpcBuilderToPlacement(context, actor, position) {
  const target = position && {
    x: finiteNumber(position.x, Number.NaN),
    y: finiteNumber(position.y, Number.NaN),
    z: finiteNumber(position.z, Number.NaN),
  };
  if (!target || !Object.values(target).every(Number.isFinite)) {
    return { success: false, errorMsg: "INVALID_DEPLOYMENT_PLACEMENT" };
  }
  const distance = vectorDistance(context.entity && context.entity.position, target);
  if (distance <= NPC_PLACEMENT_ARRIVAL_METERS) {
    return { success: true, data: { arrived: true, distance } };
  }
  if (context.entity?.mode === "WARP" || context.entity?.pendingWarp || context.entity?.warpState) {
    return { success: true, data: { arrived: false, distance, mode: "warp" } };
  }
  if (distance >= NPC_PLACEMENT_WARP_THRESHOLD_METERS) {
    const warp = require("./npcRuntime").warpToPoint(context.entity.itemID, target, {
      forceImmediateStart: true,
      broadcastWarpStartToVisibleSessions: true,
    });
    return warp?.success
      ? { success: true, data: { arrived: false, distance, mode: "warp" } }
      : warp || { success: false, errorMsg: "NPC_CONSTRUCTION_TRAVEL_FAILED" };
  }
  if (!context.scene || typeof context.scene.gotoPoint !== "function") {
    return { success: false, errorMsg: "NPC_CONSTRUCTION_TRAVEL_UNAVAILABLE" };
  }
  const moved = context.scene.gotoPoint({
    characterID: actor.actorID,
    _space: { systemID: actor.solarSystemID, shipID: actor.shipID },
  }, target, {
    queueHistorySafeContract: true,
    suppressFreshAcquireReplay: true,
  });
  return moved === false
    ? { success: false, errorMsg: "NPC_CONSTRUCTION_TRAVEL_FAILED" }
    : { success: true, data: { arrived: false, distance, mode: "subwarp" } };
}

function itemQuantity(item) {
  return Number(item && item.singleton) === 1
    ? 1
    : Math.max(0, positiveInt(item && (item.stacksize ?? item.quantity), 0));
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
  return { status: behaviorRuntime.STATUS.SUCCESS, step: "completed", checkpoint };
}

function definitionForType(assemblyTypeID) {
  return deploymentRuntime.listAssemblyDefinitions()
    .find((entry) => Number(entry.assemblyTypeID) === Number(assemblyTypeID)) || null;
}

function defaultAdapters() {
  return {
    resolveDefinition: definitionForType,
    planPlacement: deploymentRuntime.planNpcConstructionSitePlacement,
    travelToPlacement: travelNpcBuilderToPlacement,
    findByJobID: deploymentRuntime.findNpcAssemblyByJobID,
    place: deploymentRuntime.placeNpcConstructionSite,
    placeDirect: deploymentRuntime.placeNpcDirectAssembly,
    deposit: deploymentRuntime.depositNpcConstructionMaterials,
    complete: deploymentRuntime.completeNpcConstruction,
    lifecycle: deploymentRuntime.getNpcAssemblyLifecycle,
    completeActivation: deploymentRuntime.completeAssemblyActivation,
    requestState: deploymentRuntime.requestNpcAssemblyState,
    register: deploymentRuntime.registerNpcAssemblyForFaction,
    readFuel: fuelRuntime.readNetworkNodeFuelState,
    fuel: fuelRuntime.depositNpcNetworkNodeFuel,
  };
}

let adapters: Record<string, any> = defaultAdapters();

function configureNpcConstructionAdapters(overrides: Record<string, any> = {}) {
  adapters = { ...defaultAdapters(), ...overrides };
  return () => { adapters = defaultAdapters(); };
}

function normalizeSources(payload, entityRecord, actor) {
  const explicit = Array.isArray(payload && payload.materialSources)
    ? payload.materialSources
    : [];
  const sources = explicit.length ? explicit : [{
    locationID: actor.shipID,
    flagID: itemStore.ITEM_FLAGS.CARGO_HOLD,
    ownerID: positiveInt(entityRecord.ownerID, actor.ownerPrincipalID),
  }];
  const allowedOwners = new Set([
    actor.ownerPrincipalID,
    positiveInt(entityRecord.ownerID, 0),
  ].filter(Boolean));
  return sources.map((source) => ({
    locationID: positiveInt(source && source.locationID, 0),
    flagID: source && source.flagID == null
      ? null
      : Math.max(0, Math.trunc(Number(source.flagID) || 0)),
    ownerID: positiveInt(source && source.ownerID, positiveInt(entityRecord.ownerID, 0)),
  })).filter((source) => source.locationID > 0 && allowedOwners.has(source.ownerID));
}

function planItemsForQuantities(entityRecord, actor, quantities, payload: Record<string, any> = {}) {
  const requestedIDs = Array.isArray(payload.materialItemIDs)
    ? new Set(payload.materialItemIDs.map((value) => positiveInt(value, 0)).filter(Boolean))
    : null;
  const nativeCargoIDs = new Set(
    nativeNpcStore.listNativeCargoForEntity(actor.shipID)
      .filter((record) => positiveInt(record.moduleID, 0) === 0)
      .map((record) => positiveInt(record.cargoID, 0)),
  );
  const candidates: any[] = [];
  for (const source of normalizeSources(payload, entityRecord, actor)) {
    for (const item of itemStore.listContainerItems(source.ownerID, source.locationID, source.flagID)) {
      if (requestedIDs && !requestedIDs.has(positiveInt(item.itemID, 0))) continue;
      if (source.locationID === actor.shipID && !nativeCargoIDs.has(positiveInt(item.itemID, 0))) continue;
      candidates.push({ item, source });
    }
  }
  candidates.sort((left, right) => positiveInt(left.item.itemID, 0) - positiveInt(right.item.itemID, 0));
  const plan: any[] = [];
  const missing: Record<string, number> = {};
  for (const [rawTypeID, rawQuantity] of Object.entries<any>(quantities || {})) {
    const typeID = positiveInt(rawTypeID, 0);
    let remaining = positiveInt(rawQuantity, 0);
    for (const candidate of candidates) {
      if (remaining <= 0 || positiveInt(candidate.item.typeID, 0) !== typeID) continue;
      const already = plan.find((entry) => entry.itemID === candidate.item.itemID);
      const available = itemQuantity(candidate.item) - (already ? already.quantity : 0);
      const quantity = Math.min(remaining, Math.max(0, available));
      if (quantity <= 0) continue;
      if (already) already.quantity += quantity;
      else plan.push({
        itemID: positiveInt(candidate.item.itemID, 0),
        typeID,
        quantity,
        ownerID: positiveInt(candidate.item.ownerID, 0),
        locationID: positiveInt(candidate.item.locationID, 0),
        flagID: Math.max(0, Math.trunc(Number(candidate.item.flagID) || 0)),
      });
      remaining -= quantity;
    }
    if (remaining > 0) missing[String(typeID)] = remaining;
  }
  return {
    success: Object.keys(missing).length === 0,
    data: plan,
    missing,
  };
}

function readConstructionSiteQuantities(itemID) {
  const quantities: Record<string, number> = {};
  for (const item of itemStore.listContainerItems(null, positiveInt(itemID, 0), null)) {
    const typeID = positiveInt(item && item.typeID, 0);
    if (typeID <= 0) continue;
    quantities[String(typeID)] = (quantities[String(typeID)] || 0) + itemQuantity(item);
  }
  return quantities;
}

function outstandingConstructionQuantities(cost, deposited) {
  const outstanding: Record<string, number> = {};
  for (const [rawTypeID, rawRequired] of Object.entries<any>(cost || {})) {
    const typeID = positiveInt(rawTypeID, 0);
    const required = positiveInt(rawRequired, 0);
    const remaining = Math.max(0, required - positiveInt(deposited?.[String(typeID)], 0));
    if (typeID > 0 && remaining > 0) outstanding[String(typeID)] = remaining;
  }
  return outstanding;
}

function planFuelItems(entityRecord, actor, fuelOptions: Record<string, any> = {}) {
  const sources = normalizeSources({ materialSources: fuelOptions.sources }, entityRecord, actor);
  const nativeCargoIDs = new Set(
    nativeNpcStore.listNativeCargoForEntity(actor.shipID)
      .filter((record) => positiveInt(record.moduleID, 0) === 0)
      .map((record) => positiveInt(record.cargoID, 0)),
  );
  const isAllowedSource = (item) => sources.some((source) =>
    source.ownerID === positiveInt(item.ownerID, 0) &&
    source.locationID === positiveInt(item.locationID, 0) &&
    (source.flagID == null || source.flagID === Math.max(0, Math.trunc(Number(item.flagID) || 0))) &&
    (source.locationID !== actor.shipID || nativeCargoIDs.has(positiveInt(item.itemID, 0))),
  );
  const explicit = Array.isArray(fuelOptions.items) ? fuelOptions.items : [];
  if (explicit.length > 0) {
    const plan: any[] = [];
    for (const requested of explicit) {
      const item = itemStore.findItemById(positiveInt(requested && requested.itemID, 0));
      const quantity = positiveInt(requested && requested.quantity, 0);
      if (!item || quantity <= 0 || quantity > itemQuantity(item) ||
          !fuelRuntime.isAcceptedNetworkNodeFuelType(item.typeID)) {
        return { success: false, data: [], missing: { fuel: positiveInt(fuelOptions.quantity, 1) } };
      }
      if (!isAllowedSource(item)) {
        return { success: false, data: [], missing: { fuel: quantity } };
      }
      plan.push({
        itemID: item.itemID,
        typeID: item.typeID,
        quantity,
        ownerID: item.ownerID,
        locationID: item.locationID,
        flagID: item.flagID,
      });
    }
    return { success: true, data: plan, missing: {} };
  }
  const desired = Math.max(1, positiveInt(fuelOptions.quantity, 1));
  for (const source of sources) {
    const compatible = itemStore.listContainerItems(source.ownerID, source.locationID, source.flagID)
      .filter((item) => fuelRuntime.isAcceptedNetworkNodeFuelType(item.typeID) && isAllowedSource(item))
      .sort((left, right) => positiveInt(left.itemID, 0) - positiveInt(right.itemID, 0));
    if (!compatible.length) continue;
    const typeID = compatible[0].typeID;
    let remaining = desired;
    const plan: any[] = [];
    for (const item of compatible.filter((entry) => entry.typeID === typeID)) {
      const quantity = Math.min(remaining, itemQuantity(item));
      if (quantity > 0) plan.push({
        itemID: item.itemID,
        typeID,
        quantity,
        ownerID: item.ownerID,
        locationID: item.locationID,
        flagID: item.flagID,
      });
      remaining -= quantity;
      if (remaining <= 0) return { success: true, data: plan, missing: {} };
    }
  }
  return { success: false, data: [], missing: { fuel: desired } };
}

function reservePlan(job, plan, kind, nowMs, ttlMs) {
  for (const entry of plan) {
    const resourceKey = `${kind}:${positiveInt(entry.itemID, 0)}`;
    const reservation = persistence.acquireNpcJobReservation(job.jobID, {
      resourceKey,
      kind,
      target: { itemID: entry.itemID, typeID: entry.typeID, quantity: entry.quantity },
      ttlMs,
      nowMs,
    });
    if (!reservation.success) return reservation;
  }
  return { success: true };
}

function publishSupplyRequest(context, kind, missing, checkpoint) {
  const key = kind === "fuel" ? "fuelRequest" : "materialRequest";
  if (checkpoint[key]) return;
  checkpoint[key] = {
    jobID: context.job.jobID,
    entityID: context.entity.itemID,
    assemblyTypeID: positiveInt(context.job.payload?.assemblyTypeID, 0),
    constructionSiteID: positiveInt(checkpoint.assemblyItemID, 0) || null,
    networkNodeID: positiveInt(checkpoint.placement?.networkNodeID, 0) || null,
    missing: cloneValue(missing),
    requestedAtMs: Date.now(),
  };
  behaviorRuntime.eventInbox.publish(
    context.job.npcCharacterID,
    `construction-${kind}-request`,
    checkpoint[key],
    { eventID: `construction-${kind}-request:${context.job.jobID}` },
  );
}

function reconcileNpcCargo(entityID) {
  for (const record of nativeNpcStore.listNativeCargoForEntity(entityID)) {
    const item = itemStore.findItemById(record.cargoID);
    if (!item || positiveInt(item.locationID, 0) !== positiveInt(entityID, 0)) {
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

function finishConstructionOperation(operation, options: Record<string, any> = {}) {
  const payload = operation && operation.payload || {};
  const actor = normalizeNpcAssemblyActorContext(payload.actor, {
    requireSui: payload.requireSui === true,
  });
  let result;
  if (operation.operationType === "npc-construction-deploy") {
    const existing = adapters.findByJobID(payload.jobID);
    result = existing
      ? { success: true, data: { item: existing, idempotent: true } }
      : payload.placementMode === "directAssembly"
        ? adapters.placeDirect(actor, payload)
        : adapters.place(actor, payload);
  } else if (operation.operationType === "npc-construction-deposit") {
    result = adapters.deposit(actor, payload.assemblyItemID, payload.materialPlan, payload.jobID);
    if (result?.success) reconcileNpcCargo(actor.shipID);
  } else if (operation.operationType === "npc-construction-complete") {
    result = adapters.complete(actor, payload.assemblyItemID, payload.jobID);
  } else if (operation.operationType === "npc-construction-fuel") {
    result = adapters.fuel(actor, payload.assemblyItemID, payload.fuelPlan, {
      jobID: payload.jobID,
      operationKey: operation.idempotencyKey,
    });
    if (result?.success) reconcileNpcCargo(actor.shipID);
  } else {
    return { success: false, errorMsg: "NPC_CONSTRUCTION_OPERATION_UNSUPPORTED" };
  }
  if (!result || result.success !== true) return result || { success: false, errorMsg: "NPC_CONSTRUCTION_OPERATION_FAILED" };
  const item = result.data?.item || itemStore.findItemById(payload.assemblyItemID);
  const committed = {
    ...cloneValue(result.data || {}),
    ...(item ? { assemblyItemID: positiveInt(item.itemID, 0) } : {}),
    recovered: options.recovered === true,
  };
  persistence.commitNpcOperation(operation.operationID, {
    flushTables: [itemStore.ITEMS_TABLE, nativeNpcStore.TABLE.CARGO],
    result: committed,
  });
  return { success: true, data: committed, recovered: options.recovered === true };
}

function runConstructionOperation(type, key, payload) {
  const operation = persistence.beginNpcOperation(type, key, payload).data;
  if (operation.status === "committed") {
    return { success: true, data: { ...cloneValue(operation.result || {}), idempotent: true } };
  }
  if (TERMINAL_OPERATION_STATUSES.has(operation.status)) {
    return { success: false, errorMsg: operation.lastError || "NPC_CONSTRUCTION_OPERATION_TERMINAL" };
  }
  return finishConstructionOperation(operation);
}

function recoverNpcConstructionOperation(operation) {
  if (!operation || !String(operation.operationType || "").startsWith("npc-construction-")) {
    return { success: false, errorMsg: "NPC_CONSTRUCTION_OPERATION_UNSUPPORTED" };
  }
  if (TERMINAL_OPERATION_STATUSES.has(operation.status)) {
    return { success: true, recovered: false };
  }
  return finishConstructionOperation(operation, { recovered: true });
}

function buildCheckpoint(job) {
  const checkpoint: Record<string, any> = {
    assemblyItemID: 0,
    materialPlan: null,
    fuelPlan: null,
    definition: null,
    operator: null,
    registered: false,
    ...(cloneValue(job && job.checkpoint || {})),
  };
  if (checkpoint.materialsDeposited === true && checkpoint.materialsFulfilled !== true) {
    checkpoint.materialsFulfilled = true;
  }
  return checkpoint;
}

function tickNpcConstructionJob(context) {
  const { job, entity, nowMs } = context;
  const payload = job.payload || {};
  const checkpoint = buildCheckpoint(job);
  if (entity.transient === true || positiveInt(entity.npcCharacterID, 0) !== job.npcCharacterID ||
      positiveInt(entity.npcIncarnation, 0) !== job.incarnation) {
    return {
      status: behaviorRuntime.STATUS.FAILURE,
      step: "invalid-assignment",
      checkpoint,
      error: "NPC_CONSTRUCTION_ASSIGNMENT_INVALID",
    };
  }
  let definition = checkpoint.definition;
  if (!definition) {
    definition = adapters.resolveDefinition(positiveInt(payload.assemblyTypeID, 0));
    if (!definition) return suspended("resolve-blueprint", checkpoint, nowMs, "ASSEMBLY_TYPE_NOT_SUPPORTED", 30_000);
    if (job.jobType === "construction.smart" && definition.createOnChain !== true ||
        job.jobType === "construction.field" && definition.createOnChain === true) {
      return {
        status: behaviorRuntime.STATUS.FAILURE,
        step: "resolve-policy",
        checkpoint,
        error: "NPC_CONSTRUCTION_POLICY_MISMATCH",
      };
    }
    checkpoint.definition = cloneValue(definition);
  }
  let actor;
  try {
    const durableEntity = nativeNpcStore.getNativeEntity(
      positiveInt(entity.entityID ?? entity.itemID, 0),
    );
    actor = createNpcAssemblyActorContext(durableEntity, {
      requireSui: definition.createOnChain === true,
    });
  } catch (error) {
    return suspended("awaiting-identity", checkpoint, nowMs, error.code || error.message, 5_000);
  }
  checkpoint.operator = publicNpcAssemblyOperator(actor);
  checkpoint.fundingAuthority = definition.createOnChain ? {
    kind: "faction-wallet-budget",
    factionKey: actor.factionKey,
    walletAddress: actor.suiWalletAddress,
  } : null;
  if (positiveInt(payload.systemID, actor.solarSystemID) !== actor.solarSystemID) {
    return suspended("awaiting-system", checkpoint, nowMs, "NPC_CONSTRUCTION_WRONG_SYSTEM", 5_000);
  }

  const reservationTtlMs = Math.max(10_000, finiteNumber(payload.reservationTtlMs, DEFAULT_RESERVATION_TTL_MS));
  if (!checkpoint.assemblyItemID) {
    if (!checkpoint.placement) {
      const planned = adapters.planPlacement(actor, {
        assemblyTypeID: definition.assemblyTypeID,
        allowDirect: payload.placementMode === "directAssembly",
        jobID: job.jobID,
        networkNodeID: positiveInt(payload.networkNodeID, 0) || null,
        position: payload.position || null,
        requireSui: definition.createOnChain === true,
        shipPosition: cloneValue(entity.position),
      });
      if (!planned?.success) {
        return suspended(
          "placement-policy",
          checkpoint,
          nowMs,
          planned?.errorMsg || "INVALID_DEPLOYMENT_PLACEMENT",
          5_000,
        );
      }
      checkpoint.placement = cloneValue(planned.data);
      checkpoint.resolvedPlacementMode = planned.data?.directPlacement === false
        ? "constructionSite"
        : payload.placementMode || "constructionSite";
      checkpoint.placementPlannedAtMs = Date.now();
      return running("travel-placement", checkpoint, nowMs, 50);
    }
    const resolvedPlacementMode = checkpoint.resolvedPlacementMode ||
      payload.placementMode || "constructionSite";
    const travel = adapters.travelToPlacement(
      context,
      actor,
      checkpoint.placement.position,
    );
    if (!travel?.success) {
      return suspended(
        "travel-placement",
        checkpoint,
        nowMs,
        travel?.errorMsg || "NPC_CONSTRUCTION_TRAVEL_FAILED",
        2_000,
      );
    }
    checkpoint.placementTravel = cloneValue(travel.data || null);
    if (travel.data?.arrived !== true) {
      return running("travel-placement", checkpoint, nowMs, 500);
    }
    if (resolvedPlacementMode === "directAssembly" && !checkpoint.materialPlan) {
      const planned = planItemsForQuantities(
        entity,
        actor,
        definition.constructionCost,
        payload,
      );
      if (!planned.success) {
        publishSupplyRequest(context, "material", planned.missing, checkpoint);
        return suspended(
          "awaiting-materials",
          checkpoint,
          nowMs,
          "NPC_CONSTRUCTION_MATERIALS_REQUIRED",
          5_000,
        );
      }
      checkpoint.materialPlan = planned.data;
    }
    if (resolvedPlacementMode === "directAssembly" && !checkpoint.materialsFulfilled) {
      const reserved = reservePlan(
        job,
        checkpoint.materialPlan,
        "construction-material",
        nowMs,
        reservationTtlMs,
      );
      if (!reserved.success) {
        return suspended("reserve-materials", checkpoint, nowMs, reserved.errorMsg, 2_000);
      }
    }
    const placed = runConstructionOperation(
      "npc-construction-deploy",
      `npc-construction-deploy:${job.jobID}`,
      {
        actor: checkpoint.operator,
        jobID: job.jobID,
        assemblyTypeID: definition.assemblyTypeID,
        requireSui: definition.createOnChain === true,
        position: checkpoint.placement.position,
        plannedPlacement: checkpoint.placement,
        placementMode: resolvedPlacementMode,
        materialPlan: checkpoint.materialPlan,
        networkNodeID: positiveInt(payload.networkNodeID, 0) || null,
        rotation: payload.rotation || { yaw: 0, pitch: 0, roll: 0 },
        shipPosition: cloneValue(entity.position),
      },
    );
    if (!placed.success) {
      if (placed.errorMsg === "ASSEMBLY_PLACEMENT_OCCUPIED" && !payload.position) {
        checkpoint.placement = null;
        return running("replan-placement", checkpoint, nowMs, 1_000);
      }
      return suspended("deploy-retry", checkpoint, nowMs, placed.errorMsg, 5_000);
    }
    checkpoint.assemblyItemID = positiveInt(placed.data?.assemblyItemID || placed.data?.item?.itemID, 0);
    checkpoint.sitePlaced = true;
    checkpoint.placement = cloneValue(placed.data?.placement || checkpoint.placement);
    checkpoint.deployedAtMs = Date.now();
    if (!checkpoint.assemblyItemID) return suspended("deploy-retry", checkpoint, nowMs, "ASSEMBLY_CREATE_FAILED", 5_000);
    if (placed.data?.directPlacement === true) {
      checkpoint.materialsDeposited = true;
      checkpoint.materialsFulfilled = true;
      checkpoint.constructed = true;
      checkpoint.constructedAtMs = Date.now();
      for (const entry of checkpoint.materialPlan || []) {
        persistence.releaseNpcJobReservation(job.jobID, `construction-material:${entry.itemID}`);
      }
      reconcileNpcCargo(actor.shipID);
      return running("wait-activation", checkpoint, nowMs, 100);
    }
    return running("plan-materials", checkpoint, nowMs, 50);
  }
  if (!checkpoint.materialPlan) {
    checkpoint.materialsAtSite = readConstructionSiteQuantities(checkpoint.assemblyItemID);
    const outstanding = outstandingConstructionQuantities(
      definition.constructionCost,
      checkpoint.materialsAtSite,
    );
    const planned = planItemsForQuantities(entity, actor, outstanding, payload);
    if (!planned.success) {
      publishSupplyRequest(context, "material", planned.missing, checkpoint);
      return suspended("awaiting-materials", checkpoint, nowMs, "NPC_CONSTRUCTION_MATERIALS_REQUIRED", 5_000);
    }
    checkpoint.materialPlan = planned.data;
    checkpoint.materialRequest = null;
  }
  if (checkpoint.materialPlan && !checkpoint.materialsFulfilled) {
    const reserved = reservePlan(job, checkpoint.materialPlan, "construction-material", nowMs, reservationTtlMs);
    if (!reserved.success) return suspended("reserve-materials", checkpoint, nowMs, reserved.errorMsg, 2_000);
  }
  if (!checkpoint.materialsFulfilled) {
    const deposited = runConstructionOperation(
      "npc-construction-deposit",
      `npc-construction-deposit:${job.jobID}`,
      {
        actor: checkpoint.operator,
        jobID: job.jobID,
        assemblyItemID: checkpoint.assemblyItemID,
        materialPlan: checkpoint.materialPlan,
      },
    );
    if (!deposited.success) return suspended("deposit-retry", checkpoint, nowMs, deposited.errorMsg, 5_000);
    checkpoint.materialsDeposited = true;
    checkpoint.materialsFulfilled = true;
    checkpoint.materialsDepositedAtMs = Date.now();
    for (const entry of checkpoint.materialPlan || []) {
      persistence.releaseNpcJobReservation(job.jobID, `construction-material:${entry.itemID}`);
    }
    return running("realize-structure", checkpoint, nowMs, 50);
  }
  if (!checkpoint.constructed) {
    const completed = runConstructionOperation(
      "npc-construction-complete",
      `npc-construction-complete:${job.jobID}`,
      {
        actor: checkpoint.operator,
        jobID: job.jobID,
        assemblyItemID: checkpoint.assemblyItemID,
      },
    );
    if (!completed.success) return suspended("construction-retry", checkpoint, nowMs, completed.errorMsg, 5_000);
    checkpoint.constructed = true;
    checkpoint.constructedAtMs = Date.now();
    return running("wait-activation", checkpoint, nowMs, 100);
  }

  let lifecycle = adapters.lifecycle(actor, checkpoint.assemblyItemID, job.jobID);
  if (!lifecycle.success) return suspended("assembly-recovery", checkpoint, nowMs, lifecycle.errorMsg, 5_000);
  if (lifecycle.data.activationPending) {
    const dueAt = positiveInt(lifecycle.data.state.activationCompleteAtMs, 0);
    if (dueAt <= Date.now()) {
      const activation = adapters.completeActivation(checkpoint.assemblyItemID, { session: null });
      if (!activation.success) return suspended("activation-retry", checkpoint, nowMs, activation.errorMsg, 2_000);
    }
    return running("wait-activation", checkpoint, nowMs, Math.max(100, Math.min(5_000, dueAt - Date.now())));
  }

  if (definition.assemblyTypeID === NETWORK_NODE_TYPE_ID && payload.activate !== false) {
    const fuel = adapters.readFuel(lifecycle.data.item);
    if (positiveInt(fuel && fuel.quantity, 0) <= 0 && !checkpoint.fueled) {
      const plannedFuel = checkpoint.fuelPlan
        ? { success: true, data: checkpoint.fuelPlan, missing: {} }
        : planFuelItems(entity, actor, payload.fuel || {});
      if (!plannedFuel.success) {
        publishSupplyRequest(context, "fuel", plannedFuel.missing, checkpoint);
        return suspended("awaiting-fuel", checkpoint, nowMs, "NETWORK_NODE_FUEL_REQUIRED", 5_000);
      }
      checkpoint.fuelPlan = plannedFuel.data;
      const reserved = reservePlan(job, checkpoint.fuelPlan, "construction-fuel", nowMs, reservationTtlMs);
      if (!reserved.success) return suspended("reserve-fuel", checkpoint, nowMs, reserved.errorMsg, 2_000);
      const fueled = runConstructionOperation(
        "npc-construction-fuel",
        `npc-construction-fuel:${job.jobID}`,
        {
          actor: checkpoint.operator,
          jobID: job.jobID,
          assemblyItemID: checkpoint.assemblyItemID,
          fuelPlan: checkpoint.fuelPlan,
        },
      );
      if (!fueled.success) return suspended("fuel-retry", checkpoint, nowMs, fueled.errorMsg, 5_000);
      checkpoint.fueled = true;
      checkpoint.fuelRequest = null;
      for (const entry of checkpoint.fuelPlan) {
        persistence.releaseNpcJobReservation(job.jobID, `construction-fuel:${entry.itemID}`);
      }
      lifecycle = adapters.lifecycle(actor, checkpoint.assemblyItemID, job.jobID);
      if (!lifecycle.success) return suspended("assembly-recovery", checkpoint, nowMs, lifecycle.errorMsg, 5_000);
    }
  }

  if (payload.activate !== false && lifecycle.data.state.assemblyStatus !== deploymentRuntime.ASSEMBLY_STATUS_ONLINE) {
    const activation = adapters.requestState(
      actor,
      checkpoint.assemblyItemID,
      deploymentRuntime.ASSEMBLY_STATUS_ONLINE,
      job.jobID,
    );
    if (!activation.success) return suspended("activation-policy", checkpoint, nowMs, activation.errorMsg, 5_000);
    lifecycle = adapters.lifecycle(actor, checkpoint.assemblyItemID, job.jobID);
    if (!lifecycle.success) return suspended("assembly-recovery", checkpoint, nowMs, lifecycle.errorMsg, 5_000);
  }
  if (definition.createOnChain && lifecycle.data.suiStatusIntent) {
    checkpoint.suiTransactionRequestedAtMs ||= Date.now();
    return running("awaiting-sui-confirmation", checkpoint, nowMs, 1_000);
  }
  if (definition.createOnChain && payload.activate !== false &&
      lifecycle.data.state.assemblyStatus !== deploymentRuntime.ASSEMBLY_STATUS_ONLINE) {
    return running("awaiting-sui-confirmation", checkpoint, nowMs, 1_000);
  }
  if (!checkpoint.registered) {
    const registered = adapters.register(actor, checkpoint.assemblyItemID, {
      jobID: job.jobID,
      commandNodeID: payload.commandNodeID,
    });
    if (!registered.success) return suspended("register-faction-use", checkpoint, nowMs, registered.errorMsg, 5_000);
    checkpoint.registered = true;
    checkpoint.registeredAtMs = Date.now();
  }
  checkpoint.completedAssembly = deploymentRuntime.getAssemblyRecord(checkpoint.assemblyItemID);
  return success(checkpoint);
}

function createNpcConstructionJob(input: Record<string, any>) {
  try {
    assertNoSensitiveNpcAssemblyData(input, "constructionJob");
    const entityID = positiveInt(input && input.entityID, 0);
    const entityRecord = nativeNpcStore.getNativeEntity(entityID);
    if (!entityRecord || entityRecord.transient === true) {
      return { success: false, errorMsg: "NPC_DURABLE_ENTITY_NOT_FOUND" };
    }
    const assemblyTypeID = positiveInt(input && input.assemblyTypeID, 0);
    const definition = adapters.resolveDefinition(assemblyTypeID);
    if (!definition) return { success: false, errorMsg: "ASSEMBLY_TYPE_NOT_SUPPORTED" };
    const placementMode = String(
      input.placementMode || input.payload?.placementMode || "constructionSite",
    );
    if (!["constructionSite", "directAssembly"].includes(placementMode)) {
      return { success: false, errorMsg: "NPC_CONSTRUCTION_PLACEMENT_MODE_INVALID" };
    }
    if (placementMode === "directAssembly" &&
        !deploymentRuntime.isPortableAssemblyType(assemblyTypeID)) {
      return { success: false, errorMsg: "DIRECT_ASSEMBLY_PORTABLE_ONLY" };
    }
    const actor = createNpcAssemblyActorContext(entityRecord, {
      requireSui: definition.createOnChain === true,
    });
    const requestedType = String(input.jobType || "").trim().toLowerCase();
    const jobType = requestedType || (definition.createOnChain
      ? "construction.smart"
      : "construction.field");
    if (!CONSTRUCTION_JOB_TYPES.includes(jobType)) {
      return { success: false, errorMsg: "NPC_CONSTRUCTION_JOB_TYPE_INVALID" };
    }
    if (jobType === "construction.smart" && definition.createOnChain !== true ||
        jobType === "construction.field" && definition.createOnChain === true) {
      return { success: false, errorMsg: "NPC_CONSTRUCTION_POLICY_MISMATCH" };
    }
    return persistence.createNpcJob({
      npcCharacterID: actor.actorID,
      incarnation: positiveInt(entityRecord.npcIncarnation, 0),
      jobType,
      allowConcurrent: input.allowConcurrent === true,
      idempotencyKey: input.idempotencyKey,
      target: cloneValue(input.target || null),
      payload: {
        ...(cloneValue(input.payload || {})),
        assemblyTypeID,
        systemID: positiveInt(input.systemID || input.payload?.systemID, actor.solarSystemID),
        position: cloneValue(input.position || input.payload?.position || null),
        rotation: cloneValue(input.rotation || input.payload?.rotation || { yaw: 0, pitch: 0, roll: 0 }),
        networkNodeID: positiveInt(input.networkNodeID || input.payload?.networkNodeID, 0) || null,
        materialSources: cloneValue(input.materialSources || input.payload?.materialSources || null),
        materialItemIDs: cloneValue(input.materialItemIDs || input.payload?.materialItemIDs || null),
        fuel: cloneValue(input.fuel || input.payload?.fuel || null),
        commandNodeID: positiveInt(input.commandNodeID || input.payload?.commandNodeID, 0) || null,
        activate: input.activate ?? input.payload?.activate ?? true,
        placementMode,
      },
    });
  } catch (error) {
    return { success: false, errorMsg: error.code || error.message || "NPC_CONSTRUCTION_JOB_CREATE_FAILED" };
  }
}

/**
 * NPC-originated smart requests still originate at an online command node.
 * Only a verified-membership result is accepted; secrets/codes are rejected.
 */
function createNpcSmartAssemblyRequest(input: Record<string, any>) {
  try {
    const membershipReceipt = input && input.membershipReceipt;
    const publicInput = { ...(input || {}) };
    delete publicInput.membershipReceipt;
    assertNoSensitiveNpcAssemblyData(publicInput, "assemblyRequest");
    const entity = nativeNpcStore.getNativeEntity(positiveInt(input.entityID, 0));
    const actor = createNpcAssemblyActorContext(entity, { requireSui: true });
    const sourceID = positiveInt(input.commandNodeID, 0);
    const targetID = positiveInt(input.targetAssemblyID, 0);
    const sourceItem = itemStore.findItemById(sourceID);
    const targetItem = itemStore.findItemById(targetID);
    const source = deploymentRuntime.readNpcConstructionMetadata(sourceItem);
    const target = deploymentRuntime.readNpcConstructionMetadata(targetItem);
    if (!sourceItem || !source || source.factionKey !== actor.factionKey ||
        source.registeredForFaction !== true) {
      return { success: false, errorMsg: "NPC_COMMAND_NODE_ACCESS_DENIED" };
    }
    if (!targetItem || !target || target.factionKey !== actor.factionKey ||
        target.registeredForFaction !== true) {
      return { success: false, errorMsg: "NPC_ASSEMBLY_FACTION_ACCESS_DENIED" };
    }
    const membership = transponderMembership.authorizeNpcTransponderMembershipReceipt(
      membershipReceipt,
      actor,
      {
        requestID: input.requestID,
        requestType: input.requestType,
        commandNodeID: sourceID,
        targetAssemblyID: targetID,
      },
    );
    if (!membership.success) return membership;
    const operator = publicNpcAssemblyOperator(actor);
    return requestRuntime.createRequest(sourceID, targetID, input.requestType, {
      allowCrossOwner: true,
      requestID: input.requestID,
      priority: input.priority,
      priorityFlags: input.priorityFlags,
      expiresInMs: input.expiresInMs,
      payload: {
        ...(cloneValue(input.payload || {})),
        operator: {
          npcCharacterID: operator.actorID,
          npcProfileObjectID: operator.suiProfileObjectID,
          factionKey: operator.factionKey,
        },
        membership: {
          verified: true,
          commitmentID: membership.data.commitmentID,
          revision: membership.data.revision,
          scope: membership.data.scope,
          factionKey: membership.data.factionKey,
        },
      },
    });
  } catch (error) {
    return { success: false, errorMsg: error.code || error.message || "NPC_ASSEMBLY_REQUEST_FAILED" };
  }
}

function registerNpcConstructionJobHandlers() {
  if (handlersRegistered) return;
  for (const jobType of CONSTRUCTION_JOB_TYPES) {
    behaviorRuntime.registerNpcJobHandler(jobType, tickNpcConstructionJob);
  }
  handlersRegistered = true;
}

module.exports = {
  CONSTRUCTION_JOB_TYPES,
  registerNpcConstructionJobHandlers,
  createNpcConstructionJob,
  tickNpcConstructionJob,
  createNpcSmartAssemblyRequest,
  recoverNpcConstructionOperation,
  configureNpcConstructionAdapters,
  _testing: {
    buildCheckpoint,
    planItemsForQuantities,
    readConstructionSiteQuantities,
    outstandingConstructionQuantities,
    planFuelItems,
    finishConstructionOperation,
    reconcileNpcCargo,
  },
};
