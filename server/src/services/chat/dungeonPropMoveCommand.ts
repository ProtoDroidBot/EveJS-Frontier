"use strict";

const path = require("path");

const USAGE = "Usage: /dungeonprop preview <entityID> <x> <y> <z> [yaw pitch roll] (validation only)";

function executeDungeonPropMoveCommand(session, argumentText, options: Record<string, any> = {}) {
  const tokens = String(argumentText || "").trim().split(/\s+/).filter(Boolean);
  const action = String(tokens.shift() || "help").toLowerCase();
  if (action === "help") return { success: true as const, message: USAGE };
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
    return {
      success: false as const,
      message: `Dungeon prop move preview denied: ${result.errorMsg}.`,
      errorMsg: result.errorMsg,
    };
  }

  const data = result.data;
  return {
    success: true as const,
    data,
    message: `Prop ${data.entityID} in dungeon instance ${data.instanceID} is eligible; ` +
      `proposed displacement ${Math.round(data.displacementMeters)} m. ` +
      "Preview only; no prop was moved.",
  };
}

module.exports = {
  executeDungeonPropMoveCommand,
};
