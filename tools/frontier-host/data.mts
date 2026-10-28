import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { assertNoSymlink, resolveHostPaths } from "./config.mjs";

export function readBuildManifest(file: string, build: string, kind: "static" | "contracts" | "database") {
  assertNoSymlink(file);
  const manifest = JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
  const declared = kind === "static" ? manifest.source?.client?.build : kind === "contracts" ? manifest.source?.build : manifest.build;
  if (String(declared) !== build) throw new Error(`Selected build ${build} differs from ${kind} manifest build ${declared}: ${file}`);
  return manifest;
}

export function verifyAttestedFile(root: string, relative: string, metadata: any) {
  if (typeof relative !== "string" || !relative || path.isAbsolute(relative) || relative.includes("\\")) throw new Error("Invalid attested relative path");
  const file = path.resolve(root, relative);
  const child = path.relative(path.resolve(root), file);
  if (!child || child === ".." || child.startsWith(`..${path.sep}`) || path.isAbsolute(child)) throw new Error("Attested file escapes its artifact root");
  assertNoSymlink(file);
  const stat = fs.statSync(file);
  if (!stat.isFile() || stat.size !== metadata?.bytes || !/^[a-f0-9]{64}$/i.test(metadata?.sha256 || "")) throw new Error(`Invalid file attestation: ${file}`);
  const hash = crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
  if (hash !== metadata.sha256.toLowerCase()) throw new Error(`Artifact hash mismatch: ${file}`);
  return file;
}

export function validateContracts(root: string, build: string) {
  const manifest = readBuildManifest(path.join(root, "frontier-contract-manifest.json"), build, "contracts");
  if (manifest.format !== "evejs-frontier-contracts-v1" || !manifest.outputs || !Object.keys(manifest.outputs).length) throw new Error("Public contract output manifest is incomplete");
  for (const [relative, metadata] of Object.entries(manifest.outputs)) verifyAttestedFile(root, relative, metadata);
  return manifest;
}

export async function validatePreparedData(repoRoot: string, build: string) {
  const paths = resolveHostPaths(repoRoot, build);
  const snapshot = readBuildManifest(path.join(paths.staticRoot, "frontier-extraction-manifest.json"), build, "static");
  const { validateSnapshot } = await import("../frontier-static/validate-frontier-static.mjs");
  await validateSnapshot(paths.staticRoot);
  validateContracts(paths.contractsRoot, build);
  const database = readBuildManifest(path.join(paths.generatedRoot, "manifest.json"), build, "database");
  const collision = database.assets?.collisionBundle;
  verifyAttestedFile(paths.generatedRoot, collision?.path, collision);
  if (collision.sha256 !== snapshot.assets?.collisionBundle?.sha256) throw new Error("Generated collision asset differs from the selected snapshot");
  const { validateDatabase } = await import("../frontier-static/build-frontier-database.mjs");
  const result = validateDatabase(paths.generatedData, snapshot, database);
  return { build, systems: result.systems, itemTypes: result.itemTypes, collisionSha256: collision.sha256 };
}
