import assert = require("node:assert/strict");
import { test } from "node:test";
import {
  flushSuiStorageSync, readSuiStorageSyncStatus, registerSuiStorageSyncBridge,
  type SuiStorageSyncStatus,
} from "../src/services/frontier/suiStorageSync";

const request = { storageUnitID: 100, characterID: 1 };
function confirmed(): SuiStorageSyncStatus {
  return { ...request, status: "synced", chain: {
    assemblyId: "0x100", online: true, synchronized: true, partitions: [{
      characterId: 1, characterObjectId: "0x1", inventoryKey: "0x1100", isOwner: true,
      maxCapacity: "1000000000", usedCapacity: "0", items: [], synchronized: true,
    }],
  } };
}

test("storage bridge shares the registered worker and reports disabled when it is stopped", async () => {
  assert.deepEqual(await readSuiStorageSyncStatus(request), { ...request, status: "disabled" });
  const calls: string[] = [];
  const unregister = registerSuiStorageSyncBridge({
    async readStatus(identity) { assert.deepEqual(identity, request); calls.push("read"); return { ...identity, status: "pending" }; },
    async flush(identity) { assert.deepEqual(identity, request); calls.push("flush"); return confirmed(); },
  });
  try {
    assert.equal((await readSuiStorageSyncStatus(request)).status, "pending");
    assert.equal((await flushSuiStorageSync(request)).status, "synced");
    assert.deepEqual(calls, ["read", "flush"]);
  } finally { unregister(); }
  assert.equal((await flushSuiStorageSync(request)).status, "disabled");
});

test("storage bridge fails closed on RPC errors and mismatched or unconfirmed inventories", async () => {
  let response = confirmed();
  const unregister = registerSuiStorageSyncBridge({
    async readStatus() { throw new Error("Sui RPC unavailable"); },
    async flush() { return response; },
  });
  try {
    assert.deepEqual(await readSuiStorageSyncStatus(request), { ...request, status: "error", error: "Sui RPC unavailable" });
    response = { ...confirmed(), characterID: 2 };
    assert.match((await flushSuiStorageSync(request)).error!, /invalid status/);
    response = confirmed();
    response.chain!.partitions[0].characterId = 2;
    assert.match((await flushSuiStorageSync(request)).error!, /this character/);
    response = { ...request, status: "synced" };
    assert.equal((await flushSuiStorageSync(request)).status, "error");
  } finally { unregister(); }
  assert.equal((await readSuiStorageSyncStatus({ ...request, characterID: NaN })).status, "error");
});

test("replacing the storage worker invalidates an in-flight status without unregistering its replacement", async () => {
  let release: (status: SuiStorageSyncStatus) => void;
  const first = registerSuiStorageSyncBridge({
    readStatus: () => new Promise(resolve => { release = resolve; }),
    async flush() { return confirmed(); },
  });
  const pending = readSuiStorageSyncStatus(request);
  const second = registerSuiStorageSyncBridge({ async readStatus() { return confirmed(); }, async flush() { return confirmed(); } });
  try {
    first();
    release!(confirmed());
    assert.match((await pending).error!, /worker changed/);
    assert.equal((await readSuiStorageSyncStatus(request)).status, "synced");
  } finally { second(); }
});
