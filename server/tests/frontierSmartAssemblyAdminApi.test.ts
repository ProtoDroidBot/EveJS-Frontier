import assert from "node:assert/strict";
import test from "node:test";
import { once } from "node:events";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { Transaction } from "@mysten/sui/transactions";
import { createSmartStorageApi, verifyStorageAuthorization } from "../src/_secondary/express/smartStorageEndpoints";
import { createSmartAssemblyAdminApi, mountSmartAssemblyAdminEndpoints } from "../src/_secondary/express/smartAssemblyAdminEndpoints";

const transactionUUID = "cbcd7c15-30cb-4a62-a3f8-54bf5092fe55";
const expected = { expectedAssemblyObjectID: "0x3", expectedPackageId: "0x1", expectedObjectRegistryId: "0x2" };
const signed = { transactionUUID, action: "online", bytes: "AAECAwQ=", signature: "wallet-signed-exact-sponsored-bytes" };

function fixture() {
  const key = Ed25519Keypair.generate();
  const walletAddress = key.toSuiAddress();
  const session = { characterID: 140000001 };
  const state: any = { time: 1000, sessions: [session], walletAddress, calls: [] };
  const authDependencies = {
    now: () => state.time, getSessions: () => state.sessions,
    getCharacterID: (value: any) => value.characterID, getWallet: () => state.walletAddress,
    verifySignature: verifyStorageAuthorization,
  };
  const dependencies: any = {
    authDependencies,
    callSuiAssemblyAdmin: async (method: string, request: any) => {
      state.calls.push({ method, request });
      return { success: true, data: { digest: "1".repeat(32), gameCommitted: true, replayed: false } };
    },
  };
  const api = createSmartAssemblyAdminApi(dependencies);
  async function login(service: any = api) {
    const challenge: any = await service.challenge({ walletAddress });
    const signature = (await key.signTransaction(await Transaction.from(challenge.data.transactionData).build())).signature;
    const authenticated: any = await service.session({ challengeId: challenge.data.challengeId, signature });
    assert.equal(authenticated.success, true);
    return `Bearer ${authenticated.data.token}`;
  }
  return { api, state, dependencies, authDependencies, key, walletAddress, session, login };
}

test("admin wallet authentication is scoped and cannot reuse storage tokens or challenges", async () => {
  const { api, authDependencies, walletAddress, key, state, login } = fixture();
  const challenge: any = await api.challenge({ walletAddress });
  assert.match(challenge.data.message, /Smart Assembly administration/);
  assert.match(challenge.data.message, /online or offline/);
  assert.match(challenge.data.message, /separate wallet signature/);
  const storage = createSmartStorageApi(authDependencies);
  const signature = (await key.signTransaction(await Transaction.from(challenge.data.transactionData).build())).signature;
  assert.equal((await storage.session({ challengeId: challenge.data.challengeId, signature }) as any).errorMsg, "AUTH_EXPIRED");
  const storageToken = await login(storage);
  assert.equal((await api.prepare(storageToken, 50, { action: "online", ...expected }) as any).errorMsg, "AUTH_EXPIRED");
  const token = await login();
  assert.equal((await api.prepare(token, 50, { action: "online", ...expected })).success, true);
  state.time += 30 * 60 * 1000;
  assert.equal((await api.prepare(token, 50, { action: "online", ...expected }) as any).errorMsg, "AUTH_EXPIRED");
});

test("admin preparation forwards only trusted identity and selected deployment fields", async () => {
  const { api, state, walletAddress, session, login } = fixture();
  const token = await login();
  const result = await api.prepare(token, "50", {
    action: "offline", ...expected, characterID: 999, walletAddress: "0x9", session: { characterID: 999 },
    assemblyID: 999, sponsorAddress: "0x9", tenant: "dev", assertAuthenticated: () => true,
  });
  assert.equal(result.success, true);
  const { method, request } = state.calls[0];
  assert.equal(method, "prepare");
  assert.deepEqual({ ...request, assertAuthenticated: undefined }, {
    assemblyID: 50, action: "offline", tenant: "dev", characterID: session.characterID, walletAddress, session,
    ...expected, assertAuthenticated: undefined,
  });
  assert.deepEqual(request.assertAuthenticated(), { characterID: session.characterID, walletAddress, session });
});

test("admin requests validate assembly IDs, actions, tenant, and required deployment before calling the bridge", async () => {
  const { api, state, login } = fixture();
  const token = await login();
  for (const id of [0, -1, 1.5, "1e2", "01", Number.MAX_SAFE_INTEGER + 1, "50/execute"]) {
    assert.equal((await api.prepare(token, id, { action: "online", ...expected }) as any).errorMsg, "INVALID_ASSEMBLY_ID");
  }
  for (const action of [undefined, "anchor", "destroy", "Online", true]) {
    assert.equal((await api.prepare(token, 50, { action, ...expected }) as any).errorMsg, "INVALID_ACTION");
  }
  assert.equal((await api.prepare(token, 50, { action: "online", tenant: "other", ...expected }) as any).errorMsg, "INVALID_TENANT");
  for (const field of Object.keys(expected)) {
    for (const value of [undefined, "", "object", "0x", "0x" + "1".repeat(65)]) {
      assert.equal((await api.prepare(token, 50, { action: "online", ...expected, [field]: value }) as any).errorMsg, "DEPLOYMENT_MISMATCH");
    }
  }
  assert.equal(state.calls.length, 0);
});

test("admin execution preserves exact wallet bytes and signature without altering sponsorship", async () => {
  const { api, state, walletAddress, session, login } = fixture();
  const token = await login();
  assert.equal((await api.execute(token, 50, { ...signed, characterID: 999, walletAddress: "0x9", sponsorAddress: "0x9", signatureVerified: true })).success, true);
  assert.deepEqual({ ...state.calls[0].request, assertAuthenticated: undefined }, {
    ...signed, assemblyID: 50, tenant: "dev", characterID: session.characterID, session, walletAddress, assertAuthenticated: undefined,
  });
  assert.equal(state.calls[0].method, "execute");
  assert.equal(Object.hasOwn(state.calls[0].request, "signatureVerified"), false);
});

test("admin execution rejects invalid UUIDs and unbounded wallet payloads before bridge invocation", async () => {
  const { api, state, login } = fixture();
  const token = await login();
  for (const patch of [
    { transactionUUID: "anything" }, { transactionUUID: null }, { bytes: undefined }, { bytes: [] }, { bytes: "" },
    { bytes: "A".repeat(256 * 1024 + 1) }, { signature: "" }, { signature: [] }, { signature: "A".repeat(16385) },
  ]) {
    assert.equal((await api.execute(token, 50, { ...signed, ...patch }) as any).errorMsg, "INVALID_TRANSACTION");
  }
  assert.equal(state.calls.length, 0);
});

test("admin pre-submit callback rechecks session expiry, logout, and changed wallet binding", async () => {
  for (const invalidate of [
    (state: any) => { state.time += 30 * 60 * 1000; },
    (state: any) => { state.sessions = []; },
    (state: any) => { state.walletAddress = Ed25519Keypair.generate().toSuiAddress(); },
  ]) {
    const { api, state, login } = fixture();
    const token = await login();
    await api.execute(token, 50, signed);
    const validate = state.calls[0].request.assertAuthenticated;
    assert.doesNotThrow(validate);
    invalidate(state);
    assert.throws(validate, (error: any) => ["AUTH_EXPIRED", "CHARACTER_NOT_ONLINE"].includes(error.code));
    assert.equal((await api.execute(token, 50, signed)).success, false);
    assert.equal(state.calls.length, 1);
  }
});

test("admin API sanitizes bridge failures while preserving only safe pending identifiers", async () => {
  const { state, dependencies, login } = fixture();
  dependencies.callSuiAssemblyAdmin = async () => ({ success: false, errorMsg: "TRANSACTION_PENDING", message: "secret", params: {
    transactionUUID, digest: "1".repeat(32), signerPrivateKey: "secret", stack: "secret",
  } });
  const api = createSmartAssemblyAdminApi(dependencies);
  const token = await login(api);
  const pending: any = await api.execute(token, 50, signed);
  assert.deepEqual(pending.params, { transactionUUID, digest: "1".repeat(32) });
  assert.equal(JSON.stringify(pending).includes("secret"), false);
  dependencies.callSuiAssemblyAdmin = async () => { throw new Error("secret filesystem and signer detail"); };
  const failing = createSmartAssemblyAdminApi({ ...dependencies, auth: { authenticate: () => ({ success: true, data: { characterID: 1, walletAddress: state.walletAddress } }) } });
  assert.deepEqual(await failing.execute(token, 50, signed), {
    success: false, errorMsg: "ADMIN_REQUEST_FAILED", message: "The assembly transaction could not be completed. Refresh the assembly and try again.",
  });
});

test("mounted admin routes enforce origin policy and auth, avoid caching, and sanitize parser failures", async () => {
  const express = require("express");
  const app = express();
  app.use(express.json({ limit: "1mb" }));
  const { api, walletAddress } = fixture();
  mountSmartAssemblyAdminEndpoints(app, { api });
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const base = `http://127.0.0.1:${server.address().port}/evejs/admin`;
  const request = { method: "POST", headers: { "Content-Type": "application/json", Origin: "https://localhost" }, body: JSON.stringify({ action: "online", ...expected }) };
  try {
    const blocked = await fetch(`${base}/50/prepare`, { ...request, headers: { ...request.headers, Origin: "https://untrusted.invalid" } });
    assert.equal(blocked.status, 403);
    assert.equal(blocked.headers.get("access-control-allow-origin"), null);
    const unauthenticated = await fetch(`${base}/50/prepare`, request);
    assert.equal(unauthenticated.status, 401);
    assert.equal(unauthenticated.headers.get("cache-control"), "no-store");
    assert.equal(unauthenticated.headers.get("access-control-allow-origin"), "https://localhost");
    assert.equal((await unauthenticated.json() as any).errorMsg, "AUTH_REQUIRED");
    const preflight = await fetch(`${base}/50/execute`, { method: "OPTIONS", headers: { Origin: "https://localhost" } });
    assert.equal(preflight.status, 204);
    assert.equal(preflight.headers.get("access-control-allow-methods"), "POST, OPTIONS");
    const challenge = await fetch(`${base}/auth/challenge`, { ...request, body: JSON.stringify({ walletAddress }) });
    assert.equal(challenge.status, 200);
    assert.match((await challenge.json() as any).data.message, /online or offline/);
    const malformed = await fetch(`${base}/50/prepare`, { ...request, body: "{private-marker" });
    assert.equal(malformed.status, 400);
    assert.equal(malformed.headers.get("cache-control"), "no-store");
    const error = await malformed.text();
    assert.equal(error.includes("private-marker"), false);
    assert.equal(JSON.parse(error).errorMsg, "INVALID_TRANSACTION");
  } finally { server.close(); await once(server, "close"); }
});
