import { secp256k1 } from "@noble/curves/secp256k1.js";
import { keccak_256 } from "@noble/hashes/sha3.js";

export type EvmUint = string | number | bigint;
export interface LegacyEvmDomain {
  name: "ERC2771Forwarder";
  version: "1";
  chainId: EvmUint;
  verifyingContract: string;
}
export interface LegacyEvmForwardRequest {
  from: string;
  to: string;
  value: EvmUint;
  gas: EvmUint;
  nonce: EvmUint;
  deadline: EvmUint;
  data: string;
}

const DOMAIN_FIELDS = Object.freeze([
  Object.freeze({ name: "name", type: "string" }),
  Object.freeze({ name: "version", type: "string" }),
  Object.freeze({ name: "chainId", type: "uint256" }),
  Object.freeze({ name: "verifyingContract", type: "address" }),
]);
const REQUEST_FIELDS = Object.freeze([
  Object.freeze({ name: "from", type: "address" }),
  Object.freeze({ name: "to", type: "address" }),
  Object.freeze({ name: "value", type: "uint256" }),
  Object.freeze({ name: "gas", type: "uint256" }),
  Object.freeze({ name: "nonce", type: "uint256" }),
  Object.freeze({ name: "deadline", type: "uint48" }),
  Object.freeze({ name: "data", type: "bytes" }),
]);
export const LEGACY_EVM_TYPED_DATA_TYPES = Object.freeze({
  EIP712Domain: DOMAIN_FIELDS,
  ForwardRequest: REQUEST_FIELDS,
});
export interface LegacyEvmTypedData {
  types: typeof LEGACY_EVM_TYPED_DATA_TYPES;
  primaryType: "ForwardRequest";
  domain: LegacyEvmDomain;
  message: LegacyEvmForwardRequest;
}

const UINT256_MAX = (1n << 256n) - 1n;
const UINT48_MAX = (1n << 48n) - 1n;
const MAX_CALL_DATA_BYTES = 256 * 1024;
function invalid(): never { throw new TypeError("INVALID_LEGACY_EVM_AUTHORIZATION"); }

function exactKeys(value: unknown, keys: readonly string[]): asserts value is Record<string, any> {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid();
  const actual = Object.keys(value);
  if (actual.length !== keys.length || actual.some(key => !keys.includes(key))) invalid();
}

/** Addresses are Ethereum's 20 bytes; a padded Sui address is never accepted. */
export function evmAddress(value: unknown): string {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(value)) invalid();
  return value.toLowerCase();
}

function hexBytes(value: unknown, size?: number): Buffer {
  if (typeof value !== "string" || value.length > MAX_CALL_DATA_BYTES * 2 + 2 ||
      !/^0x(?:[0-9a-fA-F]{2})*$/.test(value)) invalid();
  const bytes = Buffer.from(value.slice(2), "hex");
  if (size !== undefined && bytes.length !== size) invalid();
  return bytes;
}

/** Preserve integers exactly instead of passing 256-bit values through Number. */
export function evmUint256(value: unknown): string {
  let numeric: bigint;
  if (typeof value === "bigint") numeric = value;
  else if (typeof value === "number" && Number.isSafeInteger(value)) numeric = BigInt(value);
  else if (typeof value === "string" && value.length <= 78 && /^(0|[1-9][0-9]*)$/.test(value)) numeric = BigInt(value);
  else invalid();
  if (numeric < 0n || numeric > UINT256_MAX) invalid();
  return numeric.toString();
}

/** Retail produces a 32-byte keccak hex nonce but the EIP-712 field is uint256. */
export function evmNonce(value: unknown): string {
  if (typeof value === "string" && /^0x[0-9a-fA-F]{64}$/.test(value)) return BigInt(value).toString();
  return evmUint256(value);
}

export function evmKeccakHex(value: Uint8Array): string {
  return `0x${Buffer.from(keccak_256(value)).toString("hex")}`;
}

function normalizeDomain(value: unknown): LegacyEvmDomain {
  exactKeys(value, ["name", "version", "chainId", "verifyingContract"]);
  if (value.name !== "ERC2771Forwarder" || value.version !== "1") invalid();
  const chainId = typeof value.chainId === "string" && /^0x[0-9a-f]{1,64}$/i.test(value.chainId)
    ? BigInt(value.chainId) : value.chainId;
  return { name: value.name, version: value.version, chainId: evmUint256(chainId),
    verifyingContract: evmAddress(value.verifyingContract) };
}

function normalizeRequest(value: unknown): LegacyEvmForwardRequest {
  exactKeys(value, REQUEST_FIELDS.map(field => field.name));
  const deadline = evmUint256(value.deadline);
  if (BigInt(deadline) > UINT48_MAX) invalid();
  return {
    from: evmAddress(value.from), to: evmAddress(value.to), value: evmUint256(value.value),
    gas: evmUint256(value.gas), nonce: evmNonce(value.nonce),
    deadline, data: `0x${hexBytes(value.data).toString("hex")}`,
  };
}

/** This is one audited schema, not an arbitrary EIP-712 interpreter. */
export function createLegacyEvmTypedData(domain: LegacyEvmDomain, request: LegacyEvmForwardRequest): LegacyEvmTypedData {
  return { types: LEGACY_EVM_TYPED_DATA_TYPES, primaryType: "ForwardRequest",
    domain: normalizeDomain(domain), message: normalizeRequest(request) };
}

function normalizeTypedData(value: unknown): LegacyEvmTypedData {
  exactKeys(value, ["types", "primaryType", "domain", "message"]);
  if (value.primaryType !== "ForwardRequest") invalid();
  exactKeys(value.types, ["EIP712Domain", "ForwardRequest"]);
  for (const [name, fields] of Object.entries(LEGACY_EVM_TYPED_DATA_TYPES)) {
    const actual = value.types[name];
    if (!Array.isArray(actual) || actual.length !== fields.length) invalid();
    fields.forEach((field, index) => {
      exactKeys(actual[index], ["name", "type"]);
      if (actual[index].name !== field.name || actual[index].type !== field.type) invalid();
    });
  }
  return createLegacyEvmTypedData(value.domain, value.message);
}

const hashText = (value: string) => Buffer.from(keccak_256(Buffer.from(value, "utf8")));
const DOMAIN_TYPE_HASH = hashText("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");
const REQUEST_TYPE_HASH = hashText("ForwardRequest(address from,address to,uint256 value,uint256 gas,uint256 nonce,uint48 deadline,bytes data)");
const uintWord = (value: EvmUint) => Buffer.from(BigInt(value).toString(16).padStart(64, "0"), "hex");
const addressWord = (value: string) => Buffer.concat([Buffer.alloc(12), hexBytes(value, 20)]);

/** EIP-712 signing digest, including the 0x1901 envelope and domain separator. */
export function hashLegacyEvmTypedData(value: unknown): Buffer {
  const { domain, message } = normalizeTypedData(value);
  const separator = keccak_256(Buffer.concat([DOMAIN_TYPE_HASH, hashText(domain.name), hashText(domain.version),
    uintWord(domain.chainId), addressWord(domain.verifyingContract)]));
  const requestHash = keccak_256(Buffer.concat([REQUEST_TYPE_HASH, addressWord(message.from), addressWord(message.to),
    uintWord(message.value), uintWord(message.gas), uintWord(message.nonce), uintWord(message.deadline),
    Buffer.from(keccak_256(hexBytes(message.data)))]));
  return Buffer.from(keccak_256(Buffer.concat([Buffer.from([0x19, 0x01]), separator, requestHash])));
}

/** Recover only canonical, low-S 65-byte Ethereum signatures. */
export function recoverLegacyEvmSigner(typedData: unknown, signature: unknown): string {
  const raw = hexBytes(signature, 65);
  const recovery = raw[64] >= 27 ? raw[64] - 27 : raw[64];
  if (recovery !== 0 && recovery !== 1) invalid();
  const parsed = secp256k1.Signature.fromBytes(raw.subarray(0, 64));
  if (parsed.hasHighS()) invalid();
  const digest = hashLegacyEvmTypedData(typedData);
  const publicKey = parsed.addRecoveryBit(recovery).recoverPublicKey(digest).toBytes(false);
  if (!secp256k1.verify(raw.subarray(0, 64), digest, publicKey, { prehash: false, lowS: true })) invalid();
  return `0x${Buffer.from(keccak_256(publicKey.subarray(1))).subarray(12).toString("hex")}`;
}

/** Expected sender, domain and target must come from trusted server state. */
export function verifyLegacyEvmAuthorization(input: {
  typedData: unknown;
  signature: unknown;
  expectedSender: string;
  expectedDomain: LegacyEvmDomain;
  expectedTarget: string;
  nowSeconds: EvmUint;
}): boolean {
  try {
    const typed = normalizeTypedData(input.typedData);
    const expectedDomain = normalizeDomain(input.expectedDomain);
    const sender = evmAddress(input.expectedSender);
    if (typed.message.from !== sender || typed.message.to !== evmAddress(input.expectedTarget) ||
        typed.domain.chainId !== expectedDomain.chainId ||
        typed.domain.verifyingContract !== expectedDomain.verifyingContract ||
        BigInt(typed.message.deadline) < BigInt(evmUint256(input.nowSeconds))) return false;
    return recoverLegacyEvmSigner(typed, input.signature) === sender;
  } catch { return false; }
}
