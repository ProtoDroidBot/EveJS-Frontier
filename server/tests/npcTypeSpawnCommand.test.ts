import assert from "node:assert/strict";
import test from "node:test";

const { ROLE_GML } = require("../src/services/account/accountRoleProfiles");
const config = require("../src/config");
const database = require("../src/gameStore");
const itemTypeRegistry = require("../src/services/inventory/itemTypeRegistry");
itemTypeRegistry._setEntriesForTests([
  { typeID: 72_207, groupID: 759, categoryID: 11, name: "Osa Frigate" },
  { typeID: 587, groupID: 25, categoryID: 6, name: "Rifter" },
  { typeID: 671, groupID: 26, categoryID: 6, name: "Erebus" },
  { typeID: 95_276, groupID: 5128, categoryID: 6, name: "Creation" },
  { typeID: 95_735, groupID: 5128, categoryID: 6, name: "Refuge Ship" },
  { typeID: 95_968, groupID: 5128, categoryID: 6, name: "Reiver" },
]);
for (const [catalogPath, exportName] of [
  ["../src/space/npc/capitals/capitalNpcCatalog", "getCapitalNpcGeneratedRows"],
  ["../src/space/npc/trigDrifter/trigDrifterNpcCatalog", "getTrigDrifterGeneratedRows"],
  ["../src/space/npc/empireSecurity/empireSecurityNpcCatalog", "getEmpireSecurityGeneratedRows"],
]) {
  require(catalogPath)[exportName] = () => [];
}
const { executeChatCommand } = require("../src/services/chat/chatCommands");
const { resolveItemByTypeID } = itemTypeRegistry;
const nativeNpcService = require("../src/space/npc/nativeNpcService");
const nativeNpcStore = require("../src/space/npc/nativeNpcStore");
const npcFactionConfig = require("../src/config/npcFactionConfig");
const { getNpcPilotIdentityStore } = require("../src/space/npc/npcPilotIdentityStore");
const npcAnchors = require("../src/space/npc/npcAnchors");
const npcData = require("../src/space/npc/npcData");
const npcService = require("../src/space/npc/npcService");
const npcIndex = require("../src/space/npc");
const npcHardware = require("../src/space/npc/npcHardwareCatalog");
const spaceRuntime = require("../src/space/runtime");

function distance(left, right) {
  return Math.hypot(
    left.x - right.x,
    left.y - right.y,
    left.z - right.z,
  );
}

test("typeID 72207 resolves the Frigate profile while the Surveyor profile remains available", () => {
  const profiles = npcData.listNpcProfiles();
  const itemType = resolveItemByTypeID(72_207);
  assert.equal(itemType.name, "Osa Frigate");
  assert.ok(profiles.some((profile) => profile.profileID === "frontier_osa_surveyor"));

  const profile = npcService._testing.resolveNpcTypeProfile(72_207, profiles, itemType.name);
  assert.equal(profile.profileID, "frontier_osa_frigate");
  assert.equal(profile.shipTypeID, 72_207);

  const renamedProfiles = [
    { profileID: "future_surveyor", entityType: "npc", shipTypeID: 72_207, name: "Osa Surveyor" },
    { profileID: "future_frigate", entityType: "npc", shipTypeID: 72_207, name: "Renamed Frigate" },
  ];
  assert.equal(
    npcService._testing.resolveNpcTypeProfile(72_207, renamedProfiles, "Renamed Frigate").profileID,
    "future_frigate",
  );
  assert.equal(npcService._testing.resolveNpcTypeProfile(72_208, renamedProfiles, "Renamed Frigate"), null);
});

test("typeID batch uses the durable native NPC workflow for every requested hull", (t) => {
  const anchor = { itemID: 9001, kind: "ship", itemName: "Test ship", position: { x: 10, y: 20, z: 30 } };
  const session = { _space: { systemID: 30_000_004, shipID: anchor.itemID } };
  const scene = { getCurrentSimTimeMs: () => 1_000 };
  t.mock.method(spaceRuntime, "getEntity", () => anchor);
  t.mock.method(spaceRuntime, "ensureScene", () => scene);
  let observed = null;
  t.mock.method(nativeNpcService, "spawnNativeDefinitionsInContext", (context, selection, options) => {
    observed = { context, selection, options };
    return { success: true, data: { spawned: [] } };
  });

  const result = npcService.spawnNpcTypeBatchForSession(session, 72_207, 3);
  assert.equal(result.success, true, result.errorMsg);
  assert.equal(observed.context.anchorEntity, anchor);
  assert.equal(observed.selection.data.definitions.length, 3);
  assert.ok(observed.selection.data.definitions.every((definition) => (
    definition.profile.profileID === "frontier_osa_frigate" &&
    definition.profile.shipTypeID === 72_207
  )));
  assert.equal(observed.options.transient, false);
  assert.equal(observed.options.formationStyle, "fibonacci");
  assert.equal(observed.options.preferredTargetID, anchor.itemID);
  assert.equal(observed.options.spawnDistanceMeters, 25_000);
  assert.equal(observed.options.createNpcPilot, false);
});

test("category 6 pilot profiles cover ships without authored NPC profiles", () => {
  for (const typeID of [587, 671, 95_276, 95_735, 95_968]) {
    const definition = npcData.buildNpcDefinition(`npc_pilot_ship_${typeID}`);
    assert.equal(definition.profile.shipTypeID, typeID);
    assert.equal(definition.profile.hardwareFamily, "pilotedShip");
    assert.equal(definition.loadout.modules.length, 0);
    assert.equal(definition.behaviorProfile.autoAggro, false);
    assert.equal(npcHardware.validateNpcHardwareDefinition(definition).success, true);
  }
  assert.equal(npcData.buildNpcDefinition("npc_pilot_ship_72207"), null);
  const osa = npcData.buildNpcDefinition("npc_osa_pilot_ship_587");
  assert.equal(osa.profile.shipTypeID, 587);
  assert.equal(osa.profile.factionID, 500_025);
  assert.equal(osa.profile.corporationID, 1_000_287);
  assert.equal(osa.profile.npcFactionKey, "osa");
  assert.equal(osa.profile.npcFactionMembershipEligible, true);
  assert.equal(npcFactionConfig.resolveNpcFactionCanonicalKey(osa.profile), "0-osa");
  assert.equal(npcData.buildNpcDefinition("npc_osa_pilot_ship_72207"), null);
  assert.equal(npcHardware.validateNpcHardwareDefinition({
    profile: { shipTypeID: 72_207, hardwareFamily: "pilotedShip" },
    loadout: { modules: [], charges: [] },
  }).errorMsg, "NPC_PILOT_SHIP_CATEGORY_REQUIRED");
});

test("the default faction hull policy includes ships and Creation hulls for every faction", () => {
  const expectedTypes = [587, 671, 95_276, 95_735, 95_968];
  for (const faction of [{ npcFactionKey: "osa" }, { factionID: 500_001 }]) {
    const configured = npcFactionConfig.resolveNpcFactionTypeProfiles(faction, []);
    assert.deepEqual(configured.map((entry) => entry.typeID), expectedTypes);
    for (const typeID of expectedTypes) {
      assert.equal(npcFactionConfig.isNpcFactionSdeTypeAllowed(faction, "hull", typeID), true);
    }
  }
  assert.equal(npcFactionConfig.getConfig().defaults.typeMembership.includedCategoryIDs.includes(6), true);
  assert.equal(npcFactionConfig.applyNpcFactionTypeListProfile({
    profileID: "osa-creation", shipTypeID: 95_276, npcFactionKey: "osa",
  }).npcFactionMembershipEligible, true);
});

test("pilot ship spawn requests a pilot and validates the physical category", (t) => {
  const oldProfile = config.clientCompatibilityProfile;
  const oldEnabled = config.npcPilotIdentitiesEnabled;
  config.clientCompatibilityProfile = "frontier";
  config.npcPilotIdentitiesEnabled = true;
  t.after(() => {
    config.clientCompatibilityProfile = oldProfile;
    config.npcPilotIdentitiesEnabled = oldEnabled;
  });
  const anchor = {
    itemID: 9001, kind: "ship", itemName: "Test ship",
    position: { x: 0, y: 0, z: 0 },
    dungeonCurrentSiteID: 5_380_000_009_002,
    dungeonCurrentInstanceID: 41,
  };
  let dungeonInstanceExists = false;
  const scene = {
    getCurrentSimTimeMs: () => 1_000,
    resolveDungeonInstanceVisibilityForSession: () => dungeonInstanceExists ? { instanceID: 41 } : null,
  };
  t.mock.method(spaceRuntime, "getEntity", () => anchor);
  t.mock.method(spaceRuntime, "ensureScene", () => scene);
  let observed = null;
  t.mock.method(nativeNpcService, "spawnNativeDefinitionsInContext", (context, selection, options) => {
    observed = { context, selection, options };
    return { success: true, data: { spawned: [] } };
  });
  const session = { characterID: 140_000_005, _space: { systemID: 30_000_004, shipID: anchor.itemID } };
  assert.equal(npcService.spawnNpcPilotShipBatchForSession(session, 72_207).errorMsg,
    "NPC_PILOT_SHIP_CATEGORY_REQUIRED");
  assert.equal(npcService.spawnNpcPilotShipBatchForSession(session, 587, 2).success, true);
  assert.equal(observed.options.createNpcPilot, true);
  assert.deepEqual(observed.options.trustedFitterCharacterIDs, [140_000_005]);
  assert.deepEqual(observed.options.entityScopeMetadata, {});
  assert.deepEqual(observed.options.behaviorOverrides,
    { passiveRoaming: false, passiveWarping: false });
  assert.equal(observed.selection.data.definitions.length, 2);
  assert.equal(observed.selection.data.definitions[0].profile.shipTypeID, 587);
  assert.equal(observed.options.formationStyle, "fibonacci");
  dungeonInstanceExists = true;
  assert.equal(npcService.spawnOsaPilotShipBatchForSession(session, 671).success, true);
  assert.equal(observed.options.createNpcPilot, true);
  assert.equal(observed.options.factionStringOnlyID, "osa");
  assert.equal(observed.selection.data.definitions[0].profile.profileID, "npc_osa_pilot_ship_671");
  assert.equal(observed.selection.data.definitions[0].profile.npcFactionKey, "osa");
  assert.deepEqual(observed.options.entityScopeMetadata,
    { dungeonSiteID: 5_380_000_009_002, dungeonSiteInstanceID: 41 });
  assert.equal(npcService.spawnOsaPilotShipBatchForSession(session, 72_207).errorMsg,
    "NPC_PILOT_SHIP_CATEGORY_REQUIRED");
  config.npcPilotIdentitiesEnabled = false;
  assert.equal(npcService.spawnNpcPilotShipBatchForSession(session, 587).errorMsg,
    "NPC_PILOT_IDENTITIES_DISABLED");
});

test("native spawn persists the pilot decision for category 6 ships", (t) => {
  const oldProfile = config.clientCompatibilityProfile;
  const oldEnabled = config.npcPilotIdentitiesEnabled;
  config.clientCompatibilityProfile = "frontier";
  config.npcPilotIdentitiesEnabled = true;
  const tables = ["npcPilotIdentities", "npcEntities", "npcModules", "npcCargo", "npcRuntimeControllers"];
  const backups = tables.map((name) => [name, structuredClone(database.read(name, "/").data)]);
  t.after(() => {
    for (const [name, snapshot] of backups) database.write(name, "/", snapshot, { force: true });
    database.flushTablesSync(tables);
    config.clientCompatibilityProfile = oldProfile;
    config.npcPilotIdentitiesEnabled = oldEnabled;
  });
  const scene: any = { systemID: 30_000_004, getCurrentSimTimeMs: () => 1_000 };
  const context = { scene, systemID: scene.systemID,
    anchorEntity: { itemID: 9001, position: { x: 0, y: 0, z: 0 } } };
  const definition = npcData.buildNpcDefinition("npc_pilot_ship_587");
  const unpiloted = nativeNpcService.spawnNativeNpcEntityInContext(context, definition, {
    materializeRuntime: false, createNpcPilot: false, npcIdentitySlot: "test:unpiloted:587",
  });
  assert.equal(unpiloted.success, true, unpiloted.errorMsg);
  assert.equal(unpiloted.data.entityRecord.npcPilotRequested, false);
  assert.equal(unpiloted.data.entityRecord.npcCharacterID, undefined);
  assert.equal(nativeNpcStore.getNativeEntity(unpiloted.data.entityRecord.entityID).npcPilotRequested, false);
  const piloted = nativeNpcService.spawnNativeNpcEntityInContext(context, definition, {
    materializeRuntime: false, createNpcPilot: true, npcIdentitySlot: "test:piloted:587",
  });
  assert.equal(piloted.success, true, piloted.errorMsg);
  assert.equal(piloted.data.entityRecord.npcPilotRequested, true);
  assert.ok(piloted.data.entityRecord.npcCharacterID >= 1_500_000_000);
  const osaDefinition = npcData.buildNpcDefinition("npc_osa_pilot_ship_587");
  const osa = nativeNpcService.spawnNativeNpcEntityInContext(context, osaDefinition, {
    materializeRuntime: false, createNpcPilot: true, npcIdentitySlot: "test:osa:piloted:587",
  });
  assert.equal(osa.success, true, osa.errorMsg);
  assert.equal(osa.data.entityRecord.warFactionID, 500_025);
  assert.equal(osa.data.entityRecord.npcFactionKey, "osa");
  const osaPilot = getNpcPilotIdentityStore().get(osa.data.entityRecord.npcCharacterID);
  assert.equal(osaPilot.factionKey, "500025-osa");
  assert.equal(osaPilot.factionStringOnlyID, "osa");
  assert.equal(npcFactionConfig.resolveNpcTransponderConfiguration(osa.data.entityRecord).signal, "OSA");
  const entities = new Map<number, any>();
  scene.getEntityByID = (id) => entities.get(id) || null;
  t.mock.method(spaceRuntime, "spawnDynamicShip", (_systemID, spec) => {
    const entity = { ...spec, kind: "ship" };
    entities.set(spec.itemID, entity);
    return { success: true, data: { entity } };
  });
  t.mock.method(require("../src/services/frontier/iffAbilityHandlers"),
    "scheduleIffVerdicts", () => false);
  const restored = nativeNpcService.materializeStoredNativeController(
    scene, unpiloted.data.entityRecord.entityID, { broadcast: false },
  );
  assert.equal(restored.success, true, restored.errorMsg);
  assert.equal(restored.data.entity.npcCharacterID, null);
});

test("typeID batch positions remain separated at three and fifty NPCs", () => {
  const anchor = { position: { x: 100, y: 200, z: 300 }, direction: { x: 1, y: 0, z: 0 } };
  for (const count of [3, 50]) {
    const positions = Array.from({ length: count }, (_, index) => npcAnchors.buildSpawnStateForDefinition(
      anchor,
      { profile: { spawnDistanceMeters: 20_000 } },
      {
        batchIndex: index + 1,
        batchTotal: count,
        spawnDistanceMeters: 25_000,
        spreadMeters: 0,
        formationSpacingMeters: 0,
        formationStyle: "fibonacci",
      },
    ).position);
    for (let index = 0; index < positions.length; index += 1) {
      assert.ok(Math.abs(distance(positions[index], anchor.position) - 25_000) < 0.001);
      for (let other = index + 1; other < positions.length; other += 1) {
        assert.ok(distance(positions[index], positions[other]) > 5_000);
      }
    }
  }
});

test("/spawn parses typeID and count, limits access, and rejects invalid quantities", (t) => {
  const session = { accountRole: ROLE_GML, _space: { systemID: 30_000_004, shipID: 9001 } };
  const calls = [];
  t.mock.method(npcIndex, "spawnNpcTypeBatchForSession", (_session, typeID, count) => {
    calls.push({ typeID, count });
    return { success: true, data: { spawned: Array.from({ length: count }, () => ({
      definition: { profile: { name: "Osa Frigate" } },
      fittedModules: [],
      lootEntries: [],
    })) } };
  });

  const spawn = (accountSession, message) => executeChatCommand(
    accountSession, message, null, { emitChatFeedback: false },
  );
  assert.match(spawn(session, "/spawn 72207 3").message, /Spawned 3 hulls.*3x Osa Frigate/u);
  assert.match(spawn(session, "/spawn 72207").message, /Spawned 1 hull/u);
  assert.deepEqual(calls, [{ typeID: 72_207, count: 3 }, { typeID: 72_207, count: 1 }]);
  assert.match(spawn({ ...session, accountRole: 0n }, "/spawn 72207 3").message, /requires a GM account/u);
  assert.match(spawn(session, "/spawn 72207 0").message, /count from 1 to 50/u);
  assert.match(spawn(session, "/spawn 72207 51").message, /count from 1 to 50/u);
  assert.match(spawn(session, "/spawn invalid 3").message, /Usage: \/spawn/u);
  assert.equal(calls.length, 2);
});

test("/spawnpilot routes only GM category 6 requests to the pilot path", (t) => {
  const session = { accountRole: ROLE_GML, _space: { systemID: 30_000_004, shipID: 9001 } };
  const calls = [];
  t.mock.method(npcIndex, "spawnNpcPilotShipBatchForSession", (_session, typeID, count) => {
    calls.push({ typeID, count });
    return { success: true, data: { spawned: Array.from({ length: count }, () => ({
      definition: { profile: { name: "Rifter" } }, fittedModules: [], lootEntries: [],
    })) } };
  });
  const spawn = (accountSession, message) => executeChatCommand(
    accountSession, message, null, { emitChatFeedback: false },
  );
  assert.match(spawn(session, "/spawnpilot 587 2").message, /Spawned 2 hulls.*2x Rifter/u);
  assert.deepEqual(calls, [{ typeID: 587, count: 2 }]);
  assert.match(spawn({ ...session, accountRole: 0n }, "/spawnpilot 587").message, /requires a GM account/u);
  assert.match(spawn(session, "/spawnpilot 587 51").message, /count from 1 to 50/u);
  assert.equal(calls.length, 1);
});

test("/spawnosapilot routes to the Osa pilot path", (t) => {
  const session = { accountRole: ROLE_GML, _space: { systemID: 30_000_004, shipID: 9001 } };
  const calls = [];
  t.mock.method(npcIndex, "spawnOsaPilotShipBatchForSession", (_session, typeID, count) => {
    calls.push({ typeID, count });
    return { success: true, data: { spawned: Array.from({ length: count }, () => ({
      definition: { profile: { name: "Osa Rifter" } }, fittedModules: [], lootEntries: [],
    })) } };
  });
  const spawn = (accountSession, message) => executeChatCommand(
    accountSession, message, null, { emitChatFeedback: false },
  );
  assert.match(spawn(session, "/spawnosapilot 587 2").message, /Spawned 2 hulls.*2x Osa Rifter/u);
  assert.deepEqual(calls, [{ typeID: 587, count: 2 }]);
  assert.match(spawn({ ...session, accountRole: 0n }, "/spawnosapilot 587").message, /requires a GM account/u);
  assert.match(spawn(session, "/spawnosapilot 587 51").message, /count from 1 to 50/u);
  assert.match(spawn(session, "/spawnosapilot wrong").message, /Usage: \/spawnosapilot/u);
  assert.equal(calls.length, 1);
});
