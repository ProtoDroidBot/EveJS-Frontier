"use strict";

const { randomUUID } = require("crypto");

const TABLE = "voxelMiningState";
const MAX_GRID_LENGTH = 32768;
const clone = value => value == null ? value : JSON.parse(JSON.stringify(value));
const failure = errorMsg => ({ success: false as const, errorMsg });
const positiveID = value => Number.isSafeInteger(Number(value)) && Number(value) > 0;
const quantity = value => Number.isSafeInteger(Number(value)) && Number(value) >= 0;

function asteroidKey(identity) {
  const world = identity && identity.worldRevision;
  if (typeof world !== "string" || world.length === 0 || world.length > 512 ||
      !positiveID(identity.systemID) || !positiveID(identity.asteroidID)) return null;
  return `a:${Buffer.from(world).toString("base64url")}:${Number(identity.systemID)}:${Number(identity.asteroidID)}`;
}

function fragmentKey(itemID) { return positiveID(itemID) ? `f:${Number(itemID)}` : null; }

function finitePosition(value) {
  if (!value || ![value.x, value.y, value.z].every(v => Number.isFinite(Number(v)))) return null;
  return { x: Number(value.x), y: Number(value.y), z: Number(value.z) };
}

/** Dependency injection keeps protocol tests independent from live game data. */
function createVoxelMiningStore(options: Record<string, any>) {
  const repo = options.repo;
  const now = options.now || Date.now;
  const runtimeIdentity = options.runtimeIdentity || randomUUID();
  let ready = false;
  function ensureReady() {
    if (!ready) {
      const result = repo.ensureTable(TABLE);
      if (result && result.success === false) throw new Error("VOXEL_STORE_UNAVAILABLE");
      ready = true;
    }
  }
  function read(key) {
    if (!key) return null;
    ensureReady();
    const result = repo.read(TABLE, `/${key}`);
    return result && result.success ? clone(result.data) : null;
  }
  function proposal(key, value) {
    ensureReady();
    return repo.prepareAtomicRowWrite(TABLE, key, value);
  }
  function commit(rows) {
    try {
      const result = repo.commitAtomicRowWrites(rows);
      return result && result.success ? { success: true as const } : failure(result && result.errorMsg || "ATOMIC_WRITE_ERROR");
    } catch (_) { return failure("ATOMIC_WRITE_ERROR"); }
  }
  function getAsteroid(identity) { return read(asteroidKey(identity)); }
  function getFragment(itemID) { return read(fragmentKey(itemID)); }
  function activeClaim(fragment, atMs) {
    return fragment && fragment.status === "claimed" && fragment.claim &&
      fragment.claim.runtimeIdentity === runtimeIdentity && fragment.claim.expiresAtMs > atMs;
  }
  function listFragments(worldRevision, systemID) {
    ensureReady();
    const result = repo.read(TABLE, "/");
    const atMs = now();
    return Object.values<any>(result && result.success && result.data || {})
      .filter(row => row.kind === "fragment" && row.worldRevision === worldRevision &&
        row.systemID === Number(systemID) && ["available", "claimed"].includes(row.status))
      .map(row => {
        const copy = clone(row);
        if (copy.status === "claimed" && !activeClaim(copy, atMs)) {
          copy.status = "available";
          copy.claim = null;
        }
        return copy;
      });
  }
  function registerAsteroid(request) {
    const key = asteroidKey(request);
    const model = request && request.model;
    const gridLength = Number(model && (model.gridLength ?? model.grid?.length));
    if (!key || !model || typeof model.recipeHash !== "string" || !model.recipeHash ||
        !model.recipe || !Number.isSafeInteger(gridLength) || gridLength <= 0 || gridLength > MAX_GRID_LENGTH ||
        !quantity(request.originalQuantity) || !Number.isFinite(request.unitVolume) || request.unitVolume <= 0) {
      return failure("INVALID_ASTEROID_STATE");
    }
    const existing = read(key);
    if (existing) {
      if (existing.model.recipeHash !== model.recipeHash || existing.model.gridLength !== gridLength ||
          existing.originalQuantity !== Number(request.originalQuantity) || existing.unitVolume !== request.unitVolume) {
        return failure("ASTEROID_RECIPE_MISMATCH");
      }
      return { success: true as const, data: existing };
    }
    const descriptor = clone(model);
    delete descriptor.grid;
    descriptor.gridLength = gridLength;
    const state = {
      version: 1, kind: "asteroid", key, worldRevision: request.worldRevision,
      systemID: Number(request.systemID), asteroidID: Number(request.asteroidID),
      model: descriptor, originalQuantity: Number(request.originalQuantity),
      remainingQuantity: Number(request.originalQuantity), extractedQuantity: 0,
      bonusQuantity: 0, wastedQuantity: 0, unitVolume: request.unitVolume,
      minedCells: [], cellDamage: {}, cellRemaining: {}, materialTotals: {}, revision: 0,
      createdAtMs: now(), updatedAtMs: now(),
    };
    const result = commit([proposal(key, state)]);
    return result.success ? { success: true as const, data: clone(state) } : result;
  }
  function commitExtraction(request) {
    const key = asteroidKey(request);
    const state = read(key);
    if (!state) return failure("ASTEROID_NOT_REGISTERED");
    if (state.revision !== request.expectedRevision) return failure("ASTEROID_REVISION_CONFLICT");
    const extracted = Number(request.extractedQuantity ?? 0);
    const bonus = Number(request.bonusQuantity ?? 0);
    const wasted = Number(request.wasteQuantity ?? 0);
    const depleted = extracted - bonus + wasted;
    if (![extracted, bonus, wasted].every(quantity) || bonus > extracted ||
        !Number.isSafeInteger(depleted) || depleted > state.remainingQuantity) return failure("INVALID_EXTRACTION_QUANTITY");
    const minedCells = request.minedCells || [];
    const validCell = index => Number.isSafeInteger(Number(index)) && Number(index) >= 0 && Number(index) < state.model.gridLength;
    if (!Array.isArray(minedCells) || !minedCells.every(validCell) ||
        new Set(minedCells.map(Number)).size !== minedCells.length ||
        minedCells.some(index => state.minedCells.includes(Number(index)))) return failure("INVALID_MINED_CELLS");
    const damageUpdates = request.cellDamageUpdates || {};
    const remainingUpdates = request.cellRemainingUpdates || {};
    for (const updates of [damageUpdates, remainingUpdates]) {
      if (!updates || Array.isArray(updates) || typeof updates !== "object") return failure("INVALID_CELL_STATE");
      for (const [index, value] of Object.entries(updates)) {
        if (!validCell(index) || !Number.isFinite(Number(value)) || Number(value) < 0 ||
            (state.minedCells.includes(Number(index)) && Number(value) !== 0)) return failure("INVALID_CELL_STATE");
      }
    }
    for (const index of minedCells) {
      if (remainingUpdates[String(index)] !== undefined && Number(remainingUpdates[String(index)]) !== 0) {
        return failure("INVALID_CELL_STATE");
      }
    }
    const fragmentSpecs = request.fragments || [];
    if (!Array.isArray(fragmentSpecs) || fragmentSpecs.length > MAX_GRID_LENGTH) return failure("INVALID_FRAGMENTS");
    let total = 0;
    for (const spec of fragmentSpecs) {
      if (!spec || !positiveID(spec.typeID) || !positiveID(spec.yieldTypeID ?? spec.typeID) ||
          !quantity(spec.quantity) || Number(spec.quantity) <= 0 || !finitePosition(spec.position) ||
          !Array.isArray(spec.sourceCellIndices || []) || !(spec.sourceCellIndices || []).every(validCell)) {
        return failure("INVALID_FRAGMENT");
      }
      total += Number(spec.quantity);
    }
    if (total !== extracted) return failure("EXTRACTION_FRAGMENT_MISMATCH");
    const active = listFragments(state.worldRevision, state.systemID);
    const policy = options.policy?.() || {};
    if ((Number(policy.maxFragmentsPerSystem) > 0 && active.length + fragmentSpecs.length > Number(policy.maxFragmentsPerSystem)) ||
        (Number(policy.maxFragmentsPerAsteroid) > 0 && active.filter(row => row.asteroidID === state.asteroidID).length + fragmentSpecs.length > Number(policy.maxFragmentsPerAsteroid))) return failure("FRAGMENT_LIMIT_REACHED");
    const atMs = now();
    let itemIDs: any[] = [];
    try {
      if (fragmentSpecs.length > 0) itemIDs = options.allocateIDs(fragmentSpecs.length);
    } catch (_) { return failure("IDENTITY_PERSISTENCE_ERROR"); }
    if (itemIDs.length !== fragmentSpecs.length || !itemIDs.every(positiveID) || new Set(itemIDs).size !== itemIDs.length) {
      return failure("IDENTITY_ALLOCATION_ERROR");
    }
    const fragments = fragmentSpecs.map((spec, index) => ({
      version: 1, kind: "fragment", itemID: Number(itemIDs[index]),
      worldRevision: state.worldRevision, systemID: state.systemID, asteroidID: state.asteroidID,
      typeID: Number(spec.typeID), yieldTypeID: Number(spec.yieldTypeID ?? spec.typeID),
      quantity: Number(spec.quantity), oreUnits: Number(spec.quantity), unitVolume: state.unitVolume,
      position: finitePosition(spec.position), sourceCellIndices: (spec.sourceCellIndices || []).map(Number),
      scopeMetadata: clone(spec.scopeMetadata || {}),
      createdAtMs: atMs, status: "available", claim: null,
    }));
    for (const fragment of fragments) if (read(fragmentKey(fragment.itemID))) return failure("FRAGMENT_ID_CONFLICT");
    const next = clone(state);
    next.remainingQuantity -= depleted;
    next.extractedQuantity += extracted;
    next.bonusQuantity += bonus;
    next.wastedQuantity += wasted;
    next.minedCells = [...state.minedCells, ...minedCells.map(Number)].sort((a, b) => a - b);
    for (const [index, value] of Object.entries(damageUpdates)) next.cellDamage[String(Number(index))] = Number(value);
    for (const [index, value] of Object.entries(remainingUpdates)) next.cellRemaining[String(Number(index))] = Number(value);
    for (const index of minedCells) {
      delete next.cellDamage[String(index)];
      next.cellRemaining[String(index)] = 0;
    }
    for (const fragment of fragments) {
      const type = String(fragment.yieldTypeID);
      next.materialTotals[type] = (next.materialTotals[type] || 0) + fragment.quantity;
    }
    if (![next.remainingQuantity, next.extractedQuantity, next.bonusQuantity, next.wastedQuantity,
      ...Object.values(next.materialTotals)].every(quantity)) return failure("EXTRACTION_QUANTITY_OVERFLOW");
    next.revision += 1;
    next.updatedAtMs = atMs;
    const result = commit([proposal(key, next), ...fragments.map(fragment => proposal(fragmentKey(fragment.itemID), fragment))]);
    return result.success ? { success: true as const, data: { asteroid: next, fragments } } : result;
  }
  function claimFragment(itemID, request) {
    const fragment = getFragment(itemID);
    const atMs = Number((request && request.nowMs) ?? now());
    if (!fragment || !["available", "claimed"].includes(fragment.status)) return failure("FRAGMENT_NOT_AVAILABLE");
    if (!request || request.worldRevision !== fragment.worldRevision || Number(request.systemID) !== fragment.systemID ||
        !positiveID(request.characterID) || !positiveID(request.shipID) || typeof request.claimToken !== "string" ||
        !request.claimToken || !Number.isFinite(atMs) || !Number.isFinite(request.expiresAtMs) ||
        request.expiresAtMs <= atMs || request.expiresAtMs > atMs + 300000) return failure("INVALID_FRAGMENT_CLAIM");
    if (activeClaim(fragment, atMs)) {
      return fragment.claim.claimToken === request.claimToken && fragment.claim.characterID === Number(request.characterID) &&
        fragment.claim.shipID === Number(request.shipID)
        ? { success: true as const, data: fragment } : failure("FRAGMENT_ALREADY_CLAIMED");
    }
    fragment.status = "claimed";
    fragment.claim = { claimToken: request.claimToken, characterID: Number(request.characterID),
      shipID: Number(request.shipID), expiresAtMs: request.expiresAtMs, runtimeIdentity };
    const result = commit([proposal(fragmentKey(itemID), fragment)]);
    return result.success ? { success: true as const, data: fragment } : result;
  }
  function cancelClaim(itemID, claimToken) {
    const fragment = getFragment(itemID);
    if (!fragment || fragment.status !== "claimed" || fragment.claim?.claimToken !== claimToken ||
        fragment.claim.runtimeIdentity !== runtimeIdentity) return failure("FRAGMENT_CLAIM_MISMATCH");
    fragment.status = "available";
    fragment.claim = null;
    const result = commit([proposal(fragmentKey(itemID), fragment)]);
    return result.success ? { success: true as const, data: fragment } : result;
  }
  function updateFragmentPosition(itemID, position, request: Record<string, any> = {}) {
    const fragment = getFragment(itemID);
    const normalizedPosition = finitePosition(position);
    if (!fragment || !normalizedPosition || !activeClaim(fragment, now()) ||
        fragment.claim.claimToken !== request.claimToken) return failure("FRAGMENT_CLAIM_MISMATCH");
    fragment.position = normalizedPosition;
    const result = commit([proposal(fragmentKey(itemID), fragment)]);
    return result.success ? { success: true as const, data: fragment } : result;
  }
  function completePickup(itemID, request) {
    const fragment = getFragment(itemID);
    const atMs = Number((request && request.nowMs) ?? now());
    if (!fragment || !activeClaim(fragment, atMs) || fragment.claim.claimToken !== request.claimToken ||
        fragment.claim.characterID !== Number(request.characterID) || fragment.claim.shipID !== Number(request.shipID)) {
      return failure("FRAGMENT_CLAIM_MISMATCH");
    }
    const consumed = { ...fragment, status: "consumed", consumedAtMs: atMs,
      consumedByCharacterID: Number(request.characterID), consumedByShipID: Number(request.shipID), claim: null };
    let result;
    try {
      result = options.grantAtomic({ characterID: Number(request.characterID), shipID: Number(request.shipID),
        flagID: Number(request.flagID), getDestinationCapacity: request.getDestinationCapacity,
        entries: [{ itemType: fragment.yieldTypeID, quantity: fragment.quantity }] },
        [proposal(fragmentKey(itemID), consumed)]);
    } catch (_) { return failure("ATOMIC_WRITE_ERROR"); }
    return result && result.success ? { ...result, data: { ...result.data, fragment: consumed } } : result || failure("ATOMIC_WRITE_ERROR");
  }
  function expireFragments(worldRevision, systemID, ttlMs) {
    if (!Number.isFinite(ttlMs) || ttlMs <= 0) return { success: true as const, data: [] };
    const atMs = now();
    const expired = listFragments(worldRevision, systemID).filter(row => !activeClaim(row, atMs) && atMs - row.createdAtMs >= ttlMs)
      .map(row => ({ ...row, status: "expired", expiredAtMs: atMs, claim: null }));
    if (!expired.length) return { success: true as const, data: [] };
    const result = commit(expired.map(row => proposal(fragmentKey(row.itemID), row)));
    return result.success ? { success: true as const, data: expired } : result;
  }
  function respawnAsteroid(identity, delayMs) {
    const key = asteroidKey(identity), state = read(key), atMs = now();
    if (!state || state.remainingQuantity !== 0 || !Number.isFinite(delayMs) || delayMs <= 0 || atMs - state.updatedAtMs < delayMs) return failure("ASTEROID_RESPAWN_NOT_DUE");
    const next = { ...state, remainingQuantity: state.originalQuantity, minedCells: [], cellDamage: {}, cellRemaining: {},
      lifetimeExtractedQuantity: (state.lifetimeExtractedQuantity || 0) + state.extractedQuantity,
      lifetimeWastedQuantity: (state.lifetimeWastedQuantity || 0) + state.wastedQuantity,
      extractedQuantity: 0, bonusQuantity: 0, wastedQuantity: 0, materialTotals: {},
      generation: (state.generation || 0) + 1, revision: state.revision + 1, updatedAtMs: atMs };
    const result = commit([proposal(key, next)]);
    return result.success ? { success: true as const, data: next } : result;
  }
  return { registerAsteroid, getAsteroid, commitExtraction, listFragments, getFragment,
    claimFragment, cancelClaim, updateFragmentPosition, completePickup, expireFragments, respawnAsteroid, runtimeIdentity };
}

let defaultStore;
function productionStore() {
  if (!defaultStore) {
    const { createTableRepository } = require("../../gameStore/tableRepository");
    const database = require("../../gameStore");
    const { reserveItemIDs } = require("../_shared/identityAllocator");
    defaultStore = createVoxelMiningStore({
      repo: createTableRepository("service:mining", { strict: true }),
      policy: () => require("../../config").voxelMiningPolicy || {},
      allocateIDs(count) {
        const ids = reserveItemIDs(count);
        // Fragment IDs do not live in items, so their allocator high-water mark
        // must survive restart before any fragment can become visible.
        if (database.flushTableSync("identityState").success !== true) throw new Error("IDENTITY_PERSISTENCE_ERROR");
        return ids;
      },
      grantAtomic: (request, rows) => require("../inventory/itemStore").grantStackableItemsWithAtomicRows(request, rows),
    });
  }
  return defaultStore;
}

module.exports = { TABLE, MAX_GRID_LENGTH, asteroidKey, createVoxelMiningStore };
for (const method of ["registerAsteroid", "getAsteroid", "commitExtraction", "listFragments", "getFragment",
  "claimFragment", "cancelClaim", "updateFragmentPosition", "completePickup", "expireFragments", "respawnAsteroid"]) {
  module.exports[method] = (...args) => productionStore()[method](...args);
}
