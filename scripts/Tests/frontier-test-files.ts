"use strict";

import fs = require("node:fs");
import path = require("node:path");

function listMatchingTestFiles(directory: string, predicate: (name: string) => boolean): string[] {
  const resolvedDirectory = path.resolve(directory);
  if (!fs.existsSync(resolvedDirectory)) {
    throw new Error(`Test directory is missing: ${resolvedDirectory}`);
  }

  return fs
    .readdirSync(resolvedDirectory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && predicate(entry.name))
    .map((entry) => path.join(resolvedDirectory, entry.name))
    .sort((left, right) => left.localeCompare(right, "en"));
}

function listFrontierServerTests(repoRoot: string): string[] {
  return listMatchingTestFiles(
    path.join(repoRoot, "server", "tests"),
    (name) => /^frontier.*\.test\.js$/i.test(name),
  );
}

function listFrontierStaticTests(repoRoot: string): string[] {
  return listMatchingTestFiles(
    path.join(repoRoot, "tools", "frontier-static", "test"),
    (name) => name.endsWith(".test.mjs"),
  );
}

module.exports = {
  listFrontierServerTests,
  listFrontierStaticTests,
  listMatchingTestFiles,
};
