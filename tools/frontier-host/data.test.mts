import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import test from "node:test";
import { readBuildManifest, verifyAttestedFile, validateContracts } from "./data.mjs";

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
