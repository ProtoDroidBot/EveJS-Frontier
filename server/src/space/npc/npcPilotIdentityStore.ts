import { createHash, randomUUID } from "node:crypto";
const { NPC_CHARACTER_ID_MIN, NPC_CHARACTER_ID_MAX } = require("../../services/_shared/npcIdentityConstants");

export const NPC_PILOT_IDENTITY_TABLE = "npcPilotIdentities";

/** A public faction identifier, never a wallet seed or a player account ID. */
export function buildNpcFactionIdentityKey(factionID: unknown, factionStringOnlyID: unknown = "") {
  const numeric = factionID == null || factionID === "" ? 0 : Number(factionID);
  if (!Number.isSafeInteger(numeric) || numeric < 0 || numeric > 0xffffffff) {
    throw new Error("NPC factionID must fit an unsigned 32-bit integer");
  }
  const text = String(factionStringOnlyID ?? "").trim().toLowerCase();
  if (text && (!/^[a-z0-9][a-z0-9_-]{0,95}$/.test(text) || text === "none")) {
    throw new Error("NPC string faction ID must be a slug of at most 96 characters; none is reserved");
  }
  // 0-none also represents genuinely unaffiliated NPCs; do not guess a faction.
  return `${numeric}-${text || "none"}`;
}

export type NpcPilotIdentity = {
  characterID: number;
  characterName: string;
  factionKey: string;
  factionID: number;
  factionStringOnlyID: string | null;
  systemID: number;
  identitySlot: string;
  slotKey: string;
  profileID: string | null;
  activeEntityID: number | null;
  incarnation: number;
  deaths: number;
  createdAtMs: number;
  updatedAtMs: number;
  sui?: Record<string, any>;
};

function positiveID(value: unknown, label: string) {
  const numeric = Number(value);
  if (!Number.isSafeInteger(numeric) || numeric <= 0) throw new Error(`${label} must be a positive safe integer`);
  return numeric;
}

/** The identity ledger is durable even when the ships it identifies are transient. */
export function createNpcPilotIdentityStore(database: any, now = Date.now) {
  const table = NPC_PILOT_IDENTITY_TABLE;
  const clone = <T>(value: T): T => value == null ? value : JSON.parse(JSON.stringify(value));
  function write(pth: string, value: unknown) {
    const result = database.write(table, pth, value);
    if (!result?.success) throw new Error(`NPC identity persistence failed: ${result?.errorMsg || "write"}`);
  }
  function root() {
    const read = database.read(table, "/");
    if (!read.success) throw new Error("NPC identity ledger is unavailable; refusing to replace it");
    if (read.data?.version === 1) {
      const state = read.data;
      if (![state.pilots, state.slots, state.factions].every(value => value && typeof value === "object" && !Array.isArray(value)) ||
          !Number.isSafeInteger(state.nextCharacterID) || state.nextCharacterID < NPC_CHARACTER_ID_MIN || state.nextCharacterID > NPC_CHARACTER_ID_MAX + 1) {
        throw new Error("Corrupt NPC pilot identity ledger; refusing to discard identities");
      }
      return state;
    }
    if (read.success && read.data && Object.keys(read.data).length) {
      throw new Error("Unsupported NPC pilot identity ledger; refusing to discard identities");
    }
    const initial = { version: 1, nextCharacterID: NPC_CHARACTER_ID_MIN, pilots: {}, slots: {}, factions: {} };
    write("/", initial);
    return initial;
  }
  function flush() {
    // Persist the native counter at the same boundary so transient ship IDs cannot
    // be reused after a restart and accidentally acquire an old pilot lease.
    // Commit native high-water marks/deletions before the corresponding lease.
    // A crash can leave an orphan lease (recoverable), never a reused ship ID.
    for (const name of ["npcEntities", table]) {
      const result = database.flushTablesSync([name]);
      if (!result?.success) throw new Error("NPC identity ledger could not be flushed");
    }
  }
  function get(characterID: number): NpcPilotIdentity | null {
    return clone(root().pilots?.[String(characterID)] || null);
  }
  function list(): NpcPilotIdentity[] {
    return Object.values<NpcPilotIdentity>(root().pilots || {}).map(clone);
  }
  function update(characterID: number, updater: (current: NpcPilotIdentity) => NpcPilotIdentity) {
    const current = get(characterID);
    if (!current) throw new Error(`NPC pilot ${characterID} does not exist`);
    const next = updater(current);
    if (next.characterID !== current.characterID || next.slotKey !== current.slotKey || next.factionKey !== current.factionKey) {
      throw new Error("NPC pilot identity cannot be reassigned");
    }
    write(`/pilots/${characterID}`, { ...next, updatedAtMs: now() });
    flush();
    return get(characterID)!;
  }
  function acquire(input: Record<string, any>): NpcPilotIdentity {
    const entityID = positiveID(input.entityID, "NPC entity ID");
    const systemID = positiveID(input.systemID, "NPC system ID");
    const factionKey = buildNpcFactionIdentityKey(input.factionID, input.factionStringOnlyID);
    const identitySlot = String(input.identitySlot || `ephemeral:${randomUUID()}`).trim();
    if (!identitySlot || identitySlot.length > 1024) throw new Error("NPC identity slot must contain 1–1024 characters");
    const slotKey = createHash("sha256").update(JSON.stringify([systemID, factionKey, identitySlot])).digest("hex");
    const state = root();
    const previousID = state.slots?.[slotKey];
    const previous = previousID ? get(previousID) : null;
    if (previousID && !previous) throw new Error("NPC identity slot points to a missing pilot");
    if (previous?.activeEntityID && previous.activeEntityID !== entityID) {
      const active = database.read("npcEntities", `/entities/${previous.activeEntityID}`);
      if (active.success && Number(active.data?.npcCharacterID) === previous.characterID) {
        throw new Error(`NPC identity slot is already occupied by entity ${previous.activeEntityID}`);
      }
    }
    let characterID = previous?.characterID;
    if (!characterID) {
      characterID = Math.max(Number(state.nextCharacterID) || NPC_CHARACTER_ID_MIN, NPC_CHARACTER_ID_MIN);
      if (!Number.isSafeInteger(characterID)) throw new Error("Invalid NPC pilot allocation counter");
      while (characterID <= NPC_CHARACTER_ID_MAX && (
        state.pilots?.[characterID] ||
        database.read("characters", `/${characterID}`).success ||
        database.read("items", `/${characterID}`).success
      )) characterID += 1;
      if (characterID > NPC_CHARACTER_ID_MAX) throw new Error("NPC character ID range exhausted");
      write("/nextCharacterID", characterID + 1);
    }
    const stamp = now();
    const pilot: NpcPilotIdentity = {
      characterID,
      characterName: previous?.characterName || `${String(input.characterName || "NPC").trim()} #${characterID}`,
      factionKey,
      factionID: Number(input.factionID) || 0,
      factionStringOnlyID: String(input.factionStringOnlyID || "").trim().toLowerCase() || null,
      systemID,
      identitySlot,
      slotKey,
      profileID: input.profileID || null,
      activeEntityID: entityID,
      incarnation: (previous?.incarnation || 0) + (previous?.activeEntityID === entityID ? 0 : 1),
      deaths: previous?.deaths || 0,
      createdAtMs: previous?.createdAtMs || stamp,
      updatedAtMs: stamp,
      ...(previous?.sui ? { sui: previous.sui } : {}),
    };
    write(`/pilots/${characterID}`, pilot);
    write(`/slots/${slotKey}`, characterID);
    if (!state.factions?.[factionKey]) {
      write(`/factions/${factionKey}`, { factionKey, factionID: pilot.factionID, factionStringOnlyID: pilot.factionStringOnlyID });
    }
    flush();
    return clone(pilot);
  }
  function release(characterID: number, entityID: number, destroyed = false) {
    const current = get(characterID);
    // A delayed callback from a previous incarnation cannot retire its successor.
    if (!current || current.activeEntityID !== entityID) return;
    update(characterID, pilot => ({ ...pilot, activeEntityID: null, deaths: pilot.deaths + (destroyed ? 1 : 0) }));
  }
  return { acquire, release, get, list, update, flush };
}

let defaultStore: ReturnType<typeof createNpcPilotIdentityStore>;
export function getNpcPilotIdentityStore() {
  return defaultStore ||= createNpcPilotIdentityStore(require("../../gameStore"));
}
