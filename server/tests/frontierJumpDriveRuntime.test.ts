"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  ATTRIBUTE_CAN_JUMP,
  ATTRIBUTE_CONSUMPTION_TYPE,
  ATTRIBUTE_HEAT_CAPACITY,
  ATTRIBUTE_JUMP_DRIVE_CONSUMPTION_AMOUNT,
  ATTRIBUTE_JUMP_DRIVE_CONSUMPTION_TYPE,
  ATTRIBUTE_JUMP_DRIVE_RANGE,
  ATTRIBUTE_MASS,
  ATTRIBUTE_TEMPERATURE,
  GROUP_JUMP_DRIVE,
  GROUP_POWER_GENERATOR,
  buildJumpDrivePlan,
  calculateFrontierFuelCost,
  calculateInstantJumpHeat,
  consumeFrontierFuelQueue,
} = require("../src/services/frontier/jumpDriveRuntime");
const JumpDriveMgrService = require("../src/services/frontier/jumpDriveMgrService");

const HULL_TYPE = 100;
const DRIVE_TYPE = 200;
const POWER_TYPE = 300;
const LEGACY_HULL_TYPE = 400;
const SUBLIME_FUEL = 87956;

const typeAttributes = {
  [HULL_TYPE]: {
    [ATTRIBUTE_MASS]: 18_929_160,
  },
  [LEGACY_HULL_TYPE]: {
    [ATTRIBUTE_MASS]: 1_000_000,
    [ATTRIBUTE_CAN_JUMP]: 1,
  },
};

function dependencies() {
  return {
    getTypeDogmaAttributes(typeID) {
      return typeAttributes[typeID] || {};
    },
    buildEffectiveItemAttributeMap(item) {
      return item.attributes || {};
    },
    isEffectivelyOnlineModule(item) {
      return item.online === true;
    },
    getShipFuelQueue(shipItem) {
      return shipItem.conditionState.fuelQueue;
    },
    getFuelProperties() {
      return {
        fuelEfficiency: 99,
        fuelContainmentBurden: 1,
        fuelThermalInefficiency: 1,
        fuelVolatility: 0,
      };
    },
  };
}

function creationFixture({ engineOnline = true, driveOnline = true } = {}) {
  const shipItem = {
    itemID: 10,
    typeID: HULL_TYPE,
    conditionState: {
      fuelCharge: 3000,
      fuelTypeID: SUBLIME_FUEL,
      fuelQueue: [{ fuelTypeID: SUBLIME_FUEL, quantity: 3000 }],
      temperature: 295,
    },
  };
  const resourceState = {
    mass: 18_929_160,
    attributes: {
      [ATTRIBUTE_MASS]: 18_929_160,
      [ATTRIBUTE_HEAT_CAPACITY]: 2.5,
      [ATTRIBUTE_TEMPERATURE]: 295,
    },
    fittedItems: [
      {
        itemID: 20,
        typeID: DRIVE_TYPE,
        groupID: GROUP_JUMP_DRIVE,
        online: driveOnline,
        attributes: {
          [ATTRIBUTE_CAN_JUMP]: 1,
          [ATTRIBUTE_JUMP_DRIVE_RANGE]: 30,
          [ATTRIBUTE_CONSUMPTION_TYPE]: SUBLIME_FUEL,
        },
      },
      {
        itemID: 21,
        typeID: POWER_TYPE,
        groupID: GROUP_POWER_GENERATOR,
        online: engineOnline,
        attributes: { [ATTRIBUTE_CAN_JUMP]: 1 },
      },
    ],
  };
  return { shipItem, resourceState };
}

test("Frontier fuel and instantaneous heat match the client equations", () => {
  const fuelAmount = calculateFrontierFuelCost({
    shipMass: 18_929_160,
    distanceLy: 0.5,
    fuelQuality: 99,
    fuelContainmentBurden: 1,
  });
  assert.ok(Math.abs(fuelAmount - 0.9560181818181818) < 1e-9);
  const heat = calculateInstantJumpHeat({
    fuelAmount,
    fuelThermalInefficiency: 1,
    heatCapacity: 2.5,
    shipMass: 18_929_160,
  });
  assert.ok(Math.abs(heat - 0.0505050505050505) < 1e-9);
});

test("Creation jump requires an online drive and an online engine or power generator", () => {
  const missingPower = creationFixture({ engineOnline: false });
  const noPowerPlan = buildJumpDrivePlan({
    ...missingPower,
    distanceLy: 0.5,
    deps: dependencies(),
  });
  assert.equal(noPowerPlan.success, false);
  assert.equal(noPowerPlan.errorMsg, "PROPULSION_REQUIRED");

  const missingDrive = creationFixture({ driveOnline: false });
  const noDrivePlan = buildJumpDrivePlan({
    ...missingDrive,
    distanceLy: 0.5,
    deps: dependencies(),
  });
  assert.equal(noDrivePlan.success, false);
  assert.equal(noDrivePlan.errorMsg, "JUMP_DRIVE_REQUIRED");
});

test("a fitted Frontier drive plans fuel, mass, range, and heat before initiation", () => {
  const fixture = creationFixture();
  const result: any = buildJumpDrivePlan({
    ...fixture,
    distanceLy: 0.5,
    deps: dependencies(),
  });
  assert.equal(result.success, true);
  assert.equal(result.data.fuelMode, "frontier-tank");
  assert.equal(result.data.fuelTypeID, SUBLIME_FUEL);
  assert.equal(result.data.fuelQuantity, 0.956018182);
  assert.ok(
    result.data.nextTemperature > 295.05 && result.data.nextTemperature < 295.051,
    JSON.stringify(result.data),
  );

  const outOfRange = buildJumpDrivePlan({
    ...fixture,
    distanceLy: 31,
    deps: dependencies(),
  });
  assert.equal(outOfRange.success, false);
  assert.equal(outOfRange.errorMsg, "OUT_OF_RANGE");
});

test("hull canJump authorizes an integrated legacy drive and fitted mass scales fuel", () => {
  const shipItem = {
    itemID: 11,
    typeID: LEGACY_HULL_TYPE,
    conditionState: { temperature: 295 },
  };
  const result: any = buildJumpDrivePlan({
    shipItem,
    resourceState: {
      mass: 2_000_000,
      attributes: {
        [ATTRIBUTE_MASS]: 2_000_000,
        [ATTRIBUTE_JUMP_DRIVE_RANGE]: 5,
        [ATTRIBUTE_JUMP_DRIVE_CONSUMPTION_TYPE]: 16274,
        [ATTRIBUTE_JUMP_DRIVE_CONSUMPTION_AMOUNT]: 100,
      },
      fittedItems: [],
    },
    distanceLy: 1,
    availableLegacyFuelQuantity: 200,
    deps: dependencies(),
  });
  assert.equal(result.success, true);
  assert.equal(result.data.driveSource, "hull");
  assert.equal(result.data.fuelMode, "inventory");
  assert.equal(result.data.fuelQuantity, 200);

  const preflight: any = buildJumpDrivePlan({
    shipItem,
    resourceState: {
      mass: 2_000_000,
      attributes: {
        [ATTRIBUTE_MASS]: 2_000_000,
        [ATTRIBUTE_JUMP_DRIVE_RANGE]: 5,
        [ATTRIBUTE_JUMP_DRIVE_CONSUMPTION_TYPE]: 16274,
        [ATTRIBUTE_JUMP_DRIVE_CONSUMPTION_AMOUNT]: 100,
      },
      fittedItems: [],
    },
    distanceLy: 1,
    deps: dependencies(),
  });
  assert.equal(preflight.success, true);
});

test("fuel and critical-temperature failures happen before initiation", () => {
  const fixture = creationFixture();
  fixture.shipItem.conditionState.fuelQueue[0].quantity = 0.1;
  const fuelResult = buildJumpDrivePlan({
    ...fixture,
    distanceLy: 0.5,
    deps: dependencies(),
  });
  assert.equal(fuelResult.success, false);
  assert.equal(fuelResult.errorMsg, "INSUFFICIENT_FUEL");

  const hotFixture = creationFixture();
  hotFixture.shipItem.conditionState.temperature = 1499.99;
  hotFixture.resourceState.attributes[ATTRIBUTE_TEMPERATURE] = 1499.99;
  const heatResult = buildJumpDrivePlan({
    ...hotFixture,
    distanceLy: 0.5,
    deps: dependencies(),
  });
  assert.equal(heatResult.success, false, JSON.stringify(heatResult));
  assert.equal(heatResult.errorMsg, "CRITICAL_HEAT");
});

test("Frontier jump consumption removes only the active FIFO fuel batch", () => {
  const result: any = consumeFrontierFuelQueue([
    { fuelTypeID: SUBLIME_FUEL, quantity: 1000 },
    { fuelTypeID: 77818, quantity: 50 },
  ], SUBLIME_FUEL, 125.5);
  assert.equal(result.success, true);
  assert.deepEqual(result.data.fuelQueue, [
    { fuelTypeID: SUBLIME_FUEL, quantity: 874.5 },
    { fuelTypeID: 77818, quantity: 50 },
  ]);
  assert.equal(result.data.fuelCharge, 924.5);
  assert.equal(result.data.fuelTypeID, SUBLIME_FUEL);
});

test("jumpDriveMgr exposes the client-authored cross-system RPC", () => {
  const service = new JumpDriveMgrService();
  assert.equal(service.name, "jumpDriveMgr");
  assert.equal(typeof service.Handle_cmd_jump_with_jump_drive, "function");
});
