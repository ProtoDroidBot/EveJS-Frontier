/** Pure snapshot of Frontier's selected blueprint and server escrow inventories. */
const blueprints = require("./industryBlueprints");
const industryProduction = require("./industryProduction");

export type IndustryItemStack = { type_id: string; quantity: string };
export type IndustryRecipeSlot = IndustryItemStack & { max_quantity: string };
export type IndustryProduction = {
  job_id: string; state: "RUNNING" | "DISCONTINUING" | "STOPPED";
  requested_runs: string | null; completed_runs: string;
  run_started_at_ms: string; run_end_at_ms: string; stop_reason: string | null;
};
export type IndustryLaneProduction = { lane_id: string; production: IndustryProduction | null };
export type IndustryLaneState = {
  lane_id: string;
  snapshot: IndustrySnapshot;
  production: IndustryProduction | null;
};
export type IndustrySnapshot = {
  owner_id: string; solar_system_id: string; blueprint_id: string; run_time: string;
  inputs: IndustryItemStack[]; outputs: IndustryItemStack[];
  blueprint_inputs: IndustryRecipeSlot[]; blueprint_outputs: IndustryRecipeSlot[];
};
export type IndustryFacilitySnapshot = {
  itemId: string; typeId: number; status: 1 | 2; snapshot: IndustrySnapshot;
  /** Lane one compatibility projection retained for older status consumers. */
  production: IndustryProduction | null;
  productions: IndustryLaneProduction[];
  /** Complete revision-bound lane state used by current chain mirrors. */
  lanes: IndustryLaneState[];
};
const U64_MAX = (1n << 64n) - 1n;

export function industryU64(value: unknown, label: string, zero = false): string {
  if (!(["number", "string", "bigint"].includes(typeof value)) ||
      (typeof value === "number" && !Number.isSafeInteger(value)) || !/^\d+$/.test(String(value))) {
    throw new Error(`${label} must be an exact unsigned integer`);
  }
  const n = BigInt(value as any);
  if (n > U64_MAX || (!zero && n === 0n)) throw new Error(`${label} is outside the supported u64 range`);
  return n.toString();
}
/** Canonical representation shared by fingerprints, chain comparison and HTTP. */
export function parseIndustryProduction(value: any): IndustryProduction | null {
  if (value == null) return null;
  if (typeof value !== "object" || Array.isArray(value) || !["RUNNING", "DISCONTINUING", "STOPPED"].includes(value.state)) {
    throw new Error("Industry production state is invalid");
  }
  const production: IndustryProduction = {
    job_id: industryU64(value.job_id, "Production job ID"), state: value.state,
    requested_runs: value.requested_runs === null ? null : industryU64(value.requested_runs, "Requested runs"),
    completed_runs: industryU64(value.completed_runs, "Completed runs", true),
    run_started_at_ms: industryU64(value.run_started_at_ms, "Run start time", true),
    run_end_at_ms: industryU64(value.run_end_at_ms, "Run end time", true),
    stop_reason: value.stop_reason,
  };
  if (production.stop_reason !== null && (typeof production.stop_reason !== "string" || !/^[A-Z][A-Z0-9_]{0,63}$/.test(production.stop_reason))) {
    throw new Error("Industry production stop reason is invalid");
  }
  if (BigInt(production.run_end_at_ms) <= BigInt(production.run_started_at_ms) ||
      (production.requested_runs !== null && (BigInt(production.completed_runs) > BigInt(production.requested_runs) ||
      (production.state !== "STOPPED" && BigInt(production.completed_runs) === BigInt(production.requested_runs))))) {
    throw new Error("Industry production progress is invalid");
  }
  if ((production.state === "STOPPED") !== (production.stop_reason !== null)) throw new Error("Industry production stop state is inconsistent");
  if (production.stop_reason === "COMPLETED" && (production.requested_runs === null || production.completed_runs !== production.requested_runs)) {
    throw new Error("Industry completed production has unfinished runs");
  }
  return production;
}
function info(value: any): any {
  if (typeof value === "string") return value.trim() ? JSON.parse(value) : {};
  if (value == null) return {};
  if (typeof value !== "object" || Array.isArray(value)) throw new Error("Facility customInfo is invalid");
  return value;
}
function sort<T extends IndustryItemStack>(slots: T[]): T[] {
  if (slots.length > 256) throw new Error("Industry snapshot exceeds 256 item types per partition");
  return slots.sort((a, b) => BigInt(a.type_id) < BigInt(b.type_id) ? -1 : 1);
}
export function industryFingerprint(facility: IndustryFacilitySnapshot | undefined): string {
  return JSON.stringify(facility);
}

/** Input must be one captured itemStore.getAllItems() value, including escrow rows. */
export function buildSuiIndustrySnapshot(items: Record<string, any> | any[]): {
  facilities: IndustryFacilitySnapshot[]; errors: Array<{ itemId: string; message: string }>;
} {
  const entries = Array.isArray(items) ? items.map(item => [null, item] as const) : Object.entries(items);
  const facilities: IndustryFacilitySnapshot[] = [];
  const errors: Array<{ itemId: string; message: string }> = [];
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const [key, item] of entries) {
    if (!item || !blueprints.isIndustryFacilityType(item.typeID)) continue;
    let itemId = String(item.itemID ?? key);
    try {
      const custom = info(item.customInfo);
      const construction = custom.evejsFrontierConstruction;
      // Carried facility items and construction sites have no chain Assembly yet.
      if (!construction || Number(construction.assemblyStatus) === 5) continue;
      itemId = industryU64(item.itemID ?? key, "Facility ID");
      if (seen.has(itemId)) { duplicates.add(itemId); throw new Error("Duplicate facility ID"); }
      seen.add(itemId);
      const typeId = Number(industryU64(item.typeID, "Facility type ID"));
      if (industryU64(construction.assemblyTypeID, "Construction type ID") !== String(typeId)) throw new Error("Facility and construction types differ");
      const owner = industryU64(item.ownerID, "Facility owner ID");
      if (construction.ownerID !== undefined && industryU64(construction.ownerID, "Construction owner ID") !== owner) throw new Error("Facility and construction owners differ");
      const system = industryU64(construction.solarSystemID ?? item.locationID, "Solar system ID");
      if (industryU64(item.locationID, "Facility location") !== system) throw new Error("Facility and construction systems differ");
      const status = Number(construction.assemblyStatus);
      if (status !== 1 && status !== 2) throw new Error("Completed facility must be offline or online");
      const selected = custom.evejsFrontierIndustry;
      if (selected !== undefined && (!selected || typeof selected !== "object" || Array.isArray(selected))) throw new Error("Industry selection metadata is invalid");
      if (industryProduction.invalidStoredProduction(item)) {
        throw new Error("Unsupported Industry production version");
      }
      const productions: IndustryLaneProduction[] = industryProduction.getProductions(item)
        .map(({ laneID, production: job }) => ({
          lane_id: industryU64(laneID, "Industry lane ID"),
          production: job == null ? null : parseIndustryProduction({
            job_id: job.jobID, state: job.state, requested_runs: job.requestedRuns,
            completed_runs: job.completedRuns, run_started_at_ms: job.runStartedAtMs,
            run_end_at_ms: job.runEndAtMs, stop_reason: job.stopReason,
          }),
        }));
      const production = productions.find((lane) => lane.lane_id === "1")?.production ?? null;
      const totals = (flag: number): IndustryItemStack[] => {
        const totals = new Map<string, bigint>();
        const rowIDs = new Set<string>();
        for (const [rowKey, row] of entries) {
          if (!row || String(row.locationID) !== itemId || Number(row.flagID) !== flag || String(row.ownerID) !== owner) continue;
          const rowID = industryU64(row.itemID ?? rowKey, "Escrow item ID");
          if (rowIDs.has(rowID)) throw new Error("Duplicate escrow item ID");
          rowIDs.add(rowID);
          const type = industryU64(row.typeID, "Escrow type ID");
          const quantity = industryU64(row.singleton ? 1 : row.stacksize ?? row.quantity, "Escrow quantity");
          const total = (totals.get(type) || 0n) + BigInt(quantity);
          industryU64(total, "Escrow total");
          totals.set(type, total);
        }
        return sort([...totals].map(([type_id, quantity]) => ({ type_id, quantity: quantity.toString() })));
      };
      const lanes: IndustryLaneState[] = productions.map((lane) => {
        const laneID = Number(industryU64(lane.lane_id, "Industry lane ID"));
        const blueprint = blueprints.getSelectedBlueprint(item, laneID);
        const storedBlueprintID = selected?.lanes?.[String(laneID)]?.blueprintID ??
          (laneID === 1 ? selected?.blueprintID : undefined);
        if (storedBlueprintID !== undefined && !blueprint) {
          throw new Error(`Industry lane ${laneID} selected blueprint is not supported by this facility`);
        }
        if (lane.production && !blueprint) {
          throw new Error(`Industry lane ${laneID} production requires a blueprint`);
        }
        const recipe = (side: string): IndustryRecipeSlot[] => sort(
          Object.values<any>(blueprint?.[side] || {}).map(slot => ({
            type_id: industryU64(slot.type_id, "Recipe type ID"),
            quantity: industryU64(slot.quantity_per_run, "Recipe quantity"),
            max_quantity: industryU64(slot.max_storable_quantity, "Recipe capacity"),
          })),
        );
        const inputFlag = 20000 + (laneID - 1) * 2;
        return {
          lane_id: String(laneID),
          production: lane.production,
          snapshot: {
            owner_id: owner,
            solar_system_id: system,
            blueprint_id: blueprint ? industryU64(blueprint.blueprint_id, "Blueprint ID") : "0",
            run_time: blueprint ? industryU64(blueprint.run_time, "Blueprint run time") : "0",
            inputs: totals(inputFlag),
            outputs: totals(inputFlag + 1),
            blueprint_inputs: recipe("inputs"),
            blueprint_outputs: recipe("outputs"),
          },
        };
      });
      if (!lanes.length || lanes[0].lane_id !== "1") {
        throw new Error("Industry lane one is required");
      }
      facilities.push({
        itemId,
        typeId,
        status,
        production,
        productions,
        lanes,
        snapshot: lanes[0].snapshot,
      });
    } catch (error) { errors.push({ itemId, message: error instanceof Error ? error.message : String(error) }); }
  }
  return { facilities: facilities.filter(f => !duplicates.has(f.itemId)).sort((a, b) => BigInt(a.itemId) < BigInt(b.itemId) ? -1 : 1), errors };
}
