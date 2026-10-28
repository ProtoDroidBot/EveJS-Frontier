import assert = require("node:assert/strict");
import fs = require("node:fs");
import path = require("node:path");
import test = require("node:test");

const {
  buildCreationValidationStateFromTemplate,
  rotateCreationCellOffset,
  transformCreationCellOffsets,
  validateCreationLayout,
  validateCreationTemplateLayout,
} = require("../src/services/frontier/creationLayoutValidation");

const REPO_ROOT = path.resolve(__dirname, "../..");
const STATIC_ROOT = path.resolve(
  process.env.EVEJS_STATIC_JSONL_ROOT ||
  path.join(REPO_ROOT, "_local", "frontier-sde", "3502403"),
);
const CONFIGURED_STORE_ROOT = process.env.EVEJS_TEST_STORE_BASELINE_ROOT
  ? path.resolve(process.env.EVEJS_TEST_STORE_BASELINE_ROOT)
  : null;
const LOCAL_FRONTIER_STORE_ROOT = path.join(
  REPO_ROOT,
  "_local",
  "frontier-gameStore",
  "3502403",
);
const STORE_ROOT = CONFIGURED_STORE_ROOT && fs.existsSync(path.join(
  CONFIGURED_STORE_ROOT,
  "data",
  "creationTemplates",
  "data.json",
))
  ? CONFIGURED_STORE_ROOT
  : LOCAL_FRONTIER_STORE_ROOT;

function readJsonLines(fileName) {
  const filePath = path.join(STATIC_ROOT, fileName);
  assert.ok(fs.existsSync(filePath), `missing Frontier SDE table ${filePath}`);
  return fs.readFileSync(filePath, "utf8")
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

const hardpointTypes = readJsonLines("creationHardpointTypes.jsonl");
const modules = readJsonLines("creationModules.jsonl");
const parts = readJsonLines("creationParts.jsonl");
const templates = readJsonLines("creationTemplates.jsonl");
const hardpointTypesByID = new Map(
  hardpointTypes.map((row) => [String(row._key), row]),
);
const modulesByID = new Map(modules.map((row) => [Number(row._key), row]));
const partsByID = new Map(parts.map((row) => [Number(row._key), row]));
const templatesByID = new Map(templates.map((row) => [Number(row._key), row]));
const resolvers = {
  getHardpointType: (hardpointType) => hardpointTypesByID.get(String(hardpointType)),
  getModule: (typeID) => modulesByID.get(Number(typeID)),
  getPart: (graphicID) => partsByID.get(Number(graphicID)),
  getTemplate: (typeID) => templatesByID.get(Number(typeID)),
};

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

test("build 3502403 Creation SDE and imported tables are present", () => {
  assert.equal(hardpointTypes.length, 3);
  assert.equal(modules.length, 39);
  assert.equal(parts.length, 15);
  assert.equal(templates.length, 3);
  assert.deepEqual(
    templates.map((entry) => Number(entry._key)).sort((left, right) => left - right),
    [95276, 95735, 95968],
  );

  const importedTables = [
    ["creationHardpointTypes", "hardpointTypes", 3],
    ["creationModules", "modules", 40],
    ["creationParts", "parts", 15],
    ["creationTemplates", "templates", 3],
  ];
  for (const [tableName, collectionName, expectedCount] of importedTables) {
    const tablePath = path.join(
      STORE_ROOT,
      "data",
      String(tableName),
      "data.json",
    );
    assert.ok(fs.existsSync(tablePath), `missing imported Creation table ${tablePath}`);
    const table = JSON.parse(fs.readFileSync(tablePath, "utf8"));
    assert.equal(table.count, expectedCount);
    assert.equal(table[collectionName].length, expectedCount);
    if (tableName === "creationModules") {
      assert.equal(modulesByID.has(99999), false, "Physics Gun is a local overlay");
      assert.ok(table.modules.some((module) => Number(module._key) === 99999));
    }
  }
});

test("Creation cell rotation matches the native client convention", () => {
  assert.deepEqual(rotateCreationCellOffset(2, 3, 0, 0), [2, 3, 0]);
  assert.deepEqual(rotateCreationCellOffset(2, 3, 0, 90), [-3, 2, 0]);
  assert.deepEqual(rotateCreationCellOffset(2, 3, 0, 180), [-2, -3, 0]);
  assert.deepEqual(rotateCreationCellOffset(2, 3, 0, 270), [3, -2, 0]);
});

test("Creation module reflections preserve the authored footprint before rotation", () => {
  const cells = [
    { x: 0, y: 0 },
    { x: 1, y: 0 },
    { x: 0, y: 1 },
  ];
  assert.deepEqual(
    transformCreationCellOffsets(cells, { x: 180, y: 0, z: 0 }),
    [[1, 0, 0], [0, 0, 0], [1, 1, 0]],
  );
  assert.deepEqual(
    transformCreationCellOffsets(cells, { x: 0, y: 180, z: 90 }),
    [[-1, 0, 0], [-1, 1, 0], [0, 0, 0]],
  );
});

test("layout validation accepts only discrete mirror and flip states", () => {
  const template = {
    _key: 1,
    typeID: 1,
    parts: { "1": { graphic_id: 10 } },
    restrictions: {},
  };
  const state = {
    templateTypeID: 1,
    modules: [{ itemID: 100, typeID: 20 }],
    interiorPlacements: [{
      itemID: 100,
      partID: 1,
      x: 1,
      y: 1,
      z: 0,
      rotation: { x: 180, y: 180, z: 90 },
    }],
    hardpoints: [],
  };
  const reflectionResolvers = {
    getTemplate: () => template,
    getPart: () => ({
      cells: Array.from({ length: 5 }, (_, x) =>
        Array.from({ length: 5 }, (_unused, y) => ({ x, y }))).flat(),
      hardpoints: {},
    }),
    getModule: () => ({
      placement: { occupancy: { cells: [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 0, y: 1 },
      ] } },
    }),
    getHardpointType: () => null,
  };
  assert.deepEqual(validateCreationLayout(state, template, reflectionResolvers), []);
  state.interiorPlacements[0].rotation.x = 90;
  const diagnostics = validateCreationLayout(state, template, reflectionResolvers);
  assert.ok(diagnostics.some((entry) =>
    entry.code === "invalid_placement" &&
    entry.params.reason === "UNSUPPORTED_GRID_TRANSFORM"));
});

test("all authored build 3502403 Creation templates are valid golden layouts", () => {
  const summaries = [];
  for (const template of templates) {
    const state = buildCreationValidationStateFromTemplate(template);
    const diagnostics = validateCreationTemplateLayout(template, resolvers);
    assert.deepEqual(
      diagnostics,
      [],
      `template ${template._key} diagnostics: ${JSON.stringify(diagnostics)}`,
    );
    summaries.push({
      typeID: Number(template._key),
      interiors: state.interiorPlacements.length,
      modules: state.modules.length,
      hardpoints: state.hardpoints.length,
    });
  }
  assert.deepEqual(summaries, [
    { typeID: 95276, interiors: 21, modules: 27, hardpoints: 7 },
    { typeID: 95735, interiors: 23, modules: 30, hardpoints: 8 },
    { typeID: 95968, interiors: 16, modules: 22, hardpoints: 7 },
  ]);
});

test("layout validation rejects cells outside their SDE part", () => {
  const template = templatesByID.get(95276);
  const state = buildCreationValidationStateFromTemplate(template);
  state.interiorPlacements[0].x = 1000;
  const diagnostics = validateCreationLayout(state, template, resolvers);
  assert.ok(diagnostics.some((entry) =>
    entry.code === "invalid_placement" &&
    entry.params.reason === "CELL_OUTSIDE_PART"));
});

test("layout validation rejects overlapping component occupancy", () => {
  const template = templatesByID.get(95276);
  const state = buildCreationValidationStateFromTemplate(template);
  const inventoryModules = state.modules
    .filter((module) => module.typeID === 95315)
    .map((module) => module.itemID);
  const first = state.interiorPlacements.find(
    (placement) => placement.itemID === inventoryModules[0],
  );
  const second = state.interiorPlacements.find(
    (placement) => placement.itemID === inventoryModules[1],
  );
  Object.assign(second, clone(first), { itemID: second.itemID });
  const diagnostics = validateCreationLayout(state, template, resolvers);
  assert.ok(diagnostics.some((entry) =>
    entry.code === "invalid_placement" &&
    entry.params.reason === "CELL_OCCUPIED"));
});

test("layout validation enforces final SDE type restrictions", () => {
  const template = templatesByID.get(95276);
  const state = buildCreationValidationStateFromTemplate(template);
  const commandModule = state.modules.find((module) => module.typeID === 95323);
  state.modules = state.modules.filter(
    (module) => module.itemID !== commandModule.itemID,
  );
  state.interiorPlacements = state.interiorPlacements.filter(
    (placement) => placement.itemID !== commandModule.itemID,
  );
  const diagnostics = validateCreationLayout(state, template, resolvers);
  assert.ok(diagnostics.some((entry) =>
    entry.code === "multiplicity_below_minimum" &&
    entry.params.type_id === 95323));
});

test("layout validation rejects hardpoints outside authored SDE locators", () => {
  const template = templatesByID.get(95276);
  const state = buildCreationValidationStateFromTemplate(template);
  state.hardpoints[0].x += 1;
  const diagnostics = validateCreationLayout(state, template, resolvers);
  assert.ok(diagnostics.some((entry) =>
    entry.code === "invalid_placement" &&
    entry.params.reason === "HARDPOINT_LOCATION_NOT_IN_SDE"));
});

test("layout validation requires every declared provider hardpoint", () => {
  const template = templatesByID.get(95276);
  const state = buildCreationValidationStateFromTemplate(template);
  const removed = state.hardpoints.shift();
  const diagnostics = validateCreationLayout(state, template, resolvers);
  assert.ok(diagnostics.some((entry) =>
    entry.code === "missing_hardpoint_placement" &&
    entry.moduleItemID === removed.interiorItemID &&
    entry.params.hardpoint_indices.includes(removed.hardpointIndex)));
});

test("layout validation rejects incompatible exterior attachments", () => {
  const template = templatesByID.get(95276);
  const state = buildCreationValidationStateFromTemplate(template);
  const boosterHardpoint = state.hardpoints.find(
    (hardpoint) => hardpoint.attachedItemID != null,
  );
  const exterior = state.modules.find(
    (module) => module.itemID === boosterHardpoint.attachedItemID,
  );
  exterior.typeID = 95317;
  const diagnostics = validateCreationLayout(state, template, resolvers);
  assert.ok(diagnostics.some((entry) =>
    entry.code === "hardpoint_type_mismatch" &&
    entry.moduleItemID === exterior.itemID));
});
