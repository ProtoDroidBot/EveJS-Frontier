import fs from "node:fs";
import path from "node:path";

export function parseBuild(value: unknown): string {
  const build = String(value ?? "");
  if (!/^[1-9][0-9]*$/.test(build) || !Number.isSafeInteger(Number(build))) {
    throw new Error("An exact numeric client build is required (--build <number>).");
  }
  return build;
}

export function resolveHostPaths(repoRoot: string, selectedBuild: unknown) {
  const build = parseBuild(selectedBuild);
  const root = path.resolve(repoRoot);
  const generatedRoot = path.join(root, "_local/frontier-gameStore", build);
  const runtimeRoot = path.join(root, "_local/frontier-runtime", build);
  const runtimeGameStore = path.join(runtimeRoot, "gameStore");
  return {
    repoRoot: root, build, generatedRoot,
    generatedData: path.join(generatedRoot, "data"),
    generatedAssets: path.join(generatedRoot, "assets"),
    runtimeRoot, runtimeGameStore, runtimeData: path.join(runtimeGameStore, "data"),
    staticRoot: path.join(root, "_local/frontier-sde", build),
    contractsRoot: path.join(root, "_local/frontier-contracts", build),
    worldConfigPath: path.join(root, "_local/frontier-world", build, "world.private.json"),
  };
}

// These pre-catalog launcher profiles retain their established identity. Never
// choose a nearest build or infer identity from ordering across client branches.
const LEGACY_CYCLE6 = new Set(["3450341", "3455996", "3463382", "3465410", "3467658", "3474408", "3488090", "3502403"]);

export function resolveBuildProfile(repoRoot: string, selectedBuild: unknown, env: NodeJS.ProcessEnv = process.env) {
  const build = parseBuild(selectedBuild);
  const catalog = JSON.parse(fs.readFileSync(path.join(repoRoot, "server/src/config/clientBuildCatalog.json"), "utf8"));
  const candidates = catalog.profiles.filter((profile: any) => String(profile.clientBuild) === build);
  if (candidates.length > 1) throw new Error(`Duplicate client build profile: ${build}`);
  const profile = candidates[0] || (LEGACY_CYCLE6.has(build) ? {
    id: `frontier-${build}`, clientBuild: Number(build), clientCompatibilityProfile: "frontier",
    clientVersion: 20.04, clientCodename: "cycle-6", machoVersion: 489,
    blockchain: { protocol: "sui" },
  } : null);
  if (!profile) throw new Error(`No exact client identity is registered for build ${build}.`);
  if (env.EVEJS_CLIENT_BUILD && env.EVEJS_CLIENT_BUILD !== build) {
    throw new Error(`EVEJS_CLIENT_BUILD=${env.EVEJS_CLIENT_BUILD} conflicts with --build ${build}.`);
  }
  if (env.EVEJS_CLIENT_BUILD_PROFILE && env.EVEJS_CLIENT_BUILD_PROFILE !== "auto" && env.EVEJS_CLIENT_BUILD_PROFILE !== profile.id) {
    throw new Error(`EVEJS_CLIENT_BUILD_PROFILE conflicts with --build ${build}.`);
  }
  return { ...profile, runtimeProfileId: candidates[0] ? profile.id : "auto" };
}

export function assertNodeVersion(version = process.versions.node, architecture = process.arch) {
  const [major, minor] = version.split(".").map(Number);
  if (major !== 24 || minor < 11) throw new Error(`Node.js 24.11 or newer in the 24.x line is required; found ${version}.`);
  if (architecture !== "x64") throw new Error(`The qualified Frontier host architecture is x64; found ${architecture}.`);
}

export function assertNoSymlink(filePath: string) {
  let cursor = path.resolve(filePath);
  while (true) {
    try {
      if (fs.lstatSync(cursor).isSymbolicLink()) throw new Error(`Refusing a symbolic-link path: ${cursor}`);
    } catch (error: any) {
      if (error.code !== "ENOENT") throw error;
    }
    const parent = path.dirname(cursor);
    if (parent === cursor) return;
    cursor = parent;
  }
}
