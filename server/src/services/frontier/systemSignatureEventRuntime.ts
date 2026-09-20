"use strict";

/**
 * Durable, scanner-source-neutral transient signature journal.
 *
 * Travel systems publish normalized physical blooms here only after their own
 * authoritative transition commits.  The scanning runtime owns decay and
 * redaction; this module deliberately knows nothing about ships, characters,
 * Network Nodes, target locks, or Destiny balls.
 */

const crypto = require("crypto");
const path = require("path");

const TABLE = "systemSignatureEvents";
const STATE_VERSION = 1;
const MAX_EVENTS = 10_000;
const MAX_SIGNALS = 20_000;
const PHASES = new Set(["departure", "arrival"]);
const TRAVEL_MODES = new Set(["random", "directed"]);
const CHANNELS = Object.freeze(["gravimetric", "electromagnetic", "thermal"]);

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function toFinite(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function toPositiveInt(value, fallback = 0) {
  const numeric = Math.trunc(toFinite(value, fallback));
  return Number.isSafeInteger(numeric) && numeric > 0 ? numeric : fallback;
}

function vector(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const result = {
    x: toFinite(value.x, NaN),
    y: toFinite(value.y, NaN),
    z: toFinite(value.z, NaN),
  };
  return Object.values(result).every(Number.isFinite) ? result : null;
}

function normalizeChannels(value, minimum = 0) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const result = {};
  for (const channel of CHANNELS) {
    const normalized = toFinite(value[channel], NaN);
    if (!Number.isFinite(normalized) || normalized < minimum) return null;
    result[channel] = normalized;
  }
  return result;
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) =>
      `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function emptyState() {
  return { version: STATE_VERSION, nextSequence: 1, events: {}, signals: [] };
}

function normalizeState(value) {
  const source = value && typeof value === "object" && !Array.isArray(value)
    ? value : {};
  return {
    version: STATE_VERSION,
    nextSequence: Math.max(1, toPositiveInt(source.nextSequence, 1)),
    events: source.events && typeof source.events === "object" &&
      !Array.isArray(source.events) ? clone(source.events) : {},
    signals: Array.isArray(source.signals) ? clone(source.signals) : [],
  };
}

function createSystemSignatureEventRuntime(options: Record<string, any> = {}) {
  const now = typeof options.now === "function" ? options.now : Date.now;
  const config = options.config || require(path.join(__dirname, "../../config"));
  const repository = options.repository || (() => {
    const { createTableRepository } = require(path.join(
      __dirname, "../../gameStore/tableRepository",
    ));
    return createTableRepository("service:frontier", { strict: true });
  })();

  function readState() {
    repository.ensureTable(TABLE);
    const result = repository.read(TABLE, "/");
    return normalizeState(result && result.success ? result.data : null);
  }

  function writeState(state) {
    state.version = STATE_VERSION;
    if (state.signals.length > MAX_SIGNALS) {
      state.signals.splice(0, state.signals.length - MAX_SIGNALS);
    }
    const ordered = Object.values<any>(state.events)
      .sort((left, right) => toFinite(left.occurredAtMs) - toFinite(right.occurredAtMs));
    while (ordered.length > MAX_EVENTS) {
      const event = ordered.shift();
      if (event) delete state.events[event.eventKey];
    }
    const result = repository.write(TABLE, "/", state);
    return result && result.success;
  }

  function appendSignal(state, kind, event, detail = null) {
    const signal: Record<string, any> = {
      sequence: state.nextSequence++,
      kind,
      atMs: now(),
      systemID: event.systemID,
      observationID: event.observationID,
      phase: event.phase,
      travelMode: event.travelMode,
    };
    if (detail) signal.detail = clone(detail);
    state.signals.push(signal);
    return signal;
  }

  function configuredHalfLives() {
    return {
      gravimetric: Math.max(1, toPositiveInt(
        config.frontierSignatureBloomGravimetricHalfLifeMs, 300_000,
      )),
      electromagnetic: Math.max(1, toPositiveInt(
        config.frontierSignatureBloomElectromagneticHalfLifeMs, 180_000,
      )),
      thermal: Math.max(1, toPositiveInt(
        config.frontierSignatureBloomThermalHalfLifeMs, 120_000,
      )),
    };
  }

  function normalizeEvent(input) {
    const eventKey = String(input && input.eventKey || "").trim();
    const systemID = toPositiveInt(input && input.systemID, 0);
    const phase = String(input && input.phase || "").trim().toLowerCase();
    const travelMode = String(input && input.travelMode || "").trim().toLowerCase();
    const position = vector(input && input.approximatePosition);
    const channelIntensity = normalizeChannels(input && input.channelIntensity, 0);
    const halfLifeMs = input && input.halfLifeMs
      ? normalizeChannels(input.halfLifeMs, Number.EPSILON)
      : configuredHalfLives();
    const occurredAtMs = Math.max(0, toFinite(input && input.occurredAtMs, now()));
    if (!eventKey || eventKey.length > 256 || !systemID || !PHASES.has(phase) ||
        !TRAVEL_MODES.has(travelMode) || !position || !channelIntensity || !halfLifeMs) {
      return { success: false as const, errorMsg: "SIGNATURE_BLOOM_INVALID" };
    }
    const defaultRetention = Math.max(
      ...CHANNELS.map((channel) => halfLifeMs[channel] * 8),
      toPositiveInt(config.frontierSignatureBloomRetentionMs, 1_800_000),
    );
    const expiresAtMs = Math.max(
      occurredAtMs + 1,
      toFinite(input && input.expiresAtMs, occurredAtMs + defaultRetention),
    );
    const observationID = crypto.createHash("sha256")
      .update(`evejs:signature-bloom:${systemID}:${phase}:${eventKey}`)
      .digest("hex").slice(0, 24);
    return {
      success: true as const,
      data: {
        eventKey,
        observationID,
        systemID,
        phase,
        travelMode,
        occurredAtMs,
        approximatePosition: position,
        massKg: Math.max(0, toFinite(input && input.massKg, 0)),
        fuelTypeID: toPositiveInt(input && input.fuelTypeID, 0) || null,
        fuelConsumed: Math.max(0, toFinite(input && input.fuelConsumed, 0)),
        heatAdded: Math.max(0, toFinite(input && input.heatAdded, 0)),
        channelIntensity,
        halfLifeMs,
        expiresAtMs,
      },
    };
  }

  function pruneState(state, atMs = now()) {
    let changed = false;
    for (const event of Object.values<any>(state.events)) {
      if (toFinite(event && event.expiresAtMs, 0) > atMs) continue;
      appendSignal(state, "signature_bloom.expired", event);
      delete state.events[event.eventKey];
      changed = true;
    }
    return changed;
  }

  function recordSystemSignatureBloom(input) {
    const normalized = normalizeEvent(input);
    if (!normalized.success) return normalized;
    const state = readState();
    pruneState(state);
    const existing = state.events[normalized.data.eventKey];
    if (existing) {
      return stableJson(existing) === stableJson(normalized.data)
        ? { success: true as const, created: false, data: clone(existing) }
        : { success: false as const, errorMsg: "SIGNATURE_BLOOM_KEY_CONFLICT" };
    }
    state.events[normalized.data.eventKey] = normalized.data;
    appendSignal(state, "signature_bloom.created", normalized.data);
    if (!writeState(state)) {
      return { success: false as const, errorMsg: "SIGNATURE_BLOOM_PERSIST_FAILED" };
    }
    return { success: true as const, created: true, data: clone(normalized.data) };
  }

  function decayEvent(event, atMs = now()) {
    const elapsedMs = Math.max(0, atMs - toFinite(event.occurredAtMs, atMs));
    const intensity = {};
    for (const channel of CHANNELS) {
      const initial = Math.max(0, toFinite(event.channelIntensity && event.channelIntensity[channel], 0));
      const halfLife = Math.max(1, toFinite(event.halfLifeMs && event.halfLifeMs[channel], 1));
      intensity[channel] = initial * Math.pow(2, -elapsedMs / halfLife);
    }
    return { ...clone(event), channelIntensity: intensity, observedAtMs: atMs };
  }

  function listActiveSystemSignatureBlooms(systemID, atMs = now()) {
    const numericSystemID = toPositiveInt(systemID, 0);
    if (!numericSystemID) return [];
    const state = readState();
    const changed = pruneState(state, atMs);
    if (changed) writeState(state);
    return Object.values<any>(state.events)
      .filter((event) => event.systemID === numericSystemID && event.expiresAtMs > atMs)
      .map((event) => decayEvent(event, atMs))
      .sort((left, right) => left.occurredAtMs - right.occurredAtMs ||
        left.observationID.localeCompare(right.observationID));
  }

  function recordSignatureBloomDetected(observationID, detail: Record<string, any> = {}) {
    const normalizedID = String(observationID || "").trim();
    if (!normalizedID) return { success: false as const, errorMsg: "SIGNATURE_BLOOM_NOT_FOUND" };
    const state = readState();
    pruneState(state);
    const event = Object.values<any>(state.events)
      .find((entry) => entry && entry.observationID === normalizedID);
    if (!event) return { success: false as const, errorMsg: "SIGNATURE_BLOOM_NOT_FOUND" };
    const signal = appendSignal(state, "signature_bloom.detected", event, {
      confidence: Math.max(0, Math.min(1, toFinite(detail.confidence, 0))),
      scannerSourceClass: String(detail.scannerSourceClass || "unknown").slice(0, 64),
    });
    return writeState(state)
      ? { success: true as const, data: clone(signal) }
      : { success: false as const, errorMsg: "SIGNATURE_BLOOM_PERSIST_FAILED" };
  }

  function listSignals(options: Record<string, any> = {}) {
    const afterSequence = Math.max(0, Math.trunc(toFinite(options.afterSequence, 0)));
    const limit = Math.max(1, Math.min(500, Math.trunc(toFinite(options.limit, 100))));
    const state = readState();
    const changed = pruneState(state);
    if (changed) writeState(state);
    return state.signals.filter((signal) => signal.sequence > afterSequence).slice(0, limit);
  }

  return {
    recordSystemSignatureBloom,
    recordSignatureBloomDetected,
    listActiveSystemSignatureBlooms,
    listSignals,
    pruneExpiredBlooms(atMs = now()) {
      const state = readState();
      const changed = pruneState(state, atMs);
      if (changed) writeState(state);
      return { success: true as const, changed };
    },
    _testing: { readState, decayEvent, normalizeEvent },
  };
}

const singleton = createSystemSignatureEventRuntime();

module.exports = {
  TABLE,
  CHANNELS,
  createSystemSignatureEventRuntime,
  ...singleton,
};
