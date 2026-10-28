import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const buildNumber = 3502403;
const sourcePath = path.join(repoRoot, "_local/frontier-sde", String(buildNumber), "typeLists.jsonl");
const outputPath = path.join(repoRoot, "doc", `SDE_TYPELIST_REGISTRY_${buildNumber}.json`);
const expectedSha256 = "adef57d15d4163851a0e0a457d6a4a3de7b3740fba7193681d01f4b3a8d88583";

// Only directly verified runtime consumers are marked bound. Dungeon-supplied
// dynamic list IDs and future faction-selected IDs need an explicit binding
// record before their individual rows can be promoted.
const bound = new Set([36, 142, 231, 300, 336, 492, 599, 601, 612, 613, 861, 923, 985]);
const clientOnly = new Set([850, 852, 922]);
const testOnly = new Set([539, 540, 619]);
const positiveRuleFields = [
  "includedCategoryIDs", "includedGroupIDs", "includedTypeIDs",
  "includedTypeListIDs", "includedTags",
];

function classify(row) {
  const id = Number(row._key);
  if (bound.has(id)) return "bound";
  if (clientOnly.has(id)) return "client-only";
  if (testOnly.has(id) || /\b(?:test|poc|debug)\b/iu.test(row.name || "")) return "test-only";
  if (positiveRuleFields.every(field => !row[field]?.length)) return "empty-authoring";
  return "unsupported-system";
}

export function buildTypeListRegistry(sourceBytes) {
  const sourceSha256 = crypto.createHash("sha256").update(sourceBytes).digest("hex");
  if (sourceSha256 !== expectedSha256) throw new Error("TYPELIST_REGISTRY_SOURCE_CHANGED");
  const rows = sourceBytes.toString("utf8").trim().split(/\r?\n/u).map(JSON.parse);
  const seen = new Set();
  const entries = rows.map(row => {
    const listID = Number(row._key);
    if (!Number.isSafeInteger(listID) || listID <= 0 || seen.has(listID)) {
      throw new Error("TYPELIST_REGISTRY_DUPLICATE_OR_INVALID_ID");
    }
    seen.add(listID);
    return { listID, name: row.name || "", status: classify(row) };
  }).sort((a, b) => a.listID - b.listID);
  if (entries.length !== 420) throw new Error("TYPELIST_REGISTRY_COUNT_CHANGED");
  const counts = Object.fromEntries(
    ["bound", "client-only", "unsupported-system", "empty-authoring", "test-only"]
      .map(status => [status, entries.filter(entry => entry.status === status).length]),
  );
  return {
    version: 1,
    buildNumber,
    typeListsSha256: sourceSha256,
    policy: "Only verified direct consumers are bound; configurable faction lanes are opt-in.",
    counts,
    entries,
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const output = JSON.stringify(buildTypeListRegistry(fs.readFileSync(sourcePath)), null, 2) + "\n";
  if (process.argv.includes("--check")) {
    if (!fs.existsSync(outputPath) || fs.readFileSync(outputPath, "utf8") !== output) {
      throw new Error("TYPELIST_REGISTRY_OUT_OF_DATE");
    }
  } else {
    fs.writeFileSync(outputPath, output);
  }
}
