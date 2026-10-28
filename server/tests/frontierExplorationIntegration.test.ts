"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const Module = require("node:module");
const vm = require("node:vm");
const { EventEmitter, once } = require("node:events");
const test = require("node:test");
const { createExplorationRuntime, createFileKnowledgeStore } = require("../src/services/frontier/explorationRuntime");
const { createExplorationGatewayService } = require("../src/_secondary/express/gatewayServices/explorationGatewayService");
const {
  getExplorationProtoTypes, GET_KNOWN_UNIVERSE_REQUEST, GET_SYSTEM_DETAIL_REQUEST, UNIVERSE_REVEAL_NOTICE,
} = require("../src/_secondary/express/gatewayServices/explorationProto");

// Independent FlatBuffer reader. Slots are taken from the target's generated
// accessors, not from the encoder's schema definitions.
class UniverseTable {
  constructor(readonly bytes: Buffer, readonly at = bytes.readUInt32LE(0)) {}
  field(slot: number) {
    const table = this.at - this.bytes.readInt32LE(this.at);
    if (4 + slot * 2 >= this.bytes.readUInt16LE(table)) return 0;
    const relative = this.bytes.readUInt16LE(table + 4 + slot * 2);
    return relative ? this.at + relative : 0;
  }
  target(slot: number) { const at = this.field(slot); return at ? at + this.bytes.readUInt32LE(at) : 0; }
  u16(slot: number) { const at = this.field(slot); return at ? this.bytes.readUInt16LE(at) : 0; }
  u8(slot: number) { const at = this.field(slot); return at ? this.bytes[at] : 0; }
  u64(slot: number) { const at = this.field(slot); return at ? this.bytes.readBigUInt64LE(at) : 0n; }
  text(slot: number) { const at = this.target(slot); return at ? this.bytes.toString("utf8", at + 4, at + 4 + this.bytes.readUInt32LE(at)) : null; }
  vec3(slot: number) { const at = this.field(slot); return at ? [0, 8, 16].map(offset => this.bytes.readDoubleLE(at + offset)) : null; }
  child(slot: number) { const at = this.target(slot); return at ? new UniverseTable(this.bytes, at) : null; }
  tables(slot: number) {
    const at = this.target(slot);
    return at ? Array.from({ length: this.bytes.readUInt32LE(at) }, (_, i) => {
      const pointer = at + 4 + i * 4;
      return new UniverseTable(this.bytes, pointer + this.bytes.readUInt32LE(pointer));
    }) : [];
  }
}

const types = getExplorationProtoTypes();
const A = 30000001, B = 30000002, C = 30000003;
const CENTER = [9.4607304725808e18, -7.123456789012345e17, 0.125];
const LOCAL_CENTER = [123456789, -987654321, 0.75];
const VERSION = { major: 1, minor: 0, patch: 0, build_tags: ["legacy-integration"] };

function fixtureWorld() {
  const systems = new Map([A, B, C].map(id => [id, {
    id, regionId: 10000001, constellationId: 20000001, center: CENTER, name: `Legacy ${id}`,
    sun: { id: id + 10000000, typeId: 45041, position: LOCAL_CENTER, radiusM: 1000000 },
  }]));
  return {
    systems, starterSystemIds: [A], revision: "legacy-integration", version: VERSION,
    makeDelta(ids, detail, sequence) {
      return {
        bundleVersion: "1.0.0+legacy-integration", complete: false, sequence,
        regions: [{ id: 10000001, center: CENTER, name: "Legacy region" }],
        constellations: [{ id: 20000001, regionId: 10000001, center: CENTER, name: "Legacy constellation" }],
        systems: ids.map(id => {
          const record = systems.get(id);
          return detail ? { ...record, revealLevel: 1, celestialScopeFull: true }
            : { id: record.id, regionId: record.regionId, constellationId: record.constellationId, center: record.center, name: record.name, revealLevel: 0 };
        }),
      };
    },
  };
}

function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "exploration-integration-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const world = fixtureWorld();
  const options = { world, stateStore: createFileKnowledgeStore(directory), cursorSecret: "integration-test-only" };
  return { directory, world, options, runtime: createExplorationRuntime(options) };
}

function payloadRequest(type, value: Record<string, any> = {}) {
  return { payload: { value: Buffer.from(type.encode(type.fromObject(value)).finish()) } };
}

function decodeResult(response, detail = false) {
  assert.equal(response.statusCode, 200, response.statusMessage);
  const payload = (detail ? types.getSystemDetailResponse : types.getKnownUniverseResponse).decode(response.responsePayloadBuffer);
  const delta = new UniverseTable(Buffer.from(payload.payload));
  assert.equal(delta.u16(0), 14);
  assert.equal(delta.text(1), "1.0.0+legacy-integration");
  assert.equal(payload.bundle_version.major, VERSION.major);
  return { payload, delta };
}

test("real gateway/runtime paginates schema14 world and keeps visited detail on rehydration", async t => {
  const { runtime, directory, options } = fixture(t);
  const identity = { userID: 42, characterID: 123, currentSystemID: A };
  const notices = [];
  const service = createExplorationGatewayService({
    explorationRuntime: runtime, resolveExplorationIdentity: () => identity,
    publishGatewayNotice: (...notice) => notices.push(notice),
  });
  t.after(() => service.dispose());
  const ids = [];
  let token = "";
  let pages = 0;
  const clientRows = new Map();
  // Build 3640684 _ingest_payload only upgrades Charted -> Visited; it ignores
  // a later Visited row if the stored row is already Visited (lines1271-1284).
  function ingest(delta) {
    for (const row of delta.tables(6)) {
      const key = row.u64(0).toString();
      const stored = clientRows.get(key);
      if (!stored || (row.u8(8) === 1 && stored.u8(8) !== 1)) clientRows.set(key, row);
    }
  }
  do {
    const { payload, delta } = decodeResult(await service.handleRequest(GET_KNOWN_UNIVERSE_REQUEST, payloadRequest(types.getKnownUniverseRequest, { page: { size: 2, token } })));
    assert.equal(payload.total_systems.toString(), "3");
    assert.equal(delta.u64(3), 1n);
    assert.equal(delta.u8(2), 0);
    assert.deepEqual(delta.tables(4)[0].vec3(1), CENTER);
    ids.push(...delta.tables(6).map(row => Number(row.u64(0))));
    ingest(delta);
    token = payload.next_page.token;
    pages++;
  } while (token && pages < 5);
  assert.deepEqual(ids, [A, B, C]);
  assert.equal(pages, 2);
  assert.equal(clientRows.get(String(A)).u8(8), 1);
  assert.ok(clientRows.get(String(A)).child(9), "Visited hydration must include content: the client will ignore a later Visited detail row");
  assert.deepEqual(clientRows.get(String(A)).vec3(4), CENTER);
  assert.deepEqual(clientRows.get(String(A)).child(9).vec3(6), LOCAL_CENTER);
  assert.equal(clientRows.get(String(B)).child(9), null);
  const detail = decodeResult(await service.handleRequest(GET_SYSTEM_DETAIL_REQUEST, payloadRequest(types.getSystemDetailRequest, { solar_system: { sequential: A } })), true);
  ingest(detail.delta);
  assert.deepEqual(clientRows.get(String(A)).child(9).vec3(6), LOCAL_CENTER);
  assert.equal(notices.length, 1);
  const notice = types.universeRevealNotice.decode(notices[0][1]);
  assert.equal(notices[0][0], UNIVERSE_REVEAL_NOTICE);
  assert.deepEqual(notices[0][2], { character: 123 });
  assert.deepEqual(notice.knowledge.visited_system_ids.map(String), [String(A)]);
  assert.equal(new UniverseTable(Buffer.from(notice.payload)).tables(6)[0].child(9).u64(0), BigInt(A + 10000000));
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(directory, "42-123.json"), "utf8")).visited, [A]);

  const restarted = createExplorationGatewayService({}, {
    runtime: createExplorationRuntime(options), resolveIdentity: () => ({ userID: 42, characterID: 123 }),
  });
  t.after(() => restarted.dispose());
  const restored = decodeResult(await restarted.handleRequest(GET_KNOWN_UNIVERSE_REQUEST, payloadRequest(types.getKnownUniverseRequest)));
  assert.equal(restored.payload.knowledge.revision.toString(), "1");
  assert.ok(restored.delta.tables(6)[0].child(9), "restart must preserve the full Visited record");
});

test("rejected gateway pages/details leave durable knowledge unchanged and return explicit errors", async t => {
  const { runtime, directory } = fixture(t);
  const identity = { userID: 42, characterID: 123, currentSystemID: A };
  let notices = 0;
  const service = createExplorationGatewayService({
    explorationRuntime: runtime, resolveExplorationIdentity: () => identity,
    publishGatewayNotice: () => { notices++; },
  });
  t.after(() => service.dispose());
  for (const [request, body, status] of [
    [GET_KNOWN_UNIVERSE_REQUEST, payloadRequest(types.getKnownUniverseRequest, { page: { size: 513 } }), 400],
    [GET_KNOWN_UNIVERSE_REQUEST, payloadRequest(types.getKnownUniverseRequest, { page: { token: "invalid" } }), 400],
    [GET_SYSTEM_DETAIL_REQUEST, payloadRequest(types.getSystemDetailRequest, { solar_system: { sequential: B } }), 403],
  ]) {
    const response = await service.handleRequest(request, body);
    assert.equal(response.statusCode, status);
    assert.equal(response.responsePayloadBuffer.length, 0);
  }
  assert.deepEqual(fs.readdirSync(directory), []);
  assert.equal(notices, 0);
  const initial = decodeResult(await service.handleRequest(GET_KNOWN_UNIVERSE_REQUEST, payloadRequest(types.getKnownUniverseRequest, { page: { size: 1 } })));
  runtime.revealSystem(identity, B);
  const stale = await service.handleRequest(GET_KNOWN_UNIVERSE_REQUEST, payloadRequest(types.getKnownUniverseRequest, { page: { token: initial.payload.next_page.token } }));
  assert.equal(stale.statusCode, 400);
  assert.equal(stale.responsePayloadBuffer.length, 0);
  assert.equal(notices, 2);
});

test("integrity-checked legacy world factory feeds the real gateway without coordinate or detail loss", async t => {
  const { createExplorationWorld, calculateExplorationWorldRevision } = require("../src/services/frontier/explorationWorld");
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "exploration-world-integration-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const xyz = values => ({ x: values[0], y: values[1], z: values[2] });
  const raw: Record<string, any> = {
    format: "evejs-frontier-exploration-world-v1", targetBuild: 3640684,
    source: { build: 3502403, label: "3502403-MOD4-STUFF1", kind: "legacy-client-geography", scope: "unit-test-fixture" },
    contentRevisionAlgorithm: "sha256-typed-f64-v1",
    regions: [{ id: 10000001, center: xyz(CENTER), name: "Legacy region" }],
    constellations: [{ id: 20000001, regionId: 10000001, center: xyz(CENTER), name: "Legacy constellation" }],
    systems: [A, B].map(id => ({
      id, regionId: 10000001, constellationId: 20000001, center: xyz(CENTER), name: `Legacy ${id}`,
      neighbours: [id === A ? B : A],
      sun: { id: id + 10000000, typeId: 45041, position: xyz(LOCAL_CENTER), radiusM: 1000000 },
    })),
    starterSystemIds: [A],
  };
  raw.contentRevision = calculateExplorationWorldRevision(raw);
  const world = createExplorationWorld(raw);
  const options = { world, stateStore: createFileKnowledgeStore(directory), cursorSecret: "world-factory-test" };
  const runtime = createExplorationRuntime(options);
  let identity: any = { userID: 42, characterID: null };
  const notices = [];
  const service = createExplorationGatewayService({
    explorationRuntime: runtime, resolveExplorationIdentity: () => identity,
    publishGatewayNotice: (...notice) => notices.push(notice),
  });
  t.after(() => service.dispose());
  const starter = await service.handleRequest(GET_KNOWN_UNIVERSE_REQUEST, payloadRequest(types.getKnownUniverseRequest));
  assert.equal(starter.statusCode, 200);
  const starterPayload = types.getKnownUniverseResponse.decode(starter.responsePayloadBuffer);
  const starterDelta = new UniverseTable(Buffer.from(starterPayload.payload));
  assert.equal(starterDelta.text(1), world.versionString);
  assert.deepEqual(starterPayload.bundle_version.build_tags, world.version.build_tags);
  assert.equal(starterDelta.tables(6).length, 1);
  assert.equal(starterDelta.tables(6)[0].u8(8), 0);
  assert.equal(starterDelta.tables(6)[0].child(9), null);
  assert.deepEqual(starterDelta.tables(6)[0].vec3(4), CENTER);
  assert.deepEqual(fs.readdirSync(directory), []);

  identity = { userID: 42, characterID: 123, currentSystemID: A };
  const known = await service.handleRequest(GET_KNOWN_UNIVERSE_REQUEST, payloadRequest(types.getKnownUniverseRequest));
  assert.equal(known.statusCode, 200);
  const knownDelta = new UniverseTable(Buffer.from(types.getKnownUniverseResponse.decode(known.responsePayloadBuffer).payload));
  const [visited, charted] = knownDelta.tables(6);
  assert.equal(visited.u8(8), 1);
  assert.deepEqual(visited.child(9).vec3(6), LOCAL_CENTER);
  assert.equal(visited.u8(29), 0, "local extraction must not claim full target scope");
  assert.equal(charted.u8(8), 0);
  assert.equal(charted.child(9), null);
  runtime.revealSystem(identity, B);
  assert.equal(notices.length, 2);
  const reveal = types.universeRevealNotice.decode(notices[1][1]);
  assert.equal(new UniverseTable(Buffer.from(reveal.payload)).tables(6)[0].child(9).u64(0), BigInt(B + 10000000));

  const restarted = createExplorationGatewayService({}, {
    runtime: createExplorationRuntime(options), resolveIdentity: () => ({ userID: 42, characterID: 123 }),
  });
  t.after(() => restarted.dispose());
  const restored = await restarted.handleRequest(GET_KNOWN_UNIVERSE_REQUEST, payloadRequest(types.getKnownUniverseRequest));
  assert.equal(restored.statusCode, 200);
  const restoredPayload = types.getKnownUniverseResponse.decode(restored.responsePayloadBuffer);
  assert.equal(restoredPayload.knowledge.revision.toString(), "2");
  assert.ok(new UniverseTable(Buffer.from(restoredPayload.payload)).tables(6).every(row => row.u8(8) === 1 && row.child(9)));
});

// Evaluate the actual gateway module with unrelated simulation services stubbed.
// Its protobuf envelopes, stream handlers, identity bridge, exploration service,
// runtime and encoder are real. No SQLite/store initialization or socket occurs.
function isolatedPublicGateway(runtime, sessions, eventRouter = null) {
  const root = path.resolve(__dirname, "../src");
  const cache = new Map();
  const registry = { getSessions: () => sessions, findSessionByCharacterID: id => sessions.find(value => value.characterID === id) };
  function load(filename) {
    if (cache.has(filename)) return cache.get(filename).exports;
    const moduleObject = { exports: {} };
    cache.set(filename, moduleObject);
    const nativeRequire = Module.createRequire(filename);
    const localRequire = request => {
      const resolved = nativeRequire.resolve(request);
      if (resolved === path.join(root, "_secondary/express/gatewayServices/index.js")) return {
        createGatewayServiceRegistry(context) {
          const service = createExplorationGatewayService({ ...context, explorationRuntime: runtime });
          return { services: [service], handleRequest: (...args) => service.handleRequest(...args), getEmptySuccessResponseType: () => null };
        },
      };
      if (resolved === path.join(root, "services/chat/sessionRegistry.js")) return registry;
      if (resolved === path.join(root, "config/index.js")) return { clientBuild: 3640684 };
      if (resolved.endsWith("/frontierContractProfile.js")) return load(resolved);
      if (resolved.endsWith("/frontierContracts3640684.json")) return nativeRequire(request);
      if (resolved.endsWith("/progressionGatewayNotices.js")) return { installProgressionNoticePublisher() {} };
      if (resolved.endsWith("/frontierEconomyGatewayService.js") && eventRouter) return { routeGatewayEvent: eventRouter };
      if (resolved.includes("/utils/logger/")) return new Proxy({}, { get: () => () => {} });
      if (["config/index.js", "services/inventory/itemStore.js", "services/ship/shipCosmeticsState.js", "services/newEdenStore/storeState.js", "services/structure/structurePaintworkState.js", "services/structure/structureState.js", "space/runtime.js", "_secondary/chat/chatRuntime.js"].some(suffix => resolved === path.join(root, suffix))) return {};
      if (resolved.endsWith("/structurePaintworkGatewayService.js")) return load(resolved);
      if (resolved.startsWith(root) && !resolved.endsWith("/explorationIdentity.js") && !resolved.endsWith("/gatewayServiceHelpers.js")) {
        throw new Error(`Unexpected stateful gateway dependency in offline test: ${resolved}`);
      }
      return nativeRequire(request);
    };
    const wrapper = vm.runInThisContext(Module.wrap(fs.readFileSync(filename, "utf8")), { filename });
    wrapper(moduleObject.exports, localRequire, moduleObject, filename, path.dirname(filename));
    return moduleObject.exports;
  }
  return load(path.join(root, "_secondary/express/publicGatewayLocal.js"));
}

class OfflineStream extends EventEmitter {
  destroyed = false;
  closed = false;
  writes: Buffer[] = [];
  session: any;
  constructor(address) { super(); this.session = { socket: { remoteAddress: address } }; }
  respond() {}
  write(value) { this.writes.push(value); }
  end() { this.closed = true; this.emit("finished"); }
}

test("actual public gateway authenticates transport and keeps exploration notices private", async t => {
  const { runtime } = fixture(t);
  const sessions: any[] = [{ userid: 42, characterID: 123, solarsystemid2: A, socket: { remoteAddress: "127.0.0.1", destroyed: false } }];
  const gateway = isolatedPublicGateway(runtime, sessions);
  t.after(() => { gateway._testing.resetGatewayState(); gateway._testing.gatewayServiceRegistry.services[0].dispose(); });
  const { RequestEnvelope, ResponseEnvelope } = gateway._testing;
  const NoticeEnvelope = gateway._testing.PROTO_ROOT.lookupType("eve_public.Notice");
  function request(characterID = 123) {
    return Buffer.from(RequestEnvelope.encode(RequestEnvelope.create({
      authoritative_context: { identity: { character: { sequential: characterID } } },
      payload: { type_url: `type.googleapis.com/${GET_KNOWN_UNIVERSE_REQUEST}`, value: Buffer.alloc(0) },
    })).finish());
  }
  const denied = ResponseEnvelope.decode(await gateway.buildGatewayResponseForRequest(request()));
  assert.equal(denied.status_code, 401, "wire identity without transport must not authorize");
  const listeners = [new OfflineStream("::ffff:127.0.0.1"), new OfflineStream("127.0.0.1"), new OfflineStream("192.168.1.2"), new OfflineStream("127.0.0.1")];
  listeners.forEach(stream => gateway.handleGatewayStream(stream, { ":path": "/eve_public.gateway.Notices/Consume" }));
  listeners[0].emit("data", gateway.createGrpcFrame(request()));
  listeners[1].emit("data", gateway.createGrpcFrame(request(999)));
  listeners[2].emit("data", gateway.createGrpcFrame(request()));
  // listeners[3] never identifies itself.
  gateway.publishGatewayNotice("eve_public.achievement.CompletedNotice", Buffer.alloc(0), { user: 42 });
  assert.deepEqual(listeners.map(value => value.writes.length), [1, 0, 0, 0]);
  const userNotice = NoticeEnvelope.decode(listeners[0].writes.pop().subarray(5));
  assert.equal(userNotice.target_group.user, 42, "target sint32 user must round-trip without halving");
  sessions[0]._space = { systemID: B };
  gateway.publishGatewayNotice("test", Buffer.alloc(0), { solar_system: A });
  assert.equal(listeners[0].writes.length, 0, "stale session location must not route a system notice during travel");
  gateway.publishGatewayNotice("test", Buffer.alloc(0), { solar_system: B });
  assert.equal(listeners[0].writes.length, 1);
  listeners[0].writes.pop(); delete sessions[0]._space;
  assert.throws(() => gateway.publishGatewayNotice("test", Buffer.alloc(0), { bubble_instance_uuid: Buffer.alloc(16) }), /bounded target/);
  const stream = new OfflineStream("::1");
  gateway.handleGatewayStream(stream, { ":path": "/eve_public.gateway.Requests/Send" });
  const done = once(stream, "finished");
  stream.emit("data", gateway.createGrpcFrame(request()));
  stream.emit("end");
  await done;
  const success = ResponseEnvelope.decode(stream.writes[0].subarray(5));
  assert.equal(success.status_code, 200);
  const payload = types.getKnownUniverseResponse.decode(success.payload.value);
  assert.equal(new UniverseTable(Buffer.from(payload.payload)).tables(6).length, 3);
  assert.deepEqual(listeners.map(value => value.writes.length), [1, 0, 0, 0]);
  const reveal = NoticeEnvelope.decode(listeners[0].writes[0].subarray(5));
  assert.equal(reveal.target_group.character, 123);
  assert.equal(types.universeRevealNotice.decode(reveal.payload.value).knowledge.revision.toString(), "1");
  sessions.push({ userid: 43, characterID: 456, solarsystemid2: B, socket: { remoteAddress: "127.0.0.1", destroyed: false } });
  const ambiguous = ResponseEnvelope.decode(await gateway.buildGatewayResponseForRequest(request(), { remoteAddress: "127.0.0.1" }));
  assert.equal(ambiguous.status_code, 401);
  runtime.revealSystem({ userID: 42, characterID: 123 }, B);
  assert.deepEqual(listeners.map(value => value.writes.length), [1, 0, 0, 0]);
  sessions.splice(0, 1);
  runtime.getKnownUniverse({ userID: 43, characterID: 456, currentSystemID: B });
  assert.deepEqual(listeners.map(value => value.writes.length), [1, 0, 0, 0], "stale streams cannot receive the next account's knowledge");
});

test("actual event stream waits for processing and rejects forged, unsupported and invalid events without ACK", async t => {
  const { runtime } = fixture(t);
  const sessions = [{ userid: 42, characterID: 123, solarsystemid2: A, socket: { remoteAddress: "127.0.0.1", destroyed: false } }];
  let finishEvent;
  const calls = [];
  const gateway = isolatedPublicGateway(runtime, sessions, (envelope, identity) => {
    calls.push({ envelope, identity });
    if (envelope.payload.type_url.endsWith("/unknown")) return null;
    if (envelope.payload.type_url.endsWith("/denied")) return { success: false, statusCode: 403, errorMsg: "WALLET_ADDRESS_MISMATCH" };
    return new Promise(resolve => { finishEvent = () => resolve({ success: true }); });
  });
  t.after(() => { gateway._testing.resetGatewayState(); gateway._testing.gatewayServiceRegistry.services[0].dispose(); });
  const Event = gateway._testing.PROTO_ROOT.lookupType("eve_public.Event");
  const event = (character = 123, name = "wallet") => Buffer.from(Event.encode(Event.fromObject({
    authoritative_context: { identity: { character: { sequential: character } } },
    payload: { type_url: `type.googleapis.com/${name}`, value: Buffer.alloc(0) },
  })).finish());
  const send = (payload, address = "127.0.0.1") => {
    const stream = new OfflineStream(address);
    gateway.handleGatewayStream(stream, { ":path": "/eve_public.gateway.Events/Publish" });
    const done = once(stream, "finished");
    stream.emit("data", gateway.createGrpcFrame(payload)); stream.emit("end");
    return { stream, done };
  };
  const accepted = send(event());
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(accepted.stream.closed, false, "half-close must wait for authoritative processing");
  assert.equal(accepted.stream.writes.length, 0);
  assert.equal(calls[0].identity.session, sessions[0]);
  finishEvent(); await accepted.done;
  assert.equal(accepted.stream.writes.length, 1);
  assert.equal((accepted.stream as any)[Symbol.for("evejs.publicGateway.grpcTrailers")]["grpc-status"], "0");
  const rejectedCases: Array<[Buffer, string, string]> = [
    [event(999), "127.0.0.1", "16"], [event(), "192.168.1.2", "16"],
    [event(123, "unknown"), "127.0.0.1", "12"], [event(123, "denied"), "127.0.0.1", "7"],
    [Buffer.from([0xff]), "127.0.0.1", "3"],
  ];
  for (const [payload, peer, status] of rejectedCases) {
    const rejected = send(payload, peer); await rejected.done;
    assert.equal(rejected.stream.writes.length, 0);
    assert.equal((rejected.stream as any)[Symbol.for("evejs.publicGateway.grpcTrailers")]["grpc-status"], status);
  }
  assert.equal(calls.length, 3, "forged peers/characters and malformed envelopes must never reach event mutation");
});
