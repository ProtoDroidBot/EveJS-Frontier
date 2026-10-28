"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const FORMAT = "evejs-frontier-temporary-landscape-v1";
const CANONICAL_FORMAT = "evejs-frontier-landscape-content-v1";
const CANONICAL_PROFILE = "3572727-geography-3640684-content-v1";
const CANONICAL_WORLD_LABEL = "3572727-CANONICAL-FSD";
const CANONICAL_WORLD_PROFILE = "3572727-canonical-fsd-v1";
const CANONICAL_CONVERSION_POLICY = "canonical-landscape-3572727-catalog-3640684-v1";
const CANONICAL_ANCHOR_POLICY = "strict-physical-identity-v1";
const CANONICAL_PLACEMENT_SHA256 = "c45f205a152b8786d8b767629913d7c8cd8dd78a3f631e8ab3480e893d0d85db";
const CANONICAL_PLACEMENT_DECODED_SHA256 = "a034fcaa6fa0dcb53d6cb0eab11c58e831874a58c93a44c9297f4707e51c34cf";
const CANONICAL_ARCHIVE_SHA256 = "eee139e55d95d75e897eb944c8045fb9ee1ef1b86a8672c2f453e1fffcde9f89";
const CANONICAL_DIAGNOSTIC_DB_SHA256 = "989883f198c92df9780b0d771ef3c93764c4559b46cf7c059733a02d7c389f3a";
const CATALOG_OUTPUT_SHA256 = Object.freeze({
  dungeonAssetManipulations: "08771cae10cc3a342633010e74f57933f464f4769362b661bab8a39f7a9bd375",
  dungeonEnvironmentTemplates: "1237d7c37c8449853fa3c62f95a7129862234dad342849dcc29dc2f8a5d568ff",
  dungeons: "d80318590dcffe6bffeafbb312960c8e12a111e13fdb3fba9313cb74cede170d",
  ecosystem: "56a8a5f519732450ae0afa89386772353e17635c4a3608b0156992e2c90c02d4",
  landscape: "f4d7ff54463629f1a98f50a069b85d155322340d811171441807f2bed0d491b6",
  referencedTypes: "a4502c1568feae8bc8eaa10b995a20a201950d8246b73f3b4d59827451ef290f",
});
const WORLD_LABEL = "3502403-MOD4-STUFF1";
const SOURCE_HASHES = Object.freeze({
  landscape: "6cf052f8ff7fed9562c797b18e8a1138b29d90dcd253b5e54d88a94be2f81759",
  ecosystem: "5434f782769e8d8faaabd6e276eda75a29f7659c42cf064ac5e0d3f651f5980d",
  dungeons: "d92a283c531ab725ff4c928dd90ee72fc8dd82718bf09da87af580ac08acc3d6",
});
const TABLE_KEYS = Object.freeze({
  landscapeSites: "sites", landscapeEcosystems: "ecosystems",
  landscapeDungeonTemplates: "dungeons", frontierDungeonTemplates: "dungeons",
  itemTypes: "types", spaceComponentsByType: "types",
  asteroidBelts: "belts",
  typeDogma: "typesByTypeID",
});

function record(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError(`${label} must be an object`);
  return value;
}
function identifier(value, label) {
  if (!Number.isSafeInteger(value) || value <= 0) throw new TypeError(`${label} must be a positive safe integer`);
  return value;
}
function finite(value, label, minimum = -Infinity) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < minimum) throw new TypeError(`${label} must be a finite number >= ${minimum}`);
  return value;
}
function vector(value, label) {
  record(value, label);
  for (const axis of ["x", "y", "z"]) finite(value[axis], `${label}.${axis}`);
}
function rows(table, rowKey, label) {
  const value = record(table, label)[rowKey];
  if (!Array.isArray(value)) throw new TypeError(`${label}.${rowKey} must be an array`);
  return value;
}
function index(values, key, label) {
  const result = new Map<number, any>();
  for (const row of values) {
    record(row, label);
    const id = identifier(row[key], `${label}.${key}`);
    if (result.has(id)) throw new TypeError(`${label} contains duplicate ${id}`);
    result.set(id, row);
  }
  return result;
}
function freeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}

function getTemporaryLandscapeRuntimeSiteID(revision, siteID) {
  if (!/^[a-f0-9]{64}$/.test(revision || "")) throw new TypeError("Temporary landscape revision is required for runtime identity");
  identifier(siteID, "runtime site ID");
  const digest = crypto.createHash("sha256").update(`${FORMAT}:${revision}:site:${siteID}`).digest();
  // Dedicated high band leaves room for the environment builder's x100 slots
  // while remaining exactly representable by Number and the native uint64 wire.
  return 2 ** 44 + digest.readUIntBE(0, 6) % (2 ** 44);
}

/** Validate an opt-in sidecar without reading or changing a running world. */
function createTemporaryLandscapeProfile(raw, options: Record<string, any> = {}) {
  record(raw, "temporary landscape profile");
  const canonical = raw.format === CANONICAL_FORMAT;
  if (canonical) {
    if (raw.temporary !== false || raw.profile !== CANONICAL_PROFILE || raw.targetBuild !== 3640684 ||
        raw.conversionPolicyRevision !== CANONICAL_CONVERSION_POLICY || raw.anchorPolicyRevision !== CANONICAL_ANCHOR_POLICY) {
      throw new TypeError("Canonical landscape format/profile/target/policy is invalid");
    }
    const placements = raw.source?.placements;
    if (placements?.build !== 3572727 || placements.archiveSHA256 !== CANONICAL_ARCHIVE_SHA256 ||
        placements.files?.landscape?.sha256 !== CANONICAL_PLACEMENT_SHA256 ||
        placements.decodedOutput?.sha256 !== CANONICAL_PLACEMENT_DECODED_SHA256) {
      throw new TypeError("Canonical landscape placement provenance differs");
    }
    for (const [name, digest] of Object.entries(CATALOG_OUTPUT_SHA256)) {
      if (raw.source?.decodedOutputs?.[name]?.sha256 !== digest) {
        throw new TypeError(`Canonical compatible catalog fingerprint differs: ${name}`);
      }
    }
    if (raw.world?.label !== CANONICAL_WORLD_LABEL || raw.world.sourceProfile !== CANONICAL_WORLD_PROFILE ||
        raw.anchorProof?.policy !== CANONICAL_ANCHOR_POLICY ||
        raw.anchorProof?.worldRevision !== raw.world?.revision ||
        raw.anchorProof?.diagnosticDatabaseSHA256 !== CANONICAL_DIAGNOSTIC_DB_SHA256) {
      throw new TypeError("Canonical landscape world/anchor proof binding is invalid");
    }
  } else if (raw.format !== FORMAT || raw.temporary !== true) {
    throw new TypeError("Temporary landscape format/marker is invalid");
  }
  if (raw.source?.build !== 3640684) throw new TypeError("Temporary landscape source must be build 3640684");
  for (const [name, hash] of Object.entries(SOURCE_HASHES)) {
    if (raw.source?.files?.[name]?.sha256 !== hash) throw new TypeError(`Temporary landscape ${name} source fingerprint differs`);
  }
  if ((!canonical && raw.world?.label !== WORLD_LABEL) || !/^[a-f0-9]{64}$/.test(raw.world?.revision || "")) {
    throw new TypeError("Temporary landscape must bind the selected legacy world revision");
  }
  if (raw.contentRevisionAlgorithm !== "sha256-typed-f64-v1" ||
      !/^[a-f0-9]{64}$/.test(raw.contentRevision || "") ||
      require("./explorationWorld").calculateExplorationWorldRevision(raw) !== raw.contentRevision) {
    throw new TypeError("Temporary landscape content revision mismatch");
  }
  const tables = record(raw.tables, "tables");
  const types = index(rows(tables.itemTypes, "types", "itemTypes"), "typeID", "type");
  for (const type of types.values()) {
    identifier(type.groupID, "type.groupID"); identifier(type.categoryID, "type.categoryID");
    if (typeof type.name !== "string" || !type.name) throw new TypeError("Target type name is required");
    for (const field of ["radius", "mass", "volume"]) if (type[field] != null) finite(type[field], `type.${field}`, 0);
  }
  function typeExists(typeID, label, allowZero = false) {
    if (allowZero && (typeID === 0 || typeID == null)) return;
    identifier(typeID, label);
    if (!types.has(typeID)) throw new TypeError(`${label} ${typeID} has no target metadata`);
  }
  const ecosystems = index(rows(tables.landscapeEcosystems, "ecosystems", "landscapeEcosystems"), "ecosystemID", "ecosystem");
  const dungeons = index(rows(tables.landscapeDungeonTemplates, "dungeons", "landscapeDungeonTemplates"), "dungeonID", "dungeon");
  const allDungeons = index(rows(tables.frontierDungeonTemplates, "dungeons", "frontierDungeonTemplates"), "dungeonID", "frontier dungeon");
  const sites = index(rows(tables.landscapeSites, "sites", "landscapeSites"), "itemID", "site");
  for (const list of [dungeons, allDungeons]) for (const dungeon of list.values()) {
    if (!Array.isArray(dungeon.rooms)) throw new TypeError("Dungeon rooms must be an array");
    const roomIDs = new Set(), objectIDs = new Set();
    for (const room of dungeon.rooms) {
      identifier(room.roomID, "room.roomID");
      if (roomIDs.has(room.roomID)) throw new TypeError("Duplicate dungeon room");
      roomIDs.add(room.roomID); vector(room.position, "room.position");
      if (!Array.isArray(room.objects)) throw new TypeError("Dungeon room objects must be an array");
      for (const object of room.objects) {
        identifier(object.objectID, "dungeon object ID");
        if (objectIDs.has(object.objectID)) throw new TypeError("Duplicate dungeon object ID");
        objectIDs.add(object.objectID); typeExists(object.typeID, "dungeon object type");
        vector(object.position, "dungeon object position");
        if (typeof object.role !== "string" || !object.role) throw new TypeError("Dungeon object role is required");
      }
    }
  }
  for (const ecosystem of ecosystems.values()) {
    for (const field of ["naturalWorldPatterns", "brokenWorldPatterns", ...("wildWorldPatterns" in ecosystem ? ["wildWorldPatterns"] : [])]) {
      if (!Array.isArray(ecosystem[field])) throw new TypeError(`Ecosystem ${field} must be an array`);
      for (const pattern of ecosystem[field]) {
        if (!dungeons.has(identifier(pattern.dungeonID, "pattern dungeon"))) throw new TypeError("Ecosystem references an unavailable dungeon");
        finite(pattern.weight, "pattern weight", 0);
        for (const key of ["minOccurrences", "maxOccurrences"]) if (!Number.isSafeInteger(pattern[key]) || pattern[key] < 0) throw new TypeError(`Invalid ${key}`);
        if (pattern.maxOccurrences < pattern.minOccurrences) throw new TypeError("Invalid pattern occurrence interval");
      }
    }
    if (ecosystem.entryDungeonID) {
      if (!dungeons.has(identifier(ecosystem.entryDungeonID, "entry dungeon"))) throw new TypeError("Missing entry dungeon");
    }
    for (const field of ["beaconTypeID", "baseCloudTypeID", "postProcessTypeID"]) typeExists(ecosystem.entryPattern?.[field], `entryPattern.${field}`, true);
  }
  for (const site of sites.values()) {
    identifier(site.solarSystemID, "site system");
    if (!ecosystems.has(identifier(site.ecosystemID, "site ecosystem"))) throw new TypeError("Site references an unavailable ecosystem");
    typeExists(site.typeID, "site beacon type"); vector(site.position, "site position");
    if (site.dungeonID && !dungeons.has(site.dungeonID)) throw new TypeError("Site references an unavailable entry dungeon");
  }
  if (!Array.isArray(raw.systems)) throw new TypeError("Temporary landscape systems must be an array");
  const systems = index(raw.systems, "id", "mapped system");
  for (const site of sites.values()) if (!systems.has(site.solarSystemID)) throw new TypeError("Site system is absent from mapped systems");
  const runtimeSiteIDs = new Set();
  for (const siteID of sites.keys()) {
    const runtimeID = getTemporaryLandscapeRuntimeSiteID(raw.contentRevision, siteID);
    if (runtimeSiteIDs.has(runtimeID)) throw new TypeError("Temporary landscape runtime identity collision");
    runtimeSiteIDs.add(runtimeID);
  }
  const profile = { raw: freeze(raw), revision: raw.contentRevision, tables, types, sites, systems, ecosystems, dungeons };
  if (options.world) validateTemporaryLandscapeWorld(profile, options.world);
  if (options.worldRevision && options.worldRevision !== raw.world.revision) throw new TypeError("Temporary landscape world revision mismatch");
  return Object.freeze(profile);
}

function validateTemporaryLandscapeWorld(profile, world) {
  if (!world || (world.baseRevision || world.revision) !== profile.raw.world.revision || !(world.systems instanceof Map)) {
    throw new TypeError("Temporary landscape world revision mismatch");
  }
  for (const id of profile.systems.keys()) if (!world.systems.has(id)) throw new TypeError(`Temporary landscape system ${id} is outside selected world`);
  return true;
}

let cachedPath = "", cachedProfile = null, cachedValidatedWorld = null;
let tableCache = new Map<string, any>();
function getTemporaryLandscapeProfile() {
  const config = require("../../config");
  if (Number(config.clientBuild) !== 3640684) return null;
  const selected = process.env.EVEJS_LANDSCAPE_CONTENT_PATH || process.env.EVEJS_TEMPORARY_LANDSCAPE_PATH || config.temporaryLandscapePath;
  if (!selected) return null;
  const filename = path.resolve(String(selected));
  if (cachedPath !== filename || !cachedProfile) {
    const profile = createTemporaryLandscapeProfile(JSON.parse(fs.readFileSync(filename, "utf8")));
    cachedProfile = profile; cachedPath = filename; cachedValidatedWorld = null; tableCache = new Map();
  }
  return cachedProfile;
}

function getTemporaryLandscapeTable(tableName, readBaseline) {
  if (!Object.hasOwn(TABLE_KEYS, tableName)) return null;
  const profile = getTemporaryLandscapeProfile();
  if (!profile) return null;
  const world = require("./explorationWorld").getConfiguredExplorationWorld();
  if (cachedValidatedWorld !== world) {
    validateTemporaryLandscapeWorld(profile, world);
    cachedValidatedWorld = world;
  }
  if (tableCache.has(tableName)) return tableCache.get(tableName);
  // Exploration's abstract orbital rings are not mineable scene entities.
  // The target sidecar's sites and authored dungeon resources replace the old
  // procedural field catalog while this temporary profile is selected.
  if (tableName === "asteroidBelts") return { belts: [], temporaryLandscapeRevision: profile.revision };
  if (tableName === "typeDogma") {
    const baseline = readBaseline() || {}, typesByTypeID = { ...(baseline.typesByTypeID || {}) };
    for (const type of profile.types.values()) {
      const attributes = Object.fromEntries((type.dogma?.dogmaAttributes || []).map(entry => [String(entry.attributeID), entry.value]));
      const effectEntries = (type.dogma?.dogmaEffects || []).map(entry => ({ effectID: entry.effectID, isDefault: entry.isDefault ? 1 : 0 }));
      typesByTypeID[String(type.typeID)] = { typeID: type.typeID, typeName: type.name, attributes,
        attributeCount: Object.keys(attributes).length, effectEntries, effects: effectEntries.map(entry => entry.effectID), effectCount: effectEntries.length };
    }
    const value = { ...baseline, typesByTypeID, temporaryLandscapeRevision: profile.revision };
    tableCache.set(tableName, value); return value;
  }
  const table = tableName === "spaceComponentsByType"
    ? { types: [...profile.types.values()].map(type => ({ ...(type.spaceComponents || {}), _key: type.typeID, typeID: type.typeID })) }
    : profile.tables[tableName];
  if (!table) return null;
  if (tableName === "landscapeSites") {
    const value = { ...table, sites: table.sites.filter(site => {
      const enabled = profile.ecosystems.get(site.ecosystemID)?.spawnEnabled;
      return enabled !== false && enabled !== 0;
    }).map(site => ({ ...site, temporaryLandscapeRevision: profile.revision })) };
    tableCache.set(tableName, value); return value;
  }
  if (tableName !== "itemTypes" && tableName !== "spaceComponentsByType") return table;
  const baseline = readBaseline() || {}, rowKey = TABLE_KEYS[tableName];
  const source = baseline[rowKey] || [];
  const prior = new Map((Array.isArray(source) ? source : Object.values<any>(source)).map(row => [Number(row.typeID ?? row._key), row]));
  for (const row of table[rowKey]) prior.set(Number(row.typeID ?? row._key), row);
  const value = { ...baseline, [rowKey]: [...prior.values()], temporaryLandscapeRevision: profile.revision };
  tableCache.set(tableName, value); return value;
}

function clearTemporaryLandscapeCache() { cachedPath = ""; cachedProfile = null; cachedValidatedWorld = null; tableCache = new Map(); }
module.exports = { FORMAT, SOURCE_HASHES, CANONICAL_FORMAT, CANONICAL_PROFILE, CANONICAL_WORLD_LABEL,
  CANONICAL_WORLD_PROFILE, CANONICAL_CONVERSION_POLICY, CANONICAL_ANCHOR_POLICY, CANONICAL_PLACEMENT_SHA256,
  CANONICAL_PLACEMENT_DECODED_SHA256, CANONICAL_ARCHIVE_SHA256, CANONICAL_DIAGNOSTIC_DB_SHA256, CATALOG_OUTPUT_SHA256,
  createTemporaryLandscapeProfile, validateTemporaryLandscapeWorld,
  getTemporaryLandscapeProfile, getTemporaryLandscapeTable, clearTemporaryLandscapeCache, getTemporaryLandscapeRuntimeSiteID };
