"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { createExplorationRuntime, createFileKnowledgeStore, getExplorationRuntime } = require("../src/services/frontier/explorationRuntime");

const character = { userID: 10, characterID: 20, currentSystemID: 2 };
function setup(overrides: Record<string, any> = {}) {
  const saved = new Map();
  const world = {
    revision: "test-world", version: { major: 1, minor: 0, patch: 0, build_tags: ["test-world"] },
    systems: new Map([1, 2, 3, 4, 5].map(id => [id, { id }])), starterSystemIds: [2],
    makeDelta(ids, detail, sequence) {
      return { schemaVersion: 14, bundleVersion: "1.0.0+test-world", complete: false, sequence,
        systems: ids.map(id => ({ id, revealLevel: detail ? 1 : 0, ...(detail ? { sun: { id: id + 100 } } : {}) })) };
    },
  };
  const options = { world, encode: value => Buffer.from(JSON.stringify(value)),
    stateStore: { read: key => saved.get(key), write: (key, value) => saved.set(key, structuredClone(value)) },
    cursorSecret: "unit-test-secret", ...overrides };
  return { runtime: createExplorationRuntime(options), saved, world, options };
}
const decode = response => JSON.parse(response.payload);
const status = code => error => error.statusCode === code;

test("starter hydration and character map separate charting from actual visits", () => {
  const { runtime, saved } = setup();
  const starter = runtime.getKnownUniverse({ userID: 10, characterID: null });
  assert.deepEqual(decode(starter).systems, [{ id: 2, revealLevel: 0 }]);
  assert.equal(starter.total_systems, "1");
  assert.equal(saved.size, 0);
  const response = runtime.getKnownUniverse(character);
  assert.equal(response.total_systems, "5");
  assert.deepEqual(response.knowledge.visited_system_ids, ["2"]);
  assert.deepEqual(decode(response).systems.map(system => system.revealLevel), [0, 1, 0, 0, 0]);
  assert.equal(decode(response).systems[1].sun.id, 102);
  assert.equal(decode(response).complete, false);
  assert.equal(response.knowledge.complete, true);
  assert.equal(saved.get("10-20").revision, 1);
  runtime.getKnownUniverse(character);
  assert.equal(saved.get("10-20").revision, 1);
});

test("pages cover the stable sorted world exactly once and terminate", () => {
  const { runtime } = setup();
  const ids = [];
  let token = "";
  let count = 0;
  do {
    const response = runtime.getKnownUniverse(character, { size: 2, token });
    ids.push(...decode(response).systems.map(system => system.id));
    token = response.next_page.token;
    assert.equal(response.total_systems, "5");
    assert.equal(response.knowledge.revision, "1");
    count++;
  } while (token && count < 10);
  assert.deepEqual(ids, [1, 2, 3, 4, 5]);
  assert.equal(count, 3);
});

test("cursors reject tampering, identity, size, world and knowledge changes", () => {
  const { runtime, options, world } = setup();
  const token = runtime.getKnownUniverse(character, { size: 2 }).next_page.token;
  assert.throws(() => runtime.getKnownUniverse(character, { token: `${token}x` }), status(400));
  assert.throws(() => runtime.getKnownUniverse({ ...character, userID: 11 }, { token }), status(400));
  assert.throws(() => runtime.getKnownUniverse({ ...character, characterID: 21 }, { token }), status(400));
  assert.throws(() => runtime.getKnownUniverse(character, { token, size: 3 }), status(400));
  assert.throws(() => createExplorationRuntime({ ...options, world: { ...world, revision: "another" } }).getKnownUniverse(character, { token }), status(400));
  runtime.revealSystem(character, 3);
  assert.throws(() => runtime.getKnownUniverse(character, { token }), status(400));
  for (const size of [-1, 513, NaN, 1.5]) assert.throws(() => runtime.getKnownUniverse(character, { size }), status(400));
  assert.throws(() => runtime.getKnownUniverse(character, { token: "x".repeat(2049) }), status(400));
});

test("detail requests never grant visits and current system must belong to world", () => {
  const { runtime, saved } = setup();
  assert.throws(() => runtime.getSystemDetail({ userID: 10, characterID: null }, "2"), status(403));
  assert.throws(() => runtime.getSystemDetail(character, "3"), status(403));
  assert.equal(saved.size, 0);
  assert.equal(decode(runtime.getSystemDetail(character, "2")).systems[0].sun.id, 102);
  assert.deepEqual(saved.get("10-20").visited, [2]);
  assert.throws(() => runtime.getSystemDetail(character, "99"), status(404));
  assert.throws(() => runtime.getSystemDetail(character, "18446744073709551615"), status(400));
  assert.throws(() => runtime.getKnownUniverse({ ...character, currentSystemID: 99 }), status(409));
  assert.throws(() => runtime.getSystemDetail({ userID: 11, characterID: 20 }, "2"), status(403));
  assert.throws(() => runtime.getKnownUniverse({ userID: 0, characterID: null }), status(401));
});

test("reveal notices follow durable changes, are scoped and tolerate listener failures", () => {
  const { runtime, saved } = setup();
  const events = [];
  runtime.subscribe(() => { throw new Error("disconnected consumer"); });
  const unsubscribe = runtime.subscribe(event => {
    assert.equal(saved.get("10-20").revision, Number(event.payload.knowledge.revision));
    events.push(event);
  });
  runtime.getKnownUniverse(character);
  runtime.getKnownUniverse(character);
  runtime.revealSystem(character, 3);
  assert.equal(events.length, 2);
  assert.deepEqual(events[1].identity, character);
  assert.deepEqual(events[1].payload.knowledge.visited_system_ids, ["2", "3"]);
  assert.equal(decode(events[1].payload).systems[0].id, 3);
  unsubscribe();
  runtime.revealSystem(character, 4);
  assert.equal(events.length, 2);
});

test("persistence survives runtime reconstruction and corrupted state fails closed", t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "exploration-state-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const stateStore = createFileKnowledgeStore(directory);
  const { runtime, options } = setup({ stateStore });
  runtime.getKnownUniverse(character);
  runtime.revealSystem(character, 3);
  const restored = createExplorationRuntime(options);
  assert.deepEqual(restored.getKnownUniverse(character).knowledge.visited_system_ids, ["2", "3"]);
  assert.equal(fs.readdirSync(directory).length, 1);
  fs.writeFileSync(path.join(directory, "10-20.json"), '{"revision":2,"visited":[2,99]}');
  assert.throws(() => restored.getKnownUniverse(character), status(503));
  fs.writeFileSync(path.join(directory, "10-20.json"), "broken");
  assert.throws(() => restored.getKnownUniverse(character), status(503));
  assert.throws(() => stateStore.read("../../outside"));
});

test("a failed persistence operation emits no notice", () => {
  const { runtime } = setup({ stateStore: { read: () => null, write: () => { throw new Error("disk full"); } } });
  let notices = 0;
  runtime.subscribe(() => notices++);
  assert.throws(() => runtime.getKnownUniverse(character), /disk full/);
  assert.equal(notices, 0);
});

test("invalid initial pages neither save knowledge nor publish a visit", () => {
  const { runtime, saved } = setup();
  let notices = 0;
  runtime.subscribe(() => notices++);
  assert.throws(() => runtime.getKnownUniverse(character, { size: 999 }), status(400));
  assert.throws(() => runtime.getKnownUniverse(character, { token: "forged.token" }), status(400));
  assert.equal(saved.size, 0);
  assert.equal(notices, 0);
});

test("unwritable state directory is reported as unavailable", t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "exploration-file-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const file = path.join(directory, "file");
  fs.writeFileSync(file, "not a directory");
  assert.throws(() => createFileKnowledgeStore(file).write("10-20", { revision: 1, visited: [2] }), status(503));
});

test("default provider is lazy and requires explicit world configuration", () => {
  const original = process.env.EVEJS_EXPLORATION_WORLD_PATH;
  delete process.env.EVEJS_EXPLORATION_WORLD_PATH;
  try { assert.throws(() => getExplorationRuntime(), status(503)); }
  finally {
    if (original === undefined) delete process.env.EVEJS_EXPLORATION_WORLD_PATH;
    else process.env.EVEJS_EXPLORATION_WORLD_PATH = original;
  }
});
