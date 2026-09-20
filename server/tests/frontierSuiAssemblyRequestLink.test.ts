"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { Ed25519Keypair } = require("@mysten/sui/keypairs/ed25519");
const {
  createSuiAssemblyRequestLinkBridge,
  createSuiAssemblyRequestAttestation,
  verifySuiAssemblyRequestAttestation,
} = require("../src/services/frontier/suiAssemblyRequestLink");

const CHAIN_ID = "4f".repeat(32);
const PACKAGE_ID = `0x${"11".repeat(32)}`;
const OBJECT_REGISTRY_ID = `0x${"22".repeat(32)}`;
const SERVER_REGISTRY_ID = `0x${"33".repeat(32)}`;
const SOURCE_ID = `0x${"44".repeat(32)}`;
const TARGET_ID = `0x${"55".repeat(32)}`;
const NOW = 2_000_000;

function request() {
  return {
    requestID: "11111111-1111-4111-8111-111111111111",
    requestType: "logistics.transfer",
    sourceAssemblyID: 5000000001,
    targetAssemblyID: 5000000002,
    ownerID: 140000003,
    payload: { typeID: 34, quantity: 10 },
    priority: 200,
    priorityFlags: 8,
    createdAtMs: NOW,
    expiresAtMs: NOW + 60_000,
  };
}

function ref(localAssemblyID, objectID, version) {
  return { localAssemblyID, objectID, version: String(version), digest: `digest-${version}` };
}

function proofOptions(signer, phase = "created", extra: any = {}) {
  return {
    signer,
    phase,
    chainID: CHAIN_ID,
    packageID: PACKAGE_ID,
    objectRegistryID: OBJECT_REGISTRY_ID,
    serverAddressRegistryID: SERVER_REGISTRY_ID,
    request: request(),
    source: ref(5000000001, SOURCE_ID, 7),
    target: ref(5000000002, TARGET_ID, 11),
    issuedAtMs: NOW,
    deadlineMs: NOW + 60_000,
    ...extra,
  };
}

function verifyOptions(proof, phase = "created", extra: any = {}) {
  return {
    request: request(), proof, phase, now: NOW + 1,
    expected: {
      chainID: CHAIN_ID,
      packageID: PACKAGE_ID,
      objectRegistryID: OBJECT_REGISTRY_ID,
      serverAddressRegistryID: SERVER_REGISTRY_ID,
    },
    ...extra,
  };
}

test("Sui queue creation attestations bind request, world, signer, and exact object refs", async () => {
  const signer = Ed25519Keypair.fromSecretKey(Uint8Array.from({ length: 32 }, (_, index) => index + 1));
  const proof = await createSuiAssemblyRequestAttestation(proofOptions(signer));
  assert.equal(await verifySuiAssemblyRequestAttestation(verifyOptions(proof)), true);
  assert.equal(proof.serverAddress, signer.toSuiAddress());
  assert.equal(proof.source.version, "7");
  assert.equal(proof.target.digest, "digest-11");
  assert.match(proof.attestationHash, /^[0-9a-f]{64}$/u);

  assert.equal(await verifySuiAssemblyRequestAttestation({
    ...verifyOptions(proof),
    request: { ...request(), payload: { typeID: 34, quantity: 11 } },
  }), false, "payload tampering must invalidate the commitment");
  assert.equal(await verifySuiAssemblyRequestAttestation({
    ...verifyOptions(proof),
    expected: { ...verifyOptions(proof).expected, chainID: "different-chain" },
  }), false, "a proof cannot move to another chain");
  assert.equal(await verifySuiAssemblyRequestAttestation(verifyOptions({
    ...proof,
    source: { ...proof.source, version: "8" },
  })), false, "an object reference cannot be changed after signing");
  assert.equal(await verifySuiAssemblyRequestAttestation(verifyOptions({
    ...proof,
    signature: `${proof.signature.slice(0, -2)}AA`,
  })), false, "signature tampering must fail");
});

test("terminal receipts chain to creation and commit the exact outcome", async () => {
  const signer = Ed25519Keypair.fromSecretKey(Uint8Array.from({ length: 32 }, () => 9));
  const created = await createSuiAssemblyRequestAttestation(proofOptions(signer));
  const outcome = { moved: 10, typeID: 34 };
  const terminal = await createSuiAssemblyRequestAttestation(proofOptions(signer, "fulfilled", {
    outcome,
    previousAttestationHash: created.attestationHash,
  }));
  assert.equal(await verifySuiAssemblyRequestAttestation(verifyOptions(terminal, "fulfilled", {
    outcome,
    previousAttestationHash: created.attestationHash,
    enforceDeadline: false,
  })), true);
  assert.equal(await verifySuiAssemblyRequestAttestation(verifyOptions(terminal, "fulfilled", {
    outcome: { moved: 9, typeID: 34 },
    previousAttestationHash: created.attestationHash,
    enforceDeadline: false,
  })), false);
  assert.equal(await verifySuiAssemblyRequestAttestation(verifyOptions(terminal, "fulfilled", {
    outcome,
    previousAttestationHash: "00".repeat(32),
    enforceDeadline: false,
  })), false);
});

test("operational creation proofs expire while their signatures remain auditable", async () => {
  const signer = Ed25519Keypair.fromSecretKey(Uint8Array.from({ length: 32 }, () => 4));
  const proof = await createSuiAssemblyRequestAttestation(proofOptions(signer));
  assert.equal(await verifySuiAssemblyRequestAttestation(verifyOptions(proof, "created", {
    now: NOW + 60_001,
  })), false);
  assert.equal(await verifySuiAssemblyRequestAttestation(verifyOptions(proof, "created", {
    now: NOW + 60_001,
    enforceDeadline: false,
  })), true);
});

test("the worker bridge requires current signer membership in the on-chain registry", async () => {
  const signer = Ed25519Keypair.fromSecretKey(Uint8Array.from({ length: 32 }, () => 6));
  const tableID = `0x${"66".repeat(32)}`;
  let authorized = true;
  let checkedAddress = null;
  const context = {
    synced: { chainId: CHAIN_ID, packageId: PACKAGE_ID, objectRegistryId: OBJECT_REGISTRY_ID },
    world: { serverAddressRegistryId: SERVER_REGISTRY_ID },
    adminSigner: signer,
    async assertCurrent() {},
    client: {
      async getObject() {
        return { data: { content: { dataType: "moveObject", fields: {
          authorized_address: { fields: { id: { id: tableID } } },
        } } } };
      },
      async getDynamicFieldObject(input) {
        checkedAddress = input.name.value;
        return authorized
          ? { data: { content: { dataType: "moveObject", fields: { value: true } } } }
          : { error: { code: "dynamicFieldNotFound" } };
      },
    },
    chain: {
      async readAssembly(assembly) {
        return assembly.itemId === String(request().sourceAssemblyID)
          ? { id: SOURCE_ID, version: "7", digest: "source-digest" }
          : { id: TARGET_ID, version: "11", digest: "target-digest" };
      },
    },
  };
  const bridge = createSuiAssemblyRequestLinkBridge({
    runExclusive: operation => operation(),
    getContext: () => context,
    getSnapshot: () => ({ assemblies: [
      { itemId: String(request().sourceAssemblyID) },
      { itemId: String(request().targetAssemblyID) },
    ] }),
    now: () => NOW,
  });
  const proof = await bridge.attestCreation(request());
  assert.equal(checkedAddress, signer.toSuiAddress());
  assert.equal(await bridge.verifyCreation(request(), proof), true);

  authorized = false;
  await assert.rejects(() => bridge.verifyCreation(request(), proof), error =>
    error.code === "ASSEMBLY_REQUEST_CHAIN_SIGNER_UNAUTHORIZED");
});
