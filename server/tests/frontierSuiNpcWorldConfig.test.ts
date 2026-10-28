import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { normalizeSuiAddress } from "@mysten/sui/utils";
import {
  readSuiNpcWorldConfig,
  assertSuiNpcWorldConfigCurrent,
  isSuiWorldCapabilityEnabled,
} from "../src/services/frontier/suiNpcWorldConfig";

const address = (n: number) => normalizeSuiAddress(`0x${n.toString(16)}`);
const world = {
  chainId: "a1b2c3d4", packageId: address(1), objectRegistryId: address(2), adminAclId: address(3),
};
const config = () => ({
  schemaVersion: 1, chainId: world.chainId, worldPackageId: world.packageId,
  objectRegistryId: world.objectRegistryId, adminAclId: world.adminAclId,
  packageId: address(8), typeOrigin: address(7), npcRegistryId: address(6),
  accessPackageId: address(10), accessTypeOrigin: address(9), accessRegistryId: address(11),
  catapultPackageId: address(12), catapultTypeOrigin: address(12), catapultRegistryId: address(13),
  industryPackageId: address(14), industryTypeOrigin: address(14), industryRegistryId: address(15),
  transponderPackageId: address(16), transponderTypeOrigin: address(16), transponderRegistryId: address(17),
});
const configV2 = () => ({
  ...config(),
  schemaVersion: 2,
  actionPackageId: address(18), actionTypeOrigin: address(18), actionRegistryId: address(19),
  industryActionsPackageId: address(20),
  industryActionsTypeOrigin: address(20),
  industryActionsRegistryId: address(21),
});
const configV3 = () => ({
  ...configV2(),
  schemaVersion: 3,
  logisticsPackageId: address(22), logisticsTypeOrigin: address(22), logisticsRegistryId: address(23),
  infrastructurePackageId: address(24), infrastructureTypeOrigin: address(24), infrastructureRegistryId: address(25),
  automationPackageId: address(26), automationTypeOrigin: address(26), automationRegistryId: address(27),
});
const worldFeatures = (capabilities: Record<string, any>, factions?: Record<string, any>) => ({
  format: "eve-frontier-world-features",
  schemaVersion: 1,
  chainId: world.chainId,
  world: {
    packageId: world.packageId,
    objectRegistryId: world.objectRegistryId,
    adminAclId: world.adminAclId,
  },
  capabilities,
  ...(factions ? { factions } : {}),
});
const capability = (packageId: string, typeOrigin: string, registryId: string) => ({
  status: "deployed",
  packageId,
  typeOrigin,
  registryId,
});

function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "npc-deployment-test-"));
  t.after(() => {
    assert.equal(path.dirname(path.resolve(directory)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(directory).startsWith("npc-deployment-test-"));
    fs.rmSync(directory, { force: true, recursive: true });
  });
  const file = path.join(directory, "npc-deployment.json");
  const featureFile = path.join(directory, "world-features.v1.json");
  const env: NodeJS.ProcessEnv = { EVEJS_SUI_WORLD_CONFIG_PATH: path.join(directory, "world.private.json") };
  return {
    directory,
    file,
    featureFile,
    env,
    write: value => fs.writeFileSync(file, JSON.stringify(value)),
    writeFeatures: value => fs.writeFileSync(featureFile, JSON.stringify(value)),
  };
}

test("fresh NPC deployments default to the original world while upgrades separate call target and type origin", t => {
  const f = fixture(t);
  const initial = readSuiNpcWorldConfig(world, f.env);
  assert.equal(initial.npcPackageId, world.packageId);
  assert.equal(initial.npcTypeOrigin, world.packageId);
  assert.equal(initial.npcRegistryId, world.objectRegistryId);
  assert.equal(initial.accessPackageId, world.packageId);
  assert.equal(initial.accessTypeOrigin, world.packageId);
  assert.equal(initial.accessRegistryId, world.objectRegistryId);
  assert.equal(initial.actionPackageId, world.packageId);
  assert.equal(initial.actionRegistryId, world.objectRegistryId);
  assert.equal(initial.logisticsPackageId, world.packageId);
  assert.equal(initial.infrastructurePackageId, world.packageId);
  assert.equal(initial.automationPackageId, world.packageId);
  assert.equal(initial.catapultPackageId, world.packageId);
  assert.equal(initial.catapultRegistryId, world.objectRegistryId);
  assert.equal(initial.transponderPackageId, world.packageId);
  assert.equal(initial.transponderRegistryId, world.objectRegistryId);
  const firstUpgrade = readSuiNpcWorldConfig(world, { ...f.env, EVEJS_SUI_NPC_PACKAGE_ID: "0x7" });
  assert.equal(firstUpgrade.npcPackageId, address(7));
  assert.equal(firstUpgrade.npcTypeOrigin, address(7));
  assert.equal(firstUpgrade.accessPackageId, world.packageId);
  assert.equal(firstUpgrade.accessTypeOrigin, world.packageId);
  const laterUpgrade = readSuiNpcWorldConfig(world, {
    ...f.env, EVEJS_SUI_NPC_PACKAGE_ID: "0x8", EVEJS_SUI_NPC_TYPE_ORIGIN: "0x7",
  });
  assert.equal(laterUpgrade.npcPackageId, address(8));
  assert.equal(laterUpgrade.npcTypeOrigin, address(7));
  assert.equal(laterUpgrade.accessPackageId, world.packageId);
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
  assert.equal(result.npcRegistryId, address(6));
  assert.equal(result.accessPackageId, address(10));
  assert.equal(result.accessTypeOrigin, address(9));
  assert.equal(result.accessRegistryId, address(11));
  assert.equal(result.actionPackageId, address(10));
  assert.equal(result.actionTypeOrigin, address(9));
  assert.equal(result.actionRegistryId, address(11));
  assert.equal(result.industryActionsPackageId, address(14));
  assert.equal(result.industryActionsTypeOrigin, address(14));
  assert.equal(result.industryActionsRegistryId, address(15));
  assert.equal(result.logisticsPackageId, address(10));
  assert.equal(result.infrastructurePackageId, address(10));
  assert.equal(result.automationPackageId, address(10));
  assert.equal(result.catapultPackageId, address(12));
  assert.equal(result.catapultRegistryId, address(13));
  assert.equal(result.transponderPackageId, address(16));
  assert.equal(result.transponderRegistryId, address(17));
  assert.deepEqual(world, captured);
  assert.deepEqual(Object.keys(result).sort(), [
    "accessPackageId", "accessRegistryId", "accessTypeOrigin",
    "actionPackageId", "actionRegistryId", "actionTypeOrigin",
    "automationPackageId", "automationRegistryId", "automationTypeOrigin",
    "capabilities",
    "catapultPackageId", "catapultRegistryId", "catapultTypeOrigin",
    "defaultFactionCapabilities",
    "factionCapabilities",
    "factionConfigReferences",
    "factionPolicies",
    "fingerprint",
    "industryActionsPackageId", "industryActionsRegistryId", "industryActionsTypeOrigin",
    "industryPackageId", "industryRegistryId", "industryTypeOrigin",
    "infrastructurePackageId", "infrastructureRegistryId", "infrastructureTypeOrigin",
    "logisticsPackageId", "logisticsRegistryId", "logisticsTypeOrigin",
    "manifestFormat",
    "npcPackageId", "npcRegistryId", "npcTypeOrigin",
    "transponderPackageId", "transponderRegistryId", "transponderTypeOrigin",
  ]);
  f.write(config());
  assert.equal(readSuiNpcWorldConfig(world, f.env).fingerprint, result.fingerprint);
});

test("schema-v3 feature bindings and overrides select all action contract groups", t => {
  const f = fixture(t);
  f.write(configV3());
  const deployed = readSuiNpcWorldConfig(world, f.env);
  assert.equal(deployed.logisticsPackageId, address(22));
  assert.equal(deployed.logisticsRegistryId, address(23));
  assert.equal(deployed.infrastructurePackageId, address(24));
  assert.equal(deployed.infrastructureRegistryId, address(25));
  assert.equal(deployed.automationPackageId, address(26));
  assert.equal(deployed.automationRegistryId, address(27));
  const overridden = readSuiNpcWorldConfig(world, {
    ...f.env,
    EVEJS_SUI_LOGISTICS_ACTIONS_PACKAGE_ID: "0x1c",
    EVEJS_SUI_LOGISTICS_ACTIONS_TYPE_ORIGIN: "0x16",
    EVEJS_SUI_LOGISTICS_ACTIONS_REGISTRY_ID: "0x1d",
    EVEJS_SUI_INFRASTRUCTURE_ACTIONS_PACKAGE_ID: "0x1e",
    EVEJS_SUI_INFRASTRUCTURE_ACTIONS_TYPE_ORIGIN: "0x18",
    EVEJS_SUI_INFRASTRUCTURE_ACTIONS_REGISTRY_ID: "0x1f",
    EVEJS_SUI_AUTOMATION_PACKAGE_ID: "0x20",
    EVEJS_SUI_AUTOMATION_TYPE_ORIGIN: "0x1a",
    EVEJS_SUI_AUTOMATION_REGISTRY_ID: "0x21",
  });
  assert.equal(overridden.logisticsPackageId, address(28));
  assert.equal(overridden.logisticsRegistryId, address(29));
  assert.equal(overridden.infrastructurePackageId, address(30));
  assert.equal(overridden.infrastructureRegistryId, address(31));
  assert.equal(overridden.automationPackageId, address(32));
  assert.equal(overridden.automationRegistryId, address(33));
});

test("schema-v2 feature bindings and per-field overrides select the canonical action packages", t => {
  const f = fixture(t);
  f.write(configV2());
  const deployed = readSuiNpcWorldConfig(world, f.env);
  assert.equal(deployed.actionPackageId, address(18));
  assert.equal(deployed.actionTypeOrigin, address(18));
  assert.equal(deployed.actionRegistryId, address(19));
  assert.equal(deployed.industryActionsPackageId, address(20));
  assert.equal(deployed.industryActionsRegistryId, address(21));
  const overridden = readSuiNpcWorldConfig(world, {
    ...f.env,
    EVEJS_SUI_ACTION_QUEUE_PACKAGE_ID: "0x16",
    EVEJS_SUI_ACTION_QUEUE_TYPE_ORIGIN: "0x12",
    EVEJS_SUI_ACTION_QUEUE_REGISTRY_ID: "0x17",
    EVEJS_SUI_INDUSTRY_ACTIONS_PACKAGE_ID: "0x18",
    EVEJS_SUI_INDUSTRY_ACTIONS_TYPE_ORIGIN: "0x14",
    EVEJS_SUI_INDUSTRY_ACTIONS_REGISTRY_ID: "0x19",
  });
  assert.equal(overridden.actionPackageId, address(22));
  assert.equal(overridden.actionRegistryId, address(23));
  assert.equal(overridden.industryActionsPackageId, address(24));
  assert.equal(overridden.industryActionsRegistryId, address(25));
});

test("per-field NPC environment overrides cannot mask an invalid deployment file", t => {
  const f = fixture(t);
  f.write(config());
  const env = {
    ...f.env,
    EVEJS_SUI_NPC_PACKAGE_ID: "0x9",
    EVEJS_SUI_NPC_TYPE_ORIGIN: "0x6",
    EVEJS_SUI_NPC_REGISTRY_ID: "0x5",
    EVEJS_SUI_ASSEMBLY_ACCESS_PACKAGE_ID: "0xc",
    EVEJS_SUI_ASSEMBLY_ACCESS_TYPE_ORIGIN: "0xb",
    EVEJS_SUI_ASSEMBLY_ACCESS_REGISTRY_ID: "0xa",
  };
  assert.equal(readSuiNpcWorldConfig(world, env).npcPackageId, address(9));
  assert.equal(readSuiNpcWorldConfig(world, env).npcTypeOrigin, address(6));
  assert.equal(readSuiNpcWorldConfig(world, env).npcRegistryId, address(5));
  assert.equal(readSuiNpcWorldConfig(world, env).accessPackageId, address(12));
  assert.equal(readSuiNpcWorldConfig(world, env).accessTypeOrigin, address(11));
  assert.equal(readSuiNpcWorldConfig(world, env).accessRegistryId, address(10));
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
  for (const raw of [null, [], {}, { ...config(), schemaVersion: 4 }, { ...config(), chainId: "invalid" }]) {
    f.write(raw);
    assert.throws(() => readSuiNpcWorldConfig(world, f.env), /deployment/);
  }
  fs.writeFileSync(f.file, "{");
  assert.throws(() => readSuiNpcWorldConfig(world, f.env), /could not be read as JSON/);
  f.write(config());
  for (const key of [
    "EVEJS_SUI_NPC_PACKAGE_ID",
    "EVEJS_SUI_NPC_TYPE_ORIGIN",
    "EVEJS_SUI_NPC_REGISTRY_ID",
    "EVEJS_SUI_ASSEMBLY_ACCESS_PACKAGE_ID",
    "EVEJS_SUI_ASSEMBLY_ACCESS_TYPE_ORIGIN",
    "EVEJS_SUI_ASSEMBLY_ACCESS_REGISTRY_ID",
    "EVEJS_SUI_CATAPULT_PACKAGE_ID",
    "EVEJS_SUI_CATAPULT_TYPE_ORIGIN",
    "EVEJS_SUI_CATAPULT_REGISTRY_ID",
    "EVEJS_SUI_TRANSPONDER_PACKAGE_ID",
    "EVEJS_SUI_TRANSPONDER_TYPE_ORIGIN",
    "EVEJS_SUI_TRANSPONDER_REGISTRY_ID",
    "EVEJS_SUI_ACTION_QUEUE_PACKAGE_ID",
    "EVEJS_SUI_ACTION_QUEUE_TYPE_ORIGIN",
    "EVEJS_SUI_ACTION_QUEUE_REGISTRY_ID",
    "EVEJS_SUI_INDUSTRY_ACTIONS_PACKAGE_ID",
    "EVEJS_SUI_INDUSTRY_ACTIONS_TYPE_ORIGIN",
    "EVEJS_SUI_INDUSTRY_ACTIONS_REGISTRY_ID",
    "EVEJS_SUI_LOGISTICS_ACTIONS_PACKAGE_ID",
    "EVEJS_SUI_LOGISTICS_ACTIONS_TYPE_ORIGIN",
    "EVEJS_SUI_LOGISTICS_ACTIONS_REGISTRY_ID",
    "EVEJS_SUI_INFRASTRUCTURE_ACTIONS_PACKAGE_ID",
    "EVEJS_SUI_INFRASTRUCTURE_ACTIONS_TYPE_ORIGIN",
    "EVEJS_SUI_INFRASTRUCTURE_ACTIONS_REGISTRY_ID",
    "EVEJS_SUI_AUTOMATION_PACKAGE_ID",
    "EVEJS_SUI_AUTOMATION_TYPE_ORIGIN",
    "EVEJS_SUI_AUTOMATION_REGISTRY_ID",
  ]) {
    for (const value of ["not-an-address", "0x0", `0x${"a".repeat(65)}`]) {
      assert.throws(() => readSuiNpcWorldConfig(world, { ...f.env, [key]: value }), /Sui address/);
    }
  }
});

test("versioned world features allow partial deployments and faction capability splits", t => {
  const f = fixture(t);
  f.write({ ...config(), packageId: "invalid" });
  f.writeFeatures(worldFeatures({
    npc: capability(address(8), address(7), address(6)),
    transponder: capability(address(16), address(16), address(17)),
  }, {
    "500001-caldari": { capabilities: ["npc", "transponder"] },
    "500010-guristas": { capabilities: ["npc"] },
  }));

  const result = readSuiNpcWorldConfig(world, f.env);
  assert.equal(result.manifestFormat, "world-features-v1");
  assert.equal(result.npcPackageId, address(8));
  assert.equal(result.capabilities.npc.status, "deployed");
  assert.equal(result.capabilities.transponder.status, "deployed");
  assert.equal(result.capabilities.assemblyAccess.status, "unavailable");
  assert.equal(result.accessPackageId, world.packageId);
  assert.equal(isSuiWorldCapabilityEnabled(result, "transponder", "500001-caldari"), true);
  assert.equal(isSuiWorldCapabilityEnabled(result, "transponder", "500010-guristas"), false);
  assert.equal(isSuiWorldCapabilityEnabled(result, "assemblyAccess"), false);
});

test("split faction files inherit an explicit default fallback", t => {
  const f = fixture(t);
  const factionDirectory = path.join(f.directory, "factions");
  fs.mkdirSync(factionDirectory);
  fs.writeFileSync(path.join(factionDirectory, "default.v1.json"), JSON.stringify({
    format: "eve-frontier-faction-features", schemaVersion: 1,
    configId: "default", capabilities: ["npc", "transponder"],
  }));
  fs.writeFileSync(path.join(factionDirectory, "500001-caldari.v1.json"), JSON.stringify({
    format: "eve-frontier-faction-features", schemaVersion: 2,
    factionKey: "500001-caldari", fallback: "default",
    transponderCode: "CALDARI",
    startingRegion: { regionID: 10000005, solarSystemIDs: [30000052] },
    membership: {
      includedTypeIDs: [101], excludedTypeIDs: [],
      typeListProfiles: [{
        profileID: "npc-profiles-by-faction", source: "npcProfiles", match: "factionIdentity",
      }],
    },
    diplomacy: {
      allies: [], enemies: [{ factionKey: "500010-guristas", transponderCode: "GURISTAS" }],
    },
    leadership: [
      { characterID: "90000001", characterType: "npc" },
      { characterID: "42", characterType: "player" },
    ],
    commanders: [],
  }));
  fs.writeFileSync(path.join(factionDirectory, "500010-guristas.v1.json"), JSON.stringify({
    format: "eve-frontier-faction-features", schemaVersion: 2,
    factionKey: "500010-guristas", fallback: "default", capabilities: ["npc"],
    transponderCode: "GURISTAS",
    diplomacy: {
      allies: [], enemies: [{ factionKey: "500001-caldari", transponderCode: "CALDARI" }],
    },
  }));
  f.writeFeatures({
    ...worldFeatures({
      npc: capability(address(8), address(7), address(6)),
      transponder: capability(address(16), address(16), address(17)),
    }),
    factionConfig: {
      default: { id: "default", path: "factions/default.v1.json" },
      factions: {
        "500001-caldari": {
          path: "factions/500001-caldari.v1.json", fallback: "default",
        },
        "500010-guristas": {
          path: "factions/500010-guristas.v1.json", fallback: "default",
        },
      },
    },
  });
  const result = readSuiNpcWorldConfig(world, f.env);
  assert.deepEqual(result.defaultFactionCapabilities, ["npc", "transponder"]);
  assert.deepEqual(result.factionCapabilities["500001-caldari"], ["npc", "transponder"]);
  assert.deepEqual(result.factionCapabilities["500010-guristas"], ["npc"]);
  assert.equal(isSuiWorldCapabilityEnabled(result, "transponder", "500001-caldari"), true);
  assert.equal(isSuiWorldCapabilityEnabled(result, "transponder", "500010-guristas"), false);
  assert.equal(isSuiWorldCapabilityEnabled(result, "transponder", "500099-unknown"), true);
  assert.deepEqual(result.factionConfigReferences["500001-caldari"], {
    path: "factions/500001-caldari.v1.json", fallback: "default",
  });
  assert.deepEqual(result.factionPolicies["500001-caldari"].membership.includedTypeIDs, [101]);
  assert.deepEqual(result.factionPolicies["500001-caldari"].startingRegion, {
    regionID: 10000005, solarSystemIDs: [30000052],
  });
  assert.deepEqual(result.factionPolicies["500010-guristas"].startingRegion, {
    regionID: null, solarSystemIDs: [],
  });
  assert.deepEqual(result.factionPolicies["500001-caldari"].leadership, [
    { characterID: "90000001", characterType: "npc" },
    { characterID: "42", characterType: "player" },
  ]);
  assert.equal(
    result.factionPolicies["500001-caldari"].diplomacy.enemies[0].transponderCode,
    "GURISTAS",
  );
  fs.writeFileSync(path.join(factionDirectory, "500010-guristas.v1.json"), JSON.stringify({
    format: "eve-frontier-faction-features", schemaVersion: 2,
    factionKey: "500010-guristas", fallback: "default", capabilities: ["npc"],
    transponderCode: "ROTATED-GURISTAS",
    diplomacy: {
      allies: [], enemies: [{ factionKey: "500001-caldari", transponderCode: "CALDARI" }],
    },
  }));
  assert.throws(() => readSuiNpcWorldConfig(world, f.env), /stale transponder code/);
  fs.writeFileSync(path.join(factionDirectory, "500010-guristas.v1.json"), JSON.stringify({
    format: "eve-frontier-faction-features", schemaVersion: 2,
    factionKey: "500010-guristas", fallback: "default", capabilities: ["npc"],
    transponderCode: "GURISTAS",
    diplomacy: {
      allies: [], enemies: [{ factionKey: "500001-caldari", transponderCode: "CALDARI" }],
    },
  }));
  fs.writeFileSync(path.join(factionDirectory, "default.v1.json"), JSON.stringify({
    format: "eve-frontier-faction-features", schemaVersion: 1,
    configId: "default", capabilities: ["npc"],
  }));
  assert.throws(
    () => assertSuiNpcWorldConfigCurrent(result, world, f.env),
    /deployment changed/,
  );
});

test("versioned manifest rejects faction references to undeployed capabilities", t => {
  const f = fixture(t);
  f.writeFeatures(worldFeatures({
    npc: capability(address(8), address(7), address(6)),
  }, {
    "500001-caldari": { capabilities: ["npc", "transponder"] },
  }));
  assert.throws(
    () => readSuiNpcWorldConfig(world, f.env),
    /enables unavailable capability transponder/,
  );
  f.writeFeatures(worldFeatures({
    npc: capability(address(8), address(7), address(6)),
    typoCapability: capability(address(9), address(9), address(9)),
  }));
  assert.throws(
    () => readSuiNpcWorldConfig(world, f.env),
    /unknown capability typoCapability/,
  );
});

test("feature deployment registries are required with their packages", t => {
  const f = fixture(t);
  for (const key of ["npcRegistryId", "accessRegistryId", "catapultRegistryId", "transponderRegistryId"]) {
    const value = config();
    delete value[key];
    f.write(value);
    assert.throws(() => readSuiNpcWorldConfig(world, f.env), /Sui address/);
  }
});

test("schema-v2 action registries are required with their packages", t => {
  const f = fixture(t);
  for (const key of ["actionRegistryId", "industryActionsRegistryId"]) {
    const value = configV2();
    delete value[key];
    f.write(value);
    assert.throws(() => readSuiNpcWorldConfig(world, f.env), /Sui address/);
  }
});

test("schema-v3 action registries are required with their packages", t => {
  const f = fixture(t);
  for (const key of ["logisticsRegistryId", "infrastructureRegistryId", "automationRegistryId"]) {
    const value = configV3();
    delete value[key];
    f.write(value);
    assert.throws(() => readSuiNpcWorldConfig(world, f.env), /Sui address/);
  }
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
