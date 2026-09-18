import assert = require("node:assert/strict");
import fs = require("node:fs");
import http = require("node:http");
import os = require("node:os");
import path = require("node:path");
import { test } from "node:test";
import { createSuiAssemblySupervisor } from "../src/services/frontier/suiAssemblySupervisor";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

test("supervisor is the journal writer and fences an operation after its lease expires", async (t) => {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), "evejs-sui-supervisor-"));
  const journalPath = path.join(root, "transactions.json");
  const supervisor = createSuiAssemblySupervisor({
    leaseMs: 100,
    rpcTimeoutMs: 1_000,
    admissionTimeoutMs: 2_000,
  });
  t.after(async () => {
    await supervisor.close();
    await fs.promises.rm(root, { recursive: true, force: true });
  });

  const started = deferred();
  const releaseStalled = deferred();
  let staleStore: any;
  const stalled = supervisor.runExclusive("stalled", async () => {
    staleStore = await supervisor.openJournal(journalPath, "chain-a", "package-a");
    started.resolve();
    await releaseStalled.promise;
    await assert.rejects(
      staleStore.save(staleStore.initialRevision, {
        ...staleStore.initialJournal,
        lastTransaction: { label: "stale", digest: "old", status: "success" },
      }),
      (error: any) => error.code === "ASSEMBLY_SYNC_LEASE_EXPIRED",
    );
  });
  await started.promise;

  // No heartbeat fires before this deliberately short lease. A later caller
  // must be admitted even though the original action has not returned.
  await new Promise(resolve => setTimeout(resolve, 150));
  await supervisor.runExclusive("replacement", async () => {
    const store = await supervisor.openJournal(journalPath, "chain-a", "package-a");
    await store.save(store.initialRevision, {
      ...store.initialJournal,
      lastTransaction: { label: "replacement", digest: "new", status: "success" },
    });
  });
  releaseStalled.resolve();
  await stalled;

  const persisted = JSON.parse(await fs.promises.readFile(journalPath, "utf8"));
  assert.equal(persisted.lastTransaction.digest, "new");
});

test("supervised SUI transport enforces RPC deadlines outside the server process", async (t) => {
  const server = http.createServer((request, response) => {
    if (request.url === "/hang") return;
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({ jsonrpc: "2.0", id: 1, result: { chain: "localnet" } }));
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const supervisor = createSuiAssemblySupervisor({ leaseMs: 5_000, rpcTimeoutMs: 500 });
  t.after(async () => {
    await supervisor.close();
    await new Promise<void>(resolve => server.close(() => resolve()));
  });

  await assert.rejects(
    supervisor.runExclusive("rpc-timeout", () => supervisor.requestSuiRpc(
      `http://127.0.0.1:${address.port}/hang`,
      "sui_getObject",
      [],
      50,
    )),
    /abort|timeout/i,
  );
  const result = await supervisor.runExclusive("rpc-recovery", () => supervisor.requestSuiRpc(
    `http://127.0.0.1:${address.port}/ok`,
    "sui_getChainIdentifier",
    [],
    500,
  ));
  assert.deepEqual(result, { chain: "localnet" });
});
