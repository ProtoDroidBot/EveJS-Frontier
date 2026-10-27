const assert = require("node:assert/strict");
const test = require("node:test");
const { createFrontierClaimsRuntime, marshalOccupant, isClaimableAssembly, canClaimAtPointInScene } = require("../src/services/frontier/frontierClaimsRuntime");
const { createSmartKillReportRuntime } = require("../src/services/frontier/smartKillMailService");

function repository() {
  const rows: Record<string, any> = {}; let fail = false;
  return { rows, setFailure: value => fail = value, ensureTable: () => ({ success: true }),
    read: (table, path) => ({ success: true, data: structuredClone(path === "/" ? rows[table] || {} : rows[table]?.[path.slice(1)]) }),
    prepareAtomicRowWrite: (table, key, value) => ({ table, key, value: structuredClone(value) }),
    commitAtomicRowWrites(tokens) { if (fail) return { success: false }; for (const token of tokens) { rows[token.table] ||= {}; rows[token.table][token.key] = token.value; } return { success: true }; },
  };
}
const point = { solar_system_id: 30000001, planet_id: 40000001, lagrange_point_id: 40000002 };
const session = { characterID: 42, solarsystemid2: 30000001 };

test("claims enforce item ownership, proximity, conflicts, durable restart and destruction revocation", () => {
  const repo = repository(), notices = [], items = new Map<any, any>([[10, { itemID: 10, ownerID: 42, locationID: 30000001 }], [11, { itemID: 11, ownerID: 43, locationID: 30000001 }]]);
  let range = true;
  const options = { repo, findItem: id => items.get(id), resolvePoint: p => p.lagrange_point_id === point.lagrange_point_id,
    isClaimableAssembly: () => true, canClaimAtPoint: () => range, publish: (...args) => notices.push(args), policy: () => ({}) };
  const runtime = createFrontierClaimsRuntime(options);
  const input = { lagrange_point: point, group: "Player", type: "Base", item_id: 10, owner_id: 42 };
  assert.equal(runtime.addOccupant(session, { ...input, owner_id: 43 }).success, false);
  range = false; assert.equal(runtime.addOccupant(session, input).errorMsg, "CLAIM_OUT_OF_RANGE"); range = true;
  repo.setFailure(true); assert.equal(runtime.addOccupant(session, input).success, false); assert.equal(notices.length, 0); repo.setFailure(false);
  assert.equal(runtime.addOccupant(session, input).success, true);
  assert.equal(runtime.addOccupant(session, input).duplicate, true);
  assert.equal(runtime.addOccupant({ ...session, characterID: 43 }, { ...input, item_id: 11, owner_id: 43 }).errorMsg, "ALREADY_CLAIMED");
  assert.equal(runtime.removeOccupant({ characterID: 43 }, point).success, false);
  const restarted = createFrontierClaimsRuntime(options);
  assert.equal(restarted.listOccupants().length, 1);
  const wire = marshalOccupant(restarted.getOccupant(point)); assert.equal(wire.type, "objectex1");
  items.delete(10); assert.equal(restarted.getOccupant(point), null);
  restarted.reconcileClaims(); assert.equal(notices.at(-1)[1], "OnLagrangePointUnclaimed");
  assert.equal(runtime.addOccupant({ ...session, characterID: 43 }, { ...input, item_id: 11, owner_id: 43 }).success, true);
});

test("pack entitlements are policy-backed, revocable, bounded and gate matching builds", () => {
  const repo = repository();
  const runtime = createFrontierClaimsRuntime({ repo, policy: () => ({ packEntitlements: { 42: [8, 9, 99] }, buildingPackRequirements: { 999: 9 } }) });
  assert.deepEqual(runtime.getClaimedPacks(session), [8, 9]);
  assert.equal(runtime.canBuild(session, 999), true);
  assert.equal(runtime.setPackEntitlement(42, 9, false, "operator:test").success, true);
  assert.deepEqual(runtime.getClaimedPacks(session), [8]);
  assert.equal(runtime.canBuild(session, 999), false);
  assert.equal(runtime.setPackEntitlement(42, 99, true, "operator:test").success, false);
  assert.deepEqual(runtime.getClaimedPacks({ characterID: 43 }), []);
});

test("kill reporting requires authoritative provenance and wallet, survives restart and never duplicates", async () => {
  const repo = repository(); let wallet = "0x" + "ab".repeat(32);
  const options = { repo, getKillmail: id => id === 1 ? { killID: 1, victimCharacterID: 42, finalCharacterID: 43, attackers: [] } : null,
    getWallet: () => wallet, profile: () => "local" };
  const runtime = createSmartKillReportRuntime(options);
  await assert.rejects(runtime.reportKill({ characterID: 99 }, 1), /ACCESS_DENIED/);
  wallet = ""; await assert.rejects(runtime.reportKill(session, 1), /WALLET_REQUIRED/); wallet = "0x" + "ab".repeat(32);
  repo.setFailure(true); await assert.rejects(runtime.reportKill(session, 1)); repo.setFailure(false);
  const report = await runtime.reportKill(session, 1);
  assert.equal(report.receipt.backend, "local");
  assert.deepEqual(await runtime.reportKill(session, 1), report);
  assert.equal(createSmartKillReportRuntime(options).alreadyReported(session, 1), true);
  assert.throws(() => createSmartKillReportRuntime({ ...options, profile: () => "sui" }).alreadyReported(session, 1), /BACKEND_UNAVAILABLE/);
});

test("external report retries reuse intent and do not mark unconfirmed reports accepted", async () => {
  const repo = repository(), keys = []; let succeeds = false;
  const runtime = createSmartKillReportRuntime({ repo, getKillmail: () => ({ killID: 1, victimCharacterID: 42 }), getWallet: () => "0x" + "ab".repeat(32), profile: () => "test-chain",
    submitReport: async row => { keys.push(row.idempotencyKey); return succeeds ? { backend: "test-chain", reference: "confirmed-tx", confirmed: true, idempotencyKey: row.idempotencyKey, provenanceHash: row.provenanceHash } : null; } });
  await assert.rejects(runtime.reportKill(session, 1), /NOT_CONFIRMED/);
  assert.equal(runtime.alreadyReported(session, 1), false);
  succeeds = true; await runtime.reportKill(session, 1);
  assert.equal(keys[0], keys[1]); assert.equal(runtime.alreadyReported(session, 1), true);
});

test("claims require completed authored assembly definitions and public point interaction scope", () => {
  let state = { assemblyTypeID: 90184, solarSystemID: 30000001, assemblyStatus: 1 };
  const item = { itemID: 10, typeID: 90184, flagID: 0, locationID: 30000001 };
  const deployment = { readConstructionState: () => state, ASSEMBLY_STATUS_UNDER_CONSTRUCTION: 0,
    listAssemblyDefinitions: () => [{ assemblyTypeID: 90184 }] };
  assert.equal(isClaimableAssembly(item, deployment), true);
  assert.equal(isClaimableAssembly({ ...item, typeID: 88092 }, deployment), false);
  assert.equal(isClaimableAssembly(item, deployment, { claimableAssemblyTypeIDs: [88092] }), false);
  state = { ...state, assemblyStatus: 0 }; assert.equal(isClaimableAssembly(item, deployment), false);
  state = { ...state, assemblyStatus: 1 };
  const ship: any = { kind: "ship", position: { x: 0, y: 0, z: 0 } };
  const entity: any = { itemID: 10, position: { x: 1, y: 0, z: 0 } };
  const anchor = { position: { x: 2, y: 0, z: 0 } };
  const scene = { getShipEntityForSession: () => ship, dynamicEntities: new Map([[10, entity]]) };
  assert.equal(canClaimAtPointInScene(scene, session, item, anchor), true);
  ship.dungeonCurrentInstanceID = 1;
  assert.equal(canClaimAtPointInScene(scene, session, item, anchor), false);
  entity.dungeonSiteInstanceID = 1;
  assert.equal(canClaimAtPointInScene(scene, session, item, anchor), false);
  delete ship.dungeonCurrentInstanceID; delete entity.dungeonSiteInstanceID;
  entity.position.x = NaN; assert.equal(canClaimAtPointInScene(scene, session, item, anchor), false);
});

test("claims revoke removed world points and pack grants initialize storage before first write", () => {
  const repo = repository(); let pointExists = true, initialized = false;
  const prepare = repo.prepareAtomicRowWrite;
  repo.ensureTable = () => { initialized = true; return { success: true }; };
  repo.prepareAtomicRowWrite = (...args) => { assert.equal(initialized, true); return prepare(...args); };
  const runtime = createFrontierClaimsRuntime({ repo, findItem: () => ({ ownerID: 42, locationID: 30000001 }),
    resolvePoint: () => pointExists, isClaimableAssembly: () => true, canClaimAtPoint: () => true });
  assert.equal(runtime.setPackEntitlement(42, 8, true, "operator:test").success, true);
  assert.equal(runtime.addOccupant(session, { lagrange_point: point, group: "Player", type: "Base", item_id: 10, owner_id: 42 }).success, true);
  pointExists = false; assert.equal(runtime.getOccupant(point), null);
  runtime.reconcileClaims(); assert.equal(Object.values<any>(repo.rows.frontierClaims).find(row => row.kind === "occupancy").status, "revoked");
});

test("kill-report replay rejects changed provenance and external receipts must confirm exact intent", async () => {
  const repo = repository(); let record = { killID: 1, victimCharacterID: 42, finalCharacterID: 43 };
  let wallet = "0x" + "ab".repeat(32), receiptMode = "wrong-intent";
  const options = { repo, getKillmail: () => record, getWallet: () => wallet, profile: () => "test-chain",
    submitReport: async row => {
      if (receiptMode === "wallet-changed") wallet = "0x" + "cd".repeat(32);
      if (receiptMode === "record-changed") record = { ...record, finalCharacterID: 44 };
      return { backend: "test-chain", reference: "tx1", confirmed: true,
        idempotencyKey: receiptMode === "wrong-intent" ? "unrelated" : row.idempotencyKey, provenanceHash: row.provenanceHash };
    } };
  const runtime = createSmartKillReportRuntime(options);
  await assert.rejects(runtime.reportKill(session, 1), /NOT_CONFIRMED/);
  assert.equal(runtime.alreadyReported(session, 1), false);
  receiptMode = "wallet-changed"; await assert.rejects(runtime.reportKill(session, 1), /AUTHORITY_CHANGED/);
  wallet = "0x" + "ab".repeat(32);
  receiptMode = "record-changed"; await assert.rejects(runtime.reportKill(session, 1), /PROVENANCE_CHANGED/);
  record = { ...record, finalCharacterID: 43 };
  receiptMode = "valid"; await runtime.reportKill(session, 1);
  record = { ...record, finalCharacterID: 44 };
  await assert.rejects(runtime.reportKill(session, 1), /PROVENANCE_CHANGED/);
  assert.throws(() => runtime.alreadyReported(session, 1), /PROVENANCE_CHANGED/);
});

test("native claim responses preserve exact constructors and type filters accept target StrEnum", () => {
  const Service = require("../src/services/frontier/lagrangeOccupancyMgrService");
  const { buildObjectEx1 } = require("../src/services/_shared/serviceHelpers");
  const { marshalEncode, marshalDecodeExact } = require("../src/network/tcp/utils/marshal");
  const prefix = "frontier.lagrange_occupancy.common.data_classes.";
  const row = { lagrange_point: point, group: "Player", type: "Base", item_id: 10, owner_id: 42 };
  const service = new Service({ runtime: { getOccupant: () => row, listOccupants: filter => [row].filter(filter) } });
  for (const type of ["Base", buildObjectEx1(prefix + "OccupantType", ["Base"])]) {
    assert.equal(service.Handle_get_all_occupants_of_type([type]).items.length, 1);
  }
  assert.equal(service.Handle_get_all_occupants_of_type([buildObjectEx1("unrelated.Class", ["Base"])]).items.length, 0);
  const wire = marshalDecodeExact(marshalEncode(service.Handle_get_occupant([point]), { compatibilityProfile: "frontier" }), { compatibilityProfile: "frontier" });
  assert.equal(wire.header[0].value, prefix + "Occupant");
  const fields = wire.header[1];
  assert.equal(fields[0].header[0].value, prefix + "LagrangePoint");
  assert.deepEqual(fields[0].header[1], [point.solar_system_id, point.planet_id, point.lagrange_point_id]);
  assert.equal(fields[1].header[0].value, prefix + "OccupantGroup");
  assert.equal(fields[2].header[0].value, prefix + "OccupantType");
  assert.deepEqual(fields.slice(3), [10, 42]);
});
