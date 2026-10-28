import assert from "node:assert/strict";
import test from "node:test";

const config = require("../src/config");
const database = require("../src/gameStore");
const runtime = require("../src/space/runtime");
const npcData = require("../src/space/npc/npcData");
const native = require("../src/space/npc/nativeNpcService");
const nativeStore = require("../src/space/npc/nativeNpcStore");
const InvBrokerService = require("../src/services/inventory/invBrokerService");
const { ROLE_GML } = require("../src/services/account/accountRoleProfiles");
const registry = require("../src/space/npc/npcRegistry");
const { getNpcPilotIdentityStore } = require("../src/space/npc/npcPilotIdentityStore");

function fixture(t) {
  const oldProfile = config.clientCompatibilityProfile;
  const oldEnabled = config.npcPilotIdentitiesEnabled;
  config.clientCompatibilityProfile = "frontier";
  config.npcPilotIdentitiesEnabled = true;
  const tables = ["npcPilotIdentities", "npcEntities", "npcModules", "npcCargo", "npcRuntimeControllers"];
  const backups = tables.map(name => [name, structuredClone(database.read(name, "/").data)]);
  const entities = new Map<number, any>();
  const scene = {
    systemID: 30000004,
    getCurrentSimTimeMs: () => 1000,
    getEntityByID: id => entities.get(id) || null,
  };
  t.mock.method(runtime, "spawnDynamicShip", (_systemID, spec) => {
    const entity = { ...spec, kind: "ship" };
    entities.set(spec.itemID, entity);
    return { success: true, data: { entity } };
  });
  t.mock.method(require("../src/services/frontier/iffAbilityHandlers"), "scheduleIffVerdicts", () => false);
  t.after(() => {
    for (const id of entities.keys()) registry.unregisterController(id);
    for (const [name, snapshot] of backups) database.write(name, "/", snapshot, { force: true });
    database.flushTablesSync(tables);
    config.clientCompatibilityProfile = oldProfile;
    config.npcPilotIdentitiesEnabled = oldEnabled;
  });
  const definition = npcData.buildNpcDefinition("frontier_osa_frigate");
  assert.ok(definition);
  const context = { scene, systemID: scene.systemID, anchorEntity: { itemID: 99, position: { x: 0, y: 0, z: 0 } } };
  const options = { transient: true, broadcast: false, skipInitialBehaviorTick: true, npcIdentitySlot: "test:osa:slot:0" };
  return { scene, definition, context, options, pilots: getNpcPilotIdentityStore() };
}

test("native NPC spawn/kill/respawn preserves pilot identity without adopting player runtime semantics", t => {
  const f = fixture(t);
  const first = native.spawnNativeNpcEntityInContext(f.context, f.definition, f.options);
  assert.equal(first.success, true, first.errorMsg);
  const ship = first.data.entity;
  assert.ok(ship.npcCharacterID >= 1500000000 && ship.npcCharacterID <= 1599999999);
  assert.equal(ship.characterID, 0);
  assert.equal(ship.pilotCharacterID, 0);
  assert.equal(ship.nativeNpc, true);
  assert.match(ship.npcSuiWalletAddress, /^0x[0-9a-f]{64}$/);
  assert.equal(ship.npcIdentitySlot, f.options.npcIdentitySlot);
  assert.equal(first.data.controller.npcCharacterID, ship.npcCharacterID);
  f.pilots.update(ship.npcCharacterID, p => ({ ...p, sui: { status: "confirmed", characterObjectId: "0xcafe", playerProfileObjectId: "0xbeef", npcProfileObjectId: "0xfeed" } }));
  const duplicate = native.spawnNativeNpcEntityInContext(f.context, f.definition, f.options);
  assert.equal(duplicate.success, false);
  assert.equal(duplicate.errorMsg, "NPC_PILOT_IDENTITY_FAILED");
  const destroyItem = new InvBrokerService();
  assert.equal(destroyItem.callMethod("DestroyItem", [ship.itemID], {
    accountRole: ROLE_GML,
    characterID: 140000005,
    _space: { systemID: f.scene.systemID },
  }), null);
  assert.equal(registry.getControllerByEntityID(ship.itemID), null);
  assert.equal(nativeStore.getNativeEntity(ship.itemID), null);
  const second = native.spawnNativeNpcEntityInContext(f.context, f.definition, f.options);
  assert.equal(second.success, true, second.errorMsg);
  assert.notEqual(second.data.entity.itemID, ship.itemID);
  assert.equal(second.data.entity.npcCharacterID, ship.npcCharacterID);
  assert.equal(second.data.entity.npcSuiCharacterObjectID, "0xcafe");
  assert.equal(second.data.entity.npcSuiPlayerProfileObjectID, "0xbeef");
  assert.equal(second.data.entity.npcSuiNpcProfileObjectID, "0xfeed");
  assert.equal(second.data.entity.npcIncarnation, 2);
  assert.equal(f.pilots.get(ship.npcCharacterID).deaths, 1);
  assert.equal(database.read("characters", `/${ship.npcCharacterID}`).success, false);
});

test("native group members receive distinct stable pilots sharing the faction wallet", t => {
  const f = fixture(t);
  const options = { ...f.options, materializeRuntime: false, npcIdentitySlot: "test:osa:group:0" };
  const plan = { success: true, data: { definitions: [f.definition, f.definition] } };
  const first = native.spawnNativeDefinitionsInContext(f.context, plan, options);
  assert.equal(first.success, true, first.errorMsg);
  assert.equal(first.data.spawned.length, 2);
  const records = first.data.spawned.map(x => x.entityRecord);
  assert.notEqual(records[0].npcCharacterID, records[1].npcCharacterID);
  assert.equal(records[0].npcSuiWalletAddress, records[1].npcSuiWalletAddress);
  assert.deepEqual(records.map(x => x.npcIdentitySlot), ["test:osa:group:0:member:0", "test:osa:group:0:member:1"]);
  for (const record of records) nativeStore.removeNativeEntityCascade(record.entityID, { destroyed: true });
  const second = native.spawnNativeDefinitionsInContext(f.context, plan, options);
  assert.deepEqual(second.data.spawned.map(x => x.entityRecord.npcCharacterID), records.map(x => x.npcCharacterID));
});

test("legacy native NPCs migrate once and repeated materialization retains their pilots", t => {
  const f = fixture(t);
  config.npcPilotIdentitiesEnabled = false;
  const legacy = native.spawnNativeNpcEntityInContext(f.context, f.definition, { ...f.options, materializeRuntime: false });
  assert.equal(legacy.success, true, legacy.errorMsg);
  assert.equal(legacy.data.entityRecord.npcCharacterID, undefined);
  config.npcPilotIdentitiesEnabled = true;
  const migrated = native.materializeStoredNativeController(f.scene, legacy.data.entityRecord.entityID, { broadcast: false });
  assert.equal(migrated.success, true, migrated.errorMsg);
  const id = migrated.data.entity.npcCharacterID;
  assert.ok(id > 0);
  const again = native.materializeStoredNativeController(f.scene, legacy.data.entityRecord.entityID, { broadcast: false });
  assert.equal(again.success, true, again.errorMsg);
  assert.equal(again.data.entity.npcCharacterID, id);
  assert.equal(f.pilots.get(id).incarnation, 1);
});
