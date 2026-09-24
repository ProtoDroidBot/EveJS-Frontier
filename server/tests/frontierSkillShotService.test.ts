"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  marshalEncode,
} = require("../src/network/tcp/utils/marshal");
const { buildDict } = require("../src/services/_shared/serviceHelpers");
const SkillShotService = require("../src/services/frontier/skillShotService");
const {
  AUTO_FIRE_CONTRACT_MARKER,
  SkillShotRuntime,
  SKILL_SHOT_PROFILES,
  SKILL_SHOT_EFFECT_GUID,
} = require("../src/services/frontier/skillShotRuntime");
const {
  resolveWeaponFamily,
} = require("../src/space/combat/weaponDogma");
const itemStore = require("../src/services/inventory/itemStore");
const creationRuntime = require("../src/services/frontier/creationRuntime");
const CreationService = require("../src/services/frontier/creationService");
const frontierSpaceRuntime = require("../src/space/runtime");
const characterState = require("../src/services/character/characterState");

function createManualScheduler() {
  let nextID = 1;
  const tasks: any[] = [];
  return {
    tasks,
    schedule(callback, delayMs) {
      const task = { id: nextID++, callback, delayMs, cancelled: false };
      tasks.push(task);
      return task;
    },
    clearTimer(task) {
      if (task) {
        task.cancelled = true;
      }
    },
    runNext() {
      const task = tasks.find((candidate) => !candidate.cancelled && !candidate.ran);
      if (!task) {
        return false;
      }
      task.ran = true;
      task.callback();
      return true;
    },
  };
}

function buildEntity(itemID, position, radius = 25): any {
  return {
    itemID,
    typeID: 95276,
    kind: "ship",
    mode: "STOP",
    systemID: 30000001,
    bubbleID: 7,
    position: { ...position },
    radius,
    collisionRadius: radius,
    capacitorCapacity: 100,
    capacitorChargeRatio: 1,
  };
}

function createHarness(options: Record<string, any> = {}) {
  let nowMs = options.nowMs || 1_000;
  const scheduler = createManualScheduler();
  const source = buildEntity(101, { x: 0, y: 0, z: 0 }, 10);
  const target = buildEntity(202, options.targetPosition || { x: 1_000, y: 0, z: 0 }, 50);
  const additionalEntities = options.additionalEntities || [];
  const moduleItem = {
    itemID: 301,
    typeID: options.moduleTypeID || 95753,
    flagID: 184,
    moduleState: { online: true },
  };
  const chargeItem = {
    itemID: 401,
    typeID: 82126,
    flagID: 184,
    quantity: 10,
    stacksize: 10,
  };
  const notifications: any[] = [];
  const effects: any[] = [];
  const damagedTargets: any[] = [];
  const utilityHits: any[] = [];
  const crystalVolatilityApplications: any[] = [];
  const session: Record<string, any> = {
    _space: { shipID: source.itemID },
    sendNotification(name, idType, payload) {
      notifications.push({ name, idType, payload });
    },
  };
  source.session = session;
  const entities = [source, target, ...additionalEntities];
  const scene: any = {
    dynamicEntities: new Map(),
    getAllVisibleEntities: () => entities,
    getEntityByID: (itemID) => entities.find((entity) => entity.itemID === itemID) || null,
    broadcastSpecialFx(shipID, guid, fxOptions, visibilityEntity) {
      effects.push({ shipID, guid, options: fxOptions, visibilityEntity });
      return { delivered: true };
    },
  };
  const weaponSnapshot = {
    family: options.family || "projectileTurret",
    effectGUID: SKILL_SHOT_EFFECT_GUID,
    optimalRange: 35_000,
    capNeed: 12,
    chargeMode: options.chargeMode || "ammo",
    chargeQuantity: chargeItem.quantity,
    durationMs: 250,
    rawShotDamage: { em: 0, thermal: 0, kinetic: 25, explosive: 0 },
    moduleAttributes: {
      73: options.cycleDurationMs || 250,
      669: options.reactivationDelayMs || 1_550,
      6272: options.rampMaxMultiplier || 1,
      6273: options.rampDurationMs || 0,
    },
  };
  const interop: Record<string, any> = {
    getEntityRuntimeModuleItem(_entity, moduleID) {
      return moduleID === moduleItem.itemID ? moduleItem : null;
    },
    isEffectivelyOnlineModule(item) {
      return item.moduleState.online === true;
    },
    getEntityRuntimeLoadedCharge() {
      return chargeItem.quantity > 0 ? { ...chargeItem } : null;
    },
    getEntityRuntimeShipItem() {
      return { itemID: source.itemID, typeID: source.typeID };
    },
    buildWeaponSnapshotForEntity() {
      return {
        ...weaponSnapshot,
        chargeQuantity: chargeItem.quantity,
      };
    },
    getEntityCapacitorAmount(entity) {
      return entity.capacitorCapacity * entity.capacitorChargeRatio;
    },
    consumeEntityCapacitor(entity, amount) {
      const current = entity.capacitorCapacity * entity.capacitorChargeRatio;
      if (current < amount) {
        return false;
      }
      entity.capacitorChargeRatio = (current - amount) / entity.capacitorCapacity;
      return true;
    },
    notifyCapacitorChangeToSession() {},
    consumeTurretAmmoCharge() {
      if (chargeItem.quantity <= 0) {
        return { success: false, errorMsg: "NO_AMMO" };
      }
      chargeItem.quantity -= 1;
      chargeItem.stacksize -= 1;
      return { success: true };
    },
    applyCrystalVolatilityDamage(...args) {
      crystalVolatilityApplications.push(args);
      return { success: true };
    },
    applyWeaponDamageToTarget(_scene, attacker, victim, damage, when, applyOptions) {
      damagedTargets.push({ attacker, victim, damage, when, applyOptions });
      return {
        damageResult: victim.damageable === false
          ? null
          : { success: true, data: { perLayer: [{ appliedEffective: 25 }] } },
        destroyResult: null,
      };
    },
    getAppliedDamageAmount(result) {
      return result && result.success ? 25 : 0;
    },
    getCombatMessageHitQuality() {
      return 4;
    },
    notifyWeaponDamageMessages() {},
    noteKillmailDamage() {},
    recordKillmailFromDestruction() {},
  };
  if (typeof options.applySkillShotUtilityHit === "function") {
    interop.applySkillShotUtilityHit = (input) => {
      utilityHits.push(input);
      return options.applySkillShotUtilityHit(input);
    };
  }
  const spaceRuntime = {
    skillShotInterop: interop,
    getSceneForSession(candidateSession) {
      return candidateSession === session ? scene : null;
    },
    getEntity(candidateSession, itemID) {
      return candidateSession === session && itemID === source.itemID ? source : null;
    },
  };
  const creationAuthorityState = {
    authorityResolved: true,
    isCreation: options.isCreation === true,
    onlineModuleTypeIDs: new Set(options.onlineCreationModuleTypeIDs || []),
    poweredOff: false,
  };
  const runtime = new SkillShotRuntime({
    getSpaceRuntime: () => spaceRuntime,
    now: () => nowMs,
    schedule: scheduler.schedule,
    clearTimer: scheduler.clearTimer,
    resolveCreationControlAuthority:
      options.resolveCreationControlAuthority || (() => creationAuthorityState),
    ...(options.physicsGun ? { physicsGun: options.physicsGun } : {}),
  });
  return {
    runtime,
    scene,
    scheduler,
    session,
    source,
    target,
    moduleItem,
    chargeItem,
    notifications,
    effects,
    damagedTargets,
    utilityHits,
    crystalVolatilityApplications,
    creationAuthorityState,
    setNow(value) {
      nowMs = value;
    },
  };
}

test("Creation skill-shot types participate in normal weapon dogma snapshots", () => {
  assert.equal(resolveWeaponFamily({ typeID: 94076, groupID: 55 }), "projectileTurret");
  assert.equal(resolveWeaponFamily({ typeID: 95753, groupID: 56 }), "projectileTurret");
  assert.equal(resolveWeaponFamily({ typeID: 95317, groupID: 4767 }), "laserTurret");
  assert.equal(resolveWeaponFamily({ typeID: 99999, groupID: 4767 }), "laserTurret");
  assert.deepEqual(SKILL_SHOT_PROFILES.get(99999), SKILL_SHOT_PROFILES.get(95317));
  assert.equal(resolveWeaponFamily({ typeID: 95503, groupID: 4767 }), "laserTurret");
  assert.equal(resolveWeaponFamily({ typeID: 95778, groupID: 4767 }), "laserTurret");
});

test("real Creation Stuttergun charge custody feeds and persists a weapon cycle", {
  skip: process.env.EVEJS_TEST_FRONTIER_FIXTURES !== "1",
}, () => {
  const ownerID = 140000004;
  const systemID = 30000004;
  const shipGrant = itemStore.grantItemToCharacterLocation(
    ownerID,
    systemID,
    0,
    95735,
    1,
    { individualItems: true, singleton: 1 },
  );
  assert.equal(shipGrant.success, true, shipGrant.errorMsg);
  const ship = shipGrant.data.items[0];
  const shipUpdate = itemStore.updateInventoryItem(ship.itemID, (currentItem) => ({
    ...currentItem,
    locationID: systemID,
    flagID: 0,
    spaceState: {
      systemID,
      position: { x: 0, y: 0, z: 0 },
    },
  }));
  assert.equal(shipUpdate.success, true, shipUpdate.errorMsg);
  const ensured = creationRuntime.ensureCreationState(shipUpdate.data, ownerID);
  assert.equal(ensured.success, true, ensured.errorMsg);

  const moduleGrant = itemStore.grantItemToCharacterLocation(
    ownerID,
    ship.itemID,
    creationRuntime.CREATION_FITTING_FLAG_ID,
    95753,
    1,
    { individualItems: true, singleton: 1 },
  );
  assert.equal(moduleGrant.success, true, moduleGrant.errorMsg);
  const moduleItem = moduleGrant.data.items[0];
  const creationUpdate = itemStore.updateShipItem(ship.itemID, (currentItem) => {
    const customInfo = JSON.parse(currentItem.customInfo || "{}");
    customInfo[creationRuntime.CREATION_STATE_KEY].modules.push({
      itemID: moduleItem.itemID,
      typeID: moduleItem.typeID,
    });
    return { ...currentItem, customInfo: JSON.stringify(customInfo) };
  });
  assert.equal(creationUpdate.success, true, creationUpdate.errorMsg);
  const activeShipSync = characterState.updateCharacterRecord(
    ownerID,
    (currentRecord) => ({
      ...currentRecord,
      shipID: ship.itemID,
      shipTypeID: ship.typeID,
      shipName: ship.itemName,
    }),
  );
  assert.equal(activeShipSync.success, true, activeShipSync.errorMsg);

  const ammoGrant = itemStore.grantItemToCharacterLocation(
    ownerID,
    ship.itemID,
    itemStore.ITEM_FLAGS.CARGO_HOLD,
    82126,
    80,
    { singleton: 0 },
  );
  assert.equal(ammoGrant.success, true, ammoGrant.errorMsg);
  const notifications: any[] = [];
  const session = {
    characterID: ownerID,
    charid: ownerID,
    _space: { shipID: ship.itemID, systemID },
    sendNotification(name, idType, payload) {
      notifications.push({ name, idType, payload });
    },
  };
  const reloadResult = new CreationService().Handle_activate_ability(
    [ship.itemID, moduleItem.itemID, "reload"],
    session,
    {
      type_id: 82126,
      ammo_item_ids: [ammoGrant.data.items[0].itemID],
      ammo_location_id: ship.itemID,
    },
  );
  assert.ok(reloadResult);

  const entity = {
    itemID: ship.itemID,
    typeID: ship.typeID,
    kind: "ship",
    ownerID,
    pilotCharacterID: ownerID,
    session,
    position: { x: 0, y: 0, z: 0 },
  };
  const interop = frontierSpaceRuntime.skillShotInterop;
  const runtimeShipItem = interop.getEntityRuntimeShipItem(entity);
  assert.equal(runtimeShipItem.itemID, ship.itemID);
  const creationDogmaContext =
    frontierSpaceRuntime._testing.getEntityRuntimeCreationDogmaContextForTesting(
      entity,
      runtimeShipItem,
    );
  assert.ok(creationDogmaContext);
  assert.ok(
    creationDogmaContext.moduleItems.some(
      (candidate) => candidate.itemID === moduleItem.itemID,
    ),
  );
  const resolvedModule = interop.getEntityRuntimeModuleItem(
    entity,
    moduleItem.itemID,
    0,
  );
  const loadedCharge = interop.getEntityRuntimeLoadedCharge(
    entity,
    resolvedModule,
    resolvedModule.flagID,
  );
  assert.equal(loadedCharge.locationID, moduleItem.itemID);
  assert.equal(loadedCharge.flagID, 184);
  assert.equal(loadedCharge.stacksize, 80);

  const snapshot = interop.buildWeaponSnapshotForEntity(
    entity,
    resolvedModule,
    loadedCharge,
  );
  assert.equal(snapshot.family, "projectileTurret");
  assert.equal(snapshot.effectGUID, SKILL_SHOT_EFFECT_GUID);
  assert.equal(snapshot.optimalRange, 35_000);
  assert.ok(snapshot.rawShotDamage.kinetic > 0);

  const consumeResult = interop.consumeTurretAmmoCharge(
    entity,
    resolvedModule,
    loadedCharge,
    1_000,
    1,
  );
  assert.equal(consumeResult.success, true, consumeResult.errorMsg);
  const persistedCharge = itemStore.findItemById(loadedCharge.itemID);
  assert.equal(persistedCharge.locationID, moduleItem.itemID);
  assert.equal(persistedCharge.flagID, 184);
  assert.equal(persistedCharge.stacksize, 79);
  assert.ok(notifications.some((notification) => notification.name === "OnItemChange"));
});

test("Stuttergun damages the first aimed ball without any target lock", () => {
  const harness = createHarness();
  assert.equal(harness.source.targetingState, undefined);

  const result = harness.runtime.beginFire(harness.session, [
    [harness.moduleItem.itemID, [1, 0, 0]],
  ]);

  assert.equal(result.success, true);
  assert.equal(harness.damagedTargets.length, 1);
  assert.equal(harness.damagedTargets[0].victim, harness.target);
  assert.deepEqual(harness.damagedTargets[0].applyOptions, {
    skipWeaponOcclusion: true,
  });
  assert.equal(harness.chargeItem.quantity, 9);
  assert.equal(harness.source.capacitorChargeRatio, 0.88);
  assert.equal(harness.effects.length, 1);
  assert.equal(harness.effects[0].guid, SKILL_SHOT_EFFECT_GUID);
  assert.equal(harness.effects[0].options.targetID, harness.target.itemID);
  assert.equal(harness.effects[0].options.graphicInfo.endpointMode, "hit");
  assert.deepEqual(
    harness.effects[0].options.graphicInfo.targetBallID,
    harness.target.itemID,
  );
  assert.ok(harness.notifications.some((entry) => entry.name === "OnSkillShotSucceeded"));
});

test("deliberately spaced manual Stuttergun shots do not require a Repeater", () => {
  const harness = createHarness({ isCreation: true });
  const states = [[harness.moduleItem.itemID, [1, 0, 0]]];

  assert.equal(harness.runtime.beginFire(harness.session, states).success, true);
  harness.setNow(3_000);
  const secondShot = harness.runtime.beginFire(harness.session, states);

  assert.equal(secondShot.success, true);
  assert.equal(harness.damagedTargets.length, 2);
});

test("explicit Creation auto-fire is rejected when the Repeater is absent or offline", () => {
  const harness = createHarness({ isCreation: true });
  const states = [[
    harness.moduleItem.itemID,
    [1, 0, 0],
    AUTO_FIRE_CONTRACT_MARKER,
  ]];
  const blocked = harness.runtime.beginFire(harness.session, states);

  assert.equal(blocked.success, false);
  assert.equal(blocked.errorMsg, "AUTO_FIRE_CONTROLLER_OFFLINE");
  assert.equal(harness.damagedTargets.length, 0);
  assert.deepEqual(harness.notifications.at(-1), {
    name: "OnSkillShotFailed",
    idType: "clientID",
    payload: ["AutoFireControllerOffline", buildDict([])],
  });
});

test("the auto-fire marker applies to the whole request even when its tuple is malformed", () => {
  const harness = createHarness({
    isCreation: true,
    moduleTypeID: 94076,
    onlineCreationModuleTypeIDs: [95679],
  });
  const accepted = harness.runtime.beginFire(harness.session, [
    // A zero direction is discarded during normalization. It must not discard
    // the request-level automatic-fire contract along with it.
    [harness.moduleItem.itemID, [0, 0, 0], AUTO_FIRE_CONTRACT_MARKER],
    [harness.moduleItem.itemID, [1, 0, 0]],
  ]);

  assert.equal(accepted.success, true);
  assert.equal(harness.scheduler.tasks[0].delayMs, 500);
  harness.creationAuthorityState.onlineModuleTypeIDs.clear();
  harness.setNow(1_500);
  harness.scheduler.runNext();

  assert.equal(harness.damagedTargets.length, 0);
  assert.equal(harness.chargeItem.quantity, 10);
  assert.equal(harness.source.capacitorChargeRatio, 1);
  assert.deepEqual(harness.notifications.at(-1), {
    name: "OnSkillShotFailed",
    idType: "clientID",
    payload: ["AutoFireControllerOffline", buildDict([])],
  });
});

test("an online Creation Repeater authorizes explicit client auto-fire", () => {
  const harness = createHarness({
    isCreation: true,
    onlineCreationModuleTypeIDs: [95679],
  });
  const states = [[
    harness.moduleItem.itemID,
    [1, 0, 0],
    AUTO_FIRE_CONTRACT_MARKER,
  ]];

  assert.equal(harness.runtime.beginFire(harness.session, states).success, true);
  assert.equal(harness.damagedTargets.length, 1);
});

test("a powered-down Creation cannot use an otherwise-online Repeater", () => {
  const harness = createHarness({
    isCreation: true,
    onlineCreationModuleTypeIDs: [95679],
  });
  harness.creationAuthorityState.poweredOff = true;
  const result = harness.runtime.beginFire(harness.session, [[
    harness.moduleItem.itemID,
    [1, 0, 0],
    AUTO_FIRE_CONTRACT_MARKER,
  ]]);

  assert.equal(result.success, false);
  assert.equal(result.errorMsg, "AUTO_FIRE_CONTROLLER_OFFLINE");
  assert.equal(harness.damagedTargets.length, 0);
});

test("every explicit Creation auto-fire shot revalidates current Repeater authority", () => {
  const harness = createHarness({
    isCreation: true,
    onlineCreationModuleTypeIDs: [95679],
  });
  const states = [[
    harness.moduleItem.itemID,
    [1, 0, 0],
    AUTO_FIRE_CONTRACT_MARKER,
  ]];

  assert.equal(harness.runtime.beginFire(harness.session, states).success, true);
  harness.creationAuthorityState.onlineModuleTypeIDs.clear();
  const afterEffectiveOffline = harness.runtime.beginFire(harness.session, states);

  assert.equal(afterEffectiveOffline.success, false);
  assert.equal(afterEffectiveOffline.errorMsg, "AUTO_FIRE_CONTROLLER_OFFLINE");
  assert.equal(harness.damagedTargets.length, 1);
});

for (const authorityLoss of [
  "offline",
  "removed",
  "ship power-down",
]) {
  test(`delayed Creation auto-fire cannot damage after Repeater ${authorityLoss}`, () => {
    const harness = createHarness({
      isCreation: true,
      moduleTypeID: 94076,
      onlineCreationModuleTypeIDs: [95679],
    });
    const states = [[
      harness.moduleItem.itemID,
      [1, 0, 0],
      AUTO_FIRE_CONTRACT_MARKER,
    ]];

    const beginResult = harness.runtime.beginFire(harness.session, states);
    assert.equal(beginResult.success, true);
    assert.equal(harness.damagedTargets.length, 0);
    assert.equal(harness.scheduler.tasks[0].delayMs, 500);

    harness.creationAuthorityState.onlineModuleTypeIDs.clear();
    if (authorityLoss === "ship power-down") {
      harness.creationAuthorityState.poweredOff = true;
    }
    harness.setNow(1_500);
    harness.scheduler.runNext();

    assert.equal(harness.damagedTargets.length, 0);
    assert.equal(harness.chargeItem.quantity, 10);
    assert.equal(harness.source.capacitorChargeRatio, 1);
    assert.equal(harness.effects.length, 0);
    assert.deepEqual(harness.notifications.at(-1), {
      name: "OnSkillShotFailed",
      idType: "clientID",
      payload: ["AutoFireControllerOffline", buildDict([])],
    });
  });
}

for (const weaponLoss of ["offline", "removed"]) {
  test(`delayed automatic fire terminates when its weapon is ${weaponLoss}`, () => {
    const harness = createHarness({
      isCreation: true,
      moduleTypeID: 94076,
      onlineCreationModuleTypeIDs: [95679],
    });
    const beginResult = harness.runtime.beginFire(harness.session, [[
      harness.moduleItem.itemID,
      [1, 0, 0],
      AUTO_FIRE_CONTRACT_MARKER,
    ]]);
    assert.equal(beginResult.success, true);

    if (weaponLoss === "offline") {
      harness.moduleItem.moduleState.online = false;
    } else {
      harness.moduleItem.itemID += 1;
    }
    harness.setNow(1_500);
    harness.scheduler.runNext();

    assert.equal(harness.damagedTargets.length, 0);
    assert.equal(harness.chargeItem.quantity, 10);
    assert.equal(harness.source.capacitorChargeRatio, 1);
    assert.deepEqual(harness.notifications.at(-1), {
      name: "OnSkillShotFailed",
      idType: "clientID",
      payload: ["AutoFireTerminated", buildDict([])],
    });
  });
}

test("EndFire cancels an accepted delayed automatic shot", () => {
  const harness = createHarness({
    isCreation: true,
    moduleTypeID: 94076,
    onlineCreationModuleTypeIDs: [95679],
  });
  const beginResult = harness.runtime.beginFire(harness.session, [[
    harness.moduleItem.itemID,
    [1, 0, 0],
    AUTO_FIRE_CONTRACT_MARKER,
  ]]);
  assert.equal(beginResult.success, true);

  const endResult = harness.runtime.endFire(harness.session);

  assert.equal(endResult.success, true);
  assert.equal(endResult.data.ended, true);
  assert.equal(harness.scheduler.tasks[0].cancelled, true);
  assert.equal(harness.scheduler.runNext(), false);
  assert.equal(harness.damagedTargets.length, 0);
  assert.equal(harness.chargeItem.quantity, 10);
  assert.equal(harness.source.capacitorChargeRatio, 1);
});

test("unresolved automatic-fire authority fails closed without consuming resources", () => {
  const harness = createHarness({
    isCreation: true,
    onlineCreationModuleTypeIDs: [95679],
  });
  harness.creationAuthorityState.authorityResolved = false;

  const result = harness.runtime.beginFire(harness.session, [[
    harness.moduleItem.itemID,
    [1, 0, 0],
    AUTO_FIRE_CONTRACT_MARKER,
  ]]);

  assert.equal(result.success, false);
  assert.equal(result.errorMsg, "AUTO_FIRE_AUTHORITY_UNAVAILABLE");
  assert.equal(harness.damagedTargets.length, 0);
  assert.equal(harness.chargeItem.quantity, 10);
  assert.equal(harness.source.capacitorChargeRatio, 1);
  assert.deepEqual(harness.notifications.at(-1), {
    name: "OnSkillShotFailed",
    idType: "clientID",
    payload: ["AutoFireTerminated", buildDict([])],
  });
});

test("ordinary non-Creation explicit auto-fire is not subject to Repeater authority", () => {
  const harness = createHarness();
  const states = [[
    harness.moduleItem.itemID,
    [1, 0, 0],
    AUTO_FIRE_CONTRACT_MARKER,
  ]];

  assert.equal(harness.runtime.beginFire(harness.session, states).success, true);
  assert.equal(harness.damagedTargets.length, 1);
});

test("authorized Repeater fire still uses shared collision, resources, damage, and FX", () => {
  const blocker = {
    ...buildEntity(303, { x: 400, y: 0, z: 0 }, 75),
    kind: "structure",
    damageable: false,
  };
  const harness = createHarness({
    additionalEntities: [blocker],
    isCreation: true,
    onlineCreationModuleTypeIDs: [95679],
  });

  const result = harness.runtime.beginFire(harness.session, [[
    harness.moduleItem.itemID,
    [1, 0, 0],
    AUTO_FIRE_CONTRACT_MARKER,
  ]]);

  assert.equal(result.success, true);
  assert.equal(harness.damagedTargets.length, 1);
  assert.equal(harness.damagedTargets[0].victim, blocker);
  assert.equal(harness.chargeItem.quantity, 9);
  assert.equal(harness.source.capacitorChargeRatio, 0.88);
  assert.equal(harness.effects.length, 1);
  assert.equal(harness.effects[0].guid, SKILL_SHOT_EFFECT_GUID);
  assert.equal(harness.effects[0].options.targetID, blocker.itemID);
});

test("a nearer physical object obstructs a skill shot before its intended target", () => {
  const blocker = {
    ...buildEntity(303, { x: 400, y: 0, z: 0 }, 75),
    kind: "structure",
    damageable: false,
  };
  const harness = createHarness({ additionalEntities: [blocker] });

  const result = harness.runtime.beginFire(harness.session, [
    [harness.moduleItem.itemID, { x: 1, y: 0, z: 0 }],
  ]);

  assert.equal(result.success, true);
  assert.equal(harness.damagedTargets.length, 1);
  assert.equal(harness.damagedTargets[0].victim, blocker);
  assert.equal(harness.effects[0].options.targetID, blocker.itemID);
});

test("the delayed Skill-Shot Cannon uses the latest server-received aim", () => {
  const harness = createHarness({
    moduleTypeID: 94076,
    targetPosition: { x: 0, y: 1_000, z: 0 },
  });
  const beginResult = harness.runtime.beginFire(harness.session, [
    [harness.moduleItem.itemID, [1, 0, 0]],
  ]);
  assert.equal(beginResult.success, true);
  assert.equal(harness.damagedTargets.length, 0);
  assert.equal(harness.scheduler.tasks[0].delayMs, 500);

  harness.runtime.turretStateUpdate(harness.session, [
    [harness.moduleItem.itemID, [0, 1, 0]],
  ]);
  harness.setNow(1_500);
  harness.scheduler.runNext();

  assert.equal(harness.damagedTargets.length, 1);
  assert.equal(harness.damagedTargets[0].victim, harness.target);
});

test("held beams tick, expose ramp metadata, update endpoints, and stop cleanly", () => {
  const harness = createHarness({
    moduleTypeID: 95317,
    family: "laserTurret",
    chargeMode: "crystal",
    cycleDurationMs: 2_000,
    rampMaxMultiplier: 2.3,
    rampDurationMs: 16_000,
  });
  const result = harness.runtime.beginHeldBeam(harness.session, [
    [harness.moduleItem.itemID, [1, 0, 0]],
  ]);
  assert.equal(result.success, true);
  assert.equal(result.data.rampCurveID, 0);
  assert.equal(result.data.rampDurationMs, 16_000);

  harness.scheduler.runNext();
  assert.equal(harness.damagedTargets.length, 1);
  assert.equal(harness.effects[0].options.graphicInfo.beamStateID, harness.moduleItem.itemID);
  assert.equal(harness.effects[0].options.start, true);

  harness.setNow(5_000);
  harness.runtime.heldBeamAimUpdate(harness.session, [
    [harness.moduleItem.itemID, [1, 0, 0]],
  ]);
  harness.setNow(9_000);
  harness.scheduler.runNext();
  assert.equal(harness.damagedTargets.length, 2);
  assert.equal(harness.damagedTargets[1].damage.kinetic, 41.25);

  harness.runtime.heldBeamAimUpdate(harness.session, [
    [harness.moduleItem.itemID, [0, 1, 0]],
  ]);
  assert.equal(harness.effects.at(-2).options.start, false);
  assert.equal(harness.effects.at(-1).options.start, true);

  const endResult = harness.runtime.endHeldBeam(
    harness.session,
    harness.moduleItem.itemID,
  );
  assert.equal(endResult.success, true);
  assert.equal(endResult.data.ended, true);
  assert.equal(harness.effects.at(-1).options.start, false);
});

test("a held skill-shot beam keeps hitting one target as damage ramps and caps", () => {
  const harness = createHarness({
    moduleTypeID: 95317,
    family: "laserTurret",
    chargeMode: "crystal",
    cycleDurationMs: 2_000,
    rampMaxMultiplier: 2.3,
    rampDurationMs: 16_000,
  });
  harness.source.capacitorCapacity = 200;
  const states = [[harness.moduleItem.itemID, [1, 0, 0]]];
  assert.equal(harness.runtime.beginHeldBeam(harness.session, states).success, true);

  for (let cycle = 0; cycle < 10; cycle += 1) {
    harness.setNow(1_000 + cycle * 2_000);
    if (cycle > 0) {
      assert.equal(harness.runtime.heldBeamAimUpdate(
        harness.session, states,
      ).data.updated, 1);
    }
    assert.equal(harness.scheduler.runNext(), true);
    assert.equal(harness.damagedTargets.length, cycle + 1);
    assert.equal(harness.damagedTargets[cycle].victim, harness.target);
    assert.equal(harness.effects.length, 1);
    assert.equal(harness.effects[0].options.start, true);
    assert.equal(harness.effects[0].options.targetID, harness.target.itemID);
  }

  assert.equal(harness.damagedTargets[0].damage.kinetic, 25);
  for (const [cycle, expectedDamage] of [
    [1, 29.0625],
    [4, 41.25],
    [8, 57.5],
    [9, 57.5],
  ]) {
    assert.ok(Math.abs(
      harness.damagedTargets[cycle].damage.kinetic - expectedDamage,
    ) < 1e-9);
  }
  assert.equal(harness.crystalVolatilityApplications.length, 10);
  assert.equal(harness.notifications.filter(
    (entry) => entry.name === "OnSkillShotSucceeded",
  ).length, 1);

  assert.equal(harness.runtime.endHeldBeam(
    harness.session, harness.moduleItem.itemID,
  ).data.ended, true);
  assert.equal(harness.effects.at(-1).options.start, false);
  assert.equal(harness.scheduler.runNext(), false);
  assert.equal(harness.damagedTargets.length, 10);
});

test("held-beam utility collisions keep resources and FX but do not also deal combat damage", () => {
  const harness = createHarness({
    moduleTypeID: 95317,
    family: "laserTurret",
    chargeMode: "crystal",
    cycleDurationMs: 2_000,
    rampMaxMultiplier: 2.3,
    rampDurationMs: 16_000,
    applySkillShotUtilityHit: () => ({
      matched: true,
      success: true,
      blockCombatDamage: true,
      data: { transferredQuantity: 13 },
    }),
  });

  const result = harness.runtime.beginHeldBeam(harness.session, [
    [harness.moduleItem.itemID, [1, 0, 0]],
  ]);
  assert.equal(result.success, true);
  harness.scheduler.runNext();

  assert.equal(harness.utilityHits.length, 1);
  assert.equal(harness.utilityHits[0].targetEntity, harness.target);
  assert.equal(harness.utilityHits[0].rampMultiplier, 1);
  assert.equal(harness.damagedTargets.length, 0);
  assert.equal(harness.source.capacitorChargeRatio, 0.88);
  assert.equal(harness.crystalVolatilityApplications.length, 1);
  assert.equal(harness.effects.length, 1);
  assert.equal(harness.effects[0].options.targetID, harness.target.itemID);
  assert.equal(harness.effects[0].options.graphicInfo.endpointMode, "hit");
});

test("a blocked utility transfer stops the beam and reports its authored failure", () => {
  const harness = createHarness({
    moduleTypeID: 95503,
    family: "laserTurret",
    chargeMode: "crystal",
    cycleDurationMs: 3_000,
    applySkillShotUtilityHit: () => ({
      matched: true,
      success: false,
      stopReason: "cargo",
      blockCombatDamage: true,
    }),
  });

  assert.equal(harness.runtime.beginHeldBeam(harness.session, [
    [harness.moduleItem.itemID, [1, 0, 0]],
  ]).success, true);
  harness.scheduler.runNext();

  assert.equal(harness.damagedTargets.length, 0);
  assert.equal(harness.scheduler.runNext(), false);
  assert.equal(harness.effects.length, 2);
  assert.equal(harness.effects[0].options.start, true);
  assert.equal(harness.effects[1].options.start, false);
  assert.ok(!harness.notifications.some(
    (entry) => entry.name === "OnSkillShotSucceeded",
  ));
  assert.deepEqual(harness.notifications.at(-1), {
    name: "OnSkillShotFailed",
    idType: "clientID",
    payload: ["NotEnoughCargoSpace", buildDict([])],
  });
});

test("held-beam utility authority receives the first physical obstruction", () => {
  const blocker = {
    ...buildEntity(303, { x: 400, y: 0, z: 0 }, 75),
    kind: "asteroid",
  };
  const harness = createHarness({
    moduleTypeID: 95317,
    family: "laserTurret",
    chargeMode: "crystal",
    additionalEntities: [blocker],
    applySkillShotUtilityHit: () => ({
      matched: true,
      success: true,
      blockCombatDamage: true,
    }),
  });

  assert.equal(harness.runtime.beginHeldBeam(harness.session, [
    [harness.moduleItem.itemID, [1, 0, 0]],
  ]).success, true);
  harness.scheduler.runNext();

  assert.equal(harness.utilityHits.length, 1);
  assert.equal(harness.utilityHits[0].targetEntity, blocker);
  assert.equal(harness.damagedTargets.length, 0);
  assert.equal(harness.effects[0].options.targetID, blocker.itemID);
});

test("an immediate held-beam restart sends a marshalable cooldown notification", () => {
  const harness = createHarness({
    moduleTypeID: 99999,
    family: "laserTurret",
    chargeMode: "crystal",
    cycleDurationMs: 2_000,
    physicsGun: {
      pickup: () => ({ success: true, data: { worldEntityID: 202 } }),
      update: () => true,
      release: () => ({ success: true }),
    },
  });
  const states = [[harness.moduleItem.itemID, [1, 0, 0]]];
  assert.equal(harness.runtime.beginHeldBeam(harness.session, states).success, true);
  harness.scheduler.runNext();
  assert.equal(harness.runtime.endHeldBeam(
    harness.session, harness.moduleItem.itemID,
  ).data.ended, true);
  const result = harness.runtime.beginHeldBeam(harness.session, states);
  assert.equal(result.success, false);
  assert.equal(result.errorMsg, "MODULE_REACTIVATING");
  const notification = harness.notifications.at(-1);
  assert.equal(notification.name, "OnSkillShotFailed");
  assert.equal(notification.payload[0], "ModuleReactivationDelayed2");
  assert.deepEqual(notification.payload[1], buildDict([]));
  assert.doesNotThrow(() => marshalEncode(
    [0, [1, notification.payload]],
    { compatibilityProfile: "frontier" },
  ));
});

test("Physics Gun grabs once, follows aim, and releases on EndHeldBeam without mining or damage", () => {
  const calls: any[] = [];
  const physicsGun = {
    pickup(_scene, _session, target, moduleID, direction, options) {
      calls.push(["pickup", target.itemID, moduleID, direction.x,
        options.contactPoint]);
      return { success: true, data: { worldEntityID: 8600 } };
    },
    update(_scene, id, _session, moduleID, direction) {
      calls.push(["update", id, moduleID, direction.y]);
      return true;
    },
    release(_scene, id, _session, moduleID) {
      calls.push(["release", id, moduleID]);
      return { success: true };
    },
  };
  const harness = createHarness({
    moduleTypeID: 99999,
    family: "laserTurret",
    chargeMode: "crystal",
    cycleDurationMs: 2_000,
    physicsGun,
    applySkillShotUtilityHit: () => {
      throw new Error("Physics Gun must not mine");
    },
  });
  const grabbed = { ...harness.target, itemID: 8600, kind: "detachedDungeonProp" };
  harness.scene.dynamicEntities.set(grabbed.itemID, grabbed);
  harness.scene.getEntityByID = (id) => id === grabbed.itemID ? grabbed :
    id === harness.source.itemID ? harness.source : harness.target;
  assert.equal(harness.runtime.beginHeldBeam(harness.session,
    [[harness.moduleItem.itemID, [1, 0, 0]]]).success, true);
  harness.scheduler.runNext();
  assert.deepEqual(calls[0], ["pickup", harness.target.itemID,
    harness.moduleItem.itemID, 1, { x: 950, y: 0, z: 0 }]);
  assert.equal(harness.effects[0].options.targetID, grabbed.itemID);
  assert.deepEqual(harness.effects[0].options.graphicInfo.targetOffset,
    [950, 0, 0]);
  assert.equal(harness.damagedTargets.length, 0);
  harness.runtime.heldBeamAimUpdate(harness.session,
    [[harness.moduleItem.itemID, [0, 1, 0]]]);
  grabbed.position.x = 1_200;
  // A carried prop must remain held while the reticle is still, so the ship
  // can move it without continuous client aim updates.
  harness.setNow(10_000);
  harness.scheduler.runNext();
  assert.equal(calls.filter((call) => call[0] === "pickup").length, 1);
  assert.ok(calls.some((call) => call[0] === "update" && call[3] === 1));
  assert.equal(harness.runtime.endHeldBeam(harness.session,
    harness.moduleItem.itemID).data.ended, true);
  assert.deepEqual(calls.at(-1), ["release", grabbed.itemID, harness.moduleItem.itemID]);
  assert.equal(harness.effects.at(-1).options.start, false);
  assert.deepEqual(harness.effects.at(-1).options.graphicInfo.targetOffset,
    [1_150, 0, 0]);
  assert.equal(harness.damagedTargets.length, 0);
  assert.equal(harness.utilityHits.length, 0);
});

test("skillShot service exposes the exact RPC method and BeginFireAck shapes", () => {
  const calls: any[] = [];
  const runtime = {
    beginFire(session, states) {
      calls.push(["BeginFire", session, states]);
      return { success: true, data: { tFirstCycleMs: Date.UTC(2026, 8, 19) } };
    },
    turretStateUpdate(session, states) {
      calls.push(["TurretStateUpdate", session, states]);
    },
    endFire(session) {
      calls.push(["EndFire", session]);
    },
    beginHeldBeam(session, states) {
      calls.push(["BeginHeldBeam", session, states]);
      return {
        success: true,
        data: {
          tFirstCycleMs: Date.UTC(2026, 8, 19),
          rampStartedAtMs: Date.UTC(2026, 8, 19),
          rampCurveID: 0,
          rampDurationMs: 250,
        },
      };
    },
    heldBeamAimUpdate(session, states) {
      calls.push(["HeldBeamAimUpdate", session, states]);
    },
    endHeldBeam(session, moduleID) {
      calls.push(["EndHeldBeam", session, moduleID]);
    },
  };
  const service = new SkillShotService({ runtime });
  const session = { _space: { shipID: 101 } };
  const states = [[301, [1, 0, 0]]];

  const singleAck = service.Handle_BeginFire([states], session);
  assert.equal(service.name, "skillShot");
  assert.equal(singleAck.header[0].value, "frontier.skillshot.common.BeginFireAck");
  assert.equal(singleAck.header[1][0].header[0].value, "datetime.datetime");
  assert.equal(singleAck.header[1][0].header[1].length, 7);
  assert.equal(singleAck.header[1][1], null);
  assert.doesNotThrow(() => marshalEncode(singleAck, { compatibilityProfile: "frontier" }));

  const heldAck = service.Handle_BeginHeldBeam([states], session);
  assert.equal(heldAck.header[1][1].header[0].value, "datetime.datetime");
  assert.equal(heldAck.header[1][0].header[1].length, 7);
  assert.equal(heldAck.header[1][1].header[1].length, 7);
  assert.ok(!JSON.stringify(heldAck).includes("datetime.timezone"));
  assert.ok(!JSON.stringify(heldAck).includes("datetime.timedelta"));
  assert.equal(heldAck.header[1][2], 0);
  assert.equal(heldAck.header[1][3], 250);
  assert.doesNotThrow(() => marshalEncode(heldAck, { compatibilityProfile: "frontier" }));

  service.Handle_TurretStateUpdate([states], session);
  service.Handle_EndFire([], session);
  service.Handle_HeldBeamAimUpdate([states], session);
  service.Handle_EndHeldBeam([301], session);
  assert.deepEqual(calls.map((entry) => entry[0]), [
    "BeginFire",
    "BeginHeldBeam",
    "TurretStateUpdate",
    "EndFire",
    "HeldBeamAimUpdate",
    "EndHeldBeam",
  ]);
});
