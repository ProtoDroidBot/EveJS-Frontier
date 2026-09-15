const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const {
  CONSERVATOR_ITEM_INTEREST_TYPE_LIST_ID,
  FERAL_TRACE_TYPE_ID,
  METAMORPHOSIS_TARGET_TYPE_LIST_ID,
  NPC_LOOTABLE_TARGET_TYPE_LIST_ID,
  syncNpcScanning,
} = require(path.join(__dirname, "../src/space/npc/npcScanning"));

function buildInventoryScanHarness(options: Record<string, any> = {}) {
  const source = {
    itemID: 10,
    typeID: 92102,
    ownerID: 77,
    kind: "ship",
    nativeNpc: true,
    bubbleID: 1,
    position: { x: 0, y: 0, z: 0 },
    radius: 60,
  };
  const target: Record<string, any> = {
    itemID: 20,
    typeID: 87566,
    groupID: 12,
    categoryID: 2,
    ownerID: 88,
    kind: "container",
    bubbleID: 1,
    position: { x: 1_000, y: 0, z: 0 },
    radius: 100,
  };
  let targetItems = options.targetItems || [
    { itemID: 101, typeID: 100, groupID: 14, categoryID: 4, itemName: "A", quantity: 4, flagID: 5 },
    { itemID: 102, typeID: 100, groupID: 14, categoryID: 4, itemName: "A", quantity: 2, flagID: 5 },
    { itemID: 103, typeID: 101, groupID: 886, categoryID: 4, itemName: "B", quantity: 1, flagID: 5 },
    { itemID: 104, typeID: 102, groupID: 18, categoryID: 4, itemName: "Ignored", quantity: 9, flagID: 5 },
  ];
  const cargoRecords: any[] = [];
  const traceGrants: any[] = [];
  const effects: any[] = [];
  let nextCargoID = 1_000;

  const nativeNpcStore = {
    allocateCargoID() {
      nextCargoID += 1;
      return { success: true, data: nextCargoID };
    },
    upsertNativeCargo(record) {
      const index = cargoRecords.findIndex((entry) => entry.cargoID === record.cargoID);
      if (index >= 0) {
        cargoRecords[index] = { ...record };
      } else {
        cargoRecords.push({ ...record });
      }
      return { success: true, data: record };
    },
    removeNativeCargo(cargoID) {
      const index = cargoRecords.findIndex((entry) => entry.cargoID === cargoID);
      if (index >= 0) {
        cargoRecords.splice(index, 1);
      }
      return { success: true };
    },
    listNativeCargoForEntity(entityID) {
      return cargoRecords.filter((entry) => entry.entityID === entityID);
    },
    buildNativeCargoItems(entityID) {
      return cargoRecords.filter((entry) => entry.entityID === entityID);
    },
  };
  const dependencies: Record<string, any> = {
    getTypeEffectRecords() {
      return [{
        effectID: 12842,
        name: "behaviorInventoryScan",
        guid: "effects.FrontierScanningTest",
        durationAttributeID: 79,
        rangeAttributeID: 76,
      }];
    },
    getTypeAttributeMap() {
      return { 76: 20_000, 79: 3_000 };
    },
    getTypeAttributeValue(_typeID, name) {
      return {
        timeBetweenScans: 11,
        dataGeneratedFromScan: 72244,
        dataStorageLimitBehavior: 162,
        thiefNoteType: FERAL_TRACE_TYPE_ID,
        thiefNoteQuantity: 1,
      }[name] ?? null;
    },
    matchesTypeList(item, listID) {
      if (listID === NPC_LOOTABLE_TARGET_TYPE_LIST_ID) {
        return item.itemID === target.itemID;
      }
      if (listID === CONSERVATOR_ITEM_INTEREST_TYPE_LIST_ID) {
        return item.typeID === 100 || item.typeID === 101;
      }
      return false;
    },
    canEntitiesInteractLocally() {
      return true;
    },
    listContainerItems(_ownerID, locationID) {
      return locationID === target.itemID ? targetItems.map((item) => ({ ...item })) : [];
    },
    removeInventoryItem(itemID) {
      const index = targetItems.findIndex((item) => item.itemID === itemID);
      if (index < 0) {
        return { success: false, errorMsg: "ITEM_NOT_FOUND" };
      }
      targetItems.splice(index, 1);
      return { success: true };
    },
    grantItemToOwnerLocation(ownerID, locationID, flagID, itemType, quantity) {
      traceGrants.push({ ownerID, locationID, flagID, itemType, quantity });
      targetItems.push({
        itemID: 900 + traceGrants.length,
        typeID: itemType.typeID,
        groupID: itemType.groupID,
        categoryID: itemType.categoryID,
        quantity,
        flagID,
      });
      return { success: true };
    },
    resolveItemByTypeID(typeID) {
      if (typeID === FERAL_TRACE_TYPE_ID) {
        return { typeID, name: "Feral Trace", groupID: 314, categoryID: 4, volume: 0.01 };
      }
      if (typeID === 72244) {
        return { typeID, name: "Feral Data", groupID: 4142, categoryID: 4 };
      }
      return null;
    },
    nativeNpcStore,
    buildOnSpecialFXPayload(_sourceID, _guid, fxOptions) {
      return ["OnSpecialFX", fxOptions];
    },
    applyNpcFeralization(..._args) {
      throw new Error("inventory scans must not apply metamorphosis feralization");
    },
  };
  const scene = {
    getDynamicEntitiesInBubble() {
      return [source, target];
    },
    getEntityByID(itemID) {
      return itemID === source.itemID ? source : itemID === target.itemID ? target : null;
    },
    getNextDestinyStamp(nowMs) {
      return nowMs;
    },
    broadcastDestinyUpdatesToBubble(_bubbleID, updates) {
      effects.push(...updates);
    },
    sendSlimItemChangesToAllSessions() {},
    addTarget() {
      throw new Error("standalone NPC scans must not create target locks");
    },
  };

  return {
    cargoRecords,
    dependencies,
    effects,
    getTargetItems: () => targetItems,
    scene,
    source,
    target,
    traceGrants,
  };
}

test("inventory scanners beam without a lock and leave one Feral Trace per unique type", () => {
  const harness = buildInventoryScanHarness();
  const controller: Record<string, any> = {};

  const started = syncNpcScanning(
    harness.scene,
    harness.source,
    controller,
    {},
    1_000,
    { dependencies: harness.dependencies },
  );
  assert.equal(started.started, true);
  assert.equal(started.targetID, harness.target.itemID);
  assert.equal(harness.getTargetItems().length, 4);
  assert.equal(harness.effects[0].payload[1].start, true);

  const completed = syncNpcScanning(
    harness.scene,
    harness.source,
    controller,
    {},
    4_000,
    { dependencies: harness.dependencies },
  );
  assert.equal(completed.completed, true);
  assert.deepEqual(completed.result.stolenTypeIDs, [100, 101]);
  assert.equal(completed.result.stolenItemCount, 3);
  assert.equal(completed.result.stolenTypeCount, 2);
  assert.equal(harness.effects.at(-1).payload[1].start, false);

  assert.equal(harness.traceGrants.length, 1);
  assert.equal(harness.traceGrants[0].itemType.typeID, FERAL_TRACE_TYPE_ID);
  assert.equal(harness.traceGrants[0].quantity, 2);
  assert.deepEqual(
    harness.getTargetItems().map((item) => item.typeID).sort((left, right) => left - right),
    [102, FERAL_TRACE_TYPE_ID],
  );
  assert.equal(harness.cargoRecords.filter((item) => item.typeID === 100).length, 2);
  assert.equal(harness.cargoRecords.filter((item) => item.typeID === 101).length, 1);
  assert.equal(harness.cargoRecords.find((item) => item.typeID === 72244).quantity, 1);
});

test("native wreck scans use native wreck storage for removals and trace deposits", () => {
  const harness = buildInventoryScanHarness();
  harness.target.nativeNpcWreck = true;
  const wreckItems: any[] = [
    { itemID: 301, typeID: 100, groupID: 14, categoryID: 4, itemName: "A", quantity: 3 },
    { itemID: 302, typeID: 101, groupID: 886, categoryID: 4, itemName: "B", quantity: 1 },
  ];
  const deposited: any[] = [];
  let nextWreckItemID = 500;
  Object.assign(harness.dependencies.nativeNpcStore, {
    buildNativeWreckContents() {
      return wreckItems.map((item) => ({ ...item }));
    },
    removeNativeWreckItem(itemID) {
      const index = wreckItems.findIndex((item) => item.itemID === itemID);
      if (index < 0) {
        return { success: false };
      }
      wreckItems.splice(index, 1);
      return { success: true };
    },
    getNativeWreck() {
      return { wreckID: harness.target.itemID, ownerID: harness.target.ownerID, transient: true };
    },
    allocateWreckItemID() {
      nextWreckItemID += 1;
      return { success: true, data: nextWreckItemID };
    },
    upsertNativeWreckItem(record) {
      deposited.push(record);
      wreckItems.push({
        itemID: record.wreckItemID,
        typeID: record.typeID,
        groupID: record.groupID,
        categoryID: record.categoryID,
        quantity: record.quantity,
      });
      return { success: true };
    },
  });

  const controller: Record<string, any> = {};
  syncNpcScanning(
    harness.scene,
    harness.source,
    controller,
    {},
    1_000,
    { dependencies: harness.dependencies },
  );
  const completed = syncNpcScanning(
    harness.scene,
    harness.source,
    controller,
    {},
    4_000,
    { dependencies: harness.dependencies },
  );

  assert.equal(completed.result.stolenTypeCount, 2);
  assert.equal(deposited.length, 1);
  assert.equal(deposited[0].typeID, FERAL_TRACE_TYPE_ID);
  assert.equal(deposited[0].quantity, 2);
  assert.deepEqual(wreckItems.map((item) => item.typeID), [FERAL_TRACE_TYPE_ID]);
});

test("metamorphosis scans use their own type list and apply scan feralization", () => {
  const harness = buildInventoryScanHarness();
  harness.target.kind = "ship";
  harness.target.categoryID = 6;
  const applications: any[] = [];
  const generatedItems: any[] = [];
  harness.dependencies.getTypeEffectRecords = () => [{
    effectID: 12901,
    effectName: "metamorphosisTargetScan",
    guid: "effects.HarvestingBeam",
    durationAttributeID: 79,
    rangeAttributeID: 765,
  }];
  harness.dependencies.getTypeAttributeMap = () => ({ 79: 3_000, 765: 30_000 });
  harness.dependencies.getTypeAttributeValue = (_typeID, name) => ({
    metamorphosisItem: 95284,
    timeBetweenScans: 11,
  }[name] ?? null);
  harness.dependencies.matchesTypeList = (item, listID) => (
    listID === METAMORPHOSIS_TARGET_TYPE_LIST_ID && item.itemID === harness.target.itemID
  );
  harness.dependencies.applyNpcFeralization = (target, source, kind, nowMs) => {
    applications.push({ target, source, kind, nowMs });
    return { supported: true, applied: true, amount: 40 };
  };
  harness.dependencies.generateNpcMetamorphosisItems = (source, kind) => {
    generatedItems.push({ source, kind });
    return {
      supported: true,
      generated: true,
      itemTypeID: 95284,
      quantity: 1,
    };
  };

  const controller: Record<string, any> = {};
  syncNpcScanning(
    harness.scene,
    harness.source,
    controller,
    {},
    2_000,
    { dependencies: harness.dependencies },
  );
  const completed = syncNpcScanning(
    harness.scene,
    harness.source,
    controller,
    {},
    5_000,
    { dependencies: harness.dependencies },
  );

  assert.equal(completed.completed, true);
  assert.equal(applications.length, 1);
  assert.equal(applications[0].kind, "scan");
  assert.equal(generatedItems.length, 1);
  assert.equal(generatedItems[0].kind, "scan");
  assert.equal(harness.traceGrants.length, 0);
  assert.equal(harness.cargoRecords.length, 0);
});

test("metamorphosis scanning rejects NPC variants without a generated item", () => {
  const harness = buildInventoryScanHarness();
  harness.target.kind = "ship";
  harness.target.categoryID = 6;
  harness.dependencies.getTypeEffectRecords = () => [{
    effectID: 12901,
    effectName: "metamorphosisTargetScan",
    guid: "effects.HarvestingBeam",
    durationAttributeID: 79,
    rangeAttributeID: 765,
  }];
  harness.dependencies.getTypeAttributeMap = () => ({ 79: 3_000, 765: 30_000 });
  harness.dependencies.getTypeAttributeValue = () => null;

  const result = syncNpcScanning(
    harness.scene,
    harness.source,
    {},
    {},
    2_000,
    { dependencies: harness.dependencies },
  );

  assert.deepEqual(result, { supported: false, active: false });
  assert.equal(harness.effects.length, 0);
});
