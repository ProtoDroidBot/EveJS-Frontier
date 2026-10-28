"use strict";

// Build 3640684 docking_point/common/{modules,services,const,refueling}.py.
const itemStore = require("../inventory/itemStore");
const fitting = require("../fitting/liveFittingState");
const fuel = require("./fuelTankRuntime");
const { createTableRepository } = require("../../gameStore/tableRepository");
const { canEntitiesInteractLocally } = require("../../space/destiny/identity/interactionScope");
const { currentFileTime, buildList } = require("../_shared/serviceHelpers");
const destiny = require("../../space/destiny");
const TABLE = "frontierDockingPoints";
const SERVICES = new Map<number, string[]>([
  [95676, ["cargo_access", "refueling"]], [97523, ["cargo_access", "refueling"]],
  [97524, ["refueling"]], [97565, ["cargo_access"]], [97581, ["cargo_access"]],
  [97607, ["cargo_access", "refueling"]],
]);
const clone = value => value == null ? value : JSON.parse(JSON.stringify(value));
const positive = value => Number.isSafeInteger(Number(value)) && Number(value) > 0 ? Number(value) : 0;
const vector = value => ({ x: Number(value?.x) || 0, y: Number(value?.y) || 0, z: Number(value?.z) || 0 });
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const fail = errorMsg => ({ success: false as const, errorMsg });

function createDockingPointRuntime(deps: Record<string, any> = {}) {
  const repo = deps.repo || createTableRepository("service:docking-point", { strict: true });
  const inventory = deps.itemStore || itemStore;
  const fit = deps.fitting || fitting;
  const tank = deps.fuel || fuel;
  const now = deps.now || Date.now;
  const active = new Map<number, any>();
  const runtime = () => deps.spaceRuntime || require("../../space/runtime");
  function read(shipID) {
    const result = repo.read(TABLE, `/ship:${shipID}`);
    return result?.success ? clone(result.data) : null;
  }
  function records() {
    const result = repo.read(TABLE, "/");
    return Object.values<any>(result?.success && result.data || {});
  }
  function save(record) {
    try {
      const ready = repo.ensureTable(TABLE);
      if (ready?.success === false) return false;
      return repo.commitAtomicRowWrites([repo.prepareAtomicRowWrite(TABLE, `ship:${record.shipID}`, record)])?.success === true;
    } catch (_) { return false; }
  }
  function identity(session) {
    return { characterID: positive(session?.characterID || session?.charid),
      shipID: positive(session?.shipID || session?.shipid || session?._space?.shipID),
      systemID: positive(session?.solarsystemid2 || session?.solarsystemid || session?._space?.systemID) };
  }
  function notify(session, name, record, cancelled = false) {
    const args = [record.pointID, record.shipID, record.characterID];
    if (name === "OnDockingSequenceFailed") args.push(cancelled as any);
    session?.sendNotification?.(name, "clientID", args);
  }
  function capabilities(session) {
    const ids = identity(session);
    const ship = inventory.findItemById(ids.shipID);
    if (!ids.characterID || !ship || Number(ship.ownerID) !== ids.characterID) return { magnetic_docking: false, autohelm: false };
    const context = (deps.getCreationDogmaContext || require("./creationRuntime").getCreationDogmaContext)(ship, ids.characterID);
    const modules = [...fit.getFittedModuleItems(ids.characterID, ids.shipID),
      ...(context?.success ? context.data.moduleItems || [] : [])]
      .filter(module => context?.success && (context.data.moduleItems || []).includes(module)
        ? module.moduleState?.online === true : fit.isEffectivelyOnlineModule(module));
    const has = (attribute, typeID) => modules.some(module => Number(module.typeID) === typeID ||
      Number(fit.getTypeAttributeMap(module.typeID)?.[attribute]) > 0);
    return { magnetic_docking: has(6395, 96676), autohelm: has(6307, 95767) };
  }
  function access(session, pointID, requireModule = false) {
    const ids = identity(session);
    if (!ids.characterID || !ids.shipID || !ids.systemID || positive(session?.stationid || session?.stationID)) return fail("DockingNotInSpace");
    const shipItem = inventory.findItemById(ids.shipID);
    const ship = runtime().getEntity(session, ids.shipID);
    const point = runtime().getEntity(session, positive(pointID));
    const pointItem = inventory.findItemById(positive(pointID)) || point;
    if (!shipItem || Number(shipItem.ownerID) !== ids.characterID || !ship || Number(ship.ownerID || ids.characterID) !== ids.characterID) return fail("DockingShipNotFound");
    if (!point || !pointItem || !SERVICES.has(Number(point.typeID)) ||
        (point.systemID && Number(point.systemID) !== ids.systemID) ||
        !canEntitiesInteractLocally(ship, point) || point.destroyed || point.removed) return fail("DockingPointNotFound");
    // Placed NPC ports are public except the limited-access class. Player ports
    // default to owner/corporation access; explicit server-authored public access
    // can enable them. No caller-provided access bits are accepted.
    const owner = positive(pointItem.ownerID || point.ownerID);
    const npcPublic = owner > 0 && owner < 90_000_000 && Number(point.typeID) !== 97607;
    const sameCorporation = positive(pointItem.corporationID || point.corporationID) &&
      positive(pointItem.corporationID || point.corporationID) === positive(session.corpid || session.corporationID);
    const publicPort = point.dockingPointPublic === true || pointItem.dockingPointPublic === true;
    if (owner !== ids.characterID && !sameCorporation && !npcPublic && !publicPort) return fail("DockingPointAccessDenied");
    if (point.assemblyStatus === "underConstruction" || point.active === false || point.moduleState?.incapacitated) return fail("DockingPointUnavailable");
    if (requireModule && !capabilities(session).magnetic_docking) return fail("DockingModuleNotFitted");
    return { success: true as const, data: { ...ids, ship, shipItem, point, pointItem, services: SERVICES.get(Number(point.typeID)) } };
  }
  function release(session, record, failed = false, cancelled = false) {
    if (!save({ ...record, status: "released", updatedAtMs: now() })) return fail("DockingStateWriteFailed");
    active.delete(record.shipID);
    const ship = runtime().getEntity(session, record.shipID);
    if (ship) {
      delete ship.frontierDockingPointID;
      delete ship.frontierDockingPhase;
      ship.mode = "STOP";
      ship.velocity = { x: 0, y: 0, z: 0 };
      ship.speedFraction = 0;
    }
    notify(session, failed ? "OnDockingSequenceFailed" : "OnShipUndockedFromPoint", record, cancelled);
    return { success: true as const };
  }
  function offers(services, pointID) { return services.map(service => [service, service === "cargo_access" ? Number(pointID) : null]); }
  function manualDock(session, pointID) {
    const check = access(session, pointID, true);
    if (!check.success) return check;
    const { ship, point, shipID, characterID, systemID, services } = check.data;
    if (ship.mode === "WARP" || ship.pendingDock || ship.frontierBerthingHostAssemblyID) return fail("DockingShipUnavailable");
    const previous = read(shipID);
    if (previous && previous.status !== "released") {
      if (previous.pointID === Number(pointID) && previous.characterID === characterID && previous.systemID === systemID) {
        active.set(shipID, { session, record: previous });
        return { success: true as const, data: offers(services, pointID) };
      }
      return fail("DockingAlreadyInProgress");
    }
    const target = vector(point.position);
    const start = vector(ship.position);
    const range = distance(start, target);
    if (range > 105) return fail("DockingPointOutOfRange");
    if (records().some(row => row.pointID === Number(pointID) && row.systemID === systemID && row.status !== "released" && row.shipID !== shipID)) return fail("DockingPointOccupied");
    const at = now();
    const record = { version: 1, shipID, characterID, systemID, pointID: Number(pointID),
      pointTypeID: Number(point.typeID), status: "approaching", startedAtMs: at, updatedAtMs: at,
      settleAtMs: at + Math.max(500, range / 35 * 1000),
      completeAtMs: at + Math.max(500, range / 35 * 1000) + 1500,
      startPosition: start, targetPosition: target, services };
    if (!save(record)) return fail("DockingStateWriteFailed");
    // Stop before installing the movement lock; normal pilot commands must not
    // alter a dock sequence that the authority has accepted.
    runtime().stop?.(session);
    ship.frontierDockingPointID = record.pointID;
    ship.frontierDockingPhase = record.status;
    ship.manualFlightActive = false;
    active.set(shipID, { session, record });
    notify(session, "OnDockingSequenceStarted", record);
    return { success: true as const, data: offers(services, pointID) };
  }
  function undock(session, pointID) {
    const ids = identity(session);
    const record = read(ids.shipID);
    if (!record || record.status === "released") return { success: true as const };
    if (record.characterID !== ids.characterID || record.pointID !== Number(pointID)) return fail("DockingPointAccessDenied");
    if (record.status === "departing") return { success: true as const };
    if (record.status !== "docked") return release(session, record, true, true);
    const ship = runtime().getEntity(session, record.shipID);
    if (!ship || record.systemID !== ids.systemID) return release(session, record);
    const at = now();
    const next = { ...record, status: "departing", departureStartedAtMs: at,
      departureCompleteAtMs: at + 3000, departurePosition: vector(ship.position), updatedAtMs: at };
    if (!save(next)) return fail("DockingStateWriteFailed");
    ship.frontierDockingPhase = "departing";
    active.set(record.shipID, { session, record: next });
    return { success: true as const };
  }
  function getDockedPoint(session) {
    const ids = identity(session);
    const record = read(ids.shipID);
    if (!record || record.status === "released" || record.characterID !== ids.characterID) return null;
    const check = access(session, record.pointID);
    if (!check.success || record.systemID !== ids.systemID) {
      release(session, record, true, false);
      return null;
    }
    const ship = check.data.ship;
    ship.frontierDockingPointID = record.pointID;
    ship.frontierDockingPhase = record.status;
    if (record.status === "docked") {
      ship.position = vector(check.data.point.position);
      ship.velocity = { x: 0, y: 0, z: 0 }; ship.mode = "STOP"; ship.speedFraction = 0;
    }
    active.set(ids.shipID, { session, record });
    return record.pointID;
  }
  function publishPosition(scene, session, ship, atMs) {
    const stamp = scene.getHistorySafeSessionDestinyStamp?.(session, atMs, 1);
    if (stamp !== undefined) scene.broadcastPilotCommandMovementUpdates?.(session, [
      { stamp, payload: destiny.buildSetBallPositionPayload(ship.itemID, ship.position) },
      { stamp, payload: destiny.buildSetBallVelocityPayload(ship.itemID, ship.velocity) },
    ], atMs);
    scene.scheduleWatcherMovementAnchor?.(ship, atMs, "dockingPoint");
  }
  function advanceScene(scene, atMs = now()) {
    for (const entry of [...active.values()]) {
      const { session } = entry;
      let record = entry.record;
      if (record.systemID !== Number(scene.systemID)) continue;
      if (record.status === "departing") {
        const ship = runtime().getEntity(session, record.shipID);
        if (!ship || identity(session).shipID !== record.shipID || identity(session).systemID !== record.systemID) {
          release(session, record, true, false); continue;
        }
        const elapsed = Math.max(0, Math.min(3000, atMs - record.departureStartedAtMs));
        ship.position = { ...record.departurePosition, y: record.departurePosition.y + 35 * elapsed / 1000 };
        ship.velocity = { x: 0, y: 0, z: 0 }; ship.mode = "STOP"; ship.speedFraction = 0;
        publishPosition(scene, session, ship, atMs);
        if (atMs >= record.departureCompleteAtMs) release(session, record);
        continue;
      }
      const check = access(session, record.pointID, true);
      if (!check.success || identity(session).shipID !== record.shipID || identity(session).systemID !== record.systemID) {
        release(session, record, true, false); continue;
      }
      const { ship, point } = check.data;
      const target = vector(point.position);
      if (distance(target, record.targetPosition) > 25 || atMs - record.startedAtMs > 16000 && record.status !== "docked") {
        release(session, record, true, false); continue;
      }
      const nextStatus = atMs >= record.completeAtMs ? "docked" : atMs >= record.settleAtMs ? "settling" : "approaching";
      if (record.status !== nextStatus) {
        const next = { ...record, status: nextStatus, updatedAtMs: atMs };
        if (!save(next)) continue;
        if (record.status === "approaching") notify(session, "OnShipSettlingAtPoint", next);
        if (nextStatus === "docked") notify(session, "OnShipDockedToPoint", next);
        entry.record = record = next;
      }
      const fraction = Math.max(0, Math.min(1, (atMs - record.startedAtMs) / (record.settleAtMs - record.startedAtMs)));
      ship.position = Object.fromEntries(["x", "y", "z"].map(key => [key,
        record.startPosition[key] + (target[key] - record.startPosition[key]) * fraction]));
      ship.velocity = { x: 0, y: 0, z: 0 }; ship.speedFraction = 0; ship.mode = "STOP";
      ship.frontierDockingPointID = record.pointID; ship.frontierDockingPhase = record.status;
      if (record.status === "docked" && entry.lastPinnedAt && atMs - entry.lastPinnedAt < 1000) continue;
      publishPosition(scene, session, ship, atMs);
      entry.lastPinnedAt = atMs;
    }
  }
  function detachSession(session) {
    const ids = identity(session);
    const record = read(ids.shipID);
    if (record?.characterID !== ids.characterID) return;
    if (record.status !== "docked" && record.status !== "released") release(session, record, true, true);
    active.delete(ids.shipID);
  }
  function getCargoAccessError(session, pointID) {
    const point = runtime().getEntity(session, Number(pointID)) || inventory.findItemById(Number(pointID));
    if (!point || !SERVICES.has(Number(point.typeID))) return null;
    const ids = identity(session); const record = read(ids.shipID);
    const check = access(session, pointID);
    return check.success && record?.systemID === ids.systemID && distance(vector(check.data.ship.position), vector(check.data.point.position)) <= 105 && record?.status === "docked" && record.characterID === ids.characterID &&
      record.pointID === Number(pointID) && check.data.services.includes("cargo_access") ? null : "DOCKING_POINT_ACCESS_DENIED";
  }
  function refuelFromPort(session, pointID, typeID, quantity) {
    const check = access(session, pointID, true);
    if (!check.success) return check;
    const { shipID, characterID, ship, shipItem, pointItem, services } = check.data;
    const record = read(shipID);
    if (record?.status !== "docked" || record.characterID !== characterID || record.pointID !== Number(pointID)) return fail("DockingNotComplete");
    if (distance(vector(ship.position), vector(check.data.point.position)) > 105) return fail("DockingPointOutOfRange");
    if (!services.includes("refueling") || Number(typeID) !== 77818) return fail("DockingFuelTypeUnsupported");
    if (!Number.isSafeInteger(quantity) || quantity <= 0) return fail("DockingFuelQuantityInvalid");
    const context = (deps.getCreationDogmaContext || require("./creationRuntime").getCreationDogmaContext)(shipItem, characterID);
    const resources = fit.buildShipResourceState(characterID, shipItem, context?.success ? {
      additionalAttributeModifierEntries: context.data.shipAttributeModifierEntries || [],
    } : {});
    const capacity = Number(resources.attributes?.[5633]) || 0;
    const tankInfo = tank.resolveShipFuelTank(shipItem, capacity);
    if (!tankInfo.supported || !tank.getAllowedShipFuelGroupIDs(shipItem, tankInfo).includes(
      Number((deps.resolveItemByTypeID || require("../inventory/itemTypeRegistry").resolveItemByTypeID)(Number(typeID))?.groupID))) return fail("FUEL_TYPE_INCOMPATIBLE");
    const previous = tank.getShipFuelCharge(shipItem);
    if (quantity > Math.floor(capacity - previous)) return fail("FUEL_TANK_OVERFLOW");
    const stacks = inventory.listContainerItems(Number(pointItem.ownerID), Number(pointID), 5)
      .filter(item => Number(item.typeID) === Number(typeID) && item.singleton !== 1);
    let remaining = quantity;
    const consumptions = [];
    for (const stack of stacks) {
      const take = Math.min(remaining, Number(stack.quantity) || Number(stack.stacksize) || 0);
      if (take > 0) consumptions.push({ itemID: stack.itemID, typeID: Number(typeID), quantity: take });
      remaining -= take;
      if (!remaining) break;
    }
    if (remaining) return fail("FUEL_SOURCE_INSUFFICIENT");
    const reserve = tank.resolveCreationReserveFuelCapacity(shipItem, tankInfo);
    const queue = tank.appendFuelQueueBatchByReserveCapacity(tank.getShipFuelQueue(shipItem), Number(typeID), quantity, capacity, reserve);
    const conditionState = { ...shipItem.conditionState, fuelCharge: previous + quantity, fuelQueue: queue, fuelTypeID: queue[0]?.fuelTypeID || Number(typeID) };
    delete conditionState.fuelComposition;
    const result = inventory.applyInventoryTransactionWithAtomicRows({ characterID, consumptions,
      sourceLocationIDs: [Number(pointID)], sourceFlagIDs: [5], sourceOwnerIDs: [Number(pointItem.ownerID)],
      itemUpdates: [{ itemID: shipID, expectedOwnerID: characterID, changes: { conditionState } }],
    }, []);
    if (!result?.success) return result || fail("FUEL_STATE_WRITE_FAILED");
    ship.conditionState = clone(conditionState);
    (deps.emitInventoryChanges || require("../character/characterState").emitItemsChangedBatchForSession)(session, result.data?.changes || []);
    const when = currentFileTime();
    const attributeChanges: any[] = [["OnModuleAttributeChange", characterID, shipID, 5635, when, previous + quantity, previous, null]];
    if (typeof tank.calculateFuelQueueProperties === "function") {
      const before = tank.calculateFuelQueueProperties(tank.getShipFuelQueue(shipItem));
      const after = tank.calculateFuelQueueProperties(queue);
      for (const [property, attributeID] of Object.entries(tank.FUEL_PROPERTY_ATTRIBUTE_IDS)) {
        if (Number(before[property]) !== Number(after[property])) attributeChanges.push([
          "OnModuleAttributeChange", characterID, shipID, attributeID, when, after[property], before[property], null,
        ]);
      }
    }
    session?.sendNotification?.("OnModuleAttributeChanges", "clientID", [buildList(attributeChanges)]);
    return { success: true as const, data: { quantity, fuelCharge: previous + quantity } };
  }
  return { capabilities, manualDock, undock, getDockedPoint, advanceScene, detachSession, getCargoAccessError, refuelFromPort,
    isMovementLocked: entity => positive(entity?.frontierDockingPointID) > 0,
    _testing: { read, records, access, active } };
}
let singleton;
const get = () => singleton || (singleton = createDockingPointRuntime());
module.exports = { TABLE, SERVICES, createDockingPointRuntime,
  ...Object.fromEntries(["capabilities", "manualDock", "undock", "getDockedPoint", "advanceScene", "detachSession", "getCargoAccessError", "refuelFromPort", "isMovementLocked"]
    .map(name => [name, (...args) => {
      if (Number(require("../../config").clientBuild) !== 3640684) {
        if (name === "capabilities") return { magnetic_docking: false, autohelm: false };
        if (name === "isMovementLocked") return false;
        if (["manualDock", "undock", "refuelFromPort"].includes(name)) return fail("DockingNotAvailable");
        return null;
      }
      return get()[name](...args);
    }])) };
