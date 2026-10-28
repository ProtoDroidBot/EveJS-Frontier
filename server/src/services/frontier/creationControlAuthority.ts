"use strict";

/**
 * Server-side authority for passive Creation control modules.
 *
 * The Frontier client reads these modules locally before exposing auto-fire
 * and auto-approach controls.  Network callers cannot be trusted to have
 * performed that check, so command services resolve the persisted Creation
 * state again and require the relevant module to still be online.
 */

const path = require("path");

const characterState = require(path.join(__dirname, "../character/characterState"));
const creationRuntime = require(path.join(__dirname, "./creationRuntime"));

const TYPE_CREATION_REPEATER = 95679;
const TYPE_CREATION_AUTOHELM = 95767;
// Build 3502403's ShipApproach reads const.approachRange (50) and sends
// CmdFollowBall(targetID, approachRange). Keep At Range shares CmdFollowBall,
// so the tuple is only distinguishable from that command when its selected
// distance is not exactly the authored Approach range.
const CREATION_APPROACH_RANGE_METERS = 50;

const autoApproachMovementBySession = new WeakMap<any, any>();

function toPositiveInt(value, fallback = 0) {
  const numeric = Math.trunc(Number(value));
  return Number.isFinite(numeric) && numeric > 0 ? numeric : fallback;
}

function resolveSessionCharacterID(session) {
  return toPositiveInt(
    session && (session.characterID || session.charID || session.charid),
    0,
  );
}

function resolveSessionShipID(session) {
  return toPositiveInt(
    session && (
      session._space && session._space.shipID ||
      session.activeShipID ||
      session.shipID ||
      session.shipid
    ),
    0,
  );
}

function resolveCreationControlAuthority(
  session,
  options: Record<string, any> = {},
) {
  const characterID = toPositiveInt(
    options.characterID,
    resolveSessionCharacterID(session),
  );
  const shipID = toPositiveInt(
    options.shipID,
    resolveSessionShipID(session),
  );
  const findShip = typeof options.findCharacterShip === "function"
    ? options.findCharacterShip
    : characterState.findCharacterShip;
  const getActiveShip = typeof options.getActiveShipRecord === "function"
    ? options.getActiveShipRecord
    : characterState.getActiveShipRecord;
  const getDogmaContext = typeof options.getCreationDogmaContext === "function"
    ? options.getCreationDogmaContext
    : creationRuntime.getCreationDogmaContext;
  const shipItem = options.shipItem || (
    characterID > 0 && shipID > 0
      ? findShip(characterID, shipID)
      : null
  ) || (characterID > 0 ? getActiveShip(characterID) : null);

  const persistedCreationState = shipItem &&
    typeof creationRuntime.readCreationState === "function"
      ? creationRuntime.readCreationState(shipItem)
      : null;
  const shipItemID = toPositiveInt(shipItem && shipItem.itemID, 0);
  const hasAuthoritativeShipIdentity = Boolean(
    shipItem &&
    characterID > 0 &&
    shipID > 0 &&
    shipItemID === shipID
  );

  if (!hasAuthoritativeShipIdentity || typeof getDogmaContext !== "function") {
    return {
      // A partially torn-down session may still retain a runtime ship entity.
      // Preserve any persisted Creation identity, but make the unresolved
      // authority explicit so automatic controls can fail closed instead of
      // treating that entity as a confirmed regular ship.
      authorityResolved: false,
      isCreation: Boolean(persistedCreationState),
      characterID,
      shipID,
      shipItem: shipItem || null,
      onlineModuleTypeIDs: new Set<number>(),
    };
  }

  let contextResult = null;
  try {
    contextResult = getDogmaContext(shipItem, characterID);
  } catch (_error) {
    contextResult = null;
  }
  if (!contextResult || contextResult.success !== true || !contextResult.data) {
    const confirmedRegularShip = Boolean(
      !persistedCreationState &&
      contextResult &&
      contextResult.errorMsg === "CREATION_TEMPLATE_NOT_FOUND"
    );
    return {
      // A persisted Creation must fail closed if its module state cannot be
      // refreshed. Only the explicit "not a Creation template" result proves
      // that a regular ship is exempt; exceptions and unknown failures remain
      // unresolved rather than silently granting automatic control.
      authorityResolved: confirmedRegularShip,
      isCreation: Boolean(persistedCreationState),
      characterID,
      shipID: shipItemID || shipID,
      shipItem,
      onlineModuleTypeIDs: new Set<number>(),
    };
  }

  const onlineModuleTypeIDs = new Set<number>();
  for (const moduleItem of Array.isArray(contextResult.data.moduleItems)
    ? contextResult.data.moduleItems
    : []) {
    const typeID = toPositiveInt(moduleItem && moduleItem.typeID, 0);
    if (typeID > 0 && moduleItem?.moduleState?.online === true) {
      onlineModuleTypeIDs.add(typeID);
    }
  }

  return {
    authorityResolved: true,
    isCreation: true,
    characterID,
    shipID: shipItemID || shipID,
    shipItem,
    onlineModuleTypeIDs,
    poweredOff: contextResult.data.state?.poweredOff === true,
  };
}

function hasOnlineCreationControlModule(authorityState, typeID) {
  return Boolean(
    authorityState &&
    authorityState.isCreation === true &&
    authorityState.poweredOff !== true &&
    authorityState.onlineModuleTypeIDs instanceof Set &&
    authorityState.onlineModuleTypeIDs.has(toPositiveInt(typeID, 0)),
  );
}

function isCreationApproachRange(range) {
  return Math.abs(Number(range) - CREATION_APPROACH_RANGE_METERS) < 0.001;
}

function getSessionShipEntity(session, spaceRuntime) {
  if (!session || !spaceRuntime) {
    return null;
  }
  if (typeof spaceRuntime.getShipEntityForSession === "function") {
    return spaceRuntime.getShipEntityForSession(session) || null;
  }
  const scene = typeof spaceRuntime.getSceneForSession === "function"
    ? spaceRuntime.getSceneForSession(session)
    : null;
  return scene && typeof scene.getShipEntityForSession === "function"
    ? scene.getShipEntityForSession(session) || null
    : null;
}

function clearCreationAutoApproachMovement(session) {
  if (!session) {
    return false;
  }
  return autoApproachMovementBySession.delete(session);
}

function recordCreationAutoApproachMovement(
  session,
  spaceRuntime,
  options: Record<string, any> = {},
) {
  const entity = options.entity || getSessionShipEntity(session, spaceRuntime);
  const traceID = toPositiveInt(
    options.movementTraceID ?? entity?.movementTrace?.id,
    0,
  );
  const targetID = toPositiveInt(options.targetID, 0);
  const range = Number(options.range);
  if (
    !session ||
    !entity ||
    traceID <= 0 ||
    targetID <= 0 ||
    !isCreationApproachRange(range)
  ) {
    clearCreationAutoApproachMovement(session);
    return null;
  }
  const marker = {
    shipID: toPositiveInt(entity.itemID, resolveSessionShipID(session)),
    targetID,
    range: CREATION_APPROACH_RANGE_METERS,
    movementTraceID: traceID,
  };
  autoApproachMovementBySession.set(session, marker);
  return marker;
}

function reconcileCreationAutoApproachMovement(
  session,
  options: Record<string, any> = {},
) {
  const marker = session
    ? autoApproachMovementBySession.get(session) || null
    : null;
  if (!marker) {
    return { canceled: false, reason: "NOT_TRACKED" };
  }

  const runtime = options.spaceRuntime || (() => {
    try {
      return require(path.join(__dirname, "../../space/runtime"));
    } catch (_error) {
      return null;
    }
  })();
  const entity = options.entity || getSessionShipEntity(session, runtime);
  const currentTraceID = toPositiveInt(entity?.movementTrace?.id, 0);
  const sameCommand = Boolean(
    entity &&
    toPositiveInt(entity.itemID, 0) === marker.shipID &&
    currentTraceID > 0 &&
    currentTraceID === marker.movementTraceID &&
    (
      (
        entity.mode === "FOLLOW" &&
        toPositiveInt(entity.targetEntityID, 0) === marker.targetID &&
        isCreationApproachRange(entity.followRange)
      ) ||
      // Some Destiny transitions retain the originating movement trace while
      // representing the continuing approach as GOTO. The trace match keeps
      // this safe: any later pilot command receives a new movementTrace id.
      entity.mode === "GOTO"
    )
  );
  if (!sameCommand) {
    clearCreationAutoApproachMovement(session);
    return { canceled: false, reason: "SUPERSEDED" };
  }

  const authorityState = options.authorityState || resolveCreationControlAuthority(
    session,
    options.authorityOptions || {},
  );
  if (
    authorityState &&
    authorityState.authorityResolved === true &&
    (
      authorityState.isCreation !== true ||
      hasOnlineCreationControlModule(authorityState, TYPE_CREATION_AUTOHELM)
    )
  ) {
    return { canceled: false, reason: "AUTHORIZED" };
  }

  const stopped = Boolean(
    runtime && typeof runtime.stop === "function" && runtime.stop(session),
  );
  clearCreationAutoApproachMovement(session);
  return {
    canceled: stopped,
    reason: stopped
      ? authorityState && authorityState.authorityResolved !== true
        ? "AUTHORITY_UNRESOLVED"
        : "AUTOHELM_OFFLINE"
      : "STOP_FAILED",
  };
}

function handleCreationControlStateChange(event: Record<string, any> = {}) {
  if (!event.session) {
    return { canceled: false, reason: "NO_SESSION" };
  }
  return reconcileCreationAutoApproachMovement(event.session, {
    spaceRuntime: event.spaceRuntime,
    authorityState: event.authorityState,
    authorityOptions: event.authorityOptions,
  });
}

if (typeof creationRuntime.subscribeCreationStateChanges === "function") {
  creationRuntime.subscribeCreationStateChanges(handleCreationControlStateChange);
}

module.exports = {
  CREATION_APPROACH_RANGE_METERS,
  TYPE_CREATION_REPEATER,
  TYPE_CREATION_AUTOHELM,
  clearCreationAutoApproachMovement,
  handleCreationControlStateChange,
  hasOnlineCreationControlModule,
  isCreationApproachRange,
  reconcileCreationAutoApproachMovement,
  recordCreationAutoApproachMovement,
  resolveCreationControlAuthority,
  resolveSessionCharacterID,
  resolveSessionShipID,
};
