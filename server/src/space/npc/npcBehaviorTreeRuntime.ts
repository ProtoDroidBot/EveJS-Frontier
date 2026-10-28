"use strict";

import { randomUUID } from "node:crypto";

const persistence = require("./npcRuntimePersistence");

const STATUS = Object.freeze({
  SUCCESS: "success",
  FAILURE: "failure",
  RUNNING: "running",
  SUSPENDED: "suspended",
});

type BehaviorResult = {
  status: string;
  handled?: boolean;
  step?: string;
  nextWakeAtMs?: number;
  error?: string | null;
  checkpoint?: Record<string, any>;
};

function normalizeResult(value: any): BehaviorResult {
  if (typeof value === "boolean") {
    return { status: value ? STATUS.SUCCESS : STATUS.FAILURE };
  }
  const status = String(value && value.status || STATUS.FAILURE).toLowerCase();
  if (!(Object.values(STATUS) as string[]).includes(status)) {
    throw new Error(`Invalid NPC behavior status ${status}`);
  }
  return {
    ...value,
    status,
    nextWakeAtMs: Math.max(0, Number(value && value.nextWakeAtMs) || 0),
  };
}

function action(name: string, handler: (context: any) => any) {
  if (typeof handler !== "function") throw new Error("NPC behavior action requires a handler");
  return {
    kind: "action",
    name: String(name || "action"),
    tick(context: any) {
      return normalizeResult(handler(context));
    },
  };
}

function condition(name: string, predicate: (context: any) => boolean) {
  return action(name, (context) => ({
    status: predicate(context) ? STATUS.SUCCESS : STATUS.FAILURE,
  }));
}

function sequence(name: string, children: any[]) {
  const nodes = Array.isArray(children) ? children.filter(Boolean) : [];
  return {
    kind: "sequence",
    name: String(name || "sequence"),
    tick(context: any) {
      for (const child of nodes) {
        const result = normalizeResult(child.tick(context));
        if (result.status !== STATUS.SUCCESS) return result;
      }
      return { status: STATUS.SUCCESS };
    },
  };
}

function selector(name: string, children: any[]) {
  const nodes = Array.isArray(children) ? children.filter(Boolean) : [];
  return {
    kind: "selector",
    name: String(name || "selector"),
    tick(context: any) {
      for (const child of nodes) {
        const result = normalizeResult(child.tick(context));
        if (result.status !== STATUS.FAILURE) return result;
      }
      return { status: STATUS.FAILURE };
    },
  };
}

class NpcEventInbox {
  maxEvents: number;
  eventsByCharacterID: Map<number, any[]>;

  constructor(options: Record<string, any> = {}) {
    this.maxEvents = Math.max(16, Number(options.maxEvents) || 256);
    this.eventsByCharacterID = new Map();
  }

  publish(npcCharacterID: number, eventType: string, payload: any = null, options: Record<string, any> = {}) {
    const characterID = Math.trunc(Number(npcCharacterID) || 0);
    const type = String(eventType || "").trim().toLowerCase();
    if (characterID <= 0 || !type) return { success: false, errorMsg: "NPC_EVENT_INVALID" };
    const events = this.eventsByCharacterID.get(characterID) || [];
    const event = {
      eventID: String(options.eventID || randomUUID()),
      npcCharacterID: characterID,
      eventType: type,
      payload: payload == null ? null : JSON.parse(JSON.stringify(payload)),
      createdAtMs: Math.max(0, Number(options.createdAtMs) || Date.now()),
    };
    if (!events.some((candidate) => candidate.eventID === event.eventID)) events.push(event);
    this.eventsByCharacterID.set(characterID, events.slice(-this.maxEvents));
    return { success: true, data: event };
  }

  drain(npcCharacterID: number, limit = this.maxEvents) {
    const characterID = Math.trunc(Number(npcCharacterID) || 0);
    const events = this.eventsByCharacterID.get(characterID) || [];
    const count = Math.max(0, Math.min(events.length, Math.trunc(Number(limit) || 0)));
    const drained = events.splice(0, count);
    if (events.length === 0) this.eventsByCharacterID.delete(characterID);
    return drained;
  }

  clear(npcCharacterID: number) {
    this.eventsByCharacterID.delete(Math.trunc(Number(npcCharacterID) || 0));
  }
}

class NpcActionLockManager {
  locks: Map<string, any>;

  constructor() {
    this.locks = new Map();
  }

  key(npcCharacterID: number, resource: string) {
    return `${Math.trunc(Number(npcCharacterID) || 0)}:${String(resource || "").trim().toLowerCase()}`;
  }

  acquire(npcCharacterID: number, resource: string, options: Record<string, any> = {}) {
    const key = this.key(npcCharacterID, resource);
    if (key.startsWith("0:") || key.endsWith(":")) {
      return { success: false, errorMsg: "NPC_ACTION_LOCK_INVALID" };
    }
    const nowMs = Math.max(0, Number(options.nowMs) || Date.now());
    const existing = this.locks.get(key);
    if (existing && existing.expiresAtMs > nowMs && existing.owner !== options.owner) {
      return { success: false, errorMsg: "NPC_ACTION_LOCK_BUSY", data: { ...existing } };
    }
    const lock = {
      token: randomUUID(),
      npcCharacterID: Math.trunc(Number(npcCharacterID)),
      resource: String(resource).trim().toLowerCase(),
      owner: String(options.owner || "behavior"),
      acquiredAtMs: nowMs,
      expiresAtMs: nowMs + Math.max(100, Number(options.ttlMs) || 30_000),
    };
    this.locks.set(key, lock);
    return { success: true, data: { ...lock } };
  }

  renew(token: string, ttlMs = 30_000, nowMs = Date.now()) {
    for (const [key, lock] of this.locks) {
      if (lock.token !== token) continue;
      lock.expiresAtMs = Math.max(0, Number(nowMs) || Date.now()) + Math.max(100, Number(ttlMs) || 30_000);
      this.locks.set(key, lock);
      return { success: true, data: { ...lock } };
    }
    return { success: false, errorMsg: "NPC_ACTION_LOCK_NOT_FOUND" };
  }

  release(token: string) {
    for (const [key, lock] of this.locks) {
      if (lock.token === token) {
        this.locks.delete(key);
        return { success: true, released: true };
      }
    }
    return { success: true, released: false };
  }

  prune(nowMs = Date.now()) {
    let removed = 0;
    for (const [key, lock] of this.locks) {
      if (lock.expiresAtMs <= nowMs) {
        this.locks.delete(key);
        removed += 1;
      }
    }
    return removed;
  }

  clearNpc(npcCharacterID: number) {
    const prefix = `${Math.trunc(Number(npcCharacterID) || 0)}:`;
    let removed = 0;
    for (const key of this.locks.keys()) {
      if (key.startsWith(prefix)) {
        this.locks.delete(key);
        removed += 1;
      }
    }
    return removed;
  }
}

class NpcBlackboardStore {
  boards: Map<number, any>;

  constructor() {
    this.boards = new Map();
  }

  get(npcCharacterID: number, incarnation: number) {
    const characterID = Math.trunc(Number(npcCharacterID) || 0);
    const normalizedIncarnation = Math.trunc(Number(incarnation) || 0);
    if (characterID <= 0 || normalizedIncarnation <= 0) return null;
    const existing = this.boards.get(characterID);
    if (existing && existing.incarnation === normalizedIncarnation) return existing;
    const board = {
      npcCharacterID: characterID,
      incarnation: normalizedIncarnation,
      observations: {},
      memory: {},
      updatedAtMs: Date.now(),
    };
    this.boards.set(characterID, board);
    return board;
  }

  peek(npcCharacterID: number) {
    return this.boards.get(Math.trunc(Number(npcCharacterID) || 0)) || null;
  }

  update(npcCharacterID: number, incarnation: number, patch: Record<string, any>) {
    const board = this.get(npcCharacterID, incarnation);
    if (!board) return null;
    Object.assign(board, patch || {}, {
      npcCharacterID: board.npcCharacterID,
      incarnation: board.incarnation,
      updatedAtMs: Date.now(),
    });
    return board;
  }

  clear(npcCharacterID: number) {
    return this.boards.delete(Math.trunc(Number(npcCharacterID) || 0));
  }
}

const eventInbox = new NpcEventInbox();
const actionLocks = new NpcActionLockManager();
const blackboards = new NpcBlackboardStore();
const jobHandlers = new Map<string, any>();

function registerNpcJobHandler(jobType: string, handler: any) {
  const normalized = String(jobType || "").trim().toLowerCase();
  if (!normalized || (!handler || typeof handler.tick !== "function") && typeof handler !== "function") {
    throw new Error("NPC job handler requires a job type and tick function");
  }
  if (jobHandlers.has(normalized)) throw new Error(`NPC job handler ${normalized} is already registered`);
  jobHandlers.set(normalized, typeof handler === "function" ? action(normalized, handler) : handler);
  return () => jobHandlers.delete(normalized);
}

function tickDurableNpcJob(scene: any, entity: any, controller: any, nowMs: number) {
  const npcCharacterID = Math.trunc(Number(
    entity && entity.npcCharacterID || controller && controller.npcCharacterID,
  ) || 0);
  const incarnation = Math.trunc(Number(
    entity && entity.npcIncarnation || controller && controller.npcIncarnation,
  ) || 0);
  if (!npcCharacterID || !incarnation) return { handled: false, status: STATUS.FAILURE };
  // A behavior tick must not consume durable work until startup recovery has
  // advanced the server generation and reconciled interrupted operations.
  persistence.initializeNpcRuntimePersistence();
  const previousBlackboard = blackboards.peek(npcCharacterID);
  if (!previousBlackboard || previousBlackboard.incarnation !== incarnation) {
    if (previousBlackboard) {
      eventInbox.clear(npcCharacterID);
      actionLocks.clearNpc(npcCharacterID);
    }
    persistence.retireStaleNpcJobs(npcCharacterID, incarnation);
  }
  blackboards.get(npcCharacterID, incarnation);
  const job = persistence.getActiveNpcJob(npcCharacterID, incarnation);
  if (!job || job.nextWakeAtMs > nowMs) return { handled: false, status: STATUS.FAILURE };
  const handler = jobHandlers.get(job.jobType);
  if (!handler) return { handled: false, status: STATUS.FAILURE, job };
  let activeJob = job;
  if (activeJob.status === "queued") {
    activeJob = persistence.claimNpcJob(activeJob.jobID, {
      expectedRevision: activeJob.recordRevision,
      claimedBy: `npc:${npcCharacterID}`,
    }).data;
  }
  const context = {
    scene,
    entity,
    controller,
    nowMs,
    job: activeJob,
    events: eventInbox.drain(npcCharacterID),
    locks: actionLocks,
    blackboard: blackboards.get(npcCharacterID, incarnation),
    persistence,
  };
  try {
    const result = normalizeResult(handler.tick(context));
    const latestJob = persistence.getNpcJob(activeJob.jobID) || activeJob;
    // Some handlers complete a multi-record transition atomically (for
    // example, finishing a support assignment while resuming interrupted
    // work). Do not overwrite that committed terminal state afterward.
    if (["completed", "failed", "cancelled"].includes(latestJob.status)) {
      return { ...result, handled: result.handled !== false, job: latestJob };
    }
    if (result.status === STATUS.SUCCESS) {
      persistence.updateNpcJob(activeJob.jobID, {
        status: "completed",
        step: result.step || "completed",
        checkpoint: result.checkpoint || latestJob.checkpoint,
        lastError: null,
      }, { expectedRevision: latestJob.recordRevision });
    } else if (result.status === STATUS.FAILURE) {
      persistence.updateNpcJob(activeJob.jobID, {
        status: "failed",
        step: result.step || "failed",
        lastError: result.error || "NPC_JOB_HANDLER_FAILED",
      }, { expectedRevision: latestJob.recordRevision });
    } else {
      persistence.updateNpcJob(activeJob.jobID, {
        status: result.status === STATUS.SUSPENDED ? "suspended" : "running",
        step: result.step || latestJob.step,
        checkpoint: result.checkpoint || latestJob.checkpoint,
        nextWakeAtMs: result.nextWakeAtMs || 0,
        lastError: result.error || null,
      }, { expectedRevision: latestJob.recordRevision });
    }
    return { ...result, handled: result.handled !== false, job: activeJob };
  } catch (error) {
    const latestJob = persistence.getNpcJob(activeJob.jobID) || activeJob;
    if (!["completed", "failed", "cancelled"].includes(latestJob.status)) {
      persistence.updateNpcJob(activeJob.jobID, {
        status: "suspended",
        retryCount: Math.max(0, Number(latestJob.retryCount) || 0) + 1,
        nextWakeAtMs: nowMs + 5_000,
        lastError: error.message,
      }, { expectedRevision: latestJob.recordRevision });
    }
    return {
      handled: true,
      status: STATUS.SUSPENDED,
      nextWakeAtMs: nowMs + 5_000,
      error: error.message,
      job: activeJob,
    };
  }
}

module.exports = {
  STATUS,
  action,
  condition,
  sequence,
  selector,
  normalizeResult,
  NpcEventInbox,
  NpcActionLockManager,
  NpcBlackboardStore,
  eventInbox,
  actionLocks,
  blackboards,
  registerNpcJobHandler,
  tickDurableNpcJob,
  _testing: {
    jobHandlers,
  },
};
