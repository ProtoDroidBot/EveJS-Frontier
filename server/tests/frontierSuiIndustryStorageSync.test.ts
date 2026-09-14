import assert = require("node:assert/strict");
import { test } from "node:test";
import { registerSuiIndustrySyncBridge, type SuiIndustrySyncStatus } from "../src/services/frontier/suiIndustrySync";
import { registerSuiStorageSyncBridge, type SuiStorageSyncStatus } from "../src/services/frontier/suiStorageSync";
import { registerSuiIndustryStorageSnapshotReader, syncIndustryStorageTransfer } from "../src/services/frontier/suiIndustryStorageSync";

const request = { facilityID: 200, characterID: 1, storageUnitID: 100 };
function industry(): SuiIndustrySyncStatus {
  return { facilityID: 200, characterID: 1, status: "synced", synchronized: true,
    productionMirrored: true, industryObjectID: "0x200", assemblyObjectID: "0x201", chainProduction: null };
}
function storage(): SuiStorageSyncStatus {
  return { storageUnitID: 100, characterID: 1, status: "synced", chain: {
    assemblyId: "0x100", online: true, synchronized: true, partitions: [{
      characterId: 1, characterObjectId: "0x1", inventoryKey: "0x1100", isOwner: true,
      maxCapacity: "1000000000", usedCapacity: "0", items: [], synchronized: true,
    }],
  } };
}

function setup(t: any) {
  const state = { industry: industry(), storage: storage(), snapshot: "committed-transfer-1",
    calls: [] as string[], onIndustryRead: () => {}, onStorageRead: () => {} };
  t.after(registerSuiIndustrySyncBridge({
    async flush(identity) { assert.deepEqual(identity, { facilityID: 200, characterID: 1 }); state.calls.push("flush"); return state.industry; },
    async readStatus() { state.calls.push("industry"); state.onIndustryRead(); return state.industry; },
  }));
  t.after(registerSuiStorageSyncBridge({
    async flush() { assert.fail("Industry flush already scans both mirrors twice"); },
    async readStatus(identity) { assert.deepEqual(identity, { storageUnitID: 100, characterID: 1 }); state.calls.push("storage"); state.onStorageRead(); return state.storage; },
  }));
  t.after(registerSuiIndustryStorageSnapshotReader(identity => {
    assert.deepEqual(identity, request);
    return state.snapshot;
  }));
  return state;
}

test("transfer synchronization reports disabled when both workers are stopped", async () => {
  assert.deepEqual(await syncIndustryStorageTransfer(request), { status: "disabled", industryStatus: "disabled", storageStatus: "disabled" });
});

test("transfer synchronization confirms both inventories after the shared worker flush", async t => {
  const f = setup(t);
  assert.deepEqual(await syncIndustryStorageTransfer(request), { status: "synced", industryStatus: "synced", storageStatus: "synced" });
  assert.deepEqual(f.calls, ["flush", "industry", "storage"]);
});

test("transfer synchronization preserves independent errors and retry never repeats the server transfer", async t => {
  const f = setup(t);
  let localTransfers = 0;
  const committedInventory = { storage: 10, industry: 0 };
  const commitOnce = () => { localTransfers++; committedInventory.storage -= 4; committedInventory.industry += 4; };
  commitOnce();
  f.storage = { storageUnitID: 100, characterID: 1, status: "error", error: "PRIVATE_DEPLOYMENT_PATH/RPC unavailable" };
  const failed = await syncIndustryStorageTransfer(request);
  assert.deepEqual(failed, { status: "error", industryStatus: "synced", storageStatus: "error" });
  assert.equal(JSON.stringify(failed).includes("PRIVATE"), false);
  f.storage = storage();
  assert.equal((await syncIndustryStorageTransfer(request)).status, "synced");
  assert.equal(localTransfers, 1);
  assert.deepEqual(committedInventory, { storage: 6, industry: 4 });
  assert.equal(f.calls.filter(call => call === "flush").length, 2);
});

test("transfer synchronization requires confirmed inventories and production on both objects", async t => {
  const f = setup(t);
  f.industry.productionMirrored = false;
  assert.deepEqual(await syncIndustryStorageTransfer(request), { status: "error", industryStatus: "error", storageStatus: "synced" });
  f.industry = industry();
  f.storage.chain!.partitions[0].synchronized = false;
  assert.deepEqual(await syncIndustryStorageTransfer(request), { status: "error", industryStatus: "synced", storageStatus: "error" });
});

test("a transfer remains pending if one mirror is pending or disabled", async t => {
  const f = setup(t);
  f.storage.status = "pending";
  assert.deepEqual(await syncIndustryStorageTransfer(request), { status: "pending", industryStatus: "synced", storageStatus: "pending" });
  f.storage.status = "disabled";
  assert.deepEqual(await syncIndustryStorageTransfer(request), { status: "pending", industryStatus: "synced", storageStatus: "disabled" });
  f.industry.status = "disabled";
  f.storage = storage();
  assert.deepEqual(await syncIndustryStorageTransfer(request), { status: "pending", industryStatus: "disabled", storageStatus: "synced" });
});

for (const source of ["Industry", "Storage"]) {
  test(`a concurrent ${source} snapshot change cannot acknowledge a different transfer`, async t => {
    const f = setup(t);
    // The other object's read can yield while this local inventory changes.
    const change = () => { f.snapshot = "committed-transfer-2"; };
    if (source === "Industry") f.onStorageRead = change;
    else f.onIndustryRead = change;
    assert.deepEqual(await syncIndustryStorageTransfer(request), { status: "pending", industryStatus: "pending", storageStatus: "pending" });
  });
}

test("worker replacement during paired confirmation fails closed", async t => {
  const f = setup(t);
  f.onStorageRead = () => { t.after(registerSuiIndustryStorageSnapshotReader(() => f.snapshot)); };
  assert.deepEqual(await syncIndustryStorageTransfer(request), { status: "error", industryStatus: "error", storageStatus: "error" });
});

test("paired confirmation without a worker snapshot guard cannot claim synchronized", async t => {
  setup(t);
  const unregister = registerSuiIndustryStorageSnapshotReader(() => "unused");
  unregister();
  assert.deepEqual(await syncIndustryStorageTransfer(request), { status: "pending", industryStatus: "pending", storageStatus: "pending" });
});

test("invalid transfer identities fail before triggering synchronization", async t => {
  const f = setup(t);
  for (const field of ["facilityID", "characterID", "storageUnitID"]) {
    for (const value of [0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, "100"]) {
      assert.deepEqual(await syncIndustryStorageTransfer({ ...request, [field]: value }),
        { status: "error", industryStatus: "error", storageStatus: "error" });
    }
  }
  assert.deepEqual(f.calls, []);
});
