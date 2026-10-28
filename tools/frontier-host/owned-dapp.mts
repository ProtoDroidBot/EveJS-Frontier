import path from "node:path";
import { pathToFileURL } from "node:url";

// Keep a unique ownership token in /proc/cmdline while the dApp retains its
// strict public command-line interface. Import only this checkout's entry.
const owner = process.argv[2];
const entry = path.resolve(process.argv[3] || "");
if (!/^--evejs-frontier-owner=[a-f0-9-]{36}$/.test(owner || "") ||
    entry !== path.resolve(import.meta.dirname, "../../smart-assembly-control/scripts/serve.mjs")) {
  throw new Error("Invalid owned dApp invocation.");
}
const { createStaticServer, startStaticServer } = await import(pathToFileURL(entry).href);
startStaticServer(await createStaticServer(), { host: "127.0.0.1", port: 443 });
