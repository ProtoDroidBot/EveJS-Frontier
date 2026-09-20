import assert = require("node:assert/strict");
import { test } from "node:test";
import { normalizeSuiAddress } from "@mysten/sui/utils";

import {
  SUI_TRANSPONDER_COMMITMENT_DOMAIN,
  computeSuiTransponderCommitment,
  createSuiFactionTransponderAuthorTransaction,
  createSuiTransponderRevokeTransaction,
  createSuiTransponderRotateTransaction,
  createSuiTribeTransponderAuthorityTransferTransaction,
  createSuiTribeTransponderAuthorTransaction,
  deriveSuiTransponderCommitmentObjectId,
  generateSuiTransponderSalt,
  normalizeSuiTransponderScope,
  parseSuiTransponderCommitmentObject,
  verifySuiTransponderCommitment,
  type SuiTransponderWorld,
} from "../src/services/frontier/suiTransponderCommitment";

const address = (value: number) => normalizeSuiAddress(`0x${value.toString(16)}`);
const world: SuiTransponderWorld = {
  packageId: address(10),
  typeOrigin: address(9),
  objectRegistryId: address(2),
  tenant: "dev",
};
const salt = Uint8Array.from({ length: 32 }, (_, index) => index);
const commitmentInput = {
  objectRegistryId: world.objectRegistryId,
  tenant: world.tenant,
  scope: { kind: "tribe", tribeId: 101 } as const,
  revision: 1,
  code: "FRIEND-42",
  salt,
};

function moveCall(transaction) {
  const command: any = transaction.getData().commands[0];
  assert.equal(command.$kind, "MoveCall");
  return command.MoveCall;
}

test("canonical transponder commitments are stable, scoped and constant-time verifiable", () => {
  const result = computeSuiTransponderCommitment(commitmentInput);
  assert.equal(result.commitment.length, 32);
  assert.equal(result.commitmentHex, "99fe841f30758f9f0a9adfe239587369788e14f0e036c2dc211ee0448eeb765f");
  assert.equal(result.preimageBytes[0], SUI_TRANSPONDER_COMMITMENT_DOMAIN.length);
  assert.deepEqual(result.salt, salt);
  assert.equal(verifySuiTransponderCommitment(result.commitmentHex, commitmentInput), true);
  assert.equal(verifySuiTransponderCommitment(result.commitment, { ...commitmentInput, code: "FRIEND-43" }), false);
  assert.equal(verifySuiTransponderCommitment(result.commitment, {
    ...commitmentInput, scope: { kind: "faction", factionKey: "500012-none" },
  }), false);
  assert.equal(verifySuiTransponderCommitment("00", commitmentInput), false);
});

test("every commitment field prevents replay into another world, tenant, scope or revision", () => {
  const baseline = computeSuiTransponderCommitment(commitmentInput).commitmentHex;
  const variants = [
    { ...commitmentInput, objectRegistryId: address(3) },
    { ...commitmentInput, tenant: "other" },
    { ...commitmentInput, scope: { kind: "tribe", tribeId: 102 } as const },
    { ...commitmentInput, revision: 2 },
    { ...commitmentInput, salt: Uint8Array.from({ length: 32 }, () => 7) },
  ];
  for (const variant of variants) {
    assert.notEqual(computeSuiTransponderCommitment(variant).commitmentHex, baseline);
  }
});

test("scope key derivation uses the type origin while transactions target the latest package", () => {
  const tribe = deriveSuiTransponderCommitmentObjectId(world, { kind: "tribe", tribeId: 101 });
  const faction = deriveSuiTransponderCommitmentObjectId(world, { kind: "faction", factionKey: "500012-none" });
  const laterWorld: SuiTransponderWorld = { ...world, packageId: address(11) };
  const later = deriveSuiTransponderCommitmentObjectId(laterWorld, { kind: "tribe", tribeId: 101 });
  const wrongOrigin = deriveSuiTransponderCommitmentObjectId({ ...world, typeOrigin: address(8) }, { kind: "tribe", tribeId: 101 });
  assert.equal(tribe, later);
  assert.notEqual(tribe, faction);
  assert.notEqual(tribe, wrongOrigin);

  const digest = computeSuiTransponderCommitment(commitmentInput).commitment;
  const call = moveCall(createSuiTribeTransponderAuthorTransaction({
    world, characterObjectId: address(20), commitment: digest,
  }));
  assert.equal(call.package, world.packageId);
  assert.equal(call.module, "transponder");
  assert.equal(call.function, "author_for_tribe");
  assert.equal(call.arguments.length, 3);
});

test("author, rotate, revoke and authority-transfer builders select scope-specific entry points", () => {
  const digest = computeSuiTransponderCommitment(commitmentInput).commitment;
  const record = deriveSuiTransponderCommitmentObjectId(world, commitmentInput.scope);
  const character = address(20);
  const profile = address(21);
  const factionScope = { kind: "faction", factionKey: "500012-none" } as const;
  const calls = [
    moveCall(createSuiFactionTransponderAuthorTransaction({ world, npcProfileObjectId: profile, commitment: digest })),
    moveCall(createSuiTransponderRotateTransaction({ world, scope: commitmentInput.scope,
      commitmentObjectId: record, authorizerObjectId: character, expectedRevision: 1, commitment: digest })),
    moveCall(createSuiTransponderRotateTransaction({ world, scope: factionScope,
      commitmentObjectId: record, authorizerObjectId: profile, expectedRevision: "2", commitment: digest })),
    moveCall(createSuiTransponderRevokeTransaction({ world, scope: commitmentInput.scope,
      commitmentObjectId: record, authorizerObjectId: character, expectedRevision: 3 })),
    moveCall(createSuiTransponderRevokeTransaction({ world, scope: factionScope,
      commitmentObjectId: record, authorizerObjectId: profile, expectedRevision: 4 })),
    moveCall(createSuiTribeTransponderAuthorityTransferTransaction({ world,
      commitmentObjectId: record, currentCharacterObjectId: character,
      newAuthorityCharacterObjectId: address(22), expectedRevision: 5 })),
  ];
  assert.deepEqual(calls.map(call => call.function), [
    "author_for_faction", "rotate_for_tribe", "rotate_for_faction",
    "revoke_for_tribe", "revoke_for_faction", "transfer_tribe_authority",
  ]);
  assert.deepEqual(calls.map(call => call.arguments.length), [3, 4, 4, 3, 3, 4]);
});

test("transactions contain only the commitment, never the code or salt", () => {
  const result = computeSuiTransponderCommitment(commitmentInput);
  const transaction = createSuiTribeTransponderAuthorTransaction({
    world, characterObjectId: address(20), commitment: result.commitment,
  });
  const serialized = JSON.stringify(transaction.getData());
  assert.equal(serialized.includes(String(commitmentInput.code)), false);
  assert.equal(serialized.includes(Buffer.from(salt).toString("hex")), false);
  assert.equal(serialized.includes(Buffer.from(salt).toString("base64")), false);
  assert.equal(serialized.includes(result.commitmentHex), false, "SDK stores the commitment as BCS bytes, not secret-like hex text");
});

test("fetched records are bound to their derived ID, Move type, shared owner and exact scope", () => {
  const result = computeSuiTransponderCommitment(commitmentInput);
  const objectId = deriveSuiTransponderCommitmentObjectId(world, commitmentInput.scope);
  const object = {
    objectId,
    type: `${world.typeOrigin}::transponder::TransponderCommitment`,
    owner: { $kind: "Shared" },
    json: {
      registry_id: world.objectRegistryId,
      tenant: world.tenant,
      scope_kind: 1,
      scope_id: "101",
      authority: address(20),
      hash_scheme: 1,
      commitment: Array.from(result.commitment),
      revision: "1",
      revoked: false,
    },
  };
  const parsed = parseSuiTransponderCommitmentObject(object, world, commitmentInput.scope);
  assert.equal(parsed.objectId, objectId);
  assert.equal(parsed.revision, "1");
  assert.deepEqual(parsed.commitment, result.commitment);

  for (const corrupt of [
    { ...object, objectId: address(99) },
    { ...object, type: `${world.packageId}::transponder::TransponderCommitment` },
    { ...object, owner: { AddressOwner: address(20) } },
    { ...object, json: { ...object.json, registry_id: address(3) } },
    { ...object, json: { ...object.json, scope_id: "102" } },
    { ...object, json: { ...object.json, hash_scheme: 2 } },
    { ...object, json: { ...object.json, commitment: [1] } },
  ]) assert.throws(() => parseSuiTransponderCommitmentObject(corrupt, world, commitmentInput.scope));

  const revoked = parseSuiTransponderCommitmentObject({
    ...object, json: { ...object.json, commitment: [], revision: "2", revoked: true },
  }, world, commitmentInput.scope);
  assert.equal(revoked.revoked, true);
  assert.equal(revoked.commitment.length, 0);
});

test("salt generation and canonical input validation fail closed", () => {
  assert.equal(generateSuiTransponderSalt().length, 32);
  assert.notDeepEqual(generateSuiTransponderSalt(), generateSuiTransponderSalt());
  assert.deepEqual(normalizeSuiTransponderScope({ kind: "tribe", tribeId: "101" }), {
    kind: "tribe", kindCode: 1, scopeId: "101",
  });
  assert.deepEqual(normalizeSuiTransponderScope({ kind: "faction", factionKey: "500012-NONE" }), {
    kind: "faction", kindCode: 2, scopeId: "500012-none",
  });
  for (const input of [
    { ...commitmentInput, code: "" },
    { ...commitmentInput, code: "x".repeat(33) },
    { ...commitmentInput, salt: new Uint8Array(31) },
    { ...commitmentInput, revision: 0 },
    { ...commitmentInput, objectRegistryId: "0x0" },
    { ...commitmentInput, scope: { kind: "tribe", tribeId: 0 } as const },
    { ...commitmentInput, scope: { kind: "faction", factionKey: "bad faction" } as const },
  ]) {
    assert.throws(() => computeSuiTransponderCommitment(input));
  }
});
