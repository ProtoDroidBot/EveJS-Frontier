"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const CharService = require("../src/services/character/charService");
const {
  getCharacterRecord,
} = require("../src/services/character/characterState");
const {
  SLOT_FAMILY_FLAGS,
  getRequiredSlotFamily,
  getShipSlotCounts,
  isShipFittingFlag,
  selectAutoFitFlagForType,
} = require("../src/services/fitting/liveFittingState");
const InvBrokerService = require("../src/services/inventory/invBrokerService");
const {
  ITEM_FLAGS,
  findItemById,
  findCharacterShipItem,
  getItemMetadata,
  grantItemToCharacterLocation,
} = require("../src/services/inventory/itemStore");

const WEND_TYPE_ID = 87698;
const EMBARK_TYPE_ID = 77753;
const ENGINE_SLOT_FLAG_ID = 37;
const STARTER_LOCATION = Object.freeze({
  corporationID: 1000442,
  factionID: null,
  stationID: 64000001,
  homeStationID: 64000001,
  cloneStationID: 64000001,
  solarSystemID: 30000004,
  constellationID: 20000004,
  regionID: 10000004,
});

function createWendCharacter() {
  const service = new CharService();
  return service.Handle_CreateCharacterWithDoll(
    ["Engine Fitting Test", 1, 1, 1, null, null, 0],
    { userid: 990000101 },
    null,
    {
      starterLocation: STARTER_LOCATION,
      starterShipTypeID: WEND_TYPE_ID,
      starterShipName: "Wend",
    },
  );
}

function bindShipInventory(service, session, shipID) {
  const objectID = `test:engine-fitting:${shipID}`;
  service._rememberBoundContext(objectID, {
    inventoryID: shipID,
    locationID: STARTER_LOCATION.stationID,
    flagID: ITEM_FLAGS.CARGO_HOLD,
    kind: "shipInventory",
    ownerID: session.characterID,
  });
  session.currentBoundObjectID = objectID;
}

test("Wend engine slot accepts an Embark engine", () => {
  const characterID = createWendCharacter();
  const character = getCharacterRecord(characterID);
  const ship = findCharacterShipItem(characterID, character.shipID);
  const grant = grantItemToCharacterLocation(
    characterID,
    STARTER_LOCATION.stationID,
    ITEM_FLAGS.HANGAR,
    getItemMetadata(EMBARK_TYPE_ID),
    1,
  );
  assert.equal(grant.success, true);
  const engine = grant.data.items[0];

  assert.deepEqual(SLOT_FAMILY_FLAGS.engine, [ENGINE_SLOT_FLAG_ID]);
  assert.equal(isShipFittingFlag(ENGINE_SLOT_FLAG_ID), true);
  assert.equal(getRequiredSlotFamily(EMBARK_TYPE_ID), "engine");
  assert.equal(getShipSlotCounts(WEND_TYPE_ID).engine, 1);
  assert.equal(
    selectAutoFitFlagForType(ship, [], EMBARK_TYPE_ID),
    ENGINE_SLOT_FLAG_ID,
  );

  const session: Record<string, any> = {
    charid: characterID,
    characterID,
    shipid: ship.itemID,
    shipID: ship.itemID,
    stationid: STARTER_LOCATION.stationID,
    stationID: STARTER_LOCATION.stationID,
    solarsystemid2: STARTER_LOCATION.solarSystemID,
    compatibilityProfile: "frontier",
  };
  const inventory = new InvBrokerService();
  bindShipInventory(inventory, session, ship.itemID);

  assert.equal(
    inventory.Handle_Add(
      [engine.itemID, STARTER_LOCATION.stationID],
      session,
      { flag: 0, qty: 1 },
    ),
    engine.itemID,
  );

  const fittedEngine = findItemById(engine.itemID);
  assert.equal(fittedEngine.locationID, ship.itemID);
  assert.equal(fittedEngine.flagID, ENGINE_SLOT_FLAG_ID);
  assert.equal(fittedEngine.singleton, 1);
  assert.equal(fittedEngine.moduleState.online, true);
});
