import { evmAddress, evmKeccakHex, evmUint256 } from "./legacyEvmAuthorization";
import { getLegacyEvmBuildAdapter } from "./legacyEvmBuildAdapters";

const LIFECYCLE_METHODS = ["bringOnline", "bringOffline"] as const;
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const ZERO_SYSTEM = `0x${"00".repeat(32)}`;

function invalid(): never { throw new TypeError("INVALID_LEGACY_EVM_CONFIG"); }

/** Exact branch hashing; the original two-argument API retains native ABI hashing. */
export function deriveLegacyEvmSmartObjectID(tenant: string, gameItemID: unknown, build?: unknown): string {
  if (typeof tenant !== "string" || !tenant.trim() || Buffer.byteLength(tenant) > 1024) invalid();
  const id = evmUint256(gameItemID);
  if (id === "0") invalid();
  const adapter = build === undefined ? null : getLegacyEvmBuildAdapter(build);
  // The proxy wire API carries game item/anima IDs directly.
  if (adapter?.workflow === "proxy") return id;
  if (adapter?.objectIdMode === "text") {
    return BigInt(evmKeccakHex(Buffer.from(`item:${tenant}-${id}`, "utf8"))).toString();
  }
  const tenantHash = Buffer.from(evmKeccakHex(Buffer.from(tenant, "utf8")).slice(2), "hex");
  const encodedID = Buffer.from(BigInt(id).toString(16).padStart(64, "0"), "hex");
  return BigInt(evmKeccakHex(Buffer.concat([tenantHash, encodedID]))).toString();
}

export interface LegacyEvmABIInput {
  name: string;
  type: string;
  components?: LegacyEvmABIInput[];
}

function functionABI(name: string, inputs: LegacyEvmABIInput[], outputs: LegacyEvmABIInput[] = []) {
  return { type: "function", name, stateMutability: "nonpayable", inputs, outputs };
}

/** Names and tuple ordering match each shipped client's create-character payload. */
export function getLegacyEvmCreateCharacterABI(build: unknown) {
  const adapter = getLegacyEvmBuildAdapter(build);
  if (adapter.workflow !== "erc2771") invalid();
  const metadata: LegacyEvmABIInput[] = [
    { name: "name", type: "string" }, { name: "dappURL", type: "string" },
    { name: "description", type: "string" },
  ];
  const record: LegacyEvmABIInput[] = [
    { name: "typeId", type: "uint256" }, { name: "itemId", type: "uint256" },
    { name: "volume", type: "uint256" },
  ];
  if (adapter.characterCreation === "tenant-record") {
    return functionABI("createCharacter", [
      { name: "smartObjectId", type: "uint256" }, { name: "owner", type: "address" },
      { name: "tribeId", type: "uint256" },
      { name: "entityRecordParams", type: "tuple", components: [{ name: "tenantId", type: "bytes32" }, ...record] },
      { name: "entityRecordMetadata", type: "tuple", components: metadata },
    ]);
  }
  return functionABI("createCharacter", [
    { name: "characterId", type: "uint256" }, { name: "characterAddress", type: "address" },
    ...(adapter.characterCreation === "record-with-corp" ? [{ name: "corpId", type: "uint256" }] : []),
    { name: "entityRecord", type: "tuple", components: record },
    { name: "entityRecordOffchain", type: "tuple", components: metadata },
    { name: "tokenCid", type: "string" },
  ]);
}

function abiType(input: LegacyEvmABIInput, names: boolean): string {
  const type = input.type === "tuple"
    ? `(${(input.components || []).map(value => abiType(value, names)).join(",")})`
    : input.type;
  return names && input.name ? `${type} ${input.name}` : type;
}

export function getLegacyEvmCreateCharacterSignature(build: unknown): string {
  const abi = getLegacyEvmCreateCharacterABI(build);
  return `${abi.name}(${abi.inputs.map(value => abiType(value, false)).join(",")})`;
}

function publicURL(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) invalid();
  try { if (!["http:", "https:"].includes(new URL(value).protocol)) invalid(); }
  catch { invalid(); }
  return value;
}

/** Native JSON ABI and Python configuration shapes selected by exact audited build. */
export function buildLegacyEvmClientConfig(config: Record<string, any>) {
  if (!config) invalid();
  // Preserve compatibility with existing callers of the original generator.
  const adapter = getLegacyEvmBuildAdapter(config.clientBuild ?? 2973163);
  if (adapter.workflow === "proxy") {
    const blockchainID = Number(evmUint256(config.proxy?.blockchainId ?? 3537357));
    if (!Number.isSafeInteger(blockchainID) || blockchainID <= 0) invalid();
    return {
      cfg: "[]", systems: [], system_ids: {},
      blockchain_id: blockchainID,
      blockchain_proxy_jsonrpc_url: publicURL(config.proxy?.jsonRpcUrl),
      vault_dapp_url: String(config.vaultDappUrl || ""), base_dapp_url: String(config.baseDappUrl || ""),
    };
  }
  if (!config.domain || !config.systems) invalid();
  const chainID = Number(evmUint256(config.domain.chainId));
  if (!Number.isSafeInteger(chainID) || chainID <= 0) invalid();
  if (config.domain.name !== "ERC2771Forwarder" || config.domain.version !== "1") invalid();
  const world = evmAddress(config.worldAddress);
  const forwarder = evmAddress(config.domain.verifyingContract);
  const rpcURL = publicURL(config.rpcUrl || config.worldApiBaseUrl);
  const abi = LIFECYCLE_METHODS.filter(name => config.systems[name])
    .map(name => functionABI(name, [{ name: adapter.lifecycleArgument, type: "uint256" }]));
  if (!abi.length) invalid();
  if (config.systems.createCharacter) abi.push(getLegacyEvmCreateCharacterABI(adapter.clientBuild));
  const functions = [...abi];
  abi.push(functionABI("callFrom", [
    { name: "delegator", type: "address" }, { name: "systemId", type: "bytes32" },
    { name: "callData", type: "bytes" },
  ], [{ name: "", type: "bytes" }]));
  const systemIDs: Record<string, string> = { transfer: ZERO_SYSTEM };
  const systems = functions.map(fn => {
    const systemID = config.systems[fn.name].systemId;
    if (typeof systemID !== "string" || !/^0x[0-9a-f]{64}$/i.test(systemID)) invalid();
    systemIDs[fn.name] = systemID.toLowerCase();
    return { systemId: systemID.toLowerCase(),
      abi: [`function ${fn.name}(${fn.inputs.map(value => abiType(value, true)).join(",")})`] };
  });
  const entry = (name: string, address: string, contractABI: any[], extra: Record<string, any> = {}): Record<string, any> => ({
    name, chain_id: chainID, deployed_to: address, urls: { public: [rpcURL] }, abi: contractABI, ...extra,
  });
  const worldEntry = entry("IWorld", world, abi);
  const forwarderEntry = entry("ERC2771Forwarder", forwarder, [],
    { eip712: { name: config.domain.name, version: config.domain.version } });
  const cfg = adapter.cfgShape === "named-three"
    ? [worldEntry, forwarderEntry, entry("ERC20", ZERO_ADDRESS, [])]
    : [forwarderEntry, worldEntry];
  return {
    cfg: adapter.cfgShape === "json-string" ? JSON.stringify(cfg) : cfg,
    // Direct-ID readers consume system_ids; ABI readers discover these from systems.
    systems,
    system_ids: systemIDs,
    vault_dapp_url: String(config.vaultDappUrl || ""),
    base_dapp_url: String(config.baseDappUrl || ""),
    exchange_wallet_address: ZERO_ADDRESS,
    EVE_to_LUX_exchange_rate: 1,
  };
}
