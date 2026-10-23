"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { createSmartAssemblyRequestRuntime } = require("../src/services/frontier/smartAssemblyRequestRuntime");
const { createAssemblyLogisticsWorker } = require("../src/services/frontier/assemblyLogisticsWorker");

const OWNER = 140000003;
const RECEIVER = 5000000001;
const SUPPLIER = 5000000002;
const requestID = index => `11111111-1111-4111-8111-${String(index).padStart(12, "0")}`;

function fixture() {
  let time = 1_000_000;
  let stored: any = {};
  let nextToken = 1;
  let rejectFulfilled = false;
  let rejectFlush = false;
  let rejectRollback = false;
  let durable: any = {};
  let executionCount = 0;
  const receipts = new Map();
  const assemblies = new Map([RECEIVER, SUPPLIER].map(itemID => [itemID, {
    item: { itemID, ownerID: OWNER, typeID: 87120 },
    state: { ownerID: OWNER, assemblyStatus: 2, activationCompleteAtMs: 0 },
  }]));
  const options = {
    now: () => time,
    randomUUID: () => `aaaaaaaa-aaaa-4aaa-8aaa-${String(nextToken++).padStart(12, "0")}`,
    repository: {
      ensureTable() {},
      read() { return { success: true, data: structuredClone(stored) }; },
      write(_table, _path, value) {
        if (rejectRollback && !Object.keys(value.requests || {}).length) return { success: false };
        if (rejectFulfilled && Object.values<any>(value.requests || {})
          .some(request => request.status === "fulfilled")) return { success: false };
        stored = structuredClone(value);
        return { success: true };
      },
      flushTablesSync() {
        if (rejectFlush) return { success: false };
        durable = structuredClone(stored);
        return { success: true };
      },
    },
    findAssembly: id => assemblies.get(id),
  };
  let runtime = createSmartAssemblyRequestRuntime(options);
  const executor: any = {
    async getCommittedResult(request) {
      return receipts.has(request.requestID)
        ? { success: true, data: receipts.get(request.requestID) } : null;
    },
    async execute(request, { assertClaim }) {
      const claim = assertClaim();
      if (!claim.success) return { ...claim, retryable: true };
      executionCount += 1;
      const data = { requestID: request.requestID, quantity: request.payload.quantity };
      receipts.set(request.requestID, data);
      return { success: true, data };
    },
  };
  return {
    assemblies, executor, receipts,
    get runtime() { return runtime; },
    get executionCount() { return executionCount; },
    create(index, extra = {}) {
      return runtime.createRequest(RECEIVER, SUPPLIER, "logistics.transfer", {
        ownerID: OWNER, requestID: requestID(index), payload: { typeID: 34, quantity: 2 },
        _logisticsActor: { kind: "player", actorID: OWNER }, ...extra,
      });
    },
    worker(extra = {}) {
      return createAssemblyLogisticsWorker({ requests: runtime, executor,
        now: options.now, retryMs: 10, onError() {}, ...extra });
    },
    restart() { runtime = createSmartAssemblyRequestRuntime(options); },
    advance(ms) { time += ms; },
    rejectCompletion(value) { rejectFulfilled = value; },
    rejectFlush(value) { rejectFlush = value; },
    rejectRollback(value) { rejectRollback = value; },
    durable() { return structuredClone(durable); },
    state() { return structuredClone(stored); },
  };
}

test("logistics worker transfers once and reserves queue mutation from public callers", async () => {
  const f = fixture();
  assert.equal(f.create(1).success, true);
  const access = f.runtime.createWorkerAccess("logistics.transfer");
  const request = f.runtime.getRequest(requestID(1)).data;
  assert.equal(f.runtime.claimRequest(SUPPLIER, request.requestID).errorMsg,
    "ASSEMBLY_REQUEST_SERVER_WORKER_REQUIRED");
  const claim = access.claimRequest(request);
  assert.equal(claim.claimed, true);
  assert.equal(f.runtime.fulfillRequest(SUPPLIER, request.requestID,
    claim.data.claimToken, { forged: true }).errorMsg, "ASSEMBLY_REQUEST_SERVER_WORKER_REQUIRED");
  assert.equal(f.runtime.failRequest(SUPPLIER, request.requestID,
    claim.data.claimToken, { forged: true }).success, false);
  assert.equal(f.runtime.renewClaim(SUPPLIER, request.requestID, claim.data.claimToken).success, false);
  assert.equal(f.runtime.releaseClaim(SUPPLIER, request.requestID, claim.data.claimToken).success, false);
  assert.equal(f.runtime._finalizeCommittedRequest(request.requestID, "logistics.transfer",
    { forged: true }, { _chainVerified: true, _completionProof: {} }).success, false);
  assert.equal(access.releaseClaim(claim.data).success, true);
  let genericCalls = 0;
  f.runtime.registerHandler("logistics.transfer", () => { genericCalls += 1; });
  assert.equal((await f.runtime.processNextRequest(SUPPLIER)).processed, false);
  assert.equal(genericCalls, 0);
  const worker = f.worker();
  assert.equal((await worker.runOnce()).fulfilled, 1);
  await worker.runOnce();
  assert.equal(f.executionCount, 1);
  assert.equal(f.runtime.getRequest(requestID(1)).data.status, "fulfilled");
});

test("restart recovers expired leases and committed transfers after cancellation and offline changes", async () => {
  const f = fixture();
  f.create(1);
  f.create(2);
  const access = f.runtime.createWorkerAccess("logistics.transfer");
  access.claimRequest(f.runtime.getRequest(requestID(1)).data, { claimTtlMs: 100 });
  f.receipts.set(requestID(2), { requestID: requestID(2), quantity: 2 });
  f.runtime.cancelRequest(RECEIVER, requestID(2));
  f.advance(101);
  f.restart();
  assert.equal((await f.worker().runOnce()).fulfilled, 2);
  assert.equal(f.executionCount, 1);

  f.create(3, { expiresInMs: 1 });
  f.receipts.set(requestID(3), { requestID: requestID(3), quantity: 2 });
  f.advance(8 * 24 * 60 * 60 * 1000);
  f.assemblies.get(SUPPLIER).state.assemblyStatus = 1;
  f.restart();
  assert.equal((await f.worker().runOnce()).fulfilled, 1);
  assert.equal(f.runtime.getRequest(requestID(3)).data.status, "fulfilled");
  assert.equal(f.executionCount, 1);
});

test("receipt persists across queue completion write failures and restarts", async () => {
  const f = fixture();
  f.create(1);
  f.rejectCompletion(true);
  assert.equal((await f.worker().runOnce()).fulfilled, 0);
  assert.equal(f.executionCount, 1);
  assert.equal(f.state().requests[requestID(1)].status, "claimed");
  f.rejectCompletion(false);
  f.restart();
  f.assemblies.get(SUPPLIER).state.assemblyStatus = 1;
  assert.equal((await f.worker().runOnce()).fulfilled, 1);
  assert.equal(f.executionCount, 1);
});

test("retryable shortages release claims and terminal validation errors fail without moving", async () => {
  const f = fixture();
  f.create(1);
  f.create(2);
  const originalExecute = f.executor.execute;
  let shortage = true;
  f.executor.execute = async (request, settings) => {
    if (request.requestID === requestID(2)) {
      return { success: false, retryable: false, errorMsg: "ASSEMBLY_LOGISTICS_TYPE_INVALID" };
    }
    if (shortage) return { success: false, retryable: true, errorMsg: "NOT_ENOUGH_ITEMS" };
    return originalExecute(request, settings);
  };
  const worker = f.worker();
  const first = await worker.runOnce();
  assert.equal(first.failed, 1);
  assert.equal(f.runtime.getRequest(requestID(1)).data.status, "queued");
  assert.equal(f.runtime.getRequest(requestID(2)).data.status, "failed");
  shortage = false;
  f.advance(11);
  assert.equal((await worker.runOnce()).fulfilled, 1);
  assert.equal(f.executionCount, 1);
});

test("a receipt requiring chain synchronization is retried even after request TTL", async () => {
  const f = fixture();
  f.create(1, { expiresInMs: 5 });
  f.receipts.set(requestID(1), { requestID: requestID(1), quantity: 2 });
  const originalLookup = f.executor.getCommittedResult;
  let pending = true;
  f.executor.getCommittedResult = async request => pending
    ? { success: false, retryable: true, errorMsg: "CHAIN_PENDING" } : originalLookup(request);
  const worker = f.worker();
  assert.equal((await worker.runOnce()).fulfilled, 0);
  f.advance(11);
  pending = false;
  assert.equal((await worker.runOnce()).fulfilled, 1);
  assert.equal(f.executionCount, 0);
});

test("worker scans beyond 250 queued requests and isolates one execution failure", async () => {
  const f = fixture();
  for (let index = 1; index <= 251; index += 1) f.create(index);
  const originalExecute = f.executor.execute;
  f.executor.execute = async (request, settings) => {
    if (request.requestID === requestID(1)) throw new Error("temporary unavailable");
    return originalExecute(request, settings);
  };
  const result = await f.worker().runOnce();
  assert.equal(result.scanned, 251);
  assert.equal(result.fulfilled, 250);
  assert.equal(f.runtime.getRequest(requestID(251)).data.status, "fulfilled");
  assert.equal(f.runtime.getRequest(requestID(1)).data.status, "queued");
});

test("parallel ticks share one pass and cancellation is checked immediately before commit", async () => {
  const f = fixture();
  f.create(1);
  let resume;
  const blocked = new Promise(resolve => { resume = resolve; });
  const originalExecute = f.executor.execute;
  f.executor.execute = async (request, settings) => {
    await blocked;
    return originalExecute(request, settings);
  };
  const worker = f.worker();
  const first = worker.runOnce();
  assert.equal(worker.runOnce(), first);
  await new Promise(resolve => setImmediate(resolve));
  f.runtime.cancelRequest(RECEIVER, requestID(1));
  resume();
  await first;
  assert.equal(f.executionCount, 0);
  assert.equal(f.runtime.getRequest(requestID(1)).data.status, "cancelled");
});

test("authenticated logistics actor is durable and part of request idempotency", () => {
  const f = fixture();
  const first = f.create(1);
  assert.deepEqual(first.data.logistics, { version: 1, actor: { kind: "player", actorID: OWNER } });
  assert.equal(f.create(1, { _logisticsActor: { kind: "npc", actorID: OWNER } }).errorMsg,
    "ASSEMBLY_REQUEST_ID_CONFLICT");
  assert.equal(f.create(2, { _logisticsActor: { kind: "player", actorID: OWNER, ownerID: OWNER } }).errorMsg,
    "ASSEMBLY_REQUEST_LOGISTICS_ACTOR_INVALID");
  f.restart();
  assert.deepEqual(f.runtime.getRequest(requestID(1)).data.logistics, first.data.logistics);
});

test("a permanent receipt conflict fails without execution and terminal conflicts can be retained normally", async () => {
  const f = fixture();
  f.create(1);
  f.create(2);
  f.runtime.cancelRequest(RECEIVER, requestID(2));
  f.executor.getCommittedResult = async () => ({ success: false, retryable: false,
    errorMsg: "LOGISTICS_IDEMPOTENCY_CONFLICT" });
  const result = await f.worker().runOnce();
  assert.equal(result.failed, 1);
  assert.equal(result.deferred, 0);
  assert.equal(f.executionCount, 0);
  assert.equal(f.runtime.getRequest(requestID(1)).data.status, "failed");
  assert.equal(f.runtime.getRequest(requestID(1)).data.failure.code, "LOGISTICS_IDEMPOTENCY_CONFLICT");
  assert.ok(f.runtime.getRequest(requestID(1)).data.logisticsReconciledAtMs);
  assert.ok(f.runtime.getRequest(requestID(2)).data.logisticsReconciledAtMs);
});

test("shutdown blocks delayed commits and leaves pending work for restart", async () => {
  const f = fixture();
  f.create(1);
  f.create(2);
  let resume;
  const blocked = new Promise(resolve => { resume = resolve; });
  const originalExecute = f.executor.execute;
  f.executor.execute = async (request, settings) => {
    await blocked;
    return originalExecute(request, settings);
  };
  const worker = f.worker();
  const running = worker.runOnce();
  await new Promise(resolve => setImmediate(resolve));
  const stopped = worker.stop();
  assert.equal(stopped, running);
  resume();
  await stopped;
  assert.equal(f.executionCount, 0);
  assert.equal(f.runtime.getRequest(requestID(1)).data.status, "queued");
  assert.equal(f.runtime.getRequest(requestID(2)).data.status, "queued");
  assert.equal((await worker.runOnce()).scanned, 0);
  f.restart();
  assert.equal((await f.worker().runOnce()).fulfilled, 2);
});

test("queue flush failure rolls back cache, withholds signals and prevents an unpersisted claim", async () => {
  const f = fixture();
  const signals = [];
  f.runtime.subscribeToSignals(RECEIVER, signal => signals.push(signal));
  f.rejectFlush(true);
  assert.equal(f.create(1).errorMsg, "ASSEMBLY_REQUEST_PERSIST_FAILED");
  assert.equal(f.runtime.getRequest(requestID(1)).success, false);
  assert.equal(signals.length, 0);
  f.rejectFlush(false);
  assert.equal(f.create(1).success, true);
  assert.equal(f.durable().requests[requestID(1)].status, "queued");
  f.rejectFlush(true);
  assert.equal((await f.worker().runOnce()).fulfilled, 0);
  assert.equal(f.executionCount, 0);
  assert.equal(f.state().requests[requestID(1)].status, "queued");
  assert.equal(signals.length, 1);
  f.rejectFlush(false);
  assert.equal((await f.worker().runOnce()).fulfilled, 1);
  assert.equal(f.durable().requests[requestID(1)].status, "fulfilled");
});

test("a failed rollback blocks queue execution until the previous snapshot is durable again", async () => {
  const f = fixture();
  f.rejectFlush(true);
  f.rejectRollback(true);
  assert.equal(f.create(1).success, false);
  assert.equal(f.state().requests[requestID(1)].status, "queued", "fake store refused cache rollback");
  assert.equal(f.runtime.getRequest(requestID(1)).success, false, "failed cache write is never authoritative");
  assert.equal((await f.worker().runOnce()).scanned, 0);
  assert.equal(f.executionCount, 0);
  assert.equal(f.create(2).errorMsg, "ASSEMBLY_REQUEST_PERSIST_FAILED");
  f.rejectRollback(false);
  f.rejectFlush(false);
  assert.equal(f.create(2).success, true);
  assert.equal(f.runtime.getRequest(requestID(1)).success, false);
  assert.equal((await f.worker().runOnce()).fulfilled, 1);
});

test("real deployment classification exempts mixed/local logistics only and keeps all-smart proofs mandatory", async t => {
  const database = require("../src/gameStore");
  const itemStore = require("../src/services/inventory/itemStore");
  const deployment = require("../src/services/frontier/deploymentRuntime");
  const reference = require("../src/services/_shared/referenceData");
  const requests = require("../src/services/frontier/smartAssemblyRequestRuntime");
  const { registerSuiAssemblyRequestLinkBridge } = require("../src/services/frontier/suiAssemblyRequestLink");
  const componentTable = reference.TABLE.SPACE_COMPONENTS_BY_TYPE;
  const previousItems = itemStore.getAllItems();
  const previousComponents = database.read(componentTable, "/");
  const previousRequests = database.read("smartAssemblyRequests", "/");
  const FIELD = 87566, SMART = 77917, SECOND_SMART = SUPPLIER + 1;
  function row(itemID, typeID) {
    return { itemID, typeID, ownerID: OWNER, locationID: 30000004,
      singleton: 1, stacksize: 1, quantity: 1,
      customInfo: JSON.stringify({ evejsFrontierConstruction: {
        activationCompleteAtMs: 0, assemblyStatus: 2, assemblyTypeID: typeID,
        completedAtMs: 1, ownerID: OWNER, solarSystemID: 30000004,
      } }),
    };
  }
  const rows = { [RECEIVER]: row(RECEIVER, FIELD), [SUPPLIER]: row(SUPPLIER, SMART),
    [SECOND_SMART]: row(SECOND_SMART, SMART) };
  let creationValid = true;
  const calls = { create: 0, verify: 0, terminal: 0, committed: 0 };
  const unregister = registerSuiAssemblyRequestLinkBridge({
    async attestCreation(request) { calls.create++; return { attestationHash: request.requestID }; },
    async verifyCreation() { calls.verify++; return creationValid; },
    async verifyCommittedCreation() { calls.committed++; return true; },
    async attestTerminal(request) { calls.terminal++; return { attestationHash: request.requestID }; },
    async verifyTerminal() { return true; },
  });
  t.after(() => {
    unregister();
    itemStore._writeItemsForTest(previousItems, { force: true });
    database.write(componentTable, "/", previousComponents.success ? previousComponents.data : {});
    database.write("smartAssemblyRequests", "/", previousRequests.success ? previousRequests.data : {});
    database.flushTablesSync([componentTable, "smartAssemblyRequests"]);
    reference.clearReferenceCache(componentTable);
    deployment._testing.clearBuildDefinitionCache();
  });
  database.ensureTable(componentTable);
  database.ensureTable("smartAssemblyRequests");
  assert.equal(database.write(componentTable, "/", { types: [
    { typeID: FIELD, smartDeployable: { constructionCost: { 34: 1 }, createOnChain: 0 } },
    { typeID: SMART, smartDeployable: { constructionCost: { 34: 1 }, createOnChain: 1 } },
  ] }).success, true);
  assert.equal(database.write("smartAssemblyRequests", "/", {}).success, true);
  assert.equal(itemStore._writeItemsForTest(rows, { force: true }), true);
  reference.clearReferenceCache(componentTable);
  deployment._testing.clearBuildDefinitionCache();
  assert.equal(deployment.getAssemblyRecord(RECEIVER).createOnChain, false);
  assert.equal(deployment.getAssemblyRecord(SUPPLIER).createOnChain, true);
  const create = (id, source, target) => requests.createRequest(source, target, "logistics.transfer", {
    ownerID: OWNER, requestID: requestID(id), payload: { typeID: 34, quantity: 2 },
    _logisticsActor: { kind: "player", actorID: OWNER },
    _logisticsAttestation: "local", // A caller string never controls server classification.
  });
  const local = await create(101, RECEIVER, SUPPLIER);
  assert.equal(local.success, true, local.errorMsg);
  assert.equal(local.data.logistics.requestAttestation, "local");
  assert.equal(local.data.chainLink, null);
  const access = requests.createWorkerAccess("logistics.transfer");
  const localClaim = await access.claimRequest(local.data);
  assert.equal(localClaim.claimed, true, localClaim.errorMsg);
  assert.equal(access.validateClaim(local.data.requestID, localClaim.data.claimToken).success, true);
  assert.equal((await access.finalizeCommittedRequest(local.data.requestID, { moved: 2 })).success, true);
  assert.deepEqual(calls, { create: 0, verify: 0, terminal: 0, committed: 0 });

  const smart = await create(102, SUPPLIER, SECOND_SMART);
  assert.equal(smart.success, true, smart.errorMsg);
  assert.equal(smart.data.logistics.requestAttestation, "sui");
  assert.equal(smart.data.chainLink.required, true);
  assert.equal(calls.create, 1);
  creationValid = false;
  assert.equal((await access.claimRequest(smart.data)).success, false);
  creationValid = true;
  assert.equal((await access.claimRequest(smart.data)).claimed, true);
  assert.equal((await access.finalizeCommittedRequest(smart.data.requestID, { moved: 2 })).success, true);
  assert.equal(calls.committed, 1);
  assert.equal(calls.terminal, 1);

  const changed = await create(103, RECEIVER, SUPPLIER);
  assert.equal(changed.success, true);
  assert.equal(itemStore._writeItemsForTest({ ...rows, [RECEIVER]: row(RECEIVER, SMART) }, { force: true }), true);
  assert.equal((await access.claimRequest(changed.data)).errorMsg, "ASSEMBLY_REQUEST_ENDPOINT_CHANGED");
});
