"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const assert = require("node:assert/strict");
const test = require("node:test");
const config = require("../src/config");
const CharService = require("../src/services/character/charService");
const { getCharacterRecord, listCharacterIDs, } = require("../src/services/character/characterState");
const { CREATION_FITTING_FLAG_ID, ensureCreationState, filterCreationModuleInventoryItems, readCreationState, } = require("../src/services/frontier/creationRuntime");
const CreationService = require("../src/services/frontier/creationService");
const { SuiCharacterProvisioningError, prepareSuiCharacterIdentity, } = require("../src/services/frontier/suiCharacterProvisioning");
const InvBrokerService = require("../src/services/inventory/invBrokerService");
const { ITEM_FLAGS, findCharacterShipItem, getAllItems, getItemMetadata, grantItemToCharacterLocation, listCharacterItems, listContainerItems, } = require("../src/services/inventory/itemStore");
const { marshalEncode, } = require("../src/network/tcp/utils/marshal");
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
function createCharacter(name, userid, creationOptions = {}) {
    const service = new CharService();
    return service.Handle_CreateCharacterWithDoll([name, 1, 1, 1, null, null, 0], { userid }, null, {
        starterLocation: STARTER_LOCATION,
        ...creationOptions,
    });
}
function createTestSuiCharacterProvisioner() {
    return async (input) => {
        const identity = input.identity || prepareSuiCharacterIdentity(input);
        return {
            ...identity,
            network: "localnet",
            baseUrl: "http://localhost:9000",
            playerProfileObjectId: `0x${(BigInt(identity.gameCharacterId) + 0x100000000n)
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
        }).Handle_CreateCharacterInSpace([name, 1], { userid });
    }
    finally {
        config.clientCompatibilityProfile = previousProfile;
    }
}
function assertMarshallableIterable(value) {
    assert.ok(value, "inventory call must never return None");
    assert.ok(value.type === "list" || value.type === "objectex1", `unexpected inventory iterable type ${String(value.type)}`);
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
    const characterID = await createFrontierCharacterInSpace("Frontier Creation Test", userid);
    const character = getCharacterRecord(characterID);
    const ship = findCharacterShipItem(characterID, character.shipID);
    assert.equal(character.shipTypeID, 95276);
    assert.equal(character.shipName, "Creation");
    assert.equal(character.suiProvisioningStatus, "confirmed");
    assert.equal(character.suiWalletAddress, prepareSuiCharacterIdentity({
        accountId: userid,
        gameCharacterId: characterID,
        characterName: character.characterName,
    }).walletAddress);
    assert.equal(character.suiWorldPackageId, "0x2aa4f4bac8c506f389b69e2e761804904854d9b61dfd9ac3f93b9d9cb07f0a00");
    assert.ok(character.suiCharacterObjectId);
    assert.ok(character.suiPlayerProfileObjectId);
    assert.equal(character.suiTransactionDigest, `test-sui-character-${characterID}`);
    assert.equal(ship.typeID, 95276);
    assert.equal(ship.itemName, "Creation");
    assert.equal(listCharacterItems(characterID).some((item) => Number(item.typeID) === 87698), false);
    const state = readCreationState(ship);
    assert.equal(state.version, 1);
    assert.equal(state.templateTypeID, 95276);
    assert.equal(state.poweredOff, false);
    assert.equal(state.modules.length, 27);
    assert.equal(state.interiorPlacements.length, 21);
    assert.equal(state.hardpoints.length, 7);
    const moduleItems = listContainerItems(characterID, ship.itemID, CREATION_FITTING_FLAG_ID);
    assert.equal(moduleItems.length, 27);
    assert.deepEqual(new Set(moduleItems.map((item) => Number(item.itemID))), new Set(state.modules.map((module) => Number(module.itemID))));
    for (const moduleItem of moduleItems) {
        assert.equal(moduleItem.ownerID, characterID);
        assert.equal(moduleItem.locationID, ship.itemID);
        assert.equal(moduleItem.flagID, CREATION_FITTING_FLAG_ID);
        assert.equal(moduleItem.singleton, 1);
        assert.equal(moduleItem.stacksize, 1);
    }
    const staleShipSnapshot = { ...ship, customInfo: "" };
    const secondEnsure = ensureCreationState(staleShipSnapshot, characterID);
    assert.equal(secondEnsure.success, true);
    assert.equal(secondEnsure.data.seeded, false);
    assert.equal(listContainerItems(characterID, ship.itemID, CREATION_FITTING_FLAG_ID).length, 27);
    const wrongOwnerEnsure = ensureCreationState(staleShipSnapshot, characterID + 1);
    assert.equal(wrongOwnerEnsure.success, false);
    assert.equal(wrongOwnerEnsure.errorMsg, "CREATION_ITEM_NOT_OWNED");
    const session = {
        charid: characterID,
        characterID,
        shipid: ship.itemID,
        shipID: ship.itemID,
        stationid: character.stationID,
        stationID: character.stationID,
        solarsystemid2: character.solarSystemID,
        compatibilityProfile: "frontier",
    };
    const creationResponse = new CreationService().Handle_get_creation([ship.itemID], session);
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
});
test("non-Creation ship inventory calls remain iterable", () => {
    const characterID = createCharacter("Inventory Guard Test", 990000003, {
        starterShipTypeID: CharService._testing.FRONTIER_STARTER_SHIP_TYPE_ID,
        starterShipName: CharService._testing.FRONTIER_STARTER_SHIP_NAME,
        initializeCreation: true,
    });
    const character = getCharacterRecord(characterID);
    const grant = grantItemToCharacterLocation(characterID, STARTER_LOCATION.stationID, ITEM_FLAGS.HANGAR, getItemMetadata(87698), 1, { singleton: 1, itemName: "Inventory Test Wend" });
    assert.equal(grant.success, true);
    const wend = grant.data.items[0];
    const ordinaryRows = [
        { itemID: 1, flagID: ITEM_FLAGS.CARGO_HOLD },
        { itemID: 2, flagID: 156 },
        { itemID: 3, flagID: CREATION_FITTING_FLAG_ID },
    ];
    assert.equal(readCreationState(wend), null);
    assert.equal(filterCreationModuleInventoryItems(wend, ordinaryRows), ordinaryRows);
    const session = {
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
    const session = { userid };
    const itemIDsBefore = new Set(Object.values(getAllItems()).map((item) => Number(item.itemID)));
    assert.equal(service.Handle_GetNumCharacters([], session), 0);
    assert.throws(() => service.Handle_CreateCharacterWithDoll(["Broken Creation Test", 1, 1, 1, null, null, 0], session, null, {
        starterLocation: STARTER_LOCATION,
        starterShipTypeID: 87698,
        starterShipName: "Wend",
        initializeCreation: true,
    }));
    assert.equal(service.Handle_GetNumCharacters([], session), 0);
    assert.deepEqual(new Set(Object.values(getAllItems()).map((item) => Number(item.itemID))), itemIDsBefore);
});
test("failed Sui Character provisioning rolls back the Frontier character", async () => {
    const userid = 990000005;
    const previousProfile = config.clientCompatibilityProfile;
    const service = new CharService({
        suiCharacterProvisioner: async () => {
            throw new SuiCharacterProvisioningError("TRANSACTION_FAILED", "mock rejected transaction");
        },
    });
    const session = { userid };
    const itemIDsBefore = new Set(Object.values(getAllItems()).map((item) => Number(item.itemID)));
    config.clientCompatibilityProfile = "frontier";
    try {
        await assert.rejects(service.Handle_CreateCharacterInSpace(["Sui Rollback Test", 1], session));
    }
    finally {
        config.clientCompatibilityProfile = previousProfile;
    }
    assert.equal(service.Handle_GetNumCharacters([], session), 0);
    assert.deepEqual(new Set(Object.values(getAllItems()).map((item) => Number(item.itemID))), itemIDsBefore);
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
                throw new SuiCharacterProvisioningError("TRANSACTION_STATUS_UNKNOWN", "mock ambiguous submission", {
                    ambiguous: true,
                    transactionDigest: "mock-ambiguous-digest",
                });
            }
            return confirmedProvisioner(input);
        },
    });
    const session = {
        userid,
        sendNotification() { },
        sendSessionChange() { },
    };
    const characterIDsBefore = new Set(listCharacterIDs());
    config.clientCompatibilityProfile = "frontier";
    try {
        await assert.rejects(service.Handle_CreateCharacterInSpace(["Sui Resume Test", 1], session));
        assert.equal(service.Handle_GetNumCharacters([], session), 1);
        const itemCountAfterAmbiguousSubmit = Object.keys(getAllItems()).length;
        const characterID = listCharacterIDs().find((candidateID) => !characterIDsBefore.has(candidateID));
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
    }
    finally {
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
                throw new SuiCharacterProvisioningError("TRANSACTION_STATUS_UNKNOWN", "mock ambiguous submission", { ambiguous: true, transactionDigest: digest });
            }
            assert.equal(input.transactionDigest, digest);
            throw new SuiCharacterProvisioningError("TRANSACTION_FAILED", "mock digest-confirmed failure", { transactionDigest: digest });
        },
    });
    const session = {
        userid,
        sendNotification() { },
        sendSessionChange() { },
    };
    const itemIDsBefore = new Set(Object.values(getAllItems()).map((item) => Number(item.itemID)));
    const characterIDsBefore = new Set(listCharacterIDs());
    config.clientCompatibilityProfile = "frontier";
    try {
        await assert.rejects(service.Handle_CreateCharacterInSpace(["Sui Retry Test", 1], session));
        const characterID = listCharacterIDs().find((candidateID) => !characterIDsBefore.has(candidateID));
        assert.ok(characterID);
        const pending = getCharacterRecord(characterID);
        assert.equal(pending.suiTransactionDigest, digest);
        assert.equal(pending.suiPreparedTransactionBytesBase64, transactionBytesBase64);
        assert.equal(pending.suiPreparedTransactionSignature, transactionSignature);
        assert.equal(pending.suiChainId, chainId);
        assert.equal(pending.suiSubmissionState, "submitting");
        assert.equal(pending.suiProvisioningStatus, "reconciliation-required");
        await assert.rejects(service.Handle_SelectCharacterID([characterID], session, null));
        assert.equal(attempts, 2);
        assert.equal(getCharacterRecord(characterID), null);
        assert.equal(service.Handle_GetNumCharacters([], session), 0);
        assert.deepEqual(new Set(Object.values(getAllItems()).map((item) => Number(item.itemID))), itemIDsBefore);
    }
    finally {
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
                throw new SuiCharacterProvisioningError("TRANSACTION_STATUS_UNKNOWN", "mock ambiguous submission", { ambiguous: true, transactionDigest: digest });
            }
            assert.equal(input.transactionDigest, digest);
            throw new SuiCharacterProvisioningError("PRECHECK_FAILED", "mock temporary Sui outage");
        },
    });
    const session = {
        userid,
        sendNotification() { },
        sendSessionChange() { },
    };
    const characterIDsBefore = new Set(listCharacterIDs());
    config.clientCompatibilityProfile = "frontier";
    try {
        await assert.rejects(service.Handle_CreateCharacterInSpace(["Sui Hold Test", 1], session));
        const characterID = listCharacterIDs().find((candidateID) => !characterIDsBefore.has(candidateID));
        assert.ok(characterID);
        const itemCountAfterSubmission = Object.keys(getAllItems()).length;
        await assert.rejects(service.Handle_SelectCharacterID([characterID], session, null));
        const pending = getCharacterRecord(characterID);
        assert.ok(pending);
        assert.equal(attempts, 2);
        assert.equal(pending.suiTransactionDigest, digest);
        assert.equal(pending.suiProvisioningStatus, "reconciliation-required");
        assert.equal(Object.keys(getAllItems()).length, itemCountAfterSubmission);
    }
    finally {
        config.clientCompatibilityProfile = previousProfile;
    }
});
//# sourceMappingURL=frontierNewCharacterCreation.test.js.map