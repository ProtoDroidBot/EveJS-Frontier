"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { encodeUniverseDelta } = require("./explorationUniverseEncoder");

type Identity = { userID: number; characterID: number | null; currentSystemID?: number };
type Ladder = { detected: number[]; resolved: number[] };
type Knowledge = { revision: number; visited: number[]; thermal?: Ladder; em?: Ladder };

function failure(statusCode, message) {
  return Object.assign(new Error(message), { statusCode });
}

function identityKey(identity: Identity) {
  if (!identity || !Number.isSafeInteger(identity.userID) || identity.userID <= 0 ||
      (identity.characterID !== null && (!Number.isSafeInteger(identity.characterID) || identity.characterID <= 0))) {
    throw failure(401, "EXPLORATION_AUTHENTICATION_REQUIRED");
  }
  return `${identity.userID}-${identity.characterID || 0}`;
}

// A synchronous atomic store keeps a request's knowledge revision and notice
// consistent. It never opens the simulation database or mutates static tables.
function createFileKnowledgeStore(directory: string) {
  return {
    read(key: string) {
      if (!/^[1-9][0-9]*-[0-9]+$/.test(key)) throw new Error("Invalid exploration state key");
      try {
        return JSON.parse(fs.readFileSync(path.join(directory, `${key}.json`), "utf8"));
      } catch (error) {
        if (error.code === "ENOENT") return null;
        throw failure(503, "EXPLORATION_STATE_UNAVAILABLE");
      }
    },
    write(key: string, state: Knowledge) {
      if (!/^[1-9][0-9]*-[0-9]+$/.test(key)) throw new Error("Invalid exploration state key");
      const destination = path.join(directory, `${key}.json`);
      const temporary = `${destination}.tmp-${crypto.randomUUID()}`;
      try {
        fs.mkdirSync(directory, { recursive: true });
        fs.writeFileSync(temporary, JSON.stringify(state), { mode: 0o600, flag: "wx" });
        fs.renameSync(temporary, destination);
      } catch (_) {
        try { fs.unlinkSync(temporary); } catch (_) { /* May not have been created. */ }
        throw failure(503, "EXPLORATION_STATE_UNAVAILABLE");
      }
    },
  };
}

function createExplorationRuntime(options: Record<string, any>) {
  const world = options.world;
  const stateStore = options.stateStore;
  if (!world || !stateStore) throw new Error("Exploration requires an explicit world and knowledge store");
  const encode = options.encode || encodeUniverseDelta;
  const secret = options.cursorSecret || crypto.randomBytes(32);
  const listeners = new Set<(event: any) => void>();
  const allIDs: number[] = [...world.systems.keys()].sort((a, b) => a - b);

  function readState(identity: Identity): Knowledge {
    const key = identityKey(identity);
    if (!identity.characterID) return { revision: 0, visited: [] };
    const state = stateStore.read(key) || { revision: 0, visited: [] };
    if (!Number.isSafeInteger(state.revision) || state.revision < 0 || !Array.isArray(state.visited) ||
        state.visited.some((id, i) => !Number.isSafeInteger(id) || !world.systems.has(id) || (i && state.visited[i - 1] >= id))) {
      throw failure(503, "EXPLORATION_STATE_INVALID");
    }
    const result: Knowledge = { revision: state.revision, visited: [...state.visited] };
    for (const channel of ["thermal", "em"]) {
      const ladder = state[channel] || { detected: [], resolved: [] };
      for (const key of ["detected", "resolved"]) if (!Array.isArray(ladder[key]) || ladder[key].some((id, i) => !Number.isSafeInteger(id) || !world.systems.has(id) || i > 0 && ladder[key][i - 1] >= id)) throw failure(503, "EXPLORATION_STATE_INVALID");
      if (ladder.resolved.some(id => !ladder.detected.includes(id))) throw failure(503, "EXPLORATION_STATE_INVALID");
      result[channel] = { detected: [...ladder.detected], resolved: [...ladder.resolved] };
    }
    return result;
  }

  function knowledge(state: Knowledge) {
    return {
      revision: String(state.revision), complete: true,
      visited_system_ids: state.visited.map(String),
      thermal: { detected_system_ids: (state.thermal?.detected || []).map(String), resolved_system_ids: (state.thermal?.resolved || []).map(String) },
      em: { detected_system_ids: (state.em?.detected || []).map(String), resolved_system_ids: (state.em?.resolved || []).map(String) },
    };
  }

  function bundle(ids: number[], detail: boolean, state: Knowledge) {
    const delta = world.makeDelta(ids, detail, state.revision);
    if (!detail) {
      const visited = new Set(state.visited);
      const visitedIDs = ids.filter(id => visited.has(id));
      if (visitedIDs.length) {
        const details = new Map<number, any>(world.makeDelta(visitedIDs, true, state.revision).systems.map(system => [Number(system.id), system]));
        // The target only upgrades charted rows to visited rows. It will not
        // replace an already-visited summary on a later detail response, so a
        // visited row must include its local data on the first hydration page.
        delta.systems = delta.systems.map(system => details.get(Number(system.id)) || system);
      }
    }
    return { bundle_version: world.version, payload: encode(delta) };
  }

  // Only trusted server callers may reveal a visit. A requested system ID is
  // deliberately never passed here by getSystemDetail.
  function revealSystem(identity: Identity, systemID: number) {
    const key = identityKey(identity);
    if (!identity.characterID) throw failure(403, "EXPLORATION_CHARACTER_REQUIRED");
    if (!Number.isSafeInteger(systemID) || !world.systems.has(systemID)) {
      throw failure(409, "EXPLORATION_SESSION_WORLD_MISMATCH");
    }
    const state = readState(identity);
    if (state.visited.includes(systemID)) return state;
    if (state.revision === Number.MAX_SAFE_INTEGER) throw failure(503, "EXPLORATION_REVISION_EXHAUSTED");
    state.revision++;
    state.visited.push(systemID);
    state.visited.sort((a, b) => a - b);
    // Encode before committing: invalid data must not record a reveal that the
    // client cannot consume. Delivery failure cannot roll back a saved visit.
    const payload = { ...bundle([systemID], true, state), knowledge: knowledge(state) };
    stateStore.write(key, state);
    for (const listener of listeners) {
      try { listener({ identity: { ...identity }, payload }); } catch (_) { /* A disconnected notice consumer is recoverable by hydration. */ }
    }
    return state;
  }

  function synchronize(identity: Identity) {
    identityKey(identity);
    return identity.characterID && identity.currentSystemID !== undefined
      ? revealSystem(identity, identity.currentSystemID)
      : readState(identity);
  }

  // Only server scan evaluators call this. Detection never grants a visit or
  // permission to request undiscovered system detail.
  function recordScanDiscovery(identity: Identity, systemID: number, observation) {
    const key = identityKey(identity);
    if (!identity.characterID) throw failure(403, "EXPLORATION_CHARACTER_REQUIRED");
    if (!Number.isSafeInteger(systemID) || !world.systems.has(systemID)) throw failure(409, "EXPLORATION_SESSION_WORLD_MISMATCH");
    const state = readState(identity);
    let changed = false;
    for (const channel of ["thermal", "em"]) {
      const level = observation?.[channel];
      if (level === undefined) continue;
      if (!["detected", "resolved"].includes(level)) throw failure(400, "INVALID_SCAN_DISCOVERY");
      const ladder = state[channel] || { detected: [], resolved: [] };
      for (const field of level === "resolved" ? ["detected", "resolved"] : ["detected"]) if (!ladder[field].includes(systemID)) { ladder[field].push(systemID); ladder[field].sort((a, b) => a - b); changed = true; }
      state[channel] = ladder;
    }
    if (!changed) return state;
    if (state.revision === Number.MAX_SAFE_INTEGER) throw failure(503, "EXPLORATION_REVISION_EXHAUSTED");
    state.revision++;
    const payload = { ...bundle([systemID], state.visited.includes(systemID), state), knowledge: knowledge(state) };
    stateStore.write(key, state);
    for (const listener of listeners) try { listener({ identity: { ...identity }, payload }); } catch (_) { /* Hydration recovers missed notices. */ }
    return state;
  }

  function previewState(identity: Identity) {
    const state = readState(identity);
    if (identity.characterID && identity.currentSystemID !== undefined) {
      if (!Number.isSafeInteger(identity.currentSystemID) || !world.systems.has(identity.currentSystemID)) {
        throw failure(409, "EXPLORATION_SESSION_WORLD_MISMATCH");
      }
      if (!state.visited.includes(identity.currentSystemID)) {
        if (state.revision === Number.MAX_SAFE_INTEGER) throw failure(503, "EXPLORATION_REVISION_EXHAUSTED");
        state.revision++;
        state.visited.push(identity.currentSystemID);
        state.visited.sort((a, b) => a - b);
      }
    }
    return state;
  }

  function signature(body: string) {
    return crypto.createHmac("sha256", secret).update(body).digest("base64url");
  }

  function cursor(identity: Identity, state: Knowledge, offset: number, size: number) {
    const body = Buffer.from(JSON.stringify({
      world: world.revision, identity: identityKey(identity), revision: state.revision, offset, size,
    })).toString("base64url");
    return `${body}.${signature(body)}`;
  }

  function parseCursor(token: string, identity: Identity, state: Knowledge) {
    try {
      if (token.length > 2048 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)) throw new Error();
      const [body, signed] = token.split(".");
      const expected = Buffer.from(signature(body));
      const actual = Buffer.from(signed);
      if (expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) throw new Error();
      const value = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
      if (value.world !== world.revision || value.identity !== identityKey(identity) || value.revision !== state.revision ||
          !Number.isSafeInteger(value.offset) || value.offset <= 0 || !Number.isSafeInteger(value.size) || value.size < 1 || value.size > 512) throw new Error();
      return value;
    } catch (_) {
      throw failure(400, "INVALID_EXPLORATION_PAGE_TOKEN");
    }
  }

  return {
    getKnownUniverse(identity: Identity, page: { size?: number; token?: string } = {}) {
      if (page.size !== undefined && (!Number.isInteger(page.size) || page.size < 0 || page.size > 512)) {
        throw failure(400, "INVALID_EXPLORATION_PAGE_SIZE");
      }
      if (page.token !== undefined && typeof page.token !== "string") throw failure(400, "INVALID_EXPLORATION_PAGE_TOKEN");
      // Validate against the prospective visit revision before persisting it:
      // a rejected page request must not publish or commit a reveal.
      const state = previewState(identity);
      const ids = identity.characterID ? allIDs : world.starterSystemIds;
      const paging = page.token ? parseCursor(page.token, identity, state) : { offset: 0, size: page.size || 128 };
      if (page.token && ((page.size && page.size !== paging.size) || paging.offset >= ids.length)) {
        throw failure(400, "INVALID_EXPLORATION_PAGE_TOKEN");
      }
      const end = Math.min(paging.offset + paging.size, ids.length);
      synchronize(identity);
      return {
        ...bundle(ids.slice(paging.offset, end), false, state),
        next_page: { token: end < ids.length ? cursor(identity, state, end, paging.size) : "" },
        total_systems: String(ids.length), knowledge: knowledge(state),
      };
    },
    getSystemDetail(identity: Identity, systemID: string) {
      identityKey(identity);
      if (!identity.characterID) throw failure(403, "EXPLORATION_CHARACTER_REQUIRED");
      if (!/^[1-9][0-9]*$/.test(systemID) || !Number.isSafeInteger(Number(systemID))) throw failure(400, "INVALID_SOLAR_SYSTEM_ID");
      const id = Number(systemID);
      if (!world.systems.has(id)) throw failure(404, "EXPLORATION_SYSTEM_NOT_FOUND");
      const state = previewState(identity);
      if (!state.visited.includes(id)) throw failure(403, "EXPLORATION_SYSTEM_NOT_VISITED");
      synchronize(identity);
      return bundle([id], true, state);
    },
    revealSystem,
    recordScanDiscovery,
    subscribe(listener: (event: any) => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

let defaultRuntime = null;

function getExplorationRuntime() {
  if (defaultRuntime) return defaultRuntime;
  const worldPath = process.env.EVEJS_EXPLORATION_WORLD_PATH;
  if (!worldPath) throw failure(503, "EXPLORATION_WORLD_NOT_CONFIGURED");
  try {
    const { getConfiguredExplorationWorld } = require("./explorationWorld");
    const { resolveStoreRoot } = require("../../gameStore/storeRoot");
    const world = getConfiguredExplorationWorld();
    const directory = path.join(resolveStoreRoot(), "exploration", world.revision);
    defaultRuntime = createExplorationRuntime({ world, stateStore: createFileKnowledgeStore(directory) });
    return defaultRuntime;
  } catch (error) {
    if (error.statusCode) throw error;
    throw failure(503, "EXPLORATION_WORLD_INVALID");
  }
}

module.exports = { createExplorationRuntime, createFileKnowledgeStore, getExplorationRuntime };
