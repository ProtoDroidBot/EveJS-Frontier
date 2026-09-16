"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  MAXIMUM_LARGE_ANCHOR_OFFSET_METERS,
  MINIMUM_LARGE_ANCHOR_OFFSET_METERS,
  orderUniverseDungeonAnchorCandidates,
} = require("../src/services/dungeon/dungeonSpawnEligibility");
const {
  buildAnchorRelativeSignaturePlacement,
} = require("../src/services/exploration/signatures/signaturePlacement");

test("ordinary dungeon placement usually selects a planet, moon, or star", () => {
  const anchors = orderUniverseDungeonAnchorCandidates({
    celestials: [
      { itemID: 10, groupID: 7, position: { x: 0, y: 0, z: 0 } },
      { itemID: 20, groupID: 8, position: { x: 0, y: 0, z: 0 } },
      { itemID: 30, groupID: 6, position: { x: 0, y: 0, z: 0 } },
      { itemID: 40, groupID: 4870, position: { x: 0, y: 0, z: 0 } },
    ],
    belts: [{ itemID: 50, position: { x: 0, y: 0, z: 0 } }],
    stations: [{ itemID: 60, anchorKind: "station", position: { x: 0, y: 0, z: 0 } }],
    stargates: [{ itemID: 70, anchorKind: "stargate", position: { x: 0, y: 0, z: 0 } }],
  }, "combat");
  const primaryAnchorIDs = new Set([10, 20, 30]);
  const selectedAnchorIDs = new Set();
  let primarySelections = 0;

  for (let index = 0; index < 10_000; index += 1) {
    const placement = buildAnchorRelativeSignaturePlacement(
      anchors,
      `weighted-dungeon-placement:${index}`,
    );
    selectedAnchorIDs.add(placement.anchorItemID);
    if (primaryAnchorIDs.has(placement.anchorItemID)) {
      primarySelections += 1;
    }
    if (placement.anchorItemID !== 50) {
      assert.ok(placement.distanceMeters >= MINIMUM_LARGE_ANCHOR_OFFSET_METERS);
      assert.ok(placement.distanceMeters <= MAXIMUM_LARGE_ANCHOR_OFFSET_METERS);
    }
  }

  assert.ok(primarySelections / 10_000 > 0.7);
  assert.ok(selectedAnchorIDs.has(40), "Lagrange points must remain selectable");
  assert.ok(selectedAnchorIDs.has(60), "stations must remain selectable");
  assert.ok(selectedAnchorIDs.has(70), "stargates must remain selectable");
});
