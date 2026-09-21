import { bcs } from "@mysten/sui/bcs";
import { Transaction } from "@mysten/sui/transactions";
import { deriveObjectID, deriveDynamicFieldID, normalizeSuiAddress, isValidSuiAddress, SUI_CLOCK_OBJECT_ID } from "@mysten/sui/utils";
import type { SuiJsonRpcClient } from "@mysten/sui/jsonRpc";
import { suiAssemblyFields, type SuiAssemblyWorld } from "./suiAssemblyChain";
import type { AssemblySnapshot } from "./suiAssemblySnapshot";
import { industryU64, parseIndustryProduction, type IndustryFacilitySnapshot, type IndustrySnapshot, type IndustryProduction } from "./suiIndustrySnapshot";

const IndustryKey = bcs.struct("IndustryKey", { assembly_id: bcs.Address });
export function deriveSuiIndustryId(
  world: Pick<SuiAssemblyWorld, "packageId" | "objectRegistryId">,
  assemblyId: string,
  typeOrigin = world.packageId,
  industryRegistryId = world.objectRegistryId,
) {
  return deriveObjectID(industryRegistryId, `${typeOrigin}::smart_industry::IndustryKey`,
    IndustryKey.serialize({ assembly_id: assemblyId }).toBytes());
}
function sameID(a: any, b: string) { return typeof a === "string" && normalizeSuiAddress(a) === normalizeSuiAddress(b); }
function objectID(value: any): any { const field = suiAssemblyFields(value); return typeof field === "string" ? field : field?.id ?? field?.bytes; }

export function deriveSuiIndustryProductionId(industryId: string) {
  return deriveDynamicFieldID(industryId, "u8", bcs.u8().serialize(0).toBytes());
}
export function appendIndustryProduction(tx: Transaction, packageId: string, production: IndustryProduction | null) {
  const value = parseIndustryProduction(production);
  if (!value) return tx.moveCall({ target: `${packageId}::smart_industry::idle_production` });
  return tx.moveCall({ target: `${packageId}::smart_industry::new_production`, arguments: [
    tx.pure.u64(value.job_id), tx.pure.u8({ RUNNING: 1, DISCONTINUING: 2, STOPPED: 3 }[value.state]),
    tx.pure.u64(value.requested_runs ?? "0"), tx.pure.u64(value.completed_runs),
    tx.pure.u64(value.run_started_at_ms), tx.pure.u64(value.run_end_at_ms), tx.pure.string(value.stop_reason ?? ""),
  ] });
}
/** The typed dynamic field is owned by this sidecar. Revision binds both RPC reads. */
async function readProduction(client: Pick<SuiJsonRpcClient, "getObject">, industryId: string, revision: string, allowStaleRevision = false) {
  const response = await client.getObject({ id: deriveSuiIndustryProductionId(industryId), options: { showContent: true, showOwner: true } });
  if (response.error?.code === "notExists") return { production: null, productionMirrored: false };
  const content = response.data?.content;
  const owner = response.data?.owner;
  if (response.error || content?.dataType !== "moveObject" || !owner || typeof owner !== "object" ||
      !("ObjectOwner" in owner) || !sameID(owner.ObjectOwner, industryId) ||
      !/^0x0*2::dynamic_field::Field<u8, 0x[0-9a-f]+::smart_industry::ProductionRecord>$/.test(content.type)) {
    throw new Error("Cannot verify Smart Industry production field");
  }
  const fields = content.fields as any;
  const record = suiAssemblyFields(fields.value);
  if (Number(fields.name) !== 0) throw new Error("Cannot verify Smart Industry production field name");
  const productionMirrored = industryU64(record?.revision, "Production revision") === revision;
  if (!productionMirrored && !allowStaleRevision) {
    throw new Error("Smart Industry production revision changed; retry current snapshot");
  }
  const raw = suiAssemblyFields(record.production);
  const state = Number(raw?.state);
  if (state === 0) {
    if ([raw.job_id, raw.requested_runs, raw.completed_runs, raw.run_started_at_ms, raw.run_end_at_ms].some(value => industryU64(value, "Idle production", true) !== "0") || raw.stop_reason !== "") {
      throw new Error("Smart Industry idle production is invalid");
    }
    return { production: null, productionMirrored };
  }
  const production = parseIndustryProduction({ ...raw, state: ({ 1: "RUNNING", 2: "DISCONTINUING", 3: "STOPPED" } as any)[state],
    requested_runs: industryU64(raw?.requested_runs, "Requested runs", true) === "0" ? null : raw.requested_runs,
    stop_reason: raw?.stop_reason === "" ? null : raw?.stop_reason,
  });
  return { production, productionMirrored };
}

export function appendIndustrySnapshot(tx: Transaction, packageId: string, snapshot: IndustrySnapshot, typeOrigin = packageId) {
  const target = (name: string) => `${packageId}::smart_industry::${name}`;
  const stacks = (side: "inputs" | "outputs") => tx.makeMoveVec({ type: `${typeOrigin}::smart_industry::ItemStack`,
    elements: snapshot[side].map(slot => tx.moveCall({ target: target("new_item_stack"),
      arguments: [tx.pure.u64(slot.type_id), tx.pure.u64(slot.quantity)] })) });
  const recipe = (side: "blueprint_inputs" | "blueprint_outputs") => tx.makeMoveVec({ type: `${typeOrigin}::smart_industry::RecipeSlot`,
    elements: snapshot[side].map(slot => tx.moveCall({ target: target("new_recipe_slot"),
      arguments: [tx.pure.u64(slot.type_id), tx.pure.u64(slot.quantity), tx.pure.u64(slot.max_quantity)] })) });
  return tx.moveCall({ target: target("new_snapshot"), arguments: [
    tx.pure.u64(snapshot.owner_id), tx.pure.u64(snapshot.solar_system_id), tx.pure.u64(snapshot.blueprint_id), tx.pure.u64(snapshot.run_time),
    stacks("inputs"), stacks("outputs"), recipe("blueprint_inputs"), recipe("blueprint_outputs"),
  ] });
}

function readSnapshot(raw: any): IndustrySnapshot {
  const fields = suiAssemblyFields(raw);
  if (!fields || typeof fields !== "object") throw new Error("Smart Industry snapshot is missing");
  const slots = (side: string, recipe: boolean) => {
    if (!Array.isArray(fields[side]) || fields[side].length > 256) throw new Error("Smart Industry partition is invalid");
    let previous = 0n;
    return fields[side].map((raw: any) => {
      const value = suiAssemblyFields(raw);
      const type_id = industryU64(value?.type_id, "Chain item type");
      if (BigInt(type_id) <= previous) throw new Error("Smart Industry types are not unique and sorted");
      previous = BigInt(type_id);
      const quantity = industryU64(value?.quantity, "Chain item quantity");
      if (!recipe) return { type_id, quantity };
      const max_quantity = industryU64(value?.max_quantity, "Chain recipe capacity");
      if (BigInt(max_quantity) < BigInt(quantity)) throw new Error("Smart Industry recipe capacity is invalid");
      return { type_id, quantity, max_quantity };
    });
  };
  return {
    owner_id: industryU64(fields.owner_id, "Chain owner"), solar_system_id: industryU64(fields.solar_system_id, "Chain system"),
    blueprint_id: industryU64(fields.blueprint_id, "Chain blueprint", true), run_time: industryU64(fields.run_time, "Chain run time", true),
    inputs: slots("inputs", false), outputs: slots("outputs", false),
    blueprint_inputs: slots("blueprint_inputs", true) as IndustrySnapshot["blueprint_inputs"],
    blueprint_outputs: slots("blueprint_outputs", true) as IndustrySnapshot["blueprint_outputs"],
  };
}

export function createSuiIndustryChain(options: {
  client: Pick<SuiJsonRpcClient, "getObject">; world: SuiAssemblyWorld; tenant: string;
  chain: { deriveId(itemId: string): string; readAssembly(assembly: AssemblySnapshot): Promise<any> };
  execute(label: string, tx: Transaction, ownerId?: number, assertCurrent?: () => void): Promise<unknown>;
  assertSnapshotCurrent(facility: IndustryFacilitySnapshot): void;
  /** An upgrade can add this module while the underlying Assembly retains its original type. */
  industryPackageId?: string; industryTypeOrigin?: string; industryRegistryId?: string;
  now?: () => number;
}) {
  const { world, client, chain } = options;
  const packageId = normalizeSuiAddress(options.industryPackageId || world.packageId);
  const typeOrigin = normalizeSuiAddress(options.industryTypeOrigin || packageId);
  const registryId = normalizeSuiAddress(options.industryRegistryId || world.objectRegistryId);
  if (!isValidSuiAddress(packageId) || !isValidSuiAddress(typeOrigin) || !isValidSuiAddress(registryId)) {
    throw new Error("Invalid Smart Industry package, type origin or registry");
  }
  async function read(facility: IndustryFacilitySnapshot, assembly: AssemblySnapshot, repairProduction = false) {
    if (assembly.itemId !== facility.itemId || assembly.kind !== "assembly" || assembly.typeId !== facility.typeId ||
        String(assembly.ownerId) !== facility.snapshot.owner_id || String(assembly.solarSystemId) !== facility.snapshot.solar_system_id) {
      throw new Error("Smart Industry snapshot does not match its Assembly");
    }
    const underlying = await chain.readAssembly(assembly);
    if (!underlying) throw new Error("Industry Assembly has not synchronized yet");
    if (underlying.online !== (facility.status === 2)) throw new Error("Industry Assembly status changed; retry current snapshot");
    const assemblyId = chain.deriveId(facility.itemId);
    const industryObjectID = deriveSuiIndustryId(world, assemblyId, typeOrigin, registryId);
    const response = await client.getObject({ id: industryObjectID, options: { showContent: true, showType: true } });
    if (response.error?.code === "notExists") return { industryObjectID, assemblyObjectID: assemblyId, state: null };
    if (response.error || !response.data || response.data.type !== `${typeOrigin}::smart_industry::SmartIndustry` ||
        response.data.content?.dataType !== "moveObject") throw new Error("Cannot verify Smart Industry object");
    const fields = response.data.content.fields as any;
    const key = suiAssemblyFields(fields.assembly_key);
    if (!sameID(objectID(fields.assembly_id), assemblyId) || String(key?.id ?? key?.item_id) !== facility.itemId || key?.tenant !== options.tenant ||
        industryU64(fields.type_id, "Chain facility type") !== String(facility.typeId)) throw new Error("Smart Industry object belongs to a different Assembly");
    const state = {
      revision: industryU64(fields.revision, "Chain revision"), observedAtMs: industryU64(fields.observed_at_ms, "Chain observation time", true),
      syncedAtMs: industryU64(fields.synced_at_ms, "Chain synchronization time", true),
      status: Number(fields.assembly_status), snapshot: readSnapshot(fields.snapshot),
      ...await readProduction(client, industryObjectID, industryU64(fields.revision, "Chain revision"), repairProduction),
    };
    if (![1, 2].includes(state.status)) throw new Error("Smart Industry assembly status is invalid");
    return { industryObjectID, assemblyObjectID: assemblyId, state };
  }
  const matches = (state: Awaited<ReturnType<typeof read>>["state"], facility: IndustryFacilitySnapshot) =>
    Boolean(state && state.productionMirrored && state.status === facility.status && JSON.stringify(state.snapshot) === JSON.stringify(facility.snapshot) &&
      JSON.stringify(state.production) === JSON.stringify(facility.production));
  async function status(facility: IndustryFacilitySnapshot, assembly: AssemblySnapshot) {
    const result = await read(facility, assembly);
    return { industryObjectID: result.industryObjectID, assemblyObjectID: result.assemblyObjectID,
      synchronized: matches(result.state, facility), ...(result.state ? {
        revision: result.state.revision, observedAtMs: result.state.observedAtMs, syncedAtMs: result.state.syncedAtMs,
        productionMirrored: result.state.productionMirrored, chainProduction: result.state.production,
      } : {}) };
  }
  async function sync(facility: IndustryFacilitySnapshot, assembly: AssemblySnapshot) {
    options.assertSnapshotCurrent(facility);
    // An old package can still update the parent without its new dynamic field.
    // Repair only a verified field, using the latest parent's revision CAS.
    const previous = await read(facility, assembly, true);
    if (matches(previous.state, facility)) return;
    const now = BigInt(industryU64((options.now || Date.now)(), "Observation time"));
    const observed = previous.state && now <= BigInt(previous.state.observedAtMs) ? BigInt(previous.state.observedAtMs) + 1n : now;
    if (observed > now + 30_000n) throw new Error("Smart Industry observation is ahead of the local clock");
    const tx = new Transaction();
    const snapshot = appendIndustrySnapshot(tx, packageId, facility.snapshot, typeOrigin);
    const production = appendIndustryProduction(tx, packageId, facility.production);
    tx.moveCall({ target: `${packageId}::smart_industry::${previous.state ? "sync_with_production" : "create_with_production"}`,
      arguments: [tx.object(previous.state ? previous.industryObjectID : registryId),
        tx.object(previous.assemblyObjectID), tx.object(world.adminAclId),
        ...(previous.state ? [tx.pure.u64(previous.state.revision)] : []),
        tx.pure.u64(observed), snapshot, production, tx.object(SUI_CLOCK_OBJECT_ID)] });
    options.assertSnapshotCurrent(facility);
    await options.execute(`industry:${facility.itemId}:${previous.state ? "sync" : "create"}`, tx, undefined,
      () => options.assertSnapshotCurrent(facility));
    if (!(await status(facility, assembly)).synchronized) throw new Error("Smart Industry snapshot was not confirmed");
  }
  return { read, status, sync };
}
