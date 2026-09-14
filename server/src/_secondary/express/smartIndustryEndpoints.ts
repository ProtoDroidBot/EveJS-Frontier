import { createSmartStorageApi } from "./smartStorageEndpoints";
import { buildSuiIndustrySnapshot, industryFingerprint, parseIndustryProduction } from "../../services/frontier/suiIndustrySnapshot";
import { readSuiIndustrySyncStatus, flushSuiIndustrySync } from "../../services/frontier/suiIndustrySync";

const PREFIX = "/evejs/industry";
const MESSAGES: Record<string, string> = {
  AUTH_REQUIRED: "Connect your wallet to view Industry facilities.", AUTH_EXPIRED: "Your wallet session expired. Connect again.",
  INVALID_SIGNATURE: "The signature does not match the connection request.", INVALID_WALLET: "A valid Sui wallet is required.",
  CHARACTER_NOT_ONLINE: "Log into the game with your wallet's character.", MULTIPLE_ACTIVE_CHARACTERS: "Log into one character with this wallet.",
  ACCESS_DENIED: "Only the facility owner can read its live inventory or request synchronization.",
  INVALID_FACILITY_ID: "Select a valid Industry facility.", FACILITY_NOT_FOUND: "The completed Industry facility is unavailable.",
  TOO_MANY_REQUESTS: "Too many wallet challenges are active. Try again shortly.",
  INDUSTRY_REQUEST_FAILED: "The Industry request failed. Refresh and try again.", INVALID_REQUEST: "The Industry request is invalid.",
};
function failed(code: any) {
  const errorMsg = typeof code === "string" && Object.hasOwn(MESSAGES, code) ? code : "INDUSTRY_REQUEST_FAILED";
  return { success: false as const, errorMsg, message: MESSAGES[errorMsg] };
}
export function createSmartIndustryApi(overrides: Record<string, any> = {}) {
  const auth = overrides.auth || createSmartStorageApi(overrides.authDependencies, {
    scope: "Smart Industry synchronization",
    description: "This signature authorizes reading your Industry facilities and synchronizing their blueprints, production status, and inventory snapshots with the blockchain.",
  });
  const readFacility = overrides.readFacility || ((facilityID: number) => buildSuiIndustrySnapshot(
    require("../../services/inventory/itemStore").getAllItems()).facilities.find(f => f.itemId === String(facilityID)));
  const readChain = overrides.readChain || readSuiIndustrySyncStatus;
  const flushChain = overrides.flushChain || flushSuiIndustrySync;
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
        if (Object.hasOwn(result, "chainProduction")) chain.production = parseIndustryProduction(result.chainProduction);
      }
      if (chain.status === "synced" && (result.synchronized !== true || !chain.industryObjectID || !chain.assemblyObjectID ||
          chain.productionMirrored !== true || JSON.stringify(chain.production) !== JSON.stringify(latest.data.facility.production) ||
          industryFingerprint(latest.data.facility) !== industryFingerprint(context.data.facility))) chain.status = "pending";
      return { success: true as const, data: { facility: latest.data.facility, production: latest.data.facility.production, chain } };
    } catch { return failed("INDUSTRY_REQUEST_FAILED"); }
    finally { if (timer) clearTimeout(timer); }
  }
  return {
    async challenge(body: any) { const result = await auth.challenge({ walletAddress: body?.walletAddress }); return result.success ? result : failed(result.errorMsg); },
    async session(body: any) { const result = await auth.session({ challengeId: body?.challengeId, signature: body?.signature }); return result.success ? result : failed(result.errorMsg); },
    status: (authorization: unknown, facilityID: unknown) => status(authorization, facilityID),
    sync: (authorization: unknown, facilityID: unknown) => status(authorization, facilityID, true),
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
      const code = result.success ? 200 : result.errorMsg === "ACCESS_DENIED" ? 403 : result.errorMsg === "FACILITY_NOT_FOUND" ? 404
        : result.errorMsg === "TOO_MANY_REQUESTS" ? 429 : /^(AUTH_|INVALID_SIGNATURE|CHARACTER_|MULTIPLE_)/.test(result.errorMsg) ? 401
          : /^INVALID_/.test(result.errorMsg) ? 400 : 500;
      res.status(code).json(result);
    } catch { res.status(500).json(failed("INDUSTRY_REQUEST_FAILED")); }
  };
  app.post(`${PREFIX}/auth/challenge`, route((service, req) => service.challenge(req.body)));
  app.post(`${PREFIX}/auth/session`, route((service, req) => service.session(req.body)));
  for (const action of ["status", "sync"] as const) app.post(`${PREFIX}/:facilityID/${action}`,
    route((service, req) => service[action](req.headers.authorization, req.params.facilityID)));
}
