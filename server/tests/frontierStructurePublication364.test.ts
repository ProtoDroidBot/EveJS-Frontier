"use strict";
const assert = require("node:assert/strict");
const test = require("node:test");
const publication = require("../src/services/frontier/structurePublicationRuntime");
const IffMapService = require("../src/services/frontier/iffMapService");
const CairnService = require("../src/services/frontier/cairnService");
function fixture() {
  const session: any = { characterID: 140000001, shipid: 9001, solarsystemid2: 30000004 };
  const item: any = { itemID: 9002, typeID: 88092, ownerID: 140000001, locationID: 30000004, flagID: 0, itemName: "Relay", customInfo: "{}", spaceState: { position: { x: 1, y: 2, z: 3 } } };
  const state: any = { assemblyStatus: 2, solarSystemID: 30000004 };
  const entity: any = { ...item, kind: "structure", systemID: 30000004, position: item.spaceState.position };
  const ship = { itemID: 9001, kind: "ship", ownerID: session.characterID, systemID: 30000004 };
  const deployment = { readConstructionState: () => state, ASSEMBLY_STATUS_UNDER_CONSTRUCTION: 5, isAssemblyActivationPending: () => false,
    listAssemblyDefinitions: () => [{ assemblyTypeID: 90003, smartGate: {} }] };
  let failWrite = false; const notifications = [];
  const inventory = { findItemById: id => id === 9002 ? item : null, getAllItems: () => ({ 9002: item }),
    updateInventoryItem: (_id, update) => { if (failWrite) return { success: false, errorMsg: "WRITE_ERROR" }; Object.assign(item, update(item)); return { success: true }; } };
  const runtime = publication.createStructurePublicationRuntime({ itemStore: inventory, deployment,
    spaceRuntime: { getEntity: (_s, id) => id === 9001 ? ship : id === 9002 ? entity : null }, notify: (...args) => notifications.push(args) });
  return { session, item, state, entity, deployment, runtime, notifications, failWrite: v => { failWrite = v; } };
}
test("structure transponder type predicate includes nodes/slingshots/authored smart gates", () => {
  const f = fixture();
  for (const id of [88400, 93141, 88092, 95627, 95677, 90003]) assert.equal(publication.isTransponderStructureType(id, f), true);
  assert.equal(publication.isTransponderStructureType(34, f), false);
});
test("location publication is owner-authorized, public in current system and revocable", () => {
  const f = fixture();
  assert.equal(f.runtime.publishLocation({ ...f.session, characterID: 140000002 }, 9002).errorMsg, "ASSEMBLY_ACCESS_DENIED");
  assert.equal(f.runtime.publishLocation(f.session, 9002).success, true);
  const visitor = { ...f.session, characterID: 140000002 };
  assert.equal(f.runtime.listPublished(visitor)[0].is_mine, false);
  assert.deepEqual(f.runtime.listPublished({ ...visitor, solarsystemid2: 30000005 }), []);
  assert.equal(f.runtime.publishLocation(f.session, 9002, false).success, true);
  assert.deepEqual(f.runtime.listPublished(visitor), []);
  assert.equal(f.notifications.length, 2);
});
test("publication revokes automatically for ownership, location, deployment and position changes", () => {
  for (const mutate of [f => { f.item.ownerID++; }, f => { f.item.locationID++; }, f => { f.item.flagID = 5; },
    f => { f.state.assemblyStatus = 5; }, f => { f.item.spaceState.position.x++; }]) {
    const f = fixture(); assert.equal(f.runtime.publishLocation(f.session, 9002).success, true);
    mutate(f); assert.equal(publication.isPublished(f.item, f), false);
  }
});
test("failed publication persistence neither changes metadata nor emits visibility notices", () => {
  const f = fixture(); f.failWrite(true);
  assert.equal(f.runtime.publishLocation(f.session, 9002).success, false);
  assert.equal(f.item.customInfo, "{}"); assert.equal(f.notifications.length, 0);
});
test("native structure transponder setter handles real assembly types and denies invalid state", () => {
  const f = fixture(); const writes = [];
  const svc = new IffMapService({ clientBuild: 3640684, findItemById: () => f.item, deployment: f.deployment,
    isTransponderStructureType: id => publication.isTransponderStructureType(id, f),
    writeTransponderState: (...args) => { writes.push(args); return { success: true }; }, notifyIffStateChanged: () => {} });
  assert.equal(svc.Handle_set_structure_transponder([9002, "code", "secret"], f.session), null);
  assert.equal(writes[0][1].code, "secret");
  f.state.assemblyStatus = 5;
  assert.throws(() => svc.Handle_set_structure_transponder([9002, "tribe", null], f.session));
  assert.equal(writes.length, 1);
});
test("public structure discovery does not disclose its private transponder code", () => {
  const f = fixture(); f.runtime.publishLocation(f.session, 9002);
  const rows = CairnService._testing.listVisibleCairns({ ...f.session, characterID: 140000002 }, {
    getSceneForSession: () => ({ dynamicEntities: new Map([[9002, f.entity]]) }), findItemById: () => f.item,
    readTransponderState: () => ({ channel: "code", code: "secret" }), getCharacterCorporationID: () => 123,
    resolveActiveTransponder: () => ({ channel: "code", code: "different" }),
    isSupportedType: () => true, isPublished: item => publication.isPublished(item, f) });
  assert.equal(rows.length, 1); assert.equal(rows[0].transponderCode, null); assert.equal(rows[0].transponderChannel, null);
});
