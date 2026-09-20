const fs = require("fs");
const path = require("path");

const CONFIG_PATH = path.resolve(
  __dirname,
  "../../../npc-factions.config.json",
);
const SUPPORTED_SCHEMA_VERSION = 1;
const NPC_DISPOSITIONS = new Set(["friendly", "neutral", "hostile"]);
const UNIDENTIFIED_DISPOSITIONS = new Set([
  "inherit",
  "hostile",
  "retaliate",
  "ignore",
  "suspicious",
]);
const NPC_TRANSPONDER_CHANNELS = new Set(["code"]);
const NPC_TRANSPONDER_GROUP_FIELDS = new Set([
  "spawnGroupID",
  "profileID",
  "faction",
]);
const NPC_TRANSPONDER_SIGNAL_MAX_LENGTH = 20;
const U64_MAX = (1n << 64n) - 1n;

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function assertRecord(value, fieldName) {
  if (!isRecord(value)) {
    throw new TypeError(`${fieldName} must be an object`);
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
  const normalized = Math.trunc(Number(value) || 0);
  if (normalized <= 0) {
    throw new TypeError(`${fieldName} must be a positive integer`);
  }
  return normalized;
}

function normalizeFactionKey(value, fieldName) {
  return nonEmptyText(value, fieldName).toLowerCase();
}

function canonicalMist(value, fieldName, allowZero = false) {
  if (typeof value !== "string") {
    throw new TypeError(`${fieldName} must be a canonical MIST integer string`);
  }
  const normalized = value.trim();
  if (!/^(0|[1-9][0-9]*)$/.test(normalized)) {
    throw new TypeError(`${fieldName} must be a canonical MIST integer string`);
  }
  const amount = BigInt(normalized);
  if ((!allowZero && amount === 0n) || amount > U64_MAX) {
    throw new TypeError(`${fieldName} must be ${allowZero ? "a" : "a positive"} u64 MIST amount`);
  }
  return amount.toString();
}

function normalizeSuiWalletFunding(value) {
  const source = assertRecord(value, "suiWalletFunding");
  if (typeof source.enabled !== "boolean") {
    throw new TypeError("suiWalletFunding.enabled must be a boolean");
  }
  if (typeof source.faucetEnabled !== "boolean") {
    throw new TypeError("suiWalletFunding.faucetEnabled must be a boolean");
  }
  const maxFaucetRequests = Number(source.maxFaucetRequests);
  if (!Number.isSafeInteger(maxFaucetRequests) || maxFaucetRequests < 0 || maxFaucetRequests > 20) {
    throw new TypeError("suiWalletFunding.maxFaucetRequests must be an integer from 0 through 20");
  }
  return {
    enabled: source.enabled,
    budgetMist: canonicalMist(source.budgetMist, "suiWalletFunding.budgetMist"),
    faucetEnabled: source.faucetEnabled,
    gasReserveMist: canonicalMist(source.gasReserveMist, "suiWalletFunding.gasReserveMist"),
    maxFaucetRequests,
  };
}

function normalizeDisposition(value, fieldName) {
  const normalized = nonEmptyText(value, fieldName).toLowerCase();
  if (!NPC_DISPOSITIONS.has(normalized)) {
    throw new TypeError(
      `${fieldName} must be friendly, neutral, or hostile; received ${normalized}`,
    );
  }
  return normalized;
}

function normalizeUnidentifiedDisposition(value, fieldName) {
  const normalized = nonEmptyText(value, fieldName).toLowerCase();
  if (!UNIDENTIFIED_DISPOSITIONS.has(normalized)) {
    throw new TypeError(
      `${fieldName} must be inherit, hostile, retaliate, ignore, or suspicious; received ${normalized}`,
    );
  }
  return normalized;
}

function normalizeTransponderSignal(value, fieldName) {
  const normalized = nonEmptyText(value, fieldName).toUpperCase();
  if (normalized.length > NPC_TRANSPONDER_SIGNAL_MAX_LENGTH) {
    throw new TypeError(
      `${fieldName} must be at most ${NPC_TRANSPONDER_SIGNAL_MAX_LENGTH} characters`,
    );
  }
  if (!/^[A-Z0-9][A-Z0-9_-]*$/.test(normalized)) {
    throw new TypeError(
      `${fieldName} must contain only letters, numbers, underscores, or hyphens`,
    );
  }
  return normalized;
}

function normalizeNpcTransponderConfig(value) {
  if (value == null) {
    return {
      enabled: false,
      channel: "code",
      defaultSignal: "NPC",
      groupIdentityFields: ["spawnGroupID", "profileID", "faction"],
    };
  }
  const source = assertRecord(value, "transponder");
  if (typeof source.enabled !== "boolean") {
    throw new TypeError("transponder.enabled must be a boolean");
  }
  const channel = nonEmptyText(
    source.channel == null ? "code" : source.channel,
    "transponder.channel",
  ).toLowerCase();
  if (!NPC_TRANSPONDER_CHANNELS.has(channel)) {
    throw new TypeError("transponder.channel must be code");
  }
  const rawGroupIdentityFields = source.groupIdentityFields == null
    ? ["spawnGroupID", "profileID", "faction"]
    : source.groupIdentityFields;
  if (!Array.isArray(rawGroupIdentityFields) || rawGroupIdentityFields.length === 0) {
    throw new TypeError("transponder.groupIdentityFields must be a non-empty array");
  }
  const seenFields = new Set();
  const groupIdentityFields = rawGroupIdentityFields.map((entry, index) => {
    const field = nonEmptyText(
      entry,
      `transponder.groupIdentityFields[${index}]`,
    );
    if (!NPC_TRANSPONDER_GROUP_FIELDS.has(field)) {
      throw new TypeError(
        `transponder.groupIdentityFields[${index}] must be spawnGroupID, profileID, or faction`,
      );
    }
    if (seenFields.has(field)) {
      throw new TypeError(`transponder.groupIdentityFields contains duplicate field ${field}`);
    }
    seenFields.add(field);
    return field;
  });
  return {
    enabled: source.enabled,
    channel,
    defaultSignal: normalizeTransponderSignal(
      source.defaultSignal == null ? "NPC" : source.defaultSignal,
      "transponder.defaultSignal",
    ),
    groupIdentityFields,
  };
}

function normalizeFactionIDList(value, fieldName) {
  if (value == null) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new TypeError(`${fieldName} must be an array`);
  }
  const seen = new Set();
  return value.map((entry, index) => {
    const factionID = positiveInteger(entry, `${fieldName}[${index}]`);
    if (seen.has(factionID)) {
      throw new TypeError(`${fieldName} contains duplicate faction ID ${factionID}`);
    }
    seen.add(factionID);
    return factionID;
  });
}

function normalizeFactionKeyList(value, fieldName) {
  if (value == null) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new TypeError(`${fieldName} must be an array`);
  }
  const seen = new Set();
  return value.map((entry, index) => {
    const factionKey = normalizeFactionKey(entry, `${fieldName}[${index}]`);
    if (seen.has(factionKey)) {
      throw new TypeError(`${fieldName} contains duplicate faction key ${factionKey}`);
    }
    seen.add(factionKey);
    return factionKey;
  });
}

function factionIDIdentity(factionID) {
  return `id:${positiveInteger(factionID, "factionID")}`;
}

function factionKeyIdentity(factionKey) {
  return `key:${normalizeFactionKey(factionKey, "factionKey")}`;
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

function validateConfig(rawConfig) {
  const source = assertRecord(rawConfig, "NPC faction config");
  const schemaVersion = Number(source.schemaVersion);
  if (!Number.isInteger(schemaVersion) || schemaVersion !== SUPPORTED_SCHEMA_VERSION) {
    throw new TypeError(
      `schemaVersion must be ${SUPPORTED_SCHEMA_VERSION}; received ${String(source.schemaVersion)}`,
    );
  }
  if (typeof source.enabled !== "boolean") {
    throw new TypeError("enabled must be a boolean");
  }
  const transponder = normalizeNpcTransponderConfig(source.transponder);
  const suiWalletFunding = normalizeSuiWalletFunding(source.suiWalletFunding);

  const rawDefaults = assertRecord(source.defaults, "defaults");
  if (typeof rawDefaults.retaliateAgainstAggressors !== "boolean") {
    throw new TypeError("defaults.retaliateAgainstAggressors must be a boolean");
  }
  const defaults = {
    sameFactionDisposition: normalizeDisposition(
      rawDefaults.sameFactionDisposition,
      "defaults.sameFactionDisposition",
    ),
    sameCorporationDisposition: normalizeDisposition(
      rawDefaults.sameCorporationDisposition,
      "defaults.sameCorporationDisposition",
    ),
    unlistedNpcDisposition: normalizeDisposition(
      rawDefaults.unlistedNpcDisposition,
      "defaults.unlistedNpcDisposition",
    ),
    unidentifiedDisposition: normalizeUnidentifiedDisposition(
      rawDefaults.unidentifiedDisposition,
      "defaults.unidentifiedDisposition",
    ),
    retaliateAgainstAggressors: rawDefaults.retaliateAgainstAggressors,
  };

  if (!Array.isArray(source.factions)) {
    throw new TypeError("factions must be an array");
  }
  const factionIdentities = new Set();
  const factions = source.factions.map((rawFaction, index) => {
    const fieldName = `factions[${index}]`;
    const faction = assertRecord(rawFaction, fieldName);
    const factionID = faction.factionID == null
      ? 0
      : positiveInteger(faction.factionID, `${fieldName}.factionID`);
    const factionKey = faction.factionKey == null
      ? null
      : normalizeFactionKey(faction.factionKey, `${fieldName}.factionKey`);
    if (factionID <= 0 && !factionKey) {
      throw new TypeError(`${fieldName} must define factionID or factionKey`);
    }
    const identities = [
      ...(factionID > 0 ? [factionIDIdentity(factionID)] : []),
      ...(factionKey ? [factionKeyIdentity(factionKey)] : []),
    ];
    for (const identity of identities) {
      if (factionIdentities.has(identity)) {
        throw new TypeError(`duplicate faction identity: ${identity}`);
      }
      factionIdentities.add(identity);
    }
    if (
      faction.retaliateAgainstAggressors !== undefined &&
      typeof faction.retaliateAgainstAggressors !== "boolean"
    ) {
      throw new TypeError(`${fieldName}.retaliateAgainstAggressors must be a boolean`);
    }
    return {
      factionID,
      factionKey,
      name: nonEmptyText(faction.name, `${fieldName}.name`),
      transponderSignal: faction.transponderSignal == null
        ? null
        : normalizeTransponderSignal(
            faction.transponderSignal,
            `${fieldName}.transponderSignal`,
          ),
      unidentifiedDisposition: faction.unidentifiedDisposition === undefined
        ? defaults.unidentifiedDisposition
        : normalizeUnidentifiedDisposition(
            faction.unidentifiedDisposition,
            `${fieldName}.unidentifiedDisposition`,
          ),
      retaliateAgainstAggressors: faction.retaliateAgainstAggressors === undefined
        ? defaults.retaliateAgainstAggressors
        : faction.retaliateAgainstAggressors,
    };
  });

  if (!Array.isArray(source.relations)) {
    throw new TypeError("relations must be an array");
  }
  const relationIDs = new Set();
  const relations = source.relations.map((rawRelation, index) => {
    const fieldName = `relations[${index}]`;
    const relation = assertRecord(rawRelation, fieldName);
    const id = nonEmptyText(relation.id, `${fieldName}.id`).toLowerCase();
    if (relationIDs.has(id)) {
      throw new TypeError(`duplicate relation id: ${id}`);
    }
    relationIDs.add(id);
    if (relation.reciprocal !== undefined && typeof relation.reciprocal !== "boolean") {
      throw new TypeError(`${fieldName}.reciprocal must be a boolean`);
    }
    const sourceFactionIDs = normalizeFactionIDList(
      relation.sourceFactionIDs,
      `${fieldName}.sourceFactionIDs`,
    );
    const targetFactionIDs = normalizeFactionIDList(
      relation.targetFactionIDs,
      `${fieldName}.targetFactionIDs`,
    );
    const sourceFactionKeys = normalizeFactionKeyList(
      relation.sourceFactionKeys,
      `${fieldName}.sourceFactionKeys`,
    );
    const targetFactionKeys = normalizeFactionKeyList(
      relation.targetFactionKeys,
      `${fieldName}.targetFactionKeys`,
    );
    if (sourceFactionIDs.length === 0 && sourceFactionKeys.length === 0) {
      throw new TypeError(`${fieldName} must define sourceFactionIDs or sourceFactionKeys`);
    }
    if (targetFactionIDs.length === 0 && targetFactionKeys.length === 0) {
      throw new TypeError(`${fieldName} must define targetFactionIDs or targetFactionKeys`);
    }
    return {
      id,
      sourceFactionIDs,
      targetFactionIDs,
      sourceFactionKeys,
      targetFactionKeys,
      disposition: normalizeDisposition(
        relation.disposition,
        `${fieldName}.disposition`,
      ),
      reciprocal: relation.reciprocal === true,
    };
  });

  return deepFreeze({
    schemaVersion,
    enabled: source.enabled,
    suiWalletFunding,
    transponder,
    defaults,
    factions,
    relations,
  });
}

function readConfig() {
  let payload;
  try {
    payload = fs.readFileSync(CONFIG_PATH, "utf8");
  } catch (error) {
    const message = error && error.message ? error.message : String(error);
    throw new Error(`Unable to read NPC faction config at ${CONFIG_PATH}: ${message}`);
  }
  try {
    return validateConfig(JSON.parse(String(payload).replace(/^\uFEFF/, "")));
  } catch (error) {
    const message = error && error.message ? error.message : String(error);
    throw new Error(`Invalid NPC faction config at ${CONFIG_PATH}: ${message}`);
  }
}

const CONFIG = readConfig();
const FACTIONS_BY_IDENTITY = new Map<string, any>();
for (const faction of CONFIG.factions) {
  if (faction.factionID > 0) {
    FACTIONS_BY_IDENTITY.set(factionIDIdentity(faction.factionID), faction);
  }
  if (faction.factionKey) {
    FACTIONS_BY_IDENTITY.set(factionKeyIdentity(faction.factionKey), faction);
  }
}
const RELATIONS_BY_PAIR = new Map<string, string>();
function relationPairIdentity(sourceIdentity, targetIdentity) {
  return `${sourceIdentity}\u0000${targetIdentity}`;
}
for (const relation of CONFIG.relations) {
  const sourceIdentities = [
    ...relation.sourceFactionIDs.map(factionIDIdentity),
    ...relation.sourceFactionKeys.map(factionKeyIdentity),
  ];
  const targetIdentities = [
    ...relation.targetFactionIDs.map(factionIDIdentity),
    ...relation.targetFactionKeys.map(factionKeyIdentity),
  ];
  for (const sourceIdentity of sourceIdentities) {
    for (const targetIdentity of targetIdentities) {
      RELATIONS_BY_PAIR.set(
        relationPairIdentity(sourceIdentity, targetIdentity),
        relation.disposition,
      );
      if (relation.reciprocal) {
        RELATIONS_BY_PAIR.set(
          relationPairIdentity(targetIdentity, sourceIdentity),
          relation.disposition,
        );
      }
    }
  }
}

function toPositiveInt(value, fallback = 0) {
  const normalized = Math.trunc(Number(value) || 0);
  return normalized > 0 ? normalized : fallback;
}

function resolveNpcFactionID(entity) {
  return toPositiveInt(
    entity && (
      entity.npcFactionID ??
      entity.factionID ??
      entity.warFactionID
    ),
    0,
  );
}

function resolveNpcFactionKey(entity) {
  const explicit = String(
    entity && (
      entity.npcFactionKey ??
      entity.frontierFactionKey ??
      ""
    ) || "",
  ).trim().toLowerCase();
  return explicit || null;
}

function resolveNpcFactionIdentity(entity) {
  const factionKey = resolveNpcFactionKey(entity);
  if (factionKey) {
    return factionKeyIdentity(factionKey);
  }
  const factionID = resolveNpcFactionID(entity);
  return factionID > 0 ? factionIDIdentity(factionID) : null;
}

function resolveNpcCorporationID(entity) {
  return toPositiveInt(
    entity && (entity.corporationID ?? entity.ownerID),
    0,
  );
}

function resolveNpcFactionDisposition(sourceEntity, targetEntity) {
  if (!CONFIG.enabled) {
    return null;
  }
  const identification = resolveNpcTargetIdentification(
    sourceEntity,
    targetEntity,
  );
  if (identification === "ally") {
    return "friendly";
  }
  if (identification === "unidentified") {
    const unidentifiedDisposition = resolveNpcUnidentifiedDisposition(sourceEntity);
    if (unidentifiedDisposition === "hostile") {
      return "hostile";
    }
    if (unidentifiedDisposition === "ignore") {
      return "friendly";
    }
    if (unidentifiedDisposition === "retaliate") {
      return "neutral";
    }
    if (unidentifiedDisposition === "suspicious") {
      return "neutral";
    }
  }
  const sourceFactionIdentity = resolveNpcFactionIdentity(sourceEntity);
  const targetFactionIdentity = resolveNpcFactionIdentity(targetEntity);
  if (
    sourceFactionIdentity &&
    sourceFactionIdentity === targetFactionIdentity
  ) {
    return CONFIG.defaults.sameFactionDisposition;
  }

  if (sourceFactionIdentity && targetFactionIdentity) {
    const configured = RELATIONS_BY_PAIR.get(
      relationPairIdentity(sourceFactionIdentity, targetFactionIdentity),
    );
    if (configured) {
      return configured;
    }
  }

  const sourceCorporationID = resolveNpcCorporationID(sourceEntity);
  const targetCorporationID = resolveNpcCorporationID(targetEntity);
  if (sourceCorporationID > 0 && sourceCorporationID === targetCorporationID) {
    return CONFIG.defaults.sameCorporationDisposition;
  }
  return CONFIG.defaults.unlistedNpcDisposition;
}

function resolveConfiguredFaction(sourceEntity) {
  const identity = resolveNpcFactionIdentity(sourceEntity);
  if (identity && FACTIONS_BY_IDENTITY.has(identity)) {
    return FACTIONS_BY_IDENTITY.get(identity);
  }
  const factionID = resolveNpcFactionID(sourceEntity);
  return factionID > 0
    ? FACTIONS_BY_IDENTITY.get(factionIDIdentity(factionID)) || null
    : null;
}

function isNpcTransponderEntity(entity) {
  if (!entity || typeof entity !== "object") {
    return false;
  }
  return (
    entity.nativeNpc === true ||
    entity.nativeNpcOccupied === true ||
    String(entity.npcEntityType || "").trim().length > 0
  );
}

function resolveNpcTransponderGroupIdentity(entity) {
  if (!isNpcTransponderEntity(entity)) {
    return null;
  }
  const explicit = String(entity.npcTransponderGroupID || "").trim();
  if (explicit) {
    return `group:${explicit}`;
  }
  for (const field of CONFIG.transponder.groupIdentityFields) {
    if (field === "spawnGroupID") {
      const spawnGroupID = String(
        entity.spawnGroupID ||
          (String(entity.selectionKind || "").trim() === "group"
            ? entity.selectionID
            : "") ||
          "",
      ).trim();
      if (spawnGroupID) {
        return `spawn:${spawnGroupID}`;
      }
    } else if (field === "profileID") {
      const profileID = String(
        entity.npcProfileID || entity.profileID || "",
      ).trim();
      if (profileID) {
        return `profile:${profileID}`;
      }
    } else if (field === "faction") {
      const factionIdentity = resolveNpcFactionIdentity(entity);
      if (factionIdentity) {
        return `faction:${factionIdentity}`;
      }
    }
  }
  const typeID = toPositiveInt(entity.typeID, 0);
  if (typeID > 0) {
    return `type:${typeID}`;
  }
  const groupID = toPositiveInt(entity.groupID, 0);
  return groupID > 0 ? `inventory-group:${groupID}` : null;
}

function resolveNpcTransponderConfiguration(entity) {
  if (!CONFIG.enabled || !CONFIG.transponder.enabled || !isNpcTransponderEntity(entity)) {
    return null;
  }
  const configuredFaction = resolveConfiguredFaction(entity);
  const explicitSignal = entity && entity.npcTransponderSignal;
  let signal = configuredFaction && configuredFaction.transponderSignal ||
    CONFIG.transponder.defaultSignal;
  if (explicitSignal != null && String(explicitSignal).trim() !== "") {
    try {
      signal = normalizeTransponderSignal(
        explicitSignal,
        "entity.npcTransponderSignal",
      );
    } catch (_) {
      // Runtime metadata can be supplied by authored spawn options. An
      // invalid override must not break verdict delivery for the scene; use
      // the validated faction/default signal instead.
    }
  }
  const groupIdentity = resolveNpcTransponderGroupIdentity(entity);
  if (!groupIdentity) {
    return null;
  }
  return {
    channel: CONFIG.transponder.channel,
    signal,
    groupIdentity,
  };
}

function resolveNpcTargetIdentification(sourceEntity, targetEntity, options: Record<string, any> = {}) {
  if (!CONFIG.enabled || !CONFIG.transponder.enabled || !isNpcTransponderEntity(sourceEntity)) {
    return null;
  }
  try {
    const iffRuntime = options.iffRuntime || require(path.join(
      __dirname,
      "../services/frontier/iffRuntime",
    ));
    if (
      !iffRuntime ||
      typeof iffRuntime.resolveEntityTransponder !== "function" ||
      typeof iffRuntime.transpondersMatch !== "function"
    ) {
      return null;
    }
    const sourceTransponder = iffRuntime.resolveEntityTransponder(sourceEntity);
    if (!sourceTransponder) {
      return null;
    }
    const targetTransponder = iffRuntime.resolveEntityTransponder(targetEntity);
    return targetTransponder && iffRuntime.transpondersMatch(
      sourceTransponder,
      targetTransponder,
      sourceEntity,
      targetEntity,
    )
      ? "ally"
      : "unidentified";
  } catch (_) {
    return null;
  }
}

function resolveNpcUnidentifiedDisposition(sourceEntity) {
  if (!CONFIG.enabled) {
    return "inherit";
  }
  const faction = resolveConfiguredFaction(sourceEntity);
  return faction
    ? faction.unidentifiedDisposition
    : CONFIG.defaults.unidentifiedDisposition;
}

function shouldNpcRetaliateAgainstAggressors(sourceEntity) {
  if (!CONFIG.enabled) {
    return false;
  }
  const faction = resolveConfiguredFaction(sourceEntity);
  return faction
    ? faction.retaliateAgainstAggressors === true
    : CONFIG.defaults.retaliateAgainstAggressors === true;
}

function hasConfiguredHostileNpcFactions(sourceEntity) {
  if (!CONFIG.enabled) {
    return false;
  }
  const sourceIdentity = resolveNpcFactionIdentity(sourceEntity);
  if (!sourceIdentity) {
    return false;
  }
  const prefix = `${sourceIdentity}\u0000`;
  for (const [pair, disposition] of RELATIONS_BY_PAIR.entries()) {
    if (pair.startsWith(prefix) && disposition === "hostile") {
      return true;
    }
  }
  return false;
}

function getAdditionalAutoAggroTargetClasses(sourceEntity) {
  if (!CONFIG.enabled) {
    return [];
  }
  const classes = new Set();
  if (
    hasConfiguredHostileNpcFactions(sourceEntity) ||
    shouldNpcRetaliateAgainstAggressors(sourceEntity)
  ) {
    classes.add("npc");
    classes.add("concord");
  }
  const unidentifiedDisposition = resolveNpcUnidentifiedDisposition(sourceEntity);
  if (
    unidentifiedDisposition === "hostile" ||
    unidentifiedDisposition === "retaliate" ||
    unidentifiedDisposition === "suspicious"
  ) {
    classes.add("npc");
    classes.add("concord");
    classes.add("player");
    classes.add("drone");
  }
  return [...classes];
}

function getConfig() {
  return cloneValue(CONFIG);
}

function getConfigSummary() {
  return {
    configPath: CONFIG_PATH,
    schemaVersion: CONFIG.schemaVersion,
    enabled: CONFIG.enabled,
    transponderEnabled: CONFIG.transponder.enabled,
    transponderChannel: CONFIG.transponder.channel,
    transponderSignalCount: CONFIG.factions.filter(
      (faction) => Boolean(faction.transponderSignal),
    ).length,
    suiWalletFundingEnabled: CONFIG.suiWalletFunding.enabled,
    suiWalletBudgetMist: CONFIG.suiWalletFunding.budgetMist,
    factionCount: CONFIG.factions.length,
    relationRuleCount: CONFIG.relations.length,
    resolvedRelationCount: RELATIONS_BY_PAIR.size,
  };
}

module.exports = {
  CONFIG_PATH,
  SUPPORTED_SCHEMA_VERSION,
  validateConfig,
  getConfig,
  getConfigSummary,
  resolveNpcFactionID,
  resolveNpcFactionKey,
  resolveNpcFactionIdentity,
  resolveNpcFactionDisposition,
  resolveNpcTransponderConfiguration,
  resolveNpcTransponderGroupIdentity,
  resolveNpcTargetIdentification,
  resolveNpcUnidentifiedDisposition,
  shouldNpcRetaliateAgainstAggressors,
  hasConfiguredHostileNpcFactions,
  getAdditionalAutoAggroTargetClasses,
};
