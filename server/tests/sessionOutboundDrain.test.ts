"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const spaceRuntime = require("../src/space/runtime");

function nextImmediate() {
  return new Promise((resolve) => setImmediate(resolve));
}

test("post-bootstrap work waits for an RPC response queued after the handler returns", async () => {
  let releaseResponse;
  const responseTail = new Promise((resolve) => {
    releaseResponse = resolve;
  });
  const session: Record<string, any> = {
    _outboundWriteTail: Promise.resolve(),
    _queuedOutboundPackets: 0,
  };
  let callbackCount = 0;

  spaceRuntime._testing.scheduleAfterSessionOutboundDrainForTesting(
    session,
    () => true,
    () => {
      callbackCount += 1;
    },
  );

  // Model packetDispatcher queuing GetFormations after its handler returns.
  session._queuedOutboundPackets = 1;
  session._outboundWriteTail = responseTail.finally(() => {
    session._queuedOutboundPackets = 0;
  });

  await nextImmediate();
  await nextImmediate();
  assert.equal(callbackCount, 0);

  releaseResponse();
  await session._outboundWriteTail;
  await nextImmediate();
  await nextImmediate();
  assert.equal(callbackCount, 1);
});

test("post-bootstrap work is cancelled when its session generation is replaced", async () => {
  const session: Record<string, any> = {
    _outboundWriteTail: Promise.resolve(),
    _queuedOutboundPackets: 0,
  };
  let usable = true;
  let callbackCount = 0;

  spaceRuntime._testing.scheduleAfterSessionOutboundDrainForTesting(
    session,
    () => usable,
    () => {
      callbackCount += 1;
    },
  );
  usable = false;

  await nextImmediate();
  await nextImmediate();
  assert.equal(callbackCount, 0);
});

test("pending initial-ballpark restoration starts only after the queued RPC response drains", async () => {
  let releaseResponse;
  const responseTail = new Promise((resolve) => {
    releaseResponse = resolve;
  });
  let callbackCount = 0;
  const initialBallparkGeneration: Record<string, any> = {
    initialStateSent: true,
    pendingInitialBallparkPostBootstrap() {
      callbackCount += 1;
    },
  };
  const session: Record<string, any> = {
    _space: initialBallparkGeneration,
    _outboundWriteTail: responseTail.finally(() => {
      session._queuedOutboundPackets = 0;
    }),
    _queuedOutboundPackets: 1,
  };

  assert.equal(
    spaceRuntime.flushPendingInitialBallparkPostBootstrap(session),
    true,
  );
  assert.equal(
    initialBallparkGeneration.pendingInitialBallparkPostBootstrap,
    null,
  );

  await nextImmediate();
  await nextImmediate();
  assert.equal(callbackCount, 0);

  releaseResponse();
  await session._outboundWriteTail;
  await nextImmediate();
  await nextImmediate();
  assert.equal(callbackCount, 1);
  assert.equal(
    spaceRuntime.flushPendingInitialBallparkPostBootstrap(session),
    false,
  );
});
