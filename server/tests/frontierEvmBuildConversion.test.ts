const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { prepareLegacyEvmBuildConversion, main } = require("../../tools/frontier-contracts/convert-evm-build.mjs");
const { deriveLegacyEvmSmartObjectID } = require("../src/services/frontier/legacyEvmClientConfig");
const accounts = { "7": { evmAddress: "0x7e5f4552091a69125d5dfcb7b8c2659029395bdf", walletPassphrase: "test-wallet-only" } };
const input = () => ({ build: 2973163, tenant: "dev", accounts, items: [1234], apiUrl: "http://127.0.0.1:3000" });

test("conversion prepares exact audited build credentials and native smart-object mappings", () => {
  for (const build of [2973163, 2997426, 3122254]) {
    const config = prepareLegacyEvmBuildConversion({ ...input(), build });
    assert.equal(config.clientBuild, build);
    assert.equal(config.objects[deriveLegacyEvmSmartObjectID("dev", 1234)], 1234);
    assert.equal(config.accounts["7"].evmAddress, accounts["7"].evmAddress);
    assert.match(config.systems.bringOnline.systemId, /^0x[0-9a-f]{64}$/);
  }
  for (const patch of [{ build: 2615573 }, { build: 3640684 }, { accounts: {} }, { items: [] },
    { items: [0] }, { apiUrl: "file:///tmp/world" }, { accounts: { "7": { evmAddress: "0x1", walletPassphrase: "test" } } }]) {
    assert.throws(() => prepareLegacyEvmBuildConversion({ ...input(), ...patch }));
  }
});

test("conversion command writes a private manifest and refuses to overwrite a file", t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "frontier-evm-conversion-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const accountFile = path.join(dir, "accounts.json"), outputFile = path.join(dir, "bridge.json");
  fs.writeFileSync(accountFile, JSON.stringify(accounts));
  const args = ["--build", "2973163", "--accounts", accountFile, "--item", "1234", "--item", "1001",
    "--api-url", "http://127.0.0.1:3000", "--out", outputFile];
  main(args);
  const raw = fs.readFileSync(outputFile, "utf8");
  assert.equal(Object.keys(JSON.parse(raw).objects).length, 2);
  if (process.platform !== "win32") assert.equal(fs.statSync(outputFile).mode & 0o777, 0o600);
  assert.throws(() => main(args), /EEXIST/);
  assert.equal(fs.readFileSync(outputFile, "utf8"), raw);
});
