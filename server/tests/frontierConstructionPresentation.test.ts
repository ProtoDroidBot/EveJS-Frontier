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
  spaceRuntime.scenes.set(SYSTEM_ID, scene);

  function makeViewer(characterID, x, initialStateSent = true) {
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
        visibleDynamicEntityIDs: new Set(),
        historyFloorDestinyStamp: Math.floor(START_MS / 1000) - 1,
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
  const observer = makeViewer(OBSERVER_ID, 50);
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
  return { scene, owner, observer, freshViewer, farViewer };
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

  for (const viewer of [f.owner, f.observer, f.freshViewer]) {
    const updates = destinyUpdates(viewer.notifications);
    const completedItem = addedItem(updates, siteID);
    assert.ok(completedItem, "completion delivers a fresh type projection to every visible viewer");
    assert.equal(completedItem.get("typeID"), ASSEMBLY_TYPE_ID);
    assert.equal(completedItem.get("component_activate").items[0], false);
    assert.ok(completedItem.get("component_activate").items[1], "activation deadline is included");
    assert.equal(updates.find(update => containsTypeProjection(update.payload, ASSEMBLY_TYPE_ID)).payload[0],
      "AddBalls2", "full replacement precedes any CRData update with the new type");
    assert.equal(updates.some(update => update.payload[0] === "RemoveBalls"), false,
      "type replacement retains the Destiny ball so Frontier rebuilds its model and components");
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

test("construction completion follows an initial acquisition queued in the same scene tick", t => {
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
  f.scene.flushTickDestinyPresentationBatch();
  for (const viewer of [f.owner, f.observer]) {
    const updates = destinyUpdates(viewer.notifications);
    const additions = updates.filter(update => update.payload[0] === "AddBalls2")
      .map(update => addedItem([update], siteID)).filter(Boolean);
    assert.deepEqual(additions.map(item => item.get("typeID")), [SITE_TYPE_ID, ASSEMBLY_TYPE_ID],
      "the completed assembly is not suppressed by the pending site acquisition");
    assert.equal(updates.some(update => update.payload[0] === "RemoveBalls"), false);
    assert.equal(viewer.session._space.visibleDynamicEntityIDs.has(siteID), true);
    assert.equal(getPendingVisibilityAcquisitionIDs(viewer.session).has(siteID), false,
      "the original acquisition reservation commits without leaving a pending token");
  }
});
