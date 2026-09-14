import { createHash, randomBytes, randomUUID } from "node:crypto";
import path from "node:path";
import { bcs } from "@mysten/sui/bcs";
import { Transaction } from "@mysten/sui/transactions";
import { verifyTransactionSignature } from "@mysten/sui/verify";
import { deriveObjectID } from "@mysten/sui/utils";

const PREFIX = "/evejs/storage";
const AUTH_TTL_MS = 2 * 60 * 1000;
const SESSION_TTL_MS = 30 * 60 * 1000;
const MAX_AUTH_ENTRIES = 1024;
const CARGO_FLAG = 5;

function positiveID(value: unknown) {
  if (!/^[1-9][0-9]*$/.test(String(value ?? ""))) return 0;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : 0;
}

function walletAddress(value: unknown) {
  const address = String(value ?? "").trim().toLowerCase();
  return /^0x[0-9a-f]{1,64}$/.test(address)
    ? `0x${address.slice(2).padStart(64, "0")}` : null;
}

const ERROR_MESSAGES: Record<string, string> = {
  AUTH_REQUIRED: "Connect your wallet to the game server first.",
  AUTH_EXPIRED: "The wallet session expired. Connect again.",
  INVALID_SIGNATURE: "The wallet signature does not match the prepared request.",
  INVALID_WALLET: "A valid Sui wallet address is required.",
  CHARACTER_NOT_ONLINE: "Log into the game with the character belonging to this wallet.",
  MULTIPLE_ACTIVE_CHARACTERS: "This wallet has multiple active characters. Log into only the character to use.",
  ACCESS_DENIED: "This wallet cannot access that character or inventory.",
  ASSEMBLY_NOT_IN_CURRENT_SYSTEM: "The Smart Storage Unit is not in your current system.",
  ASSEMBLY_OUT_OF_RANGE: "Move within 5 km of the Smart Storage Unit.",
  ASSEMBLY_OFFLINE: "The Smart Storage Unit must be online to transfer items.",
  ASSEMBLY_ACTIVATING: "Wait for the Smart Storage Unit's onlining timer to finish.",
  ASSEMBLY_STATE_UNAVAILABLE: "The Smart Storage Unit's blockchain state could not be verified. Please try again.",
  ASSEMBLY_STATE_PENDING: "The Smart Storage Unit's state change is awaiting blockchain confirmation. Please try again.",
  ASSEMBLY_NOT_FOUND: "That Smart Storage Unit no longer exists.",
  INVALID_ASSEMBLY_ID: "Select a valid in-game Smart Storage Unit.",
  INVALID_QUANTITY: "Select one or more stacks with positive whole quantities.",
  INVALID_DIRECTION: "Choose deposit or withdraw.",
  STORAGE_CAPACITY_EXCEEDED: "The Smart Storage Unit does not have enough free capacity.",
  SHIP_CARGO_CAPACITY_EXCEEDED: "Your active ship does not have enough cargo capacity.",
  TRANSACTION_NOT_FOUND: "The prepared transfer expired. Refresh the inventories before preparing another transfer.",
  TRANSACTION_MISMATCH: "The prepared transfer belongs to a different operation.",
  TOO_MANY_REQUESTS: "Too many wallet challenges are active. Try again shortly.",
  DEPLOYMENT_UNAVAILABLE: "The game server has no verified Sui deployment. Synchronize the local world before transferring items.",
  DEPLOYMENT_MISMATCH: "The selected storage unit or Sui deployment differs from the game server. Refresh before preparing another transfer.",
};

function failed(errorMsg: string, params?: unknown) {
  return { success: false as const, errorMsg, message: ERROR_MESSAGES[errorMsg] || errorMsg.replaceAll("_", " ").toLowerCase(), ...(params ? { params } : {}) };
}

/** This authorization transaction is signed locally and is never submitted. */
export function buildStorageAuthTransaction(address: string, message: string) {
  return JSON.stringify({
    version: 2, sender: address, expiration: null,
    gasData: {
      budget: "1", price: "1", owner: address,
      payment: [{ objectId: `0x${createHash("sha256").update(message).digest("hex")}`, version: "1", digest: "11111111111111111111111111111111" }],
    },
    inputs: [], commands: [],
  });
}

/** Verify exactly the server's bytes, never bytes selected by the caller. */
export async function verifyStorageAuthorization(transactionData: string, signature: string, address: string) {
  if (typeof signature !== "string" || signature.length > 16384) return false;
  try {
    const transaction = Transaction.from(transactionData);
    transaction.setSender(address);
    transaction.setGasOwner(address);
    const bytes = await transaction.build();
    await verifyTransactionSignature(bytes, signature, { address });
    return true;
  } catch { return false; }
}

function defaultDependencies() {
  const sessions = require("../../services/chat/sessionRegistry");
  const characterState = require("../../services/character/characterState");
  const itemStore = require("../../services/inventory/itemStore");
  const space = require("../../space/runtime");
  const runtime = require("../../services/frontier/smartStorageUnitRuntime");
  const { deriveLocalPlayerSuiWalletAddress } = require("../../services/frontier/suiCharacterProvisioning");
  return {
    runtime,
    now: Date.now,
    getSessions: () => sessions.getSessions(),
    getCharacterID: (session: any) => positiveID(sessions.resolveSessionCharacterID(session)),
    getWallet: (characterID: number) => {
      const character = characterState.peekCharacterRecord(characterID);
      if (!character) return null;
      const derived = walletAddress(deriveLocalPlayerSuiWalletAddress(character.accountId ?? character.accountID, "dev"));
      const stored = character.suiWalletAddress && walletAddress(character.suiWalletAddress);
      return stored && stored !== derived ? null : derived;
    },
    getDeployment: (storageUnitID: number) => {
      const config = require("../../config");
      const { readSyncedSuiWorldConfig } = require("../../services/frontier/suiCharacterProvisioning");
      const world = readSyncedSuiWorldConfig({
        ...process.env,
        EVEJS_CLIENT_BUILD: process.env.EVEJS_CLIENT_BUILD || String(config.clientBuild),
        EVEJS_SUI_WORLD_CONFIG_PATH: process.env.EVEJS_SUI_WORLD_CONFIG_PATH ||
          path.resolve(__dirname, "../../../..", "_local/frontier-world", String(config.clientBuild), "world.private.json"),
      });
      if (!world) return null;
      const key = bcs.struct("TenantItemId", { id: bcs.u64(), tenant: bcs.string() });
      // Enumerate public fields explicitly: the source also contains the server signer.
      return {
        network: world.network, chainId: world.chainId, packageId: world.packageId,
        objectRegistryId: world.objectRegistryId,
        assemblyObjectID: deriveObjectID(world.objectRegistryId, `${world.packageId}::in_game_id::TenantItemId`, key.serialize({ id: BigInt(storageUnitID), tenant: "dev" }).toBytes()),
      };
    },
    resolveAccess: (session: any, storageUnitID: number) => {
      const activeShipID = positiveID(session._space?.shipID || session.shipid || session.shipID);
      const solarSystemID = positiveID(session.solarsystemid2 || session._space?.systemID || session.solarsystemid || session.locationid);
      const ship = activeShipID ? space.getEntity(session, activeShipID) : null;
      const storage = space.getEntity(session, storageUnitID);
      const scene = space.getSceneForSession(session);
      const distance = ship && storage && scene?.getCommandTimeEntitySurfaceDistance
        ? scene.getCommandTimeEntitySurfaceDistance(ship, storage) : Infinity;
      return { authorized: true, activeShipID, solarSystemID, inRange: Number.isFinite(distance) && distance <= 5000 };
    },
    readCargo: (characterID: number, access: any) => {
      const ship = itemStore.findItemById(access.activeShipID);
      if (!ship || Number(ship.ownerID) !== characterID) return null;
      const creation = require("../../services/frontier/creationRuntime").getCreationDogmaContext(ship, characterID);
      const resources = require("../../services/fitting/liveFittingState").buildShipResourceState(characterID, creation?.success ? creation.data.item : ship, {
        additionalAttributeModifierEntries: creation?.success ? creation.data.shipAttributeModifierEntries || [] : [],
      });
      const items = itemStore.listContainerItems(characterID, access.activeShipID, CARGO_FLAG)
        .map((item: any) => ({
          itemID: Number(item.itemID), typeID: Number(item.typeID), singleton: Number(item.singleton) !== 0,
          quantity: Number(item.singleton) === 1 ? 1 : Number(item.stacksize ?? item.quantity),
          unitVolume: Math.max(0, Number(itemStore.getInventoryItemUnitVolume(item)) || 0),
          typeName: itemStore.getItemMetadata(item.typeID)?.name,
        })).filter((item: any) => Number.isSafeInteger(item.quantity) && item.quantity > 0);
      return {
        shipID: access.activeShipID, capacity: Math.max(0, Number(resources?.cargoCapacity) || 0), items,
        usedVolume: items.reduce((total: number, item: any) => total + item.quantity * item.unitVolume, 0),
      };
    },
    readChain: (input: any) => require("../../services/frontier/suiStorageSync").readSuiStorageSyncStatus(input),
    flushChain: (input: any) => require("../../services/frontier/suiStorageSync").flushSuiStorageSync(input),
    notify: (session: any, commit: any) => {
      characterState.emitItemsChangedBatchForSession(session, commit.changes || []);
      const { getStorageUnitProtoTypes } = require("./gatewayServices/assemblyStorageUnitProto");
      const { encodePayload } = require("./gatewayServices/gatewayServiceHelpers");
      const { publishGatewayNotice } = require("./publicGatewayLocal");
      const name = commit.action === "storageunit-deposit" ? "InventoryItemDepositedNotice" : "InventoryItemWithdrawnNotice";
      for (const item of commit.noticeItems || []) {
        publishGatewayNotice(`eve_public.assembly.storageunit.api.${name}`, encodePayload(getStorageUnitProtoTypes()[name], {
          storage_unit: { sequential: commit.storageUnitID }, character: { sequential: commit.characterID },
          item: { identifier: { sequential: item.itemID }, attributes: { identifier: { sequential: item.typeID }, quantity: item.quantity, volume: item.unitVolume * item.quantity } },
        }), { character: commit.characterID });
      }
    },
    verifySignature: verifyStorageAuthorization,
  };
}

/** Dependency injection keeps HTTP/security tests independent of the game store. */
export function createSmartStorageApi(overrides?: Record<string, any>, authOptions: { scope?: string; description?: string } = {}) {
  const dependencies: Record<string, any> = overrides || defaultDependencies();
  const now = dependencies.now || Date.now;
  const challenges = new Map<string, any>();
  const tokens = new Map<string, any>();
  function prune() {
    for (const map of [challenges, tokens]) for (const [key, value] of map) if (value.expiresAt <= now()) map.delete(key);
  }
  function liveIdentity(address: string, characterID?: number) {
    const matches = new Map<number, any>();
    for (const session of dependencies.getSessions()) {
      const id = dependencies.getCharacterID(session);
      if (id && (!characterID || id === characterID) && walletAddress(dependencies.getWallet(id)) === address) matches.set(id, session);
    }
    if (!matches.size) return failed("CHARACTER_NOT_ONLINE");
    if (matches.size !== 1) return failed("MULTIPLE_ACTIVE_CHARACTERS");
    const [id, session] = [...matches.entries()][0];
    return { success: true as const, data: { characterID: id, session, walletAddress: address } };
  }
  function authenticate(authorization: unknown) {
    prune();
    const match = /^Bearer ([A-Za-z0-9_-]{43})$/.exec(String(authorization || ""));
    if (!match) return failed("AUTH_REQUIRED");
    const token = tokens.get(match[1]);
    if (!token) return failed("AUTH_EXPIRED");
    return liveIdentity(token.walletAddress, token.characterID);
  }
  function accessContext(authorization: unknown, rawID: unknown) {
    const identity = authenticate(authorization);
    if (identity.success === false) return identity;
    const storageUnitID = positiveID(rawID);
    if (!storageUnitID) return failed("INVALID_ASSEMBLY_ID");
    const resolveAccess = () => {
      const current = authenticate(authorization);
      if (current.success === false || current.data.characterID !== identity.data.characterID) return { authorized: false };
      return dependencies.resolveAccess(current.data.session, storageUnitID);
    };
    return { success: true as const, data: { ...identity.data, storageUnitID, access: resolveAccess(), resolveAccess } };
  }
  function readInventory(context: any) {
    return dependencies.runtime.getStorageInventory({ ...context, inventoryOwnerID: context.characterID });
  }
  function readDeployment(storageUnitID: number) {
    try { return dependencies.getDeployment(storageUnitID); }
    catch { return null; }
  }
  function sameDeployment(left: any, right: any) {
    return Boolean(left && right && ["network", "chainId", "packageId", "objectRegistryId", "assemblyObjectID"].every(key => left[key] === right[key]));
  }
  async function chainState(context: any, flush = false) {
    const input = { storageUnitID: context.storageUnitID, characterID: context.characterID };
    let timer: ReturnType<typeof setTimeout> | undefined;
    const work = Promise.resolve().then(() => flush ? dependencies.flushChain(input) : dependencies.readChain(input))
      .catch((error: any) => ({ ...input, status: "error", error: error?.message || "Chain synchronization is unavailable." }));
    // A slow RPC must not hide an already committed in-game transfer. The
    // observed promise continues in the bridge's retrying synchronization loop.
    const timeout = new Promise(resolve => { timer = setTimeout(() => resolve({ ...input, status: "pending" }), dependencies.chainWaitMs ?? 5000); });
    try { return await Promise.race([work, timeout]); }
    finally { if (timer) clearTimeout(timer); }
  }
  return {
    authenticate,
    async challenge(body: any) {
      prune();
      const address = walletAddress(body?.walletAddress);
      if (!address) return failed("INVALID_WALLET");
      if (challenges.size >= MAX_AUTH_ENTRIES) return failed("TOO_MANY_REQUESTS");
      const challengeId = randomUUID();
      const expiresAt = now() + AUTH_TTL_MS;
      const message = `EveJS ${authOptions.scope || "Smart Storage"} wallet connection\nWallet: ${address}\nNonce: ${challengeId}\nExpires: ${expiresAt}\n${authOptions.description || "This signature authorizes access to your active in-game character's storage."} This transaction is not submitted.`;
      const transactionData = buildStorageAuthTransaction(address, message);
      challenges.set(challengeId, { address, message, transactionData, expiresAt });
      return { success: true, data: { challengeId, message, transactionData, expiresAt } };
    },
    async session(body: any) {
      prune();
      const challenge = challenges.get(body?.challengeId);
      if (!challenge) return failed("AUTH_EXPIRED");
      // Consume before asynchronous verification: a challenge can create only one session.
      challenges.delete(body.challengeId);
      if (!await dependencies.verifySignature(challenge.transactionData, body?.signature, challenge.address)) return failed("INVALID_SIGNATURE");
      const identity = liveIdentity(challenge.address);
      if (identity.success === false) return identity;
      if (tokens.size >= MAX_AUTH_ENTRIES) return failed("TOO_MANY_REQUESTS");
      const token = randomBytes(32).toString("base64url");
      const data = { token, characterID: identity.data.characterID, walletAddress: challenge.address, expiresAt: now() + SESSION_TTL_MS };
      tokens.set(token, data);
      return { success: true, data };
    },
    async inventory(authorization: unknown, id: unknown) {
      const resolved = accessContext(authorization, id);
      if (resolved.success === false) return resolved;
      const result = await readInventory(resolved.data);
      if (!result.success) return failed(result.errorMsg, result.params);
      let chain: any = await chainState(resolved.data);
      const current = accessContext(authorization, id);
      if (current.success === false) return current;
      const inventory = await readInventory(current.data);
      if (!inventory.success) return failed(inventory.errorMsg, inventory.params);
      const latest = accessContext(authorization, id);
      if (latest.success === false) return latest;
      if (JSON.stringify(result.data) !== JSON.stringify(inventory.data) && chain.status === "synced") {
        chain = { ...chain, status: "pending", ...(chain.chain ? { chain: {
          ...chain.chain, synchronized: false,
          partitions: chain.chain.partitions.map((partition: any) => ({ ...partition, synchronized: false })),
        } } : {}) };
      }
      const cargo = dependencies.readCargo(latest.data.characterID, latest.data.access);
      if (!cargo) return failed("ACCESS_DENIED");
      return { success: true, data: { ...inventory.data, characterID: latest.data.characterID, cargo, deployment: readDeployment(latest.data.storageUnitID), chain } };
    },
    async prepare(authorization: unknown, id: unknown, body: any) {
      const resolved = accessContext(authorization, id);
      if (resolved.success === false) return resolved;
      if (!["deposit", "withdraw"].includes(body?.direction)) return failed("INVALID_DIRECTION");
      if (!Array.isArray(body?.stacks) || body.stacks.length === 0 || body.stacks.length > 100 || body.stacks.some((stack: any) =>
        !positiveID(stack?.quantity) || !positiveID(body.direction === "deposit" ? stack?.itemID : stack?.typeID))) return failed("INVALID_QUANTITY");
      const context = resolved.data;
      const deployment = readDeployment(context.storageUnitID);
      if (!deployment) return failed("DEPLOYMENT_UNAVAILABLE");
      if (walletAddress(body.expectedAssemblyObjectID) !== walletAddress(deployment.assemblyObjectID)) return failed("DEPLOYMENT_MISMATCH");
      const method = body.direction === "deposit" ? dependencies.runtime.prepareStorageDeposit : dependencies.runtime.prepareStorageWithdraw;
      const result = await method({
        characterID: context.characterID, storageUnitID: context.storageUnitID, walletAddress: context.walletAddress, access: context.access, deployment,
        resolveAccess: context.resolveAccess,
        sourceLocationID: context.access.activeShipID, sourceFlagID: CARGO_FLAG,
        destinationLocationID: context.access.activeShipID, destinationFlagID: CARGO_FLAG,
        stacks: body.stacks.map((stack: any) => body.direction === "deposit"
          ? { itemID: positiveID(stack.itemID), quantity: positiveID(stack.quantity) }
          : { typeID: positiveID(stack.typeID), quantity: positiveID(stack.quantity) }),
      });
      return result.success ? result : failed(result.errorMsg, result.params);
    },
    async execute(authorization: unknown, id: unknown, body: any) {
      const resolved = accessContext(authorization, id);
      if (resolved.success === false) return resolved;
      if (!["deposit", "withdraw"].includes(body?.direction)) return failed("INVALID_DIRECTION");
      const context = resolved.data;
      const prepared = dependencies.runtime.getStorageTransaction({ characterID: context.characterID, storageUnitID: context.storageUnitID, transactionUUID: body?.transactionUUID });
      if (!prepared.success) return failed(prepared.errorMsg, prepared.params);
      const action = `storageunit-${body.direction}`;
      if (prepared.data.action !== action || walletAddress(prepared.data.walletAddress) !== context.walletAddress) return failed("TRANSACTION_MISMATCH");
      if (!await dependencies.verifySignature(prepared.data.transactionData, body?.signature, context.walletAddress)) return failed("INVALID_SIGNATURE");
      // Wallet/session and access are re-resolved after the asynchronous signature check.
      const current = accessContext(authorization, id);
      if (current.success === false) return current;
      if (!sameDeployment(prepared.data.deployment, readDeployment(context.storageUnitID))) return failed("DEPLOYMENT_MISMATCH");
      const result = await dependencies.runtime.executeStorageTransaction({
        action, characterID: context.characterID, storageUnitID: context.storageUnitID,
        transactionUUID: body.transactionUUID, signature: body.signature, signatureVerified: true, walletAddress: context.walletAddress,
        resolveAccess: current.data.resolveAccess,
      });
      if (!result.success) return failed(result.errorMsg, result.params);
      let notificationError: string | undefined;
      if (!result.data.replayed) {
        const recipient = authenticate(authorization);
        try {
          if (recipient.success === false) throw new Error("The character session ended after the transfer committed.");
          dependencies.notify(recipient.data.session, result.data);
        } catch { notificationError = "The transfer is saved. Refresh the in-game inventory to see the new contents."; }
      }
      return { success: true, data: {
        action, characterID: context.characterID, storageUnitID: context.storageUnitID,
        gameCommitted: true, replayed: result.data.replayed === true,
        chain: await chainState(context, true), ...(notificationError ? { notificationError } : {}),
      } };
    },
    async sync(authorization: unknown, id: unknown) {
      const resolved = accessContext(authorization, id);
      if (resolved.success === false) return resolved;
      const inventory = await readInventory(resolved.data);
      if (!inventory.success) return failed(inventory.errorMsg, inventory.params);
      return { success: true, data: await chainState(resolved.data, true) };
    },
  };
}

export function mountSmartStorageEndpoints(app: any, options: Record<string, any> = {}) {
  // Lazy initialization avoids loading game data for unrelated proxy traffic.
  let api: ReturnType<typeof createSmartStorageApi>;
  const getApi = () => api || (api = options.api || createSmartStorageApi());
  const origins = new Set(String(process.env.EVEJS_STORAGE_DAPP_ORIGINS || "https://localhost,https://127.0.0.1,https://dev.dapps.evefrontier.com").split(",").map(value => value.trim()));
  app.use(PREFIX, (req: any, res: any, next: any) => {
    res.set("Cache-Control", "no-store");
    const origin = req.headers.origin;
    if (origin && !origins.has(origin)) { res.status(403).json(failed("ACCESS_DENIED")); return; }
    if (origin) {
      res.set("Access-Control-Allow-Origin", origin);
      res.vary("Origin");
      res.set("Access-Control-Allow-Headers", "Authorization, Content-Type");
      res.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    }
    if (req.method === "OPTIONS") { res.sendStatus(204); return; }
    next();
  });
  const route = (handler: (api: ReturnType<typeof createSmartStorageApi>, req: any) => Promise<any>) => async (req: any, res: any) => {
    try {
      const result = await handler(getApi(), req);
      const code = result.success ? 200 : result.errorMsg === "TOO_MANY_REQUESTS" ? 429
        : result.errorMsg === "ASSEMBLY_STATE_UNAVAILABLE" ? 503
        : /^AUTH_|INVALID_SIGNATURE|CHARACTER_NOT_ONLINE|MULTIPLE_ACTIVE/.test(result.errorMsg) ? 401
          : /ACCESS_DENIED|OUT_OF_RANGE|NOT_IN_CURRENT_SYSTEM/.test(result.errorMsg) ? 403
            : /NOT_FOUND/.test(result.errorMsg) ? 404 : /INVALID_/.test(result.errorMsg) ? 400 : 409;
      res.status(code).json(result);
    } catch { res.status(500).json(failed("STORAGE_REQUEST_FAILED")); }
  };
  app.post(`${PREFIX}/auth/challenge`, route((service, req) => service.challenge(req.body)));
  app.post(`${PREFIX}/auth/session`, route((service, req) => service.session(req.body)));
  app.get(`${PREFIX}/:storageUnitID/inventory`, route((service, req) => service.inventory(req.headers.authorization, req.params.storageUnitID)));
  app.post(`${PREFIX}/:storageUnitID/prepare`, route((service, req) => service.prepare(req.headers.authorization, req.params.storageUnitID, req.body)));
  app.post(`${PREFIX}/:storageUnitID/execute`, route((service, req) => service.execute(req.headers.authorization, req.params.storageUnitID, req.body)));
  app.post(`${PREFIX}/:storageUnitID/sync`, route((service, req) => service.sync(req.headers.authorization, req.params.storageUnitID)));
}
