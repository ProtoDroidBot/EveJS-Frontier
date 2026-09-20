import assert from "node:assert/strict";
import test from "node:test";
import { createIndustryStorageOperations } from "../src/_secondary/express/smartIndustryStorageApi";

const REQUEST = { requestID: "11111111-1111-4111-8111-111111111111", storageUnitID: "200", direction: "deposit", side: "inputs", typeID: "34", quantity: "7" };
const success = { success: true };
function fixture(overrides: Record<string, any> = {}) {
  const session = {};
  const state = { live: true, moves: [] as any[], notifications: 0 };
  const api = createIndustryStorageOperations({
    resolve: () => state.live ? { success: true, data: { characterID: 1, walletAddress: "0x1", session, facilityID: 100 } }
      : { success: false, errorMsg: "AUTH_EXPIRED" },
    failed: errorMsg => ({ success: false, errorMsg }),
    validateFacility: () => success, settleProduction: () => success,
    listStorage: () => [{ storageUnitID: 200, items: [] }],
    resolveTransferInventory: () => null,
    readStorageRows: () => [{ itemID: 301, stacksize: 4 }, { itemID: 302, stacksize: 8 }],
    depositItems: async (...args) => { state.moves.push(args); return { success: true, data: { chain: { status: "synced", industryStatus: "synced", storageStatus: "synced" } } }; },
    withdrawItems: async (...args) => { state.moves.push(args); return { success: true, data: { chain: { status: "pending", industryStatus: "synced", storageStatus: "pending" } } }; },
    publishTransfer: () => { state.notifications++; },
    ...overrides,
  });
  return { api, state, session };
}

test("Industry storage API exposes only validated nearby inventories", async () => {
  const f = fixture();
  assert.deepEqual(await f.api.storage("token", 100), { success: true, data: { storageUnits: [{ storageUnitID: 200, items: [] }] } });
  f.state.live = false;
  assert.equal((await f.api.storage("token", 100)).errorMsg, "AUTH_EXPIRED");
  const denied = fixture({ validateFacility: () => ({ success: false, errorMsg: "FACILITY_OUT_OF_RANGE" }), listStorage: () => assert.fail("must not enumerate") });
  assert.equal((await denied.api.storage("token", 100)).errorMsg, "FACILITY_OUT_OF_RANGE");
});

test("Industry deposits aggregate exact quantities from SSU rows and return both confirmations", async () => {
  const f = fixture();
  const result = await f.api.transfer("token", 100, REQUEST);
  assert.deepEqual(result, { success: true, data: { requestID: REQUEST.requestID, gameCommitted: true,
    storageUnitID: 200, direction: "deposit", side: "inputs", items: { 34: 7 },
    chain: { status: "synced", industryStatus: "synced", storageStatus: "synced" } } });
  assert.deepEqual([...f.state.moves[0][2]], [[301, 4], [302, 3]]);
  assert.equal(f.state.moves[0][3].storageUnitID, 200);
  f.state.live = false;
  assert.equal(f.state.moves[0][3].assertAccess().errorMsg, "AUTH_EXPIRED");
  assert.equal(f.state.notifications, 1);
});

test("Industry withdrawals route both inputs and products to the requested SSU partition", async () => {
  for (const side of ["inputs", "outputs"]) {
    const f = fixture();
    const result = await f.api.transfer("token", 100, { ...REQUEST, direction: "withdraw", side });
    assert.equal(result.data.gameCommitted, true);
    assert.equal(result.data.chain.status, "pending");
    const args = f.state.moves[0];
    assert.deepEqual([...args[2]], [[34, 7]]);
    assert.deepEqual(args.slice(3, 6), [200, 66, side]);
  }
});

test("Industry transfers use the resolved cargo flag for turrets, Field Storage, and ships", async () => {
  for (const endpoint of [
    { flagID: 0, smartAssemblyKind: "turret" },
    { flagID: 0, inventoryKind: "field_storage" },
    { flagID: 5, inventoryKind: "ship" },
  ]) {
    let listedFlag = -1;
    const deposit = fixture({
      resolveTransferInventory: () => ({ success: true, data: endpoint }),
      readStorageRows: (_characterID, _inventoryID, _typeID, flagID) => {
        listedFlag = flagID;
        return [{ itemID: 301, stacksize: 7 }];
      },
    });
    assert.equal((await deposit.api.transfer("token", 100, REQUEST)).success, true);
    assert.equal(listedFlag, endpoint.flagID);

    const withdraw = fixture({
      resolveTransferInventory: () => ({ success: true, data: endpoint }),
    });
    const result = await withdraw.api.transfer("token", 100, {
      ...REQUEST,
      direction: "withdraw",
      side: "outputs",
    });
    assert.equal(result.success, true);
    assert.equal(withdraw.state.moves[0][4], endpoint.flagID);
  }
});

test("Industry transfer and sync reject an inaccessible resolved endpoint", async () => {
  const f = fixture({
    resolveTransferInventory: () => ({ success: false, errorMsg: "ASSEMBLY_OUT_OF_RANGE" }),
    syncStorage: () => assert.fail("must not synchronize an inaccessible endpoint"),
  });
  assert.equal((await f.api.transfer("token", 100, REQUEST)).errorMsg, "ASSEMBLY_OUT_OF_RANGE");
  assert.equal((await f.api.storageSync("token", 100, { storageUnitID: 200 })).errorMsg,
    "ASSEMBLY_OUT_OF_RANGE");
  assert.equal(f.state.moves.length, 0);
});

test("Duplicate Industry transfer requests share one mutation and conflicting replays fail", async () => {
  const f = fixture();
  const [first, repeated] = await Promise.all([f.api.transfer("token", 100, REQUEST), f.api.transfer("token", 100, REQUEST)]);
  assert.deepEqual(first, repeated);
  assert.equal(f.state.moves.length, 1);
  assert.equal(f.state.notifications, 1);
  assert.equal((await f.api.transfer("token", 100, { ...REQUEST, quantity: "8" })).errorMsg, "TRANSFER_REQUEST_CHANGED");
  assert.equal(f.state.moves.length, 1);
});

test("Malformed transfers, insufficient SSU items and access revocation cannot commit", async () => {
  const f = fixture();
  for (const update of [{ requestID: "bad" }, { quantity: "0" }, { quantity: "1.5" }, { quantity: "4294967296" },
    { storageUnitID: "200/path" }, { typeID: "9007199254740992" }, { side: "outputs" }, { direction: "other" }]) {
    assert.equal((await f.api.transfer("token", 100, { ...REQUEST, ...update })).success, false);
  }
  assert.equal((await f.api.transfer("token", 100, { ...REQUEST, quantity: "13" })).errorMsg, "INSUFFICIENT_SOURCE_ITEMS");
  assert.equal(f.state.moves.length, 0);
  const revoked = fixture();
  const pending = revoked.api.transfer("token", 100, REQUEST);
  revoked.state.live = false;
  assert.equal((await pending).errorMsg, "AUTH_EXPIRED");
  assert.equal(revoked.state.moves.length, 0);
});

test("Notification errors do not turn a committed Industry transfer into a retryable failure", async () => {
  const f = fixture({ publishTransfer: () => { throw new Error("delivery unavailable"); } });
  assert.equal((await f.api.transfer("token", 100, REQUEST)).data.gameCommitted, true);
  assert.equal((await f.api.transfer("token", 100, REQUEST)).data.gameCommitted, true);
  assert.equal(f.state.moves.length, 1);
});

test("Unverified or private chain responses cannot claim both inventories are synchronized", async () => {
  const f = fixture({ depositItems: () => ({ success: true, data: {
    chain: { status: "synced", industryStatus: "synced", storageStatus: "error", error: "private path" },
  } }) });
  const result = await f.api.transfer("token", 100, REQUEST);
  assert.equal(result.data.gameCommitted, true);
  assert.equal(result.data.chain.status, "pending");
  assert.equal(JSON.stringify(result).includes("private path"), false);
});

test("Industry storage sync retries only chain confirmation without replaying a move", async () => {
  let syncs = 0;
  const f = fixture({ syncStorage: async request => {
    assert.deepEqual(request, { facilityID: 100, characterID: 1, storageUnitID: 200 });
    syncs++;
    return { status: "synced", industryStatus: "synced", storageStatus: "synced", privatePath: "hidden" };
  } });
  assert.equal((await f.api.transfer("token", 100, REQUEST)).data.gameCommitted, true);
  const result = await f.api.storageSync("token", 100, { storageUnitID: "200" });
  assert.deepEqual(result, { success: true, data: { status: "synced", industryStatus: "synced", storageStatus: "synced" } });
  assert.equal(f.state.moves.length, 1);
  assert.equal(syncs, 1);
  f.state.live = false;
  assert.equal((await f.api.storageSync("token", 100, { storageUnitID: "200" })).errorMsg, "AUTH_EXPIRED");
  assert.equal(syncs, 1);
});

test("Slow Industry storage synchronization remains pending and suppresses worker errors", async () => {
  let finish: (value: any) => void;
  const f = fixture({ chainWaitMs: 1, syncStorage: () => new Promise(resolve => { finish = resolve; }) });
  assert.equal((await f.api.storageSync("token", 100, { storageUnitID: 200 })).data.status, "pending");
  finish!({ status: "synced", industryStatus: "synced", storageStatus: "synced" });
  const broken = fixture({ syncStorage: () => { throw new Error("private deployment path"); } });
  assert.deepEqual(await broken.api.storageSync("token", 100, { storageUnitID: 200 }), {
    success: true, data: { status: "error", industryStatus: "error", storageStatus: "error" },
  });
});
