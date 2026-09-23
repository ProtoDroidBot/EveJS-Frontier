import assert from "node:assert/strict";
import test from "node:test";

const { buildSlimItemDict } = require("../src/space/destiny");
const { normalizeCrDataDictionaryForProfile } = require("../src/space/destiny/stream/statePayloadCompatibility");
const { getNpcPilotIdentityStore } = require("../src/space/npc/npcPilotIdentityStore");
const ConfigService = require("../src/services/config/configService");
const CharMgrService = require("../src/services/character/charMgrService");
const nativeNpcStore = require("../src/space/npc/nativeNpcStore");
const { unwrapMarshalValue } = require("../src/services/_shared/serviceHelpers");

const NPC_PILOT_ID = 1500004201;
const NPC_ENTITY_ID = 980000004201;

function clientFields(entity: Record<string, any>) {
  const normalized = normalizeCrDataDictionaryForProfile(
    buildSlimItemDict(entity), entity, "frontier",
  );
  return Object.fromEntries(normalized.entries);
}

test("ship presentation carries the NPC pilot without changing runtime ownership", () => {
  const npc = {
    itemID: NPC_ENTITY_ID,
    kind: "ship",
    nativeNpc: true,
    typeID: 587,
    slimTypeID: 587,
    groupID: 25,
    slimGroupID: 25,
    categoryID: 6,
    slimCategoryID: 6,
    ownerID: 1000001,
    corporationID: 1000001,
    characterID: 0,
    pilotCharacterID: 0,
    npcCharacterID: NPC_PILOT_ID,
  };
  const shipFields = clientFields(npc);
  assert.equal(shipFields.charID, NPC_PILOT_ID);
  assert.equal(shipFields.ownerID, npc.ownerID);
  assert.equal(shipFields.corpID, npc.corporationID);
  assert.equal(npc.characterID, 0);
  assert.equal(npc.pilotCharacterID, 0);

  const legacyFields = clientFields({
    ...npc, typeID: 72207, slimTypeID: 72207,
    categoryID: 11, slimCategoryID: 11,
  });
  assert.equal(legacyFields.charID, undefined);
  assert.equal(clientFields({ ...npc, nativeNpc: false, characterID: 1400004201 }).charID, 1400004201);
  assert.equal(clientFields({
    itemID: 5000000000001, kind: "asteroid", typeID: 78429,
    categoryID: 25, slimCategoryID: 25, ownerID: 1,
  }).charID, undefined);
});

test("owner priming resolves durable NPC pilots without player character rows", t => {
  const pilots = getNpcPilotIdentityStore();
  t.mock.method(nativeNpcStore, "getNativeEntity", id => id === NPC_ENTITY_ID ? {
    entityID: NPC_ENTITY_ID,
    npcCharacterID: NPC_PILOT_ID,
    corporationID: 100004201,
    allianceID: 990004201,
  } : null);
  t.mock.method(pilots, "get", id => id === NPC_PILOT_ID ? {
    characterID: NPC_PILOT_ID,
    characterName: "Osa Pilot",
    activeEntityID: NPC_ENTITY_ID,
    factionID: 500004,
    systemID: 30000004,
    createdAtMs: 1720000000000,
    sui: { walletAddress: "not sent to the client" },
  } : null);
  const result = new ConfigService().Handle_GetMultiOwnersEx([[NPC_PILOT_ID]], {});
  assert.deepEqual(result[0], ["ownerID", "ownerName", "typeID", "gender", "ownerNameID"]);
  assert.deepEqual(result[1], [[NPC_PILOT_ID, "Osa Pilot", 1373, 0, null]]);
  const profile = unwrapMarshalValue(new CharMgrService().Handle_GetPublicInfo3(
    [NPC_PILOT_ID], { characterName: "Viewing Player", corporationID: 42 },
  ))[0];
  assert.equal(profile.characterID, NPC_PILOT_ID);
  assert.equal(profile.characterName, "Osa Pilot");
  assert.equal(profile.corporationID, 100004201);
  assert.equal(profile.allianceID, 990004201);
  assert.equal(profile.factionID, 500004);
  assert.equal(profile.sui, undefined);
  const playerProfile = unwrapMarshalValue(new CharMgrService().Handle_GetPublicInfo3(
    [1400004201], { characterName: "Viewing Player", corporationID: 42 },
  ))[0];
  assert.equal(playerProfile.characterName, "Viewing Player");
  assert.equal(playerProfile.corporationID, 42);
});
