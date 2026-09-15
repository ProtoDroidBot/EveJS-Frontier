"use strict";

const {
  normalizeEntityID,
} = require("../identity/entityID");
const {
  buildCloakBallPayload,
  buildOnCrDataChangePayload,
  buildOnDamageStateChangePayload,
  buildOnDbuffUpdatedPayload,
  buildOnSlimItemChangePayload,
  buildOnSpecialFXPayload,
  buildSetBallMassPayload,
  buildSetBallMassivePayload,
  buildSetMaxSpeedPayload,
  buildUncloakBallPayload,
} = require("../stream/actions");

function buildPresentationUpdate(stamp, payload) {
  return { stamp, payload };
}

function buildSingleSpecialFxPresentationUpdates(options: Record<string, any> = {}) {
  return [buildPresentationUpdate(
    options.stamp,
    buildOnSpecialFXPayload(
      options.entityID,
      options.guid,
      options.specialFxOptions,
    ),
  )];
}

function buildDbuffPresentationUpdates(options: Record<string, any> = {}) {
  return [buildPresentationUpdate(
    options.stamp,
    buildOnDbuffUpdatedPayload(options.entityID, options.dbuffState),
  )];
}

function buildDamageStatePresentationUpdates(options: Record<string, any> = {}) {
  return [buildPresentationUpdate(
    options.stamp,
    buildOnDamageStateChangePayload(options.entityID, options.damageState),
  )];
}

// Frontier updates existing balls through Park.OnCrDataChange; its client
// derives SlimItems from CR data and cannot unmarshal a wire SlimItem object.
function buildSlimItemPresentationUpdates(options: Record<string, any> = {}) {
  if (options.crData) {
    return [buildPresentationUpdate(
      options.stamp,
      buildOnCrDataChangePayload(options.entityID, options.crData),
    )];
  }
  if (!options.slimItem) {
    return [];
  }
  return [buildPresentationUpdate(
    options.stamp,
    buildOnSlimItemChangePayload(options.entityID, options.slimItem),
  )];
}

function buildStructureLifecyclePresentationUpdates(options: Record<string, any> = {}) {
  const updates: any[] = [];
  if (options.includeRepairCompleteFx === true) {
    updates.push(
      buildPresentationUpdate(
        options.stamp,
        buildOnSpecialFXPayload(
          options.entityID,
          options.repairCompleteFxGuid,
          { active: false },
        ),
      ),
      buildPresentationUpdate(
        options.stamp,
        buildOnSpecialFXPayload(
          options.entityID,
          options.ecmBurstFxGuid,
          { active: false },
        ),
      ),
    );
  }
  updates.push(
    buildPresentationUpdate(
      options.stamp,
      buildOnDamageStateChangePayload(options.entityID, options.damageState),
    ),
  );
  // Only profiles that accept wire SlimItem objects get the slim refresh; the
  // damage-state update above must survive on every profile.
  if (options.slimItem) {
    updates.push(
      buildPresentationUpdate(
        options.stamp,
        buildOnSlimItemChangePayload(options.entityID, options.slimItem),
      ),
    );
  }
  return updates;
}

function buildCloakBallPresentationUpdates(options: Record<string, any> = {}) {
  return [buildPresentationUpdate(
    options.stamp,
    buildCloakBallPayload(
      options.entityID,
      options.cloakMode,
      options.uncloakRange,
    ),
  )];
}

function buildOwnerCloakActivationPresentationUpdates(options: Record<string, any> = {}) {
  const updates: any[] = [];
  if (options.includeRenderFx !== false) {
    updates.push(buildPresentationUpdate(
      options.stamp,
      buildOnSpecialFXPayload(
        options.entityID,
        options.renderFxGuid,
        options.renderFxOptions,
      ),
    ));
  }
  updates.push(
    buildPresentationUpdate(
      options.stamp,
      buildOnSpecialFXPayload(
        options.entityID,
        options.moduleFxGuid,
        options.moduleFxOptions,
      ),
    ),
    buildPresentationUpdate(
      options.stamp,
      buildSetMaxSpeedPayload(options.entityID, options.maxSpeed),
    ),
  );
  return updates;
}

function buildOwnerUncloakPresentationUpdates(options: Record<string, any> = {}) {
  const updates: any[] = [buildPresentationUpdate(
    options.stamp,
    buildSetBallMassivePayload(options.entityID, true),
  )];
  if (options.includeRenderFx !== false) {
    updates.push(buildPresentationUpdate(
      options.stamp,
      buildOnSpecialFXPayload(
        options.entityID,
        options.renderFxGuid,
        options.renderFxOptions,
      ),
    ));
  }
  if (options.includeMaxSpeed !== false) {
    updates.push(buildPresentationUpdate(
      options.stamp,
      buildSetMaxSpeedPayload(options.entityID, options.maxSpeed),
    ));
  }
  return updates;
}

function buildCloakDeliveryPresentationUpdates(options: Record<string, any> = {}) {
  const updates: any[] = [];
  if (options.includeCloakBall !== false) {
    updates.push(buildPresentationUpdate(
      options.stamp,
      buildCloakBallPayload(
        options.entityID,
        options.cloakMode,
        options.uncloakRange,
      ),
    ));
  }
  if (options.includeRenderFx === true) {
    updates.push(buildPresentationUpdate(
      options.stamp,
      buildOnSpecialFXPayload(
        options.entityID,
        options.renderFxGuid,
        options.renderFxOptions,
      ),
    ));
  }
  if (options.includeMaxSpeed === true) {
    updates.push(buildPresentationUpdate(
      options.stamp,
      buildSetMaxSpeedPayload(options.entityID, options.maxSpeed),
    ));
  }
  return updates;
}

function buildUncloakDeliveryPresentationUpdates(options: Record<string, any> = {}) {
  const updates = [
    buildPresentationUpdate(
      options.stamp,
      buildUncloakBallPayload(options.entityID),
    ),
    buildPresentationUpdate(
      options.stamp,
      buildSetBallMassivePayload(options.entityID, true),
    ),
  ];
  if (options.includeRenderFx !== false) {
    updates.push(buildPresentationUpdate(
      options.stamp,
      buildOnSpecialFXPayload(
        options.entityID,
        options.renderFxGuid,
        options.renderFxOptions,
      ),
    ));
  }
  if (options.includeMaxSpeed === true) {
    updates.push(buildPresentationUpdate(
      options.stamp,
      buildSetMaxSpeedPayload(options.entityID, options.maxSpeed),
    ));
  }
  return updates;
}

function buildTetherPresentationUpdates(options: Record<string, any> = {}) {
  return [
    buildPresentationUpdate(
      options.stamp,
      buildOnSpecialFXPayload(
        options.entityID,
        options.tetherFxGuid,
        options.tetherFxOptions,
      ),
    ),
    buildPresentationUpdate(
      options.stamp,
      buildSetBallMassPayload(options.entityID, options.mass),
    ),
  ];
}

function normalizeOptionalEntityIDSentinel(value) {
  if (
    value === 0 ||
    value === 0n ||
    (typeof value === "string" && value.trim() === "0")
  ) {
    return null;
  }
  return value;
}

function createSpecialFxPayloadPresentation(deps: Record<string, any> = {}) {
  const {
    destiny,
    splitSpecialFxGuids,
  } = deps;
  const isEntityUsingNpcShipHardpointPresentation =
    typeof deps.isEntityUsingNpcShipHardpointPresentation === "function"
      ? deps.isEntityUsingNpcShipHardpointPresentation
      : () => false;
  const isOffensiveWeaponFamily =
    typeof deps.isOffensiveWeaponFamily === "function"
      ? deps.isOffensiveWeaponFamily
      : () => false;
  const shouldUseShipKeyedSpecialFxModuleBinding =
    typeof deps.shouldUseShipKeyedSpecialFxModuleBinding === "function"
      ? deps.shouldUseShipKeyedSpecialFxModuleBinding
      : null;
  if (!destiny || typeof destiny.buildOnSpecialFXPayload !== "function") {
    throw new TypeError(
      "special FX presentation requires buildOnSpecialFXPayload",
    );
  }
  if (typeof splitSpecialFxGuids !== "function") {
    throw new TypeError("special FX presentation requires splitSpecialFxGuids");
  }

  function usesShipKeyedSpecialFxModuleBinding(visibilityEntity, options: Record<string, any> = {}) {
    if (!visibilityEntity || visibilityEntity.kind !== "ship") {
      return false;
    }
    if (shouldUseShipKeyedSpecialFxModuleBinding) {
      return shouldUseShipKeyedSpecialFxModuleBinding(
        visibilityEntity,
        options,
      ) === true;
    }

    return (
      isEntityUsingNpcShipHardpointPresentation(visibilityEntity) &&
      (
        options.npcShipHardpointBinding === true ||
        options.shipKeyedModuleBinding === true ||
        options.isOffensive === true ||
        isOffensiveWeaponFamily(options.weaponFamily)
      )
    );
  }

  function resolveSpecialFxOptionsForEntity(
    shipID,
    options: Record<string, any> = {},
    visibilityEntity = null,
  ) {
    const normalizedOptions = {
      ...options,
      moduleID: normalizeOptionalEntityIDSentinel(options.moduleID),
      targetID: normalizeOptionalEntityIDSentinel(options.targetID),
    };
    if (!usesShipKeyedSpecialFxModuleBinding(visibilityEntity, options)) {
      return normalizedOptions;
    }

    const moduleID = normalizeEntityID(normalizedOptions.moduleID);
    if (shouldUseShipKeyedSpecialFxModuleBinding) {
      // Current NPC/entity-ship presentation replaces positive internal module
      // keys before they reach the exact int64 wire boundary. Some generated
      // superweapon module keys are intentionally unsafe Numbers; only the
      // authoritative ship identity is serialized for this presentation mode.
      const numericModuleID = Number(normalizedOptions.moduleID);
      if (!Number.isFinite(numericModuleID) || Math.trunc(numericModuleID) <= 0) {
        return normalizedOptions;
      }
    } else if (moduleID === null) {
      return normalizedOptions;
    }

    return {
      ...normalizedOptions,
      // CCP EntityShip hardpoints are keyed by shipID for NPC/entity
      // presentation, not by the underlying fitted module itemID.
      moduleID:
        normalizeEntityID(shipID) ||
        normalizeEntityID(visibilityEntity.itemID) ||
        moduleID,
    };
  }

  function buildSpecialFxPayloadsForEntity(
    shipID,
    guid,
    options: Record<string, any> = {},
    visibilityEntity = null,
  ) {
    const resolvedOptions = resolveSpecialFxOptionsForEntity(
      shipID,
      options,
      visibilityEntity,
    );
    const guidEntries = splitSpecialFxGuids(guid);
    if (!Array.isArray(guidEntries)) {
      throw new TypeError("splitSpecialFxGuids must return an array");
    }
    const payloads = guidEntries.map((guidEntry) => (
      destiny.buildOnSpecialFXPayload(shipID, guidEntry, resolvedOptions)
    ));
    return {
      resolvedOptions,
      payloads,
    };
  }

  return {
    buildSpecialFxPayloadsForEntity,
    resolveSpecialFxOptionsForEntity,
    usesShipKeyedSpecialFxModuleBinding,
  };
}

module.exports = {
  buildCloakBallPresentationUpdates,
  buildCloakDeliveryPresentationUpdates,
  buildDamageStatePresentationUpdates,
  buildDbuffPresentationUpdates,
  buildOwnerCloakActivationPresentationUpdates,
  buildOwnerUncloakPresentationUpdates,
  buildSingleSpecialFxPresentationUpdates,
  buildSlimItemPresentationUpdates,
  buildStructureLifecyclePresentationUpdates,
  buildTetherPresentationUpdates,
  buildUncloakDeliveryPresentationUpdates,
  createSpecialFxPayloadPresentation,
  normalizeOptionalEntityIDSentinel,
};
