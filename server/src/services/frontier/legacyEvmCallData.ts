import { TextDecoder } from "node:util";
import { evmAddress, evmKeccakHex, evmUint256 } from "./legacyEvmAuthorization";

export interface LegacyEvmAbiField { name: string; type: string; components?: LegacyEvmAbiField[]; }
const MAX_BYTES = 32 * 1024;
function invalid(): never { throw Object.assign(new Error("LEGACY_EVM_CALL_MISMATCH"), { code: "LEGACY_EVM_CALL_MISMATCH" }); }
const uintWord = (value: unknown) => Buffer.from(BigInt(evmUint256(value)).toString(16).padStart(64, "0"), "hex");
const isDynamic = (field: LegacyEvmAbiField): boolean => ["string", "bytes"].includes(field.type) ||
  field.type === "tuple" && (field.components || []).some(isDynamic);
const staticSize = (field: LegacyEvmAbiField): number => isDynamic(field) ? 32 :
  field.type === "tuple" ? (field.components || []).reduce((sum, part) => sum + staticSize(part), 0) : 32;
export const legacyEvmSelector = (signature: string) => evmKeccakHex(Buffer.from(signature)).slice(2, 10);
export function legacyEvmAbiType(field: LegacyEvmAbiField): string {
  return field.type === "tuple" ? `(${(field.components || []).map(legacyEvmAbiType).join(",")})` : field.type;
}
function bytes(value: unknown): Buffer {
  if (typeof value !== "string" || value.length > MAX_BYTES * 2 + 2 || !/^0x(?:[0-9a-f]{2})*$/i.test(value)) invalid();
  return Buffer.from(String(value).slice(2), "hex");
}
function encodeValue(field: LegacyEvmAbiField, value: any): Buffer {
  if (field.type === "uint256") return uintWord(value);
  if (field.type === "address") return Buffer.concat([Buffer.alloc(12), bytes(evmAddress(value))]);
  if (field.type === "bytes32") { const raw = bytes(value); if (raw.length !== 32) invalid(); return raw; }
  if (field.type === "tuple") return encodeFields(field.components || [], value);
  if (field.type === "string" || field.type === "bytes") {
    if (field.type === "string" && typeof value !== "string") invalid();
    const raw = field.type === "string" ? Buffer.from(value, "utf8") : bytes(value);
    if (raw.length > MAX_BYTES) invalid();
    return Buffer.concat([uintWord(raw.length), raw, Buffer.alloc((32 - raw.length % 32) % 32)]);
  }
  return invalid();
}
function encodeFields(fields: LegacyEvmAbiField[], values: Record<string, any>): Buffer {
  let offset = fields.reduce((sum, field) => sum + staticSize(field), 0);
  const head: Buffer[] = [], tail: Buffer[] = [];
  for (const field of fields) {
    const raw = encodeValue(field, values[field.name]);
    if (isDynamic(field)) { head.push(uintWord(offset)); tail.push(raw); offset += raw.length; }
    else head.push(raw);
  }
  return Buffer.concat([...head, ...tail]);
}
/** Decode the narrow virtual ABI used by the legacy wallet, with canonical re-encoding. */
export function decodeLegacyEvmAbi(fields: LegacyEvmAbiField[], value: string): Record<string, any> {
  const raw = bytes(value);
  const word = (offset: number): Buffer => {
    if (!Number.isSafeInteger(offset) || offset < 0 || offset + 32 > raw.length) invalid();
    return raw.subarray(offset, offset + 32);
  };
  const numberAt = (offset: number): number => {
    const result = BigInt(`0x${word(offset).toString("hex")}`);
    if (result > BigInt(MAX_BYTES)) invalid();
    return Number(result);
  };
  function decodeValue(field: LegacyEvmAbiField, offset: number, depth: number): any {
    if (depth > 5) invalid();
    if (field.type === "uint256") return BigInt(`0x${word(offset).toString("hex")}`).toString();
    if (field.type === "address") {
      const value = word(offset); if (value.subarray(0, 12).some(byte => byte !== 0)) invalid();
      return evmAddress(`0x${value.subarray(12).toString("hex")}`);
    }
    if (field.type === "bytes32") return `0x${word(offset).toString("hex")}`;
    if (field.type === "tuple") return decodeFields(field.components || [], offset, depth + 1);
    if (field.type === "string" || field.type === "bytes") {
      const length = numberAt(offset), end = offset + 32 + length;
      if (end > raw.length) invalid();
      const data = raw.subarray(offset + 32, end);
      if (field.type === "bytes") return `0x${data.toString("hex")}`;
      try { return new TextDecoder("utf-8", { fatal: true }).decode(data); } catch { return invalid(); }
    }
    return invalid();
  }
  function decodeFields(parts: LegacyEvmAbiField[], base: number, depth: number) {
    const result: Record<string, any> = {};
    let offset = base;
    for (const field of parts) {
      result[field.name] = decodeValue(field, isDynamic(field) ? base + numberAt(offset) : offset, depth);
      offset += staticSize(field);
    }
    return result;
  }
  const result = decodeFields(fields, 0, 0);
  if (!encodeFields(fields, result).equals(raw)) invalid();
  return result;
}

/** Fixed MUD delegation envelope shared by the audited ERC2771 branches. */
export function unwrapLegacyEvmCall(data: string, expectedSender: string) {
  const raw = bytes(data);
  if (raw.subarray(0, 4).toString("hex") !== legacyEvmSelector("callFrom(address,bytes32,bytes)")) invalid();
  const decoded = decodeLegacyEvmAbi([
    { name: "delegator", type: "address" }, { name: "systemId", type: "bytes32" }, { name: "callData", type: "bytes" },
  ], `0x${raw.subarray(4).toString("hex")}`);
  if (decoded.delegator !== evmAddress(expectedSender)) invalid();
  return { systemId: decoded.systemId as string, callData: decoded.callData as string };
}
