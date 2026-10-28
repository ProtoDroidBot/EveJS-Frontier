import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { certificatePaths, ensureCertificates, validatePair } from "./certificates.mjs";

test("portable TLS setup creates valid pairs and preserves identities on repeat setup", t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "frontier certificates "));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const first = ensureCertificates(root);
  assert.equal(first.trustInstalled, false);
  const before = new Map(Object.values(first.files).map(file => [file, fs.readFileSync(file)]));
  ensureCertificates(root);
  for (const [file, bytes] of before) assert.deepEqual(fs.readFileSync(file), bytes);
  validatePair(first.files.gateway, first.files.gatewayKey, ["dev-public-gateway.evetech.net", "localhost", "127.0.0.1"], first.files.ca);
  validatePair(first.files.dapp, first.files.dappKey, ["dev.dapps.evefrontier.com"]);
  if (process.platform !== "win32") for (const key of [first.files.caKey, first.files.xmppKey, first.files.gatewayKey, first.files.dappKey]) assert.equal(fs.statSync(key).mode & 0o777, 0o600);
  assert.throws(() => validatePair(first.files.dapp, first.files.gatewayKey, []), /do not match/);
  assert.throws(() => validatePair(first.files.dapp, first.files.dappKey, ["wrong.invalid"]), /lacks/);
});

test("TLS setup refuses partial pairs before creating or replacing credentials", t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "frontier partial certificates "));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const files = certificatePaths(root);
  fs.mkdirSync(path.dirname(files.ca), { recursive: true });
  fs.writeFileSync(files.ca, "preserve this certificate");
  assert.throws(() => ensureCertificates(root), /Incomplete TLS pair/);
  assert.equal(fs.readFileSync(files.ca, "utf8"), "preserve this certificate");
  assert.equal(fs.existsSync(files.caKey), false);
});
