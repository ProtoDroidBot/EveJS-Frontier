"use strict";
const assert = require("node:assert/strict");
const test = require("node:test");
const { createDockingPointRuntime } = require("../src/services/frontier/dockingPointRuntime");
const DockingPointService = require("../src/services/frontier/dockingPointService");
const copy = value => value == null ? value : JSON.parse(JSON.stringify(value));
function fixture() {
  let time = 1000, failWrite = false;
  const characterID = 140000005, systemID = 30000001;
  const session: any = { characterID, shipid: 9001, solarsystemid2: systemID, notices: [],
    sendNotification(name, scope, args) { this.notices.push({ name, scope, args }); } };
  const ship: any = { itemID: 9001, ownerID: characterID, kind: "ship", typeID: 95276,
    systemID, position: { x: 40, y: 0, z: 0 }, mode: "STOP", conditionState: { fuelCharge: 0 } };
  const point: any = { itemID: 9002, ownerID: characterID, typeID: 95676, kind: "container", systemID, position: { x: 0, y: 0, z: 0 } };
  const stock = { itemID: 9003, ownerID: characterID, locationID: 9002, flagID: 5, typeID: 77818, quantity: 25, singleton: 0 };
  const items: any = { 9001: copy(ship), 9002: copy(point), 9003: stock };
  const entities: any = { 9001: ship, 9002: point };
  const rows: any = {};
  const repo = { read: (_table, path) => ({ success: true, data: path === "/" ? copy(rows) : copy(rows[path.slice(1)]) }),
    ensureTable: () => ({ success: true }), prepareAtomicRowWrite: (_table, key, value) => ({ key, value: copy(value) }),
    commitAtomicRowWrites: changes => { if (failWrite) return { success: false }; for (const c of changes) rows[c.key] = c.value; return { success: true }; } };
  const modules = [{ typeID: 96676, moduleState: { online: true } }];
  const fit = { getFittedModuleItems: () => modules, isEffectivelyOnlineModule: m => m.moduleState.online,
    getTypeAttributeMap: () => ({}), buildShipResourceState: () => ({ attributes: { 5633: 100 } }) };
  const inventory: any = { findItemById: id => items[id] || null, listContainerItems: () => Object.values(items).filter((i: any) => i.locationID === 9002),
    applyInventoryTransactionWithAtomicRows: request => {
      if (failWrite) return { success: false, errorMsg: "WRITE_ERROR" };
      for (const c of request.consumptions) items[c.itemID].quantity -= c.quantity;
      for (const u of request.itemUpdates) Object.assign(items[u.itemID], copy(u.changes));
      return { success: true, data: { changes: [] } };
    } };
  const deps: any = { repo, itemStore: inventory, fitting: fit, now: () => time,
    getCreationDogmaContext: () => ({ success: false }), emitInventoryChanges: () => {}, resolveItemByTypeID: () => ({ groupID: 4229 }),
    fuel: { resolveShipFuelTank: () => ({ supported: true }), getAllowedShipFuelGroupIDs: () => [4229],
      getShipFuelCharge: item => item.conditionState.fuelCharge,
      getShipFuelQueue: item => item.conditionState.fuelQueue || [], resolveCreationReserveFuelCapacity: () => 0,
      appendFuelQueueBatchByReserveCapacity: (queue, fuelTypeID, quantity) => [...queue, { fuelTypeID, quantity }] },
    spaceRuntime: { getEntity: (_session, id) => entities[id], stop: () => { ship.mode = "STOP"; } } };
  const runtime = createDockingPointRuntime(deps);
  const scene: any = { systemID, sent: [], getHistorySafeSessionDestinyStamp: () => 1,
    broadcastPilotCommandMovementUpdates: (_session, updates) => scene.sent.push(...updates), scheduleWatcherMovementAnchor: () => {} };
  return { session, ship, point, items, stock, modules, runtime, scene, deps, rows, entities,
    setTime: t => { time = t; }, failWrite: value => { failWrite = value; },
    dock: () => { const result = runtime.manualDock(session, point.itemID); assert.equal(result.success, true); time = 5000; runtime.advanceScene(scene, time); } };
}
test("native docking service returns capability dict and service/payload pairs", () => {
  const f = fixture(); const svc = new DockingPointService({ runtime: f.runtime });
  assert.deepEqual(svc.Handle_get_docking_capabilities([], f.session).entries, [["magnetic_docking", true], ["autohelm", false]]);
  assert.deepEqual(svc.Handle_manual_dock([9002], f.session).items, [["cargo_access", 9002], ["refueling", null]]);
  assert.deepEqual(f.session.notices[0].args, [9002, 9001, f.session.characterID]);
});
test("docking requires an online magnetic module, local authorized point, and range", () => {
  const f = fixture(); f.modules[0].moduleState.online = false;
  assert.equal(f.runtime.manualDock(f.session, 9002).errorMsg, "DockingModuleNotFitted");
  f.modules[0].moduleState.online = true; f.ship.position.x = 106;
  assert.equal(f.runtime.manualDock(f.session, 9002).errorMsg, "DockingPointOutOfRange");
  f.ship.position.x = 40; f.items[9002].ownerID = 140000099;
  assert.equal(f.runtime.manualDock(f.session, 9002).errorMsg, "DockingPointAccessDenied");
  f.items[9002].ownerID = f.session.characterID; f.point.systemID++;
  assert.equal(f.runtime.manualDock(f.session, 9002).errorMsg, "DockingPointNotFound");
});
test("failed durable reservation does not lock or move a ship", () => {
  const f = fixture(); f.failWrite(true);
  assert.equal(f.runtime.manualDock(f.session, 9002).errorMsg, "DockingStateWriteFailed");
  assert.equal(f.runtime.isMovementLocked(f.ship), false); assert.equal(f.session.notices.length, 0);
});
test("dock choreography moves, settles, commits, then undocks with authoritative lift", () => {
  const f = fixture(); f.runtime.manualDock(f.session, 9002);
  f.setTime(1500); f.runtime.advanceScene(f.scene, 1500);
  assert.ok(f.ship.position.x > 0 && f.ship.position.x < 40);
  assert.equal(f.runtime.getCargoAccessError(f.session, 9002), "DOCKING_POINT_ACCESS_DENIED");
  f.setTime(5000); f.runtime.advanceScene(f.scene, 5000);
  assert.equal(f.ship.position.x, 0); assert.equal(f.runtime.getCargoAccessError(f.session, 9002), null);
  assert.deepEqual(f.session.notices.map(n => n.name), ["OnDockingSequenceStarted", "OnShipSettlingAtPoint", "OnShipDockedToPoint"]);
  assert.equal(f.runtime.undock(f.session, 9002).success, true);
  f.setTime(6500); f.runtime.advanceScene(f.scene, 6500); assert.equal(f.ship.position.y, 52.5);
  assert.equal(f.runtime.isMovementLocked(f.ship), true);
  f.setTime(8000); f.runtime.advanceScene(f.scene, 8000); assert.equal(f.ship.position.y, 105);
  assert.equal(f.runtime.isMovementLocked(f.ship), false);
  assert.equal(f.session.notices.at(-1).name, "OnShipUndockedFromPoint");
});
test("cancellation, module loss, and despawn release an accepted docking sequence", () => {
  for (const cause of ["cancel", "module", "despawn"]) {
    const f = fixture(); f.runtime.manualDock(f.session, 9002);
    if (cause === "cancel") f.runtime.undock(f.session, 9002);
    else { if (cause === "module") f.modules[0].moduleState.online = false; else delete f.entities[9002]; f.runtime.advanceScene(f.scene, 1500); }
    assert.equal(f.runtime.isMovementLocked(f.ship), false);
    assert.equal(f.session.notices.at(-1).name, "OnDockingSequenceFailed");
    assert.equal(f.rows["ship:9001"].status, "released");
  }
});
test("durable completed docking restores and remains exclusive across runtime restart", () => {
  const f = fixture(); f.dock(); f.runtime.detachSession(f.session);
  delete f.ship.frontierDockingPointID; f.ship.position.x = 100;
  const restarted = createDockingPointRuntime(f.deps);
  assert.equal(restarted.getDockedPoint(f.session), 9002); assert.equal(f.ship.position.x, 0);
  assert.equal(restarted.isMovementLocked(f.ship), true);
  assert.equal(restarted.undock({ ...f.session, characterID: 140000006 }, 9002).errorMsg, "DockingPointAccessDenied");
});
test("refuel consumes actual port stock and atomically updates tank without granting cargo", () => {
  const f = fixture(); f.dock();
  const result = f.runtime.refuelFromPort(f.session, 9002, 77818, 10);
  assert.equal(result.success, true); assert.equal(f.stock.quantity, 15);
  assert.equal(f.ship.conditionState.fuelCharge, 10); assert.equal(f.items[9001].conditionState.fuelCharge, 10);
  assert.equal(f.session.notices.at(-1).name, "OnModuleAttributeChanges");
  f.failWrite(true); assert.equal(f.runtime.refuelFromPort(f.session, 9002, 77818, 5).success, false);
  assert.equal(f.stock.quantity, 15); assert.equal(f.ship.conditionState.fuelCharge, 10);
});
test("refuel rejects early docking, unsupported fuel, missing stock, overfill, and stale range", () => {
  const f = fixture(); f.runtime.manualDock(f.session, 9002);
  assert.equal(f.runtime.refuelFromPort(f.session, 9002, 77818, 10).errorMsg, "DockingNotComplete");
  f.setTime(5000); f.runtime.advanceScene(f.scene, 5000);
  assert.equal(f.runtime.refuelFromPort(f.session, 9002, 78516, 10).errorMsg, "DockingFuelTypeUnsupported");
  assert.equal(f.runtime.refuelFromPort(f.session, 9002, 77818, 26).errorMsg, "FUEL_SOURCE_INSUFFICIENT");
  assert.equal(f.runtime.refuelFromPort(f.session, 9002, 77818, 101).errorMsg, "FUEL_TANK_OVERFLOW");
  f.ship.position.x = 106;
  assert.equal(f.runtime.refuelFromPort(f.session, 9002, 77818, 1).errorMsg, "DockingPointOutOfRange");
});
