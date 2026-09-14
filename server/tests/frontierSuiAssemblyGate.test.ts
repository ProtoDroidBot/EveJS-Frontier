import assert = require("node:assert/strict");
import { test } from "node:test";
import { createAssemblySyncWorker, createSuiGateSyncWorkerBridge } from "../src/services/frontier/suiAssemblySync";

function fixture() {
  const events: string[] = [];
  let assemblies: any[] = [
    { itemId: "100", kind: "gate", ownerId: 1, typeId: 44, destinationGateId: "101", gateDistanceMeters: "80", gateMaxDistanceMeters: "100" },
    { itemId: "101", kind: "gate", ownerId: 1, typeId: 44, destinationGateId: "100", gateDistanceMeters: "80", gateMaxDistanceMeters: "100" },
  ];
  let onRead = () => {};
  let pending = false;
  let prepared = false;
  let available = true;
  const worker = createAssemblySyncWorker({ report() {}, async reconcile() { events.push("scan"); } });
  const bridge = createSuiGateSyncWorkerBridge({
    runExclusive: worker.runExclusive, runOnce: worker.runOnce,
    getContext: () => available ? {
      async assertCurrent() { events.push("deployment"); },
      contents: { async getGateStatus(source: any, destination: any) {
        assert.equal(source.itemId, "100");
        assert.equal(destination.itemId, "101");
        events.push("read");
        onRead();
        return { gateObjectID: "0x100", linkedGateObjectID: "0x101", maxDistanceMeters: "200", synchronized: true };
      } },
      executor: { hasPending: () => pending },
    } : null,
    getSnapshot: () => ({ assemblies, errors: [], characters: [] }),
    getLastError: () => "", hasPrepared: () => prepared,
  });
  return { bridge, worker, events,
    onRead(fn: () => void) { onRead = fn; },
    changeGate(itemId: string) { assemblies = assemblies.map(a => a.itemId === itemId ? { ...a, destinationGateId: null } : a); },
    setPending(value: boolean) { pending = value; },
    setPrepared(value: boolean) { prepared = value; },
    setAvailable(value: boolean) { available = value; },
  };
}

test("gate flush confirms through the worker after two scans without nesting the queue", async () => {
  const f = fixture();
  const status = await f.bridge.flush({ gateID: 100, characterID: 1 });
  assert.equal(status.status, "synced");
  assert.equal(status.synchronized, true);
  assert.equal(status.maxDistanceMeters, "200");
  assert.deepEqual(f.events, ["scan", "scan", "deployment", "read", "deployment"]);
  await f.worker.stop();
});

test("gate status remains pending if either local endpoint changes during chain reads", async () => {
  for (const itemId of ["100", "101"]) {
    const f = fixture();
    f.onRead(() => f.changeGate(itemId));
    const status = await f.bridge.readStatus({ gateID: 100, characterID: 1 });
    assert.equal(status.status, "pending");
    assert.equal(status.synchronized, false);
    await f.worker.stop();
  }
});

test("gate status rejects another character and unavailable or prepared deployments", async () => {
  const f = fixture();
  await assert.rejects(f.bridge.readStatus({ gateID: 100, characterID: 2 }), /Owned Smart Gate/);
  assert.equal(f.events.includes("read"), false);
  f.setAvailable(false);
  await assert.rejects(f.bridge.readStatus({ gateID: 100, characterID: 1 }), /starting/);
  f.setAvailable(true);
  f.setPrepared(true);
  await assert.rejects(f.bridge.readStatus({ gateID: 100, characterID: 1 }), /signing/);
  f.setPrepared(false);
  f.setPending(true);
  const status = await f.bridge.readStatus({ gateID: 100, characterID: 1 });
  assert.equal(status.status, "pending");
  assert.equal(status.synchronized, false);
  await f.worker.stop();
});
