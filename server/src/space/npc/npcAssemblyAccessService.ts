"use strict";

const accessRuntime = require("../../services/frontier/assemblyAccessRuntime");
const nativeNpcStore = require("./nativeNpcStore");
const {
  assertNoSensitiveNpcAssemblyData,
  createNpcAssemblyActorContext,
} = require("./npcAssemblyActorContext");

function toPositiveInt(value) {
  const numeric = Number(value);
  return Number.isSafeInteger(numeric) && numeric > 0 ? numeric : 0;
}

function npcActorForEntityID(entityID) {
  const entity = nativeNpcStore.getNativeEntity(toPositiveInt(entityID));
  const actor = createNpcAssemblyActorContext(entity);
  return {
    ...actor,
    incarnation: toPositiveInt(entity && entity.npcIncarnation),
  };
}

function safeNpcAccessOperation(input, operation) {
  try {
    assertNoSensitiveNpcAssemblyData(input, "npcAssemblyAccess");
    const actor = npcActorForEntityID(input && input.entityID);
    return operation(actor);
  } catch (error) {
    return {
      success: false as const,
      errorMsg: String(error && (error.code || error.message) || "NPC_ASSEMBLY_ACCESS_FAILED"),
    };
  }
}

function requestNpcAssemblyAccess(input: Record<string, any>) {
  return safeNpcAccessOperation(input, (actor) => {
    const result = accessRuntime.requestAccess(
      actor,
      input.assemblyID,
      input.capabilities,
      {
        requestID: input.requestID,
        idempotencyKey: input.idempotencyKey,
        reason: input.reason,
        expiresInMs: input.expiresInMs,
        grantExpiresInMs: input.grantExpiresInMs,
        grantExpiresAtMs: input.grantExpiresAtMs,
        delegable: input.delegable,
        delegationDepth: input.delegationDepth,
      },
    );
    if (!result.success) return result;
    return {
      ...result,
      data: {
        ...result.data,
        behaviorCheckpoint: {
          step: result.data.status === "requested" ? "awaiting-assembly-access" : "assembly-access-decided",
          assemblyID: toPositiveInt(input.assemblyID),
          accessRequestID: result.data.requestID,
          wakeEventKey: `assembly-access:${result.data.requestID}`,
        },
      },
    };
  });
}

function resolveNpcAssemblyAccess(input: Record<string, any>) {
  return safeNpcAccessOperation(input, (actor) => accessRuntime.resolveAccess(
    actor,
    input.assemblyID,
    input.capabilities || [],
  ));
}

function listNpcAssemblyAccessRequests(input: Record<string, any>) {
  return safeNpcAccessOperation(input, (actor) => accessRuntime.listRequests(
    actor,
    input.assemblyID,
    input.options || {},
  ));
}

function approveNpcAssemblyAccess(input: Record<string, any>) {
  return safeNpcAccessOperation(input, (actor) => accessRuntime.approveRequest(
    actor,
    input.assemblyID,
    input.requestID,
    input.options || {},
  ));
}

function denyNpcAssemblyAccess(input: Record<string, any>) {
  return safeNpcAccessOperation(input, (actor) => accessRuntime.denyRequest(
    actor,
    input.assemblyID,
    input.requestID,
    input.reason,
  ));
}

function cancelNpcAssemblyAccessRequest(input: Record<string, any>) {
  return safeNpcAccessOperation(input, (actor) => accessRuntime.cancelRequest(
    actor,
    input.assemblyID,
    input.requestID,
    input.reason,
  ));
}

function shareNpcAssemblyAccess(input: Record<string, any>) {
  return safeNpcAccessOperation(input, (actor) => accessRuntime.shareAccess(
    actor,
    input.assemblyID,
    input.recipient,
    input.capabilities,
    input.options || {},
  ));
}

function revokeNpcAssemblyAccess(input: Record<string, any>) {
  return safeNpcAccessOperation(input, (actor) => accessRuntime.revokeGrant(
    actor,
    input.assemblyID,
    input.grantID,
    { reason: input.reason },
  ));
}

function relinquishNpcAssemblyAccess(input: Record<string, any>) {
  return safeNpcAccessOperation(input, (actor) => accessRuntime.relinquishGrant(
    actor,
    input.assemblyID,
    input.grantID,
    input.reason,
  ));
}

function listNpcAssemblyAccessGrants(input: Record<string, any>) {
  return safeNpcAccessOperation(input, (actor) => accessRuntime.listGrants(
    actor,
    input.assemblyID,
    input.options || {},
  ));
}

module.exports = {
  requestNpcAssemblyAccess,
  resolveNpcAssemblyAccess,
  listNpcAssemblyAccessRequests,
  listNpcAssemblyAccessGrants,
  approveNpcAssemblyAccess,
  denyNpcAssemblyAccess,
  cancelNpcAssemblyAccessRequest,
  shareNpcAssemblyAccess,
  revokeNpcAssemblyAccess,
  relinquishNpcAssemblyAccess,
};
