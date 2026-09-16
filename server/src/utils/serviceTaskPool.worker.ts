/**
 * Generic worker-thread entry for CPU-heavy, side-effect-free service tasks.
 *
 * The main process owns live game state. Workers may calculate plans and return
 * structured-cloneable results, but authoritative mutations stay on the main
 * thread so service caches cannot diverge.
 */

"use strict";

const { parentPort } = require("worker_threads") as {
  parentPort: import("node:worker_threads").MessagePort | null;
};

if (!parentPort) {
  throw new Error("service task worker requires a parent port");
}

function serializeError(error) {
  return {
    name: String(error && error.name || "Error"),
    message: String(error && error.message || error || "service task failed"),
    stack: error && error.stack ? String(error.stack) : null,
    code: error && error.code !== undefined ? error.code : null,
  };
}

function resolveExport(moduleExports, exportName) {
  const pathParts = String(exportName || "")
    .split(".")
    .map((part) => part.trim())
    .filter(Boolean);
  let value = moduleExports;
  for (const part of pathParts) {
    value = value && value[part];
  }
  if (typeof value !== "function") {
    throw new TypeError(`worker task export is not callable: ${exportName}`);
  }
  return value;
}

parentPort.on("message", async (message) => {
  const taskID = message && message.taskID;
  try {
    if (!message || message.type !== "run") {
      throw new TypeError("invalid service task message");
    }
    const modulePath = String(message.modulePath || "");
    if (!modulePath) {
      throw new TypeError("service task requires a module path");
    }
    const moduleExports = require(modulePath);
    const task = resolveExport(moduleExports, message.exportName);
    const args = Array.isArray(message.args) ? message.args : [];
    const result = await task(...args);
    parentPort.postMessage({
      type: "result",
      taskID,
      result,
    });
  } catch (error) {
    parentPort.postMessage({
      type: "error",
      taskID,
      error: serializeError(error),
    });
  }
});
