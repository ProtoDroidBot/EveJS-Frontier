import assert from "node:assert/strict";
import path from "node:path";
import { bcs } from "@mysten/sui/bcs";
import type { GrpcSimulateTransactionResult } from "@mysten/sui/grpc";
import { normalizeSuiAddress } from "@mysten/sui/utils";

import { NPC_CHARACTER_ID_MIN, NPC_CHARACTER_ID_MAX } from "../../server/src/services/_shared/npcIdentityConstants";
import {
  isObjectNotFoundError, readLiveSuiChainIdentifier, readSyncedSuiWorldConfig,
  resolveAdminSigner, type SuiWorldSyncConfig,
} from "../../server/src/services/frontier/suiCharacterProvisioning";
import {
  createSuiNpcCharacterTransaction, prepareSuiNpcCharacterIdentity, type SuiNpcCharacterIdentity,
} from "../../server/src/services/frontier/suiNpcCharacterProvisioning";
import { deriveSuiNpcProfileObjectId } from "../../server/src/services/frontier/suiNpcProfile";
import { assertSuiNpcWorldConfigCurrent, readSuiNpcWorldConfig, type SuiNpcWorldConfig } from "../../server/src/services/frontier/suiNpcWorldConfig";
import { SUI_GRPC_BASE_URL, suiGrpcClient } from "../../server/src/services/frontier/suiGrpcClient";

const INCLUDE = { effects: true, objectTypes: true, events: true } as const;
const LIFECYCLE = { incarnation: 1, activeEntityID: 0, deaths: 0 };
const CharacterCreatedEvent = bcs.struct("CharacterCreatedEvent", {
  character_id: bcs.Address,
  key: bcs.struct("TenantItemId", { item_id: bcs.u64(), tenant: bcs.string() }),
  tribe_id: bcs.u32(),
  character_address: bcs.Address,
});
const NpcProfileRegistered = bcs.struct("NpcProfileRegistered", {
  profile_id: bcs.Address,
  character_id: bcs.Address,
  registry_id: bcs.Address,
  npc_id: bcs.u32(),
  tenant: bcs.string(),
  faction_key: bcs.string(),
  wallet_address: bcs.Address,
  revision: bcs.u64(),
  incarnation: bcs.u64(),
  active_entity_id: bcs.u64(),
  deaths: bcs.u64(),
});

function address(value: unknown) {
  assert.ok(typeof value === "string" && /^0x[0-9a-fA-F]{1,64}$/.test(value), "Expected a Sui address");
  return normalizeSuiAddress(value);
}

/** Pure validation is exported so tests never need a wallet or live node. */
export function validateNpcDeploymentSimulation(
  result: GrpcSimulateTransactionResult<typeof INCLUDE>,
  identity: SuiNpcCharacterIdentity,
  npcWorld: SuiNpcWorldConfig,
) {
  if (result.$kind !== "Transaction" || result.Transaction.status.success !== true) {
    const error = result.$kind === "FailedTransaction" ? result.FailedTransaction.status.error : null;
    throw new Error(`NPC deployment simulation failed: ${error?.message || "no successful execution status"}`);
  }
  const transaction = result.Transaction;
  const expectedProfileId = deriveSuiNpcProfileObjectId(identity.objectRegistryId, identity.characterObjectId, npcWorld.npcTypeOrigin);
  const changed = transaction.effects?.changedObjects || [];
  const types = transaction.objectTypes || {};
  const created = (objectId: string, type: string) => changed.find(change =>
    address(change.objectId) === objectId && change.idOperation === "Created" && types[change.objectId] === type);
  const characterType = `${identity.packageId}::character::Character`;
  const npcProfileType = `${npcWorld.npcTypeOrigin}::npc::NpcProfile`;
  const playerProfileType = `${identity.packageId}::character::PlayerProfile`;
  assert.equal(created(identity.characterObjectId, characterType)?.outputOwner?.$kind, "Shared", "Simulation must create the original-world Character as shared");
  assert.equal(created(expectedProfileId, npcProfileType)?.outputOwner?.$kind, "Shared", "Simulation must create the NPC-origin profile as shared");
  const playerProfile = changed.find(change => change.idOperation === "Created" && types[change.objectId] === playerProfileType &&
    change.outputOwner?.$kind === "AddressOwner" && address(change.outputOwner.AddressOwner) === identity.walletAddress);
  assert.ok(playerProfile, "Simulation must create a compatibility PlayerProfile owned by the faction wallet");

  const characterEvent = (transaction.events || []).find(event => event.eventType === `${identity.packageId}::character::CharacterCreatedEvent`);
  const npcEvent = (transaction.events || []).find(event => event.eventType === `${npcWorld.npcTypeOrigin}::npc::NpcProfileRegistered`);
  assert.ok(characterEvent?.bcs?.length, "Simulation must emit the original-world CharacterCreatedEvent");
  assert.ok(npcEvent?.bcs?.length, "Simulation must emit the NPC-origin NpcProfileRegistered event");
  const character = CharacterCreatedEvent.parse(characterEvent.bcs);
  const npc = NpcProfileRegistered.parse(npcEvent.bcs);
  assert.equal(address(character.character_id), identity.characterObjectId);
  assert.equal(character.key.item_id, String(identity.gameCharacterId));
  assert.equal(character.key.tenant, identity.tenant);
  assert.equal(character.tribe_id, identity.tribeId);
  assert.equal(address(character.character_address), identity.walletAddress);
  assert.equal(address(npc.profile_id), expectedProfileId);
  assert.equal(address(npc.character_id), identity.characterObjectId);
  assert.equal(address(npc.registry_id), identity.objectRegistryId);
  assert.equal(npc.npc_id, identity.gameCharacterId);
  assert.equal(npc.tenant, identity.tenant);
  assert.equal(npc.faction_key, identity.factionKey);
  assert.equal(address(npc.wallet_address), identity.walletAddress);
  assert.equal(npc.revision, "1");
  assert.equal(npc.incarnation, "1");
  assert.equal(npc.active_entity_id, "0");
  assert.equal(npc.deaths, "0");
  return {
    characterObjectId: identity.characterObjectId,
    npcProfileObjectId: expectedProfileId,
    playerProfileObjectId: playerProfile.objectId,
    characterType, npcProfileType, playerProfileType,
    characterEventVerified: true, npcProfileEventVerified: true,
  };
}

type Options = { build?: string; worldConfigPath?: string; npcId?: number; sender?: string };

function synchronizedIdentity(config: SuiWorldSyncConfig) {
  return JSON.stringify([config.build, config.chainId, config.packageId, config.objectRegistryId, config.adminAclId]);
}

export async function verifyNpcDeployment(options: Options = {}, sourceEnv: NodeJS.ProcessEnv = process.env) {
  const build = options.build || sourceEnv.EVEJS_CLIENT_BUILD || "3502403";
  assert.match(build, /^[0-9]+$/, "Build must be numeric");
  const env: NodeJS.ProcessEnv = {
    ...sourceEnv,
    EVEJS_CLIENT_BUILD: build,
    EVEJS_SUI_WORLD_CONFIG_PATH: options.worldConfigPath || sourceEnv.EVEJS_SUI_WORLD_CONFIG_PATH ||
      path.resolve(__dirname, "../../_local/frontier-world", build, "world.private.json"),
  };
  const synced = readSyncedSuiWorldConfig(env);
  assert.ok(synced, "A synchronized world config is required");
  const liveChainId = await readLiveSuiChainIdentifier(suiGrpcClient as any);
  assert.equal(liveChainId, synced.chainId.slice(0, 8).toLowerCase(), "Live Localnet differs from the synchronized deployment");
  const npcWorld = readSuiNpcWorldConfig(synced, env);
  // Derive only the public sender address. The signer is never used to sign.
  const sender = options.sender ? address(options.sender) : resolveAdminSigner({ env }).toSuiAddress();
  const world = { packageId: synced.packageId, objectRegistryId: synced.objectRegistryId, adminAclId: synced.adminAclId };
  async function absent(objectId: string) {
    try { await suiGrpcClient.getObject({ objectId, signal: AbortSignal.timeout(15_000) }); return false; }
    catch (error) { if (isObjectNotFoundError(error)) return true; throw error; }
  }
  async function assertCurrent() {
    const current = readSyncedSuiWorldConfig(env);
    assert.ok(current && synchronizedIdentity(current) === synchronizedIdentity(synced), "World deployment changed during smoke verification");
    assert.equal(await readLiveSuiChainIdentifier(suiGrpcClient as any), liveChainId, "Localnet changed during smoke verification");
    assertSuiNpcWorldConfigCurrent(npcWorld, current!, env);
  }
  let identity: SuiNpcCharacterIdentity | undefined;
  const attempts = options.npcId === undefined ? 64 : 1;
  for (let offset = 0; offset < attempts; offset++) {
    const gameCharacterId = options.npcId ?? NPC_CHARACTER_ID_MAX - offset;
    assert.ok(Number.isSafeInteger(gameCharacterId) && gameCharacterId >= NPC_CHARACTER_ID_MIN && gameCharacterId <= NPC_CHARACTER_ID_MAX, "Smoke NPC ID must be in the reserved NPC range");
    const candidate = prepareSuiNpcCharacterIdentity({ gameCharacterId, characterName: "NPC deployment smoke simulation", factionKey: "0-deployment-smoke" }, { world, env });
    const profileId = deriveSuiNpcProfileObjectId(candidate.objectRegistryId, candidate.characterObjectId, npcWorld.npcTypeOrigin);
    const available = await Promise.all([absent(candidate.characterObjectId), absent(profileId)]);
    if (available.every(Boolean)) { identity = candidate; break; }
  }
  assert.ok(identity, "No absent NPC identity found in the smoke candidate range; select an unused --npc-id");
  await assertCurrent();
  const transaction = createSuiNpcCharacterTransaction(identity, npcWorld, LIFECYCLE);
  transaction.setSender(sender);
  // This RPC evaluates effects without signatures or committing state. Never
  // replace it with signAndExecuteTransaction or executeTransaction.
  const simulated = await suiGrpcClient.simulateTransaction({
    transaction, checksEnabled: true, include: INCLUDE, signal: AbortSignal.timeout(45_000),
  });
  const verified = validateNpcDeploymentSimulation(simulated, identity, npcWorld);
  await assertCurrent();
  const stillAbsent = await Promise.all([
    absent(verified.characterObjectId), absent(verified.npcProfileObjectId), absent(verified.playerProfileObjectId),
  ]);
  assert.ok(stillAbsent.every(Boolean), "Simulated objects unexpectedly exist on Localnet; verification is inconclusive");
  return {
    mode: "simulation-only", checksEnabled: true, signed: false, submitted: false,
    build: synced.build, network: synced.network, endpoint: SUI_GRPC_BASE_URL, chainId: liveChainId,
    worldPackageId: synced.packageId, npcPackageId: npcWorld.npcPackageId, npcTypeOrigin: npcWorld.npcTypeOrigin,
    adminAddress: sender, npcCharacterID: identity.gameCharacterId, factionKey: identity.factionKey,
    factionWalletAddress: identity.walletAddress, ...verified, simulatedObjectsRemainAbsent: true,
  };
}

if (require.main === module) {
  const args = process.argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) {
    console.log("Usage: node scripts/Tests/verify-npc-deployment.js [--build 3502403] [--world-config PATH] [--npc-id ID] [--sender ADDRESS]\nRead-only Localnet simulation with transaction checks enabled; no signing or submission.");
  } else {
    const options: Options = {};
    try {
      for (let index = 0; index < args.length; index++) {
        const flag = args[index], value = args[++index];
        if (!value) throw new Error(`Missing value for ${flag}`);
        if (flag === "--build") options.build = value;
        else if (flag === "--world-config") options.worldConfigPath = path.resolve(value);
        else if (flag === "--npc-id") options.npcId = Number(value);
        else if (flag === "--sender") options.sender = value;
        else throw new Error(`Unknown option ${flag}`);
      }
      void verifyNpcDeployment(options).then(result => console.log(JSON.stringify(result, null, 2))).catch(error => {
        console.error(error instanceof Error ? error.message : "NPC deployment verification failed");
        process.exitCode = 1;
      });
    } catch (error) {
      console.error(error instanceof Error ? error.message : "Invalid smoke verification arguments");
      process.exitCode = 1;
    }
  }
}
