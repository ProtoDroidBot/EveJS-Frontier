import fs from "node:fs";
import path from "node:path";
import { TransactionDataBuilder } from "@mysten/sui/transactions";
import type { SuiJsonRpcClient, SuiObjectRef, SuiTransactionBlockResponse } from "@mysten/sui/jsonRpc";

type PendingTransaction = {
  label: string;
  digest: string;
  bytes: string;
  signatures: string[];
  sponsored?: Record<string, any>;
};
type Journal = {
  version: 1;
  chainId: string;
  packageId: string;
  pending?: PendingTransaction;
  lastTransaction?: { label: string; digest: string; status: string };
  confirmedGas?: SuiObjectRef;
  sponsoredReceipts?: Array<{ metadata: Record<string, any>; digest: string; bytes: string; status: string }>;
  rejectedTransactions?: Array<PendingTransaction & {
    conflictingDigest: string;
    objectId: string;
    version: string;
  }>;
};

type AssemblyRpcClient = Pick<SuiJsonRpcClient,
  "getTransactionBlock" | "executeTransactionBlock" | "waitForTransaction" | "getObject">;
const resultOptions = { showEffects: true, showEvents: true };
const GAS_BUDGET = 100_000_000;

function sameReference(a: SuiObjectRef, b: SuiObjectRef) {
  return a.objectId === b.objectId && String(a.version) === String(b.version) && a.digest === b.digest;
}

/** Only versioned inputs can become obsolete; shared inputs use their initial version. */
function frozenReferences(bytes: Uint8Array): SuiObjectRef[] {
  const transaction = TransactionDataBuilder.fromBytes(bytes);
  return [
    ...(transaction.gasData.payment ?? []),
    ...transaction.inputs.flatMap(input => {
      const ref = input.Object?.ImmOrOwnedObject ?? input.Object?.Receiving;
      return ref ? [ref] : [];
    }),
  ].map(ref => ({ ...ref, version: String(ref.version) }));
}

/** One durable in-flight transaction per worker. Never rebuild an uncertain write. */
export function createAssemblyTransactionExecutor(options: {
  client: AssemblyRpcClient;
  journalPath: string;
  chainId: string;
  packageId: string;
  adminSigner: any;
  getSigner: (ownerId: number) => any;
  assertCurrent: () => Promise<void>;
  onCommitted?: (digest: string, label: string) => void;
  /** Persist confirmed wallet changes locally before the journal unlocks the mirror. */
  reconcileSponsored?: (metadata: Record<string, any>, digest: string) => Promise<void>;
  /** Idempotently persist confirmed intent changes before clearing the pending transaction. */
  reconcileCommitted?: (label: string, digest: string) => Promise<void>;
}) {
  let journal: Journal = { version: 1, chainId: options.chainId, packageId: options.packageId };
  if (fs.existsSync(options.journalPath)) {
    journal = JSON.parse(fs.readFileSync(options.journalPath, "utf8"));
    if (journal.version !== 1 || journal.chainId !== options.chainId || journal.packageId !== options.packageId) {
      throw new Error("Assembly transaction journal belongs to a different deployment");
    }
  }
  function save(next: Journal) {
    fs.mkdirSync(path.dirname(options.journalPath), { recursive: true });
    const temporary = `${options.journalPath}.${process.pid}.tmp`;
    const fd = fs.openSync(temporary, "w", 0o600);
    try {
      fs.writeFileSync(fd, JSON.stringify(next, null, 2));
      fs.fsyncSync(fd);
    } finally { fs.closeSync(fd); }
    fs.renameSync(temporary, options.journalPath);
    // A failed disk write must not unlock another submission in this process.
    journal = next;
  }
  function confirmedGas(result: SuiTransactionBlockResponse): SuiObjectRef | undefined {
    const gas = result.effects?.gasObject;
    if (gas?.owner && typeof gas.owner === "object" &&
        "AddressOwner" in gas.owner && gas.owner.AddressOwner === options.adminSigner.toSuiAddress()) {
      return { ...gas.reference, version: String(gas.reference.version) };
    }
  }
  async function finish(result: SuiTransactionBlockResponse, pending: PendingTransaction) {
    if (result?.digest !== pending.digest || !result?.effects?.status?.status ||
        (result.effects.transactionDigest && result.effects.transactionDigest !== pending.digest)) {
      throw new Error(`Assembly transaction ${pending.digest} has no definitive effects; retry pending`);
    }
    const status = result.effects.status.status;
    if (status !== "success" && status !== "failure") {
      throw new Error(`Assembly transaction ${pending.digest} returned an unknown status`);
    }
    if (status === "success" && pending.sponsored) {
      if (!options.reconcileSponsored) throw new Error("Sponsored transaction reconciliation is unavailable");
      await options.reconcileSponsored(pending.sponsored, pending.digest);
    }
    if (status === "success") await options.reconcileCommitted?.(pending.label, pending.digest);
    save({
      ...journal, pending: undefined,
      lastTransaction: { label: pending.label, digest: pending.digest, status },
      confirmedGas: confirmedGas(result),
      sponsoredReceipts: pending.sponsored ? [...(journal.sponsoredReceipts || []).slice(-999), {
        metadata: pending.sponsored, digest: pending.digest, bytes: pending.bytes, status,
      }] : journal.sponsoredReceipts,
    });
    if (status === "failure") {
      throw new Error(`${pending.label}: ${result.effects.status.error || "Move transaction failed"}`);
    }
    options.onCommitted?.(pending.digest, pending.label);
    return result;
  }

  async function gasForBuild(): Promise<SuiObjectRef | undefined> {
    const cached = journal.confirmedGas;
    if (!cached) return;
    const response = await options.client.getObject({
      id: cached.objectId, options: { showOwner: true, showContent: true },
    });
    if (response.error) {
      if (response.error.code === "notExists") throw new Error("Assembly gas is not yet visible at its confirmed version; retry after indexing");
      if (response.error.code === "deleted") return;
      throw new Error(`Cannot refresh assembly gas: ${JSON.stringify(response.error)}`);
    }
    const current = response.data;
    if (!current || current.objectId !== cached.objectId) throw new Error("Cannot refresh assembly gas reference");
    // An older balance cannot establish that the confirmed coin still covers
    // the budget. Defer before signing/journaling instead of consuming stale data.
    if (BigInt(current.version) < BigInt(cached.version)) {
      throw new Error("Assembly gas is not yet visible at its confirmed version; retry after indexing");
    }
    if (String(current.version) === String(cached.version) && current.digest !== cached.digest) {
      throw new Error("Assembly gas reference has a conflicting digest at the confirmed version");
    }
    if (typeof current.owner !== "object" || !current.owner ||
        !("AddressOwner" in current.owner) || current.owner.AddressOwner !== options.adminSigner.toSuiAddress()) return;
    const fields = current.content?.dataType === "moveObject" ? current.content.fields : null;
    const balance = fields && "balance" in fields ? fields.balance : null;
    if (typeof balance !== "string" || !/^\d+$/.test(balance)) throw new Error("Cannot read assembly gas balance");
    // Let the SDK select other coins when the previously used coin is depleted.
    if (BigInt(balance) < BigInt(GAS_BUDGET)) return;
    return { objectId: current.objectId, version: String(current.version), digest: current.digest };
  }

  async function findConflictingTransaction(pending: PendingTransaction, bytes: Uint8Array) {
    const refs = frozenReferences(bytes);
    const candidates = new Set<string>();
    if (journal.lastTransaction) candidates.add(journal.lastTransaction.digest);
    // Other admin users may have consumed an input since our last transaction.
    const objects = await Promise.allSettled(refs.map(ref => options.client.getObject({
      id: ref.objectId, options: { showPreviousTransaction: true },
    })));
    for (const object of objects) {
      if (object.status === "fulfilled" && object.value.data?.previousTransaction) {
        candidates.add(object.value.data.previousTransaction);
      }
    }
    candidates.delete(pending.digest);
    for (const digest of candidates) {
      let result: SuiTransactionBlockResponse;
      try {
        result = await options.client.getTransactionBlock({ digest, options: { showEffects: true, showInput: true } });
      } catch { continue; }
      const effects = result.effects;
      if (result.digest !== digest || effects?.transactionDigest !== digest ||
          !["success", "failure"].includes(effects.status.status)) continue;
      const data = result.transaction?.data;
      const inputs: SuiObjectRef[] = [...(data?.gasData.payment ?? [])];
      if (data?.transaction?.kind === "ProgrammableTransaction") {
        for (const input of data.transaction.inputs) {
          if (input.type === "object" && input.objectType !== "sharedObject") inputs.push(input);
        }
      }
      const consumed = refs.find(ref => inputs.some(input => sameReference(ref, input)) &&
        effects.modifiedAtVersions?.some(change => change.objectId === ref.objectId &&
          String(change.sequenceNumber) === ref.version));
      if (consumed) return { result, consumed };
    }
    return null;
  }

  async function retireIfSuperseded(pending: PendingTransaction, bytes: Uint8Array) {
    let proof: Awaited<ReturnType<typeof findConflictingTransaction>>;
    try { proof = await findConflictingTransaction(pending, bytes); }
    catch { return; } // Unavailable or incomplete evidence must leave the original write pending.
    if (!proof) return;
    await options.assertCurrent();
    save({
      ...journal, pending: undefined, confirmedGas: undefined,
      rejectedTransactions: [...(journal.rejectedTransactions ?? []), {
        ...pending, conflictingDigest: proof.result.digest,
        objectId: proof.consumed.objectId, version: proof.consumed.version,
      }],
    });
    throw new Error(`${pending.label}: transaction ${pending.digest} was superseded by ${proof.result.digest}; rescan chain state and rebuild`);
  }
  async function recover() {
    const pending = journal.pending;
    if (!pending) return null;
    const bytes = Buffer.from(pending.bytes, "base64");
    if (TransactionDataBuilder.getDigestFromBytes(bytes) !== pending.digest ||
        !Array.isArray(pending.signatures) || pending.signatures.length === 0) {
      throw new Error("Assembly transaction journal is corrupt; refusing to submit");
    }
    await options.assertCurrent();
    let result: SuiTransactionBlockResponse;
    try {
      result = await options.client.getTransactionBlock({
        digest: pending.digest, options: resultOptions,
      });
    } catch {
      // Replaying identical bytes/signatures is idempotent even after a lost response.
      await options.assertCurrent();
      try {
        result = await options.client.executeTransactionBlock({
          transactionBlock: bytes, signature: pending.signatures, options: resultOptions,
        });
      } catch (error) {
        await retireIfSuperseded(pending, bytes);
        throw error;
      }
    }
    if (result?.digest !== pending.digest) throw new Error("Assembly transaction returned a different digest; retry pending");
    // SDK 2.x ignores requestType. Keep the journal pending until the read API
    // observes execution, including failed Move calls which also consume gas.
    result = await options.client.waitForTransaction({ digest: pending.digest, options: resultOptions });
    await options.assertCurrent();
    return finish(result, pending);
  }
  async function execute(label: string, transaction: any, ownerId?: number, assertSnapshotCurrent?: () => void) {
    if (journal.pending) {
      await recover();
      throw new Error("Recovered a pending assembly transaction; rescan current chain state before continuing");
    }
    await options.assertCurrent();
    const signer = ownerId === undefined ? options.adminSigner : options.getSigner(ownerId);
    transaction.setSender(signer.toSuiAddress());
    transaction.setGasOwner(options.adminSigner.toSuiAddress());
    transaction.setGasBudget(GAS_BUDGET);
    const gas = await gasForBuild();
    if (gas) transaction.setGasPayment([gas]);
    const bytes = await transaction.build({ client: options.client });
    const signatures = [(await signer.signTransaction(bytes)).signature];
    if (signer.toSuiAddress() !== options.adminSigner.toSuiAddress()) {
      signatures.push((await options.adminSigner.signTransaction(bytes)).signature);
    }
    await options.assertCurrent();
    const pending = {
      label, digest: TransactionDataBuilder.getDigestFromBytes(bytes),
      bytes: Buffer.from(bytes).toString("base64"), signatures,
    };
    // Builds and signatures await RPCs while live fuel can change. Check once
    // more immediately before persisting the immutable submission. Recovery must
    // always replay that saved submission, even if local state later changes.
    assertSnapshotCurrent?.();
    save({ ...journal, pending }); // Must succeed before sending anything to the chain.
    return recover();
  }
  async function prepareSponsored(transaction: any, sender: string) {
    if (journal.pending) throw new Error("Another assembly transaction is pending");
    await options.assertCurrent();
    transaction.setSender(sender);
    transaction.setGasOwner(options.adminSigner.toSuiAddress());
    transaction.setGasBudget(GAS_BUDGET);
    const gas = await gasForBuild();
    if (gas) transaction.setGasPayment([gas]);
    const bytes = await transaction.build({ client: options.client });
    await options.assertCurrent();
    return { bytes: Buffer.from(bytes).toString("base64"), digest: TransactionDataBuilder.getDigestFromBytes(bytes),
      sponsorAddress: options.adminSigner.toSuiAddress() };
  }
  /** Called only with server-prepared bytes and a verified owner signature. */
  async function executeSponsored(metadata: Record<string, any>, encodedBytes: string, signature: string, assertSnapshotCurrent: () => void) {
    if (journal.pending) throw new Error("Another assembly transaction is pending");
    await options.assertCurrent();
    const bytes = Buffer.from(encodedBytes, "base64");
    const transaction = TransactionDataBuilder.fromBytes(bytes);
    if (transaction.sender !== metadata.walletAddress || transaction.gasData.owner !== options.adminSigner.toSuiAddress()) {
      throw new Error("Sponsored transaction signer mismatch");
    }
    const sponsorSignature = (await options.adminSigner.signTransaction(bytes)).signature;
    await options.assertCurrent();
    assertSnapshotCurrent();
    save({ ...journal, pending: {
      label: `sponsored:${metadata.transactionUUID}`, digest: TransactionDataBuilder.getDigestFromBytes(bytes),
      bytes: encodedBytes, signatures: metadata.walletAddress === options.adminSigner.toSuiAddress()
        ? [signature] : [signature, sponsorSignature], sponsored: metadata,
    } });
    return recover();
  }
  function getSponsored(transactionUUID: string) {
    if (journal.pending?.sponsored?.transactionUUID === transactionUUID) return {
      metadata: journal.pending.sponsored, digest: journal.pending.digest, bytes: journal.pending.bytes, status: "pending",
    };
    const receipt = journal.sponsoredReceipts?.find(value => value.metadata.transactionUUID === transactionUUID);
    if (receipt) return receipt;
    const rejected = journal.rejectedTransactions?.find(value => value.sponsored?.transactionUUID === transactionUUID);
    if (rejected) return { metadata: rejected.sponsored!, digest: rejected.digest, bytes: rejected.bytes, status: "failure" };
  }
  return { execute, recover, prepareSponsored, executeSponsored, getSponsored, hasPending: () => Boolean(journal.pending) };
}
