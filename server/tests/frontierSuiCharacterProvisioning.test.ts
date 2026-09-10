import assert = require("node:assert/strict");
import { test } from "node:test";

import {
  SUI_CHARACTER_ADMIN_ACL_ID,
  SUI_CHARACTER_OBJECT_REGISTRY_ID,
  SUI_CHARACTER_WORLD_PACKAGE_ID,
  SuiCharacterProvisioningError,
  createSuiCharacterTransaction,
  deriveLocalPlayerSuiWalletAddress,
  deriveSuiCharacterObjectId,
  prepareSuiCharacterIdentity,
  provisionSuiCharacter,
} from "../src/services/frontier/suiCharacterProvisioning";

const PLAYER_PROFILE_ID =
  "0xf3c1cf351092c2d12d8675650f1e1d15ad2569c7fcbd14ecb0f92a69996bf0e7";

test("Frontier derives the same local-dev Sui wallet and Character ID as build 3502403", () => {
  assert.equal(
    deriveLocalPlayerSuiWalletAddress(1, "DEV"),
    "0x786226640f1e42da610b44007600b31a494346d39c7be1d58e3ac989e0a49ce6",
  );
  assert.equal(
    deriveSuiCharacterObjectId(
      SUI_CHARACTER_OBJECT_REGISTRY_ID,
      811880,
      SUI_CHARACTER_WORLD_PACKAGE_ID,
      "dev",
    ),
    "0x0bc82b6fb8f371ff784bc101322e3ca0f97034a8f5286d249257032544294b47",
  );
});

test("Frontier builds the deployed world package create/share Character transaction", () => {
  const identity = prepareSuiCharacterIdentity({
    accountId: 1,
    gameCharacterId: 140000001,
    characterName: "Sui Transaction Test",
  });
  const transaction = createSuiCharacterTransaction(identity);
  const data = transaction.getData();

  assert.equal(data.commands.length, 2);
  assert.deepEqual(
    data.commands.map((command: any) => ({
      package: command.MoveCall.package,
      module: command.MoveCall.module,
      function: command.MoveCall.function,
    })),
    [
      {
        package: SUI_CHARACTER_WORLD_PACKAGE_ID,
        module: "character",
        function: "create_character",
      },
      {
        package: SUI_CHARACTER_WORLD_PACKAGE_ID,
        module: "character",
        function: "share_character",
      },
    ],
  );
  assert.equal(data.commands[0].MoveCall.arguments.length, 7);
  assert.deepEqual(data.commands[1].MoveCall.arguments[0], {
    NestedResult: [0, 0],
    $kind: "NestedResult",
  });
  assert.equal(
    data.inputs[0].UnresolvedObject.objectId,
    SUI_CHARACTER_OBJECT_REGISTRY_ID,
  );
  assert.equal(
    data.inputs[1].UnresolvedObject.objectId,
    SUI_CHARACTER_ADMIN_ACL_ID,
  );
});

test("Frontier executes through SuiGrpcClient and returns wallet-owned PlayerProfile linkage", async () => {
  const identity = prepareSuiCharacterIdentity({
    accountId: 990000001,
    gameCharacterId: 140000002,
    characterName: "Sui Provision Test",
  });
  const characterType = `${identity.packageId}::character::Character`;
  const profileType = `${identity.packageId}::character::PlayerProfile`;
  let executeOptions: Record<string, any> | null = null;
  const client = {
    async getObject() {
      throw { reason: "notFound" };
    },
    async listOwnedObjects() {
      throw new Error("listOwnedObjects should not run for a new Character");
    },
    async signAndExecuteTransaction(options) {
      executeOptions = options;
      return {
        $kind: "Transaction",
        Transaction: {
          digest: "test-transaction-digest",
          status: { success: true, error: null },
          objectTypes: {
            [identity.characterObjectId]: characterType,
            [PLAYER_PROFILE_ID]: profileType,
          },
          effects: {
            changedObjects: [
              {
                objectId: identity.characterObjectId,
                idOperation: "Created",
                outputOwner: {
                  $kind: "Shared",
                  Shared: { initialSharedVersion: "1" },
                },
              },
              {
                objectId: PLAYER_PROFILE_ID,
                idOperation: "Created",
                outputOwner: {
                  $kind: "AddressOwner",
                  AddressOwner: identity.walletAddress,
                },
              },
            ],
          },
        },
      };
    },
  };

  const result = await provisionSuiCharacter(
    {
      accountId: identity.accountId,
      gameCharacterId: identity.gameCharacterId,
      characterName: identity.characterName,
      identity,
    },
    { client, adminSigner: { toSuiAddress: () => "0x1" } },
  );

  assert.equal(result.walletAddress, identity.walletAddress);
  assert.equal(result.characterObjectId, identity.characterObjectId);
  assert.equal(result.playerProfileObjectId, PLAYER_PROFILE_ID);
  assert.equal(result.transactionDigest, "test-transaction-digest");
  assert.equal(result.recovered, false);
  assert.deepEqual(executeOptions && executeOptions.include, {
    effects: true,
    events: true,
    objectTypes: true,
  });
  assert.ok(executeOptions && executeOptions.transaction);
  assert.ok(executeOptions && executeOptions.signer);
});

test("Frontier reconciles an existing Character instead of submitting a duplicate", async () => {
  const identity = prepareSuiCharacterIdentity({
    accountId: 990000002,
    gameCharacterId: 140000003,
    characterName: "Sui Reconcile Test",
  });
  let executeCalls = 0;
  const client = {
    async getObject() {
      return {
        object: {
          objectId: identity.characterObjectId,
          owner: {
            $kind: "Shared",
            Shared: { initialSharedVersion: "10" },
          },
          type: `${identity.packageId}::character::Character`,
          previousTransaction: "later-character-update",
          json: {
            id: identity.characterObjectId,
            character_address: identity.walletAddress,
            key: {
              item_id: String(identity.gameCharacterId),
              tenant: identity.tenant,
            },
            tribe_id: identity.tribeId,
          },
        },
      };
    },
    async listOwnedObjects() {
      return {
        objects: [
          {
            objectId: PLAYER_PROFILE_ID,
            owner: {
              $kind: "AddressOwner",
              AddressOwner: identity.walletAddress,
            },
            type: `${identity.packageId}::character::PlayerProfile`,
            previousTransaction: "original-create-transaction",
            json: {
              id: PLAYER_PROFILE_ID,
              character_id: identity.characterObjectId,
            },
          },
        ],
        cursor: null,
        hasNextPage: false,
      };
    },
    async signAndExecuteTransaction() {
      executeCalls += 1;
      throw new Error("duplicate transaction must not execute");
    },
  };

  const result = await provisionSuiCharacter(
    {
      accountId: identity.accountId,
      gameCharacterId: identity.gameCharacterId,
      characterName: identity.characterName,
      identity,
    },
    { client },
  );

  assert.equal(executeCalls, 0);
  assert.equal(result.recovered, true);
  assert.equal(result.playerProfileObjectId, PLAYER_PROFILE_ID);
  assert.equal(result.transactionDigest, "original-create-transaction");
});

test("Frontier treats a rejected Sui transaction as a definitive provisioning failure", async () => {
  const identity = prepareSuiCharacterIdentity({
    accountId: 990000003,
    gameCharacterId: 140000004,
    characterName: "Sui Failure Test",
  });
  const client = {
    async getObject() {
      throw { reason: "notFound" };
    },
    async listOwnedObjects() {
      return { objects: [], cursor: null, hasNextPage: false };
    },
    async signAndExecuteTransaction() {
      return {
        $kind: "FailedTransaction",
        FailedTransaction: {
          status: {
            success: false,
            error: { message: "MoveAbort" },
          },
        },
      };
    },
  };

  await assert.rejects(
    provisionSuiCharacter(
      {
        accountId: identity.accountId,
        gameCharacterId: identity.gameCharacterId,
        characterName: identity.characterName,
        identity,
      },
      {
        client,
        adminSigner: {},
        reconciliationDelaysMs: [0],
      },
    ),
    (error: any) => {
      assert.ok(error instanceof SuiCharacterProvisioningError);
      assert.equal(error.code, "TRANSACTION_FAILED");
      assert.equal(error.ambiguous, false);
      return true;
    },
  );
});

test("Frontier preserves a local binding when submission status is ambiguous", async () => {
  const identity = prepareSuiCharacterIdentity({
    accountId: 990000004,
    gameCharacterId: 140000005,
    characterName: "Sui Ambiguous Test",
  });
  const client = {
    async getObject() {
      throw { reason: "notFound" };
    },
    async listOwnedObjects() {
      return { objects: [], cursor: null, hasNextPage: false };
    },
    async signAndExecuteTransaction() {
      throw new Error("transport disconnected after submit");
    },
  };

  await assert.rejects(
    provisionSuiCharacter(
      {
        accountId: identity.accountId,
        gameCharacterId: identity.gameCharacterId,
        characterName: identity.characterName,
        identity,
      },
      {
        client,
        adminSigner: {},
        reconciliationDelaysMs: [0, 0],
      },
    ),
    (error: any) => {
      assert.ok(error instanceof SuiCharacterProvisioningError);
      assert.equal(error.code, "TRANSACTION_STATUS_UNKNOWN");
      assert.equal(error.ambiguous, true);
      return true;
    },
  );
});

test("Frontier keeps a confirmed digest when successful outputs need reconciliation", async () => {
  const identity = prepareSuiCharacterIdentity({
    accountId: 990000005,
    gameCharacterId: 140000006,
    characterName: "Sui Output Reconcile Test",
  });
  let lookupCount = 0;
  const client = {
    async getObject() {
      lookupCount += 1;
      if (lookupCount === 1) {
        throw { reason: "notFound" };
      }
      throw new Error("index unavailable");
    },
    async listOwnedObjects() {
      return { objects: [], cursor: null, hasNextPage: false };
    },
    async signAndExecuteTransaction() {
      return {
        $kind: "Transaction",
        Transaction: {
          digest: "known-success-digest",
          status: { success: true, error: null },
          objectTypes: {},
          effects: { changedObjects: [] },
        },
      };
    },
  };

  await assert.rejects(
    provisionSuiCharacter(
      {
        accountId: identity.accountId,
        gameCharacterId: identity.gameCharacterId,
        characterName: identity.characterName,
        identity,
      },
      {
        client,
        adminSigner: {},
        reconciliationDelaysMs: [0],
      },
    ),
    (error: any) => {
      assert.ok(error instanceof SuiCharacterProvisioningError);
      assert.equal(error.code, "TRANSACTION_STATUS_UNKNOWN");
      assert.equal(error.ambiguous, true);
      assert.equal(error.transactionDigest, "known-success-digest");
      return true;
    },
  );
});
