import assert = require("node:assert/strict");
import test = require("node:test");

const database = require("../src/gameStore");
const store = require("../src/services/frontier/smartAssemblyConstructionTemplateStore");
const runtime = require("../src/services/frontier/smartAssemblyConstructionTemplateRuntime");
const deployment = require("../src/services/frontier/deploymentRuntime");
const SmartAssemblyService = require("../src/services/frontier/smartAssemblyService");
const { unwrapMarshalValue } = require("../src/services/_shared/serviceHelpers");

const TABLES = [
  store.CONSTRUCTION_TEMPLATES_TABLE,
  store.CONSTRUCTION_PLANS_TABLE,
];
const PLAYER = { kind: "player", id: "140000099" };
const FACTION = { kind: "faction", id: "500001-serpentis" };

function isolatedTables(t) {
  const backup = Object.fromEntries(TABLES.map((table) => [
    table,
    structuredClone(database.read(table, "/").data),
  ]));
  for (const table of TABLES) {
    database.write(table, "/", { _meta: { version: 1 }, owners: {}, principals: {} }, {
      force: true,
    });
  }
  database.flushTablesSync(TABLES);
  t.after(() => {
    for (const [table, value] of Object.entries(backup)) {
      database.write(table, "/", value, { force: true });
    }
    database.flushTablesSync(TABLES);
  });
}

function templatePayload(name = "Forward refuge") {
  return {
    kind: "construction-template",
    name,
    description: "A durable mixed-placement layout",
    compositionHash: "a".repeat(64),
    executionOrder: ["anchor", "turret"],
    nodes: [
      {
        nodeID: "anchor",
        assemblyTypeID: 88092,
        relativePosition: { x: 0, y: 0, z: 0 },
        rotation: { yaw: 0, pitch: 0, roll: 0 },
        placementMode: "constructionSite",
        dependsOn: [],
        loadout: { initialInventory: [], initialFuel: [], desiredStatus: "offline" },
      },
      {
        nodeID: "turret",
        assemblyTypeID: 87162,
        relativePosition: { x: 5_000, y: 0, z: 0 },
        rotation: { yaw: 0, pitch: 0, roll: 0 },
        placementMode: "constructionSite",
        dependsOn: ["anchor"],
        loadout: { initialInventory: [], initialFuel: [], desiredStatus: "online" },
      },
    ],
  };
}

test("Construction Templates are owner-isolated and use no separate blueprint record", (t) => {
  isolatedTables(t);
  const player = store.createConstructionTemplate(PLAYER, templatePayload(), {
    templateID: "player-template",
    nowMs: 1_000,
  });
  assert.equal(player.success, true, player.errorMsg);
  const faction = store.createConstructionTemplate(FACTION, templatePayload("Faction refuge"), {
    templateID: "faction-template",
    nowMs: 2_000,
  });
  assert.equal(faction.success, true, faction.errorMsg);

  assert.equal(store.listConstructionTemplates(PLAYER).length, 1);
  assert.equal(store.listConstructionTemplates(FACTION).length, 1);
  assert.equal(store.getConstructionTemplate(PLAYER, "faction-template"), null);
  assert.equal(store.getConstructionTemplate(FACTION, "player-template"), null);
  assert.equal(player.data.kind, "construction-template");
  assert.equal(Object.prototype.hasOwnProperty.call(player.data, "blueprint"), false);

  const playerRows = database.read(
    store.CONSTRUCTION_TEMPLATES_TABLE,
    `/owners/${PLAYER.id}`,
  );
  assert.equal(playerRows.success, true);
  assert.ok(playerRows.data.templates["player-template"]);
  const principalRows = database.read(store.CONSTRUCTION_TEMPLATES_TABLE, "/principals");
  assert.equal(principalRows.success, true);
  assert.equal(Object.keys(principalRows.data).length, 1);
});

test("Construction Template geometry preserves dependencies and transforms the whole layout", (t) => {
  isolatedTables(t);
  const created = store.createConstructionTemplate(PLAYER, templatePayload(), {
    templateID: "geometry-template",
  });
  assert.equal(created.success, true, created.errorMsg);
  const compiled = runtime.compileConstructionTemplateGeometry(
    PLAYER,
    created.data.templateID,
    {
      position: { x: 100, y: 200, z: 300 },
      rotation: { yaw: Math.PI / 2, pitch: 0, roll: 0 },
    },
  );
  assert.equal(compiled.success, true, JSON.stringify(compiled.diagnostics));
  assert.deepEqual(compiled.data.executionOrder, ["anchor", "turret"]);
  assert.deepEqual(compiled.data.nodes[0].position, { x: 100, y: 200, z: 300 });
  assert.ok(Math.abs(compiled.data.nodes[1].position.x - 100) < 1.0e-8);
  assert.ok(Math.abs(compiled.data.nodes[1].position.y - 5_200) < 1.0e-8);
  assert.deepEqual(compiled.data.nodes[1].dependsOn, ["anchor"]);
  assert.equal(compiled.data.nodes[1].loadout.desiredStatus, "online");
});

test("Construction Template plans persist queued site-capacity state across reads", (t) => {
  isolatedTables(t);
  const created = store.createConstructionPlan(PLAYER, {
    templateID: "capacity-template",
    templateRevision: 1,
    compositionHash: "b".repeat(64),
    status: "queued-site-capacity",
    executionOrder: ["one", "two"],
    compiledNodes: [],
    nodeStates: {
      one: { nodeID: "one", status: "completed", itemID: 9001 },
      two: { nodeID: "two", status: "queued-site-capacity", itemID: 0 },
    },
  }, { planID: "capacity-plan", nowMs: 3_000 });
  assert.equal(created.success, true, created.errorMsg);
  database.flushTablesSync(TABLES);

  const restored = store.getConstructionPlan(PLAYER, "capacity-plan");
  assert.equal(restored.status, "queued-site-capacity");
  assert.equal(restored.nodeStates.one.itemID, 9001);
  assert.equal(restored.nodeStates.two.status, "queued-site-capacity");
  assert.equal(runtime._testing.derivePlanStatus(restored), "queued-site-capacity");
});

test("Smart Assembly protocol exposes Construction Template terminology and actor parity", () => {
  const service = new SmartAssemblyService();
  const protocol = unwrapMarshalValue(service.Handle_get_construction_template_protocol());
  assert.equal(protocol.artifact_name, "Construction Template");
  assert.equal(protocol.blueprint_term_reserved_for_manufacturing, true);
  assert.equal(protocol.supports_player_execution, true);
  assert.equal(protocol.supports_npc_execution, true);
  assert.equal(protocol.direct_assembly_policy, "network-node-and-portable");
  assert.equal(protocol.network_node_policy, "direct-assembly");
  assert.equal(protocol.portable_network_node_policy, "direct-assembly");
  assert.equal(protocol.smart_assembly_policy, "construction-site");
  assert.deepEqual(protocol.placement_modes, ["auto", "directAssembly", "constructionSite"]);
});

test("directAssembly accepts Network Nodes and rejects non-exempt Smart Assemblies", (t) => {
  t.mock.method(deployment, "listAssemblyDefinitions", () => [
    { assemblyTypeID: 88092, constructionSiteTypeID: 0 },
    { assemblyTypeID: 88082, constructionSiteTypeID: 91715 },
  ]);
  const directNode = runtime.normalizeConstructionTemplate({
    name: "Direct node",
    nodes: [{
      nodeID: "network-node",
      assemblyTypeID: 88092,
      position: { x: 0, y: 0, z: 0 },
      rotation: { yaw: 0, pitch: 0, roll: 0 },
      placementMode: "directAssembly",
      loadout: {},
    }],
  });
  assert.equal(directNode.success, true, JSON.stringify(directNode.diagnostics));

  const normalized = runtime.normalizeConstructionTemplate({
    name: "Invalid direct assembly",
    nodes: [{
      nodeID: "storage-unit",
      assemblyTypeID: 88082,
      position: { x: 0, y: 0, z: 0 },
      rotation: { yaw: 0, pitch: 0, roll: 0 },
      placementMode: "directAssembly",
      loadout: {},
    }],
  });
  assert.equal(normalized.success, false);
  assert.ok(normalized.diagnostics.some((entry) =>
    entry.code === "DIRECT_ASSEMBLY_PORTABLE_ONLY"));
});

test("Construction Template loadouts author bounded Smart Industry lanes", (t) => {
  t.mock.method(deployment, "listAssemblyDefinitions", () => [{
    assemblyTypeID: 87119,
    constructionSiteTypeID: 91715,
  }]);
  const normalized = runtime.normalizeConstructionTemplate({
    name: "Industrial lane pair",
    nodes: [{
      nodeID: "industry",
      assemblyTypeID: 87119,
      position: { x: 0, y: 0, z: 0 },
      rotation: { yaw: 0, pitch: 0, roll: 0 },
      placementMode: "constructionSite",
      loadout: {
        desiredStatus: "online",
        industryLanes: [
          { laneID: 2, blueprintID: 1026, runs: 3 },
          { laneID: 1, blueprintID: 1026, runs: 2 },
        ],
        collectIndustryOutputs: true,
      },
    }],
  });
  assert.equal(normalized.success, true, JSON.stringify(normalized.diagnostics));
  assert.deepEqual(normalized.data.nodes[0].loadout.industryLanes, [
    { laneID: 1, blueprintID: 1026, runs: 2 },
    { laneID: 2, blueprintID: 1026, runs: 3 },
  ]);

  const invalid = runtime.normalizeConstructionTemplate({
    name: "Mixed facility recipe",
    nodes: [{
      nodeID: "industry",
      assemblyTypeID: 87119,
      position: { x: 0, y: 0, z: 0 },
      placementMode: "constructionSite",
      loadout: { industryLanes: [
        { laneID: 1, blueprintID: 1026, runs: 1 },
        { laneID: 2, blueprintID: 1027, runs: 1 },
      ] },
    }],
  });
  assert.equal(invalid.success, false);
  assert.ok(invalid.diagnostics.some((entry) =>
    entry.code === "CONSTRUCTION_TEMPLATE_LOADOUT_INVALID"));
});
