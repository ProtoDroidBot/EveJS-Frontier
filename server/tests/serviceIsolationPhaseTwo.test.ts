const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const zlib = require("node:zlib");
const { EventEmitter } = require("node:events");

const marshal = require("../src/network/tcp/utils/marshal");
const packetCodecTask = require("../src/network/tcp/packetCodecTask");
const packetCodecPool = require("../src/network/tcp/packetCodecPool");
const planetRuntimeStore = require("../src/services/planet/planetRuntimeStore");
const planetSimulationPool = require("../src/services/planet/planetSimulationPool");
const portraitImageStore = require("../src/services/character/portraitImageStore");
const ClientSession = require("../src/network/clientSession");
const {
  resolveImageRequestAsync,
} = require("../src/_secondary/image/imageRequestResolver");
const serviceCallShapeCapture = require(
  "../src/services/_shared/serviceCallShapeCapture",
);

test("packet codec worker decodes compressed packets and restores buffers", async () => {
  const value = {
    type: "object",
    name: "test.Packet",
    args: [Buffer.from("binary-payload"), 42],
  };
  const encoded = marshal.marshalEncode(value);
  const decoded = await packetCodecPool.decodeInboundPacket(zlib.deflateSync(encoded), {
    maxDecompressedBytes: 1024 * 1024,
    maxDepth: 32,
    maxNodes: 1000,
  });
  assert.equal(Buffer.from(decoded.name).toString("utf8"), "test.Packet");
  assert.equal(Buffer.isBuffer(decoded.args[0]), true);
  assert.equal(decoded.args[0].toString("utf8"), "binary-payload");
});

test("marshal and inflate limits reject pathological codec inputs", () => {
  let nested: any = 1;
  for (let index = 0; index < 20; index++) nested = [nested];
  assert.throws(
    () => marshal.marshalEncode(nested, { maxDepth: 8, maxNodes: 100 }),
    (error) => error && error.code === "MARSHAL_LIMIT_EXCEEDED",
  );

  const compressed = zlib.deflateSync(Buffer.alloc(64 * 1024, 1));
  assert.throws(
    () => packetCodecTask.decodeInboundPacket(compressed, {
      maxDecompressedBytes: 1024,
    }),
  );
});

test("outbound codec marshals nested notification payloads in the worker", () => {
  const packet = {
    type: "object",
    name: "test.Notification",
    args: [0, [[0, null]]],
  };
  const result = packetCodecTask.encodeOutboundPacket(packet, {
    maxDepth: 32,
    maxNodes: 1000,
    innerMarshals: [{
      path: ["args", 1, 0, 1],
      value: [1, Buffer.from("payload")],
      returnEncoded: true,
    }],
  });
  const decoded = marshal.marshalDecodeExact(result.encoded);
  const inner = decoded.args[1][0][1];
  assert.equal(Buffer.isBuffer(inner), true);
  assert.deepEqual(marshal.marshalDecodeExact(inner), [1, Buffer.from("payload")]);
});

test("client session preserves notification and raw-payload wire order", async () => {
  const writes: Buffer[] = [];
  const socket: any = new EventEmitter();
  socket.remoteAddress = "test";
  socket.destroyed = false;
  socket.writableLength = 0;
  socket.write = (data) => {
    writes.push(Buffer.from(data));
    return true;
  };
  socket.destroy = () => {
    socket.destroyed = true;
  };
  const session = new ClientSession(
    { userId: 1, clientId: 2, sessionId: 3n },
    socket,
    { compatibilityProfile: "legacy" },
  );
  session.sendNotification("IsolationTest", "ownerid", [Buffer.from("inner")]);
  session.sendRawPayload(Buffer.from("raw"), { label: "order-test" });
  await session._outboundWriteTail;

  assert.equal(writes.length, 2);
  const decoded = marshal.marshalDecodeExact(writes[0].subarray(4));
  const inner = decoded.args[4][0][1];
  assert.deepEqual(marshal.marshalDecodeExact(inner), [0, [1, [Buffer.from("inner")]]]);
  assert.equal(writes[1].subarray(4).toString("utf8"), "raw");
});

test("PI planning is versioned, isolated, and rejects oversized commands", async () => {
  const colony = planetRuntimeStore._testing.normalizeColony(null, {
    planetID: 40000001,
    ownerID: 90000001,
  });
  const fingerprint = planetRuntimeStore.colonySnapshotFingerprint(colony);
  const target = (BigInt(colony.currentSimTime) + 10_000_000n).toString();
  const plan = planetRuntimeStore.buildColonySimulationPlan(
    colony,
    target,
    {},
    fingerprint,
  );
  assert.equal(plan.baseFingerprint, fingerprint);
  assert.equal(plan.colony.currentSimTime, target);
  assert.equal(plan.truncated, false);
  const isolatedPlan = await planetSimulationPool.buildColonySimulationPlan(
    colony,
    target,
    {},
    fingerprint,
  );
  assert.equal(isolatedPlan.baseFingerprint, fingerprint);
  assert.equal(isolatedPlan.colony.currentSimTime, target);

  const commands = Array.from(
    { length: planetRuntimeStore.MAX_NETWORK_COMMANDS + 1 },
    () => [planetRuntimeStore.COMMAND.CREATEPIN, []],
  );
  assert.throws(
    () => planetRuntimeStore.applyUserUpdateNetwork({
      planetID: 40000001,
      ownerID: 90000001,
      commands,
      dryRun: true,
    }),
    /command limit exceeded/i,
  );
});

test("portrait writes are async, ordered, and atomically replace each size", async () => {
  const characterID = 987654321;
  const size = 32;
  const filePath = portraitImageStore.getCharacterPortraitFilePath(
    characterID,
    size,
    "jpg",
  );
  try {
    const first = portraitImageStore.storeCharacterPortraitAsync(
      characterID,
      Buffer.from("first"),
      { sizes: [size] },
    );
    const second = portraitImageStore.storeCharacterPortraitAsync(
      characterID,
      Buffer.from("second"),
      { sizes: [size] },
    );
    assert.equal((await first).success, true);
    assert.equal((await second).success, true);
    assert.equal(await fs.promises.readFile(filePath, "utf8"), "second");
    const resolved = await resolveImageRequestAsync(
      `/Character/${characterID}_${size}.jpg`,
    );
    assert.equal(path.resolve(resolved.filePath), path.resolve(filePath));
  } finally {
    await fs.promises.rm(filePath, { force: true });
  }
});

test("diagnostic capture appends in order without synchronous file writes", async () => {
  const tempRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), "evejs-capture-"));
  const capturePath = path.join(tempRoot, "capture.jsonl");
  try {
    serviceCallShapeCapture.configureForTests({
      enabled: true,
      filePath: capturePath,
      memory: false,
    });
    serviceCallShapeCapture.captureNotificationShape({
      lane: "test",
      notifyType: "first",
      payload: [],
    });
    serviceCallShapeCapture.captureNotificationShape({
      lane: "test",
      notifyType: "second",
      payload: [],
    });
    await serviceCallShapeCapture.flushWritesForTests();
    const lines = (await fs.promises.readFile(capturePath, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    assert.deepEqual(lines.map((entry) => entry.notifyType), ["first", "second"]);
  } finally {
    serviceCallShapeCapture.resetForTests();
    await fs.promises.rm(tempRoot, { recursive: true, force: true });
  }
});
