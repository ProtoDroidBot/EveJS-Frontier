"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const destiny = require("../src/space/destiny/index.js");
const {
  createMovementSceneRefresh,
  planStateRefreshEntities,
} = require("../src/space/destiny/dispatch/sceneRefresh.js");

test("state refresh keeps delayed statics out of SetState and reacquires them afterward", (t) => {
  const ego = { itemID: 9988400000108, kind: "ship" };
  const prop = {
    itemID: 8600000000000000,
    kind: "detachedDungeonProp",
    staticVisibilityScope: "bubble",
    destinyBootstrapDelivery: "addBalls2",
  };
  const customsOffice = { itemID: 1200042000001, kind: "orbital" };
  const visible = [prop, customsOffice, ego];
  const isIncrementalStaticVisibilityEntity = (entity) =>
    entity.staticVisibilityScope === "bubble";
  const plan = planStateRefreshEntities(visible, isIncrementalStaticVisibilityEntity);
  assert.deepEqual(plan.stateEntities.map((entity) => entity.itemID),
    [customsOffice.itemID, ego.itemID]);
  assert.deepEqual(plan.deferredStaticEntities.map((entity) => entity.itemID),
    [prop.itemID]);

  t.mock.method(destiny, "buildSetStatePayload", (_stamp, _system, _ego, entities) =>
    ["SetState", entities.map((entity) => entity.itemID)]);
  t.mock.method(destiny, "buildAddBalls2Payload", (_stamp, entities) =>
    ["AddBalls2", entities.map((entity) => entity.itemID)]);
  const sent: any[] = [];
  const session = { _space: {} };
  const runtime = {
    system: {},
    getVisibleEntitiesForSession: () => visible,
    getNextDestinyStamp: () => 100,
    getCurrentSimTimeMs: () => 100_000,
    getCurrentDestinyStamp: () => 100,
    translateDestinyStampForSession: (_session, stamp) => stamp,
    getCurrentSessionDestinyStamp: () => 100,
    getImmediateDestinyStampForSession: () => 100,
    getCurrentSessionFileTime: () => 0n,
    sendDestinyUpdates: (_session, updates, _waitForBubble, options) => {
      sent.push({ updates, options });
      return updates[0].stamp;
    },
  };
  createMovementSceneRefresh({
    buildMissileSessionSnapshot: () => ({}),
    isReadyForDestiny: () => true,
    isIncrementalStaticVisibilityEntity,
    logMissileDebug: () => {},
    refreshEntitiesForSlimPayload: (entities) => entities,
    refreshShipPresentationFields: () => {},
    roundNumber: (value) => value,
    summarizeRuntimeEntityForMissileDebug: () => ({}),
    MICHELLE_HELD_FUTURE_DESTINY_LEAD: 3,
  }).sendStateRefresh(runtime, session, ego);

  assert.equal(sent.length, 2);
  assert.deepEqual(sent.map((entry) => entry.updates[0].payload), [
    ["SetState", [customsOffice.itemID, ego.itemID]],
    ["AddBalls2", [prop.itemID]],
  ]);
  assert.equal(sent[1].updates[0].stamp, sent[0].updates[0].stamp + 1);
});
