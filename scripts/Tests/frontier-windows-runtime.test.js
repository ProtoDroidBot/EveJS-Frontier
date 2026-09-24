"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const assert = require("node:assert/strict");
const fs = require("node:fs");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");
const test = require("node:test");
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const POWERSHELL = "pwsh";
const probe = process.platform === "win32"
    ? spawnSync(POWERSHELL, ["-NoLogo", "-NoProfile", "-Command", "exit 0"])
    : { status: 1 };
const canRunPowerShell = process.platform === "win32" &&
    !probe.error && probe.status === 0;
test("Windows launchers and server tests select the same Frontier candidate", () => {
    const { DEFAULT_BUILD } = require("./run-frontier-server-tests");
    assert.equal(DEFAULT_BUILD, "3502403");
    for (const file of [
        "StartFrontierServer.ps1",
        "PlayFrontier.ps1",
        "StopFrontier.ps1",
    ]) {
        const source = fs.readFileSync(path.join(REPO_ROOT, file), "utf8");
        const match = source.match(/\[string\]\$Build\s*=\s*'(\d+)'/);
        assert.equal(match?.[1], DEFAULT_BUILD, `${file} default build`);
    }
});
test("Frontier setup still discovers the installed build independently", () => {
    for (const file of ["SetupFrontierWindows.ps1", "StageFrontierClient.ps1"]) {
        const source = fs.readFileSync(path.join(REPO_ROOT, file), "utf8");
        assert.match(source, /\[int\]\$Build\s*=\s*0\b/, file);
    }
});
test("the Windows candidate does not replace the macOS shell defaults", () => {
    for (const file of ["StageFrontierClient.sh", "StartFrontierServer.sh"]) {
        const source = fs.readFileSync(path.join(REPO_ROOT, file), "utf8");
        assert.match(source, /^BUILD="3467658"$/m, file);
    }
});
test("3502403 handshake metadata is scoped to Frontier environment overrides", (t) => {
    const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "evejs frontier build config "));
    t.after(() => fs.rmSync(fixtureRoot, { force: true, recursive: true }));
    // The config module synchronizes local JSON on import. Copy it into a
    // disposable repository layout so this test cannot alter the real config.
    const configPath = path.join(fixtureRoot, "server", "src", "config", "index.js");
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.copyFileSync(path.join(REPO_ROOT, "server", "src", "config", "index.js"), configPath);
    const environment = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("EVEJS_")));
    const probe = [
        "const config = require(process.argv[1]);",
        "const keys = ['clientBuild', 'clientVersion', 'machoVersion', 'eveBirthday',",
        "'projectCodename', 'projectRegion', 'projectVersion', 'clientCompatibilityProfile'];",
        "console.log(JSON.stringify(Object.fromEntries(keys.map(key => [key, config[key]]))));",
    ].join("\n");
    const defaultResult = spawnSync(process.execPath, ["-e", probe, configPath], {
        env: environment,
        encoding: "utf8",
    });
    assert.ifError(defaultResult.error);
    assert.equal(defaultResult.status, 0, defaultResult.stderr);
    const defaults = JSON.parse(defaultResult.stdout);
    assert.equal(defaults.clientBuild, 3396210);
    assert.equal(defaults.clientCompatibilityProfile, "tranquility");
    const frontierResult = spawnSync(process.execPath, ["-e", probe, configPath], {
        env: {
            ...environment,
            EVEJS_CLIENT_BUILD: "3502403",
            EVEJS_CLIENT_VERSION: "20.04",
            EVEJS_MACHO_VERSION: "489",
            EVEJS_EVE_BIRTHDAY: "170472",
            EVEJS_PROJECT_CODENAME: "cycle-6",
            EVEJS_PROJECT_REGION: "ccp",
            EVEJS_PROJECT_VERSION: "V20.04@ccp",
            EVEJS_CLIENT_COMPATIBILITY_PROFILE: "frontier",
        },
        encoding: "utf8",
    });
    assert.ifError(frontierResult.error);
    assert.equal(frontierResult.status, 0, frontierResult.stderr);
    assert.deepEqual(JSON.parse(frontierResult.stdout), {
        clientBuild: 3502403,
        clientVersion: 20.04,
        machoVersion: 489,
        eveBirthday: 170472,
        projectCodename: "cycle-6",
        projectRegion: "ccp",
        projectVersion: "V20.04@ccp",
        clientCompatibilityProfile: "frontier",
    });
});
function runScript(script, args) {
    return spawnSync(POWERSHELL, ["-NoLogo", "-NoProfile", "-NonInteractive", "-File", script, ...args], { encoding: "utf8" });
}
test("Windows runtime initialization carries generated collision assets", { skip: !canRunPowerShell }, (t) => {
    const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "evejs frontier collision runtime "));
    t.after(() => fs.rmSync(fixtureRoot, { force: true, recursive: true }));
    const startScript = path.join(fixtureRoot, "StartFrontierServer.ps1");
    fs.copyFileSync(path.join(REPO_ROOT, "StartFrontierServer.ps1"), startScript);
    const build = "9994412";
    const generatedRoot = path.join(fixtureRoot, "_local", "frontier-gameStore", build);
    fs.mkdirSync(path.join(generatedRoot, "data", "exampleTable"), { recursive: true });
    fs.writeFileSync(path.join(generatedRoot, "data", "exampleTable", "data.json"), "[]\n");
    const generatedBundle = path.join(generatedRoot, "assets", "collision", "bundle.collision");
    fs.mkdirSync(path.dirname(generatedBundle), { recursive: true });
    fs.writeFileSync(generatedBundle, "collision fixture\n");
    fs.writeFileSync(path.join(generatedRoot, "manifest.json"), "{}\n");
    fs.mkdirSync(path.join(fixtureRoot, "_local", "frontier-sde", build), { recursive: true });
    const initialize = runScript(startScript, [
        "-Build",
        build,
        "-InitializeOnly",
    ]);
    assert.equal(initialize.status, 0, initialize.stderr || initialize.stdout);
    const runtimeGameStore = path.join(fixtureRoot, "_local", "frontier-runtime", build, "gameStore");
    assert.equal(fs.readFileSync(path.join(runtimeGameStore, "assets", "collision", "bundle.collision"), "utf8"), "collision fixture\n");
    assert.equal(fs.existsSync(path.join(runtimeGameStore, "manifest.json")), true);
});
test("Frontier server dry-run rejects a stale synchronized Sui deployment", { skip: !canRunPowerShell }, (t) => {
    const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "evejs frontier stale world "));
    t.after(() => fs.rmSync(fixtureRoot, { force: true, recursive: true }));
    const startScript = path.join(fixtureRoot, "StartFrontierServer.ps1");
    fs.copyFileSync(path.join(REPO_ROOT, "StartFrontierServer.ps1"), startScript);
    const build = "9994411";
    const generatedRoot = path.join(fixtureRoot, "_local", "frontier-gameStore", build);
    fs.mkdirSync(path.join(generatedRoot, "data"), { recursive: true });
    fs.writeFileSync(path.join(generatedRoot, "manifest.json"), "{}\n");
    fs.mkdirSync(path.join(fixtureRoot, "_local", "frontier-sde", build), { recursive: true });
    const sourceWorkspace = path.join(fixtureRoot, "source");
    const deploymentPath = path.join(sourceWorkspace, "world-contracts", "deployments", "localnet", "extracted-object-ids.json");
    const publicationPath = path.join(sourceWorkspace, "world-contracts", "contracts", "world", "Pub.localnet.toml");
    fs.mkdirSync(path.dirname(deploymentPath), { recursive: true });
    fs.mkdirSync(path.dirname(publicationPath), { recursive: true });
    fs.writeFileSync(deploymentPath, "{}\n");
    fs.writeFileSync(publicationPath, "published-at = \"test\"\n");
    const configPath = path.join(fixtureRoot, "_local", "frontier-world", build, "world.private.json");
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(configPath, `${JSON.stringify({
        format: "evejs-frontier-world-sync-v1",
        schemaVersion: 1,
        state: "ready",
        build: Number(build),
        network: "localnet",
        chainId: "a1b2c3d4",
        sourceWorkspace,
        artifacts: {
            deploymentSha256: "0".repeat(64),
            publicationSha256: "0".repeat(64),
        },
    })}\n`);
    const result = runScript(startScript, ["-Build", build, "-DryRun"]);
    assert.notEqual(result.status, 0);
    assert.match(`${result.stderr}\n${result.stdout}`, /stale.*FrontierWorld\.ps1 sync/is);
});
function listen(server, port = 0) {
    return new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(port, "127.0.0.1", () => {
            server.off("error", reject);
            resolve();
        });
    });
}
function close(server) {
    return new Promise((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve());
    });
}
test("Windows runtime initialization and reset require an exact owned marker", { skip: !canRunPowerShell }, async (t) => {
    const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "evejs frontier runtime "));
    t.after(() => fs.rmSync(fixtureRoot, { force: true, recursive: true }));
    const startScript = path.join(fixtureRoot, "StartFrontierServer.ps1");
    const stopScript = path.join(fixtureRoot, "StopFrontier.ps1");
    const portReservation = net.createServer();
    await listen(portReservation);
    const resetGuardPort = portReservation.address().port;
    await close(portReservation);
    const startSource = fs.readFileSync(path.join(REPO_ROOT, "StartFrontierServer.ps1"), "utf8");
    const defaultPorts = "@(443, 26000, 26101, 26102, 26103, 5222, 26401)";
    assert.equal(startSource.includes(defaultPorts), true, "runtime script required-port declaration changed unexpectedly");
    fs.writeFileSync(startScript, startSource
        .replace(defaultPorts, `@(${resetGuardPort})`)
        // This fixture tests marker/reparse/listener guards. The managed test
        // host denies Win32_Process enumeration, so isolate that unrelated
        // host capability from the reset assertions below.
        .replace("            Get-CimInstance -ClassName Win32_Process -ErrorAction Stop |", "            @() |")
        .replace(`    $requiredPorts = @(${resetGuardPort})`, [
        "    if ($env:EVEJS_TEST_FRONTIER_LISTENER -eq '1') {",
        `        return @([pscustomobject]@{ LocalAddress = '127.0.0.1'; LocalPort = ${resetGuardPort}; OwningProcess = 1 })`,
        "    }",
        `    $requiredPorts = @(${resetGuardPort})`,
    ].join("\n")));
    fs.copyFileSync(path.join(REPO_ROOT, "StopFrontier.ps1"), stopScript);
    const commonModuleRelative = path.join("tools", "frontier-client", "FrontierWindows.Common.psm1");
    const commonModule = path.join(fixtureRoot, commonModuleRelative);
    fs.mkdirSync(path.dirname(commonModule), { recursive: true });
    fs.copyFileSync(path.join(REPO_ROOT, commonModuleRelative), commonModule);
    const build = "9994408";
    const generatedRoot = path.join(fixtureRoot, "_local", "frontier-gameStore", build);
    const generatedData = path.join(generatedRoot, "data", "exampleTable");
    const staticRoot = path.join(fixtureRoot, "_local", "frontier-sde", build);
    fs.mkdirSync(generatedData, { recursive: true });
    fs.mkdirSync(staticRoot, { recursive: true });
    fs.writeFileSync(path.join(generatedData, "data.json"), "[]\n");
    fs.writeFileSync(path.join(generatedRoot, "manifest.json"), "{}\n");
    const generatedCollisionBundle = path.join(generatedRoot, "assets", "collision", "bundle.collision");
    fs.mkdirSync(path.dirname(generatedCollisionBundle), { recursive: true });
    fs.writeFileSync(generatedCollisionBundle, "collision fixture\n");
    const dryRun = runScript(startScript, [
        "-Build",
        build,
        "-InitializeOnly",
        "-DryRun",
    ]);
    assert.equal(dryRun.status, 0, dryRun.stderr || dryRun.stdout);
    assert.match(dryRun.stdout, /would initialize/);
    const runtimeRoot = path.join(fixtureRoot, "_local", "frontier-runtime", build);
    assert.equal(fs.existsSync(runtimeRoot), false);
    const initialize = runScript(startScript, [
        "-Build",
        build,
        "-InitializeOnly",
    ]);
    assert.equal(initialize.status, 0, initialize.stderr || initialize.stdout);
    const markerPath = path.join(runtimeRoot, ".evejs-frontier-runtime");
    const marker = JSON.parse(fs.readFileSync(markerPath, "utf8"));
    assert.equal(marker.kind, "evejs-frontier-runtime");
    assert.equal(marker.build, build);
    assert.equal(path.resolve(marker.runtimeRoot), path.resolve(runtimeRoot));
    assert.equal(fs.existsSync(path.join(runtimeRoot, "gameStore", "data", "exampleTable", "data.json")), true);
    assert.equal(fs.readFileSync(path.join(runtimeRoot, "gameStore", "assets", "collision", "bundle.collision"), "utf8"), "collision fixture\n");
    assert.equal(fs.existsSync(path.join(runtimeRoot, "gameStore", "manifest.json")), true);
    const status = runScript(startScript, ["-Build", build, "-Status"]);
    assert.equal(status.status, 0, status.stderr || status.stdout);
    assert.match(status.stdout, /Runtime: initialized/);
    assert.match(status.stdout, /Background process: not running/);
    const externalNested = fs.mkdtempSync(path.join(os.tmpdir(), "evejs frontier runtime external "));
    t.after(() => fs.rmSync(externalNested, { force: true, recursive: true }));
    const nestedJunction = path.join(runtimeRoot, "gameStore", "data", "escape");
    fs.symlinkSync(externalNested, nestedJunction, "junction");
    const refusedReuse = runScript(startScript, [
        "-Build",
        build,
        "-InitializeOnly",
    ]);
    assert.notEqual(refusedReuse.status, 0);
    assert.match(`${refusedReuse.stderr}\n${refusedReuse.stdout}`, /nested reparse point/i);
    fs.rmSync(nestedJunction, { force: true });
    const sentinel = path.join(runtimeRoot, "user-state.sentinel");
    fs.writeFileSync(sentinel, "preserve\n");
    const resetDryRun = runScript(startScript, [
        "-Build",
        build,
        "-ResetRuntime",
        "-InitializeOnly",
        "-DryRun",
    ]);
    assert.equal(resetDryRun.status, 0, resetDryRun.stderr || resetDryRun.stdout);
    assert.match(resetDryRun.stdout, /would reset/);
    assert.equal(fs.existsSync(sentinel), true);
    const activeListener = net.createServer();
    await listen(activeListener, resetGuardPort);
    process.env.EVEJS_TEST_FRONTIER_LISTENER = "1";
    const refusedLiveReset = runScript(startScript, [
        "-Build",
        build,
        "-ResetRuntime",
        "-InitializeOnly",
    ]);
    delete process.env.EVEJS_TEST_FRONTIER_LISTENER;
    assert.notEqual(refusedLiveReset.status, 0);
    assert.match(`${refusedLiveReset.stderr}\n${refusedLiveReset.stdout}`, /required Frontier port\(s\) have listeners/i);
    assert.equal(fs.existsSync(sentinel), true);
    await close(activeListener);
    const validMarkerText = fs.readFileSync(markerPath, "utf8");
    fs.writeFileSync(markerPath, "{}\n");
    const refusedReset = runScript(startScript, [
        "-Build",
        build,
        "-ResetRuntime",
        "-InitializeOnly",
    ]);
    assert.notEqual(refusedReset.status, 0);
    assert.equal(fs.existsSync(sentinel), true);
    fs.writeFileSync(markerPath, validMarkerText);
    const acceptedReset = runScript(startScript, [
        "-Build",
        build,
        "-ResetRuntime",
        "-InitializeOnly",
    ]);
    assert.equal(acceptedReset.status, 0, acceptedReset.stderr || acceptedReset.stdout);
    assert.equal(fs.existsSync(sentinel), false);
    assert.equal(fs.existsSync(path.join(runtimeRoot, "gameStore", "data", "exampleTable", "data.json")), true);
    const stopStatus = runScript(stopScript, ["-Build", build, "-Status"]);
    assert.equal(stopStatus.status, 0, stopStatus.stderr || stopStatus.stdout);
    assert.match(stopStatus.stdout, /Background process: not running/);
    const pidMarkerPath = path.join(runtimeRoot, ".evejs-frontier-server.pid.json");
    fs.writeFileSync(pidMarkerPath, `${JSON.stringify({
        kind: "evejs-frontier-server-process",
        schemaVersion: 1,
        build,
        runtimeRoot,
        pid: 2147483647,
        processStartTimeUtcTicks: 1,
        nodePath: path.join(fixtureRoot, "node.exe"),
        serverEntry: path.join(fixtureRoot, "server", "index.js"),
    })}\n`);
    const staleStatus = runScript(stopScript, ["-Build", build, "-Status"]);
    assert.equal(staleStatus.status, 0, staleStatus.stderr || staleStatus.stdout);
    assert.match(staleStatus.stdout, /stale marker/);
    const stopDryRun = runScript(stopScript, ["-Build", build, "-DryRun"]);
    assert.equal(stopDryRun.status, 0, stopDryRun.stderr || stopDryRun.stdout);
    assert.match(stopDryRun.stdout, /would remove stale PID marker/);
    assert.equal(fs.existsSync(pidMarkerPath), true);
    const clearStale = runScript(stopScript, ["-Build", build]);
    assert.equal(clearStale.status, 0, clearStale.stderr || clearStale.stdout);
    assert.match(clearStale.stdout, /Removed stale PID marker/);
    assert.equal(fs.existsSync(pidMarkerPath), false);
    const dappPidMarkerPath = path.join(runtimeRoot, ".evejs-frontier-dapp.pid.json");
    fs.writeFileSync(dappPidMarkerPath, `${JSON.stringify({
        kind: "evejs-frontier-dapp-process",
        schemaVersion: 1,
        build,
        runtimeRoot,
        pid: 2147483647,
        processStartTimeUtcTicks: 1,
        nodePath: path.join(fixtureRoot, "node.exe"),
        dappEntry: path.join(fixtureRoot, "smart-assembly-control", "scripts", "serve.mjs"),
    })}\n`);
    const dappStaleStatus = runScript(stopScript, ["-Build", build, "-Status"]);
    assert.equal(dappStaleStatus.status, 0, dappStaleStatus.stderr || dappStaleStatus.stdout);
    assert.match(dappStaleStatus.stdout, /Smart Assembly dApp: stale marker/);
    const clearDappStale = runScript(stopScript, ["-Build", build]);
    assert.equal(clearDappStale.status, 0, clearDappStale.stderr || clearDappStale.stdout);
    assert.match(clearDappStale.stdout, /Removed stale Smart Assembly dApp PID marker/);
    assert.equal(fs.existsSync(dappPidMarkerPath), false);
});
test("Windows runtime initialization rejects a reparse-point ancestor", { skip: !canRunPowerShell }, (t) => {
    const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "evejs frontier runtime ancestor "));
    const externalRoot = fs.mkdtempSync(path.join(os.tmpdir(), "evejs frontier runtime target "));
    t.after(() => fs.rmSync(fixtureRoot, { force: true, recursive: true }));
    t.after(() => fs.rmSync(externalRoot, { force: true, recursive: true }));
    const startScript = path.join(fixtureRoot, "StartFrontierServer.ps1");
    fs.copyFileSync(path.join(REPO_ROOT, "StartFrontierServer.ps1"), startScript);
    const build = "9994409";
    const generatedRoot = path.join(fixtureRoot, "_local", "frontier-gameStore", build);
    fs.mkdirSync(path.join(generatedRoot, "data"), { recursive: true });
    fs.writeFileSync(path.join(generatedRoot, "manifest.json"), "{}\n");
    fs.mkdirSync(path.join(fixtureRoot, "_local", "frontier-sde", build), { recursive: true });
    const runtimeBase = path.join(fixtureRoot, "_local", "frontier-runtime");
    fs.symlinkSync(externalRoot, runtimeBase, "junction");
    const refused = runScript(startScript, [
        "-Build",
        build,
        "-InitializeOnly",
    ]);
    assert.notEqual(refused.status, 0);
    assert.match(`${refused.stderr}\n${refused.stdout}`, /reparse-point path component/i);
    assert.equal(fs.existsSync(path.join(externalRoot, build)), false);
});
test("Windows startup rolls back failed background launch and stops a foreground server", { skip: !canRunPowerShell }, async (t) => {
    const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "evejs frontier background rollback "));
    t.after(() => fs.rmSync(fixtureRoot, { force: true, recursive: true }));
    const portReservation = net.createServer();
    await listen(portReservation);
    const testPort = portReservation.address().port;
    await close(portReservation);
    const startScript = path.join(fixtureRoot, "StartFrontierServer.ps1");
    const source = fs.readFileSync(path.join(REPO_ROOT, "StartFrontierServer.ps1"), "utf8");
    const defaultPorts = "@(443, 26000, 26101, 26102, 26103, 5222, 26401)";
    const markerWrite = "        Write-JsonAtomic -Path $PidMarker -Value $pidMarkerValue";
    assert.equal(source.includes(defaultPorts), true);
    assert.equal(source.includes(markerWrite), true);
    fs.writeFileSync(startScript, source
        .replace(defaultPorts, `@(${testPort})`)
        .replace(markerWrite, "        throw 'injected PID-marker failure'"));
    const build = "9994410";
    const generatedRoot = path.join(fixtureRoot, "_local", "frontier-gameStore", build);
    fs.mkdirSync(path.join(generatedRoot, "data"), { recursive: true });
    fs.writeFileSync(path.join(generatedRoot, "manifest.json"), "{}\n");
    fs.mkdirSync(path.join(fixtureRoot, "_local", "frontier-sde", build), { recursive: true });
    fs.mkdirSync(path.join(fixtureRoot, "server", "node_modules", "better-sqlite3"), { recursive: true });
    fs.mkdirSync(path.join(fixtureRoot, "tools"), { recursive: true });
    fs.writeFileSync(path.join(fixtureRoot, "tools", "BuildTypeScript.ps1"), "exit 0\n");
    const childPidPath = path.join(fixtureRoot, "rollback-child.pid");
    fs.writeFileSync(path.join(fixtureRoot, "server", "index.js"), [
        '"use strict";',
        'const fs = require("node:fs");',
        `fs.writeFileSync(${JSON.stringify(childPidPath)}, String(process.pid));`,
        "setInterval(() => {}, 1000);",
        "",
    ].join("\n"));
    const dappRoot = path.join(fixtureRoot, "smart-assembly-control");
    const dappPidPath = path.join(fixtureRoot, "rollback-dapp-child.pid");
    fs.mkdirSync(path.join(dappRoot, "scripts"), { recursive: true });
    fs.mkdirSync(path.join(dappRoot, "node_modules"), { recursive: true });
    fs.writeFileSync(path.join(dappRoot, "package.json"), `${JSON.stringify({
        name: "fixture-dapp",
        private: true,
        scripts: { build: "node -e \"process.exit(0)\"" },
    })}\n`);
    fs.writeFileSync(path.join(dappRoot, "scripts", "serve.mjs"), [
        'import fs from "node:fs";',
        `fs.writeFileSync(${JSON.stringify(dappPidPath)}, String(process.pid));`,
        "setInterval(() => {}, 1000);",
        "",
    ].join("\n"));
    fs.writeFileSync(path.join(dappRoot, ".env.local"), "VITE_SUI_NETWORK=localnet\n");
    const worldRoot = path.join(fixtureRoot, "world-contracts");
    const worldArtifact = path.join(worldRoot, "deployments", "localnet", "extracted-object-ids.json");
    fs.mkdirSync(path.dirname(worldArtifact), { recursive: true });
    fs.writeFileSync(worldArtifact, "{}\n");
    fs.writeFileSync(path.join(path.dirname(worldArtifact), "npc-deployment.json"), "{}\n");
    fs.writeFileSync(path.join(dappRoot, ".deployment-source.json"), `${JSON.stringify({ worldDir: worldRoot, network: "localnet" })}\n`);
    const initialize = runScript(startScript, [
        "-Build",
        build,
        "-InitializeOnly",
    ]);
    assert.equal(initialize.status, 0, initialize.stderr || initialize.stdout);
    const failedStart = runScript(startScript, [
        "-Build",
        build,
        "-Background",
    ]);
    assert.notEqual(failedStart.status, 0);
    assert.match(`${failedStart.stderr}\n${failedStart.stdout}`, /injected PID-marker failure/i);
    assert.equal(fs.existsSync(childPidPath), true);
    const childPid = Number.parseInt(fs.readFileSync(childPidPath, "utf8"), 10);
    assert.equal(Number.isInteger(childPid) && childPid > 0, true);
    assert.equal(fs.existsSync(dappPidPath), true);
    const dappPid = Number.parseInt(fs.readFileSync(dappPidPath, "utf8"), 10);
    assert.equal(Number.isInteger(dappPid) && dappPid > 0, true);
    const processProbe = spawnSync(POWERSHELL, [
        "-NoLogo",
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        `if (Get-Process -Id ${childPid} -ErrorAction SilentlyContinue) { exit 1 }`,
    ], { encoding: "utf8" });
    assert.equal(processProbe.status, 0, `background child ${childPid} survived failed marker publication`);
    const dappProcessProbe = spawnSync(POWERSHELL, [
        "-NoLogo",
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        `if (Get-Process -Id ${dappPid} -ErrorAction SilentlyContinue) { exit 1 }`,
    ], { encoding: "utf8" });
    assert.equal(dappProcessProbe.status, 0, `dApp child ${dappPid} survived failed marker publication`);
    assert.equal(fs.existsSync(path.join(fixtureRoot, "_local", "frontier-runtime", build, ".evejs-frontier-server.pid.json")), false);
    assert.equal(fs.existsSync(path.join(fixtureRoot, "_local", "frontier-runtime", build, ".evejs-frontier-dapp.pid.json")), false);
    // Exercise the foreground launcher from another terminal. Mock only CIM,
    // which is unavailable in the managed test host; PID/path/time checks run.
    const stopScript = path.join(fixtureRoot, "StopFrontier.ps1");
    const stopSource = fs.readFileSync(path.join(REPO_ROOT, "StopFrontier.ps1"), "utf8");
    const cimLookup = 'Get-CimInstance Win32_Process -Filter "ProcessId = $($marker.pid)" -ErrorAction SilentlyContinue';
    assert.equal(stopSource.includes(cimLookup), true);
    fs.writeFileSync(stopScript, stopSource.replaceAll(cimLookup, '[pscustomobject]@{ CommandLine = "$ServerEntry $DappEntry" }'));
    const commonModuleRelative = path.join("tools", "frontier-client", "FrontierWindows.Common.psm1");
    const commonModule = path.join(fixtureRoot, commonModuleRelative);
    fs.mkdirSync(path.dirname(commonModule), { recursive: true });
    fs.copyFileSync(path.join(REPO_ROOT, commonModuleRelative), commonModule);
    const foreground = spawn(POWERSHELL, [
        "-NoLogo", "-NoProfile", "-NonInteractive", "-File", startScript,
        "-Build", build,
    ], { cwd: fixtureRoot, env: process.env, windowsHide: true });
    let foregroundOutput = "";
    foreground.stdout.on("data", chunk => { foregroundOutput += chunk; });
    foreground.stderr.on("data", chunk => { foregroundOutput += chunk; });
    const serverMarkerPath = path.join(fixtureRoot, "_local", "frontier-runtime", build, ".evejs-frontier-server.pid.json");
    t.after(() => {
        if (fs.existsSync(serverMarkerPath)) {
            runScript(stopScript, ["-Build", build]);
        }
        if (foreground.exitCode === null)
            foreground.kill();
    });
    const deadline = Date.now() + 15_000;
    while (!fs.existsSync(serverMarkerPath) && Date.now() < deadline &&
        foreground.exitCode === null) {
        await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.equal(fs.existsSync(serverMarkerPath), true, foregroundOutput);
    const serverMarker = JSON.parse(fs.readFileSync(serverMarkerPath, "utf8"));
    assert.equal(serverMarker.launchMode, "foreground");
    assert.equal(serverMarker.pid, Number.parseInt(fs.readFileSync(childPidPath, "utf8"), 10));
    const stopped = runScript(stopScript, ["-Build", build]);
    assert.equal(stopped.status, 0, stopped.stderr || stopped.stdout);
    assert.match(stopped.stdout, /Stopped marker-owned Frontier server/);
    const foregroundExit = await new Promise(resolve => {
        if (foreground.exitCode !== null)
            resolve(foreground.exitCode);
        else
            foreground.once("exit", resolve);
    });
    assert.notEqual(foregroundExit, null);
    assert.equal(fs.existsSync(serverMarkerPath), false);
});
//# sourceMappingURL=frontier-windows-runtime.test.js.map