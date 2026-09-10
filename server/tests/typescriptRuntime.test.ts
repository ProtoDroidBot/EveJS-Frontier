import assert = require("node:assert/strict");
import fs = require("node:fs");
import os = require("node:os");
import path = require("node:path");
import { test } from "node:test";
import type { PersistenceOperation } from "../src/gameStore/persistenceTypes";

const { framePayload, readPacketLength } = require("../src/network/tcp/packetFraming");
const { createRuntimeContext } = require("../src/runtimeContext");
const { loadSecondaryServices } = require("../src/secondaryServiceLoader");
const sqliteStore = require("../src/gameStore/sqliteStore");
const { _createControllerForTests } = require("../src/gameStore/persistenceWorker");

test("compiled packet framing preserves Frontier and legacy wire byte order", () => {
  const payload = Buffer.alloc(258, 0xab);
  for (const [profile, expectedHeader] of [
    ["frontier", [0, 0, 1, 2]],
    ["tranquility", [2, 1, 0, 0]],
  ] as const) {
    const frame: Buffer = framePayload(payload, profile);
    assert.deepEqual([...frame.subarray(0, 4)], expectedHeader);
    assert.equal(readPacketLength(frame, profile), payload.length);
    assert.deepEqual(frame.subarray(4), payload);
  }
});

test("secondary discovery loads emitted JavaScript with its runtime context", (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "evejs-secondary-ts-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  fs.mkdirSync(path.join(directory, "nested"));
  fs.writeFileSync(path.join(directory, "nested", "server.js"), `
    module.exports = {
      enabled: true,
      serviceName: "test-secondary",
      exec(context) { context.serviceManager.started.push(context); }
    };
  `);
  fs.writeFileSync(path.join(directory, "disabled.js"), `
    module.exports = { enabled: false, exec() { throw new Error("disabled"); } };
  `);
  fs.writeFileSync(path.join(directory, "uncompiled.ts"), "invalid TypeScript source");
  const started: unknown[] = [];
  const context = createRuntimeContext({ serviceManager: { started } });
  const errors: string[] = [];
  loadSecondaryServices(directory, context, {
    log: { debug() {}, spacer() {}, err(message: string) { errors.push(message); } },
  });
  assert.deepEqual(errors, []);
  assert.deepEqual(started, [context]);
  assert.equal(Object.isFrozen(context), true);
});

test("emitted persistence worker commits journaled writes and closes cleanly", { timeout: 10_000 }, async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "evejs-worker-ts-"));
  const dbPath = path.join(directory, "runtime.sqlite");
  const controller = _createControllerForTests({
    drainTimeoutMs: 5000,
    closeTimeoutMs: 2000,
    exitTimeoutMs: 2000,
  });
  t.after(async () => {
    await controller.shutdown();
    sqliteStore.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });
  const acknowledged: PersistenceOperation[] = [];
  controller.onAcknowledged((operation: PersistenceOperation) => acknowledged.push(operation));
  const record = { characterID: 42, characterName: "TypeScript worker smoke test" };
  const write = controller.submitWrite(dbPath, "characters", [["42", JSON.stringify(record)]], [], { sync: true });
  assert.equal(write.drain.drained, true);
  assert.deepEqual(sqliteStore.loadTableObject("characters"), { "42": record });
  assert.deepEqual(acknowledged.map((operation) => operation.operationId), [write.operationId]);
  assert.deepEqual(sqliteStore.listPersistenceOperations(), []);

  const shutdown = await controller.shutdown();
  assert.equal(shutdown.acknowledged, true);
  assert.equal(shutdown.worker.exited, true);
  assert.equal(shutdown.forcedTermination, false);
  assert.deepEqual(shutdown.errors, []);
  assert.equal(controller.isActive(), false);
  sqliteStore.close();
  sqliteStore.init(dbPath);
  assert.deepEqual(sqliteStore.loadTableObject("characters"), { "42": record });
});
