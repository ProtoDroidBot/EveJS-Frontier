const path = require("path");
const { randomUUID } = require("crypto");

const database = require(path.join(__dirname, "../../gameStore"));

const CONSTRUCTION_TEMPLATES_TABLE = "smartAssemblyConstructionTemplates";
const CONSTRUCTION_PLANS_TABLE = "smartAssemblyDeploymentPlans";
const CONSTRUCTION_TEMPLATE_SCHEMA_VERSION = 1;
const MAX_CONSTRUCTION_TEMPLATES_PER_PRINCIPAL = 100;

function cloneValue(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function toPositiveInt(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isSafeInteger(numeric) && numeric > 0 ? numeric : fallback;
}

function normalizePrincipal(value) {
  const kind = String(value && value.kind || "").trim().toLowerCase();
  const id = String(value && (value.id ?? value.actorID ?? value.ownerID) || "").trim();
  if (!["player", "npc", "faction"].includes(kind) || !id) return null;
  if (kind === "player" && !toPositiveInt(id, 0)) return null;
  return {
    kind,
    id,
    key: `${kind}:${id}`,
  };
}

function principalPath(principal) {
  const normalized = normalizePrincipal(principal);
  if (!normalized) return null;
  if (normalized.kind === "player") {
    return { ...normalized, group: "owners", rowKey: normalized.id };
  }
  return {
    ...normalized,
    group: "principals",
    rowKey: encodeURIComponent(normalized.key),
  };
}

function defaultRoot() {
  return {
    _meta: { version: CONSTRUCTION_TEMPLATE_SCHEMA_VERSION },
    owners: {},
    principals: {},
  };
}

function readRoot(table) {
  database.ensureTable(table);
  const result = database.read(table, "/");
  const root = result.success && result.data && typeof result.data === "object"
    ? cloneValue(result.data)
    : defaultRoot();
  if (!root._meta || typeof root._meta !== "object") {
    root._meta = { version: CONSTRUCTION_TEMPLATE_SCHEMA_VERSION };
  }
  root._meta.version = Math.max(
    CONSTRUCTION_TEMPLATE_SCHEMA_VERSION,
    toPositiveInt(root._meta.version, CONSTRUCTION_TEMPLATE_SCHEMA_VERSION),
  );
  if (!root.owners || typeof root.owners !== "object") root.owners = {};
  if (!root.principals || typeof root.principals !== "object") root.principals = {};
  return root;
}

function getBucket(root, principal, collection, create = false) {
  const resolved = principalPath(principal);
  if (!resolved) return null;
  let bucket = root[resolved.group] && root[resolved.group][resolved.rowKey];
  if ((!bucket || typeof bucket !== "object") && create) {
    bucket = {
      principal: { kind: resolved.kind, id: resolved.id },
      [collection]: {},
    };
    root[resolved.group][resolved.rowKey] = bucket;
  }
  if (bucket && (!bucket[collection] || typeof bucket[collection] !== "object")) {
    bucket[collection] = {};
  }
  return bucket ? { bucket, resolved } : null;
}

function writeBucket(table, principal, bucket) {
  const resolved = principalPath(principal);
  if (!resolved) return { success: false as const, errorMsg: "INVALID_TEMPLATE_PRINCIPAL" };
  const writeResult = database.write(
    table,
    `/${resolved.group}/${resolved.rowKey}`,
    cloneValue(bucket),
  );
  if (!writeResult.success) return writeResult;
  const flushResult = database.flushTablesSync([table]);
  return flushResult && flushResult.success === true
    ? { success: true as const }
    : { success: false as const, errorMsg: "PERSISTENCE_FLUSH_ERROR" };
}

function listConstructionTemplates(principal) {
  const entry = getBucket(
    readRoot(CONSTRUCTION_TEMPLATES_TABLE),
    principal,
    "templates",
    false,
  );
  return Object.values<any>(entry && entry.bucket.templates || {})
    .map(cloneValue)
    .sort((left, right) => (
      Number(right.updatedAtMs || 0) - Number(left.updatedAtMs || 0) ||
      String(left.name || "").localeCompare(String(right.name || ""))
    ));
}

function getConstructionTemplate(principal, templateID) {
  const entry = getBucket(
    readRoot(CONSTRUCTION_TEMPLATES_TABLE),
    principal,
    "templates",
    false,
  );
  return cloneValue(entry && entry.bucket.templates[String(templateID || "")] || null);
}

function createConstructionTemplate(principal, value, options: Record<string, any> = {}) {
  const root = readRoot(CONSTRUCTION_TEMPLATES_TABLE);
  const entry = getBucket(root, principal, "templates", true);
  if (!entry) return { success: false as const, errorMsg: "INVALID_TEMPLATE_PRINCIPAL" };
  if (Object.keys(entry.bucket.templates).length >= MAX_CONSTRUCTION_TEMPLATES_PER_PRINCIPAL) {
    return { success: false as const, errorMsg: "CONSTRUCTION_TEMPLATE_LIMIT_REACHED" };
  }
  const templateID = String(options.templateID || randomUUID()).trim();
  if (!templateID || entry.bucket.templates[templateID]) {
    return { success: false as const, errorMsg: "CONSTRUCTION_TEMPLATE_ID_CONFLICT" };
  }
  const nowMs = Math.max(0, Number(options.nowMs) || Date.now());
  const record = cloneValue({
    ...value,
    templateID,
    principal: { kind: entry.resolved.kind, id: entry.resolved.id },
    schemaVersion: CONSTRUCTION_TEMPLATE_SCHEMA_VERSION,
    revision: 1,
    createdAtMs: nowMs,
    updatedAtMs: nowMs,
  });
  entry.bucket.templates[templateID] = record;
  const written = writeBucket(CONSTRUCTION_TEMPLATES_TABLE, principal, entry.bucket);
  return written.success ? { success: true as const, data: cloneValue(record) } : written;
}

function updateConstructionTemplate(
  principal,
  templateID,
  value,
  expectedRevision = null,
  options: Record<string, any> = {},
) {
  const root = readRoot(CONSTRUCTION_TEMPLATES_TABLE);
  const entry = getBucket(root, principal, "templates", false);
  const key = String(templateID || "");
  const current = entry && entry.bucket.templates[key];
  if (!current) return { success: false as const, errorMsg: "CONSTRUCTION_TEMPLATE_NOT_FOUND" };
  if (expectedRevision != null && Number(expectedRevision) !== Number(current.revision)) {
    return { success: false as const, errorMsg: "CONSTRUCTION_TEMPLATE_REVISION_CONFLICT" };
  }
  const updated = cloneValue({
    ...value,
    templateID: key,
    principal: cloneValue(current.principal),
    schemaVersion: CONSTRUCTION_TEMPLATE_SCHEMA_VERSION,
    revision: Number(current.revision || 0) + 1,
    createdAtMs: Number(current.createdAtMs || 0),
    updatedAtMs: Math.max(0, Number(options.nowMs) || Date.now()),
  });
  entry.bucket.templates[key] = updated;
  const written = writeBucket(CONSTRUCTION_TEMPLATES_TABLE, principal, entry.bucket);
  return written.success ? { success: true as const, data: cloneValue(updated) } : written;
}

function deleteConstructionTemplate(principal, templateID) {
  const root = readRoot(CONSTRUCTION_TEMPLATES_TABLE);
  const entry = getBucket(root, principal, "templates", false);
  const key = String(templateID || "");
  if (!entry || !entry.bucket.templates[key]) {
    return { success: false as const, errorMsg: "CONSTRUCTION_TEMPLATE_NOT_FOUND" };
  }
  delete entry.bucket.templates[key];
  const written = writeBucket(CONSTRUCTION_TEMPLATES_TABLE, principal, entry.bucket);
  return written.success ? { success: true as const, data: { templateID: key } } : written;
}

function listConstructionPlans(principal) {
  const entry = getBucket(
    readRoot(CONSTRUCTION_PLANS_TABLE),
    principal,
    "plans",
    false,
  );
  return Object.values<any>(entry && entry.bucket.plans || {})
    .map(cloneValue)
    .sort((left, right) => Number(left.createdAtMs || 0) - Number(right.createdAtMs || 0));
}

function getConstructionPlan(principal, planID) {
  const entry = getBucket(
    readRoot(CONSTRUCTION_PLANS_TABLE),
    principal,
    "plans",
    false,
  );
  return cloneValue(entry && entry.bucket.plans[String(planID || "")] || null);
}

function createConstructionPlan(principal, value, options: Record<string, any> = {}) {
  const root = readRoot(CONSTRUCTION_PLANS_TABLE);
  const entry = getBucket(root, principal, "plans", true);
  if (!entry) return { success: false as const, errorMsg: "INVALID_TEMPLATE_PRINCIPAL" };
  const planID = String(options.planID || randomUUID()).trim();
  if (!planID || entry.bucket.plans[planID]) {
    return { success: false as const, errorMsg: "CONSTRUCTION_PLAN_ID_CONFLICT" };
  }
  const nowMs = Math.max(0, Number(options.nowMs) || Date.now());
  const record = cloneValue({
    ...value,
    planID,
    principal: { kind: entry.resolved.kind, id: entry.resolved.id },
    revision: 1,
    createdAtMs: nowMs,
    updatedAtMs: nowMs,
  });
  entry.bucket.plans[planID] = record;
  const written = writeBucket(CONSTRUCTION_PLANS_TABLE, principal, entry.bucket);
  return written.success ? { success: true as const, data: cloneValue(record) } : written;
}

function updateConstructionPlan(principal, planID, changes, options: Record<string, any> = {}) {
  const root = readRoot(CONSTRUCTION_PLANS_TABLE);
  const entry = getBucket(root, principal, "plans", false);
  const key = String(planID || "");
  const current = entry && entry.bucket.plans[key];
  if (!current) return { success: false as const, errorMsg: "CONSTRUCTION_PLAN_NOT_FOUND" };
  const record = cloneValue({
    ...current,
    ...changes,
    planID: key,
    principal: cloneValue(current.principal),
    revision: Number(current.revision || 0) + 1,
    createdAtMs: Number(current.createdAtMs || 0),
    updatedAtMs: Math.max(0, Number(options.nowMs) || Date.now()),
  });
  entry.bucket.plans[key] = record;
  const written = writeBucket(CONSTRUCTION_PLANS_TABLE, principal, entry.bucket);
  return written.success ? { success: true as const, data: cloneValue(record) } : written;
}

module.exports = {
  CONSTRUCTION_PLANS_TABLE,
  CONSTRUCTION_TEMPLATES_TABLE,
  CONSTRUCTION_TEMPLATE_SCHEMA_VERSION,
  MAX_CONSTRUCTION_TEMPLATES_PER_PRINCIPAL,
  createConstructionPlan,
  createConstructionTemplate,
  deleteConstructionTemplate,
  getConstructionPlan,
  getConstructionTemplate,
  listConstructionPlans,
  listConstructionTemplates,
  normalizePrincipal,
  updateConstructionPlan,
  updateConstructionTemplate,
};
