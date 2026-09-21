"use strict";

const path = require("path");

const TABLE = "networkNodeEnergyHolds";
const STATE_VERSION = 1;

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function toFiniteNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function toPositiveInt(value, fallback = 0) {
  const numeric = Math.trunc(toFiniteNumber(value, fallback));
  return Number.isSafeInteger(numeric) && numeric > 0 ? numeric : fallback;
}

function normalizeState(value) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  return {
    version: STATE_VERSION,
    holds: source.holds && typeof source.holds === "object" && !Array.isArray(source.holds)
      ? clone(source.holds)
      : {},
  };
}

function createNetworkNodeEnergyHoldRuntime(options: Record<string, any> = {}) {
  const now = typeof options.now === "function" ? options.now : Date.now;
  const repository = options.repository || (() => {
    const { createTableRepository } = require(path.join(
      __dirname,
      "../../gameStore/tableRepository",
    ));
    return createTableRepository("service:frontier", { strict: true });
  })();

  function readState() {
    repository.ensureTable(TABLE);
    const result = repository.read(TABLE, "/");
    return normalizeState(result && result.success ? result.data : null);
  }

  function pruneState(state, atMs = now()) {
    let changed = false;
    for (const [holdID, hold] of Object.entries<any>(state.holds)) {
      if (!hold || toFiniteNumber(hold.expiresAtMs, 0) <= atMs) {
        delete state.holds[holdID];
        changed = true;
      }
    }
    return changed;
  }

  function writeState(state) {
    state.version = STATE_VERSION;
    const result = repository.write(TABLE, "/", state);
    return Boolean(result && result.success);
  }

  function listNetworkNodeEnergyHolds(networkNodeID, atMs = now()) {
    const nodeID = toPositiveInt(networkNodeID, 0);
    if (!nodeID) return [];
    const state = readState();
    if (pruneState(state, atMs)) writeState(state);
    return Object.values<any>(state.holds)
      .filter((hold) => toPositiveInt(hold.networkNodeID, 0) === nodeID)
      .sort((left, right) =>
        toFiniteNumber(left.expiresAtMs, 0) - toFiniteNumber(right.expiresAtMs, 0) ||
        String(left.holdID).localeCompare(String(right.holdID)))
      .map(clone);
  }

  function getNetworkNodeHeldEnergy(networkNodeID, atMs = now()) {
    return listNetworkNodeEnergyHolds(networkNodeID, atMs)
      .reduce((total, hold) => total + Math.max(0, toFiniteNumber(hold.energy, 0)), 0);
  }

  function reserveNetworkNodeEnergyHold(request: Record<string, any> = {}) {
    const holdID = String(request.holdID || "").trim().toLowerCase();
    const networkNodeID = toPositiveInt(request.networkNodeID, 0);
    const energy = Math.max(0, toFiniteNumber(request.energy, 0));
    const createdAtMs = toFiniteNumber(request.createdAtMs, now());
    const expiresAtMs = toFiniteNumber(request.expiresAtMs, 0);
    const availableEnergy = Math.max(0, toFiniteNumber(request.availableEnergy, 0));
    if (!holdID || holdID.length > 192 || !/^[a-z0-9][a-z0-9._:/-]*$/u.test(holdID)) {
      return { success: false as const, errorMsg: "NETWORK_NODE_ENERGY_HOLD_ID_INVALID" };
    }
    if (!networkNodeID || expiresAtMs <= createdAtMs) {
      return { success: false as const, errorMsg: "NETWORK_NODE_ENERGY_HOLD_INVALID" };
    }

    const state = readState();
    pruneState(state, createdAtMs);
    const existing = state.holds[holdID];
    if (existing) {
      const matches =
        toPositiveInt(existing.networkNodeID, 0) === networkNodeID &&
        toFiniteNumber(existing.energy, -1) === energy &&
        toFiniteNumber(existing.expiresAtMs, 0) === expiresAtMs;
      return matches
        ? { success: true as const, created: false, data: clone(existing) }
        : { success: false as const, errorMsg: "NETWORK_NODE_ENERGY_HOLD_CONFLICT" };
    }
    if (energy > availableEnergy) {
      return { success: false as const, errorMsg: "REMOTE_SCAN_INSUFFICIENT_ENERGY" };
    }

    const hold = {
      holdID,
      networkNodeID,
      energy,
      createdAtMs,
      expiresAtMs,
      reason: String(request.reason || "temporary").trim() || "temporary",
      referenceID: request.referenceID === undefined || request.referenceID === null
        ? null
        : String(request.referenceID),
    };
    state.holds[holdID] = hold;
    return writeState(state)
      ? { success: true as const, created: true, data: clone(hold) }
      : { success: false as const, errorMsg: "NETWORK_NODE_ENERGY_HOLD_PERSIST_FAILED" };
  }

  function releaseNetworkNodeEnergyHold(holdID) {
    const normalizedHoldID = String(holdID || "").trim().toLowerCase();
    const state = readState();
    pruneState(state);
    if (!Object.hasOwn(state.holds, normalizedHoldID)) {
      return { success: true as const, changed: false };
    }
    delete state.holds[normalizedHoldID];
    return writeState(state)
      ? { success: true as const, changed: true }
      : { success: false as const, errorMsg: "NETWORK_NODE_ENERGY_HOLD_PERSIST_FAILED" };
  }

  return {
    reserveNetworkNodeEnergyHold,
    releaseNetworkNodeEnergyHold,
    listNetworkNodeEnergyHolds,
    getNetworkNodeHeldEnergy,
    _testing: { readState, writeState, pruneState },
  };
}

const singleton = createNetworkNodeEnergyHoldRuntime();

module.exports = {
  TABLE,
  createNetworkNodeEnergyHoldRuntime,
  ...singleton,
};
