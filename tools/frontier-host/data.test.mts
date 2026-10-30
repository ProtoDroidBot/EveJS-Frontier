import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import test from "node:test";
import { readBuildManifest, verifyAttestedFile, validateContracts, validateCollisionAssets } from "./data.mjs";
import { PHASE4_SOURCE_HASHES } from "../frontier-static/lib/static-schema.mjs";

test("contract artifacts require matching build and every attested payload", t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "frontier contract integrity "));
  t.after(() => fs.rmSync(root, { force: true, recursive: true }));
  const file = path.join(root, "descriptors.pb");
  fs.writeFileSync(file, "contract payload");
  const bytes = fs.readFileSync(file);
  const metadata = { bytes: bytes.length, sha256: crypto.createHash("sha256").update(bytes).digest("hex") };
  const manifest = { format: "evejs-frontier-contracts-v1", source: { build: 3640684 }, outputs: { "descriptors.pb": metadata } };
  const manifestPath = path.join(root, "frontier-contract-manifest.json");
  fs.writeFileSync(manifestPath, JSON.stringify(manifest));
  validateContracts(root, "3640684");
  assert.throws(() => readBuildManifest(manifestPath, "3502403", "contracts"), /differs/);
  fs.writeFileSync(file, "corrupt payload!");
  assert.throws(() => validateContracts(root, "3640684"), /attestation|hash mismatch/);
  assert.throws(() => verifyAttestedFile(root, "../outside", metadata), /escapes/);
  assert.throws(() => verifyAttestedFile(root, "nested\\outside", metadata), /Invalid/);
  fs.unlinkSync(file);
  assert.throws(() => validateContracts(root, "3640684"), /ENOENT/);
});

test("only an attested legacy schema may omit generated collision assets", t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "frontier legacy collision "));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const schemaProfile = "frontier-phase4-2703993-v1";
  const snapshot = { schemaProfile, assets: {}, source: { client: { build: 2703993 },
    ...Object.fromEntries(Object.entries(PHASE4_SOURCE_HASHES).map(([key, sha256]) => [key, { sha256 }])) } };
  const database = { build: 2703993, schemaProfile, assets: {} };
  assert.equal(validateCollisionAssets(root, snapshot, database), null);
  assert.throws(() => validateCollisionAssets(root, snapshot, { ...database, schemaProfile: undefined }), /schema profile/);
  assert.throws(() => validateCollisionAssets(root, { ...snapshot, source: { ...snapshot.source, index: {} } }, database), /audited index/);
  fs.mkdirSync(path.join(root, "assets/collision"), { recursive: true });
  fs.writeFileSync(path.join(root, "assets/collision/bundle.collision"), "unexpected");
  assert.throws(() => validateCollisionAssets(root, snapshot, database), /undeclared collision/);
  assert.throws(() => validateCollisionAssets(root, { source: { client: { build: 3502403 } } }, { build: 3502403 }), /Invalid attested/);
});
