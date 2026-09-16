"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");

const {
  ServiceTaskPool,
} = require("../src/utils/serviceTaskPool");

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
