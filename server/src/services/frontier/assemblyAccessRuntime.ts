"use strict";

const crypto = require("crypto");
const path = require("path");

const ASSEMBLY_ACCESS_TABLE = "assemblyAccessPolicies";
const STATE_VERSION = 1;
const ASSEMBLY_STATUS_UNDER_CONSTRUCTION = 5;
const DEFAULT_REQUEST_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_REQUEST_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const DEFAULT_GRANT_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_GRANT_TTL_MS = 365 * 24 * 60 * 60 * 1000;
const DEFAULT_GUI_SESSION_TTL_MS = 2 * 60 * 1000;
const MAX_GUI_SESSION_TTL_MS = 5 * 60 * 1000;
const MAX_DELEGATION_DEPTH = 8;
const MAX_EVENTS = 20_000;
const MAX_REASON_LENGTH = 512;

const ASSEMBLY_ACCESS_CAPABILITY = Object.freeze({
  GUI_VIEW: "gui.view",
  OPERATE: "operate",
  INVENTORY_DEPOSIT: "inventory.deposit",
  INVENTORY_WITHDRAW: "inventory.withdraw",
  CONFIGURE: "configure",
  MANAGE_ACCESS: "manage_access",
});
const ALL_CAPABILITIES = Object.freeze(Object.values<string>(ASSEMBLY_ACCESS_CAPABILITY));
const CAPABILITY_SET = new Set(ALL_CAPABILITIES);
const REQUEST_STATES = new Set(["requested", "approved", "denied", "cancelled", "expired"]);
const ACTIVE_REQUEST_STATES = new Set(["requested"]);
const ACTIVE_GRANT_STATES = new Set(["active"]);

function cloneValue(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function toPositiveInt(value) {
  const numeric = Number(value);
  return Number.isSafeInteger(numeric) && numeric > 0 ? numeric : 0;
}

function toNonNegativeInt(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isSafeInteger(numeric) && numeric >= 0 ? numeric : fallback;
}

function normalizeUUID(value) {
  const text = String(value || "").trim().toLowerCase();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u
    .test(text) ? text : null;
}

function normalizeIdempotencyKey(value) {
  const text = String(value || "").trim();
  return text && text.length <= 160 && /^[A-Za-z0-9._:/-]+$/u.test(text) ? text : null;
}

function normalizeReason(value) {
  const text = String(value || "").trim();
  return text ? text.slice(0, MAX_REASON_LENGTH) : null;
}

function normalizeFactionKey(value) {
  const text = String(value || "").trim().toLowerCase();
  return /^(0|[1-9][0-9]*)-[a-z0-9][a-z0-9_-]{0,95}$/u.test(text)
    ? text : null;
}

function normalizePrincipal(value) {
  if (typeof value === "string") {
    const text = value.trim().toLowerCase();
    const entity = /^entity:(player|npc):([1-9][0-9]*)$/u.exec(text);
    if (entity && toPositiveInt(entity[2])) return `entity:${entity[1]}:${Number(entity[2])}`;
    const tribe = /^tribe:([1-9][0-9]*)$/u.exec(text);
    if (tribe && toPositiveInt(tribe[1])) return `tribe:${Number(tribe[1])}`;
    const faction = /^faction:(.+)$/u.exec(text);
    const factionKey = faction && normalizeFactionKey(faction[1]);
    return factionKey ? `faction:${factionKey}` : null;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const kind = String(value.kind || value.type || "").trim().toLowerCase();
  const id = value.id ?? value.actorID ?? value.characterID;
  if (kind === "player" || kind === "npc") {
    const numericID = toPositiveInt(id);
    return numericID ? `entity:${kind}:${numericID}` : null;
  }
  if (kind === "entity") {
    const entityKind = String(value.entityKind || value.entity_kind || "").trim().toLowerCase();
    const numericID = toPositiveInt(id);
    return numericID && (entityKind === "player" || entityKind === "npc")
      ? `entity:${entityKind}:${numericID}` : null;
  }
  if (kind === "tribe") {
    const numericID = toPositiveInt(value.tribeID ?? value.tribeId ?? id);
    return numericID ? `tribe:${numericID}` : null;
  }
  if (kind === "faction") {
    const key = normalizeFactionKey(value.factionKey ?? value.faction_key ?? id);
    return key ? `faction:${key}` : null;
  }
  return null;
}

function principalKind(principal) {
  const normalized = normalizePrincipal(principal);
  if (!normalized) return null;
  if (normalized.startsWith("entity:player:")) return "player";
  if (normalized.startsWith("entity:npc:")) return "npc";
  if (normalized.startsWith("tribe:")) return "tribe";
  return "faction";
}

function normalizeCapabilities(value, supported = ALL_CAPABILITIES) {
  const allowed = new Set(Array.isArray(supported) ? supported : ALL_CAPABILITIES);
  const source = Array.isArray(value) ? value : typeof value === "string" ? [value] : [];
  const result = [...new Set(source.map((entry) => String(entry || "").trim().toLowerCase()))]
    .filter((entry) => CAPABILITY_SET.has(entry) && allowed.has(entry))
    .sort();
  return result.length > 0 && result.length === source.length ? result : null;
}

function includesCapabilities(available, required) {
  const set = new Set(Array.isArray(available) ? available : []);
  return (Array.isArray(required) ? required : []).every((capability) => set.has(capability));
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

function operationFingerprint(value) {
  return crypto.createHash("sha256").update(JSON.stringify(canonicalize(value))).digest("hex");
}

function emptyState() {
  return {
    version: STATE_VERSION,
    nextSequence: 1,
    policyRevisions: {},
    requests: {},
    grants: {},
    events: [],
  };
}

function normalizeStoredState(value) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  return {
    version: STATE_VERSION,
    nextSequence: Math.max(1, toPositiveInt(source.nextSequence) || 1),
    policyRevisions: cloneValue(source.policyRevisions && typeof source.policyRevisions === "object"
      ? source.policyRevisions : {}),
    requests: cloneValue(source.requests && typeof source.requests === "object" ? source.requests : {}),
    grants: cloneValue(source.grants && typeof source.grants === "object" ? source.grants : {}),
    events: cloneValue(Array.isArray(source.events) ? source.events : []),
  };
}

function parseEntityPrincipal(principal) {
  const match = /^entity:(player|npc):([1-9][0-9]*)$/u.exec(String(principal || ""));
  return match ? { kind: match[1], actorID: Number(match[2]), principal: match[0] } : null;
}

function defaultResolveSubject(actor) {
  const explicit = normalizePrincipal(actor && actor.principal || actor);
  let entity = explicit && parseEntityPrincipal(explicit);
  if (!entity && actor && typeof actor === "object") {
    const npc = actor.kind === "npc";
    const actorID = toPositiveInt(actor.actorID ?? actor.characterID ?? actor.charid);
    if (actorID) entity = {
      kind: npc ? "npc" : "player",
      actorID,
      principal: `entity:${npc ? "npc" : "player"}:${actorID}`,
    };
  }
  if (!entity) return { success: false as const, errorMsg: "ASSEMBLY_ACCESS_SUBJECT_INVALID" };

  const scopes = new Set([entity.principal]);
  if (entity.kind === "npc") {
    const pilot = require(path.join(__dirname, "../../space/npc/npcPilotIdentityStore"))
      .getNpcPilotIdentityStore().get(entity.actorID);
    if (!pilot) return { success: false as const, errorMsg: "ASSEMBLY_ACCESS_SUBJECT_NOT_FOUND" };
    const expectedShipID = toPositiveInt(actor && actor.shipID);
    const expectedIncarnation = toPositiveInt(actor && actor.incarnation);
    if ((expectedShipID && Number(pilot.activeEntityID) !== expectedShipID) ||
        (expectedIncarnation && Number(pilot.incarnation) !== expectedIncarnation)) {
      return { success: false as const, errorMsg: "ASSEMBLY_ACCESS_SUBJECT_STALE" };
    }
    const factionKey = normalizeFactionKey(pilot.factionKey);
    if (factionKey && factionKey !== "0-none") scopes.add(`faction:${factionKey}`);
    const tribeID = toPositiveInt(pilot.sui?.tribeId ?? pilot.sui?.tribeID);
    if (tribeID) scopes.add(`tribe:${tribeID}`);
  } else {
    const characterState = require(path.join(__dirname, "../character/characterState"));
    const record = characterState.getCharacterRecord(entity.actorID);
    // A server-authenticated player session remains a valid direct entity in
    // sparse test/dev stores. Group grants still require a current durable
    // membership record (or the session's current tribe/corporation scope).
    const actorTribeID = actor && (actor.tribeID ?? actor.tribeId);
    const tribeID = toPositiveInt(
      record?.suiTribeId ?? record?.tribeID ?? record?.corporationID ?? actorTribeID,
    );
    if (tribeID) scopes.add(`tribe:${tribeID}`);
    const factionID = toPositiveInt(record && characterState.deriveFactionID(record));
    if (factionID) scopes.add(`faction:${factionID}-none`);
  }
  return {
    success: true as const,
    data: { actorID: entity.actorID, kind: entity.kind, principal: entity.principal, scopes: [...scopes] },
  };
}

function defaultFindAssembly(assemblyID) {
  return require("./deploymentRuntime").getAssemblyRecord(assemblyID);
}

function ownerPrincipalForAssembly(assembly) {
  const ownerID = toPositiveInt(assembly && assembly.ownerID);
  if (!ownerID) return null;
  const { NPC_CHARACTER_ID_MIN, NPC_CHARACTER_ID_MAX } = require("../_shared/npcIdentityConstants");
  const kind = ownerID >= NPC_CHARACTER_ID_MIN && ownerID <= NPC_CHARACTER_ID_MAX ? "npc" : "player";
  return `entity:${kind}:${ownerID}`;
}

function createAssemblyAccessRuntime(options: Record<string, any> = {}) {
  const now = typeof options.now === "function" ? options.now : Date.now;
  const randomUUID = typeof options.randomUUID === "function"
    ? options.randomUUID : () => crypto.randomUUID().toLowerCase();
  const randomBytes = typeof options.randomBytes === "function"
    ? options.randomBytes : (size) => crypto.randomBytes(size);
  const repository = options.repository || (() => {
    const { createTableRepository } = require(path.join(__dirname, "../../gameStore/tableRepository"));
    return createTableRepository("service:frontier", { strict: true });
  })();
  const findAssembly = typeof options.findAssembly === "function" ? options.findAssembly : defaultFindAssembly;
  const resolveSubject = typeof options.resolveSubject === "function" ? options.resolveSubject : defaultResolveSubject;
  const supportedCapabilities = typeof options.supportedCapabilities === "function"
    ? options.supportedCapabilities : () => ALL_CAPABILITIES;
  let verifyChainGrant = typeof options.verifyChainGrant === "function"
    ? options.verifyChainGrant : null;
  const guiSessions = new Map();

  function readState() {
    repository.ensureTable(ASSEMBLY_ACCESS_TABLE);
    const result = repository.read(ASSEMBLY_ACCESS_TABLE, "/");
    return normalizeStoredState(result && result.success ? result.data : null);
  }

  function writeState(state) {
    state.version = STATE_VERSION;
    if (state.events.length > MAX_EVENTS) state.events.splice(0, state.events.length - MAX_EVENTS);
    const result = repository.write(ASSEMBLY_ACCESS_TABLE, "/", state);
    return result && result.success
      ? { success: true as const }
      : { success: false as const, errorMsg: "ASSEMBLY_ACCESS_PERSIST_FAILED" };
  }

  function getAssembly(assemblyID) {
    const numericID = toPositiveInt(assemblyID);
    const assembly = numericID ? findAssembly(numericID) : null;
    if (!assembly || toPositiveInt(assembly.itemID ?? assembly.item?.itemID) !== numericID) {
      return { success: false as const, errorMsg: "ASSEMBLY_NOT_FOUND" };
    }
    if (Number(assembly.assemblyStatus ?? assembly.state?.assemblyStatus) === ASSEMBLY_STATUS_UNDER_CONSTRUCTION) {
      return { success: false as const, errorMsg: "ASSEMBLY_UNDER_CONSTRUCTION" };
    }
    const ownerPrincipal = normalizePrincipal(
      assembly.ownerPrincipal || ownerPrincipalForAssembly(assembly.item ? {
        ownerID: assembly.item.ownerID,
      } : assembly),
    );
    if (!ownerPrincipal) return { success: false as const, errorMsg: "ASSEMBLY_OWNER_INVALID" };
    const supported = normalizeCapabilities(
      supportedCapabilities(assembly),
      ALL_CAPABILITIES,
    ) || [...ALL_CAPABILITIES];
    return {
      success: true as const,
      data: {
        ...assembly,
        itemID: numericID,
        ownerPrincipal,
        createOnChain: assembly.createOnChain === true,
        supportedCapabilities: supported,
      },
    };
  }

  function subject(actor) {
    const resolved = resolveSubject(actor);
    if (!resolved || resolved.success !== true || !resolved.data) {
      return resolved && resolved.errorMsg
        ? resolved : { success: false as const, errorMsg: "ASSEMBLY_ACCESS_SUBJECT_INVALID" };
    }
    const principal = normalizePrincipal(resolved.data.principal);
    const scopes = [...new Set((resolved.data.scopes || [principal]).map(normalizePrincipal).filter(Boolean))];
    if (!principal || !scopes.includes(principal) || !parseEntityPrincipal(principal)) {
      return { success: false as const, errorMsg: "ASSEMBLY_ACCESS_SUBJECT_INVALID" };
    }
    return { success: true as const, data: { ...resolved.data, principal, scopes } };
  }

  function policyRevision(state, assemblyID) {
    return Math.max(0, toNonNegativeInt(state.policyRevisions[String(assemblyID)], 0));
  }

  function appendEvent(state, assemblyID, kind, actorPrincipal, detail: Record<string, any> = {}) {
    const sequence = state.nextSequence++;
    const event = {
      sequence,
      assemblyID,
      kind,
      actorPrincipal,
      atMs: now(),
      ...cloneValue(detail),
    };
    state.events.push(event);
    return event;
  }

  function bumpPolicy(state, assemblyID) {
    const next = policyRevision(state, assemblyID) + 1;
    state.policyRevisions[String(assemblyID)] = next;
    return next;
  }

  function activeGrant(grant, atMs = now()) {
    return Boolean(grant && ACTIVE_GRANT_STATES.has(grant.status) &&
      grant.authority !== "local_projection_pending_chain" &&
      toPositiveInt(grant.expiresAtMs) > atMs);
  }

  function reconcileState(state) {
    const atMs = now();
    let changed = false;
    for (const request of Object.values<any>(state.requests)) {
      if (request && ACTIVE_REQUEST_STATES.has(request.status) &&
          toPositiveInt(request.expiresAtMs) <= atMs) {
        request.status = "expired";
        request.updatedAtMs = atMs;
        request.revision = toPositiveInt(request.revision) + 1;
        appendEvent(state, request.assemblyID, "request_expired", request.requesterPrincipal, {
          requestID: request.requestID,
        });
        changed = true;
      }
    }
    for (const grant of Object.values<any>(state.grants)) {
      if (grant && grant.status === "active" && toPositiveInt(grant.expiresAtMs) <= atMs) {
        grant.status = "expired";
        grant.updatedAtMs = atMs;
        grant.revision = toPositiveInt(grant.revision) + 1;
        const revision = bumpPolicy(state, grant.assemblyID);
        appendEvent(state, grant.assemblyID, "grant_expired", grant.recipientPrincipal, {
          grantID: grant.grantID,
          policyRevision: revision,
        });
        changed = true;
      }
    }
    return changed;
  }

  function readReconciledState() {
    const state = readState();
    if (reconcileState(state)) writeState(state);
    return state;
  }

  function mutate(callback) {
    const state = readState();
    const reconciled = reconcileState(state);
    const result = callback(state);
    if (!result || result.success !== true) {
      if (reconciled) {
        const persisted = writeState(state);
        if (!persisted.success) return persisted;
      }
      return result;
    }
    const persisted = writeState(state);
    return persisted.success ? result : persisted;
  }

  function grantsForSubject(state, assemblyID, resolvedSubject) {
    const scopeSet = new Set(resolvedSubject.scopes);
    return Object.values<any>(state.grants)
      .filter((grant) => grant.assemblyID === assemblyID && grantChainIsActive(state, grant) &&
        scopeSet.has(grant.recipientPrincipal))
      .sort((left, right) => left.createdAtMs - right.createdAtMs ||
        String(left.grantID).localeCompare(String(right.grantID)));
  }

  function grantChainIsActive(state, grant) {
    const seen = new Set();
    let current = grant;
    while (current) {
      if (!activeGrant(current) || seen.has(current.grantID)) return false;
      seen.add(current.grantID);
      current = current.parentGrantID ? state.grants[current.parentGrantID] : null;
      if (current === undefined) return false;
    }
    return true;
  }

  function resolveAccess(actor, assemblyID, requiredCapabilities: any = []) {
    const assemblyResult = getAssembly(assemblyID);
    if (!assemblyResult.success) return assemblyResult;
    const subjectResult = subject(actor);
    if (!subjectResult.success) return subjectResult;
    const required = requiredCapabilities === undefined ||
      (Array.isArray(requiredCapabilities) && requiredCapabilities.length === 0)
      ? [] : normalizeCapabilities(requiredCapabilities, assemblyResult.data.supportedCapabilities);
    if (required === null) {
      return { success: false as const, errorMsg: "ASSEMBLY_ACCESS_CAPABILITY_INVALID" };
    }
    const state = readReconciledState();
    const isOwner = subjectResult.data.principal === assemblyResult.data.ownerPrincipal;
    const grants = isOwner ? [] : grantsForSubject(state, assemblyResult.data.itemID, subjectResult.data);
    const capabilities = isOwner
      ? [...assemblyResult.data.supportedCapabilities]
      : [...new Set(grants.flatMap((grant) => grant.capabilities))].sort();
    if (!includesCapabilities(capabilities, required)) {
      return {
        success: false as const,
        errorMsg: "ASSEMBLY_ACCESS_DENIED",
        data: {
          assemblyID: assemblyResult.data.itemID,
          capabilities,
          isOwner,
          policyRevision: policyRevision(state, assemblyResult.data.itemID),
          principal: subjectResult.data.principal,
        },
      };
    }
    return {
      success: true as const,
      data: {
        assembly: cloneValue(assemblyResult.data),
        assemblyID: assemblyResult.data.itemID,
        capabilities,
        grants: cloneValue(grants),
        isOwner,
        policyRevision: policyRevision(state, assemblyResult.data.itemID),
        principal: subjectResult.data.principal,
        scopes: cloneValue(subjectResult.data.scopes),
      },
    };
  }

  function findManager(state, assembly, resolvedSubject, capabilities) {
    if (resolvedSubject.principal === assembly.ownerPrincipal) {
      return { success: true as const, owner: true, parentGrant: null };
    }
    const required = [...new Set([ASSEMBLY_ACCESS_CAPABILITY.MANAGE_ACCESS, ...capabilities])];
    const requiresDelegation = capabilities.length > 0;
    const candidates = grantsForSubject(state, assembly.itemID, resolvedSubject)
      .filter((grant) => includesCapabilities(grant.capabilities, required) &&
        (!requiresDelegation ||
          grant.delegable === true && toNonNegativeInt(grant.delegationDepth) > 0))
      .sort((left, right) => toPositiveInt(right.expiresAtMs) - toPositiveInt(left.expiresAtMs) ||
        toNonNegativeInt(right.delegationDepth) - toNonNegativeInt(left.delegationDepth));
    return candidates.length > 0
      ? { success: true as const, owner: false, parentGrant: candidates[0] }
      : { success: false as const, errorMsg: "ASSEMBLY_ACCESS_MANAGE_DENIED" };
  }

  function normalizeExpiry(optionsValue, defaultTtl, maximumTtl, upperBound = Number.MAX_SAFE_INTEGER) {
    const atMs = now();
    const explicitExpiry = toPositiveInt(optionsValue && optionsValue.expiresAtMs);
    const ttl = optionsValue && optionsValue.expiresInMs !== undefined
      ? toPositiveInt(optionsValue.expiresInMs) : defaultTtl;
    const expiresAtMs = explicitExpiry || atMs + ttl;
    if (expiresAtMs <= atMs || expiresAtMs > atMs + maximumTtl || expiresAtMs > upperBound) return 0;
    return expiresAtMs;
  }

  function requestAccess(actor, assemblyID, capabilities, requestOptions: Record<string, any> = {}) {
    const assemblyResult = getAssembly(assemblyID);
    if (!assemblyResult.success) return assemblyResult;
    const subjectResult = subject(actor);
    if (!subjectResult.success) return subjectResult;
    const requestedCapabilities = normalizeCapabilities(
      capabilities,
      assemblyResult.data.supportedCapabilities,
    );
    if (!requestedCapabilities) {
      return { success: false as const, errorMsg: "ASSEMBLY_ACCESS_CAPABILITY_INVALID" };
    }
    if (subjectResult.data.principal === assemblyResult.data.ownerPrincipal) {
      return { success: false as const, errorMsg: "ASSEMBLY_ACCESS_OWNER_IMPLICIT" };
    }
    const requestID = requestOptions.requestID
      ? normalizeUUID(requestOptions.requestID) : normalizeUUID(randomUUID());
    const idempotencyKey = normalizeIdempotencyKey(
      requestOptions.idempotencyKey || requestID,
    );
    if (!requestID) return { success: false as const, errorMsg: "ASSEMBLY_ACCESS_REQUEST_ID_INVALID" };
    if (!idempotencyKey) return { success: false as const, errorMsg: "ASSEMBLY_ACCESS_IDEMPOTENCY_INVALID" };
    const expiresAtMs = normalizeExpiry(
      requestOptions,
      DEFAULT_REQUEST_TTL_MS,
      MAX_REQUEST_TTL_MS,
    );
    const grantExpiresAtMs = normalizeExpiry(
      { expiresAtMs: requestOptions.grantExpiresAtMs,
        expiresInMs: requestOptions.grantExpiresInMs },
      DEFAULT_GRANT_TTL_MS,
      MAX_GRANT_TTL_MS,
    );
    if (!expiresAtMs) return { success: false as const, errorMsg: "ASSEMBLY_ACCESS_REQUEST_EXPIRY_INVALID" };
    if (!grantExpiresAtMs) return { success: false as const, errorMsg: "ASSEMBLY_ACCESS_GRANT_EXPIRY_INVALID" };
    const immutable = {
      assemblyID: assemblyResult.data.itemID,
      requesterPrincipal: subjectResult.data.principal,
      recipientPrincipal: subjectResult.data.principal,
      capabilities: requestedCapabilities,
      idempotencyKey,
      grantExpiresAtMs,
    };
    const idempotencyFingerprint = operationFingerprint({
      assemblyID: immutable.assemblyID,
      requesterPrincipal: immutable.requesterPrincipal,
      recipientPrincipal: immutable.recipientPrincipal,
      capabilities: immutable.capabilities,
      idempotencyKey: immutable.idempotencyKey,
      requestExpiryIntent: requestOptions.expiresAtMs === undefined
        ? { expiresInMs: requestOptions.expiresInMs ?? DEFAULT_REQUEST_TTL_MS }
        : { expiresAtMs: requestOptions.expiresAtMs },
      grantExpiryIntent: requestOptions.grantExpiresAtMs === undefined
        ? { expiresInMs: requestOptions.grantExpiresInMs ?? DEFAULT_GRANT_TTL_MS }
        : { expiresAtMs: requestOptions.grantExpiresAtMs },
      delegable: requestOptions.delegable === true,
      delegationDepth: Math.min(MAX_DELEGATION_DEPTH,
        toNonNegativeInt(requestOptions.delegationDepth, 0)),
    });
    return mutate((state) => {
      const replay = Object.values<any>(state.requests).find((request) =>
        request.requesterPrincipal === immutable.requesterPrincipal &&
        request.idempotencyKey === idempotencyKey);
      if (replay) {
        const same = replay.idempotencyFingerprint === idempotencyFingerprint;
        return same
          ? { success: true as const, created: false, data: cloneValue(replay) }
          : { success: false as const, errorMsg: "ASSEMBLY_ACCESS_IDEMPOTENCY_CONFLICT" };
      }
      if (state.requests[requestID]) {
        return { success: false as const, errorMsg: "ASSEMBLY_ACCESS_REQUEST_ID_CONFLICT" };
      }
      const atMs = now();
      const request = {
        ...immutable,
        requestID,
        status: "requested",
        reason: normalizeReason(requestOptions.reason),
        delegable: requestOptions.delegable === true,
        delegationDepth: Math.min(MAX_DELEGATION_DEPTH,
          toNonNegativeInt(requestOptions.delegationDepth, 0)),
        createdAtMs: atMs,
        updatedAtMs: atMs,
        expiresAtMs,
        observedPolicyRevision: policyRevision(state, immutable.assemblyID),
        idempotencyFingerprint,
        revision: 1,
      };
      state.requests[requestID] = request;
      appendEvent(state, immutable.assemblyID, "request_created", immutable.requesterPrincipal, {
        requestID,
        recipientPrincipal: immutable.recipientPrincipal,
        capabilities: immutable.capabilities,
      });
      return { success: true as const, created: true, data: cloneValue(request) };
    });
  }

  function createGrant(state, assembly, manager, grantor, recipientPrincipal, capabilities,
    grantOptions: Record<string, any> = {}) {
    const parent = manager.parentGrant;
    const maxExpiry = parent ? toPositiveInt(parent.expiresAtMs) : Number.MAX_SAFE_INTEGER;
    const expiresAtMs = normalizeExpiry(
      grantOptions,
      DEFAULT_GRANT_TTL_MS,
      MAX_GRANT_TTL_MS,
      maxExpiry,
    );
    if (!expiresAtMs) return { success: false as const, errorMsg: "ASSEMBLY_ACCESS_GRANT_EXPIRY_INVALID" };
    const requestedDepth = Math.min(MAX_DELEGATION_DEPTH,
      toNonNegativeInt(grantOptions.delegationDepth, 0));
    const maxDepth = parent ? Math.max(0, toNonNegativeInt(parent.delegationDepth) - 1) : MAX_DELEGATION_DEPTH;
    if (requestedDepth > maxDepth) {
      return { success: false as const, errorMsg: "ASSEMBLY_ACCESS_DELEGATION_INVALID" };
    }
    const delegable = grantOptions.delegable === true;
    if (delegable && requestedDepth <= 0) {
      return { success: false as const, errorMsg: "ASSEMBLY_ACCESS_DELEGATION_INVALID" };
    }
    const grantID = grantOptions.grantID
      ? normalizeUUID(grantOptions.grantID) : normalizeUUID(randomUUID());
    if (!grantID) return { success: false as const, errorMsg: "ASSEMBLY_ACCESS_GRANT_ID_INVALID" };
    const immutable = {
      assemblyID: assembly.itemID,
      recipientPrincipal,
      capabilities,
      grantorPrincipal: grantor.principal,
      parentGrantID: parent ? parent.grantID : null,
      expiresAtMs,
      delegable,
      delegationDepth: requestedDepth,
    };
    const existing = state.grants[grantID];
    if (existing) {
      const comparable = Object.fromEntries(Object.keys(immutable).map((key) => [key, existing[key]]));
      return JSON.stringify(comparable) === JSON.stringify(immutable)
        ? { success: true as const, created: false, data: cloneValue(existing) }
        : { success: false as const, errorMsg: "ASSEMBLY_ACCESS_GRANT_ID_CONFLICT" };
    }
    const atMs = now();
    const revision = bumpPolicy(state, assembly.itemID);
    const grant = {
      ...immutable,
      grantID,
      status: "active",
      createdAtMs: atMs,
      updatedAtMs: atMs,
      revision: 1,
      policyRevision: revision,
      authority: assembly.createOnChain ? "local_projection_pending_chain" : "local",
    };
    state.grants[grantID] = grant;
    appendEvent(state, assembly.itemID, "grant_created", grantor.principal, {
      grantID,
      parentGrantID: grant.parentGrantID,
      recipientPrincipal,
      capabilities,
      policyRevision: revision,
    });
    return { success: true as const, created: true, data: cloneValue(grant) };
  }

  function approveRequest(actor, assemblyID, requestID, approvalOptions: Record<string, any> = {}) {
    const assemblyResult = getAssembly(assemblyID);
    if (!assemblyResult.success) return assemblyResult;
    const subjectResult = subject(actor);
    if (!subjectResult.success) return subjectResult;
    const normalizedRequestID = normalizeUUID(requestID);
    if (!normalizedRequestID) return { success: false as const, errorMsg: "ASSEMBLY_ACCESS_REQUEST_ID_INVALID" };
    return mutate((state) => {
      const request = state.requests[normalizedRequestID];
      if (!request || request.assemblyID !== assemblyResult.data.itemID) {
        return { success: false as const, errorMsg: "ASSEMBLY_ACCESS_REQUEST_NOT_FOUND" };
      }
      if (request.status === "approved") {
        const grant = state.grants[request.grantID];
        return grant
          ? { success: true as const, approved: false, data: { request: cloneValue(request), grant: cloneValue(grant) } }
          : { success: false as const, errorMsg: "ASSEMBLY_ACCESS_GRANT_NOT_FOUND" };
      }
      if (request.status !== "requested") {
        return { success: false as const, errorMsg: "ASSEMBLY_ACCESS_REQUEST_NOT_PENDING" };
      }
      const capabilities = approvalOptions.capabilities === undefined
        ? request.capabilities
        : normalizeCapabilities(approvalOptions.capabilities, assemblyResult.data.supportedCapabilities);
      if (!capabilities || !includesCapabilities(request.capabilities, capabilities)) {
        return { success: false as const, errorMsg: "ASSEMBLY_ACCESS_CAPABILITY_AMPLIFIED" };
      }
      const manager = findManager(state, assemblyResult.data, subjectResult.data, capabilities);
      if (!manager.success) return manager;
      const grant = createGrant(state, assemblyResult.data, manager, subjectResult.data,
        request.recipientPrincipal, capabilities, {
          grantID: approvalOptions.grantID,
          expiresAtMs: Math.min(
            toPositiveInt(approvalOptions.expiresAtMs) || request.grantExpiresAtMs,
            request.grantExpiresAtMs,
          ),
          delegable: approvalOptions.delegable === undefined
            ? request.delegable : approvalOptions.delegable === true,
          delegationDepth: approvalOptions.delegationDepth === undefined
            ? request.delegationDepth : approvalOptions.delegationDepth,
        });
      if (!grant.success) return grant;
      request.status = "approved";
      request.grantID = grant.data.grantID;
      request.decidedByPrincipal = subjectResult.data.principal;
      request.decidedAtMs = now();
      request.updatedAtMs = request.decidedAtMs;
      request.revision = toPositiveInt(request.revision) + 1;
      appendEvent(state, request.assemblyID, "request_approved", subjectResult.data.principal, {
        requestID: request.requestID,
        grantID: grant.data.grantID,
      });
      return {
        success: true as const,
        approved: true,
        data: { request: cloneValue(request), grant: cloneValue(grant.data) },
      };
    });
  }

  function shareAccess(actor, assemblyID, recipient, capabilities,
    shareOptions: Record<string, any> = {}) {
    const assemblyResult = getAssembly(assemblyID);
    if (!assemblyResult.success) return assemblyResult;
    const subjectResult = subject(actor);
    if (!subjectResult.success) return subjectResult;
    const recipientPrincipal = normalizePrincipal(recipient);
    if (!recipientPrincipal) return { success: false as const, errorMsg: "ASSEMBLY_ACCESS_RECIPIENT_INVALID" };
    const normalizedCapabilities = normalizeCapabilities(capabilities,
      assemblyResult.data.supportedCapabilities);
    if (!normalizedCapabilities) {
      return { success: false as const, errorMsg: "ASSEMBLY_ACCESS_CAPABILITY_INVALID" };
    }
    const idempotencyKey = normalizeIdempotencyKey(
      shareOptions.idempotencyKey || shareOptions.grantID || randomUUID(),
    );
    if (!idempotencyKey) return { success: false as const, errorMsg: "ASSEMBLY_ACCESS_IDEMPOTENCY_INVALID" };
    const idempotencyFingerprint = operationFingerprint({
      assemblyID: assemblyResult.data.itemID,
      recipientPrincipal,
      capabilities: normalizedCapabilities,
      grantID: shareOptions.grantID || null,
      expiryIntent: shareOptions.expiresAtMs === undefined
        ? { expiresInMs: shareOptions.expiresInMs ?? DEFAULT_GRANT_TTL_MS }
        : { expiresAtMs: shareOptions.expiresAtMs },
      delegable: shareOptions.delegable === true,
      delegationDepth: Math.min(MAX_DELEGATION_DEPTH,
        toNonNegativeInt(shareOptions.delegationDepth, 0)),
    });
    return mutate((state) => {
      const replay = Object.values<any>(state.grants).find((grant) =>
        grant.grantorPrincipal === subjectResult.data.principal &&
        grant.idempotencyKey === idempotencyKey);
      if (replay) {
        const same = replay.idempotencyFingerprint === idempotencyFingerprint;
        return same
          ? { success: true as const, created: false, data: cloneValue(replay) }
          : { success: false as const, errorMsg: "ASSEMBLY_ACCESS_IDEMPOTENCY_CONFLICT" };
      }
      const manager = findManager(state, assemblyResult.data, subjectResult.data,
        normalizedCapabilities);
      if (!manager.success) return manager;
      const grant = createGrant(state, assemblyResult.data, manager, subjectResult.data,
        recipientPrincipal, normalizedCapabilities, shareOptions);
      if (grant.success) {
        state.grants[grant.data.grantID].idempotencyKey = idempotencyKey;
        state.grants[grant.data.grantID].idempotencyFingerprint = idempotencyFingerprint;
        grant.data.idempotencyKey = idempotencyKey;
        grant.data.idempotencyFingerprint = idempotencyFingerprint;
      }
      return grant;
    });
  }

  function decideRequest(actor, assemblyID, requestID, status, reason = null) {
    const assemblyResult = getAssembly(assemblyID);
    if (!assemblyResult.success) return assemblyResult;
    const subjectResult = subject(actor);
    if (!subjectResult.success) return subjectResult;
    const normalizedRequestID = normalizeUUID(requestID);
    if (!normalizedRequestID) return { success: false as const, errorMsg: "ASSEMBLY_ACCESS_REQUEST_ID_INVALID" };
    return mutate((state) => {
      const request = state.requests[normalizedRequestID];
      if (!request || request.assemblyID !== assemblyResult.data.itemID) {
        return { success: false as const, errorMsg: "ASSEMBLY_ACCESS_REQUEST_NOT_FOUND" };
      }
      if (request.status === status) return { success: true as const, changed: false, data: cloneValue(request) };
      if (request.status !== "requested") {
        return { success: false as const, errorMsg: "ASSEMBLY_ACCESS_REQUEST_NOT_PENDING" };
      }
      if (status === "cancelled") {
        if (request.requesterPrincipal !== subjectResult.data.principal) {
          return { success: false as const, errorMsg: "ASSEMBLY_ACCESS_REQUEST_CANCEL_DENIED" };
        }
      } else {
        const manager = findManager(state, assemblyResult.data, subjectResult.data, []);
        if (!manager.success) return manager;
      }
      request.status = status;
      request.reasonOutcome = normalizeReason(reason);
      request.decidedByPrincipal = subjectResult.data.principal;
      request.decidedAtMs = now();
      request.updatedAtMs = request.decidedAtMs;
      request.revision = toPositiveInt(request.revision) + 1;
      appendEvent(state, request.assemblyID, `request_${status}`, subjectResult.data.principal, {
        requestID: request.requestID,
      });
      return { success: true as const, changed: true, data: cloneValue(request) };
    });
  }

  function isDescendantOf(state, grant, ancestorGrantID) {
    const seen = new Set();
    let parentID = grant && grant.parentGrantID;
    while (parentID && !seen.has(parentID)) {
      if (parentID === ancestorGrantID) return true;
      seen.add(parentID);
      parentID = state.grants[parentID]?.parentGrantID || null;
    }
    return false;
  }

  function revokeGrant(actor, assemblyID, grantID, revokeOptions: Record<string, any> = {}) {
    const assemblyResult = getAssembly(assemblyID);
    if (!assemblyResult.success) return assemblyResult;
    const subjectResult = subject(actor);
    if (!subjectResult.success) return subjectResult;
    const normalizedGrantID = normalizeUUID(grantID);
    if (!normalizedGrantID) return { success: false as const, errorMsg: "ASSEMBLY_ACCESS_GRANT_ID_INVALID" };
    return mutate((state) => {
      const grant = state.grants[normalizedGrantID];
      if (!grant || grant.assemblyID !== assemblyResult.data.itemID) {
        return { success: false as const, errorMsg: "ASSEMBLY_ACCESS_GRANT_NOT_FOUND" };
      }
      if (grant.status === "revoked" || grant.status === "relinquished") {
        return { success: true as const, changed: false, data: cloneValue(grant) };
      }
      if (!activeGrant(grant)) {
        return { success: false as const, errorMsg: "ASSEMBLY_ACCESS_GRANT_NOT_ACTIVE" };
      }
      const isOwner = subjectResult.data.principal === assemblyResult.data.ownerPrincipal;
      const isGrantor = subjectResult.data.principal === grant.grantorPrincipal;
      // A member may use a current tribe/faction grant, but relinquishing that
      // shared grant would revoke every other member. Only a directly named
      // entity recipient can relinquish without management authority.
      const isRecipient = subjectResult.data.principal === grant.recipientPrincipal;
      let managerInLineage = false;
      if (!isOwner && !isGrantor && !isRecipient) {
        managerInLineage = grantsForSubject(state, assemblyResult.data.itemID, subjectResult.data)
          .some((candidate) => candidate.capabilities.includes(ASSEMBLY_ACCESS_CAPABILITY.MANAGE_ACCESS) &&
            (candidate.grantID === grant.parentGrantID || isDescendantOf(state, grant, candidate.grantID)));
      }
      if (!isOwner && !isGrantor && !isRecipient && !managerInLineage) {
        return { success: false as const, errorMsg: "ASSEMBLY_ACCESS_REVOKE_DENIED" };
      }
      const relinquished = isRecipient && !isOwner && !isGrantor && !managerInLineage;
      grant.status = relinquished ? "relinquished" : "revoked";
      grant.revokedByPrincipal = subjectResult.data.principal;
      grant.revokeReason = normalizeReason(revokeOptions.reason);
      grant.updatedAtMs = now();
      grant.revokedAtMs = grant.updatedAtMs;
      grant.revision = toPositiveInt(grant.revision) + 1;
      const revision = bumpPolicy(state, grant.assemblyID);
      grant.policyRevision = revision;
      appendEvent(state, grant.assemblyID, relinquished ? "grant_relinquished" : "grant_revoked",
        subjectResult.data.principal, { grantID: grant.grantID, policyRevision: revision });
      return { success: true as const, changed: true, data: cloneValue(grant) };
    });
  }

  function listRequests(actor, assemblyID, listOptions: Record<string, any> = {}) {
    const assemblyResult = getAssembly(assemblyID);
    if (!assemblyResult.success) return assemblyResult;
    const subjectResult = subject(actor);
    if (!subjectResult.success) return subjectResult;
    const state = readReconciledState();
    const manager = findManager(state, assemblyResult.data, subjectResult.data, []);
    const canManage = manager.success === true;
    const statuses = listOptions.statuses === undefined ? null : new Set(
      (Array.isArray(listOptions.statuses) ? listOptions.statuses : [listOptions.statuses])
        .map((entry) => String(entry || "").trim().toLowerCase())
        .filter((entry) => REQUEST_STATES.has(entry)),
    );
    const scopeSet = new Set(subjectResult.data.scopes);
    const rows = Object.values<any>(state.requests)
      .filter((request) => request.assemblyID === assemblyResult.data.itemID &&
        (canManage || request.requesterPrincipal === subjectResult.data.principal ||
          scopeSet.has(request.recipientPrincipal)) &&
        (!statuses || statuses.has(request.status)))
      .sort((left, right) => right.createdAtMs - left.createdAtMs ||
        String(left.requestID).localeCompare(String(right.requestID)));
    return { success: true as const, data: cloneValue(rows), canManage };
  }

  function listGrants(actor, assemblyID, listOptions: Record<string, any> = {}) {
    const assemblyResult = getAssembly(assemblyID);
    if (!assemblyResult.success) return assemblyResult;
    const subjectResult = subject(actor);
    if (!subjectResult.success) return subjectResult;
    const state = readReconciledState();
    const manager = findManager(state, assemblyResult.data, subjectResult.data, []);
    const canManage = manager.success === true;
    const scopeSet = new Set(subjectResult.data.scopes);
    const includeInactive = listOptions.includeInactive === true;
    const rows = Object.values<any>(state.grants)
      .filter((grant) => grant.assemblyID === assemblyResult.data.itemID &&
        (includeInactive || activeGrant(grant)) &&
        (canManage || scopeSet.has(grant.recipientPrincipal) ||
          grant.grantorPrincipal === subjectResult.data.principal))
      .sort((left, right) => right.createdAtMs - left.createdAtMs ||
        String(left.grantID).localeCompare(String(right.grantID)));
    return { success: true as const, data: cloneValue(rows), canManage };
  }

  function listEvents(actor, assemblyID, eventOptions: Record<string, any> = {}) {
    const access = resolveAccess(actor, assemblyID, [ASSEMBLY_ACCESS_CAPABILITY.GUI_VIEW]);
    if (!access.success) return access;
    const state = readReconciledState();
    const afterSequence = toNonNegativeInt(eventOptions.afterSequence, 0);
    const limit = Math.min(500, Math.max(1, toPositiveInt(eventOptions.limit) || 100));
    const rows = state.events.filter((event) => event.assemblyID === access.data.assemblyID &&
      event.sequence > afterSequence).slice(0, limit);
    return {
      success: true as const,
      data: {
        events: cloneValue(rows),
        nextSequence: state.nextSequence,
        policyRevision: policyRevision(state, access.data.assemblyID),
      },
    };
  }

  function issueGuiSession(actor, assemblyID, sessionOptions: Record<string, any> = {}) {
    const access = resolveAccess(actor, assemblyID, [ASSEMBLY_ACCESS_CAPABILITY.GUI_VIEW]);
    if (!access.success) return access;
    const ttl = sessionOptions.expiresInMs === undefined
      ? DEFAULT_GUI_SESSION_TTL_MS : toPositiveInt(sessionOptions.expiresInMs);
    if (!ttl || ttl > MAX_GUI_SESSION_TTL_MS) {
      return { success: false as const, errorMsg: "ASSEMBLY_GUI_SESSION_EXPIRY_INVALID" };
    }
    const sessionBinding = String(sessionOptions.sessionBinding || "").trim();
    if (!sessionBinding || sessionBinding.length > 256) {
      return { success: false as const, errorMsg: "ASSEMBLY_GUI_SESSION_BINDING_REQUIRED" };
    }
    const token = randomBytes(32).toString("base64url");
    const tokenDigest = crypto.createHash("sha256").update(token).digest("hex");
    const record = {
      assemblyID: access.data.assemblyID,
      principal: access.data.principal,
      capabilities: access.data.capabilities,
      policyRevision: access.data.policyRevision,
      sessionBinding,
      expiresAtMs: now() + ttl,
    };
    guiSessions.set(tokenDigest, record);
    return { success: true as const, data: { token, ...cloneValue(record) } };
  }

  function validateGuiSession(token, actor, assemblyID, capability,
    sessionOptions: Record<string, any> = {}) {
    const tokenDigest = crypto.createHash("sha256").update(String(token || "")).digest("hex");
    const session = guiSessions.get(tokenDigest);
    if (!session || session.expiresAtMs <= now()) {
      guiSessions.delete(tokenDigest);
      return { success: false as const, errorMsg: "ASSEMBLY_GUI_SESSION_INVALID" };
    }
    const required = normalizeCapabilities([capability]);
    if (!required || session.assemblyID !== toPositiveInt(assemblyID) ||
        session.sessionBinding !== String(sessionOptions.sessionBinding || "").trim()) {
      return { success: false as const, errorMsg: "ASSEMBLY_GUI_SESSION_MISMATCH" };
    }
    const access = resolveAccess(actor, assemblyID, required);
    if (!access.success || access.data.principal !== session.principal ||
        access.data.policyRevision !== session.policyRevision ||
        !includesCapabilities(session.capabilities, required)) {
      guiSessions.delete(tokenDigest);
      return { success: false as const, errorMsg: "ASSEMBLY_GUI_SESSION_STALE" };
    }
    return { success: true as const, data: cloneValue(session) };
  }

  function cancelRequestsForAssembly(assemblyID, reason = "ASSEMBLY_REMOVED") {
    const numericID = toPositiveInt(assemblyID);
    if (!numericID) return { success: false as const, errorMsg: "ASSEMBLY_NOT_FOUND" };
    return mutate((state) => {
      const changed: any[] = [];
      for (const request of Object.values<any>(state.requests)) {
        if (request.assemblyID !== numericID || request.status !== "requested") continue;
        request.status = "cancelled";
        request.reasonOutcome = normalizeReason(reason);
        request.updatedAtMs = now();
        request.revision = toPositiveInt(request.revision) + 1;
        changed.push(cloneValue(request));
        appendEvent(state, numericID, "request_cancelled", request.requesterPrincipal, {
          requestID: request.requestID,
        });
      }
      for (const grant of Object.values<any>(state.grants)) {
        if (grant.assemblyID !== numericID || !activeGrant(grant)) continue;
        grant.status = "revoked";
        grant.revokeReason = normalizeReason(reason);
        grant.updatedAtMs = now();
        grant.revision = toPositiveInt(grant.revision) + 1;
        changed.push(cloneValue(grant));
      }
      if (changed.some((record) => record.grantID)) bumpPolicy(state, numericID);
      return { success: true as const, data: changed };
    });
  }

  async function confirmGrantChainAuthority(grantID, proof) {
    const normalizedGrantID = normalizeUUID(grantID);
    if (!normalizedGrantID) return { success: false as const, errorMsg: "ASSEMBLY_ACCESS_GRANT_ID_INVALID" };
    if (!verifyChainGrant) {
      return { success: false as const, errorMsg: "ASSEMBLY_ACCESS_CHAIN_UNAVAILABLE" };
    }
    if (!proof || typeof proof !== "object" || Array.isArray(proof)) {
      return { success: false as const, errorMsg: "ASSEMBLY_ACCESS_CHAIN_PROOF_INVALID" };
    }
    const snapshot = readReconciledState().grants[normalizedGrantID];
    if (!snapshot) return { success: false as const, errorMsg: "ASSEMBLY_ACCESS_GRANT_NOT_FOUND" };
    if (snapshot.authority === "sui_confirmed") {
      return { success: true as const, changed: false, data: cloneValue(snapshot) };
    }
    if (snapshot.authority !== "local_projection_pending_chain" || snapshot.status !== "active") {
      return { success: false as const, errorMsg: "ASSEMBLY_ACCESS_GRANT_NOT_ACTIVE" };
    }
    let verified = false;
    try {
      verified = await verifyChainGrant(cloneValue(snapshot), cloneValue(proof));
    } catch (_) {
      verified = false;
    }
    if (verified !== true) {
      return { success: false as const, errorMsg: "ASSEMBLY_ACCESS_CHAIN_PROOF_INVALID" };
    }
    const proofDigest = operationFingerprint(proof);
    return mutate((state) => {
      const current = state.grants[normalizedGrantID];
      if (!current || current.status !== "active") {
        return { success: false as const, errorMsg: "ASSEMBLY_ACCESS_GRANT_NOT_ACTIVE" };
      }
      if (current.authority === "sui_confirmed") {
        return current.chainProofDigest === proofDigest
          ? { success: true as const, changed: false, data: cloneValue(current) }
          : { success: false as const, errorMsg: "ASSEMBLY_ACCESS_CHAIN_PROOF_CONFLICT" };
      }
      if (current.authority !== "local_projection_pending_chain") {
        return { success: false as const, errorMsg: "ASSEMBLY_ACCESS_CHAIN_PROOF_CONFLICT" };
      }
      current.authority = "sui_confirmed";
      current.chainProofDigest = proofDigest;
      current.chainConfirmedAtMs = now();
      current.updatedAtMs = current.chainConfirmedAtMs;
      current.revision = toPositiveInt(current.revision) + 1;
      const revision = bumpPolicy(state, current.assemblyID);
      current.policyRevision = revision;
      appendEvent(state, current.assemblyID, "grant_chain_confirmed", current.grantorPrincipal, {
        grantID: current.grantID,
        policyRevision: revision,
        chainProofDigest: proofDigest,
      });
      return { success: true as const, changed: true, data: cloneValue(current) };
    });
  }

  return {
    requestAccess,
    approveRequest,
    denyRequest: (actor, assemblyID, requestID, reason) =>
      decideRequest(actor, assemblyID, requestID, "denied", reason),
    cancelRequest: (actor, assemblyID, requestID, reason) =>
      decideRequest(actor, assemblyID, requestID, "cancelled", reason),
    shareAccess,
    revokeGrant,
    relinquishGrant: (actor, assemblyID, grantID, reason) =>
      revokeGrant(actor, assemblyID, grantID, { reason, relinquish: true }),
    resolveAccess,
    listRequests,
    listGrants,
    listEvents,
    issueGuiSession,
    validateGuiSession,
    confirmGrantChainAuthority,
    cancelRequestsForAssembly,
    _setVerifyChainGrant(value) {
      verifyChainGrant = typeof value === "function" ? value : null;
    },
    _clearVerifyChainGrant(value) {
      if (verifyChainGrant === value) verifyChainGrant = null;
    },
    _testing: { readState, reconcileState, guiSessions },
  };
}

const runtime = createAssemblyAccessRuntime();

function registerAssemblyAccessChainVerifier(verifier) {
  if (typeof verifier !== "function") {
    throw new TypeError("Assembly access chain verifier must be a function");
  }
  runtime._setVerifyChainGrant(verifier);
  let active = true;
  return () => {
    if (!active) return;
    active = false;
    runtime._clearVerifyChainGrant(verifier);
  };
}

module.exports = {
  ASSEMBLY_ACCESS_TABLE,
  ASSEMBLY_ACCESS_CAPABILITY,
  ALL_CAPABILITIES,
  createAssemblyAccessRuntime,
  normalizePrincipal,
  normalizeCapabilities,
  principalKind,
  registerAssemblyAccessChainVerifier,
  ...runtime,
};
