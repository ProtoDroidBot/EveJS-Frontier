"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  DEFAULT_DUNGEON_SPAWN_SEPARATION_METERS,
  buildSeparatedSpawnPosition,
  positionsAreSeparated,
} = require("../src/utils/dungeonSpawnPlacement");

function distance(left, right) {
  const dx = left.x - right.x;
  const dy = left.y - right.y;
  const dz = left.z - right.z;
  return Math.sqrt((dx * dx) + (dy * dy) + (dz * dz));
}

test("shared dungeon placement keeps every triggered spawn outside occupied entities", () => {
  const occupied: any[] = [{
    position: { x: 0, y: 0, z: 0 },
    radius: 2_000,
  }];
  const spawnedPositions: any[] = [];

  for (let index = 0; index < 48; index += 1) {
    const position = buildSeparatedSpawnPosition(
      { x: 0, y: 0, z: 0 },
      occupied,
      {
        candidateRadius: 1_000,
        seed: `all-dungeons:${index}`,
      },
    );
    assert.equal(
      positionsAreSeparated(position, occupied, { candidateRadius: 1_000 }),
      true,
    );
    occupied.push({ position, radius: 1_000 });
    spawnedPositions.push(position);
  }

  for (let left = 0; left < spawnedPositions.length; left += 1) {
    for (let right = left + 1; right < spawnedPositions.length; right += 1) {
      assert.ok(
        distance(spawnedPositions[left], spawnedPositions[right]) >=
          DEFAULT_DUNGEON_SPAWN_SEPARATION_METERS + 2_000,
      );
    }
  }
});

test("shared dungeon placement preserves an authored position when it is already clear", () => {
  const desired = { x: 25_000, y: -4_000, z: 9_000 };
  assert.deepEqual(
    buildSeparatedSpawnPosition(
      desired,
      [{ position: { x: -50_000, y: 0, z: 0 }, radius: 500 }],
      { seed: "clear-authored-position" },
    ),
    desired,
  );
});

test("shared dungeon placement clears structures larger than the bounded search area", () => {
  const occupied = [{
    position: { x: 0, y: 0, z: 0 },
    radius: 1_000_000,
  }];
  const position = buildSeparatedSpawnPosition(
    { x: 0, y: 0, z: 0 },
    occupied,
    {
      candidateRadius: 2_000,
      maxRings: 1,
      seed: "oversized-structure",
    },
  );
  assert.equal(
    positionsAreSeparated(position, occupied, { candidateRadius: 2_000 }),
    true,
  );
});
