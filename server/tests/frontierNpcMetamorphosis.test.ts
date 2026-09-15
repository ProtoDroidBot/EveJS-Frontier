"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  ATTRIBUTE_METAMORPHOSIS_ITEM,
  ATTRIBUTE_METAMORPHOSIS_ITEM_AMOUNT_ON_HIT,
  generateNpcMetamorphosisItems,
} = require("../src/space/npc/npcMetamorphosis");

const THRUMMING_STRAND_TYPE_ID = 95284;

function buildHarness() {
  const cargoRecords: any[] = [];
  let nextCargoID = 1_000;
  const nativeNpcStore = {
    allocateCargoID() {
      nextCargoID += 1;
      return { success: true, data: nextCargoID };
    },
    listNativeCargoForEntity(entityID) {
      return cargoRecords.filter((record) => record.entityID === entityID);
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
    buildNativeCargoItems(entityID) {
      return cargoRecords
        .filter((record) => record.entityID === entityID)
        .map((record) => ({ ...record }));
    },
  };
  const source: any = {
    itemID: 50_001,
    typeID: 95504,
    ownerID: 500025,
    kind: "ship",
    nativeNpc: true,
    transient: true,
    passiveDerivedState: {
      attributes: {
        [ATTRIBUTE_METAMORPHOSIS_ITEM]: THRUMMING_STRAND_TYPE_ID,
        [ATTRIBUTE_METAMORPHOSIS_ITEM_AMOUNT_ON_HIT]: 3,
      },
    },
  };
  const dependencies = {
    getTypeAttributeValue() {
      return null;
    },
    nativeNpcStore,
    resolveItemByTypeID(typeID) {
      return typeID === THRUMMING_STRAND_TYPE_ID
        ? {
            typeID,
            name: "Thrumming Strand",
            groupID: 5131,
            categoryID: 4,
          }
        : null;
    },
  };
  return { cargoRecords, dependencies, source };
}

test("valid Mycena accumulate Thrumming Strands in native cargo from scans and damaging hits", () => {
  const harness = buildHarness();

  const scan = generateNpcMetamorphosisItems(harness.source, "scan", {
    dependencies: harness.dependencies,
  });
  const miss = generateNpcMetamorphosisItems(harness.source, "hit", {
    appliedDamage: 0,
    dependencies: harness.dependencies,
  });
  const hits = Array.from({ length: 3 }, () => (
    generateNpcMetamorphosisItems(harness.source, "hit", {
      appliedDamage: 5,
      dependencies: harness.dependencies,
    })
  ));

  assert.equal(scan.quantity, 1);
  assert.equal(miss.generated, false);
  assert.deepEqual(hits.map((result) => result.quantity), [3, 3, 3]);
  assert.equal(hits.at(-1).totalQuantity, 10);
  assert.equal(harness.cargoRecords.length, 1);
  assert.equal(harness.cargoRecords[0].typeID, THRUMMING_STRAND_TYPE_ID);
  assert.equal(harness.cargoRecords[0].quantity, 10);
  assert.equal(harness.source.nativeCargoItems[0].quantity, 10);
});

test("NPCs without metamorphosisItem do not generate cargo", () => {
  const harness = buildHarness();
  harness.source.passiveDerivedState.attributes = {
    [ATTRIBUTE_METAMORPHOSIS_ITEM_AMOUNT_ON_HIT]: 3,
  };

  const result = generateNpcMetamorphosisItems(harness.source, "hit", {
    appliedDamage: 5,
    dependencies: harness.dependencies,
  });

  assert.deepEqual(result, {
    supported: false,
    generated: false,
    quantity: 0,
  });
  assert.equal(harness.cargoRecords.length, 0);
});
