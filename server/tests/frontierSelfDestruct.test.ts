"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  SELF_DESTRUCT_DELAY_MS,
  beginSelfDestruct,
  abortSelfDestruct,
  _testing,
} = require("../src/services/ship/selfDestructRuntime");
const { buildCrDataUpdate, buildSlimItemDict } = require("../src/space/destiny");

test("ship self-destruct arms the client timer, aborts, and destroys only the same active hull", () => {
  const session = { characterID: 91000001, _space: { shipID: 81000001 } };
  const entity: Record<string, any> = {
    itemID: 81000001,
    typeID: 95276,
    categoryID: 6,
    groupID: 25,
    kind: "ship",
    ownerID: session.characterID,
    characterID: session.characterID,
  };
  const broadcasts = [];
  const scene = {
    getEntityByID: (id) => id === entity.itemID ? entity : null,
    broadcastSlimItemChanges: (entities) => broadcasts.push(entities),
  };
  const callbacks = [];
  let destroyCount = 0;
  const options = {
    now: () => 1_000_000,
    resolveContext: (target, requestedID) =>
      target._space.shipID === entity.itemID &&
      (!requestedID || requestedID === entity.itemID)
        ? { success: true, shipID: entity.itemID, scene, entity }
        : { success: false, errorMsg: "SHIP_NOT_ACTIVE" },
    schedule: (callback, delay) => {
      assert.equal(delay, SELF_DESTRUCT_DELAY_MS);
      callbacks.push(callback);
      return { unref() {} };
    },
    clearTimer: () => {},
    destroy: () => {
      destroyCount += 1;
      return { success: true, data: { wreckChanges: [] } };
    },
  };

  assert.equal(beginSelfDestruct(session, entity.itemID + 1).errorMsg, "SHIP_NOT_ACTIVE");
  assert.equal(beginSelfDestruct({ characterID: session.characterID }, entity.itemID).errorMsg, "NOT_IN_SPACE");
  assert.equal(beginSelfDestruct(session, entity.itemID + 1, options).success, false);
  assert.equal(beginSelfDestruct(session, entity.itemID, options).deadlineMs, 1_010_000);
  assert.equal(beginSelfDestruct(session, entity.itemID, options).alreadyActive, true);
  assert.equal(callbacks.length, 1);
  assert.equal(entity.selfDestructAtMs, 1_010_000);
  const armedCrData = buildSlimItemDict(entity);
  assert.ok(armedCrData.entries.find(([key]) => key === "selfDestructTime")?.[1]);
  assert.ok(buildCrDataUpdate(entity, "frontier").entries
    .find(([key]) => key === "selfDestructTime")?.[1]);

  assert.equal(abortSelfDestruct(session, entity.itemID, options).success, true);
  assert.equal(entity.selfDestructAtMs, null);
  assert.equal(buildCrDataUpdate(entity, "frontier").entries
    .find(([key]) => key === "selfDestructTime")?.[1], null);
  callbacks[0]();
  assert.equal(destroyCount, 0);

  beginSelfDestruct(session, entity.itemID, options);
  session._space.shipID = entity.itemID + 1;
  callbacks[1]();
  assert.equal(destroyCount, 0);
  assert.equal(entity.selfDestructAtMs, null);

  session._space.shipID = entity.itemID;
  beginSelfDestruct(session, entity.itemID, options);
  callbacks[2]();
  assert.equal(destroyCount, 1);
  assert.equal(_testing.pendingByShipID.has(entity.itemID), false);
  assert.equal(broadcasts.length, 5);
});
