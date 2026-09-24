"use strict";

/**
 * Server authority for Frontier manually aimed weapons.
 *
 * The client only sends a fitted module ID and a world-space aim direction.
 * It never sends a target ID, and a skill shot must therefore remain usable
 * without a target lock.  This runtime resolves the first physical ballpark
 * intersection and only then delegates damage, persistence, aggression, and
 * combat reveal to the shared space-runtime weapon path.
 */

const path = require("path");

const log = require(path.join(__dirname, "../../utils/logger"));
const { buildDict } = require(path.join(__dirname, "../_shared/serviceHelpers"));
const {
  canEntitiesCollide,
  findSweptEntityCollision,
  getEntityCollisionRadius,
  getSceneCollisionCandidates,
} = require(path.join(__dirname, "../../space/destiny/simulation/collisions"));
const creationControlAuthority = require(path.join(
  __dirname,
  "./creationControlAuthority",
));
const physicsGunPickup = require(path.join(__dirname, "../../space/physicsGunPickup"));
const physicsGunMovement = require(path.join(__dirname, "../../space/dungeonPropMovement"));
const PHYSICS_GUN_TYPE_ID = 99999;

const SKILL_SHOT_EFFECT_GUID = "effects.SkillShotWeapon";
const SKILL_SHOT_BEAM_RADIUS_METERS = 50;
const SKILL_SHOT_AIM_GRACE_MS = 5_000;
const MAX_TURRET_STATES = 32;
// Added by the verified Python 3.12 client adapter only for shots originating
// from AutoCannonMode's toggle loop. Legacy/unpatched two-field turret states
// remain ordinary manual fire for backwards compatibility.
const AUTO_FIRE_CONTRACT_MARKER = "evejs.auto_fire.v1";
const AUTO_FIRE_TERMINATED_KEY = "AutoFireTerminated";
const ATTRIBUTE_DURATION = 73;
const ATTRIBUTE_REACTIVATION_DELAY = 669;
const ATTRIBUTE_HELD_BEAM_RAMP_MAX_MULTIPLIER = 6272;
const ATTRIBUTE_HELD_BEAM_RAMP_DURATION = 6273;

const SKILL_SHOT_PROFILES = new Map<number, Record<string, any>>([
  [94076, {
    mode: "single_shot",
    fireDelayMs: 500,
    spoolUpMs: 0,
    activationEffectID: 12886,
  }],
  [95753, {
    mode: "single_shot",
    fireDelayMs: 0,
    spoolUpMs: 0,
    activationEffectID: 12961,
  }],
  [95317, {
    mode: "held_beam",
    fireDelayMs: 0,
    spoolUpMs: 250,
    activationEffectID: 12887,
  }],
  [99999, {
    mode: "held_beam",
    fireDelayMs: 0,
    spoolUpMs: 250,
    activationEffectID: 12887,
  }],
  [95503, {
    mode: "held_beam",
    fireDelayMs: 0,
    spoolUpMs: 500,
    activationEffectID: 12887,
  }],
  [95778, {
    mode: "held_beam",
    fireDelayMs: 0,
    spoolUpMs: 250,
    activationEffectID: 12887,
  }],
]);

function toFiniteNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function toPositiveInt(value, fallback = 0) {
  const numeric = Math.trunc(toFiniteNumber(value, fallback));
  return numeric > 0 ? numeric : fallback;
}

function cloneVector(value, fallback: Record<string, any> = { x: 0, y: 0, z: 0 }) {
  const source = Array.isArray(value)
    ? { x: value[0], y: value[1], z: value[2] }
    : value && typeof value === "object"
      ? value
      : fallback;
  return {
    x: toFiniteNumber(source && source.x, fallback.x),
    y: toFiniteNumber(source && source.y, fallback.y),
    z: toFiniteNumber(source && source.z, fallback.z),
  };
}

function addVector(left, right) {
  return {
    x: left.x + right.x,
    y: left.y + right.y,
    z: left.z + right.z,
  };
}

function subtractVector(left, right) {
  return {
    x: left.x - right.x,
    y: left.y - right.y,
    z: left.z - right.z,
  };
}

function scaleVector(vector, scalar) {
  return {
    x: vector.x * scalar,
    y: vector.y * scalar,
    z: vector.z * scalar,
  };
}

function normalizeDirection(value) {
  const vector = cloneVector(value);
  const length = Math.hypot(vector.x, vector.y, vector.z);
  if (!Number.isFinite(length) || length <= 1e-9) {
    return null;
  }
  return scaleVector(vector, 1 / length);
}

function directionsApproximatelyEqual(left, right, epsilon = 1e-6) {
  return (
    Math.abs(left.x - right.x) <= epsilon &&
    Math.abs(left.y - right.y) <= epsilon &&
    Math.abs(left.z - right.z) <= epsilon
  );
}

function normalizeTurretStates(value) {
  if (!Array.isArray(value) || value.length <= 0 || value.length > MAX_TURRET_STATES) {
    return [];
  }

  const states: any[] = [];
  const seenModuleIDs = new Set<number>();
  for (const rawState of value) {
    const moduleID = toPositiveInt(
      Array.isArray(rawState)
        ? rawState[0]
        : rawState && (rawState.module_id ?? rawState.moduleID),
      0,
    );
    const direction = normalizeDirection(
      Array.isArray(rawState)
        ? rawState[1]
        : rawState && (
            rawState.aim_direction ??
            rawState.aimDirection ??
            rawState.direction
          ),
    );
    if (moduleID <= 0 || !direction || seenModuleIDs.has(moduleID)) {
      continue;
    }
    seenModuleIDs.add(moduleID);
    states.push({
      moduleID,
      direction,
      automatic: Boolean(
        Array.isArray(rawState) && rawState[2] === AUTO_FIRE_CONTRACT_MARKER,
      ),
    });
  }
  return states;
}

function hasAutoFireContractMarker(value) {
  return Boolean(
    Array.isArray(value) &&
    value.some((rawState) => (
      Array.isArray(rawState) && rawState[2] === AUTO_FIRE_CONTRACT_MARKER
    )),
  );
}

function getProfile(typeID) {
  const profile = SKILL_SHOT_PROFILES.get(toPositiveInt(typeID, 0));
  return profile ? { ...profile } : null;
}

function getModuleAttribute(snapshot, attributeID, fallback = 0) {
  const attributes = snapshot && snapshot.moduleAttributes;
  return toFiniteNumber(
    attributes && (attributes[attributeID] ?? attributes[String(attributeID)]),
    fallback,
  );
}

function resolveCycleDurationMs(snapshot) {
  return Math.max(
    1,
    getModuleAttribute(
      snapshot,
      ATTRIBUTE_DURATION,
      toFiniteNumber(snapshot && snapshot.durationMs, 1_000),
    ),
  );
}

function resolveReactivationDelayMs(snapshot) {
  return Math.max(
    resolveCycleDurationMs(snapshot),
    getModuleAttribute(snapshot, ATTRIBUTE_REACTIVATION_DELAY, 0),
  );
}

function resolveHeldBeamRampDurationMs(snapshot) {
  return Math.max(
    0,
    getModuleAttribute(snapshot, ATTRIBUTE_HELD_BEAM_RAMP_DURATION, 0),
  );
}

function resolveHeldBeamDamageMultiplier(snapshot, rampStartedAtMs, nowMs) {
  const maximumMultiplier = Math.max(
    1,
    getModuleAttribute(snapshot, ATTRIBUTE_HELD_BEAM_RAMP_MAX_MULTIPLIER, 1),
  );
  const durationMs = resolveHeldBeamRampDurationMs(snapshot);
  if (maximumMultiplier <= 1 || durationMs <= 0) {
    return 1;
  }
  const fraction = Math.min(
    1,
    Math.max(0, (toFiniteNumber(nowMs, 0) - toFiniteNumber(rampStartedAtMs, 0)) / durationMs),
  );
  return 1 + ((maximumMultiplier - 1) * fraction);
}

function resolveActiveShipID(session) {
  return toPositiveInt(
    session && (
      session._space && session._space.shipID ||
      session.activeShipID ||
      session.shipID ||
      session.shipid
    ),
    0,
  );
}

function notifySkillShot(session, name, payload: any[] = []) {
  if (!session || typeof session.sendNotification !== "function") {
    return false;
  }
  session.sendNotification(name, "clientID", payload);
  return true;
}

function mapFailureKey(errorMsg, options: Record<string, any> = {}) {
  switch (String(errorMsg || "")) {
    case "NO_AMMO":
    case "NO_CHARGE":
    case "CHARGE_NOT_FOUND":
    case "CRYSTAL_NOT_FOUND":
      return "NoCharges";
    case "NOT_ENOUGH_CAPACITOR":
      return "NotEnoughEnergy";
    case "MODULE_REACTIVATING":
      return "ModuleReactivationDelayed2";
    case "EFFECT_ALREADY_ACTIVE":
      return "EffectAlreadyActive2";
    case "AUTO_FIRE_CONTROLLER_OFFLINE":
      return "AutoFireControllerOffline";
    default:
      // Automatic fire treats every failure except the two transient module
      // states above as terminal. The client adapter consumes this dedicated
      // key and stops the toggle without opening one generic popup per poll.
      return options.automatic === true
        ? AUTO_FIRE_TERMINATED_KEY
        : "EffectAlreadyActive2";
  }
}

function failure(errorMsg, extra: Record<string, any> = {}): any {
  return {
    success: false,
    errorMsg,
    errorKey: mapFailureKey(errorMsg),
    ...extra,
  };
}

function success(data: Record<string, any> = {}): any {
  return { success: true, data };
}

function resolveUtilityConsequenceFailure(hitResult) {
  const utilityResult = hitResult && hitResult.utilityResult;
  if (
    !utilityResult ||
    utilityResult.matched !== true ||
    utilityResult.success === true
  ) {
    return null;
  }
  const stopReason = String(utilityResult.stopReason || "target");
  const errorKey = stopReason === "cargo"
    ? "NotEnoughCargoSpace"
    : stopReason === "charge"
      ? "CrystalRequired"
      : "InvalidTargetType";
  return failure(`UTILITY_${stopReason.toUpperCase()}`, {
    errorKey,
    utilityResult,
  });
}

function defaultSchedule(callback, delayMs) {
  const timer = setTimeout(callback, Math.max(0, delayMs));
  if (timer && typeof timer.unref === "function") {
    timer.unref();
  }
  return timer;
}

class SkillShotRuntime {
  declare _clearTimer: any;
  declare _collision: any;
  declare _cooldowns: Map<string, number>;
  declare _getSpaceRuntime: any;
  declare _heldSessions: WeakMap<any, Map<number, any>>;
  declare _now: any;
  declare _resolveCreationControlAuthority: any;
  declare _schedule: any;
  declare _singleSessions: WeakMap<any, any>;
  declare _physicsGun: any;

  constructor(dependencies: Record<string, any> = {}) {
    this._getSpaceRuntime = dependencies.getSpaceRuntime || (() =>
      require(path.join(__dirname, "../../space/runtime")));
    this._collision = dependencies.collision || {
      canEntitiesCollide,
      findSweptEntityCollision,
      getEntityCollisionRadius,
      getSceneCollisionCandidates,
    };
    this._now = dependencies.now || (() => Date.now());
    this._schedule = dependencies.schedule || defaultSchedule;
    this._clearTimer = dependencies.clearTimer || clearTimeout;
    this._resolveCreationControlAuthority =
      dependencies.resolveCreationControlAuthority ||
      creationControlAuthority.resolveCreationControlAuthority;
    this._physicsGun = dependencies.physicsGun || {
      pickup: physicsGunPickup.pickupPhysicsGunTarget,
      update: physicsGunMovement.updateDetachedPropTether,
      release: physicsGunMovement.releaseDetachedPropTether,
    };
    this._cooldowns = new Map();
    this._singleSessions = new WeakMap();
    this._heldSessions = new WeakMap();
  }

  _getSceneAndEntity(session) {
    const spaceRuntime = this._getSpaceRuntime();
    const shipID = resolveActiveShipID(session);
    if (!spaceRuntime || shipID <= 0 || !session || !session._space) {
      return failure("SHIP_NOT_IN_SPACE");
    }
    const scene = typeof spaceRuntime.getSceneForSession === "function"
      ? spaceRuntime.getSceneForSession(session)
      : null;
    const entity = typeof spaceRuntime.getEntity === "function"
      ? spaceRuntime.getEntity(session, shipID)
      : scene && typeof scene.getEntityByID === "function"
        ? scene.getEntityByID(shipID)
        : null;
    if (!scene || !entity || !entity.position) {
      return failure("SHIP_NOT_IN_SPACE");
    }
    return success({ spaceRuntime, interop: spaceRuntime.skillShotInterop || {}, scene, entity });
  }

  _enforceAutoFireAuthority(session, context, states: any[] = []) {
    if (!states.some((state) => state && state.automatic === true)) {
      return success();
    }
    const authorityState = this._resolveCreationControlAuthority(session, {
      shipItem: context && context.shipItem,
    });
    if (!authorityState || authorityState.authorityResolved !== true) {
      return failure("AUTO_FIRE_AUTHORITY_UNAVAILABLE");
    }
    if (
      authorityState.isCreation === true &&
      !creationControlAuthority.hasOnlineCreationControlModule(
        authorityState,
        creationControlAuthority.TYPE_CREATION_REPEATER,
      )
    ) {
      return failure("AUTO_FIRE_CONTROLLER_OFFLINE");
    }
    return success({
      isCreation: authorityState.isCreation === true,
      requiresCreationRepeater: authorityState.isCreation === true,
    });
  }

  _resolveModuleContext(session, state, expectedMode, options: Record<string, any> = {}) {
    const sceneResult = this._getSceneAndEntity(session);
    if (!sceneResult.success) {
      return sceneResult;
    }
    const { spaceRuntime, interop, scene, entity } = sceneResult.data;
    const moduleItem = typeof interop.getEntityRuntimeModuleItem === "function"
      ? interop.getEntityRuntimeModuleItem(entity, state.moduleID, 0)
      : null;
    const profile = getProfile(moduleItem && moduleItem.typeID);
    if (!moduleItem || !profile || profile.mode !== expectedMode) {
      return failure("UNSUPPORTED_SKILL_SHOT");
    }
    if (
      typeof interop.isEffectivelyOnlineModule === "function" &&
      interop.isEffectivelyOnlineModule(moduleItem) !== true
    ) {
      return failure("MODULE_OFFLINE");
    }
    const chargeItem = typeof interop.getEntityRuntimeLoadedCharge === "function"
      ? interop.getEntityRuntimeLoadedCharge(entity, moduleItem, moduleItem.flagID)
      : null;
    if (!chargeItem || toPositiveInt(chargeItem.typeID, 0) <= 0) {
      return failure("NO_CHARGE");
    }
    const shipItem = typeof interop.getEntityRuntimeShipItem === "function"
      ? interop.getEntityRuntimeShipItem(entity)
      : null;
    const weaponSnapshot = typeof interop.buildWeaponSnapshotForEntity === "function"
      ? interop.buildWeaponSnapshotForEntity(entity, moduleItem, chargeItem, { shipItem })
      : null;
    if (!weaponSnapshot) {
      return failure("UNSUPPORTED_SKILL_SHOT");
    }

    const nowMs = this._now();
    const cooldownKey = `${toPositiveInt(entity.itemID, 0)}:${state.moduleID}`;
    const cooldownUntilMs = toFiniteNumber(this._cooldowns.get(cooldownKey), 0);
    if (options.checkCooldown !== false && cooldownUntilMs > nowMs) {
      return failure("MODULE_REACTIVATING", {
        data: { remainingMs: cooldownUntilMs - nowMs },
      });
    }
    if (cooldownUntilMs > 0 && cooldownUntilMs <= nowMs) {
      this._cooldowns.delete(cooldownKey);
    }
    const capacitorAmount = typeof interop.getEntityCapacitorAmount === "function"
      ? interop.getEntityCapacitorAmount(entity)
      : Number.POSITIVE_INFINITY;
    if (toFiniteNumber(weaponSnapshot.capNeed, 0) > capacitorAmount + 1e-6) {
      return failure("NOT_ENOUGH_CAPACITOR");
    }
    if (
      weaponSnapshot.chargeMode !== "crystal" &&
      toPositiveInt(weaponSnapshot.chargeQuantity, 0) <= 0
    ) {
      return failure("NO_AMMO");
    }
    return success({
      spaceRuntime,
      interop,
      scene,
      entity,
      moduleItem,
      chargeItem,
      shipItem,
      profile,
      weaponSnapshot,
      cooldownKey,
    });
  }

  _traceShot(scene, sourceEntity, direction, maxRange) {
    const normalizedDirection = normalizeDirection(direction);
    const sourcePosition = cloneVector(sourceEntity && sourceEntity.position);
    const range = Math.max(0, toFiniteNumber(maxRange, 0));
    if (!normalizedDirection || range <= 0) {
      return {
        entity: null,
        endpoint: sourcePosition,
        direction: normalizedDirection,
        distance: 0,
      };
    }

    const sourceRadius = Math.max(
      0,
      toFiniteNumber(this._collision.getEntityCollisionRadius(sourceEntity), 0),
    );
    const start = addVector(
      sourcePosition,
      scaleVector(normalizedDirection, sourceRadius + 0.01),
    );
    const end = addVector(start, scaleVector(normalizedDirection, range));
    let earliest = null;
    for (const candidate of this._collision.getSceneCollisionCandidates(scene)) {
      if (!this._collision.canEntitiesCollide(sourceEntity, candidate)) {
        continue;
      }
      const candidatePosition = cloneVector(candidate && candidate.position);
      const collision = this._collision.findSweptEntityCollision(
        sourceEntity,
        candidate,
        start,
        end,
        candidatePosition,
        candidatePosition,
        { movingRadius: SKILL_SHOT_BEAM_RADIUS_METERS },
      );
      if (
        collision &&
        (
          !earliest ||
          collision.fraction < earliest.collision.fraction - 1e-12
        )
      ) {
        earliest = { candidate, collision };
      }
    }

    if (!earliest) {
      return { entity: null, endpoint: end, direction: normalizedDirection, distance: range };
    }
    const fraction = Math.min(1, Math.max(0, toFiniteNumber(earliest.collision.fraction, 0)));
    const endpoint = addVector(start, scaleVector(subtractVector(end, start), fraction));
    return {
      entity: earliest.candidate,
      endpoint,
      direction: normalizedDirection,
      distance: range * fraction,
      collision: earliest.collision,
    };
  }

  _buildFxOptions(context, trace, active, heldBeam = false) {
    const { entity, moduleItem, chargeItem, weaponSnapshot } = context;
    const targetID = toPositiveInt(trace && trace.entity && trace.entity.itemID, 0) || null;
    const endpoint = cloneVector(trace && trace.endpoint, entity.position);
    const offset = subtractVector(endpoint, cloneVector(entity.position));
    return {
      moduleID: toPositiveInt(moduleItem.itemID, 0),
      moduleTypeID: toPositiveInt(moduleItem.typeID, 0),
      targetID,
      chargeTypeID: toPositiveInt(chargeItem && chargeItem.typeID, 0) || null,
      isOffensive: true,
      start: active === true,
      active: active === true,
      duration: resolveCycleDurationMs(weaponSnapshot),
      repeat: heldBeam ? 0 : 1,
      graphicInfo: {
        targetOffset: [offset.x, offset.y, offset.z],
        targetBallID: targetID,
        resolvedTargetBallID: targetID,
        endpointMode: targetID ? "hit" : "miss",
        ...(heldBeam ? { beamStateID: toPositiveInt(moduleItem.itemID, 0) } : {}),
      },
    };
  }

  _broadcastEffect(context, trace, active, heldBeam = false) {
    const { scene, entity, weaponSnapshot } = context;
    if (!scene || typeof scene.broadcastSpecialFx !== "function") {
      return null;
    }
    return scene.broadcastSpecialFx(
      entity.itemID,
      String(weaponSnapshot.effectGUID || SKILL_SHOT_EFFECT_GUID),
      this._buildFxOptions(context, trace, active, heldBeam),
      entity,
    );
  }

  _consumeShotResources(context, nowMs) {
    const { entity, moduleItem, chargeItem, weaponSnapshot, interop } = context;
    const previousCapacitorAmount = typeof interop.getEntityCapacitorAmount === "function"
      ? interop.getEntityCapacitorAmount(entity)
      : null;
    if (
      typeof interop.consumeEntityCapacitor === "function" &&
      interop.consumeEntityCapacitor(entity, weaponSnapshot.capNeed) !== true
    ) {
      return failure("NOT_ENOUGH_CAPACITOR");
    }
    if (typeof interop.notifyCapacitorChangeToSession === "function") {
      interop.notifyCapacitorChangeToSession(
        entity.session || null,
        entity,
        nowMs,
        previousCapacitorAmount,
      );
    }

    const chargeResult = weaponSnapshot.chargeMode === "crystal"
      ? typeof interop.applyCrystalVolatilityDamage === "function"
        ? interop.applyCrystalVolatilityDamage(
            context.scene,
            entity,
            moduleItem,
            chargeItem,
            nowMs,
          )
        : { success: true }
      : typeof interop.consumeTurretAmmoCharge === "function"
        ? interop.consumeTurretAmmoCharge(entity, moduleItem, chargeItem, nowMs, 1)
        : { success: true };
    if (!chargeResult || chargeResult.success !== true) {
      return failure(chargeResult && chargeResult.errorMsg || "NO_AMMO");
    }
    return success({ chargeResult });
  }

  _applyHit(context, trace, nowMs, options: Record<string, any> = {}) {
    const { scene, entity, moduleItem, chargeItem, weaponSnapshot, interop } = context;
    const targetEntity = trace && trace.entity;
    if (moduleItem.typeID === PHYSICS_GUN_TYPE_ID) {
      if (!targetEntity) return { damageResult: null, destroyResult: null };
      let pickup;
      try {
        pickup = this._physicsGun.pickup(
          scene, options.session, targetEntity, moduleItem.itemID,
          options.heldState.direction, { nowMs },
        );
      } catch (error) {
        log.warn(`[SkillShot] Physics Gun pickup failed: ${error.message}`);
        pickup = { success: false, errorMsg: "PHYSICS_GUN_PICKUP_FAILED" };
      }
      if (pickup?.success) {
        options.heldState.grabbedWorldEntityID = pickup.data.worldEntityID;
        trace.entity = scene.getEntityByID?.(pickup.data.worldEntityID) ||
          scene.dynamicEntities?.get(pickup.data.worldEntityID) || targetEntity;
        trace.endpoint = { ...trace.entity.position };
      }
      return {
        damageResult: null,
        destroyResult: null,
        utilityResult: {
          matched: true,
          success: pickup?.success === true,
          blockCombatDamage: true,
          stopReason: "target",
          errorMsg: pickup?.errorMsg,
        },
      };
    }
    if (!targetEntity) {
      return { damageResult: null, destroyResult: null };
    }
    const damageMultiplier = Math.max(
      0,
      toFiniteNumber(options.damageMultiplier, 1),
    );
    const utilityResult =
      typeof interop.applySkillShotUtilityHit === "function"
        ? interop.applySkillShotUtilityHit({
            scene,
            sourceEntity: entity,
            targetEntity,
            moduleItem,
            chargeItem,
            weaponSnapshot,
            nowMs,
            rampMultiplier: damageMultiplier,
          })
        : null;
    if (
      utilityResult &&
      (
        utilityResult.matched === true ||
        utilityResult.blockCombatDamage === true
      )
    ) {
      return {
        damageResult: null,
        destroyResult: null,
        utilityResult,
      };
    }
    if (typeof interop.applyWeaponDamageToTarget !== "function") {
      return { damageResult: null, destroyResult: null, utilityResult };
    }
    const shotDamage = Object.fromEntries(
      Object.entries<any>(weaponSnapshot.rawShotDamage || {}).map(([key, value]) => [
        key,
        toFiniteNumber(value, 0) * damageMultiplier,
      ]),
    );
    const result = interop.applyWeaponDamageToTarget(
      scene,
      entity,
      targetEntity,
      shotDamage,
      nowMs,
      { skipWeaponOcclusion: true },
    ) || {};
    const appliedDamage = typeof interop.getAppliedDamageAmount === "function"
      ? interop.getAppliedDamageAmount(result.damageResult)
      : 0;
    if (appliedDamage > 0 && typeof interop.noteKillmailDamage === "function") {
      interop.noteKillmailDamage(entity, targetEntity, appliedDamage, {
        whenMs: nowMs,
        weaponSnapshot,
        moduleItem,
        chargeItem,
      });
    }
    if (
      result.destroyResult &&
      result.destroyResult.success === true &&
      typeof interop.recordKillmailFromDestruction === "function"
    ) {
      interop.recordKillmailFromDestruction(targetEntity, result.destroyResult, {
        attackerEntity: entity,
        victimSession: result.victimSession,
        whenMs: nowMs,
        weaponSnapshot,
        moduleItem,
        chargeItem,
      });
    }
    if (typeof interop.notifyWeaponDamageMessages === "function") {
      const hitQuality = typeof interop.getCombatMessageHitQuality === "function"
        ? interop.getCombatMessageHitQuality({ hit: true, quality: 1 })
        : 4;
      interop.notifyWeaponDamageMessages(
        entity,
        targetEntity,
        moduleItem,
        shotDamage,
        appliedDamage,
        hitQuality,
      );
    }
    return { ...result, utilityResult };
  }

  _executeShot(session, state, expectedMode, options: Record<string, any> = {}) {
    const contextResult = this._resolveModuleContext(
      session,
      state,
      expectedMode,
      { checkCooldown: options.checkCooldown !== false },
    );
    if (!contextResult.success) {
      return contextResult;
    }
    const context = contextResult.data;
    if (state && state.automatic === true) {
      // A delayed skill-shot must not rely on authority captured by BeginFire.
      // Re-resolve persisted effective Creation state immediately before any
      // capacitor/ammunition consumption, collision, damage, or presentation.
      const authorityResult = this._enforceAutoFireAuthority(
        session,
        context,
        [state],
      );
      if (!authorityResult.success) {
        return authorityResult;
      }
    }
    const nowMs = this._now();
    const resourceResult = this._consumeShotResources(context, nowMs);
    if (!resourceResult.success) {
      return resourceResult;
    }
    let trace;
    let hitResult;
    if (expectedMode === "held_beam" &&
        context.moduleItem.typeID === PHYSICS_GUN_TYPE_ID && state.grabbedWorldEntityID) {
      const grabbed = context.scene.dynamicEntities?.get(state.grabbedWorldEntityID);
      if (!grabbed || !this._physicsGun.update(
        context.scene, grabbed.itemID, session, state.moduleID, state.direction,
      )) return failure("PHYSICS_GUN_HOLD_LOST");
      trace = {
        entity: grabbed,
        endpoint: { ...grabbed.position },
        direction: state.direction,
        distance: Math.hypot(
          grabbed.position.x - context.entity.position.x,
          grabbed.position.y - context.entity.position.y,
          grabbed.position.z - context.entity.position.z,
        ),
      };
      hitResult = { damageResult: null, destroyResult: null };
    } else {
      trace = this._traceShot(
        context.scene,
        context.entity,
        state.direction,
        context.weaponSnapshot.optimalRange,
      );
      hitResult = this._applyHit(context, trace, nowMs, {
        session,
        heldState: state,
      damageMultiplier: expectedMode === "held_beam"
        ? resolveHeldBeamDamageMultiplier(
            context.weaponSnapshot,
            options.rampStartedAtMs,
            nowMs,
          )
        : 1,
      });
    }
    this._cooldowns.set(
      context.cooldownKey,
      nowMs + (
        expectedMode === "held_beam"
          ? resolveCycleDurationMs(context.weaponSnapshot)
          : resolveReactivationDelayMs(context.weaponSnapshot)
      ),
    );
    if (options.broadcast !== false) {
      this._broadcastEffect(context, trace, true, expectedMode === "held_beam");
    }
    return success({
      context,
      trace,
      hitResult,
      nowMs,
      consequenceFailure: resolveUtilityConsequenceFailure(hitResult),
    });
  }

  _notifyFailure(session, result, options: Record<string, any> = {}) {
    notifySkillShot(
      session,
      "OnSkillShotFailed",
      [
        options.automatic === true
          ? mapFailureKey(result && result.errorMsg, options)
          : result && result.errorKey || mapFailureKey(
              result && result.errorMsg,
              options,
            ),
        // Notification arguments go through EVE marshal, which rejects raw {}.
        buildDict([]),
      ],
    );
  }

  _scheduleSingleEffectStop(executionResult) {
    const { context, trace } = executionResult.data;
    const timer = this._schedule(() => {
      try {
        this._broadcastEffect(context, trace, false, false);
      } catch (error) {
        log.warn(`[SkillShot] failed to stop single-shot effect: ${error.message}`);
      }
    }, resolveCycleDurationMs(context.weaponSnapshot));
    return timer;
  }

  beginFire(session, rawStates) {
    const automaticRequest = hasAutoFireContractMarker(rawStates);
    const states = normalizeTurretStates(rawStates);
    // The client contract describes the firing session, not an individual
    // turret. Treat every accepted state as automatic when any raw tuple
    // carries the marker. Otherwise a malformed or mixed sibling tuple could
    // make the request pass through this branch while an unmarked delayed shot
    // escapes the per-shot Repeater revalidation below.
    if (automaticRequest) {
      for (const state of states) {
        state.automatic = true;
      }
    }
    if (states.length <= 0) {
      const result = failure("INVALID_TURRET_STATE");
      this._notifyFailure(session, result, { automatic: automaticRequest });
      return result;
    }
    if (this._singleSessions.has(session)) {
      const result = failure("EFFECT_ALREADY_ACTIVE");
      this._notifyFailure(session, result);
      return result;
    }

    if (states.some((state) => state.automatic === true)) {
      // Resolve the authoritative persisted Creation state before cooldown or
      // resource consumption. The explicit client contract, not retry timing,
      // distinguishes this request from an ordinary manual click.
      const authorityContextResult = this._resolveModuleContext(
        session,
        states[0],
        "single_shot",
        { checkCooldown: false },
      );
      if (!authorityContextResult.success) {
        this._notifyFailure(session, authorityContextResult, { automatic: true });
        return authorityContextResult;
      }
      const autoFireAuthorityResult = this._enforceAutoFireAuthority(
        session,
        authorityContextResult.data,
        states,
      );
      if (!autoFireAuthorityResult.success) {
        this._notifyFailure(session, autoFireAuthorityResult, { automatic: true });
        return autoFireAuthorityResult;
      }
    }

    const preparedStates: any[] = [];
    let firstCycleMs = this._now();
    for (const state of states) {
      const contextResult = this._resolveModuleContext(session, state, "single_shot");
      if (!contextResult.success) {
        this._notifyFailure(session, contextResult, {
          automatic: state.automatic === true,
        });
        return contextResult;
      }
      const fireAtMs = this._now() + contextResult.data.profile.fireDelayMs;
      firstCycleMs = Math.max(firstCycleMs, fireAtMs);
      preparedStates.push({ ...state, fireAtMs, fired: false, timer: null });
    }

    const firingSession = {
      states: new Map(preparedStates.map((state) => [state.moduleID, state])),
      ended: false,
    };
    this._singleSessions.set(session, firingSession);

    for (const state of preparedStates) {
      const execute = () => {
        if (firingSession.ended || state.cancelled) {
          return;
        }
        state.fired = true;
        try {
          const result = this._executeShot(session, state, "single_shot");
          if (!result.success) {
            this._notifyFailure(session, result, {
              automatic: state.automatic === true,
            });
          } else {
            this._scheduleSingleEffectStop(result);
            if (result.data.consequenceFailure) {
              this._notifyFailure(session, result.data.consequenceFailure);
            } else {
              notifySkillShot(session, "OnSkillShotSucceeded", []);
            }
          }
        } finally {
          if ([...firingSession.states.values()].every((entry) => entry.fired)) {
            this._singleSessions.delete(session);
          }
        }
      };
      const delayMs = Math.max(0, state.fireAtMs - this._now());
      state.timer = delayMs <= 0 ? (execute(), null) : this._schedule(execute, delayMs);
    }

    return success({ tFirstCycleMs: firstCycleMs });
  }

  turretStateUpdate(session, rawStates) {
    const firingSession = this._singleSessions.get(session);
    if (!firingSession) {
      return success({ updated: 0 });
    }
    const states = normalizeTurretStates(rawStates);
    let updated = 0;
    for (const state of states) {
      const current = firingSession.states.get(state.moduleID);
      if (!current || current.fired) {
        continue;
      }
      current.direction = state.direction;
      updated += 1;
    }
    return success({ updated });
  }

  endFire(session) {
    const firingSession = this._singleSessions.get(session);
    if (firingSession) {
      firingSession.ended = true;
      for (const state of firingSession.states.values()) {
        if (state.fired || state.cancelled) {
          continue;
        }
        state.cancelled = true;
        if (state.timer) {
          this._clearTimer(state.timer);
          state.timer = null;
        }
      }
      this._singleSessions.delete(session);
    }
    return success({ ended: Boolean(firingSession) });
  }

  _getHeldMap(session, create = false) {
    let heldMap = this._heldSessions.get(session);
    if (!heldMap && create) {
      heldMap = new Map();
      this._heldSessions.set(session, heldMap);
    }
    return heldMap || null;
  }

  _stopHeldState(session, state, options: Record<string, any> = {}) {
    if (!state || state.stopped) {
      return false;
    }
    state.stopped = true;
    if (state.timer) {
      this._clearTimer(state.timer);
      state.timer = null;
    }
    if (state.lastEffect) {
      this._broadcastEffect(
        state.lastEffect.context,
        state.lastEffect.trace,
        false,
        true,
      );
      state.lastEffect = null;
    }
    if (state.grabbedWorldEntityID) {
      try {
        const scene = this._getSceneAndEntity(session).data?.scene || state.grabbedScene;
        this._physicsGun.release(scene, state.grabbedWorldEntityID,
          session, state.moduleID, { nowMs: this._now() });
      } catch (error) {
        log.warn(`[SkillShot] Physics Gun release failed: ${error.message}`);
      }
      state.grabbedWorldEntityID = null;
    }
    const heldMap = this._getHeldMap(session, false);
    if (heldMap) {
      heldMap.delete(state.moduleID);
      if (heldMap.size === 0) {
        this._heldSessions.delete(session);
      }
    }
    if (options.failure) {
      this._notifyFailure(session, options.failure);
    }
    return true;
  }

  _scheduleHeldTick(session, state, delayMs) {
    state.timer = this._schedule(() => {
      state.timer = null;
      if (state.stopped) {
        return;
      }
      // The client may keep a held beam active while the reticle is unchanged.
      // A carried prop still needs to follow ship movement in that case; the
      // module and ship are revalidated on every cycle and on every scene tick.
      if (!state.grabbedWorldEntityID &&
          this._now() - state.lastAimUpdateMs > SKILL_SHOT_AIM_GRACE_MS) {
        this._stopHeldState(session, state);
        return;
      }
      const result = this._executeShot(
        session,
        state,
        "held_beam",
        {
          checkCooldown: false,
          broadcast: state.lastEffect === null,
          rampStartedAtMs: state.rampStartedAtMs,
        },
      );
      if (!result.success) {
        this._stopHeldState(session, state, { failure: result });
        return;
      }
      state.lastEffect = {
        context: result.data.context,
        trace: result.data.trace,
      };
      if (state.grabbedWorldEntityID) state.grabbedScene = result.data.context.scene;
      if (result.data.consequenceFailure) {
        this._stopHeldState(session, state, {
          failure: result.data.consequenceFailure,
        });
        return;
      }
      if (!state.succeeded) {
        state.succeeded = true;
        notifySkillShot(session, "OnSkillShotSucceeded", []);
      }
      this._scheduleHeldTick(
        session,
        state,
        resolveCycleDurationMs(result.data.context.weaponSnapshot),
      );
    }, Math.max(0, delayMs));
  }

  beginHeldBeam(session, rawStates) {
    const states = normalizeTurretStates(rawStates);
    if (states.length <= 0) {
      const result = failure("INVALID_TURRET_STATE");
      this._notifyFailure(session, result);
      return result;
    }
    const heldMap = this._getHeldMap(session, true);
    const preparedStates: any[] = [];
    let rampDurationMs = 0;
    for (const state of states) {
      if (heldMap.has(state.moduleID)) {
        const result = failure("EFFECT_ALREADY_ACTIVE");
        this._notifyFailure(session, result);
        return result;
      }
      const contextResult = this._resolveModuleContext(session, state, "held_beam");
      if (!contextResult.success) {
        this._notifyFailure(session, contextResult);
        return contextResult;
      }
      rampDurationMs = Math.max(
        rampDurationMs,
        resolveHeldBeamRampDurationMs(contextResult.data.weaponSnapshot),
      );
      preparedStates.push({
        ...state,
        lastAimUpdateMs: this._now(),
        rampStartedAtMs: 0,
        lastEffect: null,
        stopped: false,
        succeeded: false,
        timer: null,
      });
    }

    const rampStartedAtMs = this._now();
    for (const state of preparedStates) {
      state.rampStartedAtMs = rampStartedAtMs;
      heldMap.set(state.moduleID, state);
      // The client performs the authored spool-up before BeginHeldBeam.  The
      // first authoritative damage/effect cycle can therefore begin now.
      this._scheduleHeldTick(session, state, 0);
    }
    return success({
      tFirstCycleMs: rampStartedAtMs,
      rampStartedAtMs,
      rampCurveID: 0,
      rampDurationMs,
    });
  }

  heldBeamAimUpdate(session, rawStates) {
    const heldMap = this._getHeldMap(session, false);
    if (!heldMap) {
      return success({ updated: 0 });
    }
    let updated = 0;
    for (const state of normalizeTurretStates(rawStates)) {
      const current = heldMap.get(state.moduleID);
      if (!current || current.stopped) {
        continue;
      }
      const aimChanged = !directionsApproximatelyEqual(
        current.direction,
        state.direction,
      );
      current.direction = state.direction;
      current.lastAimUpdateMs = this._now();
      updated += 1;
      if (current.grabbedWorldEntityID) {
        this._physicsGun.update(current.grabbedScene,
          current.grabbedWorldEntityID, session, current.moduleID, state.direction);
        continue;
      }
      if (!aimChanged) {
        continue;
      }

      // Rebind the remote/bystander beam endpoint immediately when aim moves.
      // The firing client traces locally, but observers depend entirely on the
      // authoritative graphicInfo supplied by OnSpecialFX.
      const contextResult = this._resolveModuleContext(
        session,
        current,
        "held_beam",
        { checkCooldown: false },
      );
      if (contextResult.success) {
        const trace = this._traceShot(
          contextResult.data.scene,
          contextResult.data.entity,
          current.direction,
          contextResult.data.weaponSnapshot.optimalRange,
        );
        if (current.lastEffect) {
          this._broadcastEffect(
            current.lastEffect.context,
            current.lastEffect.trace,
            false,
            true,
          );
        }
        this._broadcastEffect(contextResult.data, trace, true, true);
        current.lastEffect = { context: contextResult.data, trace };
      }
    }
    return success({ updated });
  }

  endHeldBeam(session, moduleID) {
    const heldMap = this._getHeldMap(session, false);
    const normalizedModuleID = toPositiveInt(moduleID, 0);
    if (!heldMap || normalizedModuleID <= 0) {
      return success({ ended: false });
    }
    return success({ ended: this._stopHeldState(session, heldMap.get(normalizedModuleID)) });
  }
}

const runtime = new SkillShotRuntime();

module.exports = runtime;
module.exports.SkillShotRuntime = SkillShotRuntime;
module.exports.SKILL_SHOT_PROFILES = SKILL_SHOT_PROFILES;
module.exports.SKILL_SHOT_EFFECT_GUID = SKILL_SHOT_EFFECT_GUID;
module.exports.SKILL_SHOT_BEAM_RADIUS_METERS = SKILL_SHOT_BEAM_RADIUS_METERS;
module.exports.AUTO_FIRE_CONTRACT_MARKER = AUTO_FIRE_CONTRACT_MARKER;
module.exports.AUTO_FIRE_TERMINATED_KEY = AUTO_FIRE_TERMINATED_KEY;
module.exports.normalizeTurretStates = normalizeTurretStates;
module.exports.resolveCycleDurationMs = resolveCycleDurationMs;
