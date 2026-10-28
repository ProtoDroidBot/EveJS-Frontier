"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const {
  GET_KNOWN_UNIVERSE_REQUEST,
  GET_KNOWN_UNIVERSE_RESPONSE,
  GET_SYSTEM_DETAIL_REQUEST,
  GET_SYSTEM_DETAIL_RESPONSE,
  UNIVERSE_REVEAL_NOTICE,
  buildExplorationProtoRoot,
  getExplorationProtoTypes,
} = require("../src/_secondary/express/gatewayServices/explorationProto");
const { createExplorationGatewayService } = require(
  "../src/_secondary/express/gatewayServices/explorationGatewayService",
);

const types = getExplorationProtoTypes();
const BUNDLE_VERSION = { major: 3502403, minor: 3640684, patch: 1, build_tags: ["legacy-world"] };
const UINT64_MAX = "18446744073709551615";

function responsePayload(extra: Record<string, any> = {}) {
  return { bundle_version: BUNDLE_VERSION, payload: Buffer.from([4, 0, 0, 0]), ...extra };
}

function envelope(type, payload: Record<string, any> = {}) {
  return {
    payload: { value: Buffer.from(type.encode(type.fromObject(payload)).finish()) },
    // A caller can fabricate this; tests must never derive authority from it.
    authoritative_context: { identity: { character: { sequential: 999999 } } },
  };
}

test("exploration descriptors exactly match the recorded target messages", () => {
  const evidence = JSON.parse(fs.readFileSync(path.resolve(
    __dirname, "../../docs/FRONTIER_BUILD_3640684_GALAXY_EVIDENCE.json",
  ), "utf8"));
  const root = buildExplorationProtoRoot();
  const files = evidence.protobuf_descriptors || evidence.descriptors;
  assert.ok(Array.isArray(files), "target descriptor evidence is present");
  let checked = 0;
  for (const entry of files) {
    const file = entry.descriptor;
    if (!["eve_public.exploration.api", "eve_public.exploration", "eve_public.solarsystem"].includes(file.package)) continue;
    for (const message of file.message_type || []) {
      const reflected = root.lookupType(`${file.package}.${message.name}`);
      assert.equal(reflected.fieldsArray.length, (message.field || []).length);
      for (const field of message.field || []) {
        const actual = reflected.fieldsById[field.number];
        assert.ok(actual, `${message.name}.${field.name}`);
        assert.equal(actual.name, field.name);
        assert.equal(actual.repeated, field.label === "LABEL_REPEATED");
        assert.equal(actual.resolvedType ? "TYPE_MESSAGE" : `TYPE_${actual.type.toUpperCase()}`, field.type);
        assert.equal(actual.resolvedType?.fullName, field.type_name);
        checked++;
      }
    }
  }
  assert.equal(checked, 20);
});

test("exploration dependency widths and uint64 values survive encoding", () => {
  const root = types.root;
  assert.deepEqual(root.lookupType("eve_public.Page").fieldsArray.map(f => [f.name, f.id, f.type]), [
    ["size", 1, "uint32"], ["token", 2, "string"],
  ]);
  assert.deepEqual(root.lookupType("eve_public.NextPage").fieldsArray.map(f => [f.name, f.id, f.type]), [["token", 1, "string"]]);
  assert.deepEqual(root.lookupType("eve_public.semanticversion.Specification").fieldsArray.map(f => [f.name, f.id, f.type, f.repeated]), [
    ["major", 1, "uint32", false], ["minor", 2, "uint32", false], ["patch", 3, "uint32", false],
    ["prerelease_tags", 4, "string", true], ["build_tags", 5, "string", true],
  ]);
  const message = types.getKnownUniverseResponse.fromObject(responsePayload({
    total_systems: UINT64_MAX,
    knowledge: { revision: UINT64_MAX, complete: true, visited_system_ids: [UINT64_MAX], thermal: { detected_system_ids: [UINT64_MAX] } },
  }));
  const decoded = types.getKnownUniverseResponse.decode(types.getKnownUniverseResponse.encode(message).finish());
  assert.equal(decoded.total_systems.toString(), UINT64_MAX);
  assert.equal(decoded.knowledge.revision.toString(), UINT64_MAX);
  assert.equal(decoded.knowledge.visited_system_ids[0].toString(), UINT64_MAX);
  assert.equal(decoded.knowledge.thermal.detected_system_ids[0].toString(), UINT64_MAX);
});

test("gateway import, construction and unsupported requests do not load world state", () => {
  const service = createExplorationGatewayService();
  assert.equal(service.handleRequest("unrelated", {}), null);
  assert.equal(service.getEmptySuccessResponseType(GET_KNOWN_UNIVERSE_REQUEST), null);
  assert.equal(service.getEmptySuccessResponseType(GET_SYSTEM_DETAIL_REQUEST), null);
  assert.equal(Object.keys(require.cache).some(file => /[/\\]explorationRuntime\.[jt]s$/.test(file)), false);
  assert.equal(Object.keys(require.cache).some(file => /[/\\]gameStore[/\\]/.test(file)), false);
});

test("user-scoped starter hydration forwards trusted identity, paging and response metadata", async () => {
  let received;
  const runtime = {
    async getKnownUniverse(identity, page) {
      received = { identity, page };
      return responsePayload({ total_systems: "3", next_page: { token: "versioned-cursor" }, knowledge: { revision: "7", complete: false } });
    },
  };
  const service = createExplorationGatewayService({
    explorationRuntime: runtime,
    resolveExplorationIdentity: () => ({ userID: 42, characterID: null }),
  });
  const result = await service.handleRequest(GET_KNOWN_UNIVERSE_REQUEST, envelope(types.getKnownUniverseRequest, { page: { size: 2, token: "previous-cursor" } }));
  assert.equal(result.statusCode, 200);
  assert.equal(result.responseTypeName, GET_KNOWN_UNIVERSE_RESPONSE);
  assert.deepEqual(received, { identity: { userID: 42, characterID: null }, page: { size: 2, token: "previous-cursor" } });
  const decoded = types.getKnownUniverseResponse.decode(result.responsePayloadBuffer);
  assert.equal(decoded.total_systems.toString(), "3");
  assert.equal(decoded.next_page.token, "versioned-cursor");
  assert.equal(decoded.knowledge.revision.toString(), "7");
  assert.equal(decoded.bundle_version.major, BUNDLE_VERSION.major);
});

test("client-supplied identity cannot authorize universe or detail requests", async () => {
  let calls = 0;
  const service = createExplorationGatewayService({ explorationRuntime: { getKnownUniverse() { calls++; } } });
  for (const [name, type, payload] of [
    [GET_KNOWN_UNIVERSE_REQUEST, types.getKnownUniverseRequest, {}],
    [GET_SYSTEM_DETAIL_REQUEST, types.getSystemDetailRequest, { solar_system: { sequential: 30000001 } }],
  ]) {
    const result = await service.handleRequest(name, envelope(type, payload));
    assert.equal(result.statusCode, 401);
    assert.equal(result.responsePayloadBuffer.length, 0);
  }
  assert.equal(calls, 0);
});

test("detail requires a selected character and preserves uint64 IDs for runtime validation", async () => {
  let received;
  const runtime = { getSystemDetail(identity, id) { received = { identity, id }; return responsePayload(); } };
  const userService = createExplorationGatewayService({}, { runtime, resolveIdentity: () => ({ userID: 42 }) });
  const request = envelope(types.getSystemDetailRequest, { solar_system: { sequential: UINT64_MAX } });
  assert.equal((await userService.handleRequest(GET_SYSTEM_DETAIL_REQUEST, request)).statusCode, 403);
  const service = createExplorationGatewayService({}, { runtime, resolveIdentity: () => ({ userID: 42, characterID: 123, currentSystemID: 30000001 }) });
  const result = await service.handleRequest(GET_SYSTEM_DETAIL_REQUEST, request);
  assert.equal(result.statusCode, 200);
  assert.equal(result.responseTypeName, GET_SYSTEM_DETAIL_RESPONSE);
  assert.deepEqual(received, { identity: { userID: 42, characterID: 123, currentSystemID: 30000001 }, id: UINT64_MAX });
  const missing = await service.handleRequest(GET_SYSTEM_DETAIL_REQUEST, envelope(types.getSystemDetailRequest));
  assert.equal(missing.statusCode, 400);
});

test("malformed request bytes and wrong wire types return 400 without runtime access", async () => {
  let calls = 0;
  const service = createExplorationGatewayService({}, {
    resolveIdentity: () => ({ userID: 42, characterID: 123 }),
    runtime: { getKnownUniverse() { calls++; return responsePayload(); } },
  });
  for (const value of [
    Buffer.from([0x0a, 0x08, 0x01]), // truncated nested Page
    Buffer.from([0x08, 0x01]), // Page must be length-delimited
    Buffer.from([0x0a, 0x02, 0x0a, 0x00]), // size must be a varint
    Buffer.from([0x0a, 0x02, 0x10, 0x01]), // token must be a string
    Buffer.from([0x0a, 0x03, 0x12, 0x01, 0xff]), // token must be valid UTF-8
    Buffer.from([0x0a, 0x06, 0x08, 0xff, 0xff, 0xff, 0xff, 0x7f]), // uint32 overflow
    Buffer.from([0x00]), // prohibited field zero
    "", null, [0x00],
  ]) {
    const result = await service.handleRequest(GET_KNOWN_UNIVERSE_REQUEST, { payload: { value } });
    assert.equal(result.statusCode, 400, `malformed payload ${String(value)}`);
    assert.equal(result.responsePayloadBuffer.length, 0);
  }
  assert.equal(calls, 0);
});

test("runtime refusals, stale cursor errors and unexpected failures never become empty successes", async () => {
  for (const [error, expectedStatus, expectedMessage] of [
    [Object.assign(new Error("SYSTEM_NOT_REVEALED"), { statusCode: 403 }), 403, "SYSTEM_NOT_REVEALED"],
    [Object.assign(new Error("STALE_UNIVERSE_CURSOR"), { statusCode: 409 }), 409, "STALE_UNIVERSE_CURSOR"],
    [new Error("private filesystem detail"), 500, "EXPLORATION_INTERNAL_ERROR"],
  ]) {
    const service = createExplorationGatewayService({}, {
      runtime: { async getKnownUniverse() { throw error; } },
      resolveIdentity: () => ({ userID: 42, characterID: 123 }),
    });
    const result = await service.handleRequest(GET_KNOWN_UNIVERSE_REQUEST, envelope(types.getKnownUniverseRequest));
    assert.equal(result.statusCode, expectedStatus);
    assert.equal(result.statusMessage, expectedMessage);
    assert.equal(result.responsePayloadBuffer.length, 0);
  }
  const service = createExplorationGatewayService({}, {
    runtime: { getKnownUniverse() { return {}; } },
    resolveIdentity: () => ({ userID: 42 }),
  });
  assert.equal((await service.handleRequest(GET_KNOWN_UNIVERSE_REQUEST, envelope(types.getKnownUniverseRequest))).statusCode, 500);
});

test("reveal subscription is lazy, character-scoped, and removable", async () => {
  let listener;
  let subscriptions = 0;
  let disposed = 0;
  const notices = [];
  const runtime = {
    getKnownUniverse() { return responsePayload(); },
    subscribe(callback) { subscriptions++; listener = callback; return () => { disposed++; }; },
  };
  const service = createExplorationGatewayService({
    publishGatewayNotice: (...args) => { notices.push(args); return true; },
  }, { runtime, resolveIdentity: () => ({ userID: 42, characterID: 123 }) });
  assert.equal(subscriptions, 0);
  for (let i = 0; i < 2; i++) await service.handleRequest(GET_KNOWN_UNIVERSE_REQUEST, envelope(types.getKnownUniverseRequest));
  assert.equal(subscriptions, 1);
  listener({ identity: { userID: 42, characterID: 123 }, payload: responsePayload({ knowledge: { revision: "2", visited_system_ids: [30000001] } }) });
  assert.equal(notices.length, 1);
  assert.equal(notices[0][0], UNIVERSE_REVEAL_NOTICE);
  assert.deepEqual(notices[0][2], { character: 123 });
  assert.equal(types.universeRevealNotice.decode(notices[0][1]).knowledge.revision.toString(), "2");
  listener({ identity: { userID: 42 }, payload: responsePayload() });
  assert.deepEqual(notices[1][2], { user: 42 });
  assert.equal(listener({ identity: {}, payload: responsePayload() }), false);
  service.dispose();
  assert.equal(disposed, 1);
});
