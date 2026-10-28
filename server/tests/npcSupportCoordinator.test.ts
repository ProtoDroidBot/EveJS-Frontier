import assert from "node:assert/strict";
import test from "node:test";

const database = require("../src/gameStore");
const nativeStore = require("../src/space/npc/nativeNpcStore");
const persistence = require("../src/space/npc/npcRuntimePersistence");
const {
  NpcSupportCoordinator,
  tickNpcSupportJob,
} = require("../src/space/npc/npcSupportCoordinator");

const TABLES = [
  "npcRuntimeState",
  "npcEntities",
  "npcModules",
  "npcCargo",
  "npcRuntimeControllers",
];

function emptyTables() {
  database.write("npcRuntimeState", "/", {}, { force: true });
  database.write("npcEntities", "/", { nextEntityID: 980000000000, entities: {} }, { force: true });
  database.write("npcModules", "/", { nextModuleID: 980100000000, modules: {} }, { force: true });
  database.write("npcCargo", "/", { nextCargoID: 980200000000, cargo: {} }, { force: true });
  database.write("npcRuntimeControllers", "/", { controllers: {} }, { force: true });
  database.flushTablesSync(TABLES);
  nativeStore.invalidateControllerCache();
  persistence._testing.resetRuntimeForTests();
}

function fixture(t) {
  const backup = Object.fromEntries(TABLES.map((table) => [
    table,
    structuredClone(database.read(table, "/").data),
  ]));
  emptyTables();
  t.after(() => {
    for (const [table, value] of Object.entries(backup)) {
      database.write(table, "/", value, { force: true });
    }
    database.flushTablesSync(TABLES);
    nativeStore.invalidateControllerCache();
    persistence._testing.resetRuntimeForTests();
  });
}

function putNpc(input: Record<string, any>) {
  const entity = {
    entityID: input.entityID,
    systemID: input.systemID || 30000004,
    npcCharacterID: input.npcCharacterID,
    npcIncarnation: 1,
    npcFactionIdentityKey: input.factionKey || "500001-test-tribe",
    warFactionID: 500001,
    npcFactionKey: "test-tribe",
    behaviorRole: input.behaviorRole || "guard",
    position: input.position || { x: 0, y: 0, z: 0 },
    nativeNpc: true,
    transient: false,
  };
  assert.equal(nativeStore.upsertNativeEntity(entity, { durable: true }).success, true);
  if (input.role) {
    assert.equal(nativeStore.upsertNativeModule({
      moduleID: input.moduleID,
      entityID: input.entityID,
      ownerID: input.npcCharacterID,
      typeID: 1,
      semanticRole: input.role,
      moduleState: { online: true },
      transient: false,
    }, { durable: true }).success, true);
  }
  return entity;
}

function fakeScene(entities: any[]) {
  const byID = new Map(entities.map((entity) => [entity.itemID, entity]));
  return {
    systemID: 30000004,
    getEntityByID(entityID) { return byID.get(entityID) || null; },
  };
}

test("faction support deduplicates incidents, ranks nearby capability, and resumes interrupted work", (t) => {
  fixture(t);
  persistence.initializeNpcRuntimePersistence({ reconcile: false });
  const requester = putNpc({
    entityID: 980000000001,
    npcCharacterID: 1500000001,
    position: { x: 0, y: 0, z: 0 },
  });
  const nearbyBusy = putNpc({
    entityID: 980000000002,
    npcCharacterID: 1500000002,
    moduleID: 980100000002,
    role: "weapon",
    position: { x: 1_000, y: 0, z: 0 },
  });
  putNpc({
    entityID: 980000000003,
    npcCharacterID: 1500000003,
    moduleID: 980100000003,
    role: "weapon",
    position: { x: 50_000, y: 0, z: 0 },
  });
  const previousJob = persistence.createNpcJob({
    npcCharacterID: nearbyBusy.npcCharacterID,
    incarnation: 1,
    jobType: "resource.mine",
    checkpoint: { extracted: 7 },
  }).data;
  const controller: Record<string, any> = {
    entityID: nearbyBusy.entityID,
    systemID: 30000004,
    runtimeKind: "nativeAmbient",
  };
  const scene = fakeScene([
    { itemID: requester.entityID, systemID: 30000004, position: requester.position },
    { itemID: nearbyBusy.entityID, systemID: 30000004, position: nearbyBusy.position },
    { itemID: 9001, systemID: 30000004, ownerID: 77, position: { x: 2_000, y: 0, z: 0 } },
  ]);
  const coordinator = new NpcSupportCoordinator({
    getController(entityID) { return entityID === nearbyBusy.entityID ? controller : null; },
  });
  const first = coordinator.requestSupport({
    requesterEntityID: requester.entityID,
    threatTargetID: 9001,
    scene,
    nowMs: 10_000,
    maximumResponderCount: 1,
    cooldownMs: 60_000,
    code: "must-not-persist",
    salt: "must-not-persist",
  });
  assert.equal(first.success, true);
  assert.equal(first.data.created, true);
  assert.equal(first.data.incident.responderAssignments.length, 1);
  assert.equal(first.data.incident.responderAssignments[0].responderEntityID, nearbyBusy.entityID);
  assert.equal(first.data.incident.responderAssignments[0].dispatchTier, "nearby");
  assert.equal(persistence.getNpcJob(previousJob.jobID).status, "interrupted");
  const supportJob = persistence.getActiveNpcJob(nearbyBusy.npcCharacterID, 1);
  assert.equal(supportJob.jobType, "support.respond");
  assert.equal(controller.preferredTargetID, 9001);
  assert.equal(JSON.stringify(first.data.incident).includes("must-not-persist"), false);

  const duplicate = coordinator.requestSupport({
    requesterEntityID: requester.entityID,
    threatTargetID: 9001,
    scene,
    nowMs: 11_000,
    maximumResponderCount: 1,
  });
  assert.equal(duplicate.success, true);
  assert.equal(duplicate.data.created, false);
  assert.equal(duplicate.data.incident.incidentID, first.data.incident.incidentID);
  assert.equal(duplicate.data.incident.responderAssignments.length, 1);
  const snapshot = persistence.createVerifiedSnapshot("phase-4-test").data;
  const verifiedSnapshot = persistence.readVerifiedSnapshot(snapshot.snapshotID);
  assert.equal(verifiedSnapshot.success, true);
  assert.equal(
    verifiedSnapshot.data.runtime.supportIncidents[first.data.incident.incidentID].status,
    "active",
  );
  assert.equal(Object.keys(verifiedSnapshot.data.runtime.supportCooldowns).length, 1);

  persistence._testing.resetRuntimeForTests();
  persistence.initializeNpcRuntimePersistence({ reconcile: false });
  assert.equal(
    persistence.getNpcSupportIncident(first.data.incident.incidentID).responderAssignments.length,
    1,
  );
  assert.equal(persistence.getNpcJob(previousJob.jobID).status, "interrupted");

  assert.equal(coordinator.resolveIncident(first.data.incident.incidentID, "threat-cleared", 12_000).success, true);
  const tickResult = tickNpcSupportJob({
    job: persistence.getNpcJob(supportJob.jobID),
    entity: { itemID: nearbyBusy.entityID, systemID: 30000004 },
    controller,
    scene,
    nowMs: 12_001,
  });
  assert.equal(tickResult.status, "success");
  assert.equal(persistence.getNpcJob(supportJob.jobID).status, "completed");
  assert.equal(persistence.getNpcJob(previousJob.jobID).status, "queued");
  assert.deepEqual(persistence.getNpcJob(previousJob.jobID).checkpoint, { extracted: 7 });
});

test("support group cooldown prevents storms and caller assertions cannot authorize an unaffiliated NPC", (t) => {
  fixture(t);
  persistence.initializeNpcRuntimePersistence({ reconcile: false });
  const requester = putNpc({ entityID: 980000000010, npcCharacterID: 1500000010 });
  const coordinator = new NpcSupportCoordinator();
  const first = coordinator.requestSupport({
    requesterEntityID: requester.entityID,
    threatTargetID: 9010,
    supportGroupID: "border-patrol",
    nowMs: 20_000,
    cooldownMs: 60_000,
  });
  assert.equal(first.success, true);
  const storm = coordinator.requestSupport({
    requesterEntityID: requester.entityID,
    threatTargetID: 9011,
    supportGroupID: "border-patrol",
    nowMs: 21_000,
    cooldownMs: 60_000,
  });
  assert.equal(storm.success, false);
  assert.equal(storm.errorMsg, "NPC_SUPPORT_GROUP_COOLDOWN");

  const unaffiliated = putNpc({
    entityID: 980000000011,
    npcCharacterID: 1500000011,
    factionKey: "0-none",
  });
  const forged = coordinator.requestSupport({
    requesterEntityID: unaffiliated.entityID,
    threatTargetID: 9012,
    authorization: { verified: true, factionKey: "500001-test-tribe" },
    nowMs: 22_000,
  });
  assert.equal(forged.success, false);
  assert.equal(forged.errorMsg, "NPC_SUPPORT_FACTION_IDENTITY_REQUIRED");
});

test("cross-system responders are accepted only when their fitting can travel", (t) => {
  fixture(t);
  persistence.initializeNpcRuntimePersistence({ reconcile: false });
  const requester = putNpc({ entityID: 980000000020, npcCharacterID: 1500000020 });
  putNpc({
    entityID: 980000000021,
    npcCharacterID: 1500000021,
    moduleID: 980100000021,
    role: "weapon",
    systemID: 30000005,
  });
  const traveler = putNpc({
    entityID: 980000000022,
    npcCharacterID: 1500000022,
    moduleID: 980100000022,
    role: "jump_drive",
    behaviorRole: "combat",
    systemID: 30000005,
  });
  const coordinator = new NpcSupportCoordinator();
  const result = coordinator.requestSupport({
    requesterEntityID: requester.entityID,
    threatTargetID: 9020,
    requiredRoles: ["combat"],
    nowMs: 30_000,
    maximumResponderCount: 2,
  });
  assert.equal(result.success, true);
  assert.equal(result.data.incident.responderAssignments.length, 1);
  assert.equal(result.data.incident.responderAssignments[0].responderEntityID, traveler.entityID);
  assert.equal(result.data.incident.responderAssignments[0].dispatchTier, "cross-system");
  const supportJob = persistence.getActiveNpcJob(traveler.npcCharacterID, 1);
  const tickResult = tickNpcSupportJob({
    job: supportJob,
    entity: { itemID: traveler.entityID, systemID: 30000005 },
    controller: {},
    scene: fakeScene([]),
    nowMs: 30_100,
  });
  assert.equal(tickResult.status, "suspended");
  // The dispatch is valid, but a synthetic runtime ship without the durable
  // pilot/incarnation pair cannot cross the source dematerialization boundary.
  assert.equal(tickResult.step, "awaiting-identity");
});

test("reserve spawning is explicit and bounded by the incident responder limit", (t) => {
  fixture(t);
  persistence.initializeNpcRuntimePersistence({ reconcile: false });
  const requester = putNpc({ entityID: 980000000030, npcCharacterID: 1500000030 });
  let requestedReserveCount = 0;
  const coordinator = new NpcSupportCoordinator({
    spawnReserve(incident, count) {
      requestedReserveCount = count;
      const spawned: any[] = [];
      for (let index = 0; index < count; index += 1) {
        spawned.push(putNpc({
          entityID: 980000000031 + index,
          npcCharacterID: 1500000031 + index,
          moduleID: 980100000031 + index,
          role: "weapon",
          factionKey: incident.factionKey,
          position: { x: 5_000 + index, y: 0, z: 0 },
        }));
      }
      return spawned;
    },
  });
  const result = coordinator.requestSupport({
    requesterEntityID: requester.entityID,
    threatTargetID: 9030,
    nowMs: 40_000,
    maximumResponderCount: 2,
    allowReserveSpawn: true,
    maximumReserveSpawn: 12,
  });
  assert.equal(result.success, true);
  assert.equal(requestedReserveCount, 2);
  assert.equal(result.data.spawnedCount, 2);
  assert.equal(result.data.incident.responderAssignments.length, 2);
});
