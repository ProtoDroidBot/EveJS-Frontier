import assert = require("node:assert/strict");
import { test } from "node:test";
import { getSuiAssemblyStateGeneration, registerSuiAssemblyStateRunner, registerSuiAssemblyStatesRunner } from "../src/services/frontier/suiAssemblyState";
import {
  createAssemblyLogisticsChainSynchronizer,
  runWithAssemblyLogisticsAuthority,
  type AssemblyLogisticsAuthority,
} from "../src/services/frontier/assemblyLogisticsChain";
import type { SuiStorageSyncStatus } from "../src/services/frontier/suiStorageSync";
import type { SuiIndustrySyncStatus } from "../src/services/frontier/suiIndustrySync";

const request: AssemblyLogisticsAuthority = {
  sourceAssemblyID: 100, destinationAssemblyID: 200,
  sourceOwnerID: 1, destinationOwnerID: 1,
  sourceCreateOnChain: true, destinationCreateOnChain: true,
};

function status(storageUnitID: number): SuiStorageSyncStatus {
  return { storageUnitID, characterID: 1, status: "synced", chain: {
    assemblyId: `0x${storageUnitID}`, online: true, synchronized: true,
    partitions: [{ characterId: 1, characterObjectId: "0x1", inventoryKey: "0x10",
      isOwner: true, maxCapacity: "1000", usedCapacity: "0", items: [], synchronized: true }],
  } };
}

test("local logistics stays synchronous; chain-backed logistics cannot silently bypass a stopped worker", () => {
  let commits = 0;
  const local = { ...request, sourceCreateOnChain: false, destinationCreateOnChain: false };
  assert.equal(runWithAssemblyLogisticsAuthority(local, () => ++commits), 1);
  assert.throws(() => runWithAssemblyLogisticsAuthority(request, () => ++commits), { code: "ASSEMBLY_STATE_UNAVAILABLE" });
  assert.equal(commits, 1);
});

test("both chain states refresh in one queue entry before the local commit", async t => {
  let release!: () => void;
  const refresh = new Promise<void>(resolve => { release = resolve; });
  let commits = 0;
  t.after(registerSuiAssemblyStatesRunner(async (ids, commit) => {
    assert.deepEqual(ids, [100, 200]);
    await refresh;
    return commit();
  }));
  const result = runWithAssemblyLogisticsAuthority(request, () => ++commits);
  assert.equal(commits, 0);
  release();
  assert.equal(await result, 1);
});

test("cross-owner requests need the separate custody proof flow even with an authoritative worker", t => {
  let commits = 0;
  t.after(registerSuiAssemblyStatesRunner(async (_ids, commit) => commit()));
  assert.throws(() => runWithAssemblyLogisticsAuthority({ ...request, destinationOwnerID: 2 }, () => ++commits),
    { code: "ASSEMBLY_LOGISTICS_CROSS_OWNER_PROOF_REQUIRED" });
  assert.equal(commits, 0);
});

test("legacy single-object queues and replaced workers cannot authorize a two-assembly transfer", async t => {
  let commits = 0;
  t.after(registerSuiAssemblyStateRunner(async (_id, commit) => commit()));
  await assert.rejects(async () => runWithAssemblyLogisticsAuthority(request, () => ++commits),
    { code: "ASSEMBLY_STATE_UNAVAILABLE" });
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const stop = registerSuiAssemblyStatesRunner(async (_ids, commit) => { await gate; return commit(); });
  t.after(stop);
  const pending = runWithAssemblyLogisticsAuthority(request, () => ++commits);
  const rejected = assert.rejects(async () => pending, { code: "ASSEMBLY_STATE_UNAVAILABLE" });
  stop();
  release();
  await rejected;
  assert.equal(commits, 0);
});

test("paired storage confirmation flushes once and verifies both owner partitions", async () => {
  const calls: number[] = [];
  let flushes = 0;
  const sync = createAssemblyLogisticsChainSynchronizer({
    flush: async identity => { flushes++; return status(identity.storageUnitID); },
    readStatus: async identity => { calls.push(identity.storageUnitID); return status(identity.storageUnitID); },
    readFingerprint: () => "committed-1",
  });
  assert.deepEqual(await sync(request), { status: "synced", sourceStatus: "synced", destinationStatus: "synced" });
  assert.equal(flushes, 1);
  assert.deepEqual(calls.sort(), [100, 200]);
});

test("a change to either inventory during the paired read keeps settlement pending", async () => {
  let snapshot = "committed-1";
  const sync = createAssemblyLogisticsChainSynchronizer({
    flush: async identity => status(identity.storageUnitID),
    readStatus: async identity => { snapshot = "committed-2"; return status(identity.storageUnitID); },
    readFingerprint: () => snapshot,
  });
  assert.deepEqual(await sync(request), { status: "pending", sourceStatus: "pending", destinationStatus: "pending" });
});

test("disabled bridge, offline chain, and nonowner partitions cannot claim chain confirmation", async () => {
  for (const alter of [
    (value: SuiStorageSyncStatus) => { value.status = "disabled"; },
    (value: SuiStorageSyncStatus) => { value.chain!.online = false; },
    (value: SuiStorageSyncStatus) => { value.chain!.partitions[0].isOwner = false; },
    (value: SuiStorageSyncStatus) => { value.characterID = 2; },
  ]) {
    const sync = createAssemblyLogisticsChainSynchronizer({
      flush: async identity => status(identity.storageUnitID),
      readStatus: async identity => { const value = status(identity.storageUnitID); alter(value); return value; },
      readFingerprint: () => "committed-1",
    });
    assert.deepEqual(await sync(request), { status: "error", sourceStatus: "error", destinationStatus: "error" });
  }
});

test("sync errors preserve the game commit and retry only chain mirrors", async () => {
  let unavailable = true;
  let flushes = 0;
  const localCommits = 1;
  const sync = createAssemblyLogisticsChainSynchronizer({
    flush: async identity => { flushes++; if (unavailable) throw new Error("PRIVATE_PATH/KEY_CONFIG"); return status(identity.storageUnitID); },
    readStatus: async identity => status(identity.storageUnitID),
    readFingerprint: () => "committed-1",
  });
  const failed = await sync(request);
  assert.deepEqual(failed, { status: "error", sourceStatus: "error", destinationStatus: "error" });
  assert.equal(JSON.stringify(failed).includes("PRIVATE"), false);
  unavailable = false;
  assert.equal((await sync(request)).status, "synced");
  assert.equal(flushes, 2);
  assert.equal(localCommits, 1);
});

test("local peers do not require chain inventories and invalid identities never flush", async () => {
  const seen: number[] = [];
  const sync = createAssemblyLogisticsChainSynchronizer({
    flush: async identity => { seen.push(identity.storageUnitID); return status(identity.storageUnitID); },
    readStatus: async identity => status(identity.storageUnitID),
    readFingerprint: () => "committed-1",
  });
  assert.deepEqual(await sync({ ...request, sourceCreateOnChain: false, destinationCreateOnChain: false }),
    { status: "disabled", sourceStatus: "disabled", destinationStatus: "disabled" });
  assert.equal(seen.length, 0);
  assert.deepEqual(await sync({ ...request, sourceCreateOnChain: false }),
    { status: "synced", sourceStatus: "disabled", destinationStatus: "synced" });
  assert.deepEqual(seen, [200]);
  assert.equal((await sync({ ...request, sourceAssemblyID: 0 })).status, "error");
  assert.equal((await sync({ ...request, destinationOwnerID: 2 })).status, "error");
  assert.deepEqual(seen, [200]);
});

test("Industry to storage uses the shared Industry flush and confirms every lane", async () => {
  let laneStatesMirrored = false;
  let flushes = 0;
  const industry = (): SuiIndustrySyncStatus => ({
    facilityID: 100, characterID: 1, status: "synced", synchronized: true,
    productionMirrored: true, laneStatesMirrored, industryObjectID: "0x100", assemblyObjectID: "0x101",
  });
  const sync = createAssemblyLogisticsChainSynchronizer({
    flush: async () => assert.fail("The Industry flush already scans both inventories"),
    flushIndustry: async identity => { assert.deepEqual(identity, { facilityID: 100, characterID: 1 }); flushes++; return industry(); },
    readIndustryStatus: async () => industry(),
    readStatus: async identity => status(identity.storageUnitID),
    readFingerprint: () => "all-industry-lanes-and-storage",
  });
  const transfer = { ...request, sourceKind: "industry" as const };
  assert.deepEqual(await sync(transfer), { status: "error", sourceStatus: "error", destinationStatus: "synced" });
  laneStatesMirrored = true;
  assert.equal((await sync(transfer)).status, "synced");
  assert.equal(flushes, 2);
});

test("turret ammunition stays local while chain lifecycle requires a current worker", async t => {
  const transfer = { ...request, sourceKind: "turret" as const,
    destinationKind: "field_storage" as const, destinationCreateOnChain: false };
  const sync = createAssemblyLogisticsChainSynchronizer({
    flush: async () => assert.fail("Turret ammunition has no chain inventory"),
    readStatus: async () => assert.fail("Field Storage is local"),
    readFingerprint: () => "ammunition-committed",
  });
  assert.deepEqual(await sync(transfer), { status: "error", sourceStatus: "error",
    destinationStatus: "disabled", sourceInventoryMirror: "none" });
  let refreshes = 0;
  t.after(registerSuiAssemblyStatesRunner(async (ids, operation) => {
    assert.deepEqual(ids, [100]); refreshes++; return operation();
  }));
  assert.deepEqual(await sync(transfer), { status: "synced", sourceStatus: "synced",
    destinationStatus: "disabled", sourceInventoryMirror: "none" });
  assert.equal(refreshes, 1);
});

for (const change of ["worker", "deployment"] as const) {
  for (const stage of ["flush", "paired-read"] as const) {
    test(`paired confirmation rejects ${change} replacement during ${stage} despite unchanged inventories`, async t => {
      let deployment = { id: "first-world" };
      const stop = registerSuiAssemblyStatesRunner(async (_ids, operation) => operation(), () => deployment);
      t.after(stop);
      let changed = false;
      function replace() {
        if (changed) return;
        changed = true;
        if (change === "deployment") deployment = { id: "second-world" };
        else t.after(registerSuiAssemblyStatesRunner(async (_ids, operation) => operation(), () => deployment));
      }
      const sync = createAssemblyLogisticsChainSynchronizer({
        flush: async identity => { if (stage === "flush") replace(); return status(identity.storageUnitID); },
        readStatus: async identity => {
          if (stage === "paired-read" && identity.storageUnitID === 200) replace();
          return status(identity.storageUnitID);
        },
        readFingerprint: () => "identical-local-inventories",
      });
      assert.deepEqual(await sync(request), { status: "error", sourceStatus: "error", destinationStatus: "error" });
      assert.equal((await sync(request)).status, "synced", "Retry may confirm a stable replacement deployment");
    });
  }
}

test("stopping an obsolete worker does not change the replacement generation", t => {
  const stopOld = registerSuiAssemblyStatesRunner(async (_ids, operation) => operation());
  t.after(stopOld);
  const oldGeneration = getSuiAssemblyStateGeneration();
  const stopCurrent = registerSuiAssemblyStatesRunner(async (_ids, operation) => operation());
  t.after(stopCurrent);
  const currentGeneration = getSuiAssemblyStateGeneration();
  assert.notEqual(currentGeneration, oldGeneration);
  stopOld();
  assert.equal(getSuiAssemblyStateGeneration(), currentGeneration);
  stopCurrent();
  assert.notEqual(getSuiAssemblyStateGeneration(), currentGeneration);
});
