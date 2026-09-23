import assert from "node:assert/strict";
import test from "node:test";

const { ROLE_GML } = require("../src/services/account/accountRoleProfiles");
const itemTypeRegistry = require("../src/services/inventory/itemTypeRegistry");
itemTypeRegistry._setEntriesForTests([{
  typeID: 72_207,
  groupID: 759,
  categoryID: 11,
  name: "Osa Frigate",
}]);
for (const [catalogPath, exportName] of [
  ["../src/space/npc/capitals/capitalNpcCatalog", "getCapitalNpcGeneratedRows"],
  ["../src/space/npc/trigDrifter/trigDrifterNpcCatalog", "getTrigDrifterGeneratedRows"],
  ["../src/space/npc/empireSecurity/empireSecurityNpcCatalog", "getEmpireSecurityGeneratedRows"],
]) {
  require(catalogPath)[exportName] = () => [];
}
const { executeChatCommand } = require("../src/services/chat/chatCommands");
const { resolveItemByTypeID } = itemTypeRegistry;
const nativeNpcService = require("../src/space/npc/nativeNpcService");
const npcAnchors = require("../src/space/npc/npcAnchors");
const npcData = require("../src/space/npc/npcData");
const npcService = require("../src/space/npc/npcService");
const npcIndex = require("../src/space/npc");
const spaceRuntime = require("../src/space/runtime");

function distance(left, right) {
  return Math.hypot(
    left.x - right.x,
    left.y - right.y,
    left.z - right.z,
  );
}

test("typeID 72207 resolves the Frigate profile while the Surveyor profile remains available", () => {
  const profiles = npcData.listNpcProfiles();
  const itemType = resolveItemByTypeID(72_207);
  assert.equal(itemType.name, "Osa Frigate");
  assert.ok(profiles.some((profile) => profile.profileID === "frontier_osa_surveyor"));

  const profile = npcService._testing.resolveNpcTypeProfile(72_207, profiles, itemType.name);
  assert.equal(profile.profileID, "frontier_osa_frigate");
  assert.equal(profile.shipTypeID, 72_207);

  const renamedProfiles = [
    { profileID: "future_surveyor", entityType: "npc", shipTypeID: 72_207, name: "Osa Surveyor" },
    { profileID: "future_frigate", entityType: "npc", shipTypeID: 72_207, name: "Renamed Frigate" },
  ];
  assert.equal(
    npcService._testing.resolveNpcTypeProfile(72_207, renamedProfiles, "Renamed Frigate").profileID,
    "future_frigate",
  );
  assert.equal(npcService._testing.resolveNpcTypeProfile(72_208, renamedProfiles, "Renamed Frigate"), null);
});

test("typeID batch uses the durable native NPC workflow for every requested hull", (t) => {
  const anchor = { itemID: 9001, kind: "ship", itemName: "Test ship", position: { x: 10, y: 20, z: 30 } };
  const session = { _space: { systemID: 30_000_004, shipID: anchor.itemID } };
  const scene = { getCurrentSimTimeMs: () => 1_000 };
  t.mock.method(spaceRuntime, "getEntity", () => anchor);
  t.mock.method(spaceRuntime, "ensureScene", () => scene);
  let observed = null;
  t.mock.method(nativeNpcService, "spawnNativeDefinitionsInContext", (context, selection, options) => {
    observed = { context, selection, options };
    return { success: true, data: { spawned: [] } };
  });

  const result = npcService.spawnNpcTypeBatchForSession(session, 72_207, 3);
  assert.equal(result.success, true, result.errorMsg);
  assert.equal(observed.context.anchorEntity, anchor);
  assert.equal(observed.selection.data.definitions.length, 3);
  assert.ok(observed.selection.data.definitions.every((definition) => (
    definition.profile.profileID === "frontier_osa_frigate" &&
    definition.profile.shipTypeID === 72_207
  )));
  assert.equal(observed.options.transient, false);
  assert.equal(observed.options.formationStyle, "fibonacci");
  assert.equal(observed.options.preferredTargetID, anchor.itemID);
  assert.equal(observed.options.spawnDistanceMeters, 25_000);
});

test("typeID batch positions remain separated at three and fifty NPCs", () => {
  const anchor = { position: { x: 100, y: 200, z: 300 }, direction: { x: 1, y: 0, z: 0 } };
  for (const count of [3, 50]) {
    const positions = Array.from({ length: count }, (_, index) => npcAnchors.buildSpawnStateForDefinition(
      anchor,
      { profile: { spawnDistanceMeters: 20_000 } },
      {
        batchIndex: index + 1,
        batchTotal: count,
        spawnDistanceMeters: 25_000,
        spreadMeters: 0,
        formationSpacingMeters: 0,
        formationStyle: "fibonacci",
      },
    ).position);
    for (let index = 0; index < positions.length; index += 1) {
      assert.ok(Math.abs(distance(positions[index], anchor.position) - 25_000) < 0.001);
      for (let other = index + 1; other < positions.length; other += 1) {
        assert.ok(distance(positions[index], positions[other]) > 5_000);
      }
    }
  }
});

test("/spawn parses typeID and count, limits access, and rejects invalid quantities", (t) => {
  const session = { accountRole: ROLE_GML, _space: { systemID: 30_000_004, shipID: 9001 } };
  const calls = [];
  t.mock.method(npcIndex, "spawnNpcTypeBatchForSession", (_session, typeID, count) => {
    calls.push({ typeID, count });
    return { success: true, data: { spawned: Array.from({ length: count }, () => ({
      definition: { profile: { name: "Osa Frigate" } },
      fittedModules: [],
      lootEntries: [],
    })) } };
  });

  const spawn = (accountSession, message) => executeChatCommand(
    accountSession, message, null, { emitChatFeedback: false },
  );
  assert.match(spawn(session, "/spawn 72207 3").message, /Spawned 3 hulls.*3x Osa Frigate/u);
  assert.match(spawn(session, "/spawn 72207").message, /Spawned 1 hull/u);
  assert.deepEqual(calls, [{ typeID: 72_207, count: 3 }, { typeID: 72_207, count: 1 }]);
  assert.match(spawn({ ...session, accountRole: 0n }, "/spawn 72207 3").message, /requires a GM account/u);
  assert.match(spawn(session, "/spawn 72207 0").message, /count from 1 to 50/u);
  assert.match(spawn(session, "/spawn 72207 51").message, /count from 1 to 50/u);
  assert.match(spawn(session, "/spawn invalid 3").message, /Usage: \/spawn/u);
  assert.equal(calls.length, 2);
});
