"use strict";

/**
 * Frontier's module-less directional scanner Macho service.
 *
 * Client build 3467658 calls exactly:
 *   RemoteSvc("scanningService").directional_scan(
 *     scan_angle=<degrees>, scan_direction=<vec3>)
 *
 * It then reads response.added / removed / updated_scans / resolved / origin /
 * duration by attribute.  buildScanResponse supplies that util.KeyVal wire
 * object and FILETIME-delta fields, shared with the fitted Creation scanner.
 *
 * The client contains no separate strength/duration constants for this route.
 * This is the classic/non-modular ship path, so its scanner profile comes from
 * the active hull's built-in sensor strengths rather than Creation module
 * 95322. Multi-sensor hulls average their positive authored sensor types.
 */

const path = require("path");

const BaseService = require(path.join(__dirname, "../baseService"));
const log = require(path.join(__dirname, "../../utils/logger"));
const { throwWrappedUserError } = require(path.join(
  __dirname,
  "../../common/machoErrors",
));
const {
  unwrapMarshalValue,
} = require(path.join(__dirname, "../_shared/serviceHelpers"));
const scanningRuntime = require(path.join(__dirname, "./scanningRuntime"));
const {
  buildScanResponse,
} = require(path.join(__dirname, "./scanningAbilityHandlers"));

function toInt(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.trunc(numeric) : fallback;
}

function resolveActiveShipID(session) {
  return toInt(
    session && (
      (session._space && session._space.shipID) ||
      session.activeShipID ||
      session.shipID ||
      session.shipid
    ),
    0,
  );
}

function getSpaceRuntime() {
  return require(path.join(__dirname, "../../space/runtime"));
}

function collectScanCandidates(spaceRuntime, session, shipID) {
  let scene = null;
  try {
    scene = spaceRuntime && typeof spaceRuntime.getSceneForSession === "function"
      ? spaceRuntime.getSceneForSession(session)
      : null;
  } catch (_) {
    scene = null;
  }
  if (!scene || typeof scene.getDynamicEntities !== "function") {
    return [];
  }

  const nowMs = typeof scene.getCurrentSimTimeMs === "function"
    ? scene.getCurrentSimTimeMs()
    : Date.now();
  const candidates: any[] = [];
  for (const entity of scene.getDynamicEntities()) {
    const itemID = toInt(entity && entity.itemID, 0);
    if (itemID <= 0 || itemID === toInt(shipID, 0) || !entity.position) {
      continue;
    }
    if (
      typeof scene.canSessionDetectDynamicEntity === "function" &&
      scene.canSessionDetectDynamicEntity(session, entity) !== true
    ) {
      continue;
    }
    candidates.push({
      itemID,
      typeID: toInt(entity.typeID, 0),
      position: entity.position,
      hasLineOfSight:
        typeof scene.hasLineOfSightForSession === "function"
          ? scene.hasLineOfSightForSession(session, entity)
          : true,
      emSignatureMultiplier:
        scanningRuntime.resolveEntityEmSignatureMultiplier(entity, nowMs),
    });
  }
  return candidates;
}

function throwScanRequestError(reason) {
  const messages = {
    SCAN_ANGLE_INVALID: "The directional scan angle is invalid.",
    SCAN_ANGLE_OUT_OF_RANGE: "The directional scan angle is out of range.",
    SCAN_DIRECTION_INVALID: "The directional scan direction is invalid.",
    SHIP_NOT_IN_SPACE: "You must be in space to use the directional scanner.",
  };
  throwWrappedUserError("CustomNotify", {
    notify: messages[reason] || "The directional scan could not be started.",
  });
}

class ScanningService extends BaseService {
  declare _buildScanResponse: any;
  declare _normalizeScanRequest: any;
  declare _performDirectionalScan: any;
  declare _spaceRuntime: any;

  constructor(dependencies: Record<string, any> = {}) {
    super("scanningService");
    this._spaceRuntime = dependencies.spaceRuntime || getSpaceRuntime();
    this._normalizeScanRequest =
      dependencies.normalizeScanRequest || scanningRuntime.normalizeScanRequest;
    this._performDirectionalScan =
      dependencies.performDirectionalScan || scanningRuntime.performDirectionalScan;
    this._buildScanResponse = dependencies.buildScanResponse || buildScanResponse;
  }

  Handle_directional_scan(_args, session, kwargs) {
    const request = this._normalizeScanRequest(unwrapMarshalValue(kwargs) || {});
    if (request.errorMsg) {
      throwScanRequestError(request.errorMsg);
    }

    const shipID = resolveActiveShipID(session);
    if (!session || !session._space || shipID <= 0) {
      throwScanRequestError("SHIP_NOT_IN_SPACE");
    }

    let entity = null;
    try {
      entity = this._spaceRuntime && typeof this._spaceRuntime.getEntity === "function"
        ? this._spaceRuntime.getEntity(session, shipID)
        : null;
    } catch (_) {
      entity = null;
    }
    if (!entity || entity.kind !== "ship" || !entity.position) {
      throwScanRequestError("SHIP_NOT_IN_SPACE");
    }

    const previousScanIds = Array.isArray(
      session._space.frontierDirectionalScanIds,
    )
      ? session._space.frontierDirectionalScanIds
      : [];
    const scannerProfile = scanningRuntime.resolveBuiltInScannerProfile(entity);
    scanningRuntime.recordEntityScannerEmissionActivity(entity, {
      nowMs: Date.now(),
    });
    const scan = this._performDirectionalScan({
      originPosition: entity.position,
      angleDegrees: request.angleDegrees,
      direction: request.direction,
      moduleTypeID: entity.typeID,
      scannerProfile,
      candidates: collectScanCandidates(this._spaceRuntime, session, shipID),
      previousScanIds,
    });
    session._space.frontierDirectionalScanIds = scan.scanIds;
    if (
      this._spaceRuntime &&
      typeof this._spaceRuntime.updateResolvedScanningContactsForSession ===
        "function"
    ) {
      const resolution =
        this._spaceRuntime.updateResolvedScanningContactsForSession(
          session,
          scan.resolvedIds,
          { delayMs: scan.durationMs },
        );
      if (resolution && resolution.delayMsByEntityID instanceof Map) {
        scan.resolvedDelayMsById = resolution.delayMsByEntityID;
      }
    }

    log.info(
      `[scanningService] directional_scan ship=${shipID} ` +
      `angle=${request.angleDegrees} results=${scan.updatedScans.length} ` +
      `resolved=${scan.resolvedIds.length} durationMs=${scan.durationMs}`,
    );
    return this._buildScanResponse(scan);
  }
}

module.exports = ScanningService;
module.exports._testing = {
  collectScanCandidates,
  resolveActiveShipID,
};
