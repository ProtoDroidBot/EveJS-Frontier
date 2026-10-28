/** Pure worker-thread planning for cold solar-system scene bootstrap. */

"use strict";

const path = require("path");

function buildSceneFacade(input) {
  const staticEntities = Array.isArray(input && input.staticEntities)
    ? input.staticEntities
    : [];
  const staticEntitiesByID = new Map(
    staticEntities
      .filter((entity) => entity && Number(entity.itemID) > 0)
      .map((entity) => [Number(entity.itemID), entity]),
  );
  return {
    systemID: Number(input && input.systemID) || 0,
    staticEntities,
    staticEntitiesByID,
    getEntityByID(entityID) {
      return staticEntitiesByID.get(Number(entityID)) || null;
    },
  };
}

function buildSceneBootstrapPlan(input: Record<string, any> = {}) {
  const scene = buildSceneFacade(input);
  if (scene.systemID <= 0) {
    throw new TypeError("scene bootstrap planning requires a positive systemID");
  }

  let asteroidPlan = { systemID: scene.systemID, fields: [] };
  if (input.asteroidsEnabled === true) {
    const asteroidService = require(path.join(__dirname, "./asteroids/asteroidService"));
    asteroidPlan = asteroidService.buildSceneAsteroidFieldPlan(scene);
  }

  let resourceSiteEntities: any[] = [];
  if (input.miningEnabled === true) {
    const miningResourceSiteService = require(path.join(
      __dirname,
      "../services/mining/miningResourceSiteService",
    ));
    resourceSiteEntities = miningResourceSiteService.buildGeneratedResourceSitePlanFromDefinitions(
      scene,
      Array.isArray(input.resourceSiteDefinitions) ? input.resourceSiteDefinitions : [],
      { recordBootstrap: false },
    );
  }

  return {
    systemID: scene.systemID,
    generation: Number(input.generation) || 0,
    asteroidPlan,
    resourceSiteEntities,
  };
}

module.exports = {
  buildSceneBootstrapPlan,
};
