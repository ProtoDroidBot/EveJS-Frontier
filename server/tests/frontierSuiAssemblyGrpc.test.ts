import assert from "node:assert/strict";
import test from "node:test";
import { bcs } from "@mysten/sui/bcs";
import { ObjectError } from "@mysten/sui/client";
import { deriveDynamicFieldID, normalizeSuiAddress } from "@mysten/sui/utils";
import { createSuiAssemblyChain } from "../src/services/frontier/suiAssemblyChain";
import {
  assemblyDynamicFieldName, assemblyMoveBytes, readAssemblyDynamicField, readAssemblyMoveObject,
} from "../src/services/frontier/suiAssemblyGrpc";

const id = (value: string) => normalizeSuiAddress(value);
const absent = () => new ObjectError("notExists", "Object not found", { reason: "notFound" });

test("optional native reads distinguish typed absence from deletion and transport failure", async () => {
  const missing: any = { getObject: async () => { throw absent(); } };
  assert.equal(await readAssemblyMoveObject(missing, id("0x1"), true), null);
  await assert.rejects(readAssemblyMoveObject(missing, id("0x1")), ObjectError);
  for (const error of [new ObjectError("deleted", "Deleted", { reason: "deleted" }),
    new ObjectError("UNAVAILABLE", "Unavailable", { reason: "unknown" }), new Error("Object not found")]) {
    await assert.rejects(readAssemblyMoveObject({ getObject: async () => { throw error; } } as any,
      id("0x1"), true), actual => actual === error);
  }
});

test("dynamic field reads use BCS names and native JSON without interpreting a transport failure as missing", async () => {
  const name = assemblyDynamicFieldName("u64", "9007199254740993");
  assert.equal(bcs.u64().parse(name.bcs), "9007199254740993");
  const fieldId = id("0x2");
  const client: any = {
    async getDynamicField(input: any) {
      assert.deepEqual(input, { parentId: id("0x1"), name });
      return { dynamicField: { fieldId } };
    },
    async getObject(input: any) {
      assert.deepEqual(input, { objectId: fieldId, include: { json: true } });
      return { object: { objectId: fieldId, json: { name: "9007199254740993", value: "7" } } };
    },
  };
  assert.equal((await readAssemblyDynamicField(client, id("0x1"), name))!.json.value, "7");
  const outage = new Error("deadline exceeded");
  client.getDynamicField = async () => { throw outage; };
  await assert.rejects(readAssemblyDynamicField(client, id("0x1"), name, true), actual => actual === outage);
});

test("native NOT_FOUND on an already claimed assembly refuses to reuse its derived UID", async () => {
  const registryId = id("0x11"), objectId = id("0x22");
  const markerId = deriveDynamicFieldID(registryId, "0x2::derived_object::Claimed", bcs.Address.serialize(objectId).toBytes());
  let claimed = true;
  let lookupError: Error | null = null;
  let executions = 0;
  const client: any = { async getObject(input: any) {
    if (input.objectId === objectId) throw absent();
    assert.equal(input.objectId, markerId);
    if (lookupError) throw lookupError;
    if (!claimed) throw absent();
    return { object: { objectId: markerId, json: { value: { "@variant": "Reserved" } } } };
  } };
  const chain = createSuiAssemblyChain({ client, tenant: "dev", world: {
    packageId: id("0x1"), objectRegistryId: registryId, adminAclId: id("0x2"),
    energyConfigId: id("0x3"), fuelConfigId: id("0x4"),
  }, execute: async () => { executions++; } });
  await assert.rejects(chain.readObject(objectId), (error: any) => error.code === "CHAIN_ASSEMBLY_TOMBSTONE");
  claimed = false;
  assert.equal(await chain.readObject(objectId), null);
  lookupError = new Error("registry unavailable");
  await assert.rejects(chain.readObject(objectId), actual => actual === lookupError);
  assert.equal(executions, 0);
});

test("native Move byte vectors accept base64 while rejecting malformed bytes", () => {
  assert.deepEqual([...assemblyMoveBytes("AP9/")], [0, 255, 127]);
  assert.deepEqual([...assemblyMoveBytes([0, 255, 127])], [0, 255, 127]);
  for (const value of ["not base64", [256], [-1], [1.5], {}, null]) {
    assert.throws(() => assemblyMoveBytes(value), /Invalid Move byte vector/);
  }
});
