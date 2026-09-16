import assert from "node:assert/strict";
import test from "node:test";

const {
  resetDefaultCollisionBundleForTesting,
  resolveEntityCollisionPresentation,
  setDefaultCollisionBundleForTesting,
} = require("../src/space/destiny/collision/collisionBundle");
const {
  encodeEntityBall,
} = require("../src/space/destiny/stream/ballEncoding");
const {
  findSweptEntityCollision,
  findSweptPointAgainstCapsule,
  findSweptSphereAgainstBox,
  getEntityCollisionBroadphaseRadius,
} = require("../src/space/destiny/simulation/collisions");

test("collision presentation resolves graphics only when the bundle contains them", () => {
  const profile = {
    boundingRadius: 20,
    balls: [],
    boxes: [],
    capsules: [],
  };
  const bundle = {
    has(collisionID) {
      return collisionID === 4212;
    },
    getProfile(collisionID) {
      return collisionID === 4212 ? profile : null;
    },
  };

  assert.deepEqual(
    resolveEntityCollisionPresentation(
      { graphicID: 4212, slimGraphicID: 9999, typeID: 4212 },
      bundle,
    ),
    {
      collisionID: 4212,
      collisionScale: 1,
      profile,
      source: "graphicID",
    },
  );
  assert.equal(
    resolveEntityCollisionPresentation({ typeID: 4212 }, bundle).collisionID,
    -1,
    "type IDs must never be treated as collision IDs",
  );
  assert.equal(
    resolveEntityCollisionPresentation(
      { collisionID: 7777, graphicID: 4212, collisionScale: 2.5 },
      bundle,
    ).collisionID,
    7777,
    "an explicit server override remains authoritative",
  );
});

test("Frontier ball encoding sends the resolved graphic collision profile", (t) => {
  t.after(resetDefaultCollisionBundleForTesting);
  setDefaultCollisionBundleForTesting({
    has(collisionID) {
      return collisionID === 4212;
    },
    getProfile() {
      return null;
    },
  });
  const encoded = encodeEntityBall({
    itemID: 64000001,
    kind: "station",
    radius: 100,
    graphicID: 4212,
    collisionScale: 1.75,
    collisionQuaternion: [Math.SQRT1_2, 0, 0, Math.SQRT1_2],
    position: { x: 1, y: 2, z: 3 },
  }, {
    compatibilityProfile: "frontier",
  });

  assert.ok(Math.abs(encoded.readDoubleLE(42) - Math.SQRT1_2) < 1e-12);
  assert.ok(Math.abs(encoded.readDoubleLE(66) - Math.SQRT1_2) < 1e-12);
  assert.equal(encoded.readInt32LE(74), 4212);
  assert.equal(encoded.readFloatLE(78), 1.75);
});

test("swept spheres collide with rounded box faces", () => {
  const collision = findSweptSphereAgainstBox(
    { x: 0, y: 0, z: 0 },
    { x: 10, y: 0, z: 0 },
    1,
    {
      corner: { x: 5, y: -2, z: -2 },
      edgeX: { x: 2, y: 0, z: 0 },
      edgeY: { x: 0, y: 4, z: 0 },
      edgeZ: { x: 0, y: 0, z: 4 },
    },
  );
  assert.ok(collision);
  assert.ok(Math.abs(collision.fraction - 0.4) < 1e-9);
  assert.ok(Math.abs(collision.normal.x + 1) < 1e-9);
  assert.ok(Math.abs(collision.normal.y) < 1e-9);
  assert.ok(Math.abs(collision.normal.z) < 1e-9);
  assert.equal(collision.startedOverlapping, false);
});

test("swept points collide with expanded capsules", () => {
  const collision = findSweptPointAgainstCapsule(
    { x: 0, y: 0, z: 0 },
    { x: 10, y: 0, z: 0 },
    { x: 5, y: -2, z: 0 },
    { x: 5, y: 2, z: 0 },
    1.5,
  );
  assert.ok(collision);
  assert.ok(Math.abs(collision.fraction - 0.35) < 1e-9);
  assert.ok(Math.abs(collision.normal.x + 1) < 1e-9);
  assert.equal(collision.startedOverlapping, false);
});

test("compound primitive profiles replace the candidate fallback sphere", () => {
  const movingEntity = {
    itemID: 1,
    collisionRadius: 1,
  };
  const candidate = {
    itemID: 2,
    collisionRadius: 50,
    collisionProfile: {
      boundingRadius: 12,
      balls: [
        { center: { x: 10, y: 0, z: 0 }, radius: 2 },
      ],
      boxes: [],
      capsules: [],
    },
  };
  const collision = findSweptEntityCollision(
    movingEntity,
    candidate,
    { x: 0, y: 0, z: 0 },
    { x: 20, y: 0, z: 0 },
    { x: 0, y: 0, z: 0 },
    { x: 0, y: 0, z: 0 },
  );

  assert.ok(collision);
  assert.equal(collision.primitiveType, "ball");
  assert.ok(Math.abs(collision.fraction - 0.35) < 1e-9);
  assert.ok(Math.abs(collision.resolvedPosition.x - 6.99) < 1e-9);
});

test("mesh-only profiles fall back to the bundle bound instead of type radius", () => {
  const candidate = {
    itemID: 2,
    collisionRadius: 1_000,
    collisionScale: 2,
    collisionProfile: {
      boundingRadius: 2,
      balls: [],
      boxes: [],
      capsules: [],
      hasConvexMeshes: true,
    },
  };
  assert.equal(getEntityCollisionBroadphaseRadius(candidate), 4);
  const collision = findSweptEntityCollision(
    { itemID: 1, collisionRadius: 1 },
    candidate,
    { x: -10, y: 0, z: 0 },
    { x: 10, y: 0, z: 0 },
    { x: 0, y: 0, z: 0 },
    { x: 0, y: 0, z: 0 },
  );
  assert.ok(collision);
  assert.equal(collision.startedOverlapping, false);
  assert.ok(Math.abs(collision.fraction - 0.25) < 1e-9);
  assert.equal(collision.combinedRadius, 5);
});
