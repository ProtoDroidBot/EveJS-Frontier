"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { openNpcHeadlessFittingWindow } = require(
  "../src/space/npc/npcHeadlessFittingWindow",
);

const ACTOR_ID = 980000001001;
const TARGET_ID = 980000001002;
const ACTOR_PILOT_ID = 1500001001;
const TARGET_PILOT_ID = 1500001002;
const SYSTEM_ID = 30000004;

function fixture() {
  const records = new Map([
    [ACTOR_ID, { entityID: ACTOR_ID, systemID: SYSTEM_ID, categoryID: 6,
      npcCharacterID: ACTOR_PILOT_ID, npcIncarnation: 1 }],
    [TARGET_ID, { entityID: TARGET_ID, systemID: SYSTEM_ID, categoryID: 6,
      npcCharacterID: TARGET_PILOT_ID, npcIncarnation: 1 }],
  ]);
  const pilots = new Map([
    [ACTOR_PILOT_ID, { characterID: ACTOR_PILOT_ID, activeEntityID: ACTOR_ID,
      incarnation: 1, factionID: 500010, factionKey: "500010-test" }],
    [TARGET_PILOT_ID, { characterID: TARGET_PILOT_ID, activeEntityID: TARGET_ID,
      incarnation: 1, factionID: 500010, factionKey: "500010-test" }],
  ]);
  const live = new Map([
    [ACTOR_ID, { itemID: ACTOR_ID, position: { x: 0, y: 0, z: 0 } }],
    [TARGET_ID, { itemID: TARGET_ID, position: { x: 1000, y: 0, z: 0 } }],
  ]);
  const items = new Map([
    [7001, { itemID: 7001, ownerID: ACTOR_PILOT_ID,
      locationID: ACTOR_ID, flagID: 5, categoryID: 7, typeID: 9001 }],
    [7002, { itemID: 7002, ownerID: TARGET_PILOT_ID,
      locationID: ACTOR_ID, flagID: 5, categoryID: 7, typeID: 9002 }],
    [7003, { itemID: 7003, ownerID: ACTOR_PILOT_ID,
      locationID: ACTOR_ID, flagID: 5, categoryID: 8, typeID: 9003 }],
  ]);
  const calls: any[] = [];
  let trusted = true;
  let hullTypeID = 587;
  const dependencies = {
    nativeNpcStore: { getNativeEntity: (id) => records.get(Number(id)) || null },
    npcPilots: { get: (id) => pilots.get(Number(id)) || null },
    getLiveEntity: (record) => live.get(record.entityID) || null,
    canEntitiesInteractLocally: () => true,
    trust: { evaluateNpcFittingTrust: () => ({
      trusted, reason: trusted ? "same-faction" : "no-positive-trust",
    }) },
    npcFitting: {
      resolveNpcFittingEntity: (id) => records.has(Number(id))
        ? { success: true, data: { entityRecord: records.get(Number(id)),
          fittingHull: { typeID: hullTypeID } } }
        : { success: false, errorMsg: "NPC_DURABLE_ENTITY_NOT_FOUND" },
      listNpcEquipment: (id) => [{ entityID: id, moduleID: 8001 }],
      fitItemToNpc: (input) => (calls.push(["fit", input]), { success: true }),
      unfitItemFromNpc: (input) => (calls.push(["unfit", input]), { success: true }),
      loadChargeToNpcModule: (input) => (calls.push(["load", input]), { success: true }),
      unloadChargeFromNpcModule: (input) => (calls.push(["unload", input]), { success: true }),
    },
    itemStore: {
      ITEM_FLAGS: { CARGO_HOLD: 5 },
      findItemById: (id) => items.get(Number(id)) || null,
      listOwnedItems: (ownerID, filters) => [...items.values()].filter((item) =>
        item.ownerID === ownerID && item.locationID === filters.locationID &&
        item.flagID === filters.flagID),
    },
    npcCreationDraft: {
      ensureNpcCreationState: () => ({ success: true, data: { state: { modules: [] }, template: {} } }),
      commitNpcCreationDraft: (context, changes) => (
        calls.push(["creation", context, changes]), { success: true, diagnostics: [] }
      ),
    },
  };
  return { records, pilots, live, items, calls, dependencies,
    setTrusted: (value) => { trusted = value; },
    setHullTypeID: (value) => { hullTypeID = value; } };
}

test("NPC pilot opens a headless self fitting view and changes its legacy fit", () => {
  const f = fixture();
  const opened = openNpcHeadlessFittingWindow({ actorEntityID: ACTOR_ID }, f.dependencies);
  assert.equal(opened.success, true);
  const window = opened.data;
  assert.equal(window.kind, "npc-headless-fitting-window");
  assert.equal(window.targetEntityID, ACTOR_ID);
  assert.equal(window.refresh().data.fittingPath, "legacy");
  assert.equal(window.fitItem(7001, 11).success, true);
  assert.equal(f.calls[0][1].entityID, ACTOR_ID);
  assert.equal(f.calls[0][1].actor.kind, "npc");
  assert.equal(f.calls[0][1].actor.characterID, ACTOR_PILOT_ID);
  assert.equal(window.loadCharge(8001, 7003, 4).success, true);
  assert.equal(window.unloadCharge(7003).success, true);
  assert.equal(window.unfitItem(8001).success, true);
  assert.equal(f.calls[3][1].destinationLocationID, ACTOR_ID);
  window.close();
  assert.equal(window.fitItem(7001).errorMsg, "NPC_FITTING_WINDOW_CLOSED");
});

test("trusted NPC pilot refits a nearby peer and rechecks trust, range, and cargo", () => {
  const f = fixture();
  const opened = openNpcHeadlessFittingWindow({
    actorEntityID: ACTOR_ID, targetEntityID: TARGET_ID,
  }, f.dependencies);
  assert.equal(opened.success, true);
  const window = opened.data;
  assert.equal(window.fitItem(7001, 11).success, true);
  assert.equal(f.calls[0][1].entityID, TARGET_ID);
  assert.deepEqual(f.calls[0][1].actor.authorizedNpcOwnerIDs, [TARGET_PILOT_ID]);
  assert.equal(window.unfitItem(8001).success, true);
  assert.equal(f.calls[1][1].destinationLocationID, ACTOR_ID);
  assert.equal(window.fitItem(7002, 12).success, true);
  f.items.get(7001).locationID = TARGET_ID;
  assert.equal(window.fitItem(7001).errorMsg, "NPC_FITTING_ITEM_NOT_IN_ACTIVE_SHIP");
  f.setTrusted(false);
  assert.equal(window.fitItem(7002).errorMsg, "NPC_FITTING_TRUST_REQUIRED");
  f.setTrusted(true);
  f.live.get(TARGET_ID).position.x = 6000;
  assert.equal(window.fitItem(7002).errorMsg, "NPC_FITTING_OUT_OF_RANGE");
  assert.equal(f.calls.length, 3);
});

test("headless fitting refuses stale pilots and supports the Creation draft path", () => {
  const f = fixture();
  f.pilots.get(TARGET_PILOT_ID).activeEntityID = TARGET_ID + 1;
  assert.equal(openNpcHeadlessFittingWindow({
    actorEntityID: ACTOR_ID, targetEntityID: TARGET_ID,
  }, f.dependencies).errorMsg, "NPC_PILOT_REQUIRED");
  f.pilots.get(TARGET_PILOT_ID).activeEntityID = TARGET_ID;
  f.setHullTypeID(95276);
  const window = openNpcHeadlessFittingWindow({
    actorEntityID: ACTOR_ID, targetEntityID: TARGET_ID,
  }, f.dependencies).data;
  assert.equal(window.refresh().data.fittingPath, "creation");
  assert.equal(window.fitItem(7001).errorMsg, "NPC_CREATION_DRAFT_REQUIRED");
  assert.equal(window.getCreationDraft().success, true);
  assert.equal(window.commitCreationDraft([{ op: "move", itemID: 8001 }]).success, true);
  assert.equal(f.calls[0][1].actor.kind, "npc");
  assert.equal(f.calls[0][1].entityRecord.entityID, TARGET_ID);
  f.pilots.get(TARGET_PILOT_ID).incarnation = 2;
  assert.equal(window.refresh().errorMsg, "NPC_PILOT_REQUIRED");
});
