const path = require("path");
const { createHash, randomUUID } = require("crypto");

const config = require(path.join(__dirname, "../../config"));
const itemStore = require(path.join(__dirname, "../inventory/itemStore"));
const {
  commitResolvedCreationState,
  CREATION_FITTING_FLAG_ID,
  ensureCreationState,
  getCreationStateCapacities,
  validateCreationModuleRemoval,
} = require(path.join(__dirname, "./creationRuntime"));
const {
  validateCreationLayout,
} = require(path.join(__dirname, "./creationLayoutValidation"));
const {
  getCreationHardpointType,
  getCreationModule,
  getCreationPart,
  getCreationTemplate,
} = require(path.join(__dirname, "./creationStaticData"));
const {
  CREATION_PRESET_SCHEMA_VERSION,
  createCreationPreset,
  deleteCreationPreset,
  getCreationPreset,
  listCreationPresets: listStoredCreationPresets,
  updateCreationPresetMetadata,
} = require(path.join(__dirname, "./creationPresetStore"));

const PREVIEW_TOKEN_TTL_MS = 60_000;
const POSITION_TOLERANCE_SQ = 1.0e-6;
const previewTokens = new Map<string, any>();

function toInt(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.trunc(numeric) : fallback;
}

function toFinite(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function cloneValue(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function canonicalize(value) {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]),
    );
  }
  return value;
}

function canonicalJson(value) {
  return JSON.stringify(canonicalize(value));
}

function hashValue(value) {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

function diagnostic(code, params: Record<string, any> = {}, moduleItemID = null) {
  return {
    code,
    severity: "blocker",
    moduleItemID: toInt(moduleItemID, 0) || null,
    changeOp: null,
    retryAt: null,
    params,
  };
}

function partGraphicID(template, partID) {
  const reference = template && template.parts && template.parts[String(partID)];
  return toInt(reference && (reference.graphic_id ?? reference.graphicID), 0);
}

function locatorAt(template, partID, locatorSet, locatorIndex) {
  const part = getCreationPart(partGraphicID(template, partID));
  const locations = part && part.hardpoints && Array.isArray(part.hardpoints[locatorSet])
    ? part.hardpoints[locatorSet]
    : [];
  const location = locations[toInt(locatorIndex, -1)];
  const position = location && Array.isArray(location.position)
    ? location.position
    : null;
  const rotation = location && Array.isArray(location.rotation)
    ? location.rotation
    : null;
  if (!position || position.length < 3 || !rotation || rotation.length < 4) {
    return null;
  }
  return {
    position: position.slice(0, 3).map((entry) => toFinite(entry, 0)),
    rotation: rotation.slice(0, 4).map((entry, index) =>
      toFinite(entry, index === 3 ? 1 : 0)),
  };
}

function matchLocatorIdentity(template, hardpoint) {
  const partID = toInt(hardpoint && hardpoint.partID, 0);
  const part = getCreationPart(partGraphicID(template, partID));
  const hardpoints = part && part.hardpoints && typeof part.hardpoints === "object"
    ? part.hardpoints
    : {};
  const x = toFinite(hardpoint && hardpoint.x, NaN);
  const y = toFinite(hardpoint && hardpoint.y, NaN);
  const z = toFinite(hardpoint && hardpoint.z, NaN);
  for (const locatorSet of Object.keys(hardpoints).sort()) {
    const locations = Array.isArray(hardpoints[locatorSet]) ? hardpoints[locatorSet] : [];
    for (let locatorIndex = 0; locatorIndex < locations.length; locatorIndex += 1) {
      const position = locations[locatorIndex] && locations[locatorIndex].position;
      if (!Array.isArray(position) || position.length < 3) {
        continue;
      }
      const dx = toFinite(position[0], 0) - x;
      const dy = toFinite(position[1], 0) - y;
      const dz = toFinite(position[2], 0) - z;
      if ((dx * dx) + (dy * dy) + (dz * dz) <= POSITION_TOLERANCE_SQ) {
        return { locatorSet, locatorIndex };
      }
    }
  }
  return null;
}

function compareInterior(left, right) {
  const leftPlacement = left.placement;
  const rightPlacement = right.placement;
  for (const key of [
    "partID", "x", "y", "z", "rotationX", "rotationY", "rotationZ",
    "typeID", "itemID",
  ]) {
    const difference = toFinite(leftPlacement[key] ?? left[key], 0) -
      toFinite(rightPlacement[key] ?? right[key], 0);
    if (difference !== 0) {
      return difference;
    }
  }
  return 0;
}

function buildCanonicalComposition(state, template) {
  const modulesByID = new Map<number, any>(
    (Array.isArray(state && state.modules) ? state.modules : [])
      .map((module) => [toInt(module && module.itemID, 0), module]),
  );
  const interiors = (Array.isArray(state && state.interiorPlacements)
    ? state.interiorPlacements
    : [])
    .map((placement) => {
      const itemID = toInt(placement && placement.itemID, 0);
      const module = modulesByID.get(itemID);
      return module ? {
        itemID,
        typeID: toInt(module.typeID, 0),
        placement: {
          partID: toInt(placement.partID, 0),
          x: toFinite(placement.x, 0),
          y: toFinite(placement.y, 0),
          z: toFinite(placement.z, 0),
          rotationX: toFinite(placement.rotation && placement.rotation.x, 0),
          rotationY: toFinite(placement.rotation && placement.rotation.y, 0),
          rotationZ: toFinite(placement.rotation && placement.rotation.z, 0),
        },
      } : null;
    })
    .filter(Boolean)
    .sort(compareInterior);
  const nodeByItemID = new Map<number, string>();
  const interiorModules = interiors.map((entry, index) => {
    const nodeID = `m${index + 1}`;
    nodeByItemID.set(entry.itemID, nodeID);
    return {
      nodeID,
      typeID: entry.typeID,
      partID: entry.placement.partID,
      x: entry.placement.x,
      y: entry.placement.y,
      z: entry.placement.z,
      rotationX: entry.placement.rotationX,
      rotationY: entry.placement.rotationY,
      rotationZ: entry.placement.rotationZ,
    };
  });
  const hardpoints: any[] = [];
  for (const hardpoint of Array.isArray(state && state.hardpoints)
    ? state.hardpoints
    : []) {
    const providerNodeID = nodeByItemID.get(toInt(hardpoint.interiorItemID, 0));
    const identity = matchLocatorIdentity(template, hardpoint);
    if (!providerNodeID || !identity) {
      return {
        success: false as const,
        diagnostics: [diagnostic("invalid_placement", {
          reason: "HARDPOINT_LOCATION_NOT_IN_SDE",
          part_id: toInt(hardpoint.partID, 0),
        }, hardpoint.interiorItemID)],
      };
    }
    const attached = hardpoint.attachedItemID == null
      ? null
      : modulesByID.get(toInt(hardpoint.attachedItemID, 0));
    hardpoints.push({
      providerNodeID,
      providerIndex: Math.max(0, toInt(hardpoint.hardpointIndex, 0)),
      partID: toInt(hardpoint.partID, 0),
      locatorSet: identity.locatorSet,
      locatorIndex: identity.locatorIndex,
      attachedExteriorTypeID: attached ? toInt(attached.typeID, 0) : null,
    });
  }
  hardpoints.sort((left, right) => (
    left.providerNodeID.localeCompare(right.providerNodeID, undefined, { numeric: true }) ||
    left.providerIndex - right.providerIndex
  ));
  return {
    success: true as const,
    data: { interiorModules, hardpoints },
  };
}

function collectCompositionTypeIDs(composition) {
  return [...new Set([
    ...(Array.isArray(composition && composition.interiorModules)
      ? composition.interiorModules.map((entry) => toInt(entry && entry.typeID, 0))
      : []),
    ...(Array.isArray(composition && composition.hardpoints)
      ? composition.hardpoints.map((entry) =>
          toInt(entry && entry.attachedExteriorTypeID, 0))
      : []),
  ].filter((typeID) => typeID > 0))].sort((left, right) => left - right);
}

function buildSdeFingerprint(creationTypeID, composition) {
  const template = getCreationTemplate(creationTypeID);
  if (!template) {
    return "";
  }
  const graphicIDs = Object.values<any>(template.parts || {})
    .map((part) => toInt(part && (part.graphic_id ?? part.graphicID), 0))
    .filter((graphicID) => graphicID > 0)
    .sort((left, right) => left - right);
  const hardpointTypes = new Set<string>();
  const modules = collectCompositionTypeIDs(composition).map((typeID) => {
    const definition = getCreationModule(typeID);
    const declared = definition && definition.placement &&
      Array.isArray(definition.placement.hardpoints)
      ? definition.placement.hardpoints
      : [];
    declared.forEach((entry) => hardpointTypes.add(String(entry)));
    return [typeID, definition];
  });
  return hashValue({
    template,
    modules,
    parts: graphicIDs.map((graphicID) => [graphicID, getCreationPart(graphicID)]),
    hardpointTypes: [...hardpointTypes].sort()
      .map((name) => [name, getCreationHardpointType(name)]),
  });
}

function summarizeCreationPreset(preset) {
  const composition = preset && preset.composition || {};
  const interiorModules = Array.isArray(composition.interiorModules)
    ? composition.interiorModules
    : [];
  const hardpoints = Array.isArray(composition.hardpoints)
    ? composition.hardpoints
    : [];
  const exteriorModuleCount = hardpoints.filter((hardpoint) =>
    toInt(hardpoint && hardpoint.attachedExteriorTypeID, 0) > 0).length;
  const cellCount = interiorModules.reduce((total, descriptor) => {
    const definition = getCreationModule(toInt(descriptor && descriptor.typeID, 0));
    const cells = definition && definition.placement &&
      definition.placement.occupancy &&
      Array.isArray(definition.placement.occupancy.cells)
      ? definition.placement.occupancy.cells
      : [];
    return total + cells.length;
  }, 0);
  const currentSdeFingerprint = buildSdeFingerprint(
    toInt(preset && preset.creationTypeID, 0),
    composition,
  );
  return {
    interiorModuleCount: interiorModules.length,
    exteriorModuleCount,
    moduleCount: interiorModules.length + exteriorModuleCount,
    cellCount,
    schemaCompatible: toInt(preset && preset.schemaVersion, 0) <=
      CREATION_PRESET_SCHEMA_VERSION,
    sdeCompatible: Boolean(currentSdeFingerprint) &&
      currentSdeFingerprint === String(preset && preset.sdeFingerprint || ""),
  };
}

function listCreationPresets(ownerID) {
  return listStoredCreationPresets(ownerID).map((preset) => ({
    ...preset,
    summary: summarizeCreationPreset(preset),
  }));
}

function saveCreationPreset(item, characterID, name, description = "", options = {}) {
  const ensured = ensureCreationState(item, characterID);
  if (!ensured.success) {
    return {
      success: false as const,
      diagnostics: [diagnostic("invalid_post_commit_state", {
        reason: ensured.errorMsg || "CREATION_STATE_UNAVAILABLE",
      })],
    };
  }
  const layoutDiagnostics = validateCreationLayout(
    ensured.data.state,
    ensured.data.template,
  );
  if (layoutDiagnostics.length > 0) {
    return { success: false as const, diagnostics: layoutDiagnostics };
  }
  const compositionResult = buildCanonicalComposition(
    ensured.data.state,
    ensured.data.template,
  );
  if (!compositionResult.success) {
    return compositionResult;
  }
  const composition = compositionResult.data;
  const creationTypeID = toInt(ensured.data.item.typeID, 0);
  const storeResult = createCreationPreset(characterID, {
    name,
    description,
    creationTypeID,
    schemaVersion: CREATION_PRESET_SCHEMA_VERSION,
    sdeBuild: String(config.clientBuild || process.env.EVEJS_CLIENT_BUILD || "unknown"),
    sdeFingerprint: buildSdeFingerprint(creationTypeID, composition),
    compositionHash: hashValue(composition),
    composition,
  }, options);
  return storeResult.success
    ? { success: true as const, diagnostics: [], data: storeResult.data }
    : {
        success: false as const,
        diagnostics: [diagnostic("invalid_post_commit_state", {
          reason: storeResult.errorMsg || "PRESET_SAVE_FAILED",
        })],
      };
}

function placementMatches(placement, desired) {
  return Boolean(placement) &&
    toInt(placement.partID, 0) === toInt(desired.partID, 0) &&
    toFinite(placement.x, 0) === toFinite(desired.x, 0) &&
    toFinite(placement.y, 0) === toFinite(desired.y, 0) &&
    toFinite(placement.z, 0) === toFinite(desired.z, 0) &&
    toFinite(placement.rotation && placement.rotation.x, 0) ===
      toFinite(desired.rotationX, 0) &&
    toFinite(placement.rotation && placement.rotation.y, 0) ===
      toFinite(desired.rotationY, 0) &&
    toFinite(placement.rotation && placement.rotation.z, 0) ===
      toFinite(desired.rotationZ, 0);
}

function takeCandidate(candidates, usedItemIDs, predicate, exactPredicate = null) {
  const matches = candidates.filter((item) => (
    !usedItemIDs.has(toInt(item && item.itemID, 0)) && predicate(item)
  ));
  matches.sort((left, right) => {
    const leftExact = exactPredicate && exactPredicate(left) ? 0 : 1;
    const rightExact = exactPredicate && exactPredicate(right) ? 0 : 1;
    return leftExact - rightExact || toInt(left.itemID, 0) - toInt(right.itemID, 0);
  });
  const selected = matches[0] || null;
  if (selected) {
    usedItemIDs.add(toInt(selected.itemID, 0));
  }
  return selected;
}

function takeCargoUnit(
  candidates,
  remainingByItemID,
  usedItemIDs,
  typeID,
  virtualSequence,
) {
  const matches = candidates
    .filter((item) => (
      toInt(item && item.typeID, 0) === typeID &&
      (remainingByItemID.get(toInt(item && item.itemID, 0)) || 0) > 0
    ))
    .sort((left, right) => toInt(left.itemID, 0) - toInt(right.itemID, 0));
  const source = matches[0] || null;
  if (!source) {
    return null;
  }
  const sourceItemID = toInt(source.itemID, 0);
  const sourceQuantity = itemQuantity(source);
  remainingByItemID.set(
    sourceItemID,
    (remainingByItemID.get(sourceItemID) || 0) - 1,
  );
  if (sourceQuantity === 1) {
    usedItemIDs.add(sourceItemID);
    return { ...source, sourceItemID };
  }
  let virtualItemID = Number.MAX_SAFE_INTEGER - virtualSequence.value++;
  while (usedItemIDs.has(virtualItemID) || itemStore.findItemById(virtualItemID)) {
    virtualItemID = Number.MAX_SAFE_INTEGER - virtualSequence.value++;
  }
  usedItemIDs.add(virtualItemID);
  return {
    ...source,
    itemID: virtualItemID,
    sourceItemID,
    stacksize: 1,
    quantity: -1,
    singleton: 1,
  };
}

function countTypes(items, resolver = (entry) => entry && entry.typeID) {
  const counts = new Map<number, number>();
  for (const item of items) {
    const typeID = toInt(resolver(item), 0);
    if (typeID > 0) {
      counts.set(typeID, (counts.get(typeID) || 0) + 1);
    }
  }
  return [...counts.entries()]
    .sort(([left], [right]) => left - right)
    .map(([typeID, quantity]) => ({ typeID, quantity }));
}

function itemQuantity(item) {
  return toInt(item && item.singleton, 0) === 1
    ? 1
    : Math.max(1, toInt(item && (item.stacksize ?? item.quantity), 1));
}

function buildShipStateHash(state, creationID, characterID) {
  const itemSummaries = itemStore.listContainerItems(characterID, creationID, null)
    .filter((item) => [itemStore.ITEM_FLAGS.CARGO_HOLD, CREATION_FITTING_FLAG_ID]
      .includes(toInt(item && item.flagID, -1)))
    .map((item) => ({
      itemID: toInt(item.itemID, 0),
      typeID: toInt(item.typeID, 0),
      locationID: toInt(item.locationID, 0),
      flagID: toInt(item.flagID, 0),
      singleton: toInt(item.singleton, 0),
      stacksize: itemQuantity(item),
    }))
    .sort((left, right) => left.itemID - right.itemID);
  return hashValue({ state, itemSummaries });
}

function cargoUsedVolume(characterID, creationID) {
  return itemStore.listContainerItems(
    characterID,
    creationID,
    itemStore.ITEM_FLAGS.CARGO_HOLD,
  ).reduce((total, item) => total +
    Math.max(0, itemStore.getInventoryItemUnitVolume(item)) * itemQuantity(item), 0);
}

function buildPresetPlan(item, characterID, preset) {
  const ensured = ensureCreationState(item, characterID);
  if (!ensured.success) {
    return {
      success: false as const,
      diagnostics: [diagnostic("invalid_post_commit_state", {
        reason: ensured.errorMsg || "CREATION_STATE_UNAVAILABLE",
      })],
    };
  }
  const creationID = toInt(ensured.data.item.itemID, 0);
  const creationTypeID = toInt(ensured.data.item.typeID, 0);
  if (!preset || toInt(preset.ownerID, 0) !== toInt(characterID, 0)) {
    return { success: false as const, diagnostics: [diagnostic("item_unavailable", {
      reason: "PRESET_NOT_FOUND",
    })] };
  }
  if (toInt(preset.creationTypeID, 0) !== creationTypeID) {
    return { success: false as const, diagnostics: [diagnostic("invalid_post_commit_state", {
      reason: "PRESET_HULL_MISMATCH",
      expected_type_id: preset.creationTypeID,
      actual_type_id: creationTypeID,
    })] };
  }
  const composition = preset.composition;
  if (
    !composition ||
    !Array.isArray(composition.interiorModules) ||
    !Array.isArray(composition.hardpoints) ||
    hashValue(composition) !== String(preset.compositionHash || "")
  ) {
    return { success: false as const, diagnostics: [diagnostic("invalid_post_commit_state", {
      reason: "PRESET_COMPOSITION_CORRUPT",
    })] };
  }
  const currentSdeFingerprint = buildSdeFingerprint(creationTypeID, composition);
  if (!currentSdeFingerprint || currentSdeFingerprint !== preset.sdeFingerprint) {
    return { success: false as const, diagnostics: [diagnostic("invalid_post_commit_state", {
      reason: "PRESET_SDE_STALE",
      saved_fingerprint: preset.sdeFingerprint,
      current_fingerprint: currentSdeFingerprint,
    })] };
  }

  const currentState = ensured.data.state;
  const currentModulesByID = new Map(
    currentState.modules.map((module) => [toInt(module.itemID, 0), module]),
  );
  const currentPlacementsByID = new Map(
    currentState.interiorPlacements.map((placement) => [toInt(placement.itemID, 0), placement]),
  );
  const currentAttachedByID = new Map<number, any>();
  for (const hardpoint of currentState.hardpoints) {
    const attachedItemID = toInt(hardpoint && hardpoint.attachedItemID, 0);
    if (attachedItemID > 0) {
      currentAttachedByID.set(attachedItemID, hardpoint);
    }
  }
  const fittedItems = currentState.modules.map((module) =>
    itemStore.findItemById(toInt(module.itemID, 0)))
    .filter(Boolean);
  const cargoItems = itemStore.listContainerItems(
    characterID,
    creationID,
    itemStore.ITEM_FLAGS.CARGO_HOLD,
  );
  const cargoRemainingByItemID = new Map<number, number>(
    cargoItems.map((candidate) => [
      toInt(candidate && candidate.itemID, 0),
      itemQuantity(candidate),
    ]),
  );
  const virtualSequence = { value: 0 };
  const usedItemIDs = new Set<number>();
  const selectedUnits: any[] = [];
  const physicalItemByNode = new Map<string, any>();
  const missingTypeIDs: number[] = [];
  const desiredModules: any[] = [];
  const desiredPlacements: any[] = [];

  const descriptors = [...composition.interiorModules].sort((left, right) =>
    String(left.nodeID).localeCompare(String(right.nodeID), undefined, { numeric: true }));
  for (const descriptor of descriptors) {
    const typeID = toInt(descriptor && descriptor.typeID, 0);
    const fromFitted = takeCandidate(
      fittedItems,
      usedItemIDs,
      (candidate) => (
        toInt(candidate.typeID, 0) === typeID &&
        currentPlacementsByID.has(toInt(candidate.itemID, 0))
      ),
      (candidate) => placementMatches(
        currentPlacementsByID.get(toInt(candidate.itemID, 0)),
        descriptor,
      ),
    );
    const selected = fromFitted || takeCargoUnit(
      cargoItems,
      cargoRemainingByItemID,
      usedItemIDs,
      typeID,
      virtualSequence,
    );
    if (!selected) {
      missingTypeIDs.push(typeID);
      continue;
    }
    const nodeID = String(descriptor.nodeID || "");
    physicalItemByNode.set(nodeID, selected);
    selectedUnits.push(selected);
    desiredModules.push({
      itemID: selected.itemID,
      sourceItemID: toInt(selected.sourceItemID, toInt(selected.itemID, 0)),
      typeID,
    });
    desiredPlacements.push({
      itemID: selected.itemID,
      partID: toInt(descriptor.partID, 0),
      x: toFinite(descriptor.x, 0),
      y: toFinite(descriptor.y, 0),
      z: toFinite(descriptor.z, 0),
      rotation: {
        x: toFinite(descriptor.rotationX, 0),
        y: toFinite(descriptor.rotationY, 0),
        z: toFinite(descriptor.rotationZ, 0),
      },
    });
  }

  const desiredHardpoints: any[] = [];
  const hardpointDescriptors = [...composition.hardpoints].sort((left, right) => (
    String(left.providerNodeID).localeCompare(
      String(right.providerNodeID),
      undefined,
      { numeric: true },
    ) || toInt(left.providerIndex, 0) - toInt(right.providerIndex, 0)
  ));
  for (const descriptor of hardpointDescriptors) {
    const provider = physicalItemByNode.get(String(descriptor.providerNodeID || ""));
    const locator = locatorAt(
      ensured.data.template,
      toInt(descriptor.partID, 0),
      String(descriptor.locatorSet || ""),
      toInt(descriptor.locatorIndex, -1),
    );
    if (!provider) {
      // The missing component is already reported by type below. Keep
      // resolving the rest of the preset so preview can return the complete
      // shopping list in one response.
      continue;
    }
    if (!locator) {
      return { success: false as const, diagnostics: [diagnostic("invalid_placement", {
        reason: "PRESET_LOCATOR_MISSING",
        provider_node_id: descriptor.providerNodeID,
      })] };
    }
    let attachedItemID = null;
    const exteriorTypeID = toInt(descriptor.attachedExteriorTypeID, 0);
    if (exteriorTypeID > 0) {
      const fromFitted = takeCandidate(
        fittedItems,
        usedItemIDs,
        (candidate) => (
          toInt(candidate.typeID, 0) === exteriorTypeID &&
          currentAttachedByID.has(toInt(candidate.itemID, 0))
        ),
        (candidate) => {
          const current = currentAttachedByID.get(toInt(candidate.itemID, 0));
          return toInt(current && current.interiorItemID, 0) === toInt(provider.itemID, 0) &&
            toInt(current && current.hardpointIndex, -1) ===
              toInt(descriptor.providerIndex, -2);
        },
      );
      const selected = fromFitted || takeCargoUnit(
        cargoItems,
        cargoRemainingByItemID,
        usedItemIDs,
        exteriorTypeID,
        virtualSequence,
      );
      if (!selected) {
        missingTypeIDs.push(exteriorTypeID);
      } else {
        attachedItemID = selected.itemID;
        selectedUnits.push(selected);
        desiredModules.push({
          itemID: selected.itemID,
          sourceItemID: toInt(selected.sourceItemID, toInt(selected.itemID, 0)),
          typeID: exteriorTypeID,
        });
      }
    }
    desiredHardpoints.push({
      interiorItemID: provider.itemID,
      hardpointIndex: Math.max(0, toInt(descriptor.providerIndex, 0)),
      creationID,
      partID: toInt(descriptor.partID, 0),
      x: locator.position[0],
      y: locator.position[1],
      z: locator.position[2],
      rotation: {
        x: locator.rotation[0],
        y: locator.rotation[1],
        z: locator.rotation[2],
        w: locator.rotation[3],
      },
      attachedItemID,
    });
  }

  const diagnostics: any[] = [];
  if (missingTypeIDs.length > 0) {
    diagnostics.push(diagnostic("item_unavailable", {
      reason: "PRESET_COMPONENTS_MISSING",
      missing: countTypes(missingTypeIDs, (typeID) => typeID),
    }));
  }
  const desiredState = {
    version: 1,
    templateTypeID: creationTypeID,
    poweredOff: currentState.poweredOff === true,
    modules: desiredModules,
    interiorPlacements: desiredPlacements,
    hardpoints: desiredHardpoints,
  };
  if (missingTypeIDs.length === 0) {
    diagnostics.push(...validateCreationLayout(desiredState, ensured.data.template));
  }

  const removedItems = fittedItems.filter((candidate) =>
    !usedItemIDs.has(toInt(candidate.itemID, 0)));
  for (const removed of removedItems) {
    const removalDiagnostic = validateCreationModuleRemoval(removed, {
      op: "remove",
      itemID: removed.itemID,
    });
    if (removalDiagnostic) {
      diagnostics.push(removalDiagnostic);
    }
  }
  const addedItems = selectedUnits.filter((candidate) =>
    toInt(candidate.flagID, -1) === itemStore.ITEM_FLAGS.CARGO_HOLD);

  const currentCapacities = getCreationStateCapacities(
    ensured.data.item,
    characterID,
    currentState,
  ) || { cargoCapacity: 0, fuelCapacity: 0, capacitorCapacity: 0 };
  const nextCapacities = missingTypeIDs.length === 0
    ? getCreationStateCapacities(
        ensured.data.item,
        characterID,
        desiredState,
      ) || { cargoCapacity: 0, fuelCapacity: 0, capacitorCapacity: 0 }
    : currentCapacities;
  const currentCargoUsed = cargoUsedVolume(characterID, creationID);
  const outgoingVolume = addedItems.reduce((total, candidate) => total +
    Math.max(0, itemStore.getInventoryItemUnitVolume(candidate)), 0);
  const incomingVolume = removedItems.reduce((total, candidate) => total +
    Math.max(0, itemStore.getInventoryItemUnitVolume(candidate)), 0);
  const nextCargoUsed = Math.max(0, currentCargoUsed - outgoingVolume + incomingVolume);
  if (
    missingTypeIDs.length === 0 &&
    nextCargoUsed > nextCapacities.cargoCapacity + 1.0e-6
  ) {
    diagnostics.push(diagnostic("invalid_post_commit_state", {
      reason: "CREATION_CARGO_CAPACITY_EXCEEDED",
      capacity: nextCapacities.cargoCapacity,
      required: nextCargoUsed,
      used: currentCargoUsed,
    }));
  }

  const shipStateHash = buildShipStateHash(currentState, creationID, characterID);
  const planHash = hashValue({
    presetID: preset.presetID,
    presetRevision: preset.revision,
    shipStateHash,
    desiredState,
    selectedItemIDs: [...usedItemIDs].sort((left, right) => left - right),
    moduleSources: desiredModules
      .map((module) => [module.itemID, module.sourceItemID])
      .sort(([left], [right]) => left - right),
    removedItemIDs: removedItems.map((entry) => toInt(entry.itemID, 0)).sort((a, b) => a - b),
  });
  return {
    success: diagnostics.length === 0,
    diagnostics,
    data: {
      creationID,
      preset,
      desiredState,
      shipStateHash,
      planHash,
      additions: countTypes(addedItems),
      removals: countTypes(removedItems),
      missing: countTypes(missingTypeIDs, (typeID) => typeID),
      selectedItemIDs: [...usedItemIDs].sort((left, right) => left - right),
      moduleSources: Object.fromEntries(desiredModules
        .map((module) => [String(module.itemID), module.sourceItemID])),
      capacities: {
        cargo: {
          before: currentCapacities.cargoCapacity,
          after: nextCapacities.cargoCapacity,
          usedBefore: currentCargoUsed,
          usedAfter: nextCargoUsed,
        },
        fuel: {
          before: currentCapacities.fuelCapacity,
          after: nextCapacities.fuelCapacity,
        },
        capacitor: {
          before: currentCapacities.capacitorCapacity,
          after: nextCapacities.capacitorCapacity,
        },
      },
    },
  };
}

function prunePreviewTokens(nowMs = Date.now()) {
  for (const [token, record] of previewTokens.entries()) {
    if (!record || Number(record.expiresAtMs) <= nowMs) {
      previewTokens.delete(token);
    }
  }
}

function previewCreationPreset(
  item,
  characterID,
  presetID,
  options: Record<string, any> = {},
) {
  const preset = getCreationPreset(characterID, presetID);
  const plan = buildPresetPlan(item, characterID, preset);
  if (!plan.success) {
    return plan;
  }
  const nowMs = Math.max(0, Number(options.nowMs) || Date.now());
  prunePreviewTokens(nowMs);
  const token = String(options.token || randomUUID());
  const expiresAtMs = nowMs + PREVIEW_TOKEN_TTL_MS;
  previewTokens.set(token, {
    token,
    ownerID: toInt(characterID, 0),
    creationID: plan.data.creationID,
    presetID: preset.presetID,
    presetRevision: preset.revision,
    shipStateHash: plan.data.shipStateHash,
    planHash: plan.data.planHash,
    expiresAtMs,
  });
  return {
    ...plan,
    data: { ...plan.data, previewToken: token, expiresAtMs },
  };
}

function applyCreationPreset(item, characterID, presetID, previewToken, session = null) {
  const nowMs = Date.now();
  prunePreviewTokens(nowMs);
  const token = previewTokens.get(String(previewToken || ""));
  const numericCharacterID = toInt(characterID, 0);
  const creationID = toInt(item && item.itemID, 0);
  if (
    !token ||
    token.ownerID !== numericCharacterID ||
    token.creationID !== creationID ||
    token.presetID !== String(presetID || "") ||
    token.expiresAtMs <= nowMs
  ) {
    return { success: false as const, diagnostics: [diagnostic(
      "invalid_post_commit_state",
      { reason: "PRESET_PREVIEW_TOKEN_INVALID" },
    )] };
  }
  const preset = getCreationPreset(numericCharacterID, presetID);
  if (!preset || preset.revision !== token.presetRevision) {
    previewTokens.delete(token.token);
    return { success: false as const, diagnostics: [diagnostic(
      "invalid_post_commit_state",
      { reason: "PRESET_REVISION_CHANGED" },
    )] };
  }
  const plan = buildPresetPlan(item, numericCharacterID, preset);
  if (
    !plan.success ||
    plan.data.shipStateHash !== token.shipStateHash ||
    plan.data.planHash !== token.planHash
  ) {
    previewTokens.delete(token.token);
    return plan.success
      ? { success: false as const, diagnostics: [diagnostic(
          "invalid_post_commit_state",
          { reason: "PRESET_PREVIEW_STALE" },
        )] }
      : plan;
  }
  previewTokens.delete(token.token);
  const commit = commitResolvedCreationState(
    item,
    numericCharacterID,
    plan.data.desiredState,
    session,
    {
      reason: "preset_apply",
      presetID: preset.presetID,
      moduleSources: plan.data.moduleSources,
    },
  );
  return commit.success
    ? {
        success: true as const,
        diagnostics: [],
        data: { ...commit.data, preset, preview: plan.data },
      }
    : commit;
}

function resetCreationPresetPreviewTokensForTests() {
  previewTokens.clear();
}

module.exports = {
  PREVIEW_TOKEN_TTL_MS,
  _buildCanonicalCompositionForTests: buildCanonicalComposition,
  _buildPresetPlanForTests: buildPresetPlan,
  _buildSdeFingerprintForTests: buildSdeFingerprint,
  _hashValueForTests: hashValue,
  _resetCreationPresetPreviewTokensForTests: resetCreationPresetPreviewTokensForTests,
  applyCreationPreset,
  buildCanonicalComposition,
  deleteCreationPreset,
  getCreationPreset,
  listCreationPresets,
  previewCreationPreset,
  saveCreationPreset,
  summarizeCreationPreset,
  updateCreationPresetMetadata,
};
