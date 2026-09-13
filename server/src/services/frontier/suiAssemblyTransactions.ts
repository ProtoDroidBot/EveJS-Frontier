import fs from "node:fs";
import path from "node:path";
import { TransactionDataBuilder } from "@mysten/sui/transactions";

type PendingTransaction = {
  label: string;
  digest: string;
  bytes: string;
  signatures: string[];
};
type Journal = {
  version: 1;
  chainId: string;
  packageId: string;
  pending?: PendingTransaction;
  lastTransaction?: { label: string; digest: string; status: string };
};

/** One durable in-flight transaction per worker. Never rebuild an uncertain write. */
export function createAssemblyTransactionExecutor(options: {
  client: any;
  journalPath: string;
  chainId: string;
  packageId: string;
  adminSigner: any;
  getSigner: (ownerId: number) => any;
  assertCurrent: () => Promise<void>;
  onCommitted?: (digest: string, label: string) => void;
}) {
  let journal: Journal = { version: 1, chainId: options.chainId, packageId: options.packageId };
  if (fs.existsSync(options.journalPath)) {
    journal = JSON.parse(fs.readFileSync(options.journalPath, "utf8"));
    if (journal.version !== 1 || journal.chainId !== options.chainId || journal.packageId !== options.packageId) {
      throw new Error("Assembly transaction journal belongs to a different deployment");
    }
  }
  function save() {
    fs.mkdirSync(path.dirname(options.journalPath), { recursive: true });
    const temporary = `${options.journalPath}.${process.pid}.tmp`;
    const fd = fs.openSync(temporary, "w", 0o600);
    try {
      fs.writeFileSync(fd, JSON.stringify(journal, null, 2));
      fs.fsyncSync(fd);
    } finally { fs.closeSync(fd); }
    fs.renameSync(temporary, options.journalPath);
  }
  function finish(result: any, pending: PendingTransaction) {
    if (result?.digest !== pending.digest || !result?.effects?.status?.status) {
      throw new Error(`Assembly transaction ${pending.digest} has no definitive effects; retry pending`);
    }
    const status = result.effects.status.status;
    if (status !== "success" && status !== "failure") {
      throw new Error(`Assembly transaction ${pending.digest} returned an unknown status`);
    }
    journal.lastTransaction = { label: pending.label, digest: pending.digest, status };
    delete journal.pending;
    save();
    if (status === "failure") {
      throw new Error(`${pending.label}: ${result.effects.status.error || "Move transaction failed"}`);
    }
    options.onCommitted?.(pending.digest, pending.label);
    return result;
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
    let result: any;
    try {
      result = await options.client.getTransactionBlock({
        digest: pending.digest, options: { showEffects: true, showEvents: true },
      });
    } catch {
      // Replaying identical bytes/signatures is idempotent even after a lost response.
      await options.assertCurrent();
      result = await options.client.executeTransactionBlock({
        transactionBlock: bytes, signature: pending.signatures,
        options: { showEffects: true, showEvents: true },
        requestType: "WaitForLocalExecution",
      });
    }
    return finish(result, pending);
  }
  async function execute(label: string, transaction: any, ownerId?: number) {
    if (journal.pending) {
      await recover();
      throw new Error("Recovered a pending assembly transaction; rescan current chain state before continuing");
    }
    await options.assertCurrent();
    const signer = ownerId === undefined ? options.adminSigner : options.getSigner(ownerId);
    transaction.setSender(signer.toSuiAddress());
    transaction.setGasOwner(options.adminSigner.toSuiAddress());
    transaction.setGasBudget(100_000_000);
    const bytes = await transaction.build({ client: options.client });
    const signatures = [(await signer.signTransaction(bytes)).signature];
    if (signer.toSuiAddress() !== options.adminSigner.toSuiAddress()) {
      signatures.push((await options.adminSigner.signTransaction(bytes)).signature);
    }
    await options.assertCurrent();
    journal.pending = {
      label, digest: TransactionDataBuilder.getDigestFromBytes(bytes),
      bytes: Buffer.from(bytes).toString("base64"), signatures,
    };
    save(); // Must succeed before sending anything to the chain.
    return recover();
  }
  return { execute, recover, hasPending: () => Boolean(journal.pending) };
}
