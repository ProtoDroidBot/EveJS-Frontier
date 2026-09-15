"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const refugeFitting = require("../src/services/frontier/refugeFittingRuntime");

function fixture() {
  const characterID = 140000005;
  const solarSystemID = 30000004;
  const shipID = 9988400001895;
  const refugeID = 9988400001127;
  const ship: Record<string, any> = {
    itemID: shipID,
    typeID: 95276,
    categoryID: 6,
    ownerID: characterID,
    locationID: solarSystemID,
    flagID: 0,
    spaceState: {
      systemID: solarSystemID,
      position: { x: 0, y: 0, z: 0 },
    },
  };
  const refuge: Record<string, any> = {
    itemID: refugeID,
    typeID: refugeFitting.REFUGE_TYPE_ID,
    categoryID: 65,
    ownerID: characterID,
    locationID: solarSystemID,
    flagID: 0,
    spaceState: {
      systemID: solarSystemID,
      position: { x: 5_000, y: 0, z: 0 },
    },
  };
  const items = new Map([
    [ship.itemID, ship],
    [refuge.itemID, refuge],
  ]);
  const state = {
    assemblyTypeID: refugeFitting.REFUGE_TYPE_ID,
    assemblyStatus: 2,
    activationPending: false,
    locallyVisible: true,
  };
  const entities = new Map([
    [ship.itemID, { ...ship, position: { ...ship.spaceState.position } }],
    [refuge.itemID, { ...refuge, position: { ...refuge.spaceState.position } }],
  ]);
  const dependencies = {
    findItemById: (itemID) => items.get(Number(itemID)),
    getFittingComponent: () => ({
      typeID: refugeFitting.REFUGE_TYPE_ID,
      rangeMeters: 5_000,
    }),
    readConstructionState: () => ({
      assemblyTypeID: state.assemblyTypeID,
      assemblyStatus: state.assemblyStatus,
    }),
    isAssemblyActivationPending: () => state.activationPending,
    spaceRuntime: {
      getEntity: (_session, itemID) => entities.get(Number(itemID)),
    },
    canEntitiesInteractLocally: () => state.locallyVisible,
    listSystemSpaceItems: () => [...items.values()].filter((item) => item.categoryID !== 6),
  };
  const session = {
    characterID,
    shipid: shipID,
    solarsystemid2: solarSystemID,
    _space: { shipID, systemID: solarSystemID },
  };
  return { dependencies, entities, items, refuge, session, ship, state };
}

test("the Refuge fitting component exposes its authoritative 5 km range", () => {
  const components = refugeFitting._testing.buildFittingComponents([
    { _key: 87160, fitting: { range: 5000 } },
    { _key: 87161 },
  ]);
  assert.deepEqual(components.get(87160), {
    typeID: 87160,
    rangeMeters: 5000,
  });
  assert.equal(components.has(87161), false);

  const staticComponent = refugeFitting.getFittingComponent(87160);
  assert.equal(staticComponent.typeID, 87160);
  assert.equal(staticComponent.rangeMeters, 5000);
});

test("an online nearby Refuge permits fitting without a berthing contract", () => {
  const f = fixture();
  const result = refugeFitting.validateRefugeFittingAccess(
    f.session,
    f.refuge,
    f.dependencies,
  );
  assert.equal(result.success, true);
  assert.equal(result.data.distance, 5_000);
  assert.equal(result.data.rangeMeters, 5_000);

  const discovered = refugeFitting.findRefugeFittingAccess(
    f.session,
    f.dependencies,
  );
  assert.equal(discovered.success, true);
  assert.equal(discovered.item.itemID, f.refuge.itemID);
});

test("Refuge fitting rejects out-of-range, offline, activating and foreign providers", () => {
  const f = fixture();
  f.entities.get(f.refuge.itemID).position.x = 5_001;
  assert.equal(
    refugeFitting.validateRefugeFittingAccess(
      f.session,
      f.refuge,
      f.dependencies,
    ).errorMsg,
    "TARGET_TOO_FAR",
  );

  f.entities.get(f.refuge.itemID).position.x = 100;
  f.state.assemblyStatus = 1;
  assert.equal(
    refugeFitting.validateRefugeFittingAccess(
      f.session,
      f.refuge,
      f.dependencies,
    ).errorMsg,
    "REFUGE_NOT_ACTIVE",
  );

  f.state.assemblyStatus = 2;
  f.state.activationPending = true;
  assert.equal(
    refugeFitting.validateRefugeFittingAccess(
      f.session,
      f.refuge,
      f.dependencies,
    ).errorMsg,
    "REFUGE_NOT_ACTIVE",
  );

  f.state.activationPending = false;
  f.refuge.ownerID += 1;
  assert.equal(
    refugeFitting.validateRefugeFittingAccess(
      f.session,
      f.refuge,
      f.dependencies,
    ).errorMsg,
    "REFUGE_NOT_OWNER",
  );
});

test("Refuge fitting requires the active ship and provider to share interaction scope", () => {
  const f = fixture();
  f.state.locallyVisible = false;
  assert.equal(
    refugeFitting.validateRefugeFittingAccess(
      f.session,
      f.refuge,
      f.dependencies,
    ).errorMsg,
    "TARGET_TOO_FAR",
  );

  f.state.locallyVisible = true;
  f.ship.itemID += 1;
  assert.equal(
    refugeFitting.validateRefugeFittingAccess(
      f.session,
      f.refuge,
      f.dependencies,
    ).errorMsg,
    "INVALID_SESSION",
  );
});
