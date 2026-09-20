import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import path from "node:path";

const database = require("../src/gameStore");
const nativeStore = require("../src/space/npc/nativeNpcStore");
const persistence = require("../src/space/npc/npcRuntimePersistence");
const behaviorRuntime = require("../src/space/npc/npcBehaviorTreeRuntime");

const TABLES = [
  "npcRuntimeState",
  "npcEntities",
  "npcModules",
  "npcCargo",
  "npcRuntimeControllers",
  "npcPilotIdentities",
  "npcWrecks",
  "npcWreckItems",
];

function emptyTables() {
  database.write("npcRuntimeState", "/", {}, { force: true });
  database.write("npcEntities", "/", { nextEntityID: 980000000000, entities: {} }, { force: true });
  database.write("npcModules", "/", { nextModuleID: 980100000000, modules: {} }, { force: true });
  database.write("npcCargo", "/", { nextCargoID: 980200000000, cargo: {} }, { force: true });
  database.write("npcRuntimeControllers", "/", { controllers: {} }, { force: true });
  database.write("npcWrecks", "/", { nextWreckID: 980300000000, wrecks: {} }, { force: true });
  database.write("npcWreckItems", "/", { nextWreckItemID: 980400000000, items: {} }, { force: true });
  database.write("npcPilotIdentities", "/", {
    version: 1,
    nextCharacterID: 1500000000,
    pilots: {},
    slots: {},
    factions: {},
  }, { force: true });
  database.flushTablesSync(TABLES);
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
    persistence._testing.resetRuntimeForTests();
  });
}

test("Phase 0 jobs are versioned, idempotent, and revision guarded", (t) => {
  fixture(t);
  persistence.initializeNpcRuntimePersistence({ reconcile: false });
  const first = persistence.createNpcJob({
    npcCharacterID: 1500000001,
    incarnation: 2,
    jobType: "resource.mine",
    idempotencyKey: "mine:site:7",
  }).data;
  const duplicate = persistence.createNpcJob({
    npcCharacterID: 1500000001,
    incarnation: 2,
    jobType: "resource.mine",
    idempotencyKey: "mine:site:7",
  }).data;
  assert.equal(duplicate.jobID, first.jobID);
  const claimed = persistence.claimNpcJob(first.jobID, {
    expectedRevision: first.recordRevision,
  }).data;
  assert.equal(claimed.status, "running");
  assert.equal(claimed.recordRevision, 2);
  assert.throws(() => persistence.updateNpcJob(first.jobID, {
    status: "suspended",
  }, { expectedRevision: 1 }), /revision conflict/);
});

test("assembly signal checkpoints atomically create and reprioritize one durable job", (t) => {
  fixture(t);
  persistence.initializeNpcRuntimePersistence({ reconcile: false });
  const identity = {
    observerID: "faction:500012-blood-raiders",
    assemblyID: 900000700,
    signalType: "network_node.resources",
  };
  const job = {
    npcCharacterID: 1500000070,
    incarnation: 3,
    jobType: "resource.fuel",
    idempotencyKey: "network-node-fuel:900000700:active",
    target: { assemblyID: 900000700 },
    payload: { severity: "high" },
    priority: 80,
  };
  const first = persistence.applyNpcAssemblySignalCheckpoint({
    ...identity,
    sequence: 5,
    revision: 1,
    status: { activeFlags: ["FUEL_LOW"] },
    job,
    nowMs: 1_000,
  });
  assert.equal(first.success, true);
  assert.equal(first.applied, true);
  assert.equal(first.job.priority, 80);
  assert.equal(first.job.checkpoint.assemblySignal.sequence, 5);
  assert.equal(persistence.getPersistenceStatus().data.assemblySignalCursorCount, 1);

  const replay = persistence.applyNpcAssemblySignalCheckpoint({
    ...identity,
    sequence: 5,
    revision: 1,
    status: { activeFlags: ["FUEL_LOW"] },
    job,
    nowMs: 1_001,
  });
  assert.equal(replay.applied, false);
  assert.equal(replay.replayed, true);
  assert.equal(persistence.listNpcJobs({ npcCharacterID: 1500000070 }).length, 1);

  const raised = persistence.applyNpcAssemblySignalCheckpoint({
    ...identity,
    sequence: 7,
    revision: 2,
    status: { activeFlags: ["FUEL_EMPTY"] },
    job: {
      ...job,
      payload: { severity: "critical" },
      priority: 100,
      step: "fuel-empty",
    },
    nowMs: 1_002,
  });
  assert.equal(raised.job.jobID, first.job.jobID);
  assert.equal(raised.job.recordRevision, 2);
  assert.equal(raised.job.payload.severity, "critical");
  assert.equal(raised.job.priority, 100);
  assert.equal(raised.cursor.lastAppliedSequence, 7);
  assert.equal(raised.cursor.lastAppliedRevision, 2);
  assert.throws(() => persistence.applyNpcAssemblySignalCheckpoint({
    ...identity,
    sequence: 6,
    revision: 3,
    status: { activeFlags: ["FUEL_LOW"] },
  }), /cannot move backwards/);
});

test("schema v1 roots created before signal cursors migrate without losing jobs", (t) => {
  fixture(t);
  persistence.initializeNpcRuntimePersistence({ reconcile: false });
  const job = persistence.createNpcJob({
    npcCharacterID: 1500000073,
    incarnation: 1,
    jobType: "resource.mine",
    idempotencyKey: "legacy-root-job",
  }).data;
  const legacy = persistence._testing.readRoot();
  delete legacy.assemblySignalCursors;
  legacy.checksum = "";
  legacy.checksum = persistence._testing.checksum(legacy);
  database.write("npcRuntimeState", "/", legacy, { force: true });
  database.flushTableSync("npcRuntimeState");
  persistence._testing.resetRuntimeForTests();
  persistence.initializeNpcRuntimePersistence({ reconcile: false });
  assert.equal(persistence.getNpcJob(job.jobID).idempotencyKey, "legacy-root-job");
  assert.equal(persistence.getPersistenceStatus().data.assemblySignalCursorCount, 0);
  assert.equal(persistence.applyNpcAssemblySignalCheckpoint({
    observerID: "command-node:900000705",
    assemblyID: 900000705,
    signalType: "network_node.resources",
    sequence: 1,
    revision: 1,
    status: { activeFlags: ["POWER_USAGE_LOW"] },
  }).success, true);
});

test("restart replay creates exactly one signal-derived job after observation", async (t) => {
  fixture(t);
  persistence.initializeNpcRuntimePersistence({ reconcile: false });
  const identity = {
    observerID: "command-node:900000701",
    assemblyID: 900000702,
    signalType: "network_node.resources",
  };
  const signal = {
    kind: "status_changed",
    sequence: 11,
    revision: 1,
    detail: {
      signalType: identity.signalType,
      current: { activeFlags: ["POWER_USAGE_HIGH"] },
    },
  };
  const listSignals = async (_assemblyID, options) => ({
    success: true,
    data: {
      oldestSequence: 11,
      nextSequence: options.afterSequence < 11 ? 11 : options.afterSequence,
      truncated: false,
      signals: options.afterSequence < 11 ? [signal] : [],
    },
  });
  // Reading the external journal is not an acknowledgement. Simulate a crash
  // immediately after that observation and before the atomic Phase 0 write.
  assert.equal((await listSignals(identity.assemblyID, { afterSequence: 0 })).data.signals.length, 1);
  assert.equal(persistence.getNpcAssemblySignalCursor(identity), null);
  persistence._testing.resetRuntimeForTests();
  persistence.initializeNpcRuntimePersistence({ reconcile: false });

  const options = {
    ...identity,
    listSignals,
    getOperationalStatus: async () => ({ success: true, data: null }),
    planObservation: async (observation) => ({
      npcCharacterID: 1500000071,
      incarnation: 1,
      jobType: "assembly.capacity",
      idempotencyKey: "capacity:900000702:active",
      target: { assemblyID: identity.assemblyID },
      payload: { observedRevision: observation.revision },
    }),
  };
  const recovered = await persistence.reconcileNpcAssemblySignalJournal(options);
  assert.equal(recovered.success, true);
  assert.equal(recovered.processed, 1);
  assert.equal(persistence.listNpcJobs({ npcCharacterID: 1500000071 }).length, 1);
  const repeated = await persistence.reconcileNpcAssemblySignalJournal(options);
  assert.equal(repeated.processed, 0);
  assert.equal(persistence.listNpcJobs({ npcCharacterID: 1500000071 }).length, 1);
  const cursor = persistence.getNpcAssemblySignalCursor(identity);
  assert.equal(cursor.lastScannedSequence, 11);
  assert.equal(cursor.lastAppliedSequence, 11);
});

test("truncated assembly journals resnapshot canonical status before advancing", async (t) => {
  fixture(t);
  persistence.initializeNpcRuntimePersistence({ reconcile: false });
  const identity = {
    observerID: "faction:500001-caldari",
    assemblyID: 900000703,
    signalType: "network_node.resources",
  };
  persistence.applyNpcAssemblySignalCheckpoint({
    ...identity,
    sequence: 2,
    revision: 1,
    status: { activeFlags: ["POWER_USAGE_LOW"] },
  });
  const reconciled = await persistence.reconcileNpcAssemblySignalJournal({
    ...identity,
    listSignals: async () => ({
      success: true,
      data: { oldestSequence: 40, nextSequence: 40, truncated: true, signals: [] },
    }),
    getOperationalStatus: async () => ({
      success: true,
      data: {
        assemblyID: identity.assemblyID,
        signalType: identity.signalType,
        revision: 9,
        updatedSequence: 44,
        status: { activeFlags: ["FUEL_EMPTY", "POWER_USAGE_OFFLINE"] },
      },
    }),
    planObservation: async (observation) => ({
      npcCharacterID: 1500000072,
      incarnation: 2,
      jobType: "resource.fuel",
      idempotencyKey: "network-node-fuel:900000703:active",
      payload: { mode: observation.mode },
    }),
  });
  assert.equal(reconciled.success, true);
  assert.equal(reconciled.resnapshotted, true);
  const cursor = persistence.getNpcAssemblySignalCursor(identity);
  assert.equal(cursor.lastAppliedSequence, 44);
  assert.equal(cursor.lastScannedSequence, 44);
  assert.equal(cursor.lastAppliedRevision, 9);
  assert.equal(cursor.lastMode, "resnapshot");
  assert.equal(cursor.resnapshotCount, 1);
  assert.equal(persistence.listNpcJobs({ npcCharacterID: 1500000072 }).length, 1);

  const unchangedIdentity = {
    observerID: "command-node:900000704",
    assemblyID: 900000704,
    signalType: "network_node.resources",
  };
  const unchangedStatus = { activeFlags: ["POWER_USAGE_LOW"] };
  persistence.applyNpcAssemblySignalCheckpoint({
    ...unchangedIdentity,
    sequence: 4,
    revision: 1,
    status: unchangedStatus,
  });
  const unchanged = await persistence.reconcileNpcAssemblySignalJournal({
    ...unchangedIdentity,
    listSignals: async () => ({
      success: true,
      data: { oldestSequence: 30, nextSequence: 30, truncated: true, signals: [] },
    }),
    getOperationalStatus: async () => ({
      success: true,
      data: { revision: 1, updatedSequence: 4, status: unchangedStatus },
    }),
  });
  assert.equal(unchanged.resnapshotted, true);
  assert.equal(unchanged.processed, 0);
  const unchangedCursor = persistence.getNpcAssemblySignalCursor(unchangedIdentity);
  assert.equal(unchangedCursor.lastAppliedSequence, 4);
  assert.equal(unchangedCursor.lastScannedSequence, 29);
  assert.equal(unchangedCursor.resnapshotCount, 1);
});

test("registered behavior leaves claim and complete durable jobs", (t) => {
  fixture(t);
  persistence.initializeNpcRuntimePersistence({ reconcile: false });
  const job = persistence.createNpcJob({
    npcCharacterID: 1500000002,
    incarnation: 1,
    jobType: "test.complete",
  }).data;
  const unregister = behaviorRuntime.registerNpcJobHandler("test.complete", (context) => ({
    status: behaviorRuntime.STATUS.SUCCESS,
    checkpoint: { observedEntityID: context.entity.itemID },
  }));
  t.after(unregister);
  const result = behaviorRuntime.tickDurableNpcJob(
    { systemID: 30000004 },
    { itemID: 980000000002, npcCharacterID: 1500000002, npcIncarnation: 1 },
    { entityID: 980000000002 },
    1_000,
  );
  assert.equal(result.handled, true);
  assert.equal(persistence.getNpcJob(job.jobID).status, "completed");
  assert.equal(persistence.getNpcJob(job.jobID).checkpoint.observedEntityID, 980000000002);
});

test("respawn incarnation changes retire stale work before accepting a successor job", (t) => {
  fixture(t);
  persistence.initializeNpcRuntimePersistence({ reconcile: false });
  const stale = persistence.createNpcJob({
    npcCharacterID: 1500000003,
    incarnation: 1,
    jobType: "travel.route",
  }).data;
  const retired = persistence.retireStaleNpcJobs(1500000003, 2);
  assert.equal(retired.data.length, 1);
  assert.equal(persistence.getNpcJob(stale.jobID).status, "cancelled");
  assert.equal(persistence.getNpcJob(stale.jobID).lastError, "NPC_JOB_STALE_INCARNATION");
  assert.equal(persistence.createNpcJob({
    npcCharacterID: 1500000003,
    incarnation: 2,
    jobType: "travel.route",
  }).success, true);
});

test("spawn leases are exclusive and are reclaimed across server generations", (t) => {
  fixture(t);
  persistence.initializeNpcRuntimePersistence({ reconcile: false });
  const lease = persistence.acquireSpawnLease({
    npcCharacterID: 1500000001,
    entityID: 980000000001,
    incarnation: 1,
  });
  assert.equal(lease.success, true);
  assert.equal(persistence.acquireSpawnLease({
    npcCharacterID: 1500000001,
    entityID: 980000000001,
    incarnation: 1,
  }).data.token, lease.data.token);
  assert.throws(() => persistence.acquireSpawnLease({
    npcCharacterID: 1500000001,
    entityID: 980000000002,
    incarnation: 2,
  }), /active spawn lease/);

  persistence._testing.resetRuntimeForTests();
  persistence.initializeNpcRuntimePersistence({ reconcile: false });
  assert.equal(persistence.acquireSpawnLease({
    npcCharacterID: 1500000001,
    entityID: 980000000002,
    incarnation: 2,
  }).success, true);
});

test("reconciliation quarantines orphaned durable controllers without deleting evidence", (t) => {
  fixture(t);
  nativeStore.upsertNativeController({
    entityID: 980000000040,
    systemID: 30000004,
    profileID: "missing-entity",
    transient: false,
  }, { durable: true });
  persistence.initializeNpcRuntimePersistence({ reconcile: false });
  const result = persistence.reconcileNativeNpcPersistence();
  assert.equal(result.data.quarantined, 1);
  assert.equal(persistence.isNpcEntityQuarantined(980000000040), true);
  assert.ok(nativeStore.getNativeController(980000000040));
});

test("reconciliation upgrades valid legacy NPC records to checksummed schema v1", (t) => {
  fixture(t);
  const entityID = 980000000045;
  database.write("npcEntities", "/", {
    nextEntityID: 980000000046,
    entities: {
      [entityID]: {
        entityID,
        systemID: 30000004,
        nativeNpc: true,
        transient: false,
      },
    },
  }, { force: true });
  database.write("npcRuntimeControllers", "/", {
    controllers: {
      [entityID]: {
        entityID,
        systemID: 30000004,
        profileID: "legacy-valid",
        transient: false,
      },
    },
  }, { force: true });
  database.flushTablesSync(["npcEntities", "npcRuntimeControllers"]);
  nativeStore.invalidateControllerCache();

  persistence.initializeNpcRuntimePersistence({ reconcile: false });
  const result = persistence.reconcileNativeNpcPersistence();
  assert.equal(result.success, true);
  assert.equal(result.data.migrated, 2);
  const entity = nativeStore.getNativeEntity(entityID);
  const controller = nativeStore.getNativeController(entityID);
  assert.equal(entity.schemaVersion, 1);
  assert.equal(controller.schemaVersion, 1);
  assert.match(entity.recordChecksum, /^[0-9a-f]{64}$/);
  assert.match(controller.recordChecksum, /^[0-9a-f]{64}$/);
  assert.equal(persistence._testing.verifyVersionedRecord(entity), null);
  assert.equal(persistence._testing.verifyVersionedRecord(controller), null);
});

test("an interrupted durable spawn is compensated exactly once on recovery", (t) => {
  fixture(t);
  persistence.initializeNpcRuntimePersistence({ reconcile: false });
  const operation = persistence.beginNpcOperation("spawn", "spawn:test:1", {
    entityID: 980000000050,
    incarnation: 1,
  }).data;
  nativeStore.upsertNativeEntity({
    entityID: 980000000050,
    systemID: 30000004,
    nativeNpc: true,
    transient: false,
  }, { durable: true });
  persistence.checkpointNpcOperation(operation.operationID, "entity-written", {}, {
    flushTables: ["npcEntities"],
  });

  persistence._testing.resetRuntimeForTests();
  persistence.initializeNpcRuntimePersistence();
  assert.equal(nativeStore.getNativeEntity(980000000050), null);
  const recovered = persistence._testing.readRoot().operations[operation.operationID];
  assert.equal(recovered.status, "compensated");
});

test("an interrupted destruction cascade is completed during recovery", (t) => {
  fixture(t);
  persistence.initializeNpcRuntimePersistence({ reconcile: false });
  const entityID = 980000000055;
  nativeStore.upsertNativeEntity({ entityID, systemID: 30000004, nativeNpc: true, transient: false }, { durable: true });
  nativeStore.upsertNativeController({ entityID, systemID: 30000004, profileID: "test", transient: false }, { durable: true });
  nativeStore.upsertNativeModule({ moduleID: 980100000055, entityID, ownerID: 1, typeID: 1 }, { durable: true });
  nativeStore.upsertNativeCargo({ cargoID: 980200000055, entityID, ownerID: 1, typeID: 2, quantity: 4 }, { durable: true });
  const operation = persistence.beginNpcOperation("destroy", "destroy:test:55", {
    entityID,
    destroyed: true,
  }).data;
  nativeStore.removeNativeModule(980100000055);
  database.flushTableSync("npcModules");
  persistence.checkpointNpcOperation(operation.operationID, "modules-removed");

  persistence._testing.resetRuntimeForTests();
  persistence.initializeNpcRuntimePersistence();
  assert.equal(nativeStore.getNativeEntity(entityID), null);
  assert.equal(nativeStore.getNativeController(entityID), null);
  assert.deepEqual(nativeStore.listNativeCargoForEntity(entityID), []);
  assert.equal(persistence._testing.readRoot().operations[operation.operationID].status, "committed");
});

test("verified logical snapshots detect corruption and can restore NPC tables", (t) => {
  fixture(t);
  persistence.initializeNpcRuntimePersistence({ reconcile: false });
  const signalIdentity = {
    observerID: "faction:500003-gallente",
    assemblyID: 900000760,
    signalType: "network_node.resources",
  };
  persistence.applyNpcAssemblySignalCheckpoint({
    ...signalIdentity,
    sequence: 3,
    revision: 1,
    status: { activeFlags: ["FUEL_LOW"] },
  });
  nativeStore.upsertNativeEntity({
    entityID: 980000000060,
    systemID: 30000004,
    nativeNpc: true,
    transient: false,
  }, { durable: true });
  nativeStore.upsertNativeWreck({
    wreckID: 980300000060,
    systemID: 30000004,
    ownerID: 1,
    typeID: 3,
    transient: false,
  }, { durable: true });
  nativeStore.upsertNativeWreckItem({
    wreckItemID: 980400000060,
    wreckID: 980300000060,
    ownerID: 1,
    typeID: 4,
    quantity: 2,
    transient: false,
  }, { durable: true });
  const snapshot = persistence.createVerifiedSnapshot("test").data;
  assert.equal(persistence.readVerifiedSnapshot(snapshot.snapshotID).success, true);
  assert.equal(
    persistence.readVerifiedSnapshot(snapshot.snapshotID).data.runtime
      .assemblySignalCursors[persistence.getNpcAssemblySignalCursor(signalIdentity).cursorID]
      .lastAppliedSequence,
    3,
  );
  persistence.applyNpcAssemblySignalCheckpoint({
    ...signalIdentity,
    sequence: 4,
    revision: 2,
    status: { activeFlags: ["FUEL_EMPTY"] },
  });
  nativeStore.removeNativeEntity(980000000060);
  nativeStore.removeNativeWreckCascade(980300000060);
  database.flushTablesSync(["npcEntities", "npcWrecks", "npcWreckItems"]);
  assert.equal(nativeStore.getNativeEntity(980000000060), null);
  assert.equal(nativeStore.getNativeWreck(980300000060), null);
  assert.equal(persistence.restoreVerifiedSnapshot(snapshot.snapshotID, { force: true }).success, true);
  assert.ok(nativeStore.getNativeEntity(980000000060));
  assert.ok(nativeStore.getNativeWreck(980300000060));
  assert.ok(nativeStore.getNativeWreckItem(980400000060));
  assert.equal(persistence.getNpcAssemblySignalCursor(signalIdentity).lastAppliedSequence, 3);
  const root = persistence._testing.readRoot();
  const stored = root.snapshots.find((entry) => entry.snapshotID === snapshot.snapshotID);
  const replacement = stored.payload[16] === "A" ? "B" : "A";
  stored.payload = `${stored.payload.slice(0, 16)}${replacement}${stored.payload.slice(17)}`;
  root.checksum = "";
  root.checksum = persistence._testing.checksum(root);
  database.write("npcRuntimeState", "/", root, { force: true });
  database.flushTableSync("npcRuntimeState");
  assert.equal(persistence.readVerifiedSnapshot(snapshot.snapshotID).errorMsg, "NPC_SNAPSHOT_CORRUPT");
});

test("new server processes recover every crash-staged spawn journal boundary", (t) => {
  fixture(t);
  const repoRoot = path.resolve(__dirname, "../..");
  const boundaries = [
    "prepared",
    "entity-written",
    "modules-written",
    "cargo-written",
    "controller-written",
  ];
  for (const [index, boundary] of boundaries.entries()) {
    const entityID = 980000000070 + index;
    const moduleID = 980100000070 + index;
    const cargoID = 980200000070 + index;
    const rank = boundaries.indexOf(boundary);
    const stage = spawnSync(process.execPath, ["-e", [
      "const p=require('./server/src/space/npc/npcRuntimePersistence');",
      "const s=require('./server/src/space/npc/nativeNpcStore');",
      "p.initializeNpcRuntimePersistence({reconcile:false});",
      `const op=p.beginNpcOperation('spawn','spawn:subprocess:${entityID}',{entityID:${entityID},incarnation:1,expectedModuleIDs:[],expectedCargoIDs:[]}).data;`,
      rank >= 1
        ? `s.upsertNativeEntity({entityID:${entityID},systemID:30000004,nativeNpc:true,transient:false},{durable:true});p.checkpointNpcOperation(op.operationID,'entity-written',{}, {flushTables:['npcEntities']});`
        : "",
      rank >= 2
        ? `s.upsertNativeModule({moduleID:${moduleID},entityID:${entityID},ownerID:1,typeID:1},{durable:true});p.checkpointNpcOperation(op.operationID,'modules-written',{expectedModuleIDs:[${moduleID}]},{flushTables:['npcModules']});`
        : "",
      rank >= 3
        ? `s.upsertNativeCargo({cargoID:${cargoID},entityID:${entityID},ownerID:1,typeID:2,quantity:4},{durable:true});p.checkpointNpcOperation(op.operationID,'cargo-written',{expectedCargoIDs:[${cargoID}]},{flushTables:['npcCargo']});`
        : "",
      rank >= 4
        ? `s.upsertNativeController({entityID:${entityID},systemID:30000004,profileID:'crash-boundary',transient:false},{durable:true});p.checkpointNpcOperation(op.operationID,'controller-written',{}, {flushTables:['npcRuntimeControllers']});`
        : "",
      "process.stdout.write('STAGED:'+op.operationID+'\\n');",
      "process.exit(71);",
    ].join("")], {
      cwd: repoRoot,
      env: process.env,
      encoding: "utf8",
    });
    assert.equal(stage.status, 71, `${boundary}: ${stage.stderr}`);
    const operationID = stage.stdout.match(/STAGED:([0-9a-f-]+)/)?.[1];
    assert.ok(operationID, boundary);

    const recover = spawnSync(process.execPath, ["-e", [
      "const p=require('./server/src/space/npc/npcRuntimePersistence');",
      "const s=require('./server/src/space/npc/nativeNpcStore');",
      "p.initializeNpcRuntimePersistence();",
      `const op=p._testing.readRoot().operations['${operationID}'];`,
      `process.stdout.write('RESULT:'+JSON.stringify({entity:Boolean(s.getNativeEntity(${entityID})),status:op.status})+'\\n');`,
    ].join("")], {
      cwd: repoRoot,
      env: process.env,
      encoding: "utf8",
    });
    assert.equal(recover.status, 0, `${boundary}: ${recover.stderr}`);
    const result = JSON.parse(recover.stdout.match(/RESULT:(\{.*\})/)?.[1] || "null");
    assert.deepEqual(
      result,
      boundary === "controller-written"
        ? { entity: true, status: "committed" }
        : { entity: false, status: "compensated" },
      boundary,
    );
  }
});
