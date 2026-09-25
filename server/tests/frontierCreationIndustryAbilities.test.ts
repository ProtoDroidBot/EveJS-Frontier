"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const itemStore = require("../src/services/inventory/itemStore");
const spaceRuntime = require("../src/space/runtime");
const creationRuntime = require("../src/services/frontier/creationRuntime");
const creationAbilityRuntime = require("../src/services/frontier/creationAbilityRuntime");
const industryRuntime = require("../src/services/frontier/industryRuntime");
const industryBlueprints = require("../src/services/frontier/industryBlueprints");
const { unwrapMarshalValue } = require("../src/services/_shared/serviceHelpers");
const CreationService = require("../src/services/frontier/creationService");
const {
  registerCreationIndustryAbilityHandlers,
} = require("../src/services/frontier/creationIndustryAbilityHandlers");

const OWNER_ID = 140000003;
const OTHER_OWNER_ID = 140000002;
const SYSTEM_ID = 30000004;
const STATION_ID = 64000001;
const CREATION_TYPE_ID = 95276;
const PRINTER_TYPE_ID = 95302;
const PROCESSOR_TYPE_ID = 95486;
const PRINTER_BLUEPRINT_ID = 1510;
const PROCESSOR_BLUEPRINT_ID = 1497;
const CARGO_FLAG = itemStore.ITEM_FLAGS.CARGO_HOLD;

const INDUSTRY_ABILITIES = [
  "industry_load_blueprint",
  "industry_start_production",
  "industry_discontinue_production",
  "industry_deposit_input",
  "industry_withdraw_input",
  "industry_withdraw_output",
  "industry_withdraw_to_jettison_input",
  "industry_withdraw_to_jettison_output",
];

function grant(ownerID, locationID, flagID, typeID, quantity, options = {}) {
  const result = itemStore.grantItemsToCharacterLocation(
    ownerID,
    locationID,
    flagID,
    [{ itemType: typeID, quantity, options }],
  );
  assert.equal(result.success, true, result.errorMsg);
  return result.data.items[0];
}

function totalAt(ownerID, locationID, flagID, typeID) {
  return itemStore.listContainerItems(ownerID, locationID, flagID)
    .filter(item => Number(item.typeID) === Number(typeID))
    .reduce((sum, item) => sum + Number(item.singleton ? 1 : item.stacksize), 0);
}

function invoke(service, fixture, module, ability, kwargs = {}) {
  const result = service.Handle_activate_ability(
    [fixture.ship.itemID, module.itemID, ability],
    fixture.session,
    kwargs,
  );
  return result === false ? false : unwrapMarshalValue(result);
}

function assertCreationError(callback, reason) {
  assert.throws(callback, (error) => {
    const header = error?.machoErrorResponse?.payload?.header;
    assert.equal(
      header?.[0]?.value,
      "frontier.creation.common.errors.CreationError",
    );
    assert.deepEqual(header?.[1], [reason]);
    return true;
  });
}

function fixture(t, { docked = false } = {}) {
  registerCreationIndustryAbilityHandlers();
  const locationID = docked ? STATION_ID : SYSTEM_ID;
  const ship = grant(OWNER_ID, locationID, docked ? itemStore.ITEM_FLAGS.HANGAR : 0,
    CREATION_TYPE_ID, 1, { individualItems: true, singleton: 1 });
  const ensured = creationRuntime.ensureCreationState(ship, OWNER_ID);
  assert.equal(ensured.success, true, ensured.errorMsg);
  const printer = ensured.data.state.modules.find(module => module.typeID === PRINTER_TYPE_ID);
  const processor = ensured.data.state.modules.find(module => module.typeID === PROCESSOR_TYPE_ID);
  assert.ok(printer, "Creation template must contain an Emergency Printer");
  assert.ok(processor, "Creation template must contain a Material Processor");
  for (const module of [printer, processor]) {
    assert.equal(
      creationRuntime.isCreationModuleOnline(itemStore.findItemById(module.itemID)),
      false,
      "template facilities await manual onlining",
    );
    const online = creationRuntime.setCreationModuleOnlineState(
      itemStore.findItemById(ship.itemID), OWNER_ID, module.itemID, true,
    );
    assert.equal(online.success, true, online.errorMsg);
  }
  const notifications: any[] = [];
  const session: Record<string, any> = {
    characterID: OWNER_ID,
    charid: OWNER_ID,
    shipid: ship.itemID,
    locationid: locationID,
    sendNotification(...args) { notifications.push(args); },
    ...(docked ? { stationid: STATION_ID, stationid2: STATION_ID } : {
      solarsystemid: SYSTEM_ID,
      solarsystemid2: SYSTEM_ID,
      _space: { shipID: ship.itemID, systemID: SYSTEM_ID },
    }),
  };
  if (!docked) {
    t.mock.method(spaceRuntime, "getEntity", (_session, itemID) =>
      Number(itemID) === Number(ship.itemID) ? {
        kind: "ship", itemID: ship.itemID, position: { x: 0, y: 0, z: 0 },
      } : null);
  }
  return { ship, printer, processor, session, notifications };
}

test("Creation Industry modules advertise every native modular-facility ability", t => {
  const f = fixture(t);
  for (const module of [f.printer, f.processor]) {
    const abilities = creationRuntime.getCreationModuleAbilities(module.typeID);
    for (const ability of INDUSTRY_ABILITIES) {
      assert.ok(abilities.includes(ability), `${module.typeID} omitted ${ability}`);
      assert.ok(creationAbilityRuntime.resolveCreationAbilityHandler("industry", ability));
    }
  }
});

test("Emergency Printer loads, deposits, starts, discontinues, completes and withdraws through creation.activate_ability", t => {
  const f = fixture(t);
  const service = new CreationService();
  const blueprint = industryBlueprints.getBlueprintForFacility(PRINTER_TYPE_ID, PRINTER_BLUEPRINT_ID);
  assert.ok(blueprint);

  const loaded = invoke(service, f, f.printer, "industry_load_blueprint", {
    blueprint_id: PRINTER_BLUEPRINT_ID,
  });
  assert.notEqual(loaded, false);
  assert.equal(loaded.blueprint.blueprint_id, PRINTER_BLUEPRINT_ID);
  assert.equal(
    industryBlueprints.getSelectedBlueprint(itemStore.findItemById(f.printer.itemID)).blueprint_id,
    PRINTER_BLUEPRINT_ID,
  );

  const [inputTypeID, inputSlot] = Object.entries<any>(blueprint.inputs)[0];
  const [outputTypeID, outputSlot] = Object.entries<any>(blueprint.outputs)[0];
  const cargo = grant(OWNER_ID, f.ship.itemID, CARGO_FLAG, Number(inputTypeID), inputSlot.quantity_per_run);
  const deposited = invoke(service, f, f.printer, "industry_deposit_input", {
    items: { [cargo.itemID]: inputSlot.quantity_per_run },
  });
  assert.notEqual(deposited, false);
  assert.equal(deposited.deposited[Number(inputTypeID)], inputSlot.quantity_per_run);
  assert.equal(totalAt(OWNER_ID, f.printer.itemID, industryRuntime.INDUSTRY_INPUT_FLAG, Number(inputTypeID)),
    inputSlot.quantity_per_run);

  const started = invoke(service, f, f.printer, "industry_start_production", {
    blueprint_id: PRINTER_BLUEPRINT_ID,
    blueprint_hash: blueprint.content_hash,
  });
  assert.notEqual(started, false);
  assert.equal(started.state, "RUNNING");
  assert.equal(totalAt(OWNER_ID, f.printer.itemID, industryRuntime.INDUSTRY_INPUT_FLAG, Number(inputTypeID)), 0);

  const discontinuing = invoke(service, f, f.printer, "industry_discontinue_production");
  assert.notEqual(discontinuing, false);
  assert.equal(discontinuing.state, "DISCONTINUING");
  const progress = industryRuntime.getProduction(itemStore.findItemById(f.printer.itemID));
  const completed = industryRuntime.advanceProduction(f.printer.itemID, { nowMs: progress.runEndAtMs });
  assert.equal(completed.success, true, completed.errorMsg);
  assert.equal(completed.data.production.state, "STOPPED");
  assert.equal(completed.data.production.stopReason, "DISCONTINUED");
  assert.equal(totalAt(OWNER_ID, f.printer.itemID, industryRuntime.INDUSTRY_OUTPUT_FLAG, Number(outputTypeID)),
    outputSlot.quantity_per_run);

  const withdrawn = invoke(service, f, f.printer, "industry_withdraw_output", {
    items: { [outputTypeID]: outputSlot.quantity_per_run },
    inventory_id: f.ship.itemID,
    inventory_flag: CARGO_FLAG,
  });
  assert.notEqual(withdrawn, false);
  assert.equal(withdrawn.withdrawn[Number(outputTypeID)], outputSlot.quantity_per_run);
  assert.equal(totalAt(OWNER_ID, f.ship.itemID, CARGO_FLAG, Number(outputTypeID)), outputSlot.quantity_per_run);
});

test("Creation-host validation keeps module tabs separate and rejects remote, cargo and foreign spoofing", t => {
  const f = fixture(t, { docked: true });
  const service = new CreationService();
  assert.notEqual(invoke(service, f, f.printer, "industry_load_blueprint", {
    blueprint_id: PRINTER_BLUEPRINT_ID,
  }), false, "the active docked Creation remains manageable");
  assert.notEqual(invoke(service, f, f.processor, "industry_load_blueprint", {
    blueprint_id: PROCESSOR_BLUEPRINT_ID,
  }), false);
  assert.equal(industryBlueprints.getSelectedBlueprint(itemStore.findItemById(f.printer.itemID)).blueprint_id,
    PRINTER_BLUEPRINT_ID);
  assert.equal(industryBlueprints.getSelectedBlueprint(itemStore.findItemById(f.processor.itemID)).blueprint_id,
    PROCESSOR_BLUEPRINT_ID);

  const options = { creationHost: {
    creationID: f.ship.itemID,
    moduleItemID: f.printer.itemID,
    characterID: OWNER_ID,
  } };
  assert.equal(industryRuntime.validateFacility(f.session, f.printer.itemID, options).success, true);
  const fittedPrinter = itemStore.findItemById(f.printer.itemID);
  assert.equal(industryRuntime.getFacilityLaneCount(fittedPrinter), 1);
  assert.deepEqual(industryRuntime.getJobLanes(fittedPrinter, f.session)
    .filter(lane => lane.enabled).map(lane => lane.laneID), [1]);
  assert.equal(industryRuntime.startProduction(
    f.session,
    f.printer.itemID,
    PRINTER_BLUEPRINT_ID,
    "unused-invalid-lane-hash",
    1,
    { ...options, laneID: 2 },
  ).errorMsg, "INVALID_JOB_LANE");
  assert.equal(industryRuntime.validateFacility({ ...f.session, stationid: STATION_ID + 1,
    stationid2: STATION_ID + 1, locationid: STATION_ID + 1 }, f.printer.itemID, options).success, false);
  assert.equal(industryRuntime.validateFacility(f.session, f.processor.itemID, options).success, false,
    "the context cannot substitute another fitted Industry module");

  assert.equal(itemStore.moveItemToLocation(f.printer.itemID, f.ship.itemID, CARGO_FLAG, 1,
    { affectsFitting: true }).success, true);
  assert.equal(industryRuntime.validateFacility(f.session, f.printer.itemID, options).success, false,
    "a removed/cargo module cannot retain facility authority");
  assert.equal(industryRuntime.validateFacility({ ...f.session, characterID: OTHER_OWNER_ID,
    charid: OTHER_OWNER_ID }, f.processor.itemID, { creationHost: {
      creationID: f.ship.itemID, moduleItemID: f.processor.itemID, characterID: OTHER_OWNER_ID,
    } }).success, false);
});

test("offline or unpowered Creation Industry modules cannot start jobs and docked jettison cannot drain escrow", t => {
  const f = fixture(t, { docked: true });
  const service = new CreationService();
  const blueprint = industryBlueprints.getBlueprintForFacility(PROCESSOR_TYPE_ID, PROCESSOR_BLUEPRINT_ID);
  assert.notEqual(invoke(service, f, f.processor, "industry_load_blueprint", {
    blueprint_id: PROCESSOR_BLUEPRINT_ID,
  }), false);
  const [inputTypeID, inputSlot] = Object.entries<any>(blueprint.inputs)[0];
  const cargo = grant(OWNER_ID, f.ship.itemID, CARGO_FLAG, Number(inputTypeID), inputSlot.quantity_per_run);
  assert.notEqual(invoke(service, f, f.processor, "industry_deposit_input", {
    items: { [cargo.itemID]: inputSlot.quantity_per_run },
  }), false);
  assert.equal(creationRuntime.setCreationModuleOnlineState(
    itemStore.findItemById(f.ship.itemID), OWNER_ID, f.processor.itemID, false, f.session,
  ).success, true);
  assertCreationError(() => invoke(service, f, f.processor, "industry_start_production", {
    blueprint_id: PROCESSOR_BLUEPRINT_ID,
    blueprint_hash: blueprint.content_hash,
  }), "CreationError_ModuleOffline");
  assert.equal(totalAt(OWNER_ID, f.processor.itemID, industryRuntime.INDUSTRY_INPUT_FLAG,
    Number(inputTypeID)), inputSlot.quantity_per_run);
  assert.equal(creationRuntime.setCreationModuleOnlineState(
    itemStore.findItemById(f.ship.itemID), OWNER_ID, f.processor.itemID, true, f.session,
  ).success, true);
  assert.equal(creationRuntime.setCreationPowerState(
    itemStore.findItemById(f.ship.itemID), OWNER_ID, true,
  ).success, true);
  assertCreationError(() => invoke(service, f, f.processor, "industry_start_production", {
    blueprint_id: PROCESSOR_BLUEPRINT_ID,
    blueprint_hash: blueprint.content_hash,
  }), "CreationError_ModuleOffline");
  assert.equal(totalAt(OWNER_ID, f.processor.itemID, industryRuntime.INDUSTRY_INPUT_FLAG,
    Number(inputTypeID)), inputSlot.quantity_per_run);
  assertCreationError(() => invoke(
    service,
    f,
    f.processor,
    "industry_withdraw_to_jettison_input",
    { items: { [inputTypeID]: inputSlot.quantity_per_run } },
  ), "CreationError_CannotActivate");
  assert.equal(totalAt(OWNER_ID, f.processor.itemID, industryRuntime.INDUSTRY_INPUT_FLAG,
    Number(inputTypeID)), inputSlot.quantity_per_run);
});

test("in-space modular Industry jettison withdraws the requested escrow and returns the spawned can", t => {
  const f = fixture(t);
  const service = new CreationService();
  const blueprint = industryBlueprints.getBlueprintForFacility(PRINTER_TYPE_ID, PRINTER_BLUEPRINT_ID);
  assert.notEqual(invoke(service, f, f.printer, "industry_load_blueprint", {
    blueprint_id: PRINTER_BLUEPRINT_ID,
  }), false);
  const [inputTypeID, inputSlot] = Object.entries<any>(blueprint.inputs)[0];
  const cargo = grant(OWNER_ID, f.ship.itemID, CARGO_FLAG, Number(inputTypeID), inputSlot.quantity_per_run);
  assert.notEqual(invoke(service, f, f.printer, "industry_deposit_input", {
    items: { [cargo.itemID]: inputSlot.quantity_per_run },
  }), false);

  const fillerTypeID = Number(inputTypeID) === 34 ? 35 : 34;
  const cargoFiller = grant(OWNER_ID, f.ship.itemID, CARGO_FLAG, fillerTypeID, 1_000_000_000);

  const jettisonRuntime = require("../src/services/ship/jettisonRuntime");
  const industryNotifications = require("../src/services/frontier/industryNotifications");
  const itemSnapshots = t.mock.method(
    industryNotifications,
    "publishIndustryItemsChanged",
    () => true,
  );
  const containerID = 9900000000123;
  const jettison = t.mock.method(
    jettisonRuntime,
    "jettisonItemQuantitiesFromSourceForSession",
    (_session, moves, options) => {
      assert.equal(options.sourceLocationID, f.printer.itemID);
      assert.deepEqual(options.allowedSourceFlagIDs, [industryRuntime.INDUSTRY_INPUT_FLAG]);
      const moved = itemStore.moveItemsToLocations(moves.map(move => ({
        ...move,
        destinationLocationID: containerID,
        destinationFlagID: 5,
      })));
      assert.equal(moved.success, true, moved.errorMsg);
      return {
        success: true,
        jettisonedToCanIDs: moved.data.moves.map(move => move.movedItemID),
        containerID,
        changes: moved.data.changes,
      };
    },
  );
  const result = invoke(service, f, f.printer, "industry_withdraw_to_jettison_input", {
    items: { [inputTypeID]: inputSlot.quantity_per_run },
  });
  assert.notEqual(result, false);
  assert.equal(result.can_item_id, containerID);
  assert.equal(jettison.mock.callCount(), 1);
  assert.equal(jettison.mock.calls[0].arguments[1].length, 1);
  assert.equal(totalAt(OWNER_ID, f.printer.itemID, industryRuntime.INDUSTRY_INPUT_FLAG,
    Number(inputTypeID)), 0);
  assert.equal(totalAt(OWNER_ID, f.ship.itemID, CARGO_FLAG, Number(inputTypeID)), 0,
    "escrow must never stage through ship cargo");
  assert.equal(totalAt(OWNER_ID, containerID, 5, Number(inputTypeID)), inputSlot.quantity_per_run);
  assert.equal(itemStore.findItemById(cargoFiller.itemID).stacksize, 1_000_000_000,
    "direct jettison remains available even when ship cargo is already full");
  assert.equal(itemSnapshots.mock.callCount(), 1);
  assert.equal(itemSnapshots.mock.calls[0].arguments[1], f.printer.itemID);
  assert.equal(itemSnapshots.mock.calls[0].arguments[2], "inputs");
  assert.deepEqual(itemSnapshots.mock.calls[0].arguments[3], {},
    "the replacement snapshot removes the withdrawn stack from the client tab");
});

test("authorized source jettison commits atomically and presentation failures stay non-retryable", () => {
  const jettisonRuntime = require("../src/services/ship/jettisonRuntime");
  const sourceLocationID = 9900000000200;
  const containerID = 9900000000201;
  const source = grant(
    OWNER_ID,
    sourceLocationID,
    industryRuntime.INDUSTRY_INPUT_FLAG,
    34,
    5,
  );
  let createCalls = 0;
  let syncCalls = 0;
  let broadcastCalls = 0;
  const result = jettisonRuntime.jettisonItemQuantitiesFromSourceForSession(
    {
      characterID: OWNER_ID,
      _space: { shipID: 9900000000199, systemID: SYSTEM_ID },
    },
    [{ itemID: source.itemID, quantity: 3 }],
    {
      sourceLocationID,
      allowedSourceFlagIDs: [industryRuntime.INDUSTRY_INPUT_FLAG],
      _dependencies: {
        createJetcanForSession: () => {
          createCalls += 1;
          return { success: true, data: { containerID } };
        },
        moveItemsToLocations: itemStore.moveItemsToLocations,
        syncChangesToSession: () => {
          syncCalls += 1;
          throw new Error("notification transport unavailable");
        },
        broadcastJetcanLootRightsSlimUpdate: () => {
          broadcastCalls += 1;
          throw new Error("scene presentation unavailable");
        },
      },
    },
  );
  assert.equal(result.success, true, result.errorMsg);
  assert.equal(result.containerID, containerID);
  assert.equal(createCalls, 1);
  assert.equal(syncCalls, 1);
  assert.equal(broadcastCalls, 1);
  assert.equal(itemStore.findItemById(source.itemID).stacksize, 2);
  assert.equal(totalAt(OWNER_ID, containerID, 0, 34), 3,
    "retail jetcan contents use the container-content flag");

  const invalid = jettisonRuntime.jettisonItemQuantitiesFromSourceForSession(
    {
      characterID: OTHER_OWNER_ID,
      _space: { shipID: 9900000000198, systemID: SYSTEM_ID },
    },
    [{ itemID: source.itemID, quantity: 1 }],
    {
      sourceLocationID,
      allowedSourceFlagIDs: [industryRuntime.INDUSTRY_INPUT_FLAG],
      _dependencies: {
        createJetcanForSession: () => {
          createCalls += 1;
          return { success: true, data: { containerID: containerID + 1 } };
        },
      },
    },
  );
  assert.equal(invalid.success, false);
  assert.equal(invalid.errorMsg, "INVALID_SOURCE");
  assert.equal(createCalls, 1, "invalid authority must be rejected before spawning a can");
  assert.equal(itemStore.findItemById(source.itemID).stacksize, 2);

  let expiredContainerID = 0;
  const failedMove = jettisonRuntime.jettisonItemQuantitiesFromSourceForSession(
    {
      characterID: OWNER_ID,
      _space: { shipID: 9900000000199, systemID: SYSTEM_ID },
    },
    [{ itemID: source.itemID, quantity: 1 }],
    {
      sourceLocationID,
      allowedSourceFlagIDs: [industryRuntime.INDUSTRY_INPUT_FLAG],
      _dependencies: {
        createJetcanForSession: () => ({
          success: true,
          data: { containerID: containerID + 2 },
        }),
        moveItemsToLocations: () => ({ success: false, errorMsg: "WRITE_ERROR" }),
        maybeExpireEmptySpaceContainer: (_session, itemID) => {
          expiredContainerID = itemID;
        },
      },
    },
  );
  assert.equal(failedMove.success, false);
  assert.equal(failedMove.errorMsg, "WRITE_ERROR");
  assert.equal(expiredContainerID, containerID + 2);
  assert.equal(itemStore.findItemById(source.itemID).stacksize, 2,
    "a failed batch move cannot consume any escrow quantity");
});
