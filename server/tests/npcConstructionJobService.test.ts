"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const database = require("../src/gameStore");
const itemStore = require("../src/services/inventory/itemStore");
const itemTypeRegistry = require("../src/services/inventory/itemTypeRegistry");
const nativeStore = require("../src/space/npc/nativeNpcStore");
const persistence = require("../src/space/npc/npcRuntimePersistence");
const behaviorRuntime = require("../src/space/npc/npcBehaviorTreeRuntime");
const actorContext = require("../src/space/npc/npcAssemblyActorContext");
const construction = require("../src/space/npc/npcConstructionJobService");
const membershipReceipts = require("../src/space/npc/npcTransponderMembership");
const suiTransponders = require("../src/services/frontier/suiTransponderCommitment");

const TABLES = [
  "npcRuntimeState", "npcEntities", "npcModules", "npcCargo",
  "npcRuntimeControllers", "npcPilotIdentities", "npcWrecks", "npcWreckItems",
];
const ENTITY_ID = 980000000931;
const NPC_ID = 1500000931;
const OWNER_ID = 500931;
const SYSTEM_ID = 30000004;
const MATERIAL_TYPE_ID = 990931;
const ASSEMBLY_TYPE_ID = 990932;
const PORTABLE_ASSEMBLY_TYPE_ID = 87161;
const NETWORK_NODE_TYPE_ID = 88092;

function fixture(t) {
  const backupTables = Object.fromEntries(TABLES.map((table) => [
    table,
    structuredClone(database.read(table, "/").data),
  ]));
  const backupItems = structuredClone(itemStore.getAllItems());
  database.write("npcRuntimeState", "/", {}, { force: true });
  database.write("npcEntities", "/", { nextEntityID: 980000000000, entities: {} }, { force: true });
  database.write("npcModules", "/", { nextModuleID: 980100000000, modules: {} }, { force: true });
  database.write("npcCargo", "/", { nextCargoID: 980200000000, cargo: {} }, { force: true });
  database.write("npcRuntimeControllers", "/", { controllers: {} }, { force: true });
  database.write("npcWrecks", "/", { nextWreckID: 980300000000, wrecks: {} }, { force: true });
  database.write("npcWreckItems", "/", { nextWreckItemID: 980400000000, items: {} }, { force: true });
  database.write("npcPilotIdentities", "/", {
    version: 1,
    nextCharacterID: NPC_ID + 1,
    pilots: {
      [NPC_ID]: {
        characterID: NPC_ID,
        characterName: "Phase Three Builder",
        factionKey: "500001-serpentis",
        factionID: 500001,
        factionStringOnlyID: "serpentis",
        systemID: SYSTEM_ID,
        identitySlot: "phase3:test",
        slotKey: "phase3-test-slot",
        profileID: "phase3-builder",
        activeEntityID: ENTITY_ID,
        incarnation: 1,
        deaths: 0,
        createdAtMs: 1,
        updatedAtMs: 1,
        sui: {
          status: "confirmed",
          walletAddress: `0x${"1".repeat(64)}`,
          characterObjectId: `0x${"2".repeat(64)}`,
          npcProfileObjectId: `0x${"3".repeat(64)}`,
        },
      },
    },
    slots: { "phase3-test-slot": NPC_ID },
    factions: {
      "500001-serpentis": {
        factionKey: "500001-serpentis",
        factionID: 500001,
        factionStringOnlyID: "serpentis",
      },
    },
  }, { force: true });
  database.flushTablesSync(TABLES);
  persistence._testing.resetRuntimeForTests();
  itemStore.resetInventoryStoreForTests();
  itemStore._writeItemsForTest({}, { force: true });
  itemTypeRegistry._setEntriesForTests([{
    typeID: MATERIAL_TYPE_ID,
    groupID: 450,
    categoryID: 25,
    name: "Construction Material",
    volume: 1,
  }]);
  assert.equal(nativeStore.upsertNativeEntity({
    entityID: ENTITY_ID,
    systemID: SYSTEM_ID,
    typeID: 587,
    groupID: 25,
    categoryID: 6,
    ownerID: OWNER_ID,
    npcCharacterID: NPC_ID,
    npcIncarnation: 1,
    nativeNpc: true,
    transient: false,
  }, { durable: true }).success, true);
  assert.equal(nativeStore.upsertNativeController({
    entityID: ENTITY_ID,
    systemID: SYSTEM_ID,
    npcCharacterID: NPC_ID,
    npcIncarnation: 1,
    transient: false,
  }, { durable: true }).success, true);
  const material = itemStore.grantItemToOwnerLocation(
    OWNER_ID,
    ENTITY_ID,
    itemStore.ITEM_FLAGS.CARGO_HOLD,
    MATERIAL_TYPE_ID,
    5,
    { singleton: 0 },
  ).data.items[0];
  assert.equal(nativeStore.upsertNativeCargo({
    cargoID: material.itemID,
    entityID: ENTITY_ID,
    ownerID: OWNER_ID,
    moduleID: 0,
    typeID: MATERIAL_TYPE_ID,
    groupID: 450,
    categoryID: 25,
    itemName: "Construction Material",
    quantity: 5,
    singleton: false,
    semanticRole: "resource",
    transient: false,
  }, { durable: true }).success, true);
  database.flushTablesSync([...TABLES, itemStore.ITEMS_TABLE]);
  persistence.initializeNpcRuntimePersistence({ reconcile: false });
  t.after(() => {
    itemStore._writeItemsForTest(backupItems, { force: true });
    for (const [table, value] of Object.entries(backupTables)) {
      database.write(table, "/", value, { force: true });
    }
    database.flushTablesSync([...TABLES, itemStore.ITEMS_TABLE]);
    itemTypeRegistry._setEntriesForTests(null);
    itemStore.resetInventoryStoreForTests();
    persistence._testing.resetRuntimeForTests();
  });
  return material;
}

function runtimeEntity() {
  return {
    itemID: ENTITY_ID,
    systemID: SYSTEM_ID,
    ownerID: OWNER_ID,
    npcCharacterID: NPC_ID,
    npcIncarnation: 1,
    nativeNpc: true,
    transient: false,
    position: { x: 0, y: 0, z: 0 },
  };
}

test("NPC assembly actor metadata rejects wallet secrets and plaintext transponder codes", () => {
  assert.throws(() => actorContext.assertNoSensitiveNpcAssemblyData({
    privateKey: "do-not-store",
  }), /Sensitive field/);
  assert.throws(() => actorContext.assertNoSensitiveNpcAssemblyData({
    access: { transponderCode: "plaintext" },
  }), /Sensitive field/);
  assert.throws(() => actorContext.assertNoSensitiveNpcAssemblyData({
    payload: { membershipReceipt: "ephemeral-token" },
  }), /Sensitive field/);
  assert.equal(actorContext.assertNoSensitiveNpcAssemblyData({
    membership: { verified: true, commitmentID: "0x1234" },
  }), true);
});

test("NPC smart requests require a short-lived receipt bound to an on-chain faction commitment", async () => {
  membershipReceipts._testing.resetReceipts();
  const actor = actorContext.normalizeNpcAssemblyActorContext({
    kind: "npc",
    actorID: NPC_ID,
    ownerPrincipalID: NPC_ID,
    factionID: 500001,
    factionKey: "500001-serpentis",
    shipID: ENTITY_ID,
    solarSystemID: SYSTEM_ID,
    suiProfileObjectID: `0x${"3".repeat(64)}`,
    suiWalletAddress: `0x${"1".repeat(64)}`,
  }, { requireSui: true });
  const world = {
    packageId: `0x${"4".repeat(64)}`,
    typeOrigin: `0x${"5".repeat(64)}`,
    objectRegistryId: `0x${"6".repeat(64)}`,
    transponderRegistryId: `0x${"7".repeat(64)}`,
    tenant: "evejs-localnet",
  };
  const code = "SERPENTIS-BUILD";
  const salt = Uint8Array.from({ length: 32 }, (_, index) => index + 1);
  const binding = {
    requestID: "f47ac10b-58cc-4372-a567-0e02b2c3d479",
    requestType: "construction.supply",
    commandNodeID: 9900000101,
    targetAssemblyID: 9900000102,
  };
  const scope = { kind: "faction", factionKey: actor.factionKey };
  const authored = suiTransponders.computeSuiTransponderCommitment({
    objectRegistryId: world.objectRegistryId,
    tenant: world.tenant,
    scope,
    revision: 1,
    code,
    salt,
  });
  const commitmentID = suiTransponders.deriveSuiTransponderCommitmentObjectId(world, scope);
  const chainObject = {
    objectId: commitmentID,
    type: `${world.typeOrigin}::transponder::TransponderCommitment`,
    owner: { Shared: { initial_shared_version: "1" } },
    content: { fields: {
      registry_id: world.objectRegistryId,
      tenant: world.tenant,
      scope_kind: suiTransponders.SUI_TRANSPONDER_SCOPE_FACTION,
      scope_id: actor.factionKey,
      authority: actor.suiWalletAddress,
      hash_scheme: suiTransponders.SUI_TRANSPONDER_HASH_SCHEME,
      commitment: Array.from(authored.commitment),
      revision: "1",
      revoked: false,
    } },
  };
  const issued = await membershipReceipts.issueNpcTransponderMembershipReceipt({
    actor,
    world,
    code,
    salt,
    binding,
    nowMs: 1_000,
    ttlMs: 5_000,
  }, { client: {
    async getObject({ objectId }: any) {
      assert.equal(objectId, commitmentID);
      return { object: chainObject };
    },
  } });
  assert.equal(issued.success, true, issued.errorMsg);
  assert.equal(JSON.stringify(issued.data).includes(code), false);
  assert.equal(JSON.stringify(issued.data).includes(Buffer.from(salt).toString("hex")), false);

  const accepted = membershipReceipts.authorizeNpcTransponderMembershipReceipt(
    issued.data.receiptToken,
    actor,
    binding,
    { nowMs: 2_000 },
  );
  assert.equal(accepted.success, true, accepted.errorMsg);
  assert.equal(accepted.data.commitmentID, commitmentID);
  assert.equal(accepted.data.factionKey, actor.factionKey);
  assert.equal(membershipReceipts.authorizeNpcTransponderMembershipReceipt(
    issued.data.receiptToken,
    actor,
    { ...binding, targetAssemblyID: binding.targetAssemblyID + 1 },
    { nowMs: 2_000 },
  ).success, false);
  assert.equal(membershipReceipts.authorizeNpcTransponderMembershipReceipt(
    issued.data.receiptToken,
    actor,
    binding,
    { nowMs: 7_000 },
  ).success, false);
  membershipReceipts._testing.resetReceipts();
});

test("atomic item consumption and target update cannot persist a partial construction commit", (t) => {
  const material = fixture(t);
  const target = itemStore.grantItemToOwnerLocation(
    NPC_ID,
    SYSTEM_ID,
    0,
    MATERIAL_TYPE_ID,
    1,
    { singleton: 1 },
  ).data.items[0];
  const failed = itemStore.consumeInventoryItemsAndUpdateItem([{
    itemID: material.itemID,
    quantity: 99,
  }], target.itemID, (item) => ({ ...item, itemName: "should-not-commit" }));
  assert.equal(failed.success, false);
  assert.equal(itemStore.findItemById(material.itemID).stacksize, 5);
  assert.notEqual(itemStore.findItemById(target.itemID).itemName, "should-not-commit");

  const rejectedUpdate = itemStore.consumeInventoryItemsAndUpdateItem([{
    itemID: material.itemID,
    quantity: 1,
  }], target.itemID, () => {
    throw Object.assign(new Error("ASSEMBLY_STATE_PENDING"), { code: "ASSEMBLY_STATE_PENDING" });
  });
  assert.equal(rejectedUpdate.success, false);
  assert.equal(rejectedUpdate.errorMsg, "ASSEMBLY_STATE_PENDING");
  assert.equal(itemStore.findItemById(material.itemID).stacksize, 5);

  const committed = itemStore.consumeInventoryItemsAndUpdateItem([{
    itemID: material.itemID,
    quantity: 3,
    expected: { ownerID: OWNER_ID, locationID: ENTITY_ID, typeID: MATERIAL_TYPE_ID },
  }], target.itemID, (item) => ({ ...item, itemName: "constructed" }), { flush: true });
  assert.equal(committed.success, true, committed.errorMsg);
  assert.equal(itemStore.findItemById(material.itemID).stacksize, 2);
  assert.equal(itemStore.findItemById(target.itemID).itemName, "constructed");
});

test("a prepared Phase 3 deployment operation recovers and commits exactly once", (t) => {
  fixture(t);
  const actor = actorContext.publicNpcAssemblyOperator(
    actorContext.createNpcAssemblyActorContext(nativeStore.getNativeEntity(ENTITY_ID), {
      requireSui: true,
    }),
  );
  const assembly = { itemID: 9900000932, ownerID: NPC_ID, typeID: ASSEMBLY_TYPE_ID };
  let placed = 0;
  let existing = null;
  const restore = construction.configureNpcConstructionAdapters({
    findByJobID() { return existing; },
    place() {
      placed += 1;
      existing = assembly;
      return { success: true, data: { item: assembly } };
    },
  });
  t.after(restore);
  const prepared = persistence.beginNpcOperation(
    "npc-construction-deploy",
    "npc-construction-deploy:recovery-test",
    {
      actor,
      jobID: "recovery-test",
      assemblyTypeID: ASSEMBLY_TYPE_ID,
      requireSui: true,
      position: { x: 500, y: 0, z: 0 },
      rotation: { yaw: 0, pitch: 0, roll: 0 },
      shipPosition: { x: 0, y: 0, z: 0 },
    },
  ).data;
  const recovered = construction.recoverNpcConstructionOperation(prepared);
  assert.equal(recovered.success, true, recovered.errorMsg);
  assert.equal(recovered.data.assemblyItemID, assembly.itemID);
  assert.equal(placed, 1);
  const committed = persistence.getNpcOperationByIdempotencyKey(
    "npc-construction-deploy:recovery-test",
  );
  assert.equal(committed.status, "committed");
  assert.equal(construction.recoverNpcConstructionOperation(committed).success, true);
  assert.equal(placed, 1);
});

test("Phase 3 travels into player placement range before creating a site", (t) => {
  fixture(t);
  construction.registerNpcConstructionJobHandlers();
  const site = { itemID: 9900000934, ownerID: NPC_ID, typeID: 91715 };
  let travelCalls = 0;
  let placementCalls = 0;
  const restore = construction.configureNpcConstructionAdapters({
    resolveDefinition() {
      return {
        assemblyTypeID: ASSEMBLY_TYPE_ID,
        constructionSiteTypeID: 91715,
        constructionCost: { [MATERIAL_TYPE_ID]: 3 },
        createOnChain: true,
        durationSeconds: 0,
      };
    },
    planPlacement() {
      return {
        success: true,
        data: {
          buildAnchor: "network-node",
          networkNodeID: 8809200931,
          placementPreference: "around-network-node",
          position: { x: 1_000_000, y: 0, z: 0 },
        },
      };
    },
    travelToPlacement() {
      travelCalls += 1;
      return {
        success: true,
        data: { arrived: travelCalls > 1, distance: travelCalls > 1 ? 1_000 : 1_000_000 },
      };
    },
    findByJobID() { return null; },
    place() {
      placementCalls += 1;
      return { success: true, data: { item: site } };
    },
  });
  t.after(restore);
  const created = construction.createNpcConstructionJob({
    entityID: ENTITY_ID,
    assemblyTypeID: ASSEMBLY_TYPE_ID,
    idempotencyKey: "phase3:travel-before-placement:931",
  });
  assert.equal(created.success, true, created.errorMsg);
  const context = {
    scene: { systemID: SYSTEM_ID },
    entity: runtimeEntity(),
    controller: { entityID: ENTITY_ID, npcCharacterID: NPC_ID, npcIncarnation: 1 },
  };
  const nowMs = Date.now();
  behaviorRuntime.tickDurableNpcJob(context.scene, context.entity, context.controller, nowMs);
  behaviorRuntime.tickDurableNpcJob(context.scene, context.entity, context.controller, nowMs + 10_000);
  let stored = persistence.getNpcJob(created.data.jobID);
  assert.equal(stored.step, "travel-placement");
  assert.equal(travelCalls, 1);
  assert.equal(placementCalls, 0, "placement must wait until the builder arrives");

  behaviorRuntime.tickDurableNpcJob(context.scene, context.entity, context.controller, nowMs + 20_000);
  stored = persistence.getNpcJob(created.data.jobID);
  assert.equal(travelCalls, 2);
  assert.equal(placementCalls, 1);
  assert.equal(stored.checkpoint.sitePlaced, true);
});

test("Phase 3 direct placement consumes a reserved material plan without creating a site", (t) => {
  fixture(t);
  construction.registerNpcConstructionJobHandlers();
  const assembly = { itemID: 9900000935, ownerID: NPC_ID, typeID: PORTABLE_ASSEMBLY_TYPE_ID };
  let directCalls = 0;
  let siteCalls = 0;
  let receivedPlan: any[] = [];
  const restore = construction.configureNpcConstructionAdapters({
    resolveDefinition() {
      return {
        assemblyTypeID: PORTABLE_ASSEMBLY_TYPE_ID,
        constructionSiteTypeID: 91715,
        constructionCost: { [MATERIAL_TYPE_ID]: 3 },
        createOnChain: true,
        durationSeconds: 0,
      };
    },
    planPlacement() {
      return {
        success: true,
        data: {
          buildAnchor: "system",
          placementPreference: "explicit",
          position: { x: 500, y: 0, z: 0 },
        },
      };
    },
    travelToPlacement() {
      return { success: true, data: { arrived: true, distance: 500 } };
    },
    findByJobID() { return null; },
    place() {
      siteCalls += 1;
      return { success: false, errorMsg: "SITE_PATH_SHOULD_NOT_RUN" };
    },
    placeDirect(_actor, input) {
      directCalls += 1;
      receivedPlan = input.materialPlan;
      return { success: true, data: { item: assembly, directPlacement: true } };
    },
  });
  t.after(restore);
  const created = construction.createNpcConstructionJob({
    entityID: ENTITY_ID,
    assemblyTypeID: PORTABLE_ASSEMBLY_TYPE_ID,
    placementMode: "directAssembly",
    activate: false,
    idempotencyKey: "phase3:direct-placement:931",
  });
  assert.equal(created.success, true, created.errorMsg);
  const entity = runtimeEntity();
  const controller = { entityID: ENTITY_ID, npcCharacterID: NPC_ID, npcIncarnation: 1 };
  const nowMs = Date.now();
  behaviorRuntime.tickDurableNpcJob({ systemID: SYSTEM_ID }, entity, controller, nowMs);
  behaviorRuntime.tickDurableNpcJob({ systemID: SYSTEM_ID }, entity, controller, nowMs + 10_000);
  const stored = persistence.getNpcJob(created.data.jobID);
  assert.equal(directCalls, 1);
  assert.equal(siteCalls, 0);
  assert.equal(receivedPlan.reduce((sum, entry) => sum + entry.quantity, 0), 3);
  assert.equal(stored.checkpoint.materialsFulfilled, true);
  assert.equal(stored.checkpoint.constructed, true);
  assert.equal(stored.checkpoint.assemblyItemID, assembly.itemID);
  assert.equal(persistence.listNpcJobReservations(stored.jobID).length, 0);
});

test("Phase 3 Network Node jobs always bypass the construction-site path", (t) => {
  fixture(t);
  const restore = construction.configureNpcConstructionAdapters({
    resolveDefinition() {
      return {
        assemblyTypeID: NETWORK_NODE_TYPE_ID,
        constructionSiteTypeID: 0,
        constructionCost: { [MATERIAL_TYPE_ID]: 3 },
        createOnChain: true,
        durationSeconds: 0,
      };
    },
  });
  t.after(restore);
  const created = construction.createNpcConstructionJob({
    entityID: ENTITY_ID,
    assemblyTypeID: NETWORK_NODE_TYPE_ID,
    idempotencyKey: "phase3:direct-network-node:931",
  });
  assert.equal(created.success, true, created.errorMsg);
  assert.equal(persistence.getNpcJob(created.data.jobID).payload.placementMode, "directAssembly");
});

test("Phase 3 job checkpoints deployment through Sui confirmation and faction registration", (t) => {
  fixture(t);
  construction.registerNpcConstructionJobHandlers();
  let lifecycleStatus = 1;
  let chainPending = false;
  let registered = false;
  const assembly = { itemID: 9900000931, ownerID: NPC_ID, typeID: ASSEMBLY_TYPE_ID };
  const restore = construction.configureNpcConstructionAdapters({
    resolveDefinition() {
      return {
        assemblyTypeID: ASSEMBLY_TYPE_ID,
        constructionSiteTypeID: 91715,
        constructionCost: { [MATERIAL_TYPE_ID]: 3 },
        createOnChain: true,
        durationSeconds: 0,
      };
    },
    findByJobID() { return null; },
    planPlacement() {
      return {
        success: true,
        data: {
          buildAnchor: "network-node",
          networkNodeID: 8809200931,
          placementPreference: "around-network-node",
          position: { x: 500, y: 0, z: 0 },
        },
      };
    },
    place() { return { success: true, data: { item: assembly } }; },
    deposit() { return { success: true, data: { deposited: { [MATERIAL_TYPE_ID]: 3 } } }; },
    complete() { return { success: true, data: { item: assembly } }; },
    lifecycle() {
      return {
        success: true,
        data: {
          item: assembly,
          state: { assemblyStatus: lifecycleStatus, activationCompleteAtMs: 0 },
          activationPending: false,
          createOnChain: true,
          suiStatusIntent: chainPending ? { id: "pending", targetStatus: 2 } : null,
        },
      };
    },
    requestState() {
      lifecycleStatus = 2;
      chainPending = true;
      return { success: true, data: { item: assembly } };
    },
    register() {
      registered = true;
      return { success: true, data: { item: assembly } };
    },
  });
  t.after(restore);
  const created = construction.createNpcConstructionJob({
    entityID: ENTITY_ID,
    assemblyTypeID: ASSEMBLY_TYPE_ID,
    idempotencyKey: "phase3:smart:931",
  });
  assert.equal(created.success, true, created.errorMsg);
  const context = {
    scene: { systemID: SYSTEM_ID },
    entity: runtimeEntity(),
    controller: { entityID: ENTITY_ID, npcCharacterID: NPC_ID, npcIncarnation: 1 },
  };
  let nowMs = Date.now();
  for (let index = 0; index < 6; index += 1) {
    behaviorRuntime.tickDurableNpcJob(context.scene, context.entity, context.controller, nowMs);
    nowMs += 10_000;
  }
  let stored = persistence.getNpcJob(created.data.jobID);
  assert.equal(stored.step, "awaiting-sui-confirmation");
  assert.equal(stored.checkpoint.fundingAuthority.kind, "faction-wallet-budget");
  assert.equal(stored.checkpoint.operator.actorID, NPC_ID);
  assert.equal(stored.checkpoint.operator.factionKey, "500001-serpentis");
  assert.equal(stored.checkpoint.sitePlaced, true);
  assert.equal(stored.checkpoint.materialsDeposited, true);
  assert.equal(stored.checkpoint.materialsFulfilled, true);
  assert.equal(persistence.listNpcJobReservations(stored.jobID).length, 0);
  chainPending = false;
  behaviorRuntime.tickDurableNpcJob(context.scene, context.entity, context.controller, nowMs + 10_000);
  stored = persistence.getNpcJob(created.data.jobID);
  assert.equal(stored.status, "completed");
  assert.equal(stored.checkpoint.registered, true);
  assert.equal(registered, true);
  const operations = Object.values(persistence._testing.readRoot().operations);
  assert.deepEqual(
    operations.map((operation: any) => operation.operationType).sort(),
    ["npc-construction-complete", "npc-construction-deploy", "npc-construction-deposit"],
  );
  assert.equal(operations.every((operation: any) => operation.status === "committed"), true);
});

test("Phase 3 places a durable construction site before requesting missing materials", (t) => {
  const material = fixture(t);
  construction.registerNpcConstructionJobHandlers();
  assert.equal(itemStore.removeInventoryItem(material.itemID).success, true);
  nativeStore.removeNativeCargo(material.itemID);
  database.flushTablesSync([itemStore.ITEMS_TABLE, nativeStore.TABLE.CARGO]);

  const site = { itemID: 9900000933, ownerID: NPC_ID, typeID: 91715 };
  let placementCalls = 0;
  const restore = construction.configureNpcConstructionAdapters({
    resolveDefinition() {
      return {
        assemblyTypeID: ASSEMBLY_TYPE_ID,
        constructionSiteTypeID: 91715,
        constructionCost: { [MATERIAL_TYPE_ID]: 3 },
        createOnChain: true,
        durationSeconds: 0,
      };
    },
    findByJobID() { return null; },
    planPlacement() {
      return {
        success: true,
        data: {
          buildAnchor: "network-node",
          networkNodeID: 8809200931,
          placementPreference: "around-network-node",
          position: { x: 500, y: 0, z: 0 },
        },
      };
    },
    place() {
      placementCalls += 1;
      return {
        success: true,
        data: {
          item: site,
          placement: {
            buildAnchor: "network-node",
            networkNodeID: 8809200931,
            placementPreference: "around-network-node",
          },
        },
      };
    },
    deposit(_actor, itemID, materialPlan) {
      assert.equal(itemID, site.itemID);
      assert.deepEqual(materialPlan, [], "an external site delivery leaves no ship-cargo move");
      return { success: true, data: { deposited: { [MATERIAL_TYPE_ID]: 3 } } };
    },
  });
  t.after(restore);

  const created = construction.createNpcConstructionJob({
    entityID: ENTITY_ID,
    assemblyTypeID: ASSEMBLY_TYPE_ID,
    idempotencyKey: "phase3:site-before-materials:931",
  });
  assert.equal(created.success, true, created.errorMsg);
  const context = {
    scene: { systemID: SYSTEM_ID },
    entity: runtimeEntity(),
    controller: { entityID: ENTITY_ID, npcCharacterID: NPC_ID, npcIncarnation: 1 },
  };
  const nowMs = Date.now();
  behaviorRuntime.tickDurableNpcJob(context.scene, context.entity, context.controller, nowMs);
  behaviorRuntime.tickDurableNpcJob(context.scene, context.entity, context.controller, nowMs + 10_000);
  behaviorRuntime.tickDurableNpcJob(context.scene, context.entity, context.controller, nowMs + 20_000);

  let stored = persistence.getNpcJob(created.data.jobID);
  assert.equal(placementCalls, 1);
  assert.equal(stored.step, "awaiting-materials");
  assert.equal(stored.checkpoint.sitePlaced, true);
  assert.equal(stored.checkpoint.assemblyItemID, site.itemID);
  assert.equal(stored.checkpoint.materialRequest.constructionSiteID, site.itemID);
  assert.equal(stored.checkpoint.materialRequest.networkNodeID, 8809200931);
  assert.equal(stored.checkpoint.constructed, undefined);
  const operations = Object.values(persistence._testing.readRoot().operations);
  assert.deepEqual(
    operations.map((operation: any) => operation.operationType),
    ["npc-construction-deploy"],
  );

  const delivered = itemStore.grantItemToOwnerLocation(
    OWNER_ID,
    site.itemID,
    0,
    MATERIAL_TYPE_ID,
    3,
    { singleton: 0 },
  );
  assert.equal(delivered.success, true, delivered.errorMsg);
  behaviorRuntime.tickDurableNpcJob(context.scene, context.entity, context.controller, nowMs + 30_000);
  stored = persistence.getNpcJob(created.data.jobID);
  assert.equal(stored.step, "realize-structure");
  assert.equal(stored.checkpoint.materialsAtSite[MATERIAL_TYPE_ID], 3);
  assert.deepEqual(stored.checkpoint.materialPlan, []);
  assert.equal(stored.checkpoint.materialsFulfilled, true);
  assert.equal(stored.checkpoint.materialRequest, null);
});
