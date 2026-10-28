"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const config = require("../src/config");
const CharService = require("../src/services/character/charService");
const {
  clearCharacterActiveShipForCloneSelection,
  getCharacterRecord,
  listCharacterIDs,
  peekCharacterRecord,
} = require("../src/services/character/characterState");
const {
  CREATION_FITTING_FLAG_ID,
  ensureCreationState,
  filterCreationModuleInventoryItems,
  readCreationState,
} = require("../src/services/frontier/creationRuntime");
const CreationService = require(
  "../src/services/frontier/creationService",
);
const {
  SuiCharacterProvisioningError,
  prepareSuiCharacterIdentity,
} = require("../src/services/frontier/suiCharacterProvisioning");
const InvBrokerService = require(
  "../src/services/inventory/invBrokerService",
);
const {
  CLIENT_INVENTORY_STACK_LIMIT,
  FREE_STATION_FUEL_CUSTOM_INFO,
  ITEM_FLAGS,
  consumeInventoryItemQuantity,
  createSpaceItemForCharacter,
  findCharacterShipItem,
  getActiveShipItem,
  getAllItems,
  getItemMetadata,
  grantItemToCharacterLocation,
  listCharacterItems,
  listContainerItems,
  moveItemToLocation,
  setActiveShipForCharacter,
} = require("../src/services/inventory/itemStore");
const {
  marshalEncode,
} = require("../src/network/tcp/utils/marshal");

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

function createCharacter(name, userid, creationOptions: Record<string, any> = {}) {
  const service = new CharService();
  return service.Handle_CreateCharacterWithDoll(
    [name, 1, 1, 1, null, null, 0],
    { userid },
    null,
    {
      starterLocation: STARTER_LOCATION,
      ...creationOptions,
    },
  );
}

function createTestSuiCharacterProvisioner() {
  return async (input) => {
    const identity =
      input.identity || prepareSuiCharacterIdentity(input);
    return {
      ...identity,
      network: "localnet",
      baseUrl: "http://localhost:9000",
      playerProfileObjectId: `0x${(
        BigInt(identity.gameCharacterId) + 0x100000000n
      )
        .toString(16)
        .padStart(64, "0")}`,
      transactionDigest: `test-sui-character-${identity.gameCharacterId}`,
      recovered: false,
    };
  };
}

async function createFrontierCharacterInSpace(name, userid) {
  const previousProfile = config.clientCompatibilityProfile;
  config.clientCompatibilityProfile = "frontier";
  try {
    return await new CharService({
      suiCharacterProvisioner: createTestSuiCharacterProvisioner(),
    }).Handle_CreateCharacterInSpace(
      [name, 1],
      { userid },
    );
  } finally {
    config.clientCompatibilityProfile = previousProfile;
  }
}

function assertMarshallableIterable(value) {
  assert.ok(value, "inventory call must never return None");
  assert.ok(
    value.type === "list" || value.type === "objectex1",
    `unexpected inventory iterable type ${String(value.type)}`,
  );
  assert.doesNotThrow(() => marshalEncode(value, {
    compatibilityProfile: "frontier",
  }));
}

function bindShipInventory(service, session, shipID) {
  const objectID = `test:ship-inventory:${shipID}`;
  service._rememberBoundContext(objectID, {
    inventoryID: shipID,
    locationID: STARTER_LOCATION.stationID,
    flagID: ITEM_FLAGS.CARGO_HOLD,
    kind: "shipInventory",
    ownerID: session.characterID,
  });
  session.currentBoundObjectID = objectID;
}

test("Frontier character creation starts in one initialized Creation", async () => {
  const userid = 990000001;
  const characterID = await createFrontierCharacterInSpace(
    "Frontier Creation Test",
    userid,
  );
  const character = getCharacterRecord(characterID);
  const ship = findCharacterShipItem(characterID, character.shipID);

  assert.equal(character.shipTypeID, 95276);
  assert.equal(character.shipName, "Creation");
  assert.equal(character.suiProvisioningStatus, "confirmed");
  assert.equal(
    character.suiWalletAddress,
    prepareSuiCharacterIdentity({
      accountId: userid,
      gameCharacterId: characterID,
      characterName: character.characterName,
    }).walletAddress,
  );
  assert.equal(
    character.suiWorldPackageId,
    "0x2aa4f4bac8c506f389b69e2e761804904854d9b61dfd9ac3f93b9d9cb07f0a00",
  );
  assert.ok(character.suiCharacterObjectId);
  assert.ok(character.suiPlayerProfileObjectId);
  assert.equal(
    character.suiTransactionDigest,
    `test-sui-character-${characterID}`,
  );
  assert.equal(ship.typeID, 95276);
  assert.equal(ship.itemName, "Creation");
  assert.equal(ship.conditionState.fuelCharge, 2250);
  assert.equal(ship.conditionState.fuelTypeID, 77818);
  assert.deepEqual(ship.conditionState.fuelQueue, [
    { fuelTypeID: 77818, quantity: 2000 },
    { fuelTypeID: 77818, quantity: 250, reserve: true },
  ]);
  assert.equal(
    listCharacterItems(characterID).some((item) => Number(item.typeID) === 87698),
    false,
  );

  const state = readCreationState(ship);
  assert.equal(state.version, 1);
  assert.equal(state.templateTypeID, 95276);
  assert.equal(state.poweredOff, false);
  assert.equal(state.modules.length, 27);
  assert.equal(state.interiorPlacements.length, 21);
  assert.equal(state.hardpoints.length, 7);

  const moduleItems = listContainerItems(
    characterID,
    ship.itemID,
    CREATION_FITTING_FLAG_ID,
  );
  assert.equal(moduleItems.length, 27);
  assert.deepEqual(
    new Set(moduleItems.map((item) => Number(item.itemID))),
    new Set(state.modules.map((module) => Number(module.itemID))),
  );
  for (const moduleItem of moduleItems) {
    assert.equal(moduleItem.ownerID, characterID);
    assert.equal(moduleItem.locationID, ship.itemID);
    assert.equal(moduleItem.flagID, CREATION_FITTING_FLAG_ID);
    assert.equal(moduleItem.singleton, 1);
    assert.equal(moduleItem.stacksize, 1);
  }

  const staleShipSnapshot: Record<string, any> = { ...ship, customInfo: "" };
  const secondEnsure = ensureCreationState(staleShipSnapshot, characterID);
  assert.equal(secondEnsure.success, true);
  assert.equal(secondEnsure.data.seeded, false);
  assert.equal(
    listContainerItems(
      characterID,
      ship.itemID,
      CREATION_FITTING_FLAG_ID,
    ).length,
    27,
  );

  const wrongOwnerEnsure = ensureCreationState(
    staleShipSnapshot,
    characterID + 1,
  );
  assert.equal(wrongOwnerEnsure.success, false);
  assert.equal(wrongOwnerEnsure.errorMsg, "CREATION_ITEM_NOT_OWNED");

  const session: Record<string, any> = {
    charid: characterID,
    characterID,
    shipid: ship.itemID,
    shipID: ship.itemID,
    stationid: character.stationID,
    stationID: character.stationID,
    solarsystemid2: character.solarSystemID,
    compatibilityProfile: "frontier",
  };
  const creationResponse = new CreationService().Handle_get_creation(
    [ship.itemID],
    session,
  );
  assert.ok(creationResponse);
  assert.doesNotThrow(() => marshalEncode(creationResponse, {
    compatibilityProfile: "frontier",
  }));

  const inventory = new InvBrokerService();
  bindShipInventory(inventory, session, ship.itemID);
  assertMarshallableIterable(inventory.Handle_List([null], session));
  assertMarshallableIterable(inventory.Handle_List([156], session));
  assertMarshallableIterable(inventory.Handle_ListByFlags([[5]], session));
});

test("generic character creation retains the racial Wend profile", () => {
  const characterID = createCharacter("Legacy Wend Test", 990000002);
  const character = getCharacterRecord(characterID);
  const ship = findCharacterShipItem(characterID, character.shipID);

  assert.equal(character.shipTypeID, 87698);
  assert.equal(character.shipName, "Wend");
  assert.equal(ship.typeID, 87698);
  assert.equal(ship.itemName, "Wend");
  assert.equal(ship.conditionState.fuelCharge, 200);
  assert.equal(ship.conditionState.fuelTypeID, 77818);
  assert.deepEqual(ship.conditionState.fuelQueue, [{
    fuelTypeID: 77818,
    quantity: 200,
  }]);
});

test("clone selection suppresses implicit starter provisioning until respawn", () => {
  const characterID = createCharacter("Clone Ship Guard", 990001089);
  const initialCharacter = getCharacterRecord(characterID);
  const initialShip = findCharacterShipItem(characterID, initialCharacter.shipID);
  const shipIDsBefore = Object.values<any>(getAllItems())
    .filter((item) => Number(item.ownerID) === characterID && Number(item.categoryID) === 6)
    .map((item) => Number(item.itemID))
    .sort((left, right) => left - right);

  const clearResult = clearCharacterActiveShipForCloneSelection(characterID);
  assert.equal(clearResult.success, true, clearResult.errorMsg);
  assert.equal(getActiveShipItem(characterID), null);
  assert.deepEqual(
    Object.values<any>(getAllItems())
      .filter((item) => Number(item.ownerID) === characterID && Number(item.categoryID) === 6)
      .map((item) => Number(item.itemID))
      .sort((left, right) => left - right),
    shipIDsBefore,
  );
  assert.equal(peekCharacterRecord(characterID).shipID, 0);
  assert.equal(
    peekCharacterRecord(characterID).suppressActiveShipProvisioning,
    true,
  );

  const activateResult = setActiveShipForCharacter(characterID, initialShip.itemID);
  assert.equal(activateResult.success, true, activateResult.errorMsg);
  assert.equal(getActiveShipItem(characterID).itemID, initialShip.itemID);
  assert.equal(
    Object.prototype.hasOwnProperty.call(
      peekCharacterRecord(characterID),
      "suppressActiveShipProvisioning",
    ),
    false,
  );
});

test("station fuel inventory exposes one unlimited free Unstable Fuel offer", () => {
  const characterID = createCharacter("Station Fuel Test", 990000088);
  const character = getCharacterRecord(characterID);
  const session = {
    charid: characterID,
    characterID,
    shipid: character.shipID,
    shipID: character.shipID,
    stationid: STARTER_LOCATION.stationID,
    stationID: STARTER_LOCATION.stationID,
    compatibilityProfile: "frontier",
  };
  const inventory = new InvBrokerService();
  const ordinaryFuelGrant = grantItemToCharacterLocation(
    characterID,
    STARTER_LOCATION.stationID,
    ITEM_FLAGS.HANGAR,
    77818,
    25,
  );
  assert.equal(ordinaryFuelGrant.success, true, ordinaryFuelGrant.errorMsg);
  const ordinaryFuel = ordinaryFuelGrant.data.items[0];
  const boundContext = {
    inventoryID: STARTER_LOCATION.stationID,
    locationID: STARTER_LOCATION.stationID,
    flagID: ITEM_FLAGS.HANGAR,
    kind: "stationInventory",
    ownerID: characterID,
  };
  const firstRows = inventory._resolveContainerItems(
    session,
    ITEM_FLAGS.HANGAR,
    boundContext,
  );
  const secondRows = inventory._resolveContainerItems(
    session,
    ITEM_FLAGS.HANGAR,
    boundContext,
  );
  const firstSupply = firstRows.filter((item) =>
    Number(item.typeID) === 77818 &&
    item.customInfo === FREE_STATION_FUEL_CUSTOM_INFO);
  const secondSupply = secondRows.filter((item) =>
    Number(item.typeID) === 77818 &&
    item.customInfo === FREE_STATION_FUEL_CUSTOM_INFO);

  assert.equal(firstSupply.length, 1);
  assert.equal(secondSupply.length, 1);
  assert.equal(firstSupply[0].itemID, secondSupply[0].itemID);
  assert.equal(firstSupply[0].stacksize, CLIENT_INVENTORY_STACK_LIMIT);
  assert.notEqual(firstSupply[0].itemID, ordinaryFuel.itemID);
  assert.equal(ordinaryFuel.stacksize, 25);
  assert.equal(ordinaryFuel.customInfo, "");
  assert.equal(
    consumeInventoryItemQuantity(firstSupply[0].itemID, 1).errorMsg,
    "FREE_STATION_FUEL_SUPPLY_RESERVED",
  );
  assert.equal(
    moveItemToLocation(
      firstSupply[0].itemID,
      character.shipID,
      ITEM_FLAGS.CARGO_HOLD,
      1,
    ).errorMsg,
    "FREE_STATION_FUEL_SUPPLY_RESERVED",
  );
});

test("Creation-template hulls are initialized in station and space", () => {
  const characterID = createCharacter("Creation Grant Test", 990000099);

  for (const [typeID, expectedFuelCapacity] of [[95276, 2250], [95735, 2250]]) {
    const stationGrant = grantItemToCharacterLocation(
      characterID,
      STARTER_LOCATION.stationID,
      ITEM_FLAGS.HANGAR,
      getItemMetadata(typeID),
      1,
      { singleton: 1 },
    );
    assert.equal(stationGrant.success, true, stationGrant.errorMsg);
    assert.deepEqual(
      stationGrant.data.initializedCreationShipIDs,
      [stationGrant.data.items[0].itemID],
    );

    const spaceGrant = createSpaceItemForCharacter(
      characterID,
      STARTER_LOCATION.solarSystemID,
      getItemMetadata(typeID),
      { position: { x: typeID, y: 0, z: 0 } },
    );
    assert.equal(spaceGrant.success, true, spaceGrant.errorMsg);

    for (const [locationKind, ship] of [
      ["station", stationGrant.data.items[0]],
      ["space", spaceGrant.data],
    ]) {
      const state = readCreationState(ship);
      assert.ok(
        state,
        `type ${typeID} should carry Creation state when spawned in ${locationKind}`,
      );
      assert.equal(state.templateTypeID, typeID);
      assert.ok(state.modules.length > 0);
      assert.equal(ship.conditionState.fuelCharge, expectedFuelCapacity);
      assert.equal(ship.conditionState.fuelTypeID, 77818);
      assert.deepEqual(ship.conditionState.fuelQueue, [
        { fuelTypeID: 77818, quantity: expectedFuelCapacity - 250 },
        { fuelTypeID: 77818, quantity: 250, reserve: true },
      ]);

      const fittedModules = listContainerItems(
        characterID,
        ship.itemID,
        CREATION_FITTING_FLAG_ID,
      );
      assert.equal(fittedModules.length, state.modules.length);
      assert.deepEqual(
        new Set(fittedModules.map((item) => Number(item.itemID))),
        new Set(state.modules.map((module) => Number(module.itemID))),
      );
    }
  }
});

test("non-Creation ship inventory calls remain iterable", () => {
  const characterID = createCharacter(
    "Inventory Guard Test",
    990000003,
    {
      starterShipTypeID: CharService._testing.FRONTIER_STARTER_SHIP_TYPE_ID,
      starterShipName: CharService._testing.FRONTIER_STARTER_SHIP_NAME,
      initializeCreation: true,
    },
  );
  const character = getCharacterRecord(characterID);
  const grant = grantItemToCharacterLocation(
    characterID,
    STARTER_LOCATION.stationID,
    ITEM_FLAGS.HANGAR,
    getItemMetadata(87698),
    1,
    { singleton: 1, itemName: "Inventory Test Wend" },
  );
  assert.equal(grant.success, true);
  const wend = grant.data.items[0];
  const ordinaryRows: any[] = [
    { itemID: 1, flagID: ITEM_FLAGS.CARGO_HOLD },
    { itemID: 2, flagID: 156 },
    { itemID: 3, flagID: CREATION_FITTING_FLAG_ID },
  ];

  assert.equal(readCreationState(wend), null);
  assert.equal(filterCreationModuleInventoryItems(wend, ordinaryRows), ordinaryRows);

  const session: Record<string, any> = {
    charid: characterID,
    characterID,
    shipid: character.shipID,
    shipID: character.shipID,
    stationid: STARTER_LOCATION.stationID,
    stationID: STARTER_LOCATION.stationID,
    solarsystemid2: STARTER_LOCATION.solarSystemID,
    compatibilityProfile: "frontier",
  };
  const inventory = new InvBrokerService();
  bindShipInventory(inventory, session, wend.itemID);

  assertMarshallableIterable(inventory.Handle_List([null], session));
  assertMarshallableIterable(inventory.Handle_List([156], session));
  assertMarshallableIterable(inventory.Handle_ListByFlags([[5]], session));
});

test("failed Frontier Creation initialization rolls back the new character", () => {
  const userid = 990000004;
  const service = new CharService();
  const session: Record<string, any> = { userid };
  const itemIDsBefore = new Set(
    Object.values<any>(getAllItems()).map((item) => Number(item.itemID)),
  );
  assert.equal(service.Handle_GetNumCharacters([], session), 0);

  assert.throws(() => service.Handle_CreateCharacterWithDoll(
    ["Broken Creation Test", 1, 1, 1, null, null, 0],
    session,
    null,
    {
      starterLocation: STARTER_LOCATION,
      starterShipTypeID: 87698,
      starterShipName: "Wend",
      initializeCreation: true,
    },
  ));
  assert.equal(service.Handle_GetNumCharacters([], session), 0);
  assert.deepEqual(
    new Set(Object.values<any>(getAllItems()).map((item) => Number(item.itemID))),
    itemIDsBefore,
  );
});

test("failed Sui Character provisioning rolls back the Frontier character", async () => {
  const userid = 990000005;
  const previousProfile = config.clientCompatibilityProfile;
  const service = new CharService({
    suiCharacterProvisioner: async () => {
      throw new SuiCharacterProvisioningError(
        "TRANSACTION_FAILED",
        "mock rejected transaction",
      );
    },
  });
  const session: Record<string, any> = { userid };
  const itemIDsBefore = new Set(
    Object.values<any>(getAllItems()).map((item) => Number(item.itemID)),
  );

  config.clientCompatibilityProfile = "frontier";
  try {
    await assert.rejects(
      service.Handle_CreateCharacterInSpace(
        ["Sui Rollback Test", 1],
        session,
      ),
    );
  } finally {
    config.clientCompatibilityProfile = previousProfile;
  }

  assert.equal(service.Handle_GetNumCharacters([], session), 0);
  assert.deepEqual(
    new Set(Object.values<any>(getAllItems()).map((item) => Number(item.itemID))),
    itemIDsBefore,
  );
});

test("selecting after an ambiguous Sui submission resumes the same Frontier character", async () => {
  const userid = 990000006;
  const previousProfile = config.clientCompatibilityProfile;
  const confirmedProvisioner = createTestSuiCharacterProvisioner();
  let attempts = 0;
  const service = new CharService({
    suiCharacterProvisioner: async (input) => {
      attempts += 1;
      if (attempts === 1) {
        throw new SuiCharacterProvisioningError(
          "TRANSACTION_STATUS_UNKNOWN",
          "mock ambiguous submission",
          {
            ambiguous: true,
            transactionDigest: "mock-ambiguous-digest",
          },
        );
      }
      return confirmedProvisioner(input);
    },
  });
  const session: Record<string, any> = {
    userid,
    sendNotification() {},
    sendSessionChange() {},
  };
  const characterIDsBefore = new Set(listCharacterIDs());

  config.clientCompatibilityProfile = "frontier";
  try {
    await assert.rejects(
      service.Handle_CreateCharacterInSpace(
        ["Sui Resume Test", 1],
        session,
      ),
    );
    assert.equal(service.Handle_GetNumCharacters([], session), 1);
    const itemCountAfterAmbiguousSubmit = Object.keys(getAllItems()).length;

    const characterID = listCharacterIDs().find(
      (candidateID) => !characterIDsBefore.has(candidateID),
    );
    assert.ok(characterID);
    await service.Handle_SelectCharacterID([characterID], session, null);
    const character = getCharacterRecord(characterID);

    assert.equal(attempts, 2);
    assert.equal(service.Handle_GetNumCharacters([], session), 1);
    assert.equal(Object.keys(getAllItems()).length, itemCountAfterAmbiguousSubmit);
    assert.equal(character.suiProvisioningStatus, "confirmed");
    assert.equal(character.suiProvisioningRecovered, true);
    assert.ok(character.suiPlayerProfileObjectId);
    assert.equal(session.characterID, characterID);
  } finally {
    config.clientCompatibilityProfile = previousProfile;
  }
});

test("a prepared digest is journaled and a confirmed failed retry rolls back the pending character", async () => {
  const userid = 990000007;
  const previousProfile = config.clientCompatibilityProfile;
  const digest = "test-prepared-sui-digest";
  const transactionBytesBase64 = "AQID";
  const transactionSignature = "test-prepared-signature";
  const chainId = "a1b2c3d4";
  let attempts = 0;
  const service = new CharService({
    suiCharacterProvisioner: async (input, options) => {
      attempts += 1;
      if (attempts === 1) {
        await options.onTransactionPrepared({
          transactionDigest: digest,
          transactionBytesBase64,
          transactionSignature,
          chainId,
        });
        throw new SuiCharacterProvisioningError(
          "TRANSACTION_STATUS_UNKNOWN",
          "mock ambiguous submission",
          { ambiguous: true, transactionDigest: digest },
        );
      }
      assert.equal(input.transactionDigest, digest);
      throw new SuiCharacterProvisioningError(
        "TRANSACTION_FAILED",
        "mock digest-confirmed failure",
        { transactionDigest: digest },
      );
    },
  });
  const session: Record<string, any> = {
    userid,
    sendNotification() {},
    sendSessionChange() {},
  };
  const itemIDsBefore = new Set(
    Object.values<any>(getAllItems()).map((item) => Number(item.itemID)),
  );
  const characterIDsBefore = new Set(listCharacterIDs());

  config.clientCompatibilityProfile = "frontier";
  try {
    await assert.rejects(
      service.Handle_CreateCharacterInSpace(
        ["Sui Retry Test", 1],
        session,
      ),
    );
    const characterID = listCharacterIDs().find(
      (candidateID) => !characterIDsBefore.has(candidateID),
    );
    assert.ok(characterID);
    const pending = getCharacterRecord(characterID);
    assert.equal(pending.suiTransactionDigest, digest);
    assert.equal(
      pending.suiPreparedTransactionBytesBase64,
      transactionBytesBase64,
    );
    assert.equal(
      pending.suiPreparedTransactionSignature,
      transactionSignature,
    );
    assert.equal(pending.suiChainId, chainId);
    assert.equal(pending.suiSubmissionState, "submitting");
    assert.equal(pending.suiProvisioningStatus, "reconciliation-required");

    await assert.rejects(
      service.Handle_SelectCharacterID([characterID], session, null),
    );
    assert.equal(attempts, 2);
    assert.equal(getCharacterRecord(characterID), null);
    assert.equal(service.Handle_GetNumCharacters([], session), 0);
    assert.deepEqual(
      new Set(Object.values<any>(getAllItems()).map((item) => Number(item.itemID))),
      itemIDsBefore,
    );
  } finally {
    config.clientCompatibilityProfile = previousProfile;
  }
});

test("a transient retry precheck failure preserves the pending character", async () => {
  const userid = 990000008;
  const previousProfile = config.clientCompatibilityProfile;
  const digest = "test-pending-precheck-digest";
  let attempts = 0;
  const service = new CharService({
    suiCharacterProvisioner: async (input, options) => {
      attempts += 1;
      if (attempts === 1) {
        await options.onTransactionPrepared({ transactionDigest: digest });
        throw new SuiCharacterProvisioningError(
          "TRANSACTION_STATUS_UNKNOWN",
          "mock ambiguous submission",
          { ambiguous: true, transactionDigest: digest },
        );
      }
      assert.equal(input.transactionDigest, digest);
      throw new SuiCharacterProvisioningError(
        "PRECHECK_FAILED",
        "mock temporary Sui outage",
      );
    },
  });
  const session: Record<string, any> = {
    userid,
    sendNotification() {},
    sendSessionChange() {},
  };
  const characterIDsBefore = new Set(listCharacterIDs());

  config.clientCompatibilityProfile = "frontier";
  try {
    await assert.rejects(
      service.Handle_CreateCharacterInSpace(["Sui Hold Test", 1], session),
    );
    const characterID = listCharacterIDs().find(
      (candidateID) => !characterIDsBefore.has(candidateID),
    );
    assert.ok(characterID);
    const itemCountAfterSubmission = Object.keys(getAllItems()).length;

    await assert.rejects(
      service.Handle_SelectCharacterID([characterID], session, null),
    );
    const pending = getCharacterRecord(characterID);
    assert.ok(pending);
    assert.equal(attempts, 2);
    assert.equal(pending.suiTransactionDigest, digest);
    assert.equal(pending.suiProvisioningStatus, "reconciliation-required");
    assert.equal(Object.keys(getAllItems()).length, itemCountAfterSubmission);
  } finally {
    config.clientCompatibilityProfile = previousProfile;
  }
});
