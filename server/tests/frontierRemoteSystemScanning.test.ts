import assert from "node:assert/strict";
import test from "node:test";

const { createRemoteSystemScanRuntime } = require("../src/services/frontier/remoteSystemScanRuntime");
const { createSystemSignatureEventRuntime } = require("../src/services/frontier/systemSignatureEventRuntime");
const { createSystemScanIndex } = require("../src/services/frontier/systemScanIndex");

function memoryRepository(initial: any = {}) {
  let value = structuredClone(initial);
  return {
    ensureTable() {},
    read() { return { success: true, data: structuredClone(value) }; },
    write(_table: string, _path: string, next: any) {
      value = structuredClone(next);
      return { success: true, data: structuredClone(value) };
    },
    snapshot() { return structuredClone(value); },
  };
}

function fixture(overrides: Record<string, any> = {}) {
  let clock = 1_000_000;
  let uuidSequence = 1;
  let warmCount = 0;
  const repository = memoryRepository();
  const systems = new Map([
    [1, { name: "Origin" }],
    [2, { name: "Near" }],
    [3, { name: "Far" }],
    [4, { name: "Unreachable" }],
  ]);
  const gates = new Map([
    [1, [{ destinationSolarSystemID: 2 }]],
    [2, [{ destinationSolarSystemID: 1 }, { destinationSolarSystemID: 3 }]],
    [3, [{ destinationSolarSystemID: 2 }]],
  ]);
  const worldData = {
    getSolarSystemByID(id: number) { return systems.get(Number(id)) || null; },
    getStargatesForSystem(id: number) { return gates.get(Number(id)) || []; },
  };
  const contributions = [
    { contributorKey: "ship:player-secret-77", sourceDomain: "inventory", systemID: 2,
      position: { x: 100, y: 0, z: 0 }, kind: "ship", baseSignature: 8,
      channelMultiplier: { gravimetric: 1, electromagnetic: 1, thermal: 1 }, observedAtMs: clock },
    { contributorKey: "ship:npc-secret-88", sourceDomain: "npc", systemID: 2,
      position: { x: 120, y: 0, z: 0 }, kind: "ship", baseSignature: 8,
      channelMultiplier: { gravimetric: 1, electromagnetic: 1, thermal: 1 }, observedAtMs: clock },
    { contributorKey: "base:owner-secret-99", sourceDomain: "structure", systemID: 2,
      position: { x: 1000, y: 0, z: 0 }, kind: "base", baseSignature: 35,
      channelMultiplier: { gravimetric: 4, electromagnetic: 1.5, thermal: 1.2 }, observedAtMs: clock },
    { contributorKey: "dungeon:hidden-id", sourceDomain: "dungeon", systemID: 2,
      position: { x: 5000, y: 0, z: 0 }, kind: "dungeon", baseSignature: 12,
      channelMultiplier: { gravimetric: 1.4, electromagnetic: 1, thermal: 0.7 }, observedAtMs: clock,
      siteMetadata: { family: "combat", siteKind: "anomaly", displayType: "Ruined Relay" } },
    { contributorKey: "resource:hidden-id", sourceDomain: "mining", systemID: 2,
      position: { x: 5200, y: 0, z: 0 }, kind: "resource_field", baseSignature: 20,
      channelMultiplier: { gravimetric: 2, electromagnetic: 1, thermal: 0.3 }, observedAtMs: clock,
      resourceSummary: { family: "ore", potentialTypeIDs: [10], remainingTypeIDs: [10],
        originalQuantityBand: "high", remainingQuantityBand: "medium",
        originalMemberCountBand: "10-24", activeMemberCountBand: "5-9", depleted: false } },
  ];
  const scanIndex = {
    getSystemScanSnapshot(systemID: number) {
      return { success: true, data: { systemID, builtAtMs: clock, revision: 42,
        revisions: { dungeon: 1, mining: 2, inventory: 3, npc: 4, structure: 5, transient: 0 },
        contributions: structuredClone(contributions) } };
    },
  };
  const config = {
    frontierRemoteScanningEnabled: true,
    frontierNetworkNodeScanRangeJumps: 2,
    frontierRemoteScanCooldownMs: 0,
    frontierRemoteScanSurveyEnergyCost: 25,
    frontierRemoteScanDeepEnergyCost: 75,
    frontierRemoteScanIndexTtlMs: 0,
    frontierRemoteScanResultTtlMs: 60_000,
    frontierRemoteScanMaxHeatCells: 4,
    frontierRemoteScanMaxSites: 4,
    frontierRemoteScanMaxResources: 4,
    frontierRemoteScanMaxPayloadBytes: 524_288,
    frontierRemoteScanSurveyOctreeDepth: 4,
    frontierRemoteScanDeepOctreeDepth: 6,
    frontierRemoteScanDeepWarmupEnabled: true,
    frontierRemoteScanDeepWarmupTimeoutMs: 2_000,
  };
  const runtime = createRemoteSystemScanRuntime({
    now: () => clock,
    randomUUID: () => `00000000-0000-4000-8000-${String(uuidSequence++).padStart(12, "0")}`,
    repository,
    worldData,
    scanIndex,
    signatureEvents: { recordSignatureBloomDetected() { return { success: true }; } },
    config,
    resolveSource: () => ({ success: true, data: { scannerSourceID: 50,
      scannerSourceClass: "network_node", scannerProfileID: "test-profile", sourceSystemID: 1,
      energyAvailable: 1000, scannerStrength: { gravimetric: 1, electromagnetic: 1, thermal: 1 } } }),
    warmSystem: async () => { warmCount += 1; return { systemID: 2, entities: new Map(), staticEntities: [] }; },
    ...overrides,
  });
  return { runtime, config, repository, contributions,
    advance(ms: number) { clock += ms; }, get warmCount() { return warmCount; } };
}

test("Network Node scan configuration exposes a selectable stargate-hop range", () => {
  const { runtime } = fixture();
  const result = runtime.getNetworkNodeScanConfiguration(7, 50, { characterID: 7 }, 1);
  assert.equal(result.success, true);
  assert.equal(result.data.rangeUnit, "stargate_hops");
  assert.equal(result.data.maxRangeJumps, 2);
  assert.equal(result.data.selectedRangeJumps, 1);
  assert.deepEqual(result.data.reachableSystems.map((row: any) => [row.systemID, row.hops]), [[1, 0], [2, 1]]);
  assert.deepEqual(result.data.entityClasses, ["ships", "bases", "transient_travel"]);
  assert.equal(result.data.actorClassification, "redacted");
});

test("cold surveys are durable, idempotent, bounded, and actor-blind", async () => {
  const subject = fixture();
  const request = { operationKey: "ui:scan:1", targetSystemID: 2, mode: "survey",
    rangeJumps: 1, layers: ["sites", "resources", "entities"] };
  const started = subject.runtime.startRemoteSystemScan(7, 50, request, { characterID: 7 });
  assert.equal(started.success, true);
  assert.equal(started.created, true);
  await subject.runtime.executeScan(started.data.scanID);
  const duplicate = subject.runtime.startRemoteSystemScan(7, 50, request, { characterID: 7 });
  assert.equal(duplicate.success, true);
  assert.equal(duplicate.created, false);
  assert.equal(duplicate.data.scanID, started.data.scanID);
  const result = subject.runtime.getRemoteSystemScanResult(7, 50, started.data.scanID, { characterID: 7 });
  assert.equal(result.success, true);
  assert.equal(result.data.warmedByScan, false);
  assert.ok(result.data.heatMapCells.length <= 4);
  assert.equal(result.data.heatMapCells.reduce((sum: number, cell: any) =>
    sum + (cell.entities.ships === "2-4" ? 2 : 0), 0), 2);
  assert.deepEqual(result.data.entityClasses, ["ships", "bases", "transient_travel"]);
  const serialized = JSON.stringify(result.data);
  for (const secret of ["player-secret", "npc-secret", "owner-secret", "hidden-id"]) {
    assert.equal(serialized.includes(secret), false);
  }
  assert.equal(/playerShips|npcShips|playerBases|npcBases/.test(serialized), false);
  assert.equal(subject.warmCount, 0, "a cold survey must not warm or create a scene");
});

test("range validation rejects unreachable systems before creating a job", () => {
  const { runtime, repository } = fixture();
  const outOfRange = runtime.startRemoteSystemScan(7, 50, {
    operationKey: "ui:scan:far", targetSystemID: 3, mode: "survey", rangeJumps: 1,
  }, { characterID: 7 });
  assert.equal(outOfRange.errorMsg, "REMOTE_SCAN_OUT_OF_RANGE");
  const unreachable = runtime.startRemoteSystemScan(7, 50, {
    operationKey: "ui:scan:none", targetSystemID: 4, mode: "survey", rangeJumps: 2,
  }, { characterID: 7 });
  assert.equal(unreachable.errorMsg, "REMOTE_SCAN_OUT_OF_RANGE");
  assert.deepEqual(repository.snapshot().jobs || {}, {});
});

test("payload load shedding removes weakest aggregate rows within the configured byte cap", async () => {
  const subject = fixture();
  subject.config.frontierRemoteScanMaxHeatCells = 256;
  subject.config.frontierRemoteScanMaxPayloadBytes = 4_096;
  subject.config.frontierRemoteScanSurveyOctreeDepth = 8;
  for (let index = 0; index < 300; index += 1) {
    subject.contributions.push({
      contributorKey: `ship:bulk-${index}`,
      sourceDomain: index % 2 ? "inventory" : "npc",
      systemID: 2,
      position: { x: index * 100_000_000, y: (index % 7) * 100_000_000, z: 0 },
      kind: "ship",
      baseSignature: 1,
      channelMultiplier: { gravimetric: 1, electromagnetic: 1, thermal: 1 },
      observedAtMs: 1_000_000,
    });
  }
  const started = subject.runtime.startRemoteSystemScan(7, 50, {
    operationKey: "payload:bounded", targetSystemID: 2, mode: "survey", rangeJumps: 1,
  }, { characterID: 7 });
  await subject.runtime.executeScan(started.data.scanID);
  const result = subject.runtime.getRemoteSystemScanResult(7, 50, started.data.scanID, { characterID: 7 });
  assert.equal(result.success, true);
  assert.ok(Buffer.byteLength(JSON.stringify(result.data), "utf8") <= 4_096);
  assert.equal(result.data.truncated, true);
  assert.ok(result.data.truncatedLayers.includes("entities"));
});

test("concurrent deep scans share target warm-up and report world revisions", async () => {
  let release: (() => void) | null = null;
  let warmCount = 0;
  const warmPromise = new Promise((resolve) => { release = () => resolve({ systemID: 2, entities: new Map() }); });
  const subject = fixture({ warmSystem: () => { warmCount += 1; return warmPromise; } });
  const first = subject.runtime.startRemoteSystemScan(7, 50, {
    operationKey: "deep:1", targetSystemID: 2, mode: "deep", rangeJumps: 1,
  }, { characterID: 7 });
  const second = subject.runtime.startRemoteSystemScan(7, 50, {
    operationKey: "deep:2", targetSystemID: 2, mode: "deep", rangeJumps: 1,
  }, { characterID: 7 });
  const a = subject.runtime.executeScan(first.data.scanID);
  const b = subject.runtime.executeScan(second.data.scanID);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(warmCount, 1);
  release!();
  await Promise.all([a, b]);
  for (const scanID of [first.data.scanID, second.data.scanID]) {
    const result = subject.runtime.getRemoteSystemScanResult(7, 50, scanID, { characterID: 7 });
    assert.equal(result.success, true);
    assert.equal(result.data.warmedByScan, true);
    assert.equal(result.data.worldRevisionBefore, 42);
    assert.equal(result.data.worldRevisionAfter, 42);
  }
});

test("signature bloom events are idempotent, durable, and decay per channel", () => {
  let clock = 10_000;
  const repository = memoryRepository();
  const runtime = createSystemSignatureEventRuntime({
    now: () => clock,
    repository,
    config: {
      frontierSignatureBloomRetentionMs: 10_000,
      frontierSignatureBloomGravimetricHalfLifeMs: 1_000,
      frontierSignatureBloomElectromagneticHalfLifeMs: 2_000,
      frontierSignatureBloomThermalHalfLifeMs: 4_000,
    },
  });
  const event = { eventKey: "jump:committed:departure", systemID: 2, phase: "departure",
    travelMode: "random", occurredAtMs: clock, approximatePosition: { x: 1, y: 2, z: 3 },
    massKg: 1000, channelIntensity: { gravimetric: 8, electromagnetic: 8, thermal: 8 } };
  assert.equal(runtime.recordSystemSignatureBloom(event).created, true);
  assert.equal(runtime.recordSystemSignatureBloom(event).created, false);
  clock += 2_000;
  const active = runtime.listActiveSystemSignatureBlooms(2);
  assert.equal(active.length, 1);
  assert.equal(active[0].channelIntensity.gravimetric, 2);
  assert.equal(active[0].channelIntensity.electromagnetic, 4);
  assert.equal(Number(active[0].channelIntensity.thermal.toFixed(6)), Number((8 / Math.sqrt(2)).toFixed(6)));
  assert.equal(JSON.stringify(active).includes(event.eventKey), true, "event keys remain internal to the server API");
  assert.match(active[0].observationID, /^[0-9a-f]{24}$/);
  clock = active[0].expiresAtMs;
  assert.deepEqual(runtime.listActiveSystemSignatureBlooms(2), []);
  assert.ok(runtime.listSignals().some((signal: any) => signal.kind === "signature_bloom.expired"));
});

test("cold index aggregates resource fields and filters private dungeons without actor labels", () => {
  let dungeonReads = 0;
  const publicInstance = { instanceID: 1, templateID: "public", instanceScope: "public",
    ownership: { visibilityScope: "public" }, siteFamily: "ore", siteKind: "signature",
    position: { x: 10, y: 20, z: 30 }, spawnState: { resourceTypeIDs: [10],
      memberCount: 10_000, activeMemberCount: 8_000, totalOriginalQuantity: 2_000_000,
      totalRemainingQuantity: 1_000_000, members: [] } };
  const privateInstance = { instanceID: 2, templateID: "private", instanceScope: "private",
    ownership: { visibilityScope: "private", characterID: 999 }, siteFamily: "combat",
    siteKind: "anomaly", position: { x: 50, y: 60, z: 70 }, spawnState: {} };
  const index = createSystemScanIndex({
    now: () => 1000,
    config: { frontierRemoteScanIndexTtlMs: 60_000 },
    worldData: { getSolarSystemByID: (id: number) => id === 2 ? { name: "Near" } : null },
    dungeonRuntime: { listActiveInstancesBySystem() { dungeonReads += 1; return [publicInstance, privateInstance]; } },
    dungeonAuthority: { getTemplateByID(id: string) { return id === "public"
      ? { siteFamily: "ore", resourceComposition: { oreTypeIDs: [10] }, name: "Ore Expanse" }
      : { siteFamily: "combat", name: "Private Stronghold" }; } },
    dungeonVisibility: {
      isPrivateDungeonInstance: (entry: any) => entry.instanceScope === "private",
      canSessionAccessDungeonInstance: (session: any, entry: any) =>
        session && session.characterID === entry.ownership.characterID,
    },
    miningSites: { buildGeneratedResourceSiteDefinitionsForSystem: () => [{
      siteID: 55, rawSiteIndex: 0, family: "ice", position: { x: 100, y: 0, z: 0 },
      resourceTypeIDs: [20], memberCount: 10_000, activeMemberCount: 9_000,
      totalOriginalQuantity: 5_000_000, totalRemainingQuantity: 4_000_000,
      members: Array.from({ length: 10_000 }, () => ({ remainingQuantity: 1 })),
    }] },
    itemStore: {
      SHIP_CATEGORY_ID: 6,
      getItemMetadata: (typeID: number) => ({ typeID, categoryID: typeID === 1 ? 6 : 65 }),
      listSystemSpaceItems: () => [
        { itemID: 77, typeID: 1, categoryID: 6, spaceState: { position: { x: 1, y: 0, z: 0 } } },
        { itemID: 88, typeID: 2, categoryID: 65, spaceState: { position: { x: 2, y: 0, z: 0 } } },
      ],
    },
    structureState: { listStructuresForSystem: () => [{ structureID: 90, typeID: 3,
      position: { x: 3, y: 0, z: 0 } }] },
    npcStore: { listNativeEntitiesForSystem: () => [{ entityID: 91, typeID: 1,
      position: { x: 4, y: 0, z: 0 }, nativeNpc: true }] },
    scanningRuntime: {
      resolveBaseSignature: () => 1,
      resolveGravimetricSignatureMultiplier: () => 1,
    },
    signatureEvents: { listActiveSystemSignatureBlooms: () => [] },
    deploymentRuntime: { readConstructionState: (item: any) => item.itemID === 88
      ? { assemblyStatus: 2 } : null },
    scanInhibitorRuntime: { isPositionScanInhibited: (_systemID: number, position: any) =>
      Number(position && position.x) === 4 },
  });
  const hidden = index.getSystemScanSnapshot(2, { actorSession: { characterID: 7 } });
  assert.equal(hidden.success, true);
  assert.equal(hidden.data.contributions.some((row: any) =>
    row.siteMetadata && row.siteMetadata.displayType === "Private Stronghold"), false);
  assert.equal(hidden.data.contributions.filter((row: any) => row.kind === "resource_field").length, 2,
    "ten thousand generated members remain one field contribution");
  assert.equal(hidden.data.contributions.filter((row: any) => row.kind === "ship").length, 2);
  assert.equal(hidden.data.contributions.filter((row: any) => row.kind === "base").length, 2);
  assert.equal(hidden.data.contributions.find((row: any) => row.contributorKey === "ship:91").scanAttenuation, 0.1);
  assert.equal(JSON.stringify(hidden.data).includes("visibilityInstance"), false);
  const visible = index.getSystemScanSnapshot(2, { actorSession: { characterID: 999 } });
  assert.equal(visible.data.contributions.some((row: any) =>
    row.siteMetadata && row.siteMetadata.displayType === "Private Stronghold"), true);
  assert.equal(dungeonReads, 1, "visibility filtering reuses the cold authority snapshot");
});
