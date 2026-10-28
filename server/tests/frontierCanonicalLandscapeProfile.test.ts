"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { calculateExplorationWorldRevision } = require("../src/services/frontier/explorationWorld");
const profileModule = require("../src/services/frontier/temporaryLandscapeProfile");
const { createTemporaryLandscapeProfile, validateTemporaryLandscapeWorld } = profileModule;
const WORLD_REVISION = "a".repeat(64), SYSTEM = 30000004, SITE = 90000001;

function sign(value) { value.contentRevision = calculateExplorationWorldRevision(value); return value; }
function fixture() {
  const dungeon = { dungeonID: 1, rooms: [{ roomID: 2, position: { x: 0, y: 0, z: 0 },
    objects: [{ objectID: 3, typeID: 90, role: "scenery", position: { x: 1, y: 2, z: 3 } }] }] };
  return sign({ format: profileModule.CANONICAL_FORMAT, temporary: false,
    profile: profileModule.CANONICAL_PROFILE, targetBuild: 3640684,
    conversionPolicyRevision: profileModule.CANONICAL_CONVERSION_POLICY,
    anchorPolicyRevision: profileModule.CANONICAL_ANCHOR_POLICY,
    contentRevisionAlgorithm: "sha256-typed-f64-v1",
    source: { build: 3640684,
      files: Object.fromEntries(Object.entries(profileModule.SOURCE_HASHES).map(([name, sha256]) => [name, { sha256 }])),
      decodedOutputs: Object.fromEntries(Object.entries(profileModule.CATALOG_OUTPUT_SHA256).map(([name, sha256]) => [name, { sha256 }])),
      placements: { build: 3572727, archiveSHA256: profileModule.CANONICAL_ARCHIVE_SHA256,
        files: { landscape: { sha256: profileModule.CANONICAL_PLACEMENT_SHA256 } },
        decodedOutput: { sha256: profileModule.CANONICAL_PLACEMENT_DECODED_SHA256 } } },
    world: { label: profileModule.CANONICAL_WORLD_LABEL, sourceProfile: profileModule.CANONICAL_WORLD_PROFILE, revision: WORLD_REVISION },
    anchorProof: { policy: profileModule.CANONICAL_ANCHOR_POLICY, worldRevision: WORLD_REVISION,
      diagnosticDatabaseSHA256: profileModule.CANONICAL_DIAGNOSTIC_DB_SHA256 },
    systems: [{ id: SYSTEM, asteroidBelts: [], planets: [] }],
    tables: { itemTypes: { types: [{ typeID: 90, groupID: 226, categoryID: 2, name: "Compatible364" }] },
      landscapeSites: { sites: [{ itemID: SITE, solarSystemID: SYSTEM, ecosystemID: 7, typeID: 90, position: { x: 11, y: 22, z: 33 } }] },
      landscapeEcosystems: { ecosystems: [{ ecosystemID: 7, entryPattern: { beaconTypeID: 90 },
        naturalWorldPatterns: [{ dungeonID: 1, weight: 1, minOccurrences: 0, maxOccurrences: 1 }], brokenWorldPatterns: [] }] },
      landscapeDungeonTemplates: { dungeons: [dungeon] }, frontierDungeonTemplates: { dungeons: [structuredClone(dungeon)] } },
  });
}

test("canonical composition retains target364 and separately pins357 placements and364 catalogs", () => {
  const raw = fixture(), profile = createTemporaryLandscapeProfile(raw, { worldRevision: WORLD_REVISION });
  assert.equal(profile.raw.temporary, false);
  assert.equal(profile.raw.source.build, 3640684);
  assert.equal(profile.raw.source.placements.build, 3572727);
  assert.equal(profile.sites.get(SITE).position.x, 11);
  assert.equal(Object.isFrozen(profile.raw.tables.landscapeSites.sites[0]), true);
  assert.equal(validateTemporaryLandscapeWorld(profile, { revision: "b".repeat(64), baseRevision: WORLD_REVISION,
    systems: new Map([[SYSTEM, {}]]) }), true);
  assert.throws(() => validateTemporaryLandscapeWorld(profile, { revision: "b".repeat(64), systems: new Map([[SYSTEM, {}]]) }), /revision/);
});

test("rehashing cannot authorize mismatched source, policy or world identity", () => {
  const cases: Array<[(v: any) => void, RegExp]> = [
    [v => { v.targetBuild = 3572727; }, /target\/policy/],
    [v => { v.temporary = true; }, /format\/profile/],
    [v => { v.source.build = 3572727; }, /source must/],
    [v => { v.source.placements.build = 3640684; }, /placement provenance/],
    [v => { v.source.placements.files.landscape.sha256 = "f".repeat(64); }, /placement provenance/],
    [v => { v.source.decodedOutputs.dungeons.sha256 = "f".repeat(64); }, /compatible catalog fingerprint/],
    [v => { v.world.label = "3502403-MOD4-STUFF1"; }, /world\/anchor/],
    [v => { v.anchorProof.worldRevision = "b".repeat(64); }, /world\/anchor/],
    [v => { v.anchorProof.diagnosticDatabaseSHA256 = "f".repeat(64); }, /world\/anchor/],
    [v => { v.anchorPolicyRevision = "nearest-planet"; }, /target\/policy/],
    [v => { v.tables.landscapeDungeonTemplates.dungeons[0].rooms[0].objects[0].typeID = 93989; }, /target metadata/],
  ];
  for (const [change, expected] of cases) {
    const raw = fixture(); change(raw); sign(raw);
    assert.throws(() => createTemporaryLandscapeProfile(raw), expected);
  }
  const raw = fixture(); raw.tables.landscapeSites.sites[0].position.x++;
  assert.throws(() => createTemporaryLandscapeProfile(raw), /content revision/);
});

test("explicit canonical-content environment overrides legacy selection only in target364", t => {
  const config = require("../src/config"), directory = fs.mkdtempSync(path.join(os.tmpdir(), "canonical-content-"));
  const filename = path.join(directory, "content.json"); fs.writeFileSync(filename, JSON.stringify(fixture()));
  const original = { build: config.clientBuild, canonical: process.env.EVEJS_LANDSCAPE_CONTENT_PATH,
    legacy: process.env.EVEJS_TEMPORARY_LANDSCAPE_PATH };
  t.after(() => {
    config.clientBuild = original.build;
    for (const [name, value] of [["EVEJS_LANDSCAPE_CONTENT_PATH", original.canonical], ["EVEJS_TEMPORARY_LANDSCAPE_PATH", original.legacy]]) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
    profileModule.clearTemporaryLandscapeCache(); fs.rmSync(directory, { recursive: true, force: true });
  });
  config.clientBuild = 3640684;
  process.env.EVEJS_LANDSCAPE_CONTENT_PATH = filename;
  process.env.EVEJS_TEMPORARY_LANDSCAPE_PATH = path.join(directory, "must-not-load.json");
  profileModule.clearTemporaryLandscapeCache();
  assert.equal(profileModule.getTemporaryLandscapeProfile().raw.profile, profileModule.CANONICAL_PROFILE);
  config.clientBuild = 3572727;
  assert.equal(profileModule.getTemporaryLandscapeProfile(), null);
});
