"use strict";

import path from "node:path";
import { AsyncLocalStorage } from "node:async_hooks";
import { fork, type ChildProcess } from "node:child_process";

type LeaseContext = { token: string; generation: number };
type PendingRpc = { resolve: (value: any) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout>; op: string };

function positiveInteger(value: unknown, fallback: number) {
  const numeric = Number(value);
  return Number.isSafeInteger(numeric) && numeric > 0 ? numeric : fallback;
}

function remoteError(payload: any) {
  const error: Error & Record<string, any> = new Error(payload?.message || "Assembly supervisor request failed");
  error.name = payload?.name || "Error";
  if (payload?.code) error.code = payload.code;
  if (payload?.stack) error.stack = payload.stack;
  return error;
}

export function createSuiAssemblySupervisor(options: Record<string, any> = {}) {
  const workerPath = options.workerPath || path.join(__dirname, "suiAssemblySupervisor.worker.js");
  const rpcTimeoutMs = positiveInteger(options.rpcTimeoutMs ?? process.env.EVEJS_SUI_ASSEMBLY_RPC_TIMEOUT_MS, 10_000);
  const admissionTimeoutMs = positiveInteger(options.admissionTimeoutMs ?? process.env.EVEJS_SUI_ASSEMBLY_ADMISSION_TIMEOUT_MS, 30_000);
  const leaseMs = positiveInteger(options.leaseMs ?? process.env.EVEJS_SUI_ASSEMBLY_LEASE_MS, 120_000);
  const leaseContext = new AsyncLocalStorage<LeaseContext>();
  const pending = new Map<number, PendingRpc>();
  let child: ChildProcess | null = null;
  let nextId = 1;
  let generation = 0;
  let closed = false;
  let restartTimer: ReturnType<typeof setTimeout> | null = null;

  function rejectPending(error: Error) {
    for (const entry of pending.values()) {
      clearTimeout(entry.timer);
      entry.reject(error);
    }
    pending.clear();
  }

  function spawn() {
    if (closed || child?.connected) return child;
    const spawned = fork(workerPath, [], { stdio: ["ignore", "ignore", "ignore", "ipc"] });
    child = spawned;
    generation += 1;
    spawned.on("message", (message: any) => {
      const entry = pending.get(message?.id);
      if (!entry) return;
      pending.delete(message.id);
      clearTimeout(entry.timer);
      if (message.ok) entry.resolve(message.result);
      else entry.reject(remoteError(message.error));
    });
    spawned.on("error", error => {
      options.log?.warn?.(`[SuiAssemblySync] Supervisor error: ${error.message}`);
    });
    spawned.on("exit", (code, signal) => {
      if (child !== spawned) return;
      child = null;
      rejectPending(Object.assign(new Error(`Assembly supervisor exited (${signal || code})`), {
        code: "ASSEMBLY_SUPERVISOR_EXITED",
      }));
      if (!closed && !restartTimer) {
        restartTimer = setTimeout(() => { restartTimer = null; spawn(); }, 1_000);
        restartTimer.unref?.();
      }
    });
    return spawned;
  }

  function request(op: string, payload: Record<string, any> = {}, timeoutMs = rpcTimeoutMs) {
    if (closed) return Promise.reject(new Error("Assembly supervisor is closed"));
    const target = spawn();
    if (!target?.connected) return Promise.reject(new Error("Assembly supervisor is unavailable"));
    const id = nextId++;
    return new Promise<any>((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        const error: Error & Record<string, any> = new Error(`Assembly supervisor ${op} timed out after ${timeoutMs}ms`);
        error.code = op === "acquire" ? "ASSEMBLY_SYNC_BUSY" : "ASSEMBLY_SUPERVISOR_TIMEOUT";
        reject(error);
        if (op === "acquire" && target.connected) {
          const cancelId = nextId++;
          target.send({ id: cancelId, op: "cancelAcquire", payload: { requestId: id } });
        } else if (target === child) {
          // A supervisor that cannot answer a bounded control/RPC request is
          // unhealthy. Terminating it also invalidates every outstanding lease.
          target.kill();
        }
      }, timeoutMs);
      timer.unref?.();
      pending.set(id, { resolve, reject, timer, op });
      target.send({ id, op, payload }, error => {
        if (!error || !pending.has(id)) return;
        pending.delete(id);
        clearTimeout(timer);
        reject(error);
      });
    });
  }

  function currentLease() {
    const current = leaseContext.getStore();
    if (!current || current.generation !== generation) {
      const error: Error & Record<string, any> = new Error("Assembly synchronization lease is unavailable");
      error.code = "ASSEMBLY_SYNC_LEASE_EXPIRED";
      throw error;
    }
    return current;
  }

  async function runExclusive<T>(label: string, action: () => Promise<T>): Promise<T> {
    const nested = leaseContext.getStore();
    if (nested && nested.generation === generation) {
      await request("assertLease", { token: nested.token });
      return action();
    }
    spawn();
    const acquiredGeneration = generation;
    const grant = await request("acquire", { label, leaseMs }, admissionTimeoutMs);
    const context = { token: grant.token, generation: acquiredGeneration };
    let heartbeatError: Error | null = null;
    const heartbeat = setInterval(() => {
      void request("renew", { token: context.token, leaseMs }).catch(error => { heartbeatError = error; });
    }, Math.max(1_000, Math.floor(leaseMs / 3)));
    heartbeat.unref?.();
    try {
      return await leaseContext.run(context, async () => {
        if (heartbeatError) throw heartbeatError;
        return action();
      });
    } finally {
      clearInterval(heartbeat);
      await request("release", { token: context.token }).catch(() => {});
    }
  }

  async function openJournal(journalPath: string, chainId: string, packageId: string) {
    spawn();
    const openedGeneration = generation;
    const opened = await request("openJournal", { journalPath, chainId, packageId });
    return {
      initialJournal: opened.journal,
      initialRevision: opened.revision,
      generation: openedGeneration,
      async assertLease() {
        const lease = currentLease();
        if (openedGeneration !== generation) throw Object.assign(new Error("Assembly supervisor restarted"), {
          code: "ASSEMBLY_SUPERVISOR_RESTARTED",
        });
        await request("assertLease", { token: lease.token });
      },
      async save(expectedRevision: number, journal: Record<string, any>) {
        const lease = currentLease();
        if (openedGeneration !== generation) throw Object.assign(new Error("Assembly supervisor restarted"), {
          code: "ASSEMBLY_SUPERVISOR_RESTARTED",
        });
        return request("saveJournal", {
          token: lease.token, journalPath, expectedRevision, journal,
        });
      },
    };
  }

  function requestSuiRpc(
    url: string,
    method: string,
    params: unknown[],
    timeoutMs = rpcTimeoutMs,
  ) {
    const lease = currentLease();
    const deadline = positiveInteger(timeoutMs, rpcTimeoutMs);
    return request("jsonRpc", {
      token: lease.token, url, method, params, timeoutMs: deadline,
    }, deadline + 1_000);
  }

  async function close() {
    if (closed) return;
    closed = true;
    if (restartTimer) clearTimeout(restartTimer);
    restartTimer = null;
    const target = child;
    if (!target) return;
    target.kill();
    child = null;
    rejectPending(new Error("Assembly supervisor closed"));
  }

  spawn();
  return {
    runExclusive,
    openJournal,
    requestSuiRpc,
    close,
    getGeneration: () => generation,
  };
}
