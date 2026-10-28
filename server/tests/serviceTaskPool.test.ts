"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");

const {
  ServiceTaskPool,
} = require("../src/utils/serviceTaskPool");
const serviceTaskPoolModule = require("../src/utils/serviceTaskPool");

test("generic task-pool module exposes no process-wide shared queue", () => {
  assert.equal(serviceTaskPoolModule.run, undefined);
  assert.equal(typeof serviceTaskPoolModule.ServiceTaskPool, "function");
});

test("CPU-heavy service planning runs in a worker without starving the main loop", async () => {
  const pool = new ServiceTaskPool({ poolSize: 1, taskTimeoutMs: 10_000 });
  let mainLoopTicks = 0;
  const heartbeat = setInterval(() => {
    mainLoopTicks += 1;
  }, 5);

  try {
    const result = await pool.run({
      modulePath: path.join(__dirname, "fixtures/serviceTaskFixture.js"),
      exportName: "spinFor",
      args: [150],
    });

    assert.equal(result.isMainThread, false);
    assert.ok(result.threadId > 0);
    assert.ok(result.elapsedMs >= 125);
    assert.ok(
      mainLoopTicks >= 5,
      `main event loop only advanced ${mainLoopTicks} time(s) during worker load`,
    );
  } finally {
    clearInterval(heartbeat);
    await pool.close();
  }
});

test("worker pools reject excess admission before an unbounded backlog forms", async () => {
  const pool = new ServiceTaskPool({
    poolSize: 1,
    taskTimeoutMs: 10_000,
    maxPendingTasks: 1,
  });
  try {
    const first = pool.run({
      modulePath: path.join(__dirname, "fixtures/serviceTaskFixture.js"),
      exportName: "spinFor",
      args: [100],
    });
    await assert.rejects(
      pool.run({
        modulePath: path.join(__dirname, "fixtures/serviceTaskFixture.js"),
        exportName: "spinFor",
        args: [1],
      }),
      (error) => error && error.code === "SERVICE_TASK_QUEUE_FULL",
    );
    await first;
    assert.deepEqual(pool.getStats(), {
      workers: 1,
      active: 0,
      queued: 0,
      maxPendingTasks: 1,
      taskTimeoutMs: 10_000,
    });
  } finally {
    await pool.close();
  }
});
