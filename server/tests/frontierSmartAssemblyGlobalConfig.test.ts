"use strict";

/**
 * Run with the disposable game store because the shared global-config provider
 * also reads the New Eden Store:
 *   npm run test:isolated -- server/tests/frontierSmartAssemblyGlobalConfig.test.js
 */
const assert = require("node:assert/strict");
const test = require("node:test");

const config = require("../src/config");
const MachoNetService = require("../src/services/machoNet/machoNetService");
const {
  buildGlobalConfigDict,
  buildGlobalConfigEntries,
  resetRuntimeGlobalConfigForTests,
} = require("../src/services/machoNet/globalConfig");
const {
  marshalDecode,
  marshalEncode,
} = require("../src/network/tcp/utils/marshal");

const CONFIG_KEY = "smartAssemblyBaseDappUrl";
const CLIENT_KEY = "smartAssemblyBaseDappUrl";
const ENV_KEY = "EVEJS_SMART_ASSEMBLY_BASE_DAPP_URL";
const DEFAULT_URL = "http://localhost:5174";
const FRONTIER_MARSHAL_OPTIONS = { compatibilityProfile: "frontier" };

function getAdvertisedUrl(dict) {
  assert.equal(dict.type, "dict");
  const matches = dict.entries.filter(([key]) => key === CLIENT_KEY);
  assert.equal(matches.length, 1, "advertise the client key exactly once");
  return matches[0][1];
}

test("Smart Assembly DApp config registers the localhost default and environment setting", () => {
  const definition = config.getConfigDefinitions().find(
    (entry) => entry.key === CONFIG_KEY,
  );
  assert.ok(definition);
  assert.equal(definition.defaultValue, DEFAULT_URL);
  assert.equal(definition.envVar, ENV_KEY);
  assert.equal(definition.envType, "string");

  const defaults = config.getConfigStateSnapshot().defaults;
  assert.equal(defaults[CONFIG_KEY], DEFAULT_URL);
  assert.equal(getAdvertisedUrl(buildGlobalConfigDict(defaults)), DEFAULT_URL);
});

test("Smart Assembly DApp base URLs preserve paths and avoid doubled client route separators", () => {
  for (const clientCompatibilityProfile of ["frontier", "tranquility"]) {
    const entries = new Map(buildGlobalConfigEntries({
      clientCompatibilityProfile,
      smartAssemblyBaseDappUrl: "  https://dapps.example.test/assemblies///  ",
    }));
    const baseUrl = entries.get(CLIENT_KEY);
    assert.equal(baseUrl, "https://dapps.example.test/assemblies");
    for (const route of ["root", "behaviour", "networknode/monitor"]) {
      assert.equal(
        `${baseUrl}/client/${route}/?tenant=dev&itemId=123`,
        `https://dapps.example.test/assemblies/client/${route}/?tenant=dev&itemId=123`,
      );
    }
  }
});

for (const [label, configuredUrl, expectedUrl] of [
  ["localhost", DEFAULT_URL, DEFAULT_URL],
  ["custom base path", "  https://dapps.example.test/custom///  ", "https://dapps.example.test/custom"],
]) {
  test(`MachoNet exposes the ${label} DApp URL through initialization, config lookup, and Frontier marshal`, (t) => {
    const previousUrl = process.env[ENV_KEY];
    t.after(() => {
      if (previousUrl === undefined) {
        delete process.env[ENV_KEY];
      } else {
        process.env[ENV_KEY] = previousUrl;
      }
      resetRuntimeGlobalConfigForTests();
    });
    resetRuntimeGlobalConfigForTests();
    process.env[ENV_KEY] = configuredUrl;

    const snapshot = config.getConfigStateSnapshot();
    assert.equal(snapshot.sources[CONFIG_KEY], "env");
    assert.equal(snapshot.resolvedConfig[CONFIG_KEY].trim(), configuredUrl.trim());

    const service = new MachoNetService({ getSessions: () => [] });
    const initialization = service.Handle_GetInitVals([], null);
    const globalConfig = service.Handle_GetGlobalConfig([], null);
    assert.equal(getAdvertisedUrl(initialization[1]), expectedUrl);
    assert.equal(getAdvertisedUrl(globalConfig), expectedUrl);
    assert.deepEqual(
      service.Handle_GetGlobalConfigValue([CLIENT_KEY], null),
      [CLIENT_KEY, expectedUrl],
    );

    // The handshake's config_vals uses this same shared dictionary provider.
    const handshakeConfig = buildGlobalConfigDict();
    assert.equal(getAdvertisedUrl(handshakeConfig), expectedUrl);
    for (const payload of [initialization, globalConfig, handshakeConfig]) {
      const decoded = marshalDecode(
        marshalEncode(payload, FRONTIER_MARSHAL_OPTIONS),
        FRONTIER_MARSHAL_OPTIONS,
      );
      assert.equal(
        getAdvertisedUrl(Array.isArray(decoded) ? decoded[1] : decoded),
        expectedUrl,
      );
    }
  });
}
