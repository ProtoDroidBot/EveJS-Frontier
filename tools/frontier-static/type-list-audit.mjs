import fs from "node:fs";
import path from "node:path";
// Explicit server-owned bindings. Update this registry when a runtime consumer
// gains a hard-coded SDE list ID; missing IDs are reported, not remapped.
const RUNTIME_TYPE_LIST_BINDINGS = [
    { listID: 36, consumer: "inventory/trade: non-tradable", required: true },
    { listID: 142, consumer: "inventory/trade: soulbound", required: true },
    { listID: 231, consumer: "dynamic/ESS: linkable ships", required: true },
    { listID: 300, consumer: "ship/analysis beacon: standard linkable ships" },
    { listID: 946, consumer: "ship/analysis beacon: carrier linkable ships" },
    { listID: 336, consumer: "mining/structure compression", required: true },
    { listID: 492, consumer: "activity/video fragments", required: true },
    { listID: 601, consumer: "mining/crude lens", required: true },
    { listID: 612, consumer: "mining/asteroid lens", required: true },
    { listID: 611, consumer: "structure/automatic moon mining output" },
    { listID: 799, consumer: "industry/invention skill probability" },
    { listID: 861, consumer: "NPC/lootable scan targets", required: true },
    { listID: 923, consumer: "NPC/inventory scan interest", required: true },
    { listID: 985, consumer: "NPC/metamorphosis scan targets", required: true },
];
const REFERENCE_FIELDS = [
    ["includedCategoryIDs", "category"],
    ["excludedCategoryIDs", "category"],
    ["includedGroupIDs", "group"],
    ["excludedGroupIDs", "group"],
    ["includedTypeIDs", "type"],
    ["excludedTypeIDs", "type"],
    ["includedTypeListIDs", "list"],
    ["excludedTypeListIDs", "list"],
    ["includedTags", "tag"],
    ["excludedTags", "tag"],
    ["filterByTags", "tag"],
];
function readJsonlRows(snapshot, fileName) {
    return fs.readFileSync(path.join(snapshot, fileName), "utf8")
        .split(/\r?\n/)
        .filter((line) => line.trim())
        .map((line) => JSON.parse(line));
}
function auditTypeLists({ lists, categories, groups, types, runtimeBindings = RUNTIME_TYPE_LIST_BINDINGS }) {
    const errors = [];
    const warnings = [];
    const byID = new Map();
    const ids = {
        category: new Set(categories.map((row) => Number(row._key))),
        group: new Set(groups.map((row) => Number(row._key))),
        type: new Set(types.map((row) => Number(row._key))),
        list: new Set(),
        tag: new Set(types.flatMap((row) => Array.isArray(row.tags) ? row.tags.map(Number) : [])),
    };
    for (const row of lists) {
        const listID = Number(row._key);
        if (!Number.isSafeInteger(listID) || listID <= 0 || byID.has(listID)) {
            errors.push({ code: "duplicate-or-invalid-list-id", listID: row._key });
            continue;
        }
        byID.set(listID, row);
        ids.list.add(listID);
    }
    const emptyListIDs = [];
    const basicEmptyListIDs = [];
    for (const [listID, row] of byID) {
        let ruleCount = 0;
        for (const [field, kind] of REFERENCE_FIELDS) {
            const raw = row[field];
            if (raw !== undefined && !Array.isArray(raw)) {
                errors.push({ code: "invalid-rule-field", listID, field });
                continue;
            }
            const values = Array.isArray(raw) ? raw : [];
            ruleCount += values.length;
            const seen = new Set();
            for (const value of values) {
                const referenceID = Number(value);
                if (!Number.isSafeInteger(referenceID) || !ids[kind].has(referenceID)) {
                    const issue = { code: "unknown-reference", listID, field, referenceID: value };
                    (kind === "tag" ? warnings : errors).push(issue);
                }
                if (seen.has(referenceID)) {
                    warnings.push({ code: "duplicate-rule-reference", listID, field, referenceID });
                }
                seen.add(referenceID);
            }
        }
        if (ruleCount === 0)
            emptyListIDs.push(listID);
        if (["includedCategoryIDs", "includedGroupIDs", "includedTypeIDs"]
            .every((field) => !Array.isArray(row[field]) || row[field].length === 0)) {
            basicEmptyListIDs.push(listID);
        }
    }
    const visitState = new Map();
    function visit(listID, stack) {
        if (visitState.get(listID) === 2)
            return;
        if (visitState.get(listID) === 1) {
            errors.push({ code: "nested-list-cycle", path: [...stack, listID] });
            return;
        }
        const row = byID.get(listID);
        if (!row)
            return;
        visitState.set(listID, 1);
        for (const next of [...(row.includedTypeListIDs || []), ...(row.excludedTypeListIDs || [])]) {
            if (byID.has(Number(next)))
                visit(Number(next), [...stack, listID]);
        }
        visitState.set(listID, 2);
    }
    for (const listID of byID.keys())
        visit(listID, []);
    const missingRuntimeBindings = runtimeBindings
        .filter((binding) => !byID.has(binding.listID));
    const emptyRuntimeBindings = runtimeBindings
        .filter((binding) => emptyListIDs.includes(binding.listID));
    for (const binding of missingRuntimeBindings) {
        (binding.required ? errors : warnings).push({ code: "missing-runtime-list", ...binding });
    }
    for (const binding of emptyRuntimeBindings) {
        (binding.required ? errors : warnings).push({ code: "empty-runtime-list", ...binding });
    }
    return {
        schemaVersion: 1,
        counts: {
            sourceRows: lists.length,
            uniqueListIDs: byID.size,
            emptyLists: emptyListIDs.length,
            basicEmptyLists: basicEmptyListIDs.length,
            runtimeBindings: runtimeBindings.length,
            errors: errors.length,
            warnings: warnings.length,
        },
        emptyListIDs,
        basicEmptyListIDs,
        missingRuntimeBindings,
        emptyRuntimeBindings,
        errors,
        warnings,
    };
}
function auditTypeListSnapshot(snapshot, manifest) {
    const report = auditTypeLists({
        lists: readJsonlRows(snapshot, "typeLists.jsonl"),
        categories: readJsonlRows(snapshot, "categories.jsonl"),
        groups: readJsonlRows(snapshot, "groups.jsonl"),
        types: readJsonlRows(snapshot, "types.jsonl"),
    });
    return {
        ...report,
        build: Number(manifest.source?.client?.build) || null,
        sourceSha256: {
            typeLists: manifest.outputs?.["typeLists.jsonl"]?.sha256 || null,
            types: manifest.outputs?.["types.jsonl"]?.sha256 || null,
        },
    };
}
function compareTypeListCatalogs(previous, current) {
    function canonical(row) {
        const rules = Object.fromEntries(REFERENCE_FIELDS.map(([field]) => [
            field,
            [...new Set((Array.isArray(row[field]) ? row[field] : []).map(Number))].sort((a, b) => a - b),
        ]));
        return JSON.stringify({
            name: typeof row.name === "string" ? row.name : "",
            description: typeof row.description === "string" ? row.description : "",
            displayNameID: Number(row.displayNameID) || 0,
            requireAllFilteredTags: Number(row.requireAllFilteredTags) || 0,
            rules,
        });
    }
    const before = new Map(previous.map((row) => [Number(row.listID ?? row._key), canonical(row)]));
    const after = new Map(current.map((row) => [Number(row.listID ?? row._key), canonical(row)]));
    const addedIDs = [...after.keys()].filter((id) => !before.has(id)).sort((a, b) => a - b);
    const removedIDs = [...before.keys()].filter((id) => !after.has(id)).sort((a, b) => a - b);
    const changedIDs = [...after.keys()].filter((id) => before.has(id) && before.get(id) !== after.get(id))
        .sort((a, b) => a - b);
    return { previousCount: previous.length, currentCount: current.length, addedIDs, removedIDs, changedIDs };
}
function compareTypeListSnapshotToGenerated(snapshot, dataDir) {
    const tablePath = path.join(dataDir, "clientTypeLists", "data.json");
    if (!fs.existsSync(tablePath))
        return null;
    const previous = JSON.parse(fs.readFileSync(tablePath, "utf8"));
    return compareTypeListCatalogs(Array.isArray(previous.typeLists) ? previous.typeLists : [], readJsonlRows(snapshot, "typeLists.jsonl"));
}
export { RUNTIME_TYPE_LIST_BINDINGS, auditTypeLists, auditTypeListSnapshot, compareTypeListCatalogs, compareTypeListSnapshotToGenerated, };
//# sourceMappingURL=type-list-audit.mjs.map