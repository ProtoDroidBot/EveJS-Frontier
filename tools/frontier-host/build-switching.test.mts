import assert from "node:assert/strict";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { resolveBuildProfile } from "./config.mjs";
import { serverEnvironment, serverPaths } from "./server.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const require = createRequire(import.meta.url);
const { createIsolatedGameStore } = require("../../server/tests/helpers/isolatedGameStore.js");

// Exercise real config loading, the version packet and persistence in fresh
// processes. Small disposable seed stores do not establish full-client or
// exact-build static-data acceptance.
test("newer/older restarts retain exact wire identity and separate saved state", async t => {
  const stores = new Map<string, any>();
  for (const build of ["3640684", "3502403", "2703993"]) {
    const store = await createIsolatedGameStore({ baselineRoot: path.join(repoRoot, "server/src/gameStore") });
    stores.set(build, store);
    t.after(() => store.cleanup());
  }

  const run = (build: string, expectedVisits: number) => {
    const profile = resolveBuildProfile(repoRoot, build, {});
    const env = { ...serverEnvironment(serverPaths(repoRoot, build), profile, true), ...stores.get(build).env,
      EVEJS_PERSISTENCE_WORKER: "0" };
    const source = `
      (async () => {
        const assert = require("node:assert/strict");
        const root = ${JSON.stringify(repoRoot)};
        const build = ${JSON.stringify(build)};
        const config = require(root + "/server/src/config");
        const profiles = require(root + "/server/src/config/clientBuildProfiles");
        const database = require(root + "/server/src/gameStore");
        const Handshake = require(root + "/server/src/network/tcp/handshake");
        const { marshalDecode } = require(root + "/server/src/network/tcp/utils/marshal");
        const packets = [];
        new Handshake({ remoteAddress: "127.0.0.1", write: packet => packets.push(packet) }).start();
        assert.equal(packets.length, 1);
        assert.equal(packets[0].readUInt32BE(0), packets[0].length - 4);
        const version = marshalDecode(packets[0].subarray(4), { compatibilityProfile: "frontier" });
        assert.equal(version[0], 170472);
        assert.equal(version[1], 489);
        assert.equal(version[3], 20.04);
        assert.equal(version[4], Number(build));
        assert.equal(version[5], ${JSON.stringify(`${profile.clientCodename}@ccp`)});
        assert.equal(profiles.getClientBlockchainProtocol(config),
          build === "2703993" ? "evm" : build === "3640684" ? "sui" : "unknown");
        // 3502403 retains its manual launcher identity rather than inheriting
        // the preceding process's catalog profile or wallet protocol.
        if (build === "3502403") assert.equal(profiles.resolveClientBuildProfile(config), null);
        for (const enabled of Object.values(profiles.getServerBuildFeatures(config.clientBuild))) {
          assert.equal(enabled, build === "3640684");
        }
        database.ensureTable("buildSwitchValidation");
        const saved = database.read("buildSwitchValidation", "/visits");
        assert.equal(saved.success ? saved.data : 0, ${expectedVisits});
        assert.equal(database.write("buildSwitchValidation", "/visits", ${expectedVisits + 1}).success, true);
        database.flushAllSync();
        await database._shutdownPersistenceWorkerForTests();
        database._closeSqliteForTests();
      })().then(() => process.exit(0), error => { console.error(error); process.exit(1); });
    `;
    const child = spawnSync(process.execPath, ["-e", source], { cwd: repoRoot, env, encoding: "utf8", timeout: 15_000 });
    assert.ifError(child.error);
    assert.equal(child.status, 0, `${build} round trip failed:\n${child.stderr}\n${child.stdout}`);
  };

  run("3640684", 0);
  run("2703993", 0);
  run("3502403", 0);
  run("2703993", 1);
  run("3640684", 1);
  run("3502403", 1);
});
