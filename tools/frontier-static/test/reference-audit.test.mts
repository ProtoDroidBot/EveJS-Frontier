import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  auditSnapshot,
  defaultOutputPath,
  matchesPath,
  parseArgs,
  writeBrokenReferencesReport,
} from "../audit-frontier-references.mjs";

function writeTable(root: string, name: string, rows: Record<string, any>[]): void {
  fs.writeFileSync(
    path.join(root, name),
    rows.map((row) => JSON.stringify(row)).join("\n") + "\n",
  );
}

function makeSnapshot(t: test.TestContext): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "frontier-reference-audit-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

test("reference audit finds missing typeDogma attributes and effects", async (t) => {
  const root = makeSnapshot(t);
  writeTable(root, "types.jsonl", [{ _key: 10 }]);
  writeTable(root, "dogmaAttributes.jsonl", [{ _key: 1, attributeID: 1 }]);
  writeTable(root, "dogmaEffects.jsonl", [{ _key: 2, effectID: 2 }]);
  writeTable(root, "typeDogma.jsonl", [{
    _key: 10,
    dogmaAttributes: [{ attributeID: 1, value: 5 }, { attributeID: 99, value: 8 }],
    dogmaEffects: [{ effectID: 2 }, { effectID: 77 }],
  }]);

  const report = await auditSnapshot(root);

  assert.equal(report.ok, false);
  assert.equal(report.summary.checkedReferences, 5);
  assert.equal(report.summary.validReferences, 3);
  assert.equal(report.summary.brokenReferences, 2);
  assert.deepEqual(
    report.rules.filter((item: Record<string, any>) => item.broken > 0).map((item: Record<string, any>) => item.missingValues),
    [["99"], ["77"]],
  );
  assert.deepEqual(
    report.issues.map((issue: Record<string, any>) => [issue.path, issue.value]),
    [["dogmaAttributes[1].attributeID", 99], ["dogmaEffects[1].effectID", 77]],
  );
});

test("reference audit validates IDs stored as object keys", async (t) => {
  const root = makeSnapshot(t);
  writeTable(root, "types.jsonl", [{ _key: 10 }, { _key: 11 }]);
  writeTable(root, "dogmaAttributes.jsonl", [{ _key: 1 }]);
  writeTable(root, "spaceComponentsByType.jsonl", [{
    _key: 10,
    cargoBay: { acceptedTypeIDs: { 11: 0, 12: 0 } },
    appliedProximityEffects: { effects: { 1: -10 } },
  }]);

  const report = await auditSnapshot(root);

  assert.equal(report.summary.checkedReferences, 4);
  assert.equal(report.summary.brokenReferences, 1);
  assert.equal(report.issues[0].path, "cargoBay.acceptedTypeIDs.12");
  assert.equal(report.issues[0].value, "12");
});

test("reference audit limits examples without losing aggregate counts", async (t) => {
  const root = makeSnapshot(t);
  writeTable(root, "types.jsonl", [{ _key: 10 }]);
  writeTable(root, "dogmaAttributes.jsonl", []);
  writeTable(root, "dogmaEffects.jsonl", []);
  writeTable(root, "typeDogma.jsonl", [{
    _key: 10,
    dogmaAttributes: [{ attributeID: 1 }, { attributeID: 2 }],
    dogmaEffects: [],
  }]);

  const allBroken: Record<string, any>[] = [];
  const report = await auditSnapshot(root, {
    maxIssues: 1,
    onBroken: (issue) => allBroken.push(issue),
  });

  assert.equal(report.summary.brokenReferences, 2);
  assert.equal(report.issues.length, 1);
  assert.equal(report.summary.issueExamplesTruncated, 1);
  assert.equal(allBroken.length, 2);

  const outputPath = path.join(root, "reports", "broken.json");
  assert.equal(writeBrokenReferencesReport(outputPath, report, allBroken), outputPath);
  const artifact = JSON.parse(fs.readFileSync(outputPath, "utf8"));
  assert.equal(artifact.format, "evejs-frontier-broken-references-v1");
  assert.equal(artifact.summary.brokenReferenceRecords, 2);
  assert.deepEqual(artifact.brokenReferences.map((issue: Record<string, any>) => issue.value), [1, 2]);
  assert.equal(defaultOutputPath(root), path.join(path.dirname(root), `${path.basename(root)}-broken-references.json`));
});

test("reference audit path matching supports deep and dynamic segments", () => {
  assert.equal(matchesPath("**.typeID", "skills[].typeID"), true);
  assert.equal(matchesPath("parts.*.graphic_id", "parts.*.graphic_id"), true);
  assert.equal(matchesPath("parts.*.graphic_id", "parts.graphic_id"), false);
  assert.equal(matchesPath("dogmaEffects[].effectID", "dogmaEffects[].effectID"), true);
});

test("reference audit CLI accepts positional and explicit snapshots", () => {
  const positional = parseArgs(["./snapshot", "--json", "--max-issues", "5", "--output", "./report.json"]);
  assert.equal(positional.snapshot, path.resolve("./snapshot"));
  assert.equal(positional.format, "json");
  assert.equal(positional.maxIssues, 5);
  assert.equal(positional.output, path.resolve("./report.json"));
  assert.equal(positional.writeOutput, true);

  const explicit = parseArgs(["--snapshot", "./other", "--strict-unmapped", "--no-output"]);
  assert.equal(explicit.snapshot, path.resolve("./other"));
  assert.equal(explicit.strictUnmapped, true);
  assert.equal(explicit.showUnmapped, true);
  assert.equal(explicit.writeOutput, false);
  assert.throws(() => parseArgs(["--format", "xml"]), /Invalid format/);
  assert.throws(() => parseArgs(["--max-issues", "-1"]), /non-negative integer/);
});
