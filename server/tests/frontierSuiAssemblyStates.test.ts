import assert = require("node:assert/strict");
import { test } from "node:test";
import { registerSuiAssemblyStateRunner, registerSuiAssemblyStatesRunner,
  runWithSuiAssemblyState, runWithSuiAssemblyStates } from "../src/services/frontier/suiAssemblyState";

test("multi-assembly inventory operations stay synchronous when localnet is disabled", () => {
  const result = { success: true };
  assert.strictEqual(runWithSuiAssemblyStates([200, 100], () => result), result);
});

test("multi-assembly transfers share one queue entry, refresh all IDs, and commit once", async t => {
  const calls: any[] = [];
  let release!: () => void;
  const waitForStorage = new Promise<void>(resolve => { release = resolve; });
  t.after(registerSuiAssemblyStatesRunner(async (ids, operation) => {
    calls.push("enter");
    for (const id of ids) {
      calls.push(id);
      if (id === 100) await waitForStorage;
    }
    const result = operation();
    calls.push("exit");
    return result;
  }));
  const pending = runWithSuiAssemblyStates([200, 100, 100, 300], () => { calls.push("commit"); return "moved"; });
  assert.ok(pending instanceof Promise);
  assert.deepEqual(calls, ["enter", 200, 100]);
  release();
  assert.equal(await pending, "moved");
  assert.deepEqual(calls, ["enter", 200, 100, 300, "commit", "exit"]);
  calls.length = 0;
  assert.equal(await runWithSuiAssemblyState(200, () => "read"), "read");
  assert.deepEqual(calls, ["enter", 200, "exit"], "Single-object callers retain the same worker");
});

test("one failed authoritative assembly refresh prevents every inventory mutation", async t => {
  let commits = 0;
  const failure = Object.assign(new Error("Storage assembly is offline"), { code: "ASSEMBLY_STATE_PENDING" });
  t.after(registerSuiAssemblyStatesRunner(async ids => {
    assert.deepEqual(ids, [200, 100]);
    throw failure;
  }));
  await assert.rejects(async () => runWithSuiAssemblyStates([200, 100], () => { commits++; }), error => error === failure);
  assert.equal(commits, 0);
});

test("invalid multi-assembly identities never enter the worker", async t => {
  t.after(registerSuiAssemblyStatesRunner(async () => assert.fail("Invalid identities must fail before refresh")));
  for (const ids of [[], [200, 0], [200, -1], [200, NaN], [200, 1.5], [200, "100"], [Number.MAX_SAFE_INTEGER + 1]]) {
    await assert.rejects(async () => runWithSuiAssemblyStates(ids as number[], () => assert.fail("No mutation")), { code: "ASSEMBLY_STATE_UNAVAILABLE" });
  }
});

test("legacy single-object workers cannot authorize multi-object commits by nesting queues", async t => {
  let entries = 0;
  t.after(registerSuiAssemblyStateRunner(async (_id, operation) => { entries++; return operation(); }));
  await assert.rejects(async () => runWithSuiAssemblyStates([200, 100], () => assert.fail("No unsafe fallback")), { code: "ASSEMBLY_STATE_UNAVAILABLE" });
  assert.equal(entries, 0);
  assert.equal(await runWithSuiAssemblyStates([200, 200], () => "single"), "single");
  assert.equal(entries, 1);
});

test("replacement during batch refresh prevents the old worker from committing", async t => {
  let release!: () => void;
  const waiting = new Promise<void>(resolve => { release = resolve; });
  const unregister = registerSuiAssemblyStatesRunner(async (_ids, operation) => { await waiting; return operation(); });
  t.after(unregister);
  let commits = 0;
  const pending = runWithSuiAssemblyStates([200, 100], () => { commits++; });
  const rejected = assert.rejects(async () => pending, { code: "ASSEMBLY_STATE_UNAVAILABLE" });
  t.after(registerSuiAssemblyStatesRunner(async (_ids, operation) => operation()));
  unregister();
  release();
  await rejected;
  assert.equal(commits, 0);
  assert.equal(await runWithSuiAssemblyStates([200, 100], () => "current"), "current");
});
