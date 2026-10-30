import assert = require("node:assert/strict");
import test = require("node:test");
import fs = require("node:fs");
import path = require("node:path");

const FacWarMgrService = require("../src/services/faction/facWarMgrService");
const FwWarzoneSolarsystemService = require("../src/services/map/fwWarzoneSolarsystemService");
const ServiceManager = require("../src/services/serviceManager");
const log = require("../src/utils/logger");
const { marshalEncode, marshalDecode } = require("../src/network/tcp/utils/marshal");

function wire(value) {
  return marshalDecode(marshalEncode(value));
}

test("registered faction warfare calls marshal empty collections without falling through dispatch", t => {
  const manager = new ServiceManager();
  manager.register(new FacWarMgrService());
  const service = manager.lookup("facWarMgr");
  t.mock.method(log, "warn", message => assert.fail(String(message)));
  const session = { compatibilityProfile: "frontier", charid: 140000005 };
  const systems = service.callMethod(Buffer.from("GetFacWarSystems"), [], session);
  const occupiers = service.callMethod("GetAllSystemOccupiers", [], session);
  assert.deepEqual(wire(systems), { type: "list", items: [] });
  assert.deepEqual(wire(occupiers), { type: "dict", entries: [] });

  const dir = process.env.EVEJS_SERVICE_CALL_EVIDENCE_DIR;
  if (dir) {
    fs.mkdirSync(path.resolve(dir), { recursive: true });
    fs.writeFileSync(path.join(path.resolve(dir), "facwar-server-payload.json"), JSON.stringify({
      source: "Registered facWarMgr calls, marshalled and decoded by the real server codec",
      systems: wire(systems), occupiers: wire(occupiers),
      systemsWireBase64: marshalEncode(systems).toString("base64"),
      occupiersWireBase64: marshalEncode(occupiers).toString("base64"),
    }, null, 2) + "\n");
  }
});

test("global warfare queries agree with the existing runtime's absence of configured theaters", () => {
  const warfare = new FacWarMgrService();
  const warzones = new FwWarzoneSolarsystemService();
  const session = { charid: 140000005, warFactionID: 500001, solarsystemid2: 30000322 };
  const states = wire(warzones.Handle_GetAllWarzonesOccupationStates([], session));
  for (const [, bySystem] of states.entries) {
    assert.deepEqual(bySystem, { type: "dict", entries: [] });
  }
  assert.deepEqual(warzones.Handle_GetLocalOccupationState([], session), [30000322, null]);
  // A player's militia or a map's faction ownership cannot create warfare
  // occupancy in a runtime without configured warfare systems.
  assert.deepEqual(wire(warfare.callMethod("GetFacWarSystems", [], session)), { type: "list", items: [] });
  assert.deepEqual(wire(warfare.callMethod("GetAllSystemOccupiers", [], session)), { type: "dict", entries: [] });
});

test("non-militia rank queries keep their existing no-rank contract", () => {
  const service = new FacWarMgrService();
  assert.deepEqual(wire(service.callMethod("GetMyCharacterRankOverview", [], {})), { type: "list", items: [] });
  assert.equal(service.callMethod("GetMyCharacterRankInfo", [], {}), null);
});
