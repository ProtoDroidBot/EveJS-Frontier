"use strict";

const crypto = require("node:crypto");
const targetCatalog = require("../../space/compositeMiningCatalog3640684.json");

// Transcribed from exact build 3640684 landscape/common/{locator_config,
// resource_config,mass_sampling}. The client does not ship the server's global
// mass-budget/substrate distribution files. Stock and random sampling below
// are therefore explicit temporary server policy, not official allocations.
const RESOURCE_POLICY = Object.freeze({
  name: "temporary-3640684-resource-allocation-v1",
  totalOreUnitsPerSite: 24000,
  samplingReferenceMass: 50000,
  minimumRadiusMeters: 25,
  maximumRadiusMeters: 150,
  selection: "sha256-ranked-locators-and-uniform-eligible-materials",
  stockDistribution: "native-composite-lognormal-weights-with-exact-integer-budget",
});
const RESOURCE_POLICY_REVISION = crypto.createHash("sha256")
  .update(JSON.stringify(RESOURCE_POLICY)).digest("hex");
const INNER = Object.freeze([91374, 91375, 91376]);
const OUTER = Object.freeze([91377, 91378, 91379, 91380, 91381]);
const TROJAN = Object.freeze([91374, 91375, 91376, 91379, 91380, 91381]);
const ALL = Object.freeze([91374, 91375, 91376, 91377, 91378, 91379, 91380, 91381]);
const TARGET_TYPES = new Map<number, any>(targetCatalog.types.map(type => [type.typeID, type]));

function normalizedTags(tags) {
  return new Set((Array.isArray(tags) ? tags : tags instanceof Set ? [...tags] : [])
    .filter(tag => typeof tag === "string").map(tag => tag.toLowerCase()));
}
function getTemporaryLandscapeTags(site = {}, ecosystem = {}) {
  const source: any = site, eco: any = ecosystem;
  return [...normalizedTags([...(source.featureTags || []), ...(source.tags || []),
    ...(eco.requireAllTags || []), ...(eco.tags || [])])].sort();
}

function getTemporaryLocatorLimits(tags, resourceLocatorCount = 0) {
  const values = normalizedTags(tags);
  // Native resolve_by_tags uses first matching rule: rocky, icy, then trojan.
  const trojan = !values.has("rocky") && !values.has("icy") && values.has("trojan");
  const total = Math.max(0, Math.trunc(Number(resourceLocatorCount) || 0));
  const plateau = trojan ? 3 : 4, high = trojan ? 6 : 8;
  const resource = total < plateau ? total : total <= 10 ? Math.min(plateau, total)
    : Math.min(total, Math.max(plateau, Math.min(high, Math.floor(plateau + (total - 10) * ((high - plateau) / 290)))));
  return { resource, event: trojan ? 1 : 2, threat: trojan ? 1 : 2, npc: 1 };
}

function getTemporaryResourceCarrierTypes(tags) {
  const values = normalizedTags(tags);
  if (values.has("icy") && values.has("belt")) return [...OUTER];
  if (values.has("rocky") && values.has("belt")) return [...INNER];
  if (values.has("trojan")) return [...TROJAN];
  if (values.has("carbonaceous") || values.has("protoplanetary")) return [...ALL];
  // Native resource_config falls back to INNER_BELT_TYPES for unrecognized tags.
  return [...INNER];
}

function nativeCompositeMassParameters(tags, spawnMass, system: Record<string, any> = {}) {
  const values = normalizedTags(tags);
  let flavor = 0;
  for (const [tag, shift] of [["rocky", -0.2], ["icy", 0.2], ["carbonaceous", 0], ["protoplanetary", 0], ["trojan", 0.3]] as Array<[string, number]>) {
    if (values.has(tag)) { flavor += shift; break; }
  }
  flavor += ({ warm_giant: -0.3, hot_jupiter: -0.4, cold_giant: 0.1, ice_giant: 0.1, no_giant: 0 } as any)[system.migrationCategory] || 0;
  flavor += ({ low: -0.1, medium: 0, high: 0.2 } as any)[system.al26DoseBucket] || 0;
  const exposure = system.cosmicRayExposure == null ? null : Number(system.cosmicRayExposure);
  const sigma = exposure === null ? 0.63 : Math.min(0.85, 0.63 * (1 + 0.5 * exposure));
  const mass = Number(spawnMass);
  if (!Number.isFinite(mass) || mass < 0 || !Number.isFinite(sigma) || sigma < 0) throw new TypeError("Invalid native mass sampling input");
  return { muLog: Math.log(29947 * Math.pow(Math.max(mass, 1) / 50000, 0.15)) + flavor, sigmaLog: sigma };
}

function digest(seed) { return crypto.createHash("sha256").update(String(seed)).digest("hex"); }
function uniform(seed) { return (parseInt(digest(seed).slice(0, 13), 16) + 0.5) / 0x10000000000000; }
function locatorKey(locator) {
  return [locator.patternKind || "entry", locator.dungeonID || 0, locator.occurrenceIndex || 0,
    locator.roomID || 0, locator.objectID || locator.sourceObjectID || 0].join(":");
}
function position(value) {
  if (!value || ![value.x, value.y, value.z].every(Number.isFinite)) throw new TypeError("Resource locator requires finite transformed positionOffset");
  return { x: value.x, y: value.y, z: value.z };
}
function yieldTypeIDForCarrier(type) {
  const value = (type?.dogma?.dogmaAttributes || []).find(attribute => attribute.attributeID === 6070)?.value;
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

function buildTemporaryLandscapeResourceAllocation(options: Record<string, any> = {}) {
  const { site = {}, ecosystem = {}, locators = [], resolveType = () => null, system = {} } = options;
  const policy = { ...RESOURCE_POLICY, ...(options.policy || {}) };
  if (!Number.isSafeInteger(policy.totalOreUnitsPerSite) || policy.totalOreUnitsPerSite < 0 || policy.totalOreUnitsPerSite > 1000000 ||
      !Number.isFinite(policy.samplingReferenceMass) || policy.samplingReferenceMass <= 0 ||
      !Number.isFinite(policy.minimumRadiusMeters) || policy.minimumRadiusMeters <= 0 ||
      !Number.isFinite(policy.maximumRadiusMeters) || policy.maximumRadiusMeters < policy.minimumRadiusMeters || policy.maximumRadiusMeters > 500) {
    throw new TypeError("Invalid bounded temporary resource policy");
  }
  const revision = digest(JSON.stringify(policy));
  const tags = getTemporaryLandscapeTags(site, ecosystem);
  const diagnostics = { stockSource: "temporary-server-ore-unit-budget", materialWeightsSource: "temporary-uniform-eligible-types",
    samplingSource: "3640684-composite-mass-formula-with-sha256-box-muller", policyRevision: revision,
    tags, skipped: [] as any[], totalOreUnits: 0, resourceLocatorCount: 0 };
  const result = { revision, resources: [] as any[], diagnostics };
  if (!(site.temporaryLandscapeProfile || site.temporaryLandscapeRevision || ecosystem.temporaryLandscapeProfile) ||
      ecosystem.spawnEnabled === false || ecosystem.spawnEnabled === 0) return result;
  const profileRevision = String(options.profileRevision || site.temporaryLandscapeRevision || "");
  if (!/^[a-f0-9]{64}$/.test(profileRevision)) throw new TypeError("Temporary resource allocation requires profile revision");
  const siteID = Number(site.itemID || site.id);
  if (!Number.isSafeInteger(siteID) || siteID <= 0) throw new TypeError("Temporary resource allocation requires site identity");
  const seed = `${profileRevision}:${revision}:${siteID}`;
  const seen = new Set();
  const candidates = locators.filter(locator => Number(locator.typeID) === 91211).map(locator => {
    const key = locatorKey(locator);
    if (seen.has(key)) throw new TypeError(`Duplicate resource locator ${key}`);
    seen.add(key);
    return { locator, key, positionOffset: position(locator.positionOffset), rank: digest(`${seed}:locator:${key}`) };
  }).sort((a, b) => a.rank.localeCompare(b.rank) || a.key.localeCompare(b.key));
  diagnostics.resourceLocatorCount = candidates.length;
  const limit = Math.min(getTemporaryLocatorLimits(tags, candidates.length).resource, policy.totalOreUnitsPerSite);
  if (limit <= 0) return result;
  const types = getTemporaryResourceCarrierTypes(tags).map(typeID => {
    const type = resolveType(typeID), yieldTypeID = yieldTypeIDForCarrier(type);
    // The mining catalog is an independently fingerprinted 3640684 export,
    // covering target ore yields not referenced directly by dungeon objects.
    const ore = yieldTypeID && (resolveType(yieldTypeID) || TARGET_TYPES.get(yieldTypeID));
    if (!type || !ore || !yieldTypeID || !Number.isFinite(ore.volume) || ore.volume <= 0) {
      diagnostics.skipped.push({ typeID, reason: "unresolved-target-carrier-or-yield" });
      return null;
    }
    return { typeID, type, yieldTypeID, ore };
  }).filter(Boolean);
  // Do not silently bias an official eligible list by dropping absent types.
  if (diagnostics.skipped.length) return result;
  const parameters = nativeCompositeMassParameters(tags, policy.samplingReferenceMass, system);
  const selected = candidates.slice(0, limit).map(entry => {
    const material = types[Math.floor(uniform(`${seed}:material:${entry.key}`) * types.length)];
    const normal = Math.sqrt(-2 * Math.log(uniform(`${seed}:mass-u:${entry.key}`))) * Math.cos(2 * Math.PI * uniform(`${seed}:mass-v:${entry.key}`));
    const weight = Math.exp(parameters.muLog + parameters.sigmaLog * normal);
    return { ...entry, material, weight, quantity: 1 };
  });
  const totalWeight = selected.reduce((sum, entry) => sum + entry.weight, 0);
  if (!Number.isFinite(totalWeight) || totalWeight <= 0) throw new TypeError("Invalid temporary resource mass weights");
  let remaining = policy.totalOreUnitsPerSite - selected.length;
  for (const entry of selected) entry.quantity += Math.floor(remaining * entry.weight / totalWeight);
  let remainder = policy.totalOreUnitsPerSite - selected.reduce((sum, entry) => sum + entry.quantity, 0);
  // Deterministic remainder allocation preserves the exact per-site stock cap.
  for (let index = 0; remainder > 0; index++, remainder--) selected[index % selected.length].quantity++;
  result.resources = selected.map(entry => {
    const { locator, key, material, quantity } = entry;
    const radius = Math.max(policy.minimumRadiusMeters, Math.min(policy.maximumRadiusMeters,
      Math.cbrt(3 * quantity * material.ore.volume / (4 * Math.PI))));
    return { key: `landscape:temporary-resource:${siteID}:${key}`, exact: true, activation: "entry",
      typeID: material.typeID, miningYieldTypeID: material.yieldTypeID, resourceQuantity: quantity,
      radius, positionOffset: entry.positionOffset, dunRotation: [0, 0, 0], dunObjectID: locator.objectID,
      sourceObjectID: locator.objectID, sourceDungeonID: locator.dungeonID, sourceLocatorKey: key,
      sourceRoomID: locator.roomID, patternKind: locator.patternKind, occurrenceIndex: locator.occurrenceIndex,
      landscapeResource: true, temporaryLandscapeResource: true, frontierDungeonResource: true,
      miningYieldKind: "ore", skipMiningTemplateResolution: true, temporaryLandscapeProfile: true,
      temporaryLandscapeRevision: profileRevision, temporaryResourcePolicyRevision: revision };
  });
  diagnostics.totalOreUnits = result.resources.reduce((sum, entry) => sum + entry.resourceQuantity, 0);
  return result;
}

module.exports = { RESOURCE_POLICY, RESOURCE_POLICY_REVISION, getTemporaryLandscapeTags,
  getTemporaryLocatorLimits, getTemporaryResourceCarrierTypes, nativeCompositeMassParameters,
  buildTemporaryLandscapeResourceAllocation };
