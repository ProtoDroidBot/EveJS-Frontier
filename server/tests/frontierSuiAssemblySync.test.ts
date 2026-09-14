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
