import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

// Invoke JavaScript package-manager entry points through Node on Windows.
// Passing user paths through cmd.exe would add a second quoting language.
export function nativeCommand(program: string, args: string[], env = process.env) {
  if (process.platform !== "win32" || !["npm", "pnpm"].includes(program)) return { command: program, args };
  const candidates: string[] = [];
  if (program === "npm" && env.npm_execpath) candidates.push(env.npm_execpath);
  for (const directory of [path.dirname(process.execPath), ...(env.PATH || env.Path || "").split(path.delimiter)]) {
    if (!directory) continue;
    if (program === "pnpm" && fs.existsSync(path.join(directory, "pnpm.exe"))) return { command: path.join(directory, "pnpm.exe"), args };
    candidates.push(path.join(directory, "node_modules", program, "bin", program === "npm" ? "npm-cli.js" : "pnpm.cjs"));
    if (program === "pnpm") candidates.push(path.join(directory, "pnpm.cjs"));
    if (program === "pnpm") candidates.push(path.join(directory, "node_modules/corepack/dist/pnpm.js"));
  }
  const entry = candidates.find(candidate => /\.(?:c?js|mjs)$/i.test(candidate) && fs.existsSync(candidate));
  if (!entry) throw new Error(`Cannot locate ${program}'s JavaScript CLI. Install ${program} alongside Node.js or expose its CLI on PATH.`);
  return { command: process.execPath, args: [entry, ...args] };
}

export function runNative(program: string, args: string[], options: { cwd?: string; env?: NodeJS.ProcessEnv; capture?: boolean; timeout?: number } = {}) {
  const command = nativeCommand(program, args, options.env || process.env);
  const result = spawnSync(command.command, command.args, {
    cwd: options.cwd, env: options.env || process.env, windowsHide: true,
    timeout: options.timeout, encoding: "utf8", stdio: options.capture ? "pipe" : "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw Object.assign(new Error(`${program} exited ${result.status}${options.capture ? `: ${(result.stderr || result.stdout || "").trim().slice(0, 800)}` : ""}`), { exitCode: result.status || 1 });
  return result.stdout?.trim() || "";
}
