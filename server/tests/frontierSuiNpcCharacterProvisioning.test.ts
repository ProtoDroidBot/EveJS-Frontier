import assert = require("node:assert/strict");
import { test } from "node:test";

import { TransactionDataBuilder } from "@mysten/sui/transactions";

import {
  SuiCharacterProvisioningError,
  deriveLocalPlayerSuiWalletAddress,
} from "../src/services/frontier/suiCharacterProvisioning";
import {
  deriveLocalNpcFactionSuiWalletAddress,
  prepareSuiNpcCharacterIdentity,
  provisionSuiNpcCharacter,
  resolveLocalNpcFactionSuiSigner,
  type SuiNpcCharacterIdentity,
} from "../src/services/frontier/suiNpcCharacterProvisioning";
import { deriveSuiNpcProfileObjectId } from "../src/services/frontier/suiNpcProfile";
import { readSuiNpcWorldConfig } from "../src/services/frontier/suiNpcWorldConfig";

const options = { env: {} };
const chainId = "a1b2c3d4";
const npcInput = {
  gameCharacterId: 1500000001,
  characterName: "Osa Patrol Pilot",
  factionKey: "500025-osa",
};

function npcProfileObject(identity: SuiNpcCharacterIdentity, env: NodeJS.ProcessEnv = {}, lifecycle = {
  incarnation: "1", activeEntityID: "0", deaths: "0",
}) {
  const npcWorld = readSuiNpcWorldConfig({ ...identity, chainId }, env);
  return {
    objectId: deriveSuiNpcProfileObjectId(npcWorld.npcRegistryId, identity.characterObjectId, npcWorld.npcTypeOrigin),
    type: `${npcWorld.npcTypeOrigin}::npc::NpcProfile`,
    owner: { $kind: "Shared" },
    previousTransaction: "npc-profile-transaction",
    json: {
      character_id: identity.characterObjectId,
      registry_id: identity.objectRegistryId,
      admin_acl_id: identity.adminAclId,
      tenant: identity.tenant,
      npc_id: identity.gameCharacterId,
      faction_key: identity.factionKey,
      wallet_address: identity.walletAddress,
      revision: "1",
      incarnation: lifecycle.incarnation,
      active_entity_id: lifecycle.activeEntityID,
      deaths: lifecycle.deaths,
      retired: false,
    },
  };
}

function characterObject(identity: SuiNpcCharacterIdentity) {
  return {
    objectId: identity.characterObjectId,
    type: `${identity.packageId}::character::Character`,
    owner: { $kind: "Shared" },
    json: {
      character_address: identity.walletAddress,
      key: { item_id: String(identity.gameCharacterId), tenant: identity.tenant },
      tribe_id: identity.tribeId,
    },
  };
}

function playerProfileObject(identity: SuiNpcCharacterIdentity) {
  return {
    objectId: `0x${identity.gameCharacterId.toString(16).padStart(64, "0")}`,
    type: `${identity.packageId}::character::PlayerProfile`,
    owner: { $kind: "AddressOwner", AddressOwner: identity.walletAddress },
    json: { character_id: identity.characterObjectId },
    previousTransaction: "original-npc-player-profile",
  };
}

function successfulResult(identity: SuiNpcCharacterIdentity, digest: string) {
  const profileId = `0x${identity.gameCharacterId.toString(16).padStart(64, "0")}`;
  return {
    $kind: "Transaction",
    Transaction: {
      digest,
      status: { success: true },
      objectTypes: {
        [identity.characterObjectId]: `${identity.packageId}::character::Character`,
        [profileId]: `${identity.packageId}::character::PlayerProfile`,
      },
      effects: {
        changedObjects: [
          {
            objectId: identity.characterObjectId,
            idOperation: "Created",
            outputOwner: { $kind: "Shared", Shared: { initialSharedVersion: "1" } },
          },
          {
            objectId: profileId,
            idOperation: "Created",
            outputOwner: { $kind: "AddressOwner", AddressOwner: identity.walletAddress },
          },
        ],
      },
    },
  };
}

function missingClient() {
  return {
    async getChainIdentifier() { return { chainIdentifier: chainId }; },
    async getObject() { throw { reason: "notFound" }; },
    async getTransaction({ digest }: { digest: string }) {
      throw { reason: "notFound", digest };
    },
    async listOwnedObjects() { return { objects: [], hasNextPage: false, cursor: null }; },
    async signAndExecuteTransaction(): Promise<any> {
      throw new Error("Unexpected legacy submission");
    },
  };
}

test("NPCs in one faction share a deterministic wallet and have distinct Character identities", () => {
  const first = prepareSuiNpcCharacterIdentity(npcInput, options);
  const second = prepareSuiNpcCharacterIdentity({ ...npcInput, gameCharacterId: 1500000002 }, options);
  assert.equal(first.walletAddress, second.walletAddress);
  assert.notEqual(first.characterObjectId, second.characterObjectId);
  assert.deepEqual(prepareSuiNpcCharacterIdentity(npcInput, options), first);
  assert.equal("accountId" in first, false);
  assert.equal(first.factionKey, "500025-osa");
  assert.equal(first.walletAddress, resolveLocalNpcFactionSuiSigner("500025-osa", "DEV").toSuiAddress());
  assert.notEqual(first.walletAddress, deriveLocalPlayerSuiWalletAddress(500025));
});

test("NPC faction wallet key includes the numeric ID, string ID, and tenant", () => {
  const keys = ["500025-osa", "500026-osa", "500025-feral", "500025-none", "0-osa"];
  const addresses = keys.map((key) => deriveLocalNpcFactionSuiWalletAddress(key));
  assert.equal(new Set(addresses).size, keys.length);
  assert.equal(addresses[0], deriveLocalNpcFactionSuiWalletAddress(" 500025-OSA ", "DEV"));
  assert.notEqual(addresses[0], deriveLocalNpcFactionSuiWalletAddress(keys[0], "other"));
  assert.equal(
    deriveLocalNpcFactionSuiWalletAddress(`4294967295-${"a".repeat(96)}`).length,
    66,
    "The faction key is hashed locally, so its length does not enlarge the address",
  );
});

test("NPC identities enforce the reserved contract range and canonical faction key", () => {
  for (const gameCharacterId of [0, -1, 1.5, 1499999999, 1600000000, 0xffffffff, 0x100000000, 980000000000, NaN]) {
    assert.throws(
      () => prepareSuiNpcCharacterIdentity({ ...npcInput, gameCharacterId }, options),
      SuiCharacterProvisioningError,
    );
  }
  for (const gameCharacterId of [1500000000, 1599999999]) {
    assert.equal(prepareSuiNpcCharacterIdentity({ ...npcInput, gameCharacterId }, options).gameCharacterId, gameCharacterId);
  }
  for (const factionKey of ["osa", "-1-osa", "00500025-osa", "4294967296-osa", "500025-", "500025-osa:dev", `0-${"a".repeat(97)}`]) {
    assert.throws(
      () => prepareSuiNpcCharacterIdentity({ ...npcInput, factionKey }, options),
      (error: any) => error.code === "INVALID_NPC_FACTION",
    );
  }
});

test("NPC provisioning atomically creates compatible player and distinct custom NPC profiles per pilot", async () => {
  const identities = [1500000001, 1500000002].map((gameCharacterId) =>
    prepareSuiNpcCharacterIdentity({ ...npcInput, gameCharacterId }, options),
  );
  const results = [];
  for (const identity of identities) {
    const profile = npcProfileObject(identity);
    let created = false;
    const client = {
      ...missingClient(),
      async getObject({ objectId }: any) {
        if (created && objectId === profile.objectId) return { object: profile };
        if (created && objectId === identity.characterObjectId) return { object: characterObject(identity) };
        throw { reason: "notFound" };
      },
      async signAndExecuteTransaction({ transaction }: any) {
        const commands = transaction.getData().commands;
        assert.equal(commands[0].MoveCall.module, "npc");
        assert.equal(commands[0].MoveCall.function, "create_npc_character");
        assert.equal(commands[1].MoveCall.function, "share_character");
        created = true;
        return successfulResult(identity, `create-${identity.gameCharacterId}`);
      },
    };
    results.push(await provisionSuiNpcCharacter(
      { ...identity, identity },
      { ...options, client, adminSigner: {} },
    ));
  }
  assert.equal(results[0].walletAddress, results[1].walletAddress);
  assert.notEqual(results[0].playerProfileObjectId, results[1].playerProfileObjectId);
  assert.notEqual(results[0].npcProfileObjectId, results[1].npcProfileObjectId);
  assert.equal(results[0].npcProfileObjectId, npcProfileObject(identities[0]).objectId);
  assert.equal(results[0].chainId, chainId);
  assert.equal("accountId" in results[0], false);
});

test("NPC respawn recovery finds only the matching profile among the faction's pilots", async () => {
  const identity = prepareSuiNpcCharacterIdentity(npcInput, options);
  const other = prepareSuiNpcCharacterIdentity({ ...npcInput, gameCharacterId: 1500000002 }, options);
  let ownedPages = 0;
  const profile = playerProfileObject;
  const npcProfile = npcProfileObject(identity);
  const client = {
    ...missingClient(),
    async getObject({ objectId }: any) {
      if (objectId === identity.characterObjectId) return { object: characterObject(identity) };
      if (objectId === npcProfile.objectId) return { object: npcProfile };
      throw { reason: "notFound" };
    },
    async listOwnedObjects({ owner, cursor }: any) {
      assert.equal(owner, identity.walletAddress);
      ownedPages++;
      return cursor
        ? { objects: [profile(identity)], hasNextPage: false, cursor: null }
        : { objects: [profile(other)], hasNextPage: true, cursor: "next" };
    },
  };
  const result = await provisionSuiNpcCharacter({ ...npcInput, identity }, { ...options, client });
  assert.equal(result.playerProfileObjectId, profile(identity).objectId);
  assert.equal(result.recovered, true);
  assert.equal(result.npcProfileObjectId, npcProfile.objectId);
  assert.equal(result.chainId, chainId);
  assert.equal(ownedPages, 2);
});

test("NPC upgrade calls the latest implementation while preserving original Character and NPC type origins", async () => {
  const env = { EVEJS_SUI_NPC_PACKAGE_ID: "0x333", EVEJS_SUI_NPC_TYPE_ORIGIN: "0x222" };
  const identity = prepareSuiNpcCharacterIdentity(npcInput, { env });
  const npcWorld = readSuiNpcWorldConfig({ ...identity, chainId }, env);
  const lifecycle = { incarnation: "4", activeEntityID: "980000000123", deaths: "2" };
  const profile = npcProfileObject(identity, env, lifecycle);
  let submissions = 0;
  const callbacks: string[] = [];
  const client = {
    ...missingClient(),
    async getObject({ objectId }: any) {
      if (submissions && objectId === profile.objectId) return { object: profile };
      if (submissions && objectId === identity.characterObjectId) return { object: characterObject(identity) };
      throw { reason: "notFound" };
    },
    async signAndExecuteTransaction({ transaction }: any) {
      submissions++;
      const commands = transaction.getData().commands;
      assert.equal(commands.length, 2);
      assert.equal(commands[0].MoveCall.package, npcWorld.npcPackageId);
      assert.equal(commands[0].MoveCall.function, "create_npc_character");
      assert.equal(commands[1].MoveCall.package, identity.packageId);
      assert.equal(commands[1].MoveCall.function, "share_character");
      return successfulResult(identity, "custom-package-create");
    },
  };
  const result = await provisionSuiNpcCharacter({ ...npcInput, lifecycle }, {
    env, client, adminSigner: {},
    onCharacterProvisioned() { callbacks.push("character-confirmed"); },
    onNpcProfileTransactionPrepared() { callbacks.push("unexpected-profile-write"); },
  });
  assert.equal(result.packageId, prepareSuiNpcCharacterIdentity(npcInput, options).packageId);
  assert.equal(result.characterObjectId, prepareSuiNpcCharacterIdentity(npcInput, options).characterObjectId);
  assert.equal(result.npcProfileObjectId, profile.objectId);
  assert.notEqual(result.npcProfileObjectId,
    deriveSuiNpcProfileObjectId(npcWorld.npcRegistryId, identity.characterObjectId, npcWorld.npcPackageId));
  assert.deepEqual(callbacks, ["character-confirmed"]);
  assert.equal(submissions, 1);
});

test("legacy NPC profile registration journals its own phase after Character recovery", async () => {
  const identity = prepareSuiNpcCharacterIdentity(npcInput, options);
  const profile = npcProfileObject(identity);
  const transactionBytes = new Uint8Array([8, 6, 4, 2]);
  const order: string[] = [];
  let registered = false;
  let profileJournal: any;
  const client = {
    ...missingClient(),
    async getObject({ objectId }: any) {
      if (objectId === identity.characterObjectId) return { object: characterObject(identity) };
      if (registered && objectId === profile.objectId) return { object: profile };
      throw { reason: "notFound" };
    },
    async listOwnedObjects() { return { objects: [playerProfileObject(identity)], hasNextPage: false, cursor: null }; },
    async executeTransaction({ transaction, signatures }: any) {
      order.push("profile-submitted");
      assert.ok(profileJournal, "Profile journal must be saved before submission");
      assert.deepEqual(transaction, transactionBytes);
      assert.deepEqual(signatures, ["profile-signature"]);
      registered = true;
      return { $kind: "Transaction", Transaction: { digest: profileJournal.transactionDigest, status: { success: true } } };
    },
  };
  const result = await provisionSuiNpcCharacter(npcInput, {
    ...options, client,
    adminSigner: {
      toSuiAddress: () => "0x1",
      async signTransaction() { return { signature: "profile-signature" }; },
    },
    onTransactionPrepared() { assert.fail("Existing Character must not get a new creation journal"); },
    onCharacterProvisioned(character) {
      order.push("character-confirmed");
      assert.equal(character.recovered, true);
      assert.equal(character.playerProfileObjectId, playerProfileObject(identity).objectId);
    },
    npcProfileTransactionFactory(context) {
      assert.equal(context.operation, "register");
      assert.equal(context.identity.characterObjectId, identity.characterObjectId);
      return { setSenderIfNotSet() {}, async build() { return transactionBytes; } } as any;
    },
    onNpcProfileTransactionPrepared(journal) {
      order.push("profile-prepared");
      profileJournal = journal;
      assert.equal(journal.operation, "register");
      assert.equal(journal.characterObjectId, identity.characterObjectId);
    },
  });
  assert.deepEqual(order, ["character-confirmed", "profile-prepared", "profile-submitted"]);
  assert.equal(result.npcProfileObjectId, profile.objectId);
  assert.equal(result.transactionDigest, "original-npc-player-profile");
  assert.equal(result.npcProfile.transactionDigest, profileJournal.transactionDigest);
});

test("a plain Character is never reported as a confirmed NPC when its custom profile mismatches", async () => {
  const identity = prepareSuiNpcCharacterIdentity(npcInput, options);
  const profile = npcProfileObject(identity);
  profile.json.faction_key = "500025-feral";
  let characterConfirmed = false;
  const client = {
    ...missingClient(),
    async getObject({ objectId }: any) {
      if (objectId === identity.characterObjectId) return { object: characterObject(identity) };
      if (objectId === profile.objectId) return { object: profile };
      throw { reason: "notFound" };
    },
    async listOwnedObjects() { return { objects: [playerProfileObject(identity)], hasNextPage: false, cursor: null }; },
  };
  await assert.rejects(provisionSuiNpcCharacter(npcInput, {
    ...options, client,
    onCharacterProvisioned() { characterConfirmed = true; },
  }), (error: any) => error.code === "NPC_PROFILE_BINDING_MISMATCH" && error.npcProfileOperation === true);
  assert.equal(characterConfirmed, true, "Preserve the recovered Character phase for a later repair");
});

test("historical creation success and a surviving NPC profile cannot hide a deleted Character", async () => {
  const identity = prepareSuiNpcCharacterIdentity(npcInput, options);
  const profile = npcProfileObject(identity);
  const digest = "historical-character-creation";
  let characterTransactionRecovered = false;
  const client = {
    ...missingClient(),
    async getTransaction({ digest: requestedDigest }: any) {
      assert.equal(requestedDigest, digest);
      return successfulResult(identity, digest);
    },
    async getObject({ objectId }: any) {
      if (objectId === profile.objectId) return { object: profile };
      throw { reason: "notFound" };
    },
  };
  await assert.rejects(provisionSuiNpcCharacter({ ...npcInput, identity, transactionDigest: digest, chainId }, {
    ...options, client, reconciliationDelaysMs: [0],
    onCharacterProvisioned() { characterTransactionRecovered = true; },
  }), (error: any) => error.code === "NPC_CHARACTER_MISSING" && error.npcProfileOperation === true);
  assert.equal(characterTransactionRecovered, true);
});

test("NPC retry replays the exact persisted transaction and explicit identity after ambiguous submission", async () => {
  const identity = prepareSuiNpcCharacterIdentity(npcInput, options);
  const transactionBytes = new Uint8Array([1, 3, 5, 7]);
  const digest = TransactionDataBuilder.getDigestFromBytes(transactionBytes);
  let journal: any = null;
  let built = 0;
  let submissions = 0;
  const profile = npcProfileObject(identity);
  const client = {
    ...missingClient(),
    async getObject({ objectId }: any) {
      if (submissions === 2 && objectId === profile.objectId) return { object: profile };
      if (submissions === 2 && objectId === identity.characterObjectId) return { object: characterObject(identity) };
      throw { reason: "notFound" };
    },
    async executeTransaction({ transaction, signatures }: any) {
      submissions++;
      assert.ok(journal, "The prepared transaction must be durable before submission");
      assert.deepEqual(transaction, transactionBytes);
      assert.deepEqual(signatures, ["npc-test-signature"]);
      if (submissions === 1) throw new Error("Connection closed before response");
      return successfulResult(identity, digest);
    },
  };
  const provisionOptions = {
    ...options,
    client,
    reconciliationDelaysMs: [0],
    adminSigner: {
      toSuiAddress: () => "0x1",
      async signTransaction() { return { signature: "npc-test-signature" }; },
    },
    transactionFactory: () => ({
      setSenderIfNotSet() {},
      async build() { built++; return transactionBytes; },
    }) as any,
    onTransactionPrepared(prepared: any) { journal = prepared; },
  };
  await assert.rejects(
    provisionSuiNpcCharacter({ ...npcInput, identity }, provisionOptions),
    (error: any) => error.code === "TRANSACTION_STATUS_UNKNOWN" && error.ambiguous && error.transactionDigest === digest,
  );
  const result = await provisionSuiNpcCharacter({ ...npcInput, identity, ...journal }, provisionOptions);
  assert.equal(result.characterObjectId, identity.characterObjectId);
  assert.equal(result.walletAddress, identity.walletAddress);
  assert.equal(result.chainId, chainId);
  assert.equal(result.transactionDigest, digest);
  assert.equal(built, 1);
  assert.equal(submissions, 2);
});

test("NPC prepared identity cannot be reassigned to another faction before retry", async () => {
  const identity = prepareSuiNpcCharacterIdentity(npcInput, options);
  const client = missingClient();
  client.getChainIdentifier = async () => { throw new Error("Identity must fail before RPC"); };
  await assert.rejects(
    provisionSuiNpcCharacter(
      { ...npcInput, factionKey: "500025-feral", identity },
      { ...options, client },
    ),
    (error: any) => error.code === "INVALID_PREPARED_IDENTITY",
  );
});

test("NPC pending transaction is not replayed into a regenerated localnet", async () => {
  const identity = prepareSuiNpcCharacterIdentity(npcInput, options);
  const client = missingClient();
  await assert.rejects(
    provisionSuiNpcCharacter(
      { ...npcInput, identity, transactionDigest: "pending", chainId: "deadbeef" },
      { ...options, client },
    ),
    (error: any) => error.code === "WORLD_CHAIN_MISMATCH",
  );
});
