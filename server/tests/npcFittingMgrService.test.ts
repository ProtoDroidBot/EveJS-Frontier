"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const { unwrapMarshalValue } = require("../src/services/_shared/serviceHelpers");
const NpcFittingMgrService = require("../src/services/npc/npcFittingMgrService");
const fittingTrust = require("../src/space/npc/npcFittingTrust");
const factionConfig = require("../src/config/npcFactionConfig");
const spaceRuntime = require("../src/space/runtime");
const nativeNpcStore = require("../src/space/npc/nativeNpcStore");

const ENTITY_ID = 980000004201;
const PLAYER_ID = 140004201;
const SHIP_ID = 910004201;
const MODULE_ID = 920004201;
const CHARGE_ID = 920004202;
const FACTION_ID = 500010;

function entity(overrides: Record<string, any> = {}) {
  return {
    entityID: ENTITY_ID,
    systemID: 30000004,
    ownerID: FACTION_ID,
    npcFactionID: FACTION_ID,
    npcFactionKey: `${FACTION_ID}-test`,
    npcCharacterID: 1500004201,
    itemName: "Trusted Test NPC",
    npcFittingRestrictions: {
      allowedRoles: ["weapon", "ammunition"],
      roleSlots: { weapon: [11] },
      cpuOutput: 100,
      powerOutput: 100,
    },
    ...overrides,
  };
}

function session(factionID = FACTION_ID) {
  return {
    characterID: PLAYER_ID,
    factionID,
    corporationID: 100004201,
    _space: { shipID: SHIP_ID, systemID: 30000004 },
  };
}

function createService(options: Record<string, any> = {}) {
  const npc = options.entity || entity();
  const cargo = [
    {
      itemID: MODULE_ID,
      typeID: 990421,
      itemName: "Cargo Weapon",
      ownerID: PLAYER_ID,
      locationID: SHIP_ID,
      flagID: 5,
      categoryID: 7,
      groupID: 53,
      singleton: 1,
      stacksize: 1,
    },
    {
      itemID: CHARGE_ID,
      typeID: 990422,
      itemName: "Cargo Charge",
      ownerID: PLAYER_ID,
      locationID: SHIP_ID,
      flagID: 5,
      categoryID: 8,
      groupID: 85,
      singleton: 0,
      stacksize: 20,
    },
  ];
  const calls: any[] = [];
  const npcFitting = {
    resolveNpcFittingEntity(entityID) {
      return Number(entityID) === ENTITY_ID
        ? {
            success: true,
            data: {
              entityRecord: npc,
              fittingHull: {
                itemID: ENTITY_ID,
                typeID: 587,
                itemName: npc.itemName,
                npcPhysicalHullTypeID: 990420,
                npcFittingProfileID: "test-hull",
              },
            },
          }
        : { success: false, errorMsg: "NPC_DURABLE_ENTITY_NOT_FOUND" };
    },
    resolveEffectiveHardwarePolicy() {
      return {
        allowPlayerOwned: true,
        allowedRoles: ["weapon", "ammunition"],
        allowedTypeIDs: [],
        deniedTypeIDs: [],
      };
    },
    listNpcEquipment() {
      return [{
        moduleID: 930004201,
        typeID: 990423,
        itemName: "Fitted Weapon",
        flagID: 11,
        semanticRole: "weapon",
        usable: true,
        moduleState: { online: true },
        custody: { actorCharacterID: 999, sourceLocationID: 123 },
        charges: [],
      }];
    },
    fitItemToNpc(input) {
      calls.push(["fit", input]);
      return { success: true, data: { moduleID: input.itemID } };
    },
    unfitItemFromNpc(input) {
      calls.push(["unfit", input]);
      return { success: true, data: { moduleID: input.moduleID } };
    },
    loadChargeToNpcModule(input) {
      calls.push(["load", input]);
      return { success: true, data: { cargoID: input.itemID } };
    },
    unloadChargeFromNpcModule(input) {
      calls.push(["unload", input]);
      return { success: true, data: { cargoID: input.cargoID } };
    },
  };
  const itemStore = {
    ITEM_FLAGS: { CARGO_HOLD: 5 },
    listOwnedItems(ownerID, filters) {
      return cargo.filter((item) =>
        item.ownerID === ownerID &&
        item.locationID === filters.locationID &&
        item.flagID === filters.flagID);
    },
    findItemById(itemID) {
      return cargo.find((item) => item.itemID === Number(itemID)) || null;
    },
  };
  const service = new NpcFittingMgrService({
    npcFitting,
    itemStore,
    orders: options.orders,
    trust: options.trust || fittingTrust,
    authorizeInteraction: options.authorizeInteraction || (() => ({
      success: true,
      data: { shipID: SHIP_ID },
    })),
  });
  return { service, calls, cargo, npc };
}

test("NPC fitting trust is positive-only and supports explicit authored trust", () => {
  const npc = entity();
  assert.deepEqual(
    fittingTrust.evaluateNpcFittingTrust(npc, {
      characterID: PLAYER_ID,
      factionID: FACTION_ID,
    }),
    { trusted: true, reason: "same-faction" },
  );
  assert.equal(fittingTrust.evaluateNpcFittingTrust(npc, {
    characterID: PLAYER_ID,
    factionID: FACTION_ID + 1,
  }).trusted, false);
  assert.deepEqual(
    fittingTrust.evaluateNpcFittingTrust(entity({
      npcFittingTrust: { trustedCharacterIDs: [PLAYER_ID] },
    }), {
      characterID: PLAYER_ID,
      factionID: FACTION_ID + 1,
    }),
    { trusted: true, reason: "authored-character" },
  );
  assert.deepEqual(
    fittingTrust.evaluateNpcFittingTrust(entity({
      npcFittingTrust: {
        trustedCharacterIDs: [PLAYER_ID],
        deniedCharacterIDs: [PLAYER_ID],
      },
    }), {
      characterID: PLAYER_ID,
      factionID: FACTION_ID,
    }),
    { trusted: false, reason: "authored-deny" },
  );
});

test("configured allied factions may interact, but IFF alone cannot grant fitting trust", (t) => {
  t.mock.method(factionConfig, "resolveNpcFactionDiplomacy", () => ({
    allies: [{ factionKey: "500001-none", transponderCode: "CALDARI" }],
    enemies: [],
  }));
  const actor = { characterID: PLAYER_ID, factionID: 500001 };
  assert.deepEqual(fittingTrust.evaluateNpcFittingTrust(entity(), actor), {
    trusted: true,
    reason: "allied-faction",
  });
  assert.equal(fittingTrust.evaluateNpcFittingTrust(entity({
    npcFittingTrust: { deniedCharacterIDs: [PLAYER_ID] },
  }), actor).trusted, false);
  assert.equal(fittingTrust.evaluateNpcFittingTrust(entity(), {
    characterID: PLAYER_ID,
    transponderSignal: "CALDARI",
  }).trusted, false);
});

test("debug fitting trust allows nearby players but never overrides an explicit denial", () => {
  const actor = { characterID: PLAYER_ID, factionID: FACTION_ID + 1 };
  const context = { interaction: { shipEntity: {}, npcEntity: {} } };
  assert.deepEqual(fittingTrust.evaluateNpcFittingTrust(entity(), actor, context), {
    trusted: true,
    reason: "debug-nearby-player",
  });
  assert.deepEqual(fittingTrust.evaluateNpcFittingTrust(entity({
    npcFittingTrust: { deniedCharacterIDs: [PLAYER_ID] },
  }), actor, context), {
    trusted: false,
    reason: "authored-deny",
  });
});

test("default fitting interaction requires the live NPC in range", (t) => {
  const playerShip = {
    itemID: SHIP_ID,
    kind: "ship",
    ownerID: PLAYER_ID,
    characterID: PLAYER_ID,
    position: { x: 0, y: 0, z: 0 },
    radius: 0,
  };
  const npcShip = {
    itemID: ENTITY_ID,
    nativeNpc: true,
    position: { x: 5_001, y: 0, z: 0 },
    radius: 0,
  };
  t.mock.method(spaceRuntime, "getEntity", (_session, entityID) => (
    Number(entityID) === SHIP_ID ? playerShip :
      Number(entityID) === ENTITY_ID ? npcShip : null
  ));
  const currentSession = session();
  const npc = entity();
  const distant = NpcFittingMgrService.defaultAuthorizeInteraction(currentSession, npc);
  assert.equal(distant.success, false);
  assert.equal(distant.errorMsg, "NPC_FITTING_OUT_OF_RANGE");

  npcShip.position.x = 5_000;
  assert.equal(
    NpcFittingMgrService.defaultAuthorizeInteraction(currentSession, npc).success,
    true,
  );
  assert.equal(
    NpcFittingMgrService.defaultAuthorizeInteraction(
      { ...currentSession, _space: { ...currentSession._space, systemID: 30000005 } },
      npc,
    ).errorMsg,
    "NPC_FITTING_NOT_LOCAL",
  );
});

test("fitting action and window state are hidden when the NPC does not trust the player", () => {
  const { service } = createService();
  const denied = unwrapMarshalValue(
    service.Handle_CanOpenNpcFitting([ENTITY_ID], session(FACTION_ID + 1)),
  );
  assert.equal(denied.trusted, false);
  assert.equal(denied.reason, "NPC_FITTING_TRUST_REQUIRED");

  const state = unwrapMarshalValue(
    service.Handle_GetNpcFittingState([ENTITY_ID], session(FACTION_ID + 1)),
  );
  assert.equal(state.trusted, false);
  assert.equal(state.modules, undefined);
  assert.equal(state.availableModules, undefined);
});

test("friendly interaction probe keeps fitting authorization separate", (t) => {
  const { service } = createService({
    trust: { evaluateNpcFittingTrust: () => ({ trusted: false, reason: "not-authorized" }) },
    authorizeInteraction: () => ({
      success: true,
      data: { shipID: SHIP_ID, shipEntity: {}, npcEntity: {} },
    }),
  });
  t.mock.method(factionConfig, "resolveNpcTargetIdentification", () => "ally");
  const interaction = unwrapMarshalValue(
    service.Handle_CanInteractNpc([ENTITY_ID], session(FACTION_ID + 1)),
  );
  assert.equal(interaction.canInteract, true);
  assert.equal(interaction.canModifyFittings, false);
  assert.equal(interaction.canIssueOrders, false);
  const fitting = unwrapMarshalValue(
    service.Handle_CanOpenNpcFitting([ENTITY_ID], session(FACTION_ID + 1)),
  );
  assert.equal(fitting.trusted, false);
});

test("live transient NPCs use the trusted interaction and fitting flow", (t) => {
  const npc = entity({ nativeNpc: true, transient: true });
  const npcScene: any = { itemID: ENTITY_ID, position: { x: 0, y: 0, z: 0 } };
  const targetID = 980000004299;
  const target: any = { itemID: targetID, position: { x: 1000, y: 0, z: 0 } };
  const issued: any[] = [];
  t.mock.method(nativeNpcStore, "getNativeEntity", (id) => (
    Number(id) === ENTITY_ID ? npc : null
  ));
  t.mock.method(spaceRuntime, "getEntity", (_session, id) => (
    Number(id) === targetID ? target : null
  ));
  const { service } = createService({
    entity: npc,
    authorizeInteraction: () => ({
      success: true,
      data: { shipID: SHIP_ID, shipEntity: {}, npcEntity: npcScene },
    }),
    orders: {
      issueManualOrder(id, order) {
        issued.push([id, order]);
        return { success: true };
      },
    },
  });
  const interaction = unwrapMarshalValue(
    service.Handle_CanInteractNpc([ENTITY_ID], session()),
  );
  assert.equal(interaction.canInteract, true);
  assert.equal(interaction.canIssueOrders, true);
  assert.equal(interaction.canModifyFittings, true);
  assert.equal(unwrapMarshalValue(
    service.Handle_CanOpenNpcFitting([ENTITY_ID], session()),
  ).trusted, true);
  assert.equal(unwrapMarshalValue(
    service.Handle_GetNpcFittingState([ENTITY_ID], session()),
  ).trusted, true);

  const accepted = unwrapMarshalValue(service.Handle_IssueNpcOrder([
    ENTITY_ID, { type: "approach", targetID },
  ], session()));
  assert.equal(accepted.accepted, true);
  assert.equal(issued.length, 1);
  assert.equal(issued[0][0], ENTITY_ID);
  assert.equal(issued[0][1].targetID, targetID);
});

test("manual NPC orders are allowlisted, scoped, and recheck trust", (t) => {
  const npc = entity({ nativeNpc: true });
  const npcScene: any = { itemID: ENTITY_ID, position: { x: 0, y: 0, z: 0 } };
  const targetID = 980000004299;
  const target: any = { itemID: targetID, position: { x: 1000, y: 0, z: 0 } };
  const issued: any[] = [];
  let trusted = true;
  t.mock.method(nativeNpcStore, "getNativeEntity", (id) => (
    Number(id) === ENTITY_ID ? npc : null
  ));
  t.mock.method(spaceRuntime, "getEntity", (_session, id) => (
    Number(id) === targetID ? target : null
  ));
  const { service } = createService({
    entity: npc,
    trust: { evaluateNpcFittingTrust: () => ({ trusted }) },
    authorizeInteraction: () => ({
      success: true,
      data: { shipID: SHIP_ID, shipEntity: {}, npcEntity: npcScene },
    }),
    orders: {
      issueManualOrder(id, order) {
        issued.push([id, order]);
        return { success: true };
      },
    },
  });
  const accepted = unwrapMarshalValue(service.Handle_IssueNpcOrder([
    ENTITY_ID, { type: "keepAtRange", targetID, rangeMeters: 5_000,
      allowWeapons: true, keepLock: true },
  ], session()));
  assert.equal(accepted.accepted, true);
  assert.deepEqual(issued, [[ENTITY_ID, {
    type: "keepAtRange", targetID, followRangeMeters: 5_000,
    allowWeapons: false, keepLock: false,
    commandSource: { kind: "player", characterID: PLAYER_ID },
  }]]);
  assert.throws(() => service.Handle_IssueNpcOrder([
    ENTITY_ID, { type: "attack", targetID },
  ], session()));
  assert.throws(() => service.Handle_IssueNpcOrder([
    ENTITY_ID, { type: "orbit", targetID, rangeMeters: 300_000 },
  ], session()));
  target.bubbleID = "other";
  npcScene.bubbleID = "local";
  assert.throws(() => service.Handle_IssueNpcOrder([
    ENTITY_ID, { type: "lock", targetID },
  ], session()));
  target.bubbleID = "local";
  trusted = false;
  assert.throws(() => service.Handle_IssueNpcOrder([
    ENTITY_ID, { type: "approach", targetID },
  ], session()));
  assert.equal(issued.length, 1);
});

test("manual NPC order parser preserves distinct navigation and lock modes", () => {
  const parse = NpcFittingMgrService.normalizePlayerNpcOrder;
  assert.equal(parse({ type: "toString", targetID: 99 }).success, false);
  assert.deepEqual(parse({ type: "approach", targetID: 99 }).data, {
    type: "approach", targetID: 99, allowWeapons: false, keepLock: false,
  });
  assert.deepEqual(parse({ type: "orbit", targetID: 99, rangeMeters: 1_500 }).data, {
    type: "orbit", targetID: 99, orbitDistanceMeters: 1_500,
    allowWeapons: false, keepLock: false,
  });
  assert.deepEqual(parse({ type: "lock", targetID: 99 }).data, {
    type: "lock", targetID: 99, allowWeapons: false, keepLock: true,
  });
  assert.deepEqual(parse({ type: "resume" }).data, {
    type: "resume", targetID: 0, allowWeapons: false, keepLock: false,
  });
});

test("blank NPC order target resolves to the initiating player's ship entity", (t) => {
  const actorShipID = 9988400000109;
  const npcShip = { itemID: ENTITY_ID, position: { x: 0, y: 0, z: 0 } };
  const playerShip = { itemID: actorShipID, position: { x: 1000, y: 0, z: 0 } };
  const issued: any[] = [];
  t.mock.method(nativeNpcStore, "getNativeEntity", (id) =>
    Number(id) === ENTITY_ID ? entity() : null);
  t.mock.method(spaceRuntime, "getEntity", (_session, id) =>
    Number(id) === actorShipID ? playerShip : null);
  const { service } = createService({
    authorizeInteraction: () => ({
      success: true,
      data: { shipID: actorShipID, shipEntity: playerShip, npcEntity: npcShip },
    }),
    orders: {
      issueManualOrder(id, order) {
        issued.push([id, order]);
        return { success: true };
      },
    },
  });
  const actorSession = {
    ...session(),
    _space: { ...session()._space, shipID: actorShipID },
  };
  const probe = unwrapMarshalValue(service.Handle_CanInteractNpc([ENTITY_ID], actorSession));
  assert.equal(probe.actorShipEntityID, actorShipID);
  for (const targetID of [undefined, "", actorShipID]) {
    const order = targetID === undefined
      ? { type: "approach" }
      : { type: "approach", targetID };
    const accepted = unwrapMarshalValue(service.Handle_IssueNpcOrder([
      ENTITY_ID, order,
    ], actorSession));
    assert.equal(accepted.accepted, true);
    assert.equal(accepted.targetID, actorShipID);
  }
  assert.equal(issued.length, 3);
  assert.equal(issued.every(([, order]) => order.targetID === actorShipID), true);
  assert.throws(() => service.Handle_IssueNpcOrder([
    ENTITY_ID, { type: "approach", targetID: 0 },
  ], actorSession));
});

test("trusted fitting state is sanitized and only advertises active-ship cargo", () => {
  const { service, cargo } = createService();
  const interaction = unwrapMarshalValue(
    service.Handle_CanInteractNpc([ENTITY_ID], session()),
  );
  assert.equal(interaction.canIssueOrders, true);
  cargo.push({
    ...cargo[0],
    itemID: MODULE_ID + 10,
    locationID: 600004201,
    itemName: "Remote Hangar Weapon",
  });
  const state = unwrapMarshalValue(
    service.Handle_GetNpcFittingState([ENTITY_ID], session()),
  );
  assert.equal(state.trusted, true);
  assert.equal(state.trustReason, "same-faction");
  assert.deepEqual(state.availableModules.map((item) => item.itemID), [MODULE_ID]);
  assert.deepEqual(state.availableCharges.map((item) => item.itemID), [CHARGE_ID]);
  assert.equal(state.modules[0].custody, undefined);
  assert.equal(state.modules[0].moduleID, 930004201);
});

test("each mutation rechecks trust and never accepts a remote inventory source", () => {
  let trusted = true;
  const trust = {
    evaluateNpcFittingTrust() {
      return { trusted, reason: trusted ? "test-trust" : "test-revoked" };
    },
  };
  const { service, calls, cargo } = createService({ trust });
  const fitted = unwrapMarshalValue(
    service.Handle_FitItem([ENTITY_ID, MODULE_ID], session()),
  );
  assert.equal(fitted.trusted, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0][1].actor.characterID, PLAYER_ID);
  assert.equal(calls[0][1].actor.factionID, FACTION_ID);
  assert.match(calls[0][1].idempotencyKey, /^npc-fit-rpc:/u);

  cargo[0].locationID = 600004201;
  assert.throws(
    () => service.Handle_FitItem([ENTITY_ID, MODULE_ID], session()),
    (error: any) => error && error.name === "MachoWrappedException" &&
      JSON.stringify(error.machoErrorResponse).includes("active ship"),
  );
  assert.equal(calls.length, 1);

  cargo[0].locationID = SHIP_ID;
  trusted = false;
  assert.throws(
    () => service.Handle_FitItem([ENTITY_ID, MODULE_ID], session()),
    (error: any) => error && error.name === "MachoWrappedException" &&
      JSON.stringify(error.machoErrorResponse).includes("does not currently trust"),
  );
  assert.equal(calls.length, 1);
});
