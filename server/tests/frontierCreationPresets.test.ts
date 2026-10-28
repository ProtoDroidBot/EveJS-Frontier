import assert = require("node:assert/strict");
import test = require("node:test");

const database = require("../src/gameStore");
const sqliteStore = require("../src/gameStore/sqliteStore");
const itemStore = require("../src/services/inventory/itemStore");
const liveFittingState = require("../src/services/fitting/liveFittingState");
const creationRuntime = require("../src/services/frontier/creationRuntime");
const presetRuntime = require("../src/services/frontier/creationPresetRuntime");
const presetStore = require("../src/services/frontier/creationPresetStore");
const CreationService = require("../src/services/frontier/creationService");
const {
  unwrapMarshalValue,
} = require("../src/services/_shared/serviceHelpers");

const OWNER_ID = 140000004;
const OTHER_OWNER_ID = 140000002;
const SYSTEM_ID = 30000004;
const CREATION_TYPE_ID = 95735;

function createCreation(typeID = CREATION_TYPE_ID) {
  const grant = itemStore.grantItemToCharacterLocation(
    OWNER_ID,
    SYSTEM_ID,
    0,
    typeID,
    1,
    { individualItems: true, singleton: 1 },
  );
  assert.equal(grant.success, true, grant.errorMsg);
  const ship = grant.data.items[0];
  const ensured = creationRuntime.ensureCreationState(ship, OWNER_ID);
  assert.equal(ensured.success, true, ensured.errorMsg);
  return {
    ship: itemStore.findShipItemById(ship.itemID),
    state: ensured.data.state,
  };
}

test("Creation presets persist logical layouts with owner-isolated CRUD", () => {
  const fixture = createCreation();
  const saved = presetRuntime.saveCreationPreset(
    fixture.ship,
    OWNER_ID,
    "Refuge baseline",
    "Validated build layout",
    { presetID: "preset-owner-crud", nowMs: 1000 },
  );
  assert.equal(saved.success, true, JSON.stringify(saved.diagnostics));
  assert.equal(saved.data.ownerID, OWNER_ID);
  assert.equal(saved.data.revision, 1);
  assert.equal(saved.data.creationTypeID, CREATION_TYPE_ID);
  assert.equal(saved.data.schemaVersion, 2);
  assert.match(saved.data.compositionHash, /^[0-9a-f]{64}$/);
  assert.match(saved.data.sdeFingerprint, /^[0-9a-f]{64}$/);
  assert.ok(saved.data.composition.interiorModules.length > 0);
  assert.ok(saved.data.composition.interiorModules.every((entry) =>
    entry.rotationX === 0 && entry.rotationY === 0));
  assert.ok(saved.data.composition.hardpoints.length > 0);
  assert.equal(JSON.stringify(saved.data).includes("itemID"), false);

  const reflectedState = JSON.parse(JSON.stringify(fixture.state));
  reflectedState.interiorPlacements[0].rotation.x = 180;
  reflectedState.interiorPlacements[0].rotation.y = 180;
  const reflected = presetRuntime._buildCanonicalCompositionForTests(
    reflectedState,
    creationRuntime.ensureCreationState(fixture.ship, OWNER_ID).data.template,
  );
  assert.equal(reflected.success, true, JSON.stringify(reflected.diagnostics));
  const reflectedNode = reflected.data.interiorModules.find((entry) =>
    entry.typeID === reflectedState.modules.find((module) =>
      module.itemID === reflectedState.interiorPlacements[0].itemID).typeID &&
    entry.partID === reflectedState.interiorPlacements[0].partID &&
    entry.x === reflectedState.interiorPlacements[0].x &&
    entry.y === reflectedState.interiorPlacements[0].y);
  assert.equal(reflectedNode.rotationX, 180);
  assert.equal(reflectedNode.rotationY, 180);

  assert.equal(presetStore.listCreationPresets(OWNER_ID).length, 1);
  assert.equal(presetStore.listCreationPresets(OTHER_OWNER_ID).length, 0);
  assert.equal(
    presetStore.getCreationPreset(OTHER_OWNER_ID, saved.data.presetID),
    null,
  );

  const renamed = presetStore.updateCreationPresetMetadata(
    OWNER_ID,
    saved.data.presetID,
    { name: "Renamed", description: "Updated" },
    { nowMs: 2000 },
  );
  assert.equal(renamed.success, true, renamed.errorMsg);
  assert.equal(renamed.data.name, "Renamed");
  assert.equal(renamed.data.revision, 2);

  const deniedDelete = presetStore.deleteCreationPreset(
    OTHER_OWNER_ID,
    saved.data.presetID,
  );
  assert.equal(deniedDelete.success, false);
  assert.ok(presetStore.getCreationPreset(OWNER_ID, saved.data.presetID));

  const removed = presetStore.deleteCreationPreset(OWNER_ID, saved.data.presetID);
  assert.equal(removed.success, true, removed.errorMsg);
  assert.equal(presetStore.getCreationPreset(OWNER_ID, saved.data.presetID), null);

  const persisted = database.read("creationPresets", `/owners/${OWNER_ID}`);
  assert.equal(persisted.success, true);
  assert.deepEqual(persisted.data.presets, {});
});

test("Creation presets survive a SQLite backend restart with their owner and composition", () => {
  const fixture = createCreation();
  const saved = presetRuntime.saveCreationPreset(
    fixture.ship,
    OWNER_ID,
    "Restart durable",
    "Must survive a storage connection restart",
    { presetID: "preset-restart-durable", nowMs: 2500 },
  );
  assert.equal(saved.success, true, JSON.stringify(saved.diagnostics));
  assert.equal(database.flushTablesSync(["creationPresets"]).success, true);

  database._closeSqliteForTests();
  sqliteStore.init(database._sqliteDbPath);
  const restartedTable = sqliteStore.loadTableObject("creationPresets");
  const restarted = restartedTable.owners[String(OWNER_ID)]
    .presets[saved.data.presetID];
  assert.equal(restarted.name, "Restart durable");
  assert.equal(restarted.ownerID, OWNER_ID);
  assert.equal(restarted.compositionHash, saved.data.compositionHash);
  assert.deepEqual(restarted.composition, saved.data.composition);
});

test("preview resolves cargo modules and apply atomically restores the saved layout", () => {
  presetRuntime._resetCreationPresetPreviewTokensForTests();
  const fixture = createCreation();
  const saved = presetRuntime.saveCreationPreset(
    fixture.ship,
    OWNER_ID,
    "Restore exterior",
    "",
    { presetID: "preset-atomic-apply", nowMs: 3000 },
  );
  assert.equal(saved.success, true, JSON.stringify(saved.diagnostics));

  const original = creationRuntime.ensureCreationState(fixture.ship, OWNER_ID).data.state;
  const hardpoint = original.hardpoints.find((entry) => entry.attachedItemID != null);
  assert.ok(hardpoint, "expected an authored exterior attachment");
  const exteriorItemID = Number(hardpoint.attachedItemID);
  const move = itemStore.moveItemToLocation(
    exteriorItemID,
    fixture.ship.itemID,
    itemStore.ITEM_FLAGS.CARGO_HOLD,
  );
  assert.equal(move.success, true, move.errorMsg);
  assert.equal(liveFittingState.getTypeDogmaEffects(
    itemStore.findItemById(exteriorItemID).typeID,
  ).has(16), true);
  assert.equal(itemStore.updateInventoryItem(exteriorItemID, (item) => ({
    ...item,
    moduleState: { ...(item.moduleState || {}), online: true },
  })).success, true);
  const damagedState = JSON.parse(JSON.stringify(original));
  damagedState.modules = damagedState.modules.filter(
    (entry) => Number(entry.itemID) !== exteriorItemID,
  );
  damagedState.hardpoints.find(
    (entry) => Number(entry.attachedItemID) === exteriorItemID,
  ).attachedItemID = null;
  const shipUpdate = itemStore.updateShipItem(fixture.ship.itemID, (current) => {
    const customInfo = JSON.parse(current.customInfo || "{}");
    customInfo[creationRuntime.CREATION_STATE_KEY] = damagedState;
    return { ...current, customInfo: JSON.stringify(customInfo) };
  });
  assert.equal(shipUpdate.success, true, shipUpdate.errorMsg);

  const preview = presetRuntime.previewCreationPreset(
    shipUpdate.data,
    OWNER_ID,
    saved.data.presetID,
    { token: "preview-atomic-apply", nowMs: Date.now() },
  );
  assert.equal(preview.success, true, JSON.stringify(preview.diagnostics));
  assert.ok(preview.data.additions.some((entry) => entry.quantity === 1));
  assert.equal(preview.data.missing.length, 0);

  const applied = presetRuntime.applyCreationPreset(
    shipUpdate.data,
    OWNER_ID,
    saved.data.presetID,
    preview.data.previewToken,
  );
  assert.equal(applied.success, true, JSON.stringify(applied.diagnostics));
  const restoredItem = itemStore.findItemById(exteriorItemID);
  assert.equal(restoredItem.locationID, fixture.ship.itemID);
  assert.equal(restoredItem.flagID, creationRuntime.CREATION_FITTING_FLAG_ID);
  assert.equal(
    creationRuntime.isCreationModuleOnline(restoredItem),
    false,
    "applying a preset leaves an incoming component offline",
  );
  const restoredState = creationRuntime.readCreationState(
    itemStore.findShipItemById(fixture.ship.itemID),
  );
  assert.ok(restoredState.modules.some(
    (entry) => Number(entry.itemID) === exteriorItemID,
  ));
  assert.ok(restoredState.hardpoints.some(
    (entry) => Number(entry.attachedItemID) === exteriorItemID,
  ));
});

test("apply rejects a preview after ship inventory changes", () => {
  presetRuntime._resetCreationPresetPreviewTokensForTests();
  const fixture = createCreation();
  const saved = presetRuntime.saveCreationPreset(
    fixture.ship,
    OWNER_ID,
    "Optimistic lock",
    "",
    { presetID: "preset-stale-preview", nowMs: 5000 },
  );
  assert.equal(saved.success, true, JSON.stringify(saved.diagnostics));
  const preview = presetRuntime.previewCreationPreset(
    fixture.ship,
    OWNER_ID,
    saved.data.presetID,
    { token: "preview-stale", nowMs: Date.now() },
  );
  assert.equal(preview.success, true, JSON.stringify(preview.diagnostics));

  const cargoMutation = itemStore.grantItemToCharacterLocation(
    OWNER_ID,
    fixture.ship.itemID,
    itemStore.ITEM_FLAGS.CARGO_HOLD,
    82126,
    1,
    { singleton: 0 },
  );
  assert.equal(cargoMutation.success, true, cargoMutation.errorMsg);

  const applied = presetRuntime.applyCreationPreset(
    fixture.ship,
    OWNER_ID,
    saved.data.presetID,
    preview.data.previewToken,
  );
  assert.equal(applied.success, false);
  assert.ok(applied.diagnostics.some(
    (entry) => entry.params.reason === "PRESET_PREVIEW_STALE",
  ));
});

test("preview reports every missing component without issuing an apply token", () => {
  presetRuntime._resetCreationPresetPreviewTokensForTests();
  const fixture = createCreation();
  const saved = presetRuntime.saveCreationPreset(
    fixture.ship,
    OWNER_ID,
    "Missing component",
    "",
    { presetID: "preset-missing-component", nowMs: 5500 },
  );
  assert.equal(saved.success, true, JSON.stringify(saved.diagnostics));

  const current = creationRuntime.ensureCreationState(
    fixture.ship,
    OWNER_ID,
  ).data.state;
  const hardpoint = current.hardpoints.find((entry) => entry.attachedItemID != null);
  assert.ok(hardpoint);
  const removedItemID = Number(hardpoint.attachedItemID);
  const removedTypeID = Number(current.modules.find(
    (entry) => Number(entry.itemID) === removedItemID,
  ).typeID);
  assert.equal(itemStore.removeInventoryItem(removedItemID).success, true);
  const damagedState = JSON.parse(JSON.stringify(current));
  damagedState.modules = damagedState.modules.filter(
    (entry) => Number(entry.itemID) !== removedItemID,
  );
  damagedState.hardpoints.find(
    (entry) => Number(entry.attachedItemID) === removedItemID,
  ).attachedItemID = null;
  const shipUpdate = itemStore.updateShipItem(fixture.ship.itemID, (ship) => {
    const customInfo = JSON.parse(ship.customInfo || "{}");
    customInfo[creationRuntime.CREATION_STATE_KEY] = damagedState;
    return { ...ship, customInfo: JSON.stringify(customInfo) };
  });
  assert.equal(shipUpdate.success, true, shipUpdate.errorMsg);

  const preview = presetRuntime.previewCreationPreset(
    shipUpdate.data,
    OWNER_ID,
    saved.data.presetID,
    { token: "must-not-be-issued", nowMs: Date.now() },
  );
  assert.equal(preview.success, false);
  assert.ok(preview.diagnostics.some(
    (entry) => entry.params.reason === "PRESET_COMPONENTS_MISSING",
  ));
  assert.deepEqual(preview.data.missing, [
    { typeID: removedTypeID, quantity: 1 },
  ]);
  assert.equal(preview.data.previewToken, undefined);
});

test("preview blocks removal of an industry module with an active job", () => {
  presetRuntime._resetCreationPresetPreviewTokensForTests();
  const fixture = createCreation(95276);
  const original = creationRuntime.ensureCreationState(
    fixture.ship,
    OWNER_ID,
  ).data.state;
  const printer = original.modules.find((entry) => Number(entry.typeID) === 95302);
  assert.ok(printer, "expected the authored industry printer");

  const withoutPrinter = JSON.parse(JSON.stringify(original));
  withoutPrinter.modules = withoutPrinter.modules.filter(
    (entry) => Number(entry.itemID) !== Number(printer.itemID),
  );
  withoutPrinter.interiorPlacements = withoutPrinter.interiorPlacements.filter(
    (entry) => Number(entry.itemID) !== Number(printer.itemID),
  );
  assert.equal(itemStore.moveItemToLocation(
    printer.itemID,
    fixture.ship.itemID,
    itemStore.ITEM_FLAGS.CARGO_HOLD,
  ).success, true);
  let shipUpdate = itemStore.updateShipItem(fixture.ship.itemID, (ship) => {
    const customInfo = JSON.parse(ship.customInfo || "{}");
    customInfo[creationRuntime.CREATION_STATE_KEY] = withoutPrinter;
    return { ...ship, customInfo: JSON.stringify(customInfo) };
  });
  assert.equal(shipUpdate.success, true, shipUpdate.errorMsg);
  const saved = presetRuntime.saveCreationPreset(
    shipUpdate.data,
    OWNER_ID,
    "No printer",
    "",
    { presetID: "preset-blocked-industry-removal", nowMs: 5750 },
  );
  assert.equal(saved.success, true, JSON.stringify(saved.diagnostics));

  assert.equal(itemStore.moveItemToLocation(
    printer.itemID,
    fixture.ship.itemID,
    creationRuntime.CREATION_FITTING_FLAG_ID,
  ).success, true);
  shipUpdate = itemStore.updateShipItem(fixture.ship.itemID, (ship) => {
    const customInfo = JSON.parse(ship.customInfo || "{}");
    customInfo[creationRuntime.CREATION_STATE_KEY] = original;
    return { ...ship, customInfo: JSON.stringify(customInfo) };
  });
  assert.equal(shipUpdate.success, true, shipUpdate.errorMsg);
  const productionUpdate = itemStore.updateInventoryItem(
    printer.itemID,
    (item) => ({
      ...item,
      customInfo: JSON.stringify({
        evejsFrontierIndustry: {
          version: 1,
          blueprintID: 1510,
          production: {
            version: 1,
            jobID: 991,
            state: "RUNNING",
            requestedRuns: 1,
            completedRuns: 0,
            runStartedAtMs: 1,
            runEndAtMs: Date.now() + 60_000,
            stopReason: null,
          },
        },
      }),
    }),
  );
  assert.equal(productionUpdate.success, true, productionUpdate.errorMsg);

  const preview = presetRuntime.previewCreationPreset(
    shipUpdate.data,
    OWNER_ID,
    saved.data.presetID,
    { token: "blocked-removal", nowMs: Date.now() },
  );
  assert.equal(preview.success, false);
  assert.ok(preview.diagnostics.some((entry) =>
    entry.params.reason === "INDUSTRY_JOB_ACTIVE" &&
    entry.params.jobID === 991));
  assert.equal(preview.data.previewToken, undefined);
});

test("preview rejects an SDE-stale preset before resolving inventory", () => {
  const fixture = createCreation();
  const saved = presetRuntime.saveCreationPreset(
    fixture.ship,
    OWNER_ID,
    "Stale SDE",
    "",
    { presetID: "preset-stale-sde", nowMs: 5800 },
  );
  assert.equal(saved.success, true, JSON.stringify(saved.diagnostics));
  const stale = presetStore.getCreationPreset(OWNER_ID, saved.data.presetID);
  stale.sdeFingerprint = "0".repeat(64);
  assert.equal(database.write(
    "creationPresets",
    `/owners/${OWNER_ID}/presets/${saved.data.presetID}`,
    stale,
  ).success, true);
  assert.equal(database.flushTablesSync(["creationPresets"]).success, true);

  const preview = presetRuntime.previewCreationPreset(
    fixture.ship,
    OWNER_ID,
    saved.data.presetID,
  );
  assert.equal(preview.success, false);
  assert.equal(preview.diagnostics[0].params.reason, "PRESET_SDE_STALE");
});

test("preset revision and one-shot preview tokens enforce optimistic concurrency", () => {
  presetRuntime._resetCreationPresetPreviewTokensForTests();
  const fixture = createCreation();
  const saved = presetRuntime.saveCreationPreset(
    fixture.ship,
    OWNER_ID,
    "Concurrent apply",
    "",
    { presetID: "preset-concurrency", nowMs: 5900 },
  );
  assert.equal(saved.success, true, JSON.stringify(saved.diagnostics));
  const stalePreview = presetRuntime.previewCreationPreset(
    fixture.ship,
    OWNER_ID,
    saved.data.presetID,
    { token: "revision-bound-token", nowMs: Date.now() },
  );
  assert.equal(stalePreview.success, true, JSON.stringify(stalePreview.diagnostics));
  assert.equal(presetStore.updateCreationPresetMetadata(
    OWNER_ID,
    saved.data.presetID,
    { name: "Revision two" },
    { nowMs: 5901 },
  ).success, true);
  const revisionRejected = presetRuntime.applyCreationPreset(
    fixture.ship,
    OWNER_ID,
    saved.data.presetID,
    stalePreview.data.previewToken,
  );
  assert.equal(revisionRejected.success, false);
  assert.equal(
    revisionRejected.diagnostics[0].params.reason,
    "PRESET_REVISION_CHANGED",
  );

  const currentPreview = presetRuntime.previewCreationPreset(
    fixture.ship,
    OWNER_ID,
    saved.data.presetID,
    { token: "one-shot-token", nowMs: Date.now() },
  );
  assert.equal(currentPreview.success, true, JSON.stringify(currentPreview.diagnostics));
  const firstApply = presetRuntime.applyCreationPreset(
    fixture.ship,
    OWNER_ID,
    saved.data.presetID,
    currentPreview.data.previewToken,
  );
  assert.equal(firstApply.success, true, JSON.stringify(firstApply.diagnostics));
  const secondApply = presetRuntime.applyCreationPreset(
    fixture.ship,
    OWNER_ID,
    saved.data.presetID,
    currentPreview.data.previewToken,
  );
  assert.equal(secondApply.success, false);
  assert.equal(
    secondApply.diagnostics[0].params.reason,
    "PRESET_PREVIEW_TOKEN_INVALID",
  );
});

test("one cargo stack can atomically satisfy repeated preset components", () => {
  presetRuntime._resetCreationPresetPreviewTokensForTests();
  const fixture = createCreation();
  const saved = presetRuntime.saveCreationPreset(
    fixture.ship,
    OWNER_ID,
    "Stack resolution",
    "",
    { presetID: "preset-stack-resolution", nowMs: 6000 },
  );
  assert.equal(saved.success, true, JSON.stringify(saved.diagnostics));

  const original = creationRuntime.ensureCreationState(fixture.ship, OWNER_ID).data.state;
  const modulesByID = new Map<number, any>(
    original.modules.map((entry) => [Number(entry.itemID), entry]),
  );
  const attachedByType = new Map<number, any[]>();
  for (const hardpoint of original.hardpoints.filter(
    (entry) => entry.attachedItemID != null,
  )) {
    const module = modulesByID.get(Number(hardpoint.attachedItemID));
    const entries = attachedByType.get(Number(module.typeID)) || [];
    entries.push(hardpoint);
    attachedByType.set(Number(module.typeID), entries);
  }
  const repeated = [...attachedByType.entries()]
    .find(([, entries]) => entries.length >= 2);
  assert.ok(repeated, "expected a repeated authored exterior type");
  const [typeID, hardpoints] = repeated;
  const removedItemIDs = hardpoints.slice(0, 2)
    .map((entry) => Number(entry.attachedItemID));
  for (const itemID of removedItemIDs) {
    const removed = itemStore.removeInventoryItem(itemID);
    assert.equal(removed.success, true, removed.errorMsg);
  }
  const damagedState = JSON.parse(JSON.stringify(original));
  damagedState.modules = damagedState.modules.filter(
    (entry) => !removedItemIDs.includes(Number(entry.itemID)),
  );
  for (const hardpoint of damagedState.hardpoints) {
    if (removedItemIDs.includes(Number(hardpoint.attachedItemID))) {
      hardpoint.attachedItemID = null;
    }
  }
  const shipUpdate = itemStore.updateShipItem(fixture.ship.itemID, (current) => {
    const customInfo = JSON.parse(current.customInfo || "{}");
    customInfo[creationRuntime.CREATION_STATE_KEY] = damagedState;
    return { ...current, customInfo: JSON.stringify(customInfo) };
  });
  assert.equal(shipUpdate.success, true, shipUpdate.errorMsg);
  const stackGrant = itemStore.grantItemToCharacterLocation(
    OWNER_ID,
    fixture.ship.itemID,
    itemStore.ITEM_FLAGS.CARGO_HOLD,
    typeID,
    2,
    { singleton: 0 },
  );
  assert.equal(stackGrant.success, true, stackGrant.errorMsg);
  assert.equal(stackGrant.data.items.length, 1);
  assert.equal(stackGrant.data.items[0].stacksize, 2);

  const preview = presetRuntime.previewCreationPreset(
    shipUpdate.data,
    OWNER_ID,
    saved.data.presetID,
    { token: "preview-stack", nowMs: Date.now() },
  );
  assert.equal(preview.success, true, JSON.stringify(preview.diagnostics));
  assert.ok(preview.data.additions.some(
    (entry) => entry.typeID === typeID && entry.quantity === 2,
  ));
  assert.equal(preview.data.missing.length, 0);

  const applied = presetRuntime.applyCreationPreset(
    shipUpdate.data,
    OWNER_ID,
    saved.data.presetID,
    preview.data.previewToken,
  );
  assert.equal(applied.success, true, JSON.stringify(applied.diagnostics));
  const restored = creationRuntime.readCreationState(
    itemStore.findShipItemById(fixture.ship.itemID),
  );
  const restoredIDs = restored.hardpoints
    .map((entry) => Number(entry.attachedItemID))
    .filter((itemID) => {
      const module = restored.modules.find((entry) => Number(entry.itemID) === itemID);
      return module && Number(module.typeID) === typeID;
    });
  assert.ok(new Set(restoredIDs).size >= 2);
  for (const itemID of restoredIDs) {
    const fitted = itemStore.findItemById(itemID);
    assert.equal(fitted.flagID, creationRuntime.CREATION_FITTING_FLAG_ID);
    assert.equal(fitted.singleton, 1);
  }
});

test("Creation preset RPCs require the active ship and emit one apply notification", () => {
  presetRuntime._resetCreationPresetPreviewTokensForTests();
  const fixture = createCreation();
  const notifications: any[] = [];
  const session = {
    characterID: OWNER_ID,
    activeShipID: fixture.ship.itemID,
    sendNotification(name, idType, payload) {
      notifications.push({ name, idType, payload });
    },
  };
  const service = new CreationService();
  const inactive = unwrapMarshalValue(service.Handle_save_preset(
    [fixture.ship.itemID + 1, "Denied", ""],
    session,
  ));
  assert.equal(inactive.success, false);
  assert.equal(inactive.diagnostics[0].params.reason, "ACTIVE_CREATION_REQUIRED");

  const saved = unwrapMarshalValue(service.Handle_save_preset(
    [fixture.ship.itemID, "RPC preset", ""],
    session,
  ));
  assert.equal(saved.success, true, JSON.stringify(saved.diagnostics));
  const listed = unwrapMarshalValue(service.Handle_list_presets([], session));
  assert.ok(listed.some((entry) => entry.presetID === saved.data.presetID));
  const listedPreset = listed.find(
    (entry) => entry.presetID === saved.data.presetID,
  );
  assert.ok(listedPreset.summary.moduleCount > 0);
  assert.ok(listedPreset.summary.cellCount > 0);
  assert.equal(listedPreset.summary.sdeCompatible, true);
  const otherSession = {
    characterID: OTHER_OWNER_ID,
    activeShipID: fixture.ship.itemID,
  };
  assert.deepEqual(
    unwrapMarshalValue(service.Handle_list_presets([], otherSession)),
    [],
  );
  const deniedRename = unwrapMarshalValue(service.Handle_rename_preset(
    [saved.data.presetID, "Stolen", ""],
    otherSession,
  ));
  assert.equal(deniedRename.success, false);
  assert.equal(deniedRename.diagnostics[0].params.reason, "PRESET_NOT_FOUND");

  const preview = unwrapMarshalValue(service.Handle_preview_preset(
    [fixture.ship.itemID, saved.data.presetID],
    session,
  ));
  assert.equal(preview.success, true, JSON.stringify(preview.diagnostics));
  const applied = unwrapMarshalValue(service.Handle_apply_preset(
    [fixture.ship.itemID, saved.data.presetID, preview.data.previewToken],
    session,
  ));
  assert.equal(applied.success, true, JSON.stringify(applied.diagnostics));
  assert.equal(
    notifications.filter((entry) => entry.name === "OnCreationChanged").length,
    1,
  );
});
