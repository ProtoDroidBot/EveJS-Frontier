"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { emitPhysicsGunPose, POSE_HEARTBEAT_MS } = require("../src/space/physicsGunPoseStream");
const { marshalEncode } = require("../src/network/tcp/utils/marshal");

test("Physics Gun pose stream stays bubble-scoped, ordered, throttled, and terminal", () => {
  const received = [[], [], []];
  const sessions = received.map((events, index) => ({
    _space: { systemID: 30000142 },
    bubbleID: index === 2 ? 8 : 5,
    sendNotification(name, route, values) {
      assert.equal(values[0].type, "dict");
      assert.doesNotThrow(() => marshalEncode([0, [1, values]],
        { compatibilityProfile: "frontier" }));
      events.push([name, route, Object.fromEntries(values[0].entries)]);
    },
  }));
  const scene = {
    systemID: 30000142,
    sessions: new Map(sessions.map((session, index) => [index, session])),
    getShipEntityForSession: (session) => session,
    canSessionSeeDynamicEntity: (session, entity) => session.bubbleID === entity.bubbleID,
  };
  const entity = {
    itemID: 8_600_000_000_000_000, bubbleID: 5,
    position: { x: 100, y: 2, z: 3 },
    velocity: { x: 0, y: 0, z: 0 },
    collisionQuaternion: { x: 0, y: 0, z: 0, w: 1 },
  };
  const state = {
    tether: { moduleID: 998_840_000_0138, contactOffset: { x: 4, y: 0, z: 0 } },
    poseSourceEntityID: 544_400_000_400_201,
  };
  const first = emitPhysicsGunPose(scene, entity, state, "start", 1000);
  assert.equal(first.moduleTypeID, 99999);
  assert.equal(first.sourceEntityID, 544_400_000_400_201);
  assert.deepEqual(first.anchorLocal, [4, 0, 0]);
  assert.deepEqual(received.map((events) => events.length), [1, 1, 0]);
  assert.equal(received[0][0][2].mode, "start");

  entity.position.x = 150;
  assert.equal(emitPhysicsGunPose(scene, entity, state, "update", 1050), null);
  assert.equal(received[0].length, 1);
  const second = emitPhysicsGunPose(scene, entity, state, "update", 1100);
  assert.equal(second.revision, first.revision + 1);
  assert.equal(received[0][1][2].mode, "update");
  assert.deepEqual(received[0][1][2].position, [150, 2, 3]);

  assert.equal(emitPhysicsGunPose(scene, entity, state, "update", 1125), null);
  sessions[2].bubbleID = 5;
  emitPhysicsGunPose(scene, entity, state, "update", 1150);
  assert.equal(received[2].at(-1)[2].mode, "start");
  assert.equal(received[0].length, 2);

  sessions[1].bubbleID = 8;
  emitPhysicsGunPose(scene, entity, state, "update", 1200);
  assert.equal(received[1].at(-1)[2].mode, "hide");
  assert.equal(received[0].at(-1)[2].mode, "update");
  entity.position.x = 160;
  const terminal = emitPhysicsGunPose(scene, entity, state, "stop", 1250);
  assert.equal(received[0].at(-1)[2].mode, "stop");
  assert.deepEqual(terminal.position, [160, 2, 3]);
  assert.equal(received[1].at(-1)[2].mode, "hide");
  assert.equal(received[2].at(-1)[2].mode, "stop");
});

test("unchanged held pose stays live while the beam is active", () => {
  const received: any[] = [];
  const session = {
    _space: { systemID: 30000142 },
    sendNotification(_name, _route, values) {
      received.push(Object.fromEntries(values[0].entries));
    },
  };
  const scene = {
    systemID: 30000142,
    sessions: new Map([[1, session]]),
    canSessionSeeDynamicEntity: () => true,
  };
  const entity = {
    itemID: 8_600_000_000_000_000,
    position: { x: 10, y: 0, z: 0 },
    velocity: { x: 0, y: 0, z: 0 },
  };
  const state = { tether: { moduleID: 99999, contactOffset: { x: 0, y: 0, z: 0 } } };
  emitPhysicsGunPose(scene, entity, state, "start", 1_000);
  assert.equal(emitPhysicsGunPose(scene, entity, state, "update",
    1_000 + POSE_HEARTBEAT_MS - 1), null);
  const heartbeat = emitPhysicsGunPose(scene, entity, state, "update",
    1_000 + POSE_HEARTBEAT_MS);
  assert.equal(heartbeat.revision, 2);
  assert.equal(heartbeat.simTimeMs, 1_000 + POSE_HEARTBEAT_MS);
  assert.deepEqual(received.map((payload) => payload.mode), ["start", "update"]);
  assert.deepEqual(received[1].position, received[0].position);
});
