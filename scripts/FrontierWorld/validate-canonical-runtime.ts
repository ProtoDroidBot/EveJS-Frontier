"use strict";

const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const net = require("node:net");
const http = require("node:http");
const tls = require("node:tls");
const crypto = require("node:crypto");
const ROOT = path.resolve(__dirname, "../..");
const { digest } = require("./canonical-runtime");

async function validateRuntime() {
  const markerPath = process.env.EVEJS_CANONICAL_RUNTIME_MARKER;
  if (!markerPath) throw new Error("An explicitly owned canonical runtime is required");
  const binding = JSON.parse(fs.readFileSync(markerPath, "utf8"));
  assert.equal(binding.format, "evejs-canonical-runtime-v1");
  assert.equal(fs.realpathSync(process.env.EVEJS_GAMESTORE_DATA_DIR), fs.realpathSync(binding.dataDir));
  assert.equal(fs.realpathSync(process.env.EVEJS_CONFIG_DIR), fs.realpathSync(binding.configDir));
  assert.equal(digest(binding.worldPath), binding.worldSHA256);
  assert.equal(digest(binding.contentPath), binding.contentSHA256);
  const config = require(path.join(ROOT, "server/src/config"));
  assert.equal(config.clientBuild, 3640684);
  assert.equal(config.clientCompatibilityProfile, "frontier");
  const database = require(path.join(ROOT, "server/src/gameStore"));
  assert.equal(path.resolve(database._sqliteDbPath), path.join(binding.gameStoreRoot, "gamestore.sqlite"));
  const started = Date.now();
  try {
    if (process.env.EVEJS_CANONICAL_RESTART_CHECK === "1") {
      const previous = JSON.parse(fs.readFileSync(path.join(binding.runtimeRoot, "runtime-verification.json"), "utf8"));
      assert.ok(previous.validationIdentity, "Run current validate mode before restart-check");
      const receipt = database.read("voxelMiningState", "/canonicalValidationReceipt").data;
      assert.equal(receipt.worldRevision, previous.voxelRevision);
      assert.equal(receipt.baseRevision, binding.baseRevision);
      const { getExplorationRuntime } = require(path.join(ROOT, "server/src/services/frontier/explorationRuntime"));
      const runtime = getExplorationRuntime();
      let notices = 0; const unsubscribe = runtime.subscribe(() => notices++);
      const page = runtime.getKnownUniverse(previous.validationIdentity, { size: 1 });
      assert.ok(page.knowledge.visited_system_ids.includes("30000373"));
      assert.ok(runtime.getSystemDetail(previous.validationIdentity, "30000373").payload.length);
      assert.equal(notices, 0, "A duplicate persisted visit must not create a new reveal"); unsubscribe();
      const report = { status: "pass", worldRevision: binding.worldRevision, baseRevision: binding.baseRevision, contentRevision: binding.contentRevision,
        independentProcess: true, sqliteReceiptRetained: true, visitedDetailRetained: true, duplicateRevealNotices: notices, elapsedMs: Date.now() - started };
      fs.writeFileSync(path.join(binding.runtimeRoot, "restart-verification.json"), JSON.stringify(report, null, 2) + "\n");
      console.log(JSON.stringify(report)); return;
    }
    database.preloadAll();
    const { getConfiguredExplorationWorld } = require(path.join(ROOT, "server/src/services/frontier/explorationWorld"));
    const world = getConfiguredExplorationWorld();
    const profile = require(path.join(ROOT, "server/src/services/frontier/temporaryLandscapeProfile")).getTemporaryLandscapeProfile();
    assert.equal(world.revision, binding.worldRevision);
    assert.equal(world.baseRevision, binding.baseRevision);
    assert.equal(profile.revision, binding.contentRevision);
    assert.equal(world.sourceProfile, "3572727-canonical-fsd-v1");
    const worldData = require(path.join(ROOT, "server/src/space/worldData"));
    const maps = worldData.ensureLoaded();
    assert.equal(maps.solarSystems.length, 24026);
    assert.equal(maps.celestials.length, 357072);
    assert.equal(maps.stargates.length, 11728);
    assert.equal(maps.stations.length, 224);
    assert.equal(maps.asteroidBelts.length, 0, "Abstract map belts must not create old procedural fields");
    assert.equal(maps.frontierDungeonTemplates.length, 393);
    assert.equal(maps.landscapeEcosystems.length, 35);
    const enabledSites = [...profile.sites.values()].filter((site: any) => ![false, 0].includes(profile.ecosystems.get(site.ecosystemID).spawnEnabled));
    assert.equal(maps.landscapeSites.length, enabledSites.length);
    assert.equal(profile.sites.size, 137368);
    let geometryChecks = 0;
    const samePosition = (actual, expected) => { assert.deepEqual(actual, expected); geometryChecks++; };
    for (const system of world.systems.values()) {
      samePosition(maps.solarSystemsById.get(system.id).center, system.center);
      function check(row, parent = 0) {
        const scene = maps.celestialsById.get(row.id);
        assert.ok(scene, `Missing canonical scene object ${row.id}`);
        assert.equal(scene.solarSystemID, system.id);
        assert.equal(scene.typeID, row.typeId);
        samePosition(scene.position, row.position);
        if (row.radiusM !== undefined) assert.equal(scene.radius, row.radiusM);
        if (parent) assert.equal(scene.orbitID, parent);
      }
      for (const sun of [system.sun, ...system.companionSuns]) check(sun);
      for (const planet of system.planets) {
        check(planet, planet.hostCelestialId);
        for (const moon of planet.moons) check(moon, planet.id);
        for (const point of planet.lagrangePoints) check(point, planet.id);
      }
      for (const gate of system.stargates) {
        const scene = maps.stargatesById.get(gate.id);
        assert.equal(scene.solarSystemID, system.id);
        assert.equal(scene.destinationSolarSystemID, gate.destinationSystemId);
        assert.equal(scene.destinationID, gate.destinationGateId);
        samePosition(scene.position, gate.position);
      }
    }
    for (const station of world.stations.values()) {
      const scene = maps.stationsById.get(station.id);
      assert.equal(scene.stationTypeID, 85226);
      assert.equal(scene.typeID, 85226);
      assert.equal(scene.corporationID, station.ownerID);
      samePosition(scene.position, station.position);
    }
    assert.equal(maps.stationsById.has(64000229), false);
    assert.equal(maps.celestialsBySystem.get(30000018).filter(row => row.groupID === 7).length, 3);
    for (const systemID of [30000004, 30000018, 30000020, 30000038, 30000373]) {
      const scene = worldData.getStaticSceneForSystem(systemID);
      const planet = world.systems.get(systemID).planets[0];
      if (planet) samePosition(scene.find(row => row.itemID === planet.id).position, planet.position);
    }
    const { getVoxelMiningWorldRevision } = require(path.join(ROOT, "server/src/services/mining/voxelMiningWorld"));
    const voxelRevision = getVoxelMiningWorldRevision(config);
    assert.ok(voxelRevision.includes(binding.baseRevision) && voxelRevision.includes(binding.contentRevision));
    assert.equal(require(path.join(ROOT, "server/src/services/dungeon/dungeonContentProfile")).getContentProfileRevision(), binding.contentRevision);
    const { getExplorationRuntime } = require(path.join(ROOT, "server/src/services/frontier/explorationRuntime"));
    const runtime = getExplorationRuntime();
    const identity = { userID: 991024, characterID: crypto.randomInt(150000000, 200000000), currentSystemID: 30000004 };
    const knowledgeFile = () => path.join(binding.gameStoreRoot, "exploration", world.revision, `${identity.userID}-${identity.characterID}.json`);
    while (fs.existsSync(knowledgeFile())) identity.characterID = crypto.randomInt(150000000, 200000000);
    let notices = 0; const unsubscribe = runtime.subscribe(() => notices++);
    let pages = 0, total = 0, token = "";
    do {
      const page = runtime.getKnownUniverse(identity, { size: 512, token });
      assert.ok(page.payload.length > 0);
      assert.equal(Number(page.total_systems), 24026);
      token = page.next_page?.token || ""; pages++;
      if (pages > 48) throw new Error("Exploration pagination did not terminate");
      total = Number(page.total_systems);
    } while (token);
    assert.equal(pages, 47);
    assert.equal(total, 24026);
    assert.ok(runtime.getSystemDetail(identity, "30000004").payload.length > 0);
    assert.throws(() => runtime.getSystemDetail(identity, "30000373"), /EXPLORATION_SYSTEM_NOT_VISITED/);
    runtime.revealSystem(identity, 30000373);
    assert.ok(runtime.getSystemDetail(identity, "30000373").payload.length > 0);
    assert.ok(notices >= 1); unsubscribe();

    const { createExplorationGatewayService } = require(path.join(ROOT, "server/src/_secondary/express/gatewayServices/explorationGatewayService"));
    const { getExplorationProtoTypes, GET_SYSTEM_DETAIL_REQUEST } = require(path.join(ROOT, "server/src/_secondary/express/gatewayServices/explorationProto"));
    const types = getExplorationProtoTypes();
    const request = { payload: { value: Buffer.from(types.getSystemDetailRequest.encode({ solar_system: { sequential: 30000373 } }).finish()) } };
    const gateway = createExplorationGatewayService({ explorationRuntime: runtime, resolveExplorationIdentity: () => identity });
    const response = await gateway.handleRequest(GET_SYSTEM_DETAIL_REQUEST, request);
    assert.equal(response.statusCode, 200);
    assert.ok(types.getSystemDetailResponse.decode(response.responsePayloadBuffer).payload.length);
    gateway.dispose();
    const unauthenticated = createExplorationGatewayService({ explorationRuntime: runtime });
    assert.equal((await unauthenticated.handleRequest(GET_SYSTEM_DETAIL_REQUEST, request)).statusCode, 401); unauthenticated.dispose();

    // Persist a real world-scoped receipt through the ownership/SQLite seam,
    // then an independent process will verify it after this process closes.
    const { createTableRepository } = require(path.join(ROOT, "server/src/gameStore/tableRepository"));
    const repo = createTableRepository("service:mining", { strict: true });
    repo.ensureTable("voxelMiningState");
    assert.equal(repo.write("voxelMiningState", "/canonicalValidationReceipt", { worldRevision: voxelRevision, baseRevision: binding.baseRevision }).success, true);
    assert.equal(database.flushAllSync().success, true);
    const knowledge = knowledgeFile();
    const saved = JSON.parse(fs.readFileSync(knowledge, "utf8"));
    assert.ok(saved.visited.includes(30000373));

    // Complete world delivery, chunked to bound encoder/decoder memory.
    const wireDir = path.join(binding.runtimeRoot, "client-wire"); fs.mkdirSync(wireDir, { recursive: true });
    const wireManifest = { format: "evejs-canonical-wire-validation-v1", clientBuild: 3640684, worldRevision: world.revision, baseRevision: world.baseRevision, contentRevision: profile.revision, systems: world.systems.size, pages: [] as any[] };
    const ids = [...world.systems.keys()].sort((a, b) => a - b);
    const { encodeUniverseDelta } = require(path.join(ROOT, "server/src/services/frontier/explorationUniverseEncoder"));
    for (let offset = 0; offset < ids.length; offset += 512) {
      const delta = world.makeDelta(ids.slice(offset, offset + 512), true, 0);
      const stem = String(wireManifest.pages.length).padStart(3, "0"), expected = stem + ".json", payload = stem + ".bin";
      fs.writeFileSync(path.join(wireDir, expected), JSON.stringify(delta));
      const bytes = encodeUniverseDelta(delta); fs.writeFileSync(path.join(wireDir, payload), bytes);
      wireManifest.pages.push({ expected, payload, systems: delta.systems.length, expectedSHA256: digest(path.join(wireDir, expected)), payloadSHA256: digest(path.join(wireDir, payload)), bytes: bytes.length });
    }
    fs.writeFileSync(path.join(wireDir, "manifest.json"), JSON.stringify(wireManifest, null, 2) + "\n");
    const report = { status: "pass", clientBuild: config.clientBuild, baseRevision: world.baseRevision, contentRevision: profile.revision, worldRevision: world.revision,
      storeRoot: binding.gameStoreRoot, configDir: binding.configDir, counts: { systems: maps.solarSystems.length, celestials: maps.celestials.length, gates: maps.stargates.length, stations: maps.stations.length,
        authoredSites: profile.sites.size, enabledSites: maps.landscapeSites.length, dungeons: maps.frontierDungeonTemplates.length, ecosystems: maps.landscapeEcosystems.length },
      geometryChecks, paginationPages: pages, gatewayAuthorizedAndUnauthorizedChecked: true, validationIdentity: identity, voxelRevision, persistedReceipt: true, wireDir, wirePages: wireManifest.pages.length, elapsedMs: Date.now() - started };
    fs.writeFileSync(path.join(binding.runtimeRoot, "runtime-verification.json"), JSON.stringify(report, null, 2) + "\n");
    console.log(JSON.stringify(report));
  } finally { database.flushAllSync(); await database._shutdownPersistenceWorkerForTests(); database._closeSqliteForTests(); }
}

function connect(port, read = false) {
  return new Promise<Buffer>((resolve, reject) => {
    const socket = net.connect(port, "127.0.0.1"); socket.setTimeout(1500);
    const finish = (error = null, data = Buffer.alloc(0)) => { socket.removeAllListeners(); socket.destroy(); error ? reject(error) : resolve(data); };
    socket.once("error", error => finish(error)); socket.once("timeout", () => finish(new Error("candidate socket timeout")));
    if (read) socket.once("data", data => finish(null, data)); else socket.once("connect", () => finish());
  });
}
async function smokeRuntime({ binding, port, child }) {
  const started = Date.now(); let packet = null;
  while (Date.now() - started < 120000) {
    if (child.exitCode !== null || child.signalCode !== null) throw new Error("Candidate server exited before readiness; inspect server-smoke.log");
    try { packet = await connect(port, true); if (packet.length) break; } catch (_) { /* Wait only for this child. */ }
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  if (!packet?.length) throw new Error("Candidate game TCP listener did not return its handshake");
  for (const offset of [1, 2, 4]) await connect(port + offset);
  const trustedCA = fs.readFileSync(path.join(binding.runtimeRoot, "certs/xmpp-ca-cert.pem"));
  async function tlsProbe(target, h2 = false) {
    return new Promise<any>((resolve, reject) => {
      let authorized = false, protocol = "";
      const socket = tls.connect({ host: "127.0.0.1", port: target, servername: "localhost", ca: trustedCA,
        rejectUnauthorized: true, ...(h2 ? { ALPNProtocols: ["h2"] } : {}) });
      socket.setTimeout(5000, () => socket.destroy(new Error("Candidate TLS handshake timed out")));
      socket.once("error", reject);
      socket.once("secureConnect", () => { authorized = socket.authorized; protocol = socket.alpnProtocol || ""; socket.end(); });
      socket.once("close", () => authorized ? resolve({ authorized, protocol }) : reject(new Error("Candidate TLS authorization failed")));
    });
  }
  const gatewayTLS = await tlsProbe(port + 3, true), xmppTLS = await tlsProbe(port + 5);
  assert.equal(gatewayTLS.protocol, "h2");
  const redshift = await new Promise<any>((resolve, reject) => {
    const request = http.get(`http://127.0.0.1:${port + 4}/api/status`, response => { const chunks = []; response.on("error", reject); response.on("data", bytes => chunks.push(bytes)); response.on("end", () => resolve({ statusCode: response.statusCode, bytes: Buffer.concat(chunks).length })); }).on("error", reject);
    request.setTimeout(5000, () => request.destroy(new Error("Candidate status request timed out")));
  });
  assert.equal(redshift.statusCode, 200);
  return { status: "pass", clientBuild: 3640684, sourceBuild: 3572727, worldRevision: binding.worldRevision, runtimeRoot: binding.runtimeRoot,
    listeners: Array.from({ length: 6 }, (_, i) => ({ host: "127.0.0.1", port: port + i })), handshakeBytes: packet.length, gatewayTLS, xmppTLS, redshift, elapsedMs: Date.now() - started,
    scope: "Production server startup, six loopback listeners and a game handshake; no player login/native rendering/gameplay acceptance." };
}

module.exports = { validateRuntime, smokeRuntime };
if (require.main === module) validateRuntime().then(() => process.exit(0), error => { console.error(error.stack || error.message); process.exit(1); });
