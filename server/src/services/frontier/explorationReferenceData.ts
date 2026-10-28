"use strict";

const TABLES = new Set(["solarSystems", "celestials", "stargates", "asteroidBelts", "stations", "landscapeSites"]);
const vector = value => Array.isArray(value) ? { x: value[0], y: value[1], z: value[2] } : { x: value.x, y: value.y, z: value.z };
const keys = { solarSystems: "solarSystems", celestials: "celestials", stargates: "stargates", asteroidBelts: "belts", stations: "stations", landscapeSites: "sites" };
const idKeys = { solarSystems: "solarSystemID", celestials: "itemID", stargates: "itemID", asteroidBelts: "itemID", stations: "stationID", landscapeSites: "itemID" };

/** One geography selection for legacy scene/map/travel consumers and schema14. */
function buildExplorationReferenceTable(world, tableName, baseline = {}) {
  if (!TABLES.has(tableName)) return null;
  const canonical = world.canonicalSource === true;
  const rowKey = keys[tableName], raw = baseline[rowKey] || [], rows = Array.isArray(raw) ? raw : Object.values<any>(raw);
  const prior = new Map(rows.map(row => [Number(row[idKeys[tableName]]), row]));
  const output = [];
  const supplementalBelts = new Map<number, any[]>(), seenBelts = new Set<number>();
  if (!canonical && tableName === "asteroidBelts") for (const belt of rows) {
    const systemID = Number(belt.solarSystemID);
    if (!supplementalBelts.has(systemID)) supplementalBelts.set(systemID, []);
    supplementalBelts.get(systemID).push(belt);
  }
  if (tableName === "stations" || tableName === "landscapeSites") {
    if (canonical) {
      // Station placement belongs to the same canonical FSD world as planets
      // and gates. Authored encounter sites come from the selected compatible
      // content profile, whose reference-data override precedes this adapter.
      const selected = tableName === "stations" ? [...world.stations.values()].map(station => ({
        ...station, stationID: station.id, itemID: station.id, stationTypeID: station.typeID,
        corporationID: station.ownerID, categoryID: 3, kind: "station",
        stationName: station.name || station.stationName || `Station ${station.id}`,
        itemName: station.name || station.stationName || `Station ${station.id}`,
        x: station.position.x, y: station.position.y, z: station.position.z,
        constellationID: world.systems.get(station.solarSystemID).constellationId,
        regionID: world.systems.get(station.solarSystemID).regionId,
        explorationWorldRevision: world.revision,
      })) : [];
      return { [rowKey]: selected, explorationWorldRevision: world.revision, explorationSourceProfile: world.sourceProfile };
    }
    // Local server content stays local; only geography belonging to the selected
    // universe may remain reachable. It is not advertised as retail map content.
    return { ...baseline, [rowKey]: rows.filter(row => world.systems.has(Number(row.solarSystemID))) };
  }
  function local(system, row, kind, groupID, orbitID = 0) {
    // Reused location IDs can describe a different body in another source.
    // Canonical projection never borrows labels, geometry or parent metadata.
    const base = canonical ? {} : prior.get(Number(row.id)) || {};
    return { ...base, itemID: row.id, typeID: row.typeId, solarSystemID: system.id, constellationID: system.constellationId, regionID: system.regionId,
      kind, groupID, categoryID: 2, itemName: (canonical ? row.name : base.itemName || row.name) || `${kind} ${row.id}`, position: vector(row.position),
      x: vector(row.position).x, y: vector(row.position).y, z: vector(row.position).z,
      radius: row.radiusM ?? base.radius ?? 0, orbitID: row.hostCelestialId || orbitID,
      celestialIndex: row.celestialIndex ?? base.celestialIndex, orbitIndex: row.orbitIndex ?? base.orbitIndex,
      ...(row.nameId ? { nameID: row.nameId } : {}), explorationWorldRevision: world.revision };
  }
  for (const system of world.systems.values()) {
    if (tableName === "solarSystems") {
      const base = canonical ? {} : prior.get(system.id) || {};
      const center = vector(system.center);
      output.push({ ...base, solarSystemID: system.id, constellationID: system.constellationId, regionID: system.regionId,
        name: system.name || base.name || base.solarSystemName || String(system.id), solarSystemName: system.name || base.solarSystemName || base.name || String(system.id),
        center, x: center.x, y: center.y, z: center.z, security: system.security ?? base.security ?? 0, securityStatus: system.security ?? base.securityStatus ?? 0,
        radius: system.radiusM ?? base.radius ?? 0, sunTypeID: system.sunTypeId, factionID: system.factionId,
        neighbours: (system.neighbours || []).map(solarSystemID => ({ solarSystemID })), explorationWorldRevision: world.revision });
    } else if (tableName === "celestials") {
      for (const sun of [system.sun, system.secondarySun, ...(system.companionSuns || [])]) if (sun) output.push(local(system, sun, "sun", 6));
      for (const planet of system.planets || []) {
        output.push(local(system, planet, "planet", 7, system.sun?.id));
        for (const moon of planet.moons || []) output.push(local(system, moon, "moon", 8, planet.id));
        for (const point of planet.lagrangePoints || []) output.push({ ...local(system, point, "lagrangePoint", canonical ? 4870 : prior.get(point.id)?.groupID || 0, planet.id), pointIndex: point.pointIndex });
      }
    } else if (tableName === "stargates") {
      for (const gate of system.stargates || []) output.push({ ...local(system, gate, "stargate", 10, gate.planetId), destinationID: gate.destinationGateId,
        destinationItemID: gate.destinationGateId, destinationSolarSystemID: gate.destinationSystemId, destination: { itemID: gate.destinationGateId, solarSystemID: gate.destinationSystemId }, planetID: gate.planetId, lagrangePointID: gate.lagrangePointId });
    } else if (tableName === "asteroidBelts") {
      for (const belt of system.asteroidBelts || []) { output.push({ ...local(system, belt, "asteroidBelt", 9), ...belt }); seenBelts.add(Number(belt.id)); }
      // The selected3502403 export has no landscape sidecar yet. Existing
      // server-authored fields in selected systems remain simulation content;
      // they are never relabelled as fully surveyed exploration objects.
      for (const belt of supplementalBelts.get(system.id) || []) if (!seenBelts.has(Number(belt.itemID))) { output.push(belt); seenBelts.add(Number(belt.itemID)); }
    }
  }
  return { ...(canonical ? {} : baseline), [rowKey]: output, explorationWorldRevision: world.revision,
    ...(canonical ? { explorationSourceProfile: world.sourceProfile } : {}) };
}
let worldCache, tableCache = new Map();
function getExplorationReferenceTable(tableName, readBaseline) {
  if (!TABLES.has(tableName) || Number(require("../../config").clientBuild) !== 3640684 || !process.env.EVEJS_EXPLORATION_WORLD_PATH) return null;
  const world = require("./explorationWorld").getConfiguredExplorationWorld();
  if (worldCache !== world) { worldCache = world; tableCache = new Map(); }
  if (!tableCache.has(tableName)) tableCache.set(tableName, buildExplorationReferenceTable(world, tableName, readBaseline()));
  return tableCache.get(tableName);
}
module.exports = { buildExplorationReferenceTable, getExplorationReferenceTable, clearCache: () => { tableCache.clear(); } };
