"use strict";

const path = require("path");

const log = require(path.join(__dirname, "../utils/logger"));
const {
  CRUDE_MATTER_GROUP_ID,
  classifyCrudeMatterResource,
} = require(path.join(__dirname, "./frontierRiftAuthority"));

const MAX_RIFT_SCENE_PROPS = 32;

function toInt(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.trunc(numeric) : fallback;
}

function toFiniteNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function clonePosition(value) {
  const source = value && typeof value === "object" ? value : {};
  return {
    x: toFiniteNumber(source.x, 0),
    y: toFiniteNumber(source.y, 0),
    z: toFiniteNumber(source.z, 0),
  };
}

function resolveDependencies(options: Record<string, any> = {}) {
  return {
    authority: options.authority || require(path.join(__dirname, "./frontierRiftAuthority")),
    dungeonService: options.dungeonService || require(path.join(
      __dirname,
      "../services/dungeon/dungeonUniverseSiteService",
    )),
    siteStore: options.siteStore || require(path.join(__dirname, "./frontierRiftSites")),
    miningRuntimeState: options.miningRuntimeState || require(path.join(
      __dirname,
      "../services/mining/miningRuntimeState",
    )),
  };
}

function ensureSceneState(scene) {
  if (!(scene._frontierMaterializedRiftSiteIDs instanceof Set)) {
    scene._frontierMaterializedRiftSiteIDs = new Set<any>();
  }
  return scene._frontierMaterializedRiftSiteIDs;
}

function clearPrivateDungeonVisibilityMarkers(entity) {
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

function buildRiftSiteEntity(site) {
  const radius = Math.max(1, toFiniteNumber(site && site.radius, 1));
  const systemID = toInt(site && site.solarSystemID, 0);
  return {
    kind: "riftDungeon",
    customFrontierRiftSite: true,
    nonPhysicalDecloakExempt: true,
    itemID: toInt(site && site.itemID, 0),
    typeID: toInt(site && site.typeID, 0),
    groupID: toInt(site && site.groupID, 0),
    categoryID: toInt(site && site.categoryID, 0),
    graphicID: toInt(site && site.graphicID, 0) || null,
    itemName: String(site && site.itemName || "Crude Rift"),
    slimName: String(site && site.itemName || "Crude Rift"),
    ownerID: 1,
    radius,
    signatureRadius: Math.max(
      1,
      toFiniteNumber(site && site.signatureRadius, radius),
    ),
    position: clonePosition(site && site.position),
    velocity: { x: 0, y: 0, z: 0 },
    direction: { x: 1, y: 0, z: 0 },
    locationID: systemID,
    systemID,
    dungeonID: toInt(site && site.dungeonID, 0),
    dungeonNameID: toInt(site && site.dungeonNameID, 0) || null,
    archetypeID: toInt(site && site.archetypeID, 0) || null,
    dungeonEntryObjectID: toInt(site && site.dungeonEntryObjectID, 0) || null,
    dungeonObjectID: toInt(site && site.dungeonEntryObjectID, 0) || null,
    dunObjectID: toInt(site && site.dungeonEntryObjectID, 0) || null,
    dunPosition: [0, 0, 0],
    resourceTypeIDs: Array.isArray(site && site.resourceTypeIDs)
      ? [...site.resourceTypeIDs]
      : [],
    resourceProfiles: Array.isArray(site && site.resourceProfiles)
      ? site.resourceProfiles.map((profile) => ({
        ...profile,
        tags: Array.isArray(profile && profile.tags) ? [...profile.tags] : [],
      }))
      : [],
    riftTags: Array.isArray(site && site.riftTags) ? [...site.riftTags] : [],
    riftPoints: Math.max(1, toInt(site && site.points, 1)),
    staticVisibilityScope: "system",
  };
}

function buildRiftEnvironmentPlan(template) {
  return template.sceneObjects.slice(0, MAX_RIFT_SCENE_PROPS).map((object) => ({
    dunObjectID: object.objectID,
    exact: true,
    key: `frontier-rift:${template.dungeonID}:${object.roomID}:${object.objectID}`,
    positionOffset: clonePosition(object.positionOffset),
    dunRotation: Array.isArray(object.rotation) ? [...object.rotation] : [0, 0, 0],
    suppressSlimGraphicID: true,
    suppressSlimName: true,
    typeID: object.typeID,
  }));
}

function materializeRiftSite(scene, site, options: Record<string, any> = {}) {
  if (!scene || !site) {
    return { success: false, errorMsg: "RIFT_SITE_NOT_FOUND" };
  }
  const siteID = toInt(site.itemID, 0);
  if (siteID <= 0) {
    return { success: false, errorMsg: "INVALID_RIFT_SITE_ID" };
  }
  if (String(site.lifecycleState || "active").toLowerCase() === "depleted") {
    return { success: false, errorMsg: "RIFT_SITE_DEPLETED" };
  }
  const dependencies = resolveDependencies(options);
  const template = dependencies.authority.getTemplateByDungeonID(site.dungeonID);
  if (!template) {
    return { success: false, errorMsg: "RIFT_TEMPLATE_NOT_FOUND" };
  }

  let siteEntity = scene.staticEntitiesByID.get(siteID) || null;
  let rootAdded = false;
  if (!siteEntity) {
    siteEntity = buildRiftSiteEntity(site);
    rootAdded = scene.addStaticEntity(siteEntity);
    if (!rootAdded) {
      return { success: false, errorMsg: "RIFT_SITE_ADD_FAILED" };
    }
  }

  const materializedIDs = ensureSceneState(scene);
  if (materializedIDs.has(siteID)) {
    return {
      success: true,
      data: { alreadyMaterialized: true, propsSpawned: 0, rootAdded, siteID },
    };
  }

  const environmentPlan = buildRiftEnvironmentPlan(template);
  const resourceProfilesByObjectID = new Map(
    (Array.isArray(template.resourceVariants) ? template.resourceVariants : [])
      .map((resource) => [
        toInt(resource && resource.objectID, 0),
        classifyCrudeMatterResource(resource),
      ])
      .filter(([objectID]) => objectID > 0),
  );
  const rawEntities = dependencies.dungeonService.buildEnvironmentEntities(
    { instanceID: siteID },
    siteEntity,
    {},
    {
      environmentProps: environmentPlan,
      exactContentCaps: { environmentProps: MAX_RIFT_SCENE_PROPS },
    },
  );
  const resourceEntityIDs = rawEntities
    .filter((entity) => toInt(entity && entity.groupID, 0) === CRUDE_MATTER_GROUP_ID)
    .map((entity) => toInt(entity && entity.itemID, 0))
    .filter((entityID) => entityID > 0);
  siteEntity.frontierRiftResourceEntityIDs = resourceEntityIDs;
  const addedEntities: any[] = [];
  for (const rawEntity of rawEntities) {
    const entity = clearPrivateDungeonVisibilityMarkers(rawEntity);
    entity.kind = "riftEnvironmentProp";
    entity.customFrontierRiftContent = true;
    entity.frontierRiftSiteID = siteID;
    entity.frontierRiftDungeonID = template.dungeonID;
    entity.frontierRiftResource = toInt(entity.groupID, 0) === CRUDE_MATTER_GROUP_ID;
    if (entity.frontierRiftResource === true) {
      const resourceProfile = resourceProfilesByObjectID.get(
        toInt(entity.dunObjectID, 0),
      ) || classifyCrudeMatterResource(entity);
      entity.frontierRiftFormation = resourceProfile.formation;
      entity.frontierRiftYieldTier = resourceProfile.potential;
      if (toInt(resourceProfile.resourceQuantity, 0) > 0) {
        entity.resourceQuantity = toInt(resourceProfile.resourceQuantity, 0);
      }
    }
    entity.nonPhysicalDecloakExempt = true;
    entity.staticVisibilityScope = "bubble";
    if (scene.addStaticEntity(entity)) {
      if (
        entity.frontierRiftResource === true &&
        scene._miningRuntimeState &&
        dependencies.miningRuntimeState &&
        typeof dependencies.miningRuntimeState.registerMineableEntity === "function"
      ) {
        dependencies.miningRuntimeState.registerMineableEntity(scene, entity, {
          broadcast: false,
        });
      }
      const entityStillPresent = typeof scene.getEntityByID === "function"
        ? Boolean(scene.getEntityByID(entity.itemID))
        : scene.staticEntitiesByID instanceof Map
          ? scene.staticEntitiesByID.has(entity.itemID)
          : true;
      if (entityStillPresent) {
        addedEntities.push(entity);
      }
    }
  }
  materializedIDs.add(siteID);

  if (options.broadcast === true) {
    if (rootAdded) {
      scene.broadcastAddBalls([siteEntity], options.excludedSession || null);
    }
    if (addedEntities.length > 0) {
      scene.broadcastAddBalls(addedEntities, options.excludedSession || null);
    }
  }

  log.info(
    `[FrontierRift] Materialized site=${siteID} dungeon=${template.dungeonID} ` +
    `type=${template.entryTypeID} props=${addedEntities.length} resources=${template.resources.length}`,
  );
  return {
    success: true,
    data: {
      alreadyMaterialized: false,
      propsSpawned: addedEntities.length,
      resourceTypeIDs: template.resources.map((resource) => resource.typeID),
      rootAdded,
      siteID,
    },
  };
}

function dematerializeRiftSite(scene, siteID, options: Record<string, any> = {}) {
  const numericSiteID = toInt(siteID, 0);
  if (!scene || numericSiteID <= 0) {
    return { success: false, errorMsg: "INVALID_RIFT_SITE_ID" };
  }
  const content = (Array.isArray(scene.staticEntities) ? scene.staticEntities : [])
    .filter((entity) => (
      entity &&
      entity.customFrontierRiftContent === true &&
      toInt(entity.frontierRiftSiteID, 0) === numericSiteID
    ));
  const removedEntityIDs: any[] = [];
  for (const entity of content) {
    const result = scene.removeStaticEntity(entity.itemID, {
      broadcast: options.broadcast !== false,
      excludedSession: options.excludedSession || null,
    });
    if (result && result.success === true) {
      removedEntityIDs.push(entity.itemID);
    }
  }
  const root = scene.staticEntitiesByID.get(numericSiteID) || null;
  if (root && root.customFrontierRiftSite === true) {
    scene.removeStaticEntity(numericSiteID, {
      broadcast: options.broadcast !== false,
      excludedSession: options.excludedSession || null,
    });
  }
  ensureSceneState(scene).delete(numericSiteID);
  return {
    success: true,
    errorMsg: null,
    data: { removedEntityIDs, siteID: numericSiteID },
  };
}

function handleSceneCreated(scene, options: Record<string, any> = {}) {
  if (!scene) {
    return { success: false, errorMsg: "SCENE_NOT_FOUND" };
  }
  const dependencies = resolveDependencies(options);
  const nowMs = Math.max(0, toInt(options.nowMs, Date.now()));
  if (typeof dependencies.siteStore.reactivateDueSites === "function") {
    dependencies.siteStore.reactivateDueSites(scene.systemID, nowMs);
  }
  const activeSites = dependencies.siteStore.listSites(scene.systemID, { activeOnly: true });
  const results = activeSites.map((site) => (
    materializeRiftSite(scene, site, {
      ...options,
      authority: dependencies.authority,
      dungeonService: dependencies.dungeonService,
      siteStore: dependencies.siteStore,
      broadcast: false,
    })
  ));
  scheduleNextRiftLifecycleCheck(scene, dependencies.siteStore);
  return {
    success: results.every((result) => result && result.success === true),
    data: { results, sites: results.length },
  };
}

function scheduleNextRiftLifecycleCheck(scene, siteStore) {
  if (!scene || !siteStore || typeof siteStore.listSites !== "function") {
    return 0;
  }
  const nextRespawnAtMs = siteStore
    .listSites(scene.systemID, { depletedOnly: true })
    .map((site) => Math.max(0, toInt(site && site.respawnAtMs, 0)))
    .filter((value) => value > 0)
    .sort((left, right) => left - right)[0] || 0;
  scene._frontierRiftNextLifecycleCheckAtMs = nextRespawnAtMs;
  return nextRespawnAtMs;
}

function handleResourceDepleted(scene, resourceEntity, options: Record<string, any> = {}) {
  const siteID = toInt(resourceEntity && resourceEntity.frontierRiftSiteID, 0);
  if (!scene || siteID <= 0 || resourceEntity.frontierRiftResource !== true) {
    return { success: false, errorMsg: "RIFT_RESOURCE_NOT_FOUND" };
  }
  const remainingResources = (Array.isArray(scene.staticEntities) ? scene.staticEntities : [])
    .filter((entity) => (
      entity &&
      entity.frontierRiftResource === true &&
      toInt(entity.frontierRiftSiteID, 0) === siteID &&
      toInt(entity.itemID, 0) !== toInt(resourceEntity.itemID, 0)
    ));
  if (remainingResources.length > 0) {
    return {
      success: true,
      data: { completed: false, remainingResourceCount: remainingResources.length, siteID },
    };
  }

  const dependencies = resolveDependencies(options);
  const nowMs = Math.max(0, toInt(options.nowMs, Date.now()));
  const root = scene.staticEntitiesByID instanceof Map
    ? scene.staticEntitiesByID.get(siteID) || null
    : null;
  const resourceEntityIDs = [...new Set<any>([
    toInt(resourceEntity.itemID, 0),
    ...(Array.isArray(root && root.frontierRiftResourceEntityIDs)
      ? root.frontierRiftResourceEntityIDs.map((entityID) => toInt(entityID, 0))
      : []),
  ].filter((entityID) => entityID > 0))];
  const markResult = dependencies.siteStore.markDepleted(siteID, { nowMs });
  if (!markResult || markResult.success !== true) {
    return markResult || { success: false, errorMsg: "RIFT_DEPLETION_PERSIST_FAILED" };
  }

  const dematerializeResult = dematerializeRiftSite(scene, siteID, {
    broadcast: options.broadcast !== false,
    excludedSession: options.excludedSession || null,
  });
  if (
    dependencies.miningRuntimeState &&
    typeof dependencies.miningRuntimeState.clearMineableState === "function"
  ) {
    for (const entityID of resourceEntityIDs) {
      dependencies.miningRuntimeState.clearMineableState(scene, entityID);
    }
  }
  scene._frontierRiftNextLifecycleCheckAtMs = toInt(
    markResult.data && markResult.data.respawnAtMs,
    nowMs,
  );
  return {
    success: true,
    data: {
      completed: true,
      depletedAtMs: toInt(markResult.data && markResult.data.depletedAtMs, nowMs),
      respawnAtMs: toInt(markResult.data && markResult.data.respawnAtMs, 0),
      resourceEntityIDs,
      siteID,
      dematerialized: dematerializeResult && dematerializeResult.success === true,
    },
  };
}

function tickScene(scene, nowMs = Date.now(), options: Record<string, any> = {}) {
  if (!scene) {
    return { success: false, errorMsg: "SCENE_NOT_FOUND" };
  }
  const normalizedNowMs = Math.max(0, toInt(nowMs, Date.now()));
  const nextCheckAtMs = Math.max(0, toInt(scene._frontierRiftNextLifecycleCheckAtMs, 0));
  if (nextCheckAtMs <= 0 || normalizedNowMs < nextCheckAtMs) {
    return { success: true, data: { respawned: [] } };
  }
  const dependencies = resolveDependencies(options);
  const reactivateResult = dependencies.siteStore.reactivateDueSites(
    scene.systemID,
    normalizedNowMs,
  );
  if (!reactivateResult || reactivateResult.success !== true) {
    return reactivateResult || { success: false, errorMsg: "RIFT_REACTIVATION_FAILED" };
  }
  const respawned: any[] = [];
  for (const site of reactivateResult.data.sites || []) {
    const result = materializeRiftSite(scene, site, {
      ...options,
      authority: dependencies.authority,
      dungeonService: dependencies.dungeonService,
      miningRuntimeState: dependencies.miningRuntimeState,
      siteStore: dependencies.siteStore,
      broadcast: options.broadcast !== false,
    });
    if (result && result.success === true) {
      respawned.push(site.itemID);
    }
  }
  scheduleNextRiftLifecycleCheck(scene, dependencies.siteStore);
  return { success: true, data: { respawned } };
}

module.exports = {
  MAX_RIFT_SCENE_PROPS,
  buildRiftEnvironmentPlan,
  buildRiftSiteEntity,
  clearPrivateDungeonVisibilityMarkers,
  dematerializeRiftSite,
  handleSceneCreated,
  handleResourceDepleted,
  materializeRiftSite,
  scheduleNextRiftLifecycleCheck,
  tickScene,
};
