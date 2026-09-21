import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { normalizeSuiAddress } from "@mysten/sui/utils";
import { createSuiAssemblyActionQueueBridge } from "../src/services/frontier/suiAssemblyActionQueue";

const id = (value: string) => normalizeSuiAddress(`0x${value}`);
const actionID = "d7949ad2-56c0-4a98-a970-83b293a4df93";
const actionBytes = Buffer.from(actionID.replaceAll("-", ""), "hex");
const actionType = "intelligence.remote-scan.detected";
const payload = { version: 1, event: "remote_scan.detected", scanID: "scan-1" };
const payloadBytes = Buffer.from(JSON.stringify(payload));
const typeOrigin = id("52");
const sourceID = id("11");
const targetID = id("22");

function fixture() {
  let executions = 0;
  const context = {
    accessDeployment: {
      accessRegistryId: id("53"),
      accessPackageId: id("51"),
      accessTypeOrigin: typeOrigin,
    },
    world: { serverAddressRegistryId: id("54") },
    chain: {
      deriveId(itemID: string) {
        return itemID === "1" ? sourceID : targetID;
      },
    },
    assertCurrent: async () => {},
    client: {
      async getObject({ id: objectID }: { id: string }) {
        return {
          data: {
            objectId: objectID,
            content: {
              dataType: "moveObject",
              type: `${typeOrigin}::assembly_access::AssemblyAction`,
              fields: {
                action_id: [...actionBytes],
                source_assembly_id: sourceID,
                target_assembly_id: targetID,
                creator: id("99"),
                action_type: [...Buffer.from(actionType)],
                payload: [...payloadBytes],
                payload_commitment: [...createHash("sha256").update(payloadBytes).digest()],
                priority: "200",
                priority_flags: "256",
                created_at_ms: "900",
                expires_at_ms: "5000",
                status: "0",
                revision: "1",
                claimed_by: id("0"),
                claim_expires_at_ms: "0",
                outcome: [],
                server_action: true,
              },
            },
          },
        };
      },
    },
    executor: {
      async execute() {
        executions++;
        return { digest: "unexpected" };
      },
    },
  };
  return {
    bridge: createSuiAssemblyActionQueueBridge({
      runExclusive: operation => operation(),
      getContext: () => context,
      getSnapshot: () => ({ assemblies: [{ itemId: "1" }, { itemId: "2" }] }),
      now: () => 1000,
    }),
    executions: () => executions,
  };
}

test("server-authored Sui action creation replays the matching deterministic object", async () => {
  const { bridge, executions } = fixture();
  const result = await bridge.queueServerAction({
    actionID,
    sourceAssemblyID: 1,
    targetAssemblyID: 2,
    actionType,
    payload,
    priority: 200,
    priorityFlags: 256,
    expiresAtMs: 5000,
  });

  assert.equal(result.replayed, true);
  assert.match(String(result.actionObjectID), /^0x[0-9a-f]{64}$/);
  assert.equal(executions(), 0);
});

test("a deterministic Sui action ID cannot replay with a changed payload", async () => {
  const { bridge, executions } = fixture();
  await assert.rejects(
    bridge.queueServerAction({
      actionID,
      sourceAssemblyID: 1,
      targetAssemblyID: 2,
      actionType,
      payload: { ...payload, scanID: "scan-2" },
      priority: 200,
      priorityFlags: 256,
      expiresAtMs: 5000,
    }),
    (error: any) => error?.code === "ASSEMBLY_ACTION_MISMATCH",
  );
  assert.equal(executions(), 0);
});
