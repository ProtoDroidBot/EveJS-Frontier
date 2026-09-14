"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  INDUSTRY_INFO_KEY,
  isIndustryFacilityType,
  getBlueprintForFacility,
  getSelectedBlueprint,
  withSelectedBlueprint,
} = require("../src/services/frontier/industryBlueprints");
const staticData = require("../src/services/frontier/industryStaticData.json");

test("industry blueprints use authored per-facility capacities and client hashes", () => {
  const blueprint = getBlueprintForFacility(87119, 1026);
  assert.deepEqual(blueprint, {
    blueprint_id: 1026,
    run_time: 3,
    inputs: {
      77803: { type_id: 77803, quantity_per_run: 45, max_storable_quantity: 9855 },
      83894: { type_id: 83894, quantity_per_run: 1, max_storable_quantity: 219 },
    },
    outputs: {
      83895: { type_id: 83895, quantity_per_run: 1, max_storable_quantity: 334 },
    },
    // Independently generated with the client's Python json.dumps + sha256 recipe.
    content_hash: "bc982061d951a97727fb0aec62816134f1d979b6bef7b7324c5b66cf3951a89c",
  });
  const largerFacility = getBlueprintForFacility(87120, 1026);
  assert.equal(largerFacility.inputs[77803].max_storable_quantity, 163620);
  assert.equal(largerFacility.outputs[83895].max_storable_quantity, 6666);
  assert.notEqual(largerFacility.content_hash, blueprint.content_hash);
});

test("only blueprints authored for the selected Industry facility can be loaded", () => {
  assert.equal(isIndustryFacilityType(87119), true);
  assert.equal(isIndustryFacilityType(88092), false);
  assert.equal(getBlueprintForFacility(88092, 1026), null);
  assert.equal(getBlueprintForFacility(87119, 1000), null);
  for (const invalidID of [0, -1, 1026.5, NaN, Infinity, "unknown"]) {
    assert.equal(getBlueprintForFacility(87119, invalidID), null);
  }
  assert.throws(() => withSelectedBlueprint({ typeID: 87119 }, 1000),
    /INDUSTRY_BLUEPRINT_INVALID/);
});

test("blueprint selection persists alongside assembly metadata without modifying the item", () => {
  const item = {
    typeID: 87119,
    customInfo: JSON.stringify({
      evejsFrontierConstruction: { assemblyStatus: 1, networkNodeID: 4321 },
      [INDUSTRY_INFO_KEY]: { unrelated: "preserved" },
    }),
  };
  const saved = withSelectedBlueprint(item, 1026);
  assert.equal(getSelectedBlueprint(item), null);
  assert.deepEqual(JSON.parse(saved), {
    evejsFrontierConstruction: { assemblyStatus: 1, networkNodeID: 4321 },
    [INDUSTRY_INFO_KEY]: { unrelated: "preserved", version: 1, blueprintID: 1026 },
  });
  assert.deepEqual(getSelectedBlueprint({ ...item, customInfo: saved }),
    getBlueprintForFacility(87119, 1026));
  assert.deepEqual(getSelectedBlueprint({ ...item, customInfo: JSON.parse(saved) }),
    getBlueprintForFacility(87119, 1026));
  assert.equal(getSelectedBlueprint({ ...item, typeID: 88092, customInfo: saved }), null);
  const legacy = JSON.parse(withSelectedBlueprint({ ...item, customInfo: "Legacy notes" }, 1026));
  assert.equal(legacy.legacyCustomInfo, "Legacy notes");
});

test("all bundled facility blueprints have complete valid slot definitions", () => {
  assert.equal(staticData.build, 3502403);
  assert.equal(Object.keys(staticData.facilities).length, 14);
  for (const [facilityTypeID, facility] of Object.entries<any>(staticData.facilities)) {
    for (const configuration of facility.blueprints) {
      const blueprint = getBlueprintForFacility(facilityTypeID, configuration.blueprintID);
      assert.ok(blueprint, `Missing blueprint ${facilityTypeID}/${configuration.blueprintID}`);
      for (const direction of ["inputs", "outputs"]) {
        for (const [typeID, slot] of Object.entries<any>(blueprint[direction])) {
          assert.equal(Number(typeID), slot.type_id);
          assert.ok(Number.isSafeInteger(slot.quantity_per_run) && slot.quantity_per_run > 0);
          assert.ok(Number.isSafeInteger(slot.max_storable_quantity));
          assert.ok(slot.max_storable_quantity >= slot.quantity_per_run);
        }
      }
    }
  }
});
