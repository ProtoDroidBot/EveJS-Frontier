import assert = require("node:assert/strict");
import { test } from "node:test";
import { TransactionDataBuilder } from "@mysten/sui/transactions";

import { prepareSuiNpcCharacterIdentity } from "../src/services/frontier/suiNpcCharacterProvisioning";
import {
  createSuiNpcProfileTransaction, deriveSuiNpcProfileObjectId, normalizeNpcLifecycle,
  reconcileSuiNpcProfile, type SuiNpcProfileJournal,
} from "../src/services/frontier/suiNpcProfile";
import { readSuiNpcWorldConfig } from "../src/services/frontier/suiNpcWorldConfig";

const chainId = "a1b2c3d4";
const identity = prepareSuiNpcCharacterIdentity({ gameCharacterId: 1500000000, characterName: "Osa Pilot", factionKey: "500025-osa" }, { env: {} });
const alive = { incarnation: "1", activeEntityID: "980000000001", deaths: "0" };
const dead = { incarnation: "1", activeEntityID: "0", deaths: "1" };
const respawn = { incarnation: "2", activeEntityID: "980000000002", deaths: "1" };
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));

function fixture(initial: typeof alive | null = null) {
  const env: NodeJS.ProcessEnv = {
    EVEJS_SUI_NPC_PACKAGE_ID: `0x${"7".repeat(64)}`,
    EVEJS_SUI_NPC_TYPE_ORIGIN: `0x${"8".repeat(64)}`,
  };
  const npcWorld = readSuiNpcWorldConfig({ ...identity, chainId }, env);
  const profileId = deriveSuiNpcProfileObjectId(identity.objectRegistryId, identity.characterObjectId, npcWorld.npcTypeOrigin);
  const contexts: any[] = [];
  const submitted: any[] = [];
  const transactions = new Map<string, any>();
  let journal: SuiNpcProfileJournal | null = null;
  let profile: any = initial ? profileObject(initial) : null;
  function profileObject(lifecycle: typeof alive, revision = "1") {
    return {
      objectId: profileId, type: `${npcWorld.npcTypeOrigin}::npc::NpcProfile`,
      owner: { $kind: "Shared" }, previousTransaction: "prior-create",
      json: {
        character_id: identity.characterObjectId, registry_id: identity.objectRegistryId,
        admin_acl_id: identity.adminAclId, tenant: identity.tenant, npc_id: identity.gameCharacterId,
        faction_key: identity.factionKey, wallet_address: identity.walletAddress,
        revision, incarnation: lifecycle.incarnation, active_entity_id: lifecycle.activeEntityID,
        deaths: lifecycle.deaths, retired: false,
      },
    };
  }
  const client = {
    async getChainIdentifier() { return { chainIdentifier: chainId }; },
    async getObject({ objectId }: any) {
      if (objectId === identity.characterObjectId) return { object: {
        objectId, type: `${identity.packageId}::character::Character`, owner: { $kind: "Shared" },
        json: { key: { item_id: String(identity.gameCharacterId), tenant: identity.tenant },
          character_address: identity.walletAddress, tribe_id: identity.tribeId },
      } };
      assert.equal(objectId, profileId);
      if (!profile) throw { reason: "notFound" };
      return { object: clone(profile) };
    },
    async getTransaction({ digest }: any) {
      if (!transactions.has(digest)) throw { reason: "notFound", digest };
      return transactions.get(digest);
    },
    async listOwnedObjects() { throw new Error("Profiles are derived, not wallet-scanned"); },
    async signAndExecuteTransaction() { throw new Error("Profile writes must use durable split submission"); },
    async executeTransaction(request: any) {
      assert.ok(journal, "The transaction journal must be persisted before submission");
      submitted.push(request);
      assert.equal(TransactionDataBuilder.getDigestFromBytes(request.transaction), journal!.transactionDigest);
      assert.deepEqual(request.signatures, [journal!.transactionSignature]);
      profile = profileObject(journal!.lifecycle, profile ? (BigInt(profile.json.revision) + 1n).toString() : "1");
      profile.previousTransaction = journal!.transactionDigest;
      const success = { $kind: "Transaction", Transaction: { digest: journal!.transactionDigest, status: { success: true } } };
      transactions.set(journal!.transactionDigest, success);
      return success;
    },
  };
  const options = {
    client, npcWorld, env, reconciliationDelaysMs: [0],
    adminSigner: { toSuiAddress: () => "0x1", async signTransaction() { return { signature: "test-signature" }; } },
    transactionFactory(context: any): any {
      contexts.push(context);
      return { setSenderIfNotSet() {}, async build() { return new Uint8Array([1, 2, 3, contexts.length]); } };
    },
    onTransactionPrepared(prepared: SuiNpcProfileJournal) { journal = clone(prepared); },
  };
  return {
    options, client, contexts, submitted, transactions, profileId, profileObject,
    getProfile: () => profile, setProfile: (value: any) => { profile = value; },
    getJournal: () => journal, setJournal: (value: SuiNpcProfileJournal) => { journal = value; },
  };
}

test("NPC lifecycle normalization validates u64 state without rounding", () => {
  assert.deepEqual(normalizeNpcLifecycle({ incarnation: 2, activeEntityID: 980000000002, deaths: 1 }), respawn);
  assert.equal(normalizeNpcLifecycle({ incarnation: "18446744073709551615", activeEntityID: 0, deaths: 0 }).incarnation, "18446744073709551615");
  for (const invalid of [
    { incarnation: 0, activeEntityID: 0, deaths: 0 },
    { incarnation: 1, activeEntityID: 1, deaths: 1 },
    { incarnation: 1, activeEntityID: 0, deaths: 2 },
    { incarnation: 1, activeEntityID: Number.MAX_SAFE_INTEGER + 1, deaths: 0 },
    { incarnation: "18446744073709551616", activeEntityID: 0, deaths: 0 },
  ]) assert.throws(() => normalizeNpcLifecycle(invalid), (error: any) => error.code === "INVALID_NPC_LIFECYCLE");
});

test("NPC profile derivation uses the NPC type origin while calls target the latest package", () => {
  const f = fixture();
  assert.notEqual(f.profileId, deriveSuiNpcProfileObjectId(identity.objectRegistryId, identity.characterObjectId, identity.packageId));
  const register = createSuiNpcProfileTransaction({ operation: "register", identity, lifecycle: alive, npcProfileObjectId: f.profileId, npcWorld: f.options.npcWorld }).getData();
  assert.equal(register.commands[0].MoveCall.package, f.options.npcWorld.npcPackageId);
  assert.equal(register.commands[0].MoveCall.function, "register_profile");
  assert.equal(register.commands[0].MoveCall.arguments.length, 8);
  const sync = createSuiNpcProfileTransaction({ operation: "sync", identity, lifecycle: dead, npcProfileObjectId: f.profileId, expectedRevision: "4", npcWorld: f.options.npcWorld }).getData();
  assert.equal(sync.commands[0].MoveCall.function, "sync_lifecycle");
  assert.equal(sync.commands[0].MoveCall.arguments.length, 6);
});

test("legacy NPC Character gains a derived shared NpcProfile through a durable registration", async () => {
  const f = fixture();
  const output = await reconcileSuiNpcProfile({ identity, lifecycle: alive }, f.options);
  assert.equal(f.contexts[0].operation, "register");
  assert.equal(f.submitted.length, 1);
  assert.equal(output.npcProfileObjectId, f.profileId);
  assert.equal(output.revision, "1");
  assert.equal(output.activeEntityID, alive.activeEntityID);
  assert.equal(f.getJournal()?.npcWorldFingerprint, f.options.npcWorld.fingerprint);
  assert.equal(f.getJournal()?.chainId, chainId);
});

test("matching NPC lifecycle is a read-only reconciliation", async () => {
  const f = fixture(alive);
  const output = await reconcileSuiNpcProfile({ identity, lifecycle: alive }, f.options);
  assert.equal(output.recovered, true);
  assert.equal(output.revision, "1");
  assert.equal(f.submitted.length, 0);
  assert.equal(f.contexts.length, 0);
});

test("NPC death and respawn synchronize monotonically with the observed revision", async () => {
  const f = fixture(alive);
  const death = await reconcileSuiNpcProfile({ identity, lifecycle: dead }, f.options);
  assert.equal(death.revision, "2");
  assert.equal(f.contexts[0].expectedRevision, "1");
  const reborn = await reconcileSuiNpcProfile({ identity, lifecycle: respawn }, f.options);
  assert.equal(reborn.revision, "3");
  assert.equal(f.contexts[1].expectedRevision, "2");
  assert.equal(reborn.npcProfileObjectId, death.npcProfileObjectId);
});

test("NPC profile immutable mismatches, owned profiles, and retired pilots fail closed", async () => {
  for (const change of [
    (object: any) => { object.json.faction_key = "500025-feral"; },
    (object: any) => { object.json.registry_id = "0x1"; },
    (object: any) => { object.json.character_id = "0x1"; },
    (object: any) => { object.json.wallet_address = "0x1"; },
    (object: any) => { object.owner = { $kind: "AddressOwner", AddressOwner: identity.walletAddress }; },
    (object: any) => { object.json.retired = true; object.json.active_entity_id = "0"; },
  ]) {
    const f = fixture(alive);
    change(f.getProfile());
    await assert.rejects(reconcileSuiNpcProfile({ identity, lifecycle: alive }, f.options),
      (error: any) => ["NPC_PROFILE_BINDING_MISMATCH", "NPC_PROFILE_RETIRED"].includes(error.code));
    assert.equal(f.submitted.length, 0);
  }
});

test("NPC stale or impossible lifecycle transitions never overwrite chain state", async () => {
  for (const [current, desired] of [
    [respawn, alive], [dead, alive],
    [alive, { ...alive, activeEntityID: "980000000003" }],
    [alive, { ...respawn, activeEntityID: alive.activeEntityID }],
  ]) {
    const f = fixture(current);
    await assert.rejects(reconcileSuiNpcProfile({ identity, lifecycle: desired }, f.options),
      (error: any) => error.code === "NPC_LIFECYCLE_STALE");
    assert.equal(f.submitted.length, 0);
  }
});

test("NPC pending profile retries exact bytes before a newer lifecycle transaction", async () => {
  const f = fixture();
  const execute = f.client.executeTransaction;
  f.client.executeTransaction = async () => { throw new Error("submission disconnected"); };
  await assert.rejects(reconcileSuiNpcProfile({ identity, lifecycle: alive }, f.options),
    (error: any) => error.code === "TRANSACTION_STATUS_UNKNOWN" && error.ambiguous);
  const pending = clone(f.getJournal()!);
  assert.ok(pending.transactionSignature);
  f.client.executeTransaction = execute;
  const output = await reconcileSuiNpcProfile({ identity, lifecycle: dead, journal: pending }, f.options);
  assert.equal(f.submitted.length, 2);
  assert.deepEqual(f.submitted[0].transaction, new Uint8Array(Buffer.from(pending.transactionBytesBase64!, "base64")));
  assert.equal(f.contexts.length, 2, "Replay itself must not build or sign another transaction");
  assert.equal(output.activeEntityID, "0");
  assert.equal(output.deaths, "1");
  assert.equal(output.revision, "2");
});

test("NPC definitive transaction failure is not masked by an apparently matching profile", async () => {
  const f = fixture();
  f.client.executeTransaction = async () => ({ $kind: "FailedTransaction", FailedTransaction: { status: { success: false } } }) as any;
  await assert.rejects(reconcileSuiNpcProfile({ identity, lifecycle: alive }, f.options),
    (error: any) => error.code === "TRANSACTION_FAILED" && !error.ambiguous);
  const pending = f.getJournal()!;
  f.setProfile(f.profileObject(alive));
  f.transactions.set(pending.transactionDigest, { $kind: "FailedTransaction", FailedTransaction: { status: { success: false } } });
  await assert.rejects(reconcileSuiNpcProfile({ identity, lifecycle: alive, journal: pending }, f.options),
    (error: any) => error.code === "TRANSACTION_FAILED" && error.transactionDigest === pending.transactionDigest);
});

test("NPC journal from a different chain or upgrade cannot be replayed", async () => {
  const f = fixture();
  f.client.executeTransaction = async () => { throw new Error("connection closed"); };
  await assert.rejects(reconcileSuiNpcProfile({ identity, lifecycle: alive }, f.options));
  const pending = f.getJournal()!;
  for (const journal of [{ ...pending, chainId: "deadbeef" }, { ...pending, npcWorldFingerprint: "old" }]) {
    await assert.rejects(reconcileSuiNpcProfile({ identity, lifecycle: alive, journal }, f.options),
      (error: any) => error.code === "NPC_PROFILE_JOURNAL_MISMATCH");
  }
  assert.equal(f.submitted.length, 0);
});

test("NPC package changes during journal persistence abort before submission", async () => {
  const f = fixture();
  const prepared = f.options.onTransactionPrepared;
  f.options.onTransactionPrepared = journal => {
    prepared(journal);
    f.options.env.EVEJS_SUI_NPC_PACKAGE_ID = `0x${"9".repeat(64)}`;
  };
  await assert.rejects(reconcileSuiNpcProfile({ identity, lifecycle: alive }, f.options),
    (error: any) => error.code === "NPC_WORLD_CHANGED");
  assert.equal(f.submitted.length, 0);
  assert.ok(f.getJournal(), "The durable journal remains available for inspection");
});

test("NPC base-world and Localnet changes after signing abort before submission", async () => {
  for (const change of ["world", "chain"]) {
    const f = fixture();
    const prepared = f.options.onTransactionPrepared;
    f.options.onTransactionPrepared = journal => {
      prepared(journal);
      if (change === "world") f.options.env.EVEJS_SUI_WORLD_PACKAGE_ID = `0x${"9".repeat(64)}`;
      else f.client.getChainIdentifier = async () => ({ chainIdentifier: "deadbeef" });
    };
    await assert.rejects(reconcileSuiNpcProfile({ identity, lifecycle: alive }, f.options),
      (error: any) => error.code === (change === "world" ? "WORLD_CONFIGURATION_CHANGED" : "WORLD_CHAIN_MISMATCH"));
    assert.equal(f.submitted.length, 0);
  }
});

test("NPC committed journal waits for object visibility without registering a duplicate", async () => {
  const f = fixture();
  await reconcileSuiNpcProfile({ identity, lifecycle: alive }, f.options);
  const pending = f.getJournal()!;
  f.setProfile(null);
  await assert.rejects(reconcileSuiNpcProfile({ identity, lifecycle: alive, journal: pending }, f.options),
    (error: any) => error.code === "TRANSACTION_STATUS_UNKNOWN" && error.ambiguous);
  assert.equal(f.submitted.length, 1);
});

test("NPC orphan sidecar cannot confirm a Character deleted through an older package", async () => {
  const f = fixture(alive);
  const read = f.client.getObject;
  f.client.getObject = async options => {
    if (options.objectId === identity.characterObjectId) throw new Error("wrapped", { cause: Object.assign(new Error("missing"), { code: "NOT_FOUND" }) });
    return read(options);
  };
  await assert.rejects(reconcileSuiNpcProfile({ identity, lifecycle: alive }, f.options),
    (error: any) => error.code === "NPC_CHARACTER_MISSING");
  assert.equal(f.submitted.length, 0);
});

test("NPC parent Character is checked again before reporting a confirmed profile", async () => {
  const f = fixture(alive);
  const read = f.client.getObject;
  let parentReads = 0;
  f.client.getObject = async options => {
    if (options.objectId === identity.characterObjectId && ++parentReads > 1) throw { reason: "notFound" };
    return read(options);
  };
  await assert.rejects(reconcileSuiNpcProfile({ identity, lifecycle: alive }, f.options),
    (error: any) => error.code === "NPC_CHARACTER_MISSING");
  assert.equal(parentReads, 2);
  assert.equal(f.submitted.length, 0);
});
