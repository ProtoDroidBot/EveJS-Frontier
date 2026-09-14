"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const berthing = require("../src/services/frontier/berthingRuntime");

test("a completed Smart Hangar cannot berth ships until its activation timer clears", () => {
  const characterID = 140000003;
  const solarSystemID = 30000004;
  const ship = { itemID: 9001, typeID: 95276, groupID: 1 };
  const host = { itemID: 9002, typeID: 87160, ownerID: characterID,
    locationID: solarSystemID, customInfo: "" };
  const definition = { allowUserAdd: true, acceptedGroupIDs: null, accessRange: 5000 };
  const session = { characterID, solarsystemid2: solarSystemID, shipid: ship.itemID };
  const dependencies = {
    findItemById: () => host,
    getActiveShipItem: () => ship,
    getSmartHangarDefinition: () => definition,
    spaceRuntime: { getEntity: (_session, id) => ({ itemID: id, position: { x: 0, y: 0, z: 0 } }) },
  };
  const setActivation = deadline => {
    host.customInfo = JSON.stringify({ evejsFrontierConstruction: {
      assemblyStatus: 1, assemblyTypeID: host.typeID, solarSystemID,
      activationCompleteAtMs: deadline,
    } });
  };
  setActivation(Date.now() - 1);
  assert.equal(berthing._testing.validateBerthingRequest(session, host.itemID, dependencies).errorMsg,
    "BERTHING_HOST_NOT_OPERATIONAL");
  setActivation(0);
  assert.equal(berthing._testing.validateBerthingRequest(session, host.itemID, dependencies).success, true);
});
