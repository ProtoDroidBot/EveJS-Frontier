import { bcs } from "@mysten/sui/bcs";
import { Transaction, TransactionDataBuilder } from "@mysten/sui/transactions";
import { deriveObjectID, normalizeSuiAddress } from "@mysten/sui/utils";

import {
  SuiCharacterProvisioningError,
  isObjectNotFoundError,
  readLiveSuiChainIdentifier,
  resolveAdminSigner,
  resolveSuiCharacterWorld,
  serializeAdminSubmission,
  type SuiCharacterProvisioningOptions,
} from "./suiCharacterProvisioning";
import { suiGrpcClient } from "./suiGrpcClient";
import type { SuiNpcCharacterIdentity } from "./suiNpcCharacterProvisioning";
import { assertSuiNpcWorldConfigCurrent, type SuiNpcWorldConfig } from "./suiNpcWorldConfig";

const NpcProfileKey = bcs.struct("NpcProfileKey", { character_id: bcs.Address });
const U64_MAX = (1n << 64n) - 1n;
const TRANSACTION_INCLUDE = Object.freeze({ effects: true, events: true, objectTypes: true });

export type SuiNpcLifecycle = { incarnation: string; activeEntityID: string; deaths: string };
export type SuiNpcLifecycleInput = { incarnation: unknown; activeEntityID?: unknown; deaths: unknown };
export type SuiNpcProfileJournal = {
  transactionDigest: string;
  transactionBytesBase64?: string;
  transactionSignature?: string;
  chainId: string;
  npcWorldFingerprint: string;
  npcPackageId: string;
  npcTypeOrigin: string;
  characterObjectId: string;
  npcProfileObjectId: string;
  operation: "register" | "sync";
  expectedRevision?: string;
  lifecycle: SuiNpcLifecycle;
};
export type SuiNpcProfileResult = SuiNpcLifecycle & {
  npcProfileObjectId: string;
  revision: string;
  retired: boolean;
  chainId: string;
  transactionDigest: string;
  recovered: boolean;
};
type TransactionContext = {
  operation: "register" | "sync";
  identity: SuiNpcCharacterIdentity;
  lifecycle: SuiNpcLifecycle;
  npcProfileObjectId: string;
  expectedRevision?: string;
  npcWorld: SuiNpcWorldConfig;
};
export type SuiNpcProfileOptions = Omit<
  SuiCharacterProvisioningOptions<SuiNpcCharacterIdentity>, "onTransactionPrepared" | "transactionFactory"
> & {
  npcWorld: SuiNpcWorldConfig;
  transactionFactory?: (context: TransactionContext) => Transaction;
  onTransactionPrepared?: (journal: SuiNpcProfileJournal) => void | Promise<void>;
};

function fail(code: string, message: string, options: { ambiguous?: boolean; transactionDigest?: string; cause?: unknown } = {}): never {
  throw new SuiCharacterProvisioningError(code, message, options);
}

function address(value: unknown): string {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{1,64}$/.test(value)) {
    return fail("NPC_PROFILE_BINDING_MISMATCH", "NPC profile contains an invalid address");
  }
  return normalizeSuiAddress(value);
}

function u64(value: unknown, label: string): string {
  if (typeof value === "number" && !Number.isSafeInteger(value)) {
    return fail("INVALID_NPC_LIFECYCLE", `${label} must be a safe integer or decimal u64 string`);
  }
  const text = String(value ?? "");
  if (!/^[0-9]+$/.test(text) || BigInt(text) > U64_MAX) {
    return fail("INVALID_NPC_LIFECYCLE", `${label} must fit a u64`);
  }
  return BigInt(text).toString();
}

export function normalizeNpcLifecycle(input: SuiNpcLifecycleInput): SuiNpcLifecycle {
  if (!input || typeof input !== "object") {
    return fail("INVALID_NPC_LIFECYCLE", "NPC lifecycle snapshot is missing");
  }
  const lifecycle = {
    incarnation: u64(input.incarnation, "NPC incarnation"),
    activeEntityID: u64(input.activeEntityID ?? 0, "NPC active entity ID"),
    deaths: u64(input.deaths, "NPC deaths"),
  };
  if (BigInt(lifecycle.incarnation) === 0n ||
    BigInt(lifecycle.deaths) > BigInt(lifecycle.incarnation) ||
    (BigInt(lifecycle.activeEntityID) > 0n && BigInt(lifecycle.deaths) >= BigInt(lifecycle.incarnation))) {
    return fail("INVALID_NPC_LIFECYCLE", "NPC incarnation and death counters are inconsistent");
  }
  return lifecycle;
}

function sameLifecycle(left: SuiNpcLifecycle, right: SuiNpcLifecycle) {
  return left.incarnation === right.incarnation && left.activeEntityID === right.activeEntityID && left.deaths === right.deaths;
}

function assertLifecycleCanAdvance(current: SuiNpcLifecycle, desired: SuiNpcLifecycle) {
  const oldInc = BigInt(current.incarnation), newInc = BigInt(desired.incarnation);
  const oldDeaths = BigInt(current.deaths), newDeaths = BigInt(desired.deaths);
  const oldActive = BigInt(current.activeEntityID) > 0n, newActive = BigInt(desired.activeEntityID) > 0n;
  let valid = newInc >= oldInc && newDeaths >= oldDeaths;
  if (valid && oldInc === newInc) {
    valid = current.activeEntityID === desired.activeEntityID
      ? oldDeaths === newDeaths
      : oldActive && !newActive && newDeaths - oldDeaths <= 1n;
  } else if (valid) {
    valid = newDeaths - oldDeaths <= newInc - oldInc + (oldActive ? 1n : 0n) - (newActive ? 1n : 0n) &&
      !(newActive && current.activeEntityID === desired.activeEntityID);
  }
  if (!valid) fail("NPC_LIFECYCLE_STALE", "NPC lifecycle snapshot cannot replace the current on-chain lifecycle");
}

export function deriveSuiNpcProfileObjectId(objectRegistryId: string, characterObjectId: string, npcTypeOrigin: string) {
  return deriveObjectID(address(objectRegistryId), `${address(npcTypeOrigin)}::npc::NpcProfileKey`,
    NpcProfileKey.serialize({ character_id: address(characterObjectId) }).toBytes());
}

export function createSuiNpcProfileTransaction(context: TransactionContext): Transaction {
  const { identity, lifecycle, npcWorld } = context;
  const transaction = new Transaction();
  if (context.operation === "register") {
    const match = /^(0|[1-9][0-9]*)-([a-z0-9][a-z0-9_-]*)$/.exec(identity.factionKey);
    if (!match || Number(match[1]) > 0xffffffff) fail("INVALID_NPC_FACTION", "NPC faction key is invalid");
    transaction.moveCall({
      target: `${npcWorld.npcPackageId}::npc::register_profile`,
      arguments: [
        transaction.object(identity.objectRegistryId), transaction.object(identity.characterObjectId),
        transaction.object(identity.adminAclId), transaction.pure.u32(Number(match[1])),
        transaction.pure.string(match[2] === "none" ? "" : match[2]),
        transaction.pure.u64(lifecycle.incarnation), transaction.pure.u64(lifecycle.activeEntityID), transaction.pure.u64(lifecycle.deaths),
      ],
    });
  } else {
    transaction.moveCall({
      target: `${npcWorld.npcPackageId}::npc::sync_lifecycle`,
      arguments: [
        transaction.object(context.npcProfileObjectId), transaction.object(identity.adminAclId),
        transaction.pure.u64(context.expectedRevision!), transaction.pure.u64(lifecycle.incarnation),
        transaction.pure.u64(lifecycle.activeEntityID), transaction.pure.u64(lifecycle.deaths),
      ],
    });
  }
  return transaction;
}

/** Reconcile the durable journal before planning any new lifecycle mutation. */
export function reconcileSuiNpcProfile(input: {
  identity: SuiNpcCharacterIdentity;
  lifecycle: SuiNpcLifecycleInput;
  journal?: SuiNpcProfileJournal;
}, options: SuiNpcProfileOptions): Promise<SuiNpcProfileResult> {
  return serializeAdminSubmission(async () => {
    const { identity } = input;
    const lifecycle = normalizeNpcLifecycle(input.lifecycle);
    const client = options.client || suiGrpcClient as any;
    const npcWorld = { ...options.npcWorld };
    const npcProfileObjectId = deriveSuiNpcProfileObjectId(identity.objectRegistryId, identity.characterObjectId, npcWorld.npcTypeOrigin);
    const delays = options.reconciliationDelaysMs || [0, 150, 500, 1000];
    const chainId = await readLiveSuiChainIdentifier(client);
    if (!chainId) fail("NPC_CHAIN_UNAVAILABLE", "The NPC profile's localnet chain could not be verified");
    const expectedChainId = chainId!;

    async function assertCurrent() {
      const current = resolveSuiCharacterWorld(options.world, options.env);
      for (const field of ["packageId", "objectRegistryId", "adminAclId", "tenant", "tribeId"] as const) {
        if (current[field] !== identity[field]) fail("WORLD_CONFIGURATION_CHANGED", "The NPC Character world changed during profile reconciliation");
      }
      try { assertSuiNpcWorldConfigCurrent(npcWorld, { ...current, chainId: expectedChainId }, options.env); }
      catch (cause) { fail("NPC_WORLD_CHANGED", "The NPC package configuration changed during profile reconciliation", { cause }); }
      if (await readLiveSuiChainIdentifier(client) !== expectedChainId) {
        fail("WORLD_CHAIN_MISMATCH", "Localnet changed during NPC profile reconciliation");
      }
    }

    async function assertParentCurrent() {
      let object: any;
      try { ({ object } = await client.getObject({ objectId: identity.characterObjectId, include: { json: true } })); }
      catch (error) {
        if (isObjectNotFoundError(error)) fail("NPC_CHARACTER_MISSING", "The NpcProfile's parent Character no longer exists");
        throw error;
      }
      const json = object?.json;
      if (!object || address(object.objectId) !== address(identity.characterObjectId) ||
        object.type !== `${identity.packageId}::character::Character` || object.owner?.$kind !== "Shared" ||
        address(json?.character_address) !== address(identity.walletAddress) ||
        Number(json?.key?.item_id) !== identity.gameCharacterId || json?.key?.tenant !== identity.tenant ||
        Number(json?.tribe_id) !== identity.tribeId) {
        fail("NPC_PROFILE_BINDING_MISMATCH", "The NPC profile's parent Character no longer matches the server identity");
      }
    }

    async function readProfile(): Promise<(SuiNpcLifecycle & { revision: string; retired: boolean; previousTransaction: string }) | null> {
      let object: any;
      try { ({ object } = await client.getObject({ objectId: npcProfileObjectId, include: { json: true, previousTransaction: true } })); }
      catch (error) { if (isObjectNotFoundError(error)) return null; throw error; }
      const json = object?.json;
      if (!object || address(object.objectId) !== npcProfileObjectId ||
        object.type !== `${npcWorld.npcTypeOrigin}::npc::NpcProfile` || object.owner?.$kind !== "Shared" ||
        address(json?.character_id) !== address(identity.characterObjectId) ||
        address(json?.registry_id) !== address(identity.objectRegistryId) ||
        address(json?.admin_acl_id) !== address(identity.adminAclId) ||
        address(json?.wallet_address) !== address(identity.walletAddress) ||
        json?.tenant !== identity.tenant || Number(json?.npc_id) !== identity.gameCharacterId ||
        json?.faction_key !== identity.factionKey || typeof json?.retired !== "boolean") {
        fail("NPC_PROFILE_BINDING_MISMATCH", "Existing NpcProfile does not match this NPC identity and world");
      }
      const snapshot = normalizeNpcLifecycle({ incarnation: json.incarnation, activeEntityID: json.active_entity_id, deaths: json.deaths });
      const revision = u64(json.revision, "NPC profile revision");
      if (revision === "0") fail("NPC_PROFILE_BINDING_MISMATCH", "NPC profile revision must be positive");
      if (json.retired) fail("NPC_PROFILE_RETIRED", "The NPC profile has been permanently retired");
      return { ...snapshot, revision, retired: false, previousTransaction: String(object.previousTransaction || "") };
    }

    function status(response: any, digest: string): boolean {
      const transaction = response?.$kind === "FailedTransaction" ? response.FailedTransaction : response?.Transaction;
      if (response?.$kind === "FailedTransaction" || transaction?.status?.success === false) {
        fail("TRANSACTION_FAILED", "The NPC profile transaction failed", { transactionDigest: digest });
      }
      return response?.$kind === "Transaction" && transaction?.status?.success === true;
    }

    async function findTransaction(digest: string) {
      if (typeof client.getTransaction !== "function") return false;
      try { return status(await client.getTransaction({ digest, include: TRANSACTION_INCLUDE }), digest); }
      catch (error) {
        if ((error as any)?.code === "TRANSACTION_FAILED") throw error;
        return false;
      }
    }

    function validateJournal(journal: SuiNpcProfileJournal) {
      if (!journal.transactionDigest || journal.chainId !== expectedChainId ||
        journal.npcWorldFingerprint !== npcWorld.fingerprint || journal.npcPackageId !== npcWorld.npcPackageId ||
        journal.npcTypeOrigin !== npcWorld.npcTypeOrigin || journal.characterObjectId !== identity.characterObjectId ||
        journal.npcProfileObjectId !== npcProfileObjectId || !["register", "sync"].includes(journal.operation)) {
        fail("NPC_PROFILE_JOURNAL_MISMATCH", "The pending NPC profile transaction belongs to another identity or deployment", {
          ambiguous: true, transactionDigest: journal.transactionDigest,
        });
      }
      const intended = normalizeNpcLifecycle(journal.lifecycle);
      assertLifecycleCanAdvance(intended, lifecycle);
      if (journal.operation === "sync" && u64(journal.expectedRevision, "Expected profile revision") === "0") {
        fail("PENDING_TRANSACTION_INVALID", "Pending NPC profile revision is invalid", { ambiguous: true, transactionDigest: journal.transactionDigest });
      }
    }

    async function submitJournal(journal: SuiNpcProfileJournal, newlyPrepared = false): Promise<boolean> {
      validateJournal(journal);
      if (!newlyPrepared && await findTransaction(journal.transactionDigest)) return true;
      let transactionBytes: Uint8Array;
      try {
        const decoded = Buffer.from(journal.transactionBytesBase64 || "", "base64");
        if (!decoded.length || decoded.toString("base64") !== journal.transactionBytesBase64 || !journal.transactionSignature ||
          TransactionDataBuilder.getDigestFromBytes(decoded) !== journal.transactionDigest) throw new Error("Invalid journal");
        transactionBytes = new Uint8Array(decoded);
      } catch (cause) {
        fail("PENDING_TRANSACTION_INVALID", "Pending NPC profile transaction bytes do not match the recorded digest", {
          ambiguous: true, transactionDigest: journal.transactionDigest, cause,
        });
      }
      if (typeof client.executeTransaction !== "function") {
        fail("PENDING_TRANSACTION_REPLAY_UNAVAILABLE", "NPC profiles require a client that can replay prepared transactions", {
          ambiguous: true, transactionDigest: journal.transactionDigest,
        });
      }
      await assertCurrent();
      let lastError: unknown;
      try {
        if (status(await client.executeTransaction({ transaction: transactionBytes!, signatures: [journal.transactionSignature!], include: TRANSACTION_INCLUDE }), journal.transactionDigest)) return false;
      } catch (error) {
        if ((error as any)?.code === "TRANSACTION_FAILED") throw error;
        lastError = error;
      }
      for (const delay of delays) {
        if (delay > 0) await new Promise(resolve => setTimeout(resolve, Math.min(5000, delay)));
        if (await findTransaction(journal.transactionDigest)) return true;
        try {
          const profile = await readProfile();
          // A matching revision means replay can no longer regress this object:
          // registration is derived once and sync uses an expected revision.
          if (profile && sameLifecycle(profile, journal.lifecycle) &&
            (journal.operation === "register" || BigInt(profile.revision) > BigInt(journal.expectedRevision!))) return true;
        } catch (error) { lastError = error; }
      }
      return fail("TRANSACTION_STATUS_UNKNOWN", "The NPC profile transaction status could not be reconciled", {
        ambiguous: true, transactionDigest: journal.transactionDigest, cause: lastError,
      });
    }

    await assertCurrent();
    await assertParentCurrent();
    let recovered = false;
    let transactionDigest = "";
    if (input.journal) {
      recovered = await submitJournal(input.journal);
      transactionDigest = input.journal.transactionDigest;
    }
    let profile = await readProfile();
    if (input.journal && (!profile ||
      (input.journal.operation === "sync" && BigInt(profile.revision) <= BigInt(input.journal.expectedRevision!)))) {
      fail("TRANSACTION_STATUS_UNKNOWN", "The pending NPC profile transaction is not visible in object state yet", {
        ambiguous: true, transactionDigest,
      });
    }
    if (profile) assertLifecycleCanAdvance(profile, lifecycle);
    if (!profile || !sameLifecycle(profile, lifecycle)) {
      const context: TransactionContext = {
        operation: profile ? "sync" : "register", identity, lifecycle, npcProfileObjectId,
        ...(profile ? { expectedRevision: profile.revision } : {}), npcWorld,
      };
      await assertCurrent();
      const signer = resolveAdminSigner(options);
      const transaction = options.transactionFactory?.(context) || createSuiNpcProfileTransaction(context);
      let bytes: Uint8Array;
      let signature: string;
      try {
        transaction.setSenderIfNotSet(signer.toSuiAddress());
        bytes = await transaction.build({ client });
        signature = (await signer.signTransaction(bytes)).signature;
        if (!signature) throw new Error("Missing transaction signature");
      } catch (cause) {
        fail("TRANSACTION_NOT_SUBMITTED", "The NPC profile transaction could not be prepared", { cause });
      }
      const journal: SuiNpcProfileJournal = {
        transactionDigest: TransactionDataBuilder.getDigestFromBytes(bytes!),
        transactionBytesBase64: Buffer.from(bytes!).toString("base64"), transactionSignature: signature!,
        chainId: expectedChainId, npcWorldFingerprint: npcWorld.fingerprint,
        npcPackageId: npcWorld.npcPackageId, npcTypeOrigin: npcWorld.npcTypeOrigin,
        characterObjectId: identity.characterObjectId, npcProfileObjectId,
        operation: context.operation, expectedRevision: context.expectedRevision, lifecycle,
      };
      await assertCurrent();
      try { await options.onTransactionPrepared?.(journal); }
      catch (cause) { fail("TRANSACTION_NOT_SUBMITTED", "The NPC profile transaction could not be recorded", { cause, transactionDigest: journal.transactionDigest }); }
      recovered = await submitJournal(journal, true);
      transactionDigest = journal.transactionDigest;
      profile = await readProfile();
    }
    if (!profile || !sameLifecycle(profile, lifecycle)) {
      fail("TRANSACTION_STATUS_UNKNOWN", "The NPC profile transaction has not produced the expected lifecycle", {
        ambiguous: true, transactionDigest,
      });
    }
    await assertCurrent();
    await assertParentCurrent();
    return {
      ...lifecycle, npcProfileObjectId, revision: profile.revision, retired: false,
      chainId: expectedChainId, transactionDigest: transactionDigest || profile.previousTransaction, recovered: recovered || !transactionDigest,
    };
  });
}
