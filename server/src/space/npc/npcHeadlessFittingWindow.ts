"use strict";

const crypto = require("node:crypto");
const npcFitting = require("./npcFittingService");
const nativeNpcStore = require("./nativeNpcStore");
const { getNpcPilotIdentityStore } = require("./npcPilotIdentityStore");
const fittingTrust = require("./npcFittingTrust");
const spaceRuntime = require("../runtime");
const { canEntitiesInteractLocally } = require("../destiny/identity/interactionScope");
const { isNpcCharacterID } = require("../../services/_shared/npcIdentityConstants");
const itemStore = require("../../services/inventory/itemStore");
const { getCreationTemplate } = require("../../services/frontier/creationStaticData");
const npcCreationDraft = require("../../services/npc/npcCreationDraft");

const MAX_RANGE_METERS = 5_000;
const CREATION_HULL_TYPE_IDS = new Set([95276, 95735, 95968]);

function positive(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : 0;
}

function denied(errorMsg) {
  return { success: false, errorMsg };
}

function surfaceDistance(left, right) {
  const a = left?.position;
  const b = right?.position;
  if (!a || !b) return Number.POSITIVE_INFINITY;
  const dx = Number(a.x) - Number(b.x);
  const dy = Number(a.y) - Number(b.y);
  const dz = Number(a.z) - Number(b.z);
  const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
  return Number.isFinite(distance)
    ? Math.max(0, distance - Math.max(0, Number(left.radius) || 0) -
      Math.max(0, Number(right.radius) || 0))
    : Number.POSITIVE_INFINITY;
}

function fittingPath(hull) {
  const typeID = positive(hull?.typeID);
  return CREATION_HULL_TYPE_IDS.has(typeID) || typeID && getCreationTemplate(typeID)
    ? "creation" : "legacy";
}

/** A server-only fitting view for one active NPC pilot and one fixed NPC ship. */
function openNpcHeadlessFittingWindow(input: Record<string, any>, dependencies: Record<string, any> = {}) {
  const actorEntityID = positive(input?.actorEntityID);
  const targetEntityID = positive(input?.targetEntityID) || actorEntityID;
  if (!actorEntityID || !targetEntityID) return denied("NPC_FITTING_ENTITY_REQUIRED");

  const fitting = dependencies.npcFitting || npcFitting;
  const entities = dependencies.nativeNpcStore || nativeNpcStore;
  const pilots = dependencies.npcPilots || getNpcPilotIdentityStore();
  const trustService = dependencies.trust || fittingTrust;
  const inventory = dependencies.itemStore || itemStore;
  const drafts = dependencies.npcCreationDraft || npcCreationDraft;
  const getLiveEntity = dependencies.getLiveEntity || ((record) =>
    spaceRuntime.scenes.get(positive(record.systemID))?.getEntityByID(record.entityID));
  const isLocal = dependencies.canEntitiesInteractLocally || canEntitiesInteractLocally;
  let closed = false;
  let actorIncarnation = 0;
  let targetIncarnation = 0;

  function activePilot(record) {
    if (!record || positive(record.categoryID) !== 6 ||
        !isNpcCharacterID(positive(record.npcCharacterID))) return null;
    let pilot;
    try {
      pilot = pilots.get(positive(record.npcCharacterID));
    } catch (_) {
      return null;
    }
    if (!pilot || positive(pilot.characterID) !== positive(record.npcCharacterID) ||
        positive(pilot.activeEntityID) !== positive(record.entityID) ||
        positive(pilot.incarnation) !== positive(record.npcIncarnation)) return null;
    return pilot;
  }

  function context() {
    if (closed) return denied("NPC_FITTING_WINDOW_CLOSED");
    const actorRecord = entities.getNativeEntity(actorEntityID);
    const actorPilot = activePilot(actorRecord);
    if (!actorPilot) return denied("NPC_FITTING_ACTOR_PILOT_REQUIRED");
    const resolved = fitting.resolveNpcFittingEntity(targetEntityID);
    if (!resolved?.success) return resolved || denied("NPC_DURABLE_ENTITY_NOT_FOUND");
    const { entityRecord, fittingHull } = resolved.data;
    const targetPilot = activePilot(entityRecord);
    if (!targetPilot) return denied("NPC_PILOT_REQUIRED");
    if (actorIncarnation && (actorIncarnation !== positive(actorPilot.incarnation) ||
        targetIncarnation !== positive(targetPilot.incarnation))) {
      return denied("NPC_FITTING_PILOT_CHANGED");
    }
    if (positive(actorRecord.systemID) !== positive(entityRecord.systemID)) {
      return denied("NPC_FITTING_NOT_LOCAL");
    }
    let actorEntity;
    let targetEntity;
    try {
      actorEntity = getLiveEntity(actorRecord);
      targetEntity = getLiveEntity(entityRecord);
    } catch (_) {
      return denied("NPC_FITTING_NOT_LOCAL");
    }
    if (!actorEntity || !targetEntity ||
        !isLocal(actorEntity, targetEntity) ||
        actorEntity.bubbleID && targetEntity.bubbleID &&
          actorEntity.bubbleID !== targetEntity.bubbleID ||
        actorEntity.mode === "WARP" || targetEntity.mode === "WARP") {
      return denied("NPC_FITTING_NOT_LOCAL");
    }
    const self = actorEntityID === targetEntityID;
    if (!self && surfaceDistance(actorEntity, targetEntity) > MAX_RANGE_METERS) {
      return denied("NPC_FITTING_OUT_OF_RANGE");
    }
    const actor = {
      kind: "npc",
      characterID: positive(actorPilot.characterID),
      shipEntityID: actorEntityID,
      npcIncarnation: positive(actorPilot.incarnation),
      factionID: positive(actorPilot.factionID),
      factionKey: actorPilot.factionKey || null,
      authorizedNpcOwnerIDs: [positive(targetPilot.characterID)],
    };
    if (!self) {
      const trust = trustService.evaluateNpcFittingTrust(entityRecord, actor, {
        interaction: { shipID: actorEntityID, shipEntity: actorEntity,
          npcEntity: targetEntity },
      });
      if (trust?.trusted !== true || trust.reason === "debug-nearby-player") {
        return denied("NPC_FITTING_TRUST_REQUIRED");
      }
    }
    return { success: true, data: {
      actor, actorRecord, actorPilot, entityRecord, targetPilot, fittingHull,
      interaction: { shipID: actorEntityID, shipEntity: actorEntity,
        npcEntity: targetEntity },
    } };
  }

  function availableItems(contextData) {
    const ownerIDs = new Set([
      contextData.actor.characterID,
      contextData.targetPilot.characterID,
    ]);
    return [...ownerIDs].flatMap((ownerID) => inventory.listOwnedItems(ownerID, {
      locationID: actorEntityID,
      flagID: inventory.ITEM_FLAGS.CARGO_HOLD,
    })).filter((item) => [7, 8].includes(positive(item?.categoryID))).slice(0, 200);
  }

  function requireCargoItem(contextData, itemID, categoryID) {
    const item = inventory.findItemById(positive(itemID));
    const allowedOwners = new Set([
      contextData.actor.characterID,
      contextData.targetPilot.characterID,
    ]);
    if (!item || !allowedOwners.has(positive(item.ownerID)) ||
        positive(item.locationID) !== actorEntityID ||
        Number(item.flagID) !== Number(inventory.ITEM_FLAGS.CARGO_HOLD)) {
      return denied("NPC_FITTING_ITEM_NOT_IN_ACTIVE_SHIP");
    }
    if (positive(item.categoryID) !== categoryID) {
      return denied(categoryID === 7 ? "NPC_FITTING_MODULE_REQUIRED" :
        "NPC_CHARGE_ITEM_REQUIRED");
    }
    return { success: true, data: item };
  }

  function mutate(operation) {
    const resolved = context();
    if (!resolved.success) return resolved;
    return operation(resolved.data);
  }

  const opened = context();
  if (!opened.success) return opened;
  actorIncarnation = positive(opened.data.actorPilot.incarnation);
  targetIncarnation = positive(opened.data.targetPilot.incarnation);

  const window = {
    kind: "npc-headless-fitting-window",
    actorEntityID,
    targetEntityID,
    refresh() {
      return mutate((ctx) => ({ success: true, data: {
        actorCharacterID: ctx.actor.characterID,
        targetCharacterID: ctx.targetPilot.characterID,
        entityID: targetEntityID,
        hullTypeID: positive(ctx.fittingHull.typeID),
        fittingPath: fittingPath(ctx.fittingHull),
        modules: fitting.listNpcEquipment(targetEntityID),
        availableItems: availableItems(ctx),
      } }));
    },
    getCreationDraft() {
      return mutate((ctx) => fittingPath(ctx.fittingHull) === "creation"
        ? drafts.ensureNpcCreationState(ctx.entityRecord, ctx.fittingHull)
        : denied("NPC_CREATION_DRAFT_REQUIRED"));
    },
    commitCreationDraft(changes) {
      return mutate((ctx) => {
        if (fittingPath(ctx.fittingHull) !== "creation") {
          return denied("NPC_CREATION_DRAFT_REQUIRED");
        }
        if (!Array.isArray(changes)) return denied("NPC_CREATION_DRAFT_INVALID");
        return drafts.commitNpcCreationDraft(ctx, changes, {
          npcFitting: fitting, itemStore: inventory,
        });
      });
    },
    fitItem(itemID, targetFlagID = 0) {
      return mutate((ctx) => {
        if (fittingPath(ctx.fittingHull) === "creation") {
          return denied("NPC_CREATION_DRAFT_REQUIRED");
        }
        const item = requireCargoItem(ctx, itemID, 7);
        if (!item.success) return item;
        return fitting.fitItemToNpc({ entityID: targetEntityID,
          itemID: positive(itemID), targetFlagID: positive(targetFlagID) || undefined,
          actor: ctx.actor,
          idempotencyKey: `npc-headless-fit:${ctx.actor.characterID}:${crypto.randomUUID()}` });
      });
    },
    unfitItem(moduleID) {
      return mutate((ctx) => fittingPath(ctx.fittingHull) === "creation"
        ? denied("NPC_CREATION_DRAFT_REQUIRED")
        : fitting.unfitItemFromNpc({ entityID: targetEntityID,
          moduleID: positive(moduleID), actor: ctx.actor,
          destinationLocationID: actorEntityID,
          destinationFlagID: inventory.ITEM_FLAGS.CARGO_HOLD,
          idempotencyKey: `npc-headless-unfit:${ctx.actor.characterID}:${crypto.randomUUID()}` }));
    },
    loadCharge(moduleID, itemID, quantity = 0) {
      return mutate((ctx) => {
        const item = requireCargoItem(ctx, itemID, 8);
        if (!item.success) return item;
        return fitting.loadChargeToNpcModule({ entityID: targetEntityID,
          moduleID: positive(moduleID), itemID: positive(itemID),
          quantity: positive(quantity) || undefined, actor: ctx.actor,
          idempotencyKey: `npc-headless-load:${ctx.actor.characterID}:${crypto.randomUUID()}` });
      });
    },
    unloadCharge(cargoID) {
      return mutate((ctx) => fitting.unloadChargeFromNpcModule({
        entityID: targetEntityID, cargoID: positive(cargoID), actor: ctx.actor,
        idempotencyKey: `npc-headless-unload:${ctx.actor.characterID}:${crypto.randomUUID()}`,
      }));
    },
    close() {
      closed = true;
      return { success: true };
    },
  };
  return { success: true, data: window };
}

module.exports = { openNpcHeadlessFittingWindow };
