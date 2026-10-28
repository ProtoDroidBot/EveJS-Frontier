import { randomBytes, timingSafeEqual } from "node:crypto";

import { blake2b } from "@noble/hashes/blake2.js";
import { bcs } from "@mysten/sui/bcs";
import { Transaction } from "@mysten/sui/transactions";
import { deriveObjectID, normalizeSuiAddress } from "@mysten/sui/utils";

export const SUI_TRANSPONDER_COMMITMENT_DOMAIN = "EVE_FRONTIER_TRANSPONDER_COMMITMENT_V1";
export const SUI_TRANSPONDER_HASH_SCHEME = 1;
export const SUI_TRANSPONDER_SALT_LENGTH = 32;
export const SUI_TRANSPONDER_COMMITMENT_LENGTH = 32;
export const SUI_TRANSPONDER_CODE_MAX_LENGTH = 32;
export const SUI_TRANSPONDER_SCOPE_TRIBE = 1;
export const SUI_TRANSPONDER_SCOPE_FACTION = 2;

const U32_MAX = 0xffff_ffff;
const U64_MAX = (1n << 64n) - 1n;
const encoder = new TextEncoder();

const TransponderScopeKey = bcs.struct("TransponderScopeKey", {
  tenant: bcs.string(),
  scope_kind: bcs.u8(),
  scope_id: bcs.string(),
});

const TransponderCommitmentPreimage = bcs.struct("TransponderCommitmentPreimage", {
  domain: bcs.vector(bcs.u8()),
  registry_id: bcs.Address,
  tenant: bcs.string(),
  scope_kind: bcs.u8(),
  scope_id: bcs.string(),
  revision: bcs.u64(),
  code: bcs.string(),
  salt: bcs.vector(bcs.u8()),
});

export type SuiTransponderScope =
  | { kind: "tribe"; tribeId: unknown }
  | { kind: "faction"; factionKey: unknown };

export type SuiTransponderWorld = {
  /** Latest package used as the Move-call target. */
  packageId: string;
  /** First package version that introduced transponder::TransponderScopeKey. */
  typeOrigin: string;
  /** Core world registry bound into the commitment preimage and stored record. */
  objectRegistryId: string;
  /** Extension registry that owns derived commitment objects. */
  transponderRegistryId: string;
  tenant: string;
};

export type SuiTransponderCommitmentInput = {
  objectRegistryId: string;
  tenant: string;
  scope: SuiTransponderScope;
  revision: unknown;
  code: unknown;
  salt: Uint8Array | string;
};

export type SuiTransponderCommitmentResult = {
  commitment: Uint8Array;
  commitmentHex: string;
  /** Return this to the caller for off-chain distribution; never persist it on-chain. */
  salt: Uint8Array;
  preimageBytes: Uint8Array;
};

export type SuiTransponderCommitmentState = {
  objectId: string;
  registryId: string;
  tenant: string;
  scope: ReturnType<typeof normalizeSuiTransponderScope>;
  authority: string;
  hashScheme: number;
  commitment: Uint8Array;
  revision: string;
  revoked: boolean;
};

function address(value: unknown, label: string): string {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{1,64}$/.test(value.trim()) || BigInt(value.trim()) === 0n) {
    throw new Error(`${label} must be a nonzero Sui address`);
  }
  return normalizeSuiAddress(value.trim());
}

function tenant(value: unknown): string {
  const normalized = String(value ?? "").trim();
  if (!normalized || /[\u0000-\u001f\u007f]/.test(normalized)) {
    throw new Error("Transponder tenant must be nonempty and contain no control characters");
  }
  return normalized;
}

function revision(value: unknown): bigint {
  if (typeof value === "number" && (!Number.isSafeInteger(value) || value < 1)) {
    throw new Error("Transponder revision must be a positive u64");
  }
  const text = String(value ?? "");
  if (!/^[1-9][0-9]*$/.test(text) || BigInt(text) > U64_MAX) {
    throw new Error("Transponder revision must be a positive u64");
  }
  return BigInt(text);
}

function storedRevision(value: unknown): string {
  const text = String(value ?? "");
  if (!/^[1-9][0-9]*$/.test(text) || BigInt(text) > U64_MAX) {
    throw new Error("On-chain transponder revision is invalid");
  }
  return BigInt(text).toString();
}

function code(value: unknown): string {
  if (typeof value !== "string") {
    throw new Error("Transponder code must be a string");
  }
  const normalized = value.trim();
  if (!normalized || normalized.length > SUI_TRANSPONDER_CODE_MAX_LENGTH || /[\u0000-\u001f\u007f]/.test(normalized)) {
    throw new Error("Transponder code must be 1-32 characters with no control characters");
  }
  return normalized;
}

function bytes(value: Uint8Array | string, length: number, label: string): Uint8Array {
  let result: Uint8Array;
  if (value instanceof Uint8Array) {
    result = Uint8Array.from(value);
  } else if (typeof value === "string" && new RegExp(`^(?:0x)?[0-9a-fA-F]{${length * 2}}$`).test(value)) {
    result = Uint8Array.from(Buffer.from(value.replace(/^0x/, ""), "hex"));
  } else {
    throw new Error(`${label} must be exactly ${length} bytes`);
  }
  if (result.length !== length) {
    throw new Error(`${label} must be exactly ${length} bytes`);
  }
  return result;
}

export function normalizeSuiTransponderScope(scope: SuiTransponderScope): {
  kind: "tribe" | "faction";
  kindCode: number;
  scopeId: string;
} {
  if (!scope || typeof scope !== "object") {
    throw new Error("Transponder scope is required");
  }
  if (scope.kind === "tribe") {
    const raw = scope.tribeId;
    if ((typeof raw === "number" && (!Number.isSafeInteger(raw) || raw < 1)) ||
      !/^[1-9][0-9]*$/.test(String(raw ?? "")) || BigInt(String(raw)) > BigInt(U32_MAX)) {
      throw new Error("Transponder tribe ID must be a positive u32");
    }
    return { kind: "tribe", kindCode: SUI_TRANSPONDER_SCOPE_TRIBE, scopeId: BigInt(String(raw)).toString() };
  }
  if (scope.kind === "faction") {
    const scopeId = String(scope.factionKey ?? "").trim().toLowerCase();
    const match = /^(0|[1-9][0-9]*)-([a-z0-9][a-z0-9_-]{0,95})$/.exec(scopeId);
    if (!match || BigInt(match[1]) > BigInt(U32_MAX)) {
      throw new Error("Transponder faction key must be <u32 factionID>-<normalized faction string or none>");
    }
    return { kind: "faction", kindCode: SUI_TRANSPONDER_SCOPE_FACTION, scopeId };
  }
  throw new Error("Transponder scope kind must be tribe or faction");
}

/** Generate the high-entropy salt that is shared with the code only through an off-chain channel. */
export function generateSuiTransponderSalt(): Uint8Array {
  return Uint8Array.from(randomBytes(SUI_TRANSPONDER_SALT_LENGTH));
}

/**
 * Compute the canonical BCS + BLAKE2b-256 commitment.
 *
 * Do not log the returned preimage or submit it, the code, or the salt to Sui. `preimageBytes`
 * is exposed only so other clients can reproduce and audit the byte-level protocol.
 */
export function computeSuiTransponderCommitment(input: SuiTransponderCommitmentInput): SuiTransponderCommitmentResult {
  const normalizedScope = normalizeSuiTransponderScope(input.scope);
  const normalizedSalt = bytes(input.salt, SUI_TRANSPONDER_SALT_LENGTH, "Transponder salt");
  const preimageBytes = TransponderCommitmentPreimage.serialize({
    domain: Array.from(encoder.encode(SUI_TRANSPONDER_COMMITMENT_DOMAIN)),
    registry_id: address(input.objectRegistryId, "Transponder object registry"),
    tenant: tenant(input.tenant),
    scope_kind: normalizedScope.kindCode,
    scope_id: normalizedScope.scopeId,
    revision: revision(input.revision),
    code: code(input.code),
    salt: Array.from(normalizedSalt),
  }).toBytes();
  const commitment = Uint8Array.from(blake2b(preimageBytes, { dkLen: SUI_TRANSPONDER_COMMITMENT_LENGTH }));
  return {
    commitment,
    commitmentHex: Buffer.from(commitment).toString("hex"),
    salt: normalizedSalt,
    preimageBytes: Uint8Array.from(preimageBytes),
  };
}

export function verifySuiTransponderCommitment(
  expected: Uint8Array | string,
  input: SuiTransponderCommitmentInput,
): boolean {
  let normalized: Uint8Array;
  try {
    normalized = bytes(expected, SUI_TRANSPONDER_COMMITMENT_LENGTH, "Transponder commitment");
  } catch (_) {
    return false;
  }
  const actual = computeSuiTransponderCommitment(input).commitment;
  return timingSafeEqual(Buffer.from(normalized), Buffer.from(actual));
}

export function deriveSuiTransponderCommitmentObjectId(
  world: Pick<SuiTransponderWorld, "typeOrigin" | "transponderRegistryId" | "tenant">,
  scope: SuiTransponderScope,
): string {
  const normalizedScope = normalizeSuiTransponderScope(scope);
  return deriveObjectID(
    address(world.transponderRegistryId, "Transponder registry"),
    `${address(world.typeOrigin, "Transponder type origin")}::transponder::TransponderScopeKey`,
    TransponderScopeKey.serialize({
      tenant: tenant(world.tenant),
      scope_kind: normalizedScope.kindCode,
      scope_id: normalizedScope.scopeId,
    }).toBytes(),
  );
}

/**
 * Validate a fetched shared object before using its commitment. This prevents a caller from
 * accepting a look-alike object, a record from another world, or a mismatched tribe/faction.
 */
export function parseSuiTransponderCommitmentObject(
  object: any,
  world: SuiTransponderWorld,
  requestedScope: SuiTransponderScope,
): SuiTransponderCommitmentState {
  if (!object || typeof object !== "object") {
    throw new Error("On-chain transponder commitment object is missing");
  }
  const scope = normalizeSuiTransponderScope(requestedScope);
  const expectedId = deriveSuiTransponderCommitmentObjectId(world, requestedScope);
  const objectId = address(object.objectId ?? object.object_id ?? object.id, "Transponder commitment object");
  if (objectId !== expectedId) {
    throw new Error("On-chain transponder commitment has an unexpected derived object ID");
  }
  const expectedType = `${address(world.typeOrigin, "Transponder type origin")}::transponder::TransponderCommitment`;
  if (object.type !== expectedType) {
    throw new Error("On-chain transponder commitment has an unexpected Move type");
  }
  const owner = object.owner;
  const shared = owner && typeof owner === "object" && (owner.$kind === "Shared" || "Shared" in owner);
  if (!shared) {
    throw new Error("On-chain transponder commitment is not shared");
  }
  const fields = object.json ?? object.content?.fields ?? object.fields;
  if (!fields || typeof fields !== "object") {
    throw new Error("On-chain transponder commitment fields are missing");
  }
  const registryId = address(fields.registry_id, "On-chain transponder registry");
  const storedTenant = String(fields.tenant ?? "");
  const scopeKind = Number(fields.scope_kind);
  const scopeId = String(fields.scope_id ?? "");
  if (registryId !== address(world.objectRegistryId, "Transponder object registry") ||
      storedTenant !== tenant(world.tenant) || scopeKind !== scope.kindCode || scopeId !== scope.scopeId) {
    throw new Error("On-chain transponder commitment scope does not match the requested world");
  }
  const hashScheme = Number(fields.hash_scheme);
  if (hashScheme !== SUI_TRANSPONDER_HASH_SCHEME) {
    throw new Error("On-chain transponder commitment hash scheme is unsupported");
  }
  if (typeof fields.revoked !== "boolean") {
    throw new Error("On-chain transponder revocation state is invalid");
  }
  const rawCommitment = fields.commitment;
  if (!Array.isArray(rawCommitment) || rawCommitment.some(value =>
    !Number.isInteger(value) || value < 0 || value > 255)) {
    throw new Error("On-chain transponder commitment bytes are invalid");
  }
  const storedCommitment = Uint8Array.from(rawCommitment);
  if ((!fields.revoked && storedCommitment.length !== SUI_TRANSPONDER_COMMITMENT_LENGTH) ||
      (fields.revoked && storedCommitment.length !== 0)) {
    throw new Error("On-chain transponder commitment length is inconsistent with revocation state");
  }
  return {
    objectId,
    registryId,
    tenant: storedTenant,
    scope,
    authority: address(fields.authority, "On-chain transponder authority"),
    hashScheme,
    commitment: storedCommitment,
    revision: storedRevision(fields.revision),
    revoked: fields.revoked,
  };
}

function commitment(value: Uint8Array | string): number[] {
  return Array.from(bytes(value, SUI_TRANSPONDER_COMMITMENT_LENGTH, "Transponder commitment"));
}

function target(world: Pick<SuiTransponderWorld, "packageId">, fun: string): `${string}::${string}::${string}` {
  return `${address(world.packageId, "Transponder package")}::transponder::${fun}`;
}

export function createSuiTribeTransponderAuthorTransaction(input: {
  world: SuiTransponderWorld;
  characterObjectId: string;
  commitment: Uint8Array | string;
}): Transaction {
  const tx = new Transaction();
  tx.moveCall({
    target: target(input.world, "author_for_tribe"),
    arguments: [
      tx.object(address(input.world.objectRegistryId, "Transponder object registry")),
      tx.object(address(input.world.transponderRegistryId, "Transponder registry")),
      tx.object(address(input.characterObjectId, "Transponder character")),
      tx.pure.vector("u8", commitment(input.commitment)),
    ],
  });
  return tx;
}

export function createSuiFactionTransponderAuthorTransaction(input: {
  world: SuiTransponderWorld;
  characterObjectId: string;
  npcProfileObjectId: string;
  commitment: Uint8Array | string;
}): Transaction {
  const tx = new Transaction();
  tx.moveCall({
    target: target(input.world, "author_for_faction"),
    arguments: [
      tx.object(address(input.world.objectRegistryId, "Transponder object registry")),
      tx.object(address(input.world.transponderRegistryId, "Transponder registry")),
      tx.object(address(input.characterObjectId, "Transponder character")),
      tx.object(address(input.npcProfileObjectId, "Transponder NPC profile")),
      tx.pure.vector("u8", commitment(input.commitment)),
    ],
  });
  return tx;
}

export function createSuiTransponderRotateTransaction(input: {
  world: SuiTransponderWorld;
  scope: SuiTransponderScope;
  commitmentObjectId: string;
  authorizerObjectId: string;
  expectedRevision: unknown;
  commitment: Uint8Array | string;
}): Transaction {
  const scope = normalizeSuiTransponderScope(input.scope);
  const tx = new Transaction();
  tx.moveCall({
    target: target(input.world, scope.kind === "tribe" ? "rotate_for_tribe" : "rotate_for_faction"),
    arguments: [
      tx.object(address(input.commitmentObjectId, "Transponder commitment object")),
      tx.object(address(input.authorizerObjectId, "Transponder authorizer")),
      tx.pure.u64(revision(input.expectedRevision)),
      tx.pure.vector("u8", commitment(input.commitment)),
    ],
  });
  return tx;
}

export function createSuiTransponderRevokeTransaction(input: {
  world: SuiTransponderWorld;
  scope: SuiTransponderScope;
  commitmentObjectId: string;
  authorizerObjectId: string;
  expectedRevision: unknown;
}): Transaction {
  const scope = normalizeSuiTransponderScope(input.scope);
  const tx = new Transaction();
  tx.moveCall({
    target: target(input.world, scope.kind === "tribe" ? "revoke_for_tribe" : "revoke_for_faction"),
    arguments: [
      tx.object(address(input.commitmentObjectId, "Transponder commitment object")),
      tx.object(address(input.authorizerObjectId, "Transponder authorizer")),
      tx.pure.u64(revision(input.expectedRevision)),
    ],
  });
  return tx;
}

export function createSuiTribeTransponderAuthorityTransferTransaction(input: {
  world: SuiTransponderWorld;
  commitmentObjectId: string;
  currentCharacterObjectId: string;
  newAuthorityCharacterObjectId: string;
  expectedRevision: unknown;
}): Transaction {
  const tx = new Transaction();
  tx.moveCall({
    target: target(input.world, "transfer_tribe_authority"),
    arguments: [
      tx.object(address(input.commitmentObjectId, "Transponder commitment object")),
      tx.object(address(input.currentCharacterObjectId, "Current transponder authority character")),
      tx.object(address(input.newAuthorityCharacterObjectId, "New transponder authority character")),
      tx.pure.u64(revision(input.expectedRevision)),
    ],
  });
  return tx;
}
