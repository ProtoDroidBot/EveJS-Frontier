import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

async function main() {
  const root = path.resolve(__dirname, "../..");
  const host = path.join(root, "tools/frontier-host");
  const files = fs.readdirSync(host).filter(name => name.endsWith(".test.mjs")).sort().map(name => path.join(host, name));
  files.push(...["frontier-host-arguments.test.js", "frontier-windows-client.test.js", "frontier-windows-runtime.test.js", "frontier-world-sync.test.js", "frontier-world-arguments.test.js"].map(name => path.join(root, "scripts/Tests", name)));
  const node = spawnSync(process.execPath, ["--test", ...files], { cwd: root, stdio: "inherit" });
  if (node.error) throw node.error;
  if (node.status !== 0) return node.status ?? 1;
  const { resolvePython312 } = await import("../../tools/frontier-host/preflight.mjs");
  const python = resolvePython312();
  for (const pattern of ["test_frontier_windows_client.py", "test_frontier_linux_client.py", "test_2703993_native_profile.py",
    "test_2703993_docking_profile.py", "test_2703993_features_profile.py", "test_2703993_staging.py", "test_frontier_patch_plan.py"]) {
    const suite = spawnSync(python, ["-B", "-m", "unittest", "discover", "-s", "tools/frontier-client/test", "-p", pattern], { cwd: root, stdio: "inherit" });
    if (suite.error) throw suite.error;
    if (suite.status !== 0) return suite.status ?? 1;
  }
  return 0;
}

if (require.main === module) main().then(code => { process.exitCode = code; }).catch(error => { console.error(error.message); process.exitCode = 1; });
export { main };
