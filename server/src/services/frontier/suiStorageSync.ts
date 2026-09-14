import type { SuiStorageInventoryStatus } from "./suiAssemblyContents";

export type SuiStorageSyncRequest = { storageUnitID: number; characterID: number };
export type SuiStorageSyncStatus = SuiStorageSyncRequest & {
  status: "disabled" | "pending" | "synced" | "error";
  chain?: SuiStorageInventoryStatus;
  error?: string;
};
export type SuiStorageSyncBridge = {
  readStatus(request: SuiStorageSyncRequest): Promise<SuiStorageSyncStatus>;
  flush(request: SuiStorageSyncRequest): Promise<SuiStorageSyncStatus>;
};

let bridge: SuiStorageSyncBridge | null = null;

/** The assembly worker owns submission and recovery; storage never opens a second executor. */
export function registerSuiStorageSyncBridge(value: SuiStorageSyncBridge): () => void {
  bridge = value;
  return () => { if (bridge === value) bridge = null; };
}

async function callBridge(method: keyof SuiStorageSyncBridge, request: SuiStorageSyncRequest): Promise<SuiStorageSyncStatus> {
  const identity = { storageUnitID: request.storageUnitID, characterID: request.characterID };
  try {
    if (![request.storageUnitID, request.characterID].every(id => Number.isSafeInteger(id) && id > 0)) {
      throw new Error("Storage synchronization requires valid storage and character IDs");
    }
    const current = bridge;
    if (!current) return { ...identity, status: "disabled" };
    const result = await current[method]({ ...identity });
    if (bridge !== current) throw new Error("Storage synchronization worker changed; retry the current deployment");
    if (!result || result.storageUnitID !== identity.storageUnitID || result.characterID !== identity.characterID ||
        !["disabled", "pending", "synced", "error"].includes(result.status)) {
      throw new Error("Storage synchronization returned an invalid status");
    }
    if (result.status === "synced" && (!result.chain || !result.chain.synchronized ||
        result.chain.partitions.length !== 1 || result.chain.partitions[0].characterId !== request.characterID ||
        !result.chain.partitions[0].synchronized)) {
      throw new Error("Storage synchronization did not confirm this character's on-chain inventory");
    }
    return result;
  } catch (error) {
    return { ...identity, status: "error", error: error instanceof Error ? error.message : String(error) };
  }
}

export function readSuiStorageSyncStatus(request: SuiStorageSyncRequest): Promise<SuiStorageSyncStatus> {
  return callBridge("readStatus", request);
}

export function flushSuiStorageSync(request: SuiStorageSyncRequest): Promise<SuiStorageSyncStatus> {
  return callBridge("flush", request);
}
