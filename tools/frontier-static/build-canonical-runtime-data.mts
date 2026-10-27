#!/usr/bin/env node
/** Create a new DatabaseCreator seed from verified364catalogs and357geography. */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const { createDatabase } = require("../DatabaseCreator/database-creator.js");
const { calculateExplorationWorldRevision } = require("../../server/src/services/frontier/explorationWorld.js");

function sha(file: string) { return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex"); }
function read(file: string) { return JSON.parse(fs.readFileSync(file, "utf8")); }
function ensureNew(directory: string) {
  if (fs.existsSync(directory) && (fs.lstatSync(directory).isSymbolicLink() || fs.readdirSync(directory).length)) {
    throw new Error(`Refusing nonempty/symlink output: ${directory}`);
  }
  fs.mkdirSync(directory, { recursive: true });
}
function write(file: string, value: any) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(value, null, 2) + "\n"); }
function jsonl(file: string, rows: Iterable<any>) {
  const fd = fs.openSync(file, "wx"); let count = 0;
  try { for (const row of rows) { fs.writeSync(fd, JSON.stringify(row) + "\n"); count++; } } finally { fs.closeSync(fd); }
  return count;
}
function localRow(system: any, row: any, orbitID: number | null = null) {
  return { _key: row.id, solarSystemID: system.id, typeID: row.typeId, position: row.position,
    radius: row.radiusM ?? null, orbitID, celestialIndex: row.celestialIndex ?? null,
    orbitIndex: row.orbitIndex ?? null, name: row.name ?? null };
}
function table(data: string, name: string) { return read(path.join(data, name, "data.json")); }
function writeTable(data: string, name: string, value: any) { write(path.join(data, name, "data.json"), value); }
function files(directory: string, relative = ""): string[] {
  const found: string[] = [];
  for (const entry of fs.readdirSync(path.join(directory, relative), { withFileTypes: true })) {
    const next = path.join(relative, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`Output contains a symlink: ${next}`);
    if (entry.isDirectory()) found.push(...files(directory, next));
    else if (entry.isFile()) found.push(next.split(path.sep).join("/"));
    else throw new Error(`Output is not a regular file: ${next}`);
  }
  return found.sort();
}

async function main() {
  const args: Record<string, string> = {};
  for (let i = 2; i < process.argv.length; i += 2) {
    const flag = process.argv[i], value = process.argv[i + 1];
    if (!["--world", "--catalog", "--snapshot", "--out"].includes(flag) || !value || args[flag]) throw new Error(`Invalid argument ${flag}`);
    args[flag] = path.resolve(value);
  }
  for (const flag of ["--world", "--catalog", "--snapshot", "--out"]) if (!args[flag]) throw new Error(`Missing ${flag}`);
  const worldFile = args["--world"], catalog = args["--catalog"], snapshot = args["--snapshot"], generated = args["--out"];
  for (const output of [snapshot, generated]) for (const source of [worldFile, catalog]) {
    const relation = path.relative(source, output);
    if (!relation || (!relation.startsWith(".." + path.sep) && relation !== "..")) throw new Error("Outputs cannot overlap inputs");
  }
  if (snapshot === generated || snapshot.startsWith(generated + path.sep) || generated.startsWith(snapshot + path.sep)) throw new Error("Outputs cannot overlap");
  const world = read(worldFile), catalogFile = path.join(catalog, "manifest.json"), catalogManifest = read(catalogFile);
  if (world.targetBuild !== 3640684 || world.source?.profile !== "3572727-canonical-fsd-v1" || world.source?.build !== 3572727 ||
      world.source?.label !== "3572727-CANONICAL-FSD" || calculateExplorationWorldRevision(world) !== world.contentRevision) throw new Error("Invalid canonical world artifact");
  if (catalogManifest.build !== 3640684 || catalogManifest.format !== "evejs-compatible-native-catalogs-v1" ||
      catalogManifest.archiveSHA256 !== "2f43f4b8d34632b5d5fdc7b58af93364f606bd9ba67fcada588565ee0628122c") throw new Error("Invalid compatible catalog manifest");
  ensureNew(snapshot); ensureNew(generated);
  const snapshotFiles: Record<string, any> = {};
  for (const [name, meta] of Object.entries<any>(catalogManifest.outputs)) {
    if (path.basename(name) !== name || !name.endsWith(".jsonl")) throw new Error("Catalog path escapes snapshot");
    const source = path.join(catalog, name);
    if (sha(source) !== meta.sha256 || fs.statSync(source).size !== meta.size || fs.lstatSync(source).isSymbolicLink()) throw new Error(`Catalog hash mismatch: ${name}`);
    fs.copyFileSync(source, path.join(snapshot, name)); snapshotFiles[name] = { rows: meta.rows, sha256: meta.sha256, bytes: meta.size, sourceBuild: 3640684 };
  }
  function emit(name: string, rows: Iterable<any>) {
    const file = path.join(snapshot, name), count = jsonl(file, rows);
    snapshotFiles[name] = { rows: count, sha256: sha(file), bytes: fs.statSync(file).size, sourceBuild: 3572727 };
  }
  emit("_sde.jsonl", [{ _key: "sde", buildNumber: 3640684, branch: "//frontier/cycle-7", codename: "cycle-7", version: "20.04",
    provider: "Explicit canonical3572727 geography with compatible3640684 catalogs", geographySourceBuild: 3572727, worldRevision: world.contentRevision }]);
  emit("mapRegions.jsonl", world.regions.map((r: any) => ({ ...r, _key: r.id, regionID: r.id, position: r.center })));
  emit("mapConstellations.jsonl", world.constellations.map((r: any) => ({ ...r, _key: r.id, constellationID: r.id, regionID: r.regionId, position: r.center })));
  emit("mapSolarSystems.jsonl", world.systems.map((s: any) => ({ _key: s.id, name: s.name, solarSystemID: s.id, regionID: s.regionId,
    constellationID: s.constellationId, starID: s.sun.id, position: s.center, radius: s.radiusM, securityStatus: s.security,
    securityClass: s.securityClass, starTemperature: s.sunTemperatureK, frostLine: s.frostLineM,
    habitableZone: [s.habitableZoneInnerM, s.habitableZoneOuterM], sunTypeID: s.sunTypeId, neighbours: s.neighbours })));
  emit("mapStars.jsonl", (function* () { for (const s of world.systems) for (const r of [s.sun, ...s.companionSuns]) yield { ...localRow(s, r), statistics: { temperature: r.temperature } }; })());
  emit("mapPlanets.jsonl", (function* () { for (const s of world.systems) for (const r of s.planets) yield localRow(s, r, r.hostCelestialId); })());
  emit("mapMoons.jsonl", (function* () { for (const s of world.systems) for (const p of s.planets) for (const r of p.moons) yield localRow(s, r, p.id); })());
  emit("mapLagrangePoints.jsonl", (function* () { for (const s of world.systems) for (const p of s.planets) for (const r of p.lagrangePoints) yield { ...localRow(s, r, p.id), groupID: 4870, pointIndex: r.pointIndex }; })());
  emit("mapStargates.jsonl", (function* () { for (const s of world.systems) for (const g of s.stargates) yield { ...localRow(s, g), planetID: g.planetId ?? null,
    lagrangePointID: g.lagrangePointId ?? null, destination: { solarSystemID: g.destinationSystemId, stargateID: g.destinationGateId } }; })());
  emit("npcStations.jsonl", world.stations.map((s: any) => ({ ...s, _key: s.id })));
  write(path.join(snapshot, "composition-manifest.json"), { format: "evejs-canonical-static-composition-v1", targetBuild: 3640684,
    worldRevision: world.contentRevision, worldSHA256: sha(worldFile), catalogManifestSHA256: sha(catalogFile), files: snapshotFiles });
  const data = path.join(generated, "data");
  const manifest = await createDatabase({ sdeDir: snapshot, outDir: data, build: 3640684, profile: "frontier", sdeUrl: `local:3572727-CANONICAL-FSD/${world.contentRevision}`, force: false });
  // DatabaseCreator remains the authority for catalog/bootstrap tables. Correct
  // its legacy star-zero/gate-rounding/name projection only in this new seed.
  const local = new Map<number, any>(), systems = new Map<number, any>(), gates = new Map<number, any>();
  for (const s of world.systems) {
    systems.set(s.id, s);
    for (const r of [s.sun, ...s.companionSuns]) local.set(r.id, { row: r, system: s, parent: null });
    for (const p of s.planets) {
      local.set(p.id, { row: p, system: s, parent: p.hostCelestialId });
      for (const m of p.moons) local.set(m.id, { row: m, system: s, parent: p.id });
      for (const point of p.lagrangePoints) local.set(point.id, { row: point, system: s, parent: p.id });
    }
    for (const g of s.stargates) gates.set(g.id, { row: g, system: s });
  }
  const celestialTable = table(data, "celestials");
  if (celestialTable.celestials.length !== local.size) throw new Error("Creator omitted canonical celestials");
  for (const r of celestialTable.celestials) {
    const source = local.get(r.itemID); if (!source) throw new Error("Unexpected creator celestial");
    r.position = source.row.position; r.radius = source.row.radiusM ?? r.radius; r.orbitID = source.parent;
    r.itemName = source.row.name || `${source.system.name} - Star ${source.row.companionIndex + 1}`;
    if (source.row.celestialIndex !== undefined) r.celestialIndex = source.row.celestialIndex;
    if (source.row.orbitIndex !== undefined) r.orbitIndex = source.row.orbitIndex;
    if (source.row.pointIndex !== undefined) r.pointIndex = source.row.pointIndex;
    r.explorationWorldRevision = world.contentRevision;
  }
  writeTable(data, "celestials", celestialTable);
  const gateTable = table(data, "stargates");
  if (gateTable.stargates.length !== gates.size) throw new Error("Creator omitted canonical gates");
  for (const r of gateTable.stargates) {
    const source = gates.get(r.itemID); if (!source) throw new Error("Unexpected creator gate");
    r.position = source.row.position; r.destinationID = source.row.destinationGateId; r.destinationSolarSystemID = source.row.destinationSystemId;
    r.planetID = source.row.planetId ?? null; r.lagrangePointID = source.row.lagrangePointId ?? null;
    r.explorationWorldRevision = world.contentRevision;
  }
  writeTable(data, "stargates", gateTable);
  const stationMap = new Map<number, any>(world.stations.map((s: any) => [s.id, s])), stationTable = table(data, "stations");
  if (stationTable.stations.length !== stationMap.size) throw new Error("Creator omitted canonical stations");
  for (const r of stationTable.stations) {
    const s = stationMap.get(r.stationID); if (!s) throw new Error("Unexpected creator station");
    r.position = s.position; r.orbitID = s.orbitID; r.lagrangePointID = s.lagrangePointID; r.itemName = r.stationName = s.name;
    r.rotation = s.rotation; r.dockEntry = r.dockPosition = r.dockOrientation = r.undockDirection = r.undockPosition = null;
    r.dunRotation = s.rotation ? { x: s.rotation[0], y: s.rotation[1], z: s.rotation[2] } : null;
    r.explorationWorldRevision = world.contentRevision;
  }
  writeTable(data, "stations", stationTable);
  const characterTable = table(data, "characters"), itemTable = table(data, "items"), typeTable = table(data, "itemTypes");
  const validTypes = new Set(typeTable.types.map((t: any) => t.typeID));
  let characters = 0, items = 0;
  for (const c of Object.values<any>(characterTable)) {
    if (!systems.has(c.solarSystemID) || !stationMap.has(c.stationID)) throw new Error("Creator emitted a foreign bootstrap character");
    for (const key of ["homeStationID", "cloneStationID"]) if (c[key] && !stationMap.has(c[key])) throw new Error(`Foreign ${key}`);
    characters++;
  }
  for (const item of Object.values<any>(itemTable)) {
    if (!validTypes.has(item.typeID) || !stationMap.has(item.locationID)) throw new Error("Creator emitted a foreign bootstrap item");
    items++;
  }
  manifest.canonicalWorld = { sourceProfile: "3572727-canonical-fsd-v1", baseRevision: world.contentRevision, worldSHA256: sha(worldFile) };
  manifest.compatibleCatalog = { build: 3640684, manifestSHA256: sha(catalogFile), tableCount: Object.keys(catalogManifest.outputs).length,
    nativeTableCount: catalogManifest.catalogScope?.nativeTables ?? Object.keys(catalogManifest.outputs).length };
  manifest.composition = { format: "evejs-canonical-generated-seed-v1", snapshotManifestSHA256: sha(path.join(snapshot, "composition-manifest.json")),
    corrections: ["source-exact star positions", "source-exact gate positions", "source station names/parents/positions, no legacy per-ID dock placements"],
    catalogPolicy: "Verified3640684 catalog tables; raw native Frontier industry recipes/facilities retained separately without EVE activities conversion or runtime semantic change; optional missing JSONL use DatabaseCreator defaults, not current runtime imports",
    validation: { canonicalCelestials: local.size, canonicalGates: gates.size, canonicalStations: stationMap.size, bootstrapCharacters: characters, bootstrapItems: items } };
  manifest.dataFiles = Object.fromEntries(files(data).map(relative => { const file = path.join(data, relative); return [relative, { sha256: sha(file), bytes: fs.statSync(file).size }]; }));
  write(path.join(generated, "manifest.json"), manifest);
  console.log(JSON.stringify({ generated, snapshot, bootstrap: manifest.bootstrap, validation: manifest.composition.validation, attestedFiles: Object.keys(manifest.dataFiles).length }));
}

main().catch(error => { console.error(error.stack || String(error)); process.exitCode = 1; });
