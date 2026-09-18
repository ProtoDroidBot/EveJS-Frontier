"use strict";

const path = require("path");
const { ServiceTaskPool } = require(path.join(
  __dirname,
  "../../utils/serviceTaskPool",
));

function positiveInteger(value, fallback) {
  const numeric = Number(value);
  return Number.isSafeInteger(numeric) && numeric > 0 ? numeric : fallback;
}

const codecPool = new ServiceTaskPool({
  poolSize: positiveInteger(process.env.EVEJS_PACKET_CODEC_THREADS, 2),
  taskTimeoutMs: positiveInteger(process.env.EVEJS_PACKET_CODEC_TIMEOUT_MS, 10_000),
  maxPendingTasks: positiveInteger(process.env.EVEJS_PACKET_CODEC_MAX_PENDING, 512),
});
const CODEC_TASK_PATH = path.join(__dirname, "packetCodecTask.js");
const MAX_PENDING_CODEC_TASKS = positiveInteger(
  process.env.EVEJS_PACKET_CODEC_MAX_PENDING,
  512,
);
let pendingCodecTasks = 0;

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

function runCodecTask(exportName, args) {
  if (pendingCodecTasks >= MAX_PENDING_CODEC_TASKS) {
    const error: Error & Record<string, any> = new Error(
      `Packet codec queue is full (${MAX_PENDING_CODEC_TASKS})`,
    );
    error.code = "PACKET_CODEC_QUEUE_FULL";
    return Promise.reject(error);
  }
  pendingCodecTasks += 1;
  return codecPool.run({
    modulePath: CODEC_TASK_PATH,
    exportName,
    args,
  }).finally(() => {
    pendingCodecTasks -= 1;
  });
}

function decodeInboundPacket(payload, options: Record<string, any> = {}) {
  return runCodecTask("decodeInboundPacket", [payload, options])
    .then((decoded) => restoreBuffers(decoded));
}

function encodeOutboundPacket(value, options: Record<string, any> = {}) {
  return runCodecTask("encodeOutboundPacket", [value, options]);
}

module.exports = {
  decodeInboundPacket,
  encodeOutboundPacket,
  getPendingTaskCount: () => pendingCodecTasks,
  MAX_PENDING_CODEC_TASKS,
  close: () => codecPool.close(),
};
