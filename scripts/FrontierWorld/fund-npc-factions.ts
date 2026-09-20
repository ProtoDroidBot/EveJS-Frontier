import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { fundSuiNpcFactionWallets, normalizeNpcFactionFundingConfig } from "../../server/src/services/frontier/suiNpcFactionFunding";
import { readLiveSuiChainIdentifier, readSyncedSuiWorldConfig, resolveAdminSigner } from "../../server/src/services/frontier/suiCharacterProvisioning";
import { SUI_CHARACTER_TENANT } from "../../server/src/services/frontier/suiCharacterProvisioning";
import { suiGrpcClient } from "../../server/src/services/frontier/suiGrpcClient";

type CliOptions = {
  worldConfigPath?: string;
  factionsConfigPath?: string;
  dryRun?: boolean;
};

function readJsonObject(filePath: string, label: string): Record<string, any> {
  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, ""));
  } catch (cause) {
    throw new Error(`${label} could not be read as JSON: ${filePath}`, { cause });
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error(`${label} must be a JSON object: ${filePath}`);
  }
  return raw as Record<string, any>;
}

function parseArgs(args: string[]): CliOptions {
  const options: CliOptions = {};
  for (let index = 0; index < args.length; index++) {
    const flag = args[index];
    if (flag === "--dry-run") {
      options.dryRun = true;
      continue;
    }
    const value = args[++index];
    if (!value) throw new Error(`Missing value for ${flag}`);
    if (flag === "--world-config") options.worldConfigPath = path.resolve(value);
    else if (flag === "--factions-config") options.factionsConfigPath = path.resolve(value);
    else throw new Error(`Unknown option ${flag}`);
  }
  return options;
}

async function main(options: CliOptions) {
  const build = String(process.env.EVEJS_CLIENT_BUILD || "3502403");
  assert.match(build, /^[0-9]+$/, "EVEJS_CLIENT_BUILD must be numeric");
  const worldConfigPath = options.worldConfigPath || path.resolve(
    __dirname,
    "../../_local/frontier-world",
    build,
    "world.private.json",
  );
  const factionsConfigPath = options.factionsConfigPath || path.resolve(
    __dirname,
    "../../npc-factions.config.json",
  );
  const env = { ...process.env, EVEJS_CLIENT_BUILD: build, EVEJS_SUI_WORLD_CONFIG_PATH: worldConfigPath };
  const synced = readSyncedSuiWorldConfig(env);
  assert.ok(synced, "A ready synchronized Localnet world config is required");
  const liveChainId = await readLiveSuiChainIdentifier(suiGrpcClient as any);
  assert.equal(liveChainId, synced.chainId.slice(0, 8).toLowerCase(), "Live Localnet differs from synchronized world");
  const factionsDocument = readJsonObject(factionsConfigPath, "NPC faction config");
  const config = normalizeNpcFactionFundingConfig(factionsDocument.suiWalletFunding);
  assert.ok(Array.isArray(factionsDocument.factions), "NPC faction config factions must be an array");
  const result = await fundSuiNpcFactionWallets({
    client: suiGrpcClient as any,
    adminSigner: resolveAdminSigner({ env }),
    tenant: SUI_CHARACTER_TENANT,
    factions: factionsDocument.factions,
    config,
    dryRun: options.dryRun,
  });
  const { wallets, ...summary } = result;
  const walletsAtOrAboveBudget = wallets.filter(
    wallet => BigInt(wallet.balanceMist) >= BigInt(result.budgetMist),
  ).length;
  return {
    mode: options.dryRun ? "dry-run" : "sync",
    chainId: liveChainId,
    ...summary,
    walletsAtOrAboveBudget,
  };
}

if (require.main === module) {
  try {
    const options = parseArgs(process.argv.slice(2));
    void main(options).then(result => {
      console.log(JSON.stringify(result, (_key, value) => typeof value === "bigint" ? value.toString() : value, 2));
    }).catch(error => {
      console.error(error instanceof Error ? error.message : "NPC faction funding failed");
      process.exitCode = 1;
    });
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Invalid NPC faction funding arguments");
    process.exitCode = 1;
  }
}

export { main as fundConfiguredNpcFactions, parseArgs as parseNpcFactionFundingArgs };
