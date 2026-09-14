import { publicIndustryStorageChain, type IndustryRequestReceipts } from "./smartIndustryStorageApi";

type Dependencies = Record<string, any> & {
  resolve: (authorization: unknown, facilityID: unknown) => any;
  failed: (code: unknown) => any;
  status: (authorization: unknown, facilityID: unknown, flush?: boolean) => Promise<any>;
};
type BlueprintRequest = {
  action: "blueprint" | "empty"; requestID: string; facilityID: number;
  expectedBlueprintID: string; expectedBlueprintHash: string | null; expectedJobID: string | null;
  blueprintID?: string; blueprintHash?: string; storageUnitID?: number;
};
const integer = (value: unknown, zero = false) => ["string", "number"].includes(typeof value) &&
  (zero ? /^(0|[1-9][0-9]*)$/ : /^[1-9][0-9]*$/).test(String(value)) && Number.isSafeInteger(Number(value));
const hash = (value: unknown) => typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
const recipeSlots = (slots: any) => Object.values<any>(slots).map(slot => ({
  type_id: String(slot.type_id), quantity: String(slot.quantity_per_run), max_quantity: String(slot.max_storable_quantity),
})).sort((left, right) => Number(left.type_id) - Number(right.type_id));

function blueprintCatalog(facilityTypeID: number) {
  const data = require("../../services/frontier/industryStaticData.json");
  const { getBlueprintForFacility } = require("../../services/frontier/industryBlueprints");
  const { getItemMetadata } = require("../../services/inventory/itemStore");
  return (data.facilities[facilityTypeID]?.blueprints || []).flatMap(({ blueprintID }) => {
    const blueprint = getBlueprintForFacility(facilityTypeID, blueprintID);
    if (!blueprint) return [];
    const typeID = data.blueprints[blueprintID]?.primaryTypeID;
    return [{ blueprintID: String(blueprint.blueprint_id), blueprintHash: blueprint.content_hash,
      name: String(getItemMetadata(typeID)?.name || `Blueprint ${blueprint.blueprint_id}`),
      runTime: String(blueprint.run_time), inputs: recipeSlots(blueprint.inputs), outputs: recipeSlots(blueprint.outputs) }];
  });
}

/** Blueprint changes and inventory clearing share receipt IDs with item transfers. */
export function createIndustryBlueprintOperations(dependencies: Dependencies) {
  const { resolve, failed, status } = dependencies;
  const runtime = () => require("../../services/frontier/industryRuntime");
  const validate = dependencies.validateFacility || ((session, id) => runtime().validateFacility(session, id));
  const settle = dependencies.settleProduction || ((id, session) =>
    require("../../services/frontier/industryProductionWorker").settleIndustryProduction(id, session));
  const readBlueprint = dependencies.readBlueprint || (facility =>
    require("../../services/frontier/industryBlueprints").getBlueprintForFacility(facility.typeId, facility.snapshot.blueprint_id));
  const getBlueprint = dependencies.getBlueprintForFacility || ((typeID, blueprintID) =>
    require("../../services/frontier/industryBlueprints").getBlueprintForFacility(typeID, blueprintID));
  const list = dependencies.listBlueprints || blueprintCatalog;
  const load = dependencies.loadBlueprint || ((...args) => runtime().loadBlueprint(...args));
  const empty = dependencies.emptyActiveBlueprint || ((...args) => runtime().emptyActiveBlueprint(...args));
  const notifyBlueprint = dependencies.publishBlueprint || ((session, facilityID) => {
    require("../../services/frontier/industryNotifications").publishIndustryBlueprintChanged(session, facilityID);
  });
  const notifyTransfer = dependencies.publishTransfer || ((session, result) =>
    require("../../services/frontier/industryService").publishIndustryTransferResult(session, result));
  const requests: IndustryRequestReceipts = dependencies.requests || new Map();

  async function mutate(action: "blueprint" | "empty", authorization: unknown, facilityID: unknown, body: any) {
    try {
      const context = resolve(authorization, facilityID);
      if (!context.success) return context;
      if (!body || typeof body !== "object" || Array.isArray(body) || typeof body.requestID !== "string" ||
          !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.requestID)) return failed("INVALID_REQUEST");
      if (!integer(body.expectedBlueprintID, true)) return failed("INVALID_BLUEPRINT_ID");
      if (String(body.expectedBlueprintID) === "0" ? body.expectedBlueprintHash !== null : !hash(body.expectedBlueprintHash)) {
        return failed("INVALID_BLUEPRINT_HASH");
      }
      if (body.expectedJobID !== null && !integer(body.expectedJobID)) return failed("INVALID_JOB_ID");
      if (action === "blueprint") {
        if (!integer(body.blueprintID)) return failed("INVALID_BLUEPRINT_ID");
        if (!hash(body.blueprintHash)) return failed("INVALID_BLUEPRINT_HASH");
      } else if (!integer(body.storageUnitID)) return failed("INVALID_ASSEMBLY_ID");
      const { characterID, walletAddress, session } = context.data;
      const request: BlueprintRequest = { action, requestID: body.requestID.toLowerCase(), facilityID: context.data.facilityID,
        expectedBlueprintID: String(body.expectedBlueprintID), expectedBlueprintHash: body.expectedBlueprintHash,
        expectedJobID: body.expectedJobID === null ? null : String(body.expectedJobID),
        ...(action === "blueprint" ? { blueprintID: String(body.blueprintID), blueprintHash: body.blueprintHash }
          : { storageUnitID: Number(body.storageUnitID) }) };
      const key = `${characterID}:${request.requestID}`;
      const fingerprint = JSON.stringify({ ...request, walletAddress });
      const prior = requests.get(key);
      if (prior) return prior.fingerprint === fingerprint ? prior.result : failed("INDUSTRY_REQUEST_CHANGED");
      if (requests.size >= 10000) return failed("TOO_MANY_REQUESTS");
      const assertAccess = () => {
        const latest = resolve(authorization, facilityID);
        if (!latest.success) return latest;
        if (latest.data.characterID !== characterID || latest.data.walletAddress !== walletAddress || latest.data.session !== session) {
          return failed("ACCESS_DENIED");
        }
        const valid = validate(session, request.facilityID);
        if (!valid.success) return failed(valid.errorMsg);
        const facility = latest.data.facility;
        if (facility.snapshot.blueprint_id !== request.expectedBlueprintID ||
            (readBlueprint(facility)?.content_hash || null) !== request.expectedBlueprintHash) return failed("BLUEPRINT_CHANGED");
        if ((facility.production?.job_id ?? null) !== request.expectedJobID) return failed("PRODUCTION_CHANGED");
        return latest;
      };
      // Register before any asynchronous storage checks: retries share the
      // original receipt even after the selection or stored items have changed.
      const result = Promise.resolve().then(async () => {
        let committed: any;
        try {
          let latest = assertAccess();
          if (!latest.success) return latest;
          const settled = settle(request.facilityID, session);
          if (!settled.success) return failed(settled.errorMsg);
          latest = assertAccess();
          if (!latest.success) return latest;
          if (latest.data.facility.production && latest.data.facility.production.state !== "STOPPED") return failed("PRODUCTION_ALREADY_RUNNING");
          if (action === "empty") {
            const moved = await empty(session, request.facilityID, request.storageUnitID, { assertAccess });
            if (!moved?.success) return failed(moved?.errorMsg);
            committed = { success: true as const, data: { requestID: request.requestID, gameCommitted: true,
              storageUnitID: request.storageUnitID, inputs: moved.data.itemsBySide.inputs, outputs: moved.data.itemsBySide.outputs,
              chain: publicIndustryStorageChain(moved.data.chain) } };
            try { notifyTransfer(session, moved); } catch { /* Inventory is already durable. */ }
          } else {
            const target = getBlueprint(latest.data.facility.typeId, Number(request.blueprintID));
            if (!target) return failed("BLUEPRINT_NOT_FOUND");
            if (target.content_hash !== request.blueprintHash) return failed("INVALID_BLUEPRINT_HASH");
            if (latest.data.facility.snapshot.inputs.length || latest.data.facility.snapshot.outputs.length) return failed("FACILITY_CONTAINS_ITEMS");
            // Prepare the committed snapshot before the synchronous mutation;
            // notifications and chain status must never erase its receipt.
            const facility = structuredClone(latest.data.facility);
            Object.assign(facility.snapshot, { blueprint_id: String(target.blueprint_id), run_time: String(target.run_time),
              blueprint_inputs: recipeSlots(target.inputs), blueprint_outputs: recipeSlots(target.outputs) });
            const changed = load(session, request.facilityID, Number(request.blueprintID));
            if (!changed?.success) return failed(changed?.errorMsg);
            committed = { success: true as const, data: { requestID: request.requestID, gameCommitted: true,
              selectedBlueprintID: request.blueprintID, facility, production: facility.production,
              blueprintHash: request.blueprintHash, chain: { status: "pending" } } };
            try { notifyBlueprint(session, request.facilityID, changed.data); } catch { /* Selection is already durable. */ }
            const refreshed = await status(authorization, facilityID, true);
            if (refreshed.success && JSON.stringify(refreshed.data.facility) === JSON.stringify(facility) &&
                refreshed.data.blueprintHash === request.blueprintHash) {
              committed.data.chain = refreshed.data.chain;
            }
          }
          return committed;
        } catch { return committed || failed("INDUSTRY_REQUEST_FAILED"); }
      });
      requests.set(key, { fingerprint, result });
      return result;
    } catch { return failed("INDUSTRY_REQUEST_FAILED"); }
  }

  return {
    async blueprints(authorization: unknown, facilityID: unknown) {
      try {
        const context = resolve(authorization, facilityID);
        if (!context.success) return context;
        const valid = validate(context.data.session, context.data.facilityID);
        if (!valid.success) return failed(valid.errorMsg);
        return { success: true as const, data: { blueprints: list(context.data.facility.typeId) } };
      } catch { return failed("INDUSTRY_REQUEST_FAILED"); }
    },
    blueprint: (authorization: unknown, facilityID: unknown, body: any) => mutate("blueprint", authorization, facilityID, body),
    empty: (authorization: unknown, facilityID: unknown, body: any) => mutate("empty", authorization, facilityID, body),
  };
}
