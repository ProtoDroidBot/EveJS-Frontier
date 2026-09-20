"use strict";

import type { SuiAssemblyEnergyState } from "./suiAssemblyChain";

const itemStore = require("../inventory/itemStore");
const { readStaticRows, TABLE } = require("../_shared/referenceData");
const { NETWORK_NODE_RADIUS_METERS, NETWORK_NODE_TYPE_ID, DEFAULT_NETWORK_NODE_MAX_ENERGY,
  getAssemblyEnergyRequirements, getConfiguredAssemblyEnergyRequirements, isAssemblyEnergyConfigLoaded,
  getAssemblyEnergyConfigSource } = require("./networkNodeEnergyConfig");
const ENERGY_INFO_KEY = "evejsFrontierEnergy";
const LOW_FUEL_RATIO = 0.2;
const MEDIUM_POWER_USAGE_RATIO = 0.5;
const HIGH_POWER_USAGE_RATIO = 0.8;
let reconciling = false;
// Observations are scoped to the running deployment and refreshed by its worker.
// Do not persist them across restarts, where the active chain may have changed.
const chainEnergy = new Map<number, { identity: string; state: SuiAssemblyEnergyState }>();

function energyIdentity(item) {
  return JSON.stringify([item.itemID, item.typeID, item.ownerID, item.locationID, item.spaceState?.position]);
}
function projectSuiNetworkNodeEnergy(itemID, state: SuiAssemblyEnergyState) {
  const item = itemStore.findItemById(Number(itemID));
  if (!item || Number(item.typeID) !== NETWORK_NODE_TYPE_ID) throw new Error(`Network Node ${itemID} is unavailable`);
  chainEnergy.set(Number(itemID), { identity: energyIdentity(item), state: { ...state } });
}
function clearSuiNetworkNodeEnergy(itemID?: number) {
  if (itemID === undefined) chainEnergy.clear();
  else chainEnergy.delete(Number(itemID));
}
function readSuiNetworkNodeEnergy(item) {
  if (!item || !require("./suiAssemblyState").isSuiAssemblyStateAuthoritative()) return null;
  const observation = chainEnergy.get(Number(item.itemID));
  return observation?.identity === energyIdentity(item) ? observation.state : null;
}

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
function relativePosition(item, node) {
  const position = item?.spaceState?.position;
  const origin = node?.spaceState?.position;
  if (!position || !origin || ![position.x, position.y, position.z, origin.x, origin.y, origin.z]
    .every(value => typeof value === "number" && Number.isFinite(value))) return null;
  return { x: position.x - origin.x, y: position.y - origin.y, z: position.z - origin.z };
}
function eligible(assembly, node) {
  return assembly.itemID !== node.itemID && assembly.ownerID === node.ownerID &&
    assembly.locationID === node.locationID && distance(assembly, node) <= NETWORK_NODE_RADIUS_METERS;
}
function radarEligible(assembly, node) {
  return assembly.itemID !== node.itemID && assembly.locationID === node.locationID &&
    distance(assembly, node) <= NETWORK_NODE_RADIUS_METERS;
}
function assemblyKind(item, component) {
  if (component?.smartAnchor) return "network_node";
  if (component?.smartGate) return "gate";
  if (component?.smartStorageUnit) return "storage_unit";
  if (component?.smartTurret) return "turret";
  if (require("./industryBlueprints").isIndustryFacilityType(item.typeID)) return "industry";
  return "assembly";
}
function activeIndustry(item) {
  const blueprints = require("./industryBlueprints");
  if (!blueprints.isIndustryFacilityType(item.typeID)) return null;
  const active = require("./industryProduction").getProductions(item)
    .find(({ production }) => production && ["RUNNING", "DISCONTINUING"].includes(production.state));
  if (!active) return null;
  const { laneID, production } = active;
  const blueprint = blueprints.getSelectedBlueprint(item);
  const products = Object.values<any>(blueprint?.outputs || {}).map(slot => {
    const name = itemStore.getItemMetadata(slot.type_id)?.name;
    return {
      typeID: Number(slot.type_id),
      name: name && name !== "Item" ? name : `Type ${slot.type_id}`,
      quantityPerRun: Number(slot.quantity_per_run),
    };
  }).sort((a, b) => a.typeID - b.typeID);
  return { laneID, state: production.state, jobID: production.jobID,
    runEndAtMs: production.runEndAtMs, products };
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
  if (require("./suiAssemblyState").isSuiAssemblyStateAuthoritative()) {
    return !deployment().isAssemblyActivationPending(node) && (readSuiNetworkNodeEnergy(node)?.currentEnergyProduction ?? 0) > 0;
  }
  return deployment().readConstructionState(node)?.assemblyStatus === 2 &&
    !deployment().isAssemblyActivationPending(node) &&
    (require("./networkNodeFuelRuntime").readSuiNetworkNodeFuel(node) ||
      require("./networkNodeFuelRuntime").calculateNetworkNodeFuelBurn(node).state.quantity > 0);
}
function energyUsed(view, nodeID, excludedID = 0) {
  return view.items.reduce((total, item) => total + (Number(item.itemID) !== excludedID &&
    view.bindings.get(Number(item.itemID)) === nodeID && deployment().readConstructionState(item).assemblyStatus === 2
    ? view.costs.get(Number(item.typeID)) : 0), 0);
}

function getPowerUsageLevel(online, energyUsed, energyProduction, overLimit = false) {
  if (overLimit || energyUsed > energyProduction) return "over_limit";
  if (!online || energyProduction <= 0) return "offline";
  const ratio = energyProduction > 0 ? energyUsed / energyProduction : 0;
  if (ratio <= MEDIUM_POWER_USAGE_RATIO) return "low";
  if (ratio <= HIGH_POWER_USAGE_RATIO) return "medium";
  return "high";
}

function buildNetworkNodeOperationalStatus(node, view, options: Record<string, any> = {}) {
  const fuelRuntime = require("./networkNodeFuelRuntime");
  const fuel = fuelRuntime.readNetworkNodeFuelState(node);
  const fuelVolume = fuel.typeID > 0
    ? Math.max(0, Number(require("../inventory/itemStore").getInventoryItemUnitVolume({ typeID: fuel.typeID })))
    : 0;
  const fuelCapacityVolume = fuelRuntime.getNetworkNodeFuelAttributes().fuelMaxCapacityVolume;
  const fuelUsedVolume = fuel.quantity * fuelVolume;
  const fuelRatio = fuelCapacityVolume > 0 ? fuelUsedVolume / fuelCapacityVolume : 0;
  const observed = readSuiNetworkNodeEnergy(node);
  const maxEnergy = observed?.maxEnergy ?? getNetworkNodeEnergyCapacity(node.typeID);
  const online = nodeOnline(node);
  const energyProduction = observed?.currentEnergyProduction ?? (online ? maxEnergy : 0);
  const actualEnergyUsed = observed?.energyUsed ?? energyUsed(view, Number(node.itemID));
  const reportedEnergyUsed = Math.max(actualEnergyUsed, Number(options.projectedEnergyUsed) || 0);
  const overLimit = options.errorCode === "NETWORK_NODE_ENERGY_EXCEEDED" ||
    reportedEnergyUsed > energyProduction;
  const usageRatio = energyProduction > 0
    ? reportedEnergyUsed / energyProduction
    : (reportedEnergyUsed > 0 ? null : 0);
  const fuelLevel = fuel.quantity <= 0 ? "empty" : fuelRatio <= LOW_FUEL_RATIO ? "low" : "normal";
  const powerUsageLevel = getPowerUsageLevel(online, reportedEnergyUsed, energyProduction, overLimit);
  const activeFlags = [
    ...(fuelLevel === "empty" ? ["FUEL_EMPTY"] : fuelLevel === "low" ? ["FUEL_LOW"] : []),
    `POWER_USAGE_${powerUsageLevel.toUpperCase()}`,
    ...(overLimit ? ["POWER_LIMIT_EXCEEDED"] : []),
  ];
  return {
    fuel: {
      level: fuelLevel,
      low: fuelLevel === "empty" || fuelLevel === "low",
      typeID: fuel.typeID,
      quantity: fuel.quantity,
      capacityVolume: fuelCapacityVolume,
      usedVolume: fuelUsedVolume,
      fillRatio: fuelRatio,
    },
    power: {
      usageLevel: powerUsageLevel,
      usageRatio,
      energyUsed: reportedEnergyUsed,
      actualEnergyUsed,
      energyProduction,
      maxEnergy,
      energyAvailable: Math.max(0, energyProduction - actualEnergyUsed),
      overLimit,
    },
    activeFlags,
    ...(options.errorCode ? {
      error: {
        code: String(options.errorCode),
        requestedAssemblyID: positiveID(options.requestedAssemblyID) || null,
        requestedEnergy: Math.max(0, Number(options.requestedEnergy) || 0),
      },
    } : {}),
  };
}

function publishNetworkNodeOperationalStatus(nodeID, options: Record<string, any> = {}) {
  const view = snapshot();
  const node = view.nodes.find(candidate => Number(candidate.itemID) === Number(nodeID));
  if (!node) return { success: false as const, errorMsg: "ASSEMBLY_NOT_FOUND" };
  const status = buildNetworkNodeOperationalStatus(node, view, options);
  // The journal records band transitions, not every fuel tick or energy-unit
  // change. Exact counters remain available from getNetworkNodeEnergyStatus.
  const signalStatus = {
    fuel: {
      level: status.fuel.level,
      low: status.fuel.low,
      typeID: status.fuel.typeID,
    },
    power: {
      usageLevel: status.power.usageLevel,
      overLimit: status.power.overLimit,
    },
    activeFlags: status.activeFlags,
    ...(status.error ? { error: status.error } : {}),
  };
  try {
    const published = require("./smartAssemblyRequestRuntime").publishAssemblyStatusSignal(
      Number(node.itemID),
      "network_node.resources",
      signalStatus,
      { ownerID: Number(node.ownerID), actorAssemblyID: Number(node.itemID) },
    );
    return { ...published, status };
  } catch (error) {
    return { success: false as const, errorMsg: "ASSEMBLY_SIGNAL_PUBLISH_FAILED", status };
  }
}
function writeBinding(item, networkNodeID, autoConnect) {
  const previous = info(item)[ENERGY_INFO_KEY];
  if (previous?.networkNodeID === networkNodeID && previous?.autoConnect === autoConnect) return { success: true, data: item };
  return itemStore.updateInventoryItem(item.itemID, current => ({ ...current,
    customInfo: JSON.stringify({ ...info(current), [ENERGY_INFO_KEY]: { networkNodeID, autoConnect } }),
  }));
}

/** Local-only fallback; the chain worker owns projection and explicit power-loss requests. */
function reconcileNetworkNodeEnergy() {
  // Notifications and energy reads must not turn a confirmed chain observation
  // into an offline request based on a graph that has not been refreshed yet.
  // Explicit connection writes remain available; the worker resolves initial
  // bindings and cascades fuel exhaustion through confirmed chain transitions.
  if (require("./suiAssemblyState").isSuiAssemblyStateAuthoritative()) return;
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
        if (nodeID && node && isAssemblyEnergyConfigLoaded() && remaining.get(nodeID) < cost) {
          publishNetworkNodeOperationalStatus(nodeID, {
            errorCode: "NETWORK_NODE_ENERGY_EXCEEDED",
            requestedAssemblyID: item.itemID,
            requestedEnergy: cost,
            projectedEnergyUsed: getNetworkNodeEnergyCapacity(node.typeID) - remaining.get(nodeID) + cost,
          });
        }
        const offline = deployment().offlineAssemblyForFuelDepletion(item.itemID);
        if (!offline.success) throw new Error(`Cannot take unpowered assembly ${item.itemID} offline`);
      } else remaining.set(nodeID, remaining.get(nodeID) - cost);
    }
  } finally { reconciling = false; }
}

/** Called at prepare and commit; pending operations never reserve or double-charge energy. */
function validateAssemblyOnline(item) {
  if (deployment().isAssemblyActivationPending(item)) return { success: false as const, errorMsg: "ASSEMBLY_ACTIVATING" };
  const view = snapshot();
  if (Number(item.typeID) === NETWORK_NODE_TYPE_ID || !view.costs.has(Number(item.typeID))) return { success: true as const };
  if (!isAssemblyEnergyConfigLoaded()) return { success: false as const, errorMsg: "NETWORK_NODE_ENERGY_CONFIG_UNAVAILABLE" };
  const nodeID = view.bindings.get(Number(item.itemID));
  if (!nodeID) return { success: false as const, errorMsg: "NETWORK_NODE_CONNECTION_REQUIRED" };
  const node = view.nodes.find(node => Number(node.itemID) === nodeID);
  const observed = readSuiNetworkNodeEnergy(node);
  if (require("./suiAssemblyState").isSuiAssemblyStateAuthoritative() && !observed) {
    return { success: false as const, errorMsg: "NETWORK_NODE_ENERGY_STATE_UNAVAILABLE" };
  }
  if (!nodeOnline(node)) return { success: false as const, errorMsg: "NETWORK_NODE_OFFLINE" };
  // A confirmed online assembly already has its reservation. Pending local
  // transitions do not prove that the chain has reserved or released anything.
  if (observed && deployment().readConstructionState(item).assemblyStatus === 2 &&
      !require("./suiAssemblyState").readSuiAssemblyStatusIntent(item)) {
    publishNetworkNodeOperationalStatus(nodeID);
    return { success: true as const };
  }
  // Native commits can queue online requests before the worker submits them.
  // Hold their cost for admission only; the displayed total stays chain-derived.
  const pendingEnergy = observed ? view.items.reduce((total, candidate) => total + (
    Number(candidate.itemID) !== Number(item.itemID) && view.bindings.get(Number(candidate.itemID)) === nodeID &&
    require("./suiAssemblyState").readSuiAssemblyStatusIntent(candidate)?.targetStatus === 2
      ? view.costs.get(Number(candidate.typeID)) : 0), 0) : 0;
  const available = observed ? Math.max(0, observed.currentEnergyProduction - observed.energyUsed - pendingEnergy)
    : getNetworkNodeEnergyCapacity(node.typeID) - energyUsed(view, nodeID, Number(item.itemID));
  if (view.costs.get(Number(item.typeID)) > available) {
    publishNetworkNodeOperationalStatus(nodeID, {
      errorCode: "NETWORK_NODE_ENERGY_EXCEEDED",
      requestedAssemblyID: item.itemID,
      requestedEnergy: view.costs.get(Number(item.typeID)),
      projectedEnergyUsed: (observed?.energyUsed ?? energyUsed(view, nodeID, Number(item.itemID))) +
        pendingEnergy + view.costs.get(Number(item.typeID)),
    });
    return { success: false as const, errorMsg: "NETWORK_NODE_ENERGY_EXCEEDED" };
  }
  publishNetworkNodeOperationalStatus(nodeID);
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
  if (deployment().isAssemblyActivationPending(node)) return { success: false as const, errorMsg: "ASSEMBLY_ACTIVATING" };
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
  const observed = readSuiNetworkNodeEnergy(node);
  if (require("./suiAssemblyState").isSuiAssemblyStateAuthoritative() && !observed) {
    return { success: false as const, errorMsg: "NETWORK_NODE_ENERGY_STATE_UNAVAILABLE" };
  }
  const maxEnergy = observed?.maxEnergy ?? getNetworkNodeEnergyCapacity(node.typeID);
  const production = observed?.currentEnergyProduction ?? (nodeOnline(node) ? maxEnergy : 0);
  const used = observed?.energyUsed ?? energyUsed(view, Number(nodeID));
  const operational = buildNetworkNodeOperationalStatus(node, view);
  publishNetworkNodeOperationalStatus(nodeID);
  const componentsByType = new Map(components().map(component => [Number(component.typeID ?? component._key), component]));
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
  const radarEntry = item => {
    const typeID = Number(item.typeID);
    const typeName = itemStore.getItemMetadata(typeID)?.name;
    return {
      itemID: Number(item.itemID), typeID,
      name: item.itemName || typeName || `Assembly ${item.itemID}`,
      typeName: typeName && typeName !== "Item" ? typeName : `Type ${typeID}`,
      structureType: assemblyKind(item, componentsByType.get(typeID)),
      assemblyStatus: deployment().readConstructionState(item).assemblyStatus,
      distanceMeters: distance(item, node),
      relativePosition: relativePosition(item, node),
      linkedToNode: view.bindings.get(Number(item.itemID)) === Number(nodeID),
      industry: activeIndustry(item),
    };
  };
  return { success: true as const, data: { networkNodeID: Number(nodeID), radiusMeters: NETWORK_NODE_RADIUS_METERS,
    maxEnergy, energyUsed: used, energyAvailable: Math.max(0, production - used),
    fuelLevel: operational.fuel.level, lowFuel: operational.fuel.low,
    fuelFillRatio: operational.fuel.fillRatio,
    powerUsageLevel: operational.power.usageLevel,
    powerUsageRatio: operational.power.usageRatio,
    overPowerLimit: operational.power.overLimit,
    resourceSignals: operational,
    online: nodeOnline(node), energyConfigSource: getAssemblyEnergyConfigSource(),
    connectedAssemblies: view.items.filter(item => view.bindings.get(Number(item.itemID)) === Number(nodeID)).map(entry),
    nearbyAssemblies: view.items.filter(item => Number(item.typeID) !== NETWORK_NODE_TYPE_ID && eligible(item, node) &&
      view.bindings.get(Number(item.itemID)) !== Number(nodeID)).map(entry),
    radarAssemblies: view.items.filter(item => radarEligible(item, node)).map(radarEntry)
      .sort((left, right) => left.distanceMeters - right.distanceMeters || left.itemID - right.itemID),
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
  if (deployment().isAssemblyActivationPending(item)) return { success: false as const, errorMsg: "ASSEMBLY_ACTIVATING" };
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
  // The API reads fresh chain state after leaving the mutation queue. A missing
  // observation must not turn this successful write into an apparent failure.
  return { success: true as const };
}

module.exports = { ENERGY_INFO_KEY, getAssemblyEnergyConfig, getNetworkNodeEnergyCapacity,
  projectSuiNetworkNodeEnergy, clearSuiNetworkNodeEnergy,
  getAssemblyEnergyState, getNetworkNodeEnergyStatus, validateAssemblyOnline, reconcileNetworkNodeEnergy,
  buildNetworkNodeOperationalStatus, publishNetworkNodeOperationalStatus,
  connectAssembly: (session, assemblyID, nodeID) => changeConnection(session, assemblyID, nodeID, true),
  disconnectAssembly: (session, assemblyID, nodeID) => changeConnection(session, assemblyID, nodeID, false),
};
