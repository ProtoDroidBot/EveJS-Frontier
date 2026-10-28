"use strict";

const path = require("path");
const log = require(path.join(__dirname, "../../utils/logger"));

// The retail client presents const.characterSelfDestructTime as 10 seconds.
const SELF_DESTRUCT_DELAY_MS = 10_000;
const pendingByShipID = new Map();

function resolveContext(session, requestedShipID) {
  const shipID = Number(session && session._space && session._space.shipID);
  if (!session || !session.characterID || !Number.isSafeInteger(shipID) || shipID <= 0) {
    return { success: false, errorMsg: "NOT_IN_SPACE" };
  }
  if (requestedShipID > 0 && requestedShipID !== shipID) {
    return { success: false, errorMsg: "SHIP_NOT_ACTIVE" };
  }

  const { getActiveShipRecord } = require(path.join(__dirname, "../character/characterState"));
  const activeShip = getActiveShipRecord(session.characterID);
  if (!activeShip || Number(activeShip.itemID) !== shipID) {
    return { success: false, errorMsg: "SHIP_NOT_ACTIVE" };
  }

  const spaceRuntime = require(path.join(__dirname, "../../space/runtime"));
  const scene = spaceRuntime.getSceneForSession(session);
  const entity = scene && scene.getEntityByID(shipID);
  if (!entity || entity.kind !== "ship") {
    return { success: false, errorMsg: "SHIP_ENTITY_NOT_FOUND" };
  }
  return { success: true, shipID, scene, entity };
}

function broadcastTimer(state, deadlineMs) {
  state.entity.selfDestructAtMs = deadlineMs;
  if (state.scene.getEntityByID(state.shipID) === state.entity) {
    state.scene.broadcastSlimItemChanges([state.entity]);
  }
}

function clearPending(state, options: Record<string, any> = {}) {
  if (pendingByShipID.get(state.shipID) !== state) {
    return false;
  }
  pendingByShipID.delete(state.shipID);
  if (state.timer) {
    state.clearTimer(state.timer);
  }
  if (options.broadcast !== false) {
    broadcastTimer(state, null);
  } else {
    state.entity.selfDestructAtMs = null;
  }
  return true;
}

function beginSelfDestruct(session, requestedShipID = 0, options: Record<string, any> = {}) {
  const resolve = options.resolveContext || resolveContext;
  const context = resolve(session, requestedShipID);
  if (!context.success) {
    return context;
  }
  const existing = pendingByShipID.get(context.shipID);
  if (existing) {
    if (existing.session === session && existing.entity === context.entity) {
      return { success: true, deadlineMs: existing.deadlineMs, alreadyActive: true };
    }
    clearPending(existing);
  }

  const now = options.now || Date.now;
  const schedule = options.schedule || setTimeout;
  const state = {
    session,
    characterID: Number(session.characterID),
    shipID: context.shipID,
    scene: context.scene,
    entity: context.entity,
    deadlineMs: now() + SELF_DESTRUCT_DELAY_MS,
    timer: null,
    clearTimer: options.clearTimer || clearTimeout,
    resolve,
    destroy: options.destroy || destroySessionShip,
  };
  pendingByShipID.set(state.shipID, state);
  broadcastTimer(state, state.deadlineMs);
  state.timer = schedule(() => finishSelfDestruct(state), SELF_DESTRUCT_DELAY_MS);
  if (state.timer && typeof state.timer.unref === "function") {
    state.timer.unref();
  }
  log.info(`[Ship] SelfDestruct armed char=${state.characterID} ship=${state.shipID}`);
  return { success: true, deadlineMs: state.deadlineMs };
}

function destroySessionShip(session) {
  const { destroySessionShip: destroy } = require(path.join(__dirname, "../../space/shipDestruction"));
  return destroy(session, { sessionChangeReason: "selfdestruct" });
}

function finishSelfDestruct(state) {
  if (pendingByShipID.get(state.shipID) !== state) {
    return;
  }
  const current = state.resolve(state.session, state.shipID);
  if (!current.success || current.scene !== state.scene || current.entity !== state.entity ||
      Number(state.session.characterID) !== state.characterID) {
    clearPending(state);
    return;
  }

  clearPending(state, { broadcast: false });
  let result;
  try {
    result = state.destroy(state.session);
  } catch (error) {
    log.warn(`[Ship] SelfDestruct failed ship=${state.shipID}: ${error.message}`);
    broadcastTimer(state, null);
    return;
  }
  if (!result || !result.success) {
    log.warn(`[Ship] SelfDestruct failed ship=${state.shipID}: ${result && result.errorMsg || "UNKNOWN"}`);
    broadcastTimer(state, null);
    return;
  }
  const data = result.data || {};
  const { syncInventoryItemForSession } = require(path.join(__dirname, "../character/characterState"));
  const changes = [
    ...(Array.isArray(data.wreckChanges) ? data.wreckChanges : []),
    ...(data.destroyedShipContentChangesSyncedToSession === true ? [] : [
      ...(Array.isArray(data.movedChanges) ? data.movedChanges : []),
      ...(Array.isArray(data.destroyChanges) ? data.destroyChanges : []),
    ]),
  ];
  for (const change of changes) {
    if (change && change.item) {
      syncInventoryItemForSession(state.session, change.item,
        change.previousData || change.previousState || {}, { emitCfgLocation: true });
    }
  }
  log.info(`[Ship] SelfDestruct completed char=${state.characterID} ship=${state.shipID}`);
}

function abortSelfDestruct(session, requestedShipID = 0, options: Record<string, any> = {}) {
  const context = (options.resolveContext || resolveContext)(session, requestedShipID);
  if (!context.success) {
    return context;
  }
  const state = pendingByShipID.get(context.shipID);
  if (state && state.characterID === Number(session.characterID)) {
    clearPending(state);
    log.info(`[Ship] AbortSelfDestruct char=${state.characterID} ship=${state.shipID}`);
  }
  return { success: true };
}

module.exports = {
  SELF_DESTRUCT_DELAY_MS,
  beginSelfDestruct,
  abortSelfDestruct,
  _testing: { pendingByShipID, finishSelfDestruct },
};
