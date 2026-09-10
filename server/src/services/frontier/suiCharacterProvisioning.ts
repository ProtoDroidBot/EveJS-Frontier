import { createHash } from "node:crypto";
import fs = require("node:fs");
import path = require("node:path");

import { bcs } from "@mysten/sui/bcs";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { Transaction } from "@mysten/sui/transactions";
import {
  deriveObjectID,
  normalizeSuiAddress,
} from "@mysten/sui/utils";

import {
  SUI_GRPC_BASE_URL,
  SUI_GRPC_NETWORK,
  suiGrpcClient,
} from "./suiGrpcClient";

const SUI_CHARACTER_WORLD_PACKAGE_ID =
  "0x2aa4f4bac8c506f389b69e2e761804904854d9b61dfd9ac3f93b9d9cb07f0a00";
const SUI_CHARACTER_OBJECT_REGISTRY_ID =
  "0xde30a2e1a674d6430b0c22eebdd363d3be2ffae6ce2517058090ea2a8245144f";
const SUI_CHARACTER_ADMIN_ACL_ID =
  "0x646024fff6f40c20cbc078d70d80ccdc6ef25cbb7fb3115b4cad2b11533e96b0";
const SUI_CHARACTER_TENANT = "dev";
const SUI_CHARACTER_TRIBE_ID = 100;
const SUI_WORLD_SYNC_FORMAT = "evejs-frontier-world-sync-v1";
const SUI_WORLD_SYNC_SCHEMA_VERSION = 1;

const DEFAULT_WORLD_CONTRACTS_DIRECTORY = path.resolve(
  __dirname,
  "../../../../..",
  "3502403",
  "world-contracts",
);

const TenantItemId = bcs.struct("TenantItemId", {
  id: bcs.u64(),
  tenant: bcs.string(),
});

type SuiCharacterClient = {
  getObject: (options: Record<string, any>) => Promise<any>;
  listOwnedObjects: (options: Record<string, any>) => Promise<any>;
  signAndExecuteTransaction: (options: Record<string, any>) => Promise<any>;
};

type SuiCharacterWorld = {
  packageId: string;
  objectRegistryId: string;
  adminAclId: string;
  tenant: string;
  tribeId: number;
};

type SuiWorldSyncConfig = {
  path: string;
  build: number;
  network: typeof SUI_GRPC_NETWORK;
  chainId: string;
  packageId: string;
  objectRegistryId: string;
  adminAclId: string;
  adminPrivateKey: string;
};

type SuiCharacterIdentity = SuiCharacterWorld & {
  accountId: number;
  gameCharacterId: number;
  characterName: string;
  walletAddress: string;
  characterObjectId: string;
};

type SuiCharacterProvisioningResult = SuiCharacterIdentity & {
  network: typeof SUI_GRPC_NETWORK;
  baseUrl: typeof SUI_GRPC_BASE_URL;
  playerProfileObjectId: string;
  transactionDigest: string;
  recovered: boolean;
};

type SuiCharacterProvisioningOptions = {
  client?: SuiCharacterClient;
  world?: Partial<SuiCharacterWorld>;
  env?: NodeJS.ProcessEnv;
  adminSigner?: any;
  adminPrivateKey?: string;
  worldContractsDirectory?: string;
  reconciliationDelaysMs?: number[];
};

type SuiCharacterProvisioningSnapshot = {
  options: SuiCharacterProvisioningOptions;
  sourceEnv: NodeJS.ProcessEnv;
  syncedConfig: SuiWorldSyncConfig | null;
};

class SuiCharacterProvisioningError extends Error {
  readonly code: string;
  readonly ambiguous: boolean;
  readonly transactionDigest: string | null;

  constructor(
    code: string,
    message: string,
    options: {
      ambiguous?: boolean;
      cause?: unknown;
      transactionDigest?: string | null;
    } = {},
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "SuiCharacterProvisioningError";
    this.code = code;
    this.ambiguous = options.ambiguous === true;
    this.transactionDigest = options.transactionDigest || null;
  }
}

let adminSubmissionTail: Promise<void> = Promise.resolve();

function serializeAdminSubmission<T>(operation: () => Promise<T>): Promise<T> {
  const result = adminSubmissionTail.then(operation, operation);
  adminSubmissionTail = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

function waitForReconciliationDelay(delayMs: number): Promise<void> {
  if (delayMs <= 0) {
    return Promise.resolve();
  }
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

function normalizeRequiredAddress(value: unknown, label: string): string {
  const rawValue = String(value || "").trim();
  if (!/^0x[0-9a-fA-F]{1,64}$/.test(rawValue)) {
    throw new SuiCharacterProvisioningError(
      "INVALID_WORLD_CONFIGURATION",
      `${label} must be a valid Sui address`,
    );
  }
  return normalizeSuiAddress(rawValue);
}

function normalizePositiveU32(value: unknown, label: string): number {
  const numeric = Number(value);
  if (
    !Number.isSafeInteger(numeric) ||
    numeric <= 0 ||
    numeric > 0xffffffff
  ) {
    throw new SuiCharacterProvisioningError(
      "INVALID_WORLD_CONFIGURATION",
      `${label} must be a positive u32`,
    );
  }
  return numeric;
}

function normalizePositiveInteger(value: unknown, label: string): number {
  const numeric = Number(value);
  if (!Number.isSafeInteger(numeric) || numeric <= 0) {
    throw new SuiCharacterProvisioningError(
      "INVALID_CHARACTER",
      `${label} must be a positive safe integer`,
    );
  }
  return numeric;
}

function normalizeTenant(value: unknown): string {
  const tenant = String(value || "").trim().toLowerCase();
  if (!tenant) {
    throw new SuiCharacterProvisioningError(
      "INVALID_WORLD_CONFIGURATION",
      "Sui world tenant must not be empty",
    );
  }
  return tenant;
}

function readSyncedSuiWorldConfig(
  env: NodeJS.ProcessEnv = process.env,
): SuiWorldSyncConfig | null {
  const configuredPath = String(env.EVEJS_SUI_WORLD_CONFIG_PATH || "").trim();
  if (!configuredPath) {
    return null;
  }
  const configPath = path.resolve(configuredPath);
  let config: any;
  try {
    config = JSON.parse(fs.readFileSync(configPath, "utf8"));
  } catch (cause) {
    throw new SuiCharacterProvisioningError(
      "INVALID_WORLD_CONFIGURATION",
      `Synchronized Sui world config could not be read: ${configPath}`,
      { cause },
    );
  }

  const invalid = (detail: string): never => {
    throw new SuiCharacterProvisioningError(
      "INVALID_WORLD_CONFIGURATION",
      `Synchronized Sui world config ${detail}: ${configPath}`,
    );
  };
  if (!config || typeof config !== "object" || Array.isArray(config)) {
    return invalid("must be a JSON object");
  }
  if (config.format !== SUI_WORLD_SYNC_FORMAT) {
    return invalid("has an unsupported format");
  }
  if (config.schemaVersion !== SUI_WORLD_SYNC_SCHEMA_VERSION) {
    return invalid("has an unsupported schema version");
  }
  if (config.state !== "ready") {
    return invalid(`is not ready (state ${JSON.stringify(config.state)})`);
  }
  if (config.network !== SUI_GRPC_NETWORK) {
    return invalid(`targets a network other than ${SUI_GRPC_NETWORK}`);
  }

  const expectedBuildText = String(env.EVEJS_CLIENT_BUILD || "").trim();
  if (!/^\d+$/.test(expectedBuildText)) {
    return invalid("requires a valid EVEJS_CLIENT_BUILD");
  }
  const expectedBuild = Number(expectedBuildText);
  if (!Number.isSafeInteger(expectedBuild) || expectedBuild <= 0) {
    return invalid("requires a valid EVEJS_CLIENT_BUILD");
  }
  if (
    typeof config.build !== "number" ||
    !Number.isSafeInteger(config.build) ||
    config.build <= 0 ||
    config.build !== expectedBuild
  ) {
    return invalid(`does not match Frontier build ${expectedBuild}`);
  }
  if (!config.world || typeof config.world !== "object" || Array.isArray(config.world)) {
    return invalid("has no world identity");
  }
  const chainId = typeof config.chainId === "string"
    ? config.chainId.trim()
    : "";
  if (!/^[0-9a-f]+$/.test(chainId)) {
    return invalid("contains an invalid chain ID");
  }

  const syncedAddress = (value: unknown, label: string): string => {
    const rawValue = typeof value === "string" ? value.trim() : "";
    if (!/^0x[0-9a-f]{64}$/.test(rawValue)) {
      return invalid(`contains an invalid ${label}`);
    }
    return normalizeSuiAddress(rawValue);
  };
  const adminPrivateKey = typeof config.adminPrivateKey === "string"
    ? config.adminPrivateKey.trim()
    : "";
  if (!adminPrivateKey || /[\u0000-\u001f\u007f]/.test(adminPrivateKey)) {
    return invalid("contains an invalid admin private key");
  }
  try {
    Ed25519Keypair.fromSecretKey(adminPrivateKey);
  } catch {
    return invalid("contains an invalid Ed25519 admin private key");
  }

  return {
    path: configPath,
    build: config.build,
    network: SUI_GRPC_NETWORK,
    chainId,
    packageId: syncedAddress(config.world.packageId, "world package ID"),
    objectRegistryId: syncedAddress(
      config.world.objectRegistryId,
      "ObjectRegistry ID",
    ),
    adminAclId: syncedAddress(config.world.adminAclId, "AdminACL ID"),
    adminPrivateKey,
  };
}

function snapshotSuiCharacterProvisioningOptions(
  options: SuiCharacterProvisioningOptions,
): SuiCharacterProvisioningSnapshot {
  const sourceEnv = options.env || process.env;
  const world = options.world || {};
  const needsSyncedWorld = !(
    (world.packageId || sourceEnv.EVEJS_SUI_WORLD_PACKAGE_ID) &&
    (world.objectRegistryId || sourceEnv.EVEJS_SUI_OBJECT_REGISTRY_ID) &&
    (world.adminAclId || sourceEnv.EVEJS_SUI_ADMIN_ACL_ID)
  );
  const hasExplicitSigner = Boolean(
    options.adminSigner ||
      options.adminPrivateKey ||
      sourceEnv.EVEJS_SUI_ADMIN_PRIVATE_KEY ||
      sourceEnv.ADMIN_PRIVATE_KEY
  );
  const syncedConfig = needsSyncedWorld || !hasExplicitSigner
    ? readSyncedSuiWorldConfig(sourceEnv)
    : null;
  const snapshotEnv: NodeJS.ProcessEnv = { ...sourceEnv };
  delete snapshotEnv.EVEJS_SUI_WORLD_CONFIG_PATH;

  if (syncedConfig) {
    if (!world.packageId && !snapshotEnv.EVEJS_SUI_WORLD_PACKAGE_ID) {
      snapshotEnv.EVEJS_SUI_WORLD_PACKAGE_ID = syncedConfig.packageId;
    }
    if (
      !world.objectRegistryId &&
      !snapshotEnv.EVEJS_SUI_OBJECT_REGISTRY_ID
    ) {
      snapshotEnv.EVEJS_SUI_OBJECT_REGISTRY_ID = syncedConfig.objectRegistryId;
    }
    if (!world.adminAclId && !snapshotEnv.EVEJS_SUI_ADMIN_ACL_ID) {
      snapshotEnv.EVEJS_SUI_ADMIN_ACL_ID = syncedConfig.adminAclId;
    }
    if (!hasExplicitSigner) {
      snapshotEnv.EVEJS_SUI_ADMIN_PRIVATE_KEY = syncedConfig.adminPrivateKey;
    }
  }

  return {
    options: { ...options, env: snapshotEnv },
    sourceEnv,
    syncedConfig,
  };
}

function assertSuiProvisioningSnapshotCurrent(
  snapshot: SuiCharacterProvisioningSnapshot,
): void {
  const expected = snapshot.syncedConfig;
  if (!expected) {
    return;
  }
  const current = readSyncedSuiWorldConfig(snapshot.sourceEnv);
  if (
    !current ||
    current.build !== expected.build ||
    current.network !== expected.network ||
    current.chainId !== expected.chainId ||
    current.packageId !== expected.packageId ||
    current.objectRegistryId !== expected.objectRegistryId ||
    current.adminAclId !== expected.adminAclId ||
    current.adminPrivateKey !== expected.adminPrivateKey
  ) {
    throw new SuiCharacterProvisioningError(
      "WORLD_CONFIGURATION_CHANGED",
      "The synchronized Sui world changed during Character provisioning; retry the operation",
    );
  }
}

function resolveSuiCharacterWorld(
  overrides: Partial<SuiCharacterWorld> = {},
  env: NodeJS.ProcessEnv = process.env,
): SuiCharacterWorld {
  const explicitPackageId = overrides.packageId || env.EVEJS_SUI_WORLD_PACKAGE_ID;
  const explicitObjectRegistryId =
    overrides.objectRegistryId || env.EVEJS_SUI_OBJECT_REGISTRY_ID;
  const explicitAdminAclId = overrides.adminAclId || env.EVEJS_SUI_ADMIN_ACL_ID;
  const syncedConfig = explicitPackageId &&
      explicitObjectRegistryId &&
      explicitAdminAclId
    ? null
    : readSyncedSuiWorldConfig(env);
  return {
    packageId: normalizeRequiredAddress(
      explicitPackageId ||
        syncedConfig?.packageId ||
        SUI_CHARACTER_WORLD_PACKAGE_ID,
      "Sui world package ID",
    ),
    objectRegistryId: normalizeRequiredAddress(
      explicitObjectRegistryId ||
        syncedConfig?.objectRegistryId ||
        SUI_CHARACTER_OBJECT_REGISTRY_ID,
      "Sui ObjectRegistry ID",
    ),
    adminAclId: normalizeRequiredAddress(
      explicitAdminAclId ||
        syncedConfig?.adminAclId ||
        SUI_CHARACTER_ADMIN_ACL_ID,
      "Sui AdminACL ID",
    ),
    tenant: normalizeTenant(overrides.tenant || SUI_CHARACTER_TENANT),
    tribeId: normalizePositiveU32(
      overrides.tribeId ||
        env.EVEJS_SUI_TRIBE_ID ||
        SUI_CHARACTER_TRIBE_ID,
      "Sui tribe ID",
    ),
  };
}

/**
 * Matches build 3502403's local Frontier client exactly:
 * SHA-512("<tenant>:<accountId>") -> hex -> Ed25519 HD derivation.
 *
 * EveJS recreates the derivation only long enough to obtain the public address;
 * it never persists or logs the deterministic seed/private key. Because the
 * seed is predictable, this is strictly a local-development wallet scheme.
 */
function deriveLocalPlayerSuiWalletAddress(
  accountId: unknown,
  tenant: unknown = SUI_CHARACTER_TENANT,
): string {
  const normalizedAccountId = normalizePositiveInteger(accountId, "Account ID");
  const normalizedTenant = normalizeTenant(tenant);
  const seedHex = createHash("sha512")
    .update(`${normalizedTenant}:${normalizedAccountId}`, "utf8")
    .digest("hex");
  return Ed25519Keypair.deriveKeypairFromSeed(seedHex)
    .getPublicKey()
    .toSuiAddress();
}

function deriveSuiCharacterObjectId(
  objectRegistryId: unknown,
  gameCharacterId: unknown,
  packageId: unknown,
  tenant: unknown = SUI_CHARACTER_TENANT,
): string {
  const normalizedRegistryId = normalizeRequiredAddress(
    objectRegistryId,
    "Sui ObjectRegistry ID",
  );
  const normalizedPackageId = normalizeRequiredAddress(
    packageId,
    "Sui world package ID",
  );
  const normalizedGameCharacterId = normalizePositiveU32(
    gameCharacterId,
    "Game character ID",
  );
  const normalizedTenant = normalizeTenant(tenant);
  const serializedKey = TenantItemId.serialize({
    id: BigInt(normalizedGameCharacterId),
    tenant: normalizedTenant,
  }).toBytes();

  return deriveObjectID(
    normalizedRegistryId,
    `${normalizedPackageId}::in_game_id::TenantItemId`,
    serializedKey,
  );
}

function prepareSuiCharacterIdentity(
  input: {
    accountId: unknown;
    gameCharacterId: unknown;
    characterName: unknown;
  },
  options: {
    world?: Partial<SuiCharacterWorld>;
    env?: NodeJS.ProcessEnv;
  } = {},
): SuiCharacterIdentity {
  const world = resolveSuiCharacterWorld(options.world, options.env);
  const accountId = normalizePositiveInteger(input.accountId, "Account ID");
  const gameCharacterId = normalizePositiveU32(
    input.gameCharacterId,
    "Game character ID",
  );
  const characterName = String(input.characterName || "").trim();
  if (!characterName) {
    throw new SuiCharacterProvisioningError(
      "INVALID_CHARACTER",
      "Character name must not be empty",
    );
  }
  const walletAddress = deriveLocalPlayerSuiWalletAddress(
    accountId,
    world.tenant,
  );

  return {
    ...world,
    accountId,
    gameCharacterId,
    characterName,
    walletAddress,
    characterObjectId: deriveSuiCharacterObjectId(
      world.objectRegistryId,
      gameCharacterId,
      world.packageId,
      world.tenant,
    ),
  };
}

function createSuiCharacterTransaction(
  identity: SuiCharacterIdentity,
): Transaction {
  const transaction = new Transaction();
  const [character] = transaction.moveCall({
    target: `${identity.packageId}::character::create_character`,
    arguments: [
      transaction.object(identity.objectRegistryId),
      transaction.object(identity.adminAclId),
      transaction.pure.u32(identity.gameCharacterId),
      transaction.pure.string(identity.tenant),
      transaction.pure.u32(identity.tribeId),
      transaction.pure.address(identity.walletAddress),
      transaction.pure.string(identity.characterName),
    ],
  });
  transaction.moveCall({
    target: `${identity.packageId}::character::share_character`,
    arguments: [character, transaction.object(identity.adminAclId)],
  });
  return transaction;
}

function readDotEnvValue(filePath: string, key: string): string | null {
  if (!fs.existsSync(filePath)) {
    return null;
  }
  const keyPattern = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const matcher = new RegExp(`^\\s*(?:export\\s+)?${keyPattern}\\s*=\\s*(.*)\\s*$`);
  for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const match = matcher.exec(line);
    if (!match) {
      continue;
    }
    let value = match[1].trim();
    if (
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'")))
    ) {
      value = value.slice(1, -1);
    } else {
      value = value.replace(/\s+#.*$/, "").trim();
    }
    return value || null;
  }
  return null;
}

function resolveAdminSigner(options: {
  adminSigner?: any;
  adminPrivateKey?: string;
  env?: NodeJS.ProcessEnv;
  worldContractsDirectory?: string;
} = {}): any {
  if (options.adminSigner) {
    return options.adminSigner;
  }
  const env = options.env || process.env;
  const explicitPrivateKey = options.adminPrivateKey ||
    env.EVEJS_SUI_ADMIN_PRIVATE_KEY ||
    env.ADMIN_PRIVATE_KEY;
  const syncedConfig = explicitPrivateKey ? null : readSyncedSuiWorldConfig(env);
  const worldContractsDirectory = path.resolve(
    options.worldContractsDirectory ||
      env.EVEJS_SUI_WORLD_CONTRACTS_DIR ||
      DEFAULT_WORLD_CONTRACTS_DIRECTORY,
  );
  const privateKey = String(
    explicitPrivateKey ||
      syncedConfig?.adminPrivateKey ||
      readDotEnvValue(path.join(worldContractsDirectory, ".env"), "ADMIN_PRIVATE_KEY") ||
      "",
  ).trim();

  if (!privateKey) {
    throw new SuiCharacterProvisioningError(
      "ADMIN_SIGNER_MISSING",
      "Sui character provisioning needs EVEJS_SUI_ADMIN_PRIVATE_KEY or the world-contracts .env ADMIN_PRIVATE_KEY",
    );
  }
  try {
    return Ed25519Keypair.fromSecretKey(privateKey);
  } catch {
    throw new SuiCharacterProvisioningError(
      "ADMIN_SIGNER_INVALID",
      "The configured Sui character admin private key is invalid",
    );
  }
}

function isObjectNotFoundError(error: unknown): boolean {
  return Boolean(
    error &&
      typeof error === "object" &&
      ((error as any).reason === "notFound" ||
        (error as any).code === "notExists"),
  );
}

function sameSuiAddress(left: unknown, right: unknown): boolean {
  try {
    return normalizeSuiAddress(String(left)) === normalizeSuiAddress(String(right));
  } catch {
    return false;
  }
}

function getAddressOwner(owner: any): string | null {
  if (!owner || owner.$kind !== "AddressOwner") {
    return null;
  }
  return typeof owner.AddressOwner === "string" ? owner.AddressOwner : null;
}

async function findPlayerProfileObject(
  client: SuiCharacterClient,
  identity: SuiCharacterIdentity,
): Promise<any | null> {
  const playerProfileType = `${identity.packageId}::character::PlayerProfile`;
  let cursor: string | null = null;
  do {
    const page = await client.listOwnedObjects({
      owner: identity.walletAddress,
      type: playerProfileType,
      cursor,
      limit: 50,
      include: { json: true, previousTransaction: true },
    });
    const profile = (page.objects || []).find(
      (object: any) =>
        object &&
        object.type === playerProfileType &&
        sameSuiAddress(object.json && object.json.character_id, identity.characterObjectId) &&
        sameSuiAddress(getAddressOwner(object.owner), identity.walletAddress),
    );
    if (profile) {
      return profile;
    }
    cursor = page.hasNextPage ? page.cursor : null;
  } while (cursor);
  return null;
}

async function findExistingSuiCharacter(
  client: SuiCharacterClient,
  identity: SuiCharacterIdentity,
): Promise<SuiCharacterProvisioningResult | null> {
  let object: any;
  try {
    ({ object } = await client.getObject({
      objectId: identity.characterObjectId,
      include: { json: true, previousTransaction: true },
    }));
  } catch (error) {
    if (isObjectNotFoundError(error)) {
      return null;
    }
    throw error;
  }

  const characterType = `${identity.packageId}::character::Character`;
  const json = object && object.json;
  const key = json && json.key;
  if (
    !object ||
    object.type !== characterType ||
    !object.owner ||
    object.owner.$kind !== "Shared" ||
    !sameSuiAddress(json && json.character_address, identity.walletAddress) ||
    Number(key && key.item_id) !== identity.gameCharacterId ||
    String((key && key.tenant) || "").toLowerCase() !== identity.tenant ||
    Number(json && json.tribe_id) !== identity.tribeId
  ) {
    throw new SuiCharacterProvisioningError(
      "CHARACTER_ID_COLLISION",
      `Existing Sui object ${identity.characterObjectId} does not match this player character`,
      { ambiguous: true },
    );
  }

  let profile: any;
  try {
    profile = await findPlayerProfileObject(client, identity);
  } catch (error) {
    throw new SuiCharacterProvisioningError(
      "PLAYER_PROFILE_LOOKUP_FAILED",
      "The Sui Character exists, but its wallet-owned PlayerProfile could not be verified",
      { ambiguous: true, cause: error },
    );
  }
  if (!profile) {
    throw new SuiCharacterProvisioningError(
      "PLAYER_PROFILE_MISSING",
      "The Sui Character exists without the expected wallet-owned PlayerProfile",
      { ambiguous: true },
    );
  }

  return {
    ...identity,
    network: SUI_GRPC_NETWORK,
    baseUrl: SUI_GRPC_BASE_URL,
    playerProfileObjectId: profile.objectId,
    transactionDigest:
      profile.previousTransaction || object.previousTransaction || "",
    recovered: true,
  };
}

async function reconcileSubmittedSuiCharacter(
  client: SuiCharacterClient,
  identity: SuiCharacterIdentity,
  delaysMs: number[] = [0, 150, 500, 1000],
): Promise<{
  result: SuiCharacterProvisioningResult | null;
  lastError: unknown;
}> {
  let lastError: unknown = null;
  for (const rawDelayMs of delaysMs) {
    const delayMs = Math.max(0, Math.min(5000, Number(rawDelayMs) || 0));
    await waitForReconciliationDelay(delayMs);
    try {
      const result = await findExistingSuiCharacter(client, identity);
      if (result) {
        return { result, lastError: null };
      }
      lastError = null;
    } catch (error) {
      lastError = error;
    }
  }
  return { result: null, lastError };
}

function parseSuccessfulTransaction(
  result: any,
  identity: SuiCharacterIdentity,
): SuiCharacterProvisioningResult {
  if (!result || !["Transaction", "FailedTransaction"].includes(result.$kind)) {
    throw new SuiCharacterProvisioningError(
      "TRANSACTION_STATUS_UNKNOWN",
      "Sui Character transaction returned an unrecognized result",
      { ambiguous: true },
    );
  }
  if (result.$kind === "FailedTransaction") {
    const failed = result && result.FailedTransaction;
    const message =
      failed && failed.status && failed.status.error && failed.status.error.message;
    throw new SuiCharacterProvisioningError(
      "TRANSACTION_FAILED",
      message
        ? `Sui Character transaction failed: ${String(message).slice(0, 300)}`
        : "Sui Character transaction failed",
      { transactionDigest: failed && failed.digest },
    );
  }
  const transaction = result.Transaction;
  if (!transaction.status || transaction.status.success !== true) {
    throw new SuiCharacterProvisioningError(
      "TRANSACTION_FAILED",
      "Sui Character transaction did not report a successful status",
      { transactionDigest: transaction && transaction.digest },
    );
  }

  const characterType = `${identity.packageId}::character::Character`;
  const playerProfileType = `${identity.packageId}::character::PlayerProfile`;
  const changedObjects = (transaction.effects && transaction.effects.changedObjects) || [];
  const objectTypes = transaction.objectTypes || {};
  const characterChange = changedObjects.find(
    (change: any) =>
      change &&
      change.idOperation === "Created" &&
      sameSuiAddress(change.objectId, identity.characterObjectId) &&
      objectTypes[change.objectId] === characterType &&
      change.outputOwner &&
      change.outputOwner.$kind === "Shared",
  );
  const profileChange = changedObjects.find(
    (change: any) =>
      change &&
      change.idOperation === "Created" &&
      objectTypes[change.objectId] === playerProfileType &&
      sameSuiAddress(getAddressOwner(change.outputOwner), identity.walletAddress),
  );

  if (!characterChange || !profileChange) {
    throw new SuiCharacterProvisioningError(
      "TRANSACTION_OUTPUT_MISSING",
      "Sui Character transaction succeeded without the expected Character and PlayerProfile outputs",
      { ambiguous: true, transactionDigest: transaction.digest },
    );
  }

  return {
    ...identity,
    network: SUI_GRPC_NETWORK,
    baseUrl: SUI_GRPC_BASE_URL,
    playerProfileObjectId: profileChange.objectId,
    transactionDigest: String(transaction.digest || ""),
    recovered: false,
  };
}

async function provisionSuiCharacter(
  input: {
    accountId: unknown;
    gameCharacterId: unknown;
    characterName: unknown;
    identity?: SuiCharacterIdentity;
  },
  options: SuiCharacterProvisioningOptions = {},
): Promise<SuiCharacterProvisioningResult> {
  const client = options.client || (suiGrpcClient as unknown as SuiCharacterClient);
  const reconciliationDelaysMs = Array.isArray(options.reconciliationDelaysMs)
    ? options.reconciliationDelaysMs
    : [0, 150, 500, 1000];

  return serializeAdminSubmission(async () => {
    const snapshot = snapshotSuiCharacterProvisioningOptions(options);
    const operationOptions = snapshot.options;
    const identity = prepareSuiCharacterIdentity(input, operationOptions);
    if (input.identity) {
      const suppliedIdentity = input.identity;
      const identityMatches =
        suppliedIdentity.accountId === identity.accountId &&
        suppliedIdentity.gameCharacterId === identity.gameCharacterId &&
        suppliedIdentity.characterName === identity.characterName &&
        suppliedIdentity.tenant === identity.tenant &&
        suppliedIdentity.tribeId === identity.tribeId &&
        sameSuiAddress(suppliedIdentity.packageId, identity.packageId) &&
        sameSuiAddress(
          suppliedIdentity.objectRegistryId,
          identity.objectRegistryId,
        ) &&
        sameSuiAddress(suppliedIdentity.adminAclId, identity.adminAclId) &&
        sameSuiAddress(suppliedIdentity.walletAddress, identity.walletAddress) &&
        sameSuiAddress(
          suppliedIdentity.characterObjectId,
          identity.characterObjectId,
        );
      if (!identityMatches) {
        throw new SuiCharacterProvisioningError(
          "INVALID_PREPARED_IDENTITY",
          "Prepared Sui Character identity does not match its creation request",
        );
      }
    }

    let existing: SuiCharacterProvisioningResult | null;
    try {
      existing = await findExistingSuiCharacter(client, identity);
    } catch (error) {
      if (error instanceof SuiCharacterProvisioningError) {
        throw error;
      }
      throw new SuiCharacterProvisioningError(
        "PRECHECK_FAILED",
        "The local Sui network could not be checked before Character creation",
        { cause: error },
      );
    }
    if (existing) {
      assertSuiProvisioningSnapshotCurrent(snapshot);
      return existing;
    }

    assertSuiProvisioningSnapshotCurrent(snapshot);
    const signer = resolveAdminSigner(operationOptions);
    const transaction = createSuiCharacterTransaction(identity);
    let executionResult: any;
    try {
      executionResult = await client.signAndExecuteTransaction({
        transaction,
        signer,
        include: {
          effects: true,
          events: true,
          objectTypes: true,
        },
      });
    } catch (executionError) {
      const reconciliation = await reconcileSubmittedSuiCharacter(
        client,
        identity,
        reconciliationDelaysMs,
      );
      if (reconciliation.result) {
        return reconciliation.result;
      }
      throw new SuiCharacterProvisioningError(
        "TRANSACTION_STATUS_UNKNOWN",
        "The Sui Character transaction may have committed, but its status could not be reconciled",
        {
          ambiguous: true,
          cause: reconciliation.lastError || executionError,
        },
      );
    }

    try {
      return parseSuccessfulTransaction(executionResult, identity);
    } catch (error) {
      if (!(error instanceof SuiCharacterProvisioningError)) {
        throw error;
      }
      const reconciliation = await reconcileSubmittedSuiCharacter(
        client,
        identity,
        reconciliationDelaysMs,
      );
      if (reconciliation.result) {
        const successfulTransaction = executionResult && executionResult.Transaction;
        return {
          ...reconciliation.result,
          transactionDigest:
            (successfulTransaction && successfulTransaction.digest) ||
            reconciliation.result.transactionDigest,
        };
      }

      if (error.ambiguous !== true && !reconciliation.lastError) {
        throw error;
      }
      throw new SuiCharacterProvisioningError(
        "TRANSACTION_STATUS_UNKNOWN",
        "The Sui Character transaction status could not be reconciled",
        {
          ambiguous: true,
          cause: reconciliation.lastError || error,
          transactionDigest: error.transactionDigest,
        },
      );
    }
  });
}

export {
  DEFAULT_WORLD_CONTRACTS_DIRECTORY,
  SUI_WORLD_SYNC_FORMAT,
  SUI_WORLD_SYNC_SCHEMA_VERSION,
  SUI_CHARACTER_ADMIN_ACL_ID,
  SUI_CHARACTER_OBJECT_REGISTRY_ID,
  SUI_CHARACTER_TENANT,
  SUI_CHARACTER_TRIBE_ID,
  SUI_CHARACTER_WORLD_PACKAGE_ID,
  SuiCharacterProvisioningError,
  createSuiCharacterTransaction,
  deriveLocalPlayerSuiWalletAddress,
  deriveSuiCharacterObjectId,
  findExistingSuiCharacter,
  prepareSuiCharacterIdentity,
  provisionSuiCharacter,
  readSyncedSuiWorldConfig,
  resolveAdminSigner,
  resolveSuiCharacterWorld,
  type SuiCharacterIdentity,
  type SuiCharacterProvisioningResult,
  type SuiCharacterWorld,
  type SuiWorldSyncConfig,
};
