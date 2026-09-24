"use strict";

/**
 * IFF Creation ability handlers.
 *
 * - behavior "iff" + "activate_effect"/"deactivate_effect": starts the
 *   Transponder broadcast or stops it after the current cycle. Activation
 *   carries the locally saved iff_channel/iff_code settings; deactivation
 *   preserves those settings.
 * - behavior "iff" + ability "iff_reconfigure": validates iff_channel /
 *   iff_code kwargs and updates the selected mode without changing whether
 *   the Transponder is broadcasting.
 * - behavior "iff_beacon" + "activate_effect"/"deactivate_effect": starts the
 *   Transponder Beacon or stops it after the current cycle. Activation
 *   requires an undocked, in-space ship; the ship is held stationary through
 *   the established activeModuleEffects immobilizer authority for the authored
 *   Dogma duration (30 s for type 96039) and released on expiry, deactivation, or
 *   any scene teardown.
 *
 * After every effective state change the same-system sessions receive
 * OnIffMapChanged (clients then refetch beacons/cairns) and refreshed
 * OnIffVerdicts.
 */

const path = require("path");

const log = require(path.join(__dirname, "../../utils/logger"));
const iffRuntime = require(path.join(__dirname, "./iffRuntime"));
const {
  ABILITY_ACTIVATE_EFFECT,
  ABILITY_DEACTIVATE_EFFECT,
  ABILITY_IFF_RECONFIGURE,
  registerCreationAbilityHandler,
} = require(path.join(__dirname, "./creationAbilityRuntime"));
const {
  isCreationModuleOnline,
  readCreationState,
  subscribeCreationStateChanges,
} = require(path.join(__dirname, "./creationRuntime"));
const { findItemById } = require(path.join(__dirname, "../inventory/itemStore"));

let registered = false;
const scheduledVerdictSystemIDs = new Set();

const IFF_BROADCAST_EFFECT_NAME = "iffBroadcast";
const IFF_BEACON_EFFECT_NAME = "iffBeacon";

function toInt(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.trunc(numeric) : fallback;
}

function getSpaceRuntime() {
  return require(path.join(__dirname, "../../space/runtime"));
}

function getSessionRegistry() {
  return require(path.join(__dirname, "../chat/sessionRegistry"));
}

function resolveSessionSolarSystemID(session) {
  return toInt(
    session && (session.solarsystemid2 || session.solarsystemid || session.locationid),
    0,
  );
}

/**
 * Push OnIffMapChanged (and refreshed verdicts) to every live session in the
 * solar system. The client reacts by invalidating its cairn/beacon caches
 * and refetching, so this notification—not the RPC return value—is what
 * makes changes appear without a UI reopen.
 */
function notifyIffMapChanged(solarSystemID, reason = "changed") {
  const numericSystemID = toInt(solarSystemID, 0);
  if (numericSystemID <= 0) {
    return 0;
  }
  let notified = 0;
  const sessionRegistry = getSessionRegistry();
  const sessions = typeof sessionRegistry.getSessions === "function"
    ? sessionRegistry.getSessions()
    : [];
  for (const session of sessions) {
    if (
      !session ||
      typeof session.sendNotification !== "function" ||
      resolveSessionSolarSystemID(session) !== numericSystemID
    ) {
      continue;
    }
    try {
      session.sendNotification("OnIffMapChanged", "clientID", []);
      notified += 1;
    } catch (error) {
      log.warn(
        `[iff] OnIffMapChanged notify failed char=${session.charid || "?"}: ` +
        `${error && error.message ? error.message : error}`,
      );
    }
  }
  log.debug(`[iff] OnIffMapChanged system=${numericSystemID} sessions=${notified} reason=${reason}`);
  return notified;
}

/**
 * Build-3502403 consumes dict[int, bool] and explicitly maps true to
 * HudColor.IFF_FRIENDLY and false to HudColor.IFF_UNFRIENDLY. Preserve an
 * absent row for ships that do not broadcast at all, while every broadcasting
 * peer receives the mutual-match verdict.
 */
function buildVerdictsForViewer(viewer, shipsInSystem) {
  const verdicts: any[] = [];
  for (const other of shipsInSystem) {
    if (toInt(other.shipID, 0) === toInt(viewer.shipID, 0)) {
      continue;
    }
    if (!other.transponder || !viewer.transponder) {
      continue;
    }
    const friendly = iffRuntime.transpondersMatch(
      viewer.transponder,
      other.transponder,
      viewer,
      other,
    );
    verdicts.push([toInt(other.shipID, 0), friendly]);
  }
  return verdicts;
}

function buildNpcTransponderShipsForSystem(solarSystemID, options: Record<string, any> = {}) {
  const numericSystemID = toInt(solarSystemID, 0);
  if (numericSystemID <= 0) {
    return [];
  }
  const runtime = options.spaceRuntime || getSpaceRuntime();
  const scene = options.scene || (
    runtime && runtime.scenes instanceof Map
      ? runtime.scenes.get(numericSystemID) || null
      : null
  );
  if (!scene) {
    return [];
  }
  const entities = typeof scene.getDynamicEntities === "function"
    ? scene.getDynamicEntities()
    : scene.dynamicEntities instanceof Map
      ? [...scene.dynamicEntities.values()]
      : [];
  const ships: any[] = [];
  for (const entity of entities) {
    if (
      !entity ||
      entity.kind !== "ship" ||
      (entity.nativeNpc !== true && entity.nativeNpcOccupied !== true)
    ) {
      continue;
    }
    const shipID = toInt(entity.itemID || entity.entityID, 0);
    const transponder = iffRuntime.resolveNpcTransponder(entity);
    if (shipID <= 0 || !transponder) {
      continue;
    }
    ships.push({
      shipID,
      characterID: 0,
      corporationID: toInt(entity.corporationID || entity.ownerID, 0),
      transponder,
      nativeNpc: true,
    });
  }
  return ships;
}

function notifyIffVerdicts(solarSystemID) {
  const numericSystemID = toInt(solarSystemID, 0);
  if (numericSystemID <= 0) {
    return 0;
  }
  const sessionRegistry = getSessionRegistry();
  const sessions = (typeof sessionRegistry.getSessions === "function"
    ? sessionRegistry.getSessions()
    : []
  ).filter((session) =>
    session &&
    typeof session.sendNotification === "function" &&
    resolveSessionSolarSystemID(session) === numericSystemID);

  const playerShips = sessions.map((session) => {
    const shipID = toInt(session.activeShipID || session.shipid || session.shipID, 0);
    const characterID = toInt(session.charid || session.characterID, 0);
    return {
      shipID,
      characterID,
      corporationID: toInt(session.corpid, 0),
      transponder: shipID > 0
        ? iffRuntime.resolveActiveTransponder(characterID, shipID)
        : null,
    };
  });
  const playerShipIDs = new Set(
    playerShips.map((ship) => toInt(ship.shipID, 0)).filter((shipID) => shipID > 0),
  );
  const npcShips = buildNpcTransponderShipsForSystem(numericSystemID)
    .filter((ship) => !playerShipIDs.has(toInt(ship.shipID, 0)));
  const ships = [...playerShips, ...npcShips];

  let notified = 0;
  for (let index = 0; index < sessions.length; index += 1) {
    const session = sessions[index];
    const verdicts = buildVerdictsForViewer(playerShips[index], ships);
    try {
      session.sendNotification("OnIffVerdicts", "clientID", [{
        type: "dict",
        entries: verdicts,
      }]);
      notified += 1;
    } catch (error) {
      log.warn(
        `[iff] OnIffVerdicts notify failed char=${session.charid || "?"}: ` +
        `${error && error.message ? error.message : error}`,
      );
    }
  }
  return notified;
}

function scheduleIffVerdicts(solarSystemID) {
  const numericSystemID = toInt(solarSystemID, 0);
  if (numericSystemID <= 0) {
    return false;
  }
  if (scheduledVerdictSystemIDs.has(numericSystemID)) {
    return true;
  }
  scheduledVerdictSystemIDs.add(numericSystemID);
  setImmediate(() => {
    scheduledVerdictSystemIDs.delete(numericSystemID);
    try {
      notifyIffVerdicts(numericSystemID);
    } catch (error) {
      log.warn(
        `[iff] scheduled verdict refresh failed system=${numericSystemID}: ` +
        `${error && error.message ? error.message : error}`,
      );
    }
  });
  return true;
}

function notifyIffStateChanged(solarSystemID, reason) {
  notifyIffMapChanged(solarSystemID, reason);
  notifyIffVerdicts(solarSystemID);
}

function scheduleIffStateChanged(solarSystemID, reason) {
  const numericSystemID = toInt(solarSystemID, 0);
  if (numericSystemID <= 0) {
    return false;
  }
  setImmediate(() => notifyIffStateChanged(numericSystemID, reason));
  return true;
}

function resolveInSpaceContext(context) {
  const session = context.session;
  const solarSystemID = resolveSessionSolarSystemID(session);
  const shipID = toInt(context.creationItem && context.creationItem.itemID, 0);
  if (solarSystemID <= 0 || !session || !session._space) {
    return { errorMsg: "SHIP_NOT_IN_SPACE" };
  }
  const runtime = context.dependencies && context.dependencies.spaceRuntime
    ? context.dependencies.spaceRuntime
    : getSpaceRuntime();
  let entity = null;
  try {
    entity = runtime.getEntity(session, shipID);
  } catch (_) {
    entity = null;
  }
  if (!entity || entity.kind !== "ship") {
    return { errorMsg: "SHIP_NOT_IN_SPACE" };
  }
  return { solarSystemID, shipID, entity, runtime };
}

function startIffDogmaEffect(context, moduleItem, effectName, options: Record<string, any> = {}) {
  const spaceContext = resolveInSpaceContext(context);
  if (spaceContext.errorMsg) {
    return { success: false as const, errorMsg: spaceContext.errorMsg };
  }
  if (typeof spaceContext.runtime.activateGenericModule !== "function") {
    return { success: false as const, errorMsg: "DOGMA_EFFECT_RUNTIME_UNAVAILABLE" };
  }

  const activationOptions: Record<string, any> = {};
  if (Object.prototype.hasOwnProperty.call(options, "repeat")) {
    activationOptions.repeat = options.repeat;
  }
  const activation = spaceContext.runtime.activateGenericModule(
    context.session,
    moduleItem,
    effectName,
    activationOptions,
  );
  if (!activation || activation.success !== true) {
    return activation || { success: false as const, errorMsg: "DOGMA_EFFECT_START_FAILED" };
  }

  const effectState = activation.data && activation.data.effectState
    ? activation.data.effectState
    : null;
  if (!effectState || toInt(effectState.effectID, 0) <= 0) {
    if (typeof spaceContext.runtime.deactivateGenericModule === "function") {
      spaceContext.runtime.deactivateGenericModule(
        context.session,
        context.moduleItemID,
        { reason: "iff-invalid-effect", deferUntilCycle: false },
      );
    }
    return { success: false as const, errorMsg: "DOGMA_EFFECT_STATE_MISSING" };
  }

  effectState.iffCreationEffect = true;
  if (options.immobilizesShip === true) {
    effectState.immobilizesShip = true;
    effectState.iffBeaconEffect = true;
    if (typeof spaceContext.runtime.stopShipEntity === "function") {
      spaceContext.runtime.stopShipEntity(spaceContext.entity, {
        reason: IFF_BEACON_EFFECT_NAME,
      });
    }
  }

  return {
    success: true as const,
    data: {
      activation,
      effectState,
      spaceContext,
    },
  };
}

function stopIffDogmaEffect(context, reason = "iff-deactivated", deferUntilCycle = false) {
  const runtime = context.dependencies && context.dependencies.spaceRuntime
    ? context.dependencies.spaceRuntime
    : getSpaceRuntime();
  if (!runtime || typeof runtime.deactivateGenericModule !== "function") {
    return { success: false as const, errorMsg: "DOGMA_EFFECT_RUNTIME_UNAVAILABLE" };
  }
  const result = runtime.deactivateGenericModule(
    context.session,
    context.moduleItemID,
    { reason, deferUntilCycle },
  );
  if (
    result &&
    result.success !== true &&
    ["MODULE_NOT_ACTIVE", "NOT_IN_SPACE"].includes(result.errorMsg)
  ) {
    return { success: true as const, data: { alreadyStopped: true } };
  }
  return result || { success: false as const, errorMsg: "DOGMA_EFFECT_STOP_FAILED" };
}

function handleIffBroadcastEffectStopped(effectState, solarSystemID = 0) {
  if (
    !effectState ||
    effectState.iffCreationEffect !== true ||
    effectState.effectName !== IFF_BROADCAST_EFFECT_NAME
  ) {
    return false;
  }
  const reason = String(effectState.stopReason || "");
  // A power interruption suspends the saved activation intent. A manual stop
  // requested before that interruption still has to complete the deactivation.
  if (
    effectState.iffManualDeactivationPending !== true &&
    (reason === "offline" || reason.startsWith("iff-"))
  ) {
    return false;
  }
  const result = iffRuntime.setTransponderBroadcastState(effectState.moduleID, false);
  if (!result || result.success !== true) {
    log.warn(
      `[iff] failed to persist stopped transponder module=${effectState.moduleID} ` +
      `reason=${(result && result.errorMsg) || "IFF_WRITE_FAILED"}`,
    );
    return false;
  }
  scheduleIffStateChanged(solarSystemID, "transponder-deactivated");
  return true;
}

function handleIffBeaconEffectStopped(effectState) {
  if (
    !effectState ||
    effectState.iffBeaconEffect !== true ||
    effectState.effectName !== IFF_BEACON_EFFECT_NAME
  ) {
    return false;
  }
  const reason = String(effectState.stopReason || "");
  if (
    effectState.iffManualDeactivationPending !== true &&
    (reason === "offline" || reason.startsWith("iff-"))
  ) {
    return false;
  }
  const result = iffRuntime.stopBeacon(effectState.moduleID, reason || "cycle");
  return Boolean(result && result.success === true);
}

function isIffEffectActive(context) {
  const runtime = context.dependencies && context.dependencies.spaceRuntime
    ? context.dependencies.spaceRuntime
    : getSpaceRuntime();
  if (!runtime || typeof runtime.getEntity !== "function") {
    return false;
  }
  try {
    const entity = runtime.getEntity(
      context.session,
      toInt(context.creationItem && context.creationItem.itemID, 0),
    );
    return Boolean(
      entity &&
      entity.activeModuleEffects instanceof Map &&
      entity.activeModuleEffects.has(toInt(context.moduleItemID, 0)),
    );
  } catch (_) {
    return false;
  }
}

/**
 * Keep the persisted transponder's desired broadcast state distinct from its
 * effective power state. Offlining/powering down stops the Dogma cycle but
 * leaves {active:true}; restoring authority resumes that same configured
 * broadcast without requiring a second client click.
 */
function reconcileTransponderEffectsForCreation(event: Record<string, any> = {}) {
  const session = event.session || null;
  const creationItem = event.item || null;
  const creationID = toInt(event.creationID || creationItem && creationItem.itemID, 0);
  const characterID = toInt(event.characterID, 0);
  if (!session || !session._space || creationID <= 0 || characterID <= 0) {
    return { started: 0, stopped: 0 };
  }
  const state = event.state || readCreationState(creationItem);
  const previousState = event.previousState || null;
  const entries = [
    ...(state && Array.isArray(state.modules) ? state.modules : []),
    ...(previousState && Array.isArray(previousState.modules)
      ? previousState.modules
      : []),
  ];
  const moduleIDs = new Set(
    entries
      .filter((entry) => iffRuntime.isIffModuleType(entry && entry.typeID))
      .map((entry) => toInt(entry && entry.itemID, 0))
      .filter((moduleID) => moduleID > 0),
  );
  let started = 0;
  let stopped = 0;
  for (const moduleItemID of moduleIDs) {
    const moduleEntry = state && Array.isArray(state.modules)
      ? state.modules.find((entry) =>
          toInt(entry && entry.itemID, 0) === moduleItemID &&
          iffRuntime.isIffModuleType(entry && entry.typeID))
      : null;
    const moduleItem = findItemById(moduleItemID);
    const transponder = moduleItem
      ? iffRuntime.readTransponderState(moduleItem)
      : null;
    const shouldBroadcast = Boolean(
      state &&
      state.poweredOff !== true &&
      moduleEntry &&
      moduleItem &&
      toInt(moduleItem.locationID, 0) === creationID &&
      isCreationModuleOnline(moduleItem) &&
      transponder &&
      transponder.active === true &&
      transponder.channel,
    );
    const context: Record<string, any> = {
      session,
      characterID,
      creationItem: creationItem || findItemById(creationID),
      creationState: state,
      moduleItemID,
      dependencies: event.spaceRuntime ? { spaceRuntime: event.spaceRuntime } : {},
    };
    const active = isIffEffectActive(context);
    if (shouldBroadcast && !active) {
      const startResult = startIffDogmaEffect(
        context,
        moduleItem,
        IFF_BROADCAST_EFFECT_NAME,
      );
      if (startResult && startResult.success === true) {
        started += 1;
      }
    } else if (!shouldBroadcast && active) {
      const stopResult = stopIffDogmaEffect(
        context,
        `iff-${String(event.reason || "authority-change")}`,
      );
      if (stopResult && stopResult.success === true) {
        stopped += 1;
      }
    }
  }
  return { started, stopped };
}

function handleCreationIffStateChange(event: Record<string, any> = {}) {
  const creationID = toInt(
    event.creationID || event.item && event.item.itemID,
    0,
  );
  if (creationID <= 0) {
    return { started: 0, stopped: 0, suspended: 0, resumed: 0, released: 0 };
  }
  const transponderEffects = reconcileTransponderEffectsForCreation(event);
  const beacons = iffRuntime.reconcileBeaconsForCreation(
    creationID,
    String(event.reason || "creation-state-change"),
  );
  const systems = new Set(beacons.solarSystemIDs || []);
  const sessionSystemID = resolveSessionSolarSystemID(event.session);
  if (sessionSystemID > 0) {
    systems.add(sessionSystemID);
  }
  for (const solarSystemID of systems) {
    scheduleIffStateChanged(solarSystemID, `creation-${event.reason || "state"}`);
  }
  return {
    ...transponderEffects,
    released: beacons.released,
    resumed: beacons.resumed,
    suspended: beacons.suspended,
  };
}

function registerIffAbilityHandlers() {
  if (registered) {
    return;
  }
  registered = true;
  subscribeCreationStateChanges(handleCreationIffStateChange);

  registerCreationAbilityHandler(
    iffRuntime.IFF_BEHAVIOR_NAME,
    ABILITY_ACTIVATE_EFFECT,
    {
      validate(context) {
        if (context.creationState && context.creationState.poweredOff === true) {
          return { success: false as const, errorMsg: "CREATION_POWERED_OFF" };
        }
        const configuration = iffRuntime.normalizeIffConfiguration(
          context.kwargs.iff_channel,
          context.kwargs.iff_code,
          iffRuntime.IFF_TRANSPONDER_CHANNELS,
        );
        if (configuration.errorMsg) {
          return { success: false as const, errorMsg: configuration.errorMsg };
        }
        if (!configuration.channel) {
          return { success: false as const, errorMsg: "IFF_CHANNEL_REQUIRED" };
        }
        context.transponderConfiguration = configuration;
        return { success: true as const };
      },
      execute(context) {
        const moduleItem = findItemById(context.moduleItemID);
        if (!moduleItem) {
          return { success: false as const, errorMsg: "MODULE_NOT_FOUND" };
        }
        if (!isCreationModuleOnline(moduleItem)) {
          return { success: false as const, errorMsg: "MODULE_OFFLINE" };
        }
        const effectResult = startIffDogmaEffect(
          context,
          moduleItem,
          IFF_BROADCAST_EFFECT_NAME,
        );
        if (!effectResult.success) {
          return effectResult;
        }
        const result = iffRuntime.setTransponderBroadcastState(
          context.moduleItemID,
          true,
          context.transponderConfiguration,
        );
        if (!result || result.success !== true) {
          stopIffDogmaEffect(context, "iff-state-write-failed");
          return result || { success: false as const, errorMsg: "IFF_WRITE_FAILED" };
        }
        const solarSystemID = effectResult.data.spaceContext.solarSystemID;
        scheduleIffStateChanged(solarSystemID, "transponder-activated");
        log.info(
          `[iff] transponder activated module=${context.moduleItemID} ` +
          `channel=${context.transponderConfiguration.channel} ` +
          `hasCode=${Boolean(context.transponderConfiguration.code)}`,
        );
        return {
          success: true as const,
          data: { durationMs: effectResult.data.effectState.durationMs },
        };
      },
    },
  );

  registerCreationAbilityHandler(
    iffRuntime.IFF_BEHAVIOR_NAME,
    ABILITY_DEACTIVATE_EFFECT,
    {
      execute(context) {
        const effectResult = stopIffDogmaEffect(
          context,
          "manual",
          true,
        );
        if (!effectResult.success) {
          return effectResult;
        }
        if (effectResult.data && effectResult.data.pending === true) {
          if (effectResult.data.effectState) {
            effectResult.data.effectState.iffManualDeactivationPending = true;
          }
          return {
            success: true as const,
            data: { pending: true, deactivateAtMs: effectResult.data.deactivateAtMs },
          };
        }
        const result = iffRuntime.setTransponderBroadcastState(
          context.moduleItemID,
          false,
        );
        if (!result || result.success !== true) {
          return result || { success: false as const, errorMsg: "IFF_WRITE_FAILED" };
        }
        const solarSystemID = resolveSessionSolarSystemID(context.session);
        if (solarSystemID > 0) {
          scheduleIffStateChanged(solarSystemID, "transponder-deactivated");
        }
        log.info(`[iff] transponder deactivated module=${context.moduleItemID}`);
        return { success: true as const, data: {} };
      },
    },
  );

  registerCreationAbilityHandler(
    iffRuntime.IFF_BEHAVIOR_NAME,
    ABILITY_IFF_RECONFIGURE,
    {
      execute(context) {
        const configuration = iffRuntime.normalizeIffConfiguration(
          context.kwargs.iff_channel,
          context.kwargs.iff_code,
          iffRuntime.IFF_TRANSPONDER_CHANNELS,
        );
        if (configuration.errorMsg) {
          return { success: false as const, errorMsg: configuration.errorMsg };
        }
        const writeResult = iffRuntime.writeTransponderState(
          context.moduleItemID,
          configuration,
        );
        if (!writeResult || writeResult.success !== true) {
          return {
            success: false as const,
            errorMsg: (writeResult && writeResult.errorMsg) || "IFF_WRITE_FAILED",
          };
        }
        const solarSystemID = resolveSessionSolarSystemID(context.session);
        if (solarSystemID > 0) {
          scheduleIffStateChanged(solarSystemID, "transponder-reconfigured");
        }
        log.info(
          `[iff] transponder reconfigured module=${context.moduleItemID} ` +
          `channel=${configuration.channel || "off"} hasCode=${Boolean(configuration.code)}`,
        );
        return { success: true as const, data: {} };
      },
    },
  );

  registerCreationAbilityHandler(
    iffRuntime.IFF_BEACON_BEHAVIOR_NAME,
    ABILITY_ACTIVATE_EFFECT,
    {
      validate(context) {
        if (context.creationState && context.creationState.poweredOff === true) {
          return { success: false as const, errorMsg: "CREATION_POWERED_OFF" };
        }
        const configuration = iffRuntime.normalizeIffConfiguration(
          context.kwargs.iff_channel,
          context.kwargs.iff_code,
          iffRuntime.IFF_BEACON_CHANNELS,
        );
        if (configuration.errorMsg) {
          return { success: false as const, errorMsg: configuration.errorMsg };
        }
        if (!configuration.channel) {
          return { success: false as const, errorMsg: "IFF_CHANNEL_REQUIRED" };
        }
        context.beaconConfiguration = configuration;
        return { success: true as const };
      },
      execute(context) {
        const moduleItem = findItemById(context.moduleItemID);
        if (!moduleItem) {
          return { success: false as const, errorMsg: "MODULE_NOT_FOUND" };
        }
        if (!isCreationModuleOnline(moduleItem)) {
          return { success: false as const, errorMsg: "MODULE_OFFLINE" };
        }
        const effectResult = startIffDogmaEffect(
          context,
          moduleItem,
          IFF_BEACON_EFFECT_NAME,
          { repeat: 0, immobilizesShip: true },
        );
        if (!effectResult.success) {
          return effectResult;
        }
        const { effectState, spaceContext } = effectResult.data;
        const nowMs = Number.isFinite(Number(effectState.startedAtMs))
          ? Number(effectState.startedAtMs)
          : Date.now();
        const durationMs = iffRuntime.resolveBeaconDurationMs(moduleItem.typeID);
        const entityPosition = spaceContext.entity.position || null;
        const startResult = iffRuntime.startBeacon({
          beaconID: context.moduleItemID,
          moduleTypeID: moduleItem.typeID,
          shipID: spaceContext.shipID,
          characterID: context.characterID,
          corporationID: toInt(context.session && context.session.corpid, 0),
          solarSystemID: spaceContext.solarSystemID,
          position: entityPosition
            ? [entityPosition.x, entityPosition.y, entityPosition.z]
            : null,
          channel: context.beaconConfiguration.channel,
          code: context.beaconConfiguration.code,
          durationMs,
          releaseImmobilizer: (reason) => stopIffDogmaEffect(
            context,
            `iff-beacon-${reason || "released"}`,
          ),
          resumeImmobilizer: (reason) => {
            const currentModuleItem = findItemById(context.moduleItemID);
            if (!currentModuleItem || !isCreationModuleOnline(currentModuleItem)) {
              return { success: false as const, errorMsg: "MODULE_OFFLINE" };
            }
            if (isIffEffectActive(context)) {
              return { success: true as const, data: { alreadyActive: true } };
            }
            return startIffDogmaEffect(
              context,
              currentModuleItem,
              IFF_BEACON_EFFECT_NAME,
              { repeat: 0, immobilizesShip: true },
            );
          },
          notifyMapChanged: (reason) =>
            scheduleIffStateChanged(spaceContext.solarSystemID, `beacon-${reason}`),
          nowMs,
        });
        if (!startResult.success) {
          stopIffDogmaEffect(context, "iff-beacon-start-failed");
          return startResult;
        }
        scheduleIffStateChanged(spaceContext.solarSystemID, "beacon-activated");
        return { success: true as const, data: { durationMs } };
      },
    },
  );

  registerCreationAbilityHandler(
    iffRuntime.IFF_BEACON_BEHAVIOR_NAME,
    ABILITY_DEACTIVATE_EFFECT,
    {
      execute(context) {
        const effectResult = stopIffDogmaEffect(context, "manual", true);
        if (!effectResult.success) {
          return effectResult;
        }
        if (effectResult.data && effectResult.data.pending === true) {
          if (effectResult.data.effectState) {
            effectResult.data.effectState.iffManualDeactivationPending = true;
          }
          return {
            success: true as const,
            data: { pending: true, deactivateAtMs: effectResult.data.deactivateAtMs },
          };
        }
        const stopResult = iffRuntime.stopBeacon(
          context.moduleItemID,
          "deactivated",
        );
        if (!stopResult.success && stopResult.errorMsg !== "BEACON_NOT_ACTIVE") {
          return stopResult;
        }
        return { success: true as const, data: {} };
      },
    },
  );
}

module.exports = {
  buildVerdictsForViewer,
  buildNpcTransponderShipsForSystem,
  handleCreationIffStateChange,
  handleIffBroadcastEffectStopped,
  handleIffBeaconEffectStopped,
  notifyIffMapChanged,
  notifyIffStateChanged,
  notifyIffVerdicts,
  registerIffAbilityHandlers,
  reconcileTransponderEffectsForCreation,
  scheduleIffVerdicts,
};
