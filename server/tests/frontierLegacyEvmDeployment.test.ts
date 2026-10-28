"use strict";

/** Run with scripts/Tests/run-isolated-tests.js against a disposable game store. */
const assert = require("node:assert/strict");
const test = require("node:test");
const reference = require("../src/services/_shared/referenceData");
const originalRows = reference.readStaticRows;
test.mock.method(reference, "readStaticRows", table => table === reference.TABLE.SPACE_COMPONENTS_BY_TYPE
  ? [{ typeID: 87119, smartDeployable: { createOnChain: 1, constructionCost: { 34: 1 } } },
    { typeID: 87161, smartDeployable: { createOnChain: 0, constructionCost: { 34: 1 } } }]
  : originalRows(table));
const itemStore = require("../src/services/inventory/itemStore");
const deployment = require("../src/services/frontier/deploymentRuntime");
const SESSION = { characterID: 140000003, solarsystemid2: 30000004 };

function assembly(changes: Record<string, any> = {}) {
  const { typeID = 87119, ownerID = SESSION.characterID, systemID = SESSION.solarsystemid2,
    status = 2, activationCompleteAtMs = 0 } = changes;
  return { itemID: 1001, typeID, ownerID, locationID: systemID,
    customInfo: JSON.stringify({ evejsFrontierConstruction: {
      assemblyTypeID: typeID, assemblyStatus: status, ownerID, solarSystemID: systemID, activationCompleteAtMs,
    } }) };
}

test.beforeEach(t => {
  deployment._testing.clearBuildDefinitionCache();
  deployment._testing.clearPendingAssemblyTransitions();
  t.mock.method(itemStore, "updateInventoryItem", () => assert.fail("A rejected relay must never mutate inventory"));
});

test("authorized relay entry preserves owner, system, construction and activation guards", t => {
  const cases = [
    [null, assembly(), 1, "ASSEMBLY_ACCESS_DENIED"],
    [{ ...SESSION, characterID: SESSION.characterID + 1 }, assembly(), 1, "ASSEMBLY_ACCESS_DENIED"],
    [{ ...SESSION, solarsystemid2: SESSION.solarsystemid2 + 1 }, assembly(), 1, "ASSEMBLY_NOT_IN_CURRENT_SYSTEM"],
    [SESSION, assembly(), 3, "INVALID_ASSEMBLY_STATE"],
    [SESSION, null, 1, "ASSEMBLY_NOT_FOUND"],
    [SESSION, assembly({ status: 5 }), 1, "ASSEMBLY_UNDER_CONSTRUCTION"],
    [SESSION, assembly({ activationCompleteAtMs: 1 }), 1, "ASSEMBLY_ACTIVATING"],
    [SESSION, assembly({ typeID: 87161 }), 1, "ASSEMBLY_NOT_CHAIN_ANCHORED"],
  ];
  for (const [session, item, targetStatus, error] of cases) {
    const mocked = t.mock.method(itemStore, "findItemById", () => item);
    assert.equal(deployment.requestAuthorizedAssemblyStateTransition(session, 1001, targetStatus).errorMsg, error);
    mocked.mock.restore();
  }
});

test("authorized relay entry revalidates ownership, system and source status between preparation and commit", t => {
  for (const [changed, expectedError] of [
    [assembly({ ownerID: SESSION.characterID + 1 }), "ASSEMBLY_ACCESS_DENIED"],
    [assembly({ systemID: SESSION.solarsystemid2 + 1 }), "ASSEMBLY_NOT_IN_CURRENT_SYSTEM"],
    [assembly({ status: 4 }), "ASSEMBLY_STATE_CHANGED"],
  ]) {
    let reads = 0;
    const mocked = t.mock.method(itemStore, "findItemById", () => ++reads === 1 ? assembly() : changed);
    const result = deployment.requestAuthorizedAssemblyStateTransition(SESSION, 1001, 1);
    assert.equal(result.success, false);
    assert.equal(result.errorMsg, expectedError);
    assert.equal(reads, 2);
    mocked.mock.restore();
  }
});

test("a signed legacy relay records a real Sui lifecycle intent once through the deployment runtime", async t => {
  const { secp256k1 } = require("@noble/curves/secp256k1.js");
  const { createLegacyEvmTypedData, evmKeccakHex, hashLegacyEvmTypedData } = require("../src/services/frontier/legacyEvmAuthorization");
  const { createLegacyEvmSuiBridge } = require("../src/services/frontier/legacyEvmSuiBridge");
  const suiState = require("../src/services/frontier/suiAssemblyState");
  const characterState = require("../src/services/character/characterState");
  const energy = require("../src/services/frontier/networkNodeEnergyRuntime");
  const space = require("../src/space/runtime");
  const now = 1700000000000;
  const ownerAddress = "0x7e5f4552091a69125d5dfcb7b8c2659029395bdf";
  const world = `0x${"11".repeat(20)}`;
  const system = `0x${"55".repeat(32)}`;
  const domain = { name: "ERC2771Forwarder", version: "1", chainId: 31337,
    verifyingContract: `0x${"22".repeat(20)}` };
  const word = (value: string | number) => BigInt(value).toString(16).padStart(64, "0");
  const selector = (signature: string) => evmKeccakHex(Buffer.from(signature)).slice(2, 10);
  const innerCall = selector("bringOffline(uint256)") + word(42);
  const data = "0x" + selector("callFrom(address,bytes32,bytes)") + ownerAddress.slice(2).padStart(64, "0") +
    system.slice(2) + word(96) + word(36) + innerCall.padEnd(128, "0");
  const typed = createLegacyEvmTypedData(domain, { from: ownerAddress, to: world, value: 0, gas: 1000000,
    nonce: `0x${"ab".repeat(32)}`, deadline: now / 1000 + 60, data });
  const signature = secp256k1.sign(hashLegacyEvmTypedData(typed), Buffer.from("01".padStart(64, "0"), "hex"),
    { prehash: false, format: "recovered" });
  const request = { sender: typed.message.from, address: typed.message.to, value: typed.message.value,
    gas: typed.message.gas, nonce: typed.message.nonce, deadline: typed.message.deadline, data,
    signature: `0x${Buffer.concat([signature.subarray(1), Buffer.from([signature[0] + 27])]).toString("hex")}` };
  const session = { ...SESSION, userid: 7 };
  let current = assembly(), mutations = 0, notifications = 0;
  const queued: number[] = [];
  const rows = new Map<string, any>();
  t.mock.method(Date, "now", () => now);
  t.mock.method(itemStore, "findItemById", (itemID: number) => itemID === 1001 ? current : null);
  t.mock.method(itemStore, "updateInventoryItem", (itemID: number, updater: (item: any) => any) => {
    assert.equal(itemID, 1001);
    const previousData = structuredClone(current);
    current = updater(structuredClone(current));
    mutations++;
    return { success: true, data: current, previousData };
  });
  t.mock.method(energy, "reconcileNetworkNodeEnergy", () => {});
  t.mock.method(characterState, "emitItemsChangedForSession", (candidate: any, item: any, previous: any) => {
    assert.equal(candidate, session);
    assert.equal(deployment.readConstructionState(previous).assemblyStatus, 2);
    assert.equal(deployment.readConstructionState(item).assemblyStatus, 1);
    notifications++;
  });
  const previousScene = space.scenes.get(SESSION.solarsystemid2);
  space.scenes.delete(SESSION.solarsystemid2);
  t.after(() => { if (previousScene) space.scenes.set(SESSION.solarsystemid2, previousScene); });
  t.after(suiState.registerSuiAssemblyStateRunner(async (itemID: number, operation: () => any) => {
    queued.push(itemID);
    return operation();
  }));
  const bridge = createLegacyEvmSuiBridge({ clientBuild: 2973163, now: () => now,
    config: {
      format: "evejs-legacy-evm-sui-v1", clientBuild: 2973163, tenant: "dev", domain, worldAddress: world,
      accounts: { "7": { evmAddress: ownerAddress } }, objects: { "42": 1001 },
      systems: { bringOffline: { systemId: system } },
    },
    character: { getCharacterRecord: (id: number) => id === SESSION.characterID ? { accountId: 7 } : null },
    repo: {
      ensureTable: () => ({ success: true }),
      read: (_table: string, key: string) => rows.has(key.slice(1))
        ? { success: true, data: structuredClone(rows.get(key.slice(1))) }
        : { success: false, errorMsg: "ENTRY_NOT_FOUND" },
      prepareAtomicRowWrite: (_table: string, key: string, value: any) => ({ key, value: structuredClone(value) }),
      commitAtomicRowWrites: (writes: any[]) => { writes.forEach(write => rows.set(write.key, write.value)); return { success: true }; },
      flushTableSync: () => ({ success: true }),
    },
  });
  const accepted = await bridge.relay(request, session);
  assert.equal(accepted.success, true);
  assert.equal(accepted.replayed, false);
  assert.equal(deployment.readConstructionState(current).assemblyStatus, 1);
  const intent = suiState.readSuiAssemblyStatusIntent(current);
  assert.equal(intent.targetStatus, 1);
  assert.match(intent.id, /^[0-9a-f-]{36}$/);
  assert.equal([...rows.values()][0].status, "accepted");
  assert.equal((await bridge.relay(request, session)).replayed, true);
  assert.deepEqual(suiState.readSuiAssemblyStatusIntent(current), intent);
  assert.equal(mutations, 1);
  assert.equal(notifications, 1);
  assert.deepEqual(queued, [1001]);
});
