"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const gate = require("../src/utils/interactiveWorkloadGate");

test.afterEach(() => {
  gate._testing.resetForTests();
});

test("background work stays deferred while a login is active and through its grace window", () => {
  const finishLogin = gate.beginLogin();
  assert.equal(gate.getSnapshot().activeLoginCount, 1);
  assert.equal(gate.shouldDeferBackgroundWork(), true);

  finishLogin();
  finishLogin();
  assert.equal(gate.getSnapshot().activeLoginCount, 0);
  assert.equal(gate.shouldDeferBackgroundWork(), true);
});

test("login activity extends a deterministic background deferral deadline", () => {
  gate.noteLoginActivity(2_000, 1_000);
  assert.equal(gate.getBackgroundDeferralDelayMs(1_500), 1_500);
  assert.equal(gate.getBackgroundDeferralDelayMs(3_000), 0);

  gate.noteLoginActivity(2_000, 2_500);
  assert.equal(gate.getBackgroundDeferralDelayMs(3_000), 1_500);
});

test("character selection protects the full client scene-bootstrap window", () => {
  const deadline = gate.noteSessionBootstrapActivity(30_000, 1_000);

  assert.equal(deadline, 31_000);
  assert.equal(gate.getBackgroundDeferralDelayMs(30_999), 1);
  assert.equal(gate.shouldDeferBackgroundWork(31_000), false);
});
