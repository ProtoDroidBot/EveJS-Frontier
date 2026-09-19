const path = require("path");

const {
  TABLE,
  readStaticTable,
  readStaticRows,
} = require(path.join(__dirname, "../_shared/referenceData"));
const dungeonSpawnEligibility = require(path.join(__dirname, "./dungeonSpawnEligibility"));
const frontierDungeonSpawns = require(path.join(
  __dirname,
  "../../config/frontierDungeonSpawns",
));
const {
  isDisabledMissionIdentifier,
  isDisabledMissionSourceURL,
  isDisabledMissionTemplateIdentifier,
  productionMissionPolicy,
} = require(path.join(__dirname, "../../config/productionMissionPolicy"));

let cache = null;
const BANNED_DUNGEON_TEMPLATE_IDS = new Set<any>(
  productionMissionPolicy.disabledMissions
    .flatMap(({ templateIDs }: Record<string, any>) => templateIDs)
    .map((templateID) => templateID.toLowerCase()),
);
const BANNED_SOURCE_MISSION_IDS = new Set<any>(
  productionMissionPolicy.disabledMissions.flatMap(({ missionID, templateIDs }: Record<string, any>) => [
    String(missionID),
    ...templateIDs.map((templateID) => templateID.split(":").pop().toLowerCase()),
  ]),
);

function toInt(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.trunc(numeric) : fallback;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function normalizeObject(value) {
  return value && typeof value === "object" ? value : {};
}

function isBannedDungeonTemplateID(templateID) {
  const normalizedTemplateID = String(templateID || "").trim().toLowerCase();
  return isDisabledMissionTemplateIdentifier(normalizedTemplateID) ||
    isDisabledMissionSourceURL(normalizedTemplateID) ||
    isDisabledMissionIdentifier(normalizedTemplateID);
}

function isBannedDungeonTemplateRecord(record = null, fallbackTemplateID = "") {
  const sourceMissionID = String(record && record.sourceMissionID || "")
    .trim()
    .toLowerCase();
  return isBannedDungeonTemplateID(fallbackTemplateID) ||
    isBannedDungeonTemplateID(record && record.templateID) ||
    isBannedDungeonTemplateID(record && record.sourceMissionID) ||
    isDisabledMissionIdentifier(record && record.missionID) ||
    BANNED_SOURCE_MISSION_IDS.has(sourceMissionID) ||
    [
      record && record.sourceUrl,
      record && record.sourceURL,
      record && record.adminMetadata && record.adminMetadata.sourceUrl,
      record && record.adminMetadata && record.adminMetadata.sourceURL,
    ].some(isDisabledMissionSourceURL);
}

function normalizePayload(payload: Record<string, any> = {}) {
  return {
    version: toInt(payload.version, 0),
    generatedAt: String(payload.generatedAt || "").trim(),
    source: normalizeObject(payload.source),
    counts: normalizeObject(payload.counts),
    meta: normalizeObject(payload.meta),
    sourcePriorities: normalizeObject(payload.sourcePriorities),
    sourceConfidence: normalizeObject(payload.sourceConfidence),
    spawnProfiles: normalizeObject(payload.spawnProfiles),
    coverage: normalizeObject(payload.coverage),
    clientData: normalizeObject(payload.clientData),
    templatesByID: normalizeObject(payload.templatesByID),
    indexes: normalizeObject(payload.indexes),
  };
}

function sanitizePayload(payload: Record<string, any> = {}): Record<string, any> & {
  counts: Record<string, any>;
  templatesByID: Record<string, any>;
  indexes: Record<string, any>;
} {
  const templatesByID = Object.fromEntries(
    Object.entries<any>(payload.templatesByID || {}).filter(([templateID, template]) =>
      !isBannedDungeonTemplateRecord(template, templateID)),
  );
  const availableTemplateIDs = new Set(Object.keys(templatesByID));
  const indexes: Record<string, any> = {};
  for (const [indexName, rawIndex] of Object.entries<any>(payload.indexes || {})) {
    const sanitizedIndex: Record<string, any> = {};
    for (const [key, rawTemplateIDs] of Object.entries<any>(normalizeObject(rawIndex))) {
      if (Array.isArray(rawTemplateIDs)) {
        const templateIDs = rawTemplateIDs.filter((templateID) =>
          !isBannedDungeonTemplateID(templateID) &&
          availableTemplateIDs.has(String(templateID)));
        if (templateIDs.length > 0) {
          sanitizedIndex[key] = templateIDs;
        }
        continue;
      }
      if (
        !isBannedDungeonTemplateID(rawTemplateIDs) &&
        availableTemplateIDs.has(String(rawTemplateIDs))
      ) {
        sanitizedIndex[key] = rawTemplateIDs;
      }
    }
    if (Object.keys(sanitizedIndex).length > 0) {
      indexes[indexName] = sanitizedIndex;
    }
  }
  return {
    ...payload,
    counts: {
      ...payload.counts,
      templateCount: Object.keys(templatesByID).length,
    },
    templatesByID,
    indexes,
  };
}

function addTemplateIndex(index, key, templateID) {
  const normalizedKey = String(key == null ? "" : key).trim();
  if (!normalizedKey) {
    return;
  }
  if (!Array.isArray(index[normalizedKey])) {
    index[normalizedKey] = [];
  }
  if (!index[normalizedKey].includes(templateID)) {
    index[normalizedKey].push(templateID);
    index[normalizedKey].sort((left, right) => String(left).localeCompare(String(right)));
  }
}

function hydrateExistingFrontierDungeonTemplates(
  templatesByID,
  frontierDungeonTemplates,
  itemTypes,
) {
  const dungeonRows = Array.isArray(frontierDungeonTemplates)
    ? frontierDungeonTemplates
    : Object.values<any>(normalizeObject(frontierDungeonTemplates));
  const typeRows = Array.isArray(itemTypes)
    ? itemTypes
    : Object.values<any>(normalizeObject(itemTypes));
  const dungeonByID = new Map<number, any>();
  for (const dungeon of dungeonRows) {
    const dungeonID = Math.max(0, toInt(dungeon && (dungeon.dungeonID ?? dungeon._key), 0));
    if (dungeonID > 0) {
      dungeonByID.set(dungeonID, dungeon);
    }
  }
  const groupIDByTypeID = new Map<number, number>();
  for (const type of typeRows) {
    const typeID = Math.max(0, toInt(type && (type.typeID ?? type._key), 0));
    if (typeID > 0) {
      groupIDByTypeID.set(typeID, Math.max(0, toInt(type && type.groupID, 0)));
    }
  }
  const supportedGroupIDs = new Set(
    dungeonSpawnEligibility.FRONTIER_DUNGEON_SPAWN_GROUP_IDS,
  );
  let hydratedTemplateCount = 0;

  for (const [templateID, template] of Object.entries<any>(templatesByID)) {
    const sourceDungeonID = Math.max(0, toInt(template && template.sourceDungeonID, 0));
    const dungeon = dungeonByID.get(sourceDungeonID) || null;
    const entryObjectTypeID = Math.max(
      0,
      toInt(
        template && template.entryObjectTypeID,
        toInt(dungeon && dungeon.entryTypeID, 0),
      ),
    );
    const entryObjectGroupID = Math.max(
      0,
      toInt(
        template && template.entryObjectGroupID,
        groupIDByTypeID.get(entryObjectTypeID) || 0,
      ),
    );
    const presentation =
      dungeonSpawnEligibility.FRONTIER_DUNGEON_SPAWN_PRESENTATION_BY_GROUP_ID[
        entryObjectGroupID
      ] || null;
    if (
      !dungeon ||
      !supportedGroupIDs.has(entryObjectGroupID) ||
      !presentation ||
      !dungeonSpawnEligibility.hasMatchingAuthoredEntryObject(dungeon)
    ) {
      continue;
    }

    templatesByID[templateID] = {
      ...template,
      dungeonID: Math.max(0, toInt(template && template.dungeonID, sourceDungeonID)) || sourceDungeonID,
      dungeonName: template && template.dungeonName || dungeon.dungeonName || null,
      entryObjectGroupID,
      entryObjectID: Math.max(
        0,
        toInt(template && template.entryObjectID, toInt(dungeon.entryObjectID, 0)),
      ) || null,
      entryObjectTypeID,
      entryTypeID: Math.max(
        0,
        toInt(template && template.entryTypeID, toInt(dungeon.entryTypeID, entryObjectTypeID)),
      ) || entryObjectTypeID,
      frontierDungeonHydrated: true,
      // Existing client-derived templates must use the same allocation path as
      // synthesized Frontier templates. Otherwise an old 4871 row remains in
      // the sparse ore index while 4872-4874 use the visible 4873 baseline.
      siteFamily: presentation.siteFamily,
      siteKind: presentation.siteKind,
      difficulty: Math.max(
        1,
        toInt(template && template.difficulty, toInt(dungeon && dungeon.difficulty, 1)),
      ),
      rooms: Array.isArray(template && template.rooms) && template.rooms.length > 0
        ? template.rooms
        : clone(Array.isArray(dungeon.rooms) ? dungeon.rooms : []),
      siteOrigin: template && template.siteOrigin || "frontier_dungeon",
      triggers: Array.isArray(template && template.triggers) && template.triggers.length > 0
        ? template.triggers
        : clone(Array.isArray(dungeon.triggers) ? dungeon.triggers : []),
    };
    hydratedTemplateCount += 1;
  }

  return hydratedTemplateCount;
}

function mergeFrontierDungeonSpawnTemplates(
  payload,
  frontierDungeonTemplates = readStaticRows(TABLE.FRONTIER_DUNGEON_TEMPLATES),
  itemTypes = readStaticRows(TABLE.ITEM_TYPES),
) {
  const frontierSiteGroupDungeonIDs = new Set(
    dungeonSpawnEligibility.collectFrontierDungeonSiteGroupIDs(
      { frontierDungeonTemplates },
      itemTypes,
    ),
  );
  const frontierSpawnAuthorityIDs = new Set(
    dungeonSpawnEligibility.collectFrontierDungeonSpawnAuthorityIDs(
      { frontierDungeonTemplates },
      itemTypes,
    ),
  );
  const invalidStandaloneFrontierDungeonIDs = new Set(
    [...frontierSiteGroupDungeonIDs].filter((dungeonID) => (
      !frontierSpawnAuthorityIDs.has(dungeonID)
    )),
  );
  const templatesByID = {
    ...normalizeObject(payload && payload.templatesByID),
  };
  const hydratedTemplateCount = hydrateExistingFrontierDungeonTemplates(
    templatesByID,
    frontierDungeonTemplates,
    itemTypes,
  );
  const generatedTemplates = dungeonSpawnEligibility.buildFrontierDungeonSpawnTemplates(
    { frontierDungeonTemplates },
    itemTypes,
    templatesByID,
  );
  const indexes = clone(normalizeObject(payload && payload.indexes));
  // Family indexes are derived state. Rebuild them after hydration because a
  // supported Frontier template may have moved from a legacy family (notably
  // 4871/ore) onto the shared visible-site allocation path.
  indexes.templateIDsByFamily = {};
  indexes.templateIDsBySource = normalizeObject(indexes.templateIDsBySource);
  indexes.templateIDsByArchetypeID = normalizeObject(indexes.templateIDsByArchetypeID);
  indexes.templateIDsBySourceDungeonID = normalizeObject(indexes.templateIDsBySourceDungeonID);

  for (const template of generatedTemplates) {
    const templateID = String(template.templateID);
    templatesByID[templateID] = template;
    addTemplateIndex(indexes.templateIDsBySource, template.source, templateID);
    if (toInt(template.archetypeID, 0) > 0) {
      addTemplateIndex(
        indexes.templateIDsByArchetypeID,
        toInt(template.archetypeID, 0),
        templateID,
      );
    }
    indexes.templateIDsBySourceDungeonID[String(template.sourceDungeonID)] = templateID;
  }

  let frontierDungeonConfiguredTemplateCount = 0;
  for (const [templateID, template] of Object.entries<any>(templatesByID)) {
    const sourceDungeonID = Math.max(0, toInt(template && template.sourceDungeonID, 0));
    const configuredTemplate = invalidStandaloneFrontierDungeonIDs.has(sourceDungeonID)
      ? template
      : frontierDungeonSpawns.decorateTemplate(template);
    templatesByID[templateID] = configuredTemplate;
    if (configuredTemplate && configuredTemplate.frontierDungeonSpawnConfigured === true) {
      frontierDungeonConfiguredTemplateCount += 1;
    }
  }

  for (const template of Object.values<any>(templatesByID)) {
    const templateID = String(template && template.templateID || "").trim();
    const sourceDungeonID = Math.max(0, toInt(template && template.sourceDungeonID, 0));
    const isFrontierWorldSpawnCandidate = frontierSpawnAuthorityIDs.has(sourceDungeonID);
    const isConfiguredFrontierWorldSpawn =
      template && template.frontierDungeonSpawnConfigured === true;
    if (
      templateID &&
      !invalidStandaloneFrontierDungeonIDs.has(sourceDungeonID) &&
      (!isFrontierWorldSpawnCandidate || isConfiguredFrontierWorldSpawn)
    ) {
      addTemplateIndex(indexes.templateIDsByFamily, template.siteFamily, templateID);
    }
  }

  const totalTemplatesByFamily: Record<string, number> = {};
  for (const template of Object.values<any>(templatesByID)) {
    const siteFamily = String(template && template.siteFamily || "unknown").trim().toLowerCase() || "unknown";
    totalTemplatesByFamily[siteFamily] = (totalTemplatesByFamily[siteFamily] || 0) + 1;
  }

  return {
    ...payload,
    counts: {
      ...normalizeObject(payload && payload.counts),
      templateCount: Object.keys(templatesByID).length,
      frontierDungeonHydratedTemplateCount: hydratedTemplateCount,
      frontierDungeonSynthesizedTemplateCount: generatedTemplates.length,
      frontierDungeonConfiguredTemplateCount,
    },
    coverage: {
      ...normalizeObject(payload && payload.coverage),
      totalTemplatesByFamily,
    },
    templatesByID,
    indexes,
  };
}

function buildCache() {
  const payload = mergeFrontierDungeonSpawnTemplates(
    sanitizePayload(
      normalizePayload(readStaticTable(TABLE.DUNGEON_AUTHORITY)),
    ),
  );
  const templatesByID = new Map();
  const templatesBySourceDungeonID = new Map();
  const templatesBySource = new Map();
  const templatesByFamily = new Map();
  const templatesByDungeonNameID = new Map();
  const templatesByArchetypeID = new Map();
  const templatesByResourceTypeID = new Map();
  const archetypesByID = new Map();
  const clientDungeonsByID = new Map();
  const objectiveChainsByID = new Map();
  const objectiveTypesByID = new Map();
  const spawnProfilesByFamily = new Map();

  for (const [templateID, template] of Object.entries<any>(payload.templatesByID || {})) {
    if (isBannedDungeonTemplateRecord(template, templateID)) {
      continue;
    }
    const normalizedTemplate = {
      ...template,
      templateID,
      source: String(template && template.source || "").trim().toLowerCase() || "unknown",
      siteFamily: String(template && template.siteFamily || "").trim().toLowerCase() || "unknown",
      sourceDungeonID:
        template && template.sourceDungeonID != null
          ? toInt(template.sourceDungeonID, 0)
          : null,
      archetypeID:
        template && template.archetypeID != null
          ? toInt(template.archetypeID, 0)
          : null,
    };
    templatesByID.set(templateID, normalizedTemplate);

    if (normalizedTemplate.sourceDungeonID && normalizedTemplate.sourceDungeonID > 0) {
      templatesBySourceDungeonID.set(normalizedTemplate.sourceDungeonID, normalizedTemplate);
    }

    if (!templatesBySource.has(normalizedTemplate.source)) {
      templatesBySource.set(normalizedTemplate.source, []);
    }
    templatesBySource.get(normalizedTemplate.source).push(normalizedTemplate);

    if (!templatesByFamily.has(normalizedTemplate.siteFamily)) {
      templatesByFamily.set(normalizedTemplate.siteFamily, []);
    }
    templatesByFamily.get(normalizedTemplate.siteFamily).push(normalizedTemplate);

    if (toInt(normalizedTemplate.dungeonNameID, 0) > 0) {
      const dungeonNameID = toInt(normalizedTemplate.dungeonNameID, 0);
      if (!templatesByDungeonNameID.has(dungeonNameID)) {
        templatesByDungeonNameID.set(dungeonNameID, []);
      }
      templatesByDungeonNameID.get(dungeonNameID).push(normalizedTemplate);
    }

    if (normalizedTemplate.archetypeID && normalizedTemplate.archetypeID > 0) {
      if (!templatesByArchetypeID.has(normalizedTemplate.archetypeID)) {
        templatesByArchetypeID.set(normalizedTemplate.archetypeID, []);
      }
      templatesByArchetypeID.get(normalizedTemplate.archetypeID).push(normalizedTemplate);
    }

    const resourceComposition =
      normalizedTemplate &&
      normalizedTemplate.resourceComposition &&
      typeof normalizedTemplate.resourceComposition === "object"
        ? normalizedTemplate.resourceComposition
        : {};
    const resourceTypeIDs = [
      ...(Array.isArray(resourceComposition.oreTypeIDs) ? resourceComposition.oreTypeIDs : []),
      ...(Array.isArray(resourceComposition.gasTypeIDs) ? resourceComposition.gasTypeIDs : []),
      ...(Array.isArray(resourceComposition.iceTypeIDs) ? resourceComposition.iceTypeIDs : []),
    ]
      .map((entry) => toInt(entry, 0))
      .filter((entry) => entry > 0);
    for (const resourceTypeID of [...new Set(resourceTypeIDs)]) {
      if (!templatesByResourceTypeID.has(resourceTypeID)) {
        templatesByResourceTypeID.set(resourceTypeID, []);
      }
      templatesByResourceTypeID.get(resourceTypeID).push(normalizedTemplate);
    }
  }

  const rawArchetypesByID =
    payload.clientData &&
    payload.clientData.tables &&
    payload.clientData.tables.archetypesByID
      ? payload.clientData.tables.archetypesByID
      : {};
  for (const [archetypeID, archetype] of Object.entries<any>(rawArchetypesByID)) {
    archetypesByID.set(toInt(archetypeID, 0), archetype);
  }

  const rawDungeonsByID =
    payload.clientData &&
    payload.clientData.tables &&
    payload.clientData.tables.dungeonsByID
      ? payload.clientData.tables.dungeonsByID
      : {};
  for (const [dungeonID, dungeon] of Object.entries<any>(rawDungeonsByID)) {
    clientDungeonsByID.set(toInt(dungeonID, 0), dungeon);
  }

  const rawObjectiveChainsByID =
    payload.clientData &&
    payload.clientData.tables &&
    payload.clientData.tables.objectiveChainsByID
      ? payload.clientData.tables.objectiveChainsByID
      : {};
  for (const [objectiveChainID, objectiveChain] of Object.entries<any>(rawObjectiveChainsByID)) {
    objectiveChainsByID.set(toInt(objectiveChainID, 0), clone(objectiveChain));
  }

  const rawObjectiveTypesByID =
    payload.clientData &&
    payload.clientData.tables &&
    payload.clientData.tables.objectiveTypesByID
      ? payload.clientData.tables.objectiveTypesByID
      : {};
  for (const [objectiveTypeID, objectiveType] of Object.entries<any>(rawObjectiveTypesByID)) {
    objectiveTypesByID.set(toInt(objectiveTypeID, 0), clone(objectiveType));
  }

  const rawSpawnProfiles =
    payload &&
    payload.spawnProfiles &&
    payload.spawnProfiles.families &&
    typeof payload.spawnProfiles.families === "object"
      ? payload.spawnProfiles.families
      : {};
  for (const [family, profile] of Object.entries<any>(rawSpawnProfiles)) {
    const normalizedFamily = String(family || "").trim().toLowerCase();
    if (!normalizedFamily || !profile || typeof profile !== "object") {
      continue;
    }
    spawnProfilesByFamily.set(normalizedFamily, clone(profile));
  }

  return {
    payload,
    templatesByID,
    templatesBySourceDungeonID,
    templatesBySource,
    templatesByFamily,
    templatesByDungeonNameID,
    templatesByArchetypeID,
    templatesByResourceTypeID,
    archetypesByID,
    clientDungeonsByID,
    objectiveChainsByID,
    objectiveTypesByID,
    spawnProfilesByFamily,
  };
}

function ensureCache() {
  if (!cache) {
    cache = buildCache();
  }
  return cache;
}

function clearCache() {
  cache = null;
}

function getPayload() {
  return clone(ensureCache().payload);
}

function getTemplateByID(templateID) {
  if (isBannedDungeonTemplateID(templateID)) {
    return null;
  }
  const template = ensureCache().templatesByID.get(String(templateID || "").trim());
  return template ? clone(template) : null;
}

function getClientDungeonTemplate(sourceDungeonID) {
  const template = ensureCache().templatesBySourceDungeonID.get(toInt(sourceDungeonID, 0));
  return template ? clone(template) : null;
}

function listTemplatesByFamily(siteFamily) {
  const normalizedFamily = String(siteFamily || "").trim().toLowerCase();
  return clone(ensureCache().templatesByFamily.get(normalizedFamily) || []);
}

function listTemplatesBySource(source) {
  const normalizedSource = String(source || "").trim().toLowerCase();
  return clone(ensureCache().templatesBySource.get(normalizedSource) || []);
}

function listTemplatesByDungeonNameID(dungeonNameID) {
  return clone(
    ensureCache().templatesByDungeonNameID.get(toInt(dungeonNameID, 0)) || [],
  );
}

function listTemplatesByArchetypeID(archetypeID) {
  return clone(
    ensureCache().templatesByArchetypeID.get(toInt(archetypeID, 0)) || [],
  );
}

function listTemplatesByResourceTypeID(resourceTypeID) {
  return clone(
    ensureCache().templatesByResourceTypeID.get(toInt(resourceTypeID, 0)) || [],
  );
}

function getArchetypeByID(archetypeID) {
  const archetype = ensureCache().archetypesByID.get(toInt(archetypeID, 0));
  return archetype ? clone(archetype) : null;
}

function getClientDungeonByID(dungeonID) {
  const dungeon = ensureCache().clientDungeonsByID.get(toInt(dungeonID, 0));
  return dungeon ? clone(dungeon) : null;
}

function getObjectiveChainByID(objectiveChainID) {
  const objectiveChain = ensureCache().objectiveChainsByID.get(toInt(objectiveChainID, 0));
  return objectiveChain ? clone(objectiveChain) : null;
}

function getObjectiveTypeByID(objectiveTypeID) {
  const objectiveType = ensureCache().objectiveTypesByID.get(toInt(objectiveTypeID, 0));
  return objectiveType ? clone(objectiveType) : null;
}

function getSpawnProfile(siteFamily) {
  const normalizedFamily = String(siteFamily || "").trim().toLowerCase();
  const profile = ensureCache().spawnProfilesByFamily.get(normalizedFamily) || null;
  return profile ? clone(profile) : null;
}

function listUniverseSpawnFamilies() {
  return [...ensureCache().spawnProfilesByFamily.keys()].sort((left, right) => left.localeCompare(right));
}

function getCoverage() {
  return clone(ensureCache().payload.coverage || {});
}

module.exports = {
  clearCache,
  getCoverage,
  getArchetypeByID,
  getClientDungeonByID,
  getClientDungeonTemplate,
  getObjectiveChainByID,
  getObjectiveTypeByID,
  getPayload,
  getSpawnProfile,
  getTemplateByID,
  isBannedDungeonTemplateID,
  isBannedDungeonTemplateRecord,
  listUniverseSpawnFamilies,
  listTemplatesByArchetypeID,
  listTemplatesByDungeonNameID,
  listTemplatesByFamily,
  listTemplatesByResourceTypeID,
  listTemplatesBySource,
  hydrateExistingFrontierDungeonTemplates,
  mergeFrontierDungeonSpawnTemplates,
  sanitizePayload,
};
