import { createSmartStorageApi } from "./smartStorageEndpoints";

const PREFIX = "/evejs/energy";
const ERROR_MESSAGES: Record<string, string> = {
  AUTH_REQUIRED: "Connect your wallet to the energy grid first.",
  AUTH_EXPIRED: "The wallet session expired. Connect again.",
  INVALID_SIGNATURE: "The wallet signature does not match the connection request.",
  INVALID_WALLET: "A valid Sui wallet address is required.",
  CHARACTER_NOT_ONLINE: "Log into the game with the character belonging to this wallet.",
  MULTIPLE_ACTIVE_CHARACTERS: "This wallet has multiple active characters. Log into only the character to use.",
  ACCESS_DENIED: "Only the assembly owner can manage this energy grid.",
  ASSEMBLY_ACCESS_DENIED: "You must own both the assembly and the Network Node.",
  ASSEMBLY_NOT_OWNED: "You must own both the assembly and the Network Node.",
  INVALID_ASSEMBLY_ID: "Select a valid in-game assembly.",
  INVALID_REQUEST: "The energy grid request is invalid.",
  ASSEMBLY_NOT_FOUND: "That assembly no longer exists.",
  ASSEMBLY_NOT_IN_CURRENT_SYSTEM: "You must be in the assembly's solar system.",
  ASSEMBLY_UNDER_CONSTRUCTION: "Construction must finish before connecting this assembly.",
  ASSEMBLY_ACTIVATING: "Wait for the assembly's anchoring or onlining timer to finish.",
  ASSEMBLY_STATE_UNAVAILABLE: "The Network Node's blockchain state could not be verified. Please try again.",
  ASSEMBLY_STATE_PENDING: "The Network Node's state change is awaiting blockchain confirmation. Please try again.",
  ASSEMBLY_OUT_OF_RANGE: "The assembly is outside this Network Node's radius.",
  ASSEMBLY_ALREADY_CONNECTED: "This assembly is already connected to a Network Node.",
  ASSEMBLY_NOT_CONNECTED: "This assembly is not connected to that Network Node.",
  ASSEMBLY_MUST_BE_OFFLINE: "Take this assembly offline before changing its energy connection.",
  NETWORK_NODE_REQUIRED: "Select a Network Node to manage its grid.",
  NETWORK_NODE_NOT_FOUND: "That Network Node no longer exists.",
  NETWORK_NODE_OFFLINE: "Bring the Network Node online before supplying energy.",
  NETWORK_NODE_CONNECTION_REQUIRED: "Connect this assembly to a nearby Network Node before bringing it online.",
  NETWORK_NODE_OUT_OF_RANGE: "The assembly is outside this Network Node's radius.",
  NETWORK_NODE_CAPACITY_EXCEEDED: "The Network Node has insufficient available energy for this assembly.",
  NETWORK_NODE_ENERGY_EXCEEDED: "The Network Node has insufficient available energy for this assembly.",
  NETWORK_NODE_ENERGY_CONFIG_UNAVAILABLE: "Energy requirements are still synchronizing. Try again shortly.",
  NETWORK_NODE_ENERGY_STATE_UNAVAILABLE: "The Network Node's blockchain energy usage could not be verified. Please try again.",
  NETWORK_NODE_BINDING_LOCKED: "This assembly's existing chain connection cannot be changed.",
  NETWORK_NODE_CONNECTION_MISMATCH: "This assembly is connected to a different Network Node.",
  INSUFFICIENT_ENERGY: "The Network Node has insufficient available energy for this assembly.",
  TOO_MANY_REQUESTS: "Too many wallet challenges are active. Try again shortly.",
  SPONSOR_BUSY: "An assembly transaction is awaiting a signature. Try again when it finishes.",
  DEPLOYMENT_UNAVAILABLE: "The blockchain connection is still synchronizing. Try again shortly.",
  ENERGY_REQUEST_FAILED: "The energy grid could not be updated. Refresh its status and try again.",
  REMOTE_SCANNING_DISABLED: "Remote solar-system scanning is disabled on this server.",
  REMOTE_SCAN_SOURCE_INVALID: "Select a valid Network Node scanner source.",
  REMOTE_SCAN_SOURCE_UNAVAILABLE: "That Network Node cannot currently provide remote scans.",
  REMOTE_SCAN_SOURCE_OFFLINE: "Bring the Network Node online before starting a remote scan.",
  REMOTE_SCAN_OPERATION_KEY_INVALID: "The remote scan operation key is invalid.",
  REMOTE_SCAN_SYSTEM_NOT_FOUND: "Select a valid destination solar system.",
  REMOTE_SCAN_MODE_INVALID: "Select a supported remote scan mode.",
  REMOTE_SCAN_DEEP_DISABLED: "Deep remote scans are disabled on this server.",
  REMOTE_SCAN_RANGE_INVALID: "Select a scan range within this Network Node's configured hop limit.",
  REMOTE_SCAN_LAYERS_INVALID: "Select at least one supported remote scan layer.",
  REMOTE_SCAN_OUT_OF_RANGE: "The destination solar system is outside the selected stargate-hop range.",
  REMOTE_SCAN_INSUFFICIENT_ENERGY: "The Network Node has insufficient available energy for this scan.",
  REMOTE_SCAN_COOLDOWN: "The Network Node scanner is cooling down. Try again shortly.",
  REMOTE_SCAN_NOT_FOUND: "That remote scan job does not exist.",
  REMOTE_SCAN_NOT_READY: "That remote scan has not finished yet.",
  REMOTE_SCAN_ALREADY_COMPLETE: "That remote scan has already finished and cannot be cancelled.",
  REMOTE_SCAN_WARMUP_TIMEOUT: "The target solar system did not warm up before the scan timed out.",
  REMOTE_SCAN_WARMUP_BUSY: "Remote scan warm-up capacity is busy. Try again shortly.",
  REMOTE_SCAN_WARMUP_FAILED: "The target solar system could not be prepared for a deep scan.",
  REMOTE_SCAN_PERSIST_FAILED: "The remote scan job could not be saved. Try again.",
  REMOTE_SCAN_FAILED: "The remote solar-system scan failed. Try again.",
  ASSEMBLY_ACTION_CHAIN_UNAVAILABLE: "The Sui assembly action queue is unavailable. Try again after world synchronization resumes.",
  ASSEMBLY_ACTION_NOT_FOUND: "That queued Sui assembly action does not exist.",
  ASSEMBLY_ACTION_COMMITMENT_INVALID: "The queued Sui assembly action payload failed verification.",
  ASSEMBLY_ACTION_MISMATCH: "That Sui action does not authorize this Network Node scan.",
  ASSEMBLY_ACTION_NOT_EXECUTABLE: "That Sui assembly action is no longer executable.",
};

function failed(rawCode: unknown, params?: unknown) {
  const errorMsg = typeof rawCode === "string" && Object.hasOwn(ERROR_MESSAGES, rawCode)
    ? rawCode : "ENERGY_REQUEST_FAILED";
  return {
    success: false as const,
    errorMsg,
    message: ERROR_MESSAGES[errorMsg],
    ...(params && typeof params === "object" ? { params } : {}),
  };
}

function positiveID(value: unknown) {
  if (!/^[1-9][0-9]*$/.test(String(value ?? ""))) return 0;
  const id = Number(value);
  return Number.isSafeInteger(id) ? id : 0;
}

/** Wallet authorization is scoped to grid management and resolves the live game session on every call. */
export function createSmartAssemblyEnergyApi(overrides: Record<string, any> = {}) {
  const auth = overrides.auth || createSmartStorageApi(overrides.authDependencies, {
    scope: "Smart Assembly energy grid",
    description: "This signature authorizes viewing the Network Node's nearby Smart Assembly radar, starting privacy-preserving remote solar-system scans, and connecting or disconnecting assemblies you own in your active in-game character's energy grid.",
  });
  const runtime = () => overrides.runtime || require("../../services/frontier/networkNodeEnergyRuntime");
  const scanRuntime = () => overrides.scanRuntime || require("../../services/frontier/remoteSystemScanRuntime");
  const runWithState = overrides.runWithState || (overrides.runtime ? (_nodeID, operation) => operation() :
    (nodeID, operation) => require("../../services/frontier/suiAssemblyState").runWithSuiAssemblyState(nodeID, operation));
  const runMutation = overrides.runMutation || (overrides.runtime ? operation => operation() :
    operation => require("../../services/frontier/suiAssemblySync").runSuiAssemblyEnergyMutation(operation));

  function resolve(authorization: unknown, rawID: unknown) {
    const identity = auth.authenticate(authorization);
    if (!identity.success) return failed(identity.errorMsg);
    const networkNodeID = positiveID(rawID);
    if (!networkNodeID) return failed("INVALID_ASSEMBLY_ID");
    return { success: true as const, data: { ...identity.data, networkNodeID } };
  }

  async function change(authorization: unknown, rawID: unknown, body: any, action: "connect" | "disconnect") {
    const context = resolve(authorization, rawID);
    if (!context.success) return context;
    const assemblyID = positiveID(body?.assemblyID);
    if (!assemblyID) return failed("INVALID_ASSEMBLY_ID");
    try {
      const result = await runMutation(() => {
        // The chain worker may have been busy. Recheck wallet/session ownership
        // when the queued mutation actually runs, not just when it was requested.
        const current = resolve(authorization, rawID);
        if (!current.success) return current;
        if (current.data.characterID !== context.data.characterID || current.data.walletAddress !== context.data.walletAddress) return failed("ACCESS_DENIED");
        return runtime()[action === "connect" ? "connectAssembly" : "disconnectAssembly"](
          current.data.session, assemblyID, current.data.networkNodeID,
        );
      });
      if (!result?.success) return failed(result?.errorMsg);
      // Return the authoritative grid after the operation so capacity and both
      // connection lists are refreshed together.
      return status(authorization, rawID);
    } catch (error: any) { return failed(error?.code || "ENERGY_REQUEST_FAILED"); }
  }

  async function status(authorization: unknown, rawID: unknown) {
    const context = resolve(authorization, rawID);
    if (!context.success) return context;
    try {
      const result = await runWithState(context.data.networkNodeID, () => {
        const current = resolve(authorization, rawID);
        if (!current.success) return current;
        if (current.data.characterID !== context.data.characterID || current.data.walletAddress !== context.data.walletAddress) return failed("ACCESS_DENIED");
        return runtime().getNetworkNodeEnergyStatus(current.data.characterID, current.data.networkNodeID);
      });
      return result?.success ? result : failed(result?.errorMsg);
    } catch (error: any) { return failed(error?.code || "ENERGY_REQUEST_FAILED"); }
  }

  async function scanOperation(authorization: unknown, rawID: unknown,
    operation: (service: any, context: any) => any) {
    const context = resolve(authorization, rawID);
    if (!context.success) return context;
    try {
      const result = await runWithState(context.data.networkNodeID, () => {
        const current = resolve(authorization, rawID);
        if (!current.success) return current;
        if (current.data.characterID !== context.data.characterID ||
            current.data.walletAddress !== context.data.walletAddress) return failed("ACCESS_DENIED");
        return operation(scanRuntime(), current.data);
      });
      return result?.success ? result : failed(result?.errorMsg, result?.params);
    } catch (error: any) {
      return failed(error?.code && Object.hasOwn(ERROR_MESSAGES, error.code)
        ? error.code : "REMOTE_SCAN_FAILED");
    }
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
    status,
    connect: (authorization: unknown, rawID: unknown, body: any) => change(authorization, rawID, body, "connect"),
    disconnect: (authorization: unknown, rawID: unknown, body: any) => change(authorization, rawID, body, "disconnect"),
    scanConfig: (authorization: unknown, rawID: unknown, body: any = {}) =>
      scanOperation(authorization, rawID, (service, context) =>
        service.getNetworkNodeScanConfiguration(
          context.characterID, context.networkNodeID, context.session, body?.rangeJumps,
        )),
    startScan: (authorization: unknown, rawID: unknown, body: any) =>
      scanOperation(authorization, rawID, (service, context) =>
        service.executeRemoteSystemScanAction(
          context.characterID, context.networkNodeID, body?.actionObjectID, context.session,
        )),
    scanStatus: (authorization: unknown, rawID: unknown, scanID: unknown) =>
      scanOperation(authorization, rawID, (service, context) =>
        service.getRemoteSystemScan(
          context.characterID, context.networkNodeID, scanID, context.session,
        )),
    scanResult: (authorization: unknown, rawID: unknown, scanID: unknown) =>
      scanOperation(authorization, rawID, (service, context) =>
        service.getRemoteSystemScanResult(
          context.characterID, context.networkNodeID, scanID, context.session,
        )),
    cancelScan: (authorization: unknown, rawID: unknown, scanID: unknown) =>
      scanOperation(authorization, rawID, (service, context) =>
        service.cancelRemoteSystemScan(
          context.characterID, context.networkNodeID, scanID, context.session,
        )),
  };
}

export function mountSmartAssemblyEnergyEndpoints(app: any, options: Record<string, any> = {}) {
  let api: ReturnType<typeof createSmartAssemblyEnergyApi>;
  const getApi = () => api || (api = options.api || createSmartAssemblyEnergyApi());
  const origins = new Set(String(process.env.EVEJS_ENERGY_DAPP_ORIGINS || process.env.EVEJS_ADMIN_DAPP_ORIGINS
    || process.env.EVEJS_STORAGE_DAPP_ORIGINS || "https://localhost,https://127.0.0.1,https://dev.dapps.evefrontier.com")
    .split(",").map(value => value.trim()));
  app.use(PREFIX, (error: any, req: any, res: any, _next: any) => {
    res.set("Cache-Control", "no-store");
    res.vary("Origin");
    const origin = req.headers.origin;
    if (origin && !origins.has(origin)) { res.status(403).json(failed("ACCESS_DENIED")); return; }
    if (origin) res.set("Access-Control-Allow-Origin", origin);
    res.status(error?.type === "entity.too.large" ? 413 : 400).json(failed("INVALID_REQUEST"));
  });
  app.use(PREFIX, (req: any, res: any, next: any) => {
    res.set("Cache-Control", "no-store");
    res.vary("Origin");
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
  const route = (handler: (api: ReturnType<typeof createSmartAssemblyEnergyApi>, req: any) => Promise<any>) => async (req: any, res: any) => {
    try {
      const result = await handler(getApi(), req);
      const code = result.success ? 200 : ["NETWORK_NODE_ENERGY_CONFIG_UNAVAILABLE", "NETWORK_NODE_ENERGY_STATE_UNAVAILABLE", "ASSEMBLY_STATE_UNAVAILABLE", "DEPLOYMENT_UNAVAILABLE"].includes(result.errorMsg) ? 503
        : result.errorMsg === "TOO_MANY_REQUESTS" ? 429
        : result.errorMsg === "REMOTE_SCAN_COOLDOWN" ? 429
        : ["REMOTE_SCAN_WARMUP_TIMEOUT", "REMOTE_SCAN_WARMUP_BUSY", "REMOTE_SCAN_WARMUP_FAILED", "REMOTE_SCAN_SOURCE_UNAVAILABLE", "ASSEMBLY_ACTION_CHAIN_UNAVAILABLE"].includes(result.errorMsg) ? 503
        : /^(AUTH_|INVALID_SIGNATURE$|CHARACTER_NOT_ONLINE$|MULTIPLE_ACTIVE)/.test(result.errorMsg) ? 401
          : /^(ACCESS_DENIED|ASSEMBLY_ACCESS_DENIED|ASSEMBLY_NOT_OWNED|ASSEMBLY_NOT_IN_CURRENT_SYSTEM)$/.test(result.errorMsg) ? 403
            : result.errorMsg === "ENERGY_REQUEST_FAILED" ? 500 : /NOT_FOUND$/.test(result.errorMsg) ? 404
              : /^INVALID_|_INVALID$/.test(result.errorMsg) ? 400 : 409;
      res.status(code).json(result);
    } catch { res.status(500).json(failed("ENERGY_REQUEST_FAILED")); }
  };
  app.post(`${PREFIX}/auth/challenge`, route((service, req) => service.challenge(req.body)));
  app.post(`${PREFIX}/auth/session`, route((service, req) => service.session(req.body)));
  app.post(`${PREFIX}/:networkNodeID/status`, route((service, req) => service.status(req.headers.authorization, req.params.networkNodeID)));
  app.post(`${PREFIX}/:networkNodeID/connect`, route((service, req) => service.connect(req.headers.authorization, req.params.networkNodeID, req.body)));
  app.post(`${PREFIX}/:networkNodeID/disconnect`, route((service, req) => service.disconnect(req.headers.authorization, req.params.networkNodeID, req.body)));
  app.post(`${PREFIX}/:networkNodeID/scanning/config`, route((service, req) => service.scanConfig(req.headers.authorization, req.params.networkNodeID, req.body)));
  app.post(`${PREFIX}/:networkNodeID/scanning/start`, route((service, req) => service.startScan(req.headers.authorization, req.params.networkNodeID, req.body)));
  app.post(`${PREFIX}/:networkNodeID/scanning/:scanID/status`, route((service, req) => service.scanStatus(req.headers.authorization, req.params.networkNodeID, req.params.scanID)));
  app.post(`${PREFIX}/:networkNodeID/scanning/:scanID/result`, route((service, req) => service.scanResult(req.headers.authorization, req.params.networkNodeID, req.params.scanID)));
  app.post(`${PREFIX}/:networkNodeID/scanning/:scanID/cancel`, route((service, req) => service.cancelScan(req.headers.authorization, req.params.networkNodeID, req.params.scanID)));
}
