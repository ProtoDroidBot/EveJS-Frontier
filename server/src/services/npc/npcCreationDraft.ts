"use strict";

const path = require("path");
const crypto = require("node:crypto");
const nativeNpcStore = require(path.join(__dirname, "../../space/npc/nativeNpcStore"));
const itemStore = require(path.join(__dirname, "../inventory/itemStore"));
const { resolveItemByTypeID } = require(path.join(__dirname, "../inventory/itemTypeRegistry"));
const npcFitting = require(path.join(__dirname, "../../space/npc/npcFittingService"));
const { getCreationTemplate } = require(path.join(__dirname, "../frontier/creationStaticData"));
const {
  CREATION_FITTING_FLAG_ID,
  buildCreationSeedPlan,
  buildSeededCreationState,
  normalizeCreationState,
  stageCreationChanges,
} = require(path.join(__dirname, "../frontier/creationRuntime"));
const { validateCreationLayout } = require(path.join(__dirname, "../frontier/creationLayoutValidation"));

function positive(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : 0;
}

function diagnostic(code, change = null, reason = null) {
  return {
    code,
    severity: "blocker",
    moduleItemID: positive(change?.itemID ?? change?.attachedItemID) || null,
    changeOp: change?.op ? String(change.op) : null,
    retryAt: null,
    params: reason ? { reason } : {},
  };
}

function creationTemplateForHull(fittingHull) {
  const typeID = positive(fittingHull?.typeID);
  return typeID ? getCreationTemplate(typeID) : null;
}

function moduleMatchesState(entityID, module) {
  const record = nativeNpcStore.getNativeModule(positive(module?.itemID));
  return record && positive(record.entityID) === entityID &&
    positive(record.typeID) === positive(module?.typeID) &&
    Number(record.flagID) === CREATION_FITTING_FLAG_ID;
}

function ensureNpcCreationState(entityRecord, fittingHull, options: Record<string, any> = {}) {
  const template = creationTemplateForHull(fittingHull);
  if (!template) return { success: false, errorMsg: "NPC_CREATION_TEMPLATE_MISSING" };
  const entityID = positive(entityRecord?.entityID);
  const latest = nativeNpcStore.getNativeEntity(entityID) || entityRecord;
  if (latest.npcCreationState) {
    const state = normalizeCreationState(latest.npcCreationState);
    if (positive(state.templateTypeID) !== positive(fittingHull.typeID) ||
        state.modules.some((module) => !moduleMatchesState(entityID, module))) {
      return { success: false, errorMsg: "NPC_CREATION_STATE_STALE" };
    }
    return { success: true, data: { state, template, entityRecord: latest } };
  }

  // A Creation NPC starts with the authored template's actual equipment. Reuse
  // matching native modules before allocating the missing default modules.
  const plan = buildCreationSeedPlan(template);
  const available = nativeNpcStore.listNativeModulesForEntity(entityID)
    .filter((record) => !record.custody && positive(record.typeID) &&
      Number(record.flagID) === CREATION_FITTING_FLAG_ID);
  const used = new Set();
  const createdItems = [];
  for (const entry of plan) {
    let record = available.find((candidate) =>
      !used.has(candidate.moduleID) && positive(candidate.typeID) === entry.typeID);
    if (!record) {
      const allocated = nativeNpcStore.allocateModuleID();
      if (!allocated.success) return allocated;
      const moduleID = positive(allocated.data);
      const profile = npcFitting.resolveNpcEquipmentProfile({
        itemID: moduleID, typeID: entry.typeID, categoryID: 7,
      });
      const moduleType = resolveItemByTypeID(entry.typeID);
      record = {
        moduleID,
        entityID,
        ownerID: positive(latest.ownerID) || positive(latest.npcCharacterID),
        typeID: entry.typeID,
        groupID: positive(moduleType?.groupID),
        categoryID: 7,
        itemName: String(moduleType?.name || `Creation module ${entry.typeID}`),
        flagID: CREATION_FITTING_FLAG_ID,
        singleton: true,
        transient: latest.transient === true,
        semanticRole: profile.semanticRole,
        semanticRoles: profile.semanticRoles,
        equipmentArchitecture: "creation",
        creationModuleProfile: profile.creationModuleProfile,
        moduleState: { online: true },
      };
      const stored = nativeNpcStore.upsertNativeModule(record, {
        durable: options.durable !== false && latest.transient !== true,
      });
      if (!stored.success) return stored;
    }
    used.add(record.moduleID);
    createdItems.push({ itemID: record.moduleID, typeID: record.typeID });
  }
  const state = buildSeededCreationState(template, entityID, plan, createdItems);
  const blockers = validateCreationLayout(state, template)
    .filter((entry) => entry.severity === "blocker");
  if (blockers.length) {
    return { success: false, errorMsg: "NPC_CREATION_SEED_INVALID", data: blockers };
  }
  const stored = nativeNpcStore.upsertNativeEntity({ ...latest, npcCreationState: state }, {
    durable: options.durable !== false && latest.transient !== true,
  });
  if (!stored.success) return stored;
  return { success: true, data: { state, template,
    entityRecord: nativeNpcStore.getNativeEntity(entityID) || { ...latest, npcCreationState: state } } };
}

function stageNpcCreationDraft(context, changes, dependencies: Record<string, any> = {}) {
  const ensured = ensureNpcCreationState(context.entityRecord, context.fittingHull);
  if (!ensured.success) return { success: false, diagnostics: [
    diagnostic("invalid_post_commit_state", null, ensured.errorMsg),
  ] };
  if (!Array.isArray(changes) || changes.length > 64) {
    return { success: false, diagnostics: [diagnostic("invalid_post_commit_state")] };
  }
  const entityID = positive(context.entityRecord.entityID);
  const actorID = positive(context.actor.characterID);
  const targetPilotID = positive(context.entityRecord.npcCharacterID);
  const allowedOwnerIDs = new Set([actorID]);
  if (context.actor.kind === "npc" && targetPilotID &&
      Array.isArray(context.actor.authorizedNpcOwnerIDs) &&
      context.actor.authorizedNpcOwnerIDs.some((id) => positive(id) === targetPilotID)) {
    allowedOwnerIDs.add(targetPilotID);
  }
  const shipID = positive(context.interaction.shipID);
  const store = dependencies.itemStore || itemStore;
  const cargoFlag = store.ITEM_FLAGS.CARGO_HOLD;
  for (const change of changes) {
    const op = String(change?.op || "").toLowerCase();
    const itemID = positive(
      op === "attach" || op === "detach" ? change?.attachedItemID : change?.itemID,
    );
    if (op === "add" || op === "attach") {
      const source = store.findItemById(itemID);
      if (!source || !allowedOwnerIDs.has(positive(source.ownerID)) ||
          positive(source.locationID) !== shipID ||
          Number(source.flagID) !== Number(cargoFlag) ||
          positive(source.typeID) !== positive(change.typeID) ||
          positive(source.categoryID) !== 7) {
        return { success: false, diagnostics: [diagnostic("item_unavailable", change)] };
      }
    }
    if (op === "remove" || op === "detach") {
      const record = nativeNpcStore.getNativeModule(itemID);
      if (!record || positive(record.entityID) !== entityID || !record.custody ||
          !allowedOwnerIDs.has(positive(record.ownerID))) {
        return { success: false, diagnostics: [diagnostic("item_unavailable", change)] };
      }
      if (change.destLocationID != null && positive(change.destLocationID) !== shipID ||
          change.destFlagID != null && Number(change.destFlagID) !== Number(cargoFlag)) {
        return { success: false, diagnostics: [diagnostic("item_unavailable", change)] };
      }
    }
  }
  const staged = stageCreationChanges(
    ensured.data.state, ensured.data.template, entityID, actorID, changes,
    { allowedOwnerIDs: [...allowedOwnerIDs] },
  );
  if (staged.diagnostic) return { success: false, diagnostics: [staged.diagnostic] };
  const actionIDs = staged.inventoryActions.map((action) => positive(action?.item?.itemID));
  if (actionIDs.some((itemID) => !itemID) || new Set(actionIDs).size !== actionIDs.length) {
    return { success: false, diagnostics: [diagnostic("duplicate_change")] };
  }
  const blockers = validateCreationLayout(staged.state, ensured.data.template)
    .filter((entry) => entry.severity === "blocker");
  if (blockers.length) return { success: false, diagnostics: blockers };
  return { success: true, data: { ...ensured.data, state: staged.state,
    inventoryActions: staged.inventoryActions } };
}

function commitNpcCreationDraft(context, changes, dependencies: Record<string, any> = {}) {
  const staged = stageNpcCreationDraft(context, changes, dependencies);
  if (!staged.success) return staged;
  const { state, inventoryActions } = staged.data;
  const entityID = positive(context.entityRecord.entityID);
  const actorID = positive(context.actor.characterID);
  const fitting = dependencies.npcFitting || npcFitting;
  const cargoFlag = (dependencies.itemStore || itemStore).ITEM_FLAGS.CARGO_HOLD;
  const applied = [];
  const execute = (action, reverse = false) => {
    const fittingInput = {
      entityID,
      actor: context.actor,
      idempotencyKey: `npc-creation:${entityID}:${actorID}:${crypto.randomUUID()}`,
    };
    const fit = reverse ? !action.fitToCreation : action.fitToCreation;
    return fit
      ? fitting.fitItemToNpc({ ...fittingInput, itemID: action.item.itemID,
        targetFlagID: CREATION_FITTING_FLAG_ID, creationDraft: true })
      : fitting.unfitItemFromNpc({ ...fittingInput, moduleID: action.item.itemID,
        destinationLocationID: positive(context.interaction.shipID),
        destinationFlagID: cargoFlag });
  };
  const rollBack = () => {
    for (const action of [...applied].reverse()) {
      const result = execute(action, true);
      if (!result?.success) return result?.errorMsg || "NPC_CREATION_ROLLBACK_FAILED";
    }
    return null;
  };
  for (const action of inventoryActions) {
    const result = execute(action);
    if (!result?.success) {
      const rollbackError = rollBack();
      return { success: false, diagnostics: [diagnostic(
        "item_unavailable", changes.find((change) => positive(
          change?.itemID ?? change?.attachedItemID,
        ) === positive(action.item.itemID)),
        rollbackError || result?.errorMsg || "NPC_CREATION_FIT_FAILED",
      )] };
    }
    applied.push(action);
  }
  const latest = nativeNpcStore.getNativeEntity(entityID) || context.entityRecord;
  const stored = nativeNpcStore.upsertNativeEntity({ ...latest, npcCreationState: state }, {
    durable: latest.transient !== true,
  });
  if (!stored.success) {
    const rollbackError = rollBack();
    return { success: false, diagnostics: [diagnostic(
      "invalid_post_commit_state", null,
      rollbackError || stored.errorMsg || "NPC_CREATION_WRITE_FAILED",
    )] };
  }
  return { success: true, diagnostics: [] };
}

module.exports = {
  creationTemplateForHull,
  ensureNpcCreationState,
  stageNpcCreationDraft,
  commitNpcCreationDraft,
};
