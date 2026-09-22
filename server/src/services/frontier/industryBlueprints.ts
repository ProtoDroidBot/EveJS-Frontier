"use strict";

const crypto = require("node:crypto");
const staticData = require("./industryStaticData.json");

// Extracted with the client's native industry_*Loader modules, build 3502403.
// Source resource hashes live alongside the authored rows in the JSON file.
const INDUSTRY_INFO_KEY = "evejsFrontierIndustry";
const FRONTIER_INDUSTRY_FACILITY_TYPE_IDS = new Set(
  Object.keys(staticData.facilities).map(Number),
);

function isPositiveInteger(value) {
  return Number.isSafeInteger(value) && value > 0;
}

function isIndustryFacilityType(typeID) {
  return FRONTIER_INDUSTRY_FACILITY_TYPE_IDS.has(Number(typeID));
}

function constructItemSlots(items, maxRuns) {
  return Object.fromEntries(items.map((item) => [item.typeID, {
    // Match Python's json.dumps(sort_keys=True) for FacilityBlueprint.content_hash.
    max_storable_quantity: item.quantity * maxRuns,
    quantity_per_run: item.quantity,
    type_id: item.typeID,
  }]));
}

function getBlueprintForFacility(facilityTypeID, blueprintID) {
  const numericBlueprintID = Number(blueprintID);
  if (!isPositiveInteger(numericBlueprintID)) {
    return null;
  }
  const facility = staticData.facilities[Number(facilityTypeID)];
  const configuration = facility?.blueprints.find(
    (entry) => entry.blueprintID === numericBlueprintID,
  );
  const source = staticData.blueprints[numericBlueprintID];
  if (!configuration || !source) {
    return null;
  }
  // Python sorts integer item-type keys numerically. JavaScript's object key
  // enumeration gives the same order for the client's positive type IDs.
  const blueprint = {
    blueprint_id: numericBlueprintID,
    inputs: constructItemSlots(source.inputs, configuration.maxInputRuns),
    outputs: constructItemSlots(source.outputs, configuration.maxOutputRuns),
    run_time: source.runTime,
  };
  return {
    ...blueprint,
    content_hash: getBlueprintContentHash(blueprint),
  };
}

function getBlueprintContentHash(blueprint) {
  const slots = side => Object.fromEntries(Object.entries<any>(blueprint[side]).map(([typeID, slot]) =>
    [typeID, { max_storable_quantity: slot.max_storable_quantity,
      quantity_per_run: slot.quantity_per_run, type_id: slot.type_id }]));
  return crypto.createHash("sha256").update(JSON.stringify({ blueprint_id: blueprint.blueprint_id,
    inputs: slots("inputs"), outputs: slots("outputs"), run_time: blueprint.run_time }), "utf8").digest("hex");
}

function parseCustomInfo(value) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return { ...value };
  }
  const text = String(value ?? "");
  if (!text.trim()) {
    return {};
  }
  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed;
    }
  } catch (_) {
    // Older items also store free-form text here. Preserve it when adding state.
  }
  return { legacyCustomInfo: text };
}

function getSelectedBlueprint(item, requestedLaneID = 1) {
  const laneID = Number(requestedLaneID);
  if (!Number.isSafeInteger(laneID) || laneID <= 0) return null;
  const state = parseCustomInfo(item?.customInfo)[INDUSTRY_INFO_KEY];
  const laneBlueprintID = state?.lanes?.[String(laneID)]?.blueprintID;
  // The original single-lane field remains the lane-one projection so older
  // clients, dApps and chain snapshots keep their established contract.
  return getBlueprintForFacility(item?.typeID,
    laneBlueprintID ?? (laneID === 1 ? state?.blueprintID : null));
}

// Pure metadata update so the caller can validate access and empty input/output
// inventories, then persist the selection in its existing item transaction.
function withSelectedBlueprint(item, blueprintID, requestedLaneID = 1) {
  const blueprint = getBlueprintForFacility(item?.typeID, blueprintID);
  if (!blueprint) {
    throw new Error("INDUSTRY_BLUEPRINT_INVALID");
  }
  const laneID = Number(requestedLaneID);
  if (!Number.isSafeInteger(laneID) || laneID <= 0) {
    throw new Error("INDUSTRY_JOB_LANE_INVALID");
  }
  const info = parseCustomInfo(item?.customInfo);
  const previous = info[INDUSTRY_INFO_KEY];
  const industry = {
    ...(previous && typeof previous === "object" && !Array.isArray(previous)
      ? previous : {}),
    version: 1,
  };
  const lanes = { ...(industry.lanes || {}) };
  // Do not materialize a lane-one entry solely for recipe selection: the
  // legacy top-level shape remains byte-for-byte compatible until lane state
  // (production/access) actually exists. If it does exist, keep both mirrors.
  if (laneID !== 1 || lanes[String(laneID)]) {
    lanes[String(laneID)] = {
      ...(lanes[String(laneID)] || {}),
      blueprintID: blueprint.blueprint_id,
    };
    industry.lanes = lanes;
  }
  if (laneID === 1) industry.blueprintID = blueprint.blueprint_id;
  info[INDUSTRY_INFO_KEY] = industry;
  return JSON.stringify(info);
}

module.exports = {
  INDUSTRY_INFO_KEY,
  FRONTIER_INDUSTRY_FACILITY_TYPE_IDS,
  isIndustryFacilityType,
  getBlueprintForFacility,
  getBlueprintContentHash,
  getSelectedBlueprint,
  parseCustomInfo,
  withSelectedBlueprint,
};
