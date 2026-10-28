import assert from "node:assert/strict";
import test from "node:test";
import { buildNpcFactionIdentityKey, createNpcPilotIdentityStore } from "../src/space/npc/npcPilotIdentityStore";

function fixture() {
  const tables: Record<string, any> = { npcPilotIdentities: {}, npcEntities: { entities: {} }, characters: {}, items: {} };
  let snapshot: Record<string, any> = {};
  const db = {
    read(table, path) {
      let value = tables[table];
      for (const key of path.split("/").filter(Boolean)) value = value?.[key];
      return { success: value !== undefined, data: value };
    },
    write(table, path, value) {
      const keys = path.split("/").filter(Boolean);
      if (!keys.length) tables[table] = value;
      else {
        let parent = tables[table];
        for (const key of keys.slice(0, -1)) parent = parent[key] ||= {};
        parent[keys.at(-1)] = value;
      }
      return { success: true };
    },
    flushTablesSync() { snapshot = structuredClone(tables); return { success: true }; },
  };
  return { tables, db, snapshot: () => snapshot, store: createNpcPilotIdentityStore(db, () => 1000) };
}

const spawn = { entityID: 980000000001, systemID: 30000004, factionID: 500025, factionStringOnlyID: "osa", identitySlot: "belt:10:group:0:member:0", characterName: "Osa" };

test("NPC faction keys preserve both identity components without truncation", () => {
  assert.equal(buildNpcFactionIdentityKey(500025, " OSA "), "500025-osa");
  assert.equal(buildNpcFactionIdentityKey(500012), "500012-none");
  assert.equal(buildNpcFactionIdentityKey(null, "osa"), "0-osa");
  assert.equal(buildNpcFactionIdentityKey(0), "0-none");
  for (const pair of [[-1, "osa"], [0x100000000, "osa"], [1, "bad/key"], [1, "none"], [1, "a".repeat(97)]]) {
    assert.throws(() => buildNpcFactionIdentityKey(pair[0], pair[1]));
  }
});

test("death and restart reuse exact NPC pilot and chain profile, not the old ship ID", () => {
  const f = fixture();
  const first = f.store.acquire(spawn);
  f.tables.npcEntities.entities[spawn.entityID] = { npcCharacterID: first.characterID };
  f.store.update(first.characterID, p => ({ ...p, sui: { status: "confirmed", playerProfileObjectId: "0x123" } }));
  delete f.tables.npcEntities.entities[spawn.entityID];
  f.store.release(first.characterID, spawn.entityID, true);
  const restarted = createNpcPilotIdentityStore(f.db, () => 2000);
  const second = restarted.acquire({ ...spawn, entityID: spawn.entityID + 1 });
  assert.equal(second.characterID, first.characterID);
  assert.equal(second.characterName, first.characterName);
  assert.equal(second.sui.playerProfileObjectId, "0x123");
  assert.equal(second.deaths, 1);
  assert.equal(second.incarnation, 2);
  assert.equal(f.snapshot().npcPilotIdentities.pilots[first.characterID].activeEntityID, spawn.entityID + 1);
  restarted.release(first.characterID, spawn.entityID, true);
  assert.equal(restarted.get(first.characterID).activeEntityID, spawn.entityID + 1);
});

test("live NPC slots cannot be occupied twice; separate slots/factions/systems have distinct pilots", () => {
  const f = fixture();
  const first = f.store.acquire(spawn);
  f.tables.npcEntities.entities[spawn.entityID] = { npcCharacterID: first.characterID };
  assert.throws(() => f.store.acquire({ ...spawn, entityID: spawn.entityID + 1 }), /already occupied/);
  const variants = [{ identitySlot: "other" }, { factionID: 500012 }, { factionStringOnlyID: "feral" }, { systemID: 30000005 }];
  const ids = variants.map((variant, i) => f.store.acquire({ ...spawn, ...variant, entityID: spawn.entityID + i + 1 }).characterID);
  assert.equal(new Set([first.characterID, ...ids]).size, 5);
});

test("transient ships missing after restart relinquish occupancy without losing pilots", () => {
  const f = fixture();
  const first = f.store.acquire(spawn);
  const second = createNpcPilotIdentityStore(f.db).acquire({ ...spawn, entityID: spawn.entityID + 9 });
  assert.equal(first.characterID, second.characterID);
  assert.equal(second.incarnation, 2);
  assert.equal(second.deaths, 0);
});

test("manual spawns without a logical slot create independent NPC pilots", () => {
  const f = fixture();
  const first = f.store.acquire({ ...spawn, identitySlot: undefined });
  const second = f.store.acquire({ ...spawn, entityID: spawn.entityID + 1, identitySlot: undefined });
  assert.notEqual(first.characterID, second.characterID);
  assert.notEqual(first.identitySlot, second.identitySlot);
});

test("NPC allocator avoids existing human/items and refuses exhaustion or corrupt ledgers", () => {
  const f = fixture();
  f.tables.characters[1500000000] = {};
  f.tables.items[1500000001] = {};
  assert.equal(f.store.acquire(spawn).characterID, 1500000002);
  f.tables.npcPilotIdentities.nextCharacterID = 1600000000;
  assert.throws(() => f.store.acquire({ ...spawn, identitySlot: "new" }), /range exhausted/);
  f.tables.npcPilotIdentities = { version: 99 };
  assert.throws(() => f.store.list(), /refusing to discard/);
});

test("NPC identity acquisition fails closed if its durable flush fails", () => {
  const f = fixture();
  const attempts: string[][] = [];
  f.db.flushTablesSync = ((tables: string[]) => { attempts.push(tables); return { success: false }; }) as any;
  assert.throws(() => f.store.acquire(spawn), /could not be flushed/);
  assert.deepEqual(attempts, [["npcEntities"]]);
});

test("missing or malformed durable identity data is never treated as an empty ledger", () => {
  const f = fixture();
  f.tables.npcPilotIdentities = { version: 1, nextCharacterID: 1500000000, pilots: {}, factions: {} };
  assert.throws(() => f.store.list(), /Corrupt/);
  delete f.tables.npcPilotIdentities;
  assert.throws(() => f.store.acquire(spawn), /refusing to replace/);
});
