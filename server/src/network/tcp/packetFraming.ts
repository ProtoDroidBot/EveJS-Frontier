"use strict";

function usesBigEndianPacketLengths(profile?: string): boolean {
  return String(profile || "").trim().toLowerCase() === "frontier";
}

function readPacketLength(buffer: Buffer, profile?: string, offset = 0): number {
  return usesBigEndianPacketLengths(profile)
    ? buffer.readUInt32BE(offset)
    : buffer.readUInt32LE(offset);
}

function framePayload(payload: Buffer, profile?: string): Buffer {
  if (!Buffer.isBuffer(payload)) {
    throw new TypeError("framePayload expects a Buffer payload");
  }

  const header = Buffer.alloc(4);
  if (usesBigEndianPacketLengths(profile)) {
    header.writeUInt32BE(payload.length, 0);
  } else {
    header.writeUInt32LE(payload.length, 0);
  }
  return Buffer.concat([header, payload]);
}

module.exports = {
  framePayload,
  readPacketLength,
  usesBigEndianPacketLengths,
};
