const fs = require("fs");
const path = require("path");

const CONFIG_PATH = path.resolve(
  __dirname,
  "../../../npc-behavior.config.json",
);
const SUPPORTED_SCHEMA_VERSION = 2;
const RESERVED_BEHAVIOR_FIELDS = new Set([
  "behaviorProfileID",
  "name",
]);
const BOOLEAN_BEHAVIOR_FIELDS = new Set([
  "chaseTargets",
  "mineAsteroids",
  "guardAnchor",
  "retainTargetLockWhenOccluded",
  "fireThroughOccluders",
  "passiveRoaming",
  "passiveWarping",
]);

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function assertRecord(value, fieldName) {
  if (!isRecord(value)) {
    throw new TypeError(`${fieldName} must be an object`);
  }
  return value;
}

function nonEmptyText(value, fieldName) {
  const normalized = String(value == null ? "" : value).trim();
  if (!normalized) {
    throw new TypeError(`${fieldName} must be non-empty text`);
  }
  return normalized;
}

function cloneValue(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) {
    return value;
  }
  for (const child of Object.values<any>(value)) {
    deepFreeze(child);
  }
  return Object.freeze(value);
}

function normalizeStringArray(value, fieldName) {
  if (value == null) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new TypeError(`${fieldName} must be an array`);
  }
  const seen = new Set();
  return value.map((entry, index) => {
    const normalized = nonEmptyText(entry, `${fieldName}[${index}]`).toLowerCase();
    if (seen.has(normalized)) {
      throw new TypeError(`${fieldName} contains duplicate value: ${normalized}`);
    }
    seen.add(normalized);
    return normalized;
  });
}

function normalizeBehaviorFields(value, fieldName) {
  if (value == null) {
    return {};
  }
  const source = assertRecord(value, fieldName);
  for (const key of Object.keys(source)) {
    if (RESERVED_BEHAVIOR_FIELDS.has(key)) {
      throw new TypeError(`${fieldName}.${key} is reserved`);
    }
    if (BOOLEAN_BEHAVIOR_FIELDS.has(key) && typeof source[key] !== "boolean") {
      throw new TypeError(`${fieldName}.${key} must be a boolean`);
    }
  }
  return cloneValue(source);
}

function normalizeActivityOptions(value, fieldName) {
  if (value == null) {
    return {};
  }
  return cloneValue(assertRecord(value, fieldName));
}

function normalizeMatcher(value, fieldName) {
  const source = assertRecord(value, fieldName);
  const matcher = {
    all: source.all === true,
    profileIDs: normalizeStringArray(source.profileIDs, `${fieldName}.profileIDs`),
    profileIDPrefixes: normalizeStringArray(
      source.profileIDPrefixes,
      `${fieldName}.profileIDPrefixes`,
    ),
    profileIDContains: normalizeStringArray(
      source.profileIDContains,
      `${fieldName}.profileIDContains`,
    ),
    excludeProfileIDs: normalizeStringArray(
      source.excludeProfileIDs,
      `${fieldName}.excludeProfileIDs`,
    ),
    excludeProfileIDContains: normalizeStringArray(
      source.excludeProfileIDContains,
      `${fieldName}.excludeProfileIDContains`,
    ),
    behaviorProfileIDs: normalizeStringArray(
      source.behaviorProfileIDs,
      `${fieldName}.behaviorProfileIDs`,
    ),
    behaviorProfileIDPrefixes: normalizeStringArray(
      source.behaviorProfileIDPrefixes,
      `${fieldName}.behaviorProfileIDPrefixes`,
    ),
    loadoutIDs: normalizeStringArray(source.loadoutIDs, `${fieldName}.loadoutIDs`),
    loadoutIDPrefixes: normalizeStringArray(
      source.loadoutIDPrefixes,
      `${fieldName}.loadoutIDPrefixes`,
    ),
    entityTypes: normalizeStringArray(source.entityTypes, `${fieldName}.entityTypes`),
    behaviorAutoAggro:
      source.behaviorAutoAggro === undefined
        ? null
        : source.behaviorAutoAggro,
  };
  if (
    matcher.behaviorAutoAggro !== null &&
    typeof matcher.behaviorAutoAggro !== "boolean"
  ) {
    throw new TypeError(`${fieldName}.behaviorAutoAggro must be a boolean`);
  }
  const hasConstraint = Object.entries(matcher).some(([key, entry]) => (
    key === "all"
      ? entry === true
      : key === "behaviorAutoAggro"
        ? entry !== null
        : Array.isArray(entry) && entry.length > 0
  ));
  if (!hasConstraint) {
    throw new TypeError(`${fieldName} must contain at least one match constraint`);
  }
  return matcher;
}

function validateConfig(rawConfig) {
  const source = assertRecord(rawConfig, "NPC behavior config");
  const schemaVersion = Number(source.schemaVersion);
  if (!Number.isInteger(schemaVersion) || schemaVersion !== SUPPORTED_SCHEMA_VERSION) {
    throw new TypeError(
      `schemaVersion must be ${SUPPORTED_SCHEMA_VERSION}; received ${String(source.schemaVersion)}`,
    );
  }
  if (typeof source.enabled !== "boolean") {
    throw new TypeError("enabled must be a boolean");
  }

  const rawDefaults = assertRecord(source.defaults, "defaults");
  const defaultRole = nonEmptyText(rawDefaults.role, "defaults.role").toLowerCase();
  const defaults = {
    role: defaultRole,
    behaviorDefaults: normalizeBehaviorFields(
      rawDefaults.behaviorDefaults,
      "defaults.behaviorDefaults",
    ),
  };

  const rawRoles = assertRecord(source.roles, "roles");
  const roles: Record<string, any> = {};
  for (const [rawRoleID, rawRole] of Object.entries<any>(rawRoles)) {
    const roleID = nonEmptyText(rawRoleID, "roles key").toLowerCase();
    const role = assertRecord(rawRole, `roles.${roleID}`);
    roles[roleID] = {
      roleID,
      activity: nonEmptyText(role.activity, `roles.${roleID}.activity`).toLowerCase(),
      description: String(role.description || "").trim() || null,
      behaviorDefaults: normalizeBehaviorFields(
        role.behaviorDefaults,
        `roles.${roleID}.behaviorDefaults`,
      ),
      behaviorOverrides: normalizeBehaviorFields(
        role.behaviorOverrides,
        `roles.${roleID}.behaviorOverrides`,
      ),
      activityOptions: normalizeActivityOptions(
        role.activityOptions,
        `roles.${roleID}.activityOptions`,
      ),
    };
  }
  if (!roles[defaultRole]) {
    throw new TypeError(`defaults.role references unknown role: ${defaultRole}`);
  }

  if (!Array.isArray(source.rules)) {
    throw new TypeError("rules must be an array");
  }
  const ruleIDs = new Set();
  const rules = source.rules.map((rawRule, index) => {
    const fieldName = `rules[${index}]`;
    const rule = assertRecord(rawRule, fieldName);
    const id = nonEmptyText(rule.id, `${fieldName}.id`).toLowerCase();
    if (ruleIDs.has(id)) {
      throw new TypeError(`duplicate rule id: ${id}`);
    }
    ruleIDs.add(id);
    const role = rule.role == null
      ? null
      : nonEmptyText(rule.role, `${fieldName}.role`).toLowerCase();
    if (role && !roles[role]) {
      throw new TypeError(`${fieldName}.role references unknown role: ${role}`);
    }
    const priority = rule.priority == null ? 0 : Number(rule.priority);
    if (!Number.isFinite(priority)) {
      throw new TypeError(`${fieldName}.priority must be a finite number`);
    }
    return {
      id,
      priority,
      sourceIndex: index,
      match: normalizeMatcher(rule.match, `${fieldName}.match`),
      role,
      behaviorDefaults: normalizeBehaviorFields(
        rule.behaviorDefaults,
        `${fieldName}.behaviorDefaults`,
      ),
      behaviorOverrides: normalizeBehaviorFields(
        rule.behaviorOverrides,
        `${fieldName}.behaviorOverrides`,
      ),
      activityOptions: normalizeActivityOptions(
        rule.activityOptions,
        `${fieldName}.activityOptions`,
      ),
    };
  }).sort((left, right) => (
    left.priority - right.priority || left.sourceIndex - right.sourceIndex
  ));

  return deepFreeze({
    schemaVersion,
    enabled: source.enabled,
    defaults,
    roles,
    rules,
  });
}

function readConfig() {
  let payload;
  try {
    payload = fs.readFileSync(CONFIG_PATH, "utf8");
  } catch (error) {
    const message = error && error.message ? error.message : String(error);
    throw new Error(`Unable to read NPC behavior config at ${CONFIG_PATH}: ${message}`);
  }
  try {
    return validateConfig(JSON.parse(String(payload).replace(/^\uFEFF/, "")));
  } catch (error) {
    const message = error && error.message ? error.message : String(error);
    throw new Error(`Invalid NPC behavior config at ${CONFIG_PATH}: ${message}`);
  }
}

const CONFIG = readConfig();

function normalizeMatchText(value) {
  return String(value || "").trim().toLowerCase();
}

function matchesAnyExact(value, candidates) {
  return candidates.length === 0 || candidates.includes(value);
}

function matchesAnyPrefix(value, prefixes) {
  return prefixes.length === 0 || prefixes.some((prefix) => value.startsWith(prefix));
}

function matchesAnyContains(value, fragments) {
  return fragments.length === 0 || fragments.some((fragment) => value.includes(fragment));
}

function matcherApplies(matcher, definition) {
  const profile = definition && definition.profile || {};
  const loadout = definition && definition.loadout || {};
  const behaviorProfile = definition && definition.behaviorProfile || {};
  const profileID = normalizeMatchText(profile.profileID);
  const behaviorProfileID = normalizeMatchText(behaviorProfile.behaviorProfileID);
  const loadoutID = normalizeMatchText(loadout.loadoutID);
  const entityType = normalizeMatchText(profile.entityType || "npc");

  return (
    matchesAnyExact(profileID, matcher.profileIDs) &&
    matchesAnyPrefix(profileID, matcher.profileIDPrefixes) &&
    matchesAnyContains(profileID, matcher.profileIDContains) &&
    !matcher.excludeProfileIDs.includes(profileID) &&
    !matcher.excludeProfileIDContains.some((fragment) => profileID.includes(fragment)) &&
    matchesAnyExact(behaviorProfileID, matcher.behaviorProfileIDs) &&
    matchesAnyPrefix(behaviorProfileID, matcher.behaviorProfileIDPrefixes) &&
    matchesAnyExact(loadoutID, matcher.loadoutIDs) &&
    matchesAnyPrefix(loadoutID, matcher.loadoutIDPrefixes) &&
    matchesAnyExact(entityType, matcher.entityTypes) &&
    (
      matcher.behaviorAutoAggro === null ||
      behaviorProfile.autoAggro === matcher.behaviorAutoAggro
    )
  );
}

function resolveNpcBehaviorPolicy(definition) {
  const authoredBehavior = cloneValue(
    definition && definition.behaviorProfile || {},
  );
  if (!CONFIG.enabled) {
    return {
      role: "authored",
      activity: "authored",
      matchedRuleIDs: [],
      activityOptions: {},
      behaviorProfile: authoredBehavior,
    };
  }

  const matchedRules = CONFIG.rules.filter((rule) => (
    matcherApplies(rule.match, definition)
  ));
  const roleID = matchedRules.reduce(
    (currentRoleID, rule) => rule.role || currentRoleID,
    CONFIG.defaults.role,
  );
  const role = CONFIG.roles[roleID] || CONFIG.roles[CONFIG.defaults.role];
  const ruleBehaviorDefaults = Object.assign(
    {},
    ...matchedRules.map((rule) => rule.behaviorDefaults),
  );
  const ruleBehaviorOverrides = Object.assign(
    {},
    ...matchedRules.map((rule) => rule.behaviorOverrides),
  );
  const ruleActivityOptions = Object.assign(
    {},
    ...matchedRules.map((rule) => rule.activityOptions),
  );

  return {
    role: role.roleID,
    activity: role.activity,
    matchedRuleIDs: matchedRules.map((rule) => rule.id),
    activityOptions: {
      ...cloneValue(role.activityOptions),
      ...cloneValue(ruleActivityOptions),
    },
    behaviorProfile: {
      ...cloneValue(CONFIG.defaults.behaviorDefaults),
      ...cloneValue(role.behaviorDefaults),
      ...cloneValue(ruleBehaviorDefaults),
      ...authoredBehavior,
      ...cloneValue(role.behaviorOverrides),
      ...cloneValue(ruleBehaviorOverrides),
    },
  };
}

function applyNpcBehaviorConfig(definition) {
  if (!definition || typeof definition !== "object") {
    return definition;
  }
  if (
    definition.behaviorPolicy &&
    definition.behaviorPolicy.configSchemaVersion === CONFIG.schemaVersion
  ) {
    return definition;
  }
  const policy = resolveNpcBehaviorPolicy(definition);
  return {
    ...definition,
    behaviorProfile: policy.behaviorProfile,
    behaviorPolicy: {
      configSchemaVersion: CONFIG.schemaVersion,
      role: policy.role,
      activity: policy.activity,
      matchedRuleIDs: policy.matchedRuleIDs,
      activityOptions: policy.activityOptions,
    },
  };
}

function getConfig() {
  return cloneValue(CONFIG);
}

function getConfigSummary() {
  return {
    configPath: CONFIG_PATH,
    schemaVersion: CONFIG.schemaVersion,
    enabled: CONFIG.enabled,
    defaultRole: CONFIG.defaults.role,
    roleCount: Object.keys(CONFIG.roles).length,
    ruleCount: CONFIG.rules.length,
  };
}

module.exports = {
  CONFIG_PATH,
  SUPPORTED_SCHEMA_VERSION,
  validateConfig,
  getConfig,
  getConfigSummary,
  resolveNpcBehaviorPolicy,
  applyNpcBehaviorConfig,
};
