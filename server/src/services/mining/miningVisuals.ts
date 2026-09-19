const path = require("path");

// Phase 0 / 0.C: mining visuals via an ownership-scoped repository.
const {
  createTableRepository,
} = require(path.join(__dirname, "../../gameStore/tableRepository"));
const repo = createTableRepository("service:mining", { strict: true });
const {
  resolveItemByTypeID,
} = require(path.join(__dirname, "../inventory/itemTypeRegistry"));
const {
  TABLE,
  readStaticTable,
} = require(path.join(__dirname, "../_shared/referenceData"));

const ASTEROID_OUTPUT_TYPE_ATTRIBUTE_ID = 6070;
const CANONICAL_MINING_CARRIER_BY_YIELD_TYPE_ID = Object.freeze({
  77800: Object.freeze({ typeID: 91374, groupID: 5004, categoryID: 25, name: "Char" }),
  77810: Object.freeze({ typeID: 91375, groupID: 5005, categoryID: 25, name: "Slag" }),
  78426: Object.freeze({ typeID: 91376, groupID: 5006, categoryID: 25, name: "Ingot" }),
  77811: Object.freeze({ typeID: 91377, groupID: 5007, categoryID: 25, name: "Comet" }),
  78446: Object.freeze({ typeID: 91378, groupID: 5008, categoryID: 25, name: "Dewdrop" }),
  78447: Object.freeze({ typeID: 91379, groupID: 5009, categoryID: 25, name: "Ember" }),
  78448: Object.freeze({ typeID: 91380, groupID: 5010, categoryID: 25, name: "Glint" }),
  78449: Object.freeze({ typeID: 91381, groupID: 5011, categoryID: 25, name: "Soot" }),
});

function toPositiveInt(value, fallback = 0) {
  const numeric = Math.trunc(Number(value) || 0);
  return numeric > 0 ? numeric : fallback;
}

function normalizeOreMapPayload(payload) {
  if (!payload || typeof payload !== "object") {
    return {};
  }
  if (payload.systems && typeof payload.systems === "object") {
    return payload.systems;
  }
  if (payload.data && typeof payload.data === "object") {
    return payload.data;
  }
  return payload;
}

let cachedOreMap = null;
let cachedCarrierTypeIDsByYieldTypeID = null;

function getAsteroidOutputTypeID(typeID) {
  const root = readStaticTable(TABLE.TYPE_DOGMA) || {};
  const record = root.typesByTypeID && root.typesByTypeID[String(toPositiveInt(typeID, 0))];
  const attributes = record && record.attributes;
  if (!attributes || typeof attributes !== "object") {
    return 0;
  }
  return toPositiveInt(
    attributes[String(ASTEROID_OUTPUT_TYPE_ATTRIBUTE_ID)],
    0,
  );
}

function getCarrierTypeIDsByYieldTypeID() {
  if (cachedCarrierTypeIDsByYieldTypeID) {
    return cachedCarrierTypeIDsByYieldTypeID;
  }

  const carrierTypeIDsByYieldTypeID = new Map();
  const root = readStaticTable(TABLE.TYPE_DOGMA) || {};
  const typesByTypeID = root.typesByTypeID && typeof root.typesByTypeID === "object"
    ? root.typesByTypeID
    : {};

  for (const [typeIDText, record] of Object.entries<any>(typesByTypeID)) {
    const carrierTypeID = toPositiveInt(typeIDText, 0);
    const yieldTypeID = toPositiveInt(
      record && record.attributes &&
        record.attributes[String(ASTEROID_OUTPUT_TYPE_ATTRIBUTE_ID)],
      0,
    );
    if (carrierTypeID <= 0 || yieldTypeID <= 0 || carrierTypeID === yieldTypeID) {
      continue;
    }

    const existingTypeID = toPositiveInt(
      carrierTypeIDsByYieldTypeID.get(yieldTypeID),
      0,
    );
    // Some resource families expose multiple carrier variants for the same
    // output. The lowest type ID is the canonical/default carrier in the SDE
    // (for example Char 91374 -> Feldspar Crystals 77800).
    if (existingTypeID <= 0 || carrierTypeID < existingTypeID) {
      carrierTypeIDsByYieldTypeID.set(yieldTypeID, carrierTypeID);
    }
  }

  cachedCarrierTypeIDsByYieldTypeID = carrierTypeIDsByYieldTypeID;
  return cachedCarrierTypeIDsByYieldTypeID;
}

function resolveMiningResourceIdentity(typeRecordOrID) {
  const sourceTypeID = toPositiveInt(
    typeRecordOrID && typeof typeRecordOrID === "object"
      ? typeRecordOrID.typeID
      : typeRecordOrID,
    0,
  );
  const sourceTypeRecord = typeRecordOrID && typeof typeRecordOrID === "object"
    ? typeRecordOrID
    : resolveItemByTypeID(sourceTypeID);

  if (sourceTypeID <= 0) {
    return {
      carrierTypeRecord: sourceTypeRecord || null,
      yieldTypeRecord: sourceTypeRecord || null,
    };
  }

  const canonicalCarrierEntry = Object.entries<any>(
    CANONICAL_MINING_CARRIER_BY_YIELD_TYPE_ID,
  ).find(([, carrier]) => toPositiveInt(carrier && carrier.typeID, 0) === sourceTypeID);
  if (canonicalCarrierEntry) {
    const canonicalYieldTypeID = toPositiveInt(canonicalCarrierEntry[0], 0);
    const canonicalCarrier = canonicalCarrierEntry[1];
    return {
      carrierTypeRecord:
        sourceTypeRecord || resolveItemByTypeID(sourceTypeID) || canonicalCarrier,
      yieldTypeRecord:
        resolveItemByTypeID(canonicalYieldTypeID) || {
          typeID: canonicalYieldTypeID,
        },
    };
  }

  const directYieldTypeID = getAsteroidOutputTypeID(sourceTypeID);
  if (directYieldTypeID > 0 && directYieldTypeID !== sourceTypeID) {
    return {
      carrierTypeRecord: sourceTypeRecord || resolveItemByTypeID(sourceTypeID),
      yieldTypeRecord:
        resolveItemByTypeID(directYieldTypeID) || sourceTypeRecord || null,
    };
  }

  const carrierTypeID = toPositiveInt(
    getCarrierTypeIDsByYieldTypeID().get(sourceTypeID) ||
      (
        CANONICAL_MINING_CARRIER_BY_YIELD_TYPE_ID[sourceTypeID] &&
        CANONICAL_MINING_CARRIER_BY_YIELD_TYPE_ID[sourceTypeID].typeID
      ),
    0,
  );
  const canonicalCarrier = CANONICAL_MINING_CARRIER_BY_YIELD_TYPE_ID[sourceTypeID] || null;
  return {
    carrierTypeRecord:
      (carrierTypeID > 0 && resolveItemByTypeID(carrierTypeID)) ||
      canonicalCarrier ||
      sourceTypeRecord ||
      null,
    yieldTypeRecord: sourceTypeRecord || resolveItemByTypeID(sourceTypeID),
  };
}

function loadSolarSystemOreMap() {
  if (cachedOreMap) {
    return cachedOreMap;
  }

  const candidates = [
    repo.read("asteroidTypesBySolarSystemID", "/"),
    repo.read("asteroidTypesBySolarSystemID", "/systems"),
    repo.read("asteroidTypesBySolarSystemID", "/data"),
  ];

  for (const result of candidates) {
    if (result && result.success && result.data) {
      cachedOreMap = normalizeOreMapPayload(result.data);
      return cachedOreMap;
    }
  }

  cachedOreMap = {};
  return cachedOreMap;
}

function extractSystemOreEntries(oreMap, systemID) {
  if (!oreMap || typeof oreMap !== "object") {
    return [];
  }

  const key = String(toPositiveInt(systemID, 0));
  if (key && Array.isArray(oreMap[key])) {
    return oreMap[key];
  }

  if (Array.isArray(oreMap)) {
    const matched = oreMap.filter((row) => {
      const rowSystemID = toPositiveInt(
        row && (row.solarSystemID ?? row.systemID),
        0,
      );
      return rowSystemID === toPositiveInt(systemID, 0);
    });
    if (matched.length > 0) {
      return matched;
    }
  }

  return [];
}

function normalizeSystemOreEntry(entry) {
  if (typeof entry === "number" || typeof entry === "string") {
    const typeID = toPositiveInt(entry, 0);
    return typeID > 0 ? { typeID } : null;
  }
  if (!entry || typeof entry !== "object") {
    return null;
  }

  if (Array.isArray(entry.oreTypeIDs)) {
    return null;
  }

  const typeID = toPositiveInt(
    entry.typeID ?? entry.oreTypeID ?? entry.visualTypeID ?? entry.shellTypeID,
    0,
  );
  if (typeID <= 0) {
    return null;
  }

  const normalized = { typeID };
  const metadataKeys = [
    "weight",
    "spawnWeight",
    "chance",
    "probability",
    "frequency",
    "abundance",
    "quantity",
    "count",
  ];
  for (const key of metadataKeys) {
    if (Object.prototype.hasOwnProperty.call(entry, key)) {
      normalized[key] = entry[key];
    }
  }
  return normalized;
}

function getSolarSystemOreTypeRecords(systemID) {
  const normalizedSystemID = toPositiveInt(systemID, 0);
  if (normalizedSystemID <= 0) {
    return [];
  }

  const oreMap = loadSolarSystemOreMap();
  const entries = extractSystemOreEntries(oreMap, normalizedSystemID);

  const mergedByTypeID = new Map();
  for (const rawEntry of Array.isArray(entries) ? entries : []) {
    if (rawEntry && typeof rawEntry === "object" && Array.isArray(rawEntry.oreTypeIDs)) {
      for (const oreTypeID of rawEntry.oreTypeIDs) {
        const normalized = normalizeSystemOreEntry(oreTypeID);
        if (!normalized) {
          continue;
        }
        const item = resolveItemByTypeID(normalized.typeID);
        if (!item) {
          continue;
        }
        const existing = mergedByTypeID.get(normalized.typeID) || {};
        mergedByTypeID.set(normalized.typeID, {
          ...item,
          ...existing,
          ...normalized,
        });
      }
      continue;
    }

    const normalized = normalizeSystemOreEntry(rawEntry);
    if (!normalized) {
      continue;
    }
    const item = resolveItemByTypeID(normalized.typeID);
    if (!item) {
      continue;
    }
    const existing = mergedByTypeID.get(normalized.typeID) || {};
    mergedByTypeID.set(normalized.typeID, {
      ...item,
      ...existing,
      ...normalized,
    });
  }

  return Array.from(mergedByTypeID.values());
}

function resolveMiningVisualPresentation(typeRecord, overrides: Record<string, any> = {}) {
  const resolved = typeRecord && typeof typeRecord === "object"
    ? typeRecord
    : resolveItemByTypeID(toPositiveInt(typeRecord, 0));
  const visualTypeID = toPositiveInt(
    overrides.visualTypeID ?? overrides.typeID ?? (resolved && resolved.typeID),
    0,
  );
  const graphicID = toPositiveInt(
    overrides.graphicID ?? (resolved && resolved.graphicID),
    0,
  );
  const radius = Number.isFinite(Number(overrides.radius))
    ? Number(overrides.radius)
    : Number.isFinite(Number(resolved && resolved.radius))
      ? Number(resolved.radius)
      : null;
  return {
    graphicID,
    radius,
    typeID: visualTypeID,
    visualTypeID,
  };
}

module.exports = {
  getSolarSystemOreTypeRecords,
  resolveMiningResourceIdentity,
  resolveMiningVisualPresentation,
};
