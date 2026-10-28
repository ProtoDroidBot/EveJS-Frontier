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

test("supervised native gRPC preserves binary frames and errors, aborts and enforces deadlines", async (t) => {
  const paths: string[] = [];
  const server = http.createServer(async (request, response) => {
    paths.push(request.url!);
    assert.equal(request.method, "POST");
    assert.match(request.headers["content-type"]!, /application\/grpc-web/);
    if (request.url?.startsWith("/hang/")) return;
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const textFormat = request.headers["content-type"]!.includes("grpc-web-text");
    const body = Buffer.concat(chunks);
    assert.deepEqual(textFormat ? Buffer.from(body.toString(), "base64") : body, Buffer.from([0, 0, 0, 0, 0]));
    if (request.url?.startsWith("/unavailable/")) { response.writeHead(503).end(); return; }
    const trailer = Buffer.from(request.url?.startsWith("/missing/")
      ? "grpc-status: 5\r\ngrpc-message: missing\r\n" : "grpc-status: 0\r\n");
    const frame = Buffer.alloc(5); frame[0] = 128; frame.writeUInt32BE(trailer.length, 1);
    response.setHeader("content-type", textFormat ? "application/grpc-web-text+proto" : "application/grpc-web+proto");
    const reply = Buffer.concat([request.url?.startsWith("/missing/") ? Buffer.alloc(0) : Buffer.from([0, 0, 0, 0, 0]), frame, trailer]);
    response.end(textFormat ? reply.toString("base64") : reply);
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
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  });
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const info = async (route: string, timeout: number, signal?: AbortSignal) => {
    const { response } = await supervisor.createSuiGrpcClient(`${baseUrl}/${route}`, timeout)
      .ledgerService.getServiceInfo({}, { abort: signal });
    return response;
  };
  await assert.rejects(info("ok", 500), /lease is unavailable/);
  await assert.rejects(
    supervisor.runExclusive("grpc-timeout", () => info("hang", 50)),
    /abort|timeout/i,
  );
  const result = await supervisor.runExclusive("grpc-recovery", () => info("ok", 500));
  assert.deepEqual(result, {});
  await assert.rejects(supervisor.runExclusive("grpc-missing", () => info("missing", 500)),
    (error: any) => error.code === "NOT_FOUND");
  await assert.rejects(supervisor.runExclusive("grpc-unavailable", () => info("unavailable", 500)),
    (error: any) => error.code === "UNAVAILABLE");
  await supervisor.runExclusive("grpc-abort", async () => {
    const signal = AbortSignal.timeout(50);
    await assert.rejects(info("hang", 500, signal), /abort|timeout/i);
  });
  assert.ok(paths.every(url => url.endsWith("/sui.rpc.v2.LedgerService/GetServiceInfo")));
});
