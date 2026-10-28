"use strict";

const BaseService = require("../baseService");
const { buildDict, buildList } = require("../_shared/serviceHelpers");

function recipeValue(value) {
  if (Array.isArray(value)) return buildList(value.map(recipeValue));
  if (value && typeof value === "object") {
    return buildDict(Object.entries(value).map(([key, child]) => [key, recipeValue(child)]));
  }
  return value;
}

function requestedItem(args): number | null {
  const value = args && args[0];
  const id = typeof value === "bigint" && value <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(value) : value;
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

/** Build-3640684 client fetches both records by itemID in the current scene. */
class CompositeAsteroidMgrService extends BaseService {
  constructor() { super("compositeAsteroidMgr"); }

  Handle_GetCompositeRecipe(args, session) {
    const itemID = requestedItem(args);
    if (itemID === null) return null;
    // Keep scene/session authorization and durable replay in the mining runtime.
    const recipe = require("./voxelMiningRuntime").getCompositeRecipeForSession(session, itemID);
    return recipe === null || recipe === undefined ? null : recipeValue(recipe);
  }

  Handle_GetCompositeMinedSet(args, session) {
    const itemID = requestedItem(args);
    if (itemID === null) return null;
    return require("./voxelMiningRuntime").getCompositeMinedSetForSession(session, itemID);
  }
}

module.exports = CompositeAsteroidMgrService;
