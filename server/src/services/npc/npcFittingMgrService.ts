"use strict";

const crypto = require("crypto");
const path = require("path");

const BaseService = require(path.join(__dirname, "../baseService"));
const { throwWrappedUserError } = require(path.join(__dirname, "../../common/machoErrors"));
const {
  buildDict,
  buildList,
  unwrapMarshalValue,
} = require(path.join(__dirname, "../_shared/serviceHelpers"));
const npcFitting = require(path.join(__dirname, "../../space/npc/npcFittingService"));
const fittingTrust = require(path.join(__dirname, "../../space/npc/npcFittingTrust"));
const npcFactionConfig = require(path.join(__dirname, "../../config/npcFactionConfig"));
const nativeNpcStore = require(path.join(__dirname, "../../space/npc/nativeNpcStore"));
const npcPersistence = require(path.join(__dirname, "../../space/npc/npcRuntimePersistence"));
const npcService = require(path.join(__dirname, "../../space/npc/npcService"));
const itemStore = require(path.join(__dirname, "../inventory/itemStore"));
const characterState = require(path.join(__dirname, "../character/characterState"));
const spaceRuntime = require(path.join(__dirname, "../../space/runtime"));
const {
  canEntitiesInteractLocally,
} = require(path.join(__dirname, "../../space/destiny/identity/interactionScope"));

const NPC_FITTING_INTERACTION_RANGE_METERS = 5_000;
const MAX_AVAILABLE_ITEMS = 200;
const MODULE_CATEGORY_ID = 7;
const CHARGE_CATEGORY_ID = 8;
const NPC_ORDER_MAX_RANGE_METERS = 250_000;
const NPC_PLAYER_ORDERS = Object.freeze({
  approach: { needsTarget: true, defaultRangeMeters: 0 },
  keepAtRange: { needsTarget: true, defaultRangeMeters: 2_500 },
  orbit: { needsTarget: true, defaultRangeMeters: 2_500 },
  lock: { needsTarget: true, defaultRangeMeters: 0 },
  resume: { needsTarget: false, defaultRangeMeters: 0 },
});

const ERROR_MESSAGES = Object.freeze({
  NPC_DURABLE_ENTITY_NOT_FOUND: "That NPC is no longer available.",
  NPC_FITTING_NOT_LOCAL: "You must be near that NPC to manage its fitting.",
  NPC_FITTING_OUT_OF_RANGE: "Move within 5,000 meters of that NPC to manage its fitting.",
  NPC_FITTING_TRUST_REQUIRED: "That NPC does not currently trust you to manage its fitting.",
  NPC_FITTING_ITEM_NOT_IN_ACTIVE_SHIP: "The item must be in your active ship's cargo hold.",
  NPC_FITTING_MODULE_REQUIRED: "Select a module from your active ship's cargo hold.",
  NPC_ORDER_INVALID: "That NPC order is not available.",
  NPC_ORDER_TARGET_INVALID: "Select a valid target in the NPC's current space scene.",
  NPC_ORDER_RANGE_INVALID: "Order range must be between 0 and 250,000 meters.",
  NPC_NOT_FOUND: "That NPC's behavior controller is unavailable.",
  NPC_CHARGE_ITEM_REQUIRED: "Select ammunition or fuel from your active ship's cargo hold.",
});

function toPositiveInt(value) {
  const numeric = Math.trunc(Number(value) || 0);
  return numeric > 0 ? numeric : 0;
}

function toMarshalValue(value) {
  if (Array.isArray(value)) return buildList(value.map(toMarshalValue));
  if (value && typeof value === "object") {
    return buildDict(
      Object.entries<any>(value).map(([key, entry]) => [key, toMarshalValue(entry)]),
    );
  }
  return value;
}

function positionalArgs(args) {
  const value = unwrapMarshalValue(args);
  return Array.isArray(value) ? value : [];
}

function sessionCharacterID(session) {
  return toPositiveInt(session && (session.characterID ?? session.charid));
}

function sessionShipID(session) {
  return toPositiveInt(session && (
    session._space?.shipID ?? session.shipID ?? session.shipid
  ));
}

function sessionSystemID(session) {
  return toPositiveInt(session && (
    session._space?.systemID ?? session.solarsystemid ?? session.solarSystemID
  ));
}

function buildActor(session) {
  const characterID = sessionCharacterID(session);
  const record = characterID ? characterState.getCharacterRecord(characterID) : null;
  const corporationID = toPositiveInt(
    record?.corporationID ?? session?.corporationID ?? session?.corpid,
  );
  const tribeID = toPositiveInt(
    record?.suiTribeId ?? record?.tribeID ?? session?.tribeID ?? session?.tribeId ?? corporationID,
  );
  const factionID = toPositiveInt(
    (record && characterState.deriveFactionID(record)) ?? session?.factionID,
  );
  const factionKey = String(
    record?.factionKey ?? record?.suiFactionKey ?? session?.factionKey ?? "",
  ).trim().toLowerCase() || null;
  return {
    kind: "player",
    characterID,
    corporationID,
    tribeID,
    factionID,
    factionKey,
    authorizedOwnerIDs: [...new Set([corporationID, tribeID].filter(Boolean))],
  };
}

function vectorDistance(left, right) {
  if (!left || !right) return Number.POSITIVE_INFINITY;
  const dx = Number(left.x) - Number(right.x);
  const dy = Number(left.y) - Number(right.y);
  const dz = Number(left.z) - Number(right.z);
  return Number.isFinite(dx) && Number.isFinite(dy) && Number.isFinite(dz)
    ? Math.sqrt(dx * dx + dy * dy + dz * dz)
    : Number.POSITIVE_INFINITY;
}

function surfaceDistance(left, right) {
  return Math.max(
    0,
    vectorDistance(left && left.position, right && right.position) -
      Math.max(0, Number(left && left.radius) || 0) -
      Math.max(0, Number(right && right.radius) || 0),
  );
}

function defaultAuthorizeInteraction(session, entityRecord) {
  const systemID = sessionSystemID(session);
  if (!systemID || systemID !== toPositiveInt(entityRecord && entityRecord.systemID)) {
    return { success: false, errorMsg: "NPC_FITTING_NOT_LOCAL" };
  }
  const shipID = sessionShipID(session);
  const shipEntity = shipID ? spaceRuntime.getEntity(session, shipID) : null;
  const npcEntity = spaceRuntime.getEntity(session, entityRecord.entityID);
  if (!shipEntity || !npcEntity || !canEntitiesInteractLocally(shipEntity, npcEntity)) {
    return { success: false, errorMsg: "NPC_FITTING_NOT_LOCAL" };
  }
  const distanceMeters = surfaceDistance(shipEntity, npcEntity);
  if (distanceMeters > NPC_FITTING_INTERACTION_RANGE_METERS) {
    return {
      success: false,
      errorMsg: "NPC_FITTING_OUT_OF_RANGE",
      data: { distanceMeters },
    };
  }
  return { success: true, data: { shipID, shipEntity, npcEntity, distanceMeters } };
}

function sanitizeCharge(record) {
  return {
    cargoID: toPositiveInt(record && record.cargoID),
    moduleID: toPositiveInt(record && record.moduleID),
    typeID: toPositiveInt(record && record.typeID),
    itemName: String(record && record.itemName || "Charge"),
    quantity: Math.max(0, Math.trunc(Number(record && record.quantity) || 0)),
    semanticRole: String(record && record.semanticRole || "ammunition"),
  };
}

function sanitizeModule(record) {
  const semanticRole = String(record && record.semanticRole || "passive");
  const semanticRoles = [...new Set(
    (Array.isArray(record && record.semanticRoles)
      ? record.semanticRoles
      : [semanticRole])
      .map((role) => String(role || "").trim().toLowerCase())
      .filter(Boolean),
  )];
  return {
    moduleID: toPositiveInt(record && record.moduleID),
    typeID: toPositiveInt(record && record.typeID),
    itemName: String(record && record.itemName || "Module"),
    flagID: toPositiveInt(record && record.flagID),
    semanticRole,
    semanticRoles,
    equipmentArchitecture: String(
      record && record.equipmentArchitecture || "legacy",
    ),
    online: Boolean(record && record.moduleState && record.moduleState.online === true),
    usable: Boolean(record && record.usable === true),
    useDisabledReason: record && record.useDisabledReason
      ? String(record.useDisabledReason)
      : null,
    charges: (Array.isArray(record && record.charges) ? record.charges : [])
      .map(sanitizeCharge),
  };
}

function sanitizeAvailableItem(item, equipmentProfile = null) {
  const sanitized: Record<string, any> = {
    itemID: toPositiveInt(item && item.itemID),
    typeID: toPositiveInt(item && item.typeID),
    itemName: String(item && item.itemName || "Item"),
    categoryID: toPositiveInt(item && item.categoryID),
    groupID: toPositiveInt(item && item.groupID),
    quantity: item && item.singleton === 1
      ? 1
      : Math.max(0, Math.trunc(Number(item && item.stacksize) || 0)),
  };
  if (equipmentProfile && equipmentProfile.semanticRole) {
    sanitized.semanticRole = String(equipmentProfile.semanticRole);
    sanitized.semanticRoles = Array.isArray(equipmentProfile.semanticRoles)
      ? [...equipmentProfile.semanticRoles]
      : [sanitized.semanticRole];
    sanitized.equipmentArchitecture = String(
      equipmentProfile.equipmentArchitecture || "legacy",
    );
  }
  return sanitized;
}

function throwFittingError(result) {
  const reason = String(result && result.errorMsg || "NPC_FITTING_FAILED");
  throwWrappedUserError("CustomNotify", {
    notify: ERROR_MESSAGES[reason] || `NPC fitting failed: ${reason}`,
  });
}

function normalizePlayerNpcOrder(input) {
  const request = input && typeof input === "object" ? input : {};
  const type = String(request.type || "").trim();
  const definition = Object.hasOwn(NPC_PLAYER_ORDERS, type)
    ? NPC_PLAYER_ORDERS[type]
    : null;
  if (!definition) return { success: false, errorMsg: "NPC_ORDER_INVALID" };
  const targetID = definition.needsTarget ? toPositiveInt(request.targetID) : 0;
  if (definition.needsTarget && !targetID) {
    return { success: false, errorMsg: "NPC_ORDER_TARGET_INVALID" };
  }
  const rawRange = request.rangeMeters == null || request.rangeMeters === ""
    ? definition.defaultRangeMeters
    : Number(request.rangeMeters);
  if (!Number.isFinite(rawRange) || rawRange < 0 || rawRange > NPC_ORDER_MAX_RANGE_METERS) {
    return { success: false, errorMsg: "NPC_ORDER_RANGE_INVALID" };
  }
  const rangeMeters = type === "keepAtRange" || type === "orbit"
    ? Math.max(1, Math.trunc(rawRange))
    : 0;
  return {
    success: true,
    data: {
      type,
      targetID,
      ...(type === "keepAtRange" ? { followRangeMeters: rangeMeters } : {}),
      ...(type === "orbit" ? { orbitDistanceMeters: rangeMeters } : {}),
      allowWeapons: false,
      keepLock: type === "lock",
    },
  };
}

class NpcFittingMgrService extends BaseService {
  declare _npcFitting: any;
  declare _trust: any;
  declare _itemStore: any;
  declare _authorizeInteraction: any;
  declare _orders: any;

  constructor(dependencies: Record<string, any> = {}) {
    super("npcFittingMgr");
    this._npcFitting = dependencies.npcFitting || npcFitting;
    this._trust = dependencies.trust || fittingTrust;
    this._itemStore = dependencies.itemStore || itemStore;
    this._authorizeInteraction = dependencies.authorizeInteraction || defaultAuthorizeInteraction;
    this._orders = dependencies.orders || npcService;
  }

  _resolveContext(session, entityID) {
    const resolved = this._npcFitting.resolveNpcFittingEntity(entityID);
    if (!resolved || resolved.success !== true) return resolved;
    const actor = buildActor(session);
    if (!actor.characterID) return { success: false, errorMsg: "NPC_FITTING_TRUST_REQUIRED" };
    const interaction = this._authorizeInteraction(session, resolved.data.entityRecord);
    if (!interaction || interaction.success !== true) return interaction;
    const trust = this._trust.evaluateNpcFittingTrust(
      resolved.data.entityRecord,
      actor,
      { session, interaction: interaction.data || null },
    );
    if (!trust || trust.trusted !== true) {
      return {
        success: false,
        errorMsg: "NPC_FITTING_TRUST_REQUIRED",
        data: { trustReason: trust && trust.reason || "no-positive-trust" },
      };
    }
    return {
      success: true,
      data: {
        ...resolved.data,
        actor,
        interaction: interaction.data || {},
        trust,
      },
    };
  }

  _availableItems(context) {
    const shipID = toPositiveInt(context.interaction.shipID);
    if (!shipID) return [];
    return this._itemStore.listOwnedItems(context.actor.characterID, {
      locationID: shipID,
      flagID: this._itemStore.ITEM_FLAGS.CARGO_HOLD,
    }).filter((item) => [MODULE_CATEGORY_ID, CHARGE_CATEGORY_ID].includes(
      toPositiveInt(item && item.categoryID),
    )).slice(0, MAX_AVAILABLE_ITEMS);
  }

  _requireCargoItem(context, itemID, categoryID) {
    const item = this._itemStore.findItemById(toPositiveInt(itemID));
    if (
      !item ||
      toPositiveInt(item.ownerID) !== context.actor.characterID ||
      toPositiveInt(item.locationID) !== toPositiveInt(context.interaction.shipID) ||
      Number(item.flagID) !== Number(this._itemStore.ITEM_FLAGS.CARGO_HOLD)
    ) {
      return { success: false, errorMsg: "NPC_FITTING_ITEM_NOT_IN_ACTIVE_SHIP" };
    }
    if (toPositiveInt(item.categoryID) !== categoryID) {
      return {
        success: false,
        errorMsg: categoryID === MODULE_CATEGORY_ID
          ? "NPC_FITTING_MODULE_REQUIRED"
          : "NPC_CHARGE_ITEM_REQUIRED",
      };
    }
    return { success: true, data: item };
  }

  _buildState(context) {
    const { entityRecord, fittingHull, trust } = context;
    const available = this._availableItems(context);
    const policy = this._npcFitting.resolveEffectiveHardwarePolicy(entityRecord);
    const restrictions = entityRecord.npcFittingRestrictions || {};
    return {
      trusted: true,
      trustReason: trust.reason,
      entityID: toPositiveInt(entityRecord.entityID),
      npcCharacterID: toPositiveInt(entityRecord.npcCharacterID),
      displayName: String(
        entityRecord.itemName || entityRecord.name || fittingHull.itemName || "NPC ship",
      ),
      hull: {
        typeID: toPositiveInt(fittingHull.typeID),
        physicalTypeID: toPositiveInt(fittingHull.npcPhysicalHullTypeID),
        fittingProfileID: fittingHull.npcFittingProfileID || null,
        cpuOutput: Math.max(0, Number(restrictions.cpuOutput) || 0),
        powerOutput: Math.max(0, Number(restrictions.powerOutput) || 0),
        roleSlots: restrictions.roleSlots || {},
      },
      policy: {
        allowPlayerOwned: policy.allowPlayerOwned === true,
        allowedRoles: Array.isArray(policy.allowedRoles) ? [...policy.allowedRoles] : [],
        allowedTypeIDs: Array.isArray(policy.allowedTypeIDs) ? [...policy.allowedTypeIDs] : [],
        deniedTypeIDs: Array.isArray(policy.deniedTypeIDs) ? [...policy.deniedTypeIDs] : [],
      },
      modules: this._npcFitting.listNpcEquipment(entityRecord.entityID)
        .map(sanitizeModule),
      availableModules: available
        .filter((item) => toPositiveInt(item.categoryID) === MODULE_CATEGORY_ID)
        .map((item) => sanitizeAvailableItem(
          item,
          typeof this._npcFitting.resolveNpcEquipmentProfile === "function"
            ? this._npcFitting.resolveNpcEquipmentProfile(item)
            : null,
        )),
      availableCharges: available
        .filter((item) => toPositiveInt(item.categoryID) === CHARGE_CATEGORY_ID)
        .map(sanitizeAvailableItem),
    };
  }

  _resolveOrderContext(session, entityID) {
    const entityRecord = nativeNpcStore.getNativeEntity(toPositiveInt(entityID));
    if (!entityRecord || entityRecord.transient === true ||
        npcPersistence.isNpcEntityQuarantined(entityRecord.entityID)) {
      return { success: false, errorMsg: "NPC_DURABLE_ENTITY_NOT_FOUND" };
    }
    const actor = buildActor(session);
    if (!actor.characterID) return { success: false, errorMsg: "NPC_FITTING_TRUST_REQUIRED" };
    const interaction = this._authorizeInteraction(session, entityRecord);
    if (!interaction || interaction.success !== true) return interaction;
    const trust = this._trust.evaluateNpcFittingTrust(entityRecord, actor, {
      session, interaction: interaction.data || null,
    });
    if (!trust || trust.trusted !== true) {
      return { success: false, errorMsg: "NPC_FITTING_TRUST_REQUIRED" };
    }
    return { success: true, data: { actor, entityRecord, interaction: interaction.data || {} } };
  }

  _denyState(entityID, result) {
    return {
      trusted: false,
      entityID: toPositiveInt(entityID),
      reason: String(result && result.errorMsg || "NPC_FITTING_TRUST_REQUIRED"),
    };
  }

  Handle_CanInteractNpc(args, session) {
    const [entityID] = positionalArgs(args);
    const resolved = this._npcFitting.resolveNpcFittingEntity(entityID);
    const entityRecord = resolved?.success === true
      ? resolved.data.entityRecord
      : nativeNpcStore.getNativeEntity(toPositiveInt(entityID));
    const deny = (reason) => toMarshalValue({
      canInteract: false,
      canModifyFittings: false,
      entityID: toPositiveInt(entityID),
      reason,
    });
    if (!entityRecord || entityRecord.transient === true ||
        npcPersistence.isNpcEntityQuarantined(entityRecord.entityID)) {
      return deny("NPC_DURABLE_ENTITY_NOT_FOUND");
    }
    const actor = buildActor(session);
    if (!actor.characterID) return deny("NPC_FITTING_TRUST_REQUIRED");
    const interaction = this._authorizeInteraction(session, entityRecord);
    if (!interaction || interaction.success !== true) {
      return deny(interaction?.errorMsg || "NPC_FITTING_NOT_LOCAL");
    }
    const scope = interaction.data || {};
    const trust = this._trust.evaluateNpcFittingTrust(entityRecord, actor, {
      session, interaction: scope,
    });
    const identifiedFriend = scope.shipEntity &&
      npcFactionConfig.resolveNpcTargetIdentification(
        scope.npcEntity || entityRecord, scope.shipEntity,
      ) === "ally";
    const canInteract = trust?.trusted === true || identifiedFriend === true;
    if (!canInteract) return deny("NPC_INTERACTION_NOT_FRIENDLY");
    return toMarshalValue({
      canInteract: true,
      canModifyFittings: resolved?.success === true && trust?.trusted === true,
      canIssueOrders: trust?.trusted === true,
      entityID: toPositiveInt(entityRecord.entityID),
      displayName: String(entityRecord.itemName || entityRecord.name || "NPC ship"),
    });
  }

  Handle_IssueNpcOrder(args, session) {
    const [entityID, rawOrder] = positionalArgs(args);
    const context = this._resolveOrderContext(session, entityID);
    if (!context || context.success !== true) throwFittingError(context);
    const parsed = normalizePlayerNpcOrder(rawOrder);
    if (!parsed.success) throwFittingError(parsed);
    const order = {
      ...parsed.data,
      commandSource: {
        kind: "player",
        characterID: context.data.actor.characterID,
      },
    };
    if (order.targetID) {
      const source = context.data.interaction.npcEntity;
      const target = spaceRuntime.getEntity(session, order.targetID);
      if (!source || !target || target === source ||
          order.targetID === toPositiveInt(context.data.entityRecord.entityID) ||
          !target.position ||
          !canEntitiesInteractLocally(source, target) ||
          (source.bubbleID && target.bubbleID && source.bubbleID !== target.bubbleID) ||
          target.mode === "WARP") {
        throwFittingError({ errorMsg: "NPC_ORDER_TARGET_INVALID" });
      }
    }
    const result = this._orders.issueManualOrder(context.data.entityRecord.entityID, order);
    if (!result || result.success !== true) throwFittingError(result);
    return toMarshalValue({
      accepted: true,
      entityID: toPositiveInt(entityID),
      type: order.type,
      targetID: order.targetID,
      rangeMeters: order.followRangeMeters || order.orbitDistanceMeters || 0,
    });
  }

  Handle_CanOpenNpcFitting(args, session) {
    const [entityID] = positionalArgs(args);
    const context = this._resolveContext(session, entityID);
    if (!context || context.success !== true) {
      return toMarshalValue(this._denyState(entityID, context));
    }
    return toMarshalValue({
      trusted: true,
      entityID: context.data.entityRecord.entityID,
      displayName: String(
        context.data.entityRecord.itemName || context.data.fittingHull.itemName || "NPC ship",
      ),
    });
  }

  Handle_GetNpcFittingState(args, session) {
    const [entityID] = positionalArgs(args);
    const context = this._resolveContext(session, entityID);
    return toMarshalValue(
      context && context.success === true
        ? this._buildState(context.data)
        : this._denyState(entityID, context),
    );
  }

  _mutate(session, entityID, operation) {
    const context = this._resolveContext(session, entityID);
    if (!context || context.success !== true) throwFittingError(context);
    const result = operation(context.data);
    if (!result || result.success !== true) throwFittingError(result);
    const refreshed = this._resolveContext(session, entityID);
    if (!refreshed || refreshed.success !== true) throwFittingError(refreshed);
    return toMarshalValue(this._buildState(refreshed.data));
  }

  Handle_FitItem(args, session) {
    const [entityID, itemID, targetFlagID] = positionalArgs(args);
    return this._mutate(session, entityID, (context) => {
      const item = this._requireCargoItem(context, itemID, MODULE_CATEGORY_ID);
      if (!item.success) return item;
      return this._npcFitting.fitItemToNpc({
        entityID,
        itemID,
        targetFlagID: toPositiveInt(targetFlagID) || undefined,
        actor: context.actor,
        idempotencyKey: `npc-fit-rpc:${context.actor.characterID}:${crypto.randomUUID()}`,
      });
    });
  }

  Handle_UnfitItem(args, session) {
    const [entityID, moduleID] = positionalArgs(args);
    return this._mutate(session, entityID, (context) => (
      this._npcFitting.unfitItemFromNpc({
        entityID,
        moduleID,
        actor: context.actor,
        idempotencyKey: `npc-unfit-rpc:${context.actor.characterID}:${crypto.randomUUID()}`,
      })
    ));
  }

  Handle_LoadCharge(args, session) {
    const [entityID, moduleID, itemID, quantity] = positionalArgs(args);
    return this._mutate(session, entityID, (context) => {
      const item = this._requireCargoItem(context, itemID, CHARGE_CATEGORY_ID);
      if (!item.success) return item;
      return this._npcFitting.loadChargeToNpcModule({
        entityID,
        moduleID,
        itemID,
        quantity: toPositiveInt(quantity) || undefined,
        actor: context.actor,
        idempotencyKey: `npc-load-rpc:${context.actor.characterID}:${crypto.randomUUID()}`,
      });
    });
  }

  Handle_UnloadCharge(args, session) {
    const [entityID, cargoID] = positionalArgs(args);
    return this._mutate(session, entityID, (context) => (
      this._npcFitting.unloadChargeFromNpcModule({
        entityID,
        cargoID,
        actor: context.actor,
        idempotencyKey: `npc-unload-rpc:${context.actor.characterID}:${crypto.randomUUID()}`,
      })
    ));
  }
}

module.exports = NpcFittingMgrService;
module.exports.NPC_FITTING_INTERACTION_RANGE_METERS = NPC_FITTING_INTERACTION_RANGE_METERS;
module.exports.buildActor = buildActor;
module.exports.defaultAuthorizeInteraction = defaultAuthorizeInteraction;
module.exports.toMarshalValue = toMarshalValue;
module.exports.normalizePlayerNpcOrder = normalizePlayerNpcOrder;
