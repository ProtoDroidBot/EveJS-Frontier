"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const DogmaService = require("../src/services/dogma/dogmaService");

test("docked Dogma ship health converts persisted hull damage to absolute HP", () => {
  const service = new DogmaService();
  service._getShipRuntimeAttributeOverrides = () => ({
    attributes: {
      9: 2_100,
      263: 0,
      265: 0,
    },
    mass: 1,
    maxVelocity: 0,
    maxTargetRange: 0,
    maxLockedTargets: 0,
    signatureRadius: 0,
    cloakingTargetingDelay: 0,
    scanResolution: 0,
  });
  const damageRatio = 1_525 / 2_100;
  const ship = {
    itemID: 99_884_000_001_895,
    typeID: 95_276,
    ownerID: 140_000_005,
    conditionState: {
      armorDamage: 0,
      charge: 1,
      damage: damageRatio,
      shieldCharge: 0,
    },
  };

  const attributes = service._buildShipAttributes(
    { characterID: ship.ownerID },
    ship,
    { compatibilityProfile: "frontier" },
    {
      creationDogmaContext: {
        shipAttributeModifierEntries: [],
      },
    },
  );

  assert.equal(attributes[3], 1_525);
  assert.equal(attributes[9], 2_100);
  assert.equal(ship.conditionState.damage, damageRatio);
});
