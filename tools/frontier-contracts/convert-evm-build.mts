import fs from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { buildLegacyEvmClientConfig, deriveLegacyEvmSmartObjectID } = require("../../server/src/services/frontier/legacyEvmClientConfig.js");
const { getLegacyEvmBuildAdapter, listLegacyEvmBuildAdapters } = require("../../server/src/services/frontier/legacyEvmBuildAdapters.js");
const { evmAddress, evmUint256, createLegacyEvmTypedData } = require("../../server/src/services/frontier/legacyEvmAuthorization.js");

function apiURL(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) throw new Error("Supply the server API URL with --api-url");
  const url = new URL(value);
  if (!["http:", "https:"].includes(url.protocol)) throw new Error("The API URL must use HTTP or HTTPS");
  return value.replace(/\/+$/, "");
}

function accountPolicy(value: unknown): Record<string, any> | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      (value as any).mode !== "authenticated-server" ||
      (value as any).passphraseStorage !== "aes-256-gcm-v1") throw new Error("Invalid automatic account policy");
  return value as Record<string, any>;
}

function objectPolicy(value: unknown): Record<string, any> | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      (value as any).mode !== "owned-runtime") throw new Error("Invalid automatic assembly policy");
  return value as Record<string, any>;
}

/** Prepare an exact-build conversion manifest without changing a server or client. */
export function prepareLegacyEvmBuildConversion(input: Record<string, any>) {
  const clientBuild = Number(input.build);
  let adapter;
  try { adapter = getLegacyEvmBuildAdapter(clientBuild); }
  catch { throw new Error(`Supported EVM builds: ${listLegacyEvmBuildAdapters().map(value => value.clientBuild).join(", ")}`); }
  const tenant = input.tenant ?? (clientBuild === 2615573 ? "devnet" : "dev");
  if (typeof tenant !== "string" || !tenant.trim() || Buffer.byteLength(tenant) > 1024) throw new Error("A valid tenant is required");
  const baseURL = apiURL(input.apiUrl);
  const automaticAccounts = accountPolicy(input.accountPolicy);
  const automaticObjects = objectPolicy(input.objectPolicy);
  if (!input.accounts || typeof input.accounts !== "object" || Array.isArray(input.accounts) ||
      !Object.keys(input.accounts).length && !automaticAccounts) {
    throw new Error("Supply account wallet bindings with --accounts");
  }
  const accounts: Record<string, any> = {};
  for (const [id, value] of Object.entries<any>(input.accounts)) {
    if (!/^[1-9][0-9]*$/.test(id) || !Number.isSafeInteger(Number(id)) || !value ||
        typeof value !== "object" || Array.isArray(value) || adapter.workflow === "erc2771" && !automaticAccounts &&
        (typeof value.walletPassphrase !== "string" || !value.walletPassphrase)) throw new Error("Invalid account wallet binding");
    if (value.walletPassphrase !== undefined && (typeof value.walletPassphrase !== "string" || !value.walletPassphrase)) {
      throw new Error("Invalid account wallet passphrase");
    }
    accounts[id] = { ...(value.evmAddress !== undefined ? { evmAddress: evmAddress(value.evmAddress) } : {}),
      ...(value.walletPassphrase !== undefined ? { walletPassphrase: value.walletPassphrase } : {}) };
  }
  const objects: Record<string, number> = {};
  const items = input.items ?? [];
  if (!Array.isArray(items)) throw new Error("Assembly IDs must be supplied as an array");
  for (const item of items) {
    const itemID = Number(item);
    if (!Number.isSafeInteger(itemID) || itemID <= 0) throw new Error("Assembly IDs must be positive safe integers");
    objects[deriveLegacyEvmSmartObjectID(tenant, itemID, clientBuild)] = itemID;
  }
  const balanceSource = input.tokenBalanceSource ?? (input.tokenCoinType ? "sui-coin" : "local-ledger");
  if (!["local-ledger", "sui-coin"].includes(balanceSource)) throw new Error("Token balance source must be local-ledger or sui-coin");
  if (balanceSource === "sui-coin" && (typeof input.tokenCoinType !== "string" || !input.tokenCoinType.trim())) {
    throw new Error("Sui coin balances require --token-coin-type");
  }
  const tokenDecimals = balanceSource === "local-ledger" ? 9 : Number(input.tokenDecimals);
  if (!Number.isInteger(tokenDecimals) || tokenDecimals < 0 || tokenDecimals > 36) {
    throw new Error("Sui coin balances require --token-decimals between 0 and 36");
  }
  const recoveryKey = input.recoveryKey ?? randomBytes(32).toString("base64");
  if (typeof recoveryKey !== "string" || Buffer.from(recoveryKey, "base64").length !== 32 ||
      Buffer.from(recoveryKey, "base64").toString("base64") !== recoveryKey) throw new Error("Recovery key must be a canonical base64-encoded 32-byte secret");
  const config: Record<string, any> = {
    format: "evejs-legacy-evm-sui-v1", clientBuild, tenant,
    adapter: { workflow: adapter.workflow, cfgShape: adapter.cfgShape, systemIdMode: adapter.systemIdMode,
      lifecycleArgument: adapter.lifecycleArgument, objectIdMode: adapter.objectIdMode,
      requiresWorldApi: adapter.requiresWorldApi, bootstrapMode: adapter.bootstrapMode,
      recoveryMode: adapter.recoveryMode, characterCreation: adapter.characterCreation },
    worldApiBaseUrl: baseURL, recoveryKey, tokenBalanceSource: balanceSource, tokenDecimals,
    ...(automaticAccounts ? { accountPolicy: automaticAccounts } : {}),
    ...(automaticObjects ? { objectPolicy: automaticObjects } : {}),
    ...(balanceSource === "sui-coin" ? { tokenCoinType: input.tokenCoinType.trim() } : {}),
    accounts, objects,
  };
  if (adapter.workflow === "proxy") {
    const blockchainId = Number(input.proxyBlockchainId ?? 3537357);
    if (!Number.isSafeInteger(blockchainId) || blockchainId <= 0) throw new Error("Proxy blockchain ID must be a positive safe integer");
    config.proxy = {
      blockchainId,
      jsonRpcUrl: input.proxyUrl ? apiURL(input.proxyUrl) : "http://127.0.0.1:32811/jsonrpc",
      clientEndpoint: "http://proxy.devnet.dev-cluster.deusxvm.com:32811/jsonrpc",
      redirectRequired: true,
    };
  } else {
    const systemId = (name: string) => "0x" + Buffer.concat([
      Buffer.from("sy"), Buffer.alloc(14), Buffer.from(name.padEnd(16, "\0")),
    ]).toString("hex");
    config.worldAddress = "0x000000000000000000000000000000000000e001";
    config.domain = { name: "ERC2771Forwarder", version: "1", chainId: 31337,
      verifyingContract: "0x000000000000000000000000000000000000e002" };
    config.systems = { createCharacter: { systemId: systemId("CreateCharacter") },
      bringOnline: { systemId: systemId("BringOnline") }, bringOffline: { systemId: systemId("BringOffline") } };
  }
  // This checks the native reader's shape without starting a relay, a client,
  // a repository, or a chain connection. Runtime authority is checked on use.
  buildLegacyEvmClientConfig(config);
  return config;
}

function isRecord(value: unknown): value is Record<string, any> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

/** Validate a saved private manifest without normalizing away existing secrets or pins. */
export function validateLegacyEvmConversionManifest(value: unknown, clientBuild: number): asserts value is Record<string, any> {
  const adapter = getLegacyEvmBuildAdapter(clientBuild);
  if (!isRecord(value) || value.format !== "evejs-legacy-evm-sui-v1" || value.clientBuild !== clientBuild ||
      typeof value.tenant !== "string" || !value.tenant.trim() || Buffer.byteLength(value.tenant) > 1024 ||
      !isRecord(value.accounts) || !isRecord(value.objects)) throw new Error("Existing EVM manifest is malformed or targets a different build");
  const automatic = accountPolicy(value.accountPolicy);
  objectPolicy(value.objectPolicy);
  if (!automatic && !Object.keys(value.accounts).length) throw new Error("Existing EVM manifest has neither account bindings nor an authenticated account policy");
  if (typeof value.recoveryKey !== "string" || Buffer.from(value.recoveryKey, "base64").length !== 32 ||
      Buffer.from(value.recoveryKey, "base64").toString("base64") !== value.recoveryKey) {
    throw new Error("Existing EVM manifest has no valid recovery key; refusing to replace it");
  }
  for (const [id, account] of Object.entries<any>(value.accounts)) {
    if (!/^[1-9][0-9]*$/.test(id) || !Number.isSafeInteger(Number(id)) || !isRecord(account) ||
        account.walletPassphrase !== undefined && (typeof account.walletPassphrase !== "string" || !account.walletPassphrase) ||
        adapter.workflow === "erc2771" && !automatic && !account.walletPassphrase) throw new Error("Existing EVM manifest has an invalid account binding");
    if (account.evmAddress !== undefined) evmAddress(account.evmAddress);
  }
  const seen = new Set<string>();
  for (const [objectID, item] of Object.entries(value.objects)) {
    if (typeof item !== "number" || !Number.isSafeInteger(item) || item <= 0) throw new Error("Existing EVM manifest has an invalid assembly mapping");
    const key = /^0x[0-9a-f]{64}$/i.test(objectID) ? BigInt(objectID).toString() : evmUint256(objectID);
    if (seen.has(key) || key !== deriveLegacyEvmSmartObjectID(value.tenant, item, clientBuild)) {
      throw new Error("Existing EVM manifest has a conflicting assembly mapping");
    }
    seen.add(key);
  }
  if (value.adapter !== undefined) {
    if (!isRecord(value.adapter)) throw new Error("Existing EVM manifest has an invalid build adapter");
    for (const [name, configured] of Object.entries(value.adapter)) {
      if (Object.hasOwn(adapter, name) && configured !== adapter[name]) throw new Error("Existing EVM manifest has a conflicting build adapter");
    }
  }
  apiURL(value.worldApiBaseUrl);
  if (adapter.workflow === "erc2771") {
    if (!isRecord(value.systems)) throw new Error("Existing EVM manifest has no signing systems");
    for (const entry of Object.values<any>(value.systems)) {
      if (!isRecord(entry) || typeof entry.systemId !== "string" || !/^0x[0-9a-f]{64}$/i.test(entry.systemId)) {
        throw new Error("Existing EVM manifest has an invalid signing system");
      }
    }
    const address = evmAddress(value.worldAddress);
    createLegacyEvmTypedData(value.domain, { from: address, to: address, value: "0", gas: "1", nonce: "0", deadline: "0", data: "0x" });
  }
  if (value.tokenBalanceSource !== undefined && !["local-ledger", "sui-coin"].includes(value.tokenBalanceSource)) {
    throw new Error("Existing EVM manifest has an invalid token balance source");
  }
  if (value.tokenBalanceSource === "sui-coin" && (typeof value.tokenCoinType !== "string" || !value.tokenCoinType.trim() ||
      !Number.isInteger(value.tokenDecimals) || value.tokenDecimals < 0 || value.tokenDecimals > 36)) {
    throw new Error("Existing EVM manifest has incomplete Sui token configuration");
  }
  if (value.tokenDecimals !== undefined && (!Number.isInteger(value.tokenDecimals) || value.tokenDecimals < 0 || value.tokenDecimals > 36 ||
      value.tokenBalanceSource === "local-ledger" && value.tokenDecimals !== 9)) throw new Error("Existing EVM manifest has invalid token precision");
  buildLegacyEvmClientConfig(value);
}

/**
 * Pure setup/sync factory. New manifests opt in to authenticated enrollment;
 * existing manual manifests retain their account and mapping policies.
 */
export function prepareLegacyEvmBuildSynchronization(input: Record<string, any>) {
  const clientBuild = Number(input.build);
  getLegacyEvmBuildAdapter(clientBuild);
  const existing = input.existing;
  if (existing === undefined) {
    return prepareLegacyEvmBuildConversion({ ...input, accounts: input.accounts || {},
      apiUrl: input.apiUrl || "http://127.0.0.1:26102",
      accountPolicy: { mode: "authenticated-server", passphraseStorage: "aes-256-gcm-v1" },
      objectPolicy: { mode: "owned-runtime" } });
  }
  validateLegacyEvmConversionManifest(existing, clientBuild);
  if (input.tenant !== undefined && input.tenant !== existing.tenant) throw new Error("Sync cannot change the existing EVM tenant");
  if (input.recoveryKey !== undefined && input.recoveryKey !== existing.recoveryKey) throw new Error("Sync cannot replace the existing EVM recovery key");
  const accounts: Record<string, any> = structuredClone(existing.accounts);
  if (input.accounts !== undefined && !isRecord(input.accounts)) throw new Error("Account bindings must be a JSON object");
  for (const [id, incoming] of Object.entries<any>(input.accounts || {})) {
    if (!isRecord(incoming)) throw new Error("Invalid account wallet binding");
    if (accounts[id]) {
      for (const [name, requested] of Object.entries(incoming)) {
        const old = accounts[id][name];
        if (old !== undefined && (name === "evmAddress" ? evmAddress(old) !== evmAddress(requested) : JSON.stringify(old) !== JSON.stringify(requested))) {
          throw new Error("Sync cannot replace an existing account pin or credential");
        }
      }
      accounts[id] = { ...incoming, ...accounts[id] };
    } else accounts[id] = structuredClone(incoming);
  }
  const generated = prepareLegacyEvmBuildConversion({ ...input, build: clientBuild,
    tenant: existing.tenant, recoveryKey: existing.recoveryKey, accounts,
    apiUrl: input.apiUrl || existing.worldApiBaseUrl,
    tokenBalanceSource: existing.tokenBalanceSource || "local-ledger", tokenCoinType: existing.tokenCoinType,
    tokenDecimals: existing.tokenDecimals,
    accountPolicy: existing.accountPolicy, objectPolicy: existing.objectPolicy,
    proxyBlockchainId: existing.proxy?.blockchainId, proxyUrl: input.proxyUrl || existing.proxy?.jsonRpcUrl });
  const objects: Record<string, number> = structuredClone(existing.objects);
  const known = new Set(Object.keys(objects).map(key => /^0x[0-9a-f]{64}$/i.test(key) ? BigInt(key).toString() : key));
  for (const [key, value] of Object.entries<number>(generated.objects)) if (!known.has(key)) objects[key] = value;
  // An automatic repeat sync is validation-only. Do not rewrite a manual
  // manifest to add defaults, policies, ABI entries or cosmetic metadata.
  const result: Record<string, any> = { ...structuredClone(existing), accounts, objects };
  if (input.apiUrl !== undefined) result.worldApiBaseUrl = generated.worldApiBaseUrl;
  if (input.proxyUrl !== undefined) result.proxy = { ...result.proxy, jsonRpcUrl: generated.proxy.jsonRpcUrl };
  validateLegacyEvmConversionManifest(result, clientBuild);
  return result;
}

export function main(args = process.argv.slice(2)) {
  const { values } = parseArgs({ args, options: {
    build: { type: "string" }, accounts: { type: "string" }, item: { type: "string", multiple: true },
    tenant: { type: "string" }, "api-url": { type: "string" }, out: { type: "string" },
    "proxy-url": { type: "string" }, "proxy-blockchain-id": { type: "string" },
    "token-balance-source": { type: "string" }, "token-coin-type": { type: "string" }, "token-decimals": { type: "string" },
    help: { type: "boolean", short: "h" },
  } });
  if (values.help) {
    process.stdout.write("Usage: npm run frontier:convert-evm -- --build 2973163 --accounts accounts.json [--item 1001] --api-url http://127.0.0.1:26102 --out bridge.json\n");
    process.stdout.write(`Exact EVM builds: ${listLegacyEvmBuildAdapters().map(value => value.clientBuild).join(", ")}\n`);
    return;
  }
  if (!values.accounts || !values.out) throw new Error("--accounts and --out are required (use --help)");
  const config = prepareLegacyEvmBuildConversion({ build: values.build, tenant: values.tenant,
    accounts: JSON.parse(fs.readFileSync(values.accounts, "utf8")), items: values.item, apiUrl: values["api-url"],
    proxyUrl: values["proxy-url"], proxyBlockchainId: values["proxy-blockchain-id"],
    tokenBalanceSource: values["token-balance-source"], tokenCoinType: values["token-coin-type"], tokenDecimals: values["token-decimals"] });
  const destination = path.resolve(values.out);
  fs.writeFileSync(destination, JSON.stringify(config, null, 2) + "\n", { flag: "wx", mode: 0o600 });
  process.stdout.write(`Prepared build ${config.clientBuild}: ${destination}\nSet EVEJS_CLIENT_BUILD_PROFILE=frontier-${config.clientBuild}, EVEJS_CLIENT_BUILD=${config.clientBuild} and EVEJS_LEGACY_EVM_SUI_BRIDGE_PATH to this file, then restart.\n`);
  if (config.proxy?.redirectRequired) {
    process.stdout.write(`Build ${config.clientBuild} requires routing its packaged proxy endpoint ${config.proxy.clientEndpoint} to ${config.proxy.jsonRpcUrl}. The manifest does not change client DNS or URLs.\n`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); }
  catch (error) { process.stderr.write(String(error?.message || error) + "\n"); process.exitCode = 1; }
}
