const fs = require("fs");
const path = require("path");

const CONFIG_PATH = path.resolve(
  __dirname,
  "../../../frontier-landscape-spawns.json",
);
const SUPPORTED_SCHEMA_VERSION = 2;
const NPC_PROFILE_TABLE = "npcProfiles";
const NPC_BEHAVIOR_PROFILE_TABLE = "npcBehaviorProfiles";
const SALVAGEABLE_WRECKAGE_GROUP_ID = 5133;

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

function positiveNumber(value, fieldName) {
  const normalized = Number(value);
  if (!Number.isFinite(normalized) || normalized <= 0) {
    throw new TypeError(`${fieldName} must be a positive finite number`);
  }
  return normalized;
}

function probability(value, fieldName) {
  const normalized = Number(value);
  if (!Number.isFinite(normalized) || normalized < 0 || normalized > 1) {
    throw new TypeError(`${fieldName} must be between 0 and 1`);
  }
  return normalized;
}

function requiredBoolean(value, fieldName) {
  if (typeof value !== "boolean") {
    throw new TypeError(`${fieldName} must be a boolean`);
  }
  return value;
}

function normalizeStringArray(value, fieldName) {
  const seen = new Set<any>();
  return assertArray(value, fieldName).map((entry, index) => {
    const normalized = nonEmptyText(entry, `${fieldName}[${index}]`);
    const key = normalized.toLowerCase();
    if (seen.has(key)) {
      throw new TypeError(`${fieldName} contains duplicate value: ${normalized}`);
    }
    seen.add(key);
    return normalized;
  });
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

function normalizeCountRange(value, fieldName, maximum) {
  const source = assertRecord(value, fieldName);
  const min = nonNegativeInteger(source.min, `${fieldName}.min`);
  const max = nonNegativeInteger(source.max, `${fieldName}.max`);
  if (max < min) {
    throw new TypeError(`${fieldName}.max must be greater than or equal to min`);
  }
  if (max > maximum) {
    throw new TypeError(`${fieldName}.max must not exceed ${maximum}`);
  }
  return { min, max };
}

function normalizeDistanceRange(value, fieldName) {
  const source = assertRecord(value, fieldName);
  const min = positiveNumber(source.min, `${fieldName}.min`);
  const max = positiveNumber(source.max, `${fieldName}.max`);
  if (max < min) {
    throw new TypeError(`${fieldName}.max must be greater than or equal to min`);
  }
  return { min, max };
}

function readRawConfig() {
  let payload;
  try {
    payload = fs.readFileSync(CONFIG_PATH, "utf8");
  } catch (error) {
    throw new Error(
      `Unable to read Frontier landscape spawn config at ${CONFIG_PATH}: ${error.message}`,
    );
  }
  try {
    return JSON.parse(String(payload).replace(/^\uFEFF/, ""));
  } catch (error) {
    throw new SyntaxError(
      `Invalid Frontier landscape spawn config at ${CONFIG_PATH}: ${error.message}`,
    );
  }
}

function validateConfig(rawConfig) {
  const raw = assertRecord(rawConfig, "frontier landscape spawn config");
  const schemaVersion = positiveInteger(raw.schemaVersion, "schemaVersion");
  if (schemaVersion !== SUPPORTED_SCHEMA_VERSION) {
    throw new TypeError(
      `schemaVersion must be ${SUPPORTED_SCHEMA_VERSION}; received ${schemaVersion}`,
    );
  }
  const source = assertRecord(raw.source, "source");
  const rawDefaults = assertRecord(raw.defaults, "defaults");
  const defaults = {
    npcFactionID: positiveInteger(rawDefaults.npcFactionID, "defaults.npcFactionID"),
    npcCorporationID: positiveInteger(
      rawDefaults.npcCorporationID,
      "defaults.npcCorporationID",
    ),
    npcLoadoutID: nonEmptyText(rawDefaults.npcLoadoutID, "defaults.npcLoadoutID"),
    npcLootTableID: nonEmptyText(
      rawDefaults.npcLootTableID,
      "defaults.npcLootTableID",
    ),
    maxNpcsPerSite: positiveInteger(
      rawDefaults.maxNpcsPerSite,
      "defaults.maxNpcsPerSite",
    ),
    maxWrecksPerSite: positiveInteger(
      rawDefaults.maxWrecksPerSite,
      "defaults.maxWrecksPerSite",
    ),
    npcDistanceMeters: normalizeDistanceRange(
      rawDefaults.npcDistanceMeters,
      "defaults.npcDistanceMeters",
    ),
    wreckDistanceMeters: normalizeDistanceRange(
      rawDefaults.wreckDistanceMeters,
      "defaults.wreckDistanceMeters",
    ),
  };

  const npcBehaviorPresets: Record<string, any> = {};
  const behaviorProfileIDs = new Set<any>();
  for (const [presetKey, rawPreset] of Object.entries<any>(
    assertRecord(raw.npcBehaviorPresets, "npcBehaviorPresets"),
  )) {
    const key = nonEmptyText(presetKey, "npcBehaviorPresets key");
    const fieldName = `npcBehaviorPresets.${key}`;
    const preset = assertRecord(rawPreset, fieldName);
    const behaviorProfileID = nonEmptyText(
      preset.behaviorProfileID,
      `${fieldName}.behaviorProfileID`,
    );
    if (behaviorProfileIDs.has(behaviorProfileID)) {
      throw new TypeError(`duplicate behaviorProfileID: ${behaviorProfileID}`);
    }
    behaviorProfileIDs.add(behaviorProfileID);
    npcBehaviorPresets[key] = {
      behaviorProfileID,
      name: nonEmptyText(preset.name, `${fieldName}.name`),
      thinkIntervalMs: positiveInteger(preset.thinkIntervalMs, `${fieldName}.thinkIntervalMs`),
      movementMode: nonEmptyText(preset.movementMode, `${fieldName}.movementMode`),
      orbitDistanceMeters: positiveNumber(
        preset.orbitDistanceMeters,
        `${fieldName}.orbitDistanceMeters`,
      ),
      followRangeMeters: positiveNumber(
        preset.followRangeMeters,
        `${fieldName}.followRangeMeters`,
      ),
      aggressionRangeMeters: positiveNumber(
        preset.aggressionRangeMeters,
        `${fieldName}.aggressionRangeMeters`,
      ),
      leashRangeMeters: positiveNumber(
        preset.leashRangeMeters,
        `${fieldName}.leashRangeMeters`,
      ),
      cruiseSpeedMetersPerSecond: positiveNumber(
        preset.cruiseSpeedMetersPerSecond,
        `${fieldName}.cruiseSpeedMetersPerSecond`,
      ),
      chaseMaxVelocityMetersPerSecond: positiveNumber(
        preset.chaseMaxVelocityMetersPerSecond,
        `${fieldName}.chaseMaxVelocityMetersPerSecond`,
      ),
    };
  }

  const npcFamilies: Record<string, any> = {};
  const claimedGroupIDs = new Map<any, any>();
  const profileIDs = new Set<any>();
  const memberTypeIDs = new Set<any>();
  const memberByProfileID = new Map<any, any>();
  for (const [familyKey, rawFamily] of Object.entries<any>(
    assertRecord(raw.npcFamilies, "npcFamilies"),
  )) {
    const key = nonEmptyText(familyKey, "npcFamilies key");
    if (key !== key.toLowerCase()) {
      throw new TypeError(`npcFamilies key must be lowercase: ${key}`);
    }
    const fieldName = `npcFamilies.${key}`;
    const family = assertRecord(rawFamily, fieldName);
    const groupIDs = assertArray(family.groupIDs, `${fieldName}.groupIDs`)
      .map((groupID, index) => positiveInteger(groupID, `${fieldName}.groupIDs[${index}]`));
    if (groupIDs.length <= 0 || new Set(groupIDs).size !== groupIDs.length) {
      throw new TypeError(`${fieldName}.groupIDs must contain unique group IDs`);
    }
    for (const groupID of groupIDs) {
      if (claimedGroupIDs.has(groupID)) {
        throw new TypeError(
          `${fieldName}.groupIDs overlaps ${claimedGroupIDs.get(groupID)} at group ${groupID}`,
        );
      }
      claimedGroupIDs.set(groupID, key);
    }
    const members = assertArray(family.members, `${fieldName}.members`)
      .map((rawMember, index) => {
        const memberField = `${fieldName}.members[${index}]`;
        const member = assertRecord(rawMember, memberField);
        const profileID = nonEmptyText(member.profileID, `${memberField}.profileID`);
        const typeID = positiveInteger(member.typeID, `${memberField}.typeID`);
        const groupID = positiveInteger(member.groupID, `${memberField}.groupID`);
        const behaviorPreset = nonEmptyText(
          member.behaviorPreset,
          `${memberField}.behaviorPreset`,
        );
        if (!groupIDs.includes(groupID)) {
          throw new TypeError(`${memberField}.groupID is not allowed by ${fieldName}.groupIDs`);
        }
        if (!npcBehaviorPresets[behaviorPreset]) {
          throw new TypeError(`${memberField}.behaviorPreset references ${behaviorPreset}`);
        }
        if (profileIDs.has(profileID) || memberTypeIDs.has(typeID)) {
          throw new TypeError(`${memberField} duplicates a profile or type ID`);
        }
        profileIDs.add(profileID);
        memberTypeIDs.add(typeID);
        const normalizedMember = {
          profileID,
          typeID,
          groupID,
          name: nonEmptyText(member.name, `${memberField}.name`),
          behaviorPreset,
          bounty: nonNegativeInteger(member.bounty, `${memberField}.bounty`),
          weight: positiveNumber(member.weight, `${memberField}.weight`),
        };
        memberByProfileID.set(profileID, { familyKey: key, member: normalizedMember });
        return normalizedMember;
      });
    if (members.length <= 0) {
      throw new TypeError(`${fieldName}.members must not be empty`);
    }
    npcFamilies[key] = {
      displayName: nonEmptyText(family.displayName, `${fieldName}.displayName`),
      tag: nonEmptyText(family.tag, `${fieldName}.tag`),
      groupIDs,
      members,
    };
  }

  const wreckPools: Record<string, any> = {};
  for (const [poolKey, rawPool] of Object.entries<any>(
    assertRecord(raw.wreckPools, "wreckPools"),
  )) {
    const key = nonEmptyText(poolKey, "wreckPools key");
    const fieldName = `wreckPools.${key}`;
    const pool = assertRecord(rawPool, fieldName);
    const entries = assertArray(pool.entries, `${fieldName}.entries`)
      .map((rawEntry, index) => {
        const entryField = `${fieldName}.entries[${index}]`;
        const entry = assertRecord(rawEntry, entryField);
        const groupID = positiveInteger(entry.groupID, `${entryField}.groupID`);
        if (groupID !== SALVAGEABLE_WRECKAGE_GROUP_ID) {
          throw new TypeError(
            `${entryField}.groupID must be ${SALVAGEABLE_WRECKAGE_GROUP_ID}`,
          );
        }
        return {
          typeID: positiveInteger(entry.typeID, `${entryField}.typeID`),
          name: nonEmptyText(entry.name, `${entryField}.name`),
          groupID,
          weight: positiveNumber(entry.weight, `${entryField}.weight`),
        };
      });
    if (entries.length <= 0) {
      throw new TypeError(`${fieldName}.entries must not be empty`);
    }
    wreckPools[key] = { entries };
  }

  const spawnTables: Record<string, any> = {};
  for (const [tableKey, rawTable] of Object.entries<any>(
    assertRecord(raw.spawnTables, "spawnTables"),
  )) {
    const key = nonEmptyText(tableKey, "spawnTables key");
    const fieldName = `spawnTables.${key}`;
    const table = assertRecord(rawTable, fieldName);
    const familyWeights: Record<string, any> = {};
    for (const [familyKey, rawWeight] of Object.entries<any>(
      assertRecord(table.familyWeights, `${fieldName}.familyWeights`),
    )) {
      if (!npcFamilies[familyKey]) {
        throw new TypeError(`${fieldName}.familyWeights references ${familyKey}`);
      }
      familyWeights[familyKey] = positiveNumber(
        rawWeight,
        `${fieldName}.familyWeights.${familyKey}`,
      );
    }
    const wreckPool = nonEmptyText(table.wreckPool, `${fieldName}.wreckPool`);
    if (!wreckPools[wreckPool]) {
      throw new TypeError(`${fieldName}.wreckPool references ${wreckPool}`);
    }
    const npcCount = normalizeCountRange(
      table.npcCount,
      `${fieldName}.npcCount`,
      defaults.maxNpcsPerSite,
    );
    const requiredFamilies = table.requiredFamilies == null
      ? []
      : assertArray(table.requiredFamilies, `${fieldName}.requiredFamilies`)
        .map((rawRequired, index) => {
          const requiredField = `${fieldName}.requiredFamilies[${index}]`;
          const required = assertRecord(rawRequired, requiredField);
          const family = nonEmptyText(required.family, `${requiredField}.family`);
          if (!npcFamilies[family]) {
            throw new TypeError(`${requiredField}.family references ${family}`);
          }
          return {
            family,
            count: positiveInteger(required.count, `${requiredField}.count`),
          };
        });
    const requiredNpcCount = requiredFamilies.reduce(
      (sum, entry) => sum + entry.count,
      0,
    );
    if (requiredNpcCount > npcCount.min) {
      throw new TypeError(
        `${fieldName}.requiredFamilies total must not exceed npcCount.min`,
      );
    }
    let bossSpawn = null;
    if (table.bossSpawn != null) {
      const bossField = `${fieldName}.bossSpawn`;
      const rawBoss = assertRecord(table.bossSpawn, bossField);
      const profileID = nonEmptyText(rawBoss.profileID, `${bossField}.profileID`);
      const profileReference = memberByProfileID.get(profileID);
      if (!profileReference) {
        throw new TypeError(`${bossField}.profileID references ${profileID}`);
      }
      bossSpawn = {
        profileID,
        familyKey: profileReference.familyKey,
        chance: probability(rawBoss.chance, `${bossField}.chance`),
      };
    }
    spawnTables[key] = {
      activationChance: probability(table.activationChance, `${fieldName}.activationChance`),
      npcCount,
      wreckCount: normalizeCountRange(
        table.wreckCount,
        `${fieldName}.wreckCount`,
        defaults.maxWrecksPerSite,
      ),
      familyWeights,
      wreckPool,
      requiredFamilies,
      ...(bossSpawn ? { bossSpawn } : {}),
      ...(table.parentSpawnTable == null
        ? {}
        : {
          parentSpawnTable: nonEmptyText(
            table.parentSpawnTable,
            `${fieldName}.parentSpawnTable`,
          ),
        }),
    };
  }
  for (const [tableKey, table] of Object.entries<any>(spawnTables)) {
    if (table.parentSpawnTable && !spawnTables[table.parentSpawnTable]) {
      throw new TypeError(
        `spawnTables.${tableKey}.parentSpawnTable references ${table.parentSpawnTable}`,
      );
    }
    if (table.parentSpawnTable === tableKey) {
      throw new TypeError(`spawnTables.${tableKey}.parentSpawnTable cannot reference itself`);
    }
  }

  const dungeonOverrides: Record<string, any> = {};
  for (const [dungeonKey, rawOverride] of Object.entries<any>(
    assertRecord(raw.dungeonOverrides, "dungeonOverrides"),
  )) {
    const dungeonID = canonicalPositiveIntegerKey(
      dungeonKey,
      `dungeonOverrides key ${dungeonKey}`,
    );
    const fieldName = `dungeonOverrides.${dungeonKey}`;
    const override = assertRecord(rawOverride, fieldName);
    const spawnTable = nonEmptyText(override.spawnTable, `${fieldName}.spawnTable`);
    if (!spawnTables[spawnTable]) {
      throw new TypeError(`${fieldName}.spawnTable references ${spawnTable}`);
    }
    dungeonOverrides[dungeonKey] = {
      dungeonID,
      name: nonEmptyText(override.name, `${fieldName}.name`),
      spawnFrequency: positiveNumber(
        override.spawnFrequency,
        `${fieldName}.spawnFrequency`,
      ),
      spawnTable,
      tags: normalizeStringArray(override.tags, `${fieldName}.tags`),
    };
  }

  const ecosystems: Record<string, any> = {};
  for (const [ecosystemKey, rawEcosystem] of Object.entries<any>(
    assertRecord(raw.ecosystems, "ecosystems"),
  )) {
    const ecosystemID = canonicalPositiveIntegerKey(
      ecosystemKey,
      `ecosystems key ${ecosystemKey}`,
    );
    const fieldName = `ecosystems.${ecosystemKey}`;
    const ecosystem = assertRecord(rawEcosystem, fieldName);
    const spawnTable = nonEmptyText(ecosystem.spawnTable, `${fieldName}.spawnTable`);
    if (!spawnTables[spawnTable]) {
      throw new TypeError(`${fieldName}.spawnTable references ${spawnTable}`);
    }
    ecosystems[ecosystemKey] = {
      ecosystemID,
      name: nonEmptyText(ecosystem.name, `${fieldName}.name`),
      spawnFrequency: positiveNumber(
        ecosystem.spawnFrequency,
        `${fieldName}.spawnFrequency`,
      ),
      spawnTable,
    };
  }

  return {
    schemaVersion,
    enabled: requiredBoolean(raw.enabled, "enabled"),
    source: {
      clientBuild: positiveInteger(source.clientBuild, "source.clientBuild"),
      notes: nonEmptyText(source.notes, "source.notes"),
    },
    defaults,
    npcBehaviorPresets,
    npcFamilies,
    wreckPools,
    spawnTables,
    dungeonOverrides,
    ecosystems,
  };
}

const config = deepFreeze(validateConfig(readRawConfig()));

function hash32(value) {
  let hash = 0x811c9dc5;
  for (const character of String(value)) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function deterministicUnit(seed) {
  return hash32(seed) / 0x100000000;
}

function deterministicInteger(seed, range) {
  const min = Math.max(0, Number(range && range.min) || 0);
  const max = Math.max(min, Number(range && range.max) || min);
  return min + (hash32(seed) % ((max - min) + 1));
}

function weightedPick(entries, seed) {
  if (!Array.isArray(entries) || entries.length <= 0) {
    return null;
  }
  const totalWeight = entries.reduce(
    (sum, entry) => sum + Math.max(0, Number(entry && entry.weight) || 0),
    0,
  );
  if (totalWeight <= 0) {
    return entries[0];
  }
  let cursor = deterministicUnit(seed) * totalWeight;
  for (const entry of entries) {
    cursor -= Math.max(0, Number(entry && entry.weight) || 0);
    if (cursor <= 0) {
      return entry;
    }
  }
  return entries.at(-1);
}

function buildPositionOffset(seed, distanceRange, index, total) {
  const minimum = Number(distanceRange.min);
  const maximum = Number(distanceRange.max);
  const distance = minimum + (deterministicUnit(`${seed}:distance`) * (maximum - minimum));
  const angle = (
    deterministicUnit(`${seed}:angle`) + (Math.max(0, index) / Math.max(1, total))
  ) * Math.PI * 2;
  const vertical = (
    deterministicUnit(`${seed}:vertical`) - 0.5
  ) * Math.min(20_000, distance * 0.25);
  return {
    x: Math.cos(angle) * distance,
    y: vertical,
    z: Math.sin(angle) * distance,
  };
}

function resolveEcosystemConfiguration(value) {
  const ecosystemID = Math.max(
    0,
    Math.trunc(Number(value && typeof value === "object" ? value.ecosystemID : value) || 0),
  );
  return ecosystemID > 0
    ? cloneValue(config.ecosystems[String(ecosystemID)] || null)
    : null;
}

function resolveDungeonOverride(value) {
  const dungeonID = Math.max(
    0,
    Math.trunc(Number(value && typeof value === "object"
      ? value.dungeonID ?? value._key
      : value) || 0),
  );
  return dungeonID > 0
    ? cloneValue(config.dungeonOverrides[String(dungeonID)] || null)
    : null;
}

function buildConfiguredSpawnPlan(options) {
  const siteID = Math.max(0, Math.trunc(Number(options.siteID) || 0));
  const ecosystemConfiguration = options.ecosystemConfiguration || null;
  const dungeonOverride = options.dungeonOverride || null;
  const sourceLandscapeDungeonIDs = Array.isArray(options.sourceLandscapeDungeonIDs)
    ? options.sourceLandscapeDungeonIDs
    : [];
  const spawnTableID = String(options.spawnTableID || "").trim();
  const spawnTable = config.spawnTables[spawnTableID] || null;
  if (!config.enabled || siteID <= 0 || !spawnTable) {
    return {
      configured: false,
      activated: false,
      ecosystemID: ecosystemConfiguration && ecosystemConfiguration.ecosystemID || 0,
      npcs: [],
      wrecks: [],
      sourceLandscapeDungeonIDs,
    };
  }
  const activationChance = Math.min(
    1,
    spawnTable.activationChance * Math.max(0, Number(options.spawnFrequency) || 0),
  );
  const activationSeed = dungeonOverride
    ? `${siteID}:${spawnTableID}:${dungeonOverride.dungeonID}`
    : `${siteID}:${ecosystemConfiguration && ecosystemConfiguration.ecosystemID || 0}`;
  const activated = deterministicUnit(`${activationSeed}:activate`) <
    activationChance;
  if (!activated) {
    return {
      configured: true,
      activated: false,
      schemaVersion: config.schemaVersion,
      ecosystemID: ecosystemConfiguration.ecosystemID,
      spawnTableID,
      activationChance,
      npcs: [],
      wrecks: [],
      sourceLandscapeDungeonIDs,
      dungeonOverrideID: dungeonOverride && dungeonOverride.dungeonID || null,
      encounterTags: cloneValue(dungeonOverride && dungeonOverride.tags || []),
    };
  }

  const npcCount = deterministicInteger(`${siteID}:${spawnTableID}:npc-count`, spawnTable.npcCount);
  const familyChoices = Object.entries<any>(spawnTable.familyWeights)
    .map(([familyKey, weight]) => ({ familyKey, weight }));
  const npcSelections: any[] = [];
  const addFamilySelection = (familyKey, selectionSeed, metadata: Record<string, any> = {}) => {
    const family = config.npcFamilies[familyKey];
    const member = weightedPick(family.members, selectionSeed);
    npcSelections.push({
      ...cloneValue(member),
      familyKey,
      familyTag: family.tag,
      ...metadata,
    });
  };
  for (const requiredFamily of spawnTable.requiredFamilies || []) {
    for (let index = 0; index < requiredFamily.count; index += 1) {
      addFamilySelection(
        requiredFamily.family,
        `${siteID}:${spawnTableID}:required:${requiredFamily.family}:${index}`,
        { requiredFamily: true },
      );
    }
  }
  while (npcSelections.length < npcCount) {
    const index = npcSelections.length;
    const familyChoice = weightedPick(
      familyChoices,
      `${siteID}:${spawnTableID}:npc:${index}:family`,
    );
    const familyKey = familyChoice.familyKey;
    addFamilySelection(
      familyKey,
      `${siteID}:${spawnTableID}:npc:${index}:member`,
    );
  }
  if (
    spawnTable.bossSpawn &&
    npcSelections.length < config.defaults.maxNpcsPerSite &&
    deterministicUnit(`${siteID}:${spawnTableID}:boss`) < spawnTable.bossSpawn.chance
  ) {
    const bossFamily = config.npcFamilies[spawnTable.bossSpawn.familyKey];
    const bossMember = bossFamily.members.find(
      (member) => member.profileID === spawnTable.bossSpawn.profileID,
    );
    if (bossMember) {
      npcSelections.push({
        ...cloneValue(bossMember),
        familyKey: spawnTable.bossSpawn.familyKey,
        familyTag: bossFamily.tag,
        boss: true,
      });
    }
  }
  const npcs = npcSelections.map((entry, index) => ({
      ...entry,
      ordinal: index + 1,
      positionOffset: buildPositionOffset(
        `${siteID}:${spawnTableID}:npc:${index}`,
        config.defaults.npcDistanceMeters,
        index,
        npcSelections.length,
      ),
    }));

  const wreckCount = deterministicInteger(
    `${siteID}:${spawnTableID}:wreck-count`,
    spawnTable.wreckCount,
  );
  const wreckPool = config.wreckPools[spawnTable.wreckPool];
  const wrecks = Array.from({ length: wreckCount }, (_, index) => {
    const wreck = weightedPick(
      wreckPool.entries,
      `${siteID}:${spawnTableID}:wreck:${index}:type`,
    );
    return {
      ...cloneValue(wreck),
      ordinal: index + 1,
      key: `landscape-configured-wreck:${siteID}:${index + 1}`,
      positionOffset: buildPositionOffset(
        `${siteID}:${spawnTableID}:wreck:${index}`,
        config.defaults.wreckDistanceMeters,
        index,
        wreckCount,
      ),
    };
  });

  return {
    configured: true,
    activated: true,
    schemaVersion: config.schemaVersion,
    ecosystemID: ecosystemConfiguration && ecosystemConfiguration.ecosystemID || 0,
    ecosystemName: ecosystemConfiguration && ecosystemConfiguration.name || null,
    spawnFrequency: Math.max(0, Number(options.spawnFrequency) || 0),
    spawnTableID,
    parentSpawnTableID: spawnTable.parentSpawnTable || null,
    activationChance,
    familyTags: [...new Set(npcs.map((entry) => entry.familyTag))],
    npcs,
    wrecks,
    sourceLandscapeDungeonIDs,
    dungeonOverrideID: dungeonOverride && dungeonOverride.dungeonID || null,
    encounterName: dungeonOverride && dungeonOverride.name || ecosystemConfiguration && ecosystemConfiguration.name || null,
    encounterTags: cloneValue(dungeonOverride && dungeonOverride.tags || []),
  };
}

function buildSpawnPlan(site, ecosystem, selectedPatterns: any[] = []) {
  const siteID = Math.max(
    0,
    Math.trunc(Number(site && (site.itemID ?? site.siteID ?? site._key)) || 0),
  );
  const ecosystemConfiguration = resolveEcosystemConfiguration(ecosystem);
  const sourceLandscapeDungeonIDs = [...new Set(
    (Array.isArray(selectedPatterns) ? selectedPatterns : [])
      .map((entry) => Math.max(0, Math.trunc(Number(entry && entry.dungeonID) || 0)))
      .filter((dungeonID) => dungeonID > 0),
  )];
  const dungeonOverride = sourceLandscapeDungeonIDs
    .map((dungeonID) => config.dungeonOverrides[String(dungeonID)] || null)
    .find(Boolean) || null;
  if (!ecosystemConfiguration && !dungeonOverride) {
    return {
      configured: false,
      activated: false,
      ecosystemID: 0,
      npcs: [],
      wrecks: [],
      sourceLandscapeDungeonIDs,
    };
  }
  return buildConfiguredSpawnPlan({
    siteID,
    ecosystemConfiguration,
    dungeonOverride,
    sourceLandscapeDungeonIDs,
    spawnFrequency: (ecosystemConfiguration && ecosystemConfiguration.spawnFrequency || 1) *
      (dungeonOverride && dungeonOverride.spawnFrequency || 1),
    spawnTableID: dungeonOverride
      ? dungeonOverride.spawnTable
      : ecosystemConfiguration.spawnTable,
  });
}

function buildDungeonSpawnPlan(dungeon, seed = null) {
  const dungeonOverride = resolveDungeonOverride(dungeon);
  const dungeonID = dungeonOverride && dungeonOverride.dungeonID || 0;
  const siteID = Math.max(
    0,
    Math.trunc(Number(seed && typeof seed === "object"
      ? seed.itemID ?? seed.siteID ?? seed._key
      : seed) || dungeonID),
  );
  if (!dungeonOverride) {
    return {
      configured: false,
      activated: false,
      ecosystemID: 0,
      npcs: [],
      wrecks: [],
      sourceLandscapeDungeonIDs: dungeonID > 0 ? [dungeonID] : [],
    };
  }
  return buildConfiguredSpawnPlan({
    siteID,
    ecosystemConfiguration: null,
    dungeonOverride,
    sourceLandscapeDungeonIDs: [dungeonID],
    spawnFrequency: dungeonOverride.spawnFrequency,
    spawnTableID: dungeonOverride.spawnTable,
  });
}

function uniqueText(values) {
  return [...new Set(values.map((value) => String(value || "").trim()).filter(Boolean))];
}

function buildGeneratedNpcRows() {
  const profiles: any[] = [];
  for (const [familyKey, family] of Object.entries<any>(config.npcFamilies)) {
    for (const member of family.members) {
      const behavior = config.npcBehaviorPresets[member.behaviorPreset];
      profiles.push({
        profileID: member.profileID,
        name: member.name,
        description:
          `${family.displayName} NPC generated by the Frontier landscape spawn configuration.`,
        aliases: uniqueText([
          member.name,
          `${family.displayName} drone`,
          family.tag,
          `landscape ${familyKey}`,
        ]),
        entityType: "npc",
        hardwareFamily: "sdeEntityNpc",
        shipTypeID: member.typeID,
        presentationTypeID: member.typeID,
        corporationID: config.defaults.npcCorporationID,
        allianceID: 0,
        factionID: config.defaults.npcFactionID,
        behaviorProfileID: behavior.behaviorProfileID,
        loadoutID: config.defaults.npcLoadoutID,
        lootTableID: config.defaults.npcLootTableID,
        shipNameTemplate: member.name,
        securityStatus: -10,
        bounty: member.bounty,
        spawnDistanceMeters: Math.max(1_000, behavior.orbitDistanceMeters),
        preferredTargetMode: "invoker",
        frontierLandscapeNpcFamily: familyKey,
        frontierLandscapeNpcFamilyTag: family.tag,
        frontierLandscapeExpectedGroupID: member.groupID,
      });
    }
  }
  const behaviorProfiles = Object.values<any>(config.npcBehaviorPresets)
    .map((preset) => ({
      ...cloneValue(preset),
      description: `${preset.name} generated by the Frontier landscape spawn configuration.`,
      autoAggroTargetClasses: ["player", "drone"],
      targetPreference: "preferredTargetThenNearestPlayer",
      autoAggro: true,
      returnToHomeWhenIdle: true,
      homeArrivalMeters: Math.max(1_000, Math.round(preset.orbitDistanceMeters * 0.25)),
      autoActivateWeapons: true,
      useChasePropulsion: true,
      allowFriendlyNpcTargets: false,
    }));
  return deepFreeze({
    [NPC_PROFILE_TABLE]: profiles,
    [NPC_BEHAVIOR_PROFILE_TABLE]: behaviorProfiles,
  });
}

const generatedNpcRows = buildGeneratedNpcRows();

function getConfig() {
  return config;
}

function getConfigSummary() {
  return {
    configPath: CONFIG_PATH,
    schemaVersion: config.schemaVersion,
    enabled: config.enabled,
    clientBuild: config.source.clientBuild,
    ecosystemCount: Object.keys(config.ecosystems).length,
    spawnTableCount: Object.keys(config.spawnTables).length,
    dungeonOverrideCount: Object.keys(config.dungeonOverrides).length,
    npcFamilyCount: Object.keys(config.npcFamilies).length,
    npcProfileCount: generatedNpcRows[NPC_PROFILE_TABLE].length,
    wreckPoolCount: Object.keys(config.wreckPools).length,
  };
}

function getGeneratedNpcRows(tableName) {
  if (!config.enabled) {
    return [];
  }
  const normalized = String(tableName || "").trim();
  if (normalized === "profiles") {
    return cloneValue(generatedNpcRows[NPC_PROFILE_TABLE]);
  }
  if (normalized === "behaviorProfiles") {
    return cloneValue(generatedNpcRows[NPC_BEHAVIOR_PROFILE_TABLE]);
  }
  return cloneValue(generatedNpcRows[normalized] || []);
}

module.exports = {
  CONFIG_PATH,
  SALVAGEABLE_WRECKAGE_GROUP_ID,
  buildDungeonSpawnPlan,
  buildSpawnPlan,
  getConfig,
  getConfigSummary,
  getGeneratedNpcRows,
  resolveDungeonOverride,
  resolveEcosystemConfiguration,
  _testing: {
    buildPositionOffset,
    deterministicInteger,
    deterministicUnit,
    hash32,
    weightedPick,
  },
};
