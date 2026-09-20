"use strict";

/**
 * Behavior-aware Creation module ability registry and dispatch.
 *
 * Client contract (build 3502403 Python 3.12 bytecode):
 * - `creation.activate_ability(creation_id, module_item_id, str(ability_id),
 *   **params)` — ability parameters arrive as keyword arguments.
 * - AbilityId values are strings ("online", "offline", "activate_effect",
 *   "deactivate_effect", "directional_scan", "iff_reconfigure", ...). The
 *   client gates its calls on the per-module `abilities` list served in
 *   get_creation, and `ModuleActionProvider._require_ability` rejects
 *   anything not advertised.
 * - Successful abilities return a dict; the client reads `server_time` and,
 *   for directional scans, `scan_response`.
 *
 * Handlers register per (behavior, ability) or (typeID, ability).
 * Type-specific registration is required for active modules authored with
 * the shared `generic` behavior: advertising activate_effect for the whole
 * behavior would otherwise put a broken activation button on every passive
 * Creation module and every skill-shot weapon. Advertisement derives from
 * these registries, so the server never advertises an ability it cannot
 * execute. online/offline remain driven by Dogma online effect 16 and use the
 * shared fallback handlers.
 */

const path = require("path");

const log = require(path.join(__dirname, "../../utils/logger"));
const { getCreationModule } = require(path.join(__dirname, "./creationStaticData"));

const ABILITY_ONLINE = "online";
const ABILITY_OFFLINE = "offline";
const ABILITY_ACTIVATE_EFFECT = "activate_effect";
const ABILITY_DEACTIVATE_EFFECT = "deactivate_effect";
const ABILITY_DIRECTIONAL_SCAN = "directional_scan";
const ABILITY_IFF_RECONFIGURE = "iff_reconfigure";
const ABILITY_DEPLOY = "deploy";
const ABILITY_RELOAD = "reload";
const ABILITY_UNLOAD = "unload";
const ABILITY_INDUSTRY_LOAD_BLUEPRINT = "industry_load_blueprint";
const ABILITY_INDUSTRY_START_PRODUCTION = "industry_start_production";
const ABILITY_INDUSTRY_DISCONTINUE_PRODUCTION = "industry_discontinue_production";
const ABILITY_INDUSTRY_DEPOSIT_INPUT = "industry_deposit_input";
const ABILITY_INDUSTRY_WITHDRAW_INPUT = "industry_withdraw_input";
const ABILITY_INDUSTRY_WITHDRAW_OUTPUT = "industry_withdraw_output";
const ABILITY_INDUSTRY_WITHDRAW_TO_JETTISON_INPUT =
  "industry_withdraw_to_jettison_input";
const ABILITY_INDUSTRY_WITHDRAW_TO_JETTISON_OUTPUT =
  "industry_withdraw_to_jettison_output";

// (behaviorName -> Map(abilityId -> handler)). Fallback handlers (online/
// offline) live under the "*" behavior key and apply to every module whose
// type carries the Dogma online effect.
const handlersByBehavior = new Map();
// (typeID -> Map(abilityId -> handler)). A type handler takes precedence over
// behavior and fallback handlers for the same ability.
const handlersByType = new Map();

function toInt(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.trunc(numeric) : fallback;
}

function getModuleBehaviorName(typeID) {
  const module = getCreationModule(typeID);
  const behavior = module && typeof module.behavior === "string"
    ? module.behavior.trim()
    : "";
  return behavior || "generic";
}

function normalizeAbilityId(value) {
  return String(value || "").trim().toLowerCase();
}

function isPromiseLike(value) {
  return Boolean(value && typeof value.then === "function");
}

function creationAbilityExecutionFailure(error, behaviorName, ability, moduleItemID) {
  log.warn(
    `[creationAbility] ${behaviorName}:${ability} handler failed ` +
    `module=${moduleItemID}: ${error && error.message ? error.message : error}`,
  );
  if (error && error.isClientVisible === true) {
    throw error;
  }
  return { success: false as const, errorMsg: "ABILITY_EXECUTION_FAILED" };
}

function registerCreationAbilityHandler(behaviorName, abilityId, handler) {
  const behaviorKey = String(behaviorName || "").trim() || "*";
  const normalizedAbility = normalizeAbilityId(abilityId);
  if (!normalizedAbility || !handler || typeof handler.execute !== "function") {
    throw new Error(
      `Invalid creation ability handler registration ${behaviorKey}:${normalizedAbility}`,
    );
  }
  if (!handlersByBehavior.has(behaviorKey)) {
    handlersByBehavior.set(behaviorKey, new Map());
  }
  handlersByBehavior.get(behaviorKey).set(normalizedAbility, handler);
}

function registerCreationTypeAbilityHandler(typeID, abilityId, handler) {
  const numericTypeID = toInt(typeID, 0);
  const normalizedAbility = normalizeAbilityId(abilityId);
  if (
    numericTypeID <= 0 ||
    !normalizedAbility ||
    !handler ||
    typeof handler.execute !== "function"
  ) {
    throw new Error(
      `Invalid creation type ability handler registration ${numericTypeID}:${normalizedAbility}`,
    );
  }
  if (!handlersByType.has(numericTypeID)) {
    handlersByType.set(numericTypeID, new Map());
  }
  handlersByType.get(numericTypeID).set(normalizedAbility, handler);
}

function getRegisteredBehaviorAbilities(behaviorName) {
  const handlers = handlersByBehavior.get(String(behaviorName || "").trim());
  return handlers ? [...handlers.keys()] : [];
}

function getRegisteredTypeAbilities(typeID) {
  const handlers = handlersByType.get(toInt(typeID, 0));
  return handlers ? [...handlers.keys()] : [];
}

function resolveCreationAbilityHandler(behaviorName, abilityId, typeID = 0) {
  const normalizedAbility = normalizeAbilityId(abilityId);
  const typeHandlers = handlersByType.get(toInt(typeID, 0));
  if (typeHandlers && typeHandlers.has(normalizedAbility)) {
    return typeHandlers.get(normalizedAbility);
  }
  const behaviorHandlers = handlersByBehavior.get(
    String(behaviorName || "").trim(),
  );
  if (behaviorHandlers && behaviorHandlers.has(normalizedAbility)) {
    return behaviorHandlers.get(normalizedAbility);
  }
  const fallbackHandlers = handlersByBehavior.get("*");
  return fallbackHandlers ? fallbackHandlers.get(normalizedAbility) || null : null;
}

/**
 * Dispatch a validated ability invocation. The caller (creationService) has
 * already resolved the owned Creation; this validates the module membership,
 * advertised-ability agreement, ability arguments, and executes the handler.
 *
 * Returns { success, data? , errorMsg?, params? }.
 */
function dispatchCreationAbility({
  ability,
  kwargs,
  session,
  creationContext,
  moduleItemID,
  abilityDependencies,
}: Record<string, any>) {
  const normalizedAbility = normalizeAbilityId(ability);
  if (!normalizedAbility) {
    return { success: false as const, errorMsg: "ABILITY_EMPTY" };
  }
  const state = creationContext && creationContext.state;
  const moduleEntry = state && Array.isArray(state.modules)
    ? state.modules.find((entry) => toInt(entry && entry.itemID, 0) === toInt(moduleItemID, 0))
    : null;
  if (!moduleEntry) {
    return { success: false as const, errorMsg: "MODULE_NOT_IN_CREATION" };
  }
  const advertisedAbilities = Array.isArray(moduleEntry.abilities)
    ? moduleEntry.abilities
    : [];
  if (!advertisedAbilities.includes(normalizedAbility)) {
    return {
      success: false as const,
      errorMsg: "ABILITY_NOT_ADVERTISED",
      params: { advertised: advertisedAbilities },
    };
  }

  const behaviorName = getModuleBehaviorName(moduleEntry.typeID);
  const handler = resolveCreationAbilityHandler(
    behaviorName,
    normalizedAbility,
    moduleEntry.typeID,
  );
  if (!handler) {
    // Advertisement derives from the registry, so this indicates a race or a
    // stale snapshot rather than a normal client request.
    return { success: false as const, errorMsg: "ABILITY_HANDLER_MISSING" };
  }

  const context = {
    ability: normalizedAbility,
    behaviorName,
    creationItem: creationContext.item,
    creationState: creationContext.state,
    creationTemplate: creationContext.template || null,
    characterID: creationContext.characterID,
    moduleEntry,
    moduleItemID: toInt(moduleItemID, 0),
    kwargs: kwargs && typeof kwargs === "object" ? kwargs : {},
    session: session || null,
    dependencies: abilityDependencies || {},
  };

  const execute = () => {
    try {
      const result = handler.execute(context);
      return isPromiseLike(result)
        ? Promise.resolve(result).catch(error => creationAbilityExecutionFailure(
          error,
          behaviorName,
          normalizedAbility,
          context.moduleItemID,
        ))
        : result;
    } catch (error) {
      return creationAbilityExecutionFailure(
        error,
        behaviorName,
        normalizedAbility,
        context.moduleItemID,
      );
    }
  };

  if (typeof handler.validate !== "function") {
    return execute();
  }

  try {
    const validation = handler.validate(context);
    if (isPromiseLike(validation)) {
      return Promise.resolve(validation).then(
        current => current && current.success === false ? current : execute(),
        error => creationAbilityExecutionFailure(
          error,
          behaviorName,
          normalizedAbility,
          context.moduleItemID,
        ),
      );
    }
    return validation && validation.success === false ? validation : execute();
  } catch (error) {
    return creationAbilityExecutionFailure(
      error,
      behaviorName,
      normalizedAbility,
      context.moduleItemID,
    );
  }
}

function resetCreationAbilityHandlersForTests() {
  handlersByBehavior.clear();
  handlersByType.clear();
}

module.exports = {
  ABILITY_ACTIVATE_EFFECT,
  ABILITY_DEACTIVATE_EFFECT,
  ABILITY_DEPLOY,
  ABILITY_DIRECTIONAL_SCAN,
  ABILITY_IFF_RECONFIGURE,
  ABILITY_INDUSTRY_DEPOSIT_INPUT,
  ABILITY_INDUSTRY_DISCONTINUE_PRODUCTION,
  ABILITY_INDUSTRY_LOAD_BLUEPRINT,
  ABILITY_INDUSTRY_START_PRODUCTION,
  ABILITY_INDUSTRY_WITHDRAW_INPUT,
  ABILITY_INDUSTRY_WITHDRAW_OUTPUT,
  ABILITY_INDUSTRY_WITHDRAW_TO_JETTISON_INPUT,
  ABILITY_INDUSTRY_WITHDRAW_TO_JETTISON_OUTPUT,
  ABILITY_OFFLINE,
  ABILITY_ONLINE,
  ABILITY_RELOAD,
  ABILITY_UNLOAD,
  dispatchCreationAbility,
  getModuleBehaviorName,
  getRegisteredBehaviorAbilities,
  getRegisteredTypeAbilities,
  normalizeAbilityId,
  registerCreationAbilityHandler,
  registerCreationTypeAbilityHandler,
  resolveCreationAbilityHandler,
  resetCreationAbilityHandlersForTests,
};
