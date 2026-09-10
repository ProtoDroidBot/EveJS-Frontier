/**
 * EVE Packet Type Constants
 *
 * Ported from packet_types.h in eve-common.
 * Defines the MACHONETMSG_TYPE enum used to route packets.
 */

// ─── Macho Net Message Types ────────────────────────────────────────────────
const MACHONETMSG_TYPE: Record<string, any> = {
  AUTHENTICATION_REQ: 0,
  AUTHENTICATION_RSP: 1,
  IDENTIFICATION_REQ: 2,
  IDENTIFICATION_RSP: 3,
  __Fake_Invalid_Type: 4,
  CALL_REQ: 6,
  CALL_RSP: 7,
  TRANSPORTCLOSED: 8,
  RESOLVE_REQ: 10,
  RESOLVE_RSP: 11,
  NOTIFICATION: 12,
  ERRORRESPONSE: 15,
  SESSIONCHANGENOTIFICATION: 16,
  SESSIONINITIALSTATENOTIFICATION: 18,
  PING_REQ: 20,
  PING_RSP: 21,
  MOVEMENTNOTIFICATION: 100,
};

const MACHONETMSG_TYPE_NAMES: Record<string, any> = {};
for (const [name, code] of Object.entries(MACHONETMSG_TYPE)) {
  MACHONETMSG_TYPE_NAMES[code] = name;
}

/** Get the human-readable name for a MACHONETMSG_TYPE code */
function getTypeName(code) {
  return MACHONETMSG_TYPE_NAMES[code] || `UNKNOWN(${code})`;
}

// ─── Macho Net Error Types ──────────────────────────────────────────────────
const MACHONETERR_TYPE: Record<string, any> = {
  UNMACHODESTINATION: 0,
  UNMACHOCHANNEL: 1,
  WRAPPEDEXCEPTION: 2,
};

// ─── Session Types ──────────────────────────────────────────────────────────
const SESSION_TYPE: Record<string, any> = {
  INVALID: 0,
  EXECUTIONCONTEXT: 1,
  SERVICE: 2,
  CREST: 3,
  ESP: 4,
  GAME: 5,
};

// ─── Service States ─────────────────────────────────────────────────────────
const SERVICE: Record<string, any> = {
  STOPPED: 1,
  START_PENDING: 2,
  STOP_PENDING: 3,
  RUNNING: 4,
  CONTINUE_PENDING: 5,
  PAUSE_PENDING: 6,
  PAUSED: 7,
};

const SERVICETYPE: Record<string, any> = {
  NORMAL: 1,
  BUILTIN: 2,
  EXPORT_CONSTANTS: 4,
};

module.exports = {
  MACHONETMSG_TYPE,
  MACHONETMSG_TYPE_NAMES,
  getTypeName,
  MACHONETERR_TYPE,
  SESSION_TYPE,
  SERVICE,
  SERVICETYPE,
};
