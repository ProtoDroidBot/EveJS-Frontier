const path = require("path");
const { randomUUID } = require("crypto");

const database = require(path.join(__dirname, "../../gameStore"));

const CREATION_PRESETS_TABLE = "creationPresets";
const CREATION_PRESET_SCHEMA_VERSION = 2;
const MAX_CREATION_PRESETS_PER_OWNER = 100;
const MAX_CREATION_PRESET_NAME_LENGTH = 50;
const MAX_CREATION_PRESET_DESCRIPTION_LENGTH = 500;

function cloneValue(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function toPositiveInt(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isSafeInteger(numeric) && numeric > 0 ? numeric : fallback;
}

function normalizeName(value) {
  return String(value == null ? "" : value)
    .trim()
    .slice(0, MAX_CREATION_PRESET_NAME_LENGTH);
}

function normalizeDescription(value) {
  return String(value == null ? "" : value)
    .trim()
    .slice(0, MAX_CREATION_PRESET_DESCRIPTION_LENGTH);
}

function defaultRoot() {
  return {
    _meta: { version: CREATION_PRESET_SCHEMA_VERSION },
    owners: {},
  };
}

function readRoot() {
  database.ensureTable(CREATION_PRESETS_TABLE);
  const result = database.read(CREATION_PRESETS_TABLE, "/");
  const root = result.success && result.data && typeof result.data === "object"
    // Never mutate the game-store cache before database.write(). The database
    // layer deliberately treats same-reference writes as unchanged; returning
    // its live object here would make otherwise successful preset CRUD appear
    // clean and therefore disappear after restart.
    ? cloneValue(result.data)
    : defaultRoot();
  if (!root._meta || typeof root._meta !== "object") {
    root._meta = { version: CREATION_PRESET_SCHEMA_VERSION };
    database.write(CREATION_PRESETS_TABLE, "/_meta", root._meta);
  } else if (toPositiveInt(root._meta.version, 0) < CREATION_PRESET_SCHEMA_VERSION) {
    root._meta.version = CREATION_PRESET_SCHEMA_VERSION;
    database.write(CREATION_PRESETS_TABLE, "/_meta", root._meta);
  }
  if (!root.owners || typeof root.owners !== "object") {
    root.owners = {};
  }
  return root;
}

function normalizePresetRecord(record, ownerID = null) {
  if (!record || typeof record !== "object") {
    return null;
  }
  const normalizedOwnerID = toPositiveInt(ownerID ?? record.ownerID, 0);
  const presetID = String(record.presetID || "").trim();
  const name = normalizeName(record.name);
  const creationTypeID = toPositiveInt(record.creationTypeID, 0);
  const revision = toPositiveInt(record.revision, 1);
  const composition = record.composition && typeof record.composition === "object"
    ? cloneValue(record.composition)
    : null;
  if (!normalizedOwnerID || !presetID || !name || !creationTypeID || !composition) {
    return null;
  }
  return {
    presetID,
    ownerID: normalizedOwnerID,
    name,
    description: normalizeDescription(record.description),
    createdAtMs: Math.max(0, Number(record.createdAtMs) || 0),
    updatedAtMs: Math.max(0, Number(record.updatedAtMs) || 0),
    revision,
    creationTypeID,
    schemaVersion: toPositiveInt(
      record.schemaVersion,
      CREATION_PRESET_SCHEMA_VERSION,
    ),
    sdeBuild: String(record.sdeBuild || "unknown"),
    sdeFingerprint: String(record.sdeFingerprint || ""),
    compositionHash: String(record.compositionHash || ""),
    composition,
  };
}

function ownerRecord(root, ownerID, create = false) {
  const numericOwnerID = toPositiveInt(ownerID, 0);
  if (!numericOwnerID) {
    return null;
  }
  const key = String(numericOwnerID);
  let record = root.owners[key];
  if ((!record || typeof record !== "object") && create) {
    record = { ownerID: numericOwnerID, presets: {} };
    root.owners[key] = record;
  }
  if (record && (!record.presets || typeof record.presets !== "object")) {
    record.presets = {};
  }
  return record || null;
}

function writeOwner(ownerID, record) {
  const result = database.write(
    CREATION_PRESETS_TABLE,
    `/owners/${toPositiveInt(ownerID, 0)}`,
    record,
  );
  if (!result.success) {
    return result;
  }
  const flush = database.flushTablesSync([CREATION_PRESETS_TABLE]);
  return flush && flush.success === true
    ? { success: true as const }
    : { success: false as const, errorMsg: "PERSISTENCE_FLUSH_ERROR" };
}

function listCreationPresets(ownerID) {
  const root = readRoot();
  const owner = ownerRecord(root, ownerID, false);
  return Object.values<any>(owner && owner.presets || {})
    .map((record) => normalizePresetRecord(record, ownerID))
    .filter(Boolean)
    .sort((left, right) => (
      right.updatedAtMs - left.updatedAtMs ||
      left.name.localeCompare(right.name) ||
      left.presetID.localeCompare(right.presetID)
    ));
}

function getCreationPreset(ownerID, presetID) {
  const root = readRoot();
  const owner = ownerRecord(root, ownerID, false);
  return normalizePresetRecord(
    owner && owner.presets && owner.presets[String(presetID || "")],
    ownerID,
  );
}

function createCreationPreset(ownerID, input, options: Record<string, any> = {}) {
  const numericOwnerID = toPositiveInt(ownerID, 0);
  const name = normalizeName(input && input.name);
  if (!numericOwnerID || !name) {
    return { success: false as const, errorMsg: "INVALID_PRESET" };
  }
  const root = readRoot();
  const owner = ownerRecord(root, numericOwnerID, true);
  if (Object.keys(owner.presets).length >= MAX_CREATION_PRESETS_PER_OWNER) {
    return { success: false as const, errorMsg: "PRESET_LIMIT_REACHED" };
  }
  const nowMs = Math.max(0, Number(options.nowMs) || Date.now());
  const presetID = String(options.presetID || randomUUID());
  if (!presetID || owner.presets[presetID]) {
    return { success: false as const, errorMsg: "PRESET_ID_CONFLICT" };
  }
  const record = normalizePresetRecord({
    ...input,
    presetID,
    ownerID: numericOwnerID,
    name,
    description: normalizeDescription(input && input.description),
    createdAtMs: nowMs,
    updatedAtMs: nowMs,
    revision: 1,
  }, numericOwnerID);
  if (!record) {
    return { success: false as const, errorMsg: "INVALID_PRESET" };
  }
  owner.presets[presetID] = record;
  const writeResult = writeOwner(numericOwnerID, owner);
  return writeResult.success
    ? { success: true as const, data: cloneValue(record) }
    : writeResult;
}

function updateCreationPresetMetadata(
  ownerID,
  presetID,
  changes,
  options: Record<string, any> = {},
) {
  const numericOwnerID = toPositiveInt(ownerID, 0);
  const root = readRoot();
  const owner = ownerRecord(root, numericOwnerID, false);
  const current = normalizePresetRecord(
    owner && owner.presets && owner.presets[String(presetID || "")],
    numericOwnerID,
  );
  if (!current) {
    return { success: false as const, errorMsg: "PRESET_NOT_FOUND" };
  }
  const name = changes && Object.prototype.hasOwnProperty.call(changes, "name")
    ? normalizeName(changes.name)
    : current.name;
  if (!name) {
    return { success: false as const, errorMsg: "INVALID_PRESET_NAME" };
  }
  const updated = {
    ...current,
    name,
    description: changes && Object.prototype.hasOwnProperty.call(changes, "description")
      ? normalizeDescription(changes.description)
      : current.description,
    revision: current.revision + 1,
    updatedAtMs: Math.max(0, Number(options.nowMs) || Date.now()),
  };
  owner.presets[current.presetID] = updated;
  const writeResult = writeOwner(numericOwnerID, owner);
  return writeResult.success
    ? { success: true as const, data: cloneValue(updated) }
    : writeResult;
}

function deleteCreationPreset(ownerID, presetID) {
  const numericOwnerID = toPositiveInt(ownerID, 0);
  const root = readRoot();
  const owner = ownerRecord(root, numericOwnerID, false);
  const key = String(presetID || "");
  if (!owner || !Object.prototype.hasOwnProperty.call(owner.presets, key)) {
    return { success: false as const, errorMsg: "PRESET_NOT_FOUND" };
  }
  delete owner.presets[key];
  const writeResult = writeOwner(numericOwnerID, owner);
  return writeResult.success
    ? { success: true as const, data: { presetID: key } }
    : writeResult;
}

module.exports = {
  CREATION_PRESETS_TABLE,
  CREATION_PRESET_SCHEMA_VERSION,
  MAX_CREATION_PRESETS_PER_OWNER,
  MAX_CREATION_PRESET_DESCRIPTION_LENGTH,
  MAX_CREATION_PRESET_NAME_LENGTH,
  createCreationPreset,
  deleteCreationPreset,
  getCreationPreset,
  listCreationPresets,
  normalizePresetRecord,
  updateCreationPresetMetadata,
};
