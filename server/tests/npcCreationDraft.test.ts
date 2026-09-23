import assert = require("node:assert/strict");
import fs = require("node:fs");
import path = require("node:path");
import test = require("node:test");

const database = require("../src/gameStore");
const nativeStore = require("../src/space/npc/nativeNpcStore");
const itemStore = require("../src/services/inventory/itemStore");
const itemTypeRegistry = require("../src/services/inventory/itemTypeRegistry");
const draft = require("../src/services/npc/npcCreationDraft");
const staticData = require("../src/services/frontier/creationStaticData");
const { validateCreationLayout } = require("../src/services/frontier/creationLayoutValidation");
const { unwrapMarshalValue } = require("../src/services/_shared/serviceHelpers");
const NpcFittingMgrService = require("../src/services/npc/npcFittingMgrService");

const STATIC_ROOT = path.resolve(__dirname, "../../_local/frontier-runtime/3502403/gameStore/data");
const STATIC_TABLES = [
  "creationHardpointTypes", "creationModules", "creationParts", "creationTemplates",
];

test("NPC Creation snapshots and drafts stay on the piloted target and validate its layout", (t) => {
  if (!STATIC_TABLES.every((table) => fs.existsSync(path.join(STATIC_ROOT, table, "data.json")))) {
    t.skip("build 3502403 Creation static data is unavailable");
    return;
  }
  if (!STATIC_TABLES.every((table) => database.read(table, "/").success === true)) {
    t.skip("the isolated game store has no Creation static tables");
    return;
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
