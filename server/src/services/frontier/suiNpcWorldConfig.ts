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
  /** Latest implementation package used for canonical action-queue Move calls. */
  actionPackageId: string;
  /** First package containing action_queue::Action and action_queue::ActionKey. */
  actionTypeOrigin: string;
  /** Shared root that owns deterministic Action objects. */
  actionRegistryId: string;
  industryActionsPackageId: string;
  industryActionsTypeOrigin: string;
  industryActionsRegistryId: string;
  logisticsPackageId: string;
  logisticsTypeOrigin: string;
  logisticsRegistryId: string;
  infrastructurePackageId: string;
  infrastructureTypeOrigin: string;
  infrastructureRegistryId: string;
  automationPackageId: string;
  automationTypeOrigin: string;
  automationRegistryId: string;
  catapultPackageId: string;
  catapultTypeOrigin: string;
  catapultRegistryId: string;
  industryPackageId: string;
  industryTypeOrigin: string;
  industryRegistryId: string;
  transponderPackageId: string;
  transponderTypeOrigin: string;
  transponderRegistryId: string;
  /** Manifest capability records keyed independently for partial deployments. */
  capabilities: Record<string, {
    status: "deployed" | "legacy-fallback" | "unavailable";
    packageId: string;
    typeOrigin: string;
    registryId: string;
  }>;
  /** Optional canonical faction-key allowlists from world-features.v1.json. */
  factionCapabilities: Record<string, string[]>;
  /** Capability policy inherited by factions without an explicit override. */
  defaultFactionCapabilities: string[] | null;
  /** Public file references retained for later on-chain faction migration. */
  factionConfigReferences: Record<string, { path: string; fallback: "default" | null }>;
  manifestFormat: "world-features-v1" | "legacy-npc-deployment" | "implicit-legacy";
  fingerprint: string;
};

export const WORLD_FEATURE_MANIFEST_FILENAME = "world-features.v1.json";
export const LEGACY_NPC_DEPLOYMENT_FILENAME = "npc-deployment.json";
const WORLD_FEATURE_MANIFEST_FORMAT = "eve-frontier-world-features";

const FEATURE_BINDINGS = Object.freeze({
  npc: ["packageId", "typeOrigin", "npcRegistryId"],
  assemblyAccess: ["accessPackageId", "accessTypeOrigin", "accessRegistryId"],
  catapult: ["catapultPackageId", "catapultTypeOrigin", "catapultRegistryId"],
  smartIndustry: ["industryPackageId", "industryTypeOrigin", "industryRegistryId"],
  transponder: ["transponderPackageId", "transponderTypeOrigin", "transponderRegistryId"],
  actionQueue: ["actionPackageId", "actionTypeOrigin", "actionRegistryId"],
  industryActions: ["industryActionsPackageId", "industryActionsTypeOrigin", "industryActionsRegistryId"],
  logisticsActions: ["logisticsPackageId", "logisticsTypeOrigin", "logisticsRegistryId"],
  infrastructureActions: ["infrastructurePackageId", "infrastructureTypeOrigin", "infrastructureRegistryId"],
  automation: ["automationPackageId", "automationTypeOrigin", "automationRegistryId"],
} as const);

function isCanonicalFactionKey(value: string): boolean {
  const match = /^(\d{1,10})-[a-z0-9][a-z0-9_-]{0,95}$/.exec(value);
  return Boolean(match) && Number(match![1]) <= 0xffffffff;
}

function normalizeFactionCapabilityMap(raw: unknown): Record<string, string[]> {
  if (raw === undefined) return {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("World feature manifest factions must be an object");
  }
  const result: Record<string, string[]> = {};
  for (const [factionKey, record] of Object.entries<any>(raw)) {
    if (!isCanonicalFactionKey(factionKey)) {
      throw new Error("World feature faction keys must use factionID-factionStringOnlyID");
    }
    const enabled: string[] | null = record && Array.isArray(record.capabilities)
      ? record.capabilities
      : null;
    if (!enabled || enabled.some(value =>
      typeof value !== "string" || !Object.hasOwn(FEATURE_BINDINGS, value)
    )) {
      throw new Error(`World feature faction ${factionKey} has invalid capabilities`);
    }
    result[factionKey] = [...new Set(enabled)].sort();
  }
  return result;
}

function normalizeCapabilityNames(raw: unknown, label: string): string[] {
  if (!Array.isArray(raw) || raw.some(value =>
    typeof value !== "string" || !Object.hasOwn(FEATURE_BINDINGS, value)
  )) {
    throw new Error(`${label} must be an array of known capability names`);
  }
  return [...new Set(raw)].sort();
}

function readFactionFeatureFile(
  manifestPath: string,
  relativePath: unknown,
  expectedPath: string,
  label: string,
): any {
  if (relativePath !== expectedPath) {
    throw new Error(`${label} must use canonical path ${expectedPath}`);
  }
  const resolved = path.resolve(path.dirname(manifestPath), expectedPath);
  const expectedRoot = `${path.resolve(path.dirname(manifestPath), "factions")}${path.sep}`;
  if (!resolved.startsWith(expectedRoot)) throw new Error(`${label} escapes the faction config directory`);
  let stat: fs.Stats;
  let raw: any;
  try {
    stat = fs.lstatSync(resolved);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("not a regular file");
    raw = JSON.parse(fs.readFileSync(resolved, "utf8"));
  } catch (error: any) {
    throw new Error(`${label} could not be read as JSON`, { cause: error });
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw) ||
      raw.format !== "eve-frontier-faction-features" || raw.schemaVersion !== 1) {
    throw new Error(`${label} has an unsupported schema`);
  }
  return raw;
}

function readSplitFactionCapabilityMap(
  raw: unknown,
  manifestPath: string,
): {
  capabilities: Record<string, string[]>;
  defaultCapabilities: string[];
  references: Record<string, { path: string; fallback: "default" | null }>;
} {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("World feature factionConfig must be an object");
  }
  const source: any = raw;
  if (!source.default || source.default.id !== "default" ||
      !source.factions || typeof source.factions !== "object" || Array.isArray(source.factions)) {
    throw new Error("World feature factionConfig requires default and factions records");
  }
  const defaultPath = "factions/default.v1.json";
  const defaultFile = readFactionFeatureFile(
    manifestPath, source.default.path, defaultPath, "Default faction feature config",
  );
  if (defaultFile.configId !== "default") {
    throw new Error("Default faction feature config must use configId default");
  }
  const defaultCapabilities = normalizeCapabilityNames(
    defaultFile.capabilities,
    "Default faction feature config capabilities",
  );
  const capabilities: Record<string, string[]> = {};
  const references: Record<string, { path: string; fallback: "default" | null }> = {
    default: { path: defaultPath, fallback: null },
  };
  for (const [factionKey, reference] of Object.entries<any>(source.factions)) {
    if (!isCanonicalFactionKey(factionKey)) {
      throw new Error("World feature faction keys must use factionID-factionStringOnlyID");
    }
    const expectedPath = `factions/${factionKey}.v1.json`;
    if (!reference || typeof reference !== "object" || reference.fallback !== "default") {
      throw new Error(`World feature faction ${factionKey} must reference fallback default`);
    }
    const factionFile = readFactionFeatureFile(
      manifestPath, reference.path, expectedPath, `Faction feature config ${factionKey}`,
    );
    if (factionFile.factionKey !== factionKey || factionFile.fallback !== "default") {
      throw new Error(`Faction feature config ${factionKey} has mismatched identity or fallback`);
    }
    capabilities[factionKey] = factionFile.capabilities === undefined
      ? [...defaultCapabilities]
      : normalizeCapabilityNames(
          factionFile.capabilities,
          `Faction feature config ${factionKey} capabilities`,
        );
    references[factionKey] = { path: expectedPath, fallback: "default" };
  }
  return { capabilities, defaultCapabilities, references };
}

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
  const featureExplicit = String(
    env.EVEJS_SUI_WORLD_FEATURES_CONFIG_PATH || "",
  ).trim();
  const legacyExplicit = String(env.EVEJS_SUI_NPC_CONFIG_PATH || "").trim();
  const worldPath = String(env.EVEJS_SUI_WORLD_CONFIG_PATH || "").trim();
  const siblingDirectory = worldPath
    ? path.dirname(path.resolve(worldPath))
    : null;
  const conventionalFeaturePath = siblingDirectory
    ? path.join(siblingDirectory, WORLD_FEATURE_MANIFEST_FILENAME)
    : null;
  const conventionalLegacyPath = siblingDirectory
    ? path.join(siblingDirectory, LEGACY_NPC_DEPLOYMENT_FILENAME)
    : null;
  const explicit = featureExplicit || legacyExplicit;
  const configPath = featureExplicit
    ? path.resolve(featureExplicit)
    : legacyExplicit
      ? path.resolve(legacyExplicit)
      : conventionalFeaturePath && fs.existsSync(conventionalFeaturePath)
        ? conventionalFeaturePath
        : conventionalLegacyPath;
  let file: Record<string, any> | null = null;
  let manifestFormat: SuiNpcWorldConfig["manifestFormat"] = "implicit-legacy";
  let factionCapabilities: Record<string, string[]> = {};
  let defaultFactionCapabilities: string[] | null = null;
  let factionConfigReferences: SuiNpcWorldConfig["factionConfigReferences"] = {};
  const deployedCapabilityNames = new Set<string>();
  if (configPath) {
    let raw: any;
    try {
      raw = JSON.parse(fs.readFileSync(configPath, "utf8"));
    } catch (error: any) {
      // The conventional sibling is optional. An explicitly selected file is
      // required: a typo must not silently send writes to the base package.
      if (error.code !== "ENOENT" || explicit) {
        throw new Error("World feature deployment config could not be read as JSON", { cause: error });
      }
    }
    if (raw !== undefined) {
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
        throw new Error("World feature deployment config has an unsupported schema");
      }
      if (
        raw.format === WORLD_FEATURE_MANIFEST_FORMAT &&
        raw.schemaVersion === 1
      ) {
        if (!raw.world || typeof raw.world !== "object" ||
            !raw.capabilities || typeof raw.capabilities !== "object" ||
            Array.isArray(raw.capabilities)) {
          throw new Error("World feature deployment config has an unsupported schema");
        }
        manifestFormat = "world-features-v1";
        for (const capabilityName of Object.keys(raw.capabilities)) {
          if (!Object.hasOwn(FEATURE_BINDINGS, capabilityName)) {
            throw new Error(`World feature manifest contains unknown capability ${capabilityName}`);
          }
        }
        file = {
          schemaVersion: raw.schemaVersion,
          chainId: chain(raw.chainId),
          worldPackageId: address(raw.world.packageId, "world package"),
          objectRegistryId: address(raw.world.objectRegistryId, "object registry"),
          adminAclId: address(raw.world.adminAclId, "admin ACL"),
        };
        for (const [capabilityName, fields] of Object.entries(FEATURE_BINDINGS)) {
          const capability = raw.capabilities[capabilityName];
          if (capability === undefined || capability?.status === "unavailable") {
            continue;
          }
          if (!capability || capability.status !== "deployed") {
            throw new Error(
              `World feature capability ${capabilityName} has an invalid status`,
            );
          }
          file[fields[0]] = address(
            capability.packageId,
            `${capabilityName} package`,
          );
          file[fields[1]] = address(
            capability.typeOrigin,
            `${capabilityName} type origin`,
          );
          file[fields[2]] = address(
            capability.registryId,
            `${capabilityName} registry`,
          );
          deployedCapabilityNames.add(capabilityName);
        }
        if (raw.factionConfig !== undefined) {
          if (raw.factions !== undefined) {
            throw new Error("World feature manifest cannot combine factionConfig with inline factions");
          }
          const splitFactions = readSplitFactionCapabilityMap(
            raw.factionConfig,
            configPath,
          );
          factionCapabilities = splitFactions.capabilities;
          defaultFactionCapabilities = splitFactions.defaultCapabilities;
          factionConfigReferences = splitFactions.references;
        } else {
          factionCapabilities = normalizeFactionCapabilityMap(raw.factions);
        }
      } else if (
        raw.schemaVersion === 1 ||
        raw.schemaVersion === 2 ||
        raw.schemaVersion === 3
      ) {
        manifestFormat = "legacy-npc-deployment";
        // Validate the whole legacy file even when environment overrides take priority.
        file = {
        schemaVersion: raw.schemaVersion,
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
        industryPackageId: address(raw.industryPackageId, "Smart Industry package"),
        industryTypeOrigin: address(raw.industryTypeOrigin, "Smart Industry type origin"),
        industryRegistryId: address(raw.industryRegistryId, "Smart Industry registry"),
        transponderPackageId: address(raw.transponderPackageId, "transponder package"),
        transponderTypeOrigin: address(raw.transponderTypeOrigin, "transponder type origin"),
        transponderRegistryId: address(raw.transponderRegistryId, "transponder registry"),
        actionPackageId: raw.schemaVersion >= 2
          ? address(raw.actionPackageId, "action queue package")
          : address(raw.accessPackageId, "assembly access package"),
        actionTypeOrigin: raw.schemaVersion >= 2
          ? address(raw.actionTypeOrigin, "action queue type origin")
          : address(raw.accessTypeOrigin, "assembly access type origin"),
        actionRegistryId: raw.schemaVersion >= 2
          ? address(raw.actionRegistryId, "action queue registry")
          : address(raw.accessRegistryId, "assembly access registry"),
        industryActionsPackageId: raw.schemaVersion >= 2
          ? address(raw.industryActionsPackageId, "Industry Actions package")
          : address(raw.industryPackageId, "Smart Industry package"),
        industryActionsTypeOrigin: raw.schemaVersion >= 2
          ? address(raw.industryActionsTypeOrigin, "Industry Actions type origin")
          : address(raw.industryTypeOrigin, "Smart Industry type origin"),
        industryActionsRegistryId: raw.schemaVersion >= 2
          ? address(raw.industryActionsRegistryId, "Industry Actions registry")
          : address(raw.industryRegistryId, "Smart Industry registry"),
        logisticsPackageId: raw.schemaVersion === 3
          ? address(raw.logisticsPackageId, "Logistics Actions package")
          : address(raw.actionPackageId ?? raw.accessPackageId, "action queue package"),
        logisticsTypeOrigin: raw.schemaVersion === 3
          ? address(raw.logisticsTypeOrigin, "Logistics Actions type origin")
          : address(raw.actionTypeOrigin ?? raw.accessTypeOrigin, "action queue type origin"),
        logisticsRegistryId: raw.schemaVersion === 3
          ? address(raw.logisticsRegistryId, "Logistics Actions registry")
          : address(raw.actionRegistryId ?? raw.accessRegistryId, "action queue registry"),
        infrastructurePackageId: raw.schemaVersion === 3
          ? address(raw.infrastructurePackageId, "Infrastructure Actions package")
          : address(raw.actionPackageId ?? raw.accessPackageId, "action queue package"),
        infrastructureTypeOrigin: raw.schemaVersion === 3
          ? address(raw.infrastructureTypeOrigin, "Infrastructure Actions type origin")
          : address(raw.actionTypeOrigin ?? raw.accessTypeOrigin, "action queue type origin"),
        infrastructureRegistryId: raw.schemaVersion === 3
          ? address(raw.infrastructureRegistryId, "Infrastructure Actions registry")
          : address(raw.actionRegistryId ?? raw.accessRegistryId, "action queue registry"),
        automationPackageId: raw.schemaVersion === 3
          ? address(raw.automationPackageId, "Automation package")
          : address(raw.actionPackageId ?? raw.accessPackageId, "action queue package"),
        automationTypeOrigin: raw.schemaVersion === 3
          ? address(raw.automationTypeOrigin, "Automation type origin")
          : address(raw.actionTypeOrigin ?? raw.accessTypeOrigin, "action queue type origin"),
        automationRegistryId: raw.schemaVersion === 3
          ? address(raw.automationRegistryId, "Automation registry")
          : address(raw.actionRegistryId ?? raw.accessRegistryId, "action queue registry"),
        };
        for (const capabilityName of Object.keys(FEATURE_BINDINGS)) {
          deployedCapabilityNames.add(capabilityName);
        }
      } else {
        throw new Error("World feature deployment config has an unsupported schema");
      }
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
  const industryPackageOverride = override(
    env.SMART_INDUSTRY_PACKAGE_ID, "Smart Industry environment package",
  );
  const industryOriginOverride = override(
    env.SMART_INDUSTRY_TYPE_ORIGIN, "Smart Industry environment type origin",
  );
  const industryRegistryOverride = override(
    env.SMART_INDUSTRY_REGISTRY_ID, "Smart Industry environment registry",
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
  const actionPackageOverride = override(
    env.EVEJS_SUI_ACTION_QUEUE_PACKAGE_ID, "action queue environment package",
  );
  const actionOriginOverride = override(
    env.EVEJS_SUI_ACTION_QUEUE_TYPE_ORIGIN, "action queue environment type origin",
  );
  const actionRegistryOverride = override(
    env.EVEJS_SUI_ACTION_QUEUE_REGISTRY_ID, "action queue environment registry",
  );
  const industryActionsPackageOverride = override(
    env.EVEJS_SUI_INDUSTRY_ACTIONS_PACKAGE_ID, "Industry Actions environment package",
  );
  const industryActionsOriginOverride = override(
    env.EVEJS_SUI_INDUSTRY_ACTIONS_TYPE_ORIGIN, "Industry Actions environment type origin",
  );
  const industryActionsRegistryOverride = override(
    env.EVEJS_SUI_INDUSTRY_ACTIONS_REGISTRY_ID, "Industry Actions environment registry",
  );
  const logisticsPackageOverride = override(
    env.EVEJS_SUI_LOGISTICS_ACTIONS_PACKAGE_ID, "Logistics Actions environment package",
  );
  const logisticsOriginOverride = override(
    env.EVEJS_SUI_LOGISTICS_ACTIONS_TYPE_ORIGIN, "Logistics Actions environment type origin",
  );
  const logisticsRegistryOverride = override(
    env.EVEJS_SUI_LOGISTICS_ACTIONS_REGISTRY_ID, "Logistics Actions environment registry",
  );
  const infrastructurePackageOverride = override(
    env.EVEJS_SUI_INFRASTRUCTURE_ACTIONS_PACKAGE_ID, "Infrastructure Actions environment package",
  );
  const infrastructureOriginOverride = override(
    env.EVEJS_SUI_INFRASTRUCTURE_ACTIONS_TYPE_ORIGIN, "Infrastructure Actions environment type origin",
  );
  const infrastructureRegistryOverride = override(
    env.EVEJS_SUI_INFRASTRUCTURE_ACTIONS_REGISTRY_ID, "Infrastructure Actions environment registry",
  );
  const automationPackageOverride = override(
    env.EVEJS_SUI_AUTOMATION_PACKAGE_ID, "Automation environment package",
  );
  const automationOriginOverride = override(
    env.EVEJS_SUI_AUTOMATION_TYPE_ORIGIN, "Automation environment type origin",
  );
  const automationRegistryOverride = override(
    env.EVEJS_SUI_AUTOMATION_REGISTRY_ID, "Automation environment registry",
  );
  const npcPackageId = packageOverride ?? file?.packageId ?? world.worldPackageId;
  const npcTypeOrigin = originOverride ?? file?.typeOrigin ?? npcPackageId;
  const npcRegistryId = npcRegistryOverride ?? file?.npcRegistryId ?? world.objectRegistryId;
  // Resolve split features independently. An NPC-only override may point at a
  // package containing only `npc`; inheriting it here would silently direct
  // `assembly_access` calls to a package that cannot implement them. The
  // synchronized base-world package remains the legacy monolithic fallback.
  const accessPackageId = accessPackageOverride ?? file?.accessPackageId ?? world.worldPackageId;
  const accessTypeOrigin = accessOriginOverride ?? file?.accessTypeOrigin ?? accessPackageId;
  const accessRegistryId = accessRegistryOverride ?? file?.accessRegistryId ?? world.objectRegistryId;
  const catapultPackageId = catapultPackageOverride ?? file?.catapultPackageId ?? world.worldPackageId;
  const catapultTypeOrigin = catapultOriginOverride ?? file?.catapultTypeOrigin ?? catapultPackageId;
  const catapultRegistryId = catapultRegistryOverride ?? file?.catapultRegistryId ?? world.objectRegistryId;
  const industryPackageId = industryPackageOverride ?? file?.industryPackageId ?? world.worldPackageId;
  const industryTypeOrigin = industryOriginOverride ?? file?.industryTypeOrigin ?? industryPackageId;
  const industryRegistryId = industryRegistryOverride ?? file?.industryRegistryId ?? world.objectRegistryId;
  const transponderPackageId = transponderPackageOverride ?? file?.transponderPackageId ?? world.worldPackageId;
  const transponderTypeOrigin = transponderOriginOverride ?? file?.transponderTypeOrigin ?? transponderPackageId;
  const transponderRegistryId = transponderRegistryOverride ?? file?.transponderRegistryId ?? world.objectRegistryId;
  // Schema v1 carried the queue in world_assembly_access. Keeping this fallback
  // lets an existing deployment drain old actions before publishing schema v2.
  const actionPackageId = actionPackageOverride ?? file?.actionPackageId ?? accessPackageId;
  const actionTypeOrigin = actionOriginOverride ?? file?.actionTypeOrigin ?? actionPackageId;
  const actionRegistryId = actionRegistryOverride ?? file?.actionRegistryId ?? accessRegistryId;
  const industryActionsPackageId = industryActionsPackageOverride ??
    file?.industryActionsPackageId ?? file?.industryPackageId ?? world.worldPackageId;
  const industryActionsTypeOrigin = industryActionsOriginOverride ??
    file?.industryActionsTypeOrigin ?? industryActionsPackageId;
  const industryActionsRegistryId = industryActionsRegistryOverride ??
    file?.industryActionsRegistryId ?? file?.industryRegistryId ?? world.objectRegistryId;
  const logisticsPackageId = logisticsPackageOverride ?? file?.logisticsPackageId ?? actionPackageId;
  const logisticsTypeOrigin = logisticsOriginOverride ?? file?.logisticsTypeOrigin ?? logisticsPackageId;
  const logisticsRegistryId = logisticsRegistryOverride ?? file?.logisticsRegistryId ?? actionRegistryId;
  const infrastructurePackageId = infrastructurePackageOverride ??
    file?.infrastructurePackageId ?? actionPackageId;
  const infrastructureTypeOrigin = infrastructureOriginOverride ??
    file?.infrastructureTypeOrigin ?? infrastructurePackageId;
  const infrastructureRegistryId = infrastructureRegistryOverride ??
    file?.infrastructureRegistryId ?? actionRegistryId;
  const automationPackageId = automationPackageOverride ?? file?.automationPackageId ?? actionPackageId;
  const automationTypeOrigin = automationOriginOverride ?? file?.automationTypeOrigin ?? automationPackageId;
  const automationRegistryId = automationRegistryOverride ?? file?.automationRegistryId ?? actionRegistryId;
  const resolvedCapabilityBindings: Record<string, [string, string, string]> = {
    npc: [npcPackageId, npcTypeOrigin, npcRegistryId],
    assemblyAccess: [accessPackageId, accessTypeOrigin, accessRegistryId],
    catapult: [catapultPackageId, catapultTypeOrigin, catapultRegistryId],
    smartIndustry: [industryPackageId, industryTypeOrigin, industryRegistryId],
    transponder: [transponderPackageId, transponderTypeOrigin, transponderRegistryId],
    actionQueue: [actionPackageId, actionTypeOrigin, actionRegistryId],
    industryActions: [industryActionsPackageId, industryActionsTypeOrigin, industryActionsRegistryId],
    logisticsActions: [logisticsPackageId, logisticsTypeOrigin, logisticsRegistryId],
    infrastructureActions: [infrastructurePackageId, infrastructureTypeOrigin, infrastructureRegistryId],
    automation: [automationPackageId, automationTypeOrigin, automationRegistryId],
  };
  const overriddenCapabilities = new Set<string>([
    ...(packageOverride || originOverride || npcRegistryOverride ? ["npc"] : []),
    ...(accessPackageOverride || accessOriginOverride || accessRegistryOverride ? ["assemblyAccess"] : []),
    ...(catapultPackageOverride || catapultOriginOverride || catapultRegistryOverride ? ["catapult"] : []),
    ...(industryPackageOverride || industryOriginOverride || industryRegistryOverride ? ["smartIndustry"] : []),
    ...(transponderPackageOverride || transponderOriginOverride || transponderRegistryOverride ? ["transponder"] : []),
    ...(actionPackageOverride || actionOriginOverride || actionRegistryOverride ? ["actionQueue"] : []),
    ...(industryActionsPackageOverride || industryActionsOriginOverride || industryActionsRegistryOverride ? ["industryActions"] : []),
    ...(logisticsPackageOverride || logisticsOriginOverride || logisticsRegistryOverride ? ["logisticsActions"] : []),
    ...(infrastructurePackageOverride || infrastructureOriginOverride || infrastructureRegistryOverride ? ["infrastructureActions"] : []),
    ...(automationPackageOverride || automationOriginOverride || automationRegistryOverride ? ["automation"] : []),
  ]);
  const capabilities: SuiNpcWorldConfig["capabilities"] = {};
  for (const [name, binding] of Object.entries(resolvedCapabilityBindings)) {
    const explicitlyAvailable = deployedCapabilityNames.has(name) ||
      overriddenCapabilities.has(name);
    capabilities[name] = {
      status: manifestFormat === "world-features-v1" && !explicitlyAvailable
        ? "unavailable"
        : manifestFormat === "implicit-legacy"
          ? "legacy-fallback"
          : "deployed",
      packageId: binding[0],
      typeOrigin: binding[1],
      registryId: binding[2],
    };
  }
  for (const [factionKey, enabled] of Object.entries({
    ...(defaultFactionCapabilities ? { default: defaultFactionCapabilities } : {}),
    ...factionCapabilities,
  })) {
    for (const capabilityName of enabled) {
      if (capabilities[capabilityName]?.status === "unavailable") {
        throw new Error(
          `World feature faction ${factionKey} enables unavailable capability ${capabilityName}`,
        );
      }
    }
  }
  const fingerprint = createHash("sha256").update(JSON.stringify({
    world, file, manifestFormat, capabilities, factionCapabilities,
    defaultFactionCapabilities, factionConfigReferences,
    packageOverride, originOverride, npcRegistryOverride,
    accessPackageOverride, accessOriginOverride, accessRegistryOverride,
    catapultPackageOverride, catapultOriginOverride, catapultRegistryOverride,
    industryPackageOverride, industryOriginOverride, industryRegistryOverride,
    transponderPackageOverride, transponderOriginOverride, transponderRegistryOverride,
    actionPackageOverride, actionOriginOverride, actionRegistryOverride,
    industryActionsPackageOverride, industryActionsOriginOverride, industryActionsRegistryOverride,
    logisticsPackageOverride, logisticsOriginOverride, logisticsRegistryOverride,
    infrastructurePackageOverride, infrastructureOriginOverride, infrastructureRegistryOverride,
    automationPackageOverride, automationOriginOverride, automationRegistryOverride,
    npcPackageId, npcTypeOrigin, npcRegistryId,
    accessPackageId, accessTypeOrigin, accessRegistryId,
    catapultPackageId, catapultTypeOrigin, catapultRegistryId,
    industryPackageId, industryTypeOrigin, industryRegistryId,
    transponderPackageId, transponderTypeOrigin, transponderRegistryId,
    actionPackageId, actionTypeOrigin, actionRegistryId,
    industryActionsPackageId, industryActionsTypeOrigin, industryActionsRegistryId,
    logisticsPackageId, logisticsTypeOrigin, logisticsRegistryId,
    infrastructurePackageId, infrastructureTypeOrigin, infrastructureRegistryId,
    automationPackageId, automationTypeOrigin, automationRegistryId,
  })).digest("hex");
  return {
    npcPackageId, npcTypeOrigin, npcRegistryId,
    accessPackageId, accessTypeOrigin, accessRegistryId,
    catapultPackageId, catapultTypeOrigin, catapultRegistryId,
    industryPackageId, industryTypeOrigin, industryRegistryId,
    transponderPackageId, transponderTypeOrigin, transponderRegistryId,
    actionPackageId, actionTypeOrigin, actionRegistryId,
    industryActionsPackageId, industryActionsTypeOrigin, industryActionsRegistryId,
    logisticsPackageId, logisticsTypeOrigin, logisticsRegistryId,
    infrastructurePackageId, infrastructureTypeOrigin, infrastructureRegistryId,
    automationPackageId, automationTypeOrigin, automationRegistryId,
    capabilities, factionCapabilities, defaultFactionCapabilities,
    factionConfigReferences, manifestFormat,
    fingerprint,
  };
}

export function isSuiWorldCapabilityEnabled(
  config: SuiNpcWorldConfig,
  capabilityName: string,
  factionKey?: string | null,
): boolean {
  if (!config.capabilities[capabilityName] ||
      config.capabilities[capabilityName].status === "unavailable") {
    return false;
  }
  const normalizedFactionKey = String(factionKey || "").trim().toLowerCase();
  const factionAllowlist = normalizedFactionKey
    ? config.factionCapabilities[normalizedFactionKey]
    : undefined;
  const effectiveAllowlist = factionAllowlist ?? config.defaultFactionCapabilities;
  return !effectiveAllowlist || effectiveAllowlist.includes(capabilityName);
}

export function requireSuiWorldCapability(
  config: SuiNpcWorldConfig,
  capabilityName: string,
  factionKey?: string | null,
) {
  if (!isSuiWorldCapabilityEnabled(config, capabilityName, factionKey)) {
    throw new Error(
      `Sui world capability ${capabilityName} is not deployed` +
      (factionKey ? ` for NPC faction ${factionKey}` : ""),
    );
  }
  return config.capabilities[capabilityName];
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
