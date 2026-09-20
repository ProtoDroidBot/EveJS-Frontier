import assert = require("node:assert/strict");
import { test } from "node:test";
import { normalizeSuiAddress } from "@mysten/sui/utils";

import {
  createSuiAssemblyAccessCharacterDelegationTransaction,
  createSuiAssemblyAccessCharacterRevokeTransaction,
  createSuiAssemblyAccessGrantVerifier,
  createSuiAssemblyAccessNpcDelegationTransaction,
  createSuiAssemblyAccessNpcRevokeTransaction,
  createSuiAssemblyCrossOwnerTransferTransaction,
  deriveSuiAssemblyAccessGrantId,
  deriveSuiAssemblyAccessPolicyId,
  deriveSuiAssemblyObjectId,
  normalizeSuiAssemblyAccessPrincipal,
  parseSuiAssemblyAccessGrantObject,
  parseSuiAssemblyAccessPolicyObject,
  suiAssemblyAccessCapabilityMask,
  verifySuiAssemblyCustodyProof,
  type SuiAssemblyAccessWorld,
} from "../src/services/frontier/suiAssemblyAccess";

const addr = (value: number) => normalizeSuiAddress(`0x${value.toString(16)}`);
const world: SuiAssemblyAccessWorld = {
  packageId: addr(10),
  typeOrigin: addr(9),
  worldPackageId: addr(8),
  objectRegistryId: addr(2),
  tenant: "dev",
};
const itemId = 5_100_000_001;
const grantId = "11111111-1111-4111-8111-111111111111";
const operationId = "22222222-2222-4222-8222-222222222222";

function sharedObject(objectId: string, type: string, fields: Record<string, any>) {
  return { data: { objectId, type, owner: { $kind: "Shared" }, content: { type, fields } } };
}

function policyObject() {
  const objectId = deriveSuiAssemblyAccessPolicyId(world, itemId);
  return sharedObject(objectId, `${world.typeOrigin}::assembly_access::AssemblyAccessPolicy`, {
    registry_id: world.objectRegistryId,
    assembly_id: deriveSuiAssemblyObjectId(world, itemId),
    owner_cap_id: addr(40),
    revision: "2",
  });
}

function grantObject(overrides: Record<string, any> = {}) {
  const objectId = deriveSuiAssemblyAccessGrantId(world, itemId, grantId);
  return sharedObject(objectId, `${world.typeOrigin}::assembly_access::AssemblyAccessGrant`, {
    registry_id: world.objectRegistryId,
    policy_id: deriveSuiAssemblyAccessPolicyId(world, itemId),
    assembly_id: deriveSuiAssemblyObjectId(world, itemId),
    grant_id: [...Buffer.from(grantId.replaceAll("-", ""), "hex")],
    recipient_kind: 1,
    recipient_id: "140000002",
    capabilities: "13",
    grantor_kind: 1,
    grantor_id: "140000001",
    parent_grant_id: { vec: [] },
    expires_at_ms: "2000000",
    delegable: false,
    delegation_depth: 0,
    revision: "1",
    policy_revision: "2",
    revoked: false,
    ...overrides,
  });
}

test("assembly access IDs use the policy type origin and bind grants to policy plus UUID", () => {
  const policy = deriveSuiAssemblyAccessPolicyId(world, itemId);
  const grant = deriveSuiAssemblyAccessGrantId(world, itemId, grantId);
  assert.notEqual(policy, grant);
  assert.equal(deriveSuiAssemblyAccessPolicyId({ ...world, packageId: addr(11) }, itemId), policy);
  assert.notEqual(deriveSuiAssemblyAccessPolicyId({ ...world, typeOrigin: addr(12) }, itemId), policy);
  assert.notEqual(deriveSuiAssemblyAccessGrantId(world, itemId,
    "33333333-3333-4333-8333-333333333333"), grant);
});

test("policy and grant parsing rejects look-alike types and mismatched derived IDs", () => {
  const policy = parseSuiAssemblyAccessPolicyObject(policyObject(), world, itemId);
  const grant = parseSuiAssemblyAccessGrantObject(grantObject(), world, itemId, grantId);
  assert.equal(policy.assemblyId, grant.assemblyId);
  assert.deepEqual(grant.capabilities, ["gui.view", "inventory.deposit", "inventory.withdraw"]);
  assert.equal(grant.recipient.canonical, "entity:player:140000002");
  assert.equal(grant.parentGrantId, null);
  assert.throws(() => parseSuiAssemblyAccessGrantObject(
    grantObject({ assembly_id: addr(99) }), world, itemId, grantId));
  assert.throws(() => parseSuiAssemblyAccessPolicyObject({
    ...policyObject(), data: { ...policyObject().data, owner: { AddressOwner: addr(1) } },
  }, world, itemId));
});

test("grant verifier reads derived shared objects and rejects stale or mismatched authority", async () => {
  const objects = new Map([
    [deriveSuiAssemblyAccessPolicyId(world, itemId), policyObject()],
    [deriveSuiAssemblyAccessGrantId(world, itemId, grantId), grantObject()],
  ]);
  const verifier = createSuiAssemblyAccessGrantVerifier({
    world,
    now: () => 1_000_000,
    client: { async getObject({ id }) { return objects.get(id); } } as any,
  });
  const local = {
    assemblyID: itemId,
    grantID: grantId,
    recipientPrincipal: "entity:player:140000002",
    grantorPrincipal: "entity:player:140000001",
    capabilities: ["gui.view", "inventory.deposit", "inventory.withdraw"],
    parentGrantID: null,
    expiresAtMs: 2_000_000,
    delegable: false,
    delegationDepth: 0,
  };
  assert.equal(await verifier(local, {}), true);
  assert.equal(await verifier({ ...local, capabilities: ["gui.view"] }, {}), false);
  objects.set(deriveSuiAssemblyAccessGrantId(world, itemId, grantId), grantObject({ revoked: true }));
  assert.equal(await verifier(local, {}), false);
});

test("transaction builders forbid delegated custody and include operation-bound cross-owner calls", () => {
  assert.equal(normalizeSuiAssemblyAccessPrincipal("faction:0-angels").kind, 4);
  assert.equal(suiAssemblyAccessCapabilityMask(["gui.view", "manage_access"]), 33n);
  assert.throws(() => createSuiAssemblyAccessCharacterDelegationTransaction({
    world, policyObjectId: addr(30), parentGrantObjectId: addr(31), characterObjectId: addr(32),
    grantId, recipientPrincipal: "tribe:101", capabilities: ["inventory.withdraw"],
    expiresAtMs: 2_000_000, delegationDepth: 0,
  }));
  const transaction = createSuiAssemblyCrossOwnerTransferTransaction({
    world,
    sourcePolicyObjectId: addr(30), sourceGrantObjectId: addr(31), sourceStorageObjectId: addr(32),
    destinationPolicyObjectId: addr(33), destinationGrantObjectId: addr(34),
    destinationStorageObjectId: addr(35), characterObjectId: addr(36), operationId,
    typeId: 77818, quantity: 9,
  });
  const call: any = transaction.getData().commands[0];
  assert.equal(call.MoveCall.package, world.packageId);
  assert.equal(call.MoveCall.module, "assembly_access");
  assert.equal(call.MoveCall.function, "move_open_between_storage_units");
  assert.equal(call.MoveCall.arguments.length, 11);
  const npcTransaction = createSuiAssemblyCrossOwnerTransferTransaction({
    world,
    sourcePolicyObjectId: addr(30), sourceGrantObjectId: addr(31), sourceStorageObjectId: addr(32),
    destinationPolicyObjectId: addr(33), destinationGrantObjectId: addr(34),
    destinationStorageObjectId: addr(35), characterObjectId: addr(36),
    npcProfileObjectId: addr(37), operationId, typeId: 77818, quantity: 9,
  });
  const npcCall: any = npcTransaction.getData().commands[0];
  assert.equal(npcCall.MoveCall.function, "move_open_between_storage_units_by_npc");
  assert.equal(npcCall.MoveCall.arguments.length, 12);
  const npcDelegation: any = createSuiAssemblyAccessNpcDelegationTransaction({
    world, policyObjectId: addr(30), parentGrantObjectId: addr(31), npcProfileObjectId: addr(37),
    grantId, recipientPrincipal: "entity:player:140000002", capabilities: ["gui.view"],
    expiresAtMs: 2_000_000, delegationDepth: 0,
  }).getData().commands[0];
  assert.equal(npcDelegation.MoveCall.function, "delegate_by_npc");
  const characterRevoke: any = createSuiAssemblyAccessCharacterRevokeTransaction({
    world, policyObjectId: addr(30), grantObjectId: addr(31), characterObjectId: addr(36),
    expectedPolicyRevision: 2, expectedGrantRevision: 1,
  }).getData().commands[0];
  assert.equal(characterRevoke.MoveCall.function, "revoke_by_character");
  const npcRevoke: any = createSuiAssemblyAccessNpcRevokeTransaction({
    world, policyObjectId: addr(30), grantObjectId: addr(31), npcProfileObjectId: addr(37),
    expectedPolicyRevision: 2, expectedGrantRevision: 1,
  }).getData().commands[0];
  assert.equal(npcRevoke.MoveCall.function, "revoke_by_npc");
});

test("custody proof is bound to finalized event operation, direction, actors and quantities", async () => {
  const source = 5_100_000_001;
  const destination = 5_100_000_002;
  const actor = 140000002;
  const event = {
    type: `${world.typeOrigin}::assembly_access::AssemblyCustodyTransferred`,
    parsedJson: {
      operation_id: [...Buffer.from(operationId.replaceAll("-", ""), "hex")],
      custody_kind: 3,
      source_assembly_id: deriveSuiAssemblyObjectId(world, source),
      destination_assembly_id: deriveSuiAssemblyObjectId(world, destination),
      actor_character_id: deriveSuiAssemblyObjectId(world, actor),
      type_id: "77818",
      quantity: 9,
    },
  };
  const client = { async getTransactionBlock() {
    return { effects: { status: { status: "success" } }, events: [event] };
  } };
  const proof = {
    digest: "4".repeat(44), operationId, custodyKind: 3 as const,
    sourceAssemblyItemId: source, destinationAssemblyItemId: destination,
    actorCharacterId: actor, typeId: 77818, quantity: 9,
  };
  assert.equal(await verifySuiAssemblyCustodyProof({ client, world, proof }), true);
  assert.equal(await verifySuiAssemblyCustodyProof({
    client, world, proof: { ...proof, quantity: 10 },
  }), false);
});
