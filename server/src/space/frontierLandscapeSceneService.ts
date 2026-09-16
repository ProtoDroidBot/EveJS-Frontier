const path = require("path");

const log = require(path.join(__dirname, "../utils/logger"));
const {
  DEFAULT_MAX_SCENERY_PROPS,
  DEFAULT_MAX_RESOURCE_PROPS,
  buildLandscapeScenePlan,
} = require(path.join(__dirname, "./frontierLandscapeScenePlan"));
const {
  resolveFrontierSalvageResourceProfile,
} = require(path.join(__dirname, "../services/mining/frontierSalvageResources"));

const DEFAULT_MATERIALIZE_RANGE_METERS = 1_000_000;
const DEFAULT_MAX_NEARBY_SITES = 4;
const MAX_EXACT_LANDSCAPE_PROPS = 96;

function toInt(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.trunc(numeric) : fallback;
}

function toFiniteNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function getPosition(value) {
  if (!value || !value.position) {
    return null;
  }
  return {
    x: toFiniteNumber(value.position.x, 0),
    y: toFiniteNumber(value.position.y, 0),
    z: toFiniteNumber(value.position.z, 0),
  };
}

function distanceSquared(left, right) {
  const dx = left.x - right.x;
  const dy = left.y - right.y;
  const dz = left.z - right.z;
  return (dx * dx) + (dy * dy) + (dz * dz);
}

function findNearestLandscapeSite(scene, anchorEntity, rangeMeters) {
  return findLandscapeSitesWithinRange(scene, anchorEntity, rangeMeters, 1)[0] || null;
}

function findLandscapeSitesWithinRange(
  scene,
  anchorEntity,
  rangeMeters,
  maxSites = DEFAULT_MAX_NEARBY_SITES,
) {
  const anchorPosition = getPosition(anchorEntity);
  if (!scene || !anchorPosition) {
    return [];
  }
  const maximumDistanceSquared = Math.max(1, rangeMeters) ** 2;
  const sites: any[] = [];
  for (const entity of Array.isArray(scene.staticEntities) ? scene.staticEntities : []) {
    if (!entity || String(entity.kind || "") !== "landscapeSite") {
      continue;
    }
    const position = getPosition(entity);
    if (!position) {
      continue;
    }
    const candidateDistanceSquared = distanceSquared(anchorPosition, position);
    if (candidateDistanceSquared <= maximumDistanceSquared) {
      sites.push({ entity, distanceSquared: candidateDistanceSquared });
    }
  }
  return sites
    .sort((left, right) => left.distanceSquared - right.distanceSquared)
    .slice(0, Math.max(1, toInt(maxSites, DEFAULT_MAX_NEARBY_SITES)))
    .map((entry) => entry.entity);
}

function clearDungeonVisibilityMarkers(entity) {
  for (const fieldName of [
    "dungeonEnvironmentSource",
    "dungeonEnvironmentTemplateID",
    "dungeonMaterializedEnvironment",
    "dungeonMaterializedSiteContent",
    "dungeonSiteID",
    "dungeonSiteInstanceID",
  ]) {
    delete entity[fieldName];
  }
  return entity;
}

function resolveDependencies(options: Record<string, any> = {}) {
  return {
    classifyResourceObject:
      options.classifyResourceObject || resolveFrontierSalvageResourceProfile,
    dungeonService: options.dungeonService || require(path.join(
      __dirname,
      "../services/dungeon/dungeonUniverseSiteService",
    )),
    miningRuntimeState: options.miningRuntimeState || null,
    worldData: options.worldData || require(path.join(__dirname, "./worldData")),
  };
}

function ensureSceneState(scene) {
  if (!(scene._frontierLandscapeMaterializedSiteIDs instanceof Set)) {
    scene._frontierLandscapeMaterializedSiteIDs = new Set<any>();
  }
  return scene._frontierLandscapeMaterializedSiteIDs;
}

function materializeNearbyLandscapeSite(scene, anchorEntity, options: Record<string, any> = {}) {
  const rangeMeters = Math.max(
    1,
    toFiniteNumber(options.rangeMeters, DEFAULT_MATERIALIZE_RANGE_METERS),
  );
  const siteEntity = findNearestLandscapeSite(scene, anchorEntity, rangeMeters);
  if (!siteEntity) {
    return null;
  }

  return materializeLandscapeSite(scene, siteEntity, options);
}

function materializeNearbyLandscapeSites(scene, anchorEntity, options: Record<string, any> = {}) {
  const rangeMeters = Math.max(
    1,
    toFiniteNumber(options.rangeMeters, DEFAULT_MATERIALIZE_RANGE_METERS),
  );
  const sites = findLandscapeSitesWithinRange(
    scene,
    anchorEntity,
    rangeMeters,
    options.maxSites,
  );
  if (sites.length <= 0) {
    return null;
  }
  const results = sites.map((site) => materializeLandscapeSite(scene, site, options));
  return {
    success: results.every((result) => result && result.success === true),
    errorMsg: results.find((result) => result && result.success !== true)?.errorMsg || null,
    data: {
      results,
      siteIDs: sites.map((site) => toInt(site.itemID, 0)),
    },
  };
}

function materializeLandscapeSite(scene, siteEntity, options: Record<string, any> = {}) {
  if (!scene || !siteEntity || String(siteEntity.kind || "") !== "landscapeSite") {
    return {
      success: false,
      errorMsg: "LANDSCAPE_SITE_NOT_FOUND",
    };
  }

  const siteID = Math.max(0, toInt(siteEntity.itemID, 0));
  if (siteID <= 0) {
    return {
      success: false,
      errorMsg: "INVALID_LANDSCAPE_SITE_ID",
    };
  }
  const materializedSiteIDs = ensureSceneState(scene);
  if (materializedSiteIDs.has(siteID)) {
    return {
      success: true,
      data: {
        alreadyMaterialized: true,
        siteID,
      },
    };
  }

  const dependencies = resolveDependencies(options);
  const {
    classifyResourceObject,
    dungeonService,
    worldData,
  } = dependencies;
  const ecosystem = worldData.getLandscapeEcosystemByID(siteEntity.ecosystemID);
  if (!ecosystem) {
    return {
      success: false,
      errorMsg: "LANDSCAPE_ECOSYSTEM_NOT_FOUND",
      siteID,
    };
  }
  if (!dungeonService || typeof dungeonService.buildEnvironmentEntities !== "function") {
    return {
      success: false,
      errorMsg: "LANDSCAPE_ENVIRONMENT_BUILDER_NOT_FOUND",
      siteID,
    };
  }

  const maxSceneryProps = Math.max(
    1,
    Math.min(96, toInt(options.maxSceneryProps, DEFAULT_MAX_SCENERY_PROPS)),
  );
  const maxResourceProps = Math.max(
    1,
    Math.min(96, toInt(options.maxResourceProps, DEFAULT_MAX_RESOURCE_PROPS)),
  );
  const plan = buildLandscapeScenePlan(
    siteEntity,
    ecosystem,
    (dungeonID) => worldData.getLandscapeDungeonTemplateByID(dungeonID),
    {
      classifyResourceObject,
      maxResourceProps,
      maxSceneryProps,
    },
  );
  const exactProps = [
    ...(Array.isArray(plan.resourceProps) ? plan.resourceProps : []),
    ...(Array.isArray(plan.environmentProps) ? plan.environmentProps : []),
  ].slice(0, MAX_EXACT_LANDSCAPE_PROPS);
  const entities = dungeonService.buildEnvironmentEntities(
    { instanceID: siteID },
    siteEntity,
    {},
    {
      environmentProps: exactProps,
      exactContentCaps: { environmentProps: exactProps.length },
    },
  );
  const addedEntities: any[] = [];
  const resourceEntities: any[] = [];
  for (const rawEntity of entities) {
    const entity = clearDungeonVisibilityMarkers(rawEntity);
    const resourceProfile = classifyResourceObject(entity);
    entity.kind = resourceProfile
      ? "landscapeSalvageResource"
      : "landscapeEnvironmentProp";
    entity.landscapeMaterializedSiteContent = true;
    entity.landscapeSiteID = siteID;
    entity.landscapeEcosystemID = toInt(siteEntity.ecosystemID, 0);
    entity.landscapeDunObjectID = toInt(entity.dunObjectID, 0) || null;
    if (resourceProfile) {
      const visualTypeID = Math.max(0, toInt(resourceProfile.typeID, entity.typeID));
      const visualTypeRecord = resourceProfile.typeRecord || {};
      entity.landscapeSalvageResource = true;
      entity.beltID = siteID;
      entity.miningPresentationTypeID = visualTypeID;
      entity.miningYieldTypeID = Math.max(0, toInt(resourceProfile.yieldTypeID, visualTypeID));
      entity.miningYieldKind = "salvage";
      entity.preserveMiningVisualPresentation = true;
      entity.resourceQuantity = Math.max(1, toInt(resourceProfile.resourceQuantity, 1));
      entity.skipMiningTemplateResolution = true;
      entity.suppressSlimGraphicID = false;
      entity.suppressSlimName = false;
      entity.slimGraphicID = toInt(entity.graphicID, 0) || null;
      entity.itemName = String(visualTypeRecord.name || entity.itemName || "Salvageable Wreckage");
      entity.slimName = entity.itemName;
    }
    entity.nonPhysicalDecloakExempt = true;
    entity.staticVisibilityScope = "bubble";
    if (scene.addStaticEntity(entity)) {
      if (resourceProfile) {
        const miningRuntimeState = dependencies.miningRuntimeState || require(path.join(
          __dirname,
          "../services/mining/miningRuntimeState",
        ));
        if (
          scene._miningRuntimeState &&
          miningRuntimeState &&
          typeof miningRuntimeState.registerMineableEntity === "function"
        ) {
          miningRuntimeState.registerMineableEntity(scene, entity, { broadcast: false });
        }
      }
      const entityStillPresent = typeof scene.getEntityByID === "function"
        ? Boolean(scene.getEntityByID(entity.itemID))
        : scene.staticEntitiesByID instanceof Map
          ? scene.staticEntitiesByID.has(entity.itemID)
          : true;
      if (entityStillPresent) {
        addedEntities.push(entity);
        if (resourceProfile) {
          resourceEntities.push(entity);
        }
      }
    }
  }
  siteEntity.landscapeSalvageResourceEntityIDs = resourceEntities
    .map((entity) => toInt(entity && entity.itemID, 0))
    .filter((entityID) => entityID > 0);
  materializedSiteIDs.add(siteID);

  if (
    options.broadcast === true &&
    addedEntities.length > 0 &&
    typeof scene.broadcastAddBalls === "function"
  ) {
    scene.broadcastAddBalls(addedEntities, options.excludedSession || null);
  }

  log.info(
    `[FrontierLandscape] Materialized site=${siteID} ecosystem=${toInt(siteEntity.ecosystemID, 0)} ` +
    `patterns=${plan.selectedPatterns.length} props=${addedEntities.length} ` +
    `resources=${resourceEntities.length} locators=${plan.locators.length}`,
  );
  return {
    success: true,
    data: {
      alreadyMaterialized: false,
      ecosystemID: toInt(siteEntity.ecosystemID, 0),
      locators: plan.locators,
      patterns: plan.selectedPatterns,
      propsSpawned: addedEntities.length,
      resourcesSpawned: resourceEntities.length,
      siteID,
    },
  };
}

function dematerializeLandscapeSite(scene, siteID, options: Record<string, any> = {}) {
  const numericSiteID = Math.max(0, toInt(siteID, 0));
  if (!scene || numericSiteID <= 0) {
    return {
      success: false,
      errorMsg: "INVALID_LANDSCAPE_SITE_ID",
    };
  }

  const entities = (Array.isArray(scene.staticEntities) ? scene.staticEntities : [])
    .filter((entity) => (
      entity &&
      ["landscapeEnvironmentProp", "landscapeSalvageResource"].includes(
        String(entity.kind || ""),
      ) &&
      toInt(entity.landscapeSiteID, 0) === numericSiteID
    ));
  const removedEntityIDs: any[] = [];
  for (const entity of entities) {
    const result = scene.removeStaticEntity(entity.itemID, {
      broadcast: options.broadcast !== false,
      excludedSession: options.excludedSession || null,
      nowMs: options.nowMs,
    });
    if (result && result.success === true) {
      if (String(entity.kind || "") === "landscapeSalvageResource") {
        const miningRuntimeState = options.miningRuntimeState || (
          scene._miningRuntimeState
            ? require(path.join(__dirname, "../services/mining/miningRuntimeState"))
            : null
        );
        if (
          miningRuntimeState &&
          typeof miningRuntimeState.clearMineableState === "function"
        ) {
          miningRuntimeState.clearMineableState(scene, entity.itemID, {
            removePersisted: false,
          });
        }
      }
      removedEntityIDs.push(entity.itemID);
    }
  }
  ensureSceneState(scene).delete(numericSiteID);

  return {
    success: true,
    errorMsg: null,
    data: {
      removedCount: removedEntityIDs.length,
      removedEntityIDs,
      siteID: numericSiteID,
    },
  };
}

module.exports = {
  DEFAULT_MAX_NEARBY_SITES,
  DEFAULT_MATERIALIZE_RANGE_METERS,
  clearDungeonVisibilityMarkers,
  dematerializeLandscapeSite,
  findLandscapeSitesWithinRange,
  findNearestLandscapeSite,
  materializeLandscapeSite,
  materializeNearbyLandscapeSite,
  materializeNearbyLandscapeSites,
};
