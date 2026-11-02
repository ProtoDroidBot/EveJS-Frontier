import assert from "node:assert/strict";
import test from "node:test";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import {
  createLegacyEvmSuiBridge, decodeLegacyEvmLifecycleCall,
} from "../src/services/frontier/legacyEvmSuiBridge";
import {
  createLegacyEvmTypedData, evmKeccakHex, hashLegacyEvmTypedData,
  type LegacyEvmDomain,
} from "../src/services/frontier/legacyEvmAuthorization";
import { deriveLegacyEvmSmartObjectID } from "../src/services/frontier/legacyEvmClientConfig";

const OWNER = "0x7e5f4552091a69125d5dfcb7b8c2659029395bdf";
const OTHER = "0x2b5ad5c4795c026514f8317c7a215e218dccd6cf";
const WORLD = "0x" + "11".repeat(20);
const SYSTEM = "0x" + "55".repeat(32);
const OBJECT = deriveLegacyEvmSmartObjectID("dev", 1001, 2973163);
const DOMAIN: LegacyEvmDomain = { name: "ERC2771Forwarder", version: "1", chainId: 31337,
  verifyingContract: "0x" + "22".repeat(20) };
const KEY = Buffer.from("01".padStart(64, "0"), "hex");
const SECOND_KEY = Buffer.from("02".padStart(64, "0"), "hex");
const NOW = 1700000000000;
const selector = (name: string) => evmKeccakHex(Buffer.from(name)).slice(2, 10);
const word = (value: string | number | bigint) => BigInt(value).toString(16).padStart(64, "0");

function lifecycleCall(options: Record<string, any> = {}) {
  const inner = selector(options.function || "bringOnline(uint256)") + word(options.objectID ?? OBJECT);
  return "0x" + selector("callFrom(address,bytes32,bytes)") +
    (options.delegator || OWNER).slice(2).padStart(64, "0") +
    (options.systemID || SYSTEM).slice(2) + word(96) + word(36) + inner.padEnd(128, "0");
}

function signedRequest(changes: Record<string, any> = {}, signingKey = KEY) {
  const typed = createLegacyEvmTypedData(DOMAIN, { from: OWNER, to: WORLD, value: "0", gas: "1000000",
    nonce: "0x" + "ab".repeat(32), deadline: String(NOW / 1000 + 60), data: lifecycleCall(), ...changes });
  const signature = secp256k1.sign(hashLegacyEvmTypedData(typed), signingKey,
    { prehash: false, format: "recovered" });
  return { sender: typed.message.from, address: typed.message.to,
    value: typed.message.value, gas: typed.message.gas, nonce: typed.message.nonce,
    deadline: typed.message.deadline, data: typed.message.data,
    signature: "0x" + Buffer.concat([signature.subarray(1), Buffer.from([signature[0] + 27])]).toString("hex") };
}

function repository() {
  const rows: Record<string, any> = {};
  let writeFailure = false;
  return {
    rows,
    setWriteFailure(value: boolean) { writeFailure = value; },
    ensureTable: () => ({ success: true }),
    read: (_table: string, path: string) => Object.hasOwn(rows, path.slice(1))
      ? { success: true, data: structuredClone(rows[path.slice(1)]) }
      : { success: false, errorMsg: "ENTRY_NOT_FOUND", data: null },
    prepareAtomicRowWrite: (_table: string, key: string, value: any) => ({ key, value: structuredClone(value) }),
    commitAtomicRowWrites(tokens: any[]) {
      if (writeFailure) return { success: false };
      for (const token of tokens) rows[token.key] = token.value;
      return { success: true };
    },
    flushTableSync: () => ({ success: true }),
  };
}

function fixture(overrides: Record<string, any> = {}) {
  const repo = repository();
  const session = { userid: 7, characterID: 42 };
  const calls: any[] = [], stateReads: number[] = [];
  const config = {
    format: "evejs-legacy-evm-sui-v1", clientBuild: 2973163, tenant: "dev",
    domain: DOMAIN, worldAddress: WORLD,
    accounts: { "7": { evmAddress: OWNER, walletPassphrase: "fixture-passphrase" } },
    objects: { [OBJECT]: 1001 },
    systems: { bringOnline: { systemId: SYSTEM }, bringOffline: { systemId: SYSTEM } },
    web3Config: { cfg: [], systems: [], system_ids: { transfer: SYSTEM } },
    worldApiBaseUrl: "http://127.0.0.1:3000/legacy-evm",
  };
  const options = {
    config, clientBuild: 2973163, repo, now: () => NOW,
    character: { getCharacterRecord: (id: number) => [42, 43].includes(id) ? { accountId: 7 } : null },
    bootstrap: { getWalletBinding: () => null, characterExists: async () => true },
    isSuiAuthoritative: () => true,
    runWithState: async (itemID: number, operation: () => any) => { stateReads.push(itemID); return operation(); },
    deployment: { requestAuthorizedAssemblyStateTransition(candidate: any, itemID: number, targetStatus: number) {
      calls.push({ session: { ...candidate }, itemID, targetStatus }); return { success: true };
    } },
    ...overrides,
  };
  return { repo, session, config, calls, stateReads, options, bridge: createLegacyEvmSuiBridge(options) };
}

test("signed ERC2771 lifecycle calls reach the Sui authority once across concurrency and durable restart", async () => {
  const f = fixture(), request = signedRequest();
  const [first, duplicate] = await Promise.all([f.bridge.relay(request, f.session), f.bridge.relay(request, f.session)]);
  assert.deepEqual(first, { success: true, replayed: false, itemID: 1001, pending: true });
  assert.deepEqual(duplicate, { ...first, replayed: true });
  assert.deepEqual(f.calls, [{ session: f.session, itemID: 1001, targetStatus: 2 }]);
  assert.deepEqual(f.stateReads, [1001]);
  assert.equal(Object.values<any>(f.repo.rows)[0].status, "accepted");
  const restarted = createLegacyEvmSuiBridge(f.options);
  assert.equal((await restarted.relay(request, f.session)).replayed, true);
  assert.equal(f.calls.length, 1);
});

test("a valid signer cannot reuse a nonce to authorize a different call or character", async () => {
  const f = fixture();
  await f.bridge.relay(signedRequest(), f.session);
  await assert.rejects(f.bridge.relay(signedRequest({ data: lifecycleCall({ function: "bringOffline(uint256)" }) }), f.session),
    /LEGACY_EVM_NONCE_CONFLICT/);
  await assert.rejects(f.bridge.relay(signedRequest(), { ...f.session, characterID: 43 }), /LEGACY_EVM_NONCE_CONFLICT/);
  assert.equal(f.calls.length, 1);
});

test("hex and decimal representations of the same nonce share one durable replay entry", async () => {
  const f = fixture();
  const nonce = "0x" + "cd".repeat(32);
  const hexRequest = signedRequest({ nonce });
  hexRequest.nonce = nonce;
  assert.equal((await f.bridge.relay(hexRequest, f.session)).replayed, false);
  const decimalRequest = signedRequest({ nonce: BigInt(nonce).toString() });
  assert.equal((await createLegacyEvmSuiBridge(f.options).relay(decimalRequest, f.session)).replayed, true);
  assert.equal(Object.keys(f.repo.rows).length, 1);
  assert.equal(f.calls.length, 1);
});

test("only the server-bound wallet and authenticated character account may relay", async () => {
  const f = fixture();
  await assert.rejects(f.bridge.relay(signedRequest({ from: OTHER }, SECOND_KEY), f.session), /INVALID_LEGACY_EVM_SIGNATURE/);
  await assert.rejects(f.bridge.relay(signedRequest({}, SECOND_KEY), f.session), /INVALID_LEGACY_EVM_SIGNATURE/);
  for (const session of [null, {}, { userid: 8, characterID: 42 }, { userid: 7, characterID: 99 },
    { userid: 7, characterID: 42, _characterControlDisconnected: true }]) {
    await assert.rejects(f.bridge.relay(signedRequest(), session));
  }
  assert.equal(f.calls.length, 0);
  assert.equal(Object.keys(f.repo.rows).length, 0);
});

test("missing wallet binding or Sui authority never falls back to a local accepted relay", async () => {
  const noWallet = fixture({ config: { ...fixture().config, accounts: { "8": { evmAddress: OTHER } } } });
  await assert.rejects(noWallet.bridge.relay(signedRequest(), noWallet.session), /LEGACY_EVM_WALLET_BINDING_UNAVAILABLE/);
  const offline = fixture({ isSuiAuthoritative: () => false });
  await assert.rejects(offline.bridge.relay(signedRequest(), offline.session), /ASSEMBLY_STATE_UNAVAILABLE/);
  assert.equal(offline.calls.length, 0);
  assert.equal(Object.keys(offline.repo.rows).length, 0);
  const noCharacter = fixture({ bootstrap: { getWalletBinding: () => null, characterExists: async () => false } });
  await assert.rejects(noCharacter.bridge.relay(signedRequest(), noCharacter.session), /LEGACY_EVM_SUI_CHARACTER_UNAVAILABLE/);
  assert.equal(noCharacter.calls.length, 0);
  assert.equal(Object.keys(noCharacter.repo.rows).length, 0);
});

test("the adapter accepts only mapped lifecycle objects, selectors, system IDs and delegators", async () => {
  const f = fixture();
  assert.throws(() => fixture({ config: { ...f.config, objects: { [OBJECT]: 1002 } } }),
    /INVALID_LEGACY_EVM_OBJECT_MAPPING/);
  const invalid = [
    [lifecycleCall({ objectID: BigInt(OBJECT) + 1n }), /LEGACY_EVM_OBJECT_NOT_MAPPED/],
    [lifecycleCall({ function: "destroy(uint256)" }), /UNSUPPORTED_LEGACY_EVM_CALL/],
    [lifecycleCall({ systemID: "0x" + "66".repeat(32) }), /UNSUPPORTED_LEGACY_EVM_CALL/],
    [lifecycleCall({ delegator: OTHER }), /LEGACY_EVM_CALL_MISMATCH/],
    [lifecycleCall() + "00", /LEGACY_EVM_CALL_MISMATCH/],
    ["0x12345678", /LEGACY_EVM_CALL_MISMATCH/],
  ] as const;
  for (const [data, error] of invalid) await assert.rejects(f.bridge.relay(signedRequest({ data }), f.session), error);
  assert.deepEqual(decodeLegacyEvmLifecycleCall(lifecycleCall(), OWNER, f.config.systems),
    { action: "bringOnline", targetStatus: 2, objectID: OBJECT });
  assert.equal(f.calls.length, 0);
  assert.equal(Object.keys(f.repo.rows).length, 0);
});

test("value transfers and signatures for different deployments are never relayed", async () => {
  const f = fixture();
  await assert.rejects(f.bridge.relay(signedRequest({ value: "1" }), f.session), /UNSUPPORTED_LEGACY_EVM_VALUE/);
  await assert.rejects(f.bridge.relay(signedRequest({ to: OTHER }), f.session), /INVALID_LEGACY_EVM_SIGNATURE/);
  await assert.rejects(f.bridge.relay(signedRequest({ deadline: String(NOW / 1000 - 1) }), f.session), /INVALID_LEGACY_EVM_SIGNATURE/);
  assert.equal(f.calls.length, 0);
});

test("journal write failure prevents mutation and a later durable retry can proceed", async () => {
  const f = fixture();
  f.repo.setWriteFailure(true);
  await assert.rejects(f.bridge.relay(signedRequest(), f.session), /LEGACY_EVM_JOURNAL_UNAVAILABLE/);
  assert.equal(f.calls.length, 0);
  assert.equal(Object.keys(f.repo.rows).length, 0);
  f.repo.setWriteFailure(false);
  assert.equal((await f.bridge.relay(signedRequest(), f.session)).success, true);
  assert.equal(f.calls.length, 1);
});

test("journal read failures are distinguished from a missing nonce", async () => {
  const f = fixture();
  f.repo.read = () => ({ success: false, errorMsg: "DATABASE_UNAVAILABLE", data: null });
  await assert.rejects(f.bridge.relay(signedRequest(), f.session), /LEGACY_EVM_JOURNAL_UNAVAILABLE/);
  assert.equal(f.calls.length, 0);
});

test("a failed receipt write leaves the started intent durable and blocks mutation replay", async () => {
  const f = fixture();
  const commit = f.repo.commitAtomicRowWrites;
  let writes = 0;
  f.repo.commitAtomicRowWrites = tokens => ++writes === 2 ? { success: false } : commit(tokens);
  const request = signedRequest();
  await assert.rejects(f.bridge.relay(request, f.session), /LEGACY_EVM_JOURNAL_UNAVAILABLE/);
  assert.equal(f.calls.length, 1);
  assert.equal(Object.values<any>(f.repo.rows)[0].status, "started");
  await assert.rejects(createLegacyEvmSuiBridge(f.options).relay(request, f.session), /LEGACY_EVM_RELAY_RECONCILIATION_REQUIRED/);
  assert.equal(f.calls.length, 1);
});

test("a character switch while awaiting Sui state invalidates the original authorization", async () => {
  const f = fixture();
  f.options.runWithState = async (_itemID, operation) => {
    f.session.characterID = 43;
    return operation();
  };
  const bridge = createLegacyEvmSuiBridge(f.options);
  await assert.rejects(bridge.relay(signedRequest(), f.session), /CHARACTER_IDENTITY_MISMATCH/);
  assert.equal(f.calls.length, 0);
});

test("Sui authority and signature expiry are rechecked after awaiting chain state", async () => {
  for (const change of ["authority", "expiry"]) {
    let authoritative = true, now = NOW;
    const f = fixture({ isSuiAuthoritative: () => authoritative, now: () => now,
      runWithState: async (_itemID, operation) => {
        if (change === "authority") authoritative = false;
        else now = NOW + 61000;
        return operation();
      } });
    await assert.rejects(f.bridge.relay(signedRequest(), f.session),
      change === "authority" ? /ASSEMBLY_STATE_UNAVAILABLE/ : /INVALID_LEGACY_EVM_SIGNATURE/);
    assert.equal(f.calls.length, 0);
    assert.equal(Object.values<any>(f.repo.rows)[0].status, "started");
  }
});

test("an interrupted or rejected relay requires reconciliation and cannot repeat a possible mutation", async () => {
  for (const failure of ["throw", "reject"]) {
    let calls = 0;
    const f = fixture({ deployment: { requestAuthorizedAssemblyStateTransition() {
      calls++;
      if (failure === "throw") throw new Error("fixture worker interrupted");
      return { success: false, errorMsg: "ASSEMBLY_ACCESS_DENIED" };
    } } });
    const request = signedRequest();
    await assert.rejects(f.bridge.relay(request, f.session), failure === "throw" ? /fixture worker interrupted/ : /ASSEMBLY_ACCESS_DENIED/);
    assert.equal(Object.values<any>(f.repo.rows)[0].status, failure === "throw" ? "started" : "rejected");
    await assert.rejects(createLegacyEvmSuiBridge(f.options).relay(request, f.session), /LEGACY_EVM_RELAY_RECONCILIATION_REQUIRED/);
    assert.equal(calls, 1);
  }
});

test("client credentials are selected from the authenticated account", () => {
  const f = fixture();
  assert.deepEqual(f.bridge.getClientConfiguration(f.session), { web3Config: f.config.web3Config,
    tenant: "dev", worldApiBaseUrl: f.config.worldApiBaseUrl, walletPassphrase: "fixture-passphrase" });
  assert.throws(() => f.bridge.getClientConfiguration({ userid: 8, characterID: 42 }), /CHARACTER_IDENTITY_MISMATCH/);
  for (const clientBuild of [3640684, 2455426, 3502403]) {
    assert.throws(() => fixture({ clientBuild }), /Unsupported EVM client build/);
  }
});
