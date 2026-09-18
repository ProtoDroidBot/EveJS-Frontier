const FRONTIER_DUNGEON_SPAWN_AUTHORITY_VERSION = 5;
const FRONTIER_DUNGEON_SPAWN_GROUP_IDS = Object.freeze([
  4871, // Asteroid Site
  4872, // Crude Rift
  4873, // Wreck, Ruin & Debris
  4874, // Landmark
]);
const FRONTIER_DUNGEON_SPAWN_GROUP_ID_SET = new Set(FRONTIER_DUNGEON_SPAWN_GROUP_IDS);
const FRONTIER_DUNGEON_SPAWN_PRESENTATION_BY_GROUP_ID = Object.freeze({
  // Frontier's four authored entry-beacon groups are all public, directly
  // warpable solar-system-view sites. Keep them on the same persistent
  // combat-anomaly allocation path so mining/rift/landmark rows cannot fall
  // into sparse family-specific allocators and disappear from most systems.
  4871: Object.freeze({ siteFamily: "combat", siteKind: "anomaly" }),
  4872: Object.freeze({ siteFamily: "combat", siteKind: "anomaly" }),
  4873: Object.freeze({ siteFamily: "combat", siteKind: "anomaly" }),
  4874: Object.freeze({ siteFamily: "combat", siteKind: "anomaly" }),
});
const LIGHT_SECOND_METERS = 299_792_458;
const MINIMUM_LARGE_ANCHOR_OFFSET_METERS = LIGHT_SECOND_METERS;
const MAXIMUM_LARGE_ANCHOR_OFFSET_METERS = LIGHT_SECOND_METERS * 50;
const MINIMUM_UNIVERSE_DUNGEON_SITES_PER_SYSTEM = 3;
const MAXIMUM_UNIVERSE_DUNGEON_SITES_PER_SYSTEM = 5;

const PRIMARY_DUNGEON_CELESTIAL_GROUP_IDS = Object.freeze([
  7, // planets
  8, // moons
  6, // stars
]);

const GENERAL_ANCHOR_CLASS_WEIGHTS = Object.freeze({
  primaryCelestials: 80,
  secondaryCelestials: 8,
  stations: 6,
  stargates: 6,
  belts: 2,
});

const RESOURCE_ANCHOR_CLASS_WEIGHTS = Object.freeze({
  belts: 60,
  primaryCelestials: 30,
  secondaryCelestials: 4,
  stations: 3,
  stargates: 3,
});

function toInt(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.trunc(numeric) : fallback;
}

function normalizeRows(value) {
  if (Array.isArray(value)) {
    return value;
  }
  return value && typeof value === "object" ? Object.values(value) : [];
}

function normalizeText(value, fallback = "") {
  if (typeof value === "string") {
    return value.trim() || fallback;
  }
  if (value && typeof value === "object") {
    const localized = typeof value.en === "string"
      ? value.en
      : Object.values<any>(value).find((entry) => typeof entry === "string");
    return String(localized || "").trim() || fallback;
  }
  return fallback;
}

function buildItemTypeGroupMap(itemTypes) {
  const groupIDByTypeID = new Map();
  for (const itemType of normalizeRows(itemTypes)) {
    const typeID = Math.max(0, toInt(itemType && (itemType.typeID ?? itemType._key), 0));
    if (typeID > 0) {
      groupIDByTypeID.set(typeID, Math.max(0, toInt(itemType && itemType.groupID, 0)));
    }
  }
  return groupIDByTypeID;
}

function resolveFrontierDungeonEntryGroupID(dungeon, groupIDByTypeID) {
  const entryTypeID = Math.max(0, toInt(dungeon && dungeon.entryTypeID, 0));
  return Math.max(
    0,
    toInt(
      dungeon && dungeon.entryTypeGroupID,
      groupIDByTypeID.get(entryTypeID) || 0,
    ),
  );
}

function addDungeonID(target, value) {
  const dungeonID = Math.max(0, toInt(value, 0));
  if (dungeonID > 0) {
    target.add(dungeonID);
  }
}

function resolveUniverseDungeonSiteCount(systemID) {
  const numericSystemID = Math.max(0, toInt(systemID, 0));
  const countRange =
    MAXIMUM_UNIVERSE_DUNGEON_SITES_PER_SYSTEM -
    MINIMUM_UNIVERSE_DUNGEON_SITES_PER_SYSTEM +
    1;
  let state = numericSystemID >>> 0;
  state = Math.imul(state ^ (state >>> 16), 0x45d9f3b);
  state = Math.imul(state ^ (state >>> 16), 0x45d9f3b);
  state ^= state >>> 16;
  return MINIMUM_UNIVERSE_DUNGEON_SITES_PER_SYSTEM + ((state >>> 0) % countRange);
}

/**
 * Universe dungeon generation is Frontier-site-only. A dungeon is eligible
 * when its entry object's item type belongs to one of the four authored site
 * groups. Landscape and ecosystem references are intentionally not excluded;
 * they use the same site groups and can spawn through the normal allocator.
 */
function collectFrontierDungeonSpawnAuthorityIDs(
  source: Record<string, any> = {},
  itemTypes = source.itemTypes,
) {
  const included = new Set<any>();
  const groupIDByTypeID = buildItemTypeGroupMap(itemTypes);

  for (const dungeon of normalizeRows(source.frontierDungeonTemplates)) {
    const entryGroupID = resolveFrontierDungeonEntryGroupID(dungeon, groupIDByTypeID);
    if (FRONTIER_DUNGEON_SPAWN_GROUP_ID_SET.has(entryGroupID)) {
      addDungeonID(included, dungeon && (dungeon.dungeonID ?? dungeon._key));
    }
  }

  return [...included].sort((left, right) => left - right);
}

/**
 * The client dungeon authority predates many Frontier-authored dungeon rows.
 * Promote every dungeon with one of the four supported entry-beacon groups to
 * a first-class runtime template while retaining the exact authored rooms,
 * triggers and entry object. Existing exact client templates win by source ID.
 */
function buildFrontierDungeonSpawnTemplates(
  source: Record<string, any> = {},
  itemTypes = source.itemTypes,
  existingTemplates: any = [],
) {
  const groupIDByTypeID = buildItemTypeGroupMap(itemTypes);
  const existingSourceDungeonIDs = new Set(
    normalizeRows(existingTemplates)
      .map((template) => Math.max(0, toInt(template && template.sourceDungeonID, 0)))
      .filter((dungeonID) => dungeonID > 0),
  );
  const generated: any[] = [];

  const dungeons = normalizeRows(source.frontierDungeonTemplates)
    .slice()
    .sort((left, right) => (
      toInt(left && (left.dungeonID ?? left._key), Number.MAX_SAFE_INTEGER) -
      toInt(right && (right.dungeonID ?? right._key), Number.MAX_SAFE_INTEGER)
    ));
  for (const dungeon of dungeons) {
    const sourceDungeonID = Math.max(
      0,
      toInt(dungeon && (dungeon.dungeonID ?? dungeon._key), 0),
    );
    const entryObjectTypeID = Math.max(0, toInt(dungeon && dungeon.entryTypeID, 0));
    const entryObjectGroupID = resolveFrontierDungeonEntryGroupID(
      dungeon,
      groupIDByTypeID,
    );
    const presentation = FRONTIER_DUNGEON_SPAWN_PRESENTATION_BY_GROUP_ID[entryObjectGroupID];
    if (
      sourceDungeonID <= 0 ||
      entryObjectTypeID <= 0 ||
      !presentation ||
      existingSourceDungeonIDs.has(sourceDungeonID)
    ) {
      continue;
    }

    const resolvedName = normalizeText(
      dungeon && dungeon.dungeonName,
      `Frontier Dungeon ${sourceDungeonID}`,
    );
    const authoredDifficulty = Math.max(0, toInt(dungeon && dungeon.difficulty, 0));
    generated.push({
      ...dungeon,
      templateID: `frontier-dungeon:${sourceDungeonID}`,
      source: "frontier",
      sourcePriority: 100,
      sourceConfidence: {
        label: "Exact Frontier Dungeon Extract",
        score: 100,
      },
      siteFamily: presentation.siteFamily,
      siteKind: presentation.siteKind,
      siteOrigin: "frontier_dungeon",
      sourceDungeonID,
      resolvedName,
      archetypeID: Math.max(0, toInt(dungeon && dungeon.archetypeID, 0)) || null,
      dungeonNameID: Math.max(0, toInt(dungeon && dungeon.dungeonNameID, 0)) || null,
      factionID: Math.max(0, toInt(dungeon && dungeon.factionID, 0)) || null,
      difficulty: authoredDifficulty || 1,
      entryObjectTypeID,
      entryObjectGroupID,
      resourceComposition: dungeon && dungeon.resourceComposition || {
        oreTypeIDs: [],
        gasTypeIDs: [],
        iceTypeIDs: [],
        hasAnyResources: false,
      },
    });
    existingSourceDungeonIDs.add(sourceDungeonID);
  }

  return generated;
}

function isTemplateFromFrontierDungeonDataset(template, frontierDungeonIDs) {
  const sourceDungeonID = Math.max(0, toInt(template && template.sourceDungeonID, 0));
  if (sourceDungeonID <= 0) {
    return false;
  }
  const authority = frontierDungeonIDs instanceof Set
    ? frontierDungeonIDs
    : new Set(collectFrontierDungeonSpawnAuthorityIDs(frontierDungeonIDs || {}));
  return authority.has(sourceDungeonID);
}

function isTemplateEligibleForUniverseSpawning(
  template,
  frontierDungeonIDs,
) {
  return isTemplateFromFrontierDungeonDataset(template, frontierDungeonIDs);
}

function rankPrimaryCelestial(left, right) {
  const leftRank = PRIMARY_DUNGEON_CELESTIAL_GROUP_IDS.indexOf(toInt(left && left.groupID, 0));
  const rightRank = PRIMARY_DUNGEON_CELESTIAL_GROUP_IDS.indexOf(toInt(right && right.groupID, 0));
  return (
    (leftRank < 0 ? Number.MAX_SAFE_INTEGER : leftRank) -
    (rightRank < 0 ? Number.MAX_SAFE_INTEGER : rightRank)
  ) || (
    toInt(left && left.itemID, 0) - toInt(right && right.itemID, 0)
  );
}

function getUniverseDungeonAnchorDistanceRange(candidate) {
  const anchorKind = String(candidate && candidate.anchorKind || "").trim().toLowerCase();
  const groupID = toInt(candidate && candidate.groupID, 0);
  if (
    ["celestial", "station", "stargate"].includes(anchorKind) ||
    [...PRIMARY_DUNGEON_CELESTIAL_GROUP_IDS, 4870].includes(groupID)
  ) {
    return {
      minimumDistanceMeters: MINIMUM_LARGE_ANCHOR_OFFSET_METERS,
      maximumDistanceMeters: MAXIMUM_LARGE_ANCHOR_OFFSET_METERS,
    };
  }
  return null;
}

function weightAnchorClass(entries, totalWeight) {
  const normalized = normalizeRows(entries);
  const weightPerEntry = normalized.length > 0
    ? Math.max(0, Number(totalWeight) || 0) / normalized.length
    : 0;
  return normalized.map((entry) => ({
    ...entry,
    selectionWeight: weightPerEntry,
  }));
}

/**
 * Rank the anchor pool. The naturally numerous planets, moons and stars remain
 * the usual choice, while Lagrange points, stations and gates stay valid.
 */
function orderUniverseDungeonAnchorCandidates(
  candidates: Record<string, any> = {},
  family = "",
) {
  const celestials = normalizeRows(candidates.celestials)
    .map((entry) => ({
      ...entry,
      anchorKind: normalizeText(entry && entry.anchorKind, "celestial"),
    }));
  const primaryGroupIDs = new Set(PRIMARY_DUNGEON_CELESTIAL_GROUP_IDS);
  const primaryCelestials = celestials
    .filter((entry) => primaryGroupIDs.has(toInt(entry && entry.groupID, 0)))
    .sort(rankPrimaryCelestial);
  const secondaryCelestials = celestials
    .filter((entry) => !primaryGroupIDs.has(toInt(entry && entry.groupID, 0)));
  const belts = normalizeRows(candidates.belts);
  const stations = normalizeRows(candidates.stations);
  const stargates = normalizeRows(candidates.stargates);
  const normalizedFamily = String(family || "").trim().toLowerCase();
  const resourceFamily = normalizedFamily === "ore" || normalizedFamily === "gas";
  const classWeights = resourceFamily
    ? RESOURCE_ANCHOR_CLASS_WEIGHTS
    : GENERAL_ANCHOR_CLASS_WEIGHTS;

  const weightedBelts = weightAnchorClass(belts, classWeights.belts);
  const weightedPrimaryCelestials = weightAnchorClass(
    primaryCelestials,
    classWeights.primaryCelestials,
  );
  const weightedSecondaryCelestials = weightAnchorClass(
    secondaryCelestials,
    classWeights.secondaryCelestials,
  );
  const weightedStations = weightAnchorClass(stations, classWeights.stations);
  const weightedStargates = weightAnchorClass(stargates, classWeights.stargates);

  const ordered = resourceFamily
    ? [
      ...weightedBelts,
      ...weightedPrimaryCelestials,
      ...weightedSecondaryCelestials,
      ...weightedStations,
      ...weightedStargates,
    ]
    : [
      ...weightedPrimaryCelestials,
      ...weightedSecondaryCelestials,
      ...weightedStations,
      ...weightedStargates,
      ...weightedBelts,
    ];
  return ordered.map((candidate) => {
    const range = getUniverseDungeonAnchorDistanceRange(candidate);
    return range ? { ...candidate, ...range } : candidate;
  });
}

module.exports = {
  FRONTIER_DUNGEON_SPAWN_AUTHORITY_VERSION,
  FRONTIER_DUNGEON_SPAWN_GROUP_IDS,
  FRONTIER_DUNGEON_SPAWN_PRESENTATION_BY_GROUP_ID,
  LIGHT_SECOND_METERS,
  MINIMUM_LARGE_ANCHOR_OFFSET_METERS,
  MAXIMUM_LARGE_ANCHOR_OFFSET_METERS,
  MINIMUM_UNIVERSE_DUNGEON_SITES_PER_SYSTEM,
  MAXIMUM_UNIVERSE_DUNGEON_SITES_PER_SYSTEM,
  PRIMARY_DUNGEON_CELESTIAL_GROUP_IDS,
  GENERAL_ANCHOR_CLASS_WEIGHTS,
  RESOURCE_ANCHOR_CLASS_WEIGHTS,
  buildFrontierDungeonSpawnTemplates,
  collectFrontierDungeonSpawnAuthorityIDs,
  getUniverseDungeonAnchorDistanceRange,
  isTemplateEligibleForUniverseSpawning,
  isTemplateFromFrontierDungeonDataset,
  orderUniverseDungeonAnchorCandidates,
  resolveUniverseDungeonSiteCount,
};
