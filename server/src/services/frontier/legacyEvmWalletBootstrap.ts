import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, scrypt } from "node:crypto";
import path = require("node:path");
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { HDKey } from "@scure/bip32";
import { generateMnemonic, mnemonicToSeed, validateMnemonic } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english.js";
import { evmAddress, evmKeccakHex, evmUint256, hashLegacyEvmTypedData } from "./legacyEvmAuthorization";

const TABLE = "frontierLegacyEvmWalletState";
const FORMAT = "evejs-legacy-evm-wallet-v1";
const CIPHER_FORMAT = "evejs-legacy-evm-secret-v1";
const MAX_SECRET_BYTES = 65536;
const UNLOCK_MS = 15 * 60 * 1000;
function fail(code: string): never { throw Object.assign(new Error(code), { code }); }
function positiveID(value: unknown): number {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0 || number > 0xffffffff) fail("INVALID_LEGACY_EVM_IDENTIFIER");
  return number;
}
function boundedText(value: unknown, max = MAX_SECRET_BYTES): string {
  if (typeof value !== "string" || !value || Buffer.byteLength(value, "utf8") > max) fail("INVALID_LEGACY_EVM_SECRET");
  return value;
}
function canonicalBase64(value: unknown, length?: number): Buffer {
  if (typeof value !== "string" || value.length > MAX_SECRET_BYTES * 2 || !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) fail("INVALID_LEGACY_EVM_SECRET");
  const bytes = Buffer.from(value, "base64");
  if (bytes.toString("base64") !== value || (length !== undefined && bytes.length !== length)) fail("INVALID_LEGACY_EVM_SECRET");
  return bytes;
}
function keyAddress(privateKey: Uint8Array): string {
  return `0x${evmKeccakHex(secp256k1.getPublicKey(privateKey, false).subarray(1)).slice(-40)}`;
}

/**
 * Internal bootstrap/custody service. A verified EVM signature or a newly
 * generated/recovered custodial key is required before enrollment. Reported
 * wallet events must never call bindWallet. Nothing is opened on import.
 */
export function createLegacyEvmWalletBootstrap(options: Record<string, any>) {
  const config = options.config || {};
  const build = positiveID(options.clientBuild);
  const now = options.now || Date.now;
  let repository: any;
  let characterRepository: any;
  let tail: Promise<any> = Promise.resolve();
  const unlocked = new WeakMap<object, { userID: number; characterID: number; address: string; privateKey: Buffer; expiresAt: number; custodyTag: string }>();
  function lockCustodialWallet(session: any): { unlocked: false } {
    if (session && typeof session === "object") {
      unlocked.get(session)?.privateKey.fill(0);
      unlocked.delete(session);
    }
    return { unlocked: false };
  }
  function serial<T>(operation: () => Promise<T>): Promise<T> {
    const pending = tail.then(operation, operation);
    tail = pending.then(() => undefined, () => undefined);
    return pending;
  }
  const character = () => options.character || require("../character/characterState");
  function repo() {
    if (!repository) {
      const candidate = options.repo || require("../../gameStore/tableRepository")
        .createTableRepository("service:legacy-evm-sui", { strict: true });
      if (candidate.ensureTable(TABLE)?.success === false) fail("LEGACY_EVM_WALLET_STORE_UNAVAILABLE");
      repository = candidate;
    }
    return repository;
  }
  function identity(session: any, requestedCharacter?: unknown) {
    if (!session || typeof session !== "object" || session._characterControlDisconnected === true ||
        typeof options.resolveIdentity !== "function") { lockCustodialWallet(session); fail("AUTHENTICATION_REQUIRED"); }
    // This callback must resolve the base game identity, without calling this
    // module's getWalletBinding again.
    const base = options.resolveIdentity(session, false);
    if (!base || typeof base.then === "function") fail("AUTHENTICATION_REQUIRED");
    const userID = positiveID(base.userID), characterID = positiveID(base.characterID);
    if (requestedCharacter !== undefined && positiveID(requestedCharacter) !== characterID) fail("CHARACTER_IDENTITY_MISMATCH");
    const record = character().getCharacterRecord(characterID);
    if (!record || Number(record.accountId ?? record.accountID ?? record.userID ?? record.userid) !== userID) fail("CHARACTER_IDENTITY_MISMATCH");
    const configured = base.sender || base.account?.evmAddress || null;
    return { userID, characterID, record, account: base.account || {}, configured: configured ? evmAddress(configured) : null };
  }
  function sameIdentity(session: any, original: any) {
    const current = identity(session, original.characterID);
    if (current.userID !== original.userID || current.configured !== original.configured) fail("CHARACTER_IDENTITY_MISMATCH");
    return current;
  }
  function rowKey(kind: string, who: any, suffix = ""): string {
    return createHash("sha256").update(`${FORMAT}:${build}:${kind}:${who.userID}:${who.characterID}:${suffix}`).digest("hex");
  }
  function read(kind: string, who: any, suffix = ""): any {
    const result = repo().read(TABLE, `/${rowKey(kind, who, suffix)}`);
    if (!result || (result.success === false && result.errorMsg !== "ENTRY_NOT_FOUND")) fail("LEGACY_EVM_WALLET_STORE_UNAVAILABLE");
    if (!result.data) return null;
    const record = result.data;
    if (record.format !== FORMAT || record.kind !== kind || record.clientBuild !== build ||
        record.userID !== who.userID || record.characterID !== who.characterID) fail("LEGACY_EVM_WALLET_RECORD_INVALID");
    return record;
  }
  function record(kind: string, who: any, value: any) {
    return { ...value, format: FORMAT, kind, clientBuild: build, userID: who.userID, characterID: who.characterID };
  }
  function writeRows(rows: Array<{ kind: string; who: any; value: any; suffix?: string }>) {
    const store = repo();
    const proposals = rows.map(row => store.prepareAtomicRowWrite(TABLE, rowKey(row.kind, row.who, row.suffix),
      record(row.kind, row.who, row.value)));
    if (!store.commitAtomicRowWrites(proposals)?.success || store.flushTableSync(TABLE)?.success === false) fail("LEGACY_EVM_WALLET_STORE_UNAVAILABLE");
  }
  function binding(who: any): string | null {
    const saved = read("binding", who);
    const address = saved ? evmAddress(saved.address) : null;
    if (address && who.configured && address !== who.configured) fail("LEGACY_EVM_WALLET_BINDING_CONFLICT");
    return who.configured || address;
  }
  function checkBinding(who: any, sender: unknown): string {
    const address = evmAddress(sender), expected = binding(who);
    if (expected && expected !== address) fail("LEGACY_EVM_WALLET_BINDING_CONFLICT");
    return address;
  }
  function bindVerified(who: any, sender: unknown): string {
    const address = checkBinding(who, sender);
    if (!read("binding", who)) writeRows([{ kind: "binding", who, value: { address, enrolledAtMs: now() } }]);
    return address;
  }
  function getWalletBinding(session: any): string | null { return binding(identity(session)); }
  /** Auto-setup credentials are random, scoped and encrypted; they never enroll a wallet. */
  function getWalletPassphrase(session: any): string {
    const who = identity(session);
    binding(who); // Preserve any configured sender pin and existing enrollment.
    if (Object.prototype.hasOwnProperty.call(who.account, "walletPassphrase")) {
      return boundedText(who.account.walletPassphrase, 1024);
    }
    if (config.accountPolicy?.mode !== "authenticated-server" ||
        config.accountPolicy?.passphraseStorage !== "aes-256-gcm-v1") fail("LEGACY_EVM_WALLET_PASSPHRASE_UNAVAILABLE");
    const saved = read("wallet-passphrase", who), key = masterKey();
    try {
      if (saved) return unseal(who, "wallet-passphrase", saved.secret, key);
      const passphrase = randomBytes(32).toString("base64url");
      sameIdentity(session, who);
      writeRows([{ kind: "wallet-passphrase", who,
        value: { secret: seal(who, "wallet-passphrase", passphrase, key), createdAtMs: now() } }]);
      return passphrase;
    } finally { key.fill(0); }
  }
  async function bindWallet(session: any, verifiedSender: unknown): Promise<string> {
    const who = identity(session);
    return serial(async () => bindVerified(sameIdentity(session, who), verifiedSender));
  }
  function masterKey(): Buffer {
    if (!config.recoveryKey) fail("LEGACY_EVM_RECOVERY_KEY_REQUIRED");
    return canonicalBase64(config.recoveryKey, 32);
  }
  function associatedData(who: any, kind: string): Buffer {
    return Buffer.from(`${CIPHER_FORMAT}:${build}:${kind}:${who.userID}:${who.characterID}`, "utf8");
  }
  function seal(who: any, kind: string, plaintext: string, key: Buffer): any {
    boundedText(plaintext);
    const iv = randomBytes(12), cipher = createCipheriv("aes-256-gcm", key, iv);
    cipher.setAAD(associatedData(who, kind));
    const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
    return { format: CIPHER_FORMAT, iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64"), ciphertext: ciphertext.toString("base64") };
  }
  function unseal(who: any, kind: string, envelope: any, key: Buffer): string {
    try {
      if (!envelope || envelope.format !== CIPHER_FORMAT) fail("INVALID_LEGACY_EVM_SECRET");
      const decipher = createDecipheriv("aes-256-gcm", key, canonicalBase64(envelope.iv, 12));
      decipher.setAAD(associatedData(who, kind));
      decipher.setAuthTag(canonicalBase64(envelope.tag, 16));
      const plaintext = Buffer.concat([decipher.update(canonicalBase64(envelope.ciphertext)), decipher.final()]);
      return boundedText(plaintext.toString("utf8"));
    } catch { return fail("INVALID_LEGACY_EVM_SECRET"); }
  }
  async function encryptRecovery(session: any, plaintext: unknown): Promise<string> {
    const who = identity(session), key = masterKey();
    try { return Buffer.from(JSON.stringify(seal(who, "recovery", boundedText(plaintext), key))).toString("base64"); }
    finally { key.fill(0); }
  }
  async function decryptRecovery(session: any, encrypted: unknown): Promise<string> {
    const who = identity(session), key = masterKey();
    try {
      let envelope: any;
      try { envelope = JSON.parse(canonicalBase64(encrypted).toString("utf8")); } catch { fail("INVALID_LEGACY_EVM_SECRET"); }
      return unseal(who, "recovery", envelope, key);
    } finally { key.fill(0); }
  }
  async function storePrivateKey(session: any, opaqueWalletData: unknown): Promise<boolean> {
    const who = identity(session);
    return serial(async () => {
      sameIdentity(session, who);
      const key = masterKey();
      try { writeRows([{ kind: "private-key", who, value: { secret: seal(who, "private-key", boundedText(opaqueWalletData), key), savedAtMs: now() } }]); }
      finally { key.fill(0); }
      return true;
    });
  }
  async function getPrivateKey(session: any): Promise<string | null> {
    const who = identity(session);
    const saved = read("private-key", who);
    if (!saved) return null;
    const key = masterKey();
    try { return unseal(who, "private-key", saved.secret, key); } finally { key.fill(0); }
  }

  function provisioning() { return require("./suiCharacterProvisioning"); }
  function worldContext(): any {
    if (options.getWorldContext) return options.getWorldContext();
    const env = { ...process.env, EVEJS_CLIENT_BUILD: String(build),
      EVEJS_SUI_WORLD_CONFIG_PATH: process.env.EVEJS_SUI_WORLD_CONFIG_PATH ||
        path.resolve(__dirname, "../../../../_local/frontier-world", String(build), "world.private.json") };
    const synced = provisioning().readSyncedSuiWorldConfig(env);
    if (!synced || synced.build !== build || synced.network !== "localnet") fail("LEGACY_EVM_SUI_DEPLOYMENT_UNAVAILABLE");
    return { env, chainId: synced.chainId, network: synced.network,
      world: { packageId: synced.packageId, objectRegistryId: synced.objectRegistryId, adminAclId: synced.adminAclId,
        tenant: config.suiTenant || "dev", tribeId: config.suiTribeId || 100 },
      client: options.client || require("./suiGrpcClient").suiGrpcClient };
  }
  function worldFingerprint(context: any): string {
    if (!context || context.network !== "localnet" || typeof context.chainId !== "string" || !context.chainId) fail("LEGACY_EVM_SUI_DEPLOYMENT_UNAVAILABLE");
    const world = context.world;
    if (!world || !world.packageId || !world.objectRegistryId || !world.adminAclId || !world.tenant) fail("LEGACY_EVM_SUI_DEPLOYMENT_UNAVAILABLE");
    return createHash("sha256").update(JSON.stringify([context.chainId, world.packageId, world.objectRegistryId, world.adminAclId, world.tenant, world.tribeId])).digest("hex");
  }
  async function assertWorldCurrent(context: any) {
    if (worldFingerprint(worldContext()) !== worldFingerprint(context)) fail("LEGACY_EVM_SUI_DEPLOYMENT_CHANGED");
    if (options.assertWorldCurrent) await options.assertWorldCurrent(context);
    else if (String(await provisioning().readLiveSuiChainIdentifier(context.client)).toLowerCase() !== context.chainId.toLowerCase()) fail("LEGACY_EVM_SUI_DEPLOYMENT_CHANGED");
  }
  /** Deployment health precedes wallet enrollment and never creates a Character. */
  async function getDeploymentStatus(session: any): Promise<any> {
    const who = identity(session), context = worldContext();
    await assertWorldCurrent(context);
    sameIdentity(session, who);
    const { normalizeSuiAddress, normalizeStructTag } = require("@mysten/sui/utils");
    const expected = [
      { objectId: context.world.packageId, type: "package", shared: false },
      { objectId: context.world.objectRegistryId, type: `${context.world.packageId}::object_registry::ObjectRegistry`, shared: true },
      { objectId: context.world.adminAclId, type: `${context.world.packageId}::access::AdminACL`, shared: true },
    ];
    if (options.verifyWorldObjects) await options.verifyWorldObjects(context, expected);
    else {
      if (typeof context.client?.getObjects !== "function") fail("LEGACY_EVM_SUI_DEPLOYMENT_UNAVAILABLE");
      const response = await context.client.getObjects({ objectIds: expected.map(value => value.objectId) });
      if (!Array.isArray(response?.objects) || response.objects.length !== expected.length) fail("LEGACY_EVM_SUI_DEPLOYMENT_UNAVAILABLE");
      for (let index = 0; index < expected.length; index++) {
        const actual = response.objects[index], wanted = expected[index];
        if (!actual || actual instanceof Error || typeof actual.objectId !== "string" ||
            normalizeSuiAddress(actual.objectId) !== normalizeSuiAddress(wanted.objectId) ||
            (wanted.type === "package" ? actual.type !== "package" :
              typeof actual.type !== "string" || normalizeStructTag(actual.type) !== normalizeStructTag(wanted.type)) ||
            (wanted.shared && actual.owner?.$kind !== "Shared")) fail("LEGACY_EVM_SUI_DEPLOYMENT_UNAVAILABLE");
      }
    }
    sameIdentity(session, who);
    await assertWorldCurrent(context);
    sameIdentity(session, who);
    return { ready: true, backend: "sui", clientBuild: build, network: context.network,
      chainId: context.chainId, packageId: context.world.packageId,
      objectRegistryId: context.world.objectRegistryId, adminAclId: context.world.adminAclId };
  }
  function prepareIdentity(who: any, context: any) {
    const name = boundedText(who.record.characterName || who.record.name, 1024).trim();
    return (options.prepareIdentity || provisioning().prepareSuiCharacterIdentity)({ accountId: who.userID,
      gameCharacterId: who.characterID, characterName: name }, { ...(options.provisioningOptions || {}), world: context.world, env: context.env });
  }
  function persistSuiIdentity(who: any, result: any) {
    const fields = { suiNetwork: result.network, suiBaseUrl: result.baseUrl, suiWalletAddress: result.walletAddress,
      suiCharacterObjectId: result.characterObjectId, suiPlayerProfileObjectId: result.playerProfileObjectId,
      suiTransactionDigest: result.transactionDigest, suiWorldPackageId: result.packageId,
      suiWorldObjectRegistryId: result.objectRegistryId, suiWorldAdminAclId: result.adminAclId,
      suiTenant: result.tenant, suiTribeId: result.tribeId, suiChainId: result.chainId,
      suiProvisioningStatus: "confirmed", suiSubmissionState: "confirmed",
      suiPreparedTransactionBytesBase64: null, suiPreparedTransactionSignature: null };
    if (options.persistIdentity) return options.persistIdentity(who.characterID, fields);
    const written = character().updateCharacterRecord(who.characterID, (current: any) => {
      if (Number(current.accountId ?? current.accountID ?? current.userID ?? current.userid) !== who.userID) fail("CHARACTER_IDENTITY_MISMATCH");
      return { ...current, ...fields };
    });
    if (!written?.success) fail("LEGACY_EVM_SUI_BINDING_PERSIST_FAILED");
    characterRepository ||= require("../../gameStore/tableRepository").createTableRepository("service:character", { strict: true });
    if (characterRepository.flushTableSync("characters")?.success === false) fail("LEGACY_EVM_SUI_BINDING_PERSIST_FAILED");
  }
  async function characterExists(session: any, requestedCharacter: unknown): Promise<boolean> {
    const who = identity(session, requestedCharacter);
    // A configured pin or pre-existing Sui object alone is not an EVM proof.
    if (!read("binding", who) || !binding(who)) return false;
    const context = worldContext(), prepared = prepareIdentity(who, context);
    await assertWorldCurrent(context);
    const result = await (options.findExisting || provisioning().findExistingSuiCharacter)(context.client, prepared);
    sameIdentity(session, who);
    await assertWorldCurrent(context);
    sameIdentity(session, who);
    if (!result) return false;
    await persistSuiIdentity(who, { ...result, chainId: context.chainId });
    sameIdentity(session, who);
    return true;
  }
  async function createCharacter(session: any, request: Record<string, any>): Promise<any> {
    const original = identity(session, request.characterID ?? request.characterId);
    return serial(async () => {
      const who = sameIdentity(session, original);
      const assertAuthorization = () => {
        sameIdentity(session, who);
        if (request.assertAuthorization !== undefined) {
          if (typeof request.assertAuthorization !== "function") fail("INVALID_LEGACY_EVM_SIGNATURE");
          const result = request.assertAuthorization();
          if (result === false || result && typeof result.then === "function") fail("INVALID_LEGACY_EVM_SIGNATURE");
        }
      };
      assertAuthorization();
      const sender = bindVerified(who, request.verifiedSender);
      const context = worldContext(), prepared = prepareIdentity(who, context), fingerprint = worldFingerprint(context);
      if (request.name !== undefined && String(request.name).trim() !== prepared.characterName) fail("CHARACTER_IDENTITY_MISMATCH");
      await assertWorldCurrent(context);
      assertAuthorization();
      const previous = read("provision", who, fingerprint);
      const identityHash = createHash("sha256").update(JSON.stringify(prepared)).digest("hex");
      if (previous && (previous.identityHash !== identityHash || previous.sender !== sender)) fail("LEGACY_EVM_SUI_BOOTSTRAP_RECONCILIATION_REQUIRED");
      let pending = previous || { sender, identityHash, deployment: fingerprint, identity: prepared, status: "preparing", createdAtMs: now() };
      if (!previous) writeRows([{ kind: "provision", who, suffix: fingerprint, value: pending }]);
      const existingHook = options.provisioningOptions?.onTransactionPrepared;
      const existingSubmitHook = options.provisioningOptions?.beforeTransactionSubmit;
      const provisionOptions = { ...(options.provisioningOptions || {}), world: context.world, env: context.env, client: context.client,
        beforeTransactionSubmit: () => {
          if (existingSubmitHook) {
            const result = existingSubmitHook();
            if (result === false || result && typeof result.then === "function") fail("INVALID_LEGACY_EVM_SIGNATURE");
          }
          if (worldFingerprint(worldContext()) !== fingerprint) fail("LEGACY_EVM_SUI_DEPLOYMENT_CHANGED");
          assertAuthorization();
        },
        onTransactionPrepared: async (details: any) => {
          assertAuthorization();
          await assertWorldCurrent(context);
          assertAuthorization();
          if (!details?.transactionDigest || !details.chainId || details.chainId.toLowerCase() !== context.chainId.toLowerCase()) fail("LEGACY_EVM_SUI_BOOTSTRAP_RECONCILIATION_REQUIRED");
          pending = { ...pending, status: "submitting", transactionDigest: details.transactionDigest,
            transactionBytesBase64: details.transactionBytesBase64, transactionSignature: details.transactionSignature, chainId: details.chainId };
          writeRows([{ kind: "provision", who, suffix: fingerprint, value: pending }]);
          if (existingHook) await existingHook(details);
          assertAuthorization();
        } };
      assertAuthorization();
      const result = await (options.provision || provisioning().provisionSuiCharacter)({ accountId: who.userID,
        gameCharacterId: who.characterID, characterName: prepared.characterName, identity: prepared,
        transactionDigest: pending.transactionDigest, transactionBytesBase64: pending.transactionBytesBase64,
        transactionSignature: pending.transactionSignature, chainId: pending.chainId }, provisionOptions);
      sameIdentity(session, who);
      await assertWorldCurrent(context);
      sameIdentity(session, who);
      for (const field of ["walletAddress", "characterObjectId", "packageId", "objectRegistryId", "adminAclId", "tenant", "tribeId"]) {
        if (result?.[field] !== prepared[field]) fail("LEGACY_EVM_SUI_BOOTSTRAP_RECONCILIATION_REQUIRED");
      }
      if (!result.playerProfileObjectId || result.chainId !== context.chainId) fail("LEGACY_EVM_SUI_BOOTSTRAP_RECONCILIATION_REQUIRED");
      await persistSuiIdentity(who, result);
      sameIdentity(session, who);
      writeRows([{ kind: "provision", who, suffix: fingerprint, value: { ...pending, status: "confirmed",
        transactionDigest: result.transactionDigest, chainId: result.chainId, playerProfileObjectId: result.playerProfileObjectId,
        transactionBytesBase64: null, transactionSignature: null, confirmedAtMs: now() } }]);
      return { success: true, sender, characterID: who.characterID, walletAddress: result.walletAddress,
        characterObjectId: result.characterObjectId, playerProfileObjectId: result.playerProfileObjectId,
        transactionDigest: result.transactionDigest, chainId: result.chainId, network: result.network, recovered: result.recovered === true };
    });
  }
  async function tokenBalance(session: any, requestedCharacter: unknown, requestedEvmAddress: unknown): Promise<any> {
    const who = identity(session, requestedCharacter), sender = binding(who);
    if (!sender || evmAddress(requestedEvmAddress) !== sender) fail("LEGACY_EVM_WALLET_BINDING_CONFLICT");
    if (!await characterExists(session, who.characterID)) fail("LEGACY_EVM_SUI_CHARACTER_UNAVAILABLE");
    sameIdentity(session, who);
    const context = worldContext(), prepared = prepareIdentity(who, context);
    await assertWorldCurrent(context);
    let value: any, denom: string;
    if (config.tokenBalanceSource === "local-ledger") {
      const ledger = options.economy || require("./frontierEconomyRuntime").getFrontierEconomyRuntime();
      const balance = await ledger.getBalance({ userID: who.userID, characterID: who.characterID, session }, prepared.walletAddress);
      value = balance.value; denom = boundedText(balance.denom, 64);
    } else if (config.tokenBalanceSource === "sui-coin") {
      const configuredCoinType = boundedText(config.tokenCoinType, 512);
      if (!/^0x[0-9a-fA-F]{1,64}::[A-Za-z_][A-Za-z0-9_]*::[A-Za-z_][A-Za-z0-9_]*$/.test(configuredCoinType)) fail("LEGACY_EVM_TOKEN_AUTHORITY_UNAVAILABLE");
      const normalize = require("@mysten/sui/utils").normalizeStructTag;
      const coinType = normalize(configuredCoinType);
      const balance = await (options.readTokenBalance || ((input: any) => context.client.getBalance(input)))({ owner: prepared.walletAddress, coinType });
      value = balance?.balance?.balance;
      if (typeof balance?.balance?.coinType !== "string" || normalize(balance.balance.coinType) !== coinType) fail("LEGACY_EVM_TOKEN_AUTHORITY_MISMATCH");
      denom = boundedText(config.tokenDenomination || coinType, 512);
    } else fail("LEGACY_EVM_TOKEN_AUTHORITY_UNAVAILABLE");
    sameIdentity(session, who);
    await assertWorldCurrent(context);
    sameIdentity(session, who);
    return { value: evmUint256(value), denom, source: config.tokenBalanceSource, walletAddress: prepared.walletAddress };
  }

  async function passwordKey(who: any, password: unknown, salt: Buffer): Promise<Buffer> {
    const secret = boundedText(password, 1024), master = masterKey();
    let stretched: Buffer | undefined;
    try {
      stretched = await new Promise<Buffer>((resolve, reject) => scrypt(secret, salt, 32,
        { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }, (error, result) => error ? reject(error) : resolve(result)));
      return createHmac("sha256", master).update(associatedData(who, "custody")).update(stretched).digest();
    } finally { master.fill(0); stretched?.fill(0); }
  }
  async function mnemonicKey(mnemonic: unknown): Promise<{ mnemonic: string; privateKey: Buffer; address: string }> {
    const words = boundedText(mnemonic, 1024).normalize("NFKD").trim().replace(/\s+/gu, " ");
    if (!validateMnemonic(words, wordlist)) fail("INVALID_LEGACY_EVM_MNEMONIC");
    const seed = await mnemonicToSeed(words), root = HDKey.fromMasterSeed(seed);
    let child: HDKey | undefined;
    try {
      child = root.derive("m/44'/60'/0'/0/0");
      const privateKey = child.privateKey;
      if (!privateKey) fail("INVALID_LEGACY_EVM_MNEMONIC");
      const bytes = Buffer.from(privateKey);
      return { mnemonic: words, privateKey: bytes, address: keyAddress(bytes) };
    } finally { seed.fill(0); child?.wipePrivateData(); root.wipePrivateData(); }
  }
  function rememberUnlock(session: any, who: any, privateKey: Buffer, address: string) {
    const previous = unlocked.get(session);
    previous?.privateKey.fill(0);
    unlocked.set(session, { userID: who.userID, characterID: who.characterID, address,
      privateKey: Buffer.from(privateKey), expiresAt: now() + UNLOCK_MS, custodyTag: read("custody", who)?.secret?.tag });
  }
  function activeUnlock(session: any, who: any) {
    const value = unlocked.get(session);
    if (!value) return null;
    if (value.userID !== who.userID || value.characterID !== who.characterID || value.address !== binding(who) || value.expiresAt <= now() ||
        !value.custodyTag || value.custodyTag !== read("custody", who)?.secret?.tag) {
      value.privateKey.fill(0); unlocked.delete(session); return null;
    }
    return value;
  }
  async function openCustody(session: any, who: any, password: unknown) {
    const saved = read("custody", who);
    if (!saved) fail("LEGACY_EVM_CUSTODIAL_WALLET_UNAVAILABLE");
    const key = await passwordKey(who, password, canonicalBase64(saved.salt, 32));
    let derived: any;
    try {
      sameIdentity(session, who);
      const secret = JSON.parse(unseal(who, "custody", saved.secret, key));
      derived = await mnemonicKey(secret.mnemonic);
      sameIdentity(session, who);
      if (derived.address !== saved.address || checkBinding(who, derived.address) !== derived.address) {
        derived.privateKey.fill(0); fail("LEGACY_EVM_WALLET_BINDING_CONFLICT");
      }
      return derived;
    } catch (error: any) {
      derived?.privateKey.fill(0);
      if (error.code === "CHARACTER_IDENTITY_MISMATCH" || error.code === "LEGACY_EVM_WALLET_BINDING_CONFLICT") throw error;
      return fail("INVALID_LEGACY_EVM_WALLET_PASSWORD");
    } finally { key.fill(0); }
  }
  async function saveCustody(session: any, who: any, password: unknown, wallet: any) {
    checkBinding(who, wallet.address);
    const salt = randomBytes(32), key = await passwordKey(who, password, salt);
    try {
      sameIdentity(session, who);
      checkBinding(who, wallet.address);
      const rows = [{ kind: "custody", who, value: { address: wallet.address, salt: salt.toString("base64"),
        secret: seal(who, "custody", JSON.stringify({ mnemonic: wallet.mnemonic }), key), savedAtMs: now() } }];
      if (!read("binding", who)) rows.push({ kind: "binding", who, value: { address: wallet.address, enrolledAtMs: now() } } as any);
      writeRows(rows);
      rememberUnlock(session, who, wallet.privateKey, wallet.address);
    } finally { key.fill(0); }
  }
  async function createCustodialWallet(session: any, password: unknown): Promise<any> {
    const original = identity(session);
    return serial(async () => {
      const who = sameIdentity(session, original), saved = read("custody", who);
      const wallet = saved ? await openCustody(session, who, password) : await mnemonicKey(generateMnemonic(wordlist, 256));
      try {
        if (!saved) await saveCustody(session, who, password, wallet);
        else rememberUnlock(session, who, wallet.privateKey, wallet.address);
        return { address: wallet.address, mnemonic: wallet.mnemonic, unlocked: true };
      } finally { wallet.privateKey.fill(0); }
    });
  }
  async function unlockCustodialWallet(session: any, password: unknown): Promise<any> {
    const original = identity(session);
    return serial(async () => {
      const who = sameIdentity(session, original), wallet = await openCustody(session, who, password);
      try { rememberUnlock(session, who, wallet.privateKey, wallet.address); return { address: wallet.address, unlocked: true }; }
      finally { wallet.privateKey.fill(0); }
    });
  }
  async function recoverCustodialWallet(session: any, newPassword: unknown, mnemonic: unknown): Promise<any> {
    const original = identity(session);
    return serial(async () => {
      const who = sameIdentity(session, original), wallet = await mnemonicKey(mnemonic);
      try { await saveCustody(session, who, newPassword, wallet); return { address: wallet.address, unlocked: true }; }
      finally { wallet.privateKey.fill(0); }
    });
  }
  async function updateCustodialPassword(session: any, oldPassword: unknown, newPassword: unknown): Promise<any> {
    const original = identity(session);
    return serial(async () => {
      const who = sameIdentity(session, original), wallet = await openCustody(session, who, oldPassword);
      try { await saveCustody(session, who, newPassword, wallet); return { address: wallet.address, unlocked: true }; }
      finally { wallet.privateKey.fill(0); }
    });
  }
  async function getCustodialPrivateKey(session: any, password: unknown): Promise<string> {
    const original = identity(session);
    return serial(async () => {
      const who = sameIdentity(session, original), wallet = await openCustody(session, who, password);
      try { sameIdentity(session, who); return `0x${wallet.privateKey.toString("hex")}`; }
      finally { wallet.privateKey.fill(0); }
    });
  }
  function getCustodialAccount(session: any): any {
    const who = identity(session), saved = read("custody", who);
    return { address: saved ? checkBinding(who, saved.address) : null, unlocked: Boolean(saved && activeUnlock(session, who)) };
  }
  async function signCustodialTypedData(session: any, typedData: unknown): Promise<string> {
    const who = identity(session), signer = activeUnlock(session, who);
    if (!signer) fail("LEGACY_EVM_CUSTODIAL_WALLET_LOCKED");
    const signature = secp256k1.sign(hashLegacyEvmTypedData(typedData), signer.privateKey, { prehash: false, format: "recovered" });
    return `0x${Buffer.concat([signature.subarray(1), Buffer.from([signature[0] + 27])]).toString("hex")}`;
  }
  return { getWalletBinding, getWalletPassphrase, bindWallet, getDeploymentStatus, characterExists, createCharacter, tokenBalance,
    encryptRecovery, decryptRecovery, storePrivateKey, getPrivateKey, createCustodialWallet, unlockCustodialWallet,
    recoverCustodialWallet, updateCustodialPassword, lockCustodialWallet, getCustodialPrivateKey, getCustodialAccount, signCustodialTypedData };
}
