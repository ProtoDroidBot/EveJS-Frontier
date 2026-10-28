import {
  getDefaultSuiTurretPriorityResolver,
  TURRET_BEHAVIOUR_ENTERED,
  TURRET_BEHAVIOUR_STARTED_ATTACK,
  type SuiTurretPriorityEntry,
  type SuiTurretTargetCandidate,
} from "./suiTurretPriority";

const path = require("path");
const log = require(path.join(__dirname, "../../utils/logger"));
const itemStore = require(path.join(__dirname, "../inventory/itemStore"));
const characterState = require(path.join(__dirname, "../character/characterState"));
const { TABLE, readStaticRows } = require(path.join(__dirname, "../_shared/referenceData"));
const deploymentRuntime = require(path.join(__dirname, "./deploymentRuntime"));
const {
  buildWeaponModuleSnapshot,
  isTurretWeaponFamily,
  resolveWeaponFamily,
} = require(path.join(__dirname, "../../space/combat/weaponDogma"));
const {
  getTypeAttributeValue,
  isChargeCompatibleWithModule,
} = require(path.join(__dirname, "../fitting/liveFittingState"));

const SMART_TURRET_LOCK_DELAY_MS = 1_500;
const SMART_TURRET_PRIORITY_REFRESH_MS = 15_000;
const SMART_TURRET_PRIORITY_MAX_STALE_MS = 60_000;
const SMART_TURRET_AGGRESSION_TTL_MS = 5 * 60_000;
const SMART_TURRET_MAX_CANDIDATES = 32;
const SMART_TURRET_ERROR_LOG_INTERVAL_MS = 30_000;
const STRUCTURE_CATEGORY_ID = 65;
const DEFAULT_TRIBE_ID = 100;
const TYPE_FIELD_SENTRY = 96099;
const FIELD_SENTRY_BEHAVIOR_NAME = "2465";
const FIELD_SENTRY_GROUP_BEHAVIOR_ID = 2466;

const SPECIALIZED_GROUPS_BY_WEAPON = new Map([
  [92_402, new Set([31, 237])],
  [92_403, new Set([25, 420])],
  [92_511, new Set([26, 419])],
]);
const WEAPON_FAMILY_BY_SMART_TURRET = new Map([
  [92_402, "projectileTurret"],
  [92_403, "hybridTurret"],
  [92_511, "projectileTurret"],
]);

type SmartTurretWeaponProfile = {
  assemblyTypeID: number;
  weaponTypeID: number;
  chargeTypeID: number;
  optimalRange: number;
  falloffRange: number;
  engagementRange: number;
  snapshot: Record<string, any>;
  moduleItem: Record<string, any>;
  chargeItem: Record<string, any> | null;
};

type SmartTurretRuntimeState = {
  activeFitFingerprint: string | null;
  selectedTargetID: number | null;
  lockStartedAtMs: number;
  nextCycleAtMs: number;
  priorityFingerprint: string | null;
  priorityEntries: SuiTurretPriorityEntry[];
  priorityResolvedAtMs: number;
  priorityRequestedAtMs: number;
  pendingFingerprint: string | null;
  lastPriorityErrorLogAtMs: number;
};

let componentsByTypeID: Map<number, any> | null = null;
let itemTypes: any[] | null = null;
let weaponProfilesByFit = new Map<string, SmartTurretWeaponProfile | null>();
const aggressionByOwnerID = new Map<number, Map<number, number>>();
const activeAggressorsByEntityID = new Map<number, number>();
const aggressionByDefenderID = new Map<number, Map<number, number>>();

function toInt(value: unknown, fallback = 0): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.trunc(numeric) : fallback;
}

function toFiniteNumber(value: unknown, fallback = 0): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(toFiniteNumber(value, min), min), max);
}

function roundRatio(value: number): bigint {
  return BigInt(Math.round(clamp(value, 0, 100)));
}

function vectorDistance(left: any, right: any): number {
  if (!left || !right) return Number.POSITIVE_INFINITY;
  return Math.hypot(
    toFiniteNumber(left.x, 0) - toFiniteNumber(right.x, 0),
    toFiniteNumber(left.y, 0) - toFiniteNumber(right.y, 0),
    toFiniteNumber(left.z, 0) - toFiniteNumber(right.z, 0),
  );
}

function getComponentsByTypeID(): Map<number, any> {
  if (componentsByTypeID) return componentsByTypeID;
  componentsByTypeID = new Map();
  for (const row of readStaticRows(TABLE.SPACE_COMPONENTS_BY_TYPE) || []) {
    const typeID = toInt(row && (row.typeID ?? row._key), 0);
    if (typeID > 0) componentsByTypeID.set(typeID, row);
  }
  return componentsByTypeID;
}

function getItemTypes(): any[] {
  if (!itemTypes) itemTypes = [...(readStaticRows(TABLE.ITEM_TYPES) || [])];
  return itemTypes;
}

function getRuntimeInterop(): any {
  const runtime = require(path.join(__dirname, "../../space/runtime"));
  return runtime && runtime.smartTurretInterop || null;
}

function itemTypeMetadata(typeID: number): Record<string, any> {
  return itemStore.getItemMetadata(typeID) ||
    getItemTypes().find((row) => toInt(row && (row.typeID ?? row._key), 0) === typeID) ||
    { typeID };
}

function totalDamage(snapshot: any): number {
  const damage = snapshot && snapshot.rawShotDamage || {};
  return ["em", "thermal", "kinetic", "explosive"]
    .reduce((sum, key) => sum + Math.max(0, toFiniteNumber(damage[key], 0)), 0);
}

function buildWeaponSnapshot(
  assemblyTypeID: number,
  weaponTypeID: number,
  chargeTypeID: number,
): SmartTurretWeaponProfile | null {
  const hostMetadata = itemTypeMetadata(assemblyTypeID);
  const weaponMetadata = itemTypeMetadata(weaponTypeID);
  const chargeMetadata = chargeTypeID > 0 ? itemTypeMetadata(chargeTypeID) : null;
  const hostItem = {
    ...hostMetadata,
    itemID: assemblyTypeID,
    typeID: assemblyTypeID,
    categoryID: STRUCTURE_CATEGORY_ID,
    singleton: 1,
  };
  const moduleItem = {
    ...weaponMetadata,
    itemID: weaponTypeID,
    typeID: weaponTypeID,
    locationID: assemblyTypeID,
    flagID: 27,
    singleton: 1,
    weaponFamily: WEAPON_FAMILY_BY_SMART_TURRET.get(weaponTypeID) || undefined,
    ...(assemblyTypeID === TYPE_FIELD_SENTRY && weaponTypeID === TYPE_FIELD_SENTRY
      ? {
          weaponFamily: "projectileTurret",
          npcSyntheticHullWeapon: true,
        }
      : {}),
  };
  const chargeItem = chargeMetadata ? {
    ...chargeMetadata,
    itemID: chargeTypeID,
    typeID: chargeTypeID,
    locationID: weaponTypeID,
    flagID: 0,
    singleton: 0,
    stacksize: 1,
    quantity: 1,
  } : null;
  const snapshot = buildWeaponModuleSnapshot({
    characterID: 0,
    shipItem: hostItem,
    moduleItem,
    chargeItem,
    fittedItems: [],
    skillMap: new Map(),
    activeModuleContexts: [],
  });
  if (!snapshot || totalDamage(snapshot) <= 0) return null;
  const optimalRange = Math.max(0, toFiniteNumber(snapshot.optimalRange, 0));
  const falloffRange = Math.max(0, toFiniteNumber(snapshot.falloff, 0));
  const authoredTargetRange = assemblyTypeID === TYPE_FIELD_SENTRY
    ? Math.max(0, toFiniteNumber(getTypeAttributeValue(
        TYPE_FIELD_SENTRY,
        "maxTargetRange",
      ), 0))
    : 0;
  const engagementRange = Math.max(
    1,
    authoredTargetRange > 0
      ? Math.min(authoredTargetRange, optimalRange + (2 * falloffRange))
      : optimalRange + (2 * falloffRange),
  );
  return {
    assemblyTypeID,
    weaponTypeID,
    chargeTypeID,
    optimalRange,
    falloffRange,
    engagementRange,
    snapshot,
    moduleItem,
    chargeItem,
  };
}

function findDefaultChargeTypeID(weaponTypeID: number): number {
  const candidates: Array<{ typeID: number; damage: number }> = [];
  for (const row of getItemTypes()) {
    const typeID = toInt(row && (row.typeID ?? row._key), 0);
    if (typeID <= 0 || row.published === false || Number(row.published) === 0) continue;
    if (!isChargeCompatibleWithModule(weaponTypeID, typeID)) continue;
    const profile = buildWeaponSnapshot(weaponTypeID, weaponTypeID, typeID);
    if (!profile) continue;
    candidates.push({ typeID, damage: totalDamage(profile.snapshot) });
  }
  candidates.sort((left, right) => right.damage - left.damage || left.typeID - right.typeID);
  return candidates[0]?.typeID || 0;
}

function getTurretFittedItems(turretEntity: any): any[] {
  const items = Array.isArray(turretEntity?.fittedItems)
    ? turretEntity.fittedItems.filter(Boolean).map((item) => ({ ...item }))
    : [];
  try {
    items.push(...itemStore.listContainerItems(
      null,
      toInt(turretEntity?.itemID, 0),
      null,
    ));
  } catch (_) {
    // The live entity copy remains authoritative while inventory is unavailable.
  }
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = `${toInt(item?.itemID, 0)}:${toInt(item?.typeID, 0)}:${toInt(item?.flagID, 0)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function isTurretWeaponItem(item: any): boolean {
  const typeID = toInt(item?.typeID, 0);
  if (typeID <= 0) return false;
  const metadata = itemTypeMetadata(typeID);
  const family = WEAPON_FAMILY_BY_SMART_TURRET.get(typeID) || resolveWeaponFamily({
    ...metadata,
    ...item,
    typeID,
  });
  return Boolean(family && isTurretWeaponFamily(family));
}

function resolveFittedWeaponTypeID(turretEntity: any, component: any): number {
  if (toInt(turretEntity?.typeID, 0) === TYPE_FIELD_SENTRY) {
    return TYPE_FIELD_SENTRY;
  }
  const explicitWeaponTypeID = toInt(
    turretEntity?.fittedWeaponTypeID ||
      turretEntity?.weaponTypeID ||
      turretEntity?.smartTurret?.weaponTypeID,
    0,
  );
  if (explicitWeaponTypeID > 0) return explicitWeaponTypeID;
  const fittedWeapon = getTurretFittedItems(turretEntity)
    .filter(isTurretWeaponItem)
    .sort((left, right) => (
      toInt(left?.flagID, 0) - toInt(right?.flagID, 0) ||
      toInt(left?.itemID, 0) - toInt(right?.itemID, 0)
    ))[0];
  return toInt(fittedWeapon?.typeID, toInt(component?.smartTurret?.defaultTurret, 0));
}

function resolveFittedChargeTypeID(turretEntity: any, weaponTypeID: number): number {
  if (
    toInt(turretEntity?.typeID, 0) === TYPE_FIELD_SENTRY &&
    weaponTypeID === TYPE_FIELD_SENTRY
  ) {
    return 0;
  }
  const explicitChargeTypeID = toInt(
    turretEntity?.fittedChargeTypeID || turretEntity?.smartTurret?.chargeTypeID,
    0,
  );
  if (
    explicitChargeTypeID > 0 &&
    isChargeCompatibleWithModule(weaponTypeID, explicitChargeTypeID)
  ) {
    return explicitChargeTypeID;
  }
  const fittedItems = getTurretFittedItems(turretEntity);
  const moduleItem = fittedItems.find((item) => (
    toInt(item?.typeID, 0) === weaponTypeID && isTurretWeaponItem(item)
  ));
  const moduleFlagID = toInt(moduleItem?.flagID, 0);
  const fittedCharge = fittedItems.find((item) => (
    toInt(item?.itemID, 0) !== toInt(moduleItem?.itemID, 0) &&
    (moduleFlagID <= 0 || toInt(item?.flagID, 0) === moduleFlagID) &&
    isChargeCompatibleWithModule(weaponTypeID, toInt(item?.typeID, 0))
  ));
  return toInt(fittedCharge?.typeID, 0) || findDefaultChargeTypeID(weaponTypeID);
}

function getWeaponProfile(
  turretEntityOrAssemblyTypeID: any,
  componentOverride: any = null,
): SmartTurretWeaponProfile | null {
  const turretEntity = typeof turretEntityOrAssemblyTypeID === "number"
    ? { typeID: turretEntityOrAssemblyTypeID, itemID: 0 }
    : turretEntityOrAssemblyTypeID;
  const assemblyTypeID = toInt(turretEntity?.typeID, 0);
  const component = componentOverride || getComponentsByTypeID().get(assemblyTypeID);
  const weaponTypeID = resolveFittedWeaponTypeID(turretEntity, component);
  if (weaponTypeID <= 0) {
    return null;
  }
  const chargeTypeID = resolveFittedChargeTypeID(turretEntity, weaponTypeID);
  const cacheKey = `${assemblyTypeID}:${weaponTypeID}:${chargeTypeID}`;
  if (weaponProfilesByFit.has(cacheKey)) {
    return weaponProfilesByFit.get(cacheKey) || null;
  }
  const profile = buildWeaponSnapshot(assemblyTypeID, weaponTypeID, chargeTypeID);
  weaponProfilesByFit.set(cacheKey, profile);
  return profile;
}

function getState(entity: any): SmartTurretRuntimeState {
  if (!entity.smartTurretRuntimeState) {
    entity.smartTurretRuntimeState = {
      activeFitFingerprint: null,
      selectedTargetID: null,
      lockStartedAtMs: 0,
      nextCycleAtMs: 0,
      priorityFingerprint: null,
      priorityEntries: [],
      priorityResolvedAtMs: 0,
      priorityRequestedAtMs: 0,
      pendingFingerprint: null,
      lastPriorityErrorLogAtMs: 0,
    } satisfies SmartTurretRuntimeState;
  }
  return entity.smartTurretRuntimeState;
}

function getCharacterID(entity: any): number {
  if (!entity || entity.nativeNpc === true) return 0;
  return toInt(
    entity.pilotCharacterID || entity.characterID || entity.session?.characterID,
    0,
  );
}

function getCorporationID(entity: any): number {
  return toInt(
    entity?.corporationID || entity?.session?.corporationID || entity?.session?.corpid,
    0,
  );
}

function getOwnerCorporationID(ownerID: number): number {
  const record = ownerID > 0 ? characterState.getCharacterRecord(ownerID) : null;
  return toInt(record && (record.corporationID || record.corpid || record.corpID), 0);
}

function getCharacterTribeID(entity: any): number {
  const characterID = getCharacterID(entity);
  if (characterID <= 0) return 0;
  const record = characterState.getCharacterRecord(characterID);
  return Math.max(0, toInt(
    entity?.suiTribeId ||
      entity?.session?.suiTribeId ||
      record?.suiTribeId,
    0,
  ));
}

function getOwnerTribeID(ownerID: number): number {
  const record = ownerID > 0 ? characterState.getCharacterRecord(ownerID) : null;
  return Math.max(1, toInt(
    record?.suiTribeId || process.env.EVEJS_SUI_TRIBE_ID,
    DEFAULT_TRIBE_ID,
  ));
}

function getHealthRatios(entity: any, interop: any): { hp: number; shield: number; armor: number } {
  const maximum = interop.getEntityMaxHealthLayers(entity);
  const current = interop.getEntityCurrentHealthLayers(entity, maximum);
  const ratio = (layer: string) => {
    const max = Math.max(0, toFiniteNumber(maximum && maximum[layer], 0));
    if (max <= 0) return 0;
    return clamp((toFiniteNumber(current && current[layer], 0) / max) * 100, 0, 100);
  };
  return {
    hp: ratio("structure"),
    shield: ratio("shield"),
    armor: ratio("armor"),
  };
}

function pruneAggression(nowMs: number): void {
  for (const [attackerID, expiresAtMs] of activeAggressorsByEntityID) {
    if (expiresAtMs <= nowMs) activeAggressorsByEntityID.delete(attackerID);
  }
  for (const [ownerID, attackers] of aggressionByOwnerID) {
    for (const [attackerID, expiresAtMs] of attackers) {
      if (expiresAtMs <= nowMs) attackers.delete(attackerID);
    }
    if (attackers.size === 0) aggressionByOwnerID.delete(ownerID);
  }
  for (const [defenderID, attackers] of aggressionByDefenderID) {
    for (const [attackerID, expiresAtMs] of attackers) {
      if (expiresAtMs <= nowMs) attackers.delete(attackerID);
    }
    if (attackers.size === 0) aggressionByDefenderID.delete(defenderID);
  }
}

function isAggressor(ownerID: number, attackerID: number, nowMs: number): boolean {
  return toFiniteNumber(aggressionByOwnerID.get(ownerID)?.get(attackerID), 0) > nowMs;
}

function isActiveAggressor(attackerID: number, nowMs: number): boolean {
  return toFiniteNumber(activeAggressorsByEntityID.get(attackerID), 0) > nowMs;
}

function isDefenderAggressor(
  defenderID: number,
  attackerID: number,
  nowMs: number,
): boolean {
  return toFiniteNumber(
    aggressionByDefenderID.get(defenderID)?.get(attackerID),
    0,
  ) > nowMs;
}

function buildCandidate(
  turretEntity: any,
  targetEntity: any,
  profile: SmartTurretWeaponProfile,
  nowMs: number,
  interop: any,
): { candidate: SuiTurretTargetCandidate; distance: number } | null {
  if (!targetEntity || targetEntity === turretEntity || !interop.hasDamageableHealth(targetEntity)) {
    return null;
  }
  const ownerID = toInt(turretEntity.ownerID, 0);
  const targetOwnerID = toInt(targetEntity.ownerID, 0);
  const targetCharacterID = getCharacterID(targetEntity);
  if (
    toInt(targetEntity.itemID, 0) <= 0 ||
    targetOwnerID === ownerID ||
    (targetCharacterID > 0 && targetCharacterID === ownerID)
  ) {
    return null;
  }
  const distance = Math.max(
    0,
    vectorDistance(turretEntity.position, targetEntity.position) -
      Math.max(0, toFiniteNumber(turretEntity.radius, 0)) -
      Math.max(0, toFiniteNumber(targetEntity.radius, 0)),
  );
  if (!Number.isFinite(distance) || distance > profile.engagementRange) return null;
  const ratios = getHealthRatios(targetEntity, interop);
  const distanceBucket = Math.floor(distance / 5_000) * 5_000;
  const rangeWeight = Math.round(
    (1 - clamp(distanceBucket / profile.engagementRange, 0, 1)) * 1_000,
  );
  const averageHealth = (ratios.hp + ratios.shield + ratios.armor) / 3;
  const vulnerabilityWeight = Math.round((100 - averageHealth) * 10);
  const targetGroupID = toInt(targetEntity.groupID, 0);
  const specializationWeight = SPECIALIZED_GROUPS_BY_WEAPON
    .get(profile.weaponTypeID)?.has(targetGroupID) ? 2_500 : 0;
  const targetItemID = toInt(targetEntity.itemID, 0);
  const baseAggressor = isAggressor(ownerID, targetItemID, nowMs);
  const aggressor = isActiveAggressor(targetItemID, nowMs);
  const ownerCorporationID = getOwnerCorporationID(ownerID);
  const targetCorporationID = getCorporationID(targetEntity);
  const knownTargetTribeID = getCharacterTribeID(targetEntity);
  const characterTribe = knownTargetTribeID > 0
    ? knownTargetTribeID
    : targetCharacterID > 0 && ownerCorporationID > 0 &&
        targetCorporationID === ownerCorporationID
      ? getOwnerTribeID(ownerID)
      : 0;
  return {
    distance,
    candidate: {
      item_id: BigInt(toInt(targetEntity.itemID, 0)),
      type_id: BigInt(Math.max(0, toInt(targetEntity.typeID, 0))),
      group_id: BigInt(Math.max(0, targetGroupID)),
      character_id: Math.max(0, targetCharacterID),
      character_tribe: characterTribe,
      hp_ratio: roundRatio(ratios.hp),
      shield_ratio: roundRatio(ratios.shield),
      armor_ratio: roundRatio(ratios.armor),
      is_aggressor: aggressor,
      priority_weight: BigInt(Math.max(
        0,
        rangeWeight + vulnerabilityWeight + specializationWeight,
      )),
      // The on-chain default policy treats ENTERED and STARTED_ATTACK as
      // persistent eligibility/weight classes. Candidate-set fingerprints
      // prevent repeated requests while that class is unchanged.
      behaviour_change: baseAggressor
        ? TURRET_BEHAVIOUR_STARTED_ATTACK
        : TURRET_BEHAVIOUR_ENTERED,
    },
  };
}

function candidateFingerprint(candidates: SuiTurretTargetCandidate[]): string {
  return JSON.stringify(candidates.map((candidate) => [
    candidate.item_id.toString(),
    candidate.type_id.toString(),
    candidate.group_id.toString(),
    candidate.character_id,
    candidate.character_tribe,
    Number(candidate.hp_ratio) - (Number(candidate.hp_ratio) % 10),
    Number(candidate.shield_ratio) - (Number(candidate.shield_ratio) % 10),
    Number(candidate.armor_ratio) - (Number(candidate.armor_ratio) % 10),
    candidate.is_aggressor,
    candidate.priority_weight.toString(),
    candidate.behaviour_change,
  ]));
}

function collectCandidates(
  scene: any,
  turretEntity: any,
  profile: SmartTurretWeaponProfile,
  nowMs: number,
  interop: any,
): SuiTurretTargetCandidate[] {
  const candidates: Array<{ candidate: SuiTurretTargetCandidate; distance: number }> = [];
  for (const entity of scene.dynamicEntities?.values?.() || []) {
    const candidate = buildCandidate(turretEntity, entity, profile, nowMs, interop);
    if (candidate) candidates.push(candidate);
  }
  candidates.sort((left, right) => (
    Number(right.candidate.is_aggressor) - Number(left.candidate.is_aggressor) ||
    Number(right.candidate.priority_weight - left.candidate.priority_weight) ||
    left.distance - right.distance ||
    Number(left.candidate.item_id - right.candidate.item_id)
  ));
  return candidates.slice(0, SMART_TURRET_MAX_CANDIDATES).map(({ candidate }) => candidate);
}

function clearTarget(scene: any, turretEntity: any, state: SmartTurretRuntimeState, nowMs: number): void {
  if (typeof scene.clearOutgoingTargetLocks === "function") {
    scene.clearOutgoingTargetLocks(turretEntity, {
      notifySelf: false,
      notifyTarget: true,
      nowMs,
    });
  }
  state.selectedTargetID = null;
  state.lockStartedAtMs = 0;
}

function normalizePriorityEntries(
  entries: SuiTurretPriorityEntry[],
  candidates: SuiTurretTargetCandidate[],
): SuiTurretPriorityEntry[] {
  const allowed = new Set(candidates.map((candidate) => candidate.item_id.toString()));
  const seen = new Set<string>();
  return (Array.isArray(entries) ? entries : [])
    .filter((entry) => {
      const itemID = entry?.target_item_id?.toString?.() || "";
      if (!allowed.has(itemID) || seen.has(itemID)) return false;
      seen.add(itemID);
      return true;
    })
    .sort((left, right) => (
      left.priority_weight > right.priority_weight ? -1 :
        left.priority_weight < right.priority_weight ? 1 : 0
    ));
}

function queuePriorityResolution(
  turretEntity: any,
  candidates: SuiTurretTargetCandidate[],
  fingerprint: string,
  nowMs: number,
  resolver: any,
): void {
  const state = getState(turretEntity);
  if (state.pendingFingerprint === fingerprint) return;
  state.pendingFingerprint = fingerprint;
  state.priorityRequestedAtMs = nowMs;
  Promise.resolve(resolver.resolve({
    turretItemID: toInt(turretEntity.itemID, 0),
    ownerCharacterID: toInt(turretEntity.ownerID, 0),
    candidates,
  })).then((entries: SuiTurretPriorityEntry[]) => {
    if (state.pendingFingerprint !== fingerprint) return;
    state.priorityFingerprint = fingerprint;
    state.priorityEntries = normalizePriorityEntries(entries, candidates);
    state.priorityResolvedAtMs = nowMs;
    state.pendingFingerprint = null;
  }).catch((error: any) => {
    if (state.pendingFingerprint === fingerprint) state.pendingFingerprint = null;
    const wallclockNowMs = Date.now();
    if (wallclockNowMs - state.lastPriorityErrorLogAtMs >= SMART_TURRET_ERROR_LOG_INTERVAL_MS) {
      state.lastPriorityErrorLogAtMs = wallclockNowMs;
      log.warn(
        `[SmartTurret] Sui priority evaluation failed item=${turretEntity.itemID}: ` +
          `${error && error.message || error}`,
      );
    }
  });
}

function ensureTargetLock(
  scene: any,
  turretEntity: any,
  targetEntity: any,
  state: SmartTurretRuntimeState,
  nowMs: number,
  lockDelayMs = SMART_TURRET_LOCK_DELAY_MS,
): boolean {
  const targetID = toInt(targetEntity?.itemID, 0);
  if (targetID <= 0) return false;
  if (state.selectedTargetID !== targetID) {
    clearTarget(scene, turretEntity, state, nowMs);
    state.selectedTargetID = targetID;
    state.lockStartedAtMs = nowMs;
    return false;
  }
  if (turretEntity.lockedTargets instanceof Map && turretEntity.lockedTargets.has(targetID)) {
    return true;
  }
  const normalizedLockDelayMs = Math.max(0, toFiniteNumber(lockDelayMs, 0));
  if (nowMs - state.lockStartedAtMs < normalizedLockDelayMs) return false;
  if (typeof scene.finalizeTargetLock !== "function") return false;
  const pendingLock = {
    targetID,
    sequence: typeof scene.allocateTargetSequence === "function"
      ? scene.allocateTargetSequence()
      : 1,
    requestedAtMs: state.lockStartedAtMs,
    completeAtMs: state.lockStartedAtMs + normalizedLockDelayMs,
    totalDurationMs: normalizedLockDelayMs,
  };
  const result = scene.finalizeTargetLock(turretEntity, targetEntity, {
    pendingLock,
    nowMs,
  });
  if (!result?.success) {
    state.lockStartedAtMs = nowMs;
    return false;
  }
  return true;
}

function isFieldSentryComponent(entity: any, componentOverride: any = null): boolean {
  if (!entity || toInt(entity.typeID, 0) !== TYPE_FIELD_SENTRY) return false;
  const component = componentOverride || getComponentsByTypeID().get(TYPE_FIELD_SENTRY);
  const behaviorName = String(
    entity.fieldSentryBehaviorName ?? component?.behavior?.behaviorName ?? "",
  );
  const groupBehaviorID = toInt(
    entity.fieldSentryGroupBehaviorID ?? component?.behavior?.groupBehaviorID,
    0,
  );
  return Boolean(
    entity.kind === "deployable" &&
    behaviorName === FIELD_SENTRY_BEHAVIOR_NAME &&
    groupBehaviorID === FIELD_SENTRY_GROUP_BEHAVIOR_ID,
  );
}

function collectFieldSentryCandidates(
  scene: any,
  sentryEntity: any,
  profile: SmartTurretWeaponProfile,
  nowMs: number,
  interop: any,
): SuiTurretTargetCandidate[] {
  const sentryID = toInt(sentryEntity?.itemID, 0);
  const protectedShipID = toInt(
    sentryEntity?.launchBayPayloadState?.sourceShipID,
    0,
  );
  return collectCandidates(scene, sentryEntity, profile, nowMs, interop)
    .filter((candidate) => {
      const attackerID = Number(candidate.item_id);
      return (
        isDefenderAggressor(sentryID, attackerID, nowMs) ||
        (protectedShipID > 0 &&
          isDefenderAggressor(protectedShipID, attackerID, nowMs))
      );
    });
}

function tickFieldSentry(
  scene: any,
  sentryEntity: any,
  nowMs: number,
  options: Record<string, any> = {},
): boolean {
  const state = getState(sentryEntity);
  const component = options.component || getComponentsByTypeID().get(TYPE_FIELD_SENTRY);
  if (
    !isFieldSentryComponent(sentryEntity, component) ||
    (toFiniteNumber(sentryEntity.expiresAtMs, 0) > 0 &&
      toFiniteNumber(sentryEntity.expiresAtMs, 0) <= nowMs)
  ) {
    clearTarget(scene, sentryEntity, state, nowMs);
    return false;
  }
  const profile = options.profile || getWeaponProfile(sentryEntity, component);
  const interop = options.interop || getRuntimeInterop();
  if (!profile || !interop) {
    clearTarget(scene, sentryEntity, state, nowMs);
    return false;
  }
  const fitFingerprint = `${profile.weaponTypeID}:${profile.chargeTypeID}`;
  if (state.activeFitFingerprint !== fitFingerprint) {
    state.activeFitFingerprint = fitFingerprint;
    state.nextCycleAtMs = 0;
  }
  sentryEntity.maxTargetRange = profile.engagementRange;
  sentryEntity.smartTurretOptimalRange = profile.optimalRange;
  sentryEntity.smartTurretFalloffRange = profile.falloffRange;
  sentryEntity.smartTurretEngagementRange = profile.engagementRange;
  sentryEntity.activeSmartTurretWeaponTypeID = profile.weaponTypeID;
  sentryEntity.maxLockedTargets = 1;
  sentryEntity.scanResolution = Math.max(
    1,
    toFiniteNumber(
      getTypeAttributeValue(TYPE_FIELD_SENTRY, "scanResolution"),
      toFiniteNumber(sentryEntity.scanResolution, 1),
    ),
  );
  sentryEntity.pilotCharacterID = toInt(sentryEntity.ownerID, 0);
  sentryEntity.corporationID = getOwnerCorporationID(
    toInt(sentryEntity.ownerID, 0),
  );
  const candidates = options.candidates || collectFieldSentryCandidates(
    scene,
    sentryEntity,
    profile,
    nowMs,
    interop,
  );
  const selected = candidates[0] || null;
  const targetEntity = selected
    ? scene.getEntityByID?.(Number(selected.item_id))
    : null;
  if (!targetEntity) {
    clearTarget(scene, sentryEntity, state, nowMs);
    return true;
  }
  const lockDelayMs = Math.max(
    0,
    toFiniteNumber(getTypeAttributeValue(TYPE_FIELD_SENTRY, "scanSpeed"), 0),
  );
  if (!ensureTargetLock(
    scene,
    sentryEntity,
    targetEntity,
    state,
    nowMs,
    lockDelayMs,
  )) {
    return true;
  }
  fireTurret(scene, sentryEntity, targetEntity, profile, state, nowMs, interop);
  return true;
}

function fireTurret(
  scene: any,
  turretEntity: any,
  targetEntity: any,
  profile: SmartTurretWeaponProfile,
  state: SmartTurretRuntimeState,
  nowMs: number,
  interop: any,
): void {
  if (nowMs < state.nextCycleAtMs) return;
  const snapshot = profile.snapshot;
  const shotResult = interop.resolveTurretShot({
    attackerEntity: turretEntity,
    targetEntity,
    weaponSnapshot: snapshot,
  });
  if (snapshot.effectGUID && typeof scene.broadcastSpecialFx === "function") {
    scene.broadcastSpecialFx(turretEntity.itemID, snapshot.effectGUID, {
      moduleID: turretEntity.itemID,
      moduleTypeID: profile.weaponTypeID,
      targetID: targetEntity.itemID,
      weaponFamily: snapshot.family,
      isOffensive: true,
      start: true,
      active: false,
      duration: snapshot.durationMs,
      repeat: 1,
      useCurrentVisibleStamp: true,
      avoidCurrentHistoryInsertion: true,
    }, turretEntity);
  }
  let weaponDamageResult: any = null;
  let damageResult: any = null;
  let destroyResult: any = null;
  if (shotResult?.hit === true) {
    weaponDamageResult = interop.applyWeaponDamageToTarget(
      scene,
      turretEntity,
      targetEntity,
      shotResult.shotDamage,
      nowMs,
    );
    damageResult = weaponDamageResult?.damageResult || null;
    destroyResult = weaponDamageResult?.destroyResult || null;
    const damageTargetEntity = weaponDamageResult?.impactTargetEntity || targetEntity;
    const appliedDamage = interop.getAppliedDamageAmount(damageResult);
    if (appliedDamage > 0) {
      interop.noteKillmailDamage(turretEntity, damageTargetEntity, appliedDamage, {
        whenMs: nowMs,
        weaponSnapshot: snapshot,
        moduleItem: profile.moduleItem,
        chargeItem: profile.chargeItem,
      });
    }
    if (destroyResult?.success === true) {
      interop.recordKillmailFromDestruction(damageTargetEntity, destroyResult, {
        attackerEntity: turretEntity,
        victimSession: weaponDamageResult?.victimSession,
        whenMs: nowMs,
        weaponSnapshot: snapshot,
        moduleItem: profile.moduleItem,
        chargeItem: profile.chargeItem,
      });
    }
  }
  interop.notifyWeaponDamageMessages(
    turretEntity,
    weaponDamageResult?.impactTargetEntity || targetEntity,
    profile.moduleItem,
    shotResult?.shotDamage,
    interop.getAppliedDamageAmount(damageResult),
    interop.getCombatMessageHitQuality(shotResult),
    {
      suppress: Boolean(weaponDamageResult?.occlusion && !weaponDamageResult?.damageResult),
    },
  );
  state.nextCycleAtMs = nowMs + Math.max(1, toFiniteNumber(snapshot.durationMs, 1_000));
  if (destroyResult?.success === true) clearTarget(scene, turretEntity, state, nowMs);
}

function isOnlineSmartTurret(entity: any, componentOverride: any = null): boolean {
  const component = componentOverride ||
    getComponentsByTypeID().get(toInt(entity?.typeID, 0));
  return Boolean(
    entity &&
    entity.kind === "deployable" &&
    component?.smartTurret &&
    toInt(entity.assembly_status, 0) === deploymentRuntime.ASSEMBLY_STATUS_ONLINE &&
    (!Array.isArray(entity.component_activate) || entity.component_activate[0] === true),
  );
}

function tickTurret(
  scene: any,
  turretEntity: any,
  nowMs: number,
  options: Record<string, any> = {},
): boolean {
  const state = getState(turretEntity);
  if (!isOnlineSmartTurret(turretEntity, options.component)) {
    clearTarget(scene, turretEntity, state, nowMs);
    return false;
  }
  const profile = options.profile || getWeaponProfile(turretEntity, options.component);
  const interop = options.interop || getRuntimeInterop();
  if (!profile || !interop) {
    clearTarget(scene, turretEntity, state, nowMs);
    return false;
  }
  const fitFingerprint = `${profile.weaponTypeID}:${profile.chargeTypeID}`;
  if (state.activeFitFingerprint !== fitFingerprint) {
    state.activeFitFingerprint = fitFingerprint;
    state.nextCycleAtMs = 0;
  }
  turretEntity.maxTargetRange = profile.engagementRange;
  turretEntity.smartTurretOptimalRange = profile.optimalRange;
  turretEntity.smartTurretFalloffRange = profile.falloffRange;
  turretEntity.smartTurretEngagementRange = profile.engagementRange;
  turretEntity.activeSmartTurretWeaponTypeID = profile.weaponTypeID;
  turretEntity.maxLockedTargets = 1;
  turretEntity.scanResolution = Math.max(1, toFiniteNumber(turretEntity.scanResolution, 1_000));
  turretEntity.pilotCharacterID = toInt(turretEntity.ownerID, 0);
  turretEntity.corporationID = getOwnerCorporationID(toInt(turretEntity.ownerID, 0));
  const candidates = options.candidates || collectCandidates(
    scene,
    turretEntity,
    profile,
    nowMs,
    interop,
  );
  const fingerprint = `${fitFingerprint}:${candidateFingerprint(candidates)}`;
  if (candidates.length === 0) {
    clearTarget(scene, turretEntity, state, nowMs);
    state.priorityFingerprint = fingerprint;
    state.priorityEntries = [];
    state.priorityResolvedAtMs = nowMs;
    return true;
  }
  const resolver = options.priorityResolver || getDefaultSuiTurretPriorityResolver();
  const sameFingerprint = state.priorityFingerprint === fingerprint;
  const priorityAgeMs = nowMs - state.priorityResolvedAtMs;
  if (!sameFingerprint || priorityAgeMs >= SMART_TURRET_PRIORITY_REFRESH_MS) {
    queuePriorityResolution(turretEntity, candidates, fingerprint, nowMs, resolver);
  }
  if (!sameFingerprint || priorityAgeMs > SMART_TURRET_PRIORITY_MAX_STALE_MS) {
    clearTarget(scene, turretEntity, state, nowMs);
    return true;
  }
  const selected = state.priorityEntries[0] || null;
  const targetEntity = selected
    ? scene.getEntityByID?.(Number(selected.target_item_id))
    : null;
  if (!targetEntity) {
    clearTarget(scene, turretEntity, state, nowMs);
    return true;
  }
  if (!ensureTargetLock(scene, turretEntity, targetEntity, state, nowMs)) return true;
  fireTurret(scene, turretEntity, targetEntity, profile, state, nowMs, interop);
  return true;
}

function tickScene(scene: any, nowMs = Date.now(), options: Record<string, any> = {}) {
  if (!scene || !(scene.dynamicEntities instanceof Map)) return { turretCount: 0 };
  pruneAggression(nowMs);
  let turretCount = 0;
  for (const entity of scene.dynamicEntities.values()) {
    const component = getComponentsByTypeID().get(toInt(entity?.typeID, 0));
    if (component?.smartTurret) {
      turretCount += 1;
      tickTurret(scene, entity, nowMs, options);
    } else if (isFieldSentryComponent(entity, component)) {
      turretCount += 1;
      tickFieldSentry(scene, entity, nowMs, {
        ...options,
        component,
      });
    }
  }
  return { turretCount };
}

function noteIncomingAggression(attackerEntity: any, targetEntity: any, nowMs = Date.now()): boolean {
  const attackerID = toInt(attackerEntity?.itemID, 0);
  if (attackerID <= 0 || !targetEntity || attackerID === toInt(targetEntity.itemID, 0)) return false;
  const normalizedNowMs = toFiniteNumber(nowMs, Date.now());
  activeAggressorsByEntityID.set(
    attackerID,
    normalizedNowMs + SMART_TURRET_AGGRESSION_TTL_MS,
  );
  const defenderID = toInt(targetEntity.itemID, 0);
  let defenderAggressors = aggressionByDefenderID.get(defenderID);
  if (!defenderAggressors) {
    defenderAggressors = new Map();
    aggressionByDefenderID.set(defenderID, defenderAggressors);
  }
  defenderAggressors.set(
    attackerID,
    normalizedNowMs + SMART_TURRET_AGGRESSION_TTL_MS,
  );
  const item = itemStore.findItemById(toInt(targetEntity.itemID, 0));
  const construction = deploymentRuntime.readConstructionState(item);
  const component = getComponentsByTypeID().get(toInt(construction?.assemblyTypeID, 0));
  const ownerID = toInt(item?.ownerID, 0);
  if (
    ownerID <= 0 ||
    ownerID === toInt(attackerEntity.ownerID, 0) ||
    !component?.smartDeployable ||
    !construction ||
    construction.assemblyStatus === deploymentRuntime.ASSEMBLY_STATUS_UNDER_CONSTRUCTION
  ) {
    return true;
  }
  let attackers = aggressionByOwnerID.get(ownerID);
  if (!attackers) {
    attackers = new Map();
    aggressionByOwnerID.set(ownerID, attackers);
  }
  attackers.set(attackerID, normalizedNowMs + SMART_TURRET_AGGRESSION_TTL_MS);
  return true;
}

function clearCaches(): void {
  componentsByTypeID = null;
  itemTypes = null;
  weaponProfilesByFit = new Map();
  aggressionByOwnerID.clear();
  activeAggressorsByEntityID.clear();
  aggressionByDefenderID.clear();
}

module.exports = {
  noteIncomingAggression,
  tickScene,
  _testing: {
    SMART_TURRET_AGGRESSION_TTL_MS,
    SMART_TURRET_LOCK_DELAY_MS,
    buildCandidate,
    candidateFingerprint,
    clearCaches,
    collectCandidates,
    collectFieldSentryCandidates,
    getState,
    getWeaponProfile,
    isOnlineSmartTurret,
    isFieldSentryComponent,
    normalizePriorityEntries,
    resolveFittedWeaponTypeID,
    tickTurret,
    tickFieldSentry,
  },
};
