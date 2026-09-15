"use strict";

/** Run through scripts/Tests/run-isolated-tests.js against a disposable game store. */
const assert = require("node:assert/strict");
const test = require("node:test");
const reference = require("../src/services/_shared/referenceData");
const originalReadStaticRows = reference.readStaticRows;

const OWNER_ID = 140000003;
const SYSTEM_ID = 30000004;
const NODE_TYPE_ID = 88092;
const FIELD_TYPE_ID = 87161;
const ASSEMBLY_TYPE_ID = 88082;
const SITE_TYPE_ID = 91715;
const SHIP_TYPE_ID = 95276;
const MATERIAL_A = 84180;
const MATERIAL_B = 84210;
const START_MS = 1700000000000;
const DURATION_SECONDS = 60;
const DURATION_MS = DURATION_SECONDS * 1000;
const COST = { [MATERIAL_A]: 6, [MATERIAL_B]: 4 };
const COMPONENTS = [
  {
    typeID: NODE_TYPE_ID,
    smartDeployable: { createOnChain: 1, constructionCost: COST, constructionSite: SITE_TYPE_ID },
    activate: { durationSeconds: DURATION_SECONDS },
  },
  {
    typeID: FIELD_TYPE_ID,
    smartDeployable: { createOnChain: 0, constructionCost: COST, constructionSite: SITE_TYPE_ID },
    activate: { durationSeconds: DURATION_SECONDS },
  },
  {
    typeID: ASSEMBLY_TYPE_ID,
    smartDeployable: {
      createOnChain: 1,
      constructionCost: COST,
      constructionSite: SITE_TYPE_ID,
    },
    activate: { durationSeconds: DURATION_SECONDS },
  },
];

test.mock.method(reference, "readStaticRows", table => (
  table === reference.TABLE.SPACE_COMPONENTS_BY_TYPE
    ? COMPONENTS
    : originalReadStaticRows(table)
));

const itemStore = require("../src/services/inventory/itemStore");
const spaceRuntime = require("../src/space/runtime");
const energyRuntime = require("../src/services/frontier/networkNodeEnergyRuntime");
const deployment = require("../src/services/frontier/deploymentRuntime");

function grant(locationID, typeID, quantity, options: Record<string, any> = {}) {
  const result = itemStore.grantItemsToCharacterLocation(
    OWNER_ID,
    locationID,
    locationID === SYSTEM_ID ? 0 : 5,
    [{ itemType: typeID, quantity, options }],
  );
  assert.equal(result.success, true, result.errorMsg);
  return result.data.items;
}

function fixture(t) {
  const originalItemIDs = new Set(
    itemStore.listOwnedItems(OWNER_ID).map(item => item.itemID),
  );
  const previousScene = spaceRuntime.scenes.get(SYSTEM_ID);
  const entities = new Map<number, any>();
  const notifications: any[] = [];
  const broadcasts: any[] = [];
  const scene = {
    getEntityByID(itemID) { return entities.get(Number(itemID)) || null; },
    broadcastSlimItemChanges(items) {
      broadcasts.push(...items.map(entity => structuredClone(entity)));
    },
  };
  spaceRuntime.scenes.set(SYSTEM_ID, scene);
  t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: START_MS });
  const [ship] = grant(SYSTEM_ID, SHIP_TYPE_ID, 1, {
    individualItems: true,
    singleton: 1,
    spaceState: { systemID: SYSTEM_ID, position: { x: 0, y: 0, z: 0 } },
  });
  grant(ship.itemID, MATERIAL_A, COST[MATERIAL_A] * 4);
  grant(ship.itemID, MATERIAL_B, COST[MATERIAL_B] * 4);
  const session = {
    characterID: OWNER_ID,
    solarsystemid2: SYSTEM_ID,
    shipid: ship.itemID,
    sendNotification(...args) { notifications.push(args); },
  };
  const spawn = t.mock.method(spaceRuntime, "spawnDynamicInventoryEntity", (_systemID, itemID) => {
    const item = itemStore.findItemById(itemID);
    const entity = deployment.hydrateConstructionEntityFromInventoryItem({
      itemID, typeID: item.typeID, position: item.spaceState.position,
    }, item);
    entities.set(Number(itemID), entity);
    return { success: true, data: entity };
  });
  const remove = t.mock.method(spaceRuntime, "removeDynamicEntity", (_systemID, itemID) => {
    entities.delete(Number(itemID));
    return { success: true };
  });
  t.mock.method(itemStore, "getActiveShipItem", () => itemStore.findItemById(ship.itemID));
  t.mock.method(spaceRuntime, "getEntity", (_session, itemID) => (
    Number(itemID) === Number(ship.itemID)
      ? { itemID: ship.itemID, position: { x: 0, y: 0, z: 0 } }
      : entities.get(Number(itemID)) || null
  ));
  // Existing baseline assemblies must not provide an unrelated build anchor
  // or exhaust the site's placement limit in this disposable fixture.
  const listOwnedItems = itemStore.listOwnedItems;
  const listSystemSpaceItems = itemStore.listSystemSpaceItems;
  t.mock.method(itemStore, "listOwnedItems", (...args) => (
    listOwnedItems(...args).filter(item => !originalItemIDs.has(item.itemID))
  ));
  t.mock.method(itemStore, "listSystemSpaceItems", (...args) => (
    listSystemSpaceItems(...args).filter(item => !originalItemIDs.has(item.itemID))
  ));
  t.mock.method(energyRuntime, "reconcileNetworkNodeEnergy", () => {});
  deployment._testing.clearBuildDefinitionCache();
  deployment._testing.clearCompletionTimers();
  deployment._testing.clearPendingAssemblyTransitions();
  t.after(() => {
    deployment._testing.clearCompletionTimers();
    deployment._testing.clearPendingAssemblyTransitions();
    for (const item of itemStore.listOwnedItems(OWNER_ID)) {
      if (!originalItemIDs.has(item.itemID)) {
        itemStore.removeInventoryItem(item.itemID, { removeContents: true });
      }
    }
    if (previousScene) spaceRuntime.scenes.set(SYSTEM_ID, previousScene);
    else spaceRuntime.scenes.delete(SYSTEM_ID);
  });

  return {
    ship, session, entities, notifications, broadcasts, spawn, remove,
    place(typeID, position = [100, 0, 0]) {
      return deployment.buildDeployable(session, typeID, position, [0.2, 0.1, 0.3]);
    },
    tick(milliseconds) { t.mock.timers.tick(milliseconds); },
    item(itemID) { return itemStore.findItemById(itemID); },
    state(itemID) { return deployment.readConstructionState(itemStore.findItemById(itemID)); },
  };
}

function assertActivating(f, itemID, deadline) {
  const state = f.state(itemID);
  assert.equal(state.assemblyStatus, deployment.ASSEMBLY_STATUS_OFFLINE);
  assert.equal(state.activationCompleteAtMs, deadline);
  assert.equal(deployment.isAssemblyActivationPending(f.item(itemID)), true);
  assert.deepEqual(f.entities.get(itemID).component_activate, [false, deadline]);
  assert.equal(f.entities.get(itemID).activate_comp_durationSeconds, DURATION_SECONDS);
}

for (const [label, typeID, finalStatus] of [
  ["Network Node", NODE_TYPE_ID, 1],
  ["field structure", FIELD_TYPE_ID, 2],
]) {
  test(`direct ${label} placement remains inactive until its configured timer expires`, t => {
    const f = fixture(t);
    const placed = f.place(typeID);
    assert.equal(placed.success, true, placed.errorMsg);
    const itemID = placed.data.item.itemID;
    assert.equal(placed.data.item.typeID, typeID);
    assertActivating(f, itemID, START_MS + DURATION_MS);

    f.tick(DURATION_MS - 1);
    assertActivating(f, itemID, START_MS + DURATION_MS);
    f.tick(1);
    assert.equal(f.state(itemID).activationCompleteAtMs, 0);
    assert.equal(f.state(itemID).assemblyStatus, finalStatus);
    assert.equal(deployment.isAssemblyActivationPending(f.item(itemID)), false);
    assert.deepEqual(f.entities.get(itemID).component_activate, [true, null]);
    assert.equal(f.entities.get(itemID).assembly_status, finalStatus);
    assert.equal(f.broadcasts.filter(entity => entity.itemID === itemID).length, 1);
    assert.equal(f.spawn.mock.callCount(), 1, "activation updates the deployed entity in place");
  });
}

test("an anchoring Network Node cannot go online or extend construction range", t => {
  const f = fixture(t);
  const placed = f.place(NODE_TYPE_ID);
  assert.equal(placed.success, true, placed.errorMsg);
  const nodeID = placed.data.item.itemID;
  assert.equal(deployment._testing.isCompletedNetworkNodeBuildAnchorState(f.state(nodeID)), false);
  const online = deployment.beginAssemblyStateTransition(
    f.session, nodeID, deployment.ASSEMBLY_STATUS_ONLINE,
  );
  assert.equal(online.success, false);
  assert.equal(online.errorMsg, "ASSEMBLY_ACTIVATING");
  const prematureSite = f.place(ASSEMBLY_TYPE_ID, [10_000, 0, 0]);
  assert.equal(prematureSite.success, false);
  assert.equal(prematureSite.errorMsg, "DEPLOYMENT_TOO_FAR");

  f.tick(DURATION_MS);
  assert.equal(deployment._testing.isCompletedNetworkNodeBuildAnchorState(f.state(nodeID)), true);
  const site = f.place(ASSEMBLY_TYPE_ID, [10_000, 0, 0]);
  assert.equal(site.success, true, site.errorMsg);
  assert.equal(site.data.buildAnchor, "network-node");
  assert.equal(site.data.buildAnchorItemID, nodeID);
});

test("the last construction deposit replaces the site immediately and starts the assembly timer", t => {
  const f = fixture(t);
  assert.equal(f.place(NODE_TYPE_ID).success, true);
  f.tick(DURATION_MS);
  const placed = f.place(ASSEMBLY_TYPE_ID, [10_000, 200, 300]);
  assert.equal(placed.success, true, placed.errorMsg);
  const siteID = placed.data.item.itemID;
  const originalSpaceState = structuredClone(placed.data.item.spaceState);
  assert.equal(f.item(siteID).typeID, SITE_TYPE_ID);

  const partial = deployment.depositItems(f.session, siteID, f.ship.itemID, { [MATERIAL_A]: 6 });
  assert.equal(partial.success, true, partial.errorMsg);
  f.tick(DURATION_MS * 2);
  assert.equal(f.item(siteID).typeID, SITE_TYPE_ID);
  assert.equal(f.state(siteID).assemblyStatus, deployment.ASSEMBLY_STATUS_UNDER_CONSTRUCTION);
  assert.equal(f.state(siteID).completeAtMs, 0);
  assert.equal(f.state(siteID).activationCompleteAtMs, 0);
  assert.equal(f.entities.get(siteID).component_activate, undefined);
  const depositedMaterialIDs = itemStore.listContainerItems(OWNER_ID, siteID, null)
    .map(item => item.itemID);

  f.notifications.length = 0;
  const deadline = Date.now() + DURATION_MS;
  const deposited = deployment.depositItems(f.session, siteID, f.ship.itemID, { [MATERIAL_B]: 4 });
  assert.equal(deposited.success, true, deposited.errorMsg);
  assert.equal(f.item(siteID).itemID, siteID);
  assert.equal(f.item(siteID).typeID, ASSEMBLY_TYPE_ID);
  assert.deepEqual(f.item(siteID).spaceState, originalSpaceState);
  assert.equal(f.entities.get(siteID).typeID, ASSEMBLY_TYPE_ID);
  assert.equal(f.remove.mock.callCount(), 1, "the construction site is removed from the scene");
  assert.equal(f.spawn.mock.callCount(), 3, "the node, site, and replacement assembly are spawned");
  assert.deepEqual(itemStore.listContainerItems(OWNER_ID, siteID, null), []);
  assertActivating(f, siteID, deadline);
  const inventoryRows = f.notifications.filter(args => args[0] === "OnItemsChanged")
    .flatMap(([, , payload]) => payload[0].items.map(row => row.fields));
  for (const materialID of depositedMaterialIDs) {
    assert.equal(f.item(materialID), null);
    assert.ok(inventoryRows.some(row => row.itemID === materialID && row.locationID === 6),
      "completion removes deposited materials from the client inventory");
  }
  assert.ok(inventoryRows.some(row => row.itemID === siteID && row.typeID === ASSEMBLY_TYPE_ID),
    "completion publishes the replacement type immediately");
  const online = deployment.beginAssemblyStateTransition(
    f.session, siteID, deployment.ASSEMBLY_STATUS_ONLINE,
  );
  assert.equal(online.errorMsg, "ASSEMBLY_ACTIVATING");

  f.tick(DURATION_MS - 1);
  assertActivating(f, siteID, deadline);
  f.tick(1);
  assert.equal(f.state(siteID).assemblyStatus, deployment.ASSEMBLY_STATUS_OFFLINE);
  assert.equal(deployment.isAssemblyActivationPending(f.item(siteID)), false);
  assert.deepEqual(f.entities.get(siteID).component_activate, [true, null]);
});

test("early completion attempts preserve the deadline and completion is applied exactly once", t => {
  const f = fixture(t);
  const placed = f.place(FIELD_TYPE_ID);
  assert.equal(placed.success, true, placed.errorMsg);
  const itemID = placed.data.item.itemID;
  f.tick(DURATION_MS - 1);
  const before = f.item(itemID).customInfo;
  const early = deployment.completeAssemblyActivation(itemID, { session: f.session });
  assert.equal(early.success, true, early.errorMsg);
  assert.equal(f.item(itemID).customInfo, before);
  assertActivating(f, itemID, START_MS + DURATION_MS);

  f.tick(1);
  assert.equal(f.state(itemID).assemblyStatus, deployment.ASSEMBLY_STATUS_ONLINE);
  const after = f.item(itemID).customInfo;
  const notificationCount = f.notifications.length;
  const broadcastCount = f.broadcasts.length;
  assert.equal(deployment.completeAssemblyActivation(itemID, { session: f.session }).success, true);
  f.tick(DURATION_MS * 2);
  assert.equal(f.item(itemID).customInfo, after);
  assert.equal(f.notifications.length, notificationCount);
  assert.equal(f.broadcasts.length, broadcastCount);
  assert.equal(broadcastCount, 1);
});

test("activation retries a failed completion save without making the assembly usable early", t => {
  const f = fixture(t);
  const placed = f.place(FIELD_TYPE_ID);
  assert.equal(placed.success, true, placed.errorMsg);
  const itemID = placed.data.item.itemID;
  const originalUpdate = itemStore.updateInventoryItem;
  let failOnce = true;
  t.mock.method(itemStore, "updateInventoryItem", (...args) => {
    if (args[0] === itemID && failOnce) {
      failOnce = false;
      return { success: false, errorMsg: "WRITE_ERROR" };
    }
    return originalUpdate(...args);
  });
  f.tick(DURATION_MS);
  assertActivating(f, itemID, START_MS + DURATION_MS);
  assert.equal(f.broadcasts.length, 0);
  f.tick(999);
  assert.equal(deployment.isAssemblyActivationPending(f.item(itemID)), true);
  f.tick(1);
  assert.equal(f.state(itemID).assemblyStatus, deployment.ASSEMBLY_STATUS_ONLINE);
  assert.equal(deployment.isAssemblyActivationPending(f.item(itemID)), false);
  assert.equal(f.broadcasts.length, 1);
});

test("hydrating a persisted activating assembly resumes only the remaining timer", t => {
  const f = fixture(t);
  const placed = f.place(FIELD_TYPE_ID);
  assert.equal(placed.success, true, placed.errorMsg);
  const itemID = placed.data.item.itemID;
  f.tick(DURATION_MS / 2);
  deployment._testing.clearCompletionTimers();
  const entity = { itemID, typeID: FIELD_TYPE_ID };
  f.entities.set(itemID, entity);
  deployment.hydrateConstructionEntityFromInventoryItem(entity, f.item(itemID));
  deployment.hydrateConstructionEntityFromInventoryItem(entity, f.item(itemID));
  assertActivating(f, itemID, START_MS + DURATION_MS);

  f.tick(DURATION_MS / 2 - 1);
  assertActivating(f, itemID, START_MS + DURATION_MS);
  f.tick(1);
  assert.equal(f.state(itemID).assemblyStatus, deployment.ASSEMBLY_STATUS_ONLINE);
  assert.deepEqual(f.entities.get(itemID).component_activate, [true, null]);
  assert.equal(f.broadcasts.length, 1, "repeated hydration does not duplicate completion");
});

test("hydrating an overdue persisted activation completes it without restarting the duration", t => {
  const f = fixture(t);
  const placed = f.place(FIELD_TYPE_ID);
  assert.equal(placed.success, true, placed.errorMsg);
  const itemID = placed.data.item.itemID;
  deployment._testing.clearCompletionTimers();
  t.mock.timers.setTime(START_MS + DURATION_MS + 5_000);
  deployment.hydrateConstructionEntityFromInventoryItem(f.entities.get(itemID), f.item(itemID));
  f.tick(0);
  assert.equal(f.state(itemID).activationCompleteAtMs, 0);
  assert.equal(f.state(itemID).assemblyStatus, deployment.ASSEMBLY_STATUS_ONLINE);
  assert.deepEqual(f.entities.get(itemID).component_activate, [true, null]);
  assert.equal(f.broadcasts.length, 1);
});

test("legacy completed assemblies without an activation deadline remain active when hydrated", t => {
  const f = fixture(t);
  const [item] = grant(SYSTEM_ID, FIELD_TYPE_ID, 1, { individualItems: true, singleton: 1 });
  const saved = itemStore.updateInventoryItem(item.itemID, current => ({
    ...current,
    customInfo: JSON.stringify({
      [deployment.CONSTRUCTION_INFO_KEY]: {
        assemblyTypeID: FIELD_TYPE_ID,
        assemblyStatus: deployment.ASSEMBLY_STATUS_ONLINE,
        completedAtMs: START_MS - DURATION_MS,
        durationSeconds: DURATION_SECONDS,
        ownerID: OWNER_ID,
        solarSystemID: SYSTEM_ID,
      },
    }),
  }));
  assert.equal(saved.success, true, saved.errorMsg);
  const entity: Record<string, any> = { itemID: item.itemID, typeID: FIELD_TYPE_ID };
  deployment.hydrateConstructionEntityFromInventoryItem(entity, saved.data);
  assert.deepEqual(entity.component_activate, [true, null]);
  assert.equal(deployment.isAssemblyActivationPending(saved.data), false);
  f.tick(DURATION_MS * 2);
  assert.equal(f.item(item.itemID).customInfo, saved.data.customInfo);
  assert.equal(f.broadcasts.length, 0);
});

test("portable structures deploy directly away from nodes and use construction sites near an owned node", t => {
  const f = fixture(t);
  const portable = f.place(FIELD_TYPE_ID);
  assert.equal(portable.success, true, portable.errorMsg);
  assert.equal(portable.data.directPlacement, true);
  assert.equal(portable.data.item.typeID, FIELD_TYPE_ID);
  assertActivating(f, portable.data.item.itemID, START_MS + DURATION_MS);

  const node = f.place(NODE_TYPE_ID, [200, 0, 0]);
  assert.equal(node.success, true, node.errorMsg);
  assert.equal(node.data.directPlacement, true,
    "a Network Node deploys directly even when its definition references a site");
  assert.equal(node.data.item.typeID, NODE_TYPE_ID);
  f.tick(DURATION_MS);

  const nearNode = f.place(FIELD_TYPE_ID, [1_000, 0, 0]);
  assert.equal(nearNode.success, true, nearNode.errorMsg);
  assert.equal(nearNode.data.item.typeID, SITE_TYPE_ID,
    "the node's zone selects a site even when placement is also within ship range");
  assert.equal(f.state(nearNode.data.item.itemID).assemblyStatus,
    deployment.ASSEMBLY_STATUS_UNDER_CONSTRUCTION);
  const deposited = deployment.depositItems(
    f.session, nearNode.data.item.itemID, f.ship.itemID, COST,
  );
  assert.equal(deposited.success, true, deposited.errorMsg);
  assert.equal(f.item(nearNode.data.item.itemID).typeID, FIELD_TYPE_ID);
  assertActivating(f, nearNode.data.item.itemID, START_MS + DURATION_MS * 2);
  f.tick(DURATION_MS);
  assert.equal(f.state(nearNode.data.item.itemID).assemblyStatus, deployment.ASSEMBLY_STATUS_ONLINE);
});

test("dismantling returns construction materials and every user partition in capacity-sized cargo containers", t => {
  const f = fixture(t);
  const placed = f.place(FIELD_TYPE_ID);
  assert.equal(placed.success, true, placed.errorMsg);
  const assemblyID = placed.data.item.itemID;
  const visitorID = OWNER_ID + 1;
  const originalGetMetadata = itemStore.getItemMetadata;
  const originalGetUnitVolume = itemStore.getInventoryItemUnitVolume;
  const originalGetPackagedVolume = itemStore.getPackagedVolumeForType;
  t.mock.method(itemStore, "getItemMetadata", (typeID, ...args) => ({
    ...originalGetMetadata(typeID, ...args),
    ...(Number(typeID) === 23 ? { capacity: 25 } : {}),
  }));
  t.mock.method(itemStore, "getInventoryItemUnitVolume", item => (
    [MATERIAL_A, MATERIAL_B].includes(Number(item && item.typeID))
      ? 10
      : originalGetUnitVolume(item)
  ));
  t.mock.method(itemStore, "getPackagedVolumeForType", (typeID, metadata) => (
    [MATERIAL_A, MATERIAL_B].includes(Number(typeID))
      ? 10
      : originalGetPackagedVolume(typeID, metadata)
  ));

  const stored = itemStore.grantItemToOwnerLocation(
    visitorID,
    assemblyID,
    66,
    originalGetMetadata(MATERIAL_A),
    3,
  );
  assert.equal(stored.success, true, stored.errorMsg);
  const input = itemStore.grantItemToOwnerLocation(
    OWNER_ID,
    assemblyID,
    20_000,
    originalGetMetadata(MATERIAL_A),
    2,
  );
  assert.equal(input.success, true, input.errorMsg);
  const output = itemStore.grantItemToOwnerLocation(
    OWNER_ID,
    assemblyID,
    20_001,
    originalGetMetadata(MATERIAL_B),
    1,
  );
  assert.equal(output.success, true, output.errorMsg);
  const originalContentIDs = [stored, input, output]
    .flatMap(result => result.data.items.map(row => row.itemID));

  const result = deployment.dismantleAssembly(f.session, assemblyID);
  assert.equal(result.success, true, result.errorMsg);
  assert.equal(f.item(assemblyID), null);
  assert.ok(result.data.containers.length > 1);
  const containerIDs = new Set(result.data.containers.map(container => container.itemID));
  const contents = result.data.containers.flatMap(container => (
    itemStore.listContainerItems(null, container.itemID, 0)
  ));
  for (const container of result.data.containers) {
    const used = itemStore.listContainerItems(null, container.itemID, 0)
      .reduce((sum, row) => sum + itemStore.getInventoryItemUnitVolume(row) *
        (row.singleton ? 1 : row.stacksize), 0);
    assert.ok(used <= 25, `container ${container.itemID} uses ${used} m3`);
  }
  assert.ok(originalContentIDs.every(itemID => {
    const row = f.item(itemID);
    return row && containerIDs.has(row.locationID) && row.flagID === 0;
  }));
  assert.ok(contents.some(row => row.ownerID === visitorID));
  assert.ok(result.data.containers
    .filter(container => container.ownerID === visitorID)
    .every(container => itemStore.listContainerItems(null, container.itemID, 0)
      .every(row => row.ownerID === visitorID)));
  const totals = contents.reduce((byOwnerAndType, row) => {
    const key = `${row.ownerID}:${row.typeID}`;
    byOwnerAndType[key] = (byOwnerAndType[key] || 0) + (row.singleton ? 1 : row.stacksize);
    return byOwnerAndType;
  }, {});
  assert.equal(totals[`${OWNER_ID}:${MATERIAL_A}`], COST[MATERIAL_A] + 2);
  assert.equal(totals[`${OWNER_ID}:${MATERIAL_B}`], COST[MATERIAL_B] + 1);
  assert.equal(totals[`${visitorID}:${MATERIAL_A}`], 3);

  for (const container of result.data.containers) {
    itemStore.removeInventoryItem(container.itemID, { removeContents: true });
  }
});

test("dismantling an unfinished construction site returns only deposited materials", t => {
  const f = fixture(t);
  assert.equal(f.place(NODE_TYPE_ID).success, true);
  f.tick(DURATION_MS);
  const placed = f.place(FIELD_TYPE_ID, [1_000, 0, 0]);
  assert.equal(placed.success, true, placed.errorMsg);
  const siteID = placed.data.item.itemID;
  assert.equal(f.item(siteID).typeID, SITE_TYPE_ID);
  assert.equal(deployment.depositItems(
    f.session,
    siteID,
    f.ship.itemID,
    { [MATERIAL_A]: COST[MATERIAL_A] },
  ).success, true);

  const result = deployment.cancelConstruction(f.session, siteID);
  assert.equal(result.success, true, result.errorMsg);
  assert.equal(f.item(siteID), null);
  const contents = result.data.containers.flatMap(container => (
    itemStore.listContainerItems(OWNER_ID, container.itemID, 0)
  ));
  const totals = contents.reduce((byType, row) => {
    byType[row.typeID] = (byType[row.typeID] || 0) + (row.singleton ? 1 : row.stacksize);
    return byType;
  }, {});
  assert.equal(totals[MATERIAL_A], COST[MATERIAL_A]);
  assert.equal(totals[MATERIAL_B] || 0, 0);
});

function createLegacyFundedSite(f, completeAtMs) {
  const [site] = grant(SYSTEM_ID, SITE_TYPE_ID, 1, {
    individualItems: true,
    singleton: 1,
    spaceState: {
      systemID: SYSTEM_ID,
      position: { x: 1_000, y: 200, z: 300 },
    },
    customInfo: JSON.stringify({
      [deployment.CONSTRUCTION_INFO_KEY]: {
        assemblyStatus: deployment.ASSEMBLY_STATUS_UNDER_CONSTRUCTION,
        assemblyTypeID: FIELD_TYPE_ID,
        constructionSiteTypeID: SITE_TYPE_ID,
        constructionCost: COST,
        completeAtMs,
        createdAtMs: START_MS - DURATION_MS,
        durationSeconds: DURATION_SECONDS,
        ownerID: OWNER_ID,
        solarSystemID: SYSTEM_ID,
      },
    }),
  });
  grant(site.itemID, MATERIAL_A, COST[MATERIAL_A]);
  grant(site.itemID, MATERIAL_B, COST[MATERIAL_B]);
  const entity = { itemID: site.itemID, typeID: SITE_TYPE_ID, position: site.spaceState.position };
  f.entities.set(site.itemID, entity);
  deployment.hydrateConstructionEntityFromInventoryItem(entity, site);
  return site;
}

test("hydrating a funded legacy site replaces it immediately and preserves its remaining deadline", t => {
  const f = fixture(t);
  const deadline = START_MS + DURATION_MS / 2;
  const site = createLegacyFundedSite(f, deadline);
  f.tick(0);
  assert.equal(f.item(site.itemID).typeID, FIELD_TYPE_ID);
  assert.deepEqual(f.item(site.itemID).spaceState, site.spaceState);
  assert.deepEqual(itemStore.listContainerItems(OWNER_ID, site.itemID, null), []);
  assert.equal(f.state(site.itemID).completeAtMs, 0);
  assertActivating(f, site.itemID, deadline);

  f.tick(DURATION_MS / 2 - 1);
  assertActivating(f, site.itemID, deadline);
  f.tick(1);
  assert.equal(f.state(site.itemID).assemblyStatus, deployment.ASSEMBLY_STATUS_ONLINE);
  assert.deepEqual(f.entities.get(site.itemID).component_activate, [true, null]);
});

test("hydrating an overdue funded legacy site produces an active assembly without another timer", t => {
  const f = fixture(t);
  const site = createLegacyFundedSite(f, START_MS - 1);
  f.tick(0);
  assert.equal(f.item(site.itemID).typeID, FIELD_TYPE_ID);
  assert.equal(f.state(site.itemID).assemblyStatus, deployment.ASSEMBLY_STATUS_ONLINE);
  assert.equal(f.state(site.itemID).activationCompleteAtMs, 0);
  assert.equal(f.state(site.itemID).completeAtMs, 0);
  assert.deepEqual(f.entities.get(site.itemID).component_activate, [true, null]);
  assert.equal(f.spawn.mock.callCount(), 1);
  assert.equal(f.remove.mock.callCount(), 1);
  const completed = f.item(site.itemID).customInfo;
  f.tick(DURATION_MS * 2);
  assert.equal(f.item(site.itemID).customInfo, completed);
  assert.equal(f.broadcasts.length, 0);
});

test("chain reads and sponsored online confirmations cannot bypass a persisted activation timer", t => {
  const f = fixture(t);
  const placed = f.place(NODE_TYPE_ID);
  assert.equal(placed.success, true, placed.errorMsg);
  const itemID = placed.data.item.itemID;
  const identity = { itemId: String(itemID), typeId: NODE_TYPE_ID, ownerId: OWNER_ID };
  const confirmation = {
    transactionUUID: "activation-test-confirmation",
    affected: [{
      assemblyID: itemID, typeID: NODE_TYPE_ID, ownerID: OWNER_ID,
      targetStatus: deployment.ASSEMBLY_STATUS_ONLINE,
    }],
  };

  for (const now of [START_MS, START_MS + DURATION_MS + 1]) {
    // Advancing the clock without dispatching callbacks also models a server
    // loading an expired deadline before it has saved activation completion.
    t.mock.timers.setTime(now);
    const before = f.item(itemID).customInfo;
    assert.equal(deployment.reconcileSuiAssemblyState(identity, deployment.ASSEMBLY_STATUS_ONLINE), false);
    assert.throws(() => deployment.reconcileSponsoredAssemblyState(confirmation), {
      code: "ASSEMBLY_ACTIVATING",
    });
    assert.equal(f.item(itemID).customInfo, before);
    assertActivating(f, itemID, START_MS + DURATION_MS);
  }

  f.tick(0);
  assert.equal(deployment.isAssemblyActivationPending(f.item(itemID)), false);
  assert.equal(deployment.reconcileSuiAssemblyState(identity, deployment.ASSEMBLY_STATUS_ONLINE), true);
  assert.equal(f.state(itemID).assemblyStatus, deployment.ASSEMBLY_STATUS_ONLINE);
  assert.doesNotThrow(() => deployment.reconcileSponsoredAssemblyState(confirmation));
  assert.equal(f.state(itemID).assemblyStatus, deployment.ASSEMBLY_STATUS_ONLINE);
});
