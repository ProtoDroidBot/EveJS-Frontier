"use strict";

import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

type Request = { id: number; op: string; payload?: Record<string, any> };
type Lease = { requestId: number; token: string; label: string; expiresAt: number; timer: ReturnType<typeof setTimeout> };
type QueuedAcquire = { id: number; label: string; leaseMs: number };
type JournalRecord = {
  chainId: string;
  packageId: string;
  journal: Record<string, any>;
  revision: number;
};

const journals = new Map<string, JournalRecord>();
const acquireQueue: QueuedAcquire[] = [];
const maxQueued = positiveInteger(process.env.EVEJS_SUI_ASSEMBLY_MAX_PENDING, 64);
let activeLease: Lease | null = null;

function positiveInteger(value: unknown, fallback: number) {
  const numeric = Number(value);
  return Number.isSafeInteger(numeric) && numeric > 0 ? numeric : fallback;
}

function reply(id: number, result: unknown) {
  if (process.connected) process.send?.({ id, ok: true, result });
}

function fail(id: number, error: any) {
  if (process.connected) process.send?.({ id, ok: false, error: {
    name: error?.name || "Error",
    message: error?.message || String(error),
    code: error?.code,
    stack: error?.stack,
  } });
}

function coded(message: string, code: string) {
  return Object.assign(new Error(message), { code });
}

function expireLease(token: string) {
  if (!activeLease || activeLease.token !== token) return;
  clearTimeout(activeLease.timer);
  activeLease = null;
  grantNext();
}

function grant(id: number, label: string, leaseMs: number) {
  const token = randomUUID();
  const timer = setTimeout(() => expireLease(token), leaseMs);
  timer.unref?.();
  activeLease = { requestId: id, token, label, expiresAt: Date.now() + leaseMs, timer };
  reply(id, { token, expiresAt: activeLease.expiresAt });
}

function grantNext() {
  if (activeLease || acquireQueue.length === 0) return;
  const next = acquireQueue.shift()!;
  grant(next.id, next.label, next.leaseMs);
}

function requireLease(token: unknown) {
  if (!activeLease || activeLease.token !== token || activeLease.expiresAt <= Date.now()) {
    throw coded("Assembly synchronization lease expired", "ASSEMBLY_SYNC_LEASE_EXPIRED");
  }
  return activeLease;
}

function readJournal(journalPath: string, chainId: string, packageId: string) {
  let journal: Record<string, any> = { version: 1, chainId, packageId };
  if (fs.existsSync(journalPath)) journal = JSON.parse(fs.readFileSync(journalPath, "utf8"));
  if (journal.version !== 1 || journal.chainId !== chainId || journal.packageId !== packageId) {
    throw new Error("Assembly transaction journal belongs to a different deployment");
  }
  return journal;
}

function openJournal(payload: Record<string, any>) {
  const journalPath = path.resolve(String(payload.journalPath || ""));
  const chainId = String(payload.chainId || "");
  const packageId = String(payload.packageId || "");
  if (!journalPath || !chainId || !packageId) throw new TypeError("Journal path and deployment identity are required");
  let record = journals.get(journalPath);
  if (!record) {
    record = { chainId, packageId, journal: readJournal(journalPath, chainId, packageId), revision: 0 };
    journals.set(journalPath, record);
  } else if (record.chainId !== chainId || record.packageId !== packageId) {
    throw new Error("Assembly transaction journal belongs to a different deployment");
  }
  return { journal: record.journal, revision: record.revision };
}

function saveJournal(payload: Record<string, any>) {
  requireLease(payload.token);
  const journalPath = path.resolve(String(payload.journalPath || ""));
  const record = journals.get(journalPath);
  if (!record) throw coded("Assembly transaction journal is not open", "ASSEMBLY_JOURNAL_NOT_OPEN");
  if (Number(payload.expectedRevision) !== record.revision) {
    throw coded("Assembly transaction journal revision changed", "ASSEMBLY_JOURNAL_CONFLICT");
  }
  const next = payload.journal;
  if (!next || next.version !== 1 || next.chainId !== record.chainId || next.packageId !== record.packageId) {
    throw new Error("Assembly transaction journal belongs to a different deployment");
  }
  fs.mkdirSync(path.dirname(journalPath), { recursive: true });
  const temporary = `${journalPath}.${process.pid}.${randomUUID()}.tmp`;
  const fd = fs.openSync(temporary, "w", 0o600);
  try {
    fs.writeFileSync(fd, JSON.stringify(next, null, 2));
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(temporary, journalPath);
  record.journal = next;
  record.revision += 1;
  return { revision: record.revision };
}

async function jsonRpc(payload: Record<string, any>) {
  requireLease(payload.token);
  const url = new URL(String(payload.url || ""));
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw coded("Assembly RPC URL must use HTTP or HTTPS", "ASSEMBLY_RPC_INVALID_URL");
  }
  const timeoutMs = positiveInteger(payload.timeoutMs, 10_000);
  const response = await fetch(url, {
    method: "POST",
    signal: AbortSignal.timeout(timeoutMs),
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: requestSequence++,
      method: String(payload.method || ""),
      params: Array.isArray(payload.params) ? payload.params : [],
    }),
  });
  if (!response.ok) {
    throw coded(`Assembly RPC returned HTTP ${response.status}`, "ASSEMBLY_RPC_HTTP_ERROR");
  }
  const body: any = await response.json();
  if (body?.error) {
    const error: Error & Record<string, any> = new Error(body.error.message || "Assembly RPC failed");
    error.code = body.error.code;
    throw error;
  }
  return body?.result;
}

let requestSequence = 1;

async function handle(request: Request) {
  const payload = request.payload || {};
  switch (request.op) {
    case "acquire": {
      const leaseMs = positiveInteger(payload.leaseMs, 120_000);
      const label = String(payload.label || "assembly-operation");
      if (!activeLease) grant(request.id, label, leaseMs);
      else if (acquireQueue.length >= maxQueued) {
        throw coded(`Assembly synchronization queue is full (${maxQueued})`, "ASSEMBLY_SYNC_BUSY");
      } else acquireQueue.push({ id: request.id, label, leaseMs });
      return;
    }
    case "cancelAcquire": {
      const targetId = Number(payload.requestId);
      if (activeLease?.requestId === targetId) expireLease(activeLease.token);
      const index = acquireQueue.findIndex(entry => entry.id === targetId);
      if (index >= 0) acquireQueue.splice(index, 1);
      reply(request.id, true);
      return;
    }
    case "renew": {
      const lease = requireLease(payload.token);
      const leaseMs = positiveInteger(payload.leaseMs, 120_000);
      clearTimeout(lease.timer);
      lease.expiresAt = Date.now() + leaseMs;
      lease.timer = setTimeout(() => expireLease(lease.token), leaseMs);
      lease.timer.unref?.();
      reply(request.id, { expiresAt: lease.expiresAt });
      return;
    }
    case "release": {
      requireLease(payload.token);
      expireLease(String(payload.token));
      reply(request.id, true);
      return;
    }
    case "assertLease": reply(request.id, { expiresAt: requireLease(payload.token).expiresAt }); return;
    case "openJournal": reply(request.id, openJournal(payload)); return;
    case "saveJournal": reply(request.id, saveJournal(payload)); return;
    case "jsonRpc": reply(request.id, await jsonRpc(payload)); return;
    case "shutdown": reply(request.id, true); setImmediate(() => process.exit(0)); return;
    default: throw coded(`Unknown assembly supervisor operation: ${request.op}`, "ASSEMBLY_SUPERVISOR_BAD_REQUEST");
  }
}

process.on("message", (request: Request) => {
  if (!request || !Number.isSafeInteger(request.id)) return;
  void handle(request).catch(error => fail(request.id, error));
});

process.on("disconnect", () => process.exit(0));
