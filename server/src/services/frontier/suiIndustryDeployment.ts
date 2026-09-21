import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { normalizeSuiAddress } from "@mysten/sui/utils";

type WorldIdentity = { chainId: string; packageId: string; objectRegistryId: string; adminAclId: string };
export type SuiIndustryDeployment = {
  industryPackageId: string; industryTypeOrigin: string; industryRegistryId: string; fingerprint: string;
};

function address(value: unknown, label: string): string {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{1,64}$/.test(value.trim()) || BigInt(value.trim()) === 0n) {
    throw new Error(`Industry deployment ${label} must be a nonzero Sui address`);
  }
  return normalizeSuiAddress(value.trim());
}
function chain(value: unknown): string {
  if (typeof value !== "string" || !/^[0-9a-fA-F]+$/.test(value.trim())) {
    throw new Error("Industry deployment chain ID is invalid");
  }
  return value.trim().toLowerCase();
}
function override(value: string | undefined, label: string) {
  return value === undefined || value.trim() === "" ? undefined : address(value, label);
}

/** Public upgrade metadata is separate from the base world and its credentials. */
export function readSuiIndustryDeployment(synced: WorldIdentity, env: NodeJS.ProcessEnv = process.env): SuiIndustryDeployment {
  const world = { chainId: chain(synced.chainId), worldPackageId: address(synced.packageId, "world package"),
    objectRegistryId: address(synced.objectRegistryId, "object registry"), adminAclId: address(synced.adminAclId, "admin ACL") };
  const explicit = String(env.EVEJS_SUI_INDUSTRY_CONFIG_PATH || "").trim();
  const worldPath = String(env.EVEJS_SUI_WORLD_CONFIG_PATH || "").trim();
  const configPath = explicit ? path.resolve(explicit) : worldPath ? path.join(path.dirname(path.resolve(worldPath)), "npc-deployment.json") : null;
  let file: Record<string, any> | null = null;
  if (configPath) {
    let raw: any;
    try { raw = JSON.parse(fs.readFileSync(configPath, "utf8")); }
    catch (error: any) {
      if (error.code !== "ENOENT") throw new Error("Industry deployment config could not be read as JSON", { cause: error });
    }
    if (raw !== undefined) {
      if (!raw || typeof raw !== "object" || Array.isArray(raw) || raw.schemaVersion !== 1) {
        throw new Error("Industry deployment config has an unsupported schema");
      }
      // Validate file identities even when environment overrides take precedence.
      const featureManifest = raw.industryPackageId != null || raw.industryTypeOrigin != null || raw.industryRegistryId != null;
      file = { schemaVersion: 1, chainId: chain(raw.chainId), worldPackageId: address(raw.worldPackageId, "world package"),
        objectRegistryId: address(raw.objectRegistryId, "object registry"), adminAclId: address(raw.adminAclId, "admin ACL"),
        packageId: address(featureManifest ? raw.industryPackageId : raw.packageId, "package"),
        typeOrigin: address(featureManifest ? raw.industryTypeOrigin : raw.typeOrigin, "type origin"),
        registryId: address(featureManifest ? raw.industryRegistryId : raw.registryId, "registry") };
      for (const key of ["chainId", "worldPackageId", "objectRegistryId", "adminAclId"] as const) {
        if (file[key] !== world[key]) throw new Error(`Industry deployment ${key} does not match the synchronized world`);
      }
    }
  }
  const packageOverride = override(env.SMART_INDUSTRY_PACKAGE_ID, "environment package");
  const originOverride = override(env.SMART_INDUSTRY_TYPE_ORIGIN, "environment type origin");
  const registryOverride = override(env.SMART_INDUSTRY_REGISTRY_ID, "environment registry");
  const industryPackageId = packageOverride ?? file?.packageId ?? world.worldPackageId;
  const industryTypeOrigin = originOverride ?? file?.typeOrigin ?? industryPackageId;
  const industryRegistryId = registryOverride ?? file?.registryId ?? world.objectRegistryId;
  const fingerprint = createHash("sha256").update(JSON.stringify({ world, file,
    packageOverride, originOverride, registryOverride,
    industryPackageId, industryTypeOrigin, industryRegistryId })).digest("hex");
  return { industryPackageId, industryTypeOrigin, industryRegistryId, fingerprint };
}

export function assertSuiIndustryDeploymentCurrent(expected: SuiIndustryDeployment, synced: WorldIdentity, env: NodeJS.ProcessEnv = process.env) {
  const current = readSuiIndustryDeployment(synced, env);
  if (current.fingerprint !== expected.fingerprint) throw new Error("Industry deployment changed; retry with the current upgrade configuration");
  return current;
}
