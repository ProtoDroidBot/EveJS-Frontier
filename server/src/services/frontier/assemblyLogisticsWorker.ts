"use strict";

const LOGISTICS_REQUEST_TYPE = "logistics.transfer";
const TERMINAL_STATES = new Set(["fulfilled", "failed", "cancelled", "expired"]);

// No timer or live-store read occurs at import. The server starts this worker
// only after the item store and chain synchronization services are ready.
function createAssemblyLogisticsWorker(overrides: Record<string, any> = {}) {
  const deps = {
    now: Date.now,
    setInterval,
    clearInterval,
    intervalMs: 1_000,
    retryMs: 5_000,
    claimTtlMs: 30_000,
    onError: error => require("../../utils/logger").warn(
      `[assembly-logistics] ${String(error?.message || error?.errorMsg || error)}`),
    ...overrides,
  };
  let access = null;
  let executor = null;
  let timer = null;
  let running: Promise<any> | null = null;
  let stopping = false;
  const retryAt = new Map<string, number>();

  function initialize() {
    access ||= (overrides.requests || require("./smartAssemblyRequestRuntime"))
      .createWorkerAccess(LOGISTICS_REQUEST_TYPE);
    executor ||= overrides.executor || require("./assemblyLogisticsRuntime");
  }

  function retry(requestID) {
    retryAt.set(requestID, deps.now() + Math.max(1, Number(deps.retryMs) || 5_000));
  }

  function report(error) {
    try { deps.onError(error); } catch (_) { /* Reporting must not stop other requests. */ }
  }

  async function finalize(request, receipt, counts) {
    if (!receipt.success) {
      retry(request.requestID);
      counts.deferred += 1;
      return;
    }
    const result = await access.finalizeCommittedRequest(request.requestID, receipt.data);
    if (result.success) {
      retryAt.delete(request.requestID);
      counts.fulfilled += 1;
    } else {
      retry(request.requestID);
      counts.deferred += 1;
      report(result);
    }
  }

  async function processRequest(request, counts) {
    if (request.status === "fulfilled") return;
    if ((retryAt.get(request.requestID) || 0) > deps.now()) return;

    // This precedes status, lease, online and inventory validation. A previous
    // process may have committed items and crashed before queue completion.
    const receipt = await executor.getCommittedResult(request);
    if (receipt && (receipt.success || receipt.retryable !== false)) {
      await finalize(request, receipt, counts);
      return;
    }
    if (TERMINAL_STATES.has(request.status)) {
      if (!request.logisticsReconciledAtMs) access.markTerminalReconciled(request.requestID);
      retryAt.delete(request.requestID);
      return;
    }
    // Do not borrow an existing lease. Startup reconciliation expires stale
    // leases; unexpired leases may still belong to another in-flight worker.
    if (request.status !== "queued") return;
    const claimed = await access.claimRequest(request, { claimTtlMs: deps.claimTtlMs });
    if (!claimed.success || !claimed.claimed) {
      retry(request.requestID);
      counts.deferred += 1;
      return;
    }
    const claim = claimed.data;
    const assertClaim = () => stopping
      ? { success: false, errorMsg: "ASSEMBLY_LOGISTICS_STOPPING" }
      : access.validateClaim(claim.requestID, claim.claimToken);
    const validated = assertClaim();
    if (!validated.success) {
      access.releaseClaim(claim);
      retry(claim.requestID);
      counts.deferred += 1;
      return;
    }

    let result;
    try {
      // A permanent receipt conflict is evidence of a reused/corrupt command,
      // not pending chain synchronization. Fail it without executing again.
      result = receipt || await executor.execute(validated.data, { assertClaim });
    } catch (error) {
      // A thrown exception can follow a successful inventory commit. Always
      // check the durable receipt before releasing or failing the request.
      result = { success: false, retryable: true, errorMsg: String(error?.code ||
        error?.message || "ASSEMBLY_LOGISTICS_EXECUTION_FAILED") };
      report(error);
    }
    const committed = await executor.getCommittedResult(claim);
    if (committed && (committed.success || committed.retryable !== false)) {
      await finalize(claim, committed, counts);
      return;
    }
    if (committed) result = committed;
    if (result?.success || result?.retryable !== false) {
      access.releaseClaim(claim);
      retry(claim.requestID);
      counts.deferred += 1;
      return;
    }
    const failed = await access.failRequest(claim, {
      code: String(result?.errorMsg || "ASSEMBLY_LOGISTICS_EXECUTION_FAILED"),
    });
    if (failed.success) {
      access.markTerminalReconciled(claim.requestID);
      retryAt.delete(claim.requestID);
      counts.failed += 1;
    } else {
      retry(claim.requestID);
      counts.deferred += 1;
    }
  }

  async function runPass() {
    initialize();
    const counts = { success: true, scanned: 0, fulfilled: 0, failed: 0, deferred: 0 };
    const requests = access.listRequests();
    const present = new Set(requests.map(request => request.requestID));
    for (const id of retryAt.keys()) if (!present.has(id)) retryAt.delete(id);
    for (const request of requests) {
      if (stopping) break;
      counts.scanned += 1;
      try { await processRequest(request, counts); }
      catch (error) {
        retry(request.requestID);
        counts.deferred += 1;
        report(error);
      }
    }
    return counts;
  }

  function runOnce() {
    if (stopping && !running) return Promise.resolve({ success: true, scanned: 0,
      fulfilled: 0, failed: 0, deferred: 0 });
    if (!running) running = runPass().finally(() => { running = null; });
    return running;
  }

  function start() {
    if (timer !== null) return;
    stopping = false;
    initialize();
    void runOnce().catch(report);
    timer = deps.setInterval(() => { void runOnce().catch(report); },
      Math.max(1, Number(deps.intervalMs) || 1_000));
    timer?.unref?.();
  }

  function stop() {
    stopping = true;
    if (timer !== null) deps.clearInterval(timer);
    timer = null;
    // Synchronous process shutdown need not await this promise: assertClaim
    // prevents a delayed authority callback from starting another item commit.
    // Programmatic callers can await receipt reconciliation already in flight.
    return running || Promise.resolve();
  }

  return { start, stop, runOnce, tick: runOnce };
}

const worker = createAssemblyLogisticsWorker();
module.exports = {
  LOGISTICS_REQUEST_TYPE,
  createAssemblyLogisticsWorker,
  startAssemblyLogisticsWorker: worker.start,
  stopAssemblyLogisticsWorker: worker.stop,
  runAssemblyLogisticsWorkerOnce: worker.runOnce,
};
