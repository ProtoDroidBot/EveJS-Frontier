import { industryFingerprint, type IndustryFacilitySnapshot, type IndustryProduction } from "./suiIndustrySnapshot";
import type { AssemblySnapshot } from "./suiAssemblySnapshot";

export type SuiIndustrySyncRequest = { facilityID: number; characterID: number };
export type SuiIndustrySyncStatus = SuiIndustrySyncRequest & {
  status: "disabled" | "pending" | "synced" | "error";
  synchronized?: boolean; industryObjectID?: string; assemblyObjectID?: string;
  revision?: string; observedAtMs?: string; syncedAtMs?: string; message?: string;
  productionMirrored?: boolean; chainProduction?: IndustryProduction | null;
};
export type SuiIndustrySyncBridge = {
  readStatus(request: SuiIndustrySyncRequest): Promise<SuiIndustrySyncStatus>;
  flush(request: SuiIndustrySyncRequest): Promise<SuiIndustrySyncStatus>;
};
let bridge: SuiIndustrySyncBridge | null = null;
export function registerSuiIndustrySyncBridge(value: SuiIndustrySyncBridge) {
  bridge = value;
  return () => { if (bridge === value) bridge = null; };
}
async function invoke(method: keyof SuiIndustrySyncBridge, request: SuiIndustrySyncRequest): Promise<SuiIndustrySyncStatus> {
  const identity = { facilityID: request.facilityID, characterID: request.characterID };
  try {
    if (![identity.facilityID, identity.characterID].every(id => Number.isSafeInteger(id) && id > 0)) throw new Error("Invalid Industry synchronization identity");
    const current = bridge;
    if (!current) return { ...identity, status: "disabled" };
    const result = await current[method](identity);
    if (bridge !== current) throw new Error("Industry deployment changed during synchronization");
    if (!result || result.facilityID !== identity.facilityID || result.characterID !== identity.characterID ||
        !["disabled", "pending", "synced", "error"].includes(result.status)) throw new Error("Invalid Industry synchronization response");
    if (result.status === "synced" && (result.synchronized !== true || result.productionMirrored !== true ||
        !/^0x[0-9a-f]{1,64}$/i.test(result.industryObjectID || "") || !/^0x[0-9a-f]{1,64}$/i.test(result.assemblyObjectID || ""))) {
      throw new Error("Industry snapshot has not been confirmed");
    }
    return result;
  } catch (error) { return { ...identity, status: "error", message: error instanceof Error ? error.message : String(error) }; }
}
export const readSuiIndustrySyncStatus = (request: SuiIndustrySyncRequest) => invoke("readStatus", request);
export const flushSuiIndustrySync = (request: SuiIndustrySyncRequest) => invoke("flush", request);

export async function reconcileSuiIndustryFacilities(snapshot: {
  facilities: IndustryFacilitySnapshot[]; errors: Array<{ itemId: string; message: string }>;
}, assemblies: AssemblySnapshot[], context: any) {
  const errors = snapshot.errors.map(error => `Industry ${error.itemId}: ${error.message}`);
  for (const facility of snapshot.facilities) {
    try {
      const assembly = assemblies.find(a => a.itemId === facility.itemId && a.kind === "assembly");
      if (!assembly) throw new Error("Industry Assembly is not available for synchronization");
      await context.assertCurrent();
      await context.industry.sync(facility, assembly);
    } catch (error: any) {
      if (context.executor.hasPending()) throw error;
      errors.push(`Industry ${facility.itemId}: ${error.message}`);
    }
  }
  if (errors.length) throw new Error(errors.join("; "));
}

/** Status and explicit retries share the same queue and journal as auto-sync. */
export function createSuiIndustrySyncWorkerBridge(options: {
  runExclusive: <T>(operation: () => Promise<T>) => Promise<T>;
  runOnce: () => Promise<unknown>; getContext: () => any;
  getSnapshot: () => { facilities: IndustryFacilitySnapshot[]; assemblies: AssemblySnapshot[] };
  getLastError: () => string; hasPrepared: () => boolean;
}): SuiIndustrySyncBridge {
  async function resolveOwned(request: SuiIndustrySyncRequest) {
    const context = options.getContext();
    if (!context) throw new Error(options.getLastError() || "Industry synchronization is starting");
    if (options.hasPrepared()) throw new Error("An assembly transaction is awaiting a signature");
    await context.assertCurrent();
    const source = options.getSnapshot();
    const facility = source.facilities.find(f => f.itemId === String(request.facilityID));
    if (!facility || facility.snapshot.owner_id !== String(request.characterID)) throw new Error("Owned Industry facility is not available");
    const assembly = source.assemblies.find(a => a.itemId === facility.itemId && a.kind === "assembly");
    if (!assembly) throw new Error("Industry Assembly is not available");
    return { context, facility, assembly };
  }
  const readStatus: SuiIndustrySyncBridge["readStatus"] = request => options.runExclusive(async () => {
    const { context, facility, assembly } = await resolveOwned(request);
    const result = await context.industry.status(facility, assembly);
    await context.assertCurrent();
    const latest = options.getSnapshot().facilities.find(f => f.itemId === facility.itemId);
    const synchronized = industryFingerprint(latest) === industryFingerprint(facility) && result.synchronized && !context.executor.hasPending();
    return { ...request, ...result, synchronized, status: synchronized ? "synced" : "pending" };
  });
  return { readStatus, async flush(request) {
    // Reject a foreign facility before the explicit flush can trigger any work.
    // A missing chain object or failed prior RPC must not prevent retrying its
    // first creation. Ownership is checked from the captured local state.
    await options.runExclusive(() => resolveOwned(request));
    await options.runOnce();
    await options.runOnce();
    return readStatus(request);
  } };
}
