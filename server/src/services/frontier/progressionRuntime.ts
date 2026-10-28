"use strict";

const { createHash } = require("crypto");
const catalog = require("./progressionCatalog3640684.json");
const { buildDict, buildList } = require("../_shared/serviceHelpers");
const TABLE = "frontierProgressionState";
const clone = value => value == null ? value : JSON.parse(JSON.stringify(value));
const positive = value => Number.isSafeInteger(Number(value)) && Number(value) > 0;
const failure = errorMsg => ({ success: false as const, errorMsg });
const filetime = milliseconds => BigInt(Math.trunc(milliseconds)) * 10000n + 116444736000000000n;
const skillIDs = new Set(catalog.skills.map(skill => skill.skill_id));
const traitTypes = { heat: 93596, feralization: 95342, temporal_drift: 96034 };
const typeByID = new Map(catalog.types.map(type => [type.typeID, type]));

function marshalMap(value, numericKeys = false) {
  return buildDict(Object.entries(value || {}).map(([key, val]) => [numericKeys ? Number(key) : key, val]));
}
function complexity(state, shellID) {
  const inherited = {}, acquired = {}, vault = {};
  for (const memory of Object.values<any>(state.memories)) {
    const bucket = memory.ownerKind === "vault" ? vault :
      memory.ownerKind === "shell" && memory.ownerID === shellID ? acquired :
      memory.ownerKind === "crown" && state.crowns[memory.ownerID]?.shellID === shellID ? inherited : null;
    if (bucket) for (const [id, value] of Object.entries<any>(memory.depth || {})) bucket[id] = (bucket[id] || 0) + value;
  }
  return { inherited, acquired, vault };
}
function marshalSplit(value) { return buildDict([["inherited", marshalMap(value.inherited, true)], ["acquired", marshalMap(value.acquired, true)]]); }
function marshalMemory(memory) {
  return buildDict([["type_id", memory.typeID], ["primary_pathways", marshalMap(memory.primaryPathways, true)],
    ["secondary_pathways", marshalMap(memory.secondaryPathways, true)], ["depth", marshalMap(memory.depth, true)],
    ["date_created", filetime(memory.createdAtMs)], ["found_by_shell_id", memory.foundByShellName || String(memory.foundByShellID)]]);
}
function memoriesResponse(state, kind, ownerID) {
  const own = [], crown = [];
  for (const memory of Object.values<any>(state.memories)) {
    if (memory.ownerKind === kind && (kind === "vault" || memory.ownerID === ownerID)) own.push([memory.memoryID, marshalMemory(memory)]);
    if (kind === "shell" && memory.ownerKind === "crown" && state.crowns[memory.ownerID]?.shellID === ownerID) crown.push([memory.memoryID, marshalMemory(memory)]);
  }
  return buildDict([["shell_memories", buildDict(own)], ["crown_memories", buildDict(crown)]]);
}
function medicalBreakdown(medical) {
  return Object.entries<any>(medical?.traits || {}).filter(([, points]) => points > 0).map(([effect, points]) =>
    [effect, (typeByID.get(traitTypes[effect]) as any)?.name || effect, Math.round(points), Math.ceil(points)]);
}

/** Dependencies are injectable; all inventory and owner-state mutations share one commit. */
function createProgressionRuntime(options: Record<string, any>) {
  const repo = options.repo, now = options.now || Date.now;
  function readKey(key) { const result = repo.read(TABLE, `/${key}`); return result?.success ? clone(result.data) : null; }
  function state(characterID) {
    if (!positive(characterID)) throw new Error("CHARACTER_REQUIRED");
    const ensured = repo.ensureTable(TABLE);
    if (ensured?.success === false) throw new Error("PROGRESSION_STORE_UNAVAILABLE");
    return readKey(`c:${characterID}`) || { version: 1, characterID: Number(characterID), revision: 0, totalXP: 0, categoryXP: { 1: 0, 2: 0, 3: 0, 4: 0 }, memories: {}, crowns: {}, medical: {}, lastCrownAtMs: null, ascensions: 0, achievements: {}, uploads: {} };
  }
  function proposal(next) { next.revision += 1; return repo.prepareAtomicRowWrite(TABLE, `c:${next.characterID}`, next); }
  function commit(next, rows = []) {
    try { const result = repo.commitAtomicRowWrites([proposal(next), ...rows]); return result?.success ? { success: true as const, data: next } : failure(result?.errorMsg || "ATOMIC_WRITE_ERROR"); }
    catch (_) { return failure("ATOMIC_WRITE_ERROR"); }
  }
  function policy() { return options.policy?.() || {}; }
  function active(characterID) { return options.activeShell(characterID); }
  function getState(characterID) { return state(characterID); }
  function notify(session, event, args = []) { if (typeof session?.sendNotification === "function") session.sendNotification(event, "charid", args); }
  function characterID(session) { return Number(session?.characterID || session?.charid || session?.charID); }
  function changed(session, next, deltas = {}) {
    notify(session, "OnSkillsUpdated", [marshalSplit(complexity(next, Number(active(next.characterID)?.itemID))), buildDict(Object.entries(deltas).map(([id, values]) => [Number(id), marshalMap(values, true)]))]);
    options.refreshDogma?.(session);
  }
  function inventoryRequest(session) {
    const id = characterID(session), dock = Number(session?.stationid || session?.stationID || session?.structureid || session?.structureID) || 0;
    const ship = Number(session?.shipid || session?.shipID) || 0;
    return { characterID: id, sourceLocationIDs: [id, dock, ship, Number(active(id)?.itemID)].filter(positive),
      sourceFlagIDs: [4, 5, 89], accessibleLocationIDs: dock > 0 ? [dock] : [], dock, ship };
  }
  function inventoryCommit(session, request, rowFactory) {
    const result = options.inventoryAtomic({ ...request,
      getDestinationCapacity: info => options.destinationCapacity?.(session, request, info) }, staged => rowFactory(staged));
    if (result?.success) options.syncInventory?.(session, result.data.changes);
    return result || failure("ATOMIC_WRITE_ERROR");
  }
  function recordActivity(session, event) {
    const id = characterID(session), shell = active(id), rule = policy().activityWeights?.[event?.eventKind];
    if (!shell || !rule || !positive(rule.memoryCategoryID) || rule.memoryCategoryID > 12 || !Number.isFinite(rule.xpPerUnit) || rule.xpPerUnit <= 0) return failure("ACTIVITY_POLICY_UNAVAILABLE");
    if (typeof event.eventID !== "string" || !event.eventID.length || event.eventID.length > 512 || !Number.isFinite(event.amount) || event.amount <= 0 || event.amount > 1e12) return failure("INVALID_ACTIVITY");
    const weights = Object.entries<any>(rule.skillWeights || {});
    if (!weights.length || weights.some(([key, value]) => !skillIDs.has(Number(key)) || !Number.isFinite(value) || value <= 0)) return failure("INVALID_ACTIVITY_POLICY");
    const next = state(id), receiptKey = `e:${id}:${createHash("sha256").update(event.eventID).digest("hex")}`;
    if (readKey(receiptKey)) return { success: true as const, duplicate: true, data: next };
    const xp = event.amount * rule.xpPerUnit;
    if (!Number.isFinite(xp) || !Number.isFinite(next.totalXP + xp)) return failure("INVALID_ACTIVITY");
    let memory = Object.values<any>(next.memories).find(row => row.ownerKind === "shell" && row.ownerID === shell.itemID && row.typeID === rule.memoryCategoryID);
    const created = !memory;
    if (!memory) {
      const memoryID = options.allocateID();
      memory = { memoryID, typeID: rule.memoryCategoryID, ownerKind: "shell", ownerID: shell.itemID, depth: {}, primaryPathways: {}, secondaryPathways: {}, createdAtMs: now(), foundByShellID: shell.itemID, foundByShellName: shell.itemName };
      next.memories[memoryID] = memory;
    }
    const deltas = {};
    for (const [skillID, weight] of weights) {
      deltas[skillID] = xp * catalog.constants.conversionRate * weight;
      memory.depth[skillID] = (memory.depth[skillID] || 0) + deltas[skillID];
    }
    next.totalXP += xp;
    next.categoryXP[rule.memoryCategoryID] = (next.categoryXP[rule.memoryCategoryID] || 0) + xp;
    const completed = [];
    for (const objective of policy().cycleObjectives || []) {
      if (objective.eventKind !== event.eventKind || typeof objective.id !== "string" || !objective.id || !Number.isFinite(objective.target) || objective.target <= 0) continue;
      const row = next.achievements[objective.id] || { progress: 0, completedAtMs: null };
      if (row.completedAtMs != null) continue;
      row.progress = Math.min(objective.target, row.progress + event.amount);
      if (row.progress >= objective.target) { row.completedAtMs = now(); completed.push({ id: objective.id, message: String(objective.message || objective.id) }); }
      next.achievements[objective.id] = row;
    }
    const result = commit(next, [repo.prepareAtomicRowWrite(TABLE, receiptKey, { eventID: event.eventID, eventKind: event.eventKind, atMs: now() })]);
    if (!result.success) return result;
    if (created) notify(session, "OnMemoryCardPurchased", [shell.itemID, memory.memoryID, memory.typeID, marshalMap(memory.primaryPathways, true), marshalMap(memory.secondaryPathways, true)]);
    changed(session, next, created ? {} : { [memory.memoryID]: deltas });
    for (const entry of completed) options.publishNotice?.(session, "eve_public.achievement.CompletedNotice", { message: entry.message });
    return result;
  }
  function deleteMemory(session, memoryID, ownerType) {
    const id = characterID(session), next = state(id), memory = next.memories[Number(memoryID)], shellID = Number(active(id)?.itemID);
    const kind = { 1: "shell", 2: "crown", 3: "vault" }[Number(ownerType)];
    if (!memory || memory.ownerKind !== kind || kind === "shell" && memory.ownerID !== shellID || kind === "crown" && next.crowns[memory.ownerID]?.shellID !== shellID) return failure("MEMORY_NOT_OWNED");
    const ownerID = kind === "vault" ? id : memory.ownerID;
    delete next.memories[Number(memoryID)];
    const result = commit(next);
    if (result.success) { notify(session, "OnMemoryCardDeleted", [Number(memoryID), ownerID]); changed(session, next); }
    return result;
  }
  function selectedMemories(next, ids, kind, ownerID = 0, limit = catalog.constants.crownInjectLimit) {
    if (!Array.isArray(ids) || !ids.length || ids.length > limit || !ids.every(positive) || new Set(ids.map(Number)).size !== ids.length) return null;
    const rows = ids.map(id => next.memories[Number(id)]);
    return rows.every(row => row && row.ownerKind === kind && (!ownerID || row.ownerID === ownerID)) ? rows : null;
  }
  function ascend(session, ids) {
    const id = characterID(session), shell = active(id), next = state(id);
    if (!shell) return failure("SHELL_NOT_FOUND");
    // AscensionIntegration._commit_move_all moves all movable shell cards;
    // the six-card limit belongs only to CrownWeaveController.
    const selected = selectedMemories(next, ids, "shell", shell.itemID, 27);
    if (!selected) return failure("INVALID_ASCENSION_SELECTION");
    for (const memory of selected) { memory.ownerKind = "vault"; memory.ownerID = id; }
    next.ascensions += 1;
    const result = commit(next);
    if (result.success) { notify(session, "OnAscend"); changed(session, next); }
    return result;
  }
  function createCrown(session, ids) {
    const id = characterID(session), next = state(id), request = inventoryRequest(session);
    const selected = selectedMemories(next, ids, "vault");
    if (!selected) return failure("INVALID_CROWN_SELECTION");
    if (next.lastCrownAtMs != null && now() - next.lastCrownAtMs < catalog.constants.crownCreationDelaySeconds * 1000) return failure("CROWN_COOLDOWN");
    const destination = request.dock || request.ship;
    if (!destination) return failure("CROWN_DESTINATION_UNAVAILABLE");
    const result = inventoryCommit(session, { ...request, destinationLocationID: destination, destinationFlagID: request.dock ? 4 : 5,
      grants: [{ typeID: 92437, quantity: 1, singleton: 1, individualItems: true }] }, staged => {
      const crownID = Number(staged.grantedItems[0]?.itemID);
      if (!positive(crownID)) throw new Error("CROWN_CREATION_FAILED");
      for (const memory of selected) { memory.ownerKind = "crown"; memory.ownerID = crownID; }
      next.crowns[crownID] = { crownID, shellID: null, createdAtMs: now() };
      next.lastCrownAtMs = now();
      return [proposal(next)];
    });
    if (result.success) { notify(session, "OnCrownCreated"); changed(session, next); }
    return result;
  }
  function crownMutation(session, crownID, destroy = false) {
    const id = characterID(session), shell = active(id), next = state(id), request = inventoryRequest(session);
    if (!shell) return failure("SHELL_NOT_FOUND");
    const current = Object.values<any>(next.crowns).find(row => row.shellID === shell.itemID);
    if (destroy) crownID = current?.crownID;
    const crown = next.crowns[Number(crownID)], item = options.findItem(Number(crownID));
    if (!crown || !item || item.ownerID !== id || item.typeID !== 92437) return failure("CROWN_NOT_OWNED");
    if (!destroy && (current || crown.shellID != null)) return failure("CROWN_SLOT_OCCUPIED");
    if (destroy) { delete next.crowns[crownID]; for (const memory of Object.values<any>(next.memories)) if (memory.ownerKind === "crown" && memory.ownerID === Number(crownID)) delete next.memories[memory.memoryID]; }
    else crown.shellID = shell.itemID;
    const result = inventoryCommit(session, { ...request, ...(destroy ? { consumptions: [{ itemID: Number(crownID), typeID: 92437, quantity: 1, allowSingleton: true }] } : { moves: [{ itemID: Number(crownID), locationID: shell.itemID, flagID: 89 }] }) }, () => [proposal(next)]);
    if (result.success) { notify(session, "OnCrownImplanted", [destroy ? null : Number(crownID), shell.itemID]); changed(session, next); }
    return result;
  }
  function activateShell(session, shellID, nestID) {
    const id = characterID(session), old = active(id), item = options.findItem(Number(shellID)), request = inventoryRequest(session);
    const nest = options.resolveNest ? options.resolveNest(session, Number(nestID)) : (request.dock && Number(nestID) === request.dock ? { inventoryID: request.dock } : null);
    if (!nest) return failure("INVALID_NEST_LOCATION");
    if (!item || item.ownerID !== id || (typeByID.get(item.typeID) as any)?.categoryID !== 2153 || item.locationID !== nest.inventoryID) return failure("SHELL_NOT_ACCESSIBLE");
    request.sourceLocationIDs.push(nest.inventoryID);
    const next = state(id), moves = [{ itemID: item.itemID, locationID: id, flagID: 4 }];
    if (old) moves.push({ itemID: old.itemID, locationID: nest.inventoryID, flagID: 4 });
    const result = inventoryCommit(session, { ...request, moves }, () => [proposal(next)]);
    if (result.success) { options.resetEnvironment?.(id); changed(session, next); }
    return result;
  }
  function createShell(session, typeID) {
    const id = characterID(session), request = inventoryRequest(session), rule = policy().shellCreation?.[Number(typeID)], type: any = typeByID.get(Number(typeID));
    if (!request.dock) return failure("DOCKING_REQUIRED");
    if (!type || type.categoryID !== 2153 || rule?.enabled !== true || !Array.isArray(rule.materials)) return failure("SHELL_CREATION_POLICY_UNAVAILABLE");
    const consumptions = options.selectMaterials?.(id, request, rule.materials);
    if (!consumptions) return failure("INSUFFICIENT_SHELL_MATERIALS");
    const old = active(id), next = state(id);
    const result = inventoryCommit(session, { ...request, consumptions,
      destinationLocationID: id, destinationFlagID: 4, grants: [{ typeID: Number(typeID), quantity: 1, singleton: 1, individualItems: true }],
      moves: old ? [{ itemID: old.itemID, locationID: request.dock, flagID: 4 }] : [] }, () => [proposal(next)]);
    if (result.success) { options.resetEnvironment?.(id); changed(session, next); }
    return result;
  }
  function saveEnvironment(id, snapshot, damages = {}) {
    const shell = active(id); if (!shell) return failure("SHELL_NOT_FOUND");
    const next = state(id), previous = next.medical[shell.itemID] || { traits: {} };
    const traits = { ...previous.traits };
    for (const [effect, amount] of Object.entries<any>(damages)) if (traitTypes[effect] && Number.isFinite(amount) && amount > 0) traits[effect] = (traits[effect] || 0) + amount;
    const medical = { ...clone(snapshot), traits };
    delete medical.characterID; delete medical.vitalityDamage;
    if (JSON.stringify(previous) === JSON.stringify(medical)) return { success: true as const };
    next.medical[shell.itemID] = medical;
    const result = commit(next);
    return { ...result, implantedEffects: result.success ? Object.keys(damages).filter(key => Math.floor(traits[key] || 0) > Math.floor(previous.traits?.[key] || 0)) : [] };
  }
  function medical(id) { const shell = active(id); return shell ? state(id).medical[shell.itemID] || null : null; }
  function treat(session, itemID, remedy) {
    const id = characterID(session), shell = active(id), item = options.findItem(Number(itemID)), request = inventoryRequest(session);
    if (!shell || !item || item.ownerID !== id) return failure("TREATMENT_ITEM_NOT_OWNED");
    const effect = Object.keys(catalog.constants.remedyTypeIDs).find(key => catalog.constants.remedyTypeIDs[key] === item.typeID);
    if (remedy ? !effect : item.typeID !== catalog.constants.medicalKitTypeID) return failure("INVALID_TREATMENT_ITEM");
    const next = state(id), snapshot = options.environmentSnapshot(id), previous = next.medical[shell.itemID] || { ...snapshot, traits: {} };
    const treated = { ...clone(snapshot), traits: { ...previous.traits } };
    if (remedy) {
      if (!treated.effects?.[effect]?.active && !(treated.traits[effect] > 0) && !(effect === "feralization" && treated.feralization > 0) && !(effect === "temporal_drift" && treated.temporalDrift > 0)) return failure("NO_TREATABLE_EFFECT");
      treated.vitality = Math.min(treated.vitalityCapacity, treated.vitality + (treated.traits[effect] || 0));
      delete treated.traits[effect];
      treated.effects[effect] = { active: false, armed: false, grace: 0, damageExposureSeconds: 0 };
      if (effect === "feralization") treated.feralization = 0;
      if (effect === "temporal_drift") treated.temporalDrift = 0;
    } else {
      if (treated.vitality >= treated.vitalityCapacity) return failure("NO_TREATABLE_INJURY");
      let remaining = catalog.constants.medicalKitTraitsHealed;
      for (const key of Object.keys(treated.traits)) { const healed = Math.min(remaining, treated.traits[key]); treated.traits[key] -= healed; remaining -= healed; }
      treated.vitality = Math.min(treated.vitalityCapacity, treated.vitality + catalog.constants.medicalKitTraitsHealed);
    }
    treated.cloneDeathTriggered = false;
    next.medical[shell.itemID] = treated;
    const result = inventoryCommit(session, { ...request, consumptions: [{ itemID: Number(itemID), quantity: 1, typeID: item.typeID }] }, () => [proposal(next)]);
    if (result.success) { options.applyEnvironment?.(id, treated, session); notifyMedical(session, treated); }
    return result;
  }
  function notifyMedical(session, value) { notify(session, "OnMedicalTraitShellPointsChanged", [Math.round(value.vitalityCapacity - value.vitality), Math.round(value.vitalityCapacity), buildList(medicalBreakdown(value))]); }
  function isFounder(id) { return (policy().founderCharacterIDs || []).some(value => Number(value) === Number(id)); }
  function recordBroadcast(session, request) {
    const id = characterID(session), next = state(id);
    if (typeof request?.id !== "string" || !request.id || request.id.length > 200 || !["succeeded", "failed"].includes(request.status) || request.reason != null && ![0, 1].includes(request.reason)) return failure("INVALID_UPLOAD_RECEIPT");
    if (next.uploads[request.id]) return { success: true as const, duplicate: true };
    next.uploads[request.id] = { status: request.status, reason: Number(request.reason || 0), atMs: now() };
    const result = commit(next);
    if (result.success) options.publishNotice?.(session, `eve_public.broadcast.api.Upload${request.status === "succeeded" ? "Succeeded" : "Failed"}Notice`, request.status === "succeeded" ? {} : { reason: Number(request.reason || 0) });
    return result;
  }
  return { getState, recordActivity, deleteMemory, ascend, createCrown, crownMutation, activateShell, createShell,
    saveEnvironment, medical, treat, isFounder, recordBroadcast, notifyMedical, complexity: id => complexity(state(id), Number(active(id)?.itemID)) };
}

let production;
function getRuntime() {
  if (!production) {
    const inventory = require("../inventory/itemStore"), equipment = require("./shellEquipmentRuntime"), database = require("../../gameStore");
    const { createTableRepository } = require("../../gameStore/tableRepository");
    production = createProgressionRuntime({ repo: createTableRepository("service:frontier-progression", { strict: true }),
      policy: () => require("../../config").frontierProgressionPolicy || {},
      activeShell: equipment.getActiveShell, findItem: inventory.findItemById,
      allocateID() { const id = require("../_shared/identityAllocator").reserveItemIDs(1)[0]; if (!database.flushTableSync("identityState").success) throw new Error("IDENTITY_PERSISTENCE_ERROR"); return id; },
      inventoryAtomic: inventory.applyInventoryTransactionWithAtomicRows,
      destinationCapacity(session, request, info) {
        const container = inventory.findItemById(info.locationID);
        if (!container) return NaN;
        if (equipment.isShellItem(container) && Number(info.flagID) === 89 || Number(container.typeID) === 91871 && Number(info.flagID) === 4) {
          // These are validated equipment/shell slots, not general cargo. Their
          // exact transaction contents bound the finite capacity passed to inventory.
          const existing = inventory.listContainerItems(info.locationID, info.flagID);
          const incoming = (request.moves || []).filter(move => move.locationID === info.locationID && move.flagID === info.flagID).map(move => inventory.findItemById(move.itemID));
          return [...existing, ...incoming].reduce((sum, item) => sum + inventory.getInventoryItemUnitVolume(item), 0);
        }
        if (Number(info.locationID) !== Number(session?.shipid || session?.shipID)) return NaN;
        return Number(require("../fitting/liveFittingState").calculateShipDerivedAttributes(request.characterID, container).attributes[38]);
      },
      resolveNest(session, nestID) {
        const id = Number(session?.characterID || session?.charid), nest = inventory.findItemById(nestID);
        if (!nest || Number(nest.typeID) !== 91871 || Number(nest.ownerID) !== id) return null;
        const assembly = require("./deploymentRuntime").getAssemblyRecord(nestID);
        const systemID = Number(session?._space?.systemID);
        if (!assembly || assembly.solarSystemID !== systemID || assembly.assemblyStatus !== require("./deploymentRuntime").ASSEMBLY_STATUS_ONLINE || assembly.activationCompleteAtMs > 0) return null;
        const runtime = require("../../space/runtime"), ship = runtime.getEntity(session, Number(session?.shipid || session?.shipID)), host = runtime.getEntity(session, nestID);
        if (!ship?.position || !host?.position) return null;
        const range = Number(require("../../config").frontierProgressionPolicy?.nestInteractionRangeMeters);
        if (!Number.isFinite(range) || range <= 0) return null;
        const distance = Math.hypot(ship.position.x - host.position.x, ship.position.y - host.position.y, ship.position.z - host.position.z) - Number(ship.radius || 0) - Number(host.radius || 0);
        if (!Number.isFinite(distance) || distance > range) return null;
        return { inventoryID: nestID };
      },
      selectMaterials(id, request, materials) {
        const items = inventory.listCharacterItems(id).filter(item => request.sourceLocationIDs.includes(item.locationID) && request.sourceFlagIDs.includes(item.flagID) && !item.singleton);
        const required = new Map<number, number>();
        for (const entry of materials) { if (!positive(entry.typeID) || !positive(entry.quantity)) return null; required.set(entry.typeID, (required.get(entry.typeID) || 0) + entry.quantity); }
        const selected = [];
        for (const [typeID, quantity] of required) { let remaining = quantity; for (const item of items.filter(row => row.typeID === typeID)) { const take = Math.min(remaining, item.stacksize ?? item.quantity); if (take > 0) selected.push({ itemID: item.itemID, typeID, quantity: take }); remaining -= take; } if (remaining > 0) return null; }
        return selected;
      },
      syncInventory(session, changes) { const { syncInventoryItemForSession } = require("../character/characterState"); for (const change of changes || []) { const item = change.item || { ...change.previousData, quantity: 0, stacksize: 0 }; syncInventoryItemForSession(session, item, change.previousData || {}, { emitCfgLocation: false }); } },
      refreshDogma(session) {
        const id = Number(session?.characterID || session?.charid); require("../character/dogmaInvalidationVersion").bumpDogmaInvalidationVersion(id);
        const systemID = Number(session?._space?.systemID);
        if (systemID > 0) require("../../space/runtime").ensureScene(systemID)?.refreshSessionShipDerivedState?.(session, { notify: true, reason: "frontier-progression" });
      },
      environmentSnapshot: id => require("./environmentalEffectsService").snapshotCharacterState(id),
      resetEnvironment: id => require("./environmentalEffectsService").resetCharacterState(id),
      applyEnvironment: (id, value, session) => require("./environmentalEffectsService").applyMedicalState(id, value, session),
      publishNotice: (session, type, payload) => noticePublisher?.(session, type, payload),
    });
  }
  return production;
}
let noticePublisher;
module.exports = { TABLE, catalog, createProgressionRuntime, getRuntime, filetime, marshalMap, marshalSplit, memoriesResponse, medicalBreakdown,
  setNoticePublisher: callback => { noticePublisher = callback; },
  recordActivity: (session, event) => getRuntime().recordActivity(session, event),
  recordBroadcast: (session, event) => getRuntime().recordBroadcast(session, event) };
