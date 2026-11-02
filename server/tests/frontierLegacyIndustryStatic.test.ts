import assert = require("node:assert/strict");
import test = require("node:test");

const config = require("../src/config");
const database = require("../src/gameStore");
const nativeIndustry = require("../src/services/industry/legacyIndustryStaticData");
const previousConfig = { clientBuild: config.clientBuild, clientCompatibilityProfile: config.clientCompatibilityProfile };
test.beforeEach(() => {
  Object.assign(config, { clientBuild: 2703993, clientCompatibilityProfile: "frontier" });
  nativeIndustry.clearLegacyIndustryStaticCache();
});
test.afterEach(() => {
  Object.assign(config, previousConfig);
  nativeIndustry.clearLegacyIndustryStaticCache();
});

const SOURCE = { buildNumber: 2703993, authority: "eve-frontier-client-static-2703993", profile: "frontier" };
function fixture() {
  return {
    industryBlueprints: { source: { ...SOURCE }, blueprintDefinitions: [
      { blueprintTypeID: 77818, productTypeID: 77818, published: true, blueprintName: "uSOF-30 Fuel", productName: "uSOF-30 Fuel",
        maxProductionLimit: 1000, activities: { manufacturing: {
          materials: [{ typeID: 78423, quantity: 50 }], products: [{ typeID: 77818, quantity: 50 }], time: 55 } } },
      { blueprintTypeID: 999, productTypeID: 999, published: false, maxProductionLimit: 1,
        activities: { manufacturing: { materials: [{ typeID: 78423, quantity: 1 }], products: [{ typeID: 999, quantity: 1 }], time: 1 } } },
    ] },
    industryFacilities: { source: { ...SOURCE }, npcFacilityProfiles: [
      { facilityID: 60000069, solarSystemID: 30000322, regionID: 10000010, typeID: 78943,
        ownerID: 1000442, operationID: 51, serviceIDs: [14], supportsFactory: true,
        supportsLaboratory: false, manufacturingFactor: 0.7, researchFactor: 0.6 },
      { facilityID: 60009999, supportsFactory: false, serviceIDs: [] },
    ] },
    itemTypes: { source: { ...SOURCE }, types: [
      { typeID: 77818, published: true, categoryID: 17 },
      { typeID: 78423, published: true, categoryID: 4 },
      { typeID: 78943, published: false, categoryID: 3 },
    ] },
  };
}
function useFixture(t, tables) {
  t.mock.method(database, "read", name => ({ success: true, data: tables[name] }));
}
const unavailable = { code: "LEGACY_INDUSTRY_STATIC_DATA_UNAVAILABLE" };

test("legacy industry profile is exact and never falls back to modern tables", t => {
  assert.equal(nativeIndustry.isLegacyIndustryProfile(), true);
  t.mock.method(database, "read", () => assert.fail("other profiles must not read native industry data"));
  for (const settings of [
    { clientBuild: 3502403, clientCompatibilityProfile: "frontier" },
    { clientBuild: 2703993, clientCompatibilityProfile: "tranquility" },
  ]) {
    Object.assign(config, settings);
    assert.equal(nativeIndustry.isLegacyIndustryProfile(), false);
    assert.throws(() => nativeIndustry.getLegacyIndustryRecipeByProductID(77818), unavailable);
  }
});

test("published native product recipes use authored inputs, outputs and time without blueprint items", t => {
  useFixture(t, fixture());
  const recipe = nativeIndustry.getLegacyIndustryRecipeByProductID(77818);
  assert.equal(recipe.blueprintTypeID, 77818);
  assert.equal(recipe.productTypeID, 77818);
  assert.equal(recipe.timeSeconds, 55);
  assert.equal(recipe.time, 55);
  assert.equal(recipe.maxProductionLimit, 1000);
  assert.deepEqual(recipe.materials, [{ typeID: 78423, quantity: 50 }]);
  assert.deepEqual(recipe.products, [{ typeID: 77818, quantity: 50 }]);
  assert.deepEqual(recipe.skills, []);
  assert.equal(recipe.source.authority, SOURCE.authority);
  assert.equal(recipe.policy, nativeIndustry.POLICY);
  assert.equal(nativeIndustry.getLegacyIndustryRecipeByProductID(999), null);
  assert.equal(nativeIndustry.getLegacyIndustryRecipeByProductID(84213), null);
  assert.equal(nativeIndustry.getLegacyIndustryRecipeByProductID("77818"), null);
  recipe.materials[0].quantity = 9999;
  assert.equal(nativeIndustry.getLegacyIndustryRecipeByProductID(77818).materials[0].quantity, 50);
});

test("station recipe policy requires authored NPC factory capability and returns independent lists", t => {
  useFixture(t, fixture());
  const factory = nativeIndustry.getLegacyIndustryFactoryByStationID(60000069);
  assert.equal(factory.manufacturingFactor, 0.7);
  assert.equal(factory.supportsLaboratory, false);
  assert.deepEqual(nativeIndustry.getLegacyIndustryBlueprintIDsForStation(60000069), [77818]);
  assert.equal(nativeIndustry.getLegacyIndustryFactoryByStationID(60009999), null);
  assert.deepEqual(nativeIndustry.getLegacyIndustryBlueprintIDsForStation(60009999), []);
  assert.deepEqual(nativeIndustry.getLegacyIndustryBlueprintIDsForStation(999), []);
  const all = nativeIndustry.getLegacyIndustryBlueprintIDsForAllStations();
  assert.deepEqual([...all], [[60000069, [77818]]]);
  all.get(60000069).push(1);
  factory.serviceIDs.length = 0;
  assert.deepEqual(nativeIndustry.getLegacyIndustryBlueprintIDsForStation(60000069), [77818]);
  assert.deepEqual(nativeIndustry.getLegacyIndustryFactoryByStationID(60000069).serviceIDs, [14]);
});

test("all native data authorities must match the exact build and profile", t => {
  for (const name of ["industryBlueprints", "industryFacilities", "itemTypes"]) {
    for (const source of [null, { ...SOURCE, buildNumber: 3502403 },
      { ...SOURCE, authority: "other" }, { ...SOURCE, profile: "tranquility" }]) {
      const tables = fixture(); tables[name].source = source;
      const mock = t.mock.method(database, "read", table => ({ success: true, data: tables[table] }));
      assert.throws(() => nativeIndustry.getLegacyIndustryRecipeByProductID(77818), unavailable);
      mock.mock.restore();
    }
  }
});

test("invalid, missing and ambiguous published recipes fail before producing a catalog", t => {
  const mutations = [
    tables => { tables.industryBlueprints.blueprintDefinitions = []; },
    tables => { tables.itemTypes.types = []; },
    tables => { tables.itemTypes.types = tables.itemTypes.types.filter(type => type.typeID !== 78423); },
    tables => { tables.industryBlueprints.blueprintDefinitions.push(structuredClone(tables.industryBlueprints.blueprintDefinitions[0])); },
    tables => { tables.industryBlueprints.blueprintDefinitions[0].activities.manufacturing.materials[0].quantity = 0; },
    tables => { tables.industryBlueprints.blueprintDefinitions[0].activities.manufacturing.products[0].typeID = 78423; },
    tables => { tables.industryBlueprints.blueprintDefinitions[0].activities.manufacturing.time = 0; },
    tables => { tables.industryBlueprints.blueprintDefinitions[0].activities.manufacturing.skills = [{ typeID: 3380, level: 1 }]; },
    tables => { tables.industryFacilities.npcFacilityProfiles[0].serviceIDs = []; },
  ];
  for (const mutate of mutations) {
    const tables = fixture(); mutate(tables);
    const mock = t.mock.method(database, "read", table => ({ success: true, data: tables[table] }));
    assert.throws(() => nativeIndustry.getLegacyIndustryBlueprintIDsForAllStations(), unavailable);
    mock.mock.restore();
  }
});

test("the attested 2703993 baseline exposes 289 native recipes at 23 factory stations", t => {
  if (Number(database.read("industryBlueprints", "/source/buildNumber").data) !== 2703993) {
    t.skip("requires an isolated native build 2703993 baseline"); return;
  }
  const all = nativeIndustry.getLegacyIndustryBlueprintIDsForAllStations();
  assert.equal(all.size, 23);
  for (const ids of all.values()) assert.equal(ids.length, 289);
  const recipe = nativeIndustry.getLegacyIndustryRecipeByProductID(77818);
  assert.equal(recipe.productName, "uSOF-30 Fuel");
  assert.deepEqual(recipe.materials, [{ typeID: 78423, quantity: 50 }]);
  assert.deepEqual(recipe.products, [{ typeID: 77818, quantity: 50 }]);
  assert.equal(recipe.timeSeconds, 55);
  assert.equal(nativeIndustry.getLegacyIndustryFactoryByStationID(60000069).manufacturingFactor, 0.7);
  assert.equal(nativeIndustry.getLegacyIndustryRecipeByProductID(3927), null);
});
