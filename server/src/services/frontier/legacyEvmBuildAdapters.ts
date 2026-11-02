export type LegacyEvmWorkflow = "proxy" | "erc2771";
export type LegacyEvmConfigShape = "proxy-jsonrpc" | "json-string" | "ordered-two" | "named-three";
export type LegacyEvmSystemIdMode = "none" | "direct" | "abi";
export type LegacyEvmObjectIdMode = "plain" | "text" | "abi";

export interface LegacyEvmBuildAdapter {
  readonly clientBuild: number;
  readonly workflow: LegacyEvmWorkflow;
  readonly cfgShape: LegacyEvmConfigShape;
  readonly systemIdMode: LegacyEvmSystemIdMode;
  readonly lifecycleArgument: "item_id" | "entityId" | "smartObjectId";
  readonly objectIdMode: LegacyEvmObjectIdMode;
  readonly requiresWorldApi: boolean;
  readonly bootstrapMode: "proxy" | "combined" | "split";
  readonly recoveryMode: "proxy" | "server-encrypted" | "local" | "external";
  readonly characterCreation: "proxy" | "record" | "record-with-corp" | "tenant-record";
  readonly evidence: string;
}

const EVIDENCE = "docs/client-builds/evidence/blockchain-requirements.json";

function adapter(clientBuild: number, values: Omit<LegacyEvmBuildAdapter, "clientBuild" | "evidence">): LegacyEvmBuildAdapter {
  return Object.freeze({ clientBuild, ...values, evidence: EVIDENCE });
}

const ordered = {
  workflow: "erc2771", cfgShape: "ordered-two", systemIdMode: "direct",
  lifecycleArgument: "entityId", objectIdMode: "text", requiresWorldApi: false,
  bootstrapMode: "split", recoveryMode: "local", characterCreation: "record-with-corp",
} as const;
const native = {
  workflow: "erc2771", cfgShape: "named-three", systemIdMode: "abi",
  lifecycleArgument: "smartObjectId", objectIdMode: "abi", requiresWorldApi: false,
  bootstrapMode: "split", recoveryMode: "local", characterCreation: "tenant-record",
} as const;

// These are exact audited branches. In particular Nova 2884873 and Stillness
// 2898485 use different object hashes and configuration readers.
const adapters: readonly LegacyEvmBuildAdapter[] = Object.freeze([
  adapter(2455427, { workflow: "proxy", cfgShape: "proxy-jsonrpc", systemIdMode: "none",
    lifecycleArgument: "item_id", objectIdMode: "plain", requiresWorldApi: false,
    bootstrapMode: "proxy", recoveryMode: "proxy", characterCreation: "proxy" }),
  adapter(2615573, { workflow: "erc2771", cfgShape: "json-string", systemIdMode: "direct",
    lifecycleArgument: "entityId", objectIdMode: "text", requiresWorldApi: false,
    bootstrapMode: "combined", recoveryMode: "server-encrypted", characterCreation: "record" }),
  adapter(2702949, ordered),
  adapter(2703993, ordered),
  adapter(2726651, ordered),
  adapter(2730628, ordered),
  adapter(2742057, ordered),
  adapter(2763641, ordered),
  adapter(2814770, ordered),
  adapter(2884873, native),
  adapter(2898485, { ...ordered, cfgShape: "named-three" }),
  adapter(2973163, { ...native, requiresWorldApi: true }),
  adapter(2997426, { ...native, requiresWorldApi: true }),
  adapter(3122254, { ...native, requiresWorldApi: true, recoveryMode: "external" }),
]);
const byBuild = new Map(adapters.map(value => [value.clientBuild, value]));

export function listLegacyEvmBuildAdapters(): readonly LegacyEvmBuildAdapter[] {
  return adapters;
}

export function getLegacyEvmBuildAdapter(build: unknown): LegacyEvmBuildAdapter {
  const value = byBuild.get(Number(build));
  if (!value) throw new RangeError(`Unsupported EVM client build: ${String(build)}`);
  return value;
}
