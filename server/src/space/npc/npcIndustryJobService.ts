"use strict";

const crypto = require("node:crypto");
const path = require("node:path");

const database = require(path.join(__dirname, "../../gameStore"));
const itemStore = require(path.join(__dirname, "../../services/inventory/itemStore"));
const blueprints = require(path.join(__dirname, "../../services/frontier/industryBlueprints"));
const production = require(path.join(__dirname, "../../services/frontier/industryProduction"));
const assemblyAccess = require(path.join(__dirname, "../../services/frontier/assemblyAccessRuntime"));
const nativeNpcStore = require("./nativeNpcStore");
const persistence = require("./npcRuntimePersistence");
const behaviorRuntime = require("./npcBehaviorTreeRuntime");
const { createNpcAssemblyActorContext } = require("./npcAssemblyActorContext");

const JOB_TYPE = "industry.production";
const MAX_RUNS_PER_LANE = 1_000_000;
const DEFAULT_RESERVATION_TTL_MS = 60_000;
const TERMINAL_OPERATION_STATUSES = new Set(["committed", "compensated", "failed"]);
let handlerRegistered = false;

// industryRuntime imports the space runtime, which loads the NPC behavior
// registry. Resolve it lazily so that registry initialization cannot capture
// a partially initialized CommonJS export during that cycle.
function getIndustryRuntime() {
  return require(path.join(__dirname, "../../services/frontier/industryRuntime"));
}

function cloneValue(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function positiveInt(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isSafeInteger(numeric) && numeric > 0 ? numeric : fallback;
}

function quantity(item) {
  return Number(item?.singleton) === 1
    ? 1
    : positiveInt(item?.stacksize ?? item?.quantity, 0);
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

function normalizeLanes(value, fallback: Record<string, any> = {}) {
  const source = Array.isArray(value) && value.length > 0 ? value : [fallback];
  const lanes: any[] = [];
  const laneIDs = new Set<number>();
  for (const raw of source) {
    const laneID = positiveInt(raw?.laneID ?? raw?.lane_id, 0);
    const currentBlueprintID = positiveInt(
      raw?.blueprintID ?? raw?.blueprint_id ?? fallback.blueprintID,
      0,
    );
    const runs = positiveInt(raw?.runs ?? raw?.requestedRuns ?? fallback.runs, 0);
    if (!laneID || laneID > 16 || laneIDs.has(laneID) || !currentBlueprintID ||
        !runs || runs > MAX_RUNS_PER_LANE) {
      return null;
    }
    laneIDs.add(laneID);
    lanes.push({ laneID, blueprintID: currentBlueprintID, runs });
  }
  return lanes.sort((left, right) => left.laneID - right.laneID);
}

function buildCheckpoint(job) {
  const checkpoint = {
    blueprintLoaded: false,
    inputsStaged: false,
    outputBaseline: null,
    outputsCollected: false,
    materialRequest: null,
    laneStates: {},
    ...(cloneValue(job?.checkpoint || {})),
  };
  for (const lane of job?.payload?.lanes || []) {
    checkpoint.laneStates[String(lane.laneID)] ||= {
      laneID: lane.laneID,
      status: "pending",
      productionJobID: 0,
      executorKey: null,
      completedRuns: 0,
      stopReason: null,
    };
  }
  return checkpoint;
}

function buildNpcSession(actor, entityRecord) {
  return {
    characterID: actor.actorID,
    charid: actor.actorID,
    corporationID: positiveInt(entityRecord?.corporationID, 0),
    tribeID: positiveInt(entityRecord?.tribeID ?? entityRecord?.tribeId, 0),
    solarsystemid2: actor.solarSystemID,
    _space: { systemID: actor.solarSystemID, shipID: actor.shipID },
  };
}

function operationFingerprint(payload) {
  const canonical = (value) => Array.isArray(value)
    ? value.map(canonical)
    : value && typeof value === "object"
      ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]))
      : value;
  return crypto.createHash("sha256").update(JSON.stringify(canonical(payload))).digest("hex");
}

function syncNativeCargoItem(entityID, itemID, semanticRole = "industry") {
  const current = itemStore.findItemById(positiveInt(itemID, 0));
  const existing = nativeNpcStore.getNativeCargo(positiveInt(itemID, 0));
  if (!current || positiveInt(current.locationID, 0) !== positiveInt(entityID, 0) ||
      positiveInt(current.flagID, 0) !== itemStore.ITEM_FLAGS.CARGO_HOLD) {
    if (existing) nativeNpcStore.removeNativeCargo(itemID);
    return;
  }
  const metadata = itemStore.getItemMetadata(current.typeID) || {};
  nativeNpcStore.upsertNativeCargo({
    ...(existing || {}),
    cargoID: current.itemID,
    entityID: positiveInt(entityID, 0),
    ownerID: current.ownerID,
    moduleID: 0,
    typeID: current.typeID,
    groupID: current.groupID ?? metadata.groupID ?? 0,
    categoryID: current.categoryID ?? metadata.categoryID ?? 0,
    itemName: current.itemName || metadata.name || `Type ${current.typeID}`,
    quantity: quantity(current),
    singleton: Number(current.singleton) === 1,
    semanticRole: existing?.semanticRole || semanticRole,
    transient: false,
  }, { durable: true });
}

function finishNpcIndustryTransferOperation(operation, options: Record<string, any> = {}) {
  const payload = operation?.payload || {};
  if (!operation || !["npc-industry-input-transfer", "npc-industry-output-transfer"]
    .includes(operation.operationType)) {
    return { success: false, errorMsg: "NPC_INDUSTRY_OPERATION_UNSUPPORTED" };
  }
  const immutable = {
    sourceItemID: positiveInt(payload.sourceItemID, 0),
    sourceOwnerID: positiveInt(payload.sourceOwnerID, 0),
    sourceLocationID: positiveInt(payload.sourceLocationID, 0),
    sourceFlagID: Math.max(0, Number(payload.sourceFlagID) || 0),
    destinationOwnerID: positiveInt(payload.destinationOwnerID, 0),
    destinationLocationID: positiveInt(payload.destinationLocationID, 0),
    destinationFlagID: Math.max(0, Number(payload.destinationFlagID) || 0),
    typeID: positiveInt(payload.typeID, 0),
    quantity: positiveInt(payload.quantity, 0),
  };
  if (Object.values(immutable).some((value, index) => index !== 3 && index !== 6 && !value)) {
    return { success: false, errorMsg: "NPC_INDUSTRY_TRANSFER_INVALID" };
  }
  const current = itemStore.findItemById(immutable.sourceItemID);
  const replay = itemStore.findAssemblyCustodyReceipt(operation.operationID);
  if (!replay && (!current || Number(current.ownerID) !== immutable.sourceOwnerID ||
      Number(current.locationID) !== immutable.sourceLocationID ||
      Number(current.flagID) !== immutable.sourceFlagID ||
      Number(current.typeID) !== immutable.typeID || quantity(current) < immutable.quantity)) {
    return { success: false, errorMsg: "NPC_INDUSTRY_TRANSFER_SOURCE_CHANGED" };
  }
  const result = itemStore.transferItemToOwnerLocation(
    immutable.sourceItemID,
    immutable.destinationOwnerID,
    immutable.destinationLocationID,
    immutable.destinationFlagID,
    immutable.quantity,
    {
      operationKey: operation.operationID,
      operationFingerprint: operationFingerprint(immutable),
      committedAtMs: Date.now(),
      flush: true,
    },
  );
  if (!result?.success) return result || { success: false, errorMsg: "NPC_INDUSTRY_TRANSFER_FAILED" };
  const movedItemID = positiveInt(result.data?.movedItemID, immutable.sourceItemID);
  syncNativeCargoItem(payload.entityID, immutable.sourceItemID, payload.semanticRole);
  syncNativeCargoItem(payload.entityID, movedItemID, payload.semanticRole);
  const committed = {
    ...immutable,
    movedItemID,
    recovered: options.recovered === true,
  };
  persistence.commitNpcOperation(operation.operationID, {
    flushTables: [itemStore.ITEMS_TABLE, nativeNpcStore.TABLE.CARGO],
    result: committed,
  });
  return { success: true, data: committed, recovered: options.recovered === true };
}

function runNpcIndustryTransfer(operationType, idempotencyKey, payload) {
  const operation = persistence.beginNpcOperation(operationType, idempotencyKey, payload).data;
  if (operation.status === "committed") {
    return { success: true, data: { ...cloneValue(operation.result || {}), idempotent: true } };
  }
  if (TERMINAL_OPERATION_STATUSES.has(operation.status)) {
    return { success: false, errorMsg: operation.lastError || "NPC_INDUSTRY_OPERATION_TERMINAL" };
  }
  return finishNpcIndustryTransferOperation(operation);
}

function recoverNpcIndustryOperation(operation) {
  if (!operation || !String(operation.operationType || "").startsWith("npc-industry-")) {
    return { success: false, errorMsg: "NPC_INDUSTRY_OPERATION_UNSUPPORTED" };
  }
  if (TERMINAL_OPERATION_STATUSES.has(operation.status)) {
    return { success: true, recovered: false };
  }
  return finishNpcIndustryTransferOperation(operation, { recovered: true });
}

function totalRuns(lanes) {
  return lanes.reduce((sum, lane) => sum + lane.runs, 0);
}

function requiredInputs(blueprint, lanes) {
  const runs = totalRuns(lanes);
  return Object.fromEntries(Object.entries<any>(blueprint.inputs).map(([typeID, slot]) => [
    String(typeID),
    slot.quantity_per_run * runs,
  ]));
}

function expectedOutputs(blueprint, lanes) {
  const runs = totalRuns(lanes);
  return Object.fromEntries(Object.entries<any>(blueprint.outputs).map(([typeID, slot]) => [
    String(typeID),
    slot.quantity_per_run * runs,
  ]));
}

function collectedOutputs(jobID) {
  const totals: Record<string, number> = {};
  for (const operation of persistence.listNpcOperations({
    operationType: "npc-industry-output-transfer",
    status: "committed",
    jobID,
  })) {
    const typeID = positiveInt(operation.result?.typeID ?? operation.payload?.typeID, 0);
    const moved = positiveInt(operation.result?.quantity ?? operation.payload?.quantity, 0);
    if (typeID && moved) totals[String(typeID)] = (totals[String(typeID)] || 0) + moved;
  }
  return totals;
}

function validateOutputCargoCapacity(entityRecord, actor, outputPlan) {
  const ship = itemStore.findItemById(actor.shipID);
  if (!ship) return { success: false, errorMsg: "INVALID_SHIP" };
  const storage = require(path.join(
    __dirname,
    "../../services/frontier/smartStorageUnitRuntime",
  ));
  const authoredCapacity = Number(itemStore.getItemMetadata(ship.typeID)?.capacity || ship.capacity || 0);
  const capacity = Math.max(
    0,
    Number(storage.getShipCargoCapacity(positiveInt(entityRecord.ownerID, actor.actorID), ship)) ||
      authoredCapacity,
  );
  const used = itemStore.listContainerItems(null, actor.shipID, itemStore.ITEM_FLAGS.CARGO_HOLD)
    .reduce((sum, item) => sum + itemStore.getInventoryItemUnitVolume(item) * quantity(item), 0);
  const incoming = Object.entries<any>(outputPlan).reduce((sum, [typeID, count]) => {
    const metadata = itemStore.getItemMetadata(positiveInt(typeID, 0)) || { typeID: positiveInt(typeID, 0) };
    return sum + itemStore.getInventoryItemUnitVolume(metadata) * positiveInt(count, 0);
  }, 0);
  return capacity > 0 && used + incoming <= capacity + 1e-6
    ? { success: true, data: { capacity, used, incoming } }
    : { success: false, errorMsg: "NPC_INDUSTRY_OUTPUT_CAPACITY_EXCEEDED",
        data: { capacity, used, incoming } };
}

function planInputTransfers(entityRecord, actor, facility, required, payload, laneID = 1) {
  const facilityItems = getIndustryRuntime().getFacilityItems(facility, laneID).inputs;
  const allowedItemIDs = Array.isArray(payload.inputItemIDs)
    ? new Set(payload.inputItemIDs.map((value) => positiveInt(value, 0)).filter(Boolean))
    : null;
  const allowedOwners = new Set([
    actor.actorID,
    positiveInt(entityRecord.ownerID, 0),
  ].filter(Boolean));
  const cargoRecords = nativeNpcStore.listNativeCargoForEntity(actor.shipID)
    .filter((record) => positiveInt(record.moduleID, 0) === 0)
    .sort((left, right) => positiveInt(left.cargoID, 0) - positiveInt(right.cargoID, 0));
  const transfers: any[] = [];
  const missing: Record<string, number> = {};
  for (const [rawTypeID, rawRequired] of Object.entries<any>(required)) {
    const typeID = positiveInt(rawTypeID, 0);
    let remaining = Math.max(0, positiveInt(rawRequired, 0) -
      positiveInt(facilityItems[String(typeID)], 0));
    for (const record of cargoRecords) {
      if (remaining <= 0 || positiveInt(record.typeID, 0) !== typeID) continue;
      const itemID = positiveInt(record.cargoID, 0);
      if (allowedItemIDs && !allowedItemIDs.has(itemID)) continue;
      const item = itemStore.findItemById(itemID);
      if (!item || !allowedOwners.has(positiveInt(item.ownerID, 0)) ||
          positiveInt(item.locationID, 0) !== actor.shipID ||
          Number(item.flagID) !== itemStore.ITEM_FLAGS.CARGO_HOLD) continue;
      const moveQuantity = Math.min(remaining, quantity(item));
      if (moveQuantity > 0) transfers.push({ item, quantity: moveQuantity });
      remaining -= moveQuantity;
    }
    if (remaining > 0) missing[String(typeID)] = remaining;
  }
  return { success: Object.keys(missing).length === 0, transfers, missing };
}

function publishMaterialRequest(context, checkpoint, missing) {
  if (checkpoint.materialRequest) return;
  checkpoint.materialRequest = {
    jobID: context.job.jobID,
    entityID: context.entity.itemID,
    facilityID: context.job.payload.facilityID,
    blueprintID: context.job.payload.blueprintID,
    lanes: cloneValue(context.job.payload.lanes),
    missing: cloneValue(missing),
    requestedAtMs: Date.now(),
  };
  behaviorRuntime.eventInbox.publish(
    context.job.npcCharacterID,
    "industry-material-request",
    checkpoint.materialRequest,
    { eventID: `industry-material-request:${context.job.jobID}` },
  );
}

function reserveLanes(job, lanes, nowMs) {
  for (const lane of lanes) {
    const reserved = persistence.acquireNpcJobReservation(job.jobID, {
      resourceKey: `industry-lane:${job.payload.facilityID}:${lane.laneID}`,
      kind: "industry-lane",
      target: { facilityID: job.payload.facilityID, laneID: lane.laneID },
      ttlMs: Math.max(10_000, positiveInt(job.payload.reservationTtlMs, DEFAULT_RESERVATION_TTL_MS)),
      nowMs,
    });
    if (!reserved.success) return reserved;
  }
  return { success: true };
}

function travelToFacility(context, facilityID) {
  const facilityEntity = context.scene?.getEntityByID?.(facilityID);
  if (!facilityEntity) return { success: false, errorMsg: "FACILITY_NOT_FOUND" };
  if (context.scene && typeof context.scene.followShipEntity === "function") {
    context.scene.followShipEntity(
      context.entity,
      facilityID,
      4_000,
      { queueHistorySafeContract: true, suppressFreshAcquireReplay: true },
    );
    return { success: true };
  }
  return { success: false, errorMsg: "NPC_INDUSTRY_TRAVEL_UNAVAILABLE" };
}

function requireCrossOwnerCapability(actor, facility, capability) {
  if (Number(facility.ownerID) === actor.actorID) return { success: true };
  return assemblyAccess.resolveAccess(actor, facility.itemID, [capability]);
}

function tickNpcIndustryJob(context) {
  const { job, entity, nowMs } = context;
  const payload = job.payload || {};
  const checkpoint = buildCheckpoint(job);
  if (entity.transient === true || positiveInt(entity.npcCharacterID, 0) !== job.npcCharacterID ||
      positiveInt(entity.npcIncarnation, 0) !== job.incarnation) {
    return {
      status: behaviorRuntime.STATUS.FAILURE,
      step: "invalid-assignment",
      checkpoint,
      error: "NPC_INDUSTRY_ASSIGNMENT_INVALID",
    };
  }
  const entityRecord = nativeNpcStore.getNativeEntity(positiveInt(entity.itemID, 0));
  let actor;
  try { actor = createNpcAssemblyActorContext(entityRecord); }
  catch (error: any) {
    return suspended("awaiting-identity", checkpoint, nowMs,
      error.code || error.message || "NPC_INDUSTRY_IDENTITY_INVALID");
  }
  if (positiveInt(payload.systemID, actor.solarSystemID) !== actor.solarSystemID) {
    return suspended("awaiting-system", checkpoint, nowMs, "NPC_INDUSTRY_WRONG_SYSTEM");
  }
  const facilityID = positiveInt(payload.facilityID, 0);
  let facility = itemStore.findItemById(facilityID);
  if (!facility) {
    return suspended("resolve-facility", checkpoint, nowMs,
      "FACILITY_NOT_FOUND", 30_000);
  }
  const lanes = payload.lanes || [];
  if (!lanes.length || lanes.some((lane) => lane.laneID > production.getFacilityLaneCount(facility))) {
    return {
      status: behaviorRuntime.STATUS.FAILURE,
      step: "validate-lanes",
      checkpoint,
      error: "INVALID_JOB_LANE",
    };
  }
  const laneBlueprints = new Map<number, any>(lanes.map(lane => [lane.laneID,
    blueprints.getBlueprintForFacility(facility.typeID, lane.blueprintID)]));
  if ([...laneBlueprints.values()].some(blueprint => !blueprint)) {
    return suspended("resolve-blueprint", checkpoint, nowMs, "BLUEPRINT_NOT_FOUND", 30_000);
  }
  const reservation = reserveLanes(job, lanes, nowMs);
  if (!reservation.success) {
    return suspended("awaiting-lane", checkpoint, nowMs, reservation.errorMsg, 2_000);
  }
  const session = buildNpcSession(actor, entityRecord);
  const industryRuntime = getIndustryRuntime();
  for (const lane of lanes) {
    const access = industryRuntime.validateFacility(session, facilityID, {
      laneID: lane.laneID,
      npcActor: actor,
      scene: context.scene,
    });
    if (!access.success) {
      if (access.errorMsg === "FACILITY_OUT_OF_RANGE") {
        const travel = travelToFacility(context, facilityID);
        return travel.success
          ? running("travel-facility", checkpoint, nowMs, 500)
          : suspended("travel-facility", checkpoint, nowMs, travel.errorMsg, 1_000);
      }
      return suspended("validate-access", checkpoint, nowMs, access.errorMsg, 5_000);
    }
  }

  for (const lane of lanes) {
    const blueprint = laneBlueprints.get(lane.laneID);
    const selected = blueprints.getSelectedBlueprint(facility, lane.laneID);
    if (!selected || selected.blueprint_id !== blueprint.blueprint_id) {
      if (Number(facility.ownerID) !== actor.actorID) {
        return suspended("awaiting-blueprint", checkpoint, nowMs, "BLUEPRINT_NOT_LOADED", 5_000);
      }
      const loaded = industryRuntime.loadBlueprint(session, facilityID, blueprint.blueprint_id, {
        laneID: lane.laneID,
        npcActor: actor,
        scene: context.scene,
      });
      if (!loaded.success) return suspended("load-blueprint", checkpoint, nowMs, loaded.errorMsg, 5_000);
      checkpoint.laneStates[String(lane.laneID)].blueprintLoaded = true;
      checkpoint.blueprintLoadedAtMs = Date.now();
      return running("load-blueprints", checkpoint, nowMs, 50);
    }
    checkpoint.laneStates[String(lane.laneID)].blueprintLoaded = true;
  }
  checkpoint.blueprintLoaded = true;

  if (!checkpoint.inputsStaged) {
    for (const lane of lanes) {
      const laneState = checkpoint.laneStates[String(lane.laneID)];
      const blueprint = laneBlueprints.get(lane.laneID);
      const required = requiredInputs(blueprint, [lane]);
      for (const [typeID, requiredQuantity] of Object.entries<any>(required)) {
        if (requiredQuantity > blueprint.inputs[typeID].max_storable_quantity) {
          return {
            status: behaviorRuntime.STATUS.FAILURE,
            step: "validate-input-capacity",
            checkpoint,
            error: "NPC_INDUSTRY_INPUT_CAPACITY_EXCEEDED",
          };
        }
      }
      checkpoint.outputBaseline ||= {};
      checkpoint.outputBaseline[String(lane.laneID)] ||= cloneValue(
        industryRuntime.getFacilityItems(facility, lane.laneID).outputs);
      const depositAccess = requireCrossOwnerCapability(actor, facility, "inventory.deposit");
      if (!depositAccess.success) {
        return suspended("awaiting-deposit-access", checkpoint, nowMs, depositAccess.errorMsg, 5_000);
      }
      const plan = planInputTransfers(entityRecord, actor, facility, required, payload, lane.laneID);
      if (!plan.success) {
        publishMaterialRequest(context, checkpoint, plan.missing);
        return suspended("awaiting-materials", checkpoint, nowMs,
          "NPC_INDUSTRY_MATERIALS_REQUIRED", 5_000);
      }
      for (const entry of plan.transfers) {
        const transfer = runNpcIndustryTransfer(
          "npc-industry-input-transfer",
          `npc-industry-input:${job.jobID}:${lane.laneID}:${entry.item.itemID}:${entry.quantity}`,
          {
            jobID: job.jobID,
            entityID: actor.shipID,
            semanticRole: "industry-input",
            sourceItemID: entry.item.itemID,
            sourceOwnerID: entry.item.ownerID,
            sourceLocationID: entry.item.locationID,
            sourceFlagID: entry.item.flagID,
            destinationOwnerID: facility.ownerID,
            destinationLocationID: facility.itemID,
            destinationFlagID: industryRuntime.industryInputFlagForLane(lane.laneID),
            typeID: entry.item.typeID,
            quantity: entry.quantity,
          },
        );
        if (!transfer.success) {
          return suspended("stage-inputs", checkpoint, nowMs, transfer.errorMsg, 5_000);
        }
      }
      laneState.inputsStaged = true;
    }
    database.flushTablesSync([itemStore.ITEMS_TABLE, nativeNpcStore.TABLE.CARGO]);
    checkpoint.inputsStaged = true;
    checkpoint.inputsStagedAtMs = Date.now();
    checkpoint.materialRequest = null;
    return running("start-lanes", checkpoint, nowMs, 50);
  }

  for (const lane of lanes) {
    const state = checkpoint.laneStates[String(lane.laneID)];
    facility = itemStore.findItemById(facilityID);
    const current = production.getProduction(facility, lane.laneID);
    const expectedExecutorKey = `npc-industry:${job.jobID}:${lane.laneID}`;
    // startProduction and the facility escrow commit are atomic, while the
    // behavior checkpoint is a separate Phase 0 write.  Recover the narrow
    // crash window by recognizing the deterministic executor key persisted
    // with the paid production record.
    if (!state.executorKey && current?.executorKey === expectedExecutorKey) {
      state.executorKey = expectedExecutorKey;
    }
    if (current && current.executorKey === state.executorKey && state.executorKey) {
      state.productionJobID = current.jobID;
      state.completedRuns = current.completedRuns;
      state.status = current.state === "STOPPED" ? "stopped" : "running";
      state.stopReason = current.stopReason;
    } else if (!state.executorKey) {
      if (current && current.state !== "STOPPED") {
        return suspended("awaiting-lane", checkpoint, nowMs, "PRODUCTION_ALREADY_RUNNING", 2_000);
      }
      const started = production.startProduction(
        session,
        facilityID,
        laneBlueprints.get(lane.laneID).blueprint_id,
        laneBlueprints.get(lane.laneID).content_hash,
        lane.runs,
        {
          nowMs,
          laneID: lane.laneID,
          executorKey: expectedExecutorKey,
          npcActor: actor,
          scene: context.scene,
        },
      );
      if (!started.success) {
        return suspended("start-lane", checkpoint, nowMs, started.errorMsg, 2_000);
      }
      state.executorKey = expectedExecutorKey;
      state.productionJobID = started.data.production.jobID;
      state.status = "running";
      state.startedAtMs = Date.now();
      return running("start-lanes", checkpoint, nowMs, 50);
    } else if (!current || current.executorKey !== state.executorKey) {
      return suspended("recover-lane", checkpoint, nowMs, "NPC_INDUSTRY_PRODUCTION_STATE_CHANGED", 5_000);
    }
  }

  let nextWakeAtMs = nowMs + 1_000;
  for (const lane of lanes) {
    const advanced = production.advanceProduction(facilityID, {
      nowMs,
      laneID: lane.laneID,
    });
    if (!advanced.success) {
      return suspended("advance-production", checkpoint, nowMs, advanced.errorMsg, 2_000);
    }
    const current = advanced.data.production;
    const state = checkpoint.laneStates[String(lane.laneID)];
    if (!current || current.executorKey !== state.executorKey) {
      return suspended("recover-lane", checkpoint, nowMs, "NPC_INDUSTRY_PRODUCTION_STATE_CHANGED", 5_000);
    }
    state.productionJobID = current.jobID;
    state.completedRuns = current.completedRuns;
    state.stopReason = current.stopReason;
    state.status = current.state === "STOPPED" ? "stopped" : "running";
    if (current.state !== "STOPPED") {
      nextWakeAtMs = Math.min(nextWakeAtMs, Math.max(nowMs + 50, current.runEndAtMs));
    } else if (current.stopReason !== "COMPLETED" || current.completedRuns !== lane.runs) {
      return suspended("production-stopped", checkpoint, nowMs,
        `NPC_INDUSTRY_${String(current.stopReason || "STOPPED")}`, 5_000);
    }
  }
  if (lanes.some((lane) => checkpoint.laneStates[String(lane.laneID)].status !== "stopped")) {
    return running("production-running", checkpoint, nowMs,
      Math.max(50, Math.min(5_000, nextWakeAtMs - nowMs)));
  }

  if (payload.collectOutputs !== false && !checkpoint.outputsCollected) {
    facility = itemStore.findItemById(facilityID);
    const withdrawAccess = requireCrossOwnerCapability(actor, facility, "inventory.withdraw");
    if (!withdrawAccess.success) {
      return suspended("awaiting-withdraw-access", checkpoint, nowMs, withdrawAccess.errorMsg, 5_000);
    }
    const expected: Record<string, number> = {};
    for (const lane of lanes) {
      for (const [typeID, count] of Object.entries<any>(
        expectedOutputs(laneBlueprints.get(lane.laneID), [lane]))) {
        expected[typeID] = (expected[typeID] || 0) + count;
      }
    }
    const collected = collectedOutputs(job.jobID);
    const remainingOutputs: Record<string, number> = {};
    for (const [rawTypeID, rawExpected] of Object.entries<any>(expected)) {
      const typeID = positiveInt(rawTypeID, 0);
      const available = lanes.flatMap(lane => itemStore.listContainerItems(
        facility.ownerID, facilityID, industryRuntime.industryOutputFlagForLane(lane.laneID),
      )).filter((item) => positiveInt(item.typeID, 0) === typeID)
        .reduce((sum, item) => sum + quantity(item), 0);
      remainingOutputs[String(typeID)] = Math.min(
        Math.max(0, positiveInt(rawExpected, 0) - positiveInt(collected[String(typeID)], 0)),
        available,
      );
    }
    const capacity = validateOutputCargoCapacity(entityRecord, actor, remainingOutputs);
    if (!capacity.success) {
      return suspended("awaiting-output-capacity", checkpoint, nowMs, capacity.errorMsg, 5_000);
    }
    for (const [rawTypeID, rawExpected] of Object.entries<any>(expected)) {
      const typeID = positiveInt(rawTypeID, 0);
      const rows = lanes.flatMap(lane => itemStore.listContainerItems(facility.ownerID, facilityID,
        industryRuntime.industryOutputFlagForLane(lane.laneID)))
        .filter((item) => positiveInt(item.typeID, 0) === typeID)
        .sort((left, right) => positiveInt(left.itemID, 0) - positiveInt(right.itemID, 0));
      const required = Math.max(
        0,
        positiveInt(rawExpected, 0) - positiveInt(collected[String(typeID)], 0),
      );
      let remaining = required;
      for (const item of rows) {
        if (remaining <= 0) break;
        const moveQuantity = Math.min(remaining, quantity(item));
        const transfer = runNpcIndustryTransfer(
          "npc-industry-output-transfer",
          `npc-industry-output:${job.jobID}:${item.itemID}:${moveQuantity}`,
          {
            jobID: job.jobID,
            entityID: actor.shipID,
            semanticRole: "industry-output",
            sourceItemID: item.itemID,
            sourceOwnerID: facility.ownerID,
            sourceLocationID: facilityID,
            sourceFlagID: item.flagID,
            destinationOwnerID: positiveInt(entityRecord.ownerID, actor.actorID),
            destinationLocationID: actor.shipID,
            destinationFlagID: itemStore.ITEM_FLAGS.CARGO_HOLD,
            typeID,
            quantity: moveQuantity,
          },
        );
        if (!transfer.success) {
          return suspended("collect-outputs", checkpoint, nowMs, transfer.errorMsg, 5_000);
        }
        remaining -= moveQuantity;
      }
      if (remaining > 0) {
        return suspended("collect-outputs", checkpoint, nowMs,
          "NPC_INDUSTRY_OUTPUTS_UNAVAILABLE", 5_000);
      }
    }
    checkpoint.outputsCollected = true;
    checkpoint.outputsCollectedAtMs = Date.now();
    return running("finalize", checkpoint, nowMs, 50);
  }
  checkpoint.completedAtMs = Date.now();
  return success(checkpoint);
}

function createNpcIndustryJob(input: Record<string, any>) {
  try {
    const entityID = positiveInt(input?.entityID, 0);
    const entity = nativeNpcStore.getNativeEntity(entityID);
    if (!entity || entity.transient === true) {
      return { success: false, errorMsg: "NPC_DURABLE_ENTITY_NOT_FOUND" };
    }
    const actor = createNpcAssemblyActorContext(entity);
    const facilityID = positiveInt(input?.facilityID ?? input?.payload?.facilityID, 0);
    const facility = itemStore.findItemById(facilityID);
    if (!facility || !blueprints.isIndustryFacilityType(facility.typeID)) {
      return { success: false, errorMsg: "FACILITY_NOT_FOUND" };
    }
    const lanes = normalizeLanes(input?.lanes ?? input?.payload?.lanes, {
      laneID: input?.laneID ?? input?.payload?.laneID ?? 1,
      blueprintID: input?.blueprintID ?? input?.payload?.blueprintID,
      runs: input?.runs ?? input?.payload?.runs ?? 1,
    });
    if (!lanes) return { success: false, errorMsg: "NPC_INDUSTRY_LANES_INVALID" };
    if (lanes.some((lane) => lane.laneID > production.getFacilityLaneCount(facility))) {
      return { success: false, errorMsg: "INVALID_JOB_LANE" };
    }
    if (lanes.some(lane => !blueprints.getBlueprintForFacility(facility.typeID, lane.blueprintID))) {
      return { success: false, errorMsg: "BLUEPRINT_NOT_FOUND" };
    }
    return persistence.createNpcJob({
      npcCharacterID: actor.actorID,
      incarnation: positiveInt(entity.npcIncarnation, 0),
      jobType: JOB_TYPE,
      allowConcurrent: input.allowConcurrent === true,
      idempotencyKey: input.idempotencyKey,
      target: cloneValue(input.target || { facilityID }),
      payload: {
        ...(cloneValue(input.payload || {})),
        facilityID,
        blueprintID: lanes[0].blueprintID,
        lanes,
        systemID: positiveInt(input.systemID ?? input.payload?.systemID, actor.solarSystemID),
        inputItemIDs: cloneValue(input.inputItemIDs ?? input.payload?.inputItemIDs ?? null),
        collectOutputs: input.collectOutputs ?? input.payload?.collectOutputs ?? true,
        reservationTtlMs: positiveInt(
          input.reservationTtlMs ?? input.payload?.reservationTtlMs,
          DEFAULT_RESERVATION_TTL_MS,
        ),
      },
    });
  } catch (error: any) {
    return { success: false, errorMsg: error.code || error.message || "NPC_INDUSTRY_JOB_CREATE_FAILED" };
  }
}

function registerNpcIndustryJobHandler() {
  if (handlerRegistered) return;
  behaviorRuntime.registerNpcJobHandler(JOB_TYPE, tickNpcIndustryJob);
  handlerRegistered = true;
}

module.exports = {
  JOB_TYPE,
  createNpcIndustryJob,
  tickNpcIndustryJob,
  recoverNpcIndustryOperation,
  registerNpcIndustryJobHandler,
  _testing: {
    buildCheckpoint,
    collectedOutputs,
    expectedOutputs,
    finishNpcIndustryTransferOperation,
    normalizeLanes,
    planInputTransfers,
    requiredInputs,
    validateOutputCargoCapacity,
  },
};
