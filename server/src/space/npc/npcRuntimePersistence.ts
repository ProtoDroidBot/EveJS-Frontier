"use strict";

import { createHash, randomUUID } from "node:crypto";
import { gunzipSync, gzipSync } from "node:zlib";

const path = require("path");
const database = require(path.join(__dirname, "../../gameStore"));
const log = require(path.join(__dirname, "../../utils/logger"));

const TABLE = "npcRuntimeState";
const SCHEMA_VERSION = 1;
const MAX_COMPLETED_OPERATIONS = 256;
const MAX_QUARANTINE_RECORDS = 512;
const MAX_SNAPSHOTS = 3;
const MAX_SUPPORT_INCIDENTS = 512;
const ACTIVE_JOB_STATUSES = new Set(["queued", "running", "suspended"]);
const PARKED_JOB_STATUSES = new Set(["interrupted"]);
const NONTERMINAL_JOB_STATUSES = new Set([
  ...ACTIVE_JOB_STATUSES,
  ...PARKED_JOB_STATUSES,
]);
const TERMINAL_JOB_STATUSES = new Set(["completed", "failed", "cancelled"]);
const serverInstanceID = randomUUID();

let initialized = false;
let recoveryRunning = false;
let shutdownHookInstalled = false;
let checkpointTimer: any = null;
let periodicCheckpointRunning = false;
let acceptingNewWork = true;

function cloneValue<T>(value: T): T {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function toPositiveInt(value: unknown, fallback = 0) {
  const numeric = Math.trunc(Number(value) || 0);
  return numeric > 0 ? numeric : fallback;
}

function stableValue(value: any): any {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== "object") return value;
  const output: Record<string, any> = {};
  for (const key of Object.keys(value).sort()) output[key] = stableValue(value[key]);
  return output;
}

function checksum(value: any) {
  return createHash("sha256")
    .update(JSON.stringify(stableValue(value)))
    .digest("hex");
}

function buildRoot(nowMs = Date.now()) {
  return {
    schemaVersion: SCHEMA_VERSION,
    revision: 0,
    checksum: "",
    server: {
      instanceID: null,
      generation: 0,
      cleanShutdown: true,
      startedAtMs: 0,
      shutdownAtMs: 0,
      shutdownReason: null,
    },
    jobs: {},
    supportIncidents: {},
    supportCooldowns: {},
    assemblySignalCursors: {},
    leases: {},
    operations: {},
    quarantine: {},
    snapshots: [],
    recovery: {
      lastRunAtMs: 0,
      lastSummary: null,
    },
    createdAtMs: nowMs,
    updatedAtMs: nowMs,
  };
}

function withChecksum(state: Record<string, any>) {
  const next = cloneValue(state);
  next.checksum = "";
  next.checksum = checksum(next);
  return next;
}

function validateRoot(state: Record<string, any>) {
  if (!state || typeof state !== "object" || Array.isArray(state)) {
    throw new Error("NPC runtime persistence root is unavailable");
  }
  if (state.schemaVersion !== SCHEMA_VERSION) {
    throw new Error(
      `Unsupported NPC runtime persistence schema ${String(state.schemaVersion)}`,
    );
  }
  for (const key of ["jobs", "leases", "operations", "quarantine"]) {
    if (!state[key] || typeof state[key] !== "object" || Array.isArray(state[key])) {
      throw new Error(`Corrupt NPC runtime persistence ${key}`);
    }
  }
  if (!Array.isArray(state.snapshots)) {
    throw new Error("Corrupt NPC runtime persistence snapshots");
  }
  const expected = String(state.checksum || "");
  const copy = cloneValue(state);
  copy.checksum = "";
  if (expected && checksum(copy) !== expected) {
    throw new Error("NPC runtime persistence checksum mismatch");
  }
  // Schema v1 roots written before assembly-signal consumption did not carry
  // cursors. Add the field only after validating the stored checksum so this
  // is a compatible in-memory migration rather than a way around corruption.
  if (state.assemblySignalCursors == null) state.assemblySignalCursors = {};
  if (typeof state.assemblySignalCursors !== "object" ||
      Array.isArray(state.assemblySignalCursors)) {
    throw new Error("Corrupt NPC runtime persistence assembly signal cursors");
  }
  return state;
}

function readRoot(options: Record<string, any> = {}) {
  const read = database.read(TABLE, "/");
  const empty = !read.success || !read.data ||
    (typeof read.data === "object" && Object.keys(read.data).length === 0);
  if (empty) {
    if (options.initialize !== true) {
      return null;
    }
    const initial = withChecksum(buildRoot());
    const write = database.write(TABLE, "/", initial, { force: true });
    if (!write.success) throw new Error("NPC runtime persistence initialization failed");
    const flush = database.flushTableSync(TABLE);
    if (!flush.success) throw new Error("NPC runtime persistence initialization could not be flushed");
    return initial;
  }
  return validateRoot(cloneValue(read.data));
}

function writeRoot(state: Record<string, any>, options: Record<string, any> = {}) {
  const next = withChecksum({
    ...state,
    schemaVersion: SCHEMA_VERSION,
    revision: Math.max(0, Number(state.revision) || 0),
    updatedAtMs: Date.now(),
  });
  const write = database.write(TABLE, "/", next, { force: true });
  if (!write.success) throw new Error("NPC runtime persistence write failed");
  if (options.flush !== false) {
    const flush = database.flushTableSync(TABLE);
    if (!flush.success) throw new Error("NPC runtime persistence write could not be flushed");
  }
  return cloneValue(next);
}

function mutateRoot(
  updater: (draft: Record<string, any>) => any,
  options: Record<string, any> = {},
) {
  const current = readRoot({ initialize: true });
  const draft = cloneValue(current);
  const value = updater(draft);
  draft.revision = Math.max(0, Number(current.revision) || 0) + 1;
  const state = writeRoot(draft, options);
  return { state, value };
}

function flushTables(tables: string[]) {
  const unique = [...new Set((tables || []).filter(Boolean))];
  if (unique.length === 0) return;
  const result = database.flushTablesSync(unique);
  if (!result.success) {
    throw new Error(`NPC persistence flush failed for ${unique.join(", ")}`);
  }
}

function initializeNpcRuntimePersistence(options: Record<string, any> = {}) {
  if (initialized) return getPersistenceStatus();
  const previous = readRoot({ initialize: true });
  mutateRoot((draft) => {
    const previousInstanceID = draft.server && draft.server.instanceID;
    const previousCleanShutdown = draft.server && draft.server.cleanShutdown === true;
    draft.server = {
      instanceID: serverInstanceID,
      generation: Math.max(0, Number(draft.server && draft.server.generation) || 0) + 1,
      cleanShutdown: false,
      startedAtMs: Date.now(),
      shutdownAtMs: 0,
      shutdownReason: null,
      previousInstanceID: previousInstanceID || null,
      previousCleanShutdown,
    };
    // A server restart is an authoritative lease boundary. Leases never grant
    // rights across generations; identity records remain authoritative.
    draft.leases = {};
  });
  initialized = true;
  acceptingNewWork = true;
  if (options.reconcile !== false) {
    reconcileNativeNpcPersistence({
      previousCleanShutdown: previous.server && previous.server.cleanShutdown === true,
    });
  }
  return getPersistenceStatus();
}

function getPersistenceStatus() {
  const state = readRoot({ initialize: true });
  return {
    success: true,
    data: {
      schemaVersion: state.schemaVersion,
      revision: state.revision,
      server: cloneValue(state.server),
      jobCount: Object.keys(state.jobs).length,
      supportIncidentCount: Object.keys(state.supportIncidents || {}).length,
      assemblySignalCursorCount: Object.keys(state.assemblySignalCursors || {}).length,
      leaseCount: Object.keys(state.leases).length,
      operationCount: Object.keys(state.operations).length,
      quarantineCount: Object.keys(state.quarantine).length,
      snapshotCount: state.snapshots.length,
      recovery: cloneValue(state.recovery),
      acceptingNewWork,
    },
  };
}

function normalizeJobInput(input: Record<string, any>) {
  const npcCharacterID = toPositiveInt(input && input.npcCharacterID, 0);
  const incarnation = toPositiveInt(input && input.incarnation, 0);
  const jobType = String(input && input.jobType || "").trim().toLowerCase();
  if (!npcCharacterID || !incarnation || !jobType || !/^[a-z0-9][a-z0-9_.:-]{0,127}$/.test(jobType)) {
    throw new Error("NPC job requires a character, incarnation, and valid job type");
  }
  return { npcCharacterID, incarnation, jobType };
}

function createNpcJob(input: Record<string, any>) {
  if (!acceptingNewWork) throw new Error("NPC persistence shutdown is in progress");
  initializeNpcRuntimePersistence();
  const normalized = normalizeJobInput(input);
  const idempotencyKey = String(input.idempotencyKey || "").trim();
  const nowMs = Date.now();
  const result = mutateRoot((draft) => {
    if (idempotencyKey) {
      const existing = Object.values<any>(draft.jobs).find(
        (job) => job.npcCharacterID === normalized.npcCharacterID &&
          job.idempotencyKey === idempotencyKey,
      );
      if (existing) return cloneValue(existing);
    }
    const active = Object.values<any>(draft.jobs).find(
      (job) => job.npcCharacterID === normalized.npcCharacterID &&
        NONTERMINAL_JOB_STATUSES.has(job.status),
    );
    if (active && input.allowConcurrent !== true) {
      throw new Error(`NPC ${normalized.npcCharacterID} already has active job ${active.jobID}`);
    }
    const jobID = String(input.jobID || randomUUID()).trim();
    if (!jobID || draft.jobs[jobID]) throw new Error("NPC job ID already exists");
    const job = {
      schemaVersion: SCHEMA_VERSION,
      recordRevision: 1,
      jobID,
      npcCharacterID: normalized.npcCharacterID,
      incarnation: normalized.incarnation,
      jobType: normalized.jobType,
      status: "queued",
      step: String(input.step || "queued"),
      target: cloneValue(input.target || null),
      payload: cloneValue(input.payload || {}),
      checkpoint: cloneValue(input.checkpoint || {}),
      reservations: cloneValue(input.reservations || []),
      retryCount: 0,
      nextWakeAtMs: Math.max(0, Number(input.nextWakeAtMs) || 0),
      lastError: null,
      idempotencyKey: idempotencyKey || null,
      claimToken: null,
      createdAtMs: nowMs,
      updatedAtMs: nowMs,
      completedAtMs: 0,
    };
    draft.jobs[jobID] = job;
    return cloneValue(job);
  });
  return { success: true, data: result.value };
}

function getNpcJob(jobID: string) {
  const state = readRoot({ initialize: true });
  return cloneValue(state.jobs[String(jobID || "").trim()] || null);
}

function listNpcJobs(filters: Record<string, any> = {}) {
  const state = readRoot({ initialize: true });
  const characterID = toPositiveInt(filters.npcCharacterID, 0);
  const statuses = Array.isArray(filters.statuses)
    ? new Set(filters.statuses.map((value) => String(value)))
    : null;
  return Object.values<any>(state.jobs)
    .filter((job) => !characterID || job.npcCharacterID === characterID)
    .filter((job) => !statuses || statuses.has(job.status))
    .sort((left, right) => left.createdAtMs - right.createdAtMs)
    .map(cloneValue);
}

function getActiveNpcJob(npcCharacterID: number, incarnation = 0) {
  return listNpcJobs({ npcCharacterID, statuses: [...ACTIVE_JOB_STATUSES] })
    .filter((job) => !incarnation || job.incarnation === incarnation)
    .sort((left, right) => left.createdAtMs - right.createdAtMs)[0] || null;
}

function normalizeAssemblySignalIdentity(input: Record<string, any>) {
  const observerID = String(input && input.observerID || "").trim().toLowerCase();
  const assemblyID = toPositiveInt(input && input.assemblyID, 0);
  const signalType = String(input && input.signalType || "").trim().toLowerCase();
  const valid = /^[a-z0-9][a-z0-9_.:/-]{0,255}$/;
  if (!observerID || !valid.test(observerID) || !assemblyID ||
      !signalType || !valid.test(signalType)) {
    throw new Error("NPC assembly signal cursor identity is invalid");
  }
  return {
    observerID,
    assemblyID,
    signalType,
    cursorID: checksum([observerID, assemblyID, signalType]).slice(0, 40),
  };
}

function newAssemblySignalCursor(identity: Record<string, any>, nowMs = Date.now()) {
  return {
    schemaVersion: SCHEMA_VERSION,
    recordRevision: 0,
    cursorID: identity.cursorID,
    observerID: identity.observerID,
    assemblyID: identity.assemblyID,
    signalType: identity.signalType,
    lastScannedSequence: 0,
    lastAppliedSequence: 0,
    lastAppliedRevision: 0,
    lastStatusFingerprint: null,
    lastMode: null,
    resnapshotCount: 0,
    createdAtMs: nowMs,
    updatedAtMs: nowMs,
  };
}

function getNpcAssemblySignalCursor(input: Record<string, any>) {
  const identity = normalizeAssemblySignalIdentity(input);
  const state = readRoot({ initialize: true });
  return cloneValue(state.assemblySignalCursors?.[identity.cursorID] || null);
}

function listNpcAssemblySignalCursors(filters: Record<string, any> = {}) {
  const state = readRoot({ initialize: true });
  const observerID = filters.observerID == null
    ? null : String(filters.observerID).trim().toLowerCase();
  const assemblyID = filters.assemblyID == null
    ? 0 : toPositiveInt(filters.assemblyID, 0);
  const signalType = filters.signalType == null
    ? null : String(filters.signalType).trim().toLowerCase();
  return Object.values<any>(state.assemblySignalCursors || {})
    .filter((cursor) => observerID == null || cursor.observerID === observerID)
    .filter((cursor) => !assemblyID || cursor.assemblyID === assemblyID)
    .filter((cursor) => signalType == null || cursor.signalType === signalType)
    .sort((left, right) => left.cursorID.localeCompare(right.cursorID))
    .map(cloneValue);
}

function signalCheckpoint(jobSignal: Record<string, any>) {
  return {
    cursorID: jobSignal.cursorID,
    observerID: jobSignal.observerID,
    assemblyID: jobSignal.assemblyID,
    signalType: jobSignal.signalType,
    sequence: jobSignal.sequence,
    revision: jobSignal.revision,
    statusFingerprint: jobSignal.statusFingerprint,
    mode: jobSignal.mode,
  };
}

/**
 * Create or reprioritize the one job associated with a signal problem class.
 * This helper runs inside the same root mutation as cursor advancement; it
 * must never call the public create/update functions and start a second write.
 */
function applyAssemblySignalJobInDraft(
  draft: Record<string, any>,
  input: Record<string, any> | null,
  jobSignal: Record<string, any>,
  nowMs: number,
) {
  if (!input) return null;
  const normalized = normalizeJobInput(input);
  const idempotencyKey = String(input.idempotencyKey || "").trim();
  if (!idempotencyKey || idempotencyKey.length > 256) {
    throw new Error("NPC assembly signal job requires an idempotency key");
  }
  const existing = Object.values<any>(draft.jobs).find((job) =>
    job.npcCharacterID === normalized.npcCharacterID &&
    job.idempotencyKey === idempotencyKey,
  ) || null;
  const checkpoint = {
    ...(existing && existing.checkpoint || {}),
    ...(cloneValue(input.checkpoint || {})),
    assemblySignal: signalCheckpoint(jobSignal),
  };
  if (existing) {
    if (existing.incarnation !== normalized.incarnation ||
        existing.jobType !== normalized.jobType) {
      throw new Error("NPC assembly signal job idempotency binding changed");
    }
    if (TERMINAL_JOB_STATUSES.has(existing.status)) return cloneValue(existing);
    existing.target = Object.prototype.hasOwnProperty.call(input, "target")
      ? cloneValue(input.target) : existing.target;
    existing.payload = {
      ...(existing.payload || {}),
      ...(cloneValue(input.payload || {})),
    };
    existing.checkpoint = checkpoint;
    existing.step = String(input.step || existing.step || "signal-observed");
    if (input.priority != null) existing.priority = Number(input.priority);
    if (input.wake !== false && existing.status === "suspended") {
      existing.status = "queued";
      existing.claimToken = null;
    }
    existing.nextWakeAtMs = input.nextWakeAtMs == null
      ? (input.wake === false ? existing.nextWakeAtMs : 0)
      : Math.max(0, Number(input.nextWakeAtMs) || 0);
    existing.lastError = null;
    existing.recordRevision = Math.max(0, Number(existing.recordRevision) || 0) + 1;
    existing.updatedAtMs = nowMs;
    return cloneValue(existing);
  }
  const active = Object.values<any>(draft.jobs).find((job) =>
    job.npcCharacterID === normalized.npcCharacterID &&
    NONTERMINAL_JOB_STATUSES.has(job.status),
  );
  if (active && input.allowConcurrent !== true) {
    throw new Error(`NPC ${normalized.npcCharacterID} already has active job ${active.jobID}`);
  }
  const jobID = String(input.jobID || randomUUID()).trim();
  if (!jobID || draft.jobs[jobID]) throw new Error("NPC job ID already exists");
  const job = {
    schemaVersion: SCHEMA_VERSION,
    recordRevision: 1,
    jobID,
    npcCharacterID: normalized.npcCharacterID,
    incarnation: normalized.incarnation,
    jobType: normalized.jobType,
    status: "queued",
    step: String(input.step || "signal-observed"),
    target: cloneValue(input.target || null),
    payload: cloneValue(input.payload || {}),
    checkpoint,
    reservations: cloneValue(input.reservations || []),
    priority: input.priority == null ? null : Number(input.priority),
    retryCount: 0,
    nextWakeAtMs: Math.max(0, Number(input.nextWakeAtMs) || 0),
    lastError: null,
    idempotencyKey,
    claimToken: null,
    createdAtMs: nowMs,
    updatedAtMs: nowMs,
    completedAtMs: 0,
  };
  draft.jobs[jobID] = job;
  return cloneValue(job);
}

/**
 * Atomically checkpoint one relevant assembly status observation and its
 * resulting durable job. Exact replays do not create another job. A canonical
 * resnapshot is the only mode allowed to skip a missing journal range.
 */
function applyNpcAssemblySignalCheckpoint(input: Record<string, any>) {
  if (!acceptingNewWork) return { success: false, errorMsg: "NPC_PERSISTENCE_SHUTTING_DOWN" };
  initializeNpcRuntimePersistence();
  const identity = normalizeAssemblySignalIdentity(input);
  const mode = String(input.mode || "incremental").trim().toLowerCase();
  if (mode !== "incremental" && mode !== "resnapshot") {
    throw new Error("NPC assembly signal checkpoint mode is invalid");
  }
  const sequence = Math.max(0, Math.trunc(Number(input.sequence) || 0));
  const scannedSequence = Math.max(sequence, Math.trunc(Number(input.scannedSequence) || 0));
  const revision = Math.max(0, Math.trunc(Number(input.revision) || 0));
  if ((mode === "incremental" && (!sequence || !revision)) ||
      (mode === "resnapshot" && !input.canonical)) {
    throw new Error("NPC assembly signal checkpoint is incomplete");
  }
  const status = cloneValue(input.status ?? null);
  const statusFingerprint = checksum(status);
  const nowMs = Number.isFinite(Number(input.nowMs))
    ? Math.max(0, Number(input.nowMs)) : Date.now();
  const result = mutateRoot((draft) => {
    draft.assemblySignalCursors ||= {};
    const current = draft.assemblySignalCursors[identity.cursorID] ||
      newAssemblySignalCursor(identity, nowMs);
    if (input.expectedCursorRevision != null &&
        Number(input.expectedCursorRevision) !== current.recordRevision) {
      throw new Error("NPC assembly signal cursor revision conflict");
    }
    if (sequence < current.lastAppliedSequence ||
        scannedSequence < current.lastScannedSequence ||
        revision < current.lastAppliedRevision) {
      throw new Error("NPC assembly signal cursor cannot move backwards");
    }
    if (sequence === current.lastAppliedSequence) {
      const exact = revision === current.lastAppliedRevision &&
        statusFingerprint === current.lastStatusFingerprint;
      if (!exact) throw new Error("NPC assembly signal replay conflicts with persisted state");
      if (scannedSequence > current.lastScannedSequence || mode === "resnapshot") {
        const replayCursor = {
          ...current,
          lastScannedSequence: scannedSequence,
          lastMode: mode,
          resnapshotCount: Math.max(0, Number(current.resnapshotCount) || 0) +
            (mode === "resnapshot" ? 1 : 0),
          recordRevision: Math.max(0, Number(current.recordRevision) || 0) + 1,
          updatedAtMs: nowMs,
        };
        draft.assemblySignalCursors[identity.cursorID] = replayCursor;
        return {
          success: true,
          applied: false,
          replayed: true,
          cursor: cloneValue(replayCursor),
          job: null,
        };
      }
      return { success: true, applied: false, replayed: true, cursor: cloneValue(current), job: null };
    }
    if (revision === current.lastAppliedRevision && current.lastAppliedSequence > 0 &&
        statusFingerprint !== current.lastStatusFingerprint) {
      throw new Error("NPC assembly signal revision reused different state");
    }
    const jobSignal = {
      ...identity,
      sequence,
      revision,
      statusFingerprint,
      mode,
    };
    const job = applyAssemblySignalJobInDraft(draft, input.job || null, jobSignal, nowMs);
    const cursor = {
      ...current,
      ...identity,
      schemaVersion: SCHEMA_VERSION,
      recordRevision: Math.max(0, Number(current.recordRevision) || 0) + 1,
      lastScannedSequence: scannedSequence,
      lastAppliedSequence: sequence,
      lastAppliedRevision: revision,
      lastStatusFingerprint: statusFingerprint,
      lastMode: mode,
      resnapshotCount: Math.max(0, Number(current.resnapshotCount) || 0) +
        (mode === "resnapshot" ? 1 : 0),
      updatedAtMs: nowMs,
    };
    draft.assemblySignalCursors[identity.cursorID] = cursor;
    return { success: true, applied: true, replayed: false, cursor: cloneValue(cursor), job };
  });
  return result.value;
}

/** Advance past journal entries irrelevant to this signal type. */
function advanceNpcAssemblySignalCursor(input: Record<string, any>) {
  initializeNpcRuntimePersistence();
  const identity = normalizeAssemblySignalIdentity(input);
  const sequence = Math.max(0, Math.trunc(Number(input.sequence) || 0));
  const nowMs = Number.isFinite(Number(input.nowMs))
    ? Math.max(0, Number(input.nowMs)) : Date.now();
  const result = mutateRoot((draft) => {
    draft.assemblySignalCursors ||= {};
    const current = draft.assemblySignalCursors[identity.cursorID] ||
      newAssemblySignalCursor(identity, nowMs);
    if (sequence < current.lastScannedSequence) {
      throw new Error("NPC assembly signal cursor cannot move backwards");
    }
    if (sequence === current.lastScannedSequence) {
      return { success: true, advanced: false, data: cloneValue(current) };
    }
    current.lastScannedSequence = sequence;
    current.recordRevision = Math.max(0, Number(current.recordRevision) || 0) + 1;
    current.updatedAtMs = nowMs;
    draft.assemblySignalCursors[identity.cursorID] = current;
    return { success: true, advanced: true, data: cloneValue(current) };
  });
  return result.value;
}

/**
 * Pull one page from an assembly journal. The adapters keep this Phase 0 code
 * independent of the Frontier service while making restart recovery reusable
 * by Phase 3 command nodes and the Phase 6 faction planner.
 */
async function reconcileNpcAssemblySignalJournal(input: Record<string, any>) {
  const identity = normalizeAssemblySignalIdentity(input);
  if (typeof input.listSignals !== "function" ||
      typeof input.getOperationalStatus !== "function") {
    throw new Error("NPC assembly signal reconciliation requires journal adapters");
  }
  const cursor = getNpcAssemblySignalCursor(identity) || newAssemblySignalCursor(identity);
  const listed = await input.listSignals(identity.assemblyID, {
    ...(cloneValue(input.listOptions || {})),
    afterSequence: cursor.lastScannedSequence,
    limit: Math.max(1, Math.min(1_000, toPositiveInt(input.limit, 100))),
  });
  if (!listed || listed.success === false || !listed.data) {
    return listed || { success: false, errorMsg: "NPC_ASSEMBLY_SIGNAL_LIST_FAILED" };
  }
  const journal = listed.data;
  const plan = typeof input.planObservation === "function"
    ? input.planObservation : async () => null;
  if (journal.truncated === true) {
    const current = await input.getOperationalStatus(identity.assemblyID, {
      ...(cloneValue(input.statusOptions || {})),
      signalType: identity.signalType,
    });
    if (!current || current.success === false || !current.data) {
      return { success: false, errorMsg: "NPC_ASSEMBLY_SIGNAL_RESNAPSHOT_REQUIRED" };
    }
    const observation = {
      mode: "resnapshot",
      canonical: true,
      sequence: Math.max(0, Math.trunc(Number(current.data.updatedSequence) || 0)),
      scannedSequence: Math.max(
        Math.max(0, Math.trunc(Number(current.data.updatedSequence) || 0)),
        Math.max(0, Math.trunc(Number(journal.oldestSequence) || 0) - 1),
      ),
      revision: Math.max(0, Math.trunc(Number(current.data.revision) || 0)),
      status: cloneValue(current.data.status),
    };
    if (!observation.sequence || !observation.revision) {
      return { success: false, errorMsg: "NPC_ASSEMBLY_SIGNAL_RESNAPSHOT_INVALID" };
    }
    const job = await plan(cloneValue(observation), cloneValue(cursor));
    const applied = applyNpcAssemblySignalCheckpoint({ ...identity, ...observation, job });
    return { success: true, resnapshotted: true, processed: applied.applied ? 1 : 0, data: applied };
  }
  let processed = 0;
  let latest: any = null;
  const signals = Array.isArray(journal.signals) ? journal.signals.slice() : [];
  signals.sort((left, right) => Number(left.sequence) - Number(right.sequence));
  for (const signal of signals) {
    if (signal?.kind !== "status_changed" ||
        String(signal?.detail?.signalType || "").trim().toLowerCase() !== identity.signalType) {
      continue;
    }
    const observation = {
      mode: "incremental",
      sequence: Math.max(0, Math.trunc(Number(signal.sequence) || 0)),
      revision: Math.max(0, Math.trunc(Number(signal.revision) || 0)),
      status: cloneValue(signal.detail.current),
    };
    const job = await plan(cloneValue(observation), cloneValue(
      getNpcAssemblySignalCursor(identity) || cursor,
    ));
    latest = applyNpcAssemblySignalCheckpoint({ ...identity, ...observation, job });
    if (latest.applied) processed += 1;
  }
  const persistedCursor = getNpcAssemblySignalCursor(identity) || cursor;
  const nextSequence = Math.max(
    persistedCursor.lastScannedSequence,
    Math.trunc(Number(journal.nextSequence) || 0),
  );
  const advanced = advanceNpcAssemblySignalCursor({ ...identity, sequence: nextSequence });
  return { success: true, resnapshotted: false, processed, data: latest, cursor: advanced.data };
}

function normalizeReservationKey(value: unknown) {
  const key = String(value || "").trim().toLowerCase();
  if (!key || key.length > 256 || !/^[a-z0-9][a-z0-9_.:/-]*$/.test(key)) {
    throw new Error("NPC reservation requires a valid resource key");
  }
  return key;
}

function pruneExpiredReservationsInDraft(draft: Record<string, any>, nowMs: number) {
  let pruned = 0;
  for (const job of Object.values<any>(draft.jobs)) {
    const reservations = Array.isArray(job.reservations) ? job.reservations : [];
    const retained = reservations.filter((reservation) => {
      const expiresAtMs = Math.max(0, Number(reservation && reservation.expiresAtMs) || 0);
      const keep = expiresAtMs === 0 || expiresAtMs > nowMs;
      if (!keep) pruned += 1;
      return keep;
    });
    if (retained.length !== reservations.length) {
      job.reservations = retained;
      job.recordRevision = Math.max(0, Number(job.recordRevision) || 0) + 1;
      job.updatedAtMs = Date.now();
    }
  }
  return pruned;
}

/**
 * Atomically acquire or renew a durable resource claim. Reservations live on
 * the job record so a process crash cannot make two NPCs consume or deliver
 * the same target while the work journal is being replayed.
 */
function acquireNpcJobReservation(jobID: string, input: Record<string, any>) {
  initializeNpcRuntimePersistence();
  const normalizedJobID = String(jobID || "").trim();
  const resourceKey = normalizeReservationKey(input && input.resourceKey);
  const nowMs = Number.isFinite(Number(input && input.nowMs))
    ? Math.max(0, Number(input.nowMs))
    : Date.now();
  const ttlMs = Math.max(1_000, Number(input && input.ttlMs) || 60_000);
  const result = mutateRoot((draft) => {
    pruneExpiredReservationsInDraft(draft, nowMs);
    const job = draft.jobs[normalizedJobID];
    if (!job) return { success: false, errorMsg: "NPC_JOB_NOT_FOUND" };
    if (!ACTIVE_JOB_STATUSES.has(job.status)) {
      return { success: false, errorMsg: "NPC_JOB_NOT_ACTIVE" };
    }
    const existing = (Array.isArray(job.reservations) ? job.reservations : [])
      .find((reservation) => reservation.resourceKey === resourceKey) || null;
    const exclusive = input && input.exclusive !== false;
    if (!existing && exclusive) {
      const conflict = Object.values<any>(draft.jobs).find((candidate) =>
        candidate.jobID !== normalizedJobID &&
        ACTIVE_JOB_STATUSES.has(candidate.status) &&
        (Array.isArray(candidate.reservations) ? candidate.reservations : []).some(
          (reservation) => reservation.resourceKey === resourceKey && reservation.exclusive !== false,
        ));
      if (conflict) {
        return {
          success: false,
          errorMsg: "NPC_RESOURCE_RESERVED",
          data: { jobID: conflict.jobID, npcCharacterID: conflict.npcCharacterID },
        };
      }
    }
    const reservation = {
      schemaVersion: SCHEMA_VERSION,
      reservationID: existing && existing.reservationID || randomUUID(),
      jobID: normalizedJobID,
      npcCharacterID: job.npcCharacterID,
      incarnation: job.incarnation,
      resourceKey,
      kind: String(input && input.kind || existing && existing.kind || "resource")
        .trim().toLowerCase(),
      target: cloneValue(
        Object.prototype.hasOwnProperty.call(input || {}, "target")
          ? input.target
          : existing && existing.target || null,
      ),
      metadata: cloneValue({
        ...(existing && existing.metadata || {}),
        ...(input && input.metadata || {}),
      }),
      exclusive,
      acquiredAtMs: existing && existing.acquiredAtMs || nowMs,
      renewedAtMs: nowMs,
      expiresAtMs: nowMs + ttlMs,
    };
    const reservations = (Array.isArray(job.reservations) ? job.reservations : [])
      .filter((candidate) => candidate.resourceKey !== resourceKey);
    reservations.push(reservation);
    job.reservations = reservations;
    job.recordRevision = Math.max(0, Number(job.recordRevision) || 0) + 1;
    job.updatedAtMs = Date.now();
    return { success: true, data: cloneValue(reservation) };
  });
  return result.value;
}

function listNpcJobReservations(jobID: string, options: Record<string, any> = {}) {
  const job = getNpcJob(jobID);
  if (!job) return [];
  const nowMs = Number.isFinite(Number(options.nowMs))
    ? Math.max(0, Number(options.nowMs))
    : Date.now();
  return (Array.isArray(job.reservations) ? job.reservations : [])
    .filter((reservation) => options.includeExpired === true ||
      Math.max(0, Number(reservation.expiresAtMs) || 0) === 0 ||
      Number(reservation.expiresAtMs) > nowMs)
    .map(cloneValue);
}

function releaseNpcJobReservation(jobID: string, resourceKey: string) {
  initializeNpcRuntimePersistence();
  const normalizedJobID = String(jobID || "").trim();
  const normalizedKey = normalizeReservationKey(resourceKey);
  const result = mutateRoot((draft) => {
    const job = draft.jobs[normalizedJobID];
    if (!job) return { success: false, errorMsg: "NPC_JOB_NOT_FOUND" };
    const previous = Array.isArray(job.reservations) ? job.reservations : [];
    const retained = previous.filter((reservation) => reservation.resourceKey !== normalizedKey);
    if (retained.length === previous.length) return { success: true, released: false };
    job.reservations = retained;
    job.recordRevision = Math.max(0, Number(job.recordRevision) || 0) + 1;
    job.updatedAtMs = Date.now();
    return { success: true, released: true };
  });
  return result.value;
}

function releaseNpcJobReservations(jobID: string) {
  initializeNpcRuntimePersistence();
  const normalizedJobID = String(jobID || "").trim();
  const result = mutateRoot((draft) => {
    const job = draft.jobs[normalizedJobID];
    if (!job) return { success: false, errorMsg: "NPC_JOB_NOT_FOUND" };
    const released = Array.isArray(job.reservations) ? job.reservations.length : 0;
    if (released > 0) {
      job.reservations = [];
      job.recordRevision = Math.max(0, Number(job.recordRevision) || 0) + 1;
      job.updatedAtMs = Date.now();
    }
    return { success: true, released };
  });
  return result.value;
}

function retireStaleNpcJobs(npcCharacterID: number, incarnation: number) {
  const characterID = toPositiveInt(npcCharacterID, 0);
  const currentIncarnation = toPositiveInt(incarnation, 0);
  if (!characterID || !currentIncarnation) return { success: false, errorMsg: "NPC_JOB_IDENTITY_REQUIRED" };
  initializeNpcRuntimePersistence();
  const state = readRoot({ initialize: true });
  const stale = Object.values<any>(state.jobs).filter((job) =>
    job.npcCharacterID === characterID &&
    job.incarnation !== currentIncarnation &&
    NONTERMINAL_JOB_STATUSES.has(job.status),
  );
  if (stale.length === 0) return { success: true, data: [] };
  const result = mutateRoot((draft) => {
    const retired: any[] = [];
    for (const job of stale) {
      const current = draft.jobs[job.jobID];
      if (!current || !NONTERMINAL_JOB_STATUSES.has(current.status)) continue;
      const nowMs = Date.now();
      draft.jobs[job.jobID] = {
        ...current,
        status: "cancelled",
        step: "stale-incarnation",
        lastError: "NPC_JOB_STALE_INCARNATION",
        claimToken: null,
        reservations: [],
        recordRevision: current.recordRevision + 1,
        updatedAtMs: nowMs,
        completedAtMs: nowMs,
      };
      retired.push(cloneValue(draft.jobs[job.jobID]));
    }
    return retired;
  });
  return { success: true, data: result.value };
}

function updateNpcJob(jobID: string, patch: Record<string, any>, options: Record<string, any> = {}) {
  initializeNpcRuntimePersistence();
  const normalizedID = String(jobID || "").trim();
  const result = mutateRoot((draft) => {
    const current = draft.jobs[normalizedID];
    if (!current) throw new Error("NPC job not found");
    if (options.expectedRevision != null && Number(options.expectedRevision) !== current.recordRevision) {
      throw new Error("NPC job revision conflict");
    }
    if (TERMINAL_JOB_STATUSES.has(current.status) && options.allowTerminalMutation !== true) {
      throw new Error("NPC job is already terminal");
    }
    const nextStatus = patch.status == null ? current.status : String(patch.status);
    if (![...NONTERMINAL_JOB_STATUSES, ...TERMINAL_JOB_STATUSES].includes(nextStatus)) {
      throw new Error("NPC job status is invalid");
    }
    const nowMs = Date.now();
    const next = {
      ...current,
      ...cloneValue(patch),
      jobID: current.jobID,
      npcCharacterID: current.npcCharacterID,
      incarnation: current.incarnation,
      jobType: current.jobType,
      schemaVersion: SCHEMA_VERSION,
      status: nextStatus,
      recordRevision: current.recordRevision + 1,
      updatedAtMs: nowMs,
      completedAtMs: TERMINAL_JOB_STATUSES.has(nextStatus)
        ? (current.completedAtMs || nowMs)
        : 0,
      reservations: TERMINAL_JOB_STATUSES.has(nextStatus)
        ? []
        : cloneValue(patch.reservations ?? current.reservations ?? []),
    };
    draft.jobs[normalizedID] = next;
    return cloneValue(next);
  });
  return { success: true, data: result.value };
}

function claimNpcJob(jobID: string, options: Record<string, any> = {}) {
  const token = randomUUID();
  const job = updateNpcJob(jobID, {
    status: "running",
    claimToken: token,
    claimedAtMs: Date.now(),
    claimedBy: String(options.claimedBy || serverInstanceID),
  }, options).data;
  return { success: true, data: job };
}

function normalizeSupportIncidentInput(input: Record<string, any>) {
  const requestingNpcCharacterID = toPositiveInt(input && input.requestingNpcCharacterID, 0);
  const requestingNpcIncarnation = toPositiveInt(input && input.requestingNpcIncarnation, 0);
  const requesterEntityID = toPositiveInt(input && input.requesterEntityID, 0);
  const factionKey = String(input && input.factionKey || "").trim().toLowerCase();
  const systemID = toPositiveInt(input && input.systemID, 0);
  const deduplicationID = String(input && input.deduplicationID || "").trim().toLowerCase();
  if (!requestingNpcCharacterID || !requestingNpcIncarnation || !requesterEntityID ||
      !systemID || !factionKey || factionKey.length > 128 ||
      !deduplicationID || deduplicationID.length > 256) {
    throw new Error("NPC support incident identity is invalid");
  }
  return {
    requestingNpcCharacterID,
    requestingNpcIncarnation,
    requesterEntityID,
    factionKey,
    systemID,
    deduplicationID,
  };
}

function expireSupportIncidentsInDraft(draft: Record<string, any>, nowMs: number) {
  draft.supportIncidents ||= {};
  let expired = 0;
  for (const incident of Object.values<any>(draft.supportIncidents)) {
    if (incident.status !== "active" || Number(incident.expiresAtMs) > nowMs) continue;
    incident.status = "expired";
    incident.resolvedAtMs = nowMs;
    incident.resolution = "expired";
    incident.recordRevision = Math.max(0, Number(incident.recordRevision) || 0) + 1;
    incident.updatedAtMs = Date.now();
    expired += 1;
  }
  return expired;
}

/** Persist one deduplicated, group-cooled tactical support request. */
function createOrGetNpcSupportIncident(input: Record<string, any>) {
  if (!acceptingNewWork) return { success: false, errorMsg: "NPC_PERSISTENCE_SHUTTING_DOWN" };
  initializeNpcRuntimePersistence();
  const normalized = normalizeSupportIncidentInput(input);
  const nowMs = Number.isFinite(Number(input.nowMs)) ? Math.max(0, Number(input.nowMs)) : Date.now();
  const ttlMs = Math.max(1_000, Number(input.ttlMs) || 120_000);
  const cooldownMs = Math.max(1_000, Number(input.cooldownMs) || 60_000);
  const supportGroupID = String(input.supportGroupID || normalized.factionKey).trim().toLowerCase()
    .slice(0, 256) || normalized.factionKey;
  const cooldownKey = checksum([normalized.factionKey, supportGroupID]).slice(0, 40);
  const result = mutateRoot((draft) => {
    draft.supportIncidents ||= {};
    draft.supportCooldowns ||= {};
    expireSupportIncidentsInDraft(draft, nowMs);
    for (const [key, cooldown] of Object.entries<any>(draft.supportCooldowns)) {
      if (Number(cooldown && cooldown.expiresAtMs) <= nowMs) delete draft.supportCooldowns[key];
    }
    const existing = Object.values<any>(draft.supportIncidents).find((incident) =>
      incident.factionKey === normalized.factionKey &&
      incident.deduplicationID === normalized.deduplicationID &&
      incident.status === "active" &&
      Number(incident.expiresAtMs) > nowMs,
    );
    if (existing) {
      return { success: true, data: { incident: cloneValue(existing), created: false } };
    }
    const cooldown = draft.supportCooldowns[cooldownKey];
    if (cooldown && Number(cooldown.expiresAtMs) > nowMs) {
      return {
        success: false,
        errorMsg: "NPC_SUPPORT_GROUP_COOLDOWN",
        data: {
          retryAtMs: Number(cooldown.expiresAtMs),
          incidentID: cooldown.incidentID || null,
        },
      };
    }
    const incidentID = String(input.incidentID || randomUUID()).trim().toLowerCase();
    if (!incidentID || draft.supportIncidents[incidentID]) {
      throw new Error("NPC support incident ID already exists");
    }
    const incident = {
      schemaVersion: SCHEMA_VERSION,
      recordRevision: 1,
      incidentID,
      deduplicationID: normalized.deduplicationID,
      requestingNpcCharacterID: normalized.requestingNpcCharacterID,
      requestingNpcIncarnation: normalized.requestingNpcIncarnation,
      requesterEntityID: normalized.requesterEntityID,
      factionKey: normalized.factionKey,
      threatTargetID: toPositiveInt(input.threatTargetID, 0) || null,
      threatOwnerID: toPositiveInt(input.threatOwnerID, 0) || null,
      severity: String(input.severity || "moderate").trim().toLowerCase(),
      requiredRoles: Array.isArray(input.requiredRoles)
        ? [...new Set(input.requiredRoles.map((role) => String(role || "").trim().toLowerCase()).filter(Boolean))]
        : [],
      systemID: normalized.systemID,
      position: cloneValue(input.position || { x: 0, y: 0, z: 0 }),
      supportGroupID,
      authorization: cloneValue(input.authorization || null),
      policy: cloneValue(input.policy || {}),
      maximumResponderCount: Math.max(1, Math.min(64, toPositiveInt(input.maximumResponderCount, 3))),
      responderAssignments: [],
      status: "active",
      createdAtMs: nowMs,
      updatedAtMs: nowMs,
      expiresAtMs: nowMs + ttlMs,
      cooldownUntilMs: nowMs + cooldownMs,
      resolvedAtMs: 0,
      resolution: null,
    };
    const terminalIncidents = Object.values<any>(draft.supportIncidents)
      .filter((candidate) => candidate.status !== "active")
      .sort((left, right) => Number(left.resolvedAtMs || left.updatedAtMs || 0) -
        Number(right.resolvedAtMs || right.updatedAtMs || 0));
    while (Object.keys(draft.supportIncidents).length >= MAX_SUPPORT_INCIDENTS && terminalIncidents.length > 0) {
      const removable = terminalIncidents.shift();
      delete draft.supportIncidents[removable.incidentID];
    }
    draft.supportIncidents[incidentID] = incident;
    draft.supportCooldowns[cooldownKey] = {
      cooldownKey,
      factionKey: normalized.factionKey,
      supportGroupID,
      incidentID,
      createdAtMs: nowMs,
      expiresAtMs: nowMs + cooldownMs,
    };
    return { success: true, data: { incident: cloneValue(incident), created: true } };
  });
  return result.value;
}

function getNpcSupportIncident(incidentID: string) {
  const state = readRoot({ initialize: true });
  return cloneValue((state.supportIncidents || {})[String(incidentID || "").trim().toLowerCase()] || null);
}

function listNpcSupportIncidents(filters: Record<string, any> = {}) {
  const state = readRoot({ initialize: true });
  const factionKey = String(filters.factionKey || "").trim().toLowerCase();
  const statuses = Array.isArray(filters.statuses)
    ? new Set(filters.statuses.map((status) => String(status || "").trim().toLowerCase()))
    : null;
  return Object.values<any>(state.supportIncidents || {})
    .filter((incident) => !factionKey || incident.factionKey === factionKey)
    .filter((incident) => !statuses || statuses.has(incident.status))
    .sort((left, right) => Number(left.createdAtMs) - Number(right.createdAtMs))
    .map(cloneValue);
}

function updateNpcSupportIncident(incidentID: string, patch: Record<string, any>, options: Record<string, any> = {}) {
  initializeNpcRuntimePersistence();
  const normalizedID = String(incidentID || "").trim().toLowerCase();
  const result = mutateRoot((draft) => {
    draft.supportIncidents ||= {};
    const current = draft.supportIncidents[normalizedID];
    if (!current) throw new Error("NPC support incident not found");
    if (options.expectedRevision != null && Number(options.expectedRevision) !== current.recordRevision) {
      throw new Error("NPC support incident revision conflict");
    }
    const nextStatus = String(patch.status || current.status).trim().toLowerCase();
    if (!["active", "resolved", "expired", "cancelled"].includes(nextStatus)) {
      throw new Error("NPC support incident status is invalid");
    }
    const nowMs = Number.isFinite(Number(options.nowMs)) ? Number(options.nowMs) : Date.now();
    const next = {
      ...current,
      ...cloneValue(patch),
      incidentID: current.incidentID,
      deduplicationID: current.deduplicationID,
      requestingNpcCharacterID: current.requestingNpcCharacterID,
      requestingNpcIncarnation: current.requestingNpcIncarnation,
      requesterEntityID: current.requesterEntityID,
      factionKey: current.factionKey,
      schemaVersion: SCHEMA_VERSION,
      status: nextStatus,
      recordRevision: current.recordRevision + 1,
      updatedAtMs: nowMs,
      resolvedAtMs: nextStatus === "active" ? 0 : (current.resolvedAtMs || nowMs),
    };
    draft.supportIncidents[normalizedID] = next;
    return cloneValue(next);
  });
  return { success: true, data: result.value };
}

function expireNpcSupportIncidents(nowMs = Date.now()) {
  initializeNpcRuntimePersistence();
  const normalizedNow = Number.isFinite(Number(nowMs)) ? Math.max(0, Number(nowMs)) : Date.now();
  const result = mutateRoot((draft) => expireSupportIncidentsInDraft(draft, normalizedNow));
  return { success: true, expired: result.value };
}

/** Atomically park prior work and install the one active support assignment. */
function assignNpcSupportResponder(incidentID: string, input: Record<string, any>) {
  initializeNpcRuntimePersistence();
  const normalizedIncidentID = String(incidentID || "").trim().toLowerCase();
  const npcCharacterID = toPositiveInt(input.npcCharacterID, 0);
  const incarnation = toPositiveInt(input.incarnation, 0);
  const responderEntityID = toPositiveInt(input.responderEntityID, 0);
  const nowMs = Number.isFinite(Number(input.nowMs)) ? Math.max(0, Number(input.nowMs)) : Date.now();
  if (!npcCharacterID || !incarnation || !responderEntityID) {
    return { success: false, errorMsg: "NPC_SUPPORT_RESPONDER_IDENTITY_REQUIRED" };
  }
  const result = mutateRoot((draft) => {
    draft.supportIncidents ||= {};
    expireSupportIncidentsInDraft(draft, nowMs);
    const incident = draft.supportIncidents[normalizedIncidentID];
    if (!incident || incident.status !== "active") {
      return { success: false, errorMsg: "NPC_SUPPORT_INCIDENT_NOT_ACTIVE" };
    }
    if (incident.requestingNpcCharacterID === npcCharacterID) {
      return { success: false, errorMsg: "NPC_SUPPORT_REQUESTER_CANNOT_RESPOND" };
    }
    if (String(input.factionKey || "").trim().toLowerCase() !== incident.factionKey) {
      return { success: false, errorMsg: "NPC_SUPPORT_FACTION_MISMATCH" };
    }
    incident.responderAssignments ||= [];
    const existingAssignment = incident.responderAssignments.find((assignment) =>
      assignment.npcCharacterID === npcCharacterID &&
      ["assigned", "engaging"].includes(String(assignment.status)),
    );
    if (existingAssignment) {
      return { success: true, data: cloneValue(existingAssignment), created: false };
    }
    const activeAssignmentCount = incident.responderAssignments.filter((assignment) =>
      ["assigned", "engaging"].includes(String(assignment.status)),
    ).length;
    if (activeAssignmentCount >= incident.maximumResponderCount) {
      return { success: false, errorMsg: "NPC_SUPPORT_RESPONDER_LIMIT" };
    }
    const nonterminalJobs = Object.values<any>(draft.jobs).filter((job) =>
      job.npcCharacterID === npcCharacterID &&
      job.incarnation === incarnation &&
      NONTERMINAL_JOB_STATUSES.has(job.status),
    );
    const existingSupport = nonterminalJobs.find((job) => job.jobType === "support.respond");
    if (existingSupport) {
      if (existingSupport.payload && existingSupport.payload.incidentID === normalizedIncidentID) {
        return {
          success: true,
          data: cloneValue(incident.responderAssignments.find((assignment) =>
            assignment.supportJobID === existingSupport.jobID,
          ) || null),
          created: false,
        };
      }
      return { success: false, errorMsg: "NPC_SUPPORT_RESPONDER_BUSY" };
    }
    const alreadyParked = nonterminalJobs.find((job) => PARKED_JOB_STATUSES.has(job.status));
    if (alreadyParked) {
      return { success: false, errorMsg: "NPC_SUPPORT_RESPONDER_INTERRUPTED" };
    }
    const previousJob = nonterminalJobs.find((job) => ACTIVE_JOB_STATUSES.has(job.status)) || null;
    const supportJobID = randomUUID();
    if (previousJob) {
      previousJob.status = "interrupted";
      previousJob.interruptedByJobID = supportJobID;
      previousJob.interruptedAtMs = nowMs;
      previousJob.claimToken = null;
      previousJob.recordRevision = Math.max(0, Number(previousJob.recordRevision) || 0) + 1;
      previousJob.updatedAtMs = nowMs;
    }
    const supportJob = {
      schemaVersion: SCHEMA_VERSION,
      recordRevision: 1,
      jobID: supportJobID,
      npcCharacterID,
      incarnation,
      jobType: "support.respond",
      status: "queued",
      step: "dispatch",
      target: { entityID: incident.threatTargetID, systemID: incident.systemID },
      payload: {
        incidentID: normalizedIncidentID,
        requesterEntityID: incident.requesterEntityID,
        threatTargetID: incident.threatTargetID,
        systemID: incident.systemID,
        position: cloneValue(incident.position),
        requiredRoles: cloneValue(input.roles || []),
        resumeJobID: previousJob && previousJob.jobID || null,
        dispatchTier: String(input.dispatchTier || "nearby"),
      },
      checkpoint: { assignedAtMs: nowMs },
      reservations: [],
      retryCount: 0,
      nextWakeAtMs: 0,
      lastError: null,
      idempotencyKey: `support:${normalizedIncidentID}:${npcCharacterID}`,
      claimToken: null,
      createdAtMs: nowMs,
      updatedAtMs: nowMs,
      completedAtMs: 0,
    };
    draft.jobs[supportJobID] = supportJob;
    const assignment = {
      assignmentID: supportJobID,
      supportJobID,
      npcCharacterID,
      incarnation,
      responderEntityID,
      responderSystemID: toPositiveInt(input.responderSystemID, 0) || null,
      roles: cloneValue(input.roles || []),
      dispatchTier: String(input.dispatchTier || "nearby"),
      previousJobID: previousJob && previousJob.jobID || null,
      status: "assigned",
      assignedAtMs: nowMs,
      completedAtMs: 0,
      outcome: null,
    };
    incident.responderAssignments.push(assignment);
    incident.recordRevision = Math.max(0, Number(incident.recordRevision) || 0) + 1;
    incident.updatedAtMs = nowMs;
    return { success: true, data: cloneValue(assignment), created: true };
  });
  return result.value;
}

/** Complete a responder assignment and resume exactly the job it interrupted. */
function settleNpcSupportAssignment(supportJobID: string, input: Record<string, any> = {}) {
  initializeNpcRuntimePersistence();
  const normalizedJobID = String(supportJobID || "").trim();
  const nowMs = Number.isFinite(Number(input.nowMs)) ? Math.max(0, Number(input.nowMs)) : Date.now();
  const outcome = String(input.outcome || "completed").trim().toLowerCase();
  const terminalStatus = outcome === "failed" ? "failed" : outcome === "cancelled" ? "cancelled" : "completed";
  const result = mutateRoot((draft) => {
    draft.supportIncidents ||= {};
    const supportJob = draft.jobs[normalizedJobID];
    if (!supportJob || supportJob.jobType !== "support.respond") {
      return { success: false, errorMsg: "NPC_SUPPORT_JOB_NOT_FOUND" };
    }
    const incidentID = String(supportJob.payload && supportJob.payload.incidentID || "").trim().toLowerCase();
    const incident = draft.supportIncidents[incidentID] || null;
    if (!TERMINAL_JOB_STATUSES.has(supportJob.status)) {
      supportJob.status = terminalStatus;
      supportJob.step = String(input.step || outcome || "completed");
      supportJob.lastError = terminalStatus === "failed"
        ? String(input.error || "NPC_SUPPORT_RESPONSE_FAILED")
        : null;
      supportJob.claimToken = null;
      supportJob.reservations = [];
      supportJob.completedAtMs = nowMs;
      supportJob.updatedAtMs = nowMs;
      supportJob.recordRevision = Math.max(0, Number(supportJob.recordRevision) || 0) + 1;
    }
    const resumeJobID = String(supportJob.payload && supportJob.payload.resumeJobID || "").trim();
    let resumedJob = null;
    if (resumeJobID) {
      const previousJob = draft.jobs[resumeJobID];
      if (previousJob && previousJob.status === "interrupted" &&
          previousJob.interruptedByJobID === normalizedJobID &&
          previousJob.npcCharacterID === supportJob.npcCharacterID &&
          previousJob.incarnation === supportJob.incarnation) {
        previousJob.status = "queued";
        previousJob.interruptedByJobID = null;
        previousJob.resumedAtMs = nowMs;
        previousJob.nextWakeAtMs = 0;
        previousJob.claimToken = null;
        previousJob.recordRevision = Math.max(0, Number(previousJob.recordRevision) || 0) + 1;
        previousJob.updatedAtMs = nowMs;
        resumedJob = cloneValue(previousJob);
      }
    }
    if (incident) {
      const assignment = (incident.responderAssignments || []).find((candidate) =>
        candidate.supportJobID === normalizedJobID,
      );
      if (assignment && assignment.status !== "completed") {
        assignment.status = terminalStatus === "completed" ? "completed" : terminalStatus;
        assignment.completedAtMs = nowMs;
        assignment.outcome = outcome;
        incident.recordRevision = Math.max(0, Number(incident.recordRevision) || 0) + 1;
        incident.updatedAtMs = nowMs;
      }
    }
    return {
      success: true,
      data: {
        supportJob: cloneValue(supportJob),
        resumedJob,
        incident: cloneValue(incident),
      },
    };
  });
  return result.value;
}

function acquireSpawnLease(input: Record<string, any>) {
  if (!acceptingNewWork) return { success: false, errorMsg: "NPC_PERSISTENCE_SHUTTING_DOWN" };
  initializeNpcRuntimePersistence();
  const npcCharacterID = toPositiveInt(input.npcCharacterID, 0);
  const entityID = toPositiveInt(input.entityID, 0);
  const incarnation = toPositiveInt(input.incarnation, 0);
  if (!npcCharacterID || !entityID || !incarnation) {
    return { success: false, errorMsg: "NPC_SPAWN_LEASE_IDENTITY_REQUIRED" };
  }
  const result = mutateRoot((draft) => {
    const key = String(npcCharacterID);
    const existing = draft.leases[key];
    if (existing && existing.serverInstanceID === serverInstanceID &&
        existing.entityID === entityID && existing.incarnation === incarnation) {
      return cloneValue(existing);
    }
    if (existing) {
      throw new Error(`NPC ${npcCharacterID} already has an active spawn lease`);
    }
    const lease = {
      schemaVersion: SCHEMA_VERSION,
      npcCharacterID,
      entityID,
      incarnation,
      token: randomUUID(),
      serverInstanceID,
      acquiredAtMs: Date.now(),
    };
    draft.leases[key] = lease;
    return cloneValue(lease);
  });
  return { success: true, data: result.value };
}

function releaseSpawnLease(npcCharacterID: number, token: string | null = null) {
  if (!readRoot({ initialize: false })) return { success: true, released: false };
  const result = mutateRoot((draft) => {
    const key = String(toPositiveInt(npcCharacterID, 0));
    const existing = draft.leases[key];
    if (!existing || (token && existing.token !== token)) return false;
    delete draft.leases[key];
    return true;
  });
  return { success: true, released: result.value };
}

function releaseSpawnLeaseByEntity(entityID: number) {
  if (!readRoot({ initialize: false })) return { success: true, released: false };
  const normalizedID = toPositiveInt(entityID, 0);
  const result = mutateRoot((draft) => {
    for (const [key, lease] of Object.entries<any>(draft.leases)) {
      if (lease.entityID === normalizedID) {
        delete draft.leases[key];
        return true;
      }
    }
    return false;
  });
  return { success: true, released: result.value };
}

function isNpcEntityQuarantined(entityID: number) {
  const normalizedID = toPositiveInt(entityID, 0);
  const state = readRoot({ initialize: true });
  return Object.values<any>(state.quarantine).some(
    (record) => record.resolvedAtMs === 0 && record.entityID === normalizedID,
  );
}

function recordQuarantine(
  draft: Record<string, any>,
  input: Record<string, any>,
) {
  const key = checksum([
    input.kind || "record",
    input.entityID || 0,
    input.recordID || "",
    input.reason || "unknown",
  ]).slice(0, 32);
  const existing = draft.quarantine[key];
  draft.quarantine[key] = {
    schemaVersion: SCHEMA_VERSION,
    quarantineID: key,
    kind: String(input.kind || "record"),
    entityID: toPositiveInt(input.entityID, 0) || null,
    recordID: input.recordID == null ? null : String(input.recordID),
    reason: String(input.reason || "NPC_PERSISTENCE_INVALID"),
    detail: cloneValue(input.detail || null),
    firstSeenAtMs: existing && existing.firstSeenAtMs || Date.now(),
    lastSeenAtMs: Date.now(),
    resolvedAtMs: 0,
  };
}

function beginNpcOperation(
  operationType: string,
  idempotencyKey: string,
  payload: Record<string, any> = {},
) {
  if (!acceptingNewWork) throw new Error("NPC persistence shutdown is in progress");
  initializeNpcRuntimePersistence();
  const type = String(operationType || "").trim().toLowerCase();
  const key = String(idempotencyKey || "").trim();
  if (!type || !key) throw new Error("NPC operation type and idempotency key are required");
  const result = mutateRoot((draft) => {
    const existing = Object.values<any>(draft.operations).find(
      (operation) => operation.idempotencyKey === key,
    );
    if (existing) return cloneValue(existing);
    const operationID = randomUUID();
    const operation = {
      schemaVersion: SCHEMA_VERSION,
      recordRevision: 1,
      operationID,
      operationType: type,
      idempotencyKey: key,
      status: "prepared",
      step: "prepared",
      payload: cloneValue(payload),
      lastError: null,
      createdAtMs: Date.now(),
      updatedAtMs: Date.now(),
      completedAtMs: 0,
    };
    draft.operations[operationID] = operation;
    return cloneValue(operation);
  });
  return { success: true, data: result.value };
}

function getNpcOperationByIdempotencyKey(idempotencyKey: string) {
  const key = String(idempotencyKey || "").trim();
  if (!key) return null;
  const state = readRoot({ initialize: true });
  return cloneValue(
    Object.values<any>(state.operations).find(
      (operation) => operation.idempotencyKey === key,
    ) || null,
  );
}

function listNpcOperations(filters: Record<string, any> = {}) {
  const state = readRoot({ initialize: true });
  const operationType = String(filters.operationType || "").trim().toLowerCase();
  const status = String(filters.status || "").trim().toLowerCase();
  const jobID = String(filters.jobID || "").trim();
  return Object.values<any>(state.operations || {})
    .filter((operation) => !operationType || operation.operationType === operationType)
    .filter((operation) => !status || operation.status === status)
    .filter((operation) => !jobID || String(operation.payload?.jobID || "") === jobID)
    .sort((left, right) => Number(left.createdAtMs) - Number(right.createdAtMs) ||
      String(left.operationID).localeCompare(String(right.operationID)))
    .map(cloneValue);
}

function updateNpcOperation(
  operationID: string,
  patch: Record<string, any>,
  options: Record<string, any> = {},
) {
  if (Array.isArray(options.flushTables)) flushTables(options.flushTables);
  const normalizedID = String(operationID || "").trim();
  const result = mutateRoot((draft) => {
    const current = draft.operations[normalizedID];
    if (!current) throw new Error("NPC persistence operation not found");
    const status = String(patch.status || current.status);
    const next = {
      ...current,
      ...cloneValue(patch),
      operationID: current.operationID,
      operationType: current.operationType,
      idempotencyKey: current.idempotencyKey,
      status,
      recordRevision: current.recordRevision + 1,
      updatedAtMs: Date.now(),
      completedAtMs: ["committed", "compensated", "failed"].includes(status)
        ? (current.completedAtMs || Date.now())
        : 0,
    };
    draft.operations[normalizedID] = next;
    const completed = Object.values<any>(draft.operations)
      .filter((entry) => ["committed", "compensated", "failed"].includes(entry.status))
      .sort((left, right) => right.completedAtMs - left.completedAtMs);
    for (const old of completed.slice(MAX_COMPLETED_OPERATIONS)) {
      delete draft.operations[old.operationID];
    }
    return cloneValue(next);
  });
  return { success: true, data: result.value };
}

function checkpointNpcOperation(
  operationID: string,
  step: string,
  payloadPatch: Record<string, any> = {},
  options: Record<string, any> = {},
) {
  const currentState = readRoot({ initialize: true });
  const current = currentState.operations[String(operationID || "").trim()];
  if (!current) throw new Error("NPC persistence operation not found");
  return updateNpcOperation(operationID, {
    status: "applying",
    step: String(step || "applying"),
    payload: { ...cloneValue(current.payload || {}), ...cloneValue(payloadPatch) },
  }, options);
}

function commitNpcOperation(operationID: string, options: Record<string, any> = {}) {
  return updateNpcOperation(operationID, {
    status: "committed",
    step: "committed",
    lastError: null,
    ...(Object.prototype.hasOwnProperty.call(options, "result")
      ? { result: cloneValue(options.result) }
      : {}),
  }, options);
}

function failNpcOperation(operationID: string, error: unknown, options: Record<string, any> = {}) {
  return updateNpcOperation(operationID, {
    status: options.compensated === true ? "compensated" : "failed",
    step: options.compensated === true ? "compensated" : "failed",
    lastError: error instanceof Error ? error.message : String(error || "unknown"),
  }, options);
}

function reconcilePendingOperations(summary: Record<string, any>) {
  const state = readRoot({ initialize: true });
  const pending = Object.values<any>(state.operations).filter(
    (operation) => !["committed", "compensated", "failed"].includes(operation.status),
  );
  const nativeNpcStore = require("./nativeNpcStore");
  for (const operation of pending) {
    try {
      if (operation.operationType === "spawn") {
        const entityID = toPositiveInt(operation.payload && operation.payload.entityID, 0);
        const entity = nativeNpcStore.getNativeEntity(entityID);
        const controller = nativeNpcStore.getNativeController(entityID);
        const moduleIDs = new Set(
          nativeNpcStore.listNativeModulesForEntity(entityID).map((record) => record.moduleID),
        );
        const cargoIDs = new Set(
          nativeNpcStore.listNativeCargoForEntity(entityID).map((record) => record.cargoID),
        );
        const expectedModules = Array.isArray(operation.payload && operation.payload.expectedModuleIDs)
          ? operation.payload.expectedModuleIDs
          : [];
        const expectedCargo = Array.isArray(operation.payload && operation.payload.expectedCargoIDs)
          ? operation.payload.expectedCargoIDs
          : [];
        const complete = entity && controller &&
          expectedModules.every((id) => moduleIDs.has(id)) &&
          expectedCargo.every((id) => cargoIDs.has(id));
        if (complete) {
          commitNpcOperation(operation.operationID, {
            flushTables: ["npcEntities", "npcModules", "npcCargo", "npcRuntimeControllers"],
          });
          summary.recoveredOperations += 1;
          continue;
        }
        if (entityID) {
          nativeNpcStore.removeNativeEntityCascade(entityID, {
            skipPersistenceJournal: true,
          });
          flushTables(["npcEntities", "npcModules", "npcCargo", "npcRuntimeControllers"]);
        }
        const npcCharacterID = toPositiveInt(operation.payload && operation.payload.npcCharacterID, 0);
        if (npcCharacterID && entityID) {
          try {
            require("./npcPilotIdentityStore")
              .getNpcPilotIdentityStore()
              .release(npcCharacterID, entityID, false);
          } catch (error) {
            summary.errors.push(`spawn identity ${npcCharacterID}: ${error.message}`);
          }
        }
        failNpcOperation(operation.operationID, "Incomplete spawn compensated during recovery", {
          compensated: true,
        });
        summary.compensatedOperations += 1;
        continue;
      }
      if (operation.operationType === "destroy") {
        const entityID = toPositiveInt(operation.payload && operation.payload.entityID, 0);
        if (entityID) {
          const removal = nativeNpcStore.removeNativeEntityCascade(entityID, {
            skipPersistenceJournal: true,
            destroyed: operation.payload && operation.payload.destroyed === true,
            equipmentLossPolicy: operation.payload && operation.payload.equipmentLossPolicy,
          });
          if (!removal || removal.success !== true) {
            throw new Error(removal && removal.errorMsg || "NPC destruction recovery failed");
          }
          flushTables(["npcEntities", "npcModules", "npcCargo", "npcRuntimeControllers"]);
        }
        const npcCharacterID = toPositiveInt(operation.payload && operation.payload.npcCharacterID, 0);
        if (npcCharacterID && entityID) {
          require("./npcPilotIdentityStore")
            .getNpcPilotIdentityStore()
            .release(
              npcCharacterID,
              entityID,
              operation.payload && operation.payload.destroyed === true,
            );
        }
        commitNpcOperation(operation.operationID);
        summary.recoveredOperations += 1;
        continue;
      }
      if (String(operation.operationType || "").startsWith("npc-fit") ||
          String(operation.operationType || "").startsWith("npc-unfit") ||
          String(operation.operationType || "").startsWith("npc-charge-")) {
        const result = require("./npcFittingService")
          .recoverNpcFittingOperation(operation);
        if (!result || result.success !== true) {
          throw new Error(result && result.errorMsg || "NPC fitting recovery failed");
        }
        if (result.compensated === true) summary.compensatedOperations += 1;
        else if (result.recovered === true) summary.recoveredOperations += 1;
        continue;
      }
      if (String(operation.operationType || "").startsWith("npc-resource-")) {
        const result = require("./npcResourceJobService")
          .recoverNpcResourceOperation(operation);
        if (!result || result.success !== true) {
          throw new Error(result && result.errorMsg || "NPC resource operation recovery failed");
        }
        if (result.compensated === true) summary.compensatedOperations += 1;
        else if (result.recovered === true) summary.recoveredOperations += 1;
        continue;
      }
      if (String(operation.operationType || "").startsWith("npc-construction-")) {
        const result = require("./npcConstructionJobService")
          .recoverNpcConstructionOperation(operation);
        if (!result || result.success !== true) {
          throw new Error(result && result.errorMsg || "NPC construction operation recovery failed");
        }
        if (result.compensated === true) summary.compensatedOperations += 1;
        else if (result.recovered === true) summary.recoveredOperations += 1;
        continue;
      }
      if (String(operation.operationType || "").startsWith("npc-industry-")) {
        const result = require("./npcIndustryJobService")
          .recoverNpcIndustryOperation(operation);
        if (!result || result.success !== true) {
          throw new Error(result && result.errorMsg || "NPC industry recovery failed");
        }
        if (result.compensated === true) summary.compensatedOperations += 1;
        else if (result.recovered === true) summary.recoveredOperations += 1;
        continue;
      }
      if (String(operation.operationType || "").startsWith("npc-stargate-maintenance-")) {
        const result = require("./npcStargateMaintenanceService")
          .recoverNpcStargateMaintenanceOperation(operation);
        if (!result || result.success !== true) {
          throw new Error(result && result.errorMsg || "NPC stargate maintenance recovery failed");
        }
        if (result.compensated === true) summary.compensatedOperations += 1;
        else if (result.recovered === true) summary.recoveredOperations += 1;
        continue;
      }
      summary.unhandledOperations += 1;
    } catch (error) {
      summary.errors.push(`operation ${operation.operationID}: ${error.message}`);
    }
  }
}

function verifyVersionedRecord(record: Record<string, any>) {
  if (!record || typeof record !== "object") return "NPC_RECORD_NOT_OBJECT";
  if (record.schemaVersion != null && record.schemaVersion !== SCHEMA_VERSION) {
    return "NPC_RECORD_SCHEMA_UNSUPPORTED";
  }
  if (record.recordChecksum) {
    const copy = cloneValue(record);
    const expected = String(copy.recordChecksum);
    delete copy.recordChecksum;
    if (checksum(copy) !== expected) return "NPC_RECORD_CHECKSUM_MISMATCH";
  }
  return null;
}

function reconcileNativeNpcPersistence(options: Record<string, any> = {}) {
  if (recoveryRunning) return { success: true, skipped: true };
  if (!initialized) initializeNpcRuntimePersistence({ reconcile: false });
  recoveryRunning = true;
  const summary: Record<string, any> = {
    previousCleanShutdown: options.previousCleanShutdown === true,
    recoveredOperations: 0,
    compensatedOperations: 0,
    unhandledOperations: 0,
    quarantined: 0,
    migrated: 0,
    retiredJobs: 0,
    errors: [],
  };
  try {
    reconcilePendingOperations(summary);
    const nativeNpcStore = require("./nativeNpcStore");
    const entities = nativeNpcStore.listNativeEntities();
    const controllers = nativeNpcStore.listNativeControllers();
    const entityByID = new Map<number, any>(entities.map((entry) => [Number(entry.entityID), entry]));
    const controllerByID = new Map<number, any>(controllers.map((entry) => [Number(entry.entityID), entry]));
    const byCharacterID = new Map<number, any[]>();
    for (const entity of entities) {
      const characterID = toPositiveInt(entity.npcCharacterID, 0);
      if (characterID) {
        const group = byCharacterID.get(characterID) || [];
        group.push(entity);
        byCharacterID.set(characterID, group);
      }
    }
    let pilots = new Map<number, any>();
    try {
      const identityStore = require("./npcPilotIdentityStore").getNpcPilotIdentityStore();
      pilots = new Map(identityStore.list().map((pilot) => [pilot.characterID, pilot]));
    } catch (error) {
      summary.errors.push(`identity ledger: ${error.message}`);
    }
    for (const pilot of pilots.values()) {
      const retired = retireStaleNpcJobs(pilot.characterID, pilot.incarnation);
      summary.retiredJobs += Array.isArray(retired.data) ? retired.data.length : 0;
    }

    const problems: Record<string, any>[] = [];
    for (const entity of entities) {
      const entityID = toPositiveInt(entity.entityID, 0);
      const versionError = verifyVersionedRecord(entity);
      if (versionError) problems.push({ kind: "entity", entityID, recordID: entityID, reason: versionError });
      const scope = nativeNpcStore.validateStoredEntityScopeMetadata(entity);
      if (!scope.success) problems.push({ kind: "entity", entityID, recordID: entityID, reason: scope.errorMsg });
      const controller = controllerByID.get(entityID);
      if (!controller) {
        problems.push({ kind: "entity", entityID, recordID: entityID, reason: "NPC_CONTROLLER_MISSING" });
      } else if (toPositiveInt(controller.systemID, 0) !== toPositiveInt(entity.systemID, 0)) {
        problems.push({ kind: "controller", entityID, recordID: entityID, reason: "NPC_SYSTEM_MISMATCH" });
      }
      const characterID = toPositiveInt(entity.npcCharacterID, 0);
      const pilot = pilots.get(characterID);
      if (characterID && pilot && pilot.activeEntityID && pilot.activeEntityID !== entityID) {
        problems.push({ kind: "identity", entityID, recordID: characterID, reason: "NPC_PILOT_ACTIVE_ENTITY_MISMATCH" });
      }
    }
    for (const controller of controllers) {
      const entityID = toPositiveInt(controller.entityID, 0);
      const versionError = verifyVersionedRecord(controller);
      if (versionError) problems.push({ kind: "controller", entityID, recordID: entityID, reason: versionError });
      if (!entityByID.has(entityID)) {
        problems.push({ kind: "controller", entityID, recordID: entityID, reason: "NPC_ENTITY_MISSING" });
      }
    }
    for (const [characterID, records] of byCharacterID) {
      if (records.length <= 1) continue;
      const pilot = pilots.get(characterID);
      const canonical = records.find((entry) => entry.entityID === pilot?.activeEntityID) ||
        [...records].sort((left, right) =>
          toPositiveInt(right.npcIncarnation, 0) - toPositiveInt(left.npcIncarnation, 0) ||
          toPositiveInt(right.entityID, 0) - toPositiveInt(left.entityID, 0),
        )[0];
      for (const duplicate of records) {
        if (duplicate.entityID !== canonical.entityID) {
          problems.push({
            kind: "identity",
            entityID: duplicate.entityID,
            recordID: characterID,
            reason: "NPC_DUPLICATE_PERSISTENT_IDENTITY",
            detail: { canonicalEntityID: canonical.entityID },
          });
        }
      }
    }
    for (const moduleRecord of nativeNpcStore.listNativeModules()) {
      const entityID = toPositiveInt(moduleRecord.entityID, 0);
      const versionError = verifyVersionedRecord(moduleRecord);
      if (versionError) problems.push({ kind: "module", entityID, recordID: moduleRecord.moduleID, reason: versionError });
      if (!entityByID.has(entityID)) problems.push({ kind: "module", entityID, recordID: moduleRecord.moduleID, reason: "NPC_MODULE_ORPHANED" });
    }
    for (const cargoRecord of nativeNpcStore.listNativeCargo()) {
      const entityID = toPositiveInt(cargoRecord.entityID, 0);
      const versionError = verifyVersionedRecord(cargoRecord);
      if (versionError) problems.push({ kind: "cargo", entityID, recordID: cargoRecord.cargoID, reason: versionError });
      if (!entityByID.has(entityID)) problems.push({ kind: "cargo", entityID, recordID: cargoRecord.cargoID, reason: "NPC_CARGO_ORPHANED" });
    }
    const wrecks = nativeNpcStore.listNativeWrecks();
    const wreckIDs = new Set(wrecks.map((record) => toPositiveInt(record.wreckID, 0)));
    for (const wreck of wrecks) {
      const versionError = verifyVersionedRecord(wreck);
      if (versionError) problems.push({ kind: "wreck", recordID: wreck.wreckID, reason: versionError });
      const scope = nativeNpcStore.validateStoredEntityScopeMetadata(wreck, {
        projectAirInstanceToDungeonSite: true,
      });
      if (!scope.success) problems.push({ kind: "wreck", recordID: wreck.wreckID, reason: scope.errorMsg });
    }
    for (const item of nativeNpcStore.listNativeWreckItems()) {
      const versionError = verifyVersionedRecord(item);
      if (versionError) problems.push({ kind: "wreck-item", recordID: item.wreckItemID, reason: versionError });
      if (!wreckIDs.has(toPositiveInt(item.wreckID, 0))) {
        problems.push({ kind: "wreck-item", recordID: item.wreckItemID, reason: "NPC_WRECK_ITEM_ORPHANED" });
      }
    }

    // Legacy records are upgraded in place only when they have no version.
    // Unknown versions/checksum failures remain untouched and quarantined.
    for (const entity of entities) {
      if (entity.schemaVersion == null) {
        const result = nativeNpcStore.upsertNativeEntity(entity, { transient: entity.transient === true });
        if (result.success) summary.migrated += 1;
      }
    }
    for (const controller of controllers) {
      if (controller.schemaVersion == null) {
        const result = nativeNpcStore.upsertNativeController(controller, { transient: controller.transient === true });
        if (result.success) summary.migrated += 1;
      }
    }
    for (const record of nativeNpcStore.listNativeModules()) {
      if (record.schemaVersion == null) {
        const result = nativeNpcStore.upsertNativeModule(record, { transient: record.transient === true });
        if (result.success) summary.migrated += 1;
      }
    }
    for (const record of nativeNpcStore.listNativeCargo()) {
      if (record.schemaVersion == null) {
        const result = nativeNpcStore.upsertNativeCargo(record, { transient: record.transient === true });
        if (result.success) summary.migrated += 1;
      }
    }
    for (const record of wrecks) {
      if (record.schemaVersion == null) {
        const result = nativeNpcStore.upsertNativeWreck(record, { transient: record.transient === true });
        if (result.success) summary.migrated += 1;
      }
    }
    for (const record of nativeNpcStore.listNativeWreckItems()) {
      if (record.schemaVersion == null) {
        const result = nativeNpcStore.upsertNativeWreckItem(record, { transient: record.transient === true });
        if (result.success) summary.migrated += 1;
      }
    }
    if (summary.migrated > 0) {
      flushTables(["npcEntities", "npcModules", "npcCargo", "npcRuntimeControllers", "npcWrecks", "npcWreckItems"]);
    }

    mutateRoot((draft) => {
      for (const record of Object.values<any>(draft.quarantine)) record.resolvedAtMs = Date.now();
      for (const problem of problems) recordQuarantine(draft, problem);
      const unresolved = Object.values<any>(draft.quarantine)
        .filter((record) => record.resolvedAtMs === 0)
        .sort((left, right) => right.lastSeenAtMs - left.lastSeenAtMs);
      const resolved = Object.values<any>(draft.quarantine)
        .filter((record) => record.resolvedAtMs > 0)
        .sort((left, right) => right.resolvedAtMs - left.resolvedAtMs);
      draft.quarantine = Object.fromEntries(
        [...unresolved, ...resolved]
          .slice(0, MAX_QUARANTINE_RECORDS)
          .map((record) => [record.quarantineID, record]),
      );
      summary.quarantined = unresolved.length;
      draft.recovery = {
        lastRunAtMs: Date.now(),
        lastSummary: cloneValue(summary),
      };
    });
    return { success: summary.errors.length === 0, data: cloneValue(summary) };
  } finally {
    recoveryRunning = false;
  }
}

function createVerifiedSnapshot(reason = "manual") {
  initializeNpcRuntimePersistence();
  const snapshotTables = [
    "npcEntities",
    "npcModules",
    "npcCargo",
    "npcRuntimeControllers",
    "npcPilotIdentities",
    "npcWrecks",
    "npcWreckItems",
  ];
  flushTables(snapshotTables);
  const state = readRoot({ initialize: true });
  const payload = {
    schemaVersion: SCHEMA_VERSION,
    capturedAtMs: Date.now(),
    tables: Object.fromEntries(
      snapshotTables.map((table) => [table, cloneValue(database.read(table, "/").data || {})]),
    ),
    runtime: {
      jobs: cloneValue(state.jobs),
      supportIncidents: cloneValue(state.supportIncidents || {}),
      supportCooldowns: cloneValue(state.supportCooldowns || {}),
      assemblySignalCursors: cloneValue(state.assemblySignalCursors || {}),
      operations: cloneValue(state.operations),
      quarantine: cloneValue(state.quarantine),
    },
  };
  const json = Buffer.from(JSON.stringify(payload));
  const compressed = gzipSync(json);
  const snapshot = {
    snapshotID: randomUUID(),
    schemaVersion: SCHEMA_VERSION,
    reason: String(reason || "manual"),
    createdAtMs: payload.capturedAtMs,
    checksum: createHash("sha256").update(json).digest("hex"),
    encoding: "gzip-base64",
    uncompressedBytes: json.byteLength,
    compressedBytes: compressed.byteLength,
    payload: compressed.toString("base64"),
  };
  mutateRoot((draft) => {
    draft.snapshots = [snapshot, ...draft.snapshots].slice(0, MAX_SNAPSHOTS);
  });
  return { success: true, data: cloneValue(snapshot) };
}

function readVerifiedSnapshot(snapshotID: string) {
  const state = readRoot({ initialize: true });
  const snapshot = state.snapshots.find((entry) => entry.snapshotID === snapshotID);
  if (!snapshot) return { success: false, errorMsg: "NPC_SNAPSHOT_NOT_FOUND" };
  try {
    const raw = gunzipSync(Buffer.from(snapshot.payload, "base64"));
    const actual = createHash("sha256").update(raw).digest("hex");
    if (actual !== snapshot.checksum) throw new Error("checksum mismatch");
    const payload = JSON.parse(raw.toString("utf8"));
    if (payload.schemaVersion !== SCHEMA_VERSION) throw new Error("schema mismatch");
    return { success: true, data: cloneValue(payload), snapshot: cloneValue(snapshot) };
  } catch (error) {
    return { success: false, errorMsg: "NPC_SNAPSHOT_CORRUPT", detail: error.message };
  }
}

function restoreVerifiedSnapshot(snapshotID: string, options: Record<string, any> = {}) {
  if (options.force !== true) {
    return { success: false, errorMsg: "NPC_SNAPSHOT_RESTORE_REQUIRES_FORCE" };
  }
  const verified = readVerifiedSnapshot(snapshotID);
  if (!verified.success) return verified;
  const payload = verified.data;
  for (const [table, value] of Object.entries(payload.tables || {})) {
    const result = database.write(table, "/", cloneValue(value), { force: true });
    if (!result.success) throw new Error(`Could not restore NPC snapshot table ${table}`);
  }
  flushTables(Object.keys(payload.tables || {}));
  try {
    require("./nativeNpcStore").invalidateControllerCache();
  } catch (_) {}
  mutateRoot((draft) => {
    draft.jobs = cloneValue(payload.runtime && payload.runtime.jobs || {});
    draft.supportIncidents = cloneValue(payload.runtime && payload.runtime.supportIncidents || {});
    draft.supportCooldowns = cloneValue(payload.runtime && payload.runtime.supportCooldowns || {});
    draft.assemblySignalCursors = cloneValue(
      payload.runtime && payload.runtime.assemblySignalCursors || {},
    );
    draft.operations = cloneValue(payload.runtime && payload.runtime.operations || {});
    draft.quarantine = cloneValue(payload.runtime && payload.runtime.quarantine || {});
    draft.leases = {};
    draft.recovery = {
      lastRunAtMs: Date.now(),
      lastSummary: { restoredSnapshotID: snapshotID },
    };
  });
  return { success: true, data: { snapshotID } };
}

function markCleanShutdown(reason = "shutdown") {
  if (!readRoot({ initialize: false })) return { success: true, skipped: true };
  mutateRoot((draft) => {
    draft.server.cleanShutdown = true;
    draft.server.shutdownAtMs = Date.now();
    draft.server.shutdownReason = String(reason || "shutdown");
    draft.leases = {};
  });
  flushTables([
    TABLE,
    "npcEntities",
    "npcModules",
    "npcCargo",
    "npcRuntimeControllers",
    "npcPilotIdentities",
    "npcWrecks",
    "npcWreckItems",
  ]);
  return { success: true };
}

function installNpcPersistenceShutdownHook(checkpoint: (reason: string) => void) {
  if (shutdownHookInstalled) return;
  shutdownHookInstalled = true;
  if (typeof database.registerShutdownHook !== "function") return;
  database.registerShutdownHook((reason) => {
    try {
      acceptingNewWork = false;
      checkpoint(reason);
      createVerifiedSnapshot(`shutdown:${reason}`);
      markCleanShutdown(reason);
    } catch (error) {
      log.error(`[NpcPersistence] shutdown checkpoint failed: ${error.message}`);
      throw error;
    }
  });
}

function installNpcPersistenceCheckpointTimer(
  checkpoint: (reason: string) => any,
  options: Record<string, any> = {},
) {
  if (checkpointTimer || typeof checkpoint !== "function") return checkpointTimer;
  const configured = Number(
    options.intervalMs ?? process.env.EVEJS_NPC_PERSISTENCE_SNAPSHOT_INTERVAL_MS,
  );
  const intervalMs = Math.max(
    60_000,
    Number.isFinite(configured) && configured > 0 ? configured : 300_000,
  );
  checkpointTimer = setInterval(() => {
    if (periodicCheckpointRunning) return;
    periodicCheckpointRunning = true;
    try {
      const result = checkpoint("periodic");
      if (!result || result.success !== false) createVerifiedSnapshot("periodic");
    } catch (error) {
      log.error(`[NpcPersistence] periodic checkpoint failed: ${error.message}`);
    } finally {
      periodicCheckpointRunning = false;
    }
  }, intervalMs);
  if (typeof checkpointTimer.unref === "function") checkpointTimer.unref();
  return checkpointTimer;
}

function resetRuntimeForTests() {
  initialized = false;
  recoveryRunning = false;
  acceptingNewWork = true;
}

module.exports = {
  TABLE,
  SCHEMA_VERSION,
  serverInstanceID,
  initializeNpcRuntimePersistence,
  getPersistenceStatus,
  reconcileNativeNpcPersistence,
  createNpcJob,
  getNpcJob,
  listNpcJobs,
  getActiveNpcJob,
  getNpcAssemblySignalCursor,
  listNpcAssemblySignalCursors,
  applyNpcAssemblySignalCheckpoint,
  advanceNpcAssemblySignalCursor,
  reconcileNpcAssemblySignalJournal,
  acquireNpcJobReservation,
  listNpcJobReservations,
  releaseNpcJobReservation,
  releaseNpcJobReservations,
  retireStaleNpcJobs,
  updateNpcJob,
  claimNpcJob,
  createOrGetNpcSupportIncident,
  getNpcSupportIncident,
  listNpcSupportIncidents,
  updateNpcSupportIncident,
  expireNpcSupportIncidents,
  assignNpcSupportResponder,
  settleNpcSupportAssignment,
  acquireSpawnLease,
  releaseSpawnLease,
  releaseSpawnLeaseByEntity,
  isNpcEntityQuarantined,
  beginNpcOperation,
  getNpcOperationByIdempotencyKey,
  listNpcOperations,
  checkpointNpcOperation,
  commitNpcOperation,
  failNpcOperation,
  createVerifiedSnapshot,
  readVerifiedSnapshot,
  restoreVerifiedSnapshot,
  markCleanShutdown,
  installNpcPersistenceShutdownHook,
  installNpcPersistenceCheckpointTimer,
  _testing: {
    checksum,
    readRoot,
    resetRuntimeForTests,
    verifyVersionedRecord,
  },
};
