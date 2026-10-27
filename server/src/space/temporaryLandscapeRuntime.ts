"use strict";

const crypto = require("node:crypto");
const TABLE = "temporaryLandscapeState";
const clone = value => JSON.parse(JSON.stringify(value));
const fail = errorMsg => ({ success: false, errorMsg });
const hash = value => crypto.createHash("sha256").update(value).digest();
const positive = value => Number.isSafeInteger(value) && value > 0;
const EVENT_NAMES = new Set(["entry", "proximity", "time", "attacked", "entity-destroyed", "group-cleared", "mined", "resource-depleted", "event"]);

function identityKey(identity) {
  if (!identity || !/^[a-f0-9]{64}$/.test(identity.profileRevision || "") ||
      typeof identity.policyRevision !== "string" || !identity.policyRevision || identity.policyRevision.length > 128 ||
      !positive(identity.systemID) || !positive(identity.siteID)) throw new TypeError("Invalid temporary landscape identity");
  return `s:${hash(JSON.stringify([identity.profileRevision, identity.policyRevision, identity.systemID, identity.siteID])).toString("hex")}`;
}

function resourceEntityID(identity, key) {
  // Separate static-content band; native NPCs use their own journal allocator.
  return 2 ** 46 + hash(`${identityKey(identity)}:${key}`).readUIntBE(0, 6) % (2 ** 45);
}

function validatePolicy(policy) {
  if (!policy || typeof policy.revision !== "string" || !policy.revision || policy.revision.length > 128) throw new TypeError("Temporary landscape policy revision required");
  const entries = new Map<string, any>();
  for (const kind of ["resources", "npcs"]) {
    if (!Array.isArray(policy[kind]) || policy[kind].length > 2048) throw new TypeError("Invalid landscape allocation count");
    for (const spec of policy[kind]) {
      if (!spec || typeof spec.key !== "string" || !spec.key || spec.key.length > 512 || entries.has(spec.key) || !positive(spec.typeID) ||
          !spec.positionOffset || !["x", "y", "z"].every(axis => Number.isFinite(spec.positionOffset[axis]))) throw new TypeError("Invalid landscape allocation");
      if (kind === "resources" && (!positive(spec.miningYieldTypeID) || !positive(spec.resourceQuantity))) throw new TypeError("Invalid landscape resource stock");
      entries.set(spec.key, { ...spec, kind: kind === "npcs" ? "npc" : "resource" });
    }
  }
  if (!Array.isArray(policy.triggers) || policy.triggers.length > 2048) throw new TypeError("Invalid landscape triggers");
  const keys = new Set();
  for (const trigger of policy.triggers) {
    if (!trigger || typeof trigger.key !== "string" || !trigger.key || keys.has(trigger.key) || !EVENT_NAMES.has(trigger.event) ||
        !Array.isArray(trigger.targets) || !trigger.targets.every(key => entries.has(key)) ||
        !Array.isArray(trigger.sourceKeys || []) || !(trigger.sourceKeys || []).every(key => entries.has(key)) ||
        (trigger.chance != null && (!Number.isFinite(trigger.chance) || trigger.chance < 0 || trigger.chance > 1)) ||
        (trigger.delayMs != null && (!Number.isFinite(trigger.delayMs) || trigger.delayMs < 0)) ||
        (trigger.rangeMeters != null && (!Number.isFinite(trigger.rangeMeters) || trigger.rangeMeters <= 0))) throw new TypeError("Invalid landscape trigger");
    keys.add(trigger.key);
  }
  return entries;
}

function position(site, spec) {
  return Object.fromEntries(["x", "y", "z"].map(axis => [axis, Number(site.position?.[axis] || 0) + Number(spec.positionOffset?.[axis] || 0)]));
}
function distance2(left, right) { return ["x", "y", "z"].reduce((sum, axis) => sum + (Number(left?.[axis] || 0) - Number(right?.[axis] || 0)) ** 2, 0); }
function players(scene) { return [...(scene.dynamicEntities instanceof Map ? scene.dynamicEntities.values() : [])].filter(entity => entity && entity.session && entity.position); }
function stamp(entity, identity, key, generation = 0) {
  Object.assign(entity, { temporaryLandscapeRevision: identity.profileRevision, temporaryLandscapePolicyRevision: identity.policyRevision,
    landscapeSiteID: identity.siteID, landscapePolicyKey: key, landscapePolicyGeneration: generation });
  return entity;
}

/** Persistent one-shot decisions and spawn intents. Adapters make effects retryable. */
function createTemporaryLandscapeRuntime(options: Record<string, any> = {}) {
  const repo = options.repo || require("../gameStore/tableRepository").createTableRepository("in-space", { strict: true });
  const now = options.now || Date.now;
  const activeScenes = new WeakMap<any, Map<number, any>>();
  let ready = false;
  function read(identity) {
    if (!ready) { const result = repo.ensureTable(TABLE); if (result?.success === false) throw new Error("LANDSCAPE_STATE_UNAVAILABLE"); ready = true; }
    const result = repo.read(TABLE, `/${identityKey(identity)}`);
    return result?.success && result.data ? clone(result.data) : null;
  }
  function save(identity, state): any {
    try {
      const result = repo.commitAtomicRowWrites([repo.prepareAtomicRowWrite(TABLE, identityKey(identity), state)]);
      return result?.success ? { success: true } : fail(result?.errorMsg || "LANDSCAPE_STATE_WRITE_FAILED");
    } catch (error) { return fail("LANDSCAPE_STATE_WRITE_FAILED"); }
  }
  function stateFor(identity) {
    return read(identity) || { version: 1, identity, createdAtMs: now(), entries: {}, triggers: {} };
  }
  function attach(scene, site, policy, adapters: Record<string, any> = {}) {
    const specs = validatePolicy(policy);
    const identity = { profileRevision: site.temporaryLandscapeRevision, policyRevision: policy.revision, systemID: Number(scene.systemID), siteID: Number(site.itemID) };
    identityKey(identity);
    const ids = new Set();
    for (const spec of specs.values()) if (spec.kind === "resource") {
      const id = resourceEntityID(identity, spec.key);
      if (ids.has(id)) throw new Error("LANDSCAPE_ENTITY_ID_COLLISION"); ids.add(id);
    }
    let sites = activeScenes.get(scene);
    if (!sites) { sites = new Map(); activeScenes.set(scene, sites); }
    const context = { scene, site, policy, specs, identity, adapters };
    sites.set(identity.siteID, context);
    const state = stateFor(identity);
    const result = save(identity, state);
    if (!result.success) { sites.delete(identity.siteID); return result; }
    return advance(context, "entry", {});
  }
  function evaluate(context, trigger, state, event, details) {
    const sourceKeys = trigger.sourceKeys || [];
    if (trigger.event === "entry") return event === "entry" || Boolean(state.triggers[trigger.key]);
    if (trigger.event === "time") return now() >= state.createdAtMs + Number(trigger.delayMs || 0);
    if (trigger.event === "proximity") return players(context.scene).some(entity => distance2(entity.position, position(context.site, trigger)) <= Number(trigger.rangeMeters || 250000) ** 2);
    if (trigger.event === "group-cleared") return sourceKeys.length > 0 && sourceKeys.every(key => state.entries[key]?.phase === "destroyed");
    return trigger.event === event && (sourceKeys.length === 0 || sourceKeys.includes(details.key)) &&
      (trigger.event !== "event" || !trigger.eventKey || trigger.eventKey === details.eventKey);
  }
  function triggerDecisions(context, state, event, details) {
    let changed = false;
    for (const trigger of context.policy.triggers) {
      const receipt = state.triggers[trigger.key];
      if (receipt?.decidedAtMs != null) continue;
      if (!receipt && !evaluate(context, trigger, state, event, details)) continue;
      if (!receipt) {
        state.triggers[trigger.key] = { eligibleAtMs: now() + (trigger.event === "time" ? 0 : Number(trigger.delayMs || 0)) };
        changed = true;
      }
      if (now() < state.triggers[trigger.key].eligibleAtMs) continue;
      const chance = trigger.chance == null ? 1 : trigger.chance;
      const passed = hash(`${identityKey(context.identity)}:trigger:${trigger.key}`).readUInt32BE(0) / 0x100000000 < chance;
      state.triggers[trigger.key] = { ...state.triggers[trigger.key], decidedAtMs: now(), passed };
      if (passed) for (const key of trigger.targets) if (!state.entries[key]) {
        state.entries[key] = { phase: "pending", generation: 0, activatedAtMs: now() };
      }
      changed = true;
    }
    return changed;
  }
  function advance(context, event = "tick", details: Record<string, any> = {}) {
    let state = stateFor(context.identity), changed = false;
    for (const spec of context.specs.values()) {
      let entry = state.entries[spec.key];
      if (!entry && (!spec.activation || spec.activation === "entry" ||
          (spec.activation === "proximity" && players(context.scene).some(entity => distance2(entity.position, position(context.site, spec)) <= Number(spec.rangeMeters || 250000) ** 2)))) {
        state.entries[spec.key] = { phase: "pending", generation: 0, activatedAtMs: now() }; changed = true;
      } else if (entry?.phase === "destroyed" && entry.respawnAtMs != null && now() >= entry.respawnAtMs) {
        state.entries[spec.key] = { phase: "pending", generation: entry.generation + 1, activatedAtMs: now() }; changed = true;
      }
    }
    changed = triggerDecisions(context, state, event, details) || changed;
    if (changed) { const result = save(context.identity, state); if (!result.success) return result; }
    const spawned = [], failures = [];
    for (const spec of context.specs.values()) {
      let receipt = state.entries[spec.key];
      if (!receipt || receipt.phase === "destroyed") continue;
      if (spec.kind === "npc" && now() < receipt.activatedAtMs + Number(spec.guard?.entityDelaySpawn || 0) * 1000) continue;
      const existing = receipt.entityID && context.scene.getEntityByID?.(receipt.entityID);
      if (existing) {
        if (existing.temporaryLandscapeRevision !== context.identity.profileRevision || existing.temporaryLandscapePolicyRevision !== context.identity.policyRevision || existing.landscapePolicyKey !== spec.key) failures.push({ key: spec.key, errorMsg: "LANDSCAPE_ENTITY_ID_COLLISION" });
        continue;
      }
      const effect = spec.kind === "npc" ? context.adapters.spawnNpc || options.spawnNpc : context.adapters.spawnResource || options.spawnResource;
      if (typeof effect !== "function") { failures.push({ key: spec.key, errorMsg: "LANDSCAPE_ADAPTER_UNAVAILABLE" }); continue; }
      const identitySlot = `${identityKey(context.identity)}:${spec.key}:generation:${receipt.generation}`;
      const entityID = spec.kind === "resource" ? resourceEntityID(context.identity, spec.key) : receipt.entityID;
      const result = effect(context.scene, context.site, spec, { identity: context.identity, identitySlot, generation: receipt.generation, entityID,
        broadcast: context.adapters.broadcast === true, excludedSession: context.adapters.excludedSession || null });
      if (!result?.success) { failures.push({ key: spec.key, errorMsg: result?.errorMsg || "LANDSCAPE_SPAWN_FAILED" }); continue; }
      if (result.data?.destroyed || result.data?.depleted) {
        const marked = mark(context, spec.key, "destroyed");
        if (!marked.success) failures.push({ key: spec.key, errorMsg: marked.errorMsg });
        state = stateFor(context.identity); continue;
      }
      const entity = result.data?.entity;
      const actualID = Number(result.data?.entityID || entity?.itemID);
      if (!positive(actualID)) { failures.push({ key: spec.key, errorMsg: "LANDSCAPE_SPAWN_ID_INVALID" }); continue; }
      if (entity) stamp(entity, context.identity, spec.key, receipt.generation);
      state = stateFor(context.identity);
      state.entries[spec.key] = { ...state.entries[spec.key], phase: "active", entityID: actualID };
      const persisted = save(context.identity, state);
      if (!persisted.success) failures.push({ key: spec.key, errorMsg: persisted.errorMsg }); else spawned.push(actualID);
    }
    return { success: failures.length === 0, errorMsg: failures[0]?.errorMsg || null, data: { spawned, failures, identity: context.identity } };
  }
  function mark(context, key, phase): any {
    const state = stateFor(context.identity), entry = state.entries[key], spec = context.specs.get(key);
    if (!entry || !spec) return fail("LANDSCAPE_ENTRY_NOT_FOUND");
    if (entry.phase === phase) return { success: true };
    entry.phase = phase; entry.destroyedAtMs = now();
    if (spec.kind === "npc" && spec.guard?.entitySpawnOnce === 0) {
      const low = Number(spec.guard.entityMinRespawnDelay), high = Number(spec.guard.entityMaxRespawnDelay);
      if (Number.isFinite(low) && Number.isFinite(high) && low > 0 && high >= low) {
        const fraction = hash(`${identityKey(context.identity)}:${key}:respawn:${entry.generation}`).readUInt32BE(0) / 0x100000000;
        entry.respawnAtMs = now() + Math.round((low + (high - low) * fraction) * 1000);
      }
    }
    triggerDecisions(context, state, "entity-destroyed", { key });
    return save(context.identity, state);
  }
  function destroyed(scene, entity) {
    const context = activeScenes.get(scene)?.get(Number(entity?.landscapeSiteID));
    if (!context || entity?.temporaryLandscapeRevision !== context.identity.profileRevision || entity?.temporaryLandscapePolicyRevision !== context.identity.policyRevision) return { success: true, ignored: true };
    const entry = stateFor(context.identity).entries[entity.landscapePolicyKey];
    if (!entry || Number(entity.landscapePolicyGeneration || 0) !== entry.generation ||
        (entry.entityID && entry.entityID !== Number(entity.itemID || entity.entityID))) return { success: true, ignored: true };
    return mark(context, entity.landscapePolicyKey, "destroyed");
  }
  function prepareDestruction(scene, entity) {
    const context = activeScenes.get(scene)?.get(Number(entity?.landscapeSiteID));
    if (!context || entity?.temporaryLandscapeRevision !== context.identity.profileRevision || entity?.temporaryLandscapePolicyRevision !== context.identity.policyRevision) return { success: true };
    const previous = stateFor(context.identity), entry = previous.entries[entity.landscapePolicyKey];
    if (!entry || Number(entity.landscapePolicyGeneration || 0) !== entry.generation ||
        (entry.entityID && entry.entityID !== Number(entity.itemID || entity.entityID))) return { success: true, ignored: true };
    const result = mark(context, entity.landscapePolicyKey, "destroyed");
    return result.success ? { success: true, rollback: () => save(context.identity, previous) } : result;
  }
  function notify(scene, event, details: Record<string, any> = {}) {
    const entity = details.entity || {};
    const context = activeScenes.get(scene)?.get(Number(details.siteID || entity.landscapeSiteID));
    if (!context) return { success: true, ignored: true };
    const key = details.entryKey || entity.landscapePolicyKey;
    if (details.entity) {
      const entry = stateFor(context.identity).entries[key];
      if (entity.temporaryLandscapeRevision !== context.identity.profileRevision ||
          entity.temporaryLandscapePolicyRevision !== context.identity.policyRevision ||
          Number(entity.landscapeSiteID) !== context.identity.siteID || entity.landscapePolicyKey !== key ||
          !entry || entry.phase === "destroyed" || Number(entity.landscapePolicyGeneration || 0) !== entry.generation ||
          (entry.entityID && entry.entityID !== Number(entity.itemID || entity.entityID))) {
        return { success: true, ignored: true };
      }
    }
    const result = advance(context, event, { ...details, key });
    if (!result.success) return result;
    return ["resource-depleted", "entity-destroyed"].includes(event) && key ? mark(context, key, "destroyed") : result;
  }
  function tick(scene) {
    const results = [];
    for (const context of activeScenes.get(scene)?.values() || []) {
      const state = stateFor(context.identity);
      for (const spec of context.specs.values()) if (spec.kind === "resource") {
        const entry = state.entries[spec.key];
        if (!entry || entry.phase !== "active") continue;
        const readResource = context.adapters.readResource || options.readResource;
        const resource = readResource?.(scene, entry.entityID);
        if (!resource) continue;
        if (resource.remainingQuantity < resource.originalQuantity) {
          const result = advance(context, "mined", { key: spec.key }); if (!result.success) results.push(result);
        }
        if (resource.remainingQuantity <= 0) {
          const result = advance(context, "resource-depleted", { key: spec.key }); if (!result.success) results.push(result);
          const marked = mark(context, spec.key, "destroyed"); if (!marked.success) results.push(marked);
        }
      }
      results.push(advance(context));
    }
    return { success: results.every(result => result.success), data: results };
  }
  function event(scene, siteID, eventKey, details: Record<string, any> = {}) {
    const context = activeScenes.get(scene)?.get(Number(siteID));
    return context ? advance(context, "event", { ...details, eventKey }) : fail("LANDSCAPE_SITE_NOT_ACTIVE");
  }
  function detach(scene, siteID) {
    const sites = activeScenes.get(scene), context = sites?.get(Number(siteID));
    if (!context) return { success: true };
    const state = stateFor(context.identity), failures = [];
    for (const spec of context.specs.values()) {
      const entry = state.entries[spec.key], entity = entry?.entityID && scene.getEntityByID?.(entry.entityID);
      if (!entity) continue;
      const remove = spec.kind === "npc" ? context.adapters.removeNpc || options.removeNpc : context.adapters.removeResource || options.removeResource;
      const result = remove?.(scene, entity, { broadcast: context.adapters.broadcast });
      if (result?.success === false) failures.push(result);
    }
    if (failures.length === 0) sites.delete(Number(siteID));
    return { success: failures.length === 0, data: failures };
  }
  function isNpcActive(record) {
    try {
      const identity = { profileRevision: record.temporaryLandscapeRevision, policyRevision: record.temporaryLandscapePolicyRevision,
        systemID: Number(record.systemID), siteID: Number(record.landscapeSiteID) };
      const entry = read(identity)?.entries?.[record.landscapePolicyKey];
      return Boolean(entry && entry.phase !== "destroyed" && entry.generation === Number(record.landscapePolicyGeneration || 0) &&
        (!entry.entityID || entry.entityID === Number(record.entityID || record.itemID)));
    } catch (_) { return false; }
  }
  function moduleBlocked(scene, entity) {
    return [...(activeScenes.get(scene)?.values() || [])].some(context => context.policy.moduleBlocking === true &&
      distance2(entity.position, context.site.position) <= Number(context.policy.moduleBlockingRangeMeters || 250000) ** 2);
  }
  return { attach, tick, destroyed, prepareDestruction, notify, event, detach, isNpcActive, moduleBlocked, read, _advance: advance };
}

let singleton;
function runtime() { return singleton || (singleton = createTemporaryLandscapeRuntime()); }
module.exports = { TABLE, identityKey, resourceEntityID, validatePolicy, stamp, createTemporaryLandscapeRuntime,
  attach: (...args) => runtime().attach(...args), tickScene: scene => runtime().tick(scene),
  markDestroyed: (scene, entity) => runtime().destroyed(scene, entity), prepareDestruction: (scene, entity) => runtime().prepareDestruction(scene, entity),
  notifyTemporaryLandscapeEvent: (...args) => runtime().notify(...args), triggerEvent: (...args) => runtime().event(...args),
  detach: (...args) => runtime().detach(...args), isNpcRecordActive: record => {
    const profile = require("../services/frontier/temporaryLandscapeProfile").getTemporaryLandscapeProfile();
    const policy = require("../services/frontier/temporaryLandscapePolicyVersion").TEMPORARY_LANDSCAPE_POLICY_REVISION;
    return Boolean(profile && profile.revision === record.temporaryLandscapeRevision && policy === record.temporaryLandscapePolicyRevision && runtime().isNpcActive(record));
  },
  isModuleBlocked: (scene, entity) => runtime().moduleBlocked(scene, entity) };
