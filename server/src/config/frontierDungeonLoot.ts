const fs = require("fs");
const path = require("path");

const CONFIG_PATH = path.resolve(
  __dirname,
  "../../../frontier-dungeon-loot.json",
);
const SUPPORTED_SCHEMA_VERSION = 1;
const NPC_LOOT_TABLE = "npcLootTables";

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function assertRecord(value, fieldName) {
  if (!isRecord(value)) {
    throw new TypeError(`${fieldName} must be an object`);
  }
  return value;
}

function assertArray(value, fieldName) {
  if (!Array.isArray(value)) {
    throw new TypeError(`${fieldName} must be an array`);
  }
  return value;
}

function nonEmptyText(value, fieldName) {
  const normalized = String(value == null ? "" : value).trim();
  if (!normalized) {
    throw new TypeError(`${fieldName} must be non-empty text`);
  }
  return normalized;
}

function positiveInteger(value, fieldName) {
  const normalized = Number(value);
  if (!Number.isInteger(normalized) || normalized <= 0) {
    throw new TypeError(`${fieldName} must be a positive integer`);
  }
  return normalized;
}

function nonNegativeInteger(value, fieldName) {
  const normalized = Number(value);
  if (!Number.isInteger(normalized) || normalized < 0) {
    throw new TypeError(`${fieldName} must be a non-negative integer`);
  }
  return normalized;
}

function requiredBoolean(value, fieldName) {
  if (typeof value !== "boolean") {
    throw new TypeError(`${fieldName} must be a boolean`);
  }
  return value;
}

function canonicalPositiveIntegerKey(value, fieldName) {
  const normalized = positiveInteger(value, fieldName);
  if (String(normalized) !== String(value)) {
    throw new TypeError(`${fieldName} must use canonical positive-integer text`);
  }
  return normalized;
}

function cloneValue(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) {
    return value;
  }
  for (const child of Object.values<any>(value)) {
    deepFreeze(child);
  }
  return Object.freeze(value);
}

function readRawConfig() {
  let text;
  try {
    text = fs.readFileSync(CONFIG_PATH, "utf8");
  } catch (error) {
    throw new Error(
      `Unable to read Frontier dungeon loot config at ${CONFIG_PATH}: ${error.message}`,
    );
  }
  try {
    return JSON.parse(String(text).replace(/^\uFEFF/, ""));
  } catch (error) {
    throw new SyntaxError(
      `Invalid Frontier dungeon loot config at ${CONFIG_PATH}: ${error.message}`,
    );
  }
}

function normalizeEntry(value, fieldName) {
  const entry = assertRecord(value, fieldName);
  const minQuantity = positiveInteger(
    entry.minQuantity == null ? 1 : entry.minQuantity,
    `${fieldName}.minQuantity`,
  );
  const maxQuantity = positiveInteger(
    entry.maxQuantity == null ? minQuantity : entry.maxQuantity,
    `${fieldName}.maxQuantity`,
  );
  if (maxQuantity < minQuantity) {
    throw new TypeError(`${fieldName}.maxQuantity must be greater than or equal to minQuantity`);
  }
  return {
    typeID: positiveInteger(entry.typeID, `${fieldName}.typeID`),
    ...(entry.itemName == null
      ? {}
      : { itemName: nonEmptyText(entry.itemName, `${fieldName}.itemName`) }),
    weight: positiveInteger(entry.weight == null ? 1 : entry.weight, `${fieldName}.weight`),
    minQuantity,
    maxQuantity,
    ...(entry.singleton == null
      ? {}
      : { singleton: requiredBoolean(entry.singleton, `${fieldName}.singleton`) }),
  };
}

function normalizeLootTable(rawTable, lootTableID) {
  const fieldName = `lootTables.${lootTableID}`;
  const table = assertRecord(rawTable, fieldName);
  const minEntries = nonNegativeInteger(table.minEntries, `${fieldName}.minEntries`);
  const maxEntries = nonNegativeInteger(table.maxEntries, `${fieldName}.maxEntries`);
  if (maxEntries < minEntries) {
    throw new TypeError(`${fieldName}.maxEntries must be greater than or equal to minEntries`);
  }
  const entries = assertArray(table.entries, `${fieldName}.entries`)
    .map((entry, index) => normalizeEntry(entry, `${fieldName}.entries[${index}]`));
  if (entries.length <= 0 && maxEntries > 0) {
    throw new TypeError(`${fieldName}.entries must not be empty when maxEntries is positive`);
  }
  if (table.allowDuplicates !== true && maxEntries > entries.length) {
    throw new TypeError(
      `${fieldName}.maxEntries cannot exceed its entry count unless allowDuplicates is true`,
    );
  }
  return {
    lootTableID,
    name: nonEmptyText(table.name, `${fieldName}.name`),
    description: nonEmptyText(table.description, `${fieldName}.description`),
    minEntries,
    maxEntries,
    allowDuplicates: requiredBoolean(table.allowDuplicates, `${fieldName}.allowDuplicates`),
    entries,
  };
}

function normalizeTypeMappings(value, fieldName, lootTables) {
  const mappings = assertRecord(value, fieldName);
  const normalized: Record<string, any> = {};
  for (const [typeKey, rawLootTableID] of Object.entries<any>(mappings)) {
    canonicalPositiveIntegerKey(typeKey, `${fieldName} key ${typeKey}`);
    const lootTableID = nonEmptyText(rawLootTableID, `${fieldName}.${typeKey}`);
    if (!lootTables[lootTableID]) {
      throw new TypeError(`${fieldName}.${typeKey} references unknown loot table ${lootTableID}`);
    }
    normalized[typeKey] = lootTableID;
  }
  return normalized;
}

function validateConfig(rawConfig) {
  const raw = assertRecord(rawConfig, "frontier dungeon loot config");
  const schemaVersion = positiveInteger(raw.schemaVersion, "schemaVersion");
  if (schemaVersion !== SUPPORTED_SCHEMA_VERSION) {
    throw new TypeError(
      `schemaVersion must be ${SUPPORTED_SCHEMA_VERSION}; received ${schemaVersion}`,
    );
  }
  const source = assertRecord(raw.source, "source");
  const lootTables: Record<string, any> = {};
  for (const [lootTableID, rawTable] of Object.entries<any>(
    assertRecord(raw.lootTables, "lootTables"),
  )) {
    const normalizedID = nonEmptyText(lootTableID, "lootTables key");
    lootTables[normalizedID] = normalizeLootTable(rawTable, normalizedID);
  }
  if (Object.keys(lootTables).length <= 0) {
    throw new TypeError("lootTables must contain at least one table");
  }
  const typeMappings = assertRecord(raw.typeMappings, "typeMappings");
  const cargoContainers = normalizeTypeMappings(
    typeMappings.cargoContainers,
    "typeMappings.cargoContainers",
    lootTables,
  );
  const wrecks = normalizeTypeMappings(
    typeMappings.wrecks,
    "typeMappings.wrecks",
    lootTables,
  );
  return {
    schemaVersion,
    enabled: requiredBoolean(raw.enabled, "enabled"),
    source: {
      clientBuild: positiveInteger(source.clientBuild, "source.clientBuild"),
      notes: nonEmptyText(source.notes, "source.notes"),
    },
    lootTables,
    typeMappings: { cargoContainers, wrecks },
  };
}

const config = deepFreeze(validateConfig(readRawConfig()));

function getConfig() {
  return config;
}

function getConfigSummary() {
  return {
    configPath: CONFIG_PATH,
    schemaVersion: config.schemaVersion,
    enabled: config.enabled,
    clientBuild: config.source.clientBuild,
    lootTableCount: Object.keys(config.lootTables).length,
    cargoContainerTypeCount: Object.keys(config.typeMappings.cargoContainers).length,
    wreckTypeCount: Object.keys(config.typeMappings.wrecks).length,
  };
}

function resolveTypeID(value) {
  if (value && typeof value === "object") {
    return positiveInteger(
      value.typeID || value.slimTypeID || value.presentationTypeID,
      "typeID",
    );
  }
  const numeric = Number(value);
  return Number.isInteger(numeric) && numeric > 0 ? numeric : 0;
}

function resolveMappedLootTable(value, mappingKind) {
  if (!config.enabled) {
    return null;
  }
  let typeID;
  try {
    typeID = resolveTypeID(value);
  } catch (_error) {
    return null;
  }
  if (typeID <= 0) {
    return null;
  }
  const mapping = config.typeMappings[mappingKind] || {};
  const lootTableID = mapping[String(typeID)] || null;
  const lootTable = lootTableID ? config.lootTables[lootTableID] || null : null;
  return lootTable
    ? {
      typeID,
      mappingKind,
      lootTableID,
      lootTable: cloneValue(lootTable),
    }
    : null;
}

function resolveCargoContainerLootTable(value) {
  return resolveMappedLootTable(value, "cargoContainers");
}

function resolveWreckLootTable(value) {
  return resolveMappedLootTable(value, "wrecks");
}

function getGeneratedNpcRows(tableName) {
  if (!config.enabled || String(tableName || "").trim() !== NPC_LOOT_TABLE) {
    return [];
  }
  return Object.values<any>(config.lootTables).map((table) => cloneValue(table));
}

module.exports = {
  CONFIG_PATH,
  getConfig,
  getConfigSummary,
  resolveCargoContainerLootTable,
  resolveWreckLootTable,
  getGeneratedNpcRows,
};
