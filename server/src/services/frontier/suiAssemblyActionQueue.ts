import { createHash } from "node:crypto";
import { bcs } from "@mysten/sui/bcs";
import { Transaction } from "@mysten/sui/transactions";
import {
  deriveObjectID,
  normalizeSuiAddress,
  SUI_CLOCK_OBJECT_ID,
} from "@mysten/sui/utils";

type ActionBinding = Readonly<{
  module: string;
  objectType: string;
  keyType: string;
  queueKeyType: string | null;
}>;

const CANONICAL_ACTION_BINDING: ActionBinding = Object.freeze({
  module: "action_queue",
  objectType: "Action",
  keyType: "ActionKey",
  queueKeyType: "AssemblyQueueKey",
});
const LEGACY_ACTION_BINDING: ActionBinding = Object.freeze({
  module: "assembly_access",
  objectType: "AssemblyAction",
  keyType: "AssemblyActionKey",
  queueKeyType: null,
});
const MAX_ACTION_BYTES = 16 * 1024;
const MAX_ACTION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const DEFAULT_CLAIM_TTL_MS = 60_000;

export const SUI_ASSEMBLY_ACTION_STATUS = Object.freeze({
  QUEUED: 0,
  CLAIMED: 1,
  FULFILLED: 2,
  FAILED: 3,
  CANCELLED: 4,
});

export type SuiAssemblyAction = {
  actionObjectID: string;
  actionID: string;
  sourceAssemblyObjectID: string;
  targetAssemblyObjectID: string;
  sourceAssemblyID: number | null;
  targetAssemblyID: number | null;
  creator: string;
  actionType: string;
  payload: any;
  payloadBytes: Uint8Array;
  payloadCommitment: string;
  priority: number;
  priorityFlags: number;
  createdAtMs: number;
  expiresAtMs: number;
  status: number;
  revision: number;
  claimedBy: string | null;
  claimExpiresAtMs: number;
  outcome: any;
  outcomeBytes: Uint8Array;
  receiptCommitment: string | null;
  serverAction: boolean;
};

export type SuiAssemblyActionQueueBridge = {
  queueServerAction(request: Record<string, any>): Promise<Record<string, any>>;
  readAction(actionObjectID: string): Promise<SuiAssemblyAction>;
  claimServerAction(actionObjectID: string, claimTtlMs?: number): Promise<Record<string, any>>;
  releaseServerAction(actionObjectID: string): Promise<Record<string, any>>;
  completeServerAction(actionObjectID: string, succeeded: boolean, outcome: any): Promise<Record<string, any>>;
};

let activeBridge: SuiAssemblyActionQueueBridge | null = null;

export function registerSuiAssemblyActionQueueBridge(bridge: SuiAssemblyActionQueueBridge): () => void {
  activeBridge = bridge;
  return () => { if (activeBridge === bridge) activeBridge = null; };
}

export function getSuiAssemblyActionQueueBridge(): SuiAssemblyActionQueueBridge | null {
  return activeBridge;
}

function bytes(value: unknown, label: string, maximum = MAX_ACTION_BYTES): Uint8Array {
  const encoded = value instanceof Uint8Array
    ? value
    : Buffer.from(typeof value === "string" ? value : JSON.stringify(value), "utf8");
  if (encoded.byteLength > maximum) throw new Error(`${label} exceeds ${maximum} bytes`);
  return encoded;
}

function pureBytes(tx: Transaction, value: Uint8Array) {
  return tx.pure(bcs.vector(bcs.u8()).serialize([...value]).toBytes());
}

function hash(value: Uint8Array): Uint8Array {
  return createHash("sha256").update(value).digest();
}

function uuidBytes(value: unknown): Uint8Array {
  const normalized = String(value || "").trim().toLowerCase();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u
    .test(normalized)) throw new Error("Assembly action ID must be a UUID");
  return Buffer.from(normalized.replaceAll("-", ""), "hex");
}

function bytesUuid(value: unknown): string {
  const raw = Buffer.from(Array.isArray(value) ? value : []);
  if (raw.length !== 16) throw new Error("On-chain assembly action ID is invalid");
  const hex = raw.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function safeInteger(value: unknown, label: string): number {
  const numeric = Number(value);
  if (!Number.isSafeInteger(numeric) || numeric < 0) throw new Error(`${label} is invalid`);
  return numeric;
}

function record(value: any): Record<string, any> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value.fields && typeof value.fields === "object" ? value.fields : value;
}

function addressField(value: any, label: string): string {
  const fields = record(value);
  const candidate = fields.id ?? value;
  if (typeof candidate !== "string") throw new Error(`${label} is invalid`);
  return normalizeSuiAddress(candidate);
}

function decodeJsonOrBytes(raw: Uint8Array): any {
  if (!raw.byteLength) return null;
  try { return JSON.parse(Buffer.from(raw).toString("utf8")); }
  catch { return Uint8Array.from(raw); }
}

function actionBinding(context: any) {
  const deployment = context.accessDeployment;
  const legacy = deployment.actionPackageId === deployment.accessPackageId &&
    deployment.actionTypeOrigin === deployment.accessTypeOrigin &&
    deployment.actionRegistryId === deployment.accessRegistryId;
  return legacy ? LEGACY_ACTION_BINDING : CANONICAL_ACTION_BINDING;
}

function actionObjectID(
  queueID: string,
  typeOrigin: string,
  actionID: string,
  binding: ActionBinding = CANONICAL_ACTION_BINDING,
): string {
  return deriveObjectID(
    normalizeSuiAddress(queueID),
    `${normalizeSuiAddress(typeOrigin)}::${binding.module}::${binding.keyType}`,
    bcs.struct(binding.keyType, {
      action_id: bcs.vector(bcs.u8()),
    }).serialize({ action_id: [...uuidBytes(actionID)] }).toBytes(),
  );
}

function queueObjectID(
  registryID: string,
  typeOrigin: string,
  sourceAssemblyID: string,
  binding: ActionBinding,
): string {
  if (!binding.queueKeyType) return normalizeSuiAddress(registryID);
  return deriveObjectID(
    normalizeSuiAddress(registryID),
    `${normalizeSuiAddress(typeOrigin)}::${binding.module}::${binding.queueKeyType}`,
    bcs.struct(binding.queueKeyType, { assembly_id: bcs.Address })
      .serialize({ assembly_id: normalizeSuiAddress(sourceAssemblyID) }).toBytes(),
  );
}

/**
 * Materialize deterministic queue roots during assembly reconciliation. The
 * registry is touched only for this one-time initialization; normal enqueue,
 * claim, and completion traffic stays on each assembly's queue root.
 */
export async function ensureSuiAssemblyActionQueues(
  context: any,
  assemblyObjectIDs: string[],
): Promise<void> {
  const binding = actionBinding(context);
  if (!binding.queueKeyType || !assemblyObjectIDs.length) return;
  const registryID = normalizeSuiAddress(context.accessDeployment.actionRegistryId);
  const typeOrigin = normalizeSuiAddress(context.accessDeployment.actionTypeOrigin);
  const expectedType = `${typeOrigin}::${binding.module}::AssemblyActionQueue`;
  const entries = [...new Set(assemblyObjectIDs.map(value => normalizeSuiAddress(value)))].map(assemblyID => ({
    assemblyID,
    queueID: queueObjectID(registryID, typeOrigin, assemblyID, binding),
  }));
  for (let offset = 0; offset < entries.length; offset += 50) {
    const batch = entries.slice(offset, offset + 50);
    await context.assertCurrent();
    const responses = await context.client.multiGetObjects({
      ids: batch.map(entry => entry.queueID),
      options: { showContent: true, showType: true },
    });
    const missing: typeof batch = [];
    for (let index = 0; index < batch.length; index++) {
      const response = responses[index];
      const content = response?.data?.content;
      if (response?.error?.code === "notExists") {
        missing.push(batch[index]);
      } else if (response?.error || content?.dataType !== "moveObject" || content.type !== expectedType) {
        throw new Error(`Action queue root ${batch[index].queueID} conflicts with this deployment`);
      }
    }
    if (!missing.length) continue;
    const transaction = new Transaction();
    for (const entry of missing) {
      transaction.moveCall({
        target: `${normalizeSuiAddress(context.accessDeployment.actionPackageId)}::${binding.module}::create_server_queue`,
        arguments: [
          transaction.object(registryID),
          transaction.object(context.world.serverAddressRegistryId),
          transaction.pure.address(entry.assemblyID),
        ],
      });
    }
    await context.assertCurrent();
    await context.executor.execute(
      `initialize ${missing.length} assembly action queue${missing.length === 1 ? "" : "s"}`,
      transaction,
    );
    await context.assertCurrent();
  }
}

export function createSuiAssemblyActionQueueBridge(options: {
  runExclusive<T>(operation: () => Promise<T>): Promise<T>;
  getContext(): any;
  getSnapshot(): { assemblies: Array<{ itemId: string }> };
  hasPrepared?(): boolean;
  now?: () => number;
}): SuiAssemblyActionQueueBridge {
  const now = options.now ?? Date.now;

  async function withContext<T>(operation: (context: any) => Promise<T>): Promise<T> {
    return options.runExclusive(async () => {
      const context = options.getContext();
      if (!context) throw Object.assign(new Error("Assembly synchronization is starting"), {
        code: "ASSEMBLY_ACTION_CHAIN_UNAVAILABLE",
      });
      if (options.hasPrepared?.()) throw Object.assign(new Error("An assembly owner transaction is pending"), {
        code: "ASSEMBLY_ACTION_CHAIN_UNAVAILABLE",
      });
      await context.assertCurrent();
      if (!context.accessDeployment?.actionRegistryId ||
          !context.accessDeployment?.actionPackageId ||
          !context.world?.serverAddressRegistryId) {
        throw Object.assign(new Error("Assembly action deployment is unavailable"), {
          code: "ASSEMBLY_ACTION_CHAIN_UNAVAILABLE",
        });
      }
      return operation(context);
    });
  }

  function localObject(context: any, localID: unknown): string {
    const numeric = Number(localID);
    const assembly = options.getSnapshot().assemblies.find(value => Number(value.itemId) === numeric);
    if (!assembly) throw Object.assign(new Error(`Assembly ${String(localID)} is absent from Sui`), {
      code: "ASSEMBLY_ACTION_CHAIN_UNAVAILABLE",
    });
    return normalizeSuiAddress(context.chain.deriveId(assembly.itemId));
  }

  function localID(context: any, objectID: string): number | null {
    const normalized = normalizeSuiAddress(objectID);
    const assembly = options.getSnapshot().assemblies.find(value =>
      normalizeSuiAddress(context.chain.deriveId(value.itemId)) === normalized);
    return assembly ? Number(assembly.itemId) : null;
  }

  function target(context: any, fn: string): `${string}::${string}::${string}` {
    const binding = actionBinding(context);
    return `${normalizeSuiAddress(context.accessDeployment.actionPackageId)}::${binding.module}::${fn}`;
  }

  async function execute(context: any, label: string, transaction: Transaction) {
    await context.assertCurrent();
    const result = await context.executor.execute(label, transaction);
    await context.assertCurrent();
    return { digest: result.digest };
  }

  async function read(context: any, objectID: string): Promise<SuiAssemblyAction> {
    const id = normalizeSuiAddress(objectID);
    const response = await context.client.getObject({
      id,
      options: { showContent: true, showOwner: true, showType: true },
    });
    const content = response.data?.content;
    const binding = actionBinding(context);
    const expectedType = `${normalizeSuiAddress(context.accessDeployment.actionTypeOrigin)}::${binding.module}::${binding.objectType}`;
    if (response.error || content?.dataType !== "moveObject" || content.type !== expectedType) {
      throw Object.assign(new Error("Assembly action is not present in this Sui deployment"), {
        code: "ASSEMBLY_ACTION_NOT_FOUND",
      });
    }
    const fields = record(content.fields);
    const payloadBytes = Uint8Array.from(Array.isArray(fields.payload) ? fields.payload : []);
    const commitment = Uint8Array.from(
      Array.isArray(fields.payload_commitment) ? fields.payload_commitment : [],
    );
    if (commitment.length !== 32 || !Buffer.from(commitment).equals(Buffer.from(hash(payloadBytes)))) {
      throw Object.assign(new Error("Assembly action payload commitment does not match"), {
        code: "ASSEMBLY_ACTION_COMMITMENT_INVALID",
      });
    }
    const sourceAssemblyObjectID = addressField(fields.source_assembly_id, "Action source");
    const targetAssemblyObjectID = addressField(fields.target_assembly_id, "Action target");
    const claimedBy = normalizeSuiAddress(String(fields.claimed_by || "0x0"));
    const outcomeBytes = Uint8Array.from(Array.isArray(fields.outcome) ? fields.outcome : []);
    const receiptCommitment = Uint8Array.from(
      Array.isArray(fields.receipt_commitment) ? fields.receipt_commitment : [],
    );
    if (receiptCommitment.length !== 0 && receiptCommitment.length !== 32) {
      throw Object.assign(new Error("Assembly action receipt commitment is invalid"), {
        code: "ASSEMBLY_ACTION_COMMITMENT_INVALID",
      });
    }
    if (receiptCommitment.length === 32 &&
        !Buffer.from(receiptCommitment).equals(Buffer.from(hash(outcomeBytes)))) {
      throw Object.assign(new Error("Assembly action receipt commitment does not match"), {
        code: "ASSEMBLY_ACTION_COMMITMENT_INVALID",
      });
    }
    return {
      actionObjectID: id,
      actionID: bytesUuid(fields.action_id),
      sourceAssemblyObjectID,
      targetAssemblyObjectID,
      sourceAssemblyID: localID(context, sourceAssemblyObjectID),
      targetAssemblyID: localID(context, targetAssemblyObjectID),
      creator: normalizeSuiAddress(String(fields.creator)),
      actionType: Buffer.from(Array.isArray(fields.action_type) ? fields.action_type : []).toString("utf8"),
      payload: decodeJsonOrBytes(payloadBytes),
      payloadBytes,
      payloadCommitment: Buffer.from(commitment).toString("hex"),
      priority: safeInteger(fields.priority, "Assembly action priority"),
      priorityFlags: safeInteger(fields.priority_flags, "Assembly action priority flags"),
      createdAtMs: safeInteger(fields.created_at_ms, "Assembly action creation time"),
      expiresAtMs: safeInteger(fields.expires_at_ms, "Assembly action expiry"),
      status: safeInteger(fields.status, "Assembly action status"),
      revision: safeInteger(fields.revision, "Assembly action revision"),
      claimedBy: claimedBy === normalizeSuiAddress("0x0") ? null : claimedBy,
      claimExpiresAtMs: safeInteger(fields.claim_expires_at_ms, "Assembly action claim expiry"),
      outcome: decodeJsonOrBytes(outcomeBytes),
      outcomeBytes,
      receiptCommitment: receiptCommitment.length
        ? Buffer.from(receiptCommitment).toString("hex") : null,
      serverAction: fields.server_action === true,
    };
  }

  return {
    queueServerAction(request: Record<string, any>) {
      return withContext(async context => {
        const actionID = String(request.actionID || request.requestID || "").toLowerCase();
        const rawPayload = bytes(request.payload ?? null, "Assembly action payload");
        const actionType = bytes(request.actionType || request.requestType, "Assembly action type", 96);
        if (!actionType.length) throw new Error("Assembly action type is required");
        const priority = safeInteger(request.priority ?? 100, "Assembly action priority");
        const priorityFlags = safeInteger(request.priorityFlags ?? 0, "Assembly action flags");
        const expiresAtMs = safeInteger(request.expiresAtMs, "Assembly action expiry");
        if (expiresAtMs <= now() || expiresAtMs - now() > MAX_ACTION_TTL_MS) {
          throw new Error("Assembly action expiry is outside the supported range");
        }
        const sourceAssemblyObjectID = localObject(context, request.sourceAssemblyID);
        const targetAssemblyObjectID = localObject(context, request.targetAssemblyID);
        const binding = actionBinding(context);
        const queueID = queueObjectID(
          context.accessDeployment.actionRegistryId,
          context.accessDeployment.actionTypeOrigin,
          sourceAssemblyObjectID,
          binding,
        );
        const expectedObjectID = actionObjectID(
          queueID,
          context.accessDeployment.actionTypeOrigin,
          actionID,
          binding,
        );
        try {
          const existing = await read(context, expectedObjectID);
          const commitment = Buffer.from(hash(rawPayload)).toString("hex");
          if (!existing.serverAction || existing.actionID !== actionID ||
              existing.sourceAssemblyObjectID !== sourceAssemblyObjectID ||
              existing.targetAssemblyObjectID !== targetAssemblyObjectID ||
              existing.actionType !== Buffer.from(actionType).toString("utf8") ||
              existing.payloadCommitment !== commitment || existing.priority !== priority ||
              existing.priorityFlags !== priorityFlags || existing.expiresAtMs !== expiresAtMs) {
            throw Object.assign(new Error("Existing Sui assembly action conflicts with this request"), {
              code: "ASSEMBLY_ACTION_MISMATCH",
            });
          }
          return { digest: null, actionID, actionObjectID: expectedObjectID, replayed: true };
        } catch (error: any) {
          if (error?.code !== "ASSEMBLY_ACTION_NOT_FOUND") throw error;
        }
        const transaction = new Transaction();
        transaction.moveCall({
          target: target(context, "queue_server_action"),
          arguments: [
            transaction.object(queueID),
            transaction.object(context.world.serverAddressRegistryId),
            ...(binding.queueKeyType ? [] : [transaction.pure.address(sourceAssemblyObjectID)]),
            transaction.pure.address(targetAssemblyObjectID),
            pureBytes(transaction, uuidBytes(actionID)),
            pureBytes(transaction, actionType),
            pureBytes(transaction, rawPayload),
            pureBytes(transaction, hash(rawPayload)),
            transaction.pure.u64(priority),
            transaction.pure.u64(priorityFlags),
            transaction.pure.u64(expiresAtMs),
            transaction.object(SUI_CLOCK_OBJECT_ID),
          ],
        });
        const receipt = await execute(context, `queue assembly action ${actionID}`, transaction);
        return {
          ...receipt,
          actionID,
          actionObjectID: expectedObjectID,
          replayed: false,
        };
      });
    },

    readAction(actionID: string) {
      return withContext(context => read(context, actionID));
    },

    claimServerAction(actionID: string, claimTtlMs = DEFAULT_CLAIM_TTL_MS) {
      return withContext(async context => {
        const transaction = new Transaction();
        transaction.moveCall({
          target: target(context, "claim_server_action"),
          arguments: [
            transaction.object(normalizeSuiAddress(actionID)),
            transaction.object(context.world.serverAddressRegistryId),
            transaction.pure.u64(safeInteger(claimTtlMs, "Assembly action claim duration")),
            transaction.object(SUI_CLOCK_OBJECT_ID),
          ],
        });
        return execute(context, `claim assembly action ${actionID}`, transaction);
      });
    },

    releaseServerAction(actionID: string) {
      return withContext(async context => {
        const transaction = new Transaction();
        transaction.moveCall({
          target: target(context, "release_server_action"),
          arguments: [
            transaction.object(normalizeSuiAddress(actionID)),
            transaction.object(context.world.serverAddressRegistryId),
            transaction.object(SUI_CLOCK_OBJECT_ID),
          ],
        });
        return execute(context, `release assembly action ${actionID}`, transaction);
      });
    },

    completeServerAction(actionID: string, succeeded: boolean, outcome: any) {
      return withContext(async context => {
        const rawOutcome = bytes(outcome ?? null, "Assembly action outcome");
        const transaction = new Transaction();
        transaction.moveCall({
          target: target(context, "complete_server_action"),
          arguments: [
            transaction.object(normalizeSuiAddress(actionID)),
            transaction.object(context.world.serverAddressRegistryId),
            transaction.pure.bool(succeeded),
            pureBytes(transaction, rawOutcome),
            transaction.object(SUI_CLOCK_OBJECT_ID),
          ],
        });
        return execute(context, `complete assembly action ${actionID}`, transaction);
      });
    },
  };
}
