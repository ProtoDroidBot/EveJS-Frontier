"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { inflateSync, deflateSync } = require("node:zlib");
const {
  createCompositeModel, encodeMinedSet, decodeMinedSet,
  compositeCellPosition, selectNearestCompositeVoxel, raycastCompositeVoxel,
} = require("../src/services/mining/compositeAsteroidModel");

function model(options = {}) {
  // Both type IDs exist in the target catalog; material mapping is runtime policy.
  return createCompositeModel({ itemID: 1234, typeID: 95899, yieldTypeID: 77800,
    material: "feldspar", radius: 350, ...options });
}

test("composite recipes freeze bounded deterministic client templates and share grids", () => {
  const first = model();
  const again = model({ itemID: 1238 });
  assert.equal(first.recipeHash, again.recipeHash);
  assert.equal(first.grid, again.grid);
  assert.ok(Object.isFrozen(first.grid[0]));
  assert.ok(Object.isFrozen(first.recipe.layers[0].materials[0]));
  assert.equal(first.recipe.seed, 3640686);
  assert.equal(first.grid.length, 937);
  assert.notEqual(first.recipeHash, model({ radius: 351 }).recipeHash);
  assert.notEqual(first.recipeHash, model({ yieldTypeID: 77810 }).recipeHash);
  for (const cell of first.grid) {
    const half = first.spacing / 2;
    const p = compositeCellPosition(first, cell.index);
    assert.ok(Math.hypot(Math.abs(p.x) + half, Math.abs(p.y) + half, Math.abs(p.z) + half) <= first.radius + 1e-10);
  }
  for (const options of [{ itemID: NaN }, { typeID: -1 }, { yieldTypeID: 1.5 },
    { material: "unverified-ore" }, { radius: Infinity }, { radius: -1 }, { templateIndex: 10 }]) {
    assert.throws(() => model(options), RangeError);
  }
});

test("mined blobs use full original compact-grid length and least-significant-bit ordering", () => {
  assert.equal(encodeMinedSet(20, []), null);
  const mined = [0, 7, 8, 19];
  const blob = encodeMinedSet(20, mined);
  assert.deepEqual([...inflateSync(blob)], [0x81, 0x01, 0x08]);
  assert.deepEqual(decodeMinedSet(20, blob), mined);
  assert.deepEqual(decodeMinedSet(20, null), []);
  assert.deepEqual(decodeMinedSet(20, encodeMinedSet(20, [7, 7])), [7]);
  for (const indices of [[-1], [20], [0.5], [NaN]]) assert.throws(() => encodeMinedSet(20, indices), RangeError);
  assert.throws(() => encodeMinedSet(0, []), RangeError);
  assert.throws(() => encodeMinedSet(32769, []), RangeError);
  assert.throws(() => decodeMinedSet(20, deflateSync(Buffer.alloc(2))));
  assert.throws(() => decodeMinedSet(20, deflateSync(Buffer.alloc(4096))));
  assert.throws(() => decodeMinedSet(20, deflateSync(Buffer.from([0, 0, 0x80]))), RangeError);
});

test("selection and raycasts ignore mined cells and use remaining voxel surfaces", () => {
  const asteroid = model();
  const origin = { x: -1000, y: 0, z: 0 };
  const first = raycastCompositeVoxel(asteroid, [], origin, { x: 1, y: 0, z: 0 });
  assert.ok(first && first.distance > 0);
  const next = raycastCompositeVoxel(asteroid, [first.index], origin, { x: 1, y: 0, z: 0 });
  assert.ok(next && next.index !== first.index && next.distance > first.distance);
  const nearest = selectNearestCompositeVoxel(asteroid, [first.index], origin);
  assert.ok(nearest && nearest.index !== first.index);
  assert.equal(raycastCompositeVoxel(asteroid, [], origin, { x: -1, y: 0, z: 0 }), null);
  const all = asteroid.grid.map(cell => cell.index);
  assert.equal(selectNearestCompositeVoxel(asteroid, all, origin), null);
  assert.equal(raycastCompositeVoxel(asteroid, all, origin, { x: 1, y: 0, z: 0 }), null);
  assert.throws(() => raycastCompositeVoxel(asteroid, [], origin, { x: 0, y: 0, z: 0 }), RangeError);
  assert.throws(() => selectNearestCompositeVoxel(asteroid, [], { x: NaN, y: 0, z: 0 }), RangeError);
});

const archive = process.env.FRONTIER_COMPOSITE_CLIENT_ARCHIVE || "/home/ludus/.var/app/com.usebottles.bottles/data/bottles/bottles/ef-devstuff1/drive_c/CCP/EVE Frontier/stillness/code.ccp";
const python = process.env.FRONTIER_PYTHON312 || "/home/ludus/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3";
test("original 3640684 recipe/grid, mined decoder, remote calls and notices agree with server", {
  skip: !fs.existsSync(archive) || !fs.existsSync(python) ? "Set FRONTIER_COMPOSITE_CLIENT_ARCHIVE and FRONTIER_PYTHON312 for target bytecode oracle" : false,
}, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "evejs-composite-oracle-"));
  try {
    for (let templateIndex = 0; templateIndex < 4; templateIndex += 1) {
      const asteroid = model({ templateIndex, material: ["feldspar", "sulfide", "methane", "iridosmine"][templateIndex] });
      const minedIndices = [0, 7, 8, 42, asteroid.grid.length - 1];
      const blob = encodeMinedSet(asteroid.grid.length, minedIndices);
      const input = path.join(dir, "input.json");
      const rays = [
        [{ x: -1000, y: 5, z: 9 }, { x: 1, y: 0.001, z: 0.001 }],
        [{ x: 0, y: -1000, z: 0 }, { x: 0, y: 1, z: 0 }],
        [{ x: 0, y: 0, z: 1000 }, { x: 0, y: 0, z: -1 }],
        [{ x: -1000, y: 0, z: 0 }, { x: -1, y: 0, z: 0 }],
      ];
      const raycasts = rays.map(([origin, direction]) => {
        const hit = raycastCompositeVoxel(asteroid, minedIndices, origin, direction);
        return { origin: [origin.x, origin.y, origin.z], direction: [direction.x, direction.y, direction.z],
          index: hit?.index ?? null, distance: hit?.distance ?? null };
      });
      fs.writeFileSync(input, JSON.stringify({ recipe: asteroid.recipe,
        cells: asteroid.grid.map(c => [c.x, c.y, c.z, c.material]), minedIndices,
        blobBase64: blob.toString("base64"), raycasts }));
      const oracle = spawnSync(python, [path.resolve(__dirname, "../../tools/frontier-static/export-composite-mining.py"),
        "--archive", archive, "--verify-input", input], { encoding: "utf8" });
      assert.equal(oracle.status, 0, oracle.stderr || oracle.stdout);
      const result = JSON.parse(oracle.stdout);
      assert.equal(result.cellCount, asteroid.grid.length);
      assert.equal(result.removedCount, minedIndices.length);
      assert.deepEqual(result.decodedIndices, minedIndices);
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
