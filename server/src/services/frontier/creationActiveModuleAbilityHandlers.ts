"use strict";

/** Type-scoped Creation ability handlers for active Frontier modules. */

const path = require("path");

const itemStore = require(path.join(__dirname, "../inventory/itemStore"));
const creationRuntime = require(path.join(__dirname, "./creationRuntime"));
const activeRuntime = require(path.join(__dirname, "./creationActiveModuleRuntime"));
const {
  ABILITY_ACTIVATE_EFFECT,
  ABILITY_DEACTIVATE_EFFECT,
  registerCreationTypeAbilityHandler,
} = require(path.join(__dirname, "./creationAbilityRuntime"));

function toInt(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.trunc(numeric) : fallback;
}

function getSpaceRuntime(context) {
  return context.dependencies && context.dependencies.spaceRuntime
    ? context.dependencies.spaceRuntime
    : require(path.join(__dirname, "../../space/runtime"));
}

function getActiveRuntime(context) {
  return context.dependencies && context.dependencies.creationActiveModuleRuntime
    ? context.dependencies.creationActiveModuleRuntime
    : activeRuntime;
}

function getActiveCallbacks(context, spaceRuntime) {
  if (
    context.dependencies &&
    context.dependencies.creationActiveCallbacks
  ) {
    return context.dependencies.creationActiveCallbacks;
  }
  return spaceRuntime &&
    typeof spaceRuntime.getCreationActiveModuleCallbacksForSession === "function"
    ? spaceRuntime.getCreationActiveModuleCallbacksForSession(context.session)
    : {};
}

function findModuleItem(context) {
  const findItemById = context.dependencies &&
    typeof context.dependencies.findItemById === "function"
    ? context.dependencies.findItemById
    : itemStore.findItemById;
  const moduleItem = findItemById(context.moduleItemID);
  if (
    !moduleItem ||
    toInt(moduleItem.locationID, 0) !== toInt(context.creationItem && context.creationItem.itemID, 0)
  ) {
    return null;
  }
  return moduleItem;
}

function resolveInSpaceContext(context) {
  const session = context.session;
  const shipID = toInt(context.creationItem && context.creationItem.itemID, 0);
  if (!session || !session._space || shipID <= 0) {
    return { success: false, errorMsg: "SHIP_NOT_IN_SPACE" };
  }
  // `_space.shipID` is the live piloted object. Session-level ship fields can
  // lag during transitions and must never authorize a remote owned Creation.
  const activeShipID = toInt(session._space.shipID, 0);
  if (activeShipID !== shipID) {
    return { success: false, errorMsg: "CREATION_NOT_ACTIVE_SHIP" };
  }
  const runtime = getSpaceRuntime(context);
  let entity = null;
  try {
    entity = runtime.getEntity(session, shipID);
  } catch (_) {
    entity = null;
  }
  if (!entity || entity.kind !== "ship") {
    return { success: false, errorMsg: "SHIP_NOT_IN_SPACE" };
  }
  const scene = typeof runtime.getSceneForSession === "function"
    ? runtime.getSceneForSession(session)
    : runtime.scene || null;
  if (!scene) {
    return { success: false, errorMsg: "SCENE_NOT_FOUND" };
  }
  return { success: true, data: { runtime, scene, entity, shipID } };
}

function buildActivationOptions(
  context,
  targetID = 0,
  internalOptions: Record<string, any> = {},
) {
  const options: Record<string, any> = { ...internalOptions };
  if (Object.prototype.hasOwnProperty.call(context.kwargs || {}, "repeat")) {
    options.repeat = context.kwargs.repeat;
  }
  if (toInt(targetID, 0) > 0) {
    options.targetID = toInt(targetID, 0);
  }
  return options;
}

function stopEffect(runtime, context, reason) {
  if (!runtime || typeof runtime.deactivateGenericModule !== "function") {
    return { success: false, errorMsg: "DOGMA_EFFECT_RUNTIME_UNAVAILABLE" };
  }
  return runtime.deactivateGenericModule(
    context.session,
    context.moduleItemID,
    { reason, deferUntilCycle: false },
  );
}

function startEffect(
  context,
  moduleItem,
  effectName,
  targetID = 0,
  internalOptions: Record<string, any> = {},
) {
  const space = resolveInSpaceContext(context);
  if (!space.success) {
    return space;
  }
  if (typeof space.data.runtime.activateGenericModule !== "function") {
    return { success: false, errorMsg: "DOGMA_EFFECT_RUNTIME_UNAVAILABLE" };
  }
  const activation = space.data.runtime.activateGenericModule(
    context.session,
    moduleItem,
    effectName,
    buildActivationOptions(context, targetID, internalOptions),
  );
  if (!activation || activation.success !== true) {
    return activation || { success: false, errorMsg: "DOGMA_EFFECT_START_FAILED" };
  }
  const effectState = activation.data && activation.data.effectState;
  if (!effectState) {
    stopEffect(space.data.runtime, context, "creation-effect-state-missing");
    return { success: false, errorMsg: "DOGMA_EFFECT_STATE_MISSING" };
  }
  return {
    success: true,
    data: { ...space.data, activation, effectState },
  };
}

function requireOnlineModule(context) {
  const persistedModuleItem = findModuleItem(context);
  if (!persistedModuleItem) {
    return { success: false, errorMsg: "MODULE_NOT_FOUND" };
  }
  if (context.creationState && context.creationState.poweredOff === true) {
    return { success: false, errorMsg: "CREATION_POWERED_OFF" };
  }
  const dogmaContext = resolveCreationDogmaContext(context);
  const moduleItem = dogmaContext && Array.isArray(dogmaContext.moduleItems)
    ? dogmaContext.moduleItems.find(
      (entry) => toInt(entry && entry.itemID, 0) === toInt(context.moduleItemID, 0),
    ) || null
    : null;
  // The effective Dogma context folds the Creation-wide poweredOff state into
  // each module. Raw persisted moduleState.online alone is insufficient.
  if (!moduleItem || moduleItem.moduleState?.online !== true) {
    return { success: false, errorMsg: "MODULE_OFFLINE" };
  }
  return { success: true, data: { moduleItem, dogmaContext } };
}

function resolveCreationDogmaContext(context) {
  const getCreationDogmaContext = context.dependencies &&
    typeof context.dependencies.getCreationDogmaContext === "function"
    ? context.dependencies.getCreationDogmaContext
    : creationRuntime.getCreationDogmaContext;
  const result = getCreationDogmaContext(
    context.creationItem,
    toInt(context.characterID, 0),
  );
  return result && result.success === true ? result.data : null;
}

function refreshDerived(runtime, context) {
  if (runtime && typeof runtime.refreshShipDerivedState === "function") {
    return runtime.refreshShipDerivedState(context.session, {
      broadcast: true,
      notifyTargeting: true,
    });
  }
  return null;
}

function getTargetID(context) {
  return toInt(
    context.kwargs && (context.kwargs.target_id ?? context.kwargs.targetID),
    0,
  );
}

function validateTargetBeforeActivation(context, moduleItem, space, kind) {
  const runtime = getActiveRuntime(context);
  const attributes = runtime.captureCreationModuleAttributes(moduleItem);
  return runtime.validateCreationTarget({
    scene: space.scene,
    entity: space.entity,
    targetID: getTargetID(context),
    maxRange: attributes[54],
    requireLock: true,
    requireShip: true,
    options: context.dependencies || {},
    kind,
  });
}

function activateHullRepairer(context) {
  const moduleResult = requireOnlineModule(context);
  if (!moduleResult.success) return moduleResult;
  const started = startEffect(
    context,
    moduleResult.data.moduleItem,
    activeRuntime.EFFECT_HULL_REPAIRER,
  );
  if (!started.success) return started;
  // structureRepair is deliberately not marked as a custom effect. The shared
  // local-cycle runtime owns cap use, end-of-cycle repair, persistence and HUD.
  return {
    success: true,
    data: { durationMs: started.data.effectState.durationMs },
  };
}

function activatePropulsion(context, kind, effectName) {
  const moduleResult = requireOnlineModule(context);
  if (!moduleResult.success) return moduleResult;
  const runtime = getActiveRuntime(context);
  const space = resolveInSpaceContext(context);
  if (!space.success) return space;
  const effectStatePatch = runtime.buildCreationActiveEffectPatch(
    kind,
    moduleResult.data.moduleItem,
  );
  effectStatePatch.durationMs = Math.max(
    1,
    Number(effectStatePatch.creationModuleAttributes?.[73]) || 1000,
  );
  const creationDogmaContext = moduleResult.data.dogmaContext;
  const fuelPreflight = runtime.preflightCreationPropulsionCycleFuel({
    entity: space.data.entity,
    effectState: effectStatePatch,
    moduleItem: moduleResult.data.moduleItem,
    creationDogmaContext,
    dependencies: context.dependencies || {},
  });
  if (!fuelPreflight.success) return fuelPreflight;
  const started = startEffect(
    context,
    moduleResult.data.moduleItem,
    effectName,
    0,
    { creationEffectStatePatch: effectStatePatch },
  );
  if (!started.success) return started;
  runtime.markCreationActiveEffect(started.data.effectState, kind, moduleResult.data.moduleItem);
  const fuelResult = runtime.consumeCreationPropulsionCycleFuel({
    entity: started.data.entity,
    effectState: started.data.effectState,
    moduleItem: moduleResult.data.moduleItem,
    creationDogmaContext,
    session: context.session,
    nowMs: started.data.effectState.startedAtMs,
    callbacks: getActiveCallbacks(context, started.data.runtime),
    dependencies: context.dependencies || {},
  });
  if (!fuelResult || fuelResult.success !== true) {
    stopEffect(started.data.runtime, context, "fuel");
    return fuelResult || { success: false, errorMsg: "NO_FUEL" };
  }
  started.data.effectState.creationActiveFuelPrepaid = true;
  // A fuel-type boundary refreshes through the mutation callback.  Otherwise
  // this initial refresh applies the just-started active thrust exactly once.
  if (!(fuelResult.data && fuelResult.data.derivedStateRefreshed === true)) {
    refreshDerived(started.data.runtime, context);
  }
  return {
    success: true,
    data: {
      durationMs: started.data.effectState.durationMs,
      consumedFuel: fuelResult.data && fuelResult.data.consumedFuel,
      thrustState: fuelPreflight.data && fuelPreflight.data.activeState,
    },
  };
}

function activateTargetModule(context, kind, effectName) {
  const moduleResult = requireOnlineModule(context);
  if (!moduleResult.success) return moduleResult;
  const space = resolveInSpaceContext(context);
  if (!space.success) return space;
  const targetValidation = validateTargetBeforeActivation(
    context,
    moduleResult.data.moduleItem,
    space.data,
    kind,
  );
  if (!targetValidation.success) return targetValidation;
  const targetID = getTargetID(context);
  const runtime = getActiveRuntime(context);
  const effectStatePatch = runtime.buildCreationActiveEffectPatch(
    kind,
    moduleResult.data.moduleItem,
    { targetID },
  );
  const cyclePreflight = runtime.preflightCreationActiveModuleCycle({
    scene: space.data.scene,
    session: context.session,
    entity: space.data.entity,
    moduleItem: moduleResult.data.moduleItem,
    effectState: effectStatePatch,
    dependencies: context.dependencies || {},
  });
  if (!cyclePreflight.success) return cyclePreflight;
  const callbacks = getActiveCallbacks(context, space.data.runtime);
  const beforeCommit = kind === activeRuntime.ACTIVE_KIND_APPROACH
    ? () => runtime.issueApproachFollow({
      scene: space.data.scene,
      session: context.session,
      entity: space.data.entity,
      targetID,
      effectState: effectStatePatch,
      callbacks,
    })
    : null;
  const started = startEffect(
    context,
    moduleResult.data.moduleItem,
    effectName,
    targetID,
    {
      creationEffectStatePatch: effectStatePatch,
      ...(beforeCommit ? { beforeCommit } : {}),
    },
  );
  if (!started.success) return started;
  runtime.markCreationActiveEffect(
    started.data.effectState,
    kind,
    moduleResult.data.moduleItem,
    { targetID },
  );

  return {
    success: true,
    data: { durationMs: started.data.effectState.durationMs, targetID },
  };
}

function deactivateModule(context, options: Record<string, any> = {}) {
  const runtime = getSpaceRuntime(context);
  return stopEffect(runtime, context, options.reason || "manual");
}

const HANDLERS = Object.freeze({
  [activeRuntime.TYPE_HULL_REPAIRER]: Object.freeze({
    activate: { execute: activateHullRepairer },
    deactivate: { execute: (context) => deactivateModule(context) },
  }),
  [activeRuntime.TYPE_LEAP]: Object.freeze({
    activate: {
      execute: (context) => activatePropulsion(
        context,
        activeRuntime.ACTIVE_KIND_LEAP,
        activeRuntime.EFFECT_LEAP,
      ),
    },
    deactivate: {
      execute: (context) => deactivateModule(context),
    },
  }),
  [activeRuntime.TYPE_TRANSFUSER]: Object.freeze({
    activate: {
      execute: (context) => activateTargetModule(
        context,
        activeRuntime.ACTIVE_KIND_TRANSFUSER,
        activeRuntime.EFFECT_TRANSFUSER,
      ),
    },
    deactivate: { execute: (context) => deactivateModule(context) },
  }),
  [activeRuntime.TYPE_THRUST_OVERDRIVE]: Object.freeze({
    activate: {
      execute: (context) => activatePropulsion(
        context,
        activeRuntime.ACTIVE_KIND_THRUST_OVERDRIVE,
        activeRuntime.EFFECT_THRUST_OVERDRIVE,
      ),
    },
    deactivate: {
      execute: (context) => deactivateModule(context),
    },
  }),
  [activeRuntime.TYPE_APPROACH_COMPUTER]: Object.freeze({
    activate: {
      execute: (context) => activateTargetModule(
        context,
        activeRuntime.ACTIVE_KIND_APPROACH,
        activeRuntime.EFFECT_APPROACH_COMPUTER,
      ),
    },
    deactivate: {
      execute: (context) => deactivateModule(context),
    },
  }),
});

function registerCreationActiveModuleAbilityHandlers() {
  for (const [rawTypeID, handlers] of Object.entries(HANDLERS)) {
    const typeID = toInt(rawTypeID, 0);
    registerCreationTypeAbilityHandler(
      typeID,
      ABILITY_ACTIVATE_EFFECT,
      handlers.activate,
    );
    registerCreationTypeAbilityHandler(
      typeID,
      ABILITY_DEACTIVATE_EFFECT,
      handlers.deactivate,
    );
  }
}

module.exports = {
  CREATION_ACTIVE_MODULE_ABILITY_HANDLERS: HANDLERS,
  activateHullRepairer,
  activatePropulsion,
  activateTargetModule,
  deactivateModule,
  registerCreationActiveModuleAbilityHandlers,
  resolveInSpaceContext,
};
