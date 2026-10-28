"use strict";

const path = require("path");
const zlib = require("zlib");
const {
  marshalDecodeExact,
  marshalEncode,
} = require(path.join(__dirname, "./utils/marshal"));

const DEFAULT_MAX_DECOMPRESSED_BYTES = 32 * 1024 * 1024;
const DEFAULT_MAX_DEPTH = 128;
const DEFAULT_MAX_NODES = 250_000;

function positiveLimit(value, fallback) {
  const numeric = Number(value);
  return Number.isSafeInteger(numeric) && numeric > 0 ? numeric : fallback;
}

function restoreBuffers(value, seen = new WeakSet()) {
  if (value instanceof Uint8Array && !Buffer.isBuffer(value)) {
    return Buffer.from(value);
  }
  if (!value || typeof value !== "object" || seen.has(value)) return value;
  seen.add(value);
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index++) {
      value[index] = restoreBuffers(value[index], seen);
    }
  } else {
    for (const key of Object.keys(value)) {
      value[key] = restoreBuffers(value[key], seen);
    }
  }
  return value;
}

function setPath(root, pathParts, value) {
  let cursor = root;
  for (let index = 0; index < pathParts.length - 1; index++) {
    cursor = cursor[pathParts[index]];
    if (cursor === null || cursor === undefined) {
      throw new Error(`Invalid inner marshal path at segment ${index}`);
    }
  }
  cursor[pathParts[pathParts.length - 1]] = value;
}

function decodeInboundPacket(rawPayload, options: Record<string, any> = {}) {
  let payload = Buffer.isBuffer(rawPayload)
    ? rawPayload
    : Buffer.from(rawPayload || []);
  const maxDecompressedBytes = positiveLimit(
    options.maxDecompressedBytes,
    DEFAULT_MAX_DECOMPRESSED_BYTES,
  );

  if (payload.length > 0 && payload[0] === 0x78) {
    payload = zlib.inflateSync(payload, {
      maxOutputLength: maxDecompressedBytes,
    });
  }
  if (payload.length > maxDecompressedBytes) {
    const error: Error & Record<string, any> = new Error(
      `Decoded packet exceeds ${maxDecompressedBytes} bytes`,
    );
    error.code = "PACKET_DECOMPRESSED_LIMIT_EXCEEDED";
    throw error;
  }

  return marshalDecodeExact(payload, {
    compatibilityProfile: options.compatibilityProfile,
    maxDepth: positiveLimit(options.maxDepth, DEFAULT_MAX_DEPTH),
    maxNodes: positiveLimit(options.maxNodes, DEFAULT_MAX_NODES),
  });
}

function encodeOutboundPacket(value, options: Record<string, any> = {}) {
  value = restoreBuffers(value);
  const marshalOptions = {
    compatibilityProfile: options.compatibilityProfile,
    maxDepth: positiveLimit(options.maxDepth, DEFAULT_MAX_DEPTH),
    maxNodes: positiveLimit(options.maxNodes, DEFAULT_MAX_NODES),
  };
  const innerPayloads: any[] = [];
  for (const job of Array.isArray(options.innerMarshals) ? options.innerMarshals : []) {
    if (!job || !Array.isArray(job.path) || job.path.length === 0) {
      throw new Error("Inner marshal job requires a non-empty path");
    }
    const inner = marshalEncode(restoreBuffers(job.value), marshalOptions);
    setPath(value, job.path, inner);
    innerPayloads.push(job.returnEncoded === true ? inner : inner.length);
  }
  const encoded = marshalEncode(value, marshalOptions);
  const maxEncodedBytes = positiveLimit(
    options.maxEncodedBytes,
    DEFAULT_MAX_DECOMPRESSED_BYTES,
  );
  if (encoded.length > maxEncodedBytes) {
    const error: Error & Record<string, any> = new Error(
      `Encoded packet exceeds ${maxEncodedBytes} bytes`,
    );
    error.code = "PACKET_ENCODED_LIMIT_EXCEEDED";
    throw error;
  }
  return innerPayloads.length > 0 ? { encoded, innerPayloads } : encoded;
}

module.exports = {
  decodeInboundPacket,
  encodeOutboundPacket,
  DEFAULT_MAX_DECOMPRESSED_BYTES,
  DEFAULT_MAX_DEPTH,
  DEFAULT_MAX_NODES,
};
