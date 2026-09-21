import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { normalizeSuiAddress } from "@mysten/sui/utils";

export type SuiNpcBaseWorld = {
  chainId: string;
  packageId: string;
  objectRegistryId: string;
  adminAclId: string;
};

export type SuiNpcWorldConfig = {
  /** Latest implementation package used as the Move-call target. */
  npcPackageId: string;
  /** First package containing npc::NpcProfile and npc::NpcProfileKey. */
  npcTypeOrigin: string;
  /** Shared registry that owns derived NPC profile IDs. */
  npcRegistryId: string;
  /** Latest implementation package used for assembly-access Move calls. */
  accessPackageId: string;
  /** First package containing assembly_access policy/grant object types. */
  accessTypeOrigin: string;
  /** Shared registry that owns derived assembly-access policy IDs. */
  accessRegistryId: string;
  catapultPackageId: string;
  catapultTypeOrigin: string;
  catapultRegistryId: string;
  transponderPackageId: string;
  transponderTypeOrigin: string;
  transponderRegistryId: string;
  fingerprint: string;
};

function address(value: unknown, label: string): string {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{1,64}$/.test(value.trim()) || BigInt(value.trim()) === 0n) {
    throw new Error(`NPC deployment ${label} must be a nonzero Sui address`);
  }
  return normalizeSuiAddress(value.trim());
}

function chain(value: unknown): string {
  if (typeof value !== "string" || !/^[0-9a-fA-F]+$/.test(value.trim())) {
    throw new Error("NPC deployment chain ID is invalid");
  }
  return value.trim().toLowerCase();
}

function override(value: string | undefined, label: string) {
  return value === undefined || value.trim() === "" ? undefined : address(value, label);
}

/** Public NPC upgrade metadata must never replace the original world identity. */
export function readSuiNpcWorldConfig(
  synced: SuiNpcBaseWorld,
  env: NodeJS.ProcessEnv = process.env,
): SuiNpcWorldConfig {
  const world = {
    chainId: chain(synced.chainId),
    worldPackageId: address(synced.packageId, "world package"),
    objectRegistryId: address(synced.objectRegistryId, "object registry"),
    adminAclId: address(synced.adminAclId, "admin ACL"),
  };
  const explicit = String(env.EVEJS_SUI_NPC_CONFIG_PATH || "").trim();
  const worldPath = String(env.EVEJS_SUI_WORLD_CONFIG_PATH || "").trim();
  const configPath = explicit ? path.resolve(explicit)
    : worldPath ? path.join(path.dirname(path.resolve(worldPath)), "npc-deployment.json") : null;
  let file: Record<string, any> | null = null;
  if (configPath) {
    let raw: any;
    try {
      raw = JSON.parse(fs.readFileSync(configPath, "utf8"));
    } catch (error: any) {
      // The conventional sibling is optional. An explicitly selected file is
      // required: a typo must not silently send writes to the base package.
      if (error.code !== "ENOENT" || explicit) {
        throw new Error("NPC deployment config could not be read as JSON", { cause: error });
      }
    }
    if (raw !== undefined) {
      if (!raw || typeof raw !== "object" || Array.isArray(raw) || raw.schemaVersion !== 1) {
        throw new Error("NPC deployment config has an unsupported schema");
      }
      // Validate the whole file even when environment overrides take priority.
      file = {
        schemaVersion: 1,
        chainId: chain(raw.chainId),
        worldPackageId: address(raw.worldPackageId, "world package"),
        objectRegistryId: address(raw.objectRegistryId, "object registry"),
        adminAclId: address(raw.adminAclId, "admin ACL"),
        packageId: address(raw.packageId, "package"),
        typeOrigin: address(raw.typeOrigin, "type origin"),
        npcRegistryId: address(raw.npcRegistryId, "NPC registry"),
        accessPackageId: address(raw.accessPackageId, "assembly access package"),
        accessTypeOrigin: address(raw.accessTypeOrigin, "assembly access type origin"),
        accessRegistryId: address(raw.accessRegistryId, "assembly access registry"),
        catapultPackageId: address(raw.catapultPackageId, "catapult package"),
        catapultTypeOrigin: address(raw.catapultTypeOrigin, "catapult type origin"),
        catapultRegistryId: address(raw.catapultRegistryId, "catapult registry"),
        transponderPackageId: address(raw.transponderPackageId, "transponder package"),
        transponderTypeOrigin: address(raw.transponderTypeOrigin, "transponder type origin"),
        transponderRegistryId: address(raw.transponderRegistryId, "transponder registry"),
      };
      for (const key of ["chainId", "worldPackageId", "objectRegistryId", "adminAclId"] as const) {
        if (file[key] !== world[key]) {
          throw new Error(`NPC deployment ${key} does not match the synchronized world`);
        }
      }
    }
  }
  const packageOverride = override(env.EVEJS_SUI_NPC_PACKAGE_ID, "environment package");
  const originOverride = override(env.EVEJS_SUI_NPC_TYPE_ORIGIN, "environment type origin");
  const npcRegistryOverride = override(
    env.EVEJS_SUI_NPC_REGISTRY_ID, "NPC environment registry",
  );
  const accessPackageOverride = override(
    env.EVEJS_SUI_ASSEMBLY_ACCESS_PACKAGE_ID, "assembly access environment package",
  );
  const accessOriginOverride = override(
    env.EVEJS_SUI_ASSEMBLY_ACCESS_TYPE_ORIGIN, "assembly access environment type origin",
  );
  const accessRegistryOverride = override(
    env.EVEJS_SUI_ASSEMBLY_ACCESS_REGISTRY_ID, "assembly access environment registry",
  );
  const catapultPackageOverride = override(
    env.EVEJS_SUI_CATAPULT_PACKAGE_ID, "catapult environment package",
  );
  const catapultOriginOverride = override(
    env.EVEJS_SUI_CATAPULT_TYPE_ORIGIN, "catapult environment type origin",
  );
  const catapultRegistryOverride = override(
    env.EVEJS_SUI_CATAPULT_REGISTRY_ID, "catapult environment registry",
  );
  const transponderPackageOverride = override(
    env.EVEJS_SUI_TRANSPONDER_PACKAGE_ID, "transponder environment package",
  );
  const transponderOriginOverride = override(
    env.EVEJS_SUI_TRANSPONDER_TYPE_ORIGIN, "transponder environment type origin",
  );
  const transponderRegistryOverride = override(
    env.EVEJS_SUI_TRANSPONDER_REGISTRY_ID, "transponder environment registry",
  );
  const npcPackageId = packageOverride ?? file?.packageId ?? world.worldPackageId;
  const npcTypeOrigin = originOverride ?? file?.typeOrigin ?? npcPackageId;
  const npcRegistryId = npcRegistryOverride ?? file?.npcRegistryId ?? world.objectRegistryId;
  const accessPackageId = accessPackageOverride ?? file?.accessPackageId ?? npcPackageId;
  const accessTypeOrigin = accessOriginOverride ?? file?.accessTypeOrigin ?? accessPackageId;
  const accessRegistryId = accessRegistryOverride ?? file?.accessRegistryId ?? world.objectRegistryId;
  const catapultPackageId = catapultPackageOverride ?? file?.catapultPackageId ?? world.worldPackageId;
  const catapultTypeOrigin = catapultOriginOverride ?? file?.catapultTypeOrigin ?? catapultPackageId;
  const catapultRegistryId = catapultRegistryOverride ?? file?.catapultRegistryId ?? world.objectRegistryId;
  const transponderPackageId = transponderPackageOverride ?? file?.transponderPackageId ?? world.worldPackageId;
  const transponderTypeOrigin = transponderOriginOverride ?? file?.transponderTypeOrigin ?? transponderPackageId;
  const transponderRegistryId = transponderRegistryOverride ?? file?.transponderRegistryId ?? world.objectRegistryId;
  const fingerprint = createHash("sha256").update(JSON.stringify({
    world, file, packageOverride, originOverride, npcRegistryOverride,
    accessPackageOverride, accessOriginOverride, accessRegistryOverride,
    catapultPackageOverride, catapultOriginOverride, catapultRegistryOverride,
    transponderPackageOverride, transponderOriginOverride, transponderRegistryOverride,
    npcPackageId, npcTypeOrigin, npcRegistryId,
    accessPackageId, accessTypeOrigin, accessRegistryId,
    catapultPackageId, catapultTypeOrigin, catapultRegistryId,
    transponderPackageId, transponderTypeOrigin, transponderRegistryId,
  })).digest("hex");
  return {
    npcPackageId, npcTypeOrigin, npcRegistryId,
    accessPackageId, accessTypeOrigin, accessRegistryId,
    catapultPackageId, catapultTypeOrigin, catapultRegistryId,
    transponderPackageId, transponderTypeOrigin, transponderRegistryId,
    fingerprint,
  };
}

/** Re-read immediately before persisting/submitting a signed transaction. */
export function assertSuiNpcWorldConfigCurrent(
  expected: SuiNpcWorldConfig,
  synced: SuiNpcBaseWorld,
  env: NodeJS.ProcessEnv = process.env,
): SuiNpcWorldConfig {
  const current = readSuiNpcWorldConfig(synced, env);
  if (current.fingerprint !== expected.fingerprint) {
    throw new Error("NPC deployment changed; retry with the current upgrade configuration");
  }
  return current;
}
