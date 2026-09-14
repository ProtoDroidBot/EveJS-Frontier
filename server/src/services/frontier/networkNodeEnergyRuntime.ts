"use strict";

const itemStore = require("../inventory/itemStore");
const { readStaticRows, TABLE } = require("../_shared/referenceData");
const { NETWORK_NODE_RADIUS_METERS, NETWORK_NODE_TYPE_ID, DEFAULT_NETWORK_NODE_MAX_ENERGY,
  getAssemblyEnergyRequirements, getConfiguredAssemblyEnergyRequirements, isAssemblyEnergyConfigLoaded,
  getAssemblyEnergyConfigSource } = require("./networkNodeEnergyConfig");
const ENERGY_INFO_KEY = "evejsFrontierEnergy";
let reconciling = false;

function deployment() { return require("./deploymentRuntime"); }
function info(item) {
  try {
    const value = typeof item?.customInfo === "object" ? item.customInfo : JSON.parse(item?.customInfo || "{}");
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
  } catch { return {}; }
}
function positiveID(value) {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : 0;
}
function components() { return readStaticRows(TABLE.SPACE_COMPONENTS_BY_TYPE); }
function trackedNodeID(itemID) {
  return positiveID(require("./suiAssemblySync").getTrackedSuiAssemblyNetworkNodeID?.(String(itemID)));
}
function getAssemblyEnergyConfig() { return getConfiguredAssemblyEnergyRequirements(); }
function getNetworkNodeEnergyCapacity(typeID = NETWORK_NODE_TYPE_ID) {
  const row = components().find(row => Number(row.typeID ?? row._key) === Number(typeID));
  const capacity = Number(row?.smartAnchor?.maxEnergyCapacity ?? DEFAULT_NETWORK_NODE_MAX_ENERGY);
  return Number.isSafeInteger(capacity) && capacity > 0 ? capacity : DEFAULT_NETWORK_NODE_MAX_ENERGY;
}
function distance(left, right) {
  const a = left?.spaceState?.position;
  const b = right?.spaceState?.position;
  if (!a || !b || ![a.x, a.y, a.z, b.x, b.y, b.z].every(value => typeof value === "number" && Number.isFinite(value))) return Infinity;
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}
function eligible(assembly, node) {
  return assembly.itemID !== node.itemID && assembly.ownerID === node.ownerID &&
    assembly.locationID === node.locationID && distance(assembly, node) <= NETWORK_NODE_RADIUS_METERS;
}
function completed(item) {
  const state = deployment().readConstructionState(item);
  return state && [1, 2].includes(state.assemblyStatus) &&
    Number(state.assemblyTypeID) === Number(item.typeID) &&
    Number(state.solarSystemID) === Number(item.locationID);
}
function snapshot() {
  const costs = new Map<number, number>(getAssemblyEnergyRequirements(components()).map(row => [row.typeID, row.energyRequired]));
  const items = Object.values<any>(itemStore.getAllItems()).filter(item => completed(item) && costs.has(Number(item.typeID)))
    .sort((a, b) => Number(a.itemID) - Number(b.itemID));
  const nodes = items.filter(item => Number(item.typeID) === NETWORK_NODE_TYPE_ID);
  const bindings = new Map<number, number>();
  for (const item of items) {
    if (Number(item.typeID) === NETWORK_NODE_TYPE_ID) continue;
    const stored = info(item)[ENERGY_INFO_KEY];
    const trackedID = trackedNodeID(item.itemID);
    const boundID = trackedID || positiveID(stored?.networkNodeID);
    const bound = nodes.find(node => Number(node.itemID) === boundID && eligible(item, node));
    // An explicit connection never silently migrates to a different owner's grid.
    const selected = bound || (trackedID || stored?.autoConnect === false ? null : nodes.filter(node => eligible(item, node))
      .sort((a, b) => distance(item, a) - distance(item, b) || Number(a.itemID) - Number(b.itemID))[0]);
    if (selected) bindings.set(Number(item.itemID), Number(selected.itemID));
  }
  return { items, nodes, bindings, costs };
}
function nodeOnline(node) {
  return deployment().readConstructionState(node)?.assemblyStatus === 2 &&
    require("./networkNodeFuelRuntime").calculateNetworkNodeFuelBurn(node).state.quantity > 0;
}
function energyUsed(view, nodeID, excludedID = 0) {
  return view.items.reduce((total, item) => total + (Number(item.itemID) !== excludedID &&
    view.bindings.get(Number(item.itemID)) === nodeID && deployment().readConstructionState(item).assemblyStatus === 2
    ? view.costs.get(Number(item.typeID)) : 0), 0);
}
function writeBinding(item, networkNodeID, autoConnect) {
  const previous = info(item)[ENERGY_INFO_KEY];
  if (previous?.networkNodeID === networkNodeID && previous?.autoConnect === autoConnect) return { success: true, data: item };
  return itemStore.updateInventoryItem(item.itemID, current => ({ ...current,
    customInfo: JSON.stringify({ ...info(current), [ENERGY_INFO_KEY]: { networkNodeID, autoConnect } }),
  }));
}

/** Repair persisted topology and enforce power loss even when Sui sync is disabled. */
function reconcileNetworkNodeEnergy() {
  if (reconciling) return;
  reconciling = true;
  try {
    const view = snapshot();
    const remaining = new Map<number, number>(view.nodes.map(node => [Number(node.itemID), nodeOnline(node) ? getNetworkNodeEnergyCapacity(node.typeID) : 0]));
    for (const item of view.items) {
      if (Number(item.typeID) === NETWORK_NODE_TYPE_ID) continue;
      const nodeID = view.bindings.get(Number(item.itemID)) || 0;
      const result = writeBinding(item, nodeID, info(item)[ENERGY_INFO_KEY]?.autoConnect !== false);
      if (!result.success) throw new Error(`Cannot save assembly ${item.itemID} energy connection`);
      if (deployment().readConstructionState(item).assemblyStatus !== 2) continue;
      const cost = view.costs.get(Number(item.typeID));
      const node = view.nodes.find(node => Number(node.itemID) === nodeID);
      if (!nodeID || !nodeOnline(node) || (isAssemblyEnergyConfigLoaded() && remaining.get(nodeID) < cost)) {
        const offline = deployment().offlineAssemblyForFuelDepletion(item.itemID);
        if (!offline.success) throw new Error(`Cannot take unpowered assembly ${item.itemID} offline`);
      } else remaining.set(nodeID, remaining.get(nodeID) - cost);
    }
  } finally { reconciling = false; }
}

/** Called at prepare and commit; pending operations never reserve or double-charge energy. */
function validateAssemblyOnline(item) {
  const view = snapshot();
  if (Number(item.typeID) === NETWORK_NODE_TYPE_ID || !view.costs.has(Number(item.typeID))) return { success: true as const };
  if (!isAssemblyEnergyConfigLoaded()) return { success: false as const, errorMsg: "NETWORK_NODE_ENERGY_CONFIG_UNAVAILABLE" };
  const nodeID = view.bindings.get(Number(item.itemID));
  if (!nodeID) return { success: false as const, errorMsg: "NETWORK_NODE_CONNECTION_REQUIRED" };
  const node = view.nodes.find(node => Number(node.itemID) === nodeID);
  if (!nodeOnline(node)) return { success: false as const, errorMsg: "NETWORK_NODE_OFFLINE" };
  if (energyUsed(view, nodeID, Number(item.itemID)) + view.costs.get(Number(item.typeID)) > getNetworkNodeEnergyCapacity(node.typeID)) {
    return { success: false as const, errorMsg: "NETWORK_NODE_ENERGY_EXCEEDED" };
  }
  return { success: true as const };
}
function getAssemblyEnergyState(itemID) {
  const view = snapshot();
  const item = view.items.find(item => Number(item.itemID) === Number(itemID));
  const nodeID = view.bindings.get(Number(itemID)) || 0;
  const cost = item ? view.costs.get(Number(item.typeID)) : 0;
  const powered = item && nodeID && nodeOnline(view.nodes.find(node => Number(node.itemID) === nodeID));
  return { networkNodeID: nodeID, energyRequired: cost, energyUsed: powered && deployment().readConstructionState(item).assemblyStatus === 2 ? cost : 0 };
}
function validateNode(characterID, nodeID) {
  if (!positiveID(characterID)) return { success: false as const, errorMsg: "ACCESS_DENIED" };
  const node = itemStore.findItemById(positiveID(nodeID));
  if (!node || Number(node.typeID) !== NETWORK_NODE_TYPE_ID || !completed(node)) return { success: false as const, errorMsg: "ASSEMBLY_NOT_FOUND" };
  if (Number(node.ownerID) !== Number(characterID)) return { success: false as const, errorMsg: "ASSEMBLY_ACCESS_DENIED" };
  return { success: true as const, node };
}
function getNetworkNodeEnergyStatus(characterID, nodeID) {
  const access = validateNode(characterID, nodeID);
  if (!access.success) return access;
  if (!isAssemblyEnergyConfigLoaded()) return { success: false as const, errorMsg: "NETWORK_NODE_ENERGY_CONFIG_UNAVAILABLE" };
  require("./networkNodeFuelRuntime").settleNetworkNodeFuel(access.node.itemID);
  reconcileNetworkNodeEnergy();
  const view = snapshot();
  const node = view.nodes.find(item => Number(item.itemID) === Number(nodeID));
  const maxEnergy = getNetworkNodeEnergyCapacity(node.typeID);
  const used = energyUsed(view, Number(nodeID));
  const entry = item => ({ itemID: Number(item.itemID), typeID: Number(item.typeID),
    name: item.itemName || itemStore.getItemMetadata(item.typeID)?.name || `Assembly ${item.itemID}`,
    assemblyStatus: deployment().readConstructionState(item).assemblyStatus,
    networkNodeID: view.bindings.get(Number(item.itemID)) || 0,
    distanceMeters: distance(item, node), energyRequired: view.costs.get(Number(item.typeID)),
    canDisconnect: deployment().readConstructionState(item).assemblyStatus === 1 && !trackedNodeID(item.itemID),
    disconnectReason: trackedNodeID(item.itemID) ? "This assembly is anchored to its Network Node on the blockchain." :
      deployment().readConstructionState(item).assemblyStatus === 2 ? "Take this assembly offline before disconnecting it." : null,
    energyUsed: deployment().readConstructionState(item).assemblyStatus === 2 ? view.costs.get(Number(item.typeID)) : 0,
  });
  return { success: true as const, data: { networkNodeID: Number(nodeID), radiusMeters: NETWORK_NODE_RADIUS_METERS,
    maxEnergy, energyUsed: used, energyAvailable: nodeOnline(node) ? Math.max(0, maxEnergy - used) : 0,
    online: nodeOnline(node), energyConfigSource: getAssemblyEnergyConfigSource(),
    connectedAssemblies: view.items.filter(item => view.bindings.get(Number(item.itemID)) === Number(nodeID)).map(entry),
    nearbyAssemblies: view.items.filter(item => Number(item.typeID) !== NETWORK_NODE_TYPE_ID && eligible(item, node) &&
      view.bindings.get(Number(item.itemID)) !== Number(nodeID)).map(entry),
  } };
}
function changeConnection(session, assemblyID, nodeID, connect) {
  const access = validateNode(session?.characterID ?? session?.charid, nodeID);
  if (!access.success) return access;
  if (!isAssemblyEnergyConfigLoaded()) return { success: false as const, errorMsg: "NETWORK_NODE_ENERGY_CONFIG_UNAVAILABLE" };
  const systemID = positiveID(session?.solarsystemid2 || session?.solarsystemid || session?.locationid);
  if (systemID !== Number(access.node.locationID)) return { success: false as const, errorMsg: "ASSEMBLY_NOT_IN_CURRENT_SYSTEM" };
  const view = snapshot();
  const item = view.items.find(item => Number(item.itemID) === positiveID(assemblyID) && Number(item.typeID) !== NETWORK_NODE_TYPE_ID);
  if (!item) return { success: false as const, errorMsg: "ASSEMBLY_NOT_FOUND" };
  if (Number(item.ownerID) !== Number(access.node.ownerID)) return { success: false as const, errorMsg: "ASSEMBLY_ACCESS_DENIED" };
  const boundID = view.bindings.get(Number(item.itemID)) || 0;
  const chainNodeID = trackedNodeID(item.itemID);
  if (chainNodeID && (!connect || chainNodeID !== Number(nodeID))) {
    return { success: false as const, errorMsg: "NETWORK_NODE_BINDING_LOCKED" };
  }
  if (!connect && boundID !== Number(nodeID)) return { success: false as const, errorMsg: "NETWORK_NODE_CONNECTION_MISMATCH" };
  if (connect && !eligible(item, access.node)) return { success: false as const, errorMsg: "NETWORK_NODE_OUT_OF_RANGE" };
  if (connect && boundID && boundID !== Number(nodeID)) return { success: false as const, errorMsg: "ASSEMBLY_ALREADY_CONNECTED" };
  if (deployment().readConstructionState(item).assemblyStatus === 2 && !(connect && boundID === Number(nodeID))) {
    return { success: false as const, errorMsg: "ASSEMBLY_MUST_BE_OFFLINE" };
  }
  const result = writeBinding(item, connect ? Number(nodeID) : 0, false);
  if (!result.success) return result;
  return getNetworkNodeEnergyStatus(Number(access.node.ownerID), Number(nodeID));
}

module.exports = { ENERGY_INFO_KEY, getAssemblyEnergyConfig, getNetworkNodeEnergyCapacity,
  getAssemblyEnergyState, getNetworkNodeEnergyStatus, validateAssemblyOnline, reconcileNetworkNodeEnergy,
  connectAssembly: (session, assemblyID, nodeID) => changeConnection(session, assemblyID, nodeID, true),
  disconnectAssembly: (session, assemblyID, nodeID) => changeConnection(session, assemblyID, nodeID, false),
};
