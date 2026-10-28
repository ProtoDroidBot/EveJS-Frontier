"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const selectedWorldPath = process.env.FRONTIER_TEMPORARY_TEST_WORLD;
const selectedProfilePath = process.env.FRONTIER_TEMPORARY_TEST_PROFILE;
const decodedPath = process.env.FRONTIER_TEMPORARY_TEST_DECODED;

test("decoded target content binds the complete selected galaxy and preserves every native site position", {
  skip: !selectedWorldPath || !selectedProfilePath || !decodedPath ? "Full decoded client and selected-world artifacts are required" : false,
}, t => {
  const started = Date.now();
  const config = require("../src/config");
  const prior = { clientBuild: config.clientBuild, temporaryLandscapePath: config.temporaryLandscapePath, voxelMiningEnabled: config.voxelMiningEnabled };
  const oldEnv = { world: process.env.EVEJS_EXPLORATION_WORLD_PATH, profile: process.env.EVEJS_TEMPORARY_LANDSCAPE_PATH };
  config.clientBuild = 3640684;
  config.voxelMiningEnabled = true;
  process.env.EVEJS_EXPLORATION_WORLD_PATH = selectedWorldPath;
  process.env.EVEJS_TEMPORARY_LANDSCAPE_PATH = selectedProfilePath;
  t.after(() => {
    Object.assign(config, prior);
    for (const [key, value] of [["EVEJS_EXPLORATION_WORLD_PATH", oldEnv.world], ["EVEJS_TEMPORARY_LANDSCAPE_PATH", oldEnv.profile]]) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  });
  const profiles = require("../src/services/frontier/temporaryLandscapeProfile");
  const profile = profiles.getTemporaryLandscapeProfile();
  const world = require("../src/services/frontier/explorationWorld").getConfiguredExplorationWorld();
  assert.equal(profiles.validateTemporaryLandscapeWorld(profile, world), true);
  assert.equal(world.systems.size, 24026);
  assert.equal(profile.systems.size, 23846);
  assert.equal(profile.sites.size, 136443);
  assert.equal(profile.ecosystems.size, 35);
  assert.equal(profile.dungeons.size, 393);
  assert.equal(world.baseRevision, "2891c2ce747671b3e43dd20f886f4b8227bd19b9e8ac33c2112892c6b699c810");
  assert.notEqual(world.revision, world.baseRevision);
  assert.equal(world.temporaryLandscape.revision, profile.revision);

  let siteCount = 0;
  for (const line of fs.readFileSync(path.join(decodedPath, "landscape.jsonl"), "utf8").split("\n")) {
    if (!line) continue;
    const system = JSON.parse(line);
    assert.ok(world.systems.has(system._key));
    for (const feature of [...Object.values<any>(system.asteroidBelts || {}), ...Object.values<any>(system.trojans || {})]) {
      for (const [id, site] of Object.entries<any>(feature.sites || {})) {
        const mapped = profile.sites.get(Number(id));
        assert.ok(mapped, `native site ${id} retained`);
        assert.equal(mapped.solarSystemID, system._key);
        assert.equal(mapped.ecosystemID, site.ecosystemID);
        assert.deepEqual(mapped.position, { x: site.position[0], y: site.position[1], z: site.position[2] });
        siteCount++;
      }
    }
  }
  assert.equal(siteCount, profile.sites.size);
  const worldData = require("../src/space/worldData");
  const maps = worldData.ensureLoaded();
  const enabledSites = [...profile.sites.values()].filter(site => {
    const enabled = profile.ecosystems.get(site.ecosystemID).spawnEnabled;
    return enabled !== false && enabled !== 0;
  });
  assert.equal(maps.landscapeSites.length, enabledSites.length);
  assert.equal(maps.asteroidBelts.length, 0, "map rings must not create unrelated legacy ore fields");
  assert.equal(maps.landscapeEcosystems.length, 35);
  assert.equal(maps.frontierDungeonTemplates.length, 393);
  assert.equal(require("../src/space/asteroids/asteroidData").ensureLoaded().belts.length, 0);
  const sampledSystems = [...new Set(enabledSites.slice(0, 100).map(site => site.solarSystemID))].slice(0, 5);
  for (const id of sampledSystems) {
    const sceneRows = worldData.getStaticSceneForSystem(id);
    for (const site of enabledSites.filter(site => site.solarSystemID === id)) {
      const sceneRow = sceneRows.find(row => row.itemID === site.itemID);
      assert.ok(sceneRow, `native site ${site.itemID} reaches static scene input`);
      assert.deepEqual(sceneRow.position, site.position);
      assert.equal(sceneRow.temporaryLandscapeRevision, profile.revision);
    }
  }
  const voxelRevision = require("../src/services/mining/voxelMiningWorld").getVoxelMiningWorldRevision(config);
  assert.ok(voxelRevision.includes(`/temporary-landscape/${profile.revision}/policy/`));

  const { buildLandscapeScenePlan } = require("../src/space/frontierLandscapeScenePlan");
  const resourcePolicy = require("../src/services/frontier/temporaryLandscapeResources");
  const npcPolicy = require("../src/services/frontier/temporaryLandscapeNpcs");
  const miningCatalog = require("../src/space/compositeMiningScene");
  const { TEMPORARY_LANDSCAPE_POLICY_REVISION } = require("../src/services/frontier/temporaryLandscapePolicyVersion");
  const siteByEcosystem = new Map<number, any>();
  for (const site of profile.sites.values()) if (!siteByEcosystem.has(site.ecosystemID)) siteByEcosystem.set(site.ecosystemID, site);
  const policyCoverage = { activeEcosystems: 0, resourceEcosystems: 0, resources: 0, npcs: 0, triggers: 0, wildPatternVerified: false };
  let samplePolicy: any = null, sampleSite: any = null;
  const buildPlan = site => buildLandscapeScenePlan({ ...site, temporaryLandscapeRevision: profile.revision },
    profile.ecosystems.get(site.ecosystemID), id => profile.dungeons.get(id), { resolveType: id => profile.types.get(id) });
  for (const ecosystem of profile.ecosystems.values()) {
    const site = siteByEcosystem.get(ecosystem.ecosystemID);
    if (!site) continue;
    const plan = buildPlan(site), policy = plan.temporaryPolicy;
    assert.ok(policy, `ecosystem ${ecosystem.ecosystemID} has an allocation policy`);
    assert.deepEqual(buildPlan(site), plan, `ecosystem ${ecosystem.ecosystemID} is deterministic`);
    assert.equal(policy.revision, TEMPORARY_LANDSCAPE_POLICY_REVISION);
    const resourceDiagnostics = policy.diagnostics.find(entry => entry.stockSource);
    assert.ok(resourceDiagnostics);
    assert.deepEqual(resourceDiagnostics.skipped, [], "all source carrier/yield metadata resolves");
    if (ecosystem.spawnEnabled === false || ecosystem.spawnEnabled === 0) {
      assert.equal(policy.resources.length, 0); assert.equal(policy.npcs.length, 0);
      assert.equal(policy.triggers.length, 0);
    } else {
      policyCoverage.activeEcosystems++;
      const cap = resourcePolicy.getTemporaryLocatorLimits(resourcePolicy.getTemporaryLandscapeTags(site, ecosystem),
        plan.locators.filter(locator => locator.typeID === 91211).length);
      assert.ok(policy.resources.length <= cap.resource);
      const stock = policy.resources.reduce((sum, entry) => sum + entry.resourceQuantity, 0);
      assert.ok(Number.isSafeInteger(stock) && stock >= 0 && stock <= 24000);
      if (policy.resources.length) {
        assert.equal(stock, 24000);
        policyCoverage.resourceEcosystems++;
        if (!samplePolicy) { samplePolicy = policy; sampleSite = { ...site, temporaryLandscapeRevision: profile.revision }; }
      }
      for (const entry of policy.resources) {
        assert.ok(profile.types.has(entry.typeID));
        assert.equal(profile.types.get(entry.typeID).dogma.dogmaAttributes.find(attribute => attribute.attributeID === 6070).value, entry.miningYieldTypeID);
        assert.ok(profile.types.has(entry.miningYieldTypeID) || miningCatalog.resolveTargetType(entry.miningYieldTypeID));
        assert.ok([entry.radius, entry.resourceQuantity, ...Object.values<any>(entry.positionOffset)].every(Number.isFinite));
      }
      for (const entry of policy.npcs) assert.ok(npcPolicy.isTemporaryLandscapeNpcType(profile.types.get(entry.typeID)));
      assert.ok(!policy.diagnostics.some(entry => entry.kind === "unresolved-native-npc-group"));
      const allocatedKeys = new Set([...policy.resources, ...policy.npcs].map(entry => entry.key));
      for (const trigger of policy.triggers) {
        assert.ok(trigger.targets.every(key => allocatedKeys.has(key)));
        assert.ok((trigger.sourceKeys || []).every(key => allocatedKeys.has(key)));
      }
      policyCoverage.resources += policy.resources.length; policyCoverage.npcs += policy.npcs.length; policyCoverage.triggers += policy.triggers.length;
    }
    if (ecosystem.ecosystemID === 30) {
      assert.ok(plan.selectedPatterns.some(pattern => pattern.patternKind === "wild" && pattern.dungeonID === 14283));
      policyCoverage.wildPatternVerified = true;
    }
  }
  assert.ok(policyCoverage.activeEcosystems > 0 && policyCoverage.resourceEcosystems > 0);
  if (!siteByEcosystem.has(30)) {
    // Disabled/manual-only ecosystem 30 has no placed sites in this landscape.
    // Exercise its native wild pattern with an explicit planning fixture.
    const fixture = { ...profile.sites.values().next().value, ecosystemID: 30 };
    const plan = buildPlan(fixture);
    assert.ok(plan.selectedPatterns.some(pattern => pattern.patternKind === "wild" && pattern.dungeonID === 14283));
    assert.equal(plan.temporaryPolicy.resources.length, 0);
    assert.equal(plan.temporaryPolicy.npcs.length, 0);
    policyCoverage.wildPatternVerified = true;
  }
  assert.equal(policyCoverage.wildPatternVerified, true);

  // In addition to the generated locator allocations above, real authored
  // carriers elsewhere in the imported dungeon catalog must still reach the
  // voxel preparation path with their verified target yield identities.
  let nativeOreCarriers = 0;
  for (const dungeon of profile.dungeons.values()) for (const room of dungeon.rooms) {
    nativeOreCarriers += room.objects.filter(object => object.typeID >= 91374 && object.typeID <= 91381).length;
  }
  assert.equal(nativeOreCarriers, 84);
  const dungeonService = require("../src/services/dungeon/dungeonUniverseSiteService");
  const authoredDungeon = profile.dungeons.get(9809);
  const hints = dungeonService._testing.buildFrontierDungeonDerivedPopulationHints(authoredDungeon);
  assert.ok(hints?.temporaryLandscapeProfile);
  const oreHint = hints.environmentProps.find(prop => prop.typeID === 91379 && prop.frontierDungeonResource);
  assert.ok(oreHint, "native Ember carrier survives dungeon population derivation");
  const resource = dungeonService.buildEnvironmentEntities({ instanceID: 9809 },
    { itemID: 998009, position: { x: 0, y: 0, z: 0 } }, authoredDungeon,
    { ...hints, environmentProps: [oreHint] })[0];
  assert.equal(resource.frontierDungeonResource, true);
  const nativeYieldTypeID = profile.types.get(91379).dogma.dogmaAttributes.find(attribute => attribute.attributeID === 6070).value;
  assert.equal(nativeYieldTypeID, 78447);
  assert.equal(resource.miningYieldTypeID, nativeYieldTypeID, "existing carrier identity agrees with target native dogma");
  const scene: any = { systemID: 30000001, staticEntities: [resource],
    staticEntitiesByID: new Map([[resource.itemID, resource]]), dynamicEntities: new Map(),
    getEntityByID(id) { return this.staticEntitiesByID.get(Number(id)) || null; },
    getCurrentSimTimeMs: () => Date.now(),
  };
  const miningState = require("../src/services/mining/miningRuntimeState");
  miningState.ensureSceneMiningState(scene);
  assert.equal(resource.typeID, 95899);
  assert.equal(resource.compositeAsteroid, true);
  assert.equal(miningState.getMineableState(scene, resource.itemID).yieldTypeID, 78447);

  // Materialize a real locator allocation through the production adapter and
  // mining registration, with only the lightweight scene container substituted.
  const allocatedScene: any = { systemID: sampleSite.solarSystemID, staticEntities: [],
    staticEntitiesByID: new Map(), dynamicEntities: new Map(),
    getEntityByID(id) { return this.staticEntitiesByID.get(Number(id)) || null; },
    getCurrentSimTimeMs: () => Date.now(),
    addStaticEntity(entity) { if (this.staticEntitiesByID.has(entity.itemID)) return false;
      this.staticEntities.push(entity); this.staticEntitiesByID.set(entity.itemID, entity); return true; },
    removeStaticEntity(id) { this.staticEntities = this.staticEntities.filter(entity => entity.itemID !== id);
      return { success: this.staticEntitiesByID.delete(id) }; },
  };
  miningState.ensureSceneMiningState(allocatedScene);
  const lifecycle = require("../src/space/temporaryLandscapeRuntime").createTemporaryLandscapeRuntime();
  const selectedResource = samplePolicy.resources[0];
  const attached = require("../src/space/frontierLandscapeSceneService")._testing.attachTemporaryLandscapePolicy(
    allocatedScene, sampleSite, { temporaryPolicy: { ...samplePolicy, resources: [selectedResource], npcs: [], triggers: [] } },
    { dungeonService, miningRuntimeState: miningState }, { temporaryPolicyRuntime: lifecycle });
  assert.equal(attached.success, true, JSON.stringify(attached));
  const allocated = allocatedScene.staticEntities[0];
  assert.equal(allocated.compositeAsteroid, true);
  assert.equal(allocated.typeID, 95899);
  assert.equal(allocated.temporaryLandscapePolicyRevision, TEMPORARY_LANDSCAPE_POLICY_REVISION);
  assert.equal(allocated.miningYieldTypeID, selectedResource.miningYieldTypeID);
  assert.equal(miningState.getMineableState(allocatedScene, allocated.itemID).remainingQuantity, selectedResource.resourceQuantity);
  const database = require("../src/gameStore");
  t.after(() => { database._closeSqliteForTests(); database._shutdownPersistenceWorkerForTests(); });

  const result = { profileRevision: profile.revision, effectiveWorldRevision: world.revision, baseWorldRevision: world.baseRevision,
    galaxySystems: world.systems.size, mappedSystems: profile.systems.size, nativeSites: siteCount, activeSceneSites: maps.landscapeSites.length,
    ecosystems: profile.ecosystems.size, dungeons: profile.dungeons.size, nativeOreCarriers, verifiedVoxelCarrier: oreHint.typeID,
    policyRevision: TEMPORARY_LANDSCAPE_POLICY_REVISION, policyCoverage,
    verifiedAllocatedVoxelCarrier: selectedResource.typeID,
    explorationBelts: profile.raw.mappingReport.counts.explorationBelts,
    explorationTrojans: profile.raw.mappingReport.counts.explorationTrojans,
    totalMs: Date.now() - started, maxRSSKiB: process.resourceUsage().maxRSS, passed: true };
  if (process.env.FRONTIER_TEMPORARY_TEST_REPORT) fs.writeFileSync(process.env.FRONTIER_TEMPORARY_TEST_REPORT, JSON.stringify(result, null, 2) + "\n");
  console.log(JSON.stringify(result));
});
