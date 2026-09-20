import path from "node:path";
import { bcs } from "@mysten/sui/bcs";
import { SuiJsonRpcClient } from "@mysten/sui/jsonRpc";
import { Transaction } from "@mysten/sui/transactions";
import { deriveObjectID, normalizeSuiAddress } from "@mysten/sui/utils";
import {
  readSyncedSuiWorldConfig,
  resolveSuiCharacterWorld,
} from "./suiCharacterProvisioning";

export const TURRET_BEHAVIOUR_UNSPECIFIED = 0;
export const TURRET_BEHAVIOUR_ENTERED = 1;
export const TURRET_BEHAVIOUR_STARTED_ATTACK = 2;
export const TURRET_BEHAVIOUR_STOPPED_ATTACK = 3;

export type SuiTurretTargetCandidate = {
  item_id: bigint;
  type_id: bigint;
  group_id: bigint;
  character_id: number;
  character_tribe: number;
  hp_ratio: bigint;
  shield_ratio: bigint;
  armor_ratio: bigint;
  is_aggressor: boolean;
  priority_weight: bigint;
  behaviour_change: number;
};

export type SuiTurretPriorityEntry = {
  target_item_id: bigint;
  priority_weight: bigint;
};

export type SuiTurretPriorityRequest = {
  turretItemID: string | number | bigint;
  ownerCharacterID: string | number | bigint;
  candidates: SuiTurretTargetCandidate[];
};

export type SuiTurretPriorityResolver = {
  resolve: (request: SuiTurretPriorityRequest) => Promise<SuiTurretPriorityEntry[]>;
};

const TargetCandidateBcs = bcs.struct("TargetCandidate", {
  item_id: bcs.u64(),
  type_id: bcs.u64(),
  group_id: bcs.u64(),
  character_id: bcs.u32(),
  character_tribe: bcs.u32(),
  hp_ratio: bcs.u64(),
  shield_ratio: bcs.u64(),
  armor_ratio: bcs.u64(),
  is_aggressor: bcs.bool(),
  priority_weight: bcs.u64(),
  behaviour_change: bcs.u8(),
});

const ReturnTargetPriorityListBcs = bcs.struct("ReturnTargetPriorityList", {
  target_item_id: bcs.u64(),
  priority_weight: bcs.u64(),
});

const TenantItemId = bcs.struct("TenantItemId", {
  id: bcs.u64(),
  tenant: bcs.string(),
});

const U64_MAX = (1n << 64n) - 1n;
const U32_MAX = 0xffff_ffff;
const DEFAULT_RPC_URL = "http://127.0.0.1:9000";
const DEFAULT_REQUEST_TIMEOUT_MS = 5_000;

function u64(value: unknown, label: string): bigint {
  let parsed: bigint;
  try {
    parsed = BigInt(value as string | number | bigint);
  } catch (_) {
    throw new TypeError(`${label} is not a u64`);
  }
  if (parsed < 0n || parsed > U64_MAX) throw new TypeError(`${label} is not a u64`);
  return parsed;
}

function u32(value: unknown, label: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0 || parsed > U32_MAX) {
    throw new TypeError(`${label} is not a u32`);
  }
  return parsed;
}

function u8(value: unknown, label: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0 || parsed > 0xff) {
    throw new TypeError(`${label} is not a u8`);
  }
  return parsed;
}

function normalizeCandidate(candidate: SuiTurretTargetCandidate): SuiTurretTargetCandidate {
  return {
    item_id: u64(candidate.item_id, "Target item ID"),
    type_id: u64(candidate.type_id, "Target type ID"),
    group_id: u64(candidate.group_id, "Target group ID"),
    character_id: u32(candidate.character_id, "Target character ID"),
    character_tribe: u32(candidate.character_tribe, "Target tribe"),
    hp_ratio: u64(candidate.hp_ratio, "Target hull ratio"),
    shield_ratio: u64(candidate.shield_ratio, "Target shield ratio"),
    armor_ratio: u64(candidate.armor_ratio, "Target armor ratio"),
    is_aggressor: candidate.is_aggressor === true,
    priority_weight: u64(candidate.priority_weight, "Target priority weight"),
    behaviour_change: u8(candidate.behaviour_change, "Target behaviour change"),
  };
}

export function serializeSuiTurretCandidates(candidates: SuiTurretTargetCandidate[]): number[] {
  return Array.from(
    bcs.vector(TargetCandidateBcs).serialize(candidates.map(normalizeCandidate)).toBytes(),
  );
}

export function parseSuiTurretPriorityList(returnBytes: Uint8Array | number[]): SuiTurretPriorityEntry[] {
  const bytes = returnBytes instanceof Uint8Array ? returnBytes : new Uint8Array(returnBytes);
  if (bytes.length === 0) return [];
  const inner = new Uint8Array(bcs.vector(bcs.u8()).parse(bytes));
  if (inner.length === 0) return [];
  return bcs.vector(ReturnTargetPriorityListBcs).parse(inner).map((entry: any) => ({
    target_item_id: u64(entry.target_item_id, "Returned target item ID"),
    priority_weight: u64(entry.priority_weight, "Returned target priority weight"),
  }));
}

export function evaluateDefaultSuiTurretPriority(
  candidates: SuiTurretTargetCandidate[],
  ownerCharacterID: number,
  ownerTribe: number,
): SuiTurretPriorityEntry[] {
  const ownerID = u32(ownerCharacterID, "Owner character ID");
  const tribeID = u32(ownerTribe, "Owner tribe");
  const result: SuiTurretPriorityEntry[] = [];
  for (const rawCandidate of candidates) {
    const candidate = normalizeCandidate(rawCandidate);
    const isOwner = candidate.character_id !== 0 && candidate.character_id === ownerID;
    const sameTribe = candidate.character_tribe === tribeID;
    let excluded = isOwner || (sameTribe && !candidate.is_aggressor);
    let weight = candidate.priority_weight;
    if (candidate.behaviour_change === TURRET_BEHAVIOUR_STOPPED_ATTACK) {
      excluded = true;
    } else if (candidate.behaviour_change === TURRET_BEHAVIOUR_STARTED_ATTACK) {
      weight = weight + 10_000n;
    } else if (
      candidate.behaviour_change === TURRET_BEHAVIOUR_ENTERED &&
      (!sameTribe || candidate.is_aggressor)
    ) {
      weight = weight + 1_000n;
    }
    if (!excluded) result.push({ target_item_id: candidate.item_id, priority_weight: weight });
  }
  return result;
}

function deriveTenantObjectID(
  objectRegistryId: string,
  packageId: string,
  tenant: string,
  itemID: string | number | bigint,
): string {
  return deriveObjectID(
    objectRegistryId,
    `${packageId}::in_game_id::TenantItemId`,
    TenantItemId.serialize({ id: u64(itemID, "Tenant item ID"), tenant }).toBytes(),
  );
}

function firstReturnBytes(result: any, commandIndex: number): Uint8Array {
  const raw = result?.results?.[commandIndex]?.returnValues?.[0]?.[0];
  if (!raw) return new Uint8Array();
  return raw instanceof Uint8Array ? raw : new Uint8Array(raw);
}

function assertDevInspectSuccess(result: any): void {
  if (result?.effects?.status?.status !== "success") {
    const detail = result?.effects?.status?.error ?? result?.effects?.status ?? "unknown failure";
    throw new Error(`Sui turret priority inspection failed: ${JSON.stringify(detail)}`);
  }
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout | null = null;
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs} ms`)), timeoutMs);
      timer.unref?.();
    }),
  ]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

type ExtensionInfo = {
  packageId: string | null;
  moduleName: string | null;
};

export function createSuiTurretPriorityResolver(options: Record<string, any> = {}): SuiTurretPriorityResolver {
  let cachedContext: any = null;

  function context() {
    if (options.client && options.world) {
      return {
        client: options.client,
        packageId: normalizeSuiAddress(options.world.packageId),
        objectRegistryId: normalizeSuiAddress(options.world.objectRegistryId),
        tenant: String(options.world.tenant || "dev"),
        sender: normalizeSuiAddress(options.sender || "0x0"),
      };
    }
    const config = require("../../config");
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      EVEJS_SUI_WORLD_CONFIG_PATH: process.env.EVEJS_SUI_WORLD_CONFIG_PATH || path.resolve(
        __dirname,
        "../../../../_local/frontier-world",
        String(config.clientBuild),
        "world.private.json",
      ),
    };
    const synced = readSyncedSuiWorldConfig(env);
    if (!synced) throw new Error("The synchronized Sui world is unavailable");
    const world = resolveSuiCharacterWorld({}, env);
    const key = `${synced.chainId}:${world.packageId}:${world.objectRegistryId}`;
    if (cachedContext?.key === key) return cachedContext;
    cachedContext = {
      key,
      client: new SuiJsonRpcClient({
        url: String(env.EVEJS_SUI_RPC_URL || DEFAULT_RPC_URL),
        network: "localnet",
      }),
      packageId: world.packageId,
      objectRegistryId: world.objectRegistryId,
      tenant: world.tenant,
      sender: normalizeSuiAddress(env.EVEJS_SUI_DEV_INSPECT_SENDER || "0x0"),
    };
    return cachedContext;
  }

  async function inspect(tx: Transaction, label: string) {
    const current = context();
    const timeoutMs = Math.max(
      1_000,
      Number(options.timeoutMs || process.env.EVEJS_SUI_TURRET_RPC_TIMEOUT_MS) ||
        DEFAULT_REQUEST_TIMEOUT_MS,
    );
    const result = await withTimeout(
      current.client.devInspectTransactionBlock({
        sender: current.sender,
        transactionBlock: tx,
      }),
      timeoutMs,
      label,
    );
    assertDevInspectSuccess(result);
    return result;
  }

  async function extensionInfo(turretObjectID: string): Promise<ExtensionInfo> {
    const current = context();
    const configuredTx = new Transaction();
    configuredTx.moveCall({
      target: `${current.packageId}::turret::is_extension_configured`,
      arguments: [configuredTx.object(turretObjectID)],
    });
    const configuredResult = await inspect(configuredTx, "Sui turret extension lookup");
    const configured = firstReturnBytes(configuredResult, 0)[0] === 1;
    let info: ExtensionInfo = {
      packageId: null,
      moduleName: null,
    };
    if (configured) {
      const typeTx = new Transaction();
      typeTx.moveCall({
        target: `${current.packageId}::turret::extension_type`,
        arguments: [typeTx.object(turretObjectID)],
      });
      const typeResult = await inspect(typeTx, "Sui turret extension type lookup");
      const typeNameBytes = bcs.vector(bcs.u8()).parse(firstReturnBytes(typeResult, 0));
      const typeName = new TextDecoder().decode(new Uint8Array(typeNameBytes));
      const [address] = typeName.split("::");
      if (!address) throw new Error("Configured turret extension has no package address");
      info = {
        packageId: normalizeSuiAddress(address.startsWith("0x") ? address : `0x${address}`),
        moduleName: "turret",
      };
    }
    return info;
  }

  async function resolve(request: SuiTurretPriorityRequest): Promise<SuiTurretPriorityEntry[]> {
    const current = context();
    const turretObjectID = deriveTenantObjectID(
      current.objectRegistryId,
      current.packageId,
      current.tenant,
      request.turretItemID,
    );
    const characterObjectID = deriveTenantObjectID(
      current.objectRegistryId,
      current.packageId,
      current.tenant,
      request.ownerCharacterID,
    );
    const extension = await extensionInfo(turretObjectID);
    const candidateBytes = serializeSuiTurretCandidates(request.candidates);
    const tx = new Transaction();
    const [receipt] = tx.moveCall({
      target: `${current.packageId}::turret::verify_online`,
      arguments: [tx.object(turretObjectID)],
    });
    tx.moveCall({
      target: `${extension.packageId || current.packageId}::${extension.moduleName || "turret"}::get_target_priority_list`,
      arguments: [
        tx.object(turretObjectID),
        tx.object(characterObjectID),
        tx.pure(bcs.vector(bcs.u8()).serialize(candidateBytes).toBytes()),
        receipt,
      ],
    });
    const result = await inspect(tx, "Sui turret target-priority evaluation");
    const entries = parseSuiTurretPriorityList(firstReturnBytes(result, 1));
    const candidateIDs = new Set(request.candidates.map((candidate) => candidate.item_id.toString()));
    const seen = new Set<string>();
    return entries.filter((entry) => {
      const itemID = entry.target_item_id.toString();
      if (!candidateIDs.has(itemID) || seen.has(itemID)) return false;
      seen.add(itemID);
      return true;
    });
  }

  return { resolve };
}

let defaultResolver: SuiTurretPriorityResolver | null = null;

export function getDefaultSuiTurretPriorityResolver(): SuiTurretPriorityResolver {
  if (!defaultResolver) defaultResolver = createSuiTurretPriorityResolver();
  return defaultResolver;
}

export function clearDefaultSuiTurretPriorityResolver(): void {
  defaultResolver = null;
}
