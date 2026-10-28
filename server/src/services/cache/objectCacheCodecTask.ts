"use strict";

const path = require("path");
const zlib = require("zlib");
const { marshalEncode } = require(path.join(
  __dirname,
  "../../network/tcp/utils/marshal",
));

const CRC_HQX_POLY = 0x1021;
const COMPRESS_THRESHOLD_BYTES = 170;
const COMPRESS_LEVEL = 1;
const DEFAULT_MAX_ENCODED_BYTES = 64 * 1024 * 1024;

function positiveLimit(value, fallback) {
  const numeric = Number(value);
  return Number.isSafeInteger(numeric) && numeric > 0 ? numeric : fallback;
}

function restoreBuffers(value, seen = new WeakSet()) {
  if (value instanceof Uint8Array && !Buffer.isBuffer(value)) return Buffer.from(value);
  if (!value || typeof value !== "object" || seen.has(value)) return value;
  seen.add(value);
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      value[index] = restoreBuffers(value[index], seen);
    }
  } else {
    for (const key of Object.keys(value)) value[key] = restoreBuffers(value[key], seen);
  }
  return value;
}

function computeSignedAdler32(buffer) {
  const MOD_ADLER = 65521;
  let a = 1;
  let b = 0;
  for (let index = 0; index < buffer.length; index += 1) {
    a = (a + buffer[index]) % MOD_ADLER;
    b = (b + a) % MOD_ADLER;
  }
  const unsignedValue = (((b << 16) | a) >>> 0);
  return unsignedValue > 0x7fffffff ? unsignedValue - 0x100000000 : unsignedValue;
}

function computeCrcHqx(buffer, seed = 0) {
  let crc = seed & 0xffff;
  for (let index = 0; index < buffer.length; index += 1) {
    crc ^= buffer[index] << 8;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = crc & 0x8000 ? ((crc << 1) ^ CRC_HQX_POLY) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc;
}

function encodeCachedMethodResult(result, options: Record<string, any> = {}) {
  result = restoreBuffers(result);
  const rawPickle = marshalEncode(result, {
    compatibilityProfile: options.compatibilityProfile,
    maxDepth: positiveLimit(options.maxDepth, 256),
    maxNodes: positiveLimit(options.maxNodes, 1_000_000),
  });
  const maxEncodedBytes = positiveLimit(options.maxEncodedBytes, DEFAULT_MAX_ENCODED_BYTES);
  if (rawPickle.length > maxEncodedBytes) {
    const error: Error & Record<string, any> = new Error(
      `Cached method result exceeds ${maxEncodedBytes} encoded bytes`,
    );
    error.code = "OBJECT_CACHE_ENCODED_LIMIT_EXCEEDED";
    throw error;
  }

  let pickle = rawPickle;
  let compressed = 0;
  if (options.proxyCache && rawPickle.length > COMPRESS_THRESHOLD_BYTES) {
    try {
      const candidate = zlib.deflateSync(rawPickle, { level: COMPRESS_LEVEL });
      if (candidate.length < rawPickle.length) {
        pickle = candidate;
        compressed = 1;
      }
    } catch {
      // Preserve the legacy cache behavior: compression is an optimization,
      // so a zlib failure still returns the original marshaled object.
    }
  }

  return {
    adler32: computeSignedAdler32(rawPickle),
    crcHqx: options.proxyCache ? computeCrcHqx(pickle, Number(options.crcSeed) || 0) : null,
    pickle: options.proxyCache ? pickle : null,
    compressed,
  };
}

module.exports = { encodeCachedMethodResult };
