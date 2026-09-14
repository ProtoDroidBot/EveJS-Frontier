import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Transaction, TransactionDataBuilder } from "@mysten/sui/transactions";
import { normalizeSuiAddress } from "@mysten/sui/utils";
import { createAssemblyTransactionExecutor } from "../src/services/frontier/suiAssemblyTransactions";

const admin = normalizeSuiAddress("0xa");
const player = normalizeSuiAddress("0xb");
const gas6744 = {
  objectId: "0x71d5ee936b9f9c64463d3c9e8c7bd91608ccca8b63e6747b20e253b6e2c7d74a",
  version: "6744", digest: "B6W2nvxdKsSh3SK12kkiU6jLtmkr5fJkoQb4wvic1vM3",
};
const gas6745 = { ...gas6744, version: "6745", digest: TransactionDataBuilder.getDigestFromBytes(new Uint8Array([5])) };
const nameDigest = "4gawJm6LQnFx8ZSZCntUUsU3t1fQkRGAFS7FyHao3g56";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function locationTransaction(gas = gas6744) {
  const transaction = new Transaction();
  transaction.setSender(admin);
  transaction.setGasOwner(admin);
  transaction.setGasPrice(1000);
  transaction.setGasBudget(100_000_000);
  transaction.setGasPayment([gas]);
  transaction.moveCall({ target: `${normalizeSuiAddress("0xc")}::assembly::reveal_location`, arguments: [
    transaction.sharedObjectRef({ objectId: normalizeSuiAddress("0xd"), initialSharedVersion: "1", mutable: false }),
    transaction.sharedObjectRef({ objectId: normalizeSuiAddress("0xe"), initialSharedVersion: "1", mutable: true }),
    transaction.sharedObjectRef({ objectId: normalizeSuiAddress("0xf"), initialSharedVersion: "1", mutable: false }),
    transaction.pure.u64(30002479), transaction.pure.string("1"), transaction.pure.string("2"), transaction.pure.string("3"),
  ] });
  return transaction;
}

function fixture(t: any) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "evejs-sui-journal-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const bytes = Uint8Array.from([0, 1, 2, 3]);
  const digest = TransactionDataBuilder.getDigestFromBytes(bytes);
  const success: any = { digest, effects: { status: { status: "success" } } };
  let submitted = 0;
  const options = {
    client: {
      async getTransactionBlock(): Promise<any> { throw new Error("not found"); },
      async executeTransactionBlock(_input: any): Promise<any> { submitted++; return success; },
      async waitForTransaction(_input: any): Promise<any> { return success; },
      async getObject(_input: any): Promise<any> { throw new Error("object not found"); },
    },
    journalPath: path.join(dir, "transactions.json"), chainId: "local", packageId: "world",
    adminSigner: { toSuiAddress: () => admin, signTransaction: async () => ({ signature: "admin-signature" }) },
    getSigner: (_id: number) => ({ toSuiAddress: () => player, signTransaction: async () => ({ signature: "player-signature" }) }),
    assertCurrent: async () => {},
  };
  const transaction = { setSender() {}, setGasOwner() {}, setGasBudget() {}, setGasPayment() {}, async build() { return bytes; } };
  return { options, transaction, bytes, digest, success, submissions: () => submitted };
}

test("lost transaction response is reconciled after restart without applying the delta again", async t => {
  const f = fixture(t);
  let submitted: any;
  f.options.client.executeTransactionBlock = async input => { submitted = input; throw new Error("connection lost after commit"); };
  const first = createAssemblyTransactionExecutor(f.options);
  await assert.rejects(first.execute("deposit", f.transaction, 9), /connection lost/);
  const pending = JSON.parse(fs.readFileSync(f.options.journalPath, "utf8")).pending;
  assert.equal(pending.digest, f.digest);
  assert.deepEqual(pending.signatures, ["player-signature", "admin-signature"]);
  assert.equal(Buffer.from(submitted.transactionBlock).toString("base64"), pending.bytes);
  f.options.client.getTransactionBlock = async () => f.success;
  f.options.client.executeTransactionBlock = async () => { assert.fail("must not submit again after confirmed commit"); };
  const restarted = createAssemblyTransactionExecutor(f.options);
  await restarted.recover();
  assert.equal(restarted.hasPending(), false);
  assert.equal(JSON.parse(fs.readFileSync(f.options.journalPath, "utf8")).lastTransaction.digest, f.digest);
});

test("unconfirmed retries replay identical signed bytes", async t => {
  const f = fixture(t);
  const calls: any[] = [];
  f.options.client.executeTransactionBlock = async input => {
    calls.push(input);
    if (calls.length === 1) throw new Error("offline");
    return f.success;
  };
  const executor = createAssemblyTransactionExecutor(f.options);
  await assert.rejects(executor.execute("fuel", f.transaction), /offline/);
  await createAssemblyTransactionExecutor(f.options).recover();
  assert.deepEqual(calls[0].transactionBlock, calls[1].transactionBlock);
  assert.deepEqual(calls[0].signature, calls[1].signature);
});

test("failed fuel acknowledgement remains pending and recovers idempotently without rebuilding or resubmitting", async t => {
  const f = fixture(t);
  const label = "assembly:9988400000137:fuel:intent-1";
  const acknowledged = new Set<string>();
  let reconciliations = 0;
  let builds = 0;
  let committed = 0;
  f.transaction.build = async () => { builds++; return f.bytes; };
  const options = {
    ...f.options,
    async reconcileCommitted(committedLabel: string, digest: string) {
      const journal = JSON.parse(fs.readFileSync(f.options.journalPath, "utf8"));
      assert.equal(journal.pending.label, label);
      assert.equal(journal.pending.digest, f.digest);
      assert.equal(journal.lastTransaction, undefined);
      assert.equal(committedLabel, label);
      assert.equal(digest, f.digest);
      acknowledged.add(`${committedLabel}:${digest}`);
      if (++reconciliations === 1) throw new Error("fuel acknowledgement interrupted");
    },
    onCommitted: () => { committed++; },
  };
  const first = createAssemblyTransactionExecutor(options);
  await assert.rejects(first.execute(label, f.transaction), /fuel acknowledgement interrupted/);
  assert.equal(first.hasPending(), true);
  const pending = JSON.parse(fs.readFileSync(f.options.journalPath, "utf8")).pending;
  assert.equal(pending.label, label);
  assert.equal(pending.digest, f.digest);
  assert.equal(committed, 0);
  options.client.getTransactionBlock = async () => f.success;
  options.client.executeTransactionBlock = async () => assert.fail("confirmed fuel transaction must not be resubmitted");
  const restarted = createAssemblyTransactionExecutor(options);
  await assert.rejects(restarted.execute("another fuel intent", f.transaction), /Recovered a pending assembly transaction/);
  assert.equal(restarted.hasPending(), false);
  assert.equal(reconciliations, 2);
  assert.equal(acknowledged.size, 1);
  assert.equal(builds, 1);
  assert.equal(f.submissions(), 1);
  assert.equal(committed, 1);
  assert.deepEqual(JSON.parse(fs.readFileSync(f.options.journalPath, "utf8")).lastTransaction,
    { label, digest: f.digest, status: "success" });
});

test("committed reconciliation follows sponsored reconciliation before clearing the journal", async t => {
  const f = fixture(t);
  const sponsored = { transactionUUID: "wallet-fuel-intent" };
  const label = `sponsored:${sponsored.transactionUUID}`;
  fs.writeFileSync(f.options.journalPath, JSON.stringify({ version: 1, chainId: "local", packageId: "world",
    pending: { label, digest: f.digest, bytes: Buffer.from(f.bytes).toString("base64"),
      signatures: ["player-signature", "admin-signature"], sponsored },
  }));
  f.options.client.getTransactionBlock = async () => f.success;
  const reconciled: string[] = [];
  const executor = createAssemblyTransactionExecutor({
    ...f.options,
    async reconcileSponsored(metadata, digest) {
      assert.deepEqual(metadata, sponsored);
      assert.equal(digest, f.digest);
      reconciled.push("sponsored");
    },
    async reconcileCommitted(committedLabel, digest) {
      assert.deepEqual(reconciled, ["sponsored"]);
      assert.equal(committedLabel, label);
      assert.equal(digest, f.digest);
      assert.equal(JSON.parse(fs.readFileSync(f.options.journalPath, "utf8")).pending.digest, f.digest);
      reconciled.push("committed");
    },
  });
  await executor.recover();
  assert.deepEqual(reconciled, ["sponsored", "committed"]);
  assert.equal(executor.hasPending(), false);
  assert.equal(f.submissions(), 0);
});

test("changed deployment blocks submission and corrupt journals fail closed", async t => {
  const f = fixture(t);
  f.options.assertCurrent = async () => { throw new Error("chain changed"); };
  await assert.rejects(createAssemblyTransactionExecutor(f.options).execute("anchor", f.transaction), /chain changed/);
  assert.equal(f.submissions(), 0);
  fs.writeFileSync(f.options.journalPath, JSON.stringify({ version: 1, chainId: "another", packageId: "world" }));
  assert.throws(() => createAssemblyTransactionExecutor(f.options), /different deployment/);
});

test("cannot send a transaction before its journal is persisted", async t => {
  const f = fixture(t);
  const executor = createAssemblyTransactionExecutor(f.options);
  fs.mkdirSync(f.options.journalPath);
  await assert.rejects(executor.execute("inventory", f.transaction));
  assert.equal(f.submissions(), 0);
});

test("definitive failure clears pending state and reports the Move error", async t => {
  const f = fixture(t);
  const failure = { digest: f.digest, effects: { status: { status: "failure", error: "NoFuel" } } };
  f.options.client.executeTransactionBlock = async () => failure;
  f.options.client.waitForTransaction = async () => failure;
  const executor = createAssemblyTransactionExecutor({ ...f.options,
    reconcileCommitted: async () => assert.fail("failed transactions must not acknowledge a committed intent"),
  });
  await assert.rejects(executor.execute("online", f.transaction), /NoFuel/);
  assert.equal(executor.hasPending(), false);
});

test("a fuel snapshot changed while building is rejected before journaling or submitting", async t => {
  const f = fixture(t);
  const building = deferred<void>();
  const built = deferred<typeof f.bytes>();
  f.transaction.build = async () => { building.resolve(); return built.promise; };
  const executor = createAssemblyTransactionExecutor(f.options);
  let quantity = 100;
  let checks = 0;
  const execution = executor.execute("fuel", f.transaction, 9, () => {
    checks++;
    if (quantity !== 100) throw new Error("fuel snapshot changed");
  });
  const rejected = assert.rejects(execution, /fuel snapshot changed/);
  await building.promise;
  quantity = 88;
  built.resolve(f.bytes);
  await rejected;
  assert.equal(checks, 1);
  assert.equal(executor.hasPending(), false);
  assert.equal(fs.existsSync(f.options.journalPath), false);
  assert.equal(f.submissions(), 0);
});

test("a saved fuel submission is recovered even after its live snapshot changes", async t => {
  const f = fixture(t);
  let checks = 0;
  f.options.client.executeTransactionBlock = async () => { throw new Error("response lost"); };
  const executor = createAssemblyTransactionExecutor(f.options);
  await assert.rejects(executor.execute("fuel", f.transaction, undefined, () => {
    if (++checks > 1) throw new Error("fuel snapshot changed");
  }), /response lost/);
  assert.equal(executor.hasPending(), true);
  f.options.client.getTransactionBlock = async () => f.success;
  await executor.recover();
  assert.equal(checks, 1);
  assert.equal(executor.hasPending(), false);
});

for (const status of ["success", "failure"] as const) {
  test(`${status} effects keep the journal pending until the transaction is visible to reads`, async t => {
    const f = fixture(t);
    const enteredWait = deferred<void>();
    const visible = deferred<any>();
    const result = { digest: f.digest, effects: { status: { status, error: status === "failure" ? "NoFuel" : undefined } } };
    let committed = 0;
    let settled = false;
    f.options.client.executeTransactionBlock = async input => {
      assert.equal("requestType" in input, false, "the installed SDK does not support requestType");
      return result;
    };
    f.options.client.waitForTransaction = async input => {
      assert.equal(input.digest, f.digest);
      enteredWait.resolve();
      return visible.promise;
    };
    const executor = createAssemblyTransactionExecutor({ ...f.options, onCommitted: () => { committed++; } });
    const execution = executor.execute("anchor", f.transaction).then(
      value => { settled = true; return { value, error: undefined }; },
      error => { settled = true; return { value: undefined, error }; },
    );
    await enteredWait.promise;
    assert.equal(settled, false);
    assert.equal(executor.hasPending(), true);
    assert.equal(JSON.parse(fs.readFileSync(f.options.journalPath, "utf8")).pending.digest, f.digest);
    assert.equal(committed, 0);
    visible.resolve(result);
    const completed = await execution;
    assert.equal(executor.hasPending(), false);
    assert.equal(committed, status === "success" ? 1 : 0);
    if (status === "failure") assert.match(completed.error.message, /NoFuel/);
    else assert.equal(completed.error, undefined);
  });
}

test("a visibility timeout survives restart and waits again without resubmitting a committed transaction", async t => {
  const f = fixture(t);
  f.options.client.waitForTransaction = async () => { throw new Error("visibility timeout"); };
  const executor = createAssemblyTransactionExecutor(f.options);
  await assert.rejects(executor.execute("anchor", f.transaction), /visibility timeout/);
  assert.equal(executor.hasPending(), true);
  assert.equal(f.submissions(), 1);
  f.options.client.getTransactionBlock = async () => f.success;
  const enteredWait = deferred<void>();
  const visible = deferred<any>();
  f.options.client.waitForTransaction = async () => { enteredWait.resolve(); return visible.promise; };
  f.options.client.executeTransactionBlock = async () => assert.fail("confirmed transaction must not be submitted again");
  const restarted = createAssemblyTransactionExecutor(f.options);
  const recovery = restarted.recover();
  await enteredWait.promise;
  assert.equal(restarted.hasPending(), true);
  visible.resolve(f.success);
  await recovery;
  assert.equal(restarted.hasPending(), false);
  assert.equal(f.submissions(), 1);
});

test("a failed journal replacement after confirmation keeps the original transaction pending in memory and on disk", async t => {
  const f = fixture(t);
  let failNextRename = false;
  const renameSync = fs.renameSync;
  const rename = t.mock.method(fs, "renameSync", (source, destination) => {
    if (failNextRename) {
      failNextRename = false;
      throw new Error("journal replacement failed");
    }
    return renameSync(source, destination);
  });
  let committed = 0;
  f.options.client.executeTransactionBlock = async () => {
    assert.equal(JSON.parse(fs.readFileSync(f.options.journalPath, "utf8")).pending.digest, f.digest);
    failNextRename = true;
    return f.success;
  };
  const executor = createAssemblyTransactionExecutor({ ...f.options, onCommitted: () => { committed++; } });
  await assert.rejects(executor.execute("anchor", f.transaction), /journal replacement failed/);
  rename.mock.restore();
  assert.equal(executor.hasPending(), true);
  assert.equal(JSON.parse(fs.readFileSync(f.options.journalPath, "utf8")).pending.digest, f.digest);
  assert.equal(committed, 0);
  f.options.client.getTransactionBlock = async () => f.success;
  f.options.client.executeTransactionBlock = async () => assert.fail("the confirmed transaction must not be resubmitted");
  await executor.recover();
  assert.equal(executor.hasPending(), false);
  assert.equal(committed, 1);
});

test("a deployment change during the visibility wait preserves the pending transaction", async t => {
  const f = fixture(t);
  const enteredWait = deferred<void>();
  const visible = deferred<any>();
  let current = true;
  f.options.assertCurrent = async () => { if (!current) throw new Error("deployment changed"); };
  f.options.client.waitForTransaction = async () => { enteredWait.resolve(); return visible.promise; };
  const executor = createAssemblyTransactionExecutor(f.options);
  const execution = assert.rejects(executor.execute("anchor", f.transaction), /deployment changed/);
  await enteredWait.promise;
  current = false;
  visible.resolve(f.success);
  await execution;
  assert.equal(executor.hasPending(), true);
  assert.equal(JSON.parse(fs.readFileSync(f.options.journalPath, "utf8")).pending.digest, f.digest);
  assert.equal(f.submissions(), 1);
});

test("confirmed gas waits for a current balance read before chaining across restart", async t => {
  const f = fixture(t);
  let latest: any;
  let signatures = 0;
  f.options.adminSigner.signTransaction = async () => { signatures++; return { signature: "admin-signature" }; };
  const submittedPayments: any[] = [];
  f.options.client.executeTransactionBlock = async input => {
    const bytes = new Uint8Array(input.transactionBlock);
    const transaction = Transaction.from(bytes).getData();
    submittedPayments.push(transaction.gasData.payment);
    const ref = submittedPayments.length === 1 ? gas6745 : { ...gas6745, version: "6746" };
    latest = { digest: TransactionDataBuilder.getDigestFromBytes(bytes), effects: {
      status: { status: "success" }, gasObject: { reference: ref, owner: { AddressOwner: admin } },
    } };
    return latest;
  };
  f.options.client.waitForTransaction = async () => latest;
  f.options.client.getObject = async () => ({ data: { ...gas6744, owner: { AddressOwner: admin },
    content: { dataType: "moveObject", fields: { balance: "1000000000" } },
  } });
  await createAssemblyTransactionExecutor(f.options).execute("assembly:9988400000137:name", locationTransaction());
  const restarted = createAssemblyTransactionExecutor(f.options);
  await assert.rejects(restarted.execute("assembly:9988400000137:location", locationTransaction()),
    /gas.*not.*visible|gas.*confirmed version/i);
  assert.equal(restarted.hasPending(), false);
  assert.equal(submittedPayments.length, 1);
  assert.equal(signatures, 1, "stale balance reads must stop before signing another transaction");
  assert.deepEqual(JSON.parse(fs.readFileSync(f.options.journalPath, "utf8")).confirmedGas, gas6745);
  // Once the current balance is visible, confirmed effects replace the old
  // reference returned by transaction coin selection without downgrading it.
  f.options.client.getObject = async () => ({ data: { ...gas6745, owner: { AddressOwner: admin },
    content: { dataType: "moveObject", fields: { balance: "1000000000" } },
  } });
  await restarted.execute("assembly:9988400000137:location", locationTransaction());
  assert.deepEqual(submittedPayments, [[gas6744], [gas6745]]);
});

test("a depleted confirmed gas coin allows a different funded gas coin to be selected", async t => {
  const f = fixture(t);
  const fundedGas = { objectId: normalizeSuiAddress("0xfed"), version: "7",
    digest: TransactionDataBuilder.getDigestFromBytes(new Uint8Array([7])) };
  const submittedPayments: any[] = [];
  let latest: any;
  f.options.client.executeTransactionBlock = async input => {
    const bytes = new Uint8Array(input.transactionBlock);
    submittedPayments.push(Transaction.from(bytes).getData().gasData.payment);
    const ref = submittedPayments.length === 1 ? gas6745 : { ...fundedGas, version: "8" };
    latest = { digest: TransactionDataBuilder.getDigestFromBytes(bytes), effects: {
      status: { status: "success" }, gasObject: { reference: ref, owner: { AddressOwner: admin } },
    } };
    return latest;
  };
  f.options.client.waitForTransaction = async () => latest;
  f.options.client.getObject = async () => ({ data: { ...gas6745, owner: { AddressOwner: admin },
    content: { dataType: "moveObject", fields: { balance: "99999999" } },
  } });
  const executor = createAssemblyTransactionExecutor(f.options);
  await executor.execute("assembly:9988400000137:name", locationTransaction());
  await executor.execute("assembly:9988400000137:location", locationTransaction(fundedGas));
  assert.deepEqual(submittedPayments, [[gas6744], [fundedGas]]);
  assert.equal(executor.hasPending(), false);
  assert.equal(JSON.parse(fs.readFileSync(f.options.journalPath, "utf8")).lastTransaction.digest, latest.digest);
});

async function staleLocationFixture(t: any) {
  const f = fixture(t);
  const bytes = await locationTransaction().build();
  const digest = TransactionDataBuilder.getDigestFromBytes(bytes);
  const pending = { label: "assembly:9988400000137:location", digest, bytes: Buffer.from(bytes).toString("base64"), signatures: ["admin-signature"] };
  fs.writeFileSync(f.options.journalPath, JSON.stringify({ version: 1, chainId: "local", packageId: "world", pending }));
  const prior: any = {
    digest: nameDigest,
    transaction: { data: { gasData: { payment: [{ ...gas6744 }], owner: admin, price: "1000", budget: "100000000" } } },
    effects: {
      transactionDigest: nameDigest, status: { status: "success" },
      modifiedAtVersions: [{ objectId: gas6744.objectId, sequenceNumber: gas6744.version }],
      gasObject: { reference: gas6745, owner: { AddressOwner: admin } },
    },
  };
  const current: any = { data: { ...gas6745, previousTransaction: nameDigest, owner: { AddressOwner: admin },
    type: "0x2::coin::Coin<0x2::sui::SUI>", content: { dataType: "moveObject", fields: { balance: "1000000000" } },
  } };
  let submitted = 0;
  f.options.client.getObject = async () => current;
  f.options.client.getTransactionBlock = async function (input?: any) {
    if (input?.digest === nameDigest) return prior;
    throw new Error("Could not find the referenced transaction");
  };
  f.options.client.waitForTransaction = async input => {
    if (input.digest === nameDigest) return prior;
    throw new Error("Could not find the referenced transaction");
  };
  f.options.client.executeTransactionBlock = async () => {
    submitted++;
    throw new Error(`Transaction needs to be rebuilt because object ${gas6744.objectId} version 0x1a58 (${gas6744.digest}) is unavailable for consumption, current version: 0x1a59`);
  };
  return { ...f, pending, prior, current, submitted: () => submitted };
}

for (const status of ["success", "failure"] as const) {
  test(`confirmed ${status} effects consuming gas 6744 prove the pending location cannot execute`, async t => {
    const f = await staleLocationFixture(t);
    f.prior.effects.status.status = status;
    const executor = createAssemblyTransactionExecutor(f.options);
    await assert.rejects(executor.recover(), /superseded.*rescan/i);
    assert.equal(executor.hasPending(), false);
    assert.equal(f.submitted(), 1);
    const journal = JSON.parse(fs.readFileSync(f.options.journalPath, "utf8"));
    assert.equal(journal.pending, undefined);
    assert.deepEqual(journal.rejectedTransactions, [{ ...f.pending, conflictingDigest: nameDigest,
      objectId: gas6744.objectId, version: gas6744.version }]);
  });
}

for (const missingProof of ["previousTransaction", "input digest", "matching input digest", "effects digest", "matching effects digest", "consumed version"] as const) {
  test(`stale gas stays pending without ${missingProof} proof`, async t => {
    const f = await staleLocationFixture(t);
    if (missingProof === "previousTransaction") delete f.current.data.previousTransaction;
    if (missingProof === "input digest") delete f.prior.transaction.data.gasData.payment[0].digest;
    if (missingProof === "matching input digest") f.prior.transaction.data.gasData.payment[0] = { ...gas6744, digest: gas6745.digest };
    if (missingProof === "effects digest") delete f.prior.effects.transactionDigest;
    if (missingProof === "matching effects digest") f.prior.effects.transactionDigest = f.pending.digest;
    if (missingProof === "consumed version") f.prior.effects.modifiedAtVersions = [];
    const executor = createAssemblyTransactionExecutor(f.options);
    await assert.rejects(executor.recover());
    assert.equal(executor.hasPending(), true);
    assert.deepEqual(JSON.parse(fs.readFileSync(f.options.journalPath, "utf8")).pending, f.pending);
  });
}

test("an object naming the pending transaction as its previous transaction cannot prove supersession", async t => {
  const f = await staleLocationFixture(t);
  f.current.data.previousTransaction = f.pending.digest;
  const executor = createAssemblyTransactionExecutor(f.options);
  await assert.rejects(executor.recover(), /unavailable for consumption/);
  assert.equal(executor.hasPending(), true);
  assert.equal(f.submitted(), 1);
  const journal = JSON.parse(fs.readFileSync(f.options.journalPath, "utf8"));
  assert.deepEqual(journal.pending, f.pending);
  assert.equal(journal.rejectedTransactions, undefined);
});

test("a proven obsolete location transaction can be rebuilt with current gas and confirmed", async t => {
  const f = await staleLocationFixture(t);
  const executor = createAssemblyTransactionExecutor(f.options);
  await assert.rejects(executor.recover(), /superseded.*rescan/i);
  let latest: any;
  let freshSubmissions = 0;
  f.options.client.executeTransactionBlock = async input => {
    freshSubmissions++;
    const bytes = new Uint8Array(input.transactionBlock);
    assert.deepEqual(Transaction.from(bytes).getData().gasData.payment, [gas6745]);
    const digest = TransactionDataBuilder.getDigestFromBytes(bytes);
    assert.notEqual(digest, f.pending.digest);
    latest = { digest, effects: { status: { status: "success" },
      gasObject: { reference: { ...gas6745, version: "6746" }, owner: { AddressOwner: admin } },
    } };
    return latest;
  };
  f.options.client.waitForTransaction = async () => latest;
  await executor.execute(f.pending.label, locationTransaction(gas6745));
  assert.equal(freshSubmissions, 1);
  assert.equal(executor.hasPending(), false);
  const journal = JSON.parse(fs.readFileSync(f.options.journalPath, "utf8"));
  assert.equal(journal.pending, undefined);
  assert.equal(journal.lastTransaction.digest, latest.digest);
  assert.equal(journal.lastTransaction.status, "success");
  assert.equal(journal.rejectedTransactions[0].digest, f.pending.digest);
});
