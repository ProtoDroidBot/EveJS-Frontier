import fs = require("node:fs");
import path = require("node:path");
import { createHash } from "node:crypto";
import { createLegacyEvmTypedData, evmAddress, evmKeccakHex, evmUint256,
  hashLegacyEvmTypedData, verifyLegacyEvmAuthorization } from "./legacyEvmAuthorization";
import { getLegacyEvmBuildAdapter, listLegacyEvmBuildAdapters } from "./legacyEvmBuildAdapters";
import { buildLegacyEvmClientConfig, deriveLegacyEvmSmartObjectID,
  getLegacyEvmCreateCharacterABI, getLegacyEvmCreateCharacterSignature } from "./legacyEvmClientConfig";
import { decodeLegacyEvmAbi, legacyEvmSelector, unwrapLegacyEvmCall } from "./legacyEvmCallData";
import { createLegacyEvmWalletBootstrap } from "./legacyEvmWalletBootstrap";

const TABLE = "frontierLegacyEvmRelayState";
export const LEGACY_EVM_META_TRANSACTION_REQUEST = "eve_public.blockchain.metatransaction.MetaTransactionRequest";
export const LEGACY_EVM_SUI_BUILDS = Object.freeze(listLegacyEvmBuildAdapters().map(adapter => adapter.clientBuild));
function fail(code: string): never { throw Object.assign(new Error(code), { code }); }
function positiveID(value: unknown): number {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id <= 0) fail("INVALID_LEGACY_EVM_IDENTIFIER");
  return id;
}
function systemID(value: unknown): string {
  if (typeof value !== "string" || !/^0x[0-9a-f]{64}$/i.test(value)) fail("INVALID_LEGACY_EVM_CONFIG");
  return value.toLowerCase();
}
function defaultSystem(name: string) {
  return `0x${Buffer.concat([Buffer.from("sy"), Buffer.alloc(14), Buffer.from(name.padEnd(16, "\0"))]).toString("hex")}`;
}

/** Translate atomic token units exactly; legacy wallet UIs always assume 18 decimals. */
export function convertLegacyEvmTokenUnits(value: unknown, fromDecimals: number, toDecimals = 18): string {
  if (![fromDecimals, toDecimals].every(number => Number.isInteger(number) && number >= 0 && number <= 36)) fail("LEGACY_EVM_TOKEN_DECIMALS_REQUIRED");
  const amount = BigInt(evmUint256(value));
  if (fromDecimals <= toDecimals) return evmUint256(amount * 10n ** BigInt(toDecimals - fromDecimals));
  const divisor = 10n ** BigInt(fromDecimals - toDecimals);
  if (amount % divisor !== 0n) fail("LEGACY_EVM_TOKEN_PRECISION_UNREPRESENTABLE");
  return (amount / divisor).toString();
}

export function decodeLegacyEvmLifecycleCall(data: string, sender: string, systems: any) {
  const call = unwrapLegacyEvmCall(data, sender);
  for (const [name, targetStatus] of [["bringOnline", 2], ["bringOffline", 1]] as const) {
    if (systems[name] && call.systemId === systemID(systems[name].systemId) &&
        call.callData.slice(2, 10) === legacyEvmSelector(`${name}(uint256)`)) {
      const decoded = decodeLegacyEvmAbi([{ name: "id", type: "uint256" }], `0x${call.callData.slice(10)}`);
      return { action: name, targetStatus, objectID: decoded.id as string };
    }
  }
  return fail("UNSUPPORTED_LEGACY_EVM_CALL");
}

/** Authenticated legacy wallets authorize intents; the existing Sui services execute them. */
export function createLegacyEvmSuiBridge(options: Record<string, any>) {
  const build = positiveID(options.clientBuild), adapter = getLegacyEvmBuildAdapter(build);
  const supplied = options.config;
  if (!supplied || supplied.format !== "evejs-legacy-evm-sui-v1" || supplied.clientBuild !== build ||
      typeof supplied.tenant !== "string" || !supplied.tenant.trim()) fail("INVALID_LEGACY_EVM_CONFIG");
  const automaticAccounts = supplied.accountPolicy?.mode === "authenticated-server" &&
    supplied.accountPolicy?.passphraseStorage === "aes-256-gcm-v1";
  if (supplied.accountPolicy !== undefined && !automaticAccounts ||
      supplied.objectPolicy !== undefined && supplied.objectPolicy?.mode !== "owned-runtime") fail("INVALID_LEGACY_EVM_CONFIG");
  const accounts = supplied.accounts ?? (automaticAccounts ? {} : null);
  if (!accounts || typeof accounts !== "object" || Array.isArray(accounts) ||
      !automaticAccounts && Object.keys(accounts).length === 0) fail("INVALID_LEGACY_EVM_CONFIG");
  const config = { ...supplied, accounts, systems: { ...supplied.systems,
    createCharacter: supplied.systems?.createCharacter || { systemId: defaultSystem("CreateCharacter") } } };
  if (config.suiTenant !== undefined && config.suiTenant !== "dev" ||
      config.suiTribeId !== undefined && config.suiTribeId !== 100) fail("UNSUPPORTED_LEGACY_EVM_SUI_IDENTITY");
  if (adapter.workflow === "erc2771" && (!config.worldAddress || !config.domain)) fail("INVALID_LEGACY_EVM_CONFIG");
  const worldAddress = adapter.workflow === "erc2771" ? evmAddress(config.worldAddress) : null;
  const domain = worldAddress ? createLegacyEvmTypedData(config.domain, { from: worldAddress, to: worldAddress,
    value: "0", gas: "1", nonce: "0", deadline: "0", data: "0x" }).domain : null;
  for (const value of Object.values<any>(config.systems)) systemID(value.systemId);
  const objectItems = new Map<string, number>();
  for (const [objectID, itemID] of Object.entries(config.objects || {})) {
    const key = /^0x[0-9a-f]{64}$/i.test(objectID) ? BigInt(objectID).toString() : evmUint256(objectID);
    const item = positiveID(itemID);
    if (key !== deriveLegacyEvmSmartObjectID(config.tenant, item, build) || objectItems.has(key)) fail("INVALID_LEGACY_EVM_OBJECT_MAPPING");
    objectItems.set(key, item);
  }
  const now = options.now || Date.now;
  const character = () => options.character || require("../character/characterState");
  const deployment = () => options.deployment || require("./deploymentRuntime");
  function baseIdentity(session: any) {
    if (!session || typeof session !== "object" || session._characterControlDisconnected === true || session.socket?.destroyed) fail("AUTHENTICATION_REQUIRED");
    const userID = positiveID(session.userid), characterID = positiveID(session.characterID || session.charid);
    const record = character().getCharacterRecord(characterID);
    if (!record || Number(record.accountId ?? record.accountID ?? record.userID ?? record.userid) !== userID) fail("CHARACTER_IDENTITY_MISMATCH");
    const configured = Object.prototype.hasOwnProperty.call(config.accounts, String(userID));
    const account = configured ? config.accounts[String(userID)] : automaticAccounts ? {} : null;
    if (!account) fail("LEGACY_EVM_WALLET_BINDING_UNAVAILABLE");
    if (typeof account !== "object" || Array.isArray(account)) fail("INVALID_LEGACY_EVM_CONFIG");
    return { userID, characterID, account, record, sender: account.evmAddress ? evmAddress(account.evmAddress) : null };
  }
  const bootstrap = options.bootstrap || createLegacyEvmWalletBootstrap({ ...(options.bootstrapOptions || {}),
    config, clientBuild: build, character: options.character, now, resolveIdentity: baseIdentity });
  function identity(session: any, requireBinding = true) {
    const who = baseIdentity(session), saved = bootstrap.getWalletBinding(session);
    if (who.sender && saved && who.sender !== saved) fail("LEGACY_EVM_WALLET_BINDING_CONFLICT");
    const sender = saved || who.sender;
    if (requireBinding && !sender) fail("LEGACY_EVM_WALLET_BINDING_UNAVAILABLE");
    return { ...who, sender };
  }
  function assertIdentity(session: any, original: any) {
    const current = identity(session, false);
    if (current.userID !== original.userID || current.characterID !== original.characterID ||
        original.sender && current.sender !== original.sender) fail("CHARACTER_IDENTITY_MISMATCH");
    return current;
  }
  let repo: any, tail: Promise<any> = Promise.resolve();
  function journal() {
    if (!repo) {
      const candidate = options.repo || require("../../gameStore/tableRepository")
        .createTableRepository("service:legacy-evm-sui", { strict: true });
      if (candidate.ensureTable(TABLE)?.success === false) fail("LEGACY_EVM_JOURNAL_UNAVAILABLE");
      repo = candidate;
    }
    return repo;
  }
  function write(key: string, value: any) {
    const store = journal();
    if (!store.commitAtomicRowWrites([store.prepareAtomicRowWrite(TABLE, key, value)])?.success ||
        store.flushTableSync(TABLE)?.success === false) fail("LEGACY_EVM_JOURNAL_UNAVAILABLE");
  }
  function serial<T>(operation: () => Promise<T>): Promise<T> {
    const result = tail.then(operation, operation);
    tail = result.then(() => undefined, () => undefined);
    return result;
  }
  function getClientConfiguration(session: any) {
    const who = baseIdentity(session);
    return { web3Config: config.web3Config || buildLegacyEvmClientConfig(config), tenant: config.tenant,
      worldApiBaseUrl: config.worldApiBaseUrl, walletPassphrase: Object.prototype.hasOwnProperty.call(who.account, "walletPassphrase")
        ? who.account.walletPassphrase : automaticAccounts ? bootstrap.getWalletPassphrase(session) : undefined };
  }
  function resolveMappedAssembly(objectID: string, session: any, who: any): number {
    const configured = objectItems.get(objectID);
    if (configured) return configured;
    if (config.objectPolicy?.mode !== "owned-runtime") fail("LEGACY_EVM_OBJECT_NOT_MAPPED");
    const solarSystemID = positiveID(session.solarsystemid2 || session.solarsystemid || session.locationid);
    const runtime = deployment();
    const candidates = adapter.workflow === "proxy"
      ? [runtime.getAssemblyRecord(positiveID(objectID))]
      : runtime.listAssemblies({ ownerID: who.characterID, solarSystemID });
    const matching = candidates.filter((assembly: any) => assembly?.createOnChain === true &&
      Number(assembly.ownerID) === who.characterID && Number(assembly.solarSystemID) === solarSystemID &&
      deriveLegacyEvmSmartObjectID(config.tenant, assembly.itemID, build) === objectID);
    if (matching.length !== 1) fail("LEGACY_EVM_OBJECT_NOT_MAPPED");
    return positiveID(matching[0].itemID);
  }
  function authorize(request: any, session: any) {
    if (adapter.workflow !== "erc2771") fail("UNSUPPORTED_LEGACY_EVM_CALL");
    const trusted = identity(session, false);
    const typed = request?.meta_tx || createLegacyEvmTypedData(domain!, {
      from: request?.sender, to: request?.address, value: String(request?.value ?? "0"),
      gas: String(request?.gas ?? "0"), nonce: request?.nonce,
      deadline: String(request?.deadline ?? "0"), data: request?.data });
    const sender = trusted.sender || evmAddress(typed?.message?.from);
    if (!verifyLegacyEvmAuthorization({ typedData: typed, signature: request.signature, expectedSender: sender,
      expectedDomain: domain!, expectedTarget: worldAddress!, nowSeconds: Math.floor(now() / 1000) })) fail("INVALID_LEGACY_EVM_SIGNATURE");
    const normalized = createLegacyEvmTypedData(typed.domain, typed.message);
    if (normalized.message.value !== "0") fail("UNSUPPORTED_LEGACY_EVM_VALUE");
    return { trusted, typed: normalized, sender, signature: request.signature };
  }
  function assertAuthorization(auth: any, session: any) {
    const current = assertIdentity(session, auth.trusted);
    if (current.sender && current.sender !== auth.sender || !verifyLegacyEvmAuthorization({ typedData: auth.typed,
      signature: auth.signature, expectedSender: auth.sender, expectedDomain: domain!, expectedTarget: worldAddress!,
      nowSeconds: Math.floor(now() / 1000) })) fail("INVALID_LEGACY_EVM_SIGNATURE");
    return current;
  }
  function journalIdentity(auth: any, operation: string, itemID: number) {
    const digest = hashLegacyEvmTypedData(auth.typed).toString("hex");
    const key = createHash("sha256").update(`${domain!.chainId}:${domain!.verifyingContract}:${auth.sender}:${auth.typed.message.nonce}`).digest("hex");
    const found = journal().read(TABLE, `/${key}`);
    if (!found || found.success === false && found.errorMsg !== "ENTRY_NOT_FOUND") fail("LEGACY_EVM_JOURNAL_UNAVAILABLE");
    const previous = found.data;
    if (previous && (previous.digest !== digest || previous.userID !== auth.trusted.userID ||
        previous.characterID !== auth.trusted.characterID || previous.itemID !== itemID ||
        previous.operation && previous.operation !== operation)) fail("LEGACY_EVM_NONCE_CONFLICT");
    return { key, previous, state: { digest, userID: auth.trusted.userID, characterID: auth.trusted.characterID,
      clientBuild: build, itemID, operation, status: "started", createdAtMs: now() } };
  }
  function decodeCreation(auth: any, session: any) {
    const call = unwrapLegacyEvmCall(auth.typed.message.data, auth.sender);
    if (call.systemId !== systemID(config.systems.createCharacter.systemId) ||
        call.callData.slice(2, 10) !== legacyEvmSelector(getLegacyEvmCreateCharacterSignature(build))) fail("UNSUPPORTED_LEGACY_EVM_CALL");
    const data = decodeLegacyEvmAbi(getLegacyEvmCreateCharacterABI(build).inputs, `0x${call.callData.slice(10)}`);
    const who = assertIdentity(session, auth.trusted), record = data.entityRecordParams || data.entityRecord;
    const metadata = data.entityRecordMetadata || data.entityRecordOffchain;
    if ((data.smartObjectId || data.characterId) !== deriveLegacyEvmSmartObjectID(config.tenant, who.characterID, build) ||
        evmAddress(data.owner || data.characterAddress) !== auth.sender || record?.itemId !== String(who.characterID)) fail("CHARACTER_IDENTITY_MISMATCH");
    if (record.tenantId !== undefined && record.tenantId !== evmKeccakHex(Buffer.from(config.tenant))) fail("CHARACTER_IDENTITY_MISMATCH");
    const corporationID = Number(session.corpid || session.corporationID || who.record.corporationID || who.record.corporationId || 0);
    const signedTribe = data.tribeId ?? data.corpId;
    if (signedTribe !== undefined && signedTribe !== String(corporationID)) fail("CHARACTER_IDENTITY_MISMATCH");
    const name = String(who.record.characterName || who.record.name || "").trim();
    if (!name || metadata?.name?.trim() !== name) fail("CHARACTER_IDENTITY_MISMATCH");
    return { characterID: who.characterID, name, verifiedSender: auth.sender };
  }
  async function createSmartCharacter(session: any, request: any) {
    const auth = authorize(request, session), creation = decodeCreation(auth, session);
    return serial(async () => {
      assertAuthorization(auth, session);
      decodeCreation(auth, session);
      const entry = journalIdentity(auth, "create-character", creation.characterID);
      // Provisioning reconciles the same saved bytes/identity after interruption.
      if (entry.previous?.status === "accepted") {
        if (!await bootstrap.characterExists(session, creation.characterID)) fail("LEGACY_EVM_SUI_CHARACTER_UNAVAILABLE");
        assertIdentity(session, auth.trusted);
        const current = character().getCharacterRecord(creation.characterID);
        if (entry.previous.receipt?.chainId !== current?.suiChainId ||
            entry.previous.receipt?.characterObjectId !== current?.suiCharacterObjectId) fail("LEGACY_EVM_SUI_BOOTSTRAP_RECONCILIATION_REQUIRED");
        return { ...entry.previous.receipt, success: true, replayed: true };
      }
      if (!entry.previous) write(entry.key, entry.state);
      const result = await bootstrap.createCharacter(session, { ...creation,
        assertAuthorization: () => { assertAuthorization(auth, session); decodeCreation(auth, session); } });
      assertIdentity(session, auth.trusted);
      if (!result?.success) fail("LEGACY_EVM_SUI_CHARACTER_UNAVAILABLE");
      write(entry.key, { ...entry.state, status: "accepted", receipt: result });
      return result;
    });
  }
  async function relay(request: any, session: any) {
    const auth = authorize(request, session);
    const envelope = unwrapLegacyEvmCall(auth.typed.message.data, auth.sender);
    if (envelope.systemId === systemID(config.systems.createCharacter.systemId) &&
        envelope.callData.slice(2, 10) === legacyEvmSelector(getLegacyEvmCreateCharacterSignature(build))) return createSmartCharacter(session, request);
    if (!auth.trusted.sender) fail("LEGACY_EVM_WALLET_BINDING_UNAVAILABLE");
    const call = decodeLegacyEvmLifecycleCall(auth.typed.message.data, auth.sender, config.systems);
    const itemID = resolveMappedAssembly(call.objectID, session, auth.trusted);
    return serial(async () => {
      assertAuthorization(auth, session);
      const entry = journalIdentity(auth, call.action, itemID);
      if (entry.previous) {
        if (entry.previous.status !== "accepted") fail("LEGACY_EVM_RELAY_RECONCILIATION_REQUIRED");
        return { success: true, replayed: true, itemID, pending: true };
      }
      if (!await bootstrap.characterExists(session, auth.trusted.characterID)) fail("LEGACY_EVM_SUI_CHARACTER_UNAVAILABLE");
      assertAuthorization(auth, session);
      const authoritative = options.isSuiAuthoritative || require("./suiAssemblyState").isSuiAssemblyStateAuthoritative;
      if (!authoritative()) fail("ASSEMBLY_STATE_UNAVAILABLE");
      write(entry.key, entry.state);
      const withState = options.runWithState || require("./suiAssemblyState").runWithSuiAssemblyState;
      const result = await withState(itemID, () => {
        assertAuthorization(auth, session);
        if (!authoritative()) fail("ASSEMBLY_STATE_UNAVAILABLE");
        return deployment().requestAuthorizedAssemblyStateTransition(session, itemID, call.targetStatus);
      });
      if (!result?.success) { write(entry.key, { ...entry.state, status: "rejected", errorMsg: result?.errorMsg }); fail(result?.errorMsg || "LEGACY_EVM_RELAY_FAILED"); }
      write(entry.key, { ...entry.state, status: "accepted" });
      return { success: true, replayed: false, itemID, pending: true };
    });
  }
  function authorizeRecoveryKey(session: any, key: unknown) {
    const who = identity(session, false);
    if (typeof key !== "string" || key !== String(who.characterID) && key.toLowerCase() !== who.sender) fail("CHARACTER_IDENTITY_MISMATCH");
    return who;
  }
  function requireProxy(session: any) {
    if (adapter.workflow !== "proxy") fail("UNSUPPORTED_LEGACY_EVM_CALL");
    return identity(session, false);
  }
  async function sourceTokenBalance(session: any, requestedCharacter: unknown, address: unknown) {
    const who = identity(session), balance = await bootstrap.tokenBalance(session, requestedCharacter, address);
    assertIdentity(session, who);
    const decimals = config.tokenBalanceSource === "local-ledger" ? 9 : config.tokenDecimals;
    if (!Number.isInteger(decimals) || decimals < 0 || decimals > 36) fail("LEGACY_EVM_TOKEN_DECIMALS_REQUIRED");
    return { ...balance, decimals };
  }
  async function ensureProxyCharacter(session: any, address: string) {
    requireProxy(session);
    const account = bootstrap.getCustodialAccount(session);
    if (!account?.unlocked || account.address !== evmAddress(address)) fail("LEGACY_EVM_CUSTODIAL_WALLET_LOCKED");
    return bootstrap.createCharacter(session, { verifiedSender: account.address });
  }
  async function createProxyAccount(session: any, password: string) {
    const who = requireProxy(session), result = await bootstrap.createCustodialWallet(session, password);
    assertIdentity(session, who);
    await ensureProxyCharacter(session, result.address);
    return result;
  }
  async function unlockProxyAccount(session: any, password: string) {
    const who = requireProxy(session), result = await bootstrap.unlockCustodialWallet(session, password);
    assertIdentity(session, who);
    await ensureProxyCharacter(session, result.address);
    return result;
  }
  async function recoverProxyAccount(session: any, password: string, mnemonic: string) {
    const who = requireProxy(session), result = await bootstrap.recoverCustodialWallet(session, password, mnemonic);
    assertIdentity(session, who);
    await ensureProxyCharacter(session, result.address);
    return result;
  }
  async function proxyLifecycle(session: any, requestedItemID: unknown, targetStatus: number) {
    const who = requireProxy(session), itemID = positiveID(requestedItemID);
    resolveMappedAssembly(String(itemID), session, who);
    if (!bootstrap.getCustodialAccount(session).unlocked) fail("LEGACY_EVM_CUSTODIAL_WALLET_LOCKED");
    if (!await bootstrap.characterExists(session, who.characterID)) fail("LEGACY_EVM_SUI_CHARACTER_UNAVAILABLE");
    assertIdentity(session, who);
    const state = require("./suiAssemblyState");
    if (!state.isSuiAssemblyStateAuthoritative()) fail("ASSEMBLY_STATE_UNAVAILABLE");
    const result = await state.runWithSuiAssemblyState(itemID, () => {
      assertIdentity(session, who);
      if (!bootstrap.getCustodialAccount(session).unlocked || !state.isSuiAssemblyStateAuthoritative()) fail("LEGACY_EVM_CUSTODIAL_WALLET_LOCKED");
      return deployment().requestAuthorizedAssemblyStateTransition(session, itemID, targetStatus);
    });
    if (!result?.success) fail(result?.errorMsg || "LEGACY_PROXY_LIFECYCLE_FAILED");
    return { success: true, itemID, pending: true };
  }
  function getProxyConfiguration(session: any) {
    requireProxy(session);
    return { smart_contracts: { EveTokenBroker: "0x000000000000000000000000000000000000e003",
      SmartStorageUnit: "0x000000000000000000000000000000000000e004", ...(config.proxy?.smart_contracts || {}) },
    well_known_addresses: { ...(config.proxy?.well_known_addresses || {}) } };
  }
  return { adapter, getClientConfiguration, relay, createSmartCharacter,
    characterExists: (session: any, id: unknown) => bootstrap.characterExists(session, id),
    tokenBalance: async (session: any, id: unknown, address: unknown) => {
      const balance = await sourceTokenBalance(session, id, address);
      return { ...balance, sourceValue: balance.value, sourceDecimals: balance.decimals,
        value: convertLegacyEvmTokenUnits(balance.value, balance.decimals), decimals: 18 };
    },
    encryptRecovery: (session: any, id: unknown, value: unknown) => { if (positiveID(id) !== baseIdentity(session).characterID) fail("CHARACTER_IDENTITY_MISMATCH"); return bootstrap.encryptRecovery(session, value); },
    decryptRecovery: (session: any, id: unknown, value: unknown) => { if (positiveID(id) !== baseIdentity(session).characterID) fail("CHARACTER_IDENTITY_MISMATCH"); return bootstrap.decryptRecovery(session, value); },
    storePrivateKey: (session: any, key: unknown, value: unknown) => { authorizeRecoveryKey(session, key); return bootstrap.storePrivateKey(session, value); },
    getPrivateKey: (session: any, key: unknown) => { authorizeRecoveryKey(session, key); return bootstrap.getPrivateKey(session); },
    getProxyAccount: (session: any) => { requireProxy(session); return bootstrap.getCustodialAccount(session); },
    createProxyAccount, unlockProxyAccount, recoverProxyAccount, proxyLifecycle, getProxyConfiguration,
    proxyTokenBalance: async (session: any, address?: string) => {
      const who = requireProxy(session), account = bootstrap.getCustodialAccount(session);
      return sourceTokenBalance(session, who.characterID, address || account.address);
    },
    associateProxyCharacter: async (session: any, address: string) => { await ensureProxyCharacter(session, address); return { success: true }; },
    getProxyPrivateKey: (session: any, password: string) => { requireProxy(session); return bootstrap.getCustodialPrivateKey(session, password); },
    updateProxyPassword: (session: any, oldPassword: string, newPassword: string) => { requireProxy(session); return bootstrap.updateCustodialPassword(session, oldPassword, newPassword); },
    getProxyHealth: async (session: any) => { requireProxy(session); return bootstrap.getDeploymentStatus(session); },
  };
}

let singleton: ReturnType<typeof createLegacyEvmSuiBridge> | undefined;
/** Explicit configuration wins; synchronized build-local setup needs no extra launch flag. */
export function resolveLegacyEvmSuiBridgePath(runtime: Record<string, any>): string | null {
  if (runtime.clientCompatibilityProfile !== "frontier" || !LEGACY_EVM_SUI_BUILDS.includes(Number(runtime.clientBuild))) return null;
  if (runtime.legacyEvmSuiBridgePath) {
    if (typeof runtime.legacyEvmSuiBridgePath !== "string" || !runtime.legacyEvmSuiBridgePath.trim()) fail("INVALID_LEGACY_EVM_CONFIG");
    return path.resolve(runtime.legacyEvmSuiBridgePath);
  }
  const worldPath = path.resolve(process.env.EVEJS_SUI_WORLD_CONFIG_PATH ||
    path.resolve(__dirname, "../../../../_local/frontier-world", String(runtime.clientBuild), "world.private.json"));
  if (fs.existsSync(worldPath)) {
    let world: any;
    try { world = JSON.parse(fs.readFileSync(worldPath, "utf8").replace(/^\uFEFF/, "")); } catch { return fail("INVALID_LEGACY_EVM_CONFIG"); }
    if (world.build !== Number(runtime.clientBuild) || world.state !== "ready" || world.network !== "localnet") return null;
    if (world.legacyEvmBridgePath !== undefined) {
      if (typeof world.legacyEvmBridgePath !== "string" || !world.legacyEvmBridgePath.trim()) fail("INVALID_LEGACY_EVM_CONFIG");
      return path.resolve(path.dirname(worldPath), world.legacyEvmBridgePath);
    }
  }
  const candidate = path.join(path.dirname(worldPath), "legacy-evm-sui.private.json");
  return fs.existsSync(candidate) ? candidate : null;
}
export function getLegacyEvmSuiBridge() {
  if (singleton) return singleton;
  const runtime = require("../../config");
  const manifestPath = resolveLegacyEvmSuiBridgePath(runtime);
  if (!manifestPath) fail("LEGACY_EVM_SUI_BRIDGE_UNAVAILABLE");
  let config: any;
  try { config = JSON.parse(fs.readFileSync(manifestPath, "utf8").replace(/^\uFEFF/, "")); } catch { return fail("INVALID_LEGACY_EVM_CONFIG"); }
  singleton = createLegacyEvmSuiBridge({ config, clientBuild: runtime.clientBuild });
  return singleton;
}

/** Login configuration contains only public branch settings, never wallet secrets. */
export function buildLegacyEvmGlobalConfigEntries(runtime: Record<string, any>): Array<[string, string | number]> {
  const manifestPath = resolveLegacyEvmSuiBridgePath(runtime);
  if (!manifestPath) return [];
  let manifest: any;
  try { manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8").replace(/^\uFEFF/, "")); } catch { return fail("INVALID_LEGACY_EVM_CONFIG"); }
  if (manifest.clientBuild !== Number(runtime.clientBuild) || typeof manifest.tenant !== "string" || !manifest.tenant.trim()) fail("INVALID_LEGACY_EVM_CONFIG");
  return [["chainTenant", manifest.tenant], ...(Number(runtime.clientBuild) === 2455427
    ? [["blockchainId", Number(manifest.proxy?.blockchainId || 3537357)] as [string, number]] : [])];
}
