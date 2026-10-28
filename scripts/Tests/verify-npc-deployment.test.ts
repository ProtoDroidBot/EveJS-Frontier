import assert from "node:assert/strict";
import { test } from "node:test";
import { bcs } from "@mysten/sui/bcs";
import { validateNpcDeploymentSimulation } from "./verify-npc-deployment";
import { prepareSuiNpcCharacterIdentity } from "../../server/src/services/frontier/suiNpcCharacterProvisioning";
import { deriveSuiNpcProfileObjectId } from "../../server/src/services/frontier/suiNpcProfile";
import { readSuiNpcWorldConfig } from "../../server/src/services/frontier/suiNpcWorldConfig";

const identity = prepareSuiNpcCharacterIdentity({ gameCharacterId: 1599999999, characterName: "Simulation Fixture", factionKey: "0-deployment-smoke" }, { env: {} });
const npcWorld = readSuiNpcWorldConfig({ ...identity, chainId: "a1b2c3d4" }, {
  EVEJS_SUI_NPC_PACKAGE_ID: `0x${"7".repeat(64)}`, EVEJS_SUI_NPC_TYPE_ORIGIN: `0x${"8".repeat(64)}`,
});
const npcProfileId = deriveSuiNpcProfileObjectId(identity.objectRegistryId, identity.characterObjectId, npcWorld.npcTypeOrigin);
const playerProfileId = `0x${"9".repeat(64)}`;
const CharacterEvent = bcs.struct("CharacterCreatedEvent", {
  character_id: bcs.Address, key: bcs.struct("TenantItemId", { item_id: bcs.u64(), tenant: bcs.string() }),
  tribe_id: bcs.u32(), character_address: bcs.Address,
});
const NpcEvent = bcs.struct("NpcProfileRegistered", {
  profile_id: bcs.Address, character_id: bcs.Address, registry_id: bcs.Address, npc_id: bcs.u32(),
  tenant: bcs.string(), faction_key: bcs.string(), wallet_address: bcs.Address, revision: bcs.u64(),
  incarnation: bcs.u64(), active_entity_id: bcs.u64(), deaths: bcs.u64(),
});

function fixture(): any {
  return { $kind: "Transaction", Transaction: {
    status: { success: true },
    objectTypes: {
      [identity.characterObjectId]: `${identity.packageId}::character::Character`,
      [npcProfileId]: `${npcWorld.npcTypeOrigin}::npc::NpcProfile`,
      [playerProfileId]: `${identity.packageId}::character::PlayerProfile`,
    },
    effects: { changedObjects: [
      { objectId: identity.characterObjectId, idOperation: "Created", outputOwner: { $kind: "Shared" } },
      { objectId: npcProfileId, idOperation: "Created", outputOwner: { $kind: "Shared" } },
      { objectId: playerProfileId, idOperation: "Created", outputOwner: { $kind: "AddressOwner", AddressOwner: identity.walletAddress } },
    ] },
    events: [
      { eventType: `${identity.packageId}::character::CharacterCreatedEvent`, bcs: CharacterEvent.serialize({
        character_id: identity.characterObjectId, key: { item_id: String(identity.gameCharacterId), tenant: identity.tenant },
        tribe_id: identity.tribeId, character_address: identity.walletAddress,
      }).toBytes() },
      { eventType: `${npcWorld.npcTypeOrigin}::npc::NpcProfileRegistered`, bcs: NpcEvent.serialize({
        profile_id: npcProfileId, character_id: identity.characterObjectId, registry_id: identity.objectRegistryId,
        npc_id: identity.gameCharacterId, tenant: identity.tenant, faction_key: identity.factionKey,
        wallet_address: identity.walletAddress, revision: "1", incarnation: "1", active_entity_id: "0", deaths: "0",
      }).toBytes() },
    ],
  } };
}

test("NPC deployment smoke validator proves base and upgraded type origins plus BCS identity links", () => {
  const output = validateNpcDeploymentSimulation(fixture(), identity, npcWorld);
  assert.equal(output.characterObjectId, identity.characterObjectId);
  assert.equal(output.npcProfileObjectId, npcProfileId);
  assert.equal(output.playerProfileObjectId, playerProfileId);
  assert.equal(output.npcProfileEventVerified, true);
});

test("NPC deployment smoke validator rejects wrong type origins and ownership", () => {
  for (const mutate of [
    (response: any) => { response.Transaction.objectTypes[identity.characterObjectId] = `${npcWorld.npcPackageId}::character::Character`; },
    (response: any) => { response.Transaction.objectTypes[npcProfileId] = `${identity.packageId}::npc::NpcProfile`; },
    (response: any) => { response.Transaction.effects.changedObjects[2].outputOwner.AddressOwner = "0x1"; },
  ]) {
    const response = fixture();
    mutate(response);
    assert.throws(() => validateNpcDeploymentSimulation(response, identity, npcWorld));
  }
});

test("NPC deployment smoke validator rejects missing or unrelated lifecycle events", () => {
  const missing = fixture();
  missing.Transaction.events.pop();
  assert.throws(() => validateNpcDeploymentSimulation(missing, identity, npcWorld), /NpcProfileRegistered/);
  const mismatched = fixture();
  const parsed = NpcEvent.parse(mismatched.Transaction.events[1].bcs);
  mismatched.Transaction.events[1].bcs = NpcEvent.serialize({ ...parsed, character_id: "0x1" }).toBytes();
  assert.throws(() => validateNpcDeploymentSimulation(mismatched, identity, npcWorld));
});

test("NPC deployment smoke validator reports failed simulation without accepting effects", () => {
  assert.throws(() => validateNpcDeploymentSimulation({
    $kind: "FailedTransaction", FailedTransaction: { status: { success: false, error: { message: "MoveAbort" } } },
  } as any, identity, npcWorld), /simulation failed: MoveAbort/);
});
