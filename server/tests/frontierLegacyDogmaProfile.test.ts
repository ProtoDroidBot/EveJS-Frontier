import assert = require("node:assert/strict");
import test = require("node:test");
import fs = require("node:fs");
import path = require("node:path");

const config = require("../src/config");
const database = require("../src/gameStore");
const DogmaService = require("../src/services/dogma/dogmaService");
const ShipService = require("../src/services/ship/shipService");
const compatibility = require("../src/services/dogma/dogmaInfoCompatibility");
const { marshalEncode, marshalDecode } = require("../src/network/tcp/utils/marshal");
const { buildChargeDogmaPrimeEntry, buildInventoryDogmaPrimeEntry, updateCharacterRecord } = require("../src/services/character/characterState");
const { ITEM_FLAGS, getItemMetadata, grantItemToCharacterLocation, updateInventoryItem, findItemById, setActiveShipForCharacter } = require("../src/services/inventory/itemStore");
const { getShipFuelCharge, getShipFuelProperties } = require("../src/services/frontier/fuelTankRuntime");

const NOW = 134377517707280000n;
const FIELDS = ["instanceID", "online", "damage", "charge", "skillPoints", "armorDamage", "shieldCharge", "incapacitated", "fuelCharge", "fuelEfficiency"];
const previous = { build: config.clientBuild, profile: config.clientBuildProfile, compatibility: config.clientCompatibilityProfile };
test.beforeEach(() => Object.assign(config, { clientBuild: 2703993, clientBuildProfile: "frontier-2703993", clientCompatibilityProfile: "frontier" }));
test.afterEach(() => Object.assign(config, { clientBuild: previous.build, clientBuildProfile: previous.profile, clientCompatibilityProfile: previous.compatibility }));

function entries(value): Map<any, any> { return new Map<any, any>((value?.entries || []).map(([key, item]) => [Buffer.isBuffer(key) ? key.toString() : key, item])); }
function infoFields(value) { return entries(value.args); }
function roundTrip(value) { return marshalDecode(marshalEncode(value)); }
function scalarAttributes(info) {
  const values = entries(infoFields(roundTrip(info)).get("attributes"));
  assert.ok(values.size > 0);
  for (const [id, value] of values) {
    assert.equal(typeof value, "number", `attribute ${id} must be numeric, without a timestamp tuple`);
    assert.ok(Number.isFinite(value), `attribute ${id} must be finite`);
  }
  return values;
}
function nativeBaseline(t) {
  if (Number(database.read("characterCreationRaces", "/source/buildNumber").data) !== 2703993) {
    t.skip("requires an isolated build 2703993 baseline");
    return false;
  }
  return true;
}
function createShip(t) {
  if (!nativeBaseline(t)) return null;
  const charID = 140000001;
  const granted = grantItemToCharacterLocation(charID, 60000069, ITEM_FLAGS.HANGAR, getItemMetadata(84213), 1);
  assert.equal(granted.success, true);
  const shipID = granted.data.items[0].itemID;
  assert.equal(setActiveShipForCharacter(charID, shipID).success, true);
  const updated = updateInventoryItem(shipID, current => ({
    ...current, conditionState: { damage: 1.5, charge: 12.25, armorDamage: 2.5, shieldCharge: 25.5,
      fuelCharge: 73.25, fuelQueue: [{ fuelTypeID: 77818, quantity: 73.25 }] },
  }));
  assert.equal(updated.success, true, updated.errorMsg);
  const result = updateCharacterRecord(charID, current => ({ ...current, shipID, stationID: 60000069, solarSystemID: 30000322 }));
  assert.equal(result.success, true);
  const session: Record<string, any> = { userid: 1, charid: charID, characterID: charID,
    shipid: shipID, shipID, stationid: 60000069, stationID: 60000069,
    locationid: 60000069, locationID: 60000069, solarsystemid2: 30000322,
    compatibilityProfile: "frontier", sendNotification() {} };
  return { ship: findItemById(shipID), session, charID, shipID };
}
function assertNativeRows(state, shipID, ship, charID) {
  assert.equal(state.length, 4, "native activation unpacks heat state as the fourth element");
  const cache = entries(state[0]);
  for (const [id, row] of cache) {
    assert.equal(row.type, "packedrow");
    assert.deepEqual(row.columns.map(column => column[0]), FIELDS);
    assert.equal(typeof row.fields.fuelCharge, "number");
    assert.equal(typeof row.fields.fuelEfficiency, "number");
    const decoded = roundTrip(row);
    assert.equal(decoded.type, "packedrow");
    assert.equal(decoded.fields.fuelCharge, row.fields.fuelCharge);
    assert.equal(decoded.fields.fuelEfficiency, row.fields.fuelEfficiency);
    if (id !== shipID) {
      assert.equal(row.fields.fuelCharge, 0);
      assert.equal(row.fields.fuelEfficiency, 0);
    }
  }
  assert.ok(cache.has(charID));
  assert.equal(cache.get(shipID).fields.fuelCharge, getShipFuelCharge(ship));
  assert.equal(cache.get(shipID).fields.fuelEfficiency, getShipFuelProperties(ship).fuelEfficiency);
  assert.equal(cache.get(shipID).fields.fuelCharge, 73.25);
  assert.equal(cache.get(shipID).fields.fuelEfficiency, 30);
}

test("Dogma compatibility opts in only for exact numeric 2703993 Frontier", () => {
  assert.equal(compatibility.usesLegacyFrontierDogmaProfile("frontier", 2703993), true);
  for (const [profile, build] of [["frontier", undefined], ["frontier", 3640684], ["frontier", 2702949], ["tranquility", 2703993], ["frontier", "2703993"]]) {
    assert.equal(compatibility.usesLegacyFrontierDogmaProfile(profile, build), false);
  }
});

test("2703993 common GetInfo returns scalar wire values and keeps independent clocks", t => {
  const service = new DogmaService();
  t.mock.method(service, "_sessionFileTime", () => NOW);
  t.mock.method(service, "_nowFileTime", () => NOW + 1n);
  const info = service._buildCommonGetInfoEntry({ itemID: 9988400000231, invItem: null,
    attributes: { type: "dict", entries: [[18, 50], [55, 0.0], [5633, 150], [5635, 73.25], [5607, 30]] },
    session: { compatibilityProfile: "frontier" } });
  const attributes = scalarAttributes(info);
  assert.equal(attributes.get(5635), 73.25);
  assert.equal(attributes.get(5607), 30);
  const fields = infoFields(roundTrip(info));
  assert.equal(fields.get("time"), NOW);
  assert.equal(fields.get("wallclockTime"), NOW + 1n);
});

test("2703993 inventory and charge primes use scalar attributes through shared lazy build selection", () => {
  const item = { itemID: 9988400000232, typeID: 77818, ownerID: 140000001,
    locationID: 9988400000231, flagID: 5, groupID: 1920, categoryID: 8,
    quantity: 7, stacksize: 7, singleton: 0 };
  const inventory = buildInventoryDogmaPrimeEntry(item, { compatibilityProfile: "frontier", now: NOW,
    attributeOverrides: { 18: 50, 5635: 7, 5607: 30 } });
  assert.equal(scalarAttributes(inventory).get(5635), 7);
  const charge = buildChargeDogmaPrimeEntry(item, { compatibilityProfile: "frontier", now: NOW,
    attributeOverrides: { 5635: 7, 5607: 30 } });
  assert.equal(scalarAttributes(charge).get(5607), 30);
  const modern = buildInventoryDogmaPrimeEntry(item, { compatibilityProfile: "frontier", clientBuild: 3640684,
    now: NOW, attributeOverrides: { 5635: 7 } });
  assert.deepEqual(infoFields(modern).get("attributes").entries, [[5635, [7, NOW]]]);
});

test("both packed-row producers append native fuel slots and preserve scalar wire fields", () => {
  for (const service of [new DogmaService(), new ShipService()]) {
    const row = service._buildPackedInstanceRow({ itemID: 9988400000231, damage: 1.5,
      fuelCharge: 73.25, fuelEfficiency: 30 }, { compatibilityProfile: "frontier" });
    assert.deepEqual(row.columns.map(column => column[0]), FIELDS);
    assert.equal(roundTrip(row).fields.fuelCharge, 73.25);
    assert.equal(roundTrip(row).fields.fuelEfficiency, 30);
    const module = service._buildPackedInstanceRow({ itemID: 9988400000232 }, { compatibilityProfile: "frontier" });
    assert.equal(module.fields.fuelCharge, 0);
    assert.equal(module.fields.fuelEfficiency, 0);
  }
});

test("Dogma GetAllInfo activation preserves real Crawler fuel and character instance slots", t => {
  const fixture = createShip(t); if (!fixture) return;
  const { ship, session, charID, shipID } = fixture;
  const service = new DogmaService();
  const allInfo = entries(service.Handle_GetAllInfo([], session).args);
  const state = allInfo.get("shipState");
  assertNativeRows(state, shipID, ship, charID);
  const shipInfos = entries(allInfo.get("shipInfo"));
  const shipInfo = shipInfos.get(shipID);
  assert.ok(shipInfo, "actual GetAllInfo includes the active Crawler");
  const attributes = scalarAttributes(shipInfo);
  assert.equal(attributes.get(5635), 73.25);
  assert.equal(attributes.get(5607), 30);
  if (process.env.EVEJS_DOGMA_EVIDENCE_DIR) {
    const directory = path.resolve(process.env.EVEJS_DOGMA_EVIDENCE_DIR);
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(path.join(directory, "server-dogma-payload.json"), JSON.stringify({
      source: "DogmaService.Handle_GetAllInfo", build: config.clientBuild,
      attributes: [...attributes], time: String(infoFields(shipInfo).get("time")),
      instanceRow: FIELDS.map(field => entries(state[0]).get(shipID).fields[field]),
      activationLength: state.length,
      wireBase64: marshalEncode(shipInfo).toString("base64"),
    }, null, 2) + "\n");
  }
});

test("ship Board activation uses the same ten-slot native fuel contract", t => {
  const fixture = createShip(t); if (!fixture) return;
  const { ship, session, charID, shipID } = fixture;
  assertNativeRows(new ShipService()._buildActivationResponse(ship, session), shipID, ship, charID);
});

test("modern Frontier and Tranquility payload shapes remain unchanged", () => {
  const attrs = { type: "dict", entries: [[18, 50]] };
  const timestamped = compatibility.normalizeInfoAttributesForProfile(attrs, NOW, "frontier", 3640684);
  assert.deepEqual(timestamped.entries, [[18, [50, NOW]]]);
  for (const service of [new DogmaService(), new ShipService()]) {
    const row = service._buildPackedInstanceRow({ itemID: 12 }, { compatibilityProfile: "frontier", clientBuild: 3640684 });
    assert.equal(row.columns.length, 8);
    const state = [{ type: "dict", entries: [[12, row]] }, {}, {}, {}];
    const modern = compatibility.normalizeActivationStateForProfile(state, "frontier", 3640684);
    assert.equal(modern.length, 3);
    assert.equal(modern[0].entries[0][1].type, "dict");
    assert.equal(compatibility.normalizeActivationStateForProfile(state, "tranquility", 2703993), state);
    assert.equal(compatibility.normalizeInfoAttributesForProfile(attrs, NOW, "tranquility", 2703993), attrs);
    assert.equal(service._buildPackedInstanceRow({ itemID: 12 }, { compatibilityProfile: "tranquility", clientBuild: 2703993 }).columns.length, 8);
  }
});
