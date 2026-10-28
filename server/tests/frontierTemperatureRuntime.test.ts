"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const temperatureRuntime = require(
  "../src/services/frontier/temperatureRuntime",
);
const scanningRuntime = require(
  "../src/services/frontier/scanningRuntime",
);
const {
  findWeaponLineOccluder,
} = require("../src/space/destiny/simulation/collisions");
const {
  normalizeShipConditionState,
} = require("../src/services/inventory/itemStore");

function buildThermalShip(overrides: Record<string, any> = {}): any {
  return {
    itemID: 1001,
    kind: "ship",
    mode: "STOP",
    mass: 1_000_000,
    position: { x: 1_000_000, y: 0, z: 0 },
    conditionState: {},
    passiveDerivedState: {
      attributes: {
        [temperatureRuntime.ATTRIBUTE_MASS]: 1_000_000,
        [temperatureRuntime.ATTRIBUTE_HEAT_CAPACITY]: 3,
        [temperatureRuntime.ATTRIBUTE_HEAT_CONDUCTANCE]: 2,
      },
    },
    ...overrides,
  };
}

function buildScene(ship): any {
  return {
    system: {
      frostLine: 1_000_000,
      radius: 10_000_000,
      starTemperature: 1000,
    },
    staticEntities: [{
      itemID: 4001,
      kind: "sun",
      groupID: 6,
      radius: 100,
      position: { x: 0, y: 0, z: 0 },
    }],
    dynamicEntities: new Map([[ship.itemID, ship]]),
    getDynamicEntities() {
      return [...this.dynamicEntities.values()];
    },
  };
}

test("distance temperature follows the Frontier frost-line curve", () => {
  assert.equal(
    temperatureRuntime.temperatureByDistance(1_000_000, 1_000_000, 1000),
    150,
  );
  assert.equal(
    temperatureRuntime.temperatureByDistance(250_000, 1_000_000, 1000),
    300,
  );
  assert.equal(
    temperatureRuntime.temperatureByDistance(4_000_000, 1_000_000, 1000),
    75,
  );
  assert.equal(
    temperatureRuntime.temperatureByDistance(1, 1_000_000, 1000),
    1000,
  );
});

test("hull temperature exponentially approaches sunlight and shadow ambient", () => {
  const ship = buildThermalShip();
  const scene = buildScene(ship);

  const initial = temperatureRuntime.advanceShipTemperature(scene, ship, 1000, {
    findLineOccluder: () => null,
  });
  assert.equal(initial.supported, true);
  assert.equal(initial.externalTemperature, 150);
  assert.equal(initial.temperature, 295);
  assert.ok(Math.abs(initial.timeScaleSeconds - 15) < 1e-9);

  const heated = temperatureRuntime.advanceShipTemperature(scene, ship, 16000, {
    findLineOccluder: () => null,
  });
  assert.ok(Math.abs(heated.temperature - (150 + (145 / Math.E))) < 1e-6);

  const shadowed = temperatureRuntime.advanceShipTemperature(scene, ship, 17000, {
    findLineOccluder: () => ({ entityID: 4002, kind: "planet" }),
  });
  assert.equal(shadowed.shadowed, true);
  assert.equal(shadowed.externalTemperature, 2.7);
  assert.equal(shadowed.occluderID, 4002);
  assert.equal(shadowed.notification.shadowChanged, true);

  const cooled = temperatureRuntime.advanceShipTemperature(scene, ship, 32000, {
    findLineOccluder: () => ({ entityID: 4002, kind: "planet" }),
  });
  assert.ok(cooled.temperature < shadowed.temperature);
  assert.equal(ship.conditionState.temperature, cooled.temperature);
  assert.equal(
    ship.passiveDerivedState.attributes[
      temperatureRuntime.ATTRIBUTE_EXTERNAL_TEMPERATURE
    ],
    2.7,
  );
});

test("a physical celestial between the star and ship creates a thermal shadow", () => {
  const ship = buildThermalShip({
    position: { x: 1000, y: 0, z: 0 },
  });
  const scene = buildScene(ship);
  scene.system.frostLine = 1000;
  scene.staticEntities.push({
    itemID: 4002,
    kind: "planet",
    radius: 100,
    position: { x: 500, y: 0, z: 0 },
  });

  const result = temperatureRuntime.advanceShipTemperature(scene, ship, 1000, {
    findLineOccluder: findWeaponLineOccluder,
  });
  assert.equal(result.shadowed, true);
  assert.equal(result.externalTemperature, temperatureRuntime.SHADOW_TEMPERATURE_K);
  assert.equal(result.occluderID, 4002);

  ship.position = { x: 1000, y: 500, z: 0 };
  const exposed = temperatureRuntime.advanceShipTemperature(scene, ship, 2000, {
    findLineOccluder: findWeaponLineOccluder,
  });
  assert.equal(exposed.shadowed, false);
  assert.ok(exposed.externalTemperature > temperatureRuntime.SHADOW_TEMPERATURE_K);
});

test("warp uses the client-authored zero-kelvin external temperature", () => {
  const ship = buildThermalShip({ mode: "WARP" });
  const result = temperatureRuntime.advanceShipTemperature(
    buildScene(ship),
    ship,
    1000,
    {
      findLineOccluder() {
        throw new Error("warp must not perform a solar occlusion query");
      },
    },
  );
  assert.equal(result.externalTemperature, 0);
  assert.equal(result.shadowed, false);
});

test("a berthed ship uses sheltered ambient temperature", () => {
  const ship = buildThermalShip({
    frontierBerthingHostAssemblyID: 91_001,
    conditionState: {
      temperature: 600,
      externalTemperature: 1_000,
    },
  });
  const scene = buildScene(ship);

  const initial = temperatureRuntime.advanceShipTemperature(
    scene,
    ship,
    1_000,
    {
      findLineOccluder() {
        throw new Error("a berth must not query the exterior thermal path");
      },
    },
  );
  const cooled = temperatureRuntime.advanceShipTemperature(
    scene,
    ship,
    16_000,
    {
      findLineOccluder() {
        throw new Error("a berth must not query the exterior thermal path");
      },
    },
  );

  assert.equal(initial.protected, true);
  assert.equal(initial.externalTemperature, temperatureRuntime.STATION_TEMPERATURE_K);
  assert.equal(cooled.protected, true);
  assert.equal(cooled.externalTemperature, temperatureRuntime.STATION_TEMPERATURE_K);
  assert.ok(cooled.temperature < initial.temperature);
  assert.ok(cooled.temperature > temperatureRuntime.STATION_TEMPERATURE_K);
});

test("hull temperature scales only the thermal scanning signature", () => {
  const coldShip = buildThermalShip({
    conditionState: { temperature: 147.5 },
  });
  const hotShip = buildThermalShip({
    conditionState: { temperature: 590 },
  });
  const coldMultiplier =
    temperatureRuntime.resolveEntityThermalSignatureMultiplier(coldShip, 1000);
  const hotMultiplier =
    temperatureRuntime.resolveEntityThermalSignatureMultiplier(hotShip, 1000);
  assert.equal(coldMultiplier, 0.5);
  assert.equal(hotMultiplier, 2);

  const signatures = scanningRuntime.buildSignatureResultsForTarget({
    baseSignature: 10,
    distanceMeters: 1_000_000,
    multipliers: [
      [scanningRuntime.SIGNATURE_TYPE_GRAVIMETRIC, 500],
      [scanningRuntime.SIGNATURE_TYPE_ELECTROMAGNETIC, 500],
      [scanningRuntime.SIGNATURE_TYPE_THERMAL, 500],
    ],
    massKg: scanningRuntime.GRAVIMETRIC_REFERENCE_MASS_KG,
    emSignatureMultiplier: 1,
    thermalSignatureMultiplier: hotMultiplier,
  });
  assert.deepEqual(signatures.map((entry) => entry[1]), [5, 5, 10]);
});

test("temperature persists through ship condition normalization", () => {
  const normalized = normalizeShipConditionState({
    temperature: 412.5,
    externalTemperature: 150,
  });
  assert.equal(normalized.temperature, 412.5);
  assert.equal(normalized.externalTemperature, 150);

  const legacy = normalizeShipConditionState({});
  assert.equal(Object.hasOwn(legacy, "temperature"), false);
  assert.equal(Object.hasOwn(legacy, "externalTemperature"), false);
});
