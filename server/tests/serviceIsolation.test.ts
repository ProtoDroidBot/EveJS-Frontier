const test = require("node:test");
const assert = require("node:assert/strict");

const config = require("../src/config");
const spaceRuntime = require("../src/space/runtime");
const worldPlanningPool = require("../src/space/worldPlanningPool");
const dungeonRuntime = require("../src/services/dungeon/dungeonRuntime");
const npcService = require("../src/space/npc");

test("skipping authored NPC startup still invokes recovery for sync and async scenes", async (t) => {
  const systemIDs = [39_999_993, 39_999_994];
  const previousAsteroidsEnabled = config.asteroidFieldsEnabled;
  const previousMiningEnabled = config.miningEnabled;
  const previousSkipNpcStartup = process.env.EVEJS_SKIP_NPC_STARTUP;
  const recoveredSystems: number[] = [];
  config.asteroidFieldsEnabled = false;
  config.miningEnabled = false;
  process.env.EVEJS_SKIP_NPC_STARTUP = "1";
  t.mock.method(npcService, "handleSceneCreated", (scene) => {
    recoveredSystems.push(scene.systemID);
    scene._npcStartupInitialized = true;
    return { success: true, data: { rehydrated: [], applied: [] } };
  });
  try {
    const synchronous = spaceRuntime.ensureScene(systemIDs[0], {
      reconcileUniverseSites: false,
      materializeUniverseSites: false,
      refreshStargates: false,
    });
    const asynchronous = await spaceRuntime.ensureSceneReady(systemIDs[1], {
      reconcileUniverseSites: false,
      materializeUniverseSites: false,
      refreshStargates: false,
    });
    assert.equal(synchronous._npcStartupInitialized, true);
    assert.equal(asynchronous._npcStartupInitialized, true);
    assert.deepEqual(recoveredSystems, systemIDs);
  } finally {
    for (const systemID of systemIDs) spaceRuntime.scenes.delete(systemID);
    config.asteroidFieldsEnabled = previousAsteroidsEnabled;
    config.miningEnabled = previousMiningEnabled;
    if (previousSkipNpcStartup === undefined) delete process.env.EVEJS_SKIP_NPC_STARTUP;
    else process.env.EVEJS_SKIP_NPC_STARTUP = previousSkipNpcStartup;
  }
});

test("cold scene bootstrap shares one worker plan and exposes only a ready scene", async () => {
  const systemID = 39_999_991;
  const previousAsteroidsEnabled = config.asteroidFieldsEnabled;
  const previousMiningEnabled = config.miningEnabled;
  const previousSkipNpcStartup = process.env.EVEJS_SKIP_NPC_STARTUP;
  config.asteroidFieldsEnabled = false;
  config.miningEnabled = false;
  process.env.EVEJS_SKIP_NPC_STARTUP = "1";
  spaceRuntime.scenes.delete(systemID);

  try {
    const first = spaceRuntime.ensureSceneReady(systemID, {
      materializeUniverseSites: false,
      reconcileUniverseSites: false,
    });
    const second = spaceRuntime.ensureSceneReady(systemID, {
      materializeUniverseSites: false,
      reconcileUniverseSites: false,
    });
    const [firstScene, secondScene] = await Promise.all([first, second]);
    assert.equal(firstScene, secondScene);
    assert.equal(firstScene._bootstrapReady, true);
    assert.equal(firstScene._asteroidFieldsInitialized, true);
    assert.equal(spaceRuntime.ensureScene(systemID), firstScene);
    assert.equal(worldPlanningPool.getPendingTaskCount(), 0);
    assert.equal(worldPlanningPool.getStats().maxPendingTasks, 128);
  } finally {
    spaceRuntime.scenes.delete(systemID);
    config.asteroidFieldsEnabled = previousAsteroidsEnabled;
    config.miningEnabled = previousMiningEnabled;
    if (previousSkipNpcStartup === undefined) {
      delete process.env.EVEJS_SKIP_NPC_STARTUP;
    } else {
      process.env.EVEJS_SKIP_NPC_STARTUP = previousSkipNpcStartup;
    }
  }
});

test("dungeon reconcile plans reject a changed authoritative snapshot", () => {
  const options = {
    systemIDs: [39_999_992],
    nowMs: 1_800_000_000_000,
  };
  const snapshot = dungeonRuntime.snapshotUniverseSeededReconcileState(options);
  const plan = dungeonRuntime.buildUniverseSeededReconcilePlan([], snapshot, options);
  plan.baseFingerprint = `${plan.baseFingerprint}:stale`;
  assert.throws(
    () => dungeonRuntime.applyUniverseSeededReconcilePlan(plan),
    (error) => error && error.code === "STALE_DUNGEON_RECONCILE_PLAN",
  );
});
