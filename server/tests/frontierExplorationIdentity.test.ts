"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  normalizeLoopbackAddress,
  resolveExplorationIdentity,
  resolveExplorationNoticeIdentity,
  isExplorationNotice,
  shouldDeliverExplorationNotice,
} = require("../src/_secondary/express/gatewayServices/explorationIdentity");

function session(userID = 42, characterID = 123, extra: Record<string, any> = {}) {
  return { userid: userID, characterID, solarsystemid2: 30000001, socket: { remoteAddress: "127.0.0.1", destroyed: false }, ...extra };
}

function envelope(characterID = 0, activeCharacterID = 0) {
  return { authoritative_context: {
    identity: { character: { sequential: characterID }, user: { sequential: 999 } },
    active_character: { sequential: activeCharacterID },
  } };
}

const LOCAL = { remoteAddress: "127.0.0.1" };

test("only local socket addresses normalize, including Windows/Wine mapped IPv6", () => {
  for (const address of ["127.0.0.1", "::1", "0:0:0:0:0:0:0:1", "::ffff:127.0.0.1", "::ffff:7f00:1"]) {
    assert.equal(normalizeLoopbackAddress(address), "127.0.0.1");
  }
  assert.equal(normalizeLoopbackAddress("127.0.0.2"), "127.0.0.2");
  for (const address of ["localhost", "192.168.1.2", "::ffff:192.168.1.2", "2001:db8::1", "::1%lo", "fe80::1%eth0", "", undefined]) {
    assert.equal(normalizeLoopbackAddress(address), null);
  }
});

test("authenticated account can hydrate starters before selecting a character", () => {
  assert.deepEqual(resolveExplorationIdentity(envelope(), LOCAL, [session(42, 0)]), { userID: 42, characterID: null });
  // A selected character does not silently turn a user-scoped request into a
  // character request or trust the fabricated user field in the wire envelope.
  assert.deepEqual(resolveExplorationIdentity(envelope(), LOCAL, [session()]), { userID: 42, characterID: null });
});

test("character scope is checked against a live session belonging to the unique peer account", () => {
  const sessions = [session(), session(42, 456, { socket: { remoteAddress: "::ffff:127.0.0.1", destroyed: false } })];
  assert.deepEqual(resolveExplorationIdentity(envelope(123), { remoteAddress: "::1" }, sessions), { userID: 42, characterID: 123, currentSystemID: 30000001 });
  assert.deepEqual(resolveExplorationIdentity(envelope(0, 456), LOCAL, sessions), { userID: 42, characterID: 456, currentSystemID: 30000001 });
  assert.equal(resolveExplorationIdentity(envelope(999), LOCAL, sessions), null);
  assert.equal(resolveExplorationIdentity(envelope(123, 456), LOCAL, sessions), null);
  assert.equal(resolveExplorationIdentity(envelope(-1), LOCAL, sessions), null);
});

test("missing transport, remote peers, dead sessions and missing account authentication fail closed", () => {
  assert.equal(resolveExplorationIdentity(envelope(123), {}, [session()]), null);
  assert.equal(resolveExplorationIdentity(envelope(123), { remoteAddress: "192.168.1.2" }, [session()]), null);
  assert.equal(resolveExplorationIdentity(envelope(123), { remoteAddress: "127.0.0.2" }, [session()]), null);
  assert.equal(resolveExplorationIdentity(envelope(123), LOCAL, []), null);
  assert.equal(resolveExplorationIdentity(envelope(123), LOCAL, [session(0)]), null);
  assert.equal(resolveExplorationIdentity(envelope(123), LOCAL, [session(42, 123, { socket: { remoteAddress: "127.0.0.1", destroyed: true } })]), null);
  assert.equal(resolveExplorationIdentity(envelope(123), LOCAL, [session(42, 123, { _characterControlDisconnected: true })]), null);
});

test("two accounts sharing loopback are denied even when a claimed character identifies one", () => {
  const sessions = [session(), session(43, 456)];
  assert.equal(resolveExplorationIdentity(envelope(123), LOCAL, sessions), null);
  assert.equal(resolveExplorationIdentity(envelope(), LOCAL, sessions), null);
  assert.deepEqual(resolveExplorationIdentity(envelope(123), LOCAL, [session(), session(43, 456, { socket: { remoteAddress: "192.168.1.2", destroyed: false } })]), { userID: 42, characterID: 123, currentSystemID: 30000001 });
});

test("current location comes from the latest live session and authority disappears on disconnect", () => {
  const sessions = [session(42, 123, { lastActivity: 1 }), session(42, 123, { lastActivity: 2, _space: { systemID: 30000002 } })];
  assert.deepEqual(resolveExplorationIdentity(envelope(123), LOCAL, sessions), { userID: 42, characterID: 123, currentSystemID: 30000002 });
  sessions.forEach(value => { value.socket.destroyed = true; });
  assert.equal(resolveExplorationIdentity(envelope(123), LOCAL, sessions), null);
});

test("exploration notice delivery requires an exact authenticated user or character target", () => {
  const identity = { userID: 42, characterID: 123 };
  const notice = target_group => ({ target_group, payload: { type_url: "type.googleapis.com/eve_public.exploration.api.UniverseRevealNotice" } });
  assert.equal(isExplorationNotice(notice({ character: 123 })), true);
  assert.equal(isExplorationNotice({ payload: { type_url: "eve_public.exploration.api.notices_pb2.UniverseRevealNotice" } }), true);
  assert.equal(isExplorationNotice({ payload: { type_url: "eve_public.chat.local.EnterNotice" } }), false);
  assert.equal(shouldDeliverExplorationNotice(identity, notice({ character: 123 })), true);
  assert.equal(shouldDeliverExplorationNotice(identity, notice({ user: 42 })), true);
  for (const target of [{}, null, { character: 456 }, { user: 43 }, { character: 123, user: 42 }, { solar_system: 30000001 }, { application_instance_uuid: Buffer.alloc(16) }]) {
    assert.equal(shouldDeliverExplorationNotice(identity, notice(target)), false);
  }
  assert.equal(shouldDeliverExplorationNotice(null, notice({ character: 123 })), false);
  assert.equal(shouldDeliverExplorationNotice({ userID: 42, characterID: null }, notice({ character: 123 })), false);
  assert.equal(shouldDeliverExplorationNotice({ userID: 42, characterID: null }, notice({ user: 42 })), true);
});

test("notice consumers remain bound to their authenticated account across account switches", () => {
  const consumer = { explorationTransport: LOCAL, explorationRequestEnvelope: envelope(), explorationUserID: 42 };
  assert.deepEqual(resolveExplorationNoticeIdentity(consumer, [session()]), { userID: 42, characterID: null });
  assert.equal(resolveExplorationNoticeIdentity(consumer, []), null);
  assert.equal(resolveExplorationNoticeIdentity(consumer, [session(43, 456)]), null);
  assert.equal(resolveExplorationNoticeIdentity(consumer, [session(), session(43, 456)]), null);
  assert.equal(resolveExplorationNoticeIdentity({ ...consumer, explorationUserID: null }, [session()]), null);
  assert.equal(resolveExplorationNoticeIdentity({ ...consumer, explorationRequestEnvelope: null }, [session()]), null);
  assert.equal(resolveExplorationNoticeIdentity({ ...consumer, explorationRequestEnvelope: envelope(456) }, [session()]), null);
});
