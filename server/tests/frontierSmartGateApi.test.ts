import assert from "node:assert/strict";
import test from "node:test";
import { once } from "node:events";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { Transaction } from "@mysten/sui/transactions";
import { createSmartStorageApi, verifyStorageAuthorization } from "../src/_secondary/express/smartStorageEndpoints";
import { createSmartGateApi, mountSmartGateEndpoints } from "../src/_secondary/express/smartGateEndpoints";

function fixture(overrides: Record<string, any> = {}) {
  const key = Ed25519Keypair.generate();
  const session = { characterID: 140000001 };
  const state: any = { time: 1000, sessions: [session], calls: [], chainStatus: "synced", chainMax: "1000", error: null };
  const gate: any = { itemID: 50, typeID: 88086, name: "Source", solarSystemID: 1, assemblyStatus: 1, destinationGateID: 0, rangeLightYears: 10 };
  const destination: any = { ...gate, itemID: 51, name: "Destination", solarSystemID: 2 };
  const grid = () => ({ gate, destination: gate.destinationGateID ? destination : null, rangeLightYears: 10,
    candidates: [{ ...destination, distanceLightYears: 0.0000000000001, distanceMeters: "1000", eligible: !gate.destinationGateID, reason: gate.destinationGateID ? "SMART_GATE_ALREADY_LINKED" : null }] });
  const authDependencies = { now: () => state.time, getSessions: () => state.sessions,
    getCharacterID: (s: any) => s.characterID, getWallet: () => key.toSuiAddress(), verifySignature: verifyStorageAuthorization };
  const runtime = {
    getSmartGateLinkStatus(characterID: number, gateID: number) {
      state.calls.push({ action: "status", characterID, gateID });
      if (state.error) return { success: false, errorMsg: state.error, message: "private-detail" };
      return { success: true, data: gateID === 50 ? grid() : { ...grid(), gate: destination } };
    },
    linkSmartGates(current: any, gateID: number, destinationGateID: number) {
      state.calls.push({ action: "link", session: current, gateID, destinationGateID });
      gate.destinationGateID = destinationGateID; destination.destinationGateID = gateID;
      return { success: true };
    },
    unlinkSmartGate(current: any, gateID: number) {
      state.calls.push({ action: "unlink", session: current, gateID });
      gate.destinationGateID = 0; destination.destinationGateID = 0;
      return { success: true };
    },
  };
  const chain = async (request: any) => ({ ...request, status: state.chainStatus, synchronized: state.chainStatus === "synced",
    gateObjectID: `0x${request.gateID}`, linkedGateObjectID: gate.destinationGateID ? "0x51" : null, maxDistanceMeters: state.chainMax });
  const api = createSmartGateApi({ authDependencies, runtime, runMutation: operation => operation(), readChain: chain,
    flushChain: async request => { state.calls.push({ action: "flush" }); return chain(request); }, ...overrides });
  async function login(service: any = api) {
    const challenge = await service.challenge({ walletAddress: key.toSuiAddress() });
    const signature = (await key.signTransaction(await Transaction.from(challenge.data.transactionData).build())).signature;
    const result = await service.session({ challengeId: challenge.data.challengeId, signature });
    assert.equal(result.success, true);
    return `Bearer ${result.data.token}`;
  }
  return { api, state, gate, destination, grid, session, runtime, authDependencies, login, key };
}

test("gate wallet authorization has its own scope and rejects cross-API tokens and logout", async () => {
  const f = fixture();
  const challenge: any = await f.api.challenge({ walletAddress: f.key.toSuiAddress() });
  assert.match(challenge.data.message, /Smart Gate linking/);
  const stranger = Ed25519Keypair.generate();
  const signature = (await stranger.signTransaction(await Transaction.from(challenge.data.transactionData).build())).signature;
  assert.equal((await f.api.session({ challengeId: challenge.data.challengeId, signature }) as any).errorMsg, "INVALID_SIGNATURE");
  const storageToken = await f.login(createSmartStorageApi(f.authDependencies));
  assert.equal((await f.api.status(storageToken, 50) as any).errorMsg, "AUTH_EXPIRED");
  const token = await f.login();
  f.state.sessions = [];
  assert.equal((await f.api.link(token, 50, { destinationGateID: 51 }) as any).errorMsg, "CHARACTER_NOT_ONLINE");
  assert.equal(f.state.calls.length, 0);
});

test("gate links use authenticated identity, accept exact chain boundary and preserve different ranges", async () => {
  const f = fixture(); const token = await f.login();
  const result: any = await f.api.link(token, 50, { destinationGateID: 51, characterID: 999, maxDistanceMeters: "0" });
  assert.equal(result.success, true);
  assert.equal(result.data.gate.destinationGateID, 51);
  assert.equal(result.data.rangeLightYears, 10);
  assert.equal(result.data.chain.maxDistanceMeters, "1000");
  assert.equal(result.data.chain.status, "synced");
  assert.deepEqual(f.state.calls.find((c: any) => c.action === "link"), { action: "link", session: f.session, gateID: 50, destinationGateID: 51 });
  assert.equal(f.state.calls.filter((c: any) => c.action === "flush").length, 1);
});

test("gate API accepts a differing chain range and blocks unsynchronized targets before local mutation", async () => {
  const f = fixture(); const token = await f.login();
  f.state.chainMax = "999";
  assert.equal((await f.api.link(token, 50, { destinationGateID: 51 }) as any).success, true);
  await f.api.unlink(token, 50, { destinationGateID: 51 });
  f.state.calls = [];
  f.state.chainStatus = "pending";
  assert.equal((await f.api.link(token, 50, { destinationGateID: 51 }) as any).errorMsg, "SMART_GATE_CHAIN_PENDING");
  assert.equal(f.gate.destinationGateID, 0);
  assert.equal(f.state.calls.some((c: any) => c.action === "link"), false);
});

test("queued gate changes reauthenticate before mutation and stale unlinks do not clear another link", async () => {
  let resume: (() => void) | undefined;
  let enqueued: () => void;
  const queued = new Promise<void>(resolve => { enqueued = resolve; });
  const f = fixture({ runMutation: operation => new Promise(resolve => { resume = () => resolve(operation()); enqueued(); }) });
  const token = await f.login();
  const pending = f.api.link(token, 50, { destinationGateID: 51 });
  await queued; f.state.sessions = []; resume!();
  assert.equal((await pending as any).errorMsg, "CHARACTER_NOT_ONLINE");
  assert.equal(f.gate.destinationGateID, 0);
  const other = fixture(); const otherToken = await other.login();
  other.gate.destinationGateID = 52;
  assert.equal((await other.api.unlink(otherToken, 50, { destinationGateID: 51 }) as any).errorMsg, "ASSEMBLY_STATE_CHANGED");
  assert.equal(other.gate.destinationGateID, 52);
});

test("chain failure after local commit is recoverable without repeating link or unlink", async () => {
  const f = fixture({ flushChain: async () => { throw new Error("private-chain-detail"); } });
  const token = await f.login();
  const result: any = await f.api.link(token, 50, { destinationGateID: 51 });
  assert.equal(result.success, true);
  assert.equal(result.data.gate.destinationGateID, 51);
  assert.equal(result.data.chain.status, "error");
  assert.equal(JSON.stringify(result).includes("private-chain-detail"), false);
  await f.api.sync(token, 50);
  assert.equal(f.state.calls.filter((c: any) => c.action === "link").length, 1);
  const unlinked: any = await f.api.unlink(token, 50, { destinationGateID: 51 });
  assert.equal(unlinked.success, true); assert.equal(f.gate.destinationGateID, 0);
  assert.equal(f.destination.destinationGateID, 0); assert.equal(unlinked.data.chain.status, "error");
});

test("gate changes during chain reads invalidate preflight even if the new pair remains eligible", async () => {
  let gate: any;
  const f = fixture({ readChain: async (request: any) => {
    if (request.gateID === 51) gate.solarSystemID = 3;
    return { ...request, status: "synced", gateObjectID: `0x${request.gateID}`, linkedGateObjectID: null };
  } });
  gate = f.gate;
  const result: any = await f.api.link(await f.login(), 50, { destinationGateID: 51 });
  assert.equal(result.errorMsg, "ASSEMBLY_STATE_CHANGED");
  assert.equal(f.state.calls.some((call: any) => call.action === "link"), false);
});

test("slow chain flush reports pending while keeping an already committed gate link", async () => {
  const f = fixture({ chainWaitMs: 5, flushChain: () => new Promise(() => {}) });
  const result: any = await f.api.link(await f.login(), 50, { destinationGateID: 51 });
  assert.equal(result.success, true); assert.equal(result.data.chain.status, "pending");
  assert.equal(result.data.gate.destinationGateID, 51);
});

test("gate status checks ownership before chain reads and rejects malformed IDs", async () => {
  const f = fixture(); const token = await f.login();
  assert.equal((await f.api.status(undefined, 50) as any).errorMsg, "AUTH_REQUIRED");
  for (const id of [0, -1, 1.5, "01", "1e2", Number.MAX_SAFE_INTEGER + 1, null]) {
    assert.equal((await f.api.status(token, id) as any).errorMsg, "INVALID_ASSEMBLY_ID");
    assert.equal((await f.api.link(token, 50, { destinationGateID: id }) as any).errorMsg, "INVALID_ASSEMBLY_ID");
  }
  assert.equal(f.state.calls.length, 0);
  f.state.error = "ASSEMBLY_ACCESS_DENIED";
  assert.equal((await f.api.sync(token, 50) as any).errorMsg, "ASSEMBLY_ACCESS_DENIED");
  assert.equal(f.state.calls.some((c: any) => c.action === "flush"), false);
});

test("gate HTTP routes enforce origin, auth and no-store, and sanitize JSON errors", async () => {
  const express = require("express"); const app = express(); app.use(express.json({ limit: "64kb" }));
  const f = fixture(); mountSmartGateEndpoints(app, { api: f.api });
  const server = app.listen(0, "127.0.0.1"); await once(server, "listening");
  const base = `http://127.0.0.1:${server.address().port}/evejs/gates`;
  const headers = { "Content-Type": "application/json", Origin: "https://localhost", Authorization: await f.login() };
  try {
    const request = { method: "POST", headers, body: JSON.stringify({ destinationGateID: 51 }) };
    const linked = await fetch(`${base}/50/link`, request);
    assert.equal(linked.status, 200); assert.equal(linked.headers.get("cache-control"), "no-store");
    const unlinked = await fetch(`${base}/50/unlink`, request); assert.equal(unlinked.status, 200);
    const blocked = await fetch(`${base}/50/status`, { ...request, headers: { ...headers, Origin: "https://untrusted.invalid" } });
    assert.equal(blocked.status, 403); assert.equal(blocked.headers.get("access-control-allow-origin"), null);
    assert.equal((await fetch(`${base}/50/status`, { ...request, headers: { ...headers, Authorization: "" } })).status, 401);
    const malformed = await fetch(`${base}/50/link`, { ...request, body: "{private-marker" });
    assert.equal(malformed.status, 400); assert.equal((await malformed.text()).includes("private-marker"), false);
    assert.equal((await fetch(`${base}/50/link`, { method: "OPTIONS", headers: { Origin: "https://localhost" } })).status, 204);
  } finally { server.close(); await once(server, "close"); }
});
