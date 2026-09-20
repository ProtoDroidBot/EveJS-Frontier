"use strict";

/**
 * Build-3502403 Creation passive-scan and EM-signature Dogma coverage.
 */

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  unwrapMarshalValue,
} = require("../src/services/_shared/serviceHelpers");
const creationRuntime = require("../src/services/frontier/creationRuntime");
const passiveScanningRuntime = require(
  "../src/services/frontier/passiveScanningRuntime",
);
const scanningRuntime = require("../src/services/frontier/scanningRuntime");
const liveFittingState = require(
  "../src/services/fitting/liveFittingState",
);

const TYPE_CREATION = 95276;
const TYPE_ION_SENSOR = 95321;
const TYPE_COMMAND_POD = 95323;
const TYPE_ION_TUBE = 95678;
const TYPE_GRAVITY_CHAMBER = 95680;
const TYPE_GRAVITY_SENSOR = 95718;
const TYPE_EM_SCRAMBLER = 95763;
const TYPE_TRANSPONDER = 95988;
// Real spaceComponentsByType row with baseSignature 2.
const TYPE_SIGNATURE_TARGET = 23;

const ATTRIBUTE_SIGNATURE_EM = 6094;
const ATTRIBUTE_PASSIVE_SCAN_GRAV_STRENGTH = 6139;
const ATTRIBUTE_PASSIVE_SCAN_GRAV_RESOLUTION = 6168;
const ATTRIBUTE_PASSIVE_SCAN_EM_RESOLUTION = 6171;
const ATTRIBUTE_PASSIVE_SCAN_EM_STRENGTH = 6173;

function approximatelyEqual(actual, expected, epsilon = 1.0e-6) {
  assert.ok(
    Math.abs(Number(actual) - Number(expected)) <= epsilon,
    `expected ${actual} to be within ${epsilon} of ${expected}`,
  );
}

function buildCreationEntity(moduleSpecs: any[] = []) {
  const shipItem = { typeID: TYPE_CREATION };
  const moduleItems = moduleSpecs.map((spec, index) => ({
    itemID: 90_000 + index,
    typeID: Number(spec.typeID),
    moduleState: { online: spec.online !== false },
  }));
  const moduleEntries =
    creationRuntime.buildCreationShipAttributeModifierEntries(moduleItems);
  const intrinsicEntries =
    creationRuntime.buildCreationIntrinsicShipAttributeModifierEntries(
      shipItem,
      moduleItems,
      { moduleModifierEntries: moduleEntries },
    );
  const attributes = liveFittingState.buildEffectiveItemAttributeMap(shipItem);
  liveFittingState.applyModifierGroups(attributes, [
    ...moduleEntries,
    ...intrinsicEntries,
  ]);
  return {
    typeID: TYPE_CREATION,
    passiveDerivedState: { attributes },
  };
}

function addActiveEffectToEntity(entity, moduleTypeID, effectID) {
  const entries: any[] = [];
  liveFittingState.appendDirectModifierEntries(
    entries,
    liveFittingState.buildEffectiveItemAttributeMap(moduleTypeID),
    [liveFittingState.getEffectTypeRecord(effectID)],
    "frontierCreationModule",
  );
  liveFittingState.applyModifierGroups(
    entity.passiveDerivedState.attributes,
    entries,
  );
  return entity;
}

test("online passive sensors and support modules apply their authored Dogma", () => {
  const ionEntity = buildCreationEntity([
    { typeID: TYPE_ION_SENSOR },
    { typeID: TYPE_ION_TUBE },
  ]);
  const ionAttributes = ionEntity.passiveDerivedState.attributes;
  approximatelyEqual(ionAttributes[ATTRIBUTE_PASSIVE_SCAN_EM_STRENGTH], 7.65);
  approximatelyEqual(ionAttributes[ATTRIBUTE_PASSIVE_SCAN_EM_RESOLUTION], 7);

  const gravEntity = buildCreationEntity([
    { typeID: TYPE_GRAVITY_SENSOR },
    { typeID: TYPE_GRAVITY_CHAMBER },
  ]);
  const gravAttributes = gravEntity.passiveDerivedState.attributes;
  approximatelyEqual(
    gravAttributes[ATTRIBUTE_PASSIVE_SCAN_GRAV_STRENGTH],
    5.46,
  );
  approximatelyEqual(
    gravAttributes[ATTRIBUTE_PASSIVE_SCAN_GRAV_RESOLUTION],
    1.5,
  );

  const commandEntity = buildCreationEntity([{ typeID: TYPE_COMMAND_POD }]);
  approximatelyEqual(
    commandEntity.passiveDerivedState.attributes[
      ATTRIBUTE_PASSIVE_SCAN_GRAV_STRENGTH
    ],
    0.05,
  );
  // Effect 12919 adds 45 to the attribute's authored default of 10.
  approximatelyEqual(
    commandEntity.passiveDerivedState.attributes[
      ATTRIBUTE_PASSIVE_SCAN_GRAV_RESOLUTION
    ],
    55,
  );
});

test("offline and Creation-powered-off module views contribute no scan authority", () => {
  const offlineEntity = buildCreationEntity([
    { typeID: TYPE_ION_SENSOR, online: false },
    { typeID: TYPE_ION_TUBE, online: false },
    { typeID: TYPE_GRAVITY_SENSOR, online: false },
    { typeID: TYPE_GRAVITY_CHAMBER, online: false },
    { typeID: TYPE_COMMAND_POD, online: false },
  ]);
  assert.deepEqual(
    scanningRuntime.resolvePassiveScannerProfile(offlineEntity).channels,
    [],
  );

  const sensorOnly = buildCreationEntity([
    { typeID: TYPE_ION_SENSOR },
    { typeID: TYPE_ION_TUBE, online: false },
  ]);
  const channel = scanningRuntime.resolvePassiveScannerProfile(sensorOnly)
    .channels.find((entry) => (
      entry.signatureType === scanningRuntime.SIGNATURE_TYPE_ELECTROMAGNETIC
    ));
  assert.ok(channel);
  approximatelyEqual(channel.strength, 7);
  approximatelyEqual(channel.resolution, 7);
});

test("EM Scrambler reduction and active Transponder bloom affect target signature", () => {
  const neutral = buildCreationEntity();
  const scrambled = buildCreationEntity([{ typeID: TYPE_EM_SCRAMBLER }]);
  const offlineScrambler = buildCreationEntity([
    { typeID: TYPE_EM_SCRAMBLER, online: false },
  ]);
  approximatelyEqual(
    neutral.passiveDerivedState.attributes[ATTRIBUTE_SIGNATURE_EM],
    100,
  );
  approximatelyEqual(
    scrambled.passiveDerivedState.attributes[ATTRIBUTE_SIGNATURE_EM],
    40,
  );
  approximatelyEqual(
    scanningRuntime.resolveEntityEmSignatureMultiplier(scrambled, 1_000),
    0.4,
  );
  approximatelyEqual(
    scanningRuntime.resolveEntityEmSignatureMultiplier(offlineScrambler, 1_000),
    1,
  );

  const broadcasting = addActiveEffectToEntity(
    buildCreationEntity(),
    TYPE_TRANSPONDER,
    12972,
  );
  approximatelyEqual(
    broadcasting.passiveDerivedState.attributes[ATTRIBUTE_SIGNATURE_EM],
    200,
  );
  approximatelyEqual(
    scanningRuntime.resolveEntityEmSignatureMultiplier(broadcasting, 1_000),
    2,
  );

  const combined = addActiveEffectToEntity(
    buildCreationEntity([{ typeID: TYPE_EM_SCRAMBLER }]),
    TYPE_TRANSPONDER,
    12972,
  );
  approximatelyEqual(
    combined.passiveDerivedState.attributes[ATTRIBUTE_SIGNATURE_EM],
    140,
  );
  approximatelyEqual(
    scanningRuntime.resolveEntityEmSignatureMultiplier(combined, 1_000),
    1.4,
  );
});

test("support-module strength and sensor resolution change passive reveal output", () => {
  const target = {
    itemID: 71_001,
    typeID: TYPE_SIGNATURE_TARGET,
    position: { x: 0, y: 0, z: 50_000_000 },
    emSignatureMultiplier: 1,
  };
  const sensorProfile = scanningRuntime.resolvePassiveScannerProfile(
    buildCreationEntity([{ typeID: TYPE_ION_SENSOR }]),
  );
  const boostedProfile = scanningRuntime.resolvePassiveScannerProfile(
    buildCreationEntity([
      { typeID: TYPE_ION_SENSOR },
      { typeID: TYPE_ION_TUBE },
    ]),
  );
  const sensorScan = scanningRuntime.performPassiveScan({
    originPosition: { x: 0, y: 0, z: 0 },
    scannerProfile: sensorProfile,
    candidates: [target],
  });
  const boostedScan = scanningRuntime.performPassiveScan({
    originPosition: { x: 0, y: 0, z: 0 },
    scannerProfile: boostedProfile,
    candidates: [target],
    previousScanIds: sensorScan.scanIds,
  });
  assert.deepEqual(sensorScan.resolvedIds, []);
  assert.equal(sensorScan.updatedScans.length, 1);
  assert.deepEqual(boostedScan.resolvedIds, [target.itemID]);
  assert.deepEqual(boostedScan.removed, [target.itemID]);
  assert.deepEqual(
    boostedScan.removedReasonsByScanId.get(target.itemID),
    [scanningRuntime.UPDATE_RESOLVED_TO_ITEM, target.itemID],
  );

  const coarseProfile = {
    channels: sensorProfile.channels.map((channel) => ({
      ...channel,
      resolution: 10,
    })),
  };
  const fineProfile = {
    channels: sensorProfile.channels.map((channel) => ({
      ...channel,
      resolution: 1,
    })),
  };
  const signatureOnlyConfig = { renderResolvedObjects: false };
  const coarse = scanningRuntime.performPassiveScan({
    originPosition: { x: 0, y: 0, z: 0 },
    scannerProfile: coarseProfile,
    candidates: [target],
    resolutionConfig: signatureOnlyConfig,
  });
  const fine = scanningRuntime.performPassiveScan({
    originPosition: { x: 0, y: 0, z: 0 },
    scannerProfile: fineProfile,
    candidates: [target],
    resolutionConfig: signatureOnlyConfig,
  });
  assert.ok(fine.updatedScans[0].radius < coarse.updatedScans[0].radius);
});

test("passive runtime publishes exact update order and resolves into ballpark", () => {
  const observer: Record<string, any> = buildCreationEntity([
    { typeID: TYPE_ION_SENSOR },
  ]);
  Object.assign(observer, {
    itemID: 72_001,
    position: { x: 0, y: 0, z: 0 },
  });
  const target: Record<string, any> = {
    itemID: 72_002,
    typeID: TYPE_SIGNATURE_TARGET,
    position: { x: 0, y: 0, z: 50_000_000 },
  };
  const notifications: any[] = [];
  const resolutions: any[] = [];
  const session: Record<string, any> = {
    _space: { shipID: observer.itemID },
    sendNotification(name, idType, payload) {
      notifications.push({ name, idType, payload });
    },
  };
  const scene: Record<string, any> = {
    sessions: new Map([[1, session]]),
    getShipEntityForSession() { return observer; },
    getDynamicEntities() { return [observer, target]; },
    canSessionDetectDynamicEntity() { return true; },
    canSessionSeeEntityInPublicGrid() { return false; },
    canSessionSeeDynamicEntity() { return false; },
    hasLineOfSightForSession() { return true; },
    updateResolvedScanningContactsForSession(
      _session,
      entityIDs,
      options,
    ) {
      resolutions.push({ entityIDs, options });
    },
  };

  const first = passiveScanningRuntime.tickSession(scene, session, 10_000);
  assert.equal(first.updatedScans.length, 1);
  assert.equal(notifications.length, 1);
  assert.equal(notifications[0].name, "OnPassiveScanResults");
  assert.equal(notifications[0].idType, "clientID");
  // Exact client order: updated_scans, removed, added.
  assert.equal(notifications[0].payload[0].type, "list");
  assert.equal(notifications[0].payload[1].type, "dict");
  assert.equal(notifications[0].payload[2].type, "dict");
  assert.equal(unwrapMarshalValue(notifications[0].payload[0])[0].length, 7);
  assert.deepEqual(
    unwrapMarshalValue(notifications[0].payload[2])[String(target.itemID)],
    [scanningRuntime.UPDATE_ADDED_FROM_ITEM, target.itemID],
  );

  const boosted = buildCreationEntity([
    { typeID: TYPE_ION_SENSOR },
    { typeID: TYPE_ION_TUBE },
  ]);
  observer.passiveDerivedState = boosted.passiveDerivedState;
  const second = passiveScanningRuntime.tickSession(scene, session, 11_000);
  assert.deepEqual(second.resolvedIds, [target.itemID]);
  assert.equal(resolutions.length, 1);
  assert.deepEqual(resolutions[0].entityIDs, [target.itemID]);
  assert.equal(resolutions[0].options.source, "passive");
  assert.equal(resolutions[0].options.delayMs, 0);
  assert.deepEqual(
    unwrapMarshalValue(notifications[1].payload[1])[String(target.itemID)],
    [scanningRuntime.UPDATE_RESOLVED_TO_ITEM, target.itemID],
  );
});

test("passive and directional resolution ownership coexist", () => {
  const session: Record<string, any> = { _space: {} };
  scanningRuntime.replaceResolvedScanningContacts(session, [80_001], {
    nowMs: 1_000,
    source: "directional",
  });
  scanningRuntime.replaceResolvedScanningContacts(session, [80_001, 80_002], {
    nowMs: 1_000,
    source: "passive",
  });
  scanningRuntime.replaceResolvedScanningContacts(session, [], {
    nowMs: 2_000,
    source: "passive",
  });

  const contacts = scanningRuntime.getResolvedScanningContactMap(session, false);
  assert.equal(contacts.has(80_001), true);
  assert.equal(contacts.get(80_001).sources.directional, true);
  assert.equal(contacts.has(80_002), false);
});
