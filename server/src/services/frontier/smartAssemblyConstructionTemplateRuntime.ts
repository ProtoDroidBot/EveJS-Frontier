"use strict";

const path = require("path");
const { createHash, randomUUID } = require("crypto");

const itemStore = require(path.join(__dirname, "../inventory/itemStore"));
const deployment = require(path.join(__dirname, "./deploymentRuntime"));
const industryBlueprints = require(path.join(__dirname, "./industryBlueprints"));
const industryProduction = require(path.join(__dirname, "./industryProduction"));
const templateStore = require(path.join(
  __dirname,
  "./smartAssemblyConstructionTemplateStore",
));

const CONSTRUCTION_TEMPLATE_PREVIEW_TTL_MS = 60_000;
const CONSTRUCTION_TEMPLATE_NODE_LIMIT = 100;
const CONSTRUCTION_TEMPLATE_NAME_LIMIT = 80;
const CONSTRUCTION_TEMPLATE_DESCRIPTION_LIMIT = 1_000;
const NETWORK_NODE_TYPE_ID = 88_092;
const SHIP_CARGO_FLAG = 5;
const PLACEMENT_MODES = new Set(["auto", "directAssembly", "constructionSite"]);
const TERMINAL_NODE_STATES = new Set(["completed", "cancelled"]);
const previewTokens = new Map<string, any>();
const planRetryTimers = new Map<string, any>();

function cloneValue(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function toInt(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isSafeInteger(numeric) ? numeric : fallback;
}

function toFinite(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]),
    );
  }
  return value;
}

function hashValue(value) {
  return createHash("sha256")
    .update(JSON.stringify(canonicalize(value)))
    .digest("hex");
}

function playerPrincipal(session) {
  return {
    kind: "player",
    id: String(toInt(session && (session.characterID || session.charid), 0)),
  };
}

function normalizeVector(value, fallback = null) {
  const source = Array.isArray(value) ? value : value && typeof value === "object" ? value : null;
  if (!source) return fallback;
  const x = toFinite(source.x ?? source[0], Number.NaN);
  const y = toFinite(source.y ?? source[1], Number.NaN);
  const z = toFinite(source.z ?? source[2], Number.NaN);
  return [x, y, z].every(Number.isFinite) ? { x, y, z } : fallback;
}

function normalizeRotation(value, fallback = null) {
  const source = Array.isArray(value) ? value : value && typeof value === "object" ? value : null;
  if (!source) return fallback;
  const yaw = toFinite(source.yaw ?? source[0], Number.NaN);
  const pitch = toFinite(source.pitch ?? source[1], Number.NaN);
  const roll = toFinite(source.roll ?? source[2], Number.NaN);
  return [yaw, pitch, roll].every(Number.isFinite) ? { yaw, pitch, roll } : fallback;
}

function normalizePlacementMode(value) {
  const raw = String(value || "auto").trim();
  const aliases = {
    auto: "auto",
    direct: "directAssembly",
    direct_assembly: "directAssembly",
    "direct-assembly": "directAssembly",
    directAssembly: "directAssembly",
    site: "constructionSite",
    construction_site: "constructionSite",
    "construction-site": "constructionSite",
    constructionSite: "constructionSite",
  };
  return aliases[raw] || null;
}

function normalizeQuantityEntries(value) {
  const entries = Array.isArray(value)
    ? value.map((entry) => [entry && (entry.typeID ?? entry.type_id), entry && entry.quantity])
    : value && typeof value === "object"
      ? Object.entries<any>(value)
      : [];
  const byTypeID = new Map<number, number>();
  for (const [rawTypeID, rawQuantity] of entries) {
    const typeID = toInt(rawTypeID, 0);
    const quantity = toInt(rawQuantity, 0);
    if (typeID <= 0 || quantity <= 0) return null;
    const total = (byTypeID.get(typeID) || 0) + quantity;
    if (!Number.isSafeInteger(total)) return null;
    byTypeID.set(typeID, total);
  }
  return Array.from(byTypeID, ([typeID, quantity]) => ({ typeID, quantity }))
    .sort((left, right) => left.typeID - right.typeID);
}

function normalizeIndustryLanes(value, assemblyTypeID) {
  const source = value == null ? [] : value;
  if (!Array.isArray(source)) return null;
  const laneIDs = new Set<number>();
  const laneCount = industryProduction.getFacilityLaneCount({ typeID: assemblyTypeID });
  const lanes: any[] = [];
  for (const entry of source) {
    const laneID = toInt(entry && (entry.laneID ?? entry.lane_id), 0);
    const blueprintID = toInt(entry && (entry.blueprintID ?? entry.blueprint_id), 0);
    const runs = toInt(entry && (entry.runs ?? entry.requestedRuns ?? entry.requested_runs), 0);
    if (laneID <= 0 || laneID > laneCount || laneIDs.has(laneID) || blueprintID <= 0 ||
        runs <= 0 || runs > 1_000_000 ||
        !industryBlueprints.getBlueprintForFacility(assemblyTypeID, blueprintID)) return null;
    laneIDs.add(laneID);
    lanes.push({ laneID, blueprintID, runs });
  }
  return lanes.sort((left, right) => left.laneID - right.laneID);
}

function normalizeLoadout(value, assemblyTypeID) {
  const input = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const initialInventory = normalizeQuantityEntries(
    input.initialInventory ?? input.initial_inventory ?? [],
  );
  const initialFuel = normalizeQuantityEntries(input.initialFuel ?? input.initial_fuel ?? []);
  const industryLanes = normalizeIndustryLanes(
    input.industryLanes ?? input.industry_lanes ?? [],
    assemblyTypeID,
  );
  if (!initialInventory || !initialFuel || initialFuel.length > 1 || !industryLanes) return null;
  const desiredStatus = String(input.desiredStatus ?? input.desired_status ?? "offline")
    .trim()
    .toLowerCase();
  if (!["offline", "online"].includes(desiredStatus)) return null;
  const collectIndustryOutputs = input.collectIndustryOutputs ?? input.collect_industry_outputs ?? true;
  if (typeof collectIndustryOutputs !== "boolean") return null;
  return { initialInventory, initialFuel, desiredStatus, industryLanes, collectIndustryOutputs };
}

function diagnostic(code, nodeID = null, params: Record<string, any> = {}) {
  return { code, nodeID, severity: "blocker", params };
}

function normalizeConstructionTemplate(input) {
  const name = String(input && input.name || "").trim().slice(0, CONSTRUCTION_TEMPLATE_NAME_LIMIT);
  const description = String(input && input.description || "")
    .trim()
    .slice(0, CONSTRUCTION_TEMPLATE_DESCRIPTION_LIMIT);
  const rawNodes = Array.isArray(input && input.nodes) ? input.nodes : [];
  const diagnostics: any[] = [];
  if (!name) diagnostics.push(diagnostic("CONSTRUCTION_TEMPLATE_NAME_REQUIRED"));
  if (rawNodes.length === 0 || rawNodes.length > CONSTRUCTION_TEMPLATE_NODE_LIMIT) {
    diagnostics.push(diagnostic("CONSTRUCTION_TEMPLATE_NODE_COUNT_INVALID", null, {
      count: rawNodes.length,
      limit: CONSTRUCTION_TEMPLATE_NODE_LIMIT,
    }));
  }

  const nodeIDs = new Set<string>();
  const nodes: any[] = [];
  for (let index = 0; index < rawNodes.length; index += 1) {
    const raw = rawNodes[index] || {};
    const nodeID = String(raw.nodeID ?? raw.node_id ?? `node-${index + 1}`).trim();
    const assemblyTypeID = toInt(raw.assemblyTypeID ?? raw.assembly_type_id ?? raw.typeID, 0);
    const relativePosition = normalizeVector(
      raw.relativePosition ?? raw.relative_position ?? raw.position,
      null,
    );
    const rotation = normalizeRotation(raw.rotation, { yaw: 0, pitch: 0, roll: 0 });
    let placementMode = normalizePlacementMode(raw.placementMode ?? raw.placement_mode);
    const loadout = normalizeLoadout(
      raw.loadout ?? raw.baseLoadout ?? raw.base_loadout,
      assemblyTypeID,
    );
    const dependsOn = [...new Set(
      (Array.isArray(raw.dependsOn ?? raw.depends_on) ? raw.dependsOn ?? raw.depends_on : [])
        .map((entry) => String(entry || "").trim())
        .filter(Boolean),
    )].sort();
    if (!/^[A-Za-z0-9_.:-]{1,80}$/u.test(nodeID) || nodeIDs.has(nodeID)) {
      diagnostics.push(diagnostic("CONSTRUCTION_TEMPLATE_NODE_ID_INVALID", nodeID || null));
      continue;
    }
    nodeIDs.add(nodeID);
    if (assemblyTypeID <= 0 || !deployment.listAssemblyDefinitions()
      .some((entry) => entry.assemblyTypeID === assemblyTypeID)) {
      diagnostics.push(diagnostic("CONSTRUCTION_TEMPLATE_ASSEMBLY_TYPE_UNSUPPORTED", nodeID, {
        assemblyTypeID,
      }));
    }
    if (!relativePosition) diagnostics.push(diagnostic("CONSTRUCTION_TEMPLATE_POSITION_INVALID", nodeID));
    if (!rotation) diagnostics.push(diagnostic("CONSTRUCTION_TEMPLATE_ROTATION_INVALID", nodeID));
    if (!placementMode || !PLACEMENT_MODES.has(placementMode)) {
      diagnostics.push(diagnostic("CONSTRUCTION_TEMPLATE_PLACEMENT_MODE_INVALID", nodeID));
    }
    if (placementMode === "constructionSite" &&
        deployment.isConstructionDepotExemptAssemblyType(assemblyTypeID)) {
      placementMode = "directAssembly";
    }
    if (placementMode === "directAssembly" &&
        !deployment.isConstructionDepotExemptAssemblyType(assemblyTypeID)) {
      diagnostics.push(diagnostic("DIRECT_ASSEMBLY_PORTABLE_ONLY", nodeID, { assemblyTypeID }));
    }
    if (!loadout) diagnostics.push(diagnostic("CONSTRUCTION_TEMPLATE_LOADOUT_INVALID", nodeID));
    nodes.push({
      nodeID,
      assemblyTypeID,
      relativePosition: relativePosition || { x: 0, y: 0, z: 0 },
      rotation: rotation || { yaw: 0, pitch: 0, roll: 0 },
      placementMode: placementMode || "auto",
      dependsOn,
      loadout: loadout || { initialInventory: [], initialFuel: [], desiredStatus: "offline",
        industryLanes: [], collectIndustryOutputs: true },
    });
  }

  for (const rawEdge of Array.isArray(input && input.edges) ? input.edges : []) {
    const from = String(rawEdge && (rawEdge.from ?? rawEdge.fromNodeID ?? rawEdge.from_node_id) || "").trim();
    const to = String(rawEdge && (rawEdge.to ?? rawEdge.toNodeID ?? rawEdge.to_node_id) || "").trim();
    const node = nodes.find((entry) => entry.nodeID === to);
    if (!from || !node || !nodeIDs.has(from) || from === to) {
      diagnostics.push(diagnostic("CONSTRUCTION_TEMPLATE_EDGE_INVALID", to || null, { from, to }));
    } else if (!node.dependsOn.includes(from)) {
      node.dependsOn.push(from);
      node.dependsOn.sort();
    }
  }

  for (const node of nodes) {
    for (const dependency of node.dependsOn) {
      if (!nodeIDs.has(dependency) || dependency === node.nodeID) {
        diagnostics.push(diagnostic("CONSTRUCTION_TEMPLATE_DEPENDENCY_INVALID", node.nodeID, {
          dependency,
        }));
      }
    }
    if (node.loadout.initialFuel.length > 0 && node.assemblyTypeID !== NETWORK_NODE_TYPE_ID) {
      diagnostics.push(diagnostic("CONSTRUCTION_TEMPLATE_FUEL_TARGET_INVALID", node.nodeID));
    }
    if (node.loadout.initialInventory.length > 0) {
      const turretInventory = require("./smartTurretInventoryRuntime");
      if (!turretInventory.getTurretComponent(node.assemblyTypeID)) {
        diagnostics.push(diagnostic("CONSTRUCTION_TEMPLATE_INVENTORY_TARGET_UNSUPPORTED", node.nodeID, {
          reason: "Only owner-authoritative Smart Turret cargo is currently eligible for unattended loadout seeding.",
        }));
      }
    }
    if (node.loadout.industryLanes.length > 0 &&
        !industryBlueprints.isIndustryFacilityType(node.assemblyTypeID)) {
      diagnostics.push(diagnostic("CONSTRUCTION_TEMPLATE_INDUSTRY_TARGET_UNSUPPORTED", node.nodeID));
    }
  }

  const orderResult = topologicalOrder(nodes);
  if (!orderResult.success) diagnostics.push(diagnostic("CONSTRUCTION_TEMPLATE_DEPENDENCY_CYCLE"));
  return diagnostics.length > 0
    ? { success: false as const, diagnostics }
    : {
        success: true as const,
        data: {
          name,
          description,
          nodes: nodes.sort((left, right) => left.nodeID.localeCompare(right.nodeID)),
          executionOrder: orderResult.order,
          compositionHash: hashValue(nodes),
        },
      };
}

function topologicalOrder(nodes) {
  const byID = new Map(nodes.map((node) => [node.nodeID, node]));
  const visited = new Set<string>();
  const visiting = new Set<string>();
  const order: string[] = [];
  function visit(nodeID) {
    if (visited.has(nodeID)) return true;
    if (visiting.has(nodeID)) return false;
    const node: any = byID.get(nodeID);
    if (!node) return false;
    visiting.add(nodeID);
    for (const dependency of node.dependsOn || []) {
      if (!visit(dependency)) return false;
    }
    visiting.delete(nodeID);
    visited.add(nodeID);
    order.push(nodeID);
    return true;
  }
  for (const node of nodes) {
    if (!visit(node.nodeID)) return { success: false as const, order: [] };
  }
  return { success: true as const, order };
}

function saveConstructionTemplate(principal, input, options: Record<string, any> = {}) {
  const normalized = normalizeConstructionTemplate(input);
  if (!normalized.success) return normalized;
  const payload = {
    name: normalized.data.name,
    description: normalized.data.description,
    nodes: normalized.data.nodes,
    executionOrder: normalized.data.executionOrder,
    compositionHash: normalized.data.compositionHash,
    // Construction Templates are the placement artifact. Do not introduce a
    // second blueprint/config object; blueprint remains an industry term.
    kind: "construction-template",
  };
  const templateID = String(options.templateID || "").trim();
  const result = templateID
    ? templateStore.updateConstructionTemplate(
        principal,
        templateID,
        payload,
        options.expectedRevision,
        options,
      )
    : templateStore.createConstructionTemplate(principal, payload, options);
  return result.success
    ? { success: true as const, data: result.data, diagnostics: [] }
    : { success: false as const, errorMsg: result.errorMsg, diagnostics: [diagnostic(result.errorMsg)] };
}

function deleteConstructionTemplate(principal, templateID) {
  return templateStore.deleteConstructionTemplate(principal, templateID);
}

function listConstructionTemplates(principal) {
  return templateStore.listConstructionTemplates(principal).map((record) => ({
    ...record,
    nodeCount: Array.isArray(record.nodes) ? record.nodes.length : 0,
  }));
}

function getConstructionTemplate(principal, templateID) {
  return templateStore.getConstructionTemplate(principal, templateID);
}

function rotateVector(vector, rotation) {
  const cy = Math.cos(rotation.yaw);
  const sy = Math.sin(rotation.yaw);
  const cp = Math.cos(rotation.pitch);
  const sp = Math.sin(rotation.pitch);
  const cr = Math.cos(rotation.roll);
  const sr = Math.sin(rotation.roll);
  return {
    x: (cy * cp) * vector.x + (cy * sp * sr - sy * cr) * vector.y +
      (cy * sp * cr + sy * sr) * vector.z,
    y: (sy * cp) * vector.x + (sy * sp * sr + cy * cr) * vector.y +
      (sy * sp * cr - cy * sr) * vector.z,
    z: (-sp) * vector.x + (cp * sr) * vector.y + (cp * cr) * vector.z,
  };
}

function compileNodePlacement(node, anchor) {
  const relative = rotateVector(node.relativePosition, anchor.rotation);
  return {
    ...cloneValue(node),
    position: {
      x: anchor.position.x + relative.x,
      y: anchor.position.y + relative.y,
      z: anchor.position.z + relative.z,
    },
    rotation: {
      yaw: anchor.rotation.yaw + node.rotation.yaw,
      pitch: anchor.rotation.pitch + node.rotation.pitch,
      roll: anchor.rotation.roll + node.rotation.roll,
    },
  };
}

function validateCompiledNodeSeparation(nodes) {
  const diagnostics: any[] = [];
  for (let leftIndex = 0; leftIndex < nodes.length; leftIndex += 1) {
    const left = nodes[leftIndex];
    const leftMetadata = itemStore.getItemMetadata(left.assemblyTypeID) || {};
    const leftRadius = Math.max(250, toFinite(leftMetadata.radius, 0));
    for (let rightIndex = leftIndex + 1; rightIndex < nodes.length; rightIndex += 1) {
      const right = nodes[rightIndex];
      const rightMetadata = itemStore.getItemMetadata(right.assemblyTypeID) || {};
      const rightRadius = Math.max(250, toFinite(rightMetadata.radius, 0));
      const distance = Math.hypot(
        left.position.x - right.position.x,
        left.position.y - right.position.y,
        left.position.z - right.position.z,
      );
      if (distance < leftRadius + rightRadius) {
        diagnostics.push(diagnostic("CONSTRUCTION_TEMPLATE_NODE_OVERLAP", right.nodeID, {
          otherNodeID: left.nodeID,
          distance,
          minimumDistance: leftRadius + rightRadius,
        }));
      }
    }
  }
  return diagnostics;
}

function compileConstructionTemplateGeometry(principal, templateID, rawAnchor) {
  const template = getConstructionTemplate(principal, templateID);
  if (!template) return { success: false as const, errorMsg: "CONSTRUCTION_TEMPLATE_NOT_FOUND" };
  const anchor = {
    position: normalizeVector(rawAnchor && (rawAnchor.position ?? rawAnchor), null),
    rotation: normalizeRotation(rawAnchor && rawAnchor.rotation, { yaw: 0, pitch: 0, roll: 0 }),
  };
  if (!anchor.position || !anchor.rotation) {
    return { success: false as const, errorMsg: "CONSTRUCTION_TEMPLATE_ANCHOR_INVALID" };
  }
  const byID = new Map(template.nodes.map((node) => [node.nodeID, node]));
  const nodes = template.executionOrder.map((nodeID) =>
    compileNodePlacement(byID.get(nodeID), anchor));
  const diagnostics = validateCompiledNodeSeparation(nodes);
  return diagnostics.length > 0
    ? { success: false as const, errorMsg: "CONSTRUCTION_TEMPLATE_PREVIEW_FAILED", diagnostics }
    : {
        success: true as const,
        data: {
          anchor,
          compositionHash: template.compositionHash,
          executionOrder: cloneValue(template.executionOrder),
          nodes,
          templateID: template.templateID,
          templateRevision: template.revision,
        },
      };
}

function prunePreviewTokens(nowMs = Date.now()) {
  for (const [token, preview] of previewTokens) {
    if (!preview || preview.expiresAtMs <= nowMs) previewTokens.delete(token);
  }
}

function previewConstructionTemplate(session, templateID, rawAnchor, options: Record<string, any> = {}) {
  const principal = playerPrincipal(session);
  if (!toInt(principal.id, 0)) return { success: false as const, errorMsg: "ACCESS_DENIED" };
  const template = getConstructionTemplate(principal, templateID);
  if (!template) return { success: false as const, errorMsg: "CONSTRUCTION_TEMPLATE_NOT_FOUND" };
  const geometry = compileConstructionTemplateGeometry(principal, templateID, rawAnchor);
  if (!geometry.success) return geometry;
  const anchor = geometry.data.anchor;
  const compiledNodes = geometry.data.nodes;
  const diagnostics: any[] = [];
  const virtualNetworkAnchors = compiledNodes
    .filter((node) => node.assemblyTypeID === NETWORK_NODE_TYPE_ID)
    .map((node, index) => ({ itemID: -(index + 1), position: node.position }));
  let availableSiteSlots = deployment.getConstructionSiteCapacity(toInt(principal.id, 0)).available;
  for (const node of compiledNodes) {
    const placement = deployment.previewDeployablePlacement(
      session,
      node.assemblyTypeID,
      node.position,
      node.rotation,
      { additionalNetworkNodeAnchors: virtualNetworkAnchors },
    );
    if (!placement.success) {
      diagnostics.push(diagnostic(placement.errorMsg, node.nodeID, placement.data || {}));
      node.previewState = "blocked";
      node.previewError = placement.errorMsg;
      continue;
    }
    node.resolvedPlacementMode = placement.data.directPlacement
      ? "directAssembly"
      : "constructionSite";
    const requestedPlacementMode = deployment.isConstructionDepotExemptAssemblyType(
      node.assemblyTypeID,
    ) && node.placementMode !== "auto"
      ? "directAssembly"
      : node.placementMode;
    if (requestedPlacementMode !== "auto" &&
        requestedPlacementMode !== node.resolvedPlacementMode) {
      diagnostics.push(diagnostic("CONSTRUCTION_TEMPLATE_PLACEMENT_MODE_MISMATCH", node.nodeID, {
        requested: requestedPlacementMode,
        resolved: node.resolvedPlacementMode,
      }));
      node.previewState = "blocked";
      continue;
    }
    node.constructionCost = cloneValue(placement.data.definition.constructionCost);
    node.previewState = node.resolvedPlacementMode === "constructionSite" && availableSiteSlots <= 0
      ? "queued-site-capacity"
      : "ready";
    if (node.resolvedPlacementMode === "constructionSite" && availableSiteSlots > 0) {
      availableSiteSlots -= 1;
    }
  }
  if (diagnostics.length > 0) {
    return { success: false as const, errorMsg: "CONSTRUCTION_TEMPLATE_PREVIEW_FAILED", diagnostics };
  }
  prunePreviewTokens();
  const previewToken = randomUUID().toLowerCase();
  const preview = {
    previewToken,
    principal,
    templateID: template.templateID,
    templateRevision: template.revision,
    compositionHash: template.compositionHash,
    anchor,
    solarSystemID: toInt(session && (session.solarsystemid2 || session.solarsystemid), 0),
    nodes: compiledNodes,
    createdAtMs: Date.now(),
    expiresAtMs: Date.now() + CONSTRUCTION_TEMPLATE_PREVIEW_TTL_MS,
    options: cloneValue(options),
  };
  previewTokens.set(previewToken, preview);
  return {
    success: true as const,
    diagnostics: [],
    data: cloneValue(preview),
  };
}

function createConstructionPlanFromPreview(session, previewToken) {
  prunePreviewTokens();
  const principal = playerPrincipal(session);
  const preview = previewTokens.get(String(previewToken || "").toLowerCase());
  if (!preview || preview.principal.kind !== principal.kind || preview.principal.id !== principal.id) {
    return { success: false as const, errorMsg: "CONSTRUCTION_TEMPLATE_PREVIEW_INVALID" };
  }
  const current = getConstructionTemplate(principal, preview.templateID);
  if (!current || current.revision !== preview.templateRevision ||
      current.compositionHash !== preview.compositionHash) {
    return { success: false as const, errorMsg: "CONSTRUCTION_TEMPLATE_CHANGED" };
  }
  previewTokens.delete(preview.previewToken);
  const nodeStates = Object.fromEntries(preview.nodes.map((node) => [node.nodeID, {
    nodeID: node.nodeID,
    status: node.previewState === "queued-site-capacity" ? "queued-site-capacity" : "pending",
    itemID: 0,
    errorMsg: null,
    attempts: 0,
    loadout: { inventoryApplied: false, fuelApplied: false, statusApplied: false },
    authorization: null,
  }]));
  const created = templateStore.createConstructionPlan(principal, {
    templateID: preview.templateID,
    templateRevision: preview.templateRevision,
    compositionHash: preview.compositionHash,
    solarSystemID: preview.solarSystemID,
    anchor: preview.anchor,
    compiledNodes: preview.nodes,
    executionOrder: preview.nodes.map((node) => node.nodeID),
    nodeStates,
    status: "queued",
    cancelledAtMs: 0,
    completedAtMs: 0,
  });
  return created.success ? advancePlayerConstructionPlan(session, created.data.planID) : created;
}

function sourceQuantity(item) {
  return toInt(item && item.singleton, 0) === 1
    ? 1
    : Math.max(0, toInt(item && (item.stacksize ?? item.quantity), 0));
}

function selectSourceStacks(characterID, sourceLocationID, typeID, quantity) {
  let remaining = quantity;
  const selected: any[] = [];
  const candidates = itemStore.listContainerItems(characterID, sourceLocationID, SHIP_CARGO_FLAG)
    .filter((item) => toInt(item.typeID, 0) === typeID)
    .sort((left, right) => left.itemID - right.itemID);
  for (const item of candidates) {
    const take = Math.min(remaining, sourceQuantity(item));
    if (take > 0) selected.push({ itemID: item.itemID, quantity: take });
    remaining -= take;
    if (remaining <= 0) break;
  }
  return remaining <= 0 ? selected : null;
}

function applyTurretInventoryLoadout(session, itemID, entries) {
  if (!entries.length) return { success: true as const };
  const characterID = toInt(session && (session.characterID || session.charid), 0);
  const ship = itemStore.getActiveShipItem(characterID);
  const item = itemStore.findItemById(itemID);
  if (!ship || !item) return { success: false as const, errorMsg: "SHIP_NOT_IN_SPACE" };
  const metadata = itemStore.getItemMetadata(item.typeID) || {};
  const capacity = toFinite(item.capacity ?? metadata.capacity, 0);
  const current = itemStore.listContainerItems(characterID, itemID, 0);
  const currentVolume = current.reduce((sum, entry) =>
    sum + sourceQuantity(entry) * itemStore.getInventoryItemUnitVolume(entry), 0);
  const requestedVolume = entries.reduce((sum, entry) => {
    const type = itemStore.getItemMetadata(entry.typeID) || { typeID: entry.typeID };
    return sum + entry.quantity * itemStore.getInventoryItemUnitVolume(type);
  }, 0);
  if (!(capacity > 0) || currentVolume + requestedVolume > capacity + 1.0e-6) {
    return { success: false as const, errorMsg: "ASSEMBLY_INVENTORY_CAPACITY_EXCEEDED" };
  }
  for (const entry of entries) {
    const available = itemStore.listContainerItems(characterID, ship.itemID, SHIP_CARGO_FLAG)
      .filter((candidate) => toInt(candidate.typeID, 0) === entry.typeID)
      .reduce((sum, candidate) => sum + sourceQuantity(candidate), 0);
    if (available < entry.quantity) {
      return { success: false as const, errorMsg: "CONSTRUCTION_LOADOUT_ITEMS_INSUFFICIENT" };
    }
  }
  const changes: any[] = [];
  for (const entry of entries) {
    const moved = itemStore.moveItemTypeFromCharacterLocation(
      characterID,
      ship.itemID,
      SHIP_CARGO_FLAG,
      itemID,
      0,
      entry.typeID,
      entry.quantity,
    );
    if (!moved.success) return moved;
    changes.push(...(moved.data && moved.data.changes || []));
  }
  return { success: true as const, data: { changes } };
}

function applyNodeLoadout(session, node, state) {
  const itemID = toInt(state.itemID, 0);
  const item = itemStore.findItemById(itemID);
  if (!item) return { success: false as const, errorMsg: "ASSEMBLY_NOT_FOUND" };
  if (deployment.isAssemblyActivationPending(item)) {
    return { success: false as const, retryable: true, errorMsg: "ASSEMBLY_ACTIVATING" };
  }
  const loadout = node.loadout || { initialInventory: [], initialFuel: [], desiredStatus: "offline" };
  if (!state.loadout.inventoryApplied) {
    const inventory = applyTurretInventoryLoadout(session, itemID, loadout.initialInventory || []);
    if (!inventory.success) return { ...inventory, retryable: true };
    state.loadout.inventoryApplied = true;
  }
  if (!state.loadout.fuelApplied) {
    const fuelEntry = (loadout.initialFuel || [])[0];
    if (fuelEntry) {
      const characterID = toInt(session && (session.characterID || session.charid), 0);
      const ship = itemStore.getActiveShipItem(characterID);
      const stacks = ship && selectSourceStacks(
        characterID,
        ship.itemID,
        fuelEntry.typeID,
        fuelEntry.quantity,
      );
      if (!ship || !stacks) {
        return { success: false as const, retryable: true, errorMsg: "CONSTRUCTION_LOADOUT_FUEL_INSUFFICIENT" };
      }
      const fueled = require("./networkNodeFuelRuntime").depositNetworkNodeFuelFromInventory({
        characterID,
        networkNodeID: itemID,
        sourceItemID: ship.itemID,
        sourceFlagID: SHIP_CARGO_FLAG,
        items: stacks,
        flush: true,
        publishNotice: true,
      });
      if (!fueled.success) return { ...fueled, retryable: true };
    }
    state.loadout.fuelApplied = true;
  }
  if (!state.loadout.statusApplied) {
    if (loadout.desiredStatus === "online") {
      if (!state.authorization) {
        const prepared = deployment.beginAssemblyStateTransition(
          session,
          itemID,
          deployment.ASSEMBLY_STATUS_ONLINE,
        );
        if (!prepared.success) return { ...prepared, retryable: prepared.errorMsg === "ASSEMBLY_ACTIVATING" };
        state.authorization = {
          kind: "assembly-state-transition",
          targetStatus: deployment.ASSEMBLY_STATUS_ONLINE,
          transactionData: prepared.data.transactionData,
          transactionUUID: prepared.data.transactionUUID,
        };
      }
      return { success: false as const, authorizationRequired: true, errorMsg: "CONSTRUCTION_PLAN_AUTHORIZATION_REQUIRED" };
    }
    state.loadout.statusApplied = true;
  }
  return { success: true as const };
}

function refreshPlacedNode(session, node, state) {
  const itemID = toInt(state.itemID, 0);
  if (!itemID) return { readyForLoadout: false };
  const assembly = deployment.getAssemblyRecord(itemID);
  if (!assembly) {
    state.status = "blocked";
    state.errorMsg = "ASSEMBLY_NOT_FOUND";
    return { readyForLoadout: false };
  }
  if (assembly.assemblyStatus === deployment.ASSEMBLY_STATUS_UNDER_CONSTRUCTION) {
    const ship = itemStore.getActiveShipItem(toInt(session && (session.characterID || session.charid), 0));
    if (!ship) {
      state.status = "awaiting-resources";
      state.errorMsg = "SHIP_NOT_IN_SPACE";
      return { readyForLoadout: false };
    }
    const depositedBefore = deployment.getDepositedItemsByType(session, itemID);
    if (!depositedBefore.success) {
      state.status = "awaiting-resources";
      state.errorMsg = depositedBefore.errorMsg;
      return { readyForLoadout: false };
    }
    const outstanding = Object.fromEntries(
      Object.entries<any>(node.constructionCost || {})
        .map(([typeID, quantity]) => [
          typeID,
          Math.max(0, toInt(quantity, 0) - toInt(depositedBefore.data[typeID], 0)),
        ])
        .filter(([, quantity]) => Number(quantity) > 0),
    );
    const deposited = Object.keys(outstanding).length > 0
      ? deployment.depositItems(session, itemID, ship.itemID, outstanding)
      : deployment.completeConstruction(itemID, { force: true, session });
    if (!deposited.success) {
      state.status = "awaiting-resources";
      state.errorMsg = deposited.errorMsg;
      return { readyForLoadout: false };
    }
    const updated = deployment.getAssemblyRecord(itemID);
    if (!updated || updated.assemblyStatus === deployment.ASSEMBLY_STATUS_UNDER_CONSTRUCTION) {
      state.status = "awaiting-resources";
      state.errorMsg = null;
      return { readyForLoadout: false };
    }
  }
  return { readyForLoadout: true };
}

function derivePlanStatus(plan) {
  const states = Object.values<any>(plan.nodeStates || {});
  if (states.length > 0 && states.every((state) => state.status === "completed")) return "completed";
  if (states.some((state) => state.status === "blocked")) return "blocked";
  if (states.some((state) => state.status === "awaiting-authorization")) return "awaiting-authorization";
  if (states.some((state) => state.status === "awaiting-resources")) return "awaiting-resources";
  if (states.some((state) => state.status === "awaiting-activation")) return "awaiting-activation";
  if (states.some((state) => state.status === "queued-site-capacity")) return "queued-site-capacity";
  return "running";
}

function planRetryKey(session, planID) {
  return `${toInt(session && (session.characterID || session.charid), 0)}:${String(planID || "")}`;
}

function clearPlanRetry(session, planID) {
  const key = planRetryKey(session, planID);
  const timer = planRetryTimers.get(key);
  if (timer) clearTimeout(timer);
  planRetryTimers.delete(key);
}

function schedulePlanRetry(session, plan) {
  clearPlanRetry(session, plan && plan.planID);
  if (!plan || ![
    "queued-site-capacity",
    "awaiting-activation",
    "running",
  ].includes(plan.status)) return;
  const key = planRetryKey(session, plan.planID);
  const timer = setTimeout(() => {
    planRetryTimers.delete(key);
    try {
      advancePlayerConstructionPlan(session, plan.planID);
    } catch (_) {
      // A durable plan remains resumable through the RPC after a transient
      // session/runtime error; the timer must never terminate the process.
    }
  }, 1_000);
  if (timer && typeof timer.unref === "function") timer.unref();
  planRetryTimers.set(key, timer);
}

function advancePlayerConstructionPlan(session, planID) {
  const principal = playerPrincipal(session);
  const plan = templateStore.getConstructionPlan(principal, planID);
  if (!plan) return { success: false as const, errorMsg: "CONSTRUCTION_PLAN_NOT_FOUND" };
  if (["completed", "cancelled", "paused"].includes(plan.status)) {
    return { success: true as const, data: plan };
  }
  const solarSystemID = toInt(session && (session.solarsystemid2 || session.solarsystemid), 0);
  if (solarSystemID !== toInt(plan.solarSystemID, 0)) {
    return { success: false as const, errorMsg: "CONSTRUCTION_PLAN_WRONG_SYSTEM" };
  }
  const byID = new Map(plan.compiledNodes.map((node) => [node.nodeID, node]));
  // Admit at most one new construction site per scheduler pass. Direct nodes
  // may still proceed. This makes resumePlayerConstructionPlans a fair
  // round-robin across an owner's active plans instead of allowing the oldest
  // large template to consume every newly available slot.
  let admittedConstructionSites = 0;
  for (const nodeID of plan.executionOrder) {
    const node: any = byID.get(nodeID);
    const state = plan.nodeStates[nodeID];
    if (!node || !state || TERMINAL_NODE_STATES.has(state.status)) continue;
    if ((node.dependsOn || []).some((dependency) =>
      plan.nodeStates[dependency] && plan.nodeStates[dependency].status !== "completed")) {
      state.status = "waiting-dependencies";
      continue;
    }

    if (state.itemID > 0) {
      const refreshed = refreshPlacedNode(session, node, state);
      if (!refreshed.readyForLoadout) continue;
      const loadout = applyNodeLoadout(session, node, state);
      if (loadout.success) {
        state.status = "completed";
        state.errorMsg = null;
      } else if (loadout.authorizationRequired) {
        state.status = "awaiting-authorization";
        state.errorMsg = loadout.errorMsg;
      } else if (loadout.retryable) {
        state.status = loadout.errorMsg === "ASSEMBLY_ACTIVATING"
          ? "awaiting-activation"
          : "awaiting-resources";
        state.errorMsg = loadout.errorMsg;
      } else {
        state.status = "blocked";
        state.errorMsg = loadout.errorMsg;
      }
      continue;
    }

    const preview = deployment.previewDeployablePlacement(
      session,
      node.assemblyTypeID,
      node.position,
      node.rotation,
    );
    if (!preview.success) {
      state.status = preview.errorMsg === "DEPLOYMENT_TOO_FAR"
        ? "waiting-dependencies"
        : "blocked";
      state.errorMsg = preview.errorMsg;
      continue;
    }
    const resolvedMode = preview.data.directPlacement ? "directAssembly" : "constructionSite";
    const requestedPlacementMode = deployment.isConstructionDepotExemptAssemblyType(
      node.assemblyTypeID,
    ) && node.placementMode !== "auto"
      ? "directAssembly"
      : node.placementMode;
    if (requestedPlacementMode !== "auto" && requestedPlacementMode !== resolvedMode) {
      state.status = "blocked";
      state.errorMsg = "CONSTRUCTION_TEMPLATE_PLACEMENT_MODE_MISMATCH";
      continue;
    }
    if (!preview.data.directPlacement && preview.data.constructionSiteCapacity.available <= 0) {
      state.status = "queued-site-capacity";
      state.errorMsg = null;
      continue;
    }
    if (!preview.data.directPlacement && admittedConstructionSites >= 1) {
      state.status = "queued-site-capacity";
      state.errorMsg = null;
      continue;
    }
    const placed = deployment.buildDeployable(
      session,
      node.assemblyTypeID,
      node.position,
      node.rotation,
    );
    if (!placed.success) {
      state.status = placed.errorMsg === "TOO_MANY_CONSTRUCTION_SITES"
        ? "queued-site-capacity"
        : "blocked";
      state.errorMsg = placed.errorMsg;
      continue;
    }
    state.itemID = toInt(placed.data.item && placed.data.item.itemID, 0);
    state.resolvedPlacementMode = placed.data.directPlacement === true
      ? "directAssembly"
      : "constructionSite";
    if (placed.data.directPlacement !== true) admittedConstructionSites += 1;
    state.attempts += 1;
    state.errorMsg = null;
    state.status = placed.data.directPlacement === true ? "awaiting-activation" : "awaiting-resources";
    const refreshed = refreshPlacedNode(session, node, state);
    if (refreshed.readyForLoadout) {
      const loadout = applyNodeLoadout(session, node, state);
      if (loadout.success) state.status = "completed";
      else if (loadout.authorizationRequired) state.status = "awaiting-authorization";
      else state.status = loadout.errorMsg === "ASSEMBLY_ACTIVATING"
        ? "awaiting-activation"
        : loadout.retryable ? "awaiting-resources" : "blocked";
      state.errorMsg = loadout.success ? null : loadout.errorMsg;
    }
  }
  const status = derivePlanStatus(plan);
  const updated = templateStore.updateConstructionPlan(principal, plan.planID, {
    nodeStates: plan.nodeStates,
    status,
    completedAtMs: status === "completed" ? Date.now() : 0,
  });
  if (updated.success) schedulePlanRetry(session, updated.data);
  return updated.success ? updated : { success: false as const, errorMsg: updated.errorMsg };
}

function commitConstructionPlanAction(session, planID, nodeID, transactionUUID, signature) {
  const principal = playerPrincipal(session);
  const plan = templateStore.getConstructionPlan(principal, planID);
  const state = plan && plan.nodeStates && plan.nodeStates[String(nodeID || "")];
  const authorization = state && state.authorization;
  if (!plan || !state) return { success: false as const, errorMsg: "CONSTRUCTION_PLAN_NOT_FOUND" };
  if (!authorization || authorization.kind !== "assembly-state-transition" ||
      authorization.transactionUUID !== String(transactionUUID || "")) {
    return { success: false as const, errorMsg: "CONSTRUCTION_PLAN_AUTHORIZATION_INVALID" };
  }
  const committed = deployment.commitAssemblyStateTransition(
    session,
    state.itemID,
    transactionUUID,
    signature,
    authorization.targetStatus,
  );
  if (!committed.success) return committed;
  state.authorization = null;
  state.loadout.statusApplied = true;
  state.status = "completed";
  state.errorMsg = null;
  const persisted = templateStore.updateConstructionPlan(principal, plan.planID, {
    nodeStates: plan.nodeStates,
    status: derivePlanStatus(plan),
  });
  return persisted.success ? advancePlayerConstructionPlan(session, plan.planID) : persisted;
}

function cancelConstructionPlan(session, planID) {
  const principal = playerPrincipal(session);
  const plan = templateStore.getConstructionPlan(principal, planID);
  if (!plan) return { success: false as const, errorMsg: "CONSTRUCTION_PLAN_NOT_FOUND" };
  if (plan.status === "completed") {
    return { success: false as const, errorMsg: "CONSTRUCTION_PLAN_ALREADY_COMPLETE" };
  }
  for (const state of Object.values<any>(plan.nodeStates || {})) {
    if (!TERMINAL_NODE_STATES.has(state.status) && !state.itemID) state.status = "cancelled";
  }
  const updated = templateStore.updateConstructionPlan(principal, plan.planID, {
    nodeStates: plan.nodeStates,
    status: "cancelled",
    cancelledAtMs: Date.now(),
  });
  if (updated.success) clearPlanRetry(session, plan.planID);
  return updated;
}

function pauseConstructionPlan(session, planID) {
  const principal = playerPrincipal(session);
  const plan = templateStore.getConstructionPlan(principal, planID);
  if (!plan) return { success: false as const, errorMsg: "CONSTRUCTION_PLAN_NOT_FOUND" };
  if (["completed", "cancelled"].includes(plan.status)) {
    return { success: false as const, errorMsg: "CONSTRUCTION_PLAN_ALREADY_COMPLETE" };
  }
  clearPlanRetry(session, plan.planID);
  return templateStore.updateConstructionPlan(principal, plan.planID, {
    status: "paused",
    pausedAtMs: Date.now(),
  });
}

function resumePlayerConstructionPlan(session, planID) {
  const principal = playerPrincipal(session);
  const plan = templateStore.getConstructionPlan(principal, planID);
  if (!plan) return { success: false as const, errorMsg: "CONSTRUCTION_PLAN_NOT_FOUND" };
  if (["completed", "cancelled"].includes(plan.status)) {
    return { success: true as const, data: plan };
  }
  if (plan.status === "paused") {
    const updated = templateStore.updateConstructionPlan(principal, plan.planID, {
      status: "queued",
      pausedAtMs: 0,
    });
    if (!updated.success) return updated;
  }
  return advancePlayerConstructionPlan(session, plan.planID);
}

function resumePlayerConstructionPlans(session) {
  const principal = playerPrincipal(session);
  const solarSystemID = toInt(session && (session.solarsystemid2 || session.solarsystemid), 0);
  const results: any[] = [];
  for (const plan of templateStore.listConstructionPlans(principal)) {
    if (["completed", "cancelled", "paused"].includes(plan.status) ||
        toInt(plan.solarSystemID, 0) !== solarSystemID) continue;
    results.push(advancePlayerConstructionPlan(session, plan.planID));
  }
  return results;
}

function listConstructionPlans(principal) {
  return templateStore.listConstructionPlans(principal);
}

function getConstructionPlan(principal, planID) {
  return templateStore.getConstructionPlan(principal, planID);
}

module.exports = {
  CONSTRUCTION_TEMPLATE_NODE_LIMIT,
  CONSTRUCTION_TEMPLATE_PREVIEW_TTL_MS,
  cancelConstructionPlan,
  compileConstructionTemplateGeometry,
  commitConstructionPlanAction,
  createConstructionPlanFromPreview,
  deleteConstructionTemplate,
  getConstructionPlan,
  getConstructionTemplate,
  listConstructionPlans,
  listConstructionTemplates,
  normalizeConstructionTemplate,
  playerPrincipal,
  previewConstructionTemplate,
  pauseConstructionPlan,
  resumePlayerConstructionPlan,
  resumePlayerConstructionPlans,
  saveConstructionTemplate,
  advancePlayerConstructionPlan,
  _testing: {
    compileNodePlacement,
    derivePlanStatus,
    previewTokens,
    planRetryTimers,
    prunePreviewTokens,
    rotateVector,
    validateCompiledNodeSeparation,
  },
};
