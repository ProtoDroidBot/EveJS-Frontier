const config = require("../../config");
const database = require("../../gameStore");
const { usesLegacyFrontierDogmaProfile } = require("../dogma/dogmaInfoCompatibility");

// This is server policy over native data, not an authored per-station recipe
// whitelist: published manufacturing recipes are available at NPC factories.
const POLICY = "frontier-2703993-published-npc-manufacturing-v1";
let cached;

function isLegacyIndustryProfile(runtimeConfig = config) {
  return usesLegacyFrontierDogmaProfile(
    runtimeConfig.clientCompatibilityProfile,
    Number(runtimeConfig.clientBuild),
  );
}

function unavailable(detail): never {
  throw Object.assign(new Error(`Native build 2703993 industry data is unavailable: ${detail}`),
    { code: "LEGACY_INDUSTRY_STATIC_DATA_UNAVAILABLE" });
}

function positive(value) {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function readNativeTable(name) {
  const result = database.read(name, "/");
  const table = result?.success && result.data;
  if (table?.source?.buildNumber !== 2703993 ||
      table.source.authority !== "eve-frontier-client-static-2703993" ||
      table.source.profile !== "frontier") unavailable(`${name} source`);
  return table;
}

function catalog() {
  if (!isLegacyIndustryProfile()) unavailable("client profile");
  const blueprints = readNativeTable("industryBlueprints");
  const facilities = readNativeTable("industryFacilities");
  const itemTypes = readNativeTable("itemTypes");
  if (cached?.blueprints === blueprints && cached.facilities === facilities && cached.itemTypes === itemTypes) {
    return cached;
  }
  if (!Array.isArray(blueprints.blueprintDefinitions) || !blueprints.blueprintDefinitions.length ||
      !Array.isArray(facilities.npcFacilityProfiles) || !facilities.npcFacilityProfiles.length ||
      !Array.isArray(itemTypes.types) || !itemTypes.types.length) unavailable("empty or malformed catalog");
  const types = new Map<number, any>();
  for (const type of itemTypes.types) {
    if (!type || !positive(type.typeID) || types.has(type.typeID)) unavailable("invalid item type");
    types.set(type.typeID, type);
  }
  const slots = (rows, label) => {
    if (!Array.isArray(rows) || !rows.length) unavailable(`${label} entries`);
    const seen = new Set();
    return rows.map(row => {
      if (!row || !positive(row.typeID) || !positive(row.quantity) ||
          !types.has(row.typeID) || seen.has(row.typeID)) unavailable(`${label} item`);
      seen.add(row.typeID);
      return { typeID: row.typeID, quantity: row.quantity };
    });
  };
  const recipes = new Map<number, any>();
  const definitionIDs = new Set();
  for (const definition of blueprints.blueprintDefinitions) {
    if (!definition || !positive(definition.blueprintTypeID) || definitionIDs.has(definition.blueprintTypeID)) {
      unavailable("invalid or ambiguous blueprint ID");
    }
    definitionIDs.add(definition.blueprintTypeID);
    const manufacturing = definition.activities?.manufacturing;
    if (definition.published !== true || !manufacturing) continue;
    const type = types.get(definition.blueprintTypeID);
    const materials = slots(manufacturing.materials, "material");
    const products = slots(manufacturing.products, "product");
    if (type?.published !== true || products.length !== 1 ||
        products[0].typeID !== definition.blueprintTypeID ||
        products[0].typeID !== definition.productTypeID || recipes.has(definition.productTypeID) ||
        !positive(manufacturing.time) || !positive(definition.maxProductionLimit) ||
        (manufacturing.skills !== undefined &&
          (!Array.isArray(manufacturing.skills) || manufacturing.skills.length > 0))) {
      unavailable("unsupported or ambiguous published manufacturing recipe");
    }
    recipes.set(definition.productTypeID, {
      blueprintTypeID: definition.blueprintTypeID,
      productTypeID: definition.productTypeID,
      blueprintName: definition.blueprintName,
      productName: definition.productName,
      materials, products,
      skills: clone(manufacturing.skills || []),
      timeSeconds: manufacturing.time,
      time: manufacturing.time,
      maxProductionLimit: definition.maxProductionLimit,
      source: clone(blueprints.source),
      policy: POLICY,
    });
  }
  if (!recipes.size) unavailable("no supported published manufacturing recipes");
  const factories = new Map<number, any>();
  const facilityIDs = new Set();
  for (const facility of facilities.npcFacilityProfiles) {
    if (!facility || !positive(facility.facilityID) || facilityIDs.has(facility.facilityID)) {
      unavailable("invalid or ambiguous NPC facility ID");
    }
    facilityIDs.add(facility.facilityID);
    if (facility.supportsFactory !== true) continue;
    if (!positive(facility.solarSystemID) || !positive(facility.regionID) ||
        !positive(facility.typeID) || types.get(facility.typeID)?.categoryID !== 3 ||
        !positive(facility.ownerID) || !positive(facility.operationID) ||
        !Array.isArray(facility.serviceIDs) || !facility.serviceIDs.every(positive) ||
        !facility.serviceIDs.includes(14) ||
        typeof facility.manufacturingFactor !== "number" ||
        !Number.isFinite(facility.manufacturingFactor) || facility.manufacturingFactor <= 0) {
      unavailable("invalid NPC factory capability");
    }
    factories.set(facility.facilityID, { ...clone(facility), source: clone(facilities.source), policy: POLICY });
  }
  if (!factories.size) unavailable("no NPC factories");
  const recipeIDs = [...recipes.keys()].sort((a, b) => a - b);
  cached = { blueprints, facilities, itemTypes, recipes, factories, recipeIDs };
  return cached;
}

function clearLegacyIndustryStaticCache() {
  cached = undefined;
}

function getLegacyIndustryRecipeByProductID(productID) {
  const data = catalog();
  return positive(productID) && data.recipes.has(productID) ? clone(data.recipes.get(productID)) : null;
}

function getLegacyIndustryFactoryByStationID(stationID) {
  const data = catalog();
  return positive(stationID) && data.factories.has(stationID) ? clone(data.factories.get(stationID)) : null;
}

function getLegacyIndustryBlueprintIDsForStation(stationID) {
  const data = catalog();
  return positive(stationID) && data.factories.has(stationID) ? data.recipeIDs.slice() : [];
}

function getLegacyIndustryBlueprintIDsForAllStations(): Map<number, number[]> {
  const data = catalog();
  const result = new Map<number, number[]>();
  for (const stationID of [...data.factories.keys()].sort((a, b) => a - b)) {
    result.set(stationID, data.recipeIDs.slice());
  }
  return result;
}

module.exports = {
  POLICY,
  isLegacyIndustryProfile,
  clearLegacyIndustryStaticCache,
  getLegacyIndustryRecipeByProductID,
  getLegacyIndustryFactoryByStationID,
  getLegacyIndustryBlueprintIDsForStation,
  getLegacyIndustryBlueprintIDsForAllStations,
};
