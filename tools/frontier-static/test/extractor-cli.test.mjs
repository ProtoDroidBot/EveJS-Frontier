import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { REQUIRED_RESOURCES, buildRequest, parseArgs, selectBuild, } from "../extract-frontier-static.mjs";
function sourceFixture(t, omitted = []) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "frontier-extraction-source-"));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const cache = path.join(root, "ResFiles");
    fs.mkdirSync(path.join(cache, "ab"), { recursive: true });
    fs.writeFileSync(path.join(cache, "ab/cd"), "fixture");
    const resourceIndex = path.join(root, "resfileindex.txt");
    fs.writeFileSync(resourceIndex, Object.values(REQUIRED_RESOURCES)
        .filter(logicalPath => !omitted.includes(logicalPath))
        .map(logicalPath => `${logicalPath},ab/cd,unused,7,7`).join("\n"));
    const mapObjects = path.join(root, "mapObjects.db");
    fs.writeFileSync(mapObjects, "fixture");
    return { root, selected: { build: 2702949, resFilesRoot: cache,
            files: { resourceIndex, mapObjects } } };
}
test("extraction reports historical layout requirements together without writing files", t => {
    const missing = ["creation_hardpoint_types", "creation_modules", "creation_parts", "creation_templates", "ecosystem", "landscape"]
        .map(name => `res:/staticdata/${name}.fsdbinary`);
    const { root, selected } = sourceFixture(t, missing);
    const before = fs.readdirSync(root, { recursive: true });
    assert.throws(() => buildRequest(selected, root), error => {
        assert.ok(error instanceof Error);
        assert.match(error.message, /build 2702949 is recognized/);
        assert.match(error.message, /Older clients can legitimately omit/);
        for (const input of ["bin64/bundle.collision", ...missing])
            assert.ok(error.message.includes(input));
        return true;
    });
    assert.deepEqual(fs.readdirSync(root, { recursive: true }), before);
});
test("optional collision discovery preserves strict extraction and cache validation", t => {
    const { root, selected } = sourceFixture(t);
    assert.throws(() => buildRequest(selected, root), /requires inputs absent from this layout: bin64\/bundle\.collision/);
    selected.files.collisionBundle = path.join(root, "bundle.collision");
    fs.writeFileSync(selected.files.collisionBundle, Buffer.alloc(4, 255));
    assert.throws(() => buildRequest(selected, root), /Invalid collision FlatBuffer/);
    const payload = path.join(selected.resFilesRoot, "ab/cd");
    fs.writeFileSync(payload, "short");
    assert.throws(() => buildRequest(selected, root), /resource size mismatch/);
    fs.unlinkSync(payload);
    assert.throws(() => buildRequest(selected, root), /Indexed Frontier resource is missing/);
});
test("the Frontier snapshot includes deployable component authority", () => {
    assert.equal(REQUIRED_RESOURCES.spaceComponentsByType, "res:/staticdata/spacecomponentsbytype.fsdbinary");
});
test("the Frontier snapshot includes landscape site authority", () => {
    assert.equal(REQUIRED_RESOURCES.landscapes, "res:/staticdata/landscape.fsdbinary");
    assert.equal(REQUIRED_RESOURCES.ecosystems, "res:/staticdata/ecosystem.fsdbinary");
    assert.equal(REQUIRED_RESOURCES.dungeons, "res:/staticdata/dungeons.fsdbinary");
});
test("the Frontier dungeon resource also supplies Rift authority", () => {
    assert.equal(REQUIRED_RESOURCES.dungeons, "res:/staticdata/dungeons.fsdbinary");
});
test("the Frontier snapshot includes modular ship creation authority", () => {
    assert.equal(REQUIRED_RESOURCES.creationTemplates, "res:/staticdata/creation_templates.fsdbinary");
    assert.equal(REQUIRED_RESOURCES.creationModules, "res:/staticdata/creation_modules.fsdbinary");
    assert.equal(REQUIRED_RESOURCES.creationParts, "res:/staticdata/creation_parts.fsdbinary");
    assert.equal(REQUIRED_RESOURCES.creationHardpointTypes, "res:/staticdata/creation_hardpoint_types.fsdbinary");
});
test("the Frontier snapshot includes client type-list authority", () => {
    assert.equal(REQUIRED_RESOURCES.typeLists, "res:/staticdata/typelist.fsdbinary");
});
test("parseArgs accepts an explicit Frontier client and build", () => {
    const clientRoot = path.resolve("tmp", "frontier client");
    const outDir = path.resolve("tmp", "frontier output");
    const options = parseArgs([
        "--client-root",
        clientRoot,
        "--build",
        "3450341",
        "--out",
        outDir,
        "--force",
        "--dry-run",
    ]);
    assert.equal(options.clientRoot, clientRoot);
    assert.equal(options.build, 3450341);
    assert.equal(options.outDir, outDir);
    assert.equal(options.force, true);
    assert.equal(options.dryRun, true);
});
test("selectBuild chooses the requested build or newest available build", () => {
    const candidates = [{ build: 3450341 }, { build: 3440000 }];
    assert.equal(selectBuild(candidates, null).build, 3450341);
    assert.equal(selectBuild(candidates, 3440000).build, 3440000);
    assert.throws(() => selectBuild(candidates, 1), /is not installed/);
});
//# sourceMappingURL=extractor-cli.test.mjs.map