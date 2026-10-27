"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const Database = require("better-sqlite3");
const config = require("../src/config");
const database = require("../src/gameStore");
const { createTableRepository } = require("../src/gameStore/tableRepository");
const inventory = require("../src/services/inventory/itemStore");
const progression = require("../src/services/frontier/progressionRuntime");
const equipment = require("../src/services/frontier/shellEquipmentRuntime");
const environment = require("../src/services/frontier/environmentalEffectsService");
const { marshalEncode } = require("../src/network/tcp/utils/marshal");
const Experience = require("../src/services/frontier/experienceService");
const ShellManager = require("../src/services/frontier/shellManagerService");
const Skills = require("../src/services/frontier/skillsMgrService");
const { buildProgressionDogma } = require("../src/services/frontier/progressionDogma");
const liveFitting = require("../src/services/fitting/liveFittingState");
const id = 140999995, stationID = 60000001;
const notifications = [];
const session = { characterID: id, charid: id, stationID, stationid: stationID, sendNotification: (...args) => notifications.push(args) };
const before = { clientBuild: config.clientBuild, policy: config.frontierProgressionPolicy };
const repo = createTableRepository("service:inventory", { strict: true });
const domain = createTableRepository("service:frontier-progression", { strict: true });

test.before(() => {
  config.clientBuild = 3640684;
  config.frontierProgressionPolicy = { activityWeights: { extraction: { memoryCategoryID: 9, skillWeights: { 10: 1 }, xpPerUnit: 1 }, piloting: { memoryCategoryID: 2, skillWeights: { 1: 1 }, xpPerUnit: 1 } }, founderCharacterIDs: [id], shellCreation: { 91969: { enabled: true, materials: [] } } };
  database.ensureTable("characters"); repo.ensureTable("items"); domain.ensureTable(progression.TABLE);
  database.write("characters", `/${id}`, { characterID: id, accountId: 1, stationID });
  database.flushAllSync();
});

test("native services mint a real crown from earned memories and implant it atomically into active shell inventory", () => {
  const shells = new ShellManager(), experience = new Experience();
  const result = shells.Handle_get_active_shell_db_data([], session);
  assert.ok(result); const shell = equipment.getActiveShell(id); assert.ok(shell);
  assert.equal(progression.recordActivity(session, { eventID: "actual-mining-cycle-1", eventKind: "extraction", amount: 1000000 }).success, true);
  const memoryID = Number(Object.keys(progression.getRuntime().getState(id).memories)[0]);
  assert.equal(experience.Handle_ascend([[memoryID]], session), true);
  const crownID = shells.Handle_create_crown([[memoryID]], session);
  assert.equal(inventory.findItemById(crownID).typeID, 92437);
  assert.equal(shells.Handle_implant_crown([crownID], session), true);
  assert.equal(inventory.findItemById(crownID).locationID, shell.itemID);
  assert.equal(inventory.findItemById(crownID).flagID, 89);
  const split = new Skills().Handle_get_complexity_split([], session);
  assert.ok(split.entries[0][1].entries.some(([skillID, value]) => skillID === 10 && value > 0));
  for (const response of [split, experience.Handle_get_memories_from_shell([], session), shells.Handle_get_active_shell_db_data([], session), shells.Handle_get_last_crown_created_time([], session)]) assert.doesNotThrow(() => marshalEncode(response, { compatibilityProfile: "frontier" }));
  assert.ok(notifications.some(row => row[0] === "OnCrownImplanted" && row[2][0] === crownID));
});

test("real SQLite treatment rollback preserves kit, injury and notifications; successful retry persists across process restart", () => {
  const runtime = progression.getRuntime();
  const shell = equipment.getActiveShell(id);
  const damaged = { vitality: 60, vitalityCapacity: 100, feralization: 0, temporalDrift: 0, cloneDeathTriggered: false, effects: { heat: { active: false, armed: false, grace: 0, damageExposureSeconds: 0 }, feralization: { active: false, armed: false, grace: 0, damageExposureSeconds: 0 }, temporal_drift: { active: false, armed: false, grace: 0, damageExposureSeconds: 0 } } };
  assert.equal(runtime.saveEnvironment(id, damaged, { heat: 40 }).success, true);
  environment.resetCharacterState(id);
  assert.equal(environment.snapshotCharacterState(id).vitality, 60);
  const grant = inventory.grantItemToCharacterLocation(id, stationID, 4, 95339, 1);
  assert.equal(grant.success, true, grant.errorMsg); const kitID = grant.data.items[0].itemID;
  assert.equal(database.flushAllSync().success, true);
  const connection = new Database(database._sqliteDbPath);
  try {
    connection.exec(`CREATE TRIGGER progression_test_fail_kit BEFORE DELETE ON items WHEN OLD.key = '${kitID}' BEGIN SELECT RAISE(ABORT, 'injected kit delete failure'); END`);
    const count = notifications.length;
    assert.equal(runtime.treat(session, kitID, false).success, false);
    assert.ok(inventory.findItemById(kitID)); assert.equal(runtime.medical(id).vitality, 60); assert.equal(environment.snapshotCharacterState(id).vitality, 60); assert.equal(notifications.length, count);
    connection.exec("DROP TRIGGER progression_test_fail_kit");
    assert.equal(new ShellManager().Handle_use_medical_kit([kitID], session), true);
    assert.equal(inventory.findItemById(kitID), null); assert.equal(runtime.medical(id).vitality, 100); assert.equal(environment.snapshotCharacterState(id).vitality, 100);
    const output = path.join(process.env.EVEJS_TEST_STORE_ROOT, "progression-restart-result.json");
    const child = spawnSync(process.execPath, ["-e", `const db=require('./server/src/gameStore');const state=db.read('frontierProgressionState','/c:${id}').data;require('node:fs').writeFileSync(${JSON.stringify(output)},JSON.stringify({medical:state.medical[${shell.itemID}].vitality,kit:db.read('items','/${kitID}').data}));db._closeSqliteForTests();`], { cwd: path.resolve(__dirname, "../.."), env: process.env, encoding: "utf8" });
    assert.equal(child.status, 0, child.stderr);
    assert.deepEqual(JSON.parse(fs.readFileSync(output, "utf8")), { medical: 100, kit: null });
  } finally { connection.close(); }
});

test("verified Frontier skills affect ship and fitted module dogma through existing evaluators exactly once", () => {
  const modifiers = buildProgressionDogma({ inherited: { 1: 40, 10: 50 }, acquired: { 1: 60, 10: 50 } });
  const attributes = { 600: 10, 70: 10 };
  liveFitting.applyModifierGroups(attributes, modifiers.direct);
  assert.ok(Math.abs(attributes[600] - 12) < 1e-9);
  assert.ok(Math.abs(attributes[70] - 9.2) < 1e-9);
  const entries = [];
  for (const source of modifiers.sources) liveFitting.appendLocationModifierEntries(entries, source.sourceAttributes, source.sourceEffects, source.sourceKind, { typeID: 1, groupID: 1 });
  const mining = { 5803: 1 };
  liveFitting.applyModifierGroups(mining, entries);
  assert.ok(Math.abs(mining[5803] - 1.1) < 1e-9);
  assert.equal(modifiers.attributes[6420], 100);
  assert.equal(modifiers.attributes[6444], 10);
});

test("achievement and broadcast notices encode exact descriptor fields and target only the authenticated character", () => {
  const { createProgressionNoticePublisher } = require("../src/_secondary/express/gatewayServices/progressionGatewayNotices");
  const published = [];
  const publish = createProgressionNoticePublisher((...args) => published.push(args));
  publish(session, "eve_public.achievement.CompletedNotice", { message: "ok" });
  publish(session, "eve_public.broadcast.api.UploadSucceededNotice", {});
  publish(session, "eve_public.broadcast.api.UploadFailedNotice", { reason: 1 });
  assert.equal(published[0][1].toString("hex"), "0a026f6b");
  assert.equal(published[1][1].length, 0); assert.equal(published[2][1].toString("hex"), "0801");
  for (const entry of published) assert.deepEqual(entry[2], { character: id });
  assert.throws(() => publish({}, "eve_public.achievement.CompletedNotice", { message: "bad" }));
  assert.throws(() => publish(session, "eve_public.broadcast.api.UploadFailedNotice", { reason: "bad" }));
});

test.after(() => {
  config.clientBuild = before.clientBuild; config.frontierProgressionPolicy = before.policy;
  database.flushAllSync(); database._closeSqliteForTests(); database._shutdownPersistenceWorkerForTests();
});
