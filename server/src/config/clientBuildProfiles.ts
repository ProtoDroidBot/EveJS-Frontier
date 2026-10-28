export type ClientFeatureState = "C" | "D" | "A" | "U";
export type ClientBlockchainProtocol = "evm" | "sui" | "unknown";
export type ClientBlockchainSigning = "blockchain-proxy" | "erc2771" | "sui";
export type ServerBuildFeature = "publicGatewayContracts" | "economy" | "voxelMining" | "progression";

export interface ClientBlockchainProfile {
  readonly protocol: ClientBlockchainProtocol;
  readonly signing: ClientBlockchainSigning;
  readonly evidence: readonly string[];
  readonly qualification: string;
  readonly requirementsEvidence: string;
  readonly requirementsProfileId: string;
}

export interface ClientBuildProfile {
  readonly id: string;
  readonly clientCompatibilityProfile: "frontier" | "tranquility";
  readonly clientBuild: number;
  readonly clientVersion: number;
  readonly clientBranch: string;
  readonly clientCodename: string;
  readonly machoVersion: number;
  readonly installationProfile: string;
  readonly evidence: string;
  readonly report: string;
  readonly missingIndexedStaticPayloadCount: number;
  readonly blockchain: ClientBlockchainProfile;
  readonly features: Readonly<Record<string, ClientFeatureState>>;
}

export interface ClientBuildCatalog {
  readonly format: string;
  readonly baselineProfileId: string;
  readonly observationScope: string;
  readonly sourceEvidence: string;
  readonly identityEvidence: string;
  readonly featureStates: Readonly<Record<ClientFeatureState, string>>;
  readonly features: Readonly<Record<string, {
    readonly label: string;
    readonly scope: string;
    readonly qualification?: string;
  }>>;
  readonly profiles: readonly ClientBuildProfile[];
}

export interface ServerBuildFeatureDefinition {
  readonly builds: readonly number[];
  readonly description: string;
}

function deepFreeze<T>(value: T): Readonly<T> {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

// Keep the small runtime catalog independent of reports, extracted archives,
// local installations and config/index (which imports this module).
const catalog = deepFreeze<ClientBuildCatalog>(require("./clientBuildCatalog.json"));
const profiles: readonly ClientBuildProfile[] = catalog.profiles;
const byId = new Map(profiles.map(profile => [profile.id, profile]));
const byBuild = new Map(profiles.map(profile => [profile.clientBuild, profile]));

// These are implementation boundaries, not assertions of complete support.
// Add builds only after checking the specific descriptors/runtime/catalogs.
const SERVER_BUILD_FEATURES: Readonly<Record<ServerBuildFeature, ServerBuildFeatureDefinition>> = deepFreeze({
  publicGatewayContracts: { builds: [3640684], description: "Exact shared public-gateway descriptors for build 3640684." },
  economy: { builds: [3640684], description: "Build-specific economy gateway implementation." },
  voxelMining: { builds: [3640684], description: "Composite/voxel mining runtime; mining configuration must also enable it." },
  progression: { builds: [3640684], description: "Build-specific progression dogma modifiers." },
});

export function listClientBuildProfiles(): readonly ClientBuildProfile[] {
  return profiles;
}

export function getClientBuildCatalog() {
  return catalog;
}

export function getClientBuildProfile(id: string): ClientBuildProfile {
  const profile = byId.get(id);
  if (!profile) throw new RangeError(`Unknown client build profile: ${String(id)}`);
  return profile;
}

export function getClientBuildProfileForBuild(build: unknown): ClientBuildProfile | null {
  const numeric = Number(build);
  return Number.isSafeInteger(numeric) && numeric > 0 ? byBuild.get(numeric) || null : null;
}

function getSelection(runtimeConfig: Record<string, any>): string {
  const selection = runtimeConfig.clientBuildProfile === undefined ? "auto" : runtimeConfig.clientBuildProfile;
  if (typeof selection !== "string" || !selection.trim()) {
    throw new TypeError("clientBuildProfile must be auto or a registered profile ID.");
  }
  return selection.trim();
}

export function resolveClientBuildProfile(runtimeConfig: Record<string, any>): ClientBuildProfile | null {
  const selection = getSelection(runtimeConfig);
  if (selection !== "auto") return getClientBuildProfile(selection);
  // Uncatalogued builds keep their existing behavior. Never pick a nearest
  // build: feature presence and schemas can diverge between branches.
  const profile = getClientBuildProfileForBuild(runtimeConfig.clientBuild);
  return profile?.clientCompatibilityProfile === runtimeConfig.clientCompatibilityProfile ? profile : null;
}

/** Packaged wallet protocol, selected by exact profile rather than release ordering. */
export function getClientBlockchainProtocol(buildOrConfig: unknown): ClientBlockchainProtocol {
  const profile = buildOrConfig && typeof buildOrConfig === "object"
    ? resolveClientBuildProfile(buildOrConfig as Record<string, any>)
    : typeof buildOrConfig === "string" && byId.has(buildOrConfig)
      ? byId.get(buildOrConfig)
      : getClientBuildProfileForBuild(buildOrConfig);
  return profile?.blockchain.protocol || "unknown";
}

export function applyClientBuildProfile(runtimeConfig: Record<string, any>): Record<string, any> {
  const selection = getSelection(runtimeConfig);
  if (selection === "auto") return { ...runtimeConfig, clientBuildProfile: "auto" };
  const profile = getClientBuildProfile(selection);
  // Explicit selection owns audited identity fields. Birthday, region, data
  // paths and operational feature switches remain operator configuration.
  return {
    ...runtimeConfig,
    clientBuildProfile: profile.id,
    clientCompatibilityProfile: profile.clientCompatibilityProfile,
    clientBuild: profile.clientBuild,
    clientVersion: profile.clientVersion,
    machoVersion: profile.machoVersion,
    projectCodename: profile.clientCodename,
    projectVersion: `V${profile.clientVersion.toFixed(2)}@${runtimeConfig.projectRegion || "ccp"}`,
  };
}

export function getClientFeatureState(build: unknown, feature: string): ClientFeatureState {
  if (!Object.prototype.hasOwnProperty.call(catalog.features, feature)) {
    throw new RangeError(`Unknown client feature: ${feature}`);
  }
  const profile = typeof build === "string" && byId.has(build)
    ? byId.get(build)
    : getClientBuildProfileForBuild(build);
  return profile?.features[feature] || "U";
}

export function hasServerBuildFeature(build: unknown, feature: ServerBuildFeature): boolean {
  if (!Object.prototype.hasOwnProperty.call(SERVER_BUILD_FEATURES, feature)) {
    throw new RangeError(`Unknown server build feature: ${String(feature)}`);
  }
  return SERVER_BUILD_FEATURES[feature].builds.includes(Number(build));
}

export function getServerBuildFeatures(build: unknown): Readonly<Record<ServerBuildFeature, boolean>> {
  return Object.freeze(Object.fromEntries(
    Object.keys(SERVER_BUILD_FEATURES).map(feature => [feature, hasServerBuildFeature(build, feature as ServerBuildFeature)]),
  )) as Readonly<Record<ServerBuildFeature, boolean>>;
}

export function getServerBuildFeatureDefinitions() {
  return SERVER_BUILD_FEATURES;
}
