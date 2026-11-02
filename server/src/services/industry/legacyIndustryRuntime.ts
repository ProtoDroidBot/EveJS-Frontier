const config = require("../../config");
const log = require("../../utils/logger");
const { createTableRepository } = require("../../gameStore/tableRepository");
const { throwWrappedUserError, isMachoWrappedException } = require("../../common/machoErrors");
const { buildDict, currentFileTime, unwrapMarshalValue } = require("../_shared/serviceHelpers");
const characterState = require("../character/characterState");
const itemStore = require("../inventory/itemStore");
const {
  isLegacyIndustryProfile,
  getLegacyIndustryRecipeByProductID,
  getLegacyIndustryFactoryByStationID,
} = require("./legacyIndustryStaticData");
const { getFacilityPayloadByID } = require("./industryStaticData");
const {
  resolveIndustryJobTimeSeconds,
} = require("./industryParityHelpers");
const { resolveIndustrySlotContext } = require("./industryRestrictions");
const { notifyIndustryJob } = require("./industryNotifications");
const {
  INDUSTRY_ACTIVITY, INDUSTRY_STATUS, INDUSTRY_JOBS_TABLE,
  ITEM_FLAG_HANGAR, MAX_JOB_LENGTH_SECONDS,
} = require("./industryConstants");

const LEGACY_BUILD = 2703993;
const JOB_ID_START = 970000000000000;
let industryRepository;

function rejectIndustry(message): never {
  throwWrappedUserError("CustomNotify", { notify: message });
  throw new Error(message);
}

// Unexpected persistence/catalog failures must reach the client as errors:
// the dispatcher otherwise turns an ordinary exception into a None response.
function guarded<T>(operation: () => T): T {
  try { return operation(); }
  catch (error) {
    if (isMachoWrappedException(error)) throw error;
    log.warn(`[LegacyIndustry] ${String(error?.code || error?.message || "operation failed")}`);
    return rejectIndustry("The industry operation could not be committed. Please try again.");
  }
}

function repository() {
  industryRepository ||= createTableRepository("service:industry", { strict: true });
  return industryRepository;
}

function clone(value) { return JSON.parse(JSON.stringify(value)); }

function integer(value, minimum = 1) {
  const unwrapped = unwrapMarshalValue(value);
  const result = typeof unwrapped === "bigint" ? Number(unwrapped) : unwrapped;
  if (typeof result !== "number" || !Number.isSafeInteger(result) || result < minimum) {
    return rejectIndustry("The industry request contains an invalid number.");
  }
  return result;
}

function assertLegacyIndustryProfile(session = null) {
  if (!isLegacyIndustryProfile({
    clientBuild: config.clientBuild,
    clientCompatibilityProfile: session?.compatibilityProfile ?? config.clientCompatibilityProfile,
  })) rejectIndustry("This station industry API is unavailable for this client profile.");
}

function selectedCharacter(session) {
  assertLegacyIndustryProfile(session);
  const ids = [session?.characterID, session?.charID, session?.charid]
    .filter(value => value !== undefined && value !== null)
    .map(value => integer(value, 0)).filter(id => id > 0);
  if (!ids.length || ids.some(id => id !== ids[0]) ||
      session?._characterControlDisconnected === true || session?.socket?.destroyed) {
    return rejectIndustry("Industry requires a selected character session.");
  }
  const accountID = integer(session?.userid);
  const record = characterState.getCharacterRecord(ids[0]);
  if (!record || Number(record.accountId ?? record.accountID ?? record.userid ?? record.userID) !== accountID) {
    return rejectIndustry("That character is unavailable on this account.");
  }
  return { characterID: ids[0], record };
}

function currentFactory(session, selected) {
  const stationIDs = [session?.stationID, session?.stationid]
    .filter(value => value !== undefined && value !== null)
    .map(value => integer(value, 0)).filter(id => id > 0);
  const stationID = Number(selected.record.stationID ?? selected.record.stationid);
  if (!stationIDs.length || !Number.isSafeInteger(stationID) || stationID <= 0 ||
      stationIDs.some(id => id !== stationID)) {
    return rejectIndustry("You must be docked at an NPC factory to use station industry.");
  }
  const factory = getLegacyIndustryFactoryByStationID(stationID);
  if (!factory) return rejectIndustry("This station does not provide manufacturing.");
  return factory;
}

function jobsTable() {
  const result = repository().read(INDUSTRY_JOBS_TABLE, "/");
  if (!result?.success || !result.data || typeof result.data !== "object" || Array.isArray(result.data)) {
    return rejectIndustry("The industry job store is unavailable.");
  }
  const payload = clone(result.data);
  if (payload.jobs === undefined) payload.jobs = {};
  if (!payload.jobs || typeof payload.jobs !== "object" || Array.isArray(payload.jobs)) {
    return rejectIndustry("The industry job store is invalid.");
  }
  if (payload._meta === undefined) payload._meta = {};
  if (!payload._meta || typeof payload._meta !== "object" || Array.isArray(payload._meta)) {
    return rejectIndustry("The industry job counter is invalid.");
  }
  return payload;
}

function isLegacyIndustryJob(job) {
  return job?.legacyFrontierBuild === LEGACY_BUILD;
}

function projectJob(job) {
  const projected = clone(job);
  if (projected.status === INDUSTRY_STATUS.INSTALLED && BigInt(projected.endDate) <= currentFileTime()) {
    projected.status = INDUSTRY_STATUS.READY;
  }
  return projected;
}

function ownedJob(table, jobID, characterID) {
  const job = table.jobs[String(integer(jobID))];
  if (!isLegacyIndustryJob(job) || job.ownerID !== characterID || job.installerID !== characterID) {
    return rejectIndustry("That industry job is unavailable to this character.");
  }
  return job;
}

function getLegacyIndustryJobByID(jobID, session) {
  return guarded(() => {
    const selected = selectedCharacter(session);
    return projectJob(ownedJob(jobsTable(), jobID, selected.characterID));
  });
}

function listLegacyIndustryJobsByOwner(session, ownerID, includeCompleted = false) {
  return guarded(() => {
    const selected = selectedCharacter(session);
    if (integer(ownerID) !== selected.characterID) rejectIndustry("That industry owner is unavailable to this character.");
    const completed = unwrapMarshalValue(includeCompleted);
    if (completed !== true && completed !== false && completed !== 0 && completed !== 1) {
      rejectIndustry("The industry job filter is invalid.");
    }
    return Object.values<any>(jobsTable().jobs)
      .filter(job => isLegacyIndustryJob(job) && job.ownerID === selected.characterID && job.installerID === selected.characterID)
      .map(projectJob)
      .filter(job => Boolean(completed) || job.status < INDUSTRY_STATUS.COMPLETED)
      .sort((a, b) => a.jobID - b.jobID);
  });
}

function monitorLocationFields(value) {
  const location = unwrapMarshalValue(value);
  if (!location || typeof location !== "object" || Array.isArray(location)) {
    return rejectIndustry("The manufacturing material location is invalid.");
  }
  if (Object.prototype.hasOwnProperty.call(location, "itemID")) return location;
  // Generic pass-by-value objects may have been unwrapped by the shared job
  // parser already. Read their state; identity/access still comes from the
  // authenticated character and factory, never from the object's class name.
  const states: any[] = [];
  if (Array.isArray(location.dict) && location.dict.length) {
    if (location.dict.some(entry => !Array.isArray(entry) || entry.length !== 2)) {
      return rejectIndustry("The manufacturing material location is invalid.");
    }
    states.push(Object.fromEntries(location.dict));
  }
  if (Array.isArray(location.header)) {
    for (const entry of [location.header[1], location.header[2]]) {
      if (entry && typeof entry === "object" && !Array.isArray(entry) && Object.keys(entry).length) states.push(entry);
    }
  }
  if (states.length !== 1 || !Object.prototype.hasOwnProperty.call(states[0], "itemID")) {
    return rejectIndustry("The manufacturing material location is invalid.");
  }
  return states[0];
}

function getLegacyIndustryMonitorContext(session, request) {
  return guarded(() => {
    const selected = selectedCharacter(session);
    const factory = currentFactory(session, selected);
    const raw = unwrapMarshalValue(request?.rawRequest ?? request);
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) rejectIndustry("The manufacturing material request is invalid.");
    const productTypeID = raw.productTypeID == null ? 0 : integer(raw.productTypeID, 0);
    const blueprintTypeID = raw.blueprintTypeID == null ? 0 : integer(raw.blueprintTypeID, 0);
    const recipe = getLegacyIndustryRecipeByProductID(productTypeID || blueprintTypeID);
    if (!recipe || (productTypeID && productTypeID !== recipe.productTypeID) ||
        (blueprintTypeID && blueprintTypeID !== recipe.blueprintTypeID)) {
      rejectIndustry("This product has no supported station manufacturing recipe.");
    }
    const providedID = (object, field, expected) => {
      if (object[field] != null && integer(object[field]) !== expected) {
        rejectIndustry("The manufacturing material request does not match your current station hangar.");
      }
    };
    providedID(raw, "ownerID", selected.characterID);
    providedID(raw, "characterID", selected.characterID);
    providedID(raw, "facilityID", factory.facilityID);
    providedID(raw, "solarSystemID", factory.solarSystemID);
    providedID(raw, "activityID", INDUSTRY_ACTIVITY.MANUFACTURING);
    if (raw.account != null) {
      const account = unwrapMarshalValue(raw.account);
      if (!Array.isArray(account) || account.length !== 2 || integer(account[0]) !== selected.characterID || integer(account[1]) !== 1000) {
        rejectIndustry("The manufacturing material account is invalid.");
      }
    }
    if (raw.inputLocation != null) {
      const location = monitorLocationFields(raw.inputLocation);
      if (integer(location.itemID) !== factory.facilityID || integer(location.ownerID) !== selected.characterID ||
          integer(location.flagID, 0) !== ITEM_FLAG_HANGAR || location.canView === false || location.canTake === false) {
        rejectIndustry("Materials must come from your personal station hangar.");
      }
      providedID(location, "typeID", factory.typeID);
      providedID(location, "solarSystemID", factory.solarSystemID);
    }
    return { ownerID: selected.characterID, stationID: factory.facilityID,
      productTypeID: recipe.productTypeID, blueprintTypeID: recipe.blueprintTypeID };
  });
}

function getLegacyIndustryAvailableMaterials(session, request) {
  return guarded(() => {
    const context = getLegacyIndustryMonitorContext(session, request);
    const materials: Record<string, number> = {};
    for (const item of itemStore.listContainerItems(context.ownerID, context.stationID, ITEM_FLAG_HANGAR)) {
      if (Number(item.singleton) !== 0 || itemStore.isFreeStationFuelSupplyItem(item)) continue;
      const typeID = Number(item.typeID), quantity = Number(item.stacksize ?? item.quantity);
      if (!Number.isSafeInteger(typeID) || typeID <= 0 || !Number.isSafeInteger(quantity) || quantity <= 0) {
        rejectIndustry("The material inventory is invalid.");
      }
      const total = (materials[typeID] || 0) + quantity;
      if (!Number.isSafeInteger(total)) rejectIndustry("The material inventory quantity is too large.");
      materials[typeID] = total;
    }
    return materials;
  });
}

function rowsForJob(table, job) {
  const nextJobs = { ...table.jobs, [String(job.jobID)]: clone(job) };
  const meta = { ...table._meta, version: 1, lastUpdatedAt: new Date().toISOString() };
  return [
    repository().prepareAtomicRowWrite(INDUSTRY_JOBS_TABLE, "jobs", nextJobs),
    repository().prepareAtomicRowWrite(INDUSTRY_JOBS_TABLE, "_meta", meta),
  ];
}

function afterCommit(session, job, changes: any[] = []) {
  // Notifications cannot turn a committed install/delivery into a reported
  // failure that encourages the client to submit the same mutation again.
  const notify = operation => {
    try { operation(); }
    catch (error) { log.warn(`[LegacyIndustry] committed notification failed: ${String(error?.message || error)}`); }
  };
  for (const change of changes) notify(() => {
    const item = change.removed
      ? itemStore.buildRemovedItemNotificationState(change.previousData || change.item) : change.item;
    if (item) characterState.emitItemsChangedForSession(session, item, change.previousData || change.previousState || {});
  });
  const monitors = session?._legacyIndustryMonitors;
  if (monitors instanceof Map && typeof session.sendNotification === "function") {
    for (const [monitorID, context] of monitors) {
      if (context?.ownerID !== job.ownerID || context.stationID !== job.stationID) continue;
      notify(() => {
        const materials = getLegacyIndustryAvailableMaterials(session, {
          ownerID: context.ownerID, facilityID: context.stationID,
          productTypeID: context.productTypeID, blueprintTypeID: context.blueprintTypeID,
          inputLocation: { itemID: context.stationID, ownerID: context.ownerID, flagID: ITEM_FLAG_HANGAR },
        });
        session.sendNotification("OnIndustryMaterials", "clientID", [monitorID,
          buildDict(Object.entries(materials).map(([typeID, quantity]) => [Number(typeID), quantity]))]);
      });
    }
  }
  notify(() => notifyIndustryJob(projectJob(job)));
}

function scaledEntries(entries, runs) {
  return entries.map(entry => {
    const quantity = entry.quantity * runs;
    if (!Number.isSafeInteger(quantity) || quantity <= 0) rejectIndustry("The industry quantity is too large.");
    return { typeID: entry.typeID, quantity };
  });
}

function validatedJobProducts(job) {
  const productTypeID = integer(job.productTypeID);
  const blueprintTypeID = integer(job.blueprintTypeID);
  const runs = integer(job.runs);
  const recipe = getLegacyIndustryRecipeByProductID(productTypeID);
  if (!recipe || blueprintTypeID !== productTypeID || recipe.blueprintTypeID !== blueprintTypeID ||
      runs > recipe.maxProductionLimit || !Array.isArray(job.legacyProducts)) {
    rejectIndustry("The industry output receipt does not match its source recipe.");
  }
  const expected = scaledEntries(recipe.products, runs);
  const products = job.legacyProducts.map(entry => ({ typeID: integer(entry?.typeID), quantity: integer(entry?.quantity) }));
  if (products.length !== expected.length || products.some((entry, index) =>
    entry.typeID !== expected[index].typeID || entry.quantity !== expected[index].quantity)) {
    rejectIndustry("The industry output receipt does not match its source recipe.");
  }
  return products;
}

function materialConsumptions(characterID, stationID, materials) {
  const stock = itemStore.listContainerItems(characterID, stationID, ITEM_FLAG_HANGAR)
    .filter(item => Number(item.singleton) === 0 && !itemStore.isFreeStationFuelSupplyItem(item))
    .sort((a, b) => a.itemID - b.itemID);
  const consumptions: any[] = [];
  for (const material of materials) {
    let remaining = material.quantity;
    for (const item of stock) {
      if (Number(item.typeID) !== material.typeID || remaining === 0) continue;
      const available = Number(item.stacksize ?? item.quantity);
      if (!Number.isSafeInteger(available) || available <= 0) rejectIndustry("The material inventory is invalid.");
      const quantity = Math.min(remaining, available);
      consumptions.push({ itemID: item.itemID, quantity, expected: {
        ownerID: characterID, locationID: stationID, flagID: ITEM_FLAG_HANGAR, typeID: material.typeID,
      } });
      remaining -= quantity;
    }
    if (remaining > 0) rejectIndustry("There are not enough materials in your station hangar.");
  }
  return consumptions;
}

function installLegacyIndustryJob(session, productTypeID, requestedRuns) {
  return guarded(() => {
    const selected = selectedCharacter(session);
    const factory = currentFactory(session, selected);
    const recipe = getLegacyIndustryRecipeByProductID(integer(productTypeID));
    if (!recipe) rejectIndustry("This product has no supported station manufacturing recipe.");
    const runs = integer(requestedRuns);
    if (runs > recipe.maxProductionLimit) rejectIndustry("The requested number of runs exceeds this recipe's limit.");
    const table = jobsTable();
    const counts: Record<string, number> = {};
    for (const job of Object.values<any>(table.jobs)) {
      if (Number(job.installerID) === selected.characterID && Number(job.status) < INDUSTRY_STATUS.COMPLETED) {
        counts[job.activityID] = (counts[job.activityID] || 0) + 1;
      }
    }
    if (resolveIndustrySlotContext(INDUSTRY_ACTIVITY.MANUFACTURING, selected.characterID, counts).full) {
      rejectIndustry("All of your manufacturing job slots are in use.");
    }
    const skillMap = require("../skills/skillState").getCachedCharacterSkillMap(selected.characterID);
    for (const skill of recipe.skills) {
      const trained = skillMap.get(skill.typeID);
      if (Number(trained?.effectiveSkillLevel ?? trained?.trainedSkillLevel ?? trained?.skillLevel ?? 0) < skill.level) {
        rejectIndustry("You do not have the skills required by this recipe.");
      }
    }
    const facility = getFacilityPayloadByID(factory.facilityID, session);
    if (!facility?.online || !facility.activities?.[INDUSTRY_ACTIVITY.MANUFACTURING]) {
      rejectIndustry("The station's manufacturing service is unavailable.");
    }
    const definition = { ...recipe, activities: { manufacturing: {
      time: recipe.timeSeconds, materials: recipe.materials, products: recipe.products, skills: recipe.skills,
    } } };
    const timeInSeconds = resolveIndustryJobTimeSeconds(definition, INDUSTRY_ACTIVITY.MANUFACTURING,
      runs, 0, facility, selected.characterID, 1, recipe.productTypeID);
    if (!Number.isSafeInteger(timeInSeconds) || timeInSeconds <= 0 || timeInSeconds > MAX_JOB_LENGTH_SECONDS) {
      rejectIndustry("The requested industry job is too long.");
    }
    const materials = scaledEntries(recipe.materials, runs);
    const products = scaledEntries(recipe.products, runs);
    const consumptions = materialConsumptions(selected.characterID, factory.facilityID, materials);
    let jobID = table._meta.nextJobID === undefined ? JOB_ID_START : integer(table._meta.nextJobID);
    jobID = Math.max(JOB_ID_START, jobID);
    while (Object.prototype.hasOwnProperty.call(table.jobs, String(jobID))) jobID = integer(jobID + 1);
    table._meta.nextJobID = integer(jobID + 1);
    const now = currentFileTime();
    const job = {
      legacyFrontierBuild: LEGACY_BUILD,
      activityID: INDUSTRY_ACTIVITY.MANUFACTURING, jobID,
      // Native recipes are products, not invented inventory BPO instances.
      blueprintID: 0, blueprintTypeID: recipe.blueprintTypeID, blueprintCopy: false,
      blueprintLocationID: factory.facilityID, blueprintLocationFlagID: ITEM_FLAG_HANGAR,
      facilityID: factory.facilityID, ownerID: selected.characterID,
      installerID: selected.characterID, completedCharacterID: 0,
      solarSystemID: factory.solarSystemID, stationID: factory.facilityID,
      status: INDUSTRY_STATUS.INSTALLED,
      startDate: now.toString(), endDate: (now + BigInt(timeInSeconds) * 10000000n).toString(), pauseDate: null,
      runs, licensedRuns: 1, successfulRuns: 0, timeInSeconds,
      // Frontier manufacturing consumes materials and time without a wallet
      // installation charge or facility tax.
      cost: 0, tax: 0, totalCost: 0,
      probability: 1, productTypeID: recipe.productTypeID, optionalTypeID: null, optionalTypeID2: null,
      inputLocationID: factory.facilityID, inputFlagID: ITEM_FLAG_HANGAR,
      outputLocationID: factory.facilityID, outputFlagID: ITEM_FLAG_HANGAR,
      materials: Object.fromEntries(materials.map(entry => [String(entry.typeID), entry.quantity])),
      legacyProducts: products,
      legacyRecipeSource: recipe.source, legacyFactorySource: factory.source, legacyIndustryPolicy: recipe.policy,
    };
    const rows = rowsForJob(table, job);
    const result = itemStore.applyInventoryTransactionWithAtomicRows({
      characterID: selected.characterID, consumptions,
      sourceLocationIDs: [factory.facilityID], sourceFlagIDs: [ITEM_FLAG_HANGAR], sourceOwnerIDs: [selected.characterID],
    }, rows);
    if (!result?.success) rejectIndustry(`The industry installation could not be committed (${result?.errorMsg || "write failed"}).`);
    afterCommit(session, job, result.data.changes);
    return { success: true as const, data: projectJob(job) };
  });
}

function completeLegacyIndustryJob(session, jobID) {
  return guarded(() => {
    const selected = selectedCharacter(session);
    const table = jobsTable();
    const job = ownedJob(table, jobID, selected.characterID);
    if (job.status === INDUSTRY_STATUS.DELIVERED) return { success: true as const, data: projectJob(job) };
    if (![INDUSTRY_STATUS.INSTALLED, INDUSTRY_STATUS.READY].includes(job.status) || BigInt(job.endDate) > currentFileTime()) {
      rejectIndustry("This industry job is not ready for delivery.");
    }
    const factory = currentFactory(session, selected);
    if (factory.facilityID !== job.stationID || job.outputLocationID !== job.stationID || job.outputFlagID !== ITEM_FLAG_HANGAR) {
      rejectIndustry("You must collect this job at its station factory.");
    }
    const products = validatedJobProducts(job);
    const delivered = { ...job, status: INDUSTRY_STATUS.DELIVERED, completedCharacterID: selected.characterID,
      successfulRuns: job.runs, completedAt: currentFileTime().toString() };
    const result = itemStore.applyInventoryTransactionWithAtomicRows({
      characterID: selected.characterID, grants: products,
      destinationLocationID: factory.facilityID, destinationFlagID: ITEM_FLAG_HANGAR,
    }, rowsForJob(table, delivered));
    if (!result?.success) rejectIndustry(`The industry delivery could not be committed (${result?.errorMsg || "write failed"}).`);
    afterCommit(session, delivered, result.data.changes);
    return { success: true as const, data: projectJob(delivered) };
  });
}

function cancelLegacyIndustryJob(session, jobID) {
  return guarded(() => {
    const selected = selectedCharacter(session);
    const table = jobsTable();
    const job = ownedJob(table, jobID, selected.characterID);
    if (job.status === INDUSTRY_STATUS.CANCELLED) return { success: true as const, data: projectJob(job) };
    if (![INDUSTRY_STATUS.INSTALLED, INDUSTRY_STATUS.READY].includes(job.status)) {
      rejectIndustry("This industry job cannot be cancelled.");
    }
    // Inputs were consumed at installation. Cancellation creates no products
    // and does not refund inputs.
    const cancelled = { ...job, status: INDUSTRY_STATUS.CANCELLED, cancelledAt: currentFileTime().toString() };
    const result = repository().commitAtomicRowWrites(rowsForJob(table, cancelled));
    if (!result?.success) rejectIndustry("The industry cancellation could not be committed.");
    afterCommit(session, cancelled);
    return { success: true as const, data: projectJob(cancelled) };
  });
}

module.exports = {
  assertLegacyIndustryProfile,
  isLegacyIndustryJob,
  getLegacyIndustryJobByID,
  listLegacyIndustryJobsByOwner,
  getLegacyIndustryMonitorContext,
  getLegacyIndustryAvailableMaterials,
  installLegacyIndustryJob,
  completeLegacyIndustryJob,
  cancelLegacyIndustryJob,
};
