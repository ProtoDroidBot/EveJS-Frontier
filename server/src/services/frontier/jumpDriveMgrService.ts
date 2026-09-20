"use strict";

/** Remote service used by frontier.jump_drive.client.JumpDriveController. */
const path = require("path");

const BaseService = require(path.join(__dirname, "../baseService"));
const log = require(path.join(__dirname, "../../utils/logger"));
const { throwWrappedUserError } = require(path.join(
  __dirname,
  "../../common/machoErrors",
));
const { unwrapMarshalValue } = require(path.join(
  __dirname,
  "../_shared/serviceHelpers",
));
const worldData = require(path.join(__dirname, "../../space/worldData"));
const spaceRuntime = require(path.join(__dirname, "../../space/runtime"));
const { jumpSessionToSolarSystem } = require(path.join(
  __dirname,
  "../../space/transitions",
));
const {
  getActiveShipRecord,
  syncInventoryItemForSession,
} = require(path.join(__dirname, "../character/characterState"));
const itemStore = require(path.join(__dirname, "../inventory/itemStore"));
const { buildShipResourceState } = require(path.join(
  __dirname,
  "../fitting/liveFittingState",
));
const {
  calculateFuelQueueProperties,
  getShipFuelCharge,
} = require(path.join(__dirname, "./fuelTankRuntime"));
const {
  ATTRIBUTE_TEMPERATURE,
  buildJumpDrivePlan,
  consumeFrontierFuelQueue,
} = require(path.join(__dirname, "./jumpDriveRuntime"));
const {
  consumeFuelFromShipStorage,
  getFuelQuantityFromStacks,
  getFuelStacksForShipStorage,
} = require(path.join(__dirname, "../../space/modules/sharedFuelRuntime"));
const {
  applyJumpTimersBestEffort,
  hasActiveJumpActivation,
  resolveJumpFatigueMultiplier,
} = require(path.join(__dirname, "../_shared/jumpTimerRuntime"));

const LIGHT_YEAR_METERS = 9460730472580800;

function toInt(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.trunc(numeric) : fallback;
}

function toFiniteNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function notifyFailure(message) {
  throwWrappedUserError("CustomNotify", {
    notify: String(message || "The jump drive cannot be activated right now."),
  });
}

function unwrapDestinationSolarSystemID(args) {
  const unwrapped = unwrapMarshalValue(args);
  const first = Array.isArray(unwrapped) ? unwrapMarshalValue(unwrapped[0]) : unwrapped;
  return toInt(first, 0);
}

function getSessionSolarSystemID(session) {
  return toInt(
    session && (
      (session._space && session._space.systemID) ||
      session.solarsystemid2 ||
      session.solarsystemid
    ),
    0,
  );
}

function vectorDistance(left, right) {
  const dx = toFiniteNumber(left && left.x, 0) - toFiniteNumber(right && right.x, 0);
  const dy = toFiniteNumber(left && left.y, 0) - toFiniteNumber(right && right.y, 0);
  const dz = toFiniteNumber(left && left.z, 0) - toFiniteNumber(right && right.z, 0);
  return Math.sqrt((dx * dx) + (dy * dy) + (dz * dz));
}

function getSolarSystemDistanceLy(sourceSolarSystemID, destinationSolarSystemID) {
  const source = worldData.getSolarSystemByID(sourceSolarSystemID);
  const destination = worldData.getSolarSystemByID(destinationSolarSystemID);
  if (!source || !destination || !source.position || !destination.position) {
    return null;
  }
  return vectorDistance(source.position, destination.position) / LIGHT_YEAR_METERS;
}

function mapPlanFailureToMessage(errorMsg) {
  switch (String(errorMsg || "")) {
    case "JUMP_DRIVE_REQUIRED":
      return "Your ship does not have an online jump drive and cannot make an interstellar jump.";
    case "PROPULSION_REQUIRED":
      return "An online engine or Creation Power Generator is required before initiating a jump.";
    case "OUT_OF_RANGE":
      return "That solar system is outside your jump-drive range.";
    case "REQUIRED_FUEL_NOT_ACTIVE":
      return "The jump drive requires its configured fuel to be the active fuel in the ship tank.";
    case "INSUFFICIENT_FUEL":
      return "Your ship does not have enough jump fuel.";
    case "CRITICAL_HEAT":
      return "The jump would raise the ship to a critical temperature.";
    case "JUMP_FUEL_CONFIGURATION_MISSING":
      return "The ship's jump-drive fuel configuration is incomplete.";
    default:
      return "The jump drive cannot be activated right now.";
  }
}

function updateRuntimeEntityAfterJumpCost(entity, updatedShip, plan, nowMs) {
  if (!entity || !updatedShip) {
    return;
  }
  entity.conditionState = {
    ...(entity.conditionState && typeof entity.conditionState === "object"
      ? entity.conditionState
      : {}),
    ...(updatedShip.conditionState && typeof updatedShip.conditionState === "object"
      ? updatedShip.conditionState
      : {}),
  };
  if (plan.heatCapacity > 0) {
    const attributes = entity.passiveDerivedState && entity.passiveDerivedState.attributes;
    if (attributes && typeof attributes === "object") {
      attributes[String(ATTRIBUTE_TEMPERATURE)] = plan.nextTemperature;
    }
    if (entity.temperatureState && typeof entity.temperatureState === "object") {
      entity.temperatureState = {
        ...entity.temperatureState,
        temperature: plan.nextTemperature,
        lastUpdatedAtMs: nowMs,
      };
    }
  }
}

function notifyJumpCost(session, entity, plan, previousFuelCharge, previousFuelProperties, nowMs) {
  const interop = spaceRuntime.jumpDriveInterop;
  if (!interop || !entity) {
    return;
  }
  if (plan.fuelMode === "frontier-tank") {
    interop.notifyFuelChargeChangeToSession(
      session,
      entity,
      nowMs,
      previousFuelCharge,
    );
    interop.notifyFuelPropertyChangesToSession(
      session,
      entity,
      previousFuelProperties,
      calculateFuelQueueProperties(
        entity.conditionState && entity.conditionState.fuelQueue,
      ),
      nowMs,
    );
  }
  if (plan.heatIncrease > 0) {
    const when = interop.resolveSessionNotificationFileTime(session, nowMs);
    interop.notifyAttributeChanges(session, [interop.buildAttributeChange(
      session,
      entity.itemID,
      ATTRIBUTE_TEMPERATURE,
      plan.nextTemperature,
      plan.currentTemperature,
      when,
    )]);
  }
}

function commitJumpCost(session, activeShip, shipEntity, plan, nowMs) {
  const previousFuelCharge = getShipFuelCharge(activeShip);
  const previousFuelProperties = calculateFuelQueueProperties(plan.fuelQueue || []);
  let fuelChanges: any[] = [];
  let nextFuelState = null;

  if (plan.fuelMode === "frontier-tank") {
    const consumption = consumeFrontierFuelQueue(
      plan.fuelQueue,
      plan.fuelTypeID,
      plan.fuelQuantity,
    );
    if (!consumption.success) {
      return consumption;
    }
    nextFuelState = consumption.data;
  } else {
    const fuelResult = consumeFuelFromShipStorage(
      shipEntity || { kind: "ship", itemID: activeShip.itemID },
      plan.fuelTypeID,
      Math.ceil(plan.fuelQuantity),
      {
        resolveCharacterID: () => toInt(session && session.characterID, 0),
      },
    );
    if (!fuelResult.success) {
      return { success: false as const, errorMsg: "INSUFFICIENT_FUEL" };
    }
    fuelChanges = fuelResult.changes || [];
  }

  const updateResult = itemStore.updateShipItem(activeShip.itemID, (currentShip) => {
    const conditionState: Record<string, any> = {
      ...(currentShip.conditionState && typeof currentShip.conditionState === "object"
        ? currentShip.conditionState
        : {}),
    };
    if (plan.heatCapacity > 0) {
      conditionState.temperature = plan.nextTemperature;
    }
    if (nextFuelState) {
      conditionState.fuelQueue = nextFuelState.fuelQueue;
      conditionState.fuelCharge = nextFuelState.fuelCharge;
      conditionState.fuelTypeID = nextFuelState.fuelTypeID;
    }
    return {
      ...currentShip,
      conditionState,
    };
  });
  if (!updateResult.success) {
    return { success: false as const, errorMsg: updateResult.errorMsg || "WRITE_ERROR" };
  }

  for (const change of fuelChanges) {
    if (change && change.item) {
      syncInventoryItemForSession(
        session,
        change.item,
        change.previousData || {},
        { emitCfgLocation: false },
      );
    }
  }
  syncInventoryItemForSession(
    session,
    updateResult.data,
    updateResult.previousData || {},
    { emitCfgLocation: false },
  );
  updateRuntimeEntityAfterJumpCost(shipEntity, updateResult.data, plan, nowMs);
  notifyJumpCost(
    session,
    shipEntity,
    plan,
    previousFuelCharge,
    previousFuelProperties,
    nowMs,
  );
  return {
    success: true as const,
    data: {
      shipItem: updateResult.data,
      consumedFuelQuantity: plan.fuelQuantity,
    },
  };
}

class JumpDriveMgrService extends BaseService {
  constructor() {
    super("jumpDriveMgr");
  }

  Handle_cmd_jump_with_jump_drive(args, session) {
    if (!session || !session.characterID || !session._space) {
      notifyFailure("Jump drives can only be initiated while the ship is in space.");
    }
    if (
      typeof spaceRuntime.isPilotWarpLandingPending === "function" &&
      spaceRuntime.isPilotWarpLandingPending(session)
    ) {
      notifyFailure("The jump drive cannot be initiated during an in-system warp.");
    }
    if (hasActiveJumpActivation(session.characterID)) {
      notifyFailure("The jump drive is still recovering from its previous activation.");
    }

    const destinationSolarSystemID = unwrapDestinationSolarSystemID(args);
    const sourceSolarSystemID = getSessionSolarSystemID(session);
    if (destinationSolarSystemID <= 0 || !worldData.getSolarSystemByID(destinationSolarSystemID)) {
      notifyFailure("The destination solar system could not be found.");
    }
    if (sourceSolarSystemID === destinationSolarSystemID) {
      notifyFailure("Jump drives travel between solar systems; use warp for destinations in this system.");
    }
    const distanceLy = getSolarSystemDistanceLy(
      sourceSolarSystemID,
      destinationSolarSystemID,
    );
    if (distanceLy === null || distanceLy <= 0) {
      notifyFailure("The distance to that solar system could not be calculated.");
    }

    const activeShip = getActiveShipRecord(session.characterID);
    if (!activeShip) {
      notifyFailure("You need an active ship to use a jump drive.");
    }
    const shipEntity = spaceRuntime.getEntity(session, activeShip.itemID);
    const resourceState = buildShipResourceState(session.characterID, activeShip);
    let planResult: any = buildJumpDrivePlan({
      shipItem: activeShip,
      resourceState,
      shipEntity,
      distanceLy,
    });
    if (!planResult.success) {
      notifyFailure(mapPlanFailureToMessage(planResult.errorMsg));
    }
    let plan: any = planResult.data;

    if (plan.fuelMode === "inventory") {
      const fuelEntity = shipEntity || { kind: "ship", itemID: activeShip.itemID };
      const availableFuel = getFuelQuantityFromStacks(getFuelStacksForShipStorage(
        fuelEntity,
        plan.fuelTypeID,
        { resolveCharacterID: () => toInt(session.characterID, 0) },
      ));
      planResult = buildJumpDrivePlan({
        shipItem: activeShip,
        resourceState,
        shipEntity,
        distanceLy,
        availableLegacyFuelQuantity: availableFuel,
      });
      if (!planResult.success) {
        notifyFailure(mapPlanFailureToMessage(planResult.errorMsg));
      }
      plan = planResult.data;
    }

    const nowMs = Date.now();
    const costResult = commitJumpCost(session, activeShip, shipEntity, plan, nowMs);
    if (!costResult.success) {
      notifyFailure(mapPlanFailureToMessage(costResult.errorMsg));
    }

    const jumpResult = jumpSessionToSolarSystem(session, destinationSolarSystemID, {
      countsTowardJumpGoal: true,
    });
    if (!jumpResult.success) {
      log.warn(
        `[JumpDrive] initiated jump could not complete char=${session.characterID} ` +
          `ship=${activeShip.itemID} destination=${destinationSolarSystemID} ` +
          `error=${jumpResult.errorMsg || "UNKNOWN"}`,
      );
      notifyFailure("The jump was initiated, but the solar-system transition failed.");
    }
    applyJumpTimersBestEffort(session, {
      distanceLy,
      jumpFatigueMultiplier: resolveJumpFatigueMultiplier(resourceState),
    });
    log.info(
      `[JumpDrive] char=${session.characterID} ship=${activeShip.itemID} ` +
        `source=${sourceSolarSystemID} destination=${destinationSolarSystemID} ` +
        `distanceLy=${distanceLy.toFixed(6)} massKg=${plan.shipMass.toFixed(3)} ` +
        `fuelType=${plan.fuelTypeID} fuel=${plan.fuelQuantity} ` +
        `heatK=${plan.heatIncrease.toFixed(6)} source=${plan.driveSource}`,
    );
    return jumpResult.data.boundResult || true;
  }
}

module.exports = JumpDriveMgrService;
module.exports._testing = {
  commitJumpCost,
  getSolarSystemDistanceLy,
  mapPlanFailureToMessage,
  unwrapDestinationSolarSystemID,
};
