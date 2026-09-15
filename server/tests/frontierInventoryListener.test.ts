import assert from "node:assert/strict";
import test from "node:test";
import { createInventoryListenerReader } from "../src/services/frontier/inventoryListenerRuntime";

const CHARACTER_ID = 140000001;
const SHIP_ID = 9001;
const STORAGE_ID = 9002;
const INDUSTRY_ID = 9003;
const FIELD_STORAGE_ID = 9004;

function fixture() {
  const calls: any[] = [];
  const targets = new Map([
    [SHIP_ID, { itemID: SHIP_ID, typeID: 100, name: "Ship" }],
    [STORAGE_ID, { itemID: STORAGE_ID, typeID: 101, name: "Smart Storage" }],
    [INDUSTRY_ID, { itemID: INDUSTRY_ID, typeID: 102, name: "Industry" }],
    [FIELD_STORAGE_ID, { itemID: FIELD_STORAGE_ID, typeID: 103, name: "Field Storage" }],
  ]);
  const rows = new Map([
    [`${STORAGE_ID}:66`, [{ typeID: 34, stacksize: 3 }, { typeID: 34, stacksize: 4 }]],
    [`${INDUSTRY_ID}:20001`, [{ typeID: 35, stacksize: 2 }]],
    [`${SHIP_ID}:5`, [{ typeID: 36, stacksize: 8 }]],
    [`${FIELD_STORAGE_ID}:0`, [{ typeID: 37, stacksize: 9 }]],
  ]);
  const read = createInventoryListenerReader({
    now: () => 1234,
    getItemMetadata: (typeID: number) => ({ name: `Type ${typeID}` }),
    getInventoryItemUnitVolume: () => 0.5,
    listContainerItems: (_ownerID: number, targetID: number, flagID: number) => rows.get(`${targetID}:${flagID}`) || [],
    resolveInventory: (_session: any, targetID: number, flagID: number, options: any) => {
      calls.push({ targetID, flagID, options });
      const item = targets.get(targetID);
      return item ? { success: true, data: { item, capacity: 100, flagID,
        ...(flagID === 66 ? { inventoryOwnerID: CHARACTER_ID } : {}) } }
        : { success: false, errorMsg: "INVALID_INVENTORY" };
    },
    validateFacility: (_session: any, targetID: number) => targetID === INDUSTRY_ID
      ? { success: true, data: { facility: targets.get(targetID), characterID: CHARACTER_ID } }
      : { success: false, errorMsg: "FACILITY_NOT_FOUND" },
  });
  return { calls, read, session: { characterID: CHARACTER_ID, _space: { shipID: SHIP_ID } } };
}

test("listener reads Smart Storage partitions and aggregates requested item types", () => {
  const f = fixture();
  const result: any = f.read(f.session, { targetKind: "smart-assembly", targetID: STORAGE_ID,
    inventory: "storage", requested: [{ typeID: 34, quantity: 7 }, { typeID: 99, quantity: 1 }] });
  assert.equal(result.success, true);
  assert.equal(result.data.satisfied, false);
  assert.deepEqual(result.data.matched, [
    { typeID: 34, quantity: 7, available: 7 },
    { typeID: 99, quantity: 1, available: 0 },
  ]);
  assert.equal(result.data.usedVolume, 3.5);
  assert.deepEqual(f.calls, [{ targetID: STORAGE_ID, flagID: 66, options: { refreshingStatus: true } }]);
});

test("listener supports Industry output escrow, the active ship, and nearby Field Storage", () => {
  const f = fixture();
  for (const [targetKind, targetID, inventory, typeID] of [
    ["smart-assembly", INDUSTRY_ID, "outputs", 35],
    ["cargo", SHIP_ID, "cargo", 36],
    ["cargo", FIELD_STORAGE_ID, "cargo", 37],
  ] as const) {
    const result: any = f.read(f.session, { targetKind, targetID, inventory,
      requested: [{ typeID, quantity: 1 }] });
    assert.equal(result.success, true);
    assert.equal(result.data.satisfied, true);
  }
  assert.deepEqual(f.calls.map(call => [call.targetID, call.flagID]), [[SHIP_ID, 5], [FIELD_STORAGE_ID, 0]]);
});

test("listener rejects malformed conditions and propagates access failures", () => {
  const f = fixture();
  assert.equal((f.read(f.session, { targetKind: "cargo", targetID: SHIP_ID, inventory: "outputs",
    requested: [{ typeID: 1, quantity: 1 }] }) as any).errorMsg, "INVALID_LISTENER_REQUEST");
  assert.equal((f.read(f.session, { targetKind: "cargo", targetID: SHIP_ID, inventory: "cargo",
    requested: [{ typeID: 1, quantity: 1 }, { typeID: 1, quantity: 2 }] }) as any).errorMsg, "INVALID_LISTENER_REQUEST");
  assert.equal((f.read(f.session, { targetKind: "cargo", targetID: "9e3", inventory: "cargo",
    requested: [{ typeID: 1, quantity: 1 }] }) as any).errorMsg, "INVALID_LISTENER_REQUEST");
  assert.equal((f.read(f.session, { targetKind: "cargo", targetID: 9999, inventory: "cargo",
    requested: [{ typeID: 1, quantity: 1 }] }) as any).errorMsg, "INVALID_INVENTORY");
});
