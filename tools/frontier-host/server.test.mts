import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import crypto from "node:crypto";
import { spawn } from "node:child_process";
import nodeTest from "node:test";
import {
  assertSafePath, initializeRuntime, main, parseServerArgs, processIdentity, processState,
  resetRuntime, serverEnvironment, serverPaths, startOwned, stopOwned, validateRuntime, validateStartupArtifacts, waitReady,
} from "./server.mjs";

// This module exercises Linux /proc, signal, file-mode and listener ownership.
// Windows has its own PowerShell lifecycle suite in scripts/Tests.
const test = process.platform === "linux" ? nodeTest : nodeTest.skip;

function fixture(t: any) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "frontier-linux-host-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const layout = serverPaths(root, "3502403");
  fs.mkdirSync(layout.generatedData, { recursive: true });
  fs.mkdirSync(layout.generatedAssets, { recursive: true });
  fs.mkdirSync(layout.staticRoot, { recursive: true });
  fs.writeFileSync(path.join(layout.generatedData, "fixture.json"), '{"seed":true}');
  fs.writeFileSync(path.join(layout.generatedAssets, "fixture.bin"), "collision fixture");
  fs.writeFileSync(path.join(layout.generatedRoot, "manifest.json"), JSON.stringify({ build: 3502403 }));
  return layout;
}

function attestedFixture(t: any) {
  const layout = fixture(t);
  const bytes = fs.readFileSync(path.join(layout.generatedAssets, "fixture.bin"));
  const collision = { path: "assets/fixture.bin", bytes: bytes.length, sha256: crypto.createHash("sha256").update(bytes).digest("hex") };
  fs.writeFileSync(path.join(layout.generatedRoot, "manifest.json"), JSON.stringify({ build: Number(layout.build), profile: "frontier", assets: { collisionBundle: collision } }));
  fs.writeFileSync(path.join(layout.staticRoot, "frontier-extraction-manifest.json"), JSON.stringify({ format: "evejs-frontier-static-v1", source: { client: { build: Number(layout.build) } }, assets: { collisionBundle: collision } }));
  for (const table of ["solarSystems", "stargates", "celestials", "stations", "itemTypes"]) {
    fs.mkdirSync(path.join(layout.generatedData, table)); fs.writeFileSync(path.join(layout.generatedData, table, "data.json"), "{}");
  }
  fs.mkdirSync(layout.contractsRoot, { recursive: true });
  fs.writeFileSync(path.join(layout.contractsRoot, "descriptors.pb"), bytes);
  fs.writeFileSync(path.join(layout.contractsRoot, "frontier-contract-manifest.json"), JSON.stringify({ format: "evejs-frontier-contracts-v1", source: { build: Number(layout.build) }, outputs: { "descriptors.pb": { bytes: bytes.length, sha256: collision.sha256 } } }));
  return layout;
}

test("startup artifact guard rejects wrong build identities, changed hashes and missing payloads", t => {
  const layout = attestedFixture(t);
  assert.equal(validateStartupArtifacts(layout).build, layout.build);
  assert.equal(fs.existsSync(layout.runtimeRoot), false);
  const snapshotFile = path.join(layout.staticRoot, "frontier-extraction-manifest.json");
  const snapshotBytes = fs.readFileSync(snapshotFile);
  const wrongBuild = JSON.parse(snapshotBytes.toString()); wrongBuild.source.client.build = 3640684;
  fs.writeFileSync(snapshotFile, JSON.stringify(wrongBuild));
  assert.throws(() => validateStartupArtifacts(layout), /differs/);
  fs.writeFileSync(snapshotFile, snapshotBytes);
  const databaseFile = path.join(layout.generatedRoot, "manifest.json");
  const databaseBytes = fs.readFileSync(databaseFile);
  const wrongDatabase = JSON.parse(databaseBytes.toString()); wrongDatabase.build = 3640684;
  fs.writeFileSync(databaseFile, JSON.stringify(wrongDatabase));
  assert.throws(() => validateStartupArtifacts(layout), /another client build|differs/);
  fs.writeFileSync(databaseFile, databaseBytes);
  const asset = path.join(layout.generatedAssets, "fixture.bin"), original = fs.readFileSync(asset);
  fs.writeFileSync(asset, Buffer.alloc(original.length, 65));
  assert.throws(() => validateStartupArtifacts(layout), /hash mismatch/);
  fs.writeFileSync(asset, original);
  const mismatch = JSON.parse(snapshotBytes.toString()); mismatch.assets.collisionBundle.sha256 = "0".repeat(64);
  fs.writeFileSync(snapshotFile, JSON.stringify(mismatch));
  assert.throws(() => validateStartupArtifacts(layout), /differs from the selected snapshot/);
  fs.writeFileSync(snapshotFile, snapshotBytes);
  fs.unlinkSync(path.join(layout.contractsRoot, "descriptors.pb"));
  assert.throws(() => validateStartupArtifacts(layout), /ENOENT/);
  fs.writeFileSync(path.join(layout.contractsRoot, "descriptors.pb"), original);
  fs.unlinkSync(path.join(layout.generatedData, "itemTypes", "data.json"));
  assert.throws(() => validateStartupArtifacts(layout), /ENOENT/);
  assert.equal(fs.existsSync(layout.runtimeRoot), false);
});

test("initialize-only CLI applies the artifact guard before creating mutable runtime state", async t => {
  const layout = attestedFixture(t);
  const catalog = path.join(layout.repoRoot, "server", "src", "config", "clientBuildCatalog.json");
  fs.mkdirSync(path.dirname(catalog), { recursive: true }); fs.writeFileSync(catalog, '{"profiles":[]}');
  fs.writeFileSync(path.join(layout.generatedAssets, "fixture.bin"), "changed collision data");
  await assert.rejects(main(["start", "--build", layout.build, "--initialize-only"], layout.repoRoot), /attestation|hash mismatch/);
  assert.equal(fs.existsSync(layout.runtimeRoot), false);
  assert.equal(fs.existsSync(layout.runtimeBase), false);
});

test("Linux lifecycle requires an explicit exact build and rejects ambiguous options", () => {
  for (const args of [[], ["--build", ""], ["--build", "../3502403"], ["--build", "3502403", "--unknown"], ["--build", "3502403", "--build", "3640684"],
    ["--build", "3502403", "--background", "--initialize-only"], ["stop", "--build", "3502403", "--reset-runtime"]]) {
    assert.throws(() => parseServerArgs(args));
  }
  assert.deepEqual(parseServerArgs(["start", "--build", "3640684", "--background"]), {
    command: "start", build: "3640684", background: true, reset: false, initializeOnly: false, dryRun: false, quiet: false,
  });
  assert.equal(parseServerArgs(["start", "--build", "3502403", "--status"]).command, "status");
});

test("portable initialization copies assets and data while preserving mutable state on reuse", t => {
  const layout = fixture(t);
  fs.writeFileSync(path.join(layout.repoRoot, "evejs.config.local.json"), '{"frontierWorldPath":"/custom/world"}');
  initializeRuntime(layout);
  assert.equal(validateRuntime(layout).platform, "linux");
  assert.equal(fs.readFileSync(path.join(layout.runtimeGameStore, "assets", "fixture.bin"), "utf8"), "collision fixture");
  fs.writeFileSync(path.join(layout.runtimeData, "fixture.json"), '{"player":"saved"}');
  const runtimeConfig = path.join(layout.runtimeRoot, "evejs.config.local.json");
  assert.deepEqual(JSON.parse(fs.readFileSync(runtimeConfig, "utf8")), { frontierWorldPath: "/custom/world" });
  assert.equal(fs.statSync(runtimeConfig).mode & 0o777, 0o600);
  fs.writeFileSync(runtimeConfig, '{"frontierWorldPath":"/runtime/edited"}');
  initializeRuntime(layout);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(layout.runtimeData, "fixture.json"), "utf8")), { player: "saved" });
  assert.deepEqual(JSON.parse(fs.readFileSync(runtimeConfig, "utf8")), { frontierWorldPath: "/runtime/edited" });
});

test("runtime reuse rejects foreign markers and unowned existing paths", t => {
  const layout = fixture(t);
  fs.mkdirSync(layout.runtimeData, { recursive: true });
  assert.throws(() => initializeRuntime(layout), /ENOENT/);
  fs.writeFileSync(path.join(layout.runtimeRoot, ".evejs-frontier-runtime"), JSON.stringify({ kind: "evejs-frontier-runtime", schemaVersion: 1, build: "3640684" }));
  assert.throws(() => initializeRuntime(layout), /does not own/);
  assert.equal(fs.existsSync(layout.runtimeData), true);
});

test("runtime operations reject symbolic-link ancestors and nested data links", t => {
  const layout = fixture(t);
  const external = fs.mkdtempSync(path.join(os.tmpdir(), "frontier-external-"));
  t.after(() => fs.rmSync(external, { recursive: true, force: true }));
  fs.mkdirSync(path.dirname(layout.runtimeBase), { recursive: true });
  fs.symlinkSync(external, layout.runtimeBase);
  assert.throws(() => initializeRuntime(layout), /symbolic-link/);
  assert.throws(() => assertSafePath(layout.repoRoot, external), /escapes/);
  fs.unlinkSync(layout.runtimeBase);
  initializeRuntime(layout);
  fs.symlinkSync(external, path.join(layout.runtimeData, "escape"));
  assert.throws(() => validateRuntime(layout), /symbolic link/);
});

test("Linux server environment shares exact identity and keeps all listeners local", t => {
  const layout = serverPaths(fixture(t).repoRoot, "3640684");
  const environment = serverEnvironment(layout, { id: "frontier-3640684", clientBuild: 3640684, runtimeProfileId: "frontier-3640684", clientVersion: 20.04,
    clientCodename: "cycle-7", machoVersion: 489 });
  assert.equal(environment.EVEJS_CLIENT_BUILD, "3640684");
  assert.equal(environment.EVEJS_CLIENT_BUILD_PROFILE, "frontier-3640684");
  assert.equal(environment.EVEJS_PROJECT_CODENAME, "cycle-7");
  for (const field of ["EVEJS_GAME_SERVER_BIND_HOST", "EVEJS_IMAGE_SERVER_BIND_HOST", "EVEJS_MICROSERVICES_BIND_HOST", "EVEJS_XMPP_SERVER_BIND_HOST", "EVEJS_REDSHIFT_MONITOR_HOST"]) assert.equal(environment[field], "127.0.0.1");
  assert.equal(environment.EVEJS_PERSISTENCE_WORKER, "1");
  assert.equal(environment.EVEJS_COLLISION_BUNDLE_REQUIRED, "1");
  assert.equal(environment.EVEJS_CONFIG_DIR, layout.runtimeRoot);
  assert.equal(serverEnvironment(layout, { clientBuild: 3640684, clientVersion: 20.04, clientCodename: "cycle-7", machoVersion: 489 }).EVEJS_CLIENT_BUILD_PROFILE, "auto");
  assert.throws(() => serverEnvironment(layout, { clientBuild: 3502403 }), /does not match/);
  const legacy = serverPaths(layout.repoRoot, "2703993");
  assert.equal(serverEnvironment(legacy, { clientBuild: 2703993, clientVersion: 20.04, clientCodename: "FRONTIER-RELEASE", machoVersion: 489 }).EVEJS_COLLISION_BUNDLE_REQUIRED, "0");
  const unconverted = serverPaths(layout.repoRoot, "2702949");
  assert.equal(serverEnvironment(unconverted, { clientBuild: 2702949, clientVersion: 20.04 }).EVEJS_COLLISION_BUNDLE_REQUIRED, "1");
});

function processMarker(layout: ReturnType<typeof serverPaths>, identity: any) {
  return { ...identity, kind: "evejs-frontier-server-process", schemaVersion: 1, platform: "linux", build: layout.build,
    runtimeRoot: layout.runtimeRoot, role: "server", entry: layout.serverEntry, token: "fixture-token" };
}

test("PID ownership refuses a live unrelated command even when boot/start/executable match", { skip: process.platform !== "linux" }, t => {
  const layout = fixture(t); initializeRuntime(layout);
  const identity = processIdentity(process.pid)!;
  assert.match(identity.startTicks, /^\d+$/);
  fs.writeFileSync(path.join(layout.runtimeRoot, ".evejs-frontier-server.pid.json"), JSON.stringify(processMarker(layout, identity)));
  assert.throws(() => processState(layout, "server"), /does not match/);
});

test("stale PID marker cleanup never signals a reused live PID", { skip: process.platform !== "linux" }, async t => {
  const layout = fixture(t); initializeRuntime(layout);
  const identity = processIdentity(process.pid)!;
  const marker = processMarker(layout, { ...identity, startTicks: "0" });
  const location = path.join(layout.runtimeRoot, ".evejs-frontier-server.pid.json");
  fs.writeFileSync(location, JSON.stringify(marker));
  assert.equal(processState(layout, "server").state, "stale");
  await stopOwned(layout, "server");
  assert.equal(fs.existsSync(location), false);
  assert.ok(processIdentity(process.pid));
});

async function ephemeralPort() {
  const server = net.createServer();
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  const port = (server.address() as net.AddressInfo).port;
  await new Promise<void>(resolve => server.close(() => resolve()));
  return port;
}

test("owned fixture process reaches readiness and stops with SIGTERM", { skip: process.platform !== "linux" }, async t => {
  const layout = fixture(t); initializeRuntime(layout);
  fs.mkdirSync(path.dirname(layout.serverEntry), { recursive: true });
  fs.writeFileSync(layout.serverEntry, "const net=require('node:net');const s=net.createServer(c=>c.end());s.listen(Number(process.env.EVEJS_HOST_FIXTURE_PORT),'127.0.0.1');process.on('SIGTERM',()=>s.close(()=>process.exit(0)));\n");
  const port = await ephemeralPort();
  const child = await startOwned(layout, "server", { ...process.env, EVEJS_HOST_FIXTURE_PORT: String(port) });
  try {
    await waitReady(layout, "server", [port], 5000);
    assert.equal(processState(layout, "server").state, "running");
    await assert.rejects(resetRuntime(layout), /PID marker/);
    await stopOwned(layout, "server", 5000);
    assert.equal(processState(layout, "server").state, "stopped");
  } finally { try { child.kill("SIGTERM"); } catch {} }
});

test("readiness accepts listeners only from the owned process and respects cancellation", { skip: process.platform !== "linux" }, async t => {
  const layout = fixture(t); initializeRuntime(layout);
  fs.mkdirSync(path.dirname(layout.serverEntry), { recursive: true });
  fs.writeFileSync(layout.serverEntry, "setInterval(()=>{},1000);\n");
  const listener = net.createServer();
  await new Promise<void>((resolve, reject) => { listener.once("error", reject); listener.listen(0, "127.0.0.1", resolve); });
  const port = (listener.address() as net.AddressInfo).port;
  const child = await startOwned(layout, "server", process.env);
  try {
    await assert.rejects(waitReady(layout, "server", [port], 150), /timed out/);
    const controller = new AbortController(); controller.abort(new Error("fixture cancellation"));
    await assert.rejects(waitReady(layout, "server", [port], 1000, controller.signal), /fixture cancellation/);
    await stopOwned(layout, "server", 5000);
    assert.equal(listener.listening, true);
    await resetRuntime(layout, []);
    assert.equal(fs.existsSync(layout.runtimeRoot), false);
  } finally { try { child.kill("SIGTERM"); } catch {} await new Promise<void>(resolve => listener.close(() => resolve())); }
});

test("reset refuses stale markers and live listeners even for initialize-only workflows", { skip: process.platform !== "linux" }, async t => {
  const layout = fixture(t); initializeRuntime(layout);
  const file = path.join(layout.runtimeRoot, ".evejs-frontier-server.pid.json");
  fs.writeFileSync(file, JSON.stringify(processMarker(layout, { ...processIdentity(process.pid), startTicks: "0" })));
  await assert.rejects(resetRuntime(layout, []), /PID marker/);
  fs.unlinkSync(file);
  const listener = net.createServer();
  await new Promise<void>((resolve, reject) => { listener.once("error", reject); listener.listen(0, "127.0.0.1", resolve); });
  const port = (listener.address() as net.AddressInfo).port;
  try {
    await assert.rejects(resetRuntime(layout, [port]), /port .* unavailable/);
    assert.equal(fs.existsSync(layout.runtimeData), true);
  } finally { await new Promise<void>(resolve => listener.close(() => resolve())); }
});

test("reset refuses an unmarked manually launched process using the exact runtime", { skip: process.platform !== "linux" }, async t => {
  const layout = fixture(t); initializeRuntime(layout);
  fs.mkdirSync(path.dirname(layout.serverEntry), { recursive: true });
  fs.writeFileSync(layout.serverEntry, "setInterval(()=>{},1000);\n");
  const child = spawn(process.execPath, [layout.serverEntry], { cwd: layout.repoRoot, env: { ...process.env, EVEJS_GAMESTORE_DATA_DIR: layout.runtimeData }, stdio: "ignore" });
  await new Promise<void>((resolve, reject) => { child.once("spawn", resolve); child.once("error", reject); });
  try {
    await assert.rejects(resetRuntime(layout, []), /exact checkout|owns this runtime/);
    assert.equal(fs.existsSync(layout.runtimeData), true);
  } finally {
    const exited = new Promise<void>(resolve => child.once("exit", () => resolve()));
    child.kill("SIGTERM"); await exited;
  }
});

test("early fixture process exit fails readiness and preserves logs for diagnosis", { skip: process.platform !== "linux" }, async t => {
  const layout = fixture(t); initializeRuntime(layout);
  fs.mkdirSync(path.dirname(layout.serverEntry), { recursive: true });
  fs.writeFileSync(layout.serverEntry, "console.error('fixture startup failure');process.exit(7);\n");
  const child = await startOwned(layout, "server", process.env);
  try {
    await assert.rejects(waitReady(layout, "server", [65000], 5000), /exited before/);
    await stopOwned(layout, "server");
    assert.match(fs.readFileSync(path.join(layout.runtimeRoot, "server.stderr.log"), "utf8"), /fixture startup failure/);
  } finally { try { child.kill("SIGTERM"); } catch {} }
});

test("dApp ownership wrapper preserves its token without passing it to strict dApp option parsing", { skip: process.platform !== "linux" }, async t => {
  const layout = fixture(t); initializeRuntime(layout);
  const wrapper = path.join(layout.repoRoot, "tools", "frontier-host", "owned-dapp.mjs");
  fs.mkdirSync(path.dirname(wrapper), { recursive: true });
  fs.copyFileSync(new URL("./owned-dapp.mjs", import.meta.url), wrapper);
  fs.mkdirSync(path.dirname(layout.dappEntry), { recursive: true });
  fs.writeFileSync(layout.dappEntry, "import net from 'node:net';export async function createStaticServer(){return net.createServer(c=>c.end())}export function startStaticServer(s){s.listen(Number(process.env.EVEJS_HOST_FIXTURE_PORT),'127.0.0.1');process.on('SIGTERM',()=>s.close(()=>process.exit(0)))}\n");
  const port = await ephemeralPort();
  const child = await startOwned(layout, "dapp", { ...process.env, EVEJS_HOST_FIXTURE_PORT: String(port) });
  try {
    await waitReady(layout, "dapp", [port], 5000);
    assert.equal(processState(layout, "dapp").state, "running");
    await stopOwned(layout, "dapp", 5000);
    assert.equal(processState(layout, "dapp").state, "stopped");
  } finally { try { child.kill("SIGTERM"); } catch {} }
});
