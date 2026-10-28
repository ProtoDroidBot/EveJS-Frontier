import { evmAddress, evmUint256 } from "./legacyEvmAuthorization";
import { convertLegacyEvmTokenUnits } from "./legacyEvmRuntime";

function fail(code: string): never { throw Object.assign(new Error(code), { code }); }
function positiveID(value: unknown): number {
  if (!/^[1-9][0-9]*$/.test(String(value ?? ""))) fail("INVALID_LEGACY_PROXY_IDENTIFIER");
  const id = Number(value);
  if (!Number.isSafeInteger(id)) fail("INVALID_LEGACY_PROXY_IDENTIFIER");
  return id;
}
function map(value: unknown): value is Record<string, any> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
function password(value: unknown): string {
  if (typeof value !== "string" || value.length < 1 || Buffer.byteLength(value, "utf8") > 1024) {
    fail("INVALID_LEGACY_PROXY_PASSWORD");
  }
  return value;
}

export function legacyProxyParameters(request: any): Record<string, any> {
  const params = request?.params;
  if (params === undefined || Array.isArray(params) && params.length === 0) return {};
  if (!Array.isArray(params) || params.length !== 1 || !map(params[0])) fail("INVALID_LEGACY_PROXY_PARAMS");
  return params[0];
}

export function legacyProxyRpcError(id: any, error: any) {
  const raw = String(error?.code || "LEGACY_PROXY_OPERATION_FAILED");
  const reason = /^[A-Z][A-Z0-9_]{0,95}$/.test(raw) ? raw : "LEGACY_PROXY_OPERATION_FAILED";
  const exceptionType = /PASSWORD_INCORRECT|INVALID_PASSWORD|UNLOCK_FAILED|INVALID_LEGACY_EVM_WALLET_PASSWORD/.test(reason)
    ? "KeystorePasswordIncorrect" : /WALLET_ALREADY_EXISTS|KEYSTORE_FOUND/.test(reason)
      ? "KeystoreFound" : /WALLET_NOT_FOUND|KEYSTORE_NOT_FOUND|CUSTODIAL_WALLET_UNAVAILABLE/.test(reason) ? "KeystoreNotFound"
        : "BlockchainProxyInternalError";
  return { jsonrpc: "2.0", id: typeof id === "string" || typeof id === "number" || id === null ? id : null,
    error: { code: reason === "LEGACY_PROXY_METHOD_NOT_SUPPORTED" ? -32601 :
      /INVALID_LEGACY_PROXY_(REQUEST|PARAMS|IDENTIFIER|PASSWORD)/.test(reason) ? -32602 : -32000,
    message: reason, data: { exception_type: exceptionType, callee_error_code: reason } } };
}

/**
 * Build 2455427's session_* JSON-RPC contract. The injected session must come
 * from the live game TCP registry; caller/anima IDs never authenticate a peer.
 * Custody and actual Sui intents are implemented by the shared bridge facade.
 */
export function createLegacyBlockchainProxy(options: { bridge: any }) {
  if (!options?.bridge) fail("LEGACY_PROXY_UNAVAILABLE");
  const bridge = options.bridge;

  async function call(name: string, ...args: any[]) {
    if (typeof bridge[name] !== "function") fail("LEGACY_PROXY_OPERATION_UNAVAILABLE");
    return bridge[name](...args);
  }
  async function balance(session: any, address: unknown) {
    const result = await call("proxyTokenBalance", session, evmAddress(address));
    if (!map(result)) fail("LEGACY_EVM_TOKEN_AUTHORITY_UNAVAILABLE");
    const value = evmUint256(result.value);
    if (!Number.isInteger(result.decimals) || result.decimals < 0 || result.decimals > 36) {
      fail("LEGACY_EVM_TOKEN_AUTHORITY_UNAVAILABLE");
    }
    return { value, decimals: result.decimals };
  }
  function displayBalance(value: string, decimals: number) {
    const atoms = BigInt(value), scale = 10n ** BigInt(decimals);
    const whole = (atoms / scale).toString();
    const remainder = (atoms % scale).toString().padStart(decimals, "0").replace(/0+$/, "");
    return remainder ? `${whole}.${remainder}` : whole;
  }
  function identity(session: any) {
    if (!session || session._characterControlDisconnected === true) fail("AUTHENTICATION_REQUIRED");
    return { userID: positiveID(session.userid), characterID: positiveID(session.characterID || session.charid) };
  }
  function parameters(request: any, session: any, allowed: string[], requireCaller = false) {
    const trusted = identity(session);
    const params = legacyProxyParameters(request);
    if (Object.keys(params).some(key => !allowed.includes(key))) fail("INVALID_LEGACY_PROXY_PARAMS");
    if (params.anima_id !== undefined && positiveID(params.anima_id) !== trusted.characterID) fail("CHARACTER_IDENTITY_MISMATCH");
    if (requireCaller || params.caller !== undefined) {
      const caller = params.caller;
      if (!map(caller) || Object.keys(caller).some(key => ![
        "character_id", "corporation_id", "alliance_id", "solar_system_id",
      ].includes(key)) || positiveID(caller.character_id) !== trusted.characterID) fail("CHARACTER_IDENTITY_MISMATCH");
      const state = {
        corporation_id: session.corporationID || session.corpid || 0,
        alliance_id: session.allianceID || session.allianceid || 0,
        solar_system_id: session._space?.systemID || session.solarsystemid2 || session.solarsystemid || session.solarSystemID || 0,
      };
      for (const [key, expected] of Object.entries(state)) {
        if (caller[key] !== undefined && Number(caller[key] ?? 0) !== Number(expected)) fail("CHARACTER_IDENTITY_MISMATCH");
      }
    }
    return params;
  }

  async function dispatch(request: any, session: any) {
    switch (request.method) {
      case "session_authenticateAsExternalServerAnimaId": {
        const params = parameters(request, session, ["anima_id"]);
        if (positiveID(params.anima_id) !== identity(session).characterID) fail("CHARACTER_IDENTITY_MISMATCH");
        // This acknowledges the matching authenticated TCP session only.
        await call("getProxyConfiguration", session);
        return { authenticated: true };
      }
      case "session_doesAnimaAccountExist": {
        const params = parameters(request, session, ["anima_id"]);
        positiveID(params.anima_id);
        const account = await call("getProxyAccount", session);
        if (account?.address != null) evmAddress(account.address);
        return { anima_account_exists: account?.address != null };
      }
      case "session_isAccountOfAnimaUnlocked": {
        const params = parameters(request, session, ["anima_id"]);
        positiveID(params.anima_id);
        const account = await call("getProxyAccount", session);
        if (account?.address != null) evmAddress(account.address);
        return { is_account_of_anima_unlocked: account?.address != null && account.unlocked === true };
      }
      case "session_createAccountForAnima": {
        const params = parameters(request, session, ["caller", "anima_id", "password"], true);
        positiveID(params.anima_id);
        const created = await call("createProxyAccount", session, password(params.password));
        if (typeof created?.mnemonic !== "string" || !created.mnemonic.trim()) fail("LEGACY_PROXY_RECOVERY_UNAVAILABLE");
        return { address_of_created_anima_account: evmAddress(created.address), mnemonic_of_created_anima_account: created.mnemonic };
      }
      case "session_unlockAccountOfAnima": {
        const params = parameters(request, session, ["anima_id", "password"]);
        positiveID(params.anima_id);
        const unlocked = await call("unlockProxyAccount", session, password(params.password));
        if (unlocked?.unlocked !== true) fail("LEGACY_PROXY_UNLOCK_FAILED");
        return { address_of_unlocked_anima_account: evmAddress(unlocked.address) };
      }
      case "session_recoverAnimaAccount": {
        const params = parameters(request, session, ["anima_id", "new_password", "mnemonic"]);
        positiveID(params.anima_id);
        if (typeof params.mnemonic !== "string" || params.mnemonic.length > 1024) fail("INVALID_LEGACY_PROXY_PARAMS");
        const recovered = await call("recoverProxyAccount", session, password(params.new_password), params.mnemonic);
        evmAddress(recovered?.address);
        return null;
      }
      case "session_updateAnimaAccountPassword": {
        const params = parameters(request, session, ["anima_id", "password", "new_password"]);
        positiveID(params.anima_id);
        await call("updateProxyPassword", session, password(params.password), password(params.new_password));
        return null;
      }
      case "session_getPrivateKeyOfAnimaId": {
        const params = parameters(request, session, ["anima_id", "password"]);
        positiveID(params.anima_id);
        const account = await call("getProxyAccount", session);
        const privateKey = await call("getProxyPrivateKey", session, password(params.password));
        if (typeof privateKey !== "string" || !/^0x[0-9a-f]{64}$/i.test(privateKey)) fail("LEGACY_PROXY_RECOVERY_UNAVAILABLE");
        // Explicit legacy key export returns only the scoped EVM wallet key.
        return { private_key: privateKey, address: evmAddress(account?.address) };
      }
      case "session_getAccountBalance": {
        const params = parameters(request, session, ["caller", "anima_id"], true);
        positiveID(params.anima_id);
        const account = await call("getProxyAccount", session);
        const result = await balance(session, account?.address);
        // This client wallet route consumes display units directly. It does
        // not apply the later ERC2771 client's hard-coded 1e-18 multiplier.
        return { balance: displayBalance(result.value, result.decimals) };
      }
      case "blockchain_connection_read": {
        const params = parameters(request, session, ["contractName", "funcName", "args", "kwargs"]);
        if (params.contractName !== "EveTokenBroker" || !["balanceOf", "balanceOfEveOwnerId"].includes(params.funcName)) {
          fail("LEGACY_PROXY_METHOD_NOT_SUPPORTED");
        }
        if (!Array.isArray(params.args) || params.args.length !== 1 ||
            params.kwargs != null && (!map(params.kwargs) || Object.keys(params.kwargs).length)) fail("INVALID_LEGACY_PROXY_PARAMS");
        let address: unknown;
        if (params.funcName === "balanceOf") address = evmAddress(params.args[0]);
        else {
          if (positiveID(params.args[0]) !== identity(session).characterID) fail("CHARACTER_IDENTITY_MISMATCH");
          address = (await call("getProxyAccount", session))?.address;
        }
        const result = await balance(session, address);
        // The virtual EVE broker has 18 legacy decimal places. This changes
        // wire units only; unsupported sub-wei precision is never rounded.
        return { read_result: convertLegacyEvmTokenUnits(result.value, result.decimals, 18), decimals: 18 };
      }
      case "session_ssuBringOnline":
      case "session_ssuTakeOffline": {
        const params = parameters(request, session, ["item_id", "ssu_item_id", "caller"], true);
        const itemID = positiveID(params.item_id);
        if (positiveID(params.ssu_item_id) !== itemID) fail("INVALID_LEGACY_PROXY_PARAMS");
        const result = await call("proxyLifecycle", session, itemID, request.method === "session_ssuBringOnline" ? 2 : 1);
        if (result?.success !== true) fail("LEGACY_PROXY_LIFECYCLE_FAILED");
        // A queued intent stays pending until the Sui worker confirms it.
        return { success: true, pending: result.pending !== false, item_id: itemID,
          ...(typeof result.transactionDigest === "string" ? { transaction_digest: result.transactionDigest } : {}) };
      }
      case "config_config": {
        parameters(request, session, []);
        const configuration = await call("getProxyConfiguration", session);
        if (!map(configuration?.smart_contracts) || !map(configuration?.well_known_addresses)) fail("LEGACY_PROXY_CONFIG_UNAVAILABLE");
        const smart_contracts: Record<string, string> = Object.create(null);
        const well_known_addresses: Record<string, string> = Object.create(null);
        for (const [name, address] of Object.entries(configuration.smart_contracts)) {
          if (!/^[A-Za-z][A-Za-z0-9_]{0,95}$/.test(name)) fail("LEGACY_PROXY_CONFIG_UNAVAILABLE");
          smart_contracts[name] = evmAddress(address);
        }
        for (const [name, address] of Object.entries(configuration.well_known_addresses)) {
          if (!/^[A-Za-z0-9_-]{1,96}$/.test(name)) fail("LEGACY_PROXY_CONFIG_UNAVAILABLE");
          well_known_addresses[name] = evmAddress(address);
        }
        return { smart_contracts, well_known_addresses };
      }
      case "health_health": {
        parameters(request, session, []);
        const health = await call("getProxyHealth", session);
        if (!map(health) || health.ready !== true) fail("LEGACY_PROXY_CHAIN_UNAVAILABLE");
        return { ready: true, backend: "sui" };
      }
      default:
        // Contract storage, currency and arbitrary Ethereum RPCs require their
        // own verified adapters; absence never produces an empty success.
        return fail("LEGACY_PROXY_METHOD_NOT_SUPPORTED");
    }
  }

  return {
    async handleRpc(request: any, session: any) {
      try {
        if (!map(request) || request.jsonrpc !== "2.0" || typeof request.method !== "string" || request.method.length > 128 ||
            !(typeof request.id === "string" || typeof request.id === "number" && Number.isFinite(request.id) || request.id === null)) {
          fail("INVALID_LEGACY_PROXY_REQUEST");
        }
        const result = await dispatch(request, session);
        return { jsonrpc: "2.0", id: request.id, result };
      } catch (error) { return legacyProxyRpcError(request?.id, error); }
    },
  };
}
