import assert = require("node:assert/strict");
import test = require("node:test");
import fs = require("node:fs");
import path = require("node:path");
import { spawnSync } from "node:child_process";

const config = require("../src/config");
const database = require("../src/gameStore");
const itemStore = require("../src/services/inventory/itemStore");
const character = require("../src/services/character/characterState");
const sessions = require("../src/services/chat/sessionRegistry");
const Runtime = require("../src/services/industry/legacyIndustryRuntime");
const ClassicRuntime = require("../src/services/industry/industryRuntimeState");
const Catalog = require("../src/services/industry/legacyIndustryStaticData");
const Jobs = require("../src/services/industry/industryManager2Service");
const ClassicJobs = require("../src/services/industry/industryManagerService");
const Monitor = require("../src/services/industry/industryMonitorService");
const Stations = require("../src/services/industry/stationConstructableManagerService");
const Facilities = require("../src/services/industry/facilityManagerService");
const Blueprints = require("../src/services/industry/blueprintManagerService");
const MachoNet = require("../src/services/machoNet/machoNetService");
const ConfigService = require("../src/services/config/configService");
const Dogma = require("../src/services/dogma/dogmaService");
const { buildFacilityPayload } = require("../src/services/industry/industryPayloads");
const { getFacilityPayloadByID } = require("../src/services/industry/industryStaticData");
const { resolveIndustrySlotContext } = require("../src/services/industry/industryRestrictions");
const { marshalEncode, marshalDecode } = require("../src/network/tcp/utils/marshal");

const OWNER = 140000001, STATION = 60000069, PRODUCT = 77818, INPUT = 78423;
const previous = Object.fromEntries(["clientBuild", "clientBuildProfile", "clientCompatibilityProfile", "industrySystemCostIndex"].map(key => [key, config[key]]));
test.beforeEach(() => Object.assign(config, { clientBuild: 2703993, clientBuildProfile: "frontier-2703993", clientCompatibilityProfile: "frontier", industrySystemCostIndex: 0.04 }));
test.afterEach(() => Object.assign(config, previous));
const wire = value => marshalDecode(marshalEncode(value));
function map(value): Map<any, any> {
  return new Map((value?.entries || []).map(([key, item]) => [Buffer.isBuffer(key) ? key.toString() :
    typeof key === "bigint" && Number.isSafeInteger(Number(key)) ? Number(key) : key, item]));
}
const fields = value => map(value.args);
const wrapped = error => Boolean(error?.machoErrorResponse);
const list = value => Array.isArray(value) ? value : value.items;
function quantity(typeID) {
  return itemStore.listContainerItems(OWNER, STATION, 4).filter(item =>
    Number(item.typeID) === typeID && !itemStore.isFreeStationFuelSupplyItem(item))
    .reduce((sum, item) => sum + Number(item.stacksize ?? item.quantity), 0);
}
function snapshot() {
  return JSON.stringify({ items: itemStore.getAllItems(), jobs: database.read("industryJobs", "/").data,
    character: database.read("characters", `/${OWNER}`).data });
}
function fixture(t, ice = 150) {
  if (Number(database.read("industryBlueprints", "/source/buildNumber").data) !== 2703993) {
    t.skip("requires the isolated build 2703993 source catalog"); return null;
  }
  const record = character.getCharacterRecord(OWNER);
  const priorItems = itemStore.getAllItems();
  const priorJobs = database.read("industryJobs", "/").data;
  t.after(() => {
    itemStore._writeItemsForTest(priorItems);
    character.updateCharacterRecord(OWNER, () => record);
    database.write("industryJobs", "/", priorJobs);
  });
  assert.equal(itemStore.updateInventoryItem(record.shipID, item => ({ ...item, locationID: STATION, flagID: 4 })).success, true);
  assert.equal(character.updateCharacterRecord(OWNER, current => ({ ...current, stationID: STATION,
    solarSystemID: 30000322, balance: 1000000, walletJournal: [] })).success, true);
  assert.equal(database.write("industryJobs", "/", { _meta: { nextJobID: 970000000000000 }, jobs: {} }).success, true);
  if (ice) assert.equal(itemStore.grantItemToCharacterLocation(OWNER, STATION, 4,
    itemStore.getItemMetadata(INPUT), ice).success, true);
  const notifications = [];
  const session = { userid: Number(record.accountId), characterID: OWNER, charid: OWNER,
    stationID: STATION, stationid: STATION, locationid: STATION, solarsystemid2: 30000322,
    shipid: record.shipID, compatibilityProfile: "frontier", sendNotification(...args) { notifications.push(args); } };
  t.mock.method(sessions, "getSessions", () => [session]);
  const clock = { now: Date.now() };
  t.mock.method(Date, "now", () => clock.now);
  const service = new Jobs();
  return { session, service, notifications, clock,
    install(runs = 1) {
      const before = list(wire(service.callMethod("get_jobs_by_owner", [OWNER, true], session))).map(row => Number(fields(row).get("jobID")));
      assert.equal(service.callMethod("install_job_for_character", [PRODUCT, runs], session), null);
      const jobs = list(wire(service.callMethod("get_jobs_by_owner", [OWNER, true], session)));
      const row = jobs.find(row => !before.includes(Number(fields(row).get("jobID"))));
      assert.ok(row); return Number(fields(row).get("jobID"));
    },
    ready(jobID) {
      const job = Runtime.getLegacyIndustryJobByID(jobID, session);
      clock.now = Number((BigInt(job.endDate) - 116444736000000000n) / 10000n);
    },
  };
}

test("station discovery, routing and facility payloads use the exact native industry protocol", t => {
  const f = fixture(t); if (!f) return;
  const discovery = new Stations();
  const ids = wire(discovery.callMethod("get_blueprint_ids_for_station", [STATION], f.session));
  assert.equal(ids.type, "list"); assert.equal(ids.items.length, 289); assert.ok(ids.items.includes(PRODUCT));
  const all = map(wire(discovery.callMethod("get_blueprint_ids_for_all_stations", [], f.session)));
  assert.equal(all.size, 23); assert.equal(all.get(STATION).items.length, 289);
  const routes = map(wire(new MachoNet().Handle_GetServiceInfo([], f.session)));
  assert.equal(routes.has("industryManager2"), true); assert.equal(routes.has("stationConstructableManager"), true);
  const facility = wire(new Facilities().Handle_GetFacility([STATION], f.session));
  const activities = map(fields(facility).get("activities"));
  const manufacturing = list(activities.get(1));
  assert.equal(manufacturing.length, 5);
  assert.equal(list(list(manufacturing[2])[0])[0], 0);
  for (const group of manufacturing.slice(0, 3)) for (const row of list(group)) assert.equal(list(row).length, 4);
  const selected = wire(new Facilities().Handle_GetFacilitiesByID([{ type: "list", items: [STATION] }], f.session));
  assert.equal(selected.items.length, 1);
  assert.throws(() => new Blueprints().Handle_GetBlueprintData([0], f.session), wrapped);
  const priceService = new ConfigService();
  const freePrices = map(wire(priceService.Handle_GetAverageMarketPrices([], f.session)));
  assert.equal(fields(freePrices.get(INPUT)).get("averagePrice"), 75);
  assert.equal(fields(freePrices.get(INPUT)).get("adjustedPrice"), 0);
  for (const price of freePrices.values()) assert.equal(fields(price).get("adjustedPrice"), 0);
  const canonical = getFacilityPayloadByID(STATION, f.session);
  const original = JSON.stringify(canonical);
  buildFacilityPayload(canonical, f.session);
  assert.equal(JSON.stringify(canonical), original);
  canonical.activities[1][0][0][3] = PRODUCT;
  assert.throws(() => buildFacilityPayload(canonical, f.session), wrapped);
  config.clientBuild = 3502403;
  const modern = wire(buildFacilityPayload(getFacilityPayloadByID(STATION, f.session), f.session));
  assert.equal(list(map(fields(modern).get("activities")).get(1)).length, 6);
  assert.equal(map(wire(new MachoNet().Handle_GetServiceInfo([], f.session))).has("industryManager2"), false);
  assert.equal(fields(map(wire(priceService.Handle_GetAverageMarketPrices([], f.session))).get(INPUT)).get("adjustedPrice"), 75);
  assert.throws(() => discovery.callMethod("get_blueprint_ids_for_station", [STATION], f.session), wrapped);
  assert.ok(original.includes('"activities"'));
});

test("free station manufacturing consumes materials, recovers after restart and delivers once without changing the wallet", t => {
  const f = fixture(t); if (!f) return;
  const beforeWallet = character.getCharacterRecord(OWNER);
  const monitorRequest = { blueprintID: 0, blueprintTypeID: PRODUCT, productTypeID: null,
    activityID: 1, facilityID: STATION, ownerID: OWNER,
    inputLocation: { itemID: STATION, ownerID: OWNER, flagID: 4 } };
  const monitor = new Monitor().Handle_ConnectJob([monitorRequest], f.session);
  const jobID = f.install(2);
  const job = Runtime.getLegacyIndustryJobByID(jobID, f.session);
  assert.equal(job.blueprintID, 0); assert.equal(job.blueprintTypeID, PRODUCT);
  assert.equal(job.cost, 0); assert.equal(job.tax, 0); assert.equal(job.totalCost, 0);
  assert.equal(quantity(INPUT), 50); assert.equal(quantity(PRODUCT), 0);
  const record = character.getCharacterRecord(OWNER);
  assert.equal(record.balance, beforeWallet.balance);
  assert.deepEqual(record.walletJournal, beforeWallet.walletJournal);
  assert.equal(record.balanceChange, beforeWallet.balanceChange);
  assert.equal(f.notifications.some(entry => entry[0] === "OnAccountChange"), false);
  assert.ok(f.notifications.some(entry => entry[0] === "OnIndustryJob"));
  assert.ok(f.notifications.some(entry => entry[0] === "OnIndustryMaterials" &&
    Number(entry[2][0]) === Number(monitor[0]) && map(entry[2][1]).get(INPUT) === 50));
  assert.throws(() => f.service.callMethod("complete_job", [jobID], f.session), wrapped);

  const identity = { userid: f.session.userid, characterID: OWNER, charid: OWNER,
    compatibilityProfile: "frontier", stationid: STATION, stationID: STATION };
  const script = `const config=require('./server/src/config');Object.assign(config,{clientBuild:2703993,clientCompatibilityProfile:'frontier'});
    const runtime=require('./server/src/services/industry/legacyIndustryRuntime');
    console.log('INDUSTRY_COLD='+JSON.stringify(runtime.getLegacyIndustryJobByID(${jobID},${JSON.stringify(identity)})));`;
  const child = spawnSync(process.execPath, ["-r", path.resolve(__dirname, "helpers/isolatedGameStore.js"), "-e", script],
    { cwd: path.resolve(__dirname, "../.."), env: { ...process.env }, encoding: "utf8", timeout: 30000 });
  assert.equal(child.status, 0, child.stderr || child.error?.message);
  const coldLine = child.stdout.split(/\r?\n/).find(line => line.startsWith("INDUSTRY_COLD="));
  assert.ok(coldLine, child.stdout);
  const cold = JSON.parse(coldLine.slice("INDUSTRY_COLD=".length));
  assert.equal(cold.jobID, jobID); assert.equal(cold.materials[INPUT], 100); assert.equal(cold.totalCost, 0);
  const installedResponse = new ClassicJobs().Handle_GetJob([jobID], f.session);
  const installedJobs = f.service.callMethod("get_jobs_by_owner", [OWNER, false], f.session);
  f.ready(jobID);
  const readyResponse = f.service.callMethod("get_job", [jobID], f.session);
  assert.equal(Number(fields(wire(readyResponse)).get("status")), 3);
  const deliveredResponse = new ClassicJobs().Handle_CompleteJob([jobID], f.session);
  assert.equal(Number(fields(wire(deliveredResponse)).get("status")), 101);
  assert.equal(quantity(PRODUCT), 100);
  assert.equal(f.service.callMethod("complete_job", [jobID], f.session), null);
  assert.equal(quantity(PRODUCT), 100); assert.equal(character.getCharacterRecord(OWNER).balance, beforeWallet.balance);
  assert.equal(list(wire(f.service.callMethod("get_jobs_by_owner", [OWNER, false], f.session))).length, 0);
  const directory = process.env.EVEJS_INDUSTRY_EVIDENCE_DIR;
  if (directory) {
    fs.mkdirSync(directory, { recursive: true });
    const prices = new ConfigService().Handle_GetAverageMarketPrices([], f.session);
    const subset = { ...prices, entries: prices.entries.filter(([id]) => [INPUT, PRODUCT].includes(Number(id))) };
    const facility = new Facilities().Handle_GetFacility([STATION], f.session);
    const facilityLocations = new Facilities().Handle_GetFacilityLocations([STATION, OWNER, null], f.session);
    const characterInfo = new Dogma().Handle_CharGetInfo([], f.session);
    const stationIDs = new Stations().callMethod("get_blueprint_ids_for_station", [STATION], f.session);
    const allStations = new Stations().callMethod("get_blueprint_ids_for_all_stations", [], f.session);
    const blueprintError = (() => { try { new Blueprints().Handle_GetBlueprintData([0], f.session); }
      catch (error) { return error.machoErrorResponse; } })();
    const notificationCases = f.notifications.filter(entry => entry[0] === "OnIndustryMaterials")
      .map(entry => ({ name: entry[0], decoded: wire(entry[2]), wireBase64: marshalEncode(entry[2]).toString("base64") }));
    const payload = { build: 2703993, charID: OWNER, stationID: STATION, jobID, job, cold, monitorRequest, notificationCases,
      policy: { installationCost: 0, tax: 0 }, walletUnchanged: true,
      recipe: Catalog.getLegacyIndustryRecipeByProductID(PRODUCT),
      responses: Object.fromEntries(Object.entries({ installed: installedResponse, ready: readyResponse,
        delivered: deliveredResponse, facility, prices: subset, characterInfo, stationIDs, allStations,
        getJobs: installedJobs, monitor, facilityLocations }).map(([key, value]) =>
        [key, { decoded: wire(value), wireBase64: marshalEncode(value).toString("base64") }])), blueprintError };
    fs.writeFileSync(path.join(directory, "industry-server-payload.json"), JSON.stringify(payload,
      (_, value) => typeof value === "bigint" ? value.toString() : value, 2) + "\n");
  }
});

test("blueprintless job monitors show real station stock and reject foreign inventory requests", t => {
  const f = fixture(t); if (!f) return;
  const monitor = new Monitor();
  const request = { blueprintID: 0, blueprintTypeID: PRODUCT, productTypeID: PRODUCT,
    activityID: 1, facilityID: STATION, ownerID: OWNER,
    inputLocation: { itemID: STATION, ownerID: OWNER, flagID: 4 } };
  const stable = snapshot();
  const connected = list(wire(monitor.callMethod("ConnectJob", [request], f.session)));
  assert.equal(connected.length, 2); assert.ok(Number(connected[0]) > 0);
  assert.equal(map(connected[1]).get(INPUT), 150);
  assert.equal(snapshot(), stable, "preview must not consume stock or create blueprint items");
  const location = new Facilities().Handle_GetFacilityLocations([STATION, OWNER, null], f.session).items[0];
  const passByValue = wire({ type: "dict", entries: Object.entries({ ...request,
    blueprintID: null, productTypeID: null, outputLocation: null, account: null,
    licensedRuns: 1000, inputLocation: location }) });
  const nativeShape = list(wire(monitor.callMethod("ConnectJob", [passByValue], f.session)));
  assert.equal(map(nativeShape[1]).get(INPUT), 150);
  for (const bad of [{ ...request, ownerID: 140000002 },
    { ...request, facilityID: 60000063 },
    { ...request, inputLocation: { ...request.inputLocation, ownerID: 140000002 } },
    { ...request, inputLocation: { ...request.inputLocation, flagID: 5 } }]) {
    assert.throws(() => monitor.callMethod("ConnectJob", [bad], f.session), wrapped);
  }
  assert.equal(snapshot(), stable);
  f.install();
  assert.ok(f.notifications.some(entry => entry[0] === "OnIndustryMaterials" &&
    Number(entry[2][0]) === Number(connected[0]) && map(entry[2][1]).get(INPUT) === 100));
  const updated = list(wire(monitor.callMethod("ConnectJob", [request], f.session)));
  assert.equal(map(updated[1]).get(INPUT), 100);
  assert.equal(monitor.callMethod("DisconnectJob", [connected[0]], f.session), null);
  const notices = f.notifications.length;
  f.install();
  assert.equal(f.notifications.slice(notices).some(entry => entry[0] === "OnIndustryMaterials" &&
    Number(entry[2][0]) === Number(connected[0])), false);
});

test("cancelled jobs retain consumed inputs without outputs, charges or repeated mutations", t => {
  const f = fixture(t); if (!f) return;
  const jobID = f.install();
  const before = character.getCharacterRecord(OWNER).balance;
  const cancelled = ClassicRuntime.cancelIndustryJob(f.session, jobID);
  assert.equal(cancelled.data.status, 102);
  const stable = snapshot();
  assert.equal(f.service.callMethod("cancel_job", [jobID], f.session), null);
  assert.equal(snapshot(), stable); assert.equal(quantity(INPUT), 100); assert.equal(quantity(PRODUCT), 0);
  assert.equal(character.getCharacterRecord(OWNER).balance, before);
  f.clock.now += 1000000;
  assert.throws(() => f.service.callMethod("complete_job", [jobID], f.session), wrapped);
});

test("legacy manufacturing time uses native ties-to-even rounding without changing modern profiles", t => {
  const f = fixture(t); if (!f) return;
  const { resolveIndustryJobTimeSeconds, roundIndustryValue } = require("../src/services/industry/industryParityHelpers");
  const recipe = Catalog.getLegacyIndustryRecipeByProductID(PRODUCT);
  const definition = { ...recipe, activities: { manufacturing: { time: recipe.timeSeconds } } };
  const facility = getFacilityPayloadByID(STATION, f.session);
  assert.equal(roundIndustryValue(38.5), 38);
  assert.equal(roundIndustryValue(39.5), 40);
  assert.equal(resolveIndustryJobTimeSeconds(definition, 1, 1, 0, facility, 0), 38);
  config.clientBuild = 3502403;
  assert.equal(roundIndustryValue(38.5), 39);
  assert.equal(resolveIndustryJobTimeSeconds(definition, 1, 1, 0, facility, 0), 39);
});

test("classic installation calls share free atomic station policy instead of the old charging path", t => {
  const f = fixture(t); if (!f) return;
  character.updateCharacterRecord(OWNER, current => ({ ...current, balance: 0 }));
  const request = { activityID: 1, ownerID: OWNER, facilityID: STATION,
    productTypeID: PRODUCT, blueprintTypeID: PRODUCT, blueprintID: 0, runs: 1 };
  const jobID = new ClassicJobs().Handle_InstallJob([request], f.session);
  assert.ok(jobID > 0);
  assert.equal(Runtime.getLegacyIndustryJobByID(jobID, f.session).totalCost, 0);
  assert.equal(quantity(INPUT), 100);
  assert.equal(character.getCharacterRecord(OWNER).balance, 0);
  assert.deepEqual(character.getCharacterRecord(OWNER).walletJournal, []);
  assert.throws(() => new ClassicJobs().Handle_InstallJob([{ ...request, facilityID: 60000063 }], f.session), wrapped);
});

test("failed installation preserves materials and job state; zero wallet balance still permits manufacturing", t => {
  const f = fixture(t); if (!f) return;
  const stable = snapshot();
  const failure = t.mock.method(database, "commitAtomicRowWrites", () => ({ success: false, errorMsg: "TEST_DISK_ERROR" }));
  assert.throws(() => f.service.callMethod("install_job_for_character", [PRODUCT, 2], f.session), wrapped);
  assert.equal(snapshot(), stable); assert.equal(f.notifications.length, 0);
  assert.equal(failure.mock.callCount(), 1);
  failure.mock.restore();
  assert.throws(() => f.service.callMethod("install_job_for_character", [PRODUCT, 4], f.session), wrapped);
  assert.equal(snapshot(), stable);
  character.updateCharacterRecord(OWNER, current => ({ ...current, balance: 0 }));
  assert.equal(f.service.callMethod("install_job_for_character", [PRODUCT, 1], f.session), null);
  assert.equal(character.getCharacterRecord(OWNER).balance, 0);
  assert.deepEqual(character.getCharacterRecord(OWNER).walletJournal, []);
});

test("failed delivery leaves a retryable job and does not publish or duplicate products", t => {
  const f = fixture(t); if (!f) return;
  const jobID = f.install(); f.ready(jobID);
  const stable = snapshot(), notifications = f.notifications.length;
  const failure = t.mock.method(database, "commitAtomicRowWrites", () => ({ success: false, errorMsg: "TEST_DISK_ERROR" }));
  assert.throws(() => ClassicRuntime.deliverManufacturingJob(f.session, jobID), wrapped);
  assert.equal(snapshot(), stable); assert.equal(f.notifications.length, notifications); assert.equal(quantity(PRODUCT), 0);
  failure.mock.restore();
  new ClassicJobs().Handle_CompleteManyJobs([[jobID]], f.session);
  assert.equal(quantity(PRODUCT), 50);
  new ClassicJobs().Handle_CompleteManyJobs([[jobID]], f.session);
  assert.equal(quantity(PRODUCT), 50);
});

test("industry mutations reject foreign owners, remote factories, unpublished recipes and malformed runs", t => {
  const f = fixture(t); if (!f) return;
  const jobID = f.install();
  const other = { ...f.session, userid: 2, characterID: 140000002, charid: 140000002 };
  character.getCharacterRecord(140000002);
  const stable = snapshot();
  for (const method of ["get_job", "cancel_job", "complete_job"]) assert.throws(() => f.service.callMethod(method, [jobID], other), wrapped);
  assert.throws(() => new ClassicJobs().Handle_GetJob([jobID], other), wrapped);
  assert.throws(() => new ClassicJobs().Handle_GetJobsByOwner([OWNER, true], other), wrapped);
  for (const session of [{ ...f.session, userid: 2 }, { ...f.session, userid: undefined },
    { ...f.session, charid: 140000002 }, { ...f.session, stationID: 0, stationid: 0 },
    { ...f.session, stationID: 60000063, stationid: 60000063 }]) {
    assert.throws(() => f.service.callMethod("install_job_for_character", [PRODUCT, 1], session), wrapped);
  }
  for (const runs of [0, -1, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER]) {
    assert.throws(() => f.service.callMethod("install_job_for_character", [PRODUCT, runs], f.session), wrapped);
  }
  assert.throws(() => f.service.callMethod("install_job_for_character", [587, 1], f.session), wrapped);
  assert.equal(snapshot(), stable);
});

test("server manufacturing slots count undelivered jobs and release after cancellation", t => {
  const f = fixture(t, 2000); if (!f) return;
  const limit = resolveIndustrySlotContext(1, OWNER, {}).limit;
  assert.ok(limit >= 1 && limit <= 20);
  const jobIDs = Array.from({ length: limit }, () => f.install());
  const stable = snapshot();
  assert.throws(() => f.service.callMethod("install_job_for_character", [PRODUCT, 1], f.session), wrapped);
  assert.equal(snapshot(), stable);
  f.service.callMethod("cancel_job", [jobIDs[0]], f.session);
  assert.ok(f.install());
});

test("ready jobs require their actual station and a source-consistent output receipt", t => {
  const f = fixture(t); if (!f) return;
  const jobID = f.install(); f.ready(jobID);
  const remoteFactory = Catalog.getLegacyIndustryFactoryByStationID(60000063);
  itemStore.updateInventoryItem(f.session.shipid, item => ({ ...item, locationID: 60000063, flagID: 4 }));
  character.updateCharacterRecord(OWNER, current => ({ ...current, stationID: 60000063, solarSystemID: remoteFactory.solarSystemID }));
  const remote = { ...f.session, stationID: 60000063, stationid: 60000063,
    locationid: 60000063, solarsystemid2: remoteFactory.solarSystemID };
  const before = snapshot();
  assert.throws(() => ClassicRuntime.deliverManufacturingJob(remote, jobID), wrapped);
  assert.equal(snapshot(), before); assert.equal(quantity(PRODUCT), 0);
  itemStore.updateInventoryItem(f.session.shipid, item => ({ ...item, locationID: STATION, flagID: 4 }));
  character.updateCharacterRecord(OWNER, current => ({ ...current, stationID: STATION, solarSystemID: 30000322 }));
  const jobs = structuredClone(database.read("industryJobs", "/").data);
  jobs.jobs[String(jobID)].legacyProducts = [{ typeID: PRODUCT, quantity: 999 }];
  database.write("industryJobs", "/", jobs);
  const invalid = snapshot();
  assert.throws(() => f.service.callMethod("complete_job", [jobID], f.session), wrapped);
  assert.equal(snapshot(), invalid); assert.equal(quantity(PRODUCT), 0);
});

test("notification errors after a durable mutation do not report failure or duplicate deliveries", t => {
  const f = fixture(t); if (!f) return;
  f.session.sendNotification = () => { throw new Error("test notification transport closed"); };
  const jobID = f.install(); f.ready(jobID);
  assert.equal(f.service.callMethod("complete_job", [jobID], f.session), null);
  assert.equal(f.service.callMethod("complete_job", [jobID], f.session), null);
  assert.equal(quantity(PRODUCT), 50); assert.equal(character.getCharacterRecord(OWNER).walletJournal.length, 0);
});
