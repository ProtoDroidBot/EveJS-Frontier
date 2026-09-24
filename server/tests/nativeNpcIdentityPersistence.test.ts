"use strict";

const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const test = require("node:test");
const database = require("../src/gameStore");
const sqliteStore = require("../src/gameStore/sqliteStore");
const nativeNpcStore = require("../src/space/npc/nativeNpcStore");
const { getNpcPilotIdentityStore } = require("../src/space/npc/npcPilotIdentityStore");

function restoreTablesAfter(t, tables) {
  const originals = tables.map(table => [table, structuredClone(database.read(table, "/").data || {})]);
  t.after(() => {
    for (const [table, value] of originals) database.write(table, "/", value, { force: true });
    database.flushTablesSync(tables);
  });
}

test("native transient and durable entities share a persistent allocation cursor", (t) => {
  restoreTablesAfter(t, ["npcEntities"]);
  const first = nativeNpcStore.allocateEntityID({ transient: true });
  const second = nativeNpcStore.allocateEntityID();
  const third = nativeNpcStore.allocateEntityID({ transient: true });
  assert.equal(first.success && second.success && third.success, true);
  assert.equal(second.data, first.data + 1);
  assert.equal(third.data, second.data + 1);
  assert.equal(nativeNpcStore.upsertNativeEntity({
    entityID: first.data, systemID: 30000001, transient: true,
  }, { transient: true }).success, true);
  t.after(() => database.setTransientPath("npcEntities", `/entities/${first.data}`, false));
  assert.equal(database.flushTablesSync(["npcEntities"]).success, true);
  const persisted = sqliteStore.loadTableObject("npcEntities");
  assert.equal(persisted.nextEntityID, third.data + 1);
  assert.equal(persisted.entities?.[first.data], undefined);

  // A new process has no access to this process's module state or cached rows.
  const probe = spawnSync(process.execPath, ["-e", [
    "const store = require('./server/src/space/npc/nativeNpcStore');",
    "const result = store.allocateEntityID({ transient: true });",
    "if (!result.success) throw new Error(result.errorMsg);",
    "process.stdout.write(JSON.stringify(result.data));",
  ].join("\n")], {
    cwd: require("node:path").resolve(__dirname, "../.."),
    env: process.env,
    encoding: "utf8",
  });
  assert.equal(probe.status, 0, probe.stderr);
  assert.equal(Number(probe.stdout.trim()), third.data + 1);
});

test("durable NPC state survives a clean process restart", (t) => {
  restoreTablesAfter(t, [
    "npcRuntimeState", "npcEntities", "npcModules", "npcCargo", "npcRuntimeControllers",
  ]);
  const repoRoot = require("node:path").resolve(__dirname, "../..");
  const entityID = 980000000987;
  const moduleID = 980100000987;
  const cargoID = 980200000987;
  const stage = spawnSync(process.execPath, ["-e", [
    "const assert=require('node:assert/strict');",
    "const store=require('./server/src/space/npc/nativeNpcStore');",
    "const service=require('./server/src/space/npc/nativeNpcService');",
    "const persistence=require('./server/src/space/npc/npcRuntimePersistence');",
    "persistence.initializeNpcRuntimePersistence({reconcile:false});",
    `assert.equal(store.upsertNativeEntity({entityID:${entityID},systemID:30000004,nativeNpc:true,transient:false,typeID:72207,categoryID:11,factionID:500025,position:{x:1,y:2,z:3}},{durable:true}).success,true);`,
    `assert.equal(store.upsertNativeModule({moduleID:${moduleID},entityID:${entityID},ownerID:500025,typeID:12345,flagID:27,moduleState:{active:true}},{durable:true}).success,true);`,
    `assert.equal(store.upsertNativeCargo({cargoID:${cargoID},entityID:${entityID},ownerID:500025,typeID:54321,quantity:7},{durable:true}).success,true);`,
    `assert.equal(store.upsertNativeController({entityID:${entityID},systemID:30000004,transient:false,profileID:'restart-probe',manualOrder:{type:'approach',targetEntityID:76543},behaviorOverrides:{aggressive:false}},{durable:true}).success,true);`,
    `assert.equal(service.persistNativeRuntimeEntity({itemID:${entityID},nativeNpc:true,position:{x:45000,y:-12000,z:900},velocity:{x:30,y:4,z:-2},direction:{x:0,y:1,z:0},targetPoint:{x:46000,y:-12000,z:900},mode:'GOTO',speedFraction:0.65,targetEntityID:76543,conditionState:{shieldCharge:0.28,armorDamage:0.36,damage:0.19}}).success,true);`,
    "assert.equal(service.checkpointAllNativeRuntimeState({reason:'restart-probe'}).success,true);",
    "process.stdout.write('STAGED\\n');",
    "process.exit(0);",
  ].join("\n")], {
    cwd: repoRoot, env: process.env, encoding: "utf8",
  });
  assert.equal(stage.status, 0, stage.stderr);
  assert.match(stage.stdout, /STAGED/);

  const restarted = spawnSync(process.execPath, ["-e", [
    "const store=require('./server/src/space/npc/nativeNpcStore');",
    "const persistence=require('./server/src/space/npc/npcRuntimePersistence');",
    "const status=persistence.initializeNpcRuntimePersistence();",
    `const entity=store.getNativeEntity(${entityID});`,
    `const module=store.getNativeModule(${moduleID});`,
    `const cargo=store.getNativeCargo(${cargoID});`,
    `const controller=store.getNativeController(${entityID});`,
    `process.stdout.write('RESTORED:'+JSON.stringify({entityID:entity?.entityID,position:entity?.position,velocity:entity?.velocity,mode:entity?.mode,conditionState:entity?.conditionState,targetEntityID:entity?.targetEntityID,moduleID:module?.moduleID,moduleState:module?.moduleState,cargoID:cargo?.cargoID,quantity:cargo?.quantity,manualOrder:controller?.manualOrder,quarantined:persistence.isNpcEntityQuarantined(${entityID}),previousCleanShutdown:status.data.server.previousCleanShutdown,snapshotCount:status.data.snapshotCount})+'\\n');`,
  ].join("\n")], {
    cwd: repoRoot, env: process.env, encoding: "utf8",
  });
  assert.equal(restarted.status, 0, restarted.stderr);
  const restored = JSON.parse(restarted.stdout.match(/RESTORED:(\{.*\})/)?.[1] || "null");
  assert.ok(restored.snapshotCount >= 1);
  delete restored.snapshotCount;
  assert.deepEqual(restored, {
    entityID,
    position: { x: 45_000, y: -12_000, z: 900 },
    velocity: { x: 30, y: 4, z: -2 },
    mode: "GOTO",
    conditionState: { shieldCharge: 0.28, armorDamage: 0.36, damage: 0.19 },
    targetEntityID: 76543,
    moduleID,
    moduleState: { active: true },
    cargoID,
    quantity: 7,
    manualOrder: { type: "approach", targetEntityID: 76543 },
    quarantined: false,
    previousCleanShutdown: true,
  });
});

test("native module, cargo and wreck allocations use the same cursor across persistence modes", (t) => {
  const cases = [
    ["npcModules", "nextModuleID", "allocateModuleID"],
    ["npcCargo", "nextCargoID", "allocateCargoID"],
    ["npcWrecks", "nextWreckID", "allocateWreckID"],
    ["npcWreckItems", "nextWreckItemID", "allocateWreckItemID"],
  ];
  restoreTablesAfter(t, cases.map(([table]) => table));
  for (const [table, counter, method] of cases) {
    const first = nativeNpcStore[method]({ transient: true });
    const second = nativeNpcStore[method]();
    assert.equal(first.success && second.success, true);
    assert.equal(second.data, first.data + 1);
    assert.equal(database.flushTablesSync([table]).success, true);
    assert.equal(sqliteStore.loadTableObject(table)[counter], second.data + 1);
  }
});

test("native death releases the pilot lease once and respawn retains the identity", (t) => {
  restoreTablesAfter(t, ["npcEntities", "npcModules", "npcCargo", "npcRuntimeControllers", "npcPilotIdentities"]);
  const pilots = getNpcPilotIdentityStore();
  const entityID = nativeNpcStore.allocateEntityID().data;
  const identityInput = {
    entityID,
    systemID: 30000001,
    factionID: 500012,
    factionStringOnlyID: "blood-raiders",
    identitySlot: "native-cascade-regression",
    characterName: "Identity test NPC",
  };
  const pilot = pilots.acquire(identityInput);
  nativeNpcStore.upsertNativeEntity({ entityID, systemID: identityInput.systemID, npcCharacterID: pilot.characterID });
  assert.equal(nativeNpcStore.removeNativeEntityCascade(entityID, { destroyed: true }).success, true);
  assert.equal(nativeNpcStore.getNativeEntity(entityID), null);
  assert.equal(pilots.get(pilot.characterID).activeEntityID, null);
  assert.equal(pilots.get(pilot.characterID).deaths, pilot.deaths + 1);
  nativeNpcStore.removeNativeEntityCascade(entityID, { destroyed: true });
  assert.equal(pilots.get(pilot.characterID).deaths, pilot.deaths + 1);

  const successorID = nativeNpcStore.allocateEntityID().data;
  const successor = pilots.acquire({ ...identityInput, entityID: successorID });
  nativeNpcStore.upsertNativeEntity({ entityID: successorID, systemID: identityInput.systemID, npcCharacterID: successor.characterID });
  assert.equal(successor.characterID, pilot.characterID);
  assert.equal(successor.incarnation, pilot.incarnation + 1);
  nativeNpcStore.removeNativeEntityCascade(entityID, { destroyed: true });
  assert.equal(pilots.get(pilot.characterID).activeEntityID, successorID);
  nativeNpcStore.removeNativeEntityCascade(successorID);
  assert.equal(pilots.get(pilot.characterID).activeEntityID, null);
  assert.equal(pilots.get(pilot.characterID).deaths, pilot.deaths + 1);
});
