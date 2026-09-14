import { createSmartStorageApi } from "./smartStorageEndpoints";

const PREFIX = "/evejs/gates";
const ERROR_MESSAGES: Record<string, string> = {
  AUTH_REQUIRED: "Connect your wallet to manage gate links.",
  AUTH_EXPIRED: "The wallet session expired. Connect again.",
  INVALID_SIGNATURE: "The wallet signature does not match the connection request.",
  INVALID_WALLET: "A valid Sui wallet address is required.",
  CHARACTER_NOT_ONLINE: "Log into the game with the character belonging to this wallet.",
  MULTIPLE_ACTIVE_CHARACTERS: "Log into only the character you want to use with this wallet.",
  ACCESS_DENIED: "Only the gate owner can manage its links.",
  ASSEMBLY_ACCESS_DENIED: "You must own both gates to link them.",
  ASSEMBLY_NOT_OWNED: "You must own both gates to link them.",
  ASSEMBLY_NOT_FOUND: "That gate no longer exists.",
  ASSEMBLY_NOT_SMART_GATE: "Select a Smart Gate.",
  ASSEMBLY_NOT_IN_CURRENT_SYSTEM: "You must be in the source gate's solar system.",
  ASSEMBLY_UNDER_CONSTRUCTION: "Finish constructing both gates before linking them.",
  ASSEMBLY_ACTIVATING: "Wait for the gates' activation timers to finish.",
  ASSEMBLY_STATE_CHANGED: "The gate link changed. Refresh before trying again.",
  INVALID_ASSEMBLY_ID: "Select a valid in-game gate.",
  INVALID_REQUEST: "The gate request is invalid.",
  SMART_GATE_SELF_LINK: "A gate cannot link to itself.",
  SMART_GATE_SAME_SYSTEM: "Select a gate in a different solar system.",
  SMART_GATE_TYPE_MISMATCH: "Gates can only link to another gate of the same type.",
  SMART_GATE_ALREADY_LINKED: "One of these gates is already linked.",
  SMART_GATE_NOT_LINKED: "This gate is not linked.",
  SMART_GATE_LINK_MISMATCH: "The gate link is no longer reciprocal. Refresh its status.",
  SMART_GATE_MUST_BE_OFFLINE: "Take both gates offline before changing their link.",
  SMART_GATE_LINK_NOT_SUPPORTED: "This gate type does not support paired links.",
  SMART_GATE_SYSTEM_DATA_UNAVAILABLE: "The solar system positions are unavailable.",
  SMART_GATE_OUT_OF_RANGE: "The destination exceeds this gate type's configured client range.",
  SMART_GATE_CHAIN_PENDING: "Synchronize both gates with the blockchain before linking them.",
  SPONSOR_BUSY: "An assembly transaction is awaiting completion. Try again shortly.",
  DEPLOYMENT_UNAVAILABLE: "The blockchain connection is unavailable. Synchronize the local world first.",
  TOO_MANY_REQUESTS: "Too many wallet challenges are active. Try again shortly.",
  GATE_REQUEST_FAILED: "The gate request could not be completed. Refresh its status before trying again.",
};

function failed(rawCode: unknown) {
  const errorMsg = typeof rawCode === "string" && Object.hasOwn(ERROR_MESSAGES, rawCode) ? rawCode : "GATE_REQUEST_FAILED";
  return { success: false as const, errorMsg, message: ERROR_MESSAGES[errorMsg] };
}

function positiveID(value: unknown) {
  if (!/^[1-9][0-9]*$/.test(String(value ?? ""))) return 0;
  const id = Number(value);
  return Number.isSafeInteger(id) ? id : 0;
}

/** Local pair changes and chain reconciliation share the assembly worker queue. */
export function createSmartGateApi(overrides: Record<string, any> = {}) {
  const auth = overrides.auth || createSmartStorageApi(overrides.authDependencies, {
    scope: "Smart Gate linking",
    description: "This signature authorizes viewing, linking and unlinking gates you own with your active in-game character, and synchronizing those links with the blockchain.",
  });
  const runtime = () => overrides.runtime || require("../../services/frontier/deploymentRuntime");
  const runMutation = overrides.runMutation || ((operation: any) =>
    require("../../services/frontier/suiAssemblySync").runSuiAssemblyEnergyMutation(operation));
  const readChain = overrides.readChain || ((request: any) => require("../../services/frontier/suiGateSync").readSuiGateSyncStatus(request));
  const flushChain = overrides.flushChain || ((request: any) => require("../../services/frontier/suiGateSync").flushSuiGateSync(request));

  function resolve(authorization: unknown, rawID: unknown) {
    const identity = auth.authenticate(authorization);
    if (!identity.success) return failed(identity.errorMsg);
    const gateID = positiveID(rawID);
    if (!gateID) return failed("INVALID_ASSEMBLY_ID");
    return { success: true as const, data: { ...identity.data, gateID } };
  }

  async function chainState(context: any, flush = false) {
    const request = { gateID: context.gateID, characterID: context.characterID };
    let timer: ReturnType<typeof setTimeout> | undefined;
    const work = Promise.resolve().then(() => flush ? flushChain(request) : readChain(request))
      .catch(() => ({ ...request, status: "error" }));
    const timeout = new Promise(resolve => { timer = setTimeout(() => resolve({ ...request, status: "pending" }), overrides.chainWaitMs ?? 5000); });
    try {
      const result: any = await Promise.race([work, timeout]);
      const status = result?.gateID === request.gateID && result?.characterID === request.characterID &&
        ["disabled", "pending", "synced", "error"].includes(result.status) ? result.status : "error";
      // Only expose the gate's public readings, never internal worker error details.
      return {
        status,
        ...(/^0x[0-9a-f]{1,64}$/i.test(result?.gateObjectID || "") ? { gateObjectID: result.gateObjectID } : {}),
        ...(result?.linkedGateObjectID === null || /^0x[0-9a-f]{1,64}$/i.test(result?.linkedGateObjectID || "") ? { linkedGateObjectID: result.linkedGateObjectID } : {}),
        ...(typeof result?.maxDistanceMeters === "string" && /^\d+$/.test(result.maxDistanceMeters) ? { maxDistanceMeters: result.maxDistanceMeters } : {}),
        ...(status === "error" ? { message: "Blockchain synchronization needs attention. Retry Sync chain; the game link is preserved." } : {}),
      };
    } finally { if (timer) clearTimeout(timer); }
  }

  async function status(authorization: unknown, rawID: unknown, flush = false) {
    const context = resolve(authorization, rawID);
    if (!context.success) return context;
    try {
      const initial = runtime().getSmartGateLinkStatus(context.data.characterID, context.data.gateID);
      if (!initial?.success) return failed(initial?.errorMsg);
      const initialGate = JSON.stringify(initial.data.gate);
      const chain = await chainState(context.data, flush);
      const current = resolve(authorization, rawID);
      if (!current.success) return current;
      if (current.data.characterID !== context.data.characterID || current.data.walletAddress !== context.data.walletAddress) return failed("ACCESS_DENIED");
      const latest = runtime().getSmartGateLinkStatus(current.data.characterID, current.data.gateID);
      if (!latest?.success) return failed(latest?.errorMsg);
      if (chain.status === "synced" && initialGate !== JSON.stringify(latest.data.gate)) chain.status = "pending";
      return { success: true as const, data: { ...latest.data, chain } };
    } catch { return failed("GATE_REQUEST_FAILED"); }
  }

  async function change(authorization: unknown, rawID: unknown, body: any, action: "link" | "unlink") {
    const context = resolve(authorization, rawID);
    if (!context.success) return context;
    const destinationGateID = positiveID(body?.destinationGateID);
    if (!destinationGateID) return failed("INVALID_ASSEMBLY_ID");
    try {
      const initial = runtime().getSmartGateLinkStatus(context.data.characterID, context.data.gateID);
      if (!initial?.success) return failed(initial?.errorMsg);
      const initialGate = JSON.stringify(initial.data.gate);
      let initialDestination = "";
      if (action === "link") {
        const candidate = initial.data.candidates.find((entry: any) => entry.itemID === destinationGateID);
        if (!candidate?.eligible) return failed(candidate?.reason || (destinationGateID === context.data.gateID ? "SMART_GATE_SELF_LINK" : "SMART_GATE_TYPE_MISMATCH"));
        const destination = runtime().getSmartGateLinkStatus(context.data.characterID, destinationGateID);
        if (!destination?.success) return failed(destination?.errorMsg);
        initialDestination = JSON.stringify(destination.data.gate);
        const sourceChain = await chainState(context.data);
        const destinationChain = await chainState({ ...context.data, gateID: destinationGateID });
        if (sourceChain.status !== "synced" || destinationChain.status !== "synced") return failed("SMART_GATE_CHAIN_PENDING");
      }
      const result = await runMutation(() => {
        const current = resolve(authorization, rawID);
        if (!current.success) return current;
        if (current.data.characterID !== context.data.characterID || current.data.walletAddress !== context.data.walletAddress) return failed("ACCESS_DENIED");
        const latest = runtime().getSmartGateLinkStatus(current.data.characterID, current.data.gateID);
        if (!latest?.success) return failed(latest?.errorMsg);
        if (action === "unlink") {
          if (latest.data.gate.destinationGateID !== destinationGateID) return failed("ASSEMBLY_STATE_CHANGED");
          return runtime().unlinkSmartGate(current.data.session, current.data.gateID);
        }
        const destination = runtime().getSmartGateLinkStatus(current.data.characterID, destinationGateID);
        if (!destination?.success) return failed(destination?.errorMsg);
        if (initialGate !== JSON.stringify(latest.data.gate) || initialDestination !== JSON.stringify(destination.data.gate)) {
          return failed("ASSEMBLY_STATE_CHANGED");
        }
        const candidate = latest.data.candidates.find((entry: any) => entry.itemID === destinationGateID);
        if (!candidate?.eligible) return failed(candidate?.reason || "ASSEMBLY_STATE_CHANGED");
        // Client-authored eligibility is authoritative. The worker applies that
        // type's configured range on chain before submitting the reciprocal link.
        return runtime().linkSmartGates(current.data.session, current.data.gateID, destinationGateID);
      });
      if (!result?.success) return failed(result?.errorMsg);
      // Reconciliation failures are reported as chain status after the local commit.
      // Retrying /sync cannot accidentally apply a second link or unlink operation.
      return status(authorization, rawID, true);
    } catch (error: any) { return failed(error?.code); }
  }

  return {
    async challenge(body: any) {
      const result = await auth.challenge({ walletAddress: body?.walletAddress });
      return result.success ? result : failed(result.errorMsg);
    },
    async session(body: any) {
      const result = await auth.session({ challengeId: body?.challengeId, signature: body?.signature });
      return result.success ? result : failed(result.errorMsg);
    },
    status: (authorization: unknown, rawID: unknown) => status(authorization, rawID),
    sync: (authorization: unknown, rawID: unknown) => status(authorization, rawID, true),
    link: (authorization: unknown, rawID: unknown, body: any) => change(authorization, rawID, body, "link"),
    unlink: (authorization: unknown, rawID: unknown, body: any) => change(authorization, rawID, body, "unlink"),
  };
}

export function mountSmartGateEndpoints(app: any, options: Record<string, any> = {}) {
  let api: ReturnType<typeof createSmartGateApi>;
  const getApi = () => api || (api = options.api || createSmartGateApi());
  const origins = new Set(String(process.env.EVEJS_GATE_DAPP_ORIGINS || process.env.EVEJS_ADMIN_DAPP_ORIGINS ||
    process.env.EVEJS_STORAGE_DAPP_ORIGINS || "https://localhost,https://127.0.0.1,https://dev.dapps.evefrontier.com").split(",").map(value => value.trim()));
  app.use(PREFIX, (error: any, req: any, res: any, _next: any) => {
    res.set("Cache-Control", "no-store"); res.vary("Origin");
    const origin = req.headers.origin;
    if (origin && !origins.has(origin)) { res.status(403).json(failed("ACCESS_DENIED")); return; }
    if (origin) res.set("Access-Control-Allow-Origin", origin);
    res.status(error?.type === "entity.too.large" ? 413 : 400).json(failed("INVALID_REQUEST"));
  });
  app.use(PREFIX, (req: any, res: any, next: any) => {
    res.set("Cache-Control", "no-store"); res.vary("Origin");
    const origin = req.headers.origin;
    if (origin && !origins.has(origin)) { res.status(403).json(failed("ACCESS_DENIED")); return; }
    if (origin) {
      res.set("Access-Control-Allow-Origin", origin);
      res.set("Access-Control-Allow-Headers", "Authorization, Content-Type");
      res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
    }
    if (req.method === "OPTIONS") { res.sendStatus(204); return; }
    next();
  });
  const route = (handler: (service: ReturnType<typeof createSmartGateApi>, req: any) => Promise<any>) => async (req: any, res: any) => {
    try {
      const result = await handler(getApi(), req);
      const code = result.success ? 200 : result.errorMsg === "DEPLOYMENT_UNAVAILABLE" ? 503 : result.errorMsg === "TOO_MANY_REQUESTS" ? 429
        : /^(AUTH_|INVALID_SIGNATURE$|CHARACTER_NOT_ONLINE$|MULTIPLE_ACTIVE)/.test(result.errorMsg) ? 401
          : /^(ACCESS_DENIED|ASSEMBLY_ACCESS_DENIED|ASSEMBLY_NOT_OWNED|ASSEMBLY_NOT_IN_CURRENT_SYSTEM)$/.test(result.errorMsg) ? 403
            : result.errorMsg === "GATE_REQUEST_FAILED" ? 500 : /NOT_FOUND$/.test(result.errorMsg) ? 404 : /^INVALID_/.test(result.errorMsg) ? 400 : 409;
      res.status(code).json(result);
    } catch { res.status(500).json(failed("GATE_REQUEST_FAILED")); }
  };
  app.post(`${PREFIX}/auth/challenge`, route((service, req) => service.challenge(req.body)));
  app.post(`${PREFIX}/auth/session`, route((service, req) => service.session(req.body)));
  for (const action of ["status", "sync", "link", "unlink"] as const) {
    app.post(`${PREFIX}/:gateID/${action}`, route((service, req) => service[action](req.headers.authorization, req.params.gateID, req.body)));
  }
}
