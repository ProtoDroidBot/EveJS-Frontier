"use strict";

const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "../..");

function runShutdownScript(script) {
  return spawnSync(process.execPath, ["-e", script], {
    cwd: root,
    env: process.env,
    encoding: "utf8",
    timeout: 20_000,
  });
}

test("world unload hooks run before NPC checkpoint hooks", () => {
  const result = runShutdownScript(`
    const store = require('./server/src/gameStore');
    store.registerShutdownHook(() => process.stdout.write('npc-checkpoint\\n'));
    store.registerShutdownHook(() => process.stdout.write('world-unload\\n'), { priority: 100 });
    process.emit('SIGTERM');
  `);
  assert.equal(result.status, 0, result.stderr);
  assert.ok(result.stdout.indexOf("world-unload") < result.stdout.indexOf("npc-checkpoint"));
});

test("failed shutdown hooks still run later hooks and exit unsuccessfully", () => {
  const result = runShutdownScript(`
    const store = require('./server/src/gameStore');
    store.registerShutdownHook(() => process.stdout.write('npc-checkpoint\\n'));
    store.registerShutdownHook(() => { throw new Error('player save failed'); }, { priority: 100 });
    process.emit('SIGTERM');
  `);
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stdout, /npc-checkpoint/);
  assert.match(result.stderr + result.stdout, /player save failed/);
});
