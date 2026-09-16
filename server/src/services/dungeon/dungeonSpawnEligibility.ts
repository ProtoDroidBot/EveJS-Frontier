const LANDSCAPE_SPAWN_EXCLUSION_VERSION = 1;
const FRONTIER_DUNGEON_SPAWN_AUTHORITY_VERSION = 1;
const LIGHT_SECOND_METERS = 299_792_458;
const MINIMUM_LARGE_ANCHOR_OFFSET_METERS = LIGHT_SECOND_METERS * 0.01;
const MAXIMUM_LARGE_ANCHOR_OFFSET_METERS = LIGHT_SECOND_METERS;

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

function addDungeonID(target, value) {
  const dungeonID = Math.max(0, toInt(value, 0));
  if (dungeonID > 0) {
    target.add(dungeonID);
  }
}

/**
 * Landscape dungeon templates are placement ingredients, not standalone
 * exploration sites. Keep every ID owned or referenced by the landscape
 * authority out of the universe dungeon allocator.
 */
function collectLandscapeDungeonSpawnExclusionIDs(source: Record<string, any> = {}) {
  const excluded = new Set<any>();

  for (const dungeon of normalizeRows(source.landscapeDungeonTemplates)) {
    addDungeonID(excluded, dungeon && (dungeon.dungeonID ?? dungeon._key));
  }

  for (const ecosystem of normalizeRows(source.landscapeEcosystems)) {
    addDungeonID(excluded, ecosystem && ecosystem.entryDungeonID);
    for (const patternName of ["naturalWorldPatterns", "brokenWorldPatterns"]) {
      for (const pattern of normalizeRows(ecosystem && ecosystem[patternName])) {
        addDungeonID(excluded, pattern && pattern.dungeonID);
      }
    }
  }

  for (const site of normalizeRows(source.landscapeSites)) {
    addDungeonID(excluded, site && site.dungeonID);
  }

  return [...excluded].sort((left, right) => left - right);
}

/**
 * Universe dungeon generation is Frontier-only. Treat the extracted
 * frontierDungeonTemplates table as a positive authority rather than trying
 * to infer compatibility from the legacy dungeonAuthority metadata.
 */
function collectFrontierDungeonSpawnAuthorityIDs(source: Record<string, any> = {}) {
  const included = new Set<any>();

  for (const dungeon of normalizeRows(source.frontierDungeonTemplates)) {
    addDungeonID(included, dungeon && (dungeon.dungeonID ?? dungeon._key));
  }

  return [...included].sort((left, right) => left - right);
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

function isTemplateExcludedFromUniverseSpawning(template, excludedDungeonIDs) {
  const sourceDungeonID = Math.max(0, toInt(template && template.sourceDungeonID, 0));
  if (sourceDungeonID <= 0) {
    return false;
  }
  const exclusions = excludedDungeonIDs instanceof Set
    ? excludedDungeonIDs
    : new Set(collectLandscapeDungeonSpawnExclusionIDs(excludedDungeonIDs || {}));
  return exclusions.has(sourceDungeonID);
}

function isTemplateEligibleForUniverseSpawning(
  template,
  frontierDungeonIDs,
  excludedLandscapeDungeonIDs,
) {
  return isTemplateFromFrontierDungeonDataset(template, frontierDungeonIDs) &&
    !isTemplateExcludedFromUniverseSpawning(template, excludedLandscapeDungeonIDs);
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
    ["station", "stargate"].includes(anchorKind) ||
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
  const celestials = normalizeRows(candidates.celestials);
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
  LANDSCAPE_SPAWN_EXCLUSION_VERSION,
  LIGHT_SECOND_METERS,
  MINIMUM_LARGE_ANCHOR_OFFSET_METERS,
  MAXIMUM_LARGE_ANCHOR_OFFSET_METERS,
  PRIMARY_DUNGEON_CELESTIAL_GROUP_IDS,
  GENERAL_ANCHOR_CLASS_WEIGHTS,
  RESOURCE_ANCHOR_CLASS_WEIGHTS,
  collectFrontierDungeonSpawnAuthorityIDs,
  collectLandscapeDungeonSpawnExclusionIDs,
  getUniverseDungeonAnchorDistanceRange,
  isTemplateEligibleForUniverseSpawning,
  isTemplateExcludedFromUniverseSpawning,
  isTemplateFromFrontierDungeonDataset,
  orderUniverseDungeonAnchorCandidates,
};
