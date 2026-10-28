import assert from "node:assert/strict";
import test from "node:test";

const {
  STATUS,
  action,
  condition,
  sequence,
  selector,
  NpcEventInbox,
  NpcActionLockManager,
  NpcBlackboardStore,
} = require("../src/space/npc/npcBehaviorTreeRuntime");

test("behavior tree selectors and sequences preserve running and suspended states", () => {
  const trace: string[] = [];
  const tree = selector("root", [
    condition("not-ready", () => false),
    sequence("job", [
      action("prepare", () => { trace.push("prepare"); return { status: STATUS.SUCCESS }; }),
      action("wait", () => ({ status: STATUS.SUSPENDED, nextWakeAtMs: 1234 })),
      action("never", () => { trace.push("never"); return true; }),
    ]),
  ]);
  const result = tree.tick({});
  assert.equal(result.status, STATUS.SUSPENDED);
  assert.equal(result.nextWakeAtMs, 1234);
  assert.deepEqual(trace, ["prepare"]);
});

test("NPC event inbox deduplicates event IDs and drains in order", () => {
  const inbox = new NpcEventInbox({ maxEvents: 16 });
  inbox.publish(1500000001, "aggression", { targetID: 7 }, { eventID: "same", createdAtMs: 1 });
  inbox.publish(1500000001, "aggression", { targetID: 8 }, { eventID: "same", createdAtMs: 2 });
  inbox.publish(1500000001, "cargo-full", null, { eventID: "next", createdAtMs: 3 });
  assert.deepEqual(inbox.drain(1500000001).map((event) => event.eventID), ["same", "next"]);
  assert.deepEqual(inbox.drain(1500000001), []);
});

test("NPC action locks enforce exclusive ownership and expire", () => {
  const locks = new NpcActionLockManager();
  const first = locks.acquire(1500000001, "movement", { owner: "job-a", nowMs: 100, ttlMs: 500 });
  assert.equal(first.success, true);
  assert.equal(
    locks.acquire(1500000001, "movement", { owner: "job-b", nowMs: 200 }).errorMsg,
    "NPC_ACTION_LOCK_BUSY",
  );
  const renewed = locks.renew(first.data.token, 500, 500);
  assert.equal(renewed.success, true);
  assert.equal(renewed.data.expiresAtMs, 1_000);
  assert.equal(locks.prune(999), 0);
  assert.equal(locks.release(first.data.token).released, true);
  assert.equal(locks.release(first.data.token).released, false);
  assert.equal(locks.acquire(1500000001, "movement", { owner: "job-b", nowMs: 602 }).success, true);
  const expiring = locks.acquire(1500000002, "movement", { owner: "job-c", nowMs: 700, ttlMs: 100 });
  assert.equal(expiring.success, true);
  assert.equal(locks.prune(800), 1);
  assert.equal(locks.clearNpc(1500000001), 1);
});

test("NPC blackboards are transient and reset at an incarnation boundary", () => {
  const blackboards = new NpcBlackboardStore();
  const first = blackboards.get(1500000001, 1);
  first.memory.route = [30000004, 30000005];
  assert.strictEqual(blackboards.get(1500000001, 1), first);
  const respawned = blackboards.get(1500000001, 2);
  assert.notStrictEqual(respawned, first);
  assert.deepEqual(respawned.memory, {});
});
