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
      if (!raw || typeof raw !== "object" || Array.isArray(raw) ||
          (raw.schemaVersion !== 1 && raw.schemaVersion !== 2 && raw.schemaVersion !== 3)) {
        throw new Error("NPC deployment config has an unsupported schema");
      }
      // Validate the whole file even when environment overrides take priority.
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
  const accessPackageId = accessPackageOverride ?? file?.accessPackageId ?? npcPackageId;
  const accessTypeOrigin = accessOriginOverride ?? file?.accessTypeOrigin ?? accessPackageId;
  const accessRegistryId = accessRegistryOverride ?? file?.accessRegistryId ?? world.objectRegistryId;
  const catapultPackageId = catapultPackageOverride ?? file?.catapultPackageId ?? world.worldPackageId;
  const catapultTypeOrigin = catapultOriginOverride ?? file?.catapultTypeOrigin ?? catapultPackageId;
  const catapultRegistryId = catapultRegistryOverride ?? file?.catapultRegistryId ?? world.objectRegistryId;
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
  const fingerprint = createHash("sha256").update(JSON.stringify({
    world, file, packageOverride, originOverride, npcRegistryOverride,
    accessPackageOverride, accessOriginOverride, accessRegistryOverride,
    catapultPackageOverride, catapultOriginOverride, catapultRegistryOverride,
    transponderPackageOverride, transponderOriginOverride, transponderRegistryOverride,
    actionPackageOverride, actionOriginOverride, actionRegistryOverride,
    industryActionsPackageOverride, industryActionsOriginOverride, industryActionsRegistryOverride,
    logisticsPackageOverride, logisticsOriginOverride, logisticsRegistryOverride,
    infrastructurePackageOverride, infrastructureOriginOverride, infrastructureRegistryOverride,
    automationPackageOverride, automationOriginOverride, automationRegistryOverride,
    npcPackageId, npcTypeOrigin, npcRegistryId,
    accessPackageId, accessTypeOrigin, accessRegistryId,
    catapultPackageId, catapultTypeOrigin, catapultRegistryId,
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
    transponderPackageId, transponderTypeOrigin, transponderRegistryId,
    actionPackageId, actionTypeOrigin, actionRegistryId,
    industryActionsPackageId, industryActionsTypeOrigin, industryActionsRegistryId,
    logisticsPackageId, logisticsTypeOrigin, logisticsRegistryId,
    infrastructurePackageId, infrastructureTypeOrigin, infrastructureRegistryId,
    automationPackageId, automationTypeOrigin, automationRegistryId,
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
