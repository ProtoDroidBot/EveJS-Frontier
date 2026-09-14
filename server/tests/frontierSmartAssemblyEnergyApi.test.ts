import assert from "node:assert/strict";
import test from "node:test";
import { once } from "node:events";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { Transaction } from "@mysten/sui/transactions";
import { createSmartStorageApi, verifyStorageAuthorization } from "../src/_secondary/express/smartStorageEndpoints";
import { createSmartAssemblyEnergyApi, mountSmartAssemblyEnergyEndpoints } from "../src/_secondary/express/smartAssemblyEnergyEndpoints";

function fixture(overrides: Record<string, any> = {}) {
  const key = Ed25519Keypair.generate();
  const walletAddress = key.toSuiAddress();
  const session = { characterID: 140000001 };
  const grid = { networkNodeID: 50, radiusMeters: 100000, maxEnergy: 1000, energyUsed: 100,
    energyAvailable: 900, connectedAssemblies: [], nearbyAssemblies: [] };
  const state: any = { time: 1000, sessions: [session], walletAddress, calls: [], error: null };
  const authDependencies = {
    now: () => state.time, getSessions: () => state.sessions,
    getCharacterID: (value: any) => value.characterID, getWallet: () => state.walletAddress,
    verifySignature: verifyStorageAuthorization,
  };
  const runtime = {
    getNetworkNodeEnergyStatus(characterID: number, networkNodeID: number) {
      state.calls.push({ action: "status", characterID, networkNodeID });
      return state.error ? { success: false, errorMsg: state.error, message: "private-runtime-detail" }
        : { success: true, data: grid };
    },
    connectAssembly(current: any, assemblyID: number, networkNodeID: number) {
      state.calls.push({ action: "connect", session: current, assemblyID, networkNodeID });
      return state.error ? { success: false, errorMsg: state.error } : { success: true };
    },
    disconnectAssembly(current: any, assemblyID: number, networkNodeID: number) {
      state.calls.push({ action: "disconnect", session: current, assemblyID, networkNodeID });
      return state.error ? { success: false, errorMsg: state.error } : { success: true };
    },
  };
  const api = createSmartAssemblyEnergyApi({ authDependencies, runtime, ...overrides });
  async function login(service: any = api) {
    const challenge = await service.challenge({ walletAddress });
    const signature = (await key.signTransaction(await Transaction.from(challenge.data.transactionData).build())).signature;
    const result = await service.session({ challengeId: challenge.data.challengeId, signature });
    assert.equal(result.success, true);
    return `Bearer ${result.data.token}`;
  }
  return { api, key, walletAddress, session, grid, state, runtime, authDependencies, login };
}

test("grid wallet authorization is scoped, signed, and invalidated by logout or expiry", async () => {
  const { api, key, walletAddress, authDependencies, state, login } = fixture();
  const challenge: any = await api.challenge({ walletAddress });
  assert.match(challenge.data.message, /Smart Assembly energy grid/);
  assert.match(challenge.data.message, /connecting or disconnecting/);
  const stranger = Ed25519Keypair.generate();
  const invalidSignature = (await stranger.signTransaction(await Transaction.from(challenge.data.transactionData).build())).signature;
  assert.equal((await api.session({ challengeId: challenge.data.challengeId, signature: invalidSignature }) as any).errorMsg, "INVALID_SIGNATURE");
  const storageToken = await login(createSmartStorageApi(authDependencies));
  assert.equal((await api.status(storageToken, 50) as any).errorMsg, "AUTH_EXPIRED");
  const token = await login();
  assert.equal((await api.status(token, 50)).success, true);
  state.sessions = [];
  assert.equal((await api.connect(token, 50, { assemblyID: 51 }) as any).errorMsg, "CHARACTER_NOT_ONLINE");
  state.time += 30 * 60 * 1000;
  assert.equal((await api.disconnect(token, 50, { assemblyID: 51 }) as any).errorMsg, "AUTH_EXPIRED");
});

test("grid mutations use the authenticated game session and return freshly calculated totals", async () => {
  const { api, state, session, grid, login } = fixture();
  const token = await login();
  const result = await api.connect(token, "50", {
    assemblyID: "51", characterID: 999, session: { characterID: 999 }, networkNodeID: 999,
    energyRequired: 0, energyAvailable: Number.MAX_SAFE_INTEGER,
  });
  assert.deepEqual(result, { success: true, data: grid });
  assert.deepEqual(state.calls, [
    { action: "connect", session, assemblyID: 51, networkNodeID: 50 },
    { action: "status", characterID: session.characterID, networkNodeID: 50 },
  ]);
  state.calls = [];
  assert.deepEqual(await api.disconnect(token, 50, { assemblyID: 51 }), { success: true, data: grid });
  assert.deepEqual(state.calls[0], { action: "disconnect", session, assemblyID: 51, networkNodeID: 50 });
});

test("queued grid changes reauthenticate after waiting for chain synchronization", async () => {
  let resume: (() => void) | undefined;
  const { api, state, login } = fixture({ runMutation: operation => new Promise(resolve => {
    resume = () => resolve(operation());
  }) });
  const token = await login();
  const pending = api.connect(token, 50, { assemblyID: 51 });
  assert.equal(state.calls.length, 0);
  state.sessions = [];
  resume!();
  const result: any = await pending;
  assert.equal(result.errorMsg, "CHARACTER_NOT_ONLINE");
  assert.equal(state.calls.length, 0);
});

test("grid API rejects malformed IDs and missing authentication before invoking runtime", async () => {
  const { api, state, login } = fixture();
  const token = await login();
  assert.equal((await api.status(undefined, 50) as any).errorMsg, "AUTH_REQUIRED");
  for (const id of [0, -1, 1.5, "1e2", "01", Number.MAX_SAFE_INTEGER + 1, "50/connect", null]) {
    assert.equal((await api.status(token, id) as any).errorMsg, "INVALID_ASSEMBLY_ID");
    assert.equal((await api.connect(token, 50, { assemblyID: id }) as any).errorMsg, "INVALID_ASSEMBLY_ID");
    assert.equal((await api.disconnect(token, id, { assemblyID: 51 }) as any).errorMsg, "INVALID_ASSEMBLY_ID");
  }
  assert.equal(state.calls.length, 0);
});

test("grid API preserves actionable range errors and sanitizes unexpected runtime details", async () => {
  const { api, state, runtime, login } = fixture();
  const token = await login();
  state.error = "ASSEMBLY_OUT_OF_RANGE";
  const rejected: any = await api.connect(token, 50, { assemblyID: 51 });
  assert.equal(rejected.errorMsg, "ASSEMBLY_OUT_OF_RANGE");
  assert.match(rejected.message, /outside.*radius/);
  assert.equal(state.calls.length, 1);
  state.error = "NETWORK_NODE_BINDING_LOCKED";
  const locked: any = await api.disconnect(token, 50, { assemblyID: 51 });
  assert.equal(locked.errorMsg, "NETWORK_NODE_BINDING_LOCKED");
  assert.match(locked.message, /chain connection cannot be changed/);
  state.error = "secret-runtime-failure";
  const unknown: any = await api.status(token, 50);
  assert.equal(unknown.errorMsg, "ENERGY_REQUEST_FAILED");
  assert.equal(JSON.stringify(unknown).includes("private-runtime-detail"), false);
  runtime.disconnectAssembly = () => { throw new Error("private-runtime-detail"); };
  const thrown: any = await api.disconnect(token, 50, { assemblyID: 51 });
  assert.equal(thrown.errorMsg, "ENERGY_REQUEST_FAILED");
  assert.equal(JSON.stringify(thrown).includes("private-runtime-detail"), false);
});

test("mounted grid routes enforce origins and authentication and do not cache grid state", async () => {
  const express = require("express");
  const app = express();
  app.use(express.json({ limit: "64kb" }));
  const { api, grid, state, login } = fixture();
  mountSmartAssemblyEnergyEndpoints(app, { api });
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const base = `http://127.0.0.1:${server.address().port}/evejs/energy`;
  const token = await login();
  const headers = { "Content-Type": "application/json", Origin: "https://localhost", Authorization: token };
  try {
    const request = { method: "POST", headers, body: JSON.stringify({ assemblyID: 51 }) };
    const connected = await fetch(`${base}/50/connect`, request);
    assert.equal(connected.status, 200);
    assert.deepEqual(await connected.json(), { success: true, data: grid });
    assert.equal(connected.headers.get("cache-control"), "no-store");
    const disconnected = await fetch(`${base}/50/disconnect`, request);
    assert.equal(disconnected.status, 200);
    state.error = "NETWORK_NODE_ENERGY_CONFIG_UNAVAILABLE";
    const unavailable = await fetch(`${base}/50/status`, request);
    assert.equal(unavailable.status, 503);
    assert.equal((await unavailable.json() as any).errorMsg, "NETWORK_NODE_ENERGY_CONFIG_UNAVAILABLE");
    state.error = null;
    const blocked = await fetch(`${base}/50/status`, { ...request, headers: { ...headers, Origin: "https://untrusted.invalid" } });
    assert.equal(blocked.status, 403);
    assert.equal(blocked.headers.get("access-control-allow-origin"), null);
    const unauthenticated = await fetch(`${base}/50/status`, { ...request, headers: { ...headers, Authorization: "" } });
    assert.equal(unauthenticated.status, 401);
    const malformed = await fetch(`${base}/50/connect`, { ...request, body: "{private-marker" });
    assert.equal(malformed.status, 400);
    const body = await malformed.text();
    assert.equal(body.includes("private-marker"), false);
    assert.equal(JSON.parse(body).errorMsg, "INVALID_REQUEST");
    const preflight = await fetch(`${base}/50/connect`, { method: "OPTIONS", headers: { Origin: "https://localhost" } });
    assert.equal(preflight.status, 204);
  } finally { server.close(); await once(server, "close"); }
});
