#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { findLatestSnapshot, validateSnapshot, } from "./validate-frontier-static.mjs";
import { auditTypeListSnapshot, compareTypeListSnapshotToGenerated, } from "./type-list-audit.mjs";
const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, "../..");
const RIFT_AUTHORITY_BUILDS = new Set([
    3450341,
    3455996,
    3463382,
    3465410,
    3467658,
    3474408,
    3488090,
    3502403,
]);
function usage() {
    return [
        "Usage:",
        "  node tools/frontier-static/build-frontier-database.mjs [options]",
        "",
        "Options:",
        "  --snapshot <path>  Extracted Frontier JSONL snapshot",
        "  --out <path>       EveJS data directory",
        "  --force            Replace an existing generated database",
        "  -h, --help         Show this help",
    ].join("\n");
}
function parseArgs(argv = process.argv.slice(2)) {
    const options = { force: false, outDir: null, snapshot: null };
    for (let index = 0; index < argv.length; index += 1) {
        const argument = argv[index];
        if (argument === "--snapshot") {
            options.snapshot = path.resolve(argv[++index] || "");
        }
        else if (argument === "--out") {
            options.outDir = path.resolve(argv[++index] || "");
        }
        else if (argument === "--force") {
            options.force = true;
        }
        else if (argument === "--help" || argument === "-h") {
            options.help = true;
        }
        else {
            throw new Error(`Unknown argument: ${argument}`);
        }
    }
    return options;
}
function readTable(dataDir, tableName, collectionName = null) {
    const tablePath = path.join(dataDir, tableName, "data.json");
    if (!fs.existsSync(tablePath)) {
        throw new Error(`Generated table is missing: ${tableName}`);
    }
    const table = JSON.parse(fs.readFileSync(tablePath, "utf8"));
    return collectionName ? table[collectionName] : table;
}
function sha256File(filePath) {
    const hash = crypto.createHash("sha256");
    hash.update(fs.readFileSync(filePath));
    return hash.digest("hex");
}
function installCollisionBundle(snapshot, snapshotManifest, dataDir) {
    const metadata = snapshotManifest.assets && snapshotManifest.assets.collisionBundle;
    if (!metadata || typeof metadata.path !== "string") {
        throw new Error("Frontier snapshot has no collision bundle asset");
    }
    const sourcePath = path.resolve(snapshot, metadata.path);
    const sourceRelative = path.relative(snapshot, sourcePath);
    if (!sourceRelative || sourceRelative.startsWith("..") || path.isAbsolute(sourceRelative)) {
        throw new Error(`Collision bundle path escapes the snapshot: ${metadata.path}`);
    }
    const storeRoot = path.resolve(dataDir, "..");
    const targetPath = path.resolve(storeRoot, metadata.path);
    const targetRelative = path.relative(storeRoot, targetPath);
    if (!targetRelative || targetRelative.startsWith("..") || path.isAbsolute(targetRelative)) {
        throw new Error(`Collision bundle path escapes the game store: ${metadata.path}`);
    }
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    fs.copyFileSync(sourcePath, targetPath);
    if (fs.statSync(targetPath).size !== metadata.bytes) {
        throw new Error("Installed collision bundle byte size mismatch");
    }
    if (sha256File(targetPath) !== metadata.sha256) {
        throw new Error("Installed collision bundle SHA-256 mismatch");
    }
    return {
        ...metadata,
        path: targetRelative.split(path.sep).join("/"),
    };
}
function validateDatabase(dataDir, snapshotManifest, databaseManifest) {
    if (databaseManifest.profile !== "frontier") {
        throw new Error("Generated database does not declare the Frontier profile");
    }
    if (databaseManifest.build !== snapshotManifest.source.client.build) {
        throw new Error("Generated database build does not match the static snapshot");
    }
    const systems = readTable(dataDir, "solarSystems", "solarSystems");
    const stargates = readTable(dataDir, "stargates", "stargates");
    const celestials = readTable(dataDir, "celestials", "celestials");
    const stations = readTable(dataDir, "stations", "stations");
    const itemTypes = readTable(dataDir, "itemTypes", "types");
    const creationHardpointTypes = readTable(dataDir, "creationHardpointTypes", "hardpointTypes");
    const creationModules = readTable(dataDir, "creationModules", "modules");
    const creationParts = readTable(dataDir, "creationParts", "parts");
    const creationTemplates = readTable(dataDir, "creationTemplates", "templates");
    const frontierDungeonTemplates = readTable(dataDir, "frontierDungeonTemplates", "dungeons");
    const landscapeDungeonTemplates = readTable(dataDir, "landscapeDungeonTemplates", "dungeons");
    const landscapeEcosystems = readTable(dataDir, "landscapeEcosystems", "ecosystems");
    const landscapeSites = readTable(dataDir, "landscapeSites", "sites");
    const clientTypeListTable = readTable(dataDir, "clientTypeLists");
    const clientTypeLists = clientTypeListTable.typeLists;
    const spaceComponentsByType = readTable(dataDir, "spaceComponentsByType", "types");
    const characters = readTable(dataDir, "characters");
    const componentTypesByID = new Map(spaceComponentsByType.map((row) => [Number(row.typeID ?? row._key), row]));
    const relay = componentTypesByID.get(90184);
    const relaySite = componentTypesByID.get(91717);
    if (Number(relay?.smartDeployable?.constructionSite) !== 91717) {
        throw new Error("Generated Relay component data does not map to construction site 91717");
    }
    if (!relaySite?.assemblyConstruction) {
        throw new Error("Generated Relay construction site lacks assemblyConstruction");
    }
    const expectedCelestials = [
        "mapStars.jsonl",
        "mapPlanets.jsonl",
        "mapMoons.jsonl",
        "mapLagrangePoints.jsonl",
    ].reduce((sum, fileName) => sum + snapshotManifest.outputs[fileName].records, 0);
    // Build 3502403 adds one local Cutting Laser copy outside the extracted SDE.
    const localPhysicsGunCount = Number(snapshotManifest.source.client.build) === 3502403 ? 1 : 0;
    const expected = {
        celestials: expectedCelestials,
        itemTypes: snapshotManifest.outputs["types.jsonl"].records - 1 + localPhysicsGunCount,
        creationHardpointTypes: snapshotManifest.outputs["creationHardpointTypes.jsonl"].records,
        creationModules: snapshotManifest.outputs["creationModules.jsonl"].records + localPhysicsGunCount,
        creationParts: snapshotManifest.outputs["creationParts.jsonl"].records,
        creationTemplates: snapshotManifest.outputs["creationTemplates.jsonl"].records,
        frontierDungeonTemplates: snapshotManifest.outputs["frontierDungeonTemplates.jsonl"].records,
        landscapeDungeonTemplates: snapshotManifest.outputs["landscapeDungeonTemplates.jsonl"].records,
        landscapeEcosystems: snapshotManifest.outputs["landscapeEcosystems.jsonl"].records,
        landscapeSites: snapshotManifest.outputs["landscapeSites.jsonl"].records,
        clientTypeLists: snapshotManifest.outputs["typeLists.jsonl"].records,
        stations: snapshotManifest.outputs["npcStations.jsonl"].records,
        stargates: snapshotManifest.outputs["mapStargates.jsonl"].records,
        systems: snapshotManifest.outputs["mapSolarSystems.jsonl"].records,
    };
    const actual = {
        celestials: celestials.length,
        itemTypes: itemTypes.length,
        creationHardpointTypes: creationHardpointTypes.length,
        creationModules: creationModules.length,
        creationParts: creationParts.length,
        creationTemplates: creationTemplates.length,
        frontierDungeonTemplates: frontierDungeonTemplates.length,
        landscapeDungeonTemplates: landscapeDungeonTemplates.length,
        landscapeEcosystems: landscapeEcosystems.length,
        landscapeSites: landscapeSites.length,
        clientTypeLists: clientTypeLists.length,
        stations: stations.length,
        stargates: stargates.length,
        systems: systems.length,
    };
    for (const key of Object.keys(expected)) {
        if (actual[key] !== expected[key]) {
            throw new Error(`Generated ${key} count mismatch: expected ${expected[key]}, found ${actual[key]}`);
        }
    }
    if (localPhysicsGunCount) {
        const sourceType = itemTypes.find((entry) => Number(entry.typeID) === 95317);
        const physicsGunTypes = itemTypes.filter((entry) => Number(entry.typeID) === 99999);
        const physicsGunModules = creationModules.filter((entry) => Number(entry.typeID) === 99999);
        const dogma = readTable(dataDir, "typeDogma", "typesByTypeID");
        const sourceDogma = dogma["95317"];
        const physicsGunDogma = dogma["99999"];
        if (!sourceType || physicsGunTypes.length !== 1 ||
            physicsGunTypes[0].name !== "Physics Gun" ||
            !["groupID", "categoryID", "mass", "volume", "capacity", "iconID", "graphicID"]
                .every((field) => physicsGunTypes[0][field] === sourceType[field]) ||
            physicsGunModules.length !== 1 ||
            physicsGunModules[0].behavior !== "generic" ||
            physicsGunModules[0].capability !== "weapon" ||
            physicsGunModules[0].system !== "weapons" ||
            JSON.stringify(physicsGunModules[0].placement?.compatible_hardpoints) !== JSON.stringify(["weapon"]) ||
            !sourceDogma || !physicsGunDogma ||
            physicsGunDogma.typeName !== "Physics Gun" ||
            JSON.stringify(physicsGunDogma.attributes) !== JSON.stringify(sourceDogma.attributes) ||
            JSON.stringify(physicsGunDogma.effects) !== JSON.stringify(sourceDogma.effects) ||
            JSON.stringify(physicsGunDogma.effectEntries) !== JSON.stringify(sourceDogma.effectEntries)) {
            throw new Error("Generated Physics Gun type, Creation module, or Dogma differs from Cutting Laser");
        }
    }
    if (clientTypeListTable.schemaVersion !== 2 ||
        clientTypeListTable.source?.typeListsSha256 !== snapshotManifest.outputs["typeLists.jsonl"].sha256 ||
        clientTypeListTable.source?.typesSha256 !== snapshotManifest.outputs["types.jsonl"].sha256 ||
        clientTypeLists.some((entry) => [
            "includedTypeListIDs", "excludedTypeListIDs", "includedTags", "excludedTags", "filterByTags",
        ].some((field) => !Array.isArray(entry[field]))) ||
        itemTypes.some((entry) => !Array.isArray(entry.tags))) {
        throw new Error("Generated client type-list or item-tag data is not schema-v2 complete");
    }
    const clientTypeListIDs = new Set(clientTypeLists.map((entry) => Number(entry.listID)));
    for (const requiredListID of [861, 923, 985]) {
        if (!clientTypeListIDs.has(requiredListID)) {
            throw new Error(`Generated client type-list authority is missing list ${requiredListID}`);
        }
    }
    const stationIDs = new Set(stations.map((station) => Number(station.stationID)));
    const systemIDs = new Set(systems.map((system) => Number(system.solarSystemID)));
    const bootstrap = databaseManifest.bootstrap;
    if (!stationIDs.has(Number(bootstrap.stationID))) {
        throw new Error(`Bootstrap station is absent: ${bootstrap.stationID}`);
    }
    if (!systemIDs.has(Number(bootstrap.solarSystemID))) {
        throw new Error(`Bootstrap system is absent: ${bootstrap.solarSystemID}`);
    }
    for (const [characterID, character] of Object.entries(characters)) {
        if (Number(character.stationID) !== Number(bootstrap.stationID) ||
            Number(character.solarSystemID) !== Number(bootstrap.solarSystemID)) {
            throw new Error(`Character ${characterID} is outside the Frontier bootstrap location`);
        }
    }
    const lagrangePoints = celestials.filter((entry) => entry.kind === "lagrangePoint");
    const expectedLagrange = snapshotManifest.outputs["mapLagrangePoints.jsonl"].records;
    if (lagrangePoints.length !== expectedLagrange) {
        throw new Error(`Lagrange point count mismatch: expected ${expectedLagrange}, ` +
            `found ${lagrangePoints.length}`);
    }
    const clientBuild = Number(snapshotManifest.source.client.build);
    if (RIFT_AUTHORITY_BUILDS.has(clientBuild)) {
        const riftF935 = frontierDungeonTemplates.find((dungeon) => Number(dungeon.dungeonID) === 14001);
        const rift05D8 = frontierDungeonTemplates.find((dungeon) => Number(dungeon.dungeonID) === 14008);
        if (Number(riftF935?.entryTypeID) !== 92395 ||
            Number(rift05D8?.entryTypeID) !== 92415 ||
            !Array.isArray(riftF935?.triggers) ||
            !Array.isArray(rift05D8?.triggers)) {
            throw new Error(`Frontier build ${clientBuild} is missing the authoritative F935/05D8 Rift templates`);
        }
        const fringeTallyport = landscapeSites.find((site) => Number(site.itemID) === 900202923);
        if (!fringeTallyport ||
            Number(fringeTallyport.solarSystemID) !== 30010146 ||
            Number(fringeTallyport.typeID) !== 92480 ||
            Number(fringeTallyport.dungeonID) !== 14026) {
            throw new Error(`Frontier build ${clientBuild} is missing the Mraka Fringe Tallyport landscape site`);
        }
    }
    return {
        ...actual,
        bootstrap,
        characters: Object.keys(characters).length,
        lagrangePoints: lagrangePoints.length,
    };
}
async function main() {
    const options = parseArgs();
    if (options.help) {
        console.log(usage());
        return;
    }
    const snapshot = options.snapshot || findLatestSnapshot();
    const checked = await validateSnapshot(snapshot);
    const snapshotManifestPath = path.join(snapshot, "frontier-extraction-manifest.json");
    const snapshotManifest = JSON.parse(fs.readFileSync(snapshotManifestPath, "utf8"));
    const build = snapshotManifest.source.client.build;
    const dataDir = options.outDir ||
        path.join(REPO_ROOT, "_local", "frontier-gameStore", String(build), "data");
    const typeListAudit = auditTypeListSnapshot(snapshot, snapshotManifest);
    const previousStoreDelta = compareTypeListSnapshotToGenerated(snapshot, dataDir);
    if (typeListAudit.errors.length > 0) {
        throw new Error(`Type-list integrity audit failed: ${JSON.stringify(typeListAudit.errors.slice(0, 8))}`);
    }
    const args = [
        path.join(REPO_ROOT, "tools", "DatabaseCreator", "database-creator.js"),
        "--sde-dir",
        snapshot,
        "--out",
        dataDir,
        "--build",
        String(build),
        "--sde-url",
        `installed-client://eve-frontier/${build}`,
        "--profile",
        "frontier",
    ];
    if (options.force) {
        args.push("--force");
    }
    const result = spawnSync(process.execPath, args, {
        cwd: REPO_ROOT,
        encoding: "utf8",
        maxBuffer: 16 * 1024 * 1024,
    });
    if (result.error) {
        throw result.error;
    }
    if (result.status !== 0) {
        const detail = [result.stdout, result.stderr].filter(Boolean).join("\n").trim();
        throw new Error(`Frontier database generation failed${detail ? `:\n${detail}` : ""}`);
    }
    const databaseManifestPath = path.resolve(dataDir, "../manifest.json");
    const databaseManifest = JSON.parse(fs.readFileSync(databaseManifestPath, "utf8"));
    const collisionBundle = installCollisionBundle(snapshot, snapshotManifest, dataDir);
    databaseManifest.assets = {
        ...(databaseManifest.assets || {}),
        collisionBundle,
    };
    fs.writeFileSync(databaseManifestPath, `${JSON.stringify(databaseManifest, null, 2)}\n`, "utf8");
    const report = validateDatabase(dataDir, snapshotManifest, databaseManifest);
    const typeListAuditPath = path.resolve(dataDir, "../type-list-audit.json");
    fs.writeFileSync(typeListAuditPath, `${JSON.stringify({
        ...typeListAudit,
        previousStoreDelta,
    }, null, 2)}\n`, "utf8");
    const reportPath = path.resolve(dataDir, "../frontier-database-validation.json");
    fs.writeFileSync(reportPath, `${JSON.stringify({
        build: checked.build,
        databaseManifest: databaseManifestPath,
        dataDir,
        collisionBundle,
        typeListAudit: {
            path: typeListAuditPath,
            ...typeListAudit.counts,
            missingRuntimeBindings: typeListAudit.missingRuntimeBindings,
            emptyRuntimeBindings: typeListAudit.emptyRuntimeBindings,
            previousStoreDelta,
        },
        ...report,
    }, null, 2)}\n`, "utf8");
    console.log(`[frontier-static] Database build ${build}: ` +
        `${report.systems.toLocaleString()} systems, ` +
        `${report.celestials.toLocaleString()} celestials, ` +
        `${report.landscapeSites.toLocaleString()} landscape sites, ` +
        `${report.stargates.toLocaleString()} stargates.`);
    console.log(`[frontier-static] Bootstrap: station ${report.bootstrap.stationID}, ` +
        `system ${report.bootstrap.solarSystemID}.`);
    console.log(`[frontier-static] Data: ${dataDir}`);
    if (typeListAudit.warnings.length > 0) {
        console.warn(`[frontier-static] Type-list audit: ${typeListAudit.warnings.length} warning(s); ` +
            `missing runtime IDs: ${typeListAudit.missingRuntimeBindings.map((entry) => entry.listID).join(", ") || "none"}. ` +
            `See ${typeListAuditPath}`);
    }
}
if (process.argv[1] &&
    path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    main().catch((error) => {
        console.error(`[frontier-static] ${error.message}`);
        process.exitCode = 1;
    });
}
export { installCollisionBundle, parseArgs, RIFT_AUTHORITY_BUILDS, validateDatabase, };
//# sourceMappingURL=build-frontier-database.mjs.map