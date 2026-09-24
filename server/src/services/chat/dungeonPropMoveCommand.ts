"use strict";

const path = require("path");

const USAGE = "Usage: /dungeonprop preview <entityID> <x> <y> <z> [yaw pitch roll] | move <entityID> <x> <y> <z> [yaw pitch roll] | detach <entityID> | stop <worldEntityID> | clear";

function sendPreview(session, payload) {
  if (typeof session?.sendNotification !== "function") return false;
  if (session.socket && session.socket.destroyed) return false;
  try {
    session.sendNotification("OnDungeonPropMovePreview", "clientID", [payload]);
    return true;
  } catch (_error) {
    return false;
  }
}

function executeDungeonPropMoveCommand(session, argumentText, options: Record<string, any> = {}) {
  const tokens = String(argumentText || "").trim().split(/\s+/).filter(Boolean);
  const action = String(tokens.shift() || "help").toLowerCase();
  if (action === "help") return { success: true as const, message: USAGE };
  if (action === "clear" && tokens.length === 0) {
    const sent = sendPreview(session, { active: false });
    return sent
      ? { success: true as const, message: "Dungeon prop hologram clear requested." }
      : { success: false as const, message: "Dungeon prop hologram clear could not be sent." };
  }
  if (action === "detach" && tokens.length === 1 && /^\d+$/.test(tokens[0])) {
    const entityID = Number(tokens[0]);
    if (!Number.isSafeInteger(entityID) || entityID <= 0) {
      return { success: false as const, message: USAGE };
    }
    const spaceRuntime = options.spaceRuntime || require(path.join(__dirname, "../../space/runtime"));
    const detachment = options.detachment || require(path.join(__dirname, "../../space/dungeonPropDetachment"));
    const result = detachment.detachDungeonProp(
      spaceRuntime.getSceneForSession(session),
      session,
      entityID,
      options.detachmentOptions || {},
    );
    if (!result.success) {
      return {
        success: false as const,
        errorMsg: result.errorMsg,
        message: `Dungeon prop detachment failed: ${result.errorMsg}.`,
      };
    }
    sendPreview(session, { active: false });
    return {
      success: true as const,
      data: result.data,
      message: `Prop ${entityID} detached in place as persistent world entity ${result.data.worldEntityID}.`,
    };
  }
  if (action === "move" && [4, 7].includes(tokens.length) && /^\d+$/.test(tokens[0])) {
    const entityID = Number(tokens[0]);
    const coordinates = tokens.slice(1).map(Number);
    if (!Number.isSafeInteger(entityID) || entityID <= 0 ||
        !coordinates.every(Number.isFinite)) {
      return { success: false as const, message: USAGE };
    }
    const destinationPosition = { x: coordinates[0], y: coordinates[1], z: coordinates[2] };
    const rotation = coordinates.length === 6 ? coordinates.slice(3) : undefined;
    const spaceRuntime = options.spaceRuntime || require(path.join(__dirname, "../../space/runtime"));
    const scene = spaceRuntime.getSceneForSession(session);
    const movement = options.movement || require(path.join(__dirname, "../../space/dungeonPropMovement"));
    let worldEntityID = entityID;
    let newlyDetached = false;
    if (scene?.staticEntitiesByID?.get(entityID)?.kind === "siteEnvironmentProp") {
      const selection = options.selection || require(path.join(__dirname, "../dungeon/dungeonPropMoveSelection"));
      const preflight = selection.validateDungeonPropMovePreview(scene, session, {
        entityID,
        destinationPosition,
        ...(rotation ? { rotation } : {}),
      }, options.selectionOptions || {});
      if (!preflight.success) {
        return {
          success: false as const,
          errorMsg: preflight.errorMsg,
          message: `Dungeon prop move denied: ${preflight.errorMsg}.`,
        };
      }
      const detachment = options.detachment || require(path.join(__dirname, "../../space/dungeonPropDetachment"));
      const detached = detachment.detachDungeonProp(scene, session, entityID, options.detachmentOptions || {});
      if (!detached.success) {
        return {
          success: false as const,
          errorMsg: detached.errorMsg,
          message: `Dungeon prop move could not detach source: ${detached.errorMsg}.`,
        };
      }
      worldEntityID = detached.data.worldEntityID;
      newlyDetached = true;
      sendPreview(session, { active: false });
    }
    const result = movement.startDetachedPropMove(
      scene, session, worldEntityID, destinationPosition,
      { ...(options.movementOptions || {}), ...(rotation ? { rotation } : {}) },
    );
    if (!result.success) {
      sendPreview(session, { active: false });
      return {
        success: false as const,
        errorMsg: result.errorMsg,
        data: newlyDetached ? { worldEntityID } : undefined,
        message: newlyDetached
          ? `Prop detached as world entity ${worldEntityID}, but movement failed: ${result.errorMsg}.`
          : `Dungeon prop move failed: ${result.errorMsg}.`,
      };
    }
    sendPreview(session, { active: false });
    return {
      success: true as const,
      data: result.data,
      message: `Prop ${worldEntityID} is moving toward ${coordinates.slice(0, 3).join(", ")}.`,
    };
  }
  if (action === "stop" && tokens.length === 1 && /^\d+$/.test(tokens[0])) {
    const worldEntityID = Number(tokens[0]);
    if (!Number.isSafeInteger(worldEntityID) || worldEntityID <= 0) {
      return { success: false as const, message: USAGE };
    }
    const spaceRuntime = options.spaceRuntime || require(path.join(__dirname, "../../space/runtime"));
    const movement = options.movement || require(path.join(__dirname, "../../space/dungeonPropMovement"));
    const result = movement.stopDetachedPropMove(
      spaceRuntime.getSceneForSession(session), session, worldEntityID,
      options.movementOptions || {},
    );
    return result.success
      ? { success: true as const, data: result.data, message: `Prop ${worldEntityID} stopped.` }
      : { success: false as const, errorMsg: result.errorMsg,
        message: `Dungeon prop stop failed: ${result.errorMsg}.` };
  }
  if (action !== "preview" || ![4, 7].includes(tokens.length) || !/^\d+$/.test(tokens[0])) {
    return { success: false as const, message: USAGE };
  }

  const entityID = Number(tokens[0]);
  const coordinates = tokens.slice(1).map(Number);
  if (
    !Number.isSafeInteger(entityID) ||
    entityID <= 0 ||
    !coordinates.every(Number.isFinite)
  ) {
    return { success: false as const, message: USAGE };
  }

  const spaceRuntime = options.spaceRuntime || require(path.join(__dirname, "../../space/runtime"));
  const selection = options.selection || require(path.join(__dirname, "../dungeon/dungeonPropMoveSelection"));
  const scene = spaceRuntime.getSceneForSession(session);
  const result = selection.validateDungeonPropMovePreview(
    scene,
    session,
    {
      entityID,
      destinationPosition: { x: coordinates[0], y: coordinates[1], z: coordinates[2] },
      ...(coordinates.length === 6 ? { rotation: coordinates.slice(3) } : {}),
    },
    options.selectionOptions || {},
  );
  if (!result.success) {
    sendPreview(session, { active: false });
    return {
      success: false as const,
      message: `Dungeon prop move preview denied: ${result.errorMsg}.`,
      errorMsg: result.errorMsg,
    };
  }

  const data = result.data;
  if (!sendPreview(session, {
    active: true,
    systemID: data.systemID,
    entityID: data.entityID,
    graphicID: data.graphicID,
    radius: data.radius,
    collisionScale: data.collisionScale,
    position: [data.destinationPosition.x, data.destinationPosition.y, data.destinationPosition.z],
    rotation: data.rotation,
  })) {
    return { success: false as const, message: "Dungeon prop hologram could not be sent to this client." };
  }
  return {
    success: true as const,
    data,
    message: `Prop ${data.entityID} in dungeon instance ${data.instanceID} is eligible; ` +
      `proposed displacement ${Math.round(data.displacementMeters)} m. ` +
      "Hologram preview sent; no prop was moved. Use /dungeonprop clear to remove it.",
  };
}

module.exports = {
  executeDungeonPropMoveCommand,
};
