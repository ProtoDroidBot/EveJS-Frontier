/** Shared cache of the deployed world's EnergyConfig; populated by read-only RPC. */
export const NETWORK_NODE_RADIUS_METERS = 80_000;
export const NETWORK_NODE_TYPE_ID = 88092;
export const DEFAULT_NETWORK_NODE_MAX_ENERGY = 1000;
let requirements: Map<number, number> | null = null;
let source: { energyConfigID: string; chainId?: string } | null = null;

export function setAssemblyEnergyConfig(entries: Array<{ typeID: number; energyRequired: number }>, origin?: { energyConfigID: string; chainId?: string }) {
  const next = new Map<number, number>();
  for (const entry of entries) {
    if (!Number.isSafeInteger(entry.typeID) || entry.typeID <= 0 ||
        !Number.isSafeInteger(entry.energyRequired) || entry.energyRequired < 0 || next.has(entry.typeID)) {
      throw new Error("Invalid or duplicate assembly energy configuration entry");
    }
    next.set(entry.typeID, entry.energyRequired);
  }
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
