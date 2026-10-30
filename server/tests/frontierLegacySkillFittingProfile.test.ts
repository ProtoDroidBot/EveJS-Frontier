import assert = require("node:assert/strict");
import test = require("node:test");
import fs = require("node:fs");
import path = require("node:path");
const config = require("../src/config");
const database = require("../src/gameStore");
const DogmaService = require("../src/services/dogma/dogmaService");
const InvBrokerService = require("../src/services/inventory/invBrokerService");
const SkillMgrService = require("../src/services/skills/skillMgrService");
const { getCharacterInventoryCategoryIDForProfile } = require("../src/services/dogma/dogmaInfoCompatibility");
const { normalizeInfoAttributesForProfile, normalizeDogmaNotificationForProfile } = require("../src/services/dogma/dogmaInfoCompatibility");
const referenceData = require("../src/services/_shared/referenceData");
const ClientSession = require("../src/network/clientSession");
const { buildModuleAttributeChangeEvent, buildOnMultiEventPayload } = require("../src/services/_shared/godmaMultiEvent");
const { marshalEncode, marshalDecode } = require("../src/network/tcp/utils/marshal");
const { getCharacterRecord, updateCharacterRecord } = require("../src/services/character/characterState");
const { getItemMetadata, grantItemToCharacterLocation, setActiveShipForCharacter, updateInventoryItem, findItemById, ITEM_FLAGS } = require("../src/services/inventory/itemStore");
const { getTypeDogmaAttributes, getTypeEffectRecords } = require("../src/services/fitting/liveFittingState");
const { getBoosterTypeInfo } = require("../src/services/skills/boosters/boosterRuntime");
const previous = Object.fromEntries(["clientBuild", "clientBuildProfile", "clientCompatibilityProfile"].map(k => [k, config[k]]));
const profile = () => Object.assign(config, { clientBuild: 2703993, clientBuildProfile: "frontier-2703993", clientCompatibilityProfile: "frontier" });
test.beforeEach(profile);
test.afterEach(() => Object.assign(config, previous));
const dir = process.env.EVEJS_SKILL_FITTING_EVIDENCE_DIR;
let fixture;
const evidence: Record<string, any> = { build: 2703993, source: "Wire-roundtripped DogmaService and SkillMgrService responses from isolated 2703993 data", boosterCases: [] };
function map(value): Map<any, any> {
  return new Map<any, any>((value?.entries || []).map(([key, item]) => [
    Buffer.isBuffer(key) ? key.toString() :
      typeof key === "bigint" && Number.isSafeInteger(Number(key)) ? Number(key) : key,
    item,
  ]));
}
function fields(value): Map<any, any> { return map(value.args); }
function wire(value) { return marshalDecode(marshalEncode(value)); }
function tuple(value) { return Array.isArray(value) ? value : value.items; }
function inventoryFields(row) {
  assert.equal(row.name, "util.Row");
  const data = fields(row);
  const header = tuple(data.get("header"));
  const line = tuple(data.get("line"));
  return Object.fromEntries(header.map((key, index) => [String(key), line[index]]));
}
function scalarMap(info) {
  const result = map(fields(info).get("attributes"));
  assert.ok(result.size > 0);
  for (const [id, value] of result) {
    assert.equal(typeof value, "number", `numeric attribute ${id}`);
    assert.ok(Number.isFinite(value));
    assert.ok(fixture.attributeIDs.has(Number(id)), `native 2703993 recognizes attribute ${id}`);
  }
  return result;
}
function project(info) {
  const f = fields(info);
  return { itemID: f.get("itemID"), invItem: f.get("invItem").fields,
    attributes: [...scalarMap(info)], time: String(f.get("time")), wallclockTime: String(f.get("wallclockTime")) };
}
function requireFixture(t) {
  if (!fixture) { t.skip("requires an isolated build 2703993 baseline"); return false; }
  return true;
}
function characterInventory(info) {
  const item = fields(wire(info)).get("invItem");
  assert.equal(item.type, "packedrow");
  assert.equal(item.fields.itemID, fixture.charID);
  assert.equal(item.fields.groupID, 1);
  assert.equal(item.fields.categoryID, 1);
  return item.fields;
}

test.before(() => {
  profile();
  if (Number(database.read("characterCreationRaces", "/source/buildNumber").data) !== 2703993) return;
  const charID = 140000001;
  const result = grantItemToCharacterLocation(charID, 60000069, ITEM_FLAGS.HANGAR, getItemMetadata(84213), 1);
  assert.equal(result.success, true);
  const shipID = result.data.items[0].itemID;
  assert.equal(setActiveShipForCharacter(charID, shipID).success, true);
  assert.equal(updateInventoryItem(shipID, current => ({ ...current, conditionState: {
    ...current.conditionState, fuelCharge: 73.25,
    fuelQueue: [{ fuelTypeID: 77818, quantity: 73.25 }],
  } })).success, true);
  assert.equal(updateCharacterRecord(charID, current => ({ ...current, shipID, boosters: [],
    stationID: 60000069, solarSystemID: 30000322 })).success, true);
  const session = { userid: 1, charid: charID, characterID: charID, shipid: shipID, shipID,
    stationid: 60000069, stationID: 60000069, locationid: 60000069, locationID: 60000069,
    solarsystemid2: 30000322, compatibilityProfile: "frontier", sendNotification() {} };
  const catalog = referenceData.readStaticTable(referenceData.TABLE.TYPE_DOGMA);
  assert.equal(catalog.source.buildNumber, 2703993);
  assert.equal(catalog.source.authority, "eve-frontier-client-static-2703993");
  const attributeIDs = new Set(Object.keys(catalog.attributeTypesByID).map(Number));
  fixture = { charID, shipID, session, ship: findItemById(shipID), attributeIDs };
  Object.assign(evidence, { charID, shipID, stationID: 60000069 });
});

test("authored character category is scoped to exact Frontier 2703993", () => {
  assert.equal(getCharacterInventoryCategoryIDForProfile("frontier", 2703993), 1);
  for (const [p, b] of [["frontier", 3640684], ["tranquility", 2703993], ["frontier", undefined], ["frontier", "2703993"]]) {
    assert.equal(getCharacterInventoryCategoryIDForProfile(p, b), 3);
  }
});

test("legacy info excludes unsupported attributes without discarding recognized zero values", t => {
  if (!requireFixture(t)) return;
  const attributes = { type: "dict", entries: [[263, 0], [5635, 73.25], [6123, 1], [6124, 2], [6311, 3], [999999, 4]] };
  const original = structuredClone(attributes);
  const filtered = normalizeInfoAttributesForProfile(attributes, 123n, "frontier", 2703993);
  assert.deepEqual(filtered.entries, [[263, 0], [5635, 73.25]]);
  assert.deepEqual(attributes, original, "wire filtering must not alter authoritative server data");
  const info = new DogmaService()._buildCommonGetInfoEntry({ itemID: fixture.shipID,
    invItem: null, attributes, session: fixture.session });
  assert.deepEqual([...scalarMap(wire(info))], filtered.entries);
  const modern = normalizeInfoAttributesForProfile(attributes, 123n, "frontier", 3640684);
  assert.deepEqual(modern.entries, attributes.entries.map(([id, value]) => [id, [value, 123n]]));
  assert.equal(normalizeInfoAttributesForProfile(attributes, 123n, "tranquility", 2703993), attributes);
});

test("legacy attribute filtering requires an authoritative catalog for this build", t => {
  const attributes = { type: "dict", entries: [[263, 0]] };
  const nativeSource = { buildNumber: 2703993, authority: "eve-frontier-client-static-2703993", profile: "frontier" };
  for (const catalog of [null, { source: nativeSource, attributeTypesByID: {} },
    { source: nativeSource, attributeTypesByID: { 263: { attributeID: 55 } } },
    { source: { ...nativeSource, buildNumber: 3640684 }, attributeTypesByID: { 263: {} } },
    { source: { ...nativeSource, authority: "unknown" }, attributeTypesByID: { 263: {} } }]) {
    const mock = t.mock.method(referenceData, "readStaticTable", () => catalog);
    assert.throws(() => normalizeInfoAttributesForProfile(attributes, 123n, "frontier", 2703993),
      { code: "LEGACY_DOGMA_ATTRIBUTE_SCHEMA_UNAVAILABLE" });
    assert.equal(normalizeInfoAttributesForProfile(attributes, 123n, "tranquility", 2703993), attributes);
    mock.mock.restore();
  }
});

test("live attribute notifications exclude unsupported IDs and preserve mixed event ordering", t => {
  if (!requireFixture(t)) return;
  const when = 134377563402000000n;
  const event = id => ["OnModuleAttributeChange", fixture.charID, fixture.shipID, id, when, 73.25, 72, when];
  const known = event(5635);
  const unknown = [6123, 6124, 6311].map(event);
  const plural = [{ type: "list", items: [unknown[0], known, unknown[1], unknown[2]] }];
  const original = structuredClone(plural);
  assert.deepEqual(normalizeDogmaNotificationForProfile("OnModuleAttributeChanges", plural, "frontier", 2703993),
    [{ type: "list", items: [known] }]);
  assert.deepEqual(plural, original);
  assert.equal(normalizeDogmaNotificationForProfile("OnModuleAttributeChange", known.slice(1), "frontier", 2703993)[2], 5635);
  assert.equal(normalizeDogmaNotificationForProfile("OnModuleAttributeChange", unknown[0].slice(1), "frontier", 2703993), null);
  assert.equal(normalizeDogmaNotificationForProfile("OnModuleAttributeChanges", [{ type: "list", items: unknown }], "frontier", 2703993), null);
  const otherEvent = { type: "tuple", items: ["OnGodmaShipEffect", fixture.shipID, 16, when] };
  const nested = buildOnMultiEventPayload([
    buildModuleAttributeChangeEvent(fixture.charID, fixture.shipID, 6123, 2, 1, when),
    otherEvent,
    buildModuleAttributeChangeEvent(fixture.charID, fixture.shipID, 5635, 73.25, 72, when),
  ], when);
  const nestedResult = normalizeDogmaNotificationForProfile("OnMultiEvent", nested, "frontier", 2703993);
  const pairs = nestedResult[0].items;
  assert.equal(pairs.length, 2);
  assert.equal(pairs[0].items[0], otherEvent);
  assert.deepEqual(pairs[1], nested[0].items[2]);
  for (const [profileName, build] of [["frontier", 3640684], ["tranquility", 2703993]]) {
    for (const [name, payload] of [["OnModuleAttributeChanges", plural], ["OnMultiEvent", nested]]) {
      assert.equal(normalizeDogmaNotificationForProfile(name, payload, profileName, build), payload);
    }
  }
  assert.equal(normalizeDogmaNotificationForProfile("OnItemChange", plural, "frontier", 2703993), plural);
});

test("real ClientSession notification boundary applies the native attribute filter", t => {
  if (!requireFixture(t)) return;
  const packets = [];
  const session = { ...fixture.session, socket: { destroyed: false },
    sendPacket(_packet, _callback, options) { packets.push(wire(options.innerMarshals[0].value)); } };
  const send = (name, payload) => ClientSession.prototype.sendNotification.call(session, name, "clientID", payload);
  const when = 134377563402000000n;
  const event = id => ["OnModuleAttributeChange", fixture.charID, fixture.shipID, id, when, 73.25, 72, when];
  const cases = [
    { name: "fuel-batch", notifyType: "OnModuleAttributeChanges", payload: [{ type: "list", items: [event(6123), event(5635), event(6311)] }] },
    { name: "single-fuel", notifyType: "OnModuleAttributeChange", payload: event(5635).slice(1) },
    { name: "fitting-multi", notifyType: "OnMultiEvent", payload: buildOnMultiEventPayload([
      buildModuleAttributeChangeEvent(fixture.charID, fixture.shipID, 6124, 2, 1, when),
      buildModuleAttributeChangeEvent(fixture.charID, fixture.shipID, 5635, 73.25, 72, when),
    ], when) },
  ];
  evidence.notificationCases = [];
  for (const entry of cases) {
    const expected = wire(normalizeDogmaNotificationForProfile(entry.notifyType, entry.payload, "frontier", 2703993));
    send(entry.notifyType, entry.payload);
    assert.equal(packets.length, evidence.notificationCases.length + 1);
    const encoded = tuple(tuple(packets.at(-1))[1])[1];
    assert.deepEqual(encoded, expected);
    evidence.notificationCases.push({ name: entry.name, notifyType: entry.notifyType, payload: encoded });
  }
  send("OnModuleAttributeChange", event(6123).slice(1));
  assert.equal(packets.length, 3, "unsupported-only notifications do not produce a packet");
  config.clientBuild = 3640684;
  send("OnModuleAttributeChange", event(6123).slice(1));
  assert.equal(packets.length, 4, "modern build retains its existing event");
});

test("both native login request forms include character priming data after valid ship data", t => {
  if (!requireFixture(t)) return;
  const dogma = new DogmaService();
  for (const args of [[true, true, false], [false, true, null]]) {
    const f = fields(wire(dogma.Handle_GetAllInfo(args, fixture.session)));
    const charBundle = tuple(f.get("charInfo"));
    assert.equal(charBundle.length, 2);
    const charItems = map(charBundle[0]);
    assert.ok(charItems.has(fixture.charID));
    const charItem = charItems.get(fixture.charID);
    const inv = characterInventory(charItem);
    assert.equal(inv.locationID, fixture.shipID);
    assert.equal(inv.flagID, 57);
    const charAttributes = scalarMap(charItem);
    for (const id of [164, 165, 166, 167, 168]) assert.equal(typeof charAttributes.get(id), "number");
    const shipInfos = map(f.get("shipInfo"));
    assert.ok(shipInfos.has(fixture.shipID));
    scalarMap(shipInfos.get(fixture.shipID));
    assert.equal(tuple(f.get("shipState")).length, 4);
    if (args[0]) {
      evidence.charInfo = [...charItems.values()].map(project);
      evidence.shipInfo = [...shipInfos.values()].map(project);
      const shipAttrs = scalarMap(shipInfos.get(fixture.shipID));
      evidence.fuel = { load: shipAttrs.get(5635), capacity: shipAttrs.get(5633), rate: shipAttrs.get(5634), efficiency: shipAttrs.get(5607) };
      evidence.activationLength = tuple(f.get("shipState")).length;
      evidence.getAllInfoWireBase64 = marshalEncode(dogma.Handle_GetAllInfo(args, fixture.session)).toString("base64");
    }
  }
});

test("character metadata agrees across Dogma and inventory routes without changing pilot flags", t => {
  if (!requireFixture(t)) return;
  const dogma = new DogmaService();
  const infoDict = map(wire(dogma.Handle_CharGetInfo([], fixture.session)));
  characterInventory(infoDict.get(fixture.charID));
  characterInventory(dogma.Handle_ItemGetInfo([fixture.charID], fixture.session));
  const modified = dogma._buildShipModifiedCharacterAttributeInfo(fixture.charID, getCharacterRecord(fixture.charID), fixture.shipID, fixture.session);
  characterInventory(modified);
  const inventory = inventoryFields(wire(new InvBrokerService().Handle_GetItem([fixture.charID], fixture.session)));
  assert.equal(inventory.itemID, fixture.charID);
  assert.equal(inventory.categoryID, 1);
  assert.equal(inventory.groupID, 1);
  assert.equal(inventory.flagID, 0);
});

test("other profiles retain their existing character metadata in all producers", t => {
  if (!requireFixture(t)) return;
  config.clientBuild = 3640684; config.clientBuildProfile = "frontier-3640684";
  const dogma = new DogmaService();
  const info = fields(wire(dogma.Handle_ItemGetInfo([fixture.charID], fixture.session))).get("invItem");
  assert.equal(info.fields.categoryID, 3);
  assert.equal(inventoryFields(wire(new InvBrokerService().Handle_GetItem([fixture.charID], fixture.session))).categoryID, 3);
});

test("skill constructors, attributes, skill points and queue values are complete on the wire", t => {
  if (!requireFixture(t)) return;
  const skills = new SkillMgrService();
  const f = fields(wire(skills.Handle_GetMySkillInfo([], fixture.session)));
  const records = map(f.get("skills"));
  assert.ok(records.size > 0);
  const args = [];
  for (const [typeID, skill] of records) {
    const ctor = tuple(tuple(skill.header)[1]);
    assert.equal(ctor.length, 4);
    assert.equal(ctor[0], typeID);
    for (const number of ctor) { assert.equal(typeof number, "number"); assert.ok(Number.isFinite(number)); }
    assert.ok(ctor[1] >= 0 && ctor[1] <= 5); assert.ok(ctor[2] >= 0); assert.ok(ctor[3] >= 1);
    args.push(ctor);
  }
  assert.equal(typeof f.get("skillPoints"), "number"); assert.equal(typeof f.get("freeSkillPoints"), "number");
  assert.equal(f.get("queue").type, "list");
  const q = tuple(wire(skills.Handle_GetSkillQueueAndFreePoints([], fixture.session)));
  assert.equal(q.length, 2); assert.equal(q[0].type, "list"); assert.equal(typeof q[1], "number");
  const attributes = map(wire(skills.Handle_GetAttributes([], fixture.session)));
  for (const id of [164, 165, 166, 167, 168]) assert.equal(typeof attributes.get(id), "number");
  Object.assign(evidence, { skills: args, skillPoints: f.get("skillPoints"), freeSkillPoints: f.get("freeSkillPoints"), queue: q });
});

test("booster data reflects empty, active and expired records without fabricated values", t => {
  if (!requireFixture(t)) return;
  const skills = new SkillMgrService();
  const empty = wire(skills.Handle_GetBoosters([], fixture.session));
  assert.deepEqual(empty.entries, []);
  evidence.boosterCases.push({ name: "empty", boosters: [], typeAttributes: {}, passiveEffectsByType: {} });
  const typeID = 42120;
  const info = getBoosterTypeInfo(typeID); assert.ok(info, "native QA accelerator exists");
  const now = BigInt(Date.now()) * 10000n + 116444736000000000n;
  const saved = getCharacterRecord(fixture.charID).boosters;
  try {
    assert.equal(updateCharacterRecord(fixture.charID, current => ({ ...current,
      boosters: [{ boosterTypeID: typeID, boosterID: 9988400999001, startTime: String(now), expiryTime: String(now + 36000000000n) }] })).success, true);
    const active = map(wire(skills.Handle_GetBoosters([], fixture.session)));
    assert.equal(active.size, 1);
    const b = Object.fromEntries(fields(active.get(typeID)));
    assert.equal(b.boosterTypeID, typeID); assert.equal(b.typeID, typeID); assert.ok(BigInt(b.expiryTime) > now);
    evidence.boosterCases.push({ name: "active", boosters: [{ key: typeID, fields: b }],
      typeAttributes: { [typeID]: getTypeDogmaAttributes(typeID) },
      passiveEffectsByType: { [typeID]: getTypeEffectRecords(typeID).filter(e => Number(e.effectCategoryID) === 0).map(e => Number(e.effectID)) } });
    assert.equal(updateCharacterRecord(fixture.charID, current => ({ ...current,
      boosters: [{ boosterTypeID: typeID, boosterID: 9988400999001, expiryTime: String(now - 1n) }] })).success, true);
    assert.deepEqual(wire(skills.Handle_GetBoosters([], fixture.session)).entries, []);
    evidence.boosterCases.push({ name: "expired", boosters: [], typeAttributes: {}, passiveEffectsByType: {} });
  } finally { updateCharacterRecord(fixture.charID, current => ({ ...current, boosters: saved })); }
});

test("fitting fuel values are initialized while authored zero defenses remain zero", t => {
  if (!requireFixture(t)) return;
  const f = fields(wire(new DogmaService().Handle_GetAllInfo([], fixture.session)));
  const attrs = scalarMap(map(f.get("shipInfo")).get(fixture.shipID));
  assert.equal(attrs.get(5635), 73.25); assert.equal(attrs.get(5633), 150); assert.equal(attrs.get(5607), 30);
  const base = getTypeDogmaAttributes(84213);
  for (const id of [263, 265]) { assert.equal(Number(base[id] || 0), 0); assert.equal(attrs.get(id), 0); }
});

test.after(() => {
  if (!dir || !fixture) return;
  const location = path.resolve(dir); fs.mkdirSync(location, { recursive: true });
  fs.writeFileSync(path.join(location, "server-skill-fitting-payload.json"), JSON.stringify(evidence,
    (_key, value) => typeof value === "bigint" ? value.toString() : value, 2) + "\n");
});
