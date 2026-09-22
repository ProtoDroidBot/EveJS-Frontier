import { bcs } from "@mysten/sui/bcs";
import { Transaction } from "@mysten/sui/transactions";
import { deriveObjectID, deriveDynamicFieldID, normalizeSuiAddress, isValidSuiAddress, SUI_CLOCK_OBJECT_ID } from "@mysten/sui/utils";
import type { SuiJsonRpcClient } from "@mysten/sui/jsonRpc";
import { suiAssemblyFields, type SuiAssemblyWorld } from "./suiAssemblyChain";
import type { AssemblySnapshot } from "./suiAssemblySnapshot";
import { industryU64, parseIndustryProduction, type IndustryFacilitySnapshot, type IndustrySnapshot, type IndustryProduction, type IndustryLaneProduction, type IndustryLaneState } from "./suiIndustrySnapshot";

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
function facilityProductions(facility: IndustryFacilitySnapshot): IndustryLaneProduction[] {
  const lanes = Array.isArray(facility.productions) && facility.productions.length
    ? facility.productions.map((lane) => ({ ...lane }))
    : [{ lane_id: "1", production: facility.production }];
  const laneOne = lanes.find((lane) => lane.lane_id === "1");
  if (laneOne) laneOne.production = facility.production;
  return lanes;
}
function facilityLaneStates(facility: IndustryFacilitySnapshot): IndustryLaneState[] {
  if (Array.isArray(facility.lanes) && facility.lanes.length) {
    return facility.lanes.map((lane) => ({
      lane_id: lane.lane_id,
      snapshot: lane.lane_id === "1" ? facility.snapshot : lane.snapshot,
      production: lane.lane_id === "1" ? facility.production : lane.production,
    }));
  }
  return [{ lane_id: "1", snapshot: facility.snapshot, production: facility.production }];
}

export function deriveSuiIndustryProductionId(industryId: string) {
  return deriveDynamicFieldID(industryId, "u8", bcs.u8().serialize(0).toBytes());
}
export function deriveSuiIndustryLaneProductionId(industryId: string) {
  return deriveDynamicFieldID(industryId, "u8", bcs.u8().serialize(1).toBytes());
}
export function deriveSuiIndustryLaneStateId(industryId: string) {
  return deriveDynamicFieldID(industryId, "u8", bcs.u8().serialize(2).toBytes());
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
export function appendIndustryLaneProductions(
  tx: Transaction,
  packageId: string,
  productions: IndustryLaneProduction[],
  typeOrigin = packageId,
) {
  if (!Array.isArray(productions) || productions.length === 0 || productions.length > 16) {
    throw new Error("Smart Industry lanes are invalid");
  }
  let previous = 0n;
  const elements = productions.map((lane) => {
    const laneID = industryU64(lane.lane_id, "Industry lane ID");
    if (BigInt(laneID) <= previous || BigInt(laneID) > 16n) throw new Error("Smart Industry lanes are not unique and sorted");
    previous = BigInt(laneID);
    return tx.moveCall({ target: `${packageId}::smart_industry::new_lane_production`, arguments: [
      tx.pure.u64(laneID), appendIndustryProduction(tx, packageId, lane.production),
    ] });
  });
  if (productions[0].lane_id !== "1") throw new Error("Smart Industry lane one is required");
  return tx.makeMoveVec({ type: `${typeOrigin}::smart_industry::LaneProduction`, elements });
}
export function appendIndustryLaneStates(
  tx: Transaction,
  packageId: string,
  lanes: IndustryLaneState[],
  typeOrigin = packageId,
) {
  if (!Array.isArray(lanes) || lanes.length === 0 || lanes.length > 16) {
    throw new Error("Smart Industry lane states are invalid");
  }
  let previous = 0n;
  const elements = lanes.map((lane) => {
    const laneID = industryU64(lane.lane_id, "Industry lane ID");
    if (BigInt(laneID) <= previous || BigInt(laneID) > 16n) {
      throw new Error("Smart Industry lane states are not unique and sorted");
    }
    previous = BigInt(laneID);
    return tx.moveCall({ target: `${packageId}::smart_industry::new_lane_state`, arguments: [
      tx.pure.u64(laneID),
      appendIndustrySnapshot(tx, packageId, lane.snapshot, typeOrigin),
      appendIndustryProduction(tx, packageId, lane.production),
    ] });
  });
  if (lanes[0].lane_id !== "1") throw new Error("Smart Industry lane one is required");
  // LaneState may have been introduced by an upgraded package, so its type
  // origin need not match the older Snapshot/ItemStack type origin. Every
  // vector is non-empty; let the PTB infer the element type from the
  // new_lane_state results instead of encoding a potentially stale origin.
  return tx.makeMoveVec({ elements });
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

async function readLaneProductions(
  client: Pick<SuiJsonRpcClient, "getObject">,
  industryId: string,
  revision: string,
  allowStaleRevision = false,
) {
  const response = await client.getObject({
    id: deriveSuiIndustryLaneProductionId(industryId),
    options: { showContent: true, showOwner: true },
  });
  if (response.error?.code === "notExists") {
    const legacy = await readProduction(client, industryId, revision, allowStaleRevision);
    return {
      productions: [{ lane_id: "1", production: legacy.production }],
      productionsMirrored: legacy.productionMirrored,
      legacyProjection: true,
    };
  }
  const content = response.data?.content;
  const owner = response.data?.owner;
  if (response.error || content?.dataType !== "moveObject" || !owner || typeof owner !== "object" ||
      !("ObjectOwner" in owner) || !sameID(owner.ObjectOwner, industryId) ||
      !/^0x0*2::dynamic_field::Field<u8, 0x[0-9a-f]+::smart_industry::LaneProductionRecord>$/.test(content.type)) {
    throw new Error("Cannot verify Smart Industry lane production field");
  }
  const fields = content.fields as any;
  const record = suiAssemblyFields(fields.value);
  if (Number(fields.name) !== 1 || !Array.isArray(record?.lanes) ||
      record.lanes.length === 0 || record.lanes.length > 16) {
    throw new Error("Cannot verify Smart Industry lane production field name");
  }
  const productionsMirrored = industryU64(record.revision, "Lane production revision") === revision;
  if (!productionsMirrored && !allowStaleRevision) {
    throw new Error("Smart Industry lane production revision changed; retry current snapshot");
  }
  let previous = 0n;
  const productions = record.lanes.map((rawLane: any): IndustryLaneProduction => {
    const lane = suiAssemblyFields(rawLane);
    const lane_id = industryU64(lane?.lane_id, "Chain lane ID");
    if (BigInt(lane_id) <= previous || BigInt(lane_id) > 16n) {
      throw new Error("Smart Industry chain lanes are not unique and sorted");
    }
    previous = BigInt(lane_id);
    const raw = suiAssemblyFields(lane?.production);
    const state = Number(raw?.state);
    if (state === 0) {
      if ([raw?.job_id, raw?.requested_runs, raw?.completed_runs, raw?.run_started_at_ms, raw?.run_end_at_ms]
        .some((value) => industryU64(value, "Idle lane production", true) !== "0") || raw?.stop_reason !== "") {
        throw new Error("Smart Industry idle lane production is invalid");
      }
      return { lane_id, production: null };
    }
    return { lane_id, production: parseIndustryProduction({
      ...raw,
      state: ({ 1: "RUNNING", 2: "DISCONTINUING", 3: "STOPPED" } as any)[state],
      requested_runs: industryU64(raw?.requested_runs, "Requested runs", true) === "0" ? null : raw.requested_runs,
      stop_reason: raw?.stop_reason === "" ? null : raw?.stop_reason,
    }) };
  });
  if (productions[0].lane_id !== "1") throw new Error("Smart Industry chain lane one is missing");
  return { productions, productionsMirrored, legacyProjection: false };
}

async function readLaneStates(
  client: Pick<SuiJsonRpcClient, "getObject">,
  industryId: string,
  revision: string,
  rootSnapshot: IndustrySnapshot,
  allowStaleRevision = false,
) {
  const response = await client.getObject({
    id: deriveSuiIndustryLaneStateId(industryId),
    options: { showContent: true, showOwner: true },
  });
  if (response.error?.code === "notExists") {
    const legacy = await readLaneProductions(client, industryId, revision, allowStaleRevision);
    return {
      ...legacy,
      lanes: legacy.productions.map((lane) => ({
        lane_id: lane.lane_id,
        snapshot: rootSnapshot,
        production: lane.production,
      })),
      laneStatesMirrored: false,
      legacyProjection: true,
    };
  }
  const content = response.data?.content;
  const owner = response.data?.owner;
  if (response.error || content?.dataType !== "moveObject" || !owner || typeof owner !== "object" ||
      !("ObjectOwner" in owner) || !sameID(owner.ObjectOwner, industryId) ||
      !/^0x0*2::dynamic_field::Field<u8, 0x[0-9a-f]+::smart_industry::LaneStateRecord>$/.test(content.type)) {
    throw new Error("Cannot verify Smart Industry lane state field");
  }
  const fields = content.fields as any;
  const record = suiAssemblyFields(fields.value);
  if (Number(fields.name) !== 2 || !Array.isArray(record?.lanes) ||
      record.lanes.length === 0 || record.lanes.length > 16) {
    throw new Error("Cannot verify Smart Industry lane state field name");
  }
  const laneStatesMirrored = industryU64(record.revision, "Lane state revision") === revision;
  if (!laneStatesMirrored && !allowStaleRevision) {
    throw new Error("Smart Industry lane state revision changed; retry current snapshot");
  }
  let previous = 0n;
  const lanes = record.lanes.map((rawLane: any): IndustryLaneState => {
    const lane = suiAssemblyFields(rawLane);
    const lane_id = industryU64(lane?.lane_id, "Chain lane ID");
    if (BigInt(lane_id) <= previous || BigInt(lane_id) > 16n) {
      throw new Error("Smart Industry chain lane states are not unique and sorted");
    }
    previous = BigInt(lane_id);
    const raw = suiAssemblyFields(lane?.production);
    const state = Number(raw?.state);
    let production: IndustryProduction | null;
    if (state === 0) {
      if ([raw?.job_id, raw?.requested_runs, raw?.completed_runs, raw?.run_started_at_ms, raw?.run_end_at_ms]
        .some((value) => industryU64(value, "Idle lane production", true) !== "0") || raw?.stop_reason !== "") {
        throw new Error("Smart Industry idle lane production is invalid");
      }
      production = null;
    } else {
      production = parseIndustryProduction({
        ...raw,
        state: ({ 1: "RUNNING", 2: "DISCONTINUING", 3: "STOPPED" } as any)[state],
        requested_runs: industryU64(raw?.requested_runs, "Requested runs", true) === "0" ? null : raw.requested_runs,
        stop_reason: raw?.stop_reason === "" ? null : raw?.stop_reason,
      });
    }
    const snapshot = readSnapshot(lane?.snapshot);
    if (production && snapshot.blueprint_id === "0") {
      throw new Error("Smart Industry lane production has no blueprint");
    }
    return { lane_id, snapshot, production };
  });
  if (lanes[0].lane_id !== "1") throw new Error("Smart Industry chain lane one is missing");
  if (JSON.stringify(lanes[0].snapshot) !== JSON.stringify(rootSnapshot)) {
    throw new Error("Smart Industry lane-one snapshot does not match its compatibility projection");
  }
  const productions = lanes.map(({ lane_id, production }) => ({ lane_id, production }));
  return {
    lanes,
    laneStatesMirrored,
    productions,
    productionsMirrored: laneStatesMirrored,
    production: productions[0].production,
    productionMirrored: laneStatesMirrored,
    legacyProjection: false,
  };
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
    const rootSnapshot = readSnapshot(fields.snapshot);
    const state = {
      revision: industryU64(fields.revision, "Chain revision"), observedAtMs: industryU64(fields.observed_at_ms, "Chain observation time", true),
      syncedAtMs: industryU64(fields.synced_at_ms, "Chain synchronization time", true),
      status: Number(fields.assembly_status), snapshot: rootSnapshot,
      ...await readLaneStates(client, industryObjectID, industryU64(fields.revision, "Chain revision"), rootSnapshot, repairProduction),
    };
    if (![1, 2].includes(state.status)) throw new Error("Smart Industry assembly status is invalid");
    return { industryObjectID, assemblyObjectID: assemblyId, state };
  }
  const matches = (state: Awaited<ReturnType<typeof read>>["state"], facility: IndustryFacilitySnapshot) =>
    Boolean(state && state.laneStatesMirrored && state.status === facility.status &&
      JSON.stringify(state.snapshot) === JSON.stringify(facility.snapshot) &&
      JSON.stringify(state.lanes) === JSON.stringify(facilityLaneStates(facility)));
  async function status(facility: IndustryFacilitySnapshot, assembly: AssemblySnapshot) {
    const result = await read(facility, assembly);
    return { industryObjectID: result.industryObjectID, assemblyObjectID: result.assemblyObjectID,
      synchronized: matches(result.state, facility), ...(result.state ? {
        revision: result.state.revision, observedAtMs: result.state.observedAtMs, syncedAtMs: result.state.syncedAtMs,
        productionMirrored: result.state.productionsMirrored,
        productionsMirrored: result.state.productionsMirrored,
        laneStatesMirrored: result.state.laneStatesMirrored,
        chainProduction: result.state.productions.find((lane) => lane.lane_id === "1")?.production ?? null,
        chainProductions: result.state.productions,
        chainLanes: result.state.lanes,
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
    const lanes = appendIndustryLaneStates(tx, packageId, facilityLaneStates(facility), typeOrigin);
    tx.moveCall({ target: `${packageId}::smart_industry::${previous.state ? "sync_with_lane_states" : "create_with_lane_states"}`,
      arguments: [tx.object(previous.state ? previous.industryObjectID : registryId),
        tx.object(previous.assemblyObjectID), tx.object(world.adminAclId),
        ...(previous.state ? [tx.pure.u64(previous.state.revision)] : []),
        tx.pure.u64(observed), lanes, tx.object(SUI_CLOCK_OBJECT_ID)] });
    options.assertSnapshotCurrent(facility);
    await options.execute(`industry:${facility.itemId}:${previous.state ? "sync" : "create"}`, tx, undefined,
      () => options.assertSnapshotCurrent(facility));
    if (!(await status(facility, assembly)).synchronized) throw new Error("Smart Industry snapshot was not confirmed");
  }
  return { read, status, sync };
}
