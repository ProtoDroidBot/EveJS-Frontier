import { createSmartStorageApi } from "./smartStorageEndpoints";
import { createIndustryStorageOperations } from "./smartIndustryStorageApi";
import { createIndustryBlueprintOperations } from "./smartIndustryBlueprintApi";
import { buildSuiIndustrySnapshot, industryFingerprint, parseIndustryProduction } from "../../services/frontier/suiIndustrySnapshot";
import { readSuiIndustrySyncStatus, flushSuiIndustrySync } from "../../services/frontier/suiIndustrySync";

const PREFIX = "/evejs/industry";
const MESSAGES: Record<string, string> = {
  AUTH_REQUIRED: "Connect your wallet to view Industry facilities.", AUTH_EXPIRED: "Your wallet session expired. Connect again.",
  INVALID_SIGNATURE: "The signature does not match the connection request.", INVALID_WALLET: "A valid Sui wallet is required.",
  CHARACTER_NOT_ONLINE: "Log into the game with your wallet's character.", MULTIPLE_ACTIVE_CHARACTERS: "Log into one character with this wallet.",
  ACCESS_DENIED: "Only the facility owner can operate this Industry facility.",
  INVALID_FACILITY_ID: "Select a valid Industry facility.", FACILITY_NOT_FOUND: "The completed Industry facility is unavailable.",
  INVALID_BLUEPRINT_ID: "Select a valid Industry blueprint.", INVALID_BLUEPRINT_HASH: "The blueprint changed. Refresh before trying again.",
  INVALID_RUN_COUNT: "Choose a positive whole number of runs, or continuous production.",
  INVALID_JOB_ID: "Refresh the facility's production status before starting a job.",
  PRODUCTION_CHANGED: "The facility's production changed. Refresh before trying again.",
  PRODUCTION_STATE_CHANGED: "The facility changed while starting production. Refresh before trying again.",
  PRODUCTION_ALREADY_RUNNING: "Production is already running at this facility.",
  FACILITY_OFFLINE: "Bring the Industry facility online before starting production.",
  FACILITY_NOT_IN_CURRENT_SYSTEM: "Undock in the Industry facility's solar system before starting production.",
  FACILITY_OUT_OF_RANGE: "Move within 5 km of the Industry facility before starting production.",
  ASSEMBLY_UNDER_CONSTRUCTION: "Wait for construction to finish before starting production.",
  ASSEMBLY_ACTIVATING: "Wait for the Industry facility's onlining timer to finish.",
  INVALID_SHIP: "Board a ship near the Industry facility before starting production.",
  BLUEPRINT_NOT_LOADED: "Load the selected blueprint in the game before starting production.",
  BLUEPRINT_NOT_FOUND: "The selected blueprint is unavailable for this Industry facility.",
  BLUEPRINT_ALREADY_LOADED: "This blueprint is already active at the Industry facility.",
  BLUEPRINT_CHANGED: "The active blueprint changed. Refresh before trying again.",
  FACILITY_CONTAINS_ITEMS: "Empty the active blueprint's input materials and output products into storage before changing it.",
  FACILITY_ALREADY_EMPTY: "The active blueprint's inputs and outputs are already empty.",
  INDUSTRY_REQUEST_CHANGED: "This request was already used for a different Industry action. Refresh before trying again.",
  INSUFFICIENT_INPUTS: "Deposit the materials for at least one run in the Industry facility.",
  OUTPUT_CAPACITY_EXCEEDED: "Withdraw stored products to make room for the next run.",
  INVALID_PRODUCTION_STATE: "The facility's saved production is unavailable. Refresh and try again.",
  INVALID_PRODUCTION_TIME: "The production schedule could not be created. Refresh and try again.",
  INVALID_ASSEMBLY_ID: "Select a valid Smart Storage Unit.",
  INVALID_QUANTITY: "Choose a positive whole item quantity within the storage limit.",
  INVALID_SOURCE: "The selected items are no longer in an accessible Smart Storage Unit.",
  INVALID_DESTINATION: "The destination Smart Storage Unit is unavailable or out of range.",
  INVALID_DESTINATION_TYPE: "The destination cannot hold this item type.",
  INVALID_INPUT_TYPE: "This item is not an input for the loaded Industry blueprint.",
  SINGLETON_NOT_ACCEPTED: "Only stackable items can be transferred.",
  INPUT_CAPACITY_EXCEEDED: "The Industry input slot does not have room for that quantity.",
  STORAGE_CAPACITY_EXCEEDED: "Your Smart Storage inventory does not have enough free capacity.",
  STORAGE_TYPE_QUANTITY_EXCEEDED: "That item type would exceed the Smart Storage quantity limit.",
  INSUFFICIENT_SOURCE_ITEMS: "The Smart Storage Unit no longer holds that quantity.",
  INSUFFICIENT_STORED_ITEMS: "The Industry facility no longer holds that quantity.",
  ASSEMBLY_OFFLINE: "Bring the Smart Storage Unit online before transferring items.",
  ASSEMBLY_NOT_FOUND: "The Smart Storage Unit is unavailable.",
  ASSEMBLY_NOT_IN_CURRENT_SYSTEM: "The Smart Storage Unit must be in your current system.",
  ASSEMBLY_OUT_OF_RANGE: "Move within 5 km of the Smart Storage Unit.",
  ASSEMBLY_STATE_UNAVAILABLE: "The assemblies' blockchain state could not be verified. Try again shortly.",
  ASSEMBLY_STATE_PENDING: "An assembly state change is awaiting blockchain confirmation. Try again shortly.",
  TRANSFER_REQUEST_CHANGED: "This transfer request was already used with different items. Refresh before transferring again.",
  TOO_MANY_REQUESTS: "Too many wallet challenges are active. Try again shortly.",
  INDUSTRY_REQUEST_FAILED: "The Industry request failed. Refresh and try again.", INVALID_REQUEST: "The Industry request is invalid.",
};
function failed(code: any) {
  const errorMsg = typeof code === "string" && Object.hasOwn(MESSAGES, code) ? code : "INDUSTRY_REQUEST_FAILED";
  return { success: false as const, errorMsg, message: MESSAGES[errorMsg] };
}
function positiveInteger(value: unknown) {
  return (typeof value === "string" || typeof value === "number") && /^[1-9][0-9]*$/.test(String(value)) &&
    Number.isSafeInteger(Number(value));
}
export function createSmartIndustryApi(overrides: Record<string, any> = {}) {
  const auth = overrides.auth || createSmartStorageApi(overrides.authDependencies, {
    scope: "Smart Industry operations",
    description: "This signature authorizes reading your Industry facilities and available blueprints, changing active blueprints, emptying all blueprint inputs and outputs into nearby Smart Storage Units, transferring your items between nearby Smart Storage Units and Industry facilities, starting server production jobs that consume their stored materials, and synchronizing their blueprints, production status, and inventories with the blockchain.",
  });
  const readFacility = overrides.readFacility || ((facilityID: number) => buildSuiIndustrySnapshot(
    require("../../services/inventory/itemStore").getAllItems()).facilities.find(f => f.itemId === String(facilityID)));
  const readChain = overrides.readChain || readSuiIndustrySyncStatus;
  const flushChain = overrides.flushChain || flushSuiIndustrySync;
  const readBlueprint = overrides.readBlueprint || ((facility: any) => require("../../services/frontier/industryBlueprints")
    .getBlueprintForFacility(facility.typeId, facility.snapshot.blueprint_id));
  const validateFacility = overrides.validateFacility || ((session: any, id: number) => require("../../services/frontier/industryRuntime").validateFacility(session, id));
  const settleProduction = overrides.settleProduction || ((id: number, session: any) => require("../../services/frontier/industryProductionWorker").settleIndustryProduction(id, session));
  const startProduction = overrides.startProduction || ((...args: any[]) => require("../../services/frontier/industryRuntime").startProduction(...args));
  const trackProduction = overrides.trackProduction || ((facility: any) => require("../../services/frontier/industryProductionWorker").trackIndustryProduction(facility));
  const publishProduction = overrides.publishProduction || ((result: any, session: any) => require("../../services/frontier/industryNotifications").publishIndustryProductionResult(result, session));
  function snapshotData(facility: any) {
    return { facility, production: facility.production, blueprintHash: readBlueprint(facility)?.content_hash || null };
  }
  function resolve(authorization: unknown, rawID: unknown) {
    const identity = auth.authenticate(authorization);
    if (!identity?.success) return failed(identity?.errorMsg);
    if (!/^[1-9][0-9]*$/.test(String(rawID)) || !Number.isSafeInteger(Number(rawID))) return failed("INVALID_FACILITY_ID");
    const facilityID = Number(rawID);
    const facility = readFacility(facilityID);
    if (!facility) return failed("FACILITY_NOT_FOUND");
    if (facility.snapshot.owner_id !== String(identity.data.characterID)) return failed("ACCESS_DENIED");
    return { success: true as const, data: { ...identity.data, facilityID, facility } };
  }
  async function status(authorization: unknown, rawID: unknown, flush = false) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const context = resolve(authorization, rawID);
      if (!context.success) return context;
      const { facilityID, characterID } = context.data;
      const request = { facilityID, characterID };
      const pending = { ...request, status: "pending" };
      const work = Promise.resolve().then(() => flush ? flushChain(request) : readChain(request)).catch(() => ({ ...request, status: "error" }));
      const result: any = await Promise.race([work, new Promise(resolve => {
        timer = setTimeout(() => resolve(pending), overrides.chainWaitMs ?? 5000);
      })]);
      const latest = resolve(authorization, rawID);
      if (!latest.success) return latest;
      if (latest.data.characterID !== characterID || latest.data.walletAddress !== context.data.walletAddress) return failed("ACCESS_DENIED");
      const valid = result?.facilityID === facilityID && result?.characterID === characterID && ["disabled", "pending", "synced", "error"].includes(result?.status);
      const chain: any = { status: valid ? result.status : "error" };
      // Whitelist public object identifiers and revision timestamps. Internal
      // errors can contain deployment paths and must not cross the HTTP API.
      if (valid) {
        for (const key of ["assemblyObjectID", "industryObjectID"]) if (/^0x[0-9a-f]{1,64}$/i.test(result[key] || "")) chain[key] = result[key];
        for (const key of ["revision", "observedAtMs", "syncedAtMs"]) if (typeof result[key] === "string" && /^\d+$/.test(result[key])) chain[key] = result[key];
        if (typeof result.productionMirrored === "boolean") chain.productionMirrored = result.productionMirrored;
        if (typeof result.laneStatesMirrored === "boolean") chain.laneStatesMirrored = result.laneStatesMirrored;
        if (Object.hasOwn(result, "chainProduction")) chain.production = parseIndustryProduction(result.chainProduction);
      }
      if (chain.status === "synced" && (result.synchronized !== true || !chain.industryObjectID || !chain.assemblyObjectID ||
          chain.productionMirrored !== true || chain.laneStatesMirrored !== true ||
          JSON.stringify(chain.production) !== JSON.stringify(latest.data.facility.production) ||
          industryFingerprint(latest.data.facility) !== industryFingerprint(context.data.facility))) chain.status = "pending";
      return { success: true as const, data: { ...snapshotData(latest.data.facility), chain } };
    } catch { return failed("INDUSTRY_REQUEST_FAILED"); }
    finally { if (timer) clearTimeout(timer); }
  }
  const requests = new Map();
  return {
    ...createIndustryStorageOperations({ ...overrides, resolve, failed, requests }),
    ...createIndustryBlueprintOperations({ ...overrides, resolve, failed, status, requests }),
    async challenge(body: any) { const result = await auth.challenge({ walletAddress: body?.walletAddress }); return result.success ? result : failed(result.errorMsg); },
    async session(body: any) { const result = await auth.session({ challengeId: body?.challengeId, signature: body?.signature }); return result.success ? result : failed(result.errorMsg); },
    status: (authorization: unknown, facilityID: unknown) => status(authorization, facilityID),
    sync: (authorization: unknown, facilityID: unknown) => status(authorization, facilityID, true),
    async start(authorization: unknown, rawID: unknown, body: any) {
      let committed: any;
      try {
        let context = resolve(authorization, rawID);
        if (!context.success) return context;
        if (!body || typeof body !== "object" || Array.isArray(body)) return failed("INVALID_REQUEST");
        if (!positiveInteger(body.blueprintID)) return failed("INVALID_BLUEPRINT_ID");
        if (typeof body.blueprintHash !== "string" || !/^[0-9a-f]{64}$/.test(body.blueprintHash)) return failed("INVALID_BLUEPRINT_HASH");
        if (body.runs !== null && !positiveInteger(body.runs)) return failed("INVALID_RUN_COUNT");
        if (body.expectedJobID !== null && !positiveInteger(body.expectedJobID)) return failed("INVALID_JOB_ID");
        const expectedJobID = body.expectedJobID === null ? null : String(body.expectedJobID);
        if ((context.data.facility.production?.job_id ?? null) !== expectedJobID) return failed("PRODUCTION_CHANGED");
        const { facilityID, session, characterID, walletAddress } = context.data;
        // Use the live game session so ownership, ship, distance, construction,
        // online state and escrow checks are identical to in-game production.
        const access = validateFacility(session, facilityID);
        if (!access.success) return failed(access.errorMsg);
        const settled = settleProduction(facilityID, session);
        if (!settled.success) return failed(settled.errorMsg);
        context = resolve(authorization, rawID);
        if (!context.success) return context;
        if (context.data.characterID !== characterID || context.data.walletAddress !== walletAddress) return failed("ACCESS_DENIED");
        if ((context.data.facility.production?.job_id ?? null) !== expectedJobID) return failed("PRODUCTION_CHANGED");
        // No await between reading the job ID and the atomic inventory commit.
        // Retrying this request cannot start a second job, even after completion.
        const result = startProduction(context.data.session, facilityID, Number(body.blueprintID), body.blueprintHash,
          body.runs === null ? null : Number(body.runs));
        if (!result.success) return failed(result.errorMsg);
        const production = result.data.production;
        const publicProduction = parseIndustryProduction({ job_id: production.jobID, state: production.state,
          requested_runs: production.requestedRuns, completed_runs: production.completedRuns,
          run_started_at_ms: production.runStartedAtMs, run_end_at_ms: production.runEndAtMs, stop_reason: production.stopReason });
        // Start commits exactly one paid run after catch-up. Capture that
        // transition before notifications or chain I/O can fail independently.
        const facility = structuredClone(context.data.facility);
        facility.production = publicProduction;
        for (const input of facility.snapshot.inputs) {
          const consumed = facility.snapshot.blueprint_inputs.find((slot: any) => slot.type_id === input.type_id)?.quantity || "0";
          input.quantity = String(BigInt(input.quantity) - BigInt(consumed));
        }
        facility.snapshot.inputs = facility.snapshot.inputs.filter((input: any) => input.quantity !== "0");
        committed = { success: true as const, data: { facility, production: publicProduction,
          blueprintHash: body.blueprintHash, gameCommitted: true, startedJobID: String(production.jobID), chain: { status: "pending" } } };
        // Tracking comes first so a notification failure cannot strand the job.
        try { trackProduction(result.data.facility); } catch { /* Persisted jobs are recoverable when the worker restarts. */ }
        try { publishProduction(result, context.data.session); } catch { /* The durable job remains committed. */ }
        const refreshed = await status(authorization, rawID, true);
        return refreshed.success ? { success: true as const, data: { ...refreshed.data,
          gameCommitted: true, startedJobID: committed.data.startedJobID } } : committed;
      } catch {
        return committed || failed("INDUSTRY_REQUEST_FAILED");
      }
    },
  };
}

export function mountSmartIndustryEndpoints(app: any, options: Record<string, any> = {}) {
  let api: ReturnType<typeof createSmartIndustryApi>;
  const getApi = () => api || (api = options.api || createSmartIndustryApi());
  const origins = new Set(String(process.env.EVEJS_INDUSTRY_DAPP_ORIGINS || process.env.EVEJS_ADMIN_DAPP_ORIGINS ||
    process.env.EVEJS_STORAGE_DAPP_ORIGINS || "https://localhost,https://127.0.0.1,https://dev.dapps.evefrontier.com").split(",").map(value => value.trim()));
  app.use(PREFIX, (error: any, req: any, res: any, _next: any) => {
    res.set("Cache-Control", "no-store"); res.vary("Origin");
    if (req.headers.origin && !origins.has(req.headers.origin)) { res.status(403).json(failed("ACCESS_DENIED")); return; }
    if (req.headers.origin) res.set("Access-Control-Allow-Origin", req.headers.origin);
    res.status(error?.type === "entity.too.large" ? 413 : 400).json(failed("INVALID_REQUEST"));
  });
  app.use(PREFIX, (req: any, res: any, next: any) => {
    res.set("Cache-Control", "no-store"); res.vary("Origin");
    if (req.headers.origin && !origins.has(req.headers.origin)) { res.status(403).json(failed("ACCESS_DENIED")); return; }
    if (req.headers.origin) {
      res.set("Access-Control-Allow-Origin", req.headers.origin);
      res.set("Access-Control-Allow-Headers", "Authorization, Content-Type");
      res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
    }
    if (req.method === "OPTIONS") { res.sendStatus(204); return; }
    next();
  });
  const route = (handler: (service: ReturnType<typeof createSmartIndustryApi>, req: any) => Promise<any>) => async (req: any, res: any) => {
    try {
      const result = await handler(getApi(), req);
      const code = result.success ? 200 : ["ACCESS_DENIED", "FACILITY_OUT_OF_RANGE", "FACILITY_NOT_IN_CURRENT_SYSTEM"].includes(result.errorMsg) ? 403 : result.errorMsg === "FACILITY_NOT_FOUND" ? 404
        : result.errorMsg === "TOO_MANY_REQUESTS" ? 429 : /^(AUTH_|INVALID_SIGNATURE|CHARACTER_|MULTIPLE_)/.test(result.errorMsg) ? 401
          : /^INVALID_/.test(result.errorMsg) ? 400 : result.errorMsg === "INDUSTRY_REQUEST_FAILED" ? 500 : 409;
      res.status(code).json(result);
    } catch { res.status(500).json(failed("INDUSTRY_REQUEST_FAILED")); }
  };
  app.post(`${PREFIX}/auth/challenge`, route((service, req) => service.challenge(req.body)));
  app.post(`${PREFIX}/auth/session`, route((service, req) => service.session(req.body)));
  for (const action of ["status", "sync"] as const) app.post(`${PREFIX}/:facilityID/${action}`,
    route((service, req) => service[action](req.headers.authorization, req.params.facilityID)));
  app.post(`${PREFIX}/:facilityID/start`, route((service, req) => service.start(req.headers.authorization, req.params.facilityID, req.body)));
  app.post(`${PREFIX}/:facilityID/storage`, route((service, req) => service.storage(req.headers.authorization, req.params.facilityID)));
  app.post(`${PREFIX}/:facilityID/transfer`, route((service, req) => service.transfer(req.headers.authorization, req.params.facilityID, req.body)));
  app.post(`${PREFIX}/:facilityID/storage-sync`, route((service, req) => service.storageSync(req.headers.authorization, req.params.facilityID, req.body)));
  app.post(`${PREFIX}/:facilityID/blueprints`, route((service, req) => service.blueprints(req.headers.authorization, req.params.facilityID)));
  for (const action of ["blueprint", "empty"] as const) app.post(`${PREFIX}/:facilityID/${action}`,
    route((service, req) => service[action](req.headers.authorization, req.params.facilityID, req.body)));
}
