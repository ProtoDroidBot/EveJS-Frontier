"use strict";

/**
 * Build-3502403 assembly energy configuration contract coverage.
 * Run through:
 *   npm run test:isolated -- server/tests/frontierAssemblyEnergyConfig.test.js
 */

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  getAssemblyGateProtoTypes,
} = require("../src/_secondary/express/gatewayServices/assemblyGateProto");
const {
  GET_ENERGY_CONFIG_REQUEST,
  GET_ENERGY_CONFIG_RESPONSE,
  createAssemblyGateGatewayService,
} = require("../src/_secondary/express/gatewayServices/assemblyGateGatewayService");
const CHARACTER_ID = 140000005;
const energyConfig = require("../src/services/frontier/networkNodeEnergyConfig");
const CONFIG_ENTRIES = [
  { typeID: 88064, energyRequired: 200 },
  { typeID: 88067, energyRequired: 100 },
  { typeID: 88092, energyRequired: 0 },
];

test.afterEach(() => energyConfig.clearAssemblyEnergyConfig());

test("server accepts only a chain table that exactly matches the synchronized build manifest", () => {
  const components = [77917, 88086, 88092].map(typeID => ({
    _key: typeID,
    smartDeployable: { createOnChain: 1 },
  }));
  const manifest = [
    { typeID: 77917, energyRequired: 500 },
    { typeID: 88086, energyRequired: 0 },
    { typeID: 88092, energyRequired: 0 },
  ];
  assert.doesNotThrow(() => energyConfig.assertAssemblyEnergyConfigMatches(
    [{ typeID: 77917, energyRequired: 500 }], manifest, components,
  ));
  assert.throws(() => energyConfig.assertAssemblyEnergyConfigMatches(
    [], manifest, components,
  ), /77917: expected 500, chain absent/);
  assert.throws(() => energyConfig.assertAssemblyEnergyConfigMatches(
    [{ typeID: 77917, energyRequired: 500 }, { typeID: 88086, energyRequired: 1 }], manifest, components,
  ), /88086: expected 0, chain 1/);
  assert.throws(() => energyConfig.assertAssemblyEnergyConfigMatches(
    [{ typeID: 77917, energyRequired: 500 }, { typeID: 84556, energyRequired: 10 }], manifest, components,
  ), /84556: not in manifest/);
  assert.throws(() => energyConfig.assertAssemblyEnergyConfigMatches(
    [{ typeID: 77917, energyRequired: 500 }], manifest.slice(1), components,
  ), /missing 77917/);
  assert.throws(() => energyConfig.assertAssemblyEnergyConfigMatches(
    [{ typeID: 77917, energyRequired: 500 }], undefined, components,
  ), /run FrontierWorld\.ps1 sync/);
});

function requestEnvelope(payloadBuffer = Buffer.alloc(0), characterID = CHARACTER_ID) {
  return {
    authoritative_context: {
      active_character: {
        sequential: characterID,
      },
    },
    payload: {
      value: payloadBuffer,
    },
  };
}

test("assembly energy protobuf matches the build-3502403 descriptor", () => {
  const types = getAssemblyGateProtoTypes();
  const encodedRequest = types.getEnergyConfigRequest.encode({}).finish();
  assert.equal(encodedRequest.length, 0);

  const encodedResponse = types.getEnergyConfigResponse.encode({
    energy_requirements: [
      { assembly_type: 88067, energy_required: 100 },
      { assembly_type: 88064, energy_required: 200 },
    ],
  }).finish();
  const decoded = types.getEnergyConfigResponse.toObject(
    types.getEnergyConfigResponse.decode(encodedResponse),
    { longs: Number },
  );

  assert.deepEqual(decoded.energy_requirements, [
    { assembly_type: 88067, energy_required: 100 },
    { assembly_type: 88064, energy_required: 200 },
  ]);
});

test("assembly gateway returns the loaded nonzero energy configuration", (t) => {
  energyConfig.setAssemblyEnergyConfig(CONFIG_ENTRIES);
  const runtime = require("../src/services/frontier/networkNodeEnergyRuntime");
  // Gateway serialization is independent of which client static tables are
  // present in the disposable game store used by this contract test.
  t.mock.method(runtime, "getAssemblyEnergyConfig", energyConfig.getConfiguredAssemblyEnergyRequirements);
  const types = getAssemblyGateProtoTypes();
  const service = createAssemblyGateGatewayService();

  assert.ok(service.handledRequestTypes.includes(GET_ENERGY_CONFIG_REQUEST));
  assert.equal(
    service.getEmptySuccessResponseType(GET_ENERGY_CONFIG_REQUEST),
    null,
  );

  const response = service.handleRequest(
    GET_ENERGY_CONFIG_REQUEST,
    requestEnvelope(types.getEnergyConfigRequest.encode({}).finish()),
  );
  const decoded = types.getEnergyConfigResponse.toObject(
    types.getEnergyConfigResponse.decode(response.responsePayloadBuffer),
    { longs: Number, arrays: true },
  );

  assert.equal(response.statusCode, 200);
  assert.equal(response.statusMessage, "");
  assert.equal(response.responseTypeName, GET_ENERGY_CONFIG_RESPONSE);
  assert.deepEqual(decoded.energy_requirements, CONFIG_ENTRIES.map((entry) => ({
    assembly_type: entry.typeID,
    energy_required: entry.energyRequired,
  })));
  assert.ok(decoded.energy_requirements.some((entry) => entry.energy_required > 0));
});

test("assembly gateway does not let the client cache an unavailable energy configuration", () => {
  energyConfig.clearAssemblyEnergyConfig();
  const service = createAssemblyGateGatewayService();
  const response = service.handleRequest(GET_ENERGY_CONFIG_REQUEST, requestEnvelope());
  assert.equal(response.statusCode, 503);
  assert.equal(response.responseTypeName, GET_ENERGY_CONFIG_RESPONSE);
  assert.equal(response.responsePayloadBuffer.length, 0);
  assert.equal(service.getEmptySuccessResponseType(GET_ENERGY_CONFIG_REQUEST), null);
});

test("assembly energy configuration requires an active character", () => {
  const service = createAssemblyGateGatewayService();
  const denied = service.handleRequest(
    GET_ENERGY_CONFIG_REQUEST,
    requestEnvelope(Buffer.alloc(0), 0),
  );
  assert.equal(denied.statusCode, 403);
  assert.equal(denied.statusMessage, "ACCESS_DENIED");
  assert.equal(denied.responseTypeName, GET_ENERGY_CONFIG_RESPONSE);
});
