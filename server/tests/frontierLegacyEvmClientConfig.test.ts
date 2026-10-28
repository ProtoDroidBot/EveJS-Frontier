import assert = require("node:assert/strict");
import { test } from "node:test";
import { buildLegacyEvmClientConfig, deriveLegacyEvmSmartObjectID } from "../src/services/frontier/legacyEvmClientConfig";

const configuration = () => ({
  worldAddress: `0x${"11".repeat(20)}`,
  domain: { name: "ERC2771Forwarder", version: "1", chainId: "31337", verifyingContract: `0x${"22".repeat(20)}` },
  worldApiBaseUrl: "http://127.0.0.1:3000/legacy-evm",
  systems: { bringOnline: { systemId: `0x${"33".repeat(32)}` }, bringOffline: { systemId: `0x${"44".repeat(32)}` } },
});

test("EVM smart object IDs match the shipped Era 6 Cycle 1 native helper", () => {
  // Generated independently with eve-frontier-web3-windows-amd64.dll from
  // build 2973163: GenerateObjectId('dev', decimal game item ID).
  assert.equal(deriveLegacyEvmSmartObjectID("dev", 1), "7665577998223054550825426233548363259312693690660939769907063791674242551216");
  assert.equal(deriveLegacyEvmSmartObjectID("dev", 1234), "86587032953007269184036128775407254215318448853238977720663702192952572177267");
  assert.notEqual(deriveLegacyEvmSmartObjectID("other", 1), deriveLegacyEvmSmartObjectID("dev", 1));
  for (const id of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) assert.throws(() => deriveLegacyEvmSmartObjectID("dev", id));
});

test("raw client config supplies native JSON ABI, Python signatures and forwarder domain", () => {
  const generated = buildLegacyEvmClientConfig(configuration());
  assert.ok(Array.isArray(generated.cfg), "This exact native ABI profile returns a configuration array");
  const world = generated.cfg.find(entry => entry.name === "IWorld");
  const forwarder = generated.cfg.find(entry => entry.name === "ERC2771Forwarder");
  assert.deepEqual(world.abi.map(entry => entry.name), ["bringOnline", "bringOffline", "callFrom"]);
  assert.deepEqual(world.abi[2].inputs.map(input => input.type), ["address", "bytes32", "bytes"]);
  assert.deepEqual(forwarder.eip712, { name: "ERC2771Forwarder", version: "1" });
  assert.equal(forwarder.chain_id, 31337);
  assert.deepEqual(generated.systems[0].abi, ["function bringOnline(uint256 smartObjectId)"]);
  assert.ok("transfer" in generated.system_ids);
  assert.ok(typeof generated.system_ids.transfer === "string");
  assert.equal(generated.system_ids.transfer.length, 66);
  assert.ok(generated.cfg.some(entry => entry.name === "ERC20"));
  assert.doesNotThrow(() => JSON.stringify(generated));
});

test("config generator rejects incomplete chain identity and omits unavailable actions", () => {
  const config: any = configuration();
  delete config.systems.bringOffline;
  assert.deepEqual(buildLegacyEvmClientConfig(config).systems.map(system => system.abi[0]), ["function bringOnline(uint256 smartObjectId)"]);
  for (const patch of [{ worldAddress: "0x1234" }, { worldApiBaseUrl: "file:///tmp/relay" }, { systems: {} },
    { domain: { ...config.domain, chainId: "9007199254740992" } }]) {
    assert.throws(() => buildLegacyEvmClientConfig({ ...config, ...patch }));
  }
});
