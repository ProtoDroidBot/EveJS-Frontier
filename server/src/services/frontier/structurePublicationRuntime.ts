"use strict";
const itemStore = require("../inventory/itemStore");
const deployment = require("./deploymentRuntime");
const { canEntitiesInteractLocally } = require("../../space/destiny/identity/interactionScope");
const KEY = "evejsFrontierLocationPublication";
const CAIRNS = new Set([88400, 93141]);
function isTransponderStructureType(typeID, dependencies: Record<string, any> = {}) {
  const id = Number(typeID);
  if (CAIRNS.has(id) || id === 88092 || id === 95627 || id === 95677) return true;
  const definitions = (dependencies.deployment || deployment).listAssemblyDefinitions();
  return definitions.some(definition => Number(definition.assemblyTypeID) === id && Boolean(definition.smartGate));
}
function info(item) {
  try { const value = JSON.parse(item?.customInfo || "{}"); return value && typeof value === "object" && !Array.isArray(value) ? value : {}; }
  catch (_) { return {}; }
}
function position(item) {
  const p = item?.spaceState?.position;
  return p && [p.x, p.y, p.z].every(Number.isFinite) ? [p.x, p.y, p.z] : null;
}
function isPublished(item, dependencies: Record<string, any> = {}) {
  const publish = info(item)[KEY];
  const dep = dependencies.deployment || deployment;
  const state = dep.readConstructionState(item);
  return Boolean(publish?.published === true && !item?.spaceState?.dungeonInstanceID && !item?.spaceState?.airEncounterID && state && state.assemblyStatus !== dep.ASSEMBLY_STATUS_UNDER_CONSTRUCTION &&
    !dep.isAssemblyActivationPending(item) && Number(item.flagID) === 0 &&
    Number(item.ownerID) === publish.ownerID && Number(item.typeID) === publish.typeID &&
    Number(item.locationID) === publish.systemID && Number(state.solarSystemID) === publish.systemID &&
    JSON.stringify(position(item)) === JSON.stringify(publish.position));
}
function createStructurePublicationRuntime(dependencies: Record<string, any> = {}) {
  const inventory = dependencies.itemStore || itemStore;
  const dep = dependencies.deployment || deployment;
  function publishLocation(session, itemID, published = true) {
    const characterID = Number(session?.characterID || session?.charid);
    const systemID = Number(session?.solarsystemid2 || session?.solarsystemid || session?._space?.systemID);
    const item = inventory.findItemById(Number(itemID));
    if (!Number.isSafeInteger(characterID) || characterID <= 0 || !item || Number(item.ownerID) !== characterID) return { success: false as const, errorMsg: "ASSEMBLY_ACCESS_DENIED" };
    const state = dep.readConstructionState(item);
    if (!state || state.assemblyStatus === dep.ASSEMBLY_STATUS_UNDER_CONSTRUCTION || dep.isAssemblyActivationPending(item) || Number(item.flagID) !== 0 || !position(item)) return { success: false as const, errorMsg: "ASSEMBLY_NOT_DEPLOYED" };
    if (Number(item.locationID) !== systemID || Number(state.solarSystemID) !== systemID) return { success: false as const, errorMsg: "ASSEMBLY_NOT_IN_CURRENT_SYSTEM" };
    const runtime = dependencies.spaceRuntime || require("../../space/runtime");
    const ship = runtime.getEntity(session, Number(session.shipid || session.shipID || session?._space?.shipID));
    const entity = runtime.getEntity(session, Number(itemID));
    if (!entity || !ship || !canEntitiesInteractLocally(ship, entity) || entity.dungeonInstanceID || entity.airEncounterID) return { success: false as const, errorMsg: "ASSEMBLY_NOT_VISIBLE" };
    const result = inventory.updateInventoryItem(item.itemID, current => ({ ...current, customInfo: JSON.stringify({ ...info(current),
      [KEY]: { published: published === true, ownerID: characterID, typeID: Number(item.typeID), systemID,
        position: position(item), updatedAtMs: Date.now() },
    }) }));
    if (!result?.success) return result || { success: false as const, errorMsg: "ASSEMBLY_PUBLICATION_WRITE_FAILED" };
    (dependencies.notify || require("./iffAbilityHandlers").notifyIffStateChanged)(systemID, published ? "assembly-location-published" : "assembly-location-revoked");
    return { success: true as const };
  }
  function listPublished(session) {
    const systemID = Number(session?.solarsystemid2 || session?.solarsystemid || session?._space?.systemID);
    if (!Number.isSafeInteger(systemID) || systemID <= 0 || !Number(session?.characterID || session?.charid)) return [];
    return Object.values<any>(inventory.getAllItems()).filter(item => Number(item.locationID) === systemID && isPublished(item, { deployment: dep }))
      .map(item => ({ item_id: item.itemID, type_id: item.typeID, name: item.itemName || null,
        solar_system_id: systemID, position: position(item), is_mine: Number(item.ownerID) === Number(session.characterID || session.charid),
        transponder_channel: null, transponder_code: null }));
  }
  return { publishLocation, listPublished };
}
let instance;
module.exports = { KEY, isTransponderStructureType, isPublished, createStructurePublicationRuntime,
  publishLocation: (...args) => (instance ||= createStructurePublicationRuntime()).publishLocation(...args),
  listPublished: (...args) => (instance ||= createStructurePublicationRuntime()).listPublished(...args),
};
