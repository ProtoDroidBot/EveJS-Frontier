import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { normalizeSuiAddress } from "@mysten/sui/utils";
import {
  createSuiAssemblyActionQueueBridge,
  ensureSuiAssemblyActionQueues,
} from "../src/services/frontier/suiAssemblyActionQueue";

const id = (value: string) => normalizeSuiAddress(`0x${value}`);
const actionID = "d7949ad2-56c0-4a98-a970-83b293a4df93";
const actionBytes = Buffer.from(actionID.replaceAll("-", ""), "hex");
const actionType = "intelligence.remote-scan.detected";
const payload = { version: 1, event: "remote_scan.detected", scanID: "scan-1" };
const payloadBytes = Buffer.from(JSON.stringify(payload));
const typeOrigin = id("52");
const sourceID = id("11");
const targetID = id("22");

function fixture(fieldOverrides: Record<string, unknown> = {}) {
  let executions = 0;
  const context = {
    accessDeployment: {
      accessRegistryId: id("53"),
      accessPackageId: id("51"),
      accessTypeOrigin: typeOrigin,
      actionRegistryId: id("56"),
      actionPackageId: id("55"),
      actionTypeOrigin: typeOrigin,
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
              type: `${typeOrigin}::action_queue::Action`,
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
                ...fieldOverrides,
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

test("typed BCS actions retain raw bytes and verify their SHA-256 receipt", async () => {
  const binaryPayload = Buffer.from([0xff, 0x00, 0x01]);
  const binaryOutcome = Buffer.from([0x03, 0x02, 0x01]);
  const { bridge } = fixture({
    payload: [...binaryPayload],
    payload_commitment: [...createHash("sha256").update(binaryPayload).digest()],
    outcome: [...binaryOutcome],
    receipt_commitment: [...createHash("sha256").update(binaryOutcome).digest()],
    status: "2",
  });
  const action = await bridge.readAction(id("77"));
  assert.deepEqual(action.payload, Uint8Array.from(binaryPayload));
  assert.deepEqual(action.outcomeBytes, Uint8Array.from(binaryOutcome));
  assert.equal(action.receiptCommitment, createHash("sha256").update(binaryOutcome).digest("hex"));
});

test("a mismatched action receipt is rejected", async () => {
  const { bridge } = fixture({
    outcome: [1, 2, 3],
    receipt_commitment: [...Buffer.alloc(32, 0xaa)],
    status: "2",
  });
  await assert.rejects(
    bridge.readAction(id("77")),
    (error: any) => error?.code === "ASSEMBLY_ACTION_COMMITMENT_INVALID",
  );
});

test("assembly reconciliation initializes only missing canonical queue roots", async () => {
  let requested: string[] = [];
  let executions = 0;
  const context = {
    accessDeployment: {
      accessRegistryId: id("53"), accessPackageId: id("51"), accessTypeOrigin: typeOrigin,
      actionRegistryId: id("56"), actionPackageId: id("55"), actionTypeOrigin: typeOrigin,
    },
    world: { serverAddressRegistryId: id("54") },
    assertCurrent: async () => {},
    client: {
      async multiGetObjects({ ids }: { ids: string[] }) {
        requested = ids;
        return ids.map(() => ({ error: { code: "notExists" } }));
      },
    },
    executor: {
      async execute(label: string) {
        executions++;
        assert.equal(label, "initialize 2 assembly action queues");
        return { digest: "queues" };
      },
    },
  };
  await ensureSuiAssemblyActionQueues(context, [sourceID, targetID, sourceID]);
  assert.equal(requested.length, 2);
  assert.equal(new Set(requested).size, 2);
  assert.equal(executions, 1);
});
