import {
  getSuiAssemblyStateGeneration,
  isSuiAssemblyStateAuthoritative,
  runWithSuiAssemblyStates,
} from "./suiAssemblyState";
import { flushSuiStorageSync, readSuiStorageSyncStatus, type SuiStorageSyncStatus } from "./suiStorageSync";
import { flushSuiIndustrySync, readSuiIndustrySyncStatus, type SuiIndustrySyncStatus } from "./suiIndustrySync";

export type AssemblyLogisticsEndpointKind = "storage_unit" | "turret" | "field_storage" | "industry";
export type AssemblyLogisticsAuthority = {
  sourceAssemblyID: number;
  destinationAssemblyID: number;
  sourceOwnerID: number;
  destinationOwnerID: number;
  sourceCreateOnChain: boolean;
  destinationCreateOnChain: boolean;
  sourceKind?: AssemblyLogisticsEndpointKind;
  destinationKind?: AssemblyLogisticsEndpointKind;
};
export type AssemblyLogisticsChainState = "disabled" | "pending" | "synced" | "error";
export type AssemblyLogisticsChainStatus = {
  status: AssemblyLogisticsChainState;
  sourceStatus: AssemblyLogisticsChainState;
  destinationStatus: AssemblyLogisticsChainState;
  /** Turret ammunition is local; Sui confirms the assembly lifecycle only. */
  sourceInventoryMirror?: "none";
  destinationInventoryMirror?: "none";
};

function authorityError(code: string): never {
  throw Object.assign(new Error(code), { code });
}

function validate(request: AssemblyLogisticsAuthority) {
  if (!request || ![
    request.sourceAssemblyID, request.destinationAssemblyID,
    request.sourceOwnerID, request.destinationOwnerID,
  ].every(value => Number.isSafeInteger(value) && value > 0) ||
      request.sourceAssemblyID === request.destinationAssemblyID ||
      typeof request.sourceCreateOnChain !== "boolean" ||
      typeof request.destinationCreateOnChain !== "boolean") {
    authorityError("ASSEMBLY_LOGISTICS_IDENTITY_INVALID");
  }
  // Cross-owner custody requires the distinct grant/proof transaction flow.
  // A request-bus message (including faction delivery) cannot grant custody.
  if (request.sourceOwnerID !== request.destinationOwnerID) {
    authorityError("ASSEMBLY_LOGISTICS_CROSS_OWNER_PROOF_REQUIRED");
  }
  for (const [kind, chainBacked] of [
    [request.sourceKind ?? "storage_unit", request.sourceCreateOnChain],
    [request.destinationKind ?? "storage_unit", request.destinationCreateOnChain],
  ]) {
    if (!["storage_unit", "turret", "field_storage", "industry"].includes(String(kind)) ||
        (kind === "field_storage" && chainBacked)) authorityError("ASSEMBLY_LOGISTICS_ENDPOINT_UNSUPPORTED");
  }
}

/**
 * Refresh chain-backed endpoints on the existing serialized assembly worker.
 * The caller must revalidate both live owners, endpoint types, lifecycle, and
 * inventory inside the synchronous callback before its atomic durable commit.
 * This preserves the existing game-authoritative inventory mirror model; it
 * does not forge a player session or authorize cross-owner Move custody.
 */
export function runWithAssemblyLogisticsAuthority<T>(
  request: AssemblyLogisticsAuthority,
  commit: () => T,
): T | Promise<T> {
  validate(request);
  const ids = [
    ...(request.sourceCreateOnChain ? [request.sourceAssemblyID] : []),
    ...(request.destinationCreateOnChain ? [request.destinationAssemblyID] : []),
  ];
  if (!ids.length) return commit();
  // runWithSuiAssemblyStates deliberately permits local operations without a
  // worker. An explicitly chain-backed transfer must instead fail closed.
  if (!isSuiAssemblyStateAuthoritative()) {
    authorityError("ASSEMBLY_STATE_UNAVAILABLE");
  }
  return runWithSuiAssemblyStates(ids, commit);
}

function fingerprint(request: AssemblyLogisticsAuthority): string {
  const store = require("../inventory/itemStore");
  return JSON.stringify([request.sourceAssemblyID, request.destinationAssemblyID].map(assemblyID => {
    const assembly = store.findItemById(assemblyID);
    if (!assembly) authorityError("ASSEMBLY_NOT_FOUND");
    // Industry has per-lane flags; fingerprint all partitions owned by this
    // actor rather than assuming the Smart Storage flag.
    const rows = store.listContainerItems(request.sourceOwnerID, assemblyID)
      .map(item => ({
        itemID: item.itemID, ownerID: item.ownerID, locationID: item.locationID,
        flagID: item.flagID, typeID: item.typeID, singleton: item.singleton,
        quantity: item.stacksize ?? item.quantity,
        unitVolume: store.getInventoryItemUnitVolume(item),
      })).sort((left, right) => Number(left.itemID) - Number(right.itemID));
    return { assemblyID, ownerID: assembly.ownerID, typeID: assembly.typeID,
      locationID: assembly.locationID, customInfo: assembly.customInfo, rows };
  }));
}

function combine(sourceStatus: AssemblyLogisticsChainState,
  destinationStatus: AssemblyLogisticsChainState): AssemblyLogisticsChainStatus {
  const status = [sourceStatus, destinationStatus].includes("error") ? "error"
    : sourceStatus === "disabled" && destinationStatus === "disabled" ? "disabled"
      : [sourceStatus, destinationStatus].every(value => value === "synced" || value === "disabled")
        ? "synced" : "pending";
  return { status, sourceStatus, destinationStatus };
}

function confirmed(status: SuiStorageSyncStatus, storageUnitID: number,
  characterID: number): AssemblyLogisticsChainState {
  if (!status || status.storageUnitID !== storageUnitID || status.characterID !== characterID ||
      status.status === "disabled" || !["synced", "pending", "error"].includes(status.status)) return "error";
  if (status.status !== "synced") return status.status;
  const partition = status.chain?.partitions;
  return status.chain?.online === true && status.chain.synchronized === true &&
    partition?.length === 1 && partition[0].characterId === characterID &&
    partition[0].isOwner === true && partition[0].synchronized === true ? "synced" : "error";
}

function confirmedIndustry(status: SuiIndustrySyncStatus, facilityID: number,
  characterID: number): AssemblyLogisticsChainState {
  if (!status || status.facilityID !== facilityID || status.characterID !== characterID ||
      status.status === "disabled" || !["synced", "pending", "error"].includes(status.status)) return "error";
  if (status.status !== "synced") return status.status;
  return status.synchronized === true && status.productionMirrored === true &&
    status.laneStatesMirrored === true && /^0x[0-9a-f]{1,64}$/i.test(status.industryObjectID || "") &&
    /^0x[0-9a-f]{1,64}$/i.test(status.assemblyObjectID || "") ? "synced" : "error";
}

export function createAssemblyLogisticsChainSynchronizer(dependencies: {
  flush?: typeof flushSuiStorageSync;
  readStatus?: typeof readSuiStorageSyncStatus;
  flushIndustry?: typeof flushSuiIndustrySync;
  readIndustryStatus?: typeof readSuiIndustrySyncStatus;
  refreshLifecycle?: (request: AssemblyLogisticsAuthority) => Promise<unknown>;
  readFingerprint?: (request: AssemblyLogisticsAuthority) => string;
  readGeneration?: () => number;
} = {}) {
  const flush = dependencies.flush || flushSuiStorageSync;
  const read = dependencies.readStatus || readSuiStorageSyncStatus;
  const snapshot = dependencies.readFingerprint || fingerprint;
  const generation = dependencies.readGeneration || getSuiAssemblyStateGeneration;
  const flushIndustry = dependencies.flushIndustry || flushSuiIndustrySync;
  const readIndustry = dependencies.readIndustryStatus || readSuiIndustrySyncStatus;
  const refreshLifecycle = dependencies.refreshLifecycle || (async request =>
    runWithAssemblyLogisticsAuthority(request, () => undefined));
  /**
   * Run only AFTER releasing runWithAssemblyLogisticsAuthority: all these reads
   * acquire that same worker queue. Retry mirrors, never the committed move.
   * A chain error is a synchronization result, not evidence the game move failed.
   */
  return async function sync(request: AssemblyLogisticsAuthority): Promise<AssemblyLogisticsChainStatus> {
    try { validate(request); }
    catch { return combine("error", "error"); }
    const sourceEnabled = request.sourceCreateOnChain;
    const destinationEnabled = request.destinationCreateOnChain;
    if (!sourceEnabled && !destinationEnabled) return combine("disabled", "disabled");
    const sourceKind = request.sourceKind ?? "storage_unit";
    const destinationKind = request.destinationKind ?? "storage_unit";
    const sourceRequest = { storageUnitID: request.sourceAssemblyID, characterID: request.sourceOwnerID };
    const destinationRequest = { storageUnitID: request.destinationAssemblyID, characterID: request.destinationOwnerID };
    const describe = (result: AssemblyLogisticsChainStatus): AssemblyLogisticsChainStatus => ({
      ...result,
      ...(sourceEnabled && sourceKind === "turret" ? { sourceInventoryMirror: "none" as const } : {}),
      ...(destinationEnabled && destinationKind === "turret" ? { destinationInventoryMirror: "none" as const } : {}),
    });
    const readEndpoint = async (identity: typeof sourceRequest, kind: AssemblyLogisticsEndpointKind, enabled: boolean) => {
      if (!enabled) return "disabled" as const;
      if (kind === "turret") return "synced" as const; // lifecycle refreshed below
      if (kind === "industry") return confirmedIndustry(await readIndustry({
        facilityID: identity.storageUnitID, characterID: identity.characterID,
      }), identity.storageUnitID, identity.characterID);
      return confirmed(await read(identity), identity.storageUnitID, identity.characterID);
    };
    try {
      const currentGeneration = generation();
      // The shared worker flush scans all assembly inventories twice, including
      // both ends of this already committed transfer.
      if (sourceEnabled && sourceKind === "turret" || destinationEnabled && destinationKind === "turret") {
        await refreshLifecycle(request);
      }
      if (sourceEnabled && sourceKind === "industry" || destinationEnabled && destinationKind === "industry") {
        const endpoint = sourceEnabled && sourceKind === "industry" ? sourceRequest : destinationRequest;
        await flushIndustry({ facilityID: endpoint.storageUnitID, characterID: endpoint.characterID });
      } else if (sourceEnabled && sourceKind === "storage_unit" || destinationEnabled && destinationKind === "storage_unit") {
        await flush(sourceEnabled && sourceKind === "storage_unit" ? sourceRequest : destinationRequest);
      }
      if (generation() !== currentGeneration) throw new Error("Assembly synchronization worker changed");
      const before = snapshot(request);
      const [source, destination] = await Promise.all([
        readEndpoint(sourceRequest, sourceKind, sourceEnabled),
        readEndpoint(destinationRequest, destinationKind, destinationEnabled),
      ]);
      // Each endpoint guards its own async read. Also reject a deployment swap
      // BETWEEN those reads, even if both local inventory snapshots are equal.
      if (generation() !== currentGeneration) throw new Error("Assembly synchronization worker changed");
      const result = combine(source, destination);
      if (result.status === "synced" && before !== snapshot(request)) {
        return describe(combine(sourceEnabled ? "pending" : "disabled", destinationEnabled ? "pending" : "disabled"));
      }
      return describe(result);
    } catch {
      // Do not expose RPC errors, signer configuration, or deployment paths.
      return describe(combine(sourceEnabled ? "error" : "disabled", destinationEnabled ? "error" : "disabled"));
    }
  };
}

export const syncAssemblyLogisticsTransfer = createAssemblyLogisticsChainSynchronizer();
