import { randomUUID } from "node:crypto";
import { verifyTransactionSignature } from "@mysten/sui/verify";
import { normalizeSuiAddress } from "@mysten/sui/utils";

type Bridge = { prepare(request: any): Promise<any>; execute(request: any): Promise<any> };
let bridge: Bridge | null = null;
export function registerSuiAssemblyAdminBridge(value: Bridge) {
  bridge = value;
  return () => { if (bridge === value) bridge = null; };
}
const fail = (code: string, params?: any): never => { throw Object.assign(new Error(code), { code, params }); };
export async function callSuiAssemblyAdmin(method: keyof Bridge, request: any): Promise<any> {
  const current = bridge;
  if (!current) return { success: false, errorMsg: "DEPLOYMENT_UNAVAILABLE" };
  try { return await current[method](request); }
  catch (error: any) { return { success: false, errorMsg: error.code || "ADMIN_REQUEST_FAILED", ...(error.params ? { params: error.params } : {}) }; }
}
function sameID(left: any, right: any) {
  return typeof left === "string" && typeof right === "string" &&
    /^0x[0-9a-f]{1,64}$/i.test(left) && /^0x[0-9a-f]{1,64}$/i.test(right) &&
    normalizeSuiAddress(left) === normalizeSuiAddress(right);
}
/** Only fields affecting ownership, topology, status, or transaction fuel are frozen. */
function fingerprint(assembly: any) {
  if (!assembly) return "missing";
  const { itemId, typeId, ownerId, kind, status, solarSystemId, position, networkNodeId, destinationGateId, fuel } = assembly;
  return JSON.stringify({ itemId, typeId, ownerId, kind, status, solarSystemId, position, networkNodeId, destinationGateId, fuel });
}
export async function verifySponsoredAssemblySignature(bytes: string, signature: string, walletAddress: string) {
  if (typeof signature !== "string" || signature.length > 16384) return false;
  try {
    await verifyTransactionSignature(Buffer.from(bytes, "base64"), signature, { address: walletAddress });
    return true;
  } catch { return false; }
}

/** All operations share the mirror's queue, signer, and durable transaction journal. */
export function createSponsoredAssemblyAdmin(options: {
  runExclusive: <T>(action: () => Promise<T>) => Promise<T>;
  getContext: () => any;
  getSnapshot: () => any;
  validateAccess: (request: any, assembly: any) => void;
  now?: () => number;
  verifySignature?: typeof verifySponsoredAssemblySignature;
}) {
  const now = options.now || Date.now;
  let prepared: any = null;
  function hasPrepared() {
    if (prepared && prepared.expiresAt <= now()) prepared = null;
    return Boolean(prepared);
  }
  async function contextForRequest(request: any) {
    request.assertAuthenticated();
    if (!["online", "offline"].includes(request.action) || request.tenant !== "dev") fail("INVALID_ACTION");
    const context = options.getContext();
    if (!context || context.synced.network !== "localnet") fail("DEPLOYMENT_UNAVAILABLE");
    await context.assertCurrent();
    request.assertAuthenticated();
    return context;
  }
  function assertSnapshot(request: any, originals: any[]) {
    request.assertAuthenticated();
    const snapshot = options.getSnapshot();
    for (const original of originals) {
      const latest = snapshot.assemblies.find((value: any) => value.itemId === original.itemId);
      if (fingerprint(original) !== fingerprint(latest)) fail("ASSEMBLY_STATE_CHANGED");
    }
    options.validateAccess(request, originals[0]);
  }
  function response(metadata: any, digest: string, replayed: boolean) {
    return { success: true, data: { transactionUUID: metadata.transactionUUID, action: metadata.action,
      assemblyID: metadata.assemblyID, assemblyObjectID: metadata.assemblyObjectID, digest, gameCommitted: true, replayed } };
  }
  function preparedResponse(operation: any) {
    return { success: true, data: { transactionUUID: operation.transactionUUID, action: operation.action,
      assemblyID: operation.assemblyID, assemblyObjectID: operation.assemblyObjectID, walletAddress: operation.walletAddress,
      deployment: operation.deployment, sponsorAddress: operation.sponsorAddress, expiresAt: operation.expiresAt,
      digest: operation.digest, transactionData: operation.bytes, transactionBytes: operation.bytes } };
  }
  return {
    hasPrepared,
    prepare(request: any) {
      return options.runExclusive(async () => {
        const context = await contextForRequest(request);
        if (context.executor.hasPending()) fail("SPONSOR_BUSY");
        if (hasPrepared()) {
          if (prepared.characterID !== request.characterID || prepared.walletAddress !== request.walletAddress ||
              prepared.assemblyID !== request.assemblyID || prepared.action !== request.action) fail("SPONSOR_BUSY");
          if (!sameID(request.expectedAssemblyObjectID, prepared.assemblyObjectID) ||
              !sameID(request.expectedPackageId, context.synced.packageId) ||
              !sameID(request.expectedObjectRegistryId, context.synced.objectRegistryId) ||
              prepared.deployment.chainId !== context.synced.chainId ||
              !sameID(prepared.deployment.packageId, context.synced.packageId) ||
              !sameID(prepared.deployment.objectRegistryId, context.synced.objectRegistryId)) {
            prepared = null; fail("DEPLOYMENT_MISMATCH");
          }
          try { assertSnapshot(request, prepared.frozen); }
          catch (error) { prepared = null; throw error; }
          // Wallet cancellation can retry the immutable offer without selecting
          // different gas or invalidating another copy of the same wallet prompt.
          return preparedResponse(prepared);
        }
        const snapshot = options.getSnapshot();
        const assembly = snapshot.assemblies.find((value: any) => value.itemId === String(request.assemblyID));
        if (!assembly) fail("ASSEMBLY_NOT_FOUND");
        options.validateAccess(request, assembly);
        const assemblyObjectID = context.chain.deriveId(assembly.itemId);
        if (!sameID(request.expectedAssemblyObjectID, assemblyObjectID) ||
            !sameID(request.expectedPackageId, context.synced.packageId) ||
            !sameID(request.expectedObjectRegistryId, context.synced.objectRegistryId)) fail("DEPLOYMENT_MISMATCH");
        const character = await context.getCharacter(assembly.ownerId, false);
        if (!sameID(character.address, request.walletAddress)) fail("ACCESS_DENIED");
        const targetStatus = request.action === "online" ? 2 : 1;
        if (assembly.status === targetStatus) fail("ALREADY_IN_STATE");
        if (targetStatus === 2 && assembly.kind === "network_node" && assembly.fuel.quantity <= 0) fail("NETWORK_NODE_FUEL_REQUIRED");
        if (targetStatus === 2 && assembly.kind === "gate" && !assembly.destinationGateId) fail("SMART_GATE_DESTINATION_REQUIRED");
        const state = await context.chain.readAssembly(assembly);
        if (!state || state.online !== (assembly.status === 2)) fail("ASSEMBLY_STATE_CHANGED");
        context.setSnapshotItemIds?.(new Set(snapshot.assemblies.map((value: any) => value.itemId)), snapshot.assemblies);
        const built = await context.chain.buildStatusTransaction({ ...assembly, status: targetStatus });
        if (!built) fail("ALREADY_IN_STATE");
        const connected = built.connectedAssemblyIds.map((id: string) => {
          const local = snapshot.assemblies.find((value: any) => sameID(context.chain.deriveId(value.itemId), id));
          if (!local || local.kind === "network_node") fail("ASSEMBLY_STATE_CHANGED");
          return local;
        });
        const affected = [assembly, ...connected];
        const parent = assembly.networkNodeId && snapshot.assemblies.find((value: any) => value.itemId === assembly.networkNodeId);
        const frozen = parent ? [...affected, parent] : affected;
        assertSnapshot(request, frozen);
        const transaction = await context.executor.prepareSponsored(built.transaction, request.walletAddress);
        if (context.simulateSponsored) await context.simulateSponsored(transaction.bytes);
        assertSnapshot(request, frozen);
        const deployment = { network: "localnet", chainId: context.synced.chainId,
          packageId: context.synced.packageId, objectRegistryId: context.synced.objectRegistryId, assemblyObjectID,
          adminAclId: context.world.adminAclId, energyConfigId: context.world.energyConfigId, fuelConfigId: context.world.fuelConfigId };
        prepared = {
          transactionUUID: randomUUID(), action: request.action, assemblyID: request.assemblyID,
          assemblyObjectID, characterID: request.characterID, walletAddress: request.walletAddress,
          deployment, ...transaction, expiresAt: now() + 120000,
          affected: affected.map(value => ({ assemblyID: Number(value.itemId), ownerID: value.ownerId, typeID: value.typeId,
            targetStatus: value.itemId === assembly.itemId ? targetStatus : 1 })),
          frozen,
        };
        return preparedResponse(prepared);
      });
    },
    execute(request: any): Promise<any> {
      return options.runExclusive(async () => {
        const context = await contextForRequest(request);
        hasPrepared();
        let durable = context.executor.getSponsored(request.transactionUUID);
        const operation = durable?.metadata || (prepared?.transactionUUID === request.transactionUUID ? prepared : null);
        if (!operation) fail("TRANSACTION_NOT_FOUND");
        const bytes = durable?.bytes || operation.bytes;
        if (operation.assemblyID !== request.assemblyID || operation.characterID !== request.characterID ||
            operation.action !== request.action || operation.walletAddress !== request.walletAddress || request.bytes !== bytes) fail("TRANSACTION_MISMATCH");
        if (operation.deployment.chainId !== context.synced.chainId ||
            !sameID(operation.deployment.packageId, context.synced.packageId) ||
            !sameID(operation.deployment.objectRegistryId, context.synced.objectRegistryId)) fail("DEPLOYMENT_MISMATCH");
        if (!await (options.verifySignature || verifySponsoredAssemblySignature)(bytes, request.signature, request.walletAddress)) fail("INVALID_SIGNATURE");
        request.assertAuthenticated();
        if (durable?.status === "success") return response(operation, durable.digest, true);
        if (durable?.status === "failure") fail("TRANSACTION_FAILED", { transactionUUID: request.transactionUUID, digest: durable.digest });
        try {
          if (durable) await context.executor.recover();
          else {
            if (operation.expiresAt <= now()) { prepared = null; fail("TRANSACTION_NOT_FOUND"); }
            assertSnapshot(request, operation.frozen);
            const { frozen, bytes: _bytes, ...metadata } = operation;
            await context.executor.executeSponsored(metadata, bytes, request.signature, () => {
              if (operation.expiresAt <= now()) fail("TRANSACTION_NOT_FOUND");
              assertSnapshot(request, frozen);
            });
          }
        } catch (error: any) {
          durable = context.executor.getSponsored(request.transactionUUID);
          if (durable?.status === "pending") {
            prepared = null;
            return { success: false, errorMsg: "TRANSACTION_PENDING", params: { transactionUUID: request.transactionUUID, digest: durable.digest } };
          }
          if (durable?.status === "failure") { prepared = null; fail("TRANSACTION_FAILED", { transactionUUID: request.transactionUUID, digest: durable.digest }); }
          if (!context.executor.hasPending()) prepared = null;
          throw error;
        }
        prepared = null;
        durable = context.executor.getSponsored(request.transactionUUID);
        if (durable?.status !== "success") fail("TRANSACTION_PENDING");
        return response(operation, durable.digest, false);
      });
    },
  };
}
