"use strict";

const PROFILE_KEY = "temporaryLandscapeRevision";
const META_KEY = "temporaryLandscapeReconcileMetaByRevision";

function getContentProfileRevision() {
  const profile = require("../frontier/temporaryLandscapeProfile").getTemporaryLandscapeProfile();
  if (profile) return profile.revision;
  if (process.env.EVEJS_EXPLORATION_WORLD_PATH && Number(require("../../config").clientBuild) === 3640684) {
    const world = require("../frontier/explorationWorld").getConfiguredExplorationWorld();
    if (world.canonicalSource === true) return world.revision;
  }
  return "";
}

/** Frontier world content is profile-bound; independent missions remain shared. */
function isProfileBound(record) {
  if (record?.metadata?.[PROFILE_KEY]) return true;
  const source = String(record?.source || "").toLowerCase();
  const origin = String(record?.siteOrigin || "").toLowerCase();
  // Mission ownership does not make a Frontier-authored content template
  // independent of the dataset it was decoded from.
  if (source === "frontier" || /^frontier-dungeon:/.test(String(record?.templateID || ""))) return true;
  if (source === "mission" || origin.includes("mission") || record?.sourceMissionID ||
      record?.metadata?.missionContentID || record?.ownership?.missionOwnerCharacterID) return false;
  return ["frontier_dungeon", "universe_dungeon"].includes(origin) ||
    /^(?:frontier|client)-dungeon:/.test(String(record?.templateID || "")) ||
    (["frontier", "client"].includes(source) && Number(record?.sourceDungeonID) > 0);
}

function isVisible(record, revision) {
  return !isProfileBound(record) || String(record?.metadata?.[PROFILE_KEY] || "") === revision;
}

function stampInstance(record, revision = getContentProfileRevision()) {
  if (!isProfileBound(record)) return record;
  const metadata = { ...(record.metadata || {}) };
  if (revision) metadata[PROFILE_KEY] = revision;
  else delete metadata[PROFILE_KEY];
  return { ...record, metadata };
}

/**
 * A scoped view of the existing table. Instance IDs and their high-water mark
 * remain global. Hidden profile rows are never included in diff/removal input,
 * and raw-ID writes/removes cannot overwrite a different profile's receipts.
 */
function createProfileRepository(base, resolveRevision = getContentProfileRevision) {
  function root(table) { return base.read(table, "/"); }
  function rawInstance(table, id) { return root(table)?.data?.instancesByID?.[id]; }
  function conflict() { return { success: false, errorMsg: "DUNGEON_CONTENT_PROFILE_CONFLICT" }; }
  function pathFor(suffix, revision) {
    return revision && suffix === "/universeReconcileMeta" ? `/${META_KEY}/${revision}` : suffix;
  }
  return {
    read(table, suffix) {
      const revision = resolveRevision();
      if (suffix !== "/") {
        const match = /^\/instancesByID\/([^/]+)$/.exec(suffix);
        if (match && !isVisible(rawInstance(table, match[1]), revision)) return { success: false, errorMsg: "ENTRY_NOT_FOUND" };
        return base.read(table, pathFor(suffix, revision));
      }
      const result = root(table);
      if (!result?.success) return result;
      const data = result.data || {}, instances = data.instancesByID || {};
      const partitioned = Boolean(revision || data[META_KEY] || Object.values(instances).some((row: any) => row?.metadata?.[PROFILE_KEY]));
      if (!partitioned) return result; // Preserve unselected older-profile behavior.
      const highest = Object.keys(instances).reduce((maximum, key) => Number.isSafeInteger(Number(key)) ? Math.max(maximum, Number(key)) : maximum, 0);
      return { ...result, data: {
        version: data.version, nextInstanceSequence: Math.max(Number(data.nextInstanceSequence) || 1, highest + 1),
        instancesByID: Object.fromEntries(Object.entries(instances).filter(([, row]) => isVisible(row, revision))),
        universeReconcileMeta: revision ? data[META_KEY]?.[revision] || {} : data.universeReconcileMeta || {},
      } };
    },
    write(table, suffix, value) {
      const revision = resolveRevision();
      const match = /^\/instancesByID\/([^/]+)$/.exec(suffix);
      if (match) {
        const previous = rawInstance(table, match[1]);
        if (previous && !isVisible(previous, revision)) return conflict();
        return base.write(table, suffix, stampInstance(value, revision));
      }
      if (suffix === "/nextInstanceSequence") {
        const data = root(table)?.data || {};
        if (revision || data[META_KEY] || Object.values<any>(data.instancesByID || {}).some(row => row?.metadata?.[PROFILE_KEY])) {
          value = Math.max(Number(value) || 1, Number(data.nextInstanceSequence) || 1);
        }
      }
      if (suffix === "/instancesByID") {
        const prior = root(table)?.data?.instancesByID || {};
        const hidden = Object.fromEntries(Object.entries(prior).filter(([, row]) => !isVisible(row, revision)));
        if (Object.keys(value || {}).some(id => Object.hasOwn(hidden, id))) return conflict();
        value = { ...hidden, ...Object.fromEntries(Object.entries(value || {}).map(([id, row]) => [id, stampInstance(row, revision)])) };
      }
      return base.write(table, pathFor(suffix, revision), value);
    },
    remove(table, suffix) {
      const revision = resolveRevision();
      const match = /^\/instancesByID\/([^/]+)$/.exec(suffix);
      if (match) {
        const previous = rawInstance(table, match[1]);
        if (previous && !isVisible(previous, revision)) return conflict();
      }
      return base.remove(table, pathFor(suffix, revision));
    },
  };
}

function selectAuthorityPayload(payload, revision) {
  if (!revision) return payload;
  // Old client templates can retain old rooms during hydration. Remove those
  // inputs before the target dataset synthesizes authoritative templates.
  const templatesByID = Object.fromEntries(Object.entries(payload.templatesByID || {}).filter(([, row]) => !isProfileBound(row)));
  return { ...payload, templatesByID };
}

module.exports = { PROFILE_KEY, META_KEY, getContentProfileRevision, isProfileBound, isVisible,
  stampInstance, createProfileRepository, selectAuthorityPayload };
