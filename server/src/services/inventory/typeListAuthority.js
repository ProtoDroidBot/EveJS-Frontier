"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const path = require("path");
const log = require(path.join(__dirname, "../../utils/logger"));
const { TABLE, readStaticRows, readStaticTable, } = require(path.join(__dirname, "../_shared/referenceData"));
const TRADE_NON_TRADABLE_TYPE_LIST_ID = 36;
const TRADE_SOULBOUND_TYPE_LIST_ID = 142;
const TRADE_RESTRICTED_TYPE_LIST_IDS = Object.freeze([
    TRADE_NON_TRADABLE_TYPE_LIST_ID,
    TRADE_SOULBOUND_TYPE_LIST_ID,
]);
let cachedAuthority = null;
function normalizeNumericSet(values) {
    return new Set((Array.isArray(values) ? values : [])
        .map(Number)
        .filter((value) => Number.isSafeInteger(value) && value >= 0));
}
function buildNormalizedTypeList(entry) {
    const listID = Number(entry && (entry.listID ?? entry._key)) || 0;
    if (!Number.isSafeInteger(listID) || listID <= 0)
        return null;
    return {
        listID,
        name: typeof entry.name === "string" ? entry.name : "",
        includedTypeIDs: normalizeNumericSet(entry.includedTypeIDs),
        includedGroupIDs: normalizeNumericSet(entry.includedGroupIDs),
        includedCategoryIDs: normalizeNumericSet(entry.includedCategoryIDs),
        includedTypeListIDs: normalizeNumericSet(entry.includedTypeListIDs),
        includedTags: normalizeNumericSet(entry.includedTags),
        excludedTypeIDs: normalizeNumericSet(entry.excludedTypeIDs),
        excludedGroupIDs: normalizeNumericSet(entry.excludedGroupIDs),
        excludedCategoryIDs: normalizeNumericSet(entry.excludedCategoryIDs),
        excludedTypeListIDs: normalizeNumericSet(entry.excludedTypeListIDs),
        excludedTags: normalizeNumericSet(entry.excludedTags),
        filterByTags: normalizeNumericSet(entry.filterByTags),
        requireAllFilteredTags: Boolean(entry.requireAllFilteredTags),
    };
}
function addToIndex(index, key, typeID) {
    if (!index.has(key))
        index.set(key, new Set());
    index.get(key).add(typeID);
}
function createTypeListAuthority(payload, typeRows = []) {
    const source = payload && payload.source && typeof payload.source === "object"
        ? payload.source : {};
    const versionKey = [
        source.buildNumber || "unknown-build",
        source.typeListsSha256 || "legacy-lists",
        source.typesSha256 || "legacy-types",
    ].join(":");
    const byID = new Map();
    for (const row of Array.isArray(payload && payload.typeLists) ? payload.typeLists : []) {
        const list = buildNormalizedTypeList(row);
        if (list)
            byID.set(list.listID, list);
    }
    const typeByID = new Map();
    const byCategory = new Map();
    const byGroup = new Map();
    const byTag = new Map();
    for (const row of Array.isArray(typeRows) ? typeRows : []) {
        const typeID = Number(row && (row.typeID ?? row._key)) || 0;
        if (!Number.isSafeInteger(typeID) || typeID <= 0)
            continue;
        typeByID.set(typeID, row);
        const groupID = row.groupID == null ? null : Number(row.groupID);
        const categoryID = row.categoryID == null ? null : Number(row.categoryID);
        if (Number.isSafeInteger(groupID))
            addToIndex(byGroup, groupID, typeID);
        if (Number.isSafeInteger(categoryID))
            addToIndex(byCategory, categoryID, typeID);
        for (const tag of normalizeNumericSet(row.tags))
            addToIndex(byTag, tag, typeID);
    }
    return {
        versionKey,
        meta: payload && typeof payload === "object" ? (payload._meta || {}) : {},
        byID,
        typeByID,
        byCategory,
        byGroup,
        byTag,
        membershipCache: new Map(),
        warnedMissingFallbacks: new Set(),
    };
}
function loadAuthority() {
    if (!cachedAuthority) {
        cachedAuthority = createTypeListAuthority(readStaticTable(TABLE.CLIENT_TYPE_LISTS), readStaticRows(TABLE.ITEM_TYPES));
    }
    return cachedAuthority;
}
function clearClientTypeListAuthorityCache() {
    cachedAuthority = null;
}
function _setTypeListAuthorityForTests(payload = null, typeRows = []) {
    cachedAuthority = payload == null ? null : createTypeListAuthority(payload, typeRows);
}
function getTypeList(listID) {
    const numericListID = Number(listID) || 0;
    return numericListID > 0 ? loadAuthority().byID.get(numericListID) || null : null;
}
function addIndexedTypes(target, index, identifiers) {
    for (const identifier of identifiers) {
        for (const typeID of index.get(identifier) || [])
            target.add(typeID);
    }
}
function removeIndexedTypes(target, index, identifiers) {
    for (const identifier of identifiers) {
        for (const typeID of index.get(identifier) || [])
            target.delete(typeID);
    }
}
function intersectWith(target, allowed) {
    for (const typeID of target) {
        if (!allowed.has(typeID))
            target.delete(typeID);
    }
}
// Frontier build 3502403 evetypes.GetTypeIDsFromTypeList first unions all
// include families, then subtracts all exclusion families, then filters tags.
// This intentionally differs from the public EVE Online six-field precedence.
function expandTypeList(authority, listID, visiting = new Set()) {
    const numericListID = Number(listID) || 0;
    const cacheKey = `${authority.versionKey}:${numericListID}`;
    if (authority.membershipCache.has(cacheKey)) {
        return authority.membershipCache.get(cacheKey);
    }
    const list = authority.byID.get(numericListID);
    if (!list || visiting.has(numericListID))
        return null;
    visiting.add(numericListID);
    const members = new Set();
    addIndexedTypes(members, authority.byCategory, list.includedCategoryIDs);
    addIndexedTypes(members, authority.byGroup, list.includedGroupIDs);
    for (const typeID of list.includedTypeIDs)
        members.add(typeID);
    addIndexedTypes(members, authority.byTag, list.includedTags);
    for (const childID of list.includedTypeListIDs) {
        const child = expandTypeList(authority, childID, visiting);
        if (!child) {
            visiting.delete(numericListID);
            authority.membershipCache.set(cacheKey, null);
            return null;
        }
        for (const typeID of child)
            members.add(typeID);
    }
    removeIndexedTypes(members, authority.byCategory, list.excludedCategoryIDs);
    removeIndexedTypes(members, authority.byGroup, list.excludedGroupIDs);
    for (const typeID of list.excludedTypeIDs)
        members.delete(typeID);
    removeIndexedTypes(members, authority.byTag, list.excludedTags);
    for (const childID of list.excludedTypeListIDs) {
        const child = expandTypeList(authority, childID, visiting);
        if (!child) {
            visiting.delete(numericListID);
            authority.membershipCache.set(cacheKey, null);
            return null;
        }
        for (const typeID of child)
            members.delete(typeID);
    }
    if (list.filterByTags.size > 0) {
        if (list.requireAllFilteredTags) {
            for (const tagID of list.filterByTags) {
                intersectWith(members, authority.byTag.get(tagID) || new Set());
            }
        }
        else {
            // The installed client calls GetTypeIDsByGroups in this branch. Preserve
            // that behavior even though the source field is named filterByTags.
            const allowed = new Set();
            addIndexedTypes(allowed, authority.byGroup, list.filterByTags);
            intersectWith(members, allowed);
        }
    }
    visiting.delete(numericListID);
    authority.membershipCache.set(cacheKey, members);
    return members;
}
function getExpandedTypeIDs(listID) {
    const members = expandTypeList(loadAuthority(), listID);
    return members ? new Set(members) : new Set();
}
function typeIDFromContext(itemOrTypeContext) {
    const typeID = Number(typeof itemOrTypeContext === "number"
        ? itemOrTypeContext
        : itemOrTypeContext &&
            (itemOrTypeContext.typeID ?? itemOrTypeContext.itemTypeID ?? itemOrTypeContext.id));
    return Number.isSafeInteger(typeID) && typeID > 0 ? typeID : 0;
}
function matchesTypeListInAuthority(authority, itemOrTypeContext, listID) {
    const typeID = typeIDFromContext(itemOrTypeContext);
    if (!typeID)
        return false;
    const members = expandTypeList(authority, listID);
    return members ? members.has(typeID) : false;
}
function matchesTypeList(itemOrTypeContext, listID) {
    return matchesTypeListInAuthority(loadAuthority(), itemOrTypeContext, listID);
}
// A missing build-specific list may have an explicitly authored gameplay
// fallback. A present but empty/broken list is authoritative and denies.
function matchesTypeListWithMissingFallback(itemOrTypeContext, listID, fallback, policyName) {
    const authority = loadAuthority();
    const numericListID = Number(listID) || 0;
    if (!Number.isSafeInteger(numericListID) || numericListID <= 0)
        return false;
    if (authority.byID.has(numericListID)) {
        return matchesTypeListInAuthority(authority, itemOrTypeContext, numericListID);
    }
    if (typeof fallback !== "function")
        return false;
    const warningKey = `${numericListID}:${String(policyName || "unspecified")}`;
    if (!authority.warnedMissingFallbacks.has(warningKey)) {
        authority.warnedMissingFallbacks.add(warningKey);
        log.warn(`[TypeListAuthority] Missing list ${numericListID} for ${String(policyName || "unspecified")} ` +
            `in ${authority.versionKey}; using explicit fallback`);
    }
    return fallback(itemOrTypeContext) === true;
}
function matchesAnyTypeList(itemOrTypeContext, listIDs = []) {
    for (const listID of Array.isArray(listIDs) ? listIDs : [listIDs]) {
        if (matchesTypeList(itemOrTypeContext, listID))
            return true;
    }
    return false;
}
function isTradableInventoryItemInAuthority(authority, itemOrTypeContext) {
    const typeID = typeIDFromContext(itemOrTypeContext);
    if (!typeID || !authority.typeByID.has(typeID))
        return false;
    for (const listID of TRADE_RESTRICTED_TYPE_LIST_IDS) {
        const members = expandTypeList(authority, listID);
        if (!members || members.has(typeID))
            return false;
    }
    return true;
}
function isTradableInventoryItem(itemOrTypeContext) {
    return isTradableInventoryItemInAuthority(loadAuthority(), itemOrTypeContext);
}
module.exports = {
    TRADE_NON_TRADABLE_TYPE_LIST_ID,
    TRADE_SOULBOUND_TYPE_LIST_ID,
    TRADE_RESTRICTED_TYPE_LIST_IDS,
    buildNormalizedTypeList,
    createTypeListAuthority,
    expandTypeList,
    matchesTypeListInAuthority,
    isTradableInventoryItemInAuthority,
    clearClientTypeListAuthorityCache,
    _setTypeListAuthorityForTests,
    getTypeList,
    getExpandedTypeIDs,
    matchesTypeList,
    matchesTypeListWithMissingFallback,
    matchesAnyTypeList,
    isTradableInventoryItem,
};
//# sourceMappingURL=typeListAuthority.js.map