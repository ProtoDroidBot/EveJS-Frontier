"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const {
  resolveStoreRoot,
} = require("../../../gameStore/storeRoot");

const COLLISION_BUNDLE_RELATIVE_PATH = path.join(
  "assets",
  "collision",
  "bundle.collision",
);
const COLLISION_BUNDLE_SCHEMA = "destiny.buffers.CollisionData";
const MIN_FLATBUFFER_BYTES = 12;

function toFiniteNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function vector3(x = 0, y = 0, z = 0) {
  return { x, y, z };
}

function addVectors(left, right) {
  return vector3(left.x + right.x, left.y + right.y, left.z + right.z);
}

function scaleVector(value, scale) {
  return vector3(value.x * scale, value.y * scale, value.z * scale);
}

function rotateVectorWxyz(value, quaternion) {
  const w = toFiniteNumber(quaternion && quaternion.w, 1);
  const x = toFiniteNumber(quaternion && quaternion.x, 0);
  const y = toFiniteNumber(quaternion && quaternion.y, 0);
  const z = toFiniteNumber(quaternion && quaternion.z, 0);
  const length = Math.hypot(w, x, y, z);
  if (length <= Number.EPSILON) {
    return vector3(value.x, value.y, value.z);
  }
  const qw = w / length;
  const qx = x / length;
  const qy = y / length;
  const qz = z / length;

  // q * v * conjugate(q), without allocating the intermediate quaternions.
  const tx = 2 * ((qy * value.z) - (qz * value.y));
  const ty = 2 * ((qz * value.x) - (qx * value.z));
  const tz = 2 * ((qx * value.y) - (qy * value.x));
  return vector3(
    value.x + (qw * tx) + ((qy * tz) - (qz * ty)),
    value.y + (qw * ty) + ((qz * tx) - (qx * tz)),
    value.z + (qw * tz) + ((qx * ty) - (qy * tx)),
  );
}

function transformPoint(value, transform) {
  return addVectors(
    rotateVectorWxyz(scaleVector(value, transform.scale), transform.rotation),
    transform.translation,
  );
}

function transformDirection(value, transform) {
  return rotateVectorWxyz(scaleVector(value, transform.scale), transform.rotation);
}

function sha256Buffer(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function normalizeSha256(value) {
  const text = String(value || "").trim().toLowerCase();
  return /^[a-f0-9]{64}$/.test(text) ? text : null;
}

function assertBufferRange(buffer, offset, byteLength, label) {
  if (
    !Number.isSafeInteger(offset) ||
    !Number.isSafeInteger(byteLength) ||
    offset < 0 ||
    byteLength < 0 ||
    offset + byteLength > buffer.length
  ) {
    throw new Error(
      `Invalid collision FlatBuffer ${label} range: ${offset}+${byteLength} ` +
      `(file bytes ${buffer.length})`,
    );
  }
}

class CollisionFlatBufferReader {
  buffer;

  constructor(buffer) {
    if (!Buffer.isBuffer(buffer) || buffer.length < MIN_FLATBUFFER_BYTES) {
      throw new Error("Collision bundle is not a valid FlatBuffer");
    }
    this.buffer = buffer;
  }

  uint16(offset, label = "uint16") {
    assertBufferRange(this.buffer, offset, 2, label);
    return this.buffer.readUInt16LE(offset);
  }

  uint32(offset, label = "uint32") {
    assertBufferRange(this.buffer, offset, 4, label);
    return this.buffer.readUInt32LE(offset);
  }

  int32(offset, label = "int32") {
    assertBufferRange(this.buffer, offset, 4, label);
    return this.buffer.readInt32LE(offset);
  }

  float32(offset, label = "float32") {
    assertBufferRange(this.buffer, offset, 4, label);
    return this.buffer.readFloatLE(offset);
  }

  indirect(offset, label = "offset") {
    const target = offset + this.uint32(offset, label);
    assertBufferRange(this.buffer, target, 4, `${label} target`);
    return target;
  }

  tableField(table, fieldIndex) {
    const vtable = table - this.int32(table, "table vtable offset");
    assertBufferRange(this.buffer, vtable, 4, "vtable");
    const vtableLength = this.uint16(vtable, "vtable length");
    const entry = vtable + 4 + (fieldIndex * 2);
    if (entry + 2 > vtable + vtableLength) {
      return 0;
    }
    const relativeOffset = this.uint16(entry, "vtable field");
    if (relativeOffset === 0) {
      return 0;
    }
    const field = table + relativeOffset;
    assertBufferRange(this.buffer, field, 1, "table field");
    return field;
  }

  tableVector(table, fieldIndex) {
    const field = this.tableField(table, fieldIndex);
    if (!field) {
      return null;
    }
    const vector = this.indirect(field, "vector offset");
    const length = this.uint32(vector, "vector length");
    return { data: vector + 4, length };
  }

  vectorTable(vector, index) {
    if (index < 0 || index >= vector.length) {
      throw new RangeError(`Collision vector index is out of bounds: ${index}`);
    }
    const element = vector.data + (index * 4);
    return this.indirect(element, "table vector element");
  }

  vector3(offset) {
    return vector3(
      this.float32(offset, "Vector3.x"),
      this.float32(offset + 4, "Vector3.y"),
      this.float32(offset + 8, "Vector3.z"),
    );
  }

  quaternionWxyz(offset) {
    return {
      w: this.float32(offset, "Quaternion.w"),
      x: this.float32(offset + 4, "Quaternion.x"),
      y: this.float32(offset + 8, "Quaternion.y"),
      z: this.float32(offset + 12, "Quaternion.z"),
    };
  }
}

function readUniformTransform(reader, uniformComponent) {
  const transformField = reader.tableField(uniformComponent, 0);
  if (!transformField) {
    return {
      translation: vector3(),
      rotation: { w: 1, x: 0, y: 0, z: 0 },
      scale: 1,
    };
  }
  const transform = reader.indirect(transformField, "uniform transform");
  const translationField = reader.tableField(transform, 0);
  const rotationField = reader.tableField(transform, 1);
  const scaleField = reader.tableField(transform, 2);
  return {
    translation: translationField ? reader.vector3(translationField) : vector3(),
    rotation: rotationField
      ? reader.quaternionWxyz(rotationField)
      : { w: 1, x: 0, y: 0, z: 0 },
    scale: scaleField ? reader.float32(scaleField, "UniformTransform.scale") : 1,
  };
}

function readPrimitiveTableVector(reader, uniformComponent, fieldIndex) {
  const tableField = reader.tableField(uniformComponent, fieldIndex);
  if (!tableField) {
    return null;
  }
  const primitiveTable = reader.indirect(tableField, "primitive table");
  return reader.tableVector(primitiveTable, 0);
}

class CollisionBundle {
  buffer;
  reader;
  sourcePath;
  sha256;
  itemVector;
  itemPositionsByID;
  profileCache;

  constructor(buffer, options: Record<string, any> = {}) {
    this.buffer = buffer;
    this.reader = new CollisionFlatBufferReader(buffer);
    this.sourcePath = options.sourcePath ? path.resolve(options.sourcePath) : null;
    this.sha256 = options.sha256 || null;
    this.profileCache = new Map();

    const root = this.reader.uint32(0, "root table");
    assertBufferRange(buffer, root, 4, "root table");
    const itemVector = this.reader.tableVector(root, 0);
    if (!itemVector) {
      throw new Error("Collision bundle has no CollisionData.Items vector");
    }
    assertBufferRange(buffer, itemVector.data, itemVector.length * 4, "CollisionData.Items");
    this.itemVector = itemVector;
    this.itemPositionsByID = new Map();

    let previousID = -Infinity;
    for (let index = 0; index < itemVector.length; index += 1) {
      const item = this.reader.vectorTable(itemVector, index);
      const idField = this.reader.tableField(item, 0);
      if (!idField) {
        throw new Error(`Collision item ${index} has no collisionId`);
      }
      const collisionID = this.reader.int32(idField, "CollisionItem.collisionId");
      if (collisionID <= previousID) {
        throw new Error(
          `Collision IDs are not strictly sorted at item ${index}: ` +
          `${collisionID} follows ${previousID}`,
        );
      }
      this.itemPositionsByID.set(collisionID, item);
      previousID = collisionID;
    }
  }

  get itemCount() {
    return this.itemVector.length;
  }

  has(collisionID) {
    return this.itemPositionsByID.has(Math.trunc(toFiniteNumber(collisionID, -1)));
  }

  getMetadata(collisionID) {
    const resolvedID = Math.trunc(toFiniteNumber(collisionID, -1));
    const item = this.itemPositionsByID.get(resolvedID);
    if (!item) {
      return null;
    }
    const componentVector = this.reader.tableVector(item, 1);
    const uniformVector = this.reader.tableVector(item, 2);
    const boundingRadiusField = this.reader.tableField(item, 3);
    return {
      collisionID: resolvedID,
      boundingRadius: Math.max(
        0,
        boundingRadiusField
          ? this.reader.float32(boundingRadiusField, "CollisionItem.boundingRadius")
          : 0,
      ),
      componentCount: componentVector ? componentVector.length : 0,
      uniformComponentCount: uniformVector ? uniformVector.length : 0,
      hasConvexMeshes: Boolean(componentVector && componentVector.length > 0),
    };
  }

  getProfile(collisionID) {
    const resolvedID = Math.trunc(toFiniteNumber(collisionID, -1));
    if (this.profileCache.has(resolvedID)) {
      return this.profileCache.get(resolvedID);
    }
    const item = this.itemPositionsByID.get(resolvedID);
    if (!item) {
      return null;
    }

    const metadata = this.getMetadata(resolvedID);
    const balls = [];
    const boxes = [];
    const capsules = [];
    const uniformVector = this.reader.tableVector(item, 2);
    if (uniformVector) {
      for (let componentIndex = 0;
        componentIndex < uniformVector.length;
        componentIndex += 1) {
        const component = this.reader.vectorTable(uniformVector, componentIndex);
        const transform = readUniformTransform(this.reader, component);

        const ballVector = readPrimitiveTableVector(this.reader, component, 1);
        if (ballVector) {
          assertBufferRange(
            this.buffer,
            ballVector.data,
            ballVector.length * 16,
            "BallTable.Balls",
          );
          for (let index = 0; index < ballVector.length; index += 1) {
            const offset = ballVector.data + (index * 16);
            balls.push({
              center: transformPoint(this.reader.vector3(offset), transform),
              radius: Math.abs(
                this.reader.float32(offset + 12, "Ball.radius") * transform.scale,
              ),
            });
          }
        }

        const boxVector = readPrimitiveTableVector(this.reader, component, 2);
        if (boxVector) {
          assertBufferRange(
            this.buffer,
            boxVector.data,
            boxVector.length * 48,
            "BoxTable.Boxes",
          );
          for (let index = 0; index < boxVector.length; index += 1) {
            const offset = boxVector.data + (index * 48);
            boxes.push({
              corner: transformPoint(this.reader.vector3(offset), transform),
              edgeX: transformDirection(this.reader.vector3(offset + 12), transform),
              edgeY: transformDirection(this.reader.vector3(offset + 24), transform),
              edgeZ: transformDirection(this.reader.vector3(offset + 36), transform),
            });
          }
        }

        const capsuleVector = readPrimitiveTableVector(this.reader, component, 3);
        if (capsuleVector) {
          assertBufferRange(
            this.buffer,
            capsuleVector.data,
            capsuleVector.length * 28,
            "CapsuleTable.Capsules",
          );
          for (let index = 0; index < capsuleVector.length; index += 1) {
            const offset = capsuleVector.data + (index * 28);
            capsules.push({
              start: transformPoint(this.reader.vector3(offset), transform),
              end: transformPoint(this.reader.vector3(offset + 12), transform),
              radius: Math.abs(
                this.reader.float32(offset + 24, "Capsule.radius") * transform.scale,
              ),
            });
          }
        }
      }
    }

    const profile = Object.freeze({
      ...metadata,
      balls: Object.freeze(balls),
      boxes: Object.freeze(boxes),
      capsules: Object.freeze(capsules),
      hasPrimitiveGeometry:
        balls.length > 0 || boxes.length > 0 || capsules.length > 0,
    });
    this.profileCache.set(resolvedID, profile);
    return profile;
  }
}

function loadCollisionBundle(filePath, options: Record<string, any> = {}) {
  const sourcePath = path.resolve(filePath);
  const buffer = fs.readFileSync(sourcePath);
  const expectedBytes = Number(options.expectedBytes);
  if (Number.isSafeInteger(expectedBytes) && expectedBytes >= 0 && buffer.length !== expectedBytes) {
    throw new Error(
      `Collision bundle byte size mismatch: expected ${expectedBytes}, found ${buffer.length}`,
    );
  }
  const expectedSha256 = normalizeSha256(options.expectedSha256);
  const mustHash = Boolean(expectedSha256 || options.computeSha256 === true);
  const sha256 = mustHash ? sha256Buffer(buffer) : null;
  if (expectedSha256 && sha256 !== expectedSha256) {
    throw new Error(
      `Collision bundle SHA-256 mismatch: expected ${expectedSha256}, found ${sha256}`,
    );
  }
  return new CollisionBundle(buffer, { sourcePath, sha256 });
}

function readInstalledCollisionAsset(storeRoot) {
  const manifestPath = path.join(storeRoot, "manifest.json");
  let manifest = null;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  } catch (error) {
    if (error && error.code !== "ENOENT") {
      throw error;
    }
  }
  const metadata = manifest && manifest.assets && manifest.assets.collisionBundle;
  const relativePath = metadata && typeof metadata.path === "string"
    ? metadata.path
    : COLLISION_BUNDLE_RELATIVE_PATH;
  const sourcePath = path.resolve(storeRoot, relativePath);
  const relative = path.relative(storeRoot, sourcePath);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Collision bundle path escapes the game store: ${relativePath}`);
  }
  return {
    sourcePath,
    expectedBytes: metadata && metadata.bytes,
    expectedSha256: metadata && metadata.sha256,
  };
}

let defaultCollisionBundleLoaded = false;
let defaultCollisionBundle = null;
let defaultCollisionBundleError = null;

function getDefaultCollisionBundle() {
  if (defaultCollisionBundleLoaded) {
    return defaultCollisionBundle;
  }
  defaultCollisionBundleLoaded = true;
  try {
    const explicitPath = String(process.env.EVEJS_COLLISION_BUNDLE_PATH || "").trim();
    if (explicitPath) {
      defaultCollisionBundle = loadCollisionBundle(explicitPath, {
        expectedSha256: process.env.EVEJS_COLLISION_BUNDLE_SHA256,
      });
    } else {
      const installed = readInstalledCollisionAsset(resolveStoreRoot());
      if (!fs.existsSync(installed.sourcePath)) {
        if (String(process.env.EVEJS_COLLISION_BUNDLE_REQUIRED || "") === "1") {
          throw new Error(`Collision bundle is required but missing: ${installed.sourcePath}`);
        }
        return null;
      }
      defaultCollisionBundle = loadCollisionBundle(installed.sourcePath, installed);
    }
  } catch (error) {
    defaultCollisionBundleError = error;
    if (String(process.env.EVEJS_COLLISION_BUNDLE_REQUIRED || "") === "1") {
      throw error;
    }
    // An absent optional asset is handled above. A present but malformed or
    // hash-mismatched asset must never silently downgrade authoritative
    // collision behavior to the legacy sphere fallback.
    throw error;
  }
  return defaultCollisionBundle;
}

function getDefaultCollisionBundleError() {
  try {
    getDefaultCollisionBundle();
  } catch {
    // This diagnostic accessor reports the retained initialization failure;
    // normal bundle consumers still receive the original exception.
  }
  return defaultCollisionBundleError;
}

function resetDefaultCollisionBundleForTesting() {
  defaultCollisionBundleLoaded = false;
  defaultCollisionBundle = null;
  defaultCollisionBundleError = null;
}

function setDefaultCollisionBundleForTesting(bundle) {
  defaultCollisionBundleLoaded = true;
  defaultCollisionBundle = bundle;
  defaultCollisionBundleError = null;
}

function isCollisionOptedOut(entity) {
  return Boolean(
    entity &&
    (
      entity.collisionEnabled === false ||
      entity.destinyCollisionEnabled === false ||
      entity.destinyForceMassive === false ||
      entity.nonPhysicalCollision === true ||
      entity.nonPhysicalDecloakExempt === true
    ),
  );
}

function resolveEntityCollisionPresentation(
  entity,
  bundle = getDefaultCollisionBundle(),
  options: Record<string, any> = {},
) {
  const collisionScale = toFiniteNumber(entity && entity.collisionScale, 1);
  if (!entity || isCollisionOptedOut(entity)) {
    return {
      collisionID: -1,
      collisionScale,
      profile: null,
      source: "disabled",
    };
  }

  const hasExplicitCollisionID = entity.collisionID !== undefined && entity.collisionID !== null;
  let collisionID = -1;
  let source = "none";
  if (hasExplicitCollisionID) {
    collisionID = Math.trunc(toFiniteNumber(entity.collisionID, -1));
    collisionID = collisionID > 0 ? collisionID : -1;
    source = "explicit";
  } else if (bundle) {
    for (const [fieldName, value] of [
      ["graphicID", entity.graphicID],
      ["slimGraphicID", entity.slimGraphicID],
    ]) {
      const candidate = Math.trunc(toFiniteNumber(value, -1));
      if (candidate > 0 && bundle.has(candidate)) {
        collisionID = candidate;
        source = fieldName;
        break;
      }
    }
  }

  const profile = entity.collisionProfile && typeof entity.collisionProfile === "object"
    ? entity.collisionProfile
    : collisionID > 0 && bundle && options.includeProfile !== false
      ? options.metadataOnly === true
        ? bundle.getMetadata(collisionID)
        : bundle.getProfile(collisionID)
      : null;
  return {
    collisionID,
    collisionScale,
    profile,
    source,
  };
}

module.exports = {
  COLLISION_BUNDLE_RELATIVE_PATH,
  COLLISION_BUNDLE_SCHEMA,
  CollisionBundle,
  CollisionFlatBufferReader,
  getDefaultCollisionBundle,
  getDefaultCollisionBundleError,
  loadCollisionBundle,
  resetDefaultCollisionBundleForTesting,
  resolveEntityCollisionPresentation,
  rotateVectorWxyz,
  setDefaultCollisionBundleForTesting,
};
