/** Shared cache of the deployed world's EnergyConfig; populated by read-only RPC. */
export const NETWORK_NODE_RADIUS_METERS = 80_000;
export const NETWORK_NODE_TYPE_ID = 88092;
export const DEFAULT_NETWORK_NODE_MAX_ENERGY = 1000;
let requirements: Map<number, number> | null = null;
let source: { energyConfigID: string; chainId?: string } | null = null;

type EnergyEntry = { typeID: number; energyRequired: number };

function energyMap(entries: ReadonlyArray<EnergyEntry>, label: string) {
  const result = new Map<number, number>();
  for (const entry of entries) {
    if (!Number.isSafeInteger(entry.typeID) || entry.typeID <= 0 ||
        !Number.isSafeInteger(entry.energyRequired) || entry.energyRequired < 0 || result.has(entry.typeID)) {
      throw new Error(`Invalid or duplicate assembly energy entry in ${label}`);
    }
    result.set(entry.typeID, entry.energyRequired);
  }
  return result;
}

/** Require the synchronized world manifest, static client catalog and chain table to agree exactly. */
export function assertAssemblyEnergyConfigMatches(
  chainEntries: ReadonlyArray<EnergyEntry>,
  manifestEntries: ReadonlyArray<EnergyEntry> | null | undefined,
  componentRows: any[],
) {
  if (!manifestEntries) {
    throw new Error("Synchronized world has no assembly energy manifest; run FrontierWorld.ps1 sync");
  }
  const manifest = energyMap(manifestEntries, "Assembly energy manifest");
  const chain = energyMap(chainEntries, "On-chain EnergyConfig");
  const catalog = new Set(componentRows
    .filter(row => Number(row.smartDeployable?.createOnChain) === 1)
    .map(row => Number(row.typeID ?? row._key))
    .filter(typeID => Number.isSafeInteger(typeID) && typeID > 0));
  const missingManifest = [...catalog].filter(typeID => !manifest.has(typeID));
  const staleManifest = [...manifest.keys()].filter(typeID => !catalog.has(typeID));
  if (missingManifest.length || staleManifest.length) {
    throw new Error(`Assembly energy manifest does not match the client catalog` +
      `${missingManifest.length ? ` (missing ${missingManifest.join(", ")})` : ""}` +
      `${staleManifest.length ? ` (unsupported ${staleManifest.join(", ")})` : ""}`);
  }
  if ((manifest.get(NETWORK_NODE_TYPE_ID) ?? -1) !== 0) {
    throw new Error("Network Node energy requirement must be zero");
  }
  const mismatches: string[] = [];
  for (const [typeID, expected] of manifest) {
    const actual = chain.get(typeID);
    if (expected === 0 ? actual !== undefined : actual !== expected) {
      mismatches.push(`${typeID}: expected ${expected}, chain ${actual ?? "absent"}`);
    }
  }
  for (const typeID of chain.keys()) {
    if (!manifest.has(typeID)) mismatches.push(`${typeID}: not in manifest`);
  }
  if (mismatches.length) {
    throw new Error(`On-chain EnergyConfig differs from the synchronized manifest (${mismatches.join("; ")})`);
  }
}

export function setAssemblyEnergyConfig(entries: Array<EnergyEntry>, origin?: { energyConfigID: string; chainId?: string }) {
  const next = energyMap(entries, "EnergyConfig");
  requirements = next;
  source = origin || null;
}
export function clearAssemblyEnergyConfig() { requirements = null; source = null; }
export function isAssemblyEnergyConfigLoaded() { return requirements !== null; }
export function getAssemblyEnergyConfigSource() { return source && { ...source }; }
export function getConfiguredAssemblyEnergyRequirements() {
  return [...(requirements || new Map<number, number>())].map(([typeID, energyRequired]) => ({ typeID, energyRequired }))
    .sort((a, b) => a.typeID - b.typeID);
}

export function getAssemblyEnergyRequirements(rows: any[]) {
  return rows.filter(row => Number(row.smartDeployable?.createOnChain) === 1)
    .map(row => {
      const typeID = Number(row.typeID ?? row._key);
      return {
        typeID,
        // Move's energy::assembly_energy returns zero for a missing table entry.
        energyRequired: typeID === NETWORK_NODE_TYPE_ID ? 0 : requirements?.get(typeID) ?? 0,
      };
    }).filter(row => Number.isSafeInteger(row.typeID) && row.typeID > 0)
    .sort((a, b) => a.typeID - b.typeID);
}
