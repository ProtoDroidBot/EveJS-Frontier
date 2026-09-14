import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { Transaction, TransactionDataBuilder } from "@mysten/sui/transactions";
import { normalizeSuiAddress } from "@mysten/sui/utils";
import { createAssemblyTransactionExecutor } from "../src/services/frontier/suiAssemblyTransactions";
import { createSponsoredAssemblyAdmin, verifySponsoredAssemblySignature } from "../src/services/frontier/suiAssemblyAdmin";

function fixture(t: any) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "evejs-admin-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const owner = Ed25519Keypair.generate();
  const sponsor = Ed25519Keypair.generate();
  const assemblyID = 50;
  const assemblyObjectID = normalizeSuiAddress("0x50");
  const state: any = { now: 1000, active: true, submits: 0, sponsorSigns: 0, commits: 0, sequence: [],
    assembly: { itemId: "50", typeId: 10, ownerId: 9, status: 1, kind: "assembly", solarSystemId: 7,
      networkNodeId: null, destinationGateId: null, position: { x: 0, y: 0, z: 0 }, fuel: { quantity: 0, typeId: 0, unitVolume: "0" } },
    connected: [], chainStatus: false, lost: false, commitFails: false, failed: false,
  };
  const transaction = () => {
    const tx = new Transaction();
    tx.setSender(owner.toSuiAddress()); tx.setGasOwner(sponsor.toSuiAddress());
    tx.setGasBudget(100_000_000); tx.setGasPrice(1000);
    tx.setGasPayment([{ objectId: normalizeSuiAddress("0x77"), version: "1", digest: "11111111111111111111111111111111" }]);
    return tx;
  };
  const results = new Map<string, any>();
  const executorOptions: any = {
    journalPath: path.join(root, "transactions.json"), chainId: "abcd", packageId: normalizeSuiAddress("0x1"),
    getSigner() { assert.fail("A wallet operation must never use the server's derived player signer"); },
    adminSigner: { toSuiAddress: () => sponsor.toSuiAddress(), async signTransaction(bytes: Uint8Array) {
      state.sponsorSigns++; return sponsor.signTransaction(bytes);
    } },
    async assertCurrent() { if (state.deploymentChanged) throw Object.assign(new Error("changed"), { code: "DEPLOYMENT_MISMATCH" }); },
    async reconcileSponsored(metadata: any, digest: string) {
      state.sequence.push("reconcile");
      if (state.commitFails) throw new Error("disk unavailable");
      assert.equal(results.get(digest).effects.status.status, "success");
      state.metadata = metadata;
      state.assembly.status = metadata.affected[0].targetStatus;
      state.commits++;
    },
    onCommitted() { state.sequence.push("unlocked"); },
    client: {
      async getObject() { throw new Error("not indexed"); },
      async getTransactionBlock({ digest }: any) {
        const result = results.get(digest);
        if (!result || state.lost) throw new Error("offline");
        return result;
      },
      async executeTransactionBlock(input: any) {
        state.submits++;
        state.sequence.push("submit");
        const digest = TransactionDataBuilder.getDigestFromBytes(input.transactionBlock);
        assert.equal(await verifySponsoredAssemblySignature(Buffer.from(input.transactionBlock).toString("base64"), input.signature[0], owner.toSuiAddress()), true);
        assert.equal(await verifySponsoredAssemblySignature(Buffer.from(input.transactionBlock).toString("base64"), input.signature[1], sponsor.toSuiAddress()), true);
        const result = { digest, effects: { transactionDigest: digest, status: { status: state.failed ? "failure" : "success", error: "Move failed" } } };
        results.set(digest, result);
        if (state.lost) throw new Error("lost response");
        return result;
      },
      async waitForTransaction({ digest }: any) { return results.get(digest); },
    },
  };
  let tail = Promise.resolve();
  const context: any = {
    synced: { network: "localnet", chainId: "abcd", packageId: normalizeSuiAddress("0x1"), objectRegistryId: normalizeSuiAddress("0x2") },
    world: { adminAclId: normalizeSuiAddress("0x3"), energyConfigId: normalizeSuiAddress("0x4"), fuelConfigId: normalizeSuiAddress("0x5") },
    assertCurrent: executorOptions.assertCurrent,
    executor: createAssemblyTransactionExecutor(executorOptions),
    getCharacter: async () => ({ address: owner.toSuiAddress() }),
    chain: {
      deriveId: (id: string) => normalizeSuiAddress(`0x${id}`),
      readAssembly: async () => ({ online: state.chainStatus }),
      buildStatusTransaction: async () => ({ transaction: transaction(), connectedAssemblyIds: state.connected.map((a: any) => normalizeSuiAddress(`0x${a.itemId}`)) }),
    },
  };
  const options: any = {
    now: () => state.now,
    runExclusive(action: any) { const result = tail.then(action); tail = result.then(() => {}, () => {}); return result; },
    getContext: () => context,
    getSnapshot: () => ({ assemblies: structuredClone([state.assembly, ...state.connected]) }),
    validateAccess(request: any, assembly: any) {
      if (request.characterID !== assembly.ownerId) throw Object.assign(new Error("owner"), { code: "ACCESS_DENIED" });
    },
  };
  const request = {
    assemblyID, action: "online", tenant: "dev", characterID: 9, walletAddress: owner.toSuiAddress(),
    expectedAssemblyObjectID: assemblyObjectID, expectedPackageId: context.synced.packageId,
    expectedObjectRegistryId: context.synced.objectRegistryId,
    assertAuthenticated() {
      if (!state.active) throw Object.assign(new Error("expired"), { code: "AUTH_EXPIRED" });
      return { characterID: 9, walletAddress: owner.toSuiAddress(), session: {} };
    },
  };
  const service = createSponsoredAssemblyAdmin(options);
  async function prepare(overrides: any = {}) {
    const result = await service.prepare({ ...request, ...overrides });
    return result.data;
  }
  async function signed(data: any) {
    return { ...request, action: data.action, transactionUUID: data.transactionUUID, bytes: data.transactionData,
      signature: (await owner.signTransaction(Buffer.from(data.transactionData, "base64"))).signature };
  }
  return { service, context, options, request, state, owner, sponsor, executorOptions, prepare, signed, root };
}

test("prepared owner bytes retain the sponsor gas owner and never sign or submit before approval", async t => {
  const f = fixture(t);
  const prepared = await f.prepare();
  const tx = TransactionDataBuilder.fromBytes(Buffer.from(prepared.transactionData, "base64"));
  assert.equal(tx.sender, f.owner.toSuiAddress());
  assert.equal(tx.gasData.owner, f.sponsor.toSuiAddress());
  assert.equal(prepared.digest, TransactionDataBuilder.getDigestFromBytes(Buffer.from(prepared.transactionData, "base64")));
  assert.equal(prepared.expiresAt, 121000);
  assert.equal(f.state.sponsorSigns, 0);
  assert.equal(f.state.submits, 0);
  assert.equal("adminPrivateKey" in prepared.deployment, false);
  assert.deepEqual(await f.prepare(), prepared);
  await assert.rejects(f.prepare({ action: "offline" }), { code: "SPONSOR_BUSY" });
});

test("owner and deployment allowlists reject changed request identity", async t => {
  const f = fixture(t);
  for (const overrides of [{ expectedAssemblyObjectID: "0xff" }, { expectedPackageId: "0xff" }, { expectedObjectRegistryId: "0xff" }]) {
    await assert.rejects(f.prepare(overrides), { code: "DEPLOYMENT_MISMATCH" });
  }
  await assert.rejects(f.prepare({ characterID: 20 }), { code: "ACCESS_DENIED" });
  await assert.rejects(f.prepare({ action: "transfer" }), { code: "INVALID_ACTION" });
  await assert.rejects(f.prepare({ tenant: "production" }), { code: "INVALID_ACTION" });
  f.state.assembly.kind = "network_node";
  await assert.rejects(f.prepare(), { code: "NETWORK_NODE_FUEL_REQUIRED" });
  f.state.assembly.kind = "gate";
  await assert.rejects(f.prepare(), { code: "SMART_GATE_DESTINATION_REQUIRED" });
  assert.equal(f.state.submits, 0);
});

test("different bytes, signer, assembly, action, and expired preparation cannot receive sponsor signature", async t => {
  const f = fixture(t);
  const data = await f.prepare(); const request = await f.signed(data);
  for (const changes of [{ bytes: "AAAA" }, { assemblyID: 51 }, { action: "offline" }]) {
    await assert.rejects(f.service.execute({ ...request, ...changes }), { code: "TRANSACTION_MISMATCH" });
  }
  await assert.rejects(f.service.execute({ ...request, signature: (await f.sponsor.signTransaction(Buffer.from(request.bytes, "base64"))).signature }), { code: "INVALID_SIGNATURE" });
  f.state.now = data.expiresAt;
  await assert.rejects(f.service.execute(request), { code: "TRANSACTION_NOT_FOUND" });
  assert.equal(f.state.sponsorSigns, 0);
});

test("live session and local fuel/status are rechecked after asynchronous signature verification", async t => {
  const f = fixture(t);
  const service = createSponsoredAssemblyAdmin({ ...f.options, async verifySignature() { f.state.active = false; return true; } });
  const data = (await service.prepare(f.request)).data;
  await assert.rejects(service.execute(await f.signed(data)), { code: "AUTH_EXPIRED" });
  f.state.active = true;
  const other = await f.prepare();
  f.state.assembly.fuel.quantity = 1;
  await assert.rejects(f.service.execute(await f.signed(other)), { code: "ASSEMBLY_STATE_CHANGED" });
  assert.equal(f.state.submits, 0);
});

test("concurrent execute retries submit once and local confirmation completes before mirror unlock", async t => {
  const f = fixture(t);
  const request = await f.signed(await f.prepare());
  const [first, retry] = await Promise.all([f.service.execute(request), f.service.execute(request)]);
  assert.equal(first.data.gameCommitted, true);
  assert.equal(retry.data.replayed, true);
  assert.equal(f.state.submits, 1);
  assert.equal(f.state.sponsorSigns, 1);
  assert.equal(f.state.commits, 1);
  assert.deepEqual(f.state.sequence, ["submit", "reconcile", "unlocked"]);
});

test("lost response survives restart and expiry and recovers identical bytes before local reconciliation", async t => {
  const f = fixture(t);
  const request = await f.signed(await f.prepare());
  f.state.lost = true;
  const pending = await f.service.execute(request);
  assert.equal(pending.errorMsg, "TRANSACTION_PENDING");
  assert.equal(f.context.executor.hasPending(), true);
  assert.equal(f.state.commits, 0);
  f.context.executor = createAssemblyTransactionExecutor(f.executorOptions);
  f.state.lost = false; f.state.now += 300000;
  const restarted = createSponsoredAssemblyAdmin(f.options);
  const completed = await restarted.execute(request);
  assert.equal(completed.data.digest, pending.params.digest);
  assert.equal(f.state.submits, 1);
  assert.equal(f.state.sponsorSigns, 1);
  assert.equal(f.state.commits, 1);
  assert.equal((await restarted.execute(request)).data.replayed, true);
});

test("failed local save leaves confirmed chain operation pending and blocks mirror until recovery", async t => {
  const f = fixture(t);
  const request = await f.signed(await f.prepare());
  f.state.commitFails = true;
  assert.equal((await f.service.execute(request)).errorMsg, "TRANSACTION_PENDING");
  assert.equal(f.context.executor.hasPending(), true);
  await assert.rejects(f.context.executor.recover(), /disk unavailable/);
  assert.equal(f.state.sequence.includes("unlocked"), false);
  f.state.commitFails = false;
  await f.context.executor.recover();
  assert.equal(f.context.executor.hasPending(), false);
  assert.equal(f.state.assembly.status, 2);
  assert.equal((await f.service.execute(request)).data.replayed, true);
  assert.equal(f.state.submits, 1);
});

test("definite chain failure never commits local state and remains terminal after restart", async t => {
  const f = fixture(t);
  const request = await f.signed(await f.prepare());
  f.state.failed = true;
  await assert.rejects(f.service.execute(request), { code: "TRANSACTION_FAILED" });
  assert.equal(f.context.executor.hasPending(), false);
  assert.equal(f.state.commits, 0);
  f.context.executor = createAssemblyTransactionExecutor(f.executorOptions);
  await assert.rejects(createSponsoredAssemblyAdmin(f.options).execute(request), { code: "TRANSACTION_FAILED" });
  assert.equal(f.state.submits, 1);
});

test("node offline freezes and records every reviewed connected assembly for durable local cascade", async t => {
  const f = fixture(t);
  f.state.assembly.kind = "network_node"; f.state.assembly.status = 2; f.state.chainStatus = true;
  f.state.connected = [{ ...f.state.assembly, itemId: "51", typeId: 11, kind: "storage_unit", ownerId: 99, networkNodeId: "50" }];
  const request = await f.signed(await f.prepare({ action: "offline" }));
  await f.service.execute(request);
  assert.deepEqual(f.state.metadata.affected, [
    { assemblyID: 50, ownerID: 9, typeID: 10, targetStatus: 1 },
    { assemblyID: 51, ownerID: 99, typeID: 11, targetStatus: 1 },
  ]);
});
