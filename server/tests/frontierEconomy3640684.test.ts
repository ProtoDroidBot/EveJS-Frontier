"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const Database = require("better-sqlite3");
const database = require("../src/gameStore");
const { createTableRepository } = require("../src/gameStore/tableRepository");
const { Ed25519Keypair } = require("@mysten/sui/keypairs/ed25519");
const { createFrontierEconomyRuntime } = require("../src/services/frontier/frontierEconomyRuntime");
const { createDigitalChemistryRuntime } = require("../src/services/frontier/digitalChemistryRuntime");
const { getFrontierEconomyProtoRoot } = require("../src/_secondary/express/gatewayServices/frontierEconomyProto");
const { createFrontierEconomyGatewayService, routeGatewayEvent } = require("../src/_secondary/express/gatewayServices/frontierEconomyGatewayService");
const economyRepo = createTableRepository("service:frontier-economy", { strict: true });
const inventoryRepo = createTableRepository("service:inventory", { strict: true });
const characterRepo = createTableRepository("service:character", { strict: true });
for (const table of ["frontierEconomyState", "digitalChemistryState"]) economyRepo.ensureTable(table);
inventoryRepo.ensureTable("items"); characterRepo.ensureTable("characters");
const registry = require("../src/services/inventory/itemTypeRegistry");
const catalog = require("../src/services/frontier/data/economy3640684.json");
registry._setEntriesForTests([...catalog.types, { typeID: 990001, name: "Test cargo ship", categoryID: 6, groupID: 25, volume: 100, capacity: 100 }]);
const inventory = require("../src/services/inventory/itemStore");
const characterID = 140988771, shipID = 299988771, relayID = 299988772;
const signer = Ed25519Keypair.fromSecretKey(new Uint8Array(32).fill(7));
const wallet = signer.toSuiAddress();
const identity = { userID: 988771, characterID, currentSystemID: 30000001 };
characterRepo.write("characters", `/${characterID}`, { characterID, accountId: identity.userID, balance: 100, suiWalletAddress: wallet, shipID });
function writeItem(itemID, typeID, quantity, locationID = shipID, ownerID = characterID) {
  inventoryRepo.write("items", `/${itemID}`, inventory.buildInventoryItem({ itemID, typeID, quantity, stacksize: quantity, singleton: 0, ownerID, locationID, flagID: 5 }));
}
inventoryRepo.write("items", `/${shipID}`, inventory.buildInventoryItem({ itemID: shipID, typeID: 990001, singleton: 1, ownerID: characterID, locationID: 30000001, flagID: 0 }));
inventoryRepo.write("items", `/${relayID}`, inventory.buildInventoryItem({ itemID: relayID, typeID: 990001, singleton: 1, ownerID: characterID, locationID: 30000001, flagID: 0 }));
let atMs = 100000, capacity = 100;
const character = {
  getCharacterRecord: id => characterRepo.read("characters", `/${id}`).data,
  prepareCharacterBalanceAtomicWrite: (id, delta) => {
    const record = characterRepo.read("characters", `/${id}`).data, balance = Math.round((record.balance + delta) * 100) / 100;
    if (balance < 0) throw Object.assign(new Error("INSUFFICIENT_FUNDS"), { code: "INSUFFICIENT_FUNDS" });
    return { row: characterRepo.prepareAtomicRowWrite("characters", String(id), { ...record, balance }), previousBalance: record.balance, balance };
  },
};
const access = { characterID, sourceLocationIDs: [shipID, relayID], sourceFlagIDs: [5], accessibleLocationIDs: [], getDestinationCapacity: () => capacity };
const options = { repo: economyRepo, inventory, character, now: () => atMs, authorizeRelay: () => access, onInventoryChanged: () => {} };
const runtime = createFrontierEconomyRuntime(options);
const balance = () => Number(character.getCharacterRecord(characterID).balance);
const amount = value => ({ denom: "EVE", value: String(value) });
function decode(name, response) { return getFrontierEconomyProtoRoot().lookupType(name).decode(response.responsePayloadBuffer); }
function envelope(name, data, correlation = 1) { const type = getFrontierEconomyProtoRoot().lookupType(name); return { correlation_uuid: Buffer.alloc(16, correlation), payload: { type_url: name, value: type.encode(type.fromObject(data)).finish() } }; }

test("exact target economy descriptors retain every field number and width", () => {
  const root = getFrontierEconomyProtoRoot();
  for (const message of require("../src/_secondary/express/gatewayServices/economy3640684.proto.json").messages) {
    const type = root.lookupType(message.fullName);
    for (const field of message.fields) {
      const actual = type.fields[field.name];
      assert.equal(actual.id, field.number);
      assert.equal(actual.type.replace(/^\./, ""), (field.typeName || field.type.slice(5).toLowerCase()).replace(/^\./, ""));
      assert.equal(actual.repeated, field.label === "LABEL_REPEATED");
    }
  }
});

test("wallet reports acknowledge only server bindings; local token balances are separate from LUX", () => {
  assert.equal(runtime.getBalance(identity, wallet).value, "0");
  assert.equal(balance(), 100);
  assert.throws(() => runtime.getBalance(identity, "0x99"), /WALLET_IDENTITY_MISMATCH/);
  assert.throws(() => runtime.reportWallet({ ...identity, userID: 1 }, wallet), /CHARACTER_IDENTITY_MISMATCH/);
  const event = envelope("eve_public.wallet.api.Reported", { wallet_address: { hex: wallet } });
  assert.equal(routeGatewayEvent(event, identity, { frontierEconomyRuntime: runtime }).success, true);
  const forged = envelope("eve_public.wallet.api.Reported", { wallet_address: { hex: "0x99" } });
  assert.equal(routeGatewayEvent(forged, identity, { frontierEconomyRuntime: runtime }).success, false);
});

test("LUX exchange is idempotent and signature-bound inverse transfer commits once after restart", async () => {
  const initial = runtime.exchangeLUX(identity, wallet, { units: 10, nanos: 0 }, "exchange-1");
  assert.match(initial.transaction_hash, /^local:/); assert.equal(initial.token_amount.value, "10000000000"); assert.equal(balance(), 90);
  assert.deepEqual(runtime.exchangeLUX(identity, wallet, { units: 10, nanos: 0 }, "exchange-1"), initial); assert.equal(balance(), 90);
  assert.throws(() => runtime.exchangeLUX(identity, wallet, { units: 11 }, "exchange-1"), /IDEMPOTENCY_CONFLICT/);
  assert.throws(() => runtime.exchangeLUX(identity, wallet, { units: 1000 }, "too-much"), /INSUFFICIENT_FUNDS/);
  assert.throws(() => runtime.prepareToken(identity, wallet, amount("1")), /UNREPRESENTABLE/);
  const prepared = runtime.prepareToken(identity, wallet, amount("2000000000"));
  const parsed = require("@mysten/sui/transactions").TransactionDataBuilder.fromBytes(prepared.unsigned_transaction).snapshot();
  assert.deepEqual(parsed.commands, []); assert.deepEqual(parsed.gasData.payment, []);
  assert.equal(parsed.sender, wallet);
  assert.equal(JSON.parse(Buffer.from(parsed.inputs[0].Pure.bytes, "base64").toString()).format, "evejs-local-economy-intent-v1");
  const wrongSigner = Ed25519Keypair.fromSecretKey(new Uint8Array(32).fill(8));
  const wrong = await wrongSigner.signTransaction(prepared.unsigned_transaction);
  await assert.rejects(runtime.executeToken(identity, prepared.operation_id, wrong.signature), /INVALID_SIGNATURE/);
  const signed = await signer.signTransaction(prepared.unsigned_transaction);
  const restarted = createFrontierEconomyRuntime(options);
  const result = await restarted.executeToken(identity, prepared.operation_id, signed.signature);
  assert.equal(balance(), 92); assert.equal(runtime.getBalance(identity, wallet).value, "8000000000");
  assert.deepEqual(await restarted.executeToken(identity, prepared.operation_id, signed.signature), result); assert.equal(balance(), 92);
  const expiring = runtime.prepareToken(identity, wallet, amount("1000000000")); atMs += 300001;
  const signature = await signer.signTransaction(expiring.unsigned_transaction);
  await assert.rejects(runtime.executeToken(identity, expiring.operation_id, signature.signature), /TRANSACTION_EXPIRED/);
});

test("atomic inventory helper denies fractional/singleton/foreign/stale writes and rolls back every domain on SQL failure", () => {
  writeItem(299988780, 72244, 10);
  database.flushAllSync(); inventory.resetInventoryStoreForTests();
  const request = { ...access, consumptions: [{ itemID: 299988780, typeID: 72244, quantity: 2 }] };
  assert.equal(inventory.applyInventoryTransactionWithAtomicRows({ ...request, consumptions: [{ itemID: shipID, quantity: 1 }] }, []).success, false);
  assert.equal(inventory.applyInventoryTransactionWithAtomicRows({ ...request, consumptions: [{ itemID: 299988780, quantity: 0.1 }] }, []).success, false);
  assert.equal(inventory.applyInventoryTransactionWithAtomicRows({ ...request, sourceLocationIDs: [] }, []).success, false);
  const connection = new Database(database._sqliteDbPath);
  connection.exec("CREATE TRIGGER economy_atomic_failure BEFORE INSERT ON frontierEconomyState WHEN NEW.key='failure' BEGIN SELECT RAISE(ABORT,'failure'); END");
  const failed = inventory.applyInventoryTransactionWithAtomicRows(request, [economyRepo.prepareAtomicRowWrite("frontierEconomyState", "failure", { charged: true })]);
  assert.equal(failed.success, false); assert.equal(inventory.findItemById(299988780).quantity, 10);
  assert.equal(economyRepo.read("frontierEconomyState", "/failure").data, null);
  connection.exec("DROP TRIGGER economy_atomic_failure"); connection.close();
  assert.equal(inventory.applyInventoryTransactionWithAtomicRows({ ...request, consumptions: [{ itemID: 299988780, typeID: 72244, quantity: 10 }] }, []).success, true);
  assert.equal(inventory.findItemById(299988780), null);
  assert.equal(Object.values(inventory.getAllItems()).some(value => value === null), false);
});

test("signed lens purchase and feral-data sale persist inventory and matching balances together", async () => {
  const before = runtime.getBalance(identity, wallet).value;
  const prepared = runtime.prepareLens(identity, relayID, 2, { item: { sequential: shipID }, flag: { value: 5 } });
  const uuid = Buffer.from(prepared.prepared_transaction.uuid).toString("hex"); const op = `${uuid.slice(0,8)}-${uuid.slice(8,12)}-${uuid.slice(12,16)}-${uuid.slice(16,20)}-${uuid.slice(20)}`;
  const signed = await signer.signTransaction(Buffer.from(prepared.prepared_transaction_attributes.bcs_data_b64_bytes, "base64"));
  capacity = 0;
  await assert.rejects(runtime.executeLens(identity, op, signed.signature), /CARGO/);
  assert.equal(runtime.getBalance(identity, wallet).value, before);
  capacity = 10000;
  const receipt = await runtime.executeLens(identity, op, signed.signature);
  assert.equal(receipt.lens_items.length, 1);
  assert.equal(inventory.findItemById(receipt.lens_items[0].sequential).quantity, 2);
  assert.deepEqual(await runtime.executeLens(identity, op, signed.signature), receipt);
  writeItem(299988781, 72244, 4, relayID); database.flushAllSync(); inventory.resetInventoryStoreForTests();
  const lux = balance(); assert.equal(runtime.sellFeralData(identity, relayID, 299988781, 3), true);
  assert.equal(balance(), lux + 3); assert.equal(inventory.findItemById(299988781).quantity, 1);
  assert.throws(() => runtime.sellFeralData(identity, relayID, 299988781, 3), /INSUFFICIENT_ITEMS/);
  assert.equal(balance(), lux + 3);
});

test("target gateway decodes actual wallet/exchange messages and rejects official auth without provider", async () => {
  const gateway = createFrontierEconomyGatewayService({ clientBuild: 3640684, frontierEconomyRuntime: runtime, resolveGatewayIdentity: () => identity });
  const name = "eve_public.wallet.api.GetBalanceRequest";
  const response = gateway.handleRequest(name, envelope(name, { wallet: { hex: wallet } }));
  assert.equal(response.statusCode, 200); assert.equal(decode(name.replace("Request", "Response"), response).balance.value, runtime.getBalance(identity, wallet).value);
  assert.equal(gateway.handleRequest(name, envelope(name, { wallet: { hex: "0x99" } })).statusCode, 403);
  const auth = "eve_public.auth.zklogin.token.JWTTokenRequest";
  assert.equal(gateway.handleRequest(auth, envelope(auth, { nonce: "test" })).statusCode, 503);
  const exchange = "eve_public.token.exchange.api.ExchangeLUXToTokenRequest";
  const result = gateway.handleRequest(exchange, envelope(exchange, { wallet_address: wallet, lux_amount: { units: 1 } }, 22));
  assert.equal(result.statusCode, 200); assert.equal(decode(exchange.replace("Request", "Response"), result).token_amount.value, "1000000000");
});

test("authored chemistry recipe consumes atomically, validates slots and completes exactly once across restart", () => {
  writeItem(299988790, 96713, 10); writeItem(299988791, 96717, 20); database.flushAllSync(); inventory.resetInventoryStoreForTests();
  const notices = [], chemistryOptions = { repo: economyRepo, inventory, now: () => atMs, authorize: () => access,
    onInventoryChanged: () => {}, onCompleted: (session, job) => notices.push(job) };
  const chemistry = createDigitalChemistryRuntime(chemistryOptions), inputs = { 0: 299988790, 1: 299988791 };
  assert.deepEqual(chemistry.listRecipes(), [{ recipe_id: 2, name: "Basic Sand" }]);
  assert.throws(() => chemistry.preview({}, 2, inputs, 0.5), /FRACTIONAL/);
  assert.throws(() => chemistry.preview({}, 2, { 0: 299988790, 1: 299988790 }, 1), /SLOTS/);
  const preview = chemistry.preview({}, 2, inputs, 2); assert.equal(preview.duration, 20); assert.equal(preview.outputs[0].quantity, 2);
  assert.ok(preview.outputs[0].properties[2] >= 0.1 && preview.outputs[0].properties[2] <= 0.15);
  const job = chemistry.start({}, 2, inputs, shipID, 5, 2); assert.equal(job.state, 1);
  assert.equal(inventory.findItemById(299988790).quantity, 8); assert.equal(inventory.findItemById(299988791).quantity, 16);
  assert.equal(chemistry.getJobs({})[0].state, 1);
  atMs += 20001;
  const restarted = createDigitalChemistryRuntime(chemistryOptions), finished = restarted.getJobs({})[0];
  assert.equal(finished.state, 4); assert.equal(inventory.findItemById(finished.minted_item_ids[0]).typeID, 96030);
  assert.equal(inventory.findItemById(finished.minted_item_ids[0]).quantity, 2);
  assert.deepEqual(restarted.getJobs({})[0], finished); assert.equal(notices.length, 1);
  const variant = restarted.properties(inventory.findItemById(finished.minted_item_ids[0])); assert.deepEqual(variant, preview.outputs[0].properties);
  const cancel = restarted.start({}, 2, inputs, shipID, 5, 1);
  assert.equal(restarted.discontinue({}, cancel.recipe_job_id), true);
  assert.equal(restarted.discontinue({}, cancel.recipe_job_id), false);
  assert.equal(restarted.getJobs({})[1].state, 4);
  const connection = new Database(database._sqliteDbPath);
  const disk = JSON.parse(connection.prepare("SELECT json FROM digitalChemistryState WHERE key=?").get(`job:${job.recipe_job_id}`).json);
  assert.equal(disk.state, 4); connection.close();
});


test("character-owned balance proposals reject subcent, overdraft and stale commits", () => {
  const state = require("../src/services/character/characterState");
  const before = balance();
  assert.throws(() => state.prepareCharacterBalanceAtomicWrite(characterID, 0.001), /INVALID_CURRENCY/);
  assert.throws(() => state.prepareCharacterBalanceAtomicWrite(characterID, -100000), /INSUFFICIENT_FUNDS/);
  const proposal = state.prepareCharacterBalanceAtomicWrite(characterID, -1, before);
  const changed = characterRepo.read("characters", `/${characterID}`).data;
  characterRepo.write("characters", `/${characterID}`, { ...changed, balance: before + 1 });
  assert.equal(economyRepo.commitAtomicRowWrites([proposal.row]).errorMsg, "ATOMIC_WRITE_CONFLICT");
  const next = state.prepareCharacterBalanceAtomicWrite(characterID, -1, before + 1);
  assert.equal(economyRepo.commitAtomicRowWrites([next.row]).success, true);
  assert.equal(state.getCharacterRecord(characterID).balance, before);
});

test("chemistry native adapter emits numeric slot keys and the target error class", () => {
  const Service = require("../src/services/frontier/digitalChemistryService");
  const service = new Service({ listRecipes: () => [{ recipe_id: 2 }], preview: () => ({ outputs: { 0: { type_id: 96030 } } }) });
  const result = service.Handle_preview([], {});
  assert.equal(result.entries[0][1].entries[0][0], 0);
  const failing = new Service({ preview: () => { throw Object.assign(new Error("INPUT_NOT_ACCESSIBLE"), { code: "INPUT_NOT_ACCESSIBLE" }); } });
  assert.throws(() => failing.Handle_preview([], {}), error => {
    assert.equal(error.machoErrorResponse.payload.header[0].value, "frontier.digitalchemistry.common.errors.DigitalChemistryError"); return true;
  });
});
