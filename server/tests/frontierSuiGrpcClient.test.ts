import assert = require("node:assert/strict");
import fs = require("node:fs");
import path = require("node:path");
import { test } from "node:test";

import {
  SuiGrpcClient,
  SUI_GRPC_BASE_URL,
  SUI_GRPC_CLIENT_OPTIONS,
  SUI_GRPC_NETWORK,
  buildSuiClientGlobalConfigEntries,
  createSuiGrpcClient,
  suiGrpcClient,
} from "../src/services/frontier/suiGrpcClient";

const REPO_ROOT = path.resolve(__dirname, "..", "..");

test("Frontier SuiGrpcClient targets the local Sui network", () => {
  assert.equal(SUI_GRPC_NETWORK, "localnet");
  assert.equal(SUI_GRPC_BASE_URL, "http://localhost:9000");
  assert.deepEqual(SUI_GRPC_CLIENT_OPTIONS, {
    network: "localnet",
    baseUrl: "http://localhost:9000",
  });
  assert.equal(Object.isFrozen(SUI_GRPC_CLIENT_OPTIONS), true);
  assert.equal(SuiGrpcClient.name, "SuiGrpcClient");
  assert.ok(suiGrpcClient instanceof SuiGrpcClient);
  assert.equal(suiGrpcClient.network, SUI_GRPC_NETWORK);

  const secondClient = createSuiGrpcClient();
  assert.ok(secondClient instanceof SuiGrpcClient);
  assert.notEqual(secondClient, suiGrpcClient);
  assert.equal(secondClient.network, SUI_GRPC_NETWORK);
});

test("Frontier SuiGrpcClient sends requests to the local Sui base URL", async () => {
  let requestedUrl: string | undefined;
  const client = createSuiGrpcClient({
    fetch: async (input) => {
      requestedUrl = String(input);
      throw new Error("request captured");
    },
  });

  await assert.rejects(
    client.ledgerService.getServiceInfo({}).response,
    /request captured/,
  );
  assert.ok(requestedUrl?.startsWith(`${SUI_GRPC_BASE_URL}/`));
});

test("Frontier advertises localnet to the in-game Sui wallet", () => {
  const frontierConfig = new Map(buildSuiClientGlobalConfigEntries("frontier"));
  const tranquilityConfig = new Map(
    buildSuiClientGlobalConfigEntries("tranquility"),
  );

  assert.equal(frontierConfig.get("sui_network"), SUI_GRPC_NETWORK);
  assert.notEqual(frontierConfig.get("sui_network"), SUI_GRPC_BASE_URL);
  assert.equal(frontierConfig.has("web3_api_gateway_url"), false);
  assert.equal(tranquilityConfig.has("sui_network"), false);
});

test("Frontier launchers pin the wallet seed tenant to the deployed dev world", () => {
  const windowsLauncher = fs.readFileSync(
    path.join(REPO_ROOT, "PlayFrontier.ps1"),
    "utf8",
  );
  const macLauncher = fs.readFileSync(
    path.join(REPO_ROOT, "PlayFrontier.sh"),
    "utf8",
  );

  assert.match(windowsLauncher, /Set-LaunchArgument '\/tenant=' '\/tenant=dev'/);
  assert.match(macLauncher, /upsert_arg "\/tenant=" "\/tenant=dev"/);
});
