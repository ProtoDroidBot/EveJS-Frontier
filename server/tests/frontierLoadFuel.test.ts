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
  appendFuelQueueBatch,
  calculateFuelQueueProperties,
  calculateFueledCapacitorRecharge,
  collectFuelSourceStacks,
  getFuelEfficiency,
  getShipFuelCharge,
  getShipFuelQueue,
  getShipFuelProperties,
  getShipFuelTypeID,
  loadFuelIntoShipTank,
  normalizeFuelQueue,
  normalizeRequestedFuelItemIDs,
  resolveShipFuelTank,
} = require("../src/services/frontier/fuelTankRuntime");
const itemStore = require("../src/services/inventory/itemStore");
const DogmaService = require("../src/services/dogma/dogmaService");
const {
  advanceEntityCapacitorRechargeForTesting,
} = require("../src/space/runtime")._testing;

const FUEL_TYPE_UNSTABLE = 77818; // group 4598 (corvette/hydrogen fuel)
const FUEL_TYPE_EU_90 = 78437;
const FUEL_TYPE_SOF_80 = 78515;
const FUEL_TYPE_EU_40 = 78516;
const FUEL_TYPE_SOF_40 = 84868;
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

test("capacitor recharge is capped by unused power grid and burns fuel by efficiency", () => {
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
  assert.equal(recharge.fuelEfficiency, 8);
  assert.equal(recharge.rechargedEnergy, 20);
  assert.equal(recharge.consumedFuel, 2.5);
  assert.equal(recharge.nextCapacitorAmount, 40);
  assert.equal(recharge.nextFuelCharge, 7.5);
});

test("more unused power grid directly accelerates Frontier recharge", () => {
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
  assert.equal(calculate(30, 5).rechargedEnergy, 50);
  assert.equal(calculate(5, 5).rechargedEnergy, 0);
  assert.equal(calculate(4, 5).consumedFuel, 0);
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
    ].map((typeID) => getFuelEfficiency(typeID, deps)),
    [40, 40, 80, 90],
  );
  assert.equal(crude.rechargedEnergy, 20);
  assert.equal(crude.consumedFuel, 0.5);
  assert.equal(crude.nextFuelCharge, 0);
});

test("space recharge applies the same fuel and power-grid rules to Creation and regular ships", () => {
  const deps = buildFakeStore().deps;
  for (const [typeID, fuelCapacity, capacitorRechargeRate] of [
    [CREATION_SHIP_TYPE, TANK_CAPACITY, 1.2],
    [REGULAR_FUEL_SHIP_TYPE, 3000, 0],
  ]) {
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
        attributes: {
          [ATTRIBUTE_FUEL_CAPACITY]: fuelCapacity,
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
    assert.equal(result.rechargedEnergy, 10);
    assert.equal(entity.capacitorChargeRatio, 0.3);
    assert.equal(entity.conditionState.fuelCharge, 8.75);
    assert.equal(entity.conditionState.fuelTypeID, FUEL_TYPE_UNSTABLE);
    assert.deepEqual(entity.conditionState.fuelQueue, [
      { fuelTypeID: FUEL_TYPE_UNSTABLE, quantity: 8.75 },
    ]);
  }
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
      fuelCharge: 4,
      fuelQueue: [
        { fuelTypeID: FUEL_TYPE_UNSTABLE, quantity: 1 },
        { fuelTypeID: FUEL_TYPE_EU_40, quantity: 3 },
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
  assert.equal(entity.conditionState.fuelCharge, 1.95);
  assert.equal(entity.conditionState.fuelTypeID, FUEL_TYPE_EU_40);
  assert.deepEqual(entity.conditionState.fuelQueue, [
    { fuelTypeID: FUEL_TYPE_EU_40, quantity: 1.95 },
  ]);
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
  const ship = shipGrant.data.items[0];
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

test("Handle_LoadFuel: end-to-end load, duplicate suppression, persistence", () => {
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
  assert.equal(persistedStack.stacksize, 500);

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
  assert.equal(
    itemStore.findItemById(ship.itemID).conditionState.fuelCharge,
    1000,
  );
  assert.equal(itemStore.findItemById(fuelStackItem.itemID).stacksize, 500);

  // A different quantity is a new logical action.
  assert.equal(
    service.Handle_LoadFuel(
      [ship.itemID, FUEL_TYPE_UNSTABLE, 250, null, null],
      session,
    ),
    null,
  );
  assert.equal(
    itemStore.findItemById(ship.itemID).conditionState.fuelCharge,
    1250,
  );
  assert.equal(itemStore.findItemById(fuelStackItem.itemID).stacksize, 250);

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
