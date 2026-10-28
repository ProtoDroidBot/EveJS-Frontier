"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { _testing: beltTesting } = require("../src/space/npc/beltRatRuntime");

test("belt pilots reuse vacant group slots without sharing identities with live groups", () => {
  beltTesting.resetForTests();
  const scene = {
    systemID: 30_000_001,
    dynamicEntities: new Map<any, any>(),
    getEntityByID(entityID) { return this.dynamicEntities.get(entityID); },
  };
  const belt = { itemID: 40_000_001, kind: "asteroidBelt" };
  const calls: any[] = [];
  let nextEntityID = 980_000_000_000;
  let failSpawn = false;
  const options = {
    spawnNativeDefinitionsInContext(_context, _selection, spawnOptions) {
      calls.push(spawnOptions);
      if (failSpawn) {
        return { success: false, errorMsg: "INJECTED_SPAWN_FAILURE" };
      }
      const spawned = [0, 1].map((index) => {
        const entity = {
          itemID: ++nextEntityID,
          nativeNpc: true,
          npcIdentitySlot: `${spawnOptions.npcIdentitySlot}:member:${index}`,
        };
        scene.dynamicEntities.set(entity.itemID, entity);
        return { entity };
      });
      return { success: true, data: { spawned } };
    },
  };
  const spawn = () => beltTesting.spawnBeltRatGroup(
    scene,
    null,
    belt,
    beltTesting.getOrCreateBeltState(scene.systemID, belt.itemID),
    { systemID: scene.systemID, definitions: [], profileIDs: [] },
    options,
  );
  const first = spawn();
  spawn();
  assert.equal(calls[0].npcIdentitySlot, "belt:30000001:40000001:group:0");
  assert.equal(calls[1].npcIdentitySlot, "belt:30000001:40000001:group:1");

  // A partially destroyed group still owns all of its pilot slots.
  scene.dynamicEntities.delete(first.data.spawned[0].entity.itemID);
  spawn();
  assert.equal(calls[2].npcIdentitySlot, "belt:30000001:40000001:group:2");

  scene.dynamicEntities.delete(first.data.spawned[1].entity.itemID);
  failSpawn = true;
  assert.equal(spawn().success, false);
  failSpawn = false;
  spawn();
  assert.equal(calls[3].npcIdentitySlot, calls[0].npcIdentitySlot);
  assert.equal(calls[4].npcIdentitySlot, calls[0].npcIdentitySlot);
  assert.notEqual(calls[4].spawnSiteID, calls[0].spawnSiteID);

  // Rebuilding in-memory belt state discovers occupied slots on live entities.
  beltTesting.resetForTests();
  spawn();
  assert.equal(calls[5].npcIdentitySlot, "belt:30000001:40000001:group:3");
  beltTesting.resetForTests();
});
