import assert from "node:assert/strict";
import test from "node:test";
import { PHASE4_SOURCE_HASHES, assertStaticSource, resolveStaticSchema, snapshotStaticSchema, databaseStaticSchema } from "../lib/static-schema.mjs";

function legacySnapshot() {
  return { schemaProfile: "frontier-phase4-2703993-v1", assets: {}, source: {
    client: { build: 2703993 }, ...Object.fromEntries(Object.entries(PHASE4_SOURCE_HASHES).map(([key, sha256]) => [key, { sha256 }])),
  } };
}

test("only the audited exact Phase 4 identity opts into missing modern features", () => {
  const snapshot = legacySnapshot();
  assert.equal(snapshotStaticSchema(snapshot).collisionBundle, false);
  assert.equal(resolveStaticSchema(2702949).collisionBundle, true);
  assert.equal(resolveStaticSchema(3502403).creation, true);
  assert.throws(() => snapshotStaticSchema({ ...snapshot, schemaProfile: undefined }), /schema profile/);
  assert.throws(() => snapshotStaticSchema({ ...snapshot, source: { ...snapshot.source, client: { build: 3502403 } } }), /schema profile/);
  for (const key of Object.keys(PHASE4_SOURCE_HASHES)) {
    assert.throws(() => assertStaticSource(2703993, { ...snapshot.source, [key]: { sha256: "0".repeat(64) } }), /audited.*SHA-256/);
  }
});

test("legacy absence cannot conceal collision metadata or a mismatched database", () => {
  const snapshot = legacySnapshot();
  assert.throws(() => snapshotStaticSchema({ ...snapshot, assets: { collisionBundle: {} } }), /unexpected collision metadata/);
  const database = { build: 2703993, schemaProfile: snapshot.schemaProfile, assets: {} };
  assert.equal(databaseStaticSchema(snapshot, database).landscape, false);
  assert.throws(() => databaseStaticSchema(snapshot, { ...database, schemaProfile: undefined }), /schema profile/);
  assert.throws(() => databaseStaticSchema(snapshot, { ...database, assets: { collisionBundle: {} } }), /must not declare/);
  assert.equal(snapshotStaticSchema({ source: { client: { build: 3502403 } } }).collisionBundle, true);
});
