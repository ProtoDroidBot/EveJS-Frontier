import { createHash } from "node:crypto";
import fs = require("node:fs");
import path = require("node:path");

import { bcs } from "@mysten/sui/bcs";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { Transaction, TransactionDataBuilder } from "@mysten/sui/transactions";
import {
  deriveObjectID,
  fromBase58,
  normalizeSuiAddress,
  toHex,
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
const SUI_CHARACTER_TRANSACTION_INCLUDE = Object.freeze({
  effects: true,
  events: true,
  objectTypes: true,
});

const DEFAULT_WORLD_CONTRACTS_DIRECTORY = path.resolve(
  __dirname,
  "../../../..",
  "world-contracts",
);

const TenantItemId = bcs.struct("TenantItemId", {
  id: bcs.u64(),
  tenant: bcs.string(),
});

type SuiCharacterClient = {
  getObject: (options: Record<string, any>) => Promise<any>;
  getObjects?: (options: Record<string, any>) => Promise<any>;
  getTransaction?: (options: Record<string, any>) => Promise<any>;
  getChainIdentifier?: (options?: Record<string, any>) => Promise<any>;
  listOwnedObjects: (options: Record<string, any>) => Promise<any>;
  executeTransaction?: (options: Record<string, any>) => Promise<any>;
  signAndExecuteTransaction: (options: Record<string, any>) => Promise<any>;
  core?: unknown;
  ledgerService?: {
    getServiceInfo: (options: Record<string, any>) => Promise<any> | any;
  };
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
  sourceWorkspace?: string;
  deploymentSha256?: string;
  publicationSha256?: string;
  assemblyEnergySha256?: string;
  assemblyEnergy?: Array<{ typeID: number; energyRequired: number }>;
};

type SuiCharacterOnChainIdentity = SuiCharacterWorld & {
  gameCharacterId: number;
  characterName: string;
  walletAddress: string;
  characterObjectId: string;
};

type SuiCharacterIdentity = SuiCharacterOnChainIdentity & {
  accountId: number;
};

type SuiCharacterProvisioningResult<
  TIdentity extends SuiCharacterOnChainIdentity = SuiCharacterIdentity,
> = TIdentity & {
  network: typeof SUI_GRPC_NETWORK;
  baseUrl: typeof SUI_GRPC_BASE_URL;
  playerProfileObjectId: string;
  transactionDigest: string;
  recovered: boolean;
  chainId?: string | null;
};

type SuiCharacterProvisioningOptions<
  TIdentity extends SuiCharacterOnChainIdentity = SuiCharacterIdentity,
> = {
  client?: SuiCharacterClient;
  world?: Partial<SuiCharacterWorld>;
  env?: NodeJS.ProcessEnv;
  adminSigner?: any;
  adminPrivateKey?: string;
  worldContractsDirectory?: string;
  reconciliationDelaysMs?: number[];
  transactionFactory?: (identity: TIdentity) => Transaction;
  onTransactionPrepared?: (details: {
    transactionDigest: string;
    transactionBytesBase64?: string;
    transactionSignature?: string;
    chainId?: string | null;
  }) => void | Promise<void>;
};

type SuiCharacterSubmissionInput<
  TIdentity extends SuiCharacterOnChainIdentity = SuiCharacterIdentity,
> = {
  identity?: TIdentity;
  transactionDigest?: unknown;
  transactionBytesBase64?: unknown;
  transactionSignature?: unknown;
  chainId?: unknown;
};

type SuiCharacterProvisioningSnapshot<
  TIdentity extends SuiCharacterOnChainIdentity = SuiCharacterIdentity,
> = {
  options: SuiCharacterProvisioningOptions<TIdentity>;
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

function readSha256(filePath: string): string {
  return createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
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
  let assemblyEnergy: Array<{ typeID: number; energyRequired: number }> | undefined;
  if (config.assemblyEnergy !== undefined) {
    const energy = config.assemblyEnergy;
    if (!energy || typeof energy !== "object" || Array.isArray(energy) ||
        energy.schemaVersion !== 1 || energy.clientBuild !== expectedBuild ||
        !Array.isArray(energy.entries) || energy.entries.length === 0) {
      return invalid("contains an invalid assembly energy manifest");
    }
    const seen = new Set<number>();
    let previousTypeID = 0;
    assemblyEnergy = energy.entries.map((entry: any) => {
      const typeID = entry?.typeID;
      const energyRequired = entry?.energyRequired;
      if (!Number.isSafeInteger(typeID) || typeID <= 0 || typeID <= previousTypeID || seen.has(typeID) ||
          !Number.isSafeInteger(energyRequired) || energyRequired < 0) {
        return invalid("contains an invalid assembly energy entry");
      }
      seen.add(typeID);
      previousTypeID = typeID;
      return { typeID, energyRequired };
    });
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

  const sourceWorkspace = typeof config.sourceWorkspace === "string"
    ? config.sourceWorkspace.trim()
    : "";
  const artifacts = config.artifacts && typeof config.artifacts === "object"
    ? config.artifacts
    : null;
  const deploymentSha256 = typeof artifacts?.deploymentSha256 === "string"
    ? artifacts.deploymentSha256.trim().toLowerCase()
    : "";
  const publicationSha256 = typeof artifacts?.publicationSha256 === "string"
    ? artifacts.publicationSha256.trim().toLowerCase()
    : "";
  const assemblyEnergySha256 = typeof artifacts?.assemblyEnergySha256 === "string"
    ? artifacts.assemblyEnergySha256.trim().toLowerCase()
    : "";
  const hasArtifactSnapshot = Boolean(
    sourceWorkspace || deploymentSha256 || publicationSha256,
  );
  if (
    hasArtifactSnapshot &&
    (!sourceWorkspace ||
      !/^[0-9a-f]{64}$/.test(deploymentSha256) ||
      !/^[0-9a-f]{64}$/.test(publicationSha256))
  ) {
    return invalid("contains incomplete deployment artifact metadata");
  }
  if ((assemblyEnergy !== undefined || assemblyEnergySha256) &&
      (!sourceWorkspace || !assemblyEnergy || !/^[0-9a-f]{64}$/.test(assemblyEnergySha256))) {
    return invalid("contains incomplete assembly energy artifact metadata");
  }
  if (hasArtifactSnapshot) {
    const deploymentPath = path.join(
      path.resolve(sourceWorkspace),
      "world-contracts",
      "deployments",
      "localnet",
      "extracted-object-ids.json",
    );
    const publicationPath = path.join(
      path.resolve(sourceWorkspace),
      "world-contracts",
      "contracts",
      "world",
      "Pub.localnet.toml",
    );
    let currentDeploymentSha256: string;
    let currentPublicationSha256: string;
    try {
      currentDeploymentSha256 = readSha256(deploymentPath);
      currentPublicationSha256 = readSha256(publicationPath);
    } catch (cause) {
      throw new SuiCharacterProvisioningError(
        "INVALID_WORLD_CONFIGURATION",
        `Synchronized Sui world deployment artifacts could not be read; run FrontierWorld.ps1 sync: ${configPath}`,
        { cause },
      );
    }
    if (
      currentDeploymentSha256 !== deploymentSha256 ||
      currentPublicationSha256 !== publicationSha256
    ) {
      return invalid(
        "is stale relative to its deployment artifacts; run FrontierWorld.ps1 sync",
      );
    }
    if (assemblyEnergySha256) {
      const assemblyEnergyPath = path.join(
        path.resolve(sourceWorkspace),
        "world-contracts",
        "config",
        "assembly-energy.json",
      );
      let currentAssemblyEnergySha256: string;
      try {
        currentAssemblyEnergySha256 = readSha256(assemblyEnergyPath);
      } catch (cause) {
        throw new SuiCharacterProvisioningError(
          "INVALID_WORLD_CONFIGURATION",
          `Synchronized assembly energy artifact could not be read; run FrontierWorld.ps1 sync: ${configPath}`,
          { cause },
        );
      }
      if (currentAssemblyEnergySha256 !== assemblyEnergySha256) {
        return invalid("is stale relative to its assembly energy manifest; run FrontierWorld.ps1 sync");
      }
    }
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
    ...(hasArtifactSnapshot
      ? {
          sourceWorkspace: path.resolve(sourceWorkspace),
          deploymentSha256,
          publicationSha256,
          ...(assemblyEnergySha256 ? { assemblyEnergySha256 } : {}),
        }
      : {}),
    ...(assemblyEnergy ? { assemblyEnergy } : {}),
  };
}

function snapshotSuiCharacterProvisioningOptions<TIdentity extends SuiCharacterOnChainIdentity>(
  options: SuiCharacterProvisioningOptions<TIdentity>,
): SuiCharacterProvisioningSnapshot<TIdentity> {
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

function assertSuiProvisioningSnapshotCurrent<TIdentity extends SuiCharacterOnChainIdentity>(
  snapshot: SuiCharacterProvisioningSnapshot<TIdentity>,
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
  if (require("../_shared/npcIdentityConstants").isNpcCharacterID(gameCharacterId)) {
    throw new SuiCharacterProvisioningError("NPC_CHARACTER_NOT_PLAYER", "Reserved NPC pilot IDs cannot be provisioned as human player characters");
  }
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
  identity: SuiCharacterOnChainIdentity,
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
  const seen = new Set<unknown>();
  let current = error;
  while (current && typeof current === "object" && !seen.has(current)) {
    seen.add(current);
    const candidate = current as any;
    if (
      candidate.reason === "notFound" ||
      candidate.code === "notExists" ||
      candidate.code === "NOT_FOUND" ||
      /\bobject\s+0x[0-9a-f]+\s+not found\b/i.test(
        String(candidate.message || ""),
      )
    ) {
      return true;
    }
    current = candidate.cause;
  }
  return false;
}

function isTransactionNotFoundError(error: unknown): boolean {
  return Boolean(
    error &&
      typeof error === "object" &&
      (error as any).reason === "notFound" &&
      typeof (error as any).digest === "string",
  );
}

function normalizeSuiChainIdentifier(value: unknown): string {
  const rawValue = String(value || "").trim();
  if (/^[0-9a-fA-F]{8,}$/.test(rawValue)) {
    return rawValue.slice(0, 8).toLowerCase();
  }
  try {
    const bytes = fromBase58(rawValue);
    if (bytes.length === 32) {
      return toHex(bytes.slice(0, 4)).toLowerCase();
    }
  } catch {
    // Report an invalid live response through the provisioning precheck below.
  }
  return "";
}

async function readLiveSuiChainIdentifier(
  client: SuiCharacterClient,
): Promise<string | null> {
  if (
    client.ledgerService &&
    typeof client.ledgerService.getServiceInfo === "function"
  ) {
    const result = await client.ledgerService.getServiceInfo({});
    return normalizeSuiChainIdentifier(
      result && result.response ? result.response.chainId : null,
    );
  }
  if (typeof client.getChainIdentifier === "function") {
    const result = await client.getChainIdentifier();
    return normalizeSuiChainIdentifier(result && result.chainIdentifier);
  }
  return null;
}

async function assertLiveSuiChain<TIdentity extends SuiCharacterOnChainIdentity>(
  client: SuiCharacterClient,
  snapshot: SuiCharacterProvisioningSnapshot<TIdentity>,
  recordedChainId: unknown = null,
): Promise<string | null> {
  let liveChainId: string | null;
  try {
    liveChainId = await readLiveSuiChainIdentifier(client);
  } catch (cause) {
    throw new SuiCharacterProvisioningError(
      "PRECHECK_FAILED",
      "The local Sui chain identity could not be verified before Character creation",
      { cause },
    );
  }
  if (liveChainId === "") {
    throw new SuiCharacterProvisioningError(
      "PRECHECK_FAILED",
      "The local Sui node returned an invalid chain identity",
    );
  }
  const expectedChainId = normalizeSuiChainIdentifier(
    recordedChainId || snapshot.syncedConfig?.chainId,
  );
  if (expectedChainId && liveChainId && liveChainId !== expectedChainId) {
    throw new SuiCharacterProvisioningError(
      "WORLD_CHAIN_MISMATCH",
      `The pending or synchronized Sui world targets chain ${expectedChainId}, but the live localnet is ${liveChainId}; run FrontierWorld.ps1 sync`,
    );
  }
  return liveChainId;
}

async function assertLiveSuiWorldObjects(
  client: SuiCharacterClient,
  identity: SuiCharacterOnChainIdentity,
): Promise<void> {
  if (typeof client.getObjects !== "function") {
    return;
  }

  const expectedObjects = [
    {
      objectId: identity.packageId,
      type: "package",
      shared: false,
      label: "world package",
    },
    {
      objectId: identity.objectRegistryId,
      type: `${identity.packageId}::object_registry::ObjectRegistry`,
      shared: true,
      label: "ObjectRegistry",
    },
    {
      objectId: identity.adminAclId,
      type: `${identity.packageId}::access::AdminACL`,
      shared: true,
      label: "AdminACL",
    },
  ];
  let response: any;
  try {
    response = await client.getObjects({
      objectIds: expectedObjects.map(({ objectId }) => objectId),
    });
  } catch (cause) {
    throw new SuiCharacterProvisioningError(
      "PRECHECK_FAILED",
      "The synchronized Sui world objects could not be verified before Character creation",
      { cause },
    );
  }
  const objects = Array.isArray(response && response.objects)
    ? response.objects
    : [];
  for (let index = 0; index < expectedObjects.length; index++) {
    const expected = expectedObjects[index];
    const object = objects[index];
    if (object instanceof Error && !isObjectNotFoundError(object)) {
      throw new SuiCharacterProvisioningError(
        "PRECHECK_FAILED",
        `The configured Sui ${expected.label} could not be verified before Character creation`,
        { cause: object },
      );
    }
    if (
      !object ||
      isObjectNotFoundError(object) ||
      object.type !== expected.type ||
      (expected.shared && (!object.owner || object.owner.$kind !== "Shared"))
    ) {
      const cause = object instanceof Error ? object : undefined;
      throw new SuiCharacterProvisioningError(
        "WORLD_CONFIGURATION_STALE",
        `The configured Sui ${expected.label} ${expected.objectId} is unavailable or does not match the synchronized world; run FrontierWorld.ps1 sync`,
        { cause },
      );
    }
  }
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
  identity: SuiCharacterOnChainIdentity,
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

async function findExistingSuiCharacter<TIdentity extends SuiCharacterOnChainIdentity>(
  client: SuiCharacterClient,
  identity: TIdentity,
): Promise<SuiCharacterProvisioningResult<TIdentity> | null> {
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
      `Existing Sui object ${identity.characterObjectId} does not match this character`,
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

async function reconcileSubmittedSuiCharacter<TIdentity extends SuiCharacterOnChainIdentity>(
  client: SuiCharacterClient,
  identity: TIdentity,
  delaysMs: number[] = [0, 150, 500, 1000],
  transactionDigest: string | null = null,
): Promise<{
  result: SuiCharacterProvisioningResult<TIdentity> | null;
  lastError: unknown;
  definitiveError: SuiCharacterProvisioningError | null;
}> {
  let lastError: unknown = null;
  for (const rawDelayMs of delaysMs) {
    const delayMs = Math.max(0, Math.min(5000, Number(rawDelayMs) || 0));
    await waitForReconciliationDelay(delayMs);
    if (transactionDigest && typeof client.getTransaction === "function") {
      try {
        const transactionResult = await client.getTransaction({
          digest: transactionDigest,
          include: SUI_CHARACTER_TRANSACTION_INCLUDE,
        });
        try {
          return {
            result: parseSuccessfulTransaction(transactionResult, identity),
            lastError: null,
            definitiveError: null,
          };
        } catch (error) {
          if (
            error instanceof SuiCharacterProvisioningError &&
            error.code === "TRANSACTION_FAILED"
          ) {
            return {
              result: null,
              lastError: null,
              definitiveError: error,
            };
          }
          lastError = error;
        }
      } catch (error) {
        if (!isTransactionNotFoundError(error)) {
          lastError = error;
        }
      }
    }
    try {
      const result = await findExistingSuiCharacter(client, identity);
      if (result) {
        return {
          result: {
            ...result,
            transactionDigest: transactionDigest || result.transactionDigest,
          },
          lastError: null,
          definitiveError: null,
        };
      }
      if (!transactionDigest) {
        lastError = null;
      }
    } catch (error) {
      lastError = error;
    }
  }
  return { result: null, lastError, definitiveError: null };
}

function parseSuccessfulTransaction<TIdentity extends SuiCharacterOnChainIdentity>(
  result: any,
  identity: TIdentity,
): SuiCharacterProvisioningResult<TIdentity> {
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
  if (
    !transaction ||
    !transaction.status ||
    typeof transaction.status.success !== "boolean"
  ) {
    throw new SuiCharacterProvisioningError(
      "TRANSACTION_STATUS_UNKNOWN",
      "Sui Character transaction returned an incomplete status",
      {
        ambiguous: true,
        transactionDigest: transaction && transaction.digest,
      },
    );
  }
  if (transaction.status.success === false) {
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

function readPreparedTransactionSubmission(
  input: {
    transactionBytesBase64?: unknown;
    transactionSignature?: unknown;
  },
  transactionDigest: string,
): { transactionBytes: Uint8Array; signature: string } | null {
  const transactionBytesBase64 = String(
    input.transactionBytesBase64 || "",
  ).trim();
  const signature = String(input.transactionSignature || "").trim();
  if (!transactionBytesBase64 && !signature) {
    return null;
  }
  try {
    const decodedBytes = Buffer.from(transactionBytesBase64, "base64");
    if (
      !decodedBytes.length ||
      decodedBytes.toString("base64") !== transactionBytesBase64 ||
      !signature ||
      TransactionDataBuilder.getDigestFromBytes(decodedBytes) !==
        transactionDigest
    ) {
      throw new Error("Prepared transaction journal does not match its digest");
    }
    return { transactionBytes: new Uint8Array(decodedBytes), signature };
  } catch (cause) {
    throw new SuiCharacterProvisioningError(
      "PENDING_TRANSACTION_INVALID",
      "The pending Sui Character transaction journal is incomplete or corrupt",
      { ambiguous: true, cause, transactionDigest },
    );
  }
}

async function executePreparedSuiCharacterTransaction<TIdentity extends SuiCharacterOnChainIdentity>(
  client: SuiCharacterClient,
  identity: TIdentity,
  prepared: { transactionBytes: Uint8Array; signature: string },
  transactionDigest: string,
  reconciliationDelaysMs: number[],
): Promise<SuiCharacterProvisioningResult<TIdentity>> {
  if (typeof client.executeTransaction !== "function") {
    throw new SuiCharacterProvisioningError(
      "PENDING_TRANSACTION_REPLAY_UNAVAILABLE",
      "The pending Sui Character transaction cannot be replayed by this Sui client",
      { ambiguous: true, transactionDigest },
    );
  }

  let executionResult: any;
  try {
    executionResult = await client.executeTransaction({
      transaction: prepared.transactionBytes,
      signatures: [prepared.signature],
      include: SUI_CHARACTER_TRANSACTION_INCLUDE,
    });
  } catch (executionError) {
    const reconciliation = await reconcileSubmittedSuiCharacter(
      client,
      identity,
      reconciliationDelaysMs,
      transactionDigest,
    );
    if (reconciliation.result) {
      return reconciliation.result;
    }
    if (reconciliation.definitiveError) {
      throw reconciliation.definitiveError;
    }
    throw new SuiCharacterProvisioningError(
      "TRANSACTION_STATUS_UNKNOWN",
      "The Sui Character transaction may have committed, but its status could not be reconciled",
      {
        ambiguous: true,
        cause: reconciliation.lastError || executionError,
        transactionDigest,
      },
    );
  }

  try {
    return parseSuccessfulTransaction(executionResult, identity);
  } catch (error) {
    const resultError = error instanceof SuiCharacterProvisioningError
      ? error
      : new SuiCharacterProvisioningError(
          "TRANSACTION_STATUS_UNKNOWN",
          "The Sui Character transaction returned an unreadable result",
          {
            ambiguous: true,
            cause: error,
            transactionDigest,
          },
        );
    if (resultError.code === "TRANSACTION_FAILED") {
      throw resultError;
    }
    const reconciliation = await reconcileSubmittedSuiCharacter(
      client,
      identity,
      reconciliationDelaysMs,
      resultError.transactionDigest || transactionDigest,
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
    if (reconciliation.definitiveError) {
      throw reconciliation.definitiveError;
    }
    if (resultError.ambiguous !== true && !reconciliation.lastError) {
      throw resultError;
    }
    throw new SuiCharacterProvisioningError(
      "TRANSACTION_STATUS_UNKNOWN",
      "The Sui Character transaction status could not be reconciled",
      {
        ambiguous: true,
        cause: reconciliation.lastError || resultError,
        transactionDigest:
          resultError.transactionDigest || transactionDigest,
      },
    );
  }
}

async function provisionSuiCharacter(
  input: {
    accountId: unknown;
    gameCharacterId: unknown;
    characterName: unknown;
  } & SuiCharacterSubmissionInput,
  options: SuiCharacterProvisioningOptions = {},
): Promise<SuiCharacterProvisioningResult> {
  return provisionSuiCharacterWithIdentity(
    input,
    options,
    (operationOptions) => prepareSuiCharacterIdentity(input, operationOptions),
  );
}

/** Shared account-independent creation/reconciliation path for players and NPCs. */
async function provisionSuiCharacterWithIdentity<TIdentity extends SuiCharacterOnChainIdentity>(
  input: SuiCharacterSubmissionInput<TIdentity>,
  options: SuiCharacterProvisioningOptions<TIdentity>,
  prepareIdentity: (options: SuiCharacterProvisioningOptions<TIdentity>) => TIdentity,
): Promise<SuiCharacterProvisioningResult<TIdentity>> {
  const client = options.client || (suiGrpcClient as unknown as SuiCharacterClient);
  const reconciliationDelaysMs = Array.isArray(options.reconciliationDelaysMs)
    ? options.reconciliationDelaysMs
    : [0, 150, 500, 1000];

  let operationChainId: string | null = null;
  const result = await serializeAdminSubmission(async () => {
    const snapshot = snapshotSuiCharacterProvisioningOptions(options);
    const operationOptions = snapshot.options;
    const identity = prepareIdentity(operationOptions);
    if (input.identity) {
      const suppliedIdentity = input.identity;
      const identityMatches =
        Object.keys(identity).every((field) => {
          if ([
            "packageId", "objectRegistryId", "adminAclId", "walletAddress",
            "characterObjectId",
          ].includes(field)) {
            return sameSuiAddress(suppliedIdentity[field], identity[field]);
          }
          return suppliedIdentity[field] === identity[field];
        });
      if (!identityMatches) {
        throw new SuiCharacterProvisioningError(
          "INVALID_PREPARED_IDENTITY",
          "Prepared Sui Character identity does not match its creation request",
        );
      }
    }

    const pendingTransactionDigest = String(
      input.transactionDigest || "",
    ).trim();
    const recordedChainId = String(input.chainId || "").trim();
    if (recordedChainId && !normalizeSuiChainIdentifier(recordedChainId)) {
      throw new SuiCharacterProvisioningError(
        "PENDING_TRANSACTION_INVALID",
        "The pending Sui Character transaction has an invalid recorded chain identity",
        {
          ambiguous: Boolean(pendingTransactionDigest),
          transactionDigest: pendingTransactionDigest || null,
        },
      );
    }

    assertSuiProvisioningSnapshotCurrent(snapshot);
    const liveChainId = await assertLiveSuiChain(
      client,
      snapshot,
      pendingTransactionDigest ? recordedChainId : null,
    );
    operationChainId = liveChainId;
    assertSuiProvisioningSnapshotCurrent(snapshot);

    if (pendingTransactionDigest) {
      const reconciliation = await reconcileSubmittedSuiCharacter(
        client,
        identity,
        reconciliationDelaysMs,
        pendingTransactionDigest,
      );
      if (reconciliation.result) {
        return reconciliation.result;
      }
      if (reconciliation.definitiveError) {
        throw reconciliation.definitiveError;
      }
      const prepared = readPreparedTransactionSubmission(
        input,
        pendingTransactionDigest,
      );
      if (prepared) {
        if (!recordedChainId || !liveChainId) {
          throw new SuiCharacterProvisioningError(
            "PENDING_TRANSACTION_CHAIN_UNKNOWN",
            "The pending Sui Character transaction cannot be replayed without a verified chain identity",
            {
              ambiguous: true,
              transactionDigest: pendingTransactionDigest,
            },
          );
        }
        assertSuiProvisioningSnapshotCurrent(snapshot);
        return executePreparedSuiCharacterTransaction(
          client,
          identity,
          prepared,
          pendingTransactionDigest,
          reconciliationDelaysMs,
        );
      }
      throw new SuiCharacterProvisioningError(
        "TRANSACTION_STATUS_UNKNOWN",
        "The pending Sui Character transaction status could not be reconciled",
        {
          ambiguous: true,
          cause: reconciliation.lastError,
          transactionDigest: pendingTransactionDigest,
        },
      );
    }

    await assertLiveSuiWorldObjects(client, identity);
    assertSuiProvisioningSnapshotCurrent(snapshot);

    let existing: SuiCharacterProvisioningResult<TIdentity> | null;
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
    const transaction = operationOptions.transactionFactory
      ? operationOptions.transactionFactory(identity)
      : createSuiCharacterTransaction(identity);
    if (typeof client.executeTransaction === "function") {
      let transactionBytes: Uint8Array;
      let signature: string;
      let preparedTransactionDigest: string;
      try {
        transaction.setSenderIfNotSet(signer.toSuiAddress());
        transactionBytes = await transaction.build({ client: client as any });
        const signedTransaction = await signer.signTransaction(transactionBytes);
        if (!signedTransaction || typeof signedTransaction.signature !== "string") {
          throw new Error("The Sui admin signer returned no transaction signature");
        }
        preparedTransactionDigest =
          TransactionDataBuilder.getDigestFromBytes(transactionBytes);
        signature = signedTransaction.signature;
      } catch (cause) {
        throw new SuiCharacterProvisioningError(
          "TRANSACTION_NOT_SUBMITTED",
          isObjectNotFoundError(cause)
            ? "The Sui Character transaction was not submitted because a configured world object was not found; run FrontierWorld.ps1 sync"
            : "The Sui Character transaction could not be prepared and was not submitted",
          { cause },
        );
      }

      assertSuiProvisioningSnapshotCurrent(snapshot);
      if (typeof operationOptions.onTransactionPrepared === "function") {
        try {
          await operationOptions.onTransactionPrepared({
            transactionDigest: preparedTransactionDigest,
            transactionBytesBase64: Buffer.from(transactionBytes).toString("base64"),
            transactionSignature: signature,
            chainId: liveChainId,
          });
        } catch (cause) {
          throw new SuiCharacterProvisioningError(
            "TRANSACTION_NOT_SUBMITTED",
            "The prepared Sui Character transaction could not be recorded and was not submitted",
            { cause, transactionDigest: preparedTransactionDigest },
          );
        }
      }

      return executePreparedSuiCharacterTransaction(
        client,
        identity,
        { transactionBytes, signature },
        preparedTransactionDigest,
        reconciliationDelaysMs,
      );
    }

    let executionResult: any;
    try {
      executionResult = await client.signAndExecuteTransaction({
        transaction,
        signer,
        include: SUI_CHARACTER_TRANSACTION_INCLUDE,
      });
    } catch (executionError) {
      if (
        (isObjectNotFoundError(executionError) ||
          (executionError as any)?.constructor?.name === "SimulationError")
      ) {
        throw new SuiCharacterProvisioningError(
          "TRANSACTION_NOT_SUBMITTED",
          isObjectNotFoundError(executionError)
            ? "The Sui Character transaction was not submitted because a configured world object was not found; run FrontierWorld.ps1 sync"
            : "The Sui Character transaction failed during preparation and was not submitted",
          { cause: executionError },
        );
      }
      const reconciliation = await reconcileSubmittedSuiCharacter(
        client,
        identity,
        reconciliationDelaysMs,
        null,
      );
      if (reconciliation.result) {
        return reconciliation.result;
      }
      if (reconciliation.definitiveError) {
        throw reconciliation.definitiveError;
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
      const returnedDigest = String(
        (executionResult && executionResult.Transaction &&
          executionResult.Transaction.digest) ||
          (executionResult && executionResult.FailedTransaction &&
            executionResult.FailedTransaction.digest) ||
          "",
      ).trim();
      const resultError = error instanceof SuiCharacterProvisioningError
        ? error
        : new SuiCharacterProvisioningError(
            "TRANSACTION_STATUS_UNKNOWN",
            "The Sui Character transaction returned an unreadable result",
            {
              ambiguous: true,
              cause: error,
              transactionDigest: returnedDigest || null,
            },
          );
      if (resultError.code === "TRANSACTION_FAILED") {
        throw resultError;
      }
      const knownDigest = resultError.transactionDigest || returnedDigest || null;
      const reconciliation = await reconcileSubmittedSuiCharacter(
        client,
        identity,
        reconciliationDelaysMs,
        knownDigest,
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
      if (reconciliation.definitiveError) {
        throw reconciliation.definitiveError;
      }

      if (resultError.ambiguous !== true && !reconciliation.lastError) {
        throw resultError;
      }
      throw new SuiCharacterProvisioningError(
        "TRANSACTION_STATUS_UNKNOWN",
        "The Sui Character transaction status could not be reconciled",
        {
          ambiguous: true,
          cause: reconciliation.lastError || resultError,
          transactionDigest: knownDigest,
        },
      );
    }
  });
  return { ...result, chainId: operationChainId };
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
  isObjectNotFoundError,
  prepareSuiCharacterIdentity,
  provisionSuiCharacter,
  provisionSuiCharacterWithIdentity,
  readLiveSuiChainIdentifier,
  readSyncedSuiWorldConfig,
  resolveAdminSigner,
  resolveSuiCharacterWorld,
  serializeAdminSubmission,
  type SuiCharacterIdentity,
  type SuiCharacterOnChainIdentity,
  type SuiCharacterProvisioningOptions,
  type SuiCharacterProvisioningResult,
  type SuiCharacterSubmissionInput,
  type SuiCharacterWorld,
  type SuiWorldSyncConfig,
};
