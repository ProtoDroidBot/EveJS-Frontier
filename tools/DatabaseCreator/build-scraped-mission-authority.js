#!/usr/bin/env node
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
/*
 * Retained as a safe compatibility entry point for older local workflows.
 * Scraped Eve-Survival templates are no longer production mission authority.
 */
const { runCli } = require("./enforce-production-mission-policy");
process.stderr.write("build-scraped-mission-authority is retired; enforcing production mission policy instead.\n");
try {
    runCli();
}
catch (error) {
    process.stderr.write(`build-scraped-mission-authority failed: ${error.message}\n`);
    process.exitCode = 1;
}
//# sourceMappingURL=build-scraped-mission-authority.js.map