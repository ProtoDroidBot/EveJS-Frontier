"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const database = require("../src/gameStore");
const { createTableRepository } = require("../src/gameStore/tableRepository");
const profile = require("../src/services/frontier/temporaryLandscapeProfile");
const content = require("../src/services/dungeon/dungeonContentProfile");
const state = require("../src/services/dungeon/dungeonRuntimeState");
const authority = require("../src/services/dungeon/dungeonAuthority");
const repo = createTableRepository("service:dungeon", { strict: true });
const TABLE = "dungeonRuntimeState", A = "a".repeat(64), B = "b".repeat(64);
const worldInstance = id => ({ instanceID: id, templateID: "frontier-dungeon:100", sourceDungeonID: 100,
  source: "frontier", siteOrigin: "universe_dungeon", solarSystemID: 30000012, siteKey: "same-slot",
  lifecycleState: "active", spawnState: { depleted: true, contentEntityRefsByKey: { ore: { itemID: 1900000000 + id } } },
  runtimeFlags: { universePersistent: true }, metadata: { definitionHash: "original" } });

test("temporary dungeon revisions preserve old receipts and shared missions while blocking hidden raw-ID mutations", t => {
  const original = profile.getTemporaryLandscapeProfile;
  let revision = "";
  profile.getTemporaryLandscapeProfile = () => revision ? { revision } : null;
  t.after(() => { profile.getTemporaryLandscapeProfile = original; state.clearRuntimeCache(); authority.clearCache(); });
  repo.ensureTable(TABLE);
  const mission = { ...worldInstance(2), templateID: "mission:independent", source: "mission", siteOrigin: "mission",
    siteKey: "mission-slot", ownership: { missionOwnerCharacterID: 140000001 }, metadata: { missionContentID: "custom-mission" } };
  assert.equal(repo.write(TABLE, "/", { version: 1, nextInstanceSequence: 3,
    instancesByID: { "1": worldInstance(1), "2": mission }, universeReconcileMeta: { descriptorKey: "legacy" } }).success, true);
  state.clearRuntimeCache();
  const legacy = state.getInstanceSnapshot(1);
  assert.equal(state.listAllInstanceSummaries().length, 2);

  revision = A;
  assert.equal(state.getInstanceSnapshot(1), null);
  assert.ok(state.getInstanceSnapshot(2), "independent mission must remain available");
  assert.equal(state.getNextInstanceSequence(), 3);
  assert.equal(state.applyInstanceChanges({ upsertInstances: [worldInstance(3)], nextInstanceSequence: 4 }).success, true);
  assert.equal(state.getInstanceSnapshot(3).metadata.temporaryLandscapeRevision, A);
  assert.equal(state.findInstanceSummaryBySiteKey("same-slot").instanceID, 3);
  assert.equal(state.writeUniverseReconcileMeta({ descriptorKey: "profile-a" }).descriptorKey, "profile-a");
  assert.equal(state.applyInstanceChanges({ upsertInstances: [{ ...worldInstance(1), spawnState: { forged: true } }] }).success, false);
  assert.equal(state.getInstanceSnapshot(1), null);
  assert.equal(state.mutateState(table => { table.instancesByID[1] = worldInstance(1); return table; }).success, false);
  assert.equal(state.getInstanceSnapshot(1), null, "failed writes must not publish hidden state into the cache");
  const runtime = require("../src/services/dungeon/dungeonRuntime");
  assert.throws(() => runtime.mergeSpawnState(1, { forged: true }), /Unknown dungeon instance/);

  revision = B;
  assert.equal(state.getInstanceSnapshot(1), null); assert.equal(state.getInstanceSnapshot(3), null);
  assert.ok(state.getInstanceSnapshot(2)); assert.equal(state.getNextInstanceSequence(), 4);
  assert.equal(state.applyInstanceChanges({ upsertInstances: [worldInstance(4)], nextInstanceSequence: 5 }).success, true);
  assert.equal(state.writeUniverseReconcileMeta({ descriptorKey: "profile-b" }).descriptorKey, "profile-b");
  revision = A;
  assert.equal(state.getInstanceSnapshot(3).spawnState.depleted, true);
  assert.equal(state.getInstanceSnapshot(4), null);
  assert.equal(state.getUniverseReconcileMeta().descriptorKey, "profile-a");
  revision = "";
  assert.deepEqual(state.getInstanceSnapshot(1), legacy);
  assert.ok(state.getInstanceSnapshot(2)); assert.equal(state.getInstanceSnapshot(3), null);
  assert.equal(state.getInstanceSnapshot(4), null); assert.equal(state.getNextInstanceSequence(), 5);
  assert.equal(state.getUniverseReconcileMeta().descriptorKey, "legacy");
  assert.equal(database.flushTableSync(TABLE).success, true);
  const raw = repo.read(TABLE, "/").data;
  assert.deepEqual(Object.keys(raw.instancesByID).sort(), ["1", "2", "3", "4"]);
  assert.equal(raw.instancesByID[1].spawnState.depleted, true);
  assert.equal(raw.temporaryLandscapeReconcileMetaByRevision[A].descriptorKey, "profile-a");
  assert.equal(raw.temporaryLandscapeReconcileMetaByRevision[B].descriptorKey, "profile-b");
});

test("temporary authority synthesis replaces old rooms while retaining explicit mission templates", () => {
  const legacy = { templatesByID: {
    "frontier-dungeon:100": { templateID: "frontier-dungeon:100", source: "frontier", sourceDungeonID: 100, rooms: [{ roomID: 111 }] },
    "mission:independent": { templateID: "mission:independent", source: "mission", sourceMissionID: 123, rooms: [{ roomID: 555 }] },
  }, indexes: {} };
  assert.equal(content.selectAuthorityPayload(legacy, ""), legacy);
  const selected = content.selectAuthorityPayload(legacy, A);
  assert.deepEqual(Object.keys(selected.templatesByID), ["mission:independent"]);
  const target = { dungeonID: 100, dungeonName: "Target", entryTypeID: 91308, entryObjectID: 999,
    rooms: [{ roomID: 222, objects: [{ objectID: 999, typeID: 91308 }] }] };
  const merged = authority.mergeFrontierDungeonSpawnTemplates(selected, [target], [{ typeID: 91308, groupID: 4873 }]);
  assert.equal(merged.templatesByID["frontier-dungeon:100"].rooms[0].roomID, 222);
  assert.equal(merged.templatesByID["mission:independent"].rooms[0].roomID, 555);
  assert.equal(legacy.templatesByID["frontier-dungeon:100"].rooms[0].roomID, 111);
});
