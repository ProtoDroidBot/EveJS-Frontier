import assert from "node:assert/strict";
import test from "node:test";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import {
  createLegacyEvmTypedData,
  evmAddress,
  evmKeccakHex,
  evmNonce,
  evmUint256,
  hashLegacyEvmTypedData,
  recoverLegacyEvmSigner,
  verifyLegacyEvmAuthorization,
  type LegacyEvmDomain,
  type LegacyEvmTypedData,
} from "../src/services/frontier/legacyEvmAuthorization";

const OWNER = "0x7e5f4552091a69125d5dfcb7b8c2659029395bdf";
const TARGET = "0x1111111111111111111111111111111111111111";
const DOMAIN: LegacyEvmDomain = {
  name: "ERC2771Forwarder", version: "1", chainId: 31337,
  verifyingContract: "0x2222222222222222222222222222222222222222",
};
const PRIVATE_KEY = Buffer.from("01".padStart(64, "0"), "hex");
function typedData(): LegacyEvmTypedData {
  return createLegacyEvmTypedData(DOMAIN, {
    from: OWNER, to: TARGET, value: 0, gas: 1000000,
    nonce: `0x${"ab".repeat(32)}`, deadline: 1700000060,
    data: "0x12345678000000000000000000000000000000000000000000000000000000000000002a",
  });
}
function sign(typed: unknown, privateKey = PRIVATE_KEY): string {
  const signature = secp256k1.sign(hashLegacyEvmTypedData(typed), privateKey, { prehash: false, format: "recovered" });
  return `0x${Buffer.concat([signature.subarray(1), Buffer.from([signature[0] + 27])]).toString("hex")}`;
}
function verify(typed: unknown, signature: unknown, overrides: Record<string, any> = {}): boolean {
  return verifyLegacyEvmAuthorization({ typedData: typed, signature,
    expectedSender: OWNER, expectedDomain: DOMAIN, expectedTarget: TARGET, nowSeconds: 1700000000, ...overrides });
}
function mutableTyped(): any { return JSON.parse(JSON.stringify(typedData())); }

test("legacy EIP-712 signatures recover the Ethereum signer and validate server-bound authorization", () => {
  const typed = typedData(), signature = sign(typed);
  assert.equal(recoverLegacyEvmSigner(typed, signature), OWNER);
  assert.equal(verify(typed, signature), true);
  const normalizedV = `0x${signature.slice(2, -2)}${(parseInt(signature.slice(-2), 16) - 27).toString(16).padStart(2, "0")}`;
  assert.equal(verify(typed, normalizedV), true);
  assert.equal(evmKeccakHex(Buffer.alloc(0)), "0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470");
});

test("fixed signing vector matches the older client's independent native Wallet signer", () => {
  // Era 6 Cycle 5 Wallet.sign_typed_data, imported private key 0x...01.
  // Native ContractMgr fixed schema: uint256 nonce and uint48 deadline.
  const typed = typedData();
  const signature = "0x10a2f27912d18ecf6880ec5ed0a92c9b1a399721b3d311d673aa55543a0f68150c1e92b95a34b2e1a2803edcbefcd8cab16b190b6988633d8d86887a87772e731c";
  assert.equal(hashLegacyEvmTypedData(typed).toString("hex"), "b3cf61f665d2217e31d06403aedaa2c19246a08869c067e1e9b10cc32424e7ab");
  assert.equal(recoverLegacyEvmSigner(typed, signature), OWNER);
  assert.equal(verify(typed, signature), true);
});

test("every forwarded request field is covered by the signature", () => {
  const original = typedData(), signature = sign(original);
  const changes = {
    from: "0x3333333333333333333333333333333333333333", to: DOMAIN.verifyingContract,
    value: "1", gas: "999999", nonce: `0x${"ac".repeat(32)}`, deadline: "1700000061", data: "0x12345679",
  };
  for (const [key, value] of Object.entries(changes)) {
    const changed = mutableTyped(); changed.message[key] = value;
    assert.equal(verify(changed, signature), false, `tampered ${key}`);
  }
});

test("expected identity, deployment and target must match trusted server state", () => {
  const typed = typedData(), signature = sign(typed);
  const otherPrivateKey = Buffer.from("02".padStart(64, "0"), "hex");
  assert.equal(verify(typed, sign(typed, otherPrivateKey)), false);
  assert.equal(verify(typed, signature, { expectedSender: TARGET }), false);
  assert.equal(verify(typed, signature, { expectedTarget: OWNER }), false);
  assert.equal(verify(typed, signature, { expectedDomain: { ...DOMAIN, chainId: 31338 } }), false);
  assert.equal(verify(typed, signature, { expectedDomain: { ...DOMAIN, verifyingContract: TARGET } }), false);
  for (const [key, value] of Object.entries({ chainId: "31338", verifyingContract: TARGET, name: "OtherForwarder", version: "2" })) {
    const changed = mutableTyped(); changed.domain[key] = value;
    assert.equal(verify(changed, signature), false, `tampered domain ${key}`);
  }
});

test("deadline uses integer seconds and rejects expired or invalid server time", () => {
  const typed = typedData(), signature = sign(typed);
  assert.equal(verify(typed, signature, { nowSeconds: 1700000060 }), true);
  assert.equal(verify(typed, signature, { nowSeconds: 1700000061 }), false);
  assert.equal(verify(typed, signature, { nowSeconds: -1 }), false);
  assert.equal(verify(typed, signature, { nowSeconds: 1700000000.5 }), false);
  assert.equal(verify(typed, signature, { nowSeconds: undefined }), false);
});

test("typed data accepts exactly the registered fields and their audited types and order", () => {
  const signed = typedData(), signature = sign(signed);
  const changes = [
    (v: any) => { v.primaryType = "OtherRequest"; },
    (v: any) => { v.extra = true; },
    (v: any) => { v.domain.salt = `0x${"00".repeat(32)}`; },
    (v: any) => { v.message.extra = true; },
    (v: any) => { delete v.message.value; },
    (v: any) => { v.types.ForwardRequest[4].type = "bytes32"; },
    (v: any) => { v.types.ForwardRequest[5].type = "uint256"; },
    (v: any) => { v.types.ForwardRequest.reverse(); },
    (v: any) => { v.types.ForwardRequest[0].extra = true; },
    (v: any) => { v.types.OtherRequest = []; },
    (v: any) => { delete v.types.EIP712Domain; },
  ];
  for (const change of changes) {
    const changed = mutableTyped(); change(changed);
    assert.throws(() => hashLegacyEvmTypedData(changed));
    assert.equal(verify(changed, signature), false);
  }
});

test("canonical integer parsing preserves 256-bit precision and rejects coercions", () => {
  const max = (1n << 256n) - 1n;
  assert.equal(evmUint256(max.toString()), max.toString());
  assert.equal(evmUint256(max), max.toString());
  assert.equal(evmUint256(0), "0");
  for (const bad of [max + 1n, -1n, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, "01", "-1", "+1", "1e3", " 1", "1 ", "0x01", true, null, {}, []]) {
    assert.throws(() => evmUint256(bad), `${String(bad)} must be rejected`);
  }
  const typed = mutableTyped(); typed.message.gas = max.toString();
  assert.equal(verify(typed, sign(typed)), true);
  typed.message.gas = (max + 1n).toString();
  assert.throws(() => hashLegacyEvmTypedData(typed));
  const hexNonce = mutableTyped(); hexNonce.message.nonce = `0x${"ab".repeat(32)}`;
  assert.equal(evmNonce(hexNonce.message.nonce), BigInt(hexNonce.message.nonce).toString());
  assert.deepEqual(hashLegacyEvmTypedData(hexNonce), hashLegacyEvmTypedData(typedData()));
  const maxDeadline = mutableTyped(); maxDeadline.message.deadline = ((1n << 48n) - 1n).toString();
  assert.equal(verify(maxDeadline, sign(maxDeadline)), true);
  maxDeadline.message.deadline = (1n << 48n).toString();
  assert.throws(() => hashLegacyEvmTypedData(maxDeadline));
});

test("hex fields enforce Ethereum address widths and canonical byte encoding", () => {
  assert.equal(evmAddress(OWNER.toUpperCase().replace("0X", "0x")), OWNER);
  for (const bad of ["0x1", `0x${"11".repeat(32)}`, OWNER.slice(2), `${OWNER} `, null]) assert.throws(() => evmAddress(bad));
  for (const [key, value] of [["nonce", "0xab"], ["nonce", "0x" + "ab".repeat(33)],
    ["data", "0x123"], ["data", "1234"], ["data", "0xgg"], ["data", "0x" + "00".repeat(256 * 1024 + 1)]]) {
    const typed = mutableTyped(); typed.message[key] = value;
    assert.throws(() => hashLegacyEvmTypedData(typed));
  }
  const empty = mutableTyped(); empty.message.data = "0x";
  assert.equal(verify(empty, sign(empty)), true);
});

test("malformed, noncanonical and high-S signatures are rejected", () => {
  const typed = typedData(), signature = sign(typed);
  for (const bad of [null, "", "0x", signature.slice(2), `${signature}00`, signature.slice(0, -2),
    `${signature.slice(0, -2)}02`, `${signature.slice(0, -2)}1d`, `0x${"00".repeat(65)}`,
    `0x${"ff".repeat(64)}1b`]) assert.equal(verify(typed, bad), false);
  const raw = Buffer.from(signature.slice(2), "hex");
  const n = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;
  const highS = n - BigInt(`0x${raw.subarray(32, 64).toString("hex")}`);
  Buffer.from(highS.toString(16).padStart(64, "0"), "hex").copy(raw, 32);
  raw[64] = raw[64] === 27 ? 28 : 27;
  assert.equal(verify(typed, `0x${raw.toString("hex")}`), false);
});
