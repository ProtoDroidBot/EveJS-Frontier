import assert = require("node:assert/strict");
import test = require("node:test");
import fs = require("node:fs");
import path = require("node:path");
import { spawnSync } from "node:child_process";

const config = require("../src/config");
const database = require("../src/gameStore");
const characterState = require("../src/services/character/characterState");
const AchievementService = require("../src/services/character/achievementTrackerMgrService");
const MonolithService = require("../src/services/character/monolithTaskTrackerMgrService");
const { marshalEncode, marshalDecode } = require("../src/network/tcp/utils/marshal");
const TIME = 134377517707280001n;
const originalConfig = { clientBuild: config.clientBuild, clientBuildProfile: config.clientBuildProfile,
  clientCompatibilityProfile: config.clientCompatibilityProfile };
test.beforeEach(() => Object.assign(config, { clientBuild: 2703993, clientBuildProfile: "frontier-2703993", clientCompatibilityProfile: "frontier" }));
test.afterEach(() => Object.assign(config, originalConfig));

function wire(value) { return marshalDecode(marshalEncode(value)); }
function entries(value): Map<any, any> {
  return new Map((value?.entries || []).map(([key, item]) => [Buffer.isBuffer(key) ? key.toString() : key, item]));
}
function maps(service, session) {
  const result = entries(wire(service.callMethod("GetCompletedAchievementsAndClientEventCount", [], session)));
  return { events: entries(result.get("eventDict")), completed: entries(result.get("completedDict")) };
}
function wrapped(error) {
  return error?.machoErrorResponse?.payload?.header?.[1]?.[0] === "CustomInfo";
}
function fixture(t, state = {}) {
  const characterID = 140000001;
  const record = characterState.getCharacterRecord(characterID);
  if (!record) { t.skip("requires an isolated baseline with seeded characters"); return null; }
  assert.equal(characterState.updateCharacterRecord(characterID, current => ({ ...current, achievementState: state })).success, true);
  characterState.getCharacterRecord(characterID);
  assert.equal(database.flushTableSync("characters").success, true);
  return { characterID, session: { userid: Number(record.accountId), characterID, charid: characterID,
    compatibilityProfile: "frontier", achievementState: { hasEverWarped: true } } };
}
function update(service, session, completed, statistics) {
  return service.callMethod("UpdateClientAchievmentsAndCounters", [completed, statistics], session);
}

test("exact legacy initial progress is empty while modern, explicit TQ and monolith retain compatibility defaults", () => {
  const service = new AchievementService();
  const noCharacter = { characterID: 0, charid: 0, compatibilityProfile: "frontier" };
  assert.equal(maps(service, noCharacter).events.size, 0);
  assert.equal(maps(service, noCharacter).completed.size, 0);
  assert.ok(maps(service, { ...noCharacter, compatibilityProfile: "tranquility" }).events.size > 0);
  assert.ok(maps(new MonolithService(), noCharacter).completed.size > 0);
  Object.assign(config, { clientBuild: 3640684, clientBuildProfile: "frontier-3640684" });
  assert.ok(maps(service, noCharacter).events.size > 0);
});

test("absolute achievement snapshots commit durable lossless progress and replay without increments", t => {
  const f = fixture(t, { hasEverWarped: true, firstWarpCompletedAt: "123" });
  if (!f) return;
  const service = new AchievementService();
  const initialResponse = service.Handle_GetCompletedAchievementsAndClientEventCount([], f.session);
  const initial = wire(initialResponse);
  const completed = { type: "dict", entries: [[9, TIME]] };
  const statistics = { type: "dict", entries: [[Buffer.from("client_spinCamera"), 7], ["client_openMap", 2n]] };
  const beforeCache = f.session.achievementState;
  const commit = database.commitAtomicRowWrites;
  t.mock.method(database, "commitAtomicRowWrites", proposals => {
    assert.equal(f.session.achievementState, beforeCache, "session cache must wait for durable commit");
    return commit(proposals);
  });
  assert.equal(update(service, f.session, completed, statistics), null);
  t.mock.restoreAll();
  const updatedResponse = service.Handle_GetCompletedAchievementsAndClientEventCount([], f.session);
  const afterUpdate = wire(updatedResponse);
  assert.equal(update(new AchievementService(), f.session, completed, statistics), null);
  const replayResponse = new AchievementService().Handle_GetCompletedAchievementsAndClientEventCount([], f.session);
  const afterReplay = wire(replayResponse);
  assert.deepEqual(afterReplay, afterUpdate);
  const stored = characterState.getCharacterRecord(f.characterID).achievementState;
  assert.equal(stored.completedDict["9"], TIME.toString());
  assert.equal(typeof stored.completedDict["9"], "string");
  assert.equal(stored.eventDict.client_spinCamera, 7);
  assert.equal(stored.hasEverWarped, true);
  assert.equal(stored.firstWarpCompletedAt, "123");

  const coldSession = { userid: f.session.userid, characterID: f.characterID,
    charid: f.characterID, compatibilityProfile: "frontier" };
  const script = `
    const config=require('./server/src/config');
    Object.assign(config,{clientBuild:2703993,clientBuildProfile:'frontier-2703993',clientCompatibilityProfile:'frontier'});
    const Service=require('./server/src/services/character/achievementTrackerMgrService');
    const result=new Service().Handle_GetCompletedAchievementsAndClientEventCount([],${JSON.stringify(coldSession)});
    console.log('ACHIEVEMENT_COLD_READ='+JSON.stringify(result,(_,v)=>typeof v==='bigint'?v.toString():v));
  `;
  const child = spawnSync(process.execPath, ["-r", path.resolve(__dirname, "helpers/isolatedGameStore.js"), "-e", script], {
    cwd: path.resolve(__dirname, "../.."), env: { ...process.env }, encoding: "utf8", timeout: 30000,
  });
  assert.equal(child.status, 0, child.error?.message || child.stderr);
  const receipt = child.stdout.split(/\r?\n/).find(line => line.startsWith("ACHIEVEMENT_COLD_READ="));
  assert.ok(receipt, child.stdout);
  const cold = JSON.parse(receipt.slice("ACHIEVEMENT_COLD_READ=".length));
  const coldMaps = entries(cold);
  assert.equal(entries(coldMaps.get("eventDict")).get("client_spinCamera"), 7);
  assert.equal(entries(coldMaps.get("completedDict")).get(9), TIME.toString());

  const directory = process.env.EVEJS_SERVICE_CALL_EVIDENCE_DIR;
  if (directory) {
    fs.mkdirSync(path.resolve(directory), { recursive: true });
    fs.writeFileSync(path.join(path.resolve(directory), "achievement-server-payload.json"), JSON.stringify({
      build: 2703993, initial, afterUpdate, afterReplay,
      updateArgs: [wire(completed), wire(statistics)], updateResult: null,
      initialWireBase64: marshalEncode(initialResponse).toString("base64"),
      afterUpdateWireBase64: marshalEncode(updatedResponse).toString("base64"),
      afterReplayWireBase64: marshalEncode(replayResponse).toString("base64"),
      coldRead: cold,
    }, (_, value) => typeof value === "bigint" ? value.toString() : value, 2) + "\n");
  }
});

test("partial and stale snapshots preserve maxima, earlier completions and first-warp state", t => {
  const f = fixture(t, { eventDict: { client_spinCamera: 8, client_openMap: 3 },
    completedDict: { "9": TIME.toString() }, hasEverWarped: true });
  if (!f) return;
  const service = new AchievementService();
  assert.equal(update(service, f.session, new Map([[9, TIME + 100n], [10, TIME + 200n]]),
    Object.assign(Object.create(null), { client_spinCamera: 5, client_chatMessageSent: 1 })), null);
  const result = maps(new MonolithService(), { ...f.session, achievementState: { hasEverWarped: true } });
  assert.equal(result.events.get("client_spinCamera"), 8);
  assert.equal(result.events.get("client_openMap"), 3);
  assert.equal(result.events.get("client_chatMessageSent"), 1);
  assert.equal(result.completed.get(9), TIME);
  assert.equal(result.completed.get(10), TIME + 200n);
  assert.equal(new MonolithService().Handle_HasEverWarped([], f.session), true);
  assert.equal(update(service, { ...f.session, characterID: 0 }, {}, { client_spinCamera: 9 }), null);
  assert.equal(maps(service, f.session).events.get("client_spinCamera"), 9);
});

test("achievement mutations require the selected authenticated owner and reject contradictory identities", t => {
  const f = fixture(t);
  if (!f) return;
  const otherID = characterState.listCharacterIDs().find(id =>
    Number(characterState.getCharacterRecord(id).accountId) !== f.session.userid);
  assert.ok(otherID, "test baseline must contain a second owner");
  const other = characterState.getCharacterRecord(otherID);
  const before = JSON.stringify(database.read("characters", "/").data);
  const service = new AchievementService();
  for (const session of [null, {}, { userid: f.session.userid },
    { ...f.session, userid: undefined }, { ...f.session, userid: 0 },
    { ...f.session, userid: other.accountId }, { ...f.session, charid: otherID },
    { ...f.session, characterID: 0, charid: 0 }, { ...f.session, charid: -1 },
    { ...f.session, _characterControlDisconnected: true }]) {
    assert.throws(() => update(service, session, {}, { client_spinCamera: 1 }), wrapped);
  }
  assert.throws(() => service.Handle_GetCompletedAchievementsAndClientEventCount([], { ...f.session, userid: other.accountId }), wrapped);
  assert.equal(JSON.stringify(database.read("characters", "/").data), before);
});

test("malformed complete payloads reject without partial character or session updates", t => {
  const f = fixture(t, { eventDict: { client_spinCamera: 2 }, completedDict: {} });
  if (!f) return;
  const before = JSON.stringify(database.read("characters", `/${f.characterID}`).data);
  const cache = f.session.achievementState;
  const service = new AchievementService();
  const bad = [
    [], [{}], [{ 0: TIME }, {}], [{ 9: -1n }, {}], [{ 9: Number(TIME) }, {}], [{ 9: 1n << 63n }, {}],
    [{ 9: "not-a-time" }, {}], [[], {}], [{}, { client_spinCamera: -1 }],
    [{}, { client_spinCamera: 1.5 }], [{}, { client_spinCamera: Number.NaN }],
    [{}, { client_spinCamera: Number.POSITIVE_INFINITY }], [{}, { client_spinCamera: Number.MAX_SAFE_INTEGER + 1 }],
    [{}, { client_spinCamera: "7" }], [{}, { "": 1 }], [{}, { "bad\u0000key": 1 }],
    [{}, new Map([[1, 2]])],
    [{ type: "dict", entries: [[9, TIME], [9, TIME + 1n]] }, {}],
    [{}, { type: "dict", entries: [["client_spinCamera", 1], [Buffer.from("client_spinCamera"), 2]] }],
    [{ 9: TIME }, { client_spinCamera: false }],
  ];
  for (const payload of bad) assert.throws(() => service.Handle_UpdateClientAchievmentsAndCounters(payload, f.session), wrapped);
  assert.equal(JSON.stringify(database.read("characters", `/${f.characterID}`).data), before);
  assert.equal(f.session.achievementState, cache);
});

test("failed atomic saves fail explicitly and preserve both stored progress and warm session cache", t => {
  const f = fixture(t, { eventDict: { client_spinCamera: 4 }, completedDict: {} });
  if (!f) return;
  const before = JSON.stringify(database.read("characters", `/${f.characterID}`).data);
  const cache = f.session.achievementState;
  const service = new AchievementService();
  const failure = t.mock.method(database, "commitAtomicRowWrites", () => ({ success: false, errorMsg: "TEST_DISK_ERROR" }));
  assert.throws(() => update(service, f.session, { 9: TIME }, { client_spinCamera: 8 }), wrapped);
  assert.equal(failure.mock.callCount(), 1);
  assert.equal(JSON.stringify(database.read("characters", `/${f.characterID}`).data), before);
  assert.equal(f.session.achievementState, cache);
  failure.mock.mockImplementation(() => { throw new Error("test disk unavailable"); });
  assert.throws(() => update(service, f.session, {}, { client_spinCamera: 9 }), wrapped);
  assert.equal(JSON.stringify(database.read("characters", `/${f.characterID}`).data), before);
  assert.equal(f.session.achievementState, cache);
});

test("valid partial snapshots cannot exceed the readable merged progress bound", t => {
  const f = fixture(t, { eventDict: { existing_counter: 1 }, completedDict: { "1": TIME.toString() } });
  if (!f) return;
  const before = JSON.stringify(database.read("characters", `/${f.characterID}`).data);
  const service = new AchievementService();
  const completed = Object.fromEntries(Array.from({ length: 10000 }, (_, i) => [i + 2, TIME]));
  const statistics = Object.fromEntries(Array.from({ length: 10000 }, (_, i) => [`counter_${i}`, 1]));
  t.mock.method(database, "commitAtomicRowWrites", () => assert.fail("oversized union must not reach commit"));
  assert.throws(() => update(service, f.session, completed, {}), wrapped);
  assert.throws(() => update(service, f.session, {}, statistics), wrapped);
  assert.equal(JSON.stringify(database.read("characters", `/${f.characterID}`).data), before);
  assert.equal(maps(service, f.session).events.get("existing_counter"), 1);
});
