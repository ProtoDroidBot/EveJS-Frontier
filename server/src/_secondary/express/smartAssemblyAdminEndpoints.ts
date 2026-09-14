import { createSmartStorageApi } from "./smartStorageEndpoints";

const PREFIX = "/evejs/admin";
const MAX_BYTES_LENGTH = 256 * 1024;
const MAX_SIGNATURE_LENGTH = 16384;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ERROR_MESSAGES: Record<string, string> = {
  AUTH_REQUIRED: "Connect your wallet to the game server first.",
  AUTH_EXPIRED: "The wallet session expired. Connect again.",
  INVALID_SIGNATURE: "The wallet signature does not match the prepared request.",
  INVALID_WALLET: "A valid Sui wallet address is required.",
  CHARACTER_NOT_ONLINE: "Log into the game with the character belonging to this wallet.",
  MULTIPLE_ACTIVE_CHARACTERS: "This wallet has multiple active characters. Log into only the character to use.",
  ACCESS_DENIED: "Only the assembly owner can change its online state.",
  INVALID_ASSEMBLY_ID: "Select a valid in-game assembly.",
  INVALID_ACTION: "Choose online or offline.",
  INVALID_TENANT: "Assembly administration is available for the dev tenant only.",
  INVALID_TRANSACTION: "The signed transaction is missing or invalid.",
  ASSEMBLY_NOT_FOUND: "That assembly no longer exists.",
  ASSEMBLY_NOT_IN_CURRENT_SYSTEM: "The assembly is not in your current system.",
  ASSEMBLY_OUT_OF_RANGE: "Move within range of the assembly.",
  ASSEMBLY_ALREADY_ONLINE: "The assembly is already online.",
  ASSEMBLY_ALREADY_OFFLINE: "The assembly is already offline.",
  ASSEMBLY_STATE_CHANGED: "The assembly changed while this transaction was prepared. Refresh and try again.",
  NETWORK_NODE_ENERGY_CONFIG_UNAVAILABLE: "The Network Node energy configuration has not synchronized yet.",
  NETWORK_NODE_ENERGY_STATE_UNAVAILABLE: "The Network Node's energy usage is still synchronizing. Try again shortly.",
  NETWORK_NODE_CONNECTION_REQUIRED: "Connect this assembly to a Network Node first.",
  NETWORK_NODE_OFFLINE: "Bring the connected Network Node online first.",
  NETWORK_NODE_ENERGY_EXCEEDED: "The connected Network Node does not have enough energy available.",
  NETWORK_NODE_FUEL_REQUIRED: "Deposit fuel in the Network Node before bringing it online.",
  SMART_GATE_DESTINATION_REQUIRED: "Link this gate to a destination before bringing it online.",
  ALREADY_IN_STATE: "The assembly is already in the requested state.",
  DEPLOYMENT_UNAVAILABLE: "The game server has no verified Sui deployment. Synchronize the local world first.",
  DEPLOYMENT_MISMATCH: "The assembly or Sui deployment differs from the game server. Refresh before trying again.",
  TRANSACTION_NOT_FOUND: "The prepared transaction expired. Prepare another transaction.",
  TRANSACTION_MISMATCH: "The signed transaction does not match the prepared operation.",
  TRANSACTION_EXPIRED: "The prepared transaction expired. Prepare another transaction.",
  TRANSACTION_PENDING: "The transaction is still being processed. Retry the same request shortly.",
  TRANSACTION_FAILED: "The chain rejected the transaction. Refresh the assembly before trying again.",
  SPONSOR_BUSY: "The sponsor is processing another transaction. Try again shortly.",
  TOO_MANY_REQUESTS: "Too many requests are active. Try again shortly.",
  ADMIN_REQUEST_FAILED: "The assembly transaction could not be completed. Refresh the assembly and try again.",
};

function failed(rawCode: unknown, rawParams?: any) {
  const errorMsg = typeof rawCode === "string" && Object.hasOwn(ERROR_MESSAGES, rawCode) ? rawCode : "ADMIN_REQUEST_FAILED";
  const params = ["TRANSACTION_PENDING", "TRANSACTION_FAILED"].includes(errorMsg) ? {
    ...(typeof rawParams?.transactionUUID === "string" && UUID.test(rawParams.transactionUUID) ? { transactionUUID: rawParams.transactionUUID } : {}),
    ...(typeof rawParams?.digest === "string" && /^[1-9A-HJ-NP-Za-km-z]{20,64}$/.test(rawParams.digest) ? { digest: rawParams.digest } : {}),
  } : undefined;
  return { success: false as const, errorMsg, message: ERROR_MESSAGES[errorMsg], ...(params ? { params } : {}) };
}

function assemblyID(value: unknown) {
  if (!/^[1-9][0-9]*$/.test(String(value ?? ""))) return 0;
  const id = Number(value);
  return Number.isSafeInteger(id) ? id : 0;
}

function objectID(value: unknown) {
  return typeof value === "string" && /^0x[0-9a-f]{1,64}$/i.test(value);
}

export function createSmartAssemblyAdminApi(overrides: Record<string, any> = {}) {
  // A separate auth instance keeps admin tokens and challenges scoped to this API.
  const auth = overrides.auth || createSmartStorageApi(overrides.authDependencies, {
    scope: "Smart Assembly administration",
    description: "This signature connects your active in-game character for sponsored online or offline transactions on assemblies you own. Each transaction requires a separate wallet signature.",
  });
  const bridge = overrides.callSuiAssemblyAdmin || ((method: "prepare" | "execute", request: any) =>
    require("../../services/frontier/suiAssemblyAdmin").callSuiAssemblyAdmin(method, request));

  function resolve(authorization: unknown, rawID: unknown, body: any) {
    const identity = auth.authenticate(authorization);
    if (!identity.success) return failed(identity.errorMsg);
    const id = assemblyID(rawID);
    if (!id) return failed("INVALID_ASSEMBLY_ID");
    if (body?.action !== "online" && body?.action !== "offline") return failed("INVALID_ACTION");
    if (body?.tenant !== undefined && body.tenant !== "dev") return failed("INVALID_TENANT");
    const { characterID, walletAddress, session } = identity.data;
    return { success: true as const, data: {
      assemblyID: id, action: body.action, tenant: "dev", characterID, walletAddress, session,
      assertAuthenticated: () => {
        const current = auth.authenticate(authorization);
        if (!current.success || current.data.characterID !== characterID || current.data.walletAddress !== walletAddress) {
          const error = failed(current.success ? "ACCESS_DENIED" : current.errorMsg);
          throw Object.assign(new Error(error.message), { code: error.errorMsg });
        }
        return current.data;
      },
    } };
  }

  async function call(method: "prepare" | "execute", request: any) {
    try {
      const result = await bridge(method, request);
      return result?.success === true ? result : failed(result?.errorMsg, result?.params);
    } catch (error: any) {
      return failed(error?.code);
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
    async prepare(authorization: unknown, rawID: unknown, body: any) {
      const context = resolve(authorization, rawID, body);
      if (!context.success) return context;
      if (![body?.expectedAssemblyObjectID, body?.expectedPackageId, body?.expectedObjectRegistryId].every(objectID)) {
        return failed("DEPLOYMENT_MISMATCH");
      }
      return call("prepare", {
        ...context.data,
        expectedAssemblyObjectID: body.expectedAssemblyObjectID,
        expectedPackageId: body.expectedPackageId,
        expectedObjectRegistryId: body.expectedObjectRegistryId,
      });
    },
    async execute(authorization: unknown, rawID: unknown, body: any) {
      const context = resolve(authorization, rawID, body);
      if (!context.success) return context;
      if (typeof body?.transactionUUID !== "string" || !UUID.test(body.transactionUUID)
        || typeof body?.bytes !== "string" || !body.bytes.length || body.bytes.length > MAX_BYTES_LENGTH
        || typeof body?.signature !== "string" || !body.signature.length || body.signature.length > MAX_SIGNATURE_LENGTH) {
        return failed("INVALID_TRANSACTION");
      }
      // Sponsored transaction bytes go untouched to the bridge, which verifies
      // the wallet signature without resetting the server's gas owner.
      return call("execute", { ...context.data, transactionUUID: body.transactionUUID, bytes: body.bytes, signature: body.signature });
    },
  };
}

export function mountSmartAssemblyAdminEndpoints(app: any, options: Record<string, any> = {}) {
  let api: ReturnType<typeof createSmartAssemblyAdminApi>;
  const getApi = () => api || (api = options.api || createSmartAssemblyAdminApi());
  const origins = new Set(String(process.env.EVEJS_ADMIN_DAPP_ORIGINS || process.env.EVEJS_STORAGE_DAPP_ORIGINS
    || "https://localhost,https://127.0.0.1,https://dev.dapps.evefrontier.com").split(",").map(value => value.trim()));
  // express.json is mounted by the host before these routes. Handle its errors
  // here as well so malformed requests cannot expose Express error pages.
  app.use(PREFIX, (error: any, req: any, res: any, _next: any) => {
    res.set("Cache-Control", "no-store");
    res.vary("Origin");
    const origin = req.headers.origin;
    if (origin && !origins.has(origin)) { res.status(403).json(failed("ACCESS_DENIED")); return; }
    if (origin) res.set("Access-Control-Allow-Origin", origin);
    res.status(error?.type === "entity.too.large" ? 413 : 400).json(failed("INVALID_TRANSACTION"));
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
  const route = (handler: (api: ReturnType<typeof createSmartAssemblyAdminApi>, req: any) => Promise<any>) => async (req: any, res: any) => {
    try {
      const result = await handler(getApi(), req);
      const code = result.success ? 200 : result.errorMsg === "TOO_MANY_REQUESTS" ? 429
        : /^(AUTH_|INVALID_SIGNATURE$|CHARACTER_NOT_ONLINE$|MULTIPLE_ACTIVE)/.test(result.errorMsg) ? 401
          : /^(ACCESS_DENIED|ASSEMBLY_OUT_OF_RANGE|ASSEMBLY_NOT_IN_CURRENT_SYSTEM)$/.test(result.errorMsg) ? 403
            : result.errorMsg === "ADMIN_REQUEST_FAILED" ? 500 : /NOT_FOUND$/.test(result.errorMsg) ? 404
              : /^INVALID_/.test(result.errorMsg) ? 400 : 409;
      res.status(code).json(result);
    } catch { res.status(500).json(failed("ADMIN_REQUEST_FAILED")); }
  };
  app.post(`${PREFIX}/auth/challenge`, route((service, req) => service.challenge(req.body)));
  app.post(`${PREFIX}/auth/session`, route((service, req) => service.session(req.body)));
  app.post(`${PREFIX}/:assemblyID/prepare`, route((service, req) => service.prepare(req.headers.authorization, req.params.assemblyID, req.body)));
  app.post(`${PREFIX}/:assemblyID/execute`, route((service, req) => service.execute(req.headers.authorization, req.params.assemblyID, req.body)));
}
