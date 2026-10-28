import assert = require("node:assert/strict");
import { test } from "node:test";

import { resolveSuiCharacterWorld } from "../src/services/frontier/suiCharacterProvisioning";
import { prepareSuiNpcCharacterIdentity } from "../src/services/frontier/suiNpcCharacterProvisioning";
import { createSuiNpcIdentitySyncWorker, isSuiNpcIdentitySyncEnabled } from "../src/services/frontier/suiNpcIdentitySync";

const world = resolveSuiCharacterWorld({}, {});
const chainId = "a1b2c3d4";
const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value));
function pilot(characterID = 1500000000): any {
  return { characterID, characterName: `Osa ${characterID}`, factionKey: "500025-osa" };
}
function identity(p: any, currentWorld = world) {
  return prepareSuiNpcCharacterIdentity({
    gameCharacterId: p.characterID, characterName: p.characterName, factionKey: p.factionKey,
  }, { world: currentWorld, env: {} });
}
function fixture(initial: any[] = [pilot()]) {
  const rows = new Map(initial.map(row => [row.characterID, copy(row)]));
  const writes: any[] = [];
  const store = {
    list: () => [...rows.values()].map(copy),
    get: (id: number) => rows.has(id) ? copy(rows.get(id)) : null,
    update(id: number, update: (row: any) => any) {
      const row = copy(update(copy(rows.get(id))));
      rows.set(id, row);
      writes.push(copy(row));
      return copy(row);
    },
  };
  return { store, writes };
}
function result(input: any, override: any = {}): any {
  return {
    ...input.identity, chainId, network: "localnet", baseUrl: "http://localhost:9000",
    playerProfileObjectId: `profile-${input.gameCharacterId}`, transactionDigest: `created-${input.gameCharacterId}`,
    npcProfileObjectId: `npc-${input.gameCharacterId}`,
    npcProfile: { incarnation: String(input.lifecycle?.incarnation ?? 1), activeEntityID: String(input.lifecycle?.activeEntityID ?? 0), deaths: String(input.lifecycle?.deaths ?? 0) },
    recovered: false, ...override,
  };
}
function worker(f: ReturnType<typeof fixture>, options: any = {}) {
  return createSuiNpcIdentitySyncWorker({
    store: f.store, resolveWorld: () => world, readChainId: async () => chainId,
    provisioningOptions: { env: {} }, now: () => 1000, ...options,
  });
}
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

test("NPC sync construction is inert and runtime flags gate startup", () => {
  let reads = 0;
  createSuiNpcIdentitySyncWorker({
    store: { list() { reads++; return []; }, get() { return null; }, update() { throw new Error("unused"); } },
    readChainId: async () => { reads++; return chainId; },
  });
  assert.equal(reads, 0);
  assert.equal(isSuiNpcIdentitySyncEnabled({ clientCompatibilityProfile: "frontier" }), true);
  assert.equal(isSuiNpcIdentitySyncEnabled({ clientCompatibilityProfile: "eve" }), false);
  assert.equal(isSuiNpcIdentitySyncEnabled({ clientCompatibilityProfile: "frontier", npcPilotIdentitiesEnabled: false }), false);
  assert.equal(isSuiNpcIdentitySyncEnabled({ clientCompatibilityProfile: "frontier", suiNpcCharacterProvisioningEnabled: false }), false);
});

test("NPC sync bounds each batch and joins overlapping runs without concurrent submissions", async () => {
  const f = fixture([pilot(), pilot(1500000001), pilot(1500000002)]);
  const release = deferred();
  let active = 0;
  let maximum = 0;
  let calls = 0;
  const sync = worker(f, { batchSize: 2, provision: async (input: any) => {
    active++;
    maximum = Math.max(maximum, active);
    calls++;
    if (calls === 1) await release.promise;
    active--;
    return result(input);
  } });
  const first = sync.runOnce();
  assert.equal(sync.runOnce(), first);
  release.resolve();
  assert.deepEqual(await first, { processed: 2, confirmed: 2, failed: 0 });
  assert.equal(maximum, 1);
  assert.equal(calls, 2);
  assert.deepEqual(await sync.runOnce(), { processed: 1, confirmed: 1, failed: 0 });
  assert.equal(calls, 3);
});

test("NPC sync durably journals before submit and resumes exact identity and bytes after restart", async () => {
  const f = fixture();
  let stamp = 1000;
  let calls = 0;
  let refreshed = 0;
  const prepared = {
    transactionDigest: "pending-digest", transactionBytesBase64: "AQIDBA==",
    transactionSignature: "signed", chainId,
  };
  const first = worker(f, { now: () => stamp, retryBaseMs: 50, provision: async (input: any, options: any) => {
    calls++;
    await options.onTransactionPrepared(prepared);
    const durable = f.store.get(input.gameCharacterId).sui;
    assert.deepEqual(durable.identity, input.identity);
    assert.equal(durable.transactionSignature, prepared.transactionSignature);
    assert.equal(durable.transactionBytesBase64, prepared.transactionBytesBase64);
    throw Object.assign(new Error("disconnected"), { code: "TRANSACTION_STATUS_UNKNOWN", ambiguous: true, transactionDigest: prepared.transactionDigest });
  } });
  assert.equal((await first.runOnce()).failed, 1);
  const recorded = f.store.get(1500000000).sui;
  assert.equal(recorded.status, "retry");
  assert.equal(recorded.nextAttemptAtMs, 1050);
  const second = worker(f, { now: () => stamp, retryBaseMs: 50,
    onSynced: () => { refreshed++; },
    provision: async (input: any) => {
      calls++;
      assert.deepEqual(input.identity, recorded.identity);
      for (const field of Object.keys(prepared)) assert.equal(input[field], prepared[field]);
      return result(input, { transactionDigest: prepared.transactionDigest });
    },
  });
  assert.equal((await second.runOnce()).processed, 0);
  stamp = 1050;
  assert.equal((await second.runOnce()).confirmed, 1);
  const confirmed = f.store.get(1500000000).sui;
  assert.equal(confirmed.status, "confirmed");
  assert.equal(confirmed.playerProfileObjectId, "profile-1500000000");
  assert.equal(confirmed.walletAddress, recorded.identity.walletAddress);
  assert.equal(confirmed.transactionBytesBase64, undefined);
  assert.equal(confirmed.chainId, chainId);
  assert.equal(calls, 2);
  assert.equal(refreshed, 1);
});

test("NPC sync does not submit when its prepared journal cannot be persisted", async () => {
  const f = fixture();
  const save = f.store.update;
  f.store.update = (id, update) => {
    const proposed = update(f.store.get(id));
    if (proposed.sui.transactionSignature) throw new Error("disk full");
    return save(id, () => proposed);
  };
  let submitted = false;
  const sync = worker(f, { provision: async (input: any, options: any) => {
    await options.onTransactionPrepared({ transactionDigest: "never-submitted", transactionSignature: "signature" });
    submitted = true;
    return result(input);
  } });
  assert.equal((await sync.runOnce()).failed, 1);
  assert.equal(submitted, false);
  assert.equal(f.store.get(1500000000).sui.status, "retry");
});

test("NPC sync archives old-world journals and reprovisions with the same pilot and faction wallet", async () => {
  const p = pilot();
  const previousIdentity = identity(p);
  p.sui = {
    ...previousIdentity, identity: previousIdentity, chainId, status: "retry",
    transactionDigest: "old-world-pending", transactionBytesBase64: "AQIDBA==", transactionSignature: "old-signature",
    nextAttemptAtMs: 100000,
  };
  const f = fixture([p]);
  const nextWorld = { ...world, packageId: `0x${"7".repeat(64)}`, objectRegistryId: `0x${"8".repeat(64)}` };
  const sync = worker(f, { resolveWorld: () => nextWorld, provision: async (input: any) => {
    assert.equal(input.transactionDigest, undefined);
    assert.equal(input.transactionBytesBase64, undefined);
    assert.equal(input.transactionSignature, undefined);
    assert.equal(input.gameCharacterId, p.characterID);
    assert.equal(input.identity.walletAddress, previousIdentity.walletAddress);
    assert.notEqual(input.identity.characterObjectId, previousIdentity.characterObjectId);
    return result(input);
  } });
  assert.equal((await sync.runOnce()).confirmed, 1);
  const saved = f.store.get(p.characterID).sui;
  assert.equal(saved.previousWorlds.length, 1);
  assert.equal(saved.previousWorlds[0].transactionSignature, "old-signature");
  assert.equal(saved.identity.packageId, nextWorld.packageId);
});

test("NPC sync detects regenesis even if the world object IDs repeat", async () => {
  const p = pilot();
  p.sui = { identity: identity(p), status: "confirmed", chainId: "deadbeef", lastVerifiedAtMs: 1000, transactionDigest: "old-created" };
  const f = fixture([p]);
  let calls = 0;
  const sync = worker(f, { provision: async (input: any) => {
    calls++;
    assert.equal(input.transactionDigest, undefined);
    assert.equal(input.chainId, chainId);
    return result(input);
  } });
  assert.equal((await sync.runOnce()).confirmed, 1);
  assert.equal(calls, 1);
  assert.equal(f.store.get(p.characterID).sui.previousWorlds[0].chainId, "deadbeef");
});

test("NPC confirmed profile verification reads current objects instead of replaying its original digest", async () => {
  const p = pilot();
  p.sui = {
    identity: identity(p), status: "confirmed", chainId, lastVerifiedAtMs: 1000,
    transactionDigest: "original-created", playerProfileObjectId: "existing-profile",
    npcProfile: { incarnation: "1", activeEntityID: "0", deaths: "0" },
  };
  const f = fixture([p]);
  let stamp = 1100;
  let calls = 0;
  const sync = worker(f, { now: () => stamp, verifyIntervalMs: 500, provision: async (input: any) => {
    calls++;
    assert.equal(input.transactionDigest, undefined);
    assert.equal(f.store.get(p.characterID).sui.playerProfileObjectId, "existing-profile");
    return result(input, { recovered: true, playerProfileObjectId: "existing-profile" });
  } });
  assert.equal((await sync.runOnce()).processed, 0);
  stamp = 1500;
  assert.equal((await sync.runOnce()).confirmed, 1);
  assert.equal(calls, 1);
  assert.equal(f.store.get(p.characterID).sui.lastVerifiedAtMs, 1500);
});

test("NPC sync retains journals during network outages and only records safe error codes", async () => {
  const p = pilot();
  p.sui = { identity: identity(p), chainId, status: "retry", transactionDigest: "pending", transactionSignature: "signature" };
  const f = fixture([p]);
  const reports: string[] = [];
  let calls = 0;
  const sync = worker(f, { readChainId: async () => { throw new Error("secret-private-key"); },
    report: (message: string) => reports.push(message), provision: async (input: any) => { calls++; return result(input); } });
  assert.equal((await sync.runOnce()).failed, 1);
  assert.deepEqual(f.store.get(p.characterID), p);
  assert.equal(calls, 0);
  assert.deepEqual(reports, ["NPC_IDENTITY_SYNC_FAILED"]);
});

test("NPC definitive failed transaction permits a new attempt after backoff while other pilots progress", async () => {
  const f = fixture([pilot(), pilot(1500000001)]);
  let stamp = 1000;
  let calls = 0;
  const sync = worker(f, { now: () => stamp, retryBaseMs: 25, provision: async (input: any, options: any) => {
    calls++;
    if (calls === 1) {
      await options.onTransactionPrepared({ transactionDigest: "failed", transactionBytesBase64: "AQ==", transactionSignature: "sig", chainId });
      throw Object.assign(new Error("MoveAbort"), { code: "TRANSACTION_FAILED", transactionDigest: "failed" });
    }
    assert.equal(input.transactionDigest, undefined);
    return result(input);
  } });
  assert.deepEqual(await sync.runOnce(), { processed: 2, confirmed: 1, failed: 1 });
  const failed = f.store.get(1500000000).sui;
  assert.equal(failed.transactionDigest, undefined);
  assert.equal(failed.lastFailedTransaction.transactionDigest, "failed");
  stamp = 1025;
  assert.equal((await sync.runOnce()).confirmed, 1);
  assert.equal(calls, 3);
});

test("NPC sync never assigns the current chain to a pending journal whose original chain is unknown", async () => {
  const p = pilot();
  p.sui = { identity: identity(p), status: "retry", transactionDigest: "pending", transactionBytesBase64: "AQ==", transactionSignature: "old" };
  const f = fixture([p]);
  let submitted = false;
  const sync = worker(f, { provision: async (input: any) => { submitted = true; return result(input); } });
  assert.equal((await sync.runOnce()).failed, 1);
  const saved = f.store.get(p.characterID).sui;
  assert.equal(submitted, false);
  assert.equal(saved.chainId, undefined);
  assert.equal(saved.transactionSignature, "old");
  assert.equal(saved.lastErrorCode, "PENDING_TRANSACTION_CHAIN_UNKNOWN");
});

test("NPC sync prioritizes the oldest due pilot across bounded batches", async () => {
  const early = pilot();
  early.sui = { identity: identity(early), status: "confirmed", chainId, lastVerifiedAtMs: 1, npcProfile: { incarnation: "1", activeEntityID: "0", deaths: "0" } };
  const fresh = pilot(1500000001);
  const f = fixture([early, fresh]);
  const provisioned: number[] = [];
  const sync = worker(f, { batchSize: 1, now: () => 1000, verifyIntervalMs: 100,
    provision: async (input: any) => { provisioned.push(input.gameCharacterId); return result(input); } });
  await sync.runOnce();
  await sync.runOnce();
  assert.deepEqual(provisioned, [fresh.characterID, early.characterID]);
});

test("NPC lifecycle changes bypass periodic verification and coalesce without losing a respawn during RPC", async () => {
  const p = { ...pilot(), incarnation: 1, activeEntityID: 980000000001, deaths: 0 };
  const f = fixture([p]);
  const observed: any[] = [];
  const sync = worker(f, { provision: async (input: any) => {
    observed.push(input.lifecycle);
    if (observed.length === 2) {
      // A ship respawns while the preceding death snapshot is being submitted.
      f.store.update(p.characterID, row => ({ ...row, incarnation: 2, activeEntityID: 980000000002 }));
    }
    return result(input);
  } });
  await sync.runOnce();
  assert.equal((await sync.runOnce()).processed, 0);
  f.store.update(p.characterID, row => ({ ...row, activeEntityID: null, deaths: 1 }));
  await sync.runOnce();
  await sync.runOnce();
  assert.deepEqual(observed, [
    { incarnation: 1, activeEntityID: 980000000001, deaths: 0 },
    { incarnation: 1, activeEntityID: 0, deaths: 1 },
    { incarnation: 2, activeEntityID: 980000000002, deaths: 1 },
  ]);
  assert.equal(f.store.get(p.characterID).sui.npcProfile.activeEntityID, "980000000002");
});

test("NPC profile journals are independent of Character creation across migration retries", async () => {
  const f = fixture();
  let stamp = 1000;
  let calls = 0;
  const journal = { transactionDigest: "profile-tx", transactionSignature: "signed-profile", transactionBytesBase64: "AQ==", chainId };
  const sync = worker(f, { now: () => stamp, retryBaseMs: 1, provision: async (input: any, options: any) => {
    calls++;
    if (calls === 1) {
      await options.onTransactionPrepared({ transactionDigest: "character-tx", transactionSignature: "signed-character", chainId });
      await options.onCharacterProvisioned(result(input));
      assert.equal(f.store.get(input.gameCharacterId).sui.transactionSignature, undefined);
      assert.equal(f.store.get(input.gameCharacterId).sui.playerProfileObjectId, `profile-${input.gameCharacterId}`);
      await options.onNpcProfileTransactionPrepared(journal);
      throw Object.assign(new Error("profile outcome unknown"), { code: "TRANSACTION_STATUS_UNKNOWN", npcProfileOperation: true, transactionDigest: journal.transactionDigest });
    }
    assert.equal(input.transactionDigest, undefined);
    assert.deepEqual(input.npcProfileJournal, journal);
    return result(input);
  } });
  assert.equal((await sync.runOnce()).failed, 1);
  assert.equal(f.store.get(1500000000).sui.transactionDigest, undefined);
  stamp++;
  assert.equal((await sync.runOnce()).confirmed, 1);
  assert.equal(f.store.get(1500000000).sui.npcProfileJournal, undefined);
});

test("a definitively failed NPC profile transaction clears only its own journal", async () => {
  const f = fixture();
  const sync = worker(f, { provision: async (input: any, options: any) => {
    await options.onCharacterProvisioned(result(input));
    await options.onNpcProfileTransactionPrepared({ transactionDigest: "failed-profile", chainId });
    throw Object.assign(new Error("stale revision"), { code: "TRANSACTION_FAILED", npcProfileOperation: true });
  } });
  assert.equal((await sync.runOnce()).failed, 1);
  const saved = f.store.get(1500000000).sui;
  assert.equal(saved.playerProfileObjectId, "profile-1500000000");
  assert.equal(saved.npcProfileJournal, undefined);
  assert.equal(saved.lastFailedNpcProfileTransaction.transactionDigest, "failed-profile");
});
