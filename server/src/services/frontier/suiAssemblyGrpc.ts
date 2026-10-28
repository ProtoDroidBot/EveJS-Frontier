import { bcs } from "@mysten/sui/bcs";
import { ObjectError, type SuiClientTypes } from "@mysten/sui/client";
import type { SuiGrpcClient } from "@mysten/sui/grpc";
import { deriveDynamicFieldID, normalizeStructTag } from "@mysten/sui/utils";

export type AssemblyReadClient = Pick<SuiGrpcClient, "getObject" | "getDynamicField">;
export type AssemblyMoveObject = SuiClientTypes.Object<{ json: true }> & { json: Record<string, any> };

export function isMissingSuiObject(error: unknown): error is ObjectError {
  return error instanceof ObjectError && error.reason === "notFound";
}

export function assemblyMoveBytes(value: unknown): Uint8Array {
  if (typeof value === "string" && /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
    return Uint8Array.from(Buffer.from(value, "base64"));
  }
  if (Array.isArray(value) && value.every(byte => Number.isInteger(byte) && byte >= 0 && byte <= 255)) {
    return Uint8Array.from(value);
  }
  throw new Error("Invalid Move byte vector");
}

/** Transport failures and deleted objects must never be mistaken for absent state. */
export async function readAssemblyMoveObject(
  client: Pick<SuiGrpcClient, "getObject">, objectId: string, allowMissing = false,
): Promise<AssemblyMoveObject | null> {
  try {
    const { object } = await client.getObject({ objectId, include: { json: true } });
    if (!object?.json || typeof object.json !== "object" || Array.isArray(object.json)) {
      throw new Error(`Missing Move object content for ${objectId}`);
    }
    return object as AssemblyMoveObject;
  } catch (error) {
    if (allowMissing && isMissingSuiObject(error)) return null;
    throw error;
  }
}

/** A deleted derived UID remains permanently claimed in its parent registry. */
export async function assertUnclaimedAssemblyObject(
  client: Pick<SuiGrpcClient, "getObject">, registryId: string, objectId: string,
): Promise<void> {
  const markerId = deriveDynamicFieldID(registryId, "0x2::derived_object::Claimed", bcs.Address.serialize(objectId).toBytes());
  if (await readAssemblyMoveObject(client, markerId, true)) {
    throw Object.assign(new Error(`Assembly ${objectId} was previously unanchored; its derived item ID cannot be reused`),
      { code: "CHAIN_ASSEMBLY_TOMBSTONE" });
  }
}

export function assemblyDynamicFieldName(type: string, value: string): SuiClientTypes.DynamicFieldName {
  const codec = type === "u64" ? bcs.u64() : type === "address" || normalizeStructTag(type) === normalizeStructTag("0x2::object::ID")
    ? bcs.Address : null;
  if (!codec) throw new Error(`Unsupported assembly dynamic field key ${type}`);
  return { type, bcs: codec.serialize(value).toBytes() };
}

/** Resolve the native field reference, then request the field's decoded Move JSON. */
export async function readAssemblyDynamicField(
  client: AssemblyReadClient, parentId: string, name: SuiClientTypes.DynamicFieldName, allowMissing = false,
): Promise<AssemblyMoveObject | null> {
  try {
    const { dynamicField } = await client.getDynamicField({ parentId, name });
    return await readAssemblyMoveObject(client, dynamicField.fieldId, allowMissing);
  } catch (error) {
    if (allowMissing && isMissingSuiObject(error)) return null;
    throw error;
  }
}
