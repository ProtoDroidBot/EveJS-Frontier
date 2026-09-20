"use strict";

const crypto = require("node:crypto");

const {
  deriveSuiTransponderCommitmentObjectId,
  parseSuiTransponderCommitmentObject,
  verifySuiTransponderCommitment,
} = require("../../services/frontier/suiTransponderCommitment");
const { suiGrpcClient } = require("../../services/frontier/suiGrpcClient");
const {
  normalizeNpcAssemblyActorContext,
} = require("./npcAssemblyActorContext");

const DEFAULT_RECEIPT_TTL_MS = 30_000;
const MAX_RECEIPT_TTL_MS = 5 * 60_000;
const receipts = new Map();

function positiveID(value, label) {
  const numeric = Number(value);
  if (!Number.isSafeInteger(numeric) || numeric <= 0) {
    throw Object.assign(new Error(`${label} must be a positive safe integer`), {
      code: "NPC_TRANSPONDER_BINDING_INVALID",
    });
  }
  return numeric;
}

function normalizeBinding(input) {
  const requestID = String(input && input.requestID || "").trim().toLowerCase();
  const requestType = String(input && input.requestType || "").trim().toLowerCase();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(requestID) ||
      !/^[a-z][a-z0-9]*(?:[._:/-][a-z0-9]+)*$/u.test(requestType) || requestType.length > 96) {
    throw Object.assign(new Error("Transponder receipt requires a valid request ID and request type"), {
      code: "NPC_TRANSPONDER_BINDING_INVALID",
    });
  }
  return Object.freeze({
    requestID,
    requestType,
    commandNodeID: positiveID(input.commandNodeID, "Command-node ID"),
    targetAssemblyID: positiveID(input.targetAssemblyID, "Target-assembly ID"),
  });
}

function bindingFingerprint(actor, binding) {
  return JSON.stringify([
    actor.actorID,
    actor.factionKey,
    binding.requestID,
    binding.requestType,
    binding.commandNodeID,
    binding.targetAssemblyID,
  ]);
}

function tokenHash(value) {
  return crypto.createHash("sha256").update(String(value || "")).digest("hex");
}

function pruneReceipts(nowMs) {
  for (const [key, receipt] of receipts.entries()) {
    if (receipt.expiresAtMs <= nowMs) receipts.delete(key);
  }
}

/**
 * Verify a freshly fetched Sui commitment and exchange the private code/salt
 * for a short-lived opaque capability. Neither private value enters a durable
 * job, assembly record, request payload, log, or this in-memory receipt store.
 */
function issueReceiptForChainObject(input: Record<string, any>) {
  const actor = normalizeNpcAssemblyActorContext(input && input.actor, { requireSui: true });
  const binding = normalizeBinding(input && input.binding);
  const state = parseSuiTransponderCommitmentObject(
    input && input.chainObject,
    input && input.world,
    { kind: "faction", factionKey: actor.factionKey },
  );
  if (state.revoked || state.scope.kind !== "faction" || state.scope.scopeId !== actor.factionKey) {
    return { success: false, errorMsg: "NPC_TRANSPONDER_MEMBERSHIP_REVOKED" };
  }
  const verified = verifySuiTransponderCommitment(state.commitment, {
    objectRegistryId: state.registryId,
    tenant: state.tenant,
    scope: { kind: "faction", factionKey: actor.factionKey },
    revision: state.revision,
    code: input.code,
    salt: input.salt,
  });
  if (!verified) return { success: false, errorMsg: "NPC_TRANSPONDER_MEMBERSHIP_INVALID" };

  const nowMs = Number.isFinite(Number(input.nowMs)) ? Number(input.nowMs) : Date.now();
  const requestedTtl = Math.trunc(Number(input.ttlMs) || DEFAULT_RECEIPT_TTL_MS);
  const ttlMs = Math.max(1_000, Math.min(MAX_RECEIPT_TTL_MS, requestedTtl));
  pruneReceipts(nowMs);
  const receiptToken = crypto.randomBytes(32).toString("base64url");
  const publicMembership = Object.freeze({
    verified: true,
    commitmentID: state.objectId,
    revision: state.revision,
    scope: "faction",
    factionKey: actor.factionKey,
  });
  receipts.set(tokenHash(receiptToken), {
    actorID: actor.actorID,
    factionKey: actor.factionKey,
    fingerprint: bindingFingerprint(actor, binding),
    expiresAtMs: nowMs + ttlMs,
    publicMembership,
    firstUsedAtMs: null,
  });
  return {
    success: true,
    data: { receiptToken, expiresAtMs: nowMs + ttlMs, membership: { ...publicMembership } },
  };
}

/**
 * Read the derived commitment object directly from Sui before issuing a
 * capability. A caller cannot substitute a cached or self-authored object.
 */
async function issueNpcTransponderMembershipReceipt(input: Record<string, any>,
  options: Record<string, any> = {}) {
  try {
    const actor = normalizeNpcAssemblyActorContext(input && input.actor, { requireSui: true });
    const scope = { kind: "faction", factionKey: actor.factionKey };
    const objectId = deriveSuiTransponderCommitmentObjectId(input.world, scope);
    const client = options.client || suiGrpcClient;
    const response = await client.getObject({
      objectId,
      include: { json: true },
    });
    if (!response || !response.object) {
      return { success: false, errorMsg: "NPC_TRANSPONDER_CHAIN_STATE_UNAVAILABLE" };
    }
    return issueReceiptForChainObject({
      ...input,
      actor,
      chainObject: response.object,
    });
  } catch (error) {
    return {
      success: false,
      errorMsg: String(error && error.code || "NPC_TRANSPONDER_CHAIN_STATE_INVALID"),
    };
  }
}

/** Validate the opaque capability without ever accepting caller-asserted membership. */
function authorizeNpcTransponderMembershipReceipt(receiptToken, actorInput,
  bindingInput, options: Record<string, any> = {}) {
  const actor = normalizeNpcAssemblyActorContext(actorInput, { requireSui: true });
  const binding = normalizeBinding(bindingInput);
  const nowMs = Number.isFinite(Number(options.nowMs)) ? Number(options.nowMs) : Date.now();
  pruneReceipts(nowMs);
  const key = tokenHash(receiptToken);
  const receipt = receipts.get(key);
  if (!receipt || receipt.expiresAtMs <= nowMs || receipt.actorID !== actor.actorID ||
      receipt.factionKey !== actor.factionKey ||
      receipt.fingerprint !== bindingFingerprint(actor, binding)) {
    return { success: false, errorMsg: "NPC_TRANSPONDER_MEMBERSHIP_REQUIRED" };
  }
  // Keep a used receipt until expiry so an idempotent retry of this exact
  // request survives a transient Sui attestation failure. Its binding makes
  // it unusable for any other command, target, request type, or NPC.
  receipt.firstUsedAtMs ||= nowMs;
  return { success: true, data: { ...receipt.publicMembership } };
}

module.exports = {
  issueNpcTransponderMembershipReceipt,
  authorizeNpcTransponderMembershipReceipt,
  _testing: {
    issueReceiptForChainObject,
    normalizeBinding,
    resetReceipts() { receipts.clear(); },
    receiptCount() { return receipts.size; },
  },
};
