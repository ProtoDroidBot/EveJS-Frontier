#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, "../..");

type ReferenceMode = "value" | "objectKeys";

type ReferenceRule = {
  source: string;
  path: string;
  target: string | string[];
  mode?: ReferenceMode;
  label?: string;
};

type AuditOptions = {
  maxIssues?: number;
  onBroken?: (issue: Record<string, any>) => void;
};

type ParsedOptions = {
  format: "text" | "json";
  help: boolean;
  listRules: boolean;
  maxIssues: number;
  output: string | null;
  showPassed: boolean;
  showUnmapped: boolean;
  snapshot: string | null;
  strictUnmapped: boolean;
  writeOutput: boolean;
};

const rule = (
  source: string,
  referencePath: string,
  target: string | string[],
  options: Pick<ReferenceRule, "mode" | "label"> = {},
): ReferenceRule => ({ source, path: referencePath, target, ...options });

const TYPE_TABLE = "types.jsonl";
const GROUP_TABLE = "groups.jsonl";
const CATEGORY_TABLE = "categories.jsonl";
const ATTRIBUTE_TABLE = "dogmaAttributes.jsonl";
const EFFECT_TABLE = "dogmaEffects.jsonl";
const FACTION_TABLE = "factions.jsonl";
const CORPORATION_TABLE = "npcCorporations.jsonl";
const CHARACTER_TABLE = "npcCharacters.jsonl";
const STATION_TABLE = "npcStations.jsonl";
const SYSTEM_TABLE = "mapSolarSystems.jsonl";
const CONSTELLATION_TABLE = "mapConstellations.jsonl";
const REGION_TABLE = "mapRegions.jsonl";
const STAR_TABLE = "mapStars.jsonl";
const PLANET_TABLE = "mapPlanets.jsonl";
const MOON_TABLE = "mapMoons.jsonl";
const STARGATE_TABLE = "mapStargates.jsonl";
const LAGRANGE_TABLE = "mapLagrangePoints.jsonl";
const TYPE_LIST_TABLE = "typeLists.jsonl";
const DUNGEON_TABLE = "frontierDungeonTemplates.jsonl";
const LANDSCAPE_DUNGEON_TABLE = "landscapeDungeonTemplates.jsonl";
const ECOSYSTEM_TABLE = "landscapeEcosystems.jsonl";
const CREATION_MODULE_TABLE = "creationModules.jsonl";
const CREATION_PART_TABLE = "creationParts.jsonl";
const HARDPOINT_TABLE = "creationHardpointTypes.jsonl";

const CELESTIAL_TABLES = [STAR_TABLE, PLANET_TABLE, MOON_TABLE, STARGATE_TABLE, LAGRANGE_TABLE];
const LOCATION_TABLES = [SYSTEM_TABLE, ...CELESTIAL_TABLES, STATION_TABLE];
const OWNER_TABLES = [FACTION_TABLE, CORPORATION_TABLE, CHARACTER_TABLE];

/**
 * Relationships whose target tables are part of the exported Frontier SDE.
 * Paths use [] for array elements, * for a dynamic object key, and ** for any
 * number of object levels. objectKeys rules validate IDs encoded as map keys.
 */
const REFERENCE_RULES: ReferenceRule[] = [
  rule("bloodlines.jsonl", "corporationID", CORPORATION_TABLE),
  rule("bloodlines.jsonl", "raceID", "races.jsonl"),

  rule("creationModules.jsonl", "_key", TYPE_TABLE),
  rule("creationModules.jsonl", "placement.hardpoints[]", HARDPOINT_TABLE),
  rule("creationModules.jsonl", "placement.compatible_hardpoints[]", HARDPOINT_TABLE),
  rule("creationTemplates.jsonl", "_key", TYPE_TABLE),
  rule("creationTemplates.jsonl", "fuel.type_id", TYPE_TABLE),
  rule("creationTemplates.jsonl", "cargo[].type_id", TYPE_TABLE),
  rule("creationTemplates.jsonl", "interior_modules[].type_id", CREATION_MODULE_TABLE),
  rule("creationTemplates.jsonl", "interior_modules[].hardpoints[].exterior_type_id", CREATION_MODULE_TABLE),
  rule("creationTemplates.jsonl", "parts.*.graphic_id", CREATION_PART_TABLE),
  rule("creationTemplates.jsonl", "restrictions.by_type", CREATION_MODULE_TABLE, { mode: "objectKeys" }),

  rule("dogmaAttributes.jsonl", "chargeRechargeRateID", ATTRIBUTE_TABLE),
  rule("dogmaAttributes.jsonl", "chargeRechargeTimeID", ATTRIBUTE_TABLE),
  rule("dogmaAttributes.jsonl", "maxAttributeID", ATTRIBUTE_TABLE),

  ...[
    "dischargeAttributeID",
    "durationAttributeID",
    "falloffAttributeID",
    "rangeAttributeID",
    "trackingSpeedAttributeID",
    "npcUsageChanceAttributeID",
    "npcActivationChanceAttributeID",
    "fittingUsageChanceAttributeID",
    "resistanceAttributeID",
    "powerAttributeID",
  ].map((field) => rule("dogmaEffects.jsonl", field, ATTRIBUTE_TABLE)),
  rule("dogmaEffects.jsonl", "modifierInfo[].modifiedAttributeID", ATTRIBUTE_TABLE),
  rule("dogmaEffects.jsonl", "modifierInfo[].modifyingAttributeID", ATTRIBUTE_TABLE),
  rule("dogmaEffects.jsonl", "modifierInfo[].limitingAttributeID", ATTRIBUTE_TABLE),
  rule("dogmaEffects.jsonl", "modifierInfo[].groupID", GROUP_TABLE),
  rule("dogmaEffects.jsonl", "modifierInfo[].skillTypeID", TYPE_TABLE),
  rule("dogmaEffects.jsonl", "modifierInfo[].effectID", EFFECT_TABLE),

  rule("factions.jsonl", "corporationID", CORPORATION_TABLE),
  rule("factions.jsonl", "memberRaces[]", "races.jsonl"),
  rule("factions.jsonl", "solarSystemID", SYSTEM_TABLE),

  rule(DUNGEON_TABLE, "entryTypeID", TYPE_TABLE),
  rule(DUNGEON_TABLE, "lootDropTypeID", TYPE_TABLE),
  rule(DUNGEON_TABLE, "rooms[].objects[].typeID", TYPE_TABLE),
  rule(DUNGEON_TABLE, "factionID", FACTION_TABLE),
  rule(LANDSCAPE_DUNGEON_TABLE, "entryTypeID", TYPE_TABLE),
  rule(LANDSCAPE_DUNGEON_TABLE, "rooms[].objects[].typeID", TYPE_TABLE),

  rule(GROUP_TABLE, "categoryID", CATEGORY_TABLE),

  rule(ECOSYSTEM_TABLE, "entryDungeonID", LANDSCAPE_DUNGEON_TABLE),
  rule(ECOSYSTEM_TABLE, "naturalWorldPatterns[].dungeonID", LANDSCAPE_DUNGEON_TABLE),
  rule(ECOSYSTEM_TABLE, "brokenWorldPatterns[].dungeonID", LANDSCAPE_DUNGEON_TABLE),

  rule("landscapeSites.jsonl", "solarSystemID", SYSTEM_TABLE),
  rule("landscapeSites.jsonl", "typeID", TYPE_TABLE),
  rule("landscapeSites.jsonl", "ecosystemID", ECOSYSTEM_TABLE),
  rule("landscapeSites.jsonl", "dungeonID", LANDSCAPE_DUNGEON_TABLE),

  rule("locationCache.jsonl", "_key", LOCATION_TABLES),
  rule("locationCache.jsonl", "solarSystemID", SYSTEM_TABLE),

  rule(CONSTELLATION_TABLE, "regionID", REGION_TABLE),
  rule(CONSTELLATION_TABLE, "solarSystemIDs[]", SYSTEM_TABLE),
  rule(CONSTELLATION_TABLE, "factionID", FACTION_TABLE),
  rule("mapJumps.jsonl", "fromSystemID", SYSTEM_TABLE),
  rule("mapJumps.jsonl", "toSystemID", SYSTEM_TABLE),
  rule("mapJumps.jsonl", "stargateID", STARGATE_TABLE),
  rule(LAGRANGE_TABLE, "groupID", GROUP_TABLE),
  rule(LAGRANGE_TABLE, "orbitID", [STAR_TABLE, PLANET_TABLE, MOON_TABLE]),
  rule(LAGRANGE_TABLE, "solarSystemID", SYSTEM_TABLE),
  rule(LAGRANGE_TABLE, "typeID", TYPE_TABLE),
  rule(MOON_TABLE, "groupID", GROUP_TABLE),
  rule(MOON_TABLE, "orbitID", PLANET_TABLE),
  rule(MOON_TABLE, "solarSystemID", SYSTEM_TABLE),
  rule(MOON_TABLE, "typeID", TYPE_TABLE),
  rule(PLANET_TABLE, "groupID", GROUP_TABLE),
  rule(PLANET_TABLE, "orbitID", STAR_TABLE),
  rule(PLANET_TABLE, "solarSystemID", SYSTEM_TABLE),
  rule(PLANET_TABLE, "typeID", TYPE_TABLE),
  rule(REGION_TABLE, "constellationIDs[]", CONSTELLATION_TABLE),
  rule(REGION_TABLE, "solarSystemIDs[]", SYSTEM_TABLE),
  rule(REGION_TABLE, "factionID", FACTION_TABLE),
  rule(SYSTEM_TABLE, "constellationID", CONSTELLATION_TABLE),
  rule(SYSTEM_TABLE, "regionID", REGION_TABLE),
  rule(SYSTEM_TABLE, "starID", STAR_TABLE),
  rule(SYSTEM_TABLE, "sunTypeID", TYPE_TABLE),
  rule(STARGATE_TABLE, "destination.solarSystemID", SYSTEM_TABLE),
  rule(STARGATE_TABLE, "destination.stargateID", STARGATE_TABLE),
  rule(STARGATE_TABLE, "groupID", GROUP_TABLE),
  rule(STARGATE_TABLE, "orbitID", CELESTIAL_TABLES),
  rule(STARGATE_TABLE, "planetID", PLANET_TABLE),
  rule(STARGATE_TABLE, "solarSystemID", SYSTEM_TABLE),
  rule(STARGATE_TABLE, "typeID", TYPE_TABLE),
  rule(STAR_TABLE, "groupID", GROUP_TABLE),
  rule(STAR_TABLE, "orbitID", CELESTIAL_TABLES),
  rule(STAR_TABLE, "solarSystemID", SYSTEM_TABLE),
  rule(STAR_TABLE, "typeID", TYPE_TABLE),

  rule(CHARACTER_TABLE, "bloodlineID", "bloodlines.jsonl"),
  rule(CHARACTER_TABLE, "corporationID", CORPORATION_TABLE),
  rule(CHARACTER_TABLE, "raceID", "races.jsonl"),
  rule(CHARACTER_TABLE, "stationID", STATION_TABLE),
  rule(CHARACTER_TABLE, "**.typeID", TYPE_TABLE),
  rule(CORPORATION_TABLE, "ceoID", CHARACTER_TABLE),
  rule(CORPORATION_TABLE, "allowedMemberRaces[]", "races.jsonl"),
  rule(CORPORATION_TABLE, "divisions.*.leaderID", CHARACTER_TABLE),
  rule(CORPORATION_TABLE, "enemyID", CORPORATION_TABLE),
  rule(CORPORATION_TABLE, "factionID", FACTION_TABLE),
  rule(CORPORATION_TABLE, "friendID", CORPORATION_TABLE),
  rule(CORPORATION_TABLE, "investors", CORPORATION_TABLE, { mode: "objectKeys" }),
  rule(CORPORATION_TABLE, "raceID", "races.jsonl"),
  rule(CORPORATION_TABLE, "solarSystemID", SYSTEM_TABLE),
  rule(CORPORATION_TABLE, "stationID", STATION_TABLE),
  rule(STATION_TABLE, "operationID", "stationOperations.jsonl"),
  rule(STATION_TABLE, "orbitID", CELESTIAL_TABLES),
  rule(STATION_TABLE, "ownerID", OWNER_TABLES),
  rule(STATION_TABLE, "solarSystemID", SYSTEM_TABLE),
  rule(STATION_TABLE, "typeID", TYPE_TABLE),
  rule("races.jsonl", "shipTypeID", TYPE_TABLE),
  rule("races.jsonl", "skills", TYPE_TABLE, { mode: "objectKeys" }),

  rule("spaceComponentsByType.jsonl", "_key", TYPE_TABLE),
  rule("spaceComponentsByType.jsonl", "**.shipGroupID", GROUP_TABLE),
  rule("spaceComponentsByType.jsonl", "cargoBay.acceptedTypeIDs", TYPE_TABLE, { mode: "objectKeys" }),
  rule("spaceComponentsByType.jsonl", "itemTrader.inputItems", TYPE_TABLE, { mode: "objectKeys" }),
  rule("spaceComponentsByType.jsonl", "itemTrader.outputItems", TYPE_TABLE, { mode: "objectKeys" }),
  rule("spaceComponentsByType.jsonl", "smartDeployable.constructionCost", TYPE_TABLE, { mode: "objectKeys" }),
  rule("spaceComponentsByType.jsonl", "smartDeployable.brokenState.recoveryCost", TYPE_TABLE, { mode: "objectKeys" }),
  rule("spaceComponentsByType.jsonl", "smartHangar.acceptedGroupIDs", GROUP_TABLE, { mode: "objectKeys" }),
  rule("spaceComponentsByType.jsonl", "appliedProximityEffects.effects", ATTRIBUTE_TABLE, { mode: "objectKeys" }),
  rule("spaceComponentsByType.jsonl", "linkWithShip.dbuffs", ATTRIBUTE_TABLE, { mode: "objectKeys" }),
  rule("spaceComponentsByType.jsonl", "proximityTrap.dbuffs", ATTRIBUTE_TABLE, { mode: "objectKeys" }),
  rule("spaceComponentsByType.jsonl", "npcpilot.characterIds", CHARACTER_TABLE, { mode: "objectKeys" }),
  rule("spaceComponentsByType.jsonl", "reactiveSpawnComponent.spawnDataByDungeonID", DUNGEON_TABLE, { mode: "objectKeys" }),
  rule("spaceComponentsByType.jsonl", "reactiveSpawnComponent.spawnDataByFactionID", FACTION_TABLE, { mode: "objectKeys" }),
  rule("spaceComponentsByType.jsonl", "sofOwnerMapper.ownerIdToMaterialSetId", OWNER_TABLES, { mode: "objectKeys" }),
  rule("spaceComponentsByType.jsonl", "**.ownerID", OWNER_TABLES),
  rule("spaceComponentsByType.jsonl", "**.trackedTypeListID", TYPE_LIST_TABLE),
  rule("spaceComponentsByType.jsonl", "**.triggerFilterTypeListID", TYPE_LIST_TABLE),
  rule("spaceComponentsByType.jsonl", "**.pauseTimerTypeListID", TYPE_LIST_TABLE),
  rule("spaceComponentsByType.jsonl", "**.linkableShipTypeListID", TYPE_LIST_TABLE),
  rule("spaceComponentsByType.jsonl", "**.environmentTypeID", TYPE_TABLE),
  rule("spaceComponentsByType.jsonl", "**.hostileSpawnerTypeID", TYPE_TABLE),
  rule("spaceComponentsByType.jsonl", "smartDeployable.constructionSite", TYPE_TABLE),
  rule("spaceComponentsByType.jsonl", "smartTurret.defaultTurret", TYPE_TABLE),
  rule("spaceComponentsByType.jsonl", "smartTurret.weaponGroupId", GROUP_TABLE),

  rule("typeDogma.jsonl", "_key", TYPE_TABLE),
  rule("typeDogma.jsonl", "dogmaAttributes[].attributeID", ATTRIBUTE_TABLE),
  rule("typeDogma.jsonl", "dogmaEffects[].effectID", EFFECT_TABLE),

  rule("stationOperations.jsonl", "stationTypes", "races.jsonl", { mode: "objectKeys" }),
  rule("stationOperations.jsonl", "stationTypes.*", TYPE_TABLE),

  rule(TYPE_LIST_TABLE, "excludedCategoryIDs[]", CATEGORY_TABLE),
  rule(TYPE_LIST_TABLE, "includedCategoryIDs[]", CATEGORY_TABLE),
  rule(TYPE_LIST_TABLE, "excludedGroupIDs[]", GROUP_TABLE),
  rule(TYPE_LIST_TABLE, "includedGroupIDs[]", GROUP_TABLE),
  rule(TYPE_LIST_TABLE, "excludedTypeIDs[]", TYPE_TABLE),
  rule(TYPE_LIST_TABLE, "includedTypeIDs[]", TYPE_TABLE),
  rule(TYPE_LIST_TABLE, "excludedTypeListIDs[]", TYPE_LIST_TABLE),
  rule(TYPE_LIST_TABLE, "includedTypeListIDs[]", TYPE_LIST_TABLE),
  rule("typeMaterials.jsonl", "_key", TYPE_TABLE),
  rule("typeMaterials.jsonl", "materials[].materialTypeID", TYPE_TABLE),
  rule(TYPE_TABLE, "groupID", GROUP_TABLE),
  rule(TYPE_TABLE, "raceID", "races.jsonl"),
  rule(TYPE_TABLE, "factionID", FACTION_TABLE),
  rule(TYPE_TABLE, "variationParentTypeID", TYPE_TABLE),
  rule(TYPE_TABLE, "wreckTypeID", TYPE_TABLE),
];

function usage(): string {
  return [
    "Usage:",
    "  npm run frontier:references -- [snapshot] [options]",
    "  node tools/frontier-static/audit-frontier-references.mjs [snapshot] [options]",
    "",
    "Options:",
    "  --snapshot <path>       Snapshot directory (default: newest local build)",
    "  --format <text|json>    Output format (default: text)",
    "  --json                  Alias for --format json",
    "  --max-issues <count>    Maximum broken-reference examples (default: 100)",
    "  --output <path>         Complete broken-reference report path",
    "  --no-output             Do not write the complete JSON report",
    "  --show-passed           Include successful rules in text output",
    "  --show-unmapped         List numeric ID-shaped fields without a rule",
    "  --strict-unmapped       Exit non-zero when unmapped ID-shaped fields exist",
    "  --list-rules            Print the built-in reference rules",
    "  -h, --help              Show this help",
  ].join("\n");
}

function requireArgument(argv: string[], index: number, option: string): string {
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${option} requires a value`);
  }
  return value;
}

function parseArgs(argv = process.argv.slice(2)): ParsedOptions {
  const options: ParsedOptions = {
    format: "text",
    help: false,
    listRules: false,
    maxIssues: 100,
    output: null,
    showPassed: false,
    showUnmapped: false,
    snapshot: null,
    strictUnmapped: false,
    writeOutput: true,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--snapshot") {
      options.snapshot = path.resolve(requireArgument(argv, index, argument));
      index += 1;
    } else if (argument === "--format") {
      const format = requireArgument(argv, index, argument);
      if (format !== "text" && format !== "json") {
        throw new Error(`Invalid format: ${format}`);
      }
      options.format = format;
      index += 1;
    } else if (argument === "--json") {
      options.format = "json";
    } else if (argument === "--max-issues") {
      const value = Number(requireArgument(argv, index, argument));
      if (!Number.isSafeInteger(value) || value < 0) {
        throw new Error("--max-issues must be a non-negative integer");
      }
      options.maxIssues = value;
      index += 1;
    } else if (argument === "--output") {
      options.output = path.resolve(requireArgument(argv, index, argument));
      options.writeOutput = true;
      index += 1;
    } else if (argument === "--no-output") {
      options.writeOutput = false;
    } else if (argument === "--show-passed") {
      options.showPassed = true;
    } else if (argument === "--show-unmapped") {
      options.showUnmapped = true;
    } else if (argument === "--strict-unmapped") {
      options.strictUnmapped = true;
      options.showUnmapped = true;
    } else if (argument === "--list-rules") {
      options.listRules = true;
    } else if (argument === "--help" || argument === "-h") {
      options.help = true;
    } else if (!argument.startsWith("-") && !options.snapshot) {
      options.snapshot = path.resolve(argument);
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }
  return options;
}

function findLatestSnapshot(): string {
  const root = path.join(REPO_ROOT, "_local", "frontier-sde");
  if (!fs.existsSync(root)) {
    throw new Error(`No Frontier SDE directory found: ${root}`);
  }
  const builds = fs.readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && /^\d+$/.test(entry.name))
    .map((entry) => Number(entry.name))
    .sort((left, right) => right - left);
  if (builds.length === 0) {
    throw new Error(`No build-numbered Frontier snapshots found: ${root}`);
  }
  return path.join(root, String(builds[0]));
}

function defaultOutputPath(snapshotPath: string): string {
  const snapshot = path.resolve(snapshotPath);
  return path.join(
    path.dirname(snapshot),
    `${path.basename(snapshot)}-broken-references.json`,
  );
}

function listJsonlFiles(snapshot: string): Array<{ absolutePath: string; table: string }> {
  const found: Array<{ absolutePath: string; table: string }> = [];
  function visit(directory: string): void {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolutePath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        visit(absolutePath);
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".jsonl")) {
        found.push({
          absolutePath,
          table: path.relative(snapshot, absolutePath).split(path.sep).join("/"),
        });
      }
    }
  }
  visit(snapshot);
  return found.sort((left, right) => left.table.localeCompare(right.table, "en"));
}

async function forEachJsonlRow(
  file: { absolutePath: string; table: string },
  onRow: (row: Record<string, any>, lineNumber: number) => void | Promise<void>,
): Promise<number> {
  const input = fs.createReadStream(file.absolutePath, { encoding: "utf8" });
  const lines = readline.createInterface({ input, crlfDelay: Infinity });
  let lineNumber = 0;
  let records = 0;
  try {
    for await (const line of lines) {
      lineNumber += 1;
      if (!line.trim()) {
        continue;
      }
      let row: unknown;
      try {
        row = JSON.parse(line);
      } catch (error) {
        throw new Error(`${file.table}:${lineNumber}: invalid JSON: ${(error as Error).message}`);
      }
      if (!row || typeof row !== "object" || Array.isArray(row)) {
        throw new Error(`${file.table}:${lineNumber}: expected a JSON object`);
      }
      records += 1;
      await onRow(row as Record<string, any>, lineNumber);
    }
  } finally {
    lines.close();
    input.destroy();
  }
  return records;
}

function normalizeKey(value: unknown): string | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? String(value) : null;
  }
  if (typeof value === "string" || typeof value === "bigint") {
    return String(value);
  }
  return null;
}

function canonicalProperty(key: string): string {
  return /^-?\d+$/.test(key) ? "*" : key;
}

function matchesPath(pattern: string, candidate: string): boolean {
  const patternParts = pattern.split(".");
  const candidateParts = candidate.split(".");
  const memo = new Map<string, boolean>();
  function match(patternIndex: number, candidateIndex: number): boolean {
    const memoKey = `${patternIndex}:${candidateIndex}`;
    if (memo.has(memoKey)) {
      return memo.get(memoKey)!;
    }
    let result: boolean;
    if (patternIndex === patternParts.length) {
      result = candidateIndex === candidateParts.length;
    } else if (patternParts[patternIndex] === "**") {
      result = match(patternIndex + 1, candidateIndex) ||
        (candidateIndex < candidateParts.length && match(patternIndex, candidateIndex + 1));
    } else {
      result = candidateIndex < candidateParts.length &&
        (patternParts[patternIndex] === "*" || patternParts[patternIndex] === candidateParts[candidateIndex]) &&
        match(patternIndex + 1, candidateIndex + 1);
    }
    memo.set(memoKey, result);
    return result;
  }
  return match(0, 0);
}

function isIdShapedPath(referencePath: string): boolean {
  const leaf = referencePath.split(".").at(-1)!.replace(/\[\]$/, "");
  return leaf !== "_key" && /(?:ID|IDs|Id|Ids|_id|_ids)$/.test(leaf);
}

function targetsFor(referenceRule: ReferenceRule): string[] {
  return Array.isArray(referenceRule.target) ? referenceRule.target : [referenceRule.target];
}

function formatTargets(referenceRule: ReferenceRule): string {
  return targetsFor(referenceRule).join(" | ");
}

function createRuleResult(referenceRule: ReferenceRule): Record<string, any> {
  return {
    source: referenceRule.source,
    path: referenceRule.path,
    mode: referenceRule.mode || "value",
    target: targetsFor(referenceRule),
    references: 0,
    valid: 0,
    broken: 0,
    uniqueBroken: new Set<string>(),
  };
}

function publicRuleResult(result: Record<string, any>): Record<string, any> {
  const missingValues = [...result.uniqueBroken] as string[];
  missingValues.sort((left, right) => {
    const leftNumber = Number(left);
    const rightNumber = Number(right);
    if (Number.isFinite(leftNumber) && Number.isFinite(rightNumber) && leftNumber !== rightNumber) {
      return leftNumber - rightNumber;
    }
    return left.localeCompare(right, "en");
  });
  return {
    source: result.source,
    path: result.path,
    mode: result.mode,
    target: result.target,
    references: result.references,
    valid: result.valid,
    broken: result.broken,
    uniqueBroken: result.uniqueBroken.size,
    missingValues,
  };
}

async function auditSnapshot(snapshotPath: string, options: AuditOptions = {}): Promise<Record<string, any>> {
  const snapshot = path.resolve(snapshotPath);
  if (!fs.existsSync(snapshot) || !fs.statSync(snapshot).isDirectory()) {
    throw new Error(`Snapshot directory not found: ${snapshot}`);
  }
  const files = listJsonlFiles(snapshot);
  if (files.length === 0) {
    throw new Error(`No JSONL tables found in snapshot: ${snapshot}`);
  }

  const tables = new Map<string, { keys: Set<string>; records: number }>();
  let totalRecords = 0;
  for (const file of files) {
    const keys = new Set<string>();
    const records = await forEachJsonlRow(file, (row, lineNumber) => {
      if (!Object.prototype.hasOwnProperty.call(row, "_key")) {
        throw new Error(`${file.table}:${lineNumber}: missing _key`);
      }
      const key = normalizeKey(row._key);
      if (key === null) {
        throw new Error(`${file.table}:${lineNumber}: _key must be a scalar`);
      }
      if (keys.has(key)) {
        throw new Error(`${file.table}:${lineNumber}: duplicate _key ${key}`);
      }
      keys.add(key);
    });
    totalRecords += records;
    tables.set(file.table, { keys, records });
  }

  const rulesBySource = new Map<string, ReferenceRule[]>();
  const ruleResults = new Map<ReferenceRule, Record<string, any>>();
  for (const referenceRule of REFERENCE_RULES) {
    if (!rulesBySource.has(referenceRule.source)) {
      rulesBySource.set(referenceRule.source, []);
    }
    rulesBySource.get(referenceRule.source)!.push(referenceRule);
    ruleResults.set(referenceRule, createRuleResult(referenceRule));
  }

  const maxIssues = options.maxIssues ?? 100;
  const issues: Record<string, any>[] = [];
  const unmapped = new Map<string, Record<string, any>>();
  let checkedReferences = 0;
  let validReferences = 0;
  let brokenReferences = 0;
  const uniqueBroken = new Set<string>();

  function matchingRule(source: string, referencePath: string, mode: ReferenceMode): ReferenceRule | null {
    return (rulesBySource.get(source) || []).find((candidate) =>
      (candidate.mode || "value") === mode && matchesPath(candidate.path, referencePath)
    ) || null;
  }

  function recordUnmapped(source: string, referencePath: string, value: unknown): void {
    if (!isIdShapedPath(referencePath)) {
      return;
    }
    if (typeof value !== "number" && !(typeof value === "string" && /^-?\d+$/.test(value))) {
      return;
    }
    const normalized = normalizeKey(value);
    if (normalized === null) {
      return;
    }
    const mapKey = `${source}\u0000${referencePath}`;
    if (!unmapped.has(mapKey)) {
      unmapped.set(mapKey, { source, path: referencePath, occurrences: 0, samples: new Set<string>() });
    }
    const item = unmapped.get(mapKey)!;
    item.occurrences += 1;
    if (item.samples.size < 5) {
      item.samples.add(normalized);
    }
  }

  function checkReference(
    source: string,
    referencePath: string,
    displayPath: string,
    value: unknown,
    row: Record<string, any>,
    lineNumber: number,
    mode: ReferenceMode,
  ): void {
    const referenceRule = matchingRule(source, referencePath, mode);
    if (!referenceRule) {
      if (mode === "value") {
        recordUnmapped(source, referencePath, value);
      }
      return;
    }
    const normalized = normalizeKey(value);
    if (normalized === null || normalized === "") {
      return;
    }
    const availableTargets = targetsFor(referenceRule).filter((target) => tables.has(target));
    if (availableTargets.length === 0) {
      return;
    }
    const result = ruleResults.get(referenceRule)!;
    result.references += 1;
    checkedReferences += 1;
    const exists = availableTargets.some((target) => tables.get(target)!.keys.has(normalized));
    if (exists) {
      result.valid += 1;
      validReferences += 1;
      return;
    }
    result.broken += 1;
    result.uniqueBroken.add(normalized);
    brokenReferences += 1;
    uniqueBroken.add(`${referenceRule.source}\u0000${referenceRule.path}\u0000${normalized}`);
    const issue = {
      source,
      line: lineNumber,
      key: row._key,
      path: displayPath,
      value,
      target: targetsFor(referenceRule),
    };
    options.onBroken?.(issue);
    if (issues.length < maxIssues) {
      issues.push(issue);
    }
  }

  function walk(
    source: string,
    value: unknown,
    canonicalPath: string,
    displayPath: string,
    row: Record<string, any>,
    lineNumber: number,
  ): void {
    if (Array.isArray(value)) {
      value.forEach((item, index) => {
        walk(source, item, `${canonicalPath}[]`, `${displayPath}[${index}]`, row, lineNumber);
      });
      return;
    }
    if (value && typeof value === "object") {
      const keyRule = matchingRule(source, canonicalPath, "objectKeys");
      for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
        if (keyRule) {
          checkReference(source, canonicalPath, `${displayPath}.${key}`, key, row, lineNumber, "objectKeys");
        }
        const property = canonicalProperty(key);
        walk(
          source,
          child,
          canonicalPath ? `${canonicalPath}.${property}` : property,
          displayPath ? `${displayPath}.${key}` : key,
          row,
          lineNumber,
        );
      }
      return;
    }
    checkReference(source, canonicalPath, displayPath, value, row, lineNumber, "value");
  }

  for (const file of files) {
    await forEachJsonlRow(file, (row, lineNumber) => {
      walk(file.table, row, "", "", row, lineNumber);
    });
  }

  const unavailableRules = REFERENCE_RULES
    .filter((referenceRule) => tables.has(referenceRule.source) &&
      targetsFor(referenceRule).every((target) => !tables.has(target)))
    .map((referenceRule) => ({
      source: referenceRule.source,
      path: referenceRule.path,
      target: targetsFor(referenceRule),
    }));
  const publicUnmapped = [...unmapped.values()]
    .map((item): Record<string, any> => ({ ...item, samples: [...item.samples] }))
    .sort((left, right) => left.source.localeCompare(right.source, "en") || left.path.localeCompare(right.path, "en"));
  const publicRuleResults = [...ruleResults.values()]
    .filter((result) => tables.has(result.source) && result.references > 0)
    .map(publicRuleResult);

  return {
    snapshot,
    ok: brokenReferences === 0,
    tables: files.map((file) => ({
      name: file.table,
      records: tables.get(file.table)!.records,
      keys: tables.get(file.table)!.keys.size,
    })),
    summary: {
      files: files.length,
      records: totalRecords,
      rulesWithReferences: publicRuleResults.length,
      checkedReferences,
      validReferences,
      brokenReferences,
      uniqueBrokenReferences: uniqueBroken.size,
      issueExamples: issues.length,
      issueExamplesTruncated: Math.max(0, brokenReferences - issues.length),
      unmappedPaths: publicUnmapped.length,
      unmappedOccurrences: publicUnmapped.reduce((sum, item) => sum + item.occurrences, 0),
      unavailableRules: unavailableRules.length,
    },
    rules: publicRuleResults,
    issues,
    unmapped: publicUnmapped,
    unavailableRules,
  };
}

function writeBrokenReferencesReport(
  outputPath: string,
  report: Record<string, any>,
  brokenReferences: Record<string, any>[],
): string {
  const resolvedOutput = path.resolve(outputPath);
  fs.mkdirSync(path.dirname(resolvedOutput), { recursive: true });
  const artifact = {
    format: "evejs-frontier-broken-references-v1",
    generatedAt: new Date().toISOString(),
    snapshot: report.snapshot,
    summary: {
      ...report.summary,
      brokenReferenceRecords: brokenReferences.length,
    },
    failingRules: report.rules.filter((item: Record<string, any>) => item.broken > 0),
    brokenReferences,
  };
  fs.writeFileSync(resolvedOutput, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
  return resolvedOutput;
}

function formatNumber(value: number): string {
  return value.toLocaleString("en-US");
}

function renderText(report: Record<string, any>, options: ParsedOptions): string {
  const lines = [
    "Frontier SDE reference audit",
    `Snapshot: ${report.snapshot}`,
    `Scanned: ${formatNumber(report.summary.files)} JSONL tables, ${formatNumber(report.summary.records)} records`,
    `Checked: ${formatNumber(report.summary.checkedReferences)} references across ${formatNumber(report.summary.rulesWithReferences)} active rules`,
    `Result: ${formatNumber(report.summary.validReferences)} valid, ${formatNumber(report.summary.brokenReferences)} broken (${formatNumber(report.summary.uniqueBrokenReferences)} unique)`,
    `Coverage: ${formatNumber(report.summary.unmappedPaths)} unmapped numeric ID-shaped paths (${formatNumber(report.summary.unmappedOccurrences)} occurrences)`,
  ];
  if (report.outputFile) {
    lines.push(`Complete report: ${report.outputFile}`);
  }

  const displayedRules = report.rules.filter((item: Record<string, any>) => options.showPassed || item.broken > 0);
  if (displayedRules.length > 0) {
    lines.push("", options.showPassed ? "Rules:" : "Failing rules:");
    for (const item of displayedRules) {
      const status = item.broken > 0 ? "FAIL" : "PASS";
      lines.push(
        `  ${status} ${item.source}:${item.path} -> ${item.target.join(" | ")} ` +
        `(${formatNumber(item.references)} checked, ${formatNumber(item.broken)} broken, ${formatNumber(item.uniqueBroken)} unique)`,
      );
      if (item.missingValues.length > 0) {
        lines.push(`       missing IDs: ${item.missingValues.join(", ")}`);
      }
    }
  }

  if (report.issues.length > 0) {
    lines.push("", "Broken reference examples:");
    for (const issue of report.issues) {
      lines.push(
        `  ${issue.source}:${issue.line} key=${JSON.stringify(issue.key)} ${issue.path}=${JSON.stringify(issue.value)} ` +
        `-> ${issue.target.join(" | ")}`,
      );
    }
    if (report.summary.issueExamplesTruncated > 0) {
      lines.push(`  ... ${formatNumber(report.summary.issueExamplesTruncated)} more broken occurrences not shown`);
    }
  }

  if (options.showUnmapped && report.unmapped.length > 0) {
    lines.push("", "Unmapped numeric ID-shaped paths:");
    for (const item of report.unmapped) {
      lines.push(
        `  ${item.source}:${item.path} (${formatNumber(item.occurrences)} occurrences; samples: ${item.samples.join(", ")})`,
      );
    }
  }

  if (report.unavailableRules.length > 0) {
    lines.push("", "Rules skipped because none of their target tables were present:");
    for (const item of report.unavailableRules) {
      lines.push(`  ${item.source}:${item.path} -> ${item.target.join(" | ")}`);
    }
  }

  return lines.join("\n");
}

function renderRules(format: "text" | "json"): string {
  if (format === "json") {
    return JSON.stringify(REFERENCE_RULES.map((item) => ({
      ...item,
      mode: item.mode || "value",
      target: targetsFor(item),
    })), null, 2);
  }
  return REFERENCE_RULES.map((item) =>
    `${item.source}:${item.path}${item.mode === "objectKeys" ? " (object keys)" : ""} -> ${formatTargets(item)}`
  ).join("\n");
}

async function main(): Promise<void> {
  const options = parseArgs();
  if (options.help) {
    console.log(usage());
    return;
  }
  if (options.listRules) {
    console.log(renderRules(options.format));
    return;
  }
  const snapshot = options.snapshot || findLatestSnapshot();
  const allBrokenReferences: Record<string, any>[] = [];
  const report = await auditSnapshot(snapshot, {
    maxIssues: options.maxIssues,
    onBroken: (issue) => allBrokenReferences.push(issue),
  });
  if (options.writeOutput) {
    report.outputFile = writeBrokenReferencesReport(
      options.output || defaultOutputPath(snapshot),
      report,
      allBrokenReferences,
    );
  }
  console.log(options.format === "json" ? JSON.stringify(report, null, 2) : renderText(report, options));
  if (!report.ok || (options.strictUnmapped && report.summary.unmappedPaths > 0)) {
    process.exitCode = 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`[frontier-references] ${(error as Error).message}`);
    process.exitCode = 2;
  });
}

export {
  auditSnapshot,
  defaultOutputPath,
  findLatestSnapshot,
  matchesPath,
  parseArgs,
  REFERENCE_RULES,
  renderText,
  usage,
  writeBrokenReferencesReport,
};
