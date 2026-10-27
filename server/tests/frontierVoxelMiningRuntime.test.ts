"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createVoxelMiningRuntime, SCOOP_CHANNEL_MS, SCOOP_STOP_RANGE, SCOOP_PULL_SPEED } = require("../src/services/mining/voxelMiningRuntime");
const { createVoxelMiningStore, TABLE } = require("../src/services/mining/voxelMiningStore");
const geometry = require("../src/services/mining/compositeAsteroidModel");
const sceneAdapter = require("../src/space/compositeMiningScene");

const WORLD = "runtime-test-3640684";
const SYSTEM = 30000001;
const ASTEROID = 1234;
const GRID_LENGTH = geometry.createCompositeModel({ itemID: ASTEROID, typeID: 95899,
  yieldTypeID: 77800, material: "feldspar", radius: 350 }).grid.length;

/** A transactional memory repository; geometry, mining store and scene adapters are real. */
function fixture(options: Record<string, any> = {}) {
  const tables: any = { [TABLE]: {}, items: {} };
  const tokens = new WeakMap();
  let clock = 10000, nextID = 2000000000, capacity = 100000, failCommit = false;
  let enabled = true;
  const readClock = () => options.incrementClockReads ? clock++ : clock;
  const inventoryNotifications = [], errors = [], pickupFailures = [], movements = [], spawns = [];
  const clone = value => value === undefined ? undefined : structuredClone(value);
  const repo = {
    ensureTable() { return { success: true }; },
    read(table, key) { return { success: true, data: clone(key === "/" ? tables[table] : tables[table][key.slice(1)]) }; },
    prepareAtomicRowWrite(table, key, value) {
      const token = {};
      tokens.set(token, { table, key, value: clone(value), expected: JSON.stringify(tables[table][key]) });
      return token;
    },
    commitAtomicRowWrites(proposals) {
      const rows = proposals.map(token => { const row = tokens.get(token); tokens.delete(token); return row; });
      if (failCommit) return { success: false, errorMsg: "INJECTED_COMMIT_FAILURE" };
      if (rows.some(row => !row || JSON.stringify(tables[row.table][row.key]) !== row.expected)) return { success: false, errorMsg: "ATOMIC_WRITE_CONFLICT" };
      for (const row of rows) tables[row.table][row.key] = clone(row.value);
      return { success: true };
    },
  };
  function makeStore(runtimeIdentity) {
    return createVoxelMiningStore({ repo, runtimeIdentity, now: readClock,
      allocateIDs: count => Array.from({ length: count }, () => nextID++),
      grantAtomic(request, rows) {
        const entry = request.entries[0];
        const key = String(request.shipID);
        const before = tables.items[key] || { quantity: 0 };
        if (before.quantity + entry.quantity > request.getDestinationCapacity()) return { success: false, errorMsg: "NOT_ENOUGH_CARGO_SPACE" };
        const after = { quantity: before.quantity + entry.quantity, typeID: entry.itemType, flagID: request.flagID };
        const result = repo.commitAtomicRowWrites([...rows, repo.prepareAtomicRowWrite("items", key, after)]);
        return result.success ? { success: true, data: { changes: [{ item: after }] } } : result;
      },
    });
  }
  function makeScene() {
    const scene: any = {
      systemID: SYSTEM, dynamicEntities: new Map(), staticEntities: new Map(), sessions: new Map(),
      getCurrentSimTimeMs: () => clock,
      getEntityByID(id) { return this.dynamicEntities.get(Number(id)) || this.staticEntities.get(Number(id)) || null; },
      getShipEntityForSession(session) { return this.dynamicEntities.get(session?._space?.shipID) || null; },
      canSessionSeeStaticEntityForSession(session, entity) { return session.hiddenStatic !== true; },
      canSessionSeeDynamicEntity(session, entity) { return session.hiddenDynamic !== true; },
      spawnDynamicEntity(entity, opts) { this.dynamicEntities.set(entity.itemID, entity); spawns.push([entity.itemID, opts]); return { success: true, data: { entity } }; },
      unregisterDynamicEntity(entity) { this.dynamicEntities.delete(entity.itemID); },
      removeDynamicEntity(id) { this.dynamicEntities.delete(id); },
      removeStaticEntity(id) { this.staticEntities.delete(id); },
      addStaticEntity(entity) { if (this.staticEntities.has(entity.itemID)) return false;
        this.staticEntities.set(entity.itemID, entity); return true; },
      clearAllTargetingForEntity() {}, reconcileEntityPublicGrid() {}, reconcileEntityBubble() {},
      getMovementStamp: () => Math.trunc(clock / 1000),
      broadcastMovementUpdates(updates) { movements.push(...updates); },
    };
    return scene;
  }
  function pilot(scene, shipID = 5001, characterID = 140000001) {
    const notices = [];
    const session: any = { characterID, _space: { shipID, systemID: SYSTEM }, notices,
      sendNotification(...args) { notices.push(args); } };
    const ship: any = { itemID: shipID, kind: "ship", position: { x: -1000, y: 0, z: 0 }, radius: 20,
      session, mode: "STOP", scope: "public" };
    scene.sessions.set(characterID, session);
    scene.dynamicEntities.set(shipID, ship);
    return { session, ship };
  }
  function makeRuntime(store, scene) {
    return createVoxelMiningRuntime({ store, sceneAdapter, enabled: () => enabled,
      worldRevision: () => WORLD, now: readClock,
      policy: () => options.policy || {},
      canInteract: (a, b) => (a.scope || "public") === (b.scope || "public"),
      resolveSession: session => ({ scene, ship: scene.getShipEntityForSession(session) }),
      selectDestination(ship, fragment) {
        if (!fragment) return null;
        return { flagID: 5, availableVolume: capacity - (tables.items[String(ship.itemID)]?.quantity || 0) };
      },
      destinationCapacity: () => capacity,
      notifyInventory: (...args) => inventoryNotifications.push(args),
      onError: error => errors.push(error),
      onPickupFailure: (...args) => pickupFailures.push(args),
    });
  }
  function asteroid(scene) {
    const target: any = { itemID: ASTEROID, typeID: 91374, kind: "asteroid", position: { x: 0, y: 0, z: 0 }, radius: 350, scope: "public", ...(options.entity || {}) };
    const quantity = options.quantity ?? GRID_LENGTH * 10;
    const mineable = { yieldKind: "ore", yieldTypeID: 77800, unitVolume: 1,
      originalRadius: 350, originalQuantity: quantity, remainingQuantity: quantity };
    scene.staticEntities.set(ASTEROID, target);
    return { target, mineable };
  }
  const scene = makeScene(), store = makeStore("runtime-one"), runtime = makeRuntime(store, scene);
  const { session, ship } = pilot(scene);
  const { target, mineable } = asteroid(scene);
  const entry = runtime.prepareEntity(scene, target, mineable);
  const identity = { worldRevision: WORLD, systemID: SYSTEM, asteroidID: ASTEROID };
  const mine = (normalQuantity = 3, extra = {}, mineOptions = {}) => runtime.mine(scene, ship, target, mineable,
    { normalQuantity, wastedQuantity: 0, criticalHitQuantity: 0, ...extra }, { nowMs: clock, maxRangeMeters: 5000, ...mineOptions });
  const cargo = (shipID = ship.itemID) => tables.items[String(shipID)]?.quantity || 0;
  function positionFragment(fragmentID, distance) {
    const entity = scene.getEntityByID(fragmentID);
    const position = { x: ship.position.x + ship.radius + entity.radius + distance, y: 0, z: 0 };
    entity.position = position;
    tables[TABLE][`f:${fragmentID}`].position = clone(position);
    return entity;
  }
  return { tables, scene, store, runtime, session, ship, target, mineable, entry, identity,
    mine, cargo, positionFragment, pilot, makeStore, makeScene, makeRuntime, asteroid,
    inventoryNotifications, errors, pickupFailures, movements, spawns,
    setCapacity: value => { capacity = value; }, setCommitFailure: value => { failCommit = value; },
    setEnabled: value => { enabled = value; }, setTime: value => { clock = value; },
    advance(ms) { clock += ms; runtime.tickScene(scene, clock); }, now: () => clock };
}

test("mining creates material fragments without inventory credit, then carves only exhausted cells", () => {
  const f = fixture();
  const partial = f.mine(3);
  assert.equal(partial.success, true);
  const cell = partial.data.voxelIndex;
  assert.equal(partial.data.fragments[0].quantity, 3);
  assert.equal(partial.data.fragments[0].yieldTypeID, 77800);
  assert.equal(f.scene.getEntityByID(partial.data.fragments[0].itemID).kind, "regolith");
  assert.equal(f.store.getAsteroid(f.identity).cellRemaining[cell], 7);
  assert.deepEqual(f.store.getAsteroid(f.identity).minedCells, []);
  assert.equal(f.runtime.getCompositeMinedSetForSession(f.session, ASTEROID), null);
  assert.deepEqual(f.session.notices, []);
  assert.equal(f.cargo(), 0);
  assert.deepEqual(f.inventoryNotifications, []);
  const full = f.mine(7);
  assert.equal(full.data.voxelIndex, cell);
  assert.deepEqual(f.store.getAsteroid(f.identity).minedCells, [cell]);
  assert.deepEqual(f.session.notices, [["OnCompositeVoxelMined", "charid", [ASTEROID, cell]]]);
  assert.deepEqual(geometry.decodeMinedSet(GRID_LENGTH, f.runtime.getCompositeMinedSetForSession(f.session, ASTEROID)), [cell]);
  assert.notEqual(f.mine(1).data.voxelIndex, cell);
  assert.equal(f.cargo(), 0);
});

test("waste depletes source while critical bonus is conserved separately from original ore", () => {
  const f = fixture();
  const result = f.mine(4, { wastedQuantity: 2, criticalHitQuantity: 2 });
  assert.equal(result.success, true);
  assert.equal(result.data.fragments[0].quantity, 6);
  const state = f.store.getAsteroid(f.identity);
  assert.equal(state.remainingQuantity, state.originalQuantity - 6);
  assert.equal(state.extractedQuantity, 6);
  assert.equal(state.bonusQuantity, 2);
  assert.equal(state.wastedQuantity, 2);
  assert.equal(state.cellRemaining[result.data.voxelIndex], 4);
});

test("carve notices stay within visible scene membership and extraction failure preserves state", () => {
  const f = fixture();
  const visible = f.pilot(f.scene, 5002, 140000002);
  const hidden = f.pilot(f.scene, 5003, 140000003);
  hidden.session.hiddenStatic = true;
  const result = f.mine(10);
  assert.equal(result.success, true);
  assert.deepEqual(visible.session.notices, f.session.notices);
  assert.deepEqual(hidden.session.notices, []);
  const before = f.store.getAsteroid(f.identity);
  const fragmentIDs = f.store.listFragments(WORLD, SYSTEM).map(row => row.itemID);
  f.setCommitFailure(true);
  assert.equal(f.mine(10).success, false);
  assert.deepEqual(f.store.getAsteroid(f.identity), before);
  assert.equal(f.mineable.remainingQuantity, before.remainingQuantity);
  assert.deepEqual(f.store.listFragments(WORLD, SYSTEM).map(row => row.itemID), fragmentIDs);
  assert.equal(f.session.notices.length, 1);
  assert.equal(f.cargo(), 0);
});

test("rays pointing away, out-of-range shots and hidden scopes cannot extract", () => {
  const f = fixture();
  assert.equal(f.mine(3, {}, { rayDirection: { x: -1, y: 0, z: 0 } }).errorMsg, "NO_VOXEL_HIT");
  assert.equal(f.mine(3, {}, { rayDirection: { x: 1, y: 0, z: 0 }, maxRangeMeters: 10 }).errorMsg, "NO_VOXEL_HIT");
  assert.deepEqual(f.store.listFragments(WORLD, SYSTEM), []);
  f.ship.scope = "other-instance";
  assert.equal(f.mine().errorMsg, "INVALID_MINING_TARGET");
  assert.equal(f.runtime.getCompositeRecipeForSession(f.session, ASTEROID), null);
  f.ship.scope = "public";
  assert.equal(f.mine(3, {}, { rayDirection: { x: 1, y: 0, z: 0 } }).success, true);
});

test("an authoritative swept-beam grazing contact still mines when its centerline misses", () => {
  const f = fixture();
  const model = f.entry.model;
  const top = Math.max(...model.grid.map(cell => cell.y));
  const cell = model.grid.filter(cell => cell.y === top).sort((a, b) => a.x - b.x)[0];
  const position = geometry.compositeCellPosition(model, cell.index);
  const topSurface = position.y + model.spacing / 2;
  // The existing held-beam trace has a 50m radius; a centerline 25m above
  // the highest cube can hit its top face without the zero-width ray hitting.
  f.ship.position = { x: -1000, y: topSurface + 25, z: position.z };
  const direction = { x: 1, y: 0, z: 0 };
  assert.equal(geometry.raycastCompositeVoxel(model, [], f.ship.position, direction), null);
  const result = f.mine(3, {}, { rayDirection: direction,
    contactPoint: { x: position.x, y: topSurface, z: position.z } });
  assert.equal(result.success, true, result.errorMsg);
  assert.equal(result.data.voxelIndex, cell.index);
  assert.equal(result.data.fragments[0].quantity, 3);
  assert.equal(f.cargo(), 0);
});

test("low-stock asteroids replay zero-allocation cells and remove the final exhausted body", () => {
  const f = fixture({ quantity: 3 });
  const initial = geometry.decodeMinedSet(GRID_LENGTH, f.runtime.getCompositeMinedSetForSession(f.session, ASTEROID));
  assert.deepEqual(initial, Array.from({ length: GRID_LENGTH - 3 }, (_, i) => i + 3));
  const first = f.mine(1);
  assert.equal(first.success, true);
  assert.ok(first.data.voxelIndex < 3);
  const updated = geometry.decodeMinedSet(GRID_LENGTH, f.runtime.getCompositeMinedSetForSession(f.session, ASTEROID));
  assert.equal(updated.length, GRID_LENGTH - 2);
  assert.ok(updated.includes(first.data.voxelIndex));
  assert.equal(f.mine(1).success, true);
  assert.equal(f.mine(1).data.depleted, true);
  assert.equal(f.scene.getEntityByID(ASTEROID), null);
  assert.equal(f.store.listFragments(WORLD, SYSTEM).reduce((sum, fragment) => sum + fragment.quantity, 0), 3);
  assert.equal(f.cargo(), 0);
});

test("global voxel respawn preserves finite temporary landscape stock while ordinary asteroids refill", () => {
  for (const temporary of [false, true]) {
    const f = fixture({ quantity: 3, policy: { respawnDelayMs: 1000 },
      entity: temporary ? { temporaryLandscapeRevision: "a".repeat(64), temporaryLandscapePolicyRevision: "b".repeat(64) } : {} });
    for (let index = 0; index < 3; index++) assert.equal(f.mine(1).success, true);
    assert.equal(f.scene.getEntityByID(ASTEROID), null);
    const depleted = f.store.getAsteroid(f.identity);
    assert.equal(depleted.remainingQuantity, 0);
    f.advance(1001);
    if (!temporary) {
      assert.equal(f.store.getAsteroid(f.identity).remainingQuantity, 3);
      assert.equal(f.store.getAsteroid(f.identity).generation, 1);
      assert.ok(f.scene.getEntityByID(ASTEROID));
      continue;
    }
    assert.deepEqual(f.store.getAsteroid(f.identity), depleted);
    assert.equal(f.mineable.remainingQuantity, 0);
    assert.equal(f.scene.getEntityByID(ASTEROID), null);
    const restartedScene = f.makeScene(), restartedStore = f.makeStore("runtime-after-depletion");
    const restarted = f.makeRuntime(restartedStore, restartedScene), body = f.asteroid(restartedScene);
    restarted.prepareEntity(restartedScene, body.target, body.mineable);
    f.setTime(20000); restarted.tickScene(restartedScene, 20000);
    assert.deepEqual(restartedStore.getAsteroid(f.identity), depleted);
    assert.equal(body.mineable.remainingQuantity, 0);
    assert.equal(restartedScene.getEntityByID(ASTEROID), null);
  }
});

test("voxel repair cannot restore virtualized landscape allocations with a prior generation", () => {
  const f = fixture({ quantity: 3, policy: { respawnDelayMs: 1000 } });
  for (let index = 0; index < 3; index++) f.mine(1);
  f.advance(1001);
  assert.equal(f.store.getAsteroid(f.identity).generation, 1);
  // Simulate a restored allocation carrying its persisted scope markers. Only
  // the landscape adapter may rematerialize it after site virtualization.
  f.target.temporaryLandscapeRevision = "a".repeat(64);
  f.target.temporaryLandscapePolicyRevision = "b".repeat(64);
  f.scene.removeStaticEntity(ASTEROID);
  f.advance(1001);
  assert.equal(f.scene.getEntityByID(ASTEROID), null);
  assert.equal(f.store.getAsteroid(f.identity).remainingQuantity, 3);
});

test("generic depleted-mineable scheduler excludes temporary policy stock regardless of entity kind", () => {
  const mining = require("../src/services/mining/miningRuntimeState")._testing;
  const state = { remainingQuantity: 0, depletedAtMs: 1000, respawnAtMs: 2000 };
  assert.equal(mining.shouldRespawnDepletedMineable({ kind: "asteroid" }), true);
  assert.ok(mining.getDepletedMineableRespawnAtMs({ kind: "asteroid" }, state) > 0);
  const temporary = { kind: "asteroid", temporaryLandscapePolicyRevision: "b".repeat(64) };
  assert.equal(mining.shouldRespawnDepletedMineable(temporary), false);
  assert.equal(mining.getDepletedMineableRespawnAtMs(temporary, state), 0);
  assert.equal(mining.isDepletedMineableRespawnDue(temporary, state, Number.MAX_SAFE_INTEGER), false);
});

test("recipe authorization checks authentic in-system session and the correct visibility kind", () => {
  const f = fixture();
  assert.ok(f.runtime.getCompositeRecipeForSession(f.session, ASTEROID));
  const impostor = { ...f.session };
  assert.equal(f.runtime.getCompositeRecipeForSession(impostor, ASTEROID), null);
  f.session.hiddenStatic = true;
  assert.equal(f.runtime.getCompositeRecipeForSession(f.session, ASTEROID), null);
  f.scene.staticEntities.delete(ASTEROID);
  f.scene.dynamicEntities.set(ASTEROID, f.target);
  assert.ok(f.runtime.getCompositeRecipeForSession(f.session, ASTEROID), "dynamic visibility must not use static flag");
  f.session.hiddenDynamic = true;
  assert.equal(f.runtime.getCompositeRecipeForSession(f.session, ASTEROID), null);
  f.session.hiddenDynamic = false;
  f.session._space.systemID = SYSTEM + 1;
  assert.equal(f.runtime.getCompositeRecipeForSession(f.session, ASTEROID), null);
  f.session._space.systemID = SYSTEM;
  f.setEnabled(false);
  assert.equal(f.runtime.getCompositeRecipeForSession(f.session, ASTEROID), null);
  assert.equal(f.mine().success, false);
});

test("BeginScoop returns pull/hold ticks, duplicate begin preserves claim, competitor cannot steal", () => {
  const f = fixture();
  const id = f.mine(3).data.fragments[0].itemID;
  f.positionFragment(id, 1800);
  const begin = f.runtime.beginScoop(f.session, id);
  assert.deepEqual(begin.data.durations, [(1800 - SCOOP_STOP_RANGE) / SCOOP_PULL_SPEED * 1000 * 10000, SCOOP_CHANNEL_MS * 10000]);
  const claim = f.store.getFragment(id).claim.claimToken;
  assert.equal(f.runtime.beginScoop(f.session, id).success, true);
  assert.equal(f.store.getFragment(id).claim.claimToken, claim);
  const competitor = f.pilot(f.scene, 5002, 140000002);
  assert.equal(f.runtime.beginScoop(competitor.session, id).errorMsg, "FRAGMENT_ALREADY_CLAIMED");
  f.runtime.cancelScoop(competitor.session, id);
  assert.equal(f.store.getFragment(id).claim.claimToken, claim, "another pilot cannot cancel the claimant");
  assert.equal(f.cargo(), 0);
  f.advance(500);
  assert.equal(f.cargo(), 0);
  assert.ok(f.movements.length >= 2);
  f.advance(500);
  assert.equal(f.cargo(), 0);
  assert.equal(f.runtime.beginScoop(f.session, id).data.durations[0], 0);
  f.advance(SCOOP_CHANNEL_MS - 1);
  assert.equal(f.cargo(), 0);
  f.advance(1);
  assert.equal(f.cargo(), 3);
  assert.equal(f.store.getFragment(id).status, "consumed");
  assert.equal(f.scene.getEntityByID(id), null);
  assert.equal(f.inventoryNotifications.length, 1);
  f.advance(5000);
  assert.equal(f.cargo(), 3);
});

test("nearby material still requires the full hold duration and rejects invalid targets", () => {
  const f = fixture();
  const id = f.mine(3).data.fragments[0].itemID;
  f.positionFragment(id, 100);
  assert.equal(f.runtime.beginScoop(f.session, ASTEROID).errorMsg, "INVALID_SCOOP_TARGET");
  assert.equal(f.runtime.beginScoop({ ...f.session }, id).errorMsg, "INVALID_SCOOP_SESSION");
  assert.deepEqual(f.runtime.beginScoop(f.session, id).data.durations, [0, SCOOP_CHANNEL_MS * 10000]);
  f.advance(0);
  assert.equal(f.cargo(), 0);
  f.advance(SCOOP_CHANNEL_MS - 1);
  assert.equal(f.cargo(), 0);
  f.advance(1);
  assert.equal(f.cargo(), 3);
});

test("claim expiry uses one clock sample even when wall time advances between reads", () => {
  const f = fixture({ incrementClockReads: true });
  const id = f.mine(3).data.fragments[0].itemID;
  f.positionFragment(id, 100);
  const begin = f.runtime.beginScoop(f.session, id);
  assert.equal(begin.success, true, begin.errorMsg);
  assert.equal(f.store.getFragment(id).status, "claimed");
  f.advance(SCOOP_CHANNEL_MS);
  assert.equal(f.cargo(), 3);
});

test("cancellation and disconnect preserve material and stop unfinished pickup", () => {
  for (const disconnect of [false, true]) {
    const f = fixture();
    const id = f.mine(3).data.fragments[0].itemID;
    f.positionFragment(id, 1800);
    f.runtime.beginScoop(f.session, id);
    f.advance(250);
    const pulledPosition = { ...f.scene.getEntityByID(id).position };
    if (disconnect) f.runtime.handleSessionDetached(f.session);
    else assert.equal(f.runtime.cancelScoop(f.session, id).success, true);
    f.advance(5000);
    assert.equal(f.cargo(), 0);
    assert.equal(f.store.getFragment(id).status, "available");
    assert.deepEqual(f.store.getFragment(id).position, pulledPosition);
    assert.deepEqual(f.scene.getEntityByID(id).velocity, { x: 0, y: 0, z: 0 });
    assert.equal(f.runtime.beginScoop(f.session, id).success, true);
  }
});

test("range, warp, cloak and visibility changes release claims without inventory grant", () => {
  for (const change of ["range", "warp", "pendingWarp", "cloak", "cloakMode", "stargateJumpCloak", "berthed", "visibility", "scope"]) {
    const f = fixture();
    const id = f.mine(3).data.fragments[0].itemID;
    f.positionFragment(id, 100);
    f.runtime.beginScoop(f.session, id);
    if (change === "range") f.ship.position.x -= 10000;
    if (change === "warp") f.ship.warpState = { active: true };
    if (change === "pendingWarp") f.ship.pendingWarp = { readyAtMs: f.now() + 1000 };
    if (change === "cloak") f.ship.cloaked = true;
    if (change === "cloakMode") f.ship.cloakMode = 1;
    if (change === "stargateJumpCloak") f.ship.stargateJumpCloak = true;
    if (change === "berthed") f.ship.frontierBerthingHostAssemblyID = 900001;
    if (change === "visibility") f.session.hiddenDynamic = true;
    if (change === "scope") f.ship.scope = "other-instance";
    f.advance(SCOOP_CHANNEL_MS + 1);
    assert.equal(f.cargo(), 0, change);
    assert.equal(f.store.getFragment(id).status, "available", change);
    assert.equal(f.runtime.beginScoop(f.session, id).success, false, change);
  }
});

test("cargo changes and atomic commit failure retain fragments, then permit an exact-once retry", () => {
  for (const cause of ["capacity", "commit"]) {
    const f = fixture();
    const id = f.mine(3).data.fragments[0].itemID;
    f.positionFragment(id, 100);
    f.setCapacity(2);
    assert.equal(f.runtime.beginScoop(f.session, id).errorMsg, "NOT_ENOUGH_CARGO_SPACE");
    f.setCapacity(100);
    assert.equal(f.runtime.beginScoop(f.session, id).success, true);
    if (cause === "capacity") f.setCapacity(2);
    else f.setCommitFailure(true);
    f.advance(SCOOP_CHANNEL_MS);
    assert.equal(f.cargo(), 0, cause);
    assert.notEqual(f.store.getFragment(id).status, "consumed", cause);
    assert.ok(f.scene.getEntityByID(id));
    if (cause === "commit") {
      assert.equal(f.runtime.beginScoop(f.session, id).success, false, "pending durable cancel must not resume extraction");
    }
    f.setCapacity(100); f.setCommitFailure(false);
    // A recovered write must release the retained cancel token without lease expiry.
    f.advance(0);
    assert.equal(f.store.getFragment(id).status, "available");
    assert.equal(f.runtime.beginScoop(f.session, id).success, true);
    f.advance(SCOOP_CHANNEL_MS);
    assert.equal(f.cargo(), 3);
  }
});

test("restart restores holes, remaining ore and unconsumed fragments, and releases old process claims", () => {
  const f = fixture();
  const mined = f.mine(10);
  const id = mined.data.fragments[0].itemID;
  f.positionFragment(id, 1800);
  f.runtime.beginScoop(f.session, id);
  f.advance(500);
  f.runtime.cancelScoop(f.session, id);
  const checkpoint = f.store.getFragment(id).position;
  f.runtime.beginScoop(f.session, id);
  const restartedStore = f.makeStore("runtime-two");
  const scene = f.makeScene();
  const { ship, session } = f.pilot(scene);
  const { target, mineable } = f.asteroid(scene);
  const runtime = f.makeRuntime(restartedStore, scene);
  runtime.prepareEntity(scene, target, mineable);
  runtime.restoreScene(scene);
  assert.equal(mineable.remainingQuantity, GRID_LENGTH * 10 - 10);
  assert.deepEqual(geometry.decodeMinedSet(GRID_LENGTH, runtime.getCompositeMinedSetForSession(session, ASTEROID)), [mined.data.voxelIndex]);
  assert.deepEqual(scene.getEntityByID(id).position, checkpoint);
  assert.equal(restartedStore.listFragments(WORLD, SYSTEM)[0].status, "available");
  assert.equal(runtime.beginScoop(session, id).success, true);
  f.setTime(f.now() + 1000); runtime.tickScene(scene, f.now());
  f.setTime(f.now() + SCOOP_CHANNEL_MS); runtime.tickScene(scene, f.now());
  assert.equal(f.cargo(ship.itemID), 10);
  assert.equal(scene.getEntityByID(id), null);
  const secondRestart = f.makeRuntime(f.makeStore("runtime-three"), f.makeScene());
  const emptyScene = f.makeScene();
  secondRestart.restoreScene(emptyScene);
  assert.equal(emptyScene.getEntityByID(id), null);
  assert.equal(f.cargo(ship.itemID), 10);
});

test("a failed visual removal retries after committed pickup without granting ore twice", () => {
  const f = fixture();
  const id = f.mine(3).data.fragments[0].itemID;
  f.positionFragment(id, 100);
  const remove = f.scene.unregisterDynamicEntity;
  let removeAttempts = 0;
  f.scene.unregisterDynamicEntity = function(entity, options) {
    removeAttempts += 1;
    if (removeAttempts === 1) throw new Error("INJECTED_VISUAL_REMOVAL_FAILURE");
    return remove.call(this, entity, options);
  };
  assert.equal(f.runtime.beginScoop(f.session, id).success, true);
  f.advance(SCOOP_CHANNEL_MS);
  assert.equal(f.cargo(), 3);
  assert.equal(f.store.getFragment(id).status, "consumed");
  assert.ok(f.scene.getEntityByID(id), "failed removal leaves a temporary visible entity");
  assert.equal(f.inventoryNotifications.length, 1);
  assert.equal(f.errors.length, 1);
  assert.equal(f.runtime.beginScoop(f.session, id).success, false, "consumed receipt prevents scooping the temporary ghost");
  f.advance(1000);
  assert.equal(f.scene.getEntityByID(id), null);
  assert.equal(removeAttempts, 2);
  assert.equal(f.cargo(), 3);
  assert.equal(f.inventoryNotifications.length, 1);
  f.advance(1000);
  assert.equal(f.cargo(), 3);
  assert.equal(f.scene.getEntityByID(id), null);
});
