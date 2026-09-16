"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const spaceRuntime = require("../src/space/runtime");
const dungeonUniverseSiteService = require(
  "../src/services/dungeon/dungeonUniverseSiteService",
);

test("player entry materializes cached dungeons while reconciliation remains scheduled", () => {
  const originalHandleSceneCreated = dungeonUniverseSiteService.handleSceneCreated;
  const scene = { systemID: 30_000_142 };
  const calls: any[] = [];

  dungeonUniverseSiteService.handleSceneCreated = (receivedScene, options) => {
    calls.push({ scene: receivedScene, options });
    return {
      success: true,
      data: { spawned: [{ itemID: 1 }] },
    };
  };

  try {
    const result = spaceRuntime.materializePreparedUniverseSitesForPlayerEntry(
      scene,
      {
        success: true,
        prepared: false,
        scheduled: true,
        sceneExisted: true,
      },
    );

    assert.equal(calls.length, 1);
    assert.equal(calls[0].scene, scene);
    assert.equal(calls[0].options.force, true);
    assert.deepEqual(result, {
      success: true,
      data: { spawned: [{ itemID: 1 }] },
    });
  } finally {
    dungeonUniverseSiteService.handleSceneCreated = originalHandleSceneCreated;
  }
});

test("player entry does not materialize dungeons after preparation failure", () => {
  const originalHandleSceneCreated = dungeonUniverseSiteService.handleSceneCreated;
  let callCount = 0;
  dungeonUniverseSiteService.handleSceneCreated = () => {
    callCount += 1;
    return null;
  };

  try {
    const result = spaceRuntime.materializePreparedUniverseSitesForPlayerEntry(
      { systemID: 30_000_142 },
      { success: false, prepared: false },
    );
    assert.equal(result, null);
    assert.equal(callCount, 0);
  } finally {
    dungeonUniverseSiteService.handleSceneCreated = originalHandleSceneCreated;
  }
});
