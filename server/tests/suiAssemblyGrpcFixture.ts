import assert = require("node:assert/strict");
import { bcs } from "@mysten/sui/bcs";
import { ObjectError } from "@mysten/sui/client";
import { deriveDynamicFieldID } from "@mysten/sui/utils";

/** Render the reusable contract fixtures as native Move JSON, without parsed-JSON envelopes. */
export function nativeMoveJson(value: any): any {
  if (value == null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(nativeMoveJson);
  if (value.variant) return { "@variant": value.variant };
  if (value.fields) return nativeMoveJson(value.fields);
  if (Array.isArray(value.vec)) return value.vec.length ? nativeMoveJson(value.vec[0]) : null;
  return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key,
    ["location_hash", "action_id", "action_type", "payload", "payload_commitment", "outcome", "receipt_commitment"].includes(key) && Array.isArray(entry)
      ? Buffer.from(entry).toString("base64") : nativeMoveJson(entry)]));
}

/** Fixture callbacks describe records; only native gRPC Core request/response shapes reach the implementation. */
export function createAssemblyGrpcFixture(records: any): any {
  const dynamic = new Map<string, any>();
  function object(result: any, objectId: string) {
    if (result?.error) throw new ObjectError(result.error.code, `Cannot read ${objectId}: ${result.error.code}`, {
      objectId, reason: ["notExists", "dynamicFieldNotFound"].includes(result.error.code) ? "notFound"
        : result.error.code === "deleted" ? "deleted" : "unknown",
    });
    const data = result?.data;
    assert.ok(data, "fixture must return an object or typed lookup failure");
    const { content, ...metadata } = data;
    return { objectId, version: "1", digest: "digest", ...metadata,
      type: data.type || content?.type || "0x2::test::Fixture",
      owner: data.owner ? { $kind: Object.keys(data.owner)[0], ...data.owner } : { $kind: "Shared", Shared: { initialSharedVersion: "1" } },
      json: nativeMoveJson(content?.fields),
    };
  }
  return {
    async getObject(input: any) {
      assert.ok(input.objectId && !("id" in input) && !("options" in input), "native getObject request");
      const result = dynamic.has(input.objectId) ? dynamic.get(input.objectId) : await records.objectRecord({ id: input.objectId });
      return { object: object(result, input.objectId) };
    },
    async getObjects(input: any) {
      assert.ok(Array.isArray(input.objectIds) && !("ids" in input), "native getObjects request");
      const results = await records.objectRecords({ ids: input.objectIds });
      return { objects: results.map((result: any, index: number) => {
        try { return object(result, input.objectIds[index]); } catch (error) { return error; }
      }) };
    },
    async getDynamicField(input: any) {
      assert.ok(input.name.bcs instanceof Uint8Array && !("value" in input.name), "BCS dynamic field key");
      const value = input.name.type === "u64" ? bcs.u64().parse(input.name.bcs) : bcs.Address.parse(input.name.bcs);
      const fieldId = deriveDynamicFieldID(input.parentId, input.name.type, input.name.bcs);
      const result = await records.dynamicRecord({ ...input, name: { type: input.name.type, value } });
      object(result, fieldId); // Native missing fields throw before returning a field reference.
      dynamic.set(fieldId, result);
      return { dynamicField: { fieldId, name: input.name } };
    },
    async listDynamicFields(input: any) {
      const page = await records.dynamicPage(input);
      return { hasNextPage: page.hasNextPage, cursor: page.nextCursor, dynamicFields: page.data.map((entry: any) => ({
        ...entry, name: { type: entry.name.type, bcs: entry.name.type === "u64"
          ? bcs.u64().serialize(entry.name.value).toBytes() : bcs.Address.serialize(entry.name.value).toBytes() },
      })) };
    },
  };
}
