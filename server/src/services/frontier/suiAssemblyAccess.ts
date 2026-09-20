import { bcs } from "@mysten/sui/bcs";
import type { SuiJsonRpcClient } from "@mysten/sui/jsonRpc";
import { Transaction, type TransactionArgument } from "@mysten/sui/transactions";
import { deriveObjectID, normalizeSuiAddress, SUI_CLOCK_OBJECT_ID } from "@mysten/sui/utils";

export const SUI_ASSEMBLY_ACCESS_PRINCIPAL = Object.freeze({
  OWNER: 0,
  PLAYER: 1,
  NPC: 2,
  TRIBE: 3,
  FACTION: 4,
});

export const SUI_ASSEMBLY_ACCESS_CAPABILITY = Object.freeze({
  "gui.view": 1n,
  operate: 2n,
  "inventory.deposit": 4n,
  "inventory.withdraw": 8n,
  configure: 16n,
  manage_access: 32n,
});

const ALL_CAPABILITIES = 63n;
const CUSTODY_CAPABILITIES = 12n;
const MAX_U64 = (1n << 64n) - 1n;
const TenantItemId = bcs.struct("TenantItemId", { id: bcs.u64(), tenant: bcs.string() });
const PolicyKey = bcs.struct("AssemblyAccessPolicyKey", { assembly_id: bcs.Address });
const GrantKey = bcs.struct("AssemblyAccessGrantKey", {
  policy_id: bcs.Address,
  grant_id: bcs.vector(bcs.u8()),
});

export type SuiAssemblyAccessWorld = {
  /** Latest implementation package used for Move calls. */
  packageId: string;
  /** First package version containing assembly_access object types. */
  typeOrigin: string;
  /** Original world package defining TenantItemId and assembly types. */
  worldPackageId: string;
  objectRegistryId: string;
  tenant: string;
};

export type SuiAssemblyAccessPrincipal = {
  kind: number;
  id: string;
  canonical: string;
};

export type SuiAssemblyAccessPolicyState = {
  objectId: string;
  registryId: string;
  assemblyId: string;
  ownerCapId: string;
  revision: string;
};

export type SuiAssemblyAccessGrantState = {
  objectId: string;
  registryId: string;
  policyId: string;
  assemblyId: string;
  grantId: string;
  recipient: SuiAssemblyAccessPrincipal;
  capabilities: string[];
  capabilityMask: string;
  grantor: SuiAssemblyAccessPrincipal;
  parentGrantId: string | null;
  expiresAtMs: string;
  delegable: boolean;
  delegationDepth: number;
  revision: string;
  policyRevision: string;
  revoked: boolean;
};

function address(value: unknown, label: string): string {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{1,64}$/.test(value.trim()) || BigInt(value.trim()) === 0n) {
    throw new Error(`${label} must be a nonzero Sui address`);
  }
  return normalizeSuiAddress(value.trim());
}

function u64(value: unknown, label: string, positive = false): bigint {
  const text = String(value ?? "");
  if (!/^[0-9]+$/.test(text)) throw new Error(`${label} must be a u64`);
  const result = BigInt(text);
  if (result > MAX_U64 || (positive && result === 0n)) throw new Error(`${label} must be a u64`);
  return result;
}

function uuidBytes(value: unknown): Uint8Array {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(normalized)) {
    throw new Error("Assembly access grant ID must be a UUID");
  }
  return Uint8Array.from(Buffer.from(normalized.replaceAll("-", ""), "hex"));
}

function bytesUuid(value: unknown): string {
  let bytes: Uint8Array;
  if (Array.isArray(value) && value.every(entry => Number.isInteger(entry) && entry >= 0 && entry <= 255)) {
    bytes = Uint8Array.from(value);
  } else if (typeof value === "string") {
    try { bytes = Uint8Array.from(Buffer.from(value, "base64")); }
    catch { throw new Error("On-chain access grant ID is invalid"); }
  } else {
    throw new Error("On-chain access grant ID is invalid");
  }
  if (bytes.length !== 16) throw new Error("On-chain access grant ID is invalid");
  const hex = Buffer.from(bytes).toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function moveFields(value: any): any {
  return value && typeof value === "object" && "fields" in value && !value.variant
    ? value.fields : value;
}

function objectId(value: any, label: string): string {
  const field = moveFields(value);
  return address(typeof field === "string" ? field : field?.id ?? field?.bytes, label);
}

function optionId(value: any): string | null {
  const field = moveFields(value);
  if (field == null) return null;
  const vector = Array.isArray(field?.vec) ? field.vec : Array.isArray(field) ? field : null;
  if (vector) return vector.length ? objectId(vector[0], "Access parent grant") : null;
  return objectId(field, "Access parent grant");
}

function moveObject(value: any, expectedType: string, label: string): { objectId: string; fields: any } {
  const data = value?.data ?? value;
  const content = data?.content ?? data;
  const type = data?.type ?? content?.type;
  const fields = content?.fields ?? data?.fields ?? data?.json;
  if (type !== expectedType || !fields || typeof fields !== "object") {
    throw new Error(`${label} has an unexpected Move type or content`);
  }
  const owner = data?.owner ?? value?.owner;
  const shared = owner && typeof owner === "object" && (owner.$kind === "Shared" || "Shared" in owner);
  if (!shared) throw new Error(`${label} is not a shared object`);
  return { objectId: address(data?.objectId ?? data?.object_id ?? data?.id, label), fields };
}

export function normalizeSuiAssemblyAccessPrincipal(value: unknown, allowOwner = false): SuiAssemblyAccessPrincipal {
  const normalized = String(value ?? "").trim().toLowerCase();
  const entity = /^entity:(player|npc):([1-9][0-9]*)$/.exec(normalized);
  if (entity) return {
    kind: entity[1] === "player" ? SUI_ASSEMBLY_ACCESS_PRINCIPAL.PLAYER : SUI_ASSEMBLY_ACCESS_PRINCIPAL.NPC,
    id: BigInt(entity[2]).toString(),
    canonical: `entity:${entity[1]}:${BigInt(entity[2]).toString()}`,
  };
  const tribe = /^tribe:([1-9][0-9]*)$/.exec(normalized);
  if (tribe) return {
    kind: SUI_ASSEMBLY_ACCESS_PRINCIPAL.TRIBE,
    id: BigInt(tribe[1]).toString(),
    canonical: `tribe:${BigInt(tribe[1]).toString()}`,
  };
  const faction = /^faction:((?:0|[1-9][0-9]*)-[a-z0-9][a-z0-9_-]{0,95})$/.exec(normalized);
  if (faction) return {
    kind: SUI_ASSEMBLY_ACCESS_PRINCIPAL.FACTION,
    id: faction[1],
    canonical: `faction:${faction[1]}`,
  };
  if (allowOwner && normalized === "owner") {
    return { kind: SUI_ASSEMBLY_ACCESS_PRINCIPAL.OWNER, id: "", canonical: "owner" };
  }
  throw new Error("Assembly access principal is invalid");
}

function principalFromFields(kindValue: unknown, idValue: unknown, allowOwner = false): SuiAssemblyAccessPrincipal {
  const kind = Number(kindValue);
  const id = String(idValue ?? "");
  if (allowOwner && kind === SUI_ASSEMBLY_ACCESS_PRINCIPAL.OWNER && id === "") {
    return { kind, id, canonical: "owner" };
  }
  const canonical = kind === SUI_ASSEMBLY_ACCESS_PRINCIPAL.PLAYER ? `entity:player:${id}`
    : kind === SUI_ASSEMBLY_ACCESS_PRINCIPAL.NPC ? `entity:npc:${id}`
      : kind === SUI_ASSEMBLY_ACCESS_PRINCIPAL.TRIBE ? `tribe:${id}`
        : kind === SUI_ASSEMBLY_ACCESS_PRINCIPAL.FACTION ? `faction:${id}` : "";
  const normalized = normalizeSuiAssemblyAccessPrincipal(canonical, allowOwner);
  if (normalized.kind !== kind || normalized.id !== id) throw new Error("On-chain access principal is not canonical");
  return normalized;
}

export function suiAssemblyAccessCapabilityMask(capabilities: unknown): bigint {
  const values = Array.isArray(capabilities) ? capabilities : [capabilities];
  if (!values.length) throw new Error("Assembly access capabilities are required");
  let mask = 0n;
  for (const value of values) {
    const bit = SUI_ASSEMBLY_ACCESS_CAPABILITY[String(value ?? "").trim().toLowerCase()];
    if (!bit || (mask & bit) !== 0n) throw new Error("Assembly access capability is invalid or duplicated");
    mask |= bit;
  }
  if (mask === 0n || (mask & ALL_CAPABILITIES) !== mask) throw new Error("Assembly access capability mask is invalid");
  return mask;
}

export function suiAssemblyAccessCapabilities(maskValue: unknown): string[] {
  const mask = u64(maskValue, "Assembly access capability mask", true);
  if ((mask & ALL_CAPABILITIES) !== mask) throw new Error("Assembly access capability mask is invalid");
  return Object.entries(SUI_ASSEMBLY_ACCESS_CAPABILITY)
    .filter(([, bit]) => (mask & bit) === bit)
    .map(([name]) => name);
}

export function deriveSuiAssemblyObjectId(world: SuiAssemblyAccessWorld, itemId: unknown): string {
  return deriveObjectID(
    address(world.objectRegistryId, "Assembly access object registry"),
    `${address(world.worldPackageId, "World package")}::in_game_id::TenantItemId`,
    TenantItemId.serialize({ id: u64(itemId, "Assembly item ID", true), tenant: String(world.tenant) }).toBytes(),
  );
}

export function deriveSuiAssemblyAccessPolicyId(world: SuiAssemblyAccessWorld, itemId: unknown): string {
  return deriveObjectID(
    address(world.objectRegistryId, "Assembly access object registry"),
    `${address(world.typeOrigin, "Assembly access type origin")}::assembly_access::AssemblyAccessPolicyKey`,
    PolicyKey.serialize({ assembly_id: deriveSuiAssemblyObjectId(world, itemId) }).toBytes(),
  );
}

export function deriveSuiAssemblyAccessGrantId(
  world: SuiAssemblyAccessWorld,
  itemId: unknown,
  grantId: unknown,
): string {
  const policyId = deriveSuiAssemblyAccessPolicyId(world, itemId);
  return deriveObjectID(
    address(world.objectRegistryId, "Assembly access object registry"),
    `${address(world.typeOrigin, "Assembly access type origin")}::assembly_access::AssemblyAccessGrantKey`,
    GrantKey.serialize({ policy_id: policyId, grant_id: Array.from(uuidBytes(grantId)) }).toBytes(),
  );
}

export function parseSuiAssemblyAccessPolicyObject(
  object: any,
  world: SuiAssemblyAccessWorld,
  itemId: unknown,
): SuiAssemblyAccessPolicyState {
  const expectedId = deriveSuiAssemblyAccessPolicyId(world, itemId);
  const parsed = moveObject(
    object,
    `${address(world.typeOrigin, "Assembly access type origin")}::assembly_access::AssemblyAccessPolicy`,
    "Assembly access policy",
  );
  const state = {
    objectId: parsed.objectId,
    registryId: objectId(parsed.fields.registry_id, "Access policy registry"),
    assemblyId: objectId(parsed.fields.assembly_id, "Access policy assembly"),
    ownerCapId: objectId(parsed.fields.owner_cap_id, "Access policy owner cap"),
    revision: u64(parsed.fields.revision, "Access policy revision", true).toString(),
  };
  if (state.objectId !== expectedId ||
      state.registryId !== address(world.objectRegistryId, "Assembly access object registry") ||
      state.assemblyId !== deriveSuiAssemblyObjectId(world, itemId)) {
    throw new Error("Assembly access policy identity does not match the synchronized world");
  }
  return state;
}

export function parseSuiAssemblyAccessGrantObject(
  object: any,
  world: SuiAssemblyAccessWorld,
  itemId?: unknown,
  requestedGrantId?: unknown,
): SuiAssemblyAccessGrantState {
  const parsed = moveObject(
    object,
    `${address(world.typeOrigin, "Assembly access type origin")}::assembly_access::AssemblyAccessGrant`,
    "Assembly access grant",
  );
  const grantId = bytesUuid(parsed.fields.grant_id);
  const assemblyId = objectId(parsed.fields.assembly_id, "Access grant assembly");
  const policyId = objectId(parsed.fields.policy_id, "Access grant policy");
  const registryId = objectId(parsed.fields.registry_id, "Access grant registry");
  const mask = u64(parsed.fields.capabilities, "Access grant capability mask", true);
  const state: SuiAssemblyAccessGrantState = {
    objectId: parsed.objectId,
    registryId,
    policyId,
    assemblyId,
    grantId,
    recipient: principalFromFields(parsed.fields.recipient_kind, parsed.fields.recipient_id),
    capabilities: suiAssemblyAccessCapabilities(mask),
    capabilityMask: mask.toString(),
    grantor: principalFromFields(parsed.fields.grantor_kind, parsed.fields.grantor_id, true),
    parentGrantId: optionId(parsed.fields.parent_grant_id),
    expiresAtMs: u64(parsed.fields.expires_at_ms, "Access grant expiry", true).toString(),
    delegable: parsed.fields.delegable === true,
    delegationDepth: Number(parsed.fields.delegation_depth),
    revision: u64(parsed.fields.revision, "Access grant revision", true).toString(),
    policyRevision: u64(parsed.fields.policy_revision, "Access grant policy revision", true).toString(),
    revoked: parsed.fields.revoked === true,
  };
  if (registryId !== address(world.objectRegistryId, "Assembly access object registry") ||
      !Number.isInteger(state.delegationDepth) || state.delegationDepth < 0 || state.delegationDepth > 255 ||
      typeof parsed.fields.revoked !== "boolean" || typeof parsed.fields.delegable !== "boolean") {
    throw new Error("Assembly access grant fields are invalid");
  }
  if (itemId !== undefined) {
    const expectedPolicy = deriveSuiAssemblyAccessPolicyId(world, itemId);
    const expectedAssembly = deriveSuiAssemblyObjectId(world, itemId);
    const expectedGrant = deriveSuiAssemblyAccessGrantId(world, itemId, grantId);
    if (policyId !== expectedPolicy || assemblyId !== expectedAssembly || parsed.objectId !== expectedGrant) {
      throw new Error("Assembly access grant identity does not match the requested assembly");
    }
  }
  if (requestedGrantId !== undefined && grantId !== bytesUuid(Array.from(uuidBytes(requestedGrantId)))) {
    throw new Error("Assembly access grant ID does not match the requested grant");
  }
  return state;
}

async function getObject(client: Pick<SuiJsonRpcClient, "getObject">, id: string): Promise<any> {
  const response = await client.getObject({ id, options: { showContent: true, showOwner: true, showType: true } });
  if (response?.error || !response?.data) throw new Error(`Sui object ${id} is unavailable`);
  return response;
}

/**
 * Build the verifier injected into assemblyAccessRuntime.
 *
 * Client-supplied proof IDs are only consistency hints. Policy, assembly, and
 * grant IDs are derived from the synchronized registry/type origin and every
 * ancestor is fetched from current shared-object state.
 */
export function createSuiAssemblyAccessGrantVerifier(options: {
  client: Pick<SuiJsonRpcClient, "getObject">;
  world: SuiAssemblyAccessWorld;
  now?: () => number;
}) {
  const now = options.now ?? Date.now;
  return async (localGrant: any, proof: any): Promise<boolean> => {
    try {
      const itemId = u64(localGrant?.assemblyID, "Local access assembly ID", true).toString();
      const expectedPolicyId = deriveSuiAssemblyAccessPolicyId(options.world, itemId);
      const expectedGrantId = deriveSuiAssemblyAccessGrantId(options.world, itemId, localGrant?.grantID);
      if (proof?.policyObjectId && address(proof.policyObjectId, "Proof policy") !== expectedPolicyId) return false;
      if (proof?.grantObjectId && address(proof.grantObjectId, "Proof grant") !== expectedGrantId) return false;
      const [policyObject, grantObject] = await Promise.all([
        getObject(options.client, expectedPolicyId),
        getObject(options.client, expectedGrantId),
      ]);
      const policy = parseSuiAssemblyAccessPolicyObject(policyObject, options.world, itemId);
      const grant = parseSuiAssemblyAccessGrantObject(grantObject, options.world, itemId, localGrant.grantID);
      const recipient = normalizeSuiAssemblyAccessPrincipal(localGrant.recipientPrincipal);
      const grantor = normalizeSuiAssemblyAccessPrincipal(localGrant.grantorPrincipal);
      const capabilities = [...localGrant.capabilities].map(String).sort();
      const expectedParent = localGrant.parentGrantID
        ? deriveSuiAssemblyAccessGrantId(options.world, itemId, localGrant.parentGrantID) : null;
      if (policy.objectId !== grant.policyId || grant.recipient.canonical !== recipient.canonical ||
          grant.grantor.canonical !== grantor.canonical ||
          JSON.stringify(grant.capabilities.slice().sort()) !== JSON.stringify(capabilities) ||
          grant.expiresAtMs !== u64(localGrant.expiresAtMs, "Local access expiry", true).toString() ||
          grant.delegable !== (localGrant.delegable === true) ||
          grant.delegationDepth !== Number(localGrant.delegationDepth) ||
          grant.parentGrantId !== expectedParent || grant.revoked || BigInt(grant.expiresAtMs) <= BigInt(now())) {
        return false;
      }
      if ((BigInt(grant.capabilityMask) & CUSTODY_CAPABILITIES) !== 0n && grant.parentGrantId) return false;

      let child = grant;
      const seen = new Set<string>();
      while (child.parentGrantId) {
        if (seen.has(child.parentGrantId) || seen.size >= 8) return false;
        seen.add(child.parentGrantId);
        const parentObject = await getObject(options.client, child.parentGrantId);
        const parent = parseSuiAssemblyAccessGrantObject(parentObject, options.world, itemId);
        const childMask = BigInt(child.capabilityMask);
        const parentMask = BigInt(parent.capabilityMask);
        if (parent.revoked || BigInt(parent.expiresAtMs) <= BigInt(now()) || !parent.delegable ||
            parent.delegationDepth <= child.delegationDepth ||
            (parentMask & BigInt(SUI_ASSEMBLY_ACCESS_CAPABILITY.manage_access)) === 0n ||
            (parentMask & childMask) !== childMask || BigInt(parent.expiresAtMs) < BigInt(child.expiresAtMs)) {
          return false;
        }
        child = parent;
      }
      return true;
    } catch {
      return false;
    }
  };
}

function target(world: SuiAssemblyAccessWorld, fun: string): `${string}::${string}::${string}` {
  return `${address(world.packageId, "Assembly access package")}::assembly_access::${fun}`;
}

export function addSuiAssemblyAccessCreatePolicyCall(input: {
  tx: Transaction;
  world: SuiAssemblyAccessWorld;
  assemblyType: string;
  assemblyObjectId: string;
  ownerCap: TransactionArgument;
}): void {
  input.tx.moveCall({
    target: target(input.world, "create_policy"),
    typeArguments: [input.assemblyType],
    arguments: [
      input.tx.object(address(input.world.objectRegistryId, "Assembly access object registry")),
      input.tx.pure.address(address(input.assemblyObjectId, "Assembly object")),
      input.ownerCap,
    ],
  });
}

export function addSuiAssemblyAccessOwnerGrantCall(input: {
  tx: Transaction;
  world: SuiAssemblyAccessWorld;
  assemblyType: string;
  policyObjectId: string;
  ownerCap: TransactionArgument;
  grantId: string;
  recipientPrincipal: string;
  grantorPrincipal: string;
  capabilities: string[];
  expiresAtMs: unknown;
  delegable?: boolean;
  delegationDepth?: number;
}): void {
  const recipient = normalizeSuiAssemblyAccessPrincipal(input.recipientPrincipal);
  const grantor = normalizeSuiAssemblyAccessPrincipal(input.grantorPrincipal);
  const mask = suiAssemblyAccessCapabilityMask(input.capabilities);
  const depth = Number(input.delegationDepth ?? 0);
  if (!Number.isInteger(depth) || depth < 0 || depth > 8 || (input.delegable === true) !== (depth > 0)) {
    throw new Error("Assembly access delegation depth is invalid");
  }
  input.tx.moveCall({
    target: target(input.world, "grant_by_owner"),
    typeArguments: [input.assemblyType],
    arguments: [
      input.tx.object(address(input.world.objectRegistryId, "Assembly access object registry")),
      input.tx.object(address(input.policyObjectId, "Assembly access policy")),
      input.ownerCap,
      input.tx.pure.vector("u8", Array.from(uuidBytes(input.grantId))),
      input.tx.pure.u8(recipient.kind),
      input.tx.pure.string(recipient.id),
      input.tx.pure.u64(mask),
      input.tx.pure.u8(grantor.kind),
      input.tx.pure.string(grantor.id),
      input.tx.pure.u64(u64(input.expiresAtMs, "Assembly access expiry", true)),
      input.tx.pure.bool(input.delegable === true),
      input.tx.pure.u8(depth),
      input.tx.object(SUI_CLOCK_OBJECT_ID),
    ],
  });
}

export function addSuiAssemblyAccessBindStorageCall(input: {
  tx: Transaction;
  world: SuiAssemblyAccessWorld;
  policyObjectId: string;
  storageObjectId: string;
  ownerCap: TransactionArgument;
}): void {
  input.tx.moveCall({
    target: target(input.world, "bind_storage_unit"),
    arguments: [
      input.tx.object(address(input.policyObjectId, "Assembly access policy")),
      input.tx.object(address(input.storageObjectId, "Storage Unit")),
      input.ownerCap,
    ],
  });
}

export function addSuiAssemblyAccessOwnerRevokeCall(input: {
  tx: Transaction;
  world: SuiAssemblyAccessWorld;
  assemblyType: string;
  policyObjectId: string;
  grantObjectId: string;
  ownerCap: TransactionArgument;
  expectedPolicyRevision: unknown;
  expectedGrantRevision: unknown;
}): void {
  input.tx.moveCall({
    target: target(input.world, "revoke_by_owner"),
    typeArguments: [input.assemblyType],
    arguments: [
      input.tx.object(address(input.policyObjectId, "Assembly access policy")),
      input.tx.object(address(input.grantObjectId, "Assembly access grant")),
      input.ownerCap,
      input.tx.pure.u64(u64(input.expectedPolicyRevision, "Access policy revision", true)),
      input.tx.pure.u64(u64(input.expectedGrantRevision, "Access grant revision", true)),
    ],
  });
}

export function createSuiAssemblyAccessCharacterDelegationTransaction(input: {
  world: SuiAssemblyAccessWorld;
  policyObjectId: string;
  parentGrantObjectId: string;
  characterObjectId: string;
  grantId: string;
  recipientPrincipal: string;
  capabilities: string[];
  expiresAtMs: unknown;
  delegable?: boolean;
  delegationDepth?: number;
}): Transaction {
  const recipient = normalizeSuiAssemblyAccessPrincipal(input.recipientPrincipal);
  const mask = suiAssemblyAccessCapabilityMask(input.capabilities);
  if ((mask & CUSTODY_CAPABILITIES) !== 0n) throw new Error("Custody capabilities cannot be delegated");
  const depth = Number(input.delegationDepth ?? 0);
  if (!Number.isInteger(depth) || depth < 0 || depth > 8 || (input.delegable === true) !== (depth > 0)) {
    throw new Error("Assembly access delegation depth is invalid");
  }
  const tx = new Transaction();
  tx.moveCall({
    target: target(input.world, "delegate_by_character"),
    arguments: [
      tx.object(address(input.world.objectRegistryId, "Assembly access object registry")),
      tx.object(address(input.policyObjectId, "Assembly access policy")),
      tx.object(address(input.parentGrantObjectId, "Parent access grant")),
      tx.object(address(input.characterObjectId, "Delegating Character")),
      tx.pure.vector("u8", Array.from(uuidBytes(input.grantId))),
      tx.pure.u8(recipient.kind),
      tx.pure.string(recipient.id),
      tx.pure.u64(mask),
      tx.pure.u64(u64(input.expiresAtMs, "Assembly access expiry", true)),
      tx.pure.bool(input.delegable === true),
      tx.pure.u8(depth),
      tx.object(SUI_CLOCK_OBJECT_ID),
    ],
  });
  return tx;
}

export function createSuiAssemblyAccessNpcDelegationTransaction(input: {
  world: SuiAssemblyAccessWorld;
  policyObjectId: string;
  parentGrantObjectId: string;
  npcProfileObjectId: string;
  grantId: string;
  recipientPrincipal: string;
  capabilities: string[];
  expiresAtMs: unknown;
  delegable?: boolean;
  delegationDepth?: number;
}): Transaction {
  const recipient = normalizeSuiAssemblyAccessPrincipal(input.recipientPrincipal);
  const mask = suiAssemblyAccessCapabilityMask(input.capabilities);
  if ((mask & CUSTODY_CAPABILITIES) !== 0n) throw new Error("Custody capabilities cannot be delegated");
  const depth = Number(input.delegationDepth ?? 0);
  if (!Number.isInteger(depth) || depth < 0 || depth > 8 || (input.delegable === true) !== (depth > 0)) {
    throw new Error("Assembly access delegation depth is invalid");
  }
  const tx = new Transaction();
  tx.moveCall({
    target: target(input.world, "delegate_by_npc"),
    arguments: [
      tx.object(address(input.world.objectRegistryId, "Assembly access object registry")),
      tx.object(address(input.policyObjectId, "Assembly access policy")),
      tx.object(address(input.parentGrantObjectId, "Parent access grant")),
      tx.object(address(input.npcProfileObjectId, "Delegating NPC profile")),
      tx.pure.vector("u8", Array.from(uuidBytes(input.grantId))),
      tx.pure.u8(recipient.kind),
      tx.pure.string(recipient.id),
      tx.pure.u64(mask),
      tx.pure.u64(u64(input.expiresAtMs, "Assembly access expiry", true)),
      tx.pure.bool(input.delegable === true),
      tx.pure.u8(depth),
      tx.object(SUI_CLOCK_OBJECT_ID),
    ],
  });
  return tx;
}

export function createSuiAssemblyAccessCharacterRevokeTransaction(input: {
  world: SuiAssemblyAccessWorld;
  policyObjectId: string;
  grantObjectId: string;
  characterObjectId: string;
  expectedPolicyRevision: unknown;
  expectedGrantRevision: unknown;
}): Transaction {
  const tx = new Transaction();
  tx.moveCall({
    target: target(input.world, "revoke_by_character"),
    arguments: [
      tx.object(address(input.policyObjectId, "Assembly access policy")),
      tx.object(address(input.grantObjectId, "Assembly access grant")),
      tx.object(address(input.characterObjectId, "Revoking Character")),
      tx.pure.u64(u64(input.expectedPolicyRevision, "Access policy revision", true)),
      tx.pure.u64(u64(input.expectedGrantRevision, "Access grant revision", true)),
    ],
  });
  return tx;
}

export function createSuiAssemblyAccessNpcRevokeTransaction(input: {
  world: SuiAssemblyAccessWorld;
  policyObjectId: string;
  grantObjectId: string;
  npcProfileObjectId: string;
  expectedPolicyRevision: unknown;
  expectedGrantRevision: unknown;
}): Transaction {
  const tx = new Transaction();
  tx.moveCall({
    target: target(input.world, "revoke_by_npc"),
    arguments: [
      tx.object(address(input.policyObjectId, "Assembly access policy")),
      tx.object(address(input.grantObjectId, "Assembly access grant")),
      tx.object(address(input.npcProfileObjectId, "Revoking NPC profile")),
      tx.pure.u64(u64(input.expectedPolicyRevision, "Access policy revision", true)),
      tx.pure.u64(u64(input.expectedGrantRevision, "Access grant revision", true)),
    ],
  });
  return tx;
}

export function createSuiAssemblyCrossOwnerTransferTransaction(input: {
  world: SuiAssemblyAccessWorld;
  sourcePolicyObjectId: string;
  sourceGrantObjectId: string;
  sourceStorageObjectId: string;
  destinationPolicyObjectId: string;
  destinationGrantObjectId: string;
  destinationStorageObjectId: string;
  characterObjectId: string;
  npcProfileObjectId?: string;
  operationId: string;
  typeId: unknown;
  quantity: number;
}): Transaction {
  if (!Number.isInteger(input.quantity) || input.quantity <= 0 || input.quantity > 0xffff_ffff) {
    throw new Error("Cross-owner transfer quantity must be a positive u32");
  }
  const tx = new Transaction();
  const arguments_ = [
      tx.object(address(input.sourcePolicyObjectId, "Source access policy")),
      tx.object(address(input.sourceGrantObjectId, "Source withdraw grant")),
      tx.object(address(input.sourceStorageObjectId, "Source Storage Unit")),
      tx.object(address(input.destinationPolicyObjectId, "Destination access policy")),
      tx.object(address(input.destinationGrantObjectId, "Destination deposit grant")),
      tx.object(address(input.destinationStorageObjectId, "Destination Storage Unit")),
      tx.object(address(input.characterObjectId, "Transfer Character")),
      ...(input.npcProfileObjectId
        ? [tx.object(address(input.npcProfileObjectId, "Transfer NPC profile"))] : []),
      tx.pure.vector("u8", Array.from(uuidBytes(input.operationId))),
      tx.pure.u64(u64(input.typeId, "Transfer item type", true)),
      tx.pure.u32(input.quantity),
      tx.object(SUI_CLOCK_OBJECT_ID),
    ];
  tx.moveCall({
    target: target(input.world, input.npcProfileObjectId
      ? "move_open_between_storage_units_by_npc" : "move_open_between_storage_units"),
    arguments: arguments_,
  });
  return tx;
}

export function addSuiAssemblyOwnedToOpenTransferCall(input: {
  tx: Transaction;
  world: SuiAssemblyAccessWorld;
  policyObjectId: string;
  grantObjectId: string;
  storageObjectId: string;
  characterObjectId: string;
  npcProfileObjectId?: string;
  ownerCap: TransactionArgument;
  operationId: string;
  typeId: unknown;
  quantity: number;
}): void {
  if (!Number.isInteger(input.quantity) || input.quantity <= 0 || input.quantity > 0xffff_ffff) {
    throw new Error("Cross-owner transfer quantity must be a positive u32");
  }
  input.tx.moveCall({
    target: target(input.world, input.npcProfileObjectId
      ? "move_owned_to_open_by_npc" : "move_owned_to_open"),
    typeArguments: [`${address(input.world.worldPackageId, "World package")}::character::Character`],
    arguments: [
      input.tx.object(address(input.policyObjectId, "Assembly access policy")),
      input.tx.object(address(input.grantObjectId, "Assembly deposit grant")),
      input.tx.object(address(input.storageObjectId, "Storage Unit")),
      input.tx.object(address(input.characterObjectId, "Transfer Character")),
      ...(input.npcProfileObjectId
        ? [input.tx.object(address(input.npcProfileObjectId, "Transfer NPC profile"))] : []),
      input.ownerCap,
      input.tx.pure.vector("u8", Array.from(uuidBytes(input.operationId))),
      input.tx.pure.u64(u64(input.typeId, "Transfer item type", true)),
      input.tx.pure.u32(input.quantity),
      input.tx.object(SUI_CLOCK_OBJECT_ID),
    ],
  });
}

export function createSuiAssemblyOpenToOwnedTransferTransaction(input: {
  world: SuiAssemblyAccessWorld;
  policyObjectId: string;
  grantObjectId: string;
  storageObjectId: string;
  characterObjectId: string;
  npcProfileObjectId?: string;
  operationId: string;
  typeId: unknown;
  quantity: number;
}): Transaction {
  if (!Number.isInteger(input.quantity) || input.quantity <= 0 || input.quantity > 0xffff_ffff) {
    throw new Error("Cross-owner transfer quantity must be a positive u32");
  }
  const tx = new Transaction();
  tx.moveCall({
    target: target(input.world, input.npcProfileObjectId
      ? "move_open_to_owned_by_npc" : "move_open_to_owned"),
    arguments: [
      tx.object(address(input.policyObjectId, "Assembly access policy")),
      tx.object(address(input.grantObjectId, "Assembly withdraw grant")),
      tx.object(address(input.storageObjectId, "Storage Unit")),
      tx.object(address(input.characterObjectId, "Transfer Character")),
      ...(input.npcProfileObjectId
        ? [tx.object(address(input.npcProfileObjectId, "Transfer NPC profile"))] : []),
      tx.pure.vector("u8", Array.from(uuidBytes(input.operationId))),
      tx.pure.u64(u64(input.typeId, "Transfer item type", true)),
      tx.pure.u32(input.quantity),
      tx.object(SUI_CLOCK_OBJECT_ID),
    ],
  });
  return tx;
}

export type SuiAssemblyCustodyProof = {
  digest: string;
  operationId: string;
  custodyKind: 1 | 2 | 3;
  sourceAssemblyItemId: string | number;
  destinationAssemblyItemId: string | number;
  actorCharacterId: string | number;
  typeId: string | number;
  quantity: number;
};

/** Verify the finalized custody event before committing the matching game item move. */
export async function verifySuiAssemblyCustodyProof(input: {
  client: { getTransactionBlock(request: any): Promise<any> };
  world: SuiAssemblyAccessWorld;
  proof: SuiAssemblyCustodyProof;
}): Promise<boolean> {
  try {
    if (!input.proof || typeof input.proof.digest !== "string" ||
        input.proof.digest.length < 32 || input.proof.digest.length > 128 ||
        ![1, 2, 3].includes(input.proof.custodyKind) ||
        !Number.isInteger(input.proof.quantity) || input.proof.quantity <= 0 ||
        input.proof.quantity > 0xffff_ffff) return false;
    const response = await input.client.getTransactionBlock({
      digest: input.proof.digest,
      options: { showEffects: true, showEvents: true },
    });
    if (response?.effects?.status?.status !== "success") return false;
    const eventType = `${address(input.world.typeOrigin, "Assembly access type origin")}::assembly_access::AssemblyCustodyTransferred`;
    const operationId = bytesUuid(Array.from(uuidBytes(input.proof.operationId)));
    const expectedSource = deriveSuiAssemblyObjectId(input.world, input.proof.sourceAssemblyItemId);
    const expectedDestination = deriveSuiAssemblyObjectId(input.world, input.proof.destinationAssemblyItemId);
    const expectedActor = deriveSuiAssemblyObjectId(input.world, input.proof.actorCharacterId);
    return (response.events || []).some((event: any) => {
      if (event?.type !== eventType) return false;
      const fields = event.parsedJson ?? event.parsed_json ?? {};
      try {
        return bytesUuid(fields.operation_id) === operationId &&
          Number(fields.custody_kind) === input.proof.custodyKind &&
          objectId(fields.source_assembly_id, "Custody source") === expectedSource &&
          objectId(fields.destination_assembly_id, "Custody destination") === expectedDestination &&
          objectId(fields.actor_character_id, "Custody actor") === expectedActor &&
          u64(fields.type_id, "Custody type", true) === u64(input.proof.typeId, "Expected custody type", true) &&
          Number(fields.quantity) === input.proof.quantity;
      } catch { return false; }
    });
  } catch {
    return false;
  }
}
