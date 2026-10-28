"use strict";

const path = require("path");

const indexes = new Map();
const queryCache = new Map();
const MAX_QUERY_CACHE = 512;

function normalize(value) {
  return String(value == null ? "" : value).trim().toLowerCase();
}

function collapse(value) {
  return normalize(value).replace(/[^a-z0-9]+/g, "");
}

function tokens(value) {
  return normalize(value)
    .split(/\s+/)
    .map((token) => token.replace(/[^a-z0-9]+/g, ""))
    .filter(Boolean);
}

function append(map, key, id) {
  if (!key) return;
  const current = map.get(key);
  if (current) current.push(id);
  else map.set(key, [id]);
}

function buildIndex(groupID, rows, retain = true) {
  const exactRaw = new Map();
  const exactCollapsed = new Map();
  const entries: any[] = [];
  const seen = new Set();
  for (const row of rows || []) {
    const id = Number(row && row.id) || 0;
    if (id <= 0) continue;
    for (const label of Array.isArray(row.names) ? row.names : [row.name]) {
      const rawName = normalize(label);
      const collapsedName = collapse(label);
      const key = `${id}\u0000${rawName}`;
      if (!collapsedName || seen.has(key)) continue;
      seen.add(key);
      entries.push({ id, rawName, collapsedName });
      append(exactRaw, rawName, id);
      append(exactCollapsed, collapsedName, id);
    }
  }
  const index = { entries, exactRaw, exactCollapsed };
  if (retain) indexes.set(Number(groupID) || 0, index);
  return index;
}

function searchIndex(index, search, exactMode, maxResults = 500) {
  const rawSearch = normalize(search);
  const collapsedSearch = collapse(search);
  if (!collapsedSearch) return [];
  let candidates: any[] = [];
  if ([1, 2, 3].includes(Number(exactMode) || 0)) {
    candidates = [
      ...(index.exactRaw.get(rawSearch) || []),
      ...(index.exactCollapsed.get(collapsedSearch) || []),
    ];
  } else {
    const searchTokens = tokens(search);
    const exact: any[] = [];
    const prefix: any[] = [];
    const substring: any[] = [];
    for (const entry of index.entries) {
      const matches = searchTokens.length > 0
        ? searchTokens.every((token) => entry.collapsedName.includes(token))
        : entry.collapsedName.includes(collapsedSearch);
      if (!matches) continue;
      if (entry.rawName === rawSearch || entry.collapsedName === collapsedSearch) exact.push(entry.id);
      else if (entry.rawName.startsWith(rawSearch) || entry.collapsedName.startsWith(collapsedSearch)) prefix.push(entry.id);
      else substring.push(entry.id);
    }
    candidates = [...exact, ...prefix, ...substring];
  }
  const seen = new Set();
  return candidates.filter((id) => id > 0 && !seen.has(id) && seen.add(id)).slice(0, maxResults);
}

function getStaticRows(groupID) {
  const searchService = require(path.join(__dirname, "./searchService"));
  const helpers = searchService._testing;
  const rows = helpers.getStaticGroupSourceRows(groupID);
  if (!rows) return null;
  return rows.map((row) => ({
    id: helpers.getStaticGroupEntryID(groupID, row),
    names: helpers.getStaticGroupEntryNames(groupID, row),
  }));
}

function searchStaticGroup(groupID, search, exactMode, maxResults = 500) {
  const normalizedGroupID = Number(groupID) || 0;
  const cacheKey = `${normalizedGroupID}|${Number(exactMode) || 0}|${normalize(search)}`;
  if (queryCache.has(cacheKey)) return [...queryCache.get(cacheKey)];
  let index = indexes.get(normalizedGroupID);
  if (!index) {
    const rows = getStaticRows(normalizedGroupID);
    if (!rows) return null;
    index = buildIndex(normalizedGroupID, rows);
  }
  const result = searchIndex(index, search, exactMode, maxResults);
  queryCache.set(cacheKey, result);
  if (queryCache.size > MAX_QUERY_CACHE) queryCache.delete(queryCache.keys().next().value);
  return [...result];
}

function searchEntries(entries, search, exactMode, maxResults = 500) {
  return searchIndex(buildIndex(0, entries, false), search, exactMode, maxResults);
}

function clearIndexes() {
  indexes.clear();
  queryCache.clear();
  return true;
}

function getStats() {
  return { indexCount: indexes.size, queryCount: queryCache.size };
}

module.exports = { searchStaticGroup, searchEntries, clearIndexes, getStats };
