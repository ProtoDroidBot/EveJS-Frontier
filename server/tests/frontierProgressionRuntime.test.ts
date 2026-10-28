"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { createProgressionRuntime, TABLE, memoriesResponse, catalog, medicalBreakdown } = require("../src/services/frontier/progressionRuntime");

function fixture() {
  const rows: any = {}, items: any = { 10: { itemID: 10, typeID: 91969, ownerID: 1, locationID: 1, flagID: 4, singleton: 1 },
    11: { itemID: 11, typeID: 91968, ownerID: 1, locationID: 100, flagID: 4, singleton: 1 },
    12: { itemID: 12, typeID: 91969, ownerID: 2, locationID: 100, flagID: 4, singleton: 1 } };
  let clock = 5000000, nextID = 1000, fail = false;
  let environment: any = { vitality: 100, vitalityCapacity: 100, feralization: 0, temporalDrift: 0, effects: { heat: {}, feralization: {}, temporal_drift: {} } };
  const events = [], notices = [], clones = value => value == null ? value : structuredClone(value);
  const repo = { ensureTable: () => ({ success: true }), read: (_table, path) => ({ success: true, data: clones(rows[path.slice(1)]) }),
    prepareAtomicRowWrite: (_table, key, value) => ({ key, value: clones(value), previous: JSON.stringify(rows[key]) }),
    commitAtomicRowWrites(proposals) { if (fail) return { success: false, errorMsg: "INJECTED_FAILURE" }; if (proposals.some(row => row.previous !== JSON.stringify(rows[row.key]))) return { success: false, errorMsg: "CONFLICT" }; for (const row of proposals) rows[row.key] = clones(row.value); return { success: true }; } };
  const localPolicy: any = { activityWeights: { extraction: { memoryCategoryID: 9, skillWeights: { 10: 1 }, xpPerUnit: 1 }, piloting: { memoryCategoryID: 2, skillWeights: { 1: 1 }, xpPerUnit: 1 } },
    founderCharacterIDs: [1], cycleObjectives: [{ id: "mine", eventKind: "extraction", target: 100, message: "Extraction complete" }], shellCreation: { 91969: { enabled: true, materials: [] } } };
  const session = { charid: 1, stationid: 100, sendNotification: (...args) => events.push(args) };
  function makeRuntime() {
    return createProgressionRuntime({ repo, now: () => clock, policy: () => localPolicy,
      activeShell: id => Object.values<any>(items).find(item => item.ownerID === id && item.locationID === id && catalog.types.some(type => type.typeID === item.typeID && type.categoryID === 2153)),
      findItem: id => clones(items[id]), allocateID: () => nextID++, selectMaterials: (_id, _request, materials) => materials.length ? null : [],
      environmentSnapshot: () => clones(environment), applyEnvironment: (_id, value) => { environment = clones(value); }, resetEnvironment: () => {},
      publishNotice: (_session, type, payload) => notices.push({ type, payload }),
      inventoryAtomic(request, factory) {
        const staged = clones(items), grantedItems = [], changes = [];
        for (const take of request.consumptions || []) {
          const item = staged[take.itemID];
          if (!item || item.ownerID !== request.characterID || !request.sourceLocationIDs.includes(item.locationID) || !request.sourceFlagIDs.includes(item.flagID) || item.typeID !== take.typeID || item.singleton && !take.allowSingleton || (item.quantity || 1) < take.quantity) return { success: false, errorMsg: "ITEM_NOT_ACCESSIBLE" };
          if ((item.quantity || 1) === take.quantity) delete staged[take.itemID]; else item.quantity -= take.quantity;
        }
        for (const move of request.moves || []) {
          const item = staged[move.itemID];
          if (!item || item.ownerID !== request.characterID || !request.sourceLocationIDs.includes(item.locationID)) return { success: false, errorMsg: "ITEM_NOT_ACCESSIBLE" };
          Object.assign(item, { locationID: move.locationID, flagID: move.flagID });
        }
        for (const grant of request.grants || []) {
          const item = { ...grant, itemID: nextID++, ownerID: request.characterID, locationID: request.destinationLocationID, flagID: request.destinationFlagID };
          staged[item.itemID] = item; grantedItems.push(item);
        }
        const result = repo.commitAtomicRowWrites(factory({ grantedItems, changes }));
        if (!result.success) return result;
        for (const key of Object.keys(items)) delete items[key]; Object.assign(items, staged);
        return { success: true, data: { grantedItems, changes } };
      } });
  }
  const runtime = makeRuntime();
  return { runtime, makeRuntime, rows, items, events, notices, session, localPolicy, get environment() { return environment; },
    setEnvironment(value) { environment = { ...environment, ...value }; }, fail(value) { fail = value; }, advance() { clock += 1800001; },
    earn(eventID = "mine1", amount = 100, eventKind = "extraction") { return runtime.recordActivity(session, { eventID, eventKind, amount }); } };
}

test("client catalog and conversion are build-derived, activity receipts survive runtime recreation", () => {
  const f = fixture();
  assert.equal(catalog.skills.length, 9);
  assert.equal(f.earn().success, true);
  const state = f.runtime.getState(1), memory: any = Object.values(state.memories)[0];
  assert.equal(memory.typeID, 9); assert.equal(memory.depth[10], 100 * 1.5e-7);
  assert.equal(f.makeRuntime().recordActivity(f.session, { eventID: "mine1", eventKind: "extraction", amount: 100 }).duplicate, true);
  assert.equal(f.runtime.getState(1).totalXP, 100);
  assert.equal(f.notices.length, 1); assert.equal(f.notices[0].type, "eve_public.achievement.CompletedNotice");
  assert.equal(f.events[0][0], "OnMemoryCardPurchased"); assert.equal(f.events[1][0], "OnSkillsUpdated");
  assert.equal(f.runtime.recordActivity(f.session, { eventID: "bad", eventKind: "unconfigured", amount: 1 }).success, false);
});

test("invalid activity cannot mint progression and failed persistence emits no rewards", () => {
  const f = fixture();
  for (const amount of [NaN, Infinity, -1, 0, 1e13]) assert.equal(f.earn("bad", amount).success, false);
  f.fail(true); assert.equal(f.earn().success, false); assert.equal(f.events.length, 0); assert.equal(f.runtime.getState(1).totalXP, 0);
  f.fail(false); assert.equal(f.earn().success, true);
});

test("ascension moves selected owned memories to vault and refuses duplicate or foreign IDs", () => {
  const f = fixture(); f.earn(); f.earn("flight", 200, "piloting");
  const ids = Object.keys(f.runtime.getState(1).memories).map(Number);
  assert.equal(f.runtime.ascend(f.session, [ids[0], ids[0]]).success, false);
  assert.equal(f.runtime.ascend({ charid: 2 }, [ids[0]]).success, false);
  assert.equal(f.runtime.ascend(f.session, [ids[0]]).success, true);
  assert.equal(Object.keys(f.runtime.getState(1).memories).length, 2);
  assert.equal(f.runtime.complexity(1).vault[10], 100 * 1.5e-7);
  assert.equal(f.runtime.complexity(1).acquired[1], 200 * 1.5e-7);
  assert.equal(f.runtime.ascend(f.session, [ids[0]]).success, false);
});

test("crown creation is atomic, has durable cooldown, and conserved memories become inherited after implant", () => {
  const f = fixture(); f.earn(); const id = Number(Object.keys(f.runtime.getState(1).memories)[0]); f.runtime.ascend(f.session, [id]);
  f.fail(true); assert.equal(f.runtime.createCrown(f.session, [id]).success, false); assert.equal(f.runtime.getState(1).memories[id].ownerKind, "vault"); assert.equal(Object.values<any>(f.items).some(item => item.typeID === 92437), false);
  f.fail(false); const created = f.runtime.createCrown(f.session, [id]); assert.equal(created.success, true); const crown = created.data.grantedItems[0];
  assert.equal(f.runtime.getState(1).memories[id].ownerID, crown.itemID);
  assert.equal(f.runtime.crownMutation(f.session, crown.itemID).success, true);
  assert.equal(f.items[crown.itemID].locationID, 10); assert.equal(f.runtime.complexity(1).inherited[10], 100 * 1.5e-7);
  assert.equal(f.runtime.crownMutation(f.session, crown.itemID).success, false);
  f.earn("again"); const second = Number(Object.keys(f.runtime.getState(1).memories).find(key => Number(key) !== id)); f.runtime.ascend(f.session, [second]);
  assert.equal(f.makeRuntime().createCrown(f.session, [second]).errorMsg, "CROWN_COOLDOWN"); f.advance(); assert.equal(f.runtime.createCrown(f.session, [second]).success, true);
});

test("crown deletion consumes the real singleton and removes inherited skills after commit only", () => {
  const f = fixture(); f.earn(); const id = Number(Object.keys(f.runtime.getState(1).memories)[0]); f.runtime.ascend(f.session, [id]); const crownID = f.runtime.createCrown(f.session, [id]).data.grantedItems[0].itemID; f.runtime.crownMutation(f.session, crownID);
  f.fail(true); assert.equal(f.runtime.crownMutation(f.session, null, true).success, false); assert.ok(f.items[crownID]); assert.ok(f.runtime.complexity(1).inherited[10]);
  f.fail(false); assert.equal(f.runtime.crownMutation(f.session, null, true).success, true); assert.equal(f.items[crownID], undefined); assert.deepEqual(f.runtime.complexity(1).inherited, {});
});

test("memory deletion checks owner kind and active shell and encodes numeric depth keys", () => {
  const f = fixture(); f.earn(); const state = f.runtime.getState(1), id = Number(Object.keys(state.memories)[0]);
  const encoded = memoriesResponse(state, "shell", 10); const memory = encoded.entries[0][1].entries[0][1];
  assert.deepEqual(memory.entries.find(([key]) => key === "depth")[1].entries, [[10, 100 * 1.5e-7]]);
  assert.equal(typeof memory.entries.find(([key]) => key === "date_created")[1], "bigint");
  assert.equal(f.runtime.deleteMemory(f.session, id, 3).success, false);
  assert.equal(f.runtime.deleteMemory({ charid: 2 }, id, 1).success, false);
  assert.equal(f.runtime.deleteMemory(f.session, id, 1).success, true); assert.deepEqual(f.runtime.complexity(1).acquired, {});
});

test("medical kit consumption and durable healing commit together, with replay and remote stock rejected", () => {
  const f = fixture(); f.setEnvironment({ vitality: 60 }); f.runtime.saveEnvironment(1, f.environment, { heat: 40 });
  f.items[30] = { itemID: 30, typeID: 95339, ownerID: 1, locationID: 100, flagID: 4, quantity: 1 };
  f.fail(true); assert.equal(f.runtime.treat(f.session, 30, false).success, false); assert.equal(f.environment.vitality, 60); assert.ok(f.items[30]); assert.equal(f.runtime.medical(1).vitality, 60);
  f.fail(false); assert.equal(f.runtime.treat(f.session, 30, false).success, true); assert.equal(f.environment.vitality, 100); assert.equal(f.items[30], undefined); assert.equal(f.makeRuntime().medical(1).vitality, 100);
  assert.equal(f.runtime.treat(f.session, 30, false).success, false);
  assert.deepEqual(medicalBreakdown(f.runtime.medical(1)), []);
});

test("remedies clear only their authored effect and owned reachable consumable", () => {
  const f = fixture(); f.setEnvironment({ vitality: 50, feralization: 10, temporalDrift: 20, effects: { heat: {}, feralization: { active: true }, temporal_drift: { active: true } } }); f.runtime.saveEnvironment(1, f.environment, { feralization: 20, temporal_drift: 30 });
  f.items[31] = { itemID: 31, typeID: 95341, ownerID: 1, locationID: 999, flagID: 4, quantity: 2 };
  assert.equal(f.runtime.treat(f.session, 31, true).success, false); assert.equal(f.environment.feralization, 10);
  f.items[31].locationID = 100; assert.equal(f.runtime.treat(f.session, 31, true).success, true); assert.equal(f.environment.feralization, 0); assert.equal(f.environment.temporalDrift, 20); assert.equal(f.environment.vitality, 70); assert.equal(f.items[31].quantity, 1);
  assert.equal(f.runtime.treat(f.session, 31, true).success, false);
});

test("shell activation moves both real inventory rows, validates nest ownership and preserves per-shell memories", () => {
  const f = fixture(); f.earn();
  assert.equal(f.runtime.activateShell(f.session, 12, 100).success, false);
  assert.equal(f.runtime.activateShell(f.session, 11, 999).success, false);
  f.fail(true); assert.equal(f.runtime.activateShell(f.session, 11, 100).success, false); assert.equal(f.items[10].locationID, 1);
  f.fail(false); assert.equal(f.runtime.activateShell(f.session, 11, 100).success, true); assert.equal(f.items[10].locationID, 100); assert.equal(f.items[11].locationID, 1); assert.deepEqual(f.runtime.complexity(1).acquired, {});
  assert.equal(f.runtime.activateShell(f.session, 10, 100).success, true); assert.ok(f.runtime.complexity(1).acquired[10]);
  assert.equal(f.runtime.createShell(f.session, 91968).success, false); assert.equal(f.runtime.createShell(f.session, 91969).success, true);
});

test("founder entitlement is explicit and upload completion notices are durable and idempotent", () => {
  const f = fixture(); assert.equal(f.runtime.isFounder(1), true); assert.equal(f.runtime.isFounder(2), false);
  const upload = { id: "upload1", status: "failed", reason: 1 };
  f.fail(true); assert.equal(f.runtime.recordBroadcast(f.session, upload).success, false); assert.equal(f.notices.length, 0);
  f.fail(false); assert.equal(f.runtime.recordBroadcast(f.session, upload).success, true); assert.equal(f.makeRuntime().recordBroadcast(f.session, upload).duplicate, true); assert.equal(f.notices.length, 1); assert.equal(f.notices[0].payload.reason, 1);
});
