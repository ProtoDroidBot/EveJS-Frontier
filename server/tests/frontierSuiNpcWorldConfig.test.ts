import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { normalizeSuiAddress } from "@mysten/sui/utils";
import {
  readSuiNpcWorldConfig,
  assertSuiNpcWorldConfigCurrent,
} from "../src/services/frontier/suiNpcWorldConfig";

const address = (n: number) => normalizeSuiAddress(`0x${n.toString(16)}`);
const world = {
  chainId: "a1b2c3d4", packageId: address(1), objectRegistryId: address(2), adminAclId: address(3),
};
const config = () => ({
  schemaVersion: 1, chainId: world.chainId, worldPackageId: world.packageId,
  objectRegistryId: world.objectRegistryId, adminAclId: world.adminAclId,
  packageId: address(8), typeOrigin: address(7),
  accessPackageId: address(10), accessTypeOrigin: address(9),
});

function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "npc-deployment-test-"));
  t.after(() => {
    assert.equal(path.dirname(path.resolve(directory)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(directory).startsWith("npc-deployment-test-"));
    fs.rmSync(directory, { force: true, recursive: true });
  });
  const file = path.join(directory, "npc-deployment.json");
  const env: NodeJS.ProcessEnv = { EVEJS_SUI_WORLD_CONFIG_PATH: path.join(directory, "world.private.json") };
  return { directory, file, env, write: value => fs.writeFileSync(file, JSON.stringify(value)) };
}

test("fresh NPC deployments default to the original world while upgrades separate call target and type origin", t => {
  const f = fixture(t);
  const initial = readSuiNpcWorldConfig(world, f.env);
  assert.equal(initial.npcPackageId, world.packageId);
  assert.equal(initial.npcTypeOrigin, world.packageId);
  assert.equal(initial.accessPackageId, world.packageId);
  assert.equal(initial.accessTypeOrigin, world.packageId);
  const firstUpgrade = readSuiNpcWorldConfig(world, { ...f.env, EVEJS_SUI_NPC_PACKAGE_ID: "0x7" });
  assert.equal(firstUpgrade.npcPackageId, address(7));
  assert.equal(firstUpgrade.npcTypeOrigin, address(7));
  const laterUpgrade = readSuiNpcWorldConfig(world, {
    ...f.env, EVEJS_SUI_NPC_PACKAGE_ID: "0x8", EVEJS_SUI_NPC_TYPE_ORIGIN: "0x7",
  });
  assert.equal(laterUpgrade.npcPackageId, address(8));
  assert.equal(laterUpgrade.npcTypeOrigin, address(7));
  const accessUpgrade = readSuiNpcWorldConfig(world, {
    ...f.env,
    EVEJS_SUI_NPC_PACKAGE_ID: "0x8",
    EVEJS_SUI_NPC_TYPE_ORIGIN: "0x7",
    EVEJS_SUI_ASSEMBLY_ACCESS_PACKAGE_ID: "0xa",
    EVEJS_SUI_ASSEMBLY_ACCESS_TYPE_ORIGIN: "0x9",
  });
  assert.equal(accessUpgrade.accessPackageId, address(10));
  assert.equal(accessUpgrade.accessTypeOrigin, address(9));
  assert.notEqual(laterUpgrade.fingerprint, firstUpgrade.fingerprint);
  assert.equal(world.packageId, address(1));
});

test("public NPC config normalizes addresses without mutating base world or persisting credentials", t => {
  const f = fixture(t);
  f.write({ ...config(), chainId: "A1B2C3D4", worldPackageId: "0x1", packageId: "0x8", typeOrigin: "0x7" });
  const captured = structuredClone(world);
  const result = readSuiNpcWorldConfig(world, f.env);
  assert.equal(result.npcPackageId, address(8));
  assert.equal(result.npcTypeOrigin, address(7));
  assert.equal(result.accessPackageId, address(10));
  assert.equal(result.accessTypeOrigin, address(9));
  assert.deepEqual(world, captured);
  assert.deepEqual(Object.keys(result).sort(), [
    "accessPackageId", "accessTypeOrigin", "fingerprint", "npcPackageId", "npcTypeOrigin",
  ]);
  f.write(config());
  assert.equal(readSuiNpcWorldConfig(world, f.env).fingerprint, result.fingerprint);
});

test("per-field NPC environment overrides cannot mask an invalid deployment file", t => {
  const f = fixture(t);
  f.write(config());
  const env = {
    ...f.env,
    EVEJS_SUI_NPC_PACKAGE_ID: "0x9",
    EVEJS_SUI_NPC_TYPE_ORIGIN: "0x6",
    EVEJS_SUI_ASSEMBLY_ACCESS_PACKAGE_ID: "0xc",
    EVEJS_SUI_ASSEMBLY_ACCESS_TYPE_ORIGIN: "0xb",
  };
  assert.equal(readSuiNpcWorldConfig(world, env).npcPackageId, address(9));
  assert.equal(readSuiNpcWorldConfig(world, env).npcTypeOrigin, address(6));
  assert.equal(readSuiNpcWorldConfig(world, env).accessPackageId, address(12));
  assert.equal(readSuiNpcWorldConfig(world, env).accessTypeOrigin, address(11));
  assert.equal(readSuiNpcWorldConfig(world, { ...f.env, EVEJS_SUI_NPC_PACKAGE_ID: "0x9" }).npcTypeOrigin, address(7));
  for (const [key, value] of Object.entries({ packageId: "invalid", typeOrigin: "0x0" })) {
    f.write({ ...config(), [key]: value });
    assert.throws(() => readSuiNpcWorldConfig(world, env), /Sui address/);
  }
});

test("NPC config is bound to the exact base chain, world, registry and ACL", t => {
  const f = fixture(t);
  for (const [key, value] of Object.entries({
    chainId: "ffffffff", worldPackageId: address(4), objectRegistryId: address(4), adminAclId: address(4),
  })) {
    f.write({ ...config(), [key]: value });
    assert.throws(() => readSuiNpcWorldConfig(world, f.env), new RegExp(`${key} does not match`));
  }
});

test("malformed NPC config and invalid address overrides reject rather than selecting defaults", t => {
  const f = fixture(t);
  for (const raw of [null, [], {}, { ...config(), schemaVersion: 2 }, { ...config(), chainId: "invalid" }]) {
    f.write(raw);
    assert.throws(() => readSuiNpcWorldConfig(world, f.env), /NPC deployment/);
  }
  fs.writeFileSync(f.file, "{");
  assert.throws(() => readSuiNpcWorldConfig(world, f.env), /could not be read as JSON/);
  f.write(config());
  for (const key of [
    "EVEJS_SUI_NPC_PACKAGE_ID",
    "EVEJS_SUI_NPC_TYPE_ORIGIN",
    "EVEJS_SUI_ASSEMBLY_ACCESS_PACKAGE_ID",
    "EVEJS_SUI_ASSEMBLY_ACCESS_TYPE_ORIGIN",
  ]) {
    for (const value of ["not-an-address", "0x0", `0x${"a".repeat(65)}`]) {
      assert.throws(() => readSuiNpcWorldConfig(world, { ...f.env, [key]: value }), /Sui address/);
    }
  }
});

test("assembly access deployment fields must be configured as a package/origin pair", t => {
  const f = fixture(t);
  const { accessTypeOrigin: _origin, ...withoutOrigin } = config();
  f.write(withoutOrigin);
  assert.throws(() => readSuiNpcWorldConfig(world, f.env), /configured together/);
  const { accessPackageId: _package, ...withoutPackage } = config();
  f.write(withoutPackage);
  assert.throws(() => readSuiNpcWorldConfig(world, f.env), /configured together/);
});

test("an explicitly selected NPC config is required and replaces conventional sibling lookup", t => {
  const f = fixture(t);
  f.write({ ...config(), packageId: "invalid" });
  const file = path.join(f.directory, "chosen.json");
  const env = { ...f.env, EVEJS_SUI_NPC_CONFIG_PATH: file };
  assert.throws(() => readSuiNpcWorldConfig(world, env), /could not be read as JSON/);
  fs.writeFileSync(file, JSON.stringify(config()));
  assert.equal(readSuiNpcWorldConfig(world, env).npcPackageId, address(8));
});

test("NPC config snapshot rejects changes, appearance, removal and chain rotation before submission", t => {
  const f = fixture(t);
  const absent = readSuiNpcWorldConfig(world, f.env);
  f.write(config());
  assert.throws(() => assertSuiNpcWorldConfigCurrent(absent, world, f.env), /deployment changed/);
  const captured = readSuiNpcWorldConfig(world, f.env);
  assert.equal(assertSuiNpcWorldConfigCurrent(captured, world, f.env).fingerprint, captured.fingerprint);
  f.write({ ...config(), packageId: address(9) });
  assert.throws(() => assertSuiNpcWorldConfigCurrent(captured, world, f.env), /deployment changed/);
  f.write(config());
  assert.throws(() => assertSuiNpcWorldConfigCurrent(captured, world, {
    ...f.env, EVEJS_SUI_NPC_TYPE_ORIGIN: "0x6",
  }), /deployment changed/);
  fs.unlinkSync(f.file);
  assert.throws(() => assertSuiNpcWorldConfigCurrent(captured, world, f.env), /deployment changed/);
  assert.throws(() => assertSuiNpcWorldConfigCurrent(absent, { ...world, chainId: "ffffffff" }, f.env), /deployment changed/);
});
