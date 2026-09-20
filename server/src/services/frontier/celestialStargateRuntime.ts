"use strict";

/**
 * Durable maintenance authority for SDE-authored (non smart-assembly)
 * stargates.  A gate is legacy-active until it is explicitly authored here;
 * this prevents the maintenance feature from silently disabling every normal
 * map connection.
 */

const fs = require("fs");
const path = require("path");

const TABLE = "stargateRuntimeState";
const SCHEMA_VERSION = 1;
const MAX_SIGNALS = 10_000;
const MAX_RECEIPTS_PER_GATE = 128;
const DEFAULT_REACTIVATION_DURATION_MS = 3_000;
const DEFAULT_CONFIG_PATH = path.resolve(
  __dirname,
  "../../../../stargate-maintenance.config.json",
);

const STARGATE_MAINTENANCE_STATUS = Object.freeze({
  DORMANT: "dormant",
  READY: "ready",
  REACTIVATING: "reactivating",
  ACTIVE: "active",
});

const STARGATE_RESOURCE_KIND = Object.freeze({
  MATERIAL: "material",
  FUEL: "fuel",
});

function cloneValue(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function positiveInt(value, fallback = 0) {
  const numeric = Math.trunc(Number(value) || 0);
  return numeric > 0 && Number.isSafeInteger(numeric) ? numeric : fallback;
}

function nonNegativeInt(value, fallback = 0) {
  const numeric = Math.trunc(Number(value));
  return Number.isSafeInteger(numeric) && numeric >= 0 ? numeric : fallback;
}

function emptyState() {
  return {
    schemaVersion: SCHEMA_VERSION,
    revision: 0,
    nextSequence: 1,
    gates: {},
    signals: [],
  };
}

function normalizeState(raw) {
  const source = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  return {
    schemaVersion: SCHEMA_VERSION,
    revision: nonNegativeInt(source.revision, 0),
    nextSequence: Math.max(1, positiveInt(source.nextSequence, 1)),
    gates: source.gates && typeof source.gates === "object" && !Array.isArray(source.gates)
      ? cloneValue(source.gates)
      : {},
    signals: Array.isArray(source.signals) ? cloneValue(source.signals) : [],
  };
}

function normalizeRequirementEntries(raw, kind) {
  const source = Array.isArray(raw)
    ? raw
    : raw && typeof raw === "object"
      ? Object.entries(raw).map(([typeID, quantity]) => ({ typeID, quantity }))
      : [];
  const combined = new Map<number, number>();
  for (const entry of source) {
    const typeID = positiveInt(entry && (entry.typeID ?? entry.itemTypeID), 0);
    const quantity = positiveInt(entry && (entry.quantity ?? entry.requiredQuantity), 0);
    if (!typeID || !quantity) continue;
    combined.set(typeID, (combined.get(typeID) || 0) + quantity);
  }
  return [...combined.entries()]
    .sort((left, right) => left[0] - right[0])
    .map(([typeID, quantity]) => ({ kind, typeID, quantity }));
}

function normalizeRequirements(raw) {
  const source = raw && typeof raw === "object" ? raw : {};
  return {
    materials: normalizeRequirementEntries(
      source.materials ?? source.materialRequirements,
      STARGATE_RESOURCE_KIND.MATERIAL,
    ),
    fuel: normalizeRequirementEntries(
      source.fuel ?? source.fuelRequirements,
      STARGATE_RESOURCE_KIND.FUEL,
    ),
  };
}

function requirementKey(kind, typeID) {
  return `${kind}:${typeID}`;
}

function allRequirements(record) {
  return [
    ...(record.requirements?.materials || []),
    ...(record.requirements?.fuel || []),
  ];
}

function depositedQuantity(record, kind, typeID) {
  return nonNegativeInt(record.deposited?.[requirementKey(kind, typeID)], 0);
}

function reservedQuantity(record, kind, typeID, exceptOperationKey = null) {
  return Object.values<any>(record.pendingDeposits || {})
    .filter((pending) => pending.operationKey !== exceptOperationKey)
    .flatMap((pending) => Array.isArray(pending.entries) ? pending.entries : [])
    .filter((entry) => entry.kind === kind && positiveInt(entry.typeID, 0) === typeID)
    .reduce((total, entry) => total + positiveInt(entry.quantity, 0), 0);
}

function resourcesReady(record) {
  const requirements = allRequirements(record);
  return requirements.length > 0 && requirements.every((requirement) =>
    depositedQuantity(record, requirement.kind, requirement.typeID) >= requirement.quantity);
}

function fuelLevel(record) {
  const fuel = record.requirements?.fuel || [];
  if (fuel.length === 0) return "not-required";
  const ratio = fuel.reduce((total, requirement) =>
    total + Math.min(requirement.quantity, depositedQuantity(
      record,
      STARGATE_RESOURCE_KIND.FUEL,
      requirement.typeID,
    )), 0) / fuel.reduce((total, requirement) => total + requirement.quantity, 0);
  if (ratio >= 1) return "ready";
  if (ratio <= 0) return "empty";
  return ratio < 0.25 ? "low" : "partial";
}

function materialLevel(record) {
  const materials = record.requirements?.materials || [];
  if (materials.length === 0) return "not-required";
  return materials.every((requirement) => depositedQuantity(
    record,
    STARGATE_RESOURCE_KIND.MATERIAL,
    requirement.typeID,
  ) >= requirement.quantity) ? "ready" : "incomplete";
}

function publicGateState(record) {
  if (!record) return null;
  const project = (requirement) => {
    const deposited = depositedQuantity(record, requirement.kind, requirement.typeID);
    const reserved = reservedQuantity(record, requirement.kind, requirement.typeID);
    return {
      kind: requirement.kind,
      typeID: requirement.typeID,
      requiredQuantity: requirement.quantity,
      depositedQuantity: deposited,
      reservedQuantity: reserved,
      remainingQuantity: Math.max(0, requirement.quantity - deposited - reserved),
    };
  };
  return {
    stargateID: record.stargateID,
    typeID: record.typeID,
    solarSystemID: record.solarSystemID,
    destinationID: record.destinationID,
    destinationSolarSystemID: record.destinationSolarSystemID,
    status: record.status,
    dormant: record.status !== STARGATE_MAINTENANCE_STATUS.ACTIVE,
    activationCompleteAtMs: nonNegativeInt(record.activationCompleteAtMs, 0),
    reactivationDurationMs: nonNegativeInt(record.reactivationDurationMs, 0),
    revision: positiveInt(record.revision, 1),
    resourcesReady: resourcesReady(record),
    fuelLevel: fuelLevel(record),
    materialLevel: materialLevel(record),
    requirements: {
      materials: (record.requirements?.materials || []).map(project),
      fuel: (record.requirements?.fuel || []).map(project),
    },
    updatedAtMs: nonNegativeInt(record.updatedAtMs, 0),
  };
}

function createCelestialStargateRuntime(options: Record<string, any> = {}) {
  const now = typeof options.now === "function" ? options.now : Date.now;
  const repository = options.repository || (() => {
    const { createTableRepository } = require(path.join(
      __dirname,
      "../../gameStore/tableRepository",
    ));
    return createTableRepository("service:frontier", { strict: true });
  })();
  const findStargate = typeof options.findStargate === "function"
    ? options.findStargate
    : (stargateID) => require(path.join(__dirname, "../../space/worldData"))
      .getStargateByID(stargateID);
  const refreshActivation = typeof options.refreshActivation === "function"
    ? options.refreshActivation
    : (stargateID) => {
      try {
        const spaceRuntime = require(path.join(__dirname, "../../space/runtime"));
        return spaceRuntime.refreshStargateActivationStates({
          targetGateID: stargateID,
          broadcast: true,
        });
      } catch (_) {
        return [];
      }
    };
  const configPath = options.configPath === null
    ? null
    : path.resolve(options.configPath || process.env.EVEJS_STARGATE_MAINTENANCE_CONFIG || DEFAULT_CONFIG_PATH);
  const listeners = new Set<any>();
  let configured = options.autoConfigure === false;

  function readRawState() {
    repository.ensureTable(TABLE);
    const result = repository.read(TABLE, "/");
    return normalizeState(result && result.success ? result.data : null);
  }

  function writeState(state) {
    state.schemaVersion = SCHEMA_VERSION;
    state.revision = nonNegativeInt(state.revision, 0) + 1;
    if (state.signals.length > MAX_SIGNALS) {
      state.signals.splice(0, state.signals.length - MAX_SIGNALS);
    }
    const result = repository.write(TABLE, "/", state, { force: true });
    if (!result || result.success !== true) {
      return { success: false as const, errorMsg: "STARGATE_STATE_WRITE_FAILED" };
    }
    if (options.flush !== false) {
      const flush = repository.flushTableSync(TABLE);
      if (!flush || flush.success !== true) {
        return { success: false as const, errorMsg: "STARGATE_STATE_FLUSH_FAILED" };
      }
    }
    return { success: true as const };
  }

  function appendSignal(state, record, signalType, detail: Record<string, any> = {}) {
    const signal = {
      sequence: state.nextSequence++,
      atMs: now(),
      signalType,
      stargateID: record.stargateID,
      solarSystemID: record.solarSystemID,
      status: record.status,
      revision: record.revision,
      detail: cloneValue(detail),
    };
    state.signals.push(signal);
    return signal;
  }

  function publishSignals(signals) {
    for (const signal of signals) {
      for (const listener of listeners) {
        try { listener(cloneValue(signal)); } catch (_) { /* advisory observer */ }
      }
    }
  }

  function mutate(callback) {
    const state = readRawState();
    const firstSequence = state.nextSequence;
    const result = callback(state);
    if (!result || result.success !== true) return result;
    const written = writeState(state);
    if (!written.success) return written;
    publishSignals(state.signals.filter((signal) => signal.sequence >= firstSequence));
    return result;
  }

  function loadConfiguredGates() {
    if (configured) return;
    configured = true;
    if (!configPath || !fs.existsSync(configPath)) return;
    let parsed;
    try {
      parsed = JSON.parse(fs.readFileSync(configPath, "utf8"));
    } catch (error) {
      throw new Error(`Cannot read stargate maintenance config: ${error.message}`);
    }
    if (positiveInt(parsed && parsed.version, 0) !== 1 || !Array.isArray(parsed.gates)) {
      throw new Error("Stargate maintenance config must contain version 1 and a gates array");
    }
    for (const entry of parsed.gates) {
      if (entry && entry.enabled !== false) {
        configureDormantStargate(entry, { preserveExisting: true });
      }
    }
  }

  function configureDormantStargate(input, configureOptions: Record<string, any> = {}) {
    const stargateID = positiveInt(input && (input.stargateID ?? input.gateID), 0);
    const stargate = stargateID ? findStargate(stargateID) : null;
    if (!stargate) return { success: false as const, errorMsg: "STARGATE_NOT_FOUND" };
    const requirements = normalizeRequirements(input.requirements || input);
    if (requirements.materials.length + requirements.fuel.length === 0) {
      return { success: false as const, errorMsg: "STARGATE_REQUIREMENTS_EMPTY" };
    }
    const atMs = now();
    return mutate((state) => {
      const previous = state.gates[String(stargateID)] || null;
      if (previous && configureOptions.preserveExisting === true) {
        return { success: true as const, created: false, data: publicGateState(previous) };
      }
      const record = {
        schemaVersion: SCHEMA_VERSION,
        stargateID,
        typeID: positiveInt(stargate.typeID, 0),
        solarSystemID: positiveInt(stargate.solarSystemID, 0),
        destinationID: positiveInt(stargate.destinationID, 0),
        destinationSolarSystemID: positiveInt(stargate.destinationSolarSystemID, 0),
        status: STARGATE_MAINTENANCE_STATUS.DORMANT,
        requirements,
        deposited: {},
        pendingDeposits: {},
        receipts: [],
        maintenanceRequestKeys: [],
        reactivationDurationMs: nonNegativeInt(
          input.reactivationDurationMs,
          DEFAULT_REACTIVATION_DURATION_MS,
        ),
        activationCompleteAtMs: 0,
        revision: previous ? positiveInt(previous.revision, 1) + 1 : 1,
        createdAtMs: previous?.createdAtMs || atMs,
        updatedAtMs: atMs,
      };
      state.gates[String(stargateID)] = record;
      appendSignal(state, record, "stargate.dormant", {
        requirements: cloneValue(requirements),
      });
      setImmediate(() => refreshActivation(stargateID));
      return { success: true as const, created: !previous, data: publicGateState(record) };
    });
  }

  function getRecord(stargateID) {
    loadConfiguredGates();
    const numericID = positiveInt(stargateID, 0);
    if (!numericID) return null;
    settleStargateReactivation(numericID);
    return readRawState().gates[String(numericID)] || null;
  }

  function getStargateState(stargateID) {
    const record = getRecord(stargateID);
    return record
      ? { success: true as const, data: publicGateState(record) }
      : { success: false as const, errorMsg: "STARGATE_NOT_MANAGED" };
  }

  function listManagedStargates(filters: Record<string, any> = {}) {
    loadConfiguredGates();
    const systemID = positiveInt(filters.solarSystemID ?? filters.systemID, 0);
    const status = String(filters.status || "").trim().toLowerCase();
    const state = readRawState();
    const due = Object.values<any>(state.gates).filter((record) =>
      record.status === STARGATE_MAINTENANCE_STATUS.REACTIVATING &&
      nonNegativeInt(record.activationCompleteAtMs, 0) <= now());
    for (const record of due) settleStargateReactivation(record.stargateID);
    return Object.values<any>(readRawState().gates)
      .filter((record) => !systemID || record.solarSystemID === systemID)
      .filter((record) => !status || record.status === status)
      .sort((left, right) => left.stargateID - right.stargateID)
      .map(publicGateState);
  }

  function normalizeDepositEntries(record, rawEntries) {
    const requirements = new Map(allRequirements(record).map((entry) => [
      requirementKey(entry.kind, entry.typeID), entry,
    ]));
    const combined = new Map<string, any>();
    for (const raw of Array.isArray(rawEntries) ? rawEntries : []) {
      const kind = String(raw && raw.kind || "").trim().toLowerCase();
      const typeID = positiveInt(raw && (raw.typeID ?? raw.itemTypeID), 0);
      const quantity = positiveInt(raw && raw.quantity, 0);
      const key = requirementKey(kind, typeID);
      if (!requirements.has(key) || !quantity) {
        return { success: false as const, errorMsg: "STARGATE_RESOURCE_NOT_REQUIRED" };
      }
      const current = combined.get(key) || { kind, typeID, quantity: 0 };
      current.quantity += quantity;
      combined.set(key, current);
    }
    const entries = [...combined.values()];
    if (entries.length === 0) {
      return { success: false as const, errorMsg: "STARGATE_RESOURCES_REQUIRED" };
    }
    return { success: true as const, data: entries, requirements };
  }

  function prepareStargateResourceDeposit(stargateID, rawEntries, depositOptions: Record<string, any> = {}) {
    loadConfiguredGates();
    const numericID = positiveInt(stargateID, 0);
    const operationKey = String(depositOptions.operationKey || "").trim();
    if (!numericID || !operationKey || operationKey.length > 256) {
      return { success: false as const, errorMsg: "STARGATE_DEPOSIT_OPERATION_INVALID" };
    }
    return mutate((state) => {
      const record = state.gates[String(numericID)];
      if (!record) return { success: false as const, errorMsg: "STARGATE_NOT_MANAGED" };
      if (record.status === STARGATE_MAINTENANCE_STATUS.ACTIVE ||
          record.status === STARGATE_MAINTENANCE_STATUS.REACTIVATING) {
        return { success: false as const, errorMsg: "STARGATE_NOT_ACCEPTING_RESOURCES" };
      }
      const receipt = (record.receipts || []).find((entry) => entry.operationKey === operationKey);
      if (receipt) return { success: true as const, prepared: false, data: cloneValue(receipt) };
      const pending = record.pendingDeposits?.[operationKey];
      if (pending) return { success: true as const, prepared: false, data: cloneValue(pending) };
      const normalized = normalizeDepositEntries(record, rawEntries);
      if (!normalized.success) return normalized;
      for (const entry of normalized.data) {
        const requirement = normalized.requirements.get(requirementKey(entry.kind, entry.typeID));
        const available = requirement.quantity -
          depositedQuantity(record, entry.kind, entry.typeID) -
          reservedQuantity(record, entry.kind, entry.typeID);
        if (entry.quantity > available) {
          return { success: false as const, errorMsg: "STARGATE_RESOURCE_CAPACITY_EXCEEDED" };
        }
      }
      const prepared = {
        operationKey,
        status: "prepared",
        entries: cloneValue(normalized.data),
        actor: cloneValue(depositOptions.actor || null),
        preparedAtMs: now(),
      };
      record.pendingDeposits ||= {};
      record.pendingDeposits[operationKey] = prepared;
      record.revision += 1;
      record.updatedAtMs = now();
      return { success: true as const, prepared: true, data: cloneValue(prepared) };
    });
  }

  function commitStargateResourceDeposit(stargateID, operationKey) {
    loadConfiguredGates();
    const numericID = positiveInt(stargateID, 0);
    const key = String(operationKey || "").trim();
    if (!numericID || !key) {
      return { success: false as const, errorMsg: "STARGATE_DEPOSIT_OPERATION_INVALID" };
    }
    return mutate((state) => {
      const record = state.gates[String(numericID)];
      if (!record) return { success: false as const, errorMsg: "STARGATE_NOT_MANAGED" };
      const receipt = (record.receipts || []).find((entry) => entry.operationKey === key);
      if (receipt) return { success: true as const, committed: false, data: cloneValue(receipt) };
      const pending = record.pendingDeposits?.[key];
      if (!pending) return { success: false as const, errorMsg: "STARGATE_DEPOSIT_NOT_PREPARED" };
      for (const entry of pending.entries) {
        const depositKey = requirementKey(entry.kind, entry.typeID);
        record.deposited[depositKey] = depositedQuantity(record, entry.kind, entry.typeID) + entry.quantity;
      }
      delete record.pendingDeposits[key];
      const ready = resourcesReady(record);
      record.status = ready
        ? STARGATE_MAINTENANCE_STATUS.READY
        : STARGATE_MAINTENANCE_STATUS.DORMANT;
      record.revision += 1;
      record.updatedAtMs = now();
      const committed = {
        ...pending,
        status: "committed",
        committedAtMs: record.updatedAtMs,
        gateRevision: record.revision,
      };
      record.receipts = [...(record.receipts || []), committed].slice(-MAX_RECEIPTS_PER_GATE);
      appendSignal(state, record, "stargate.resources_deposited", {
        operationKey: key,
        entries: cloneValue(pending.entries),
        fuelLevel: fuelLevel(record),
        materialLevel: materialLevel(record),
        resourcesReady: ready,
      });
      if (ready) appendSignal(state, record, "stargate.reactivation_ready");
      else if (["empty", "low"].includes(fuelLevel(record))) {
        appendSignal(state, record, "stargate.fuel_low", { fuelLevel: fuelLevel(record) });
      }
      return { success: true as const, committed: true, data: cloneValue(committed), state: publicGateState(record) };
    });
  }

  function cancelStargateResourceDeposit(stargateID, operationKey) {
    loadConfiguredGates();
    const numericID = positiveInt(stargateID, 0);
    const key = String(operationKey || "").trim();
    return mutate((state) => {
      const record = state.gates[String(numericID)];
      if (!record) return { success: false as const, errorMsg: "STARGATE_NOT_MANAGED" };
      if (!record.pendingDeposits?.[key]) return { success: true as const, cancelled: false };
      delete record.pendingDeposits[key];
      record.revision += 1;
      record.updatedAtMs = now();
      return { success: true as const, cancelled: true };
    });
  }

  function requestStargateReactivation(stargateID, activationOptions: Record<string, any> = {}) {
    loadConfiguredGates();
    const numericID = positiveInt(stargateID, 0);
    const result = mutate((state) => {
      const record = state.gates[String(numericID)];
      if (!record) return { success: false as const, errorMsg: "STARGATE_NOT_MANAGED" };
      if (record.status === STARGATE_MAINTENANCE_STATUS.ACTIVE ||
          record.status === STARGATE_MAINTENANCE_STATUS.REACTIVATING) {
        return { success: true as const, changed: false, data: publicGateState(record) };
      }
      if (!resourcesReady(record)) {
        return { success: false as const, errorMsg: "STARGATE_RESOURCES_INCOMPLETE" };
      }
      const atMs = now();
      const durationMs = nonNegativeInt(
        activationOptions.durationMs,
        nonNegativeInt(record.reactivationDurationMs, DEFAULT_REACTIVATION_DURATION_MS),
      );
      record.status = durationMs > 0
        ? STARGATE_MAINTENANCE_STATUS.REACTIVATING
        : STARGATE_MAINTENANCE_STATUS.ACTIVE;
      record.activationCompleteAtMs = durationMs > 0 ? atMs + durationMs : 0;
      record.revision += 1;
      record.updatedAtMs = atMs;
      appendSignal(state, record, durationMs > 0
        ? "stargate.reactivation_started"
        : "stargate.reactivated", {
        actor: cloneValue(activationOptions.actor || null),
        activationCompleteAtMs: record.activationCompleteAtMs,
      });
      setImmediate(() => refreshActivation(numericID));
      return { success: true as const, changed: true, data: publicGateState(record) };
    });
    if (result && result.success &&
        result.data?.status === STARGATE_MAINTENANCE_STATUS.REACTIVATING) {
      const delayMs = Math.max(0, result.data.activationCompleteAtMs - now());
      const timer = setTimeout(() => settleStargateReactivation(numericID, {
        actor: activationOptions.actor || null,
      }), delayMs);
      if (typeof timer.unref === "function") timer.unref();
    }
    return result;
  }

  function settleStargateReactivation(stargateID, settleOptions: Record<string, any> = {}) {
    const numericID = positiveInt(stargateID, 0);
    if (!numericID) return { success: false as const, errorMsg: "STARGATE_NOT_FOUND" };
    const state = readRawState();
    const current = state.gates[String(numericID)];
    if (!current || current.status !== STARGATE_MAINTENANCE_STATUS.REACTIVATING ||
        nonNegativeInt(current.activationCompleteAtMs, 0) > now()) {
      return { success: true as const, changed: false, data: publicGateState(current) };
    }
    return mutate((draft) => {
      const record = draft.gates[String(numericID)];
      if (!record || record.status !== STARGATE_MAINTENANCE_STATUS.REACTIVATING ||
          nonNegativeInt(record.activationCompleteAtMs, 0) > now()) {
        return { success: true as const, changed: false, data: publicGateState(record) };
      }
      record.status = STARGATE_MAINTENANCE_STATUS.ACTIVE;
      record.activationCompleteAtMs = 0;
      record.revision += 1;
      record.updatedAtMs = now();
      appendSignal(draft, record, "stargate.reactivated", {
        actor: cloneValue(settleOptions.actor || null),
      });
      setImmediate(() => refreshActivation(numericID));
      return { success: true as const, changed: true, data: publicGateState(record) };
    });
  }

  function noteMaintenanceRequested(stargateID, missing, requestOptions: Record<string, any> = {}) {
    loadConfiguredGates();
    const numericID = positiveInt(stargateID, 0);
    const requestKey = String(requestOptions.requestKey || "").trim();
    return mutate((state) => {
      const record = state.gates[String(numericID)];
      if (!record) return { success: false as const, errorMsg: "STARGATE_NOT_MANAGED" };
      if (requestKey && (record.maintenanceRequestKeys || []).includes(requestKey)) {
        return { success: true as const, changed: false };
      }
      if (requestKey) {
        record.maintenanceRequestKeys = [...(record.maintenanceRequestKeys || []), requestKey].slice(-64);
      }
      record.revision += 1;
      record.updatedAtMs = now();
      const signal = appendSignal(state, record, "stargate.maintenance_requested", {
        missing: cloneValue(missing || []),
        requester: cloneValue(requestOptions.requester || null),
      });
      return { success: true as const, changed: true, data: cloneValue(signal) };
    });
  }

  function resolveActivationOverride(stargateID) {
    const record = getRecord(stargateID);
    if (!record || record.status === STARGATE_MAINTENANCE_STATUS.ACTIVE) return null;
    return 0;
  }

  function listSignals(stargateID, signalOptions: Record<string, any> = {}) {
    loadConfiguredGates();
    const numericID = positiveInt(stargateID, 0);
    const afterSequence = nonNegativeInt(signalOptions.afterSequence, 0);
    const limit = Math.max(1, Math.min(250, positiveInt(signalOptions.limit, 100)));
    const state = readRawState();
    const signals = state.signals
      .filter((signal) => (!numericID || signal.stargateID === numericID) && signal.sequence > afterSequence)
      .sort((left, right) => left.sequence - right.sequence)
      .slice(0, limit)
      .map(cloneValue);
    return {
      success: true as const,
      data: {
        signals,
        nextSequence: signals.length ? signals[signals.length - 1].sequence : afterSequence,
      },
    };
  }

  function subscribe(listener) {
    if (typeof listener !== "function") throw new Error("Stargate signal listener required");
    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  function getDepositReceipt(stargateID, operationKey) {
    const record = getRecord(stargateID);
    const key = String(operationKey || "").trim();
    return cloneValue((record?.receipts || []).find((entry) => entry.operationKey === key) || null);
  }

  return {
    configureDormantStargate,
    getStargateState,
    listManagedStargates,
    prepareStargateResourceDeposit,
    commitStargateResourceDeposit,
    cancelStargateResourceDeposit,
    requestStargateReactivation,
    settleStargateReactivation,
    noteMaintenanceRequested,
    resolveActivationOverride,
    listSignals,
    subscribe,
    getDepositReceipt,
    _testing: { readRawState, publicGateState, normalizeRequirements, resourcesReady },
  };
}

const runtime = createCelestialStargateRuntime({ autoConfigure: true });

module.exports = {
  TABLE,
  SCHEMA_VERSION,
  STARGATE_MAINTENANCE_STATUS,
  STARGATE_RESOURCE_KIND,
  DEFAULT_REACTIVATION_DURATION_MS,
  createCelestialStargateRuntime,
  ...runtime,
};
