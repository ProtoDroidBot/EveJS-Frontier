"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { shutdownWorld } = require("../src/services/_shared/worldShutdown");

test("shutdown disconnects players before unloading NPC scenes", () => {
  const calls: string[] = [];
  const session = { characterID: 42, socket: { destroy: () => calls.push("socket") } };
  const scenes = new Map([[30000004, {}]]);
  const result = shutdownWorld("SIGTERM", {
    gatewayRuntime: { shutdown: () => calls.push("browser") },
    sessionRegistry: {
      getRegisteredSessions: () => [session],
      resolveSessionCharacterID: (entry) => entry.characterID,
      unregister: () => calls.push("unregister"),
    },
    disconnectCharacterSession: (_entry, options) => {
      assert.equal(options.lifecycleReason, "server_shutdown");
      assert.equal(options.broadcast, false);
      calls.push("player");
      return { success: true, cleanupErrors: [] };
    },
    spaceRuntime: {
      scenes,
      unloadSolarSystemScene: (systemID, options) => {
        assert.equal(systemID, 30000004);
        assert.equal(options.reason, "server_shutdown");
        calls.push("npc scene");
        return { unloaded: true };
      },
    },
    log: { info: () => {} },
  });
  assert.deepEqual(calls, ["browser", "player", "unregister", "socket", "npc scene"]);
  assert.deepEqual(result, { playerCount: 1, sceneCount: 1 });
});

test("shutdown reports failed player saves after attempting remaining scenes", () => {
  const calls: string[] = [];
  assert.throws(() => shutdownWorld("SIGINT", {
    gatewayRuntime: { shutdown: () => {} },
    sessionRegistry: {
      getRegisteredSessions: () => [{ characterID: 42 }],
      resolveSessionCharacterID: () => 42,
      unregister: () => calls.push("unregister"),
    },
    disconnectCharacterSession: () => ({ success: false, cleanupErrors: ["logoff persistence"] }),
    spaceRuntime: {
      scenes: new Map([[30000004, {}]]),
      unloadSolarSystemScene: () => {
        calls.push("scene");
        return { unloaded: true };
      },
    },
    log: { info: () => {} },
  }), /character 42: logoff persistence/);
  assert.deepEqual(calls, ["unregister", "scene"]);
});

test("browser teardown failure still unloads retail sessions and NPC scenes", () => {
  const calls: string[] = [];
  assert.throws(() => shutdownWorld("SIGTERM", {
    gatewayRuntime: { shutdown: () => { throw new Error("browser save failed"); } },
    sessionRegistry: {
      getRegisteredSessions: () => [{ characterID: 42 }],
      resolveSessionCharacterID: () => 42,
      unregister: () => calls.push("unregister"),
    },
    disconnectCharacterSession: () => {
      calls.push("player");
      return { success: true };
    },
    spaceRuntime: {
      scenes: new Map([[30000004, {}]]),
      unloadSolarSystemScene: () => {
        calls.push("scene");
        return { unloaded: true };
      },
    },
    log: { info: () => {} },
  }), /browser sessions: browser save failed/);
  assert.deepEqual(calls, ["player", "unregister", "scene"]);
});
