import assert from "node:assert/strict";
import test from "node:test";

const { createNpcTaskActionAdapters } = require("../src/space/npc/npcTaskActionAdapters");

const ACTOR_ID = 980000000111;
const PILOT_ID = 140000111;
const INCARNATION = 3;
const FACTION_WALLET = "0x1234";

function factionPaidControl() {
  return {
    ensureCommand(_context: any, intent: Record<string, any>) {
      return { status: "confirmed", receipt: {
        ...intent,
        senderAddress: FACTION_WALLET,
        gasOwnerAddress: FACTION_WALLET,
        transactionDigest: `digest-${intent.stepID}`,
      } };
    },
  };
}

function fixture(extra: Record<string, any> = {}) {
  const actor = {
    entityID: ACTOR_ID, categoryID: 6, npcCharacterID: PILOT_ID,
    npcIncarnation: INCARNATION, systemID: 30000001,
  };
  const records = new Map<number, any>([[ACTOR_ID, actor], ...(extra.records || [])]);
  const pilots = new Map<number, any>([[PILOT_ID, {
    characterID: PILOT_ID, activeEntityID: ACTOR_ID, incarnation: INCARNATION,
    factionKey: "100-osa", sui: {
      status: "confirmed", chainId: "01e3bf5c", walletAddress: FACTION_WALLET,
    },
  }], ...(extra.pilots || [])]);
  const job = {
    jobID: "fit-job-1", jobType: "task.prepare", npcCharacterID: PILOT_ID,
    incarnation: INCARNATION, recordRevision: 1, nextWakeAtMs: 0,
    payload: { taskRequirement: { kind: "mining" }, ...(extra.payload || {}) },
    checkpoint: extra.checkpoint || {},
  };
  const context = {
    entity: { itemID: ACTOR_ID }, nowMs: 1_000, job,
    persistence: {
      updateNpcJob(_jobID: string, patch: Record<string, any>) {
        Object.assign(job, patch, { recordRevision: job.recordRevision + 1 });
        return { success: true, data: job };
      },
    },
  };
  return {
    context,
    ports: {
      nativeStore: { getNativeEntity: (entityID: number) => records.get(entityID) || null },
      pilotStore: { get: (characterID: number) => pilots.get(characterID) || null },
    },
    records,
    pilots,
  };
}

test("task adapters apply one self-fit change per wake and settle the durable plan", () => {
  const { context, ports } = fixture();
  let state = "pending";
  let capable = false;
  const pendingChanges: any[] = [
    { stepID: "module-7", itemID: 7 },
    { stepID: "module-8", itemID: 8 },
  ];
  const applied: string[] = [];
  const completed: string[] = [];
  const adapter = createNpcTaskActionAdapters({
    ...ports,
    dappControl: factionPaidControl(),
    capability: { canPerform: () => capable },
    plans: {
      select: () => ({ kind: "refit", planID: "plan-a" }),
      isCurrent: () => true,
    },
    fitting: {
      getState: () => state,
      resolveService: () => state === "pending" ? { serviceID: 42 } : null,
      authorizeService: () => true,
      atService: () => true,
      validate: () => state === "pending",
      nextChange: () => pendingChanges[0] || null,
      applyOneChange(_ctx: any, _actor: any, _subject: any, _plan: any, _change: any, key: string) {
        applied.push(key);
        pendingChanges.shift();
        if (!pendingChanges.length) state = "changes-committed";
        capable = true;
        return { success: true };
      },
      complete(_ctx: any, _actor: any, _subject: any, _plan: any, key: string) {
        completed.push(key);
        state = "complete";
        return { success: true };
      },
    },
  });

  assert.equal(adapter.tick("pilotTaskPreparation", context).status, "running");
  assert.equal(context.job.checkpoint.taskCapabilityPlan.kind, "refit");
  assert.deepEqual(applied, ["npc-self-fit:fit-job-1:3:plan-a:module-7"]);
  assert.deepEqual(completed, []);
  assert.equal(adapter.tick("pilotTaskPreparation", context).status, "running");
  assert.deepEqual(applied, [
    "npc-self-fit:fit-job-1:3:plan-a:module-7",
    "npc-self-fit:fit-job-1:3:plan-a:module-8",
  ]);
  assert.deepEqual(completed, []);
  assert.equal(adapter.tick("pilotTaskPreparation", context).status, "running");
  assert.deepEqual(completed, ["npc-self-fit:fit-job-1:3:plan-a:complete"]);
  assert.equal(adapter.tick("pilotTaskPreparation", context).status, "success");
});

test("task adapters fail closed for stale pilot leases and absent execution ports", () => {
  const { context, ports, pilots } = fixture();
  const adapter = createNpcTaskActionAdapters(ports);
  assert.equal(adapter.tick("pilotTaskPreparation", context).status, "suspended");
  pilots.set(PILOT_ID, { characterID: PILOT_ID, activeEntityID: ACTOR_ID + 1, incarnation: INCARNATION });
  assert.equal(adapter.tick("pilotTaskPreparation", context).status, "failure");
});

test("a stale plan or unauthorized fitting service cannot reach item mutation", () => {
  const { context, ports } = fixture({ checkpoint: { taskCapabilityPlan: {
    kind: "refit", planID: "refit-a", actorEntityID: ACTOR_ID,
    jobID: "fit-job-1", npcCharacterID: PILOT_ID, incarnation: INCARNATION,
  } } });
  const mutations: string[] = [];
  let current = false;
  const adapter = createNpcTaskActionAdapters({
    ...ports,
    dappControl: factionPaidControl(),
    plans: { isCurrent: () => current },
    fitting: {
      getState: () => "pending",
      resolveService: () => ({ serviceID: 42 }),
      authorizeService: () => false,
      atService: () => true,
      validate: () => true,
      nextChange: () => ({ stepID: "module-7" }),
      applyOneChange: () => { mutations.push("applied"); return { success: true }; },
    },
  });
  assert.equal(adapter.tick("pilotTaskRefit", context).status, "failure");
  current = true;
  assert.equal(adapter.tick("pilotTaskRefit", context).status, "suspended");
  assert.deepEqual(mutations, []);
});

test("navigation advances one step and waits for arrival before fitting", () => {
  const { context, ports } = fixture({ checkpoint: { taskCapabilityPlan: {
    kind: "refit", planID: "refit-a", actorEntityID: ACTOR_ID,
    jobID: "fit-job-1", npcCharacterID: PILOT_ID, incarnation: INCARNATION,
  } } });
  let arrived = false;
  const trace: string[] = [];
  const adapter = createNpcTaskActionAdapters({
    ...ports,
    dappControl: factionPaidControl(),
    plans: { isCurrent: () => true },
    navigation: {
      advanceToService: () => { trace.push("travel"); return { status: "success" }; },
    },
    fitting: {
      getState: () => "pending",
      resolveService: () => ({ serviceID: 42 }),
      authorizeService: () => true,
      atService: () => arrived,
      validate: () => true,
      nextChange: () => ({ stepID: "module-7" }),
      applyOneChange: () => { trace.push("fit"); return { success: true }; },
    },
  });
  assert.equal(adapter.tick("pilotTaskRefit", context).status, "running");
  assert.deepEqual(trace, ["travel"]);
  arrived = true;
  assert.equal(adapter.tick("pilotTaskRefit", context).status, "running");
  assert.deepEqual(trace, ["travel", "fit"]);
});

test("admin-sponsored or unpaid dApp receipts cannot execute an NPC task step", () => {
  const { context, ports } = fixture({ checkpoint: { taskCapabilityPlan: {
    kind: "refit", planID: "refit-a", actorEntityID: ACTOR_ID,
    jobID: "fit-job-1", npcCharacterID: PILOT_ID, incarnation: INCARNATION,
  } } });
  const mutations: string[] = [];
  let pending = true;
  const adapter = createNpcTaskActionAdapters({
    ...ports,
    plans: { isCurrent: () => true },
    dappControl: {
      ensureCommand(_ctx: any, intent: Record<string, any>) {
        if (pending) return { status: "pending" };
        return { status: "confirmed", receipt: {
          ...intent,
          senderAddress: FACTION_WALLET,
          gasOwnerAddress: intent.action === "job.execute" ? FACTION_WALLET : "0x9999",
          sponsorAddress: intent.action === "job.execute" ? null : "0x9999",
          transactionDigest: "digest-confirmed",
        } };
      },
    },
    fitting: {
      getState: () => "pending",
      resolveService: () => ({ serviceID: 42 }),
      authorizeService: () => true,
      atService: () => true,
      validate: () => true,
      nextChange: () => ({ stepID: "module-7" }),
      applyOneChange: () => { mutations.push("fit"); return { success: true }; },
    },
  });
  assert.equal(adapter.tick("pilotTaskRefit", context).status, "suspended");
  pending = false;
  assert.equal(adapter.tick("pilotTaskRefit", context).status, "suspended");
  assert.deepEqual(mutations, []);
});

test("ship swap adapter invokes one authorized boarding operation with a stable key", () => {
  const replacementID = ACTOR_ID + 2;
  const { context, ports } = fixture({
    records: [[replacementID, { entityID: replacementID, categoryID: 6, systemID: 30000001 }]],
    checkpoint: { taskCapabilityPlan: {
      kind: "swap", planID: "swap-a", replacementEntityID: replacementID,
      jobID: "fit-job-1", npcCharacterID: PILOT_ID, incarnation: INCARNATION,
      actorEntityID: ACTOR_ID,
    } },
  });
  let state = "pending";
  let capable = false;
  const keys: string[] = [];
  const adapter = createNpcTaskActionAdapters({
    ...ports,
    dappControl: factionPaidControl(),
    capability: { canPerform: () => capable },
    plans: { isCurrent: () => true },
    ships: {
      getState: () => state,
      validate: () => true,
      atReplacement: () => true,
      commitSwap(_ctx: any, _actor: any, _ship: any, _plan: any, key: string) {
        keys.push(key);
        state = "complete";
        capable = true;
        return { success: true };
      },
    },
  });
  assert.equal(adapter.tick("pilotTaskShipSwap", context).status, "running");
  assert.equal(adapter.tick("pilotTaskShipSwap", context).status, "success");
  assert.deepEqual(keys, ["npc-task-swap:fit-job-1:3:swap-a"]);
});

test("fitting another NPC requires current authority and supports an unpiloted entity target", () => {
  const targetID = ACTOR_ID + 3;
  const { context, ports } = fixture({
    records: [[targetID, { entityID: targetID, categoryID: 11, systemID: 30000001 }]],
    payload: { targetEntityID: targetID },
    checkpoint: { taskCapabilityPlan: {
      kind: "support-fit", planID: "support-a", targetEntityID: targetID,
      jobID: "fit-job-1", npcCharacterID: PILOT_ID, incarnation: INCARNATION,
      actorEntityID: ACTOR_ID,
    } },
  });
  context.job.jobType = "npc.fit-support";
  let authorized = false;
  const keys: string[] = [];
  const adapter = createNpcTaskActionAdapters({
    ...ports,
    dappControl: factionPaidControl(),
    capability: { canPerform: () => false },
    plans: { isCurrent: () => true },
    support: { authorize: () => authorized },
    fitting: {
      getState: () => "pending",
      resolveService: () => ({ serviceID: 42 }),
      authorizeService: () => true,
      atService: () => true,
      validate: () => true,
      nextChange: () => ({ stepID: "module-8", itemID: 8 }),
      applyOneChange(_ctx: any, _actor: any, _subject: any, _plan: any, _change: any, key: string) {
        keys.push(key);
        return { success: true };
      },
    },
  });
  assert.equal(adapter.tick("pilotNpcFittingSupport", context).status, "suspended");
  assert.deepEqual(keys, []);
  authorized = true;
  assert.equal(adapter.tick("pilotNpcFittingSupport", context).status, "running");
  assert.deepEqual(keys, ["npc-support-fit:fit-job-1:3:support-a:module-8"]);
});
