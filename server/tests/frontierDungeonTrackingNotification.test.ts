"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const dungeonTrackingRuntime = require("../src/services/dungeon/dungeonTrackingRuntime");

test("current dungeon login payload matches the client's three-value unpack", () => {
  const info = dungeonTrackingRuntime.buildCurrentDungeonInfo(
    {
      instanceID: 46,
      sourceDungeonID: 13_118,
      roomStatesByKey: {},
    },
    "room:entry",
  );

  assert.deepEqual(info, [
    13_118,
    0,
    {
      type: "dict",
      entries: [],
    },
  ]);
});

test("dungeon room entry notification matches the build 3502403 client handler", () => {
  const notifications = [];
  const session = {
    sendNotification(...args) {
      notifications.push(args);
    },
  };

  const sent = dungeonTrackingRuntime.sendEnteringDungeonRoomNotification(
    session,
    {
      instanceID: 10,
      sourceDungeonID: 2228,
      roomStatesByKey: {},
    },
    "room:entry",
    { roomPosition: { x: 1, y: 2, z: 3 } },
  );

  assert.equal(sent, true);
  assert.deepEqual(notifications, [[
    "OnEnteringDungeonRoom",
    "shipid",
    [2228, 0, [1, 2, 3], 10],
  ]]);
});
