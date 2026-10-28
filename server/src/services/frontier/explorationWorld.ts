"use strict";

import fs = require("node:fs");
import crypto = require("node:crypto");
import { encodeUniverseDelta, UniverseDeltaInput } from "./explorationUniverseEncoder";

export const EXPLORATION_WORLD_FORMAT = "evejs-frontier-exploration-world-v1";
export const EXPLORATION_REVISION_ALGORITHM = "sha256-typed-f64-v1";
export const CANONICAL_SOURCE_PROFILE = "3572727-canonical-fsd-v1";
export const CANONICAL_SOURCE_LABEL = "3572727-CANONICAL-FSD";
export const CANONICAL_CONVERSION_POLICY = "3572727-canonical-fsd-to-3640684-v1";
// Raw inputs are pinned independently of the generated artifact's revision.
// A renamed legacy artifact or another build cannot opt into this adapter.
export const CANONICAL_SOURCE_DIGESTS: Readonly<Record<string, Readonly<{ sha256: string; md5: string; size: number }>>> = freezeTree({
  "code.ccp": { sha256: "eee139e55d95d75e897eb944c8045fb9ee1ef1b86a8672c2f453e1fffcde9f89", md5: "31fa2dcdac0702942fe0b4f88763a981", size: 119330175 },
  "res:/staticdata/regions.static": { sha256: "f5be931910cae18a30c1d18f28e43fc75a8ceab47cf3a43cbb973ee98dae09d5", md5: "0fa9232430e53a8bdbeba0a226aa266f", size: 164635 },
  "res:/staticdata/regions.schema": { sha256: "ecd3e71624482283ef6fc7c2d49011d9c4995439672edb5945fb8c4b41da167d", md5: "f196b295b0dcfcb70e903f97f3c3218b", size: 2474 },
  "res:/staticdata/constellations.static": { sha256: "e4e7d95d0d6fdd42ee5bf33c91bcf046bf03201374cae4833635f319e7d13250", md5: "3383b4f3ebdad4057e0821fb7a982878", size: 331126 },
  "res:/staticdata/constellations.schema": { sha256: "4c36c5231f5809c92bc15eab6e455a1d96f8621437807a2e44b8067a40a4d56a", md5: "84649555cdc070c4813145537e616b49", size: 1751 },
  "res:/staticdata/systems.static": { sha256: "8d1bf8e421e0a1888d66a8762281356068e94c630f1cc392ce253d9f3852205b", md5: "1a757cf779c984c72fa2e899ba64504f", size: 4944022 },
  "res:/staticdata/systems.schema": { sha256: "05369416d8a66a416ca3aaf28c0184ffb01adc10e7bed54285d307dd842b3296", md5: "1fbf931945bc585fa6aec5147689e784", size: 4012 },
  "res:/staticdata/solarsystemcontent.static": { sha256: "f1353309821c979619f5b24fcca8859994859486cbd7d3a24f7c9d632df5353a", md5: "b1729419a6ef1e29b5a9b5c091048a84", size: 69146952 },
  "res:/staticdata/jumps.static": { sha256: "91cfbf06955477ac40741c071bb7b390a5674632ad631ef980a6d12eca170e6c", md5: "40e4dcc104f4a7e37598ea3dd4017e57", size: 381164 },
  "res:/staticdata/jumps.schema": { sha256: "8ea9a9afe9ef0e37a68a42038bf695c93386a8b1e49929334ab6582204f1d297", md5: "9071e9a31887111d671102adec23fa30", size: 1029 },
});
type Row = Record<string, any>;

function object(value: unknown, label: string): Row {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError(`${label} must be an object`);
  return value;
}

function id(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError(`${label} must be a positive safe integer ID`);
  }
  return value;
}

function array(value: unknown, label: string): any[] {
  if (!Array.isArray(value)) throw new TypeError(`${label} must be an array`);
  return value;
}

/**
 * Shared with export-exploration-world.py. All numbers hash as finite IEEE754
 * Float64 values; strings are length-prefixed UTF8, and object keys sort by
 * UTF8 bytes. This survives Python/JS JSON differences (1.0, exponents and
 * Unicode escaping), while retaining negative zero and coordinate precision.
 */
export function calculateExplorationWorldRevision(raw: Row): string {
  object(raw, "world");
  const hash = crypto.createHash("sha256");
  const number = Buffer.allocUnsafe(9);
  number[0] = 0x6e;
  function string(value: string) {
    if (/[\uD800-\uDFFF]/u.test(value)) throw new TypeError("World contains an unpaired Unicode surrogate");
    hash.update(`s${Buffer.byteLength(value, "utf8")}:`);
    hash.update(value, "utf8");
  }
  function visit(value: unknown, root = false) {
    if (value === null) hash.update("z");
    else if (typeof value === "boolean") hash.update(value ? "t" : "f");
    else if (typeof value === "number") {
      if (!Number.isFinite(value)) throw new TypeError("World contains a nonfinite number");
      number.writeDoubleBE(value, 1);
      hash.update(number);
    } else if (typeof value === "string") string(value);
    else if (Array.isArray(value)) {
      hash.update(`a${value.length}:`);
      for (const child of value) visit(child);
    } else if (value && typeof value === "object") {
      const keys = Object.keys(value).filter(key => !(root && key === "contentRevision"));
      keys.sort((a, b) => Buffer.compare(Buffer.from(a, "utf8"), Buffer.from(b, "utf8")));
      hash.update(`o${keys.length}:`);
      for (const key of keys) { string(key); visit(value[key]); }
    } else throw new TypeError("World must contain only JSON-compatible values");
  }
  visit(raw, true);
  return hash.digest("hex");
}

function index(rows: unknown, label: string): Map<number, Row> {
  const result = new Map<number, Row>();
  for (const [i, value] of array(rows, label).entries()) {
    const row = object(value, `${label}[${i}]`);
    const key = id(row.id, `${label}[${i}].id`);
    if (result.has(key)) throw new TypeError(`${label} contains duplicate ID ${key}`);
    result.set(key, row);
  }
  if (!result.size) throw new TypeError(`${label} must not be empty`);
  return result;
}

function vector(value: unknown, label: string): void {
  const row = object(value, label);
  for (const axis of ["x", "y", "z"]) {
    if (typeof row[axis] !== "number" || !Number.isFinite(row[axis])) {
      throw new TypeError(`${label}.${axis} must be a finite coordinate`);
    }
  }
  if (Object.keys(row).some(key => !["x", "y", "z"].includes(key))) throw new TypeError(`${label} contains an unknown coordinate`);
}

function freezeTree(value: any): any {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freezeTree(child);
    Object.freeze(value);
  }
  return value;
}

const CHARTED_FIELDS = new Set([
  "id", "nameId", "regionId", "constellationId", "center", "security", "sunTypeId", "radiusM",
  "frostLineM", "habitableZoneInnerM", "habitableZoneOuterM", "luminosity", "factionId",
  "descriptionId", "sunFlareGraphicId", "wormholeClassId", "visualEffect", "securityClass",
  "fringe", "hub", "international", "regional", "border", "corridor", "neighbours",
  "gabrielNeighbours", "interacting", "name", "signalThermalW", "signalEmW", "thermalRung", "emRung", "sunTemperatureK",
]);

function detailRow(row: Row): Row {
  const celestialIds = new Set<number>();
  const lagrangeIds = new Set<number>();
  const oreIds = new Set<number>();
  for (const sun of [row.sun, row.secondarySun, ...(row.companionSuns || [])]) if (sun) celestialIds.add(sun.id);
  for (const planet of row.planets || []) {
    celestialIds.add(planet.id);
    for (const moon of planet.moons || []) celestialIds.add(moon.id);
    for (const point of planet.lagrangePoints || []) lagrangeIds.add(point.id);
    for (const trojan of planet.trojans || []) for (const site of trojan.sites || []) oreIds.add(site.id);
  }
  for (const gate of row.stargates || []) celestialIds.add(gate.id);
  for (const belt of row.asteroidBelts || []) for (const cluster of belt.clusters || []) {
    for (const site of cluster.sites || []) oreIds.add(site.id);
  }
  return {
    ...row, revealLevel: 1,
    // Extraction does not prove target-cycle content/type/localization parity.
    // Only explicitly supplied objects are marked explored; no full-scope claim.
    celestialScopeFull: false, lagrangeScopeFull: false, oreScopeFull: false,
    exploredCelestialIds: [...celestialIds].sort((a, b) => a - b),
    exploredLagrangeIds: [...lagrangeIds].sort((a, b) => a - b),
    exploredOreSiteIds: [...oreIds].sort((a, b) => a - b),
  };
}

function validateSource(raw: Row, source: Row): boolean {
  if (source.build === 3502403 && source.label === "3502403-MOD4-STUFF1" && source.kind === "legacy-client-geography") return false;
  if (source.build !== 3572727 || source.label !== CANONICAL_SOURCE_LABEL ||
      source.kind !== "canonical-client-geography" || source.profile !== CANONICAL_SOURCE_PROFILE ||
      source.branch !== "//frontier/demo-tool-v2" || raw.conversionPolicyRevision !== CANONICAL_CONVERSION_POLICY) {
    throw new TypeError("Exploration world must explicitly identify legacy source 3502403-MOD4-STUFF1 or the pinned canonical 3572727 source profile");
  }
  const digests = object(source.digests, "canonical source digests");
  for (const [name, expected] of Object.entries(CANONICAL_SOURCE_DIGESTS)) {
    const digest = object(digests[name], `canonical source digest ${name}`);
    if (digest.sha256 !== expected.sha256 || digest.md5 !== expected.md5 || digest.size !== expected.size) {
      throw new TypeError(`Canonical source fingerprint differs: ${name}`);
    }
  }
  return true;
}

/** Validate one explicitly selected artifact; does not select or invent a world. */
export function createExplorationWorld(raw: Row) {
  object(raw, "world");
  if (raw.format !== EXPLORATION_WORLD_FORMAT || raw.targetBuild !== 3640684) {
    throw new TypeError("Exploration world format/target build must be v1/3640684");
  }
  const source = object(raw.source, "source");
  const canonicalSource = validateSource(raw, source);
  if (raw.contentRevisionAlgorithm !== EXPLORATION_REVISION_ALGORITHM) {
    throw new TypeError("Unsupported exploration content revision algorithm");
  }
  if (typeof raw.contentRevision !== "string" || !/^[0-9a-f]{64}$/.test(raw.contentRevision) ||
      calculateExplorationWorldRevision(raw) !== raw.contentRevision) {
    throw new TypeError("Exploration world content revision mismatch");
  }
  const regions = index(raw.regions, "regions");
  const constellations = index(raw.constellations, "constellations");
  const systems = index(raw.systems, "systems");
  const universeIDs = new Set<number>();
  for (const table of [regions, constellations, systems]) for (const key of table.keys()) {
    if (universeIDs.has(key)) throw new TypeError(`Universe hierarchy reuses location ID ${key}`);
    universeIDs.add(key);
  }
  const revision = raw.contentRevision as string;
  const version = { major: 1, minor: 0, patch: 0, build_tags: [canonicalSource ? "canonical-3572727-for-3640684" : "legacy-3502403-mod4-stuff1",
    ...(raw.temporaryLandscape ? [raw.temporaryLandscape.temporary === false ? "compatible-3640684-content" : "temporary-3640684-landscape"] : []), revision] };
  // Matches resolved_system_svc._format_bundle_version in build 3640684.
  const versionString = `1.0.0+${version.build_tags.join(".")}`;
  const localIDs = new Set<number>();
  const gates = new Map<number, { systemId: number; row: Row }>();
  const planetsById = new Map<number, { systemId: number; row: Row }>();
  const pointsById = new Map<number, { systemId: number; planetId: number; row: Row }>();
  const stations = new Map<number, Row>();

  function local(value: unknown, label: string, abstract = false): Row {
    const row = object(value, label);
    const key = id(row.id, `${label}.id`);
    if (localIDs.has(key) || universeIDs.has(key)) throw new TypeError(`Duplicate local object ID ${key}`);
    localIDs.add(key);
    if (!abstract || (row.typeId !== undefined && row.typeId !== 0)) id(row.typeId, `${label}.typeId`);
    vector(row.position, `${label}.position`);
    if (row.radiusM !== undefined && (typeof row.radiusM !== "number" || row.radiusM < 0 || !Number.isFinite(row.radiusM))) {
      throw new TypeError(`${label}.radiusM must be finite and nonnegative`);
    }
    return row;
  }
  function optionalRows(row: Row, field: string): Row[] {
    return row[field] === undefined ? [] : array(row[field], `${row.id}.${field}`);
  }
  function compatibleType(row: Row, label: string, allowed: readonly number[]) {
    if (canonicalSource && !allowed.includes(row.typeId)) throw new TypeError(`Canonical ${label} uses an incompatible 3640684 type`);
  }
  for (const row of regions.values()) {
    vector(row.center, `region ${row.id}.center`);
    encodeUniverseDelta({ bundleVersion: versionString, regions: [row as any] });
  }
  for (const row of constellations.values()) {
    vector(row.center, `constellation ${row.id}.center`);
    if (!regions.has(id(row.regionId, `constellation ${row.id}.regionId`))) throw new TypeError(`Constellation ${row.id} has a dangling region`);
    encodeUniverseDelta({ bundleVersion: versionString, constellations: [row as any] });
  }
  for (const row of systems.values()) {
    vector(row.center, `system ${row.id}.center`);
    const constellation = constellations.get(id(row.constellationId, `system ${row.id}.constellationId`));
    if (!regions.has(id(row.regionId, `system ${row.id}.regionId`)) || !constellation || constellation.regionId !== row.regionId) {
      throw new TypeError(`System ${row.id} has an inconsistent hierarchy`);
    }
    for (const neighbour of optionalRows(row, "neighbours")) {
      if (!systems.has(id(neighbour, `system ${row.id}.neighbour`))) throw new TypeError(`System ${row.id} has a dangling neighbour`);
    }
    for (const name of ["radiusM", "frostLineM", "habitableZoneInnerM", "habitableZoneOuterM"]) {
      if (row[name] !== undefined && (typeof row[name] !== "number" || row[name] < 0)) throw new TypeError(`System ${row.id}.${name} must be nonnegative`);
    }
    const celestialIDs = new Set<number>();
    const stellarIDs = new Set<number>();
    for (const name of ["sun", "secondarySun"]) if (row[name] !== undefined) {
      celestialIDs.add(local(row[name], `system ${row.id}.${name}`).id);
      stellarIDs.add(row[name].id); compatibleType(row[name], "sun", [45031]);
    }
    for (const sun of optionalRows(row, "companionSuns")) {
      celestialIDs.add(local(sun, `system ${row.id}.companionSun`).id);
      stellarIDs.add(sun.id); compatibleType(sun, "companion sun", [45031]);
    }
    const planets = optionalRows(row, "planets");
    for (const planet of planets) {
      celestialIDs.add(local(planet, `system ${row.id}.planet`).id);
      planetsById.set(planet.id, { systemId: row.id, row: planet });
      compatibleType(planet, "planet", [11, 12, 13, 2014, 2015, 2016, 2063]);
    }
    const planetIDs = new Set(planets.map(planet => planet.id));
    const lagrangeIDs = new Set<number>();
    for (const planet of planets) {
      if (planet.hostCelestialId && !celestialIDs.has(id(planet.hostCelestialId, `planet ${planet.id}.hostCelestialId`))) {
        throw new TypeError(`Planet ${planet.id} has a dangling host celestial`);
      }
      if (canonicalSource && !stellarIDs.has(id(planet.hostCelestialId, `planet ${planet.id}.hostCelestialId`))) {
        throw new TypeError(`Canonical planet ${planet.id} must reference its authored stellar host`);
      }
      const moonIndices = new Set<number>();
      for (const moon of optionalRows(planet, "moons")) {
        local(moon, `planet ${planet.id}.moon`); compatibleType(moon, "moon", [14]);
        if (canonicalSource && (!Number.isInteger(moon.orbitIndex) || moon.orbitIndex < 1 || moon.orbitIndex > 255 || moonIndices.has(moon.orbitIndex))) {
          throw new TypeError(`Canonical moon ${moon.id} has an invalid/duplicate display orbit index`);
        }
        moonIndices.add(moon.orbitIndex);
      }
      const pointIndices = new Set<number>();
      for (const point of optionalRows(planet, "lagrangePoints")) {
        lagrangeIDs.add(local(point, `planet ${planet.id}.lagrangePoint`).id);
        pointsById.set(point.id, { systemId: row.id, planetId: planet.id, row: point });
        if (canonicalSource && (!Number.isInteger(point.pointIndex) || point.pointIndex < 1 || point.pointIndex > 5 ||
            point.typeId !== 88162 + point.pointIndex || point.id !== planet.id + 360000000 + point.pointIndex * 10000000 || pointIndices.has(point.pointIndex))) {
          throw new TypeError(`Canonical Lagrange point ${point.id} has inconsistent index/type/host identity`);
        }
        pointIndices.add(point.pointIndex);
      }
      for (const trojan of optionalRows(planet, "trojans")) {
        local(trojan, `planet ${planet.id}.trojan`, true);
        if (trojan.planetId !== undefined && trojan.planetId !== planet.id) throw new TypeError(`Trojan ${trojan.id} has a dangling planet`);
        if (trojan.lagrangePointId !== undefined && !optionalRows(planet, "lagrangePoints").some(point => point.id === trojan.lagrangePointId)) {
          throw new TypeError(`Trojan ${trojan.id} has a dangling Lagrange point`);
        }
        for (const site of optionalRows(trojan, "sites")) local(site, `trojan ${trojan.id}.site`);
      }
    }
    for (const belt of optionalRows(row, "asteroidBelts")) {
      local(belt, `system ${row.id}.asteroidBelt`, true);
      for (const field of ["innerPlanetId", "outerPlanetId", "centerCelestialId"]) {
        const allowed = canonicalSource && field !== "centerCelestialId" ? planetIDs : celestialIDs;
        if (belt[field] !== undefined && !allowed.has(id(belt[field], `belt ${belt.id}.${field}`))) {
          throw new TypeError(`Belt ${belt.id} has a dangling celestial reference`);
        }
      }
      for (const cluster of optionalRows(belt, "clusters")) {
        local(cluster, `belt ${belt.id}.cluster`, true);
        for (const site of optionalRows(cluster, "sites")) local(site, `cluster ${cluster.id}.site`);
      }
    }
    for (const gate of optionalRows(row, "stargates")) {
      local(gate, `system ${row.id}.stargate`);
      compatibleType(gate, "gate", [79787, 79880, 79881]);
      if ((gate.planetId && !planetIDs.has(id(gate.planetId, `gate ${gate.id}.planetId`))) ||
          (gate.lagrangePointId && !lagrangeIDs.has(id(gate.lagrangePointId, `gate ${gate.id}.lagrangePointId`)))) {
        throw new TypeError(`Gate ${gate.id} has a dangling local parent`);
      }
      if (canonicalSource && gate.planetId && gate.lagrangePointId && pointsById.get(gate.lagrangePointId)?.planetId !== gate.planetId) {
        throw new TypeError(`Canonical gate ${gate.id} has a Lagrange point belonging to another planet`);
      }
      gates.set(gate.id, { systemId: row.id, row: gate });
    }
    // Validates every optional field's schema slot/type/width in bounded memory.
    encodeUniverseDelta({ bundleVersion: versionString, systems: [row as any] });
  }
  for (const row of (canonicalSource ? array(raw.stations, "canonical stations") : (raw.stations || []))) {
    object(row, "station");
    const stationID = id(row.id, "station.id");
    if (stations.has(stationID) || localIDs.has(stationID) || universeIDs.has(stationID)) throw new TypeError(`Duplicate station/local object ID ${stationID}`);
    if (row.stationID !== stationID || !systems.has(id(row.solarSystemID, "station.solarSystemID"))) throw new TypeError(`Station ${stationID} has an inconsistent identity/system`);
    vector(row.position, `station ${stationID}.position`);
    const parent = planetsById.get(id(row.orbitID, "station.orbitID"));
    if (!parent || parent.systemId !== row.solarSystemID) throw new TypeError(`Station ${stationID} has a dangling/misowned planet`);
    if (row.lagrangePointID) {
      const point = pointsById.get(id(row.lagrangePointID, "station.lagrangePointID"));
      if (!point || point.systemId !== row.solarSystemID || point.planetId !== row.orbitID) throw new TypeError(`Station ${stationID} has a dangling/misowned Lagrange point`);
    }
    if (canonicalSource && (row.typeID !== 85226 || row.groupID !== 15)) throw new TypeError(`Station ${stationID} uses an incompatible 3640684 type/group`);
    id(row.ownerID, "station.ownerID"); id(row.operationID, "station.operationID");
    stations.set(stationID, row);
  }
  for (const { systemId, row } of gates.values()) {
    const destination = gates.get(id(row.destinationGateId, `gate ${row.id}.destinationGateId`));
    if (!destination || destination.systemId !== id(row.destinationSystemId, `gate ${row.id}.destinationSystemId`) ||
        destination.row.destinationGateId !== row.id || destination.row.destinationSystemId !== systemId) {
      throw new TypeError(`Gate ${row.id} has an inconsistent or nonreciprocal destination`);
    }
  }
  const starterSystemIds = array(raw.starterSystemIds, "starterSystemIds").map(value => {
    const key = id(value, "starterSystemId");
    if (!systems.has(key)) throw new TypeError(`Starter system ${key} is absent`);
    return key;
  }).sort((a, b) => a - b);
  if (new Set(starterSystemIds).size !== starterSystemIds.length) throw new TypeError("Duplicate starter system ID");
  // The loaded artifact is immutable after its digest has been checked.
  freezeTree(raw);
  freezeTree(version);
  Object.freeze(starterSystemIds);

  function makeDelta(systemIDs: number[], detail: boolean, sequence: number): UniverseDeltaInput {
    if (typeof detail !== "boolean" || !Number.isSafeInteger(sequence) || sequence < 0) {
      throw new TypeError("Invalid exploration delta detail/sequence");
    }
    const selected = array(systemIDs, "systemIDs").map(key => {
      const row = systems.get(id(key, "systemId"));
      if (!row) throw new TypeError(`Unknown exploration system ${key}`);
      return row;
    }).sort((a, b) => a.id - b.id);
    if (new Set(selected.map(row => row.id)).size !== selected.length) throw new TypeError("Duplicate delta system ID");
    const regionIDs = [...new Set(selected.map(row => row.regionId))].sort((a, b) => a - b);
    const constellationIDs = [...new Set(selected.map(row => row.constellationId))].sort((a, b) => a - b);
    return {
      schemaVersion: 14, bundleVersion: versionString, complete: false, sequence,
      regions: regionIDs.map(key => regions.get(key)) as any,
      constellations: constellationIDs.map(key => constellations.get(key)) as any,
      systems: selected.map(row => detail ? detailRow(row) : {
        ...Object.fromEntries(Object.entries(row).filter(([key]) => CHARTED_FIELDS.has(key))),
        revealLevel: 0,
      }) as any,
    };
  }
  return { revision, baseRevision: raw.temporaryLandscape?.worldRevision || revision,
    source, sourceProfile: canonicalSource ? CANONICAL_SOURCE_PROFILE : "3502403-MOD4-STUFF1", canonicalSource, stations,
    contentProfile: raw.temporaryLandscape || null,
    temporaryLandscape: raw.temporaryLandscape || null,
    version, versionString, regions, constellations, systems, starterSystemIds, makeDelta };
}

/** Overlay only authored content patches; never replace galaxy identity/geometry. */
export function createTemporaryExplorationWorld(raw: Row, profile: any) {
  profile = profile?.raw || profile;
  const canonicalContent = profile?.format === "evejs-frontier-landscape-content-v1" && profile.temporary === false &&
    profile.profile === "3572727-geography-3640684-content-v1";
  const legacyContent = profile?.format === "evejs-frontier-temporary-landscape-v1" && profile.temporary === true;
  if (!profile || (!legacyContent && !canonicalContent) ||
      profile.contentRevisionAlgorithm !== EXPLORATION_REVISION_ALGORITHM ||
      calculateExplorationWorldRevision(profile) !== profile.contentRevision) {
    throw new TypeError("Temporary landscape content revision/profile mismatch");
  }
  if (canonicalContent) {
    if (raw.source?.profile !== CANONICAL_SOURCE_PROFILE || profile.world?.label !== CANONICAL_SOURCE_LABEL) throw new TypeError("Canonical content must bind the canonical 3572727 geography");
    // This path is a production content profile, not the minimal legacy test
    // fixture. Validate its exact catalog and placement provenance as well.
    require("./temporaryLandscapeProfile").createTemporaryLandscapeProfile(profile, { worldRevision: raw.contentRevision });
  } else if (raw.source?.profile === CANONICAL_SOURCE_PROFILE) {
    throw new TypeError("Canonical geography requires its explicitly composed compatible content profile");
  }
  if (!profile || raw.contentRevision !== profile.world?.revision ||
      calculateExplorationWorldRevision(raw) !== raw.contentRevision) {
    throw new TypeError("Temporary landscape base world revision mismatch");
  }
  const baseRevision = raw.contentRevision;
  const systems = new Map(array(raw.systems, "systems").map(row => [row.id, row]));
  const seen = new Set<number>();
  const patched = new Map<number, Row>();
  for (const patch of array(profile.systems, "temporary landscape systems")) {
    const systemID = id(patch.id, "temporary landscape system.id"), original = systems.get(systemID);
    if (!original || seen.has(systemID)) throw new TypeError(`Temporary landscape has unknown/duplicate system ${systemID}`);
    seen.add(systemID);
    if (Object.keys(patch).some(key => !["id", "asteroidBelts", "planets"].includes(key))) {
      throw new TypeError("Temporary landscape cannot replace galaxy fields");
    }
    const planetPatches = new Map<number, Row>();
    for (const planet of patch.planets || []) {
      if (Object.keys(planet).some(key => !["id", "trojans"].includes(key)) || planetPatches.has(planet.id) ||
          !(original.planets || []).some(value => value.id === planet.id)) {
        throw new TypeError(`Temporary landscape has invalid planet patch ${planet.id}`);
      }
      planetPatches.set(planet.id, planet);
    }
    patched.set(systemID, { ...original, asteroidBelts: patch.asteroidBelts || [],
      planets: (original.planets || []).map(planet => ({ ...planet, trojans: planetPatches.get(planet.id)?.trojans || [] })) });
  }
  const merged: Row = { ...raw,
    systems: raw.systems.map(row => patched.get(row.id) || row),
    temporaryLandscape: { profile: profile.profile || "temporary-3640684-on-3502403-MOD4-STUFF1", revision: profile.contentRevision, worldRevision: baseRevision, temporary: !canonicalContent },
  };
  merged.contentRevision = calculateExplorationWorldRevision(merged);
  return createExplorationWorld(merged);
}

export function loadExplorationWorld(filename: string, temporaryProfile: any = null) {
  const raw = JSON.parse(fs.readFileSync(filename, "utf8"));
  return temporaryProfile ? createTemporaryExplorationWorld(raw, temporaryProfile) : createExplorationWorld(raw);
}

let configuredWorld: ReturnType<typeof createExplorationWorld> | null = null;
let configuredFilename = "";
export function getConfiguredExplorationWorld() {
  const filename = process.env.EVEJS_EXPLORATION_WORLD_PATH;
  if (!filename) throw new Error("EXPLORATION_WORLD_NOT_CONFIGURED");
  const profile = require("./temporaryLandscapeProfile").getTemporaryLandscapeProfile();
  const selection = `${filename}:${profile?.revision || ""}`;
  if (!configuredWorld || configuredFilename !== selection) {
    configuredWorld = loadExplorationWorld(filename, profile);
    configuredFilename = selection;
  }
  return configuredWorld;
}
