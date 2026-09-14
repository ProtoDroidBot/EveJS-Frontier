import assert from "node:assert/strict";
import test from "node:test";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { Transaction } from "@mysten/sui/transactions";
import { createSmartStorageApi, verifyStorageAuthorization } from "../src/_secondary/express/smartStorageEndpoints";

const itemStore = require("../src/services/inventory/itemStore");
const runtime = require("../src/services/frontier/smartStorageUnitRuntime");
const OWNER_ID = 140000003;
const SYSTEM_ID = 30000004;
const MATERIAL_TYPE_ID = 78423;

function grant(location: number, flag: number, typeID: number, quantity: number, options?: any) {
  const result = itemStore.grantItemsToCharacterLocation(OWNER_ID, location, flag, [{ itemType: typeID, quantity, options }]);
  assert.equal(result.success, true, result.errorMsg);
  return result.data.items[0];
}

function quantity(location: number, flag: number) {
  return itemStore.listContainerItems(OWNER_ID, location, flag)
    .filter((item: any) => Number(item.typeID) === MATERIAL_TYPE_ID)
    .reduce((sum: number, item: any) => sum + Number(item.stacksize ?? item.quantity), 0);
}

test("wallet-authorized API deposits and withdraws real persisted stacks exactly once", async () => {
  runtime._testing.clearTransactions();
  runtime._testing.clearStorageComponentCache();
  const ship = grant(SYSTEM_ID, 0, 95276, 1, { individualItems: true, singleton: 1 });
  const unit = grant(SYSTEM_ID, 0, 77917, 1, { individualItems: true, singleton: 1 });
  const update = itemStore.updateInventoryItem(unit.itemID, (item: any) => ({ ...item, customInfo: JSON.stringify({
    evejsFrontierConstruction: {
      assemblyStatus: 2, assemblyTypeID: 77917, completedAtMs: 1, createdAtMs: 1,
      ownerID: OWNER_ID, solarSystemID: SYSTEM_ID,
    },
  }) }));
  assert.equal(update.success, true, update.errorMsg);
  const material = grant(ship.itemID, 5, MATERIAL_TYPE_ID, 5);
  const key = Ed25519Keypair.generate();
  const address = key.toSuiAddress();
  const session = { characterID: OWNER_ID };
  const notices: any[] = [];
  const api = createSmartStorageApi({
    runtime, getSessions: () => [session], getCharacterID: (value: any) => value.characterID,
    getWallet: () => address,
    getDeployment: () => ({ network: "localnet", chainId: "abcd", packageId: "0x1", objectRegistryId: "0x2", assemblyObjectID: "0x3" }),
    resolveAccess: () => ({ authorized: true, activeShipID: ship.itemID, solarSystemID: SYSTEM_ID, inRange: true }),
    readCargo: () => ({ shipID: ship.itemID, capacity: 1000, usedVolume: quantity(ship.itemID, 5) * 0.1, items: [] }),
    readChain: async () => ({ status: "disabled" }), flushChain: async () => ({ status: "pending" }),
    verifySignature: verifyStorageAuthorization, notify: (_session: any, result: any) => notices.push(result),
  });
  async function sign(data: string, signer = key) { return (await signer.signTransaction(await Transaction.from(data).build())).signature; }
  const challenge: any = await api.challenge({ walletAddress: address });
  const connected: any = await api.session({ challengeId: challenge.data.challengeId, signature: await sign(challenge.data.transactionData) });
  assert.equal(connected.success, true);
  const authorization = `Bearer ${connected.data.token}`;
  const deposit: any = await api.prepare(authorization, unit.itemID, { direction: "deposit", expectedAssemblyObjectID: "0x3", stacks: [{ itemID: material.itemID, quantity: 3 }] });
  assert.equal(deposit.success, true, deposit.errorMsg);
  const body = { direction: "deposit", transactionUUID: deposit.data.transactionUUID, signature: await sign(deposit.data.transactionData) };
  const forged: any = await api.execute(authorization, unit.itemID, { ...body, signature: await sign(deposit.data.transactionData, Ed25519Keypair.generate()) });
  assert.equal(forged.errorMsg, "INVALID_SIGNATURE");
  assert.equal(quantity(ship.itemID, 5), 5);
  const executed: any = await api.execute(authorization, unit.itemID, body);
  assert.equal(executed.success, true, executed.errorMsg);
  assert.equal(executed.data.gameCommitted, true);
  assert.equal(executed.data.chain.status, "pending");
  assert.equal(quantity(ship.itemID, 5), 2);
  assert.equal(quantity(unit.itemID, 66), 3);
  assert.equal((await api.execute(authorization, unit.itemID, body) as any).data.replayed, true);
  assert.equal(quantity(unit.itemID, 66), 3);
  const withdraw: any = await api.prepare(authorization, unit.itemID, { direction: "withdraw", expectedAssemblyObjectID: "0x3", stacks: [{ typeID: MATERIAL_TYPE_ID, quantity: 1 }] });
  assert.equal(withdraw.success, true, withdraw.errorMsg);
  const withdrawn: any = await api.execute(authorization, unit.itemID, { direction: "withdraw", transactionUUID: withdraw.data.transactionUUID, signature: await sign(withdraw.data.transactionData) });
  assert.equal(withdrawn.success, true, withdrawn.errorMsg);
  assert.equal(quantity(ship.itemID, 5), 3);
  assert.equal(quantity(unit.itemID, 66), 2);
  assert.equal(notices.length, 2);
  const inventory: any = await api.inventory(authorization, unit.itemID);
  assert.equal(inventory.success, true, inventory.errorMsg);
  assert.equal(inventory.data.items[0].quantity, 2);
});
