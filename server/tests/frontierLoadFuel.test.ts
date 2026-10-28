"use strict";

/**
 * Frontier dogmaIM.LoadFuel coverage.
 *
 * Layer 1 drives fuelTankRuntime.loadFuelIntoShipTank with injected store
 * fakes (validation, source selection, atomicity/rollback). Layer 2 drives
 * DogmaService.Handle_LoadFuel against the real item store inside the
 * attested disposable game store (duplicate suppression, persistence,
 * notification shape). Run through: npm run test:frontier-server
 * (scripts/Tests/run-isolated-tests.js).
 */

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  ATTRIBUTE_FUEL_CAPACITY,
  ATTRIBUTE_FUEL_CHARGE,
  ATTRIBUTE_FUEL_CONTAINMENT_BURDEN,
  ATTRIBUTE_FUEL_EFFICIENCY,
  ATTRIBUTE_FUEL_THERMAL_INEFFICIENCY,
  ATTRIBUTE_FUEL_VOLATILITY,
  ATTRIBUTE_WARP_FUEL_RATE,
  appendFuelQueueBatch,
  appendFuelQueueBatchByReserveCapacity,
  calculateContinuousFuelPowerFactor,
  calculateFuelQueueProperties,
  calculateFueledCapacitorRecharge,
  calculateWarpFuelConsumptionRate,
  collectFuelSourceStacks,
  getFuelEfficiency,
  getShipFuelCharge,
  getShipFuelQueue,
  getShipFuelProperties,
  getShipFuelTypeID,
  initializeNewShipFuelTank,
  loadFuelIntoShipTank,
  normalizeFuelQueue,
  normalizeRequestedFuelItemIDs,
  partitionFuelQueueByReserveCapacity,
  resolveInitialShipFuelCapacity,
  resolveShipFuelTank,
} = require("../src/services/frontier/fuelTankRuntime");
const itemStore = require("../src/services/inventory/itemStore");
const {
  FREE_STATION_FUEL_CUSTOM_INFO,
} = itemStore;
const DogmaService = require("../src/services/dogma/dogmaService");
const {
  advanceEntityCapacitorRechargeForTesting,
  advanceEntityBlackstartRechargeForTesting,
  calculateCreationPowerStateForTesting,
  calculateRegularShipFuelPowerStateForTesting,
  checkEntityWarpCapacitorAvailabilityForTesting,
  checkEntityWarpFuelAvailabilityForTesting,
  consumeEntityWarpCapacitorForTesting,
  WARP_CAPACITOR_COST_RATIO,
} = require("../src/space/runtime")._testing;

const FUEL_TYPE_UNSTABLE = 77818; // group 4598 (corvette/hydrogen fuel)
const FUEL_TYPE_EU_90 = 78437;
const FUEL_TYPE_SOF_80 = 78515;
const FUEL_TYPE_EU_40 = 78516;
const FUEL_TYPE_SOF_40 = 84868;
const FUEL_TYPE_D2 = 88319;
const FUEL_TYPE_D1 = 88335;
const CREATION_SHIP_TYPE = 95276;
const REGULAR_FUEL_SHIP_TYPE = 91107;
const REGULAR_TANKLESS_SHIP_TYPE = 606;
const POWER_GENERATOR_TYPE = 77753; // group 4741 (hydrogen engine)
const CRUDE_ENGINE_TYPE = 78490; // group 4619 (crude engine)
const TANK_CAPACITY = 2250;

// Seeded default character present in every store baseline; the main
// handshake suite claims 140000005, so use a different one to stay disjoint.
const OWNER_ID = 140000004;
const OTHER_OWNER_ID = 96000202;
const SHIP_ID = 500000001;
const STATION_ID = 64000001;

function fakeTypeResolver(overrides: Record<string, any> = {}) {
  const records: Record<string, any> = {
    [FUEL_TYPE_UNSTABLE]: { typeID: FUEL_TYPE_UNSTABLE, groupID: 4598 },
    [FUEL_TYPE_EU_90]: { typeID: FUEL_TYPE_EU_90, groupID: 4738 },
    [FUEL_TYPE_SOF_80]: { typeID: FUEL_TYPE_SOF_80, groupID: 4738 },
    [FUEL_TYPE_EU_40]: { typeID: FUEL_TYPE_EU_40, groupID: 4738 },
    [FUEL_TYPE_SOF_40]: { typeID: FUEL_TYPE_SOF_40, groupID: 4738 },
    [FUEL_TYPE_D2]: { typeID: FUEL_TYPE_D2, groupID: 4738 },
    [FUEL_TYPE_D1]: { typeID: FUEL_TYPE_D1, groupID: 4738 },
    222222: { typeID: 222222, groupID: 34 }, // not fuel
    [CREATION_SHIP_TYPE]: { typeID: CREATION_SHIP_TYPE, categoryID: 6 },
    [REGULAR_FUEL_SHIP_TYPE]: { typeID: REGULAR_FUEL_SHIP_TYPE, categoryID: 6 },
    [REGULAR_TANKLESS_SHIP_TYPE]: { typeID: REGULAR_TANKLESS_SHIP_TYPE, categoryID: 6 },
    [POWER_GENERATOR_TYPE]: { typeID: POWER_GENERATOR_TYPE, groupID: 4741 },
    [CRUDE_ENGINE_TYPE]: { typeID: CRUDE_ENGINE_TYPE, groupID: 4619 },
    ...overrides,
  };
  return (typeID) => records[typeID] || null;
}

function buildFakeStore({ items = [], failConsumeForItemID = null }: Record<string, any> = {}) {
  const byID = new Map<number, Record<string, any>>(items.map((item) => [item.itemID, { ...item }]));
  const consumeCalls: any[] = [];
  const grantCalls: any[] = [];
  let shipUpdate = null;
  return {
    consumeCalls,
    grantCalls,
    getItem: (itemID) => byID.get(itemID) || null,
    getShipUpdate: () => shipUpdate,
    deps: {
      resolveItemByTypeID: fakeTypeResolver(),
      getCreationTemplate: (typeID) =>
        typeID === CREATION_SHIP_TYPE ? { _key: CREATION_SHIP_TYPE } : null,
      getTypeDogmaAttributes: (typeID) => {
        if (typeID === REGULAR_FUEL_SHIP_TYPE) {
          return { [ATTRIBUTE_FUEL_CAPACITY]: 3000 };
        }
        if (typeID === FUEL_TYPE_UNSTABLE) {
          return {
            [ATTRIBUTE_FUEL_EFFICIENCY]: 8,
            [ATTRIBUTE_FUEL_THERMAL_INEFFICIENCY]: 10,
            [ATTRIBUTE_FUEL_CONTAINMENT_BURDEN]: 5,
            [ATTRIBUTE_FUEL_VOLATILITY]: 0.5,
          };
        }
        const crudeFuelProperties = {
          [FUEL_TYPE_EU_90]: [90, 23, 14, 0.5],
          [FUEL_TYPE_SOF_80]: [80, 26, 14, 2.6],
          [FUEL_TYPE_EU_40]: [40, 18, 10, 0.6],
          [FUEL_TYPE_SOF_40]: [40, 20, 10, 1.75],
          [FUEL_TYPE_D2]: [15, 7, 4, 1],
          [FUEL_TYPE_D1]: [10, 4, 3, 1],
        };
        if (crudeFuelProperties[typeID] !== undefined) {
          const [efficiency, thermal, containment, volatility] =
            crudeFuelProperties[typeID];
          return {
            [ATTRIBUTE_FUEL_EFFICIENCY]: efficiency,
            [ATTRIBUTE_FUEL_THERMAL_INEFFICIENCY]: thermal,
            [ATTRIBUTE_FUEL_CONTAINMENT_BURDEN]: containment,
            [ATTRIBUTE_FUEL_VOLATILITY]: volatility,
          };
        }
        return { [ATTRIBUTE_FUEL_CAPACITY]: 0 };
      },
      buildEffectiveItemAttributeMap: (item) => {
        if (item && item.typeID === POWER_GENERATOR_TYPE) {
          return {
            55: 1,
            [ATTRIBUTE_WARP_FUEL_RATE]: -0.6,
          };
        }
        if (item && item.typeID === CRUDE_ENGINE_TYPE) {
          return {
            55: 1,
            [ATTRIBUTE_WARP_FUEL_RATE]: -0.5,
          };
        }
        return {};
      },
      findItemById: (itemID) => byID.get(itemID) || null,
      listContainerItems: (ownerID, locationID, flagID) =>
        [...byID.values()].filter(
          (item) =>
            item.ownerID === ownerID &&
            item.locationID === locationID &&
            (flagID === null || item.flagID === flagID),
        ),
      consumeInventoryItemQuantity: (itemID, quantity) => {
        consumeCalls.push({ itemID, quantity });
        if (itemID === failConsumeForItemID) {
          return { success: false, errorMsg: "WRITE_ERROR" };
        }
        const item = byID.get(itemID);
        if (!item || item.stacksize < quantity) {
          return { success: false, errorMsg: "INSUFFICIENT_ITEMS" };
        }
        item.stacksize -= quantity;
        const removed = item.stacksize === 0;
        if (removed) {
          byID.delete(itemID);
        }
        return {
          success: true,
          data: {
            quantity,
            changes: [{ removed, item: { ...item }, previousData: {} }],
          },
        };
      },
      grantItemsToCharacterLocation: (ownerID, locationID, flagID, specs) => {
        grantCalls.push({ ownerID, locationID, flagID, specs });
        return { success: true, data: { items: [] } };
      },
      updateShipItem: (shipID, updater) => {
        const current = byID.get(shipID);
        if (!current) {
          return { success: false, errorMsg: "SHIP_NOT_FOUND" };
        }
        const next = updater(current);
        byID.set(shipID, next);
        shipUpdate = next;
        return { success: true, data: next };
      },
    },
  };
}

function fuelStack(itemID, quantity, overrides: Record<string, any> = {}) {
  return {
    itemID,
    typeID: FUEL_TYPE_UNSTABLE,
    ownerID: OWNER_ID,
    locationID: SHIP_ID,
    flagID: 5,
    stacksize: quantity,
    singleton: 0,
    ...overrides,
  };
}

function shipItem(overrides: Record<string, any> = {}) {
  return {
    itemID: SHIP_ID,
    typeID: CREATION_SHIP_TYPE,
    ownerID: OWNER_ID,
    locationID: STATION_ID,
    flagID: 4,
    categoryID: 6,
    singleton: 1,
    conditionState: { fuelCharge: 0 },
    ...overrides,
  };
}

function engineItem(typeID, itemID = 600100) {
  return {
    itemID,
    typeID,
    ownerID: OWNER_ID,
    locationID: SHIP_ID,
    flagID: 37,
    stacksize: 1,
    singleton: 1,
  };
}

test("fuel tanks are enabled by Creation modules or a regular hull Dogma attribute", () => {
  const deps = buildFakeStore().deps;
  assert.deepEqual(
    resolveShipFuelTank(shipItem(), TANK_CAPACITY, deps),
    {
      isShip: true,
      creationType: true,
      source: "creation-module",
      baseCapacity: 0,
      capacity: TANK_CAPACITY,
      supported: true,
    },
  );
  assert.deepEqual(
    resolveShipFuelTank(
      shipItem({ typeID: REGULAR_FUEL_SHIP_TYPE }),
      3000,
      deps,
    ),
    {
      isShip: true,
      creationType: false,
      source: "hull-attribute",
      baseCapacity: 3000,
      capacity: 3000,
      supported: true,
    },
  );
});

test("new Wend and Creation-family hulls initialize to their current full capacity", () => {
  const modifierEntries = [{
    modifiedAttributeID: ATTRIBUTE_FUEL_CAPACITY,
    operation: 2,
    value: 2250,
  }];
  const creationCapacity = resolveInitialShipFuelCapacity(
    shipItem(),
    OWNER_ID,
    {
      buildEffectiveItemAttributeMap: () => ({ [ATTRIBUTE_FUEL_CAPACITY]: 0 }),
      getCreationTemplate: () => ({ _key: CREATION_SHIP_TYPE }),
      getCreationDogmaContext: () => ({
        success: true,
        data: { shipAttributeModifierEntries: modifierEntries },
      }),
      applyModifierGroups: (attributes, entries) => {
        for (const entry of entries) {
          attributes[entry.modifiedAttributeID] =
            Number(attributes[entry.modifiedAttributeID] || 0) + Number(entry.value || 0);
        }
      },
    },
  );
  assert.equal(creationCapacity, 2250);

  let persisted = null;
  const wend = {
    ...shipItem(),
    typeID: 87698,
    conditionState: { fuelCharge: 0 },
  };
  const result = initializeNewShipFuelTank(wend, OWNER_ID, {
    buildEffectiveItemAttributeMap: () => ({ [ATTRIBUTE_FUEL_CAPACITY]: 200 }),
    getCreationTemplate: () => null,
    updateShipItem: (_shipID, updater) => {
      persisted = updater(wend);
      return { success: true, data: persisted };
    },
  });
  assert.equal(result.success, true);
  assert.equal(result.data.capacity, 200);
  assert.equal(persisted.conditionState.fuelCharge, 200);
  assert.equal(persisted.conditionState.fuelTypeID, FUEL_TYPE_UNSTABLE);
  assert.deepEqual(persisted.conditionState.fuelQueue, [{
    fuelTypeID: FUEL_TYPE_UNSTABLE,
    quantity: 200,
  }]);
});

test("a capacity value cannot opt a tankless regular ship or non-ship into fuel", () => {
  const deps = buildFakeStore().deps;
  const tankless = resolveShipFuelTank(
    shipItem({ typeID: REGULAR_TANKLESS_SHIP_TYPE }),
    TANK_CAPACITY,
    deps,
  );
  assert.equal(tankless.isShip, true);
  assert.equal(tankless.supported, false);
  assert.equal(tankless.source, null);

  const nonShip = resolveShipFuelTank(
    shipItem({ typeID: 222222, categoryID: 4 }),
    TANK_CAPACITY,
    deps,
  );
  assert.equal(nonShip.isShip, false);
  assert.equal(nonShip.supported, false);
});

test("LoadFuel: regular ships use their authored hull tank with a fitted engine", () => {
  const store = buildFakeStore({
    items: [
      shipItem({ typeID: REGULAR_FUEL_SHIP_TYPE }),
      engineItem(POWER_GENERATOR_TYPE),
      fuelStack(600001, 500),
    ],
  });
  const result = loadFuelIntoShipTank({
    characterID: OWNER_ID,
    shipID: SHIP_ID,
    fuelTypeID: FUEL_TYPE_UNSTABLE,
    quantity: 400,
    fuelCapacity: 3000,
    deps: store.deps,
  });
  assert.equal(result.success, true);
  assert.equal(result.data.nextFuelCharge, 400);
});

test("LoadFuel: a Power Generator enables only hydrogen fuel on a regular ship", () => {
  const hydrogenStore = buildFakeStore({
    items: [
      shipItem({ typeID: REGULAR_FUEL_SHIP_TYPE }),
      engineItem(POWER_GENERATOR_TYPE),
      fuelStack(600001, 300),
    ],
  });
  const accepted = loadFuelIntoShipTank({
    characterID: OWNER_ID,
    shipID: SHIP_ID,
    fuelTypeID: FUEL_TYPE_UNSTABLE,
    quantity: 200,
    fuelCapacity: 3000,
    deps: hydrogenStore.deps,
  });
  assert.equal(accepted.success, true);

  const crudeStore = buildFakeStore({
    items: [
      shipItem({ typeID: REGULAR_FUEL_SHIP_TYPE }),
      engineItem(POWER_GENERATOR_TYPE),
      fuelStack(600002, 300, { typeID: FUEL_TYPE_EU_40 }),
    ],
  });
  const rejected = loadFuelIntoShipTank({
    characterID: OWNER_ID,
    shipID: SHIP_ID,
    fuelTypeID: FUEL_TYPE_EU_40,
    quantity: 200,
    fuelCapacity: 3000,
    deps: crudeStore.deps,
  });
  assert.equal(rejected.success, false);
  assert.equal(rejected.errorMsg, "FUEL_TYPE_INCOMPATIBLE");
  assert.deepEqual(crudeStore.consumeCalls, []);
});

test("LoadFuel: a Crude Engine enables only crude fuel on a regular ship", () => {
  const crudeStore = buildFakeStore({
    items: [
      shipItem({ typeID: REGULAR_FUEL_SHIP_TYPE }),
      engineItem(CRUDE_ENGINE_TYPE),
      fuelStack(600001, 300, { typeID: FUEL_TYPE_EU_40 }),
    ],
  });
  const accepted = loadFuelIntoShipTank({
    characterID: OWNER_ID,
    shipID: SHIP_ID,
    fuelTypeID: FUEL_TYPE_EU_40,
    quantity: 200,
    fuelCapacity: 3000,
    deps: crudeStore.deps,
  });
  assert.equal(accepted.success, true);

  const hydrogenStore = buildFakeStore({
    items: [
      shipItem({ typeID: REGULAR_FUEL_SHIP_TYPE }),
      engineItem(CRUDE_ENGINE_TYPE),
      fuelStack(600002, 300),
    ],
  });
  const rejected = loadFuelIntoShipTank({
    characterID: OWNER_ID,
    shipID: SHIP_ID,
    fuelTypeID: FUEL_TYPE_UNSTABLE,
    quantity: 200,
    fuelCapacity: 3000,
    deps: hydrogenStore.deps,
  });
  assert.equal(rejected.success, false);
  assert.equal(rejected.errorMsg, "FUEL_TYPE_INCOMPATIBLE");
  assert.deepEqual(hydrogenStore.consumeCalls, []);
});

test("LoadFuel: a regular ship without a fitted engine cannot be fueled", () => {
  const store = buildFakeStore({
    items: [
      shipItem({ typeID: REGULAR_FUEL_SHIP_TYPE }),
      fuelStack(600001, 300),
    ],
  });
  const result = loadFuelIntoShipTank({
    characterID: OWNER_ID,
    shipID: SHIP_ID,
    fuelTypeID: FUEL_TYPE_UNSTABLE,
    quantity: 200,
    fuelCapacity: 3000,
    deps: store.deps,
  });
  assert.equal(result.success, false);
  assert.equal(result.errorMsg, "FUEL_ENGINE_MISSING");
  assert.deepEqual(store.consumeCalls, []);
});

test("LoadFuel: Creation ships continue accepting hydrogen and crude fuel", () => {
  for (const [fuelTypeID, itemID] of [
    [FUEL_TYPE_UNSTABLE, 600001],
    [FUEL_TYPE_EU_40, 600002],
  ]) {
    const store = buildFakeStore({
      items: [shipItem(), fuelStack(itemID, 300, { typeID: fuelTypeID })],
    });
    const result = loadFuelIntoShipTank({
      characterID: OWNER_ID,
      shipID: SHIP_ID,
      fuelTypeID,
      quantity: 200,
      fuelCapacity: TANK_CAPACITY,
      deps: store.deps,
    });
    assert.equal(result.success, true, `fuelTypeID=${fuelTypeID}`);
  }
});

test("LoadFuel: successful load consumes source once and raises fuelCharge", () => {
  const store = buildFakeStore({
    items: [shipItem(), fuelStack(600001, 1500)],
  });
  const result = loadFuelIntoShipTank({
    characterID: OWNER_ID,
    shipID: SHIP_ID,
    fuelTypeID: FUEL_TYPE_UNSTABLE,
    quantity: 1000,
    fuelCapacity: TANK_CAPACITY,
    deps: store.deps,
  });
  assert.equal(result.success, true);
  assert.equal(result.data.loadedQuantity, 1000);
  assert.equal(result.data.previousFuelCharge, 0);
  assert.equal(result.data.nextFuelCharge, 1000);
  assert.deepEqual(store.consumeCalls, [{ itemID: 600001, quantity: 1000 }]);
  assert.equal(store.getItem(600001).stacksize, 500);
  assert.equal(store.getShipUpdate().conditionState.fuelCharge, 1000);
  assert.equal(store.getShipUpdate().conditionState.fuelTypeID, FUEL_TYPE_UNSTABLE);
  assert.deepEqual(store.getShipUpdate().conditionState.fuelQueue, [
    { fuelTypeID: FUEL_TYPE_UNSTABLE, quantity: 1000 },
  ]);
  assert.equal(result.data.fuelTypeID, FUEL_TYPE_UNSTABLE);
  assert.equal(result.data.changes.length, 1);
});

test("LoadFuel: unlike fuel types append behind the fuel already in the tank", () => {
  const store = buildFakeStore({
    items: [
      shipItem({
        conditionState: {
          fuelCharge: 100,
          fuelTypeID: FUEL_TYPE_EU_40,
        },
      }),
      fuelStack(600001, 100),
    ],
  });
  const result = loadFuelIntoShipTank({
    characterID: OWNER_ID,
    shipID: SHIP_ID,
    fuelTypeID: FUEL_TYPE_UNSTABLE,
    quantity: 100,
    fuelCapacity: TANK_CAPACITY,
    deps: store.deps,
  });
  assert.equal(result.success, true);
  assert.deepEqual(store.consumeCalls, [{ itemID: 600001, quantity: 100 }]);
  assert.deepEqual(result.data.fuelQueue, [
    { fuelTypeID: FUEL_TYPE_EU_40, quantity: 100 },
    { fuelTypeID: FUEL_TYPE_UNSTABLE, quantity: 100 },
  ]);
  assert.equal(result.data.fuelTypeID, FUEL_TYPE_EU_40);
  assert.equal(result.data.fuelProperties.fuelEfficiency, 40);
  assert.equal(result.data.fuelProperties.fuelThermalInefficiency, 18);
  assert.equal(result.data.fuelProperties.fuelContainmentBurden, 10);
  assert.equal(result.data.fuelProperties.fuelVolatility, 0.6);
});

test("fuel queue normalization preserves order and only coalesces adjacent batches", () => {
  assert.deepEqual(normalizeFuelQueue([
    { fuelTypeID: FUEL_TYPE_EU_40, quantity: 10 },
    { fuelTypeID: FUEL_TYPE_EU_40, quantity: 5 },
    { fuelTypeID: FUEL_TYPE_UNSTABLE, quantity: 7 },
    { fuelTypeID: FUEL_TYPE_EU_40, quantity: 3 },
  ]), [
    { fuelTypeID: FUEL_TYPE_EU_40, quantity: 15 },
    { fuelTypeID: FUEL_TYPE_UNSTABLE, quantity: 7 },
    { fuelTypeID: FUEL_TYPE_EU_40, quantity: 3 },
  ]);
  assert.deepEqual(
    appendFuelQueueBatch([
      { fuelTypeID: FUEL_TYPE_UNSTABLE, quantity: 7 },
    ], FUEL_TYPE_UNSTABLE, 3),
    [{ fuelTypeID: FUEL_TYPE_UNSTABLE, quantity: 10 }],
  );
});

test("fuel properties come from the head of the FIFO queue", () => {
  const deps = buildFakeStore().deps;
  const fuelQueue = [
    { fuelTypeID: FUEL_TYPE_UNSTABLE, quantity: 100 },
    { fuelTypeID: FUEL_TYPE_EU_40, quantity: 300 },
  ];
  assert.deepEqual(calculateFuelQueueProperties(fuelQueue, deps), {
    totalQuantity: 400,
    fuelTypeCount: 2,
    activeFuelTypeID: FUEL_TYPE_UNSTABLE,
    fuelEfficiency: 8,
    fuelThermalInefficiency: 10,
    fuelContainmentBurden: 5,
    fuelVolatility: 0.5,
  });
  assert.deepEqual(
    getShipFuelProperties({
      conditionState: { fuelCharge: 400, fuelQueue },
    }, deps),
    calculateFuelQueueProperties(fuelQueue, deps),
  );
});

test("Fuel Blister fuel remains in a reserve-last tier across refueling", () => {
  const initial = partitionFuelQueueByReserveCapacity([
    { fuelTypeID: FUEL_TYPE_UNSTABLE, quantity: 500 },
    { fuelTypeID: FUEL_TYPE_EU_40, quantity: 100 },
  ], 750, 250);
  assert.deepEqual(initial, [
    { fuelTypeID: FUEL_TYPE_UNSTABLE, quantity: 500 },
    { fuelTypeID: FUEL_TYPE_EU_40, quantity: 100, reserve: true },
  ]);

  // Once the ordinary tank has been consumed, a refuel goes back into that
  // tank ahead of the sealed reserve rather than behind it in global FIFO.
  const refueled = appendFuelQueueBatchByReserveCapacity([
    { fuelTypeID: FUEL_TYPE_EU_40, quantity: 100, reserve: true },
  ], FUEL_TYPE_UNSTABLE, 200, 750, 250);
  assert.deepEqual(refueled, [
    { fuelTypeID: FUEL_TYPE_UNSTABLE, quantity: 200 },
    { fuelTypeID: FUEL_TYPE_EU_40, quantity: 100, reserve: true },
  ]);
  assert.equal(calculateFuelQueueProperties(refueled, buildFakeStore().deps).activeFuelTypeID,
    FUEL_TYPE_UNSTABLE);
});

test("Blackstart solar recharge survives power-off and stops in shadow, warp, or a berth", () => {
  const buildEntity = (): any => ({
    capacitorCapacity: 200,
    capacitorChargeRatio: 0,
    conditionState: { charge: 0 },
    creationPowerState: {
      blackstartCapacity: 100,
      blackstartSolarChargeRate: 0.3,
    },
    kind: "ship",
    mode: "STOP",
    passiveDerivedState: { attributes: {} },
    persistSpaceState: false,
    temperatureState: { externalTemperature: 150, shadowed: false },
  });
  const lit = buildEntity();
  const result = advanceEntityBlackstartRechargeForTesting(lit, 10, 1000);
  assert.equal(result.reason, "direct-starlight");
  assert.equal(result.rechargedEnergy, 3);
  assert.equal(lit.capacitorChargeRatio, 0.015);

  const poweredOff = buildEntity();
  poweredOff.creationPowerState.poweredOff = true;
  assert.equal(
    advanceEntityBlackstartRechargeForTesting(poweredOff, 10, 1000).rechargedEnergy,
    3,
    "Blackstart remains available to recover a powered-off Creation",
  );

  const shadowed = buildEntity();
  shadowed.temperatureState.shadowed = true;
  assert.equal(
    advanceEntityBlackstartRechargeForTesting(shadowed, 10, 1000).rechargedEnergy,
    0,
  );
  const warping = buildEntity();
  warping.mode = "WARP";
  assert.equal(
    advanceEntityBlackstartRechargeForTesting(warping, 10, 1000).rechargedEnergy,
    0,
  );
  const berthed = buildEntity();
  berthed.frontierBerthingHostAssemblyID = 99_001;
  const berthResult = advanceEntityBlackstartRechargeForTesting(berthed, 10, 1000);
  assert.equal(berthResult.rechargedEnergy, 0);
  assert.equal(berthResult.reason, "protected-or-warping");
});

test("capacitor recharge consumes fuel batches first-in-first-out", () => {
  const deps = buildFakeStore().deps;
  const recharge = calculateFueledCapacitorRecharge({
    currentCapacitorAmount: 0,
    capacitorCapacity: 100,
    capacitorRechargeRate: 50,
    powerOutput: 50,
    powerLoad: 0,
    fuelCharge: 4,
    fuelQueue: [
      { fuelTypeID: FUEL_TYPE_UNSTABLE, quantity: 1 },
      { fuelTypeID: FUEL_TYPE_EU_40, quantity: 3 },
    ],
    deltaSeconds: 1,
  }, deps);
  assert.equal(recharge.fuelEfficiency, 8);
  assert.equal(recharge.rechargedEnergy, 50);
  assert.equal(recharge.consumedFuel, 2.05);
  assert.equal(recharge.nextFuelCharge, 1.95);
  assert.equal(recharge.previousFuelTypeID, FUEL_TYPE_UNSTABLE);
  assert.equal(recharge.nextFuelTypeID, FUEL_TYPE_EU_40);
  assert.deepEqual(recharge.nextFuelQueue, [
    { fuelTypeID: FUEL_TYPE_EU_40, quantity: 1.95 },
  ]);
  assert.equal(recharge.nextFuelProperties.fuelEfficiency, 40);
});

test("regular and Creation warp profiles reproduce the client fuel formulas", () => {
  const deps = buildFakeStore().deps;
  const unstable = getShipFuelProperties({
    conditionState: {
      fuelQueue: [{ fuelTypeID: FUEL_TYPE_UNSTABLE, quantity: 1 }],
    },
  }, deps);
  const eu90 = getShipFuelProperties({
    conditionState: {
      fuelQueue: [{ fuelTypeID: FUEL_TYPE_EU_90, quantity: 1 }],
    },
  }, deps);

  assert.ok(Math.abs(calculateWarpFuelConsumptionRate({
    warpFuelRate: -0.5,
    shipMass: 7_200_000,
    fuelProperties: unstable,
    profile: "regular-engine",
  }) - 0.45) < 1e-12);
  assert.ok(Math.abs(calculateWarpFuelConsumptionRate({
    warpFuelRate: -0.5,
    shipMass: 7_200_000,
    fuelProperties: eu90,
    profile: "regular-engine",
  }) - 0.04) < 1e-12);
  assert.equal(calculateWarpFuelConsumptionRate({
    warpFuelRate: -0.55,
    shipMass: 7_200_000,
    fuelProperties: unstable,
    profile: "creation",
  }), 0.55);
  assert.equal(calculateContinuousFuelPowerFactor({
    fuelProperties: unstable,
    profile: "regular-engine",
  }), 3.2);
  assert.ok(Math.abs(calculateContinuousFuelPowerFactor({
    fuelProperties: eu90,
    profile: "regular-engine",
  }) - (180 / 14)) < 1e-12);
  assert.equal(calculateContinuousFuelPowerFactor({
    fuelProperties: unstable,
    profile: "creation",
    containmentReduction: 10,
  }), 8);
});

test("continuous warp fuel follows FIFO and changes rate with the active fuel", () => {
  const deps = buildFakeStore().deps;
  const recharge = calculateFueledCapacitorRecharge({
    currentCapacitorAmount: 100,
    capacitorCapacity: 100,
    capacitorRechargeRate: 0,
    powerOutput: 0,
    powerLoad: 0,
    fuelQueue: [
      { fuelTypeID: FUEL_TYPE_UNSTABLE, quantity: 0.225 },
      { fuelTypeID: FUEL_TYPE_EU_90, quantity: 1 },
    ],
    deltaSeconds: 1,
    isWarping: true,
    warpFuelRate: -0.5,
    warpFuelProfile: "regular-engine",
    shipMass: 7_200_000,
  }, deps);

  assert.ok(Math.abs(recharge.consumedWarpFuel - 0.245) < 1e-12);
  assert.ok(Math.abs(recharge.consumedFuel - 0.245) < 1e-12);
  assert.ok(Math.abs(recharge.warpFuelRate - 0.45) < 1e-12);
  assert.equal(recharge.warpFuelSecondsSupplied, 1);
  assert.equal(recharge.nextFuelTypeID, FUEL_TYPE_EU_90);
  assert.deepEqual(recharge.nextFuelQueue, [
    { fuelTypeID: FUEL_TYPE_EU_90, quantity: 0.98 },
  ]);

  const aligning = calculateFueledCapacitorRecharge({
    currentCapacitorAmount: 100,
    capacitorCapacity: 100,
    capacitorRechargeRate: 0,
    powerOutput: 0,
    powerLoad: 0,
    fuelQueue: [{ fuelTypeID: FUEL_TYPE_UNSTABLE, quantity: 1 }],
    deltaSeconds: 1,
    isWarping: false,
    warpFuelRate: -0.5,
    shipMass: 7_200_000,
  }, deps);
  assert.equal(aligning.consumedWarpFuel, 0);
  assert.equal(aligning.nextFuelCharge, 1);
});

test("regular continuous power applies containment and squared engine-load cost", () => {
  const recharge = calculateFueledCapacitorRecharge({
    currentCapacitorAmount: 0,
    capacitorCapacity: 100,
    capacitorRechargeRate: 4,
    powerOutput: 30,
    powerLoad: 2,
    fuelQueue: [{ fuelTypeID: FUEL_TYPE_UNSTABLE, quantity: 10 }],
    deltaSeconds: 1,
    powerFuelProfile: "regular-engine",
  }, buildFakeStore().deps);

  assert.equal(recharge.availablePowerOutput, 4);
  assert.equal(recharge.consumerGeneratorLoad, 2);
  assert.equal(recharge.rechargedEnergy, 4);
  assert.equal(recharge.powerFuelFactor, 3.2);
  assert.equal(recharge.powerLoadPenalty, 1.25);
  assert.ok(Math.abs(recharge.consumedFuel - 2.34375) < 1e-12);
});

test("LoadFuel: an empty or legacy untyped tank records the newly loaded type", () => {
  for (const conditionState of [
    { fuelCharge: 0, fuelTypeID: FUEL_TYPE_UNSTABLE },
    { fuelCharge: 25 },
  ]) {
    const store = buildFakeStore({
      items: [
        shipItem({ conditionState }),
        fuelStack(600001, 100, { typeID: FUEL_TYPE_EU_40 }),
      ],
    });
    const result = loadFuelIntoShipTank({
      characterID: OWNER_ID,
      shipID: SHIP_ID,
      fuelTypeID: FUEL_TYPE_EU_40,
      quantity: 50,
      fuelCapacity: TANK_CAPACITY,
      deps: store.deps,
    });
    assert.equal(result.success, true);
    assert.equal(store.getShipUpdate().conditionState.fuelTypeID, FUEL_TYPE_EU_40);
  }
});

test("online consumers and capacitor recharge both burn fuel by efficiency", () => {
  const deps = buildFakeStore().deps;
  const recharge = calculateFueledCapacitorRecharge({
    currentCapacitorAmount: 20,
    capacitorCapacity: 100,
    capacitorRechargeRate: 12,
    powerOutput: 15,
    powerLoad: 5,
    fuelCharge: 10,
    fuelTypeID: FUEL_TYPE_UNSTABLE,
    deltaSeconds: 2,
  }, deps);
  assert.equal(recharge.powerHeadroom, 10);
  assert.equal(recharge.effectiveRechargeRate, 10);
  assert.equal(recharge.consumerGeneratorLoad, 5);
  assert.equal(recharge.generatorLoad, 15);
  assert.equal(recharge.fuelEfficiency, 8);
  assert.equal(recharge.rechargedEnergy, 20);
  assert.equal(recharge.consumedFuel, 3.75);
  assert.equal(recharge.nextCapacitorAmount, 40);
  assert.equal(recharge.nextFuelCharge, 6.25);
});

test("online load consumes fuel while remaining power headroom recharges the capacitor", () => {
  const deps = buildFakeStore().deps;
  const calculate = (powerOutput, powerLoad) =>
    calculateFueledCapacitorRecharge({
      currentCapacitorAmount: 0,
      capacitorCapacity: 100,
      capacitorRechargeRate: 12,
      powerOutput,
      powerLoad,
      fuelCharge: 100,
      fuelTypeID: FUEL_TYPE_UNSTABLE,
      deltaSeconds: 2,
    }, deps);

  assert.equal(calculate(6, 5).rechargedEnergy, 2);
  assert.equal(calculate(15, 5).rechargedEnergy, 20);
  assert.equal(calculate(30, 5).rechargedEnergy, 24);
  assert.equal(calculate(5, 5).rechargedEnergy, 0);
  assert.equal(calculate(6, 5).consumedFuel, 1.5);
  assert.equal(calculate(15, 5).consumedFuel, 3.75);
  assert.equal(calculate(30, 5).consumedFuel, 4.25);
  assert.equal(calculate(5, 5).consumedFuel, 1.25);
  assert.equal(calculate(4, 5).consumedFuel, 1);
});

test("a full capacitor still burns fuel for online module load", () => {
  const recharge = calculateFueledCapacitorRecharge({
    currentCapacitorAmount: 100,
    capacitorCapacity: 100,
    capacitorRechargeRate: 12,
    powerOutput: 15,
    powerLoad: 5,
    fuelCharge: 10,
    fuelTypeID: FUEL_TYPE_UNSTABLE,
    deltaSeconds: 2,
  }, buildFakeStore().deps);

  assert.equal(recharge.rechargedEnergy, 0);
  assert.equal(recharge.generatorLoad, 5);
  assert.equal(recharge.consumedFuel, 1.25);
  assert.equal(recharge.nextFuelCharge, 8.75);
});

test("Creation power state follows the online modular generator and consumers", () => {
  const state = calculateCreationPowerStateForTesting({
    moduleItems: [
      { itemID: 1, typeID: 95318, moduleState: { online: true } },
      { itemID: 2, typeID: 95302, moduleState: { online: true } },
      { itemID: 3, typeID: 95325, moduleState: { online: true } },
      { itemID: 4, typeID: 95486, moduleState: { online: false } },
    ],
  }, {
    buildEffectiveItemAttributeMap: (item) => ({
      ...(item.itemID === 1 ? { 11: 15 } : {}),
      ...(item.itemID === 2 ? { 30: 0.1 } : {}),
      ...(item.itemID === 3 ? { 55: 1.2, 482: 100 } : {}),
    }),
    getTypeDogmaEffects: (typeID) => new Set({
      95318: [3782],
      95302: [16],
      95325: [12921, 12922],
    }[typeID] || []),
  });

  assert.equal(state.powerOutput, 15);
  assert.equal(state.powerLoad, 0.1);
  assert.equal(state.capacitorRechargeRate, 1.2);
  assert.equal(state.warpFuelRate, 0);
  assert.deepEqual(state.propulsionModuleIDs, []);
  assert.deepEqual(state.onlineModuleIDs, [1, 2, 3]);
});

test("regular ship fuel power state derives recharge from its online engine", () => {
  const resourceState = {
    powerOutput: 30,
    powerLoad: 4,
    capacitorRechargeRate: 0,
  };
  const onlineEngine = {
    ...engineItem(POWER_GENERATOR_TYPE, 600101),
    moduleState: { online: true },
  };
  const offlineEngine = {
    ...engineItem(POWER_GENERATOR_TYPE, 600102),
    moduleState: { online: false },
  };

  assert.deepEqual(
    calculateRegularShipFuelPowerStateForTesting(
      resourceState,
      [onlineEngine],
      buildFakeStore().deps,
    ),
    {
      powerOutput: 30,
      powerLoad: 4,
      capacitorRechargeRate: 1,
      warpFuelRate: -0.6,
      engineModuleIDs: [600101],
      onlineEngineModuleIDs: [600101],
    },
  );
  assert.deepEqual(
    calculateRegularShipFuelPowerStateForTesting(
      resourceState,
      [offlineEngine],
      buildFakeStore().deps,
    ),
    {
      powerOutput: 30,
      powerLoad: 4,
      capacitorRechargeRate: 0,
      warpFuelRate: 0,
      engineModuleIDs: [600102],
      onlineEngineModuleIDs: [],
    },
  );
});

test("fuel quantity truncates recharge and all fuel tiers use authored efficiency", () => {
  const deps = buildFakeStore().deps;
  const unstable = calculateFueledCapacitorRecharge({
    currentCapacitorAmount: 0,
    capacitorCapacity: 100,
    capacitorRechargeRate: 20,
    powerOutput: 20,
    powerLoad: 0,
    fuelCharge: 0.5,
    fuelTypeID: FUEL_TYPE_UNSTABLE,
    deltaSeconds: 1,
  }, deps);
  assert.equal(unstable.rechargedEnergy, 4);
  assert.equal(unstable.nextFuelCharge, 0);

  const crude = calculateFueledCapacitorRecharge({
    currentCapacitorAmount: 0,
    capacitorCapacity: 100,
    capacitorRechargeRate: 20,
    powerOutput: 20,
    powerLoad: 0,
    fuelCharge: 0.5,
    fuelTypeID: FUEL_TYPE_EU_40,
    deltaSeconds: 1,
  }, deps);
  assert.deepEqual(
    [
      FUEL_TYPE_EU_40,
      FUEL_TYPE_SOF_40,
      FUEL_TYPE_SOF_80,
      FUEL_TYPE_EU_90,
      FUEL_TYPE_D2,
      FUEL_TYPE_D1,
    ].map((typeID) => getFuelEfficiency(typeID, deps)),
    [40, 40, 80, 90, 15, 10],
  );
  assert.equal(crude.rechargedEnergy, 20);
  assert.equal(crude.consumedFuel, 0.5);
  assert.equal(crude.nextFuelCharge, 0);
});

test("space fuel tick burns online load and only uses headroom for recharge", () => {
  const deps = buildFakeStore().deps;
  const cases: Array<[
    number,
    number,
    number,
    { rechargedEnergy: number; capacitorChargeRatio: number; fuelCharge: number },
  ]> = [
    [CREATION_SHIP_TYPE, TANK_CAPACITY, 1.2, {
      rechargedEnergy: 1.2,
      capacitorChargeRatio: 0.212,
      fuelCharge: 9.225,
    }],
    [REGULAR_FUEL_SHIP_TYPE, 3000, 1, {
      rechargedEnergy: 1,
      capacitorChargeRatio: 0.21,
      fuelCharge: 8.75,
    }],
  ];
  for (const [typeID, fuelCapacity, capacitorRechargeRate, expected] of cases) {
    const entity: Record<string, any> = {
      kind: "ship",
      itemID: SHIP_ID + typeID,
      typeID,
      categoryID: 6,
      ownerID: OWNER_ID,
      capacitorCapacity: 100,
      capacitorRechargeRate,
      capacitorChargeRatio: 0.2,
      conditionState: {
        charge: 0.2,
        fuelCharge: 10,
        fuelTypeID: FUEL_TYPE_UNSTABLE,
        fuelQueue: [
          { fuelTypeID: FUEL_TYPE_UNSTABLE, quantity: 10 },
        ],
      },
      passiveDerivedState: {
        powerOutput: 15,
        powerLoad: 5,
        fittedItems: typeID === REGULAR_FUEL_SHIP_TYPE
          ? [{
              ...engineItem(POWER_GENERATOR_TYPE, 600103),
              moduleState: { online: true },
            }]
          : [],
        attributes: {
          [ATTRIBUTE_FUEL_CAPACITY]: fuelCapacity,
          6341: typeID === CREATION_SHIP_TYPE ? 10 : 0,
          11: 15,
          15: 5,
        },
      },
      persistSpaceState: false,
    };

    const result = advanceEntityCapacitorRechargeForTesting(
      entity,
      1,
      1000,
      deps,
    );
    assert.equal(result.mode, "frontier-fueled");
    assert.equal(result.changed, true);
    assert.ok(Math.abs(result.rechargedEnergy - expected.rechargedEnergy) < 1e-9);
    assert.ok(Math.abs(entity.capacitorChargeRatio - expected.capacitorChargeRatio) < 1e-9);
    assert.ok(Math.abs(entity.conditionState.fuelCharge - expected.fuelCharge) < 1e-9);
    assert.equal(entity.conditionState.fuelTypeID, FUEL_TYPE_UNSTABLE);
    assert.equal(entity.conditionState.fuelQueue[0].fuelTypeID, FUEL_TYPE_UNSTABLE);
    assert.ok(Math.abs(entity.conditionState.fuelQueue[0].quantity - expected.fuelCharge) < 1e-9);
  }
});

test("space fuel tick charges warp fuel only after warp activation", () => {
  const deps = buildFakeStore().deps;
  const buildEntity = () => ({
    kind: "ship",
    itemID: SHIP_ID + 900,
    typeID: REGULAR_FUEL_SHIP_TYPE,
    categoryID: 6,
    ownerID: OWNER_ID,
    mass: 7_200_000,
    mode: "WARP",
    warpState: { phase: "cruise" },
    pendingWarp: null,
    capacitorCapacity: 100,
    capacitorRechargeRate: 0,
    capacitorChargeRatio: 1,
    conditionState: {
      charge: 1,
      fuelCharge: 1,
      fuelTypeID: FUEL_TYPE_UNSTABLE,
      fuelQueue: [{ fuelTypeID: FUEL_TYPE_UNSTABLE, quantity: 1 }],
    },
    passiveDerivedState: {
      powerOutput: 0,
      powerLoad: 0,
      attributes: { [ATTRIBUTE_FUEL_CAPACITY]: 3000 },
    },
    regularFuelPowerState: {
      powerOutput: 0,
      powerLoad: 0,
      capacitorRechargeRate: 0,
      warpFuelRate: -0.5,
      engineModuleIDs: [600103],
      onlineEngineModuleIDs: [600103],
    },
    persistSpaceState: false,
  });

  const active = buildEntity();
  const activeResult = advanceEntityCapacitorRechargeForTesting(
    active,
    0.5,
    1000,
    deps,
  );
  assert.ok(Math.abs(activeResult.consumedWarpFuel - 0.225) < 1e-12);
  assert.ok(Math.abs(active.conditionState.fuelCharge - 0.775) < 1e-12);

  const aligning = buildEntity();
  aligning.pendingWarp = { phase: "align" };
  const alignResult = advanceEntityCapacitorRechargeForTesting(
    aligning,
    0.5,
    1000,
    deps,
  );
  assert.equal(alignResult.consumedWarpFuel, 0);
  assert.equal(aligning.conditionState.fuelCharge, 1);
});

test("warp preflight enforces propulsion and fuel only for authored fuel tanks", () => {
  const deps = buildFakeStore().deps;
  const fueledEntity: Record<string, any> = {
    kind: "ship",
    itemID: SHIP_ID + 901,
    typeID: REGULAR_FUEL_SHIP_TYPE,
    categoryID: 6,
    mass: 7_200_000,
    conditionState: {
      fuelCharge: 1,
      fuelQueue: [{ fuelTypeID: FUEL_TYPE_UNSTABLE, quantity: 1 }],
    },
    passiveDerivedState: {
      attributes: { [ATTRIBUTE_FUEL_CAPACITY]: 3000 },
    },
    regularFuelPowerState: {
      warpFuelRate: -0.5,
      engineModuleIDs: [600103],
      onlineEngineModuleIDs: [600103],
    },
  };

  const ready = checkEntityWarpFuelAvailabilityForTesting(fueledEntity, deps);
  assert.equal(ready.success, true);
  assert.ok(Math.abs(ready.data.consumptionRate - 0.45) < 1e-12);

  const empty = structuredClone(fueledEntity);
  empty.conditionState = { fuelCharge: 0, fuelQueue: [] };
  assert.equal(
    checkEntityWarpFuelAvailabilityForTesting(empty, deps).errorMsg,
    "NO_FUEL",
  );

  const offline = structuredClone(fueledEntity);
  offline.regularFuelPowerState.onlineEngineModuleIDs = [];
  assert.equal(
    checkEntityWarpFuelAvailabilityForTesting(offline, deps).errorMsg,
    "PROPULSION_REQUIRED",
  );

  const tankless = structuredClone(fueledEntity);
  tankless.typeID = REGULAR_TANKLESS_SHIP_TYPE;
  tankless.passiveDerivedState.attributes[ATTRIBUTE_FUEL_CAPACITY] = 0;
  const legacy = checkEntityWarpFuelAvailabilityForTesting(tankless, deps);
  assert.equal(legacy.success, true);
  assert.equal(legacy.skipped, true);

  const unprovisionedNpc = structuredClone(empty);
  unprovisionedNpc.nativeNpc = true;
  const npcCompatibility = checkEntityWarpFuelAvailabilityForTesting(
    unprovisionedNpc,
    deps,
  );
  assert.equal(npcCompatibility.success, true);
  assert.equal(npcCompatibility.skipped, true);
  assert.equal(npcCompatibility.reason, "NPC_FUEL_NOT_PROVISIONED");

  unprovisionedNpc.npcFuelRequirementsEnabled = true;
  assert.equal(
    checkEntityWarpFuelAvailabilityForTesting(unprovisionedNpc, deps).errorMsg,
    "NO_FUEL",
  );
});

test("warp initiation requires and consumes exactly fifteen percent capacitor", () => {
  const buildEntity = (capacitorChargeRatio) => ({
    kind: "ship",
    itemID: SHIP_ID + 903,
    capacitorCapacity: 200,
    capacitorChargeRatio,
    conditionState: { charge: capacitorChargeRatio },
    persistSpaceState: false,
  });

  assert.equal(WARP_CAPACITOR_COST_RATIO, 0.15);
  const insufficient = buildEntity(0.149);
  const rejected = checkEntityWarpCapacitorAvailabilityForTesting(insufficient);
  assert.equal(rejected.success, false);
  assert.equal(rejected.errorMsg, "NOT_ENOUGH_CAPACITOR");
  assert.equal(rejected.data.requiredCapacitorAmount, 30);
  assert.equal(insufficient.capacitorChargeRatio, 0.149);

  const exact = buildEntity(0.15);
  const available = checkEntityWarpCapacitorAvailabilityForTesting(exact);
  assert.equal(available.success, true);
  assert.equal(available.data.currentCapacitorAmount, 30);
  const consumed = consumeEntityWarpCapacitorForTesting(exact, 1000);
  assert.equal(consumed.success, true);
  assert.equal(consumed.data.consumedCapacitorAmount, 30);
  assert.equal(consumed.data.nextCapacitorAmount, 0);
  assert.equal(exact.capacitorChargeRatio, 0);
  assert.equal(exact.conditionState.charge, 0);

  const missingCapacity = buildEntity(1);
  missingCapacity.capacitorCapacity = 0;
  assert.equal(
    checkEntityWarpCapacitorAvailabilityForTesting(missingCapacity).errorMsg,
    "NOT_ENOUGH_CAPACITOR",
  );
});

test("native NPC fuel consumption remains opt-in until tanks are provisioned", () => {
  const buildNpc = (): Record<string, any> => ({
    kind: "ship",
    nativeNpc: true,
    itemID: SHIP_ID + 902,
    typeID: REGULAR_FUEL_SHIP_TYPE,
    categoryID: 6,
    ownerID: OWNER_ID,
    mass: 7_200_000,
    capacitorCapacity: 100,
    capacitorRechargeRate: 0,
    capacitorChargeRatio: 1,
    conditionState: {
      charge: 1,
      fuelCharge: 1,
      fuelTypeID: FUEL_TYPE_UNSTABLE,
      fuelQueue: [{ fuelTypeID: FUEL_TYPE_UNSTABLE, quantity: 1 }],
    },
    passiveDerivedState: {
      powerOutput: 0,
      powerLoad: 0,
      attributes: { [ATTRIBUTE_FUEL_CAPACITY]: 3000 },
    },
    regularFuelPowerState: {
      powerOutput: 0,
      powerLoad: 0,
      capacitorRechargeRate: 0,
      warpFuelRate: -0.5,
      engineModuleIDs: [600103],
      onlineEngineModuleIDs: [600103],
    },
    mode: "WARP",
    warpState: { phase: "cruise" },
    pendingWarp: null,
    persistSpaceState: false,
  });
  const deps = buildFakeStore().deps;
  const legacyNpc = buildNpc();
  const compatibilityResult = advanceEntityCapacitorRechargeForTesting(
    legacyNpc,
    1,
    1000,
    deps,
  );
  assert.notEqual(compatibilityResult.mode, "frontier-fueled");
  assert.equal(legacyNpc.conditionState.fuelCharge, 1);

  const provisionedNpc = buildNpc();
  provisionedNpc.npcFuelRequirementsEnabled = true;
  const provisionedResult = advanceEntityCapacitorRechargeForTesting(
    provisionedNpc,
    1,
    1000,
    deps,
  );
  assert.equal(provisionedResult.mode, "frontier-fueled");
  assert.ok(provisionedResult.consumedWarpFuel > 0);
  assert.ok(provisionedNpc.conditionState.fuelCharge < 1);
});

test("space fuel tick drains powered ships while the capacitor is full", () => {
  const entity: Record<string, any> = {
    kind: "ship",
    itemID: SHIP_ID,
    typeID: CREATION_SHIP_TYPE,
    categoryID: 6,
    ownerID: OWNER_ID,
    capacitorCapacity: 100,
    capacitorRechargeRate: 1.2,
    capacitorChargeRatio: 1,
    conditionState: {
      charge: 1,
      fuelCharge: 10,
      fuelTypeID: FUEL_TYPE_UNSTABLE,
      fuelQueue: [{ fuelTypeID: FUEL_TYPE_UNSTABLE, quantity: 10 }],
    },
    passiveDerivedState: {
      powerOutput: 15,
      powerLoad: 5,
      attributes: {
        [ATTRIBUTE_FUEL_CAPACITY]: TANK_CAPACITY,
        6341: 10,
        11: 15,
        15: 5,
      },
    },
    persistSpaceState: false,
  };

  const result = advanceEntityCapacitorRechargeForTesting(
    entity,
    1,
    1000,
    buildFakeStore().deps,
  );
  assert.equal(result.mode, "frontier-fueled");
  assert.equal(result.changed, true);
  assert.equal(result.rechargedEnergy, 0);
  assert.equal(entity.capacitorChargeRatio, 1);
  assert.equal(entity.conditionState.fuelCharge, 9.375);
});

test("space recharge advances a live ship to the next queued fuel batch", () => {
  const deps = buildFakeStore().deps;
  const entity: Record<string, any> = {
    kind: "ship",
    itemID: SHIP_ID,
    typeID: CREATION_SHIP_TYPE,
    categoryID: 6,
    ownerID: OWNER_ID,
    capacitorCapacity: 100,
    capacitorRechargeRate: 50,
    capacitorChargeRatio: 0,
    conditionState: {
      charge: 0,
      fuelCharge: 21,
      fuelQueue: [
        { fuelTypeID: FUEL_TYPE_UNSTABLE, quantity: 1 },
        { fuelTypeID: FUEL_TYPE_EU_40, quantity: 20 },
      ],
    },
    passiveDerivedState: {
      powerOutput: 50,
      powerLoad: 0,
      attributes: {
        [ATTRIBUTE_FUEL_CAPACITY]: TANK_CAPACITY,
        11: 50,
        15: 0,
      },
    },
    persistSpaceState: false,
  };

  const result = advanceEntityCapacitorRechargeForTesting(
    entity,
    1,
    1000,
    deps,
  );
  assert.equal(result.changed, true);
  assert.equal(result.fuelEfficiency, 8);
  assert.equal(entity.capacitorChargeRatio, 0.5);
  assert.ok(Math.abs(result.consumedFuel - 13.1) < 1e-9);
  assert.ok(Math.abs(entity.conditionState.fuelCharge - 7.9) < 1e-9);
  assert.equal(entity.conditionState.fuelTypeID, FUEL_TYPE_EU_40);
  assert.equal(entity.conditionState.fuelQueue.length, 1);
  assert.equal(entity.conditionState.fuelQueue[0].fuelTypeID, FUEL_TYPE_EU_40);
  assert.ok(Math.abs(entity.conditionState.fuelQueue[0].quantity - 7.9) < 1e-9);
  assert.equal(
    entity.passiveDerivedState.attributes[ATTRIBUTE_FUEL_EFFICIENCY],
    40,
  );
});

test("LoadFuel: drains multiple stacks oldest-first across cargo and fuel bay", () => {
  const store = buildFakeStore({
    items: [
      shipItem(),
      fuelStack(600003, 300),
      fuelStack(600001, 400, { flagID: 133 }),
      fuelStack(600002, 500),
    ],
  });
  const result = loadFuelIntoShipTank({
    characterID: OWNER_ID,
    shipID: SHIP_ID,
    fuelTypeID: FUEL_TYPE_UNSTABLE,
    quantity: 900,
    fuelCapacity: TANK_CAPACITY,
    deps: store.deps,
  });
  assert.equal(result.success, true);
  assert.deepEqual(store.consumeCalls, [
    { itemID: 600001, quantity: 400 },
    { itemID: 600002, quantity: 500 },
  ]);
  assert.equal(store.getItem(600003).stacksize, 300);
});

test("LoadFuel: docked hangar stacks are eligible sources", () => {
  const store = buildFakeStore({
    items: [
      shipItem(),
      fuelStack(600007, 1200, { locationID: STATION_ID, flagID: 4 }),
    ],
  });
  const result = loadFuelIntoShipTank({
    characterID: OWNER_ID,
    shipID: SHIP_ID,
    fuelTypeID: FUEL_TYPE_UNSTABLE,
    quantity: 1000,
    fuelCapacity: TANK_CAPACITY,
    dockedLocationID: STATION_ID,
    deps: store.deps,
  });
  assert.equal(result.success, true);
  assert.equal(store.getItem(600007).stacksize, 200);
});

test("LoadFuel: the free station Unstable Fuel offer never depletes", () => {
  const store = buildFakeStore({
    items: [
      shipItem(),
      fuelStack(600007, 500),
      fuelStack(600008, itemStore.CLIENT_INVENTORY_STACK_LIMIT, {
        locationID: STATION_ID,
        flagID: 4,
        customInfo: FREE_STATION_FUEL_CUSTOM_INFO,
      }),
    ],
  });
  const result = loadFuelIntoShipTank({
    characterID: OWNER_ID,
    shipID: SHIP_ID,
    fuelTypeID: FUEL_TYPE_UNSTABLE,
    quantity: TANK_CAPACITY,
    fuelCapacity: TANK_CAPACITY,
    dockedLocationID: STATION_ID,
    deps: store.deps,
  });
  assert.equal(result.success, true);
  assert.deepEqual(store.consumeCalls, []);
  assert.equal(store.getItem(600007).stacksize, 500);
  assert.equal(
    store.getItem(600008).stacksize,
    itemStore.CLIENT_INVENTORY_STACK_LIMIT,
  );
  assert.equal(store.getShipUpdate().conditionState.fuelCharge, TANK_CAPACITY);
});

test("LoadFuel: explicit fuelItems restrict the drained stacks", () => {
  const store = buildFakeStore({
    items: [shipItem(), fuelStack(600001, 800), fuelStack(600002, 800)],
  });
  const result = loadFuelIntoShipTank({
    characterID: OWNER_ID,
    shipID: SHIP_ID,
    fuelTypeID: FUEL_TYPE_UNSTABLE,
    quantity: 700,
    fuelItems: [{ itemID: 600002 }],
    sourceLocationID: SHIP_ID,
    fuelCapacity: TANK_CAPACITY,
    deps: store.deps,
  });
  assert.equal(result.success, true);
  assert.deepEqual(store.consumeCalls, [{ itemID: 600002, quantity: 700 }]);
  assert.equal(store.getItem(600001).stacksize, 800);
});

test("LoadFuel: insufficient source fuel fails without consuming", () => {
  const store = buildFakeStore({
    items: [shipItem(), fuelStack(600001, 400)],
  });
  const result = loadFuelIntoShipTank({
    characterID: OWNER_ID,
    shipID: SHIP_ID,
    fuelTypeID: FUEL_TYPE_UNSTABLE,
    quantity: 1000,
    fuelCapacity: TANK_CAPACITY,
    deps: store.deps,
  });
  assert.equal(result.success, false);
  assert.equal(result.errorMsg, "FUEL_SOURCE_INSUFFICIENT");
  assert.equal(result.params.availableQuantity, 400);
  assert.deepEqual(store.consumeCalls, []);
  assert.equal(store.getShipUpdate(), null);
});

test("LoadFuel: overflow beyond remaining capacity fails cleanly", () => {
  const store = buildFakeStore({
    items: [
      shipItem({ conditionState: { fuelCharge: 2000 } }),
      fuelStack(600001, 1000),
    ],
  });
  const result = loadFuelIntoShipTank({
    characterID: OWNER_ID,
    shipID: SHIP_ID,
    fuelTypeID: FUEL_TYPE_UNSTABLE,
    quantity: 500,
    fuelCapacity: TANK_CAPACITY,
    deps: store.deps,
  });
  assert.equal(result.success, false);
  assert.equal(result.errorMsg, "FUEL_TANK_OVERFLOW");
  assert.equal(result.params.remainingCapacity, 250);
  assert.deepEqual(store.consumeCalls, []);
});

test("LoadFuel: invalid quantities are rejected", () => {
  for (const quantity of [0, -25, Number.NaN]) {
    const store = buildFakeStore({
      items: [shipItem(), fuelStack(600001, 1000)],
    });
    const result = loadFuelIntoShipTank({
      characterID: OWNER_ID,
      shipID: SHIP_ID,
      fuelTypeID: FUEL_TYPE_UNSTABLE,
      quantity,
      fuelCapacity: TANK_CAPACITY,
      deps: store.deps,
    });
    assert.equal(result.success, false, `quantity=${quantity}`);
    assert.equal(result.errorMsg, "FUEL_QUANTITY_INVALID");
  }
});

test("LoadFuel: unsupported fuel types are rejected, crude fuel accepted", () => {
  const rejected = loadFuelIntoShipTank({
    characterID: OWNER_ID,
    shipID: SHIP_ID,
    fuelTypeID: 222222,
    quantity: 100,
    fuelCapacity: TANK_CAPACITY,
    deps: buildFakeStore({ items: [shipItem()] }).deps,
  });
  assert.equal(rejected.success, false);
  assert.equal(rejected.errorMsg, "FUEL_TYPE_UNSUPPORTED");

  const crudeStore = buildFakeStore({
    items: [
      shipItem(),
      fuelStack(600001, 300, { typeID: FUEL_TYPE_EU_40 }),
    ],
  });
  const accepted = loadFuelIntoShipTank({
    characterID: OWNER_ID,
    shipID: SHIP_ID,
    fuelTypeID: FUEL_TYPE_EU_40,
    quantity: 200,
    fuelCapacity: TANK_CAPACITY,
    deps: crudeStore.deps,
  });
  assert.equal(accepted.success, true);
});

test("LoadFuel: ownership mismatch rejects ship and foreign stacks", () => {
  const foreignShip = loadFuelIntoShipTank({
    characterID: OTHER_OWNER_ID,
    shipID: SHIP_ID,
    fuelTypeID: FUEL_TYPE_UNSTABLE,
    quantity: 100,
    fuelCapacity: TANK_CAPACITY,
    deps: buildFakeStore({ items: [shipItem()] }).deps,
  });
  assert.equal(foreignShip.success, false);
  assert.equal(foreignShip.errorMsg, "FUEL_SHIP_NOT_OWNED");

  const store = buildFakeStore({
    items: [
      shipItem(),
      fuelStack(600001, 1000, { ownerID: OTHER_OWNER_ID }),
    ],
  });
  const foreignStack = loadFuelIntoShipTank({
    characterID: OWNER_ID,
    shipID: SHIP_ID,
    fuelTypeID: FUEL_TYPE_UNSTABLE,
    quantity: 100,
    fuelItems: [600001],
    fuelCapacity: TANK_CAPACITY,
    deps: store.deps,
  });
  assert.equal(foreignStack.success, false);
  assert.equal(foreignStack.errorMsg, "FUEL_SOURCE_INSUFFICIENT");
  assert.deepEqual(store.consumeCalls, []);
});

test("LoadFuel: missing tank capacity is rejected", () => {
  const result = loadFuelIntoShipTank({
    characterID: OWNER_ID,
    shipID: SHIP_ID,
    fuelTypeID: FUEL_TYPE_UNSTABLE,
    quantity: 100,
    fuelCapacity: 0,
    deps: buildFakeStore({ items: [shipItem()] }).deps,
  });
  assert.equal(result.success, false);
  assert.equal(result.errorMsg, "FUEL_TANK_MISSING");
});

test("LoadFuel: mid-drain failure restores already-consumed stacks", () => {
  const store = buildFakeStore({
    items: [
      shipItem(),
      fuelStack(600001, 400),
      fuelStack(600002, 400),
    ],
    failConsumeForItemID: 600002,
  });
  const result = loadFuelIntoShipTank({
    characterID: OWNER_ID,
    shipID: SHIP_ID,
    fuelTypeID: FUEL_TYPE_UNSTABLE,
    quantity: 600,
    fuelCapacity: TANK_CAPACITY,
    deps: store.deps,
  });
  assert.equal(result.success, false);
  assert.equal(store.grantCalls.length, 1);
  assert.deepEqual(store.grantCalls[0].specs, [
    { itemType: FUEL_TYPE_UNSTABLE, quantity: 400 },
  ]);
  assert.equal(store.getShipUpdate(), null);
});

test("LoadFuel: fuel item id normalization accepts rows, ids, and bigints", () => {
  assert.deepEqual(
    normalizeRequestedFuelItemIDs([
      { itemID: 42 },
      43,
      44n,
      { itemId: 45 },
      { noID: true },
      42,
    ]),
    [42, 43, 44, 45],
  );
  assert.deepEqual(normalizeRequestedFuelItemIDs(null), []);
});

test("LoadFuel: source scan skips wrong-type and wrong-location stacks", () => {
  const store = buildFakeStore({
    items: [
      shipItem(),
      fuelStack(600001, 100, { typeID: 222222 }),
      fuelStack(600002, 100, { locationID: 999999 }),
      fuelStack(600003, 100),
    ],
  });
  const stacks = collectFuelSourceStacks({
    characterID: OWNER_ID,
    shipID: SHIP_ID,
    fuelTypeID: FUEL_TYPE_UNSTABLE,
    deps: store.deps,
  });
  assert.deepEqual(stacks.map((item) => item.itemID), [600003]);
});

test("conditionState persists FIFO fuel order through normalization", () => {
  const normalized = itemStore.normalizeShipConditionState({
    damage: 0.25,
    charge: 0.5,
    fuelCharge: 1234,
    fuelTypeID: FUEL_TYPE_UNSTABLE,
  });
  assert.equal(normalized.fuelCharge, 1234);
  assert.equal(normalized.fuelTypeID, FUEL_TYPE_UNSTABLE);
  assert.deepEqual(normalized.fuelQueue, [
    { fuelTypeID: FUEL_TYPE_UNSTABLE, quantity: 1234 },
  ]);
  assert.equal(itemStore.normalizeShipConditionState({}).fuelCharge, 0);
  assert.equal(
    Object.hasOwn(itemStore.normalizeShipConditionState({ fuelTypeID: 123 }), "fuelTypeID"),
    false,
  );
  assert.deepEqual(
    itemStore.normalizeShipConditionState({
      fuelCharge: 999,
      fuelTypeID: FUEL_TYPE_UNSTABLE,
      fuelQueue: [
        { fuelTypeID: FUEL_TYPE_EU_40, quantity: 75 },
        { fuelTypeID: FUEL_TYPE_UNSTABLE, quantity: 25 },
      ],
    }),
    {
      damage: 0,
      charge: 1,
      armorDamage: 0,
      shieldCharge: 1,
      incapacitated: false,
      fuelCharge: 100,
      fuelTypeID: FUEL_TYPE_EU_40,
      fuelQueue: [
        { fuelTypeID: FUEL_TYPE_EU_40, quantity: 75 },
        { fuelTypeID: FUEL_TYPE_UNSTABLE, quantity: 25 },
      ],
    },
  );
  const migratedComposition = itemStore.normalizeShipConditionState({
    fuelComposition: [
      { fuelTypeID: FUEL_TYPE_EU_40, quantity: 20 },
      { fuelTypeID: FUEL_TYPE_UNSTABLE, quantity: 10 },
    ],
  });
  assert.deepEqual(migratedComposition.fuelQueue, [
    { fuelTypeID: FUEL_TYPE_EU_40, quantity: 20 },
    { fuelTypeID: FUEL_TYPE_UNSTABLE, quantity: 10 },
  ]);
  assert.equal(migratedComposition.fuelTypeID, FUEL_TYPE_EU_40);
  assert.equal(
    itemStore.normalizeShipConditionState({ fuelCharge: -50 }).fuelCharge,
    0,
  );
  assert.equal(getShipFuelCharge({ conditionState: { fuelCharge: 77 } }), 77);
  assert.equal(
    getShipFuelTypeID({
      conditionState: { fuelCharge: 77, fuelTypeID: FUEL_TYPE_UNSTABLE },
    }),
    FUEL_TYPE_UNSTABLE,
  );
  assert.equal(getShipFuelCharge({}), 0);
  assert.equal(getShipFuelTypeID({}), 0);
  assert.deepEqual(
    getShipFuelQueue({ conditionState: normalized }),
    [{ fuelTypeID: FUEL_TYPE_UNSTABLE, quantity: 1234 }],
  );
});

// ── Handler-level coverage against the disposable game store ────────────

function grantTestItems() {
  const shipGrant = itemStore.grantItemsToCharacterLocation(
    OWNER_ID,
    STATION_ID,
    4,
    [{ itemType: CREATION_SHIP_TYPE, quantity: 1, options: { individualItems: true, singleton: 1 } }],
  );
  assert.equal(shipGrant.success, true, shipGrant.errorMsg);
  const grantedShip = shipGrant.data.items[0];
  const resetResult = itemStore.updateShipItem(grantedShip.itemID, (current) => ({
    ...current,
    conditionState: {
      ...(current.conditionState || {}),
      fuelCharge: 0,
      fuelQueue: [],
      fuelTypeID: 0,
    },
  }));
  assert.equal(resetResult.success, true, resetResult.errorMsg);
  const ship = resetResult.data;
  const fuelGrant = itemStore.grantItemsToCharacterLocation(
    OWNER_ID,
    ship.itemID,
    5,
    [{ itemType: FUEL_TYPE_UNSTABLE, quantity: 1500 }],
  );
  assert.equal(fuelGrant.success, true, fuelGrant.errorMsg);
  const mixedFuelGrant = itemStore.grantItemsToCharacterLocation(
    OWNER_ID,
    ship.itemID,
    5,
    [{ itemType: FUEL_TYPE_EU_40, quantity: 300 }],
  );
  assert.equal(mixedFuelGrant.success, true, mixedFuelGrant.errorMsg);
  return {
    ship,
    fuelStackItem: fuelGrant.data.items[0],
    mixedFuelStackItem: mixedFuelGrant.data.items[0],
  };
}

function buildHandlerHarness(ship) {
  const service = new DogmaService();
  const notifications: any[] = [];
  const session: Record<string, any> = {
    compatibilityProfile: "frontier",
    activeShipID: ship.itemID,
    shipid: ship.itemID,
    charid: OWNER_ID,
    stationid: STATION_ID,
    _space: {},
    // Production deliberately waits for the client's Creation dogma priming
    // pass. Unit tests use an immediate dispatcher so assertions stay local.
    _postDogmaAttributeRefreshDelayMs: 0,
    sendNotification(name, idType, payload) {
      notifications.push({ name, idType, payload });
    },
  };
  service._getCharID = () => OWNER_ID;
  service._getCharacterRecord = () => ({ characterID: OWNER_ID });
  service._getCurrentDogmaShipContext = () => ({
    shipID: ship.itemID,
    shipMetadata: itemStore.findItemById(ship.itemID),
    shipRecord: itemStore.findItemById(ship.itemID),
    controllingStructure: false,
  });
  service._buildShipAttributes = () => ({
    [ATTRIBUTE_FUEL_CAPACITY]: TANK_CAPACITY,
  });
  service._syncSpaceEntityFuelCharge = () => false;
  service._refreshDockedFittingState = () => {};
  return { service, session, notifications };
}

test("Handle_LoadFuel: end-to-end load, post-bind refresh, duplicate suppression, persistence", async () => {
  const { ship, fuelStackItem, mixedFuelStackItem } = grantTestItems();
  const { service, session, notifications } = buildHandlerHarness(ship);
  const args: any[] = [ship.itemID, FUEL_TYPE_UNSTABLE, 1000, null, null];

  assert.equal(service.Handle_LoadFuel(args, session), null);

  const persistedShip = itemStore.findItemById(ship.itemID);
  assert.equal(persistedShip.conditionState.fuelCharge, 1000);
  assert.equal(persistedShip.conditionState.fuelTypeID, FUEL_TYPE_UNSTABLE);
  assert.deepEqual(persistedShip.conditionState.fuelQueue, [
    { fuelTypeID: FUEL_TYPE_UNSTABLE, quantity: 1000 },
  ]);
  const persistedStack = itemStore.findItemById(fuelStackItem.itemID);
  assert.equal(persistedStack.stacksize, 1500);

  // The refuel button's first dogmaIM call is nested in MachoBindObject. The
  // fuel change must wait until that bind response has been sent or client
  // Godma can discard it while its priming channel is active.
  assert.equal(
    notifications.filter((entry) => entry.name === "OnModuleAttributeChanges").length,
    0,
  );
  await service.afterCallResponse("MachoBindObject", session, {
    args: [
      [STATION_ID, 15],
      ["LoadFuel", args, { type: "dict", entries: [] }],
    ],
  });
  const attributeEvents = notifications.filter(
    (entry) => entry.name === "OnModuleAttributeChanges",
  );
  assert.equal(attributeEvents.length, 1);
  const changeRow = attributeEvents[0].payload[0].items[0];
  const changeJSON = JSON.stringify(changeRow, (key, value) =>
    typeof value === "bigint" ? value.toString() : value);
  assert.ok(
    changeJSON.includes(String(ATTRIBUTE_FUEL_CHARGE)),
    `fuelCharge attribute id missing from ${changeJSON}`,
  );

  // Identical request within the duplicate window must not double-load.
  assert.equal(service.Handle_LoadFuel(args, session), null);
  await service.afterCallResponse("LoadFuel", session);
  assert.equal(
    itemStore.findItemById(ship.itemID).conditionState.fuelCharge,
    1000,
  );
  assert.equal(itemStore.findItemById(fuelStackItem.itemID).stacksize, 1500);

  // A different quantity is a new logical action.
  assert.equal(
    service.Handle_LoadFuel(
      [ship.itemID, FUEL_TYPE_UNSTABLE, 250, null, null],
      session,
    ),
    null,
  );
  await service.afterCallResponse("LoadFuel", session);
  assert.equal(
    itemStore.findItemById(ship.itemID).conditionState.fuelCharge,
    1250,
  );
  assert.equal(itemStore.findItemById(fuelStackItem.itemID).stacksize, 1500);

  // Overflow surfaces a user error and leaves state untouched.
  assert.throws(() =>
    service.Handle_LoadFuel(
      [ship.itemID, FUEL_TYPE_UNSTABLE, 1500, null, null],
      session,
    ),
  );
  assert.equal(
    itemStore.findItemById(ship.itemID).conditionState.fuelCharge,
    1250,
  );

  // A different type joins the tail without replacing the active head.
  assert.equal(
    service.Handle_LoadFuel(
      [ship.itemID, FUEL_TYPE_EU_40, 250, null, null],
      session,
    ),
    null,
  );
  await service.afterCallResponse("LoadFuel", session);
  const mixedShip = itemStore.findItemById(ship.itemID);
  assert.equal(mixedShip.conditionState.fuelCharge, 1500);
  assert.equal(mixedShip.conditionState.fuelTypeID, FUEL_TYPE_UNSTABLE);
  assert.deepEqual(mixedShip.conditionState.fuelQueue, [
    { fuelTypeID: FUEL_TYPE_UNSTABLE, quantity: 1250 },
    { fuelTypeID: FUEL_TYPE_EU_40, quantity: 250 },
  ]);
  assert.equal(itemStore.findItemById(mixedFuelStackItem.itemID).stacksize, 50);

  // The persisted value survives a condition-state round trip (relog path).
  const roundTrip = itemStore.updateShipItem(ship.itemID, (current) => ({
    ...current,
  }));
  assert.equal(roundTrip.success, true);
  assert.equal(roundTrip.data.conditionState.fuelCharge, 1500);
  assert.deepEqual(roundTrip.data.conditionState.fuelQueue, [
    { fuelTypeID: FUEL_TYPE_UNSTABLE, quantity: 1250 },
    { fuelTypeID: FUEL_TYPE_EU_40, quantity: 250 },
  ]);
});

test("Handle_LoadFuel: zero-unit docked request fills or refreshes Creation fuel", async () => {
  const { ship } = grantTestItems();
  const { service, session, notifications } = buildHandlerHarness(ship);
  const args: any[] = [ship.itemID, FUEL_TYPE_UNSTABLE, 0, null, null];

  // Creation can reset its dynamic fuelCharge to the type default while the
  // station widget is being constructed, causing Refuel to submit zero. The
  // server treats that docked request as a fill-to-capacity operation.
  assert.equal(service.Handle_LoadFuel(args, session), null);
  assert.equal(
    itemStore.findItemById(ship.itemID).conditionState.fuelCharge,
    TANK_CAPACITY,
  );
  await service.afterCallResponse("LoadFuel", session);
  assert.equal(
    notifications.filter((entry) => entry.name === "OnModuleAttributeChanges").length,
    1,
  );

  // If persistence is already full but the UI is stale, the same action is a
  // successful no-op which replays the authoritative charge instead of showing
  // FUEL_QUANTITY_INVALID.
  session._lastLoadFuelRequest = null;
  notifications.length = 0;
  assert.equal(service.Handle_LoadFuel(args, session), null);
  await service.afterCallResponse("LoadFuel", session);
  assert.equal(
    itemStore.findItemById(ship.itemID).conditionState.fuelCharge,
    TANK_CAPACITY,
  );
  assert.equal(
    notifications.filter((entry) => entry.name === "OnModuleAttributeChanges").length,
    1,
  );
});

test("Handle_LoadFuel: rejects a non-active ship", () => {
  const { ship } = grantTestItems();
  const { service, session } = buildHandlerHarness(ship);
  assert.throws(() =>
    service.Handle_LoadFuel(
      [ship.itemID + 999, FUEL_TYPE_UNSTABLE, 100, null, null],
      session,
    ),
  );
});
