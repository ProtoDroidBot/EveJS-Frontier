const path = require("path");

const {
  getCreationHardpointType,
  getCreationModule,
  getCreationPart,
  getCreationTemplate,
} = require(path.join(__dirname, "./creationStaticData"));

const HARDPOINT_POSITION_TOLERANCE_SQ = 1.0e-6;
const SUPPORTED_ROTATIONS = new Set([0, 90, 180, 270]);
const SUPPORTED_REFLECTIONS = new Set([0, 180]);

type CreationLayoutDiagnostic = {
  code: string;
  severity: "blocker" | "warning";
  moduleItemID?: number | null;
  changeOp?: string | null;
  params?: Record<string, any>;
};

type CreationStaticResolvers = {
  getHardpointType?: (hardpointType: string) => any;
  getModule?: (typeID: number) => any;
  getPart?: (graphicID: number) => any;
  getTemplate?: (typeID: number) => any;
};

function toFiniteNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function toPositiveInteger(value) {
  const numeric = Number(value);
  return Number.isInteger(numeric) && numeric > 0 ? numeric : 0;
}

function toNonNegativeInteger(value) {
  const numeric = Number(value);
  return Number.isInteger(numeric) && numeric >= 0 ? numeric : -1;
}

function isIntegerCoordinate(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && Number.isInteger(numeric);
}

function blocker(
  code: string,
  moduleItemID: number | null = null,
  params: Record<string, any> = {},
): CreationLayoutDiagnostic {
  return {
    code,
    severity: "blocker",
    moduleItemID,
    changeOp: null,
    params,
  };
}

function validationResolvers(options: CreationStaticResolvers = {}) {
  return {
    getHardpointType: typeof options.getHardpointType === "function"
      ? options.getHardpointType
      : getCreationHardpointType,
    getModule: typeof options.getModule === "function"
      ? options.getModule
      : getCreationModule,
    getPart: typeof options.getPart === "function"
      ? options.getPart
      : getCreationPart,
    getTemplate: typeof options.getTemplate === "function"
      ? options.getTemplate
      : getCreationTemplate,
  };
}

function normalizeQuarterTurn(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || !Number.isInteger(numeric)) {
    return null;
  }
  const normalized = ((numeric % 360) + 360) % 360;
  return SUPPORTED_ROTATIONS.has(normalized) ? normalized : null;
}

function normalizeReflection(value) {
  if (value == null) {
    return 0;
  }
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || !Number.isInteger(numeric)) {
    return null;
  }
  const normalized = ((numeric % 360) + 360) % 360;
  return SUPPORTED_REFLECTIONS.has(normalized) ? normalized : null;
}

/**
 * Match frontier.creation.common.validation.CreationLayoutValidator exactly:
 * rotate the SDE-local cell around (0, 0), then translate it by the placement.
 */
function rotateCreationCellOffset(dx, dy, dz, rotationZ) {
  const rotation = normalizeQuarterTurn(rotationZ);
  const clean = (value) => Object.is(value, -0) ? 0 : value;
  if (rotation === 90) {
    return [clean(-dy), clean(dx), clean(dz)];
  }
  if (rotation === 180) {
    return [clean(-dx), clean(-dy), clean(dz)];
  }
  if (rotation === 270) {
    return [clean(dy), clean(-dx), clean(dz)];
  }
  return [clean(dx), clean(dy), clean(dz)];
}

/**
 * EveJS extends the native grid transform without changing its wire shape:
 * rotation.x/y of 180 mirror the corresponding local occupancy coordinate,
 * bounded by the module's authored SDE footprint. Reflection happens before
 * the native rotation.z quarter-turn, so all eight planar orientations have a
 * deterministic representation.
 */
function transformCreationCellOffsets(cells, rotation: Record<string, any> = {}) {
  const normalizedCells = (Array.isArray(cells) ? cells : []).map((cell) => [
    Number(cell && (cell.x ?? cell[0])),
    Number(cell && (cell.y ?? cell[1])),
    Number(cell && (cell.z ?? cell[2] ?? 0)),
  ]);
  if (normalizedCells.length === 0) {
    return [];
  }
  const rotationX = normalizeReflection(rotation && rotation.x);
  const rotationY = normalizeReflection(rotation && rotation.y);
  const rotationZ = normalizeQuarterTurn(rotation && rotation.z);
  if (rotationX === null || rotationY === null || rotationZ === null) {
    return null;
  }
  const xs = normalizedCells.map((cell) => cell[0]);
  const ys = normalizedCells.map((cell) => cell[1]);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  return normalizedCells.map(([dx, dy, dz]) => rotateCreationCellOffset(
    rotationX === 180 ? minX + maxX - dx : dx,
    rotationY === 180 ? minY + maxY - dy : dy,
    dz,
    rotationZ,
  ));
}

function isInteriorModule(definition) {
  return Boolean(
    definition &&
    definition.placement &&
    definition.placement.occupancy &&
    Array.isArray(definition.placement.occupancy.cells),
  );
}

function isExteriorModule(definition) {
  return Boolean(
    definition &&
    definition.placement &&
    Array.isArray(definition.placement.compatible_hardpoints),
  );
}

function partReference(template, partID) {
  return template && template.parts && template.parts[String(partID)];
}

function partGraphicID(template, partID) {
  const reference = partReference(template, partID);
  return toPositiveInteger(reference && (reference.graphic_id ?? reference.graphicID));
}

function locatorEntries(part) {
  const hardpoints = part && part.hardpoints && typeof part.hardpoints === "object"
    ? part.hardpoints
    : {};
  const entries: any[] = [];
  for (const locatorSet of Object.keys(hardpoints).sort()) {
    const locations = Array.isArray(hardpoints[locatorSet])
      ? hardpoints[locatorSet]
      : [];
    locations.forEach((location, locatorIndex) => {
      entries.push({ locatorSet, locatorIndex, location });
    });
  }
  return entries;
}

function matchLocator(x, y, z, entries) {
  for (let flatIndex = 0; flatIndex < entries.length; flatIndex += 1) {
    const entry = entries[flatIndex];
    const position = entry && entry.location && entry.location.position;
    if (!Array.isArray(position) || position.length < 3) {
      continue;
    }
    const dx = toFiniteNumber(position[0]) - x;
    const dy = toFiniteNumber(position[1]) - y;
    const dz = toFiniteNumber(position[2]) - z;
    if ((dx * dx) + (dy * dy) + (dz * dz) <= HARDPOINT_POSITION_TOLERANCE_SQ) {
      return { ...entry, flatIndex };
    }
  }
  return null;
}

function validateRestrictions(
  modulesByID,
  definitionsByID,
  template,
  diagnostics: CreationLayoutDiagnostic[],
) {
  const restrictions = template && template.restrictions;
  if (!restrictions || typeof restrictions !== "object") {
    return;
  }

  const typeCounts = new Map<number, number>();
  const capabilityCounts = new Map<string, number>();
  for (const [itemID, module] of modulesByID.entries()) {
    const typeID = toPositiveInteger(module && module.typeID);
    if (typeID <= 0) {
      continue;
    }
    typeCounts.set(typeID, (typeCounts.get(typeID) || 0) + 1);
    const definition = definitionsByID.get(itemID);
    const capability = String(definition && definition.capability || "");
    if (capability) {
      capabilityCounts.set(
        capability,
        (capabilityCounts.get(capability) || 0) + 1,
      );
    }
  }

  for (const [rawTypeID, rule] of Object.entries<any>(restrictions.by_type || {})) {
    const typeID = toPositiveInteger(rawTypeID);
    const count = typeCounts.get(typeID) || 0;
    const minimum = rule && Number.isFinite(Number(rule.min))
      ? Number(rule.min)
      : null;
    const maximum = rule && Number.isFinite(Number(rule.max))
      ? Number(rule.max)
      : null;
    if (minimum !== null && count < minimum) {
      diagnostics.push(blocker("multiplicity_below_minimum", null, {
        type_id: typeID,
        count,
        minimum,
      }));
    }
    if (maximum !== null && count > maximum) {
      diagnostics.push(blocker("multiplicity_exceeded", null, {
        type_id: typeID,
        count,
        maximum,
      }));
    }
  }

  for (const [capability, rule] of Object.entries<any>(
    restrictions.by_capability || {},
  )) {
    const count = capabilityCounts.get(capability) || 0;
    const minimum = rule && Number.isFinite(Number(rule.min))
      ? Number(rule.min)
      : null;
    const maximum = rule && Number.isFinite(Number(rule.max))
      ? Number(rule.max)
      : null;
    if (minimum !== null && count < minimum) {
      diagnostics.push(blocker("capability_below_minimum", null, {
        capability,
        count,
        minimum,
      }));
    }
    if (maximum !== null && count > maximum) {
      diagnostics.push(blocker("capability_exceeded", null, {
        capability,
        count,
        maximum,
      }));
    }
  }
}

function validateCreationLayout(
  state,
  explicitTemplate = null,
  options: CreationStaticResolvers = {},
) {
  const diagnostics: CreationLayoutDiagnostic[] = [];
  const resolvers = validationResolvers(options);
  if (!state || typeof state !== "object") {
    return [blocker("invalid_post_commit_state", null, {
      reason: "CREATION_STATE_MISSING",
    })];
  }

  const stateTemplateTypeID = toPositiveInteger(state.templateTypeID);
  const template = explicitTemplate || resolvers.getTemplate(stateTemplateTypeID);
  const templateTypeID = toPositiveInteger(
    template && (template.typeID ?? template._key),
  );
  if (!template || templateTypeID <= 0) {
    return [blocker("invalid_post_commit_state", null, {
      reason: "CREATION_TEMPLATE_NOT_FOUND",
      type_id: stateTemplateTypeID,
    })];
  }
  if (stateTemplateTypeID !== templateTypeID) {
    diagnostics.push(blocker("invalid_post_commit_state", null, {
      reason: "CREATION_TEMPLATE_MISMATCH",
      expected_type_id: templateTypeID,
      actual_type_id: stateTemplateTypeID,
    }));
  }

  const modulesByID = new Map<number, any>();
  const definitionsByID = new Map<number, any>();
  for (const module of Array.isArray(state.modules) ? state.modules : []) {
    const itemID = toPositiveInteger(module && module.itemID);
    const typeID = toPositiveInteger(module && module.typeID);
    if (itemID <= 0 || typeID <= 0) {
      diagnostics.push(blocker("invalid_post_commit_state", itemID || null, {
        reason: "INVALID_MODULE_REFERENCE",
      }));
      continue;
    }
    if (modulesByID.has(itemID)) {
      diagnostics.push(blocker("duplicate_change", itemID, {
        reason: "DUPLICATE_MODULE_ITEM_ID",
      }));
      continue;
    }
    modulesByID.set(itemID, module);
    const definition = resolvers.getModule(typeID);
    definitionsByID.set(itemID, definition);
    if (!definition) {
      diagnostics.push(blocker("missing_classification", itemID, {
        reason: "CREATION_MODULE_NOT_FOUND",
        type_id: typeID,
      }));
    }
  }

  const placementsByID = new Map<number, any>();
  for (const placement of Array.isArray(state.interiorPlacements)
    ? state.interiorPlacements
    : []) {
    const itemID = toPositiveInteger(placement && placement.itemID);
    if (itemID <= 0 || placementsByID.has(itemID)) {
      diagnostics.push(blocker("invalid_placement", itemID || null, {
        reason: itemID > 0
          ? "DUPLICATE_INTERIOR_PLACEMENT"
          : "INVALID_INTERIOR_ITEM_ID",
      }));
      continue;
    }
    placementsByID.set(itemID, placement);
    if (!modulesByID.has(itemID)) {
      diagnostics.push(blocker("not_installed", itemID, {
        reason: "PLACEMENT_MODULE_NOT_INSTALLED",
      }));
    }
  }

  const occupied = new Map<string, number>();
  for (const [itemID, module] of modulesByID.entries()) {
    const definition = definitionsByID.get(itemID);
    if (!definition) {
      continue;
    }
    const interior = isInteriorModule(definition);
    const exterior = isExteriorModule(definition);
    const placement = placementsByID.get(itemID);
    if (!interior && !exterior) {
      diagnostics.push(blocker("missing_classification", itemID, {
        type_id: toPositiveInteger(module && module.typeID),
      }));
      continue;
    }
    if (exterior && placement) {
      diagnostics.push(blocker("invalid_placement", itemID, {
        reason: "EXTERIOR_MODULE_HAS_INTERIOR_PLACEMENT",
      }));
      continue;
    }
    if (!interior) {
      continue;
    }
    if (!placement) {
      diagnostics.push(blocker("invalid_placement", itemID, {
        reason: "INTERIOR_MODULE_NOT_PLACED",
      }));
      continue;
    }

    const partID = toPositiveInteger(placement.partID);
    const graphicID = partGraphicID(template, partID);
    const part = graphicID > 0 ? resolvers.getPart(graphicID) : null;
    if (!part) {
      diagnostics.push(blocker("invalid_part", itemID, {
        part_id: partID,
        graphic_id: graphicID || null,
      }));
      continue;
    }

    const rotation = placement.rotation && typeof placement.rotation === "object"
      ? placement.rotation
      : {};
    const rotationX = normalizeReflection(rotation.x);
    const rotationY = normalizeReflection(rotation.y);
    const rotationZ = normalizeQuarterTurn(rotation.z);
    const coordinatesValid = [placement.x, placement.y, placement.z]
      .every(isIntegerCoordinate);
    if (
      !coordinatesValid ||
      rotationX === null ||
      rotationY === null ||
      rotationZ === null ||
      !Array.isArray(definition.placement.occupancy.cells)
    ) {
      diagnostics.push(blocker("invalid_placement", itemID, {
        reason: "UNSUPPORTED_GRID_TRANSFORM",
        part_id: partID,
      }));
      continue;
    }

    const available = new Set(
      (Array.isArray(part.cells) ? part.cells : [])
        .filter((cell) => isIntegerCoordinate(cell && cell.x) &&
          isIntegerCoordinate(cell && cell.y))
        .map((cell) => `${Number(cell.x)}:${Number(cell.y)}:0`),
    );
    const absoluteCells: Array<[number, number, number]> = [];
    let invalidCell = false;
    for (const cell of definition.placement.occupancy.cells) {
      if (!isIntegerCoordinate(cell && cell.x) ||
        !isIntegerCoordinate(cell && cell.y)) {
        diagnostics.push(blocker("invalid_post_commit_state", itemID, {
          reason: "INVALID_SDE_OCCUPANCY_CELL",
          type_id: toPositiveInteger(module && module.typeID),
        }));
        invalidCell = true;
        break;
      }
    }
    const transformedCells = invalidCell ? null : transformCreationCellOffsets(
      definition.placement.occupancy.cells,
      { x: rotationX, y: rotationY, z: rotationZ },
    );
    if (!transformedCells) {
      continue;
    }
    for (const [rdx, rdy, rdz] of transformedCells) {
      const absolute: [number, number, number] = [
        Number(placement.x) + rdx,
        Number(placement.y) + rdy,
        Number(placement.z) + rdz,
      ];
      if (!available.has(`${absolute[0]}:${absolute[1]}:${absolute[2]}`)) {
        diagnostics.push(blocker("invalid_placement", itemID, {
          reason: "CELL_OUTSIDE_PART",
          part_id: partID,
          cell: absolute,
        }));
        invalidCell = true;
        break;
      }
      absoluteCells.push(absolute);
    }
    if (invalidCell) {
      continue;
    }

    for (const [x, y, z] of absoluteCells) {
      const key = `${partID}:${x}:${y}:${z}`;
      const conflictingItemID = occupied.get(key);
      if (conflictingItemID) {
        diagnostics.push(blocker("invalid_placement", itemID, {
          reason: "CELL_OCCUPIED",
          part_id: partID,
          cell: [x, y, z],
          conflicting_item_id: conflictingItemID,
        }));
        break;
      }
    }
    for (const [x, y, z] of absoluteCells) {
      const key = `${partID}:${x}:${y}:${z}`;
      if (!occupied.has(key)) {
        occupied.set(key, itemID);
      }
    }

    // Do not enforce placement.must_be_in_root here. Build 3502403 template
    // 95968 contradicts that field for command module 95323, and the native
    // CreationLayoutValidator intentionally does not apply it either.
  }

  const seenProviderSlots = new Map<string, number>();
  const claimedLocators = new Map<string, number>();
  const attachedByItemID = new Map<number, string>();
  const hardpoints = Array.isArray(state.hardpoints) ? state.hardpoints : [];
  for (let hardpointListIndex = 0; hardpointListIndex < hardpoints.length;
    hardpointListIndex += 1) {
    const hardpoint = hardpoints[hardpointListIndex];
    const interiorItemID = toPositiveInteger(hardpoint && hardpoint.interiorItemID);
    const hardpointIndex = toNonNegativeInteger(hardpoint && hardpoint.hardpointIndex);
    const provider = modulesByID.get(interiorItemID);
    const providerDefinition = definitionsByID.get(interiorItemID);
    const declared = providerDefinition && providerDefinition.placement &&
      Array.isArray(providerDefinition.placement.hardpoints)
      ? providerDefinition.placement.hardpoints
      : [];
    if (!provider || !isInteriorModule(providerDefinition) ||
      hardpointIndex < 0 || !declared[hardpointIndex]) {
      diagnostics.push(blocker("no_hardpoint", interiorItemID || null, {
        hardpoint_index: hardpointIndex,
      }));
      continue;
    }

    const providerSlot = `${interiorItemID}:${hardpointIndex}`;
    if (seenProviderSlots.has(providerSlot)) {
      diagnostics.push(blocker("hardpoint_slot_conflict", interiorItemID, {
        hardpoint_index: hardpointIndex,
      }));
      continue;
    }
    seenProviderSlots.set(providerSlot, hardpointListIndex);

    const partID = toPositiveInteger(hardpoint && hardpoint.partID);
    const graphicID = partGraphicID(template, partID);
    const part = graphicID > 0 ? resolvers.getPart(graphicID) : null;
    if (!part) {
      diagnostics.push(blocker("invalid_part", interiorItemID, {
        part_id: partID,
        graphic_id: graphicID || null,
      }));
      continue;
    }
    const x = Number(hardpoint && hardpoint.x);
    const y = Number(hardpoint && hardpoint.y);
    const z = Number(hardpoint && hardpoint.z);
    if (![x, y, z].every(Number.isFinite)) {
      diagnostics.push(blocker("invalid_placement", interiorItemID, {
        reason: "INVALID_HARDPOINT_POSITION",
        hardpoint_index: hardpointIndex,
      }));
      continue;
    }
    const matched = matchLocator(x, y, z, locatorEntries(part));
    if (!matched) {
      diagnostics.push(blocker("invalid_placement", interiorItemID, {
        reason: "HARDPOINT_LOCATION_NOT_IN_SDE",
        hardpoint_index: hardpointIndex,
        part_id: partID,
      }));
      continue;
    }

    const hardpointType = String(declared[hardpointIndex]);
    const hardpointTypeDefinition = resolvers.getHardpointType(hardpointType);
    const expectedLocatorSet = String(
      hardpointTypeDefinition &&
      (hardpointTypeDefinition.locator_set ?? hardpointTypeDefinition.locatorSet) ||
      "",
    );
    if (!expectedLocatorSet || matched.locatorSet !== expectedLocatorSet) {
      diagnostics.push(blocker("hardpoint_type_mismatch", interiorItemID, {
        hardpoint_index: hardpointIndex,
        hardpoint_type: hardpointType,
        expected_locator_set: expectedLocatorSet || null,
        actual_locator_set: matched.locatorSet,
      }));
      continue;
    }

    const locatorKey = `${partID}:${matched.flatIndex}`;
    const conflictingInteriorItemID = claimedLocators.get(locatorKey);
    if (conflictingInteriorItemID) {
      diagnostics.push(blocker("hardpoint_slot_conflict", interiorItemID, {
        hardpoint_index: hardpointIndex,
        part_id: partID,
        locator_index: matched.flatIndex,
        conflicting_item_id: conflictingInteriorItemID,
      }));
      continue;
    }
    claimedLocators.set(locatorKey, interiorItemID);

    const attachedItemID = hardpoint && hardpoint.attachedItemID != null
      ? toPositiveInteger(hardpoint.attachedItemID)
      : 0;
    if (attachedItemID <= 0) {
      continue;
    }
    const attached = modulesByID.get(attachedItemID);
    const attachedDefinition = definitionsByID.get(attachedItemID);
    if (!attached || !isExteriorModule(attachedDefinition)) {
      diagnostics.push(blocker("item_unavailable", attachedItemID, {
        reason: "ATTACHED_EXTERIOR_MODULE_NOT_INSTALLED",
      }));
      continue;
    }
    const compatible = attachedDefinition.placement.compatible_hardpoints;
    if (!compatible.includes(hardpointType)) {
      diagnostics.push(blocker("hardpoint_type_mismatch", attachedItemID, {
        hardpoint_type: hardpointType,
        compatible_hardpoints: compatible,
      }));
      continue;
    }
    if (attachedByItemID.has(attachedItemID)) {
      diagnostics.push(blocker("hardpoint_double_bind", attachedItemID, {
        first_provider_slot: attachedByItemID.get(attachedItemID),
        second_provider_slot: providerSlot,
      }));
      continue;
    }
    attachedByItemID.set(attachedItemID, providerSlot);
  }

  for (const [itemID, definition] of definitionsByID.entries()) {
    if (!isInteriorModule(definition)) {
      continue;
    }
    const declared = definition.placement &&
      Array.isArray(definition.placement.hardpoints)
      ? definition.placement.hardpoints
      : [];
    const missing: number[] = [];
    for (let index = 0; index < declared.length; index += 1) {
      if (!seenProviderSlots.has(`${itemID}:${index}`)) {
        missing.push(index);
      }
    }
    if (missing.length > 0) {
      diagnostics.push(blocker("missing_hardpoint_placement", itemID, {
        hardpoint_indices: missing,
      }));
    }
  }

  for (const [itemID, definition] of definitionsByID.entries()) {
    if (isExteriorModule(definition) && !attachedByItemID.has(itemID)) {
      diagnostics.push(blocker("no_hardpoint", itemID, {
        reason: "EXTERIOR_MODULE_NOT_ATTACHED",
      }));
    }
  }

  validateRestrictions(modulesByID, definitionsByID, template, diagnostics);
  return diagnostics;
}

function vector(values, dimensions, fallbackLast = 0) {
  const source = Array.isArray(values) ? values : [];
  return Array.from({ length: dimensions }, (_, index) =>
    toFiniteNumber(source[index], index === dimensions - 1 ? fallbackLast : 0));
}

function buildCreationValidationStateFromTemplate(template) {
  let nextItemID = 1;
  const modules: any[] = [];
  const interiorPlacements: any[] = [];
  const hardpoints: any[] = [];
  for (const interior of Array.isArray(template && template.interior_modules)
    ? template.interior_modules
    : []) {
    const interiorItemID = nextItemID++;
    const interiorTypeID = toPositiveInteger(interior && interior.type_id);
    modules.push({ itemID: interiorItemID, typeID: interiorTypeID });
    const position = vector(interior && interior.position, 3);
    const rotation = vector(interior && interior.rotation, 3);
    interiorPlacements.push({
      itemID: interiorItemID,
      partID: toPositiveInteger(interior && interior.part_id),
      x: position[0],
      y: position[1],
      z: position[2],
      rotation: { x: rotation[0], y: rotation[1], z: rotation[2] },
    });
    const authoredHardpoints = Array.isArray(interior && interior.hardpoints)
      ? interior.hardpoints
      : [];
    authoredHardpoints.forEach((hardpoint, hardpointIndex) => {
      const exteriorTypeID = toPositiveInteger(
        hardpoint && hardpoint.exterior_type_id,
      );
      const attachedItemID = exteriorTypeID > 0 ? nextItemID++ : null;
      if (attachedItemID) {
        modules.push({ itemID: attachedItemID, typeID: exteriorTypeID });
      }
      const hardpointPosition = vector(hardpoint && hardpoint.position, 3);
      const hardpointRotation = vector(hardpoint && hardpoint.rotation, 4, 1);
      hardpoints.push({
        interiorItemID,
        hardpointIndex,
        creationID: 1,
        partID: toPositiveInteger(hardpoint && hardpoint.part_id),
        x: hardpointPosition[0],
        y: hardpointPosition[1],
        z: hardpointPosition[2],
        rotation: {
          x: hardpointRotation[0],
          y: hardpointRotation[1],
          z: hardpointRotation[2],
          w: hardpointRotation[3],
        },
        attachedItemID,
      });
    });
  }
  return {
    version: 1,
    templateTypeID: toPositiveInteger(template && (template.typeID ?? template._key)),
    poweredOff: false,
    modules,
    interiorPlacements,
    hardpoints,
  };
}

function validateCreationTemplateLayout(
  template,
  options: CreationStaticResolvers = {},
) {
  return validateCreationLayout(
    buildCreationValidationStateFromTemplate(template),
    template,
    options,
  );
}

module.exports = {
  HARDPOINT_POSITION_TOLERANCE_SQ,
  buildCreationValidationStateFromTemplate,
  rotateCreationCellOffset,
  transformCreationCellOffsets,
  validateCreationLayout,
  validateCreationTemplateLayout,
};
