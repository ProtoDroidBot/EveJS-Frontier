export type SuiGateSyncRequest = { gateID: number; characterID: number };
export type SuiGateSyncStatus = SuiGateSyncRequest & {
  status: "disabled" | "pending" | "synced" | "error";
  synchronized?: boolean;
  gateObjectID?: string;
  linkedGateObjectID?: string | null;
  maxDistanceMeters?: string;
  message?: string;
};
export type SuiGateSyncBridge = {
  readStatus(request: SuiGateSyncRequest): Promise<SuiGateSyncStatus>;
  flush(request: SuiGateSyncRequest): Promise<SuiGateSyncStatus>;
};

let bridge: SuiGateSyncBridge | null = null;

/** Gate reads and retries use the assembly worker's existing durable executor. */
export function registerSuiGateSyncBridge(value: SuiGateSyncBridge): () => void {
  bridge = value;
  return () => { if (bridge === value) bridge = null; };
}

async function callBridge(method: keyof SuiGateSyncBridge, request: SuiGateSyncRequest): Promise<SuiGateSyncStatus> {
  const identity = { gateID: request.gateID, characterID: request.characterID };
  try {
    if (![identity.gateID, identity.characterID].every(id => Number.isSafeInteger(id) && id > 0)) {
      throw new Error("Gate synchronization requires valid gate and character IDs");
    }
    const current = bridge;
    if (!current) return { ...identity, status: "disabled" };
    const result = await current[method](identity);
    if (bridge !== current) throw new Error("Gate synchronization worker changed; retry the current deployment");
    if (!result || result.gateID !== identity.gateID || result.characterID !== identity.characterID ||
        !["disabled", "pending", "synced", "error"].includes(result.status)) {
      throw new Error("Gate synchronization returned an invalid status");
    }
    if (result.maxDistanceMeters !== undefined &&
        (!/^\d+$/.test(result.maxDistanceMeters) || BigInt(result.maxDistanceMeters) > (1n << 64n) - 1n)) {
      throw new Error("Gate synchronization returned an invalid configured distance");
    }
    if (result.status === "synced" && (result.synchronized !== true ||
        !/^0x[0-9a-f]{1,64}$/i.test(result.gateObjectID || "") ||
        !(result.linkedGateObjectID === null || /^0x[0-9a-f]{1,64}$/i.test(result.linkedGateObjectID || "")))) {
      throw new Error("Gate synchronization did not confirm the reciprocal on-chain link");
    }
    return result;
  } catch (error) {
    return { ...identity, status: "error", message: error instanceof Error ? error.message : String(error) };
  }
}

export function readSuiGateSyncStatus(request: SuiGateSyncRequest) { return callBridge("readStatus", request); }
export function flushSuiGateSync(request: SuiGateSyncRequest) { return callBridge("flush", request); }
