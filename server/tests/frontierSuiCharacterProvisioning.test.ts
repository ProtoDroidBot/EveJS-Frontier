import assert = require("node:assert/strict");
import { createHash } from "node:crypto";
import fs = require("node:fs");
import os = require("node:os");
import path = require("node:path");
import { test } from "node:test";

import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { TransactionDataBuilder } from "@mysten/sui/transactions";

import {
  SUI_CHARACTER_ADMIN_ACL_ID,
  SUI_CHARACTER_OBJECT_REGISTRY_ID,
  SUI_CHARACTER_WORLD_PACKAGE_ID,
  SuiCharacterProvisioningError,
  createSuiCharacterTransaction,
  deriveLocalPlayerSuiWalletAddress,
  deriveSuiCharacterObjectId,
  prepareSuiCharacterIdentity,
  provisionSuiCharacter,
  readSyncedSuiWorldConfig,
  resolveAdminSigner,
  resolveSuiCharacterWorld,
} from "../src/services/frontier/suiCharacterProvisioning";

const PLAYER_PROFILE_ID =
  "0xf3c1cf351092c2d12d8675650f1e1d15ad2569c7fcbd14ecb0f92a69996bf0e7";

test("human Character provisioning rejects the reserved NPC pilot namespace", () => {
  for (const gameCharacterId of [1500000000, 1555555555, 1599999999]) {
    assert.throws(() => prepareSuiCharacterIdentity({ accountId: 1, gameCharacterId, characterName: "Not a human" }, { env: {} }),
      (error: any) => error.code === "NPC_CHARACTER_NOT_PLAYER");
  }
  assert.equal(prepareSuiCharacterIdentity({ accountId: 1, gameCharacterId: 140000001, characterName: "Human" }, { env: {} }).gameCharacterId, 140000001);
});

const SYNCED_PACKAGE_ID = `0x${"1".repeat(64)}`;
const SYNCED_OBJECT_REGISTRY_ID = `0x${"2".repeat(64)}`;
const SYNCED_ADMIN_ACL_ID = `0x${"3".repeat(64)}`;
const ENV_PACKAGE_ID = `0x${"4".repeat(64)}`;
const ENV_OBJECT_REGISTRY_ID = `0x${"5".repeat(64)}`;
const ENV_ADMIN_ACL_ID = `0x${"6".repeat(64)}`;
const OVERRIDE_PACKAGE_ID = `0x${"7".repeat(64)}`;
const OVERRIDE_OBJECT_REGISTRY_ID = `0x${"8".repeat(64)}`;
const OVERRIDE_ADMIN_ACL_ID = `0x${"9".repeat(64)}`;

function signerFixture(fill: number): Ed25519Keypair {
  return Ed25519Keypair.fromSecretKey(new Uint8Array(32).fill(fill));
}

const SYNCED_ADMIN_SIGNER = signerFixture(1);
const ENV_ADMIN_SIGNER = signerFixture(2);
const OVERRIDE_ADMIN_SIGNER = signerFixture(3);
const UPDATED_ADMIN_SIGNER = signerFixture(4);

function syncedWorldConfig(overrides: Record<string, any> = {}): Record<string, any> {
  return {
    format: "evejs-frontier-world-sync-v1",
    schemaVersion: 1,
    state: "ready",
    build: 3502403,
    network: "localnet",
    chainId: "a1b2c3d4",
    world: {
      packageId: SYNCED_PACKAGE_ID,
      objectRegistryId: SYNCED_OBJECT_REGISTRY_ID,
      adminAclId: SYNCED_ADMIN_ACL_ID,
    },
    adminPrivateKey: SYNCED_ADMIN_SIGNER.getSecretKey(),
    ...overrides,
  };
}

function createSyncedWorldFixture(t: any): {
  configPath: string;
  env: NodeJS.ProcessEnv;
} {
  const fixtureDirectory = fs.mkdtempSync(
    path.join(os.tmpdir(), "evejs-sui-world-config-"),
  );
  t.after(() => fs.rmSync(fixtureDirectory, { force: true, recursive: true }));
  const configPath = path.join(fixtureDirectory, "world.private.json");
  return {
    configPath,
    env: {
      EVEJS_CLIENT_BUILD: "3502403",
      EVEJS_SUI_WORLD_CONFIG_PATH: configPath,
    },
  };
}

function writeSyncedWorldConfig(
  configPath: string,
  value: Record<string, any>,
): void {
  fs.writeFileSync(configPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function successfulTransactionResult(
  identity: Record<string, any>,
  digest: string,
): Record<string, any> {
  return {
    $kind: "Transaction",
    Transaction: {
      digest,
      status: { success: true, error: null },
      objectTypes: {
        [identity.characterObjectId]: `${identity.packageId}::character::Character`,
        [PLAYER_PROFILE_ID]: `${identity.packageId}::character::PlayerProfile`,
      },
      effects: {
        changedObjects: [
          {
            objectId: identity.characterObjectId,
            idOperation: "Created",
            outputOwner: {
              $kind: "Shared",
              Shared: { initialSharedVersion: "1" },
            },
          },
          {
            objectId: PLAYER_PROFILE_ID,
            idOperation: "Created",
            outputOwner: {
              $kind: "AddressOwner",
              AddressOwner: identity.walletAddress,
            },
          },
        ],
      },
    },
  };
}

test("Frontier consumes a validated private world-sync config", (t) => {
  const { configPath, env } = createSyncedWorldFixture(t);
  writeSyncedWorldConfig(configPath, syncedWorldConfig());

  assert.deepEqual(readSyncedSuiWorldConfig(env), {
    path: configPath,
    build: 3502403,
    network: "localnet",
    chainId: "a1b2c3d4",
    packageId: SYNCED_PACKAGE_ID,
    objectRegistryId: SYNCED_OBJECT_REGISTRY_ID,
    adminAclId: SYNCED_ADMIN_ACL_ID,
    adminPrivateKey: SYNCED_ADMIN_SIGNER.getSecretKey(),
  });
  assert.deepEqual(resolveSuiCharacterWorld({}, env), {
    packageId: SYNCED_PACKAGE_ID,
    objectRegistryId: SYNCED_OBJECT_REGISTRY_ID,
    adminAclId: SYNCED_ADMIN_ACL_ID,
    tenant: "dev",
    tribeId: 100,
  });
  assert.equal(
    resolveAdminSigner({ env }).toSuiAddress(),
    SYNCED_ADMIN_SIGNER.toSuiAddress(),
  );
});

test("Frontier rejects stale or malformed private world-sync configs", (t) => {
  const { configPath, env } = createSyncedWorldFixture(t);
  const invalidConfigs: Array<[string, Record<string, any>]> = [
    ["format", syncedWorldConfig({ format: "another-format" })],
    ["schema version", syncedWorldConfig({ schemaVersion: "1" })],
    ["state", syncedWorldConfig({ state: "starting" })],
    ["build", syncedWorldConfig({ build: 3502402 })],
    ["network", syncedWorldConfig({ network: "testnet" })],
    ["chain ID", syncedWorldConfig({ chainId: "not-a-chain" })],
    [
      "package ID",
      syncedWorldConfig({
        world: {
          packageId: "0x1",
          objectRegistryId: SYNCED_OBJECT_REGISTRY_ID,
          adminAclId: SYNCED_ADMIN_ACL_ID,
        },
      }),
    ],
    [
      "ObjectRegistry ID",
      syncedWorldConfig({
        world: {
          packageId: SYNCED_PACKAGE_ID,
          objectRegistryId: `0x${"A".repeat(64)}`,
          adminAclId: SYNCED_ADMIN_ACL_ID,
        },
      }),
    ],
    [
      "AdminACL ID",
      syncedWorldConfig({
        world: {
          packageId: SYNCED_PACKAGE_ID,
          objectRegistryId: SYNCED_OBJECT_REGISTRY_ID,
          adminAclId: "not-an-address",
        },
      }),
    ],
    ["admin private key", syncedWorldConfig({ adminPrivateKey: "   " })],
    [
      "encoded admin private key",
      syncedWorldConfig({ adminPrivateKey: "suiprivkey1not-valid" }),
    ],
  ];

  for (const [label, value] of invalidConfigs) {
    writeSyncedWorldConfig(configPath, value);
    assert.throws(
      () => readSyncedSuiWorldConfig(env),
      SuiCharacterProvisioningError,
      label,
    );
  }

  fs.writeFileSync(configPath, "{not-json", "utf8");
  assert.throws(
    () => readSyncedSuiWorldConfig(env),
    SuiCharacterProvisioningError,
    "JSON",
  );
  writeSyncedWorldConfig(configPath, syncedWorldConfig());
  assert.throws(
    () => readSyncedSuiWorldConfig({ EVEJS_SUI_WORLD_CONFIG_PATH: configPath }),
    SuiCharacterProvisioningError,
    "missing EVEJS_CLIENT_BUILD",
  );
});

test("Frontier rejects a world-sync config after its deployment artifacts change", (t) => {
  const { configPath, env } = createSyncedWorldFixture(t);
  const sourceWorkspace = path.join(path.dirname(configPath), "source");
  const deploymentPath = path.join(
    sourceWorkspace,
    "world-contracts",
    "deployments",
    "localnet",
    "extracted-object-ids.json",
  );
  const publicationPath = path.join(
    sourceWorkspace,
    "world-contracts",
    "contracts",
    "world",
    "Pub.localnet.toml",
  );
  const deployment = '{"world":"first"}\n';
  const publication = 'published-at = "first"\n';
  fs.mkdirSync(path.dirname(deploymentPath), { recursive: true });
  fs.mkdirSync(path.dirname(publicationPath), { recursive: true });
  fs.writeFileSync(deploymentPath, deployment, "utf8");
  fs.writeFileSync(publicationPath, publication, "utf8");
  writeSyncedWorldConfig(
    configPath,
    syncedWorldConfig({
      sourceWorkspace,
      artifacts: {
        deploymentSha256: sha256(deployment),
        publicationSha256: sha256(publication),
      },
    }),
  );

  const current = readSyncedSuiWorldConfig(env);
  assert.equal(current?.sourceWorkspace, path.resolve(sourceWorkspace));
  assert.equal(current?.deploymentSha256, sha256(deployment));

  fs.writeFileSync(deploymentPath, '{"world":"second"}\n', "utf8");
  assert.throws(
    () => readSyncedSuiWorldConfig(env),
    (error: any) =>
      error instanceof SuiCharacterProvisioningError &&
      error.code === "INVALID_WORLD_CONFIGURATION" &&
      /stale.*FrontierWorld\.ps1 sync/i.test(error.message),
  );
});

test("Frontier reads the synchronized assembly energy manifest and rejects stale balance data", (t) => {
  const { configPath, env } = createSyncedWorldFixture(t);
  const sourceWorkspace = path.join(path.dirname(configPath), "source");
  const contracts = path.join(sourceWorkspace, "world-contracts");
  const deploymentPath = path.join(contracts, "deployments", "localnet", "extracted-object-ids.json");
  const publicationPath = path.join(contracts, "contracts", "world", "Pub.localnet.toml");
  const energyPath = path.join(contracts, "config", "assembly-energy.json");
  const deployment = "{}\n";
  const publication = "published-at = \"test\"\n";
  const energy = `${JSON.stringify({ schemaVersion: 1, clientBuild: 3502403,
    assemblies: [{ typeID: 77917, name: "Heavy Storage", energyRequired: 500 }] })}\n`;
  for (const file of [deploymentPath, publicationPath, energyPath]) fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(deploymentPath, deployment);
  fs.writeFileSync(publicationPath, publication);
  fs.writeFileSync(energyPath, energy);
  writeSyncedWorldConfig(configPath, syncedWorldConfig({
    sourceWorkspace,
    assemblyEnergy: { schemaVersion: 1, clientBuild: 3502403,
      entries: [{ typeID: 77917, energyRequired: 500 }] },
    artifacts: {
      deploymentSha256: sha256(deployment),
      publicationSha256: sha256(publication),
      assemblyEnergySha256: sha256(energy),
    },
  }));

  const current = readSyncedSuiWorldConfig(env);
  assert.deepEqual(current?.assemblyEnergy, [{ typeID: 77917, energyRequired: 500 }]);
  assert.equal(current?.assemblyEnergySha256, sha256(energy));
  fs.writeFileSync(energyPath, energy.replace("500", "501"));
  assert.throws(() => readSyncedSuiWorldConfig(env), /stale.*assembly energy manifest/i);
});

test("Frontier rejects a synchronized world from a different live chain before submission", async (t) => {
  const { configPath, env } = createSyncedWorldFixture(t);
  writeSyncedWorldConfig(configPath, syncedWorldConfig());
  let characterLookups = 0;
  let submissions = 0;
  const client = {
    async getChainIdentifier() {
      return { chainIdentifier: "deadbeef" };
    },
    async getObject() {
      characterLookups += 1;
      throw { reason: "notFound" };
    },
    async listOwnedObjects() {
      return { objects: [], hasNextPage: false, cursor: null };
    },
    async signAndExecuteTransaction() {
      submissions += 1;
      throw new Error("must not submit against a stale chain");
    },
  };

  await assert.rejects(
    provisionSuiCharacter(
      { accountId: 1, gameCharacterId: 90000002, characterName: "Stale Chain" },
      { client, env },
    ),
    (error: any) =>
      error instanceof SuiCharacterProvisioningError &&
      error.code === "WORLD_CHAIN_MISMATCH" &&
      error.ambiguous === false,
  );
  assert.equal(characterLookups, 0);
  assert.equal(submissions, 0);
});

test("Frontier rejects missing synchronized world objects before character lookup", async () => {
  const identity = prepareSuiCharacterIdentity({
    accountId: 2,
    gameCharacterId: 90000003,
    characterName: "Missing World",
  });
  let characterLookups = 0;
  let submissions = 0;
  const missingPackage = Object.assign(
    new Error(`Object ${identity.packageId} not found`),
    { code: "NOT_FOUND" },
  );
  const client = {
    async getObjects() {
      return { objects: [missingPackage] };
    },
    async getObject() {
      characterLookups += 1;
      throw { reason: "notFound" };
    },
    async listOwnedObjects() {
      return { objects: [], hasNextPage: false, cursor: null };
    },
    async signAndExecuteTransaction() {
      submissions += 1;
      throw new Error("must not submit with missing world objects");
    },
  };

  await assert.rejects(
    provisionSuiCharacter(
      {
        accountId: identity.accountId,
        gameCharacterId: identity.gameCharacterId,
        characterName: identity.characterName,
        identity,
      },
      { client, adminSigner: {} },
    ),
    (error: any) =>
      error instanceof SuiCharacterProvisioningError &&
      error.code === "WORLD_CONFIGURATION_STALE" &&
      error.ambiguous === false,
  );
  assert.equal(characterLookups, 0);
  assert.equal(submissions, 0);
});

test("Frontier gives explicit and environment Sui settings precedence over synced values", (t) => {
  const { configPath, env } = createSyncedWorldFixture(t);
  writeSyncedWorldConfig(configPath, syncedWorldConfig());
  Object.assign(env, {
    EVEJS_SUI_WORLD_PACKAGE_ID: ENV_PACKAGE_ID,
    EVEJS_SUI_OBJECT_REGISTRY_ID: ENV_OBJECT_REGISTRY_ID,
    EVEJS_SUI_ADMIN_ACL_ID: ENV_ADMIN_ACL_ID,
    EVEJS_SUI_ADMIN_PRIVATE_KEY: ENV_ADMIN_SIGNER.getSecretKey(),
  });

  assert.deepEqual(resolveSuiCharacterWorld({}, env), {
    packageId: ENV_PACKAGE_ID,
    objectRegistryId: ENV_OBJECT_REGISTRY_ID,
    adminAclId: ENV_ADMIN_ACL_ID,
    tenant: "dev",
    tribeId: 100,
  });
  assert.deepEqual(
    resolveSuiCharacterWorld(
      {
        packageId: OVERRIDE_PACKAGE_ID,
        objectRegistryId: OVERRIDE_OBJECT_REGISTRY_ID,
        adminAclId: OVERRIDE_ADMIN_ACL_ID,
      },
      env,
    ),
    {
      packageId: OVERRIDE_PACKAGE_ID,
      objectRegistryId: OVERRIDE_OBJECT_REGISTRY_ID,
      adminAclId: OVERRIDE_ADMIN_ACL_ID,
      tenant: "dev",
      tribeId: 100,
    },
  );
  assert.equal(
    resolveAdminSigner({ env }).toSuiAddress(),
    ENV_ADMIN_SIGNER.toSuiAddress(),
  );
  assert.equal(
    resolveAdminSigner({
      env,
      adminPrivateKey: OVERRIDE_ADMIN_SIGNER.getSecretKey(),
    }).toSuiAddress(),
    OVERRIDE_ADMIN_SIGNER.toSuiAddress(),
  );
});

test("Frontier skips an inactive sync file when complete higher-priority Sui settings exist", (t) => {
  const { configPath, env } = createSyncedWorldFixture(t);
  writeSyncedWorldConfig(configPath, syncedWorldConfig({ state: "down" }));
  assert.throws(
    () => readSyncedSuiWorldConfig(env),
    SuiCharacterProvisioningError,
  );

  assert.deepEqual(
    resolveSuiCharacterWorld(
      {
        packageId: OVERRIDE_PACKAGE_ID,
        objectRegistryId: OVERRIDE_OBJECT_REGISTRY_ID,
        adminAclId: OVERRIDE_ADMIN_ACL_ID,
      },
      env,
    ),
    {
      packageId: OVERRIDE_PACKAGE_ID,
      objectRegistryId: OVERRIDE_OBJECT_REGISTRY_ID,
      adminAclId: OVERRIDE_ADMIN_ACL_ID,
      tenant: "dev",
      tribeId: 100,
    },
  );
  assert.equal(
    resolveAdminSigner({
      env,
      adminPrivateKey: OVERRIDE_ADMIN_SIGNER.getSecretKey(),
    }).toSuiAddress(),
    OVERRIDE_ADMIN_SIGNER.toSuiAddress(),
  );

  Object.assign(env, {
    EVEJS_SUI_WORLD_PACKAGE_ID: ENV_PACKAGE_ID,
    EVEJS_SUI_OBJECT_REGISTRY_ID: ENV_OBJECT_REGISTRY_ID,
    EVEJS_SUI_ADMIN_ACL_ID: ENV_ADMIN_ACL_ID,
    EVEJS_SUI_ADMIN_PRIVATE_KEY: ENV_ADMIN_SIGNER.getSecretKey(),
  });
  assert.deepEqual(resolveSuiCharacterWorld({}, env), {
    packageId: ENV_PACKAGE_ID,
    objectRegistryId: ENV_OBJECT_REGISTRY_ID,
    adminAclId: ENV_ADMIN_ACL_ID,
    tenant: "dev",
    tribeId: 100,
  });
  assert.equal(
    resolveAdminSigner({ env }).toSuiAddress(),
    ENV_ADMIN_SIGNER.toSuiAddress(),
  );
});

test("Frontier re-reads the private world-sync config for every resolution", (t) => {
  const { configPath, env } = createSyncedWorldFixture(t);
  writeSyncedWorldConfig(configPath, syncedWorldConfig());
  assert.equal(resolveSuiCharacterWorld({}, env).packageId, SYNCED_PACKAGE_ID);

  const updatedConfig = syncedWorldConfig({
    world: {
      packageId: ENV_PACKAGE_ID,
      objectRegistryId: ENV_OBJECT_REGISTRY_ID,
      adminAclId: ENV_ADMIN_ACL_ID,
    },
    adminPrivateKey: UPDATED_ADMIN_SIGNER.getSecretKey(),
  });
  writeSyncedWorldConfig(configPath, updatedConfig);
  assert.deepEqual(resolveSuiCharacterWorld({}, env), {
    packageId: ENV_PACKAGE_ID,
    objectRegistryId: ENV_OBJECT_REGISTRY_ID,
    adminAclId: ENV_ADMIN_ACL_ID,
    tenant: "dev",
    tribeId: 100,
  });

  writeSyncedWorldConfig(configPath, syncedWorldConfig());
  assert.equal(
    resolveAdminSigner({ env }).toSuiAddress(),
    SYNCED_ADMIN_SIGNER.toSuiAddress(),
  );
  writeSyncedWorldConfig(configPath, updatedConfig);
  assert.equal(
    resolveAdminSigner({ env }).toSuiAddress(),
    UPDATED_ADMIN_SIGNER.toSuiAddress(),
  );
});

test("Frontier aborts submission when the synchronized world changes during precheck", async (t) => {
  const { configPath, env } = createSyncedWorldFixture(t);
  writeSyncedWorldConfig(configPath, syncedWorldConfig());
  let submissionCount = 0;
  const client = {
    async getObject() {
      writeSyncedWorldConfig(
        configPath,
        syncedWorldConfig({ chainId: "deadbeef" }),
      );
      const missing: any = new Error("not found");
      missing.reason = "notFound";
      throw missing;
    },
    async listOwnedObjects() {
      return { objects: [], hasNextPage: false, cursor: null };
    },
    async signAndExecuteTransaction() {
      submissionCount++;
      throw new Error("must not submit with a stale world snapshot");
    },
  };

  await assert.rejects(
    provisionSuiCharacter(
      { accountId: 1, gameCharacterId: 90000001, characterName: "Snapshot" },
      { client, env, reconciliationDelaysMs: [] },
    ),
    (error: any) =>
      error instanceof SuiCharacterProvisioningError &&
      error.code === "WORLD_CONFIGURATION_CHANGED",
  );
  assert.equal(submissionCount, 0);
});

test("Frontier derives the same local-dev Sui wallet and Character ID as build 3502403", () => {
  assert.equal(
    deriveLocalPlayerSuiWalletAddress(1, "DEV"),
    "0x786226640f1e42da610b44007600b31a494346d39c7be1d58e3ac989e0a49ce6",
  );
  assert.equal(
    deriveSuiCharacterObjectId(
      SUI_CHARACTER_OBJECT_REGISTRY_ID,
      811880,
      SUI_CHARACTER_WORLD_PACKAGE_ID,
      "dev",
    ),
    "0x0bc82b6fb8f371ff784bc101322e3ca0f97034a8f5286d249257032544294b47",
  );
});

test("Frontier builds the deployed world package create/share Character transaction", () => {
  const identity = prepareSuiCharacterIdentity({
    accountId: 1,
    gameCharacterId: 140000001,
    characterName: "Sui Transaction Test",
  });
  const transaction = createSuiCharacterTransaction(identity);
  const data = transaction.getData();

  assert.equal(data.commands.length, 2);
  assert.deepEqual(
    data.commands.map((command: any) => ({
      package: command.MoveCall.package,
      module: command.MoveCall.module,
      function: command.MoveCall.function,
    })),
    [
      {
        package: SUI_CHARACTER_WORLD_PACKAGE_ID,
        module: "character",
        function: "create_character",
      },
      {
        package: SUI_CHARACTER_WORLD_PACKAGE_ID,
        module: "character",
        function: "share_character",
      },
    ],
  );
  assert.equal(data.commands[0].MoveCall.arguments.length, 7);
  assert.deepEqual(data.commands[1].MoveCall.arguments[0], {
    NestedResult: [0, 0],
    $kind: "NestedResult",
  });
  assert.equal(
    data.inputs[0].UnresolvedObject.objectId,
    SUI_CHARACTER_OBJECT_REGISTRY_ID,
  );
  assert.equal(
    data.inputs[1].UnresolvedObject.objectId,
    SUI_CHARACTER_ADMIN_ACL_ID,
  );
});

test("Frontier executes through SuiGrpcClient and returns wallet-owned PlayerProfile linkage", async () => {
  const identity = prepareSuiCharacterIdentity({
    accountId: 990000001,
    gameCharacterId: 140000002,
    characterName: "Sui Provision Test",
  });
  const characterType = `${identity.packageId}::character::Character`;
  const profileType = `${identity.packageId}::character::PlayerProfile`;
  let executeOptions: Record<string, any> | null = null;
  const client = {
    async getObject() {
      throw { reason: "notFound" };
    },
    async listOwnedObjects() {
      throw new Error("listOwnedObjects should not run for a new Character");
    },
    async signAndExecuteTransaction(options) {
      executeOptions = options;
      return {
        $kind: "Transaction",
        Transaction: {
          digest: "test-transaction-digest",
          status: { success: true, error: null },
          objectTypes: {
            [identity.characterObjectId]: characterType,
            [PLAYER_PROFILE_ID]: profileType,
          },
          effects: {
            changedObjects: [
              {
                objectId: identity.characterObjectId,
                idOperation: "Created",
                outputOwner: {
                  $kind: "Shared",
                  Shared: { initialSharedVersion: "1" },
                },
              },
              {
                objectId: PLAYER_PROFILE_ID,
                idOperation: "Created",
                outputOwner: {
                  $kind: "AddressOwner",
                  AddressOwner: identity.walletAddress,
                },
              },
            ],
          },
        },
      };
    },
  };

  const result = await provisionSuiCharacter(
    {
      accountId: identity.accountId,
      gameCharacterId: identity.gameCharacterId,
      characterName: identity.characterName,
      identity,
    },
    { client, adminSigner: { toSuiAddress: () => "0x1" } },
  );

  assert.equal(result.walletAddress, identity.walletAddress);
  assert.equal(result.characterObjectId, identity.characterObjectId);
  assert.equal(result.playerProfileObjectId, PLAYER_PROFILE_ID);
  assert.equal(result.transactionDigest, "test-transaction-digest");
  assert.equal(result.recovered, false);
  assert.deepEqual(executeOptions && executeOptions.include, {
    effects: true,
    events: true,
    objectTypes: true,
  });
  assert.ok(executeOptions && executeOptions.transaction);
  assert.ok(executeOptions && executeOptions.signer);
});

test("Frontier treats transaction preparation failures as definitely not submitted", async () => {
  const identity = prepareSuiCharacterIdentity({
    accountId: 990000010,
    gameCharacterId: 140000010,
    characterName: "Sui Prepare Failure",
  });
  let executeCalls = 0;
  let reconciliationCalls = 0;
  const rpcError = Object.assign(
    new Error(`Object ${identity.packageId} not found`),
    { code: "NOT_FOUND" },
  );
  const preparationError = new Error(rpcError.message, { cause: rpcError });
  const client = {
    async getObject() {
      throw { reason: "notFound" };
    },
    async listOwnedObjects() {
      reconciliationCalls += 1;
      return { objects: [], cursor: null, hasNextPage: false };
    },
    async executeTransaction() {
      executeCalls += 1;
      throw new Error("must not execute an unbuilt transaction");
    },
    async signAndExecuteTransaction() {
      throw new Error("split submission path must be used");
    },
  };

  await assert.rejects(
    provisionSuiCharacter(
      {
        accountId: identity.accountId,
        gameCharacterId: identity.gameCharacterId,
        characterName: identity.characterName,
        identity,
      },
      {
        client,
        adminSigner: {
          toSuiAddress: () => "0x1",
          async signTransaction() {
            throw new Error("must not sign after build failure");
          },
        },
        transactionFactory: () =>
          ({
            setSenderIfNotSet() {},
            async build() {
              throw preparationError;
            },
          }) as any,
      },
    ),
    (error: any) =>
      error instanceof SuiCharacterProvisioningError &&
      error.code === "TRANSACTION_NOT_SUBMITTED" &&
      error.ambiguous === false,
  );
  assert.equal(executeCalls, 0);
  assert.equal(reconciliationCalls, 0);
});

test("Frontier reconciles an accepted transaction by its prepared digest", async () => {
  const identity = prepareSuiCharacterIdentity({
    accountId: 990000011,
    gameCharacterId: 140000011,
    characterName: "Sui Digest Reconcile",
  });
  let preparedDigest = "";
  let transactionLookups = 0;
  let objectReconciliationCalls = 0;
  const client = {
    async getObject() {
      throw { reason: "notFound" };
    },
    async getTransaction({ digest }) {
      transactionLookups += 1;
      return successfulTransactionResult(identity, digest);
    },
    async listOwnedObjects() {
      objectReconciliationCalls += 1;
      return { objects: [], cursor: null, hasNextPage: false };
    },
    async executeTransaction() {
      throw new Error("transport disconnected after accepting transaction");
    },
    async signAndExecuteTransaction() {
      throw new Error("split submission path must be used");
    },
  };

  const result = await provisionSuiCharacter(
    {
      accountId: identity.accountId,
      gameCharacterId: identity.gameCharacterId,
      characterName: identity.characterName,
      identity,
    },
    {
      client,
      adminSigner: {
        toSuiAddress: () => "0x1",
        async signTransaction() {
          return { signature: "test-signature" };
        },
      },
      transactionFactory: () =>
        ({
          setSenderIfNotSet() {},
          async build() {
            return new Uint8Array([1, 2, 3, 4]);
          },
        }) as any,
      reconciliationDelaysMs: [0],
      onTransactionPrepared({ transactionDigest }) {
        preparedDigest = transactionDigest;
      },
    },
  );

  assert.ok(preparedDigest);
  assert.equal(result.transactionDigest, preparedDigest);
  assert.equal(result.recovered, false);
  assert.equal(transactionLookups, 1);
  assert.equal(objectReconciliationCalls, 0);
});

test("Frontier replays the exact journaled transaction when its digest was never submitted", async () => {
  const identity = prepareSuiCharacterIdentity({
    accountId: 990000016,
    gameCharacterId: 140000016,
    characterName: "Sui Journal Replay",
  });
  const transactionBytes = new Uint8Array([9, 8, 7, 6]);
  const transactionDigest =
    TransactionDataBuilder.getDigestFromBytes(transactionBytes);
  const transactionSignature = "journaled-test-signature";
  let executions = 0;
  const client = {
    async getChainIdentifier() {
      return { chainIdentifier: "a1b2c3d4" };
    },
    async getTransaction({ digest }) {
      throw { reason: "notFound", digest };
    },
    async getObject() {
      throw { reason: "notFound" };
    },
    async listOwnedObjects() {
      return { objects: [], cursor: null, hasNextPage: false };
    },
    async executeTransaction({ transaction, signatures }) {
      executions += 1;
      assert.deepEqual(transaction, transactionBytes);
      assert.deepEqual(signatures, [transactionSignature]);
      return successfulTransactionResult(identity, transactionDigest);
    },
    async signAndExecuteTransaction() {
      throw new Error("a journaled transaction must not be rebuilt");
    },
  };

  const result = await provisionSuiCharacter(
    {
      accountId: identity.accountId,
      gameCharacterId: identity.gameCharacterId,
      characterName: identity.characterName,
      identity,
      transactionDigest,
      transactionBytesBase64: Buffer.from(transactionBytes).toString("base64"),
      transactionSignature,
      chainId: "a1b2c3d4",
    },
    { client, reconciliationDelaysMs: [0] },
  );

  assert.equal(executions, 1);
  assert.equal(result.transactionDigest, transactionDigest);
});

test("Frontier treats a malformed post-execution response as ambiguous", async () => {
  const identity = prepareSuiCharacterIdentity({
    accountId: 990000017,
    gameCharacterId: 140000017,
    characterName: "Sui Malformed Result",
  });
  let preparedDigest = "";
  const client = {
    async getObject() {
      throw { reason: "notFound" };
    },
    async getTransaction({ digest }) {
      throw { reason: "notFound", digest };
    },
    async listOwnedObjects() {
      return { objects: [], cursor: null, hasNextPage: false };
    },
    async executeTransaction() {
      return {
        $kind: "Transaction",
        Transaction: { digest: preparedDigest },
      };
    },
    async signAndExecuteTransaction() {
      throw new Error("split submission path must be used");
    },
  };

  await assert.rejects(
    provisionSuiCharacter(
      {
        accountId: identity.accountId,
        gameCharacterId: identity.gameCharacterId,
        characterName: identity.characterName,
        identity,
      },
      {
        client,
        adminSigner: {
          toSuiAddress: () => "0x1",
          async signTransaction() {
            return { signature: "test-signature" };
          },
        },
        transactionFactory: () =>
          ({
            setSenderIfNotSet() {},
            async build() {
              return new Uint8Array([4, 3, 2, 1]);
            },
          }) as any,
        reconciliationDelaysMs: [0],
        onTransactionPrepared({ transactionDigest }) {
          preparedDigest = transactionDigest;
        },
      },
    ),
    (error: any) =>
      error instanceof SuiCharacterProvisioningError &&
      error.code === "TRANSACTION_STATUS_UNKNOWN" &&
      error.ambiguous === true &&
      error.transactionDigest === preparedDigest,
  );
  assert.ok(preparedDigest);
});

test("Frontier never converts a digest-confirmed failed transaction to unknown", async () => {
  const identity = prepareSuiCharacterIdentity({
    accountId: 990000012,
    gameCharacterId: 140000012,
    characterName: "Sui Digest Failure",
  });
  let preparedDigest = "";
  const client = {
    async getObject() {
      throw { reason: "notFound" };
    },
    async getTransaction({ digest }) {
      return {
        $kind: "FailedTransaction",
        FailedTransaction: {
          digest,
          status: {
            success: false,
            error: { message: "MoveAbort" },
          },
        },
      };
    },
    async listOwnedObjects() {
      throw new Error("object reconciliation must not mask a failed transaction");
    },
    async executeTransaction() {
      throw new Error("transport disconnected after accepting transaction");
    },
    async signAndExecuteTransaction() {
      throw new Error("split submission path must be used");
    },
  };

  await assert.rejects(
    provisionSuiCharacter(
      {
        accountId: identity.accountId,
        gameCharacterId: identity.gameCharacterId,
        characterName: identity.characterName,
        identity,
      },
      {
        client,
        adminSigner: {
          toSuiAddress: () => "0x1",
          async signTransaction() {
            return { signature: "test-signature" };
          },
        },
        transactionFactory: () =>
          ({
            setSenderIfNotSet() {},
            async build() {
              return new Uint8Array([5, 6, 7, 8]);
            },
          }) as any,
        reconciliationDelaysMs: [0],
        onTransactionPrepared({ transactionDigest }) {
          preparedDigest = transactionDigest;
        },
      },
    ),
    (error: any) =>
      error instanceof SuiCharacterProvisioningError &&
      error.code === "TRANSACTION_FAILED" &&
      error.ambiguous === false &&
      error.transactionDigest === preparedDigest,
  );
});

test("Frontier recognizes nested gRPC object-not-found errors before legacy submission", async () => {
  const identity = prepareSuiCharacterIdentity({
    accountId: 990000013,
    gameCharacterId: 140000013,
    characterName: "Sui Nested Missing Object",
  });
  let objectReconciliationCalls = 0;
  const rpcError = Object.assign(
    new Error(`Object ${identity.packageId} not found`),
    { code: "NOT_FOUND" },
  );
  const client = {
    async getObject() {
      throw { reason: "notFound" };
    },
    async listOwnedObjects() {
      objectReconciliationCalls += 1;
      return { objects: [], cursor: null, hasNextPage: false };
    },
    async signAndExecuteTransaction() {
      throw new Error(rpcError.message, { cause: rpcError });
    },
  };

  await assert.rejects(
    provisionSuiCharacter(
      {
        accountId: identity.accountId,
        gameCharacterId: identity.gameCharacterId,
        characterName: identity.characterName,
        identity,
      },
      {
        client,
        adminSigner: {},
        reconciliationDelaysMs: [0],
      },
    ),
    (error: any) =>
      error instanceof SuiCharacterProvisioningError &&
      error.code === "TRANSACTION_NOT_SUBMITTED" &&
      error.ambiguous === false,
  );
  assert.equal(objectReconciliationCalls, 0);
});

test("Frontier reconciles an existing Character instead of submitting a duplicate", async () => {
  const identity = prepareSuiCharacterIdentity({
    accountId: 990000002,
    gameCharacterId: 140000003,
    characterName: "Sui Reconcile Test",
  });
  let executeCalls = 0;
  const client = {
    async getObject() {
      return {
        object: {
          objectId: identity.characterObjectId,
          owner: {
            $kind: "Shared",
            Shared: { initialSharedVersion: "10" },
          },
          type: `${identity.packageId}::character::Character`,
          previousTransaction: "later-character-update",
          json: {
            id: identity.characterObjectId,
            character_address: identity.walletAddress,
            key: {
              item_id: String(identity.gameCharacterId),
              tenant: identity.tenant,
            },
            tribe_id: identity.tribeId,
          },
        },
      };
    },
    async listOwnedObjects() {
      return {
        objects: [
          {
            objectId: PLAYER_PROFILE_ID,
            owner: {
              $kind: "AddressOwner",
              AddressOwner: identity.walletAddress,
            },
            type: `${identity.packageId}::character::PlayerProfile`,
            previousTransaction: "original-create-transaction",
            json: {
              id: PLAYER_PROFILE_ID,
              character_id: identity.characterObjectId,
            },
          },
        ],
        cursor: null,
        hasNextPage: false,
      };
    },
    async signAndExecuteTransaction() {
      executeCalls += 1;
      throw new Error("duplicate transaction must not execute");
    },
  };

  const result = await provisionSuiCharacter(
    {
      accountId: identity.accountId,
      gameCharacterId: identity.gameCharacterId,
      characterName: identity.characterName,
      identity,
    },
    { client },
  );

  assert.equal(executeCalls, 0);
  assert.equal(result.recovered, true);
  assert.equal(result.playerProfileObjectId, PLAYER_PROFILE_ID);
  assert.equal(result.transactionDigest, "original-create-transaction");
});

test("Frontier treats a rejected Sui transaction as a definitive provisioning failure", async () => {
  const identity = prepareSuiCharacterIdentity({
    accountId: 990000003,
    gameCharacterId: 140000004,
    characterName: "Sui Failure Test",
  });
  const client = {
    async getObject() {
      throw { reason: "notFound" };
    },
    async listOwnedObjects() {
      return { objects: [], cursor: null, hasNextPage: false };
    },
    async signAndExecuteTransaction() {
      return {
        $kind: "FailedTransaction",
        FailedTransaction: {
          status: {
            success: false,
            error: { message: "MoveAbort" },
          },
        },
      };
    },
  };

  await assert.rejects(
    provisionSuiCharacter(
      {
        accountId: identity.accountId,
        gameCharacterId: identity.gameCharacterId,
        characterName: identity.characterName,
        identity,
      },
      {
        client,
        adminSigner: {},
        reconciliationDelaysMs: [0],
      },
    ),
    (error: any) => {
      assert.ok(error instanceof SuiCharacterProvisioningError);
      assert.equal(error.code, "TRANSACTION_FAILED");
      assert.equal(error.ambiguous, false);
      return true;
    },
  );
});

test("Frontier preserves a local binding when submission status is ambiguous", async () => {
  const identity = prepareSuiCharacterIdentity({
    accountId: 990000004,
    gameCharacterId: 140000005,
    characterName: "Sui Ambiguous Test",
  });
  const client = {
    async getObject() {
      throw { reason: "notFound" };
    },
    async listOwnedObjects() {
      return { objects: [], cursor: null, hasNextPage: false };
    },
    async signAndExecuteTransaction() {
      throw new Error("transport disconnected after submit");
    },
  };

  await assert.rejects(
    provisionSuiCharacter(
      {
        accountId: identity.accountId,
        gameCharacterId: identity.gameCharacterId,
        characterName: identity.characterName,
        identity,
      },
      {
        client,
        adminSigner: {},
        reconciliationDelaysMs: [0, 0],
      },
    ),
    (error: any) => {
      assert.ok(error instanceof SuiCharacterProvisioningError);
      assert.equal(error.code, "TRANSACTION_STATUS_UNKNOWN");
      assert.equal(error.ambiguous, true);
      return true;
    },
  );
});

test("Frontier keeps a confirmed digest when successful outputs need reconciliation", async () => {
  const identity = prepareSuiCharacterIdentity({
    accountId: 990000005,
    gameCharacterId: 140000006,
    characterName: "Sui Output Reconcile Test",
  });
  let lookupCount = 0;
  const client = {
    async getObject() {
      lookupCount += 1;
      if (lookupCount === 1) {
        throw { reason: "notFound" };
      }
      throw new Error("index unavailable");
    },
    async listOwnedObjects() {
      return { objects: [], cursor: null, hasNextPage: false };
    },
    async signAndExecuteTransaction() {
      return {
        $kind: "Transaction",
        Transaction: {
          digest: "known-success-digest",
          status: { success: true, error: null },
          objectTypes: {},
          effects: { changedObjects: [] },
        },
      };
    },
  };

  await assert.rejects(
    provisionSuiCharacter(
      {
        accountId: identity.accountId,
        gameCharacterId: identity.gameCharacterId,
        characterName: identity.characterName,
        identity,
      },
      {
        client,
        adminSigner: {},
        reconciliationDelaysMs: [0],
      },
    ),
    (error: any) => {
      assert.ok(error instanceof SuiCharacterProvisioningError);
      assert.equal(error.code, "TRANSACTION_STATUS_UNKNOWN");
      assert.equal(error.ambiguous, true);
      assert.equal(error.transactionDigest, "known-success-digest");
      return true;
    },
  );
});
