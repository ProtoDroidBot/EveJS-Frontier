"use strict";

const crypto = require("crypto");
const path = require("path");

const REQUEST_TABLE = "smartAssemblyRequests";
const STATE_VERSION = 3;
const ASSEMBLY_STATUS_ONLINE = 2;
const ASSEMBLY_STATUS_UNDER_CONSTRUCTION = 5;
const DEFAULT_REQUEST_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_REQUEST_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const DEFAULT_CLAIM_TTL_MS = 30 * 1000;
const MAX_CLAIM_TTL_MS = 5 * 60 * 1000;
const TERMINAL_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_REQUESTS = 5_000;
const MAX_SIGNALS = 10_000;
const MAX_PAYLOAD_BYTES = 16 * 1024;
const MAX_RESULT_BYTES = 16 * 1024;
const MAX_LIST_LIMIT = 250;

/**
 * Urgency is deliberately separate from flags. A request has exactly one
 * scalar urgency, so combining independent reasons can never create
 * contradictory LOW/HIGH bit combinations.
 */
const ASSEMBLY_REQUEST_PRIORITY = Object.freeze({
  BACKGROUND: 0,
  NORMAL: 100,
  HIGH: 200,
  CRITICAL: 300,
});

/**
 * Shared allocation for orthogonal priority reasons. These values are global
 * to every assembly type; never define private overlapping flag bits in an
 * individual assembly runtime.
 */
const ASSEMBLY_REQUEST_PRIORITY_FLAG = Object.freeze({
  SAFETY_CRITICAL: 1 << 0,
  PLAYER_INITIATED: 1 << 1,
  DEFENSE: 1 << 2,
  LOGISTICS: 1 << 3,
  PRODUCTION: 1 << 4,
  MAINTENANCE: 1 << 5,
  ENERGY: 1 << 6,
  NAVIGATION: 1 << 7,
  INTELLIGENCE: 1 << 8,
});
const ASSEMBLY_REQUEST_PRIORITY_FLAG_MASK = Object.values<number>(
  ASSEMBLY_REQUEST_PRIORITY_FLAG,
).reduce((mask, flag) => mask | flag, 0);

const PENDING_STATES = new Set(["queued", "claimed"]);
const TERMINAL_STATES = new Set(["fulfilled", "failed", "cancelled", "expired"]);
const ALL_STATES = new Set([...PENDING_STATES, ...TERMINAL_STATES]);

function cloneValue(value) {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value));
}

function toInt(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.trunc(numeric) : fallback;
}

function normalizeID(value) {
  const numeric = Number(value);
  return Number.isSafeInteger(numeric) && numeric > 0 ? numeric : 0;
}

function normalizeRequestID(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u
    .test(normalized)
    ? normalized
    : null;
}

function normalizeRequestType(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return normalized.length > 0 && normalized.length <= 96 &&
    /^[a-z][a-z0-9]*(?:[._:/-][a-z0-9]+)*$/u.test(normalized)
    ? normalized
    : null;
}

function normalizePriority(value) {
  const numeric = toInt(value, ASSEMBLY_REQUEST_PRIORITY.NORMAL);
  return Object.values<number>(ASSEMBLY_REQUEST_PRIORITY).includes(numeric)
    ? numeric
    : null;
}

function normalizePriorityFlags(value) {
  const numeric = Number(value ?? 0);
  if (!Number.isSafeInteger(numeric) || numeric < 0 || numeric > 0x7fffffff) {
    return null;
  }
  const normalized = numeric >>> 0;
  return (normalized & ~ASSEMBLY_REQUEST_PRIORITY_FLAG_MASK) === 0
    ? normalized
    : null;
}

function normalizeText(value, maxLength) {
  const normalized = String(value || "").trim();
  return normalized ? normalized.slice(0, maxLength) : null;
}

function normalizeJson(value, maxBytes) {
  if (value === undefined) return { success: true, data: null };
  try {
    const serialized = JSON.stringify(value);
    if (serialized === undefined || Buffer.byteLength(serialized, "utf8") > maxBytes) {
      return { success: false, errorMsg: "ASSEMBLY_REQUEST_PAYLOAD_TOO_LARGE" };
    }
    return { success: true, data: JSON.parse(serialized) };
  } catch (_) {
    return { success: false, errorMsg: "ASSEMBLY_REQUEST_PAYLOAD_INVALID" };
  }
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]),
    );
  }
  return value;
}

function stableJson(value) {
  return JSON.stringify(canonicalize(value));
}

function tokenHash(value) {
  return crypto.createHash("sha256").update(String(value || "")).digest("hex");
}

function emptyState() {
  return {
    version: STATE_VERSION,
    nextSequence: 1,
    operationalStates: {},
    requests: {},
    signals: [],
  };
}

function normalizeStoredState(value) {
  const source = value && typeof value === "object" && !Array.isArray(value)
    ? value
    : {};
  const requests = source.requests && typeof source.requests === "object" &&
    !Array.isArray(source.requests)
    ? source.requests
    : {};
  const signals = Array.isArray(source.signals) ? source.signals : [];
  const operationalStates = source.operationalStates &&
    typeof source.operationalStates === "object" &&
    !Array.isArray(source.operationalStates)
    ? source.operationalStates
    : {};
  return {
    version: STATE_VERSION,
    nextSequence: Math.max(1, toInt(source.nextSequence, 1)),
    operationalStates: cloneValue(operationalStates),
    requests: cloneValue(requests),
    signals: cloneValue(signals),
  };
}

function hasAllPriorityFlags(value, requiredMask) {
  const flags = normalizePriorityFlags(value);
  const required = normalizePriorityFlags(requiredMask);
  return flags !== null && required !== null && (flags & required) === required;
}

function hasAnyPriorityFlags(value, anyMask) {
  const flags = normalizePriorityFlags(value);
  const any = normalizePriorityFlags(anyMask);
  return flags !== null && any !== null && (any === 0 || (flags & any) !== 0);
}

function createSmartAssemblyRequestRuntime(options: Record<string, any> = {}) {
  const now = typeof options.now === "function" ? options.now : Date.now;
  const randomUUID = typeof options.randomUUID === "function"
    ? options.randomUUID
    : () => crypto.randomUUID().toLowerCase();
  const repository = options.repository || (() => {
    const { createTableRepository } = require(path.join(
      __dirname,
      "../../gameStore/tableRepository",
    ));
    return createTableRepository("service:frontier", { strict: true });
  })();
  const findAssembly = typeof options.findAssembly === "function"
    ? options.findAssembly
    : (assemblyID) => {
      const item = require(path.join(__dirname, "../inventory/itemStore"))
        .findItemById(assemblyID);
      const state = require(path.join(__dirname, "./deploymentRuntime"))
        .readConstructionState(item);
      return item && state ? { item, state } : null;
    };
  const handlers = new Map();
  const signalListeners = new Map();
  let transitionHooks: Record<string, any> | null = null;

  function readState() {
    repository.ensureTable(REQUEST_TABLE);
    const result = repository.read(REQUEST_TABLE, "/");
    return normalizeStoredState(result && result.success ? result.data : null);
  }

  function writeState(state) {
    state.version = STATE_VERSION;
    if (state.signals.length > MAX_SIGNALS) {
      state.signals.splice(0, state.signals.length - MAX_SIGNALS);
    }
    const result = repository.write(REQUEST_TABLE, "/", state);
    return result && result.success
      ? { success: true as const }
      : { success: false as const, errorMsg: "ASSEMBLY_REQUEST_PERSIST_FAILED" };
  }

  function publishSignals(state, fromSequence) {
    const committedSignals = state.signals.filter(
      (signal) => toInt(signal.sequence, 0) >= fromSequence,
    );
    for (const signal of committedSignals) {
      const recipients = new Set([
        normalizeID(signal.sourceAssemblyID),
        normalizeID(signal.targetAssemblyID),
      ]);
      for (const assemblyID of recipients) {
        if (!assemblyID) continue;
        for (const listener of signalListeners.get(assemblyID) || []) {
          try {
            listener(cloneValue(signal));
          } catch (_) {
            // A local observer is advisory and must never roll back a durable
            // queue transition or prevent other observers from receiving it.
          }
        }
      }
    }
  }

  function getAssembly(assemblyID, settings: Record<string, any> = {}) {
    const numericID = normalizeID(assemblyID);
    if (!numericID) {
      return { success: false as const, errorMsg: "ASSEMBLY_NOT_FOUND" };
    }
    const resolved = findAssembly(numericID);
    const item = resolved && (resolved.item || resolved);
    const state = resolved && resolved.state;
    if (!item || !state) {
      return { success: false as const, errorMsg: "ASSEMBLY_NOT_FOUND" };
    }
    if (state.assemblyStatus === ASSEMBLY_STATUS_UNDER_CONSTRUCTION) {
      return { success: false as const, errorMsg: "ASSEMBLY_UNDER_CONSTRUCTION" };
    }
    if (settings.requireOnline === true &&
        (state.assemblyStatus !== ASSEMBLY_STATUS_ONLINE ||
          toInt(state.activationCompleteAtMs, 0) > 0)) {
      return { success: false as const, errorMsg: "ASSEMBLY_OFFLINE" };
    }
    const ownerID = normalizeID(item.ownerID ?? state.ownerID);
    if (settings.ownerID && ownerID !== normalizeID(settings.ownerID)) {
      return { success: false as const, errorMsg: "ASSEMBLY_ACCESS_DENIED" };
    }
    return { success: true as const, assemblyID: numericID, item, state, ownerID };
  }

  function appendSignal(state, request, kind, actorAssemblyID = null, detail = null) {
    const sequence = state.nextSequence++;
    const signal: Record<string, any> = {
      actorAssemblyID: normalizeID(actorAssemblyID) || null,
      atMs: now(),
      kind,
      requestID: request.requestID,
      revision: request.revision,
      sequence,
      sourceAssemblyID: request.sourceAssemblyID,
      status: request.status,
      targetAssemblyID: request.targetAssemblyID,
    };
    if (detail) signal.detail = detail;
    state.signals.push(signal);
    request.updatedSequence = sequence;
    return signal;
  }

  /**
   * Publish an assembly's current operating state on the same durable,
   * monotonically ordered journal as request lifecycle signals. Operational
   * dimensions live in one structured value (for example `fuel` and `power`),
   * so mutually exclusive levels cannot overwrite unrelated warnings.
   * Repeating an unchanged state is idempotent and does not flood listeners.
   */
  function publishAssemblyStatusSignal(
    assemblyID,
    signalType,
    rawStatus,
    signalOptions: Record<string, any> = {},
  ) {
    const assembly = getAssembly(assemblyID, { ownerID: signalOptions.ownerID });
    if (!assembly.success) return assembly;
    const normalizedType = normalizeRequestType(signalType);
    if (!normalizedType) {
      return { success: false as const, errorMsg: "ASSEMBLY_SIGNAL_TYPE_INVALID" };
    }
    const status = normalizeJson(rawStatus, MAX_PAYLOAD_BYTES);
    if (!status.success || !status.data || typeof status.data !== "object" ||
        Array.isArray(status.data)) {
      return { success: false as const, errorMsg: status.success
        ? "ASSEMBLY_SIGNAL_STATE_INVALID" : status.errorMsg };
    }
    const stateKey = `${assembly.assemblyID}:${normalizedType}`;
    const fingerprint = stableJson(status.data);
    return mutate((state) => {
      const previous = state.operationalStates[stateKey] || null;
      if (previous?.fingerprint === fingerprint) {
        return { success: true as const, changed: false, data: cloneValue(previous) };
      }
      const revision = Math.max(0, toInt(previous?.revision, 0)) + 1;
      const atMs = now();
      const record = {
        assemblyID: assembly.assemblyID,
        fingerprint,
        revision,
        signalType: normalizedType,
        status: cloneValue(status.data),
        updatedAtMs: atMs,
        updatedSequence: state.nextSequence,
      };
      const signal = {
        actorAssemblyID: normalizeID(signalOptions.actorAssemblyID) || assembly.assemblyID,
        atMs,
        kind: "status_changed",
        requestID: null,
        revision,
        sequence: state.nextSequence++,
        sourceAssemblyID: assembly.assemblyID,
        status: "active",
        targetAssemblyID: assembly.assemblyID,
        detail: {
          signalType: normalizedType,
          previous: previous ? cloneValue(previous.status) : null,
          current: cloneValue(status.data),
        },
      };
      record.updatedSequence = signal.sequence;
      state.operationalStates[stateKey] = record;
      state.signals.push(signal);
      return { success: true as const, changed: true, data: cloneValue(record), signal: cloneValue(signal) };
    });
  }

  function getAssemblyOperationalStatus(assemblyID, signalOptions: Record<string, any> = {}) {
    const assembly = getAssembly(assemblyID, { ownerID: signalOptions.ownerID });
    if (!assembly.success) return assembly;
    const requestedType = signalOptions.signalType === undefined
      ? null : normalizeRequestType(signalOptions.signalType);
    if (signalOptions.signalType !== undefined && !requestedType) {
      return { success: false as const, errorMsg: "ASSEMBLY_SIGNAL_TYPE_INVALID" };
    }
    const prefix = `${assembly.assemblyID}:`;
    const records = Object.entries<any>(readReconciledState().operationalStates)
      .filter(([key, record]) => key.startsWith(prefix) &&
        (!requestedType || record?.signalType === requestedType))
      .map(([, record]) => cloneValue(record))
      .sort((left, right) => String(left.signalType).localeCompare(String(right.signalType)));
    return { success: true as const, data: requestedType ? records[0] || null : records };
  }

  function reconcileState(state) {
    const currentTime = now();
    let changed = false;
    for (const request of Object.values<any>(state.requests)) {
      if (!request || typeof request !== "object") continue;
      if (PENDING_STATES.has(request.status) && toInt(request.expiresAtMs, 0) <= currentTime) {
        request.status = "expired";
        request.claimedAtMs = null;
        request.claimExpiresAtMs = null;
        request.claimToken = null;
        request.completedAtMs = currentTime;
        request.revision = Math.max(1, toInt(request.revision, 1)) + 1;
        request.updatedAtMs = currentTime;
        appendSignal(state, request, "expired");
        changed = true;
      } else if (request.status === "claimed" && toInt(request.claimExpiresAtMs, 0) <= currentTime) {
        request.status = "queued";
        request.claimedAtMs = null;
        request.claimExpiresAtMs = null;
        request.claimToken = null;
        request.revision = Math.max(1, toInt(request.revision, 1)) + 1;
        request.updatedAtMs = currentTime;
        appendSignal(state, request, "claim_expired", request.targetAssemblyID);
        changed = true;
      }
    }

    const removable = Object.values<any>(state.requests)
      .filter((request) => request && TERMINAL_STATES.has(request.status))
      .sort((left, right) => toInt(left.completedAtMs, 0) - toInt(right.completedAtMs, 0));
    for (const request of removable) {
      if (toInt(request.completedAtMs, 0) + TERMINAL_RETENTION_MS <= currentTime) {
        delete state.requests[request.requestID];
        changed = true;
      }
    }
    const ordered = Object.values<any>(state.requests)
      .sort((left, right) => toInt(left.createdSequence, 0) - toInt(right.createdSequence, 0));
    while (ordered.length > MAX_REQUESTS) {
      const index = ordered.findIndex((request) => TERMINAL_STATES.has(request.status));
      if (index < 0) break;
      const [request] = ordered.splice(index, 1);
      delete state.requests[request.requestID];
      changed = true;
    }
    return changed;
  }

  function readReconciledState() {
    const state = readState();
    const fromSequence = state.nextSequence;
    if (reconcileState(state)) {
      const persisted = writeState(state);
      if (persisted.success) publishSignals(state, fromSequence);
    }
    return state;
  }

  function mutate(callback) {
    const state = readState();
    const fromSequence = state.nextSequence;
    const reconciled = reconcileState(state);
    const outcome = callback(state);
    if (!outcome || outcome.success !== true) {
      if (reconciled) {
        const persisted = writeState(state);
        if (!persisted.success) return persisted;
        publishSignals(state, fromSequence);
      }
      return outcome;
    }
    const persisted = writeState(state);
    if (!persisted.success) return persisted;
    publishSignals(state, fromSequence);
    return outcome;
  }

  function createRequest(sourceAssemblyID, targetAssemblyID, requestType, requestOptions: Record<string, any> = {}) {
    const source = getAssembly(sourceAssemblyID, {
      ownerID: requestOptions.ownerID,
      requireOnline: true,
    });
    if (!source.success) return source;
    const target = getAssembly(targetAssemblyID);
    if (!target.success) return target;
    if (source.assemblyID === target.assemblyID) {
      return { success: false as const, errorMsg: "ASSEMBLY_REQUEST_SELF_TARGET" };
    }
    if (requestOptions.allowCrossOwner !== true && source.ownerID !== target.ownerID) {
      return { success: false as const, errorMsg: "ASSEMBLY_REQUEST_OWNER_MISMATCH" };
    }
    const normalizedType = normalizeRequestType(requestType);
    if (!normalizedType) {
      return { success: false as const, errorMsg: "ASSEMBLY_REQUEST_TYPE_INVALID" };
    }
    const priority = normalizePriority(requestOptions.priority);
    if (priority === null) {
      return { success: false as const, errorMsg: "ASSEMBLY_REQUEST_PRIORITY_INVALID" };
    }
    const priorityFlags = normalizePriorityFlags(requestOptions.priorityFlags);
    if (priorityFlags === null) {
      return { success: false as const, errorMsg: "ASSEMBLY_REQUEST_PRIORITY_FLAGS_INVALID" };
    }
    const payload = normalizeJson(requestOptions.payload, MAX_PAYLOAD_BYTES);
    if (!payload.success) return payload;
    const createdAtMs = now();
    const requestedTTL = requestOptions.expiresInMs === undefined
      ? DEFAULT_REQUEST_TTL_MS
      : toInt(requestOptions.expiresInMs, 0);
    if (requestedTTL <= 0 || requestedTTL > MAX_REQUEST_TTL_MS) {
      return { success: false as const, errorMsg: "ASSEMBLY_REQUEST_EXPIRY_INVALID" };
    }
    const requestID = requestOptions.requestID
      ? normalizeRequestID(requestOptions.requestID)
      : normalizeRequestID(randomUUID());
    if (!requestID) {
      return { success: false as const, errorMsg: "ASSEMBLY_REQUEST_ID_INVALID" };
    }
    const immutable = {
      expiresAtMs: createdAtMs + requestedTTL,
      requestTtlMs: requestedTTL,
      ownerID: source.ownerID,
      payload: payload.data,
      priority,
      priorityFlags,
      requestType: normalizedType,
      sourceAssemblyID: source.assemblyID,
      targetAssemblyID: target.assemblyID,
    };

    return mutate((state) => {
      const existing = state.requests[requestID];
      if (existing) {
        const comparable = {
          requestTtlMs: existing.requestTtlMs,
          ownerID: existing.ownerID,
          payload: existing.payload,
          priority: existing.priority,
          priorityFlags: existing.priorityFlags,
          requestType: existing.requestType,
          sourceAssemblyID: existing.sourceAssemblyID,
          targetAssemblyID: existing.targetAssemblyID,
        };
        const requestedComparable = { ...immutable };
        delete requestedComparable.expiresAtMs;
        return stableJson(comparable) === stableJson(requestedComparable)
          ? { success: true as const, created: false, data: cloneValue(existing) }
          : { success: false as const, errorMsg: "ASSEMBLY_REQUEST_ID_CONFLICT" };
      }
      const request: Record<string, any> = {
        ...immutable,
        requestID,
        status: "queued",
        revision: 1,
        createdAtMs,
        updatedAtMs: createdAtMs,
        createdSequence: 0,
        updatedSequence: 0,
        claimedAtMs: null,
        claimExpiresAtMs: null,
        claimToken: null,
        completionClaimTokenHash: null,
        completedAtMs: null,
        result: null,
        failure: null,
        chainLink: requestOptions._chainLinkRequired === true ? {
          required: true,
          status: "pending",
          creation: null,
          completion: null,
          error: null,
        } : null,
      };
      const signal = appendSignal(state, request, "created", source.assemblyID);
      request.createdSequence = signal.sequence;
      state.requests[requestID] = request;
      return { success: true as const, created: true, data: cloneValue(request) };
    });
  }

  function normalizeStates(value) {
    if (value === undefined || value === null) return null;
    const values = Array.isArray(value) ? value : [value];
    const normalized = new Set(values.map((entry) => String(entry || "").toLowerCase()));
    return normalized.size > 0 && [...normalized].every((entry) => ALL_STATES.has(entry))
      ? normalized
      : null;
  }

  function listRequests(assemblyID, listOptions: Record<string, any> = {}) {
    const assembly = getAssembly(assemblyID, { ownerID: listOptions.ownerID });
    if (!assembly.success) return assembly;
    const role = String(listOptions.role || "any").toLowerCase();
    if (!["any", "source", "target"].includes(role)) {
      return { success: false as const, errorMsg: "ASSEMBLY_REQUEST_ROLE_INVALID" };
    }
    const states = normalizeStates(listOptions.statuses);
    if (listOptions.statuses !== undefined && !states) {
      return { success: false as const, errorMsg: "ASSEMBLY_REQUEST_STATE_INVALID" };
    }
    const requiredFlags = normalizePriorityFlags(listOptions.requiredPriorityFlags);
    const anyFlags = normalizePriorityFlags(listOptions.anyPriorityFlags);
    if (requiredFlags === null || anyFlags === null) {
      return { success: false as const, errorMsg: "ASSEMBLY_REQUEST_PRIORITY_FLAGS_INVALID" };
    }
    const limit = Math.max(1, Math.min(MAX_LIST_LIMIT, toInt(listOptions.limit, 100)));
    const state = readReconciledState();
    const requests = Object.values<any>(state.requests)
      .filter((request) => {
        const sourceMatch = request.sourceAssemblyID === assembly.assemblyID;
        const targetMatch = request.targetAssemblyID === assembly.assemblyID;
        if (role === "source" && !sourceMatch) return false;
        if (role === "target" && !targetMatch) return false;
        if (role === "any" && !sourceMatch && !targetMatch) return false;
        if (states && !states.has(request.status)) return false;
        return hasAllPriorityFlags(request.priorityFlags, requiredFlags) &&
          hasAnyPriorityFlags(request.priorityFlags, anyFlags);
      })
      .sort((left, right) => (
        toInt(right.priority, 0) - toInt(left.priority, 0) ||
        toInt(left.createdSequence, 0) - toInt(right.createdSequence, 0) ||
        String(left.requestID).localeCompare(String(right.requestID))
      ))
      .slice(0, limit)
      .map(cloneValue);
    return { success: true as const, data: requests };
  }

  function getRequest(requestID) {
    const normalizedID = normalizeRequestID(requestID);
    if (!normalizedID) {
      return { success: false as const, errorMsg: "ASSEMBLY_REQUEST_NOT_FOUND" };
    }
    const request = readReconciledState().requests[normalizedID];
    return request
      ? { success: true as const, data: cloneValue(request) }
      : { success: false as const, errorMsg: "ASSEMBLY_REQUEST_NOT_FOUND" };
  }

  function validateActorForRequest(request, assemblyID, role, actorOptions) {
    const actor = getAssembly(assemblyID, {
      ownerID: actorOptions && actorOptions.ownerID,
      requireOnline: actorOptions && actorOptions.requireOnline,
    });
    if (!actor.success) return actor;
    const expected = role === "source"
      ? request.sourceAssemblyID
      : request.targetAssemblyID;
    return actor.assemblyID === expected
      ? actor
      : { success: false as const, errorMsg: "ASSEMBLY_REQUEST_ACTOR_MISMATCH" };
  }

  function claimRequest(targetAssemblyID, requestID, claimOptions: Record<string, any> = {}) {
    const normalizedID = normalizeRequestID(requestID);
    if (!normalizedID) {
      return { success: false as const, errorMsg: "ASSEMBLY_REQUEST_NOT_FOUND" };
    }
    const claimTTL = claimOptions.claimTtlMs === undefined
      ? DEFAULT_CLAIM_TTL_MS
      : toInt(claimOptions.claimTtlMs, 0);
    if (claimTTL <= 0 || claimTTL > MAX_CLAIM_TTL_MS) {
      return { success: false as const, errorMsg: "ASSEMBLY_REQUEST_CLAIM_EXPIRY_INVALID" };
    }
    return mutate((state) => {
      const request = state.requests[normalizedID];
      if (!request) return { success: false as const, errorMsg: "ASSEMBLY_REQUEST_NOT_FOUND" };
      const actor = validateActorForRequest(request, targetAssemblyID, "target", {
        ownerID: claimOptions.ownerID,
        requireOnline: true,
      });
      if (!actor.success) return actor;
      if (request.status === "claimed") {
        return { success: true as const, claimed: false, data: cloneValue(request) };
      }
      if (request.status !== "queued") {
        return { success: false as const, errorMsg: "ASSEMBLY_REQUEST_NOT_CLAIMABLE" };
      }
      if (request.chainLink?.required === true &&
          (request.chainLink.status !== "confirmed" || !request.chainLink.creation ||
            claimOptions._chainVerified !== true)) {
        return { success: false as const, errorMsg: "ASSEMBLY_REQUEST_CHAIN_PROOF_REQUIRED" };
      }
      request.status = "claimed";
      request.claimToken = randomUUID().toLowerCase();
      request.claimedAtMs = now();
      request.claimExpiresAtMs = request.claimedAtMs + claimTTL;
      request.updatedAtMs = request.claimedAtMs;
      request.revision += 1;
      appendSignal(state, request, "claimed", actor.assemblyID);
      return { success: true as const, claimed: true, data: cloneValue(request) };
    });
  }

  function requireClaim(request, token) {
    if (request.status !== "claimed") {
      return { success: false as const, errorMsg: "ASSEMBLY_REQUEST_NOT_CLAIMED" };
    }
    const normalized = String(token || "").trim().toLowerCase();
    return normalized && normalized === request.claimToken
      ? { success: true as const }
      : { success: false as const, errorMsg: "ASSEMBLY_REQUEST_CLAIM_TOKEN_INVALID" };
  }

  function renewClaim(targetAssemblyID, requestID, claimToken, renewOptions: Record<string, any> = {}) {
    const normalizedID = normalizeRequestID(requestID);
    const claimTTL = renewOptions.claimTtlMs === undefined
      ? DEFAULT_CLAIM_TTL_MS
      : toInt(renewOptions.claimTtlMs, 0);
    if (!normalizedID) return { success: false as const, errorMsg: "ASSEMBLY_REQUEST_NOT_FOUND" };
    if (claimTTL <= 0 || claimTTL > MAX_CLAIM_TTL_MS) {
      return { success: false as const, errorMsg: "ASSEMBLY_REQUEST_CLAIM_EXPIRY_INVALID" };
    }
    return mutate((state) => {
      const request = state.requests[normalizedID];
      if (!request) return { success: false as const, errorMsg: "ASSEMBLY_REQUEST_NOT_FOUND" };
      const actor = validateActorForRequest(request, targetAssemblyID, "target", {
        ownerID: renewOptions.ownerID,
        requireOnline: true,
      });
      if (!actor.success) return actor;
      const claim = requireClaim(request, claimToken);
      if (!claim.success) return claim;
      request.claimExpiresAtMs = now() + claimTTL;
      request.updatedAtMs = now();
      request.revision += 1;
      appendSignal(state, request, "claim_renewed", actor.assemblyID);
      return { success: true as const, data: cloneValue(request) };
    });
  }

  function releaseClaim(targetAssemblyID, requestID, claimToken, releaseOptions: Record<string, any> = {}) {
    const normalizedID = normalizeRequestID(requestID);
    if (!normalizedID) return { success: false as const, errorMsg: "ASSEMBLY_REQUEST_NOT_FOUND" };
    return mutate((state) => {
      const request = state.requests[normalizedID];
      if (!request) return { success: false as const, errorMsg: "ASSEMBLY_REQUEST_NOT_FOUND" };
      const actor = validateActorForRequest(request, targetAssemblyID, "target", {
        ownerID: releaseOptions.ownerID,
      });
      if (!actor.success) return actor;
      const claim = requireClaim(request, claimToken);
      if (!claim.success) return claim;
      request.status = "queued";
      request.claimToken = null;
      request.claimedAtMs = null;
      request.claimExpiresAtMs = null;
      request.updatedAtMs = now();
      request.revision += 1;
      appendSignal(state, request, "released", actor.assemblyID);
      return { success: true as const, data: cloneValue(request) };
    });
  }

  function completeRequest(targetAssemblyID, requestID, claimToken, status, value, completeOptions: Record<string, any> = {}) {
    const normalizedID = normalizeRequestID(requestID);
    if (!normalizedID) return { success: false as const, errorMsg: "ASSEMBLY_REQUEST_NOT_FOUND" };
    const normalizedValue = normalizeJson(value, MAX_RESULT_BYTES);
    if (!normalizedValue.success) return normalizedValue;
    return mutate((state) => {
      const request = state.requests[normalizedID];
      if (!request) return { success: false as const, errorMsg: "ASSEMBLY_REQUEST_NOT_FOUND" };
      const actor = validateActorForRequest(request, targetAssemblyID, "target", {
        ownerID: completeOptions.ownerID,
      });
      if (!actor.success) return actor;
      const normalizedClaimToken = String(claimToken || "").trim().toLowerCase();
      const completionField = status === "fulfilled" ? "result" : "failure";
      if (TERMINAL_STATES.has(request.status)) {
        const replayMatches = request.status === status &&
          request.completionClaimTokenHash === tokenHash(normalizedClaimToken) &&
          stableJson(request[completionField]) === stableJson(normalizedValue.data);
        return replayMatches
          ? { success: true as const, completed: false, data: cloneValue(request) }
          : { success: false as const, errorMsg: "ASSEMBLY_REQUEST_COMPLETION_CONFLICT" };
      }
      if (request.chainLink?.required === true &&
          (request.chainLink.status !== "confirmed" || completeOptions._chainVerified !== true ||
            !completeOptions._completionProof)) {
        return { success: false as const, errorMsg: "ASSEMBLY_REQUEST_CHAIN_PROOF_REQUIRED" };
      }
      const onlineActor = validateActorForRequest(request, targetAssemblyID, "target", {
        ownerID: completeOptions.ownerID,
        requireOnline: true,
      });
      if (!onlineActor.success) return onlineActor;
      const claim = requireClaim(request, claimToken);
      if (!claim.success) return claim;
      request.status = status;
      request.claimToken = null;
      request.completionClaimTokenHash = tokenHash(normalizedClaimToken);
      request.claimExpiresAtMs = null;
      request.completedAtMs = now();
      request.updatedAtMs = request.completedAtMs;
      request.revision += 1;
      if (status === "fulfilled") request.result = normalizedValue.data;
      else request.failure = normalizedValue.data;
      if (request.chainLink?.required === true) {
        request.chainLink.completion = cloneValue(completeOptions._completionProof);
        request.chainLink.status = "completed";
      }
      appendSignal(state, request, status, actor.assemblyID);
      return { success: true as const, completed: true, data: cloneValue(request) };
    });
  }

  function fulfillRequest(targetAssemblyID, requestID, claimToken, result, completeOptions = {}) {
    return completeRequest(
      targetAssemblyID,
      requestID,
      claimToken,
      "fulfilled",
      result,
      completeOptions,
    );
  }

  function failRequest(targetAssemblyID, requestID, claimToken, failure, completeOptions = {}) {
    return completeRequest(
      targetAssemblyID,
      requestID,
      claimToken,
      "failed",
      failure,
      completeOptions,
    );
  }

  function cancelRequest(sourceAssemblyID, requestID, cancelOptions: Record<string, any> = {}) {
    const normalizedID = normalizeRequestID(requestID);
    if (!normalizedID) return { success: false as const, errorMsg: "ASSEMBLY_REQUEST_NOT_FOUND" };
    return mutate((state) => {
      const request = state.requests[normalizedID];
      if (!request) return { success: false as const, errorMsg: "ASSEMBLY_REQUEST_NOT_FOUND" };
      const actor = validateActorForRequest(request, sourceAssemblyID, "source", {
        ownerID: cancelOptions.ownerID,
      });
      if (!actor.success) return actor;
      if (request.status === "cancelled") {
        return { success: true as const, cancelled: false, data: cloneValue(request) };
      }
      if (!PENDING_STATES.has(request.status)) {
        return { success: false as const, errorMsg: "ASSEMBLY_REQUEST_NOT_CANCELLABLE" };
      }
      if (request.chainLink?.required === true &&
          (request.chainLink.status !== "confirmed" || cancelOptions._chainVerified !== true ||
            !cancelOptions._completionProof)) {
        return { success: false as const, errorMsg: "ASSEMBLY_REQUEST_CHAIN_PROOF_REQUIRED" };
      }
      request.status = "cancelled";
      request.claimToken = null;
      request.claimExpiresAtMs = null;
      request.completedAtMs = now();
      request.updatedAtMs = request.completedAtMs;
      request.revision += 1;
      request.failure = normalizeText(cancelOptions.reason, 256) || "CANCELLED_BY_SOURCE";
      if (request.chainLink?.required === true) {
        request.chainLink.completion = cloneValue(cancelOptions._completionProof);
        request.chainLink.status = "completed";
      }
      appendSignal(state, request, "cancelled", actor.assemblyID);
      return { success: true as const, cancelled: true, data: cloneValue(request) };
    });
  }

  function cancelRequestsForAssembly(assemblyID, reason = "ASSEMBLY_REMOVED") {
    const numericID = normalizeID(assemblyID);
    if (!numericID) return { success: false as const, errorMsg: "ASSEMBLY_NOT_FOUND" };
    return mutate((state) => {
      const cancelled: any[] = [];
      const operationalPrefix = `${numericID}:`;
      for (const key of Object.keys(state.operationalStates)) {
        if (key.startsWith(operationalPrefix)) delete state.operationalStates[key];
      }
      for (const request of Object.values<any>(state.requests)) {
        if (!PENDING_STATES.has(request.status) ||
            (request.sourceAssemblyID !== numericID && request.targetAssemblyID !== numericID)) {
          continue;
        }
        request.status = "cancelled";
        request.claimToken = null;
        request.claimExpiresAtMs = null;
        request.completedAtMs = now();
        request.updatedAtMs = request.completedAtMs;
        request.revision += 1;
        request.failure = normalizeText(reason, 256) || "ASSEMBLY_REMOVED";
        if (request.chainLink?.required === true) {
          request.chainLink.status = "revoked_locally";
          request.chainLink.error = request.failure;
        }
        appendSignal(state, request, "cancelled", numericID, { reason: request.failure });
        cancelled.push(cloneValue(request));
      }
      return { success: true as const, data: cancelled };
    });
  }

  function attachCreationChainProof(requestID, proof) {
    const normalizedID = normalizeRequestID(requestID);
    if (!normalizedID) return { success: false as const, errorMsg: "ASSEMBLY_REQUEST_NOT_FOUND" };
    return mutate((state) => {
      const request = state.requests[normalizedID];
      if (!request) return { success: false as const, errorMsg: "ASSEMBLY_REQUEST_NOT_FOUND" };
      if (request.chainLink?.required !== true || request.status !== "queued") {
        return { success: false as const, errorMsg: "ASSEMBLY_REQUEST_CHAIN_PROOF_CONFLICT" };
      }
      if (request.chainLink.status === "confirmed") {
        return stableJson(request.chainLink.creation) === stableJson(proof)
          ? { success: true as const, linked: false, data: cloneValue(request) }
          : { success: false as const, errorMsg: "ASSEMBLY_REQUEST_CHAIN_PROOF_CONFLICT" };
      }
      request.chainLink.creation = cloneValue(proof);
      request.chainLink.status = "confirmed";
      request.chainLink.error = null;
      request.updatedAtMs = now();
      request.revision += 1;
      appendSignal(state, request, "chain_linked", request.sourceAssemblyID, {
        attestationHash: proof?.attestationHash ?? null,
        chainID: proof?.chainID ?? null,
      });
      return { success: true as const, linked: true, data: cloneValue(request) };
    });
  }

  function rejectCreationChainProof(requestID, error) {
    const normalizedID = normalizeRequestID(requestID);
    if (!normalizedID) return { success: false as const, errorMsg: "ASSEMBLY_REQUEST_NOT_FOUND" };
    return mutate((state) => {
      const request = state.requests[normalizedID];
      if (!request) return { success: false as const, errorMsg: "ASSEMBLY_REQUEST_NOT_FOUND" };
      if (request.chainLink?.required !== true || request.chainLink.status === "confirmed") {
        return { success: false as const, errorMsg: "ASSEMBLY_REQUEST_CHAIN_PROOF_CONFLICT" };
      }
      request.status = "failed";
      request.failure = {
        code: "ASSEMBLY_REQUEST_CHAIN_LINK_FAILED",
        message: normalizeText(error && error.message, 512) || "Sui request attestation failed.",
      };
      request.chainLink.status = "failed";
      request.chainLink.error = request.failure.message;
      request.completedAtMs = now();
      request.updatedAtMs = request.completedAtMs;
      request.revision += 1;
      appendSignal(state, request, "chain_link_failed", request.sourceAssemblyID);
      return { success: true as const, data: cloneValue(request) };
    });
  }

  function listSignals(assemblyID, signalOptions: Record<string, any> = {}) {
    const assembly = getAssembly(assemblyID, { ownerID: signalOptions.ownerID });
    if (!assembly.success) return assembly;
    const afterSequence = Math.max(0, toInt(signalOptions.afterSequence, 0));
    const limit = Math.max(1, Math.min(MAX_LIST_LIMIT, toInt(signalOptions.limit, 100)));
    const state = readReconciledState();
    const oldestSequence = state.signals.length > 0
      ? toInt(state.signals[0].sequence, 0)
      : state.nextSequence;
    const signals = state.signals
      .filter((signal) => toInt(signal.sequence, 0) > afterSequence &&
        (signal.sourceAssemblyID === assembly.assemblyID ||
          signal.targetAssemblyID === assembly.assemblyID))
      .sort((left, right) => toInt(left.sequence, 0) - toInt(right.sequence, 0))
      .slice(0, limit)
      .map(cloneValue);
    return {
      success: true as const,
      data: {
        nextSequence: signals.length > 0
          ? signals[signals.length - 1].sequence
          : afterSequence,
        oldestSequence,
        truncated: afterSequence > 0 && afterSequence < oldestSequence - 1,
        signals,
      },
    };
  }

  function registerHandler(requestType, handler, handlerOptions: Record<string, any> = {}) {
    const normalizedType = normalizeRequestType(requestType);
    if (!normalizedType || typeof handler !== "function") {
      throw new Error("registerHandler requires a valid request type and handler");
    }
    const acceptedPriorityFlags = handlerOptions.acceptedPriorityFlags === undefined
      ? ASSEMBLY_REQUEST_PRIORITY_FLAG_MASK
      : normalizePriorityFlags(handlerOptions.acceptedPriorityFlags);
    if (acceptedPriorityFlags === null) {
      throw new Error("registerHandler received unknown priority flag bits");
    }
    const registration = { handler, acceptedPriorityFlags };
    handlers.set(normalizedType, registration);
    return () => {
      if (handlers.get(normalizedType) === registration) handlers.delete(normalizedType);
    };
  }

  function subscribeToSignals(assemblyID, listener) {
    const numericID = normalizeID(assemblyID);
    if (!numericID || typeof listener !== "function") {
      throw new Error("subscribeToSignals requires an assembly ID and listener");
    }
    if (!signalListeners.has(numericID)) signalListeners.set(numericID, new Set());
    const listeners = signalListeners.get(numericID);
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) signalListeners.delete(numericID);
    };
  }

  async function processNextRequest(targetAssemblyID, processOptions: Record<string, any> = {}) {
    const queue = listRequests(targetAssemblyID, {
      ownerID: processOptions.ownerID,
      role: "target",
      statuses: ["queued"],
      limit: MAX_LIST_LIMIT,
    });
    if (!queue.success) return queue;
    const candidate = (queue as any).data.find((request) => {
      const registration = handlers.get(request.requestType);
      return registration &&
        hasAllPriorityFlags(registration.acceptedPriorityFlags, request.priorityFlags);
    });
    if (!candidate) return { success: true as const, processed: false, data: null };
    const claimed = await (transitionHooks?.claimRequest ?? claimRequest)(targetAssemblyID, candidate.requestID, {
      ownerID: processOptions.ownerID,
      claimTtlMs: processOptions.claimTtlMs,
    });
    if (!claimed.success) return claimed;
    const registration = handlers.get(candidate.requestType);
    if (!registration) {
      releaseClaim(targetAssemblyID, candidate.requestID, claimed.data.claimToken, {
        ownerID: processOptions.ownerID,
      });
      return { success: true as const, processed: false, data: null };
    }
    try {
      const result = await registration.handler(cloneValue(claimed.data), {
        targetAssemblyID: normalizeID(targetAssemblyID),
      });
      const fulfilled = await (transitionHooks?.fulfillRequest ?? fulfillRequest)(
        targetAssemblyID,
        candidate.requestID,
        claimed.data.claimToken,
        result,
        { ownerID: processOptions.ownerID },
      );
      return fulfilled.success
        ? { success: true as const, processed: true, data: fulfilled.data }
        : fulfilled;
    } catch (error) {
      const failure = {
        code: normalizeText(error && error.code, 96) || "ASSEMBLY_REQUEST_HANDLER_FAILED",
        message: normalizeText(error && error.message, 512) || "Assembly request handler failed.",
      };
      const failed = await (transitionHooks?.failRequest ?? failRequest)(
        targetAssemblyID,
        candidate.requestID,
        claimed.data.claimToken,
        failure,
        { ownerID: processOptions.ownerID },
      );
      return failed.success
        ? { success: false as const, processed: true, errorMsg: failure.code, data: failed.data }
        : failed;
    }
  }

  return {
    createRequest,
    listRequests,
    getRequest,
    claimRequest,
    renewClaim,
    releaseClaim,
    fulfillRequest,
    failRequest,
    cancelRequest,
    cancelRequestsForAssembly,
    attachCreationChainProof,
    rejectCreationChainProof,
    publishAssemblyStatusSignal,
    getAssemblyOperationalStatus,
    listSignals,
    subscribeToSignals,
    registerHandler,
    processNextRequest,
    _setTransitionHooks(value) { transitionHooks = value; },
    _testing: { readState, reconcileState },
  };
}

const runtime = createSmartAssemblyRequestRuntime();

function requestLinkBridge() {
  return require("./suiAssemblyRequestLink").getSuiAssemblyRequestLinkBridge();
}

function chainFailure(error) {
  return {
    success: false as const,
    errorMsg: String(error && error.code || "ASSEMBLY_REQUEST_CHAIN_LINK_FAILED"),
  };
}

function createLinkedRequest(sourceAssemblyID, targetAssemblyID, requestType,
  requestOptions: Record<string, any> = {}) {
  const bridge = requestLinkBridge();
  if (!bridge) return runtime.createRequest(sourceAssemblyID, targetAssemblyID, requestType, requestOptions);
  const created = runtime.createRequest(sourceAssemblyID, targetAssemblyID, requestType, {
    ...requestOptions,
    _chainLinkRequired: true,
  });
  if (!created.success) return created;
  if (created.data.chainLink?.status === "confirmed") return created;
  if (!created.created && created.data.chainLink?.status !== "pending") {
    return { success: false as const, errorMsg: "ASSEMBLY_REQUEST_CHAIN_LINK_FAILED" };
  }
  return (async () => {
    try {
      const proof = await bridge.attestCreation(created.data);
      if (!await bridge.verifyCreation(created.data, proof)) {
        throw Object.assign(new Error("The generated Sui request attestation did not verify"), {
          code: "ASSEMBLY_REQUEST_CHAIN_PROOF_INVALID",
        });
      }
      return runtime.attachCreationChainProof(created.data.requestID, proof);
    } catch (error) {
      runtime.rejectCreationChainProof(created.data.requestID, error);
      return chainFailure(error);
    }
  })();
}

function claimLinkedRequest(targetAssemblyID, requestID, claimOptions: Record<string, any> = {}) {
  const bridge = requestLinkBridge();
  if (!bridge) return runtime.claimRequest(targetAssemblyID, requestID, claimOptions);
  return (async () => {
    try {
      const found = runtime.getRequest(requestID);
      if (!found.success) return found;
      const request = found.data;
      if (request.chainLink?.required !== true || !request.chainLink.creation) {
        return { success: false as const, errorMsg: "ASSEMBLY_REQUEST_CHAIN_PROOF_REQUIRED" };
      }
      if (!await bridge.verifyCreation(request, request.chainLink.creation)) {
        return { success: false as const, errorMsg: "ASSEMBLY_REQUEST_CHAIN_PROOF_INVALID" };
      }
      return runtime.claimRequest(targetAssemblyID, requestID, {
        ...claimOptions,
        _chainVerified: true,
      });
    } catch (error) {
      return chainFailure(error);
    }
  })();
}

function completeLinkedRequest(targetAssemblyID, requestID, claimToken, phase, outcome,
  completeOptions: Record<string, any> = {}) {
  const bridge = requestLinkBridge();
  const localComplete = phase === "fulfilled" ? runtime.fulfillRequest : runtime.failRequest;
  if (!bridge) return localComplete(targetAssemblyID, requestID, claimToken, outcome, completeOptions);
  return (async () => {
    try {
      const found = runtime.getRequest(requestID);
      if (!found.success) return found;
      const request = found.data;
      const creation = request.chainLink?.creation;
      if (request.chainLink?.required !== true || !creation) {
        return { success: false as const, errorMsg: "ASSEMBLY_REQUEST_CHAIN_PROOF_REQUIRED" };
      }
      if (!await bridge.verifyCreation(request, creation)) {
        return { success: false as const, errorMsg: "ASSEMBLY_REQUEST_CHAIN_PROOF_INVALID" };
      }
      let proof = request.chainLink.completion;
      if (TERMINAL_STATES.has(request.status)) {
        if (request.status !== phase) {
          return { success: false as const, errorMsg: "ASSEMBLY_REQUEST_COMPLETION_CONFLICT" };
        }
        if (!proof || !await bridge.verifyTerminal(request, phase, outcome, proof)) {
          return { success: false as const, errorMsg: "ASSEMBLY_REQUEST_CHAIN_PROOF_INVALID" };
        }
      } else {
        proof = await bridge.attestTerminal(request, phase, outcome);
        if (!await bridge.verifyTerminal(request, phase, outcome, proof)) {
          return { success: false as const, errorMsg: "ASSEMBLY_REQUEST_CHAIN_PROOF_INVALID" };
        }
      }
      return localComplete(targetAssemblyID, requestID, claimToken, outcome, {
        ...completeOptions,
        _chainVerified: true,
        _completionProof: proof,
      });
    } catch (error) {
      return chainFailure(error);
    }
  })();
}

function cancelLinkedRequest(sourceAssemblyID, requestID, cancelOptions: Record<string, any> = {}) {
  const bridge = requestLinkBridge();
  if (!bridge) return runtime.cancelRequest(sourceAssemblyID, requestID, cancelOptions);
  return (async () => {
    try {
      const found = runtime.getRequest(requestID);
      if (!found.success) return found;
      const request = found.data;
      const creation = request.chainLink?.creation;
      if (request.chainLink?.required !== true || !creation) {
        return { success: false as const, errorMsg: "ASSEMBLY_REQUEST_CHAIN_PROOF_REQUIRED" };
      }
      if (!await bridge.verifyCreation(request, creation)) {
        return { success: false as const, errorMsg: "ASSEMBLY_REQUEST_CHAIN_PROOF_INVALID" };
      }
      const outcome = normalizeText(cancelOptions.reason, 256) || "CANCELLED_BY_SOURCE";
      let proof = request.chainLink.completion;
      if (request.status === "cancelled") {
        if (!proof || !await bridge.verifyTerminal(request, "cancelled", outcome, proof)) {
          return { success: false as const, errorMsg: "ASSEMBLY_REQUEST_CHAIN_PROOF_INVALID" };
        }
      } else if (TERMINAL_STATES.has(request.status)) {
        return { success: false as const, errorMsg: "ASSEMBLY_REQUEST_NOT_CANCELLABLE" };
      } else {
        proof = await bridge.attestTerminal(request, "cancelled", outcome);
        if (!await bridge.verifyTerminal(request, "cancelled", outcome, proof)) {
          return { success: false as const, errorMsg: "ASSEMBLY_REQUEST_CHAIN_PROOF_INVALID" };
        }
      }
      return runtime.cancelRequest(sourceAssemblyID, requestID, {
        ...cancelOptions,
        _chainVerified: true,
        _completionProof: proof,
      });
    } catch (error) {
      return chainFailure(error);
    }
  })();
}

const linkedTransitions = {
  claimRequest: claimLinkedRequest,
  fulfillRequest: (targetAssemblyID, requestID, claimToken, result, options) =>
    completeLinkedRequest(targetAssemblyID, requestID, claimToken, "fulfilled", result, options),
  failRequest: (targetAssemblyID, requestID, claimToken, failure, options) =>
    completeLinkedRequest(targetAssemblyID, requestID, claimToken, "failed", failure, options),
};
runtime._setTransitionHooks(linkedTransitions);

module.exports = {
  REQUEST_TABLE,
  ASSEMBLY_REQUEST_PRIORITY,
  ASSEMBLY_REQUEST_PRIORITY_FLAG,
  ASSEMBLY_REQUEST_PRIORITY_FLAG_MASK,
  hasAllPriorityFlags,
  hasAnyPriorityFlags,
  createSmartAssemblyRequestRuntime,
  ...runtime,
  createRequest: createLinkedRequest,
  claimRequest: claimLinkedRequest,
  fulfillRequest: linkedTransitions.fulfillRequest,
  failRequest: linkedTransitions.failRequest,
  cancelRequest: cancelLinkedRequest,
};
