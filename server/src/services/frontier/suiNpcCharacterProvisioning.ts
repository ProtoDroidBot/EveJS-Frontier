import { createHash } from "node:crypto";

import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { Transaction } from "@mysten/sui/transactions";
import { normalizeSuiAddress } from "@mysten/sui/utils";
import { suiGrpcClient } from "./suiGrpcClient";
import { readSuiNpcWorldConfig, assertSuiNpcWorldConfigCurrent, type SuiNpcWorldConfig } from "./suiNpcWorldConfig";
import { normalizeNpcLifecycle, reconcileSuiNpcProfile, type SuiNpcProfileJournal, type SuiNpcProfileResult } from "./suiNpcProfile";
const { isNpcCharacterID } = require("../_shared/npcIdentityConstants");

import {
  SUI_CHARACTER_TENANT,
  SuiCharacterProvisioningError,
  deriveSuiCharacterObjectId,
  provisionSuiCharacterWithIdentity,
  readLiveSuiChainIdentifier,
  resolveSuiCharacterWorld,
  type SuiCharacterOnChainIdentity,
  type SuiCharacterProvisioningOptions,
  type SuiCharacterProvisioningResult,
  type SuiCharacterSubmissionInput,
  type SuiCharacterWorld,
} from "./suiCharacterProvisioning";

type SuiNpcCharacterIdentity = SuiCharacterOnChainIdentity & {
  factionKey: string;
};

type SuiNpcCharacterInput = {
  gameCharacterId: unknown;
  characterName: unknown;
  factionKey: unknown;
  lifecycle?: { incarnation: unknown; activeEntityID: unknown; deaths: unknown };
};

type SuiNpcCharacterProvisioningOptions =
  SuiCharacterProvisioningOptions<SuiNpcCharacterIdentity> & {
    onCharacterProvisioned?: (result: SuiCharacterProvisioningResult<SuiNpcCharacterIdentity>) => void | Promise<void>;
    onNpcProfileTransactionPrepared?: (journal: SuiNpcProfileJournal) => void | Promise<void>;
    npcProfileTransactionFactory?: (context: any) => Transaction;
  };
type SuiNpcCharacterProvisioningResult =
  SuiCharacterProvisioningResult<SuiNpcCharacterIdentity> & {
    npcProfileObjectId: string;
    npcProfile: SuiNpcProfileResult;
    npcWorld: SuiNpcWorldConfig;
  };

function normalizeNpcFactionKey(value: unknown): string {
  const key = String(value || "").trim().toLowerCase();
  const match = /^(0|[1-9][0-9]*)-([a-z0-9][a-z0-9_-]{0,95})$/.exec(key);
  if (!match || Number(match[1]) > 0xffffffff) {
    throw new SuiCharacterProvisioningError(
      "INVALID_NPC_FACTION",
      "NPC faction key must be <u32 factionID>-<normalized faction string or none>",
    );
  }
  return key;
}

/**
 * Predictable development keys, strictly for the localnet integration. Neither
 * the seed nor private key is persisted. The separate npc-faction namespace
 * prevents an NPC faction from acquiring a local player account's wallet.
 */
function resolveLocalNpcFactionSuiSigner(
  factionKey: unknown,
  tenant: unknown = SUI_CHARACTER_TENANT,
): Ed25519Keypair {
  const key = normalizeNpcFactionKey(factionKey);
  const normalizedTenant = String(tenant || "").trim().toLowerCase();
  if (!normalizedTenant || /[\u0000-\u001f\u007f:]/.test(normalizedTenant)) {
    throw new SuiCharacterProvisioningError(
      "INVALID_WORLD_CONFIGURATION",
      "NPC wallet tenant must be nonempty and must not contain colons or control characters",
    );
  }
  const seedHex = createHash("sha512")
    .update(`${normalizedTenant}:npc-faction:${key}`, "utf8")
    .digest("hex");
  return Ed25519Keypair.deriveKeypairFromSeed(seedHex);
}

function deriveLocalNpcFactionSuiWalletAddress(
  factionKey: unknown,
  tenant: unknown = SUI_CHARACTER_TENANT,
): string {
  return resolveLocalNpcFactionSuiSigner(factionKey, tenant)
    .getPublicKey()
    .toSuiAddress();
}

function prepareSuiNpcCharacterIdentity(
  input: SuiNpcCharacterInput,
  options: {
    world?: Partial<SuiCharacterWorld>;
    env?: NodeJS.ProcessEnv;
  } = {},
): SuiNpcCharacterIdentity {
  const world = resolveSuiCharacterWorld(options.world, options.env);
  const gameCharacterId = Number(input.gameCharacterId);
  if (!isNpcCharacterID(gameCharacterId)) {
    throw new SuiCharacterProvisioningError("INVALID_NPC_CHARACTER_ID", "NPC character IDs must be in the reserved 1500000000–1599999999 range");
  }
  // Object ID derivation validates the contract's positive-u32 ID boundary.
  const characterObjectId = deriveSuiCharacterObjectId(
    world.objectRegistryId,
    gameCharacterId,
    world.packageId,
    world.tenant,
  );
  const characterName = String(input.characterName || "").trim();
  if (!characterName) {
    throw new SuiCharacterProvisioningError(
      "INVALID_CHARACTER",
      "NPC character name must not be empty",
    );
  }
  const factionKey = normalizeNpcFactionKey(input.factionKey);
  return {
    ...world,
    gameCharacterId,
    characterName,
    factionKey,
    walletAddress: deriveLocalNpcFactionSuiWalletAddress(factionKey, world.tenant),
    characterObjectId,
  };
}

/** Creates the Character, compatibility PlayerProfile and explicit NpcProfile atomically. */
function createSuiNpcCharacterTransaction(identity: SuiNpcCharacterIdentity, npcWorld: SuiNpcWorldConfig, lifecycle: SuiNpcCharacterInput["lifecycle"]) {
  const state = normalizeNpcLifecycle(lifecycle || { incarnation: 1, activeEntityID: 0, deaths: 0 });
  const split = identity.factionKey.indexOf("-");
  const factionID = Number(identity.factionKey.slice(0, split));
  const factionString = identity.factionKey.slice(split + 1);
  const transaction = new Transaction();
  const [character] = transaction.moveCall({
    target: `${npcWorld.npcPackageId}::npc::create_npc_character`,
    arguments: [
      transaction.object(identity.objectRegistryId), transaction.object(npcWorld.npcRegistryId),
      transaction.object(identity.adminAclId),
      transaction.pure.u32(identity.gameCharacterId), transaction.pure.string(identity.tenant),
      transaction.pure.u32(identity.tribeId), transaction.pure.address(identity.walletAddress),
      transaction.pure.string(identity.characterName), transaction.pure.u32(factionID),
      transaction.pure.string(factionString === "none" ? "" : factionString),
      transaction.pure.u64(state.incarnation), transaction.pure.u64(state.activeEntityID), transaction.pure.u64(state.deaths),
    ],
  });
  transaction.moveCall({
    target: `${identity.packageId}::character::share_character`,
    arguments: [character, transaction.object(identity.adminAclId)],
  });
  return transaction;
}

async function provisionSuiNpcCharacter(
  input: SuiNpcCharacterInput & SuiCharacterSubmissionInput<SuiNpcCharacterIdentity> & {
    npcProfileJournal?: SuiNpcProfileJournal;
    npcWorld?: SuiNpcWorldConfig;
  },
  options: SuiNpcCharacterProvisioningOptions = {},
): Promise<SuiNpcCharacterProvisioningResult> {
  const identity = prepareSuiNpcCharacterIdentity(input, options);
  const lifecycle = normalizeNpcLifecycle(input.lifecycle || { incarnation: 1, activeEntityID: 0, deaths: 0 });
  if (input.identity && !Object.keys(identity).every(key => {
    if (["packageId", "objectRegistryId", "adminAclId", "walletAddress", "characterObjectId"].includes(key)) {
      try { return normalizeSuiAddress(String(input.identity[key])) === normalizeSuiAddress(String(identity[key])); }
      catch { return false; }
    }
    return input.identity[key] === identity[key];
  })) {
    throw new SuiCharacterProvisioningError("INVALID_PREPARED_IDENTITY", "Prepared NPC identity does not match the requested pilot or faction");
  }
  const client = options.client || suiGrpcClient as any;
  const chainId = await readLiveSuiChainIdentifier(client);
  if (!chainId) throw new SuiCharacterProvisioningError("NPC_CHAIN_UNAVAILABLE", "A live Localnet chain identity is required for NPC provisioning");
  const baseWorld = { ...identity, chainId };
  const npcWorld = readSuiNpcWorldConfig(baseWorld, options.env);
  if (input.transactionDigest && input.npcWorld && input.npcWorld.fingerprint !== npcWorld.fingerprint) {
    throw new SuiCharacterProvisioningError("NPC_WORLD_CHANGED", "The NPC deployment changed while a Character transaction was pending", { ambiguous: true });
  }
  const result = await provisionSuiCharacterWithIdentity(
    { ...input, identity },
    {
      ...options,
      transactionFactory: options.transactionFactory || (prepared => createSuiNpcCharacterTransaction(prepared, npcWorld, lifecycle)),
      async onTransactionPrepared(prepared) {
        assertSuiNpcWorldConfigCurrent(npcWorld, baseWorld, options.env);
        await options.onTransactionPrepared?.({ ...prepared, npcWorld } as any);
        assertSuiNpcWorldConfigCurrent(npcWorld, baseWorld, options.env);
      },
    },
    (operationOptions) => prepareSuiNpcCharacterIdentity(input, operationOptions),
  );
  // Persist the completed Character phase independently. A subsequent profile
  // migration/lifecycle failure must never replace its creation journal.
  await options.onCharacterProvisioned?.(result);
  try {
    const npcProfile = await reconcileSuiNpcProfile({
      identity,
      lifecycle,
      journal: input.npcProfileJournal,
    }, {
      ...options,
      npcWorld,
      transactionFactory: options.npcProfileTransactionFactory,
      onTransactionPrepared: options.onNpcProfileTransactionPrepared,
    });
    return { ...result, npcProfileObjectId: npcProfile.npcProfileObjectId, npcProfile, npcWorld };
  } catch (error) {
    // The worker routes errors to the correct phase's independent journal.
    (error as any).npcProfileOperation = true;
    throw error;
  }
}

export {
  deriveLocalNpcFactionSuiWalletAddress,
  createSuiNpcCharacterTransaction,
  prepareSuiNpcCharacterIdentity,
  provisionSuiNpcCharacter,
  resolveLocalNpcFactionSuiSigner,
  type SuiNpcCharacterIdentity,
  type SuiNpcCharacterInput,
  type SuiNpcCharacterProvisioningOptions,
  type SuiNpcCharacterProvisioningResult,
};
