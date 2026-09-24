"use strict";

const { createTableRepository } = require("../gameStore/tableRepository");

const TABLE = "detachedDungeonProps";
const VERSION = 1;
const WORLD_ID_BASE = 8_600_000_000_000_000;
const WORLD_ID_LIMIT = 8_700_000_000_000_000;

const PRESENTATION_FIELDS = Object.freeze([
  "typeID", "groupID", "categoryID", "graphicID", "visualTypeID",
  "ownerID", "itemName", "slimName", "slimTypeID", "slimGroupID",
  "slimCategoryID", "slimGraphicID", "suppressSlimGraphicID",
  "suppressSlimName", "nameID", "radius", "collisionScale",
  "dunRotation", "mass", "agility", "inertia", "maxVelocity", "speed",
  "speedFraction",
  "destinyBallMode", "destinyForceFree", "destinyBallFlags",
  "destinyCollisionTail", "destinyCollisionTailSource",
  "destinyBootstrapDelivery", "destinyMode", "destinyFlags",
]);

function positiveID(value) {
  const numeric = Number(value);
  return Number.isSafeInteger(numeric) && numeric > 0 ? numeric : null;
}

function finiteVector(value) {
  if (!value || typeof value !== "object") return null;
  const { x, y, z } = value;
  return [x, y, z].every((part) => typeof part === "number" && Number.isFinite(part))
    ? { x, y, z }
    : null;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function sourceKey(systemID, instanceID, siteID, entityID) {
  const ids = [systemID, instanceID, siteID, entityID].map(positiveID);
  return ids.every(Boolean) ? ids.join(":") : null;
}

function buildWorldEntity(source, worldEntityID) {
  const position = finiteVector(source && source.position);
  const itemID = positiveID(worldEntityID);
  const typeID = positiveID(source && source.typeID);
  if (!position || !itemID || !typeID) return null;
  const entity: Record<string, any> = {
    itemID,
    kind: "detachedDungeonProp",
    staticVisibilityScope: "bubble",
    collisionStatic: true,
    position,
    velocity: { x: 0, y: 0, z: 0 },
    direction: finiteVector(source.direction) || { x: 1, y: 0, z: 0 },
  };
  for (const field of PRESENTATION_FIELDS) {
    if (Object.hasOwn(source, field) && source[field] !== undefined) {
      entity[field] = field === "destinyCollisionTail" && Buffer.isBuffer(source[field])
        ? source[field].toString("hex")
        : clone(source[field]);
    }
  }
  entity.typeID = typeID;
  entity.radius = Math.max(1, Number(entity.radius) || 1);
  if (!Number.isFinite(Number(entity.collisionScale)) || Number(entity.collisionScale) <= 0) {
    delete entity.collisionScale;
  }
  if (!Array.isArray(entity.dunRotation) || entity.dunRotation.length !== 3 ||
      !entity.dunRotation.every((part) => Number.isFinite(part))) {
    entity.dunRotation = [0, 0, 0];
  }
  return entity;
}

function normalizeRecord(raw, key) {
  const record = raw && typeof raw === "object" ? raw : null;
  if (!record) return null;
  const systemID = positiveID(record.systemID);
  const instanceID = positiveID(record.sourceInstanceID);
  const siteID = positiveID(record.sourceSiteID);
  const sourceEntityID = positiveID(record.sourceEntityID);
  const worldEntityID = positiveID(record.worldEntityID);
  if (
    !systemID || !instanceID || !siteID || !sourceEntityID || !worldEntityID ||
    worldEntityID < WORLD_ID_BASE || worldEntityID >= WORLD_ID_LIMIT ||
    sourceKey(systemID, instanceID, siteID, sourceEntityID) !== key
  ) return null;
  const worldEntity = buildWorldEntity(record.worldEntity, worldEntityID);
  if (!worldEntity || worldEntity.kind !== "detachedDungeonProp") return null;
  return {
    version: VERSION,
    revision: Math.max(1, Math.trunc(Number(record.revision) || 1)),
    systemID,
    sourceInstanceID: instanceID,
    sourceSiteID: siteID,
    sourceEntityID,
    worldEntityID,
    createdAtMs: Math.max(0, Math.trunc(Number(record.createdAtMs) || 0)),
    worldEntity,
  };
}

function normalizeState(raw) {
  const source = raw && typeof raw === "object" ? raw : {};
  const recordsBySource: Record<string, any> = {};
  let highestID = WORLD_ID_BASE - 1;
  const seenWorldIDs = new Set<any>();
  for (const [key, value] of Object.entries<any>(source.recordsBySource || {})) {
    const record = normalizeRecord(value, key);
    if (!record || seenWorldIDs.has(record.worldEntityID)) {
      throw new Error("DETACHED_PROP_STORE_CORRUPT");
    }
    recordsBySource[key] = record;
    seenWorldIDs.add(record.worldEntityID);
    highestID = Math.max(highestID, record.worldEntityID);
  }
  return {
    version: VERSION,
    nextWorldEntityID: Math.max(
      WORLD_ID_BASE,
      highestID + 1,
      positiveID(source.nextWorldEntityID) || WORLD_ID_BASE,
    ),
    recordsBySource,
  };
}

function createDetachedDungeonPropStore(options: Record<string, any> = {}) {
  const store = options.store || createTableRepository("in-space", { strict: true });

  function readState() {
    if (store.ensureTable(TABLE) === false) throw new Error("DETACHED_PROP_TABLE_UNAVAILABLE");
    const result = store.read(TABLE, "/");
    if (!result || result.success !== true) throw new Error("DETACHED_PROP_READ_FAILED");
    return normalizeState(result.data);
  }

  function writeState(next, previous) {
    if (typeof store.flushTableSync !== "function") {
      return { success: false, errorMsg: "DETACHED_PROP_DURABILITY_UNAVAILABLE" };
    }
    const written = store.write(TABLE, "/", next, { force: true });
    if (!written || written.success !== true) {
      return { success: false, errorMsg: "DETACHED_PROP_WRITE_FAILED" };
    }
    const flushed = store.flushTableSync(TABLE);
    if (!flushed || flushed.success !== true) {
      // A failed flush must not leave the proposed record in the process cache,
      // where a later unrelated flush could commit an unreported detachment.
      try {
        store.write(TABLE, "/", previous, { force: true });
        store.flushTableSync(TABLE);
      } catch (_error) {
        // Reconciliation on restart remains authoritative if storage is down.
      }
      return { success: false, errorMsg: "DETACHED_PROP_FLUSH_FAILED" };
    }
    return { success: true };
  }

  function listSystem(systemID) {
    const normalizedSystemID = positiveID(systemID);
    if (!normalizedSystemID) return [];
    return Object.values<any>(readState().recordsBySource)
      .filter((record) => record.systemID === normalizedSystemID)
      .sort((left, right) => left.worldEntityID - right.worldEntityID)
      .map(clone);
  }

  function suppressedSourceIDs(systemID, instanceID, siteID) {
    const prefix = sourceKey(systemID, instanceID, siteID, 1);
    if (!prefix) return new Set();
    const keyPrefix = prefix.slice(0, prefix.lastIndexOf(":") + 1);
    const result = new Set<any>();
    for (const [key, record] of Object.entries<any>(readState().recordsBySource)) {
      if (key.startsWith(keyPrefix)) result.add(record.sourceEntityID);
    }
    return result;
  }

  function getBySource(systemID, instanceID, siteID, entityID) {
    const key = sourceKey(systemID, instanceID, siteID, entityID);
    if (!key) return null;
    const record = readState().recordsBySource[key];
    return record ? clone(record) : null;
  }

  function getByWorldID(systemID, worldEntityID) {
    const numericSystemID = positiveID(systemID);
    const numericWorldID = positiveID(worldEntityID);
    if (!numericSystemID || !numericWorldID) return null;
    const record = Object.values<any>(readState().recordsBySource)
      .find((candidate) => candidate.systemID === numericSystemID &&
        candidate.worldEntityID === numericWorldID);
    return record ? clone(record) : null;
  }

  function checkpointPose(systemID, worldEntityID, position, rotation = undefined) {
    const numericSystemID = positiveID(systemID);
    const numericWorldID = positiveID(worldEntityID);
    const nextPosition = finiteVector(position);
    if (!numericSystemID || !numericWorldID || !nextPosition) {
      return { success: false, errorMsg: "DETACHED_PROP_INVALID_POSE" };
    }
    if (rotation !== undefined &&
        (!Array.isArray(rotation) || rotation.length !== 3 ||
          !rotation.every((angle) => Number.isFinite(angle) && Math.abs(angle) <= 360))) {
      return { success: false, errorMsg: "DETACHED_PROP_INVALID_ROTATION" };
    }
    const state = readState();
    const entry = Object.entries<any>(state.recordsBySource)
      .find(([, record]) => record.systemID === numericSystemID &&
        record.worldEntityID === numericWorldID);
    if (!entry) return { success: false, errorMsg: "DETACHED_PROP_NOT_FOUND" };
    const [key, record] = entry;
    const nextRecord = {
      ...record,
      revision: record.revision + 1,
      worldEntity: {
        ...record.worldEntity,
        position: nextPosition,
        ...(rotation === undefined ? {} : { dunRotation: [...rotation] }),
      },
    };
    const next = {
      ...state,
      recordsBySource: { ...state.recordsBySource, [key]: nextRecord },
    };
    const result = writeState(next, state);
    return result.success
      ? { success: true, data: clone(nextRecord) }
      : result;
  }

  function detach(source, identity, scene = null) {
    const systemID = positiveID(identity && identity.systemID);
    const instanceID = positiveID(identity && identity.instanceID);
    const siteID = positiveID(identity && identity.siteID);
    const sourceEntityID = positiveID(identity && identity.entityID);
    const key = sourceKey(systemID, instanceID, siteID, sourceEntityID);
    if (!key || positiveID(source && source.itemID) !== sourceEntityID) {
      return { success: false, errorMsg: "DETACHED_PROP_INVALID_SOURCE" };
    }
    const state = readState();
    if (state.recordsBySource[key]) {
      return { success: true, alreadyDetached: true, data: clone(state.recordsBySource[key]) };
    }
    let worldEntityID = state.nextWorldEntityID;
    const occupied = new Set(Object.values<any>(state.recordsBySource)
      .map((record) => record.worldEntityID));
    while (
      worldEntityID < WORLD_ID_LIMIT &&
      (occupied.has(worldEntityID) ||
        (scene && scene.staticEntitiesByID instanceof Map &&
          scene.staticEntitiesByID.has(worldEntityID)) ||
        (scene && scene.dynamicEntities instanceof Map &&
          scene.dynamicEntities.has(worldEntityID)))
    ) worldEntityID += 1;
    if (worldEntityID >= WORLD_ID_LIMIT) {
      return { success: false, errorMsg: "DETACHED_PROP_ID_EXHAUSTED" };
    }
    const worldEntity = buildWorldEntity(source, worldEntityID);
    if (!worldEntity) return { success: false, errorMsg: "DETACHED_PROP_INVALID_PRESENTATION" };
    const record = {
      version: VERSION,
      revision: 1,
      systemID,
      sourceInstanceID: instanceID,
      sourceSiteID: siteID,
      sourceEntityID,
      worldEntityID,
      createdAtMs: Date.now(),
      worldEntity,
    };
    const next = {
      ...state,
      nextWorldEntityID: worldEntityID + 1,
      recordsBySource: { ...state.recordsBySource, [key]: record },
    };
    const writeResult = writeState(next, state);
    return writeResult.success
      ? { success: true, alreadyDetached: false, data: clone(record) }
      : writeResult;
  }

  return { listSystem, suppressedSourceIDs, getBySource, getByWorldID, checkpointPose, detach };
}

let defaultStore = null;
function getDetachedDungeonPropStore() {
  return defaultStore ||= createDetachedDungeonPropStore();
}

module.exports = {
  TABLE,
  WORLD_ID_BASE,
  WORLD_ID_LIMIT,
  buildWorldEntity,
  createDetachedDungeonPropStore,
  getDetachedDungeonPropStore,
};
