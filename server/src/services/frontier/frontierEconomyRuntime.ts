"use strict";
const { randomUUID, createHash } = require("node:crypto");
const { verifyTransactionSignature } = require("@mysten/sui/verify");
const { bcs } = require("@mysten/sui/bcs");
const { normalizeSuiAddress } = require("@mysten/sui/utils");
const TABLE = "frontierEconomyState";
const TOKEN_SCALE = 1000000000n;
const DEFAULT_POLICY = Object.freeze({ mode: "local", denomination: "EVE", luxCentsPerToken: 100,
  lensPriceAtoms: "1000000000", feralDataLuxCents: 100, prepareExpiryMs: 300000 });
function fail(code): never { throw Object.assign(new Error(code), { code }); }
function id(value) { const n = Number(value); if (!Number.isSafeInteger(n) || n <= 0) fail("INVALID_IDENTIFIER"); return n; }
function address(value) {
  if (typeof value !== "string" || !/^0x[0-9a-f]{1,64}$/i.test(value) || BigInt(value) === 0n) fail("INVALID_WALLET_ADDRESS");
  return normalizeSuiAddress(value);
}
function atoms(amount, denom) {
  if (!amount || amount.denom !== denom || !/^[1-9][0-9]*$/.test(String(amount.value))) fail("INVALID_TOKEN_AMOUNT");
  const value = BigInt(amount.value); if (value > (1n << 63n) - 1n) fail("INVALID_TOKEN_AMOUNT"); return value;
}
function cents(amount) {
  const units = String((amount && amount.units) ?? "0"), nanos = Number(amount && amount.nanos || 0);
  if (!/^-?[0-9]+$/.test(units) || !Number.isSafeInteger(nanos) || nanos < 0 || nanos >= 1000000000 || nanos % 10000000) fail("INVALID_LUX_AMOUNT");
  const result = BigInt(units) * 100n + BigInt(nanos / 10000000);
  if (result <= 0n || result > BigInt(Number.MAX_SAFE_INTEGER)) fail("INVALID_LUX_AMOUNT"); return result;
}
function currency(value) { return { units: String(value / 100n), nanos: Number(value % 100n) * 10000000 }; }
function receipt(operation) { return `local:${createHash("sha256").update(JSON.stringify(operation)).digest("hex")}`; }
function createFrontierEconomyRuntime(options: Record<string, any> = {}) {
  const repo = options.repo || require("../../gameStore/tableRepository").createTableRepository("service:frontier-economy", { strict: true });
  const inventory = options.inventory || require("../inventory/itemStore");
  const character = options.character || require("../character/characterState");
  const now = options.now || Date.now;
  const policy = { ...DEFAULT_POLICY, ...(options.policy || {}) };
  let ready = false;
  function ensure() { if (!ready) { const result = repo.ensureTable(TABLE); if (result && result.success === false) fail("ECONOMY_STORE_UNAVAILABLE"); ready = true; } }
  function read(key) { ensure(); const r = repo.read(TABLE, `/${key}`); return r && r.success && r.data ? JSON.parse(JSON.stringify(r.data)) : null; }
  function row(key, value) { ensure(); return repo.prepareAtomicRowWrite(TABLE, key, value); }
  function commit(rows) { const result = repo.commitAtomicRowWrites(rows); if (!result || !result.success) fail(result && result.errorMsg || "ECONOMY_COMMIT_FAILED"); }
  function identityWallet(identity, requested = undefined) {
    if (!identity || !Number.isSafeInteger(identity.userID) || !Number.isSafeInteger(identity.characterID)) fail("AUTHENTICATION_REQUIRED");
    const record = character.getCharacterRecord(identity.characterID);
    if (!record || Number(record.accountId ?? record.accountID ?? record.userID ?? record.userid) !== identity.userID) fail("CHARACTER_IDENTITY_MISMATCH");
    // Reported events can acknowledge this server-established binding only. They
    // cannot change a character's wallet or fund an arbitrary supplied address.
    const wallet = address(record.suiWalletAddress || record.suiCharacterIdentity?.walletAddress || record.suiIdentity?.walletAddress || "");
    if (requested !== undefined && address(requested) !== wallet) fail("WALLET_IDENTITY_MISMATCH");
    return { wallet, record };
  }
  function walletState(wallet) { return read(`wallet:${wallet}`) || { wallet, balanceAtoms: "0", revision: 0 }; }
  function localOnly() { if (policy.mode !== "local") fail("ECONOMY_CHAIN_ADAPTER_UNAVAILABLE"); }
  function emit(identity, balance) {
    if (typeof options.onBalanceChanged === "function") options.onBalanceChanged(identity, balance);
    const session = identity.session;
    if (session && typeof session.sendNotification === "function") {
      session.sendNotification("OnAccountChange", "clientID", [1000, identity.characterID, balance]);
    }
  }
  function getBalance(identity, requested) {
    localOnly(); const { wallet } = identityWallet(identity, requested);
    return { denom: policy.denomination, value: walletState(wallet).balanceAtoms };
  }
  function getExchangeRate() {
    localOnly(); const rate = BigInt(policy.luxCentsPerToken);
    if (rate <= 0n) fail("INVALID_ECONOMY_POLICY");
    return { lux_per_token: currency(rate), token_per_lux: { denom: policy.denomination, value: (TOKEN_SCALE * 100n / rate).toString() } };
  }
  function reportWallet(identity, requested) {
    const { wallet } = identityWallet(identity, requested);
    const key = `binding:${identity.userID}:${identity.characterID}`;
    commit([row(key, { characterID: identity.characterID, userID: identity.userID, wallet, reportedAtMs: now() })]);
    return { success: true, wallet };
  }
  function exchangeLUX(identity, requestedWallet, luxAmount, requestID) {
    localOnly(); const { wallet } = identityWallet(identity, requestedWallet);
    if (typeof requestID !== "string" || !requestID || requestID.length > 256) fail("IDEMPOTENCY_KEY_REQUIRED");
    const luxCents = cents(luxAmount), rate = BigInt(policy.luxCentsPerToken);
    if (rate <= 0n || luxCents * TOKEN_SCALE % rate) fail("UNREPRESENTABLE_EXCHANGE_AMOUNT");
    const value = luxCents * TOKEN_SCALE / rate;
    const operationID = createHash("sha256").update(`${identity.userID}:${requestID}`).digest("hex");
    const key = `operation:${operationID}`, old = read(key);
    if (old) {
      if (old.characterID !== identity.characterID || old.wallet !== wallet || old.luxCents !== luxCents.toString() || old.kind !== "lux_to_token") fail("IDEMPOTENCY_CONFLICT");
      return old.response;
    }
    const balance = character.prepareCharacterBalanceAtomicWrite(identity.characterID, -Number(luxCents) / 100);
    const state = walletState(wallet); state.balanceAtoms = (BigInt(state.balanceAtoms) + value).toString(); state.revision++;
    const operation: any = { kind: "lux_to_token", operationID, wallet, characterID: identity.characterID, luxCents: luxCents.toString(), tokenAtoms: value.toString() };
    operation.response = { operation_id: operationID, token_amount: { denom: policy.denomination, value: value.toString() }, transaction_hash: receipt(operation) };
    commit([balance.row, row(`wallet:${wallet}`, state), row(key, operation)]); emit(identity, balance.balance);
    return operation.response;
  }
  function prepare(identity, kind, details) {
    localOnly(); const { wallet } = identityWallet(identity, details.wallet);
    const operationID = randomUUID();
    const operation = { format: "evejs-local-economy-intent-v1", kind, operationID, characterID: identity.characterID,
      userID: identity.userID, wallet, createdAtMs: now(), expiresAtMs: now() + policy.prepareExpiryMs, ...details, status: "prepared" };
    // Valid BCS TransactionData lets the native signer parse and sign the local
    // challenge. Its only input is the explicit local intent; it has no commands,
    // gas payment or budget, and this runtime never submits it to a chain.
    const intent = Buffer.from(JSON.stringify(operation)).toString("base64");
    const unsigned = Buffer.from(bcs.TransactionData.serialize({ V1: {
      kind: { ProgrammableTransaction: { inputs: [{ Pure: { bytes: intent } }], commands: [] } },
      sender: wallet, gasData: { payment: [], owner: wallet, price: "1", budget: "0" }, expiration: { None: true },
    } }).toBytes());
    commit([row(`operation:${operationID}`, { ...operation, unsigned: unsigned.toString("base64") })]);
    return { operation, unsigned };
  }
  function prepareToken(identity, walletAddress, tokenAmount) {
    const { wallet } = identityWallet(identity, walletAddress);
    const value = atoms(tokenAmount, policy.denomination), rate = BigInt(policy.luxCentsPerToken);
    if (value * rate % TOKEN_SCALE) fail("UNREPRESENTABLE_EXCHANGE_AMOUNT");
    const luxCents = value * rate / TOKEN_SCALE;
    if (luxCents <= 0n || luxCents > BigInt(Number.MAX_SAFE_INTEGER)) fail("INVALID_LUX_AMOUNT");
    if (BigInt(walletState(wallet).balanceAtoms) < value) fail("INSUFFICIENT_TOKENS");
    const prepared = prepare(identity, "token_to_lux", { wallet, tokenAtoms: value.toString(), luxCents: luxCents.toString() });
    return { operation_id: prepared.operation.operationID, unsigned_transaction: prepared.unsigned, lux_amount: currency(luxCents) };
  }
  async function verifiedOperation(identity, operationID, signature, kind) {
    localOnly(); const { wallet } = identityWallet(identity);
    const operation = read(`operation:${operationID}`);
    if (!operation || operation.kind !== kind || operation.wallet !== wallet || operation.characterID !== identity.characterID || operation.userID !== identity.userID) fail("TRANSACTION_NOT_FOUND");
    if (operation.status === "committed") return operation;
    if (operation.expiresAtMs <= now()) fail("TRANSACTION_EXPIRED");
    try {
      const publicKey = await (options.verifySignature || verifyTransactionSignature)(Buffer.from(operation.unsigned, "base64"), signature, { address: wallet });
      if (!publicKey || address(publicKey.toSuiAddress()) !== wallet) fail("INVALID_SIGNATURE");
    } catch (_) { fail("INVALID_SIGNATURE"); }
    // Verification is asynchronous. Recheck identity, expiry and receipt after
    // awaiting, then do the complete economic mutation synchronously.
    identityWallet(identity, wallet);
    const latest = read(`operation:${operationID}`);
    if (!latest || latest.unsigned !== operation.unsigned) fail("TRANSACTION_CHANGED");
    if (latest.status !== "committed" && latest.expiresAtMs <= now()) fail("TRANSACTION_EXPIRED");
    return latest;
  }
  async function executeToken(identity, operationID, signature) {
    const operation = await verifiedOperation(identity, operationID, signature, "token_to_lux");
    if (operation.status === "committed") return operation.response;
    const state = walletState(operation.wallet), value = BigInt(operation.tokenAtoms), luxCents = BigInt(operation.luxCents);
    if (BigInt(state.balanceAtoms) < value) fail("INSUFFICIENT_TOKENS");
    const balance = character.prepareCharacterBalanceAtomicWrite(identity.characterID, Number(luxCents) / 100);
    state.balanceAtoms = (BigInt(state.balanceAtoms) - value).toString(); state.revision++;
    const response = { lux_amount: currency(luxCents), transaction_hash: receipt(operation) };
    commit([balance.row, row(`wallet:${operation.wallet}`, state), row(`operation:${operationID}`, { ...operation, status: "committed", response })]);
    emit(identity, balance.balance); return response;
  }
  function authorizeRelay(identity, relayID) {
    if (options.authorizeRelay) return options.authorizeRelay(identity, relayID);
    const session = identity.session;
    if (!session) fail("AUTHENTICATION_REQUIRED");
    const deployment = require("./deploymentRuntime"), access = require("./assemblyAccessRuntime");
    const assembly = deployment.getAssemblyRecord(id(relayID));
    if (!assembly || assembly.assemblyTypeID !== 90184) fail("RELAY_NOT_FOUND");
    if (assembly.assemblyStatus !== deployment.ASSEMBLY_STATUS_ONLINE || assembly.activationCompleteAtMs > 0) fail("RELAY_OFFLINE");
    const result = access.resolveAccess({ kind: "player", actorID: identity.characterID, tribeID: Number(session.corpid || session.corporationID || 0) }, relayID, ["operate"]);
    if (!result.success) fail(result.errorMsg);
    const space = require("../../space/runtime"), scene = space.getSceneForSession(session);
    const shipID = Number(session._space?.shipID || session.shipid || session.shipID), ship = space.getEntity(session, shipID), relay = space.getEntity(session, relayID);
    const scope = require("../../space/destiny/identity/interactionScope");
    const distance = ship && relay && scope.canEntitiesInteractLocally(ship, relay) ? scene?.getCommandTimeEntitySurfaceDistance?.(ship, relay) : Infinity;
    if (Number(assembly.solarSystemID) !== Number(identity.currentSystemID || session.solarsystemid2) || !Number.isFinite(distance) || distance > 5000) fail("OUT_OF_RANGE");
    const relayItem = inventory.findItemById(relayID);
    return { sourceLocationIDs: [shipID, Number(relayID)], sourceFlagIDs: [5], sourceOwnerIDs: [identity.characterID],
      accessibleLocationIDs: [Number(relayID)], destinationOwnerIDs: [Number(relayItem.ownerID)],
      getDestinationCapacity: ({ locationID }) => Number(locationID) === Number(relayID) ? Number(relayItem.capacity) :
        require("./smartStorageUnitRuntime").getShipCargoCapacity(identity.characterID, inventory.findItemById(locationID)) };
  }
  function getLensPrice() { localOnly(); return { price_per_lens: { denom: policy.denomination, value: String(policy.lensPriceAtoms) } }; }
  function prepareLens(identity, relayID, count, destination) {
    const { wallet } = identityWallet(identity); const lensCount = id(count); if (lensCount > 1000000) fail("INVALID_QUANTITY");
    const access = authorizeRelay(identity, relayID), locationID = id(destination?.item?.sequential), flagID = Number(destination?.flag?.value);
    if (!access.sourceLocationIDs.includes(locationID) || flagID !== 5) fail("INVALID_DESTINATION");
    const cost = BigInt(policy.lensPriceAtoms) * BigInt(lensCount);
    if (cost <= 0n) fail("INVALID_ECONOMY_POLICY");
    if (BigInt(walletState(wallet).balanceAtoms) < cost) fail("INSUFFICIENT_TOKENS");
    const prepared = prepare(identity, "lens", { wallet, relayID: id(relayID), lensCount, tokenAtoms: cost.toString(), locationID, flagID });
    return { prepared_transaction: { uuid: Buffer.from(prepared.operation.operationID.replaceAll("-", ""), "hex") },
      prepared_transaction_attributes: { bcs_data_b64_bytes: prepared.unsigned.toString("base64") } };
  }
  async function executeLens(identity, operationID, signature) {
    const operation = await verifiedOperation(identity, operationID, signature, "lens");
    if (operation.status === "committed") return operation.response;
    const access = authorizeRelay(identity, operation.relayID), state = walletState(operation.wallet), cost = BigInt(operation.tokenAtoms);
    if (BigInt(state.balanceAtoms) < cost) fail("INSUFFICIENT_TOKENS");
    state.balanceAtoms = (BigInt(state.balanceAtoms) - cost).toString(); state.revision++;
    let response;
    const result = inventory.applyInventoryTransactionWithAtomicRows({ characterID: identity.characterID, ...access,
      grants: [{ typeID: 77518, quantity: operation.lensCount }], destinationLocationID: operation.locationID, destinationFlagID: operation.flagID }, staged => {
      response = { lens_items: staged.grantedItems.map(item => ({ sequential: item.itemID })), transaction_hash: receipt(operation) };
      return [row(`wallet:${operation.wallet}`, state), row(`operation:${operationID}`, { ...operation, status: "committed", response })];
    });
    if (!result.success) fail(result.errorMsg);
    if (options.onInventoryChanged) options.onInventoryChanged(identity, result.data.changes);
    else if (identity.session) character.emitItemsChangedBatchForSession(identity.session, result.data.changes);
    return response;
  }
  function sellFeralData(identity, relayID, itemID, quantity) {
    localOnly(); identityWallet(identity); const count = id(quantity), source = inventory.findItemById(id(itemID));
    const access = authorizeRelay(identity, relayID);
    if (!source || source.typeID !== 72244 || source.ownerID !== identity.characterID || source.locationID !== Number(relayID) || source.flagID !== 5) fail("FERAL_DATA_NOT_ACCESSIBLE");
    const amount = BigInt(count) * BigInt(policy.feralDataLuxCents);
    if (amount <= 0n || amount > BigInt(Number.MAX_SAFE_INTEGER)) fail("INVALID_ECONOMY_POLICY");
    const balance = character.prepareCharacterBalanceAtomicWrite(identity.characterID, Number(amount) / 100);
    const operationID = randomUUID();
    const result = inventory.applyInventoryTransactionWithAtomicRows({ characterID: identity.characterID, ...access,
      consumptions: [{ itemID: source.itemID, typeID: 72244, quantity: count }] }, [balance.row,
      row(`operation:${operationID}`, { kind: "feral_sale", characterID: identity.characterID, itemID, quantity: count, luxCents: amount.toString(), status: "committed" })]);
    if (!result.success) fail(result.errorMsg);
    emit(identity, balance.balance);
    if (options.onInventoryChanged) options.onInventoryChanged(identity, result.data.changes);
    else if (identity.session) character.emitItemsChangedBatchForSession(identity.session, result.data.changes);
    return true;
  }
  return { getBalance, getExchangeRate, reportWallet, exchangeLUX, prepareToken, executeToken, getLensPrice, prepareLens, executeLens, sellFeralData, identityWallet, policy };
}
let singleton;
function getFrontierEconomyRuntime() {
  if (!singleton) {
    const config = require("../../config");
    singleton = createFrontierEconomyRuntime({ policy: config.frontierEconomyPolicy || {} });
  }
  return singleton;
}
module.exports = { DEFAULT_POLICY, createFrontierEconomyRuntime, getFrontierEconomyRuntime };
