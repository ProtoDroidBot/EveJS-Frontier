"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const database = require("../src/gameStore");
const sqliteStore = require("../src/gameStore/sqliteStore");
const ownership = require("../src/gameStore/tableOwnership");
const identityAllocator = require("../src/services/_shared/identityAllocator");
const {
  NPC_CHARACTER_ID_MIN,
  NPC_CHARACTER_ID_MAX,
  isNpcCharacterID,
} = require("../src/services/_shared/npcIdentityConstants");

function mockIdentityStore(t, nextCharacterID, overrides: Record<string, any> = {}) {
  const state = {
    version: 1,
    nextAccountID: 1,
    nextCharacterID,
    nextItemID: identityAllocator.ITEM_ID_FLOOR,
    ...overrides,
  };
  t.mock.method(database, "read", (table) => ({
    success: true,
    data: table === "identityState" ? state : {},
  }));
  t.mock.method(database, "write", () => ({ success: true }));
  t.mock.method(database, "flushTablesSync", () => undefined);
  return state;
}

test("player character allocation skips the entire permanent NPC reservation", (t) => {
  const state = mockIdentityStore(t, NPC_CHARACTER_ID_MIN - 1);
  assert.equal(identityAllocator.reserveCharacterID(), NPC_CHARACTER_ID_MIN - 1);
  assert.equal(state.nextCharacterID, NPC_CHARACTER_ID_MIN);
  assert.equal(identityAllocator.reserveCharacterID(), NPC_CHARACTER_ID_MAX + 1);
  assert.equal(state.nextCharacterID, NPC_CHARACTER_ID_MAX + 2);
  assert.equal(identityAllocator.reserveCharacterID(), NPC_CHARACTER_ID_MAX + 2);
});

test("restored player allocator cursor cannot issue an NPC pilot ID", (t) => {
  mockIdentityStore(t, NPC_CHARACTER_ID_MIN + 1234);
  assert.equal(identityAllocator.reserveCharacterID(), NPC_CHARACTER_ID_MAX + 1);
  assert.deepEqual(identityAllocator.collectCharacterIDConflicts(NPC_CHARACTER_ID_MIN), [
    "npcPilotIdentities.reservedCharacterIDRange",
  ]);
  assert.deepEqual(identityAllocator.collectCharacterIDConflicts(NPC_CHARACTER_ID_MAX), [
    "npcPilotIdentities.reservedCharacterIDRange",
  ]);
});

test("inventory allocations stay above the NPC reservation even with an old cursor", (t) => {
  mockIdentityStore(t, identityAllocator.CHARACTER_ID_FLOOR, {
    nextItemID: NPC_CHARACTER_ID_MIN,
  });
  const ids = identityAllocator.reserveItemIDs(3, { minCandidate: NPC_CHARACTER_ID_MIN });
  assert.deepEqual(ids, [
    identityAllocator.ITEM_ID_FLOOR,
    identityAllocator.ITEM_ID_FLOOR + 1,
    identityAllocator.ITEM_ID_FLOOR + 2,
  ]);
  assert.equal(ids.some(isNpcCharacterID), false);
});

test("NPC identity reservation rejects fractional and out-of-range IDs", () => {
  assert.equal(isNpcCharacterID(NPC_CHARACTER_ID_MIN), true);
  assert.equal(isNpcCharacterID(NPC_CHARACTER_ID_MAX), true);
  assert.equal(isNpcCharacterID(NPC_CHARACTER_ID_MIN - 1), false);
  assert.equal(isNpcCharacterID(NPC_CHARACTER_ID_MAX + 1), false);
  assert.equal(isNpcCharacterID(NPC_CHARACTER_ID_MIN + 0.5), false);
});

test("permanent NPC identities persist as independent SQLite rows", (t) => {
  const table = "npcPilotIdentities";
  const original = structuredClone(database.read(table, "/").data || {});
  t.after(() => {
    database.write(table, "/", original, { force: true });
    database.flushTablesSync([table]);
  });
  assert.equal(database._sqliteTables.has(table), true);
  assert.equal(ownership.isRuntimeTable(table), true);
  const record = {
    version: 1,
    nextCharacterID: NPC_CHARACTER_ID_MIN + 1,
    pilots: { [NPC_CHARACTER_ID_MIN]: { npcCharacterID: NPC_CHARACTER_ID_MIN } },
    slots: { "belt:30000001:1": NPC_CHARACTER_ID_MIN },
    factions: { "500012-blood-raiders": { address: "0x1234" } },
  };
  assert.equal(database.write(table, "/", record, { force: true }).success, true);
  database.flushTablesSync([table]);
  assert.deepEqual(sqliteStore.loadTableObject(table), record);
  const keys = sqliteStore.loadRows(table).map((row) => row.key);
  assert.ok(keys.includes(`pilots${sqliteStore.ROW_KEY_SEP}${NPC_CHARACTER_ID_MIN}`));
  assert.ok(keys.includes(`slots${sqliteStore.ROW_KEY_SEP}belt:30000001:1`));
  assert.ok(keys.includes(`factions${sqliteStore.ROW_KEY_SEP}500012-blood-raiders`));
});
