"use strict";

const path = require("path");
const {
  CRUDE_MATTER_QUANTITY_BY_POTENTIAL,
  RIFT_FORMATION_YIELD,
} = require(path.join(__dirname, "./frontierRiftAuthority"));

const TABLE_NAME = "frontierRiftSites";
const STATE_VERSION = 3;
const RIFT_SITE_ID_BASE = 9_200_000_000;
const RIFT_SITE_ID_LIMIT = 9_300_000_000;
const RIFT_RESPAWN_DELAY_MS = 24 * 60 * 60 * 1000;

function toPositiveInt(value, fallback = 0) {
  const numeric = Math.trunc(Number(value) || 0);
  return numeric > 0 ? numeric : fallback;
}

function toFiniteNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function normalizePosition(value) {
  if (!value || typeof value !== "object") {
    return null;
  }
  const position = {
    x: Number(value.x),
    y: Number(value.y),
    z: Number(value.z),
  };
  return Object.values(position).every(Number.isFinite) ? position : null;
}

function normalizeResourceProfile(entry) {
  const rawTags = Array.isArray(entry && entry.tags)
    ? entry.tags.map((tag) => String(tag || "").toLowerCase()).filter(Boolean)
    : [];
  const directFormation = String(entry && entry.formation || "").toLowerCase();
  const formation = Object.prototype.hasOwnProperty.call(RIFT_FORMATION_YIELD, directFormation)
    ? directFormation
    : rawTags.find((tag) => Object.prototype.hasOwnProperty.call(RIFT_FORMATION_YIELD, tag)) || null;
  const directPotential = String(entry && entry.potential || "").toLowerCase();
  const potential = formation
    ? RIFT_FORMATION_YIELD[formation].potential
    : Object.prototype.hasOwnProperty.call(CRUDE_MATTER_QUANTITY_BY_POTENTIAL, directPotential)
      ? directPotential
      : null;
  const resourceQuantity = potential
    ? CRUDE_MATTER_QUANTITY_BY_POTENTIAL[potential]
    : toPositiveInt(entry && entry.resourceQuantity, 0) || null;
  return {
    typeID: toPositiveInt(entry && entry.typeID, 0),
    typeName: String(entry && entry.typeName || "") || null,
    localName: String(entry && entry.localName || "") || null,
    age: ["young", "old"].includes(String(entry && entry.age || "").toLowerCase())
      ? String(entry.age).toLowerCase()
      : null,
    quality: ["fine", "rough"].includes(String(entry && entry.quality || "").toLowerCase())
      ? String(entry.quality).toLowerCase()
      : null,
    formation,
    potential,
    resourceQuantity,
    tags: [...new Set<any>(rawTags.filter(
      (tag) => !Object.prototype.hasOwnProperty.call(RIFT_FORMATION_YIELD, tag),
    ))],
  };
}

function normalizeSite(site) {
  const itemID = toPositiveInt(site && (site.itemID ?? site.siteID), 0);
  const solarSystemID = toPositiveInt(site && site.solarSystemID, 0);
  const dungeonID = toPositiveInt(site && site.dungeonID, 0);
  const typeID = toPositiveInt(site && site.typeID, 0);
  const position = normalizePosition(site && site.position);
  if (
    itemID < RIFT_SITE_ID_BASE ||
    itemID >= RIFT_SITE_ID_LIMIT ||
    solarSystemID <= 0 ||
    dungeonID <= 0 ||
    typeID <= 0 ||
    !position
  ) {
    return null;
  }
  const lifecycleState = String(site.lifecycleState || "active").toLowerCase() === "depleted"
    ? "depleted"
    : "active";
  const depletedAtMs = lifecycleState === "depleted"
    ? Math.max(0, Math.trunc(toFiniteNumber(site.depletedAtMs, 0)))
    : 0;
  const respawnAtMs = lifecycleState === "depleted" && depletedAtMs > 0
    ? Math.max(
      depletedAtMs + RIFT_RESPAWN_DELAY_MS,
      Math.trunc(toFiniteNumber(site.respawnAtMs, 0)),
    )
    : 0;
  return {
    ...site,
    itemID,
    siteID: itemID,
    solarSystemID,
    dungeonID,
    typeID,
    groupID: toPositiveInt(site.groupID, 0),
    categoryID: toPositiveInt(site.categoryID, 0),
    graphicID: toPositiveInt(site.graphicID, 0) || null,
    radius: Math.max(1, toFiniteNumber(site.radius, 1)),
    signatureRadius: Math.max(1, toFiniteNumber(site.signatureRadius, site.radius || 1)),
    position,
    itemName: String(site.itemName || `Rift ${dungeonID}`),
    dungeonNameID: toPositiveInt(site.dungeonNameID, 0) || null,
    archetypeID: toPositiveInt(site.archetypeID, 0) || null,
    dungeonEntryObjectID: toPositiveInt(site.dungeonEntryObjectID, 0) || null,
    resourceTypeIDs: Array.isArray(site.resourceTypeIDs)
      ? [...new Set<any>(site.resourceTypeIDs.map((entry) => toPositiveInt(entry, 0)).filter(Boolean))]
      : [],
    resourceProfiles: Array.isArray(site.resourceProfiles)
      ? site.resourceProfiles
        .filter((entry) => entry && typeof entry === "object")
        .map(normalizeResourceProfile)
      : [],
    riftTags: Array.isArray(site.riftTags)
      ? [...new Set<any>(site.riftTags
        .map((tag) => String(tag || "").toLowerCase())
        .filter((tag) => (
          Boolean(tag) &&
          !Object.prototype.hasOwnProperty.call(RIFT_FORMATION_YIELD, tag)
        )))]
      : [],
    points: Math.max(1, toPositiveInt(site.points, 1)),
    createdAt: String(site.createdAt || ""),
    createdByCharacterID: toPositiveInt(site.createdByCharacterID, 0) || null,
    customFrontierRiftSite: true,
    kind: "riftDungeon",
    staticVisibilityScope: "system",
    lifecycleState,
    depletedAtMs,
    respawnAtMs,
  };
}

function cloneSite(site) {
  const normalized = normalizeSite(site);
  return normalized ? {
    ...normalized,
    position: { ...normalized.position },
    resourceTypeIDs: [...normalized.resourceTypeIDs],
    resourceProfiles: normalized.resourceProfiles.map((profile) => ({
      ...profile,
      tags: [...profile.tags],
    })),
    riftTags: [...normalized.riftTags],
  } : null;
}

function normalizeState(value) {
  const source = value && typeof value === "object" ? value : {};
  const sites: Record<string, any> = {};
  for (const rawSite of Object.values<any>(
    source.sites && typeof source.sites === "object" ? source.sites : {},
  )) {
    const site = normalizeSite(rawSite);
    if (site) {
      sites[String(site.itemID)] = site;
    }
  }
  const highestSiteID = Object.values(sites).reduce(
    (highest, site) => Math.max(highest, site.itemID),
    RIFT_SITE_ID_BASE - 1,
  );
  return {
    version: STATE_VERSION,
    nextSiteID: Math.max(
      RIFT_SITE_ID_BASE,
      highestSiteID + 1,
      toPositiveInt(source.nextSiteID, RIFT_SITE_ID_BASE),
    ),
    sites,
  };
}

function createFrontierRiftSiteStore(options: Record<string, any> = {}) {
  const store = options.database || require(path.join(__dirname, "../gameStore"));
  const authority = options.authority || require(path.join(__dirname, "./frontierRiftAuthority"));
  const now = options.now || (() => new Date().toISOString());

  function readState() {
    store.ensureTable(TABLE_NAME);
    const result = store.read(TABLE_NAME, "/");
    return normalizeState(result && result.success ? result.data : null);
  }

  function writeState(state) {
    const result = store.write(TABLE_NAME, "/", normalizeState(state), { force: true });
    if (!result || result.success !== true) {
      return result || { success: false, errorMsg: "WRITE_ERROR" };
    }
    if (typeof store.flushTableSync === "function") {
      const flushResult = store.flushTableSync(TABLE_NAME);
      if (!flushResult || flushResult.success !== true) {
        return flushResult || { success: false, errorMsg: "FLUSH_ERROR" };
      }
    }
    return { success: true, errorMsg: null };
  }

  function listSites(solarSystemID = null, listOptions: Record<string, any> = {}) {
    const numericSystemID = toPositiveInt(solarSystemID, 0);
    return Object.values(readState().sites)
      .filter((site) => numericSystemID <= 0 || site.solarSystemID === numericSystemID)
      .filter((site) => listOptions.activeOnly !== true || site.lifecycleState === "active")
      .filter((site) => listOptions.depletedOnly !== true || site.lifecycleState === "depleted")
      .sort((left, right) => left.itemID - right.itemID)
      .map(cloneSite);
  }

  function getSite(siteID) {
    const site = readState().sites[String(toPositiveInt(siteID, 0))] || null;
    return site ? cloneSite(site) : null;
  }

  function createSite(input: Record<string, any> = {}) {
    const template = authority.resolveTemplate(input.template ?? input.dungeonID ?? input.typeID);
    const solarSystemID = toPositiveInt(input.solarSystemID, 0);
    const position = normalizePosition(input.position);
    if (!template) {
      return { success: false, errorMsg: "RIFT_TEMPLATE_NOT_FOUND" };
    }
    if (solarSystemID <= 0 || !position) {
      return { success: false, errorMsg: "INVALID_RIFT_POSITION" };
    }

    const state = readState();
    let siteID = Math.max(RIFT_SITE_ID_BASE, state.nextSiteID);
    while (siteID < RIFT_SITE_ID_LIMIT && state.sites[String(siteID)]) {
      siteID += 1;
    }
    if (siteID >= RIFT_SITE_ID_LIMIT) {
      return { success: false, errorMsg: "RIFT_SITE_ID_EXHAUSTED" };
    }

    const site = normalizeSite({
      itemID: siteID,
      solarSystemID,
      dungeonID: template.dungeonID,
      typeID: template.entryTypeID,
      groupID: template.entryType.groupID,
      categoryID: template.entryType.categoryID,
      graphicID: template.entryType.graphicID,
      radius: template.entryType.radius,
      signatureRadius: template.entryType.radius,
      position,
      itemName: String(input.itemName || template.itemName),
      dungeonNameID: template.dungeonNameID,
      archetypeID: template.archetypeID,
      dungeonEntryObjectID: template.entryObjectID,
      resourceTypeIDs: template.resources.map((resource) => resource.typeID),
      resourceProfiles: Array.isArray(template.resourceProfiles)
        ? template.resourceProfiles
        : [],
      riftTags: Array.isArray(template.riftTags) ? template.riftTags : [],
      points: Math.max(1, template.resources.length),
      createdAt: now(),
      createdByCharacterID: toPositiveInt(input.createdByCharacterID, 0) || null,
      lifecycleState: "active",
      depletedAtMs: 0,
      respawnAtMs: 0,
    });
    const nextState = {
      ...state,
      nextSiteID: siteID + 1,
      sites: { ...state.sites, [String(siteID)]: site },
    };
    const writeResult = writeState(nextState);
    return writeResult.success
      ? { success: true, errorMsg: null, data: cloneSite(site) }
      : writeResult;
  }

  function removeSite(siteID) {
    const numericSiteID = toPositiveInt(siteID, 0);
    const state = readState();
    const site = state.sites[String(numericSiteID)] || null;
    if (!site) {
      return { success: false, errorMsg: "RIFT_SITE_NOT_FOUND" };
    }
    const sites = { ...state.sites };
    delete sites[String(numericSiteID)];
    const result = writeState({ ...state, sites });
    return result.success
      ? { success: true, errorMsg: null, data: cloneSite(site) }
      : result;
  }

  function markDepleted(siteID, markOptions: Record<string, any> = {}) {
    const numericSiteID = toPositiveInt(siteID, 0);
    const state = readState();
    const site = state.sites[String(numericSiteID)] || null;
    if (!site) {
      return { success: false, errorMsg: "RIFT_SITE_NOT_FOUND" };
    }
    const depletedAtMs = Math.max(0, Math.trunc(toFiniteNumber(markOptions.nowMs, Date.now())));
    const nextSite = normalizeSite({
      ...site,
      lifecycleState: "depleted",
      depletedAtMs,
      respawnAtMs: depletedAtMs + RIFT_RESPAWN_DELAY_MS,
    });
    const result = writeState({
      ...state,
      sites: { ...state.sites, [String(numericSiteID)]: nextSite },
    });
    return result.success
      ? { success: true, errorMsg: null, data: cloneSite(nextSite) }
      : result;
  }

  function reactivateDueSites(solarSystemID = null, nowMs = Date.now()) {
    const numericSystemID = toPositiveInt(solarSystemID, 0);
    const normalizedNowMs = Math.max(0, Math.trunc(toFiniteNumber(nowMs, Date.now())));
    const state = readState();
    const sites = { ...state.sites };
    const reactivated: any[] = [];
    for (const [siteKey, site] of Object.entries<any>(sites)) {
      if (
        site.lifecycleState !== "depleted" ||
        (numericSystemID > 0 && site.solarSystemID !== numericSystemID) ||
        toFiniteNumber(site.respawnAtMs, 0) <= 0 ||
        normalizedNowMs < toFiniteNumber(site.respawnAtMs, 0)
      ) {
        continue;
      }
      const nextSite = normalizeSite({
        ...site,
        lifecycleState: "active",
        depletedAtMs: 0,
        respawnAtMs: 0,
      });
      sites[siteKey] = nextSite;
      reactivated.push(cloneSite(nextSite));
    }
    if (reactivated.length > 0) {
      const result = writeState({ ...state, sites });
      if (!result.success) {
        return result;
      }
    }
    return {
      success: true,
      errorMsg: null,
      data: { sites: reactivated },
    };
  }

  return {
    createSite,
    getSite,
    listSites,
    markDepleted,
    reactivateDueSites,
    removeSite,
  };
}

let defaultStore = null;

function getDefaultStore() {
  if (!defaultStore) {
    defaultStore = createFrontierRiftSiteStore();
  }
  return defaultStore;
}

module.exports = {
  RIFT_SITE_ID_BASE,
  RIFT_SITE_ID_LIMIT,
  RIFT_RESPAWN_DELAY_MS,
  STATE_VERSION,
  TABLE_NAME,
  createFrontierRiftSiteStore,
  createSite: (...args) => getDefaultStore().createSite(...args),
  getSite: (...args) => getDefaultStore().getSite(...args),
  listSites: (...args) => getDefaultStore().listSites(...args),
  markDepleted: (...args) => getDefaultStore().markDepleted(...args),
  reactivateDueSites: (...args) => getDefaultStore().reactivateDueSites(...args),
  normalizePosition,
  removeSite: (...args) => getDefaultStore().removeSite(...args),
};
