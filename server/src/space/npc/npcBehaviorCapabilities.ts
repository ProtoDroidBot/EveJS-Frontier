const path = require("path");

const {
  getControllerByEntityID,
} = require(path.join(__dirname, "./npcRegistry"));

function hasOwnField(value, fieldName) {
  return Boolean(
    value &&
    typeof value === "object" &&
    Object.prototype.hasOwnProperty.call(value, fieldName)
  );
}

function resolveNpcBehaviorField(entity, fieldName) {
  if (!entity || entity.nativeNpc !== true) {
    return undefined;
  }

  const controller = getControllerByEntityID(entity.itemID);
  if (controller && hasOwnField(controller.behaviorOverrides, fieldName)) {
    return controller.behaviorOverrides[fieldName];
  }
  if (controller && hasOwnField(controller.behaviorProfile, fieldName)) {
    return controller.behaviorProfile[fieldName];
  }
  if (hasOwnField(entity.npcBehaviorProfile, fieldName)) {
    return entity.npcBehaviorProfile[fieldName];
  }
  return undefined;
}

function npcRetainsOccludedTargetLocks(entity) {
  return resolveNpcBehaviorField(
    entity,
    "retainTargetLockWhenOccluded",
  ) === true;
}

function npcCanFireThroughOccluders(entity) {
  return resolveNpcBehaviorField(entity, "fireThroughOccluders") === true;
}

module.exports = {
  resolveNpcBehaviorField,
  npcRetainsOccludedTargetLocks,
  npcCanFireThroughOccluders,
};
