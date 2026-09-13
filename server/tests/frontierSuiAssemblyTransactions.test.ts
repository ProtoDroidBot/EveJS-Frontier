import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { TransactionDataBuilder } from "@mysten/sui/transactions";
import { createAssemblyTransactionExecutor } from "../src/services/frontier/suiAssemblyTransactions";

function fixture(t: any) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "evejs-sui-journal-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const bytes = Uint8Array.from([0, 1, 2, 3]);
  const digest = TransactionDataBuilder.getDigestFromBytes(bytes);
  const success = { digest, effects: { status: { status: "success" } } };
  let submitted = 0;
  const options = {
    client: {
      async getTransactionBlock(): Promise<any> { throw new Error("not found"); },
      async executeTransactionBlock(_input: any) { submitted++; return success; },
    },
    journalPath: path.join(dir, "transactions.json"), chainId: "local", packageId: "world",
    adminSigner: { toSuiAddress: () => "admin", signTransaction: async () => ({ signature: "admin-signature" }) },
    getSigner: (_id: number) => ({ toSuiAddress: () => "player", signTransaction: async () => ({ signature: "player-signature" }) }),
    assertCurrent: async () => {},
  };
  const transaction = { setSender() {}, setGasOwner() {}, setGasBudget() {}, async build() { return bytes; } };
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
  f.options.client.executeTransactionBlock = async () => ({ digest: f.digest, effects: { status: { status: "failure", error: "NoFuel" } } });
  const executor = createAssemblyTransactionExecutor(f.options);
  await assert.rejects(executor.execute("online", f.transaction), /NoFuel/);
  assert.equal(executor.hasPending(), false);
});
