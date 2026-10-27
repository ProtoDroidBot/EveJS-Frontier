"use strict";
const assert = require("node:assert/strict");
const test = require("node:test");
const { createCelestialStargateRuntime, TARGET_REBUILD_COST, TARGET_JUMP_ENERGY_COST } = require("../src/services/frontier/celestialStargateRuntime");
const StargateService = require("../src/services/frontier/stargateService");
function fixture() {
  let stored: any = {}, failAtomic = false;
  const gate = { itemID: 60000001, kind: "stargate", typeID: 79787, solarSystemID: 30000004, destinationID: 60000002, destinationSolarSystemID: 30000005 };
  const stock: any = { 7001: { itemID: 7001, typeID: 78516, ownerID: 140000001, locationID: 9001, flagID: 5, singleton: 0, quantity: 100 },
    7002: { itemID: 7002, typeID: 84180, ownerID: 140000001, locationID: 9001, flagID: 5, singleton: 0, quantity: 86 },
    7003: { itemID: 7003, typeID: 84210, ownerID: 140000001, locationID: 9001, flagID: 5, singleton: 0, quantity: 1204 },
    7004: { itemID: 7004, typeID: 84182, ownerID: 140000001, locationID: 9001, flagID: 5, singleton: 0, quantity: 920 } };
  const notices = [];
  const repository = { ensureTable: () => true, read: () => ({ success: true, data: structuredClone(stored) }),
    write: (_t, _p, value) => { stored = structuredClone(value); return { success: true }; }, flushTableSync: () => ({ success: true }),
    prepareAtomicRowWrite: (_table, key, value) => ({ key, value: structuredClone(value) }) };
  const runtime = createCelestialStargateRuntime({ repository, autoConfigure: false, configPath: null,
    findStargate: id => id === gate.itemID ? gate : null, refreshActivation: () => {}, notifyDepot: (system, id) => notices.push([system, id]),
    inventoryTransaction: (request, proposals) => {
      if (failAtomic) return { success: false, errorMsg: "WRITE_ERROR" };
      for (const c of request.consumptions) if (!stock[c.itemID] || stock[c.itemID].quantity < c.quantity) return { success: false, errorMsg: "INSUFFICIENT_ITEMS" };
      for (const c of request.consumptions) stock[c.itemID].quantity -= c.quantity;
      for (const p of proposals) stored[p.key] = p.value;
      return { success: true, data: { changes: [] } };
    } });
  const session: any = { characterID: 140000001, shipid: 9001, solarsystemid2: 30000004, _space: { systemID: 30000004, shipID: 9001 } };
  const ship = { itemID: 9001, kind: "ship", systemID: 30000004, ownerID: session.characterID };
  let range = 10;
  const svc = new StargateService({ runtime, emitInventoryChanges: () => {},
    itemStore: { listContainerItems: () => Object.values(stock), findItemById: id => stock[id] },
    spaceRuntime: { getEntity: (_session, id) => id === 9001 ? ship : id === gate.itemID ? gate : null,
      getSceneForSession: () => ({ getCommandTimeEntitySurfaceDistance: () => range }) } });
  return { runtime, svc, stock, session, notices, gate, failAtomic: v => { failAtomic = v; }, range: v => { range = v; },
    snapshot: () => structuredClone(stored) };
}
test("3640684 native fuel query and deposit use system+gate and inventory controller tuple", () => {
  const f = fixture(); const before = f.svc.Handle_get_fuel_energy([30000004, 60000001], f.session);
  assert.ok(before >= 12 * TARGET_JUMP_ENERGY_COST && before <= 25 * TARGET_JUMP_ENERGY_COST);
  f.svc.Handle_deposit_fuel_items([30000004, 60000001, ["ShipCargo", 9001], { 78516: 50 }], f.session);
  assert.equal(f.stock[7001].quantity, 50);
  assert.equal(f.runtime.getStargateState(60000001).data.fuelEnergy, before + 50 * 444);
  assert.deepEqual(f.notices.at(-1), [30000004, 60000001]);
});
test("target resource deposit leaves both state and inventory unchanged on atomic failure", () => {
  const f = fixture(); f.svc.Handle_get_fuel_energy([30000004, 60000001], f.session);
  const before = f.snapshot(); f.failAtomic(true);
  assert.throws(() => f.svc.Handle_deposit_fuel_items([30000004, 60000001, ["ShipCargo", 9001], { 78516: 1 }], f.session));
  assert.deepEqual(f.snapshot(), before); assert.equal(f.stock[7001].quantity, 100);
});
test("native rebuild progress is integer keyed and completion produces an unfueled gate", () => {
  const f = fixture(); f.runtime.configureDormantStargate({ stargateID: 60000001, requirements: { materials: TARGET_REBUILD_COST } });
  const progress = f.svc.Handle_get_rebuild_progress([30000004, 60000001], f.session);
  assert.deepEqual(progress.entries, [[84180, 0], [84182, 0], [84210, 0]]);
  f.svc.Handle_deposit_rebuild_items([30000004, 60000001, ["ShipCargo", 9001], TARGET_REBUILD_COST], f.session);
  assert.equal(f.runtime.getStargateState(60000001).data.targetActivationState, 1);
  assert.equal(f.stock[7002].quantity, 0); assert.equal(f.stock[7003].quantity, 0); assert.equal(f.stock[7004].quantity, 0);
});
test("fuel reservation is idempotent, refunds once, and cannot jump an empty target gate", () => {
  const f = fixture(); f.runtime.configureDormantStargate({ stargateID: 60000001, requirements: { materials: TARGET_REBUILD_COST } });
  f.svc.Handle_deposit_rebuild_items([30000004, 60000001, 9001, TARGET_REBUILD_COST], f.session);
  assert.equal(f.runtime.reserveJumpEnergy(60000001, "empty").errorMsg, "STARGATE_INSUFFICIENT_FUEL");
  f.svc.Handle_deposit_fuel_items([30000004, 60000001, 9001, { 78516: 50 }], f.session);
  const before = f.runtime.getStargateState(60000001).data.fuelEnergy;
  assert.equal(f.runtime.reserveJumpEnergy(60000001, "jump1").success, true);
  assert.equal(f.runtime.reserveJumpEnergy(60000001, "jump1").replay, true);
  assert.equal(f.runtime.getStargateState(60000001).data.fuelEnergy, before - TARGET_JUMP_ENERGY_COST);
  assert.equal(f.runtime.refundJumpEnergy(60000001, "jump1").refunded, true);
  assert.equal(f.runtime.refundJumpEnergy(60000001, "jump1").refunded, false);
  assert.equal(f.runtime.getStargateState(60000001).data.fuelEnergy, before);
});
test("native deposits reject remote system, out of range, unsupported fuel, and incompatible source", () => {
  const f = fixture();
  assert.throws(() => f.svc.Handle_get_rebuild_progress([30000005, 60000001], f.session));
  f.range(10001); assert.throws(() => f.svc.Handle_deposit_fuel_items([30000004, 60000001, 9001, { 78516: 1 }], f.session));
  f.range(10); assert.throws(() => f.svc.Handle_deposit_fuel_items([30000004, 60000001, ["StationItems", 9001], { 78516: 1 }], f.session));
  assert.throws(() => f.svc.Handle_deposit_fuel_items([30000004, 60000001, 9001, { 84180: 1 }], f.session));
  assert.equal(f.stock[7001].quantity, 100);
});
test("target unfueled state never follows the legacy transient-opening timer", () => {
  const { SolarSystemScene } = require("../src/space/runtime")._testing;
  const target = { kind: "stargate", activationState: 1, stargateTarget3640684: true, activationTransitionAtMs: 0 };
  const legacy = { kind: "stargate", activationState: 1, activationTransitionAtMs: 0 };
  const changed = SolarSystemScene.prototype.settleTransientStargateActivationStates.call({ staticEntities: [target, legacy] }, 10000);
  assert.equal(target.activationState, 1); assert.equal(legacy.activationState, 2); assert.deepEqual(changed, [legacy]);
});
