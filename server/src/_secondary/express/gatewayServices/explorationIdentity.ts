"use strict";

const net = require("node:net");

function positiveID(value) {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function normalizeLoopbackAddress(value) {
  if (typeof value !== "string") return null;
  const address = value.trim().toLowerCase();
  if (address.includes("%")) return null;
  if (net.isIP(address) === 4) return address.startsWith("127.") ? address : null;
  if (net.isIP(address) !== 6) return null;
  const canonical = new URL(`http://[${address}]/`).hostname.slice(1, -1);
  if (canonical === "::1") return "127.0.0.1";
  const mapped = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(canonical);
  if (!mapped) return null;
  const high = parseInt(mapped[1], 16);
  const low = parseInt(mapped[2], 16);
  const ipv4 = `${high >>> 8}.${high & 255}.${low >>> 8}.${low & 255}`;
  return ipv4.startsWith("127.") ? ipv4 : null;
}

function sessionCharacterID(session) {
  return positiveID(session.characterID || session.charID || session.charid || session.characterId);
}

function requestedCharacterID(envelope) {
  const authority = envelope && envelope.authoritative_context || {};
  const claimed = [authority.identity && authority.identity.character, authority.active_character]
    .filter(Boolean)
    .map(identifier => Number(identifier.sequential || 0));
  if (claimed.some(id => !Number.isSafeInteger(id) || id < 0)) return { valid: false, id: null };
  const nonzero = [...new Set(claimed.filter(id => id > 0))];
  return { valid: nonzero.length <= 1, id: nonzero[0] || null };
}

/**
 * Temporary identity bridge for the local Frontier adapter. Only pass sessions
 * from the server's live TCP registry (registered after successful handshake),
 * and remoteAddress from the HTTP/2 socket, never headers or payload fields.
 * This is a single-account loopback trust boundary, not bearer authentication:
 * any local process shares that peer identity. It must not be exposed through
 * a reverse proxy or widened to remote peers; those need verified credentials.
 */
function resolveExplorationIdentity(envelope, transportContext, sessions) {
  const peer = normalizeLoopbackAddress(transportContext && transportContext.remoteAddress);
  if (!peer || !Array.isArray(sessions)) return null;
  const candidates = sessions.filter(session => (
    session && session.socket && !session.socket.destroyed &&
    session._characterControlDisconnected !== true && positiveID(session.userid) &&
    normalizeLoopbackAddress(session.socket.remoteAddress) === peer
  ));
  const accounts = [...new Set(candidates.map(session => positiveID(session.userid)))];
  if (accounts.length !== 1) return null;
  const userID = accounts[0];
  const claim = requestedCharacterID(envelope);
  if (!claim.valid) return null;
  if (!claim.id) return { userID, characterID: null };
  const matches = candidates.filter(session => sessionCharacterID(session) === claim.id);
  if (!matches.length) return null;
  matches.sort((left, right) => (
    Number(right.lastActivity || 0) - Number(left.lastActivity || 0) ||
    Number(right.connectTime || 0) - Number(left.connectTime || 0) ||
    Number(right.clientID || right.clientId || 0) - Number(left.clientID || left.clientId || 0)
  ));
  const session = matches[0];
  const currentSystemID = positiveID(
    session._space && session._space.systemID || session.solarsystemid2 ||
    session.solarsystemid || session.solarSystemID,
  );
  return { userID, characterID: claim.id, ...(currentSystemID ? { currentSystemID } : {}) };
}

function isExplorationNotice(noticeEnvelope) {
  const typeUrl = String(noticeEnvelope && noticeEnvelope.payload && noticeEnvelope.payload.type_url || "");
  const typeName = typeUrl.slice(typeUrl.lastIndexOf("/") + 1).replace(".notices_pb2.", ".");
  return typeName.startsWith("eve_public.exploration.");
}

function resolveExplorationNoticeIdentity(consumer, sessions) {
  if (!consumer || !consumer.explorationRequestEnvelope || !consumer.explorationUserID) return null;
  const identity = resolveExplorationIdentity(
    consumer.explorationRequestEnvelope, consumer.explorationTransport, sessions,
  );
  // Recheck liveness/account ambiguity on every delivery. A stale consumer must
  // never acquire the next account that logs in from the same local address.
  return identity && identity.userID === consumer.explorationUserID ? identity : null;
}

function shouldDeliverExplorationNotice(identity, noticeEnvelope) {
  if (!identity || !positiveID(identity.userID)) return false;
  const target = noticeEnvelope && noticeEnvelope.target_group;
  if (!target) return false;
  const characterID = positiveID(target.character);
  const userID = positiveID(target.user);
  if (characterID && userID) return false;
  if (characterID) return characterID === positiveID(identity.characterID);
  if (userID) return userID === positiveID(identity.userID);
  // Exploration is private knowledge. Unscoped, application, solar-system,
  // corporation and alliance broadcast targets must never disclose it.
  return false;
}

module.exports = {
  normalizeLoopbackAddress,
  resolveExplorationIdentity,
  resolveExplorationNoticeIdentity,
  isExplorationNotice,
  shouldDeliverExplorationNotice,
};
