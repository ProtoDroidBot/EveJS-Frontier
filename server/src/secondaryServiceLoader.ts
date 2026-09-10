import type { RuntimeContext } from "./runtimeContext";

export interface SecondaryService {
  enabled?: boolean;
  serviceName?: string;
  exec?(runtimeContext: RuntimeContext): unknown;
}

export interface SecondaryServiceLoaderOptions {
  fileSystem?: Pick<typeof import("node:fs"), "existsSync" | "readdirSync">;
  loadModule?: (fullPath: string) => SecondaryService;
  log?: { debug(message: string): void; err(message: string): void; spacer(): void };
}

"use strict";

const fs = require("fs");
const path = require("path");

const defaultLog = require("./utils/logger");

function loadSecondaryServices(dir: string, runtimeContext: RuntimeContext, options: SecondaryServiceLoaderOptions = {}): void {
  const fileSystem = options.fileSystem || fs;
  const loadModule = options.loadModule || ((fullPath) => require(fullPath));
  const log = options.log || defaultLog;

  if (!fileSystem.existsSync(dir)) {
    log.debug(`secondary services directory not found: ${dir}`);
    return;
  }

  const files = fileSystem.readdirSync(dir, { withFileTypes: true });

  for (const file of files) {
    const fullPath = path.join(dir, file.name);

    if (file.isDirectory()) {
      loadSecondaryServices(fullPath, runtimeContext, {
        fileSystem,
        loadModule,
        log,
      });
      continue;
    }

    if (file.isFile() && file.name.endsWith(".js")) {
      try {
        const service = loadModule(fullPath);
        if (service.enabled === true) {
          log.debug(`starting secondary service: ${service.serviceName}`);
          service.exec(runtimeContext);
        } else {
          log.debug(
            `skipping service: ${service.serviceName} as it is not enabled`,
          );
        }
        log.spacer();
      } catch (err) {
        log.err(
          `failed to start secondary service ${fullPath}: ${err.message}`,
        );
        log.spacer();
      }
    }
  }
}

module.exports = {
  loadSecondaryServices,
};
