"use strict";

/** Run with scripts/Tests/run-isolated-tests.js against a disposable game store. */
const assert = require("node:assert/strict");
const test = require("node:test");
const config = require("../src/config");
const itemStore = require("../src/services/inventory/itemStore");
const deployment = require("../src/services/frontier/deploymentRuntime");
const { registerSuiAssemblyStateRunner } = require("../src/services/frontier/suiAssemblyState");
const spaceRuntime = require("../src/space/runtime");
const { isDestinyPayload } = require("../src/space/destiny/protocol/payloads");
const { getPayloadPrimaryEntityID } = require("../src/space/destiny/protocol/payloadIdentity");

const OWNER_ID = 140000003;
const SYSTEM_ID = 30000004;
const ASSEMBLY_TYPE_ID = 77917;

function fixture(t, profile = "frontier") {
  const previousProfile = config.clientCompatibilityProfile;
  const previousScene = spaceRuntime.scenes.get(SYSTEM_ID);
  config.clientCompatibilityProfile = profile;
  t.after(registerSuiAssemblyStateRunner(async (_assemblyID, operation) => operation()));

  const granted = itemStore.grantItemsToCharacterLocation(OWNER_ID, SYSTEM_ID, 0, [{
    itemType: ASSEMBLY_TYPE_ID, quantity: 1, options: { individualItems: true, singleton: 1 },
  }]);
  assert.equal(granted.success, true, granted.errorMsg);
  const created = granted.data.items[0];
  const updated = itemStore.updateInventoryItem(created.itemID, item => ({
    ...item,
    itemName: "Assembly presentation regression",
    customInfo: JSON.stringify({ evejsFrontierConstruction: {
      assemblyStatus: 1, assemblyTypeID: ASSEMBLY_TYPE_ID,
      createdAtMs: 1, completedAtMs: 1, ownerID: OWNER_ID, solarSystemID: SYSTEM_ID,
    } }),
  }));
  assert.equal(updated.success, true, updated.errorMsg);
  const item = updated.data;
  const entity = deployment.hydrateConstructionEntityFromInventoryItem({
    ...item, kind: "deployable", systemID: SYSTEM_ID,
    position: { x: 0, y: 0, z: 0 },
  }, item);

  // Exercise the real scene broadcast, visibility and presentation methods,
  // without loading unrelated world objects or starting their lifecycle timers.
  const scene = Object.assign(Object.create(spaceRuntime._testing.SolarSystemScene.prototype), {
    systemID: SYSTEM_ID,
    simTimeMs: 1700000000000,
    timeDilation: 1,
    nextStamp: 1,
    sessions: new Map(),
    dynamicEntities: new Map([[item.itemID, entity]]),
    staticEntitiesByID: new Map(),
  });
  const deliveries: any[] = [];
  t.mock.method(scene, "sendDestinyUpdates", (session, updates) => {
    deliveries.push({ session, updates: structuredClone(updates) });
  });
  spaceRuntime.scenes.set(SYSTEM_ID, scene);
  deployment._testing.clearPendingAssemblyTransitions();

  t.after(() => {
    config.clientCompatibilityProfile = previousProfile;
    if (previousScene) spaceRuntime.scenes.set(SYSTEM_ID, previousScene);
    else spaceRuntime.scenes.delete(SYSTEM_ID);
    deployment._testing.clearPendingAssemblyTransitions();
    itemStore.removeInventoryItem(item.itemID, { removeContents: true });
  });

  return {
    item, entity, scene, deliveries,
    session(characterID, visible = true) {
      const session = {
        characterID, compatibilityProfile: profile,
        socket: { destroyed: false },
        _space: {
          systemID: SYSTEM_ID, shipID: characterID + 1000, initialStateSent: true,
          visibleDynamicEntityIDs: new Set(visible ? [item.itemID] : []),
          pendingNativeVisibilityRemovalsByID: new Map(),
        },
      };
      scene.sessions.set(characterID, session);
      return session;
    },
    project(status) {
      return deployment.reconcileSuiAssemblyState({
        itemId: String(item.itemID), ownerId: OWNER_ID, typeId: ASSEMBLY_TYPE_ID,
      }, status);
    },
  };
}

function assertCrUpdate(delivery, item, status) {
  assert.equal(delivery.updates.length, 1);
  const { payload, stamp } = delivery.updates[0];
  assert.equal(Number.isInteger(stamp), true);
  assert.equal(payload[0], "OnCrDataChange");
  assert.equal(payload[1].length, 2);
  assert.equal(payload[1][0], item.itemID);
  assert.equal(isDestinyPayload(payload), true, "CR refresh must survive Destiny payload validation");
  assert.equal(getPayloadPrimaryEntityID(payload), item.itemID, "CR refresh must retain its routing identity");
  const crData = payload[1][1];
  assert.equal(crData.type, "dict");
  const fields = Object.fromEntries(crData.entries);
  assert.equal(fields.itemID, undefined, "itemID is immutable in the client's CR object");
  assert.equal(fields.typeID, ASSEMBLY_TYPE_ID);
  assert.equal(fields.ownerID, OWNER_ID);
  assert.equal(fields.assembly_status, status);
  assert.deepEqual(fields.component_activate, { type: "tuple", items: [true, null] });
  assert.equal(fields.groupID, undefined, "CR updates must use Frontier's accepted field schema");
  assert.equal(fields.activate_comp_durationSeconds, undefined);
  assert.equal(JSON.stringify(payload).includes("foo.SlimItem"), false);
}

test("verified online and offline chain observations reach already-visible Frontier assemblies", t => {
  const f = fixture(t);
  const owner = f.session(OWNER_ID);
  const observer = f.session(OWNER_ID + 1);
  f.session(OWNER_ID + 2, false);

  for (const status of [2, 1]) {
    f.deliveries.length = 0;
    assert.equal(f.project(status), true);
    assert.equal(deployment.readConstructionState(itemStore.findItemById(f.item.itemID)).assemblyStatus, status);
    assert.equal(f.entity.assembly_status, status);
    assert.equal(f.deliveries.length, 2, "persisting chain state must also refresh both clients already on grid");
    assert.deepEqual(f.deliveries.map(delivery => delivery.session), [owner, observer]);
    for (const delivery of f.deliveries) assertCrUpdate(delivery, f.item, status);
  }
});

test("Frontier CR refresh respects visibility removal, connection readiness and excluded sessions", t => {
  const f = fixture(t);
  const visible = f.session(OWNER_ID);
  const excluded = f.session(OWNER_ID + 1);
  f.session(OWNER_ID + 2, false);
  const removing = f.session(OWNER_ID + 3);
  removing._space.pendingNativeVisibilityRemovalsByID.set(f.item.itemID, { kind: "dynamic" });
  const unready = f.session(OWNER_ID + 4);
  unready._space.initialStateSent = false;
  const disconnected = f.session(OWNER_ID + 5);
  disconnected.socket.destroyed = true;

  f.scene.broadcastSlimItemChanges([f.entity], excluded);
  assert.equal(f.deliveries.length, 1);
  assert.equal(f.deliveries[0].session, visible);
  assertCrUpdate(f.deliveries[0], f.item, 1);
});

test("legacy clients retain their SlimItem assembly state update", t => {
  const f = fixture(t, "tranquility");
  const session = f.session(OWNER_ID);
  assert.equal(f.project(2), true);
  assert.equal(f.deliveries.length, 1);
  assert.equal(f.deliveries[0].session, session);
  const updates = f.deliveries[0].updates;
  assert.equal(updates.length, 1);
  const payload = updates[0].payload;
  assert.equal(payload[0], "OnSlimItemChange");
  assert.equal(payload[1][0], f.item.itemID);
  assert.equal(payload[1][1].type, "object");
  assert.equal(payload[1][1].name, "foo.SlimItem");
  assert.equal(Object.fromEntries(payload[1][1].args.entries).assembly_status, 2);
  assert.equal(isDestinyPayload(payload), true);
  assert.equal(getPayloadPrimaryEntityID(payload), f.item.itemID);
});

test("Frontier retains suppressed SlimItem refreshes for entities without assembly state", t => {
  const f = fixture(t);
  const session = f.session(OWNER_ID, false);
  const unrelated = ["deployable", "ship"].map((kind, index) => ({
    kind, itemID: 9999999000100 + index, typeID: ASSEMBLY_TYPE_ID,
    ownerID: OWNER_ID, systemID: SYSTEM_ID, position: { x: 0, y: 0, z: 0 },
  }));
  for (const entity of unrelated) session._space.visibleDynamicEntityIDs.add(entity.itemID);
  f.scene.sendSlimItemChangesToSession(session, unrelated);
  assert.equal(f.deliveries.length, 0);
});
