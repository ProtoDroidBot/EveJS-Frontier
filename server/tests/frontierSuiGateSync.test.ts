import assert from "node:assert/strict";
import test from "node:test";
import { flushSuiGateSync, readSuiGateSyncStatus, registerSuiGateSyncBridge, type SuiGateSyncStatus } from "../src/services/frontier/suiGateSync";

const request = { gateID: 100, characterID: 1 };
const confirmed = (): SuiGateSyncStatus => ({ ...request, status: "synced", synchronized: true, gateObjectID: "0x100", linkedGateObjectID: "0x101", maxDistanceMeters: "1000" });

test("gate sync bridge shares the worker and requires confirmed reciprocal links", async () => {
  assert.equal((await readSuiGateSyncStatus(request)).status, "disabled");
  let response = confirmed();
  const remove = registerSuiGateSyncBridge({ async readStatus() { return response; }, async flush() { return response; } });
  try {
    assert.equal((await flushSuiGateSync(request)).status, "synced");
    response = { ...confirmed(), synchronized: false };
    assert.equal((await readSuiGateSyncStatus(request)).status, "error");
    response = { ...confirmed(), characterID: 2 };
    assert.equal((await flushSuiGateSync(request)).status, "error");
    response = { ...confirmed(), linkedGateObjectID: undefined };
    assert.equal((await flushSuiGateSync(request)).status, "error");
    response = { ...confirmed(), maxDistanceMeters: "18446744073709551616" };
    assert.equal((await flushSuiGateSync(request)).status, "error");
    response = { ...confirmed(), linkedGateObjectID: null };
    assert.equal((await flushSuiGateSync(request)).status, "synced");
  } finally { remove(); }
  assert.equal((await flushSuiGateSync(request)).status, "disabled");
});

test("replacing gate sync worker invalidates in-flight reads without unregistering its replacement", async () => {
  let release: (value: SuiGateSyncStatus) => void;
  const first = registerSuiGateSyncBridge({ readStatus: () => new Promise(resolve => { release = resolve; }), async flush() { return confirmed(); } });
  const pending = readSuiGateSyncStatus(request);
  const second = registerSuiGateSyncBridge({ async readStatus() { return confirmed(); }, async flush() { return confirmed(); } });
  try {
    first(); release!(confirmed());
    assert.equal((await pending).status, "error");
    assert.equal((await readSuiGateSyncStatus(request)).status, "synced");
  } finally { second(); }
  assert.equal((await readSuiGateSyncStatus({ ...request, gateID: NaN })).status, "error");
});
