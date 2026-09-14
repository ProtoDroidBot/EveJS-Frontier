const itemStore = require("../inventory/itemStore");
const blueprints = require("./industryBlueprints");
const { readConstructionState, isAssemblyActivationPending, ASSEMBLY_STATUS_ONLINE } = require("./deploymentRuntime");

const INPUT_FLAG = 20000;
const OUTPUT_FLAG = 20001;
// Catch-up is bounded per worker turn, and resumes from the committed deadline.
const MAX_ADVANCE_RUNS = 25;
const MAX_ADVANCE_MS = 20;

function fail(errorMsg, data?) { return { success: false as const, errorMsg, ...(data ? { data } : {}) }; }
function integer(value, minimum = 0) { return Number.isSafeInteger(value) && value >= minimum; }
function currentTime(options) {
  const value = options?.nowMs ?? Date.now();
  return integer(value) ? value : null;
}
function industryInfo(facility) {
  return blueprints.parseCustomInfo(facility?.customInfo)[blueprints.INDUSTRY_INFO_KEY];
}
function getProduction(facility) {
  const raw = industryInfo(facility)?.production;
  if (raw === null || raw === undefined) return null;
  if (!raw || typeof raw !== "object" || Array.isArray(raw) || raw.version !== 1 ||
      !integer(raw.jobID, 1) || !["RUNNING", "DISCONTINUING", "STOPPED"].includes(raw.state) ||
      !(raw.requestedRuns === null || integer(raw.requestedRuns, 1)) || !integer(raw.completedRuns) ||
      (raw.requestedRuns !== null && raw.completedRuns > raw.requestedRuns) ||
      (raw.state !== "STOPPED" && raw.requestedRuns !== null && raw.completedRuns >= raw.requestedRuns) ||
      !integer(raw.runStartedAtMs) || !integer(raw.runEndAtMs, raw.runStartedAtMs + 1) ||
      !(raw.stopReason === null || typeof raw.stopReason === "string") ||
      (raw.state !== "STOPPED" && raw.stopReason !== null)) return null;
  return { version: 1, jobID: raw.jobID, state: raw.state, requestedRuns: raw.requestedRuns,
    completedRuns: raw.completedRuns, runStartedAtMs: raw.runStartedAtMs,
    runEndAtMs: raw.runEndAtMs, stopReason: raw.stopReason };
}
function invalidStoredProduction(facility) {
  return industryInfo(facility)?.production != null && !getProduction(facility);
}
function withProduction(facility, production, recipe = null) {
  const info = blueprints.parseCustomInfo(facility.customInfo);
  info[blueprints.INDUSTRY_INFO_KEY] = { ...info[blueprints.INDUSTRY_INFO_KEY], production,
    ...(recipe ? { productionRecipe: { jobID: production.jobID, blueprint: recipe } } : {}) };
  return JSON.stringify(info);
}
function online(facility) {
  return readConstructionState(facility)?.assemblyStatus === ASSEMBLY_STATUS_ONLINE &&
    !isAssemblyActivationPending(facility);
}
function validateBlueprint(blueprint) {
  if (!blueprint || !integer(blueprint.run_time * 1000, 1)) return false;
  for (const side of ["inputs", "outputs"]) {
    const slots = Object.entries<any>(blueprint[side] || {});
    if (!slots.length || slots.some(([typeID, slot]) => !integer(Number(typeID), 1) ||
        slot?.type_id !== Number(typeID) ||
        !integer(slot?.quantity_per_run, 1) || !integer(slot?.max_storable_quantity, slot.quantity_per_run))) return false;
  }
  return true;
}
function getProductionRecipe(facility, production) {
  const saved = industryInfo(facility)?.productionRecipe;
  const recipe = saved?.blueprint;
  if (saved?.jobID !== production.jobID || !validateBlueprint(recipe) ||
      blueprints.getBlueprintContentHash(recipe) !== recipe.content_hash ||
      production.runEndAtMs - production.runStartedAtMs !== recipe.run_time * 1000) return null;
  return recipe;
}
function rows(facility, flag) {
  return itemStore.listContainerItems(facility.ownerID, facility.itemID, flag)
    .sort((left, right) => left.itemID - right.itemID);
}
function totalByType(items) {
  const totals: Record<string, number> = {};
  for (const item of items) {
    const quantity = item.singleton ? 1 : item.stacksize;
    if (!integer(quantity, 1)) return null;
    const total = (totals[item.typeID] || 0) + quantity;
    if (!integer(total, 1)) return null;
    totals[item.typeID] = total;
  }
  return totals;
}
function planInputs(facility, blueprint) {
  const inputs = rows(facility, INPUT_FLAG);
  const consumptions: any[] = [];
  for (const [typeID, slot] of Object.entries<any>(blueprint.inputs)) {
    let remaining = slot.quantity_per_run;
    for (const item of inputs) {
      if (item.singleton || Number(item.typeID) !== Number(typeID) || !integer(item.stacksize, 1)) continue;
      const quantity = Math.min(remaining, item.stacksize);
      if (quantity > 0) consumptions.push({ itemID: item.itemID, quantity });
      remaining -= quantity;
      if (!remaining) break;
    }
    if (remaining > 0) return null;
  }
  return consumptions;
}
function outputCapacity(facility, blueprint, runs = 1) {
  const totals = totalByType(rows(facility, OUTPUT_FLAG));
  if (!totals) return false;
  return Object.entries<any>(blueprint.outputs).every(([typeID, slot]) => {
    const total = (totals[typeID] || 0) + slot.quantity_per_run * runs;
    return integer(total) && total <= slot.max_storable_quantity;
  });
}
function productionData(facility, changes = [], events = []) {
  return { facility, production: getProduction(facility), changes, events };
}
function commit(facility, production, consumptions = [], outputs = [], recipe = null) {
  const result = itemStore.commitInventoryProduction({ facilityID: facility.itemID,
    expectedCustomInfo: facility.customInfo, customInfo: withProduction(facility, production, recipe),
    inputFlag: INPUT_FLAG, outputFlag: OUTPUT_FLAG, consumptions, outputs });
  return result.success ? { success: true as const,
    data: productionData(result.data.facility, result.data.changes) } : result;
}
function event(type, production, timestampMs) {
  return { type, production: { ...production }, timestampMs,
    ...(production.stopReason ? { stopReason: production.stopReason } : {}) };
}

function startProduction(session, facilityID, blueprintID, hash, runs = null, options = {}) {
  const access = require("./industryRuntime").validateFacility(session, facilityID);
  if (!access.success) return access;
  const { facility } = access.data;
  if (invalidStoredProduction(facility)) return fail("INVALID_PRODUCTION_STATE");
  const previous = getProduction(facility);
  if (previous && previous.state !== "STOPPED") return fail("PRODUCTION_ALREADY_RUNNING");
  if (!online(facility)) return fail("FACILITY_OFFLINE");
  const blueprint = blueprints.getSelectedBlueprint(facility);
  if (!blueprint || Number(blueprintID) !== blueprint.blueprint_id) return fail("BLUEPRINT_NOT_LOADED");
  if (typeof hash !== "string" || !blueprint.content_hash || hash !== blueprint.content_hash) return fail("INVALID_BLUEPRINT_HASH");
  if (!validateBlueprint(blueprint) || blueprints.getBlueprintContentHash(blueprint) !== blueprint.content_hash) return fail("BLUEPRINT_NOT_FOUND");
  if (runs !== null && (typeof runs !== "number" && typeof runs !== "bigint" && typeof runs !== "string")) return fail("INVALID_RUN_COUNT");
  const requestedRuns = runs === null ? null : Number(runs);
  if (requestedRuns !== null && !integer(requestedRuns, 1)) return fail("INVALID_RUN_COUNT");
  const nowMs = currentTime(options);
  const jobID = (previous?.jobID || 0) + 1;
  if (nowMs === null || !integer(nowMs + blueprint.run_time * 1000) || !integer(jobID, 1)) return fail("INVALID_PRODUCTION_TIME");
  if (!outputCapacity(facility, blueprint)) return fail("OUTPUT_CAPACITY_EXCEEDED");
  const consumptions = planInputs(facility, blueprint);
  if (!consumptions) return fail("INSUFFICIENT_INPUTS");
  const production = { version: 1, jobID, state: "RUNNING", requestedRuns, completedRuns: 0,
    runStartedAtMs: nowMs, runEndAtMs: nowMs + blueprint.run_time * 1000, stopReason: null };
  const result = commit(facility, production, consumptions, [], blueprint);
  if (result.success) result.data.events.push(event("started", production, nowMs));
  return result;
}

function advanceProduction(facilityID, options = {}) {
  let facility = itemStore.findItemById(Number(facilityID));
  if (!facility || !blueprints.isIndustryFacilityType(facility.typeID)) return fail("FACILITY_NOT_FOUND");
  if (invalidStoredProduction(facility)) return fail("INVALID_PRODUCTION_STATE");
  const nowMs = currentTime(options);
  if (nowMs === null) return fail("INVALID_PRODUCTION_TIME");
  const changes: any[] = [];
  const events: any[] = [];
  const failed = errorMsg => fail(errorMsg, productionData(facility, changes, events));
  const advanceStartedAt = performance.now();
  for (let count = 0; count < MAX_ADVANCE_RUNS; count++) {
    if (count > 0 && performance.now() - advanceStartedAt >= MAX_ADVANCE_MS) break;
    const current = getProduction(facility);
    if (!current || current.state === "STOPPED" || current.runEndAtMs > nowMs) break;
    // Preserve the paid recipe across server/static-data upgrades. Its products
    // belong to this run even if the newly authored recipe has changed.
    const blueprint = getProductionRecipe(facility, current);
    if (!blueprint) return failed("INVALID_PRODUCTION_STATE");
    const selected = blueprints.getSelectedBlueprint(facility);
    // Each running record has already paid for exactly one run. Keep it pending
    // if external changes occupied its reserved output space; never lose it.
    if (!outputCapacity(facility, blueprint)) return failed("OUTPUT_CAPACITY_EXCEEDED");
    const outputs = Object.entries<any>(blueprint.outputs).map(([typeID, slot]) =>
      ({ typeID: Number(typeID), quantity: slot.quantity_per_run }));
    const production = { ...current, completedRuns: current.completedRuns + 1 };
    if (!integer(production.completedRuns)) return failed("INVALID_PRODUCTION_STATE");
    let stopReason = current.state === "DISCONTINUING" ? "DISCONTINUED" :
      production.requestedRuns !== null && production.completedRuns >= production.requestedRuns ? "COMPLETED" :
        selected?.content_hash !== blueprint.content_hash ? "BLUEPRINT_CHANGED" :
        !online(facility) ? "FACILITY_OFFLINE" : null;
    let consumptions = [];
    if (!stopReason) {
      if (!outputCapacity(facility, blueprint, 2)) stopReason = "OUTPUT_CAPACITY_EXCEEDED";
      else {
        consumptions = planInputs(facility, blueprint);
        if (!consumptions) { stopReason = "INSUFFICIENT_INPUTS"; consumptions = []; }
      }
    }
    if (stopReason) Object.assign(production, { state: "STOPPED", stopReason });
    else {
      const runEndAtMs = current.runEndAtMs + blueprint.run_time * 1000;
      if (!integer(runEndAtMs)) return failed("INVALID_PRODUCTION_TIME");
      Object.assign(production, { state: "RUNNING", runStartedAtMs: current.runEndAtMs, runEndAtMs });
    }
    // Completing a run, paying for its successor, and recording the new deadline
    // are a single durable transition, so a restart/retry cannot mint twice.
    const result = commit(facility, production, consumptions, outputs);
    if (!result.success) return failed(result.errorMsg);
    facility = result.data.facility;
    changes.push(...result.data.changes);
    events.push(event(stopReason ? "stopped" : "started", production, current.runEndAtMs));
    if (stopReason) break;
  }
  return { success: true as const, data: productionData(facility, changes, events) };
}

function discontinueProduction(session, facilityID, options = {}) {
  const access = require("./industryRuntime").validateFacility(session, facilityID);
  if (!access.success) return access;
  const { facility } = access.data;
  if (invalidStoredProduction(facility)) return fail("INVALID_PRODUCTION_STATE");
  const current = getProduction(facility);
  if (!current || current.state === "STOPPED") return fail("PRODUCTION_NOT_RUNNING");
  if (currentTime(options) === null) return fail("INVALID_PRODUCTION_TIME");
  if (current.state === "DISCONTINUING") return advanceProduction(facilityID, options);
  const result = commit(facility, { ...current, state: "DISCONTINUING" });
  if (!result.success) return result;
  const advanced = advanceProduction(facilityID, options);
  if (advanced.data) advanced.data.changes.unshift(...result.data.changes);
  return advanced;
}

module.exports = { getProduction, invalidStoredProduction, startProduction, discontinueProduction, advanceProduction };
