"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const scanningRuntime = require(
  "../src/services/frontier/scanningRuntime",
);
const spaceRuntime = require("../src/space/runtime");

test("starting warp drops combat-revealed dungeon contacts from destination visibility", () => {
  const combatTargetID = 91_000_101;
  const ordinaryScanContactID = 91_000_102;
  const nowMs = 50_000;
  const session = {
    _space: {
      combatRevealedDynamicEntityIDs: new Set([combatTargetID]),
      combatRevealPresentationEntityIDs: new Set([combatTargetID]),
      combatRevealDestinyStampsByID: new Map([[combatTargetID, 123]]),
      [scanningRuntime.RESOLVED_SCANNING_CONTACTS_KEY]: new Map([
        [combatTargetID, {
          combatResolvedAtMs: nowMs - 1_000,
          detectedAtMs: nowMs - 1_000,
          lastScannedAtMs: nowMs - 1_000,
          resolveAtMs: nowMs - 1_000,
        }],
        [ordinaryScanContactID, {
          detectedAtMs: nowMs - 2_000,
          lastScannedAtMs: nowMs - 2_000,
          resolveAtMs: nowMs - 1_500,
        }],
      ]),
    },
  };
  const ship = {
    itemID: 92_000_101,
    session,
    position: { x: 0, y: 0, z: 0 },
  };
  const scene = Object.assign(
    Object.create(spaceRuntime._testing.SolarSystemScene.prototype),
    {
      canSessionSeeAirNpeScopedEntity: () => true,
      canSessionSeeDungeonScopedEntity: () => true,
      canSessionSeeEntityInPublicGrid: () => false,
      getCurrentSimTimeMs: () => nowMs,
      getShipEntityForSession: () => ship,
      getVisibilityPublicGridKeyForEntity: () => "source-grid",
      getVisibilityPublicGridClusterKeyForEntity: () => "source-cluster",
      getPublicGridClusterKeyForPosition: () => "destination-cluster",
      isNativeBallReplacementPendingForSession: () => false,
      isSessionInPilotWarpQuietWindow: () => false,
    },
  );
  const dungeonTarget = {
    itemID: combatTargetID,
    kind: "ship",
    position: { x: 0, y: 0, z: 500_000_000 },
  };

  assert.equal(
    scene.canSessionSeeDynamicEntity(session, dungeonTarget, nowMs),
    true,
    "combat reveal initially bypasses ordinary grid visibility",
  );

  const handoff = scene.beginPilotWarpVisibilityHandoff(
    ship,
    {
      destinationStaticInstanceID: null,
      rawDestination: { x: 2_000_000, y: 0, z: 0 },
      targetPoint: { x: 2_000_000, y: 0, z: 0 },
    },
    nowMs,
  );

  assert.ok(handoff);
  assert.deepEqual(
    [...session._space.combatRevealedDynamicEntityIDs],
    [],
  );
  assert.deepEqual(
    [...session._space.combatRevealPresentationEntityIDs],
    [],
  );
  assert.deepEqual(
    [...session._space.combatRevealDestinyStampsByID.keys()],
    [],
  );
  const resolvedContacts =
    session._space[scanningRuntime.RESOLVED_SCANNING_CONTACTS_KEY];
  assert.equal(resolvedContacts.has(combatTargetID), false);
  assert.equal(
    resolvedContacts.has(ordinaryScanContactID),
    true,
    "an independently scanned contact must not be discarded with combat reveal",
  );
  assert.equal(
    scene.canSessionSeeDynamicEntity(session, dungeonTarget, nowMs),
    false,
    "the departed target must return to ordinary destination-grid visibility",
  );
});
