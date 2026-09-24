import assert from "node:assert/strict";
import test from "node:test";

const { createSmartFactionTaskApi } = require("../src/_secondary/express/smartFactionTaskEndpoints");
const transponders = require("../src/services/frontier/suiTransponderCommitment");

const id = (digit: string) => `0x${digit.repeat(64)}`;
const world = {
  packageId: id("1"), typeOrigin: id("1"), transponderRegistryId: id("2"),
  objectRegistryId: id("3"), tenant: "dev",
};
const factionKey = "500001-caldari";
const code = "CALDARI:SHARED";
const salt = "ab".repeat(32);
const scope = { kind: "faction", factionKey };
const objectID = transponders.deriveSuiTransponderCommitmentObjectId(world, scope);
const commitment = transponders.computeSuiTransponderCommitment({
  objectRegistryId: world.objectRegistryId, tenant: world.tenant,
  scope, revision: 1, code, salt,
}).commitment;

function fixture() {
  const items = new Map<number, any>([
    [100, { itemID: 100, typeID: 88092 }],
    [200, { itemID: 200, typeID: 88086 }],
    [300, { itemID: 300, typeID: 88086 }],
  ]);
  const metadata = new Map<number, any>([
    [100, { factionKey, registeredForFaction: true }],
    [200, { factionKey, registeredForFaction: true, commandNodeID: 100 }],
    [300, { factionKey: "500010-guristas", registeredForFaction: true, commandNodeID: 100 }],
  ]);
  const chainObject = {
    objectId: objectID,
    type: `${world.typeOrigin}::transponder::TransponderCommitment`,
    owner: { Shared: { initial_shared_version: "1" } },
    content: { fields: {
      registry_id: world.objectRegistryId, tenant: world.tenant,
      scope_kind: 2, scope_id: factionKey, authority: id("4"),
      hash_scheme: 1, commitment: Array.from(commitment), revision: "1", revoked: false,
    } },
  };
  let reads = 0;
  let writes = 0;
  let persisted: any;
  let sessionValid = true;
  const api = createSmartFactionTaskApi({
    auth: {
      authenticate: () => sessionValid
        ? { success: true, data: { characterID: 42, walletAddress: id("5") } }
        : { success: false, errorMsg: "AUTH_EXPIRED" },
    },
    dependencies: {
      item: (itemID: number) => items.get(itemID),
      metadata: (item: any) => item && metadata.get(item.itemID),
      world: () => world,
      client: { async getObject({ objectId }: any) {
        reads++;
        assert.equal(objectId, objectID);
        return { object: chainObject };
      } },
      requests: { async createRequest(sourceID: number, targetID: number, requestType: string, options: any) {
        writes++;
        persisted = { sourceID, targetID, requestType, options };
        return { success: true, created: true, data: { requestID: options.requestID, status: "queued" } };
      } },
    },
  });
  return { api, metadata, chainObject, get reads() { return reads; }, get writes() { return writes; },
    get persisted() { return persisted; }, expire() { sessionValid = false; } };
}

test("only a fresh correct faction transponder can submit from its registered node", async () => {
  const f = fixture();
  const wrong = await f.api.verify("Bearer token", 100, { code: "wrong", salt });
  assert.equal(wrong.errorMsg, "TRANSPONDER_CODE_INVALID");
  assert.equal((await f.api.verify("Bearer token", 100, { code, salt: "cd".repeat(32) })).errorMsg,
    "TRANSPONDER_CODE_INVALID");
  assert.equal(f.writes, 0);
  const verified = await f.api.verify("Bearer token", 100, { code, salt });
  assert.equal(verified.success, true);
  assert.equal(verified.data.factionKey, factionKey);
  assert.equal(JSON.stringify(verified).includes(code), false);
  assert.equal(JSON.stringify(verified).includes(salt), false);
  const requestID = "123e4567-e89b-42d3-a456-426614174000";
  const submitted = await f.api.submit("Bearer token", 100, {
    targetAssemblyID: 200, requestType: "maintenance.inspect",
    requestID, code, salt,
  });
  assert.equal(submitted.success, true);
  assert.equal(f.reads, 4, "submission reads the commitment again");
  assert.equal(f.writes, 1);
  assert.equal(f.persisted.sourceID, 100);
  assert.equal(f.persisted.targetID, 200);
  assert.equal(f.persisted.options.payload.membership.commitmentID, objectID);
  assert.equal(JSON.stringify(f.persisted).includes(code), false);
  assert.equal(JSON.stringify(f.persisted).includes(salt), false);
});

test("revocation, foreign targets, and missing registration fail closed", async () => {
  const f = fixture();
  const input = { targetAssemblyID: 200, requestType: "maintenance.inspect",
    requestID: "123e4567-e89b-42d3-a456-426614174000", code, salt };
  assert.equal((await f.api.submit("Bearer token", 100, { ...input, targetAssemblyID: 300 })).errorMsg,
    "FACTION_TARGET_DENIED");
  f.chainObject.content.fields.revoked = true;
  f.chainObject.content.fields.commitment = [];
  assert.equal((await f.api.submit("Bearer token", 100, input)).errorMsg,
    "TRANSPONDER_CODE_INVALID");
  f.chainObject.content.fields.revoked = false;
  f.chainObject.content.fields.commitment = Array.from(commitment);
  f.chainObject.content.fields.revision = "2";
  assert.equal((await f.api.submit("Bearer token", 100, input)).errorMsg,
    "TRANSPONDER_CODE_INVALID");
  f.chainObject.content.fields.revision = "1";
  f.chainObject.owner = { AddressOwner: id("4") } as any;
  assert.equal((await f.api.submit("Bearer token", 100, input)).errorMsg,
    "TRANSPONDER_VERIFICATION_UNAVAILABLE");
  f.chainObject.owner = { Shared: { initial_shared_version: "1" } } as any;
  f.metadata.get(100).registeredForFaction = false;
  assert.equal((await f.api.submit("Bearer token", 100, input)).errorMsg,
    "FACTION_COMMAND_NODE_UNAVAILABLE");
  assert.equal(f.writes, 0);
});

test("invalid task types and expired wallet sessions cannot create requests", async () => {
  const f = fixture();
  const input = { targetAssemblyID: 200, requestID: "123e4567-e89b-42d3-a456-426614174000", code, salt };
  assert.equal((await f.api.submit("Bearer token", 100, { ...input, requestType: "admin.execute" })).errorMsg,
    "FACTION_TASK_TYPE_INVALID");
  f.expire();
  assert.equal((await f.api.submit("Bearer token", 100, { ...input, requestType: "maintenance.inspect" })).errorMsg,
    "AUTH_EXPIRED");
  assert.equal(f.reads, 0);
  assert.equal(f.writes, 0);
});
