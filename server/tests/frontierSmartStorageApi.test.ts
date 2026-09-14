import assert from "node:assert/strict";
import test from "node:test";
import { once } from "node:events";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { Transaction } from "@mysten/sui/transactions";
import { buildStorageAuthTransaction, createSmartStorageApi, mountSmartStorageEndpoints, verifyStorageAuthorization } from "../src/_secondary/express/smartStorageEndpoints";

async function sign(data: string, key: Ed25519Keypair) {
  return (await key.signTransaction(await Transaction.from(data).build())).signature;
}

function fixture() {
  const key = Ed25519Keypair.generate();
  const address = key.toSuiAddress();
  const session = { characterID: 140000001 };
  const state: any = {
    time: 1000, sessions: [session], wallet: address, inRange: true,
    reads: [], prepared: [], executed: [], notifications: [], commits: 0,
    deployment: { network: "localnet", chainId: "abcd", packageId: "0x1", objectRegistryId: "0x2", assemblyObjectID: "0x3" },
  };
  const transactions = new Map<string, any>();
  const runtime = {
    getStorageInventory(context: any) {
      state.reads.push(context);
      if (!context.access.inRange) return { success: false, errorMsg: "ASSEMBLY_OUT_OF_RANGE" };
      return { success: true, data: { storageUnitID: context.storageUnitID, capacity: 1000, usedVolume: 1, items: [{ itemID: 11, typeID: 12, quantity: 10, unitVolume: 0.1 }] } };
    },
    prepareStorageDeposit(input: any) { return prepare(input, "storageunit-deposit"); },
    prepareStorageWithdraw(input: any) { return prepare(input, "storageunit-withdraw"); },
    getStorageTransaction(input: any) {
      const found = transactions.get(input.transactionUUID);
      if (!found) return { success: false, errorMsg: "TRANSACTION_NOT_FOUND" };
      if (found.storageUnitID !== input.storageUnitID || found.characterID !== input.characterID) return { success: false, errorMsg: "TRANSACTION_MISMATCH" };
      return { success: true, data: found };
    },
    executeStorageTransaction(input: any) {
      state.executed.push(input);
      if (!input.resolveAccess().inRange) return { success: false, errorMsg: "ASSEMBLY_OUT_OF_RANGE" };
      const transaction = transactions.get(input.transactionUUID);
      const replayed = transaction.committed === true;
      if (!replayed) state.commits++;
      transaction.committed = true;
      return { success: true, data: { ...input, changes: [{ itemID: 11 }], replayed } };
    },
  };
  function prepare(input: any, action: string) {
    state.prepared.push(input);
    if (!input.access.inRange) return { success: false, errorMsg: "ASSEMBLY_OUT_OF_RANGE" };
    const transactionUUID = `transfer-${transactions.size}`;
    const data = { ...input, action, transactionUUID, expiresAtMs: state.time + 120000,
      transactionData: buildStorageAuthTransaction(address, JSON.stringify({ ...input, action, transactionUUID })) };
    transactions.set(transactionUUID, data);
    return { success: true, data };
  }
  const dependencies: any = {
    runtime, now: () => state.time, getSessions: () => state.sessions,
    getCharacterID: (value: any) => value.characterID, getWallet: () => state.wallet,
    getDeployment: () => state.deployment,
    resolveAccess: () => ({ authorized: true, activeShipID: 77, solarSystemID: 33, inRange: state.inRange }),
    readCargo: () => ({ shipID: 77, capacity: 500, usedVolume: 3, items: [] }),
    readChain: async () => ({ status: "synced" }), flushChain: async () => ({ status: "synced" }),
    notify: (...args: any[]) => state.notifications.push(args), verifySignature: verifyStorageAuthorization,
  };
  const api = createSmartStorageApi(dependencies);
  async function login(): Promise<string> {
    const challenge: any = await api.challenge({ walletAddress: address });
    const result: any = await api.session({ challengeId: challenge.data.challengeId, signature: await sign(challenge.data.transactionData, key) });
    assert.equal(result.success, true);
    return `Bearer ${result.data.token}`;
  }
  async function signedTransfer(authorization: string, direction = "deposit") {
    const prepared: any = await api.prepare(authorization, 50, { direction, expectedAssemblyObjectID: "0x3", stacks: [{ itemID: 11, typeID: 12, quantity: 2 }] });
    assert.equal(prepared.success, true);
    return { direction, transactionUUID: prepared.data.transactionUUID, signature: await sign(prepared.data.transactionData, key) };
  }
  return { api, key, address, state, dependencies, login, signedTransfer };
}

test("storage authentication verifies canonical transaction bytes, consumes challenges, and expires sessions", async () => {
  const { api, key, address, state } = fixture();
  const challenge: any = await api.challenge({ walletAddress: address });
  assert.equal(Transaction.from(challenge.data.transactionData).getData().sender, address);
  const signature = await sign(challenge.data.transactionData, key);
  const login: any = await api.session({ challengeId: challenge.data.challengeId, signature });
  assert.equal(login.data.characterID, 140000001);
  assert.equal((await api.session({ challengeId: challenge.data.challengeId, signature })).success, false);
  assert.equal((await api.inventory(`Bearer ${login.data.token}`, 50)).success, true);
  state.time = login.data.expiresAt;
  assert.equal((await api.inventory(`Bearer ${login.data.token}`, 50) as any).errorMsg, "AUTH_EXPIRED");
});

test("storage auth rejects a different signer or a changed challenge", async () => {
  const { api, address, key } = fixture();
  const challenge: any = await api.challenge({ walletAddress: address });
  const signature = await sign(challenge.data.transactionData, Ed25519Keypair.generate());
  assert.equal((await api.session({ challengeId: challenge.data.challengeId, signature }) as any).errorMsg, "INVALID_SIGNATURE");
  assert.equal(await verifyStorageAuthorization(buildStorageAuthTransaction(address, "changed"), await sign(challenge.data.transactionData, key), address), false);
});

test("storage token cannot outlive the active character or wallet binding", async () => {
  const { api, state, login } = fixture();
  const authorization = await login();
  state.wallet = Ed25519Keypair.generate().toSuiAddress();
  assert.equal((await api.inventory(authorization, 50) as any).errorMsg, "CHARACTER_NOT_ONLINE");
  state.sessions = [];
  assert.equal((await api.inventory(authorization, 50) as any).errorMsg, "CHARACTER_NOT_ONLINE");
  assert.equal((await api.inventory("Bearer untrusted", 50) as any).errorMsg, "AUTH_REQUIRED");
});

test("wallet with multiple active characters fails closed", async () => {
  const { api, key, address, state } = fixture();
  state.sessions.push({ characterID: 140000002 });
  const challenge: any = await api.challenge({ walletAddress: address });
  assert.equal((await api.session({ challengeId: challenge.data.challengeId, signature: await sign(challenge.data.transactionData, key) }) as any).errorMsg, "MULTIPLE_ACTIVE_CHARACTERS");
});

test("inventory and prepare use server character, range, ship and cargo flag despite injected fields", async () => {
  const { api, state, login } = fixture();
  const authorization = await login();
  const inventory: any = await api.inventory(authorization, 50);
  assert.equal(inventory.data.cargo.shipID, 77);
  assert.equal(state.reads[0].inventoryOwnerID, 140000001);
  const result = await api.prepare(authorization, 50, {
    direction: "withdraw", expectedAssemblyObjectID: "0x3", characterID: 999, inventoryOwnerID: 999, walletAddress: "0x9",
    destinationLocationID: 999, destinationFlagID: 66, access: { authorized: true, activeShipID: 999 },
    stacks: [{ typeID: 12, quantity: 2, ownerID: 999 }],
  });
  assert.equal(result.success, true);
  assert.equal(state.prepared[0].characterID, 140000001);
  assert.equal(state.prepared[0].destinationLocationID, 77);
  assert.equal(state.prepared[0].destinationFlagID, 5);
  assert.deepEqual(state.prepared[0].stacks, [{ typeID: 12, quantity: 2 }]);
  state.inRange = false;
  assert.equal((await api.inventory(authorization, 50) as any).errorMsg, "ASSEMBLY_OUT_OF_RANGE");
  assert.equal((await api.prepare(authorization, 50, { direction: "deposit", expectedAssemblyObjectID: "0x3", stacks: [{ itemID: 11, quantity: 2 }], access: { inRange: true } }) as any).errorMsg, "ASSEMBLY_OUT_OF_RANGE");
});

test("invalid identifiers and fractional or unbounded quantities are rejected before runtime", async () => {
  const { api, login, state } = fixture();
  const authorization = await login();
  assert.equal((await api.inventory(authorization, "1e2") as any).errorMsg, "INVALID_ASSEMBLY_ID");
  for (const quantity of [0, -1, 1.5, "1e2", Number.MAX_SAFE_INTEGER + 1]) {
    assert.equal((await api.prepare(authorization, 50, { direction: "deposit", stacks: [{ itemID: 11, quantity }] }) as any).errorMsg, "INVALID_QUANTITY");
  }
  assert.equal(state.prepared.length, 0);
});

test("execute verifies the exact operation and storage binding then rechecks live range", async () => {
  const { api, login, signedTransfer, dependencies, state } = fixture();
  const authorization = await login();
  const body = await signedTransfer(authorization);
  assert.equal((await api.execute(authorization, 51, body) as any).errorMsg, "TRANSACTION_MISMATCH");
  assert.equal((await api.execute(authorization, 50, { ...body, direction: "withdraw" }) as any).errorMsg, "TRANSACTION_MISMATCH");
  const alternate = await signedTransfer(authorization);
  assert.equal((await api.execute(authorization, 50, { ...body, signature: alternate.signature }) as any).errorMsg, "INVALID_SIGNATURE");
  dependencies.verifySignature = async (...args: Parameters<typeof verifyStorageAuthorization>) => {
    const valid = await verifyStorageAuthorization(...args);
    state.inRange = false;
    return valid;
  };
  assert.equal((await api.execute(authorization, 50, body) as any).errorMsg, "ASSEMBLY_OUT_OF_RANGE");
  assert.equal(state.commits, 0);
});

test("a repeated signed execute is idempotent and publishes changes once", async () => {
  const { api, login, signedTransfer, state } = fixture();
  const authorization = await login();
  const body = await signedTransfer(authorization);
  const result: any = await api.execute(authorization, 50, body);
  assert.equal(result.data.gameCommitted, true);
  assert.equal(result.data.chain.status, "synced");
  assert.equal(state.executed[0].signatureVerified, true);
  const replay: any = await api.execute(authorization, 50, body);
  assert.equal(replay.data.replayed, true);
  assert.equal(state.commits, 1);
  assert.equal(state.notifications.length, 1);
});

test("chain or notification failures preserve a successful game commit response", async () => {
  const { api, login, signedTransfer, dependencies } = fixture();
  const authorization = await login();
  const body = await signedTransfer(authorization);
  dependencies.notify = () => { throw new Error("transport lost"); };
  dependencies.flushChain = () => { throw new Error("RPC unavailable"); };
  const result: any = await api.execute(authorization, 50, body);
  assert.equal(result.success, true);
  assert.equal(result.data.gameCommitted, true);
  assert.equal(result.data.chain.status, "error");
  assert.equal(result.data.chain.error, "RPC unavailable");
  assert.match(result.data.notificationError, /saved/);
});

test("storage object mismatch or deployment change rejects a prepared transfer", async () => {
  const { api, login, signedTransfer, state } = fixture();
  const authorization = await login();
  const mismatch: any = await api.prepare(authorization, 50, { direction: "deposit", expectedAssemblyObjectID: "0x4", stacks: [{ itemID: 11, quantity: 1 }] });
  assert.equal(mismatch.errorMsg, "DEPLOYMENT_MISMATCH");
  const body = await signedTransfer(authorization);
  state.deployment = { ...state.deployment, chainId: "efgh" };
  assert.equal((await api.execute(authorization, 50, body) as any).errorMsg, "DEPLOYMENT_MISMATCH");
  assert.equal(state.commits, 0);
});

test("inventory rereads after slow chain access and does not label changed game contents synchronized", async () => {
  const { api, login, dependencies, state } = fixture();
  const authorization = await login();
  const initial = dependencies.runtime.getStorageInventory;
  dependencies.runtime.getStorageInventory = (context: any) => {
    const result = initial(context);
    if (state.changed && result.success) result.data.items[0].quantity = 20;
    return result;
  };
  dependencies.readChain = async () => { state.changed = true; return { status: "synced" }; };
  const inventory: any = await api.inventory(authorization, 50);
  assert.equal(inventory.data.items[0].quantity, 20);
  assert.equal(inventory.data.chain.status, "pending");
  dependencies.readChain = async () => { state.inRange = false; return { status: "synced" }; };
  assert.equal((await api.inventory(authorization, 50) as any).errorMsg, "ASSEMBLY_OUT_OF_RANGE");
});

test("slow chain synchronization returns pending without replaying game changes", async () => {
  const { api, login, signedTransfer, dependencies, state } = fixture();
  const authorization = await login();
  const body = await signedTransfer(authorization);
  dependencies.chainWaitMs = 5;
  let finish: (value: any) => void;
  dependencies.flushChain = () => new Promise(resolve => { finish = resolve; });
  const result: any = await api.execute(authorization, 50, body);
  assert.equal(result.data.gameCommitted, true);
  assert.equal(result.data.chain.status, "pending");
  finish({ status: "synced" });
  assert.equal(state.commits, 1);
});

test("mounted HTTP routes reject untrusted origins and require bearer auth", async () => {
  const express = require("express");
  const app = express();
  app.use(express.json());
  mountSmartStorageEndpoints(app, { api: fixture().api });
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const base = `http://127.0.0.1:${server.address().port}/evejs/storage`;
  try {
    const cors = await fetch(`${base}/50/inventory`, { headers: { Origin: "https://untrusted.invalid" } });
    assert.equal(cors.status, 403);
    const unauthenticated = await fetch(`${base}/50/inventory`);
    assert.equal(unauthenticated.status, 401);
    assert.equal(unauthenticated.headers.get("cache-control"), "no-store");
    assert.equal((await unauthenticated.json() as any).errorMsg, "AUTH_REQUIRED");
  } finally { server.close(); await once(server, "close"); }
});

test("storage access callbacks recheck authentication after asynchronous assembly reads", async () => {
  for (const operation of ["inventory", "prepare", "execute"]) {
    const { api, state, dependencies, login, signedTransfer } = fixture();
    const authorization = await login();
    const transfer = operation === "execute" ? await signedTransfer(authorization) : null;
    const method = operation === "inventory" ? "getStorageInventory"
      : operation === "prepare" ? "prepareStorageDeposit" : "executeStorageTransaction";
    dependencies.runtime[method] = async (input: any) => {
      assert.equal(input.resolveAccess().authorized, true);
      await Promise.resolve();
      state.sessions = [];
      assert.equal(input.resolveAccess().authorized, false);
      return { success: false, errorMsg: "ACCESS_DENIED" };
    };
    const result: any = operation === "inventory" ? await api.inventory(authorization, 50)
      : operation === "prepare" ? await api.prepare(authorization, 50, {
        direction: "deposit", expectedAssemblyObjectID: "0x3", stacks: [{ itemID: 11, quantity: 1 }],
      }) : await api.execute(authorization, 50, transfer);
    assert.equal(result.errorMsg, "ACCESS_DENIED", operation);
    assert.equal(state.commits, 0);
  }
});

test("HTTP reports unavailable and pending blockchain assembly states as retryable failures", async () => {
  const express = require("express");
  const { api, dependencies, login } = fixture();
  const authorization = await login();
  const app = express();
  mountSmartStorageEndpoints(app, { api });
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const url = `http://127.0.0.1:${server.address().port}/evejs/storage/50/inventory`;
  try {
    for (const [errorMsg, expectedStatus] of [["ASSEMBLY_STATE_UNAVAILABLE", 503], ["ASSEMBLY_STATE_PENDING", 409]] as const) {
      dependencies.runtime.getStorageInventory = async () => ({ success: false, errorMsg });
      const response = await fetch(url, { headers: { Authorization: authorization } });
      const result: any = await response.json();
      assert.equal(response.status, expectedStatus);
      assert.equal(result.errorMsg, errorMsg);
      assert.match(result.message, /blockchain.*try again/i);
    }
  } finally { server.close(); await once(server, "close"); }
});

test("inventory returns the current ship cargo after its final asynchronous assembly read", async () => {
  const { api, dependencies, login } = fixture();
  const authorization = await login();
  let shipID = 77;
  let reads = 0;
  const readInventory = dependencies.runtime.getStorageInventory;
  const resolveAccess = dependencies.resolveAccess;
  dependencies.resolveAccess = () => ({ ...resolveAccess(), activeShipID: shipID });
  dependencies.readCargo = (_characterID: number, access: any) => ({ shipID: access.activeShipID, capacity: 500, usedVolume: 0, items: [] });
  dependencies.runtime.getStorageInventory = async (input: any) => {
    await Promise.resolve();
    if (++reads === 2) shipID = 88;
    return readInventory({ ...input, access: input.resolveAccess() });
  };
  const result: any = await api.inventory(authorization, 50);
  assert.equal(result.success, true);
  assert.equal(result.data.cargo.shipID, 88);
});

test("completed asynchronous transfers notify the current session and stay successful after logout", async () => {
  for (const loggedOut of [false, true]) {
    const { api, dependencies, state, login, signedTransfer } = fixture();
    const authorization = await login();
    const body = await signedTransfer(authorization);
    const execute = dependencies.runtime.executeStorageTransaction;
    const newSession = { characterID: 140000001, reconnected: true };
    dependencies.runtime.executeStorageTransaction = async (input: any) => {
      await Promise.resolve();
      state.sessions = [newSession];
      const result = execute(input);
      if (loggedOut) state.sessions = [];
      return result;
    };
    const result: any = await api.execute(authorization, 50, body);
    assert.equal(result.success, true);
    assert.equal(result.data.gameCommitted, true);
    assert.equal(state.commits, 1);
    if (loggedOut) {
      assert.equal(state.notifications.length, 0);
      assert.match(result.data.notificationError, /transfer is saved/i);
    } else {
      assert.equal(state.notifications.length, 1);
      assert.equal(state.notifications[0][0], newSession);
    }
  }
});
