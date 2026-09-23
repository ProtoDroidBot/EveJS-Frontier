"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const path = require("path");
const database = require(path.join(__dirname, "../../gameStore"));
const { buildConfiguredConcordStartupRules, } = require("./npcDefaultConcordRules");
const { getCapitalNpcGeneratedRows, } = require(path.join(__dirname, "./capitals/capitalNpcCatalog"));
const { getTrigDrifterGeneratedRows, } = require(path.join(__dirname, "./trigDrifter/trigDrifterNpcCatalog"));
const { getEmpireSecurityGeneratedRows, } = require(path.join(__dirname, "./empireSecurity/empireSecurityNpcCatalog"));
const { augmentNpcLoadoutWithHostileUtilities, } = require(path.join(__dirname, "./npcHostileUtilityCatalog"));
const frontierDungeonSpawns = require(path.join(__dirname, "../../config/frontierDungeonSpawns"));
const frontierDungeonLoot = require(path.join(__dirname, "../../config/frontierDungeonLoot"));
const frontierLandscapeSpawns = require(path.join(__dirname, "../../config/frontierLandscapeSpawns"));
const { applyNpcBehaviorConfig, } = require(path.join(__dirname, "../../config/npcBehaviorConfig"));
const { applyNpcFactionTypeListProfile, } = require(path.join(__dirname, "../../config/npcFactionConfig"));
const NPC_TABLE = Object.freeze({
    PROFILES: "npcProfiles",
    LOADOUTS: "npcLoadouts",
    BEHAVIOR_PROFILES: "npcBehaviorProfiles",
    LOOT_TABLES: "npcLootTables",
    SPAWN_POOLS: "npcSpawnPools",
    SPAWN_GROUPS: "npcSpawnGroups",
    SPAWN_SITES: "npcSpawnSites",
    STARTUP_RULES: "npcStartupRules",
});
const ROW_KEY = Object.freeze({
    [NPC_TABLE.PROFILES]: "profiles",
    [NPC_TABLE.LOADOUTS]: "loadouts",
    [NPC_TABLE.BEHAVIOR_PROFILES]: "behaviorProfiles",
    [NPC_TABLE.LOOT_TABLES]: "lootTables",
    [NPC_TABLE.SPAWN_POOLS]: "spawnPools",
    [NPC_TABLE.SPAWN_GROUPS]: "spawnGroups",
    [NPC_TABLE.SPAWN_SITES]: "spawnSites",
    [NPC_TABLE.STARTUP_RULES]: "startupRules",
});
const ID_FIELD = Object.freeze({
    [NPC_TABLE.PROFILES]: "profileID",
    [NPC_TABLE.LOADOUTS]: "loadoutID",
    [NPC_TABLE.BEHAVIOR_PROFILES]: "behaviorProfileID",
    [NPC_TABLE.LOOT_TABLES]: "lootTableID",
    [NPC_TABLE.SPAWN_POOLS]: "spawnPoolID",
    [NPC_TABLE.SPAWN_GROUPS]: "spawnGroupID",
    [NPC_TABLE.SPAWN_SITES]: "spawnSiteID",
    [NPC_TABLE.STARTUP_RULES]: "startupRuleID",
});
const TABLE_INDEX_CACHE = Object.create(null);
const STANDARD_SPAWN_POOL_SPECS = Object.freeze({
    blood_standard: {
        basePoolID: "blood",
        poolID: "blood_standard",
        name: "Blood Raider Standard Hostiles",
        aliases: ["blood standard", "blood anomaly", "blood raider standard"],
        includeAllBaseEntries: true,
        allowedProfilePrefixes: [
            "parity_blood_raider_pulse_",
            "parity_blood_raider_beam_",
        ],
    },
    sanshas_standard: {
        basePoolID: "sanshas",
        poolID: "sanshas_standard",
        name: "Sansha Standard Hostiles",
        aliases: ["sansha standard", "sanshas anomaly", "sansha anomaly"],
        includeAllBaseEntries: true,
        allowedProfilePrefixes: [
            "parity_sansha_pulse_",
            "parity_sansha_beam_",
        ],
    },
    serpentis_standard: {
        basePoolID: "serpentis",
        poolID: "serpentis_standard",
        name: "Serpentis Standard Hostiles",
        aliases: ["serpentis standard", "serpentis anomaly"],
        includeAllBaseEntries: true,
        allowedProfilePrefixes: [
            "parity_serpentis_blaster_",
            "parity_serpentis_rail_",
        ],
    },
    angels_standard: {
        basePoolID: "angels",
        poolID: "angels_standard",
        name: "Angel Standard Hostiles",
        aliases: ["angel standard", "angels anomaly", "angel anomaly"],
        includeAllBaseEntries: true,
        allowedProfilePrefixes: [
            "parity_angel_autocannon_",
            "parity_angel_artillery_",
        ],
    },
    guristas_standard: {
        basePoolID: "guristas",
        poolID: "guristas_standard",
        name: "Guristas Standard Hostiles",
        aliases: ["guristas standard", "guristas anomaly"],
        includeAllBaseEntries: true,
        allowedProfilePrefixes: [
            "parity_guristas_missile_",
            "parity_guristas_rail_",
        ],
    },
});
const RETAIL_EMPTY_NPC_ENTITY_LOADOUT_ID = "retail_empty_npc_entity_loadout";
const NPC_PILOT_SHIP_PROFILE_PREFIX = "npc_pilot_ship_";
const NPC_OSA_PILOT_SHIP_PROFILE_PREFIX = "npc_osa_pilot_ship_";
const RETAIL_EMPTY_NPC_ENTITY_LOADOUT = Object.freeze({
    loadoutID: RETAIL_EMPTY_NPC_ENTITY_LOADOUT_ID,
    name: "Retail NPC Entity Native Dogma",
    description: "Empty loadout for retail NPC entity types whose combat stats and effects live on the NPC type dogma record.",
    modules: [],
    charges: [],
});
const NPC_PILOT_SHIP_PASSIVE_BEHAVIOR = Object.freeze({
    behaviorProfileID: "npc_pilot_ship_passive",
    name: "NPC Pilot Ship Passive",
    thinkIntervalMs: 500,
    autoAggroTargetClasses: [],
    targetPreference: "none",
    autoAggro: false,
    movementMode: "orbit",
    orbitDistanceMeters: 4000,
    followRangeMeters: 2500,
    aggressionRangeMeters: 0,
    leashRangeMeters: 150000,
    returnToHomeWhenIdle: true,
    homeArrivalMeters: 1500,
    autoActivateWeapons: false,
});
function cloneValue(value) {
    return JSON.parse(JSON.stringify(value));
}
function ensureCanonicalNpcLoadoutRows(rows) {
    const normalizedRows = Array.isArray(rows) ? rows : [];
    if (normalizedRows.some((row) => (String(row && row.loadoutID || "").trim() === RETAIL_EMPTY_NPC_ENTITY_LOADOUT_ID))) {
        return normalizedRows;
    }
    return [
        ...normalizedRows,
        cloneValue(RETAIL_EMPTY_NPC_ENTITY_LOADOUT),
    ];
}
function normalizeQuery(value) {
    return String(value || "")
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, " ");
}
function buildDerivedSpawnPoolRows(rows) {
    if (!Array.isArray(rows) || rows.length <= 0) {
        return [];
    }
    const basePoolsByID = new Map(rows.map((row) => [String(row && row.spawnPoolID || "").trim(), row]));
    const derivedRows = [];
    for (const spec of Object.values(STANDARD_SPAWN_POOL_SPECS)) {
        const basePool = basePoolsByID.get(spec.basePoolID) || null;
        if (!basePool) {
            continue;
        }
        const allowedPrefixes = Array.isArray(spec.allowedProfilePrefixes) ? spec.allowedProfilePrefixes : [];
        let entries = [];
        if (Array.isArray(basePool.entries)) {
            entries = spec.includeAllBaseEntries === true
                ? cloneValue(basePool.entries)
                : basePool.entries.filter((entry) => {
                    const profileID = String(entry && entry.profileID || "").trim();
                    return allowedPrefixes.some((prefix) => profileID.startsWith(prefix));
                });
        }
        if (entries.length <= 0) {
            continue;
        }
        derivedRows.push({
            ...cloneValue(basePool),
            spawnPoolID: spec.poolID,
            name: spec.name,
            description: `${spec.name} without faction or officer inserts.`,
            aliases: spec.aliases,
            entries: cloneValue(entries),
            derived: true,
        });
    }
    return derivedRows;
}
function getSearchableTokens(row, idFieldName) {
    const aliases = Array.isArray(row && row.aliases) ? row.aliases : [];
    return [
        row && row[idFieldName],
        row && row.name,
        ...aliases,
    ]
        .map((token) => normalizeQuery(token))
        .filter(Boolean);
}
function readNpcRows(tableName) {
    const index = getNpcTableIndex(tableName);
    return index.rows.map((row) => cloneValue(row));
}
function readAuthoredNpcRows(tableName) {
    const result = database.read(tableName, "/");
    return (result.success && result.data && typeof result.data === "object"
        ? result.data[ROW_KEY[tableName]]
        : []);
}
function buildNpcRows(tableName, authoredRows) {
    const empireSecurityGeneratedRows = getEmpireSecurityGeneratedRows(tableName);
    const generatedRows = getCapitalNpcGeneratedRows(tableName);
    const trigDrifterGeneratedRows = getTrigDrifterGeneratedRows(tableName);
    const frontierDungeonGeneratedRows = frontierDungeonSpawns.getGeneratedNpcRows(tableName);
    const frontierDungeonLootRows = frontierDungeonLoot.getGeneratedNpcRows(tableName);
    const frontierLandscapeGeneratedRows = frontierLandscapeSpawns.getGeneratedNpcRows(tableName);
    const normalizedAuthoredRows = tableName === NPC_TABLE.LOADOUTS
        ? ensureCanonicalNpcLoadoutRows(authoredRows)
        : (Array.isArray(authoredRows) ? authoredRows : []);
    const derivedRows = tableName === NPC_TABLE.SPAWN_POOLS
        ? buildDerivedSpawnPoolRows(normalizedAuthoredRows)
        : [];
    const rows = [
        ...normalizedAuthoredRows,
        ...derivedRows,
        ...(Array.isArray(empireSecurityGeneratedRows) ? empireSecurityGeneratedRows : []),
        ...(Array.isArray(generatedRows) ? generatedRows : []),
        ...(Array.isArray(trigDrifterGeneratedRows) ? trigDrifterGeneratedRows : []),
        ...(Array.isArray(frontierDungeonGeneratedRows) ? frontierDungeonGeneratedRows : []),
        ...(Array.isArray(frontierDungeonLootRows) ? frontierDungeonLootRows : []),
        ...(Array.isArray(frontierLandscapeGeneratedRows) ? frontierLandscapeGeneratedRows : []),
    ];
    if (tableName !== NPC_TABLE.PROFILES)
        return rows;
    return rows
        .map((profile) => applyNpcFactionTypeListProfile(profile))
        .filter((profile) => profile && profile.npcFactionMembershipEligible !== false);
}
function getNpcTableIndex(tableName, dependencies = {}) {
    const idFieldName = ID_FIELD[tableName];
    const readAuthoredRows = typeof dependencies.readAuthoredNpcRows === "function"
        ? dependencies.readAuthoredNpcRows
        : readAuthoredNpcRows;
    const buildCombinedRows = typeof dependencies.buildNpcRows === "function"
        ? dependencies.buildNpcRows
        : buildNpcRows;
    const authoredRows = readAuthoredRows(tableName);
    const cached = TABLE_INDEX_CACHE[tableName];
    if (cached &&
        cached.authoredRowsRef === authoredRows &&
        cached.authoredRowsLength === (Array.isArray(authoredRows) ? authoredRows.length : 0) &&
        cached.idFieldName === idFieldName) {
        return cached;
    }
    // Generated NPC catalogs are expensive: Frontier, Triglavian, Drifter,
    // capital, and empire-security rows all have to be composed before an index
    // can be built. The previous cache compared the combined array by identity,
    // but that array was freshly allocated on every lookup, making a cache hit
    // impossible. Key the index by the game-store-owned authored rows instead;
    // that reference is stable until the table (or its rows collection) is
    // replaced, while generated catalogs are immutable for the process lifetime.
    const rows = buildCombinedRows(tableName, authoredRows);
    const byID = new Map();
    const byExactToken = new Map();
    const queryEntries = [];
    for (const row of rows) {
        const normalizedID = String(row && row[idFieldName] || "").trim();
        if (normalizedID) {
            byID.set(normalizedID, row);
        }
        const tokens = getSearchableTokens(row, idFieldName);
        for (const token of tokens) {
            if (!byExactToken.has(token)) {
                byExactToken.set(token, row);
            }
        }
        queryEntries.push({
            row,
            tokens,
        });
    }
    const nextIndex = {
        authoredRowsRef: authoredRows,
        authoredRowsLength: Array.isArray(authoredRows) ? authoredRows.length : 0,
        rows,
        idFieldName,
        byID,
        byExactToken,
        queryEntries,
    };
    TABLE_INDEX_CACHE[tableName] = nextIndex;
    return nextIndex;
}
function findRawByID(tableName, value) {
    const normalizedValue = String(value || "").trim();
    if (!normalizedValue) {
        return null;
    }
    return getNpcTableIndex(tableName).byID.get(normalizedValue) || null;
}
function findByID(tableName, value) {
    const row = findRawByID(tableName, value);
    return row ? cloneValue(row) : null;
}
function resolveByQuery(tableName, query, fallbackID = "") {
    const { rows, idFieldName, byExactToken, queryEntries, } = getNpcTableIndex(tableName);
    const normalizedQuery = normalizeQuery(query || fallbackID);
    if (!normalizedQuery) {
        return {
            success: false,
            errorMsg: "PROFILE_REQUIRED",
            suggestions: rows.slice(0, 8).map((row) => String(row.name || row[idFieldName] || "")),
        };
    }
    const exact = byExactToken.get(normalizedQuery) || null;
    if (exact) {
        return {
            success: true,
            data: cloneValue(exact),
            suggestions: [],
            matchKind: "exact",
        };
    }
    const partialMatches = queryEntries.filter((entry) => (entry.tokens.some((token) => token.includes(normalizedQuery))));
    if (partialMatches.length === 1) {
        return {
            success: true,
            data: cloneValue(partialMatches[0].row),
            suggestions: [],
            matchKind: "partial",
        };
    }
    return {
        success: false,
        errorMsg: partialMatches.length > 1 ? "PROFILE_AMBIGUOUS" : "PROFILE_NOT_FOUND",
        suggestions: partialMatches
            .slice(0, 8)
            .map((entry) => `${entry.row.name} (${entry.row[idFieldName]})`),
    };
}
function listNpcProfiles() {
    return readNpcRows(NPC_TABLE.PROFILES);
}
function getNpcProfile(profileID) {
    return findByID(NPC_TABLE.PROFILES, profileID);
}
function resolveNpcProfile(query, fallbackProfileID = "") {
    return resolveByQuery(NPC_TABLE.PROFILES, query, fallbackProfileID);
}
function listNpcLoadouts() {
    return readNpcRows(NPC_TABLE.LOADOUTS);
}
function getNpcLoadout(loadoutID) {
    return findByID(NPC_TABLE.LOADOUTS, loadoutID);
}
function listNpcBehaviorProfiles() {
    return readNpcRows(NPC_TABLE.BEHAVIOR_PROFILES);
}
function getNpcBehaviorProfile(behaviorProfileID) {
    return findByID(NPC_TABLE.BEHAVIOR_PROFILES, behaviorProfileID);
}
function listNpcLootTables() {
    return readNpcRows(NPC_TABLE.LOOT_TABLES);
}
function getNpcLootTable(lootTableID) {
    return findByID(NPC_TABLE.LOOT_TABLES, lootTableID);
}
function listNpcSpawnPools() {
    return readNpcRows(NPC_TABLE.SPAWN_POOLS);
}
function getNpcSpawnPool(spawnPoolID) {
    return findByID(NPC_TABLE.SPAWN_POOLS, spawnPoolID);
}
function resolveNpcSpawnPool(query, fallbackSpawnPoolID = "") {
    return resolveByQuery(NPC_TABLE.SPAWN_POOLS, query, fallbackSpawnPoolID);
}
function listNpcSpawnGroups() {
    return readNpcRows(NPC_TABLE.SPAWN_GROUPS);
}
function getNpcSpawnGroup(spawnGroupID) {
    return findByID(NPC_TABLE.SPAWN_GROUPS, spawnGroupID);
}
function resolveNpcSpawnGroup(query, fallbackSpawnGroupID = "") {
    return resolveByQuery(NPC_TABLE.SPAWN_GROUPS, query, fallbackSpawnGroupID);
}
function listNpcSpawnSites() {
    return readNpcRows(NPC_TABLE.SPAWN_SITES);
}
function getNpcSpawnSite(spawnSiteID) {
    return findByID(NPC_TABLE.SPAWN_SITES, spawnSiteID);
}
function resolveNpcSpawnSite(query, fallbackSpawnSiteID = "") {
    return resolveByQuery(NPC_TABLE.SPAWN_SITES, query, fallbackSpawnSiteID);
}
function listNpcStartupRules() {
    const authoredRules = readNpcRows(NPC_TABLE.STARTUP_RULES);
    const generatedRules = buildConfiguredConcordStartupRules(authoredRules);
    return [
        ...authoredRules,
        ...generatedRules,
    ];
}
function getNpcStartupRule(startupRuleID) {
    return listNpcStartupRules().find((row) => String(row && row.startupRuleID || "").trim() === String(startupRuleID || "").trim()) || null;
}
function resolveNpcStartupRule(query, fallbackStartupRuleID = "") {
    const rows = listNpcStartupRules();
    const normalizedQuery = normalizeQuery(query || fallbackStartupRuleID);
    if (!normalizedQuery) {
        return {
            success: false,
            errorMsg: "PROFILE_REQUIRED",
            suggestions: rows.slice(0, 8).map((row) => String(row.name || row.startupRuleID || "")),
        };
    }
    const exact = rows.find((row) => getSearchableTokens(row, "startupRuleID").includes(normalizedQuery)) || null;
    if (exact) {
        return {
            success: true,
            data: cloneValue(exact),
            suggestions: [],
            matchKind: "exact",
        };
    }
    const partialMatches = rows.filter((row) => (getSearchableTokens(row, "startupRuleID")
        .some((token) => token.includes(normalizedQuery))));
    if (partialMatches.length === 1) {
        return {
            success: true,
            data: cloneValue(partialMatches[0]),
            suggestions: [],
            matchKind: "partial",
        };
    }
    return {
        success: false,
        errorMsg: partialMatches.length > 1 ? "PROFILE_AMBIGUOUS" : "PROFILE_NOT_FOUND",
        suggestions: partialMatches
            .slice(0, 8)
            .map((row) => `${row.name} (${row.startupRuleID})`),
    };
}
function buildNpcDefinition(profileID) {
    const pilotShipMatch = /^npc_(osa_)?pilot_ship_(\d+)$/.exec(String(profileID || ""));
    if (pilotShipMatch) {
        const { resolveItemByTypeID } = require(path.join(__dirname, "../../services/inventory/itemTypeRegistry"));
        const shipType = resolveItemByTypeID(Number(pilotShipMatch[2]));
        if (!shipType || Number(shipType.categoryID) !== 6)
            return null;
        const osaFaction = pilotShipMatch[1] === "osa_"
            ? frontierDungeonSpawns.getConfig()
            : null;
        const osaProfile = osaFaction ? {
            factionID: osaFaction.defaults.npcFactionID,
            corporationID: osaFaction.defaults.npcCorporationID,
            frontierFactionKey: "osa",
            npcFactionKey: "osa",
            factionStringOnlyID: "osa",
            frontierFactionTag: osaFaction.factions.osa.tag,
        } : {};
        const shipName = `${osaFaction ? "Osa " : ""}${String(shipType.name || `Ship ${shipType.typeID}`)}`;
        const profile = {
            profileID: `${osaFaction ? NPC_OSA_PILOT_SHIP_PROFILE_PREFIX : NPC_PILOT_SHIP_PROFILE_PREFIX}${shipType.typeID}`,
            name: shipName,
            shipNameTemplate: shipName,
            entityType: "npc",
            shipTypeID: shipType.typeID,
            presentationTypeID: shipType.typeID,
            hardwareFamily: "pilotedShip",
            loadoutID: RETAIL_EMPTY_NPC_ENTITY_LOADOUT_ID,
            behaviorProfileID: NPC_PILOT_SHIP_PASSIVE_BEHAVIOR.behaviorProfileID,
            ...osaProfile,
        };
        const factionProfile = osaFaction ? applyNpcFactionTypeListProfile(profile) : profile;
        if (osaFaction && factionProfile.npcFactionMembershipEligible !== true)
            return null;
        const loadout = cloneValue(RETAIL_EMPTY_NPC_ENTITY_LOADOUT);
        const behaviorProfile = cloneValue(NPC_PILOT_SHIP_PASSIVE_BEHAVIOR);
        return applyNpcBehaviorConfig({
            profile: factionProfile,
            loadout,
            behaviorProfile,
            lootTable: null,
        });
    }
    const profileRow = findRawByID(NPC_TABLE.PROFILES, profileID);
    if (!profileRow) {
        return null;
    }
    const loadoutRow = findRawByID(NPC_TABLE.LOADOUTS, profileRow.loadoutID);
    const behaviorProfileRow = findRawByID(NPC_TABLE.BEHAVIOR_PROFILES, profileRow.behaviorProfileID);
    const lootTableRow = findRawByID(NPC_TABLE.LOOT_TABLES, profileRow.lootTableID);
    if (!loadoutRow || !behaviorProfileRow) {
        return null;
    }
    const profile = cloneValue(profileRow);
    const baseLoadout = cloneValue(loadoutRow);
    const behaviorProfile = cloneValue(behaviorProfileRow);
    const lootTable = lootTableRow ? cloneValue(lootTableRow) : null;
    if (!profile) {
        return null;
    }
    const configuredDefinition = applyNpcBehaviorConfig({
        profile,
        loadout: baseLoadout,
        behaviorProfile,
        lootTable,
    });
    const hostileUtilityAugmentResult = augmentNpcLoadoutWithHostileUtilities(configuredDefinition, baseLoadout);
    const loadout = hostileUtilityAugmentResult.loadout;
    return {
        ...configuredDefinition,
        loadout,
        hostileUtilityTemplateIDs: hostileUtilityAugmentResult.appliedTemplateIDs,
    };
}
module.exports = {
    NPC_TABLE,
    listNpcProfiles,
    getNpcProfile,
    resolveNpcProfile,
    listNpcLoadouts,
    getNpcLoadout,
    listNpcBehaviorProfiles,
    getNpcBehaviorProfile,
    listNpcLootTables,
    getNpcLootTable,
    listNpcSpawnPools,
    getNpcSpawnPool,
    resolveNpcSpawnPool,
    listNpcSpawnGroups,
    getNpcSpawnGroup,
    resolveNpcSpawnGroup,
    listNpcSpawnSites,
    getNpcSpawnSite,
    resolveNpcSpawnSite,
    listNpcStartupRules,
    getNpcStartupRule,
    resolveNpcStartupRule,
    buildNpcDefinition,
    _testing: {
        clearTableIndexCache(tableName = null) {
            if (tableName) {
                delete TABLE_INDEX_CACHE[tableName];
                return;
            }
            for (const cachedTableName of Object.keys(TABLE_INDEX_CACHE)) {
                delete TABLE_INDEX_CACHE[cachedTableName];
            }
        },
        getNpcTableIndex,
    },
};
//# sourceMappingURL=npcData.js.map