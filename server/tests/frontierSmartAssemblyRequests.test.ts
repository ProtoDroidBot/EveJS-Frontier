"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const requestRuntimeModule = require("../src/services/frontier/smartAssemblyRequestRuntime");
const {
  ASSEMBLY_REQUEST_PRIORITY,
  ASSEMBLY_REQUEST_PRIORITY_FLAG,
  ASSEMBLY_REQUEST_PRIORITY_FLAG_MASK,
  createSmartAssemblyRequestRuntime,
  hasAllPriorityFlags,
} = requestRuntimeModule;

const OWNER = 140000003;
const OTHER_OWNER = 140000004;
const SOURCE = 5000000001;
const TURRET = 5000000002;
const STORAGE = 5000000003;
const OTHER = 5000000004;
const OFFLINE = 5000000005;
const BUILDING = 5000000006;

const REQUEST_A = "11111111-1111-4111-8111-111111111111";
const REQUEST_B = "22222222-2222-4222-8222-222222222222";
const REQUEST_C = "33333333-3333-4333-8333-333333333333";

function assembly(itemID, ownerID, assemblyStatus = 2, assemblyTypeID = 87119) {
  return {
    item: { itemID, ownerID, typeID: assemblyTypeID },
    state: {
      activationCompleteAtMs: 0,
      assemblyStatus,
      assemblyTypeID,
      ownerID,
      solarSystemID: 30000004,
    },
  };
}

function fixture() {
  let currentTime = 1_000_000;
  let stored = {};
  let nextUUID = 10;
  const assemblies = new Map([
    [SOURCE, assembly(SOURCE, OWNER, 2, 88092)],
    [TURRET, assembly(TURRET, OWNER, 2, 88093)],
    [STORAGE, assembly(STORAGE, OWNER, 2, 87120)],
    [OTHER, assembly(OTHER, OTHER_OWNER, 2, 87119)],
    [OFFLINE, assembly(OFFLINE, OWNER, 1, 87121)],
    [BUILDING, assembly(BUILDING, OWNER, 5, 87122)],
  ]);
  const repository = {
    ensureTable() { return true; },
    read() { return { success: true, data: JSON.parse(JSON.stringify(stored)) }; },
    write(_table, _path, value) {
      stored = JSON.parse(JSON.stringify(value));
      return { success: true };
    },
  };
  const options = {
    repository,
    findAssembly: (itemID) => assemblies.get(Number(itemID)) || null,
    now: () => currentTime,
    randomUUID: () => `aaaaaaaa-aaaa-4aaa-8aaa-${String(nextUUID++).padStart(12, "0")}`,
  };
  return {
    assemblies,
    options,
    runtime: createSmartAssemblyRequestRuntime(options),
    advance(milliseconds) { currentTime += milliseconds; },
    stored() { return JSON.parse(JSON.stringify(stored)); },
  };
}

function unpack(value) {
  if (value && value.type === "dict") {
    return Object.fromEntries(value.entries.map(([key, entry]) => [key, unpack(entry)]));
  }
  if (value && value.type === "list") return value.items.map(unpack);
  return value;
}

test("priority flags are globally unique, composable, and never replace scalar urgency", () => {
  const flags = Object.values<number>(ASSEMBLY_REQUEST_PRIORITY_FLAG);
  assert.equal(new Set(flags).size, flags.length);
  for (const flag of flags) {
    assert.equal(flag > 0 && (flag & (flag - 1)) === 0, true);
  }
  assert.equal(flags.reduce((mask, flag) => mask | flag, 0), ASSEMBLY_REQUEST_PRIORITY_FLAG_MASK);
  const combined = ASSEMBLY_REQUEST_PRIORITY_FLAG.DEFENSE |
    ASSEMBLY_REQUEST_PRIORITY_FLAG.PLAYER_INITIATED;
  assert.equal(hasAllPriorityFlags(combined, ASSEMBLY_REQUEST_PRIORITY_FLAG.DEFENSE), true);
  assert.equal(hasAllPriorityFlags(combined, ASSEMBLY_REQUEST_PRIORITY_FLAG.LOGISTICS), false);
});

test("all deployed assembly types share one durable, priority-ordered queue", () => {
  const f = fixture();
  const first = f.runtime.createRequest(SOURCE, TURRET, "defense.acquire-target", {
    ownerID: OWNER,
    requestID: REQUEST_A,
    payload: { targetID: 99 },
    priority: ASSEMBLY_REQUEST_PRIORITY.NORMAL,
    priorityFlags: ASSEMBLY_REQUEST_PRIORITY_FLAG.DEFENSE |
      ASSEMBLY_REQUEST_PRIORITY_FLAG.PLAYER_INITIATED,
  });
  assert.equal(first.success, true, first.errorMsg);
  f.advance(10);
  const second = f.runtime.createRequest(SOURCE, STORAGE, "logistics.transfer", {
    ownerID: OWNER,
    requestID: REQUEST_B,
    payload: { typeID: 34, quantity: 10 },
    priority: ASSEMBLY_REQUEST_PRIORITY.CRITICAL,
    priorityFlags: ASSEMBLY_REQUEST_PRIORITY_FLAG.LOGISTICS,
  });
  assert.equal(second.success, true, second.errorMsg);

  const sourceQueue = f.runtime.listRequests(SOURCE, { ownerID: OWNER, role: "source" });
  assert.equal(sourceQueue.success, true, sourceQueue.errorMsg);
  assert.deepEqual(sourceQueue.data.map((request) => request.requestID), [REQUEST_B, REQUEST_A]);
  assert.equal(f.runtime.listRequests(TURRET, {
    ownerID: OWNER,
    role: "target",
    requiredPriorityFlags: ASSEMBLY_REQUEST_PRIORITY_FLAG.DEFENSE,
  }).data.length, 1);

  const restored = createSmartAssemblyRequestRuntime(f.options);
  assert.equal(restored.getRequest(REQUEST_A).data.payload.targetID, 99);
  assert.equal(restored.getRequest(REQUEST_B).data.requestType, "logistics.transfer");
});

test("request IDs are idempotent but reject a different command", () => {
  const f = fixture();
  const options = {
    ownerID: OWNER,
    requestID: REQUEST_A,
    expiresInMs: 60_000,
    payload: { quantity: 1, typeID: 34 },
    priority: ASSEMBLY_REQUEST_PRIORITY.HIGH,
    priorityFlags: ASSEMBLY_REQUEST_PRIORITY_FLAG.LOGISTICS,
  };
  const created = f.runtime.createRequest(SOURCE, STORAGE, "logistics.transfer", options);
  assert.equal(created.success, true);
  assert.equal(created.created, true);
  f.advance(250);
  const replay = f.runtime.createRequest(SOURCE, STORAGE, "logistics.transfer", {
    ...options,
    payload: { typeID: 34, quantity: 1 },
  });
  assert.equal(replay.success, true);
  assert.equal(replay.created, false);
  assert.equal(replay.data.createdAtMs, created.data.createdAtMs);
  const conflict = f.runtime.createRequest(SOURCE, STORAGE, "logistics.transfer", {
    ...options,
    payload: { typeID: 35, quantity: 1 },
  });
  assert.equal(conflict.success, false);
  assert.equal(conflict.errorMsg, "ASSEMBLY_REQUEST_ID_CONFLICT");
  assert.equal(f.runtime.listRequests(SOURCE, { ownerID: OWNER }).data.length, 1);
});

test("claims use expiring tokens and fulfillment signals both assemblies", () => {
  const f = fixture();
  const pushed: any[] = [];
  const unsubscribe = f.runtime.subscribeToSignals(SOURCE, (signal) => pushed.push(signal));
  assert.equal(f.runtime.createRequest(SOURCE, TURRET, "defense.acquire-target", {
    ownerID: OWNER,
    requestID: REQUEST_A,
  }).success, true);
  const claim = f.runtime.claimRequest(TURRET, REQUEST_A, {
    ownerID: OWNER,
    claimTtlMs: 1_000,
  });
  assert.equal(claim.success, true, claim.errorMsg);
  assert.equal(claim.data.status, "claimed");
  assert.match(claim.data.claimToken, /^[0-9a-f-]{36}$/u);

  const stale = f.runtime.fulfillRequest(TURRET, REQUEST_A, "stale", { targetID: 99 }, {
    ownerID: OWNER,
  });
  assert.equal(stale.success, false);
  assert.equal(stale.errorMsg, "ASSEMBLY_REQUEST_CLAIM_TOKEN_INVALID");
  const done = f.runtime.fulfillRequest(
    TURRET,
    REQUEST_A,
    claim.data.claimToken,
    { targetID: 99, locked: true },
    { ownerID: OWNER },
  );
  assert.equal(done.success, true, done.errorMsg);
  assert.equal(done.data.status, "fulfilled");
  assert.deepEqual(done.data.result, { targetID: 99, locked: true });
  assert.equal(done.data.claimToken, null);

  f.assemblies.get(TURRET).state.assemblyStatus = 1;
  const replay = f.runtime.fulfillRequest(
    TURRET,
    REQUEST_A,
    claim.data.claimToken,
    { locked: true, targetID: 99 },
    { ownerID: OWNER },
  );
  assert.equal(replay.success, true, replay.errorMsg);
  assert.equal(replay.completed, false);
  assert.equal(f.runtime.fulfillRequest(
    TURRET,
    REQUEST_A,
    claim.data.claimToken,
    { locked: false, targetID: 99 },
    { ownerID: OWNER },
  ).errorMsg, "ASSEMBLY_REQUEST_COMPLETION_CONFLICT");

  const sourceSignals = f.runtime.listSignals(SOURCE, { ownerID: OWNER });
  const targetSignals = f.runtime.listSignals(TURRET, { ownerID: OWNER });
  assert.deepEqual(sourceSignals.data.signals.map((signal) => signal.kind), [
    "created", "claimed", "fulfilled",
  ]);
  assert.deepEqual(targetSignals.data.signals, sourceSignals.data.signals);
  assert.deepEqual(sourceSignals.data.signals.map((signal) => signal.sequence), [1, 2, 3]);
  assert.deepEqual(pushed.map((signal) => signal.kind), ["created", "claimed", "fulfilled"]);
  unsubscribe();
});

test("operational signals are durable, idempotent, and preserve independent dimensions", () => {
  const f = fixture();
  const first = f.runtime.publishAssemblyStatusSignal(SOURCE, "network_node.resources", {
    fuel: { level: "low", low: true },
    power: { usageLevel: "medium", overLimit: false },
    activeFlags: ["FUEL_LOW", "POWER_USAGE_MEDIUM"],
  }, { ownerID: OWNER });
  assert.equal(first.success, true, first.errorMsg);
  assert.equal(first.changed, true);
  assert.equal(f.runtime.publishAssemblyStatusSignal(SOURCE, "network_node.resources", {
    activeFlags: ["FUEL_LOW", "POWER_USAGE_MEDIUM"],
    power: { overLimit: false, usageLevel: "medium" },
    fuel: { low: true, level: "low" },
  }, { ownerID: OWNER }).changed, false, "canonical equivalent state must not emit twice");

  const overloaded = f.runtime.publishAssemblyStatusSignal(SOURCE, "network_node.resources", {
    fuel: { level: "low", low: true },
    power: { usageLevel: "over_limit", overLimit: true },
    activeFlags: ["FUEL_LOW", "POWER_USAGE_OVER_LIMIT", "POWER_LIMIT_EXCEEDED"],
  }, { ownerID: OWNER });
  assert.equal(overloaded.changed, true);
  assert.equal(overloaded.data.revision, 2);
  assert.equal(overloaded.data.status.fuel.level, "low");
  assert.equal(overloaded.data.status.power.overLimit, true);
  assert.deepEqual(f.runtime.listSignals(SOURCE, { ownerID: OWNER }).data.signals
    .map(signal => signal.kind), ["status_changed", "status_changed"]);

  const restored = createSmartAssemblyRequestRuntime(f.options);
  const current = restored.getAssemblyOperationalStatus(SOURCE, {
    ownerID: OWNER,
    signalType: "network_node.resources",
  });
  assert.equal(current.success, true, current.errorMsg);
  assert.equal(current.data.status.power.usageLevel, "over_limit");
});

test("chain-linked requests cannot execute without verified creation and terminal proofs", () => {
  const f = fixture();
  const created = f.runtime.createRequest(SOURCE, TURRET, "defense.acquire-target", {
    ownerID: OWNER,
    requestID: REQUEST_A,
    _chainLinkRequired: true,
  });
  assert.equal(created.success, true);
  assert.equal(created.data.chainLink.status, "pending");
  assert.equal(f.runtime.claimRequest(TURRET, REQUEST_A, { ownerID: OWNER }).errorMsg,
    "ASSEMBLY_REQUEST_CHAIN_PROOF_REQUIRED");

  const creationProof = { chainID: "test-chain", attestationHash: "11".repeat(32) };
  const linked = f.runtime.attachCreationChainProof(REQUEST_A, creationProof);
  assert.equal(linked.success, true);
  assert.equal(linked.data.chainLink.status, "confirmed");
  assert.equal(f.runtime.claimRequest(TURRET, REQUEST_A, { ownerID: OWNER }).errorMsg,
    "ASSEMBLY_REQUEST_CHAIN_PROOF_REQUIRED");
  const claimed = f.runtime.claimRequest(TURRET, REQUEST_A, {
    ownerID: OWNER,
    _chainVerified: true,
  });
  assert.equal(claimed.success, true, claimed.errorMsg);
  assert.equal(f.runtime.fulfillRequest(TURRET, REQUEST_A, claimed.data.claimToken, { locked: true }, {
    ownerID: OWNER,
    _chainVerified: true,
  }).errorMsg, "ASSEMBLY_REQUEST_CHAIN_PROOF_REQUIRED");

  const completionProof = {
    chainID: "test-chain",
    previousAttestationHash: creationProof.attestationHash,
    attestationHash: "22".repeat(32),
  };
  const fulfilled = f.runtime.fulfillRequest(
    TURRET,
    REQUEST_A,
    claimed.data.claimToken,
    { locked: true },
    { ownerID: OWNER, _chainVerified: true, _completionProof: completionProof },
  );
  assert.equal(fulfilled.success, true, fulfilled.errorMsg);
  assert.equal(fulfilled.data.chainLink.status, "completed");
  assert.deepEqual(fulfilled.data.chainLink.completion, completionProof);
  assert.deepEqual(f.runtime.listSignals(SOURCE, { ownerID: OWNER }).data.signals
    .map(signal => signal.kind), ["created", "chain_linked", "claimed", "fulfilled"]);
});

test("expired claims requeue work and expired requests become terminal", () => {
  const f = fixture();
  assert.equal(f.runtime.createRequest(SOURCE, STORAGE, "production.run", {
    ownerID: OWNER,
    requestID: REQUEST_A,
    expiresInMs: 1_000,
    priorityFlags: ASSEMBLY_REQUEST_PRIORITY_FLAG.PRODUCTION,
  }).success, true);
  assert.equal(f.runtime.claimRequest(STORAGE, REQUEST_A, {
    ownerID: OWNER,
    claimTtlMs: 100,
  }).success, true);
  f.advance(101);
  assert.equal(f.runtime.getRequest(REQUEST_A).data.status, "queued");
  assert.equal(f.runtime.listSignals(STORAGE, { ownerID: OWNER }).data.signals.at(-1).kind,
    "claim_expired");
  const reclaimed = f.runtime.claimRequest(STORAGE, REQUEST_A, { ownerID: OWNER });
  assert.equal(reclaimed.success, true);
  assert.notEqual(reclaimed.data.claimToken, null);
  f.advance(900);
  assert.equal(f.runtime.getRequest(REQUEST_A).data.status, "expired");
  assert.equal(f.runtime.getRequest(REQUEST_A).data.claimToken, null);
  assert.equal(f.runtime.listSignals(SOURCE, { ownerID: OWNER }).data.signals.at(-1).kind,
    "expired");
});

test("ownership, online state, construction state, and priority flag allocation are enforced", () => {
  const f = fixture();
  assert.equal(f.runtime.createRequest(SOURCE, OTHER, "logistics.transfer", {
    ownerID: OWNER,
  }).errorMsg, "ASSEMBLY_REQUEST_OWNER_MISMATCH");
  assert.equal(f.runtime.createRequest(OFFLINE, STORAGE, "logistics.transfer", {
    ownerID: OWNER,
  }).errorMsg, "ASSEMBLY_OFFLINE");
  assert.equal(f.runtime.createRequest(SOURCE, BUILDING, "logistics.transfer", {
    ownerID: OWNER,
  }).errorMsg, "ASSEMBLY_UNDER_CONSTRUCTION");
  assert.equal(f.runtime.createRequest(SOURCE, OFFLINE, "maintenance.inspect", {
    ownerID: OWNER,
    requestID: REQUEST_A,
  }).success, true, "offline destinations may accumulate work");
  assert.equal(f.runtime.claimRequest(OFFLINE, REQUEST_A, { ownerID: OWNER }).errorMsg,
    "ASSEMBLY_OFFLINE");
  assert.equal(f.runtime.createRequest(SOURCE, STORAGE, "logistics.transfer", {
    ownerID: OWNER,
    requestID: REQUEST_B,
    priorityFlags: ASSEMBLY_REQUEST_PRIORITY_FLAG_MASK | (1 << 20),
  }).errorMsg, "ASSEMBLY_REQUEST_PRIORITY_FLAGS_INVALID");
  assert.equal(f.runtime.createRequest(SOURCE, STORAGE, "logistics.transfer", {
    ownerID: OWNER,
    requestID: REQUEST_B,
    priority: 999,
  }).errorMsg, "ASSEMBLY_REQUEST_PRIORITY_INVALID");
  assert.equal(f.runtime.listRequests(SOURCE, { ownerID: OTHER_OWNER }).errorMsg,
    "ASSEMBLY_ACCESS_DENIED");
});

test("registered assembly handlers claim and fulfill the next eligible request", async () => {
  const f = fixture();
  assert.equal(f.runtime.createRequest(SOURCE, STORAGE, "logistics.transfer", {
    ownerID: OWNER,
    requestID: REQUEST_A,
    payload: { quantity: 12, typeID: 34 },
    priority: ASSEMBLY_REQUEST_PRIORITY.HIGH,
    priorityFlags: ASSEMBLY_REQUEST_PRIORITY_FLAG.LOGISTICS,
  }).success, true);
  assert.equal(f.runtime.createRequest(SOURCE, STORAGE, "defense.scan", {
    ownerID: OWNER,
    requestID: REQUEST_B,
    priority: ASSEMBLY_REQUEST_PRIORITY.CRITICAL,
    priorityFlags: ASSEMBLY_REQUEST_PRIORITY_FLAG.DEFENSE,
  }).success, true);
  const seen: any[] = [];
  const unregister = f.runtime.registerHandler(
    "logistics.transfer",
    async (request) => {
      seen.push(request.payload);
      return { moved: request.payload.quantity };
    },
    { acceptedPriorityFlags: ASSEMBLY_REQUEST_PRIORITY_FLAG.LOGISTICS },
  );
  const processed = await f.runtime.processNextRequest(STORAGE, { ownerID: OWNER });
  assert.equal(processed.success, true, processed.errorMsg);
  assert.equal(processed.processed, true);
  assert.deepEqual(seen, [{ quantity: 12, typeID: 34 }]);
  assert.equal(f.runtime.getRequest(REQUEST_A).data.status, "fulfilled");
  assert.equal(f.runtime.getRequest(REQUEST_B).data.status, "queued");
  unregister();
  assert.equal((await f.runtime.processNextRequest(STORAGE, { ownerID: OWNER })).processed,
    false);
});

test("assembly removal cancels every pending source and destination request", () => {
  const f = fixture();
  assert.equal(f.runtime.createRequest(SOURCE, TURRET, "defense.scan", {
    ownerID: OWNER,
    requestID: REQUEST_A,
  }).success, true);
  assert.equal(f.runtime.createRequest(TURRET, STORAGE, "logistics.transfer", {
    ownerID: OWNER,
    requestID: REQUEST_B,
  }).success, true);
  assert.equal(f.runtime.createRequest(SOURCE, STORAGE, "production.run", {
    ownerID: OWNER,
    requestID: REQUEST_C,
  }).success, true);
  const cancelled = f.runtime.cancelRequestsForAssembly(TURRET, "ASSEMBLY_DISMANTLED");
  assert.equal(cancelled.success, true);
  assert.equal(cancelled.data.length, 2);
  assert.equal(f.runtime.getRequest(REQUEST_A).data.status, "cancelled");
  assert.equal(f.runtime.getRequest(REQUEST_B).data.status, "cancelled");
  assert.equal(f.runtime.getRequest(REQUEST_C).data.status, "queued");
});

test("native assembly RPC publishes the shared protocol and cannot enable cross-owner delivery", (t) => {
  const SmartAssemblyService = require("../src/services/frontier/smartAssemblyService");
  let captured = null;
  t.mock.method(requestRuntimeModule, "createRequest", (...args) => {
    captured = args;
    return {
      success: true,
      data: {
        requestID: REQUEST_A,
        sourceAssemblyID: SOURCE,
        targetAssemblyID: TURRET,
        status: "queued",
      },
    };
  });
  const service = new SmartAssemblyService();
  const session = { characterID: OWNER };
  const protocol = unpack(service.Handle_get_request_protocol());
  assert.equal(protocol.version, 2);
  assert.equal(protocol.priorities.CRITICAL, ASSEMBLY_REQUEST_PRIORITY.CRITICAL);
  assert.equal(protocol.priority_flags.LOGISTICS, ASSEMBLY_REQUEST_PRIORITY_FLAG.LOGISTICS);
  assert.equal(protocol.priority_flag_mask, ASSEMBLY_REQUEST_PRIORITY_FLAG_MASK);

  const result = unpack(service.Handle_create_request([
    SOURCE,
    TURRET,
    "logistics.transfer",
    {
      allowCrossOwner: true,
      ownerID: OTHER_OWNER,
      payload: { typeID: 34 },
      priorityFlags: ASSEMBLY_REQUEST_PRIORITY_FLAG.LOGISTICS,
      requestID: REQUEST_A,
    },
  ], session));
  assert.equal(result.requestID, REQUEST_A);
  assert.equal(captured[0], SOURCE);
  assert.equal(captured[1], TURRET);
  assert.equal(captured[2], "logistics.transfer");
  assert.equal(captured[3].ownerID, OWNER);
  assert.equal(captured[3].allowCrossOwner, false);
});

test("native RPC lifecycle persists through the real gameStore and generic construction state", (t) => {
  const database = require("../src/gameStore");
  const itemStore = require("../src/services/inventory/itemStore");
  const SmartAssemblyService = require("../src/services/frontier/smartAssemblyService");
  const previousItems = itemStore.getAllItems();
  const previousRequests = database.read("smartAssemblyRequests", "/");
  t.after(() => {
    itemStore._writeItemsForTest(previousItems);
    database.write(
      "smartAssemblyRequests",
      "/",
      previousRequests.success ? previousRequests.data : {},
    );
  });
  function row(itemID, assemblyTypeID) {
    return {
      itemID,
      ownerID: OWNER,
      typeID: assemblyTypeID,
      locationID: 30000004,
      singleton: 1,
      stacksize: 1,
      quantity: 1,
      customInfo: JSON.stringify({
        evejsFrontierConstruction: {
          activationCompleteAtMs: 0,
          assemblyStatus: 2,
          assemblyTypeID,
          completedAtMs: 1,
          ownerID: OWNER,
          solarSystemID: 30000004,
        },
      }),
    };
  }
  assert.equal(itemStore._writeItemsForTest({
    [SOURCE]: row(SOURCE, 88092),
    [TURRET]: row(TURRET, 88093),
  }), true);
  assert.equal(database.write("smartAssemblyRequests", "/", {}).success, true);

  const service = new SmartAssemblyService();
  const session = { characterID: OWNER };
  const created = unpack(service.Handle_create_request([
    SOURCE,
    TURRET,
    "defense.acquire-target",
    {
      payload: { targetID: 777 },
      priority: ASSEMBLY_REQUEST_PRIORITY.HIGH,
      priorityFlags: ASSEMBLY_REQUEST_PRIORITY_FLAG.DEFENSE,
      requestID: REQUEST_C,
    },
  ], session));
  assert.equal(created.status, "queued");
  const claimed = unpack(service.Handle_claim_request([
    TURRET,
    REQUEST_C,
    { claimTtlMs: 10_000 },
  ], session));
  assert.equal(claimed.status, "claimed");
  const fulfilled = unpack(service.Handle_fulfil_request([
    TURRET,
    REQUEST_C,
    claimed.claimToken,
    { lockedTargetID: 777 },
  ], session));
  assert.equal(fulfilled.status, "fulfilled");
  const sourceQueue = unpack(service.Handle_get_requests([
    SOURCE,
    { role: "source", statuses: ["fulfilled"] },
  ], session));
  assert.equal(sourceQueue.length, 1);
  assert.equal(sourceQueue[0].requestID, REQUEST_C);
  assert.deepEqual(sourceQueue[0].result, { lockedTargetID: 777 });
  assert.equal(database.read("smartAssemblyRequests", "/").data
    .requests[REQUEST_C].status, "fulfilled");
});
