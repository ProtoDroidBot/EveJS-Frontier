"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  ASSEMBLY_ACCESS_CAPABILITY: CAP,
  createAssemblyAccessRuntime,
  normalizePrincipal,
} = require("../src/services/frontier/assemblyAccessRuntime");

const ASSEMBLY = 5_100_000_001;
const SMART_ASSEMBLY = 5_100_000_002;
const OWNER = "entity:player:140000001";
const ALICE = "entity:player:140000002";
const BOB = "entity:player:140000003";
const EVE = "entity:player:140000004";
const TRIBE = "tribe:990001";

const IDS = [
  "11111111-1111-4111-8111-111111111111",
  "22222222-2222-4222-8222-222222222222",
  "33333333-3333-4333-8333-333333333333",
  "44444444-4444-4444-8444-444444444444",
  "55555555-5555-4555-8555-555555555555",
  "66666666-6666-4666-8666-666666666666",
  "77777777-7777-4777-8777-777777777777",
  "88888888-8888-4888-8888-888888888888",
];

function fixture() {
  let currentTime = 1_000_000;
  let stored = {};
  let nextID = 0;
  let nextToken = 1;
  const scopes = new Map([
    [OWNER, [OWNER]],
    [ALICE, [ALICE]],
    [BOB, [BOB]],
    [EVE, [EVE]],
  ]);
  const assemblies = new Map([
    [ASSEMBLY, {
      itemID: ASSEMBLY,
      ownerID: 140000001,
      ownerPrincipal: OWNER,
      assemblyStatus: 2,
      assemblyTypeID: 87119,
      createOnChain: false,
    }],
    [SMART_ASSEMBLY, {
      itemID: SMART_ASSEMBLY,
      ownerID: 140000001,
      ownerPrincipal: OWNER,
      assemblyStatus: 2,
      assemblyTypeID: 88092,
      createOnChain: true,
    }],
  ]);
  const repository = {
    ensureTable() { return { success: true }; },
    read() { return { success: true, data: JSON.parse(JSON.stringify(stored)) }; },
    write(_table, _path, value) {
      stored = JSON.parse(JSON.stringify(value));
      return { success: true };
    },
  };
  const options = {
    repository,
    now: () => currentTime,
    randomUUID: () => IDS[nextID++],
    randomBytes: () => Buffer.alloc(32, nextToken++),
    findAssembly: (itemID) => assemblies.get(Number(itemID)) || null,
    resolveSubject(actor) {
      const principal = normalizePrincipal(actor && actor.principal || actor);
      return principal && scopes.has(principal)
        ? { success: true, data: { principal, scopes: scopes.get(principal) } }
        : { success: false, errorMsg: "ASSEMBLY_ACCESS_SUBJECT_NOT_FOUND" };
    },
  };
  return {
    runtime: createAssemblyAccessRuntime(options),
    options,
    scopes,
    advance(ms) { currentTime += ms; },
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

test("entity requests survive restart and owner approval/revocation changes policy revision", () => {
  const f = fixture();
  const requested = f.runtime.requestAccess(ALICE, ASSEMBLY, [CAP.GUI_VIEW, CAP.OPERATE], {
    requestID: IDS[0],
    idempotencyKey: "alice-use-assembly",
    expiresInMs: 10_000,
    grantExpiresInMs: 20_000,
  });
  assert.equal(requested.success, true, requested.errorMsg);
  assert.equal(requested.data.status, "requested");
  assert.equal(f.runtime.resolveAccess(ALICE, ASSEMBLY, [CAP.GUI_VIEW]).errorMsg,
    "ASSEMBLY_ACCESS_DENIED");

  const approved = f.runtime.approveRequest(OWNER, ASSEMBLY, IDS[0], {
    grantID: IDS[1],
  });
  assert.equal(approved.success, true, approved.errorMsg);
  assert.equal(approved.data.grant.status, "active");
  assert.equal(approved.data.grant.policyRevision, 1);

  const restored = createAssemblyAccessRuntime(f.options);
  const access = restored.resolveAccess(ALICE, ASSEMBLY, [CAP.GUI_VIEW, CAP.OPERATE]);
  assert.equal(access.success, true, access.errorMsg);
  assert.equal(access.data.isOwner, false);
  assert.equal(restored.revokeGrant(EVE, ASSEMBLY, IDS[1]).errorMsg,
    "ASSEMBLY_ACCESS_REVOKE_DENIED");
  const revoked = restored.revokeGrant(OWNER, ASSEMBLY, IDS[1], { reason: "rotation" });
  assert.equal(revoked.success, true, revoked.errorMsg);
  assert.equal(revoked.data.policyRevision, 2);
  assert.equal(restored.resolveAccess(ALICE, ASSEMBLY, [CAP.GUI_VIEW]).errorMsg,
    "ASSEMBLY_ACCESS_DENIED");
});

test("idempotency replays exact requests and shares but rejects changed bindings", () => {
  const f = fixture();
  const request = {
    requestID: IDS[0], idempotencyKey: "request-key", expiresInMs: 10_000,
    grantExpiresInMs: 20_000,
  };
  assert.equal(f.runtime.requestAccess(ALICE, ASSEMBLY, [CAP.GUI_VIEW], request).created, true);
  f.advance(50);
  assert.equal(f.runtime.requestAccess(ALICE, ASSEMBLY, [CAP.GUI_VIEW], {
    ...request, requestID: IDS[1],
  }).created, false);
  assert.equal(f.runtime.requestAccess(ALICE, ASSEMBLY, [CAP.OPERATE], request).errorMsg,
    "ASSEMBLY_ACCESS_IDEMPOTENCY_CONFLICT");

  const share = {
    grantID: IDS[2], idempotencyKey: "share-key", expiresInMs: 10_000,
  };
  assert.equal(f.runtime.shareAccess(OWNER, ASSEMBLY, BOB, [CAP.GUI_VIEW], share).created, true);
  f.advance(50);
  assert.equal(f.runtime.shareAccess(OWNER, ASSEMBLY, BOB, [CAP.GUI_VIEW], share).created, false);
  assert.equal(f.runtime.shareAccess(OWNER, ASSEMBLY, BOB, [CAP.OPERATE], share).errorMsg,
    "ASSEMBLY_ACCESS_IDEMPOTENCY_CONFLICT");
});

test("tribe access follows current membership and one member cannot revoke the group grant", () => {
  const f = fixture();
  f.scopes.set(ALICE, [ALICE, TRIBE]);
  f.scopes.set(BOB, [BOB, TRIBE]);
  const grant = f.runtime.shareAccess(OWNER, ASSEMBLY, TRIBE,
    [CAP.GUI_VIEW, CAP.INVENTORY_DEPOSIT], {
      grantID: IDS[0], idempotencyKey: "tribe-logistics", expiresInMs: 10_000,
    });
  assert.equal(grant.success, true, grant.errorMsg);
  assert.equal(f.runtime.resolveAccess(ALICE, ASSEMBLY, [CAP.INVENTORY_DEPOSIT]).success, true);
  assert.equal(f.runtime.resolveAccess(BOB, ASSEMBLY, [CAP.GUI_VIEW]).success, true);
  assert.equal(f.runtime.relinquishGrant(ALICE, ASSEMBLY, IDS[0]).errorMsg,
    "ASSEMBLY_ACCESS_REVOKE_DENIED");

  f.scopes.set(ALICE, [ALICE]);
  assert.equal(f.runtime.resolveAccess(ALICE, ASSEMBLY, [CAP.GUI_VIEW]).errorMsg,
    "ASSEMBLY_ACCESS_DENIED");
  assert.equal(f.runtime.resolveAccess(BOB, ASSEMBLY, [CAP.GUI_VIEW]).success, true);
});

test("delegation cannot amplify capabilities, expiry, or depth and depends on its parent", () => {
  const f = fixture();
  const manager = f.runtime.shareAccess(OWNER, ASSEMBLY, ALICE,
    [CAP.GUI_VIEW, CAP.OPERATE, CAP.MANAGE_ACCESS], {
      grantID: IDS[0], idempotencyKey: "manager", expiresInMs: 20_000,
      delegable: true, delegationDepth: 2,
    });
  assert.equal(manager.success, true, manager.errorMsg);
  const delegated = f.runtime.shareAccess(ALICE, ASSEMBLY, BOB,
    [CAP.GUI_VIEW, CAP.OPERATE], {
      grantID: IDS[1], idempotencyKey: "delegate", expiresInMs: 10_000,
      delegable: true, delegationDepth: 1,
    });
  assert.equal(delegated.success, true, delegated.errorMsg);
  assert.equal(delegated.data.parentGrantID, IDS[0]);
  assert.equal(f.runtime.resolveAccess(BOB, ASSEMBLY, [CAP.OPERATE]).success, true);
  assert.equal(f.runtime.shareAccess(ALICE, ASSEMBLY, EVE, [CAP.CONFIGURE], {
    grantID: IDS[2], idempotencyKey: "amplify", expiresInMs: 10_000,
  }).errorMsg, "ASSEMBLY_ACCESS_MANAGE_DENIED");
  assert.equal(f.runtime.shareAccess(ALICE, ASSEMBLY, EVE, [CAP.GUI_VIEW], {
    grantID: IDS[3], idempotencyKey: "depth", expiresInMs: 10_000,
    delegable: true, delegationDepth: 2,
  }).errorMsg, "ASSEMBLY_ACCESS_DELEGATION_INVALID");

  assert.equal(f.runtime.revokeGrant(OWNER, ASSEMBLY, IDS[0]).success, true);
  assert.equal(f.runtime.resolveAccess(BOB, ASSEMBLY, [CAP.OPERATE]).errorMsg,
    "ASSEMBLY_ACCESS_DENIED", "a child grant cannot outlive a revoked parent");
});

test("GUI sessions are actor/session bound and invalidated immediately by policy changes", () => {
  const f = fixture();
  assert.equal(f.runtime.shareAccess(OWNER, ASSEMBLY, ALICE, [CAP.GUI_VIEW, CAP.OPERATE], {
    grantID: IDS[0], idempotencyKey: "gui", expiresInMs: 10_000,
  }).success, true);
  const opened = f.runtime.issueGuiSession(ALICE, ASSEMBLY, {
    sessionBinding: "session-a", expiresInMs: 1_000,
  });
  assert.equal(opened.success, true, opened.errorMsg);
  assert.equal(f.runtime.validateGuiSession(opened.data.token, ALICE, ASSEMBLY, CAP.OPERATE, {
    sessionBinding: "session-a",
  }).success, true);
  assert.equal(f.runtime.validateGuiSession(opened.data.token, ALICE, ASSEMBLY, CAP.OPERATE, {
    sessionBinding: "session-b",
  }).errorMsg, "ASSEMBLY_GUI_SESSION_MISMATCH");

  assert.equal(f.runtime.revokeGrant(OWNER, ASSEMBLY, IDS[0]).success, true);
  assert.equal(f.runtime.validateGuiSession(opened.data.token, ALICE, ASSEMBLY, CAP.GUI_VIEW, {
    sessionBinding: "session-a",
  }).errorMsg, "ASSEMBLY_GUI_SESSION_STALE");
});

test("expiry is reconciled durably for requests and grants", () => {
  const f = fixture();
  assert.equal(f.runtime.requestAccess(ALICE, ASSEMBLY, [CAP.GUI_VIEW], {
    requestID: IDS[0], idempotencyKey: "expire-request",
    expiresInMs: 100, grantExpiresInMs: 1_000,
  }).success, true);
  assert.equal(f.runtime.shareAccess(OWNER, ASSEMBLY, BOB, [CAP.GUI_VIEW], {
    grantID: IDS[1], idempotencyKey: "expire-grant", expiresInMs: 100,
  }).success, true);
  f.advance(101);
  assert.equal(f.runtime.listRequests(ALICE, ASSEMBLY).data[0].status, "expired");
  assert.equal(f.runtime.resolveAccess(BOB, ASSEMBLY, [CAP.GUI_VIEW]).errorMsg,
    "ASSEMBLY_ACCESS_DENIED");
  assert.equal(f.stored().grants[IDS[1]].status, "expired");
});

test("assembly removal cancels pending requests and revokes active local grants", () => {
  const f = fixture();
  assert.equal(f.runtime.requestAccess(ALICE, ASSEMBLY, [CAP.GUI_VIEW], {
    requestID: IDS[0], idempotencyKey: "removed-request", expiresInMs: 10_000,
    grantExpiresInMs: 20_000,
  }).success, true);
  assert.equal(f.runtime.shareAccess(OWNER, ASSEMBLY, BOB, [CAP.GUI_VIEW], {
    grantID: IDS[1], idempotencyKey: "removed-grant", expiresInMs: 20_000,
  }).success, true);
  const cleanup = f.runtime.cancelRequestsForAssembly(ASSEMBLY, "ASSEMBLY_REMOVED");
  assert.equal(cleanup.success, true, cleanup.errorMsg);
  assert.equal(f.stored().requests[IDS[0]].status, "cancelled");
  assert.equal(f.stored().grants[IDS[1]].status, "revoked");
  assert.equal(f.runtime.resolveAccess(BOB, ASSEMBLY, [CAP.GUI_VIEW]).errorMsg,
    "ASSEMBLY_ACCESS_DENIED");
});

test("smart-assembly grants fail closed until chain authority is verified", async () => {
  const f = fixture();
  const runtime = createAssemblyAccessRuntime({
    ...f.options,
    verifyChainGrant: async (_grant, proof) => proof && proof.digest === "0xconfirmed",
  });
  const grant = runtime.shareAccess(OWNER, SMART_ASSEMBLY, ALICE, [CAP.GUI_VIEW], {
    grantID: IDS[0], idempotencyKey: "smart-gui", expiresInMs: 10_000,
  });
  assert.equal(grant.success, true, grant.errorMsg);
  assert.equal(grant.data.authority, "local_projection_pending_chain");
  assert.equal(runtime.resolveAccess(ALICE, SMART_ASSEMBLY, [CAP.GUI_VIEW]).errorMsg,
    "ASSEMBLY_ACCESS_DENIED");
  assert.equal((await runtime.confirmGrantChainAuthority(IDS[0], {
    digest: "wrong",
  })).errorMsg, "ASSEMBLY_ACCESS_CHAIN_PROOF_INVALID");
  const confirmed = await runtime.confirmGrantChainAuthority(IDS[0], {
    digest: "0xconfirmed",
  });
  assert.equal(confirmed.success, true, confirmed.errorMsg);
  assert.equal(confirmed.data.authority, "sui_confirmed");
  assert.equal(runtime.resolveAccess(ALICE, SMART_ASSEMBLY, [CAP.GUI_VIEW]).success, true);
});

test("native access RPC derives the requester from the authenticated session", (t) => {
  const accessModule = require("../src/services/frontier/assemblyAccessRuntime");
  const SmartAssemblyService = require("../src/services/frontier/smartAssemblyService");
  let captured = null;
  t.mock.method(accessModule, "requestAccess", (...args) => {
    captured = args;
    return {
      success: true,
      data: {
        requestID: IDS[0],
        requesterPrincipal: ALICE,
        recipientPrincipal: ALICE,
        status: "requested",
      },
    };
  });
  const service = new SmartAssemblyService();
  const result = unpack(service.Handle_request_assembly_access([
    ASSEMBLY,
    [CAP.GUI_VIEW],
    {
      actorID: 140000004,
      requesterPrincipal: EVE,
      idempotencyKey: "rpc-request",
    },
  ], { characterID: 140000002, corporationID: 990001 }));
  assert.equal(result.requesterPrincipal, ALICE);
  assert.deepEqual(captured[0], {
    kind: "player",
    actorID: 140000002,
    tribeID: 990001,
  });
  assert.equal(captured[1], ASSEMBLY);
  assert.deepEqual(captured[2], [CAP.GUI_VIEW]);
});

test("default runtime persists local assembly grants through the owned game-store table", (t) => {
  const database = require("../src/gameStore");
  const itemStore = require("../src/services/inventory/itemStore");
  const accessModule = require("../src/services/frontier/assemblyAccessRuntime");
  const previousItems = itemStore.getAllItems();
  const previousAccess = database.read("assemblyAccessPolicies", "/");
  t.after(() => {
    itemStore._writeItemsForTest(previousItems);
    database.write("assemblyAccessPolicies", "/", previousAccess.success ? previousAccess.data : {});
  });
  assert.equal(itemStore._writeItemsForTest({
    [ASSEMBLY]: {
      itemID: ASSEMBLY,
      ownerID: 140000001,
      typeID: 87119,
      locationID: 30000004,
      singleton: 1,
      stacksize: 1,
      quantity: 1,
      customInfo: JSON.stringify({
        evejsFrontierConstruction: {
          activationCompleteAtMs: 0,
          assemblyStatus: 2,
          assemblyTypeID: 87119,
          completedAtMs: 1,
          ownerID: 140000001,
          solarSystemID: 30000004,
        },
      }),
    },
  }), true);
  assert.equal(database.write("assemblyAccessPolicies", "/", {}).success, true);

  const grant = accessModule.shareAccess(OWNER, ASSEMBLY, ALICE, [CAP.GUI_VIEW], {
    grantID: IDS[7], idempotencyKey: "real-store-grant", expiresInMs: 10_000,
  });
  assert.equal(grant.success, true, grant.errorMsg);
  const persisted = database.read("assemblyAccessPolicies", "/");
  assert.equal(persisted.success, true);
  assert.equal(persisted.data.grants[IDS[7]].recipientPrincipal, ALICE);
  assert.equal(accessModule.resolveAccess(ALICE, ASSEMBLY, [CAP.GUI_VIEW]).success, true);
});
