import assert = require("node:assert/strict");
import test = require("node:test");
import fs = require("node:fs");
import path = require("node:path");

const config = require("../src/config");
const database = require("../src/gameStore");
const AirNpeService = require("../src/services/npe/airNpeService");
const { marshalEncode, marshalDecode } = require("../src/network/tcp/utils/marshal");

const CONFIG_FIELDS = [
  "clientBuild", "clientBuildProfile", "clientCompatibilityProfile",
  "newCharacterTutorialEnabled", "newCharacterIntroCinematicEnabled",
];
const flagCases = [];
let previousConfig;
test.beforeEach(() => {
  previousConfig = Object.fromEntries(CONFIG_FIELDS.map(key => [key, config[key]]));
  Object.assign(config, {
    clientBuild: 2703993,
    clientBuildProfile: "frontier-2703993",
    clientCompatibilityProfile: "frontier",
  });
});
test.afterEach(() => Object.assign(config, previousConfig));

function assertFeatureResponse(service, method, expected) {
  // These native feature queries have no arguments or selected character.
  let decoded;
  for (const name of [method, Buffer.from(method)]) {
    const result = service.callMethod(name, [], null, null);
    assert.equal(typeof result, "boolean", method);
    assert.equal(result, expected, method);
    decoded = marshalDecode(marshalEncode(result));
    assert.equal(decoded, expected, `${method} wire boolean`);
  }
  return decoded;
}

test("AIR feature calls dispatch independently for every tutorial and cinematic configuration", () => {
  const service = new AirNpeService();
  assert.equal(service.name, "air_npe");
  for (const tutorial of [false, true]) {
    for (const cinematic of [false, true]) {
      Object.assign(config, {
        newCharacterTutorialEnabled: tutorial,
        newCharacterIntroCinematicEnabled: cinematic,
      });
      const tutorialResult = assertFeatureResponse(service, "is_air_npe_tutorial_enabled", tutorial);
      const introResult = assertFeatureResponse(service, "is_air_npe_intro_video_enabled", cinematic);
      const combinedResult = assertFeatureResponse(service, "is_air_npe_enabled", tutorial || cinematic);
      flagCases.push({ tutorialEnabled: tutorial, cinematicEnabled: cinematic,
        introResult, tutorialResult, combinedResult });
    }
  }
});

test("AIR feature queries require strict boolean configuration and never write character state", t => {
  const writes = ["write", "remove", "prepareAtomicRowWrite", "commitAtomicRowWrites"]
    .map(method => t.mock.method(database, method, () => {
      assert.fail(`AIR feature query must not call gameStore.${method}`);
    }));
  const service = new AirNpeService();
  for (const disabled of [undefined, null, "true", "false", 1, 0]) {
    Object.assign(config, {
      newCharacterTutorialEnabled: disabled,
      newCharacterIntroCinematicEnabled: disabled,
    });
    assertFeatureResponse(service, "is_air_npe_tutorial_enabled", false);
    assertFeatureResponse(service, "is_air_npe_intro_video_enabled", false);
    assertFeatureResponse(service, "is_air_npe_enabled", false);
  }
  Object.assign(config, {
    newCharacterTutorialEnabled: true,
    newCharacterIntroCinematicEnabled: true,
  });
  assertFeatureResponse(service, "is_air_npe_tutorial_enabled", true);
  assertFeatureResponse(service, "is_air_npe_intro_video_enabled", true);
  for (const write of writes) assert.equal(write.mock.callCount(), 0);
});

test.after(() => {
  const directory = process.env.EVEJS_SERVICE_CALL_EVIDENCE_DIR;
  if (!directory || flagCases.length !== 4) return;
  const location = path.resolve(directory);
  fs.mkdirSync(location, { recursive: true });
  fs.writeFileSync(path.join(location, "air-server-payload.json"),
    JSON.stringify({ build: 2703993, cases: flagCases }, null, 2) + "\n");
});
