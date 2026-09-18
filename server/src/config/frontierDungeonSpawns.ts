const fs = require("fs");
const path = require("path");
const frontierLandscapeSpawns = require("./frontierLandscapeSpawns");

const CONFIG_PATH = path.resolve(
  __dirname,
  "../../../frontier-dungeon-spawns.json",
);

const SUPPORTED_SCHEMA_VERSION = 2;
const NPC_PROFILE_TABLE = "npcProfiles";
const NPC_BEHAVIOR_PROFILE_TABLE = "npcBehaviorProfiles";
const DEFAULT_ROGUE_DRONE_CORPORATION_ID = 1000287;
const DEFAULT_LOOT_TABLE_ID = "generic_random_any";
const SPAWN_GUARD_EVENT_TYPE_ID = 3;

const SPAWN_KINDS = new Set([
  "entity",
  "event",
  "locator",
  "npc_wave",
]);
const SPAWNER_CATEGORIES = new Set([
  "event_controller",
  "event_locator",
  "named_controller",
  "npc_feral_drone_controller",
  "npc_feral_miner_controller",
  "npc_locator",
  "resource_locator",
  "threat_locator",
]);
const SITE_ACTIVATIONS = new Set([
  "initial",
  "triggered",
  "locator",
]);

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

function nonNegativeNumber(value, fieldName) {
  const normalized = Number(value);
  if (!Number.isFinite(normalized) || normalized < 0) {
    throw new TypeError(`${fieldName} must be a non-negative finite number`);
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

function normalizePlacementDistanceAu(value, fieldName) {
  const source = assertRecord(value, fieldName);
  const min = nonNegativeNumber(source.min, `${fieldName}.min`);
  const max = positiveNumber(source.max, `${fieldName}.max`);
  if (max < min) {
    throw new TypeError(`${fieldName}.max must be greater than or equal to ${fieldName}.min`);
  }
  return { min, max };
}

function normalizeSeparationLightSeconds(value, fieldName) {
  const source = assertRecord(value, fieldName);
  const min = positiveNumber(source.min, `${fieldName}.min`);
  const max = positiveNumber(source.max, `${fieldName}.max`);
  if (max < min) {
    throw new TypeError(`${fieldName}.max must be greater than or equal to ${fieldName}.min`);
  }
  return { min, max };
}

function normalizeWarpIn(value, fieldName) {
  const source = assertRecord(value, fieldName);
  return {
    boundaryRadiusMeters: positiveNumber(
      source.boundaryRadiusMeters,
      `${fieldName}.boundaryRadiusMeters`,
    ),
    collisionClearanceMeters: nonNegativeNumber(
      source.collisionClearanceMeters,
      `${fieldName}.collisionClearanceMeters`,
    ),
  };
}

function requiredBoolean(value, fieldName) {
  if (typeof value !== "boolean") {
    throw new TypeError(`${fieldName} must be a boolean`);
  }
  return value;
}

function normalizeStringArray(value, fieldName) {
  const seen = new Set();
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

function assertCanonicalPositiveIntegerKey(key, fieldName) {
  const normalized = positiveInteger(key, fieldName);
  if (String(normalized) !== String(key)) {
    throw new TypeError(`${fieldName} must use canonical positive-integer text`);
  }
  return normalized;
}

function normalizePosition(value, fieldName) {
  if (value == null) {
    return { x: 0, y: 0, z: 0 };
  }
  const source = assertRecord(value, fieldName);
  const normalizeCoordinate = (coordinateName) => {
    const normalized = Number(source[coordinateName] == null ? 0 : source[coordinateName]);
    if (!Number.isFinite(normalized)) {
      throw new TypeError(`${fieldName}.${coordinateName} must be a finite number`);
    }
    return normalized;
  };
  return {
    x: normalizeCoordinate("x"),
    y: normalizeCoordinate("y"),
    z: normalizeCoordinate("z"),
  };
}

function normalizeEntityDescriptor(value, fieldName) {
  const source = assertRecord(value, fieldName);
  return {
    typeID: positiveInteger(source.typeID, `${fieldName}.typeID`),
    name: source.name == null || String(source.name).trim() === ""
      ? null
      : nonEmptyText(source.name, `${fieldName}.name`),
    positionOffset: normalizePosition(
      source.positionOffset,
      `${fieldName}.positionOffset`,
    ),
    count: source.count == null
      ? 1
      : positiveInteger(source.count, `${fieldName}.count`),
  };
}

function normalizeOptionalEntityDescriptors(value, fieldName) {
  if (value == null) {
    return [];
  }
  return assertArray(value, fieldName).map((entry, index) => (
    normalizeEntityDescriptor(entry, `${fieldName}[${index}]`)
  ));
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

function cloneValue(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function readRawConfig() {
  let payload;
  try {
    payload = fs.readFileSync(CONFIG_PATH, "utf8");
  } catch (error) {
    const message = error && error.message ? error.message : String(error);
    throw new Error(`Unable to read Frontier dungeon spawn config at ${CONFIG_PATH}: ${message}`);
  }
  try {
    return JSON.parse(String(payload).replace(/^\uFEFF/, ""));
  } catch (error) {
    const message = error && error.message ? error.message : String(error);
    throw new SyntaxError(`Invalid Frontier dungeon spawn config at ${CONFIG_PATH}: ${message}`);
  }
}

function validateConfig(rawConfig) {
  const sourceConfig = assertRecord(rawConfig, "frontier dungeon spawn config");
  const schemaVersion = positiveInteger(
    sourceConfig.schemaVersion,
    "schemaVersion",
  );
  if (schemaVersion !== SUPPORTED_SCHEMA_VERSION) {
    throw new TypeError(
      `schemaVersion must be ${SUPPORTED_SCHEMA_VERSION}; received ${schemaVersion}`,
    );
  }
  const enabled = requiredBoolean(sourceConfig.enabled, "enabled");

  const rawSource = assertRecord(sourceConfig.source, "source");
  const source = {
    clientBuild: positiveInteger(rawSource.clientBuild, "source.clientBuild"),
    analysis: nonEmptyText(rawSource.analysis, "source.analysis"),
    notes: nonEmptyText(rawSource.notes, "source.notes"),
  };

  const rawDefaults = assertRecord(sourceConfig.defaults, "defaults");
  const defaults = {
    factionTagPrefix: nonEmptyText(
      rawDefaults.factionTagPrefix,
      "defaults.factionTagPrefix",
    ),
    siteSpawnFrequency: positiveNumber(
      rawDefaults.siteSpawnFrequency,
      "defaults.siteSpawnFrequency",
    ),
    sitePlacementDistanceAu: normalizePlacementDistanceAu(
      rawDefaults.sitePlacementDistanceAu,
      "defaults.sitePlacementDistanceAu",
    ),
    siteSeparationLightSeconds: normalizeSeparationLightSeconds(
      rawDefaults.siteSeparationLightSeconds,
      "defaults.siteSeparationLightSeconds",
    ),
    warpIn: normalizeWarpIn(
      rawDefaults.warpIn,
      "defaults.warpIn",
    ),
    maxNpcEntriesPerController: positiveInteger(
      rawDefaults.maxNpcEntriesPerController,
      "defaults.maxNpcEntriesPerController",
    ),
    formationSpacingMeters: nonNegativeNumber(
      rawDefaults.formationSpacingMeters,
      "defaults.formationSpacingMeters",
    ),
    npcFactionID: positiveInteger(
      rawDefaults.npcFactionID,
      "defaults.npcFactionID",
    ),
    npcCorporationID: positiveInteger(
      rawDefaults.npcCorporationID == null
        ? DEFAULT_ROGUE_DRONE_CORPORATION_ID
        : rawDefaults.npcCorporationID,
      "defaults.npcCorporationID",
    ),
    npcLoadoutID: nonEmptyText(
      rawDefaults.npcLoadoutID,
      "defaults.npcLoadoutID",
    ),
  };

  const rawSiteTypes = assertRecord(sourceConfig.siteTypes, "siteTypes");
  const siteTypes: Record<string, any> = {};
  for (const [siteTypeKey, rawSiteType] of Object.entries<any>(rawSiteTypes)) {
    assertCanonicalPositiveIntegerKey(siteTypeKey, `siteTypes key ${siteTypeKey}`);
    const fieldName = `siteTypes.${siteTypeKey}`;
    const siteType = assertRecord(rawSiteType, fieldName);
    siteTypes[siteTypeKey] = {
      key: nonEmptyText(siteType.key, `${fieldName}.key`),
      name: nonEmptyText(siteType.name, `${fieldName}.name`),
      spawnFrequency: siteType.spawnFrequency == null
        ? defaults.siteSpawnFrequency
        : positiveNumber(siteType.spawnFrequency, `${fieldName}.spawnFrequency`),
      placementDistanceAu: siteType.placementDistanceAu == null
        ? cloneValue(defaults.sitePlacementDistanceAu)
        : normalizePlacementDistanceAu(
          siteType.placementDistanceAu,
          `${fieldName}.placementDistanceAu`,
        ),
      separationLightSeconds: siteType.separationLightSeconds == null
        ? cloneValue(defaults.siteSeparationLightSeconds)
        : normalizeSeparationLightSeconds(
          siteType.separationLightSeconds,
          `${fieldName}.separationLightSeconds`,
        ),
      warpIn: siteType.warpIn == null
        ? cloneValue(defaults.warpIn)
        : normalizeWarpIn(siteType.warpIn, `${fieldName}.warpIn`),
      allowsNpcWaves: requiredBoolean(
        siteType.allowsNpcWaves,
        `${fieldName}.allowsNpcWaves`,
      ),
      allowsEntitySpawns: requiredBoolean(
        siteType.allowsEntitySpawns,
        `${fieldName}.allowsEntitySpawns`,
      ),
    };
  }
  if (Object.keys(siteTypes).length <= 0) {
    throw new TypeError("siteTypes must contain at least one site type");
  }

  const rawBehaviorPresets = assertRecord(
    sourceConfig.npcBehaviorPresets,
    "npcBehaviorPresets",
  );
  const npcBehaviorPresets: Record<string, any> = {};
  const behaviorProfileIDs = new Set();
  for (const [presetKey, rawPreset] of Object.entries<any>(rawBehaviorPresets)) {
    const normalizedPresetKey = nonEmptyText(
      presetKey,
      "npcBehaviorPresets key",
    );
    const fieldName = `npcBehaviorPresets.${normalizedPresetKey}`;
    const preset = assertRecord(rawPreset, fieldName);
    const behaviorProfileID = nonEmptyText(
      preset.behaviorProfileID,
      `${fieldName}.behaviorProfileID`,
    );
    if (behaviorProfileIDs.has(behaviorProfileID.toLowerCase())) {
      throw new TypeError(`duplicate behaviorProfileID: ${behaviorProfileID}`);
    }
    behaviorProfileIDs.add(behaviorProfileID.toLowerCase());
    npcBehaviorPresets[normalizedPresetKey] = {
      behaviorProfileID,
      name: nonEmptyText(preset.name, `${fieldName}.name`),
      thinkIntervalMs: positiveInteger(
        preset.thinkIntervalMs,
        `${fieldName}.thinkIntervalMs`,
      ),
      movementMode: nonEmptyText(
        preset.movementMode,
        `${fieldName}.movementMode`,
      ),
      orbitDistanceMeters: nonNegativeNumber(
        preset.orbitDistanceMeters,
        `${fieldName}.orbitDistanceMeters`,
      ),
      followRangeMeters: nonNegativeNumber(
        preset.followRangeMeters,
        `${fieldName}.followRangeMeters`,
      ),
      aggressionRangeMeters: nonNegativeNumber(
        preset.aggressionRangeMeters,
        `${fieldName}.aggressionRangeMeters`,
      ),
      leashRangeMeters: nonNegativeNumber(
        preset.leashRangeMeters,
        `${fieldName}.leashRangeMeters`,
      ),
      cruiseSpeedMetersPerSecond: nonNegativeNumber(
        preset.cruiseSpeedMetersPerSecond,
        `${fieldName}.cruiseSpeedMetersPerSecond`,
      ),
      chaseMaxVelocityMetersPerSecond: nonNegativeNumber(
        preset.chaseMaxVelocityMetersPerSecond,
        `${fieldName}.chaseMaxVelocityMetersPerSecond`,
      ),
    };
  }
  if (Object.keys(npcBehaviorPresets).length <= 0) {
    throw new TypeError("npcBehaviorPresets must contain at least one preset");
  }

  const rawFactions = assertRecord(sourceConfig.factions, "factions");
  const factions: Record<string, any> = {};
  const profileIDs = new Set();
  for (const [factionKey, rawFaction] of Object.entries<any>(rawFactions)) {
    const normalizedFactionKey = nonEmptyText(factionKey, "factions key");
    if (normalizedFactionKey !== normalizedFactionKey.toLowerCase()) {
      throw new TypeError(`faction key must be lowercase: ${normalizedFactionKey}`);
    }
    const fieldName = `factions.${normalizedFactionKey}`;
    const faction = assertRecord(rawFaction, fieldName);
    const tag = nonEmptyText(faction.tag, `${fieldName}.tag`);
    const expectedTag = `${defaults.factionTagPrefix}${normalizedFactionKey}`;
    if (tag !== expectedTag) {
      throw new TypeError(`${fieldName}.tag must be ${expectedTag}`);
    }
    const rawNpcRoles = assertRecord(faction.npcRoles, `${fieldName}.npcRoles`);
    const npcRoles: Record<string, any> = {};
    for (const [roleKey, rawProfiles] of Object.entries<any>(rawNpcRoles)) {
      const normalizedRoleKey = nonEmptyText(
        roleKey,
        `${fieldName}.npcRoles key`,
      );
      const profiles = assertArray(
        rawProfiles,
        `${fieldName}.npcRoles.${normalizedRoleKey}`,
      );
      if (profiles.length <= 0) {
        throw new TypeError(
          `${fieldName}.npcRoles.${normalizedRoleKey} must not be empty`,
        );
      }
      npcRoles[normalizedRoleKey] = profiles.map((rawProfile, profileIndex) => {
        const profileField = `${fieldName}.npcRoles.${normalizedRoleKey}[${profileIndex}]`;
        const profile = assertRecord(rawProfile, profileField);
        const profileID = nonEmptyText(
          profile.profileID,
          `${profileField}.profileID`,
        );
        if (profileIDs.has(profileID.toLowerCase())) {
          throw new TypeError(`duplicate profileID: ${profileID}`);
        }
        profileIDs.add(profileID.toLowerCase());
        const behaviorPreset = nonEmptyText(
          profile.behaviorPreset,
          `${profileField}.behaviorPreset`,
        );
        if (!npcBehaviorPresets[behaviorPreset]) {
          throw new TypeError(
            `${profileField}.behaviorPreset references unknown preset ${behaviorPreset}`,
          );
        }
        return {
          profileID,
          typeID: positiveInteger(profile.typeID, `${profileField}.typeID`),
          name: nonEmptyText(profile.name, `${profileField}.name`),
          behaviorPreset,
          bounty: nonNegativeInteger(profile.bounty, `${profileField}.bounty`),
        };
      });
    }
    if (Object.keys(npcRoles).length <= 0) {
      throw new TypeError(`${fieldName}.npcRoles must contain at least one role`);
    }
    factions[normalizedFactionKey] = {
      displayName: nonEmptyText(faction.displayName, `${fieldName}.displayName`),
      tag,
      npcRoles,
    };
  }
  if (Object.keys(factions).length <= 0) {
    throw new TypeError("factions must contain at least one faction");
  }

  const rawHiveSpawns = assertRecord(sourceConfig.hiveSpawns, "hiveSpawns");
  const hiveSpawns: Record<string, any> = {};
  for (const [typeKey, rawHiveSpawn] of Object.entries<any>(rawHiveSpawns)) {
    const hiveTypeID = assertCanonicalPositiveIntegerKey(
      typeKey,
      `hiveSpawns key ${typeKey}`,
    );
    const fieldName = `hiveSpawns.${typeKey}`;
    const hiveSpawn = assertRecord(rawHiveSpawn, fieldName);
    const droneTypes = normalizeStringArray(
      hiveSpawn.droneTypes,
      `${fieldName}.droneTypes`,
    );
    if (droneTypes.length <= 0) {
      throw new TypeError(`${fieldName}.droneTypes must not be empty`);
    }
    for (const droneType of droneTypes) {
      if (!factions[droneType]) {
        throw new TypeError(
          `${fieldName}.droneTypes references unknown drone type ${droneType}`,
        );
      }
    }
    const roles = normalizeStringArray(hiveSpawn.roles, `${fieldName}.roles`);
    if (roles.length <= 0) {
      throw new TypeError(`${fieldName}.roles must not be empty`);
    }
    if (roles.includes("*") && roles.length !== 1) {
      throw new TypeError(`${fieldName}.roles wildcard must be used alone`);
    }
    if (!roles.includes("*")) {
      for (const droneType of droneTypes) {
        for (const role of roles) {
          if (!Array.isArray(factions[droneType].npcRoles[role])) {
            throw new TypeError(
              `${fieldName}.roles references missing ${droneType} role ${role}`,
            );
          }
        }
      }
    }
    hiveSpawns[typeKey] = {
      typeID: hiveTypeID,
      name: nonEmptyText(hiveSpawn.name, `${fieldName}.name`),
      droneTypes,
      roles,
    };
  }
  if (Object.keys(hiveSpawns).length <= 0) {
    throw new TypeError("hiveSpawns must contain at least one hive type");
  }

  const rawSpawnerTypes = assertRecord(sourceConfig.spawnerTypes, "spawnerTypes");
  const spawnerTypes: Record<string, any> = {};
  for (const [typeKey, rawSpawnerType] of Object.entries<any>(rawSpawnerTypes)) {
    const mapTypeID = assertCanonicalPositiveIntegerKey(
      typeKey,
      `spawnerTypes key ${typeKey}`,
    );
    const fieldName = `spawnerTypes.${typeKey}`;
    const spawnerType = assertRecord(rawSpawnerType, fieldName);
    const typeID = positiveInteger(spawnerType.typeID, `${fieldName}.typeID`);
    if (typeID !== mapTypeID) {
      throw new TypeError(`${fieldName}.typeID must equal map key ${typeKey}`);
    }
    const category = nonEmptyText(spawnerType.category, `${fieldName}.category`);
    if (!SPAWNER_CATEGORIES.has(category)) {
      throw new TypeError(`${fieldName}.category is unsupported: ${category}`);
    }
    const spawnKind = nonEmptyText(spawnerType.spawnKind, `${fieldName}.spawnKind`);
    if (!SPAWN_KINDS.has(spawnKind)) {
      throw new TypeError(`${fieldName}.spawnKind is unsupported: ${spawnKind}`);
    }
    const isNpcWave = requiredBoolean(
      spawnerType.isNpcWave,
      `${fieldName}.isNpcWave`,
    );
    if ((spawnKind === "npc_wave") !== isNpcWave) {
      throw new TypeError(
        `${fieldName}.spawnKind must be npc_wave exactly when isNpcWave is true`,
      );
    }
    const rawComposition = spawnerType.composition;
    let composition: any[] = [];
    if (isNpcWave) {
      composition = assertArray(rawComposition, `${fieldName}.composition`)
        .map((rawEntry, index) => {
          const compositionField = `${fieldName}.composition[${index}]`;
          const entry = assertRecord(rawEntry, compositionField);
          return {
            role: nonEmptyText(entry.role, `${compositionField}.role`),
            count: positiveInteger(entry.count, `${compositionField}.count`),
          };
        });
      if (composition.length <= 0) {
        throw new TypeError(`${fieldName}.composition must not be empty`);
      }
      const expandedCount = composition.reduce(
        (total, entry) => total + entry.count,
        0,
      );
      if (expandedCount > defaults.maxNpcEntriesPerController) {
        throw new TypeError(
          `${fieldName}.composition expands to ${expandedCount}, exceeding ` +
          `defaults.maxNpcEntriesPerController=${defaults.maxNpcEntriesPerController}`,
        );
      }
    } else if (rawComposition != null && assertArray(
      rawComposition,
      `${fieldName}.composition`,
    ).length > 0) {
      throw new TypeError(`${fieldName}.composition is only valid for NPC waves`);
    }
    const defaultFaction = spawnerType.defaultFaction == null
      ? null
      : nonEmptyText(spawnerType.defaultFaction, `${fieldName}.defaultFaction`);
    if (defaultFaction && !factions[defaultFaction]) {
      throw new TypeError(
        `${fieldName}.defaultFaction references unknown faction ${defaultFaction}`,
      );
    }
    spawnerTypes[typeKey] = {
      typeID,
      name: nonEmptyText(spawnerType.name, `${fieldName}.name`),
      category,
      spawnKind,
      isNpcWave,
      ...(defaultFaction ? { defaultFaction } : {}),
      ...(composition.length > 0 ? { composition } : {}),
      ...(spawnerType.entityComposition != null
        ? {
          entityComposition: normalizeOptionalEntityDescriptors(
            spawnerType.entityComposition,
            `${fieldName}.entityComposition`,
          ),
        }
        : {}),
    };
  }
  if (Object.keys(spawnerTypes).length <= 0) {
    throw new TypeError("spawnerTypes must contain at least one spawner type");
  }

  const rawSites = assertRecord(sourceConfig.sites, "sites");
  const sites: Record<string, any> = {};
  for (const [dungeonKey, rawSite] of Object.entries<any>(rawSites)) {
    const dungeonID = assertCanonicalPositiveIntegerKey(
      dungeonKey,
      `sites key ${dungeonKey}`,
    );
    const fieldName = `sites.${dungeonKey}`;
    const site = assertRecord(rawSite, fieldName);
    const siteTypeID = positiveInteger(site.siteTypeID, `${fieldName}.siteTypeID`);
    const siteType = siteTypes[String(siteTypeID)];
    if (!siteType) {
      throw new TypeError(`${fieldName}.siteTypeID references unknown site type ${siteTypeID}`);
    }
    const faction = site.faction == null
      ? null
      : nonEmptyText(site.faction, `${fieldName}.faction`);
    if (faction && !factions[faction]) {
      throw new TypeError(`${fieldName}.faction references unknown faction ${faction}`);
    }
    const spawners = assertArray(site.spawners, `${fieldName}.spawners`)
      .map((rawSpawner, spawnerIndex) => {
        const spawnerField = `${fieldName}.spawners[${spawnerIndex}]`;
        const spawner = assertRecord(rawSpawner, spawnerField);
        const typeID = positiveInteger(spawner.typeID, `${spawnerField}.typeID`);
        const spawnerType = spawnerTypes[String(typeID)];
        if (!spawnerType) {
          throw new TypeError(
            `${spawnerField}.typeID references unknown spawner type ${typeID}`,
          );
        }
        const activation = nonEmptyText(
          spawner.activation,
          `${spawnerField}.activation`,
        );
        if (!SITE_ACTIVATIONS.has(activation)) {
          throw new TypeError(
            `${spawnerField}.activation is unsupported: ${activation}`,
          );
        }
        const rawTriggerValues = spawner.rawTriggerValues == null
          ? null
          : assertArray(
            spawner.rawTriggerValues,
            `${spawnerField}.rawTriggerValues`,
          ).map((triggerValue, triggerIndex) => nonNegativeInteger(
            triggerValue,
            `${spawnerField}.rawTriggerValues[${triggerIndex}]`,
          ));
        if (spawnerType.isNpcWave) {
          if (!siteType.allowsNpcWaves) {
            throw new TypeError(`${fieldName} uses an NPC wave in a disallowed site type`);
          }
          const resolvedFaction = spawnerType.defaultFaction || faction;
          if (!resolvedFaction || !factions[resolvedFaction]) {
            throw new TypeError(
              `${spawnerField} requires a site faction or spawner defaultFaction`,
            );
          }
          for (const entry of spawnerType.composition) {
            if (!Array.isArray(factions[resolvedFaction].npcRoles[entry.role])) {
              throw new TypeError(
                `${spawnerField} requires missing ${resolvedFaction} role ${entry.role}`,
              );
            }
          }
        }
        return {
          typeID,
          count: positiveInteger(spawner.count, `${spawnerField}.count`),
          activation,
          ...(rawTriggerValues ? { rawTriggerValues } : {}),
        };
      });
    const entities = normalizeOptionalEntityDescriptors(
      site.entities,
      `${fieldName}.entities`,
    );
    if (entities.length > 0 && !siteType.allowsEntitySpawns) {
      throw new TypeError(`${fieldName}.entities are disallowed for this site type`);
    }
    sites[String(dungeonID)] = {
      name: nonEmptyText(site.name, `${fieldName}.name`),
      siteTypeID,
      spawnFrequency: site.spawnFrequency == null
        ? siteType.spawnFrequency
        : positiveNumber(site.spawnFrequency, `${fieldName}.spawnFrequency`),
      placementDistanceAu: site.placementDistanceAu == null
        ? cloneValue(siteType.placementDistanceAu)
        : normalizePlacementDistanceAu(
          site.placementDistanceAu,
          `${fieldName}.placementDistanceAu`,
        ),
      separationLightSeconds: site.separationLightSeconds == null
        ? cloneValue(siteType.separationLightSeconds)
        : normalizeSeparationLightSeconds(
          site.separationLightSeconds,
          `${fieldName}.separationLightSeconds`,
        ),
      warpIn: site.warpIn == null
        ? cloneValue(siteType.warpIn)
        : normalizeWarpIn(site.warpIn, `${fieldName}.warpIn`),
      entryBeaconTypeID: positiveInteger(
        site.entryBeaconTypeID,
        `${fieldName}.entryBeaconTypeID`,
      ),
      ...(faction ? { faction } : {}),
      tags: normalizeStringArray(site.tags, `${fieldName}.tags`),
      spawners,
      ...(site.entities != null ? { entities } : {}),
    };
  }
  if (Object.keys(sites).length <= 0) {
    throw new TypeError("sites must contain at least one exact dungeon-ID entry");
  }

  return {
    schemaVersion,
    enabled,
    source,
    defaults,
    siteTypes,
    npcBehaviorPresets,
    factions,
    hiveSpawns,
    spawnerTypes,
    sites,
  };
}

const config = deepFreeze(validateConfig(readRawConfig()));

function getConfig() {
  return config;
}

function countNpcProfiles() {
  let count = 0;
  for (const faction of Object.values<any>(config.factions)) {
    for (const profiles of Object.values<any>(faction.npcRoles)) {
      count += profiles.length;
    }
  }
  return count;
}

const configSummary = deepFreeze({
  configPath: CONFIG_PATH,
  schemaVersion: config.schemaVersion,
  enabled: config.enabled,
  clientBuild: config.source.clientBuild,
  siteTypeCount: Object.keys(config.siteTypes).length,
  npcBehaviorPresetCount: Object.keys(config.npcBehaviorPresets).length,
  factionCount: Object.keys(config.factions).length,
  hiveSpawnTypeCount: Object.keys(config.hiveSpawns).length,
  spawnerTypeCount: Object.keys(config.spawnerTypes).length,
  npcWaveSpawnerTypeCount: Object.values<any>(config.spawnerTypes)
    .filter((entry) => entry.isNpcWave === true).length,
  configuredSiteCount: Object.keys(config.sites).length,
  factionTaggedSiteCount: Object.values<any>(config.sites)
    .filter((entry) => Boolean(entry.faction)).length,
  generatedNpcProfileCount: countNpcProfiles(),
  generatedNpcBehaviorProfileCount: Object.keys(config.npcBehaviorPresets).length,
});

function getConfigSummary() {
  return cloneValue(configSummary);
}

function toPositiveInt(value, fallback = 0) {
  const normalized = Number(value);
  return Number.isInteger(normalized) && normalized > 0
    ? normalized
    : fallback;
}

function resolveDungeonID(value) {
  const direct = toPositiveInt(value, 0);
  if (direct > 0) {
    return direct;
  }
  if (!isRecord(value)) {
    return 0;
  }
  const metadata = isRecord(value.metadata) ? value.metadata : {};
  for (const candidate of [
    value.sourceDungeonID,
    value.dungeonID,
    value.clientDungeonID,
    value._key,
    metadata.sourceDungeonID,
    metadata.dungeonID,
    metadata.clientDungeonID,
  ]) {
    const dungeonID = toPositiveInt(candidate, 0);
    if (dungeonID > 0) {
      return dungeonID;
    }
  }
  for (const candidate of [value.templateID, value.id]) {
    const match = String(candidate || "").match(
      /^(?:client|frontier)?-?dungeon:(\d+)$/i,
    );
    if (match) {
      return toPositiveInt(match[1], 0);
    }
  }
  return 0;
}

function uniqueText(values) {
  const seen = new Set();
  const result: string[] = [];
  for (const value of values) {
    const normalized = String(value == null ? "" : value).trim();
    const key = normalized.toLowerCase();
    if (!normalized || seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(normalized);
  }
  return result;
}

function resolveSiteConfiguration(value) {
  if (!config.enabled) {
    return null;
  }
  const dungeonID = resolveDungeonID(value);
  if (dungeonID <= 0) {
    return null;
  }
  const site = config.sites[String(dungeonID)] || null;
  if (!site) {
    return null;
  }
  const factionKey = String(site.faction || "").trim() || null;
  const factionConfiguration = factionKey
    ? config.factions[factionKey] || null
    : null;
  const factionTag = factionConfiguration
    ? String(factionConfiguration.tag || "").trim() || null
    : null;
  return {
    dungeonID,
    ...cloneValue(site),
    factionKey,
    factionTag,
    factionConfig: cloneValue(factionConfiguration),
    factionConfiguration: cloneValue(factionConfiguration),
    siteTypeConfig: cloneValue(config.siteTypes[String(site.siteTypeID)] || null),
    siteType: cloneValue(config.siteTypes[String(site.siteTypeID)] || null),
    tags: uniqueText([
      ...site.tags,
      factionTag,
    ]),
  };
}

function resolveHiveTypeID(value) {
  const direct = toPositiveInt(value, 0);
  if (direct > 0) {
    return direct;
  }
  if (!isRecord(value)) {
    return 0;
  }
  return toPositiveInt(
    value.typeID,
    toPositiveInt(value.hiveTypeID, toPositiveInt(value.presentationTypeID, 0)),
  );
}

function resolveHiveSpawnConfiguration(value) {
  if (!config.enabled) {
    return null;
  }
  const hiveTypeID = resolveHiveTypeID(value);
  const hiveSpawn = config.hiveSpawns[String(hiveTypeID)] || null;
  if (!hiveSpawn) {
    return null;
  }

  const spawnEntries: any[] = [];
  const seenTypeIDs = new Set();
  for (const droneType of hiveSpawn.droneTypes) {
    const faction = config.factions[droneType];
    const roles = hiveSpawn.roles.includes("*")
      ? Object.keys(faction.npcRoles)
      : hiveSpawn.roles;
    for (const role of roles) {
      for (const profile of faction.npcRoles[role] || []) {
        if (seenTypeIDs.has(profile.typeID)) {
          continue;
        }
        seenTypeIDs.add(profile.typeID);
        spawnEntries.push({
          profileID: profile.profileID,
          typeID: profile.typeID,
          name: profile.name,
          role,
          droneType,
          factionKey: droneType,
          factionTag: faction.tag,
        });
      }
    }
  }

  return {
    hiveTypeID,
    name: hiveSpawn.name,
    droneTypes: cloneValue(hiveSpawn.droneTypes),
    roles: cloneValue(hiveSpawn.roles),
    spawnEntries,
  };
}

function addPositions(left, right) {
  return {
    x: Number(left && left.x || 0) + Number(right && right.x || 0),
    y: Number(left && left.y || 0) + Number(right && right.y || 0),
    z: Number(left && left.z || 0) + Number(right && right.z || 0),
  };
}

function subtractPositions(left, right) {
  return {
    x: Number(left && left.x || 0) - Number(right && right.x || 0),
    y: Number(left && left.y || 0) - Number(right && right.y || 0),
    z: Number(left && left.z || 0) - Number(right && right.z || 0),
  };
}

function runtimePosition(value) {
  if (!isRecord(value)) {
    return { x: 0, y: 0, z: 0 };
  }
  const coordinate = (name) => {
    const normalized = Number(value[name]);
    return Number.isFinite(normalized) ? normalized : 0;
  };
  return {
    x: coordinate("x"),
    y: coordinate("y"),
    z: coordinate("z"),
  };
}

function formationOffset(index, count, spacingMeters) {
  if (count <= 1 || spacingMeters <= 0) {
    return { x: 0, y: 0, z: 0 };
  }
  const angle = (Math.PI * 2 * index) / count;
  return {
    x: Math.round(Math.cos(angle) * spacingMeters * 1000) / 1000,
    y: Math.round(Math.sin(angle) * spacingMeters * 1000) / 1000,
    z: Math.round((((index % 3) - 1) * spacingMeters * 0.15) * 1000) / 1000,
  };
}

function flattenAuthoredObjects(template) {
  const flattened: any[] = [];
  const rooms = Array.isArray(template && template.rooms) ? template.rooms : [];
  rooms.forEach((room, roomIndex) => {
    const roomPosition = runtimePosition(
      room && room.position || {
        x: room && room.x,
        y: room && room.y,
        z: room && room.z,
      },
    );
    const objects = Array.isArray(room && room.objects) ? room.objects : [];
    objects.forEach((object, objectIndex) => {
      if (!isRecord(object)) {
        return;
      }
      flattened.push({
        object,
        objectID: toPositiveInt(object.objectID, 0),
        typeID: toPositiveInt(object.typeID, 0),
        roomID: toPositiveInt(object.roomID, toPositiveInt(room && room.roomID, 0)),
        roomIndex,
        objectIndex,
        authoredIndex: (roomIndex * 1_000_000) + objectIndex,
        absolutePosition: addPositions(
          roomPosition,
          runtimePosition(object.position),
        ),
      });
    });
  });
  return flattened;
}

function buildTriggerAuthority(template) {
  const incomingSourceObjectIDsByTarget = new Map();
  const rawTinyIntValuesByObjectID = new Map();
  const triggers = Array.isArray(template && template.triggers)
    ? template.triggers
    : [];
  for (const trigger of triggers) {
    if (!isRecord(trigger)) {
      continue;
    }
    const sourceObjectID = toPositiveInt(trigger.objectID, 0);
    if (sourceObjectID > 0 && trigger.tinyint_1 != null) {
      const rawValue = Number(trigger.tinyint_1);
      if (Number.isInteger(rawValue)) {
        const values = rawTinyIntValuesByObjectID.get(sourceObjectID) || [];
        if (!values.includes(rawValue)) {
          values.push(rawValue);
          rawTinyIntValuesByObjectID.set(sourceObjectID, values);
        }
      }
    }
    const events = Array.isArray(trigger.triggerEvents)
      ? trigger.triggerEvents
      : [];
    for (const event of events) {
      if (
        !isRecord(event) ||
        Number(event.eventTypeID) !== SPAWN_GUARD_EVENT_TYPE_ID
      ) {
        continue;
      }
      const targetObjectID = toPositiveInt(event.objectID, 0);
      if (sourceObjectID <= 0 || targetObjectID <= 0) {
        continue;
      }
      const sources = incomingSourceObjectIDsByTarget.get(targetObjectID) || [];
      if (!sources.includes(sourceObjectID)) {
        sources.push(sourceObjectID);
        incomingSourceObjectIDsByTarget.set(targetObjectID, sources);
      }
    }
  }
  return {
    incomingSourceObjectIDsByTarget,
    rawTinyIntValuesByObjectID,
  };
}

function buildNpcSpawnEntries(
  controller,
  spawnerType,
  factionKey,
  faction,
  anchorOffset,
) {
  const entries: any[] = [];
  const maxEntries = config.defaults.maxNpcEntriesPerController;
  const composition = Array.isArray(spawnerType.composition)
    ? spawnerType.composition
    : [];
  for (const compositionEntry of composition) {
    const candidates = Array.isArray(faction.npcRoles[compositionEntry.role])
      ? faction.npcRoles[compositionEntry.role]
      : [];
    for (
      let roleIndex = 0;
      roleIndex < compositionEntry.count && entries.length < maxEntries;
      roleIndex += 1
    ) {
      const profile = candidates[roleIndex % candidates.length];
      if (!profile) {
        continue;
      }
      entries.push({
        key: `frontier-npc:${controller.objectID || controller.authoredIndex}:` +
          `${compositionEntry.role}:${roleIndex + 1}`,
        profileID: profile.profileID,
        spawnQuery: profile.profileID,
        typeID: profile.typeID,
        shipTypeID: profile.typeID,
        label: profile.name,
        name: profile.name,
        role: compositionEntry.role,
        factionKey,
        factionTag: faction.tag,
        sourceSpawnerTypeID: spawnerType.typeID,
        sourceDungeonObjectID: controller.objectID || null,
      });
    }
  }
  return entries.map((entry, index) => ({
    ...entry,
    positionOffset: addPositions(
      anchorOffset,
      formationOffset(
        index,
        entries.length,
        config.defaults.formationSpacingMeters,
      ),
    ),
  }));
}

function buildConfiguredEntityProps(
  template,
  siteConfiguration,
  flattenedObjects,
  entryPosition,
) {
  const environmentProps: any[] = [];
  const spacing = config.defaults.formationSpacingMeters;
  const pushDescriptor = (descriptor, baseOffset, sourceKey, descriptorIndex) => {
    for (let copyIndex = 0; copyIndex < descriptor.count; copyIndex += 1) {
      const positionOffset = addPositions(
        addPositions(baseOffset, descriptor.positionOffset),
        formationOffset(copyIndex, descriptor.count, spacing),
      );
      environmentProps.push({
        key: `frontier-config-entity:${siteConfiguration.dungeonID}:` +
          `${sourceKey}:${descriptorIndex + 1}:${copyIndex + 1}`,
        exact: true,
        typeID: descriptor.typeID,
        label: descriptor.name || null,
        positionOffset,
        source: "frontier_dungeon_spawn_config",
        frontierDungeonConfiguredEntity: true,
      });
    }
  };

  const siteEntities = Array.isArray(siteConfiguration.entities)
    ? siteConfiguration.entities
    : [];
  siteEntities.forEach((descriptor, descriptorIndex) => {
    pushDescriptor(descriptor, { x: 0, y: 0, z: 0 }, "site", descriptorIndex);
  });

  for (const controller of flattenedObjects) {
    const spawnerType = config.spawnerTypes[String(controller.typeID)] || null;
    const composition = spawnerType && Array.isArray(spawnerType.entityComposition)
      ? spawnerType.entityComposition
      : [];
    if (composition.length <= 0) {
      continue;
    }
    const controllerOffset = subtractPositions(
      controller.absolutePosition,
      entryPosition,
    );
    composition.forEach((descriptor, descriptorIndex) => {
      pushDescriptor(
        descriptor,
        controllerOffset,
        `controller-${controller.objectID || controller.authoredIndex}`,
        descriptorIndex,
      );
    });
  }

  return environmentProps;
}

function buildConfiguredSiteEncounter(siteConfiguration) {
  const plan = frontierLandscapeSpawns.buildDungeonSpawnPlan(
    siteConfiguration.dungeonID,
  );
  if (!plan || plan.activated !== true || !Array.isArray(plan.npcs) || plan.npcs.length <= 0) {
    return null;
  }
  const spawnEntries = plan.npcs.map((npc, index) => ({
    key: `frontier-site-npc:${siteConfiguration.dungeonID}:${index + 1}`,
    profileID: npc.profileID,
    spawnQuery: npc.profileID,
    typeID: npc.typeID,
    shipTypeID: npc.typeID,
    label: npc.name,
    name: npc.name,
    role: npc.boss === true ? "boss" : "site_entity",
    factionKey: npc.familyKey,
    factionTag: npc.familyTag,
    sourceSpawnerTypeID: null,
    sourceDungeonObjectID: null,
    positionOffset: cloneValue(npc.positionOffset),
    frontierEncounterBoss: npc.boss === true,
    frontierEncounterFamilyKey: npc.familyKey,
    frontierEncounterFamilyTag: npc.familyTag,
  }));
  return {
    key: `frontier-site-encounter:${siteConfiguration.dungeonID}:${plan.spawnTableID}`,
    label: `${siteConfiguration.name}: ${plan.encounterName || plan.spawnTableID}`,
    supported: true,
    spawnQuery: spawnEntries[0].profileID,
    amount: spawnEntries.length,
    spawnEntries,
    exact: true,
    deadspace: true,
    trigger: "on_load",
    prerequisiteKey: null,
    waveIndex: 1,
    notes: [
      `Configured ${plan.spawnTableID} site encounter for dungeonID=${siteConfiguration.dungeonID}.`,
      ...(plan.npcs.some((npc) => npc.boss === true)
        ? ["This deterministic site roll includes the optional Constructing Battleship boss."]
        : []),
    ],
    sourceGroupID: `configured:${plan.spawnTableID}`,
    sourceGroupTitle: plan.encounterName || plan.spawnTableID,
    frontierDungeonObjectID: null,
    frontierDungeonRoomID: null,
    frontierFactionKey: null,
    frontierFactionTag: null,
    frontierEncounterSpawnTableID: plan.spawnTableID,
    frontierEncounterParentSpawnTableID: plan.parentSpawnTableID || null,
    frontierEncounterTags: cloneValue(plan.encounterTags || []),
  };
}

function buildConfiguredPopulationHints(template, resolvedSiteConfiguration = null) {
  const siteConfiguration = resolvedSiteConfiguration && isRecord(resolvedSiteConfiguration)
    ? resolvedSiteConfiguration
    : resolveSiteConfiguration(template);
  if (!siteConfiguration) {
    return null;
  }

  const flattenedObjects = flattenAuthoredObjects(template);
  const entryObjectID = toPositiveInt(
    template && (
      template.entryObjectID ||
      template.dungeonEntryObjectID ||
      template.entryDungeonObjectID
    ),
    0,
  );
  const entryObject = flattenedObjects.find(
    (entry) => entryObjectID > 0 && entry.objectID === entryObjectID,
  ) || null;
  const entryPosition = entryObject
    ? entryObject.absolutePosition
    : { x: 0, y: 0, z: 0 };
  const triggerAuthority = buildTriggerAuthority(template);

  const controllers = flattenedObjects
    .filter((entry) => {
      const spawnerType = config.spawnerTypes[String(entry.typeID)] || null;
      return Boolean(spawnerType && spawnerType.isNpcWave === true);
    })
    .map((entry) => {
      const spawnerType = config.spawnerTypes[String(entry.typeID)];
      const factionKey = spawnerType.defaultFaction || siteConfiguration.factionKey;
      const faction = factionKey ? config.factions[factionKey] || null : null;
      const key = `frontier-controller:${siteConfiguration.dungeonID}:` +
        `${entry.objectID || entry.authoredIndex}`;
      return {
        ...entry,
        key,
        spawnerType,
        factionKey,
        faction,
      };
    })
    .filter((entry) => entry.faction);

  const controllerByObjectID = new Map();
  for (const controller of controllers) {
    if (controller.objectID > 0) {
      controllerByObjectID.set(controller.objectID, controller);
    }
  }
  const prerequisiteByControllerKey = new Map();
  for (const controller of controllers) {
    const rawTriggerSpawn = controller.object && controller.object.guardCommand
      ? Number(controller.object.guardCommand.objectTriggerSpawn)
      : null;
    if (rawTriggerSpawn === 0) {
      continue;
    }
    const incomingSources = controller.objectID > 0
      ? triggerAuthority.incomingSourceObjectIDsByTarget.get(controller.objectID) || []
      : [];
    const prerequisite = incomingSources
      .map((sourceObjectID) => controllerByObjectID.get(sourceObjectID) || null)
      .find((entry) => entry && entry.key !== controller.key) || null;
    if (prerequisite) {
      prerequisiteByControllerKey.set(controller.key, prerequisite);
    }
  }

  const waveIndexCache = new Map();
  const resolveWaveIndex = (controller, visiting = new Set()) => {
    if (waveIndexCache.has(controller.key)) {
      return waveIndexCache.get(controller.key);
    }
    if (visiting.has(controller.key)) {
      return 1;
    }
    const nextVisiting = new Set(visiting);
    nextVisiting.add(controller.key);
    const prerequisite = prerequisiteByControllerKey.get(controller.key) || null;
    const waveIndex = prerequisite
      ? resolveWaveIndex(prerequisite, nextVisiting) + 1
      : 1;
    waveIndexCache.set(controller.key, waveIndex);
    return waveIndex;
  };

  const encounters = controllers.map((controller) => {
    const prerequisite = prerequisiteByControllerKey.get(controller.key) || null;
    const controllerOffset = subtractPositions(
      controller.absolutePosition,
      entryPosition,
    );
    const spawnEntries = buildNpcSpawnEntries(
      controller,
      controller.spawnerType,
      controller.factionKey,
      controller.faction,
      controllerOffset,
    );
    const rawTriggerValues = controller.objectID > 0
      ? triggerAuthority.rawTinyIntValuesByObjectID.get(controller.objectID) || []
      : [];
    const notes = [
      `Authored Frontier controller typeID=${controller.typeID} ` +
        `objectID=${controller.objectID || "unknown"}.`,
    ];
    if (rawTriggerValues.length > 0) {
      notes.push(
        `Raw trigger tinyint_1=${rawTriggerValues.join("/")} is retained as metadata only; ` +
        "it is not interpreted as an NPC count.",
      );
    }
    if (prerequisite) {
      notes.push(
        `Authored eventTypeID ${SPAWN_GUARD_EVENT_TYPE_ID} maps prerequisite ` +
        `objectID=${prerequisite.objectID} to this wave.`,
      );
    }
    const rawTriggerSpawn = controller.object && controller.object.guardCommand
      ? Number(controller.object.guardCommand.objectTriggerSpawn)
      : null;
    if (rawTriggerSpawn === 1 && !prerequisite) {
      notes.push(
        "objectTriggerSpawn=1 had no resolvable NPC-wave eventTypeID 3 prerequisite; " +
        "the encounter is loaded initially to avoid an unreachable wave.",
      );
    }
    return {
      key: controller.key,
      label: `${siteConfiguration.name}: ${controller.spawnerType.name}`,
      supported: true,
      spawnQuery: spawnEntries[0] && spawnEntries[0].profileID || "",
      amount: spawnEntries.length,
      spawnEntries,
      exact: true,
      deadspace: true,
      trigger: prerequisite ? "wave_cleared" : "on_load",
      prerequisiteKey: prerequisite ? prerequisite.key : null,
      waveIndex: resolveWaveIndex(controller),
      notes,
      sourceGroupID: String(controller.typeID),
      sourceGroupTitle: controller.spawnerType.name,
      frontierDungeonObjectID: controller.objectID || null,
      frontierDungeonRoomID: controller.roomID || null,
      frontierFactionKey: controller.factionKey,
      frontierFactionTag: controller.faction.tag,
    };
  }).filter((encounter) => encounter.spawnEntries.length > 0);
  const configuredSiteEncounter = buildConfiguredSiteEncounter(siteConfiguration);
  if (configuredSiteEncounter) {
    encounters.push(configuredSiteEncounter);
  }

  const environmentProps = buildConfiguredEntityProps(
    template,
    siteConfiguration,
    flattenedObjects,
    entryPosition,
  );
  return {
    source: "frontier_dungeon_spawn_config",
    frontierDungeonSpawnConfigured: true,
    frontierDungeonSpawnConfigVersion: config.schemaVersion,
    frontierDungeonSpawnFrequency: siteConfiguration.spawnFrequency,
    frontierDungeonPlacementDistanceAu: cloneValue(
      siteConfiguration.placementDistanceAu,
    ),
    frontierDungeonSeparationLightSeconds: cloneValue(
      siteConfiguration.separationLightSeconds,
    ),
    frontierDungeonWarpIn: cloneValue(siteConfiguration.warpIn),
    frontierFactionKey: siteConfiguration.factionKey,
    frontierFactionTag: siteConfiguration.factionTag,
    frontierDungeonTags: cloneValue(siteConfiguration.tags),
    encounters,
    ...(environmentProps.length > 0
      ? {
        environmentProps,
        exactContentCaps: {
          environmentProps: environmentProps.length,
        },
      }
      : {}),
  };
}

function mergeByStableKey(existingValues, configuredValues) {
  const configuredKeys = new Set(
    configuredValues
      .map((entry) => String(entry && entry.key || "").trim())
      .filter(Boolean),
  );
  return [
    ...existingValues.filter((entry) => {
      const key = String(entry && entry.key || "").trim();
      return !key || !configuredKeys.has(key);
    }),
    ...configuredValues,
  ];
}

function decorateTemplate(template) {
  if (!isRecord(template)) {
    return template;
  }
  const siteConfiguration = resolveSiteConfiguration(template);
  if (!siteConfiguration) {
    return template;
  }
  const configuredHints = buildConfiguredPopulationHints(
    template,
    siteConfiguration,
  );
  const existingHints = isRecord(template.populationHints)
    ? cloneValue(template.populationHints)
    : {};
  const configuredEncounters = Array.isArray(configuredHints.encounters)
    ? configuredHints.encounters
    : [];
  const existingEncounters = Array.isArray(existingHints.encounters)
    ? existingHints.encounters
    : [];
  const configuredEnvironmentProps = Array.isArray(configuredHints.environmentProps)
    ? configuredHints.environmentProps
    : [];
  const existingEnvironmentProps = Array.isArray(existingHints.environmentProps)
    ? existingHints.environmentProps
    : [];
  const encounters = mergeByStableKey(
    existingEncounters,
    configuredEncounters,
  );
  const environmentProps = configuredEnvironmentProps.length > 0
    ? mergeByStableKey(existingEnvironmentProps, configuredEnvironmentProps)
    : existingEnvironmentProps;
  const existingCaps: Record<string, any> = isRecord(existingHints.exactContentCaps)
    ? existingHints.exactContentCaps
    : {};
  const configuredCaps: Record<string, any> = isRecord(configuredHints.exactContentCaps)
    ? configuredHints.exactContentCaps
    : {};
  const populationHints: Record<string, any> = {
    ...existingHints,
    ...configuredHints,
    encounters,
  };
  if (environmentProps.length > 0) {
    populationHints.environmentProps = environmentProps;
    populationHints.exactContentCaps = {
      ...existingCaps,
      ...configuredCaps,
      environmentProps: Math.max(
        environmentProps.length,
        toPositiveInt(existingCaps.environmentProps, 0),
        toPositiveInt(configuredCaps.environmentProps, 0),
      ),
    };
  }

  return {
    ...template,
    frontierDungeonSpawnConfigured: true,
    frontierDungeonSpawnConfigVersion: config.schemaVersion,
    frontierDungeonSpawnFrequency: siteConfiguration.spawnFrequency,
    frontierDungeonPlacementDistanceAu: cloneValue(
      siteConfiguration.placementDistanceAu,
    ),
    frontierDungeonSeparationLightSeconds: cloneValue(
      siteConfiguration.separationLightSeconds,
    ),
    frontierDungeonWarpIn: cloneValue(siteConfiguration.warpIn),
    frontierFactionKey: siteConfiguration.factionKey,
    frontierFactionTag: siteConfiguration.factionTag,
    frontierDungeonTags: cloneValue(siteConfiguration.tags),
    populationHints,
  };
}

function buildGeneratedNpcRows() {
  const profiles: any[] = [];
  for (const [factionKey, faction] of Object.entries<any>(config.factions)) {
    for (const [role, roleProfiles] of Object.entries<any>(faction.npcRoles)) {
      for (const profile of roleProfiles) {
        const behavior = config.npcBehaviorPresets[profile.behaviorPreset];
        profiles.push({
          profileID: profile.profileID,
          name: profile.name,
          description:
            `${faction.displayName} ${role} profile generated by the Frontier ` +
            "dungeon spawn configuration.",
          aliases: uniqueText([
            profile.name,
            `${faction.displayName} ${role}`,
            `${factionKey} ${role}`,
            faction.tag,
          ]),
          entityType: "npc",
          // These Frontier hulls carry their combat hardware on the SDE entity
          // type rather than in EveJS-authored module loadouts.
          hardwareFamily: "sdeEntityNpc",
          shipTypeID: profile.typeID,
          presentationTypeID: profile.typeID,
          corporationID: config.defaults.npcCorporationID,
          allianceID: 0,
          factionID: config.defaults.npcFactionID,
          behaviorProfileID: behavior.behaviorProfileID,
          loadoutID: config.defaults.npcLoadoutID,
          lootTableID: DEFAULT_LOOT_TABLE_ID,
          shipNameTemplate: profile.name,
          securityStatus: -10,
          bounty: profile.bounty,
          spawnDistanceMeters: Math.max(1_000, behavior.orbitDistanceMeters),
          preferredTargetMode: "invoker",
          frontierFactionKey: factionKey,
          frontierFactionTag: faction.tag,
          frontierNpcRole: role,
        });
      }
    }
  }

  const behaviorProfiles = Object.values<any>(config.npcBehaviorPresets)
    .map((preset) => ({
      ...cloneValue(preset),
      description:
        `${preset.name} generated by the Frontier dungeon spawn configuration.`,
      autoAggroTargetClasses: ["player", "drone"],
      targetPreference: "preferredTargetThenNearestPlayer",
      autoAggro: true,
      returnToHomeWhenIdle: true,
      homeArrivalMeters: Math.max(
        1_000,
        Math.round(preset.orbitDistanceMeters * 0.25),
      ),
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

function getGeneratedNpcRows(tableName) {
  if (!config.enabled) {
    return [];
  }
  const normalizedTableName = String(tableName || "").trim();
  if (normalizedTableName === "profiles") {
    return cloneValue(generatedNpcRows[NPC_PROFILE_TABLE]);
  }
  if (normalizedTableName === "behaviorProfiles") {
    return cloneValue(generatedNpcRows[NPC_BEHAVIOR_PROFILE_TABLE]);
  }
  return cloneValue(generatedNpcRows[normalizedTableName] || []);
}

module.exports = {
  CONFIG_PATH,
  getConfig,
  getConfigSummary,
  resolveSiteConfiguration,
  resolveHiveSpawnConfiguration,
  decorateTemplate,
  buildConfiguredPopulationHints,
  getGeneratedNpcRows,
};
