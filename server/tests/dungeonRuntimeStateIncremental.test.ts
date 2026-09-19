"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const runtimeState = require("../src/services/dungeon/dungeonRuntimeState");
const dungeonRuntime = require("../src/services/dungeon/dungeonRuntime");
const dungeonAuthority = require("../src/services/dungeon/dungeonAuthority");

function buildInstance(instanceID, overrides: Record<string, any> = {}) {
  return {
    instanceID,
    templateID: `test-template:${instanceID}`,
    solarSystemID: 30_000_001,
    siteKey: `test-site:${instanceID}`,
    lifecycleState: "seeded",
    siteFamily: "combat",
    runtimeFlags: {
      universePersistent: true,
      universeSeeded: true,
    },
    timers: {
      createdAtMs: 1_000,
      expiresAtMs: 5_000,
    },
    ...overrides,
  };
}

test.beforeEach(() => {
  runtimeState.resetRuntimeStateForTests();
});

test("targeted instance changes keep runtime indexes coherent", () => {
  const created = runtimeState.applyInstanceChanges({
    upsertInstances: [buildInstance(1), buildInstance(2)],
    nextInstanceSequence: 3,
  });
  assert.equal(created.success, true);
  assert.equal(runtimeState.getNextInstanceSequence(), 3);
  assert.deepEqual(
    runtimeState.listInstanceSummariesBySystem(30_000_001).map((entry) => entry.instanceID),
    [1, 2],
  );
  assert.equal(runtimeState.findInstanceSummaryBySiteKey("test-site:1").instanceID, 1);
  assert.equal(runtimeState.getNextActiveExpiryAtMs(), 5_000);

  const moved = runtimeState.applyInstanceChanges({
    upsertInstances: [buildInstance(1, {
      solarSystemID: 30_000_002,
      lifecycleState: "completed",
      timers: {
        createdAtMs: 1_000,
        completedAtMs: 4_000,
        expiresAtMs: 0,
      },
    })],
  });
  assert.equal(moved.success, true);
  assert.deepEqual(
    runtimeState.listInstanceSummariesBySystem(30_000_001).map((entry) => entry.instanceID),
    [2],
  );
  assert.deepEqual(
    runtimeState.listInstanceSummariesBySystem(30_000_002).map((entry) => entry.instanceID),
    [1],
  );
  assert.deepEqual(runtimeState.listUniversePersistentTerminalInstanceIDs(), [1]);

  const removed = runtimeState.applyInstanceChanges({ removeInstanceIDs: [1] });
  assert.equal(removed.success, true);
  assert.equal(runtimeState.getInstanceSnapshot(1), null);
  assert.equal(runtimeState.findInstanceSummaryBySiteKey("test-site:1"), null);
  assert.deepEqual(runtimeState.listUniversePersistentTerminalInstanceIDs(), []);
});

test("universe reconciliation does not fall back to a whole-state mutation", () => {
  runtimeState.applyInstanceChanges({
    upsertInstances: [buildInstance(10, {
      siteOrigin: "generatedmining",
    })],
    nextInstanceSequence: 11,
  });

  const originalMutateState = runtimeState.mutateState;
  runtimeState.mutateState = () => {
    throw new Error("whole-state mutation should not run");
  };
  let summary;
  try {
    summary = dungeonRuntime.reconcileUniverseSeededInstances([], {
      systemIDs: [30_000_001],
      siteOriginFilter: ["generatedmining"],
      nowMs: 10_000,
    });
  } finally {
    runtimeState.mutateState = originalMutateState;
  }

  assert.equal(summary.removedCount, 1);
  assert.equal(runtimeState.getInstanceSnapshot(10), null);
});

test("universe reconciliation keeps an active persistent site's position and contents stable", () => {
  runtimeState.applyInstanceChanges({
    upsertInstances: [buildInstance(15, {
      templateID: "existing-template",
      siteKey: "scene-anomaly:30000001:5380000001001",
      lifecycleState: "active",
      position: { x: 10, y: 20, z: 30 },
      spawnState: {
        contentEntityRefsByKey: {
          "environment:test": { itemID: 6_400_000_000_015 },
        },
      },
      metadata: {
        definitionHash: "existing-definition",
      },
    })],
    nextInstanceSequence: 16,
  });

  const originalGetTemplateByID = dungeonAuthority.getTemplateByID;
  dungeonAuthority.getTemplateByID = (templateID) => ({
    templateID,
    siteFamily: "combat",
    siteKind: "anomaly",
    siteOrigin: "universe_dungeon",
  });
  let summary;
  try {
    summary = dungeonRuntime.reconcileUniverseSeededInstances([{
      templateID: "replacement-template",
      solarSystemID: 30_000_001,
      siteKey: "scene-anomaly:30000001:5380000001001",
      lifecycleState: "active",
      siteFamily: "combat",
      siteKind: "anomaly",
      siteOrigin: "universe_dungeon",
      position: { x: 900, y: 800, z: 700 },
      runtimeFlags: {
        universePersistent: true,
        universeSeeded: true,
      },
      metadata: {
        definitionHash: "replacement-definition",
      },
    }], {
      systemIDs: [30_000_001],
      nowMs: 10_000,
    });
  } finally {
    dungeonAuthority.getTemplateByID = originalGetTemplateByID;
  }

  assert.equal(summary.createdCount, 0);
  assert.equal(summary.retainedCount, 1);
  assert.equal(summary.replacedCount, 0);
  const retained = runtimeState.getInstanceSnapshot(15);
  assert.equal(retained.templateID, "existing-template");
  assert.deepEqual(retained.position, { x: 10, y: 20, z: 30 });
  assert.equal(retained.metadata.definitionHash, "existing-definition");
  assert.equal(
    retained.spawnState.contentEntityRefsByKey["environment:test"].itemID,
    6_400_000_000_015,
  );
});

test("universe reconciliation replaces a persistent template rejected by config authority", () => {
  const siteKey = "scene-anomaly:30000001:5380000001001";
  runtimeState.applyInstanceChanges({
    upsertInstances: [buildInstance(16, {
      templateID: "deleted-frontier-template",
      siteKey,
      lifecycleState: "active",
      position: { x: 10, y: 20, z: 30 },
    })],
    nextInstanceSequence: 17,
  });

  const originalGetTemplateByID = dungeonAuthority.getTemplateByID;
  dungeonAuthority.getTemplateByID = (templateID) => ({
    templateID,
    siteFamily: "combat",
    siteKind: "anomaly",
    siteOrigin: "universe_dungeon",
  });
  let summary;
  try {
    summary = dungeonRuntime.reconcileUniverseSeededInstances([{
      templateID: "configured-frontier-template",
      solarSystemID: 30_000_001,
      siteKey,
      lifecycleState: "active",
      siteFamily: "combat",
      siteKind: "anomaly",
      siteOrigin: "universe_dungeon",
      position: { x: 900, y: 800, z: 700 },
      runtimeFlags: {
        universePersistent: true,
        universeSeeded: true,
      },
      metadata: {
        definitionHash: "configured-definition",
        replaceUniverseTemplateID: "deleted-frontier-template",
      },
    }], {
      systemIDs: [30_000_001],
      nowMs: 10_000,
    });
  } finally {
    dungeonAuthority.getTemplateByID = originalGetTemplateByID;
  }

  assert.equal(summary.createdCount, 1);
  assert.equal(summary.replacedCount, 1);
  assert.equal(runtimeState.getInstanceSnapshot(16), null);
  const replacement = runtimeState.findInstanceSummaryBySiteKey(siteKey);
  assert.equal(replacement.templateID, "configured-frontier-template");
  assert.deepEqual(replacement.position, { x: 900, y: 800, z: 700 });
});

test("universe reconciliation removes shadow instances and retains the oldest active site authority", () => {
  const siteKey = "scene-anomaly:30000001:5380000001001";
  runtimeState.applyInstanceChanges({
    upsertInstances: [
      buildInstance(20, {
        templateID: "existing-template",
        siteKey,
        lifecycleState: "active",
        position: { x: 10, y: 20, z: 30 },
      }),
      buildInstance(21, {
        templateID: "existing-template",
        siteKey,
        lifecycleState: "active",
        position: { x: 40, y: 50, z: 60 },
      }),
    ],
    nextInstanceSequence: 22,
  });

  assert.equal(runtimeState.findInstanceSummaryBySiteKey(siteKey).instanceID, 20);

  const originalGetTemplateByID = dungeonAuthority.getTemplateByID;
  dungeonAuthority.getTemplateByID = (templateID) => ({
    templateID,
    siteFamily: "combat",
    siteKind: "anomaly",
    siteOrigin: "universe_dungeon",
  });
  let summary;
  try {
    summary = dungeonRuntime.reconcileUniverseSeededInstances([{
      templateID: "replacement-template",
      solarSystemID: 30_000_001,
      siteKey,
      lifecycleState: "active",
      siteFamily: "combat",
      siteKind: "anomaly",
      siteOrigin: "universe_dungeon",
      position: { x: 900, y: 800, z: 700 },
      runtimeFlags: {
        universePersistent: true,
        universeSeeded: true,
      },
      metadata: {
        definitionHash: "replacement-definition",
      },
    }], {
      systemIDs: [30_000_001],
      nowMs: 10_000,
    });
  } finally {
    dungeonAuthority.getTemplateByID = originalGetTemplateByID;
  }

  assert.equal(summary.createdCount, 0);
  assert.equal(summary.retainedCount, 1);
  assert.equal(summary.removedCount, 1);
  assert.deepEqual(runtimeState.getInstanceSnapshot(20).position, { x: 10, y: 20, z: 30 });
  assert.equal(runtimeState.getInstanceSnapshot(21), null);
});

test("universe reconciliation creates only one instance for duplicate desired site keys", () => {
  const siteKey = "scene-anomaly:30000001:5380000001001";
  const originalGetTemplateByID = dungeonAuthority.getTemplateByID;
  dungeonAuthority.getTemplateByID = (templateID) => ({
    templateID,
    siteFamily: "combat",
    siteKind: "anomaly",
    siteOrigin: "universe_dungeon",
  });
  let summary;
  try {
    summary = dungeonRuntime.reconcileUniverseSeededInstances([
      {
        templateID: "first-template",
        solarSystemID: 30_000_001,
        siteKey,
        position: { x: 10, y: 20, z: 30 },
        runtimeFlags: { universePersistent: true, universeSeeded: true },
      },
      {
        templateID: "shadow-template",
        solarSystemID: 30_000_001,
        siteKey,
        position: { x: 900, y: 800, z: 700 },
        runtimeFlags: { universePersistent: true, universeSeeded: true },
      },
    ], {
      systemIDs: [30_000_001],
      nowMs: 20_000,
    });
  } finally {
    dungeonAuthority.getTemplateByID = originalGetTemplateByID;
  }

  assert.equal(summary.desiredCount, 1);
  assert.equal(summary.createdCount, 1);
  const active = runtimeState.listInstanceSummariesBySystem(30_000_001, {
    activeOnly: true,
  });
  assert.equal(active.length, 1);
  const created = runtimeState.getInstanceSnapshot(active[0].instanceID);
  assert.equal(created.templateID, "first-template");
  assert.deepEqual(created.position, { x: 10, y: 20, z: 30 });
});

test("runtime expiry ticks update only expired instances", () => {
  runtimeState.applyInstanceChanges({
    upsertInstances: [buildInstance(20)],
    nextInstanceSequence: 21,
  });

  const originalMutateState = runtimeState.mutateState;
  runtimeState.mutateState = () => {
    throw new Error("whole-state mutation should not run");
  };
  let summary;
  try {
    summary = dungeonRuntime.tickRuntime({ nowMs: 10_000 });
  } finally {
    runtimeState.mutateState = originalMutateState;
  }

  assert.equal(summary.expiredCount, 1);
  assert.equal(runtimeState.getInstanceSnapshot(20).lifecycleState, "despawned");
});
