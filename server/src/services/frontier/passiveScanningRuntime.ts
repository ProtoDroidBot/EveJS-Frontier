"use strict";

/**
 * Server-authoritative Frontier passive scanning.
 *
 * Build 3502403's client listens for exactly
 *   OnPassiveScanResults(updated_scans, removed, added)
 * and reconstructs each CombinedScanResult from its seven-field state tuple.
 * Passive sensors do not use the directional scanner RPC or its timed pulse;
 * this runtime periodically publishes the live 360-degree result instead.
 */

const path = require("path");

const scanningRuntime = require(path.join(__dirname, "./scanningRuntime"));
const temperatureRuntime = require(path.join(__dirname, "./temperatureRuntime"));
const {
  buildDict,
  buildList,
} = require(path.join(__dirname, "../_shared/serviceHelpers"));

const PASSIVE_SCAN_INTERVAL_MS = 1000;
const PASSIVE_SCAN_SOURCE = "passive";
const PASSIVE_SCAN_IDS_KEY = "frontierPassiveScanIds";
const PASSIVE_SCAN_RESOLVED_IDS_KEY = "frontierPassiveResolvedIds";
const PASSIVE_SCAN_NEXT_AT_KEY = "frontierPassiveScanNextAtMs";

function toInt(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.trunc(numeric) : fallback;
}

function toFiniteNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function buildScanReason(reason) {
  return Array.isArray(reason)
    ? { type: "tuple", items: reason }
    : null;
}

function buildCombinedScanState(result) {
  return [
    result.center,
    result.radius,
    result.scan_id,
    result.distance_range,
    result.estimated_number,
    result.estimated_number_uncertainty,
    buildList(
      (Array.isArray(result.signature_results)
        ? result.signature_results
        : []).map((entry) => buildList(entry)),
    ),
  ];
}

function buildPassiveScanNotificationPayload(scan) {
  const addedReasons = scan.addedReasonsByScanId instanceof Map
    ? scan.addedReasonsByScanId
    : new Map();
  const removedReasons = scan.removedReasonsByScanId instanceof Map
    ? scan.removedReasonsByScanId
    : new Map();
  return [
    buildList(
      (Array.isArray(scan.updatedScans) ? scan.updatedScans : []).map(
        (result) => buildList(buildCombinedScanState(result)),
      ),
    ),
    buildDict(
      (Array.isArray(scan.removed) ? scan.removed : []).map((scanId) => ([
        scanId,
        buildScanReason(removedReasons.get(scanId)),
      ])),
    ),
    buildDict(
      (Array.isArray(scan.added) ? scan.added : []).map((scanId) => ([
        scanId,
        buildScanReason(
          addedReasons.has(scanId)
            ? addedReasons.get(scanId)
            : [scanningRuntime.UPDATE_ADDED_FROM_ITEM, scanId],
        ),
      ])),
    ),
  ];
}

function sameEntityIDs(left, right) {
  const leftIDs = (Array.isArray(left) ? left : [])
    .map((value) => toInt(value, 0))
    .filter((value) => value > 0)
    .sort((a, b) => a - b);
  const rightIDs = (Array.isArray(right) ? right : [])
    .map((value) => toInt(value, 0))
    .filter((value) => value > 0)
    .sort((a, b) => a - b);
  return leftIDs.length === rightIDs.length && leftIDs.every(
    (value, index) => value === rightIDs[index],
  );
}

function hasPassiveResolvedContacts(session) {
  const contacts = scanningRuntime.getResolvedScanningContactMap(session, false);
  if (!(contacts instanceof Map)) {
    return false;
  }
  return [...contacts.values()].some((contact) => Boolean(
    contact &&
    contact.sources &&
    contact.sources[PASSIVE_SCAN_SOURCE] === true,
  ));
}

function isAlreadyVisibleOutsidePassiveScan(scene, session, entity, nowMs) {
  const itemID = toInt(entity && entity.itemID, 0);
  const contacts = scanningRuntime.getResolvedScanningContactMap(session, false);
  const contact = contacts instanceof Map ? contacts.get(itemID) : null;
  const passiveOwnsContact = Boolean(
    contact && contact.sources && contact.sources[PASSIVE_SCAN_SOURCE] === true,
  );

  if (
    typeof scene.canSessionSeeEntityInPublicGrid === "function" &&
    scene.canSessionSeeEntityInPublicGrid(session, entity) === true &&
    (
      typeof scene.hasLineOfSightForSession !== "function" ||
      scene.hasLineOfSightForSession(session, entity) === true
    )
  ) {
    return true;
  }
  return !passiveOwnsContact &&
    typeof scene.canSessionSeeDynamicEntity === "function" &&
    scene.canSessionSeeDynamicEntity(session, entity, nowMs) === true;
}

function collectPassiveScanCandidates(scene, session, shipID, nowMs) {
  if (!scene || typeof scene.getDynamicEntities !== "function") {
    return [];
  }
  const candidates: any[] = [];
  for (const entity of scene.getDynamicEntities()) {
    const itemID = toInt(entity && entity.itemID, 0);
    if (itemID <= 0 || itemID === toInt(shipID, 0) || !entity.position) {
      continue;
    }
    if (
      typeof scene.canSessionDetectDynamicEntity === "function" &&
      scene.canSessionDetectDynamicEntity(session, entity, nowMs) !== true
    ) {
      continue;
    }
    if (isAlreadyVisibleOutsidePassiveScan(scene, session, entity, nowMs)) {
      continue;
    }
    candidates.push({
      itemID,
      typeID: toInt(entity.typeID, 0),
      position: entity.position,
      mass: Number(entity.mass),
      hasLineOfSight:
        typeof scene.hasLineOfSightForSession === "function"
          ? scene.hasLineOfSightForSession(session, entity)
          : true,
      emSignatureMultiplier:
        scanningRuntime.resolveEntityEmSignatureMultiplier(entity, nowMs),
      thermalSignatureMultiplier:
        temperatureRuntime.resolveEntityThermalSignatureMultiplier(entity, nowMs),
    });
  }
  return candidates;
}

function tickSession(scene, session, nowMs) {
  const generation = session && session._space;
  if (!generation || typeof generation !== "object") {
    return null;
  }
  const nextAtMs = toFiniteNumber(generation[PASSIVE_SCAN_NEXT_AT_KEY], 0);
  if (nowMs < nextAtMs) {
    return null;
  }
  generation[PASSIVE_SCAN_NEXT_AT_KEY] = nowMs + PASSIVE_SCAN_INTERVAL_MS;

  const shipID = toInt(generation.shipID, 0);
  const shipEntity = typeof scene.getShipEntityForSession === "function"
    ? scene.getShipEntityForSession(session)
    : null;
  if (!shipEntity || shipID <= 0 || !shipEntity.position) {
    return null;
  }

  const previousScanIds = Array.isArray(generation[PASSIVE_SCAN_IDS_KEY])
    ? generation[PASSIVE_SCAN_IDS_KEY]
    : [];
  const previousResolvedIds = Array.isArray(
    generation[PASSIVE_SCAN_RESOLVED_IDS_KEY],
  )
    ? generation[PASSIVE_SCAN_RESOLVED_IDS_KEY]
    : [];
  const scannerProfile = scanningRuntime.resolvePassiveScannerProfile(shipEntity);
  const scan = scanningRuntime.performPassiveScan({
    originPosition: shipEntity.position,
    scannerProfile,
    candidates: collectPassiveScanCandidates(
      scene,
      session,
      shipID,
      nowMs,
    ),
    previousScanIds,
  });

  generation[PASSIVE_SCAN_IDS_KEY] = scan.scanIds;
  generation[PASSIVE_SCAN_RESOLVED_IDS_KEY] = scan.resolvedIds;
  if (
    (
      !sameEntityIDs(previousResolvedIds, scan.resolvedIds) ||
      (scan.resolvedIds.length === 0 && hasPassiveResolvedContacts(session))
    ) &&
    typeof scene.updateResolvedScanningContactsForSession === "function"
  ) {
    scene.updateResolvedScanningContactsForSession(session, scan.resolvedIds, {
      nowMs,
      delayMs: 0,
      source: PASSIVE_SCAN_SOURCE,
    });
  }

  if (
    typeof session.sendNotification === "function" &&
    (
      scan.updatedScans.length > 0 ||
      scan.added.length > 0 ||
      scan.removed.length > 0
    )
  ) {
    session.sendNotification(
      "OnPassiveScanResults",
      "clientID",
      buildPassiveScanNotificationPayload(scan),
    );
  }
  return scan;
}

function tickScene(scene, nowMs = Date.now()) {
  if (!scene || !(scene.sessions instanceof Map)) {
    return [];
  }
  const now = toFiniteNumber(nowMs, Date.now());
  const scans: any[] = [];
  for (const session of scene.sessions.values()) {
    const scan = tickSession(scene, session, now);
    if (scan) {
      scans.push(scan);
    }
  }
  return scans;
}

module.exports = {
  PASSIVE_SCAN_IDS_KEY,
  PASSIVE_SCAN_INTERVAL_MS,
  PASSIVE_SCAN_NEXT_AT_KEY,
  PASSIVE_SCAN_RESOLVED_IDS_KEY,
  PASSIVE_SCAN_SOURCE,
  buildPassiveScanNotificationPayload,
  collectPassiveScanCandidates,
  hasPassiveResolvedContacts,
  tickScene,
  tickSession,
};
