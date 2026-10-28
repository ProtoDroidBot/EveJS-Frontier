"use strict";

const path = require("path");

const OPERATION_TYPE = "npc-travel-transition";
const TERMINAL = new Set(["committed", "compensated", "failed"]);

function positiveInt(value) {
  const numeric = Number(value);
  return Number.isSafeInteger(numeric) && numeric > 0 ? numeric : 0;
}

function vector(value) {
  if (!value || typeof value !== "object" ||
      ![value.x, value.y, value.z].every((part) => Number.isFinite(Number(part)))) return null;
  return { x: Number(value.x), y: Number(value.y), z: Number(value.z) };
}

function cloneValue(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function defaultAdapters() {
  return {
    persistence: require("./npcRuntimePersistence"),
    store: require("./nativeNpcStore"),
    nativeService: require("./nativeNpcService"),
    runtime: require(path.join(__dirname, "../runtime")),
    worldData: require(path.join(__dirname, "../worldData")),
    pilots: require("./npcPilotIdentityStore").getNpcPilotIdentityStore(),
    itemStore: require(path.join(__dirname, "../../services/inventory/itemStore")),
    fuelTank: require(path.join(__dirname, "../../services/frontier/fuelTankRuntime")),
    routePlanner: require("./npcTravelRoute"),
  };
}

function createNpcTravelTransitionRuntime(overrides: Record<string, any> = {}) {
  const deps = { ...defaultAdapters(), ...overrides };

  function arrivalPosition(payload) {
    const explicit = vector(payload.destinationPosition);
    if (explicit) return { x: explicit.x + 10_000, y: explicit.y, z: explicit.z };
    const gates = deps.worldData.getStargatesForSystem(payload.destinationSystemID) || [];
    const anchor = gates.find((gate) => vector(gate.position)) ||
      (deps.worldData.getStaticSceneForSystem(payload.destinationSystemID) || [])
        .find((item) => vector(item.position));
    const position = vector(anchor && anchor.position) || { x: 1_000_000, y: 0, z: 0 };
    return {
      x: position.x + Math.max(10_000, Number(anchor && anchor.radius) || 0),
      y: position.y,
      z: position.z,
    };
  }

  function verifyIdentity(payload, entity, controller) {
    if (!entity || !controller || entity.transient === true ||
        positiveInt(entity.entityID) !== positiveInt(payload.entityID) ||
        positiveInt(entity.npcCharacterID) !== positiveInt(payload.npcCharacterID) ||
        positiveInt(entity.npcIncarnation) !== positiveInt(payload.incarnation) ||
        positiveInt(controller.entityID) !== positiveInt(payload.entityID)) {
      return { success: false, errorMsg: "NPC_TRAVEL_IDENTITY_MISMATCH" };
    }
    const pilot = deps.pilots.get(payload.npcCharacterID);
    if (!pilot || pilot.activeEntityID !== payload.entityID ||
        pilot.incarnation !== payload.incarnation) {
      return { success: false, errorMsg: "NPC_TRAVEL_PILOT_MISMATCH" };
    }
    return { success: true, data: pilot };
  }

  function applyFuelDebit(entity, payload, operationID) {
    const debit = payload.jumpFuelDebit;
    if (!debit) return { success: true, data: entity };
    const condition = entity.conditionState || {};
    if (condition.npcTravelFuelDebitOperationID === operationID) {
      return { success: true, data: entity, idempotent: true };
    }
    if (debit.mode === "frontier-tank") {
      const currentQueue = deps.fuelTank.getShipFuelQueue({ conditionState: condition });
      if (JSON.stringify(currentQueue) !== JSON.stringify(debit.previousFuelQueue || [])) {
        return { success: false, errorMsg: "NPC_TRAVEL_FUEL_CHANGED" };
      }
    } else if (debit.mode === "inventory") {
      const entries = Array.isArray(debit.entries) ? debit.entries : [];
      if (entries.length === 0) return { success: false, errorMsg: "NPC_TRAVEL_FUEL_REQUIRED" };
      let allBefore = true;
      let allAfter = true;
      for (const entry of entries) {
        const item = deps.itemStore.findItemById(entry.itemID);
        const quantity = item ? Number(item.singleton) === 1
          ? 1 : positiveInt(item.stacksize ?? item.quantity) : 0;
        allBefore = allBefore && quantity === entry.beforeQuantity;
        allAfter = allAfter && quantity === entry.beforeQuantity - entry.quantity;
      }
      if (!allBefore && !allAfter) {
        return { success: false, errorMsg: "NPC_TRAVEL_FUEL_CHANGED" };
      }
      if (allBefore) {
        const consumed = deps.itemStore.consumeInventoryItems(entries.map((entry) => ({
          itemID: entry.itemID,
          quantity: entry.quantity,
          expected: {
            ownerID: entry.ownerID, locationID: entry.locationID,
            flagID: entry.flagID, typeID: entry.typeID,
          },
        })), { flush: true });
        if (!consumed?.success) return consumed || { success: false, errorMsg: "NPC_TRAVEL_FUEL_CONSUME_FAILED" };
      }
      for (const entry of entries) {
        const item = deps.itemStore.findItemById(entry.itemID);
        if (!item) {
          deps.store.removeNativeCargo(entry.itemID);
        } else {
          const cargo = deps.store.listNativeCargoForEntity(payload.entityID)
            .find((record) => record.cargoID === entry.itemID);
          if (cargo) deps.store.upsertNativeCargo({
            ...cargo,
            quantity: Number(item.singleton) === 1 ? 1 : positiveInt(item.stacksize ?? item.quantity),
          }, { durable: true });
        }
      }
    } else {
      return { success: false, errorMsg: "NPC_TRAVEL_FUEL_MODE_INVALID" };
    }
    const updated = {
      ...entity,
      conditionState: {
        ...condition,
        ...(debit.mode === "frontier-tank" ? {
          fuelQueue: cloneValue(debit.fuelQueue),
          fuelCharge: debit.fuelCharge,
          fuelTypeID: debit.fuelTypeID,
        } : {}),
        temperature: debit.nextTemperature,
        npcJumpCooldownUntilMs: debit.cooldownUntilMs,
        npcJumpFatigueUntilMs: debit.fatigueUntilMs,
        npcJumpFatigueFiletime: debit.fatigueFiletime,
        npcTravelFuelDebitOperationID: operationID,
      },
    };
    const saved = deps.store.upsertNativeEntity(updated, { durable: true });
    return saved?.success
      ? { success: true, data: deps.store.getNativeEntity(payload.entityID) }
      : { success: false, errorMsg: saved?.errorMsg || "NPC_TRAVEL_FUEL_PERSIST_FAILED" };
  }

  function completeOperation(operation, options: Record<string, any> = {}) {
    if (!operation || operation.operationType !== OPERATION_TYPE) {
      return { success: false, errorMsg: "NPC_TRAVEL_OPERATION_INVALID" };
    }
    if (operation.status === "committed") {
      return { success: true, data: cloneValue(operation.result), idempotent: true };
    }
    if (TERMINAL.has(operation.status)) {
      return { success: false, errorMsg: operation.lastError || "NPC_TRAVEL_OPERATION_TERMINAL" };
    }
    const payload = operation.payload || {};
    const entityID = positiveInt(payload.entityID);
    const sourceID = positiveInt(payload.sourceSystemID);
    const destinationID = positiveInt(payload.destinationSystemID);
    if (!entityID || !sourceID || !destinationID || sourceID === destinationID ||
        !deps.worldData.getSolarSystemByID(destinationID)) {
      return { success: false, errorMsg: "NPC_TRAVEL_DESTINATION_INVALID" };
    }
    let entity = deps.store.getNativeEntity(entityID);
    let controller = deps.store.getNativeController(entityID);
    const identity = verifyIdentity(payload, entity, controller);
    if (!identity.success) return identity;
    const storedSystemID = positiveInt(entity.systemID);
    if (storedSystemID !== sourceID && storedSystemID !== destinationID) {
      return { success: false, errorMsg: "NPC_TRAVEL_LOCATION_CONFLICT" };
    }

    if (storedSystemID === destinationID &&
        deps.runtime.scenes.get(sourceID)?.getEntityByID(entityID)) {
      // A same-process retry can observe the durable destination write before
      // the source scene has finished withdrawing its runtime projection.
      const withdrawn = deps.nativeService.dematerializeNativeController(
        { entityID, systemID: sourceID }, { persistState: false, broadcast: true },
      );
      if (!withdrawn?.success) return withdrawn;
    }

    if (storedSystemID === sourceID) {
      const sourceScene = deps.runtime.scenes.get(sourceID);
      if (sourceScene?.getEntityByID(entityID)) {
        const dematerialized = deps.nativeService.dematerializeNativeController(controller, {
          persistState: true, broadcast: true,
        });
        if (!dematerialized?.success) return dematerialized;
      } else {
        deps.persistence.releaseSpawnLeaseByEntity(entityID);
      }
      deps.persistence.checkpointNpcOperation(operation.operationID,
        "SOURCE_DEMATERIALIZED", {}, {
          flushTables: [deps.store.TABLE.ENTITIES, deps.store.TABLE.CONTROLLERS],
        });
      entity = deps.store.getNativeEntity(entityID);
      controller = deps.store.getNativeController(entityID);
      const fuel = applyFuelDebit(entity, payload, operation.operationID);
      if (!fuel.success) {
        const sourceScene = deps.runtime.ensureScene(sourceID);
        if (sourceScene) deps.nativeService.materializeStoredNativeController(
          sourceScene, entityID, { broadcast: false },
        );
        deps.persistence.failNpcOperation(operation.operationID, fuel.errorMsg, {
          compensated: true,
        });
        return fuel;
      }
      entity = fuel.data;
      const destinationPosition = arrivalPosition(payload);
      const nextEntity = {
        ...entity,
        systemID: destinationID,
        position: destinationPosition,
        targetPoint: destinationPosition,
        velocity: { x: 0, y: 0, z: 0 },
        mode: "STOP",
        speedFraction: 0,
        targetEntityID: 0,
        followRange: 0,
        orbitDistance: 0,
        anchorKind: "travel-arrival",
        anchorID: positiveInt(payload.destinationID),
        anchorName: "Travel Arrival",
      };
      const entityWrite = deps.store.upsertNativeEntity(nextEntity, { durable: true });
      if (!entityWrite?.success) return entityWrite;
      const controllerWrite = deps.store.upsertNativeController({
        ...controller,
        systemID: destinationID,
        homePosition: destinationPosition,
        nextThinkAtMs: 0,
        currentTargetID: 0,
        preferredTargetID: 0,
        manualOrder: null,
        returningHome: false,
      }, { durable: true });
      if (!controllerWrite?.success) return controllerWrite;
    }

    controller = deps.store.getNativeController(entityID);
    if (positiveInt(controller.systemID) !== destinationID) {
      const repaired = deps.store.upsertNativeController({
        ...controller, systemID: destinationID, currentTargetID: 0,
        preferredTargetID: 0, manualOrder: null, returningHome: false,
        nextThinkAtMs: 0,
      }, { durable: true });
      if (!repaired?.success) return repaired;
    }

    const pilot = deps.pilots.get(payload.npcCharacterID);
    if (pilot.systemID !== destinationID) {
      deps.pilots.update(payload.npcCharacterID, (current) => ({
        ...current, systemID: destinationID,
      }));
    }
    // Native equipment and cargo retain the same entity ID as their location.
    // No player inventory transfer is needed, but this checkpoint is the
    // durable boundary at which that custody has been verified.
    const cargoIDs = new Set(deps.store.listNativeCargoForEntity(entityID)
      .map((cargo) => positiveInt(cargo.cargoID)));
    const spentCargoIDs = new Set((payload.jumpFuelDebit?.entries || [])
      .filter((entry) => entry.quantity === entry.beforeQuantity)
      .map((entry) => positiveInt(entry.itemID)));
    if ((payload.cargoIDs || []).some((cargoID) =>
      !cargoIDs.has(cargoID) && !spentCargoIDs.has(cargoID))) {
      return { success: false, errorMsg: "NPC_TRAVEL_CARGO_CHANGED" };
    }
    deps.persistence.checkpointNpcOperation(operation.operationID,
      "INVENTORY_MOVED", {}, {
        flushTables: [deps.store.TABLE.ENTITIES, deps.store.TABLE.CONTROLLERS,
          deps.store.TABLE.CARGO, "npcPilotIdentities"],
      });

    const destinationScene = deps.runtime.ensureScene(destinationID);
    if (!destinationScene) return { success: false, errorMsg: "NPC_TRAVEL_DESTINATION_UNAVAILABLE" };
    deps.persistence.checkpointNpcOperation(operation.operationID, "DESTINATION_READY");
    const materialized = deps.nativeService.materializeStoredNativeController(
      destinationScene, entityID, { broadcast: options.broadcast !== false },
    );
    if (!materialized?.success) return materialized;
    deps.persistence.checkpointNpcOperation(operation.operationID,
      "DESTINATION_MATERIALIZED");
    const result = {
      entityID,
      npcCharacterID: payload.npcCharacterID,
      incarnation: payload.incarnation,
      sourceSystemID: sourceID,
      destinationSystemID: destinationID,
      routeKind: payload.routeKind,
    };
    deps.persistence.commitNpcOperation(operation.operationID, { result });
    return { success: true, data: result, recovered: options.recovered === true };
  }

  function transitionNpcThroughEdge(entityID, edge, options: Record<string, any> = {}) {
    const entity = deps.store.getNativeEntity(positiveInt(entityID));
    const controller = deps.store.getNativeController(positiveInt(entityID));
    if (!entity || !controller || entity.transient === true ||
        positiveInt(entity.systemID) !== positiveInt(edge?.sourceSystemID) ||
        positiveInt(edge?.destinationSystemID) === positiveInt(edge?.sourceSystemID)) {
      return { success: false, errorMsg: "NPC_TRAVEL_SOURCE_INVALID" };
    }
    if (edge.kind === "jump-drive" && !options.jumpFuelDebit) {
      return { success: false, errorMsg: "NPC_TRAVEL_JUMP_FUEL_REQUIRED" };
    }
    if (edge.kind !== "jump-drive") {
      const current = deps.routePlanner.validateNpcTravelEdge(edge);
      if (!current?.success || current.data?.requiresMaintenance) {
        return { success: false, errorMsg: "NPC_TRAVEL_EDGE_INVALIDATED" };
      }
    }
    const key = String(options.idempotencyKey ||
      `npc-travel:${entityID}:${entity.npcIncarnation}:${edge.sourceSystemID}:${edge.destinationSystemID}:${options.jobID || "manual"}`);
    const operation = deps.persistence.beginNpcOperation(OPERATION_TYPE, key, {
      entityID: positiveInt(entityID),
      npcCharacterID: positiveInt(entity.npcCharacterID),
      incarnation: positiveInt(entity.npcIncarnation),
      sourceSystemID: positiveInt(edge.sourceSystemID),
      destinationSystemID: positiveInt(edge.destinationSystemID),
      sourceID: positiveInt(edge.sourceID),
      destinationID: positiveInt(edge.destinationID),
      destinationPosition: vector(edge.destinationPosition),
      routeKind: String(edge.kind || ""),
      cargoIDs: deps.store.listNativeCargoForEntity(entityID)
        .map((cargo) => positiveInt(cargo.cargoID)),
      jumpFuelDebit: cloneValue(options.jumpFuelDebit || null),
      jobID: String(options.jobID || ""),
    }).data;
    return completeOperation(operation);
  }

  function recoverNpcTravelOperation(operation) {
    return completeOperation(operation, { recovered: true, broadcast: false });
  }

  return { transitionNpcThroughEdge, recoverNpcTravelOperation };
}

let defaultRuntime = null;
function getDefaultRuntime() {
  return defaultRuntime ||= createNpcTravelTransitionRuntime();
}

module.exports = {
  OPERATION_TYPE,
  createNpcTravelTransitionRuntime,
  transitionNpcThroughEdge: (...args) => getDefaultRuntime().transitionNpcThroughEdge(...args),
  recoverNpcTravelOperation: (...args) => getDefaultRuntime().recoverNpcTravelOperation(...args),
};
