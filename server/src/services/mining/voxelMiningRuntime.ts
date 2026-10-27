"use strict";

const { randomUUID } = require("node:crypto");
const geometry = require("./compositeAsteroidModel");
const { canEntitiesInteractLocally, buildChildEntityScopeMetadata } = require("../../space/destiny/identity/interactionScope");

// Durations returned by shipAccess are relative simulation times in 100ns ticks.
const SCOOP_CHANNEL_MS = 1500;
const SCOOP_STOP_RANGE = 800;
const SCOOP_PULL_SPEED = 1000;
const { WORLD_REVISION, getVoxelMiningWorldRevision } = require("./voxelMiningWorld");
const failure = errorMsg => ({ success: false as const, errorMsg });
const vector = value => ({ x: Number(value?.x) || 0, y: Number(value?.y) || 0, z: Number(value?.z) || 0 });
const subtract = (a, b) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const add = (a, b) => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
const scale = (v, n) => ({ x: v.x * n, y: v.y * n, z: v.z * n });
const magnitude = v => Math.hypot(v.x, v.y, v.z);
const unit = v => scale(v, 1 / (magnitude(v) || 1));
const surfaceDistance = (a, b) => Math.max(0, magnitude(subtract(vector(a.position), vector(b.position))) - (a.radius || 0) - (b.radius || 0));
const safeID = id => Number.isSafeInteger(Number(id)) && Number(id) > 0;

/** Composite entities use a fixed orientation; apply quaternion transforms for authored rotations. */
function rotate(v, quaternion, inverse = false) {
  if (!quaternion) return { ...v };
  const q = Array.isArray(quaternion)
    ? { x: quaternion[0], y: quaternion[1], z: quaternion[2], w: quaternion[3] }
    : quaternion;
  const norm = Math.hypot(q.x, q.y, q.z, q.w);
  if (!Number.isFinite(norm) || norm === 0) return { ...v };
  const sign = inverse ? -1 : 1;
  const x = q.x / norm * sign, y = q.y / norm * sign, z = q.z / norm * sign, w = q.w / norm;
  const tx = 2 * (y * v.z - z * v.y), ty = 2 * (z * v.x - x * v.z), tz = 2 * (x * v.y - y * v.x);
  return { x: v.x + w * tx + y * tz - z * ty, y: v.y + w * ty + z * tx - x * tz, z: v.z + w * tz + x * ty - y * tx };
}

function createVoxelMiningRuntime(deps: Record<string, any>) {
  const store = deps.store;
  const presentation = deps.sceneAdapter;
  const modelAPI = deps.geometry || geometry;
  const enabled = deps.enabled || (() => true);
  const worldRevision = deps.worldRevision || (() => WORLD_REVISION);
  const wallNow = deps.now || Date.now;
  const canInteract = deps.canInteract || canEntitiesInteractLocally;
  const claims = new Map<number, any>();
  const sceneState = new WeakMap<object, any>();
  function identity(scene, entity) {
    return { worldRevision: worldRevision(), systemID: Number(scene.systemID), asteroidID: Number(entity.itemID) };
  }
  function localState(scene) {
    let state = sceneState.get(scene);
    if (!state) { state = { asteroids: new Map(), restored: false, reconcileAtMs: 0, pendingRemovals: new Set() }; sceneState.set(scene, state); }
    return state;
  }
  function simTime(scene) { return Number(scene.getCurrentSimTimeMs?.() ?? wallNow()); }
  function notify(scene, entity, event, args) {
    for (const session of scene.sessions?.values?.() || []) {
      const ship = scene.getShipEntityForSession?.(session);
      if (!ship || !canInteract(ship, entity)) continue;
      if (scene.canSessionSeeStaticEntityForSession && !scene.dynamicEntities?.has(entity.itemID) &&
          !scene.canSessionSeeStaticEntityForSession(session, entity)) continue;
      if (scene.canSessionSeeDynamicEntity && scene.dynamicEntities?.has(entity.itemID) &&
          !scene.canSessionSeeDynamicEntity(session, entity, simTime(scene))) continue;
      try { session.sendNotification?.(event, "charid", args); } catch (error) { deps.onError?.(error); }
    }
  }
  function removeDepleted(scene, entity, nowMs) {
    scene.clearAllTargetingForEntity?.(entity, { reason: "Exploding", nowMs });
    const remove = scene.dynamicEntities?.has(entity.itemID) ? scene.removeDynamicEntity : scene.removeStaticEntity;
    remove?.call(scene, entity.itemID, { broadcast: true, nowMs });
  }
  function hydrate(entry, state) {
    entry.persisted = state;
    if (state) entry.mineable.remainingQuantity = state.remainingQuantity;
  }
  function minedCells(entry) {
    const cells = new Set<number>(entry.persisted?.minedCells || []);
    const total = entry.persisted?.originalQuantity ?? entry.baselineQuantity;
    // Small/depleted legacy baselines may have fewer ore units than cells.
    // Client replay must omit the same empty cells that authoritative rays skip.
    if (total < entry.model.grid.length) {
      for (let i = total; i < entry.model.grid.length; i++) cells.add(i);
    }
    return cells;
  }
  function prepareEntity(scene, entity, mineable) {
    if (!enabled() || !scene || !entity || entity.kind === "regolith" || !mineable || mineable.yieldKind !== "ore") return null;
    const cache = localState(scene).asteroids;
    const cached = cache.get(entity.itemID);
    if (cached && cached.entity === entity) { cached.mineable = mineable; hydrate(cached, cached.persisted); return cached; }
    const mapping = presentation.resolveCompositePresentation(entity, mineable, deps.policy?.() || {});
    if (!mapping) return null;
    const previous = store.getAsteroid(identity(scene, entity));
    const model = modelAPI.createCompositeModel({
      itemID: Number(entity.itemID), typeID: mapping.typeID,
      yieldTypeID: Number(mineable.yieldTypeID), material: mapping.material,
      radius: Number(mineable.originalRadius || entity.radius),
      ...(previous ? { templateIndex: previous.model.templateIndex } : {}),
    });
    if (previous && previous.model.recipeHash !== model.recipeHash) throw new Error("ASTEROID_RECIPE_MISMATCH");
    const entry = { entity, model, mapping, mineable, baselineQuantity: previous?.originalQuantity ?? mineable.remainingQuantity, persisted: null };
    hydrate(entry, previous);
    presentation.applyCompositePresentation(entity, model, mapping);
    presentation.applyCompositeMinedState?.(entity, model, minedCells(entry));
    cache.set(entity.itemID, entry);
    if (mineable.remainingQuantity === 0) removeDepleted(scene, entity, simTime(scene));
    return entry;
  }
  function getEntry(scene, entity, mineable = null) {
    const cached = localState(scene).asteroids.get(entity.itemID);
    return cached?.entity === entity ? cached : (mineable ? prepareEntity(scene, entity, mineable) : null);
  }
  function isComposite(scene, entity, mineable = null) {
    return enabled() && Boolean(entity && getEntry(scene, entity, mineable));
  }
  function ensureDurable(scene, entry) {
    if (entry.persisted) return { success: true, data: entry.persisted };
    const result = store.registerAsteroid({ ...identity(scene, entry.entity), model: entry.model,
      originalQuantity: entry.baselineQuantity, unitVolume: entry.mineable.unitVolume });
    if (result.success) hydrate(entry, result.data);
    return result;
  }
  function cellQuantity(state, index) {
    return state.cellRemaining[String(index)] ??
      (Math.floor(state.originalQuantity / state.model.gridLength) + (index < state.originalQuantity % state.model.gridLength ? 1 : 0));
  }
  function mine(scene, source, target, mineable, quantities, options: Record<string, any> = {}) {
    const entry = enabled() && getEntry(scene, target, mineable);
    if (!entry || !canInteract(source, target)) return failure("INVALID_MINING_TARGET");
    const registered = ensureDurable(scene, entry);
    if (!registered.success) return registered;
    // Re-read after every commit: two miners cannot spend the same cell revision.
    const state = store.getAsteroid(identity(scene, target));
    const skipped = new Set<number>(state.minedCells);
    for (let i = 0; i < entry.model.grid.length; i++) if (cellQuantity(state, i) <= 0) skipped.add(i);
    const orientation = target.orientation || target.rotationQuaternion;
    const origin = rotate(subtract(vector(options.rayOrigin || source.position), vector(target.position)), orientation, true);
    // A held beam has a finite swept radius. Its centerline can miss a voxel
    // while its authoritative contact lies on that voxel's surface.
    const direction = (options.contactPoint && subtract(vector(options.contactPoint), vector(options.rayOrigin || source.position))) || options.rayDirection;
    let cell = direction
      ? modelAPI.raycastCompositeVoxel(entry.model, skipped, origin, rotate(vector(direction), orientation, true))
      : modelAPI.selectNearestCompositeVoxel(entry.model, skipped, origin);
    if (!cell && options.contactPoint) {
      const contact = rotate(subtract(vector(options.contactPoint), vector(target.position)), orientation, true);
      const nearest = modelAPI.selectNearestCompositeVoxel(entry.model, skipped, contact);
      if (nearest && nearest.distance <= Math.max(1e-6, entry.model.spacing * 1e-8)) {
        cell = { ...nearest, distance: magnitude(subtract(contact, origin)) };
      }
    }
    if (!cell || (Number.isFinite(options.maxRangeMeters) && cell.distance > options.maxRangeMeters + (source.radius || 0) + 1)) return failure("NO_VOXEL_HIT");
    const substrate = entry.mapping.substrate;
    const minerTier = Number((deps.policy?.() || {}).minerTierByTypeID?.[options.moduleTypeID] || 0);
    if (substrate && minerTier < substrate.gateTier) return failure("MINER_TIER_INSUFFICIENT");
    const remaining = cellQuantity(state, cell.index);
    const normal = Math.min(remaining, Math.max(0, Math.trunc((quantities.normalQuantity || 0) / (substrate?.toughness || 1))));
    const wasted = Math.min(remaining - normal, Math.max(0, Math.trunc(quantities.wastedQuantity || 0)));
    const bonus = Math.max(0, Math.floor((quantities.criticalHitQuantity || 0) * (normal / (quantities.normalQuantity || 1))));
    const extracted = normal + bonus;
    if (normal + wasted <= 0) return failure("NO_MINING_YIELD");
    const remainingCell = remaining - normal - wasted;
    const removed = remainingCell === 0 ? [cell.index] : [];
    // Spawn outside the struck cell on the miner-facing side; no inventory credit occurs here.
    const localPoint = add(cell.position, scale(unit(subtract(origin, cell.position)), entry.model.spacing * 0.65));
    const position = add(vector(target.position), rotate(localPoint, orientation));
    const result = store.commitExtraction({ ...identity(scene, target), expectedRevision: state.revision,
      minedCells: removed, cellRemainingUpdates: { [cell.index]: remainingCell },
      extractedQuantity: extracted, bonusQuantity: bonus, wasteQuantity: wasted,
      fragments: extracted > 0 ? [{ typeID: entry.mapping.fragmentTypeID, yieldTypeID: mineable.yieldTypeID,
        quantity: extracted, position, sourceCellIndices: [cell.index], scopeMetadata: buildChildEntityScopeMetadata(target) }] : [],
    });
    if (!result.success) return result;
    hydrate(entry, result.data.asteroid);
    if (extracted > 0) {
      try { deps.recordExtraction?.(source, { eventID: `voxel:${worldRevision()}:${scene.systemID}:${target.itemID}:${result.data.asteroid.revision}`, eventKind: "extraction", amount: extracted }); }
      catch (error) { deps.onError?.(error); }
    }
    presentation.applyCompositeMinedState?.(target, entry.model, minedCells(entry));
    for (const fragment of result.data.fragments) {
      try { presentation.spawnRegolith(scene, fragment, { broadcast: true }); } catch (error) { deps.onError?.(error); }
    }
    for (const index of removed) notify(scene, target, "OnCompositeVoxelMined", [target.itemID, index]);
    if (removed.length && mineable.remainingQuantity > 0) {
      // Existing scene replacement authority removes the old native ball before
      // reacquiring one with the current collision tail and persisted mined set.
      try { presentation.refreshCompositeCollision?.(scene, target, options.nowMs ?? simTime(scene)); } catch (error) { deps.onError?.(error); }
    }
    if (mineable.remainingQuantity === 0) removeDepleted(scene, target, options.nowMs ?? simTime(scene));
    return { success: true, data: { ...result.data, normalQuantity: normal, wastedQuantity: wasted,
      criticalHitQuantity: bonus, extractedQuantity: extracted, depleted: mineable.remainingQuantity === 0, voxelIndex: cell.index } };
  }
  function sessionContext(session) {
    const context = deps.resolveSession(session);
    if (!context || !safeID(session?._space?.shipID) || !safeID(session?.characterID ?? session?.charid)) return null;
    const { scene, ship } = context;
    if (!scene || !ship || Number(ship.itemID) !== Number(session._space.shipID) ||
        Number(scene.systemID) !== Number(session._space.systemID) || ship.session !== session) return null;
    return { scene, ship, characterID: Number(session.characterID ?? session.charid), shipID: Number(ship.itemID) };
  }
  function canScoop(context, entity) {
    const { scene, ship } = context;
    return Boolean(entity && entity.kind === "regolith" && canInteract(ship, entity) &&
      !ship.warpState && !ship.pendingWarp && !ship.cloaked && !ship.isCloaked &&
      !(Number(ship.cloakMode) > 0) && !ship.stargateJumpCloak && !ship.pendingDock &&
      !(Number(ship.frontierBerthingHostAssemblyID) > 0) && !(Number(ship.frontierDockingPointID) > 0) &&
      !ship.isWarping && ship.mode !== "WARP" && ship.mode !== "warp" &&
      (!scene.canSessionSeeDynamicEntity || scene.canSessionSeeDynamicEntity(ship.session, entity, simTime(scene))));
  }
  function maxRange() { return Number(deps.maxScoopRange?.() ?? 2500); }
  function cancelClaim(claim) {
    claim.cancelRequested = true;
    const entity = claim.scene.getEntityByID(claim.itemID);
    if (entity) {
      store.updateFragmentPosition(claim.itemID, entity.position, { claimToken: claim.token });
      presentation.moveRegolith(claim.scene, entity, vector(entity.position), { x: 0, y: 0, z: 0 }, { nowMs: simTime(claim.scene) });
    }
    const result = store.cancelClaim(claim.itemID, claim.token);
    // A transient storage failure must not strand the persistent lease. Keep
    // its token until cancellation commits so the next tick can retry it.
    if (result.success || result.errorMsg === "FRAGMENT_CLAIM_MISMATCH") claims.delete(claim.shipID);
    else deps.onError?.(new Error(result.errorMsg || "SCOOP_CANCEL_FAILED"));
    return result;
  }
  function beginScoop(session, itemID) {
    if (!enabled()) return failure("VOXEL_MINING_DISABLED");
    const context = sessionContext(session);
    if (!context || !safeID(itemID)) return failure("INVALID_SCOOP_SESSION");
    const { scene, ship, characterID, shipID } = context;
    const entity = scene.getEntityByID(Number(itemID));
    if (!canScoop(context, entity)) return failure("INVALID_SCOOP_TARGET");
    if (surfaceDistance(ship, entity) > maxRange()) return failure("TARGET_TOO_FAR");
    const fragment = store.getFragment(Number(itemID));
    if (!fragment || !["available", "claimed"].includes(fragment.status) || fragment.worldRevision !== worldRevision() || fragment.systemID !== Number(scene.systemID)) return failure("FRAGMENT_NOT_AVAILABLE");
    const existing = claims.get(shipID);
    const time = simTime(scene);
    if (existing?.itemID === Number(itemID) && existing.session === session && !existing.cancelRequested) {
      return { success: true, data: { durations: [Math.round(Math.max(0, existing.pullDeadline - time) * 10000), Math.round(Math.max(1, existing.holdUntil ? existing.holdUntil - time : SCOOP_CHANNEL_MS) * 10000)] } };
    }
    if (existing && !cancelClaim(existing).success) return failure("SCOOP_CANCEL_PENDING");
    const destination = deps.selectDestination(ship, fragment);
    if (!destination || destination.availableVolume + 1e-8 < fragment.quantity * fragment.unitVolume) return failure("NOT_ENOUGH_CARGO_SPACE");
    const token = randomUUID();
    const claimWallTime = wallNow();
    const claimed = store.claimFragment(Number(itemID), { worldRevision: worldRevision(), systemID: scene.systemID,
      characterID, shipID, claimToken: token, nowMs: claimWallTime, expiresAtMs: claimWallTime + 300000 });
    if (!claimed.success) return claimed;
    const pullMs = Math.max(0, surfaceDistance(ship, entity) - SCOOP_STOP_RANGE) / SCOOP_PULL_SPEED * 1000;
    claims.set(shipID, { scene, ship, session, characterID, shipID, itemID: Number(itemID), token,
      lastTick: time, lastCheckpoint: time, pullDeadline: time + pullMs,
      holdUntil: pullMs === 0 ? time + SCOOP_CHANNEL_MS : null,
      expiresAtWallMs: claimWallTime + 300000 });
    return { success: true, data: { durations: [Math.round(pullMs * 10000), SCOOP_CHANNEL_MS * 10000] } };
  }
  function cancelScoop(session, itemID) {
    const claim = claims.get(Number(session?._space?.shipID));
    if (!claim || claim.session !== session || claim.itemID !== Number(itemID)) return { success: true };
    return cancelClaim(claim);
  }
  function handleSessionDetached(session) {
    const claim = claims.get(Number(session?._space?.shipID));
    if (claim?.session === session) cancelClaim(claim);
  }
  function restoreScene(scene) {
    if (!enabled()) return;
    presentation.restoreRegolith(scene, store.listFragments(worldRevision(), scene.systemID), { broadcast: false });
    localState(scene).restored = true;
  }
  function tickScene(scene, nowMs = simTime(scene)) {
    if (!enabled()) return;
    const local = localState(scene);
    if (!local.restored) restoreScene(scene);
    // Repair committed fragments whose original AddBalls delivery failed.
    if (nowMs >= local.reconcileAtMs) {
      const policy = deps.policy?.() || {};
      const expired = store.expireFragments?.(worldRevision(), scene.systemID, Number(policy.fragmentExpiryMs || 0));
      if (expired?.success) for (const fragment of expired.data) local.pendingRemovals.add(fragment.itemID);
      if (Number(policy.respawnDelayMs) > 0) for (const entry of local.asteroids.values()) {
        // Temporary landscape stock is governed by its durable site receipt.
        // A global mining policy must not replenish a completed allocation.
        if (entry.entity.temporaryLandscapePolicyRevision) continue;
        if (entry.persisted?.remainingQuantity !== 0) continue;
        const respawned = store.respawnAsteroid?.(identity(scene, entry.entity), Number(policy.respawnDelayMs));
        if (!respawned?.success) continue;
        hydrate(entry, respawned.data);
        presentation.applyCompositeMinedState?.(entry.entity, entry.model, minedCells(entry));
        presentation.restoreCompositeAsteroid?.(scene, entry.entity);
        notify(scene, entry.entity, "OnCompositeMinedSetChanged", [entry.entity.itemID]);
      }
      for (const entry of local.asteroids.values()) {
        // Keep virtualization/rematerialization under the same site authority,
        // including a record that already has a nonzero mining generation.
        if (entry.entity.temporaryLandscapePolicyRevision) continue;
        if (entry.persisted?.generation > 0 && entry.persisted.remainingQuantity > 0 && !scene.getEntityByID(entry.entity.itemID)) {
          try { presentation.restoreCompositeAsteroid?.(scene, entry.entity); } catch (error) { deps.onError?.(error); }
        }
      }
      for (const itemID of local.pendingRemovals) {
        try { presentation.removeRegolith(scene, itemID, { nowMs }); } catch (error) { deps.onError?.(error); }
        if (!scene.getEntityByID(itemID)) local.pendingRemovals.delete(itemID);
      }
      for (const fragment of store.listFragments(worldRevision(), scene.systemID)) {
        if (!scene.getEntityByID(fragment.itemID)) presentation.spawnRegolith(scene, fragment, { broadcast: true });
      }
      local.reconcileAtMs = nowMs + 1000;
    }
    for (const claim of [...claims.values()]) {
      if (claim.scene !== scene) continue;
      if (claim.cancelRequested) { cancelClaim(claim); continue; }
      const context = sessionContext(claim.session);
      const entity = scene.getEntityByID(claim.itemID);
      if (!context || context.scene !== scene || context.ship !== claim.ship || !canScoop(context, entity) ||
          surfaceDistance(claim.ship, entity) > maxRange() || wallNow() >= claim.expiresAtWallMs) {
        cancelClaim(claim); continue;
      }
      const delta = Math.max(0, nowMs - claim.lastTick) / 1000;
      claim.lastTick = nowMs;
      const distance = surfaceDistance(claim.ship, entity);
      if (distance > SCOOP_STOP_RANGE + 1e-6) {
        claim.holdUntil = null;
        const direction = unit(subtract(vector(claim.ship.position), vector(entity.position)));
        const travel = Math.min(distance - SCOOP_STOP_RANGE, SCOOP_PULL_SPEED * delta);
        const position = add(vector(entity.position), scale(direction, travel));
        presentation.moveRegolith(scene, entity, position, travel < distance - SCOOP_STOP_RANGE ? scale(direction, SCOOP_PULL_SPEED) : { x: 0, y: 0, z: 0 }, { nowMs });
        if (travel >= distance - SCOOP_STOP_RANGE) claim.holdUntil = nowMs + SCOOP_CHANNEL_MS;
      } else if (!claim.holdUntil) claim.holdUntil = nowMs + SCOOP_CHANNEL_MS;
      if (nowMs - claim.lastCheckpoint >= 1000) {
        const checkpoint = store.updateFragmentPosition(claim.itemID, entity.position, { claimToken: claim.token });
        if (!checkpoint.success) { cancelClaim(claim); continue; }
        claim.lastCheckpoint = nowMs;
      }
      if (claim.holdUntil && nowMs >= claim.holdUntil) {
        const fragment = store.getFragment(claim.itemID);
        const destination = deps.selectDestination(claim.ship, fragment);
        const result = destination && store.completePickup(claim.itemID, { claimToken: claim.token,
          characterID: claim.characterID, shipID: claim.shipID, flagID: destination.flagID, nowMs: wallNow(),
          getDestinationCapacity: () => deps.destinationCapacity(claim.ship, destination.flagID) });
        if (!result?.success) { cancelClaim(claim); deps.onPickupFailure?.(claim.session, result?.errorMsg || "NOT_ENOUGH_CARGO_SPACE"); continue; }
        claims.delete(claim.shipID);
        // Durable consume and inventory grant have committed together before any visual/notification side effect.
        local.pendingRemovals.add(claim.itemID);
        try { presentation.removeRegolith(scene, claim.itemID, { nowMs }); } catch (error) { deps.onError?.(error); }
        if (!scene.getEntityByID(claim.itemID)) local.pendingRemovals.delete(claim.itemID);
        try { deps.notifyInventory?.(claim.session, claim.shipID, result.data.changes); } catch (error) { deps.onError?.(error); }
      }
    }
  }
  function authorizedEntry(session, itemID) {
    if (!enabled() || !safeID(itemID)) return null;
    const context = sessionContext(session);
    const entity = context?.scene.getEntityByID(Number(itemID));
    if (!entity || !canInteract(context.ship, entity)) return null;
    if (context.scene.dynamicEntities?.has(entity.itemID)) {
      if (context.scene.canSessionSeeDynamicEntity && !context.scene.canSessionSeeDynamicEntity(session, entity, simTime(context.scene))) return null;
    } else if (context.scene.canSessionSeeStaticEntityForSession && !context.scene.canSessionSeeStaticEntityForSession(session, entity)) return null;
    return getEntry(context.scene, entity);
  }
  function getCompositeRecipeForSession(session, itemID) { return authorizedEntry(session, itemID)?.model.recipe || null; }
  function getCompositeMinedSetForSession(session, itemID) {
    const entry = authorizedEntry(session, itemID);
    return entry ? modelAPI.encodeMinedSet(entry.model.grid.length, minedCells(entry)) : null;
  }
  return { prepareEntity, isComposite, mine, beginScoop, cancelScoop, handleSessionDetached, restoreScene, tickScene,
    getCompositeRecipeForSession, getCompositeMinedSetForSession };
}

let defaultRuntime;
function productionRuntime() {
  if (!defaultRuntime) {
    const config = require("../../config");
    const mining = () => require("./miningRuntime");
    const log = require("../../utils/logger");
    defaultRuntime = createVoxelMiningRuntime({
      store: require("./voxelMiningStore"), sceneAdapter: require("../../space/compositeMiningScene"),
      enabled: () => config.miningEnabled === true && config.voxelMiningEnabled === true && Number(config.clientBuild) === 3640684,
      worldRevision: () => getVoxelMiningWorldRevision(config),
      maxScoopRange: () => config.voxelScoopRangeMeters || 2500,
      policy: () => config.voxelMiningPolicy || {},
      recordExtraction(source, event) {
        const session = source.session || require("../chat/sessionRegistry").findSessionByCharacterID(Number(source.ownerID || source.characterID));
        if (session) require("../frontier/progressionRuntime").recordActivity(session, event);
      },
      resolveSession(session) {
        const scene = require("../../space/runtime").getSceneForSession(session);
        return scene ? { scene, ship: scene.getShipEntityForSession(session) } : null;
      },
      selectDestination: (ship, fragment) => mining().resolveVoxelPickupDestination(ship, fragment),
      destinationCapacity: (ship, flagID) => mining().getVoxelPickupCapacity(ship, flagID),
      notifyInventory: (session, shipID, changes) => mining().syncMinedOreChangesToSession(session, shipID, changes),
      onError: error => log.warn(`[VoxelMining] ${error.message}`),
      onPickupFailure: (session, reason) => log.debug(`[VoxelMining] Pickup refused char=${session?.characterID}: ${reason}`),
    });
  }
  return defaultRuntime;
}

module.exports = { createVoxelMiningRuntime, rotate, SCOOP_CHANNEL_MS, SCOOP_STOP_RANGE, SCOOP_PULL_SPEED, WORLD_REVISION };
for (const method of ["prepareEntity", "isComposite", "mine", "beginScoop", "cancelScoop", "handleSessionDetached",
  "restoreScene", "tickScene", "getCompositeRecipeForSession", "getCompositeMinedSetForSession"]) {
  module.exports[method] = (...args) => productionRuntime()[method](...args);
}
