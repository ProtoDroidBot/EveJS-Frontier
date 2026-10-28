"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { digest, prepareRuntime, environment, MARKER } = require("../../scripts/FrontierWorld/canonical-runtime");

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "canonical-runtime-selection-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const generated = path.join(root, "generated"), runtime = path.join(root, "runtime");
  fs.mkdirSync(path.join(generated, "data/itemTypes"), { recursive: true });
  const table = path.join(generated, "data/itemTypes/data.json"); fs.writeFileSync(table, '{"types":[]}');
  const world = path.join(root, "world.json"), content = path.join(root, "content.json");
  fs.writeFileSync(world, "{}"); fs.writeFileSync(content, "{}");
  const selection = { targetBuild: 3640684, sourceBuild: 3572727, sourceProfile: "3572727-canonical-fsd-v1",
    baseRevision: "a".repeat(64), contentRevision: "b".repeat(64), worldRevision: "c".repeat(64),
    worldPath: world, contentPath: content, worldSHA256: digest(world), contentSHA256: digest(content), counts: { systems: 1 } };
  const manifest = { profile: "frontier", build: 3640684, canonicalWorld: { sourceProfile: selection.sourceProfile, baseRevision: selection.baseRevision, worldSHA256: selection.worldSHA256 },
    compatibleCatalog: { build: 3640684 }, dataFiles: { "itemTypes/data.json": { sha256: digest(table), bytes: fs.statSync(table).size } } };
  const save = () => fs.writeFileSync(path.join(generated, "manifest.json"), JSON.stringify(manifest)); save();
  return { root, generated, runtime, selection, manifest, save, table };
}

test("explicit canonical runtime copies only the attested seed and reuses its exact ownership binding", t => {
  const f = fixture(t), selected = prepareRuntime(f.selection, f.generated, f.runtime);
  assert.equal(fs.readFileSync(path.join(selected.dataDir, "itemTypes/data.json"), "utf8"), '{"types":[]}');
  assert.ok(fs.existsSync(path.join(f.runtime, MARKER)));
  assert.deepEqual(prepareRuntime(f.selection, f.generated, f.runtime), selected);
  const env = environment(selected, 28700);
  assert.equal(env.EVEJS_CLIENT_BUILD, "3640684");
  assert.equal(env.EVEJS_LANDSCAPE_CONTENT_PATH, f.selection.contentPath);
  assert.equal(env.EVEJS_SERVER_PORT, "28700");
  assert.equal(env.EVEJS_SUI_ASSEMBLY_SYNC_ENABLED, "false");
  assert.ok(env.EVEJS_CONFIG_DIR.startsWith(f.runtime));
  assert.throws(() => environment(selected, 26000.5), /Port base/);
});
test("unowned roots, changed world revisions and mutable seed databases are refused", t => {
  const f = fixture(t); fs.mkdirSync(f.runtime);
  assert.throws(() => prepareRuntime(f.selection, f.generated, f.runtime), /without.*ownership marker/);
  fs.rmdirSync(f.runtime); prepareRuntime(f.selection, f.generated, f.runtime);
  assert.throws(() => prepareRuntime({ ...f.selection, contentRevision: "d".repeat(64) }, f.generated, f.runtime), /different world/);
  fs.writeFileSync(path.join(f.generated, "gamestore.sqlite"), "unapproved state");
  assert.throws(() => prepareRuntime(f.selection, f.generated, path.join(f.root, "other")), /mutable SQLite/);
});
test("tampered or extra static data cannot enter a candidate seed", t => {
  const f = fixture(t); fs.writeFileSync(f.table, '{"types":[{"typeID":1}]}');
  assert.throws(() => prepareRuntime(f.selection, f.generated, f.runtime), /attestation mismatch/);
  f.manifest.dataFiles["itemTypes/data.json"] = { sha256: digest(f.table), bytes: fs.statSync(f.table).size }; f.save();
  fs.mkdirSync(path.join(f.generated, "data/unattested")); fs.writeFileSync(path.join(f.generated, "data/unattested/data.json"), "{}");
  assert.throws(() => prepareRuntime(f.selection, f.generated, f.runtime), /attestation is incomplete/);
});
test("attested authored JSON manifests are copied alongside table data", t => {
  const f = fixture(t), relative = "authoredSpaceProps/Manifest.json";
  const source = path.join(f.generated, "data", relative); fs.mkdirSync(path.dirname(source)); fs.writeFileSync(source, '{"props":[]}');
  f.manifest.dataFiles[relative] = { sha256: digest(source), bytes: fs.statSync(source).size }; f.save();
  const selected = prepareRuntime(f.selection, f.generated, f.runtime);
  assert.equal(fs.readFileSync(path.join(selected.dataDir, relative), "utf8"), '{"props":[]}');
});
test("symlinks and paths overlapping the selected artifacts/generated source are refused", t => {
  const f = fixture(t), link = path.join(f.root, "link"); fs.symlinkSync(f.generated, link, "dir");
  assert.throws(() => prepareRuntime(f.selection, f.generated, path.join(link, "runtime")), /symlink/);
  assert.throws(() => prepareRuntime(f.selection, f.generated, path.join(f.generated, "runtime")), /overlaps/);
  assert.throws(() => prepareRuntime(f.selection, f.generated, f.root), /overlaps/);
  const binding = prepareRuntime(f.selection, f.generated, f.runtime);
  fs.symlinkSync(f.table, path.join(binding.configDir, "unsafe.json"));
  assert.throws(() => prepareRuntime(f.selection, f.generated, f.runtime), /symlink/);
});
test("canonical mining/dungeon identities bind the new world even without a content sidecar", t => {
  const config = require("../src/config"); const priorBuild = config.clientBuild; config.clientBuild = 3640684;
  const oldPath = process.env.EVEJS_EXPLORATION_WORLD_PATH; process.env.EVEJS_EXPLORATION_WORLD_PATH = "/unused/canonical-unit-fixture";
  t.after(() => { config.clientBuild = priorBuild; if (oldPath === undefined) delete process.env.EVEJS_EXPLORATION_WORLD_PATH; else process.env.EVEJS_EXPLORATION_WORLD_PATH = oldPath; });
  t.mock.method(require("../src/services/frontier/temporaryLandscapeProfile"), "getTemporaryLandscapeProfile", () => null);
  t.mock.method(require("../src/services/frontier/explorationWorld"), "getConfiguredExplorationWorld", () => ({ canonicalSource: true, baseRevision: "e".repeat(64), revision: "f".repeat(64) }));
  const revision = require("../src/services/mining/voxelMiningWorld").getVoxelMiningWorldRevision({ clientBuild: 3640684, voxelMiningWorldRevision: "old-profile" });
  assert.ok(revision.includes("e".repeat(64)) && revision.includes("/content/none/"));
  assert.ok(!revision.includes("old-profile"));
  assert.equal(require("../src/services/dungeon/dungeonContentProfile").getContentProfileRevision(), "f".repeat(64));
});
test("gateway credential selection creates and reads only runtime-local certificates", () => {
  const root = path.resolve(__dirname, "../.."), legacy = path.join(root, "server/src/_secondary/express/certs");
  const inventory = () => fs.readdirSync(legacy).sort().map(name => [name, digest(path.join(legacy, name))]);
  const before = inventory(), certDir = process.env.EVEJS_RUNTIME_CERT_DIR;
  assert.ok(certDir && certDir.startsWith(process.env.EVEJS_TEST_STORE_ROOT));
  const credentials = require("../src/_secondary/express/server").__testHooks.loadLocalTlsOptions();
  assert.deepEqual(credentials.certPem, fs.readFileSync(path.join(certDir, "gateway-dev-cert.pem")));
  assert.ok(require("../src/_secondary/express/localTlsCertificate").CA_CERT_PATH.startsWith(certDir));
  assert.deepEqual(inventory(), before, "Existing server certificate files must not be created or modified");
});
