"use strict";

const path = require("path");

const database = require(path.join(__dirname, "../../gameStore"));
const itemStore = require(path.join(__dirname, "../../services/inventory/itemStore"));
const fitting = require(path.join(__dirname, "../../services/fitting/liveFittingState"));
const { resolveItemByTypeID } = require(path.join(
  __dirname,
  "../../services/inventory/itemTypeRegistry",
));
const {
  getCreationModule,
} = require(path.join(__dirname, "../../services/frontier/creationStaticData"));
const {
  getHeldBeamUtilityProfile,
} = require(path.join(__dirname, "../../services/frontier/skillShotUtilityRuntime"));
const {
  isMiningEffectRecord,
} = require(path.join(__dirname, "../../services/mining/miningDogma"));
const {
  resolveWeaponFamily,
} = require(path.join(__dirname, "../combat/weaponDogma"));
const nativeNpcStore = require("./nativeNpcStore");
const persistence = require("./npcRuntimePersistence");
const npcCapabilityResolver = require("./npcCapabilityResolver");
const npcFactionConfig = require(path.join(__dirname, "../../config/npcFactionConfig"));

const CUSTODY_SCHEMA_VERSION = 1;
const MODULE_CATEGORY_ID = 7;
const CHARGE_CATEGORY_ID = 8;
const SHIP_CATEGORY_ID = 6;
const NPC_ENTITY_CATEGORY_ID = 11;
const TERMINAL_OPERATION_STATUSES = new Set(["committed", "compensated", "failed"]);
const SEMANTIC_ROLES = Object.freeze([
  "weapon",
  "ammunition",
  "fuel",
  "remote_repair",
  "self_repair",
  "hostile_utility",
  "mining",
  "salvage",
  "tractor",
  "scanner",
  "cloak",
  "propulsion",
  "jump_drive",
  "passive",
]);
const CREATION_CAPABILITY_ROLE = Object.freeze({
  weapon: "weapon",
  repair: "self_repair",
  propulsion: "propulsion",
  scanning: "scanner",
});
const CREATION_SYSTEM_ROLE = Object.freeze({
  propulsion: "propulsion",
});

function cloneValue(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function toPositiveInt(value, fallback = 0) {
  const numeric = Math.trunc(Number(value) || 0);
  return numeric > 0 ? numeric : fallback;
}

function toFiniteNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function normalizeRoleToken(value) {
  return String(value || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function normalizeEffectNames(effectRecords) {
  return (Array.isArray(effectRecords) ? effectRecords : [])
    .flatMap((effect) => [
      effect && effect.effectName,
      effect && effect.name,
      effect && effect.displayName,
    ])
    .map(normalizeRoleToken)
    .filter(Boolean);
}

function hasAnyToken(tokens, fragments) {
  return tokens.some((token) => fragments.some((fragment) => token.includes(fragment)));
}

function normalizeSemanticRoles(value) {
  return [...new Set(
    (Array.isArray(value) ? value : [value])
      .map((role) => String(role || "").trim().toLowerCase())
      .filter((role) => SEMANTIC_ROLES.includes(role)),
  )];
}

function buildCreationModuleProfile(creationModule) {
  if (!creationModule || typeof creationModule !== "object") return null;
  const placement = creationModule.placement && typeof creationModule.placement === "object"
    ? creationModule.placement
    : {};
  const rawHardpoints = Array.isArray(placement.hardpoints)
    ? placement.hardpoints
    : creationModule.hardpoints;
  const rawCompatibleHardpoints = Array.isArray(placement.compatible_hardpoints)
    ? placement.compatible_hardpoints
    : creationModule.compatibleHardpoints;
  return {
    behavior: String(creationModule.behavior || "generic").trim() || "generic",
    capability: String(creationModule.capability || "").trim() || null,
    system: String(creationModule.system || "").trim() || null,
    hardpoints: Array.isArray(rawHardpoints)
      ? rawHardpoints.map((value) => String(value || "").trim()).filter(Boolean)
      : [],
    compatibleHardpoints: Array.isArray(rawCompatibleHardpoints)
      ? rawCompatibleHardpoints
        .map((value) => String(value || "").trim())
        .filter(Boolean)
      : [],
    mustBeInRoot:
      Number(placement.must_be_in_root) === 1 || creationModule.mustBeInRoot === true,
  };
}

/**
 * Resolve every behavior capability of a module without collapsing a
 * multi-purpose tool into a single label. `semanticRole` remains the primary
 * fitting-policy role for backwards compatibility; selectors should use
 * `semanticRoles` when they need a particular behavior capability.
 */
function resolveNpcEquipmentProfile(item, dependencies: Record<string, any> = {}) {
  const typeID = toPositiveInt(item && item.typeID, 0);
  if (!typeID) {
    return {
      semanticRole: null,
      semanticRoles: [],
      equipmentArchitecture: "unknown",
      activationMode: "dogma",
      creationModuleProfile: null,
      capabilitySources: [],
    };
  }
  const resolveEffects = typeof dependencies.getTypeEffectRecords === "function"
    ? dependencies.getTypeEffectRecords
    : fitting.getTypeEffectRecords;
  const resolveCreation = typeof dependencies.getCreationModule === "function"
    ? dependencies.getCreationModule
    : getCreationModule;
  const resolveHeldBeam = typeof dependencies.getHeldBeamUtilityProfile === "function"
    ? dependencies.getHeldBeamUtilityProfile
    : getHeldBeamUtilityProfile;
  const resolveWeapon = typeof dependencies.resolveWeaponFamily === "function"
    ? dependencies.resolveWeaponFamily
    : resolveWeaponFamily;
  const resolveMiningEffect = typeof dependencies.isMiningEffectRecord === "function"
    ? dependencies.isMiningEffectRecord
    : isMiningEffectRecord;
  const effectRecords = resolveEffects(typeID) || [];
  const creationModule = resolveCreation(typeID) || item && item.creationModuleProfile || null;
  const creationModuleProfile = buildCreationModuleProfile(creationModule);
  const heldBeamProfile = resolveHeldBeam(typeID);
  const metadata = resolveItemByTypeID(typeID) || item || {};
  const tokens = [
    ...normalizeEffectNames(effectRecords),
    normalizeRoleToken(metadata.groupName),
    normalizeRoleToken(metadata.name || item && item.itemName),
  ].filter(Boolean);
  const roles: string[] = [];
  const capabilitySources: string[] = [];
  const addRole = (role, source) => {
    const normalizedRole = String(role || "").trim().toLowerCase();
    if (!SEMANTIC_ROLES.includes(normalizedRole)) return;
    if (!roles.includes(normalizedRole)) roles.push(normalizedRole);
    if (source && !capabilitySources.includes(source)) capabilitySources.push(source);
  };

  if (
    npcCapabilityResolver.resolveNpcPropulsionEffectName(item) ||
    hasAnyToken(tokens, ["afterburner", "microwarpdrive", "propulsion"])
  ) addRole("propulsion", "dogma:propulsion");
  if (hasAnyToken(tokens, ["jumpdrive", "jumpportal", "microjump"])) {
    addRole("jump_drive", "dogma:jump-drive");
  }
  if (hasAnyToken(tokens, ["cloaking", "cloak"])) addRole("cloak", "dogma:cloak");
  // Do not match the substring "tractor" inside "extractor".
  if (hasAnyToken(tokens, ["tractorbeam"])) addRole("tractor", "dogma:tractor");
  if (hasAnyToken(tokens, ["salvaging", "salvager", "salvage"])) {
    addRole("salvage", "dogma:salvage");
  }
  const authoredMiningEffect = effectRecords.some((effectRecord) => (
    resolveMiningEffect(effectRecord, item)
  ));
  const attributeOnlyMining = effectRecords.length === 0 && resolveMiningEffect(null, item);
  const miningCapable = Boolean(
    heldBeamProfile ||
    authoredMiningEffect ||
    attributeOnlyMining ||
    hasAnyToken(tokens, ["mining", "harvest", "extractor", "excavation"]),
  );
  if (miningCapable) {
    addRole(
      "mining",
      heldBeamProfile
        ? "frontier:held-beam-extraction"
        : authoredMiningEffect
          ? "dogma:mining-effect"
          : "dogma:mining-attribute",
    );
  }
  if (hasAnyToken(tokens, [
    "remotearmorrepair",
    "remoteshield",
    "shieldtransport",
    "energytransfer",
    "remotehullrepair",
  ])) addRole("remote_repair", "dogma:remote-repair");
  if (hasAnyToken(tokens, [
    "armorrepair",
    "shieldboost",
    "hullrepair",
    "ancillaryshield",
  ])) addRole("self_repair", "dogma:self-repair");
  if (hasAnyToken(tokens, [
    "warpdisrupt",
    "warpscram",
    "stasisweb",
    "energyneutral",
    "nosferatu",
    "targetpaint",
    "sensordamp",
    "trackingdisrupt",
    "ecm",
    "jammer",
  ])) addRole("hostile_utility", "dogma:hostile-utility");
  const weaponFamily = resolveWeapon(item, null);
  const combatCapable = Boolean(
    (weaponFamily ||
      fitting.typeHasEffectName(typeID, "targetAttack") ||
      fitting.typeHasEffectName(typeID, "turretFitted") ||
      fitting.typeHasEffectName(typeID, "launcherFitted") ||
      hasAnyToken(tokens, ["targetattack", "turretfitted", "launcherfitted", "weapon"])) &&
    (!heldBeamProfile || heldBeamProfile.allowsCombatDamage === true),
  );
  if (combatCapable) {
    addRole("weapon", weaponFamily ? `combat:${weaponFamily}` : "dogma:weapon");
  }
  if (hasAnyToken(tokens, [
    "scanner",
    "scanning",
    "survey",
    "scanprobe",
    "cargoscanner",
    "shipscanner",
  ])) addRole("scanner", "dogma:scanner");

  if (creationModuleProfile) {
    const creationCapability = normalizeRoleToken(creationModuleProfile.capability);
    const creationSystem = normalizeRoleToken(creationModuleProfile.system);
    const capabilityRole = CREATION_CAPABILITY_ROLE[creationCapability];
    const systemRole = CREATION_SYSTEM_ROLE[creationSystem];
    if (
      capabilityRole &&
      !(capabilityRole === "weapon" && heldBeamProfile && heldBeamProfile.allowsCombatDamage !== true)
    ) {
      addRole(capabilityRole, `creation:${creationCapability}`);
    }
    if (systemRole) addRole(systemRole, `creation-system:${creationSystem}`);
    if (roles.length === 0) addRole("passive", "creation:modular");
  }

  if (roles.length === 0 && fitting.getRequiredSlotFamily(typeID)) {
    addRole("passive", "dogma:fitted-passive");
  }

  let semanticRole = roles[0] || null;
  if (miningCapable && combatCapable) {
    // Dual-use extraction weapons retain their combat policy boundary. This
    // prevents a hull/faction that denies weapons from accepting one merely
    // because it can also mine.
    semanticRole = "weapon";
  } else if (miningCapable && heldBeamProfile && heldBeamProfile.allowsCombatDamage !== true) {
    semanticRole = "mining";
  } else if (creationModuleProfile) {
    const authoredRole = CREATION_CAPABILITY_ROLE[
      normalizeRoleToken(creationModuleProfile.capability)
    ] || CREATION_SYSTEM_ROLE[normalizeRoleToken(creationModuleProfile.system)];
    if (authoredRole && roles.includes(authoredRole)) semanticRole = authoredRole;
  }

  return {
    semanticRole,
    semanticRoles: normalizeSemanticRoles(roles),
    equipmentArchitecture: creationModuleProfile ? "creation" : "legacy",
    activationMode: heldBeamProfile
      ? "held_beam"
      : hasAnyToken(tokens, ["skillshotcuttinglaser", "knifeprojectilefire"])
        ? "skill_shot"
        : "dogma",
    creationModuleProfile,
    capabilitySources,
  };
}

function classifyNpcEquipment(item) {
  return resolveNpcEquipmentProfile(item).semanticRole;
}

function resolveNpcPlayerFittingHullTypeID(entityRecord) {
  const explicit = toPositiveInt(entityRecord && entityRecord.playerFittingHullTypeID, 0);
  if (explicit) return explicit;
  if (toPositiveInt(entityRecord && entityRecord.categoryID, 0) === SHIP_CATEGORY_ID) {
    return toPositiveInt(entityRecord && entityRecord.typeID, 0);
  }
  if (toPositiveInt(entityRecord && entityRecord.slimCategoryID, 0) === SHIP_CATEGORY_ID) {
    return toPositiveInt(entityRecord && entityRecord.slimTypeID, 0);
  }
  // Most SDE NPC ships are category 11 "Entity" hulls, not category 6 player
  // ships. Their physical type remains the fitting host unless an authored
  // player-hull mapping or NPC-specific slot profile overrides it.
  if (entityRecord && entityRecord.nativeNpc === true &&
      toPositiveInt(entityRecord.categoryID, 0) === NPC_ENTITY_CATEGORY_ID) {
    return toPositiveInt(entityRecord.typeID, 0);
  }
  return 0;
}

function buildPlayerFittingHull(entityRecord) {
  const hasNpcHullProfile = Boolean(
    entityRecord &&
    entityRecord.npcFittingRestrictions &&
    entityRecord.npcFittingRestrictions.roleSlots &&
    typeof entityRecord.npcFittingRestrictions.roleSlots === "object",
  );
  const typeID = resolveNpcPlayerFittingHullTypeID(entityRecord) ||
    (hasNpcHullProfile ? toPositiveInt(entityRecord && entityRecord.typeID, 0) : 0);
  if (!typeID) return null;
  const metadata = resolveItemByTypeID(typeID) || {};
  return {
    itemID: toPositiveInt(entityRecord && entityRecord.entityID, 0),
    typeID,
    groupID: toPositiveInt(metadata.groupID, 0),
    categoryID: toPositiveInt(metadata.categoryID, SHIP_CATEGORY_ID),
    ownerID: toPositiveInt(entityRecord && entityRecord.ownerID, 0),
    itemName: String(metadata.name || entityRecord && entityRecord.itemName || "NPC fitting hull"),
    npcPhysicalHullTypeID: toPositiveInt(entityRecord && entityRecord.typeID, 0),
    npcFittingProfileID: entityRecord && entityRecord.npcFittingProfileID || null,
  };
}

function getEntityOrFailure(entityID) {
  const entityRecord = nativeNpcStore.getNativeEntity(toPositiveInt(entityID, 0));
  if (!entityRecord || entityRecord.transient === true) {
    return { success: false, errorMsg: "NPC_DURABLE_ENTITY_NOT_FOUND" };
  }
  if (persistence.isNpcEntityQuarantined(entityRecord.entityID)) {
    return { success: false, errorMsg: "NPC_PERSISTENCE_QUARANTINED" };
  }
  const fittingHull = buildPlayerFittingHull(entityRecord);
  if (!fittingHull) {
    return { success: false, errorMsg: "NPC_PLAYER_FITTING_HULL_REQUIRED" };
  }
  return { success: true, data: { entityRecord, fittingHull } };
}

function actorMatchesNpcFaction(entityRecord, actor) {
  const npcFactionID = npcFactionConfig.resolveNpcFactionID(entityRecord);
  const npcFactionKey = npcFactionConfig.resolveNpcFactionKey(entityRecord);
  const actorFactionID = toPositiveInt(actor && actor.factionID, 0);
  const actorFactionKey = String(actor && actor.factionKey || "").trim().toLowerCase() || null;
  // Character records generally carry the numeric EVE faction while NPC
  // identities additionally carry a canonical Sui faction key. Prefer the
  // shared numeric authority when both are available; requiring the Sui key
  // here made legitimate same-faction players look cross-faction.
  if (npcFactionID && actorFactionID) return actorFactionID === npcFactionID;
  if (npcFactionKey) return actorFactionKey === npcFactionKey;
  if (npcFactionID) return false;
  return true;
}

function authorizeCustodyTransfer(item, entityRecord, actor, policy) {
  const actorCharacterID = toPositiveInt(actor && actor.characterID, 0);
  const itemOwnerID = toPositiveInt(item && item.ownerID, 0);
  if (!actorCharacterID || !itemOwnerID) {
    return { success: false, errorMsg: "NPC_FITTING_ACTOR_REQUIRED" };
  }
  const actorOwnsItem = itemOwnerID === actorCharacterID;
  const authorizedOwnerIDs = new Set(
    (Array.isArray(actor && actor.authorizedOwnerIDs) ? actor.authorizedOwnerIDs : [])
      .map((value) => toPositiveInt(value, 0))
      .filter(Boolean),
  );
  const factionOwnsItem =
    itemOwnerID === toPositiveInt(entityRecord && entityRecord.ownerID, 0) ||
    authorizedOwnerIDs.has(itemOwnerID);
  if (actorOwnsItem && policy.allowPlayerOwned !== true) {
    return { success: false, errorMsg: "NPC_PLAYER_EQUIPMENT_NOT_ALLOWED" };
  }
  if (!actorOwnsItem && (!factionOwnsItem || policy.allowFactionOwned !== true)) {
    return { success: false, errorMsg: "NPC_FITTING_ITEM_NOT_AUTHORIZED" };
  }
  if (
    policy.allowCrossFactionDonation !== true &&
    !actorMatchesNpcFaction(entityRecord, actor)
  ) {
    return { success: false, errorMsg: "NPC_FACTION_AUTHORIZATION_REQUIRED" };
  }
  return {
    success: true,
    data: { actorCharacterID, ownershipKind: actorOwnsItem ? "player" : "faction" },
  };
}

function validateHardwarePolicy(item, role, policy) {
  const typeID = toPositiveInt(item && item.typeID, 0);
  if (!role || !SEMANTIC_ROLES.includes(role)) {
    return { success: false, errorMsg: "NPC_EQUIPMENT_ROLE_UNSUPPORTED" };
  }
  if (!Array.isArray(policy.allowedRoles) || !policy.allowedRoles.includes(role)) {
    return { success: false, errorMsg: "NPC_FACTION_HARDWARE_ROLE_DENIED" };
  }
  if (Array.isArray(policy.deniedTypeIDs) && policy.deniedTypeIDs.includes(typeID)) {
    return { success: false, errorMsg: "NPC_FACTION_HARDWARE_TYPE_DENIED" };
  }
  if (
    Array.isArray(policy.allowedTypeIDs) &&
    policy.allowedTypeIDs.length > 0 &&
    !policy.allowedTypeIDs.includes(typeID)
  ) {
    return { success: false, errorMsg: "NPC_FACTION_HARDWARE_TYPE_NOT_ALLOWED" };
  }
  return { success: true };
}

function getNpcHullRoleSlots(entityRecord, role) {
  const roleSlots = entityRecord && entityRecord.npcFittingRestrictions &&
    entityRecord.npcFittingRestrictions.roleSlots;
  const raw = roleSlots && roleSlots[role];
  if (!Array.isArray(raw)) return [];
  return [...new Set(raw.map((value) => toPositiveInt(value, 0)).filter(Boolean))];
}

function getNpcHullModuleResourceCost(entityRecord, item) {
  const restrictions = entityRecord && entityRecord.npcFittingRestrictions || {};
  const overrides = restrictions.moduleResources &&
    restrictions.moduleResources[String(toPositiveInt(item && item.typeID, 0))];
  return {
    cpu: Math.max(0, toFiniteNumber(
      overrides && overrides.cpu,
      fitting.getTypeAttributeValue(item && item.typeID, "cpu") || 0,
    )),
    power: Math.max(0, toFiniteNumber(
      overrides && overrides.power,
      fitting.getTypeAttributeValue(item && item.typeID, "power") || 0,
    )),
  };
}

function validateNpcHullSpecificFit(
  entityRecord,
  item,
  role,
  targetFlagID,
  currentFittedItems,
) {
  const allowedSlots = getNpcHullRoleSlots(entityRecord, role);
  if (allowedSlots.length === 0) return null;
  if (!allowedSlots.includes(targetFlagID)) {
    return { success: false, errorMsg: "NPC_HULL_ROLE_SLOT_RESTRICTED" };
  }
  if (currentFittedItems.some((entry) =>
    toPositiveInt(entry && entry.flagID, 0) === targetFlagID &&
    toPositiveInt(entry && entry.itemID, 0) !== toPositiveInt(item && item.itemID, 0))) {
    return { success: false, errorMsg: "SLOT_OCCUPIED" };
  }
  const restrictions = entityRecord.npcFittingRestrictions || {};
  const cpuOutput = Math.max(0, toFiniteNumber(restrictions.cpuOutput, 0));
  const powerOutput = Math.max(0, toFiniteNumber(restrictions.powerOutput, 0));
  const current = currentFittedItems.reduce((total, entry) => {
    if (entry && entry.moduleState && entry.moduleState.online === false) return total;
    const cost = getNpcHullModuleResourceCost(entityRecord, entry);
    total.cpu += cost.cpu;
    total.power += cost.power;
    return total;
  }, { cpu: 0, power: 0 });
  const candidate = getNpcHullModuleResourceCost(entityRecord, item);
  if (cpuOutput > 0 && current.cpu + candidate.cpu > cpuOutput + 1e-6) {
    return {
      success: false,
      errorMsg: "NOT_ENOUGH_CPU",
      data: { cpuOutput, cpuLoad: current.cpu + candidate.cpu },
    };
  }
  if (powerOutput > 0 && current.power + candidate.power > powerOutput + 1e-6) {
    return {
      success: false,
      errorMsg: "NOT_ENOUGH_POWER",
      data: { powerOutput, powerLoad: current.power + candidate.power },
    };
  }
  return {
    success: true,
    data: {
      family: "npc-profile",
      targetFlagID,
      resourceState: {
        cpuOutput,
        cpuLoad: current.cpu + candidate.cpu,
        powerOutput,
        powerLoad: current.power + candidate.power,
      },
    },
  };
}

function resolveNpcChargeCapacity(entityRecord, moduleRecord, chargeItem) {
  const restrictions = entityRecord && entityRecord.npcFittingRestrictions || {};
  const compatibility = restrictions.chargeCompatibility &&
    restrictions.chargeCompatibility[String(toPositiveInt(moduleRecord && moduleRecord.typeID, 0))];
  if (compatibility && typeof compatibility === "object") {
    const allowedTypeIDs = Array.isArray(compatibility.allowedTypeIDs)
      ? compatibility.allowedTypeIDs.map((value) => toPositiveInt(value, 0)).filter(Boolean)
      : [];
    if (
      allowedTypeIDs.length > 0 &&
      !allowedTypeIDs.includes(toPositiveInt(chargeItem && chargeItem.typeID, 0))
    ) return { compatible: false, capacity: 0 };
    return {
      compatible: true,
      capacity: toPositiveInt(compatibility.capacity, 1),
    };
  }
  const compatible = npcCapabilityResolver.isNpcChargeCompatibleWithModule(
    moduleRecord,
    chargeItem && chargeItem.typeID,
  );
  return {
    compatible,
    capacity: compatible
      ? fitting.getModuleChargeCapacity(
          npcCapabilityResolver.getNpcCapabilityTypeID(moduleRecord, moduleRecord.typeID),
          chargeItem && chargeItem.typeID,
        )
      : 0,
  };
}

function resolveEffectiveHardwarePolicy(entityRecord) {
  const factionPolicy = npcFactionConfig.resolveNpcHardwarePolicy(entityRecord);
  const restriction = entityRecord && entityRecord.npcFittingRestrictions;
  if (!restriction || typeof restriction !== "object" || Array.isArray(restriction)) {
    return factionPolicy;
  }
  const factionRoles = Array.isArray(factionPolicy.allowedRoles)
    ? factionPolicy.allowedRoles
    : [];
  const hullRoles = Array.isArray(restriction.allowedRoles)
    ? restriction.allowedRoles.map((role) => String(role || "").trim().toLowerCase())
    : null;
  const factionAllowedTypes = Array.isArray(factionPolicy.allowedTypeIDs)
    ? factionPolicy.allowedTypeIDs
    : [];
  const hullAllowedTypes = Array.isArray(restriction.allowedTypeIDs)
    ? restriction.allowedTypeIDs.map((value) => toPositiveInt(value, 0)).filter(Boolean)
    : [];
  const allowedTypeIDs = factionAllowedTypes.length > 0 && hullAllowedTypes.length > 0
    ? factionAllowedTypes.filter((typeID) => hullAllowedTypes.includes(typeID))
    : hullAllowedTypes.length > 0
      ? hullAllowedTypes
      : factionAllowedTypes;
  return {
    ...factionPolicy,
    allowPlayerOwned:
      factionPolicy.allowPlayerOwned === true && restriction.allowPlayerOwned !== false,
    allowFactionOwned:
      factionPolicy.allowFactionOwned === true && restriction.allowFactionOwned !== false,
    allowCrossFactionDonation:
      factionPolicy.allowCrossFactionDonation === true &&
      restriction.allowCrossFactionDonation === true,
    allowedRoles: hullRoles
      ? factionRoles.filter((role) => hullRoles.includes(role))
      : factionRoles,
    allowedTypeIDs,
    deniedTypeIDs: [...new Set([
      ...(Array.isArray(factionPolicy.deniedTypeIDs) ? factionPolicy.deniedTypeIDs : []),
      ...(Array.isArray(restriction.deniedTypeIDs)
        ? restriction.deniedTypeIDs.map((value) => toPositiveInt(value, 0)).filter(Boolean)
        : []),
    ])],
    equipmentLossPolicy: ["return", "destroy"].includes(restriction.equipmentLossPolicy)
      ? restriction.equipmentLossPolicy
      : factionPolicy.equipmentLossPolicy,
  };
}

function buildCustody(item, entityRecord, actor, ownershipKind, state) {
  return {
    schemaVersion: CUSTODY_SCHEMA_VERSION,
    kind: "external-item",
    state,
    sourceItemID: toPositiveInt(item.itemID, 0),
    sourceOwnerID: toPositiveInt(item.ownerID, 0),
    sourceLocationID: toPositiveInt(item.locationID, 0),
    sourceFlagID: Math.max(0, Math.trunc(Number(item.flagID) || 0)),
    sourceStackOriginID: toPositiveInt(item.stackOriginID, 0) || null,
    actorCharacterID: toPositiveInt(actor && actor.characterID, 0),
    ownershipKind: String(ownershipKind || "player"),
    npcCharacterID: toPositiveInt(entityRecord.npcCharacterID, 0),
    npcIncarnation: toPositiveInt(entityRecord.npcIncarnation, 1),
    acceptedAtMs: Date.now(),
  };
}

function isCustodiedRecord(record) {
  return Boolean(record && record.custody && record.custody.kind === "external-item");
}

function flushItems() {
  const result = database.flushTableSync(itemStore.ITEMS_TABLE);
  if (!result || result.success !== true) throw new Error("NPC_FITTING_ITEM_FLUSH_FAILED");
}

function syncRuntimeEquipment(entityID, options: Record<string, any> = {}) {
  try {
    const entityRecord = nativeNpcStore.getNativeEntity(entityID);
    if (!entityRecord) return null;
    const spaceRuntime = require(path.join(__dirname, "../runtime"));
    const scene = spaceRuntime.scenes instanceof Map
      ? spaceRuntime.scenes.get(toPositiveInt(entityRecord.systemID, 0))
      : null;
    const entity = scene && scene.getEntityByID(toPositiveInt(entityID, 0));
    if (!entity) return null;
    entity.fittedItems = nativeNpcStore.buildNativeFittedItems(entityID);
    entity.nativeCargoItems = nativeNpcStore.buildNativeCargoItems(entityID);
    entity.modules = nativeNpcStore.buildNativeSlimModuleTuples(entityID);
    delete entity._npcWeaponBankCache;
    if (options.broadcast !== false && typeof scene.broadcastSlimItemChanges === "function") {
      scene.broadcastSlimItemChanges([entity]);
    }
    return entity;
  } catch (_) {
    return null;
  }
}

function moveModuleItem(itemID, destinationLocationID, destinationFlagID, source, online) {
  return itemStore.moveItemsToLocationsAndUpdateItem(
    [{
      itemID,
      destinationLocationID,
      destinationFlagID,
      quantity: 1,
      options: {
        affectsFitting: true,
        preserveMovedItemID: true,
        remainderLocationID: source.locationID,
        remainderFlagID: source.flagID,
      },
    }],
    itemID,
    (current) => ({
      ...current,
      moduleState: itemStore.normalizeModuleState({
        ...(current.moduleState || {}),
        online: online === true,
      }),
    }),
    { flush: true },
  );
}

function compensateModuleFit(moduleRecord) {
  const custody = moduleRecord && moduleRecord.custody;
  const itemID = toPositiveInt(moduleRecord && moduleRecord.moduleID, 0);
  const current = itemStore.findItemById(itemID);
  if (current && custody && toPositiveInt(current.locationID, 0) === toPositiveInt(moduleRecord.entityID, 0)) {
    moveModuleItem(
      itemID,
      custody.sourceLocationID,
      custody.sourceFlagID,
      custody,
      false,
    );
  }
  nativeNpcStore.removeNativeModule(itemID);
  database.flushTablesSync([nativeNpcStore.TABLE.MODULES, itemStore.ITEMS_TABLE]);
}

function readCommittedOperationResult(idempotencyKey) {
  const operation = persistence.getNpcOperationByIdempotencyKey(idempotencyKey);
  return operation && operation.status === "committed"
    ? { success: true, data: { ...cloneValue(operation.result || {}), idempotent: true } }
    : null;
}

function fitItemToNpc(input: Record<string, any>) {
  persistence.initializeNpcRuntimePersistence();
  const resolved = getEntityOrFailure(input && input.entityID);
  if (!resolved.success) return resolved;
  const { entityRecord, fittingHull } = resolved.data;
  const requestedItemID = toPositiveInt(input && input.itemID, 0);
  const idempotencyKey = String(input.idempotencyKey ||
    `npc-fit:${entityRecord.entityID}:${entityRecord.npcIncarnation || 1}:${requestedItemID}`).trim();
  const committed = readCommittedOperationResult(idempotencyKey);
  if (committed) return committed;
  const item = itemStore.findItemById(requestedItemID);
  if (!item) return { success: false, errorMsg: "ITEM_NOT_FOUND" };
  if (toPositiveInt(item.categoryID, 0) !== MODULE_CATEGORY_ID) {
    return { success: false, errorMsg: "NPC_FITTING_MODULE_REQUIRED" };
  }
  if (nativeNpcStore.getNativeModule && nativeNpcStore.getNativeModule(item.itemID)) {
    return { success: false, errorMsg: "NPC_MODULE_ALREADY_FITTED" };
  }

  const policy = resolveEffectiveHardwarePolicy(entityRecord);
  const authorization = authorizeCustodyTransfer(item, entityRecord, input.actor, policy);
  if (!authorization.success) return authorization;
  const equipmentProfile = resolveNpcEquipmentProfile(item);
  const role = equipmentProfile.semanticRole;
  const policyValidation = validateHardwarePolicy(item, role, policy);
  if (!policyValidation.success) return policyValidation;

  const currentFittedItems = nativeNpcStore.buildNativeFittedItems(entityRecord.entityID);
  const roleSlots = getNpcHullRoleSlots(entityRecord, role);
  const occupiedFlags = new Set(
    currentFittedItems.map((entry) => toPositiveInt(entry && entry.flagID, 0)),
  );
  const targetFlagID = toPositiveInt(
    input.targetFlagID,
    roleSlots.find((flagID) => !occupiedFlags.has(flagID)) ||
      npcCapabilityResolver.selectAutoFitFlagForNpcModuleType(
        fittingHull,
        currentFittedItems,
        item,
      ),
  );
  if (!targetFlagID) return { success: false, errorMsg: "NPC_NATIVE_NO_FREE_SLOT" };
  const npcHullValidation = validateNpcHullSpecificFit(
    entityRecord,
    item,
    role,
    targetFlagID,
    currentFittedItems,
  );
  const fitValidation = npcHullValidation || fitting.validateFitForShip(
      toPositiveInt(entityRecord.npcCharacterID, authorization.data.actorCharacterID),
      fittingHull,
      item,
      targetFlagID,
      currentFittedItems,
      { skipSkillRequirements: true },
    );
  if (!fitValidation.success) return fitValidation;
  const candidate = {
    ...item,
    locationID: entityRecord.entityID,
    flagID: targetFlagID,
    singleton: 1,
    stacksize: 1,
    moduleState: itemStore.normalizeModuleState({ ...(item.moduleState || {}), online: true }),
  };
  const onlineState = npcHullValidation
    ? { applies: true, online: true, resourceState: npcHullValidation.data.resourceState }
    : fitting.resolveFitOnlineState(
        toPositiveInt(entityRecord.npcCharacterID, authorization.data.actorCharacterID),
        fittingHull,
        candidate,
        currentFittedItems,
      );
  if (onlineState.applies && onlineState.online !== true) {
    return {
      success: false,
      errorMsg: onlineState.reason || "NPC_FITTING_RESOURCE_OVERLOAD",
      data: { resourceState: onlineState.resourceState || null },
    };
  }

  const propulsionDisabled = role === "propulsion" &&
    npcCapabilityResolver.NPC_ENABLE_FITTED_PROPULSION_MODULES !== true;
  const custody = buildCustody(
    item,
    entityRecord,
    input.actor,
    authorization.data.ownershipKind,
    "fitted",
  );
  const moduleRecord = {
    moduleID: toPositiveInt(item.itemID, 0),
    entityID: toPositiveInt(entityRecord.entityID, 0),
    ownerID: toPositiveInt(item.ownerID, 0),
    typeID: toPositiveInt(item.typeID, 0),
    groupID: toPositiveInt(item.groupID, 0),
    categoryID: toPositiveInt(item.categoryID, 0),
    itemName: String(item.itemName || "Player-fitted NPC module"),
    flagID: targetFlagID,
    singleton: true,
    transient: false,
    semanticRole: role,
    semanticRoles: equipmentProfile.semanticRoles,
    equipmentArchitecture: equipmentProfile.equipmentArchitecture,
    activationMode: equipmentProfile.activationMode,
    creationModuleProfile: equipmentProfile.creationModuleProfile,
    capabilitySources: equipmentProfile.capabilitySources,
    playerFittingHullTypeID: fittingHull.typeID,
    useDisabledReason: propulsionDisabled ? "NPC_SYNTHETIC_NAVIGATION_AUTHORITY" : null,
    custody,
    moduleState: itemStore.normalizeModuleState({
      ...(item.moduleState || {}),
      online: !propulsionDisabled,
    }),
  };
  const operation = persistence.beginNpcOperation("npc-fit", idempotencyKey, {
    entityID: entityRecord.entityID,
    moduleID: item.itemID,
    destinationFlagID: targetFlagID,
    sourceItemState: cloneValue(custody),
    moduleRecord: cloneValue(moduleRecord),
  }).data;
  if (operation.status === "committed") {
    return { success: true, data: { ...cloneValue(operation.result || {}), idempotent: true } };
  }

  try {
    const move = moveModuleItem(
      item.itemID,
      entityRecord.entityID,
      targetFlagID,
      custody,
      !propulsionDisabled,
    );
    if (!move.success) {
      persistence.failNpcOperation(operation.operationID, move.errorMsg || "NPC_FITTING_MOVE_FAILED", {
        compensated: true,
      });
      return move;
    }
    persistence.checkpointNpcOperation(operation.operationID, "inventory-moved", {
      moduleRecord: cloneValue(moduleRecord),
    }, { flushTables: [itemStore.ITEMS_TABLE] });
    const stored = nativeNpcStore.upsertNativeModule(moduleRecord, { durable: true });
    if (!stored.success) throw new Error(stored.errorMsg || "NPC_MODULE_WRITE_FAILED");
    const result = {
      entityID: entityRecord.entityID,
      moduleID: item.itemID,
      flagID: targetFlagID,
      semanticRole: role,
      semanticRoles: equipmentProfile.semanticRoles,
      equipmentArchitecture: equipmentProfile.equipmentArchitecture,
      propulsionDisabled,
      itemChanges: cloneValue(move.data && move.data.changes || []),
    };
    persistence.commitNpcOperation(operation.operationID, {
      flushTables: [nativeNpcStore.TABLE.MODULES, itemStore.ITEMS_TABLE],
      result,
    });
    syncRuntimeEquipment(entityRecord.entityID, input);
    return { success: true, data: result };
  } catch (error) {
    compensateModuleFit(moduleRecord);
    persistence.failNpcOperation(operation.operationID, error, { compensated: true });
    return { success: false, errorMsg: error.message || "NPC_FITTING_FAILED" };
  }
}

function unfitItemFromNpc(input: Record<string, any>) {
  persistence.initializeNpcRuntimePersistence();
  const resolved = getEntityOrFailure(input && input.entityID);
  if (!resolved.success) return resolved;
  const { entityRecord } = resolved.data;
  const moduleID = toPositiveInt(input && input.moduleID, 0);
  const idempotencyKey = String(
    input.idempotencyKey || `npc-unfit:${entityRecord.entityID}:${moduleID}`,
  ).trim();
  const committed = readCommittedOperationResult(idempotencyKey);
  if (committed) return committed;
  const moduleRecord = nativeNpcStore.getNativeModule(moduleID);
  if (!moduleRecord || moduleRecord.entityID !== entityRecord.entityID || !isCustodiedRecord(moduleRecord)) {
    return { success: false, errorMsg: "NPC_CUSTODIED_MODULE_NOT_FOUND" };
  }
  if (nativeNpcStore.listNativeCargoForEntity(entityRecord.entityID).some(
    (record) => toPositiveInt(record.moduleID, 0) === moduleID,
  )) {
    return { success: false, errorMsg: "NPC_MODULE_HAS_LOADED_CHARGE" };
  }
  const item = itemStore.findItemById(moduleID);
  if (!item) return { success: false, errorMsg: "NPC_CUSTODY_ITEM_MISSING" };
  const policy = resolveEffectiveHardwarePolicy(entityRecord);
  const authorization = authorizeCustodyTransfer(item, entityRecord, input.actor, policy);
  if (!authorization.success) return authorization;
  const custody = moduleRecord.custody;
  const destinationLocationID = toPositiveInt(input.destinationLocationID, custody.sourceLocationID);
  const destinationFlagID = Math.max(
    0,
    Math.trunc(Number(input.destinationFlagID ?? custody.sourceFlagID) || 0),
  );
  const operation = persistence.beginNpcOperation(
    "npc-unfit",
    idempotencyKey,
    {
      entityID: entityRecord.entityID,
      moduleID,
      moduleRecord: cloneValue(moduleRecord),
      destinationLocationID,
      destinationFlagID,
    },
  ).data;
  if (operation.status === "committed") {
    return { success: true, data: { ...cloneValue(operation.result || {}), idempotent: true } };
  }
  try {
    const move = moveModuleItem(
      moduleID,
      destinationLocationID,
      destinationFlagID,
      custody,
      false,
    );
    if (!move.success) {
      persistence.failNpcOperation(operation.operationID, move.errorMsg || "NPC_UNFITTING_MOVE_FAILED");
      return move;
    }
    persistence.checkpointNpcOperation(operation.operationID, "inventory-returned", {}, {
      flushTables: [itemStore.ITEMS_TABLE],
    });
    nativeNpcStore.removeNativeModule(moduleID);
    const result = {
      entityID: entityRecord.entityID,
      moduleID,
      destinationLocationID,
      destinationFlagID,
      itemChanges: cloneValue(move.data && move.data.changes || []),
    };
    persistence.commitNpcOperation(operation.operationID, {
      flushTables: [nativeNpcStore.TABLE.MODULES, itemStore.ITEMS_TABLE],
      result,
    });
    syncRuntimeEquipment(entityRecord.entityID, input);
    return { success: true, data: result };
  } catch (error) {
    persistence.failNpcOperation(operation.operationID, error);
    return { success: false, errorMsg: error.message || "NPC_UNFITTING_FAILED" };
  }
}

function loadChargeToNpcModule(input: Record<string, any>) {
  persistence.initializeNpcRuntimePersistence();
  const resolved = getEntityOrFailure(input && input.entityID);
  if (!resolved.success) return resolved;
  const { entityRecord } = resolved.data;
  const moduleID = toPositiveInt(input && input.moduleID, 0);
  const requestedItemID = toPositiveInt(input && input.itemID, 0);
  const idempotencyKey = String(input.idempotencyKey ||
    `npc-charge-load:${entityRecord.entityID}:${moduleID}:${requestedItemID}`).trim();
  const committed = readCommittedOperationResult(idempotencyKey);
  if (committed) return committed;
  const moduleRecord = nativeNpcStore.getNativeModule(moduleID);
  if (!moduleRecord || moduleRecord.entityID !== entityRecord.entityID) {
    return { success: false, errorMsg: "NPC_MODULE_NOT_FOUND" };
  }
  if (nativeNpcStore.listNativeCargoForEntity(entityRecord.entityID).some(
    (record) => toPositiveInt(record.moduleID, 0) === moduleID,
  )) {
    return { success: false, errorMsg: "NPC_MODULE_ALREADY_LOADED" };
  }
  const item = itemStore.findItemById(requestedItemID);
  if (!item || toPositiveInt(item.categoryID, 0) !== CHARGE_CATEGORY_ID) {
    return { success: false, errorMsg: "NPC_CHARGE_ITEM_REQUIRED" };
  }
  const policy = resolveEffectiveHardwarePolicy(entityRecord);
  const authorization = authorizeCustodyTransfer(item, entityRecord, input.actor, policy);
  if (!authorization.success) return authorization;
  const chargeRole = moduleRecord.semanticRole === "jump_drive" ? "fuel" : "ammunition";
  const policyValidation = validateHardwarePolicy(item, chargeRole, policy);
  if (!policyValidation.success) return policyValidation;
  const chargeFit = resolveNpcChargeCapacity(entityRecord, moduleRecord, item);
  if (!chargeFit.compatible) {
    return { success: false, errorMsg: "NPC_CHARGE_INCOMPATIBLE" };
  }
  const availableQuantity = item.singleton === 1 ? 1 : toPositiveInt(item.stacksize, 1);
  const capacity = chargeFit.capacity;
  const quantity = input.quantity === undefined || input.quantity === null
    ? Math.min(availableQuantity, capacity)
    : toPositiveInt(input.quantity, 0);
  if (!quantity) {
    return { success: false, errorMsg: "NPC_CHARGE_QUANTITY_REQUIRED" };
  }
  if (quantity > availableQuantity) {
    return {
      success: false,
      errorMsg: "INSUFFICIENT_ITEMS",
      data: { availableQuantity, requestedQuantity: quantity },
    };
  }
  if (capacity <= 0 || quantity > capacity) {
    return {
      success: false,
      errorMsg: "NPC_CHARGE_CAPACITY_EXCEEDED",
      data: { capacity, requestedQuantity: quantity },
    };
  }
  const custody = buildCustody(
    item,
    entityRecord,
    input.actor,
    authorization.data.ownershipKind,
    "loaded",
  );
  const operation = persistence.beginNpcOperation(
    "npc-charge-load",
    idempotencyKey,
    {
      entityID: entityRecord.entityID,
      moduleID,
      sourceItemState: cloneValue(custody),
      quantity,
      destinationFlagID: moduleRecord.flagID,
      cargoRecord: {
        cargoID: item.itemID,
        entityID: entityRecord.entityID,
        ownerID: item.ownerID,
        moduleID,
        typeID: item.typeID,
        groupID: item.groupID,
        categoryID: item.categoryID,
        itemName: item.itemName,
        quantity,
        singleton: item.singleton === 1,
        transient: false,
        semanticRole: chargeRole,
        custody: {
          ...custody,
          movedItemID: item.itemID,
        },
      },
    },
  ).data;
  if (operation.status === "committed") {
    return { success: true, data: { ...cloneValue(operation.result || {}), idempotent: true } };
  }
  let movedItemID = 0;
  try {
    const move = itemStore.moveItemToLocation(
      item.itemID,
      entityRecord.entityID,
      moduleRecord.flagID,
      quantity,
      {
        affectsFitting: true,
        preserveMovedStackItemID: true,
        remainderLocationID: custody.sourceLocationID,
        remainderFlagID: custody.sourceFlagID,
      },
    );
    if (!move.success) {
      persistence.failNpcOperation(operation.operationID, move.errorMsg || "NPC_CHARGE_MOVE_FAILED", {
        compensated: true,
      });
      return move;
    }
    flushItems();
    movedItemID = toPositiveInt(move.data && move.data.movedItemID, item.itemID);
    const movedItem = itemStore.findItemById(movedItemID);
    if (!movedItem) throw new Error("NPC_MOVED_CHARGE_NOT_FOUND");
    const cargoRecord = {
      ...cloneValue(operation.payload.cargoRecord),
      cargoID: movedItemID,
      ownerID: movedItem.ownerID,
      quantity: movedItem.singleton === 1 ? 1 : toPositiveInt(movedItem.stacksize, quantity),
      singleton: movedItem.singleton === 1,
    };
    persistence.checkpointNpcOperation(operation.operationID, "inventory-moved", {
      movedItemID,
      cargoRecord: cloneValue(cargoRecord),
    }, { flushTables: [itemStore.ITEMS_TABLE] });
    const stored = nativeNpcStore.upsertNativeCargo(cargoRecord, { durable: true });
    if (!stored.success) throw new Error(stored.errorMsg || "NPC_CARGO_WRITE_FAILED");
    const result = {
      entityID: entityRecord.entityID,
      moduleID,
      cargoID: movedItemID,
      quantity: cargoRecord.quantity,
      itemChanges: cloneValue(move.data && move.data.changes || []),
    };
    persistence.commitNpcOperation(operation.operationID, {
      flushTables: [nativeNpcStore.TABLE.CARGO, itemStore.ITEMS_TABLE],
      result,
    });
    syncRuntimeEquipment(entityRecord.entityID, input);
    return { success: true, data: result };
  } catch (error) {
    const moved = movedItemID ? itemStore.findItemById(movedItemID) : null;
    if (moved && toPositiveInt(moved.locationID, 0) === entityRecord.entityID) {
      itemStore.moveItemToLocation(
        movedItemID,
        custody.sourceLocationID,
        custody.sourceFlagID,
      );
      flushItems();
    }
    if (movedItemID) nativeNpcStore.removeNativeCargo(movedItemID);
    persistence.failNpcOperation(operation.operationID, error, { compensated: true });
    return { success: false, errorMsg: error.message || "NPC_CHARGE_LOAD_FAILED" };
  }
}

function unloadChargeFromNpcModule(input: Record<string, any>) {
  persistence.initializeNpcRuntimePersistence();
  const resolved = getEntityOrFailure(input && input.entityID);
  if (!resolved.success) return resolved;
  const { entityRecord } = resolved.data;
  const cargoID = toPositiveInt(input && input.cargoID, 0);
  const idempotencyKey = String(
    input.idempotencyKey || `npc-charge-unload:${entityRecord.entityID}:${cargoID}`,
  ).trim();
  const committed = readCommittedOperationResult(idempotencyKey);
  if (committed) return committed;
  const cargoRecord = nativeNpcStore.getNativeCargo(cargoID);
  if (!cargoRecord || cargoRecord.entityID !== entityRecord.entityID || !isCustodiedRecord(cargoRecord)) {
    return { success: false, errorMsg: "NPC_CUSTODIED_CHARGE_NOT_FOUND" };
  }
  const item = itemStore.findItemById(cargoID);
  if (!item) return { success: false, errorMsg: "NPC_CUSTODY_ITEM_MISSING" };
  const policy = resolveEffectiveHardwarePolicy(entityRecord);
  const authorization = authorizeCustodyTransfer(item, entityRecord, input.actor, policy);
  if (!authorization.success) return authorization;
  const custody = cargoRecord.custody;
  const destinationLocationID = toPositiveInt(input.destinationLocationID, custody.sourceLocationID);
  const destinationFlagID = Math.max(
    0,
    Math.trunc(Number(input.destinationFlagID ?? custody.sourceFlagID) || 0),
  );
  const operation = persistence.beginNpcOperation(
    "npc-charge-unload",
    idempotencyKey,
    {
      entityID: entityRecord.entityID,
      cargoID,
      cargoRecord: cloneValue(cargoRecord),
      destinationLocationID,
      destinationFlagID,
    },
  ).data;
  if (operation.status === "committed") {
    return { success: true, data: { ...cloneValue(operation.result || {}), idempotent: true } };
  }
  try {
    const move = itemStore.moveItemToLocation(
      cargoID,
      destinationLocationID,
      destinationFlagID,
      null,
      { affectsFitting: true },
    );
    if (!move.success) {
      persistence.failNpcOperation(operation.operationID, move.errorMsg || "NPC_CHARGE_RETURN_FAILED");
      return move;
    }
    flushItems();
    persistence.checkpointNpcOperation(operation.operationID, "inventory-returned", {}, {
      flushTables: [itemStore.ITEMS_TABLE],
    });
    nativeNpcStore.removeNativeCargo(cargoID);
    const result = {
      entityID: entityRecord.entityID,
      moduleID: cargoRecord.moduleID,
      cargoID,
      destinationLocationID,
      destinationFlagID,
      itemChanges: cloneValue(move.data && move.data.changes || []),
    };
    persistence.commitNpcOperation(operation.operationID, {
      flushTables: [nativeNpcStore.TABLE.CARGO, itemStore.ITEMS_TABLE],
      result,
    });
    syncRuntimeEquipment(entityRecord.entityID, input);
    return { success: true, data: result };
  } catch (error) {
    persistence.failNpcOperation(operation.operationID, error);
    return { success: false, errorMsg: error.message || "NPC_CHARGE_UNLOAD_FAILED" };
  }
}

function listNpcEquipment(entityID) {
  const numericEntityID = toPositiveInt(entityID, 0);
  const entityRecord = nativeNpcStore.getNativeEntity(numericEntityID);
  const chargeCompatibility = entityRecord && entityRecord.npcFittingRestrictions &&
    entityRecord.npcFittingRestrictions.chargeCompatibility || {};
  return nativeNpcStore.listNativeModulesForEntity(numericEntityID).map((record) => {
    const equipmentProfile = resolveNpcEquipmentProfile(record);
    const role = equipmentProfile.semanticRole || record.semanticRole || null;
    const semanticRoles = equipmentProfile.semanticRoles.length > 0
      ? equipmentProfile.semanticRoles
      : normalizeSemanticRoles(record.semanticRoles || role);
    const charges = nativeNpcStore.listNativeCargoForEntity(numericEntityID)
      .filter((cargo) => toPositiveInt(cargo.moduleID, 0) === toPositiveInt(record.moduleID, 0));
    const requiresCharge = Boolean(
      chargeCompatibility[String(toPositiveInt(record.typeID, 0))],
    ) || fitting.getModuleChargeGroupIDs(
      npcCapabilityResolver.getNpcCapabilityTypeID(record, record.typeID),
    ).size > 0;
    return {
      ...cloneValue(record),
      semanticRole: role,
      semanticRoles,
      equipmentArchitecture: equipmentProfile.creationModuleProfile
        ? "creation"
        : record.equipmentArchitecture || equipmentProfile.equipmentArchitecture || "unknown",
      activationMode: equipmentProfile.activationMode || record.activationMode || "dogma",
      creationModuleProfile:
        equipmentProfile.creationModuleProfile || cloneValue(record.creationModuleProfile || null),
      capabilitySources: equipmentProfile.capabilitySources.length > 0
        ? equipmentProfile.capabilitySources
        : cloneValue(record.capabilitySources || []),
      charges: cloneValue(charges),
      usable:
        record.moduleState && record.moduleState.online === true &&
        !record.useDisabledReason &&
        (!requiresCharge || charges.length > 0),
    };
  });
}

function selectNpcEquipmentForRole(entityID, role, options: Record<string, any> = {}) {
  const normalizedRole = String(role || "").trim().toLowerCase();
  const candidates = listNpcEquipment(entityID)
    .filter((record) => normalizeSemanticRoles(
      record.semanticRoles || record.semanticRole,
    ).includes(normalizedRole))
    .filter((record) => options.includeDisabled === true || record.usable === true)
    .sort((left, right) =>
      toPositiveInt(left.flagID, 0) - toPositiveInt(right.flagID, 0) ||
      toPositiveInt(left.moduleID, 0) - toPositiveInt(right.moduleID, 0));
  return candidates[0] || null;
}

function listNpcConsumables(entityID, role = null) {
  const normalizedRole = role == null ? null : String(role || "").trim().toLowerCase();
  return nativeNpcStore.listNativeCargoForEntity(toPositiveInt(entityID, 0))
    .filter((record) => !normalizedRole || record.semanticRole === normalizedRole)
    .map(cloneValue);
}

function returnCustodiedItem(record, recordKind) {
  const custody = record && record.custody;
  const itemID = toPositiveInt(recordKind === "module" ? record.moduleID : record.cargoID, 0);
  const item = itemStore.findItemById(itemID);
  if (!item) return { success: false, errorMsg: "NPC_CUSTODY_ITEM_MISSING" };
  if (
    toPositiveInt(item.locationID, 0) === toPositiveInt(custody.sourceLocationID, 0) &&
    Math.trunc(Number(item.flagID) || 0) === Math.trunc(Number(custody.sourceFlagID) || 0)
  ) return { success: true, alreadyReturned: true };
  const result = recordKind === "module"
    ? moveModuleItem(itemID, custody.sourceLocationID, custody.sourceFlagID, custody, false)
    : itemStore.moveItemToLocation(itemID, custody.sourceLocationID, custody.sourceFlagID);
  if (result.success) flushItems();
  return result;
}

function settleNpcEquipmentBeforeRemoval(entityID, options: Record<string, any> = {}) {
  const entityRecord = nativeNpcStore.getNativeEntity(toPositiveInt(entityID, 0));
  if (!entityRecord) return { success: true, data: { settled: 0 } };
  const policy = resolveEffectiveHardwarePolicy(entityRecord);
  const lossPolicy = options.destroyed === true
    ? String(options.lossPolicy || entityRecord.npcEquipmentLossPolicy || policy.equipmentLossPolicy || "return")
    : "return";
  const cargoRecords = nativeNpcStore.listNativeCargoForEntity(entityRecord.entityID)
    .filter(isCustodiedRecord);
  const moduleRecords = nativeNpcStore.listNativeModulesForEntity(entityRecord.entityID)
    .filter(isCustodiedRecord);
  const resourceCargoRecords = nativeNpcStore.listNativeCargoForEntity(entityRecord.entityID)
    .filter((record) => !isCustodiedRecord(record) && record.semanticRole === "resource");
  let settled = 0;
  // Phase 2 resource cargo has a canonical items row in addition to the native
  // cargo mirror. A destruction path has already copied the mirror into its
  // wreck; other removals historically discard ordinary NPC cargo. Remove only
  // canonical rows that are still physically held by this NPC. If a delivery
  // moved the item before a crash, recovery owns the destination row and this
  // cleanup must leave it untouched.
  for (const record of resourceCargoRecords) {
    const itemID = toPositiveInt(record.cargoID, 0);
    const item = itemStore.findItemById(itemID);
    if (item && toPositiveInt(item.locationID, 0) === entityRecord.entityID) {
      const removed = itemStore.removeInventoryItem(itemID, { removeContents: true });
      if (!removed.success) return removed;
      flushItems();
    }
    settled += 1;
  }
  for (const [kind, records] of [["charge", cargoRecords], ["module", moduleRecords]]) {
    for (const record of records) {
      const itemID = toPositiveInt(kind === "module" ? record.moduleID : record.cargoID, 0);
      const item = itemStore.findItemById(itemID);
      if (lossPolicy === "destroy") {
        if (item) {
          const removed = itemStore.removeInventoryItem(itemID, { removeContents: true });
          if (!removed.success) return removed;
          flushItems();
        }
      } else {
        const returned = returnCustodiedItem(record, kind);
        if (!returned.success) return returned;
      }
      settled += 1;
    }
  }
  return { success: true, data: { settled, lossPolicy } };
}

function recoverNpcFittingOperation(operation) {
  if (!operation || TERMINAL_OPERATION_STATUSES.has(operation.status)) {
    return { success: true, skipped: true };
  }
  const payload = operation.payload || {};
  const entityID = toPositiveInt(payload.entityID, 0);
  if (operation.operationType === "npc-fit") {
    const moduleRecord = payload.moduleRecord;
    const moduleID = toPositiveInt(payload.moduleID || moduleRecord && moduleRecord.moduleID, 0);
    const item = itemStore.findItemById(moduleID);
    if (item && toPositiveInt(item.locationID, 0) === entityID && moduleRecord) {
      nativeNpcStore.upsertNativeModule(moduleRecord, { durable: true });
      persistence.commitNpcOperation(operation.operationID, {
        flushTables: [nativeNpcStore.TABLE.MODULES, itemStore.ITEMS_TABLE],
        result: { entityID, moduleID, recovered: true },
      });
      syncRuntimeEquipment(entityID);
      return { success: true, recovered: true };
    }
    if (moduleRecord) compensateModuleFit(moduleRecord);
    persistence.failNpcOperation(operation.operationID, "Incomplete NPC fit compensated", {
      compensated: true,
    });
    return { success: true, compensated: true };
  }
  if (operation.operationType === "npc-unfit") {
    const moduleID = toPositiveInt(payload.moduleID, 0);
    const item = itemStore.findItemById(moduleID);
    if (item && toPositiveInt(item.locationID, 0) === entityID) {
      const returned = returnCustodiedItem(payload.moduleRecord, "module");
      if (!returned.success) return returned;
    }
    nativeNpcStore.removeNativeModule(moduleID);
    persistence.commitNpcOperation(operation.operationID, {
      flushTables: [nativeNpcStore.TABLE.MODULES, itemStore.ITEMS_TABLE],
      result: { entityID, moduleID, recovered: true },
    });
    syncRuntimeEquipment(entityID);
    return { success: true, recovered: true };
  }
  if (operation.operationType === "npc-charge-load") {
    const cargoRecord = payload.cargoRecord;
    const cargoID = toPositiveInt(payload.movedItemID || cargoRecord && cargoRecord.cargoID, 0);
    const item = itemStore.findItemById(cargoID);
    if (item && toPositiveInt(item.locationID, 0) === entityID && cargoRecord) {
      nativeNpcStore.upsertNativeCargo(cargoRecord, { durable: true });
      persistence.commitNpcOperation(operation.operationID, {
        flushTables: [nativeNpcStore.TABLE.CARGO, itemStore.ITEMS_TABLE],
        result: { entityID, cargoID, recovered: true },
      });
      syncRuntimeEquipment(entityID);
      return { success: true, recovered: true };
    }
    persistence.failNpcOperation(operation.operationID, "Incomplete NPC charge load compensated", {
      compensated: true,
    });
    return { success: true, compensated: true };
  }
  if (operation.operationType === "npc-charge-unload") {
    const cargoID = toPositiveInt(payload.cargoID, 0);
    const item = itemStore.findItemById(cargoID);
    if (item && toPositiveInt(item.locationID, 0) === entityID) {
      const returned = returnCustodiedItem(payload.cargoRecord, "charge");
      if (!returned.success) return returned;
    }
    nativeNpcStore.removeNativeCargo(cargoID);
    persistence.commitNpcOperation(operation.operationID, {
      flushTables: [nativeNpcStore.TABLE.CARGO, itemStore.ITEMS_TABLE],
      result: { entityID, cargoID, recovered: true },
    });
    syncRuntimeEquipment(entityID);
    return { success: true, recovered: true };
  }
  return { success: false, errorMsg: "NPC_FITTING_OPERATION_UNSUPPORTED" };
}

module.exports = {
  CUSTODY_SCHEMA_VERSION,
  SEMANTIC_ROLES,
  classifyNpcEquipment,
  resolveNpcEquipmentProfile,
  resolveNpcPlayerFittingHullTypeID,
  buildPlayerFittingHull,
  resolveNpcFittingEntity: getEntityOrFailure,
  resolveEffectiveHardwarePolicy,
  fitItemToNpc,
  unfitItemFromNpc,
  loadChargeToNpcModule,
  unloadChargeFromNpcModule,
  listNpcEquipment,
  listNpcConsumables,
  selectNpcEquipmentForRole,
  settleNpcEquipmentBeforeRemoval,
  recoverNpcFittingOperation,
  syncRuntimeEquipment,
  _testing: {
    actorMatchesNpcFaction,
    authorizeCustodyTransfer,
    validateHardwarePolicy,
    resolveEffectiveHardwarePolicy,
    getNpcHullRoleSlots,
    validateNpcHullSpecificFit,
    resolveNpcChargeCapacity,
    buildCustody,
    isCustodiedRecord,
  },
};
