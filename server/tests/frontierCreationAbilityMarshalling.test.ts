"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const { marshalEncode } = require("../src/network/tcp/utils/marshal");
const { buildDict, unwrapMarshalValue } = require("../src/services/_shared/serviceHelpers");
const { buildCreationAbilityResponse } = require("../src/services/frontier/creationService");

test("Creation Leap activation response marshals its nested thrust state", () => {
  const thrustState = {
    containmentFactor: 1,
    fuelAttributeFactor: 8,
    volatilityFactor: 0.5,
    containmentReduction: 10,
    onlineThrusterCount: 6,
    torqueMultiplier: 0.05,
    leapThrust: 1800000000,
    thrustOverdrive: 0,
    totalActiveThrust: 1800000000,
    leapFuelRate: 0.37575,
    thrustOverdriveFuelRate: 0,
    totalFuelRate: 0.37575,
  };
  const response = buildCreationAbilityResponse({
    serverTime: 123456789n,
    durationMs: 1000,
    consumedFuel: 0.37575,
    thrustState,
    existingDict: buildDict([["ok", true]]),
  }, null);

  assert.doesNotThrow(() => marshalEncode(response, {
    compatibilityProfile: "frontier",
  }));
  assert.deepEqual(unwrapMarshalValue(response), {
    server_time: 123456789n,
    durationMs: 1000,
    consumedFuel: 0.37575,
    thrustState,
    existingDict: { ok: true },
  });
});
