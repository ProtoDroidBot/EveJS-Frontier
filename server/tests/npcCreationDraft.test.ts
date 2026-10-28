import assert = require("node:assert/strict");
import fs = require("node:fs");
import path = require("node:path");
import test = require("node:test");

const database = require("../src/gameStore");
const nativeStore = require("../src/space/npc/nativeNpcStore");
const itemStore = require("../src/services/inventory/itemStore");
const itemTypeRegistry = require("../src/services/inventory/itemTypeRegistry");
const config = require("../src/config");
const draft = require("../src/services/npc/npcCreationDraft");
const nativeNpcService = require("../src/space/npc/nativeNpcService");
const npcData = require("../src/space/npc/npcData");
const spaceRuntime = require("../src/space/runtime");
const staticData = require("../src/services/frontier/creationStaticData");
const creationRuntime = require("../src/services/frontier/creationRuntime");
const { validateCreationLayout } = require("../src/services/frontier/creationLayoutValidation");
const { unwrapMarshalValue } = require("../src/services/_shared/serviceHelpers");
const NpcFittingMgrService = require("../src/services/npc/npcFittingMgrService");
const { openNpcHeadlessFittingWindow } = require(
  "../src/space/npc/npcHeadlessFittingWindow",
);

const STATIC_ROOT = path.resolve(__dirname, "../../_local/frontier-runtime/3502403/gameStore/data");
const STATIC_TABLES = [
  "creationHardpointTypes", "creationModules", "creationParts", "creationTemplates",
];

function loadCreationStaticData(t) {
  if (!STATIC_TABLES.every((table) => fs.existsSync(path.join(STATIC_ROOT, table, "data.json")))) {
    t.skip("build 3502403 Creation static data is unavailable");
    return false;
  }
  if (!STATIC_TABLES.every((table) => database.read(table, "/").success === true)) {
    t.skip("the isolated game store has no Creation static tables");
    return false;
  }
  const previous = Object.fromEntries(STATIC_TABLES.map((table) => [
    table, structuredClone(database.read(table, "/").data),
  ]));
  for (const table of STATIC_TABLES) {
    const source = JSON.parse(fs.readFileSync(path.join(STATIC_ROOT, table, "data.json"), "utf8"));
    assert.equal(database.write(table, "/", source, { force: true }).success, true);
  }
  staticData.resetCreationStaticDataForTests();
  t.after(() => {
    for (const [table, value] of Object.entries(previous)) {
      database.write(table, "/", value, { force: true });
    }
    staticData.resetCreationStaticDataForTests();
  });
  return true;
}

test("NPC Creation snapshots and drafts stay on the piloted target and validate its layout", (t) => {
  if (!loadCreationStaticData(t)) return;

  const typeID = 95276;
  const entityID = 980000123456;
  const characterID = 1500004201;
  const entity = {
    entityID, typeID, categoryID: 6, ownerID: 500010,
    npcCharacterID: characterID, systemID: 30000004, transient: true,
  };
  assert.equal(nativeStore.upsertNativeEntity(entity).success, true);
  const seeded = draft.ensureNpcCreationState(entity, { typeID });
  assert.equal(seeded.success, true, JSON.stringify(seeded));
  assert.ok(seeded.data.state.modules.length > 0);
  assert.deepEqual(validateCreationLayout(seeded.data.state,
    staticData.getCreationTemplate(typeID)).filter((entry) => entry.severity === "blocker"), []);
  const second = draft.ensureNpcCreationState(entity, { typeID });
  assert.equal(second.data.state.modules.length, seeded.data.state.modules.length);

  const context = { entityRecord: entity, fittingHull: { typeID },
    actor: { characterID: 140004201 }, interaction: { shipID: 910004201 } };
  assert.equal(draft.stageNpcCreationDraft(context, [{ op: "remove",
    itemID: seeded.data.state.modules[0].itemID }]).diagnostics[0].code, "item_unavailable");
  assert.equal(draft.stageNpcCreationDraft(context, [{ op: "add",
    itemID: 200, typeID: 95302, partID: 1 }], {
    itemStore: { ITEM_FLAGS: { CARGO_HOLD: 5 }, findItemById: () => ({
      itemID: 200, typeID: 95302, ownerID: 140004201, locationID: 123,
      flagID: 5, categoryID: 7,
    }) },
  }).diagnostics[0].code, "item_unavailable");

  const fitting = require("../src/space/npc/npcFittingService");
  const service = new NpcFittingMgrService({
    npcFitting: { ...fitting, resolveNpcFittingEntity: () => ({ success: true,
      data: { entityRecord: entity, fittingHull: { itemID: entityID, typeID } } }) },
    trust: { evaluateNpcFittingTrust: () => ({ trusted: true, reason: "test" }) },
    authorizeInteraction: () => ({ success: true, data: { shipID: 910004201 } }),
    npcPilots: { get: () => ({ characterID, activeEntityID: entityID }) },
    itemStore: { ITEM_FLAGS: { CARGO_HOLD: 5 }, listOwnedItems: () => [] },
  });
  const session = { characterID: 140004201,
    _space: { shipID: 910004201, systemID: 30000004 } };
  const snapshot = unwrapMarshalValue(
    service.Handle_GetNpcCreationSnapshot([entityID], session));
  assert.equal(snapshot.item_id, entityID);
  assert.equal(Object.keys(snapshot.modules).length, seeded.data.state.modules.length);
  assert.deepEqual(unwrapMarshalValue(
    service.Handle_CommitNpcCreationDraft([entityID, []], session)), []);

  const previousItems = structuredClone(itemStore.getAllItems());
  itemTypeRegistry._setEntriesForTests([{
    typeID: 95317, categoryID: 7, groupID: 53, groupName: "Weapon",
    name: "Cutting Laser", portionSize: 1, volume: 1,
  }, {
    typeID: 95778, categoryID: 7, groupID: 53, groupName: "Weapon",
    name: "Needle", portionSize: 1, volume: 1,
  }]);
  t.after(() => {
    itemStore._writeItemsForTest(previousItems, { force: true });
    itemTypeRegistry._setEntriesForTests(null);
    itemStore.resetInventoryStoreForTests();
  });
  const additionID = 910004202;
  const source = {
    itemID: additionID, typeID: 95317, ownerID: 140004201,
    locationID: 910004201, flagID: itemStore.ITEM_FLAGS.CARGO_HOLD,
    quantity: -1, stacksize: 1, singleton: 1, groupID: 53, categoryID: 7,
    customInfo: "", itemName: "Cutting Laser", mass: 0, volume: 1,
    capacity: 0, radius: 0,
  };
  const replacementID = additionID + 1;
  const replacement = { ...source, itemID: replacementID,
    typeID: 95778, itemName: "Needle" };
  assert.equal(itemStore._writeItemsForTest({
    [additionID]: source, [replacementID]: replacement,
  }, { force: true }), true);
  const emptyHardpoint = seeded.data.state.hardpoints.find((entry) => !entry.attachedItemID);
  assert.ok(emptyHardpoint);
  const change = { op: "attach", typeID: 95317, attachedItemID: additionID,
    interiorItemID: emptyHardpoint.interiorItemID,
    hardpointIndex: emptyHardpoint.hardpointIndex,
    sourceLocationID: 910004201, sourceFlagID: itemStore.ITEM_FLAGS.CARGO_HOLD };
  const fittingContext = { ...context, actor: { characterID: 140004201,
    factionID: 500010 } };
  const attached = draft.commitNpcCreationDraft(fittingContext, [change]);
  assert.equal(attached.success, true, JSON.stringify(attached));
  assert.equal(itemStore.findItemById(additionID).locationID, entityID);
  assert.equal(itemStore.findItemById(additionID).flagID, 183);
  assert.equal(nativeStore.getNativeModule(additionID).entityID, entityID);
  assert.ok(draft.ensureNpcCreationState(entity, { typeID }).data.state.modules
    .some((module) => module.itemID === additionID));
  const replacementChanges = [{
    op: "detach", attachedItemID: additionID,
    destLocationID: 910004201, destFlagID: itemStore.ITEM_FLAGS.CARGO_HOLD,
  }, {
    ...change, typeID: 95778, attachedItemID: replacementID,
  }];
  const denied = draft.commitNpcCreationDraft(fittingContext, replacementChanges, {
    npcFitting: { ...fitting, fitItemToNpc: (input) =>
      input.itemID === replacementID
        ? { success: false, errorMsg: "TEST_REPLACEMENT_DENIED" }
        : fitting.fitItemToNpc(input) },
  });
  assert.equal(denied.success, false);
  assert.equal(itemStore.findItemById(additionID).locationID, entityID);
  assert.equal(itemStore.findItemById(replacementID).locationID, 910004201);
  assert.equal(nativeStore.getNativeModule(additionID).entityID, entityID);
  const replaced = draft.commitNpcCreationDraft(fittingContext, replacementChanges);
  assert.equal(replaced.success, true, JSON.stringify(replaced));
  assert.equal(itemStore.findItemById(additionID).locationID, 910004201);
  assert.equal(itemStore.findItemById(replacementID).locationID, entityID);
  assert.equal(nativeStore.getNativeModule(additionID), null);
  const detached = draft.commitNpcCreationDraft(fittingContext, [{
    op: "detach", attachedItemID: replacementID,
    destLocationID: 910004201, destFlagID: itemStore.ITEM_FLAGS.CARGO_HOLD,
  }]);
  assert.equal(detached.success, true, JSON.stringify(detached));
  assert.equal(itemStore.findItemById(replacementID).locationID, 910004201);
  assert.equal(nativeStore.getNativeModule(replacementID), null);
  assert.equal(draft.ensureNpcCreationState(entity, { typeID }).data.state.modules
    .some((module) => module.itemID === additionID), false);
});

test("headless NPC peer can commit a Creation module draft from NPC cargo", (t) => {
  if (!loadCreationStaticData(t)) return;
  const tables = ["npcEntities", "npcModules", "npcPilotIdentities", "npcRuntimeState"];
  const backups = Object.fromEntries(tables.map((name) => [
    name, structuredClone(database.read(name, "/").data),
  ]));
  const previousItems = structuredClone(itemStore.getAllItems());
  t.after(() => {
    itemStore._writeItemsForTest(previousItems, { force: true });
    for (const [name, data] of Object.entries(backups)) {
      database.write(name, "/", data, { force: true });
    }
    database.flushTablesSync([...tables, itemStore.ITEMS_TABLE]);
    itemTypeRegistry._setEntriesForTests(null);
    itemStore.resetInventoryStoreForTests();
  });
  const targetEntityID = 980000123556;
  const actorEntityID = 980000123557;
  const targetPilotID = 1500004251;
  const actorPilotID = 1500004252;
  const target = { entityID: targetEntityID, typeID: 95276,
    categoryID: 6, ownerID: 500010, npcFactionID: 500010,
    npcCharacterID: targetPilotID, npcIncarnation: 1,
    systemID: 30000004, transient: true };
  const actorShip = { ...target, entityID: actorEntityID,
    npcCharacterID: actorPilotID };
  assert.equal(nativeStore.upsertNativeEntity(target).success, true);
  assert.equal(nativeStore.upsertNativeEntity(actorShip).success, true);
  for (const [characterID, activeEntityID] of [
    [targetPilotID, targetEntityID], [actorPilotID, actorEntityID],
  ]) {
    assert.equal(database.write("npcPilotIdentities", `/pilots/${characterID}`, {
      characterID, activeEntityID, incarnation: 1,
      factionID: 500010, factionKey: "500010-test",
    }).success, true);
  }
  const seed = draft.ensureNpcCreationState(target, { typeID: 95276 });
  assert.equal(seed.success, true, JSON.stringify(seed));
  const hardpoint = seed.data.state.hardpoints.find((entry) => !entry.attachedItemID);
  assert.ok(hardpoint);
  itemTypeRegistry._setEntriesForTests([{ typeID: 95317, categoryID: 7,
    groupID: 53, groupName: "Weapon", name: "Cutting Laser",
    portionSize: 1, volume: 1 }]);
  const moduleID = 910004252;
  const source = { itemID: moduleID, typeID: 95317,
    ownerID: targetPilotID, locationID: actorEntityID,
    flagID: itemStore.ITEM_FLAGS.CARGO_HOLD,
    quantity: -1, stacksize: 1, singleton: 1,
    groupID: 53, categoryID: 7, customInfo: "", itemName: "Cutting Laser",
    mass: 0, volume: 1, capacity: 0, radius: 0 };
  assert.equal(itemStore._writeItemsForTest({ [moduleID]: source }, { force: true }), true);
  const opened = openNpcHeadlessFittingWindow({ actorEntityID,
    targetEntityID }, {
    getLiveEntity: (record) => ({ itemID: record.entityID,
      position: { x: record.entityID === actorEntityID ? 1000 : 0,
        y: 0, z: 0 } }),
    canEntitiesInteractLocally: () => true,
    trust: { evaluateNpcFittingTrust: () => ({
      trusted: true, reason: "same-faction",
    }) },
  });
  assert.equal(opened.success, true, JSON.stringify(opened));
  const window = opened.data;
  assert.equal(window.refresh().data.fittingPath, "creation");
  assert.equal(window.getCreationDraft().success, true);
  const attached = window.commitCreationDraft([{ op: "attach", typeID: 95317,
    attachedItemID: moduleID, interiorItemID: hardpoint.interiorItemID,
    hardpointIndex: hardpoint.hardpointIndex,
    sourceLocationID: actorEntityID,
    sourceFlagID: itemStore.ITEM_FLAGS.CARGO_HOLD }]);
  assert.equal(attached.success, true, JSON.stringify(attached));
  assert.equal(nativeStore.getNativeModule(moduleID).entityID, targetEntityID);
  const detached = window.commitCreationDraft([{ op: "detach",
    attachedItemID: moduleID, destLocationID: actorEntityID,
    destFlagID: itemStore.ITEM_FLAGS.CARGO_HOLD }]);
  assert.equal(detached.success, true, JSON.stringify(detached));
  assert.equal(itemStore.findItemById(moduleID).locationID, actorEntityID);
  window.close();
});

test("spawned modular NPC ships use the player Creation seed plan before materialization", (t) => {
  if (!loadCreationStaticData(t)) return;
  const oldProfile = config.clientCompatibilityProfile;
  const oldEnabled = config.npcPilotIdentitiesEnabled;
  config.clientCompatibilityProfile = "frontier";
  config.npcPilotIdentitiesEnabled = true;
  const tables = ["npcPilotIdentities", "npcEntities", "npcModules", "npcCargo", "npcRuntimeControllers"];
  const backups = tables.map((name) => [name, structuredClone(database.read(name, "/").data)]);
  itemTypeRegistry._setEntriesForTests([
    { typeID: 95276, groupID: 5128, categoryID: 6, name: "Creation" },
    { typeID: 95735, groupID: 5128, categoryID: 6, name: "Refuge Ship" },
    { typeID: 95968, groupID: 5128, categoryID: 6, name: "Reiver" },
  ]);
  t.after(() => {
    for (const [name, snapshot] of backups) database.write(name, "/", snapshot, { force: true });
    database.flushTablesSync(tables);
    config.clientCompatibilityProfile = oldProfile;
    config.npcPilotIdentitiesEnabled = oldEnabled;
    itemTypeRegistry._setEntriesForTests(null);
  });
  const entities = new Map<number, any>();
  const scene: any = { systemID: 30_000_004, getCurrentSimTimeMs: () => 1_000,
    getEntityByID: (id) => entities.get(id) || null };
  t.mock.method(spaceRuntime, "spawnDynamicShip", (_systemID, spec) => {
    const entity = { ...spec, kind: "ship" };
    entities.set(spec.itemID, entity);
    return { success: true, data: { entity } };
  });
  t.mock.method(require("../src/services/frontier/iffAbilityHandlers"),
    "scheduleIffVerdicts", () => false);
  const context = { scene, systemID: scene.systemID,
    anchorEntity: { itemID: 9001, position: { x: 0, y: 0, z: 0 } } };

  for (const typeID of [95276, 95735, 95968]) {
    const result = nativeNpcService.spawnNativeNpcEntityInContext(
      context, npcData.buildNpcDefinition(`npc_pilot_ship_${typeID}`), {
        createNpcPilot: true, npcIdentitySlot: `test:creation:${typeID}`,
        skipInitialBehaviorTick: true, broadcast: false,
      },
    );
    assert.equal(result.success, true, `${typeID}: ${result.errorMsg}`);
    const { entityRecord, entity, fittedModules } = result.data;
    const template = staticData.getCreationTemplate(typeID);
    const plan = creationRuntime.buildCreationSeedPlan(template);
    const state = entityRecord.npcCreationState;
    assert.ok(state, `Creation state missing for spawned type ${typeID}`);
    assert.ok(entityRecord.npcCharacterID >= 1_500_000_000);
    assert.equal(state.templateTypeID, typeID);
    assert.equal(fittedModules.length, plan.length);
    assert.deepEqual(fittedModules.map((record) => record.typeID).sort(),
      plan.map((entry) => entry.typeID).sort());
    assert.ok(fittedModules.every((record) => record.flagID ===
      creationRuntime.CREATION_FITTING_FLAG_ID));
    assert.deepEqual(state, creationRuntime.buildSeededCreationState(
      template, entityRecord.entityID, plan,
      state.modules.map((module) => ({ itemID: module.itemID, typeID: module.typeID })),
    ));
    assert.deepEqual(validateCreationLayout(state, template)
      .filter((entry) => entry.severity === "blocker"), []);
    assert.deepEqual(nativeStore.getNativeEntity(entityRecord.entityID).npcCreationState, state);
    assert.equal(nativeStore.listNativeModulesForEntity(entityRecord.entityID).length, plan.length);
    assert.equal(entity.npcCreationState.templateTypeID, typeID);
    assert.equal(entity.fittedItems.length, plan.length);
    assert.equal(draft.ensureNpcCreationState(entityRecord, { typeID }).data.state.modules.length,
      plan.length);
  }
});
