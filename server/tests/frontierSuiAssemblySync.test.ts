import assert = require("node:assert/strict");
import { test } from "node:test";
import { assemblySyncEnabled, createAssemblySyncWorker, findFuelDepletedAssemblyIds } from "../src/services/frontier/suiAssemblySync";
import type { SuiAssemblySnapshotInput } from "../src/services/frontier/suiAssemblySnapshot";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}
const settle = () => new Promise<void>((resolve) => setImmediate(resolve));

function fakeTimeouts(t: any) {
  const originalSet = global.setTimeout;
  const originalClear = global.clearTimeout;
  const handles: Array<{ callback: () => unknown; cancelled: boolean; delay: number; unref: () => void }> = [];
  global.setTimeout = ((callback: () => unknown, delay: number) => {
    const handle = { callback, cancelled: false, delay, unref() {} };
    handles.push(handle);
    return handle;
  }) as any;
  global.clearTimeout = ((handle: any) => { if (handle) handle.cancelled = true; }) as any;
  t.after(() => { global.setTimeout = originalSet; global.clearTimeout = originalClear; });
  return {
    pending: () => handles.filter((handle) => !handle.cancelled),
    async fireNext() {
      const handle = handles.find((candidate) => !candidate.cancelled);
      assert.ok(handle, "Expected a scheduled retry");
      handle.cancelled = true;
      await handle.callback();
      await settle();
    },
  };
}

test("assembly sync is enabled only for Frontier and never in isolated test environments", () => {
  assert.equal(assemblySyncEnabled({}, "frontier"), true);
  assert.equal(assemblySyncEnabled({}, "eve-online"), false);
  assert.equal(assemblySyncEnabled({}, ""), false);
  for (const value of ["false", "0", "FALSE", " off ", "no"]) {
    assert.equal(assemblySyncEnabled({ EVEJS_SUI_ASSEMBLY_SYNC_ENABLED: value }, "frontier"), false, value);
  }
  for (const flag of ["NODE_TEST_CONTEXT", "EVEJS_TEST_STORE_ISOLATED", "EVEJS_TEST_STORE_BASELINE_ROOT", "EVEJS_TEST_FRONTIER_FIXTURES"]) {
    assert.equal(assemblySyncEnabled({ [flag]: "1", EVEJS_SUI_ASSEMBLY_SYNC_ENABLED: "true" }, "frontier"), false, flag);
  }
});

test("concurrent runOnce requests share one reconciliation and preserve later retries", async () => {
  const first = deferred();
  let calls = 0;
  let active = 0;
  let maxActive = 0;
  const worker = createAssemblySyncWorker({
    report: () => assert.fail("Successful reconciliation must not report an error"),
    async reconcile() {
      calls++;
      active++;
      maxActive = Math.max(maxActive, active);
      if (calls === 1) await first.promise;
      active--;
    },
  });
  const runs = [worker.runOnce(), worker.runOnce(), worker.runOnce()];
  await settle();
  assert.equal(calls, 1);
  first.resolve();
  await Promise.all(runs);
  await worker.runOnce();
  assert.equal(calls, 2);
  assert.equal(maxActive, 1);
  await worker.stop();
});

test("retry loop suppresses repeated errors and reports each recovery once", async (t) => {
  const timeouts = fakeTimeouts(t);
  const messages: string[] = [];
  const outcomes = ["rpc down", "rpc down", "rpc changed", null, null, "rpc down"];
  let calls = 0;
  const worker = createAssemblySyncWorker({
    intervalMs: 37,
    report: (message) => messages.push(message),
    async reconcile() {
      const outcome = outcomes[calls++];
      if (outcome) throw new Error(outcome);
    },
  });
  t.after(() => worker.stop());
  worker.start();
  worker.start();
  await settle();
  assert.equal(calls, 1, "Starting an already-running worker is idempotent");
  assert.equal(timeouts.pending()[0].delay, 37);
  for (let i = 0; i < 5; i++) await timeouts.fireNext();
  assert.equal(calls, 6);
  assert.deepEqual(messages, ["rpc down", "rpc changed", "Smart Assembly synchronization recovered", "rpc down"]);
  await worker.stop();
  assert.equal(timeouts.pending().length, 0);
});

test("stop waits for in-flight reconciliation without scheduling another retry", async (t) => {
  const timeouts = fakeTimeouts(t);
  const pending = deferred();
  let completed = false;
  const worker = createAssemblySyncWorker({ report() {}, reconcile: () => pending.promise });
  worker.start();
  const stopped = worker.stop().then(() => { completed = true; });
  await settle();
  assert.equal(completed, false);
  pending.resolve();
  await stopped;
  await settle();
  assert.equal(completed, true);
  assert.equal(timeouts.pending().length, 0);
});

test("restart while the previous run is settling never forks the retry loop", async (t) => {
  const timeouts = fakeTimeouts(t);
  const pending = deferred();
  let calls = 0;
  const worker = createAssemblySyncWorker({
    report() {},
    async reconcile() { calls++; if (calls === 1) await pending.promise; },
  });
  t.after(() => worker.stop());
  worker.start();
  const stopped = worker.stop();
  worker.start();
  assert.equal(calls, 1);
  pending.resolve();
  await stopped;
  await settle();
  assert.equal(timeouts.pending().length, 1, "An old tick must not schedule a second timer after restart");
  await timeouts.fireNext();
  assert.equal(calls, 2);
  assert.equal(timeouts.pending().length, 1);
});

test("storage status reads and reconciliation share one exclusive queue in arrival order", async () => {
  const readGate = deferred();
  const writeGate = deferred();
  const events: string[] = [];
  const worker = createAssemblySyncWorker({
    report: () => assert.fail("Serialization must not produce an error"),
    async reconcile() { events.push("write:start"); await writeGate.promise; events.push("write:end"); },
  });
  const firstRead = worker.runExclusive(async () => {
    events.push("first-read:start");
    await readGate.promise;
    events.push("first-read:end");
    return "first inventory";
  });
  const write = worker.runOnce();
  const secondRead = worker.runExclusive(async () => { events.push("second-read"); return "current inventory"; });
  const joinedWrite = worker.runOnce();
  await settle();
  assert.deepEqual(events, ["first-read:start"]);
  readGate.resolve();
  assert.equal(await firstRead, "first inventory");
  await settle();
  assert.deepEqual(events, ["first-read:start", "first-read:end", "write:start"]);
  writeGate.resolve();
  await Promise.all([write, joinedWrite]);
  assert.equal(await secondRead, "current inventory");
  assert.deepEqual(events, ["first-read:start", "first-read:end", "write:start", "write:end", "second-read"]);
  await worker.stop();
});

test("a failed status read rejects its caller without poisoning queued synchronization", async () => {
  const readGate = deferred();
  const events: string[] = [];
  const errors: string[] = [];
  const worker = createAssemblySyncWorker({
    report: message => errors.push(message),
    async reconcile() { events.push("write"); },
  });
  const failed = worker.runExclusive(async () => {
    events.push("read");
    await readGate.promise;
    throw new Error("Character inventory unavailable");
  });
  const rejected = assert.rejects(failed, /Character inventory unavailable/);
  const write = worker.runOnce();
  const followingRead = worker.runExclusive(async () => { events.push("following-read"); return 7; });
  readGate.resolve();
  await Promise.all([rejected, write]);
  assert.equal(await followingRead, 7);
  assert.deepEqual(events, ["read", "write", "following-read"]);
  assert.deepEqual(errors, []);
  assert.equal(worker.getLastError(), "");
  await worker.stop();
});

test("an idle synchronous action failure is a rejected promise and leaves the queue usable", async () => {
  const worker = createAssemblySyncWorker({ report() {}, async reconcile() {} });
  let failure: Promise<unknown>;
  assert.doesNotThrow(() => {
    failure = worker.runExclusive(() => { throw new Error("Synchronous status failure"); });
  });
  await assert.rejects(failure!, /Synchronous status failure/);
  assert.equal(await worker.runExclusive(async () => "recovered"), "recovered");
  await worker.stop();
});

test("shutdown drains already queued status reads and writes without scheduling a retry", async (t) => {
  const timeouts = fakeTimeouts(t);
  const firstGate = deferred();
  const lastGate = deferred();
  const events: string[] = [];
  const worker = createAssemblySyncWorker({ report() {}, async reconcile() { events.push("write"); } });
  const first = worker.runExclusive(async () => { events.push("first-read"); await firstGate.promise; });
  worker.start();
  const last = worker.runExclusive(async () => { events.push("last-read"); await lastGate.promise; });
  let stopped = false;
  const shutdown = worker.stop().then(() => { stopped = true; });
  await settle();
  assert.equal(stopped, false);
  firstGate.resolve();
  await first;
  await settle();
  assert.deepEqual(events, ["first-read", "write", "last-read"]);
  assert.equal(stopped, false, "Shutdown must wait for the status read queued after reconciliation");
  lastGate.resolve();
  await Promise.all([last, shutdown]);
  assert.equal(stopped, true);
  assert.equal(timeouts.pending().length, 0);
});

test("shutdown prevents a multi-step storage flush from enqueuing another chain write", async () => {
  const firstWrite = deferred();
  let writes = 0;
  let reads = 0;
  const worker = createAssemblySyncWorker({
    report() {},
    async reconcile() { writes++; await firstWrite.promise; },
  });
  const flush = (async () => {
    await worker.runOnce();
    await worker.runOnce();
    return worker.runExclusive(async () => { reads++; });
  })();
  const rejected = assert.rejects(flush, /worker is stopped/);
  const shutdown = worker.stop();
  firstWrite.resolve();
  await Promise.all([shutdown, rejected]);
  await settle();
  assert.equal(writes, 1);
  assert.equal(reads, 0);
  await assert.rejects(worker.runExclusive(async () => { reads++; }), /worker is stopped/);
  await assert.rejects(worker.runOnce(), /worker is stopped/);
  assert.equal(writes, 1);
  assert.equal(reads, 0);
});

function depletionInput(): SuiAssemblySnapshotInput {
  const item = (itemID: number, typeID: number, x: number, status: number, quantity = 0) => ({
    itemID, typeID, ownerID: 9001, locationID: 30000123, itemName: `Assembly ${itemID}`,
    spaceState: { position: { x, y: 0, z: 0 } },
    customInfo: JSON.stringify({
      evejsFrontierConstruction: { assemblyTypeID: typeID, assemblyStatus: status, ownerID: 9001, solarSystemID: 30000123 },
      ...(quantity ? { evejsFrontierNetworkNodeFuel: { typeID: 88335, quantity } } : {}),
    }),
  });
  return {
    items: [item(1, 88092, 0, 1), item(2, 88092, 100, 2, 100), item(3, 90184, 1, 2), item(4, 90184, 99, 2)],
    characters: [{ characterID: 9001, accountId: 1, characterName: "Pilot" }],
    components: [
      { typeID: 88092, smartDeployable: { createOnChain: 1 }, smartAnchor: { fuelMaxCapacity: 1000, fuelBurnRateInSeconds: 3000 } },
      { typeID: 90184, smartDeployable: { createOnChain: 1 } },
    ],
    itemTypes: [{ typeID: 88335, volume: 0.28 }],
  };
}

test("fuel exhaustion resolves nearby dependent assemblies without changing source data", () => {
  const input = depletionInput();
  const original = structuredClone(input);
  assert.deepEqual(findFuelDepletedAssemblyIds(input), ["3"]);
  assert.deepEqual(input, original);
});

test("fuel exhaustion follows persisted bindings even when a fueled node is closer", () => {
  const input = depletionInput();
  input.networkNodeBindings = { "3": "2", "4": "1" };
  assert.deepEqual(findFuelDepletedAssemblyIds(input), ["4"]);
});

test("fuel exhaustion does not rebind an assembly whose recorded node is missing", () => {
  const input = depletionInput();
  input.networkNodeBindings = { "3": "999" };
  assert.deepEqual(findFuelDepletedAssemblyIds(input), []);
});
