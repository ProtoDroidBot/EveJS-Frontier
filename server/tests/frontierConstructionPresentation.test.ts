"use strict";

/** Run through scripts/Tests/run-isolated-tests.js against a disposable game store. */
const assert = require("node:assert/strict");
const test = require("node:test");
const reference = require("../src/services/_shared/referenceData");
const originalReadStaticRows = reference.readStaticRows;

const OWNER_ID = 140000003;
const OBSERVER_ID = 140000004;
const FRESH_VIEWER_ID = 140000005;
const FAR_VIEWER_ID = 140000006;
const VIEWER_IDS = [OWNER_ID, OBSERVER_ID, FRESH_VIEWER_ID, FAR_VIEWER_ID];
const SYSTEM_ID = 30000004;
const ASSEMBLY_TYPE_ID = 88082;
const SITE_TYPE_ID = 91715;
const SHIP_TYPE_ID = 95276;
const MATERIAL_ID = 84180;
const START_MS = 1700000000000;
const DURATION_SECONDS = 60;

test.mock.method(reference, "readStaticRows", table => (
  table === reference.TABLE.SPACE_COMPONENTS_BY_TYPE
    ? [{
      typeID: ASSEMBLY_TYPE_ID,
      smartDeployable: {
        createOnChain: 1,
        constructionCost: { [MATERIAL_ID]: 6 },
        constructionSite: SITE_TYPE_ID,
      },
      activate: { durationSeconds: DURATION_SECONDS },
    }]
    : originalReadStaticRows(table)
));

const itemStore = require("../src/services/inventory/itemStore");
const spaceRuntime = require("../src/space/runtime");
const energyRuntime = require("../src/services/frontier/networkNodeEnergyRuntime");
const deployment = require("../src/services/frontier/deploymentRuntime");
const { getPendingVisibilityAcquisitionIDs } = require("../src/space/destiny/visibility/acquisition");

function grant(ownerID, locationID, typeID, quantity, options: Record<string, any> = {}) {
  const result = itemStore.grantItemsToCharacterLocation(
    ownerID, locationID, locationID === SYSTEM_ID ? 0 : 5,
    [{ itemType: typeID, quantity, options }],
  );
  assert.equal(result.success, true, result.errorMsg);
  return result.data.items[0];
}

function fixture(t) {
  const previousScene = spaceRuntime.scenes.get(SYSTEM_ID);
  const originalItemIDs = new Set(
    VIEWER_IDS.flatMap(ownerID => (
      itemStore.listOwnedItems(ownerID).map(item => item.itemID)
    )),
  );
  t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: START_MS });
  deployment._testing.clearBuildDefinitionCache();
  deployment._testing.clearCompletionTimers();
  const scene = new spaceRuntime._testing.SolarSystemScene(SYSTEM_ID);
  t.mock.method(scene, "getCurrentSimTimeMs", () => scene.simTimeMs);
  spaceRuntime.scenes.set(SYSTEM_ID, scene);

  function makeViewer(characterID, x, initialStateSent = true, clockOffsetMs = 0) {
    const ship = grant(characterID, SYSTEM_ID, SHIP_TYPE_ID, 1, {
      individualItems: true,
      singleton: 1,
      spaceState: { systemID: SYSTEM_ID, position: { x, y: 0, z: 0 } },
    });
    const notifications: any[] = [];
    const session = {
      characterID,
      charid: characterID,
      clientID: characterID,
      solarsystemid: SYSTEM_ID,
      solarsystemid2: SYSTEM_ID,
      shipid: ship.itemID,
      compatibilityProfile: "frontier",
      socket: { destroyed: false },
      _space: {
        systemID: SYSTEM_ID,
        shipID: ship.itemID,
        initialStateSent,
        clockOffsetMs,
        visibleDynamicEntityIDs: new Set(),
        historyFloorDestinyStamp: Math.floor((START_MS + clockOffsetMs) / 1000) - 1,
      },
      sendNotification(...args) { notifications.push(args); return true; },
    };
    const entity = spaceRuntime._testing.buildShipEntityForTesting(session, ship, SYSTEM_ID);
    const spawned = scene.spawnDynamicEntity(entity, { broadcast: false });
    assert.equal(spawned.success, true, spawned.errorMsg);
    scene.sessions.set(characterID, session);
    return { ship, session, notifications };
  }

  const owner = makeViewer(OWNER_ID, 0);
  const observer = makeViewer(OBSERVER_ID, 50, true, 1500);
  const freshViewer = makeViewer(FRESH_VIEWER_ID, 75, false);
  const farViewer = makeViewer(FAR_VIEWER_ID, 1e12);
  grant(OWNER_ID, owner.ship.itemID, MATERIAL_ID, 6);
  t.mock.method(itemStore, "getActiveShipItem", () => itemStore.findItemById(owner.ship.itemID));
  t.mock.method(energyRuntime, "reconcileNetworkNodeEnergy", () => {});
  const listOwnedItems = itemStore.listOwnedItems;
  t.mock.method(itemStore, "listOwnedItems", (...args) => (
    listOwnedItems(...args).filter(item => !originalItemIDs.has(item.itemID))
  ));
  t.after(() => {
    deployment._testing.clearCompletionTimers();
    for (const characterID of VIEWER_IDS) {
      for (const item of itemStore.listOwnedItems(characterID)) {
        if (!originalItemIDs.has(item.itemID)) {
          itemStore.removeInventoryItem(item.itemID, { removeContents: true });
        }
      }
    }
    if (previousScene) spaceRuntime.scenes.set(SYSTEM_ID, previousScene);
    else spaceRuntime.scenes.delete(SYSTEM_ID);
  });
  return {
    scene, owner, observer, freshViewer, farViewer,
    syncAt(simTimeMs, viewers = [owner, observer, freshViewer, farViewer]) {
      scene.simTimeMs = simTimeMs;
      scene.processPendingNativeBallReplacements(simTimeMs);
      for (const { session } of viewers) {
        scene.syncDynamicVisibilityForSession(session, simTimeMs);
      }
      scene.flushDirectDestinyNotificationBatchIfIdle();
    },
  };
}

function destinyUpdates(notifications) {
  const result: any[] = [];
  function visit(value) {
    if (!value || typeof value !== "object" || Buffer.isBuffer(value)) return;
    if (Array.isArray(value)) {
      if (typeof value[0] === "number" && Array.isArray(value[1]) && typeof value[1][0] === "string") {
        result.push({ stamp: value[0], payload: value[1] });
        return;
      }
      for (const entry of value) visit(entry);
      return;
    }
    for (const entry of Object.values(value)) visit(entry);
  }
  for (const [name, , payload] of notifications) {
    if (name === "DoDestinyUpdate") visit(payload);
  }
  return result;
}

function addedItem(updates, itemID) {
  for (const update of updates) {
    if (update.payload[0] !== "AddBalls2") continue;
    const entry = update.payload[1][0][1].items.find(row => Number(row[0]) === itemID);
    if (entry) return new Map<string, any>(entry[1].entries);
  }
  return null;
}

function containsTypeProjection(value, typeID) {
  if (!value || typeof value !== "object" || Buffer.isBuffer(value)) return false;
  if (Array.isArray(value)) {
    if (value[0] === "typeID" && value[1] === typeID) return true;
    return value.some(entry => containsTypeProjection(entry, typeID));
  }
  return Object.values(value).some(entry => containsTypeProjection(entry, typeID));
}

function removalFor(viewer, itemID) {
  return destinyUpdates(viewer.notifications).find(update => (
    update.payload[0] === "RemoveBalls" &&
    (update.payload[1][0].items || update.payload[1][0]).includes(itemID)
  ));
}

function earliestRecreationTime(viewers, itemID) {
  return Math.max(...viewers.map(viewer => {
    const removal = removalFor(viewer, itemID);
    assert.ok(removal, "the old native ball must be removed before its ID is reused");
    return (removal.stamp + 1) * 1000 - viewer.session._space.clockOffsetMs;
  }));
}

function recreationDeadline(scene, itemID) {
  const replacement = scene.pendingNativeBallReplacements.get(itemID);
  return Math.max(
    scene.getEntityByID(itemID).visibilitySuppressedUntilMs,
    ...[...replacement.viewers.values()].map(viewer => viewer.releaseAtMs),
  );
}

test("final construction deposit replaces the visible site for its owner and nearby observers", t => {
  const f = fixture(t);
  const placed = deployment.buildDeployable(
    f.owner.session, ASSEMBLY_TYPE_ID, [100, 0, 0], [0, 0, 0],
  );
  assert.equal(placed.success, true, placed.errorMsg);
  const siteID = placed.data.item.itemID;
  for (const viewer of [f.owner, f.observer]) {
    const initialItem = addedItem(destinyUpdates(viewer.notifications), siteID);
    assert.ok(initialItem, "nearby viewer initially receives the construction site");
    assert.equal(initialItem.get("typeID"), SITE_TYPE_ID);
    assert.equal(viewer.session._space.visibleDynamicEntityIDs.has(siteID), true);
    viewer.notifications.length = 0;
  }
  for (const viewer of [f.freshViewer, f.farViewer]) {
    assert.equal(addedItem(destinyUpdates(viewer.notifications), siteID), null);
  }

  const partial = deployment.depositItems(
    f.owner.session, siteID, f.owner.ship.itemID, { [MATERIAL_ID]: 3 },
  );
  assert.equal(partial.success, true, partial.errorMsg);
  assert.equal(f.scene.getEntityByID(siteID).typeID, SITE_TYPE_ID);
  for (const viewer of [f.owner, f.observer]) {
    assert.equal(addedItem(destinyUpdates(viewer.notifications), siteID), null,
      "partial deposits do not reload the construction site's model");
    viewer.notifications.length = 0;
  }
  f.freshViewer.session._space.initialStateSent = true;

  const deposited = deployment.depositItems(
    f.owner.session, siteID, f.owner.ship.itemID, { [MATERIAL_ID]: 3 },
  );
  assert.equal(deposited.success, true, deposited.errorMsg);
  assert.equal(itemStore.findItemById(siteID).typeID, ASSEMBLY_TYPE_ID);
  assert.equal(f.scene.getEntityByID(siteID).typeID, ASSEMBLY_TYPE_ID);
  assert.equal(f.scene.getEntityByID(siteID).activate_comp_durationSeconds, DURATION_SECONDS);

  const earliestAt = earliestRecreationTime([f.owner, f.observer], siteID);
  const readyAt = recreationDeadline(f.scene, siteID);
  assert.ok(Number.isFinite(readyAt) && readyAt >= earliestAt);
  assert.ok(readyAt > f.scene.getCurrentSimTimeMs());
  for (const viewer of [f.owner, f.observer, f.freshViewer]) {
    assert.equal(addedItem(destinyUpdates(viewer.notifications), siteID), null,
      "the completed assembly waits for the old object's native removal tick");
    assert.equal(viewer.session._space.visibleDynamicEntityIDs.has(siteID), false);
  }
  // Wall time can advance independently under TiDi. It must not release the
  // replacement before every observer has crossed its removal stamp.
  t.mock.timers.tick(10_000);
  f.syncAt(readyAt - 1);
  f.scene.broadcastAddBalls([f.scene.getEntityByID(siteID)]);
  for (const viewer of [f.owner, f.observer, f.freshViewer]) {
    assert.equal(addedItem(destinyUpdates(viewer.notifications), siteID), null);
  }
  f.syncAt(readyAt);

  for (const viewer of [f.owner, f.observer, f.freshViewer]) {
    const updates = destinyUpdates(viewer.notifications);
    const completedItem = addedItem(updates, siteID);
    assert.ok(completedItem, "completion delivers a fresh type projection to every visible viewer");
    assert.equal(completedItem.get("typeID"), ASSEMBLY_TYPE_ID);
    assert.equal(completedItem.get("component_activate").items[0], false);
    assert.ok(completedItem.get("component_activate").items[1], "activation deadline is included");
    assert.equal(updates.find(update => containsTypeProjection(update.payload, ASSEMBLY_TYPE_ID)).payload[0],
      "AddBalls2", "full replacement precedes any CRData update with the new type");
    const removal = removalFor(viewer, siteID);
    if (removal) {
      const addition = updates.find(update => addedItem([update], siteID));
      assert.ok(addition.stamp > removal.stamp,
        "a fresh native object is acquired strictly after the old object's removal stamp");
    }
    assert.equal(viewer.session._space.visibleDynamicEntityIDs.has(siteID), true);
    viewer.notifications.length = 0;
  }
  assert.equal(addedItem(destinyUpdates(f.farViewer.notifications), siteID), null,
    "out-of-range sessions do not receive the replacement");
  assert.equal(f.farViewer.session._space.visibleDynamicEntityIDs.has(siteID), false);

  f.scene.broadcastAddBalls([f.scene.getEntityByID(siteID)]);
  for (const viewer of [f.owner, f.observer, f.freshViewer]) {
    assert.equal(addedItem(destinyUpdates(viewer.notifications), siteID), null,
      "ordinary visibility broadcasts still suppress duplicate acquisitions");
  }
});

test("a rejected removal is retried after the initial delay without leaving a stale icon", t => {
  const f = fixture(t);
  const placed = deployment.buildDeployable(
    f.owner.session, ASSEMBLY_TYPE_ID, [100, 0, 0], [0, 0, 0],
  );
  assert.equal(placed.success, true, placed.errorMsg);
  const siteID = placed.data.item.itemID;
  for (const viewer of [f.owner, f.observer]) viewer.notifications.length = 0;
  const sendRemove = f.scene.sendRemoveBallsToSession;
  let rejected = false;
  t.mock.method(f.scene, "sendRemoveBallsToSession", (session, ids, options) => {
    if (session === f.observer.session && !rejected) {
      rejected = true;
      return { delivered: false, removedIDs: [] };
    }
    return sendRemove.call(f.scene, session, ids, options);
  });
  assert.equal(deployment.depositItems(
    f.owner.session, siteID, f.owner.ship.itemID, { [MATERIAL_ID]: 6 },
  ).success, true);
  assert.equal(removalFor(f.observer, siteID), undefined);
  assert.equal(f.observer.session._space.visibleDynamicEntityIDs.has(siteID), true);
  f.scene.broadcastSlimItemChanges([f.scene.getEntityByID(siteID)]);
  assert.equal(destinyUpdates(f.observer.notifications).some(update => (
    containsTypeProjection(update.payload, ASSEMBLY_TYPE_ID)
  )), false, "new-type CRData cannot reach a viewer whose old object was not removed");

  // The first reconciliation is deliberately after the original gate expired.
  f.syncAt(START_MS + 5000);
  assert.ok(removalFor(f.observer, siteID), "failed native removal retains its retry intent");
  assert.equal(addedItem(destinyUpdates(f.observer.notifications), siteID), null,
    "a retried removal still receives its own teardown interval");
  assert.equal(addedItem(destinyUpdates(f.owner.notifications), siteID).get("typeID"), ASSEMBLY_TYPE_ID,
    "a delayed observer does not block an already-released owner's replacement");
  f.syncAt(START_MS + 10_000);
  const updates = destinyUpdates(f.observer.notifications);
  assert.equal(addedItem(updates, siteID).get("typeID"), ASSEMBLY_TYPE_ID);
  assert.ok(updates.find(update => addedItem([update], siteID)).stamp > removalFor(f.observer, siteID).stamp);
  assert.equal(f.scene.pendingNativeBallReplacements.has(siteID), false);
});

test("a delayed first removal does not hide an already recreated assembly from other viewers", t => {
  const f = fixture(t);
  const placed = deployment.buildDeployable(
    f.owner.session, ASSEMBLY_TYPE_ID, [100, 0, 0], [0, 0, 0],
  );
  assert.equal(placed.success, true, placed.errorMsg);
  const siteID = placed.data.item.itemID;
  for (const viewer of [f.owner, f.observer]) viewer.notifications.length = 0;
  const sendRemove = f.scene.sendRemoveBallsToSession;
  let deferredRemoval: any = null;
  let deferObserver = true;
  t.mock.method(f.scene, "sendRemoveBallsToSession", (session, ids, options) => {
    if (session === f.observer.session && deferObserver) {
      deferredRemoval ||= { ids, options };
      return { delivered: true, removedIDs: ids };
    }
    return sendRemove.call(f.scene, session, ids, options);
  });
  assert.equal(deployment.depositItems(
    f.owner.session, siteID, f.owner.ship.itemID, { [MATERIAL_ID]: 6 },
  ).success, true);
  f.syncAt(START_MS + 3000, [f.owner]);
  assert.equal(addedItem(destinyUpdates(f.owner.notifications), siteID).get("typeID"), ASSEMBLY_TYPE_ID);
  assert.equal(addedItem(destinyUpdates(f.observer.notifications), siteID), null);
  assert.equal(f.observer.session._space.visibleDynamicEntityIDs.has(siteID), true,
    "the observer still holds the old object until its deferred removal commits");
  f.owner.notifications.length = 0;

  f.scene.simTimeMs = START_MS + 6000;
  deferObserver = false;
  const deliveredRemoval = sendRemove.call(f.scene, f.observer.session, deferredRemoval.ids, {
    ...deferredRemoval.options, nowMs: f.scene.simTimeMs,
  });
  assert.equal(deliveredRemoval.delivered, true);
  assert.ok(f.scene.pendingNativeBallReplacements.get(siteID).viewers.get(f.observer.session).releaseAtMs >
    f.scene.simTimeMs, "the delayed first callback schedules the observer's teardown interval");
  f.syncAt(START_MS + 6000);
  assert.equal(removalFor(f.owner, siteID), undefined,
    "another viewer's late first commit must not suppress the owner's new object");
  assert.equal(f.owner.session._space.visibleDynamicEntityIDs.has(siteID), true);
  assert.equal(addedItem(destinyUpdates(f.observer.notifications), siteID), null);
  f.syncAt(START_MS + 10_000);
  assert.equal(addedItem(destinyUpdates(f.observer.notifications), siteID).get("typeID"), ASSEMBLY_TYPE_ID);
});

for (const flushDelayMs of [0, 5000]) {
  test(`construction completion recreates a queued site after a ${flushDelayMs}ms delivery delay`, t => {
    const f = fixture(t);
    f.scene.beginTickDestinyPresentationBatch();
    const placed = deployment.buildDeployable(
      f.owner.session, ASSEMBLY_TYPE_ID, [100, 0, 0], [0, 0, 0],
    );
    assert.equal(placed.success, true, placed.errorMsg);
    const siteID = placed.data.item.itemID;
    for (const viewer of [f.owner, f.observer]) {
      assert.equal(viewer.session._space.visibleDynamicEntityIDs.has(siteID), false,
        "visibility is committed only after the queued delivery succeeds");
      assert.equal(getPendingVisibilityAcquisitionIDs(viewer.session).has(siteID), true);
    }
    const deposited = deployment.depositItems(
      f.owner.session, siteID, f.owner.ship.itemID, { [MATERIAL_ID]: 6 },
    );
    assert.equal(deposited.success, true, deposited.errorMsg);
    f.scene.simTimeMs += flushDelayMs;
    f.scene.flushTickDestinyPresentationBatch();
    const earliestAt = earliestRecreationTime([f.owner, f.observer], siteID);
    const readyAt = recreationDeadline(f.scene, siteID);
    assert.ok(Number.isFinite(readyAt) && readyAt >= earliestAt);
    assert.ok(readyAt > f.scene.simTimeMs,
      "even delayed delivery waits for a tick after the removal was actually accepted");
    for (const viewer of [f.owner, f.observer]) {
      const updates = destinyUpdates(viewer.notifications);
      const additions = updates.filter(update => update.payload[0] === "AddBalls2")
        .map(update => addedItem([update], siteID)).filter(Boolean);
      assert.deepEqual(additions.map(item => item.get("typeID")), [SITE_TYPE_ID],
        "the queued site is torn down before a replacement can be acquired");
      assert.equal(viewer.session._space.visibleDynamicEntityIDs.has(siteID), false);
      assert.equal(getPendingVisibilityAcquisitionIDs(viewer.session).has(siteID), false,
        "the original acquisition reservation commits without leaving a pending token");
    }
    f.syncAt(readyAt - 1);
    f.syncAt(readyAt);
    for (const viewer of [f.owner, f.observer]) {
      const updates = destinyUpdates(viewer.notifications);
      const additions = updates.filter(update => update.payload[0] === "AddBalls2")
        .map(update => ({ update, item: addedItem([update], siteID) })).filter(entry => entry.item);
      assert.deepEqual(additions.map(entry => entry.item.get("typeID")), [SITE_TYPE_ID, ASSEMBLY_TYPE_ID]);
      assert.ok(additions[1].update.stamp > removalFor(viewer, siteID).stamp);
      assert.equal(viewer.session._space.visibleDynamicEntityIDs.has(siteID), true);
      assert.equal(getPendingVisibilityAcquisitionIDs(viewer.session).has(siteID), false);
    }
  });
}
