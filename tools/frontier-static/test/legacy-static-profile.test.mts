import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { validateSnapshot } from "../validate-frontier-static.mjs";
import { auditBuildTypeLists, validateDatabase } from "../build-frontier-database.mjs";
import { PHASE4_SOURCE_HASHES, resolveStaticSchema } from "../lib/static-schema.mjs";

function fixture(t: { after: (fn: () => void) => void }) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "frontier-legacy-profile-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const schema = resolveStaticSchema(2703993);
  const manifest: any = { format: "evejs-frontier-static-v1", schemaProfile: schema.id,
    source: { client: { build: 2703993 }, ...Object.fromEntries(Object.entries(PHASE4_SOURCE_HASHES)
      .map(([key, sha256]) => [key, { sha256 }])) }, assets: {}, outputs: {} };
  const rows: Record<string, any[]> = {
    "_sde.jsonl": [{ _key: "sde", buildNumber: 2703993 }],
    "categories.jsonl": [{ _key: 1 }], "groups.jsonl": [{ _key: 1, categoryID: 1 }],
    "types.jsonl": [0, 1].map(_key => ({ _key, groupID: 1, name: { en: `Type ${_key}` } })),
    "dogmaAttributes.jsonl": [], "dogmaEffects.jsonl": [], "typeDogma.jsonl": [],
    "frontierDungeonTemplates.jsonl": [{ _key: 20, dungeonID: 20, rooms: [], triggers: [] }],
    "locationCache.jsonl": [], "mapConstellations.jsonl": [], "mapJumps.jsonl": [],
    "mapLagrangePoints.jsonl": [], "mapMoons.jsonl": [], "mapPlanets.jsonl": [], "mapRegions.jsonl": [],
    "mapSolarSystems.jsonl": [{ _key: 100, starID: 10, sunTypeID: 1, sourceHasStar: true }], "mapStargates.jsonl": [],
    "mapStars.jsonl": [{ _key: 10, solarSystemID: 100, typeID: 1 }],
    "npcStations.jsonl": [{ _key: 200, solarSystemID: 100, typeID: 1 }],
    "spaceComponentsByType.jsonl": [{ _key: 1 }],
    "typeLists.jsonl": [861, 923, 985].map(_key => ({ _key, includedTypeIDs: [1] })),
    "blueprints.jsonl": [{ _key: 1, activities: { manufacturing: {
      time: 5, materials: [{ typeID: 1, quantity: 2 }], products: [{ typeID: 1, quantity: 1 }],
    } } }],
  };
  rows["legacyBlueprintsSource.jsonl"] = structuredClone(rows["blueprints.jsonl"]);
  rows["legacyBlueprintDiagnostics.jsonl"] = [];
  for (const file of schema.emptyOutputs) rows[file] = [];
  function write(file: string, value: any[]) {
    rows[file] = value;
    const payload = value.map(row => JSON.stringify(row) + "\n").join("");
    fs.writeFileSync(path.join(root, file), payload);
    manifest.outputs[file] = { records: value.length, bytes: Buffer.byteLength(payload),
      sha256: crypto.createHash("sha256").update(payload).digest("hex") };
    fs.writeFileSync(path.join(root, "frontier-extraction-manifest.json"), JSON.stringify(manifest));
  }
  for (const [file, value] of Object.entries(rows)) write(file, value);
  return { root, rows, manifest, write };
}

test("exact Phase 4 snapshot retains real dungeon/map authority with explicitly unavailable modern tables", async t => {
  const { root } = fixture(t);
  const checked = await validateSnapshot(root);
  assert.equal(checked.schemaProfile, "frontier-phase4-2703993-v1");
  assert.equal(checked.collisionItems, null);
  assert.equal(checked.frontierDungeons, 1);
  assert.equal(checked.systems, 1);
  assert.equal(checked.landscapeSites, 0);
});

test("legacy capability omissions cannot hide injected newer data or missing blueprint attestations", async t => {
  const f = fixture(t);
  f.write("creationParts.jsonl", [{ _key: 1 }]);
  await assert.rejects(validateSnapshot(f.root), /requires an empty unavailable output/);
  f.write("creationParts.jsonl", []);
  delete f.manifest.outputs["blueprints.jsonl"];
  fs.writeFileSync(path.join(f.root, "frontier-extraction-manifest.json"), JSON.stringify(f.manifest));
  await assert.rejects(validateSnapshot(f.root), /missing required output: blueprints/);
});

test("legacy blueprint schema keeps activity references and quantities authoritative", async t => {
  const f = fixture(t);
  const row = f.rows["blueprints.jsonl"][0];
  row.activities.manufacturing.materials[0].typeID = 999;
  f.write("blueprints.jsonl", [row]);
  await assert.rejects(validateSnapshot(f.root), /materials references unknown type 999/);
  row.activities.manufacturing.materials[0] = { typeID: 1, quantity: 0 };
  f.write("blueprints.jsonl", [row]);
  await assert.rejects(validateSnapshot(f.root), /materials has invalid quantity/);
  row.activities.manufacturing.materials = { "1": 2 };
  f.write("blueprints.jsonl", [row]);
  await assert.rejects(validateSnapshot(f.root), /unsupported materials shape/);
});

test("legacy blueprint omissions must match complete raw source and exact exclusion diagnostics", async t => {
  const f = fixture(t);
  const source = structuredClone(f.rows["blueprints.jsonl"][0]);
  source.activities.copying = { time: 1 };
  source.activities.manufacturing.materials[0].typeID = 999;
  f.write("legacyBlueprintsSource.jsonl", [source]);
  const runtime = { ...source, activities: { copying: source.activities.copying } };
  f.write("blueprints.jsonl", [runtime]);
  f.write("legacyBlueprintDiagnostics.jsonl", [{ _key: "1:manufacturing", blueprintTypeID: 1,
    activity: "manufacturing", reason: "unresolved-type-reference", references: [{ field: "materials", typeID: 999 }] }]);
  assert.equal((await validateSnapshot(f.root)).excludedBlueprintActivities, 1);
  f.write("legacyBlueprintDiagnostics.jsonl", []);
  await assert.rejects(validateSnapshot(f.root), /exclusion diagnostics differ/);
  f.write("legacyBlueprintDiagnostics.jsonl", [{ _key: "1:manufacturing", blueprintTypeID: 1,
    activity: "manufacturing", reason: "unresolved-type-reference", references: [{ field: "materials", typeID: 999 }] }]);
  f.write("blueprints.jsonl", [{ ...runtime, activities: { copying: { time: 2 } } }]);
  await assert.rejects(validateSnapshot(f.root), /runtime activities differ/);
});

test("source skill level zero remains valid while fractional or excessive levels fail", async t => {
  const f = fixture(t);
  const row = f.rows["blueprints.jsonl"][0];
  row.activities.manufacturing.skills = [{ typeID: 1, level: 0 }];
  f.write("blueprints.jsonl", [row]);
  f.write("legacyBlueprintsSource.jsonl", [row]);
  await validateSnapshot(f.root);
  row.activities.manufacturing.skills[0].level = 1.5;
  f.write("blueprints.jsonl", [row]);
  await assert.rejects(validateSnapshot(f.root), /skills has invalid level/);
  row.activities.manufacturing.skills[0].level = 6;
  f.write("blueprints.jsonl", [row]);
  await assert.rejects(validateSnapshot(f.root), /skills has invalid level/);
});

test("legacy validation still rejects broken dungeon references and changed output hashes", async t => {
  const f = fixture(t);
  f.write("frontierDungeonTemplates.jsonl", [{ _key: 20, dungeonID: 20, triggers: [],
    rooms: [{ roomID: 1, objects: [{ objectID: 1, typeID: 999 }] }] }]);
  await assert.rejects(validateSnapshot(f.root), /unknown type 999/);
  f.write("frontierDungeonTemplates.jsonl", [{ _key: 20, dungeonID: 20, rooms: [], triggers: [] }]);
  fs.appendFileSync(path.join(f.root, "blueprints.jsonl"), " ");
  await assert.rejects(validateSnapshot(f.root), /Byte size mismatch: blueprints/);
});

test("a modern snapshot cannot opt out of its collision requirement", async t => {
  const f = fixture(t);
  f.manifest.source.client.build = 3502403;
  delete f.manifest.schemaProfile;
  fs.writeFileSync(path.join(f.root, "frontier-extraction-manifest.json"), JSON.stringify(f.manifest));
  await assert.rejects(validateSnapshot(f.root), /missing the collision bundle/);
});

test("legacy geography preserves authored starless systems without inventing suns", async t => {
  const f = fixture(t);
  f.write("mapSolarSystems.jsonl", [...f.rows["mapSolarSystems.jsonl"],
    { _key: 101, starID: 0, sunTypeID: 0, sourceHasStar: false }]);
  assert.equal((await validateSnapshot(f.root)).systems, 2);
  f.rows["mapSolarSystems.jsonl"][1].starID = 99;
  f.write("mapSolarSystems.jsonl", f.rows["mapSolarSystems.jsonl"]);
  await assert.rejects(validateSnapshot(f.root), /starless system 101 declares a star/);
});

test("only absent audited newer NPC lists become diagnostics; empty lists and structural/trade errors remain fatal", t => {
  const f = fixture(t);
  const required = [36, 142, 231, 336, 492, 601, 612].map(_key => ({ _key, includedTypeIDs: [1] }));
  f.write("typeLists.jsonl", required);
  const report = auditBuildTypeLists(f.root, f.manifest);
  assert.equal(report.errors.length, 0);
  assert.deepEqual(report.missingRuntimeBindings.filter(binding => binding.required).map(binding => binding.listID), [861, 923, 985]);
  assert.equal(report.warnings.filter(issue => issue.policy === f.manifest.schemaProfile).length, 3);
  f.write("typeLists.jsonl", [...required, { _key: 861, includedTypeIDs: [] }]);
  assert.ok(auditBuildTypeLists(f.root, f.manifest).errors.some(issue => issue.code === "empty-runtime-list" && issue.listID === 861));
  f.write("typeLists.jsonl", required.filter(row => row._key !== 142));
  assert.ok(auditBuildTypeLists(f.root, f.manifest).errors.some(issue => issue.code === "missing-runtime-list" && issue.listID === 142));
  f.write("typeLists.jsonl", [...required, { _key: 861, includedTypeIDs: [999] }]);
  assert.ok(auditBuildTypeLists(f.root, f.manifest).errors.some(issue => issue.code === "unknown-reference"));
});

function databaseFixture(t: { after: (fn: () => void) => void }) {
  const f = fixture(t);
  const data = path.join(f.root, "database");
  const writeTable = (name: string, value: any) => {
    fs.mkdirSync(path.join(data, name), { recursive: true });
    fs.writeFileSync(path.join(data, name, "data.json"), JSON.stringify(value));
  };
  for (const [name, key] of Object.entries({ solarSystems: "solarSystems", stargates: "stargates", celestials: "celestials",
    stations: "stations", itemTypes: "types", creationHardpointTypes: "hardpointTypes", creationModules: "modules",
    creationParts: "parts", creationTemplates: "templates", frontierDungeonTemplates: "dungeons",
    landscapeDungeonTemplates: "dungeons", landscapeEcosystems: "ecosystems", landscapeSites: "sites",
    spaceComponentsByType: "types", industryBlueprints: "blueprintDefinitions" })) writeTable(name, { [key]: [] });
  writeTable("solarSystems", { solarSystems: [{ solarSystemID: 100 }] });
  writeTable("celestials", { celestials: [{ kind: "sun", itemID: 10 }] });
  writeTable("stations", { stations: [{ stationID: 200 }] });
  writeTable("itemTypes", { types: [{ typeID: 1, tags: [] }] });
  writeTable("frontierDungeonTemplates", { dungeons: [{ dungeonID: 20 }] });
  writeTable("industryBlueprints", { blueprintDefinitions: [{ blueprintTypeID: 1 }] });
  writeTable("clientTypeLists", { schemaVersion: 2, source: {
    typeListsSha256: f.manifest.outputs["typeLists.jsonl"].sha256, typesSha256: f.manifest.outputs["types.jsonl"].sha256,
  }, typeLists: f.rows["typeLists.jsonl"].map(row => ({ listID: row._key, includedTypeListIDs: [],
    excludedTypeListIDs: [], includedTags: [], excludedTags: [], filterByTags: [] })) });
  writeTable("characters", {});
  const database = { build: 2703993, profile: "frontier", schemaProfile: f.manifest.schemaProfile,
    assets: {}, bootstrap: { stationID: 200, solarSystemID: 100 } };
  return { ...f, data, database, writeTable };
}

test("generated legacy database keeps exact counts and refuses a different schema declaration", t => {
  const f = databaseFixture(t);
  assert.equal(validateDatabase(f.data, f.manifest, f.database).schemaProfile, f.manifest.schemaProfile);
  assert.throws(() => validateDatabase(f.data, f.manifest, { ...f.database, schemaProfile: "frontier-modern-v1" }), /schema profile/);
  f.writeTable("creationParts", { parts: [{ graphicID: 1 }] });
  assert.throws(() => validateDatabase(f.data, f.manifest, f.database), /creationParts count mismatch/);
});
