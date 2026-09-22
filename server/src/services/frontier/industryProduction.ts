const itemStore = require("../inventory/itemStore");
const blueprints = require("./industryBlueprints");
const config = require("../../config");
const { readConstructionState, isAssemblyActivationPending, isPortableAssemblyType,
  ASSEMBLY_STATUS_ONLINE } = require("./deploymentRuntime");

const INPUT_FLAG = 20000;
const OUTPUT_FLAG = 20001;
// Catch-up is bounded per worker turn, and resumes from the committed deadline.
const MAX_ADVANCE_RUNS = 25;
const MAX_ADVANCE_MS = 20;
const MAX_JOB_LANES = 16;
const LANE_ACCESS_MODES = new Set(["owner", "tribe", "allowlist", "public"]);

function fail(errorMsg, data?) { return { success: false as const, errorMsg, ...(data ? { data } : {}) }; }
function integer(value, minimum = 0) { return Number.isSafeInteger(value) && value >= minimum; }
function currentTime(options) {
  const value = options?.nowMs ?? Date.now();
  return integer(value) ? value : null;
}
function industryInfo(facility) {
  return blueprints.parseCustomInfo(facility?.customInfo)[blueprints.INDUSTRY_INFO_KEY];
}
function configuredLaneCount() {
  const value = Math.trunc(Number(config.frontierSmartIndustryJobLaneCount) || 1);
  return Math.max(1, Math.min(MAX_JOB_LANES, value));
}
function configuredLaneCountForType(typeID) {
  const numericTypeID = Number(typeID);
  const configuredByType = config.frontierSmartIndustryJobLaneCountByTypeID;
  const configuredValue = configuredByType && typeof configuredByType === "object" &&
    !Array.isArray(configuredByType) && Number.isSafeInteger(numericTypeID) && numericTypeID > 0
    ? Number(configuredByType[String(numericTypeID)]) : NaN;
  return Number.isInteger(configuredValue) && configuredValue >= 1 && configuredValue <= MAX_JOB_LANES
    ? configuredValue : configuredLaneCount();
}
function getFacilityLaneCount(facility) {
  if (!facility || !blueprints.isIndustryFacilityType(facility.typeID)) return 0;
  // Creation modules share their host ship's Industry surface, and portable
  // assemblies are intentionally compact facilities. Both stay on the retail
  // lane-1 contract regardless of the multi-lane Smart Industry profile.
  if (isPortableAssemblyType(facility.typeID) || getCreationHostedFacilityState(facility)) {
    return 1;
  }
  return configuredLaneCountForType(facility.typeID);
}
function laneID(value, fallback = 1) {
  const numeric = Number(value ?? fallback);
  return Number.isSafeInteger(numeric) && numeric >= 1 && numeric <= MAX_JOB_LANES
    ? numeric
    : 0;
}
function inputFlag(requestedLaneID = 1) {
  const numericLaneID = laneID(requestedLaneID);
  return numericLaneID ? INPUT_FLAG + (numericLaneID - 1) * 2 : 0;
}
function outputFlag(requestedLaneID = 1) {
  const flag = inputFlag(requestedLaneID);
  return flag ? flag + 1 : 0;
}
function rawLane(info, numericLaneID) {
  const entry = info?.lanes?.[String(numericLaneID)];
  return entry && typeof entry === "object" && !Array.isArray(entry) ? entry : null;
}
function parseProduction(raw) {
  if (raw === null || raw === undefined) return null;
  if (!raw || typeof raw !== "object" || Array.isArray(raw) || raw.version !== 1 ||
      !integer(raw.jobID, 1) || !["RUNNING", "DISCONTINUING", "STOPPED"].includes(raw.state) ||
      !(raw.requestedRuns === null || integer(raw.requestedRuns, 1)) || !integer(raw.completedRuns) ||
      (raw.requestedRuns !== null && raw.completedRuns > raw.requestedRuns) ||
      (raw.state !== "STOPPED" && raw.requestedRuns !== null && raw.completedRuns >= raw.requestedRuns) ||
      !integer(raw.runStartedAtMs) || !integer(raw.runEndAtMs, raw.runStartedAtMs + 1) ||
      !(raw.stopReason === null || typeof raw.stopReason === "string") ||
      !(raw.executorKey === undefined || raw.executorKey === null ||
        typeof raw.executorKey === "string" && raw.executorKey.length > 0 &&
        raw.executorKey.length <= 192 && /^[A-Za-z0-9._:/-]+$/u.test(raw.executorKey)) ||
      (raw.state !== "STOPPED" && raw.stopReason !== null)) return null;
  return { version: 1, jobID: raw.jobID, state: raw.state, requestedRuns: raw.requestedRuns,
    completedRuns: raw.completedRuns, runStartedAtMs: raw.runStartedAtMs,
    runEndAtMs: raw.runEndAtMs, stopReason: raw.stopReason,
    ...(raw.executorKey ? { executorKey: raw.executorKey } : {}) };
}
function getProduction(facility, requestedLaneID = 1) {
  const numericLaneID = laneID(requestedLaneID);
  if (!numericLaneID) return null;
  const info = industryInfo(facility);
  const lane = rawLane(info, numericLaneID);
  const raw = lane?.production ?? (numericLaneID === 1 ? info?.production : null);
  return parseProduction(raw);
}
function storedLaneIDs(facility) {
  const info = industryInfo(facility);
  const result = new Set<number>();
  if (info?.production != null) result.add(1);
  for (const key of Object.keys(info?.lanes || {})) {
    const numeric = laneID(key, 0);
    if (numeric) result.add(numeric);
  }
  return [...result].sort((left, right) => left - right);
}
function visibleLaneIDs(facility) {
  const result = new Set(storedLaneIDs(facility));
  for (let current = 1; current <= getFacilityLaneCount(facility); current += 1) result.add(current);
  return [...result].sort((left, right) => left - right);
}
function getProductions(facility) {
  return visibleLaneIDs(facility).map((currentLaneID) => ({
    laneID: currentLaneID,
    production: getProduction(facility, currentLaneID),
  }));
}
function hasActiveProduction(facility) {
  return getProductions(facility).some(({ production }) =>
    production && production.state !== "STOPPED");
}
function invalidStoredProduction(facility) {
  const info = industryInfo(facility);
  if (info?.production != null && !parseProduction(info.production)) return true;
  for (const key of Object.keys(info?.lanes || {})) {
    const numericLaneID = laneID(key, 0);
    const lane = rawLane(info, numericLaneID);
    if (!numericLaneID || !lane || (lane.production != null && !parseProduction(lane.production))) {
      return true;
    }
  }
  const laneOneProduction = rawLane(info, 1)?.production;
  if (info?.production != null && laneOneProduction != null &&
      JSON.stringify(parseProduction(info.production)) !==
        JSON.stringify(parseProduction(laneOneProduction))) return true;
  return false;
}
function withProduction(facility, production, recipe = null, requestedLaneID = 1) {
  const numericLaneID = laneID(requestedLaneID);
  if (!numericLaneID) throw new Error("INVALID_JOB_LANE");
  const info = blueprints.parseCustomInfo(facility.customInfo);
  const industry = { ...(info[blueprints.INDUSTRY_INFO_KEY] || {}) };
  const lanes = { ...(industry.lanes || {}) };
  const previousLane = rawLane(industry, numericLaneID) || {};
  const nextLane: Record<string, any> = { ...previousLane, production };
  if (recipe) nextLane.productionRecipe = { jobID: production.jobID, blueprint: recipe };
  lanes[String(numericLaneID)] = nextLane;
  industry.lanes = lanes;
  if (numericLaneID === 1) {
    industry.production = production;
    if (recipe) industry.productionRecipe = { jobID: production.jobID, blueprint: recipe };
  }
  info[blueprints.INDUSTRY_INFO_KEY] = industry;
  return JSON.stringify(info);
}
function positiveIDList(value) {
  if (value?.type === "list") value = value.items;
  if (!Array.isArray(value)) return [];
  const ids = new Set<number>();
  for (const entry of value) {
    const numeric = Number(entry);
    if (!Number.isSafeInteger(numeric) || numeric <= 0 || ids.size >= 64) continue;
    ids.add(numeric);
  }
  return [...ids].sort((left, right) => left - right);
}
function normalizeLaneAccessPolicy(value, session = null) {
  const raw = value instanceof Map ? Object.fromEntries(value) :
    value?.type === "dict" && Array.isArray(value.entries) ? Object.fromEntries(value.entries) :
      value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const mode = String(raw.mode || "owner").trim().toLowerCase();
  if (!LANE_ACCESS_MODES.has(mode)) return null;
  const characterIDs = mode === "allowlist" ? positiveIDList(
    raw.characterIDs ?? raw.character_ids,
  ) : [];
  let tribeIDs = ["tribe", "allowlist"].includes(mode) ? positiveIDList(
    raw.tribeIDs ?? raw.tribe_ids,
  ) : [];
  if (mode === "tribe" && tribeIDs.length === 0) {
    const sessionTribeID = Number(
      session?.tribeID || session?.tribeId || session?.corporationID || session?.corpid,
    );
    if (Number.isSafeInteger(sessionTribeID) && sessionTribeID > 0) tribeIDs = [sessionTribeID];
  }
  if (mode === "tribe" && tribeIDs.length === 0) return null;
  return { version: 1, mode, characterIDs, tribeIDs };
}
function getLaneAccessPolicy(facility, requestedLaneID = 1) {
  const numericLaneID = laneID(requestedLaneID);
  if (!numericLaneID) return null;
  const stored = rawLane(industryInfo(facility), numericLaneID)?.accessPolicy;
  return normalizeLaneAccessPolicy(stored) || {
    version: 1,
    mode: "owner",
    characterIDs: [],
    tribeIDs: [],
  };
}
function canUseLane(facility, session, requestedLaneID = 1) {
  const characterID = Number(session?.characterID || session?.charid);
  if (!facility || !Number.isSafeInteger(characterID) || characterID <= 0) return false;
  if (Number(facility.ownerID) === characterID) return true;
  const policy = getLaneAccessPolicy(facility, requestedLaneID);
  if (!policy) return false;
  if (policy.mode === "public") return true;
  if (policy.characterIDs.includes(characterID)) return true;
  const tribeID = Number(
    session?.tribeID || session?.tribeId || session?.corporationID || session?.corpid,
  );
  return Number.isSafeInteger(tribeID) && tribeID > 0 && policy.tribeIDs.includes(tribeID);
}
function getJobLanes(facility, session = null) {
  const characterID = Number(session?.characterID || session?.charid) || 0;
  const enabledLaneCount = getFacilityLaneCount(facility);
  return visibleLaneIDs(facility).flatMap((currentLaneID) => {
    const production = getProduction(facility, currentLaneID);
    const enabled = currentLaneID <= enabledLaneCount;
    // A paid job that predates a profile reduction remains observable until
    // the worker settles it. Empty and stopped disabled lanes are not exposed
    // as usable capacity on a Creation or portable facility.
    if (!enabled && (!production || production.state === "STOPPED")) return [];
    return [{
      laneID: currentLaneID,
      enabled,
      accessPolicy: getLaneAccessPolicy(facility, currentLaneID),
      canManage: enabled && characterID > 0 && characterID === Number(facility?.ownerID),
      canUse: enabled && canUseLane(facility, session, currentLaneID),
      blueprint: blueprints.getSelectedBlueprint(facility, currentLaneID),
      items: {
        inputs: totalByType(rows(facility, inputFlag(currentLaneID))) || {},
        outputs: totalByType(rows(facility, outputFlag(currentLaneID))) || {},
      },
      production,
    }];
  });
}
function setLaneAccessPolicy(session, facilityID, requestedLaneID, rawPolicy, options = {}) {
  const numericLaneID = laneID(requestedLaneID);
  if (!numericLaneID) return fail("INVALID_JOB_LANE");
  const access = require("./industryRuntime").validateFacility(session, facilityID, options);
  if (!access.success) return access;
  const { facility, characterID } = access.data;
  if (numericLaneID > getFacilityLaneCount(facility)) return fail("INVALID_JOB_LANE");
  if (Number(facility.ownerID) !== Number(characterID)) return fail("JOB_LANE_ACCESS_DENIED");
  const policy = normalizeLaneAccessPolicy(rawPolicy, session);
  if (!policy) return fail("INVALID_JOB_LANE_ACCESS");
  const result = itemStore.updateInventoryItem(facility.itemID, (current) => {
    const info = blueprints.parseCustomInfo(current.customInfo);
    const industry = { ...(info[blueprints.INDUSTRY_INFO_KEY] || {}) };
    const lanes = { ...(industry.lanes || {}) };
    lanes[String(numericLaneID)] = {
      ...(rawLane(industry, numericLaneID) || {}),
      accessPolicy: policy,
    };
    industry.lanes = lanes;
    info[blueprints.INDUSTRY_INFO_KEY] = industry;
    return { ...current, customInfo: JSON.stringify(info) };
  });
  return result.success ? {
    success: true as const,
    data: getJobLanes(result.data, session).find((lane) => lane.laneID === numericLaneID),
  } : result;
}
function getCreationHostedFacilityState(facility) {
  if (!facility || !blueprints.isIndustryFacilityType(facility.typeID)) return false;
  const creationRuntime = require("./creationRuntime");
  if (Number(facility.flagID) !== Number(creationRuntime.CREATION_FITTING_FLAG_ID)) return false;
  const host = itemStore.findItemById(Number(facility.locationID));
  const state = creationRuntime.readCreationState(host);
  return host && state && Array.isArray(state.modules) && state.modules.some(module =>
    Number(module?.itemID) === Number(facility.itemID) &&
    Number(module?.typeID) === Number(facility.typeID))
    ? state
    : null;
}

function online(facility) {
  const creationState = getCreationHostedFacilityState(facility);
  if (creationState) {
    return creationState.poweredOff !== true &&
      require("./creationRuntime").isCreationModuleOnline(facility);
  }
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
function getProductionRecipe(facility, production, requestedLaneID = 1) {
  const numericLaneID = laneID(requestedLaneID);
  const info = industryInfo(facility);
  const saved = rawLane(info, numericLaneID)?.productionRecipe ??
    (numericLaneID === 1 ? info?.productionRecipe : null);
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
function planInputs(facility, blueprint, requestedLaneID = 1) {
  const inputs = rows(facility, inputFlag(requestedLaneID));
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
function outputCapacity(facility, blueprint, runs = 1, requestedLaneID = 1) {
  const totals = totalByType(rows(facility, outputFlag(requestedLaneID)));
  if (!totals) return false;
  return Object.entries<any>(blueprint.outputs).every(([typeID, slot]) => {
    const total = (totals[typeID] || 0) + slot.quantity_per_run * runs;
    return integer(total) && total <= slot.max_storable_quantity;
  });
}
function productionData(facility, changes = [], events = [], requestedLaneID = 1) {
  return {
    facility,
    laneID: laneID(requestedLaneID) || 1,
    production: getProduction(facility, requestedLaneID),
    productions: getProductions(facility),
    changes,
    events,
  };
}
function commit(facility, production, consumptions = [], outputs = [], recipe = null,
  requestedLaneID = 1) {
  const result = itemStore.commitInventoryProduction({ facilityID: facility.itemID,
    expectedCustomInfo: facility.customInfo,
    customInfo: withProduction(facility, production, recipe, requestedLaneID),
    inputFlag: inputFlag(requestedLaneID), outputFlag: outputFlag(requestedLaneID),
    consumptions, outputs });
  return result.success ? { success: true as const,
    data: productionData(result.data.facility, result.data.changes, [], requestedLaneID) } : result;
}
function event(type, production, timestampMs, requestedLaneID = 1) {
  return { type, production: { ...production }, timestampMs,
    laneID: laneID(requestedLaneID) || 1,
    ...(production.stopReason ? { stopReason: production.stopReason } : {}) };
}

function startProduction(session, facilityID, blueprintID, hash, runs = null,
  options: Record<string, any> = {}) {
  const requestedLaneID = laneID(options?.laneID);
  if (!requestedLaneID) return fail("INVALID_JOB_LANE");
  const access = require("./industryRuntime").validateFacility(session, facilityID, {
    ...options,
    laneID: requestedLaneID,
  });
  if (!access.success) return access;
  const { facility } = access.data;
  if (requestedLaneID > getFacilityLaneCount(facility)) return fail("INVALID_JOB_LANE");
  if (invalidStoredProduction(facility)) return fail("INVALID_PRODUCTION_STATE");
  const previous = getProduction(facility, requestedLaneID);
  if (previous && previous.state !== "STOPPED") return fail("PRODUCTION_ALREADY_RUNNING");
  if (!online(facility)) return fail("FACILITY_OFFLINE");
  const blueprint = blueprints.getSelectedBlueprint(facility, requestedLaneID);
  if (!blueprint || Number(blueprintID) !== blueprint.blueprint_id) return fail("BLUEPRINT_NOT_LOADED");
  if (typeof hash !== "string" || !blueprint.content_hash || hash !== blueprint.content_hash) return fail("INVALID_BLUEPRINT_HASH");
  if (!validateBlueprint(blueprint) || blueprints.getBlueprintContentHash(blueprint) !== blueprint.content_hash) return fail("BLUEPRINT_NOT_FOUND");
  if (runs !== null && (typeof runs !== "number" && typeof runs !== "bigint" && typeof runs !== "string")) return fail("INVALID_RUN_COUNT");
  const requestedRuns = runs === null ? null : Number(runs);
  if (requestedRuns !== null && !integer(requestedRuns, 1)) return fail("INVALID_RUN_COUNT");
  const nowMs = currentTime(options);
  const jobID = Math.max(0, ...getProductions(facility)
    .map(({ production }) => Number(production?.jobID) || 0)) + 1;
  if (nowMs === null || !integer(nowMs + blueprint.run_time * 1000) || !integer(jobID, 1)) return fail("INVALID_PRODUCTION_TIME");
  if (!outputCapacity(facility, blueprint, 1, requestedLaneID)) return fail("OUTPUT_CAPACITY_EXCEEDED");
  const consumptions = planInputs(facility, blueprint, requestedLaneID);
  if (!consumptions) return fail("INSUFFICIENT_INPUTS");
  const executorKey = options.executorKey == null
    ? null : String(options.executorKey).trim();
  if (executorKey && (executorKey.length > 192 ||
      !/^[A-Za-z0-9._:/-]+$/u.test(executorKey))) return fail("INVALID_PRODUCTION_EXECUTOR");
  const production = { version: 1, jobID, state: "RUNNING", requestedRuns, completedRuns: 0,
    runStartedAtMs: nowMs, runEndAtMs: nowMs + blueprint.run_time * 1000, stopReason: null,
    ...(executorKey ? { executorKey } : {}) };
  const result = commit(facility, production, consumptions, [], blueprint, requestedLaneID);
  if (result.success) result.data.events.push(event("started", production, nowMs, requestedLaneID));
  return result;
}

function advanceProduction(facilityID, options: Record<string, any> = {}) {
  let facility = itemStore.findItemById(Number(facilityID));
  if (!facility || !blueprints.isIndustryFacilityType(facility.typeID)) return fail("FACILITY_NOT_FOUND");
  if (invalidStoredProduction(facility)) return fail("INVALID_PRODUCTION_STATE");
  const nowMs = currentTime(options);
  if (nowMs === null) return fail("INVALID_PRODUCTION_TIME");
  const selectedLaneID = options?.laneID == null ? 1 : laneID(options.laneID, 0);
  if (!selectedLaneID) return fail("INVALID_JOB_LANE");
  const lanes = options?.laneID == null ? storedLaneIDs(facility) : [selectedLaneID];
  const changes: any[] = [];
  const events: any[] = [];
  const failed = errorMsg => fail(errorMsg,
    productionData(facility, changes, events, selectedLaneID));
  const advanceStartedAt = performance.now();
  let advancedRuns = 0;
  for (const currentLaneID of lanes) {
    while (advancedRuns < MAX_ADVANCE_RUNS) {
      if (advancedRuns > 0 && performance.now() - advanceStartedAt >= MAX_ADVANCE_MS) break;
      const current = getProduction(facility, currentLaneID);
      if (!current || current.state === "STOPPED" || current.runEndAtMs > nowMs) break;
      // Preserve the paid recipe across server/static-data upgrades. Its products
      // belong to this run even if the newly authored recipe has changed.
      const blueprint = getProductionRecipe(facility, current, currentLaneID);
      if (!blueprint) return failed("INVALID_PRODUCTION_STATE");
      const selected = blueprints.getSelectedBlueprint(facility, currentLaneID);
      // Each running record has already paid for exactly one run. Keep it pending
      // if external changes occupied its reserved output space; never lose it.
      if (!outputCapacity(facility, blueprint, 1, currentLaneID)) return failed("OUTPUT_CAPACITY_EXCEEDED");
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
        if (!outputCapacity(facility, blueprint, 2, currentLaneID)) stopReason = "OUTPUT_CAPACITY_EXCEEDED";
        else {
          consumptions = planInputs(facility, blueprint, currentLaneID);
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
      const result = commit(facility, production, consumptions, outputs, null, currentLaneID);
      if (!result.success) return failed(result.errorMsg);
      facility = result.data.facility;
      changes.push(...result.data.changes);
      events.push(event(stopReason ? "stopped" : "started", production,
        current.runEndAtMs, currentLaneID));
      advancedRuns += 1;
      if (stopReason) break;
    }
    if (advancedRuns >= MAX_ADVANCE_RUNS || performance.now() - advanceStartedAt >= MAX_ADVANCE_MS) break;
  }
  return { success: true as const,
    data: productionData(facility, changes, events, selectedLaneID) };
}

function discontinueProduction(session, facilityID, options: Record<string, any> = {}) {
  const requestedLaneID = laneID(options?.laneID);
  if (!requestedLaneID) return fail("INVALID_JOB_LANE");
  const access = require("./industryRuntime").validateFacility(session, facilityID, {
    ...options,
    laneID: requestedLaneID,
  });
  if (!access.success) return access;
  const { facility } = access.data;
  if (requestedLaneID > getFacilityLaneCount(facility)) return fail("INVALID_JOB_LANE");
  if (invalidStoredProduction(facility)) return fail("INVALID_PRODUCTION_STATE");
  const current = getProduction(facility, requestedLaneID);
  if (!current || current.state === "STOPPED") return fail("PRODUCTION_NOT_RUNNING");
  if (currentTime(options) === null) return fail("INVALID_PRODUCTION_TIME");
  if (current.state === "DISCONTINUING") return advanceProduction(facilityID, {
    ...options,
    laneID: requestedLaneID,
  });
  const result = commit(facility, { ...current, state: "DISCONTINUING" }, [], [], null,
    requestedLaneID);
  if (!result.success) return result;
  const advanced = advanceProduction(facilityID, { ...options, laneID: requestedLaneID });
  if (advanced.data) advanced.data.changes.unshift(...result.data.changes);
  return advanced;
}

module.exports = {
  configuredLaneCount,
  configuredLaneCountForType,
  getFacilityLaneCount,
  getProduction,
  getProductions,
  getJobLanes,
  hasActiveProduction,
  invalidStoredProduction,
  getLaneAccessPolicy,
  canUseLane,
  setLaneAccessPolicy,
  startProduction,
  discontinueProduction,
  advanceProduction,
};
