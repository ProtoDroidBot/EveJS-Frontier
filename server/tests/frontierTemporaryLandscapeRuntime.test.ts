"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { createTemporaryLandscapeRuntime, identityKey, resourceEntityID, validatePolicy } = require("../src/space/temporaryLandscapeRuntime");
const REVISION = "a".repeat(64);
const P = { x: 0, y: 0, z: 0 };
const resource = (key, extra = {}) => ({ key, typeID: 91379, miningYieldTypeID: 78447, resourceQuantity: 100, positionOffset: P, ...extra });
const npc = (key, extra = {}) => ({ key, typeID: 88001, positionOffset: P, activation: "trigger", ...extra });
const policy = (extra = {}) => ({ revision: "policy-v1", resources: [resource("ore")], npcs: [], triggers: [], ...extra });

function fixture() {
  const rows = new Map(), proposals = new WeakMap(), slots = new Map(), stocks = new Map();
  const scene: any = { systemID: 30000001, dynamicEntities: new Map(), staticEntitiesByID: new Map(),
    getEntityByID(id) { return this.dynamicEntities.get(id) || this.staticEntitiesByID.get(id); } };
  let clock = 1000, failAt = -1, commits = 0, nextID = 2000, effects = 0;
  const site = { itemID: 1001, position: P, temporaryLandscapeRevision: REVISION };
  const copy = value => value == null ? value : structuredClone(value);
  const repo = {
    ensureTable: () => ({ success: true }),
    read: (_table, suffix) => ({ success: true, data: copy(rows.get(suffix.slice(1))) }),
    prepareAtomicRowWrite(_table, key, value) {
      const token = {}; proposals.set(token, { key, value: copy(value), before: JSON.stringify(rows.get(key)) }); return token;
    },
    commitAtomicRowWrites(tokens) {
      commits++;
      if (commits === failAt) return { success: false, errorMsg: "WRITE_FAILED" };
      const writes = tokens.map(token => proposals.get(token));
      if (writes.some(write => write.before !== JSON.stringify(rows.get(write.key)))) return { success: false, errorMsg: "CONFLICT" };
      for (const write of writes) rows.set(write.key, copy(write.value));
      return { success: true };
    },
  };
  const adapters = {
    spawnResource(currentScene, _site, spec, options) {
      effects++;
      const state = stocks.get(options.entityID) || { originalQuantity: spec.resourceQuantity, remainingQuantity: spec.resourceQuantity };
      stocks.set(options.entityID, state);
      if (!state.remainingQuantity) return { success: true, data: { depleted: true } };
      const entity = { itemID: options.entityID, position: P };
      currentScene.staticEntitiesByID.set(entity.itemID, entity);
      return { success: true, data: { entity } };
    },
    spawnNpc(currentScene, _site, _spec, options) {
      effects++;
      const entity = slots.get(options.identitySlot) || { itemID: nextID++, position: P };
      slots.set(options.identitySlot, entity);
      currentScene.dynamicEntities.set(entity.itemID, entity);
      return { success: true, data: { entity } };
    },
    readResource: (_scene, entityID) => stocks.get(entityID),
    removeNpc: (currentScene, entity) => ({ success: currentScene.dynamicEntities.delete(entity.itemID) }),
    removeResource: (currentScene, entity) => ({ success: currentScene.staticEntitiesByID.delete(entity.itemID) }),
  };
  const makeRuntime = () => createTemporaryLandscapeRuntime({ repo, now: () => clock });
  const runtime = makeRuntime();
  const identity = { profileRevision: REVISION, policyRevision: "policy-v1", systemID: scene.systemID, siteID: site.itemID };
  const read = (id = identity) => copy(rows.get(identityKey(id)));
  return { runtime, makeRuntime, scene, site, identity, adapters, rows, slots, stocks, read,
    attach: p => runtime.attach(scene, site, p, adapters), setClock: n => { clock = n; },
    failNext: n => { failAt = commits + n; }, effects: () => effects };
}

test("entry allocations recover after detach and runtime restart with the same identities and stock", () => {
  const f = fixture(), p = policy({ npcs: [npc("guard", { activation: "entry" })] });
  assert.equal(f.attach(p).success, true);
  const first = f.read();
  const oreID = first.entries.ore.entityID, guardID = first.entries.guard.entityID;
  f.stocks.get(oreID).remainingQuantity = 61;
  assert.equal(f.attach(p).success, true);
  assert.equal(f.effects(), 2);
  assert.equal(f.runtime.detach(f.scene, f.site.itemID).success, true);
  assert.equal(f.makeRuntime().attach(f.scene, f.site, p, f.adapters).success, true);
  assert.equal(f.read().entries.ore.entityID, oreID);
  assert.equal(f.read().entries.guard.entityID, guardID);
  assert.equal(f.slots.size, 1);
  assert.equal(f.stocks.get(oreID).remainingQuantity, 61);
});

test("resource depletion and mined triggers are durable once-only decisions with no stock refill", () => {
  const f = fixture(), p = policy({ npcs: [npc("miner-response"), npc("empty-response")], triggers: [
    { key: "first-cut", event: "mined", sourceKeys: ["ore"], targets: ["miner-response"] },
    { key: "empty", event: "resource-depleted", sourceKeys: ["ore"], targets: ["empty-response"] },
  ] });
  f.attach(p);
  const id = f.read().entries.ore.entityID;
  f.stocks.get(id).remainingQuantity = 90;
  f.runtime.tick(f.scene);
  assert.equal(f.read().entries["miner-response"].phase, "active");
  assert.equal(f.read().entries["empty-response"], undefined);
  f.stocks.get(id).remainingQuantity = 0;
  f.scene.staticEntitiesByID.delete(id);
  f.runtime.tick(f.scene);
  assert.equal(f.read().entries.ore.phase, "destroyed");
  assert.equal(f.read().entries["empty-response"].phase, "active");
  f.runtime.tick(f.scene);
  f.runtime.detach(f.scene, f.site.itemID);
  f.makeRuntime().attach(f.scene, f.site, p, f.adapters);
  assert.equal(f.scene.staticEntitiesByID.has(id), false);
  assert.equal(f.slots.size, 2);
});

test("death receipts drive group-clear waves without treating virtualization as destruction", () => {
  const f = fixture(), p = policy({ resources: [], npcs: [npc("a", { activation: "entry" }), npc("b", { activation: "entry" }), npc("wave2")],
    triggers: [{ key: "clear", event: "group-cleared", sourceKeys: ["a", "b"], targets: ["wave2"] }] });
  f.attach(p);
  const a = f.scene.getEntityByID(f.read().entries.a.entityID), b = f.scene.getEntityByID(f.read().entries.b.entityID);
  const rollback = f.runtime.prepareDestruction(f.scene, a);
  assert.equal(rollback.success, true);
  rollback.rollback();
  assert.equal(f.read().entries.a.phase, "active", "failed combat destruction restores receipt");
  f.runtime.destroyed(f.scene, a); f.scene.dynamicEntities.delete(a.itemID);
  f.runtime.tick(f.scene);
  assert.equal(f.read().entries.wave2, undefined);
  f.runtime.destroyed(f.scene, b); f.scene.dynamicEntities.delete(b.itemID);
  f.runtime.tick(f.scene);
  assert.equal(f.read().entries.wave2.phase, "active");
  f.runtime.detach(f.scene, f.site.itemID);
  f.makeRuntime().attach(f.scene, f.site, p, f.adapters);
  assert.equal(f.scene.dynamicEntities.size, 1);
});

test("authored NPC respawn delay uses seconds and persists its next generation", () => {
  const f = fixture(), p = policy({ resources: [], npcs: [npc("guard", { activation: "entry", guard: { entitySpawnOnce: 0, entityMinRespawnDelay: 3600, entityMaxRespawnDelay: 3600 } })] });
  f.attach(p);
  const id = f.read().entries.guard.entityID;
  f.runtime.destroyed(f.scene, f.scene.getEntityByID(id)); f.scene.dynamicEntities.delete(id);
  assert.equal(f.read().entries.guard.respawnAtMs, 3601000);
  f.setClock(3600999); f.runtime.tick(f.scene); assert.equal(f.scene.dynamicEntities.size, 0);
  f.setClock(3601000); f.runtime.tick(f.scene);
  assert.equal(f.read().entries.guard.generation, 1);
  assert.notEqual(f.read().entries.guard.entityID, id);
  f.runtime.tick(f.scene); assert.equal(f.slots.size, 2);
});

test("failed intent commits cause no effects; crash after NPC spawn recovers its journal slot", () => {
  const f = fixture(), p = policy({ resources: [], npcs: [npc("guard", { activation: "entry" })] });
  f.failNext(2);
  assert.equal(f.attach(p).success, false);
  assert.equal(f.effects(), 0);
  f.failNext(3);
  assert.equal(f.attach(p).success, false);
  assert.equal(f.slots.size, 1);
  assert.equal(f.read().entries.guard.phase, "pending");
  f.scene.dynamicEntities.clear();
  assert.equal(f.makeRuntime().attach(f.scene, f.site, p, f.adapters).success, true);
  assert.equal(f.slots.size, 1);
  assert.equal(f.read().entries.guard.phase, "active");
});

test("proximity delays require a player and deterministic rejected chance survives restart", () => {
  const f = fixture(), p = policy({ resources: [], npcs: [npc("near"), npc("never")], triggers: [
    { key: "near", event: "proximity", rangeMeters: 100, delayMs: 500, targets: ["near"] },
    { key: "never", event: "entry", chance: 0, targets: ["never"] },
  ] });
  f.attach(p); f.runtime.tick(f.scene); assert.equal(f.slots.size, 0);
  f.scene.dynamicEntities.set(42, { itemID: 42, session: {}, position: { x: 50, y: 0, z: 0 } });
  f.runtime.tick(f.scene); assert.equal(f.read().triggers.near.eligibleAtMs, 1500);
  f.setClock(1499); f.runtime.tick(f.scene); assert.equal(f.slots.size, 0);
  f.setClock(1500); f.runtime.tick(f.scene); assert.equal(f.slots.size, 1);
  assert.equal(f.read().triggers.never.passed, false);
  f.makeRuntime().attach(f.scene, f.site, p, f.adapters);
  assert.equal(f.slots.size, 1);
});

test("profile and policy revisions isolate receipts and reject stale NPC generation restoration", () => {
  const f = fixture(), p = policy({ resources: [], npcs: [npc("guard", { activation: "entry" })] });
  f.attach(p);
  const receipt = f.read().entries.guard;
  const record = { temporaryLandscapeRevision: REVISION, temporaryLandscapePolicyRevision: p.revision,
    systemID: f.scene.systemID, landscapeSiteID: f.site.itemID, landscapePolicyKey: "guard", landscapePolicyGeneration: 0, entityID: receipt.entityID };
  assert.equal(f.runtime.isNpcActive(record), true);
  assert.equal(f.runtime.isNpcActive({ ...record, landscapePolicyGeneration: 1 }), false);
  assert.equal(f.runtime.isNpcActive({ ...record, temporaryLandscapePolicyRevision: "other" }), false);
  assert.notEqual(resourceEntityID(f.identity, "ore"), resourceEntityID({ ...f.identity, policyRevision: "other" }, "ore"));
  f.runtime.destroyed(f.scene, f.scene.getEntityByID(receipt.entityID));
  assert.equal(f.runtime.isNpcActive(record), false);
});

test("invalid stock and unresolved trigger references fail before runtime allocation", () => {
  assert.throws(() => validatePolicy(policy({ resources: [resource("bad", { resourceQuantity: -1 })] })), /stock/);
  assert.throws(() => validatePolicy(policy({ triggers: [{ key: "broken", event: "entry", targets: ["missing"] }] })), /trigger/);
  assert.throws(() => validatePolicy(policy({ resources: [resource("ore"), resource("ore")] })), /allocation/);
});


test("authored NPC spawn delay is persisted and honored across runtime recreation", () => {
  const f = fixture(), p = policy({ resources: [], npcs: [npc("delayed", { activation: "entry", guard: { entityDelaySpawn: 2 } })] });
  f.attach(p);
  assert.equal(f.effects(), 0);
  f.setClock(2999);
  const restored = f.makeRuntime();
  restored.attach(f.scene, f.site, p, f.adapters);
  assert.equal(f.effects(), 0);
  f.setClock(3000); restored.tick(f.scene);
  assert.equal(f.read().entries.delayed.phase, "active");
  assert.equal(f.effects(), 1);
});

test("stale entity scope and generations cannot fire current mining or attack triggers", () => {
  const f = fixture(), p = policy({ resources: [], npcs: [
    npc("guard", { activation: "entry", guard: { entitySpawnOnce: 0, entityMinRespawnDelay: 1, entityMaxRespawnDelay: 1 } }),
    npc("mined-response"), npc("attack-response"),
  ], triggers: [
    { key: "mined", event: "mined", sourceKeys: ["guard"], targets: ["mined-response"] },
    { key: "attacked", event: "attacked", sourceKeys: ["guard"], targets: ["attack-response"] },
  ] });
  f.attach(p);
  const old = { ...f.scene.getEntityByID(f.read().entries.guard.entityID) };
  f.runtime.destroyed(f.scene, old); f.scene.dynamicEntities.delete(old.itemID);
  f.setClock(2000); f.runtime.tick(f.scene);
  const current = f.scene.getEntityByID(f.read().entries.guard.entityID);
  assert.equal(current.landscapePolicyGeneration, 1);
  for (const event of ["mined", "attacked"]) {
    for (const entity of [old, { ...current, temporaryLandscapeRevision: "b".repeat(64) },
      { ...current, temporaryLandscapePolicyRevision: "old-policy" }, { ...current, itemID: old.itemID }]) {
      assert.equal(f.runtime.notify(f.scene, event, { entity }).ignored, true);
    }
  }
  assert.deepEqual(f.read().triggers, {});
  assert.equal(f.read().entries["mined-response"], undefined);
  assert.equal(f.read().entries["attack-response"], undefined);
  assert.equal(f.runtime.notify(f.scene, "attacked", { entity: current }).success, true);
  assert.equal(f.read().entries["attack-response"].phase, "active");
  assert.equal(f.runtime.notify(f.scene, "mined", { siteID: f.site.itemID, entryKey: "guard" }).success, true,
    "explicit trusted server events without an entity retain their API");
  assert.equal(f.read().entries["mined-response"].phase, "active");
});
