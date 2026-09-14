import { flushSuiIndustrySync, readSuiIndustrySyncStatus } from "./suiIndustrySync";
import { readSuiStorageSyncStatus } from "./suiStorageSync";

export type SuiIndustryStorageSyncRequest = { facilityID: number; characterID: number; storageUnitID: number };
export type SuiIndustryStorageSyncState = "disabled" | "pending" | "synced" | "error";
export type SuiIndustryStorageSyncStatus = {
  status: SuiIndustryStorageSyncState;
  industryStatus: SuiIndustryStorageSyncState;
  storageStatus: SuiIndustryStorageSyncState;
};

type SnapshotReader = (request: SuiIndustryStorageSyncRequest) => string;
let snapshotReader: SnapshotReader | null = null;

/** The worker supplies fingerprints from the same snapshots used by its mirrors. */
export function registerSuiIndustryStorageSnapshotReader(value: SnapshotReader) {
  snapshotReader = value;
  return () => { if (snapshotReader === value) snapshotReader = null; };
}

function combine(industryStatus: SuiIndustryStorageSyncState, storageStatus: SuiIndustryStorageSyncState): SuiIndustryStorageSyncStatus {
  const status = industryStatus === "error" || storageStatus === "error" ? "error"
    : industryStatus === "disabled" && storageStatus === "disabled" ? "disabled"
    : industryStatus === "synced" && storageStatus === "synced" ? "synced" : "pending";
  return { status, industryStatus, storageStatus };
}

/**
 * Retry only the durable chain mirrors, never the already committed item move.
 * Call after releasing the assembly-state queue: flush and status reads acquire
 * that same queue themselves. The Industry flush scans BOTH assembly contents
 * and Industry twice, including the caller's latest committed server inventory.
 */
export async function syncIndustryStorageTransfer(request: SuiIndustryStorageSyncRequest): Promise<SuiIndustryStorageSyncStatus> {
  if (!request || ![request.facilityID, request.characterID, request.storageUnitID].every(id => Number.isSafeInteger(id) && id > 0)) {
    return combine("error", "error");
  }
  const industryRequest = { facilityID: request.facilityID, characterID: request.characterID };
  const storageRequest = { storageUnitID: request.storageUnitID, characterID: request.characterID };
  const current = snapshotReader;
  try {
    await flushSuiIndustrySync(industryRequest);
    if (snapshotReader !== current) return combine("error", "error");
    const before = current?.(request);
    const [industry, storage] = await Promise.all([
      readSuiIndustrySyncStatus(industryRequest), readSuiStorageSyncStatus(storageRequest),
    ]);
    if (snapshotReader !== current) return combine("error", "error");
    const result = combine(industry.status, storage.status);
    if (result.status === "synced" && (!current || before !== current(request))) {
      // Each status validates its own read. Also reject changes to either local
      // snapshot while the OTHER object's asynchronous chain read was pending.
      return combine("pending", "pending");
    }
    return result;
  } catch {
    // RPC details may contain local paths or deployment configuration.
    return combine("error", "error");
  }
}
