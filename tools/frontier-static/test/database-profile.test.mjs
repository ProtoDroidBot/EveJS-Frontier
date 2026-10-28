import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { installCollisionBundle, RIFT_AUTHORITY_BUILDS, } from "../build-frontier-database.mjs";
const require = createRequire(import.meta.url);
const { DEFAULT_PROFILE, REQUIRED_TABLES, parseArgs, } = require("../../DatabaseCreator/database-creator.js");
test("DatabaseCreator emits Frontier deployable component authority", () => {
    assert.equal(REQUIRED_TABLES.includes("spaceComponentsByType"), true);
});
test("DatabaseCreator emits Frontier landscape site authority", () => {
    assert.equal(REQUIRED_TABLES.includes("landscapeSites"), true);
});
test("DatabaseCreator emits client type-list authority", () => {
    assert.equal(REQUIRED_TABLES.includes("clientTypeLists"), true);
});
test("DatabaseCreator emits complete Frontier dungeon authority", () => {
    assert.equal(REQUIRED_TABLES.includes("frontierDungeonTemplates"), true);
});
test("DatabaseCreator emits Frontier modular ship creation authority", () => {
    for (const table of [
        "creationHardpointTypes",
        "creationModules",
        "creationParts",
        "creationTemplates",
    ]) {
        assert.equal(REQUIRED_TABLES.includes(table), true);
    }
});
test("DatabaseCreator keeps Tranquility as its default profile", () => {
    assert.equal(DEFAULT_PROFILE, "tranquility");
    assert.equal(parseArgs([]).profile, "tranquility");
});
test("DatabaseCreator accepts only the explicit Frontier profile", () => {
    assert.equal(parseArgs(["--profile", "frontier"]).profile, "frontier");
    assert.throws(() => parseArgs(["--profile", "unknown"]), /Invalid database profile/);
});
test("build 3502403 is gated by the proven Frontier Rift authority profile", () => {
    assert.equal(RIFT_AUTHORITY_BUILDS.has(3467658), true);
    assert.equal(RIFT_AUTHORITY_BUILDS.has(3474408), true);
    assert.equal(RIFT_AUTHORITY_BUILDS.has(3488090), true);
    assert.equal(RIFT_AUTHORITY_BUILDS.has(3502403), true);
    assert.equal(RIFT_AUTHORITY_BUILDS.has(3502404), false);
    assert.equal(RIFT_AUTHORITY_BUILDS.has(3474409), false);
});
test("database generation installs and re-attests the collision bundle", (t) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "frontier-collision-install-"));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const snapshot = path.join(root, "snapshot");
    const dataDir = path.join(root, "gameStore", "data");
    const relativePath = "assets/collision/bundle.collision";
    const sourcePath = path.join(snapshot, ...relativePath.split("/"));
    fs.mkdirSync(path.dirname(sourcePath), { recursive: true });
    fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(sourcePath, "abc");
    const installed = installCollisionBundle(snapshot, {
        assets: {
            collisionBundle: {
                bytes: 3,
                path: relativePath,
                schema: "destiny.buffers.CollisionData",
                sha256: "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
            },
        },
    }, dataDir);
    assert.equal(installed.path, relativePath);
    assert.equal(fs.readFileSync(path.join(root, "gameStore", ...relativePath.split("/")), "utf8"), "abc");
});
//# sourceMappingURL=database-profile.test.mjs.map