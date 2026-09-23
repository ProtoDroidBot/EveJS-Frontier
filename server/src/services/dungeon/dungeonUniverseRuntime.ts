const path = require("path");

const log = require(path.join(__dirname, "../../utils/logger"));
const config = require(path.join(__dirname, "../../config"));
const worldPlanningPool = require(path.join(__dirname, "../../space/worldPlanningPool"));
const interactiveWorkloadGate = require(path.join(
  __dirname,
  "../../utils/interactiveWorkloadGate",
));
const worldData = require(path.join(__dirname, "../../space/worldData"));
const asteroidData = require(path.join(__dirname, "../../space/asteroids/asteroidData"));
const {
  TABLE,
  readStaticRows,
} = require(path.join(__dirname, "../_shared/referenceData"));
const dungeonAuthority = require(path.join(__dirname, "./dungeonAuthority"));
const dungeonRuntime = require(path.join(__dirname, "./dungeonRuntime"));
const dungeonSiteAdapter = require(path.join(__dirname, "./dungeonSiteAdapter"));
const dungeonSiteSpawnPolicy = require(path.join(__dirname, "./dungeonSiteSpawnPolicy"));
const dungeonRuntimeState = require(path.join(__dirname, "./dungeonRuntimeState"));
const dungeonSpawnEligibility = require(path.join(__dirname, "./dungeonSpawnEligibility"));
const frontierDungeonSpawns = require(path.join(
  __dirname,
  "../../config/frontierDungeonSpawns",
));
const {
  DEFAULT_AU_METERS,
  buildAnchorRelativeSignaturePlacement,
} = require(path.join(__dirname, "../exploration/signatures/signaturePlacement"));
const trigDrifterSpawnAuthority = require(path.join(
  __dirname,
  "../../space/npc/trigDrifter/trigDrifterSpawnAuthority",
));
const miningResourceSiteService = require(path.join(
  __dirname,
  "../mining/miningResourceSiteService",
));
const iceSystemAuthority = require(path.join(
  __dirname,
  "../mining/iceSystemAuthority",
));
// Phase 0 / 0.C: dungeon-universe seeding reconciles the generated mining
// entities it spawns through mining's owner API rather than writing the
// miningRuntimeState table directly (it does not own that table).
const miningRuntimeState = require(path.join(__dirname, "../mining/miningRuntimeState"));
const sovState = require(path.join(__dirname, "../sovereignty/sovState"));

const GENERATED_MINING_RECONCILE_INTERVAL_MS = 60_000;
const UNIVERSE_SLOT_TICK_INTERVAL_MS = 1_000;
const GENERATED_MINING_DEFAULT_SITE_LIFETIME_MINUTES = 1440;
const DAILY_DOWNTIME_HOUR_UTC = 11;
const DEFAULT_CLUSTER_DOWNTIME_STARTS_UTC = "11:00:00";
const DAY_MS = 24 * 60 * 60 * 1000;
const UNIVERSE_SITE_ID_SYSTEM_STRIDE = 1_000;
const UNIVERSE_SITE_ID_BASES = Object.freeze({
  combat: 5_300_000_000_000,
  combat_anomaly: 5_350_000_000_000,
  data: 5_400_000_000_000,
  drifter_observatory: 5_450_000_000_000,
  drifter_unidentified_wormhole: 5_475_000_000_000,
  drifter_space_sentinel_hive: 5_476_000_000_000,
  drifter_space_barbican_hive: 5_477_000_000_000,
  drifter_space_vidette_hive: 5_478_000_000_000,
  drifter_space_conflux_hive: 5_479_000_000_000,
  drifter_space_redoubt_hive: 5_480_000_000_000,
  drifter_space_reckoning_labyrinth: 5_481_000_000_000,
  drifter_space_reckoning_nexus: 5_482_000_000_000,
  drifter_occupied_tabbetzur_field_rescue: 5_483_000_000_000,
  drifter_occupied_tabbetzur_deathless_research_outpost: 5_484_000_000_000,
  drifter_vigilance_point: 5_485_000_000_000,
  drifter_observatory_infiltration: 5_486_000_000_000,
  drifter_deepflow_rift_pochven: 5_487_000_000_000,
  drifter_deepflow_rift_knownspace: 5_488_000_000_000,
  relic: 5_500_000_000_000,
  ghost: 5_600_000_000_000,
  combat_hacking: 5_700_000_000_000,
  ore: 5_800_000_000_000,
  gas: 5_900_000_000_000,
  sov_threat_detection: 6_000_000_000_000,
  sov_prospecting: 6_100_000_000_000,
  sov_exploration_detector: 6_200_000_000_000,
});
const COSMIC_SIGNATURE_TYPE_ID = 19_728;
const COSMIC_SIGNATURE_GROUP_ID = 502;
const COSMIC_ANOMALY_TYPE_ID = 28_356;
const COSMIC_ANOMALY_GROUP_ID = 885;
const BACKGROUND_RECONCILE_INITIAL_BATCH_SIZE = 4;
const BACKGROUND_RECONCILE_MAX_BATCH_SIZE = 64;
const BACKGROUND_RECONCILE_TARGET_SLICE_MS = 12;
const BACKGROUND_RECONCILE_DELAY_MS = 25;
const INDEXED_SYSTEM_LOOKUP_LIMIT = 256;
const STARTUP_SYSTEM_RECONCILE_JOB_LIMIT = 25;
const SYSTEM_RECONCILE_INITIAL_DELAY_MS = 250;
const SYSTEM_WAKE_RECONCILE_DEBOUNCE_MS = 30_000;
const RANDOM_UNIVERSE_ALLOCATION_VERSION = 1;
const SYSTEM_WAKE_ALLOCATION_VERSION = 1;
const MAX_DUNGEON_SITE_PLACEMENT_ATTEMPTS = 256;
const ALLOCATION_MODES = new Set(["baseline", "fixed", "random"]);
const SOV_GUARANTEED_SITE_ORIGIN = "sov_hub";
const BASELINE_UNIVERSE_DUNGEON_FAMILY = "combat_anomaly";
const SOV_GUARANTEED_SPAWN_FAMILIES = Object.freeze([
  "sov_threat_detection",
  "sov_prospecting",
  "sov_exploration_detector",
]);
const SOV_GUARANTEED_FAMILY_SET = new Set(SOV_GUARANTEED_SPAWN_FAMILIES);
// Temporary Frontier world-spawn selection. Keep the other configured sites
// available for direct references while restricting automatic allocation.
const TEMPORARY_UNIVERSE_DUNGEON_IDS = new Set([
  // Mining sites, excluding Moon Eater, Xeroti, and stacked storage content.
  10403, 10456, 10457, 10458, 10459, 10684, 10685, 10688, 10710,
  11100, 11101, 11102, 11128, 12230, 12686, 13118, 13294, 13295, 13316,
  // Crude Rift sites (including the Fuel Deposit entry).
  10460, 10690, 11081, 11082, 11083, 11084, 11085, 12338,
  12710, 12711, 14001, 14008, 14103, 14104, 14105, 14106,
  // Osa Surveyors only; other Surveyors factions remain configured but dormant.
  12345,
]);
const DRONE_REGION_IDS = new Set([
  10000013, // Malpais
  10000018, // The Spire
  10000021, // Outer Passage
  10000027, // Etherium Reach
  10000034, // The Kalevala Expanse
  10000040, // Oasa
  10000053, // Cobalt Edge
  10000066, // Perrigen Falls
]);

const THREAT_DETECTION_TABLE = Object.freeze({
  pirate: Object.freeze([
    Object.freeze({
      key: "0.0_to_-0.25",
      minSecurity: -0.25,
      maxSecurity: 0,
      minor: Object.freeze({
        1: Object.freeze([["Refuge", 2], ["Den", 2], ["Hidden Den", 1]]),
        2: Object.freeze([["Refuge", 1], ["Den", 3], ["Hidden Den", 1], ["Forsaken Den", 1], ["Forlorn Den", 1], ["Rally Point", 2], ["Hidden Rally Point", 1]]),
        3: Object.freeze([["Refuge", 2], ["Den", 4], ["Hidden Den", 3], ["Forsaken Den", 2], ["Forlorn Den", 1], ["Rally Point", 2], ["Hidden Rally Point", 1]]),
      }),
      major: Object.freeze({
        1: Object.freeze([["Hub", 2], ["Hidden Hub", 3], ["Forsaken Hub", 2]]),
        2: Object.freeze([["Hub", 3], ["Hidden Hub", 3], ["Forsaken Hub", 2], ["Forlorn Hub", 2], ["Haven", 1]]),
        3: Object.freeze([["Hub", 4], ["Hidden Hub", 3], ["Forsaken Hub", 3], ["Forlorn Hub", 3], ["Haven", 2]]),
      }),
    }),
    Object.freeze({
      key: "-0.25_to_-0.45",
      minSecurity: -0.45,
      maxSecurity: -0.25,
      minor: Object.freeze({
        1: Object.freeze([["Refuge", 1], ["Den", 2], ["Hidden Den", 1], ["Forsaken Den", 1]]),
        2: Object.freeze([["Refuge", 1], ["Den", 3], ["Hidden Den", 2], ["Forsaken Den", 1], ["Forlorn Den", 1], ["Rally Point", 2], ["Hidden Rally Point", 1]]),
        3: Object.freeze([["Refuge", 2], ["Den", 4], ["Hidden Den", 2], ["Forsaken Den", 2], ["Forlorn Den", 1], ["Rally Point", 2], ["Hidden Rally Point", 2], ["Forsaken Rally Point", 1]]),
      }),
      major: Object.freeze({
        1: Object.freeze([["Hub", 2], ["Hidden Hub", 2], ["Forsaken Hub", 2], ["Forlorn Hub", 1]]),
        2: Object.freeze([["Hub", 2], ["Hidden Hub", 3], ["Forsaken Hub", 2], ["Forlorn Hub", 2], ["Haven", 2]]),
        3: Object.freeze([["Hub", 2], ["Hidden Hub", 3], ["Forsaken Hub", 3], ["Forlorn Hub", 3], ["Haven", 4], ["Sanctum", 1]]),
      }),
    }),
    Object.freeze({
      key: "-0.45_to_-0.65",
      minSecurity: -0.65,
      maxSecurity: -0.45,
      minor: Object.freeze({
        1: Object.freeze([["Refuge", 1], ["Den", 2], ["Hidden Den", 2], ["Forsaken Den", 1]]),
        2: Object.freeze([["Refuge", 1], ["Den", 2], ["Hidden Den", 2], ["Forsaken Den", 2], ["Forlorn Den", 1], ["Rally Point", 2], ["Hidden Rally Point", 1]]),
        3: Object.freeze([["Refuge", 1], ["Den", 4], ["Hidden Den", 2], ["Forsaken Den", 2], ["Forlorn Den", 2], ["Rally Point", 2], ["Hidden Rally Point", 1], ["Forsaken Rally Point", 2], ["Forlorn Rally Point", 1]]),
      }),
      major: Object.freeze({
        1: Object.freeze([["Hidden Hub", 2], ["Forsaken Hub", 2], ["Forlorn Hub", 2], ["Haven", 1]]),
        2: Object.freeze([["Hidden Hub", 3], ["Forsaken Hub", 3], ["Forlorn Hub", 3], ["Haven", 3]]),
        3: Object.freeze([["Hidden Hub", 3], ["Forsaken Hub", 3], ["Forlorn Hub", 3], ["Haven", 6], ["Sanctum", 2]]),
      }),
    }),
    Object.freeze({
      key: "-0.65_to_-0.85",
      minSecurity: -0.85,
      maxSecurity: -0.65,
      minor: Object.freeze({
        1: Object.freeze([["Den", 2], ["Hidden Den", 1], ["Forsaken Den", 2], ["Forlorn Den", 1]]),
        2: Object.freeze([["Den", 2], ["Hidden Den", 2], ["Forsaken Den", 2], ["Forlorn Den", 2], ["Rally Point", 3], ["Hidden Rally Point", 1]]),
        3: Object.freeze([["Den", 2], ["Hidden Den", 2], ["Forsaken Den", 2], ["Forlorn Den", 2], ["Rally Point", 4], ["Hidden Rally Point", 2], ["Forsaken Rally Point", 2], ["Forlorn Rally Point", 2]]),
      }),
      major: Object.freeze({
        1: Object.freeze([["Hidden Hub", 2], ["Forsaken Hub", 2], ["Forlorn Hub", 2], ["Haven", 2]]),
        2: Object.freeze([["Hidden Hub", 2], ["Forsaken Hub", 2], ["Forlorn Hub", 2], ["Haven", 4], ["Sanctum", 2]]),
        3: Object.freeze([["Hidden Hub", 2], ["Forsaken Hub", 3], ["Forlorn Hub", 2], ["Haven", 7], ["Sanctum", 3], ["Forsaken Sanctum", 1]]),
      }),
    }),
    Object.freeze({
      key: "-0.85_to_-1.0",
      minSecurity: -1,
      maxSecurity: -0.85,
      minor: Object.freeze({
        1: Object.freeze([["Den", 2], ["Hidden Den", 1], ["Forsaken Den", 2], ["Forlorn Den", 2]]),
        2: Object.freeze([["Den", 2], ["Hidden Den", 2], ["Forsaken Den", 2], ["Forlorn Den", 2], ["Rally Point", 2], ["Hidden Rally Point", 1], ["Forsaken Rally Point", 2]]),
        3: Object.freeze([["Den", 2], ["Hidden Den", 2], ["Forsaken Den", 2], ["Forlorn Den", 2], ["Rally Point", 2], ["Hidden Rally Point", 3], ["Forsaken Rally Point", 3], ["Forlorn Rally Point", 3]]),
      }),
      major: Object.freeze({
        1: Object.freeze([["Forsaken Hub", 3], ["Forlorn Hub", 2], ["Haven", 2], ["Sanctum", 1]]),
        2: Object.freeze([["Forsaken Hub", 3], ["Forlorn Hub", 3], ["Haven", 5], ["Sanctum", 2]]),
        3: Object.freeze([["Forsaken Hub", 2], ["Forlorn Hub", 2], ["Haven", 8], ["Sanctum", 4], ["Forsaken Sanctum", 3]]),
      }),
    }),
  ]),
  drone: Object.freeze([
    Object.freeze({
      key: "0.0_to_-0.25",
      minSecurity: -0.25,
      maxSecurity: 0,
      minor: Object.freeze({
        1: Object.freeze([["Drone Assembly", 4], ["Drone Gathering", 1]]),
        2: Object.freeze([["Drone Assembly", 5], ["Drone Gathering", 2], ["Drone Surveillance", 2], ["Drone Menagerie", 2], ["Drone Herd", 1]]),
        3: Object.freeze([["Drone Assembly", 5], ["Drone Gathering", 3], ["Drone Surveillance", 2], ["Drone Menagerie", 3], ["Drone Herd", 2], ["Drone Squad", 1]]),
      }),
      major: Object.freeze({
        1: Object.freeze([["Drone Patrol", 2], ["Drone Horde", 2]]),
        2: Object.freeze([["Drone Patrol", 3], ["Drone Horde", 3], ["Teeming Drone Horde", 1]]),
        3: Object.freeze([["Drone Patrol", 4], ["Drone Horde", 4], ["Teeming Drone Horde", 2]]),
      }),
    }),
    Object.freeze({
      key: "-0.25_to_-0.45",
      minSecurity: -0.45,
      maxSecurity: -0.25,
      minor: Object.freeze({
        1: Object.freeze([["Drone Assembly", 3], ["Drone Gathering", 2]]),
        2: Object.freeze([["Drone Assembly", 5], ["Drone Gathering", 2], ["Drone Surveillance", 2], ["Drone Menagerie", 3], ["Drone Herd", 2]]),
        3: Object.freeze([["Drone Assembly", 5], ["Drone Gathering", 3], ["Drone Surveillance", 3], ["Drone Menagerie", 3], ["Drone Herd", 3], ["Drone Squad", 1]]),
      }),
      major: Object.freeze({
        1: Object.freeze([["Drone Patrol", 2], ["Drone Horde", 3]]),
        2: Object.freeze([["Drone Patrol", 3], ["Drone Horde", 3], ["Teeming Drone Horde", 2]]),
        3: Object.freeze([["Drone Patrol", 4], ["Drone Horde", 4], ["Teeming Drone Horde", 3]]),
      }),
    }),
    Object.freeze({
      key: "-0.45_to_-0.65",
      minSecurity: -0.65,
      maxSecurity: -0.45,
      minor: Object.freeze({
        1: Object.freeze([["Drone Assembly", 2], ["Drone Gathering", 3]]),
        2: Object.freeze([["Drone Assembly", 4], ["Drone Gathering", 3], ["Drone Surveillance", 3], ["Drone Menagerie", 3], ["Drone Herd", 2]]),
        3: Object.freeze([["Drone Assembly", 5], ["Drone Gathering", 3], ["Drone Surveillance", 3], ["Drone Menagerie", 4], ["Drone Herd", 3], ["Drone Squad", 2]]),
      }),
      major: Object.freeze({
        1: Object.freeze([["Drone Patrol", 1], ["Drone Horde", 4]]),
        2: Object.freeze([["Drone Patrol", 2], ["Drone Horde", 3], ["Teeming Drone Horde", 3]]),
        3: Object.freeze([["Drone Patrol", 3], ["Drone Horde", 4], ["Teeming Drone Horde", 4]]),
      }),
    }),
    Object.freeze({
      key: "-0.65_to_-0.85",
      minSecurity: -0.85,
      maxSecurity: -0.65,
      minor: Object.freeze({
        1: Object.freeze([["Drone Assembly", 1], ["Drone Gathering", 4]]),
        2: Object.freeze([["Drone Assembly", 3], ["Drone Gathering", 3], ["Drone Surveillance", 4], ["Drone Menagerie", 3], ["Drone Herd", 3]]),
        3: Object.freeze([["Drone Assembly", 4], ["Drone Gathering", 3], ["Drone Surveillance", 3], ["Drone Menagerie", 5], ["Drone Herd", 3], ["Drone Squad", 3]]),
      }),
      major: Object.freeze({
        1: Object.freeze([["Drone Horde", 4], ["Teeming Drone Horde", 2]]),
        2: Object.freeze([["Drone Patrol", 2], ["Drone Horde", 2], ["Teeming Drone Horde", 4]]),
        3: Object.freeze([["Drone Patrol", 2], ["Drone Horde", 3], ["Teeming Drone Horde", 5]]),
      }),
    }),
    Object.freeze({
      key: "-0.85_to_-1.0",
      minSecurity: -1,
      maxSecurity: -0.85,
      minor: Object.freeze({
        1: Object.freeze([["Drone Gathering", 4], ["Drone Surveillance", 1]]),
        2: Object.freeze([["Drone Assembly", 2], ["Drone Gathering", 3], ["Drone Surveillance", 3], ["Drone Menagerie", 4], ["Drone Herd", 4]]),
        3: Object.freeze([["Drone Assembly", 3], ["Drone Gathering", 4], ["Drone Surveillance", 3], ["Drone Menagerie", 4], ["Drone Herd", 4], ["Drone Squad", 4]]),
      }),
      major: Object.freeze({
        1: Object.freeze([["Drone Horde", 4], ["Teeming Drone Horde", 3]]),
        2: Object.freeze([["Drone Patrol", 1], ["Drone Horde", 2], ["Teeming Drone Horde", 5]]),
        3: Object.freeze([["Drone Patrol", 2], ["Drone Horde", 2], ["Teeming Drone Horde", 6]]),
      }),
    }),
  ]),
});
const COMBAT_ANOMALY_LABELS = Object.freeze([
  "Teeming Drone Horde",
  "Forsaken Rally Point",
  "Forlorn Rally Point",
  "Hidden Rally Point",
  "Forsaken Sanctum",
  "Forsaken Hub",
  "Forlorn Hub",
  "Hidden Hub",
  "Forsaken Den",
  "Forlorn Den",
  "Hidden Den",
  "Drone Surveillance",
  "Drone Menagerie",
  "Drone Assembly",
  "Drone Gathering",
  "Drone Patrol",
  "Drone Horde",
  "Drone Squad",
  "Drone Herd",
  "Rally Point",
  "Sanctum",
  "Haven",
  "Refuge",
  "Hub",
  "Den",
]);
const PROSPECTING_MINERAL_ORE_NAMES = Object.freeze({
  tritanium: Object.freeze(["Veldspar"]),
  pyerite: Object.freeze(["Mordunium", "Kylixium"]),
  mexallon: Object.freeze(["Kylixium", "Mordunium"]),
  isogen: Object.freeze(["Griemeer", "Hezorime"]),
  nocxium: Object.freeze(["Nocxite"]),
  zydrine: Object.freeze(["Hezorime"]),
  megacyte: Object.freeze(["Ueganite"]),
});
const EXPLORATION_DETECTOR_FAMILY_SEQUENCE = Object.freeze([
  "data",
  "relic",
  "combat_hacking",
]);
const RANDOM_ALLOCATED_UNIVERSE_FAMILIES = new Set([
  "combat",
  "combat_anomaly",
  "data",
  "relic",
  "ore",
  "gas",
  "ghost",
  "combat_hacking",
]);
const WAKE_ALLOCATED_UNIVERSE_FAMILIES = new Set(RANDOM_ALLOCATED_UNIVERSE_FAMILIES);

let universeReconcileTicker = null;
let backgroundReconcileJob = null;
let backgroundReconcileTimer = null;
let backgroundFamilyAllocationCache = null;
let systemUniverseReconcileTimer = null;
const systemUniverseReconcileJobs = new Map();
let systemsByBandCache = null;
const eligibleSystemsByProfileCache = new Map();
const spawnProfileTemplateFilterCache = new Map();
const templateCandidatesBySpawnFamilyCache = new Map();
const bandTemplateCandidatesCache = new Map();
const policyEligibleTemplateCandidatesCache = new Map();
const systemWakeReconcileState = new Map();
const combatAnomalyTemplatesByLabelCache = new Map();
const prospectingOreTemplatesByKeyCache = new Map();
let stargateAdjacencyCache = null;
const stableWakeCandidateRankingsByFamilyBand = new Map();
let frontierDungeonSpawnAuthorityIDsCache = null;

function toInt(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.trunc(numeric) : fallback;
}

function resolveProfileAllocationMode(family, bandProfile = null) {
  const normalizedFamily = normalizeLowerText(family, "");
  const profile = dungeonAuthority.getSpawnProfile(normalizedFamily) || {};
  const explicitMode = normalizeLowerText(
    bandProfile && bandProfile.allocationMode,
    normalizeLowerText(profile.allocationMode, ""),
  );
  if (ALLOCATION_MODES.has(explicitMode)) {
    return explicitMode;
  }
  return RANDOM_ALLOCATED_UNIVERSE_FAMILIES.has(normalizedFamily)
    ? "random"
    : "fixed";
}

function resolveUniverseDungeonSlotsPerSystem(family, systemID, bandProfile = null) {
  const configuredSlots = Math.max(
    0,
    toInt(bandProfile && bandProfile.slotsPerSystem, 0),
  );
  if (
    configuredSlots <= 0 ||
    normalizeLowerText(family, "") !== BASELINE_UNIVERSE_DUNGEON_FAMILY ||
    resolveProfileAllocationMode(family, bandProfile) !== "baseline"
  ) {
    return configuredSlots;
  }
  // All Frontier entry-beacon groups share the combat-anomaly baseline. Keep
  // unrelated generated/resource-family mining allocation counts unchanged.
  return Math.max(
    configuredSlots,
    dungeonSpawnEligibility.resolveUniverseDungeonSiteCount(systemID),
  );
}

function firstPositiveInt(...values) {
  for (const value of values) {
    const numeric = toInt(value, 0);
    if (numeric > 0) {
      return numeric;
    }
  }
  return 0;
}

function hasOwnValue(object, key) {
  return object &&
    Object.prototype.hasOwnProperty.call(object, key) &&
    object[key] !== undefined &&
    object[key] !== null;
}

function toFiniteNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function normalizeText(value, fallback = "") {
  const normalized = String(value == null ? "" : value).trim();
  return normalized || fallback;
}

function normalizeLowerText(value, fallback = "") {
  return normalizeText(value, fallback).toLowerCase();
}

function normalizeTextArray(values) {
  return [...new Set((Array.isArray(values) ? values : [])
    .map((entry) => normalizeLowerText(entry, ""))
    .filter(Boolean))];
}

function normalizeObject(value) {
  return value && typeof value === "object" ? value : {};
}

function normalizeIntegerArray(values) {
  return [...new Set((Array.isArray(values) ? values : [])
    .map((entry) => toInt(entry, 0))
    .filter((entry) => entry > 0))]
    .sort((left, right) => left - right);
}

function formatUtcClock(hour, minute, second) {
  return [
    Math.max(0, toInt(hour, 0)).toString().padStart(2, "0"),
    Math.max(0, toInt(minute, 0)).toString().padStart(2, "0"),
    Math.max(0, toInt(second, 0)).toString().padStart(2, "0"),
  ].join(":");
}

function normalizeSecurityBand(value) {
  const normalized = normalizeLowerText(value, "nullsec");
  switch (normalized) {
    case "highsec":
    case "lowsec":
    case "nullsec":
    case "wormhole":
      return normalized;
    default:
      return "nullsec";
  }
}

function normalizeRatio(value, fallback = 0) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }
  return Math.max(0, Math.min(1, numeric));
}

function normalizeSystemIDs(systemIDs = null) {
  if (!Array.isArray(systemIDs) || systemIDs.length <= 0) {
    return worldData.getSolarSystems()
      .map((system) => toInt(system && system.solarSystemID, 0))
      .filter((entry) => entry > 0)
      .sort((left, right) => left - right);
  }

  return [...new Set(systemIDs
    .map((entry) => toInt(entry, 0))
    .filter((entry) => entry > 0))].sort((left, right) => left - right);
}

function normalizeProvidedSystemIDs(systemIDs: any[] = []) {
  return [...new Set((Array.isArray(systemIDs) ? systemIDs : [systemIDs])
    .map((entry) => toInt(entry, 0))
    .filter((entry) => entry > 0))].sort((left, right) => left - right);
}

function listSystemIDsByBand(band) {
  if (!systemsByBandCache) {
    systemsByBandCache = {
      highsec: [],
      lowsec: [],
      nullsec: [],
      wormhole: [],
    };
    for (const systemID of normalizeSystemIDs()) {
      systemsByBandCache[getSecurityBand(systemID)].push(systemID);
    }
  }
  return [...(systemsByBandCache[normalizeSecurityBand(band)] || [])];
}

function cloneValue(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function getFrontierDungeonSpawnAuthorityIDs() {
  if (!frontierDungeonSpawnAuthorityIDsCache) {
    const worldSnapshot = worldData.ensureLoaded();
    const configuredDungeonIDs = new Set(
      Object.keys(frontierDungeonSpawns.getConfig().sites || {})
        .map((entry) => Math.max(0, toInt(entry, 0)))
        .filter((entry) => entry > 0),
    );
    frontierDungeonSpawnAuthorityIDsCache = new Set(
      dungeonSpawnEligibility.collectFrontierDungeonSpawnAuthorityIDs(
        worldSnapshot,
        readStaticRows(TABLE.ITEM_TYPES),
      ).filter((dungeonID) => (
        configuredDungeonIDs.has(dungeonID) &&
        TEMPORARY_UNIVERSE_DUNGEON_IDS.has(dungeonID)
      )),
    );
  }
  return frontierDungeonSpawnAuthorityIDsCache;
}

function isUniverseSpawnEligibleTemplate(
  template,
  frontierDungeonIDs = getFrontierDungeonSpawnAuthorityIDs(),
) {
  // The extracted Frontier table describes every client dungeon/prefab which
  // happens to use a site entry group. It is source material, not a world
  // spawn allow-list. Only exact rows decorated from the unified config may
  // enter automatic universe selection or reconciliation.
  return Boolean(
    template &&
    template.templateID &&
    TEMPORARY_UNIVERSE_DUNGEON_IDS.has(Math.max(0, toInt(template.sourceDungeonID, 0))) &&
    template.frontierDungeonSpawnConfigured === true &&
    frontierDungeonSpawns.resolveSiteConfiguration(template)
  ) &&
    dungeonSpawnEligibility.isTemplateEligibleForUniverseSpawning(
      template,
      frontierDungeonIDs,
    );
}

function hashValue(value) {
  let state = toInt(value, 0) >>> 0;
  state = Math.imul(state ^ (state >>> 16), 0x45d9f3b);
  state = Math.imul(state ^ (state >>> 16), 0x45d9f3b);
  state ^= state >>> 16;
  return state >>> 0;
}

function hashText(value) {
  const normalized = normalizeText(value, "");
  let state = 0;
  for (let index = 0; index < normalized.length; index += 1) {
    state = hashValue(state + normalized.charCodeAt(index));
  }
  return state >>> 0;
}

function clonePosition(position, fallback: Record<string, any> = { x: 0, y: 0, z: 0 }) {
  return {
    x: toFiniteNumber(position && position.x, fallback.x),
    y: toFiniteNumber(position && position.y, fallback.y),
    z: toFiniteNumber(position && position.z, fallback.z),
  };
}

function addVectors(left, right) {
  return {
    x: toFiniteNumber(left && left.x, 0) + toFiniteNumber(right && right.x, 0),
    y: toFiniteNumber(left && left.y, 0) + toFiniteNumber(right && right.y, 0),
    z: toFiniteNumber(left && left.z, 0) + toFiniteNumber(right && right.z, 0),
  };
}

function normalizeVector(vector, fallback: Record<string, any> = { x: 1, y: 0, z: 0 }) {
  const x = toFiniteNumber(vector && vector.x, 0);
  const y = toFiniteNumber(vector && vector.y, 0);
  const z = toFiniteNumber(vector && vector.z, 0);
  const magnitude = Math.sqrt((x * x) + (y * y) + (z * z));
  if (magnitude <= 0) {
    return { ...fallback };
  }
  return {
    x: x / magnitude,
    y: y / magnitude,
    z: z / magnitude,
  };
}

function scaleVector(vector, scalar) {
  const numericScalar = toFiniteNumber(scalar, 0);
  return {
    x: toFiniteNumber(vector && vector.x, 0) * numericScalar,
    y: toFiniteNumber(vector && vector.y, 0) * numericScalar,
    z: toFiniteNumber(vector && vector.z, 0) * numericScalar,
  };
}

function getSecurityBand(systemID) {
  const numericSystemID = toInt(systemID, 0);
  if (numericSystemID >= 31_000_000 && numericSystemID <= 31_999_999) {
    return "wormhole";
  }
  const systemRecord = worldData.getSolarSystemByID(numericSystemID) || null;
  const securityStatus = toFiniteNumber(
    systemRecord && (systemRecord.securityStatus ?? systemRecord.security),
    0,
  );
  if (securityStatus >= 0.45) {
    return "highsec";
  }
  if (securityStatus >= 0) {
    return "lowsec";
  }
  return "nullsec";
}

function resolveSiteLifetimeMs(siteLifetimeMinutes) {
  return Math.max(60_000, Math.max(1, toInt(siteLifetimeMinutes, 1440)) * 60_000);
}

function getSpawnProfileTemplateFilters(family) {
  const cacheKey = normalizeLowerText(family, "unknown");
  if (spawnProfileTemplateFilterCache.has(cacheKey)) {
    return spawnProfileTemplateFilterCache.get(cacheKey);
  }
  const profile = dungeonAuthority.getSpawnProfile(family);
  const filters =
    profile && profile.templateFilters && typeof profile.templateFilters === "object"
      ? profile.templateFilters
      : {};
  const normalizedFilters = Object.freeze({
    siteFamilies: normalizeTextArray(filters.siteFamilies),
    siteKinds: normalizeTextArray(filters.siteKinds),
    nameIncludesAny: normalizeTextArray(filters.nameIncludesAny),
    nameExcludesAny: normalizeTextArray(filters.nameExcludesAny),
  });
  spawnProfileTemplateFilterCache.set(cacheKey, normalizedFilters);
  return normalizedFilters;
}

function buildBandCounts(systemIDs = null) {
  const counts = {
    highsec: 0,
    lowsec: 0,
    nullsec: 0,
    wormhole: 0,
  };
  for (const systemID of normalizeSystemIDs(systemIDs)) {
    counts[getSecurityBand(systemID)] += 1;
  }
  return counts;
}

function buildBandProfileCacheKey(family, band, bandProfile) {
  const profile = dungeonAuthority.getSpawnProfile(family) || {};
  return JSON.stringify({
    family: normalizeLowerText(family, ""),
    band: normalizeSecurityBand(band),
    allocationMode: resolveProfileAllocationMode(family, bandProfile),
    slotsPerSystem: Math.max(0, toInt(bandProfile && bandProfile.slotsPerSystem, 0)),
    systemStride: Math.max(1, toInt(bandProfile && bandProfile.systemStride, 1)),
    systemOffset: Math.max(0, toInt(bandProfile && bandProfile.systemOffset, 0)),
    targetSystems: Math.max(0, toInt(bandProfile && bandProfile.targetSystems, 0)),
    targetSystemRatio: normalizeRatio(bandProfile && bandProfile.targetSystemRatio, 0),
    systemAuthorityKeys: normalizeTextArray([
      ...(Array.isArray(profile.systemAuthorityKeys) ? profile.systemAuthorityKeys : []),
      ...(Array.isArray(bandProfile && bandProfile.systemAuthorityKeys)
        ? bandProfile.systemAuthorityKeys
        : []),
    ]),
    systemIDs: normalizeIntegerArray([
      ...(Array.isArray(profile.systemIDs) ? profile.systemIDs : []),
      ...(Array.isArray(bandProfile && bandProfile.systemIDs) ? bandProfile.systemIDs : []),
    ]),
    regionIDs: normalizeIntegerArray([
      ...(Array.isArray(profile.regionIDs) ? profile.regionIDs : []),
      ...(Array.isArray(bandProfile && bandProfile.regionIDs) ? bandProfile.regionIDs : []),
    ]),
    constellationIDs: normalizeIntegerArray([
      ...(Array.isArray(profile.constellationIDs) ? profile.constellationIDs : []),
      ...(Array.isArray(bandProfile && bandProfile.constellationIDs)
        ? bandProfile.constellationIDs
        : []),
    ]),
    wormholeClassIDs: normalizeIntegerArray([
      ...(Array.isArray(profile.wormholeClassIDs) ? profile.wormholeClassIDs : []),
      ...(Array.isArray(bandProfile && bandProfile.wormholeClassIDs)
        ? bandProfile.wormholeClassIDs
        : []),
    ]),
    excludeSystemIDs: normalizeIntegerArray([
      ...(Array.isArray(profile.excludeSystemIDs) ? profile.excludeSystemIDs : []),
      ...(Array.isArray(bandProfile && bandProfile.excludeSystemIDs)
        ? bandProfile.excludeSystemIDs
        : []),
    ]),
    excludeRegionIDs: normalizeIntegerArray([
      ...(Array.isArray(profile.excludeRegionIDs) ? profile.excludeRegionIDs : []),
      ...(Array.isArray(bandProfile && bandProfile.excludeRegionIDs)
        ? bandProfile.excludeRegionIDs
        : []),
    ]),
    excludeConstellationIDs: normalizeIntegerArray([
      ...(Array.isArray(profile.excludeConstellationIDs) ? profile.excludeConstellationIDs : []),
      ...(Array.isArray(bandProfile && bandProfile.excludeConstellationIDs)
        ? bandProfile.excludeConstellationIDs
        : []),
    ]),
    excludeWormholeClassIDs: normalizeIntegerArray([
      ...(Array.isArray(profile.excludeWormholeClassIDs) ? profile.excludeWormholeClassIDs : []),
      ...(Array.isArray(bandProfile && bandProfile.excludeWormholeClassIDs)
        ? bandProfile.excludeWormholeClassIDs
        : []),
    ]),
  });
}

function resolveBandTargetSystemCount(totalSystems, bandProfile) {
  const cappedTotal = Math.max(0, toInt(totalSystems, 0));
  if (cappedTotal <= 0) {
    return 0;
  }
  const explicitCount = Math.max(0, toInt(bandProfile && bandProfile.targetSystems, 0));
  if (explicitCount > 0) {
    return Math.min(cappedTotal, explicitCount);
  }
  const ratio = normalizeRatio(bandProfile && bandProfile.targetSystemRatio, 0);
  if (ratio > 0) {
    return Math.min(cappedTotal, Math.max(1, Math.round(cappedTotal * ratio)));
  }
  return 0;
}

function buildScopedSystemSelector(family, bandProfile) {
  const profile = dungeonAuthority.getSpawnProfile(family) || {};
  return {
    systemAuthorityKeys: normalizeTextArray([
      ...(Array.isArray(profile.systemAuthorityKeys) ? profile.systemAuthorityKeys : []),
      ...(Array.isArray(bandProfile && bandProfile.systemAuthorityKeys)
        ? bandProfile.systemAuthorityKeys
        : []),
    ]),
    systemIDs: normalizeIntegerArray([
      ...(Array.isArray(profile.systemIDs) ? profile.systemIDs : []),
      ...(Array.isArray(bandProfile && bandProfile.systemIDs) ? bandProfile.systemIDs : []),
    ]),
    regionIDs: normalizeIntegerArray([
      ...(Array.isArray(profile.regionIDs) ? profile.regionIDs : []),
      ...(Array.isArray(bandProfile && bandProfile.regionIDs) ? bandProfile.regionIDs : []),
    ]),
    constellationIDs: normalizeIntegerArray([
      ...(Array.isArray(profile.constellationIDs) ? profile.constellationIDs : []),
      ...(Array.isArray(bandProfile && bandProfile.constellationIDs)
        ? bandProfile.constellationIDs
        : []),
    ]),
    wormholeClassIDs: normalizeIntegerArray([
      ...(Array.isArray(profile.wormholeClassIDs) ? profile.wormholeClassIDs : []),
      ...(Array.isArray(bandProfile && bandProfile.wormholeClassIDs)
        ? bandProfile.wormholeClassIDs
        : []),
    ]),
    excludeSystemIDs: normalizeIntegerArray([
      ...(Array.isArray(profile.excludeSystemIDs) ? profile.excludeSystemIDs : []),
      ...(Array.isArray(bandProfile && bandProfile.excludeSystemIDs)
        ? bandProfile.excludeSystemIDs
        : []),
    ]),
    excludeRegionIDs: normalizeIntegerArray([
      ...(Array.isArray(profile.excludeRegionIDs) ? profile.excludeRegionIDs : []),
      ...(Array.isArray(bandProfile && bandProfile.excludeRegionIDs)
        ? bandProfile.excludeRegionIDs
        : []),
    ]),
    excludeConstellationIDs: normalizeIntegerArray([
      ...(Array.isArray(profile.excludeConstellationIDs) ? profile.excludeConstellationIDs : []),
      ...(Array.isArray(bandProfile && bandProfile.excludeConstellationIDs)
        ? bandProfile.excludeConstellationIDs
        : []),
    ]),
    excludeWormholeClassIDs: normalizeIntegerArray([
      ...(Array.isArray(profile.excludeWormholeClassIDs) ? profile.excludeWormholeClassIDs : []),
      ...(Array.isArray(bandProfile && bandProfile.excludeWormholeClassIDs)
        ? bandProfile.excludeWormholeClassIDs
        : []),
    ]),
  };
}

function filterSystemIDsByScopedSelector(systemIDs, selector: Record<string, any> = {}) {
  const candidateSystemIDs = normalizeSystemIDs(systemIDs);
  const authoritySystemIDs = normalizeIntegerArray(
    normalizeTextArray(selector.systemAuthorityKeys)
      .flatMap((key) => trigDrifterSpawnAuthority.getSystemList(key)),
  );
  const explicitSystemIDs = normalizeIntegerArray(selector.systemIDs);
  const regionIDs = new Set(normalizeIntegerArray(selector.regionIDs));
  const constellationIDs = new Set(normalizeIntegerArray(selector.constellationIDs));
  const wormholeClassIDs = new Set(normalizeIntegerArray(selector.wormholeClassIDs));
  const excludeSystemIDs = new Set(normalizeIntegerArray(selector.excludeSystemIDs));
  const excludeRegionIDs = new Set(normalizeIntegerArray(selector.excludeRegionIDs));
  const excludeConstellationIDs = new Set(normalizeIntegerArray(selector.excludeConstellationIDs));
  const excludeWormholeClassIDs = new Set(normalizeIntegerArray(selector.excludeWormholeClassIDs));
  const scopedSystemIDs = new Set([
    ...authoritySystemIDs,
    ...explicitSystemIDs,
  ]);
  const hasScopedSelectors =
    scopedSystemIDs.size > 0 ||
    regionIDs.size > 0 ||
    constellationIDs.size > 0 ||
    wormholeClassIDs.size > 0;
  const hasExcludeSelectors =
    excludeSystemIDs.size > 0 ||
    excludeRegionIDs.size > 0 ||
    excludeConstellationIDs.size > 0 ||
    excludeWormholeClassIDs.size > 0;

  const filtered = candidateSystemIDs.filter((systemID) => {
    if (excludeSystemIDs.has(systemID)) {
      return false;
    }
    const systemRecord = worldData.getSolarSystemByID(systemID) || null;
    const regionID = toInt(systemRecord && systemRecord.regionID, 0);
    if (excludeRegionIDs.has(regionID)) {
      return false;
    }
    const constellationID = toInt(systemRecord && systemRecord.constellationID, 0);
    if (excludeConstellationIDs.has(constellationID)) {
      return false;
    }
    const wormholeClassID = toInt(systemRecord && systemRecord.wormholeClassID, 0);
    if (excludeWormholeClassIDs.has(wormholeClassID)) {
      return false;
    }
    if (!hasScopedSelectors) {
      return true;
    }
    if (scopedSystemIDs.has(systemID)) {
      return true;
    }
    if (regionIDs.has(regionID)) {
      return true;
    }
    if (constellationIDs.has(constellationID)) {
      return true;
    }
    return wormholeClassIDs.has(wormholeClassID);
  });

  return hasScopedSelectors || hasExcludeSelectors
    ? filtered
    : candidateSystemIDs;
}

function listEligibleSystemIDsForBandProfile(family, band, bandProfile, systemIDs = null) {
  const normalizedBand = normalizeSecurityBand(band);
  const slotsPerSystem = Math.max(0, toInt(bandProfile && bandProfile.slotsPerSystem, 0));
  if (slotsPerSystem <= 0) {
    return [];
  }
  const fullBandSystemIDs = filterSystemIDsByScopedSelector(
    listSystemIDsByBand(normalizedBand),
    buildScopedSystemSelector(family, bandProfile),
  );
  const cacheKey = buildBandProfileCacheKey(family, normalizedBand, bandProfile);
  let eligible = eligibleSystemsByProfileCache.get(cacheKey);
  if (!eligible) {
    const allocationMode = resolveProfileAllocationMode(family, bandProfile);
    const targetCount = resolveBandTargetSystemCount(fullBandSystemIDs.length, bandProfile);
    if (allocationMode === "baseline") {
      eligible = [...fullBandSystemIDs];
    } else if (targetCount > 0) {
      eligible = fullBandSystemIDs
        .map((systemID) => ({
          systemID,
          score: hashValue(
            (toInt(systemID, 0) * 8191) +
            hashText(family) +
            (hashText(normalizedBand) * 17),
          ),
        }))
        .sort((left, right) => (
          left.score - right.score
        ) || (
          left.systemID - right.systemID
        ))
        .slice(0, targetCount)
        .map((entry) => entry.systemID)
        .sort((left, right) => left - right);
    } else {
      const stride = Math.max(1, toInt(bandProfile && bandProfile.systemStride, 1));
      const offset = Math.max(0, toInt(bandProfile && bandProfile.systemOffset, 0)) % stride;
      eligible = fullBandSystemIDs.filter((systemID) => {
        if (stride <= 1) {
          return true;
        }
        return (hashValue(toInt(systemID, 0) + hashText(family)) % stride) === offset;
      });
    }
    eligibleSystemsByProfileCache.set(cacheKey, eligible);
  }
  if (!Array.isArray(systemIDs) || systemIDs.length <= 0) {
    return [...eligible];
  }
  const targeted = new Set<any>(normalizeSystemIDs(systemIDs));
  return eligible.filter((systemID) => targeted.has(systemID));
}

function pickMiningGenerationConfig() {
  const picked: Record<string, any> = {};
  for (const [key, value] of Object.entries<any>(config || {})) {
    if (
      key === "miningGeneratedIceSitesEnabled" ||
      key.startsWith("miningIceSites") ||
      key.startsWith("miningIceTargetSystems") ||
      key === "miningIceChunksPerSite" ||
      key === "miningGeneratedIceSiteLifetimeMinutes"
    ) {
      picked[key] = cloneValue(value);
    }
  }
  return picked;
}

function getGeneratedMiningSlotsPerSystem(kind, securityBand) {
  const normalizedKind = normalizeLowerText(kind, "ice");
  const band = normalizeSecurityBand(securityBand);
  switch (`${normalizedKind}:${band}`) {
    case "ice:highsec":
      return Math.max(0, toInt(config && config.miningIceSitesHighSecPerSystem, 1));
    case "ice:lowsec":
      return Math.max(0, toInt(config && config.miningIceSitesLowSecPerSystem, 1));
    case "ice:nullsec":
      return Math.max(0, toInt(config && config.miningIceSitesNullSecPerSystem, 1));
    case "ice:wormhole":
      return Math.max(0, toInt(config && config.miningIceSitesWormholePerSystem, 0));
    default:
      return 0;
  }
}

function getGeneratedMiningTargetSystems(kind, securityBand) {
  const normalizedKind = normalizeLowerText(kind, "ice");
  const band = normalizeSecurityBand(securityBand);
  switch (`${normalizedKind}:${band}`) {
    case "ice:highsec":
      return Math.max(0, toInt(config && config.miningIceTargetSystemsHighSec, 36));
    case "ice:lowsec":
      return Math.max(0, toInt(config && config.miningIceTargetSystemsLowSec, 18));
    case "ice:nullsec":
      return Math.max(0, toInt(config && config.miningIceTargetSystemsNullSec, 84));
    case "ice:wormhole":
      return Math.max(0, toInt(config && config.miningIceTargetSystemsWormhole, 0));
    default:
      return 0;
  }
}

function buildGeneratedMiningBandProfile(kind, securityBand) {
  return {
    slotsPerSystem: getGeneratedMiningSlotsPerSystem(kind, securityBand),
    systemStride: 1,
    systemOffset: 0,
    targetSystems: getGeneratedMiningTargetSystems(kind, securityBand),
    targetSystemRatio: 0,
  };
}

function resolveGeneratedMiningSiteLifetimeMs() {
  return resolveSiteLifetimeMs(
    Math.max(
      1,
      toInt(
        config && config.miningGeneratedIceSiteLifetimeMinutes,
        GENERATED_MINING_DEFAULT_SITE_LIFETIME_MINUTES,
      ),
    ),
  );
}

function buildBroadUniverseDescriptor(systemIDs = null) {
  const authorityPayload = dungeonAuthority.getPayload();
  const families = [
    ...dungeonAuthority.listUniverseSpawnFamilies(),
    ...listSovereigntyGuaranteedSpawnFamilies(),
  ];
  const bandCounts = buildBandCounts(systemIDs);
  const systemCount = Object.values(bandCounts).reduce((sum, count) => sum + count, 0);
  let estimatedSiteCount = 0;
  const familyPolicies: Record<string, any> = {};

  for (const family of families) {
    const profile = dungeonAuthority.getSpawnProfile(family);
    if (isSovereigntyGuaranteedSpawnFamily(family)) {
      familyPolicies[family] = {
        enabled: true,
        persistent: true,
        dynamic: true,
        siteOrigin: SOV_GUARANTEED_SITE_ORIGIN,
        sourceRefs: [
          "ccpSovHub",
          "ccpSovHubCombatAnomalies",
          "ccpEquinoxSovUpdates",
        ],
        policyVersion: dungeonSiteSpawnPolicy.POLICY_VERSION,
      };
      continue;
    }
    if (!profile || profile.enabled === false || profile.persistent === false) {
      continue;
    }
    const slots: Record<string, any> = {};
    const effectiveSlotRanges: Record<string, any> = {};
    const strides: Record<string, any> = {};
    const targetSystems: Record<string, any> = {};
    const allocationModes: Record<string, any> = {};
    for (const band of ["highsec", "lowsec", "nullsec", "wormhole"]) {
      const bandProfile = profile.bands && profile.bands[band];
      const slotsPerSystem = Math.max(0, toInt(bandProfile && bandProfile.slotsPerSystem, 0));
      const eligibleSystemIDs = listEligibleSystemIDsForBandProfile(
        family,
        band,
        bandProfile,
        systemIDs,
      );
      const effectiveSlotCounts = eligibleSystemIDs.map((systemID) => (
        resolveUniverseDungeonSlotsPerSystem(family, systemID, bandProfile)
      ));
      slots[band] = slotsPerSystem;
      effectiveSlotRanges[band] = {
        minimum: effectiveSlotCounts.length > 0 ? Math.min(...effectiveSlotCounts) : 0,
        maximum: effectiveSlotCounts.length > 0 ? Math.max(...effectiveSlotCounts) : 0,
      };
      strides[band] = Math.max(1, toInt(bandProfile && bandProfile.systemStride, 1));
      allocationModes[band] = resolveProfileAllocationMode(family, bandProfile);
      targetSystems[band] = eligibleSystemIDs.length;
      estimatedSiteCount += effectiveSlotCounts.reduce((sum, count) => sum + count, 0);
    }
    familyPolicies[family] = {
      siteLifetimeMinutes: Math.max(1, toInt(profile.siteLifetimeMinutes, 1440)),
      siteLifetimeMs: resolveSiteLifetimeMs(profile.siteLifetimeMinutes),
      siteOrigin: normalizeLowerText(profile.siteOrigin, "universe_dungeon"),
      randomAllocationVersion: RANDOM_UNIVERSE_ALLOCATION_VERSION,
      allocationModes,
      slots,
      effectiveSlotRanges,
      strides,
      targetSystems,
    };
  }

  const descriptor = {
    scope: Array.isArray(systemIDs) && systemIDs.length > 0 ? "subset" : "full",
    systemCount,
    bandCounts,
    randomAllocationVersion: RANDOM_UNIVERSE_ALLOCATION_VERSION,
    spawnPolicy: dungeonSiteSpawnPolicy.getPolicyDescriptor(),
    authorityVersion: Math.max(0, toInt(authorityPayload && authorityPayload.version, 0)),
    authorityTemplateCount: Math.max(
      0,
      toInt(authorityPayload && authorityPayload.counts && authorityPayload.counts.templateCount, 0),
    ),
    spawnEligibility: {
      frontierDungeonAuthorityVersion:
        dungeonSpawnEligibility.FRONTIER_DUNGEON_SPAWN_AUTHORITY_VERSION,
      frontierDungeonGroupIDs:
        [...dungeonSpawnEligibility.FRONTIER_DUNGEON_SPAWN_GROUP_IDS],
      frontierDungeonIDs: [...getFrontierDungeonSpawnAuthorityIDs()],
      frontierResourceFieldPolicyVersion:
        asteroidData.FRONTIER_RESOURCE_FIELD_POLICY_VERSION,
      frontierResourceFieldsEnabled:
        asteroidData.FRONTIER_SYNTHETIC_RESOURCE_FIELDS_ENABLED === true,
    },
    familyPolicies,
    estimatedSiteCount,
  };
  return {
    descriptor,
    descriptorKey: JSON.stringify(descriptor),
  };
}

function buildMiningUniverseDescriptor(systemIDs = null) {
  const bandCounts = buildBandCounts(systemIDs);
  const targetSystems: Record<string, any> = {};
  const targetSlots: Record<string, any> = {};
  let estimatedSiteCount = 0;
  const authorityRows = iceSystemAuthority.listIceSystemAuthorityRows(
    Array.isArray(systemIDs) && systemIDs.length > 0
      ? normalizeSystemIDs(systemIDs)
      : null,
  );
  for (const band of ["highsec", "lowsec", "nullsec", "wormhole"]) {
    const bandRows = authorityRows
      .filter((row) => normalizeLowerText(row && row.securityBand, "") === band);
    targetSystems[band] = bandRows.length;
    targetSlots[band] = bandRows.reduce(
      (sum, row) => sum + Math.max(0, toInt(row && row.slotCount, 1)),
      0,
    );
    estimatedSiteCount += targetSlots[band];
  }
  const descriptor = {
    scope: Array.isArray(systemIDs) && systemIDs.length > 0 ? "subset" : "full",
    systemCount: Object.values(bandCounts).reduce((sum, count) => sum + count, 0),
    bandCounts,
    generationConfig: pickMiningGenerationConfig(),
    targetSystems,
    targetSlots,
    estimatedSiteCount,
  };
  return {
    descriptor,
    descriptorKey: JSON.stringify(descriptor),
  };
}

function buildUniverseDescriptor(_nowMs?: number): {
  descriptor: {
    version: number;
    broadDescriptorKey: string;
    miningDescriptorKey: string;
    broad: ReturnType<typeof buildBroadUniverseDescriptor>["descriptor"];
    mining: ReturnType<typeof buildMiningUniverseDescriptor>["descriptor"];
  };
  descriptorKey: string;
  broadDescriptorKey: string;
  miningDescriptorKey: string;
};
function buildUniverseDescriptor() {
  const broad = buildBroadUniverseDescriptor();
  const mining = buildMiningUniverseDescriptor();
  const descriptor = {
    version: 4,
    broadDescriptorKey: broad.descriptorKey,
    miningDescriptorKey: mining.descriptorKey,
  };
  return {
    descriptor: {
      ...descriptor,
      broad: broad.descriptor,
      mining: mining.descriptor,
    },
    descriptorKey: JSON.stringify(descriptor),
    broadDescriptorKey: broad.descriptorKey,
    miningDescriptorKey: mining.descriptorKey,
  };
}

function getUniverseReconcileStatus(nowMs = Date.now()) {
  const meta = dungeonRuntimeState.getUniverseReconcileMeta();
  const descriptor = buildUniverseDescriptor();
  return {
    nowMs: Math.max(0, toInt(nowMs, Date.now())),
    meta,
    descriptor,
    broadUpToDate:
      normalizeText(meta && meta.broadDescriptorKey, "") === descriptor.broadDescriptorKey,
    miningUpToDate:
      normalizeText(meta && meta.miningDescriptorKey, "") === descriptor.miningDescriptorKey,
    fullUpToDate:
      normalizeText(meta && meta.descriptorKey, "") === descriptor.descriptorKey,
  };
}

function writeUniverseReconcileMeta(summary: Record<string, any> = {}, options: Record<string, any> = {}) {
  const descriptor = options.descriptor || buildUniverseDescriptor(options.nowMs);
  return dungeonRuntimeState.writeUniverseReconcileMeta({
    version: 1,
    descriptorKey: descriptor.descriptorKey,
    broadDescriptorKey: descriptor.broadDescriptorKey,
    miningDescriptorKey: descriptor.miningDescriptorKey,
    lastStartedAtMs: Math.max(0, toInt(options.startedAtMs, Date.now())),
    lastCompletedAtMs: Math.max(0, toInt(options.completedAtMs, Date.now())),
    lastScope: normalizeText(options.scope, "full"),
    lastReason: normalizeText(options.reason, ""),
    summary: cloneValue(summary),
  });
}

function extractStaticPosition(record) {
  const position = record && record.position && typeof record.position === "object"
    ? record.position
    : record;
  return {
    x: toFiniteNumber(position && position.x, 0),
    y: toFiniteNumber(position && position.y, 0),
    z: toFiniteNumber(position && position.z, 0),
  };
}

function buildUniverseAnchorCandidates(systemID, family) {
  const normalizedFamily = normalizeLowerText(family, "combat");
  const resourceFamily = normalizedFamily === "ore" || normalizedFamily === "gas";
  const belts = (
    resourceFamily
      ? asteroidData.getBeltsForSystem(systemID)
      : worldData.getAsteroidBeltsForSystem(systemID)
  )
    .map((belt) => ({
      itemID: toInt(belt && belt.itemID, 0),
      anchorKind: belt && belt.frontierLandscapeSite === true
        ? "landscape-resource-field"
        : "asteroid-belt",
      resourceZone: normalizeLowerText(belt && belt.resourceZone, "") || null,
      ecosystemID: toInt(belt && belt.ecosystemID, 0) || null,
      position: extractStaticPosition(belt),
    }))
    .filter((entry) => entry.itemID > 0);
  const celestials = worldData.getCelestialsForSystem(systemID)
    .map((celestial) => ({
      itemID: toInt(celestial && celestial.itemID, 0),
      groupID: toInt(celestial && celestial.groupID, 0),
      position: extractStaticPosition(celestial),
    }))
    .filter((entry) => entry.itemID > 0);
  const stations = worldData.getStationsForSystem(systemID)
    .map((station) => ({
      itemID: toInt(station && station.stationID, 0),
      anchorKind: "station",
      position: extractStaticPosition(station),
    }))
    .filter((entry) => entry.itemID > 0);
  const stargates = worldData.getStargatesForSystem(systemID)
    .map((stargate) => ({
      itemID: toInt(stargate && stargate.itemID, 0),
      anchorKind: "stargate",
      position: extractStaticPosition(stargate),
    }))
    .filter((entry) => entry.itemID > 0);

  const ordered = dungeonSpawnEligibility.orderUniverseDungeonAnchorCandidates({
    belts,
    celestials,
    stations,
    stargates,
  }, normalizedFamily);
  if (ordered.length > 0) {
    return ordered;
  }

  const systemRecord = worldData.getSolarSystemByID(systemID) || null;
  const fallbackRadius = Math.max(
    1_000_000_000,
    Math.round(toFiniteNumber(systemRecord && systemRecord.radius, 0) * 0.25),
  );
  return [{
    itemID: systemID,
    position: { x: fallbackRadius, y: 0, z: 0 },
  }];
}

function normalizeSitePlacementDistanceAu(value) {
  if (!value || typeof value !== "object") {
    return null;
  }
  const min = Math.max(0, toFiniteNumber(value.min, 3.65));
  const max = Math.max(min, toFiniteNumber(value.max, 4.35));
  return { min, max };
}

function normalizeSiteSeparationLightSeconds(value) {
  if (!value || typeof value !== "object") {
    return null;
  }
  const min = Math.max(0.001, toFiniteNumber(value.min, 1));
  const max = Math.max(min, toFiniteNumber(value.max, 10));
  return { min, max };
}

function resolveTemplatePlacementDistanceAu(template) {
  if (!template || !template.frontierDungeonPlacementDistanceAu) {
    return null;
  }
  return normalizeSitePlacementDistanceAu(
    template && template.frontierDungeonPlacementDistanceAu,
  );
}

function resolveTemplateSeparationLightSeconds(template) {
  const configuredDefaults = frontierDungeonSpawns.getConfig().defaults;
  return normalizeSiteSeparationLightSeconds(
    template && template.frontierDungeonSeparationLightSeconds ||
      configuredDefaults.siteSeparationLightSeconds,
  );
}

function buildUniverseSitePosition(systemID, family, slotIndex, rotationIndex = 0, options: Record<string, any> = {}) {
  return buildUniverseSitePlacement(systemID, family, slotIndex, rotationIndex, options).position;
}

function buildUniverseSitePlacement(
  systemID,
  family,
  slotIndex,
  rotationIndex = 0,
  options: Record<string, any> = {},
) {
  const anchorCandidates = buildUniverseAnchorCandidates(systemID, family);
  const placementDistanceAu = normalizeSitePlacementDistanceAu(
    options.placementDistanceAu,
  );
  const placementAttempt = Math.max(0, toInt(options.placementAttempt, 0));
  const baseDistanceAu = placementDistanceAu
    ? (placementDistanceAu.min + placementDistanceAu.max) / 2
    : 4;
  const distanceJitterAu = placementDistanceAu
    ? (placementDistanceAu.max - placementDistanceAu.min) / 2
    : 0.35;
  const rangedAnchorCandidates = placementDistanceAu
    ? anchorCandidates.map((candidate) => ({
      ...candidate,
      minimumDistanceMeters: placementDistanceAu.min * DEFAULT_AU_METERS,
      maximumDistanceMeters: placementDistanceAu.max * DEFAULT_AU_METERS,
    }))
    : anchorCandidates;
  const placement = buildAnchorRelativeSignaturePlacement(
    rangedAnchorCandidates,
    `universe-site:${normalizeLowerText(family, "unknown")}:${toInt(systemID, 0)}:${Math.max(0, toInt(slotIndex, 0))}:${Math.max(0, toInt(rotationIndex, 0))}` +
      (placementAttempt > 0 ? `:separation-attempt:${placementAttempt}` : ""),
    {
      fallbackAnchorItemID: toInt(systemID, 0),
      baseDistanceAu,
      distanceJitterAu,
      verticalJitterAu: 0.14,
    },
  );
  return {
    ...placement,
    placementDistanceAu,
    anchorDistanceMeters: toFiniteNumber(placement && placement.distanceMeters, 0),
    anchorDistanceAu: toFiniteNumber(placement && placement.distanceAu, 0),
    placementAttempt,
  };
}

function buildGeneratedMiningSiteKey(definition) {
  return [
    "generatedmining",
    normalizeText(definition && definition.family, "unknown").toLowerCase(),
    toInt(definition && definition.solarSystemID, 0),
    toInt(definition && definition.localSiteIndex, 0),
  ].join(":");
}

function buildGeneratedMiningDefinitionHash(definition, templateID, placement = null) {
  const sitePosition = placement && placement.position
    ? placement.position
    : definition && definition.position;
  return JSON.stringify({
    templateID: normalizeText(templateID, ""),
    family: normalizeText(definition && definition.family, "unknown").toLowerCase(),
    solarSystemID: toInt(definition && definition.solarSystemID, 0),
    localSiteIndex: toInt(definition && definition.localSiteIndex, 0),
    rawSiteIndex: toInt(definition && definition.rawSiteIndex, 0),
    rotationIndex: Math.max(0, toInt(definition && definition.rotationIndex, 0)),
    sourceDungeonID: toInt(definition && definition.sourceDungeonID, 0) || null,
    authorityKey: normalizeText(definition && definition.authorityKey, "") || null,
    resourceTypeIDs: Array.isArray(definition && definition.resourceTypeIDs)
      ? [...definition.resourceTypeIDs]
      : [],
    members: (Array.isArray(definition && definition.members) ? definition.members : [])
      .map((member) => [
        toInt(member && member.entityID, 0),
        toInt(member && member.yieldTypeID, 0),
        Math.max(0, toInt(member && member.originalQuantity, 0)),
      ]),
    anchorItemID: toInt(placement && placement.anchorItemID, 0),
    anchorDistanceMeters: Math.round(toFiniteNumber(placement && placement.anchorDistanceMeters, 0)),
    position: [
      Math.round(toFiniteNumber(sitePosition && sitePosition.x, 0)),
      Math.round(toFiniteNumber(sitePosition && sitePosition.y, 0)),
      Math.round(toFiniteNumber(sitePosition && sitePosition.z, 0)),
    ],
  });
}

function buildGeneratedMiningSpawnState(definition) {
  const members = (Array.isArray(definition && definition.members) ? definition.members : [])
    .map((member) => cloneValue(member));
  return {
    siteID: toInt(definition && definition.siteID, 0),
    rawSiteIndex: toInt(definition && definition.rawSiteIndex, 0),
    localSiteIndex: toInt(definition && definition.localSiteIndex, 0),
    sourceDungeonID: toInt(definition && definition.sourceDungeonID, 0) || null,
    templateID: normalizeText(definition && definition.templateID, "") || null,
    authorityKey: normalizeText(definition && definition.authorityKey, "") || null,
    authorityScope: normalizeText(definition && definition.authorityScope, "") || null,
    label: normalizeText(definition && definition.label, "Mining Site"),
    memberCount: members.length,
    activeMemberCount: members.filter((member) => toInt(member && member.remainingQuantity, 0) > 0).length,
    totalOriginalQuantity: members.reduce(
      (sum, member) => sum + Math.max(0, toInt(member && member.originalQuantity, 0)),
      0,
    ),
    totalRemainingQuantity: members.reduce(
      (sum, member) => sum + Math.max(0, toInt(member && member.remainingQuantity, 0)),
      0,
    ),
    resourceTypeIDs: Array.isArray(definition && definition.resourceTypeIDs)
      ? [...definition.resourceTypeIDs]
      : [],
    resourceNames: Array.isArray(definition && definition.resourceNames)
      ? [...definition.resourceNames]
      : [],
    members,
  };
}

function resolveGeneratedMiningTemplate(definition) {
  const family = normalizeText(definition && definition.family, "unknown").toLowerCase();
  const resourceHintField =
    family === "gas"
      ? "gasTypeIDs"
      : (
        family === "ice"
          ? "iceTypeIDs"
          : "oreTypeIDs"
      );
  const hints = {
    templateID: normalizeText(definition && definition.templateID, ""),
    [resourceHintField]: Array.isArray(definition && definition.resourceTypeIDs)
      ? definition.resourceTypeIDs
      : [],
  };
  return dungeonSiteAdapter.resolveTemplateForSite({
    solarSystemID: toInt(definition && definition.solarSystemID, 0),
    dungeonID: toInt(definition && definition.sourceDungeonID, 0),
    archetypeID: family === "ice" ? 28 : 0,
    siteKind: "anomaly",
    family,
    label: normalizeText(definition && definition.label, "Mining Site"),
  }, hints);
}

function enrichGeneratedMiningDefinition(definition, nowMs, options: Record<string, any> = {}) {
  const template = resolveGeneratedMiningTemplate(definition);
  if (!template || !isUniverseSpawnEligibleTemplate(template)) {
    return null;
  }

  const templateID = normalizeText(template.templateID, "");
  const slotIndex = Math.max(
    0,
    toInt(
      definition && definition.localSiteIndex,
      options && options.slotIndex,
    ),
  );
  const rotationIndex = Math.max(
    0,
    toInt(
      options && options.rotationIndex,
      definition && definition.rotationIndex,
    ),
  );
  const startedAtMs = Math.max(0, toInt(options && options.startedAtMs, nowMs));
  const lifetimeMs = Math.max(
    60_000,
    toInt(
      options && options.lifetimeMs,
      resolveGeneratedMiningSiteLifetimeMs(),
    ),
  );
  const placement = buildUniverseSitePlacement(
    toInt(definition && definition.solarSystemID, 0),
    normalizeText(definition && definition.family, "ice").toLowerCase(),
    slotIndex,
    rotationIndex,
  );
  const position = placement.position;
  return {
    templateID,
    solarSystemID: toInt(definition && definition.solarSystemID, 0),
    siteKey: buildGeneratedMiningSiteKey(definition),
    lifecycleState: "active",
    instanceScope: "shared",
    siteFamily: normalizeText(definition && definition.family, "unknown").toLowerCase(),
    siteKind: "anomaly",
    siteOrigin: "generatedMining",
    position,
    nowMs: startedAtMs,
    activatedAtMs: startedAtMs,
    expiresAtMs: startedAtMs + lifetimeMs,
    spawnState: {
      ...buildGeneratedMiningSpawnState(definition),
      slotIndex,
      rotationIndex,
      securityBand: normalizeText(definition && definition.securityBand, getSecurityBand(definition && definition.solarSystemID)),
      lifetimeMs,
      anchorItemID: toInt(placement && placement.anchorItemID, 0) || null,
      anchorDistanceMeters: Math.round(toFiniteNumber(placement && placement.anchorDistanceMeters, 0)),
      anchorDistanceAu: Number(toFiniteNumber(placement && placement.anchorDistanceAu, 0).toFixed(3)),
    },
    roomStatesByKey: {
      "room:entry": {
        roomKey: "room:entry",
        state: "active",
        stage: "entry",
        pocketID: null,
        nodeGraphID: null,
        activatedAtMs: startedAtMs,
        completedAtMs: 0,
        lastUpdatedAtMs: startedAtMs,
        spawnedEntityIDs: [],
        counters: {},
        metadata: {
          seededFromTemplate: false,
          lightweight: true,
        },
      },
    },
    gateStatesByKey: {},
    objectiveState: {
      state: "pending",
      currentNodeID: null,
      currentObjectiveID: null,
      completedObjectiveIDs: [],
      completedNodeIDs: [],
      counters: {},
      metadata: {
        lightweight: true,
      },
    },
    environmentState: {
      seededAtMs: startedAtMs,
      lightweight: true,
    },
    runtimeFlags: {
      universeSeeded: true,
      universePersistent: true,
      lazyMaterialized: true,
      generatedMining: true,
    },
    metadata: {
      providerID: "generatedMining",
      definitionHash: buildGeneratedMiningDefinitionHash(definition, templateID, placement),
      siteID: toInt(definition && definition.siteID, 0),
      rawSiteIndex: toInt(definition && definition.rawSiteIndex, 0),
      localSiteIndex: slotIndex,
      slotIndex,
      rotationIndex,
      sourceDungeonID: toInt(definition && definition.sourceDungeonID, 0) || null,
      authorityKey: normalizeText(definition && definition.authorityKey, "") || null,
      authorityScope: normalizeText(definition && definition.authorityScope, "") || null,
      label: normalizeText(definition && definition.label, "Mining Site"),
      securityBand: normalizeText(definition && definition.securityBand, getSecurityBand(definition && definition.solarSystemID)),
      universeSeededAtMs: startedAtMs,
      anchorItemID: toInt(placement && placement.anchorItemID, 0) || null,
      anchorDistanceMeters: Math.round(toFiniteNumber(placement && placement.anchorDistanceMeters, 0)),
      anchorDistanceAu: Number(toFiniteNumber(placement && placement.anchorDistanceAu, 0).toFixed(3)),
    },
  };
}

function listDesiredGeneratedMiningDefinitions(systemIDs = null, nowMs = Date.now()) {
  const targetedSystemIDs = normalizeSystemIDs(systemIDs);
  const eligibleSystemIDs = iceSystemAuthority.listIceSystemIDs(targetedSystemIDs);
  const freshDefinitions = eligibleSystemIDs
    .flatMap((systemID) => miningResourceSiteService.buildGeneratedResourceSiteDefinitionsForSystem(systemID))
    .map((definition) => enrichGeneratedMiningDefinition(definition, nowMs))
    .filter(Boolean);
  if (freshDefinitions.length <= 0) {
    return [];
  }
  const activeBySiteKey = new Map<any, any>(
    listUniverseSeededGeneratedMiningInstances(eligibleSystemIDs)
      .map((instance) => [normalizeText(instance && instance.siteKey, ""), instance] as const)
      .filter(([siteKey]) => Boolean(siteKey)),
  );
  return freshDefinitions.map((definition) => {
    const existing = activeBySiteKey.get(normalizeText(definition && definition.siteKey, "")) || null;
    return existing && normalizeText(existing.templateID, "") === normalizeText(definition.templateID, "")
      ? cloneValue(existing)
      : definition;
  });
}

function buildGeneratedMiningDefinitionFromInstance(instance) {
  if (
    !instance ||
    normalizeLowerText(instance && instance.siteOrigin, "") !== "generatedmining"
  ) {
    return null;
  }
  const metadata = instance && instance.metadata && typeof instance.metadata === "object"
    ? instance.metadata
    : {};
  const spawnState = instance && instance.spawnState && typeof instance.spawnState === "object"
    ? instance.spawnState
    : {};
  const family = normalizeText(instance && instance.siteFamily, "ice").toLowerCase();
  const rawSiteIndex = Math.max(
    0,
    toInt(
      metadata.rawSiteIndex,
      spawnState.rawSiteIndex,
    ),
  );
  const localSiteIndex = Math.max(
    0,
    toInt(
      metadata.localSiteIndex,
      spawnState.localSiteIndex,
    ),
  );
  const definition = {
    solarSystemID: Math.max(0, toInt(instance && instance.solarSystemID, 0)),
    family,
    siteFamily: family,
    siteKind: "anomaly",
    localSiteIndex,
    rawSiteIndex,
    rotationIndex: Math.max(
      0,
      toInt(
        metadata.rotationIndex,
        spawnState.rotationIndex,
      ),
    ),
    siteID: Math.max(
      0,
      toInt(
        metadata.siteID,
        spawnState.siteID,
      ),
    ),
    sourceDungeonID: Math.max(
      0,
      toInt(
        metadata.sourceDungeonID,
        spawnState.sourceDungeonID,
      ),
    ) || null,
    templateID: normalizeText(
      instance && instance.templateID,
      normalizeText(spawnState.templateID, ""),
    ) || null,
    authorityKey: normalizeText(
      metadata.authorityKey,
      normalizeText(spawnState.authorityKey, ""),
    ) || null,
    authorityScope: normalizeText(
      metadata.authorityScope,
      normalizeText(spawnState.authorityScope, ""),
    ) || null,
    label: normalizeText(
      metadata.label,
      normalizeText(spawnState.label, "Mining Site"),
    ),
    securityBand: normalizeText(
      metadata.securityBand,
      normalizeText(
        spawnState.securityBand,
        getSecurityBand(instance && instance.solarSystemID),
      ),
    ),
    memberCount: Math.max(
      0,
      toInt(spawnState.memberCount, Array.isArray(spawnState.members) ? spawnState.members.length : 0),
    ),
    activeMemberCount: Math.max(
      0,
      toInt(
        spawnState.activeMemberCount,
        Array.isArray(spawnState.members)
          ? spawnState.members.filter((member) => toInt(member && member.remainingQuantity, 0) > 0).length
          : 0,
      ),
    ),
    totalOriginalQuantity: Math.max(0, toInt(spawnState.totalOriginalQuantity, 0)),
    totalRemainingQuantity: Math.max(0, toInt(spawnState.totalRemainingQuantity, 0)),
    resourceTypeIDs: Array.isArray(spawnState.resourceTypeIDs)
      ? [...spawnState.resourceTypeIDs]
      : [],
    resourceNames: Array.isArray(spawnState.resourceNames)
      ? [...spawnState.resourceNames]
      : [],
    members: Array.isArray(spawnState.members)
      ? cloneValue(spawnState.members)
      : [],
    position:
      instance && instance.position && typeof instance.position === "object"
        ? clonePosition(instance.position)
        : null,
  };
  return {
    ...definition,
    spawnState: buildGeneratedMiningSpawnState(definition),
  };
}

function listActiveGeneratedMiningDefinitionsFromRuntime(systemIDs = null) {
  return listUniverseSeededGeneratedMiningInstances(systemIDs)
    .map((instance) => buildGeneratedMiningDefinitionFromInstance(instance))
    .filter(Boolean);
}

function buildGeneratedMiningPersistedState(member, family, nowMs) {
  return {
    version: 1,
    entityID: toInt(member && member.entityID, 0),
    visualTypeID: Math.max(1, toInt(member && member.visualTypeID, 0)),
    beltID: 0,
    fieldStyleID: null,
    yieldTypeID: Math.max(0, toInt(member && member.yieldTypeID, 0)),
    yieldKind: normalizeText(
      member && member.yieldKind,
      family,
    ).toLowerCase(),
    unitVolume: Math.max(0.000001, toFiniteNumber(member && member.unitVolume, 1)),
    originalQuantity: Math.max(0, toInt(member && member.originalQuantity, 0)),
    remainingQuantity: Math.max(0, toInt(member && member.remainingQuantity, 0)),
    originalRadius: Math.max(1, toFiniteNumber(member && member.originalRadius, 1)),
    updatedAtMs: Math.max(0, toInt(nowMs, Date.now())),
  };
}

function reconcileGeneratedMiningRuntimeState(definitions, systemIDs, nowMs) {
  const targetedSystemIDs = normalizeSystemIDs(systemIDs);
  const desiredBySystem = new Map();
  for (const systemID of targetedSystemIDs) {
    desiredBySystem.set(systemID, new Map());
  }

  for (const definition of Array.isArray(definitions) ? definitions : []) {
    const systemID = toInt(definition && definition.solarSystemID, 0);
    if (!desiredBySystem.has(systemID)) {
      desiredBySystem.set(systemID, new Map());
    }
    const desiredByEntityID = desiredBySystem.get(systemID);
    const spawnState = definition && definition.spawnState && typeof definition.spawnState === "object"
      ? definition.spawnState
      : {};
    for (const member of Array.isArray(spawnState.members) ? spawnState.members : []) {
      const entityID = toInt(member && member.entityID, 0);
      if (entityID > 0) {
        desiredByEntityID.set(entityID, buildGeneratedMiningPersistedState(
          member,
          definition && definition.siteFamily,
          nowMs,
        ));
      }
    }
  }

  let createdRows = 0;
  let updatedRows = 0;
  let removedRows = 0;
  for (const [systemID, desiredByEntityID] of desiredBySystem.entries()) {
    const existingByEntityID = miningRuntimeState.readPersistedSystemEntities(systemID);

    for (const [entityIDKey, persistedState] of Object.entries<any>(existingByEntityID)) {
      const descriptor = miningResourceSiteService.resolveGeneratedMiningEntityDescriptor(
        persistedState && persistedState.entityID != null
          ? persistedState.entityID
          : entityIDKey,
      );
      if (!descriptor || descriptor.systemID !== systemID) {
        continue;
      }
      if (!desiredByEntityID.has(toInt(entityIDKey, 0))) {
        if (miningRuntimeState.removePersistedSystemEntity(systemID, entityIDKey)) {
          removedRows += 1;
        }
      }
    }

    for (const [entityID, desiredState] of desiredByEntityID.entries()) {
      const existingState = existingByEntityID[String(entityID)];
      if (!existingState) {
        if (miningRuntimeState.writePersistedSystemEntity(systemID, entityID, desiredState)) {
          createdRows += 1;
        }
        continue;
      }

      const existingComparable = {
        ...cloneValue(existingState),
        updatedAtMs: 0,
      };
      const desiredComparable = {
        ...cloneValue(desiredState),
        updatedAtMs: 0,
      };
      if (JSON.stringify(existingComparable) !== JSON.stringify(desiredComparable)) {
        if (miningRuntimeState.writePersistedSystemEntity(systemID, entityID, desiredState)) {
          updatedRows += 1;
        }
      }
    }
  }

  return {
    createdRows,
    updatedRows,
    removedRows,
  };
}

function getUniverseSiteProviderID(siteKind) {
  return normalizeLowerText(siteKind, "signature") === "anomaly"
    ? "sceneAnomalySite"
    : "sceneSignatureSite";
}

function buildUniverseSiteID(family, systemID, slotIndex) {
  const base = UNIVERSE_SITE_ID_BASES[normalizeLowerText(family, "")];
  if (!base) {
    return 0;
  }
  return base + (toInt(systemID, 0) * UNIVERSE_SITE_ID_SYSTEM_STRIDE) + (Math.max(0, toInt(slotIndex, 0)) + 1);
}

function resolveSiteFamilyLabel(family) {
  switch (normalizeLowerText(family, "unknown")) {
    case "combat":
      return "Combat";
    case "combat_anomaly":
      return "Combat Anomaly";
    case "drifter_observatory":
      return "Jove Observatory";
    case "drifter_unidentified_wormhole":
      return "Unidentified Wormhole";
    case "drifter_space_sentinel_hive":
    case "drifter_space_barbican_hive":
    case "drifter_space_vidette_hive":
    case "drifter_space_conflux_hive":
    case "drifter_space_redoubt_hive":
      return "Drifter Hive";
    case "combat_hacking":
      return "Combat Hacking";
    case "data":
      return "Data";
    case "relic":
      return "Relic";
    case "ore":
      return "Ore";
    case "gas":
      return "Gas";
    case "sov_threat_detection":
      return "Sov Combat";
    case "sov_prospecting":
      return "Sov Ore";
    case "sov_exploration_detector":
      return "Sov Exploration";
    case "ghost":
      return "Ghost";
    default:
      return "Site";
  }
}

function resolveUniverseSiteLabel(template, family, slotIndex) {
  const normalizedFamily = normalizeLowerText(family, "unknown");
  const resolvedName = normalizeText(template && template.resolvedName, "");
  if (
    resolvedName &&
    (
      normalizedFamily.startsWith("drifter_")
    )
  ) {
    return resolvedName;
  }
  const familyLabel = resolveSiteFamilyLabel(family);
  const templateMarker =
    Math.max(0, toInt(template && template.sourceDungeonID, 0)) ||
    Math.max(0, toInt(template && template.dungeonNameID, 0)) ||
    (Math.max(0, toInt(slotIndex, 0)) + 1);
  return `${familyLabel} Site ${templateMarker}`;
}

function normalizeDifficultyRange(range) {
  const values = Array.isArray(range) ? range : [];
  const minimum = toInt(values[0], 0);
  const maximum = toInt(values[1], minimum);
  return [
    Math.min(minimum, maximum),
    Math.max(minimum, maximum),
  ];
}

function listTemplateCandidatesForSpawnFamily(family) {
  const cacheKey = normalizeLowerText(family, "unknown");
  if (templateCandidatesBySpawnFamilyCache.has(cacheKey)) {
    return templateCandidatesBySpawnFamilyCache.get(cacheKey);
  }
  const filters = getSpawnProfileTemplateFilters(cacheKey);
  const siteFamilies = filters.siteFamilies.length > 0
    ? filters.siteFamilies
    : [cacheKey];
  const candidatesByTemplateID = new Map();
  for (const siteFamily of siteFamilies) {
    for (const template of dungeonAuthority.listTemplatesByFamily(siteFamily)) {
      if (!template || !template.templateID) {
        continue;
      }
      if (!isUniverseSpawnEligibleTemplate(template)) {
        continue;
      }
      if (templateMatchesSpawnFamily(template, cacheKey, { difficultyRange: [0, 99] })) {
        candidatesByTemplateID.set(template.templateID, template);
      }
    }
  }
  const candidates = Object.freeze([...candidatesByTemplateID.values()]);
  templateCandidatesBySpawnFamilyCache.set(cacheKey, candidates);
  return candidates;
}

function templateMatchesSpawnFamily(template, family, bandProfile) {
  if (!template || typeof template !== "object") {
    return false;
  }
  const filters = getSpawnProfileTemplateFilters(family);
  const [minimum, maximum] = normalizeDifficultyRange(bandProfile && bandProfile.difficultyRange);
  const difficulty = toInt(template && template.difficulty, 0);
  if (difficulty < minimum || difficulty > maximum) {
    return false;
  }
  const siteFamily = normalizeLowerText(template && template.siteFamily, "unknown");
  const siteKind = normalizeLowerText(template && template.siteKind, "signature");
  const resolvedName = normalizeLowerText(template && template.resolvedName, "");
  if (filters.siteFamilies.length > 0 && !filters.siteFamilies.includes(siteFamily)) {
    return false;
  }
  if (filters.siteKinds.length > 0 && !filters.siteKinds.includes(siteKind)) {
    return false;
  }
  if (filters.nameIncludesAny.length > 0 && !filters.nameIncludesAny.some((entry) => resolvedName.includes(entry))) {
    return false;
  }
  if (filters.nameExcludesAny.length > 0 && filters.nameExcludesAny.some((entry) => resolvedName.includes(entry))) {
    return false;
  }
  return true;
}

function listFamilyTemplatesForBand(family, band, bandProfile) {
  const cacheKey = JSON.stringify({
    family: normalizeLowerText(family, "unknown"),
    band: normalizeSecurityBand(band),
    difficultyRange: normalizeDifficultyRange(bandProfile && bandProfile.difficultyRange),
  });
  if (bandTemplateCandidatesCache.has(cacheKey)) {
    return bandTemplateCandidatesCache.get(cacheKey);
  }
  const allCandidates = listTemplateCandidatesForSpawnFamily(family);
  const candidates = allCandidates
    .filter((template) => {
      return templateMatchesSpawnFamily(template, family, bandProfile);
    })
    .sort((left, right) => (
      toInt(left && left.sourceDungeonID, Number.MAX_SAFE_INTEGER) -
      toInt(right && right.sourceDungeonID, Number.MAX_SAFE_INTEGER)
    ) || String(left && left.templateID || "").localeCompare(String(right && right.templateID || "")));
  if (candidates.length > 0) {
    const cachedCandidates = Object.freeze(candidates);
    bandTemplateCandidatesCache.set(cacheKey, cachedCandidates);
    return cachedCandidates;
  }
  const fallbackCandidates = Object.freeze(allCandidates
    .sort((left, right) => (
      toInt(left && left.sourceDungeonID, Number.MAX_SAFE_INTEGER) -
      toInt(right && right.sourceDungeonID, Number.MAX_SAFE_INTEGER)
    ) || String(left && left.templateID || "").localeCompare(String(right && right.templateID || ""))));
  bandTemplateCandidatesCache.set(cacheKey, fallbackCandidates);
  return fallbackCandidates;
}

function evaluateTemplateSpawnPolicy(template, family, systemID, band, context, options: Record<string, any> = {}) {
  return dungeonSiteSpawnPolicy.evaluateSiteSpawnPolicy({
    template,
    spawnFamilyKey: family,
    systemID,
    securityBand: band,
  }, context, options);
}

function listSovereigntyGuaranteedSpawnFamilies() {
  return [...SOV_GUARANTEED_SPAWN_FAMILIES];
}

function isSovereigntyGuaranteedSpawnFamily(family) {
  return SOV_GUARANTEED_FAMILY_SET.has(normalizeLowerText(family, ""));
}

function getSystemSecurityStatus(systemID) {
  const systemRecord = worldData.getSolarSystemByID(systemID) || null;
  return toFiniteNumber(
    systemRecord && (systemRecord.securityStatus ?? systemRecord.security),
    0,
  );
}

function isDroneRegionSystem(systemID) {
  const systemRecord = worldData.getSolarSystemByID(systemID) || null;
  return DRONE_REGION_IDS.has(toInt(systemRecord && systemRecord.regionID, 0));
}

function resolveThreatDetectionSecurityBracket(systemID) {
  const security = Math.max(-1, Math.min(0, getSystemSecurityStatus(systemID)));
  const table = isDroneRegionSystem(systemID)
    ? THREAT_DETECTION_TABLE.drone
    : THREAT_DETECTION_TABLE.pirate;
  return table.find((entry) => (
    security >= entry.minSecurity &&
    (
      security < entry.maxSecurity ||
      (entry.maxSecurity === 0 && security <= 0)
    )
  )) || table[table.length - 1];
}

function parseNumberedUpgradeName(name, pattern) {
  const match = pattern.exec(normalizeText(name, ""));
  if (!match) {
    return null;
  }
  return {
    kind: normalizeLowerText(match[1], ""),
    tier: Math.max(1, Math.min(3, toInt(match[2], 1))),
  };
}

function parseThreatDetectionUpgrade(upgrade) {
  const parsed = parseNumberedUpgradeName(
    upgrade && upgrade.name,
    /\b(minor|major)\s+threat detection array\s+([123])\b/i,
  );
  if (!parsed || !["minor", "major"].includes(parsed.kind)) {
    return null;
  }
  return {
    ...parsed,
    category: "threat_detection",
    upgrade,
  };
}

function parseProspectingUpgrade(upgrade) {
  const match = /\b([a-z]+)\s+prospecting array\s+([123])\b/i
    .exec(normalizeText(upgrade && upgrade.name, ""));
  if (!match) {
    return null;
  }
  const mineral = normalizeLowerText(match[1], "");
  if (!PROSPECTING_MINERAL_ORE_NAMES[mineral]) {
    return null;
  }
  return {
    category: "prospecting",
    mineral,
    tier: Math.max(1, Math.min(3, toInt(match[2], 1))),
    upgrade,
  };
}

function parseExplorationDetectorUpgrade(upgrade) {
  const parsed = parseNumberedUpgradeName(
    upgrade && upgrade.name,
    /\b(exploration detector)\s+([123])\b/i,
  );
  if (!parsed) {
    return null;
  }
  return {
    category: "exploration_detector",
    kind: "exploration_detector" as const,
    tier: parsed.tier,
    upgrade,
  };
}

function listParsedOnlineUpgrades(context, parser) {
  const normalized = dungeonSiteSpawnPolicy.normalizePolicyContext(context);
  const byKey = new Map();
  for (const parsed of normalized.sovereignty.onlineUpgrades
    .map((upgrade) => parser(upgrade))
    .filter(Boolean)) {
    const key = [
      parsed.category,
      parsed.kind || parsed.mineral || "",
      parsed.tier,
      toInt(parsed.upgrade && parsed.upgrade.typeID, 0),
    ].join(":");
    if (!byKey.has(key)) {
      byKey.set(key, parsed);
    }
  }
  return [...byKey.values()]
    .sort((left, right) => (
      normalizeText(left.kind || left.mineral, "").localeCompare(normalizeText(right.kind || right.mineral, ""))
    ) || (left.tier - right.tier) || (
      toInt(left.upgrade && left.upgrade.typeID, 0) - toInt(right.upgrade && right.upgrade.typeID, 0)
    ));
}

function expandSlotCounts(entries: any[] = []) {
  const slots: any[] = [];
  for (const entry of entries) {
    const label = normalizeText(entry && entry[0], "");
    const count = Math.max(0, toInt(entry && entry[1], 0));
    for (let index = 0; label && index < count; index += 1) {
      slots.push({
        label,
        occurrence: index + 1,
      });
    }
  }
  return slots;
}

function classifyCombatAnomalyTemplate(template) {
  const name = normalizeLowerText(
    template && (template.resolvedName || template.name || template.templateID),
    "",
  );
  for (const label of COMBAT_ANOMALY_LABELS) {
    const normalizedLabel = normalizeLowerText(label, "");
    if (!normalizedLabel || normalizedLabel === "teeming drone horde") {
      continue;
    }
    if (name.includes(normalizedLabel)) {
      return label;
    }
  }
  return "";
}

function listCombatAnomalyTemplatesForLabel(label, options: Record<string, any> = {}) {
  const normalizedLabel = normalizeLowerText(label, "");
  if (!combatAnomalyTemplatesByLabelCache.has(normalizedLabel)) {
    const lookupLabel = normalizedLabel === "teeming drone horde"
      ? "drone horde"
      : normalizedLabel;
    const templates = Object.freeze(dungeonAuthority
      .listTemplatesByFamily("combat")
      .filter((template) => isUniverseSpawnEligibleTemplate(template))
      .filter((template) => normalizeLowerText(template && template.siteKind, "") === "anomaly")
      .filter((template) => normalizeLowerText(classifyCombatAnomalyTemplate(template), "") === lookupLabel)
      .sort((left, right) => (
        toInt(left && left.sourceDungeonID, Number.MAX_SAFE_INTEGER) -
        toInt(right && right.sourceDungeonID, Number.MAX_SAFE_INTEGER)
      ) || String(left && left.templateID || "").localeCompare(String(right && right.templateID || ""))));
    combatAnomalyTemplatesByLabelCache.set(normalizedLabel, templates);
  }
  const templates = combatAnomalyTemplatesByLabelCache.get(normalizedLabel);
  const systemID = Math.max(0, toInt(options.systemID, 0));
  if (systemID <= 0) {
    return templates;
  }
  const band = normalizeSecurityBand(options.band || getSecurityBand(systemID));
  const spawnFamilyKey = normalizeLowerText(
    options.spawnFamilyKey,
    "sov_threat_detection",
  );
  const policyContext = options.policyContext ||
    buildTemplatePolicyContext(spawnFamilyKey, systemID, band);
  return Object.freeze(templates.filter((template) => {
    const evaluation = evaluateTemplateSpawnPolicy(
      template,
      spawnFamilyKey,
      systemID,
      band,
      policyContext,
      options.policyOptions || {},
    );
    return evaluation && evaluation.allowed !== false;
  }));
}

function pickDeterministicTemplate(candidates, seedText) {
  const list = Array.isArray(candidates) ? candidates : [];
  if (list.length <= 0) {
    return null;
  }
  return list[hashText(seedText) % list.length] || list[0] || null;
}

function prospectingSizeTermsForTier(tier) {
  switch (Math.max(1, Math.min(3, toInt(tier, 1)))) {
    case 1:
      return ["small", ""];
    case 2:
      return ["", "large", "average"];
    case 3:
      return ["large", "enormous", ""];
    default:
      return [""];
  }
}

function listProspectingOreTemplates(mineral, tier) {
  const cacheKey = `${normalizeLowerText(mineral, "")}:${Math.max(1, Math.min(3, toInt(tier, 1)))}`;
  if (prospectingOreTemplatesByKeyCache.has(cacheKey)) {
    return prospectingOreTemplatesByKeyCache.get(cacheKey);
  }
  const oreNames = PROSPECTING_MINERAL_ORE_NAMES[normalizeLowerText(mineral, "")] || [];
  const sizeTerms = prospectingSizeTermsForTier(tier);
  const candidates = dungeonAuthority
    .listTemplatesByFamily("ore")
    .filter((template) => isUniverseSpawnEligibleTemplate(template))
    .filter((template) => normalizeLowerText(template && template.siteKind, "") === "anomaly")
    .filter((template) => {
      const name = normalizeLowerText(template && (template.resolvedName || template.name || ""), "");
      return oreNames.some((oreName) => name.includes(normalizeLowerText(oreName, "")));
    })
    .sort((left, right) => {
      const leftName = normalizeLowerText(left && (left.resolvedName || left.name), "");
      const rightName = normalizeLowerText(right && (right.resolvedName || right.name), "");
      const leftRank = sizeTerms.findIndex((term) => term === "" || leftName.includes(term));
      const rightRank = sizeTerms.findIndex((term) => term === "" || rightName.includes(term));
      return (
        (leftRank < 0 ? Number.MAX_SAFE_INTEGER : leftRank) -
        (rightRank < 0 ? Number.MAX_SAFE_INTEGER : rightRank)
      ) || (
        toInt(left && left.sourceDungeonID, Number.MAX_SAFE_INTEGER) -
        toInt(right && right.sourceDungeonID, Number.MAX_SAFE_INTEGER)
      ) || String(left && left.templateID || "").localeCompare(String(right && right.templateID || ""));
    });
  const result = Object.freeze(candidates);
  prospectingOreTemplatesByKeyCache.set(cacheKey, result);
  return result;
}

function getStargateAdjacency() {
  if (stargateAdjacencyCache) {
    return stargateAdjacencyCache;
  }
  const adjacency = new Map();
  for (const system of worldData.getSolarSystems()) {
    const systemID = toInt(system && system.solarSystemID, 0);
    if (systemID > 0 && !adjacency.has(systemID)) {
      adjacency.set(systemID, new Set<any>());
    }
  }
  for (const systemID of adjacency.keys()) {
    for (const gate of worldData.getStargatesForSystem(systemID)) {
      const destinationSystemID = toInt(gate && gate.destinationSolarSystemID, 0);
      if (destinationSystemID <= 0) {
        continue;
      }
      if (!adjacency.has(destinationSystemID)) {
        adjacency.set(destinationSystemID, new Set<any>());
      }
      adjacency.get(systemID).add(destinationSystemID);
      adjacency.get(destinationSystemID).add(systemID);
    }
  }
  stargateAdjacencyCache = adjacency;
  return stargateAdjacencyCache;
}

function listSystemsWithinJumps(sourceSystemID, maxJumps) {
  const source = toInt(sourceSystemID, 0);
  const limit = Math.max(0, toInt(maxJumps, 0));
  if (source <= 0) {
    return [];
  }
  const adjacency = getStargateAdjacency();
  const visited = new Map([[source, 0]]);
  const queue = [source];
  for (let index = 0; index < queue.length; index += 1) {
    const current = queue[index];
    const jumps = visited.get(current) || 0;
    if (jumps >= limit) {
      continue;
    }
    for (const next of adjacency.get(current) || []) {
      if (visited.has(next)) {
        continue;
      }
      visited.set(next, jumps + 1);
      queue.push(next);
    }
  }
  return [...visited.entries()]
    .filter(([systemID]) => getSecurityBand(systemID) === "nullsec")
    .sort((left, right) => (left[1] - right[1]) || (left[0] - right[0]))
    .map(([systemID, jumps]) => ({
      systemID,
      jumps,
    }));
}

function buildTemplatePolicyContext(family, systemID, band) {
  if (
    !dungeonSiteSpawnPolicy.isRuledSpawnFamily(family) &&
    !dungeonSiteSpawnPolicy.isLocallyScopedPirateSpawnFamily(family)
  ) {
    return dungeonSiteSpawnPolicy.normalizePolicyContext({
      securityBand: band,
    });
  }
  return dungeonSiteSpawnPolicy.buildRuntimeSystemPolicyContext(systemID, {
    securityBand: band,
  });
}

function buildPolicyCandidateCacheKey(family, systemID, band, bandProfile, policyContext, policyOptions: Record<string, any> = {}) {
  const normalizedContext = dungeonSiteSpawnPolicy.normalizePolicyContext({
    ...(policyContext || {}),
    securityBand: band,
  });
  const upgradeCategories = ["exploration_detector", "prospecting", "threat_detection"]
    .filter((category) => dungeonSiteSpawnPolicy.hasOnlineUpgradeCategory(normalizedContext, category));
  return JSON.stringify({
    policyVersion: dungeonSiteSpawnPolicy.POLICY_VERSION,
    factionClassifierVersion: Math.max(
      0,
      toInt(dungeonSiteSpawnPolicy.getPolicyDescriptor().factionClassifierVersion, 0),
    ),
    family: normalizeLowerText(family, "unknown"),
    band: normalizeSecurityBand(band),
    difficultyRange: normalizeDifficultyRange(bandProfile && bandProfile.difficultyRange),
    localPirateFactionKey: normalizedContext.localPirateFactionKey,
    localPirateFactionSource: normalizedContext.localPirateFactionSource,
    localPirateFactionSpecialSpace: normalizedContext.localPirateFactionSpecialSpace === true,
    reviewedNeutralTemplateIDs: [...new Set(
      (Array.isArray(policyOptions.reviewedNeutralTemplateIDs)
        ? policyOptions.reviewedNeutralTemplateIDs
        : [])
        .map((entry) => normalizeText(entry, ""))
        .filter(Boolean),
    )].sort((left, right) => left.localeCompare(right)),
    enforceSovereigntyUpgrades: policyOptions.enforceSovereigntyUpgrades,
    hasSovereignty: normalizedContext.sovereignty.hasSovereignty === true,
    hasHub: Boolean(normalizedContext.sovereignty.hubID),
    upgradeCategories,
    systemID: normalizedContext.sovereignty.hasSovereignty === true
      ? Math.max(0, toInt(systemID, 0))
      : 0,
  });
}

function listPolicyEligibleTemplatesForBand(family, systemID, band, bandProfile, policyContext, policyOptions: Record<string, any> = {}) {
  const cacheKey = buildPolicyCandidateCacheKey(
    family,
    systemID,
    band,
    bandProfile,
    policyContext,
    policyOptions,
  );
  if (policyEligibleTemplateCandidatesCache.has(cacheKey)) {
    return policyEligibleTemplateCandidatesCache.get(cacheKey);
  }
  const eligible = Object.freeze(listFamilyTemplatesForBand(family, band, bandProfile)
    .map((template) => ({
      template,
      evaluation: evaluateTemplateSpawnPolicy(
        template,
        family,
        systemID,
        band,
        policyContext,
        policyOptions,
      ),
    }))
    .filter((entry) => entry.evaluation && entry.evaluation.allowed !== false));
  policyEligibleTemplateCandidatesCache.set(cacheKey, eligible);
  return eligible;
}

function pickUniverseTemplateForSlotWithPolicy(
  family,
  systemID,
  slotIndex,
  rotationIndex,
  band,
  bandProfile,
  options: Record<string, any> = {},
) {
  const policyContext =
    options.policyContext ||
    buildTemplatePolicyContext(family, systemID, band);
  const policyOptions = options.policyOptions || {};
  const eligible = listPolicyEligibleTemplatesForBand(
    family,
    systemID,
    band,
    bandProfile,
    policyContext,
    policyOptions,
  );
  if (eligible.length <= 0) {
    return null;
  }
  const selectionValue = hashValue(
    (toInt(systemID, 0) * 4099) +
    (slotIndex * 131) +
    (Math.max(0, toInt(rotationIndex, 0)) * 17) +
    hashText(family),
  ) / 0x100000000;
  return pickWeightedTemplateCandidate(eligible, selectionValue);
}

function resolveTemplateSpawnFrequency(template) {
  const configured = Number(template && template.frontierDungeonSpawnFrequency);
  return Number.isFinite(configured) && configured > 0 ? configured : 1;
}

function pickWeightedTemplateCandidate(entries, selectionValue) {
  const candidates = Array.isArray(entries) ? entries : [];
  if (candidates.length <= 0) {
    return null;
  }
  const weights = candidates.map((entry) => resolveTemplateSpawnFrequency(
    entry && entry.template ? entry.template : entry,
  ));
  const totalWeight = weights.reduce((total, weight) => total + weight, 0);
  const numericSelection = Number(selectionValue);
  const normalizedSelection = Math.max(
    0,
    Math.min(
      1 - Number.EPSILON,
      Number.isFinite(numericSelection) ? numericSelection : 0,
    ),
  );
  const targetWeight = normalizedSelection * totalWeight;
  let cumulativeWeight = 0;
  for (let index = 0; index < candidates.length; index += 1) {
    cumulativeWeight += weights[index];
    if (targetWeight < cumulativeWeight) {
      return candidates[index];
    }
  }
  return candidates[candidates.length - 1] || null;
}

function pickRandomArrayIndex(length, rng = Math.random) {
  const size = Math.max(0, toInt(length, 0));
  if (size <= 0) {
    return -1;
  }
  const randomValue = Number(typeof rng === "function" ? rng() : Math.random());
  return Math.max(
    0,
    Math.min(size - 1, Math.floor((Number.isFinite(randomValue) ? randomValue : Math.random()) * size)),
  );
}

function pickRandomArrayEntry(entries, rng = Math.random) {
  const values = Array.isArray(entries) ? entries : [];
  const index = pickRandomArrayIndex(values.length, rng);
  if (index < 0) {
    return null;
  }
  return values[index] || values[0] || null;
}

function pickRandomUniverseTemplateForSlotWithPolicy(
  family,
  systemID,
  slotIndex,
  rotationIndex,
  band,
  bandProfile,
  options: Record<string, any> = {},
) {
  const policyContext =
    options.policyContext ||
    buildTemplatePolicyContext(family, systemID, band);
  const policyOptions = options.policyOptions || {};
  const eligible = listPolicyEligibleTemplatesForBand(
    family,
    systemID,
    band,
    bandProfile,
    policyContext,
    policyOptions,
  );
  if (eligible.length <= 0) {
    return null;
  }
  const randomValue = Number(
    typeof options.rng === "function" ? options.rng() : Math.random(),
  );
  return pickWeightedTemplateCandidate(
    eligible,
    Number.isFinite(randomValue) ? randomValue : Math.random(),
  ) || eligible[0] || null;
}

function systemMatchesSpawnBandProfile(systemID, family, bandProfile) {
  const slotsPerSystem = Math.max(0, toInt(bandProfile && bandProfile.slotsPerSystem, 0));
  if (slotsPerSystem <= 0) {
    return false;
  }
  const band = getSecurityBand(systemID);
  return listEligibleSystemIDsForBandProfile(family, band, bandProfile)
    .includes(Math.max(0, toInt(systemID, 0)));
}

function buildLightweightRoomStates(nowMs) {
  return {
    "room:entry": {
      roomKey: "room:entry",
      state: "active",
      stage: "entry",
      pocketID: null,
      nodeGraphID: null,
      activatedAtMs: nowMs,
      completedAtMs: 0,
      lastUpdatedAtMs: nowMs,
      spawnedEntityIDs: [],
      counters: {},
      metadata: {
        lightweight: true,
      },
    },
  };
}

function pickUniverseTemplateForSlot(family, systemID, slotIndex, rotationIndex, band, bandProfile) {
  const selection = pickUniverseTemplateForSlotWithPolicy(
    family,
    systemID,
    slotIndex,
    rotationIndex,
    band,
    bandProfile,
  );
  return selection && selection.template || null;
}

function buildUniverseSiteDefinition(template, family, systemID, slotIndex, options: Record<string, any> = {}) {
  if (!isUniverseSpawnEligibleTemplate(template)) {
    return null;
  }
  const spawnFamilyKey = normalizeLowerText(options.spawnFamilyKey, family);
  const siteID = buildUniverseSiteID(spawnFamilyKey, systemID, slotIndex);
  if (siteID <= 0) {
    return null;
  }
  const rotationIndex = Math.max(0, toInt(options.rotationIndex, 0));
  const startedAtMs = Math.max(0, toInt(options.startedAtMs, Date.now()));
  const lifetimeMs = Math.max(60_000, toInt(options.lifetimeMs, resolveSiteLifetimeMs(1440)));
  const band = normalizeLowerText(options.band, getSecurityBand(systemID));
  const siteKind = normalizeLowerText(template && template.siteKind, "signature");
  const providerID = getUniverseSiteProviderID(siteKind);
  const spawnFrequency = resolveTemplateSpawnFrequency(template);
  const placementDistanceAu = resolveTemplatePlacementDistanceAu(template);
  const separationLightSeconds = resolveTemplateSeparationLightSeconds(template);
  const placement = buildUniverseSitePlacement(
    systemID,
    spawnFamilyKey,
    slotIndex,
    rotationIndex,
    { placementDistanceAu },
  );
  const position = placement.position;
  const templateSiteFamily = normalizeLowerText(template && template.siteFamily, normalizeLowerText(family, "unknown"));
  const entryObjectTypeID = Math.max(
    0,
    toInt(
      template && template.entryObjectTypeID,
      siteKind === "anomaly" ? COSMIC_ANOMALY_TYPE_ID : COSMIC_SIGNATURE_TYPE_ID,
    ),
  ) || (siteKind === "anomaly" ? COSMIC_ANOMALY_TYPE_ID : COSMIC_SIGNATURE_TYPE_ID);
  const groupID = siteKind === "anomaly" ? COSMIC_ANOMALY_GROUP_ID : COSMIC_SIGNATURE_GROUP_ID;
  const label = normalizeText(options.label, resolveUniverseSiteLabel(template, spawnFamilyKey, slotIndex));
  const expiresAtMs = startedAtMs + lifetimeMs;
  const siteKey = dungeonSiteAdapter.buildSiteKey(providerID, systemID, siteID);
  const customMetadata = normalizeObject(options.metadata);
  const customSpawnState = normalizeObject(options.spawnState);
  const customRuntimeFlags = normalizeObject(options.runtimeFlags);
  const dungeonTags = [...new Set([
    ...(Array.isArray(template && template.frontierDungeonTags)
      ? template.frontierDungeonTags
      : Array.isArray(template && template.tags) ? template.tags : []),
    ...(Array.isArray(customMetadata.dungeonTags) ? customMetadata.dungeonTags : []),
    ...(Array.isArray(customSpawnState.dungeonTags) ? customSpawnState.dungeonTags : []),
  ].map((entry) => normalizeLowerText(entry, "")).filter(Boolean))];
  const dungeonFactionKey = normalizeLowerText(
    customMetadata.dungeonFactionKey ||
    customSpawnState.dungeonFactionKey ||
    (template && template.frontierFactionKey),
    "",
  ) || null;
  const dungeonFactionTag = normalizeLowerText(
    customMetadata.dungeonFactionTag ||
    customSpawnState.dungeonFactionTag ||
    (template && template.frontierFactionTag),
    "",
  ) || null;
  const siteOrigin = normalizeLowerText(
    options.siteOrigin,
    normalizeLowerText(
      dungeonAuthority.getSpawnProfile(spawnFamilyKey) &&
      dungeonAuthority.getSpawnProfile(spawnFamilyKey).siteOrigin,
      "universe_dungeon",
    ),
  );
  const spawnPolicy = dungeonSiteSpawnPolicy.buildSelectionMetadata(
    options.spawnPolicyEvaluation ||
    evaluateTemplateSpawnPolicy(
      template,
      spawnFamilyKey,
      systemID,
      band,
      options.policyContext || {},
      options.policyOptions || {},
    ),
  );
  const metadata = {
    providerID,
    definitionHash: JSON.stringify({
      family: templateSiteFamily,
      spawnFamilyKey,
      siteID,
      slotIndex,
      rotationIndex,
      templateID: template.templateID,
      siteKind,
      position: [
        Math.round(toFiniteNumber(position && position.x, 0)),
        Math.round(toFiniteNumber(position && position.y, 0)),
        Math.round(toFiniteNumber(position && position.z, 0)),
      ],
      anchorItemID: toInt(placement && placement.anchorItemID, 0),
      anchorDistanceMeters: Math.round(toFiniteNumber(placement && placement.anchorDistanceMeters, 0)),
      spawnFrequency,
      placementDistanceAu,
      separationLightSeconds,
      spawnPolicy,
      dungeonTags,
      dungeonFactionKey,
      dungeonFactionTag,
      templateContentHash: hashText(JSON.stringify({
        populationHints: cloneValue(template && template.populationHints || null),
        environmentTemplates: cloneValue(template && template.environmentTemplates || null),
        objectiveMetadata: cloneValue(template && template.objectiveMetadata || null),
        siteSceneProfile: cloneValue(template && template.siteSceneProfile || null),
      })),
      discriminator: cloneValue(options.definitionDiscriminator || null),
    }),
    siteID,
    slotIndex: Math.max(0, toInt(slotIndex, 0)),
    rotationIndex,
    spawnFamilyKey,
    securityBand: band,
    label,
    universeSeededAtMs: startedAtMs,
    anchorItemID: toInt(placement && placement.anchorItemID, 0) || null,
    anchorDistanceMeters: Math.round(toFiniteNumber(placement && placement.anchorDistanceMeters, 0)),
    anchorDistanceAu: Number(toFiniteNumber(placement && placement.anchorDistanceAu, 0).toFixed(3)),
    spawnPolicy,
    frontierDungeonSpawnConfigVersion:
      Math.max(0, toInt(template && template.frontierDungeonSpawnConfigVersion, 0)) || null,
    ...cloneValue(customMetadata),
    spawnFrequency,
    placementDistanceAu: cloneValue(placementDistanceAu),
    separationLightSeconds: cloneValue(separationLightSeconds),
    dungeonTags,
    dungeonFactionKey,
    dungeonFactionTag,
  };

  return {
    templateID: template.templateID,
    solarSystemID: toInt(systemID, 0),
    siteKey,
    lifecycleState: "active",
    instanceScope: "shared",
    siteFamily: templateSiteFamily,
    siteKind,
    siteOrigin,
    position,
    nowMs: startedAtMs,
    activatedAtMs: startedAtMs,
    expiresAtMs,
    roomStatesByKey: buildLightweightRoomStates(startedAtMs),
    gateStatesByKey: {},
    objectiveState: {
      state: "pending",
      currentNodeID: null,
      currentObjectiveID: null,
      completedObjectiveIDs: [],
      completedNodeIDs: [],
      counters: {},
      metadata: {
        lightweight: true,
      },
    },
    environmentState: {
      seededAtMs: startedAtMs,
      templateRef: template.templateID,
      lightweight: true,
    },
    spawnState: {
      siteID,
      slotIndex: Math.max(0, toInt(slotIndex, 0)),
      rotationIndex,
      spawnFamilyKey,
      label,
      groupID,
      entryObjectTypeID,
      securityBand: band,
      lifetimeMs,
      anchorItemID: toInt(placement && placement.anchorItemID, 0) || null,
      anchorDistanceMeters: Math.round(toFiniteNumber(placement && placement.anchorDistanceMeters, 0)),
      anchorDistanceAu: Number(toFiniteNumber(placement && placement.anchorDistanceAu, 0).toFixed(3)),
      populationHints: cloneValue(template && template.populationHints || null),
      spawnPolicy,
      ...cloneValue(customSpawnState),
      spawnFrequency,
      placementDistanceAu: cloneValue(placementDistanceAu),
      separationLightSeconds: cloneValue(separationLightSeconds),
      dungeonTags,
      dungeonFactionKey,
      dungeonFactionTag,
    },
    runtimeFlags: {
      universeSeeded: true,
      universePersistent: true,
      lazyMaterialized: true,
      ...cloneValue(customRuntimeFlags),
    },
    metadata,
  };
}

function squaredDistanceBetweenPositions(left, right) {
  const dx = toFiniteNumber(left && left.x, 0) - toFiniteNumber(right && right.x, 0);
  const dy = toFiniteNumber(left && left.y, 0) - toFiniteNumber(right && right.y, 0);
  const dz = toFiniteNumber(left && left.z, 0) - toFiniteNumber(right && right.z, 0);
  return (dx * dx) + (dy * dy) + (dz * dz);
}

function resolveDefinitionSeparationRange(definition) {
  return normalizeSiteSeparationLightSeconds(
    definition && definition.metadata && definition.metadata.separationLightSeconds ||
    definition && definition.spawnState && definition.spawnState.separationLightSeconds ||
    frontierDungeonSpawns.getConfig().defaults.siteSeparationLightSeconds,
  );
}

function resolveSelectedSeparationLightSeconds(definition, range = resolveDefinitionSeparationRange(definition)) {
  const normalizedRange = range || { min: 1, max: 10 };
  const existing = toFiniteNumber(
    definition && definition.metadata && definition.metadata.selectedSeparationLightSeconds,
    0,
  );
  if (existing >= normalizedRange.min && existing <= normalizedRange.max) {
    return existing;
  }
  const unit = hashText(
    `${normalizeText(definition && definition.siteKey, "unknown-site")}:separation-light-seconds`,
  ) / 0x100000000;
  return normalizedRange.min + ((normalizedRange.max - normalizedRange.min) * unit);
}

function applySeparationPlacement(definition, placement, range, selectedLightSeconds, attempt) {
  const position = clonePosition(placement && placement.position, definition && definition.position);
  const anchorItemID = toInt(
    placement && placement.anchorItemID,
    definition && definition.metadata && definition.metadata.anchorItemID,
  ) || null;
  const anchorDistanceMeters = Math.round(toFiniteNumber(
    placement && placement.anchorDistanceMeters,
    definition && definition.metadata && definition.metadata.anchorDistanceMeters,
  ));
  const anchorDistanceAu = Number(toFiniteNumber(
    placement && placement.anchorDistanceAu,
    definition && definition.metadata && definition.metadata.anchorDistanceAu,
  ).toFixed(3));
  const separationMetadata = {
    separationLightSeconds: cloneValue(range),
    selectedSeparationLightSeconds: Number(selectedLightSeconds.toFixed(3)),
    separationDistanceMeters: Math.round(selectedLightSeconds * dungeonSpawnEligibility.LIGHT_SECOND_METERS),
    separationPlacementAttempt: Math.max(0, toInt(attempt, 0)),
    separationSatisfied: true,
  };
  const metadata = {
    ...normalizeObject(definition && definition.metadata),
    anchorItemID,
    anchorDistanceMeters,
    anchorDistanceAu,
    ...separationMetadata,
  };
  try {
    const definitionHashPayload = JSON.parse(String(metadata.definitionHash || "{}"));
    metadata.definitionHash = JSON.stringify({
      ...definitionHashPayload,
      position: [
        Math.round(position.x),
        Math.round(position.y),
        Math.round(position.z),
      ],
      anchorItemID,
      anchorDistanceMeters,
      separationLightSeconds: cloneValue(range),
      selectedSeparationLightSeconds: separationMetadata.selectedSeparationLightSeconds,
      separationPlacementAttempt: separationMetadata.separationPlacementAttempt,
    });
  } catch (_) {
    // A malformed pre-existing hash should not prevent safe placement metadata.
  }
  return {
    ...definition,
    position,
    metadata,
    spawnState: {
      ...normalizeObject(definition && definition.spawnState),
      anchorItemID,
      anchorDistanceMeters,
      anchorDistanceAu,
      ...separationMetadata,
    },
  };
}

function enforceUniverseDungeonSiteSeparation(definitions, options: Record<string, any> = {}) {
  const accepted: any[] = [];
  const occupiedBySystem = new Map<any, any>();
  const addOccupied = (entry) => {
    const systemID = Math.max(0, toInt(entry && entry.solarSystemID, 0));
    if (systemID <= 0 || !entry || !entry.position) {
      return;
    }
    const range = resolveDefinitionSeparationRange(entry);
    const selectedLightSeconds = resolveSelectedSeparationLightSeconds(entry, range);
    if (!occupiedBySystem.has(systemID)) {
      occupiedBySystem.set(systemID, []);
    }
    occupiedBySystem.get(systemID).push({
      position: clonePosition(entry.position),
      selectedLightSeconds,
      siteKey: normalizeText(entry.siteKey, ""),
    });
  };
  for (const entry of Array.isArray(options.occupiedSites) ? options.occupiedSites : []) {
    addOccupied(entry);
  }

  for (const definition of Array.isArray(definitions) ? definitions : []) {
    const systemID = Math.max(0, toInt(definition && definition.solarSystemID, 0));
    const spawnFamilyKey = normalizeLowerText(
      definition && definition.metadata && definition.metadata.spawnFamilyKey,
      definition && definition.spawnState && definition.spawnState.spawnFamilyKey,
    );
    const slotIndex = Math.max(0, toInt(
      definition && definition.metadata && definition.metadata.slotIndex,
      definition && definition.spawnState && definition.spawnState.slotIndex,
    ));
    const rotationIndex = Math.max(0, toInt(
      definition && definition.metadata && definition.metadata.rotationIndex,
      definition && definition.spawnState && definition.spawnState.rotationIndex,
    ));
    const placementDistanceAu = normalizeSitePlacementDistanceAu(
      definition && definition.metadata && definition.metadata.placementDistanceAu ||
      definition && definition.spawnState && definition.spawnState.placementDistanceAu,
    );
    const range = resolveDefinitionSeparationRange(definition);
    const selectedLightSeconds = resolveSelectedSeparationLightSeconds(definition, range);
    const occupied = occupiedBySystem.get(systemID) || [];
    let acceptedPlacement = null;
    let acceptedAttempt = 0;
    for (let attempt = 0; attempt < MAX_DUNGEON_SITE_PLACEMENT_ATTEMPTS; attempt += 1) {
      const placement = attempt === 0
        ? {
          position: clonePosition(definition && definition.position),
          anchorItemID: definition && definition.metadata && definition.metadata.anchorItemID,
          anchorDistanceMeters: definition && definition.metadata && definition.metadata.anchorDistanceMeters,
          anchorDistanceAu: definition && definition.metadata && definition.metadata.anchorDistanceAu,
        }
        : buildUniverseSitePlacement(
          systemID,
          spawnFamilyKey,
          slotIndex,
          rotationIndex,
          { placementDistanceAu, placementAttempt: attempt },
        );
      const clear = occupied.every((other) => {
        const requiredLightSeconds = Math.max(
          selectedLightSeconds,
          toFiniteNumber(other && other.selectedLightSeconds, selectedLightSeconds),
        );
        const requiredMeters = requiredLightSeconds * dungeonSpawnEligibility.LIGHT_SECOND_METERS;
        return squaredDistanceBetweenPositions(placement.position, other.position) >=
          (requiredMeters * requiredMeters);
      });
      if (clear) {
        acceptedPlacement = placement;
        acceptedAttempt = attempt;
        break;
      }
    }
    if (!acceptedPlacement) {
      log.warn(
        `[DungeonUniverse] Skipped overlapping dungeon site ${normalizeText(definition && definition.siteKey, "unknown")} ` +
        `after ${MAX_DUNGEON_SITE_PLACEMENT_ATTEMPTS} placement attempts`,
      );
      continue;
    }
    const separatedDefinition = applySeparationPlacement(
      definition,
      acceptedPlacement,
      range,
      selectedLightSeconds,
      acceptedAttempt,
    );
    accepted.push(separatedDefinition);
    addOccupied(separatedDefinition);
  }
  return accepted;
}

function buildSovSpawnPolicyEvaluation(policyKey, upgradeCategory, sourceRefs, extra: Record<string, any> = {}) {
  const localPirateEvaluation = extra.localPirateEvaluation &&
    typeof extra.localPirateEvaluation === "object"
    ? extra.localPirateEvaluation
    : null;
  return {
    allowed: true,
    reason: normalizeText(
      localPirateEvaluation && localPirateEvaluation.reason,
      normalizeText(extra.reason, "allowed_by_online_sov_hub_upgrade"),
    ),
    policyKey,
    securityBand: "nullsec",
    siteFamily: normalizeLowerText(extra.siteFamily, ""),
    siteKind: normalizeLowerText(extra.siteKind, ""),
    requiredBands: ["nullsec"],
    requiredUpgradeCategory: upgradeCategory,
    localPirateFactionKey: normalizeLowerText(
      localPirateEvaluation && localPirateEvaluation.localPirateFactionKey,
      "",
    ) || null,
    localPirateFactionSource: normalizeLowerText(
      localPirateEvaluation && localPirateEvaluation.localPirateFactionSource,
      "",
    ) || null,
    localPirateFactionSpecialSpace:
      localPirateEvaluation && localPirateEvaluation.localPirateFactionSpecialSpace === true,
    templatePirateFactionKeys: Array.isArray(
      localPirateEvaluation && localPirateEvaluation.templatePirateFactionKeys,
    )
      ? [...localPirateEvaluation.templatePirateFactionKeys]
      : [],
    factionClassifierVersion: Math.max(
      0,
      toInt(localPirateEvaluation && localPirateEvaluation.factionClassifierVersion, 0),
    ),
    reviewedNeutralOverride:
      localPirateEvaluation && localPirateEvaluation.reviewedNeutralOverride === true,
    sourceRefs: [...new Set([
      ...(Array.isArray(sourceRefs) ? sourceRefs : []),
      ...(Array.isArray(localPirateEvaluation && localPirateEvaluation.sourceRefs)
        ? localPirateEvaluation.sourceRefs
        : []),
    ])],
    assumptions: [...new Set([
      ...(Array.isArray(extra.assumptions) ? extra.assumptions : []),
      ...(Array.isArray(localPirateEvaluation && localPirateEvaluation.assumptions)
        ? localPirateEvaluation.assumptions
        : []),
    ])],
    tags: [
      "sov_hub",
      "guaranteed",
      ...(Array.isArray(extra.tags) ? extra.tags : []),
      ...(Array.isArray(localPirateEvaluation && localPirateEvaluation.tags)
        ? localPirateEvaluation.tags
        : []),
    ],
  };
}

function buildSovGuaranteedDefinition(
  template,
  spawnFamilyKey,
  targetSystemID,
  slotIndex,
  nowMs,
  sovHub,
  options: Record<string, any> = {},
) {
  if (!template || !template.templateID || !sovHub) {
    return null;
  }
  const band = getSecurityBand(targetSystemID);
  if (band !== "nullsec") {
    return null;
  }
  const rotationIndex = Math.max(0, toInt(options.rotationIndex, 0));
  const sourceRefs = Array.isArray(sovHub.sourceRefs)
    ? [...sovHub.sourceRefs]
    : ["ccpSovHub"];
  return buildUniverseSiteDefinition(template, spawnFamilyKey, targetSystemID, slotIndex, {
    spawnFamilyKey,
    rotationIndex,
    startedAtMs: Math.max(0, toInt(nowMs, Date.now())),
    lifetimeMs: resolveSiteLifetimeMs(options.siteLifetimeMinutes || 1440),
    band,
    siteOrigin: SOV_GUARANTEED_SITE_ORIGIN,
    label: normalizeText(options.label, normalizeText(template.resolvedName, template.name)),
    policyContext: options.policyContext,
    spawnPolicyEvaluation: buildSovSpawnPolicyEvaluation(
      normalizeText(options.policyKey, `${spawnFamilyKey}_guaranteed`),
      normalizeText(sovHub.upgradeCategory, ""),
      sourceRefs,
      {
        siteFamily: template.siteFamily,
        siteKind: template.siteKind,
        tags: options.tags,
        assumptions: options.assumptions,
        localPirateEvaluation: options.localPirateEvaluation,
      },
    ),
    metadata: {
      sovHub: cloneValue(sovHub),
      sourceRefs,
    },
    spawnState: {
      sovHub: cloneValue(sovHub),
    },
    runtimeFlags: {
      sovereigntyGuaranteed: true,
    },
    definitionDiscriminator: {
      sovHub,
      rotationIndex,
    },
  });
}

function allocateSovSlotIndex(slotAllocations, spawnFamilyKey, targetSystemID) {
  const key = `${normalizeLowerText(spawnFamilyKey, "")}:${toInt(targetSystemID, 0)}`;
  const nextIndex = Math.max(0, toInt(slotAllocations.get(key), 0));
  slotAllocations.set(key, nextIndex + 1);
  return nextIndex;
}

function getSovSlotKey(spawnFamilyKey, targetSystemID, slotIndex) {
  return [
    normalizeLowerText(spawnFamilyKey, ""),
    Math.max(0, toInt(targetSystemID, 0)),
    Math.max(0, toInt(slotIndex, 0)),
  ].join(":");
}

function resolveDesiredSovSlotRotationIndex(
  options,
  spawnFamilyKey,
  targetSystemID,
  slotIndex,
) {
  const existingRotationBySlot = options && options.existingRotationBySlot instanceof Map
    ? options.existingRotationBySlot
    : null;
  const slotKey = getSovSlotKey(spawnFamilyKey, targetSystemID, slotIndex);
  if (existingRotationBySlot && existingRotationBySlot.has(slotKey)) {
    return Math.max(0, toInt(existingRotationBySlot.get(slotKey), 0));
  }
  return Math.max(0, toInt(options && options.rotationIndex, 0));
}

function buildThreatDetectionDefinitionsForSystem(systemID, context, nowMs, slotAllocations, options: Record<string, any> = {}) {
  const definitions: any[] = [];
  const normalizedContext = dungeonSiteSpawnPolicy.normalizePolicyContext(context);
  if (
    normalizedContext.sovereignty.hasSovereignty !== true ||
    !normalizedContext.sovereignty.hubID ||
    getSecurityBand(systemID) !== "nullsec"
  ) {
    return definitions;
  }

  const bracket = resolveThreatDetectionSecurityBracket(systemID);
  const upgrades = listParsedOnlineUpgrades(normalizedContext, parseThreatDetectionUpgrade);
  for (const upgrade of upgrades) {
    const entries = bracket && bracket[upgrade.kind] && bracket[upgrade.kind][upgrade.tier]
      ? bracket[upgrade.kind][upgrade.tier]
      : [];
    const slots = expandSlotCounts(entries);
    for (const slot of slots) {
      const slotIndex = allocateSovSlotIndex(slotAllocations, "sov_threat_detection", systemID);
      const rotationIndex = resolveDesiredSovSlotRotationIndex(
        options,
        "sov_threat_detection",
        systemID,
        slotIndex,
      );
      const template = pickDeterministicTemplate(
        listCombatAnomalyTemplatesForLabel(slot.label, {
          systemID,
          band: "nullsec",
          spawnFamilyKey: "sov_threat_detection",
          policyContext: normalizedContext,
          policyOptions: options.policyOptions,
        }),
        `sov-threat:${systemID}:${upgrade.kind}:${upgrade.tier}:${slot.label}:${slot.occurrence}:${rotationIndex}`,
      );
      if (!template) {
        continue;
      }
      const localPirateEvaluation = evaluateTemplateSpawnPolicy(
        template,
        "sov_threat_detection",
        systemID,
        "nullsec",
        normalizedContext,
        options.policyOptions || {},
      );
      if (!localPirateEvaluation || localPirateEvaluation.allowed === false) {
        continue;
      }
      const sovHub = {
        provider: "sov_hub",
        upgradeCategory: "threat_detection",
        upgradeKind: upgrade.kind,
        upgradeTier: upgrade.tier,
        upgradeTypeID: toInt(upgrade.upgrade && upgrade.upgrade.typeID, 0) || null,
        upgradeName: normalizeText(upgrade.upgrade && upgrade.upgrade.name, ""),
        sourceSystemID: systemID,
        sourceHubID: normalizedContext.sovereignty.hubID,
        targetSystemID: systemID,
        jumpsFromSource: 0,
        ccpSecurityBracket: bracket && bracket.key,
        ccpSiteLabel: slot.label,
        ccpSlotOccurrence: slot.occurrence,
        sourceRefs: ["ccpSovHubCombatAnomalies"],
      };
      const definition = buildSovGuaranteedDefinition(
        template,
        "sov_threat_detection",
        systemID,
        slotIndex,
        nowMs,
        sovHub,
        {
          rotationIndex,
          policyKey: "sov_threat_detection_guaranteed",
          label: normalizeText(template.resolvedName, slot.label),
          tags: ["threat_detection"],
          policyContext: normalizedContext,
          localPirateEvaluation,
        },
      );
      if (definition) {
        definitions.push(definition);
      }
    }
  }
  return definitions;
}

function buildProspectingDefinitionsForSystem(systemID, context, nowMs, slotAllocations, options: Record<string, any> = {}) {
  const definitions: any[] = [];
  const normalizedContext = dungeonSiteSpawnPolicy.normalizePolicyContext(context);
  if (
    normalizedContext.sovereignty.hasSovereignty !== true ||
    !normalizedContext.sovereignty.hubID ||
    getSecurityBand(systemID) !== "nullsec"
  ) {
    return definitions;
  }

  const upgrades = listParsedOnlineUpgrades(normalizedContext, parseProspectingUpgrade);
  for (const upgrade of upgrades) {
    const slotIndex = allocateSovSlotIndex(slotAllocations, "sov_prospecting", systemID);
    const rotationIndex = resolveDesiredSovSlotRotationIndex(
      options,
      "sov_prospecting",
      systemID,
      slotIndex,
    );
    const template = pickDeterministicTemplate(
      listProspectingOreTemplates(upgrade.mineral, upgrade.tier),
      `sov-prospecting:${systemID}:${upgrade.mineral}:${upgrade.tier}:${rotationIndex}`,
    );
    if (!template) {
      continue;
    }
    const sovHub = {
      provider: "sov_hub",
      upgradeCategory: "prospecting",
      mineral: upgrade.mineral,
      upgradeTier: upgrade.tier,
      upgradeTypeID: toInt(upgrade.upgrade && upgrade.upgrade.typeID, 0) || null,
      upgradeName: normalizeText(upgrade.upgrade && upgrade.upgrade.name, ""),
      sourceSystemID: systemID,
      sourceHubID: normalizedContext.sovereignty.hubID,
      targetSystemID: systemID,
      jumpsFromSource: 0,
      sourceRefs: ["ccpSovHub", "ccpEquinoxSovUpdates"],
    };
    const definition = buildSovGuaranteedDefinition(
      template,
      "sov_prospecting",
      systemID,
      slotIndex,
      nowMs,
      sovHub,
      {
        rotationIndex,
        policyKey: "sov_prospecting_guaranteed",
        label: normalizeText(template.resolvedName, `${upgrade.mineral} Prospecting Site`),
        tags: ["prospecting"],
        assumptions: [
          "CCP publishes prospecting upgrade categories; the emulator maps each online mineral prospecting upgrade to one active ore anomaly slot.",
        ],
      },
    );
    if (definition) {
      definitions.push(definition);
    }
  }
  return definitions;
}

function listSovereigntySourceSystemIDs() {
  try {
    return sovState.listAllAllianceSystems()
      .map((entry) => toInt(entry && entry.solarSystemID, 0))
      .filter((entry) => entry > 0)
      .sort((left, right) => left - right);
  } catch (_) {
    return [];
  }
}

function pickExplorationDetectorTarget(sourceSystemID, tier, slotOrdinal) {
  const candidates = listSystemsWithinJumps(sourceSystemID, 5);
  if (candidates.length <= 0) {
    return null;
  }
  const offset = hashValue(
    (sourceSystemID * 6151) +
    (Math.max(1, toInt(tier, 1)) * 313) +
    (Math.max(0, toInt(slotOrdinal, 0)) * 37),
  ) % candidates.length;
  return candidates[offset] || candidates[0] || null;
}

function pickExplorationDetectorTemplate(
  family,
  sourceSystemID,
  targetSystemID,
  tier,
  slotOrdinal,
  rotationIndex,
  policyOptions: Record<string, any> = {},
) {
  const band = getSecurityBand(targetSystemID);
  const policyContext = buildTemplatePolicyContext(family, targetSystemID, band);
  const candidates = dungeonAuthority
    .listTemplatesByFamily(family)
    .filter((template) => isUniverseSpawnEligibleTemplate(template))
    .filter((template) => normalizeLowerText(template && template.siteKind, "") === "signature")
    .filter((template) => {
      const evaluation = evaluateTemplateSpawnPolicy(
        template,
        family,
        targetSystemID,
        band,
        policyContext,
        policyOptions,
      );
      return evaluation && evaluation.allowed !== false;
    })
    .sort((left, right) => (
      toInt(left && left.sourceDungeonID, Number.MAX_SAFE_INTEGER) -
      toInt(right && right.sourceDungeonID, Number.MAX_SAFE_INTEGER)
    ) || String(left && left.templateID || "").localeCompare(String(right && right.templateID || "")));
  return pickDeterministicTemplate(
    candidates,
    `sov-exploration:${sourceSystemID}:${targetSystemID}:${family}:${tier}:${slotOrdinal}:${rotationIndex || 0}`,
  );
}

function buildExplorationDetectorDefinitions(targetSystemIDs, nowMs, slotAllocations, options: Record<string, any> = {}) {
  const targetSet = new Set<any>(normalizeSystemIDs(targetSystemIDs));
  const definitions: any[] = [];
  for (const sourceSystemID of listSovereigntySourceSystemIDs()) {
    const context = dungeonSiteSpawnPolicy.buildRuntimeSystemPolicyContext(sourceSystemID, {
      securityBand: getSecurityBand(sourceSystemID),
    });
    const normalizedContext = dungeonSiteSpawnPolicy.normalizePolicyContext(context);
    if (
      normalizedContext.sovereignty.hasSovereignty !== true ||
      !normalizedContext.sovereignty.hubID ||
      getSecurityBand(sourceSystemID) !== "nullsec"
    ) {
      continue;
    }
    const upgrades = listParsedOnlineUpgrades(normalizedContext, parseExplorationDetectorUpgrade);
    for (const upgrade of upgrades) {
      const slotCount = Math.max(1, Math.min(3, upgrade.tier));
      for (let slotOrdinal = 0; slotOrdinal < slotCount; slotOrdinal += 1) {
        const target = pickExplorationDetectorTarget(sourceSystemID, upgrade.tier, slotOrdinal);
        if (!target || !targetSet.has(target.systemID)) {
          continue;
        }
        const family = EXPLORATION_DETECTOR_FAMILY_SEQUENCE[
          slotOrdinal % EXPLORATION_DETECTOR_FAMILY_SEQUENCE.length
        ];
        const slotIndex = allocateSovSlotIndex(
          slotAllocations,
          "sov_exploration_detector",
          target.systemID,
        );
        const rotationIndex = resolveDesiredSovSlotRotationIndex(
          options,
          "sov_exploration_detector",
          target.systemID,
          slotIndex,
        );
        const template = pickExplorationDetectorTemplate(
          family,
          sourceSystemID,
          target.systemID,
          upgrade.tier,
          slotOrdinal,
          rotationIndex,
          options.policyOptions || {},
        );
        if (!template) {
          continue;
        }
        const targetBand = getSecurityBand(target.systemID);
        const targetPolicyContext = buildTemplatePolicyContext(
          family,
          target.systemID,
          targetBand,
        );
        const localPirateEvaluation = evaluateTemplateSpawnPolicy(
          template,
          family,
          target.systemID,
          targetBand,
          targetPolicyContext,
          options.policyOptions || {},
        );
        if (!localPirateEvaluation || localPirateEvaluation.allowed === false) {
          continue;
        }
        const sovHub = {
          provider: "sov_hub",
          upgradeCategory: "exploration_detector",
          upgradeTier: upgrade.tier,
          upgradeTypeID: toInt(upgrade.upgrade && upgrade.upgrade.typeID, 0) || null,
          upgradeName: normalizeText(upgrade.upgrade && upgrade.upgrade.name, ""),
          sourceSystemID,
          sourceHubID: normalizedContext.sovereignty.hubID,
          targetSystemID: target.systemID,
          jumpsFromSource: target.jumps,
          detectorSlotOrdinal: slotOrdinal,
          sourceRefs: ["ccpSovHub", "ccpEquinoxSovUpdates"],
        };
        const definition = buildSovGuaranteedDefinition(
          template,
          "sov_exploration_detector",
          target.systemID,
          slotIndex,
          nowMs,
          sovHub,
          {
            rotationIndex,
            policyKey: "sov_exploration_detector_guaranteed",
            label: normalizeText(template.resolvedName, "Exploration Detector Signature"),
            tags: ["exploration_detector"],
            assumptions: [
              "CCP documents Exploration Detector effects within zero to five jumps; target systems are deterministic within that range.",
            ],
            policyContext: targetPolicyContext,
            localPirateEvaluation,
          },
        );
        if (definition) {
          definitions.push(definition);
        }
      }
    }
  }
  return definitions;
}

function summarizeSovDefinitions(definitions, families) {
  for (const definition of definitions) {
    const family = normalizeLowerText(
      definition && definition.metadata && definition.metadata.spawnFamilyKey,
      normalizeLowerText(definition && definition.spawnState && definition.spawnState.spawnFamilyKey, ""),
    );
    if (!family) {
      continue;
    }
    if (!families[family]) {
      families[family] = {
        desiredSiteCount: 0,
        systemsTouched: 0,
        templateCount: 0,
      };
    }
    families[family].desiredSiteCount += 1;
  }
  for (const family of Object.keys(families)) {
    const systems = new Set<any>(definitions
      .filter((definition) => (
        normalizeLowerText(definition && definition.metadata && definition.metadata.spawnFamilyKey, "") === family
      ))
      .map((definition) => toInt(definition && definition.solarSystemID, 0))
      .filter((entry) => entry > 0));
    families[family].systemsTouched = systems.size;
  }
}

function listRandomAllocationCandidateSystemIDs(family, band, bandProfile) {
  return filterSystemIDsByScopedSelector(
    listSystemIDsByBand(band),
    buildScopedSystemSelector(family, bandProfile),
  );
}

function getInstanceSpawnFamilyKey(instance) {
  return normalizeLowerText(
    instance && instance.metadata && instance.metadata.spawnFamilyKey,
    normalizeLowerText(instance && instance.spawnState && instance.spawnState.spawnFamilyKey, instance && instance.siteFamily),
  );
}

function getInstanceSlotIndex(instance) {
  return Math.max(
    0,
    toInt(
      instance && instance.metadata && instance.metadata.slotIndex,
      instance && instance.spawnState && instance.spawnState.slotIndex,
    ),
  );
}

function getInstanceRotationIndex(instance) {
  return Math.max(
    0,
    toInt(
      instance && instance.metadata && instance.metadata.rotationIndex,
      instance && instance.spawnState && instance.spawnState.rotationIndex,
    ),
  );
}

function bandProfileUsesRandomAllocation(family, band, bandProfile) {
  const profile = dungeonAuthority.getSpawnProfile(family);
  if (
    resolveProfileAllocationMode(family, bandProfile) !== "random" ||
    !profile ||
    profile.enabled === false ||
    profile.persistent === false ||
    normalizeLowerText(profile.siteOrigin, "universe_dungeon") !== "universe_dungeon" ||
    isSovereigntyGuaranteedSpawnFamily(family)
  ) {
    return false;
  }
  const slotsPerSystem = Math.max(0, toInt(bandProfile && bandProfile.slotsPerSystem, 0));
  if (slotsPerSystem <= 0) {
    return false;
  }
  const candidates = listRandomAllocationCandidateSystemIDs(family, band, bandProfile);
  return resolveBandTargetSystemCount(candidates.length, bandProfile) > 0;
}

function isRandomAllocatedUniverseFamily(family) {
  const profile = dungeonAuthority.getSpawnProfile(family);
  if (!profile || profile.enabled === false || profile.persistent === false) {
    return false;
  }
  return ["highsec", "lowsec", "nullsec", "wormhole"].some((band) => {
    const bandProfile = profile.bands && profile.bands[band];
    return bandProfile && bandProfileUsesRandomAllocation(family, band, bandProfile);
  });
}

function isWakeAllocatedUniverseFamily(family) {
  if (WAKE_ALLOCATED_UNIVERSE_FAMILIES.has(normalizeLowerText(family, ""))) {
    return true;
  }
  const profile = dungeonAuthority.getSpawnProfile(family);
  return Boolean(profile && ["highsec", "lowsec", "nullsec", "wormhole"].some((band) => {
    const allocationMode = resolveProfileAllocationMode(
      family,
      profile.bands && profile.bands[band],
    );
    return allocationMode === "baseline" || allocationMode === "random";
  }));
}

function getRandomAllocationRng(options: Record<string, any> = {}) {
  return typeof options.rng === "function" ? options.rng : Math.random;
}

function chooseRandomSystemIDs(systemIDs, count, rng = Math.random) {
  const remaining = normalizeIntegerArray(systemIDs);
  const target = Math.max(0, Math.min(remaining.length, toInt(count, 0)));
  const picked: any[] = [];
  while (picked.length < target && remaining.length > 0) {
    const index = pickRandomArrayIndex(remaining.length, rng);
    if (index < 0) {
      break;
    }
    const entry = remaining[index];
    picked.push(entry);
    const last = remaining.pop();
    if (index < remaining.length) {
      remaining[index] = last;
    }
  }
  return picked.sort((left, right) => left - right);
}

function listStableWakeAllocationCandidateSystemIDs(family, band, bandProfile) {
  const cacheKey = `${SYSTEM_WAKE_ALLOCATION_VERSION}:${buildBandProfileCacheKey(
    family,
    band,
    bandProfile,
  )}`;
  if (!stableWakeCandidateRankingsByFamilyBand.has(cacheKey)) {
    const ranked = listRandomAllocationCandidateSystemIDs(family, band, bandProfile)
      .map((systemID) => ({
        systemID,
        score: hashText(
          `${SYSTEM_WAKE_ALLOCATION_VERSION}:${normalizeLowerText(family, "")}:` +
          `${normalizeSecurityBand(band)}:${systemID}`,
        ),
      }))
      .sort((left, right) => (
        left.score - right.score
      ) || (
        left.systemID - right.systemID
      ))
      .map((entry) => entry.systemID);
    stableWakeCandidateRankingsByFamilyBand.set(cacheKey, ranked);
  }
  return [...stableWakeCandidateRankingsByFamilyBand.get(cacheKey)];
}

function listActiveRandomAllocatedInstances(
  family,
  band,
  candidateSystemIDs,
  activeInstances = null,
) {
  const candidateSet = new Set<any>(normalizeSystemIDs(candidateSystemIDs));
  const sourceInstances = Array.isArray(activeInstances)
    ? activeInstances
    : listUniverseSeededPersistentSiteInstances();
  return sourceInstances
    .filter((instance) => (
      normalizeLowerText(instance && instance.siteOrigin, "") === "universe_dungeon" &&
      getInstanceSpawnFamilyKey(instance) === normalizeLowerText(family, "") &&
      getSecurityBand(instance && instance.solarSystemID) === normalizeSecurityBand(band) &&
      candidateSet.has(Math.max(0, toInt(instance && instance.solarSystemID, 0)))
    ))
    .sort((left, right) => (
      Math.max(0, toInt(left && left.instanceID, 0)) -
      Math.max(0, toInt(right && right.instanceID, 0))
    ));
}

function buildRandomAllocatedDefinitionForSlot(
  family,
  band,
  bandProfile,
  systemID,
  slotIndex,
  nowMs,
  options: Record<string, any> = {},
) {
  const rng = getRandomAllocationRng(options);
  const existing = options.existingInstance || null;
  const rotationIndex = existing
    ? getInstanceRotationIndex(existing)
    : Math.max(0, toInt(options.rotationIndex, 0));
  const policyContext = buildTemplatePolicyContext(family, systemID, band);
  let template = null;
  let evaluation = null;
  let rejectedExistingTemplateID = null;

  if (existing && existing.templateID) {
    template = dungeonAuthority.getTemplateByID(existing.templateID);
    if (!template || !isUniverseSpawnEligibleTemplate(template)) {
      rejectedExistingTemplateID = normalizeText(existing.templateID, "") || null;
      template = null;
    }
    if (template) {
      evaluation = evaluateTemplateSpawnPolicy(
        template,
        family,
        systemID,
        band,
        policyContext,
        options.policyOptions || {},
      );
      if (evaluation && evaluation.allowed === false) {
        template = null;
        evaluation = null;
      }
    }
  }

  if (!template) {
    const selection = pickRandomUniverseTemplateForSlotWithPolicy(
      family,
      systemID,
      slotIndex,
      rotationIndex,
      band,
      bandProfile,
      {
        policyContext,
        policyOptions: options.policyOptions,
        rng,
      },
    );
    template = selection && selection.template || null;
    evaluation = selection && selection.evaluation || null;
  }

  if (!template) {
    return null;
  }
  const profile = dungeonAuthority.getSpawnProfile(family) || {};
  return buildUniverseSiteDefinition(template, family, systemID, slotIndex, {
    rotationIndex,
    startedAtMs: Math.max(0, toInt(nowMs, Date.now())),
    lifetimeMs: resolveSiteLifetimeMs(profile.siteLifetimeMinutes),
    band,
    policyContext,
    spawnPolicyEvaluation: evaluation,
    metadata: {
      allocationMode: "random",
      allocationVersion: RANDOM_UNIVERSE_ALLOCATION_VERSION,
      ...(rejectedExistingTemplateID
        ? { replaceUniverseTemplateID: rejectedExistingTemplateID }
        : {}),
    },
    spawnState: {
      allocationMode: "random",
    },
    definitionDiscriminator: {
      allocationMode: "random",
      allocationVersion: RANDOM_UNIVERSE_ALLOCATION_VERSION,
    },
  });
}

function buildRandomAllocatedSystemPlanForBand(
  family,
  band,
  bandProfile,
  options: Record<string, any> = {},
) {
  const candidateSystemIDs = listRandomAllocationCandidateSystemIDs(family, band, bandProfile);
  const targetSystemCount = resolveBandTargetSystemCount(candidateSystemIDs.length, bandProfile);
  const slotsPerSystem = Math.max(0, toInt(bandProfile && bandProfile.slotsPerSystem, 0));
  if (targetSystemCount <= 0 || slotsPerSystem <= 0) {
    return {
      random: false,
      targetSystemCount: 0,
      candidateSystemCount: candidateSystemIDs.length,
      slotsPerSystem,
      existingBySystem: new Map(),
      allocatedSystemIDs: [],
    };
  }

  const candidateSet = new Set<any>(candidateSystemIDs);
  const activeInstances = listActiveRandomAllocatedInstances(
    family,
    band,
    candidateSystemIDs,
    options.activeInstances,
  );
  const existingBySystem = new Map();
  for (const instance of activeInstances) {
    const systemID = Math.max(0, toInt(instance && instance.solarSystemID, 0));
    const slotIndex = getInstanceSlotIndex(instance);
    if (!candidateSet.has(systemID) || slotIndex >= slotsPerSystem) {
      continue;
    }
    if (!existingBySystem.has(systemID)) {
      existingBySystem.set(systemID, new Map());
    }
    const bySlot = existingBySystem.get(systemID);
    if (!bySlot.has(slotIndex)) {
      bySlot.set(slotIndex, instance);
    }
  }

  const retainedSystemIDs = [...existingBySystem.keys()]
    .sort((left, right) => {
      const leftFirst = Math.min(
        ...[...existingBySystem.get(left).values()].map((entry) => Math.max(0, toInt(entry && entry.instanceID, 0))),
      );
      const rightFirst = Math.min(
        ...[...existingBySystem.get(right).values()].map((entry) => Math.max(0, toInt(entry && entry.instanceID, 0))),
      );
      return (leftFirst - rightFirst) || (left - right);
    })
    .slice(0, targetSystemCount);
  const retainedSet = new Set(retainedSystemIDs);
  const remainingAllocationCount = Math.max(0, targetSystemCount - retainedSystemIDs.length);
  const configuredAllocation = options.allocatedSystemIDsByBand &&
    Array.isArray(options.allocatedSystemIDsByBand[band])
    ? normalizeIntegerArray(options.allocatedSystemIDsByBand[band])
      .filter((systemID) => candidateSet.has(systemID))
      .filter((systemID) => !retainedSet.has(systemID))
      .slice(0, remainingAllocationCount)
    : [];
  const configuredSet = new Set(configuredAllocation);
  const remainingCandidates = candidateSystemIDs.filter((systemID) => (
    !retainedSet.has(systemID) && !configuredSet.has(systemID)
  ));
  const fallbackCount = Math.max(0, remainingAllocationCount - configuredAllocation.length);
  const fallbackSystemIDs = typeof options.rng === "function"
    ? chooseRandomSystemIDs(remainingCandidates, fallbackCount, options.rng)
    : listStableWakeAllocationCandidateSystemIDs(family, band, bandProfile)
      .filter((systemID) => (
        !retainedSet.has(systemID) && !configuredSet.has(systemID)
      ))
      .slice(0, fallbackCount);
  const allocatedSystemIDs = [
    ...retainedSystemIDs,
    ...configuredAllocation,
    ...fallbackSystemIDs,
  ]
    .sort((left, right) => left - right);
  return {
    random: true,
    targetSystemCount,
    candidateSystemCount: candidateSystemIDs.length,
    slotsPerSystem,
    existingBySystem,
    allocatedSystemIDs,
  };
}

function buildRandomAllocatedUniverseDefinitionsForBand(
  family,
  band,
  bandProfile,
  systemIDs,
  nowMs,
  options: Record<string, any> = {},
) {
  const plan = buildRandomAllocatedSystemPlanForBand(family, band, bandProfile, options);
  if (!plan.random) {
    return {
      ...plan,
      definitions: [],
    };
  }
  const targetedSystemIDs = new Set<any>(normalizeSystemIDs(systemIDs));
  const allocatedSet = new Set(plan.allocatedSystemIDs);
  const definitions: any[] = [];
  for (const systemID of plan.allocatedSystemIDs) {
    if (getSecurityBand(systemID) !== normalizeSecurityBand(band)) {
      continue;
    }
    if (targetedSystemIDs.size > 0 && !targetedSystemIDs.has(systemID)) {
      continue;
    }
    const bySlot = plan.existingBySystem.get(systemID) || new Map();
    for (let slotIndex = 0; slotIndex < plan.slotsPerSystem; slotIndex += 1) {
      const definition = buildRandomAllocatedDefinitionForSlot(
        family,
        band,
        bandProfile,
        systemID,
        slotIndex,
        nowMs,
        {
          ...options,
          existingInstance: bySlot.get(slotIndex) || null,
        },
      );
      if (definition) {
        definitions.push(definition);
      }
    }
  }

  return {
    random: true,
    definitions,
    targetSystemCount: plan.targetSystemCount,
    candidateSystemCount: plan.candidateSystemCount,
    allocatedSystemCount: allocatedSet.size,
    allocatedSystemIDs: plan.allocatedSystemIDs,
  };
}

function chooseRandomRespawnSystemID(family, band, bandProfile, previousSystemID, options: Record<string, any> = {}) {
  const candidateSystemIDs = listRandomAllocationCandidateSystemIDs(family, band, bandProfile);
  if (candidateSystemIDs.length <= 0) {
    return 0;
  }
  const activeSystemIDs = new Set(
    listActiveRandomAllocatedInstances(family, band, candidateSystemIDs)
      .map((instance) => Math.max(0, toInt(instance && instance.solarSystemID, 0)))
      .filter((systemID) => systemID > 0),
  );
  let candidates = candidateSystemIDs.filter((systemID) => !activeSystemIDs.has(systemID));
  if (candidates.length > 1) {
    candidates = candidates.filter((systemID) => systemID !== previousSystemID);
  }
  if (candidates.length <= 0) {
    candidates = candidateSystemIDs;
  }
  return pickRandomArrayEntry(candidates, getRandomAllocationRng(options)) || 0;
}

function buildExistingSovRotationBySlot(systemIDs) {
  const rotations = new Map();
  const instanceIDsBySlot = new Map();
  for (const instance of listUniverseSeededPersistentSiteInstances(systemIDs)) {
    if (normalizeLowerText(instance && instance.siteOrigin, "") !== SOV_GUARANTEED_SITE_ORIGIN) {
      continue;
    }
    const spawnFamilyKey = getInstanceSpawnFamilyKey(instance);
    if (!isSovereigntyGuaranteedSpawnFamily(spawnFamilyKey)) {
      continue;
    }
    const systemID = Math.max(0, toInt(instance && instance.solarSystemID, 0));
    const slotIndex = getInstanceSlotIndex(instance);
    const slotKey = getSovSlotKey(spawnFamilyKey, systemID, slotIndex);
    const instanceID = Math.max(0, toInt(instance && instance.instanceID, 0));
    if (
      instanceIDsBySlot.has(slotKey) &&
      instanceIDsBySlot.get(slotKey) <= instanceID
    ) {
      continue;
    }
    instanceIDsBySlot.set(slotKey, instanceID);
    rotations.set(slotKey, getInstanceRotationIndex(instance));
  }
  return rotations;
}

function listDesiredSovereigntyDungeonSiteDefinitions(systemIDs = null, nowMs = Date.now(), options: Record<string, any> = {}) {
  const targetSystemIDs = normalizeSystemIDs(systemIDs);
  const familyFilter = new Set((Array.isArray(options.families) ? options.families : [])
    .map((entry) => normalizeLowerText(entry, ""))
    .filter(Boolean));
  const includeFamily = (family) => familyFilter.size <= 0 || familyFilter.has(family);
  const definitions: any[] = [];
  const families: Record<string, any> = {};
  const slotAllocations = new Map();
  const sovOptions = {
    ...options,
    existingRotationBySlot: options.existingRotationBySlot instanceof Map
      ? options.existingRotationBySlot
      : buildExistingSovRotationBySlot(targetSystemIDs),
  };

  if (includeFamily("sov_threat_detection") || includeFamily("sov_prospecting")) {
    for (const systemID of targetSystemIDs) {
      if (getSecurityBand(systemID) !== "nullsec") {
        continue;
      }
      const context = dungeonSiteSpawnPolicy.buildRuntimeSystemPolicyContext(systemID, {
        securityBand: "nullsec",
      });
      if (includeFamily("sov_threat_detection")) {
        definitions.push(...buildThreatDetectionDefinitionsForSystem(
          systemID,
          context,
          nowMs,
          slotAllocations,
          sovOptions,
        ));
      }
      if (includeFamily("sov_prospecting")) {
        definitions.push(...buildProspectingDefinitionsForSystem(
          systemID,
          context,
          nowMs,
          slotAllocations,
          sovOptions,
        ));
      }
    }
  }

  if (includeFamily("sov_exploration_detector")) {
    definitions.push(...buildExplorationDetectorDefinitions(
      targetSystemIDs,
      nowMs,
      slotAllocations,
      sovOptions,
    ));
  }

  summarizeSovDefinitions(definitions, families);
  return {
    definitions,
    families,
  };
}

function listDesiredUniverseDungeonSiteDefinitions(systemIDs = null, nowMs = Date.now(), options: Record<string, any> = {}) {
  const definitions: any[] = [];
  const familyFilter = new Set((Array.isArray(options.families) ? options.families : [])
    .map((entry) => normalizeLowerText(entry, ""))
    .filter(Boolean));
  const families = dungeonAuthority.listUniverseSpawnFamilies()
    .filter((family) => familyFilter.size <= 0 || familyFilter.has(normalizeLowerText(family, "")));
  const allSystemIDs = normalizeSystemIDs(systemIDs);
  const familySummaries: Record<string, any> = {};
  const existingNonRandomBySlot = new Map();

  for (const instance of listUniverseSeededPersistentSiteInstances(allSystemIDs)) {
    if (normalizeLowerText(instance && instance.siteOrigin, "") !== "universe_dungeon") {
      continue;
    }
    const allocationMode = normalizeLowerText(
      instance && instance.metadata && instance.metadata.allocationMode,
      instance && instance.spawnState && instance.spawnState.allocationMode,
    );
    if (allocationMode === "random") {
      continue;
    }
    const spawnFamilyKey = getInstanceSpawnFamilyKey(instance);
    const systemID = Math.max(0, toInt(instance && instance.solarSystemID, 0));
    const slotIndex = getInstanceSlotIndex(instance);
    if (!spawnFamilyKey || systemID <= 0) {
      continue;
    }
    const key = `${spawnFamilyKey}:${systemID}:${slotIndex}`;
    const existing = existingNonRandomBySlot.get(key);
    if (
      !existing ||
      Math.max(0, toInt(instance && instance.instanceID, 0)) <
        Math.max(0, toInt(existing && existing.instanceID, 0))
    ) {
      existingNonRandomBySlot.set(key, instance);
    }
  }

  for (const family of families) {
    const profile = dungeonAuthority.getSpawnProfile(family);
    if (!profile || profile.enabled === false || profile.persistent === false) {
      continue;
    }
    const lifetimeMs = resolveSiteLifetimeMs(profile.siteLifetimeMinutes);
    familySummaries[family] = {
      desiredSiteCount: 0,
      systemsTouched: 0,
      templateCount: listTemplateCandidatesForSpawnFamily(family).length,
    };

    for (const band of ["highsec", "lowsec", "nullsec", "wormhole"]) {
      const bandProfile = profile.bands && profile.bands[band];
      if (!bandProfile) {
        continue;
      }
      const allocationMode = resolveProfileAllocationMode(family, bandProfile);
      familySummaries[family].allocationModes = {
        ...(familySummaries[family].allocationModes || {}),
        [band]: allocationMode,
      };
      if (bandProfileUsesRandomAllocation(family, band, bandProfile)) {
        const randomResult = buildRandomAllocatedUniverseDefinitionsForBand(
          family,
          band,
          bandProfile,
          allSystemIDs,
          nowMs,
          options,
        );
        definitions.push(...randomResult.definitions);
        familySummaries[family].desiredSiteCount += randomResult.definitions.length;
        familySummaries[family].systemsTouched += new Set(
          randomResult.definitions.map((definition) => Math.max(0, toInt(definition && definition.solarSystemID, 0))),
        ).size;
        familySummaries[family].randomAllocation = true;
        familySummaries[family].targetSystems = {
          ...(familySummaries[family].targetSystems || {}),
          [band]: randomResult.targetSystemCount,
        };
        familySummaries[family].candidateSystems = {
          ...(familySummaries[family].candidateSystems || {}),
          [band]: randomResult.candidateSystemCount,
        };
        continue;
      }
      const eligibleSystemIDs = listEligibleSystemIDsForBandProfile(
        family,
        band,
        bandProfile,
        allSystemIDs,
      );
      for (const systemID of eligibleSystemIDs) {
        // A solar system belongs to exactly one security band. Guard the final
        // definition boundary even if an allocation/cache input contains a
        // cross-band system, otherwise every band can emit the same slot/site
        // key at a different coordinate.
        if (getSecurityBand(systemID) !== normalizeSecurityBand(band)) {
          continue;
        }
        const policyContext = buildTemplatePolicyContext(family, systemID, band);
        let systemDefinitionCount = 0;
        const slotsPerSystem = resolveUniverseDungeonSlotsPerSystem(
          family,
          systemID,
          bandProfile,
        );
        for (let slotIndex = 0; slotIndex < slotsPerSystem; slotIndex += 1) {
          const existing = existingNonRandomBySlot.get(`${family}:${systemID}:${slotIndex}`) || null;
          const rotationIndex = existing ? getInstanceRotationIndex(existing) : 0;
          let rejectedExistingTemplateID = null;
          let template = existing && existing.templateID
            ? dungeonAuthority.getTemplateByID(existing.templateID)
            : null;
          if (
            existing &&
            existing.templateID &&
            (!template || !isUniverseSpawnEligibleTemplate(template))
          ) {
            rejectedExistingTemplateID = normalizeText(existing.templateID, "") || null;
            template = null;
          }
          let evaluation = template
            ? evaluateTemplateSpawnPolicy(
              template,
              family,
              systemID,
              band,
              policyContext,
              options.policyOptions || {},
            )
            : null;
          if (evaluation && evaluation.allowed === false) {
            template = null;
            evaluation = null;
          }
          if (!template) {
            const selection = pickUniverseTemplateForSlotWithPolicy(
              family,
              systemID,
              slotIndex,
              rotationIndex,
              band,
              bandProfile,
              {
                policyContext,
                policyOptions: options.policyOptions,
              },
            );
            template = selection && selection.template || null;
            evaluation = selection && selection.evaluation || null;
          }
          if (!template) {
            continue;
          }
          const definition = buildUniverseSiteDefinition(template, family, systemID, slotIndex, {
            rotationIndex,
            startedAtMs: Math.max(0, toInt(nowMs, Date.now())),
            lifetimeMs,
            band,
            policyContext,
            spawnPolicyEvaluation: evaluation,
            metadata: {
              allocationMode,
              ...(rejectedExistingTemplateID
                ? { replaceUniverseTemplateID: rejectedExistingTemplateID }
                : {}),
            },
            spawnState: {
              allocationMode,
            },
            definitionDiscriminator: {
              allocationMode,
            },
          });
          if (!definition) {
            continue;
          }
          definitions.push(definition);
          familySummaries[family].desiredSiteCount += 1;
          systemDefinitionCount += 1;
        }
        if (systemDefinitionCount > 0) {
          familySummaries[family].systemsTouched += 1;
        }
      }
    }
  }

  const sovResult = listDesiredSovereigntyDungeonSiteDefinitions(allSystemIDs, nowMs, {
    ...options,
    families: Array.isArray(options.families) ? options.families : [],
  });
  definitions.push(...sovResult.definitions);
  for (const [family, summary] of Object.entries(sovResult.families || {})) {
    familySummaries[family] = summary;
  }

  const separatedDefinitions = enforceUniverseDungeonSiteSeparation(definitions);

  return {
    definitions: separatedDefinitions,
    families: familySummaries,
  };
}

function buildGeneratedMiningRotationDefinitionFromInstance(instance, nowMs = Date.now()) {
  if (
    !instance ||
    normalizeLowerText(instance && instance.siteOrigin, "") !== "generatedmining"
  ) {
    return null;
  }
  const family = normalizeLowerText(instance.siteFamily, "ice");
  const systemID = Math.max(0, toInt(instance.solarSystemID, 0));
  const slotIndex = Math.max(
    0,
    toInt(
      instance.metadata && instance.metadata.slotIndex,
      instance.spawnState && instance.spawnState.slotIndex,
    ),
  );
  const currentRotationIndex = Math.max(
    0,
    toInt(
      instance.metadata && instance.metadata.rotationIndex,
      instance.spawnState && instance.spawnState.rotationIndex,
    ),
  );
  const nextRotationIndex = currentRotationIndex + 1;
  const definition = miningResourceSiteService.buildGeneratedResourceSiteDefinition(
    systemID,
    family,
    slotIndex,
    {
      rotationIndex: nextRotationIndex,
    },
  );
  if (!definition) {
    return null;
  }
  return enrichGeneratedMiningDefinition(definition, nowMs, {
    slotIndex,
    rotationIndex: nextRotationIndex,
    startedAtMs: Math.max(0, toInt(nowMs, Date.now())),
    lifetimeMs: resolveGeneratedMiningSiteLifetimeMs(),
  });
}

function buildSovereigntyRotationDefinitionFromInstance(
  instance,
  nowMs = Date.now(),
  options: Record<string, any> = {},
) {
  if (!instance) {
    return null;
  }
  const spawnFamilyKey = normalizeLowerText(
    instance && instance.metadata && instance.metadata.spawnFamilyKey,
    normalizeLowerText(instance && instance.spawnState && instance.spawnState.spawnFamilyKey, ""),
  );
  if (!isSovereigntyGuaranteedSpawnFamily(spawnFamilyKey)) {
    return null;
  }
  const sovHub = normalizeObject(
    instance && instance.metadata && instance.metadata.sovHub,
  );
  const sourceSystemID = Math.max(0, toInt(sovHub.sourceSystemID, 0));
  const targetSystemID = Math.max(0, toInt(instance && instance.solarSystemID, 0));
  const slotIndex = Math.max(
    0,
    toInt(
      instance.metadata && instance.metadata.slotIndex,
      instance.spawnState && instance.spawnState.slotIndex,
    ),
  );
  const currentRotationIndex = Math.max(
    0,
    toInt(
      instance.metadata && instance.metadata.rotationIndex,
      instance.spawnState && instance.spawnState.rotationIndex,
    ),
  );
  const nextRotationIndex = currentRotationIndex + 1;
  if (sourceSystemID <= 0 || targetSystemID <= 0 || getSecurityBand(targetSystemID) !== "nullsec") {
    return null;
  }

  const context = dungeonSiteSpawnPolicy.buildRuntimeSystemPolicyContext(sourceSystemID, {
    securityBand: getSecurityBand(sourceSystemID),
  });
  const normalizedContext = dungeonSiteSpawnPolicy.normalizePolicyContext(context);
  if (
    normalizedContext.sovereignty.hasSovereignty !== true ||
    !normalizedContext.sovereignty.hubID
  ) {
    return null;
  }

  let template = null;
  let localPirateEvaluation = null;
  let targetPolicyContext = null;
  if (spawnFamilyKey === "sov_threat_detection") {
    const upgrades = listParsedOnlineUpgrades(normalizedContext, parseThreatDetectionUpgrade);
    const matchingUpgrade = upgrades.find((upgrade) => (
      upgrade.kind === normalizeLowerText(sovHub.upgradeKind, "") &&
      upgrade.tier === Math.max(1, toInt(sovHub.upgradeTier, 1))
    ));
    if (!matchingUpgrade || sourceSystemID !== targetSystemID) {
      return null;
    }
    targetPolicyContext = buildTemplatePolicyContext(
      "sov_threat_detection",
      targetSystemID,
      "nullsec",
    );
    template = pickDeterministicTemplate(
      listCombatAnomalyTemplatesForLabel(sovHub.ccpSiteLabel, {
        systemID: targetSystemID,
        band: "nullsec",
        spawnFamilyKey: "sov_threat_detection",
        policyContext: targetPolicyContext,
        policyOptions: options.policyOptions,
      }),
      `sov-threat:${targetSystemID}:${sovHub.upgradeKind}:${sovHub.upgradeTier}:${sovHub.ccpSiteLabel}:${sovHub.ccpSlotOccurrence}:${nextRotationIndex}`,
    );
  } else if (spawnFamilyKey === "sov_prospecting") {
    const upgrades = listParsedOnlineUpgrades(normalizedContext, parseProspectingUpgrade);
    const matchingUpgrade = upgrades.find((upgrade) => (
      upgrade.mineral === normalizeLowerText(sovHub.mineral, "") &&
      upgrade.tier === Math.max(1, toInt(sovHub.upgradeTier, 1))
    ));
    if (!matchingUpgrade || sourceSystemID !== targetSystemID) {
      return null;
    }
    template = pickDeterministicTemplate(
      listProspectingOreTemplates(sovHub.mineral, sovHub.upgradeTier),
      `sov-prospecting:${targetSystemID}:${sovHub.mineral}:${sovHub.upgradeTier}:${nextRotationIndex}`,
    );
  } else if (spawnFamilyKey === "sov_exploration_detector") {
    const upgrades = listParsedOnlineUpgrades(normalizedContext, parseExplorationDetectorUpgrade);
    const matchingUpgrade = upgrades.find((upgrade) => (
      upgrade.tier === Math.max(1, toInt(sovHub.upgradeTier, 1))
    ));
    const withinRange = listSystemsWithinJumps(sourceSystemID, 5)
      .some((entry) => entry.systemID === targetSystemID);
    if (!matchingUpgrade || !withinRange) {
      return null;
    }
    const family = normalizeLowerText(instance && instance.siteFamily, "data");
    template = pickExplorationDetectorTemplate(
      family,
      sourceSystemID,
      targetSystemID,
      sovHub.upgradeTier,
      sovHub.detectorSlotOrdinal,
      nextRotationIndex,
      options.policyOptions || {},
    );
    targetPolicyContext = buildTemplatePolicyContext(
      family,
      targetSystemID,
      getSecurityBand(targetSystemID),
    );
  }

  if (!template) {
    return null;
  }
  if (
    spawnFamilyKey === "sov_threat_detection" ||
    spawnFamilyKey === "sov_exploration_detector"
  ) {
    const policyFamily = spawnFamilyKey === "sov_threat_detection"
      ? "sov_threat_detection"
      : normalizeLowerText(instance && instance.siteFamily, "data");
    localPirateEvaluation = evaluateTemplateSpawnPolicy(
      template,
      policyFamily,
      targetSystemID,
      getSecurityBand(targetSystemID),
      targetPolicyContext,
      options.policyOptions || {},
    );
    if (!localPirateEvaluation || localPirateEvaluation.allowed === false) {
      return null;
    }
  }
  return buildSovGuaranteedDefinition(
    template,
    spawnFamilyKey,
    targetSystemID,
    slotIndex,
    nowMs,
    sovHub,
    {
      rotationIndex: nextRotationIndex,
      policyKey: `${spawnFamilyKey}_guaranteed`,
      label: normalizeText(template.resolvedName, instance && instance.spawnState && instance.spawnState.label),
      policyContext: targetPolicyContext,
      localPirateEvaluation,
    },
  );
}

function buildRotationDefinitionFromInstance(instance, nowMs = Date.now(), options: Record<string, any> = {}) {
  if (
    !instance ||
    !(instance.runtimeFlags && instance.runtimeFlags.universePersistent === true)
  ) {
    return null;
  }
  if (normalizeLowerText(instance && instance.siteOrigin, "") === "generatedmining") {
    return buildGeneratedMiningRotationDefinitionFromInstance(instance, nowMs);
  }
  const family = normalizeLowerText(instance.siteFamily, "");
  const spawnFamilyKey = normalizeLowerText(
    instance &&
    instance.metadata &&
    instance.metadata.spawnFamilyKey,
    normalizeLowerText(
      instance &&
      instance.spawnState &&
      instance.spawnState.spawnFamilyKey,
      family,
    ),
  );
  const systemID = Math.max(0, toInt(instance.solarSystemID, 0));
  if (isSovereigntyGuaranteedSpawnFamily(spawnFamilyKey)) {
    return buildSovereigntyRotationDefinitionFromInstance(instance, nowMs, options);
  }
  const profile = dungeonAuthority.getSpawnProfile(spawnFamilyKey);
  if (!spawnFamilyKey || systemID <= 0 || !profile || profile.enabled === false || profile.persistent === false) {
    return null;
  }
  const band = getSecurityBand(systemID);
  const bandProfile = profile.bands && profile.bands[band];
  const allocationMode = resolveProfileAllocationMode(spawnFamilyKey, bandProfile);
  const randomAllocationBand = bandProfile
    ? bandProfileUsesRandomAllocation(spawnFamilyKey, band, bandProfile)
    : false;
  const matchesBandProfile = randomAllocationBand
    ? listRandomAllocationCandidateSystemIDs(spawnFamilyKey, band, bandProfile).includes(systemID)
    : systemMatchesSpawnBandProfile(systemID, spawnFamilyKey, bandProfile);
  if (!bandProfile || !matchesBandProfile) {
    return null;
  }
  const slotIndex = Math.max(
    0,
    toInt(
      instance.metadata && instance.metadata.slotIndex,
      instance.spawnState && instance.spawnState.slotIndex,
    ),
  );
  const currentRotationIndex = Math.max(
    0,
    toInt(
      instance.metadata && instance.metadata.rotationIndex,
      instance.spawnState && instance.spawnState.rotationIndex,
    ),
  );
  const nextRotationIndex = currentRotationIndex + 1;
  if (randomAllocationBand) {
    const nextSystemID = chooseRandomRespawnSystemID(
      spawnFamilyKey,
      band,
      bandProfile,
      systemID,
      {
        rng: Math.random,
      },
    );
    if (nextSystemID <= 0) {
      return null;
    }
    return buildRandomAllocatedDefinitionForSlot(
      spawnFamilyKey,
      band,
      bandProfile,
      nextSystemID,
      slotIndex,
      nowMs,
      {
        rotationIndex: nextRotationIndex,
        rng: Math.random,
        policyOptions: options.policyOptions,
      },
    );
  }
  const policyContext = buildTemplatePolicyContext(spawnFamilyKey, systemID, band);
  const selection = pickUniverseTemplateForSlotWithPolicy(
    spawnFamilyKey,
    systemID,
    slotIndex,
    nextRotationIndex,
    band,
    bandProfile,
    {
      policyContext,
      policyOptions: options.policyOptions,
    },
  );
  const template = selection && selection.template || null;
  if (!template) {
    return null;
  }
  return buildUniverseSiteDefinition(template, spawnFamilyKey, systemID, slotIndex, {
    spawnFamilyKey,
    rotationIndex: nextRotationIndex,
    startedAtMs: Math.max(0, toInt(nowMs, Date.now())),
    lifetimeMs: resolveSiteLifetimeMs(profile.siteLifetimeMinutes),
    band,
    policyContext,
    spawnPolicyEvaluation: selection && selection.evaluation,
    metadata: {
      allocationMode,
    },
    spawnState: {
      allocationMode,
    },
    definitionDiscriminator: {
      allocationMode,
    },
  });
}

function shouldRotateUniversePersistentTerminalInstance(instance, nowMs) {
  if (!instance) {
    return false;
  }
  const isGeneratedMining =
    normalizeLowerText(instance && instance.siteOrigin, "") === "generatedmining";
  if (!isGeneratedMining) {
    return true;
  }
  if (normalizeLowerText(instance && instance.lifecycleReason, "") !== "depleted") {
    return true;
  }
  const respawnAtMs = Math.max(0, toInt(instance && instance.timers && instance.timers.expiresAtMs, 0));
  return respawnAtMs <= 0 || respawnAtMs <= Math.max(0, toInt(nowMs, Date.now()));
}

function listProtectedGeneratedMiningSiteKeys(systemIDs, nowMs = Date.now()) {
  const targetedSystemIDs = new Set<any>(normalizeSystemIDs(systemIDs));
  const candidates = (
    Array.isArray(systemIDs) &&
    systemIDs.length > 0 &&
    targetedSystemIDs.size > 0 &&
    targetedSystemIDs.size <= INDEXED_SYSTEM_LOOKUP_LIMIT
  )
    ? [...targetedSystemIDs].flatMap((systemID) => (
      dungeonRuntime.listInstancesBySystem(systemID, { full: true })
    )).filter((instance) => (
      !dungeonRuntimeState.isActiveLifecycleState(instance && instance.lifecycleState) &&
      instance &&
      instance.runtimeFlags &&
      instance.runtimeFlags.universePersistent === true &&
      instance.runtimeFlags.universeSeeded === true
    ))
    : dungeonRuntime.listUniversePersistentTerminalInstances({ full: true });
  return candidates
    .filter((instance) => (
      normalizeLowerText(instance && instance.siteOrigin, "") === "generatedmining" &&
      targetedSystemIDs.has(Math.max(0, toInt(instance && instance.solarSystemID, 0))) &&
      shouldRotateUniversePersistentTerminalInstance(instance, nowMs) === false
    ))
    .map((instance) => normalizeText(instance && instance.siteKey, ""))
    .filter(Boolean);
}

function refreshLoadedGeneratedMiningScenes(systemIDs, nowMs) {
  const targetedSystemIDs = normalizeSystemIDs(systemIDs);
  if (targetedSystemIDs.length <= 0) {
    return {
      refreshedCount: 0,
      refreshedSystemIDs: [],
    };
  }

  let runtime = null;
  try {
    runtime = require(path.join(__dirname, "../../space/runtime"));
  } catch (_) {
    return {
      refreshedCount: 0,
      refreshedSystemIDs: [],
    };
  }

  const refreshedSystemIDs: any[] = [];
  for (const systemID of targetedSystemIDs) {
    const scene =
      runtime &&
      runtime.scenes &&
      typeof runtime.scenes.get === "function"
        ? runtime.scenes.get(systemID)
        : null;
    if (!scene) {
      continue;
    }

    scene._miningRuntimeState = null;
    const resetResult = miningResourceSiteService.resetSceneGeneratedResourceSites(scene, {
      broadcast: false,
      nowMs,
    });
    scene._miningRuntimeState = null;
    if (resetResult && resetResult.success === true) {
      refreshedSystemIDs.push(systemID);
    }
  }

  return {
    refreshedCount: refreshedSystemIDs.length,
    refreshedSystemIDs,
  };
}

function parseClusterDowntimeStartsUtc(value = config && config.clusterDowntimeStarts) {
  const rawValue = normalizeText(value, DEFAULT_CLUSTER_DOWNTIME_STARTS_UTC);
  const match = /^(\d{1,2}):(\d{2}):(\d{2})$/.exec(rawValue);
  if (!match) {
    return {
      hour: DAILY_DOWNTIME_HOUR_UTC,
      minute: 0,
      second: 0,
      source: "default",
      rawValue,
      normalized: DEFAULT_CLUSTER_DOWNTIME_STARTS_UTC,
      valid: false,
    };
  }

  const hour = toInt(match[1], -1);
  const minute = toInt(match[2], -1);
  const second = toInt(match[3], -1);
  if (
    hour < 0 ||
    hour > 23 ||
    minute < 0 ||
    minute > 59 ||
    second < 0 ||
    second > 59
  ) {
    return {
      hour: DAILY_DOWNTIME_HOUR_UTC,
      minute: 0,
      second: 0,
      source: "default",
      rawValue,
      normalized: DEFAULT_CLUSTER_DOWNTIME_STARTS_UTC,
      valid: false,
    };
  }

  return {
    hour,
    minute,
    second,
    source: rawValue === DEFAULT_CLUSTER_DOWNTIME_STARTS_UTC ? "default" : "cluster_config",
    rawValue,
    normalized: formatUtcClock(hour, minute, second),
    valid: true,
  };
}

function resolveDowntimeClockUtc(options: Record<string, any> = {}) {
  const configClock = parseClusterDowntimeStartsUtc();
  const hasExplicitHour = hasOwnValue(options, "downtimeHourUtc");
  const hasExplicitMinute = hasOwnValue(options, "downtimeMinuteUtc");
  const hasExplicitSecond = hasOwnValue(options, "downtimeSecondUtc");
  const explicit = hasExplicitHour || hasExplicitMinute || hasExplicitSecond;
  const hour = Math.min(
    23,
    Math.max(0, toInt(
      hasExplicitHour
        ? options.downtimeHourUtc
        : (explicit ? DAILY_DOWNTIME_HOUR_UTC : configClock.hour),
      DAILY_DOWNTIME_HOUR_UTC,
    )),
  );
  const minute = Math.min(
    59,
    Math.max(0, toInt(
      hasExplicitMinute ? options.downtimeMinuteUtc : (explicit ? 0 : configClock.minute),
      0,
    )),
  );
  const second = Math.min(
    59,
    Math.max(0, toInt(
      hasExplicitSecond ? options.downtimeSecondUtc : (explicit ? 0 : configClock.second),
      0,
    )),
  );

  return {
    hour,
    minute,
    second,
    source: explicit ? "options" : configClock.source,
    rawValue: explicit ? null : configClock.rawValue,
    normalized: formatUtcClock(hour, minute, second),
    valid: explicit ? true : configClock.valid,
  };
}

function resolveLastDailyDowntimeAtMs(nowMs = Date.now(), options: Record<string, any> = {}) {
  const referenceMs = Math.max(0, toInt(nowMs, Date.now()));
  const referenceDate = new Date(referenceMs);
  const clock = resolveDowntimeClockUtc(options);
  const todayDowntimeMs = Date.UTC(
    referenceDate.getUTCFullYear(),
    referenceDate.getUTCMonth(),
    referenceDate.getUTCDate(),
    clock.hour,
    clock.minute,
    clock.second,
    0,
  );
  return referenceMs >= todayDowntimeMs
    ? todayDowntimeMs
    : todayDowntimeMs - DAY_MS;
}

function resolveGeneratedIceDowntimeBoundary(options: Record<string, any> = {}, nowMs = Date.now()) {
  const explicitDowntimeAtMs = firstPositiveInt(
    options.downtimeAtMs,
    options.lastDowntimeAtMs,
    options.downtimeStartMs,
  );
  if (explicitDowntimeAtMs > 0) {
    return {
      downtimeAtMs: explicitDowntimeAtMs,
      source: "explicit",
    };
  }
  if (options.autoDowntimeBoundary === false || options.autoGeneratedIceDowntimeRestore === false) {
    return {
      downtimeAtMs: 0,
      source: "disabled",
    };
  }
  const clock = resolveDowntimeClockUtc(options);
  return {
    downtimeAtMs: resolveLastDailyDowntimeAtMs(nowMs, options),
    source: "daily_utc",
    downtimeStartSource: clock.source,
    downtimeStartTimeUtc: clock.normalized,
  };
}

function markGeneratedIceDowntimeRestoreApplied(downtimeAtMs, nowMs) {
  const normalizedDowntimeAtMs = Math.max(0, toInt(downtimeAtMs, 0));
  if (normalizedDowntimeAtMs <= 0) {
    return dungeonRuntimeState.getUniverseReconcileMeta();
  }
  return dungeonRuntimeState.writeUniverseReconcileMeta({
    lastGeneratedIceDowntimeRestoreAtMs: normalizedDowntimeAtMs,
    lastGeneratedIceDowntimeRestoreRunAtMs: Math.max(0, toInt(nowMs, Date.now())),
  });
}

function advanceUniversePersistentSites(options: Record<string, any> = {}) {
  const nowMs = Math.max(0, toInt(options.nowMs, Date.now()));
  const lifecycleReason = normalizeText(options.lifecycleReason, "expired");
  const hasSystemFilter = Array.isArray(options.systemIDs);
  const scopedSystemIDs = hasSystemFilter
    ? normalizeProvidedSystemIDs(options.systemIDs)
    : null;
  if (hasSystemFilter && scopedSystemIDs.length <= 0) {
    return {
      expiredCount: 0,
      rotatedCount: 0,
      removedCount: 0,
      skipped: true,
      reason: "no_awake_systems",
    };
  }
  const scopedSystemIDSet = hasSystemFilter ? new Set(scopedSystemIDs) : null;
  const emitExpiryEvents =
    options.emitExpiryEvents !== false &&
    lifecycleReason !== "startup-resume";
  const expired = dungeonRuntime.tickRuntime({
    nowMs,
    lifecycleReason,
    emitChanges: emitExpiryEvents,
    systemIDs: hasSystemFilter ? scopedSystemIDs : undefined,
  });
  const candidates = dungeonRuntime
    .listUniversePersistentTerminalInstances({ full: true })
    .filter((instance) => (
      !hasSystemFilter ||
      scopedSystemIDSet.has(Math.max(0, toInt(instance && instance.solarSystemID, 0)))
    ))
    .filter((instance) => shouldRotateUniversePersistentTerminalInstance(instance, nowMs));

  if (
    Math.max(0, toInt(expired && expired.expiredCount, 0)) <= 0 &&
    candidates.length <= 0
  ) {
    return {
      expiredCount: 0,
      rotatedCount: 0,
      removedCount: 0,
    };
  }

  const rotations: any[] = [];
  const affectedGeneratedMiningSystemIDs = new Set<any>();
  const occupiedRotationSites = listUniverseSeededPersistentSiteInstances(
    hasSystemFilter ? scopedSystemIDs : null,
  ).filter((entry) => normalizeLowerText(entry && entry.siteOrigin, "") !== "generatedmining");
  for (const instance of candidates) {
    const isGeneratedMining =
      normalizeLowerText(instance && instance.siteOrigin, "") === "generatedmining";
    if (isGeneratedMining) {
      affectedGeneratedMiningSystemIDs.add(Math.max(0, toInt(instance && instance.solarSystemID, 0)));
    }
    const rawNextDefinition = buildRotationDefinitionFromInstance(instance, nowMs, {
      policyOptions: options.policyOptions,
    });
    const nextDefinition = rawNextDefinition && !isGeneratedMining
      ? enforceUniverseDungeonSiteSeparation([rawNextDefinition], {
        occupiedSites: occupiedRotationSites,
      })[0] || null
      : rawNextDefinition;
    if (!nextDefinition) {
      continue;
    }
    if (!isGeneratedMining) {
      occupiedRotationSites.push(nextDefinition);
    }
    rotations.push({
      existingInstance: instance,
      nextDefinition,
    });
    if (normalizeLowerText(nextDefinition && nextDefinition.siteOrigin, "") === "generatedmining") {
      affectedGeneratedMiningSystemIDs.add(Math.max(0, toInt(nextDefinition && nextDefinition.solarSystemID, 0)));
    }
  }

  const rotationSummary = rotations.length > 0
    ? dungeonRuntime.rotateUniversePersistentInstances(rotations, { nowMs })
    : {
      rotatedCount: 0,
      removedCount: 0,
    };

  if (affectedGeneratedMiningSystemIDs.size > 0) {
    reconcileGeneratedMiningRuntimeState(
      listActiveGeneratedMiningDefinitionsFromRuntime([...affectedGeneratedMiningSystemIDs]),
      [...affectedGeneratedMiningSystemIDs],
      nowMs,
    );
    if (Math.max(0, toInt(rotationSummary && rotationSummary.rotatedCount, 0)) > 0) {
      refreshLoadedGeneratedMiningScenes([...affectedGeneratedMiningSystemIDs], nowMs);
    }
  }

  return {
    expiredCount: Math.max(0, toInt(expired && expired.expiredCount, 0)),
    rotatedCount: Math.max(0, toInt(rotationSummary && rotationSummary.rotatedCount, 0)),
    removedCount: Math.max(0, toInt(rotationSummary && rotationSummary.removedCount, 0)),
  };
}

function restoreGeneratedIceAfterDowntime(options: Record<string, any> = {}) {
  const nowMs = Math.max(0, toInt(options.nowMs, Date.now()));
  const boundary = resolveGeneratedIceDowntimeBoundary(options, nowMs);
  const downtimeAtMs = Math.max(0, toInt(boundary && boundary.downtimeAtMs, 0));
  const hasSystemFilter =
    Array.isArray(options.systemIDs) ||
    Array.isArray(options.startupSystemIDs);
  const targetedSystemIDs = hasSystemFilter
    ? normalizeProvidedSystemIDs(options.systemIDs || options.startupSystemIDs || [])
    : [];
  const targetedSystemSet = new Set(targetedSystemIDs);

  if (downtimeAtMs <= 0) {
    return {
      skipped: true,
      reason: boundary && boundary.source === "disabled"
        ? "disabled"
        : "missing_downtime_boundary",
      boundarySource: boundary && boundary.source ? boundary.source : "missing",
      downtimeStartSource: boundary && boundary.downtimeStartSource
        ? boundary.downtimeStartSource
        : null,
      downtimeStartTimeUtc: boundary && boundary.downtimeStartTimeUtc
        ? boundary.downtimeStartTimeUtc
        : null,
      scannedCount: 0,
      eligibleCount: 0,
      rotatedCount: 0,
      removedCount: 0,
      refreshedSceneCount: 0,
      affectedSystemIDs: [],
    };
  }
  if (hasSystemFilter && targetedSystemIDs.length <= 0) {
    return {
      skipped: true,
      reason: "no_startup_systems",
      boundarySource: boundary && boundary.source ? boundary.source : "unknown",
      downtimeStartSource: boundary && boundary.downtimeStartSource
        ? boundary.downtimeStartSource
        : null,
      downtimeStartTimeUtc: boundary && boundary.downtimeStartTimeUtc
        ? boundary.downtimeStartTimeUtc
        : null,
      downtimeAtMs,
      scannedCount: 0,
      eligibleCount: 0,
      rotatedCount: 0,
      removedCount: 0,
      refreshedSceneCount: 0,
      affectedSystemIDs: [],
    };
  }

  const meta = dungeonRuntimeState.getUniverseReconcileMeta();
  const lastAppliedDowntimeAtMs = Math.max(
    0,
    toInt(meta && meta.lastGeneratedIceDowntimeRestoreAtMs, 0),
  );
  if (
    options.skipAlreadyApplied !== false &&
    lastAppliedDowntimeAtMs >= downtimeAtMs
  ) {
    return {
      skipped: true,
      reason: "downtime_already_applied",
      boundarySource: boundary && boundary.source ? boundary.source : "unknown",
      downtimeStartSource: boundary && boundary.downtimeStartSource
        ? boundary.downtimeStartSource
        : null,
      downtimeStartTimeUtc: boundary && boundary.downtimeStartTimeUtc
        ? boundary.downtimeStartTimeUtc
        : null,
      downtimeAtMs,
      lastAppliedDowntimeAtMs,
      scannedCount: 0,
      eligibleCount: 0,
      rotatedCount: 0,
      removedCount: 0,
      refreshedSceneCount: 0,
      affectedSystemIDs: [],
    };
  }

  const terminalInstances = dungeonRuntime.listUniversePersistentTerminalInstances({ full: true });
  const rotations: any[] = [];
  const affectedGeneratedMiningSystemIDs = new Set<any>();
  let scannedCount = 0;

  for (const instance of terminalInstances) {
    if (!instance || normalizeLowerText(instance.siteOrigin, "") !== "generatedmining") {
      continue;
    }
    if (normalizeLowerText(instance.siteFamily, "") !== "ice") {
      continue;
    }

    const systemID = Math.max(0, toInt(instance && instance.solarSystemID, 0));
    if (systemID <= 0 || (hasSystemFilter && !targetedSystemSet.has(systemID))) {
      continue;
    }
    scannedCount += 1;

    const lifecycleState = normalizeLowerText(instance && instance.lifecycleState, "");
    const lifecycleReason = normalizeLowerText(instance && instance.lifecycleReason, "");
    if (lifecycleState !== "completed" || lifecycleReason !== "depleted") {
      continue;
    }

    const completedAtMs = Math.max(
      0,
      toInt(instance && instance.timers && instance.timers.completedAtMs, 0),
    );
    if (completedAtMs <= 0 || completedAtMs >= downtimeAtMs) {
      continue;
    }

    const auditEntry = buildGeneratedIceAuthorityAuditEntry(instance);
    if (!auditEntry || auditEntry.valid !== true) {
      continue;
    }

    const nextDefinition = buildRotationDefinitionFromInstance(instance, nowMs);
    if (!nextDefinition) {
      continue;
    }

    rotations.push({
      existingInstance: instance,
      nextDefinition,
    });
    affectedGeneratedMiningSystemIDs.add(systemID);
    const nextSystemID = Math.max(0, toInt(nextDefinition && nextDefinition.solarSystemID, 0));
    if (nextSystemID > 0) {
      affectedGeneratedMiningSystemIDs.add(nextSystemID);
    }
  }

  const rotationSummary = rotations.length > 0
    ? dungeonRuntime.rotateUniversePersistentInstances(rotations, { nowMs })
    : {
      rotatedCount: 0,
      removedCount: 0,
    };

  let runtimeStateSummary = {
    createdRows: 0,
    updatedRows: 0,
    removedRows: 0,
  };
  let sceneRefresh = {
    refreshedCount: 0,
    refreshedSystemIDs: [],
  };
  const affectedSystemIDs = [...affectedGeneratedMiningSystemIDs].sort((left, right) => left - right);
  if (affectedSystemIDs.length > 0) {
    runtimeStateSummary = reconcileGeneratedMiningRuntimeState(
      listActiveGeneratedMiningDefinitionsFromRuntime(affectedSystemIDs),
      affectedSystemIDs,
      nowMs,
    );
    if (Math.max(0, toInt(rotationSummary && rotationSummary.rotatedCount, 0)) > 0) {
      sceneRefresh = refreshLoadedGeneratedMiningScenes(affectedSystemIDs, nowMs);
    }
  }

  const result = {
    skipped: false,
    reason: "downtime_boundary",
    boundarySource: boundary && boundary.source ? boundary.source : "unknown",
    downtimeStartSource: boundary && boundary.downtimeStartSource
      ? boundary.downtimeStartSource
      : null,
    downtimeStartTimeUtc: boundary && boundary.downtimeStartTimeUtc
      ? boundary.downtimeStartTimeUtc
      : null,
    downtimeAtMs,
    nowMs,
    scannedCount,
    eligibleCount: rotations.length,
    rotatedCount: Math.max(0, toInt(rotationSummary && rotationSummary.rotatedCount, 0)),
    removedCount: Math.max(0, toInt(rotationSummary && rotationSummary.removedCount, 0)),
    miningStateRowsCreated: Math.max(0, toInt(runtimeStateSummary && runtimeStateSummary.createdRows, 0)),
    miningStateRowsUpdated: Math.max(0, toInt(runtimeStateSummary && runtimeStateSummary.updatedRows, 0)),
    miningStateRowsRemoved: Math.max(0, toInt(runtimeStateSummary && runtimeStateSummary.removedRows, 0)),
    refreshedSceneCount: Math.max(0, toInt(sceneRefresh && sceneRefresh.refreshedCount, 0)),
    refreshedSystemIDs: Array.isArray(sceneRefresh && sceneRefresh.refreshedSystemIDs)
      ? sceneRefresh.refreshedSystemIDs
      : [],
    affectedSystemIDs,
  };
  if (options.recordDowntimeRestore !== false) {
    markGeneratedIceDowntimeRestoreApplied(downtimeAtMs, nowMs);
  }
  return result;
}

function listUniverseSeededGeneratedMiningInstances(systemIDs = null) {
  const targetedSystemIDs = new Set<any>(normalizeSystemIDs(systemIDs));
  const candidates = (
    Array.isArray(systemIDs) &&
    systemIDs.length > 0 &&
    targetedSystemIDs.size > 0 &&
    targetedSystemIDs.size <= INDEXED_SYSTEM_LOOKUP_LIMIT
  )
    ? [...targetedSystemIDs].flatMap((systemID) => (
      dungeonRuntime.listInstancesBySystem(systemID, { full: true, activeOnly: true })
    ))
    : [
      ...dungeonRuntime.listInstancesByLifecycle("seeded", { full: true }),
      ...dungeonRuntime.listInstancesByLifecycle("active", { full: true }),
      ...dungeonRuntime.listInstancesByLifecycle("paused", { full: true }),
    ];
  return candidates.filter((instance) => (
    instance &&
    String(instance.siteOrigin || "").trim().toLowerCase() === "generatedmining" &&
    instance.runtimeFlags &&
    instance.runtimeFlags.universeSeeded === true &&
    (
      targetedSystemIDs.size <= 0 ||
      targetedSystemIDs.has(toInt(instance && instance.solarSystemID, 0))
    )
  ));
}

function isStartupResetMiningAnomalyInstance(instance) {
  if (!instance || !(instance.runtimeFlags && instance.runtimeFlags.universeSeeded === true)) {
    return false;
  }
  const siteFamily = normalizeLowerText(instance && instance.siteFamily, "");
  if (siteFamily !== "ice" && siteFamily !== "ore") {
    return false;
  }
  const siteKind = normalizeLowerText(instance && instance.siteKind, "anomaly");
  if (siteKind && siteKind !== "anomaly") {
    return false;
  }
  return true;
}

function listStartupResetMiningAnomalyInstances(systemIDs = null) {
  const targetedSystemIDs = new Set<any>(normalizeSystemIDs(systemIDs));
  const byInstanceID = new Map();
  for (const lifecycleState of ["seeded", "active", "paused", "completed", "failed", "despawned"]) {
    for (const instance of dungeonRuntime.listInstancesByLifecycle(lifecycleState, { full: true })) {
      const systemID = Math.max(0, toInt(instance && instance.solarSystemID, 0));
      if (systemID <= 0 || (targetedSystemIDs.size > 0 && !targetedSystemIDs.has(systemID))) {
        continue;
      }
      if (isStartupResetMiningAnomalyInstance(instance)) {
        byInstanceID.set(Math.max(0, toInt(instance && instance.instanceID, 0)), instance);
      }
    }
  }
  return [...byInstanceID.values()].sort((left, right) => (
    toInt(left && left.solarSystemID, 0) - toInt(right && right.solarSystemID, 0) ||
    toInt(left && left.instanceID, 0) - toInt(right && right.instanceID, 0)
  ));
}

function listStartupIncompleteDungeonInstances() {
  const byInstanceID = new Map();
  for (const lifecycleState of ["seeded", "active", "paused"]) {
    for (const instance of dungeonRuntime.listInstancesByLifecycle(lifecycleState, { full: true })) {
      const instanceID = Math.max(0, toInt(instance && instance.instanceID, 0));
      if (instanceID > 0) {
        byInstanceID.set(instanceID, instance);
      }
    }
  }
  return [...byInstanceID.values()].sort((left, right) => (
    toInt(left && left.instanceID, 0) - toInt(right && right.instanceID, 0)
  ));
}

function resetStartupIncompleteDungeons(options: Record<string, any> = {}) {
  if (options.enabled === false) {
    return {
      skipped: true,
      reason: "disabled",
      scannedCount: 0,
      rotatedCount: 0,
      purgedCount: 0,
      discardedCount: 0,
      rotatedInstanceIDs: [],
      purgedInstanceIDs: [],
      affectedSystemIDs: [],
      refreshedSceneCount: 0,
      refreshedSystemIDs: [],
    };
  }

  const nowMs = Math.max(0, toInt(options.nowMs, Date.now()));
  const incompleteInstances = listStartupIncompleteDungeonInstances();
  const incompleteInstanceIDs = new Set<any>(incompleteInstances.map((instance) => (
    Math.max(0, toInt(instance && instance.instanceID, 0))
  )));
  const rotationBuilder = typeof options.buildRotationDefinition === "function"
    ? options.buildRotationDefinition
    : buildRotationDefinitionFromInstance;
  const occupiedRotationSites = listUniverseSeededPersistentSiteInstances()
    .filter((instance) => (
      !incompleteInstanceIDs.has(Math.max(0, toInt(instance && instance.instanceID, 0))) &&
      normalizeLowerText(instance && instance.siteOrigin, "") !== "generatedmining"
    ));
  const reservedRotationSiteKeys = new Set<any>(occupiedRotationSites
    .map((instance) => normalizeText(instance && instance.siteKey, ""))
    .filter(Boolean));
  const rotations: any[] = [];
  const purgeCandidateIDs: any[] = [];
  const affectedSystemIDs = new Set<any>();
  const affectedGeneratedMiningSystemIDs = new Set<any>();

  for (const instance of incompleteInstances) {
    const instanceID = Math.max(0, toInt(instance && instance.instanceID, 0));
    const systemID = Math.max(0, toInt(instance && instance.solarSystemID, 0));
    const runtimeFlags = getInstanceObject(instance, "runtimeFlags");
    const isUniversePersistent = Boolean(
      runtimeFlags.universePersistent === true &&
      runtimeFlags.universeSeeded === true
    );
    if (systemID > 0) {
      affectedSystemIDs.add(systemID);
    }
    if (!isUniversePersistent) {
      purgeCandidateIDs.push(instanceID);
      continue;
    }

    const isGeneratedMining =
      normalizeLowerText(instance && instance.siteOrigin, "") === "generatedmining";
    if (isGeneratedMining && systemID > 0) {
      affectedGeneratedMiningSystemIDs.add(systemID);
    }
    let nextDefinition = null;
    for (let attempt = 0; attempt < 8 && !nextDefinition; attempt += 1) {
      const rawNextDefinition = rotationBuilder(instance, nowMs, {
        policyOptions: options.policyOptions,
      });
      const candidate = rawNextDefinition && !isGeneratedMining
        ? enforceUniverseDungeonSiteSeparation([rawNextDefinition], {
          occupiedSites: occupiedRotationSites,
        })[0] || null
        : rawNextDefinition;
      const candidateSiteKey = normalizeText(candidate && candidate.siteKey, "");
      if (candidate && candidateSiteKey && !reservedRotationSiteKeys.has(candidateSiteKey)) {
        nextDefinition = candidate;
        reservedRotationSiteKeys.add(candidateSiteKey);
      }
    }
    if (!nextDefinition) {
      purgeCandidateIDs.push(instanceID);
      continue;
    }
    if (!isGeneratedMining) {
      occupiedRotationSites.push(nextDefinition);
    }
    rotations.push({
      existingInstance: instance,
      nextDefinition,
    });
    const nextSystemID = Math.max(0, toInt(nextDefinition && nextDefinition.solarSystemID, 0));
    if (nextSystemID > 0) {
      affectedSystemIDs.add(nextSystemID);
      if (normalizeLowerText(nextDefinition && nextDefinition.siteOrigin, "") === "generatedmining") {
        affectedGeneratedMiningSystemIDs.add(nextSystemID);
      }
    }
  }

  const rotationSummary = rotations.length > 0
    ? dungeonRuntime.rotateUniversePersistentInstances(rotations, { nowMs })
    : {
      rotatedCount: 0,
      removedCount: 0,
    };
  const purgeSummary = dungeonRuntime.purgeInstances(purgeCandidateIDs, {
    source: "resetStartupIncompleteDungeons",
  });
  const purgedInstanceIDs = Array.isArray(purgeSummary && purgeSummary.removedInstanceIDs)
    ? purgeSummary.removedInstanceIDs
    : [];
  const rotatedInstanceIDs = rotations.map((rotation) => (
    Math.max(0, toInt(rotation && rotation.existingInstance && rotation.existingInstance.instanceID, 0))
  )).filter((instanceID) => instanceID > 0);

  if (affectedGeneratedMiningSystemIDs.size > 0) {
    reconcileGeneratedMiningRuntimeState(
      listActiveGeneratedMiningDefinitionsFromRuntime([...affectedGeneratedMiningSystemIDs]),
      [...affectedGeneratedMiningSystemIDs],
      nowMs,
    );
  }
  const refreshed = affectedGeneratedMiningSystemIDs.size > 0
    ? refreshLoadedGeneratedMiningScenes([...affectedGeneratedMiningSystemIDs], nowMs)
    : {
      refreshedCount: 0,
      refreshedSystemIDs: [],
    };

  return {
    skipped: false,
    reason: "server_restart_incomplete_reset",
    scannedCount: incompleteInstances.length,
    rotatedCount: Math.max(0, toInt(rotationSummary && rotationSummary.rotatedCount, 0)),
    purgedCount: purgedInstanceIDs.length,
    discardedCount:
      Math.max(0, toInt(rotationSummary && rotationSummary.removedCount, 0)) +
      purgedInstanceIDs.length,
    rotatedInstanceIDs,
    purgedInstanceIDs,
    affectedSystemIDs: [...affectedSystemIDs].sort((left, right) => left - right),
    refreshedSceneCount: Math.max(0, toInt(refreshed && refreshed.refreshedCount, 0)),
    refreshedSystemIDs: Array.isArray(refreshed && refreshed.refreshedSystemIDs)
      ? refreshed.refreshedSystemIDs
      : [],
  };
}

function resetStartupMiningAnomalies(options: Record<string, any> = {}) {
  const nowMs = Math.max(0, toInt(options.nowMs, Date.now()));
  const hasSystemFilter = Array.isArray(options.systemIDs);
  const targetedSystemIDs = hasSystemFilter
    ? normalizeProvidedSystemIDs(options.systemIDs)
    : null;
  if (options.enabled === false) {
    return {
      skipped: true,
      reason: "disabled",
      purgedCount: 0,
      purgedInstanceIDs: [],
      affectedSystemIDs: [],
      desiredIceSites: 0,
      desiredOreSites: 0,
      createdInstances: 0,
      retainedInstances: 0,
      replacedInstances: 0,
      removedInstances: 0,
      miningStateRowsCreated: 0,
      miningStateRowsUpdated: 0,
      miningStateRowsRemoved: 0,
      refreshedSceneCount: 0,
      refreshedSystemIDs: [],
    };
  }
  if (hasSystemFilter && targetedSystemIDs.length <= 0) {
    return {
      skipped: true,
      reason: "no_startup_systems",
      purgedCount: 0,
      purgedInstanceIDs: [],
      affectedSystemIDs: [],
      desiredIceSites: 0,
      desiredOreSites: 0,
      createdInstances: 0,
      retainedInstances: 0,
      replacedInstances: 0,
      removedInstances: 0,
      miningStateRowsCreated: 0,
      miningStateRowsUpdated: 0,
      miningStateRowsRemoved: 0,
      refreshedSceneCount: 0,
      refreshedSystemIDs: [],
    };
  }

  const existing = listStartupResetMiningAnomalyInstances(
    hasSystemFilter ? targetedSystemIDs : options.systemIDs,
  );
  const affectedSystemIDs = new Set<any>();
  const generatedMiningSystemIDs = new Set<any>();
  const existingOreSystemIDs = new Set<any>();
  const purgeCandidateIDs: any[] = [];

  for (const instance of existing) {
    const instanceID = Math.max(0, toInt(instance && instance.instanceID, 0));
    const systemID = Math.max(0, toInt(instance && instance.solarSystemID, 0));
    const family = normalizeLowerText(instance && instance.siteFamily, "");
    const origin = normalizeLowerText(instance && instance.siteOrigin, "");
    if (systemID > 0) {
      affectedSystemIDs.add(systemID);
      if (family === "ore") {
        existingOreSystemIDs.add(systemID);
      }
      if (origin === "generatedmining" || family === "ice") {
        generatedMiningSystemIDs.add(systemID);
      }
    }
    if (instanceID > 0) {
      purgeCandidateIDs.push(instanceID);
    }
  }
  const purgeSummary = dungeonRuntime.purgeInstances(purgeCandidateIDs, {
    source: "resetStartupMiningAnomalies",
  });
  const purgedInstanceIDs = Array.isArray(purgeSummary && purgeSummary.removedInstanceIDs)
    ? purgeSummary.removedInstanceIDs
    : [];

  const iceSystemIDs = hasSystemFilter
    ? iceSystemAuthority.listIceSystemIDs(targetedSystemIDs)
    : iceSystemAuthority.listIceSystemIDs();
  for (const systemID of iceSystemIDs) {
    affectedSystemIDs.add(systemID);
    generatedMiningSystemIDs.add(systemID);
  }

  const miningDefinitions = listDesiredGeneratedMiningDefinitions(iceSystemIDs, nowMs);
  const miningInstanceSummary = dungeonRuntime.reconcileUniverseSeededInstances(miningDefinitions, {
    systemIDs: iceSystemIDs,
    nowMs,
    siteFamilyFilter: ["ice"],
    siteOriginFilter: ["generatedmining"],
  });
  const miningStateSummary = reconcileGeneratedMiningRuntimeState(
    listActiveGeneratedMiningDefinitionsFromRuntime([
      ...iceSystemIDs,
      ...generatedMiningSystemIDs,
    ]),
    [...new Set([...iceSystemIDs, ...generatedMiningSystemIDs])],
    nowMs,
  );

  const oreSystemIDs = [...existingOreSystemIDs].sort((left, right) => left - right);
  const oreResult = oreSystemIDs.length > 0
    ? listDesiredUniverseDungeonSiteDefinitions(oreSystemIDs, nowMs, { families: ["ore"] })
    : { definitions: [] };
  const oreDefinitions = Array.isArray(oreResult && oreResult.definitions)
    ? oreResult.definitions
    : [];
  const oreInstanceSummary = oreDefinitions.length > 0 || oreSystemIDs.length > 0
    ? dungeonRuntime.reconcileUniverseSeededInstances(oreDefinitions, {
      systemIDs: oreSystemIDs,
      nowMs,
      spawnFamilyFilter: ["ore"],
    })
    : {
      createdCount: 0,
      retainedCount: 0,
      replacedCount: 0,
      removedCount: 0,
    };

  const refreshed = refreshLoadedGeneratedMiningScenes([...generatedMiningSystemIDs], nowMs);
  return {
    skipped: false,
    reason: "server_restart_reset",
    purgedCount: purgedInstanceIDs.length,
    purgedInstanceIDs,
    affectedSystemIDs: [...affectedSystemIDs].sort((left, right) => left - right),
    desiredIceSites: miningDefinitions.length,
    desiredOreSites: oreDefinitions.length,
    createdInstances:
      Math.max(0, toInt(miningInstanceSummary && miningInstanceSummary.createdCount, 0)) +
      Math.max(0, toInt(oreInstanceSummary && oreInstanceSummary.createdCount, 0)),
    retainedInstances:
      Math.max(0, toInt(miningInstanceSummary && miningInstanceSummary.retainedCount, 0)) +
      Math.max(0, toInt(oreInstanceSummary && oreInstanceSummary.retainedCount, 0)),
    replacedInstances:
      Math.max(0, toInt(miningInstanceSummary && miningInstanceSummary.replacedCount, 0)) +
      Math.max(0, toInt(oreInstanceSummary && oreInstanceSummary.replacedCount, 0)),
    removedInstances:
      Math.max(0, toInt(miningInstanceSummary && miningInstanceSummary.removedCount, 0)) +
      Math.max(0, toInt(oreInstanceSummary && oreInstanceSummary.removedCount, 0)),
    miningStateRowsCreated: Math.max(0, toInt(miningStateSummary && miningStateSummary.createdRows, 0)),
    miningStateRowsUpdated: Math.max(0, toInt(miningStateSummary && miningStateSummary.updatedRows, 0)),
    miningStateRowsRemoved: Math.max(0, toInt(miningStateSummary && miningStateSummary.removedRows, 0)),
    refreshedSceneCount: Math.max(0, toInt(refreshed && refreshed.refreshedCount, 0)),
    refreshedSystemIDs: Array.isArray(refreshed && refreshed.refreshedSystemIDs)
      ? refreshed.refreshedSystemIDs
      : [],
  };
}

function getInstanceObject(value, key) {
  return value && value[key] && typeof value[key] === "object" && !Array.isArray(value[key])
    ? value[key]
    : {};
}

function getGeneratedIceProviderID(instance) {
  const metadata = getInstanceObject(instance, "metadata");
  return normalizeLowerText(metadata.providerID, "");
}

function resolveInstanceSourceDungeonID(instance) {
  const metadata = getInstanceObject(instance, "metadata");
  const spawnState = getInstanceObject(instance, "spawnState");
  const template = dungeonAuthority.getTemplateByID(normalizeText(instance && instance.templateID, ""));
  return Math.max(
    0,
    toInt(
      instance && instance.sourceDungeonID,
      toInt(
        metadata.sourceDungeonID,
        toInt(spawnState.sourceDungeonID, toInt(template && template.sourceDungeonID, 0)),
      ),
    ),
  );
}

function resolveInstanceArchetypeID(instance) {
  const template = dungeonAuthority.getTemplateByID(normalizeText(instance && instance.templateID, ""));
  return Math.max(0, toInt(instance && instance.archetypeID, toInt(template && template.archetypeID, 0)));
}

function isGeneratedIceRuntimeInstance(instance) {
  if (!instance || normalizeLowerText(instance.siteFamily, "") !== "ice") {
    return false;
  }
  const runtimeFlags = getInstanceObject(instance, "runtimeFlags");
  const providerID = getGeneratedIceProviderID(instance);
  const siteOrigin = normalizeLowerText(instance.siteOrigin, "");
  return (
    siteOrigin === "generatedmining" ||
    providerID === "generatedmining" ||
    runtimeFlags.generatedMining === true ||
    (runtimeFlags.shadowProviderSite === true && providerID === "generatedmining")
  );
}

function isIceAuthorityRuntimeInstance(instance) {
  if (!instance) {
    return false;
  }
  if (isGeneratedIceRuntimeInstance(instance)) {
    return true;
  }
  const siteFamily = normalizeLowerText(instance.siteFamily, "");
  const archetypeID = resolveInstanceArchetypeID(instance);
  return siteFamily === "ice" || archetypeID === 28;
}

function listActiveIceAuthorityRuntimeInstances(systemIDs = null) {
  const targetedSystemIDs = new Set<any>(normalizeSystemIDs(systemIDs));
  const byInstanceID = new Map();
  const candidates = (
    Array.isArray(systemIDs) &&
    systemIDs.length > 0 &&
    targetedSystemIDs.size > 0 &&
    targetedSystemIDs.size <= INDEXED_SYSTEM_LOOKUP_LIMIT
  )
    ? [...targetedSystemIDs].flatMap((systemID) => (
      dungeonRuntime.listInstancesBySystem(systemID, { full: true, activeOnly: true })
    ))
    : [
      ...dungeonRuntime.listInstancesByLifecycle("seeded", { full: true }),
      ...dungeonRuntime.listInstancesByLifecycle("active", { full: true }),
      ...dungeonRuntime.listInstancesByLifecycle("paused", { full: true }),
    ];
  for (const instance of candidates) {
    const systemID = Math.max(0, toInt(instance && instance.solarSystemID, 0));
    if (systemID <= 0 || (targetedSystemIDs.size > 0 && !targetedSystemIDs.has(systemID))) {
      continue;
    }
    if (isIceAuthorityRuntimeInstance(instance)) {
      byInstanceID.set(toInt(instance.instanceID, 0), instance);
    }
  }
  return [...byInstanceID.values()].sort((left, right) => (
    toInt(left && left.solarSystemID, 0) - toInt(right && right.solarSystemID, 0) ||
    toInt(left && left.instanceID, 0) - toInt(right && right.instanceID, 0)
  ));
}

function listActiveGeneratedIceRuntimeInstances(systemIDs = null) {
  return listActiveIceAuthorityRuntimeInstances(systemIDs);
}

function getIceRuntimeKind(instance) {
  if (isGeneratedIceRuntimeInstance(instance)) {
    return "generated_mining";
  }
  if (resolveInstanceArchetypeID(instance) === 28) {
    return "normal_ice_belt";
  }
  return "ice_family";
}

function buildGeneratedIceAuthorityAuditEntry(instance) {
  const systemID = Math.max(0, toInt(instance && instance.solarSystemID, 0));
  const archetypeID = resolveInstanceArchetypeID(instance);
  const runtimeFlags = getInstanceObject(instance, "runtimeFlags");
  const metadata = getInstanceObject(instance, "metadata");
  const spawnState = getInstanceObject(instance, "spawnState");
  const authorityRow = iceSystemAuthority.getIceSystemAuthorityRow(systemID);
  const expectedSourceDungeonID = Math.max(0, toInt(authorityRow && authorityRow.sourceDungeonID, 0));
  const expectedTemplateID = authorityRow && expectedSourceDungeonID > 0
    ? `client-dungeon:${expectedSourceDungeonID}`
    : null;
  const sourceDungeonID = resolveInstanceSourceDungeonID(instance);
  const templateID = normalizeText(instance && instance.templateID, "");
  const authorityKey = normalizeText(
    metadata.authorityKey,
    normalizeText(spawnState.authorityKey, ""),
  );
  const reasons: any[] = [];

  if (!authorityRow) {
    reasons.push("system_not_in_ice_authority");
  } else {
    if (sourceDungeonID <= 0) {
      reasons.push("source_dungeon_missing");
    } else if (sourceDungeonID !== expectedSourceDungeonID) {
      reasons.push("source_dungeon_mismatch");
    }
    if (templateID && expectedTemplateID && templateID !== expectedTemplateID) {
      reasons.push("template_mismatch");
    }
    if (authorityKey && authorityKey !== authorityRow.authorityKey) {
      reasons.push("authority_key_mismatch");
    }
  }

  if (runtimeFlags.shadowProviderSite === true) {
    reasons.push("legacy_shadow_provider_generated_ice");
  }
  if (
    normalizeLowerText(instance && instance.siteOrigin, "") === "generatedmining" &&
    runtimeFlags.universeSeeded !== true
  ) {
    reasons.push("not_universe_seeded_generated_ice");
  }

  return {
    instanceID: Math.max(0, toInt(instance && instance.instanceID, 0)),
    solarSystemID: systemID,
    siteKey: normalizeText(instance && instance.siteKey, ""),
    lifecycleState: normalizeLowerText(instance && instance.lifecycleState, ""),
    siteOrigin: normalizeLowerText(instance && instance.siteOrigin, ""),
    providerID: getGeneratedIceProviderID(instance),
    runtimeKind: getIceRuntimeKind(instance),
    archetypeID: archetypeID || null,
    sourceDungeonID: sourceDungeonID || null,
    expectedSourceDungeonID: expectedSourceDungeonID || null,
    templateID: templateID || null,
    expectedTemplateID: expectedTemplateID || null,
    authorityKey: authorityKey || null,
    expectedAuthorityKey: authorityRow && authorityRow.authorityKey || null,
    runtimeFlags: cloneValue(runtimeFlags),
    valid: reasons.length === 0,
    reasons,
  };
}

function auditGeneratedIceAuthority(options: Record<string, any> = {}) {
  const includeValid = options.includeValid === true;
  const entries: any[] = [];
  let validCount = 0;
  let invalidCount = 0;
  for (const instance of listActiveGeneratedIceRuntimeInstances(options.systemIDs)) {
    const entry = buildGeneratedIceAuthorityAuditEntry(instance);
    if (entry.valid) {
      validCount += 1;
      if (includeValid) {
        entries.push(entry);
      }
    } else {
      invalidCount += 1;
      entries.push(entry);
    }
  }
  return {
    scannedCount: validCount + invalidCount,
    validCount,
    invalidCount,
    invalidInstanceIDs: entries
      .filter((entry) => entry.valid !== true)
      .map((entry) => entry.instanceID),
    entries,
  };
}

function cleanupInvalidGeneratedIceAuthority(options: Record<string, any> = {}) {
  const nowMs = Math.max(0, toInt(options.nowMs, Date.now()));
  const applyCleanup = options.apply === true || options.dryRun === false;
  const hasSystemFilter = Array.isArray(options.systemIDs);
  const targetedSystemIDs = hasSystemFilter
    ? normalizeProvidedSystemIDs(options.systemIDs)
    : null;
  if (hasSystemFilter && targetedSystemIDs.length <= 0) {
    return {
      scannedCount: 0,
      validCount: 0,
      invalidCount: 0,
      invalidInstanceIDs: [],
      entries: [],
      applied: false,
      dryRun: !applyCleanup,
      affectedSystemIDs: [],
      despawnedCount: 0,
      despawnedInstanceIDs: [],
      miningStateRowsRemoved: 0,
      miningStateRowsUpdated: 0,
      miningStateRowsCreated: 0,
      refreshedSystemIDs: [],
      refreshedSceneCount: 0,
      skipped: true,
      reason: "no_startup_systems",
    };
  }
  const audit = auditGeneratedIceAuthority({
    systemIDs: hasSystemFilter ? targetedSystemIDs : options.systemIDs,
    includeValid: options.includeValid === true,
  });
  const invalidEntries = audit.entries.filter((entry) => entry.valid !== true);
  const affectedSystemIDs = [...new Set(
    invalidEntries
      .map((entry) => Math.max(0, toInt(entry && entry.solarSystemID, 0)))
      .filter((entry) => entry > 0),
  )].sort((left, right) => left - right);

  if (!applyCleanup || invalidEntries.length <= 0) {
    return {
      ...audit,
      applied: false,
      dryRun: true,
      affectedSystemIDs,
      despawnedCount: 0,
      despawnedInstanceIDs: [],
      miningStateRowsRemoved: 0,
      miningStateRowsUpdated: 0,
      miningStateRowsCreated: 0,
      refreshedSystemIDs: [],
      refreshedSceneCount: 0,
    };
  }

  const despawnedInstanceIDs: any[] = [];
  for (const entry of invalidEntries) {
    const updated = dungeonRuntime.setLifecycleState(entry.instanceID, "despawned", {
      nowMs,
      despawnAtMs: nowMs,
      lifecycleReason: "invalid_ice_authority",
      expiresAtMs: 0,
    });
    if (updated && normalizeLowerText(updated.lifecycleState, "") === "despawned") {
      despawnedInstanceIDs.push(entry.instanceID);
    }
  }

  const miningState = affectedSystemIDs.length > 0
    ? reconcileGeneratedMiningRuntimeState(
      listActiveGeneratedMiningDefinitionsFromRuntime(affectedSystemIDs),
      affectedSystemIDs,
      nowMs,
    )
    : {
      createdRows: 0,
      updatedRows: 0,
      removedRows: 0,
    };
  const sceneRefresh = options.refreshLoadedScenes === false
    ? {
      refreshedCount: 0,
      refreshedSystemIDs: [],
    }
    : refreshLoadedGeneratedMiningScenes(affectedSystemIDs, nowMs);

  return {
    ...audit,
    applied: true,
    dryRun: false,
    affectedSystemIDs,
    despawnedCount: despawnedInstanceIDs.length,
    despawnedInstanceIDs,
    miningStateRowsRemoved: Math.max(0, toInt(miningState && miningState.removedRows, 0)),
    miningStateRowsUpdated: Math.max(0, toInt(miningState && miningState.updatedRows, 0)),
    miningStateRowsCreated: Math.max(0, toInt(miningState && miningState.createdRows, 0)),
    refreshedSystemIDs: sceneRefresh.refreshedSystemIDs || [],
    refreshedSceneCount: Math.max(0, toInt(sceneRefresh && sceneRefresh.refreshedCount, 0)),
  };
}

function listUniverseSeededPersistentSiteInstances(systemIDs = null) {
  const targetedSystemIDs = new Set<any>(normalizeSystemIDs(systemIDs));
  const byInstanceID = new Map();
  const candidates = (
    Array.isArray(systemIDs) &&
    systemIDs.length > 0 &&
    targetedSystemIDs.size > 0 &&
    targetedSystemIDs.size <= INDEXED_SYSTEM_LOOKUP_LIMIT
  )
    ? [...targetedSystemIDs].flatMap((systemID) => (
      dungeonRuntime.listInstancesBySystem(systemID, { full: true, activeOnly: true })
    ))
    : [
      ...dungeonRuntime.listInstancesByLifecycle("seeded", { full: true }),
      ...dungeonRuntime.listInstancesByLifecycle("active", { full: true }),
      ...dungeonRuntime.listInstancesByLifecycle("paused", { full: true }),
    ];
  for (const instance of candidates) {
    if (!instance || !(instance.runtimeFlags && instance.runtimeFlags.universeSeeded === true)) {
      continue;
    }
    if (String(instance.siteOrigin || "").trim().toLowerCase() === "generatedmining") {
      continue;
    }
    if (
      targetedSystemIDs.size > 0 &&
      !targetedSystemIDs.has(toInt(instance && instance.solarSystemID, 0))
    ) {
      continue;
    }
    byInstanceID.set(instance.instanceID, instance);
  }
  return [...byInstanceID.values()].sort((left, right) => left.instanceID - right.instanceID);
}

function summarizeActiveUniverseSeededCounts(systemIDs = null) {
  const generatedMiningCount = listUniverseSeededGeneratedMiningInstances(systemIDs).length;
  const persistentCount = listUniverseSeededPersistentSiteInstances(systemIDs).length;
  return {
    generatedMiningCount,
    persistentCount,
    totalCount: generatedMiningCount + persistentCount,
  };
}

function reconcileUniversePersistentSites(options: Record<string, any> = {}) {
  const progressLabel = normalizeText(options.progressLabel, "full universe");
  const logProgress = options.logProgress !== false;
  const nowMs = Math.max(0, toInt(options.nowMs, Date.now()));
  const systemIDs = normalizeSystemIDs(options.systemIDs);
  const includeMining = options.includeMining !== false;
  const includeBroad = options.includeBroad !== false;
  const startedAtMs = Date.now();
  if (logProgress) {
    log.info(
      `[DungeonUniverse] ${progressLabel}: starting reconcile for ${systemIDs.length} systems ` +
      `(mining=${includeMining}, broad=${includeBroad})`,
    );
  }

  const miningStartMs = Date.now();
  const miningDefinitions = includeMining
    ? listDesiredGeneratedMiningDefinitions(systemIDs, nowMs)
    : [];
  if (logProgress) {
    log.info(
      `[DungeonUniverse] ${progressLabel}: built ${miningDefinitions.length} generated mining definitions in ${Date.now() - miningStartMs}ms`,
    );
  }

  const broadStartMs = Date.now();
  const broadResult = includeBroad
    ? listDesiredUniverseDungeonSiteDefinitions(systemIDs, nowMs, {
      rng: options.rng,
      allocatedSystemIDsByBand: options.allocatedSystemIDsByBand,
    })
    : { definitions: [], families: {} };
  if (logProgress) {
    log.info(
      `[DungeonUniverse] ${progressLabel}: built ${broadResult.definitions.length} broad persistent definitions in ${Date.now() - broadStartMs}ms`,
    );
  }
  const allDefinitions = [
    ...miningDefinitions,
    ...broadResult.definitions,
  ];

  const instanceStartMs = Date.now();
  const instanceSummary = dungeonRuntime.reconcileUniverseSeededInstances(allDefinitions, {
    systemIDs,
    nowMs,
    preserveSiteKeys: includeMining
      ? listProtectedGeneratedMiningSiteKeys(systemIDs, nowMs)
      : [],
  });
  if (logProgress) {
    log.info(
      `[DungeonUniverse] ${progressLabel}: reconciled ${allDefinitions.length} dungeon instances in ${Date.now() - instanceStartMs}ms`,
    );
  }

  const miningStateStartMs = Date.now();
  const persistedMiningState = reconcileGeneratedMiningRuntimeState(
    listActiveGeneratedMiningDefinitionsFromRuntime(systemIDs),
    systemIDs,
    nowMs,
  );
  const invalidGeneratedIceCleanup = includeMining && options.cleanupInvalidGeneratedIce !== false
    ? cleanupInvalidGeneratedIceAuthority({
      systemIDs,
      nowMs,
      apply: true,
    })
    : {
      scannedCount: 0,
      invalidCount: 0,
      despawnedCount: 0,
      miningStateRowsRemoved: 0,
    };
  if (logProgress) {
    log.info(
      `[DungeonUniverse] ${progressLabel}: reconciled mining runtime rows in ${Date.now() - miningStateStartMs}ms`,
    );
  }

  const summary = {
    systemCount: systemIDs.length,
    desiredSiteCount: allDefinitions.length,
    createdInstances: instanceSummary.createdCount,
    retainedInstances: instanceSummary.retainedCount,
    replacedInstances: instanceSummary.replacedCount,
    removedInstances: instanceSummary.removedCount,
    miningStateRowsCreated: persistedMiningState.createdRows,
    miningStateRowsRemoved:
      persistedMiningState.removedRows +
      Math.max(0, toInt(invalidGeneratedIceCleanup && invalidGeneratedIceCleanup.miningStateRowsRemoved, 0)),
    invalidGeneratedIceScanned: Math.max(0, toInt(invalidGeneratedIceCleanup && invalidGeneratedIceCleanup.scannedCount, 0)),
    invalidGeneratedIceFound: Math.max(0, toInt(invalidGeneratedIceCleanup && invalidGeneratedIceCleanup.invalidCount, 0)),
    invalidGeneratedIceDespawned: Math.max(0, toInt(invalidGeneratedIceCleanup && invalidGeneratedIceCleanup.despawnedCount, 0)),
    mining: {
      desiredSiteCount: miningDefinitions.length,
    },
    families: broadResult.families,
    elapsedMs: Date.now() - startedAtMs,
  };

  if (logProgress) {
    log.info(
      `[DungeonUniverse] ${progressLabel}: done in ${summary.elapsedMs}ms ` +
        `(${summary.desiredSiteCount} desired sites across ${summary.systemCount} systems, ` +
        `created ${summary.createdInstances}, retained ${summary.retainedInstances}, ` +
        `replaced ${summary.replacedInstances}, removed ${summary.removedInstances}, ` +
        `mining rows +${summary.miningStateRowsCreated}/-${summary.miningStateRowsRemoved})`,
    );
  }

  if (
    (!Array.isArray(options.systemIDs) || options.systemIDs.length <= 0) &&
    options.recordMeta !== false
  ) {
    writeUniverseReconcileMeta(summary, {
      descriptor: options.descriptor || buildUniverseDescriptor(nowMs),
      startedAtMs,
      completedAtMs: Date.now(),
      scope: "full",
      reason: normalizeText(options.reason, "manual"),
      nowMs,
    });
  }

  return summary;
}

function clearBackgroundReconcileTimer() {
  if (backgroundReconcileTimer) {
    clearTimeout(backgroundReconcileTimer);
    backgroundReconcileTimer = null;
  }
}

function scheduleNextBackgroundReconcileSlice() {
  clearBackgroundReconcileTimer();
  if (!backgroundReconcileJob || backgroundReconcileJob.completed === true) {
    return;
  }
  const baseDelayMs = backgroundReconcileJob.sliceCount <= 0
    ? Math.max(BACKGROUND_RECONCILE_DELAY_MS, toInt(backgroundReconcileJob.initialDelayMs, BACKGROUND_RECONCILE_DELAY_MS))
    : Math.max(
      BACKGROUND_RECONCILE_DELAY_MS,
      Math.max(0, toInt(backgroundReconcileJob.retryNotBeforeMs, 0) - Date.now()),
    );
  const delayMs = Math.max(
    baseDelayMs,
    interactiveWorkloadGate.getBackgroundDeferralDelayMs(),
  );
  backgroundReconcileTimer = setTimeout(() => {
    backgroundReconcileTimer = null;
    // Yield through the poll phase before starting synchronous authority work,
    // allowing a newly arrived socket packet to activate the login gate.
    setImmediate(() => {
      if (interactiveWorkloadGate.shouldDeferBackgroundWork()) {
        scheduleNextBackgroundReconcileSlice();
        return;
      }
      Promise.resolve(runBackgroundUniverseReconcileSlice()).catch((error) => {
        if (backgroundReconcileJob) {
          backgroundReconcileJob.consecutiveFailureCount = Math.max(
            1,
            toInt(backgroundReconcileJob.consecutiveFailureCount, 0) + 1,
          );
          const retryDelayMs = Math.min(
            30_000,
            1_000 * (2 ** Math.min(5, backgroundReconcileJob.consecutiveFailureCount - 1)),
          );
          backgroundReconcileJob.retryNotBeforeMs = Date.now() + retryDelayMs;
        }
        log.warn(
          `[DungeonUniverse] background reconcile slice failed: ${error.message}`,
        );
        if (backgroundReconcileJob) {
          scheduleNextBackgroundReconcileSlice();
        }
      });
    });
  }, delayMs);
  if (typeof backgroundReconcileTimer.unref === "function") {
    backgroundReconcileTimer.unref();
  }
}

function completeBackgroundUniverseReconcileJob() {
  if (!backgroundReconcileJob) {
    return null;
  }
  const completed = {
    ...backgroundReconcileJob,
    completed: true,
    completedAtMs: Date.now(),
  };
  const summary = {
    systemCount: completed.systemIDs.length,
    desiredSiteCount: completed.desiredSiteCount,
    desiredMiningSiteCount: completed.desiredMiningSiteCount,
    desiredPersistentSiteCount: completed.desiredPersistentSiteCount,
    createdInstances: completed.createdInstances,
    retainedInstances: completed.retainedInstances,
    replacedInstances: completed.replacedInstances,
    removedInstances: completed.removedInstances,
    miningStateRowsCreated: completed.miningStateRowsCreated,
    miningStateRowsRemoved: completed.miningStateRowsRemoved,
    invalidGeneratedIceScanned: completed.invalidGeneratedIceScanned,
    invalidGeneratedIceFound: completed.invalidGeneratedIceFound,
    invalidGeneratedIceDespawned: completed.invalidGeneratedIceDespawned,
    elapsedMs: completed.completedAtMs - completed.startedAtMs,
  };
  writeUniverseReconcileMeta(summary, {
    descriptor: completed.descriptor,
    startedAtMs: completed.startedAtMs,
    completedAtMs: completed.completedAtMs,
    scope: "full",
    reason: completed.reason,
    nowMs: completed.nowMs,
  });
  log.info(
    `[DungeonUniverse] background full reconcile complete in ${summary.elapsedMs}ms ` +
      `(${summary.desiredSiteCount} desired sites, created ${summary.createdInstances}, ` +
      `retained ${summary.retainedInstances}, replaced ${summary.replacedInstances}, removed ${summary.removedInstances})`,
  );
  backgroundReconcileJob = null;
  backgroundFamilyAllocationCache = null;
  clearBackgroundReconcileTimer();
  return summary;
}

function familyUsesRandomAllocation(family) {
  const profile = dungeonAuthority.getSpawnProfile(family);
  if (!profile || profile.enabled === false || profile.persistent === false) {
    return false;
  }
  for (const band of ["highsec", "lowsec", "nullsec", "wormhole"]) {
    const bandProfile = profile.bands && profile.bands[band];
    if (bandProfile && bandProfileUsesRandomAllocation(family, band, bandProfile)) {
      return true;
    }
  }
  return false;
}

function buildRandomAllocatedSystemPlanForFamily(family, options: Record<string, any> = {}) {
  const profile = dungeonAuthority.getSpawnProfile(family);
  const allocatedSystemIDsByBand: Record<string, any> = {};
  const bands: Record<string, any> = {};
  if (!profile || profile.enabled === false || profile.persistent === false) {
    return {
      family,
      allocatedSystemIDsByBand,
      bands,
    };
  }
  for (const band of ["highsec", "lowsec", "nullsec", "wormhole"]) {
    const bandProfile = profile.bands && profile.bands[band];
    if (!bandProfile || !bandProfileUsesRandomAllocation(family, band, bandProfile)) {
      continue;
    }
    const plan = buildRandomAllocatedSystemPlanForBand(family, band, bandProfile, options);
    allocatedSystemIDsByBand[band] = plan.allocatedSystemIDs || [];
    bands[band] = {
      targetSystemCount: plan.targetSystemCount,
      candidateSystemCount: plan.candidateSystemCount,
      allocatedSystemCount: (plan.allocatedSystemIDs || []).length,
    };
  }
  return {
    family,
    allocatedSystemIDsByBand,
    bands,
  };
}

function snapshotActiveRandomAllocationInstances(family) {
  return listUniverseSeededPersistentSiteInstances()
    .filter((instance) => (
      normalizeLowerText(instance && instance.siteOrigin, "") === "universe_dungeon" &&
      getInstanceSpawnFamilyKey(instance) === normalizeLowerText(family, "")
    ))
    .map((instance) => cloneValue(instance));
}

async function buildRandomAllocatedSystemPlanForFamilyInWorker(family) {
  const activeInstances = snapshotActiveRandomAllocationInstances(family);
  try {
    return await worldPlanningPool.buildRandomAllocatedSystemPlanForFamily(
      family,
      { activeInstances },
    );
  } catch (error) {
    log.warn(
      `[DungeonUniverse] isolated worker planning failed for ${family}: ${error.message}`,
    );
    throw error;
  }
}

async function reconcileUniverseSeededInstancesInWorker(
  definitions: any[] = [],
  options: Record<string, any> = {},
) {
  const snapshot = dungeonRuntime.snapshotUniverseSeededReconcileState(options);
  const workerOptions = {
    systemIDs: Array.isArray(options.systemIDs) ? options.systemIDs : [],
    siteFamilyFilter: Array.isArray(options.siteFamilyFilter) ? options.siteFamilyFilter : [],
    spawnFamilyFilter: Array.isArray(options.spawnFamilyFilter) ? options.spawnFamilyFilter : [],
    siteOriginFilter: Array.isArray(options.siteOriginFilter) ? options.siteOriginFilter : [],
    preserveSiteKeys: Array.isArray(options.preserveSiteKeys) ? options.preserveSiteKeys : [],
    nowMs: Math.max(0, toInt(options.nowMs, Date.now())),
  };
  const plan = await worldPlanningPool.buildUniverseSeededReconcilePlan(
    definitions,
    snapshot,
    workerOptions,
    {
      timeoutMs: Math.max(1_000, toInt(options.workerTimeoutMs, 30_000)),
    },
  );
  // A worker job may have started while the server was idle and finish after a
  // login packet arrives.  Applying its plan is synchronous authority work, so
  // re-check the foreground gate at the worker boundary instead of allowing a
  // stale scheduling decision to block the station bootstrap.
  if (
    options.deferApplyWhenInteractive === true &&
    interactiveWorkloadGate.shouldDeferBackgroundWork()
  ) {
    return {
      deferred: true,
      reason: "interactive_login",
    };
  }
  return dungeonRuntime.applyUniverseSeededReconcilePlan(plan);
}

async function getBackgroundFamilyAllocationPlan(job, family) {
  if (
    backgroundFamilyAllocationCache &&
    backgroundFamilyAllocationCache.family === family &&
    backgroundFamilyAllocationCache.nowMs === Math.max(0, toInt(job && job.nowMs, 0))
  ) {
    return backgroundFamilyAllocationCache.plan;
  }
  const plan = await buildRandomAllocatedSystemPlanForFamilyInWorker(family);
  if (backgroundReconcileJob !== job || !plan) {
    return null;
  }
  backgroundFamilyAllocationCache = {
    family,
    nowMs: Math.max(0, toInt(job && job.nowMs, 0)),
    plan,
  };
  return plan;
}

async function runBackgroundUniverseReconcileSlice() {
  const job = backgroundReconcileJob;
  if (!job || job.completed === true) {
    return null;
  }

  const sliceSystemIDs = job.systemIDs.slice(job.systemIndex, job.systemIndex + job.batchSize);
  if (sliceSystemIDs.length <= 0) {
    job.familyIndex += 1;
    job.systemIndex = 0;
    if (job.familyIndex >= job.familyQueue.length) {
      return completeBackgroundUniverseReconcileJob();
    }
    log.info(
      `[DungeonUniverse] background full reconcile: switching to ${job.familyQueue[job.familyIndex]} ` +
      `(${job.familyIndex + 1}/${job.familyQueue.length})`,
    );
    return scheduleNextBackgroundReconcileSlice();
  }

  const family = job.familyQueue[job.familyIndex];
  let allocatedSystemIDsByBand = null;
  if (family !== "generatedmining" && familyUsesRandomAllocation(family)) {
    const allocationPlan = await getBackgroundFamilyAllocationPlan(job, family);
    if (backgroundReconcileJob !== job || !allocationPlan) {
      return null;
    }
    allocatedSystemIDsByBand = allocationPlan.allocatedSystemIDsByBand;
  }
  if (interactiveWorkloadGate.shouldDeferBackgroundWork()) {
    scheduleNextBackgroundReconcileSlice();
    return {
      family,
      deferred: true,
      reason: "interactive_login",
    };
  }
  const sliceStartMs = Date.now();
  if (family === "generatedmining") {
    const miningDefinitions = listDesiredGeneratedMiningDefinitions(sliceSystemIDs, job.nowMs);
    const instanceSummary = await reconcileUniverseSeededInstancesInWorker(miningDefinitions, {
      systemIDs: sliceSystemIDs,
      nowMs: job.nowMs,
      siteOriginFilter: ["generatedmining"],
      preserveSiteKeys: listProtectedGeneratedMiningSiteKeys(sliceSystemIDs, job.nowMs),
      deferApplyWhenInteractive: true,
    });
    if (instanceSummary && instanceSummary.deferred === true) {
      scheduleNextBackgroundReconcileSlice();
      return {
        family,
        deferred: true,
        reason: instanceSummary.reason || "interactive_login",
      };
    }
    const persistedMiningState = reconcileGeneratedMiningRuntimeState(
      listActiveGeneratedMiningDefinitionsFromRuntime(sliceSystemIDs),
      sliceSystemIDs,
      job.nowMs,
    );
    const invalidGeneratedIceCleanup = cleanupInvalidGeneratedIceAuthority({
      systemIDs: sliceSystemIDs,
      nowMs: job.nowMs,
      apply: true,
    });
    job.desiredSiteCount += miningDefinitions.length;
    job.desiredMiningSiteCount += miningDefinitions.length;
    job.createdInstances += instanceSummary.createdCount;
    job.retainedInstances += instanceSummary.retainedCount;
    job.replacedInstances += instanceSummary.replacedCount;
    job.removedInstances += instanceSummary.removedCount;
    job.miningStateRowsCreated += persistedMiningState.createdRows;
    job.miningStateRowsRemoved += (
      persistedMiningState.removedRows +
      Math.max(0, toInt(invalidGeneratedIceCleanup && invalidGeneratedIceCleanup.miningStateRowsRemoved, 0))
    );
    job.invalidGeneratedIceScanned += Math.max(0, toInt(invalidGeneratedIceCleanup && invalidGeneratedIceCleanup.scannedCount, 0));
    job.invalidGeneratedIceFound += Math.max(0, toInt(invalidGeneratedIceCleanup && invalidGeneratedIceCleanup.invalidCount, 0));
    job.invalidGeneratedIceDespawned += Math.max(0, toInt(invalidGeneratedIceCleanup && invalidGeneratedIceCleanup.despawnedCount, 0));
  } else {
    const broadResult = allocatedSystemIDsByBand
      ? listDesiredUniverseDungeonSiteDefinitions(
        sliceSystemIDs,
        job.nowMs,
        {
          families: [family],
          allocatedSystemIDsByBand,
        },
      )
      : listDesiredUniverseDungeonSiteDefinitions(
        sliceSystemIDs,
        job.nowMs,
        { families: [family] },
      );
    const instanceSummary = await reconcileUniverseSeededInstancesInWorker(broadResult.definitions, {
      systemIDs: sliceSystemIDs,
      nowMs: job.nowMs,
      spawnFamilyFilter: [family],
      deferApplyWhenInteractive: true,
    });
    if (instanceSummary && instanceSummary.deferred === true) {
      scheduleNextBackgroundReconcileSlice();
      return {
        family,
        deferred: true,
        reason: instanceSummary.reason || "interactive_login",
      };
    }
    job.desiredSiteCount += broadResult.definitions.length;
    job.desiredPersistentSiteCount += broadResult.definitions.length;
    job.createdInstances += instanceSummary.createdCount;
    job.retainedInstances += instanceSummary.retainedCount;
    job.replacedInstances += instanceSummary.replacedCount;
    job.removedInstances += instanceSummary.removedCount;
  }

  job.systemIndex += sliceSystemIDs.length;
  job.sliceCount += 1;
  job.consecutiveFailureCount = 0;
  job.retryNotBeforeMs = 0;
  const sliceElapsedMs = Date.now() - sliceStartMs;
  if (sliceElapsedMs > job.targetSliceMs && job.batchSize > 1) {
    job.batchSize = Math.max(1, Math.floor(job.batchSize / 2));
  } else if (
    sliceElapsedMs < Math.max(1, Math.floor(job.targetSliceMs / 2)) &&
    job.batchSize < job.maxBatchSize
  ) {
    job.batchSize = Math.min(job.maxBatchSize, job.batchSize + 1);
  }
  if (
    job.systemIndex >= job.systemIDs.length ||
    job.sliceCount === 1 ||
    (job.sliceCount % 10) === 0
  ) {
    log.info(
      `[DungeonUniverse] background full reconcile: ${family} slice ${job.sliceCount} ` +
        `processed ${Math.min(job.systemIndex, job.systemIDs.length)}/${job.systemIDs.length} systems ` +
        `in ${sliceElapsedMs}ms (next batch=${job.batchSize})`,
    );
  }

  scheduleNextBackgroundReconcileSlice();
  return {
    family,
    sliceSystemCount: sliceSystemIDs.length,
    elapsedMs: sliceElapsedMs,
  };
}

function scheduleBackgroundUniverseReconcile(options: Record<string, any> = {}) {
  const status = options.status || getUniverseReconcileStatus(options.nowMs);
  if (status.fullUpToDate) {
    return {
      scheduled: false,
      reason: "up_to_date",
      status,
    };
  }
  if (backgroundReconcileJob && backgroundReconcileJob.completed !== true) {
    return {
      scheduled: false,
      reason: "already_running",
      status,
      job: cloneValue(backgroundReconcileJob),
    };
  }

  const families = [
    ...dungeonAuthority.listUniverseSpawnFamilies(),
    ...listSovereigntyGuaranteedSpawnFamilies(),
  ];
  const systemIDs = normalizeSystemIDs();
  backgroundReconcileJob = {
    startedAtMs: Date.now(),
    nowMs: Math.max(0, toInt(options.nowMs, Date.now())),
    reason: normalizeText(options.reason, "stale"),
    descriptor: status.descriptor,
    systemIDs,
    familyQueue: ["generatedmining", ...families],
    familyIndex: 0,
    systemIndex: 0,
    batchSize: Math.max(
      1,
      toInt(options.batchSize, BACKGROUND_RECONCILE_INITIAL_BATCH_SIZE),
    ),
    maxBatchSize: Math.max(
      Math.max(
        1,
        toInt(options.batchSize, BACKGROUND_RECONCILE_INITIAL_BATCH_SIZE),
      ),
      toInt(options.maxBatchSize, BACKGROUND_RECONCILE_MAX_BATCH_SIZE),
    ),
    targetSliceMs: Math.max(
      1,
      toInt(options.targetSliceMs, BACKGROUND_RECONCILE_TARGET_SLICE_MS),
    ),
    initialDelayMs: Math.max(BACKGROUND_RECONCILE_DELAY_MS, toInt(options.initialDelayMs, 2_000)),
    sliceCount: 0,
    desiredSiteCount: 0,
    desiredMiningSiteCount: 0,
    desiredPersistentSiteCount: 0,
    createdInstances: 0,
    retainedInstances: 0,
    replacedInstances: 0,
    removedInstances: 0,
    miningStateRowsCreated: 0,
    miningStateRowsRemoved: 0,
    invalidGeneratedIceScanned: 0,
    invalidGeneratedIceFound: 0,
    invalidGeneratedIceDespawned: 0,
    consecutiveFailureCount: 0,
    retryNotBeforeMs: 0,
    completed: false,
  };
  log.info(
    `[DungeonUniverse] queued background full reconcile for ${systemIDs.length} systems ` +
      `because cached universe site state is stale (${backgroundReconcileJob.reason})`,
  );
  scheduleNextBackgroundReconcileSlice();
  return {
    scheduled: true,
    reason: backgroundReconcileJob.reason,
    status,
    job: cloneValue(backgroundReconcileJob),
  };
}

function getBackgroundUniverseReconcileJob() {
  return backgroundReconcileJob ? cloneValue(backgroundReconcileJob) : null;
}

function buildSystemUniverseReconcileFamilyQueue(options: Record<string, any> = {}) {
  const familyFilter = new Set((Array.isArray(options.families) ? options.families : [])
    .map((entry) => normalizeLowerText(entry, ""))
    .filter(Boolean));
  const hasFamilyFilter = familyFilter.size > 0;
  const queue: any[] = [];
  const seen = new Set<any>();
  const addFamily = (family) => {
    const normalizedFamily = normalizeLowerText(family, "");
    if (!normalizedFamily || seen.has(normalizedFamily)) {
      return;
    }
    if (hasFamilyFilter && !familyFilter.has(normalizedFamily)) {
      return;
    }
    seen.add(normalizedFamily);
    queue.push(normalizedFamily);
  };

  if (
    options.includeMining !== false &&
    (!hasFamilyFilter || familyFilter.has("generatedmining"))
  ) {
    addFamily("generatedmining");
  }
  if (options.includeBroad !== false) {
    for (const family of dungeonAuthority.listUniverseSpawnFamilies()) {
      if (
        !hasFamilyFilter &&
        options.includeRandomAllocatedUniverseFamilies !== true &&
        isWakeAllocatedUniverseFamily(family)
      ) {
        continue;
      }
      addFamily(family);
    }
    for (const family of listSovereigntyGuaranteedSpawnFamilies()) {
      addFamily(family);
    }
  }
  return queue;
}

function cloneSystemUniverseReconcileJob(job) {
  if (!job) {
    return null;
  }
  return cloneValue({
    systemID: job.systemID,
    startedAtMs: job.startedAtMs,
    nowMs: job.nowMs,
    reason: job.reason,
    familyQueue: job.familyQueue,
    familyIndex: job.familyIndex,
    sliceCount: job.sliceCount,
    initialDelayMs: job.initialDelayMs,
    sliceDelayMs: job.sliceDelayMs,
    desiredSiteCount: job.desiredSiteCount,
    desiredMiningSiteCount: job.desiredMiningSiteCount,
    desiredPersistentSiteCount: job.desiredPersistentSiteCount,
    createdInstances: job.createdInstances,
    retainedInstances: job.retainedInstances,
    replacedInstances: job.replacedInstances,
    removedInstances: job.removedInstances,
    miningStateRowsCreated: job.miningStateRowsCreated,
    miningStateRowsRemoved: job.miningStateRowsRemoved,
    invalidGeneratedIceScanned: job.invalidGeneratedIceScanned,
    invalidGeneratedIceFound: job.invalidGeneratedIceFound,
    invalidGeneratedIceDespawned: job.invalidGeneratedIceDespawned,
    queuedCallbackCount: Array.isArray(job.completionCallbacks)
      ? job.completionCallbacks.length
      : 0,
    completed: job.completed === true,
  });
}

function getSystemUniverseReconcileJob(systemID = null) {
  const numericSystemID = Math.max(0, toInt(systemID, 0));
  if (numericSystemID > 0) {
    return cloneSystemUniverseReconcileJob(systemUniverseReconcileJobs.get(numericSystemID) || null);
  }
  return [...systemUniverseReconcileJobs.values()]
    .map((job) => cloneSystemUniverseReconcileJob(job));
}

function clearSystemUniverseReconcileTimer() {
  if (systemUniverseReconcileTimer) {
    clearTimeout(systemUniverseReconcileTimer);
    systemUniverseReconcileTimer = null;
  }
}

function getNextSystemUniverseReconcileJob() {
  for (const job of systemUniverseReconcileJobs.values()) {
    if (job && job.completed !== true) {
      return job;
    }
  }
  return null;
}

function scheduleNextSystemUniverseReconcileSlice() {
  if (systemUniverseReconcileTimer || systemUniverseReconcileJobs.size <= 0) {
    return;
  }
  const job = getNextSystemUniverseReconcileJob();
  if (!job) {
    return;
  }
  const baseDelayMs = job.sliceCount <= 0
    ? Math.max(0, toInt(job.initialDelayMs, SYSTEM_RECONCILE_INITIAL_DELAY_MS))
    : Math.max(0, toInt(job.sliceDelayMs, BACKGROUND_RECONCILE_DELAY_MS));
  const delayMs = Math.max(
    baseDelayMs,
    interactiveWorkloadGate.getBackgroundDeferralDelayMs(),
  );
  systemUniverseReconcileTimer = setTimeout(() => {
    systemUniverseReconcileTimer = null;
    setImmediate(() => {
      if (interactiveWorkloadGate.shouldDeferBackgroundWork()) {
        scheduleNextSystemUniverseReconcileSlice();
        return;
      }
      Promise.resolve(runSystemUniverseReconcileSlice()).catch((error) => {
        const activeJob = getNextSystemUniverseReconcileJob();
        if (activeJob) {
          completeSystemUniverseReconcileJob(activeJob, {
            error,
            family: activeJob.familyQueue[activeJob.familyIndex] || null,
          });
        }
        scheduleNextSystemUniverseReconcileSlice();
      });
    });
  }, delayMs);
  if (typeof systemUniverseReconcileTimer.unref === "function") {
    systemUniverseReconcileTimer.unref();
  }
}

function appendSystemUniverseReconcileCallback(job, callback) {
  if (!job || typeof callback !== "function") {
    return;
  }
  if (!Array.isArray(job.completionCallbacks)) {
    job.completionCallbacks = [];
  }
  job.completionCallbacks.push(callback);
}

function mergeFamilySummaries(target, source) {
  if (!target || !source || typeof source !== "object") {
    return;
  }
  for (const [family, summary] of Object.entries<any>(source)) {
    target[family] = summary;
  }
}

function addInstanceSummaryToSystemJob(job, instanceSummary) {
  job.createdInstances += Math.max(0, toInt(instanceSummary && instanceSummary.createdCount, 0));
  job.retainedInstances += Math.max(0, toInt(instanceSummary && instanceSummary.retainedCount, 0));
  job.replacedInstances += Math.max(0, toInt(instanceSummary && instanceSummary.replacedCount, 0));
  job.removedInstances += Math.max(0, toInt(instanceSummary && instanceSummary.removedCount, 0));
}

function completeSystemUniverseReconcileJob(job, failure = null) {
  if (!job) {
    return null;
  }
  const completedAtMs = Date.now();
  job.completed = true;
  const summary = {
    systemCount: 1,
    desiredSiteCount: job.desiredSiteCount,
    desiredMiningSiteCount: job.desiredMiningSiteCount,
    desiredPersistentSiteCount: job.desiredPersistentSiteCount,
    createdInstances: job.createdInstances,
    retainedInstances: job.retainedInstances,
    replacedInstances: job.replacedInstances,
    removedInstances: job.removedInstances,
    miningStateRowsCreated: job.miningStateRowsCreated,
    miningStateRowsRemoved: job.miningStateRowsRemoved,
    invalidGeneratedIceScanned: job.invalidGeneratedIceScanned,
    invalidGeneratedIceFound: job.invalidGeneratedIceFound,
    invalidGeneratedIceDespawned: job.invalidGeneratedIceDespawned,
    mining: {
      desiredSiteCount: job.desiredMiningSiteCount,
    },
    families: job.families,
    elapsedMs: completedAtMs - job.startedAtMs,
  };
  const failed = failure && failure.error;
  const result = failed
    ? {
      success: false,
      errorMsg: failure.error.message,
      systemID: job.systemID,
      family: failure.family || null,
      summary,
    }
    : {
      success: true,
      skipped: false,
      systemID: job.systemID,
      summary,
    };
  systemUniverseReconcileJobs.delete(job.systemID);
  if (!failed) {
    systemWakeReconcileState.set(job.systemID, {
      checkedAtMs: completedAtMs,
      nowMs: job.nowMs,
      reason: job.reason,
      summary,
    });
  }
  if (failed) {
    log.warn(
      `[DungeonUniverse] background system reconcile failed system=${job.systemID} ` +
        `family=${failure.family || "unknown"}: ${failure.error.message}`,
    );
  } else if (job.logProgress === true || summary.elapsedMs >= 500) {
    log.info(
      `[DungeonUniverse] background system reconcile complete system=${job.systemID} ` +
        `reason=${job.reason} in ${summary.elapsedMs}ms ` +
        `(${summary.desiredSiteCount} desired sites, created ${summary.createdInstances}, ` +
        `retained ${summary.retainedInstances}, replaced ${summary.replacedInstances}, ` +
        `removed ${summary.removedInstances})`,
    );
  }
  const callbacks = Array.isArray(job.completionCallbacks)
    ? [...job.completionCallbacks]
    : [];
  for (const callback of callbacks) {
    try {
      callback(result);
    } catch (error) {
      log.warn(
        `[DungeonUniverse] background system reconcile callback failed ` +
        `system=${job.systemID}: ${error.message}`,
      );
    }
  }
  return result;
}

function reconcileSystemUniverseFamilySlice(job, family) {
  if (family === "generatedmining") {
    const miningDefinitions = listDesiredGeneratedMiningDefinitions([job.systemID], job.nowMs);
    const instanceSummary = dungeonRuntime.reconcileUniverseSeededInstances(miningDefinitions, {
      systemIDs: [job.systemID],
      nowMs: job.nowMs,
      siteOriginFilter: ["generatedmining"],
      preserveSiteKeys: listProtectedGeneratedMiningSiteKeys([job.systemID], job.nowMs),
    });
    const persistedMiningState = reconcileGeneratedMiningRuntimeState(
      listActiveGeneratedMiningDefinitionsFromRuntime([job.systemID]),
      [job.systemID],
      job.nowMs,
    );
    const invalidGeneratedIceCleanup = job.cleanupInvalidGeneratedIce !== false
      ? cleanupInvalidGeneratedIceAuthority({
        systemIDs: [job.systemID],
        nowMs: job.nowMs,
        apply: true,
      })
      : {
        scannedCount: 0,
        invalidCount: 0,
        despawnedCount: 0,
        miningStateRowsRemoved: 0,
      };
    job.desiredSiteCount += miningDefinitions.length;
    job.desiredMiningSiteCount += miningDefinitions.length;
    addInstanceSummaryToSystemJob(job, instanceSummary);
    job.miningStateRowsCreated += Math.max(0, toInt(persistedMiningState && persistedMiningState.createdRows, 0));
    job.miningStateRowsRemoved += (
      Math.max(0, toInt(persistedMiningState && persistedMiningState.removedRows, 0)) +
      Math.max(0, toInt(invalidGeneratedIceCleanup && invalidGeneratedIceCleanup.miningStateRowsRemoved, 0))
    );
    job.invalidGeneratedIceScanned += Math.max(0, toInt(invalidGeneratedIceCleanup && invalidGeneratedIceCleanup.scannedCount, 0));
    job.invalidGeneratedIceFound += Math.max(0, toInt(invalidGeneratedIceCleanup && invalidGeneratedIceCleanup.invalidCount, 0));
    job.invalidGeneratedIceDespawned += Math.max(0, toInt(invalidGeneratedIceCleanup && invalidGeneratedIceCleanup.despawnedCount, 0));
    return {
      desiredSiteCount: miningDefinitions.length,
    };
  }

  const definitionOptions: Record<string, any> = {
    families: [family],
  };
  if (typeof job.rng === "function") {
    definitionOptions.rng = job.rng;
  }
  const familyAllocation = job.randomAllocationPlans &&
    job.randomAllocationPlans[family];
  if (familyAllocation && typeof familyAllocation === "object") {
    definitionOptions.allocatedSystemIDsByBand = familyAllocation;
  } else if (job.allocatedSystemIDsByBand && typeof job.allocatedSystemIDsByBand === "object") {
    definitionOptions.allocatedSystemIDsByBand = job.allocatedSystemIDsByBand;
  } else if (familyUsesRandomAllocation(family)) {
    throw new Error(`random allocation plan is not ready for ${family}`);
  }
  const broadResult = listDesiredUniverseDungeonSiteDefinitions(
    [job.systemID],
    job.nowMs,
    definitionOptions,
  );
  const instanceSummary = dungeonRuntime.reconcileUniverseSeededInstances(broadResult.definitions, {
    systemIDs: [job.systemID],
    nowMs: job.nowMs,
    spawnFamilyFilter: [family],
  });
  job.desiredSiteCount += broadResult.definitions.length;
  job.desiredPersistentSiteCount += broadResult.definitions.length;
  addInstanceSummaryToSystemJob(job, instanceSummary);
  mergeFamilySummaries(job.families, broadResult.families);
  return {
    desiredSiteCount: broadResult.definitions.length,
  };
}

async function runSystemUniverseReconcileSlice() {
  clearSystemUniverseReconcileTimer();
  const job = getNextSystemUniverseReconcileJob();
  if (!job) {
    return null;
  }
  const family = job.familyQueue[job.familyIndex];
  if (!family) {
    const result = completeSystemUniverseReconcileJob(job);
    scheduleNextSystemUniverseReconcileSlice();
    return result;
  }

  if (
    family !== "generatedmining" &&
    familyUsesRandomAllocation(family) &&
    !(job.randomAllocationPlans && job.randomAllocationPlans[family]) &&
    !(job.allocatedSystemIDsByBand && typeof job.allocatedSystemIDsByBand === "object")
  ) {
    try {
      // System-wake reconciliation is intentionally small and already runs in
      // background slices. Do not send its allocation planning through the
      // shared world-planning pool: each dungeon worker must load the full
      // universe tables, and on a cold server those workers can occupy every
      // slot needed by ensureSceneReady while duplicating several GiB of world
      // data. The deterministic candidate rankings are cached in-process, so
      // the local path is both bounded and substantially cheaper here.
      const plan = buildRandomAllocatedSystemPlanForFamily(family, {
        activeInstances: snapshotActiveRandomAllocationInstances(family),
        ...(typeof job.rng === "function" ? { rng: job.rng } : {}),
      });
      if (systemUniverseReconcileJobs.get(job.systemID) !== job) {
        return null;
      }
      job.randomAllocationPlans[family] = plan.allocatedSystemIDsByBand;
    } catch (error) {
      const result = completeSystemUniverseReconcileJob(job, { error, family });
      scheduleNextSystemUniverseReconcileSlice();
      return result;
    }
  }

  if (interactiveWorkloadGate.shouldDeferBackgroundWork()) {
    scheduleNextSystemUniverseReconcileSlice();
    return {
      success: true as const,
      deferred: true,
      reason: "interactive_login",
      family,
      systemID: job.systemID,
    };
  }

  const sliceStartMs = Date.now();
  let sliceSummary;
  try {
    sliceSummary = reconcileSystemUniverseFamilySlice(job, family);
  } catch (error) {
    const result = completeSystemUniverseReconcileJob(job, { error, family });
    scheduleNextSystemUniverseReconcileSlice();
    return result;
  }
  job.familyIndex += 1;
  job.sliceCount += 1;
  const elapsedMs = Date.now() - sliceStartMs;
  if (elapsedMs >= 500 || job.logProgress === true) {
    log.info(
      `[DungeonUniverse] background system reconcile system=${job.systemID} ` +
        `family=${family} slice=${job.sliceCount}/${job.familyQueue.length} ` +
        `desired=${Math.max(0, toInt(sliceSummary && sliceSummary.desiredSiteCount, 0))} ` +
        `took ${elapsedMs}ms`,
    );
  }
  if (job.familyIndex >= job.familyQueue.length) {
    const result = completeSystemUniverseReconcileJob(job);
    scheduleNextSystemUniverseReconcileSlice();
    return {
      success: true as const,
      family,
      systemID: job.systemID,
      elapsedMs,
      completed: true,
      result,
    };
  }

  systemUniverseReconcileJobs.delete(job.systemID);
  systemUniverseReconcileJobs.set(job.systemID, job);
  scheduleNextSystemUniverseReconcileSlice();
  return {
    success: true as const,
    family,
    systemID: job.systemID,
    elapsedMs,
    completed: false,
  };
}

function scheduleSystemUniversePersistentSitesReconcile(systemID, options: Record<string, any> = {}) {
  const numericSystemID = Math.max(0, toInt(systemID, 0));
  if (numericSystemID <= 0) {
    return {
      success: false as const,
      scheduled: false,
      errorMsg: "INVALID_SYSTEM_ID",
    };
  }

  const existingJob = systemUniverseReconcileJobs.get(numericSystemID) || null;
  if (existingJob && existingJob.completed !== true) {
    appendSystemUniverseReconcileCallback(existingJob, options.onComplete);
    existingJob.force = existingJob.force === true || options.force === true;
    existingJob.logProgress = existingJob.logProgress === true || options.logProgress === true;
    return {
      success: true as const,
      scheduled: false,
      reason: "already_running",
      systemID: numericSystemID,
      job: cloneSystemUniverseReconcileJob(existingJob),
    };
  }

  const wallclockNowMs = Date.now();
  const nowMs = Math.max(0, toInt(options.nowMs, wallclockNowMs));
  const debounceMs = Math.max(0, toInt(options.debounceMs, SYSTEM_WAKE_RECONCILE_DEBOUNCE_MS));
  const currentState = systemWakeReconcileState.get(numericSystemID) || null;
  if (
    options.force !== true &&
    currentState &&
    debounceMs > 0 &&
    wallclockNowMs - Math.max(0, toInt(currentState.checkedAtMs, 0)) < debounceMs
  ) {
    return {
      success: true as const,
      scheduled: false,
      skipped: true,
      reason: "debounced",
      systemID: numericSystemID,
      previous: cloneValue(currentState.summary || null),
    };
  }

  const familyQueue = buildSystemUniverseReconcileFamilyQueue(options);
  if (familyQueue.length <= 0) {
    return {
      success: true as const,
      scheduled: false,
      skipped: true,
      reason: "no_families",
      systemID: numericSystemID,
    };
  }

  const job = {
    systemID: numericSystemID,
    startedAtMs: wallclockNowMs,
    nowMs,
    reason: normalizeText(options.reason, "system-wake"),
    includeMining: options.includeMining !== false,
    includeBroad: options.includeBroad !== false,
    cleanupInvalidGeneratedIce: options.cleanupInvalidGeneratedIce !== false,
    force: options.force === true,
    familyQueue,
    familyIndex: 0,
    sliceCount: 0,
    initialDelayMs: Math.max(0, toInt(options.initialDelayMs, SYSTEM_RECONCILE_INITIAL_DELAY_MS)),
    sliceDelayMs: Math.max(0, toInt(options.sliceDelayMs, BACKGROUND_RECONCILE_DELAY_MS)),
    rng: typeof options.rng === "function" ? options.rng : null,
    allocatedSystemIDsByBand:
      options.allocatedSystemIDsByBand && typeof options.allocatedSystemIDsByBand === "object"
        ? cloneValue(options.allocatedSystemIDsByBand)
        : null,
    randomAllocationPlans: {},
    desiredSiteCount: 0,
    desiredMiningSiteCount: 0,
    desiredPersistentSiteCount: 0,
    createdInstances: 0,
    retainedInstances: 0,
    replacedInstances: 0,
    removedInstances: 0,
    miningStateRowsCreated: 0,
    miningStateRowsRemoved: 0,
    invalidGeneratedIceScanned: 0,
    invalidGeneratedIceFound: 0,
    invalidGeneratedIceDespawned: 0,
    families: {},
    completionCallbacks: [],
    completed: false,
    logProgress: options.logProgress === true,
  };
  appendSystemUniverseReconcileCallback(job, options.onComplete);
  systemUniverseReconcileJobs.set(numericSystemID, job);
  scheduleNextSystemUniverseReconcileSlice();
  return {
    success: true as const,
    scheduled: true,
    reason: job.reason,
    systemID: numericSystemID,
    job: cloneSystemUniverseReconcileJob(job),
  };
}

function prepareSystemForPlayerEntry(systemID, options: Record<string, any> = {}) {
  const numericSystemID = Math.max(0, toInt(systemID, 0));
  if (numericSystemID <= 0) {
    return {
      success: false as const,
      errorMsg: "INVALID_SYSTEM_ID",
    };
  }

  const nowMs = Math.max(0, toInt(options.nowMs, Date.now()));
  const lifecycle = advanceUniversePersistentSites({
    systemIDs: [numericSystemID],
    nowMs,
    lifecycleReason: normalizeText(options.lifecycleReason, "system-wake"),
  });
  const reconcile = ensureSystemUniversePersistentSites(numericSystemID, {
    ...options,
    nowMs,
    force: true,
    debounceMs: 0,
    includeMining: options.includeMining !== false,
    includeBroad: options.includeBroad !== false,
    cleanupInvalidGeneratedIce: options.cleanupInvalidGeneratedIce !== false,
  });
  if (!reconcile || reconcile.success === false) {
    return {
      success: false as const,
      errorMsg: reconcile && reconcile.errorMsg || "SYSTEM_CONTENT_RECONCILE_FAILED",
      systemID: numericSystemID,
      lifecycle,
      reconcile,
    };
  }

  const miningSceneRefresh = options.refreshLoadedMiningScene === false
    ? {
      refreshedCount: 0,
      refreshedSystemIDs: [],
    }
    : refreshLoadedGeneratedMiningScenes([numericSystemID], nowMs);
  return {
    success: true as const,
    systemID: numericSystemID,
    nowMs,
    lifecycle,
    reconcile,
    miningSceneRefresh,
  };
}

function ensureSystemUniversePersistentSites(systemID, options: Record<string, any> = {}) {
  const numericSystemID = Math.max(0, toInt(systemID, 0));
  if (numericSystemID <= 0) {
    return {
      success: false as const,
      errorMsg: "INVALID_SYSTEM_ID",
    };
  }

  const wallclockNowMs = Date.now();
  const nowMs = Math.max(0, toInt(options.nowMs, wallclockNowMs));
  const debounceMs = Math.max(0, toInt(options.debounceMs, SYSTEM_WAKE_RECONCILE_DEBOUNCE_MS));
  const currentState = systemWakeReconcileState.get(numericSystemID) || null;
  if (
    options.force !== true &&
    currentState &&
    debounceMs > 0 &&
    wallclockNowMs - Math.max(0, toInt(currentState.checkedAtMs, 0)) < debounceMs
  ) {
    return {
      success: true as const,
      skipped: true,
      reason: "debounced",
      systemID: numericSystemID,
      previous: cloneValue(currentState.summary || null),
    };
  }

  const startedAtMs = Date.now();
  const includeMining = options.includeMining !== false;
  const includeBroad = options.includeBroad !== false;
  const miningDefinitions = includeMining
    ? listDesiredGeneratedMiningDefinitions([numericSystemID], nowMs)
    : [];
  const protectedGeneratedMiningSiteKeys = includeMining
    ? listProtectedGeneratedMiningSiteKeys([numericSystemID], nowMs)
    : [];
  const broadResult = includeBroad
    ? listDesiredUniverseDungeonSiteDefinitions([numericSystemID], nowMs, {
      rng: options.rng,
      allocatedSystemIDsByBand: options.allocatedSystemIDsByBand,
    })
    : { definitions: [], families: {} };
  const miningSummary = includeMining
    ? dungeonRuntime.reconcileUniverseSeededInstances(miningDefinitions, {
      systemIDs: [numericSystemID],
      nowMs,
      siteOriginFilter: ["generatedmining"],
      preserveSiteKeys: protectedGeneratedMiningSiteKeys,
    })
    : {
      createdCount: 0,
      retainedCount: 0,
      replacedCount: 0,
      removedCount: 0,
    };
  const broadSummary = includeBroad
    ? dungeonRuntime.reconcileUniverseSeededInstances(broadResult.definitions, {
      systemIDs: [numericSystemID],
      nowMs,
      siteOriginFilter: ["universe_dungeon", SOV_GUARANTEED_SITE_ORIGIN],
    })
    : {
      createdCount: 0,
      retainedCount: 0,
      replacedCount: 0,
      removedCount: 0,
    };
  const persistedMiningState = includeMining
    ? reconcileGeneratedMiningRuntimeState(
      listActiveGeneratedMiningDefinitionsFromRuntime([numericSystemID]),
      [numericSystemID],
      nowMs,
    )
    : {
      createdRows: 0,
      updatedRows: 0,
      removedRows: 0,
    };
  const invalidGeneratedIceCleanup = includeMining && options.cleanupInvalidGeneratedIce !== false
    ? cleanupInvalidGeneratedIceAuthority({
      systemIDs: [numericSystemID],
      nowMs,
      apply: true,
    })
    : {
      scannedCount: 0,
      invalidCount: 0,
      despawnedCount: 0,
      miningStateRowsRemoved: 0,
    };
  const summary = {
    systemCount: 1,
    desiredSiteCount: miningDefinitions.length + broadResult.definitions.length,
    createdInstances: miningSummary.createdCount + broadSummary.createdCount,
    retainedInstances: miningSummary.retainedCount + broadSummary.retainedCount,
    replacedInstances: miningSummary.replacedCount + broadSummary.replacedCount,
    removedInstances: miningSummary.removedCount + broadSummary.removedCount,
    miningStateRowsCreated: persistedMiningState.createdRows,
    miningStateRowsRemoved:
      persistedMiningState.removedRows +
      Math.max(0, toInt(invalidGeneratedIceCleanup && invalidGeneratedIceCleanup.miningStateRowsRemoved, 0)),
    invalidGeneratedIceScanned: Math.max(0, toInt(invalidGeneratedIceCleanup && invalidGeneratedIceCleanup.scannedCount, 0)),
    invalidGeneratedIceFound: Math.max(0, toInt(invalidGeneratedIceCleanup && invalidGeneratedIceCleanup.invalidCount, 0)),
    invalidGeneratedIceDespawned: Math.max(0, toInt(invalidGeneratedIceCleanup && invalidGeneratedIceCleanup.despawnedCount, 0)),
    mining: {
      desiredSiteCount: miningDefinitions.length,
      protectedTerminalSiteCount: protectedGeneratedMiningSiteKeys.length,
    },
    families: broadResult.families,
    elapsedMs: Date.now() - startedAtMs,
  };
  const state = {
    checkedAtMs: wallclockNowMs,
    nowMs,
    reason: normalizeText(options.reason, "system-wake"),
    summary,
  };
  systemWakeReconcileState.set(numericSystemID, state);
  return {
    success: true as const,
    skipped: false,
    systemID: numericSystemID,
    summary,
  };
}

function prepareStartupUniversePersistentSites(options: Record<string, any> = {}) {
  const nowMs = Math.max(0, toInt(options.nowMs, Date.now()));
  const hasExplicitStartupSystemIDs =
    Array.isArray(options.startupSystemIDs) ||
    Array.isArray(options.systemIDs);
  const startupSystemIDs = hasExplicitStartupSystemIDs
    ? normalizeProvidedSystemIDs(options.startupSystemIDs || options.systemIDs || [])
    : normalizeSystemIDs();
  // Server restarts are a hard lifecycle boundary for unfinished pockets. The
  // reset is intentionally global rather than limited to preloaded systems so
  // a sleeping system cannot resurrect an in-progress site on its next wake.
  const startupIncompleteReset = resetStartupIncompleteDungeons({
    nowMs,
    enabled: options.resetIncompleteDungeonsOnStartup !== false,
    policyOptions: options.policyOptions,
  });
  const startupMiningReset = startupIncompleteReset.skipped !== false
    ? resetStartupMiningAnomalies({
      nowMs,
      systemIDs: startupSystemIDs,
      enabled: options.resetMiningAnomaliesOnStartup !== false,
    })
    : {
      skipped: true,
      reason: "covered_by_incomplete_dungeon_reset",
      purgedCount: 0,
      purgedInstanceIDs: [],
      affectedSystemIDs: [],
      createdInstances: 0,
    };
  const invalidGeneratedIceCleanup = options.cleanupInvalidGeneratedIce === false
    ? {
      scannedCount: 0,
      invalidCount: 0,
      despawnedCount: 0,
      miningStateRowsRemoved: 0,
      refreshedSceneCount: 0,
      skipped: true,
      reason: "disabled",
    }
    : cleanupInvalidGeneratedIceAuthority({
      systemIDs: startupSystemIDs,
      nowMs,
      apply: true,
    });
  const downtimeRestore = startupMiningReset && startupMiningReset.skipped === false
    ? {
      skipped: true,
      reason: "server_restart_reset_applied",
      scannedCount: 0,
      eligibleCount: 0,
      rotatedCount: 0,
      removedCount: 0,
      refreshedSceneCount: 0,
      affectedSystemIDs: [],
    }
    : (options.restoreGeneratedIceAfterDowntime === false
    ? {
      skipped: true,
      reason: "disabled",
      scannedCount: 0,
      eligibleCount: 0,
      rotatedCount: 0,
      removedCount: 0,
      refreshedSceneCount: 0,
      affectedSystemIDs: [],
    }
    : restoreGeneratedIceAfterDowntime({
      downtimeAtMs: options.downtimeAtMs,
      lastDowntimeAtMs: options.lastDowntimeAtMs,
      downtimeStartMs: options.downtimeStartMs,
      autoDowntimeBoundary: options.autoDowntimeBoundary,
      autoGeneratedIceDowntimeRestore: options.autoGeneratedIceDowntimeRestore,
      skipAlreadyApplied: options.skipAlreadyApplied,
      recordDowntimeRestore: options.recordDowntimeRestore,
      downtimeHourUtc: options.downtimeHourUtc,
      downtimeMinuteUtc: options.downtimeMinuteUtc,
      downtimeSecondUtc: options.downtimeSecondUtc,
      nowMs,
      systemIDs: startupSystemIDs,
    }));
  const statusBeforeStartupReconcile = getUniverseReconcileStatus(nowMs);
  const shouldReconcileStartupSystems =
    options.reconcileStartupSystems !== false &&
    startupSystemIDs.length > 0 &&
    startupSystemIDs.length <= STARTUP_SYSTEM_RECONCILE_JOB_LIMIT &&
    statusBeforeStartupReconcile.fullUpToDate !== true;
  const startupSummary = shouldReconcileStartupSystems
    ? (() => {
      let scheduledSystemCount = 0;
      let alreadyScheduledSystemCount = 0;
      for (const systemID of startupSystemIDs) {
        const scheduled = scheduleSystemUniversePersistentSitesReconcile(systemID, {
          nowMs,
          reason: normalizeText(options.startupReason, "server-startup-preload"),
          force: true,
          debounceMs: 0,
          initialDelayMs: options.startupInitialDelayMs,
          includeRandomAllocatedUniverseFamilies: true,
          cleanupInvalidGeneratedIce: false,
          logProgress: options.logStartupProgress === true,
          onComplete: (result) => {
            if (!result || result.success === false) {
              return;
            }
            refreshLoadedGeneratedMiningScenes([systemID], Date.now());
            try {
              const runtime = require(path.join(__dirname, "../../space/runtime"));
              const scene = runtime && runtime.scenes instanceof Map
                ? runtime.scenes.get(systemID)
                : null;
              if (!scene) {
                return;
              }
              const siteService = require(path.join(
                __dirname,
                "./dungeonUniverseSiteService",
              ));
              if (typeof siteService.handleSceneCreated === "function") {
                siteService.handleSceneCreated(scene, { force: true });
              }
            } catch (error) {
              log.warn(
                `[DungeonUniverse] startup system materialization failed ` +
                  `system=${systemID}: ${error.message}`,
              );
            }
          },
        });
        if (scheduled && scheduled.scheduled === true) {
          scheduledSystemCount += 1;
        } else if (scheduled && scheduled.reason === "already_running") {
          alreadyScheduledSystemCount += 1;
        }
      }
      return {
        systemCount: startupSystemIDs.length,
        desiredSiteCount: 0,
        createdInstances: 0,
        retainedInstances: 0,
        replacedInstances: 0,
        removedInstances: 0,
        miningStateRowsCreated: 0,
        miningStateRowsRemoved: 0,
        scheduledSystemCount,
        alreadyScheduledSystemCount,
        skipped: false,
        asynchronous: true,
        reason: "scheduled_background",
      };
    })()
    : (startupSystemIDs.length > 0
      ? {
        systemCount: startupSystemIDs.length,
        desiredSiteCount: 0,
        createdInstances: 0,
        retainedInstances: 0,
        replacedInstances: 0,
        removedInstances: 0,
        miningStateRowsCreated: 0,
        miningStateRowsRemoved: 0,
        skipped: true,
        reason:
          statusBeforeStartupReconcile.fullUpToDate === true
            ? "cached_universe_current"
            : (
              startupSystemIDs.length > STARTUP_SYSTEM_RECONCILE_JOB_LIMIT
                ? "covered_by_full_background_reconcile"
                : "startup_reconcile_disabled"
            ),
      }
      : null);
  const status = getUniverseReconcileStatus(nowMs);
  const background = options.scheduleBackgroundReconcile === true && status.fullUpToDate !== true
    ? scheduleBackgroundUniverseReconcile({
      status,
      nowMs,
      reason: normalizeText(options.backgroundReason, "startup-stale"),
      batchSize: options.backgroundBatchSize,
      maxBatchSize: options.backgroundMaxBatchSize,
      targetSliceMs: options.backgroundTargetSliceMs,
      initialDelayMs: options.backgroundInitialDelayMs,
    })
    : {
      scheduled: false,
      reason: status.fullUpToDate
        ? "up_to_date"
        : (
          options.scheduleBackgroundReconcile === false
            ? "awake_reconcile_only"
            : "background_reconcile_required"
        ),
      needsFullReconcile: status.fullUpToDate !== true,
      status,
    };

  return {
    status,
    startupSummary,
    startupIncompleteReset,
    startupMiningReset,
    invalidGeneratedIceCleanup,
    downtimeRestore,
    background: {
      ...background,
      needsFullReconcile: status.fullUpToDate !== true,
    },
  };
}

function startTicker(options: Record<string, any> = {}) {
  if (universeReconcileTicker) {
    return universeReconcileTicker;
  }
  const intervalMs = Math.max(
    250,
    toInt(options.intervalMs, UNIVERSE_SLOT_TICK_INTERVAL_MS),
  );
  universeReconcileTicker = setInterval(() => {
    try {
      const systemIDs = typeof options.systemIDsProvider === "function"
        ? options.systemIDsProvider()
        : options.systemIDs;
      const summary = advanceUniversePersistentSites({
        nowMs: Date.now(),
        lifecycleReason: "expired",
        systemIDs: Array.isArray(systemIDs) ? systemIDs : undefined,
      });
      if (summary.rotatedCount > 0) {
        log.info(
          `[DungeonUniverse] rotated ${summary.rotatedCount} persistent site slots ` +
          `after ${summary.expiredCount} expiries`,
        );
      }
    } catch (error) {
      log.warn(`[DungeonUniverse] Persistent site rotation failed: ${error.message}`);
    }
  }, intervalMs);
  if (typeof universeReconcileTicker.unref === "function") {
    universeReconcileTicker.unref();
  }
  return universeReconcileTicker;
}

function stopTicker() {
  if (universeReconcileTicker) {
    clearInterval(universeReconcileTicker);
    universeReconcileTicker = null;
  }
  clearBackgroundReconcileTimer();
  backgroundReconcileJob = null;
  backgroundFamilyAllocationCache = null;
  clearSystemUniverseReconcileTimer();
  systemUniverseReconcileJobs.clear();
  systemWakeReconcileState.clear();
}

function clearPolicyCandidateCachesForTests() {
  policyEligibleTemplateCandidatesCache.clear();
}

module.exports = {
  summarizeActiveUniverseSeededCounts,
  getBackgroundUniverseReconcileJob,
  getSystemUniverseReconcileJob,
  getUniverseReconcileStatus,
  listDesiredGeneratedMiningDefinitions,
  listDesiredUniverseDungeonSiteDefinitions,
  listUniverseSeededGeneratedMiningInstances,
  listUniverseSeededPersistentSiteInstances,
  advanceUniversePersistentSites,
  restoreGeneratedIceAfterDowntime,
  resetStartupIncompleteDungeons,
  resetStartupMiningAnomalies,
  auditGeneratedIceAuthority,
  cleanupInvalidGeneratedIceAuthority,
  prepareStartupUniversePersistentSites,
  prepareSystemForPlayerEntry,
  ensureSystemUniversePersistentSites,
  scheduleSystemUniversePersistentSitesReconcile,
  reconcileUniversePersistentSites,
  scheduleBackgroundUniverseReconcile,
  startTicker,
  stopTicker,
  _testing: {
    summarizeActiveUniverseSeededCounts,
    buildBroadUniverseDescriptor,
    buildMiningUniverseDescriptor,
    buildUniverseDescriptor,
    buildGeneratedMiningDefinitionHash,
    buildGeneratedMiningPersistedState,
    buildGeneratedMiningSiteKey,
    buildGeneratedMiningSpawnState,
    buildUniverseAnchorCandidates,
    buildUniverseSiteDefinition,
    buildUniverseSitePlacement,
    buildUniverseSiteID,
    buildUniverseSitePosition,
    getFrontierDungeonSpawnAuthorityIDs,
    isUniverseSpawnEligibleTemplate,
    enforceUniverseDungeonSiteSeparation,
    buildTemplatePolicyContext,
    buildPolicyCandidateCacheKey,
    buildRotationDefinitionFromInstance,
    enrichGeneratedMiningDefinition,
    evaluateTemplateSpawnPolicy,
    listPolicyEligibleTemplatesForBand,
    pickUniverseTemplateForSlotWithPolicy,
    pickRandomUniverseTemplateForSlotWithPolicy,
    pickWeightedTemplateCandidate,
    resolveTemplateSpawnFrequency,
    resolveTemplatePlacementDistanceAu,
    resolveTemplateSeparationLightSeconds,
    clearPolicyCandidateCachesForTests,
    listDesiredSovereigntyDungeonSiteDefinitions,
    listSovereigntyGuaranteedSpawnFamilies,
    isSovereigntyGuaranteedSpawnFamily,
    resolveThreatDetectionSecurityBracket,
    listCombatAnomalyTemplatesForLabel,
    parseThreatDetectionUpgrade,
    parseProspectingUpgrade,
    parseExplorationDetectorUpgrade,
    listSystemsWithinJumps,
    resolveGeneratedIceDowntimeBoundary,
    resolveLastDailyDowntimeAtMs,
    parseClusterDowntimeStartsUtc,
    resolveDowntimeClockUtc,
    advanceUniversePersistentSites,
    restoreGeneratedIceAfterDowntime,
    listStartupIncompleteDungeonInstances,
    resetStartupIncompleteDungeons,
    resetStartupMiningAnomalies,
    auditGeneratedIceAuthority,
    cleanupInvalidGeneratedIceAuthority,
    getBackgroundUniverseReconcileJob,
    getSystemUniverseReconcileJob,
    getUniverseReconcileStatus,
    prepareSystemForPlayerEntry,
    ensureSystemUniversePersistentSites,
    scheduleSystemUniversePersistentSitesReconcile,
    getSecurityBand,
    normalizeSystemIDs,
    prepareStartupUniversePersistentSites,
    reconcileGeneratedMiningRuntimeState,
    runBackgroundUniverseReconcileSlice,
    runSystemUniverseReconcileSlice,
    scheduleBackgroundUniverseReconcile,
    listEligibleSystemIDsForBandProfile,
    listProtectedGeneratedMiningSiteKeys,
    listStableWakeAllocationCandidateSystemIDs,
    buildRandomAllocatedSystemPlanForBand,
    buildRandomAllocatedSystemPlanForFamily,
    resolveProfileAllocationMode,
    resolveBandTargetSystemCount,
    resolveUniverseDungeonSlotsPerSystem,
    systemMatchesSpawnBandProfile,
    siteSpawnPolicy: dungeonSiteSpawnPolicy,
  },
};
