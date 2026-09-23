const fs = require("fs");
const path = require("path");

const CONFIG_PATH = path.resolve(
  __dirname,
  "../../../npc-factions.config.json",
);
const SUPPORTED_SCHEMA_VERSION = 2;
const LEGACY_SCHEMA_VERSIONS = new Set([1]);
const NPC_DISPOSITIONS = new Set(["friendly", "neutral", "hostile"]);
const UNIDENTIFIED_DISPOSITIONS = new Set([
  "inherit",
  "hostile",
  "retaliate",
  "ignore",
  "suspicious",
]);
const NPC_TRANSPONDER_CHANNELS = new Set(["code"]);
const NPC_TRANSPONDER_SIGNAL_MAX_LENGTH = 20;
const NPC_TRANSPONDER_SUFFIX_MAX_LENGTH = 20;
const NPC_TRANSPONDER_CODE_MAX_LENGTH = 32;
const NPC_EQUIPMENT_ROLES = new Set([
  "weapon",
  "ammunition",
  "fuel",
  "remote_repair",
  "self_repair",
  "hostile_utility",
  "mining",
  "salvage",
  "tractor",
  "scanner",
  "cloak",
  "propulsion",
  "jump_drive",
  "passive",
]);
const NPC_EQUIPMENT_LOSS_POLICIES = new Set(["return", "destroy"]);
const WORLD_FACTION_CAPABILITIES = new Set([
  "npc", "assemblyAccess", "catapult", "smartIndustry", "transponder",
  "actionQueue", "industryActions", "logisticsActions",
  "infrastructureActions", "automation",
]);
const DEFAULT_NPC_HARDWARE_POLICY = Object.freeze({
  allowPlayerOwned: true,
  allowFactionOwned: true,
  allowCrossFactionDonation: false,
  allowedRoles: Object.freeze([...NPC_EQUIPMENT_ROLES]),
  allowedTypeIDs: Object.freeze([]),
  deniedTypeIDs: Object.freeze([]),
  equipmentLossPolicy: "return",
});
const DEFAULT_NPC_TYPE_MEMBERSHIP = Object.freeze({
  includedTypeIDs: Object.freeze([]),
  excludedTypeIDs: Object.freeze([]),
  sdeTypeListIDs: Object.freeze({
    hull: Object.freeze([]),
    reinforcement: Object.freeze([]),
    targetInterest: Object.freeze([]),
    loot: Object.freeze([]),
    market: Object.freeze([]),
  }),
  typeListProfiles: Object.freeze([Object.freeze({
    profileID: "npc-profiles-by-faction",
    source: "npcProfiles",
    match: "factionIdentity",
  })]),
});
const DEFAULT_NPC_FACTION_CHARACTERS = Object.freeze([]);
const DEFAULT_NPC_STARTING_REGION = Object.freeze({
  regionID: null,
  solarSystemIDs: Object.freeze([]),
});
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

function normalizeTransponderSuffix(value, fieldName) {
  const normalized = nonEmptyText(value, fieldName).toUpperCase();
  if (normalized.length > NPC_TRANSPONDER_SUFFIX_MAX_LENGTH) {
    throw new TypeError(
      `${fieldName} must be at most ${NPC_TRANSPONDER_SUFFIX_MAX_LENGTH} characters`,
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
  return {
    enabled: source.enabled,
    channel,
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

function normalizeStartingRegion(value, fieldName, fallback = DEFAULT_NPC_STARTING_REGION) {
  if (value === undefined) return cloneValue(fallback);
  const source = assertRecord(value, fieldName);
  for (const key of Object.keys(source)) {
    if (key !== "regionID" && key !== "solarSystemIDs") {
      throw new TypeError(`${fieldName}.${key} is unsupported`);
    }
  }
  const regionID = source.regionID === undefined ? fallback.regionID : source.regionID;
  if (regionID !== null && (
    !Number.isSafeInteger(regionID) || regionID <= 0 || regionID > 0xffffffff
  )) {
    throw new TypeError(`${fieldName}.regionID must be null or a positive u32 region ID`);
  }
  const rawIDs = source.solarSystemIDs === undefined
    ? fallback.solarSystemIDs : source.solarSystemIDs;
  if (!Array.isArray(rawIDs)) {
    throw new TypeError(`${fieldName}.solarSystemIDs must be an array`);
  }
  const seen = new Set();
  const solarSystemIDs = rawIDs.map((systemID, index) => {
    if (!Number.isSafeInteger(systemID) || systemID <= 0 || systemID > 0xffffffff) {
      throw new TypeError(`${fieldName}.solarSystemIDs[${index}] must be a positive u32 solar system ID`);
    }
    if (seen.has(systemID)) {
      throw new TypeError(`${fieldName}.solarSystemIDs contains duplicate solar system ID ${systemID}`);
    }
    seen.add(systemID);
    return systemID;
  });
  return { regionID, solarSystemIDs };
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

function canonicalFactionConfigKey(factionID, factionKey) {
  const numericID = Math.trunc(Number(factionID) || 0);
  const stringID = String(factionKey || "").trim().toLowerCase() || "none";
  return `${numericID}-${stringID}`;
}

function normalizeTypeMembership(value, fieldName, fallback = DEFAULT_NPC_TYPE_MEMBERSHIP) {
  if (value == null) return cloneValue(fallback);
  const source = assertRecord(value, fieldName);
  const includedTypeIDs = source.includedTypeIDs === undefined
    ? [...fallback.includedTypeIDs]
    : normalizeFactionIDList(source.includedTypeIDs, `${fieldName}.includedTypeIDs`);
  const excludedTypeIDs = source.excludedTypeIDs === undefined
    ? [...fallback.excludedTypeIDs]
    : normalizeFactionIDList(source.excludedTypeIDs, `${fieldName}.excludedTypeIDs`);
  if (includedTypeIDs.some((typeID) => excludedTypeIDs.includes(typeID))) {
    throw new TypeError(`${fieldName} cannot both include and exclude the same type ID`);
  }
  const rawSdeLists = source.sdeTypeListIDs === undefined
    ? {} : assertRecord(source.sdeTypeListIDs, `${fieldName}.sdeTypeListIDs`);
  const sdeTypeListIDs: Record<string, number[]> = {};
  for (const lane of Object.keys(DEFAULT_NPC_TYPE_MEMBERSHIP.sdeTypeListIDs)) {
    const rawIDs = rawSdeLists[lane] === undefined
      ? fallback.sdeTypeListIDs?.[lane] || [] : rawSdeLists[lane];
    if (!Array.isArray(rawIDs) || rawIDs.some(id =>
      !Number.isSafeInteger(id) || id <= 0 || id > 1_000_000) ||
      new Set(rawIDs).size !== rawIDs.length) {
      throw new TypeError(`${fieldName}.sdeTypeListIDs.${lane} must contain unique positive SDE list IDs`);
    }
    sdeTypeListIDs[lane] = [...rawIDs];
  }
  if (sdeTypeListIDs.market.length > 0) {
    throw new TypeError(`${fieldName}.sdeTypeListIDs.market is reserved until NPC market transactions exist`);
  }
  for (const lane of Object.keys(rawSdeLists)) {
    if (!(lane in sdeTypeListIDs)) {
      throw new TypeError(`${fieldName}.sdeTypeListIDs.${lane} is unsupported`);
    }
  }
  const rawProfiles = source.typeListProfiles === undefined
    ? fallback.typeListProfiles
    : source.typeListProfiles;
  if (!Array.isArray(rawProfiles)) {
    throw new TypeError(`${fieldName}.typeListProfiles must be an array`);
  }
  const seenProfiles = new Set();
  const typeListProfiles = rawProfiles.map((rawProfile, index) => {
    const profileField = `${fieldName}.typeListProfiles[${index}]`;
    const profile = assertRecord(rawProfile, profileField);
    const profileID = nonEmptyText(profile.profileID, `${profileField}.profileID`).toLowerCase();
    if (!/^[a-z0-9][a-z0-9:_-]{0,127}$/.test(profileID)) {
      throw new TypeError(`${profileField}.profileID is not canonical`);
    }
    if (seenProfiles.has(profileID)) {
      throw new TypeError(`${fieldName}.typeListProfiles contains duplicate ${profileID}`);
    }
    seenProfiles.add(profileID);
    const profileSource = nonEmptyText(profile.source, `${profileField}.source`);
    const match = nonEmptyText(profile.match, `${profileField}.match`);
    if (profileSource !== "npcProfiles" || match !== "factionIdentity") {
      throw new TypeError(
        `${profileField} must use source npcProfiles and match factionIdentity`,
      );
    }
    return { profileID, source: profileSource, match };
  });
  return { includedTypeIDs, excludedTypeIDs, sdeTypeListIDs, typeListProfiles };
}

function normalizeCharacterID(value, fieldName) {
  const normalized = typeof value === "bigint"
    ? value.toString()
    : String(value == null ? "" : value).trim();
  if (!/^[1-9][0-9]*$/.test(normalized) || BigInt(normalized) > U64_MAX) {
    throw new TypeError(`${fieldName} must be a canonical positive u64 string`);
  }
  return normalized;
}

function normalizeFactionCharacters(value, fieldName, fallback = DEFAULT_NPC_FACTION_CHARACTERS) {
  const rawEntries = value === undefined || value === null ? fallback : value;
  if (!Array.isArray(rawEntries)) {
    throw new TypeError(`${fieldName} must be an array`);
  }
  const seen = new Set();
  return rawEntries.map((rawEntry, index) => {
    const entryField = `${fieldName}[${index}]`;
    const entry = assertRecord(rawEntry, entryField);
    const characterID = normalizeCharacterID(entry.characterID, `${entryField}.characterID`);
    const characterType = nonEmptyText(
      entry.characterType,
      `${entryField}.characterType`,
    ).toLowerCase();
    if (characterType !== "npc" && characterType !== "player") {
      throw new TypeError(`${entryField}.characterType must be npc or player`);
    }
    const identity = `${characterType}:${characterID}`;
    if (seen.has(identity)) {
      throw new TypeError(`${fieldName} contains duplicate ${identity}`);
    }
    seen.add(identity);
    return { characterID, characterType };
  });
}

function normalizeNpcHardwarePolicy(value, fieldName, fallback = DEFAULT_NPC_HARDWARE_POLICY) {
  if (value == null) return cloneValue(fallback);
  const source = assertRecord(value, fieldName);
  const booleanField = (key) => {
    if (source[key] === undefined) return fallback[key] === true;
    if (typeof source[key] !== "boolean") {
      throw new TypeError(`${fieldName}.${key} must be a boolean`);
    }
    return source[key];
  };
  const normalizeRoles = () => {
    if (source.allowedRoles === undefined) return [...fallback.allowedRoles];
    if (!Array.isArray(source.allowedRoles) || source.allowedRoles.length === 0) {
      throw new TypeError(`${fieldName}.allowedRoles must be a non-empty array`);
    }
    const roles = source.allowedRoles.map((entry, index) => {
      const role = nonEmptyText(entry, `${fieldName}.allowedRoles[${index}]`).toLowerCase();
      if (!NPC_EQUIPMENT_ROLES.has(role)) {
        throw new TypeError(`${fieldName}.allowedRoles[${index}] is unsupported: ${role}`);
      }
      return role;
    });
    if (new Set(roles).size !== roles.length) {
      throw new TypeError(`${fieldName}.allowedRoles contains duplicates`);
    }
    return roles;
  };
  const allowedTypeIDs = source.allowedTypeIDs === undefined
    ? [...fallback.allowedTypeIDs]
    : normalizeFactionIDList(source.allowedTypeIDs, `${fieldName}.allowedTypeIDs`);
  const deniedTypeIDs = source.deniedTypeIDs === undefined
    ? [...fallback.deniedTypeIDs]
    : normalizeFactionIDList(source.deniedTypeIDs, `${fieldName}.deniedTypeIDs`);
  if (allowedTypeIDs.some((typeID) => deniedTypeIDs.includes(typeID))) {
    throw new TypeError(`${fieldName} cannot both allow and deny the same type ID`);
  }
  const equipmentLossPolicy = source.equipmentLossPolicy === undefined
    ? fallback.equipmentLossPolicy
    : nonEmptyText(source.equipmentLossPolicy, `${fieldName}.equipmentLossPolicy`).toLowerCase();
  if (!NPC_EQUIPMENT_LOSS_POLICIES.has(equipmentLossPolicy)) {
    throw new TypeError(`${fieldName}.equipmentLossPolicy must be return or destroy`);
  }
  return {
    allowPlayerOwned: booleanField("allowPlayerOwned"),
    allowFactionOwned: booleanField("allowFactionOwned"),
    allowCrossFactionDonation: booleanField("allowCrossFactionDonation"),
    allowedRoles: normalizeRoles(),
    allowedTypeIDs,
    deniedTypeIDs,
    equipmentLossPolicy,
  };
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
  if (!Number.isInteger(schemaVersion) || (
    schemaVersion !== SUPPORTED_SCHEMA_VERSION && !LEGACY_SCHEMA_VERSIONS.has(schemaVersion)
  )) {
    throw new TypeError(
      `schemaVersion must be 1 or ${SUPPORTED_SCHEMA_VERSION}; received ${String(source.schemaVersion)}`,
    );
  }
  if (typeof source.enabled !== "boolean") {
    throw new TypeError("enabled must be a boolean");
  }
  const transponder = normalizeNpcTransponderConfig(source.transponder);
  const suiWalletFunding = normalizeSuiWalletFunding(source.suiWalletFunding);
  const rawDebugFittingTrust = source.debugFittingTrust ?? {};
  if (rawDebugFittingTrust === null || typeof rawDebugFittingTrust !== "object" ||
      Array.isArray(rawDebugFittingTrust) ||
      (rawDebugFittingTrust.allowNearbyPlayers !== undefined &&
        typeof rawDebugFittingTrust.allowNearbyPlayers !== "boolean")) {
    throw new TypeError("debugFittingTrust.allowNearbyPlayers must be a boolean");
  }
  const debugFittingTrust = {
    allowNearbyPlayers: rawDebugFittingTrust.allowNearbyPlayers === true,
  };
  const rawWorldCapabilities = source.worldCapabilities ?? ["npc", "transponder"];
  if (!Array.isArray(rawWorldCapabilities) || rawWorldCapabilities.some(
    (value) => typeof value !== "string" || !WORLD_FACTION_CAPABILITIES.has(value),
  )) {
    throw new TypeError("worldCapabilities must contain known world capability names");
  }
  const worldCapabilities = [...new Set(rawWorldCapabilities)].sort();

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
    hardwarePolicy: normalizeNpcHardwarePolicy(
      rawDefaults.hardwarePolicy,
      "defaults.hardwarePolicy",
    ),
    typeMembership: normalizeTypeMembership(
      rawDefaults.typeMembership,
      "defaults.typeMembership",
    ),
    startingRegion: normalizeStartingRegion(
      rawDefaults.startingRegion,
      "defaults.startingRegion",
    ),
    leadership: normalizeFactionCharacters(
      rawDefaults.leadership,
      "defaults.leadership",
    ),
    commanders: normalizeFactionCharacters(
      rawDefaults.commanders,
      "defaults.commanders",
    ),
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
    const canonicalKey = canonicalFactionConfigKey(factionID, factionKey);
    return {
      factionID,
      factionKey,
      canonicalKey,
      name: nonEmptyText(faction.name, `${fieldName}.name`),
      transponderSignal: faction.transponderSignal == null
        ? null
        : normalizeTransponderSignal(
            faction.transponderSignal,
            `${fieldName}.transponderSignal`,
          ),
      transponderSuffix: faction.transponderSuffix == null
        ? null
        : normalizeTransponderSuffix(
            faction.transponderSuffix,
            `${fieldName}.transponderSuffix`,
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
      hardwarePolicy: normalizeNpcHardwarePolicy(
        faction.hardwarePolicy,
        `${fieldName}.hardwarePolicy`,
        defaults.hardwarePolicy,
      ),
      typeMembership: normalizeTypeMembership(
        faction.typeMembership,
        `${fieldName}.typeMembership`,
        defaults.typeMembership,
      ),
      startingRegion: normalizeStartingRegion(
        faction.startingRegion,
        `${fieldName}.startingRegion`,
        defaults.startingRegion,
      ),
      leadership: normalizeFactionCharacters(
        faction.leadership,
        `${fieldName}.leadership`,
        defaults.leadership,
      ),
      commanders: normalizeFactionCharacters(
        faction.commanders,
        `${fieldName}.commanders`,
        defaults.commanders,
      ),
    };
  });

  if (transponder.enabled) {
    const transponderSignals = new Set();
    for (let index = 0; index < factions.length; index += 1) {
      const faction = factions[index];
      if (!faction.transponderSignal) {
        throw new TypeError(
          `factions[${index}].transponderSignal is required when transponders are enabled`,
        );
      }
      if (transponderSignals.has(faction.transponderSignal)) {
        throw new TypeError(
          `duplicate faction transponderSignal: ${faction.transponderSignal}`,
        );
      }
      transponderSignals.add(faction.transponderSignal);
      const code = faction.transponderSignal +
        (faction.transponderSuffix ? `:${faction.transponderSuffix}` : "");
      if (code.length > NPC_TRANSPONDER_CODE_MAX_LENGTH) {
        throw new TypeError(
          `factions[${index}] transponderSignal and transponderSuffix must fit ` +
          `the ${NPC_TRANSPONDER_CODE_MAX_LENGTH}-character client code limit`,
        );
      }
    }
  }

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

  const factionsByIdentity = new Map();
  const factionsByCanonicalKey = new Map();
  for (const faction of factions) {
    if (factionsByCanonicalKey.has(faction.canonicalKey)) {
      throw new TypeError(`duplicate canonical faction key: ${faction.canonicalKey}`);
    }
    factionsByCanonicalKey.set(faction.canonicalKey, faction);
    if (faction.factionID > 0) {
      factionsByIdentity.set(factionIDIdentity(faction.factionID), faction);
    }
    if (faction.factionKey) {
      factionsByIdentity.set(factionKeyIdentity(faction.factionKey), faction);
    }
  }
  const dispositionByCanonicalPair = new Map();
  for (const relation of relations) {
    const sourceIdentities = [
      ...relation.sourceFactionIDs.map(factionIDIdentity),
      ...relation.sourceFactionKeys.map(factionKeyIdentity),
    ];
    const targetIdentities = [
      ...relation.targetFactionIDs.map(factionIDIdentity),
      ...relation.targetFactionKeys.map(factionKeyIdentity),
    ];
    for (const sourceIdentity of sourceIdentities) {
      const sourceFaction = factionsByIdentity.get(sourceIdentity);
      if (!sourceFaction) throw new TypeError(`${relation.id} references unknown ${sourceIdentity}`);
      for (const targetIdentity of targetIdentities) {
        const targetFaction = factionsByIdentity.get(targetIdentity);
        if (!targetFaction) throw new TypeError(`${relation.id} references unknown ${targetIdentity}`);
        if (sourceFaction.canonicalKey === targetFaction.canonicalKey) continue;
        dispositionByCanonicalPair.set(
          `${sourceFaction.canonicalKey}\u0000${targetFaction.canonicalKey}`,
          relation.disposition,
        );
        if (relation.reciprocal) {
          dispositionByCanonicalPair.set(
            `${targetFaction.canonicalKey}\u0000${sourceFaction.canonicalKey}`,
            relation.disposition,
          );
        }
      }
    }
  }
  const expandedFactions = factions.map((faction) => {
    const contacts = { allies: [], enemies: [] };
    for (const target of factions) {
      if (target.canonicalKey === faction.canonicalKey) continue;
      const disposition = dispositionByCanonicalPair.get(
        `${faction.canonicalKey}\u0000${target.canonicalKey}`,
      );
      const bucket = disposition === "friendly"
        ? contacts.allies
        : disposition === "hostile"
          ? contacts.enemies
          : null;
      if (!bucket) continue;
      bucket.push({
        factionKey: target.canonicalKey,
        name: target.name,
        transponderCode: target.transponderSignal
          ? target.transponderSignal +
            (target.transponderSuffix ? `:${target.transponderSuffix}` : "")
          : null,
      });
    }
    contacts.allies.sort((left, right) => left.factionKey.localeCompare(right.factionKey));
    contacts.enemies.sort((left, right) => left.factionKey.localeCompare(right.factionKey));
    return {
      ...faction,
      transponderCode: faction.transponderSignal
        ? faction.transponderSignal +
          (faction.transponderSuffix ? `:${faction.transponderSuffix}` : "")
        : null,
      diplomacy: contacts,
    };
  });

  return deepFreeze({
    schemaVersion,
    enabled: source.enabled,
    worldCapabilities,
    suiWalletFunding,
    transponder,
    debugFittingTrust,
    defaults,
    factions: expandedFactions,
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

function resolveNpcFactionCanonicalKey(sourceEntity) {
  const faction = resolveConfiguredFaction(sourceEntity);
  return faction ? faction.canonicalKey : null;
}

function resolveNpcFactionDiplomacy(sourceEntity) {
  const faction = resolveConfiguredFaction(sourceEntity);
  return cloneValue(faction ? faction.diplomacy : { allies: [], enemies: [] });
}

function resolveNpcFactionLeadership(sourceEntity) {
  const faction = resolveConfiguredFaction(sourceEntity);
  return cloneValue({
    leadership: faction ? faction.leadership : CONFIG.defaults.leadership,
    commanders: faction ? faction.commanders : CONFIG.defaults.commanders,
  });
}

function resolveNpcFactionStartingRegion(sourceEntity) {
  const faction = resolveConfiguredFaction(sourceEntity);
  return cloneValue(faction ? faction.startingRegion : CONFIG.defaults.startingRegion);
}

function resolveNpcFactionRespawnSeedSolarSystemIDs(sourceEntity, solarSystems = null) {
  const region = resolveNpcFactionStartingRegion(sourceEntity);
  if (region.regionID === null) return [...region.solarSystemIDs];
  let rows = solarSystems;
  if (rows === null) {
    try {
      const { TABLE, readStaticRows } = require("../services/_shared/referenceData");
      rows = readStaticRows(TABLE.SOLAR_SYSTEMS);
    } catch (_) {
      rows = [];
    }
  }
  const inRegion = Array.isArray(rows)
    ? [...new Set(rows
      .filter((row) => Number(row?.regionID) === region.regionID)
      .map((row) => Number(row?.solarSystemID))
      .filter((systemID) => Number.isSafeInteger(systemID) && systemID > 0))].sort((a, b) => a - b)
    : [];
  return inRegion.length > 0
    ? inRegion
    : [...region.solarSystemIDs];
}

function selectNpcFactionStartingSolarSystemID(sourceEntity, options: Record<string, any> = {}) {
  const systemIDs = resolveNpcFactionRespawnSeedSolarSystemIDs(
    sourceEntity, options.solarSystems ?? null,
  );
  if (systemIDs.length === 0) return null;
  const random = options.random === undefined ? Math.random : options.random;
  if (typeof random !== "function") throw new TypeError("random must be a function");
  const sample = random();
  if (!Number.isFinite(sample) || sample < 0 || sample >= 1) {
    throw new TypeError("random must return a number in [0, 1)");
  }
  return systemIDs[Math.floor(sample * systemIDs.length)];
}

function applyNpcFactionTypeListProfile(profile) {
  if (!profile || typeof profile !== "object") return profile;
  const configuredFaction = resolveConfiguredFaction(profile);
  if (!configuredFaction) return cloneValue(profile);
  const typeID = toPositiveInt(profile.shipTypeID ?? profile.typeID, 0);
  const membership = configuredFaction.typeMembership;
  const excluded = typeID > 0 && membership.excludedTypeIDs.includes(typeID);
  const profileIdentity = resolveNpcFactionIdentity(profile);
  const identityMatches = (
    configuredFaction.factionKey &&
    profileIdentity === factionKeyIdentity(configuredFaction.factionKey)
  ) || (
    configuredFaction.factionID > 0 &&
    profileIdentity === factionIDIdentity(configuredFaction.factionID)
  );
  const appliedProfiles = identityMatches
    ? membership.typeListProfiles.map((entry) => entry.profileID)
    : [];
  const included = typeID > 0 && (
    membership.includedTypeIDs.includes(typeID) || appliedProfiles.length > 0
  );
  return {
    ...cloneValue(profile),
    npcFactionConfigKey: configuredFaction.canonicalKey,
    npcFactionTypeListProfileIDs: appliedProfiles,
    npcFactionMembershipEligible: included && !excluded &&
      matchesNpcFactionSdeTypeListPolicy(membership, "hull", typeID),
  };
}

function matchesNpcFactionSdeTypeListPolicy(membership, lane, itemOrType, matcher = null) {
  const listIDs = membership?.sdeTypeListIDs?.[lane];
  if (!Array.isArray(listIDs) || listIDs.length === 0) return true;
  const matches = matcher || require("../services/inventory/typeListAuthority").matchesTypeList;
  return listIDs.some(listID => matches(itemOrType, listID) === true);
}

function isNpcFactionSdeTypeAllowed(sourceEntity, lane, itemOrType) {
  const faction = resolveConfiguredFaction(sourceEntity);
  return !faction || matchesNpcFactionSdeTypeListPolicy(
    faction.typeMembership, lane, itemOrType,
  );
}

function resolveNpcFactionTypeProfiles(sourceEntity, npcProfiles: any[] = []) {
  const configuredFaction = resolveConfiguredFaction(sourceEntity);
  if (!configuredFaction) return [];
  const byTypeID = new Map();
  for (const rawProfile of Array.isArray(npcProfiles) ? npcProfiles : []) {
    const profile = applyNpcFactionTypeListProfile(rawProfile);
    if (!profile || profile.npcFactionConfigKey !== configuredFaction.canonicalKey ||
        profile.npcFactionMembershipEligible !== true) {
      continue;
    }
    const typeID = toPositiveInt(profile.shipTypeID ?? profile.typeID, 0);
    if (typeID <= 0) continue;
    const existing = byTypeID.get(typeID) || {
      typeID,
      profileIDs: [],
      typeListProfileIDs: [...profile.npcFactionTypeListProfileIDs],
    };
    const profileID = String(profile.profileID || "").trim();
    if (profileID && !existing.profileIDs.includes(profileID)) {
      existing.profileIDs.push(profileID);
    }
    byTypeID.set(typeID, existing);
  }
  for (const typeID of configuredFaction.typeMembership.includedTypeIDs) {
    if (!byTypeID.has(typeID) &&
        !configuredFaction.typeMembership.excludedTypeIDs.includes(typeID) &&
        matchesNpcFactionSdeTypeListPolicy(configuredFaction.typeMembership, "hull", typeID)) {
      byTypeID.set(typeID, {
        typeID,
        profileIDs: [],
        typeListProfileIDs: configuredFaction.typeMembership.typeListProfiles
          .map((entry) => entry.profileID),
      });
    }
  }
  return [...byTypeID.values()]
    .map((entry) => ({
      ...entry,
      profileIDs: [...entry.profileIDs].sort(),
      typeListProfileIDs: [...new Set(entry.typeListProfileIDs)].sort(),
    }))
    .sort((left, right) => left.typeID - right.typeID);
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
  const factionIdentity = resolveNpcFactionIdentity(entity);
  return factionIdentity ? `faction:${factionIdentity}` : null;
}

function resolveNpcTransponderConfiguration(entity) {
  if (!CONFIG.enabled || !CONFIG.transponder.enabled || !isNpcTransponderEntity(entity)) {
    return null;
  }
  const configuredFaction = resolveConfiguredFaction(entity);
  if (!configuredFaction || !configuredFaction.transponderSignal) {
    return null;
  }
  const factionIdentity = resolveNpcTransponderGroupIdentity(entity);
  if (!factionIdentity) {
    return null;
  }
  return {
    channel: CONFIG.transponder.channel,
    signal: configuredFaction.transponderSignal,
    factionIdentity,
    sharedSuffix: configuredFaction.transponderSuffix || null,
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

function resolveNpcHardwarePolicy(sourceEntity) {
  const faction = resolveConfiguredFaction(sourceEntity);
  return cloneValue(
    faction && faction.hardwarePolicy || CONFIG.defaults.hardwarePolicy,
  );
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
  const allLeadershipCharacters = CONFIG.factions.flatMap((faction) => [
    ...faction.leadership,
    ...faction.commanders,
  ]);
  return {
    configPath: CONFIG_PATH,
    schemaVersion: CONFIG.schemaVersion,
    enabled: CONFIG.enabled,
    transponderEnabled: CONFIG.transponder.enabled,
    transponderChannel: CONFIG.transponder.channel,
    debugFittingTrustAllowNearbyPlayers: CONFIG.debugFittingTrust.allowNearbyPlayers,
    transponderSignalCount: CONFIG.factions.filter(
      (faction) => Boolean(faction.transponderSignal),
    ).length,
    transponderSuffixCount: CONFIG.factions.filter(
      (faction) => Boolean(faction.transponderSuffix),
    ).length,
    suiWalletFundingEnabled: CONFIG.suiWalletFunding.enabled,
    suiWalletBudgetMist: CONFIG.suiWalletFunding.budgetMist,
    factionCount: CONFIG.factions.length,
    factionTypeListProfileCount: CONFIG.factions.reduce(
      (total, faction) => total + faction.typeMembership.typeListProfiles.length,
      0,
    ),
    configuredFactionTypeIDCount: CONFIG.factions.reduce(
      (total, faction) => total + faction.typeMembership.includedTypeIDs.length,
      0,
    ),
    startingRegionFactionCount: CONFIG.factions.filter(
      (faction) => faction.startingRegion.regionID != null,
    ).length,
    fallbackSolarSystemFactionCount: CONFIG.factions.filter(
      (faction) => faction.startingRegion.solarSystemIDs.length > 0,
    ).length,
    allyContactCount: CONFIG.factions.reduce(
      (total, faction) => total + faction.diplomacy.allies.length,
      0,
    ),
    enemyContactCount: CONFIG.factions.reduce(
      (total, faction) => total + faction.diplomacy.enemies.length,
      0,
    ),
    leadershipCharacterCount: new Set(allLeadershipCharacters.map(
      (entry) => `${entry.characterType}:${entry.characterID}`,
    )).size,
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
  resolveNpcFactionCanonicalKey,
  resolveNpcFactionDisposition,
  resolveNpcFactionDiplomacy,
  resolveNpcFactionLeadership,
  resolveNpcFactionStartingRegion,
  resolveNpcFactionRespawnSeedSolarSystemIDs,
  selectNpcFactionStartingSolarSystemID,
  applyNpcFactionTypeListProfile,
  matchesNpcFactionSdeTypeListPolicy,
  isNpcFactionSdeTypeAllowed,
  resolveNpcFactionTypeProfiles,
  resolveNpcTransponderConfiguration,
  resolveNpcTransponderGroupIdentity,
  resolveNpcTargetIdentification,
  resolveNpcUnidentifiedDisposition,
  resolveNpcHardwarePolicy,
  shouldNpcRetaliateAgainstAggressors,
  hasConfiguredHostileNpcFactions,
  getAdditionalAutoAggroTargetClasses,
};
