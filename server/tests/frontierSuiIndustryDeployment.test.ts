import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { normalizeSuiAddress } from "@mysten/sui/utils";
import { readSuiIndustryDeployment, assertSuiIndustryDeploymentCurrent } from "../src/services/frontier/suiIndustryDeployment";

const address = (n: number) => normalizeSuiAddress(`0x${n.toString(16)}`);
const world = { chainId: "a1b2c3d4", packageId: address(1), objectRegistryId: address(2), adminAclId: address(3) };
const config = () => ({ schemaVersion: 1, chainId: world.chainId, worldPackageId: world.packageId,
  objectRegistryId: world.objectRegistryId, adminAclId: world.adminAclId,
  industryPackageId: address(8), industryTypeOrigin: address(7), industryRegistryId: address(6) });
function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "industry-deployment-test-"));
  t.after(() => {
    assert.equal(path.dirname(path.resolve(directory)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(directory).startsWith("industry-deployment-test-"));
    fs.rmSync(directory, { force: true, recursive: true });
  });
  const file = path.join(directory, "npc-deployment.json");
  const env: NodeJS.ProcessEnv = { EVEJS_SUI_WORLD_CONFIG_PATH: path.join(directory, "world.private.json") };
  return { directory, file, env, write: value => fs.writeFileSync(file, JSON.stringify(value)) };
}

test("missing Industry deployment keeps the base world or existing environment overrides", t => {
  const f = fixture(t);
  const initial = readSuiIndustryDeployment(world, f.env);
  assert.equal(initial.industryPackageId, world.packageId);
  assert.equal(initial.industryTypeOrigin, world.packageId);
  assert.equal(initial.industryRegistryId, world.objectRegistryId);
  const overridden = readSuiIndustryDeployment(world, { ...f.env, SMART_INDUSTRY_PACKAGE_ID: "0x8" });
  assert.equal(overridden.industryPackageId, address(8));
  assert.equal(overridden.industryTypeOrigin, address(8));
  assert.notEqual(initial.fingerprint, overridden.fingerprint);
  assert.equal(readSuiIndustryDeployment(world, { ...f.env, SMART_INDUSTRY_TYPE_ORIGIN: "0x7" }).industryTypeOrigin, address(7));
});

test("public sibling config keeps world identity and resolves separate package and type origins", t => {
  const f = fixture(t);
  f.write({ ...config(), chainId: "A1B2C3D4", worldPackageId: "0x1", industryPackageId: "0x8", industryTypeOrigin: "0x7" });
  const captured = structuredClone(world);
  const result = readSuiIndustryDeployment(world, f.env);
  assert.equal(result.industryPackageId, address(8));
  assert.equal(result.industryTypeOrigin, address(7));
  assert.equal(result.industryRegistryId, address(6));
  assert.deepEqual(world, captured);
  assert.deepEqual(Object.keys(result).sort(), ["fingerprint", "industryPackageId", "industryRegistryId", "industryTypeOrigin"]);
  f.write(config());
  assert.equal(readSuiIndustryDeployment(world, f.env).fingerprint, result.fingerprint);
});

test("environment overrides take precedence per field without masking invalid file identities", t => {
  const f = fixture(t); f.write(config());
  const env = { ...f.env, SMART_INDUSTRY_PACKAGE_ID: "0x9", SMART_INDUSTRY_TYPE_ORIGIN: "0x6", SMART_INDUSTRY_REGISTRY_ID: "0x5" };
  const result = readSuiIndustryDeployment(world, env);
  assert.equal(result.industryPackageId, address(9));
  assert.equal(result.industryTypeOrigin, address(6));
  assert.equal(result.industryRegistryId, address(5));
  assert.equal(readSuiIndustryDeployment(world, { ...f.env, SMART_INDUSTRY_PACKAGE_ID: "0x9" }).industryTypeOrigin, address(7));
  f.write({ ...config(), industryPackageId: "bad" });
  assert.throws(() => readSuiIndustryDeployment(world, env), /package.*Sui address/);
  f.write({ ...config(), industryTypeOrigin: "0x0" });
  assert.throws(() => readSuiIndustryDeployment(world, env), /type origin.*Sui address/);
});

test("chain, world package, registry, and ACL mismatches fail closed", t => {
  const f = fixture(t);
  for (const [key, value] of Object.entries({ chainId: "ffffffff", worldPackageId: address(4), objectRegistryId: address(4), adminAclId: address(4) })) {
    f.write({ ...config(), [key]: value });
    assert.throws(() => readSuiIndustryDeployment(world, f.env), new RegExp(`${key} does not match`));
  }
});

test("malformed schemas and all supplied environment identities reject instead of falling back", t => {
  const f = fixture(t);
  for (const value of [null, [], {}, { ...config(), schemaVersion: 2 }, { ...config(), chainId: "not-a-chain" }]) {
    f.write(value);
    assert.throws(() => readSuiIndustryDeployment(world, f.env), /Industry deployment/);
  }
  fs.writeFileSync(f.file, "{");
  assert.throws(() => readSuiIndustryDeployment(world, f.env), /could not be read as JSON/);
  f.write(config());
  for (const key of ["SMART_INDUSTRY_PACKAGE_ID", "SMART_INDUSTRY_TYPE_ORIGIN", "SMART_INDUSTRY_REGISTRY_ID"]) {
    for (const value of ["not-an-address", "0x0", `0x${"a".repeat(65)}`]) {
      assert.throws(() => readSuiIndustryDeployment(world, { ...f.env, [key]: value }), /Sui address/);
    }
  }
});

test("explicit config path replaces sibling lookup and absent override files retain fallback", t => {
  const f = fixture(t); f.write({ ...config(), industryPackageId: "invalid" });
  const explicit = path.join(f.directory, "chosen.json");
  const env = { ...f.env, EVEJS_SUI_INDUSTRY_CONFIG_PATH: explicit };
  assert.equal(readSuiIndustryDeployment(world, env).industryPackageId, world.packageId);
  fs.writeFileSync(explicit, JSON.stringify(config()));
  assert.equal(readSuiIndustryDeployment(world, env).industryPackageId, address(8));
});

test("fingerprints detect changes, appearance and removal before a stale context can submit", t => {
  const f = fixture(t);
  const absent = readSuiIndustryDeployment(world, f.env);
  f.write(config());
  assert.throws(() => assertSuiIndustryDeploymentCurrent(absent, world, f.env), /deployment changed/);
  const captured = readSuiIndustryDeployment(world, f.env);
  assert.equal(assertSuiIndustryDeploymentCurrent(captured, world, f.env).fingerprint, captured.fingerprint);
  f.write({ ...config(), industryPackageId: address(9) });
  assert.throws(() => assertSuiIndustryDeploymentCurrent(captured, world, f.env), /deployment changed/);
  f.write(config());
  assert.throws(() => assertSuiIndustryDeploymentCurrent(captured, world, { ...f.env, SMART_INDUSTRY_TYPE_ORIGIN: "0x6" }), /deployment changed/);
  fs.unlinkSync(f.file);
  assert.throws(() => assertSuiIndustryDeploymentCurrent(captured, world, f.env), /deployment changed/);
  assert.equal(readSuiIndustryDeployment(world, f.env).fingerprint, absent.fingerprint);
});
