"use strict";

const catalog = require("./compositeMiningCatalog3640684.json");
const {
  buildSetBallPositionPayload,
  buildSetBallVelocityPayload,
} = require("./destiny/stream/actions");

const TARGET_TYPES = new Map<number, any>(catalog.types.map((row) => [row.typeID, Object.freeze(row)]));
const COMPOSITE_TYPE_ID = 95899;
const REGOLITH_GROUP_IDS = Object.freeze([5144, 5145, 5146, 5147, 5148]);
// These eight yield IDs retain identity across 3502403 and 3640684. Material
// keys follow the old catalog's names (for example 77810 Platinum-Palladium
// Matrix); their current display names changed. Single-material recipes are
// server policy, while the IDs/components come from the verified client catalog.
const LEGACY_MATERIAL_BY_YIELD_TYPE_ID = Object.freeze({
  77800: "feldspar", 77810: "ptpd", 77811: "sulfide", 78426: "iridosmine",
  78446: "methane", 78447: "kerogen", 78448: "aromatic", 78449: "tholin",
});
const LEGACY_YIELD_BY_CARRIER_TYPE_ID = Object.freeze({
  91374: 77800, 91375: 77810, 91376: 78426, 91377: 77811,
  91378: 78446, 91379: 78447, 91380: 78448, 91381: 78449,
});
const SCOOP_RANGE_METERS = 2500;

function positiveInteger(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : null;
}

function vector(value) {
  if (!value || ![value.x, value.y, value.z].every(Number.isFinite)) return null;
  return { x: value.x, y: value.y, z: value.z };
}

function resolveTargetType(typeID) {
  return TARGET_TYPES.get(Number(typeID)) || null;
}

function resolveCompositePresentation(entity, state: Record<string, any> = {}, policy: Record<string, any> = {}) {
  if (!entity || (state.yieldKind || state.resourceKind || entity.miningYieldKind || "ore") !== "ore") return null;
  const yieldTypeID = positiveInteger(state.yieldTypeID || entity.miningYieldTypeID) ||
    LEGACY_YIELD_BY_CARRIER_TYPE_ID[Number(entity.miningPresentationTypeID || entity.slimTypeID || entity.typeID)];
  const substrate = policy.materialsByTypeID?.[yieldTypeID] || null;
  const material = substrate?.material || LEGACY_MATERIAL_BY_YIELD_TYPE_ID[yieldTypeID];
  if (substrate && (!require("../services/mining/compositeAsteroidModel").COMPOSITE_MATERIALS.includes(material) ||
      !Number.isFinite(substrate.density) || substrate.density <= 0 ||
      !Number.isFinite(substrate.porosity) || substrate.porosity < 0 || substrate.porosity >= 1 ||
      !Number.isFinite(substrate.toughness) || substrate.toughness <= 0 ||
      !Number.isInteger(substrate.gateTier) || substrate.gateTier < 0)) throw new Error("INVALID_VOXEL_SUBSTRATE_POLICY");
  if (!material) return null;
  const fragment = resolveTargetType(yieldTypeID);
  const asteroid = resolveTargetType(COMPOSITE_TYPE_ID);
  if (!fragment || !fragment.regolithBlock || fragment.scoopAccessPolicy !== "public") return null;
  return { ...asteroid, material, fragmentTypeID: fragment.typeID, yieldTypeID, substrate: substrate ? { ...substrate, effectiveDensity: substrate.density * (1 - substrate.porosity) } : null };
}

function applyCompositePresentation(entity, model, presentation) {
  if (!entity || !model || !presentation || !resolveTargetType(presentation.typeID)?.compositeAsteroid) return false;
  entity.compositeAsteroid = true;
  entity.typeID = presentation.typeID;
  entity.groupID = presentation.groupID;
  entity.categoryID = presentation.categoryID;
  entity.slimTypeID = presentation.typeID;
  entity.slimGroupID = presentation.groupID;
  entity.slimCategoryID = presentation.categoryID;
  entity.visualTypeID = presentation.typeID;
  entity.graphicID = presentation.graphicID;
  entity.slimGraphicID = presentation.graphicID;
  entity.suppressSlimGraphicID = true;
  entity.preserveMiningVisualPresentation = true;
  entity.skipMiningTemplateResolution = true;
  // Converted bodies use a new server-authored recipe and a fixed orientation.
  // Rigid Destiny, CR model rotation and the mining local ray must agree.
  entity.dunRotation = [0, 0, 0];
  entity.collisionQuaternion = { w: 1, x: 0, y: 0, z: 0 };
  delete entity.collisionRotation;
  entity.orientation = { ...entity.collisionQuaternion };
  entity.rotationQuaternion = { ...entity.collisionQuaternion };
  // The client requests recipe identity by the ball itemID. No additional CR
  // keys are supported: setting a legacy shell's typeID never enables this component.
  entity.compositeRecipeID = String(model.recipeID || model.recipe?.recipeID || entity.itemID);
  const radius = Number(model.radius || model.boundingRadius);
  if (Number.isFinite(radius) && radius > 0) {
    entity.radius = radius;
    entity.miningBaseRadius = radius;
  }
  return true;
}

function applyCompositeMinedState(entity, model, minedIndices) {
  if (!entity || !model || !Array.isArray(model.grid) ||
      !(model.spacing > 0) || !Number.isFinite(model.spacing) ||
      !(model.radius > 0) || !Number.isFinite(model.radius)) return false;
  const mined = new Set<number>(minedIndices || []);
  for (const index of mined) {
    if (!Number.isInteger(index) || index < 0 || index >= model.grid.length) return false;
  }
  const key = `${model.recipeHash || model.recipeID || ""}:${model.spacing}:${[...mined].sort((a, b) => a - b).join(",")}`;
  if (entity._compositeCollisionMinedKey === key) return true;
  const half = model.spacing / 2;
  const boxes = [];
  const miniBoxes = [];
  // Merge only complete face-adjacent cubes on the same (y,z) row. Sorting a
  // copy leaves original client grid indices intact. A removed cell splits its
  // run, so this is the exact surviving solid, never a bounding-box substitute.
  const cells = model.grid.filter((cell) => !mined.has(cell.index));
  if (cells.some((cell) => ![cell.x, cell.y, cell.z].every(Number.isFinite))) return false;
  cells.sort((a, b) => a.z - b.z || a.y - b.y || a.x - b.x);
  for (let first = 0; first < cells.length;) {
    const cell = cells[first];
    let last = first;
    while (last + 1 < cells.length &&
           cells[last + 1].y === cell.y && cells[last + 1].z === cell.z &&
           cells[last + 1].x === cells[last].x + 1) last += 1;
    const corner = {
      x: cell.x * model.spacing - half,
      y: cell.y * model.spacing - half,
      z: cell.z * model.spacing - half,
    };
    const edgeX = { x: (last - first + 1) * model.spacing, y: 0, z: 0 };
    const edgeY = { x: 0, y: model.spacing, z: 0 };
    const edgeZ = { x: 0, y: 0, z: model.spacing };
    boxes.push({ corner, edgeX, edgeY, edgeZ });
    miniBoxes.push({ corner, localX: edgeX, localY: edgeY, localZ: edgeZ });
    first = last + 1;
  }
  // Simulation reads collisionProfile, while Destiny's static ball tail reads
  // miniBoxes. Neither may fall back to the legacy shell's sphere or mesh.
  entity.collisionProfile = {
    boundingRadius: model.radius, balls: [], capsules: [], boxes,
    hasPrimitiveGeometry: boxes.length > 0,
  };
  entity.miniBoxes = miniBoxes;
  for (const field of ["miniBalls", "miniballs", "miniboxes", "miniCapsules", "minicapsules",
    "destinyCollisionTail", "destinyCollisionTailSource"]) delete entity[field];
  entity.collisionID = -1;
  entity.convexCollisionID = -1;
  entity.collisionScale = 1;
  entity.collisionRadius = model.radius;
  entity.collisionStatic = true;
  entity.collisionEnabled = boxes.length > 0;
  entity.destinyCollisionEnabled = boxes.length > 0;
  entity.destinyForceMassive = boxes.length > 0;
  entity.nonPhysicalCollision = false;
  entity.nonPhysicalDecloakExempt = false;
  entity._compositeCollisionMinedKey = key;
  entity.compositeCollisionRevision = (entity.compositeCollisionRevision || 0) + 1;
  return true;
}

function refreshCompositeCollision(scene, entity, nowMs) {
  if (!scene || !entity?.compositeAsteroid) return false;
  scene.broadcastAddBalls?.([entity], null, { replaceExisting: true });
  scene.requestFinalSceneVisibilityReconciliation?.();
  return true;
}
function restoreCompositeAsteroid(scene, entity) {
  if (scene?.getEntityByID?.(entity.itemID)) return false;
  if (!scene?.addStaticEntity?.(entity)) return false;
  scene.broadcastAddBalls?.([entity]);
  scene.requestFinalSceneVisibilityReconciliation?.();
  return true;
}

function regolithRadius(type, oreUnits) {
  // RegolithBlock._scale: 200m native cube, authored scale, growth limited to 4.
  const growth = Math.max(1, Math.min(Math.cbrt(oreUnits / 3), 4));
  return Math.sqrt(3) * 100 * type.regolithScale * growth;
}

function buildRegolithEntity(fragment, options: Record<string, any> = {}) {
  const type = (options.resolveType || resolveTargetType)(fragment && fragment.typeID);
  const itemID = positiveInteger(fragment && fragment.itemID);
  const systemID = positiveInteger(fragment && fragment.systemID);
  const oreUnits = positiveInteger(fragment && (fragment.oreUnits ?? fragment.quantity));
  const position = vector(fragment && fragment.position);
  if (!itemID || !systemID || !oreUnits || !position || !type ||
      !type.regolithBlock || !type.scoop || type.scoopAccessPolicy !== "public" ||
      !REGOLITH_GROUP_IDS.includes(type.groupID) || !(["available", "claimed"].includes(fragment.status)) ||
      (fragment.quantity !== undefined && Number(fragment.quantity) !== oreUnits)) return null;
  const radius = regolithRadius(type, oreUnits);
  if (!Number.isFinite(radius) || radius <= 0) return null;
  return {
    ...(fragment.scopeMetadata || {}),
    itemID, systemID, kind: "regolith", typeID: type.typeID,
    groupID: type.groupID, categoryID: type.categoryID,
    slimTypeID: type.typeID, slimGroupID: type.groupID, slimCategoryID: type.categoryID,
    graphicID: type.graphicID, visualTypeID: type.typeID,
    itemName: type.name, slimName: type.name, ownerID: 1,
    oreUnits, quantity: oreUnits, position,
    velocity: { x: 0, y: 0, z: 0 }, direction: { x: 1, y: 0, z: 0 },
    radius, mass: Math.max(1, type.mass * oreUnits),
    destinyForceFree: true, destinyBallMode: "STOP", mode: "STOP",
    collisionEnabled: false, destinyCollisionEnabled: false,
    maxVelocity: 1000, speedFraction: 0, agility: 1, inertia: 1,
    sourceAsteroidID: fragment.asteroidID,
    sourceCellIndices: [...(fragment.sourceCellIndices || [])],
    voxelWorldRevision: fragment.worldRevision,
    scoopRangeMeters: SCOOP_RANGE_METERS,
    staticVisibilityScope: "bubble",
  };
}

function spawnRegolith(scene, fragment, options: Record<string, any> = {}) {
  if (!scene || Number(fragment?.systemID) !== Number(scene.systemID)) return { success: false, errorMsg: "REGOLITH_SYSTEM_MISMATCH" };
  const existing = scene.dynamicEntities?.get(Number(fragment.itemID));
  if (existing) return existing.kind === "regolith"
    ? { success: true, data: { entity: existing }, alreadyPresent: true }
    : { success: false, errorMsg: "REGOLITH_ENTITY_ID_CONFLICT" };
  const entity = buildRegolithEntity(fragment, options);
  if (!entity) return { success: false, errorMsg: "INVALID_REGOLITH_FRAGMENT" };
  return scene.spawnDynamicEntity(entity, { broadcast: options.broadcast !== false });
}

function restoreRegolith(scene, fragments, options: Record<string, any> = {}) {
  const results = (Array.isArray(fragments) ? fragments : []).map((fragment) => spawnRegolith(scene, fragment, options));
  return { success: results.every((result) => result.success), results };
}

function moveRegolith(scene, entity, position, velocity, options: Record<string, any> = {}) {
  const nextPosition = vector(position);
  const nextVelocity = vector(velocity);
  if (!scene || !entity || entity.kind !== "regolith" || !nextPosition || !nextVelocity ||
      scene.dynamicEntities?.get(entity.itemID) !== entity) return false;
  entity.position = nextPosition;
  entity.velocity = nextVelocity;
  entity.speed = Math.hypot(nextVelocity.x, nextVelocity.y, nextVelocity.z);
  scene.reconcileEntityPublicGrid?.(entity);
  scene.reconcileEntityBubble?.(entity);
  if (options.broadcast !== false && typeof scene.broadcastMovementUpdates === "function") {
    const stamp = scene.getMovementStamp(options.nowMs);
    scene.broadcastMovementUpdates([
      { stamp, payload: buildSetBallPositionPayload(entity.itemID, nextPosition) },
      { stamp, payload: buildSetBallVelocityPayload(entity.itemID, nextVelocity) },
    ]);
  }
  return true;
}

function removeRegolith(scene, itemID, options: Record<string, any> = {}) {
  const entity = scene?.dynamicEntities?.get(Number(itemID));
  if (!entity || entity.kind !== "regolith") return false;
  scene.unregisterDynamicEntity(entity, { ...options, persistSpaceState: false });
  return true;
}

module.exports = {
  COMPOSITE_TYPE_ID, SCOOP_RANGE_METERS, REGOLITH_GROUP_IDS,
  resolveTargetType, resolveCompositePresentation, applyCompositePresentation,
  applyCompositeMinedState, refreshCompositeCollision, restoreCompositeAsteroid,
  regolithRadius, buildRegolithEntity, spawnRegolith, restoreRegolith,
  moveRegolith, removeRegolith,
};
