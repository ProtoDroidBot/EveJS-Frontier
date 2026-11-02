import assert = require("node:assert/strict");
import test = require("node:test");

const config = require("../src/config");
const database = require("../src/gameStore");
const CharService = require("../src/services/character/charService");
const creationData = require("../src/services/character/characterCreationData");
const corporationState = require("../src/services/corporation/corporationState");
const worldData = require("../src/space/worldData");
const { resolveLegacyFrontierCharacterCreation } = require("../src/services/character/legacyFrontierCharacterCreation");
const { getCharacterRecord, listCharacterIDs } = require("../src/services/character/characterState");
const { getAllItems, findCharacterShipItem, listCharacterItems } = require("../src/services/inventory/itemStore");
const { readCreationState } = require("../src/services/frontier/creationRuntime");
const { SuiCharacterProvisioningError } = require("../src/services/frontier/suiCharacterProvisioning");

const CONFIG_FIELDS = ["clientBuildProfile", "clientBuild", "clientCompatibilityProfile"];
let previousConfig;
test.beforeEach(() => {
  previousConfig = Object.fromEntries(CONFIG_FIELDS.map(key => [key, config[key]]));
  Object.assign(config, { clientBuildProfile: "frontier-2703993", clientBuild: 2703993,
    clientCompatibilityProfile: "frontier" });
});
test.afterEach(() => Object.assign(config, previousConfig));

function mockNativeOrigin(t) {
  t.mock.method(creationData, "getCharacterCreationBloodline", bloodlineID => {
    const raceID = ({ 1: 1, 3: 2, 4: 2, 5: 4, 7: 8, 14: 2 })[bloodlineID];
    return raceID ? { bloodlineID, raceID } : null;
  });
  t.mock.method(creationData, "getCharacterCreationRace", raceID => ({
    raceID, shipTypeID: raceID === 4 ? 83930 : 84213,
  }));
  t.mock.method(corporationState, "getCorporationRecord", corporationID => ({
    corporationID, stationID: 60000043, factionID: 500002,
  }));
  t.mock.method(worldData, "getStationByID", stationID => ({
    stationID, corporationID: 1000442, solarSystemID: 30000272,
    constellationID: 20000047, regionID: 10000009,
  }));
  t.mock.method(worldData, "getSolarSystemByID", solarSystemID => ({
    solarSystemID, constellationID: 20000047, regionID: 10000009,
  }));
}

function isUserError(error, message = "CustomInfo") {
  return error?.machoErrorResponse?.payload?.header?.[1]?.[0] === message;
}

test("2703993 CreateCharacter2 dispatch maps all six arguments and returns the plain character ID", t => {
  mockNativeOrigin(t);
  const service = new CharService({ suiCharacterProvisioningEnabled: false });
  const session = { userid: 990027001 };
  const name = Buffer.from("Legacy Origin Test");
  let calls = 0;
  t.mock.method(service, "Handle_CreateCharacterWithDoll", (args, actualSession, kwargs, options) => {
    calls += 1;
    assert.deepEqual(args, [name, 14, 0, 64, null, null, 14, 2]);
    assert.equal(actualSession, session);
    assert.equal(kwargs, null);
    assert.equal(options.argumentSignature, "latest-container");
    assert.equal(options.initializeCreation, false);
    assert.equal(options.requireStarterShip, true);
    assert.equal(options.provisionSuiCharacter, false);
    assert.equal(options.starterShipTypeID, 84213);
    assert.equal(options.starterShipName, "Crawler");
    assert.deepEqual(options.starterLocation, {
      corporationID: 1000170, factionID: 500002,
      stationID: 60000063, homeStationID: 60000063, cloneStationID: 60000063,
      solarSystemID: 30000272, constellationID: 20000047, regionID: 10000009,
    });
    return 140027001;
  });
  assert.equal(service.callMethod("CreateCharacter2", [name, 14, 2, 0, 64, 14], session, null), 140027001);
  assert.equal(calls, 1);
});

test("2703993 native schools retain their authored empire station and corporation", t => {
  mockNativeOrigin(t);
  const rows = [
    [5, 4, 11, 1000424, 60000086, 83930], [5, 4, 12, 1000424, 60000086, 83930],
    [5, 4, 13, 1000424, 60000086, 83930], [3, 2, 14, 1000170, 60000063, 84213],
    [3, 2, 15, 1000171, 60000063, 84213], [3, 2, 16, 1000172, 60000063, 84213],
    [1, 1, 17, 1000167, 60000069, 84213], [1, 1, 18, 1000045, 60000069, 84213],
    [1, 1, 19, 1000044, 60000069, 84213], [7, 8, 20, 1000168, 60000071, 84213],
    [7, 8, 21, 1000115, 60000071, 84213], [7, 8, 22, 1000169, 60000071, 84213],
  ];
  for (const [bloodlineID, raceID, schoolID, corporationID, stationID, shipID] of rows) {
    const origin = resolveLegacyFrontierCharacterCreation({ bloodlineID, raceID, schoolID });
    assert.equal(origin.starterLocation.stationID, stationID);
    assert.equal(origin.starterLocation.corporationID, corporationID);
    assert.equal(origin.starterShipTypeID, shipID);
  }
});

test("native school authority is shared by metadata and normalization only for exact build 2703993", () => {
  const schools = creationData.getCharacterCreationSchools();
  assert.deepEqual(schools.map(school => school.schoolID), Array.from({ length: 15 }, (_, index) => index + 11));
  const school = creationData.getCharacterCreationSchool(14);
  assert.equal(school.raceID, 2);
  assert.equal(school.corporationID, 1000170);
  assert.equal(school.careerID, 21);
  assert.deepEqual(school.startingStations, [60000063]);
  assert.equal(creationData.resolveCharacterCreationSchoolIDForRace(14, 2), 14);
  config.clientBuildProfile = "auto";
  assert.equal(creationData.resolveCharacterCreationSchoolIDForRace(14, 2), 14);
  config.clientBuild = 3640684;
  config.clientBuildProfile = "frontier-3640684";
  const { TABLE, readStaticRows } = require("../src/services/_shared/referenceData");
  assert.deepEqual(creationData.getCharacterCreationSchools().map(row => row.schoolID),
    readStaticRows(TABLE.CHARACTER_CREATION_SCHOOLS).map(row => Number(row.schoolID || row._key)));
});

test("CreateCharacter2 rejects unverified builds, malformed signatures and mismatched origins before creation", t => {
  mockNativeOrigin(t);
  const service = new CharService({ suiCharacterProvisioningEnabled: false });
  t.mock.method(service, "Handle_CreateCharacterWithDoll", () => assert.fail("invalid origin reached creation"));
  const valid = ["Legacy Rejected Test", 3, 2, 0, 64, 14];
  for (const args of [valid.slice(0, 5), [...valid, null],
    [valid[0], 3, 2, 1, 64, 14], [valid[0], 3, 2, 0, 0, 14],
    [valid[0], 3.5, 2, 0, 64, 14], [valid[0], "3", 2, 0, 64, 14],
    [valid[0], 1, 2, 0, 64, 14], [valid[0], 3, 2, 0, 64, 17],
    [valid[0], 3, 2, 0, 64, 33], [valid[0], 3, 16, 0, 64, 23]]) {
    assert.throws(() => service.Handle_CreateCharacter2(args, { userid: 990027002 }), isUserError);
  }
  for (const [profile, build, compatibility] of [
    ["frontier-3640684", 3640684, "frontier"],
    ["frontier-2703993", 3502403, "frontier"],
    ["frontier-2703993", 2703993, "tranquility"],
  ]) {
    Object.assign(config, { clientBuildProfile: profile, clientBuild: build, clientCompatibilityProfile: compatibility });
    assert.throws(() => service.Handle_CreateCharacter2(valid, { userid: 990027002 }), isUserError);
  }
});

test("legacy origin fails closed when native station, world, corporation or race data is unavailable", t => {
  mockNativeOrigin(t);
  const input = { bloodlineID: 3, raceID: 2, schoolID: 14 };
  for (const [object, method, replacement] of [
    [worldData, "getStationByID", () => null],
    [worldData, "getSolarSystemByID", () => null],
    [worldData, "getSolarSystemByID", () => ({ solarSystemID: 30000272, constellationID: 9, regionID: 9 })],
    [corporationState, "getCorporationRecord", () => null],
    [creationData, "getCharacterCreationRace", () => ({ raceID: 2, shipTypeID: 95276 })],
  ] as any[]) {
    const original = object[method];
    object[method] = replacement;
    try { assert.throws(() => resolveLegacyFrontierCharacterCreation(input), isUserError); }
    finally { object[method] = original; }
  }
});

function requireNativeBaseline(t) {
  if (Number(database.read("characterCreationRaces", "/source/buildNumber").data) !== 2703993) {
    t.skip("requires isolated EVEJS_TEST_STORE_BASELINE_ROOT for build 2703993");
    return false;
  }
  return true;
}
const TEST_WORLD = { packageId: "0x1", objectRegistryId: "0x2", adminAclId: "0x3", tenant: "legacy-test", tribeId: 1 };
function serviceWithProvisioner(provisioner) {
  return new CharService({ suiCharacterProvisioner: provisioner,
    suiCharacterProvisioningOptions: { world: TEST_WORLD } });
}
function confirmed(input) {
  return { ...input.identity, network: "localnet", baseUrl: "http://localhost:9000",
    playerProfileObjectId: "0x4", transactionDigest: `legacy-test-${input.gameCharacterId}`,
    chainId: "test-chain", recovered: false };
}

test("native legacy creation persists school14 and Crawler at the selected Keep and provisions the world", async t => {
  if (!requireNativeBaseline(t)) return;
  let calls = 0;
  const service = serviceWithProvisioner(async input => { calls += 1; return confirmed(input); });
  const session = { userid: 990027010 };
  const characterID = await service.callMethod("CreateCharacter2", ["Legacy Crawler Test", 3, 2, 0, 64, 14], session, null);
  assert.equal(typeof characterID, "number");
  assert.equal(calls, 1);
  const character = getCharacterRecord(characterID);
  const ship = findCharacterShipItem(characterID, character.shipID);
  for (const [key, value] of Object.entries({ accountId: session.userid, bloodlineID: 3, raceID: 2,
    gender: 0, ancestryID: 64, schoolID: 14, corporationID: 1000170, factionID: 500002,
    stationID: 60000063, homeStationID: 60000063, cloneStationID: 60000063,
    solarSystemID: 30000272, constellationID: 20000047, regionID: 10000009,
    shipTypeID: 84213, shipName: "Crawler", suiProvisioningStatus: "confirmed" })) {
    assert.equal(character[key], value, key);
  }
  assert.equal(character.appearanceInfo, null);
  assert.equal(character.portraitInfo, null);
  assert.equal(ship.typeID, 84213);
  assert.equal(ship.locationID, 60000063);
  assert.equal(readCreationState(ship), null);
  assert.equal(service.Handle_GetNumCharacters([], session), 1);
});

test("legacy creation preserves authenticated-session and name validation without writing characters", t => {
  if (!requireNativeBaseline(t)) return;
  const service = serviceWithProvisioner(async () => assert.fail("invalid request reached provisioning"));
  const before = listCharacterIDs();
  assert.throws(() => service.Handle_CreateCharacter2(["Legacy Session Test", 3, 2, 0, 64, 14], { userid: 0 }), isUserError);
  assert.throws(() => service.Handle_CreateCharacter2(["x", 3, 2, 0, 64, 14], { userid: 990027011 }), error => isUserError(error, "CharNameInvalid"));
  assert.deepEqual(listCharacterIDs(), before);
});

test("legacy world provisioning failure rolls back the character and its inventory", async t => {
  if (!requireNativeBaseline(t)) return;
  const service = serviceWithProvisioner(async () => {
    throw new SuiCharacterProvisioningError("TRANSACTION_FAILED", "test rejected transaction");
  });
  const session = { userid: 990027012 };
  const beforeCharacters = listCharacterIDs();
  const beforeItems = Object.keys(getAllItems());
  await assert.rejects(service.Handle_CreateCharacter2(["Legacy Rollback Test", 3, 2, 0, 64, 14], session), isUserError);
  assert.equal(service.Handle_GetNumCharacters([], session), 0);
  assert.deepEqual(listCharacterIDs(), beforeCharacters);
  assert.deepEqual(Object.keys(getAllItems()), beforeItems);
});

test("legacy ambiguous creation retries the same character and prepared digest", async t => {
  if (!requireNativeBaseline(t)) return;
  let attempts = 0;
  const digest = "legacy-ambiguous-test-digest";
  const seenIDs = [];
  const service = serviceWithProvisioner(async input => {
    attempts += 1;
    seenIDs.push(input.gameCharacterId);
    if (attempts === 1) throw new SuiCharacterProvisioningError("TRANSACTION_STATUS_UNKNOWN", "test lost response", { ambiguous: true, transactionDigest: digest });
    assert.equal(input.transactionDigest, digest);
    return confirmed(input);
  });
  const session = { userid: 990027013 };
  const args = ["Legacy Retry Test", 3, 2, 0, 64, 14];
  await assert.rejects(service.Handle_CreateCharacter2(args, session), isUserError);
  assert.equal(service.Handle_GetNumCharacters([], session), 1);
  const inventory = listCharacterItems(seenIDs[0]).map(item => item.itemID);
  const characterID = await service.Handle_CreateCharacter2(args, session);
  assert.deepEqual(seenIDs, [characterID, characterID]);
  assert.equal(service.Handle_GetNumCharacters([], session), 1);
  assert.deepEqual(listCharacterItems(characterID).map(item => item.itemID), inventory);
  assert.equal(getCharacterRecord(characterID).suiProvisioningStatus, "confirmed");
});

test("required legacy starter-ship failures roll back without invoking Creation initialization", t => {
  if (!requireNativeBaseline(t)) return;
  const service = new CharService({ suiCharacterProvisioningEnabled: false });
  const beforeCharacters = listCharacterIDs();
  const beforeItems = Object.keys(getAllItems());
  const origin = resolveLegacyFrontierCharacterCreation({ bloodlineID: 3, raceID: 2, schoolID: 14 });
  assert.throws(() => service.Handle_CreateCharacterWithDoll(
    ["Legacy Ship Failure", 3, 0, 64, null, null, 14, 2], { userid: 990027014 }, null,
    { ...origin, starterShipTypeID: 999999999, argumentSignature: "latest-container",
      requireStarterShip: true, initializeCreation: false },
  ), isUserError);
  assert.deepEqual(listCharacterIDs(), beforeCharacters);
  assert.deepEqual(Object.keys(getAllItems()), beforeItems);
});
