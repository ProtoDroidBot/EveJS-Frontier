"use strict";

const path = require("path");

const LIGHT_YEAR_METERS = 9460730472580800;
const MAX_ROUTE_SYSTEMS = 4096;
const ASSEMBLY_ONLINE = 2;

function positiveInt(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isSafeInteger(numeric) && numeric > 0 ? numeric : fallback;
}

function position(value) {
  if (!value || typeof value !== "object" ||
      ![value.x, value.y, value.z].every((part) => Number.isFinite(Number(part)))) return null;
  return { x: Number(value.x), y: Number(value.y), z: Number(value.z) };
}

function distanceLightYears(left, right) {
  const a = position(left && left.position);
  const b = position(right && right.position);
  if (!a || !b) return null;
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) / LIGHT_YEAR_METERS;
}

function defaultAdapters() {
  return {
    worldData: require(path.join(__dirname, "../worldData")),
    stargates: require(path.join(__dirname, "../../services/frontier/celestialStargateRuntime")),
    assemblies: require(path.join(__dirname, "../../services/frontier/deploymentRuntime")),
    nodeEnergy: require(path.join(__dirname, "../../services/frontier/networkNodeEnergyRuntime")),
    itemStore: require(path.join(__dirname, "../../services/inventory/itemStore")),
  };
}

function createNpcTravelRoutePlanner(overrides: Record<string, any> = {}) {
  const deps = { ...defaultAdapters(), ...overrides };

  function nodeUsable(assemblyID) {
    try {
      const binding = deps.nodeEnergy.getAssemblyEnergyState(assemblyID);
      const nodeID = positiveInt(binding && binding.networkNodeID);
      if (!nodeID) return true;
      const node = deps.itemStore.findItemById(nodeID);
      if (!node) return false;
      const status = deps.nodeEnergy.getNetworkNodeEnergyStatus(node.ownerID, nodeID);
      return status && status.success === true && status.data?.online === true &&
        status.data?.fuelLevel !== "empty" && status.data?.overPowerLimit !== true &&
        status.data?.powerUsageLevel !== "offline";
    } catch (_) {
      return false;
    }
  }

  function listStaticEdges(systemID) {
    const edges: any[] = [];
    for (const gate of deps.worldData.getStargatesForSystem(systemID) || []) {
      const destinationGateID = positiveInt(gate.destinationID);
      const destination = destinationGateID
        ? deps.worldData.getStargateByID(destinationGateID) : null;
      if (!destination || positiveInt(destination.solarSystemID) === systemID ||
          !deps.worldData.getSolarSystemByID(destination.solarSystemID)) continue;
      let state;
      try {
        state = deps.stargates.getStargateState(gate.itemID);
      } catch (_) {
        continue;
      }
      if (!state?.success && state?.errorMsg !== "STARGATE_NOT_MANAGED") continue;
      const managed = state && state.success === true ? state.data : null;
      const dormant = managed && managed.status !== deps.stargates.STARGATE_MAINTENANCE_STATUS.ACTIVE;
      edges.push({
        kind: "stargate",
        sourceSystemID: systemID,
        destinationSystemID: positiveInt(destination.solarSystemID),
        sourceID: positiveInt(gate.itemID),
        destinationID: destinationGateID,
        sourcePosition: position(gate.position),
        destinationPosition: position(destination.position),
        requiresMaintenance: Boolean(dormant),
        stateRevision: managed ? positiveInt(managed.revision) : 0,
        cost: dormant ? 8 : 1,
      });
    }
    return edges;
  }

  function listAssemblyEdges(systemID, records, definitions) {
    const edges: any[] = [];
    for (const source of records) {
      if (positiveInt(source.solarSystemID) !== systemID ||
          source.assemblyStatus !== ASSEMBLY_ONLINE ||
          Number(source.activationCompleteAtMs) > 0) continue;
      const definition = definitions.get(positiveInt(source.assemblyTypeID));
      if (!definition?.smartGate || !nodeUsable(source.itemID)) continue;
      const catapult = deps.assemblies._testing.isSlingshotGateType(source.assemblyTypeID);
      if (catapult) {
        const destinationSystemID = positiveInt(source.targetSolarSystemID);
        const destinationSystem = deps.worldData.getSolarSystemByID(destinationSystemID);
        const sourceSystem = deps.worldData.getSolarSystemByID(systemID);
        const distanceLy = distanceLightYears(sourceSystem, destinationSystem);
        if (source.destinationGateID || destinationSystemID === systemID ||
            !destinationSystem || distanceLy === null ||
            distanceLy > Number(definition.smartGate.rangeLightYears)) continue;
        edges.push({
          kind: "catapult", sourceSystemID: systemID, destinationSystemID,
          sourceID: source.itemID, destinationID: 0,
          sourcePosition: position(source.position), destinationPosition: null,
          ownerID: source.ownerID, cost: 1.2,
        });
        continue;
      }
      const destination = records.find((record) => record.itemID === source.destinationGateID);
      if (!destination || positiveInt(source.ownerID) === 0 ||
          destination.assemblyStatus !== ASSEMBLY_ONLINE ||
          Number(destination.activationCompleteAtMs) > 0 ||
          destination.destinationGateID !== source.itemID ||
          destination.targetSolarSystemID !== systemID ||
          source.targetSolarSystemID !== destination.solarSystemID ||
          source.ownerID !== destination.ownerID ||
          source.assemblyTypeID !== destination.assemblyTypeID ||
          !nodeUsable(destination.itemID)) continue;
      edges.push({
        kind: "smart-gate", sourceSystemID: systemID,
        destinationSystemID: destination.solarSystemID,
        sourceID: source.itemID, destinationID: destination.itemID,
        sourcePosition: position(source.position),
        destinationPosition: position(destination.position),
        ownerID: source.ownerID, cost: 1.1,
      });
    }
    return edges;
  }

  function edgesForSystem(systemID, options: Record<string, any> = {}) {
    const records = options.assemblyRecords || deps.assemblies.listAssemblies();
    const definitions = options.assemblyDefinitions || new Map(
      deps.assemblies.listAssemblyDefinitions().map((definition) => [
        positiveInt(definition.assemblyTypeID), definition,
      ]),
    );
    return [
      ...listStaticEdges(systemID),
      ...listAssemblyEdges(systemID, records, definitions),
      ...(options.jumpDrivePlan && options.jumpDestinationSystemID &&
        positiveInt(options.jumpDestinationSystemID) !== systemID
        ? [{
            kind: "jump-drive", sourceSystemID: systemID,
            destinationSystemID: positiveInt(options.jumpDestinationSystemID),
            sourceID: 0, destinationID: 0, sourcePosition: null,
            destinationPosition: null, cost: 2,
            jumpDrivePlan: options.jumpDrivePlan,
          }]
        : []),
    ].sort((a, b) => a.cost - b.cost || a.destinationSystemID - b.destinationSystemID ||
      a.sourceID - b.sourceID);
  }

  function planRoute(sourceSystemID, destinationSystemID, options: Record<string, any> = {}) {
    const sourceID = positiveInt(sourceSystemID);
    const targetID = positiveInt(destinationSystemID);
    if (!sourceID || !targetID || !deps.worldData.getSolarSystemByID(sourceID) ||
        !deps.worldData.getSolarSystemByID(targetID)) {
      return { success: false, errorMsg: "NPC_TRAVEL_SYSTEM_NOT_FOUND" };
    }
    if (sourceID === targetID) return { success: true, data: { edges: [], cost: 0 } };
    const assemblyRecords = deps.assemblies.listAssemblies();
    const assemblyDefinitions = new Map(
      deps.assemblies.listAssemblyDefinitions().map((definition) => [
        positiveInt(definition.assemblyTypeID), definition,
      ]),
    );
    const pending = [{ systemID: sourceID, cost: 0, edges: [] as any[] }];
    const best = new Map<number, number>([[sourceID, 0]]);
    while (pending.length > 0 && best.size <= MAX_ROUTE_SYSTEMS) {
      pending.sort((a, b) => a.cost - b.cost || a.systemID - b.systemID);
      const current = pending.shift();
      if (current.cost > (best.get(current.systemID) ?? Infinity)) continue;
      if (current.systemID === targetID) {
        return { success: true, data: { edges: current.edges, cost: current.cost } };
      }
      const candidates = edgesForSystem(current.systemID, {
        assemblyRecords, assemblyDefinitions,
        ...(current.systemID === sourceID && options.jumpDrivePlan
          ? { jumpDrivePlan: options.jumpDrivePlan, jumpDestinationSystemID: targetID }
          : {}),
      });
      for (const edge of candidates) {
        const nextCost = current.cost + edge.cost;
        if (nextCost >= (best.get(edge.destinationSystemID) ?? Infinity)) continue;
        best.set(edge.destinationSystemID, nextCost);
        pending.push({
          systemID: edge.destinationSystemID,
          cost: nextCost,
          edges: [...current.edges, edge],
        });
      }
    }
    return { success: false, errorMsg: "NPC_TRAVEL_ROUTE_UNAVAILABLE" };
  }

  function validateEdge(edge) {
    if (!edge || edge.kind === "jump-drive") {
      return { success: Boolean(edge), errorMsg: edge ? null : "NPC_TRAVEL_EDGE_INVALID" };
    }
    const current = edgesForSystem(positiveInt(edge.sourceSystemID));
    const match = current.find((candidate) => candidate.kind === edge.kind &&
      candidate.sourceID === edge.sourceID &&
      candidate.destinationID === edge.destinationID &&
      candidate.destinationSystemID === edge.destinationSystemID);
    return match
      ? { success: true, data: match }
      : { success: false, errorMsg: "NPC_TRAVEL_EDGE_INVALIDATED" };
  }

  return { edgesForSystem, planRoute, validateEdge };
}

let defaultPlanner = null;
function getDefaultPlanner() {
  return defaultPlanner ||= createNpcTravelRoutePlanner();
}

module.exports = {
  LIGHT_YEAR_METERS,
  createNpcTravelRoutePlanner,
  planNpcTravelRoute: (...args) => getDefaultPlanner().planRoute(...args),
  validateNpcTravelEdge: (...args) => getDefaultPlanner().validateEdge(...args),
};
