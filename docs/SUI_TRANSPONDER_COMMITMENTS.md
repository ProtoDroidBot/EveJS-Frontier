# Sui transponder commitments

The server-side protocol lives in `server/src/services/frontier/suiTransponderCommitment.ts` and matches `<transponderPackageId>::transponder`, published from `contracts/world_transponder` in the authoritative world-contracts checkout.

It provides:

- cryptographically random 32-byte salt generation;
- canonical BCS serialization and BLAKE2b-256 hashing;
- constant-time commitment verification;
- deterministic commitment-object ID derivation for tribe and canonical NPC faction scopes;
- strict validation of fetched shared objects before their commitment is trusted;
- transaction builders for authoring, rotating, revoking, and transferring tribe authority.

The API never puts a code or salt into a Sui transaction. The caller is responsible for delivering `{ code, salt, registry, tenant, scope, revision }` to authorized group members through an encrypted off-chain channel. The current Frontier IFF runtime can continue using the plaintext code locally; the commitment proves that the shared value is the one authored for the group, rather than acting as storage for that value.

## Authoring example

```ts
const salt = generateSuiTransponderSalt();
const scope = { kind: "tribe", tribeId: 101 } as const;
const authored = computeSuiTransponderCommitment({
  objectRegistryId: world.objectRegistryId,
  tenant: world.tenant,
  scope,
  revision: 1,
  code: "FRIEND-42",
  salt,
});

const objectId = deriveSuiTransponderCommitmentObjectId(world, scope);
const transaction = createSuiTribeTransponderAuthorTransaction({
  world,
  characterObjectId,
  commitment: authored.commitment,
});
```

Sign the transaction with the Character wallet. For an NPC faction, use the faction wallet, its `NpcProfile`, and `createSuiFactionTransponderAuthorTransaction`.

The runtime derives one plaintext code per canonical NPC faction using the current testing format `FACTION` or `FACTION:SHARED_SUFFIX`. An optional `transponderSuffix` in `npc-factions.config.json` is faction-wide rather than per spawn group; when present it is part of the plaintext code before commitment hashing. The on-chain scope remains the canonical faction, so spawn groups and behavior profiles neither create separate commitments nor reveal the code or suffix on chain. External code discovery/interrogation is intentionally deferred.

For a rotation, read and validate the current record, compute a commitment with `revision = current revision + 1`, and submit `createSuiTransponderRotateTransaction` with `expectedRevision = current revision`. Never reuse a salt.

After fetching a chain object, call `parseSuiTransponderCommitmentObject`. It verifies the derived ID, original Move type, shared ownership, registry, tenant, scope, hash scheme, and state shape. Then call `verifySuiTransponderCommitment` with the private bundle. A revoked record has an empty commitment and cannot verify until its authority rotates it.

## Security boundary

- All Sui object fields, transaction arguments, events, and signatures are public.
- The 32-byte salt must remain as private as the code. It is not a substitute for an encrypted sharing channel.
- The digest is bound to one ObjectRegistry, tenant, scope, and revision. Copying it elsewhere does not verify.
- A 32-character client limit is enforced before hashing.
- The module has no reveal function and clients must not simulate verification by submitting a code/salt pair to the chain.
- Deterministic Localnet player and NPC-faction wallets are development identities, not secure public-network custody.

The focused regression is included in `npm run test:typescript-runtime`, or can be run after building with:

```powershell
npm run build:tests
node --test server/tests/frontierSuiTransponderCommitment.test.js
```

Source changes do not upgrade an already-published package. The current Localnet has an independently published transponder call package and shared registry recorded in the combined `npc-deployment.json` manifest. Transaction submission fails closed when that package/origin/registry triple is absent or mismatched. For later compatible upgrades, change the latest call target while retaining the first transponder type origin and existing registry. The transponder package also depends on compatible base-world and NPC packages; package splitting does not remove those ABI requirements.
