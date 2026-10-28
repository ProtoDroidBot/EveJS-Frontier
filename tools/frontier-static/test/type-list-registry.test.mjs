import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { buildTypeListRegistry } from "../build-type-list-registry.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const source = path.join(repoRoot, "_local/frontier-sde/3502403/typeLists.jsonl");
const output = path.join(repoRoot, "docs/SDE_TYPELIST_REGISTRY_3502403.json");

test("P4 registry classifies every source list and stays pinned to build 3502403", {
  skip: !fs.existsSync(source) && "local SDE snapshot is not installed",
}, () => {
  const registry = buildTypeListRegistry(fs.readFileSync(source));
  assert.deepEqual(registry, JSON.parse(fs.readFileSync(output, "utf8")));
  assert.equal(registry.entries.length, 420);
  assert.equal(new Set(registry.entries.map(entry => entry.listID)).size, 420);
  assert.equal(registry.entries.find(entry => entry.listID === 864).status, "empty-authoring");
  assert.equal(registry.entries.find(entry => entry.listID === 565).status, "unsupported-system");
  assert.equal(registry.entries.find(entry => entry.listID === 923).status, "bound");
  assert.equal(registry.entries.find(entry => entry.listID === 850).status, "client-only");
  assert.equal(registry.entries.find(entry => entry.listID === 539).status, "test-only");
});
